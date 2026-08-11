#!/usr/bin/env node
'use strict';

const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_REFERENCE_ROOT = '/opt/data/home/projects/kdb-sqltools';
const DEFAULT_REFERENCE_REVISION = 'ba36f328610ec99b77569027ce642829a20bb2ef';
const DEFAULT_Q_PATH = '/opt/data/home/.kx/bin/q';
const VALID_STATUSES = new Set(['PASS', 'DIFFERENT_BY_DESIGN', 'GAP', 'NOT_TESTABLE_HERE']);

const { buildMachineSummary, buildSummary } = require('../test/parity/summary');
const {
  assertGitStatusUnchanged,
  gitStatusSnapshot,
} = require('../test/parity/process');

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`\nPARITY INFRASTRUCTURE FAILURE\n${error && error.stack ? error.stack : error}\n`);
    process.exitCode = 1;
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (path.resolve(process.cwd()) !== ROOT) {
    throw new Error(`Run this gate from the standalone repository root: ${ROOT}`);
  }

  const referenceRoot = realDirectory(process.env.KDB_SQLTOOLS_PARITY_ROOT || DEFAULT_REFERENCE_ROOT, 'reference repository');
  const expectedReferenceRevision = process.env.KDB_SQLTOOLS_PARITY_REVISION || DEFAULT_REFERENCE_REVISION;
  const qPath = realExecutable(process.env.VSCODE_KDB_Q_BIN || DEFAULT_Q_PATH, 'required q runtime');
  if (referenceRoot === ROOT) {
    throw new Error('Standalone and reference roots resolve to the same directory.');
  }

  const standalone = inspectRepository(ROOT, 'vscode-kdb');
  const reference = inspectRepository(referenceRoot, 'kdb-sqltools');
  const verificationMode = options.worktree ? 'worktree' : 'pinned-clean';
  assertRevision(reference.commit, expectedReferenceRevision, 'reference');
  if (process.env.VSCODE_KDB_PARITY_REVISION) {
    assertRevision(standalone.commit, process.env.VSCODE_KDB_PARITY_REVISION, 'standalone');
  }
  assertPackageLockVersion(ROOT, standalone.packageJson.version, 'standalone');
  assertPackageLockVersion(referenceRoot, reference.packageJson.version, 'reference');

  const repositoryBaselines = repositoryPairSnapshot(ROOT, referenceRoot);
  assertVerificationMode(verificationMode, repositoryBaselines);
  const qVersionText = qVersion(qPath);

  printBaseline({
    standalone,
    reference,
    repositoryBaselines,
    verificationMode,
    qPath,
    qVersionText,
  });

  let isolated;
  try {
    runDependencyCheck(ROOT, 'standalone dependencies');
    runDependencyCheck(referenceRoot, 'reference dependencies');

    isolated = createIsolatedBuildRoots(ROOT, referenceRoot);
    await runCheckedCommand({
      name: 'standalone isolated compile',
      command: process.execPath,
      args: [
        path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
        '-p',
        path.join(ROOT, 'tsconfig.json'),
        '--outDir',
        isolated.standaloneOutRoot,
      ],
      cwd: ROOT,
      display: `tsc -p tsconfig.json --outDir ${shellDisplay(isolated.standaloneOutRoot)}`,
    });
    await runCheckedCommand({
      name: 'reference isolated compile',
      command: process.execPath,
      args: [
        path.join(referenceRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
        '-p',
        path.join(referenceRoot, 'tsconfig.json'),
        '--outDir',
        isolated.referenceOutRoot,
      ],
      cwd: referenceRoot,
      display: `tsc -p tsconfig.json --outDir ${shellDisplay(isolated.referenceOutRoot)}`,
    });
    await runCheckedCommand({
      name: 'standalone isolated renderer typecheck',
      command: process.execPath,
      args: [
        path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
        '-p',
        path.join(ROOT, 'renderer', 'tsconfig.json'),
        '--noEmit',
      ],
      cwd: ROOT,
      display: 'tsc -p renderer/tsconfig.json --noEmit',
    });
    await runCheckedCommand({
      name: 'standalone isolated renderer bundle',
      command: path.join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild'),
      args: [
        path.join(ROOT, 'renderer', 'index.ts'),
        '--bundle',
        '--format=esm',
        '--platform=browser',
        '--target=es2022',
        '--loader:.css=text',
        `--outfile=${isolated.standaloneRendererBundle}`,
        '--minify',
        '--legal-comments=none',
      ],
      cwd: ROOT,
      display: `esbuild renderer/index.ts --bundle --outfile=${shellDisplay(isolated.standaloneRendererBundle)}`,
    });

    await runCheckedCommand({
      name: 'parity runner self-tests',
      command: process.execPath,
      args: ['test/parity/self-test.js'],
      cwd: ROOT,
      display: 'node test/parity/self-test.js',
    });
    await runCheckedCommand({
      name: 'standalone focused suite from isolated output',
      command: process.execPath,
      args: ['test/run.js'],
      cwd: ROOT,
      env: {
        ...process.env,
        VSCODE_KDB_TEST_OUT_ROOT: isolated.standaloneOutRoot,
        VSCODE_KDB_TEST_RENDERER_BUNDLE: isolated.standaloneRendererBundle,
      },
      display: `VSCODE_KDB_TEST_OUT_ROOT=${shellDisplay(isolated.standaloneOutRoot)} VSCODE_KDB_TEST_RENDERER_BUNDLE=${shellDisplay(isolated.standaloneRendererBundle)} node test/run.js`,
    });
    await runCheckedCommand({
      name: 'standalone required live-q suite from isolated output',
      command: process.execPath,
      args: ['test/live/run.js'],
      cwd: ROOT,
      env: {
        ...process.env,
        VSCODE_KDB_TEST_OUT_ROOT: isolated.standaloneOutRoot,
        VSCODE_KDB_LIVE_REQUIRED: '1',
        VSCODE_KDB_Q_BIN: qPath,
      },
      display: `VSCODE_KDB_TEST_OUT_ROOT=${shellDisplay(isolated.standaloneOutRoot)} VSCODE_KDB_LIVE_REQUIRED=1 VSCODE_KDB_Q_BIN=${shellDisplay(qPath)} node test/live/run.js`,
    });
    await runCheckedCommand({
      name: 'reference focused suite from isolated output',
      command: process.execPath,
      args: ['test/run.js'],
      cwd: referenceRoot,
      env: {
        ...process.env,
        KDB_SQLTOOLS_TEST_OUT_ROOT: isolated.referenceOutRoot,
      },
      display: `KDB_SQLTOOLS_TEST_OUT_ROOT=${shellDisplay(isolated.referenceOutRoot)} node test/run.js`,
    });
    await runCheckedCommand({
      name: 'reference required live-q suite from isolated output',
      command: process.execPath,
      args: ['test/live/run.js'],
      cwd: referenceRoot,
      env: {
        ...process.env,
        KDB_SQLTOOLS_TEST_OUT_ROOT: isolated.referenceOutRoot,
        KDB_Q_BIN: qPath,
        KDB_SQLTOOLS_LIVE_REQUIRED: '1',
      },
      display: `KDB_SQLTOOLS_TEST_OUT_ROOT=${shellDisplay(isolated.referenceOutRoot)} KDB_Q_BIN=${shellDisplay(qPath)} KDB_SQLTOOLS_LIVE_REQUIRED=1 node test/live/run.js`,
    });

    const { loadParityAdapters } = require('../test/parity/loaders');
    const fixtures = require('../test/parity/fixtures');
    const canonical = require('../test/parity/canonical');
    const { runParitySuite } = require('../test/parity/suite');
    const adapters = loadParityAdapters({
      standaloneRoot: ROOT,
      referenceRoot,
      standaloneOutRoot: isolated.standaloneOutRoot,
      referenceOutRoot: isolated.referenceOutRoot,
    });
    const execution = createCaseExecution();

    await runParitySuite({
      ...execution.context,
      standalone: adapters.standalone,
      reference: adapters.reference,
      fixtures,
      canonical,
      qPath,
      roots: { standalone: ROOT, reference: referenceRoot },
      liveFixturePath: path.join(ROOT, 'test', 'parity', 'fixture.q'),
    });

    const summary = buildSummary(execution.outcomes, execution.assertionCount());
    const machineSummary = buildMachineSummary({
      standaloneCommit: standalone.commit,
      referenceCommit: reference.commit,
      summary,
    });
    process.stdout.write(`PARITY_RESULT_JSON=${JSON.stringify(machineSummary)}\n`);

    if (summary.unexpectedCount > 0) {
      process.exitCode = 1;
    } else if (options.failOnKnownGap && summary.byStatus.GAP > 0) {
      process.stderr.write(`Strict parity mode found ${summary.byStatus.GAP} known GAP case(s).\n`);
      process.exitCode = 2;
    }
  } finally {
    if (isolated) {
      fs.rmSync(isolated.tempRoot, { recursive: true, force: true });
    }
    assertRepositoryPairUnchanged(
      repositoryBaselines,
      repositoryPairSnapshot(ROOT, referenceRoot),
      'final parity verification'
    );
  }
}

function createCaseExecution() {
  const outcomes = [];
  const ids = new Set();
  let assertions = 0;
  const count = operation => (...args) => {
    assertions += 1;
    return operation(...args);
  };
  const assertionApi = {
    equal: count(assert.strictEqual),
    deepEqual: count(assert.deepStrictEqual),
    ok: count(assert.ok),
    match: count(assert.match),
    rejects: count(assert.rejects),
    throws: count(assert.throws),
    increment(amount = 1) {
      assertions += amount;
    },
  };

  const recordCase = async (definition, operation) => {
    validateCaseDefinition(definition, ids);
    const expectedStatus = definition.expectedStatus;
    let status = expectedStatus;
    let unexpected = false;
    let failure;
    try {
      if (operation) {
        await operation(assertionApi);
      }
    } catch (error) {
      status = 'GAP';
      unexpected = true;
      failure = error && error.stack ? error.stack : String(error);
    }
    const outcome = {
      id: definition.id,
      area: definition.area,
      mode: definition.mode,
      status,
      expectedStatus,
      rationale: definition.rationale,
      detail: failure || definition.detail,
      rank: definition.rank,
      action: definition.action,
      unexpected,
    };
    outcomes.push(withoutUndefined(outcome));
    process.stderr.write(`${unexpected ? 'not ok' : 'ok'} - [${status}] ${definition.id}${failure ? `: ${firstLine(failure)}` : ''}\n`);
    if (failure) {
      process.stderr.write(`${failure}\n`);
    }
    return outcome;
  };

  return {
    outcomes,
    assertionCount: () => assertions,
    context: { case: recordCase },
  };
}

function validateCaseDefinition(definition, ids) {
  if (!definition || !definition.id || ids.has(definition.id)) {
    throw new Error(`Parity case ID must be unique and non-empty: ${definition && definition.id}`);
  }
  ids.add(definition.id);
  if (!definition.area || !['deterministic', 'live-q', 'boundary'].includes(definition.mode)) {
    throw new Error(`Parity case ${definition.id} is missing a supported area/mode.`);
  }
  if (!VALID_STATUSES.has(definition.expectedStatus)) {
    throw new Error(`Parity case ${definition.id} has unsupported status ${definition.expectedStatus}.`);
  }
  if (definition.expectedStatus === 'DIFFERENT_BY_DESIGN' && !definition.rationale) {
    throw new Error(`Parity case ${definition.id} needs a design rationale.`);
  }
  if (definition.expectedStatus === 'GAP' && (!definition.rank || !definition.action)) {
    throw new Error(`Parity case ${definition.id} needs gap rank/action metadata.`);
  }
  if (definition.expectedStatus === 'NOT_TESTABLE_HERE' && !definition.rationale) {
    throw new Error(`Parity case ${definition.id} needs an untestable rationale.`);
  }
}

function inspectRepository(root, expectedName) {
  const top = path.resolve(gitCapture(root, ['rev-parse', '--show-toplevel']).trim());
  if (top !== root) {
    throw new Error(`${expectedName} root mismatch: expected ${root}, git reports ${top}`);
  }
  const packagePath = path.join(root, 'package.json');
  if (!fs.existsSync(packagePath)) {
    throw new Error(`${expectedName} package.json is missing: ${packagePath}`);
  }
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  if (packageJson.name !== expectedName) {
    throw new Error(`Wrong checkout at ${root}: expected package ${expectedName}, found ${packageJson.name || '<unnamed>'}`);
  }
  return {
    root,
    packageJson,
    commit: gitCapture(root, ['rev-parse', 'HEAD']).trim(),
  };
}

function assertPackageLockVersion(root, version, label) {
  const lockPath = path.join(root, 'package-lock.json');
  if (!fs.existsSync(lockPath)) {
    throw new Error(`${label} package-lock.json is required: ${lockPath}`);
  }
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const rootVersion = lock.packages && lock.packages[''] && lock.packages[''].version;
  if (lock.version !== version || rootVersion !== version) {
    throw new Error(`${label} package/lock version mismatch: package=${version}, lock=${lock.version}, lock root=${rootVersion}`);
  }
}

function assertRevision(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`Wrong ${label} revision: expected ${expected}, found ${actual}`);
  }
}

function repositoryPairSnapshot(standaloneRoot, referenceRoot) {
  return Object.freeze({
    standalone: gitStatusSnapshot(standaloneRoot),
    reference: gitStatusSnapshot(referenceRoot),
  });
}

function assertVerificationMode(mode, snapshots) {
  if (mode === 'worktree') {
    return;
  }
  if (mode !== 'pinned-clean') {
    throw new Error(`Unsupported parity verification mode: ${mode}`);
  }
  const dirty = Object.entries(snapshots)
    .filter(([, snapshot]) => snapshot.entries.length > 0)
    .map(([label, snapshot]) =>
      `${label}: ${snapshot.entries.map(entry => `${entry.status} ${entry.path}`).join(', ')}`
    );
  if (dirty.length > 0) {
    throw new Error(
      'Pinned-clean parity requires clean standalone and reference worktrees. ' +
      'Use --worktree to attest explicit dirty content without weakening this gate.\n' +
      dirty.join('\n')
    );
  }
}

function assertRepositoryPairUnchanged(before, after, label) {
  const errors = [];
  for (const repository of ['standalone', 'reference']) {
    try {
      assertGitStatusUnchanged(
        before[repository],
        after[repository],
        `${label} ${repository} repository`
      );
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, `${label} changed both guarded repositories`);
  }
}

function createIsolatedBuildRoots(standaloneRoot, referenceRoot) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-kdb-cross-parity-'));
  const standaloneParent = path.join(tempRoot, 'standalone');
  const referenceParent = path.join(tempRoot, 'reference');
  const standaloneOutRoot = path.join(standaloneParent, 'out');
  const referenceOutRoot = path.join(referenceParent, 'out');
  const standaloneRendererBundle = path.join(
    standaloneParent,
    'renderer',
    'kx-notebook-renderer.js'
  );
  fs.mkdirSync(standaloneOutRoot, { recursive: true });
  fs.mkdirSync(referenceOutRoot, { recursive: true });
  fs.mkdirSync(path.dirname(standaloneRendererBundle), { recursive: true });
  fs.symlinkSync(path.join(standaloneRoot, 'node_modules'), path.join(standaloneParent, 'node_modules'), 'dir');
  fs.symlinkSync(path.join(referenceRoot, 'node_modules'), path.join(referenceParent, 'node_modules'), 'dir');
  return Object.freeze({
    tempRoot,
    standaloneOutRoot,
    referenceOutRoot,
    standaloneRendererBundle,
  });
}

function runDependencyCheck(cwd, name) {
  const display = 'npm ls --depth=0';
  process.stderr.write(`\n==> ${name}: ${display}\n`);
  const result = cp.spawnSync(npmCommand(), ['ls', '--depth=0'], {
    cwd,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout) {
    process.stderr.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.error || result.status !== 0) {
    throw result.error || new Error(`${name} failed with exit ${result.status}`);
  }
  return {
    name,
    command: display,
    exitCode: 0,
    outcome: 'installed dependency tree satisfied package metadata',
  };
}

function runCheckedCommand(spec) {
  return new Promise((resolve, reject) => {
    if (!spec.silent) {
      process.stderr.write(`\n==> ${spec.name}: ${spec.display}\n`);
    }
    const child = cp.spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let forceKill;
    const timeoutMs = spec.timeoutMs || 10 * 60 * 1000;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKill = setTimeout(() => child.kill('SIGKILL'), spec.killGraceMs || 5000);
    }, timeoutMs);
    child.stdout.on('data', chunk => {
      stdout = `${stdout}${chunk}`.slice(-100000);
      if (!spec.silent) {
        process.stderr.write(chunk);
      }
    });
    child.stderr.on('data', chunk => {
      stderr = `${stderr}${chunk}`.slice(-100000);
      if (!spec.silent) {
        process.stderr.write(chunk);
      }
    });
    child.once('error', error => {
      clearTimeout(timeout);
      clearTimeout(forceKill);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      clearTimeout(forceKill);
      if (timedOut) {
        reject(new Error(`${spec.name} timed out after ${timeoutMs} ms${signal ? ` (${signal})` : ''}\n${stdout}\n${stderr}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${spec.name} failed with exit ${code}${signal ? ` (${signal})` : ''}\n${stdout}\n${stderr}`));
        return;
      }
      resolve({
        name: spec.name,
        command: spec.display,
        exitCode: 0,
        outcome: lastMeaningfulLine(stdout || stderr) || 'completed successfully',
      });
    });
  });
}

function qVersion(qPath) {
  const result = cp.spawnSync(qPath, ['-q'], {
    input: '-1 .Q.s (.z.K;.z.k);\n\\\\\n',
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw result.error || new Error(`Unable to execute required q runtime ${qPath}: exit ${result.status}`);
  }
  const lines = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean);
  return lines.length >= 2 ? `q ${lines[0].replace(/f$/, '')} ${lines[1]}` : `q executable verified (${lines.join(' ') || 'version unavailable'})`;
}

function parseArgs(args) {
  const options = {
    failOnKnownGap: process.env.PARITY_STRICT_GAPS === '1',
    worktree: process.env.VSCODE_KDB_PARITY_MODE === 'worktree',
    help: false,
  };
  for (const arg of args) {
    switch (arg) {
      case '--fail-on-known-gap':
        options.failOnKnownGap = true;
        break;
      case '--worktree':
        options.worktree = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown parity option: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  process.stdout.write(`Usage: npm run test:parity -- [options]\n\n` +
    `Environment:\n` +
    `  KDB_SQLTOOLS_PARITY_ROOT      reference path (default ${DEFAULT_REFERENCE_ROOT})\n` +
    `  KDB_SQLTOOLS_PARITY_REVISION  expected reference commit (default ${DEFAULT_REFERENCE_REVISION})\n` +
    `  VSCODE_KDB_PARITY_REVISION    optional expected standalone commit\n` +
    `  VSCODE_KDB_Q_BIN              q executable (default ${DEFAULT_Q_PATH})\n` +
    `  VSCODE_KDB_PARITY_MODE        worktree to verify an explicit dirty tree\n` +
    `  PARITY_STRICT_GAPS=1          fail with exit 2 for registered GAP cases\n\n` +
    `Options:\n` +
    `  --worktree           permit dirty trees while guarding them against changes\n` +
    `  --fail-on-known-gap  exit 2 when registered GAP cases remain\n\n` +
    `Default pinned-clean mode fails closed on either dirty worktree. Compiled output is isolated under /tmp.\n` +
    `Progress goes to stderr; stdout contains one PARITY_RESULT_JSON line.\n`);
}

function printBaseline(values) {
  process.stderr.write(`Cross-extension parity preflight\n` +
    `  mode:       ${values.verificationMode}\n` +
    `  standalone: ${values.standalone.commit} (${values.standalone.packageJson.name}@${values.standalone.packageJson.version})\n` +
    `  reference:  ${values.reference.commit} (${values.reference.packageJson.name}@${values.reference.packageJson.version})\n` +
    `  q runtime:  ${values.qPath} (${values.qVersionText})\n` +
    `  standalone state: ${values.repositoryBaselines.standalone.hash} (${values.repositoryBaselines.standalone.entries.length} dirty entries)\n` +
    `  reference state:  ${values.repositoryBaselines.reference.hash} (${values.repositoryBaselines.reference.entries.length} dirty entries)\n`);
}

function gitCapture(cwd, args) {
  return gitCaptureBuffer(cwd, args).toString('utf8');
}

function gitCaptureBuffer(cwd, args) {
  const result = cp.spawnSync('git', args, { cwd, encoding: null, maxBuffer: 50 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw result.error || new Error(`git ${args.join(' ')} failed in ${cwd}: ${String(result.stderr || '')}`);
  }
  return Buffer.from(result.stdout || Buffer.alloc(0));
}

function realDirectory(value, label) {
  const resolved = path.resolve(value);
  let real;
  try {
    real = fs.realpathSync(resolved);
  } catch (error) {
    throw new Error(`${label} is unavailable at ${resolved}: ${error.message}`);
  }
  if (!fs.statSync(real).isDirectory()) {
    throw new Error(`${label} is not a directory: ${real}`);
  }
  return real;
}

function realExecutable(value, label) {
  const resolved = path.resolve(value);
  try {
    fs.accessSync(resolved, fs.constants.X_OK);
  } catch (error) {
    throw new Error(`${label} is unavailable or not executable at ${resolved}: ${error.message}`);
  }
  return fs.realpathSync(resolved);
}

function withoutUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== false));
}

function firstLine(value) {
  return String(value).split(/\r?\n/, 1)[0];
}

function lastMeaningfulLine(value) {
  return String(value).split(/\r?\n/).map(line => line.trim()).filter(Boolean).at(-1) || '';
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function shellDisplay(value) {
  return /^[A-Za-z0-9_./:-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

module.exports = {
  assertRepositoryPairUnchanged,
  assertVerificationMode,
  createIsolatedBuildRoots,
  parseArgs,
  repositoryPairSnapshot,
  runCheckedCommand,
};
