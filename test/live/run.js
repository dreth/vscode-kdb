'use strict';

const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const FIXTURE = path.join(__dirname, 'fixture.q');
const { KdbIpcClient, qValueToColumnarPanel } = requireOut('q-ipc');
const { qScriptInNamespace, queryInNamespace } = requireOut('connection');

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

    const table = qValueToColumnarPanel(await client.query('select sym,size from trade'));
    assert.strictEqual(table.mode, 'grid');
    assert.deepStrictEqual(table.cols, ['sym', 'size']);
    assert.deepStrictEqual(
      table.result.cellWindow({ start: 0, end: 1 }, { start: 0, end: 1 }).cells,
      [['AAPL', '100'], ['MSFT', '250']]
    );

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
    assert.strictEqual(
      await client.query(qScriptInNamespace('stoppedBefore:1\n\\\nstoppedAfter:1', '.analytics')),
      null
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
