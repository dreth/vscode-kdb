#!/usr/bin/env node
'use strict';

const assert = require('assert');
const cp = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_REFERENCE_ROOT = '/opt/data/home/projects/kdb-sqltools';
const DEFAULT_REFERENCE_REVISION = 'ba36f328610ec99b77569027ce642829a20bb2ef';
const DEFAULT_Q_PATH = '/opt/data/home/.kx/bin/q';
const VALID_STATUSES = new Set(['PASS', 'DIFFERENT_BY_DESIGN', 'GAP', 'NOT_TESTABLE_HERE']);

const { buildMachineSummary, buildSummary } = require('../test/parity/summary');
const {
  assertGitStatusUnchanged,
  assertReferenceDirtyState,
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
  assertRevision(reference.commit, expectedReferenceRevision, 'reference');
  if (process.env.VSCODE_KDB_PARITY_REVISION) {
    assertRevision(standalone.commit, process.env.VSCODE_KDB_PARITY_REVISION, 'standalone');
  }
  assertPackageLockVersion(ROOT, standalone.packageJson.version, 'standalone');
  assertPackageLockVersion(referenceRoot, reference.packageJson.version, 'reference');

  const referenceStatusBefore = referenceStatusSnapshot(referenceRoot);
  assertAllowedReferenceStatus(referenceStatusBefore.raw);
  const standaloneStatus = gitCapture(ROOT, ['status', '--porcelain=v1', '--untracked-files=all']);
  const qVersionText = qVersion(qPath);

  printBaseline({ standalone, reference, referenceStatusBefore, standaloneStatus, qPath, qVersionText });
  assertStrictStandaloneState(standaloneStatus, options.failOnKnownGap);

  runDependencyCheck(ROOT, 'standalone dependencies');
  runDependencyCheck(referenceRoot, 'reference dependencies');
  assertReferenceSnapshotUnchanged(referenceStatusBefore, referenceStatusSnapshot(referenceRoot));

  await runCheckedCommand({
    name: 'standalone compile',
    command: npmCommand(),
    args: ['run', 'compile'],
    cwd: ROOT,
    display: 'npm run compile',
  });
  await runReferenceCommand({
    name: 'reference compile',
    command: npmCommand(),
    args: ['run', 'compile'],
    cwd: referenceRoot,
    display: 'npm run compile',
  }, referenceStatusBefore);

  await runCheckedCommand({
    name: 'parity runner self-tests',
    command: process.execPath,
    args: ['test/parity/self-test.js'],
    cwd: ROOT,
    display: 'node test/parity/self-test.js',
  });
  await runCheckedCommand({
    name: 'standalone focused suite',
    command: process.execPath,
    args: ['test/run.js'],
    cwd: ROOT,
    display: 'node test/run.js',
  });
  await runCheckedCommand({
    name: 'standalone required live-q suite',
    command: process.execPath,
    args: ['test/live/run.js'],
    cwd: ROOT,
    env: {
      ...process.env,
      VSCODE_KDB_LIVE_REQUIRED: '1',
      VSCODE_KDB_Q_BIN: qPath,
    },
    display: `VSCODE_KDB_LIVE_REQUIRED=1 VSCODE_KDB_Q_BIN=${shellDisplay(qPath)} node test/live/run.js`,
  });
  await runReferenceCommand({
    name: 'reference focused suite',
    command: process.execPath,
    args: ['test/run.js'],
    cwd: referenceRoot,
    display: 'node test/run.js',
  }, referenceStatusBefore);
  await runReferenceCommand({
    name: 'reference required live-q suite',
    command: process.execPath,
    args: ['test/live/run.js'],
    cwd: referenceRoot,
    env: {
      ...process.env,
      KDB_Q_BIN: qPath,
      KDB_SQLTOOLS_LIVE_REQUIRED: '1',
    },
    display: `KDB_Q_BIN=${shellDisplay(qPath)} KDB_SQLTOOLS_LIVE_REQUIRED=1 node test/live/run.js`,
  }, referenceStatusBefore);

  const { loadParityAdapters } = require('../test/parity/loaders');
  const fixtures = require('../test/parity/fixtures');
  const canonical = require('../test/parity/canonical');
  const { runParitySuite } = require('../test/parity/suite');
  const adapters = loadParityAdapters({ standaloneRoot: ROOT, referenceRoot });
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

  const referenceStatusAfter = referenceStatusSnapshot(referenceRoot);
  assertReferenceSnapshotUnchanged(referenceStatusBefore, referenceStatusAfter);
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

function referenceStatusSnapshot(root) {
  const raw = gitCaptureBuffer(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const robust = gitStatusSnapshot(root);
  assertReferenceDirtyState(robust);
  return {
    raw,
    entries: raw.toString('utf8').split('\0').filter(Boolean),
    hash: robust.hash,
    porcelainHash: crypto.createHash('sha256').update(raw).digest('hex'),
    robust,
  };
}

function assertAllowedReferenceStatus(raw) {
  const entries = raw.toString('utf8').split('\0').filter(Boolean);
  for (const entry of entries) {
    const indexStatus = entry[0];
    const worktreeStatus = entry[1];
    const file = entry.slice(3);
    if (indexStatus !== ' ' || worktreeStatus !== 'M' || !file.startsWith('docs/')) {
      throw new Error(`Reference dirty state is not the approved unstaged docs/** drift: ${JSON.stringify(entry)}`);
    }
  }
}

function assertReferenceSnapshotUnchanged(before, after) {
  assertAllowedReferenceStatus(after.raw);
  assertGitStatusUnchanged(before.robust, after.robust, 'reference repository');
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

async function runReferenceCommand(spec, baseline) {
  let result;
  let commandError;
  try {
    result = await runCheckedCommand(spec);
  } catch (error) {
    commandError = error;
  }

  let statusError;
  try {
    const after = referenceStatusSnapshot(spec.cwd);
    assertReferenceSnapshotUnchanged(baseline, after);
  } catch (error) {
    statusError = error;
  }

  if (statusError && commandError) {
    const combined = new AggregateError(
      [commandError, statusError],
      `${spec.name} failed and the reference repository state changed`
    );
    combined.commandError = commandError;
    combined.statusError = statusError;
    throw combined;
  }
  if (statusError) {
    throw statusError;
  }
  if (commandError) {
    throw commandError;
  }
  return result;
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
  const options = { failOnKnownGap: process.env.PARITY_STRICT_GAPS === '1', help: false };
  for (const arg of args) {
    switch (arg) {
      case '--fail-on-known-gap':
        options.failOnKnownGap = true;
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
    `  PARITY_STRICT_GAPS=1          fail with exit 2 for registered GAP cases\n\n` +
    `Options:\n` +
    `  --fail-on-known-gap  exit 2 when registered GAP cases remain\n\n` +
    `A run writes no files. Progress goes to stderr; stdout contains one PARITY_RESULT_JSON line.\n`);
}

function printBaseline(values) {
  process.stderr.write(`Cross-extension parity preflight\n` +
    `  standalone: ${values.standalone.commit} (${values.standalone.packageJson.name}@${values.standalone.packageJson.version})\n` +
    `  reference:  ${values.reference.commit} (${values.reference.packageJson.name}@${values.reference.packageJson.version})\n` +
    `  q runtime:  ${values.qPath} (${values.qVersionText})\n` +
    `  standalone tracked state: ${dirtyDisclaimer(values.standaloneStatus, 'standalone')}\n` +
    `  reference tracked state: ${values.referenceStatusBefore.entries.length} pre-existing unstaged docs/** modifications; SHA-256 ${values.referenceStatusBefore.hash}\n`);
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

function dirtyDisclaimer(status, label) {
  if (!status) {
    return 'clean tracked worktree';
  }
  const count = status.split(/\r?\n/).filter(Boolean).length;
  return `${count} tracked/untracked non-ignored entries present while testing ${label}; exact commit plus working-tree state was printed`;
}

function assertStrictStandaloneState(status, strict) {
  if (strict && String(status || '').trim()) {
    throw new Error(
      'Strict parity mode requires a clean standalone tracked/untracked worktree. ' +
      'Use the default mode while changing the repository.'
    );
  }
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
  assertStrictStandaloneState,
  referenceStatusSnapshot,
  runCheckedCommand,
  runReferenceCommand,
};
