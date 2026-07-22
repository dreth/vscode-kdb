'use strict';

const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const net = require('net');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const {
  KdbIpcClient,
  KdbQError,
  QIpcReceiveBuffer,
  deserializeQMessage,
  deserializeQPayload,
  qValueRowsMaterialized,
  qValueToColumnarPanel,
  serializeTextQuery,
} = requireOut('q-ipc');
const { qSelectionExecutionKind, selectedTextOrCurrentLine } = requireOut('q-text');
const {
  DEFAULT_CONNECTION_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  connectionSessionChanged,
  connectionEndpoint,
  normalizeNamespace,
  parseOptionalTimeout,
  qScriptInNamespace,
  qString,
  queryInNamespace,
  resolveConnectionTimeouts,
  safeTimeoutMs,
  safeStoredConnections,
  validateConnection,
} = requireOut('connection');
const {
  ConnectionFormValidationError,
  parseConnectionFormPayload,
  passwordUpdateForForm,
} = requireOut('connection-form-model');
const { persistConnectionUpdate } = requireOut('connection-lifecycle');
const {
  KX_OUTPUT_CHANNEL_NAME,
  KxDiagnostics,
  REDACTED_DIAGNOSTIC_VALUE,
  redactDiagnosticText,
  sanitizeDiagnosticDetails,
} = requireOut('diagnostics');
const {
  configurePerfOutput,
  configurePerfTrace,
  perfMark,
} = requireOut('perf');
const {
  createColumnarPanelResult,
  rowsToColumnarPanelResult,
} = requireOut('kx-results');

const tests = [
  ['q IPC codec and receive buffering', testQIpc],
  ['diagnostics and performance trace redaction', testDiagnostics],
  ['exact q selection/current-line text', testQText],
  ['connection validation and namespace wrapping', testConnections],
  ['connection form payload and password semantics', testConnectionFormModel],
  ['connection webview lifecycle', testConnectionFormPanelLifecycle],
  ['connection SecretStorage transactions', testConnectionStoreTransactions],
  ['post-persist active connection lifecycle', testConnectionUpdateLifecycle],
  ['connection manager lifecycle races', testConnectionManagerLifecycle],
  ['columnar result windows and exports', testColumnarResults],
  ['local data server start/stop concurrency', testLocalDataServerConcurrency],
  ['extension manifest and standalone-source guards', testManifestAndSources],
];

(async () => {
  for (const [name, test] of tests) {
    await test();
    process.stdout.write(`ok - ${name}\n`);
  }
  process.stdout.write(`\n${tests.length} focused test groups passed.\n`);
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

async function testQIpc() {
  assert.strictEqual(
    serializeTextQuery('1+1').toString('hex'),
    '01010000110000000a0003000000312b31',
    'q queries must be synchronous char-vector IPC messages'
  );
  assert.strictEqual(deserializeQMessage(hex('010000000d000000fa01000000')), 1);
  assert.deepStrictEqual(deserializeQPayload(intVector([1, -2, 3])), [1, -2, 3]);

  const scalarMessage = hex('010000000d000000fa01000000');
  const fragmented = new QIpcReceiveBuffer();
  fragmented.append(scalarMessage.subarray(0, 3));
  fragmented.append(scalarMessage.subarray(3, 8));
  assert.strictEqual(fragmented.readMessage(), null);
  fragmented.append(scalarMessage.subarray(8, 11));
  assert.strictEqual(fragmented.readMessage(), null);
  fragmented.append(scalarMessage.subarray(11));
  assert.strictEqual(fragmented.readMessage().toString('hex'), scalarMessage.toString('hex'));
  assert.strictEqual(fragmented.bufferedBytes, 0);
  assert.strictEqual(fragmented.copyCount, 1, 'a fragmented message should be copied once');
  assert.strictEqual(fragmented.copyBytesCopied, scalarMessage.length);

  const secondMessage = serializeTextQuery('show 42');
  const combinedChunk = Buffer.concat([scalarMessage, secondMessage]);
  const combined = new QIpcReceiveBuffer();
  combined.append(combinedChunk);
  const first = combined.readMessage();
  const second = combined.readMessage();
  assert.strictEqual(first.toString('hex'), scalarMessage.toString('hex'));
  assert.strictEqual(second.toString('hex'), secondMessage.toString('hex'));
  assert.strictEqual(first.buffer, combinedChunk.buffer, 'contiguous messages should use zero-copy slices');
  assert.strictEqual(second.buffer, combinedChunk.buffer);
  assert.strictEqual(combined.readMessage(), null);
  assert.strictEqual(combined.copyCount, 0);

  const invalidEndian = Buffer.from(scalarMessage);
  invalidEndian[0] = 2;
  const invalidBuffer = new QIpcReceiveBuffer();
  invalidBuffer.append(invalidEndian);
  assert.throws(() => invalidBuffer.readMessage(), /Invalid q IPC endian flag 2/);
  assert.throws(() => deserializeQPayload(vectorHeader(20, 1)), /Unsupported q IPC type 20/);

  const table = deserializeQPayload(qTable(
    ['sym', 'size'],
    [symbolVector(['AAPL', 'MSFT']), intVector([100, 250])]
  ));
  assert.strictEqual(qValueRowsMaterialized(table), false);
  const panel = qValueToColumnarPanel(table);
  assert.strictEqual(panel.mode, 'grid');
  assert.deepStrictEqual(panel.cols, ['sym', 'size']);
  assert.deepStrictEqual(
    panel.result.cellWindow({ start: 0, end: 1 }, { start: 0, end: 1 }).cells,
    [['AAPL', '100'], ['MSFT', '250']]
  );
  assert.strictEqual(qValueRowsMaterialized(table), false, 'viewer conversion must stay columnar/lazy');
  const server = net.createServer();
  await listen(server);
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  await closeServer(server);
  await assert.rejects(
    () => new KdbIpcClient({ host: '127.0.0.1', port, timeoutMs: 500 }).connect(),
    error => error &&
      error.name === 'KdbIpcError' &&
      error.message.includes(`127.0.0.1:${port}`) &&
      /connect failed/i.test(error.message),
    'connection errors must identify the direct q host and port'
  );

  let resetConnections = 0;
  const resetServer = net.createServer(socket => {
    resetConnections++;
    socket.destroy();
  });
  await listen(resetServer);
  const resetAddress = resetServer.address();
  const resetPort = resetAddress && typeof resetAddress === 'object' ? resetAddress.port : 0;
  const resetClient = new KdbIpcClient({ host: '127.0.0.1', port: resetPort, timeoutMs: 500 });
  try {
    for (const attempt of ['initial', 'retry']) {
      await assertCompletesWithin(
        `q IPC handshake reset ${attempt}`,
        () => assert.rejects(
          () => resetClient.connect(),
          error => error &&
            /handshake failed/i.test(error.message) &&
            error.message.includes(`127.0.0.1:${resetPort}`)
        ),
        1000
      );
    }
    assert.strictEqual(resetConnections, 2, 'a failed handshake must clear connectPromise for retry');
  } finally {
    await closeServer(resetServer);
  }

  const heldSockets = [];
  const stalledServer = net.createServer(socket => heldSockets.push(socket));
  const accepted = new Promise(resolve => stalledServer.once('connection', resolve));
  await listen(stalledServer);
  const stalledAddress = stalledServer.address();
  const stalledPort = stalledAddress && typeof stalledAddress === 'object' ? stalledAddress.port : 0;
  const stalledClient = new KdbIpcClient({ host: '127.0.0.1', port: stalledPort, timeoutMs: 5000 });
  const stalledConnect = stalledClient.connect();
  try {
    await accepted;
    stalledClient.cancel(new Error('test cancel'));
    await assertCompletesWithin(
      'q IPC handshake cancellation',
      () => assert.rejects(
        () => stalledConnect,
        error => error &&
          /(connect|handshake) failed/i.test(error.message) &&
          error.message.includes(`127.0.0.1:${stalledPort}`) &&
          /test cancel/.test(error.message)
      ),
      1000
    );
    await assert.rejects(
      () => stalledClient.query('1'),
      /connection is not open/,
      'canceling an in-flight connect must leave no usable stale socket state'
    );
  } finally {
    heldSockets.forEach(socket => socket.destroy());
    await closeServer(stalledServer);
  }

  const timeoutUsername = ['timeout', 'user'].join('-');
  const timeoutPassword = ['timeout', 'secret'].join('-');
  const handshakeSockets = [];
  let markHandshakeReceived;
  const handshakeReceived = new Promise(resolve => {
    markHandshakeReceived = resolve;
  });
  const handshakeServer = net.createServer(socket => {
    handshakeSockets.push(socket);
    socket.once('data', markHandshakeReceived);
  });
  await listen(handshakeServer);
  const handshakeAddress = handshakeServer.address();
  const handshakePort = handshakeAddress && typeof handshakeAddress === 'object' ? handshakeAddress.port : 0;
  const handshakeClient = new KdbIpcClient({
    host: '127.0.0.1',
    port: handshakePort,
    username: timeoutUsername,
    password: timeoutPassword,
    connectTimeoutMs: 100,
    queryTimeoutMs: 5000,
  });
  const handshakeConnect = handshakeClient.connect();
  const handshakeRejection = assert.rejects(
    () => handshakeConnect,
    error => error &&
      error.name === 'KdbIpcError' &&
      /handshake failed/i.test(error.message) &&
      error.message.includes(`127.0.0.1:${handshakePort}`) &&
      /timed out after 100 ms/i.test(error.message) &&
      !error.message.includes(timeoutUsername) &&
      !error.message.includes(timeoutPassword)
  );
  try {
    await assertCompletesWithin('q IPC handshake write', () => handshakeReceived, 1000);
    await assertCompletesWithin(
      'q IPC handshake timeout',
      () => handshakeRejection,
      1500
    );
  } finally {
    await handshakeClient.close();
    handshakeSockets.forEach(socket => socket.destroy());
    await closeServer(handshakeServer);
  }

  const querySockets = [];
  let markQueryReceived;
  const queryReceived = new Promise(resolve => {
    markQueryReceived = resolve;
  });
  const timeoutServer = net.createServer(socket => {
    querySockets.push(socket);
    let handshakeComplete = false;
    socket.on('data', chunk => {
      if (!handshakeComplete) {
        handshakeComplete = true;
        socket.write(Buffer.from([3]));
        return;
      }
      markQueryReceived(chunk);
    });
  });
  await listen(timeoutServer);
  const timeoutAddress = timeoutServer.address();
  const timeoutPort = timeoutAddress && typeof timeoutAddress === 'object' ? timeoutAddress.port : 0;
  const privateQuery = ['private', 'query', 'must', 'not', 'leak'].join('-');
  const timeoutDiagnosticLines = [];
  const queryTimeoutClient = new KdbIpcClient({
    host: '127.0.0.1',
    port: timeoutPort,
    username: timeoutUsername,
    password: timeoutPassword,
    connectTimeoutMs: 1000,
    queryTimeoutMs: 100,
    diagnostics: new KxDiagnostics({ appendLine: value => timeoutDiagnosticLines.push(value) }),
  });
  try {
    await queryTimeoutClient.connect();
    const timedQuery = queryTimeoutClient.query(privateQuery);
    const queryTimeoutRejection = assert.rejects(
      () => timedQuery,
      error => error &&
        error.name === 'KdbIpcError' &&
        /query failed/i.test(error.message) &&
        error.message.includes(`127.0.0.1:${timeoutPort}`) &&
        /timed out after 100 ms/i.test(error.message) &&
        !error.message.includes(privateQuery) &&
        !error.message.includes(timeoutUsername) &&
        !error.message.includes(timeoutPassword)
    );
    await assertCompletesWithin('q IPC query write', () => queryReceived, 1000);
    await assertCompletesWithin(
      'q IPC query timeout',
      () => queryTimeoutRejection,
      1500
    );
    await assert.rejects(
      () => queryTimeoutClient.query('retry-after-timeout'),
      /connection is not open/,
      'a timed-out query must destroy the transport instead of leaving a stale session'
    );
    const timeoutDiagnostics = timeoutDiagnosticLines.join('\n');
    assert.ok(!timeoutDiagnostics.includes(privateQuery));
    assert.ok(!timeoutDiagnostics.includes(timeoutUsername));
    assert.ok(!timeoutDiagnostics.includes(timeoutPassword));
    assert.ok(timeoutDiagnosticLines.map(line => JSON.parse(line)).some(event =>
      event.phase === 'query' && event.status === 'failed' && event.endpoint === `127.0.0.1:${timeoutPort}`
    ));
  } finally {
    await queryTimeoutClient.close();
    querySockets.forEach(socket => socket.destroy());
    await closeServer(timeoutServer);
  }
}

async function testDiagnostics() {
  assert.strictEqual(KX_OUTPUT_CHANNEL_NAME, 'KX');
  const fakeUsername = ['diag', 'user'].join('-');
  const fakeSecret = ['never', 'emit', 'this'].join('-');
  const queryText = ['show', 'private', 'query', 'value'].join(' ');
  const qErrorText = ['private', 'q', 'error', 'value'].join('-');

  const redacted = redactDiagnosticText(
    `password=${fakeSecret} token:abc https://${fakeUsername}:${fakeSecret}@q.example.test/`,
    [fakeUsername, fakeSecret]
  );
  assert.ok(!redacted.includes(fakeUsername));
  assert.ok(!redacted.includes(fakeSecret));
  assert.ok(!redacted.includes('abc'));
  assert.ok(redacted.includes(REDACTED_DIAGNOSTIC_VALUE));

  const circular = {};
  circular.self = circular;
  const safeDetails = sanitizeDiagnosticDetails({
    password: fakeSecret,
    query: queryText,
    queryChars: queryText.length,
    note: `authorization: ${fakeSecret}`,
    nested: { token: fakeSecret },
    circular,
  }, [fakeSecret]);
  assert.strictEqual(safeDetails.password, REDACTED_DIAGNOSTIC_VALUE);
  assert.strictEqual(safeDetails.query, REDACTED_DIAGNOSTIC_VALUE);
  assert.strictEqual(safeDetails.queryChars, queryText.length);
  assert.ok(!JSON.stringify(safeDetails).includes(fakeSecret));
  assert.strictEqual(safeDetails.circular.self, '[circular]');

  const structuredLines = [];
  const structuredDiagnostics = new KxDiagnostics({ appendLine: value => structuredLines.push(value) });
  structuredDiagnostics.event({
    phase: 'connect',
    endpoint: 'safe.example.test:5000',
    status: 'start',
    details: {
      phase: 'query',
      endpoint: `password=${fakeSecret}`,
      status: 'failed',
    },
    secrets: [fakeSecret],
  });
  const structuredEvent = JSON.parse(structuredLines[0]);
  assert.strictEqual(structuredEvent.phase, 'connect', 'details must not override the diagnostic phase');
  assert.strictEqual(structuredEvent.endpoint, 'safe.example.test:5000', 'details must not override the endpoint');
  assert.strictEqual(structuredEvent.status, 'start', 'details must not override the diagnostic status');
  assert.ok(!structuredLines[0].includes(fakeSecret));

  const diagnosticLines = [];
  const diagnostics = new KxDiagnostics(
    { appendLine: value => diagnosticLines.push(value) },
    () => new Date('2026-07-22T00:00:00.000Z')
  );
  const scalarResponse = hex('010200000d000000fa01000000');
  const errorResponse = qResponse(Buffer.concat([int8(-128), cString(qErrorText)]));
  let queryCount = 0;
  const server = net.createServer(socket => {
    let handshakeComplete = false;
    socket.on('data', () => {
      if (!handshakeComplete) {
        handshakeComplete = true;
        socket.write(Buffer.from([3]));
        return;
      }
      queryCount++;
      socket.write(queryCount === 1 ? scalarResponse : errorResponse);
    });
  });
  await listen(server);
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  const client = new KdbIpcClient({
    host: '127.0.0.1',
    port,
    username: fakeUsername,
    password: fakeSecret,
    timeoutMs: 1000,
    diagnostics,
  });
  try {
    await client.connect();
    assert.strictEqual(await client.query(queryText), 1);
    await assert.rejects(
      () => client.query(`${queryText};second`),
      error => error instanceof KdbQError && error.message === qErrorText,
      'a genuine q IPC error must reject as KdbQError'
    );
  } finally {
    await client.close();
    await closeServer(server);
  }

  const diagnosticsText = diagnosticLines.join('\n');
  assert.ok(!diagnosticsText.includes(fakeUsername), 'diagnostics must redact the authentication username');
  assert.ok(!diagnosticsText.includes(fakeSecret), 'diagnostics must redact the authentication secret');
  assert.ok(!diagnosticsText.includes(queryText), 'diagnostics must omit q source text');
  assert.ok(!diagnosticsText.includes(qErrorText), 'diagnostics must omit q error values');
  const events = diagnosticLines.map(line => JSON.parse(line));
  const endpoint = `127.0.0.1:${port}`;
  assert.ok(events.every(event => event.endpoint === endpoint));
  assert.ok(events.some(event => event.phase === 'connect' && event.status === 'success'));
  assert.ok(events.some(event => event.phase === 'handshake' && event.status === 'success'));
  assert.ok(events.some(event => event.phase === 'query' && event.status === 'success'));
  assert.ok(events.some(event =>
    event.phase === 'query' && event.status === 'failed' && event.errorName === 'KdbQError'
  ));
  assert.ok(events.some(event => event.phase === 'close' && event.status === 'success'));

  const perfLines = [];
  const originalConsoleLog = console.log;
  console.log = () => undefined;
  configurePerfOutput(value => perfLines.push(value));
  configurePerfTrace(true);
  try {
    perfMark('test.redaction', {
      query: queryText,
      queryChars: queryText.length,
      password: fakeSecret,
      endpoint,
    });
  } finally {
    configurePerfTrace(undefined);
    configurePerfOutput(undefined);
    console.log = originalConsoleLog;
  }
  assert.strictEqual(perfLines.length, 1);
  assert.ok(!perfLines[0].includes(queryText));
  assert.ok(!perfLines[0].includes(fakeSecret));
  assert.ok(perfLines[0].includes(`"queryChars":${queryText.length}`));
}

function testQText() {
  const source = 'first:1\r\n  second:2  \r\n\r\nf:{[x]\r\n x+1\r\n}';
  assert.strictEqual(
    selectedTextOrCurrentLine(source, '  a:1\nb:2  ', 4),
    '  a:1\nb:2  ',
    'a non-empty selection must be returned byte-for-byte'
  );
  assert.strictEqual(selectedTextOrCurrentLine(source, '  ', 1), '  ');
  assert.strictEqual(selectedTextOrCurrentLine(source, '', 1), '  second:2  ');
  assert.strictEqual(selectedTextOrCurrentLine(source, '', 2), '');
  assert.strictEqual(selectedTextOrCurrentLine(source, '', 4), ' x+1');
  assert.strictEqual(selectedTextOrCurrentLine('a\nb', '', -5), 'a');
  assert.strictEqual(selectedTextOrCurrentLine('a\nb', '', 50), 'b');
  assert.strictEqual(selectedTextOrCurrentLine('', '', 0), '');
  assert.strictEqual(qSelectionExecutionKind('a:1'), 'query');
  assert.strictEqual(qSelectionExecutionKind('a:1\nb:2'), 'script');
  assert.strictEqual(qSelectionExecutionKind('a:1\r\nb:2'), 'script');
}

function testConnections() {
  const connection = validateConnection({
    id: 'kx-local',
    name: ' Local q ',
    host: ' [::1] ',
    port: '5000',
    database: 'analytics.market',
    username: 'daniel',
  });
  assert.deepStrictEqual(connection, {
    id: 'kx-local',
    name: 'Local q',
    host: '::1',
    port: 5000,
    database: '.analytics.market',
    username: 'daniel',
  });
  assert.strictEqual(connectionEndpoint(connection), '[::1]:5000');
  assert.strictEqual(normalizeNamespace(''), '.');
  assert.strictEqual(normalizeNamespace('analytics'), '.analytics');
  assert.strictEqual(normalizeNamespace('.analytics.market'), '.analytics.market');

  const existing = [{ ...connection, host: 'localhost' }];
  assert.throws(
    () => validateConnection({ ...connection, id: 'other', name: 'local Q' }, existing),
    /already exists/
  );
  assert.doesNotThrow(() => validateConnection({ ...connection, name: 'Renamed' }, existing, connection.id));
  assert.throws(() => validateConnection({ ...connection, host: 'http://localhost' }), /without a URL scheme or path/);
  assert.throws(() => validateConnection({ ...connection, host: 'localhost:6000' }), /without a URL scheme or path/);
  assert.throws(() => validateConnection({ ...connection, host: 'http:localhost' }), /without a URL scheme or path/);
  assert.throws(() => validateConnection({ ...connection, host: 'bad::g' }), /without a URL scheme or path/);
  assert.throws(() => validateConnection({ ...connection, host: 'exa$mple' }), /only letters/);
  assert.throws(() => validateConnection({ ...connection, host: '[localhost]' }), /only letters/);
  assert.throws(() => validateConnection({ ...connection, host: '999.999.999.999' }), /valid host name/);
  assert.throws(() => validateConnection({ ...connection, host: 'local host' }), /whitespace/);
  assert.throws(() => validateConnection({ ...connection, port: 0 }), /1 to 65535/);
  assert.throws(() => validateConnection({ ...connection, port: 1.5 }), /integer/);
  assert.throws(() => validateConnection({ ...connection, database: '.bad-name' }), /dot-separated q identifiers/);
  assert.throws(() => validateConnection({ ...connection, name: ' ' }), /name is required/);
  assert.throws(() => validateConnection({ ...connection, id: 'bad id' }), /unsupported characters/);
  assert.throws(() => validateConnection({ ...connection, username: 'user:name' }), /cannot contain colons/);
  assert.strictEqual(MAX_TIMEOUT_MS, 2147483647);
  assert.strictEqual(DEFAULT_CONNECTION_TIMEOUT_MS, 30000);
  assert.strictEqual(parseOptionalTimeout('', 'Timeout'), undefined);
  assert.strictEqual(parseOptionalTimeout('  ', 'Timeout'), undefined);
  assert.strictEqual(parseOptionalTimeout('0', 'Timeout'), 0);
  assert.strictEqual(parseOptionalTimeout(String(MAX_TIMEOUT_MS), 'Timeout'), MAX_TIMEOUT_MS);
  for (const invalid of ['-1', '1.5', '1e3', String(MAX_TIMEOUT_MS + 1), NaN, Infinity]) {
    assert.throws(() => parseOptionalTimeout(invalid, 'Timeout'), /whole number/);
  }
  assert.strictEqual(safeTimeoutMs(0, 42), 0);
  assert.strictEqual(safeTimeoutMs(MAX_TIMEOUT_MS, 42), MAX_TIMEOUT_MS);
  assert.strictEqual(safeTimeoutMs('1000', 42), 42, 'hand-edited global settings must not coerce strings');
  assert.strictEqual(safeTimeoutMs(-1, 42), 42);
  assert.strictEqual(safeTimeoutMs(MAX_TIMEOUT_MS + 1, 42), 42);

  const timedConnection = validateConnection({
    ...connection,
    connectTimeoutMs: '0',
    queryTimeoutMs: String(MAX_TIMEOUT_MS),
  });
  assert.strictEqual(timedConnection.connectTimeoutMs, 0, 'zero is an explicit disabled override');
  assert.strictEqual(timedConnection.queryTimeoutMs, MAX_TIMEOUT_MS);
  assert.deepStrictEqual(
    resolveConnectionTimeouts(connection, { connectTimeoutMs: 1200, queryTimeoutMs: 3400 }),
    { connectTimeoutMs: 1200, queryTimeoutMs: 3400 }
  );
  assert.deepStrictEqual(
    resolveConnectionTimeouts(timedConnection, { connectTimeoutMs: 1200, queryTimeoutMs: 3400 }),
    { connectTimeoutMs: 0, queryTimeoutMs: MAX_TIMEOUT_MS },
    'connection overrides, including zero, must win independently'
  );
  assert.strictEqual(connectionSessionChanged(connection, { ...connection, name: 'Renamed' }), false);
  assert.strictEqual(connectionSessionChanged(connection, { ...connection, database: '.other' }), false);
  assert.strictEqual(connectionSessionChanged(connection, { ...connection, host: 'other.example.test' }), true);
  assert.strictEqual(connectionSessionChanged(connection, { ...connection, port: 6000 }), true);
  assert.strictEqual(connectionSessionChanged(connection, { ...connection, username: 'other' }), true);
  assert.strictEqual(connectionSessionChanged(connection, { ...connection, connectTimeoutMs: 0 }), true);
  assert.strictEqual(connectionSessionChanged(connection, { ...connection, queryTimeoutMs: 0 }), true);
  assert.strictEqual(connectionSessionChanged(connection, connection, true), true);

  assert.deepStrictEqual(
    safeStoredConnections([connection, { ...connection, id: 'bad', name: 'Local q' }, null, 'bad']),
    [connection],
    'invalid or duplicate hand-edited settings must be ignored'
  );
  assert.deepStrictEqual(safeStoredConnections([timedConnection]), [timedConnection]);
  assert.deepStrictEqual(
    safeStoredConnections([{ ...connection, connectTimeoutMs: MAX_TIMEOUT_MS + 1 }]),
    [],
    'out-of-range persisted overrides must be ignored instead of reaching timers'
  );
  assert.strictEqual(qString('a"b\\c\r\n\t'), '"a\\"b\\\\c\\r\\n\\t"');
  assert.strictEqual(queryInNamespace('  select from trade\n', '.'), '  select from trade\n');

  const rawQuery = 'a:"quoted";\nselect from trade';
  const wrapped = queryInNamespace(rawQuery, 'analytics.market');
  assert.ok(wrapped.includes('system "d ",ns'));
  assert.ok(wrapped.includes('previous:string system "d"'));
  assert.ok(wrapped.includes('if[not first outcome;\'last outcome]'));
  assert.ok(wrapped.includes(qString('.analytics.market')));
  assert.ok(wrapped.includes(qString(rawQuery)), 'the raw q text must be passed as one escaped q string');

  const singleCharacter = queryInNamespace('1', '.analytics');
  assert.ok(singleCharacter.includes('src:$[-10h=type src;enlist src;src]'));
  const script = 'a:1\r\nb:2\r\na+b';
  const scriptWrapper = qScriptInNamespace(script, '.analytics');
  assert.ok(scriptWrapper.includes('.Q.ld'));
  assert.ok(scriptWrapper.includes('{[unused;expression] value expression}/[::;groups]'));
  assert.ok(scriptWrapper.includes('q 4.0 2023.03.28 or newer'));
  assert.ok(scriptWrapper.includes(qString(script)));
  assert.ok(scriptWrapper.includes(qString('.analytics')));
}

function testConnectionFormModel() {
  const saved = validateConnection({
    id: 'kx-saved',
    name: 'Saved q',
    host: 'saved.example.test',
    port: 5000,
    database: '.',
    username: 'saved-user',
    connectTimeoutMs: 2000,
  });
  const formSecret = ['form', 'secret', 'value'].join('-');
  const addOptions = {
    id: 'kx-new',
    existingConnections: [saved],
    hasStoredPassword: false,
  };
  const payload = {
    name: ' New direct q ',
    host: ' [::1] ',
    port: '6000',
    database: 'analytics.market',
    username: 'new-user',
    password: formSecret,
    clearPassword: false,
    connectTimeoutMs: '',
    queryTimeoutMs: '0',
  };
  const parsed = parseConnectionFormPayload(payload, addOptions);
  assert.deepStrictEqual(parsed.connection, {
    id: 'kx-new',
    name: 'New direct q',
    host: '::1',
    port: 6000,
    database: '.analytics.market',
    username: 'new-user',
    queryTimeoutMs: 0,
  });
  assert.strictEqual(parsed.passwordUpdate, formSecret);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(parsed.connection, 'password'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(parsed.connection, 'clearPassword'), false);
  assert.ok(!JSON.stringify(parsed.connection).includes(formSecret), 'form secrets must not enter the safe connection model');

  const inherited = parseConnectionFormPayload({
    ...payload,
    name: 'Inherited timeouts',
    password: '',
    connectTimeoutMs: '   ',
    queryTimeoutMs: '',
  }, { ...addOptions, id: 'kx-inherited' });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(inherited.connection, 'connectTimeoutMs'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(inherited.connection, 'queryTimeoutMs'), false);
  assert.strictEqual(inherited.passwordUpdate, undefined);

  const explicitBounds = parseConnectionFormPayload({
    ...payload,
    name: 'Timeout boundaries',
    password: '',
    connectTimeoutMs: '0',
    queryTimeoutMs: String(MAX_TIMEOUT_MS),
  }, { ...addOptions, id: 'kx-bounds' });
  assert.strictEqual(explicitBounds.connection.connectTimeoutMs, 0);
  assert.strictEqual(explicitBounds.connection.queryTimeoutMs, MAX_TIMEOUT_MS);

  const expectFormError = (candidate, options, field, pattern) => {
    assert.throws(
      () => parseConnectionFormPayload(candidate, options),
      error => error instanceof ConnectionFormValidationError &&
        error.field === field &&
        pattern.test(error.message),
      `expected ${String(field)} form error ${pattern}`
    );
  };
  expectFormError({ ...payload, name: 'saved Q' }, addOptions, 'name', /already exists/i);
  expectFormError({ ...payload, host: 'https://q.example.test' }, addOptions, 'host', /without a URL/i);
  expectFormError({ ...payload, port: '1.5' }, addOptions, 'port', /integer from 1 to 65535/i);
  expectFormError({ ...payload, database: '.bad-name' }, addOptions, 'database', /namespace/i);
  expectFormError({ ...payload, username: 'bad:user' }, addOptions, 'username', /cannot contain colons/i);
  expectFormError({ ...payload, connectTimeoutMs: '-1' }, addOptions, 'connectTimeoutMs', /whole number/i);
  expectFormError(
    { ...payload, queryTimeoutMs: String(MAX_TIMEOUT_MS + 1) },
    addOptions,
    'queryTimeoutMs',
    /whole number/i
  );
  expectFormError({ ...payload, clearPassword: 'false' }, addOptions, 'password', /true or false/i);
  expectFormError({ ...payload, password: 'bad\0secret' }, addOptions, 'password', /null characters/i);
  expectFormError({ ...payload, password: 'x'.repeat(65536) }, addOptions, 'password', /65535 characters/i);
  assert.throws(
    () => parseConnectionFormPayload({ ...payload, unsupported: true }, addOptions),
    error => error instanceof ConnectionFormValidationError && /unsupported field/i.test(error.message)
  );
  assert.throws(
    () => parseConnectionFormPayload(null, addOptions),
    error => error instanceof ConnectionFormValidationError && /invalid/i.test(error.message)
  );

  const editOptions = {
    id: saved.id,
    existingConnections: [saved],
    editing: saved,
    hasStoredPassword: true,
  };
  const editPayload = {
    name: saved.name,
    host: saved.host,
    port: String(saved.port),
    database: saved.database,
    username: saved.username,
    password: '',
    clearPassword: false,
    connectTimeoutMs: String(saved.connectTimeoutMs),
    queryTimeoutMs: '',
  };
  assert.strictEqual(parseConnectionFormPayload(editPayload, editOptions).passwordUpdate, undefined);
  assert.strictEqual(
    parseConnectionFormPayload({ ...editPayload, password: formSecret }, editOptions).passwordUpdate,
    formSecret
  );
  assert.strictEqual(
    parseConnectionFormPayload({ ...editPayload, clearPassword: true }, editOptions).passwordUpdate,
    null
  );
  expectFormError(
    { ...editPayload, password: formSecret, clearPassword: true },
    editOptions,
    'password',
    /not both/i
  );
  expectFormError(
    { ...editPayload, clearPassword: true },
    { ...editOptions, hasStoredPassword: false },
    'password',
    /no saved password/i
  );

  assert.strictEqual(passwordUpdateForForm('add', '', false, false), undefined);
  assert.strictEqual(passwordUpdateForForm('add', formSecret, false, false), formSecret);
  assert.strictEqual(passwordUpdateForForm('edit', '', false, true), undefined, 'blank edit keeps the secret');
  assert.strictEqual(passwordUpdateForForm('edit', formSecret, false, true), formSecret);
  assert.strictEqual(passwordUpdateForForm('edit', '', true, true), null, 'clear is explicit');
  assert.throws(() => passwordUpdateForForm('add', '', true, false), /no saved password/i);
  assert.throws(() => passwordUpdateForForm('edit', '', true, false), /no saved password/i);
}

async function testConnectionFormPanelLifecycle() {
  const panelHarness = createVscodePanelHarness();
  const {
    ConnectionFormPanel,
    initialConnectionFormValues,
  } = requireOutWithVscode('connection-form-panel', panelHarness.vscode);
  const connection = validateConnection({
    id: 'kx-panel',
    name: 'Panel q',
    host: 'panel.example.test',
    port: 5000,
    database: '.analytics',
    username: 'runner',
    connectTimeoutMs: 0,
    queryTimeoutMs: 4500,
  });
  const initial = initialConnectionFormValues(
    'edit',
    connection,
    30000,
    15000,
    true,
    ['Reserved q']
  );
  assert.strictEqual(Object.prototype.hasOwnProperty.call(initial, 'password'), false);
  assert.deepStrictEqual(initial, {
    mode: 'edit',
    name: 'Panel q',
    host: 'panel.example.test',
    port: 5000,
    database: '.analytics',
    username: 'runner',
    connectTimeoutMs: 0,
    queryTimeoutMs: 4500,
    globalConnectTimeoutMs: 30000,
    globalQueryTimeoutMs: 15000,
    hasStoredPassword: true,
    reservedNames: ['Reserved q'],
  });

  const submitted = [];
  let rejectFirstSave = true;
  const formPanel = new ConnectionFormPanel(initial, {
    async onSave(payload) {
      submitted.push(payload);
      if (rejectFirstSave) {
        rejectFirstSave = false;
        throw new ConnectionFormValidationError('Injected invalid connection name.', 'name');
      }
    },
  });
  assert.deepStrictEqual(panelHarness.created, {
    viewType: 'vscodeKdbConnection',
    title: 'KX Connection',
    column: 'active',
    options: { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
  });
  assert.ok(panelHarness.panel.webview.html.includes('<title>KX Connection</title>'));
  const session = formPanel.session;
  assert.match(session, /^[a-f0-9]{48}$/);

  await formPanel.onMessage({ type: 'ready', session: 'stale-session' });
  assert.deepStrictEqual(panelHarness.posted, [], 'messages from another panel session must be ignored');
  await formPanel.onMessage({ type: 'ready', session });
  const initialization = panelHarness.posted.find(message => message.type === 'initialize');
  assert.strictEqual(initialization.type, 'initialize');
  assert.strictEqual(initialization.maxTimeoutMs, MAX_TIMEOUT_MS);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(initialization.values, 'password'), false);
  assert.deepStrictEqual(
    panelHarness.posted.at(-1),
    { type: 'busy', busy: false },
    'a reloaded renderer must receive the current host busy state'
  );

  const rejectedPayload = { sentinel: 'invalid payload stays local until extension validation' };
  await formPanel.onMessage({ type: 'save', session, payload: rejectedPayload });
  assert.strictEqual(panelHarness.panel.disposed, false, 'validation failure must keep the form available');
  assert.strictEqual(submitted[0], rejectedPayload);
  const postedError = panelHarness.posted.find(message => message.type === 'error');
  assert.deepStrictEqual(postedError, {
    type: 'error',
    field: 'name',
    message: 'Injected invalid connection name.',
  });

  const acceptedPayload = { sentinel: 'accepted' };
  const savedCompletion = formPanel.waitForCompletion();
  await formPanel.onMessage({ type: 'save', session, payload: acceptedPayload });
  assert.strictEqual(submitted[1], acceptedPayload);
  assert.strictEqual(panelHarness.panel.disposed, true);
  assert.strictEqual(await savedCompletion, 'saved');
  await formPanel.onMessage({ type: 'save', session, payload: { sentinel: 'stale-after-dispose' } });
  assert.strictEqual(submitted.length, 2, 'disposed panels must ignore delayed webview messages');

  const deleteHarness = createVscodePanelHarness();
  const { ConnectionFormPanel: DeleteFormPanel } = requireOutWithVscode('connection-form-panel', deleteHarness.vscode);
  let deleteAllowed = false;
  let deleteAttempts = 0;
  const deletePanel = new DeleteFormPanel(initial, {
    async onSave() {},
    async onDelete() {
      deleteAttempts++;
      return deleteAllowed;
    },
  });
  await deletePanel.onMessage({ type: 'delete', session: deletePanel.session });
  assert.strictEqual(deleteAttempts, 1);
  assert.strictEqual(deleteHarness.panel.disposed, false, 'declined extension-host confirmation keeps the form');
  deleteAllowed = true;
  const deletedCompletion = deletePanel.waitForCompletion();
  await deletePanel.onMessage({ type: 'delete', session: deletePanel.session });
  assert.strictEqual(deleteAttempts, 2);
  assert.strictEqual(deleteHarness.panel.disposed, true);
  assert.strictEqual(await deletedCompletion, 'deleted');

  const cancelHarness = createVscodePanelHarness();
  const { ConnectionFormPanel: CancelFormPanel } = requireOutWithVscode('connection-form-panel', cancelHarness.vscode);
  const cancelPanel = new CancelFormPanel({ ...initial, mode: 'add', hasStoredPassword: false }, {
    async onSave() {
      throw new Error('cancel must not save');
    },
  });
  const cancelledCompletion = cancelPanel.waitForCompletion();
  await cancelPanel.onMessage({ type: 'cancel', session: cancelPanel.session });
  assert.strictEqual(cancelHarness.panel.disposed, true);
  assert.strictEqual(await cancelledCompletion, 'cancelled');

  const closeHarness = createVscodePanelHarness();
  const { ConnectionFormPanel: ClosedFormPanel } = requireOutWithVscode('connection-form-panel', closeHarness.vscode);
  const closedPanel = new ClosedFormPanel(initial, { async onSave() {} });
  const closedCompletion = closedPanel.waitForCompletion();
  closeHarness.panel.dispose();
  assert.strictEqual(await closedCompletion, 'cancelled', 'closing the tab must release command callers');
}

async function testConnectionStoreTransactions() {
  const harness = createVscodeStoreHarness();
  const { ConnectionStore } = requireOutWithVscode('connection-store', harness.vscode);
  const store = new ConnectionStore(harness.context);
  const connection = validateConnection({
    id: 'kx-transaction',
    name: 'Transactional q',
    host: 'localhost',
    port: 5000,
    database: '.',
    username: 'runner',
    connectTimeoutMs: 0,
    queryTimeoutMs: 2500,
  });
  const firstAuthValue = ['first', 'auth', 'value'].join('-');
  const nextAuthValue = ['next', 'auth', 'value'].join('-');

  harness.failSecretStore = 1;
  await assert.rejects(() => store.add(connection, firstAuthValue), /injected SecretStorage store failure/);
  assert.deepStrictEqual(harness.connections, []);
  assert.strictEqual(harness.activeId, undefined);
  assert.strictEqual(harness.secretFor(connection.id), undefined);

  await store.add(connection, firstAuthValue);
  assert.strictEqual(harness.connections.length, 1);
  assert.deepStrictEqual(
    Object.keys(harness.connections[0]).sort(),
    ['connectTimeoutMs', 'database', 'host', 'id', 'name', 'port', 'queryTimeoutMs', 'username']
  );
  assert.strictEqual(harness.connections[0].connectTimeoutMs, 0);
  assert.strictEqual(harness.connections[0].queryTimeoutMs, 2500);
  assert.strictEqual(harness.activeId, connection.id);
  assert.strictEqual(harness.secretFor(connection.id), firstAuthValue);
  assert.strictEqual(await store.hasPassword(connection.id), true);
  assert.ok(!JSON.stringify(harness.connections).includes(firstAuthValue));
  assert.ok(!JSON.stringify(harness.connections).toLocaleLowerCase().includes('password'));

  await store.update({ ...connection, name: 'Metadata-only rename' });
  assert.strictEqual(
    harness.secretFor(connection.id),
    firstAuthValue,
    'an undefined password update must keep the SecretStorage value'
  );
  await store.update(connection, nextAuthValue);
  assert.strictEqual(harness.secretFor(connection.id), nextAuthValue, 'a non-empty password must replace the secret');
  assert.ok(!JSON.stringify(harness.connections).includes(nextAuthValue));
  await store.update(connection, null);
  assert.strictEqual(harness.secretFor(connection.id), undefined, 'null must explicitly clear the saved password');
  assert.strictEqual(await store.hasPassword(connection.id), false);
  await store.update(connection, firstAuthValue);

  const { connectTimeoutMs: _connectTimeoutMs, queryTimeoutMs: _queryTimeoutMs, ...withoutOverrides } = connection;
  await store.update(withoutOverrides);
  assert.deepStrictEqual(
    Object.keys(harness.connections[0]).sort(),
    ['database', 'host', 'id', 'name', 'port', 'username'],
    'blank/inherited timeout overrides must be omitted from settings'
  );
  assert.strictEqual(harness.secretFor(connection.id), firstAuthValue);
  await store.update(connection);

  const changed = { ...connection, host: 'q.example.test' };
  harness.failSecretStore = 1;
  await assert.rejects(() => store.update(changed, nextAuthValue), /injected SecretStorage store failure/);
  assert.strictEqual(harness.connections[0].host, connection.host);
  assert.strictEqual(harness.secretFor(connection.id), firstAuthValue);

  harness.failConfigurationUpdate = 1;
  await assert.rejects(() => store.update(changed, nextAuthValue), /injected configuration update failure/);
  assert.strictEqual(harness.connections[0].host, connection.host);
  assert.strictEqual(harness.secretFor(connection.id), firstAuthValue);

  harness.failConfigurationUpdate = 2;
  await assert.rejects(
    () => store.update(changed, nextAuthValue),
    /could not fully restore the previous connection state/
  );
  assert.strictEqual(
    harness.secretFor(connection.id),
    undefined,
    'an uncertain endpoint rollback must clear the secret instead of pairing old credentials with a changed host'
  );
  await store.update(connection, firstAuthValue);

  const expected = store.connection(connection.id);
  const newer = { ...expected, name: 'Newer saved name' };
  await store.update(newer, undefined, expected);
  await assert.rejects(
    () => store.update({ ...expected, host: 'stale.example.test' }, nextAuthValue, expected),
    /changed after this form was opened/
  );
  assert.strictEqual(store.connection(connection.id).name, newer.name);
  assert.strictEqual(store.connection(connection.id).host, connection.host);
  assert.strictEqual(
    harness.secretFor(connection.id),
    firstAuthValue,
    'a stale edit must be rejected before changing SecretStorage'
  );
  await store.update(connection, undefined, newer);

  harness.failSecretDelete = 1;
  await assert.rejects(() => store.remove(connection.id), /injected SecretStorage delete failure/);
  assert.strictEqual(harness.connections.length, 1);
  assert.strictEqual(harness.activeId, connection.id);
  assert.strictEqual(harness.secretFor(connection.id), firstAuthValue);

  await store.remove(connection.id);
  assert.deepStrictEqual(harness.connections, []);
  assert.strictEqual(harness.activeId, undefined);
  assert.strictEqual(harness.secretFor(connection.id), undefined);

  const concurrentA = { ...connection, id: 'kx-concurrent-a', name: 'Concurrent A' };
  const concurrentB = { ...connection, id: 'kx-concurrent-b', name: 'Concurrent B' };
  await Promise.all([
    store.add(concurrentA, firstAuthValue),
    store.add(concurrentB, nextAuthValue),
  ]);
  assert.deepStrictEqual(
    harness.connections.map(item => item.id).sort(),
    [concurrentA.id, concurrentB.id],
    'serialized read/modify/write mutations must not lose a concurrently added profile'
  );
  assert.strictEqual(harness.secretFor(concurrentA.id), firstAuthValue);
  assert.strictEqual(harness.secretFor(concurrentB.id), nextAuthValue);
  await Promise.all([store.remove(concurrentA.id), store.remove(concurrentB.id)]);
  assert.deepStrictEqual(harness.connections, []);
  assert.strictEqual(harness.activeId, undefined);
}

async function testConnectionUpdateLifecycle() {
  const previous = validateConnection({
    id: 'kx-update-lifecycle',
    name: 'Lifecycle q',
    host: 'old.example.test',
    port: 5000,
    database: '.',
    username: 'runner',
  });

  const unchangedCalls = [];
  const unchangedManager = {
    isConnected(id) {
      unchangedCalls.push(`state:${id}`);
      return true;
    },
    async disconnect(id) {
      unchangedCalls.push(`disconnect:${id}`);
    },
    async connect(connection) {
      unchangedCalls.push(`connect:${connection.host}`);
    },
  };
  const unchanged = await persistConnectionUpdate(
    unchangedManager,
    previous,
    { ...previous, name: 'Renamed', database: '.analytics' },
    false,
    async () => unchangedCalls.push('persist')
  );
  assert.deepStrictEqual(unchanged, { sessionState: 'unchanged' });
  assert.deepStrictEqual(unchangedCalls, [`state:${previous.id}`, 'persist']);

  const failedPersistCalls = [];
  await assert.rejects(
    () => persistConnectionUpdate(
      {
        isConnected() {
          failedPersistCalls.push('state');
          return true;
        },
        async disconnect() {
          failedPersistCalls.push('disconnect');
        },
        async connect() {
          failedPersistCalls.push('connect');
        },
      },
      previous,
      { ...previous, host: 'new.example.test' },
      false,
      async () => {
        failedPersistCalls.push('persist');
        throw new Error('injected persistence failure');
      }
    ),
    /injected persistence failure/
  );
  assert.deepStrictEqual(
    failedPersistCalls,
    ['state', 'persist'],
    'validation/settings/SecretStorage failure must not disturb the active transport'
  );

  const inactiveCalls = [];
  const inactive = await persistConnectionUpdate(
    {
      isConnected() {
        return false;
      },
      async disconnect(id) {
        inactiveCalls.push(`disconnect:${id}`);
      },
      async connect() {
        inactiveCalls.push('connect');
      },
    },
    previous,
    { ...previous, connectTimeoutMs: 0 },
    false,
    async () => inactiveCalls.push('persist')
  );
  assert.deepStrictEqual(inactive, { sessionState: 'disconnected' });
  assert.deepStrictEqual(inactiveCalls, ['persist', `disconnect:${previous.id}`]);

  const reconnectCalls = [];
  const next = { ...previous, host: 'new.example.test', queryTimeoutMs: 1250 };
  const reconnected = await persistConnectionUpdate(
    {
      isConnected() {
        return true;
      },
      async disconnect(id) {
        reconnectCalls.push(`disconnect:${id}`);
      },
      async connect(connection) {
        reconnectCalls.push(`connect:${connection.host}:${connection.queryTimeoutMs}`);
      },
    },
    previous,
    next,
    false,
    async () => reconnectCalls.push('persist')
  );
  assert.deepStrictEqual(reconnected, { sessionState: 'reconnected' });
  assert.deepStrictEqual(
    reconnectCalls,
    ['persist', `disconnect:${previous.id}`, 'connect:new.example.test:1250'],
    'changed active sessions must reconnect only after the safe settings transaction commits'
  );

  const passwordCalls = [];
  const passwordOutcome = await persistConnectionUpdate(
    {
      isConnected: () => true,
      async disconnect() {
        passwordCalls.push('disconnect');
      },
      async connect(connection) {
        assert.strictEqual(connection, previous);
        passwordCalls.push('connect');
      },
    },
    previous,
    previous,
    true,
    async () => passwordCalls.push('persist-secret')
  );
  assert.deepStrictEqual(passwordOutcome, { sessionState: 'reconnected' });
  assert.deepStrictEqual(passwordCalls, ['persist-secret', 'disconnect', 'connect']);

  const reconnectFailure = new Error('injected reconnect failure');
  const reconnectFailed = await persistConnectionUpdate(
    {
      isConnected: () => true,
      async disconnect() {},
      async connect() {
        throw reconnectFailure;
      },
    },
    previous,
    { ...previous, port: 6000 },
    false,
    async () => undefined
  );
  assert.strictEqual(reconnectFailed.sessionState, 'reconnect-failed');
  assert.strictEqual(reconnectFailed.error, reconnectFailure);
}

async function testConnectionManagerLifecycle() {
  const runtimeSettings = {
    connectionTimeoutMs: 1500,
    queryTimeoutMs: 2750,
  };
  const fakeVscode = createVscodeRuntimeMock(runtimeSettings);
  class FakeKdbQError extends Error {}
  const capturedQueries = [];
  const createdClients = [];
  let nextConnectError;
  let nextQueryError;
  class FakeKdbIpcClient {
    constructor(options) {
      this.options = options;
      this.closed = false;
      this.canceled = false;
      createdClients.push(this);
    }

    async connect() {
      if (nextConnectError) {
        const error = nextConnectError;
        nextConnectError = undefined;
        throw error;
      }
    }

    async close() {
      this.closed = true;
      if (this.options.onDidClose) {
        this.options.onDidClose();
      }
    }

    cancel() {
      this.closed = true;
      this.canceled = true;
    }

    async query(query) {
      capturedQueries.push(query);
      if (nextQueryError) {
        const error = nextQueryError;
        nextQueryError = undefined;
        throw error;
      }
      return 2;
    }
  }
  const { ConnectionManager } = requireOutWithMocks('connection-manager', {
    vscode: fakeVscode,
    './q-ipc': { KdbIpcClient: FakeKdbIpcClient, KdbQError: FakeKdbQError },
  });
  const connection = validateConnection({
    id: 'kx-lifecycle',
    name: 'Lifecycle q',
    host: 'localhost',
    port: 5000,
    database: '.',
    username: '',
  });

  let passwordAttempts = 0;
  const retryManager = new ConnectionManager({
    async password() {
      passwordAttempts++;
      if (passwordAttempts === 1) {
        throw new Error('injected SecretStorage get failure');
      }
      return undefined;
    },
  });
  let stateChanges = 0;
  const stateSubscription = retryManager.onDidChangeState(() => stateChanges++);
  await assert.rejects(() => retryManager.connect(connection), /injected SecretStorage get failure/);
  const initialClient = await retryManager.connect(connection);
  assert.strictEqual(passwordAttempts, 2, 'a failed secret lookup must not poison later connection attempts');
  assert.strictEqual(retryManager.isConnected(connection.id), true);
  assert.strictEqual(initialClient.options.connectTimeoutMs, 1500);
  assert.strictEqual(initialClient.options.queryTimeoutMs, 2750);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(initialClient.options, 'timeoutMs'), false);

  const namespacedConnection = { ...connection, database: '.analytics' };
  await retryManager.execute(namespacedConnection, 'answer');
  assert.strictEqual(capturedQueries.at(-1), queryInNamespace('answer', '.analytics'));
  await retryManager.executeScript(namespacedConnection, 'a:1\na+1');
  assert.strictEqual(capturedQueries.at(-1), qScriptInNamespace('a:1\na+1', '.analytics'));

  const genuineQError = new FakeKdbQError('type');
  nextQueryError = genuineQError;
  await assert.rejects(
    () => retryManager.execute(namespacedConnection, 'badQuery'),
    error => error === genuineQError
  );
  assert.strictEqual(
    retryManager.isConnected(connection.id),
    true,
    'a genuine q error must not be converted to result data or drop a healthy connection'
  );

  nextQueryError = new Error('injected transport failure');
  await assert.rejects(() => retryManager.execute(namespacedConnection, '1+1'), /transport failure/);
  assert.strictEqual(
    retryManager.isConnected(connection.id),
    false,
    'a transport failure must immediately clear the connected tree state'
  );

  nextConnectError = new Error('injected connect failure');
  await assert.rejects(() => retryManager.connect(connection), /connect failure/);
  assert.strictEqual(retryManager.isConnected(connection.id), false, 'failed opens must not leave stale state');
  const reconnectedClient = await retryManager.connect(connection);
  assert.strictEqual(retryManager.isConnected(connection.id), true, 'a failed open must remain retryable');
  reconnectedClient.options.onDidClose();
  assert.strictEqual(
    retryManager.isConnected(connection.id),
    false,
    'a remote close callback must refresh the connection state immediately'
  );
  assert.ok(stateChanges >= 5, 'connection lifecycle transitions must emit tree refresh events');

  await retryManager.disconnectAll();
  assert.strictEqual(retryManager.isConnected(connection.id), false);
  stateSubscription.dispose();
  retryManager.dispose();

  let resolvePassword;
  const delayedPassword = new Promise(resolve => {
    resolvePassword = resolve;
  });
  const delayedManager = new ConnectionManager({ password: () => delayedPassword });
  const opening = delayedManager.connect(connection);
  const openingRejected = assert.rejects(opening, /connection canceled/i);
  await Promise.resolve();
  const disconnected = delayedManager.disconnectAll();
  resolvePassword(undefined);
  await Promise.all([openingRejected, disconnected]);
  assert.strictEqual(delayedManager.isConnected(connection.id), false);
  delayedManager.dispose();

  const timeoutManager = new ConnectionManager({ password: async () => 'secret-from-storage' });
  assert.deepStrictEqual(timeoutManager.globalTimeouts(), {
    connectTimeoutMs: 1500,
    queryTimeoutMs: 2750,
  });
  assert.deepStrictEqual(timeoutManager.timeoutsFor({
    ...connection,
    connectTimeoutMs: 0,
    queryTimeoutMs: MAX_TIMEOUT_MS,
  }), {
    connectTimeoutMs: 0,
    queryTimeoutMs: MAX_TIMEOUT_MS,
  });

  const inheritedClient = await timeoutManager.connect(connection);
  assert.strictEqual(inheritedClient.options.password, 'secret-from-storage');
  assert.strictEqual(inheritedClient.options.connectTimeoutMs, 1500);
  assert.strictEqual(inheritedClient.options.queryTimeoutMs, 2750);
  assert.strictEqual(
    await timeoutManager.connect({ ...connection, name: 'Display rename', database: '.analytics' }),
    inheritedClient,
    'display/namespace-only edits must keep the healthy direct session'
  );

  const oldCloseCallback = inheritedClient.options.onDidClose;
  const changedRuntime = {
    ...connection,
    host: 'replacement.example.test',
    connectTimeoutMs: 0,
    queryTimeoutMs: 9750,
  };
  const replacementClient = await timeoutManager.connect(changedRuntime);
  assert.notStrictEqual(replacementClient, inheritedClient);
  assert.strictEqual(inheritedClient.closed, true, 'a signature change must close the stale client first');
  assert.strictEqual(replacementClient.options.host, changedRuntime.host);
  assert.strictEqual(replacementClient.options.connectTimeoutMs, 0);
  assert.strictEqual(replacementClient.options.queryTimeoutMs, 9750);
  oldCloseCallback();
  assert.strictEqual(
    timeoutManager.isConnected(connection.id),
    true,
    'a delayed close callback from the old client must not drop its replacement'
  );
  await timeoutManager.disconnectIfConfigurationChanged(connection.id, changedRuntime);
  assert.strictEqual(timeoutManager.isConnected(connection.id), true, 'matching settings must keep the session');

  const globallyConfigured = validateConnection({
    ...connection,
    id: 'kx-global-timeouts',
    name: 'Global timeout q',
  });
  const globalClient = await timeoutManager.connect(globallyConfigured);
  runtimeSettings.queryTimeoutMs = 3250;
  await timeoutManager.disconnectIfConfigurationChanged(globallyConfigured.id, globallyConfigured);
  assert.strictEqual(globalClient.closed, true);
  assert.strictEqual(
    timeoutManager.isConnected(globallyConfigured.id),
    false,
    'a changed inherited global timeout must invalidate the old session signature'
  );

  const beforeTestCount = createdClients.length;
  await timeoutManager.test(changedRuntime);
  assert.strictEqual(createdClients.length, beforeTestCount + 1);
  const testClient = createdClients.at(-1);
  assert.strictEqual(testClient.options.connectTimeoutMs, 0);
  assert.strictEqual(testClient.options.queryTimeoutMs, 9750);
  assert.strictEqual(testClient.closed, true, 'test connections must always be temporary');

  runtimeSettings.connectionTimeoutMs = 4321;
  runtimeSettings.queryTimeoutMs = null;
  assert.deepStrictEqual(
    timeoutManager.globalTimeouts(),
    { connectTimeoutMs: 4321, queryTimeoutMs: 4321 },
    'null query timeout must preserve the pre-0.1.3 connectionTimeoutMs behavior'
  );
  runtimeSettings.connectionTimeoutMs = MAX_TIMEOUT_MS + 1;
  runtimeSettings.queryTimeoutMs = -1;
  assert.deepStrictEqual(
    timeoutManager.globalTimeouts(),
    { connectTimeoutMs: DEFAULT_CONNECTION_TIMEOUT_MS, queryTimeoutMs: DEFAULT_CONNECTION_TIMEOUT_MS },
    'invalid hand-edited global values must resolve to bounded safe defaults'
  );
  await timeoutManager.disconnectAll();
  timeoutManager.dispose();
}

function testColumnarResults() {
  let reads = 0;
  const millionRows = createColumnarPanelResult(['id', 'value', 'note'], 1_000_000, (row, column) => {
    reads++;
    return column === 0 ? row : column === 1 ? row * 2 : `row ${row}`;
  });
  assert.deepStrictEqual(
    millionRows.cellWindow({ start: 999_998, end: 999_999 }, { start: 0, end: 1 }),
    {
      startRow: 999_998,
      endRow: 999_999,
      startColumn: 0,
      endColumn: 1,
      cells: [['999998', '1999996'], ['999999', '1999998']],
    }
  );
  assert.strictEqual(reads, 4, 'a visible window must not materialize the full result');
  assert.deepStrictEqual(
    millionRows.cellWindow({ start: -5, end: 0 }, { start: 2, end: 99 }).cells,
    [['row 0']]
  );

  const result = rowsToColumnarPanelResult([
    { sym: 'AAPL', note: 'line\nbreak', nums: [1, 2, 3] },
    { sym: 'MSFT', note: null, nums: [4, 5] },
  ], ['sym', 'note', 'nums']);
  assert.deepStrictEqual(
    result.cellWindow({ start: 0, end: 1 }, { start: 1, end: 2 }).cells,
    [['line break', '1, 2, 3'], ['', '4, 5']]
  );
  assert.deepStrictEqual(
    result.cellWindow({ start: 0, end: 0 }, { start: 2, end: 2 }, { arrayDisplayFormat: 'raw' }).cells,
    [['[1 2 3]']]
  );
  const range = { startRow: 0, endRow: 1, startColumn: 0, endColumn: 2 };
  assert.strictEqual(
    result.toText('csv', range, { includeHeaders: true, includeRowIndex: true }),
    '#,sym,note,nums\n1,AAPL,"line\nbreak","1, 2, 3"\n2,MSFT,,"4, 5"'
  );
  assert.strictEqual(
    result.toText('json', range, { includeRowIndex: true }),
    '[{"#":1,"sym":"AAPL","note":"line\\nbreak","nums":[1,2,3]},{"#":2,"sym":"MSFT","note":null,"nums":[4,5]}]'
  );
  assert.strictEqual(
    result.toText('markdown', { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 }, true),
    '| sym | note |\n| --- | --- |\n| AAPL | line<br>break |'
  );
}

async function testLocalDataServerConcurrency() {
  const { LocalDataServer } = requireOut('local-data-server');
  const preferredPort = await unusedLoopbackPort();
  const server = new LocalDataServer({
    preferredPort,
    provider: { current: () => null },
  });
  try {
    const [first, second] = await Promise.all([server.start(), server.start()]);
    assert.deepStrictEqual(second, first, 'concurrent starts must share one listener and token');
    assert.strictEqual(server.running, true);
    await server.stop();
    assert.strictEqual(server.running, false);
    await assert.rejects(() => connectToLoopback(first.port), /ECONNREFUSED|closed before connect/);

    const starting = server.start();
    const stopping = server.stop();
    await Promise.all([starting, stopping]);
    assert.strictEqual(server.running, false, 'stop during start must close the listener that finishes opening');
  } finally {
    await server.stop();
  }
}

function testManifestAndSources() {
  const manifestPath = path.join(ROOT, 'package.json');
  assert.ok(fs.existsSync(manifestPath), 'package.json is missing; run this test after the extension scaffold is present');
  const manifestSource = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestSource);

  assert.strictEqual(manifest.name, 'vscode-kdb');
  assert.strictEqual(manifest.displayName, 'KX for VS Code');
  assert.strictEqual(manifest.publisher, 'DanielAlonso');
  assert.strictEqual(manifest.version, '0.1.3');
  const packageLock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  assert.strictEqual(packageLock.version, '0.1.3');
  assert.strictEqual(packageLock.packages[''].version, '0.1.3');
  assert.strictEqual(manifest.icon, 'icons/kx-marketplace.png');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(manifest, 'files'), false, 'package via .vscodeignore, not files');
  assert.ok(!manifest.extensionDependencies || manifest.extensionDependencies.length === 0);
  assert.ok(!/@sqltools\//i.test(manifestSource), 'package.json must not reference @sqltools packages');
  assert.ok(!/sqltools\.connections/i.test(manifestSource), 'package.json must not contribute legacy connection settings');

  const dependencies = {
    ...(manifest.dependencies || {}),
    ...(manifest.devDependencies || {}),
  };
  assert.strictEqual(Object.keys(dependencies).some(name => /^@sqltools\//i.test(name)), false);

  const commands = (((manifest.contributes || {}).commands) || []);
  assert.strictEqual(commands.some(command => /^sqltools\./i.test(String(command.command || ''))), false);
  const commandTitles = new Set(commands.map(command => command.title));
  [
    'KX: Add Connection',
    'KX: Edit Connection',
    'KX: Remove Connection',
    'KX: Set Active Connection',
    'KX: Connect',
    'KX: Disconnect',
    'KX: Test Connection',
    'KX: Run Selection / Current Line',
    'KX: Run q Script',
    'KX: Run Selection in New Result',
  ].forEach(title => assert.ok(commandTitles.has(title), `missing command contribution: ${title}`));

  const contributedCommandIds = new Set(commands.map(command => String(command.command)));
  const registeredCommandIds = new Set();
  for (const [, source] of sourcesFromDirectory(path.join(ROOT, 'src'))) {
    for (const match of source.matchAll(/registerCommand\(\s*['"]([^'"]+)['"]/g)) {
      registeredCommandIds.add(match[1]);
    }
  }
  assert.deepStrictEqual(
    [...registeredCommandIds].sort(),
    [...contributedCommandIds].sort(),
    'contributed and registered command IDs must match exactly'
  );
  const activatedCommandIds = new Set((manifest.activationEvents || [])
    .filter(event => String(event).startsWith('onCommand:'))
    .map(event => String(event).slice('onCommand:'.length)));
  assert.deepStrictEqual(
    [...activatedCommandIds].sort(),
    [...contributedCommandIds].sort(),
    'every command must have an explicit activation event'
  );

  const commandByTitle = Object.fromEntries(commands.map(command => [command.title, command.command]));
  const keybindings = ((manifest.contributes || {}).keybindings) || [];
  assertKeybinding(keybindings, commandByTitle['KX: Run Selection / Current Line'], 'ctrl+enter', 'cmd+enter');
  assertKeybinding(keybindings, commandByTitle['KX: Run q Script'], 'ctrl+alt+enter', 'cmd+alt+enter');
  assertKeybinding(keybindings, commandByTitle['KX: Run Selection in New Result'], 'ctrl+shift+enter', 'cmd+shift+enter');

  const contributions = manifest.contributes || {};
  const activityContainers = (((contributions.viewsContainers || {}).activitybar) || []);
  assert.ok(activityContainers.some(container => container.title === 'KX' && container.icon === 'icons/kx-activity.png'));
  const viewGroups = Object.values(contributions.views || {}).flat();
  assert.ok(viewGroups.some(view => view && view.name === 'KX Connections'));

  const configuration = Array.isArray(contributions.configuration)
    ? contributions.configuration
    : [contributions.configuration || {}];
  const configurationProperties = Object.assign({}, ...configuration.map(item => item.properties || {}));
  const connectionsSetting = configurationProperties['vscode-kdb.connections'];
  assert.ok(connectionsSetting, 'vscode-kdb.connections must be globally configurable');
  assert.strictEqual(connectionsSetting.type, 'array');
  const storedFields = Object.keys(((connectionsSetting.items || {}).properties) || {}).sort();
  assert.deepStrictEqual(
    storedFields,
    ['connectTimeoutMs', 'database', 'host', 'id', 'name', 'port', 'queryTimeoutMs', 'username']
  );
  assert.strictEqual(connectionsSetting.items.additionalProperties, false);
  assert.deepStrictEqual(
    [...connectionsSetting.items.required].sort(),
    ['database', 'host', 'id', 'name', 'port', 'username'],
    'timeout overrides must stay optional/blank-to-inherit'
  );
  assert.match(connectionsSetting.description, /direct q IPC/i);
  assert.match(connectionsSetting.description, /SecretStorage/);
  for (const timeoutField of ['connectTimeoutMs', 'queryTimeoutMs']) {
    const schema = connectionsSetting.items.properties[timeoutField];
    assert.strictEqual(schema.type, 'integer');
    assert.strictEqual(schema.minimum, 0);
    assert.strictEqual(schema.maximum, MAX_TIMEOUT_MS);
    assert.match(schema.description, /inherit the global default/i);
  }
  assert.match(connectionsSetting.items.properties.connectTimeoutMs.description, /handshake/i);
  assert.match(connectionsSetting.items.properties.connectTimeoutMs.description, /0 disables/i);
  assert.match(connectionsSetting.items.properties.queryTimeoutMs.description, /query/i);
  assert.match(connectionsSetting.items.properties.queryTimeoutMs.description, /0 disables/i);

  const connectTimeoutSetting = configurationProperties['vscode-kdb.connectionTimeoutMs'];
  assert.strictEqual(connectTimeoutSetting.type, 'integer');
  assert.strictEqual(connectTimeoutSetting.default, DEFAULT_CONNECTION_TIMEOUT_MS);
  assert.strictEqual(connectTimeoutSetting.minimum, 0);
  assert.strictEqual(connectTimeoutSetting.maximum, MAX_TIMEOUT_MS);
  assert.match(connectTimeoutSetting.description, /connect and handshake/i);
  assert.match(connectTimeoutSetting.description, /0 to disable/i);
  const queryTimeoutSetting = configurationProperties['vscode-kdb.queryTimeoutMs'];
  assert.deepStrictEqual(queryTimeoutSetting.type, ['integer', 'null']);
  assert.strictEqual(queryTimeoutSetting.default, null);
  assert.strictEqual(queryTimeoutSetting.minimum, 0);
  assert.strictEqual(queryTimeoutSetting.maximum, MAX_TIMEOUT_MS);
  assert.match(queryTimeoutSetting.description, /inherits connectionTimeoutMs/i);
  assert.match(queryTimeoutSetting.description, /0 disables/i);
  const performanceTraceSetting = configurationProperties['vscode-kdb.performance.trace'];
  assert.strictEqual(performanceTraceSetting.type, 'boolean');
  assert.strictEqual(performanceTraceSetting.default, false);
  assert.match(performanceTraceSetting.description, /Output > KX/);
  assert.match(performanceTraceSetting.description, /Query text and credentials are omitted/);
  assert.strictEqual(Object.keys(configurationProperties).some(key => /^sqltools\./i.test(key)), false);

  const sourceFiles = walkFiles(path.join(ROOT, 'src')).filter(file => file.endsWith('.ts'));
  assert.ok(sourceFiles.length >= 5, 'expected standalone TypeScript implementation files');
  const sources = sourceFiles.map(file => [file, fs.readFileSync(file, 'utf8')]);
  sources.forEach(([file, source]) => assertNoSqlToolsRuntimeReference(source, path.relative(ROOT, file)));

  const storeSource = readSource('connection-store.ts');
  assert.ok(/context\.secrets\.(store|get|delete)/.test(storeSource), 'passwords must use VS Code SecretStorage');
  assert.ok(storeSource.includes('ConfigurationTarget.Global'), 'connections must use global settings');
  const safeBlock = sourceSection(storeSource, 'const safeConnections', 'await vscode.workspace');
  assert.ok(safeBlock.includes('username: connection.username'));
  assert.ok(safeBlock.includes('connectTimeoutMs: connection.connectTimeoutMs'));
  assert.ok(safeBlock.includes('queryTimeoutMs: connection.queryTimeoutMs'));
  assert.ok(!/password/i.test(safeBlock), 'serialized connection settings must never include passwords');
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(connectionsSetting.items.properties, 'password'),
    false,
    'password must never be a vscode-kdb.connections property'
  );

  const panelSource = readSource('connection-form-panel.ts');
  const commandsSource = readSource('connection-commands.ts');
  const modelSource = readSource('connection-form-model.ts');
  const extensionSource = readSource('extension.ts');
  const htmlSection = sourceSection(panelSource, 'export function connectionFormHtml', 'function isRecord');
  const interpolations = [...htmlSection.matchAll(/\$\{([^}]+)\}/g)].map(match => match[1]);
  assert.deepStrictEqual(
    [...new Set(interpolations)].sort(),
    ['DEFAULT_NAMESPACE', 'cspSource', 'nonce', 'session'],
    'static webview HTML may interpolate only extension-owned CSP/session/default values'
  );
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(panelSource));
  assert.ok(!/\$\{\s*(?:initial|values|connection|payload)/.test(htmlSection));
  assert.match(panelSource, /message\.session\s*!==\s*this\.session/);
  assert.match(panelSource, /this\.disposed\s*\|\|\s*!isRecord\(value\)/);
  assert.match(panelSource, /typeof message\.type\s*!==\s*'string'/);
  assert.match(panelSource, /public waitForCompletion\(\): Promise<ConnectionFormResult>/);
  assert.match(panelSource, /this\.finish\('cancelled'\)/);
  assert.match(panelSource, /localResourceRoots: \[\]/);

  const htmlHarness = createVscodePanelHarness();
  const {
    connectionFormHtml,
    initialConnectionFormValues,
  } = requireOutWithVscode('connection-form-panel', htmlHarness.vscode);
  const formHtml = connectionFormHtml(
    'vscode-webview://connection-form-source-test',
    'fixed-test-nonce',
    'fixed-test-session'
  );
  assert.match(formHtml, /<title>KX Connection<\/title>/);
  assert.match(formHtml, /default-src 'none'/);
  assert.match(formHtml, /var\(--vscode-editor-background\)/);
  assert.match(formHtml, /<form id="connectionForm" aria-labelledby="formTitle">/);
  const formControls = [
    ['name', 'Connection name'],
    ['host', 'Host'],
    ['port', 'Port'],
    ['database', 'Namespace / database'],
    ['username', 'Username'],
    ['password', 'Password'],
    ['connectTimeoutMs', 'Connect / handshake timeout (ms)'],
    ['queryTimeoutMs', 'Query timeout (ms)'],
  ];
  formControls.forEach(([id, label]) => {
    assert.ok(formHtml.includes(`<label for="${id}">${label}`), `missing visible label for ${id}`);
    assert.ok(formHtml.includes(`id="${id}"`), `missing ${id} form control`);
  });
  assert.match(formHtml, /id="password"[^>]*type="password"/);
  assert.match(formHtml, /Leave blank to keep the saved password/);
  assert.match(formHtml, /Clear saved password/);
  assert.match(formHtml, /<details id="advanced">/);
  assert.match(formHtml, /<summary>Advanced direct q IPC<\/summary>/);
  assert.match(formHtml, /blank to use its global default/i);
  assert.match(formHtml, /Use <code>0<\/code> to disable/i);
  assert.match(formHtml, /TCP connect and q IPC handshake/i);
  assert.match(formHtml, /timer starts when (?:this connection sends|the query is sent)/i);
  assert.match(formHtml, /id="formError"[^>]*role="alert"[^>]*aria-live="assertive"[^>]*tabindex="-1"/);
  assert.match(formHtml, /id="save"[^>]*type="submit"[^>]*>Save Connection<\/button>/);
  assert.match(formHtml, /id="cancel"[^>]*>Cancel<\/button>/);
  assert.match(formHtml, /id="delete"[^>]*>Delete Connection<\/button>/);
  assert.match(formHtml, /form\.addEventListener\('submit'/);
  assert.match(formHtml, /event\.key === 'Escape'/);
  assert.match(formHtml, /window\.setTimeout\(\(\) => controls\.name\.focus\(\)/);
  assert.match(formHtml, /controls\.password\.value = ''/);
  assert.match(formHtml, /\.textContent =/);
  assert.match(formHtml, /serverErrorField/);
  assert.match(formHtml, /setCustomValidity\(serverErrorMessage\)/);
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\bconfirm\s*\(/.test(formHtml));
  const inlineScript = formHtml.match(/<script nonce="fixed-test-nonce">([\s\S]*?)<\/script>/);
  assert.ok(inlineScript, 'connection form inline script is missing');
  assert.doesNotThrow(() => new Function(inlineScript[1]), 'connection form inline script must parse');

  const hostileName = '<img src=x onerror=alert(1)>';
  const hostileInitial = initialConnectionFormValues(
    'edit',
    { id: 'kx-hostile', name: hostileName, host: 'localhost', port: 5000, database: '.', username: '' },
    30000,
    30000,
    true,
    []
  );
  assert.strictEqual(hostileInitial.name, hostileName);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(hostileInitial, 'password'), false);
  assert.ok(!formHtml.includes(hostileName), 'user values must be assigned through DOM value/textContent, not raw HTML');

  assert.ok(!/showInputBox/.test(commandsSource), 'Add/Edit must not use sequential input boxes');
  assert.match(commandsSource, /registerCommand\('vscode-kdb\.addConnection'/);
  assert.match(commandsSource, /registerCommand\('vscode-kdb\.editConnection'/);
  assert.match(commandsSource, /public async add\(\)[\s\S]*?openConnectionForm\(\)/);
  assert.match(commandsSource, /public async edit\([\s\S]*?openConnectionForm\(connection\)/);
  assert.match(commandsSource, /const panel = new ConnectionFormPanel\(initial/);
  assert.match(commandsSource, /await panel\.waitForCompletion\(\)/);
  assert.match(commandsSource, /private activeForm: ConnectionFormPanel \| undefined/);
  assert.match(commandsSource, /this\.activeForm\.reveal\(\)/);
  assert.match(commandsSource, /parseConnectionFormPayload\(payload/);
  assert.match(commandsSource, /persistConnectionUpdate\(/);
  assert.match(commandsSource, /showWarningMessage\([\s\S]*?\{ modal: true \}[\s\S]*?'Delete Connection'/);
  assert.ok(!/\bconfirm\s*\(/.test(commandsSource), 'delete confirmation must stay in the extension host');
  assert.match(modelSource, /FORM_FIELDS/);
  assert.match(modelSource, /unsupported field/);
  assert.match(storeSource, /private mutationQueue: Promise<void>/);
  assert.match(storeSource, /return this\.mutate\(async \(\) =>/);
  assert.match(extensionSource, /disconnectIfConfigurationChanged/);
  assert.match(extensionSource, /vscode-kdb\.connectionTimeoutMs/);
  assert.match(extensionSource, /vscode-kdb\.queryTimeoutMs/);

  const vscodeIgnore = fs.readFileSync(path.join(ROOT, '.vscodeignore'), 'utf8');
  [
    'src/**',
    'test/**',
    'tmp/**',
    'docs/**',
    'mkdocs-src/**',
    'mkdocs.yml',
    'PARITY.md',
    '**/*.map',
    'CODEX*',
    'PROMPT*',
    '*.vsix',
    '*.zip',
  ].forEach(pattern => {
    assert.ok(vscodeIgnore.includes(pattern), `.vscodeignore must exclude ${pattern}`);
  });
}

function requireOut(moduleName) {
  const candidates = [
    path.join(ROOT, 'out', moduleName),
    path.join(ROOT, 'out', 'src', moduleName),
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      if (error && error.code !== 'MODULE_NOT_FOUND') {
        throw error;
      }
    }
  }
  throw new Error(`Compiled module out/${moduleName}.js is missing. Run npm run compile first.`);
}

function requireOutWithVscode(moduleName, vscode) {
  return requireOutWithMocks(moduleName, { vscode });
}

function requireOutWithMocks(moduleName, mocks) {
  const candidates = [
    path.join(ROOT, 'out', moduleName),
    path.join(ROOT, 'out', 'src', moduleName),
  ];
  for (const candidate of candidates) {
    let resolved;
    try {
      resolved = require.resolve(candidate);
    } catch (error) {
      if (error && error.code === 'MODULE_NOT_FOUND') {
        continue;
      }
      throw error;
    }
    delete require.cache[resolved];
    const originalLoad = Module._load;
    Module._load = function loadWithMocks(request, parent, isMain) {
      return Object.prototype.hasOwnProperty.call(mocks, request)
        ? mocks[request]
        : originalLoad.call(this, request, parent, isMain);
    };
    try {
      return require(resolved);
    } finally {
      Module._load = originalLoad;
    }
  }
  throw new Error(`Compiled module out/${moduleName}.js is missing. Run npm run compile first.`);
}

function createVscodeRuntimeMock(settings = {}) {
  class EventEmitter {
    constructor() {
      this.listeners = new Set();
      this.event = listener => {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
      };
    }

    fire(value) {
      this.listeners.forEach(listener => listener(value));
    }

    dispose() {
      this.listeners.clear();
    }
  }
  return {
    EventEmitter,
    workspace: {
      getConfiguration() {
        return {
          get(key, fallback) {
            return Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : fallback;
          },
        };
      },
    },
  };
}

function createVscodePanelHarness() {
  const disposeListeners = new Set();
  const messageListeners = new Set();
  const posted = [];
  const webview = {
    cspSource: 'vscode-webview://connection-form-test',
    html: '',
    async postMessage(message) {
      posted.push(message);
      return true;
    },
    onDidReceiveMessage(listener) {
      messageListeners.add(listener);
      return { dispose: () => messageListeners.delete(listener) };
    },
  };
  const panel = {
    webview,
    disposed: false,
    onDidDispose(listener) {
      disposeListeners.add(listener);
      return { dispose: () => disposeListeners.delete(listener) };
    },
    dispose() {
      if (panel.disposed) {
        return;
      }
      panel.disposed = true;
      [...disposeListeners].forEach(listener => listener());
    },
  };
  const harness = {
    posted,
    panel,
    created: undefined,
    vscode: {
      ViewColumn: { Active: 'active' },
      window: {
        createWebviewPanel(viewType, title, column, options) {
          harness.created = { viewType, title, column, options };
          return panel;
        },
      },
    },
  };
  return harness;
}

function createVscodeStoreHarness() {
  const state = {
    activeId: undefined,
    connections: [],
    secrets: new Map(),
    failSecretStore: 0,
    failSecretDelete: 0,
    failConfigurationUpdate: 0,
  };
  const configuration = {
    inspect(key) {
      assert.strictEqual(key, 'connections');
      return { globalValue: cloneJson(state.connections) };
    },
    async update(key, value, target) {
      assert.strictEqual(key, 'connections');
      assert.strictEqual(target, 'global');
      if (state.failConfigurationUpdate > 0) {
        state.failConfigurationUpdate--;
        throw new Error('injected configuration update failure');
      }
      state.connections = cloneJson(value);
    },
  };
  const context = {
    globalState: {
      get() {
        return state.activeId;
      },
      async update(_key, value) {
        state.activeId = value;
      },
    },
    secrets: {
      async get(key) {
        return state.secrets.get(key);
      },
      async store(key, value) {
        if (state.failSecretStore > 0) {
          state.failSecretStore--;
          throw new Error('injected SecretStorage store failure');
        }
        state.secrets.set(key, value);
      },
      async delete(key) {
        if (state.failSecretDelete > 0) {
          state.failSecretDelete--;
          throw new Error('injected SecretStorage delete failure');
        }
        state.secrets.delete(key);
      },
    },
  };
  const harness = {
    vscode: {
      ConfigurationTarget: { Global: 'global' },
      workspace: { getConfiguration: () => configuration },
    },
    context,
    get connections() {
      return cloneJson(state.connections);
    },
    get activeId() {
      return state.activeId;
    },
    set failSecretStore(value) {
      state.failSecretStore = value;
    },
    set failSecretDelete(value) {
      state.failSecretDelete = value;
    },
    set failConfigurationUpdate(value) {
      state.failConfigurationUpdate = value;
    },
    secretFor(id) {
      return state.secrets.get(`vscode-kdb.connectionPassword.${id}`);
    },
  };
  return harness;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function hex(value) {
  return Buffer.from(value.replace(/\s/g, ''), 'hex');
}

function qTable(columns, vectors) {
  return Buffer.concat([
    int8(98),
    Buffer.from([0]),
    int8(99),
    symbolVector(columns),
    genericList(vectors),
  ]);
}

function qResponse(payload) {
  const message = Buffer.alloc(8 + payload.length);
  message.writeUInt8(1, 0);
  message.writeUInt8(2, 1);
  message.writeInt32LE(message.length, 4);
  payload.copy(message, 8);
  return message;
}

function genericList(items) {
  return Buffer.concat([vectorHeader(0, items.length), ...items]);
}

function symbolVector(values) {
  return Buffer.concat([vectorHeader(11, values.length), ...values.map(value => cString(value))]);
}

function intVector(values) {
  const body = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => body.writeInt32LE(value, index * 4));
  return Buffer.concat([vectorHeader(6, values.length), body]);
}

function vectorHeader(type, length) {
  const header = Buffer.alloc(6);
  header.writeInt8(type, 0);
  header.writeUInt8(0, 1);
  header.writeInt32LE(length, 2);
  return header;
}

function int8(value) {
  const result = Buffer.alloc(1);
  result.writeInt8(value, 0);
  return result;
}

function cString(value) {
  return Buffer.from(`${value}\0`, 'utf8');
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function assertCompletesWithin(label, operation, timeoutMs) {
  let timeout;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} did not complete within ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function unusedLoopbackPort() {
  const server = net.createServer();
  await listen(server);
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  await closeServer(server);
  return port;
}

function connectToLoopback(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve();
    });
    socket.once('error', reject);
  });
}

function assertKeybinding(keybindings, command, key, mac) {
  const binding = keybindings.find(candidate => candidate.command === command);
  assert.ok(binding, `missing keybinding for ${command}`);
  assert.strictEqual(String(binding.key).toLowerCase(), key);
  assert.strictEqual(String(binding.mac).toLowerCase(), mac);
  assert.match(String(binding.when || ''), /editorTextFocus/);
  assert.match(String(binding.when || ''), /q/);
}

function assertNoSqlToolsRuntimeReference(source, label) {
  const forbidden = [
    /@sqltools\//i,
    /sqltools\.connections/i,
    /["']sqltools\./i,
    /\.session\.sql/i,
    /kdb-sqltools/i,
  ];
  forbidden.forEach(pattern => assert.ok(!pattern.test(source), `${label} contains forbidden standalone dependency/path ${pattern}`));
}

function walkFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(target) : [target];
  });
}

function sourcesFromDirectory(directory) {
  return walkFiles(directory)
    .filter(file => file.endsWith('.ts'))
    .map(file => [file, fs.readFileSync(file, 'utf8')]);
}

function readSource(fileName) {
  return fs.readFileSync(path.join(ROOT, 'src', fileName), 'utf8');
}

function sourceSection(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, `cannot find source section ${startNeedle} .. ${endNeedle}`);
  return source.slice(start, end);
}
