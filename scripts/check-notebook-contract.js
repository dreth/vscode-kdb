'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PYTHON_SOURCE = String.raw`
import datetime as dt
import importlib.metadata
import json
from kx_notebook import Chart, QText, build_mime_bundle

table = build_mime_bundle(
    [
        {"minute": 0, "time": dt.datetime(2026, 7, 22, 9, 0, tzinfo=dt.timezone.utc), "price": 10.5, "meta": {"safe": True}},
        {"minute": 1, "time": dt.datetime(2026, 7, 22, 9, 1, tzinfo=dt.timezone.utc), "price": 11.0, "meta": {"safe": False}},
    ],
    row_count=20,
    row_limit=1000,
    byte_limit=1000000,
    label="cross-language fixture",
    chart=Chart("line", "minute", ("price",), title="Price"),
)
qtext = build_mime_bundle(
    QText("sym time price\n------------------------------\nAAPL 09:00 10.5"),
    label="qText fixture",
)
print(json.dumps({
    "packageVersion": importlib.metadata.version("kx-notebook"),
    "table": {"bundle": table.bundle, "bodyBytes": table.body_bytes},
    "qtext": {"bundle": qtext.bundle, "bodyBytes": qtext.body_bytes},
}, ensure_ascii=False, allow_nan=False, separators=(",", ":")))
`;

const run = spawnSync('uv', [
  'run',
  '--python',
  '3.9',
  '--no-project',
  '--with',
  'kx-notebook==0.1.0',
  'python',
  '-c',
  PYTHON_SOURCE,
], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 4 * 1024 * 1024,
});
if (run.error) {
  throw run.error;
}
if (run.status !== 0) {
  process.stderr.write(run.stderr);
  process.exit(run.status ?? 1);
}

const emitted = JSON.parse(run.stdout);
const contract = require(path.join(ROOT, 'out', 'notebook-contract.js'));
assert.strictEqual(emitted.packageVersion, '0.1.0');

const tablePayload = emitted.table.bundle[contract.KX_NOTEBOOK_MIME];
const tableValidation = contract.validatePortableKxResult(tablePayload);
assert.strictEqual(tableValidation.ok, true, tableValidation.error);
assert.ok(emitted.table.bodyBytes <= tablePayload.result.byteLimit);
assert.ok(emitted.table.bundle['text/html'].includes('<svg'));
assert.ok(emitted.table.bundle['text/html'].includes('omitted rows are not embedded'));
assert.ok(emitted.table.bundle['text/plain'].includes('Schema:'));
assert.strictEqual(contract.notebookResultToCsv(tableValidation.value).split('\n').length, 3);
assert.ok(contract.notebookResultStaticHtml(tableValidation.value).includes('<svg'));

const qtextPayload = emitted.qtext.bundle[contract.KX_NOTEBOOK_MIME];
const qtextValidation = contract.validatePortableKxResult(qtextPayload);
assert.strictEqual(qtextValidation.ok, true, qtextValidation.error);
assert.ok(emitted.qtext.bodyBytes <= qtextPayload.result.byteLimit);
assert.strictEqual(qtextValidation.value.kind, 'qText');
assert.ok(emitted.qtext.bundle['text/plain'].includes('AAPL'));
assert.ok(contract.notebookResultStaticHtml(qtextValidation.value).includes('AAPL'));

process.stdout.write('ok - released kx-notebook 0.1.0 table, chart, and qText payloads validate and render through the TypeScript v1 contract\n');
