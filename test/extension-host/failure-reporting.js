'use strict';
const assert = require('assert');
const http = require('http');
const vscode = require('vscode');
const EXTENSION_ID = 'DanielAlonso.vscode-kdb';
async function waitFor(label, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail('timed out waiting for ' + label);
}
async function exerciseFailureReporting(testApi) {
  const settings = vscode.workspace.getConfiguration('vscode-kdb.diagnostics');
  const originalDsn = settings.inspect('sentryDsn')?.globalValue;
  const originalUrl = settings.inspect('reportServerUrl')?.globalValue;
  const originalSilent = settings.inspect('failSilently')?.globalValue;
  const received = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => { received.push({ path: request.url, body }); response.end('ok'); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await settings.update('failSilently', true, vscode.ConfigurationTarget.Global);
    await settings.update('sentryDsn', '', vscode.ConfigurationTarget.Global);
    await settings.update('reportServerUrl', '', vscode.ConfigurationTarget.Global);
    await waitFor('reporter default inactivity', () => !testApi.reportingState().enabled);
    testApi.reportSyntheticFailure();
    assert.strictEqual(received.length, 0);
    await settings.update('reportServerUrl', base + '/json', vscode.ConfigurationTarget.Global);
    await waitFor('reporter configured activation', () => testApi.reportingState().enabled);
    testApi.reportSyntheticFailure();
    await waitFor('packaged-host JSON report', () => received.some(item => item.path === '/json'));
    const report = JSON.parse(received[0].body);
    assert.strictEqual(report.breadcrumbs.length, 4);
    assert(report.environment.resourceUsage.maxRSS > 0);
    assert.match(report.environment.buildId, /^[a-f0-9]{64}$/);
    assert.strictEqual(report.schemaVersion, 1); assert.strictEqual(report.component, 'editor');
    assert.strictEqual(report.environment.kxVersion, vscode.extensions.getExtension(EXTENSION_ID).packageJSON.version);
    assert.ok(!received[0].body.includes('Synthetic KX-owned'), 'unstructured messages stay omitted');
    await settings.update('reportServerUrl', '', vscode.ConfigurationTarget.Global);
    await waitFor('JSON disabled', () => !testApi.reportingState().enabled);
    await settings.update('sentryDsn', base.replace('http://', 'http://public@') + '/proxy/42', vscode.ConfigurationTarget.Global);
    await waitFor('Sentry configured activation', () => testApi.reportingState().enabled);
    testApi.reportSyntheticFailure();
    await waitFor('packaged-host Sentry event', () => received.some(item => item.path.includes('/envelope/')), 15_000);
    const event = JSON.parse(received.find(item => item.path.includes('/envelope/')).body.split('\n')[2]);
    assert.strictEqual(event.tags.component, 'editor');
    const primary = event.exception.values.find(item => item.type === 'TypeError');
    assert(primary);
    assert.ok(primary.stacktrace.frames.some(frame => frame.filename === 'out/extension.js'));
    assert.strictEqual(event.user, undefined);
    assert.strictEqual(event.tags.surface, 'results');
    assert.match(event.tags.build, /^[a-f0-9]{64}$/);
    assert.strictEqual(event.contexts.runtime.version, process.versions.node);
    assert.strictEqual(event.contexts.kx.operation.protocolVersion, 3);
    assert.strictEqual(event.contexts.kx.operation.canceled, false);
    assert.strictEqual(event.breadcrumbs.length, 4);
    assert.strictEqual(event.breadcrumbs[1].data.status, 'success');
    assert.strictEqual(event.breadcrumbs[0].data.operationId, event.contexts.kx.operation.operationId);
    assert(event.contexts.kx.freeMemory > 0);
    assert(event.contexts.kx.heapStatistics.heap_size_limit > 0);
    assert.strictEqual(event.contexts.kx.libraries['@sentry/node'], '10.76.1');
    assert.strictEqual(event.exception.values[0].value, 'ECONNRESET');
    for (const item of received) assert(!item.body.includes('PRIVATE_FIXTURE'));
    await settings.update('sentryDsn', '', vscode.ConfigurationTarget.Global);
    await waitFor('Sentry disabled', () => !testApi.reportingState().enabled);
    testApi.reportSyntheticFailure();
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.strictEqual(received.length, 2, 'cleared settings do not backfill or capture');
  } finally {
    await settings.update('sentryDsn', originalDsn, vscode.ConfigurationTarget.Global);
    await settings.update('reportServerUrl', originalUrl, vscode.ConfigurationTarget.Global);
    await settings.update('failSilently', originalSilent, vscode.ConfigurationTarget.Global);
    await new Promise(resolve => server.close(resolve));
  }
}
exports.exerciseFailureReporting = exerciseFailureReporting;
exports.run = async function() {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert(extension, 'KX extension is installed');
  const api = (await extension.activate()).extensionHostTest;
  assert(api, 'Run with VSCODE_KDB_EXTENSION_HOST_TEST=1 in an isolated test profile');
  await exerciseFailureReporting(api);
  console.log('Actual Extension Host default-off, JSON/Sentry ingestion, private frames and clearing passed');
};
