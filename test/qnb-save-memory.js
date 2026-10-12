'use strict';

// Run with --max-old-space-size=384 --expose-gc. Model the real VS Code JSON
// factory, not a compact mock, without retaining a second fixture object tree.
const assert = require('node:assert/strict');
const Module = require('node:module');
const { performance } = require('node:perf_hooks');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = process.env.VSCODE_KDB_TEST_OUT_ROOT || require('node:path').join(__dirname, '..', 'out');
class NotebookData { constructor(cells) { this.cells = cells; } }
class NotebookCellData {
  constructor(kind, value, languageId) { Object.assign(this, { kind, value, languageId, metadata: {}, outputs: [] }); }
}
class NotebookCellOutput { constructor(items, metadata) { Object.assign(this, { items, metadata }); } }
class NotebookCellOutputItem { constructor(data, mime) { Object.assign(this, { data, mime }); } }
const originalLoad = Module._load;
Module._load = function(name, ...args) {
  return name === 'vscode'
    ? { NotebookCellKind: { Code: 2, Markup: 1 }, NotebookData, NotebookCellData, NotebookCellOutput, NotebookCellOutputItem }
    : originalLoad.call(this, name, ...args);
};
const { QnbNotebookSerializer } = require(root + '/qnb-notebook.js');
Module._load = originalLoad;
const mime = 'application/vnd.kx.result+json';
const rowCount = 60000;
const columnCount = 14;
const row = Array.from({ length: columnCount }, (_, c) => ({ kind: 'q', version: 1, value: {
  form: 'atom', type: c === 0 ? 'symbol' : 'long', value: c === 0 ? 'XAUUSD' : '9223372036854775806',
} }));
const payloadHeader = {
  version: 2, outputId: 'memory-test-' + 'a'.repeat(32),
  persistence: { mode: 'full', previewRowLimit: 1000, byteLimit: 1048576 }, kind: 'table',
  schema: { columns: row.map((_, c) => ({ name: 'c' + c, type: c === 0 ? 'symbol' : 'long' })) },
  result: { rowCount, columnCount, previewRowCount: rowCount, truncated: false, truncationReasons: [], rowLimit: 1000, byteLimit: 1048576 },
  provenance: { marker: 'direct-ipc', label: 'memory • Direct IPC • .' },
};
function fixtureBytes() {
  const prettyRow = JSON.stringify(row, undefined, '\t').split('\n').map(line => '\t\t\t' + line).join('\n');
  const header = JSON.stringify(payloadHeader, undefined, '\t').slice(0, -2);
  const encoder = new TextEncoder();
  const prefix = encoder.encode(header + ',\n\t"data":{"encoding":"rows","rows":[\n');
  const rowBytes = encoder.encode(prettyRow + ',\n');
  const tail = encoder.encode(prettyRow + '\n]}}');
  const result = new Uint8Array(prefix.length + rowBytes.length * (rowCount - 1) + tail.length);
  result.set(prefix);
  let offset = prefix.length;
  for (let n = 1; n < rowCount; n++) { result.set(rowBytes, offset); offset += rowBytes.length; }
  result.set(tail, offset);
  return result;
}
(async () => {
  const item = new NotebookCellOutputItem(fixtureBytes(), mime);
  const input = new NotebookData([new NotebookCellData(2, 'memoryFixture[]', 'q')]);
  input.cells[0].outputs = [new NotebookCellOutput([item], {
    'vscode-kdb.outputBinding': { version: 1, id: payloadHeader.outputId },
    'vscode-kdb.liveResult': { version: 1, id: 'transient-session' },
  })];
  global.gc?.();
  const serializer = new QnbNotebookSerializer();
  const start = performance.now();
  const saved = await serializer.serializeNotebook(input, {});
  const serializeMs = Math.round(performance.now() - start);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-kdb-qnb-memory-'));
  let diskBytes;
  let writeMs;
  try {
    const filename = path.join(directory, 'roundtrip.qnb');
    const writeStart = performance.now();
    fs.writeFileSync(filename, saved);
    writeMs = Math.round(performance.now() - writeStart);
    diskBytes = fs.readFileSync(filename);
    assert.deepEqual(diskBytes, Buffer.from(saved));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  global.gc?.();
  const repeated = await serializer.serializeNotebook(input, {});
  assert.deepEqual(repeated, saved);
  global.gc?.();
  const reopened = await serializer.deserializeNotebook(diskBytes, {});
  assert.equal(reopened.cells[0].value, 'memoryFixture[]');
  assert.equal(reopened.cells[0].outputs[0].metadata['vscode-kdb.liveResult'], undefined);
  assert.equal(reopened.cells[0].outputs[0].metadata['vscode-kdb.outputBinding'].id, payloadHeader.outputId);
  global.gc?.();
  const payload = JSON.parse(new TextDecoder().decode(reopened.cells[0].outputs[0].items[0].data));
  assert.equal(payload.outputId, payloadHeader.outputId);
  assert.equal(payload.data.rows.length, rowCount);
  for (const actualRow of payload.data.rows) assert.deepEqual(actualRow, row);
  const { validatePortableKxResult } = require(root + '/notebook-contract.js');
  const validation = validatePortableKxResult(payload);
  assert.equal(validation.ok, true, validation.error);
  assert(saved.byteLength < item.data.byteLength * 0.7);
  console.log(JSON.stringify({ rows: rowCount, columns: columnCount, inputMiB: item.data.byteLength / 1048576,
    savedMiB: saved.byteLength / 1048576, serializeMs, writeMs, heapLimitMiB: 384, rssMiB: process.memoryUsage().rss / 1048576 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
