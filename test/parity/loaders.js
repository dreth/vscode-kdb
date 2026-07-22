'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const COMPILED_MODULES = Object.freeze({
  standalone: Object.freeze({
    ipc: 'q-ipc.js',
    qText: 'q-text.js',
    namespace: 'connection.js',
    chart: 'charting.js',
    results: 'kx-results.js',
    localServer: 'local-data-server.js',
    panel: 'kx-results-panel.js',
  }),
  reference: Object.freeze({
    ipc: 'ls/q-ipc.js',
    qText: 'q-text.js',
    namespace: 'ls/driver.js',
    chart: 'charting.js',
    results: 'kdb-results.js',
    localServer: 'local-data-server.js',
    panel: 'results-panel.js',
  }),
});

const PRIVATE_EXPORT_NAME = '__crossParityPrivate';

function loadParityAdapters({ standaloneRoot, referenceRoot }) {
  return {
    standalone: loadAdapter(standaloneRoot, COMPILED_MODULES.standalone, 'standalone'),
    reference: loadAdapter(referenceRoot, COMPILED_MODULES.reference, 'reference'),
  };
}

function loadAdapter(repoRoot, modulePaths, label) {
  const root = realDirectory(repoRoot, `${label} repository`);
  const outRoot = realDirectory(path.join(root, 'out'), `${label} compiled output`);
  clearRequireCacheUnder(outRoot);

  const ipc = requireCompiledModule(outRoot, modulePaths.ipc, `${label} q IPC`);
  const qText = requireCompiledModule(outRoot, modulePaths.qText, `${label} q text`);
  const namespace = requireCompiledModule(outRoot, modulePaths.namespace, `${label} namespace`);
  const chart = requireCompiledModule(outRoot, modulePaths.chart, `${label} chart`);
  const results = requireCompiledModule(outRoot, modulePaths.results, `${label} results`);
  const localServer = requireCompiledModule(outRoot, modulePaths.localServer, `${label} local data server`);
  const columnarToXlsx = loadPrivateColumnarToXlsx(
    outRoot,
    modulePaths.panel,
    `${label} results panel`
  );

  return Object.freeze({
    ipc,
    qText,
    namespace,
    chart,
    results,
    localServer,
    xlsx: Object.freeze({ columnarToXlsx }),
    packageJson: readPackageJson(root, label),
    root,
  });
}

function requireCompiledModule(outRoot, relativeFile, label = relativeFile) {
  const filename = resolveContainedFile(outRoot, relativeFile, label);
  try {
    return require(filename);
  } catch (error) {
    throw contextualError(`Could not load ${label} from ${filename}`, error);
  }
}

function loadPrivateColumnarToXlsx(outRoot, relativePanelFile, label = relativePanelFile) {
  const filename = resolveContainedFile(outRoot, relativePanelFile, label);
  const source = fs.readFileSync(filename, 'utf8');
  if (!/\b(?:async\s+)?function\s+columnarToXlsx\s*\(/.test(source)) {
    throw new Error(`${label} does not contain the expected columnarToXlsx function: ${filename}`);
  }
  if (source.includes(`module.exports.${PRIVATE_EXPORT_NAME}`)) {
    throw new Error(`${label} already defines the reserved ${PRIVATE_EXPORT_NAME} export: ${filename}`);
  }

  const instrumented = `${source}\nmodule.exports.${PRIVATE_EXPORT_NAME} = Object.freeze({ columnarToXlsx });\n`;
  const loaded = compileCommonJsInMemory(filename, instrumented, minimalVscodeMock());
  const privateExports = loaded && loaded[PRIVATE_EXPORT_NAME];
  if (!privateExports || typeof privateExports.columnarToXlsx !== 'function') {
    throw new Error(`Could not expose columnarToXlsx from ${label}: ${filename}`);
  }
  return privateExports.columnarToXlsx;
}

function compileCommonJsInMemory(filename, source, vscodeMock) {
  const testModule = new Module(filename, module);
  testModule.filename = filename;
  testModule.paths = Module._nodeModulePaths(path.dirname(filename));
  testModule.require = request => {
    if (request === 'vscode') {
      return vscodeMock;
    }
    return Module._load(request, testModule, false);
  };

  try {
    testModule._compile(source, filename);
  } catch (error) {
    throw contextualError(`Could not compile parity adapter for ${filename}`, error);
  }
  return testModule.exports;
}

function minimalVscodeMock() {
  return {
    ConfigurationTarget: { Global: 1 },
    ProgressLocation: { Notification: 15, Window: 10 },
    Uri: { file: fsPath => ({ fsPath }) },
    ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2, Three: 3 },
    env: {},
    window: {},
    workspace: {},
  };
}

function readPackageJson(repoRoot, label = 'repository') {
  const filename = resolveContainedFile(repoRoot, 'package.json', `${label} package.json`);
  try {
    return JSON.parse(fs.readFileSync(filename, 'utf8'));
  } catch (error) {
    throw contextualError(`Could not read ${label} package.json from ${filename}`, error);
  }
}

function resolveContainedFile(containerRoot, relativeFile, label = relativeFile) {
  if (typeof relativeFile !== 'string' || relativeFile.length === 0 || path.isAbsolute(relativeFile)) {
    throw new Error(`${label} must be a non-empty relative path`);
  }

  const root = realDirectory(containerRoot, `${label} container`);
  const candidate = path.resolve(root, relativeFile);
  assertPathContained(root, candidate, label);

  let realCandidate;
  try {
    realCandidate = fs.realpathSync(candidate);
  } catch (error) {
    throw contextualError(`${label} is missing: ${candidate}`, error);
  }
  assertPathContained(root, realCandidate, label);

  const stat = fs.statSync(realCandidate);
  if (!stat.isFile()) {
    throw new Error(`${label} is not a file: ${realCandidate}`);
  }
  return realCandidate;
}

function assertPathContained(root, candidate, label = 'path') {
  const relative = path.relative(root, candidate);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    return;
  }
  throw new Error(`${label} escapes its required root ${root}: ${candidate}`);
}

function realDirectory(directory, label = 'directory') {
  let real;
  try {
    real = fs.realpathSync(path.resolve(directory));
  } catch (error) {
    throw contextualError(`${label} is missing: ${path.resolve(directory)}`, error);
  }
  if (!fs.statSync(real).isDirectory()) {
    throw new Error(`${label} is not a directory: ${real}`);
  }
  return real;
}

function clearRequireCacheUnder(directory) {
  const root = realDirectory(directory, 'compiled output');
  for (const filename of Object.keys(require.cache)) {
    let realFilename;
    try {
      realFilename = fs.realpathSync(filename);
    } catch {
      continue;
    }
    if (isPathContained(root, realFilename)) {
      delete require.cache[filename];
    }
  }
}

function isPathContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function contextualError(message, cause) {
  const detail = cause && cause.message ? `: ${cause.message}` : '';
  const error = new Error(`${message}${detail}`);
  error.cause = cause;
  return error;
}

module.exports = {
  COMPILED_MODULES,
  assertPathContained,
  clearRequireCacheUnder,
  loadParityAdapters,
  loadPrivateColumnarToXlsx,
  minimalVscodeMock,
  readPackageJson,
  requireCompiledModule,
  resolveContainedFile,
};
