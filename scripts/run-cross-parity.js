#!/usr/bin/env node
'use strict';

const assert = require('assert');
const cp = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_REFERENCE_ROOT = '/opt/data/home/projects/kdb-sqltools';
const DEFAULT_REFERENCE_REVISION = 'af2c7c920932274f156e31832859fa262068effe';
const DEFAULT_Q_PATH = '/opt/data/home/.kx/bin/q';
const VALID_STATUSES = new Set(['PASS', 'DIFFERENT_BY_DESIGN', 'GAP', 'NOT_TESTABLE_HERE']);

const { buildSummary, validateEvidence, writeEvidenceFiles } = require('../test/parity/report');
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
  const qVersionEvidence = qVersion(qPath);

  printBaseline({ standalone, reference, referenceStatusBefore, standaloneStatus, qPath, qVersionEvidence });
  assertStrictStandaloneState(standaloneStatus, options.failOnKnownGap);

  const checks = [];
  checks.push(runDependencyCheck(ROOT, 'standalone dependencies'));
  checks.push(runDependencyCheck(referenceRoot, 'reference dependencies'));
  assertReferenceSnapshotUnchanged(referenceStatusBefore, referenceStatusSnapshot(referenceRoot));

  checks.push(await runCheckedCommand({
    name: 'standalone compile',
    command: npmCommand(),
    args: ['run', 'compile'],
    cwd: ROOT,
    display: 'npm run compile',
  }));
  checks.push(await runReferenceCommand({
    name: 'reference compile',
    command: npmCommand(),
    args: ['run', 'compile'],
    cwd: referenceRoot,
    display: 'npm run compile',
  }, referenceStatusBefore));

  checks.push(await runCheckedCommand({
    name: 'parity runner self-tests',
    command: process.execPath,
    args: ['test/parity/self-test.js'],
    cwd: ROOT,
    display: 'node test/parity/self-test.js',
  }));
  checks.push(await runCheckedCommand({
    name: 'standalone focused suite',
    command: process.execPath,
    args: ['test/run.js'],
    cwd: ROOT,
    display: 'node test/run.js',
  }));
  checks.push(await runCheckedCommand({
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
  }));
  checks.push(await runReferenceCommand({
    name: 'reference focused suite',
    command: process.execPath,
    args: ['test/run.js'],
    cwd: referenceRoot,
    display: 'node test/run.js',
  }, referenceStatusBefore));
  checks.push(await runReferenceCommand({
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
  }, referenceStatusBefore));

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
  checks.push({
    name: 'cross-extension same-fixture suite',
    command: 'npm run test:parity',
    exitCode: summary.unexpectedCount === 0 ? 0 : 1,
    outcome: `${summary.caseCount} classified cases; ${summary.assertionCount} assertions; ${summary.gateResult}`,
  });

  const evidence = validateEvidence({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    standalone: {
      name: standalone.packageJson.name,
      version: standalone.packageJson.version,
      commit: standalone.commit,
      dirty: standaloneStatus.length > 0,
      dirtyDisclaimer: dirtyDisclaimer(standaloneStatus, 'standalone'),
    },
    reference: {
      name: reference.packageJson.name,
      version: reference.packageJson.version,
      commit: reference.commit,
      expectedCommit: expectedReferenceRevision,
      dirty: referenceStatusBefore.entries.length > 0,
      dirtyEntryCount: referenceStatusBefore.entries.length,
      dirtyDisclaimer: `${referenceStatusBefore.entries.length} pre-existing unstaged tracked docs/** entries only; excluded from source evidence`,
      statusHashBefore: referenceStatusBefore.hash,
      statusHashAfter: referenceStatusAfter.hash,
    },
    q: {
      path: qPath,
      versionEvidence: qVersionEvidence,
      fixture: 'test/parity/fixture.q',
      authentication: 'anonymous loopback only',
    },
    canonicalization: [
      'validated 48-hex local-server tokens',
      'asserted ephemeral loopback ports',
      'path separators in path-bearing values',
      'ZIP timestamps/compression metadata by comparing unzipped entries',
      'fixture-owned generated IDs fixed at source',
    ],
    checks,
    summary,
    outcomes: execution.outcomes,
  });

  printSummary(evidence);
  if (options.writeReport && summary.unexpectedCount === 0) {
    writeEvidenceFiles(ROOT, evidence);
    process.stdout.write(`Evidence written: ${path.join(ROOT, 'PARITY_RUN.json')} and ${path.join(ROOT, 'PARITY_RUN.md')}\n`);
  }

  const machineSummary = {
    schemaVersion: evidence.schemaVersion,
    standaloneCommit: evidence.standalone.commit,
    referenceCommit: evidence.reference.commit,
    summary: evidence.summary,
    statuses: evidence.outcomes.map(({ id, status }) => ({ id, status })),
  };
  process.stdout.write(`PARITY_RESULT_JSON=${JSON.stringify(machineSummary)}\n`);

  if (summary.unexpectedCount > 0) {
    process.exitCode = 1;
  } else if (options.failOnKnownGap && summary.byStatus.GAP > 0) {
    process.stderr.write(`Strict parity gate blocked by ${summary.byStatus.GAP} known GAP case(s).\n`);
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
      signoff: definition.signoff,
      unexpected,
    };
    outcomes.push(withoutUndefined(outcome));
    process.stdout.write(`${unexpected ? 'not ok' : 'ok'} - [${status}] ${definition.id}${failure ? `: ${firstLine(failure)}` : ''}\n`);
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
  if (definition.expectedStatus === 'GAP' && (!definition.rank || !definition.action || !definition.signoff)) {
    throw new Error(`Parity case ${definition.id} needs gap rank/action/signoff metadata.`);
  }
  if (definition.expectedStatus === 'NOT_TESTABLE_HERE' && (!definition.rationale || !definition.signoff)) {
    throw new Error(`Parity case ${definition.id} needs untestable rationale/future evidence.`);
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
  process.stdout.write(`\n==> ${name}: ${display}\n`);
  const result = cp.spawnSync(npmCommand(), ['ls', '--depth=0'], {
    cwd,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
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
      process.stdout.write(`\n==> ${spec.name}: ${spec.display}\n`);
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
        process.stdout.write(chunk);
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
  const options = { failOnKnownGap: process.env.PARITY_STRICT_GAPS === '1', writeReport: false, help: false };
  for (const arg of args) {
    switch (arg) {
      case '--fail-on-known-gap':
        options.failOnKnownGap = true;
        break;
      case '--write-report':
        options.writeReport = true;
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
    `  --write-report       update PARITY_RUN.json and PARITY_RUN.md\n` +
    `  --fail-on-known-gap  strict sign-off mode\n`);
}

function printBaseline(values) {
  process.stdout.write(`Cross-extension parity preflight\n` +
    `  standalone: ${values.standalone.commit} (${values.standalone.packageJson.name}@${values.standalone.packageJson.version})\n` +
    `  reference:  ${values.reference.commit} (${values.reference.packageJson.name}@${values.reference.packageJson.version})\n` +
    `  q runtime:  ${values.qPath} (${values.qVersionEvidence})\n` +
    `  standalone tracked state: ${dirtyDisclaimer(values.standaloneStatus, 'standalone')}\n` +
    `  reference tracked state: ${values.referenceStatusBefore.entries.length} pre-existing unstaged docs/** modifications; SHA-256 ${values.referenceStatusBefore.hash}\n` +
    `DISCLAIMER: ignored build/dependency/artifact files are not source evidence. Reference generated docs drift is excluded.\n`);
}

function printSummary(evidence) {
  const byStatus = evidence.summary.byStatus;
  process.stdout.write(`\nParity evidence summary\n` +
    `  cases: ${evidence.summary.caseCount}; assertions: ${evidence.summary.assertionCount}\n` +
    `  PASS=${byStatus.PASS} DIFFERENT_BY_DESIGN=${byStatus.DIFFERENT_BY_DESIGN} GAP=${byStatus.GAP} NOT_TESTABLE_HERE=${byStatus.NOT_TESTABLE_HERE}\n` +
    `  deterministic=${evidence.summary.byEvidenceMode.deterministic} live-q=${evidence.summary.byEvidenceMode['live-q']} boundary=${evidence.summary.byEvidenceMode.boundary}\n` +
    `  result: ${evidence.summary.gateResult}; signoffReady=${evidence.summary.signoffReady}\n` +
    `  reference status unchanged: ${evidence.reference.statusHashBefore === evidence.reference.statusHashAfter}\n`);
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
      'Strict parity sign-off requires a clean standalone tracked/untracked worktree. ' +
      'Use the default gate for classified work-in-progress evidence.'
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
