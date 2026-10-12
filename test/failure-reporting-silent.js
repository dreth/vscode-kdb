'use strict';
const assert = require('node:assert/strict');
const { FailureReporter, machineBooleanSetting } = require('../out/failure-reporting');
const HOUR = 60 * 60 * 1000;
async function main() {
  let now = 1000, snapshots = 0, deliveries = 0;
  const statuses = [], wire = [];
  let fail = true;
  const networkError = Object.assign(new Error('private destination/path/key'), { code: 'ENOTFOUND' });
  const reporter = new FailureReporter({ now: () => now, artifactRoots: ['/extension/'],
    environment: () => { snapshots++; return {}; }, status: status => statuses.push(status),
    send: async (_url, body) => { deliveries++; if (fail) throw networkError; wire.push(JSON.parse(body)); } });
  const owned = line => { const e = new TypeError('private q'); e.stack = `TypeError\n at query (/extension/out/extension.js:${line}:1)`; return e; };
  reporter.configure({ reportServerUrl: 'https://reports.example.test' });
  reporter.capture('editor', 'query', owned(1)); await reporter.idle();
  assert.deepEqual(statuses, [], 'delivery failure is silent by default');
  assert.equal(deliveries, 1);
  now += HOUR - 1;
  assert.equal(reporter.capture('editor', 'query', owned(2)), undefined, 'cooldown drops new failures');
  assert.equal(snapshots, 1, 'cooldown performs no context collection');
  await reporter.idle(); assert.equal(deliveries, 1, 'no retry/probe occurs while idle');
  now++;
  await reporter.idle(); assert.equal(deliveries, 1, 'elapsed cooldown alone never triggers network work');
  fail = false;
  reporter.capture('editor', 'query', owned(3)); await reporter.idle();
  assert.equal(deliveries, 2); assert.equal(wire.length, 1);
  assert.equal(wire[0].failure.exceptions[0].frames[0].lineno, 3, 'failed and cooldown events are never replayed');
  assert.equal(reporter.capture('editor', 'query', networkError), undefined, 'report transport error is not an owned KX incident');
  reporter.configure({ reportServerUrl: 'https://reports.example.test', failSilently: false });
  fail = true; reporter.capture('notebook', 'encode', owned(4)); await reporter.idle();
  assert.deepEqual(statuses, ['[reporting] delivery-failed'], 'explicit opt-out emits one bounded local notice');
  reporter.configure({}); now += HOUR;
  reporter.capture('editor', 'query', owned(5)); await reporter.idle(); assert.equal(deliveries, 3);
  reporter.configure({ reportServerUrl: 'https://fresh.example.test' }); fail = false;
  reporter.capture('editor', 'query', owned(6)); await reporter.idle(); assert.equal(deliveries, 4);
  reporter.dispose();
  // One failed sink must not stop the healthy one or retain a retry backlog.
  let clock = 10, sentryAttempts = 0, jsonAttempts = 0, failureCount = 0;
  const isolated = new FailureReporter({ now: () => clock, environment: () => ({}), artifactRoots: ['/extension/'],
    send: async (_url, _body, type) => {
      if (type === 'application/json') jsonAttempts++;
      else { sentryAttempts++; if (!failureCount++) throw new Error('private Sentry route unavailable'); }
    } });
  isolated.configure({ reportServerUrl: 'https://json.example.test', sentryDsn: 'https://public@sentry.example.test/42' });
  isolated.capture('editor', 'query', owned(10)); await isolated.idle();
  assert.equal(sentryAttempts, 1); assert.equal(jsonAttempts, 1);
  clock += 61000;
  isolated.capture('editor', 'query', owned(11)); await isolated.idle();
  assert.equal(sentryAttempts, 1); assert.equal(jsonAttempts, 2);
  clock += HOUR;
  await isolated.idle(); assert.equal(sentryAttempts, 1);
  isolated.capture('editor', 'query', owned(12)); await isolated.idle();
  assert.equal(sentryAttempts, 2); assert.equal(jsonAttempts, 3);
  isolated.dispose();

  let release, queuedAttempts = 0;
  const queued = new FailureReporter({ now: () => clock, environment: () => ({}), artifactRoots: ['/extension/'],
    send: async () => { queuedAttempts++; await new Promise((_resolve, reject) => { release = reject; }); } });
  queued.configure({ reportServerUrl: 'https://queued.example.test' });
  for (let i = 0; i < 20; i++) queued.capture('editor', 'query', owned(100+i));
  release(new Error('private offline receiver')); await queued.idle();
  assert.equal(queuedAttempts, 1, 'in-flight failure clears the pending sink queue');
  clock += HOUR; await queued.idle(); assert.equal(queuedAttempts, 1, 'pending failures are never retried'); queued.dispose();

  // SDK-load outages recover only for a new failure after the same cooldown.
  let loads = 0, sdkSends = 0;
  const sdkOutage = new FailureReporter({ now: () => clock, environment: () => ({}),
    loadSentry: async () => { if (++loads === 1) throw new Error('private SDK error'); return require('@sentry/node'); },
    send: async () => { sdkSends++; } });
  sdkOutage.configure({ sentryDsn: 'https://public@sentry.example.test/42' });
  sdkOutage.capture('editor', 'query', new TypeError('private')); await sdkOutage.idle();
  sdkOutage.capture('editor', 'query', new RangeError('private')); await sdkOutage.idle(); assert.equal(loads, 1);
  clock += HOUR;
  sdkOutage.capture('editor', 'query', new RangeError('private')); await sdkOutage.idle(); assert.equal(loads, 2); assert.equal(sdkSends, 1);
  sdkOutage.dispose();
  assert.equal(machineBooleanSetting({ defaultValue: true, workspaceValue: false }), true);
  assert.equal(machineBooleanSetting({ defaultValue: true, globalValue: false, workspaceValue: true }), false);
  assert.equal(machineBooleanSetting({ defaultValue: true, globalValue: 'false' }), true);
  console.log('ok - default silent failure, event-driven one-hour cooldown, no replay/probes and transport-error exclusion');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
