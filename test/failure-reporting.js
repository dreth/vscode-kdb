'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const { FailureReporter, resolveReportUrl, resolveSentryDsn, machineSetting } = require('../out/failure-reporting');
const { safeFailure, reportKxFailure, configureFailureObserver, parseFailureMessage } = require('../out/failure-record');

async function main() {
  let snapshots = 0, loads = 0;
  const sent = [], statuses = [];
  let clock = 1_000;
  const reporter = new FailureReporter({
    now: () => clock,
    environment: () => { snapshots++; return { kxVersion: '0.2.43', vscodeVersion: '1.101.0', query: 'private source' }; },
    status: value => statuses.push(value),
    send: async (url, body, _type, signal) => { if (!signal.aborted) sent.push({ url, body }); },
    loadSentry: async () => { loads++; throw new Error('secret-bearing SDK failure'); },
    artifactRoots: ['/extension/'],
  });
  const failure = new TypeError('private source password=private-password');
  failure.stack = 'TypeError: private source\n at owned (/extension/out/extension.js:10:20)\n at foreign (/vscode/workbench.js:1:2)';
  failure.cause = new Error('private-result');
  reporter.capture('editor', 'query', failure);
  assert.equal(snapshots, 0); assert.equal(loads, 0); assert.equal(sent.length, 0);
  assert.equal(resolveReportUrl(' '), undefined);
  assert.equal(resolveReportUrl('file:///tmp/reports'), undefined);
  assert.equal(resolveReportUrl('https://user:pass@reports.example.test'), undefined);
  assert.equal(resolveSentryDsn('https://key:secret@reports.example.test/1'), undefined);
  assert.equal(machineSetting({ defaultValue: '', workspaceValue: 'https://bad.example.test' }), '');
  assert.equal(machineSetting({ globalValue: 'https://good.example.test', workspaceValue: 'bad' }), 'https://good.example.test');
  assert.ok(resolveSentryDsn('https://public@reports.example.test/prefix/42'));
  reporter.configure({ reportServerUrl: 'https://reports.example.test/receive' });
  reporter.capture('vscode', 'query', failure);
  assert.equal(snapshots, 0, 'foreign components are rejected before inspection');
  reporter.capture('editor', 'query', failure, { query: 'private source', rowCount: 7 });
  await reporter.idle();
  assert.equal(sent.length, 1); assert.equal(loads, 0);
  const body = JSON.parse(sent[0].body);
  assert.equal(body.schemaVersion, 1); assert.match(body.eventId, /^[a-f0-9]{32}$/);
  assert.equal(body.failure.exceptions[0].type, 'TypeError');
  assert.equal(body.failure.exceptions[0].frames[0].filename, 'out/extension.js');
  assert.equal(body.operation.rowCount, 7);
  for (const secret of ['private source', 'private-password', 'private-result', '/extension/', '/vscode/', 'workbench.js']) {
    assert.ok(!sent[0].body.includes(secret), secret);
  }
  reporter.capture('editor', 'query', failure); await reporter.idle();
  assert.equal(sent.length, 1, 'a handled error reported twice is deduplicated');
  reporter.capture('notebook', 'query', failure); await reporter.idle();
  assert.equal(sent.length, 1, 'the same IPC exception crossing another layer stays one event');
  const state = reporter.state;
  const forwarded = { type: 'kxFailure', generation: state.generation, component: 'notebook-renderer',
    operation: 'render', failure: safeFailure(failure, ['/extension/']) };
  assert.ok(parseFailureMessage(forwarded, state, 'notebook-renderer'));
  assert.equal(parseFailureMessage({ ...forwarded, generation: state.generation - 1 }, state, 'notebook-renderer'), undefined);
  assert.equal(parseFailureMessage({ ...forwarded, component: 'vscode' }, state, 'notebook-renderer'), undefined);
  assert.equal(parseFailureMessage(forwarded, state, 'results-renderer'), undefined);
  assert.equal(parseFailureMessage({ ...forwarded, failure: { exceptions: Array(4).fill(forwarded.failure.exceptions[0]) } }, state, 'notebook-renderer'), undefined);
  assert.equal(parseFailureMessage({ ...forwarded, query: 'private source' }, state, 'notebook-renderer'), undefined);
  const anotherActivation = new FailureReporter({ environment: () => ({}) });
  anotherActivation.configure({ reportServerUrl: 'https://reports.example.test/receive' });
  assert.notEqual(anotherActivation.state.generation, state.generation);
  assert.equal(parseFailureMessage(forwarded, anotherActivation.state, 'notebook-renderer'), undefined);
  anotherActivation.dispose();
  assert.equal(parseFailureMessage({ ...forwarded, failure: { exceptions: [{ type: 'Error', value: 'private source', frames: [] }] } }, state, 'notebook-renderer'), undefined);
  reporter.captureSafe('editor', 'query', { exceptions: [{ type: 'Error', value: 'private source', frames: [] }] });
  assert.equal(snapshots, 1, 'untrusted forwarded payloads are rejected before metadata capture');
  reporter.configure({}); reporter.capture('editor', 'query', new Error('later'));
  assert.equal(snapshots, 1);
  reporter.configure({ reportServerUrl: 'https://new.example.test/receive' }); await reporter.idle();
  assert.equal(sent.length, 1, 'no historical replay');
  for (let i = 0; i < 15; i++) {
    const error = new Error('omitted'); error.stack = `Error\n at owned (/extension/out/extension.js:${i + 1}:2)`;
    reporter.capture('editor', 'query', error); await reporter.idle();
  }
  assert.equal(sent.length, 11, 'ten attempts per sink minute');
  clock += 60_001;
  reporter.capture('editor', 'query', new RangeError('later')); await reporter.idle();
  assert.equal(sent.length, 12);
  reporter.configure({ sentryDsn: 'https://public@reports.example.test/42' });
  reporter.capture('editor', 'query', new Error('sdk')); await reporter.idle();
  assert.equal(loads, 1); assert.ok(!statuses.join(' ').includes('secret-bearing'));
  reporter.dispose();

  // Revoke a destination while its lazy SDK import is unresolved.
  let resolveSdk, racedSends = 0;
  const raced = new FailureReporter({ environment: () => ({}),
    loadSentry: () => new Promise(resolve => { resolveSdk = resolve; }),
    send: async () => { racedSends++; } });
  raced.configure({ sentryDsn: 'https://public@reports.example.test/42' });
  raced.capture('editor', 'query', new Error('owned'));
  raced.configure({});
  resolveSdk({});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(racedSends, 0); raced.dispose();

  // Disabled observation never touches arbitrary Errors, including throwing getters.
  let inspected = false;
  const tricky = Object.create(Error.prototype, { stack: { get() { inspected = true; throw new Error('getter'); } } });
  configureFailureObserver(undefined); reportKxFailure('editor', 'query', tricky);
  assert.equal(inspected, false);
  assert.doesNotThrow(() => safeFailure(tricky, ['/extension/']));

  // A stalled sink retains at most 20 sanitized events and sends one at a time.
  let release, queuedSnapshots = 0, active = 0, maxActive = 0, deliveries = 0;
  const bounded = new FailureReporter({ now: () => clock,
    artifactRoots: ['/extension/'], environment: () => { queuedSnapshots++; return { extensions: Array.from({length: 205}, () => ({id: 'publisher.extension', version: '1.0.0'})) }; },
    send: async (_url, body) => {
      const report = JSON.parse(body);
      assert.equal(report.environment.extensions.length, 200);
      assert.equal(report.environment.omittedExtensions, 5);
      assert.ok(report.omissions.includes('extensions-truncated'));
      active++; maxActive = Math.max(maxActive, active); deliveries++;
      if (deliveries === 1) await new Promise(resolve => { release = resolve; });
      active--; clock += 60_001;
    } });
  bounded.configure({ reportServerUrl: 'https://bounded.example.test/receive' });
  for (let i = 0; i < 30; i++) {
    const error = new TypeError('sensitive'); error.stack = `TypeError\n at owned (/extension/out/extension.js:${i + 1}:1)`;
    bounded.capture('editor', 'query', error);
  }
  assert.equal(queuedSnapshots, 20); release(); await bounded.idle();
  assert.equal(deliveries, 20); assert.equal(maxActive, 1); bounded.dispose();
  const deep = new Error('private cause'); deep.cause = deep; deep.stack = 'Error\n' + 'x'.repeat(33_000);
  const truncated = safeFailure(deep, ['/extension/']);
  assert.ok(truncated.omissions.includes('stack-truncated'));
  assert.ok(truncated.omissions.includes('causes-truncated'));
  const windows = new Error('private Windows source');
  windows.stack = 'Error\n at query (C:\\Users\\Dev (Work)\\extensions\\kx\\out\\extension.js:7:8)';
  const windowsFailure = safeFailure(windows, ['C:/Users/Dev (Work)/extensions/kx/']);
  assert.equal(windowsFailure.exceptions[0].frames[0].filename, 'out/extension.js');
  assert.equal(windowsFailure.exceptions[0].frames[0].function, 'query');

  // Real transport: full URL, redirect rejection, no retry, generation cancellation.
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', data => { body += data; });
    req.on('end', () => { requests.push({ path: req.url, type: req.headers['content-type'], body });
      if (req.url === '/stall') { res.writeHead(200); res.write('unfinished response'); return; }
      res.writeHead(req.url.startsWith('/redirect') ? 302 : 202, { Location: '/unwanted' }); res.end(); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const real = new FailureReporter({ environment: () => ({ kxVersion: '0.2.43' }), artifactRoots: ['/extension/'] });
  try {
    real.configure({ reportServerUrl: base + '/receive?q=1' });
    real.capture('notebook', 'encode', failure); await real.idle();
    assert.equal(requests[0].path, '/receive?q=1'); assert.equal(requests[0].type, 'application/json');
    real.configure({ reportServerUrl: base + '/redirect' });
    real.capture('notebook', 'encode', failure); await real.idle();
    assert.equal(requests.length, 2); assert.ok(!requests.some(req => req.path === '/unwanted'));
    real.configure({ reportServerUrl: base + '/stall' });
    real.capture('notebook', 'commit', new TypeError('owned cancellation fixture'));
    while (requests.length < 3) await new Promise(resolve => setTimeout(resolve, 5));
    real.configure({});
    await new Promise(resolve => setTimeout(resolve, 25));
    real.configure({ reportServerUrl: base + '/stall' });
    const started = Date.now();
    real.capture('notebook', 'commit', new RangeError('owned timeout fixture')); await real.idle();
    assert.ok(Date.now() - started >= 4500 && Date.now() - started < 7500, 'stalled body obeys the five-second request limit');
    assert.equal(requests.length, 4, 'cancelled/timed-out requests are never retried');
  } finally { real.dispose(); await new Promise(resolve => server.close(resolve)); }
  console.log('ok - failure reporting inactivity, privacy, ownership, bounds and HTTP transport');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
