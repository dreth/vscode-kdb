'use strict';

const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const FIXTURE = path.join(__dirname, 'fixture.q');
const { KdbIpcClient, qValueToColumnarPanel } = requireOut('q-ipc');
const { qScriptInNamespace, queryInNamespace, queryInNamespaceStrict } = requireOut('connection');
const {
  CONNECTION_TEST_QUERY,
  connectionTestNamespaceQuery,
  connectionTestNamespaceResultIsSafe,
} = requireOut('connection-test');
const {
  SERVER_TABLES_QUERY,
  SERVER_VARIABLES_QUERY,
  buildServerPreviewQuery,
  buildServerTableMetaQuery,
  parseServerColumns,
  parseServerTableNames,
  parseServerVariables,
} = requireOut('server-explorer-model');

(async () => {
  const qPath = resolveQPath();
  if (!qPath) {
    const message = 'No q binary found. Set VSCODE_KDB_Q_BIN=/path/to/q to run the optional live test.';
    if (process.env.VSCODE_KDB_LIVE_REQUIRED === '1') {
      throw new Error(message);
    }
    console.log(`Skipping live q IPC test: ${message}`);
    return;
  }

  const port = await getFreePort();
  const processState = startQ(qPath, port);
  try {
    await waitForPort(port, processState, 15000);
    await runAssertions(port);
    console.log(`Live direct q IPC test passed using ${qPath}`);
  } finally {
    await stopQ(processState.child);
  }
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

async function runAssertions(port) {
  const client = new KdbIpcClient({ host: '127.0.0.1', port, timeoutMs: 2000 });
  try {
    await client.connect();
    assert.ok(client.getProtocolVersion() >= 1);
    assert.strictEqual(await client.query('1+1'), 2);
    const assignment = await client.query('rootVector:rootVector');
    assert.deepStrictEqual(assignment, { qtype: 'generalNull' });
    assert.deepStrictEqual(qValueToColumnarPanel(assignment), {
      mode: 'text',
      text: '::',
      kind: 'no value',
      rowsMaterialized: true,
    });
    assert.strictEqual(qValueToColumnarPanel(await client.query('()')).mode, 'text');
    const zeroRowTable = qValueToColumnarPanel(await client.query('([]a:`int$())'));
    assert.strictEqual(zeroRowTable.mode, 'grid');
    assert.deepStrictEqual(zeroRowTable.cols, ['a']);
    assert.strictEqual(zeroRowTable.result.rowCount, 0);

    const temporaryTestClient = new KdbIpcClient({
      host: '127.0.0.1',
      port,
      connectTimeoutMs: 2000,
      queryTimeoutMs: 2000,
    });
    try {
      await temporaryTestClient.connect();
      const namespaceResult = await temporaryTestClient.query(connectionTestNamespaceQuery('.analytics'));
      assert.strictEqual(connectionTestNamespaceResultIsSafe(namespaceResult), true);
      assert.strictEqual(await temporaryTestClient.query(CONNECTION_TEST_QUERY), false);
      assert.strictEqual(
        await temporaryTestClient.query('string system"d"'),
        '.',
        'the read-only namespace test must leave the temporary session at its original namespace'
      );
    } finally {
      await temporaryTestClient.close();
    }
    assert.strictEqual(await client.query('1+1'), 2, 'temporary testing must not disrupt the active saved session');

    const table = qValueToColumnarPanel(await client.query('select sym,size from trade'));
    assert.strictEqual(table.mode, 'grid');
    assert.deepStrictEqual(table.cols, ['sym', 'size']);
    assert.deepStrictEqual(
      table.result.cellWindow({ start: 0, end: 1 }, { start: 0, end: 1 }).cells,
      [['AAPL', '100'], ['MSFT', '250']]
    );

    assert.deepStrictEqual(
      parseServerTableNames(await client.query(queryInNamespaceStrict(SERVER_TABLES_QUERY, '.'))),
      { names: ['trade'], omittedUnsafeNames: 0 }
    );
    assert.deepStrictEqual(
      parseServerTableNames(await client.query(queryInNamespaceStrict(SERVER_TABLES_QUERY, '.analytics'))),
      { names: ['quote'], omittedUnsafeNames: 0 },
      'table listing must use only the configured active namespace'
    );

    const rootVariables = parseServerVariables(
      await client.query(queryInNamespaceStrict(SERVER_VARIABLES_QUERY, '.'))
    ).variables;
    assert.deepStrictEqual(
      rootVariables.map(item => [item.name, item.kind]),
      [['rootFunction', 'function'], ['rootVector', 'variable']]
    );
    const analyticsVariables = parseServerVariables(
      await client.query(queryInNamespaceStrict(SERVER_VARIABLES_QUERY, '.analytics'))
    ).variables;
    assert.deepStrictEqual(
      analyticsVariables.map(item => [item.name, item.kind]),
      [['analyticsFunction', 'function'], ['analyticsVector', 'variable'], ['answer', 'variable']]
    );

    const quoteColumns = parseServerColumns(await client.query(queryInNamespaceStrict(
      buildServerTableMetaQuery('quote'),
      '.analytics'
    )));
    assert.deepStrictEqual(quoteColumns.map(column => [column.name, column.qTypeCode]), [
      ['sym', 's'],
      ['size', 'j'],
    ]);

    const quotePreview = qValueToColumnarPanel(await client.query(queryInNamespaceStrict(
      buildServerPreviewQuery('quote', 'table', 3),
      '.analytics'
    )));
    assert.strictEqual(quotePreview.mode, 'grid');
    assert.strictEqual(quotePreview.result.rowCount, 1, 'three cells over two columns must cap preview to one row');
    assert.deepStrictEqual(
      quotePreview.result.cellWindow({ start: 0, end: 0 }, { start: 0, end: 1 }).cells,
      [['AAPL', '100']]
    );
    assert.deepStrictEqual(
      await client.query(queryInNamespaceStrict(
        buildServerPreviewQuery('analyticsVector', 'variable', 3),
        '.analytics'
      )),
      [0, 1, 2],
      'variable previews must be capped server-side without retrieving the full vector'
    );
    assert.throws(
      () => buildServerPreviewQuery('analyticsFunction', 'function', 3),
      /limited to tables and variables/,
      'known functions must never receive a Preview query'
    );
    await assert.rejects(
      () => client.query(queryInNamespaceStrict(
        buildServerPreviewQuery('analyticsFunction', 'variable', 3),
        '.analytics'
      )),
      error => error && error.name === 'KdbQError' && /Function and projection previews are disabled/.test(error.message),
      'the runtime q type check must reject a function even when a stale/malformed item claims it is a variable'
    );
    assert.strictEqual(await client.query('string system "d"'), '.', 'rejected previews must restore the root namespace');
    await assert.rejects(
      () => client.query(queryInNamespaceStrict(buildServerTableMetaQuery('missingTable'), '.analytics')),
      error => error && error.name === 'KdbQError' && /missingTable/.test(error.message)
    );
    assert.strictEqual(await client.query('string system "d"'), '.', 'missing meta must restore the root namespace');

    assert.strictEqual(
      await client.query(queryInNamespaceStrict('string system "d"', '.')),
      '.',
      'strict root execution must explicitly enter the configured root namespace'
    );
    assert.strictEqual(
      await client.query(queryInNamespaceStrict('string system "d"', '.analytics')),
      '.analytics'
    );
    assert.strictEqual(await client.query('string system "d"'), '.');
    assert.strictEqual(
      await client.query(queryInNamespaceStrict('system "d .analytics";answer', '.')),
      42
    );
    assert.strictEqual(await client.query('string system "d"'), '.', 'strict root success must restore root');
    await assert.rejects(
      () => client.query(queryInNamespaceStrict('system "d .analytics";missingStrictRoot', '.')),
      error => error && error.name === 'KdbQError' && /missingStrictRoot/.test(error.message)
    );
    assert.strictEqual(await client.query('string system "d"'), '.', 'strict root errors must restore root');
    await assert.rejects(
      () => client.query(queryInNamespaceStrict('system "d .";missingStrictAnalytics', '.analytics')),
      error => error && error.name === 'KdbQError' && /missingStrictAnalytics/.test(error.message)
    );
    assert.strictEqual(await client.query('string system "d"'), '.', 'strict non-root errors must restore root');

    assert.strictEqual(await client.query(queryInNamespace('answer', '.analytics')), 42);
    assert.strictEqual(await client.query(queryInNamespace('1', '.analytics')), 1);
    assert.strictEqual(
      await client.query(qScriptInNamespace('scriptA:1\nscriptB:2\nscriptA+scriptB', '.analytics')),
      3
    );
    assert.strictEqual(
      await client.query(qScriptInNamespace('selectionA:10\nselectionB:20\nselectionA+selectionB', '.analytics')),
      30,
      'the q-native grouping used for multiline selections must evaluate every selected line'
    );
    assert.strictEqual(
      await client.query(qScriptInNamespace('scriptFn:{[x]\r\n x+1\r\n }\r\nscriptFn 4', '.analytics')),
      5
    );
    assert.deepStrictEqual(
      await client.query(qScriptInNamespace('stoppedBefore:1\n\\\nstoppedAfter:1', '.analytics')),
      { qtype: 'generalNull' }
    );
    assert.strictEqual(await client.query('`stoppedBefore in key `.analytics'), true);
    assert.strictEqual(await client.query('`stoppedAfter in key `.analytics'), false);
    assert.strictEqual(await client.query('string system "d"'), '.');
    await assert.rejects(
      () => client.query(qScriptInNamespace('beforeFailure:1\nmissingScriptName', '.analytics')),
      error => error && error.name === 'KdbQError' && /missingScriptName/.test(error.message)
    );
    assert.strictEqual(await client.query('string system "d"'), '.', 'script errors must restore the prior namespace');
    await assert.rejects(
      () => client.query('missingSymbolForVscodeKdbLiveTest'),
      error => error && error.name === 'KdbQError' && /missingSymbolForVscodeKdbLiveTest/.test(error.message)
    );
  } finally {
    await client.close();
  }
}

function requireOut(moduleName) {
  for (const candidate of [path.join(ROOT, 'out', moduleName), path.join(ROOT, 'out', 'src', moduleName)]) {
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

function resolveQPath() {
  if (process.env.VSCODE_KDB_Q_BIN) {
    const override = path.resolve(process.env.VSCODE_KDB_Q_BIN);
    if (!fs.existsSync(override)) {
      throw new Error(`VSCODE_KDB_Q_BIN does not exist: ${override}`);
    }
    return override;
  }

  const candidates = [
    path.join(process.env.HOME || '', '.kx', 'bin', qExecutableName()),
    path.join('/opt/data/home/.kx/bin', qExecutableName()),
    ...String(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(entry => path.join(entry, qExecutableName())),
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function qExecutableName() {
  return process.platform === 'win32' ? 'q.exe' : 'q';
}

function startQ(qPath, port) {
  const child = cp.spawn(qPath, [FIXTURE, '-p', `127.0.0.1:${port}`], {
    cwd: ROOT,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const state = { child, output: '', spawnError: null };
  const capture = chunk => {
    state.output = `${state.output}${chunk}`.slice(-8000);
    if (process.env.VSCODE_KDB_LIVE_VERBOSE === '1') {
      process.stderr.write(chunk);
    }
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.once('error', error => {
    state.spawnError = error;
  });
  return state;
}

async function stopQ(child) {
  if (!child || child.exitCode !== null || child.signalCode) {
    return;
  }
  child.stdin.write('\\\\\n');
  child.stdin.end();
  const exited = await Promise.race([
    new Promise(resolve => child.once('exit', () => resolve(true))),
    delay(2000).then(() => false),
  ]);
  if (!exited) {
    child.kill('SIGTERM');
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForPort(port, state, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (state.spawnError) {
      throw new Error(`Could not start q: ${state.spawnError.message}`);
    }
    if (state.child.exitCode !== null) {
      throw new Error(`q exited before opening port ${port}.\n${state.output}`);
    }
    if (await canConnect(port)) {
      return;
    }
    await delay(75);
  }
  throw new Error(`Timed out waiting for q on 127.0.0.1:${port}.\n${state.output}`);
}

function canConnect(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const done = value => {
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(300, () => done(false));
  });
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
