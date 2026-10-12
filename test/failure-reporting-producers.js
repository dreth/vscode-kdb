'use strict';
// Run existing extension contracts with a failing failure observer at every
// freshly loaded producer boundary. No SDK or receiver is involved here.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const recordPath = path.resolve(__dirname, '../out/failure-record.js');
const originalCompile = Module.prototype._compile;
let observed = 0;
global.__kxFailureObserverFixture = () => { observed++; throw new Error('report observer unavailable'); };
Module.prototype._compile = function(content, filename) {
  if (path.resolve(filename) === recordPath) {
    content += '\nexports.configureFailureObserver(global.__kxFailureObserverFixture);\n';
  }
  return originalCompile.call(this, content, filename);
};
process.env.VSCODE_KDB_TEST_FILTER = '';
require('./run');
process.once('exit', () => {
  Module.prototype._compile = originalCompile;
  delete global.__kxFailureObserverFixture;
  assert(observed > 0, 'fixtures must exercise real eligible notebook failures');
  console.log('ok - extension execution, IPC, notebook bytes/ownership, stale/cancellation and actions survive observer failure');
});
