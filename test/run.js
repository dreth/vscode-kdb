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
  queryInNamespaceStrict,
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
const {
  DEFAULT_SERVER_PREVIEW_CELL_LIMIT,
  MAX_SERVER_PREVIEW_CELL_LIMIT,
  MIN_SERVER_PREVIEW_CELL_LIMIT,
  SERVER_TABLES_QUERY,
  SERVER_VARIABLES_QUERY,
  buildServerPreviewQuery,
  buildServerTableMetaQuery,
  parseServerColumns,
  parseServerTableNames,
  parseServerVariables,
  qMetaTypeName,
  safeServerPreviewCellLimit,
  serverExplorerSnapshotMatches,
  serverPreviewWarning,
  validateServerObjectIdentifier,
} = requireOut('server-explorer-model');
const {
  DEFAULT_QUERY_HISTORY_MAX_ENTRIES,
  MAX_QUERY_HISTORY_MAX_ENTRIES,
  MIN_QUERY_HISTORY_MAX_ENTRIES,
  QUERY_HISTORY_STORAGE_KEY,
  QueryHistoryStore,
  historyRerunRequiresConfirmation,
  historyTransportKind,
  normalizeQueryHistoryEntries,
  normalizeQueryHistoryEntry,
  safeHistoryLimit,
  sortHistoryNewestFirst,
} = requireOut('query-history-model');

const tests = [
  ['q IPC codec and receive buffering', testQIpc],
  ['diagnostics and performance trace redaction', testDiagnostics],
  ['exact q selection/current-line text', testQText],
  ['connection validation and namespace wrapping', testConnections],
  ['server explorer request and metadata model', testServerExplorerModel],
  ['query history privacy and persistence model', testQueryHistoryModel],
  ['webview-free server and history tree providers', testTreeProviders],
  ['feature controls enable and disable lifecycle', testFeatureControlsLifecycle],
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

  const queuedSockets = [];
  const queuedFrames = [];
  const frameArrivals = [deferred(), deferred(), deferred()];
  const queueServer = net.createServer(socket => {
    queuedSockets.push(socket);
    let handshakeComplete = false;
    let buffered = Buffer.alloc(0);
    socket.on('data', chunk => {
      if (!handshakeComplete) {
        handshakeComplete = true;
        socket.write(Buffer.from([3]));
        return;
      }

      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 8) {
        const messageLength = buffered.readInt32LE(4);
        if (messageLength < 8) {
          socket.destroy(new Error(`invalid test q IPC frame length ${messageLength}`));
          return;
        }
        if (buffered.length < messageLength) {
          return;
        }
        const frame = buffered.subarray(0, messageLength);
        buffered = buffered.subarray(messageLength);
        const index = queuedFrames.push(frame) - 1;
        frameArrivals[index]?.resolve(socket);
      }
    });
  });
  await listen(queueServer);
  const queueAddress = queueServer.address();
  const queuePort = queueAddress && typeof queueAddress === 'object' ? queueAddress.port : 0;
  const queueClient = new KdbIpcClient({
    host: '127.0.0.1',
    port: queuePort,
    connectTimeoutMs: 1000,
    queryTimeoutMs: 1000,
  });
  const issued = [];
  const scalarResponse = hex('010200000d000000fa01000000');
  try {
    await queueClient.connect();
    const firstQuery = queueClient.query('first-boundary', () => issued.push('first'));
    const secondQuery = queueClient.query('second-boundary', () => issued.push('second'));
    const queueSocket = await assertCompletesWithin(
      'first queued q IPC write',
      () => frameArrivals[0].promise,
      1000
    );
    assert.deepStrictEqual(issued, ['first']);
    assert.strictEqual(queuedFrames.length, 1, 'only the active request may reach socket.write');
    assert.deepStrictEqual(queuedFrames[0], serializeTextQuery('first-boundary'));

    queueSocket.write(scalarResponse);
    assert.strictEqual(await firstQuery, 1);
    await assertCompletesWithin('second queued q IPC write', () => frameArrivals[1].promise, 1000);
    assert.deepStrictEqual(
      issued,
      ['first', 'second'],
      'a queued history observer must not fire until that request reaches socket.write'
    );
    assert.strictEqual(queuedFrames.length, 2);
    assert.deepStrictEqual(queuedFrames[1], serializeTextQuery('second-boundary'));
    queueSocket.write(scalarResponse);
    assert.strictEqual(await secondQuery, 1);

    const throwingObserverQuery = queueClient.query('observer-cannot-break-write', () => {
      issued.push('throwing');
      throw new Error('injected history observer failure');
    });
    await assertCompletesWithin('observer q IPC write', () => frameArrivals[2].promise, 1000);
    assert.deepStrictEqual(issued, ['first', 'second', 'throwing']);
    assert.deepStrictEqual(queuedFrames[2], serializeTextQuery('observer-cannot-break-write'));
    queueSocket.write(scalarResponse);
    assert.strictEqual(await throwingObserverQuery, 1);
  } finally {
    await queueClient.close();
    queuedSockets.forEach(socket => socket.destroy());
    await closeServer(queueServer);
  }

  const disconnectedObserverClient = new KdbIpcClient({ host: '127.0.0.1', port: 1, timeoutMs: 1 });
  let disconnectedIssued = 0;
  await assert.rejects(
    () => disconnectedObserverClient.query('never-written', () => disconnectedIssued++),
    /connection is not open/
  );
  assert.strictEqual(disconnectedIssued, 0, 'preflight failures must not be recorded as issued queries');
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

  const strictRoot = queryInNamespaceStrict(rawQuery, '.');
  assert.notStrictEqual(strictRoot, rawQuery, 'strict metadata/preview execution must wrap even the root namespace');
  assert.ok(strictRoot.includes('previous:string system "d"'));
  assert.ok(strictRoot.includes('system "d ",previous'));
  assert.ok(strictRoot.includes(qString('.')));
  assert.ok(strictRoot.includes(qString(rawQuery)));
  assert.strictEqual(
    queryInNamespaceStrict(rawQuery, 'analytics.market'),
    queryInNamespace(rawQuery, '.analytics.market'),
    'strict and editor wrappers must agree for non-root configured namespaces'
  );

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

function testServerExplorerModel() {
  assert.strictEqual(DEFAULT_SERVER_PREVIEW_CELL_LIMIT, 10_000);
  assert.strictEqual(MIN_SERVER_PREVIEW_CELL_LIMIT, 1);
  assert.strictEqual(MAX_SERVER_PREVIEW_CELL_LIMIT, 1_000_000);
  assert.strictEqual(SERVER_TABLES_QUERY, 'string tables[]');
  assert.strictEqual(
    SERVER_VARIABLES_QUERY,
    [
      '{[]',
      '  names:key `$string system "d";',
      '  names:names where 0<count each string names;',
      '  names:names except tables[];',
      '  types:{@[{type value x};x;{0Nh}]} each names;',
      '  flip `name`type!(string names;types)',
      '}[]',
    ].join('\n'),
    'variables metadata must return names/type atoms without returning remote values'
  );

  assert.strictEqual(validateServerObjectIdentifier('trade'), 'trade');
  assert.strictEqual(validateServerObjectIdentifier('Trade_2026'), 'Trade_2026');
  assert.strictEqual(validateServerObjectIdentifier(`a${'b'.repeat(254)}`).length, 255);
  for (const hostile of [
    '',
    '.analytics.trade',
    '1trade',
    '_trade',
    'trade price',
    'trade;delete from trade',
    'trade\nshow 1',
    'trade"',
    'trade\\path',
    `a${'b'.repeat(255)}`,
  ]) {
    assert.throws(
      () => validateServerObjectIdentifier(hostile),
      /standard q identifiers up to 255 characters/,
      `unsafe Server Explorer identifier must be rejected: ${JSON.stringify(hostile)}`
    );
    assert.throws(() => buildServerTableMetaQuery(hostile), /standard q identifiers/);
    assert.throws(() => buildServerPreviewQuery(hostile, 'table', 100), /standard q identifiers/);
  }

  assert.strictEqual(buildServerTableMetaQuery('trade'), '0!meta `trade');
  assert.strictEqual(
    buildServerPreviewQuery('trade', 'table', 12),
    [
      '{[objectName;limit]',
      '  objectValue:value objectName;',
      '  (limit div 1|count cols objectName)#objectValue',
      '}[`trade;12]',
    ].join('\n')
  );
  const variablePreview = buildServerPreviewQuery('items', 'variable', 25);
  assert.strictEqual(
    variablePreview,
    [
      '{[objectName;limit]',
      '  objectValue:value objectName;',
      '  objectType:type objectValue;',
      `  if[objectType>=100h;'"Function and projection previews are disabled."];`,
      '  $[98h=objectType;(limit div 1|count cols objectName)#objectValue;',
      '    99h=objectType;$[98h=type key objectValue;(limit div 1|count cols objectName)#objectValue;limit#objectValue];',
      '    objectType<0h;objectValue;',
      '    objectType<98h;limit#objectValue;',
      '    objectValue]',
      '}[`items;25]',
    ].join('\n')
  );
  assert.match(variablePreview, /objectType>=100h/, 'runtime type checks must reject disguised functions/projections');
  assert.throws(
    () => buildServerPreviewQuery('calculate', 'function', 25),
    /limited to tables and variables/
  );
  assert.throws(() => serverPreviewWarning('calculate', 'function', '.', 25), /limited to tables and variables/);
  assert.throws(() => buildServerPreviewQuery('trade', 'view', 10), /limited to tables and variables/);

  assert.strictEqual(safeServerPreviewCellLimit(1), 1);
  assert.strictEqual(safeServerPreviewCellLimit(1_000_000), 1_000_000);
  for (const invalid of [0, -1, 1.5, 1_000_001, '100', null, undefined, NaN, Infinity]) {
    assert.strictEqual(
      safeServerPreviewCellLimit(invalid),
      DEFAULT_SERVER_PREVIEW_CELL_LIMIT,
      'hand-edited preview limits must fail closed to the bounded default'
    );
  }
  assert.ok(buildServerPreviewQuery('trade', 'table', 'untrusted').endsWith('}[`trade;10000]'));
  const tableWarning = serverPreviewWarning('trade', 'table', '.analytics', 12_345);
  assert.match(tableWarning, /Preview table "trade" from namespace \.analytics\?/);
  assert.match(tableWarning, /12,345 cells/);
  assert.match(tableWarning, /nested values can still be large/i);
  const variableWarning = serverPreviewWarning('items', 'variable', '.', 25);
  assert.match(variableWarning, /Lists and dictionaries are capped to 25 outer items/);
  assert.match(variableWarning, /scalars and nested values may still be large/);
  assert.match(variableWarning, /Functions and projections are metadata-only/);

  assert.deepStrictEqual(
    parseServerTableNames(['zeta', 'alpha', 'zeta', 'bad;name', '', 42]),
    { names: ['alpha', 'zeta'], omittedUnsafeNames: 2 }
  );
  assert.deepStrictEqual(
    parseServerTableNames('trade'),
    { names: ['trade'], omittedUnsafeNames: 0 }
  );
  assert.throws(() => parseServerTableNames(42), /unexpected table-list shape/);

  const variables = parseServerVariables(modelQTable(
    ['name', 'type'],
    [
      { name: 'vector', type: 7 },
      { name: 'fn', type: 100 },
      { name: 'projection', type: 104 },
      { name: 'futureType', type: 113 },
      { name: 'unknownType', type: null },
      { name: 'fn', type: 101 },
      { name: 'bad;name', type: 100 },
    ]
  ));
  assert.deepStrictEqual(variables, {
    variables: [
      { name: 'fn', kind: 'function', qType: 100 },
      { name: 'futureType', kind: 'variable', qType: 113 },
      { name: 'projection', kind: 'function', qType: 104 },
      { name: 'unknownType', kind: 'variable' },
      { name: 'vector', kind: 'variable', qType: 7 },
    ],
    omittedUnsafeNames: 1,
  });
  assert.throws(
    () => parseServerVariables(modelQTable(['object', 'type'], [])),
    /unexpected variables metadata shape/
  );

  assert.deepStrictEqual(
    parseServerColumns(modelQTable(
      ['c', 't', 'f', 'a'],
      [
        { c: 'sym', t: 's', f: '', a: 'p' },
        { c: 'size\u0000', t: 'j', f: 'ref', a: '' },
        { c: 'mystery', t: '?', f: null, a: null },
      ]
    )),
    [
      { name: 'sym', qTypeCode: 's', qTypeName: 'symbol', foreignKey: '', attribute: 'p' },
      { name: 'size', qTypeCode: 'j', qTypeName: 'long', foreignKey: 'ref', attribute: '' },
      { name: 'mystery', qTypeCode: '?', qTypeName: 'q type ?', foreignKey: '', attribute: '' },
    ]
  );
  assert.strictEqual(qMetaTypeName('p'), 'timestamp');
  assert.strictEqual(qMetaTypeName(''), 'unknown');
  assert.throws(
    () => parseServerColumns(modelQTable(['name', 'type'], [])),
    /unexpected meta shape/
  );

  const snapshot = { connectionId: 'kx-active', namespace: '.analytics' };
  assert.strictEqual(serverExplorerSnapshotMatches(snapshot, 'kx-active', '.analytics', true), true);
  assert.strictEqual(serverExplorerSnapshotMatches(snapshot, 'kx-other', '.analytics', true), false);
  assert.strictEqual(serverExplorerSnapshotMatches(snapshot, 'kx-active', '.other', true), false);
  assert.strictEqual(serverExplorerSnapshotMatches(snapshot, 'kx-active', '.analytics', false), false);
  assert.strictEqual(serverExplorerSnapshotMatches(snapshot, undefined, undefined, true), false);
}

async function testQueryHistoryModel() {
  assert.strictEqual(historyRerunRequiresConfirmation('kx-one', 'kx-one'), false);
  assert.strictEqual(historyRerunRequiresConfirmation('kx-recorded', 'kx-target'), true);

  assert.strictEqual(DEFAULT_QUERY_HISTORY_MAX_ENTRIES, 100);
  assert.strictEqual(MIN_QUERY_HISTORY_MAX_ENTRIES, 1);
  assert.strictEqual(MAX_QUERY_HISTORY_MAX_ENTRIES, 1000);
  assert.strictEqual(safeHistoryLimit(1), 1);
  assert.strictEqual(safeHistoryLimit(1000), 1000);
  assert.strictEqual(safeHistoryLimit('10'), DEFAULT_QUERY_HISTORY_MAX_ENTRIES);
  assert.strictEqual(safeHistoryLimit(0), DEFAULT_QUERY_HISTORY_MAX_ENTRIES);
  assert.strictEqual(safeHistoryLimit(1001), DEFAULT_QUERY_HISTORY_MAX_ENTRIES);
  assert.strictEqual(safeHistoryLimit(12, 7), 12);
  assert.strictEqual(safeHistoryLimit('bad', 7), 7);

  const safe = historyEntry({
    id: 'entry-safe',
    timestamp: 300,
    kind: 'selection',
    status: 'failed',
    durationMs: 12.5,
    queryText: 'select from trade',
  });
  const normalized = normalizeQueryHistoryEntry({
    ...safe,
    result: [{ password: 'must-not-persist' }],
    password: 'must-not-persist',
    error: 'remote payload',
    host: 'private.example.test',
    username: 'private-user',
  });
  assert.deepStrictEqual(normalized, safe);
  assert.deepStrictEqual(
    Object.keys(normalized).sort(),
    ['connectionId', 'connectionName', 'durationMs', 'id', 'kind', 'queryText', 'status', 'timestamp']
  );
  for (const invalid of [
    null,
    {},
    { ...safe, id: '' },
    { ...safe, connectionId: '' },
    { ...safe, connectionName: '' },
    { ...safe, timestamp: -1 },
    { ...safe, timestamp: 1.5 },
    { ...safe, kind: 'preview' },
    { ...safe, status: 'pending' },
    { ...safe, durationMs: -1 },
    { ...safe, durationMs: Infinity },
    { ...safe, queryText: '' },
  ]) {
    assert.strictEqual(normalizeQueryHistoryEntry(invalid), undefined);
  }
  for (const kind of ['line', 'selection', 'script']) {
    for (const status of ['succeeded', 'failed', 'canceled']) {
      assert.ok(normalizeQueryHistoryEntry(historyEntry({ id: `${kind}-${status}`, kind, status })));
    }
  }

  const oldest = historyEntry({ id: 'oldest', timestamp: 100 });
  const equalA = historyEntry({ id: 'equal-a', timestamp: 200 });
  const equalB = historyEntry({ id: 'equal-b', timestamp: 200 });
  const newest = historyEntry({ id: 'newest', timestamp: 300 });
  assert.deepStrictEqual(
    sortHistoryNewestFirst([oldest, equalA, newest, equalB]).map(entry => entry.id),
    ['newest', 'equal-a', 'equal-b', 'oldest'],
    'newest ordering must be deterministic and stable for equal timestamps'
  );
  assert.deepStrictEqual(
    normalizeQueryHistoryEntries([
      oldest,
      { ...newest, result: [1, 2, 3] },
      { ...newest, timestamp: 50 },
      equalA,
      { ...safe, id: '' },
    ], 3).map(entry => entry.id),
    ['newest', 'equal-a', 'oldest'],
    'corrupt entries and duplicate IDs must be stripped before the configured bound is applied'
  );
  assert.deepStrictEqual(normalizeQueryHistoryEntries('corrupt'), []);

  assert.strictEqual(historyTransportKind('line', 'a:1'), 'query');
  assert.strictEqual(historyTransportKind('selection', 'a:1'), 'query');
  assert.strictEqual(historyTransportKind('selection', 'a:1\nb:2'), 'script');
  assert.strictEqual(historyTransportKind('selection', 'a:1\r\nb:2'), 'script');
  assert.strictEqual(historyTransportKind('script', '1+1'), 'script');
  assert.strictEqual(historyTransportKind({ ...safe, kind: 'selection', queryText: 'x\ny' }), 'script');

  const initialMemento = createHistoryMemento([
    { ...oldest, password: 'strip-me', result: [42] },
    { ...newest, error: 'strip-me' },
    { ...safe, id: '' },
  ]);
  const initialStore = new QueryHistoryStore(initialMemento, { maxEntries: 2 });
  assert.deepStrictEqual(initialStore.entries().map(entry => entry.id), ['newest', 'oldest']);
  const pruned = await initialStore.prune();
  assert.deepStrictEqual(pruned.map(entry => entry.id), ['newest', 'oldest']);
  assertHistoryStorageShape(initialMemento.value);
  assert.ok(!JSON.stringify(initialMemento.value).includes('strip-me'));

  let nextId = 0;
  let configuredLimit = 3;
  const memento = createHistoryMemento();
  const store = new QueryHistoryStore(memento, {
    maxEntries: () => configuredLimit,
    now: () => 999,
    createId: () => `generated-${++nextId}`,
  });
  const generation = store.captureGeneration();
  const inputs = [
    { timestamp: 100, queryText: 'line query', kind: 'line', status: 'succeeded' },
    { timestamp: 300, queryText: 'selection query', kind: 'selection', status: 'failed' },
    { timestamp: 200, queryText: 'script query', kind: 'script', status: 'canceled' },
  ].map(item => ({
    connectionId: 'kx-history',
    connectionName: 'History q',
    durationMs: 5,
    ...item,
    result: ['must not persist'],
    password: 'must not persist',
  }));
  await Promise.all(inputs.map(input => store.record(input, generation)));
  assert.deepStrictEqual(
    store.entries().map(entry => entry.queryText),
    ['selection query', 'script query', 'line query'],
    'serialized concurrent writes must retain every issued execution newest-first'
  );
  assert.strictEqual(memento.updates.length, 3);
  assertHistoryStorageShape(memento.value);
  assert.ok(!JSON.stringify(memento.value).includes('must not persist'));

  configuredLimit = 2;
  assert.deepStrictEqual((await store.prune()).map(entry => entry.queryText), ['selection query', 'script query']);
  const deletedId = store.entries()[0].id;
  assert.strictEqual(await store.delete('missing-id'), false);
  assert.strictEqual(await store.delete(deletedId), true);
  assert.strictEqual(store.entries().some(entry => entry.id === deletedId), false);
  assert.strictEqual(await store.delete(deletedId), false);
  configuredLimit = 1;
  assert.strictEqual((await store.prune()).length, 1);

  const invalidGeneration = store.captureGeneration();
  store.invalidatePending();
  const writesBeforeInvalidRecord = memento.updates.length;
  assert.strictEqual(await store.record(inputs[0], invalidGeneration), undefined);
  assert.strictEqual(memento.updates.length, writesBeforeInvalidRecord);
  await assert.rejects(
    () => store.record({ ...inputs[0], queryText: '' }, store.captureGeneration()),
    /invalid KX query history entry/
  );

  const beforeRaceEntry = historyEntry({ id: 'before-race', timestamp: 1, queryText: 'before race' });
  const delayedMemento = createBlockingHistoryMemento([beforeRaceEntry]);
  const delayedStore = new QueryHistoryStore(delayedMemento, {
    createId: (() => {
      let id = 0;
      return () => `delayed-${++id}`;
    })(),
  });
  const beforeClear = delayedStore.captureGeneration();
  const firstRecord = delayedStore.record({ ...inputs[0], timestamp: 10 }, beforeClear);
  await delayedMemento.updateStarted;
  const queuedStaleRecord = delayedStore.record({ ...inputs[1], timestamp: 20 }, beforeClear);
  const clearing = delayedStore.clear();
  delayedMemento.releaseUpdate();
  assert.strictEqual(await firstRecord, undefined, 'a write invalidated while pending must not return a live entry');
  assert.strictEqual(await queuedStaleRecord, undefined, 'a pre-clear token must not write after Clear');
  await clearing;
  assert.deepStrictEqual(delayedStore.entries(), []);
  assert.strictEqual(delayedMemento.value, undefined);
  assert.strictEqual(
    delayedMemento.updates.length,
    3,
    'the in-flight write must roll back its previous snapshot before the queued clear is committed'
  );
  assert.deepStrictEqual(delayedMemento.updates[1], [beforeRaceEntry]);
  assert.strictEqual(delayedMemento.updates[2], undefined);

  const staleAfterClear = delayedStore.record({ ...inputs[2], timestamp: 30 }, beforeClear);
  assert.strictEqual(await staleAfterClear, undefined);
  assert.strictEqual(delayedMemento.value, undefined);
  assert.strictEqual(QUERY_HISTORY_STORAGE_KEY, 'vscode-kdb.queryHistory.v1');
}

async function testTreeProviders() {
  const treeVscode = createVscodeTreeHarness();
  const {
    ServerCategoryTreeItem,
    ServerExplorerTreeProvider,
    ServerObjectTreeItem,
    ServerStatusTreeItem,
  } = requireOutWithMocks('server-explorer', { vscode: treeVscode.vscode });
  const {
    EmptyQueryHistoryTreeItem,
    QueryHistoryFeature,
    QueryHistoryTreeItem,
    QueryHistoryTreeProvider,
  } = requireOutWithMocks('query-history', { vscode: treeVscode.vscode });

  let active = validateConnection({
    id: 'kx-tree',
    name: 'Tree q',
    host: 'localhost',
    port: 5000,
    database: '.analytics',
    username: '',
  });
  let connected = false;
  let metaFailure;
  const managerCalls = [];
  const diagnostics = [];
  const variablesValue = modelQTable(['name', 'type'], [
    { name: 'answer', type: -7 },
    { name: 'calculate', type: 100 },
  ]);
  const columnsValue = modelQTable(['c', 't', 'f', 'a'], [
    { c: 'sym', t: 's', f: '', a: '' },
    { c: 'size', t: 'j', f: '', a: '' },
  ]);
  const store = {
    activeConnection: () => active,
  };
  const manager = {
    isConnected: id => !!active && connected && id === active.id,
    async executeInConfiguredNamespace(connection, query) {
      managerCalls.push({ connection: { ...connection }, query });
      if (query === SERVER_TABLES_QUERY) {
        return ['trade'];
      }
      if (query === SERVER_VARIABLES_QUERY) {
        return variablesValue;
      }
      if (query === buildServerTableMetaQuery('trade')) {
        if (metaFailure) {
          throw metaFailure;
        }
        return columnsValue;
      }
      throw new Error(`unexpected tree query ${query}`);
    },
  };
  const provider = new ServerExplorerTreeProvider(store, manager, {
    event: event => diagnostics.push(event),
  });

  assert.strictEqual(
    provider.hasAvailableConnection(),
    true,
    'a configured active profile keeps the opt-in view available even while disconnected'
  );
  let root = await provider.getChildren();
  assert.strictEqual(root.length, 1);
  assert.ok(root[0] instanceof ServerStatusTreeItem);
  assert.match(String(root[0].label), /active KX profile is disconnected/i);
  assert.deepStrictEqual(managerCalls, [], 'provider construction and initial tree reads must not query q');

  await provider.refresh();
  assert.deepStrictEqual(managerCalls, [], 'Refresh while disconnected must not issue metadata');
  assert.match(treeVscode.warnings.at(-1), /active connected direct q IPC profile/);

  connected = true;
  assert.strictEqual(provider.hasAvailableConnection(), true);
  await provider.refresh();
  assert.deepStrictEqual(
    managerCalls.map(call => call.query),
    [SERVER_TABLES_QUERY, SERVER_VARIABLES_QUERY]
  );
  assert.ok(managerCalls.every(call => call.connection.database === '.analytics'));
  root = await provider.getChildren();
  assert.strictEqual(root.length, 2);
  assert.ok(root.every(item => item instanceof ServerCategoryTreeItem));
  assert.deepStrictEqual(root.map(item => [item.label, item.description]), [
    ['Tables', '1'],
    ['Variables & Functions', '2'],
  ]);
  const tableCategory = root.find(item => item.category === 'tables');
  const variableCategory = root.find(item => item.category === 'variables');
  const tableItems = await provider.getChildren(tableCategory);
  const variableItems = await provider.getChildren(variableCategory);
  assert.strictEqual(tableItems.length, 1);
  assert.strictEqual(tableItems[0].objectName, 'trade');
  assert.deepStrictEqual(variableItems.map(item => [item.objectName, item.kind]), [
    ['answer', 'variable'],
    ['calculate', 'function'],
  ]);
  assert.deepStrictEqual(provider.resolveObject(tableItems[0]), tableItems[0]);
  assert.strictEqual(
    provider.resolveObject(new ServerObjectTreeItem(
      'trade',
      'table',
      tableItems[0].snapshot,
      true,
      tableItems[0].generation
    )),
    undefined,
    'commands must reject lookalike/unowned tree items'
  );
  assert.strictEqual(provider.resolveObject({ label: 'trade' }), undefined);

  const columns = await provider.getChildren(tableItems[0]);
  assert.deepStrictEqual(columns.map(item => item.column.name), ['sym', 'size']);
  assert.strictEqual(managerCalls.at(-1).query, '0!meta `trade');
  assert.ok(diagnostics.some(event =>
    event.phase === 'query' && event.status === 'success' && event.details.operation === 'meta'
  ));

  await provider.refresh();
  root = await provider.getChildren();
  assert.ok(root.every(item => item.generation > tableCategory.generation));
  const callsAfterSameProfileRefresh = managerCalls.length;
  const staleCategoryChildren = await provider.getChildren(tableCategory);
  assert.strictEqual(staleCategoryChildren.length, 1);
  assert.ok(staleCategoryChildren[0] instanceof ServerStatusTreeItem);
  assert.match(String(staleCategoryChildren[0].label), /metadata changed/i);
  assert.strictEqual(provider.resolveObject(tableItems[0]), undefined);
  const staleTableChildren = await provider.getChildren(tableItems[0]);
  assert.strictEqual(staleTableChildren.length, 1);
  assert.ok(staleTableChildren[0] instanceof ServerStatusTreeItem);
  assert.match(String(staleTableChildren[0].label), /metadata changed/i);
  assert.strictEqual(
    managerCalls.length,
    callsAfterSameProfileRefresh,
    'old category/object generations must never trigger same-profile metadata calls'
  );
  const refreshedTableCategory = root.find(item => item.category === 'tables');
  const refreshedTable = (await provider.getChildren(refreshedTableCategory))[0];
  metaFailure = new Error('missing/permission denied');
  const failedColumns = await provider.getChildren(refreshedTable);
  assert.strictEqual(failedColumns.length, 1);
  assert.ok(failedColumns[0] instanceof ServerStatusTreeItem);
  assert.match(String(failedColumns[0].label), /missing\/permission denied/);
  const callsAfterMetaFailure = managerCalls.length;
  await provider.getChildren(refreshedTable);
  assert.strictEqual(
    managerCalls.length,
    callsAfterMetaFailure + 1,
    'a failed meta lookup must remain retryable on the next expansion instead of crashing/staying stale'
  );
  metaFailure = undefined;
  await provider.refresh();
  root = await provider.getChildren();
  const retryTable = (await provider.getChildren(root.find(item => item.category === 'tables')))[0];
  assert.deepStrictEqual((await provider.getChildren(retryTable)).map(item => item.column.name), ['sym', 'size']);

  active = { ...active, database: '.other' };
  provider.connectionStateChanged();
  root = await provider.getChildren();
  assert.strictEqual(root.length, 1);
  assert.ok(root[0] instanceof ServerStatusTreeItem);
  assert.match(String(root[0].label), /Select Refresh Server Explorer/);
  active = { ...active, id: 'kx-tree-replaced' };
  provider.connectionStateChanged();
  assert.strictEqual((await provider.getChildren()).length, 1);
  connected = false;
  provider.connectionStateChanged();
  assert.strictEqual(provider.hasAvailableConnection(), true);
  assert.match(String((await provider.getChildren())[0].label), /disconnected/i);
  active = undefined;
  provider.connectionStateChanged();
  assert.strictEqual(provider.hasAvailableConnection(), false);
  provider.dispose();

  const staleTables = deferred();
  let staleActive = validateConnection({
    id: 'kx-stale',
    name: 'Stale q',
    host: 'localhost',
    port: 5001,
    database: '.analytics',
    username: '',
  });
  const staleProvider = new ServerExplorerTreeProvider(
    { activeConnection: () => staleActive },
    {
      isConnected: id => id === staleActive.id,
      async executeInConfiguredNamespace(_connection, query) {
        return query === SERVER_TABLES_QUERY ? staleTables.promise : variablesValue;
      },
    },
    { event() {} }
  );
  const staleRefresh = staleProvider.refresh();
  staleActive = { ...staleActive, database: '.changed' };
  staleProvider.connectionStateChanged();
  staleTables.resolve(['staleTable']);
  await staleRefresh;
  const staleRoot = await staleProvider.getChildren();
  assert.strictEqual(staleRoot.length, 1);
  assert.ok(staleRoot[0] instanceof ServerStatusTreeItem);
  assert.match(String(staleRoot[0].label), /Select Refresh Server Explorer/);
  staleProvider.dispose();

  const cancellationTables = deferred();
  const cancellationCalls = [];
  const cancellationConnection = validateConnection({
    id: 'kx-cancel-metadata',
    name: 'Cancelable q',
    host: 'localhost',
    port: 5002,
    database: '.analytics',
    username: '',
  });
  const cancellationProvider = new ServerExplorerTreeProvider(
    { activeConnection: () => cancellationConnection },
    {
      isConnected: id => id === cancellationConnection.id,
      async executeInConfiguredNamespace(_connection, query) {
        cancellationCalls.push(query);
        if (query === SERVER_TABLES_QUERY) {
          return cancellationTables.promise;
        }
        if (query === SERVER_VARIABLES_QUERY) {
          return variablesValue;
        }
        throw new Error(`unexpected cancellation query ${query}`);
      },
    },
    { event: event => diagnostics.push(event) }
  );
  const canceledRefresh = cancellationProvider.refresh();
  assert.deepStrictEqual(cancellationCalls, [SERVER_TABLES_QUERY]);
  treeVscode.cancelLatestProgress();
  await canceledRefresh;
  assert.deepStrictEqual(
    cancellationCalls,
    [SERVER_TABLES_QUERY],
    'canceling the lazy metadata chain must not enqueue the variables request'
  );
  assert.match(String((await cancellationProvider.getChildren())[0].label), /canceled locally/i);
  cancellationTables.resolve(['lateTable']);
  await Promise.resolve();
  assert.deepStrictEqual(cancellationCalls, [SERVER_TABLES_QUERY]);
  cancellationProvider.dispose();

  const timeoutTables = deferred();
  const timeoutCalls = [];
  const timeoutDiagnostics = [];
  let timeoutConnected = false;
  const timeoutConnection = validateConnection({
    id: 'kx-timeout-metadata',
    name: 'Timeout q',
    host: 'localhost',
    port: 5003,
    database: '.analytics',
    username: '',
  });
  const timeoutProvider = new ServerExplorerTreeProvider(
    { activeConnection: () => timeoutConnection },
    {
      isConnected: id => timeoutConnected && id === timeoutConnection.id,
      async executeInConfiguredNamespace(_connection, query) {
        timeoutCalls.push(query);
        if (query === SERVER_TABLES_QUERY) {
          return timeoutTables.promise;
        }
        throw new Error(`unexpected timeout query ${query}`);
      },
    },
    { event: event => timeoutDiagnostics.push(event) }
  );
  timeoutProvider.connectionStateChanged();
  assert.match(String((await timeoutProvider.getChildren())[0].label), /disconnected/i);
  timeoutConnected = true;
  timeoutProvider.connectionStateChanged();
  assert.match(
    String((await timeoutProvider.getChildren())[0].label),
    /Connected\. Select Refresh Server Explorer to load/i,
    'reconnecting an idle explorer must present an explicit manual Refresh state'
  );

  const timedOutRefresh = timeoutProvider.refresh();
  assert.deepStrictEqual(timeoutCalls, [SERVER_TABLES_QUERY]);
  timeoutConnected = false;
  timeoutProvider.connectionStateChanged();
  timeoutTables.reject(new Error('timed out after 25 ms'));
  await timedOutRefresh;
  let timeoutRoot = await timeoutProvider.getChildren();
  assert.strictEqual(timeoutRoot.length, 1);
  assert.match(timeoutRoot[0].contextValue, /status\.error$/);
  assert.match(String(timeoutRoot[0].label), /Server Explorer refresh failed/i);
  assert.match(String(timeoutRoot[0].label), /timed out after 25 ms/i);
  assert.match(String(timeoutRoot[0].label), /active KX profile is disconnected/i);
  assert.match(String(timeoutRoot[0].label), /reconnect it before retrying/i);
  const timeoutRefreshDiagnostics = timeoutDiagnostics.filter(event =>
    event.details?.operation === 'refresh'
  );
  assert.deepStrictEqual(
    timeoutRefreshDiagnostics.map(event => event.status),
    ['start', 'failed'],
    'a transport timeout racing disconnect is a failed refresh, not a canceled/stale result'
  );

  timeoutConnected = true;
  timeoutProvider.connectionStateChanged();
  timeoutRoot = await timeoutProvider.getChildren();
  assert.match(String(timeoutRoot[0].label), /Server Explorer refresh failed/i);
  assert.match(String(timeoutRoot[0].label), /timed out after 25 ms/i);
  assert.match(String(timeoutRoot[0].label), /Connected\. Select Refresh Server Explorer to retry/i);
  assert.doesNotMatch(String(timeoutRoot[0].label), /is disconnected|reconnect it/i);
  timeoutConnected = false;
  timeoutProvider.connectionStateChanged();
  timeoutRoot = await timeoutProvider.getChildren();
  assert.match(String(timeoutRoot[0].label), /Server Explorer refresh failed/i);
  assert.match(String(timeoutRoot[0].label), /timed out after 25 ms/i);
  assert.match(String(timeoutRoot[0].label), /active KX profile is disconnected/i);
  assert.match(String(timeoutRoot[0].label), /reconnect it before retrying/i);
  assert.doesNotMatch(
    String(timeoutRoot[0].label),
    /Connected\. Select Refresh/,
    'disconnecting again must replace connected retry guidance instead of retaining contradictory states'
  );
  timeoutProvider.dispose();

  const historyMemento = createHistoryMemento([
    historyEntry({
      id: 'removed',
      connectionId: 'kx-removed',
      connectionName: 'Removed q',
      timestamp: 300,
      queryText: '[command](command:evil)',
    }),
    historyEntry({
      id: 'renamed',
      connectionId: 'kx-renamed',
      connectionName: 'Old q name',
      timestamp: 200,
      queryText: 'select from trade',
    }),
  ]);
  const historyStore = new QueryHistoryStore(historyMemento);
  const historyProvider = new QueryHistoryTreeProvider(historyStore, {
    connection(id) {
      return id === 'kx-renamed'
        ? { id, name: 'Current q name', database: '.analytics' }
        : undefined;
    },
  });
  const historyItems = historyProvider.getChildren();
  assert.deepStrictEqual(historyItems.map(item => item.entry.id), ['removed', 'renamed']);
  assert.ok(historyItems.every(item => item instanceof QueryHistoryTreeItem));
  assert.match(historyItems[0].description, /Removed q \(profile removed\)/);
  assert.match(historyItems[1].description, /Current q name \(recorded as Old q name\)/);
  assert.strictEqual(typeof historyItems[0].tooltip, 'string', 'sensitive query tooltips must remain untrusted plain text');
  assert.match(historyItems[0].tooltip, /\[command\]\(command:evil\)/);
  assert.deepStrictEqual(historyProvider.resolveEntry(historyItems[1]).id, 'renamed');
  assert.strictEqual(
    historyProvider.resolveEntry(new QueryHistoryTreeItem(historyItems[1].entry, 'Current q name')),
    undefined,
    'history commands must reject lookalike/unowned items'
  );
  assert.strictEqual(historyProvider.resolveEntry({ entry: historyItems[1].entry }), undefined);
  await historyStore.delete('renamed');
  assert.strictEqual(historyProvider.resolveEntry(historyItems[1]), undefined, 'deleted owned items must resolve stale-safe');
  historyProvider.dispose();

  const labelEntry = historyEntry({
    id: 'live-label',
    connectionId: 'kx-live-label',
    connectionName: 'Recorded label',
    timestamp: 400,
    queryText: 'show label',
  });
  const labelStore = new QueryHistoryStore(createHistoryMemento([labelEntry]));
  let currentLabel = 'First current label';
  const connectionTreeChanges = new treeVscode.vscode.EventEmitter();
  const historyFeature = new QueryHistoryFeature(
    labelStore,
    {
      connection(id) {
        return id === 'kx-live-label'
          ? { id, name: currentLabel, database: '.analytics' }
          : undefined;
      },
    },
    { onDidChangeTreeData: connectionTreeChanges.event },
    async () => undefined
  );
  const historyTreeView = treeVscode.createdTreeViews.find(view => view.id === 'vscode-kdb.queryHistory');
  assert.ok(historyTreeView, 'QueryHistoryFeature must register its tree view');
  const featureProvider = historyTreeView.options.treeDataProvider;
  assert.match(featureProvider.getChildren()[0].description, /First current label/);
  let labelRefreshes = 0;
  featureProvider.onDidChangeTreeData(() => labelRefreshes++);
  const refreshesBeforeRename = labelRefreshes;
  currentLabel = 'Renamed current label';
  connectionTreeChanges.fire(undefined);
  assert.strictEqual(
    labelRefreshes,
    refreshesBeforeRename + 1,
    'connection tree changes must invalidate rendered Query History labels'
  );
  assert.match(featureProvider.getChildren()[0].description, /Renamed current label/);
  historyFeature.dispose();
  const refreshesAfterDispose = labelRefreshes;
  connectionTreeChanges.fire(undefined);
  assert.strictEqual(labelRefreshes, refreshesAfterDispose, 'disposed history features must release label listeners');

  const emptyProvider = new QueryHistoryTreeProvider(
    new QueryHistoryStore(createHistoryMemento()),
    { connection: () => undefined }
  );
  const emptyItems = emptyProvider.getChildren();
  assert.strictEqual(emptyItems.length, 1);
  assert.ok(emptyItems[0] instanceof EmptyQueryHistoryTreeItem);
  emptyProvider.dispose();
}

async function testFeatureControlsLifecycle() {
  const settings = {
    'vscode-kdb.features.serverExplorer': false,
    'vscode-kdb.features.queryHistory': false,
    'vscode-kdb.queryHistory.maxEntries': 100,
  };
  const contextCommands = [];
  const serverInstances = [];
  const historyInstances = [];
  class FakeServerExplorerFeature {
    constructor(...args) {
      this.args = args;
      this.disposed = false;
      serverInstances.push(this);
    }

    dispose() {
      this.disposed = true;
    }
  }
  class FakeQueryHistoryFeature {
    constructor(...args) {
      this.args = args;
      this.disposed = false;
      this.pruneCalls = 0;
      historyInstances.push(this);
    }

    capture() {
      return { feature: this, generation: 0 };
    }

    async record() {}

    async prune() {
      this.pruneCalls++;
    }

    dispose() {
      this.disposed = true;
    }
  }
  const fakeVscode = {
    workspace: {
      getConfiguration(section) {
        return {
          get(key, fallback) {
            const fullKey = `${section}.${key}`;
            return Object.prototype.hasOwnProperty.call(settings, fullKey) ? settings[fullKey] : fallback;
          },
        };
      },
    },
    commands: {
      async executeCommand(...args) {
        contextCommands.push(args);
      },
    },
    window: {
      showWarningMessage() {},
    },
  };
  const { FeatureControls } = requireOutWithMocks('feature-controls', {
    vscode: fakeVscode,
    './server-explorer': {
      SERVER_EXPLORER_AVAILABLE_CONTEXT: 'vscode-kdb.serverExplorer.available',
      ServerExplorerFeature: FakeServerExplorerFeature,
    },
    './query-history': {
      QueryHistoryFeature: FakeQueryHistoryFeature,
    },
  });
  const workspaceState = createHistoryMemento();
  const featureConnectionTree = { onDidChangeTreeData() { return { dispose() {} }; } };
  const controls = new FeatureControls(
    { workspaceState },
    { connection: () => undefined },
    {},
    featureConnectionTree,
    {},
    async () => undefined,
    async () => undefined
  );
  assert.strictEqual(serverInstances.length, 0, 'disabled Server Explorer must not register its view/commands');
  assert.strictEqual(historyInstances.length, 0, 'disabled Query History must not register its view/commands');
  assert.ok(contextCommands.some(args =>
    args[0] === 'setContext' && args[1] === 'vscode-kdb.serverExplorer.available' && args[2] === false
  ));

  settings['vscode-kdb.features.serverExplorer'] = true;
  controls.configurationChanged(configurationEvent('vscode-kdb.features.serverExplorer'));
  assert.strictEqual(serverInstances.length, 1);
  assert.strictEqual(serverInstances[0].args[2], featureConnectionTree);
  controls.configurationChanged(configurationEvent('unrelated.setting'));
  assert.strictEqual(serverInstances.length, 1, 'unrelated changes must not duplicate feature registrations');
  settings['vscode-kdb.features.serverExplorer'] = false;
  controls.configurationChanged(configurationEvent('vscode-kdb.features.serverExplorer'));
  assert.strictEqual(serverInstances[0].disposed, true);

  settings['vscode-kdb.features.queryHistory'] = true;
  controls.configurationChanged(configurationEvent('vscode-kdb.features.queryHistory'));
  assert.strictEqual(historyInstances.length, 1);
  assert.strictEqual(
    historyInstances[0].args[2],
    featureConnectionTree,
    'Query History must observe connection tree changes so stored labels rerender after rename/removal'
  );
  const sharedHistoryStore = historyInstances[0].args[0];
  controls.configurationChanged(configurationEvent('vscode-kdb.queryHistory.maxEntries'));
  await Promise.resolve();
  assert.strictEqual(historyInstances[0].pruneCalls, 1);
  settings['vscode-kdb.features.queryHistory'] = false;
  controls.configurationChanged(configurationEvent('vscode-kdb.features.queryHistory'));
  assert.strictEqual(historyInstances[0].disposed, true);
  settings['vscode-kdb.features.queryHistory'] = true;
  controls.configurationChanged(configurationEvent('vscode-kdb.features.queryHistory'));
  assert.strictEqual(historyInstances.length, 2);
  assert.strictEqual(historyInstances[1].args[0], sharedHistoryStore, 'toggle cycles must reuse local history storage safely');

  controls.dispose();
  assert.strictEqual(historyInstances[1].disposed, true);
  settings['vscode-kdb.features.serverExplorer'] = true;
  controls.configurationChanged(configurationEvent('vscode-kdb.features.serverExplorer'));
  assert.strictEqual(serverInstances.length, 1, 'disposed controls must never register features again');
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

    async query(query, onIssued) {
      capturedQueries.push(query);
      try {
        onIssued?.();
      } catch {
        // Match KdbIpcClient: local history observers cannot disrupt a written request.
      }
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
  let connectFailureIssued = 0;
  await assert.rejects(
    () => retryManager.execute(connection, '1+1', () => connectFailureIssued++),
    /injected SecretStorage get failure/
  );
  assert.strictEqual(connectFailureIssued, 0, 'queries that fail before connect must not be marked issued');
  const initialClient = await retryManager.connect(connection);
  assert.strictEqual(passwordAttempts, 2, 'a failed secret lookup must not poison later connection attempts');
  assert.strictEqual(retryManager.isConnected(connection.id), true);
  assert.strictEqual(initialClient.options.connectTimeoutMs, 1500);
  assert.strictEqual(initialClient.options.queryTimeoutMs, 2750);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(initialClient.options, 'timeoutMs'), false);

  const namespacedConnection = { ...connection, database: '.analytics' };
  let successfulQueryIssued = 0;
  await retryManager.execute(namespacedConnection, 'answer', () => successfulQueryIssued++);
  assert.strictEqual(successfulQueryIssued, 1);
  assert.strictEqual(capturedQueries.at(-1), queryInNamespace('answer', '.analytics'));
  let successfulScriptIssued = 0;
  await retryManager.executeScript(namespacedConnection, 'a:1\na+1', () => successfulScriptIssued++);
  assert.strictEqual(successfulScriptIssued, 1);
  assert.strictEqual(capturedQueries.at(-1), qScriptInNamespace('a:1\na+1', '.analytics'));
  let strictIssued = 0;
  await retryManager.executeInConfiguredNamespace(connection, 'string system "d"', () => strictIssued++);
  assert.strictEqual(strictIssued, 1);
  assert.strictEqual(
    capturedQueries.at(-1),
    queryInNamespaceStrict('string system "d"', '.'),
    'Server Explorer preview/metadata must use the strict root namespace wrapper'
  );
  await retryManager.executeInConfiguredNamespace(namespacedConnection, 'tables[]');
  assert.strictEqual(capturedQueries.at(-1), queryInNamespaceStrict('tables[]', '.analytics'));
  await retryManager.execute(namespacedConnection, '2+2', () => {
    throw new Error('history observer failure');
  });
  assert.strictEqual(
    capturedQueries.at(-1),
    queryInNamespace('2+2', '.analytics'),
    'history observers must never prevent the q transport call'
  );

  const genuineQError = new FakeKdbQError('type');
  nextQueryError = genuineQError;
  let qFailureIssued = 0;
  await assert.rejects(
    () => retryManager.execute(namespacedConnection, 'badQuery', () => qFailureIssued++),
    error => error === genuineQError
  );
  assert.strictEqual(qFailureIssued, 1, 'genuine q failures occur after the request is issued');
  assert.strictEqual(
    retryManager.isConnected(connection.id),
    true,
    'a genuine q error must not be converted to result data or drop a healthy connection'
  );

  nextQueryError = new Error('injected transport failure');
  let transportFailureIssued = 0;
  await assert.rejects(
    () => retryManager.execute(namespacedConnection, '1+1', () => transportFailureIssued++),
    /transport failure/
  );
  assert.strictEqual(transportFailureIssued, 1, 'transport failures after query() starts are issued');
  assert.strictEqual(
    retryManager.isConnected(connection.id),
    false,
    'a transport failure must immediately clear the connected tree state'
  );

  nextConnectError = new Error('injected connect failure');
  let openFailureIssued = 0;
  await assert.rejects(
    () => retryManager.execute(connection, '1+1', () => openFailureIssued++),
    /connect failure/
  );
  assert.strictEqual(openFailureIssued, 0, 'TCP/handshake failure must not create a history entry');
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
  assert.strictEqual(manifest.version, '0.1.4');
  const packageLock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  assert.strictEqual(packageLock.version, '0.1.4');
  assert.strictEqual(packageLock.packages[''].version, '0.1.4');
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
    'KX: Refresh Server Explorer',
    'KX: Preview Server Object',
    'KX Query History: Rerun Query',
    'KX Query History: Copy Query',
    'KX Query History: Insert into Active Editor',
    'KX Query History: Delete Entry',
    'KX: Clear Query History',
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
  const serverExplorerView = viewGroups.find(view => view && view.id === 'vscode-kdb.serverExplorer');
  assert.ok(serverExplorerView, 'KX Server Explorer view contribution is missing');
  assert.strictEqual(serverExplorerView.name, 'KX Server Explorer');
  assert.match(serverExplorerView.when, /config\.vscode-kdb\.features\.serverExplorer/);
  assert.match(serverExplorerView.when, /vscode-kdb\.serverExplorer\.available/);
  const queryHistoryView = viewGroups.find(view => view && view.id === 'vscode-kdb.queryHistory');
  assert.ok(queryHistoryView, 'KX Query History view contribution is missing');
  assert.strictEqual(queryHistoryView.name, 'KX Query History');
  assert.match(queryHistoryView.when, /config\.vscode-kdb\.features\.queryHistory/);

  const commandById = Object.fromEntries(commands.map(command => [command.command, command]));
  const serverCommandIds = [
    'vscode-kdb.refreshServerExplorer',
    'vscode-kdb.previewServerObject',
  ];
  const historyCommandIds = [
    'vscode-kdb.rerunQueryHistoryEntry',
    'vscode-kdb.copyQueryHistoryEntry',
    'vscode-kdb.insertQueryHistoryEntry',
    'vscode-kdb.deleteQueryHistoryEntry',
    'vscode-kdb.clearQueryHistory',
  ];
  serverCommandIds.forEach(id => {
    assert.match(commandById[id].enablement, /config\.vscode-kdb\.features\.serverExplorer/);
    assert.match(commandById[id].enablement, /vscode-kdb\.serverExplorer\.available/);
  });
  historyCommandIds.forEach(id => {
    assert.match(commandById[id].enablement, /config\.vscode-kdb\.features\.queryHistory/);
  });
  const menus = contributions.menus || {};
  const allMenuItems = Object.values(menus).flat();
  for (const id of [...serverCommandIds, ...historyCommandIds]) {
    const items = allMenuItems.filter(item => item.command === id);
    assert.ok(items.length > 0, `${id} must have an explicitly gated menu contribution`);
    items.forEach(item => {
      const when = String(item.when || '');
      const expectedFeature = serverCommandIds.includes(id) ? 'serverExplorer' : 'queryHistory';
      assert.ok(
        when === 'false' || when.includes(`config.vscode-kdb.features.${expectedFeature}`),
        `${id} menu item is not feature-gated: ${when}`
      );
    });
  }
  const previewContextItems = (menus['view/item/context'] || [])
    .filter(item => item.command === 'vscode-kdb.previewServerObject');
  assert.strictEqual(previewContextItems.length, 1);
  assert.ok(
    previewContextItems[0].when.includes('serverExplorer\\.object\\.(table|variable)$'),
    'Preview must be contributed only for table and variable tree contexts'
  );
  assert.ok(!previewContextItems[0].when.includes('function'));
  const paletteItems = (menus.commandPalette || []);
  assert.match(
    paletteItems.find(item => item.command === 'vscode-kdb.refreshServerExplorer').when,
    /serverExplorer\.available/
  );
  for (const itemOnlyId of [
    'vscode-kdb.previewServerObject',
    'vscode-kdb.rerunQueryHistoryEntry',
    'vscode-kdb.copyQueryHistoryEntry',
    'vscode-kdb.insertQueryHistoryEntry',
    'vscode-kdb.deleteQueryHistoryEntry',
  ]) {
    assert.strictEqual(
      paletteItems.find(item => item.command === itemOnlyId).when,
      'false',
      `${itemOnlyId} must not appear as a dead item-only command in the Command Palette`
    );
  }

  const configuration = Array.isArray(contributions.configuration)
    ? contributions.configuration
    : [contributions.configuration || {}];
  const configurationProperties = Object.assign({}, ...configuration.map(item => item.properties || {}));
  const serverFeatureSetting = configurationProperties['vscode-kdb.features.serverExplorer'];
  assert.strictEqual(serverFeatureSetting.type, 'boolean');
  assert.strictEqual(serverFeatureSetting.scope, 'window');
  assert.strictEqual(serverFeatureSetting.default, false);
  assert.match(serverFeatureSetting.description, /Disabled by default/);
  assert.match(serverFeatureSetting.description, /active direct q IPC profile/i);
  assert.match(serverFeatureSetting.description, /disconnected state stays visible/i);
  assert.match(serverFeatureSetting.description, /only while connected/i);
  assert.match(serverFeatureSetting.description, /explicitly invoked|explicit/i);
  const historyFeatureSetting = configurationProperties['vscode-kdb.features.queryHistory'];
  assert.strictEqual(historyFeatureSetting.type, 'boolean');
  assert.strictEqual(historyFeatureSetting.scope, 'window');
  assert.strictEqual(historyFeatureSetting.default, false);
  assert.match(historyFeatureSetting.description, /Disabled by default/);
  assert.match(historyFeatureSetting.description, /local VS Code workspace extension storage/i);
  assert.match(historyFeatureSetting.description, /not sent as telemetry/i);
  assert.match(historyFeatureSetting.description, /not.*Settings Sync/i);
  const previewLimitSetting = configurationProperties['vscode-kdb.serverExplorer.previewCellLimit'];
  assert.strictEqual(previewLimitSetting.type, 'integer');
  assert.strictEqual(previewLimitSetting.scope, 'window');
  assert.strictEqual(previewLimitSetting.default, DEFAULT_SERVER_PREVIEW_CELL_LIMIT);
  assert.strictEqual(previewLimitSetting.minimum, MIN_SERVER_PREVIEW_CELL_LIMIT);
  assert.strictEqual(previewLimitSetting.maximum, MAX_SERVER_PREVIEW_CELL_LIMIT);
  assert.match(previewLimitSetting.description, /server-side .*preview cap/i);
  assert.match(previewLimitSetting.description, /explicit confirmation/i);
  assert.match(previewLimitSetting.description, /functions\/projections are metadata-only/i);
  const historyLimitSetting = configurationProperties['vscode-kdb.queryHistory.maxEntries'];
  assert.strictEqual(historyLimitSetting.type, 'integer');
  assert.strictEqual(historyLimitSetting.scope, 'window');
  assert.strictEqual(historyLimitSetting.default, DEFAULT_QUERY_HISTORY_MAX_ENTRIES);
  assert.strictEqual(historyLimitSetting.minimum, MIN_QUERY_HISTORY_MAX_ENTRIES);
  assert.strictEqual(historyLimitSetting.maximum, MAX_QUERY_HISTORY_MAX_ENTRIES);
  assert.match(historyLimitSetting.description, /local VS Code workspace extension storage/i);
  assert.match(historyLimitSetting.description, /Result payloads are never stored/i);
  assert.strictEqual(
    Object.keys(configurationProperties).some(key => /queryHistory\.(?:entries|queries|storage)/i.test(key)),
    false,
    'query text must not be persisted through syncable VS Code settings'
  );
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
  sources.forEach(([file, source]) => {
    const label = path.relative(ROOT, file);
    assertNoSqlToolsRuntimeReference(source, label);
    assertNoVscodeQRuntimeReference(source, label);
  });

  const lockPackagePaths = Object.keys(packageLock.packages || {});
  assert.strictEqual(
    lockPackagePaths.some(name => /node_modules\/(?:@sqltools(?:\/|$)|[^/]*vscode-q(?:\/|$))/i.test(name)),
    false,
    'package-lock.json must not contain SQLTools or vscode-q packages'
  );
  const forbiddenHeavyDependencies = /(?:ag-grid|plotly|perspective|tree-sitter|language-server|vscode-languageclient|notebook)/i;
  assert.strictEqual(Object.keys(dependencies).some(name => forbiddenHeavyDependencies.test(name)), false);

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
  const featureControlsSource = readSource('feature-controls.ts');
  const serverExplorerSource = readSource('server-explorer.ts');
  const historySource = readSource('query-history.ts');
  const historyModelSource = readSource('query-history-model.ts');
  assert.match(featureControlsSource, /context\.workspaceState/);
  assert.ok(
    !/context\.globalState/.test(`${featureControlsSource}\n${historySource}`),
    'query history must use workspace-local Memento storage'
  );
  assert.ok(!/ConfigurationTarget|\.update\([^)]*queryHistory/.test(historySource));
  assert.ok(!/sendTelemetry|createTelemetryLogger|TelemetryLogger|\bfetch\s*\(|XMLHttpRequest/.test(
    `${historySource}\n${historyModelSource}`
  ), 'query history must not transmit query contents or telemetry');
  assert.ok(!/createWebviewPanel|WebviewPanel|\.webview\b/.test(`${serverExplorerSource}\n${historySource}`));
  assert.ok(!/setInterval\s*\(/.test(serverExplorerSource), 'Server Explorer must remain manual-refresh by default');
  assert.match(serverExplorerSource, /executeInConfiguredNamespace/);
  assert.match(serverExplorerSource, /showWarningMessage\([\s\S]*?\{ modal: true \}[\s\S]*?'Preview'/);
  const serverPreviewSource = sourceSection(
    serverExplorerSource,
    'private async preview(',
    'export class ServerExplorerTreeProvider'
  );
  const initialPreviewResolveIndex = serverPreviewSource.indexOf(
    'const item = this.provider.resolveObject(argument)'
  );
  const previewModalIndex = serverPreviewSource.indexOf('const decision = await vscode.window.showWarningMessage(');
  const confirmedPreviewResolveIndex = serverPreviewSource.indexOf(
    'const confirmedItem = this.provider.resolveObject(item)'
  );
  const confirmedConnectionIndex = serverPreviewSource.indexOf(
    'this.provider.currentConnectionFor(confirmedItem.snapshot)'
  );
  const runPreviewIndex = serverPreviewSource.indexOf('await runPreview(');
  assert.ok(
    initialPreviewResolveIndex >= 0 && initialPreviewResolveIndex < previewModalIndex &&
      previewModalIndex < confirmedPreviewResolveIndex &&
      confirmedPreviewResolveIndex < confirmedConnectionIndex &&
      confirmedConnectionIndex < runPreviewIndex,
    'Preview approval must re-resolve the same owned generation and active namespace before any q preview is run'
  );
  assert.match(
    serverPreviewSource,
    /await runPreview\([\s\S]*?buildServerPreviewQuery\(confirmedItem\.objectName, confirmedItem\.kind, limit\)[\s\S]*?stillCurrent\.id/
  );
  assert.match(featureControlsSource, /get<boolean>\('serverExplorer', false\)/);
  assert.match(featureControlsSource, /get<boolean>\('queryHistory', false\)/);
  assert.match(featureControlsSource, /this\.serverExplorer\.dispose\(\)/);
  assert.match(featureControlsSource, /this\.queryHistory\.dispose\(\)/);
  assert.match(extensionSource, /historyKind: hasSelection \? 'selection' : 'line'/);
  assert.match(extensionSource, /historyKind: 'script'/);
  assert.match(extensionSource, /manager\.executeInConfiguredNamespace\(connection, text, onIssued\)/);
  const executeQTextSource = sourceSection(
    extensionSource,
    'async function executeQText(',
    'function toPanelResult('
  );
  const targetSelectionIndex = executeQTextSource.indexOf('await activeConnectionForRun(store, manager)');
  const noTargetIndex = executeQTextSource.indexOf('if (!connection)');
  const rerunConfirmationIndex = executeQTextSource.indexOf('historyRerunRequiresConfirmation(');
  const latestTargetIndex = executeQTextSource.indexOf('const latestTarget = store.activeConnection()');
  const sameTargetIndex = executeQTextSource.indexOf('sameExecutionTarget(connection, latestTarget)');
  const resultsPanelIndex = executeQTextSource.indexOf('KxResultsPanel.showLoading(');
  const transportIssueIndex = executeQTextSource.indexOf('const executionPromise = request.transport');
  assert.ok(
    targetSelectionIndex >= 0 && targetSelectionIndex < noTargetIndex &&
      noTargetIndex < rerunConfirmationIndex && rerunConfirmationIndex < latestTargetIndex &&
      latestTargetIndex < sameTargetIndex && sameTargetIndex < resultsPanelIndex &&
      resultsPanelIndex < transportIssueIndex,
    'history reruns must select a target, confirm mismatches, then revalidate the exact target before panel creation or q issue'
  );
  assert.match(
    executeQTextSource,
    /historyRerunRequiresConfirmation\([\s\S]*?showWarningMessage\([\s\S]*?\{ modal: true \}[\s\S]*?'Rerun on Active Connection'/
  );
  assert.match(
    executeQTextSource,
    /if \(request\.recordedHistoryConnection\) \{[\s\S]*?store\.activeConnection\(\)[\s\S]*?sameExecutionTarget\(connection, latestTarget\)[\s\S]*?connection = latestTarget;/
  );
  const sameTargetSource = sourceSection(
    extensionSource,
    'function sameExecutionTarget(',
    'class QRunCodeLensProvider'
  );
  for (const field of ['id', 'host', 'port', 'database', 'username', 'connectTimeoutMs', 'queryTimeoutMs']) {
    assert.match(
      sameTargetSource,
      new RegExp(`left\\.${field} === right\\.${field}`),
      `history rerun target revalidation must include ${field}`
    );
  }
  const activeRunSource = sourceSection(
    extensionSource,
    'async function activeConnectionForRun(',
    'function updatePerfTraceSetting('
  );
  assert.match(activeRunSource, /const active = store\.activeConnection\(\);[\s\S]*?if \(active\) \{[\s\S]*?return active;/);
  assert.match(activeRunSource, /if \(!connections\.length\)[\s\S]*?return undefined;/);
  assert.match(
    activeRunSource,
    /let connection = connections\[0\];[\s\S]*?if \(connections\.length > 1\)[\s\S]*?setActiveConnection\(connection\.id\)/,
    'a sole configured but unrelated profile is selected as the target and still reaches the post-selection mismatch confirmation'
  );
  const historyRerunSource = sourceSection(historySource, 'private async rerun(', 'private async copy(');
  assert.match(historyRerunSource, /await runQuery\(entry\)/);
  assert.ok(!/Rerun on Active Connection|\{ modal: true \}/.test(historyRerunSource));
  assert.match(historySource, /connectionTree\.onDidChangeTreeData\(\(\) => this\.provider\.refresh\(\)\)/);

  const firstPartyCodeAndAssets = [
    path.join(ROOT, 'syntaxes', 'q.tmLanguage.json'),
    ...walkFiles(path.join(ROOT, 'icons')),
  ];
  firstPartyCodeAndAssets.forEach(file => {
    const content = fs.readFileSync(file).toString('latin1');
    assertNoVscodeQRuntimeReference(content, path.relative(ROOT, file));
    assertNoSqlToolsRuntimeReference(content, path.relative(ROOT, file));
    assert.ok(!/jshinonome/i.test(content), `${path.relative(ROOT, file)} must not contain q Professional assets/source`);
  });
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
    'scripts/**',
    'tmp/**',
    'docs/**',
    'mkdocs-src/**',
    'mkdocs.yml',
    'PARITY.md',
    '**/*.map',
    'CODEX*',
    'PROMPT*',
    '**/*.pem',
    '**/*.key',
    '**/*.p12',
    '**/*.pfx',
    '**/.npmrc',
    '**/coverage/**',
    '**/*.tar',
    '**/*.gz',
    '**/*.7z',
    '**/*.rar',
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

function modelQTable(columns, rows) {
  return {
    qtype: 'table',
    columns: columns.slice(),
    rows: rows.map(row => ({ ...row })),
    columnData: [],
    rowCount: rows.length,
  };
}

function historyEntry(overrides = {}) {
  return {
    id: 'entry-default',
    connectionId: 'kx-history',
    connectionName: 'History q',
    timestamp: 100,
    kind: 'line',
    status: 'succeeded',
    durationMs: 5,
    queryText: '1+1',
    ...overrides,
  };
}

function cloneMaybe(value) {
  return value === undefined ? undefined : cloneJson(value);
}

function createHistoryMemento(initialValue) {
  let stored = cloneMaybe(initialValue);
  const updates = [];
  return {
    get(key) {
      assert.strictEqual(key, QUERY_HISTORY_STORAGE_KEY);
      return cloneMaybe(stored);
    },
    async update(key, value) {
      assert.strictEqual(key, QUERY_HISTORY_STORAGE_KEY);
      await Promise.resolve();
      stored = cloneMaybe(value);
      updates.push(cloneMaybe(value));
    },
    get value() {
      return cloneMaybe(stored);
    },
    updates,
  };
}

function createBlockingHistoryMemento(initialValue) {
  let stored = cloneMaybe(initialValue);
  let firstUpdate = true;
  let markUpdateStarted;
  let releaseUpdate;
  const updateStarted = new Promise(resolve => {
    markUpdateStarted = resolve;
  });
  const gate = new Promise(resolve => {
    releaseUpdate = resolve;
  });
  const updates = [];
  return {
    get(key) {
      assert.strictEqual(key, QUERY_HISTORY_STORAGE_KEY);
      return cloneMaybe(stored);
    },
    async update(key, value) {
      assert.strictEqual(key, QUERY_HISTORY_STORAGE_KEY);
      if (firstUpdate) {
        firstUpdate = false;
        markUpdateStarted();
        await gate;
      }
      stored = cloneMaybe(value);
      updates.push(cloneMaybe(value));
    },
    get value() {
      return cloneMaybe(stored);
    },
    updateStarted,
    releaseUpdate,
    updates,
  };
}

function assertHistoryStorageShape(value) {
  assert.ok(Array.isArray(value));
  const allowed = ['connectionId', 'connectionName', 'durationMs', 'id', 'kind', 'queryText', 'status', 'timestamp'];
  value.forEach(entry => {
    assert.deepStrictEqual(Object.keys(entry).sort(), allowed);
    for (const forbidden of ['result', 'results', 'password', 'username', 'host', 'error', 'messages']) {
      assert.strictEqual(Object.prototype.hasOwnProperty.call(entry, forbidden), false);
    }
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function configurationEvent(changedKey) {
  return {
    affectsConfiguration(key) {
      return key === changedKey;
    },
  };
}

function createVscodeTreeHarness() {
  const warnings = [];
  const errors = [];
  const information = [];
  const createdTreeViews = [];
  const registeredCommands = new Map();
  const progressControllers = [];
  class EventEmitter {
    constructor() {
      this.listeners = new Set();
      this.event = listener => {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
      };
    }

    fire(value) {
      [...this.listeners].forEach(listener => listener(value));
    }

    dispose() {
      this.listeners.clear();
    }
  }
  class TreeItem {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  }
  class ThemeIcon {
    constructor(id, color) {
      this.id = id;
      this.color = color;
    }
  }
  const createCancellationController = () => {
    let canceled = false;
    const listeners = new Set();
    return {
      token: {
        get isCancellationRequested() {
          return canceled;
        },
        onCancellationRequested(listener) {
          listeners.add(listener);
          return { dispose: () => listeners.delete(listener) };
        },
      },
      cancel() {
        if (canceled) {
          return;
        }
        canceled = true;
        [...listeners].forEach(listener => listener());
      },
    };
  };
  const harness = {
    warnings,
    errors,
    information,
    createdTreeViews,
    registeredCommands,
    progressControllers,
    cancelLatestProgress() {
      assert.ok(progressControllers.length > 0, 'no cancellable progress operation was created');
      progressControllers.at(-1).cancel();
    },
    vscode: {
      EventEmitter,
      TreeItem,
      ThemeIcon,
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      ProgressLocation: { Notification: 15 },
      commands: {
        registerCommand(id, handler) {
          registeredCommands.set(id, handler);
          return { dispose: () => registeredCommands.delete(id) };
        },
      },
      window: {
        createTreeView(id, options) {
          const view = { id, options, disposed: false };
          createdTreeViews.push(view);
          return { dispose: () => { view.disposed = true; } };
        },
        async withProgress(_options, task) {
          const controller = createCancellationController();
          progressControllers.push(controller);
          return task({}, controller.token);
        },
        showWarningMessage(message) {
          warnings.push(message);
          return undefined;
        },
        showErrorMessage(message) {
          errors.push(message);
          return undefined;
        },
        showInformationMessage(message) {
          information.push(message);
          return undefined;
        },
      },
    },
  };
  return harness;
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

function assertNoVscodeQRuntimeReference(source, label) {
  const forbidden = [
    /jshinonome\/vscode-q/i,
    /(?:from|require\s*\()\s*['"][^'"]*vscode-q/i,
    /[\\/]vscode-q[\\/]/i,
  ];
  forbidden.forEach(pattern => assert.ok(
    !pattern.test(source),
    `${label} contains forbidden q Professional/vscode-q runtime source or asset reference ${pattern}`
  ));
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
