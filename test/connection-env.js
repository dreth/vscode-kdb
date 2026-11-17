const assert = require('assert/strict');
const { parseCredentialEnv, credentialFile, resolveEnvironmentCredentials } = require('../out/connection-env');
const { validateConnection } = require('../out/connection');
const connection = { id: 'local-q', name: 'Local Q', host: 'localhost', port: 5000, database: '.', username: '', envFile: '.env', usernameEnv: 'KX_VSCODE_USERNAME', passwordEnv: 'KX_VSCODE_PASSWORD' };
async function run() {
  const password = ' $' + '{literal} # = " \\ \' café ';
  const text = 'KX_VSCODE_USERNAME="reader"\nKX_VSCODE_PASSWORD=' + JSON.stringify(password) + '\n';
  assert.equal(parseCredentialEnv(text).KX_VSCODE_PASSWORD, password);
  for (const bad of ['not an assignment', 'A="unterminated', 'A=one\nA=two', 'A="ok" junk']) assert.throws(() => parseCredentialEnv(bad), /Invalid credential env file/);
  assert.equal(credentialFile('${workspaceFolder}/.env', '/workspace'), '/workspace/.env');
  assert.throws(() => credentialFile('.env'), /unambiguous/);
  assert.throws(() => validateConnection({ ...connection, passwordEnv: 'BAD:KEY' }), /environment variable name/);
  let current = text;
  const context = { trusted: true, folder: '/workspace', readFile: async () => current, environment: { KX_VSCODE_PASSWORD: 'process-value' } };
  assert.deepEqual(await resolveEnvironmentCredentials(connection, 'old-secret', context), { username: 'reader', password });
  current = 'KX_VSCODE_USERNAME=reader\n';
  assert.equal((await resolveEnvironmentCredentials(connection, 'old-secret', context)).password, 'process-value');
  current = 'KX_VSCODE_USERNAME=reader\nKX_VSCODE_PASSWORD=\n';
  await assert.rejects(resolveEnvironmentCredentials(connection, 'old-secret', context), /Missing credential variable: KX_VSCODE_PASSWORD/);
  await assert.rejects(resolveEnvironmentCredentials(connection, undefined, { ...context, trusted: false }), /Trust/);
  await assert.rejects(resolveEnvironmentCredentials(connection, undefined, { ...context, readFile: async () => { throw new Error('sensitive failure'); } }), /Cannot read credential envFile/);
  current = text.replace('reader', 'second-reader');
  assert.equal((await resolveEnvironmentCredentials(connection, undefined, context)).username, 'second-reader');
  assert.deepEqual(await resolveEnvironmentCredentials({ ...connection, usernameEnv: undefined, passwordEnv: undefined, username: 'legacy' }, 'legacy-secret', context), { username: 'legacy', password: 'legacy-secret' });
  const Module = require('module');
  const original = Module._load;
  const created = [];
  class Emitter { event() {} fire() {} dispose() {} }
  class FakeClient {
    constructor(options) { this.options = options; created.push(this); }
    async connect() {} async query() { return false; } async close() {} cancel() {}
  }
  const realIpc = require('../out/q-ipc');
  Module._load = function(name, parent, isMain) {
    if (name === 'vscode') return { EventEmitter: Emitter, workspace: { getConfiguration: () => ({get: () => undefined}) } };
    if (name === './q-ipc' && parent.filename.endsWith('connection-manager.js')) return { ...realIpc, KdbIpcClient: FakeClient };
    return original.call(this,name,parent,isMain);
  };
  let Manager;
  try { Manager = require('../out/connection-manager').ConnectionManager; } finally { Module._load = original; }
  const store = { credentials: (profile, legacy) => resolveEnvironmentCredentials(profile,legacy,context), password: async () => { throw new Error('Legacy secret must not be consulted'); } };
  const manager = new Manager(store);
  const first = await manager.connect(connection);
  assert.equal(first.options.username,'second-reader');
  current = text.replace('reader','third-reader');
  assert.equal(await manager.connect(connection),first,'an env edit must preserve the established session');
  await manager.testTemporary(connection);
  assert.equal(created.at(-1).options.username,'third-reader','temporary tests read current file values');
  await manager.disconnect(connection.id);
  await manager.connect(connection);
  assert.equal(created.at(-1).options.username,'third-reader','reconnect resolves current credentials');
  current='KX_VSCODE_USERNAME=reader\nKX_VSCODE_PASSWORD=\n';
  await assert.rejects(manager.testTemporary(connection),/Missing credential variable/);
  console.log('environment credential resolution and shared connection lifecycle: passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
