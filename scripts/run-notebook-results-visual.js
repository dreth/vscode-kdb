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

async function runVsCode(display, qPort, cdpPort) {
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
        reject(new Error(
          `VS Code notebook visual test timed out after ${TEST_TIMEOUT_MS} ms.`
        ));
      } else if (code !== 0) {
        reject(new Error(
          `VS Code notebook visual test failed (code ${String(code)}, ` +
          `signal ${String(signal)}).`
        ));
      } else {
        resolve();
      }
    });
  });
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
  for (const name of required) {
    const target = path.join(ARTIFACT_DIRECTORY, name);
    const stat = fs.statSync(target, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.size === 0) {
      throw new Error(`Visual acceptance artifact was not created: ${target}`);
    }
  }
  const report = JSON.parse(
    fs.readFileSync(path.join(ARTIFACT_DIRECTORY, 'visual-report.json'), 'utf8')
  );
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
      !/no finite|unavailable|not eligible|numeric Y column/i.test(
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
  await runVsCode(display, qPort, cdpPort);
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

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
