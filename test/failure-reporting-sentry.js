'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const { FailureReporter } = require('../out/failure-reporting');
async function main() {
  const ambient = Object.fromEntries(['SENTRY_DSN', 'SENTRY_RELEASE', 'SENTRY_ENVIRONMENT', 'SENTRY_SPOTLIGHT']
    .map(key => [key, process.env[key]]));
  process.env.SENTRY_DSN = 'https://foreign@ambient.example.test/99';
  process.env.SENTRY_RELEASE = 'private ambient release';
  process.env.SENTRY_ENVIRONMENT = 'private ambient environment';
  process.env.SENTRY_SPOTLIGHT = 'http://ambient.example.test';
  assert.ok(!Object.keys(require.cache).some(file => file.includes('/@sentry/')),
    'loading a disabled reporter never evaluates the SDK');
  const beforeImport = new Map(process.eventNames().map(name => [name, process.listeners(name)]));
  const sdk = require('@sentry/node');
  for (const name of new Set([...beforeImport.keys(), ...process.eventNames()])) {
    assert.deepEqual(process.listeners(name), beforeImport.get(name) || [], `SDK import listener changed: ${String(name)}`);
  }
  const foreignScope = sdk.getCurrentScope();
  const previousClient = foreignScope.getClient();
  const foreignClient = { getOptions: () => ({ release: 'foreign-release' }) };
  foreignScope.setClient(foreignClient);
  const globalScope = sdk.getGlobalScope();
  const previousGlobal = globalScope.getScopeData();
  globalScope.setUser({ email: 'must-never-transmit@example.test' });
  globalScope.setExtra('foreignQuery', 'private foreign source');
  let foreignProcessed = 0;
  globalScope.addEventProcessor(event => { foreignProcessed++; return event; });
  const isolationScope = sdk.getIsolationScope();
  const previousLastEventId = isolationScope.lastEventId();
  const foreignSession = { sid: 'foreign-session', init: true, started: Date.now() / 1000,
    timestamp: Date.now() / 1000, status: 'ok', errors: 0, ignoreDuration: true, toJSON: () => ({}) };
  const previousSession = isolationScope.getSession();
  isolationScope.setSession(foreignSession);
  const before = new Map(process.eventNames().map(name => [name, process.listeners(name)]));
  const oldConsole = console.error, oldRequest = http.request;
  const requests = [], statuses = [];
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', data => { body += data; });
    req.on('end', () => { requests.push({ path: req.url, body }); res.end('ok'); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const reporter = new FailureReporter({ environment: () => ({ kxVersion: '0.2.43', nodeVersion: '22.15.1', platform: 'linux', osRelease: '6.8.0', buildId: 'b'.repeat(64),
    versions: { v8: '12.4.1', secret: 'private foreign source' }, resourceUsage: { maxRSS: 2000, secret: 'private foreign source' },
    libraries: { '@sentry/node': '10.76.1', private: 'private foreign source' }, settings: { 'notebook.presentation': 'both', 'connections': 'private foreign source' } }),
    artifactRoots: ['/extension/'], status: value => statuses.push(value) });
  try {
    reporter.configure({ sentryDsn: base.replace('http://', 'http://public@') + '/proxy/42', reportServerUrl: base + '/json' });
    const error = new TypeError('private q traceback');
    error.stack = 'TypeError: private q traceback\n at owned (/extension/out/extension.js:10:20)';
    reporter.breadcrumb('ipc', 'connect', { operationId: 'kx-1-1', phase: 'connect', status: 'success', query: 'private foreign source' });
    reporter.capture('editor', 'query', error, { operationId: 'kx-1-1', surface: 'results', status: 'failed', connected: false, durationMs: 0, query: 'private foreign source' }); await reporter.idle();
    assert.equal(requests.length, 2, statuses.join(', '));
    const envelope = requests.find(request => request.path.includes('/envelope/'));
    assert.equal(new URL(envelope.path, base).pathname, '/proxy/api/42/envelope/');
    const lines = envelope.body.split('\n');
    assert.equal(JSON.parse(lines[1]).type, 'event'); assert.equal(lines.length, 3);
    const event = JSON.parse(lines[2]);
    assert.equal(event.exception.values[0].type, 'TypeError');
    assert.equal(event.exception.values[0].stacktrace.frames[0].filename, 'out/extension.js');
    assert.equal(event.release, 'vscode-kdb@0.2.43');
    assert.equal(event.tags.component, 'editor');
    assert.equal(event.contexts.runtime.version, '22.15.1');
    assert.equal(event.contexts.os.name, 'linux');
    assert.equal(event.tags.build, 'b'.repeat(64));
    assert.equal(event.tags.surface, 'results');
    assert.equal(event.contexts.kx.operation.connected, false);
    assert.equal(event.breadcrumbs[0].data.status, 'success');
    assert.equal(event.contexts.kx.libraries['@sentry/node'], '10.76.1');
    assert.equal(event.contexts.kx.resourceUsage.maxRSS, 2000);
    const jsonReport = JSON.parse(requests.find(req => req.path === '/json').body);
    assert.deepEqual(jsonReport.operation, event.contexts.kx.operation);
    assert.deepEqual(jsonReport.environment.settings, event.contexts.kx.settings);
    assert.equal(event.user, undefined); assert.equal(event.server_name, undefined);
    assert.equal(event.event_id, JSON.parse(requests.find(req => req.path === '/json').body).eventId);
    for (const secret of ['must-never-transmit', 'private foreign source', 'private q traceback', '/extension/', 'foreignQuery', 'private ambient', 'ambient.example.test']) {
      assert.ok(!envelope.body.includes(secret), secret);
    }
    assert.equal(sdk.getCurrentScope(), foreignScope); assert.equal(foreignScope.getClient(), foreignClient);
    assert.equal(console.error, oldConsole); assert.equal(http.request, oldRequest);
    assert.equal(foreignProcessed, 0, 'foreign event processors must never run for KX reports');
    assert.equal(isolationScope.lastEventId(), previousLastEventId, 'foreign last event identity is unchanged');
    assert.equal(foreignSession.errors, 0, 'foreign sessions are unchanged');
    for (const name of new Set([...before.keys(), ...process.eventNames()])) {
      assert.deepEqual(process.listeners(name), before.get(name) || [], `global listener changed: ${String(name)}`);
    }
    // A second event must carry its own envelope/event identity and coordinates.
    reporter.capture('notebook', 'encode', new RangeError('private second error')); await reporter.idle();
    const second = requests.filter(req => req.path.includes('/envelope/'))[1].body.split('\n');
    assert.equal(JSON.parse(second[0]).event_id, JSON.parse(second[2]).event_id);
    assert.notEqual(JSON.parse(second[2]).event_id, event.event_id);
    reporter.configure({});
    reporter.capture('editor', 'query', new Error('disabled')); await reporter.idle();
    assert.equal(requests.length, 4);
  } finally {
    reporter.dispose(); globalScope.clear(); globalScope.update(previousGlobal);
    foreignScope.setClient(previousClient);
    isolationScope.setSession(previousSession);
    for (const [key, value] of Object.entries(ambient)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await new Promise(resolve => server.close(resolve));
  }
  console.log('ok - real Sentry SDK isolated exception envelopes, correlation and revocation');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
