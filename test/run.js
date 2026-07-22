'use strict';

const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const net = require('net');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const {
  KdbIpcClient,
  QIpcReceiveBuffer,
  deserializeQMessage,
  deserializeQPayload,
  qValueRowsMaterialized,
  qValueToColumnarPanel,
  serializeTextQuery,
} = requireOut('q-ipc');
const { qSelectionExecutionKind, selectedTextOrCurrentLine } = requireOut('q-text');
const {
  connectionEndpoint,
  normalizeNamespace,
  qScriptInNamespace,
  qString,
  queryInNamespace,
  safeStoredConnections,
  validateConnection,
} = requireOut('connection');
const {
  createColumnarPanelResult,
  rowsToColumnarPanelResult,
} = requireOut('kx-results');

const tests = [
  ['q IPC codec and receive buffering', testQIpc],
  ['exact q selection/current-line text', testQText],
  ['connection validation and namespace wrapping', testConnections],
  ['connection SecretStorage transactions', testConnectionStoreTransactions],
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

  assert.deepStrictEqual(
    safeStoredConnections([connection, { ...connection, id: 'bad', name: 'Local q' }, null, 'bad']),
    [connection],
    'invalid or duplicate hand-edited settings must be ignored'
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
  assert.deepStrictEqual(Object.keys(harness.connections[0]).sort(), ['database', 'host', 'id', 'name', 'port', 'username']);
  assert.strictEqual(harness.activeId, connection.id);
  assert.strictEqual(harness.secretFor(connection.id), firstAuthValue);

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

  harness.failSecretDelete = 1;
  await assert.rejects(() => store.remove(connection.id), /injected SecretStorage delete failure/);
  assert.strictEqual(harness.connections.length, 1);
  assert.strictEqual(harness.activeId, connection.id);
  assert.strictEqual(harness.secretFor(connection.id), firstAuthValue);

  await store.remove(connection.id);
  assert.deepStrictEqual(harness.connections, []);
  assert.strictEqual(harness.activeId, undefined);
  assert.strictEqual(harness.secretFor(connection.id), undefined);
}

async function testConnectionManagerLifecycle() {
  const fakeVscode = createVscodeRuntimeMock();
  class FakeKdbQError extends Error {}
  class FakeKdbIpcClient {
    constructor(options) {
      this.options = options;
      this.closed = false;
    }

    async connect() {}

    async close() {
      this.closed = true;
      if (this.options.onDidClose) {
        this.options.onDidClose();
      }
    }

    cancel() {
      this.closed = true;
    }

    async query() {
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
  await assert.rejects(() => retryManager.connect(connection), /injected SecretStorage get failure/);
  await retryManager.connect(connection);
  assert.strictEqual(passwordAttempts, 2, 'a failed secret lookup must not poison later connection attempts');
  assert.strictEqual(retryManager.isConnected(connection.id), true);
  await retryManager.disconnectAll();
  assert.strictEqual(retryManager.isConnected(connection.id), false);
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
  assert.strictEqual(manifest.version, '0.1.1');
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
  assert.deepStrictEqual(storedFields, ['database', 'host', 'id', 'name', 'port', 'username']);
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
  assert.ok(!/password/i.test(safeBlock), 'serialized connection settings must never include passwords');

  const vscodeIgnore = fs.readFileSync(path.join(ROOT, '.vscodeignore'), 'utf8');
  ['src/**', 'test/**', 'tmp/**', '**/*.map', 'CODEX*', 'PROMPT*', '*.vsix', '*.zip'].forEach(pattern => {
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

function createVscodeRuntimeMock() {
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
        return { get: (_key, fallback) => fallback };
      },
    },
  };
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
