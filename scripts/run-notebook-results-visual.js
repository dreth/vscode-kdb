'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const VSCODE_TEST_ROOT = path.join(REPOSITORY_ROOT, '.vscode-test');
// Keep this deliberately short: VS Code's Unix IPC socket path is limited to
// roughly 107 bytes on Linux, and the repository path is already long.
const E2E_ROOT = path.join(VSCODE_TEST_ROOT, 'vis');
const USER_DATA_DIR = path.join(E2E_ROOT, 'user-data');
const EXTENSIONS_DIR = path.join(E2E_ROOT, 'extensions');
const ARTIFACT_DIRECTORY = path.join(
  VSCODE_TEST_ROOT,
  'artifacts',
  'notebook-results-parity'
);
const PHASE_ONE_ARTIFACT = path.join(
  ARTIFACT_DIRECTORY,
  'visual-phase-1.json'
);
const PHASE_TWO_ARTIFACT = path.join(
  ARTIFACT_DIRECTORY,
  'visual-phase-2.json'
);
const RESTART_MARKER = path.join(
  ARTIFACT_DIRECTORY,
  'visual-restart-marker.json'
);
const PROCESS_RESTART_ARTIFACT = path.join(
  ARTIFACT_DIRECTORY,
  'visual-process-restart.json'
);
const PHASE_ONE_HEADERS = Object.freeze([
  'phase_one_zero',
  'phase_one_payload',
  'phase_one_later',
  'phase_one_tail',
]);
const RENAMED_HEADERS = Object.freeze([
  'renamed_zero',
  'different_payload',
  'renamed_later',
  'extra_schema',
]);
const RELOADED_HEADERS = Object.freeze([
  'restarted_zero',
  'restart_payload',
  'restarted_later',
  'restart_tail',
]);
const EXTENSION_TESTS_PATH = path.join(
  REPOSITORY_ROOT,
  'test',
  'extension-host',
  'notebook-results-visual.js'
);
const Q_FIXTURE = path.join(REPOSITORY_ROOT, 'test', 'live', 'fixture.q');
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
const DEFAULT_Q_PATH = '/opt/data/home/.kx/bin/q';
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
const Q_PATH = process.env.VSCODE_KDB_Q_BIN || DEFAULT_Q_PATH;
const SCREEN_WIDTH = 1440;
const SCREEN_HEIGHT = 1000;
const SCREEN_SIZE = `${SCREEN_WIDTH}x${SCREEN_HEIGHT}`;
const TEST_TIMEOUT_MS = 240_000;

let xvfbProcess;
let qProcess;
let vscodeProcess;

function firstExistingFile(candidates) {
  return candidates.find(candidate =>
    fs.statSync(candidate, { throwIfNoEntry: false })?.isFile());
}

function assertFile(target, label) {
  if (!target || !fs.statSync(target, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`${label} was not found: ${String(target || '(unset)')}`);
  }
}

function resetOwnedDirectories() {
  cleanOwnedDirectory(E2E_ROOT, 'vis');
  cleanOwnedDirectory(ARTIFACT_DIRECTORY, 'artifacts/notebook-results-parity');
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });
  fs.mkdirSync(ARTIFACT_DIRECTORY, { recursive: true });
}

function cleanOwnedDirectory(target, expectedSuffix) {
  const expectedPrefix = `${VSCODE_TEST_ROOT}${path.sep}`;
  if (!target.startsWith(expectedPrefix) ||
      !target.endsWith(expectedSuffix.split('/').join(path.sep))) {
    throw new Error(`Refusing to clean unexpected visual test path: ${target}`);
  }
  fs.rmSync(target, { recursive: true, force: true });
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
      ['-displayfd', '3', '-screen', '0', `${SCREEN_SIZE}x24`, '-nolisten', 'tcp'],
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
      resolve(`:${displayNumber}`);
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

function startQ(port) {
  const child = spawn(Q_PATH, [Q_FIXTURE, '-p', `127.0.0.1:${port}`], {
    cwd: REPOSITORY_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  qProcess = child;
  const state = {
    child,
    stdout: '',
    stderr: '',
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    state.stdout = boundedLog(`${state.stdout}${chunk}`);
  });
  child.stderr.on('data', chunk => {
    state.stderr = boundedLog(`${state.stderr}${chunk}`);
  });
  return state;
}

function boundedLog(value) {
  return value.length <= 16_384 ? value : value.slice(-16_384);
}

async function runVsCode(display, qPort, cdpPort, phase) {
  if (![1, 2].includes(phase)) {
    throw new Error(`Invalid notebook visual restart phase: ${String(phase)}`);
  }
  const existingLibraryPath = process.env.LD_LIBRARY_PATH;
  const libraryPath = [VSCODE_LIBRARY_PATH, existingLibraryPath].filter(Boolean).join(':');
  const args = [
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-workspace-trust',
    `--remote-debugging-port=${cdpPort}`,
    '--remote-debugging-address=127.0.0.1',
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
        VSCODE_KDB_EXTENSION_HOST_TEST: '1',
        VSCODE_KDB_VISUAL_ARTIFACT_DIR: ARTIFACT_DIRECTORY,
        VSCODE_KDB_VISUAL_Q_PORT: String(qPort),
        VSCODE_KDB_VISUAL_CDP_PORT: String(cdpPort),
        VSCODE_KDB_VISUAL_SCREEN_SIZE: SCREEN_SIZE,
        VSCODE_KDB_VISUAL_PHASE: String(phase),
        VSCODE_KDB_VISUAL_USER_DATA_DIR: USER_DATA_DIR,
        VSCODE_KDB_VISUAL_EXTENSIONS_DIR: EXTENSIONS_DIR,
        ...(libraryPath ? { LD_LIBRARY_PATH: libraryPath } : {}),
      },
      stdio: 'inherit',
    });
    vscodeProcess = child;
    const childPid = child.pid;
    let settled = false;
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
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      vscodeProcess = undefined;
      reject(error);
    });
    child.once('exit', (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      vscodeProcess = undefined;
      if (timedOut) {
        reject(new Error(
          `VS Code notebook visual phase ${phase} timed out after ${TEST_TIMEOUT_MS} ms.`
        ));
      } else {
        resolve({
          phase,
          childPid,
          exitCode: code,
          signal,
          profilePath: USER_DATA_DIR,
          extensionsPath: EXTENSIONS_DIR,
          cdpPort,
        });
      }
    });
  });
}

function readJsonFile(target, label) {
  const stat = fs.statSync(target, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size === 0) {
    throw new Error(`${label} was not created: ${target}`);
  }
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON: ` +
      `${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function writeJsonAtomic(target, value) {
  if (path.dirname(target) !== ARTIFACT_DIRECTORY) {
    throw new Error(`Refusing to write unexpected visual artifact path: ${target}`);
  }
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, target);
}

function validateRestartMarker(marker) {
  if (!marker || marker.version !== 1 ||
      marker.phaseOneComplete !== true ||
      marker.reloadCommand !== 'workbench.action.reloadWindow' ||
      marker.reloadCommandIssued !== true ||
      marker.profilePath !== USER_DATA_DIR ||
      !Number.isSafeInteger(marker.extensionHostPid) ||
      marker.extensionHostPid <= 0) {
    throw new Error(
      `Notebook visual restart marker is invalid: ${JSON.stringify(marker)}`
    );
  }
  validatePositionalWidths(
    marker.widthsByPosition,
    'notebook visual restart marker widths'
  );
  if (marker.reloadPromiseCancellation &&
      (marker.reloadPromiseCancellation.name !== 'Canceled' ||
        marker.reloadPromiseCancellation.message !== 'Canceled')) {
    throw new Error(
      'Notebook visual restart marker has an unexpected reload cancellation: ' +
      JSON.stringify(marker.reloadPromiseCancellation)
    );
  }
}

function validatePositionalWidths(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a sparse positional map.`);
  }
  const keys = Object.keys(value).sort((left, right) => Number(left) - Number(right));
  if (JSON.stringify(keys) !== JSON.stringify(['0', '2'])) {
    throw new Error(`${label} must contain exactly source positions 0 and 2.`);
  }
  const widths = {
    0: Number(value['0']),
    2: Number(value['2']),
  };
  for (const position of [0, 2]) {
    if (!Number.isFinite(widths[position]) ||
        widths[position] < 80 ||
        widths[position] > 2_000) {
      throw new Error(
        `${label} position ${position} is not a valid persisted width: ` +
        String(widths[position])
      );
    }
  }
  if (widths[0] === widths[2]) {
    throw new Error(`${label} must contain distinct first/later widths.`);
  }
  return widths;
}

function assertSamePositionalWidths(actualValue, expectedValue, label) {
  const actual = validatePositionalWidths(actualValue, `${label} actual widths`);
  const expected = validatePositionalWidths(expectedValue, `${label} expected widths`);
  for (const position of [0, 2]) {
    if (Math.abs(actual[position] - expected[position]) > 0.01) {
      throw new Error(
        `${label} position ${position} mismatch: ` +
        `${actual[position]} !== ${expected[position]}`
      );
    }
  }
  return actual;
}

function validateRenderedSnapshot(snapshot, expectedWidths, label) {
  if (!snapshot || !Array.isArray(snapshot.headers) ||
      snapshot.headers.length < 3 ||
      !Array.isArray(snapshot.widths) ||
      snapshot.widths.length !== snapshot.headers.length ||
      !Array.isArray(snapshot.renderedRows) ||
      snapshot.renderedRows.length < 1 ||
      snapshot.renderedRows.some(row => !Number.isSafeInteger(row) || row < 0) ||
      !snapshot.renderedColumnWidths ||
      typeof snapshot.renderedColumnWidths !== 'object' ||
      Array.isArray(snapshot.renderedColumnWidths)) {
    throw new Error(`${label} lacks complete rendered grid state.`);
  }
  for (const position of [0, 2]) {
    const headerWidth = Number(snapshot.widths[position]);
    const bodyWidths = snapshot.renderedColumnWidths[String(position)];
    if (!Number.isFinite(headerWidth) ||
        Math.abs(headerWidth - expectedWidths[position]) > 2 ||
        !Array.isArray(bodyWidths) ||
        bodyWidths.length < 1 ||
        bodyWidths.some(width =>
          !Number.isFinite(width) ||
          Math.abs(width - expectedWidths[position]) > 2)) {
      throw new Error(
        `${label} does not apply ${expectedWidths[position]}px to every ` +
        `rendered header/body cell at source position ${position}.`
      );
    }
  }
}

function validateVirtualViewportChange(before, after, label) {
  if (JSON.stringify(before?.renderedRows) === JSON.stringify(after?.renderedRows)) {
    throw new Error(`${label} did not render a different virtual row viewport.`);
  }
}

function validateHeaders(snapshot, expectedHeaders, label) {
  if (JSON.stringify(snapshot?.headers) !== JSON.stringify(expectedHeaders)) {
    throw new Error(
      `${label} headers mismatch: ${JSON.stringify(snapshot?.headers)}`
    );
  }
}

function validatePhaseOneSurface(surface, widths, label) {
  const draggedPositions = Array.isArray(surface?.draggedPositions)
    ? [...surface.draggedPositions].sort((left, right) => left - right)
    : [];
  if (JSON.stringify(draggedPositions) !== JSON.stringify([0, 2])) {
    throw new Error(`${label} must record real drags at source positions 0 and 2.`);
  }
  validateRenderedSnapshot(surface.afterDrag, widths, `${label} after drag`);
  validateHeaders(surface.afterDrag, PHASE_ONE_HEADERS, `${label} after drag`);
  validateRenderedSnapshot(
    surface.afterVirtualScroll,
    widths,
    `${label} after virtual scroll`
  );
  validateHeaders(
    surface.afterVirtualScroll,
    PHASE_ONE_HEADERS,
    `${label} after virtual scroll`
  );
  validateVirtualViewportChange(
    surface.afterDrag,
    surface.afterVirtualScroll,
    label
  );
  validateRenderedSnapshot(
    surface.recreated,
    widths,
    `${label} renamed-schema recreation`
  );
  validateHeaders(
    surface.recreated,
    RENAMED_HEADERS,
    `${label} renamed-schema recreation`
  );
  if (JSON.stringify(surface.afterDrag.headers) ===
      JSON.stringify(surface.recreated.headers)) {
    throw new Error(`${label} recreation did not use renamed/different-schema columns.`);
  }
}

function validatePhaseOneRestartEvidence(phase, expectedWidthsValue) {
  if (!phase || phase.version !== 1 ||
      phase.complete !== true ||
      phase.reloadCommand !== 'workbench.action.reloadWindow' ||
      phase.reloadCommandIssued !== true ||
      phase.profilePath !== USER_DATA_DIR ||
      !Number.isSafeInteger(phase.extensionHostPid) ||
      phase.extensionHostPid <= 0) {
    throw new Error(
      `Notebook visual phase-1 evidence is invalid: ${JSON.stringify(phase)}`
    );
  }
  const widths = assertSamePositionalWidths(
    phase.widthsByPosition,
    expectedWidthsValue,
    'notebook visual phase 1'
  );
  validatePhaseOneSurface(
    phase.surfaces?.ordinary,
    widths,
    'ordinary KX Results phase 1'
  );
  validatePhaseOneSurface(
    phase.surfaces?.notebook,
    widths,
    'notebook renderer phase 1'
  );
  return widths;
}

function validatePhaseTwoSurface(surface, widths, label) {
  validateRenderedSnapshot(surface?.reopened, widths, `${label} reopened`);
  validateHeaders(surface?.reopened, RELOADED_HEADERS, `${label} reopened`);
  validateRenderedSnapshot(
    surface?.afterVirtualScroll,
    widths,
    `${label} after virtual scroll`
  );
  validateHeaders(
    surface?.afterVirtualScroll,
    RELOADED_HEADERS,
    `${label} after virtual scroll`
  );
  validateVirtualViewportChange(surface?.reopened, surface?.afterVirtualScroll, label);
}

function validateAllRenderedColumns(snapshot, expectedWidth, label) {
  if (!snapshot || !Array.isArray(snapshot.headers) ||
      snapshot.headers.length < 3 ||
      !Array.isArray(snapshot.widths) ||
      snapshot.widths.length !== snapshot.headers.length ||
      !snapshot.renderedColumnWidths ||
      typeof snapshot.renderedColumnWidths !== 'object') {
    throw new Error(`${label} lacks complete all-column state.`);
  }
  snapshot.headers.forEach((_header, position) => {
    const headerWidth = Number(snapshot.widths[position]);
    const bodyWidths = snapshot.renderedColumnWidths[String(position)];
    if (!Number.isFinite(headerWidth) ||
        Math.abs(headerWidth - expectedWidth) > 1 ||
        !Array.isArray(bodyWidths) ||
        bodyWidths.length < 1 ||
        bodyWidths.some(width =>
          !Number.isFinite(width) ||
          Math.abs(width - expectedWidth) > 1)) {
      throw new Error(
        `${label} does not apply ${expectedWidth}px to every rendered cell ` +
        `in source position ${position}.`
      );
    }
  });
}

function validatePostRestartSizingControls(controls, widths) {
  const reset = controls?.reset;
  validateRenderedSnapshot(
    reset?.before,
    widths,
    'post-restart Reset columns baseline'
  );
  validateAllRenderedColumns(
    reset?.after,
    160,
    'post-restart Reset columns result'
  );
  if (!reset.persistedAfter ||
      Object.keys(reset.persistedAfter).length !== 0) {
    throw new Error('Reset columns did not record a cleared sparse width map.');
  }

  const density = controls?.densityPreset;
  validateRenderedSnapshot(
    density?.before,
    widths,
    'post-restart density preset baseline'
  );
  validateAllRenderedColumns(
    density?.after,
    180,
    'post-restart density preset result'
  );
  if (density.after.density !== 'comfortable' ||
      !density.persistedAfter ||
      Object.keys(density.persistedAfter).length !== 0) {
    throw new Error(
      'Comfortable density did not clear positional widths for every column.'
    );
  }
}

function validatePhaseTwoRestartEvidence(phase, expectedWidthsValue) {
  if (!phase || phase.version !== 1 ||
      phase.complete !== true ||
      phase.profilePath !== USER_DATA_DIR ||
      !Number.isSafeInteger(phase.extensionHostPid) ||
      phase.extensionHostPid <= 0 ||
      phase.settingsRestored !== true ||
      phase.profileFixturesRestored !== true) {
    throw new Error(
      `Notebook visual phase-2 evidence is invalid: ${JSON.stringify(phase)}`
    );
  }
  const widths = assertSamePositionalWidths(
    phase.persistedBeforeOpen,
    expectedWidthsValue,
    'notebook visual phase 2 persisted-before-open'
  );
  validatePhaseTwoSurface(
    phase.surfaces?.ordinary,
    widths,
    'ordinary KX Results phase 2'
  );
  validatePhaseTwoSurface(
    phase.surfaces?.notebook,
    widths,
    'notebook renderer phase 2'
  );
  validatePostRestartSizingControls(phase.controls, widths);
  return widths;
}

function validateProcessRestartEvidence(processRestart, phaseOne, phaseTwo) {
  const first = processRestart?.phaseOne;
  const second = processRestart?.phaseTwo;
  if (!processRestart || processRestart.version !== 1 ||
      first?.phase !== 1 ||
      first?.exitCode !== 1 ||
      first?.signal !== null ||
      second?.phase !== 2 ||
      second?.exitCode !== 0 ||
      second?.signal !== null ||
      !Number.isSafeInteger(first?.childPid) ||
      first.childPid <= 0 ||
      !Number.isSafeInteger(second?.childPid) ||
      second.childPid <= 0 ||
      first.childPid === second.childPid ||
      first.profilePath !== USER_DATA_DIR ||
      second.profilePath !== USER_DATA_DIR ||
      first.extensionsPath !== EXTENSIONS_DIR ||
      second.extensionsPath !== EXTENSIONS_DIR ||
      !Number.isSafeInteger(first.cdpPort) ||
      first.cdpPort <= 0 ||
      first.cdpPort !== second.cdpPort ||
      processRestart.reload?.command !== 'workbench.action.reloadWindow' ||
      processRestart.reload?.phaseOneComplete !== true ||
      processRestart.reload?.commandIssued !== true ||
      processRestart.reload?.markerValidated !== true ||
      processRestart.reload?.markerExtensionHostPid !== phaseOne.extensionHostPid ||
      processRestart.restartMarkerRemovedAfterPhaseTwo !== true ||
      processRestart.distinctChildPids !== true ||
      processRestart.sameUserDataDir !== true ||
      processRestart.sameExtensionsDir !== true ||
      processRestart.sameCdpPort !== true) {
    throw new Error(
      `Notebook visual process-restart evidence is invalid: ` +
      JSON.stringify(processRestart)
    );
  }
  if (phaseOne.extensionHostPid === phaseTwo.extensionHostPid) {
    throw new Error(
      'Notebook visual phase 2 reused the phase-1 Extension Host process.'
    );
  }
}

function validateFinalRestartAcceptance(report, phaseOne, phaseTwo) {
  const acceptance = report.restartAcceptance;
  if (!acceptance || acceptance.version !== 1) {
    throw new Error('Visual report is missing versioned restart acceptance evidence.');
  }
  const embeddedOneWidths = validatePhaseOneRestartEvidence(
    acceptance.phaseOne,
    phaseOne.widthsByPosition
  );
  validatePhaseTwoRestartEvidence(
    acceptance.phaseTwo,
    embeddedOneWidths
  );
  if (acceptance.phaseOne.extensionHostPid !== phaseOne.extensionHostPid ||
      acceptance.phaseTwo.extensionHostPid !== phaseTwo.extensionHostPid ||
      acceptance.phaseOne.profilePath !== phaseOne.profilePath ||
      acceptance.phaseTwo.profilePath !== phaseTwo.profilePath) {
    throw new Error(
      'Visual report restart evidence does not identify the retained phase artifacts.'
    );
  }
  if (JSON.stringify(acceptance.phaseOne) !== JSON.stringify(phaseOne) ||
      JSON.stringify(acceptance.phaseTwo) !== JSON.stringify(phaseTwo)) {
    throw new Error(
      'Visual report restart evidence differs from the retained phase artifacts.'
    );
  }
}

function validateArtifacts() {
  const required = [
    'light-table.png',
    'light-live-selection-search.png',
    'light-columns-overlay.png',
    'light-settings-overlay.png',
    'light-chart.png',
    'light-chart-zoom-settings.png',
    'light-chart-interactions.png',
    'dark-table.png',
    'dark-chart.png',
    'dark-qtext-opt-in.png',
    'narrow-table.png',
    'narrow-chart-overlay.png',
    'visual-report.json',
  ];
  const restartRequired = [
    'visual-phase-1.json',
    'visual-phase-2.json',
    'visual-process-restart.json',
  ];
  for (const name of [...required, ...restartRequired]) {
    const target = path.join(ARTIFACT_DIRECTORY, name);
    const stat = fs.statSync(target, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.size === 0) {
      throw new Error(`Visual acceptance artifact was not created: ${target}`);
    }
  }
  const report = JSON.parse(
    fs.readFileSync(path.join(ARTIFACT_DIRECTORY, 'visual-report.json'), 'utf8')
  );
  const phaseOne = readJsonFile(
    PHASE_ONE_ARTIFACT,
    'notebook visual phase-1 artifact'
  );
  const phaseTwo = readJsonFile(
    PHASE_TWO_ARTIFACT,
    'notebook visual phase-2 artifact'
  );
  const processRestart = readJsonFile(
    PROCESS_RESTART_ARTIFACT,
    'notebook visual process-restart artifact'
  );
  const phaseOneWidths = validatePhaseOneRestartEvidence(
    phaseOne,
    phaseOne?.widthsByPosition
  );
  validatePhaseTwoRestartEvidence(phaseTwo, phaseOneWidths);
  validateProcessRestartEvidence(processRestart, phaseOne, phaseTwo);
  validateFinalRestartAcceptance(report, phaseOne, phaseTwo);
  if (!Array.isArray(report.screenshots) || report.screenshots.length !== 12 ||
      report.screenshots.some(item =>
        !Number.isFinite(item.outputEntropy) || item.outputEntropy < 0.01)) {
    throw new Error('Visual acceptance report does not contain twelve rendered screenshots.');
  }
  const reportedScreenshots = new Set(report.screenshots.map(item => path.basename(item.file)));
  if (required.slice(0, -1).some(name => !reportedScreenshots.has(name))) {
    throw new Error('Visual acceptance report is missing a required screenshot record.');
  }
  const expectedInteractions = [
    'ordinary-real-runtime-column-sizing',
    'ordinary-real-two-drag-chart-lifecycle',
    'notebook-real-runtime-column-sizing',
    'live-range-selection-search',
    'live-columns-overlay',
    'shared-settings-overlay',
    'live-chart-controls-persistence',
    'light-chart-legend-visible',
    'saved-range-search-chart',
    'dark-chart-accessibility',
    'saved-all-null-chart-guards',
    'saved-chart-families',
    'saved-qtext-copy-status-a11y',
    'saved-preview-save-close-reopen',
    'narrow-live-saved-layout',
    'narrow-saved-chart-overlay',
  ];
  if (!Array.isArray(report.interactions) ||
      expectedInteractions.some(name =>
        !report.interactions.some(interaction => interaction.name === name))) {
    throw new Error('Visual acceptance report is missing interaction evidence.');
  }
  const interaction = name =>
    report.interactions.find(candidate => candidate.name === name);
  const screenshot = name =>
    report.screenshots.find(candidate => path.basename(candidate.file) === name);
  for (const name of [
    'ordinary-real-runtime-column-sizing',
    'notebook-real-runtime-column-sizing',
  ]) {
    const sizing = interaction(name);
    const wholeBefore = sizing.wholeResult?.beforeScroll;
    const wholeAfter = sizing.wholeResult?.afterScroll;
    const visibleNarrow = sizing.visibleRows?.narrow;
    const visibleWide = sizing.visibleRows?.widestRow;
    const manualWidth = sizing.manualFirstColumn?.widths?.[0];
    validateAllRenderedColumns(
      sizing.allColumnPreset,
      190,
      `${name} Cell width preset`
    );
    if (sizing.persistedShape !== 'sparse-map' ||
        wholeBefore?.autoFit !== true ||
        wholeBefore?.autoFitMode !== 'wholeResult' ||
        !(wholeBefore?.widths?.[2] >= 400) ||
        !Number.isFinite(wholeAfter?.widths?.[2]) ||
        Math.abs(wholeAfter?.widths?.[2] - wholeBefore.widths[2]) > 1 ||
        visibleNarrow?.autoFitMode !== 'visibleRows' ||
        !(visibleNarrow?.widths?.[2] + 80 < wholeBefore.widths[2]) ||
        !(visibleWide?.widths?.[2] > visibleNarrow.widths[2] + 80) ||
        sizing.autoFitDisabled?.autoFit !== false ||
        sizing.autoFitDisabled?.widths?.length !== 3 ||
        sizing.autoFitDisabled.widths.some(width => Math.abs(width - 160) > 1) ||
        !Number.isFinite(manualWidth) ||
        !Array.isArray(sizing.manualFirstColumn?.renderedFirstColumnWidths) ||
        sizing.manualFirstColumn.renderedFirstColumnWidths.length < 1 ||
        sizing.manualFirstColumn.renderedFirstColumnWidths.some(width =>
          Math.abs(width - manualWidth) > 1) ||
        !Number.isFinite(sizing.manualAfterVirtualScroll?.widths?.[0]) ||
        Math.abs(sizing.manualAfterVirtualScroll?.widths?.[0] - manualWidth) > 2 ||
        !Number.isFinite(sizing.recreated?.widths?.[0]) ||
        Math.abs(sizing.recreated?.widths?.[0] - manualWidth) > 2 ||
        sizing.allColumnPreset?.widths?.length !== 3 ||
        sizing.allColumnPreset.widths.some(width => Math.abs(width - 190) > 1) ||
        sizing.allColumnPreset?.firstRowWidths?.length !== 3 ||
        sizing.allColumnPreset.firstRowWidths.some(width =>
          Math.abs(width - 190) > 1)) {
      throw new Error(
        `Visual acceptance report has invalid ${name} evidence.`
      );
    }
  }
  validateOrdinaryChartLifecycleEvidence(
    interaction('ordinary-real-two-drag-chart-lifecycle')
  );
  const live = interaction('live-range-selection-search');
  if (live.selectedCells !== 6 || live.summary !== '3 rows × 2 columns (6 cells)' ||
      !/^1\/\d+$/.test(live.firstMatch) ||
      !/^2\/\d+$/.test(live.nextMatch) ||
      !/^1\/\d+$/.test(live.previousMatch) ||
      live.searchFocus?.inputAfterHostResponse !== 'Search result rows' ||
      JSON.stringify(live.searchFocus?.inputSelection) !== '[4,4]' ||
      live.searchFocus?.statusRole !== 'status' ||
      live.searchFocus?.statusAriaLive !== 'polite' ||
      live.searchFocus?.nextAfterRerender !== 'Next' ||
      live.searchFocus?.previousAfterRerender !== 'Prev') {
    throw new Error('Visual acceptance report has invalid live selection/search evidence.');
  }
  const columns = interaction('live-columns-overlay');
  if (columns.summary !== 'Columns (3/4)' || columns.columnCount !== '3' ||
      columns.open !== true || columns.focusedControl !== 'Move row right' ||
      columns.firstVisibleHeader !== 'sym' ||
      columns.boundary?.open !== true || columns.boundary?.position !== 3 ||
      columns.boundary?.rightDisabled !== true ||
      columns.boundary?.focusedControl !== 'Move row left' ||
      columns.boundary?.contained !== true) {
    throw new Error('Visual acceptance report has invalid column-control evidence.');
  }
  const settings = interaction('shared-settings-overlay');
  if (settings.open !== true || settings.settingCount < 18 ||
      settings.focusedSetting !== 'Density' ||
      settings.contained !== true ||
      settings.initial?.auto?.value !== '' ||
      settings.initial?.auto?.placeholder !== 'Auto (VS Code default)' ||
      settings.initial?.auto?.ariaValueText !== 'Auto (VS Code default)' ||
      settings.initial?.closeVisible !== true ||
      settings.initial?.headerVisible !== true ||
      settings.initial?.scrollable !== true ||
      settings.escapeDismissal?.open !== false ||
      settings.escapeDismissal?.focusedSummary !== true ||
      settings.closeDismissal?.open !== false ||
      settings.closeDismissal?.focusedSummary !== true ||
      settings.closeVisible !== true ||
      settings.headerVisible !== true ||
      settings.scrollable !== true ||
      settings.scroll?.scrollHeight <= settings.scroll?.clientHeight ||
      settings.screenshot?.auto?.value !== '' ||
      settings.screenshot?.auto?.placeholder !== 'Auto (VS Code default)' ||
      settings.screenshot?.auto?.ariaValueText !== 'Auto (VS Code default)' ||
      settings.screenshot?.contained !== true) {
    throw new Error('Visual acceptance report has invalid settings/focus evidence.');
  }
  const settingsScreenshot = screenshot('light-settings-overlay.png')?.acceptance;
  if (settingsScreenshot?.auto?.value !== '' ||
      settingsScreenshot?.auto?.placeholder !== 'Auto (VS Code default)' ||
      settingsScreenshot?.auto?.ariaValueText !== 'Auto (VS Code default)' ||
      settingsScreenshot?.closeVisible !== true ||
      settingsScreenshot?.headerVisible !== true ||
      settingsScreenshot?.scrollable !== true ||
      settingsScreenshot?.contained !== true ||
      settingsScreenshot?.scroll?.scrollHeight <=
        settingsScreenshot?.scroll?.clientHeight) {
    throw new Error('Light Settings screenshot is missing Auto/close/scroll evidence.');
  }
  const liveChart = interaction('live-chart-controls-persistence');
  if (liveChart.beforeDraw.exportPngDisabled !== true ||
      liveChart.beforeDraw.resetDisabled !== true ||
      liveChart.beforeDraw.refineDisabled !== true ||
      liveChart.afterDraw.canvases < 1 ||
      liveChart.afterDraw.exportPngDisabled !== false ||
      liveChart.afterDraw.resetDisabled !== false ||
      liveChart.afterDraw.refineDisabled !== false ||
      liveChart.afterDraw.statusRole !== 'status' ||
      liveChart.afterDraw.statusAriaLive !== 'polite' ||
      liveChart.yPersistence.open !== true ||
      liveChart.yPersistence.focusedSeries !== 'size' ||
      liveChart.hiddenColumns.closeVisible !== true) {
    throw new Error('Visual acceptance report has invalid live chart control evidence.');
  }
  const chart = interaction('saved-range-search-chart');
  const fullSpan = chart.fullDomainTicks.maximum - chart.fullDomainTicks.minimum;
  const zoomSpan = chart.zoomDomainTicks.maximum - chart.zoomDomainTicks.minimum;
  const resetSpan = chart.resetDomainTicks.maximum - chart.resetDomainTicks.minimum;
  if (chart.selection.selectedCells !== 9 ||
      chart.legendInteractions?.pointerToggle?.pressed !== 'false' ||
      chart.legendInteractions?.pointerToggle?.off !== true ||
      chart.legendInteractions?.enterToggle?.pressed !== 'true' ||
      chart.legendInteractions?.enterToggle?.off !== false ||
      chart.legendInteractions?.enterToggle?.focused !== true ||
      chart.legendInteractions?.spaceToggle?.pressed !== 'false' ||
      chart.legendInteractions?.spaceToggle?.off !== true ||
      chart.legendInteractions?.spaceToggle?.focused !== true ||
      chart.hiddenAfterRender !== 'false' ||
      chart.hiddenAfterRenderState?.label !== chart.hiddenSeries ||
      chart.hiddenAfterRenderState?.off !== true ||
      chart.afterSetting.hidden !== 'false' ||
      chart.afterSetting.settingsOpen !== true ||
      chart.afterSetting.focusedSetting !== 'Density' ||
      chart.afterSetting.density !== chart.settingChange.next ||
      chart.afterSetting.compact !== (chart.settingChange.next === 'compact') ||
      chart.afterSetting.selectedCells !== 9 ||
      chart.savedYPersistence.open !== true ||
      chart.savedYPersistence.focusedSeries !== 'size' ||
      chart.savedGridBroadcastFocus?.settingsOpen !== true ||
      chart.savedGridBroadcastFocus?.focusedTable !==
        'Saved KX result preview table' ||
      chart.savedGridBroadcastFocus?.selectedCells !== 9 ||
      !(chart.zoomSelectionWidth <= 1) ||
      !(chart.resetSelectionWidth <= 1) ||
      !(zoomSpan < fullSpan) ||
      !(resetSpan >= fullSpan * 0.75)) {
    throw new Error('Visual acceptance report has invalid chart persistence/zoom evidence.');
  }
  if (!validLegendEvidence(chart.hiddenLegendAfterSetting, chart.hiddenSeries)) {
    throw new Error('Hidden-series screenshot state lacks visible color-keyed legend evidence.');
  }
  const lightLegend = interaction('light-chart-legend-visible');
  if (!validLegendEvidence(lightLegend) ||
      !validLegendEvidence(screenshot('light-chart.png')?.acceptance)) {
    throw new Error('Light chart screenshot lacks visible color-keyed legend evidence.');
  }
  if (!validLegendEvidence(
    screenshot('light-chart-zoom-settings.png')?.acceptance,
    chart.hiddenSeries
  )) {
    throw new Error('Light hidden-series screenshot lacks accurate legend evidence.');
  }
  const darkChart = interaction('dark-chart-accessibility');
  if (!validLegendEvidence(darkChart.legend, chart.hiddenSeries) ||
      darkChart.selector?.themeProbe !== 'in-place-light-to-dark' ||
      darkChart.selector?.paletteChangedFromLight !== true ||
      darkChart.selector?.mappingValid !== true ||
      !Array.isArray(darkChart.selector?.selectedOptions) ||
      darkChart.selector.selectedOptions.length < 2 ||
      darkChart.selector.selectedOptions.some(option =>
        !Array.isArray(option.swatches) || option.swatches.length < 1) ||
      darkChart.ticks?.canvasTextCalls < 2 ||
      darkChart.contrast?.numericTextCalls < 2 ||
      !(darkChart.contrast?.axis?.contrast >= 4.5) ||
      !(darkChart.contrast?.grid?.contrast <=
        darkChart.contrast?.axis?.contrast * 0.6) ||
      !(darkChart.contrast?.grid?.lineWidth <= 0.5)) {
    throw new Error('Visual acceptance report has invalid dark chart contrast/legend evidence.');
  }
  const darkScreenshot = screenshot('dark-chart.png')?.acceptance;
  if (!validLegendEvidence(darkScreenshot?.legend, chart.hiddenSeries) ||
      darkScreenshot?.selector?.themeProbe !== 'in-place-light-to-dark' ||
      darkScreenshot?.selector?.paletteChangedFromLight !== true ||
      darkScreenshot?.selector?.mappingValid !== true ||
      !(darkScreenshot?.contrast?.axis?.contrast >= 4.5) ||
      !(darkScreenshot?.contrast?.grid?.contrast <=
        darkScreenshot?.contrast?.axis?.contrast * 0.6) ||
      !(darkScreenshot?.contrast?.grid?.lineWidth <= 0.5)) {
    throw new Error('Dark chart screenshot lacks readable-axis/restrained-grid evidence.');
  }
  const nullChart = interaction('saved-all-null-chart-guards');
  if (nullChart.initial?.renderDisabled !== true ||
      nullChart.initial?.exportPngDisabled !== true ||
      nullChart.initial?.resetDisabled !== true ||
      nullChart.initial?.canvases !== 0 ||
      !/no finite|no selected y column has finite numeric values|unavailable|not eligible|numeric Y column/i.test(
        `${nullChart.initial?.status || ''} ${nullChart.initial?.notice || ''}`
      ) ||
      nullChart.reconfigured?.renderDisabled !== false ||
      nullChart.reconfigured?.yOpen !== true ||
      nullChart.reconfigured?.focusedSeries !== 'valid' ||
      nullChart.recovered?.canvases < 1 ||
      nullChart.recovered?.exportPngDisabled !== false ||
      nullChart.recovered?.resetDisabled !== false ||
      nullChart.recovered?.focusedControl !== 'Render') {
    throw new Error('Visual acceptance report has invalid all-null chart guard evidence.');
  }
  const qText = interaction('saved-qtext-copy-status-a11y');
  if (!/^(Copied\.|Clipboard unavailable\.)$/.test(qText.message) ||
      qText.role !== 'status' || qText.ariaLive !== 'polite' ||
      qText.focusedControl !== 'Copy' ||
      qText.initial?.highlighting !== false ||
      qText.initial?.formatting !== false ||
      qText.initial?.tokenSpans !== 0 ||
      qText.optedIn?.highlighting !== true ||
      qText.optedIn?.formatting !== true ||
      qText.optedIn?.settingsOpen !== true ||
      qText.optedIn?.tokenSpans < 4 ||
      !qText.optedIn?.text.includes(
        '\n  [x;y] select avg price by sym from trade where price>x\n'
      ) ||
      !qText.optedIn?.tokenKinds?.includes('kx-q-keyword') ||
      !qText.optedIn?.tokenKinds?.includes('kx-q-builtin') ||
      !qText.optedIn?.tokenKinds?.includes('kx-q-operator') ||
      qText.restored?.highlighting !== false ||
      qText.restored?.formatting !== false ||
      qText.restored?.tokenSpans !== 0 ||
      qText.restored?.text !== qText.initial?.text) {
    throw new Error('Visual acceptance report has invalid qText copy-status evidence.');
  }
  const chartFamilies = interaction('saved-chart-families');
  const expectedChartFamilies = ['line', 'scatter', 'step', 'bar', 'box', 'candlestick'];
  if (!Array.isArray(chartFamilies.families) ||
      chartFamilies.families.length !== expectedChartFamilies.length ||
      chartFamilies.families.some((family, index) =>
        family.type !== expectedChartFamilies[index] ||
        family.canvases < 1 ||
        family.canvasWidth < 1 ||
        family.canvasHeight < 1 ||
        family.hostWidth < 100 ||
        family.exportPngDisabled !== false ||
        family.pngBytes < 1_000 ||
        family.pngSignature !== '89504e470d0a1a0a' ||
        family.notice)) {
    throw new Error('Visual acceptance report has invalid saved chart-family evidence.');
  }
  const reopened = interaction('saved-preview-save-close-reopen');
  if (reopened.fixture !== 'test/fixtures/notebook-results-gallery.ipynb' ||
      reopened.workingCopy !== 'tracked-saved-preview-reopen.ipynb' ||
      reopened.saved !== true ||
      reopened.closedBeforeReopen !== true ||
      reopened.reopened !== true ||
      reopened.sourceUnchanged !== true ||
      reopened.persistedKernelMetadata !== true ||
      reopened.language !== 'q' ||
      reopened.rowCount !== 128 ||
      reopened.previewRowCount !== 6 ||
      reopened.storedRows !== 6 ||
      reopened.truncated !== true ||
      reopened.marker !== 'direct-ipc') {
    throw new Error('Visual acceptance report has invalid saved-preview reopen evidence.');
  }
  const narrow = interaction('narrow-live-saved-layout');
  if (!(narrow.saved.width > 250 && narrow.saved.width < 560) ||
      !(narrow.live.width > 250 && narrow.live.width < 560) ||
      !narrow.saved.notice.includes('Omitted content is not stored in this notebook')) {
    throw new Error('Visual acceptance report has invalid narrow saved/live evidence.');
  }
  const narrowChart = interaction('narrow-saved-chart-overlay');
  if (!(narrowChart.initial?.width > 250 && narrowChart.initial?.width < 560) ||
      narrowChart.initial?.canvases < 1 ||
      !(narrowChart.initial?.chartWidth > 240 &&
        narrowChart.initial?.chartWidth <= narrowChart.initial?.width) ||
      !['Render', 'Export PNG', 'Reset zoom'].every(label =>
        narrowChart.initial?.controls?.includes(label)) ||
      narrowChart.overlay?.open !== true ||
      narrowChart.overlay?.optionCount < 2 ||
      narrowChart.overlay?.focusedTag !== 'INPUT' ||
      narrowChart.overlay?.contained !== true ||
      narrowChart.overlay?.scrollable !== true ||
      !['auto', 'scroll'].includes(narrowChart.overlay?.overflowY) ||
      !(narrowChart.overlay?.dimensions?.scrollHeight >
        narrowChart.overlay?.dimensions?.clientHeight) ||
      !(narrowChart.overlay?.dimensions?.scrollTop > 0) ||
      !(narrowChart.overlay?.dimensions?.panelArea <
        narrowChart.overlay?.dimensions?.rootArea * 0.65) ||
      !Array.isArray(narrowChart.overlay?.options) ||
      narrowChart.overlay.options.some(option =>
        !Array.isArray(option.swatches) ||
        option.swatches.length < 1 ||
        option.swatches.some(swatch => swatch.visible !== true))) {
    throw new Error('Visual acceptance report has invalid narrow chart-overlay evidence.');
  }
  const narrowScreenshot = screenshot('narrow-chart-overlay.png')?.acceptance;
  if (narrowScreenshot?.contained !== true ||
      narrowScreenshot?.scrollable !== true ||
      !(narrowScreenshot?.dimensions?.scrollHeight >
        narrowScreenshot?.dimensions?.clientHeight) ||
      !(narrowScreenshot?.dimensions?.scrollTop > 0) ||
      !Array.isArray(narrowScreenshot?.options) ||
      narrowScreenshot.options.some(option =>
        !Array.isArray(option.swatches) ||
        option.swatches.length < 1 ||
        option.swatches.some(swatch => swatch.visible !== true))) {
    throw new Error('Narrow chart screenshot lacks swatch/containment evidence.');
  }
  if (!Array.isArray(report.nonAutomatedBoundaries) ||
      report.nonAutomatedBoundaries.length !== 4) {
    throw new Error('Visual acceptance report must retain explicit native-action boundaries.');
  }
  if (!/live full-result handle/i.test(report.chartEvidence?.live || '') ||
      !/all six saved chart families/i.test(report.chartEvidence?.saved || '') ||
      !/file-backed copy of the tracked bounded \.ipynb preview was saved, closed, and reopened/i.test(
        report.lifecycleBoundary || ''
      )) {
    throw new Error('Visual acceptance report must distinguish live and saved chart evidence.');
  }
}

function validateOrdinaryChartLifecycleEvidence(chart) {
  const fullRange = { min: 0, max: 20_000 };
  const sameRange = (left, right) => !!left && !!right &&
    left.min === right.min &&
    left.max === right.max;
  const finiteRange = value => !!value &&
    Number.isFinite(value.min) &&
    Number.isFinite(value.max) &&
    value.max > value.min;
  const expectedDomain = range => ({
    min: Math.ceil(Math.max(fullRange.min, range.min)),
    max: Math.floor(Math.min(fullRange.max, range.max)),
  });
  const validDigest = value => /^[0-9a-f]{16}$/.test(String(value || ''));
  const baseline = chart?.baseline;
  const first = chart?.first;
  const second = chart?.second;
  const reset = chart?.reset;
  if (chart?.fixture?.rowCount !== 20_001 ||
      !sameRange(chart.fixture?.fullRange, fullRange) ||
      !/trusted CDP drag.*uPlot setScale hook.*450ms debounce.*host chartData.*new uPlot reconstruction/i.test(
        chart.browserPath || ''
      )) {
    throw new Error(
      'Ordinary chart lifecycle evidence lacks the real browser/host fixture path.'
    );
  }
  for (const [label, stage, expectedResponseCount] of [
    ['baseline', baseline, 1],
    ['first drag', first, 2],
    ['nested drag', second, 3],
  ]) {
    if (stage?.hostChartDataResponseCount !== expectedResponseCount ||
        stage?.hostChartErrorCount !== 0 ||
        stage?.currentMatchesHostResponse !== true ||
        stage?.fullResponseStoredUnchanged !== true ||
        !Number.isSafeInteger(stage?.uPlotBuildCount) ||
        stage.uPlotBuildCount < expectedResponseCount ||
        !Number.isSafeInteger(stage?.uPlotScaleHookCount) ||
        stage.uPlotScaleHookCount < 1 ||
        !Number.isSafeInteger(stage?.uPlotDataHookCount) ||
        stage.uPlotDataHookCount < expectedResponseCount ||
        stage?.response?.chartType !== 'line' ||
        stage.response.sourceRowCount !== 20_001 ||
        stage.response.storedUnchanged !== true ||
        !validDigest(stage.response.digest) ||
        stage.response.digest !== stage.response.receivedDigest ||
        stage.response.digest !== stage?.reconstructedData?.digest ||
        stage.response.sampledPointCount !==
          stage?.reconstructedData?.pointCount ||
        stage.response.firstX !== stage?.reconstructedData?.firstX ||
        stage.response.lastX !== stage?.reconstructedData?.lastX ||
        !finiteRange(stage.reconstructedRange)) {
      throw new Error(
        `Ordinary chart lifecycle has invalid ${label} host/uPlot reconstruction evidence.`
      );
    }
  }
  if (!sameRange(baseline.reconstructedRange, fullRange) ||
      !sameRange(baseline.response.xDomain, fullRange) ||
      baseline.response.eligibleRowCount !== 20_001 ||
      !(baseline.response.sampledPointCount > 0 &&
        baseline.response.sampledPointCount < 20_001)) {
    throw new Error('Ordinary chart lifecycle full baseline is invalid.');
  }
  for (const [label, stage, prior] of [
    ['first drag', first, baseline],
    ['nested drag', second, first],
  ]) {
    const drag = stage.drag;
    const requestedRange = drag?.requestedRange;
    const domain = expectedDomain(requestedRange || {});
    if (drag?.input !== 'trusted CDP Input.dispatchMouseEvent drag' ||
        !finiteRange(drag.beforeRange) ||
        !finiteRange(requestedRange) ||
        !sameRange(stage.reconstructedRange, requestedRange) ||
        drag.hostChartDataResponseCountBefore !==
          prior.hostChartDataResponseCount ||
        drag.hostChartDataResponseCountAfterDragBeforeDebounce !==
          prior.hostChartDataResponseCount ||
        !(drag.uPlotScaleHookCountAfter >
          drag.uPlotScaleHookCountBefore) ||
        !sameRange(drag.scaleHook?.range, requestedRange) ||
        drag.scaleHook?.resetDisabled !== false ||
        drag.scaleHook?.refineDisabled !== false ||
        !Number.isFinite(drag.scaleHook?.at) ||
        !sameRange(stage.expectedEligibleDomain, domain) ||
        !sameRange(stage.response.xDomain, domain) ||
        stage.response.firstX !== domain.min ||
        stage.response.lastX !== domain.max ||
        stage.response.eligibleRowCount !== domain.max - domain.min + 1 ||
        stage.response.sampledPointCount !==
          Math.min(stage.response.eligibleRowCount, 7_000) ||
        !(stage.response.receivedAt > drag.scaleHook.at)) {
      throw new Error(
        `Ordinary chart lifecycle has invalid exact ${label} range/density evidence.`
      );
    }
  }
  if (!(first.drag.requestedRange.min > fullRange.min &&
      first.drag.requestedRange.max < fullRange.max) ||
      !(second.drag.requestedRange.min > first.drag.requestedRange.min &&
        second.drag.requestedRange.max < first.drag.requestedRange.max) ||
      sameRange(first.drag.requestedRange, second.drag.requestedRange) ||
      !(first.response.eligibleRowCount < baseline.response.eligibleRowCount) ||
      !(second.response.eligibleRowCount < first.response.eligibleRowCount) ||
      first.response.sampledPointCount === baseline.response.sampledPointCount ||
      !(second.response.sampledPointCount < first.response.sampledPointCount) ||
      second.nestedResponseIntroducedPoint !== true ||
      !(baseline.uPlotBuildCount < first.uPlotBuildCount &&
        first.uPlotBuildCount < second.uPlotBuildCount)) {
    throw new Error(
      'Ordinary chart lifecycle does not prove two distinct nested drag reconstructions.'
    );
  }
  if (chart.immutableFull?.sourceRowCount !== 20_001 ||
      !sameRange(chart.immutableFull?.range, fullRange) ||
      chart.immutableFull?.responseDigest !== baseline.response.digest ||
      chart.immutableFull?.unchangedAfterFirst !== true ||
      chart.immutableFull?.unchangedAfterSecond !== true ||
      chart.immutableFull?.unchangedAfterReset !== true) {
    throw new Error(
      'Ordinary chart lifecycle does not retain an immutable full source/range.'
    );
  }
  if (reset?.hostChartDataResponseCountBefore !== 3 ||
      reset.hostChartDataResponseCountAfter !==
        reset.hostChartDataResponseCountBefore ||
      !(reset.uPlotBuildCountAfter > reset.uPlotBuildCountBefore) ||
      !sameRange(reset.range, fullRange) ||
      reset.data?.pointCount !== baseline.reconstructedData.pointCount ||
      reset.data?.digest !== baseline.reconstructedData.digest ||
      reset.data?.firstX !== baseline.reconstructedData.firstX ||
      reset.data?.lastX !== baseline.reconstructedData.lastX ||
      reset.matchesOriginalFullResponse !== true ||
      reset.fullResponseStoredUnchanged !== true ||
      reset.chartStatus !== 'Zoom reset to the original full data range.') {
    throw new Error(
      'Ordinary chart Reset did not locally restore the exact full sample without host data I/O.'
    );
  }
}

function validLegendEvidence(evidence, hiddenLabel = '') {
  if (!evidence || evidence.legendVisible !== true ||
      evidence.ariaLabel !== 'Chart series legend' ||
      !Array.isArray(evidence.items) ||
      evidence.items.length < 2 ||
      new Set(evidence.items.map(item => item.swatch?.color)).size < 2 ||
      evidence.items.some(item =>
        item.visible !== true ||
        item.inResult !== true ||
        item.inViewport !== true ||
        item.swatch?.visible !== true ||
        item.role !== 'button' ||
        item.tabIndex !== 0 ||
        !/^(true|false)$/.test(item.pressed) ||
        item.off !== (item.pressed === 'false') ||
        (item.pressed !== 'false' && !(item.textContrast >= 4.5)))) {
    return false;
  }
  if (!hiddenLabel) {
    return true;
  }
  const hidden = evidence.items.find(item => item.label === hiddenLabel);
  return hidden?.pressed === 'false' &&
    hidden.off === true &&
    (hidden.opacity < 0.8 ||
      evidence.items.some(item =>
        item.pressed === 'true' && item.opacity > hidden.opacity));
}

async function main() {
  assertFile('/usr/bin/Xvfb', 'Xvfb');
  assertFile('/usr/bin/ffmpeg', 'ffmpeg');
  assertFile(VSCODE_PATH, 'VS Code runtime');
  assertFile(Q_PATH, 'q runtime');
  assertFile(Q_FIXTURE, 'q fixture');
  assertFile(EXTENSION_TESTS_PATH, 'visual Extension Host test module');
  if (VSCODE_LIBRARY_PATH &&
      !fs.statSync(VSCODE_LIBRARY_PATH, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`VS Code runtime libraries were not found at ${VSCODE_LIBRARY_PATH}.`);
  }

  resetOwnedDirectories();
  const qPort = await getFreePort();
  const qState = startQ(qPort);
  await waitForPort(qPort, qState, 15_000);
  const cdpPort = await getFreePort();
  const display = await startXvfb();
  console.log(`Notebook visual runtime: ${VSCODE_PATH}`);
  console.log(`Notebook visual q: ${Q_PATH} on 127.0.0.1:${qPort}`);
  console.log(`Notebook visual CDP: 127.0.0.1:${cdpPort}`);
  console.log(`Notebook visual display: ${display} (${SCREEN_SIZE})`);
  const phaseOneProcess = await runVsCode(display, qPort, cdpPort, 1);
  if (phaseOneProcess.exitCode !== 1 ||
      phaseOneProcess.signal !== null ||
      !Number.isSafeInteger(phaseOneProcess.childPid) ||
      phaseOneProcess.childPid <= 0) {
    throw new Error(
      'VS Code notebook visual phase 1 did not exit through the expected ' +
      `reload teardown (code ${String(phaseOneProcess.exitCode)}, ` +
      `signal ${String(phaseOneProcess.signal)}).`
    );
  }
  const restartMarker = readJsonFile(
    RESTART_MARKER,
    'notebook visual restart marker'
  );
  validateRestartMarker(restartMarker);
  const phaseOneArtifact = readJsonFile(
    PHASE_ONE_ARTIFACT,
    'notebook visual phase-1 artifact'
  );
  validatePhaseOneRestartEvidence(
    phaseOneArtifact,
    restartMarker.widthsByPosition
  );
  if (phaseOneArtifact.extensionHostPid !== restartMarker.extensionHostPid ||
      phaseOneArtifact.profilePath !== restartMarker.profilePath) {
    throw new Error(
      'Notebook visual phase-1 artifact does not identify its restart marker.'
    );
  }
  console.log(
    'VS Code notebook visual phase 1 exited for workbench.action.reloadWindow; ' +
    'waiting for the persisted-profile phase 2 launch.'
  );

  await waitForPortAvailable(cdpPort, 30_000);
  const phaseTwoProcess = await runVsCode(display, qPort, cdpPort, 2);
  if (phaseTwoProcess.exitCode !== 0 ||
      phaseTwoProcess.signal !== null ||
      !Number.isSafeInteger(phaseTwoProcess.childPid) ||
      phaseTwoProcess.childPid <= 0) {
    throw new Error(
      'VS Code notebook visual phase 2 failed ' +
      `(code ${String(phaseTwoProcess.exitCode)}, ` +
      `signal ${String(phaseTwoProcess.signal)}).`
    );
  }
  if (phaseOneProcess.childPid === phaseTwoProcess.childPid) {
    throw new Error(
      `Notebook visual restart reused VS Code child PID ${String(
        phaseOneProcess.childPid
      )}.`
    );
  }
  if (fs.statSync(RESTART_MARKER, { throwIfNoEntry: false })) {
    throw new Error(
      'Notebook visual phase 2 did not remove the consumed restart marker.'
    );
  }

  const processRestart = {
    version: 1,
    phaseOne: phaseOneProcess,
    phaseTwo: phaseTwoProcess,
    reload: {
      command: restartMarker.reloadCommand,
      phaseOneComplete: restartMarker.phaseOneComplete,
      commandIssued: restartMarker.reloadCommandIssued,
      markerValidated: true,
      markerExtensionHostPid: restartMarker.extensionHostPid,
    },
    restartMarkerRemovedAfterPhaseTwo: true,
    distinctChildPids: true,
    sameUserDataDir:
      phaseOneProcess.profilePath === phaseTwoProcess.profilePath &&
      phaseOneProcess.profilePath === USER_DATA_DIR,
    sameExtensionsDir:
      phaseOneProcess.extensionsPath === phaseTwoProcess.extensionsPath &&
      phaseOneProcess.extensionsPath === EXTENSIONS_DIR,
    sameCdpPort:
      phaseOneProcess.cdpPort === phaseTwoProcess.cdpPort &&
      phaseOneProcess.cdpPort === cdpPort,
  };
  writeJsonAtomic(PROCESS_RESTART_ARTIFACT, processRestart);
  validateArtifacts();
  console.log(`Notebook visual acceptance passed. Artifacts: ${ARTIFACT_DIRECTORY}`);
}

function cleanup() {
  stopProcess(vscodeProcess);
  stopProcess(qProcess);
  stopProcess(xvfbProcess);
  if (E2E_ROOT.startsWith(`${VSCODE_TEST_ROOT}${path.sep}`)) {
    fs.rmSync(E2E_ROOT, { recursive: true, force: true });
  }
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

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForPort(port, state, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (state.child.exitCode !== null || state.child.signalCode !== null) {
      throw new Error(
        `q exited before accepting connections. stdout=${state.stdout.trim()} ` +
        `stderr=${state.stderr.trim()}`
      );
    }
    if (await canConnect(port)) {
      return;
    }
    await delay(50);
  }
  throw new Error(
    `q did not accept connections within ${timeoutMs} ms. ` +
    `stdout=${state.stdout.trim()} stderr=${state.stderr.trim()}`
  );
}

function canConnect(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(250);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    const failed = () => {
      socket.destroy();
      resolve(false);
    };
    socket.once('error', failed);
    socket.once('timeout', failed);
  });
}

async function waitForPortAvailable(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    const result = await canBindPort(port);
    if (result.available) {
      return;
    }
    lastError = result.error;
    await delay(100);
  }
  throw new Error(
    `CDP port ${port} remained occupied after phase-1 reload teardown: ${lastError}`
  );
}

function canBindPort(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.unref();
    let settled = false;
    const finish = result => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };
    server.once('error', error => {
      finish({
        available: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    server.listen(port, '127.0.0.1', () => {
      server.close(error => {
        if (error) {
          finish({
            available: false,
            error: error instanceof Error ? error.message : String(error),
          });
        } else {
          finish({ available: true, error: '' });
        }
      });
    });
  });
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
