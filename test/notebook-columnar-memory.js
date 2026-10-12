'use strict';

// Large enough that the old per-cell envelope necessarily exceeds V8's string
// limit. Run with --max-old-space-size=1024 --expose-gc.
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { constants } = require('node:buffer');
const root = process.env.VSCODE_KDB_TEST_OUT_ROOT || path.join(__dirname, '..', 'out');
class NotebookData { constructor(cells) { this.cells = cells; } }
class NotebookCellData {
  constructor(kind, value, languageId) { Object.assign(this, { kind, value, languageId, metadata: {}, outputs: [] }); }
}
class NotebookCellOutput { constructor(items, metadata) { Object.assign(this, { items, metadata }); } }
class NotebookCellOutputItem {
  constructor(data, mime) { Object.assign(this, { data, mime }); }
  static text(text, mime = 'text/plain') { return new NotebookCellOutputItem(Buffer.from(text), mime); }
}
const originalLoad = Module._load;
Module._load = function(name, ...args) {
  return name === 'vscode' ? {
    NotebookCellKind: { Code: 2, Markup: 1 }, NotebookData, NotebookCellData,
    NotebookCellOutput, NotebookCellOutputItem,
  } : originalLoad.call(this, name, ...args);
};
const { directQResultOutputItems, directQPortableResult } = require(root + '/notebook-controller.js');
const { QnbNotebookSerializer } = require(root + '/qnb-notebook.js');
Module._load = originalLoad;
const { qVector, qAtom, qSpecial } = require(root + '/q-value.js');
const { validatePortableKxResult, portableTableCell, portableTableRowCount } = require(root + '/notebook-contract.js');
const { inspectNotebookKxOutputIdentity } = require(root + '/notebook-message.js');
const { NotebookOutputOwnershipCache } = require(root + '/notebook-output-ownership.js');
const rows = 600000;
const cols = 14;
const outputId = 'columnar-memory-' + 'a'.repeat(32);
const liveId = 'columnar-live-' + 'b'.repeat(32);
const types = ['symbol', 'int', 'timestamp', ...Array(cols - 3).fill('long')];
const expected = (row, col) => col === 0 ? (row === rows - 1 ? 'ZZTAIL' : 'XAUUSD')
  : col === 1 ? row
  : row === rows - 1 ? qSpecial('null')
  : col === 2 ? '123456789012345678' : '9223372036854775806';
let stage = "fixture";
(async () => {
  const oldRow = types.map((type, col) => ({ kind: 'q', version: 1, value: {
    form: 'atom', type, value: expected(0, col),
  } }));
  const oldMinimumCharacters = JSON.stringify(oldRow).length * rows;
  assert(oldMinimumCharacters > constants.MAX_STRING_LENGTH,
    'the fixture must exercise output beyond the old single-string ceiling');
  let table = {
    qtype: 'table', columns: types.map((_type, c) => 'c' + c), columnTypes: types,
    columnData: types.map((type, col) => qVector(Array.from({ length: rows }, (_value, row) => expected(row, col)), type, col === 0 ? 1 : 0)),
    rowCount: rows,
  };
  Object.defineProperty(table, 'rows', { get() { throw new Error('large native rows must never be materialized'); } });
  const connection = { name: 'columnar • memory', database: '.' };
  const start = performance.now();
  // Exercise both retention settings through the same first-party producer.
  stage = "positive creation";
  let positive = directQPortableResult(table, { rowLimit: 20, byteLimit: 1000000 }, {}, connection, 1, outputId);
  assert.equal(positive.ok, true, positive.error);
  assert.equal(positive.value.version, 4);
  assert.equal(positive.value.result.rowCount, rows);
  positive = null;
  global.gc?.();
  stage = "zero creation";
  const items = directQResultOutputItems(table, { rowLimit: 0, byteLimit: 1000000 }, {}, connection, 1, outputId);
  const createMs = Math.round(performance.now() - start);
  table = null;
  global.gc?.();
  const metadata = {
    'vscode-kdb.outputBinding': { version: 1, id: outputId },
    'vscode-kdb.liveResult': { version: 1, id: liveId },
  };
  stage = "ownership";
  const cache = new NotebookOutputOwnershipCache();
  assert.equal(cache.inspect(metadata, items).status, 'valid');
  const originalParse = JSON.parse;
  JSON.parse = () => { throw new Error('unchanged ownership must not parse again'); };
  try { for (let i = 0; i < 100; i++) assert.equal(cache.inspect(metadata, items).status, 'valid'); }
  finally { JSON.parse = originalParse; cache.clear(); }
  global.gc?.();
  const input = new NotebookData([new NotebookCellData(2, 'columnarFixture[]', 'q')]);
  input.cells[0].outputs = [new NotebookCellOutput(items, metadata)];
  const serializer = new QnbNotebookSerializer();
  const saveStart = performance.now();
  stage = "save";
  let saved = await serializer.serializeNotebook(input, {});
  const saveMs = Math.round(performance.now() - saveStart);
  const savedBytes = saved.byteLength;
  assert(savedBytes < oldMinimumCharacters / 4);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-kdb-columnar-'));
  let disk;
  let writeMs;
  try {
    const filename = path.join(directory, 'large.qnb');
    const writeStart = performance.now(); fs.writeFileSync(filename, saved);
    writeMs = Math.round(performance.now() - writeStart);
    disk = fs.readFileSync(filename);
    assert.deepEqual(disk, Buffer.from(saved));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  saved = null;
  global.gc?.();
  stage = "reopen";
  const reopened = await serializer.deserializeNotebook(disk, {});
  disk = null;
  global.gc?.();
  assert.equal(reopened.cells[0].value, 'columnarFixture[]');
  const restored = reopened.cells[0].outputs[0];
  assert.equal(restored.metadata['vscode-kdb.liveResult'], undefined);
  assert.equal(restored.metadata['vscode-kdb.outputBinding'].id, outputId);
  assert.deepEqual(Buffer.from(restored.items[0].data), items[0].data);
  stage = "verify";
  const payload = JSON.parse(Buffer.from(restored.items[0].data).toString('utf8'));
  const checked = validatePortableKxResult(payload);
  assert.equal(checked.ok, true, checked.error);
  assert.equal(payload.version, 4);
  assert.equal(payload.data.rows, undefined);
  assert.equal(portableTableRowCount(payload), rows);
  assert.deepEqual(payload.schema.columnAttributes, [{ ordinal: 0, attribute: 1 }]);
  for (let col = 0; col < cols; col++) {
    assert.equal(payload.data.columns[col].type, types[col]);
    assert.equal(portableTableRowCount(payload), rows);
    for (let row = 0; row < rows - 1; row++) assert.equal(portableTableCell(payload, row, col).value.value, expected(row, col));
    assert.deepEqual(portableTableCell(payload, rows - 1, col).value,
      { form: 'atom', type: types[col], value: expected(rows - 1, col) });
  }
  assert.equal(inspectNotebookKxOutputIdentity(restored.metadata,
    [{ mime: items[0].mime, value: payload }]).status, 'valid');
  console.log(JSON.stringify({ rows, columns: cols, version: 4, oldMinimumMiChars: oldMinimumCharacters / 1048576,
    mimeMiB: items[0].data.byteLength / 1048576, savedMiB: savedBytes / 1048576,
    createMs, saveMs, writeMs, heapLimitMiB: 1024, rssMiB: process.memoryUsage().rss / 1048576 }));
})().catch(error => { console.error({ stage, message: error.message, stack: error.stack }); process.exitCode = 1; });
