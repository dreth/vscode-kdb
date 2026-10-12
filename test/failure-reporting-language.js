'use strict';
const assert = require('assert');
const { fork } = require('child_process');
const path = require('path');
const { createMessageConnection, IPCMessageReader, IPCMessageWriter } = require('vscode-jsonrpc/node');
const { FAILURE_LSP_EVENT, FAILURE_LSP_STATE, parseFailureMessage } = require('../out/failure-record');
async function waitFor(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert(predicate(), 'language fixture timed out');
}
async function main() {
  const child = fork(path.resolve(__dirname, '../out/q-language-server.js'), ['--node-ipc'], { silent: true });
  const connection = createMessageConnection(new IPCMessageReader(child), new IPCMessageWriter(child));
  const failures = [], diagnostics = [];
  let rejectSettings = false;
  connection.onRequest('workspace/configuration', () => {
    if (rejectSettings) throw new Error('private language source and endpoint fixture');
    return [{ diagnostics: { debounceMs: 0 } }];
  });
  connection.onRequest('client/registerCapability', () => null);
  connection.onNotification(FAILURE_LSP_EVENT, event => failures.push(event));
  connection.onNotification('textDocument/publishDiagnostics', event => diagnostics.push(event));
  connection.listen();
  const open = async index => connection.sendNotification('textDocument/didOpen', { textDocument: {
    uri: `file:///private-language-${index}.q`, languageId: 'q', version: 1,
    text: 'f:{[unused]\n local:1;\n til 2};\nanswer:f[2]',
  } });
  try {
    await connection.sendRequest('initialize', { processId: process.pid, rootUri: null,
      capabilities: { workspace: { configuration: true } }, workspaceFolders: null });
    await connection.sendNotification('initialized');
    await open(0);
    await waitFor(() => diagnostics.some(event => event.diagnostics.length));
    assert.strictEqual(failures.length, 0, 'disabled child forwards nothing');
    await connection.sendNotification(FAILURE_LSP_STATE, { enabled: true, generation: 19 });
    await open(1);
    await waitFor(() => diagnostics.some(event => event.uri.endsWith('-1.q') && event.diagnostics.length));
    assert.strictEqual(failures.length, 0, 'ordinary lint findings remain private when reporting is enabled');
    rejectSettings = true;
    await open(2);
    await waitFor(() => failures.length > 0);
    for (const event of failures) {
      assert(parseFailureMessage(event, { enabled: true, generation: 19 }, 'language'));
      assert(!JSON.stringify(event).includes('private language source'));
      assert(!JSON.stringify(event).includes('private-language-'));
      assert(!JSON.stringify(event).includes('unused'));
    }
    const count = failures.length;
    await connection.sendNotification(FAILURE_LSP_STATE, { enabled: false, generation: 20 });
    await open(3);
    await connection.sendRequest('vscode-kdb/qLanguageReady');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.strictEqual(failures.length, count, 'cleared child forwarding sends no old/new errors');
    await connection.sendRequest('shutdown');
    await connection.sendNotification('exit');
    await new Promise(resolve => child.once('exit', resolve));
  } finally {
    connection.dispose();
    if (child.exitCode === null) child.kill();
  }
  console.log('ok - real language child opt-in, implementation failure schema, lint/source privacy and clearing');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
