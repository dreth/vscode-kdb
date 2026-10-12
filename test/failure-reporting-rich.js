'use strict';
const assert = require('node:assert/strict');
const { FailureReporter, reduceFailureReport } = require('../out/failure-reporting');
const { safeFailure, safeOperationDetails, parseFailureMessage } = require('../out/failure-record');
async function main() {
  const sent = [];
  let snapshots = 0;
  const reporter = new FailureReporter({ artifactRoots: ['/extension/'],
    environment: () => { snapshots++; return { kxVersion: '0.2.43', nodeVersion: '22.15.1', platform: 'linux',
      arch: 'x64', processUptimeSeconds: 10, freeMemory: 1024, versions: { v8: '12.4.1', secret: 'PRIVATE' },
      resourceUsage: { userCPUTime: 12, maxRSS: 2048, secret: 'PRIVATE' },
      heapStatistics: { heap_size_limit: 10000 }, settings: { 'notebook.presentation': 'both',
        'queryTimeoutMs': 0, 'results.showRowIndex': false, 'results.density': 'PRIVATE' },
      buildId: 'a'.repeat(64), query: 'PRIVATE' }; },
    send: async (_url, body) => sent.push(JSON.parse(body)) });
  reporter.breadcrumb('ipc', 'handshake', { status: 'success', protocolVersion: 3 });
  assert.equal(snapshots, 0);
  reporter.configure({ reportServerUrl: 'https://reports.example.test' });
  const details = { operationId: 'kx-12-1', surface: 'results', phase: 'query', status: 'failed',
    transport: 'ipc', attemptCount: 1, connected: false, durationMs: 0, query: 'PRIVATE', rowCount: Infinity };
  reporter.breadcrumb('ipc', 'handshake', { operationId: details.operationId, status: 'success', protocolVersion: 3 });
  const error = Object.assign(new TypeError('PRIVATE'), { code: 'ECONNRESET', cause: new Error('PRIVATE') });
  error.stack = 'TypeError\n at query (/extension/out/extension.js:12:34)';
  reporter.capture('editor', 'query', error, details); await reporter.idle();
  assert.equal(sent[0].operation.surface, 'results');
  assert.equal(sent[0].operation.connected, false); assert.equal(sent[0].operation.durationMs, 0);
  assert.equal(sent[0].operation.rowCount, undefined);
  assert.equal(sent[0].breadcrumbs[0].details.protocolVersion, 3);
  assert.equal(sent[0].environment.freeMemory, 1024);
  assert.equal(sent[0].environment.resourceUsage.userCPUTime, 12);
  assert.equal(sent[0].environment.versions.v8, '12.4.1');
  assert.equal(sent[0].environment.settings['notebook.presentation'], 'both');
  assert.equal(sent[0].environment.settings['queryTimeoutMs'], 0);
  assert.equal(sent[0].environment.settings['results.showRowIndex'], false);
  assert.equal(sent[0].environment.buildId, 'a'.repeat(64));
  assert.equal(sent[0].failure.exceptions[0].category, 'network');
  assert.equal(safeFailure({ name: 'KdbIpcError', message: 'PRIVATE' }).exceptions[0].category, 'network');
  assert.equal(safeFailure({ name: 'KdbQError', message: 'PRIVATE' }).exceptions[0].category, 'q-runtime');
  assert.equal(safeFailure({ message: 'constructor' }).exceptions[0].classification, undefined);
  assert.ok(!JSON.stringify(sent).includes('PRIVATE'));
  const message = { type: 'kxFailure', generation: reporter.state.generation, component: 'notebook-renderer',
    operation: 'render', failure: safeFailure(error, ['/extension/']), details: { surface: 'saved-notebook', saved: true } };
  assert.ok(parseFailureMessage(message, reporter.state, 'notebook-renderer'));
  for (const details of [{ surface: 'PRIVATE' }, { query: 'PRIVATE' }, { durationMs: -1 },
    { rowCount: {} }, { operationId: '/home/private/file' }, { connected: 'false' }]) {
    assert.equal(parseFailureMessage({ ...message, details }, reporter.state, 'notebook-renderer'), undefined);
  }
  assert.deepEqual(safeOperationDetails({ connected: false, durationMs: 0, surface: 'PRIVATE', outputBytes: NaN }),
    { durationMs: 0, connected: false });
  reporter.configure({}); reporter.breadcrumb('ipc', 'query', { status: 'start' });
  reporter.configure({ reportServerUrl: 'https://reports.example.test' });
  reporter.capture('qnb', 'serialize', new RangeError('PRIVATE')); await reporter.idle();
  assert.equal(sent[1].breadcrumbs.length, 0); assert.equal(snapshots, 2);
  reporter.dispose();
  let racedSends = 0, raced;
  raced = new FailureReporter({ environment: () => { raced.configure({}); return { freeMemory: 1024, buildId: 'c'.repeat(64) }; },
    send: async () => { racedSends++; } });
  raced.configure({ reportServerUrl: 'https://reports.example.test' });
  assert.equal(raced.capture('editor', 'query', new Error('PRIVATE'), details), undefined);
  await raced.idle(); assert.equal(racedSends, 0); raced.dispose();
  const { collectRuntimeFacts } = require('../out/failure-context');
  const resourceUsage = process.resourceUsage;
  try {
    process.resourceUsage = () => { throw new Error('PRIVATE'); };
    const facts = collectRuntimeFacts();
    assert.ok(facts.unavailableSections.includes('resourceUsage'));
    assert.ok(facts.heapStatistics.heap_size_limit > 0);
    assert.ok(!JSON.stringify(facts).includes('PRIVATE'));
  } finally { process.resourceUsage = resourceUsage; }
  const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
  const root = path.resolve(__dirname, '..');
  const build = JSON.parse(fs.readFileSync(path.join(root, 'out/failure-build.json'), 'utf8'));
  assert.equal(build.release, require('../package.json').version);
  assert.equal(build.libraries['@sentry/core'], '10.76.1');
  for (const [file, hash] of Object.entries(build.artifacts)) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'), hash);
  }
  assert.equal(build.buildId, crypto.createHash('sha256').update(JSON.stringify(build.artifacts)).digest('hex'));
  assert.ok(!JSON.stringify(build).includes(root));
  require('node:child_process').execFileSync('python3', ['-c', `
import runpy,json
from pathlib import Path
m=runpy.run_path('scripts/audit-release.py')
members={'extension/'+name:Path(name).read_bytes() for name in ['out/extension.js','out/q-language-server.js','renderer/kx-notebook-renderer.js','out/failure-build.json','package.json']}
m['validate_compiled_inventory'](members)
build=json.loads(members['extension/out/failure-build.json']); build['buildId']='0'*64
members['extension/out/failure-build.json']=json.dumps(build).encode()
try: m['validate_compiled_inventory'](members)
except m['AuditError']: pass
else: raise AssertionError('mismatched packaged build identity was accepted')
`], { cwd: root });
  // Both wire projections must retain the primary error when optional inventory is too large.
  const large = structuredClone(sent[0]);
  large.environment.extensions = Array.from({ length: 4000 }, () => ({ id: 'publisher.' + 'x'.repeat(130), version: '1.0.0' }));
  const frames = structuredClone(large.failure.exceptions[0].frames);
  assert.ok(reduceFailureReport(large));
  assert.ok(Buffer.byteLength(JSON.stringify(large)) <= 256 * 1024);
  assert.deepEqual(large.failure.exceptions[0].frames, frames);
  assert.ok(large.omissions.includes('extensions-truncated'));
  const bounded = new FailureReporter({ environment: () => ({}), send: async (_url, body) => {
    const report = JSON.parse(body); assert.ok(report.breadcrumbs.length <= 100);
    assert.ok(Buffer.byteLength(JSON.stringify(report.breadcrumbs)) <= 64 * 1024);
    assert.ok(report.omissions.includes('breadcrumbs-history-truncated'));
  } });
  bounded.configure({ reportServerUrl: 'https://reports.example.test' });
  for (let i = 0; i < 1000; i++) bounded.breadcrumb('ipc', 'query', { status: 'success', rowCount: i, query: 'PRIVATE' });
  bounded.capture('editor', 'query', new Error('PRIVATE')); await bounded.idle(); bounded.dispose();
  console.log('ok - rich context, missing/zero/false, privacy and strict producer schema');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
