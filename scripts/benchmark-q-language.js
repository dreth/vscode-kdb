'use strict';

const assert = require('assert');
const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const esbuild = require('esbuild');
const {
  createMessageConnection,
  IPCMessageReader,
  IPCMessageWriter,
} = require('vscode-jsonrpc/node');

const ROOT = path.resolve(__dirname, '..');
const q = require(path.join(ROOT, 'out', 'q-language-testing.js'));
const MIB = 1024 * 1024;
const BASELINE_VSIX_BYTES = 675_395;

function mark(name, milliseconds) {
  process.stderr.write(`benchmark ${name}: ${milliseconds.toFixed(2)} ms\n`);
}

function elapsed(task) {
  const started = performance.now();
  const result = task();
  return { milliseconds: performance.now() - started, result };
}

async function elapsedAsync(task) {
  const started = performance.now();
  const result = await task();
  return { milliseconds: performance.now() - started, result };
}

function largeDocument() {
  const lines = [];
  for (let index = 0; index < 4_000; index++) {
    const suffix = String(index).padStart(5, '0');
    lines.push(`fn${suffix}:{[x] y:x+1;y}; result${suffix}:fn${suffix}[${index}]`);
  }
  return `${lines.join('\n')}\n`;
}

async function qnbCodec() {
  const result = await esbuild.build({
    absWorkingDir: ROOT,
    entryPoints: ['src/qnb-codec.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    write: false,
    logLevel: 'silent',
  });
  const module = { exports: {} };
  Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);
  return module.exports;
}

async function serverStartup() {
  const child = fork(path.join(ROOT, 'out', 'q-language-server.js'), ['--node-ipc'], {
    cwd: ROOT,
    silent: true,
  });
  const connection = createMessageConnection(
    new IPCMessageReader(child),
    new IPCMessageWriter(child)
  );
  connection.listen();
  try {
    await connection.sendRequest('initialize', {
      processId: process.pid,
      rootUri: null,
      capabilities: {},
      workspaceFolders: null,
    });
    connection.sendNotification('initialized', {});
    await connection.sendRequest('shutdown');
    connection.sendNotification('exit');
  } finally {
    connection.dispose();
    if (!child.killed) child.kill();
  }
}

async function main() {
  const heapBefore = process.memoryUsage().heapUsed;
  const sourceText = largeDocument();
  const sourceBytes = Buffer.byteLength(sourceText);
  assert(sourceBytes < 2 * MIB, 'benchmark fixture must exercise analysis below the degradation limit');

  const cold = elapsed(() => q.QSource.create('file:///benchmark-large.q', 1, sourceText));
  mark('cold parse/index', cold.milliseconds);
  const source = cold.result;
  const warm = elapsed(() => {
    for (let index = 0; index < 50; index++) {
      q.qCompletions(source, { line: index * 75, character: 2 });
      q.qHover(source, { line: index * 75, character: 2 });
    }
  });
  mark('warm providers', warm.milliseconds);
  const editDiagnostics = elapsed(() => q.diagnoseQSource(
    q.QSource.create('file:///benchmark-large.q', 2, `${sourceText.slice(0, -2)}]`),
    q.DEFAULT_Q_LANGUAGE_SETTINGS
  ));
  mark('edit to diagnostics', editDiagnostics.milliseconds);
  const formatting = elapsed(() => q.formatQDocument(
    q.QSource.create('file:///benchmark-format.q', 1, sourceText.slice(0, 300_000)),
    { insertSpaces: true, tabSize: 2 }
  ));
  mark('format', formatting.milliseconds);
  const workspace = elapsed(() => {
    const sources = [];
    for (let index = 0; index < 250; index++) {
      sources.push(q.QSource.create(
        `file:///workspace/lib${index}.q`,
        1,
        `workspaceValue${index}:${index}; workspaceFn${index}:{x+workspaceValue${index}}`
      ));
    }
    return q.qWorkspaceSymbols(sources, 'workspaceFn');
  });
  mark('workspace index', workspace.milliseconds);

  const codec = await qnbCodec();
  const qnbFixture = Array.from({ length: 1_000 }, (_, index) => ({
    kind: index % 5 === 0 ? 1 : 2,
    language: index % 5 === 0 ? 'markdown' : 'q',
    value: index % 5 === 0 ? `# note ${index}` : `show til ${index}`,
    metadata: { durable: index },
    outputs: [{ mime: 'text/plain', value: String(index) }],
  }));
  const qnbBytes = new TextEncoder().encode(JSON.stringify(qnbFixture));
  const qnbOpenSave = elapsed(() => codec.encodeQnb(codec.decodeQnb(qnbBytes)));
  mark('qnb open/save', qnbOpenSave.milliseconds);
  assert.strictEqual(codec.decodeQnb(qnbOpenSave.result).cells.length, qnbFixture.length);

  const startup = await elapsedAsync(serverStartup);
  mark('server initialize/shutdown', startup.milliseconds);
  const heapDeltaMiB = (process.memoryUsage().heapUsed - heapBefore) / MIB;
  const currentVsix = path.join(ROOT, 'vscode-kdb-0.2.24.vsix');
  const currentVsixBytes = fs.existsSync(currentVsix) ? fs.statSync(currentVsix).size : null;
  const report = {
    fixtureBytes: sourceBytes,
    coldParseIndexMs: Number(cold.milliseconds.toFixed(2)),
    warmProvider100RequestsMs: Number(warm.milliseconds.toFixed(2)),
    editToDiagnosticsMs: Number(editDiagnostics.milliseconds.toFixed(2)),
    format300kMs: Number(formatting.milliseconds.toFixed(2)),
    workspaceIndex250FilesMs: Number(workspace.milliseconds.toFixed(2)),
    qnbOpenSave1000CellsMs: Number(qnbOpenSave.milliseconds.toFixed(2)),
    serverInitializeShutdownMs: Number(startup.milliseconds.toFixed(2)),
    heapDeltaMiB: Number(heapDeltaMiB.toFixed(2)),
    baselineVsixBytes: BASELINE_VSIX_BYTES,
    currentVsixBytes,
    vsixDeltaBytes: currentVsixBytes === null ? null : currentVsixBytes - BASELINE_VSIX_BYTES,
  };

  assert(cold.milliseconds < 10_000, 'cold parse/index exceeded its deterministic ceiling');
  assert(warm.milliseconds < 3_000, 'warm providers exceeded their deterministic ceiling');
  assert(editDiagnostics.milliseconds < 10_000, 'edit-to-diagnostics exceeded its deterministic ceiling');
  assert(formatting.milliseconds < 10_000, 'formatter exceeded its deterministic ceiling');
  assert(workspace.milliseconds < 3_000, 'workspace index exceeded its deterministic ceiling');
  assert(qnbOpenSave.milliseconds < 3_000, '.qnb open/save exceeded its deterministic ceiling');
  assert(startup.milliseconds < 5_000, 'server startup exceeded its deterministic ceiling');
  assert(heapDeltaMiB < 384, 'language benchmark exceeded its heap-growth ceiling');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
