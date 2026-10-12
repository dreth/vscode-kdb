'use strict';
// Operator-invoked smoke only. Normal extension activation never reads this env var.
const assert = require('assert');
const vscode = require('vscode');

exports.run = async function() {
  const dsn = process.env.VSCODE_KDB_GLITCHTIP_SMOKE_DSN;
  assert(dsn, 'Set VSCODE_KDB_GLITCHTIP_SMOKE_DSN to the authorized test project DSN');
  assert.strictEqual(new URL(dsn).protocol, 'https:', 'Use the verified project HTTPS endpoint');
  const extension = vscode.extensions.getExtension('DanielAlonso.vscode-kdb');
  assert(extension, 'KX extension is installed');
  const api = (await extension.activate()).extensionHostTest;
  assert(api, 'Run in ExtensionMode.Test with VSCODE_KDB_EXTENSION_HOST_TEST=1');
  const settings = vscode.workspace.getConfiguration('vscode-kdb.diagnostics');
  const originalDsn = settings.inspect('sentryDsn')?.globalValue;
  const originalUrl = settings.inspect('reportServerUrl')?.globalValue;
  try {
    await settings.update('reportServerUrl', '', vscode.ConfigurationTarget.Global);
    await settings.update('sentryDsn', dsn, vscode.ConfigurationTarget.Global);
    const deadline = Date.now() + 5000;
    while (!api.reportingState().enabled && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert(api.reportingState().enabled, 'The explicitly configured DSN is valid');
    const eventId = api.reportSyntheticFailure();
    assert.match(eventId, /^[a-f0-9]{32}$/);
    await api.waitForFailureReports();
    console.log(JSON.stringify({ eventId, release: 'vscode-kdb@' + extension.packageJSON.version,
      component: 'editor', operation: 'query', timestamp: new Date().toISOString(),
      note: 'Synthetic event queued; confirm this event ID in the configured GlitchTip project.' }));
  } finally {
    await settings.update('sentryDsn', originalDsn, vscode.ConfigurationTarget.Global);
    await settings.update('reportServerUrl', originalUrl, vscode.ConfigurationTarget.Global);
    if (!originalDsn && !originalUrl) {
      const deadline = Date.now() + 5000;
      while (api.reportingState().enabled && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      assert(!api.reportingState().enabled, 'Temporary opt-in was cleared');
      assert.strictEqual(api.reportSyntheticFailure(), undefined, 'Cleared reporter captures nothing');
    }
  }
};
