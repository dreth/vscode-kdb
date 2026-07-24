'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const E2E_ROOT = path.join(REPOSITORY_ROOT, '.vscode-test', 'e2e');
const USER_DATA_DIR = path.join(E2E_ROOT, 'user-data');
const EXTENSIONS_DIR = path.join(E2E_ROOT, 'extensions');
const EXTENSION_TESTS_PATH = path.join(REPOSITORY_ROOT, 'test', 'extension-host', 'index.js');
const SIBLING_TEST_ROOT = path.resolve(
  REPOSITORY_ROOT,
  '..',
  'kdb-sqltools',
  '.vscode-test'
);
const DEFAULT_VSCODE_PATH =
  path.join(SIBLING_TEST_ROOT, 'vscode-linux-x64-1.130.0', 'code');
const DEFAULT_LIBRARY_PATH =
  path.join(SIBLING_TEST_ROOT, 'apt-libs', 'root', 'usr', 'lib', 'x86_64-linux-gnu');
const VSCODE_PATH = process.env.VSCODE_KDB_E2E_CODE || firstExistingFile([
  DEFAULT_VSCODE_PATH,
  '/usr/bin/code',
  '/usr/local/bin/code',
]);
const VSCODE_LIBRARY_PATH = process.env.VSCODE_KDB_E2E_LIBS ||
  (VSCODE_PATH === DEFAULT_VSCODE_PATH &&
    fs.statSync(DEFAULT_LIBRARY_PATH, { throwIfNoEntry: false })?.isDirectory()
    ? DEFAULT_LIBRARY_PATH
    : undefined);
const TEST_TIMEOUT_MS = 90_000;

let xvfbProcess;
let vscodeProcess;

function firstExistingFile(candidates) {
  return candidates.find(candidate =>
    fs.statSync(candidate, { throwIfNoEntry: false })?.isFile());
}

function assertFile(target, label) {
  if (!target || !fs.statSync(target, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(
      `${label} was not found. Set VSCODE_KDB_E2E_CODE to a compatible VS Code executable.`
    );
  }
}

function resetE2eRoot() {
  cleanE2eRoot();
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });
}

function cleanE2eRoot() {
  const expected = path.join(REPOSITORY_ROOT, '.vscode-test', 'e2e');
  if (E2E_ROOT !== expected || !E2E_ROOT.startsWith(`${REPOSITORY_ROOT}${path.sep}`)) {
    throw new Error(`Refusing to clean unexpected Extension Host test path: ${E2E_ROOT}`);
  }
  fs.rmSync(E2E_ROOT, { recursive: true, force: true });
}

function stopProcess(child) {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
  }
}

function startXvfb() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      '/usr/bin/Xvfb',
      ['-displayfd', '3', '-screen', '0', '1280x800x24', '-nolisten', 'tcp'],
      { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] }
    );
    xvfbProcess = child;
    let displayOutput = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        stopProcess(child);
        reject(new Error(`Xvfb did not report a display within 10 seconds. ${stderr.trim()}`));
      }
    }, 10_000);

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.stdio[3].setEncoding('utf8');
    child.stdio[3].on('data', chunk => {
      displayOutput += chunk;
      const newline = displayOutput.indexOf('\n');
      if (newline < 0 || settled) {
        return;
      }
      const displayNumber = displayOutput.slice(0, newline).trim();
      if (!/^\d+$/.test(displayNumber)) {
        settled = true;
        clearTimeout(timeout);
        stopProcess(child);
        reject(new Error(`Xvfb returned an invalid display number: ${displayNumber}`));
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({ child, display: `:${displayNumber}` });
    });
    child.once('error', error => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
    child.once('exit', (code, signal) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(
          `Xvfb exited before startup (code ${String(code)}, signal ${String(signal)}). ` +
          stderr.trim()
        ));
      }
    });
  });
}

function runVsCode(display) {
  const existingLibraryPath = process.env.LD_LIBRARY_PATH;
  const libraryPath = [VSCODE_LIBRARY_PATH, existingLibraryPath].filter(Boolean).join(':');
  const args = [
    '--no-sandbox',
    '--disable-gpu',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-workspace-trust',
    `--user-data-dir=${USER_DATA_DIR}`,
    `--extensions-dir=${EXTENSIONS_DIR}`,
    `--extensionDevelopmentPath=${REPOSITORY_ROOT}`,
    `--extensionTestsPath=${EXTENSION_TESTS_PATH}`,
    REPOSITORY_ROOT,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(VSCODE_PATH, args, {
      cwd: REPOSITORY_ROOT,
      env: {
        ...process.env,
        DISPLAY: display,
        ...(libraryPath ? { LD_LIBRARY_PATH: libraryPath } : {}),
      },
      stdio: 'inherit',
    });
    vscodeProcess = child;
    let timedOut = false;
    let forceKillTimer;
    const timeout = setTimeout(() => {
      timedOut = true;
      stopProcess(child);
      forceKillTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
      }, 5_000);
    }, TEST_TIMEOUT_MS);

    child.once('error', error => {
      clearTimeout(timeout);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      vscodeProcess = undefined;
      if (timedOut) {
        reject(new Error(`VS Code Extension Host test timed out after ${TEST_TIMEOUT_MS} ms.`));
      } else if (code !== 0) {
        reject(new Error(
          `VS Code Extension Host test failed (code ${String(code)}, signal ${String(signal)}).`
        ));
      } else {
        resolve();
      }
    });
  });
}

async function main() {
  assertFile(VSCODE_PATH, 'VS Code runtime');
  assertFile('/usr/bin/Xvfb', 'Xvfb');
  assertFile(EXTENSION_TESTS_PATH, 'Extension Host test module');
  if (VSCODE_LIBRARY_PATH &&
      !fs.statSync(VSCODE_LIBRARY_PATH, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`VS Code runtime libraries were not found at ${VSCODE_LIBRARY_PATH}.`);
  }

  resetE2eRoot();
  console.log(`Extension Host runtime: ${VSCODE_PATH}`);
  const { display } = await startXvfb();
  console.log(`Extension Host display: ${display}`);
  await runVsCode(display);
  console.log('Extension Host smoke test passed.');
}

function cleanup() {
  stopProcess(vscodeProcess);
  stopProcess(xvfbProcess);
  cleanE2eRoot();
}

process.once('SIGINT', () => {
  cleanup();
  process.exitCode = 130;
});
process.once('SIGTERM', () => {
  cleanup();
  process.exitCode = 143;
});

main()
  .catch(error => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  })
  .finally(cleanup);
