'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PYTHON_SOURCE = String.raw`
import datetime as dt
import json
from kx_notebook import Chart, build_mime_bundle

output = build_mime_bundle(
    [
        {"time": dt.datetime(2026, 7, 22, 9, 0, tzinfo=dt.timezone.utc), "price": 10.5, "meta": {"safe": True}},
        {"time": dt.datetime(2026, 7, 22, 9, 1, tzinfo=dt.timezone.utc), "price": 11.0, "meta": {"safe": False}},
    ],
    row_count=20,
    row_limit=1000,
    byte_limit=1000000,
    label="cross-language fixture",
    chart=Chart("line", "time", ("price",), title="Price"),
)
print(json.dumps({"bundle": output.bundle, "bodyBytes": output.body_bytes}, ensure_ascii=False, allow_nan=False, separators=(",", ":")))
`;

const run = spawnSync('uv', [
  'run',
  '--python',
  '3.9',
  '--no-project',
  '--with-editable',
  './python/kx_notebook',
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
const payload = emitted.bundle[contract.KX_NOTEBOOK_MIME];
const validation = contract.validatePortableKxResult(payload);
assert.strictEqual(validation.ok, true, validation.error);
assert.ok(emitted.bodyBytes <= payload.result.byteLimit);
assert.ok(emitted.bundle['text/html'].includes('<svg'));
assert.ok(emitted.bundle['text/html'].includes('omitted rows are not embedded'));
assert.ok(emitted.bundle['text/plain'].includes('Schema:'));
assert.strictEqual(contract.notebookResultToCsv(validation.value).split('\n').length, 3);
assert.ok(contract.notebookResultStaticHtml(validation.value).includes('<svg'));
process.stdout.write('ok - Python helper payload validates and renders through the TypeScript v1 contract\n');
