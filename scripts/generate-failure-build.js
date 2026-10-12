'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
// Hash exact first-party release artifacts. No timestamps, paths or git/user metadata.
const files = ['out/extension.js', 'out/q-language-server.js', 'renderer/kx-notebook-renderer.js'];
const artifacts = Object.fromEntries(files.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const libraries = Object.fromEntries(Object.keys(require('../package.json').dependencies).map(name => [name, require('../package-lock.json').packages['node_modules/' + name].version]));
const buildId = crypto.createHash('sha256').update(JSON.stringify(artifacts)).digest('hex');
fs.writeFileSync('out/failure-build.json', JSON.stringify({ schemaVersion: 1, release: require('../package.json').version, buildId, artifacts, libraries }, null, 2) + '\n');
