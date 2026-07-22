'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_REFERENCE_ROOT = '/opt/data/home/projects/kdb-sqltools';
const EXPECTED_REFERENCE_COMMIT = 'af2c7c920932274f156e31832859fa262068effe';
const DEFAULT_Q_BINARY = '/opt/data/home/.kx/bin/q';
const REFERENCE_ROOT_ENV = 'KDB_SQLTOOLS_PARITY_ROOT';
const Q_BINARY_ENVS = Object.freeze(['VSCODE_KDB_Q_BIN', 'KDB_Q_BIN']);
const DEFAULT_MAX_BUFFER = 128 * 1024 * 1024;

class CommandError extends Error {
  constructor(message, result) {
    super(message);
    this.name = 'CommandError';
    this.result = result;
  }
}

function runCommand(command, args = [], options = {}) {
  if (typeof command !== 'string' || command.length === 0) {
    throw new TypeError('command must be a non-empty string');
  }
  if (!Array.isArray(args) || args.some(argument => typeof argument !== 'string')) {
    throw new TypeError('command arguments must be strings');
  }

  const cwd = path.resolve(options.cwd || process.cwd());
  const startedAt = Date.now();
  const spawned = childProcess.spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    input: options.input,
    maxBuffer: options.maxBuffer || DEFAULT_MAX_BUFFER,
    shell: false,
    windowsHide: true,
  });

  return Object.freeze({
    command,
    args: args.slice(),
    commandText: formatCommand(command, args),
    cwd,
    durationMs: Date.now() - startedAt,
    status: typeof spawned.status === 'number' ? spawned.status : null,
    signal: spawned.signal || null,
    stdout: spawned.stdout || '',
    stderr: spawned.stderr || '',
    error: spawned.error || null,
  });
}

function runCheckedCommand(command, args = [], options = {}) {
  const result = runCommand(command, args, options);
  if (result.error || result.status !== 0) {
    throw new CommandError(commandFailureMessage(result), result);
  }
  return result;
}

function runGit(repoRoot, args, options = {}) {
  return runCheckedCommand('git', ['-C', path.resolve(repoRoot), ...args], {
    ...options,
    cwd: options.cwd || repoRoot,
    env: {
      GIT_OPTIONAL_LOCKS: '0',
      LC_ALL: 'C',
      ...(options.env || {}),
    },
  });
}

function runNpmScript(repoRoot, script, options = {}) {
  if (typeof script !== 'string' || script.length === 0) {
    throw new TypeError('npm script must be a non-empty string');
  }
  return runCheckedCommand(npmCommand(), ['run', script], {
    ...options,
    cwd: repoRoot,
  });
}

function runCheckedCommandWithStatusGuard(command, args = [], options = {}) {
  const guardRoot = repositoryRoot(options.guardRoot || options.cwd || process.cwd());
  const before = gitStatusSnapshot(guardRoot);
  if (typeof options.validateSnapshot === 'function') {
    options.validateSnapshot(before);
  }

  let result;
  let commandError;
  try {
    result = runCheckedCommand(command, args, options);
  } catch (error) {
    commandError = error;
  }

  const after = gitStatusSnapshot(guardRoot);
  let statusError;
  try {
    assertGitStatusUnchanged(before, after, options.guardLabel || 'guarded repository');
    if (typeof options.validateSnapshot === 'function') {
      options.validateSnapshot(after);
    }
  } catch (error) {
    statusError = error;
  }

  if (statusError) {
    if (commandError) {
      statusError.commandError = commandError;
    }
    throw statusError;
  }
  if (commandError) {
    throw commandError;
  }
  return Object.freeze({ result, before, after });
}

function repositoryRoot(inputRoot) {
  const requested = realDirectory(inputRoot, 'repository');
  const result = runGit(requested, ['rev-parse', '--show-toplevel']);
  const discoveredText = result.stdout.trim();
  if (!discoveredText) {
    throw new Error(`Git did not return a repository root for ${requested}`);
  }
  const discovered = realDirectory(discoveredText, 'Git repository root');
  if (requested !== discovered) {
    throw new Error(`Expected repository root ${requested}, but Git resolved ${discovered}`);
  }
  return discovered;
}

function gitHead(repoRoot) {
  return runGit(repoRoot, ['rev-parse', '--verify', 'HEAD^{commit}']).stdout.trim();
}

function gitStatusSnapshot(repoRoot) {
  const root = repositoryRoot(repoRoot);
  const fullRaw = runGit(root, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  ]).stdout;
  const trackedRaw = runGit(root, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=no',
  ]).stdout;
  const indexRaw = runGit(root, ['ls-files', '--stage', '-z']).stdout;
  const entries = parsePorcelainV1Z(fullRaw);
  const trackedEntries = parsePorcelainV1Z(trackedRaw);

  return Object.freeze({
    root,
    entries: freezeEntries(entries),
    trackedEntries: freezeEntries(trackedEntries),
    statusHash: sha256(fullRaw),
    trackedStatusHash: sha256(trackedRaw),
    hash: snapshotHash(root, fullRaw, indexRaw, entries),
    trackedHash: snapshotHash(root, trackedRaw, indexRaw, trackedEntries),
  });
}

function parsePorcelainV1Z(raw) {
  const fields = String(raw || '').split('\0');
  const entries = [];
  let index = 0;
  while (index < fields.length) {
    const record = fields[index++];
    if (!record) {
      continue;
    }
    if (record.length < 4 || record[2] !== ' ') {
      throw new Error(`Unexpected Git porcelain record: ${JSON.stringify(record)}`);
    }
    const status = record.slice(0, 2);
    const entry = {
      status,
      indexStatus: status[0],
      worktreeStatus: status[1],
      path: record.slice(3),
    };
    if (/[RC]/.test(status)) {
      const originalPath = fields[index++];
      if (!originalPath) {
        throw new Error(`Git porcelain rename/copy record is incomplete for ${entry.path}`);
      }
      entry.originalPath = originalPath;
    }
    entries.push(entry);
  }
  return entries;
}

function assertReferenceDirtyState(snapshot, options = {}) {
  const allowedPrefix = normalizeGitPrefix(options.allowedPrefix || 'docs/');
  const allowedStatuses = new Set(options.allowedStatuses || [' M']);
  const violations = snapshot.entries.filter(entry => {
    if (!allowedStatuses.has(entry.status)) {
      return true;
    }
    if (!gitPathHasPrefix(entry.path, allowedPrefix)) {
      return true;
    }
    return entry.originalPath && !gitPathHasPrefix(entry.originalPath, allowedPrefix);
  });

  if (violations.length > 0) {
    const details = violations.slice(0, 20).map(entry => `${entry.status} ${entry.path}`).join('\n');
    const omitted = violations.length > 20 ? `\n... ${violations.length - 20} more` : '';
    throw new Error(
      `Reference worktree has changes outside the allowed generated docs drift:\n${details}${omitted}`
    );
  }

  return Object.freeze({
    allowedPrefix,
    dirtyCount: snapshot.entries.length,
    dirtyPaths: Object.freeze(snapshot.entries.map(entry => entry.path)),
    disclaimer: snapshot.entries.length === 0
      ? 'Reference worktree is clean.'
      : `Reference worktree has ${snapshot.entries.length} pre-existing modified generated ${allowedPrefix} paths; they are excluded from parity evidence.`,
  });
}

function assertGitStatusUnchanged(before, after, label = 'repository') {
  if (!before || !after || before.root !== after.root) {
    throw new Error(`${label} status snapshots do not refer to the same repository`);
  }
  if (before.hash === after.hash && before.trackedHash === after.trackedHash) {
    return;
  }

  const beforeLines = statusLines(before.entries);
  const afterLines = statusLines(after.entries);
  const error = new Error(
    `${label} worktree/index state changed during a guarded command.\n` +
    `Before (${before.hash}):\n${beforeLines || '(clean)'}\n` +
    `After (${after.hash}):\n${afterLines || '(clean)'}`
  );
  error.before = before;
  error.after = after;
  throw error;
}

function readPackageJson(repoRoot) {
  const root = realDirectory(repoRoot, 'package repository');
  const filename = path.join(root, 'package.json');
  let source;
  try {
    source = fs.readFileSync(filename, 'utf8');
  } catch (error) {
    throw contextualError(`Could not read package.json from ${root}`, error);
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw contextualError(`Invalid package.json in ${root}`, error);
  }
}

function assertPackageIdentity(repoRoot, expectedName, expectedVersion) {
  const packageJson = readPackageJson(repoRoot);
  if (packageJson.name !== expectedName) {
    throw new Error(`Expected package ${expectedName} at ${repoRoot}, found ${String(packageJson.name)}`);
  }
  if (expectedVersion !== undefined && packageJson.version !== expectedVersion) {
    throw new Error(
      `Expected ${expectedName} version ${expectedVersion} at ${repoRoot}, found ${String(packageJson.version)}`
    );
  }
  return packageJson;
}

function checkPackageDependencies(repoRoot, options = {}) {
  return runCheckedCommand(options.npmCommand || npmCommand(), ['ls', '--depth=0', '--json'], {
    ...options,
    cwd: repoRoot,
    env: {
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      ...(options.env || {}),
    },
  });
}

function resolveQExecutable(options = {}) {
  const env = options.env || process.env;
  let candidate = options.qPath;
  let source = options.qPath ? 'qPath option' : undefined;

  if (!candidate) {
    const configured = Q_BINARY_ENVS
      .filter(name => env[name])
      .map(name => ({ name, value: path.resolve(env[name]) }));
    const distinct = Array.from(new Set(configured.map(item => item.value)));
    if (distinct.length > 1) {
      throw new Error(
        `Conflicting q executable overrides: ${configured.map(item => `${item.name}=${item.value}`).join(', ')}`
      );
    }
    if (configured.length > 0) {
      candidate = configured[0].value;
      source = configured.map(item => item.name).join('/');
    }
  }

  candidate = path.resolve(candidate || options.defaultQPath || DEFAULT_Q_BINARY);
  source = source || 'default';
  let real;
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    real = fs.realpathSync(candidate);
  } catch (error) {
    throw contextualError(`Required q runtime is unavailable or not executable at ${candidate}`, error);
  }
  if (!fs.statSync(real).isFile()) {
    throw new Error(`Required q runtime is not a file: ${real}`);
  }
  return Object.freeze({ path: real, configuredPath: candidate, source });
}

function preflightParityEnvironment(options = {}) {
  const env = options.env || process.env;
  const standaloneRoot = repositoryRoot(
    options.standaloneRoot || path.resolve(__dirname, '../..')
  );
  const referenceRoot = repositoryRoot(
    options.referenceRoot || env[REFERENCE_ROOT_ENV] || DEFAULT_REFERENCE_ROOT
  );

  const standalonePackage = assertPackageIdentity(
    standaloneRoot,
    options.standalonePackageName || 'vscode-kdb',
    options.standaloneVersion
  );
  const referencePackage = assertPackageIdentity(
    referenceRoot,
    options.referencePackageName || 'kdb-sqltools',
    options.referenceVersion
  );
  const standaloneHead = gitHead(standaloneRoot);
  const referenceHead = gitHead(referenceRoot);
  const expectedReferenceCommit = options.expectedReferenceCommit || EXPECTED_REFERENCE_COMMIT;
  if (referenceHead !== expectedReferenceCommit) {
    throw new Error(
      `Reference revision mismatch at ${referenceRoot}: expected ${expectedReferenceCommit}, found ${referenceHead}`
    );
  }

  const standaloneStatus = gitStatusSnapshot(standaloneRoot);
  const referenceStatus = gitStatusSnapshot(referenceRoot);
  const referenceDirty = assertReferenceDirtyState(referenceStatus, options.referenceDirtyOptions);
  const q = resolveQExecutable({
    env,
    qPath: options.qPath,
    defaultQPath: options.defaultQPath,
  });

  let standaloneDependencies;
  let referenceDependencies;
  if (options.checkDependencies !== false) {
    standaloneDependencies = checkPackageDependencies(standaloneRoot, { env });
    referenceDependencies = checkPackageDependencies(referenceRoot, { env });
  }

  return Object.freeze({
    standalone: Object.freeze({
      root: standaloneRoot,
      head: standaloneHead,
      packageJson: standalonePackage,
      status: standaloneStatus,
      dependencyCheck: standaloneDependencies,
    }),
    reference: Object.freeze({
      root: referenceRoot,
      head: referenceHead,
      expectedHead: expectedReferenceCommit,
      packageJson: referencePackage,
      status: referenceStatus,
      dirty: referenceDirty,
      dependencyCheck: referenceDependencies,
    }),
    q,
  });
}

function snapshotHash(repoRoot, porcelain, indexState, entries) {
  const hash = crypto.createHash('sha256');
  hash.update('porcelain\0');
  hash.update(porcelain);
  hash.update('\0index\0');
  hash.update(indexState);

  const paths = new Set();
  for (const entry of entries) {
    paths.add(entry.path);
    if (entry.originalPath) {
      paths.add(entry.originalPath);
    }
  }
  for (const gitPath of Array.from(paths).sort()) {
    updatePathStateHash(hash, repoRoot, gitPath);
  }
  return hash.digest('hex');
}

function updatePathStateHash(hash, repoRoot, gitPath) {
  const filename = path.resolve(repoRoot, gitPath);
  const relative = path.relative(repoRoot, filename);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Git status path escapes repository root: ${gitPath}`);
  }

  hash.update('\0path\0');
  hash.update(gitPath);
  let stat;
  try {
    stat = fs.lstatSync(filename);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      hash.update('\0missing');
      return;
    }
    throw error;
  }

  hash.update(`\0mode:${stat.mode}\0size:${stat.size}`);
  if (stat.isSymbolicLink()) {
    hash.update('\0symlink\0');
    hash.update(fs.readlinkSync(filename));
  } else if (stat.isFile()) {
    hash.update('\0file\0');
    hash.update(fs.readFileSync(filename));
  } else if (stat.isDirectory()) {
    hash.update('\0directory');
  } else {
    hash.update('\0special');
  }
}

function freezeEntries(entries) {
  return Object.freeze(entries.map(entry => Object.freeze({ ...entry })));
}

function statusLines(entries) {
  return entries.map(entry => {
    const rename = entry.originalPath ? ` <- ${entry.originalPath}` : '';
    return `${entry.status} ${entry.path}${rename}`;
  }).join('\n');
}

function normalizeGitPrefix(prefix) {
  const normalized = String(prefix).replace(/\\/g, '/').replace(/^\.\//, '');
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function gitPathHasPrefix(gitPath, prefix) {
  const normalized = String(gitPath).replace(/\\/g, '/');
  const directory = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  return normalized === directory || normalized.startsWith(prefix);
}

function formatCommand(command, args = []) {
  return [command, ...args].map(shellQuote).join(' ');
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text)) {
    return text;
  }
  return `'${text.replace(/'/g, `'"'"'`)}'`;
}

function commandFailureMessage(result) {
  const reason = result.error
    ? result.error.message
    : result.signal
      ? `terminated by ${result.signal}`
      : `exited with status ${String(result.status)}`;
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
  const detail = output ? `\n${truncate(output, 12000)}` : '';
  return `Command failed (${reason}): ${result.commandText}\nWorking directory: ${result.cwd}${detail}`;
}

function truncate(value, maxLength) {
  const text = String(value);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}\n... ${text.length - maxLength} characters omitted`;
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function realDirectory(directory, label) {
  const requested = path.resolve(directory);
  let real;
  try {
    real = fs.realpathSync(requested);
  } catch (error) {
    throw contextualError(`${label} is missing: ${requested}`, error);
  }
  if (!fs.statSync(real).isDirectory()) {
    throw new Error(`${label} is not a directory: ${real}`);
  }
  return real;
}

function contextualError(message, cause) {
  const detail = cause && cause.message ? `: ${cause.message}` : '';
  const error = new Error(`${message}${detail}`);
  error.cause = cause;
  return error;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

module.exports = {
  CommandError,
  DEFAULT_Q_BINARY,
  DEFAULT_REFERENCE_ROOT,
  EXPECTED_REFERENCE_COMMIT,
  Q_BINARY_ENVS,
  REFERENCE_ROOT_ENV,
  assertGitStatusUnchanged,
  assertPackageIdentity,
  assertReferenceDirtyState,
  checkPackageDependencies,
  formatCommand,
  gitHead,
  gitStatusSnapshot,
  parsePorcelainV1Z,
  preflightParityEnvironment,
  readPackageJson,
  repositoryRoot,
  resolveQExecutable,
  runCheckedCommand,
  runCheckedCommandWithStatusGuard,
  runCommand,
  runGit,
  runNpmScript,
};
