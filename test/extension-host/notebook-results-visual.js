'use strict';

const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const {
  KX_NOTEBOOK_MIME,
  expectedCaseIds,
  liveQueries,
  savedCases,
} = require('../fixtures/notebook-results-gallery');

const EXTENSION_ID = 'DanielAlonso.vscode-kdb';
const RUN_Q_NOTEBOOK_CELL_COMMAND = 'vscode-kdb.runQNotebookCell';
const LIVE_RESULT_METADATA_KEY = 'vscode-kdb.liveResult';
const VISUAL_CONNECTION_ID = 'notebook-results-visual';
const VISUAL_CONNECTION_NAME = 'Visual gallery q';
const COLUMN_SIZING_WIDEST_ROW = 350;
const COLUMN_SIZING_FIXTURE = Object.freeze({
  id: 'column-sizing-real-runtime',
  title: 'Column sizing real runtime',
  source:
    '([] acceptance_row:til 400;acceptance_label:400#`short;' +
    'acceptance_widest_list:{?[x=350;til 45;enlist x]} each til 400)',
});
const ORDINARY_CHART_LIFECYCLE_FIXTURE = Object.freeze({
  id: 'ordinary-chart-lifecycle-real-runtime',
  title: 'Ordinary chart lifecycle real runtime',
  marker: 'ordinary_zoom_x',
  rowCount: 20_001,
  fullRange: Object.freeze({ min: 0, max: 20_000 }),
  source:
    '([] ordinary_zoom_x:til 20001;' +
    'ordinary_zoom_y:10*til 20001)',
});
const RESTART_WIDTHS_BY_POSITION = Object.freeze({
  0: 233,
  2: 317,
});
const RESTART_COLUMN_SIZING_FIXTURES = Object.freeze({
  phaseOne: Object.freeze({
    id: 'column-sizing-restart-phase-one',
    title: 'Column sizing restart phase one',
    marker: 'phase_one_later',
    headers: Object.freeze([
      'phase_one_zero',
      'phase_one_payload',
      'phase_one_later',
      'phase_one_tail',
    ]),
    source:
      '([] phase_one_zero:til 400;' +
      'phase_one_payload:{?[x=350;til 45;enlist x]} each til 400;' +
      'phase_one_later:400#`later;phase_one_tail:400#0b)',
  }),
  renamed: Object.freeze({
    id: 'column-sizing-restart-renamed',
    title: 'Column sizing restart renamed',
    marker: 'renamed_later',
    headers: Object.freeze([
      'renamed_zero',
      'different_payload',
      'renamed_later',
      'extra_schema',
    ]),
    source:
      '([] renamed_zero:400#`renamed;different_payload:til 400;' +
      'renamed_later:{?[x=350;til 12;enlist x]} each til 400;' +
      'extra_schema:400#42f)',
  }),
  reloaded: Object.freeze({
    id: 'column-sizing-restart-reloaded',
    title: 'Column sizing restart reloaded',
    marker: 'restarted_later',
    headers: Object.freeze([
      'restarted_zero',
      'restart_payload',
      'restarted_later',
      'restart_tail',
    ]),
    source:
      '([] restarted_zero:400#42f;restart_payload:400#`payload;' +
      'restarted_later:til 400;restart_tail:400#1b)',
  }),
});
const EXPANDED_LIVE_FIXTURE_IDS = new Set([
  'live-full-result',
  COLUMN_SIZING_FIXTURE.id,
  ...Object.values(RESTART_COLUMN_SIZING_FIXTURES).map(fixture => fixture.id),
]);
const RESULT_COLUMN_SETTING_KEYS = Object.freeze([
  'viewer.autoFitColumns',
  'viewer.autoFitMode',
  'viewer.columnWidths',
  'density',
  'standard.cellWidth',
  'comfortable.cellWidth',
]);
const LIGHT_THEME = 'Default Light Modern';
const DARK_THEME = 'Default Dark Modern';
const TRACKED_NOTEBOOK_FIXTURE = path.resolve(
  __dirname,
  '..',
  'fixtures',
  'notebook-results-gallery.ipynb'
);
const savedVisualCases = Object.freeze(savedCases.filter(fixture =>
  ['saved-table', 'truncated-saved-preview', 'chart-candlestick'].includes(fixture.id)));
const REQUIRED_SCREENSHOTS = Object.freeze([
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
]);
const KX_ROOT_QUERY_EXPRESSION = `(() => {
  const roots = [];
  const visited = new Set();
  const visit = candidate => {
    if (!candidate || visited.has(candidate) ||
        typeof candidate.querySelectorAll !== 'function') {
      return;
    }
    visited.add(candidate);
    candidate.querySelectorAll('.kx-results-surface').forEach(root => roots.push(root));
    candidate.querySelectorAll('*').forEach(element => {
      if (element.shadowRoot) {
        visit(element.shadowRoot);
      }
      if (element.tagName === 'IFRAME') {
        try {
          visit(element.contentDocument);
        } catch {
          // Cross-origin child frames are separate CDP targets and probed independently.
        }
      }
    });
  };
  visit(document);
  return roots;
})()`;

function kxExtension() {
  return vscode.extensions.getExtension(EXTENSION_ID) ||
    vscode.extensions.all.find(extension =>
      extension.packageJSON?.publisher === 'DanielAlonso' &&
      extension.packageJSON?.name === 'vscode-kdb'
    );
}

async function run() {
  const artifactDirectory = requiredAbsoluteDirectory(
    process.env.VSCODE_KDB_VISUAL_ARTIFACT_DIR,
    'VSCODE_KDB_VISUAL_ARTIFACT_DIR'
  );
  const profilePath = requiredAbsoluteDirectory(
    process.env.VSCODE_KDB_VISUAL_USER_DATA_DIR,
    'VSCODE_KDB_VISUAL_USER_DATA_DIR'
  );
  const qPort = positiveInteger(process.env.VSCODE_KDB_VISUAL_Q_PORT, 'VSCODE_KDB_VISUAL_Q_PORT');
  const cdpPort = positiveInteger(
    process.env.VSCODE_KDB_VISUAL_CDP_PORT,
    'VSCODE_KDB_VISUAL_CDP_PORT'
  );
  const screenSize = validScreenSize(process.env.VSCODE_KDB_VISUAL_SCREEN_SIZE || '1440x1000');
  assert(process.env.DISPLAY, 'The visual Extension Host test requires an Xvfb DISPLAY.');
  assert(typeof fetch === 'function' && typeof WebSocket === 'function',
    'visual interaction acceptance requires Node fetch and WebSocket support');
  assert(fs.statSync('/usr/bin/ffmpeg', { throwIfNoEntry: false })?.isFile(),
    'ffmpeg is required for real Xvfb screenshots.');
  fs.mkdirSync(artifactDirectory, { recursive: true });

  validateGalleryContract();
  const extension = kxExtension();
  assert(extension, `development extension ${EXTENSION_ID} was not loaded`);
  const extensionExports = await extension.activate();
  const testApi = extensionExports?.extensionHostTest;
  assert(testApi, 'visual acceptance requires the existing Extension Host test-only API');
  const commands = new Set(await vscode.commands.getCommands(true));
  assert(commands.has(RUN_Q_NOTEBOOK_CELL_COMMAND),
    `activated extension must register ${RUN_Q_NOTEBOOK_CELL_COMMAND}`);
  assert(commands.has('vscode-kdb.runSelectionOrCurrentLine'),
    'visual acceptance requires the ordinary KX query command');
  assert(commands.has('workbench.action.revertAndCloseActiveEditor'),
    'visual acceptance requires the built-in discard-and-close editor command');
  assert(commands.has('workbench.action.reloadWindow'),
    'visual acceptance requires the real VS Code reload-window command');

  const workbenchConfiguration = vscode.workspace.getConfiguration('workbench');
  const resultConfiguration = vscode.workspace.getConfiguration('vscode-kdb.results');
  const restartMarkerPath = path.join(
    artifactDirectory,
    'visual-restart-marker.json'
  );
  const restartMarker = readJsonIfPresent(restartMarkerPath);
  const launchPhase = Number(process.env.VSCODE_KDB_VISUAL_PHASE);
  if (restartMarker) {
    assert.strictEqual(
      launchPhase,
      2,
      'persisted-profile phase 2 must be launched as a second VS Code process'
    );
    return runPostReloadColumnSizing({
      artifactDirectory,
      cdpPort,
      profilePath,
      qPort,
      restartMarker,
      restartMarkerPath,
      resultConfiguration,
      testApi,
      workbenchConfiguration,
    });
  }
  assert.strictEqual(launchPhase, 1, 'visual phase 1 launch identity is invalid');

  const previousTheme = snapshotGlobalConfiguration(
    workbenchConfiguration,
    ['colorTheme']
  );
  const previousResultColumnSettings = snapshotGlobalConfiguration(
    resultConfiguration,
    RESULT_COLUMN_SETTING_KEYS
  );
  const previousActiveConnectionId = testApi.activeConnectionId();
  let liveNotebook;
  let contractNotebook;
  let savedInteractionNotebook;
  let allNullChartNotebook;
  let savedQTextNotebook;
  let darkLiveNotebook;
  let truncatedPreviewNotebook;
  let narrowChartNotebook;
  let liveCaseEvidence;
  let liveResultRecord;
  let savedChartEvidence;
  let lightThemeSelectorEvidence;
  const screenshots = [];
  const interactions = [];
  let preserveForReload = false;
  let visualConnectionAdded = false;
  try {
    assert(
      !testApi.connection(VISUAL_CONNECTION_ID),
      `visual profile already contains connection ${VISUAL_CONNECTION_ID}`
    );
    await testApi.addConnection({
      id: VISUAL_CONNECTION_ID,
      name: VISUAL_CONNECTION_NAME,
      host: '127.0.0.1',
      port: qPort,
      database: '.',
      username: '',
      connectTimeoutMs: 5_000,
      queryTimeoutMs: 30_000,
    });
    visualConnectionAdded = true;
    await testApi.setActiveConnection(VISUAL_CONNECTION_ID);

    await configureColumnSizingAcceptance(resultConfiguration);
    interactions.push(await exerciseOrdinaryResultColumnSizing(
      cdpPort,
      resultConfiguration
    ));
    console.log('KX Results visual interaction: real-runtime column sizing passed');
    interactions.push(await exerciseOrdinaryResultChartLifecycle(cdpPort));
    console.log('KX Results visual interaction: real two-drag chart lifecycle passed');
    interactions.push(await exerciseNotebookResultColumnSizing(
      cdpPort,
      resultConfiguration
    ));
    console.log('Notebook visual interaction: real-runtime column sizing passed');
    await configureColumnSizingAcceptance(resultConfiguration, {
      autoFitColumns: true,
      autoFitMode: 'wholeResult',
    });

    const fullResultFixture = liveQueries[caseIndex(liveQueries, 'live-full-result')];
    liveNotebook = await openLiveGalleryNotebook(fullResultFixture);
    console.log('Notebook visual stage: live screenshot case opened');
    const liveEditor = await vscode.window.showNotebookDocument(liveNotebook, {
      preserveFocus: false,
      preview: false,
      viewColumn: vscode.ViewColumn.One,
    });
    assertLiveCase(
      fullResultFixture,
      await executeOneLiveGalleryCase(liveNotebook, liveEditor, fullResultFixture)
    );
    assertFullLiveResult(liveNotebook);
    console.log('Notebook visual stage: live screenshot case executed');

    await vscode.commands.executeCommand('workbench.action.closeSidebar');
    await setTheme(workbenchConfiguration, LIGHT_THEME);
    await showNotebookCase(liveNotebook, 0);
    screenshots.push(await captureScreenshot(
      artifactDirectory,
      'light-table.png',
      screenSize,
      { theme: LIGHT_THEME, caseId: 'live-full-result', widthMode: 'wide' }
    ));
    liveResultRecord = liveResultEvidence(liveNotebook);
    const liveRenderer = await connectNotebookRenderer(cdpPort, 'Live full result');
    try {
      interactions.push(await exerciseLiveSelectionAndSearch(liveRenderer));
      console.log('Notebook visual interaction: live selection/search passed');
      screenshots.push(await captureScreenshot(
        artifactDirectory,
        'light-live-selection-search.png',
        screenSize,
        {
          theme: LIGHT_THEME,
          caseId: 'live-full-result',
          widthMode: 'wide',
          interaction: 'live-range-selection-search-prev-next',
        }
      ));
      interactions.push(await exerciseColumnsOverlay(liveRenderer));
      console.log('Notebook visual interaction: live Columns passed');
      screenshots.push(await captureScreenshot(
        artifactDirectory,
        'light-columns-overlay.png',
        screenSize,
        {
          theme: LIGHT_THEME,
          caseId: 'live-full-result',
          widthMode: 'wide',
          interaction: 'live-column-hide-overlay-focus',
        }
      ));
      const settingsEvidence = await exerciseSettingsOverlay(liveRenderer);
      interactions.push(settingsEvidence);
      console.log('Notebook visual interaction: shared Settings passed');
      screenshots.push(await captureScreenshot(
        artifactDirectory,
        'light-settings-overlay.png',
        screenSize,
        {
          theme: LIGHT_THEME,
          caseId: 'live-full-result',
          widthMode: 'wide',
          interaction: 'shared-settings-overlay-focus',
          acceptance: settingsEvidence.screenshot,
        }
      ));
      interactions.push(await exerciseLiveChartControls(liveRenderer));
      console.log('Notebook visual interaction: live chart controls passed');
    } finally {
      liveRenderer.close();
    }
    await discardActiveVisualNotebook();
    savedInteractionNotebook = await openSavedCaseNotebook(
      savedCases[caseIndex(savedCases, 'chart-line')]
    );
    await showNotebookCase(savedInteractionNotebook, 0);
    const savedRenderer = await connectNotebookRenderer(cdpPort, 'Line chart gallery');
    await scrollNotebookChartIntoView(savedRenderer, cdpPort);
    const lightLegendEvidence = await inspectVisibleChartLegend(savedRenderer);
    interactions.push({
      name: 'light-chart-legend-visible',
      ...lightLegendEvidence,
    });
    screenshots.push(await captureScreenshot(
      artifactDirectory,
      'light-chart.png',
      screenSize,
      {
        theme: LIGHT_THEME,
        caseId: 'chart-line',
        widthMode: 'wide',
        acceptance: lightLegendEvidence,
      }
    ));
    console.log('Notebook visual interaction: line-chart baseline captured');
    try {
      console.log('Notebook visual interaction: saved line renderer connected');
      savedChartEvidence = await exerciseSavedSelectionSearchAndChart(
        savedRenderer,
        async hiddenSeriesLabel => {
          await closeResultOverlays(savedRenderer);
          await scrollNotebookChartIntoView(savedRenderer, cdpPort);
          lightThemeSelectorEvidence = await inspectChartSeriesSelectorColors(
            savedRenderer,
            'in-place-light-to-dark'
          );
          const hiddenLegendEvidence = await inspectVisibleChartLegend(
            savedRenderer,
            hiddenSeriesLabel
          );
          screenshots.push(await captureScreenshot(
            artifactDirectory,
            'light-chart-zoom-settings.png',
            screenSize,
            {
              theme: LIGHT_THEME,
              caseId: 'chart-line',
              widthMode: 'wide',
              interaction: 'saved-hidden-series-zoom-preserved-after-density-setting',
              acceptance: hiddenLegendEvidence,
            }
          ));
          console.log('Notebook visual interaction: zoom/settings persistence captured');
          return hiddenLegendEvidence;
        },
        () => dragNotebookChartInRenderer(savedRenderer),
        cdpPort
      );
      interactions.push(savedChartEvidence);
      console.log('Notebook visual interaction: saved selection/search/chart passed');
      screenshots.push(await captureScreenshot(
        artifactDirectory,
        'light-chart-interactions.png',
        screenSize,
        {
          theme: LIGHT_THEME,
          caseId: 'chart-line',
          widthMode: 'wide',
          interaction:
            'saved-range-search-render-hidden-series-zoom-settings-rerender-reset',
        }
      ));
    } finally {
      savedRenderer.close();
    }

    await setTheme(workbenchConfiguration, DARK_THEME);
    await showNotebookCase(savedInteractionNotebook, 0);
    const darkSavedRenderer = await connectNotebookRenderer(cdpPort, 'Line chart gallery');
    await scrollNotebookChartIntoView(darkSavedRenderer, cdpPort);
    await closeResultOverlays(darkSavedRenderer);
    const darkLegendEvidence = await inspectVisibleChartLegend(
      darkSavedRenderer,
      savedChartEvidence?.hiddenSeries
    );
    const darkSelectorEvidence = await inspectChartSeriesSelectorColors(darkSavedRenderer);
    assert.strictEqual(
      darkSelectorEvidence.themeProbe,
      lightThemeSelectorEvidence?.themeProbe,
      'dark selector must be the same renderer instance that was inspected in light theme'
    );
    const lightSelectorColors = lightThemeSelectorEvidence?.selectedOptions
      .map(option => `${option.name}:${option.swatches.join(',')}`) || [];
    const darkSelectorColors = darkSelectorEvidence.selectedOptions
      .map(option => `${option.name}:${option.swatches.join(',')}`);
    assert.notDeepStrictEqual(
      darkSelectorColors,
      lightSelectorColors,
      'in-place theme change must update selector swatch colors'
    );
    darkSelectorEvidence.paletteChangedFromLight = true;
    await installCanvasTextRecorder(darkSavedRenderer);
    await clearCanvasTextRecorder(darkSavedRenderer);
    await forceChartRedraw(darkSavedRenderer);
    const darkTicks = await waitForCanvasTicks('dark chart axis ticks', darkSavedRenderer);
    const darkContrastEvidence = await inspectChartCanvasContrast(darkSavedRenderer);
    await restoreCanvasTextRecorder(darkSavedRenderer);
    const darkChartEvidence = {
      name: 'dark-chart-accessibility',
      legend: darkLegendEvidence,
      selector: darkSelectorEvidence,
      ticks: darkTicks,
      contrast: darkContrastEvidence,
    };
    interactions.push(darkChartEvidence);
    screenshots.push(await captureScreenshot(
      artifactDirectory,
      'dark-chart.png',
      screenSize,
      {
        theme: DARK_THEME,
        caseId: 'chart-line',
        widthMode: 'wide',
        acceptance: darkChartEvidence,
      }
    ));
    darkSavedRenderer.close();
    allNullChartNotebook = await openSavedCaseNotebook(
      savedCases[caseIndex(savedCases, 'chart-all-null')]
    );
    await showNotebookCase(allNullChartNotebook, 0);
    interactions.push(await assertAllNullSavedChartControls(
      cdpPort,
      'All-null chart gallery'
    ));
    await discardActiveVisualNotebook();
    interactions.push(await assertSavedChartFamilies(cdpPort));
    savedQTextNotebook = await openSavedCaseNotebook(
      savedCases[caseIndex(savedCases, 'saved-qtext')]
    );
    await showNotebookCase(savedQTextNotebook, 0);
    interactions.push(await exerciseSavedQTextPresentation(
      cdpPort,
      'Saved qText preview',
      async () => {
        screenshots.push(await captureScreenshot(
          artifactDirectory,
          'dark-qtext-opt-in.png',
          screenSize,
          {
            theme: DARK_THEME,
            caseId: 'saved-qtext',
            widthMode: 'wide',
            interaction: 'qtext-opt-in-highlighting-formatting-and-copy-status',
          }
        ));
      }
    ));
    await discardActiveVisualNotebook();
    darkLiveNotebook = await openLiveGalleryNotebook(
      liveQueries[caseIndex(liveQueries, 'live-full-result')]
    );
    const darkLiveEditor = await vscode.window.showNotebookDocument(darkLiveNotebook, {
      preserveFocus: false,
      preview: false,
      viewColumn: vscode.ViewColumn.One,
    });
    assertLiveCase(
      liveQueries[caseIndex(liveQueries, 'live-full-result')],
      await executeOneLiveGalleryCase(
        darkLiveNotebook,
        darkLiveEditor,
        liveQueries[caseIndex(liveQueries, 'live-full-result')]
      )
    );
    await showNotebookCase(darkLiveNotebook, 0);
    screenshots.push(await captureScreenshot(
      artifactDirectory,
      'dark-table.png',
      screenSize,
      { theme: DARK_THEME, caseId: 'live-full-result', widthMode: 'wide' }
    ));
    await discardActiveVisualNotebook();

    // Two real editor groups constrain the notebook output without changing its DOM
    // or injecting test CSS. This is the narrow responsive acceptance state.
    darkLiveNotebook = await openLiveGalleryNotebook(fullResultFixture);
    const narrowLiveEditor = await vscode.window.showNotebookDocument(darkLiveNotebook, {
      preserveFocus: false,
      preview: false,
      viewColumn: vscode.ViewColumn.One,
    });
    assertLiveCase(
      fullResultFixture,
      await executeOneLiveGalleryCase(darkLiveNotebook, narrowLiveEditor, fullResultFixture)
    );
    const reopenedSavedPreview = await openTrackedSavedPreviewAfterReopen(1);
    truncatedPreviewNotebook = reopenedSavedPreview.notebook;
    interactions.push(reopenedSavedPreview.evidence);
    const narrowEditor = await vscode.window.showNotebookDocument(
      truncatedPreviewNotebook,
      {
        preserveFocus: false,
        preview: false,
        viewColumn: vscode.ViewColumn.Beside,
      }
    );
    narrowEditor.selections = [new vscode.NotebookRange(1, 2)];
    narrowEditor.revealRange(
      new vscode.NotebookRange(1, 2),
      vscode.NotebookEditorRevealType.InCenter
    );
    await settleRenderer();
    screenshots.push(await captureScreenshot(
      artifactDirectory,
      'narrow-table.png',
      screenSize,
      { theme: DARK_THEME, caseId: 'truncated-saved-preview', widthMode: 'split-editor' }
    ));
    interactions.push(await assertNarrowLayout(cdpPort));
    await discardActiveVisualNotebook();

    narrowChartNotebook = await openSavedCaseNotebook(
      savedCases[caseIndex(savedCases, 'chart-line')]
    );
    const narrowChartEditor = await vscode.window.showNotebookDocument(narrowChartNotebook, {
      preserveFocus: false,
      preview: false,
      viewColumn: vscode.ViewColumn.Beside,
    });
    narrowChartEditor.selections = [new vscode.NotebookRange(0, 1)];
    narrowChartEditor.revealRange(
      new vscode.NotebookRange(0, 1),
      vscode.NotebookEditorRevealType.InCenter
    );
    await settleRenderer();
    const narrowChartRenderer = await connectNotebookRenderer(cdpPort, 'Line chart gallery');
    try {
      await scrollNotebookChartIntoView(narrowChartRenderer, cdpPort);
      const narrowChartEvidence = await assertNarrowChartOverlay(narrowChartRenderer);
      interactions.push(narrowChartEvidence);
      screenshots.push(await captureScreenshot(
        artifactDirectory,
        'narrow-chart-overlay.png',
        screenSize,
        {
          theme: DARK_THEME,
          caseId: 'chart-line',
          widthMode: 'split-editor',
          interaction: 'narrow-saved-chart-y-series-overlay',
          acceptance: narrowChartEvidence.overlay,
        }
      ));
    } finally {
      narrowChartRenderer.close();
    }
    await discardActiveVisualNotebook();

    // Execute the rest of the live contract after capture so transient output
    // webviews cannot invalidate the visual evidence under Electron/Xvfb.
    contractNotebook = await openLiveGalleryNotebook();
    const contractEditor = await vscode.window.showNotebookDocument(contractNotebook, {
      preserveFocus: false,
      preview: false,
      viewColumn: vscode.ViewColumn.One,
    });
    liveCaseEvidence = await executeLiveGallery(contractNotebook, contractEditor);
    assertLiveGallery(contractNotebook, liveCaseEvidence);
    await discardActiveVisualNotebook();
    console.log('Notebook visual stage: complete live gallery executed');

    const restartSurfaces = await exercisePreReloadColumnSizing(
      cdpPort,
      resultConfiguration
    );
    interactions.push({
      name: 'ordinary-positional-widths-before-restart',
      ...restartSurfaces.ordinary,
    });
    interactions.push({
      name: 'notebook-positional-widths-before-restart',
      ...restartSurfaces.notebook,
    });
    const persistedBeforeReload = normalizedWidthMap(
      currentResultSetting('viewer.columnWidths')
    );
    assert.deepStrictEqual(
      persistedBeforeReload,
      RESTART_WIDTHS_BY_POSITION,
      'canonical positional widths must be durable before reload'
    );

    const galleryReport = {
      version: 1,
      vscodeVersion: vscode.version,
      display: process.env.DISPLAY,
      screenSize,
      galleryCaseIds: galleryCaseIds(),
      requiredCaseIds: expectedCaseIds,
      executedLiveCases: liveCaseEvidence,
      liveResult: liveResultRecord,
      interactions,
      screenshots,
      chartEvidence: {
        live:
          'The live full-result handle rendered and exercised chart configuration/control persistence against extension-side data.',
        saved:
          'Light/dark chart screenshots and zoom/hidden-series persistence use bounded portable data; all six saved chart families rendered actual canvases with valid PNG data URLs.',
      },
      lifecycleBoundary:
        'Live cells were executed against the private loopback q process. A file-backed copy of the tracked bounded .ipynb preview was saved, closed, and reopened before capture; it contains no omitted rows.',
      nonAutomatedBoundaries: visualInteractionBoundaries(),
    };
    const phaseOne = {
      version: 1,
      complete: true,
      reloadCommand: 'workbench.action.reloadWindow',
      reloadCommandIssued: true,
      profilePath,
      extensionHostPid: process.pid,
      widthsByPosition: persistedBeforeReload,
      surfaces: restartSurfaces,
      galleryReport,
    };
    writeJsonAtomic(
      path.join(artifactDirectory, 'visual-phase-1.json'),
      phaseOne
    );
    console.log(
      `KX notebook visual phase 1 captured ${screenshots.length} screenshots and ` +
      `persisted widths ${JSON.stringify(persistedBeforeReload)}`
    );
    const markerValue = {
      version: 1,
      phaseOneComplete: true,
      reloadCommand: 'workbench.action.reloadWindow',
      reloadCommandIssued: true,
      profilePath,
      extensionHostPid: process.pid,
      widthsByPosition: persistedBeforeReload,
      resultSettingsSnapshot: previousResultColumnSettings,
      workbenchSettingsSnapshot: previousTheme,
      previousActiveConnectionId,
      connectionId: VISUAL_CONNECTION_ID,
      qPort,
    };
    writeJsonAtomic(restartMarkerPath, markerValue);
    preserveForReload = true;
    try {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    } catch (error) {
      if (!isReloadCancellation(error)) {
        preserveForReload = false;
        removeFileIfPresent(restartMarkerPath);
        throw error;
      }
      writeJsonAtomic(restartMarkerPath, {
        ...markerValue,
        reloadPromiseCancellation: {
          name: error.name,
          message: error.message,
        },
      });
      throw error;
    }
    await new Promise(() => {});
  } finally {
    if (!preserveForReload) {
      try {
        await cleanupVisualProfile({
          resultConfiguration,
          resultSettingsSnapshot: previousResultColumnSettings,
          testApi,
          workbenchConfiguration,
          workbenchSettingsSnapshot: previousTheme,
          previousActiveConnectionId,
          removeVisualConnection: visualConnectionAdded,
        });
      } finally {
        removeFileIfPresent(restartMarkerPath);
      }
    }
  }
}

function snapshotGlobalConfiguration(configuration, keys) {
  return keys.map(key => {
    const globalValue = configuration.inspect(key)?.globalValue;
    return {
      key,
      hadGlobalValue: globalValue !== undefined,
      ...(globalValue === undefined
        ? {}
        : { globalValue: cloneConfigurationValue(globalValue) }),
    };
  });
}

async function cleanupVisualProfile({
  resultConfiguration,
  resultSettingsSnapshot,
  testApi,
  workbenchConfiguration,
  workbenchSettingsSnapshot,
  previousActiveConnectionId,
  removeVisualConnection = true,
}) {
  const failures = [];
  await restoreGlobalConfiguration(
    resultConfiguration,
    resultSettingsSnapshot,
    'result setting',
    failures
  );
  await restoreGlobalConfiguration(
    workbenchConfiguration,
    workbenchSettingsSnapshot,
    'workbench setting',
    failures
  );
  try {
    if (removeVisualConnection && testApi.connection(VISUAL_CONNECTION_ID)) {
      await testApi.removeConnection(VISUAL_CONNECTION_ID);
    }
  } catch (error) {
    failures.push(error);
  }
  try {
    await testApi.setActiveConnection(previousActiveConnectionId);
  } catch (error) {
    failures.push(error);
  }
  if (removeVisualConnection) {
    try {
      assert.strictEqual(
        testApi.connection(VISUAL_CONNECTION_ID),
        undefined,
        'visual connection fixture must be removed after acceptance'
      );
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    assert.strictEqual(
      testApi.activeConnectionId(),
      previousActiveConnectionId,
      'active connection fixture must be restored after acceptance'
    );
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `visual profile cleanup failed in ${failures.length} operation(s)`
    );
  }
}

async function restoreGlobalConfiguration(
  configuration,
  snapshot,
  label,
  failures
) {
  if (!Array.isArray(snapshot)) {
    failures.push(new Error(`${label} snapshot must be an array`));
    return;
  }
  for (const entry of snapshot) {
    try {
      assert(entry && typeof entry.key === 'string', `invalid ${label} snapshot`);
      await configuration.update(
        entry.key,
        entry.hadGlobalValue
          ? cloneConfigurationValue(entry.globalValue)
          : undefined,
        vscode.ConfigurationTarget.Global
      );
    } catch (error) {
      failures.push(error);
    }
  }
  for (const entry of snapshot) {
    try {
      assertGlobalConfigurationRestored(configuration, [entry]);
    } catch (error) {
      failures.push(error);
    }
  }
}

function cloneConfigurationValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

async function exercisePreReloadColumnSizing(cdpPort, resultConfiguration) {
  await configureColumnSizingAcceptance(resultConfiguration, {
    autoFitColumns: false,
  });
  const ordinary = await exerciseOrdinaryRestartWidths(
    cdpPort,
    RESTART_COLUMN_SIZING_FIXTURES.phaseOne,
    RESTART_COLUMN_SIZING_FIXTURES.renamed
  );

  await configureColumnSizingAcceptance(resultConfiguration, {
    autoFitColumns: false,
  });
  const notebook = await exerciseNotebookRestartWidths(
    cdpPort,
    RESTART_COLUMN_SIZING_FIXTURES.phaseOne,
    RESTART_COLUMN_SIZING_FIXTURES.renamed
  );

  await waitFor(
    'canonical positional widths before reload',
    () => widthMapsEqual(
      currentResultSetting('viewer.columnWidths'),
      RESTART_WIDTHS_BY_POSITION
    ),
    8_000
  );
  return { ordinary, notebook };
}

async function exerciseOrdinaryRestartWidths(
  cdpPort,
  initialFixture,
  recreatedFixture
) {
  let initial;
  let recreated;
  try {
    initial = await openOrdinaryColumnSizingFixture(cdpPort, initialFixture);
    await waitForRenderer(
      'ordinary restart fixture fixed baseline',
      initial.renderer,
      ordinaryColumnSizingSnapshot,
      value => snapshotHasHeaders(value, initialFixture.headers) &&
        snapshotAllColumnsHaveWidth(value, 160)
    );
    await dragOrdinaryColumnToWidth(initial.renderer, 0, RESTART_WIDTHS_BY_POSITION[0]);
    await dragOrdinaryColumnToWidth(initial.renderer, 2, RESTART_WIDTHS_BY_POSITION[2]);
    const afterDrag = await waitForRenderer(
      'ordinary real first/later drag widths',
      initial.renderer,
      ordinaryColumnSizingSnapshot,
      value => snapshotHasManualWidths(value, RESTART_WIDTHS_BY_POSITION)
    );
    await waitFor(
      'ordinary real first/later persisted width map',
      () => widthMapsEqual(
        currentResultSetting('viewer.columnWidths'),
        RESTART_WIDTHS_BY_POSITION
      ),
      8_000
    );

    await initial.renderer.evaluate(
      scrollOrdinaryGridToRow,
      COLUMN_SIZING_WIDEST_ROW
    );
    const afterVirtualScroll = await waitForRenderer(
      'ordinary first/later widths after virtual scroll',
      initial.renderer,
      ordinaryColumnSizingSnapshot,
      value => value.renderedRows.includes(COLUMN_SIZING_WIDEST_ROW) &&
        snapshotHasManualWidths(value, RESTART_WIDTHS_BY_POSITION)
    );

    await closeOrdinaryColumnSizingFixture(initial);
    initial = undefined;
    recreated = await openOrdinaryColumnSizingFixture(cdpPort, recreatedFixture);
    const recreatedSnapshot = await waitForRenderer(
      'ordinary renamed-schema positional widths',
      recreated.renderer,
      ordinaryColumnSizingSnapshot,
      value => snapshotHasHeaders(value, recreatedFixture.headers) &&
        snapshotHasManualWidths(value, RESTART_WIDTHS_BY_POSITION)
    );
    assert.notDeepStrictEqual(
      recreatedSnapshot.headers,
      afterDrag.headers,
      'ordinary recreation must use renamed, different-schema columns'
    );
    return {
      draggedPositions: [0, 2],
      afterDrag,
      afterVirtualScroll,
      recreated: recreatedSnapshot,
    };
  } finally {
    await closeOrdinaryColumnSizingFixture(recreated).catch(() => undefined);
    await closeOrdinaryColumnSizingFixture(initial).catch(() => undefined);
  }
}

async function exerciseNotebookRestartWidths(
  cdpPort,
  initialFixture,
  recreatedFixture
) {
  let notebook;
  let renderer;
  try {
    ({ notebook, renderer } = await openColumnSizingNotebook(
      cdpPort,
      initialFixture
    ));
    await waitForRenderer(
      'notebook restart fixture fixed baseline',
      renderer,
      notebookColumnSizingSnapshot,
      value => snapshotHasHeaders(value, initialFixture.headers) &&
        snapshotAllColumnsHaveWidth(value, 160)
    );
    await dragNotebookColumnToWidth(renderer, 0, RESTART_WIDTHS_BY_POSITION[0]);
    await dragNotebookColumnToWidth(renderer, 2, RESTART_WIDTHS_BY_POSITION[2]);
    const afterDrag = await waitForRenderer(
      'notebook real first/later drag widths',
      renderer,
      notebookColumnSizingSnapshot,
      value => snapshotHasManualWidths(value, RESTART_WIDTHS_BY_POSITION)
    );
    await waitFor(
      'notebook real first/later persisted width map',
      () => widthMapsEqual(
        currentResultSetting('viewer.columnWidths'),
        RESTART_WIDTHS_BY_POSITION
      ),
      8_000
    );

    await renderer.evaluate(
      scrollNotebookGridToRow,
      COLUMN_SIZING_WIDEST_ROW
    );
    const afterVirtualScroll = await waitForRenderer(
      'notebook first/later widths after virtual scroll',
      renderer,
      notebookColumnSizingSnapshot,
      value => value.renderedRows.includes(COLUMN_SIZING_WIDEST_ROW) &&
        snapshotHasManualWidths(value, RESTART_WIDTHS_BY_POSITION)
    );

    renderer.close();
    renderer = undefined;
    await discardActiveVisualNotebook();
    notebook = undefined;
    ({ notebook, renderer } = await openColumnSizingNotebook(
      cdpPort,
      recreatedFixture
    ));
    const recreatedSnapshot = await waitForRenderer(
      'notebook renamed-schema positional widths',
      renderer,
      notebookColumnSizingSnapshot,
      value => snapshotHasHeaders(value, recreatedFixture.headers) &&
        snapshotHasManualWidths(value, RESTART_WIDTHS_BY_POSITION)
    );
    assert.notDeepStrictEqual(
      recreatedSnapshot.headers,
      afterDrag.headers,
      'notebook recreation must use renamed, different-schema columns'
    );
    return {
      draggedPositions: [0, 2],
      afterDrag,
      afterVirtualScroll,
      recreated: recreatedSnapshot,
    };
  } finally {
    renderer?.close();
    if (notebook && !notebook.isClosed) {
      await vscode.window.showNotebookDocument(notebook, {
        preserveFocus: false,
        preview: false,
        viewColumn: vscode.ViewColumn.One,
      }).catch(() => undefined);
      await discardActiveVisualNotebook().catch(() => undefined);
    }
  }
}

async function runPostReloadColumnSizing({
  artifactDirectory,
  cdpPort,
  profilePath,
  qPort,
  restartMarker,
  restartMarkerPath,
  resultConfiguration,
  testApi,
  workbenchConfiguration,
}) {
  let markerValidated = false;
  let phaseOne;
  let connection;
  let activeConnectionBeforeOpen;
  let persistedBeforeOpen;
  let restartEvidence;
  try {
    validateRestartMarker(restartMarker, profilePath, qPort);
    markerValidated = true;
    assert.notStrictEqual(
      process.pid,
      restartMarker.extensionHostPid,
      'phase 2 must run in a different Extension Host process'
    );
    phaseOne = readRequiredJson(
      path.join(artifactDirectory, 'visual-phase-1.json'),
      'visual phase-1 evidence'
    );
    assert.strictEqual(phaseOne.complete, true);
    assert.strictEqual(phaseOne.extensionHostPid, restartMarker.extensionHostPid);
    assert.deepStrictEqual(
      normalizedWidthMap(phaseOne.widthsByPosition),
      RESTART_WIDTHS_BY_POSITION
    );

    connection = testApi.connection(VISUAL_CONNECTION_ID);
    assert(connection, 'visual q connection must survive in the persisted profile');
    assert.strictEqual(connection.host, '127.0.0.1');
    assert.strictEqual(connection.port, qPort);
    activeConnectionBeforeOpen = testApi.activeConnectionId();
    persistedBeforeOpen = normalizedWidthMap(
      resultConfiguration.get('viewer.columnWidths')
    );
    assert.deepStrictEqual(
      persistedBeforeOpen,
      RESTART_WIDTHS_BY_POSITION,
      'global positional widths must survive before either phase-2 surface opens'
    );
    await testApi.setActiveConnection(VISUAL_CONNECTION_ID);

    const ordinary = await inspectOrdinaryWidthsAfterReload(
      cdpPort,
      RESTART_COLUMN_SIZING_FIXTURES.reloaded
    );
    const notebook = await inspectNotebookWidthsAfterReload(
      cdpPort,
      RESTART_COLUMN_SIZING_FIXTURES.reloaded
    );
    const controls = await exercisePostReloadSizingControls(
      cdpPort,
      resultConfiguration,
      RESTART_COLUMN_SIZING_FIXTURES.reloaded
    );
    restartEvidence = {
      ordinary,
      notebook,
      controls,
    };
  } finally {
    try {
      if (markerValidated) {
        await cleanupVisualProfile({
          resultConfiguration,
          resultSettingsSnapshot: restartMarker.resultSettingsSnapshot,
          testApi,
          workbenchConfiguration,
          workbenchSettingsSnapshot: restartMarker.workbenchSettingsSnapshot,
          previousActiveConnectionId: restartMarker.previousActiveConnectionId,
        });
      }
    } finally {
      removeFileIfPresent(restartMarkerPath);
    }
  }

  const phaseTwo = {
    version: 1,
    complete: true,
    profilePath,
    extensionHostPid: process.pid,
    persistedBeforeOpen,
    persistedConnectionBeforeOpen: {
      id: connection.id,
      name: connection.name,
      host: connection.host,
      port: connection.port,
      activeConnectionId: activeConnectionBeforeOpen,
    },
    surfaces: {
      ordinary: restartEvidence.ordinary,
      notebook: restartEvidence.notebook,
    },
    controls: restartEvidence.controls,
    settingsRestored: true,
    profileFixturesRestored: true,
  };
  writeJsonAtomic(
    path.join(artifactDirectory, 'visual-phase-2.json'),
    phaseTwo
  );
  const galleryReport = phaseOne.galleryReport;
  assert(galleryReport && Array.isArray(galleryReport.interactions),
    'phase-1 gallery report is missing');
  const finalReport = {
    ...galleryReport,
    interactions: [
      ...galleryReport.interactions,
      {
        name: 'ordinary-positional-widths-after-restart',
        ...phaseTwo.surfaces.ordinary,
      },
      {
        name: 'notebook-positional-widths-after-restart',
        ...phaseTwo.surfaces.notebook,
      },
      {
        name: 'post-restart-column-sizing-controls',
        ...phaseTwo.controls,
      },
    ],
    restartAcceptance: {
      version: 1,
      phaseOne,
      phaseTwo,
    },
  };
  writeJsonAtomic(
    path.join(artifactDirectory, 'visual-report.json'),
    finalReport
  );
  console.log(
    `KX notebook visual phase 2 restored widths ` +
    `${JSON.stringify(persistedBeforeOpen)} in both real surfaces`
  );
}

async function inspectOrdinaryWidthsAfterReload(cdpPort, fixture) {
  let handle;
  try {
    handle = await openOrdinaryColumnSizingFixture(cdpPort, fixture);
    const reopened = await waitForRenderer(
      'ordinary positional widths after real restart',
      handle.renderer,
      ordinaryColumnSizingSnapshot,
      value => snapshotHasHeaders(value, fixture.headers) &&
        snapshotHasManualWidths(value, RESTART_WIDTHS_BY_POSITION)
    );
    await handle.renderer.evaluate(
      scrollOrdinaryGridToRow,
      COLUMN_SIZING_WIDEST_ROW
    );
    const afterVirtualScroll = await waitForRenderer(
      'ordinary positional widths after restart virtual scroll',
      handle.renderer,
      ordinaryColumnSizingSnapshot,
      value => value.renderedRows.includes(COLUMN_SIZING_WIDEST_ROW) &&
        snapshotHasManualWidths(value, RESTART_WIDTHS_BY_POSITION)
    );
    return { reopened, afterVirtualScroll };
  } finally {
    await closeOrdinaryColumnSizingFixture(handle).catch(() => undefined);
  }
}

async function inspectNotebookWidthsAfterReload(cdpPort, fixture) {
  let notebook;
  let renderer;
  try {
    ({ notebook, renderer } = await openColumnSizingNotebook(cdpPort, fixture));
    const reopened = await waitForRenderer(
      'notebook positional widths after real restart',
      renderer,
      notebookColumnSizingSnapshot,
      value => snapshotHasHeaders(value, fixture.headers) &&
        snapshotHasManualWidths(value, RESTART_WIDTHS_BY_POSITION)
    );
    await renderer.evaluate(
      scrollNotebookGridToRow,
      COLUMN_SIZING_WIDEST_ROW
    );
    const afterVirtualScroll = await waitForRenderer(
      'notebook positional widths after restart virtual scroll',
      renderer,
      notebookColumnSizingSnapshot,
      value => value.renderedRows.includes(COLUMN_SIZING_WIDEST_ROW) &&
        snapshotHasManualWidths(value, RESTART_WIDTHS_BY_POSITION)
    );
    return { reopened, afterVirtualScroll };
  } finally {
    renderer?.close();
    if (notebook && !notebook.isClosed) {
      await vscode.window.showNotebookDocument(notebook, {
        preserveFocus: false,
        preview: false,
        viewColumn: vscode.ViewColumn.One,
      }).catch(() => undefined);
      await discardActiveVisualNotebook().catch(() => undefined);
    }
  }
}

async function exercisePostReloadSizingControls(
  cdpPort,
  resultConfiguration,
  fixture
) {
  let handle;
  try {
    handle = await openOrdinaryColumnSizingFixture(cdpPort, fixture);
    const resetBefore = await waitForRenderer(
      'post-restart Reset columns baseline',
      handle.renderer,
      ordinaryColumnSizingSnapshot,
      value => snapshotHasManualWidths(value, RESTART_WIDTHS_BY_POSITION)
    );
    await handle.renderer.evaluate(resetOrdinaryColumnWidths);
    const resetAfter = await waitForRenderer(
      'post-restart Reset columns all-column fallback',
      handle.renderer,
      ordinaryColumnSizingSnapshot,
      value => snapshotAllColumnsHaveWidth(value, 160)
    );
    await waitFor(
      'post-restart Reset columns clears every override',
      () => widthMapsEqual(currentResultSetting('viewer.columnWidths'), {}),
      8_000
    );

    await dragOrdinaryColumnToWidth(handle.renderer, 0, RESTART_WIDTHS_BY_POSITION[0]);
    await dragOrdinaryColumnToWidth(handle.renderer, 2, RESTART_WIDTHS_BY_POSITION[2]);
    const densityBefore = await waitForRenderer(
      'post-restart density preset manual baseline',
      handle.renderer,
      ordinaryColumnSizingSnapshot,
      value => snapshotHasManualWidths(value, RESTART_WIDTHS_BY_POSITION)
    );
    await handle.renderer.evaluate(setOrdinaryDensity, 'comfortable');
    const comfortableWidth = resultConfiguration.get('comfortable.cellWidth');
    assert.strictEqual(comfortableWidth, 180);
    const densityAfter = await waitForRenderer(
      'post-restart density preset all-column width',
      handle.renderer,
      ordinaryColumnSizingSnapshot,
      value => value.density === 'comfortable' &&
        snapshotAllColumnsHaveWidth(value, comfortableWidth)
    );
    await waitFor(
      'post-restart density preset clears every override',
      () => widthMapsEqual(currentResultSetting('viewer.columnWidths'), {}),
      8_000
    );
    return {
      reset: {
        before: resetBefore,
        after: resetAfter,
        persistedAfter: {},
      },
      densityPreset: {
        before: densityBefore,
        after: densityAfter,
        persistedAfter: {},
      },
    };
  } finally {
    await closeOrdinaryColumnSizingFixture(handle).catch(() => undefined);
  }
}

async function configureColumnSizingAcceptance(configuration, options = {}) {
  const settings = [
    [
      'viewer.autoFitColumns',
      options.autoFitColumns === undefined ? true : options.autoFitColumns,
    ],
    [
      'viewer.autoFitMode',
      options.autoFitMode === 'visibleRows' ? 'visibleRows' : 'wholeResult',
    ],
    ['viewer.columnWidths', cloneConfigurationValue(options.columnWidths || {})],
    ['density', 'standard'],
    [
      'standard.cellWidth',
      Number.isSafeInteger(options.cellWidth) ? options.cellWidth : 160,
    ],
    ['comfortable.cellWidth', 180],
  ];
  for (const [key, value] of settings) {
    await configuration.update(key, value, vscode.ConfigurationTarget.Global);
  }
  const current = vscode.workspace.getConfiguration('vscode-kdb.results');
  assert.strictEqual(
    current.get('viewer.autoFitColumns'),
    settings[0][1],
    'column-sizing acceptance auto-fit setting did not persist'
  );
  assert.strictEqual(
    current.get('viewer.autoFitMode'),
    settings[1][1],
    'column-sizing acceptance auto-fit scope did not persist'
  );
  assert.deepStrictEqual(
    current.get('viewer.columnWidths'),
    settings[2][1],
    'column-sizing acceptance width map did not persist'
  );
}

async function exerciseOrdinaryResultColumnSizing(cdpPort, resultConfiguration) {
  let document;
  let renderer;
  let recreatedRenderer;
  try {
    document = await vscode.workspace.openTextDocument({
      language: 'q',
      content: COLUMN_SIZING_FIXTURE.source,
    });
    await vscode.window.showTextDocument(document, {
      preserveFocus: false,
      preview: false,
      viewColumn: vscode.ViewColumn.One,
    });
    await vscode.commands.executeCommand('vscode-kdb.runSelectionOrCurrentLine');
    renderer = await connectNotebookRenderer(cdpPort, 'acceptance_widest_list');

    const wholeResult = await waitForRenderer(
      'ordinary whole-result column sizing',
      renderer,
      ordinaryColumnSizingSnapshot,
      value => value.headers.join('|') ===
          'acceptance_row|acceptance_label|acceptance_widest_list' &&
        value.autoFit &&
        value.autoFitMode === 'wholeResult' &&
        value.widths.length === 3 &&
        value.widths[2] >= 400 &&
        value.firstRowWidths.every((width, index) =>
          Math.abs(width - value.widths[index]) <= 1)
    );

    await renderer.evaluate(scrollOrdinaryGridToRow, COLUMN_SIZING_WIDEST_ROW);
    const wholeResultAfterScroll = await waitForRenderer(
      'ordinary whole-result virtual scroll stability',
      renderer,
      ordinaryColumnSizingSnapshot,
      value => value.renderedRows.includes(COLUMN_SIZING_WIDEST_ROW) &&
        Math.abs(value.widths[2] - wholeResult.widths[2]) <= 1
    );

    await resultConfiguration.update(
      'viewer.autoFitMode',
      'visibleRows',
      vscode.ConfigurationTarget.Global
    );
    await renderer.evaluate(scrollOrdinaryGridToRow, 0);
    const visibleRowsNarrow = await waitForRenderer(
      'ordinary visible-row narrow sizing',
      renderer,
      ordinaryColumnSizingSnapshot,
      value => value.autoFitMode === 'visibleRows' &&
        value.renderedRows.includes(0) &&
        value.widths[2] + 80 < wholeResult.widths[2]
    );
    await renderer.evaluate(scrollOrdinaryGridToRow, COLUMN_SIZING_WIDEST_ROW);
    const visibleRowsWide = await waitForRenderer(
      'ordinary visible-row adaptive sizing',
      renderer,
      ordinaryColumnSizingSnapshot,
      value => value.renderedRows.includes(COLUMN_SIZING_WIDEST_ROW) &&
        value.widths[2] > visibleRowsNarrow.widths[2] + 80
    );

    await resultConfiguration.update(
      'viewer.autoFitColumns',
      false,
      vscode.ConfigurationTarget.Global
    );
    const autoFitDisabled = await waitForRenderer(
      'ordinary unchecked auto-fit sizing',
      renderer,
      ordinaryColumnSizingSnapshot,
      value => !value.autoFit &&
        value.widths.length === 3 &&
        value.widths.every(width => Math.abs(width - 160) <= 1)
    );

    const drag = await renderer.evaluate(ordinaryResizeHandlePoint, 0);
    assert(drag?.point, 'ordinary first-column resize handle must render');
    const expectedManualWidth = drag.startWidth + 96;
    await renderer.drag(
      drag.point.x,
      drag.point.y,
      drag.point.x + 96,
      drag.point.y
    );
    const ordinaryResizeFinish = await renderer.evaluate(
      finishPendingColumnResize
    );
    const manualFirstColumn = await waitForRenderer(
      'ordinary first-column drag persistence',
      renderer,
      ordinaryColumnSizingSnapshot,
      value => Math.abs(value.widths[0] - expectedManualWidth) <= 2 &&
        value.renderedFirstColumnWidths.length > 0 &&
        value.renderedFirstColumnWidths.every(width =>
          Math.abs(width - value.widths[0]) <= 1)
    );
    let ordinaryPersistedWidths;
    try {
      await waitFor(
        'ordinary persisted first-column width map',
        () => {
          ordinaryPersistedWidths =
            currentResultSetting('viewer.columnWidths');
          return isSparseWidthMap(ordinaryPersistedWidths) &&
            Math.abs(
              ordinaryPersistedWidths['0'] - expectedManualWidth
            ) <= 2;
        },
        8_000
      );
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; ` +
        `actual=${JSON.stringify(ordinaryPersistedWidths)}, ` +
        `expected=${expectedManualWidth}, finish=${JSON.stringify(
          ordinaryResizeFinish
        )}`
      );
    }

    await renderer.evaluate(scrollOrdinaryGridToRow, 0);
    const manualAfterVirtualScroll = await waitForRenderer(
      'ordinary manual width virtual scroll stability',
      renderer,
      ordinaryColumnSizingSnapshot,
      value => value.renderedRows.includes(0) &&
        Math.abs(value.widths[0] - expectedManualWidth) <= 2 &&
        Math.abs(value.firstRowWidths[0] - expectedManualWidth) <= 2
    );

    renderer.close();
    renderer = undefined;
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await vscode.window.showTextDocument(document, {
      preserveFocus: false,
      preview: false,
      viewColumn: vscode.ViewColumn.One,
    });
    await vscode.commands.executeCommand('vscode-kdb.runSelectionOrCurrentLine');
    recreatedRenderer = await connectNotebookRenderer(
      cdpPort,
      'acceptance_widest_list'
    );
    const recreated = await waitForRenderer(
      'ordinary panel recreation width persistence',
      recreatedRenderer,
      ordinaryColumnSizingSnapshot,
      value => !value.autoFit &&
        Math.abs(value.widths[0] - expectedManualWidth) <= 2
    );

    await recreatedRenderer.evaluate(setOrdinaryCellWidth, 190);
    const allColumnPreset = await waitForRenderer(
      'ordinary all-column Cell width preset',
      recreatedRenderer,
      ordinaryColumnSizingSnapshot,
      value => !value.autoFit &&
        value.widths.length === 3 &&
        snapshotAllColumnsHaveWidth(value, 190)
    );
    await waitFor(
      'ordinary Cell width preset clears sparse overrides',
      () => {
        const widths = currentResultSetting('viewer.columnWidths');
        return isSparseWidthMap(widths) &&
          Object.keys(widths).length === 0 &&
          currentResultSetting('standard.cellWidth') === 190;
      },
      8_000
    );

    return {
      name: 'ordinary-real-runtime-column-sizing',
      wholeResult: {
        beforeScroll: wholeResult,
        afterScroll: wholeResultAfterScroll,
      },
      visibleRows: {
        narrow: visibleRowsNarrow,
        widestRow: visibleRowsWide,
      },
      autoFitDisabled,
      manualFirstColumn,
      manualAfterVirtualScroll,
      recreated,
      allColumnPreset,
      persistedShape: 'sparse-map',
    };
  } finally {
    recreatedRenderer?.close();
    renderer?.close();
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
      .catch(() => undefined);
    if (document && !document.isClosed) {
      await vscode.window.showTextDocument(document, {
        preserveFocus: false,
        preview: false,
        viewColumn: vscode.ViewColumn.One,
      }).catch(() => undefined);
      await vscode.commands.executeCommand(
        'workbench.action.revertAndCloseActiveEditor'
      ).catch(() => undefined);
    }
    await configureColumnSizingAcceptance(resultConfiguration)
      .catch(() => undefined);
  }
}

async function exerciseOrdinaryResultChartLifecycle(cdpPort) {
  let handle;
  try {
    handle = await openOrdinaryColumnSizingFixture(
      cdpPort,
      ORDINARY_CHART_LIFECYCLE_FIXTURE
    );
    const renderer = handle.renderer;
    await renderer.evaluate(installOrdinaryChartLifecycleProbe);
    await renderer.evaluate(root => {
      const view = root.ownerDocument.defaultView;
      const open = root.querySelector('#openChart');
      if (!(open instanceof view.HTMLButtonElement) || open.disabled) {
        throw new Error('ordinary Chart button is missing or disabled');
      }
      open.click();
      return true;
    });
    await waitForRenderer(
      'ordinary chart options',
      renderer,
      root => ({
        panelVisible: root.querySelector('#chartPanel')?.hidden === false,
        xColumns: [...root.querySelectorAll('#chartXColumn option')]
          .map(option => option.value),
        yColumns: [...root.querySelectorAll('#chartYColumns input')]
          .map(input => input.value),
      }),
      value => value.panelVisible &&
        value.xColumns.includes('ordinary_zoom_x') &&
        value.yColumns.includes('ordinary_zoom_y')
    );
    await renderer.evaluate(root => {
      const view = root.ownerDocument.defaultView;
      const chartType = root.querySelector('#chartType');
      const xColumn = root.querySelector('#chartXColumn');
      const render = root.querySelector('#renderChart');
      if (!(chartType instanceof view.HTMLSelectElement) ||
        !(xColumn instanceof view.HTMLSelectElement) ||
        !(render instanceof view.HTMLButtonElement)) {
        throw new Error('ordinary chart controls are unavailable');
      }
      chartType.value = 'line';
      chartType.dispatchEvent(new view.Event('change', { bubbles: true }));
      xColumn.value = 'ordinary_zoom_x';
      xColumn.dispatchEvent(new view.Event('change', { bubbles: true }));
      let selectedY = false;
      root.querySelectorAll('#chartYColumns input').forEach(input => {
        const checked = input.value === 'ordinary_zoom_y';
        if (input.checked !== checked) {
          input.checked = checked;
          input.dispatchEvent(new view.Event('change', { bubbles: true }));
        }
        selectedY ||= checked;
      });
      if (!selectedY || render.disabled) {
        throw new Error('ordinary chart line selection is not renderable');
      }
      render.click();
      return {
        chartType: chartType.value,
        xColumn: xColumn.value,
        yColumns: [...root.querySelectorAll('#chartYColumns input:checked')]
          .map(input => input.value),
      };
    });

    const baseline = await waitForRenderer(
      'ordinary full chart host response and uPlot reconstruction',
      renderer,
      ordinaryChartLifecycleSnapshot,
      value => value.hostChartDataResponseCount === 1 &&
        value.hostChartErrorCount === 0 &&
        value.uPlotBuildCount >= 1 &&
        value.plot.currentMatchesLatestResponse &&
        value.plot.currentMatchesFullResponse &&
        value.fullResponseStoredUnchanged &&
        sameNumericRange(value.plot.range, ORDINARY_CHART_LIFECYCLE_FIXTURE.fullRange),
      15_000
    );
    assert.strictEqual(
      baseline.responses[0].sourceRowCount,
      ORDINARY_CHART_LIFECYCLE_FIXTURE.rowCount
    );
    assert.strictEqual(
      baseline.responses[0].eligibleRowCount,
      ORDINARY_CHART_LIFECYCLE_FIXTURE.rowCount
    );
    assert.deepStrictEqual(
      baseline.responses[0].xDomain,
      ORDINARY_CHART_LIFECYCLE_FIXTURE.fullRange
    );
    // Let the completed draw/ResizeObserver work settle before beginning a
    // trusted gesture; this keeps the acceptance on the user-input lifecycle.
    await delay(750);

    const firstDrag = await dragOrdinaryChartRange(
      renderer,
      0.05,
      0.95,
      baseline
    );
    const firstExpectedDomain = integerDomainForRange(
      firstDrag.requestedRange,
      ORDINARY_CHART_LIFECYCLE_FIXTURE.fullRange
    );
    const first = await waitForRenderer(
      'ordinary first drag debounce, host response, and reconstruction',
      renderer,
      ordinaryChartLifecycleSnapshot,
      value => value.hostChartDataResponseCount === 2 &&
        value.hostChartErrorCount === 0 &&
        value.uPlotBuildCount > baseline.uPlotBuildCount &&
        value.plot.currentMatchesLatestResponse &&
        value.fullResponseStoredUnchanged &&
        sameNumericRange(value.plot.range, firstDrag.requestedRange),
      15_000
    );
    assertOrdinaryRangedChartResponse(
      first.responses[1],
      firstExpectedDomain,
      ORDINARY_CHART_LIFECYCLE_FIXTURE.rowCount,
      'ordinary first drag'
    );
    assert.notStrictEqual(
      first.responses[1].sampledPointCount,
      baseline.responses[0].sampledPointCount,
      'ordinary first drag must change the reconstructed sample count'
    );

    const secondDrag = await dragOrdinaryChartRange(
      renderer,
      0.35,
      0.65,
      first
    );
    const secondExpectedDomain = integerDomainForRange(
      secondDrag.requestedRange,
      ORDINARY_CHART_LIFECYCLE_FIXTURE.fullRange
    );
    const second = await waitForRenderer(
      'ordinary nested drag debounce, host response, and reconstruction',
      renderer,
      ordinaryChartLifecycleSnapshot,
      value => value.hostChartDataResponseCount === 3 &&
        value.hostChartErrorCount === 0 &&
        value.uPlotBuildCount > first.uPlotBuildCount &&
        value.plot.currentMatchesLatestResponse &&
        value.fullResponseStoredUnchanged &&
        sameNumericRange(value.plot.range, secondDrag.requestedRange),
      15_000
    );
    assertOrdinaryRangedChartResponse(
      second.responses[2],
      secondExpectedDomain,
      ORDINARY_CHART_LIFECYCLE_FIXTURE.rowCount,
      'ordinary nested drag'
    );
    assert(
      second.responses[2].eligibleRowCount < first.responses[1].eligibleRowCount,
      'ordinary nested drag must reduce the eligible source-row count'
    );
    assert(
      second.responses[2].sampledPointCount < first.responses[1].sampledPointCount,
      'ordinary nested drag must change the reconstructed sample count'
    );
    assert.strictEqual(
      second.nestedResponseIntroducedPoint,
      true,
      'ordinary nested reconstruction must contain full-source points absent from the first sample'
    );
    assert.notDeepStrictEqual(
      secondDrag.requestedRange,
      firstDrag.requestedRange,
      'ordinary nested drag must issue a distinct absolute range'
    );
    assert(
      secondDrag.requestedRange.min > firstDrag.requestedRange.min &&
        secondDrag.requestedRange.max < firstDrag.requestedRange.max,
      'ordinary second drag must be nested inside the first absolute range'
    );

    const responseCountBeforeReset = second.hostChartDataResponseCount;
    const plotBuildCountBeforeReset = second.uPlotBuildCount;
    await renderer.evaluate(root => {
      const view = root.ownerDocument.defaultView;
      const reset = root.querySelector('#resetChartZoom');
      if (!(reset instanceof view.HTMLButtonElement) || reset.disabled) {
        throw new Error('ordinary Reset zoom button is missing or disabled');
      }
      reset.click();
      return true;
    });
    const reset = await waitForRenderer(
      'ordinary Reset local full-sample reconstruction',
      renderer,
      ordinaryChartLifecycleSnapshot,
      value => value.hostChartDataResponseCount === responseCountBeforeReset &&
        value.hostChartErrorCount === 0 &&
        value.uPlotBuildCount > plotBuildCountBeforeReset &&
        value.plot.currentMatchesFullResponse &&
        value.fullResponseStoredUnchanged &&
        sameNumericRange(value.plot.range, ORDINARY_CHART_LIFECYCLE_FIXTURE.fullRange) &&
        value.chartStatus === 'Zoom reset to the original full data range.',
      8_000
    );
    assert.strictEqual(
      reset.plot.data.digest,
      baseline.plot.data.digest,
      'ordinary Reset must reconstruct the exact original full sample'
    );
    assert.strictEqual(
      reset.plot.data.pointCount,
      baseline.plot.data.pointCount,
      'ordinary Reset must restore the original full sample count'
    );

    return {
      name: 'ordinary-real-two-drag-chart-lifecycle',
      fixture: {
        rowCount: ORDINARY_CHART_LIFECYCLE_FIXTURE.rowCount,
        fullRange: ORDINARY_CHART_LIFECYCLE_FIXTURE.fullRange,
      },
      browserPath:
        'trusted CDP drag -> uPlot setScale hook -> 450ms debounce -> host chartData -> new uPlot reconstruction',
      baseline: ordinaryChartStageEvidence(baseline, 0),
      first: {
        drag: firstDrag,
        expectedEligibleDomain: firstExpectedDomain,
        ...ordinaryChartStageEvidence(first, 1),
      },
      second: {
        drag: secondDrag,
        expectedEligibleDomain: secondExpectedDomain,
        nestedResponseIntroducedPoint: second.nestedResponseIntroducedPoint,
        ...ordinaryChartStageEvidence(second, 2),
      },
      immutableFull: {
        sourceRowCount: baseline.responses[0].sourceRowCount,
        range: baseline.responses[0].xDomain,
        responseDigest: baseline.responses[0].digest,
        unchangedAfterFirst: first.fullResponseStoredUnchanged,
        unchangedAfterSecond: second.fullResponseStoredUnchanged,
        unchangedAfterReset: reset.fullResponseStoredUnchanged,
      },
      reset: {
        hostChartDataResponseCountBefore: responseCountBeforeReset,
        hostChartDataResponseCountAfter: reset.hostChartDataResponseCount,
        uPlotBuildCountBefore: plotBuildCountBeforeReset,
        uPlotBuildCountAfter: reset.uPlotBuildCount,
        range: reset.plot.range,
        data: reset.plot.data,
        matchesOriginalFullResponse: reset.plot.currentMatchesFullResponse,
        fullResponseStoredUnchanged: reset.fullResponseStoredUnchanged,
        chartStatus: reset.chartStatus,
      },
    };
  } finally {
    await closeOrdinaryColumnSizingFixture(handle).catch(() => undefined);
  }
}

function installOrdinaryChartLifecycleProbe(root) {
  const view = root.ownerDocument.defaultView;
  const key = '__kxOrdinaryChartLifecycleProbe';
  if (view[key]) {
    return true;
  }
  const OriginalUPlot = view.uPlot;
  if (typeof OriginalUPlot !== 'function') {
    throw new Error('ordinary chart uPlot constructor is unavailable');
  }
  const digestArrays = arrays => {
    let hash = 1469598103934665603n;
    const prime = 1099511628211n;
    const write = value => {
      const text = `${String(value)}\u0000`;
      for (let index = 0; index < text.length; index += 1) {
        hash ^= BigInt(text.charCodeAt(index));
        hash = BigInt.asUintN(64, hash * prime);
      }
    };
    arrays.forEach((values, arrayIndex) => {
      write(`array:${arrayIndex}:${values.length}`);
      values.forEach(write);
    });
    return hash.toString(16).padStart(16, '0');
  };
  const digestChartData = value => digestArrays([
    Array.isArray(value?.x) ? value.x : [],
    ...(Array.isArray(value?.series)
      ? value.series.map(series =>
        Array.isArray(series?.values) ? series.values : [])
      : []),
  ]);
  const digestAlignedData = value => digestArrays(
    Array.isArray(value)
      ? value.map(series => Array.isArray(series) ? series : [])
      : []
  );
  const cloneRange = value => value &&
    Number.isFinite(value.min) &&
    Number.isFinite(value.max)
    ? { min: value.min, max: value.max }
    : null;
  const probe = {
    OriginalUPlot,
    currentPlot: null,
    currentPlotId: 0,
    nextPlotId: 0,
    plotBuilds: [],
    scaleHooks: [],
    dataHooks: [],
    hookConfigurations: [],
    responses: [],
    errors: [],
    digestChartData,
    digestAlignedData,
    cloneRange,
  };
  const listener = event => {
    const message = event.data;
    if (message?.type === 'chartData' && message.data) {
      const data = message.data;
      const response = {
        requestId: Number(data.requestId),
        chartType: String(data.chartType || ''),
        sourceRowCount: Number(data.sourceRowCount),
        eligibleRowCount: Number(data.eligibleRowCount),
        sampledPointCount: Number(data.sampledPointCount),
        algorithm: String(data.algorithm || ''),
        xDomain: cloneRange(data.xDomain),
        x: Array.isArray(data.x) ? data.x.slice() : [],
        series: Array.isArray(data.series)
          ? data.series.map(series => ({
              columnName: String(series?.columnName || ''),
              values: Array.isArray(series?.values)
                ? series.values.slice()
                : [],
            }))
          : [],
        receivedAt: view.performance.now(),
      };
      response.receivedDigest = digestChartData(response);
      probe.responses.push(response);
    } else if (message?.type === 'chartError') {
      probe.errors.push({
        requestId: Number(message.requestId),
        message: String(message.message || ''),
        receivedAt: view.performance.now(),
      });
    }
  };
  view.addEventListener('message', listener, true);
  probe.listener = listener;

  function InstrumentedUPlot(options, data, target) {
    const plotId = ++probe.nextPlotId;
    const originalHooks = options?.hooks || {};
    probe.hookConfigurations.push({
      plotId,
      setScaleCount: Array.isArray(originalHooks.setScale)
        ? originalHooks.setScale.length
        : -1,
      setScaleNames: Array.isArray(originalHooks.setScale)
        ? originalHooks.setScale.map(hook => String(hook.name || ''))
        : [],
    });
    const hooks = { ...originalHooks };
    hooks.init = [
      ...(Array.isArray(originalHooks.init) ? originalHooks.init : []),
      self => {
        probe.currentPlot = self;
        probe.currentPlotId = plotId;
      },
    ];
    hooks.setScale = [
      ...(Array.isArray(originalHooks.setScale) ? originalHooks.setScale : []),
      (self, scaleKey) => {
        if (scaleKey !== 'x') {
          return;
        }
        probe.currentPlot = self;
        probe.currentPlotId = plotId;
        probe.scaleHooks.push({
          plotId,
          range: cloneRange(self.scales?.x),
          resetDisabled:
            root.querySelector('#resetChartZoom')?.disabled === true,
          refineDisabled:
            root.querySelector('#refineChartZoom')?.disabled === true,
          at: view.performance.now(),
        });
      },
    ];
    hooks.setData = [
      ...(Array.isArray(originalHooks.setData) ? originalHooks.setData : []),
      self => {
        probe.currentPlot = self;
        probe.currentPlotId = plotId;
        probe.dataHooks.push({
          plotId,
          pointCount: Array.isArray(self.data?.[0])
            ? self.data[0].length
            : 0,
          digest: digestAlignedData(self.data),
          at: view.performance.now(),
        });
      },
    ];
    hooks.ready = [
      ...(Array.isArray(originalHooks.ready) ? originalHooks.ready : []),
      self => {
        probe.currentPlot = self;
        probe.currentPlotId = plotId;
        probe.plotBuilds.push({
          plotId,
          pointCount: Array.isArray(self.data?.[0])
            ? self.data[0].length
            : 0,
          digest: digestAlignedData(self.data),
          range: cloneRange(self.scales?.x),
          at: view.performance.now(),
        });
      },
    ];
    return new OriginalUPlot({ ...options, hooks }, data, target);
  }
  Object.setPrototypeOf(InstrumentedUPlot, OriginalUPlot);
  InstrumentedUPlot.prototype = OriginalUPlot.prototype;
  view.uPlot = InstrumentedUPlot;
  view[key] = probe;
  return true;
}

function ordinaryChartLifecycleSnapshot(root) {
  const view = root.ownerDocument.defaultView;
  const probe = view.__kxOrdinaryChartLifecycleProbe;
  if (!probe) {
    throw new Error('ordinary chart lifecycle probe is missing');
  }
  const rangesEqual = (left, right) => !!left && !!right &&
    left.min === right.min &&
    left.max === right.max;
  const arraysEqual = (left, right) =>
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index]));
  const responseArrays = response => [
    response?.x || [],
    ...(response?.series || []).map(series => series.values || []),
  ];
  const alignedArrays = Array.isArray(probe.currentPlot?.data)
    ? probe.currentPlot.data.map(series => Array.isArray(series) ? series : [])
    : [];
  const responseSummary = response => ({
    requestId: response.requestId,
    chartType: response.chartType,
    sourceRowCount: response.sourceRowCount,
    eligibleRowCount: response.eligibleRowCount,
    sampledPointCount: response.sampledPointCount,
    algorithm: response.algorithm,
    xDomain: response.xDomain,
    firstX: response.x[0],
    lastX: response.x.at(-1),
    digest: probe.digestChartData(response),
    receivedDigest: response.receivedDigest,
    storedUnchanged:
      probe.digestChartData(response) === response.receivedDigest,
    receivedAt: response.receivedAt,
  });
  const fullResponse = probe.responses[0];
  const latestResponse = probe.responses.at(-1);
  const plotMatchesResponse = response => {
    const arrays = responseArrays(response);
    return arrays.length === alignedArrays.length &&
      arrays.every((values, index) => arraysEqual(values, alignedArrays[index]));
  };
  const firstRefinement = probe.responses[1];
  const nestedRefinement = probe.responses[2];
  const firstRefinementX = new Set(firstRefinement?.x || []);
  return {
    hostChartDataResponseCount: probe.responses.length,
    hostChartErrorCount: probe.errors.length,
    hostChartErrors: probe.errors.slice(),
    uPlotBuildCount: probe.plotBuilds.length,
    uPlotScaleHookCount: probe.scaleHooks.length,
    uPlotDataHookCount: probe.dataHooks.length,
    uPlotHookConfigurations: probe.hookConfigurations.slice(),
    latestScaleHook: probe.scaleHooks.at(-1) || null,
    plot: {
      id: probe.currentPlotId,
      range: probe.cloneRange(probe.currentPlot?.scales?.x),
      data: {
        pointCount: alignedArrays[0]?.length || 0,
        firstX: alignedArrays[0]?.[0],
        lastX: alignedArrays[0]?.at(-1),
        digest: probe.digestAlignedData(alignedArrays),
      },
      currentMatchesLatestResponse: plotMatchesResponse(latestResponse),
      currentMatchesFullResponse: plotMatchesResponse(fullResponse),
    },
    responses: probe.responses.map(responseSummary),
    fullResponseStoredUnchanged:
      !!fullResponse &&
      probe.digestChartData(fullResponse) === fullResponse.receivedDigest &&
      rangesEqual(
        responseSummary(fullResponse).xDomain,
        fullResponse.xDomain
      ),
    nestedResponseIntroducedPoint:
      !!nestedRefinement &&
      nestedRefinement.x.some(value => !firstRefinementX.has(value)),
    resetDisabled: root.querySelector('#resetChartZoom')?.disabled === true,
    chartStatus: root.querySelector('#chartStatus')?.textContent || '',
  };
}

async function dragOrdinaryChartRange(
  renderer,
  startFraction,
  endFraction,
  before
) {
  const drag = await renderer.evaluate(
    ordinaryChartDragPoints,
    startFraction,
    endFraction
  );
  assert(drag?.start && drag?.end, 'ordinary chart drag points must render');
  assert.strictEqual(
    drag.hostChartDataResponseCount,
    before.hostChartDataResponseCount,
    'ordinary drag must start from the expected settled host response'
  );
  await renderer.drag(
    drag.start.x,
    drag.start.y,
    drag.end.x,
    drag.end.y
  );
  const pending = await renderer.evaluate(ordinaryChartLifecycleSnapshot);
  assert.strictEqual(
    pending.hostChartDataResponseCount,
    before.hostChartDataResponseCount,
    'ordinary chart debounce must not have settled during the trusted drag'
  );
  assert(
    pending.uPlotScaleHookCount > drag.uPlotScaleHookCount,
    'ordinary trusted drag must pass through the real uPlot setScale hook'
  );
  assert(
    pending.plot.range.min > drag.beforeRange.min &&
      pending.plot.range.max < drag.beforeRange.max,
    'ordinary trusted drag must narrow the current absolute range'
  );
  return {
    input: 'trusted CDP Input.dispatchMouseEvent drag',
    startFraction,
    endFraction,
    beforeRange: drag.beforeRange,
    requestedRange: pending.plot.range,
    hostChartDataResponseCountBefore: drag.hostChartDataResponseCount,
    hostChartDataResponseCountAfterDragBeforeDebounce:
      pending.hostChartDataResponseCount,
    uPlotScaleHookCountBefore: drag.uPlotScaleHookCount,
    uPlotScaleHookCountAfter: pending.uPlotScaleHookCount,
    scaleHook: pending.latestScaleHook,
  };
}

function ordinaryChartDragPoints(root, startFraction, endFraction) {
  const view = root.ownerDocument.defaultView;
  const probe = view.__kxOrdinaryChartLifecycleProbe;
  const overlay = root.querySelector('#chartCanvasWrap .u-over');
  if (!probe?.currentPlot || !(overlay instanceof view.HTMLElement)) {
    throw new Error('ordinary chart drag overlay or instrumented plot is missing');
  }
  if (!(startFraction >= 0 && endFraction <= 1 &&
    endFraction > startFraction)) {
    throw new Error('ordinary chart drag fractions are invalid');
  }
  overlay.scrollIntoView({ block: 'center', inline: 'nearest' });
  const bounds = overlay.getBoundingClientRect();
  if (bounds.width <= 20 || bounds.height <= 20) {
    throw new Error('ordinary chart drag overlay has no usable bounds');
  }
  let startX = bounds.left + bounds.width * startFraction;
  let endX = bounds.left + bounds.width * endFraction;
  let y = bounds.top + bounds.height * 0.5;
  let frameView = overlay.ownerDocument.defaultView;
  const visitedViews = new Set();
  for (let depth = 0;
    frameView && depth < 8 && !visitedViews.has(frameView);
    depth += 1) {
    visitedViews.add(frameView);
    const frame = frameView.frameElement;
    if (!frame) {
      break;
    }
    const frameRect = frame.getBoundingClientRect();
    startX += frameRect.left + frame.clientLeft;
    endX += frameRect.left + frame.clientLeft;
    y += frameRect.top + frame.clientTop;
    const parentView = frame.ownerDocument.defaultView;
    if (!parentView || parentView === frameView) {
      break;
    }
    frameView = parentView;
  }
  return {
    start: { x: startX, y },
    end: { x: endX, y },
    beforeRange: probe.cloneRange(probe.currentPlot.scales?.x),
    hostChartDataResponseCount: probe.responses.length,
    uPlotScaleHookCount: probe.scaleHooks.length,
  };
}

function integerDomainForRange(range, fullRange) {
  return {
    min: Math.ceil(Math.max(fullRange.min, range.min)),
    max: Math.floor(Math.min(fullRange.max, range.max)),
  };
}

function assertOrdinaryRangedChartResponse(
  response,
  expectedDomain,
  sourceRowCount,
  label
) {
  assert(response, `${label} chart response is missing`);
  assert.deepStrictEqual(
    response.xDomain,
    expectedDomain,
    `${label} must use the exact integer source domain inside its absolute request`
  );
  assert.strictEqual(
    response.sourceRowCount,
    sourceRowCount,
    `${label} must resample from the immutable full source`
  );
  assert.strictEqual(
    response.eligibleRowCount,
    expectedDomain.max - expectedDomain.min + 1,
    `${label} must report the exact eligible source-row count`
  );
  assert.strictEqual(
    response.sampledPointCount,
    Math.min(response.eligibleRowCount, 7_000),
    `${label} must reconstruct the ranged 7,000-point density`
  );
  assert.strictEqual(response.firstX, expectedDomain.min);
  assert.strictEqual(response.lastX, expectedDomain.max);
  assert.strictEqual(response.storedUnchanged, true);
}

function ordinaryChartStageEvidence(snapshot, responseIndex) {
  return {
    hostChartDataResponseCount: snapshot.hostChartDataResponseCount,
    hostChartErrorCount: snapshot.hostChartErrorCount,
    uPlotBuildCount: snapshot.uPlotBuildCount,
    uPlotScaleHookCount: snapshot.uPlotScaleHookCount,
    uPlotDataHookCount: snapshot.uPlotDataHookCount,
    response: snapshot.responses[responseIndex],
    reconstructedRange: snapshot.plot.range,
    reconstructedData: snapshot.plot.data,
    currentMatchesHostResponse: snapshot.plot.currentMatchesLatestResponse,
    fullResponseStoredUnchanged: snapshot.fullResponseStoredUnchanged,
    chartStatus: snapshot.chartStatus,
  };
}

function sameNumericRange(left, right) {
  return !!left && !!right &&
    left.min === right.min &&
    left.max === right.max;
}

async function exerciseNotebookResultColumnSizing(cdpPort, resultConfiguration) {
  let notebook;
  let renderer;
  try {
    ({ notebook, renderer } = await openColumnSizingNotebook(cdpPort));
    const wholeResult = await waitForRenderer(
      'notebook whole-result column sizing',
      renderer,
      notebookColumnSizingSnapshot,
      value => value.headers.join('|') ===
          'acceptance_row|acceptance_label|acceptance_widest_list' &&
        value.autoFit &&
        value.autoFitMode === 'wholeResult' &&
        value.widths.length === 3 &&
        value.widths[2] >= 400 &&
        value.firstRowWidths.every((width, index) =>
          Math.abs(width - value.widths[index]) <= 1)
    );

    await renderer.evaluate(scrollNotebookGridToRow, COLUMN_SIZING_WIDEST_ROW);
    const wholeResultAfterScroll = await waitForRenderer(
      'notebook whole-result virtual scroll stability',
      renderer,
      notebookColumnSizingSnapshot,
      value => value.renderedRows.includes(COLUMN_SIZING_WIDEST_ROW) &&
        Math.abs(value.widths[2] - wholeResult.widths[2]) <= 1
    );

    await resultConfiguration.update(
      'viewer.autoFitMode',
      'visibleRows',
      vscode.ConfigurationTarget.Global
    );
    await renderer.evaluate(scrollNotebookGridToRow, 0);
    const visibleRowsNarrow = await waitForRenderer(
      'notebook visible-row narrow sizing',
      renderer,
      notebookColumnSizingSnapshot,
      value => value.autoFitMode === 'visibleRows' &&
        value.renderedRows.includes(0) &&
        value.widths[2] + 80 < wholeResult.widths[2]
    );
    await renderer.evaluate(scrollNotebookGridToRow, COLUMN_SIZING_WIDEST_ROW);
    const visibleRowsWide = await waitForRenderer(
      'notebook visible-row adaptive sizing',
      renderer,
      notebookColumnSizingSnapshot,
      value => value.renderedRows.includes(COLUMN_SIZING_WIDEST_ROW) &&
        value.widths[2] > visibleRowsNarrow.widths[2] + 80
    );

    await resultConfiguration.update(
      'viewer.autoFitColumns',
      false,
      vscode.ConfigurationTarget.Global
    );
    const autoFitDisabled = await waitForRenderer(
      'notebook unchecked auto-fit sizing',
      renderer,
      notebookColumnSizingSnapshot,
      value => !value.autoFit &&
        value.widths.length === 3 &&
        value.widths.every(width => Math.abs(width - 160) <= 1)
    );

    const drag = await renderer.evaluate(notebookResizeHandlePoint, 0);
    assert(drag?.point, 'notebook first-column resize handle must render');
    const expectedManualWidth = drag.startWidth + 96;
    await renderer.drag(
      drag.point.x,
      drag.point.y,
      drag.point.x + 96,
      drag.point.y
    );
    const notebookResizeFinish = await renderer.evaluate(
      finishPendingColumnResize
    );
    const manualFirstColumn = await waitForRenderer(
      'notebook first-column drag persistence',
      renderer,
      notebookColumnSizingSnapshot,
      value => Math.abs(value.widths[0] - expectedManualWidth) <= 2 &&
        value.renderedFirstColumnWidths.length > 0 &&
        value.renderedFirstColumnWidths.every(width =>
          Math.abs(width - value.widths[0]) <= 1)
    );
    let notebookPersistedWidths;
    try {
      await waitFor(
        'notebook persisted first-column width map',
        () => {
          notebookPersistedWidths =
            currentResultSetting('viewer.columnWidths');
          return isSparseWidthMap(notebookPersistedWidths) &&
            Math.abs(
              notebookPersistedWidths['0'] - expectedManualWidth
            ) <= 2;
        },
        8_000
      );
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; ` +
        `actual=${JSON.stringify(notebookPersistedWidths)}, ` +
        `expected=${expectedManualWidth}, finish=${JSON.stringify(
          notebookResizeFinish
        )}`
      );
    }
    await renderer.evaluate(scrollNotebookGridToRow, 0);
    const manualAfterVirtualScroll = await waitForRenderer(
      'notebook manual width virtual scroll stability',
      renderer,
      notebookColumnSizingSnapshot,
      value => value.renderedRows.includes(0) &&
        Math.abs(value.widths[0] - expectedManualWidth) <= 2 &&
        Math.abs(value.firstRowWidths[0] - expectedManualWidth) <= 2
    );

    renderer.close();
    renderer = undefined;
    await discardActiveVisualNotebook();
    ({ notebook, renderer } = await openColumnSizingNotebook(cdpPort));
    const recreated = await waitForRenderer(
      'notebook output recreation width persistence',
      renderer,
      notebookColumnSizingSnapshot,
      value => !value.autoFit &&
        Math.abs(value.widths[0] - expectedManualWidth) <= 2
    );

    await renderer.evaluate(setNotebookCellWidth, 190);
    const allColumnPreset = await waitForRenderer(
      'notebook all-column Cell width preset',
      renderer,
      notebookColumnSizingSnapshot,
      value => !value.autoFit &&
        value.widths.length === 3 &&
        snapshotAllColumnsHaveWidth(value, 190)
    );
    await waitFor(
      'notebook Cell width preset clears sparse overrides',
      () => {
        const widths = currentResultSetting('viewer.columnWidths');
        return isSparseWidthMap(widths) &&
          Object.keys(widths).length === 0 &&
          currentResultSetting('standard.cellWidth') === 190;
      },
      8_000
    );

    return {
      name: 'notebook-real-runtime-column-sizing',
      wholeResult: {
        beforeScroll: wholeResult,
        afterScroll: wholeResultAfterScroll,
      },
      visibleRows: {
        narrow: visibleRowsNarrow,
        widestRow: visibleRowsWide,
      },
      autoFitDisabled,
      manualFirstColumn,
      manualAfterVirtualScroll,
      recreated,
      allColumnPreset,
      persistedShape: 'sparse-map',
    };
  } finally {
    renderer?.close();
    if (notebook && !notebook.isClosed) {
      await vscode.window.showNotebookDocument(notebook, {
        preserveFocus: false,
        preview: false,
        viewColumn: vscode.ViewColumn.One,
      }).catch(() => undefined);
      await discardActiveVisualNotebook().catch(() => undefined);
    }
    await configureColumnSizingAcceptance(resultConfiguration)
      .catch(() => undefined);
  }
}

async function openColumnSizingNotebook(
  cdpPort,
  fixture = COLUMN_SIZING_FIXTURE
) {
  const notebook = await openLiveGalleryNotebook(fixture);
  const editor = await vscode.window.showNotebookDocument(notebook, {
    preserveFocus: false,
    preview: false,
    viewColumn: vscode.ViewColumn.One,
  });
  assertLiveCase(
    fixture,
    await executeOneLiveGalleryCase(
      notebook,
      editor,
      fixture
    )
  );
  await showNotebookCase(notebook, 0);
  return {
    notebook,
    renderer: await connectNotebookRenderer(
      cdpPort,
      fixture.marker || 'acceptance_widest_list'
    ),
  };
}

async function openOrdinaryColumnSizingFixture(cdpPort, fixture) {
  const document = await vscode.workspace.openTextDocument({
    language: 'q',
    content: fixture.source,
  });
  await vscode.window.showTextDocument(document, {
    preserveFocus: false,
    preview: false,
    viewColumn: vscode.ViewColumn.One,
  });
  await vscode.commands.executeCommand('vscode-kdb.runSelectionOrCurrentLine');
  return {
    document,
    renderer: await connectNotebookRenderer(cdpPort, fixture.marker),
  };
}

async function closeOrdinaryColumnSizingFixture(handle) {
  if (!handle) {
    return;
  }
  if (handle.renderer) {
    handle.renderer.close();
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  }
  if (handle.document && !handle.document.isClosed) {
    await vscode.window.showTextDocument(handle.document, {
      preserveFocus: false,
      preview: false,
      viewColumn: vscode.ViewColumn.One,
    });
    await vscode.commands.executeCommand(
      'workbench.action.revertAndCloseActiveEditor'
    );
  }
}

async function dragOrdinaryColumnToWidth(renderer, position, targetWidth) {
  const drag = await renderer.evaluate(ordinaryResizeHandlePoint, position);
  assert(drag?.point, `ordinary resize handle ${position} must render`);
  const delta = targetWidth - drag.startWidth;
  assert.notStrictEqual(delta, 0, `ordinary column ${position} must be dragged`);
  await renderer.drag(
    drag.point.x,
    drag.point.y,
    drag.point.x + delta,
    drag.point.y
  );
  await renderer.evaluate(finishPendingColumnResize);
  return waitForRenderer(
    `ordinary column ${position} drag to ${targetWidth}px`,
    renderer,
    ordinaryColumnSizingSnapshot,
    value => snapshotRenderedPositionHasWidth(value, position, targetWidth)
  );
}

async function dragNotebookColumnToWidth(renderer, position, targetWidth) {
  const drag = await renderer.evaluate(notebookResizeHandlePoint, position);
  assert(drag?.point, `notebook resize handle ${position} must render`);
  const delta = targetWidth - drag.startWidth;
  assert.notStrictEqual(delta, 0, `notebook column ${position} must be dragged`);
  await renderer.drag(
    drag.point.x,
    drag.point.y,
    drag.point.x + delta,
    drag.point.y
  );
  await renderer.evaluate(finishPendingColumnResize);
  return waitForRenderer(
    `notebook column ${position} drag to ${targetWidth}px`,
    renderer,
    notebookColumnSizingSnapshot,
    value => snapshotRenderedPositionHasWidth(value, position, targetWidth)
  );
}

function snapshotHasHeaders(snapshot, expectedHeaders) {
  return Array.isArray(snapshot?.headers) &&
    JSON.stringify(snapshot.headers) === JSON.stringify(expectedHeaders);
}

function snapshotRenderedPositionHasWidth(
  snapshot,
  position,
  expectedWidth,
  tolerance = 2
) {
  const bodyWidths = snapshot?.renderedColumnWidths?.[String(position)];
  return Number.isFinite(snapshot?.widths?.[position]) &&
    Math.abs(snapshot.widths[position] - expectedWidth) <= tolerance &&
    Array.isArray(bodyWidths) &&
    bodyWidths.length > 0 &&
    bodyWidths.every(width =>
      Number.isFinite(width) &&
      Math.abs(width - expectedWidth) <= tolerance
    );
}

function snapshotHasManualWidths(snapshot, widthsByPosition) {
  return Object.entries(widthsByPosition).every(([position, width]) =>
    snapshotRenderedPositionHasWidth(snapshot, Number(position), width)
  );
}

function snapshotAllColumnsHaveWidth(snapshot, expectedWidth) {
  return Array.isArray(snapshot?.widths) &&
    snapshot.widths.length > 0 &&
    snapshot.widths.every(width =>
      Number.isFinite(width) && Math.abs(width - expectedWidth) <= 1
    ) &&
    snapshot.widths.every((_width, position) => {
      const bodyWidths = snapshot.renderedColumnWidths?.[String(position)];
      return Array.isArray(bodyWidths) &&
        bodyWidths.length > 0 &&
        bodyWidths.every(width =>
          Number.isFinite(width) &&
          Math.abs(width - expectedWidth) <= 1
        );
    });
}

function ordinaryColumnSizingSnapshot(root) {
  const renderedCells = [
    ...root.querySelectorAll('#rows [role="cell"][data-row][data-column]'),
  ];
  const widths = elementsByNumericData(
    root.querySelectorAll('#header [role="columnheader"][data-column]'),
    'column'
  ).map(element => Math.round(element.getBoundingClientRect().width));
  const firstRowWidths = elementsByNumericData(
    root.querySelectorAll('#rows [role="cell"][data-row="0"][data-column]'),
    'column'
  ).map(element => Math.round(element.getBoundingClientRect().width));
  return {
    headers: elementsByNumericData(
      root.querySelectorAll('#header [role="columnheader"][data-column]'),
      'column'
    ).map(element => element.childNodes[0]?.textContent?.trim() || ''),
    widths,
    firstRowWidths,
    renderedFirstColumnWidths: [
      ...root.querySelectorAll(
        '#rows [role="cell"][data-row][data-column="0"]'
      ),
    ].map(element => Math.round(element.getBoundingClientRect().width)),
    renderedColumnWidths: renderedCells.reduce((result, element) => {
      const position = String(Number(element.dataset.column));
      (result[position] ||= []).push(
        Math.round(element.getBoundingClientRect().width)
      );
      return result;
    }, {}),
    renderedRows: [...new Set(
      renderedCells
        .map(element => Number(element.dataset.row))
        .filter(Number.isSafeInteger)
    )].sort((left, right) => left - right),
    autoFit: root.querySelector('#autoFit')?.checked === true,
    autoFitMode: root.querySelector('#autoFitMode')?.value || '',
    density: root.querySelector('#settingsDensity')?.value || '',
    scrollTop: Math.round(root.querySelector('#viewport')?.scrollTop || 0),
  };

  function elementsByNumericData(elements, key) {
    return [...elements].sort(
      (left, right) => Number(left.dataset[key]) - Number(right.dataset[key])
    );
  }
}

function notebookColumnSizingSnapshot(root) {
  const headers = [...root.querySelectorAll(
    '.kx-live-header[role="columnheader"]'
  )].sort((left, right) =>
    Number(left.getAttribute('aria-colindex')) -
    Number(right.getAttribute('aria-colindex')));
  const firstRow = [...root.querySelectorAll(
    '.kx-live-cell[role="gridcell"][data-row="0"]'
  )].sort((left, right) =>
    Number(left.dataset.column) - Number(right.dataset.column));
  const setting = label => [...root.querySelectorAll('details.kx-settings label')]
    .find(candidate => candidate.textContent?.trim().startsWith(label))
    ?.querySelector('input,select');
  const renderedCells = [
    ...root.querySelectorAll(
      '.kx-live-cell[role="gridcell"][data-row][data-column]'
    ),
  ];
  return {
    headers: headers.map(header =>
      header.childNodes[0]?.textContent?.trim() || ''),
    widths: headers.map(header =>
      Math.round(header.getBoundingClientRect().width)),
    firstRowWidths: firstRow.map(cell =>
      Math.round(cell.getBoundingClientRect().width)),
    renderedFirstColumnWidths: [
      ...root.querySelectorAll(
        '.kx-live-cell[role="gridcell"][data-row][data-column="0"]'
      ),
    ].map(cell => Math.round(cell.getBoundingClientRect().width)),
    renderedColumnWidths: renderedCells.reduce((result, cell) => {
      const position = String(Number(cell.dataset.column));
      (result[position] ||= []).push(
        Math.round(cell.getBoundingClientRect().width)
      );
      return result;
    }, {}),
    renderedRows: [...new Set(
      renderedCells
        .map(element => Number(element.dataset.row))
        .filter(Number.isSafeInteger)
    )].sort((left, right) => left - right),
    autoFit: setting('Auto-fit columns')?.checked === true,
    autoFitMode: setting('Auto-fit scope')?.value || '',
    density: setting('Density')?.value || '',
    scrollTop: Math.round(
      root.querySelector('.kx-live-viewport')?.scrollTop || 0
    ),
  };
}

function scrollOrdinaryGridToRow(root, row) {
  const viewport = root.querySelector('#viewport');
  const firstCell = root.querySelector('#rows [role="cell"][data-row]');
  if (!viewport) {
    throw new Error('ordinary result viewport missing');
  }
  const rowHeight = Number.parseFloat(firstCell?.style.height || '') || 28;
  viewport.scrollTop = Math.max(0, row * rowHeight);
  viewport.dispatchEvent(new root.ownerDocument.defaultView.Event(
    'scroll',
    { bubbles: true }
  ));
  return viewport.scrollTop;
}

function scrollNotebookGridToRow(root, row) {
  const viewport = root.querySelector('.kx-live-viewport');
  const firstCell = root.querySelector(
    '.kx-live-cell[role="gridcell"][data-row]'
  );
  if (!viewport) {
    throw new Error('notebook result viewport missing');
  }
  const rowHeight = Number.parseFloat(firstCell?.style.height || '') || 28;
  viewport.scrollTop = Math.max(0, row * rowHeight);
  viewport.dispatchEvent(new root.ownerDocument.defaultView.Event(
    'scroll',
    { bubbles: true }
  ));
  return viewport.scrollTop;
}

function ordinaryResizeHandlePoint(root, column) {
  const handle = root.querySelector(
    `#header .resize-handle[data-column="${column}"]`
  );
  if (!handle) {
    throw new Error(`ordinary resize handle ${column} missing`);
  }
  return {
    point: absoluteElementCenter(handle),
    startWidth: Math.round(
      handle.closest('[role="columnheader"]').getBoundingClientRect().width
    ),
  };

  function absoluteElementCenter(element) {
    const rect = element.getBoundingClientRect();
    let x = rect.left + rect.width / 2;
    let y = rect.top + rect.height / 2;
    let frameView = element.ownerDocument.defaultView;
    const visitedViews = new Set();
    for (let depth = 0;
      frameView && depth < 8 && !visitedViews.has(frameView);
      depth += 1) {
      visitedViews.add(frameView);
      const frame = frameView.frameElement;
      if (!frame) {
        break;
      }
      const frameRect = frame.getBoundingClientRect();
      x += frameRect.left + frame.clientLeft;
      y += frameRect.top + frame.clientTop;
      const parentView = frame.ownerDocument.defaultView;
      if (!parentView || parentView === frameView) {
        break;
      }
      frameView = parentView;
    }
    return { x, y };
  }
}

function notebookResizeHandlePoint(root, position) {
  const handle = root.querySelector(
    `.kx-live-header .kx-column-resize-handle[data-position="${position}"]`
  );
  if (!handle) {
    throw new Error(`notebook resize handle ${position} missing`);
  }
  return {
    point: absoluteElementCenter(handle),
    startWidth: Math.round(
      handle.closest('[role="columnheader"]').getBoundingClientRect().width
    ),
  };

  function absoluteElementCenter(element) {
    const rect = element.getBoundingClientRect();
    let x = rect.left + rect.width / 2;
    let y = rect.top + rect.height / 2;
    let frameView = element.ownerDocument.defaultView;
    const visitedViews = new Set();
    for (let depth = 0;
      frameView && depth < 8 && !visitedViews.has(frameView);
      depth += 1) {
      visitedViews.add(frameView);
      const frame = frameView.frameElement;
      if (!frame) {
        break;
      }
      const frameRect = frame.getBoundingClientRect();
      x += frameRect.left + frame.clientLeft;
      y += frameRect.top + frame.clientTop;
      const parentView = frame.ownerDocument.defaultView;
      if (!parentView || parentView === frameView) {
        break;
      }
      frameView = parentView;
    }
    return { x, y };
  }
}

function setOrdinaryCellWidth(root, width) {
  const input = root.querySelector('#settingsCellWidth');
  const view = root.ownerDocument.defaultView;
  if (!(input instanceof view.HTMLInputElement)) {
    throw new Error('ordinary Cell width input missing');
  }
  input.value = String(width);
  input.dispatchEvent(new view.Event('change', { bubbles: true }));
  return input.value;
}

function resetOrdinaryColumnWidths(root) {
  const button = root.querySelector('#resetColumnWidths');
  const view = root.ownerDocument.defaultView;
  if (!(button instanceof view.HTMLButtonElement) || button.disabled) {
    throw new Error('ordinary Reset column widths button is missing or disabled');
  }
  button.click();
  return true;
}

function setOrdinaryDensity(root, density) {
  const select = root.querySelector('#settingsDensity');
  const view = root.ownerDocument.defaultView;
  if (!(select instanceof view.HTMLSelectElement)) {
    throw new Error('ordinary Density select missing');
  }
  select.value = density;
  select.dispatchEvent(new view.Event('change', { bubbles: true }));
  return select.value;
}

function setNotebookCellWidth(root, width) {
  const view = root.ownerDocument.defaultView;
  const input = [...root.querySelectorAll('details.kx-settings label')]
    .find(label => label.textContent?.trim().startsWith('Cell width'))
    ?.querySelector('input[type="number"]');
  if (!(input instanceof view.HTMLInputElement)) {
    throw new Error('notebook Cell width input missing');
  }
  input.value = String(width);
  input.dispatchEvent(new view.Event('change', { bubbles: true }));
  return input.value;
}

function finishPendingColumnResize(root) {
  const view = root.ownerDocument.defaultView;
  const cursorBefore = root.ownerDocument.body.style.cursor || '';
  const guidesBefore = root.ownerDocument.querySelectorAll(
    '.kx-column-resize-guide'
  ).length;
  view.dispatchEvent(new view.MouseEvent('mouseup', {
    bubbles: true,
    cancelable: true,
  }));
  return {
    cursorBefore,
    cursorAfter: root.ownerDocument.body.style.cursor || '',
    guidesBefore,
    guidesAfter: root.ownerDocument.querySelectorAll(
      '.kx-column-resize-guide'
    ).length,
  };
}

function isSparseWidthMap(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => /^(0|[1-9]\d*)$/.test(key));
}

function currentResultSetting(key) {
  return vscode.workspace
    .getConfiguration('vscode-kdb.results')
    .get(key);
}

function normalizedWidthMap(value) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return result;
  }
  Object.keys(value)
    .sort((left, right) => Number(left) - Number(right))
    .forEach(key => {
      if (!/^(0|[1-9]\d*)$/.test(key)) {
        return;
      }
      const width = Number(value[key]);
      if (Number.isFinite(width)) {
        result[String(Number(key))] = width;
      }
    });
  return result;
}

function widthMapsEqual(actual, expected) {
  try {
    assert.deepStrictEqual(
      normalizedWidthMap(actual),
      normalizedWidthMap(expected)
    );
    return true;
  } catch {
    return false;
  }
}

function validateRestartMarker(marker, profilePath, qPort) {
  assert(marker && typeof marker === 'object', 'restart marker must be an object');
  assert.strictEqual(marker.version, 1);
  assert.strictEqual(marker.phaseOneComplete, true);
  assert.strictEqual(marker.reloadCommand, 'workbench.action.reloadWindow');
  assert.strictEqual(marker.reloadCommandIssued, true);
  assert.strictEqual(marker.profilePath, profilePath);
  assert(Number.isSafeInteger(marker.extensionHostPid) &&
    marker.extensionHostPid > 0);
  assert.deepStrictEqual(
    normalizedWidthMap(marker.widthsByPosition),
    RESTART_WIDTHS_BY_POSITION
  );
  assert(Array.isArray(marker.resultSettingsSnapshot));
  assert(Array.isArray(marker.workbenchSettingsSnapshot));
  assert.strictEqual(marker.connectionId, VISUAL_CONNECTION_ID);
  assert.strictEqual(marker.qPort, qPort);
  if (marker.reloadPromiseCancellation) {
    assert.deepStrictEqual(marker.reloadPromiseCancellation, {
      name: 'Canceled',
      message: 'Canceled',
    });
  }
}

function isReloadCancellation(error) {
  return !!error && error.name === 'Canceled' && error.message === 'Canceled';
}

function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function readRequiredJson(filePath, label) {
  const value = readJsonIfPresent(filePath);
  assert(value, `${label} was not found at ${filePath}`);
  return value;
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(
    temporaryPath,
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8'
  );
  fs.renameSync(temporaryPath, filePath);
}

function removeFileIfPresent(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
}

function assertGlobalConfigurationRestored(configuration, snapshot) {
  assert(Array.isArray(snapshot), 'global configuration snapshot must be an array');
  for (const entry of snapshot) {
    const actual = configuration.inspect(entry.key)?.globalValue;
    if (entry.hadGlobalValue) {
      assert.deepStrictEqual(
        actual,
        entry.globalValue,
        `global setting ${entry.key} was not restored`
      );
    } else {
      assert.strictEqual(
        actual,
        undefined,
        `global setting ${entry.key} was not cleared`
      );
    }
  }
}

function validateGalleryContract() {
  const contract = require('../../out/notebook-contract.js');
  for (const fixture of savedCases) {
    if (!fixture.payload) {
      assert(fixture.nativeError, `${fixture.id} must provide a payload or native error`);
      continue;
    }
    const validation = contract.validatePortableKxResult(fixture.payload);
    assert.strictEqual(validation.ok, true, `${fixture.id}: ${validation.error || 'invalid payload'}`);
  }
  assert.deepStrictEqual(
    expectedCaseIds.filter(id => !galleryCaseIds().includes(id)),
    [],
    'the deterministic gallery is missing a required acceptance case'
  );
  const tracked = JSON.parse(fs.readFileSync(TRACKED_NOTEBOOK_FIXTURE, 'utf8'));
  assert.deepStrictEqual(
    tracked.cells.map(cell => cell.id),
    savedVisualCases.map(fixture => fixture.id),
    'the tracked visual notebook must retain the representative fixture order'
  );
  for (const cell of tracked.cells) {
    const payload = cell.outputs[0].data[KX_NOTEBOOK_MIME];
    const validation = contract.validatePortableKxResult(payload);
    assert.strictEqual(
      validation.ok,
      true,
      `${cell.id}: ${validation.error || 'invalid tracked notebook payload'}`
    );
  }
}

async function openLiveGalleryNotebook(initialFixture = liveQueries[0]) {
  const data = new vscode.NotebookData([
    new vscode.NotebookCellData(
      vscode.NotebookCellKind.Code,
      initialFixture.source,
      'q'
    ),
  ]);
  data.metadata = {
    metadata: {
      kernelspec: {
        display_name: 'Python 3',
        language: 'python',
        name: 'python3',
      },
      language_info: { name: 'python' },
      'vscode-kdb': {
        version: 1,
        qTarget: {
          id: VISUAL_CONNECTION_ID,
          name: VISUAL_CONNECTION_NAME,
        },
      },
    },
  };
  return vscode.workspace.openNotebookDocument('jupyter-notebook', data);
}

async function executeLiveGallery(notebook, editor) {
  const evidence = [];
  // Reuse one real notebook cell and finish with the screenshot case. Keeping
  // seven rich outputs mounted at once makes the visual run test Electron's
  // renderer memory limits instead of the result UI.
  const orderedCases = [
    ...liveQueries.filter(fixture => fixture.id !== 'live-full-result'),
    liveQueries.find(fixture => fixture.id === 'live-full-result'),
  ];
  for (const fixture of orderedCases) {
    assert(fixture, 'live full-result gallery case is required');
    console.log(`Notebook visual live case: ${fixture.id}`);
    const output = await executeOneLiveGalleryCase(notebook, editor, fixture, true);
    evidence.push(assertLiveCase(fixture, output));
  }
  return evidence;
}

async function executeOneLiveGalleryCase(notebook, editor, fixture, collapseOutput = false) {
  await replaceLiveGalleryCell(notebook, fixture, collapseOutput);
  const cell = notebook.cellAt(0);
  if (editor) {
    editor.selections = [new vscode.NotebookRange(0, 1)];
  }
  await vscode.commands.executeCommand(RUN_Q_NOTEBOOK_CELL_COMMAND, cell);
  await waitFor(
    `live gallery output ${fixture.id}`,
    () => notebook.cellAt(0).outputs.length > 0,
    20_000
  );
  return notebook.cellAt(0).outputs[0];
}

async function replaceLiveGalleryCell(notebook, fixture, collapseOutput) {
  const replacement = new vscode.NotebookCellData(
    vscode.NotebookCellKind.Code,
    fixture.source,
    'q'
  );
  replacement.metadata = {
    outputCollapsed: collapseOutput || !EXPANDED_LIVE_FIXTURE_IDS.has(fixture.id),
  };
  const edit = new vscode.WorkspaceEdit();
  edit.set(notebook.uri, [
    vscode.NotebookEdit.replaceCells(new vscode.NotebookRange(0, 1), [replacement]),
  ]);
  assert.strictEqual(
    await vscode.workspace.applyEdit(edit),
    true,
    `failed to select live gallery case ${fixture.id}`
  );
  assert.strictEqual(notebook.cellAt(0).document.getText(), fixture.source);
  assert.strictEqual(notebook.cellAt(0).outputs.length, 0);
}

function assertLiveCase(fixture, output) {
  assert(output, `${fixture.id} did not produce notebook output`);
  const mimes = output.items.map(item => item.mime);
  if (fixture.expectsError) {
    assert(
      mimes.includes('application/vnd.code.notebook.error'),
      `${fixture.id} must use VS Code's native notebook error item`
    );
  } else {
    assert(mimes.includes(KX_NOTEBOOK_MIME), `${fixture.id} did not produce KX MIME`);
    assert(
      output.metadata?.[LIVE_RESULT_METADATA_KEY],
      `${fixture.id} must retain a real current-session live-result reference`
    );
  }
  return {
    caseId: fixture.id,
    mimes,
    nativeError: !!fixture.expectsError,
    hasOpaqueLiveReference: !fixture.expectsError &&
      !!output.metadata?.[LIVE_RESULT_METADATA_KEY],
  };
}

function assertLiveGallery(notebook, evidence) {
  assert.deepStrictEqual(
    new Set(evidence.map(item => item.caseId)),
    new Set(liveQueries.map(fixture => fixture.id)),
    'every live gallery case must execute through the extension command'
  );
  assertFullLiveResult(notebook);
}

function assertFullLiveResult(notebook) {
  const fullOutput = notebook.cellAt(0).outputs[0];
  const payload = outputJson(fullOutput, KX_NOTEBOOK_MIME);
  assert.strictEqual(payload.result.rowCount, 64);
  assert.strictEqual(payload.result.previewRowCount, 20);
  assert.strictEqual(payload.result.truncated, true);
}

async function openSavedCaseNotebook(fixture) {
  assert(fixture?.payload, 'saved visual cases require portable KX payloads');
  const data = new vscode.NotebookData([
    new vscode.NotebookCellData(vscode.NotebookCellKind.Code, fixture.source, 'q'),
  ]);
  const notebook = await vscode.workspace.openNotebookDocument('jupyter-notebook', data);
  return replaceSavedCaseNotebook(notebook, fixture);
}

async function openTrackedSavedPreviewAfterReopen(cellIndex) {
  const artifactDirectory = requiredAbsoluteDirectory(
    process.env.VSCODE_KDB_VISUAL_ARTIFACT_DIR,
    'VSCODE_KDB_VISUAL_ARTIFACT_DIR'
  );
  const workingCopy = path.join(
    artifactDirectory,
    'tracked-saved-preview-reopen.ipynb'
  );
  const reopenedCopy = path.join(
    artifactDirectory,
    'tracked-saved-preview-reopened.ipynb'
  );
  const trackedBefore = fs.readFileSync(TRACKED_NOTEBOOK_FIXTURE);
  fs.copyFileSync(TRACKED_NOTEBOOK_FIXTURE, workingCopy);
  let uri = vscode.Uri.file(workingCopy);
  const first = await vscode.workspace.openNotebookDocument(uri);
  assert.strictEqual(first.notebookType, 'jupyter-notebook');
  assert(first.cellCount > cellIndex, 'tracked saved-preview cell is missing');
  const firstEditor = await vscode.window.showNotebookDocument(first, {
    preserveFocus: false,
    preview: false,
    viewColumn: vscode.ViewColumn.Beside,
  });
  firstEditor.selections = [new vscode.NotebookRange(cellIndex, cellIndex + 1)];
  firstEditor.revealRange(
    new vscode.NotebookRange(cellIndex, cellIndex + 1),
    vscode.NotebookEditorRevealType.InCenter
  );
  await settleRenderer();
  const kernelMetadataBefore = {
    kernelspec: first.metadata.kernelspec,
    language_info: first.metadata.language_info,
  };

  const lifecycleMetadata = {
    ...first.metadata,
    'vscode-kdb-visual-lifecycle': {
      version: 1,
      source: 'tracked-notebook-results-gallery',
    },
  };
  const edit = new vscode.WorkspaceEdit();
  edit.set(first.uri, [
    vscode.NotebookEdit.updateNotebookMetadata(lifecycleMetadata),
  ]);
  assert.strictEqual(
    await vscode.workspace.applyEdit(edit),
    true,
    'failed to make the file-backed visual notebook dirty before save'
  );
  await waitFor(
    'file-backed visual notebook dirty state',
    () => first.isDirty,
    5_000
  );
  const saved = await first.save();
  assert.strictEqual(saved, true, 'tracked visual notebook save failed');
  assert.strictEqual(first.isDirty, false, 'tracked visual notebook remained dirty after save');
  const workingTab = vscode.window.tabGroups.all
    .flatMap(group => group.tabs)
    .find(tab => tab.input?.uri?.toString() === uri.toString());
  assert(workingTab, 'tracked visual notebook tab is missing before close');
  assert.strictEqual(
    await vscode.window.tabGroups.close(workingTab),
    true,
    'tracked visual notebook tab refused to close'
  );
  await waitFor(
    'tracked visual notebook editor to close before reopen',
    () => !vscode.window.tabGroups.all
      .flatMap(group => group.tabs)
      .some(tab => tab.input?.uri?.toString() === uri.toString()),
    5_000
  );
  const trackedAfter = fs.readFileSync(TRACKED_NOTEBOOK_FIXTURE);
  assert(
    trackedBefore.equals(trackedAfter),
    'file-backed lifecycle acceptance must not rewrite the tracked source fixture'
  );

  fs.renameSync(workingCopy, reopenedCopy);
  uri = vscode.Uri.file(reopenedCopy);
  const reopened = await vscode.workspace.openNotebookDocument(uri);
  assert.notStrictEqual(reopened, first, 'tracked notebook must be reopened as a new document');
  assert.deepStrictEqual(
    {
      kernelspec: reopened.metadata.kernelspec,
      language_info: reopened.metadata.language_info,
    },
    kernelMetadataBefore,
    'Python kernel metadata must survive save/close/reopen'
  );
  const cell = reopened.cellAt(cellIndex);
  assert.strictEqual(cell.document.languageId, 'q');
  assert.strictEqual(cell.document.getText(), 'select from largeTable');
  assert.strictEqual(cell.outputs.length, 1);
  const payload = outputJson(cell.outputs[0], KX_NOTEBOOK_MIME);
  assert.strictEqual(payload.result.rowCount, 128);
  assert.strictEqual(payload.result.previewRowCount, 6);
  assert.strictEqual(payload.result.truncated, true);
  assert.strictEqual(payload.data.rows.length, 6);
  assert.strictEqual(payload.provenance.marker, 'direct-ipc');
  return {
    notebook: reopened,
    evidence: {
      name: 'saved-preview-save-close-reopen',
      fixture: path.relative(path.resolve(__dirname, '..', '..'), TRACKED_NOTEBOOK_FIXTURE),
      workingCopy: path.basename(workingCopy),
      reopenedCopy: path.basename(reopenedCopy),
      saved,
      closedBeforeReopen: true,
      reopened: true,
      sourceUnchanged: true,
      persistedKernelMetadata: true,
      language: cell.document.languageId,
      rowCount: payload.result.rowCount,
      previewRowCount: payload.result.previewRowCount,
      storedRows: payload.data.rows.length,
      truncated: payload.result.truncated,
      marker: payload.provenance.marker,
    },
  };
}

async function replaceSavedCaseNotebook(notebook, fixture) {
  assert(fixture?.payload, 'saved visual cases require portable KX payloads');
  const replacement = new vscode.NotebookCellData(
    vscode.NotebookCellKind.Code,
    fixture.source,
    'q'
  );
  replacement.outputs = [
    new vscode.NotebookCellOutput([
      vscode.NotebookCellOutputItem.json(fixture.payload, KX_NOTEBOOK_MIME),
      vscode.NotebookCellOutputItem.text(fixture.title, 'text/plain'),
    ]),
  ];
  const edit = new vscode.WorkspaceEdit();
  edit.set(notebook.uri, [
    vscode.NotebookEdit.replaceCells(
      new vscode.NotebookRange(0, 1),
      [replacement]
    ),
  ]);
  assert.strictEqual(
    await vscode.workspace.applyEdit(edit),
    true,
    `failed to populate saved visual case ${fixture.id}`
  );
  await waitFor(
    `saved gallery output ${fixture.id}`,
    () => notebook.cellAt(0).outputs.length === 1,
    5_000
  );
  return notebook;
}

async function exerciseLiveSelectionAndSearch(renderer) {
  const initial = await renderer.evaluate(root => ({
    table: !!root.querySelector('[aria-label="KX result table"]'),
    search: !!root.querySelector('[aria-label="Search result rows"]'),
    rowCount: root.querySelector('[aria-label="KX result table"]')
      ?.getAttribute('aria-rowcount'),
    columnCount: root.querySelector('[aria-label="KX result table"]')
      ?.getAttribute('aria-colcount'),
  }));
  assert(initial.table && initial.search, 'live result table/search controls must render');
  assert.strictEqual(initial.rowCount, '65');
  assert.strictEqual(initial.columnCount, '4');

  await renderer.evaluate(root => {
    const view = root.ownerDocument.defaultView;
    const input = root.querySelector('[aria-label="Search result rows"]');
    if (!(input instanceof view.HTMLInputElement)) {
      throw new Error('live search input missing');
    }
    input.focus();
    input.value = 'MSFT';
    input.dispatchEvent(new view.Event('input', { bubbles: true }));
    return true;
  });
  const firstMatch = await waitForRenderer(
    'live search response',
    renderer,
    root => ({
      status: root.querySelector('[aria-label="Search result rows"]')
        ?.getAttribute('aria-describedby')
        ? root.ownerDocument.getElementById(
          root.querySelector('[aria-label="Search result rows"]').getAttribute('aria-describedby')
        )?.textContent || ''
        : '',
      nextDisabled: [...root.querySelectorAll('.kx-live-tools button')]
        .find(button => button.textContent?.trim() === 'Next')?.disabled,
      statusRole: (() => {
        const input = root.querySelector('[aria-label="Search result rows"]');
        const describedBy = input?.getAttribute('aria-describedby');
        return describedBy
          ? root.ownerDocument.getElementById(describedBy)?.getAttribute('role') || ''
          : '';
      })(),
      statusAriaLive: (() => {
        const input = root.querySelector('[aria-label="Search result rows"]');
        const describedBy = input?.getAttribute('aria-describedby');
        return describedBy
          ? root.ownerDocument.getElementById(describedBy)
            ?.getAttribute('aria-live') || ''
          : '';
      })(),
      focusedControl:
        root.ownerDocument.activeElement?.getAttribute('aria-label') || '',
      selectionStart:
        root.querySelector('[aria-label="Search result rows"]')?.selectionStart,
      selectionEnd:
        root.querySelector('[aria-label="Search result rows"]')?.selectionEnd,
    }),
    value => /^1\/\d+/.test(value.status) && value.nextDisabled === false &&
      value.statusRole === 'status' && value.statusAriaLive === 'polite' &&
      value.focusedControl === 'Search result rows' &&
      value.selectionStart === 4 && value.selectionEnd === 4
  );
  await renderer.evaluate(root => {
    const next = [...root.querySelectorAll('.kx-live-tools button')]
      .find(button => button.textContent?.trim() === 'Next');
    next?.focus();
    next?.click();
    return true;
  });
  const nextState = await waitForRenderer(
    'live Next match',
    renderer,
    root => {
      const input = root.querySelector('[aria-label="Search result rows"]');
      const describedBy = input?.getAttribute('aria-describedby');
      return {
        status: describedBy
          ? root.ownerDocument.getElementById(describedBy)?.textContent || ''
          : '',
        focusedControl:
          root.ownerDocument.activeElement?.textContent?.trim() || '',
      };
    },
    value => /^2\/\d+/.test(value.status) && value.focusedControl === 'Next'
  );
  await renderer.evaluate(root => {
    const previous = [...root.querySelectorAll('.kx-live-tools button')]
      .find(button => button.textContent?.trim() === 'Prev');
    previous?.focus();
    previous?.click();
    return true;
  });
  const previousState = await waitForRenderer(
    'live previous match',
    renderer,
    root => {
      const input = root.querySelector('[aria-label="Search result rows"]');
      const describedBy = input?.getAttribute('aria-describedby');
      return {
        status: describedBy
          ? root.ownerDocument.getElementById(describedBy)?.textContent || ''
          : '',
        focusedControl:
          root.ownerDocument.activeElement?.textContent?.trim() || '',
      };
    },
    value => /^1\/\d+/.test(value.status) && value.focusedControl === 'Prev'
  );

  const selectionCells = await renderer.evaluate(root => {
    const cell = (row, column) =>
      root.querySelector(
        `.kx-live-cell[role="gridcell"][data-row="${row}"][data-column="${column}"]`
      );
    const start = cell(0, 0);
    const end = cell(2, 1);
    if (!start || !end) {
      throw new Error('live range cells are unavailable');
    }
    const absoluteCenter = element => {
      const rect = element.getBoundingClientRect();
      let x = rect.left + rect.width / 2;
      let y = rect.top + rect.height / 2;
      let frameView = element.ownerDocument.defaultView;
      const visitedViews = new Set();
      for (let depth = 0; frameView && depth < 8 && !visitedViews.has(frameView); depth += 1) {
        visitedViews.add(frameView);
        const frame = frameView.frameElement;
        if (!frame) {
          break;
        }
        const frameRect = frame.getBoundingClientRect();
        x += frameRect.left + frame.clientLeft;
        y += frameRect.top + frame.clientTop;
        const parentView = frame.ownerDocument.defaultView;
        if (!parentView || parentView === frameView) {
          break;
        }
        frameView = parentView;
      }
      return { x, y };
    };
    return { start: absoluteCenter(start), end: absoluteCenter(end) };
  });
  await renderer.click(selectionCells.start.x, selectionCells.start.y);
  await renderer.click(selectionCells.end.x, selectionCells.end.y, { shiftKey: true });
  const selection = await waitForRenderer(
    'trusted live range selection',
    renderer,
    root => ({
      summary: root.querySelector('.kx-selection-summary')?.textContent || '',
      selectedCells: root.querySelectorAll(
        '.kx-live-cell[role="gridcell"][aria-selected="true"]'
      ).length,
      activeMatches: root.querySelectorAll('.is-search-match').length,
      focusedTable: root.ownerDocument.activeElement?.getAttribute('aria-label') || '',
    }),
    value => value.summary === '3 rows × 2 columns (6 cells)' &&
      value.selectedCells === 6
  );
  assert.strictEqual(selection.summary, '3 rows × 2 columns (6 cells)');
  assert.strictEqual(selection.selectedCells, 6);
  assert(selection.activeMatches > 0, 'live active search result must remain highlighted');
  assert.strictEqual(selection.focusedTable, 'KX result table');
  return {
    name: 'live-range-selection-search',
    firstMatch: firstMatch.status,
    nextMatch: nextState.status,
    previousMatch: previousState.status,
    searchFocus: {
      inputAfterHostResponse: firstMatch.focusedControl,
      inputSelection: [firstMatch.selectionStart, firstMatch.selectionEnd],
      statusRole: firstMatch.statusRole,
      statusAriaLive: firstMatch.statusAriaLive,
      nextAfterRerender: nextState.focusedControl,
      previousAfterRerender: previousState.focusedControl,
    },
    ...selection,
  };
}

async function exerciseColumnsOverlay(renderer) {
  const focusBeforeApply = await renderer.evaluate(root => {
    const view = root.ownerDocument.defaultView;
    const details = root.querySelector('details.kx-columns');
    if (details) {
      details.open = true;
    }
    const checkbox = details?.querySelector('input[aria-label="Show column size"]');
    if (!(checkbox instanceof view.HTMLInputElement)) {
      throw new Error('size column checkbox missing');
    }
    checkbox.focus();
    const focusedLabel = root.ownerDocument.activeElement?.getAttribute('aria-label') || '';
    checkbox.checked = false;
    checkbox.dispatchEvent(new view.Event('change', { bubbles: true }));
    return focusedLabel;
  });
  assert.strictEqual(focusBeforeApply, 'Show column size');
  const applied = await waitForRenderer(
    'live column hide',
    renderer,
    root => ({
      summary: root.querySelector('details.kx-columns > summary')?.textContent || '',
      columnCount: root.querySelector('[aria-label="KX result table"]')
        ?.getAttribute('aria-colcount') || '',
      open: root.querySelector('details.kx-columns')?.open === true,
      focusedControl:
        root.ownerDocument.activeElement?.getAttribute('aria-label') || '',
      sizeChecked:
        root.querySelector('input[aria-label="Show column size"]')?.checked,
    }),
    value => value.summary === 'Columns (3/4)' && value.columnCount === '3' &&
      value.open && value.focusedControl === 'Show column size' &&
      value.sizeChecked === false
  );
  await renderer.evaluate(root => {
    const details = root.querySelector('details.kx-columns');
    const move = details?.querySelector('button[aria-label="Move row right"]');
    if (!move) {
      throw new Error('row reorder control missing');
    }
    move.focus();
    move.click();
    return true;
  });
  const overlay = await waitForRenderer(
    'live column reorder focus persistence',
    renderer,
    root => {
      const details = root.querySelector('details.kx-columns');
      return {
      open: details?.open === true,
      focusedControl: root.ownerDocument.activeElement?.getAttribute('aria-label') || '',
      panelVisible: !!details?.querySelector('.kx-columns-panel'),
      options: details?.querySelectorAll('.kx-column-option').length || 0,
        firstVisibleHeader:
          root.querySelector('.kx-live-header[role="columnheader"]')?.textContent || '',
      };
    },
    value => value.open &&
      value.focusedControl === 'Move row right' &&
      value.firstVisibleHeader === 'sym'
  );
  assert.deepStrictEqual(overlay, {
    open: true,
    focusedControl: 'Move row right',
    panelVisible: true,
    options: 4,
    firstVisibleHeader: 'sym',
  });
  for (let remainingMoves = 2; remainingMoves > 0; remainingMoves -= 1) {
    await renderer.evaluate(root => {
      const move = root.querySelector(
        'details.kx-columns button[aria-label="Move row right"]'
      );
      if (!move || move.disabled) {
        throw new Error('row must remain movable toward the right boundary');
      }
      move.focus();
      move.click();
      return true;
    });
    await waitForRenderer(
      `live row move toward right boundary (${remainingMoves})`,
      renderer,
      root => {
        const details = root.querySelector('details.kx-columns');
        const visible = details?.querySelector('input[aria-label="Show column row"]');
        const row = visible?.closest('.kx-column-option');
        const rows = [...(details?.querySelectorAll('.kx-column-option') || [])];
        return {
          open: details?.open === true,
          position: row ? rows.indexOf(row) : -1,
          focusedControl:
            root.ownerDocument.activeElement?.getAttribute('aria-label') || '',
        };
      },
      value => value.open && value.position === 4 - remainingMoves
    );
  }
  const boundary = await waitForRenderer(
    'live column boundary focus fallback',
    renderer,
    root => {
      const details = root.querySelector('details.kx-columns');
      const visible = details?.querySelector('input[aria-label="Show column row"]');
      const row = visible?.closest('.kx-column-option');
      const rows = [...(details?.querySelectorAll('.kx-column-option') || [])];
      const rootRect = root.getBoundingClientRect();
      const panelRect = details?.querySelector('.kx-columns-panel')?.getBoundingClientRect();
      return {
        open: details?.open === true,
        position: row ? rows.indexOf(row) : -1,
        rightDisabled:
          row?.querySelector('button[aria-label="Move row right"]')?.disabled === true,
        focusedControl:
          root.ownerDocument.activeElement?.getAttribute('aria-label') || '',
        contained:
          !!panelRect &&
          panelRect.left >= rootRect.left - 1 &&
          panelRect.right <= rootRect.right + 1,
        bounds: {
          rootLeft: Math.round(rootRect.left),
          rootRight: Math.round(rootRect.right),
          panelLeft: Math.round(panelRect?.left || 0),
          panelRight: Math.round(panelRect?.right || 0),
        },
      };
    },
    value => value.open && value.position === 3 && value.rightDisabled &&
      value.focusedControl === 'Move row left' && value.contained
  );
  return {
    name: 'live-columns-overlay',
    hiddenColumn: 'size',
    ...applied,
    ...overlay,
    boundary,
  };
}

async function exerciseSettingsOverlay(renderer) {
  const initial = await renderer.evaluate(root => {
    const columns = root.querySelector('details.kx-columns');
    if (columns) {
      columns.open = false;
    }
    const details = root.querySelector('details.kx-settings');
    if (!details) {
      throw new Error('Results Settings control missing');
    }
    details.open = true;
    const fontSize = [...details.querySelectorAll('label')]
      .find(label => label.textContent?.trim().startsWith('Font size'))
      ?.querySelector('input[type="number"]');
    if (!fontSize) {
      throw new Error('Font size setting missing');
    }
    fontSize.focus();
    const panel = details.querySelector('.kx-settings-panel');
    const close = details.querySelector('.kx-settings-close');
    const view = root.ownerDocument.defaultView;
    const panelStyle = panel ? view.getComputedStyle(panel) : undefined;
    return {
      auto: {
        value: fontSize.value,
        placeholder: fontSize.getAttribute('placeholder') || '',
        ariaValueText: fontSize.getAttribute('aria-valuetext') || '',
      },
      closeVisible:
        !!close &&
        close.getBoundingClientRect().width > 0 &&
        close.getBoundingClientRect().height > 0,
      headerVisible:
        !!details.querySelector('.kx-settings-header') &&
        details.querySelector('.kx-settings-header').getBoundingClientRect().height > 0,
      scrollable:
        !!panel &&
        ['auto', 'scroll'].includes(panelStyle?.overflowY || '') &&
        panel.scrollHeight > panel.clientHeight,
      focusedSetting: root.ownerDocument.activeElement === fontSize ? 'Font size' : '',
    };
  });
  assert.deepStrictEqual(initial.auto, {
    value: '',
    placeholder: 'Auto (VS Code default)',
    ariaValueText: 'Auto (VS Code default)',
  });
  assert.strictEqual(initial.closeVisible, true);
  assert.strictEqual(initial.headerVisible, true);
  assert.strictEqual(initial.scrollable, true);
  assert.strictEqual(initial.focusedSetting, 'Font size');

  await renderer.pressKey('Escape');
  const escapeDismissal = await waitForRenderer(
    'Results Settings Escape dismissal',
    renderer,
    root => {
      const details = root.querySelector('details.kx-settings');
      return {
        open: details?.open === true,
        focusedSummary:
          root.ownerDocument.activeElement === details?.querySelector(':scope > summary'),
      };
    },
    value => !value.open && value.focusedSummary
  );

  await renderer.evaluate(root => {
    const details = root.querySelector('details.kx-settings');
    if (!details) {
      throw new Error('Results Settings control missing after Escape');
    }
    details.open = true;
    const close = details.querySelector('.kx-settings-close');
    if (!close) {
      throw new Error('Results Settings close button missing');
    }
    close.focus();
    close.click();
    return true;
  });
  const closeDismissal = await waitForRenderer(
    'Results Settings close-button dismissal',
    renderer,
    root => {
      const details = root.querySelector('details.kx-settings');
      return {
        open: details?.open === true,
        focusedSummary:
          root.ownerDocument.activeElement === details?.querySelector(':scope > summary'),
      };
    },
    value => !value.open && value.focusedSummary
  );

  const change = await renderer.evaluate(root => {
    const view = root.ownerDocument.defaultView;
    const details = root.querySelector('details.kx-settings');
    if (details) {
      details.open = true;
    }
    const density = [...(details?.querySelectorAll('label') || [])]
      .find(label => label.textContent?.trim().startsWith('Density'))
      ?.querySelector('select');
    if (!(density instanceof view.HTMLSelectElement)) {
      throw new Error('Density setting missing');
    }
    const previous = density.value;
    density.focus();
    density.value = previous === 'compact' ? 'standard' : 'compact';
    density.dispatchEvent(new view.Event('change', { bubbles: true }));
    return {
      previous,
      next: density.value,
    };
  });
  const overlay = await waitForRenderer(
    'shared settings open/focus persistence',
    renderer,
    root => {
      const details = root.querySelector('details.kx-settings');
      const density = [...(details?.querySelectorAll('label') || [])]
        .find(label => label.textContent?.trim().startsWith('Density'))
        ?.querySelector('select');
      const fontSize = [...(details?.querySelectorAll('label') || [])]
        .find(label => label.textContent?.trim().startsWith('Font size'))
        ?.querySelector('input[type="number"]');
      const rootRect = root.getBoundingClientRect();
      const panel = details?.querySelector('.kx-settings-panel');
      const panelRect = panel?.getBoundingClientRect();
      const panelStyle = panel
        ? root.ownerDocument.defaultView.getComputedStyle(panel)
        : undefined;
      if (panel) {
        panel.scrollTop = 0;
      }
      return {
        open: details?.open === true,
        panelVisible: !!panel,
        settingCount: panel?.querySelectorAll('label').length || 0,
        focusedTag: root.ownerDocument.activeElement?.tagName || '',
        focusedSetting: root.ownerDocument.activeElement === density ? 'Density' : '',
        density: density?.value || '',
        compact: root.classList.contains('kx-density-compact'),
        auto: {
          value: fontSize?.value ?? '',
          placeholder: fontSize?.getAttribute('placeholder') || '',
          ariaValueText: fontSize?.getAttribute('aria-valuetext') || '',
        },
        closeVisible:
          !!details?.querySelector('.kx-settings-close') &&
          details.querySelector('.kx-settings-close').getBoundingClientRect().width > 0,
        headerVisible:
          !!details?.querySelector('.kx-settings-header') &&
          details.querySelector('.kx-settings-header').getBoundingClientRect().height > 0,
        scrollable:
          !!panel &&
          ['auto', 'scroll'].includes(panelStyle?.overflowY || '') &&
          panel.scrollHeight > panel.clientHeight,
        scroll: {
          clientHeight: panel?.clientHeight || 0,
          scrollHeight: panel?.scrollHeight || 0,
          scrollTop: panel?.scrollTop || 0,
        },
        contained:
          !!panelRect &&
          panelRect.left >= rootRect.left - 1 &&
          panelRect.right <= rootRect.right + 1 &&
          panelRect.top >= rootRect.top - 1 &&
          panelRect.bottom <= rootRect.bottom + 1,
        bounds: {
          rootLeft: Math.round(rootRect.left),
          rootRight: Math.round(rootRect.right),
          rootTop: Math.round(rootRect.top),
          rootBottom: Math.round(rootRect.bottom),
          panelLeft: Math.round(panelRect?.left || 0),
          panelRight: Math.round(panelRect?.right || 0),
          panelTop: Math.round(panelRect?.top || 0),
          panelBottom: Math.round(panelRect?.bottom || 0),
        },
      };
    },
    value => value.open && value.focusedSetting === 'Density' &&
      value.density === change.next &&
      value.compact === (change.next === 'compact') &&
      value.contained && value.closeVisible && value.headerVisible &&
      value.scrollable &&
      value.auto.value === '' &&
      value.auto.placeholder === 'Auto (VS Code default)' &&
      value.auto.ariaValueText === 'Auto (VS Code default)'
  );
  assert.strictEqual(overlay.open, true);
  assert.strictEqual(overlay.panelVisible, true);
  assert(overlay.settingCount >= 18, 'shared settings overlay must expose the shared schema');
  assert.strictEqual(overlay.focusedTag, 'SELECT');
  assert.strictEqual(overlay.focusedSetting, 'Density');
  assert.strictEqual(overlay.closeVisible, true);
  assert.strictEqual(overlay.headerVisible, true);
  assert.strictEqual(overlay.scrollable, true);
  return {
    name: 'shared-settings-overlay',
    initial,
    escapeDismissal,
    closeDismissal,
    change,
    ...overlay,
    screenshot: {
      auto: overlay.auto,
      closeVisible: overlay.closeVisible,
      headerVisible: overlay.headerVisible,
      scrollable: overlay.scrollable,
      scroll: overlay.scroll,
      contained: overlay.contained,
      bounds: overlay.bounds,
    },
  };
}

async function exerciseLiveChartControls(renderer) {
  await renderer.evaluate(root => {
    const details = root.querySelector('details.kx-columns');
    if (details) {
      details.open = true;
    }
    const reset = [...(details?.querySelectorAll('button') || [])]
      .find(button => button.textContent?.trim() === 'Reset columns');
    reset?.click();
    return true;
  });
  await waitForRenderer(
    'live columns restored before chart',
    renderer,
    root => root.querySelector('[aria-label="KX result table"]')
      ?.getAttribute('aria-colcount') || '',
    value => value === '4'
  );
  await renderer.evaluate(root => {
    const chart = [...root.querySelectorAll('.kx-primary-toolbar button')]
      .find(button => button.textContent?.trim() === 'Chart');
    if (!chart) {
      throw new Error('live Chart toggle missing');
    }
    chart.click();
    return true;
  });
  const beforeDraw = await waitForRenderer(
    'live chart controls before draw',
    renderer,
    root => {
      const buttonDisabled = label =>
        [...root.querySelectorAll('.kx-chart-controls button')]
          .find(button => button.textContent?.trim() === label)?.disabled;
      return {
        panel: !!root.querySelector('.kx-chart-panel'),
        yControl: !!root.querySelector('.kx-chart-controls details.kx-series-control'),
        exportPngDisabled: buttonDisabled('Export PNG'),
        resetDisabled: buttonDisabled('Reset zoom'),
        refineDisabled: buttonDisabled('Refine zoom'),
      };
    },
    value => value.panel && value.yControl &&
      value.exportPngDisabled === true &&
      value.resetDisabled === true &&
      value.refineDisabled === true
  );
  await renderer.evaluate(root => {
    const details = root.querySelector('.kx-chart-controls details.kx-series-control');
    if (!details) {
      throw new Error('live Y series control missing');
    }
    if (!details.open) {
      details.querySelector('summary')?.click();
    }
    return true;
  });
  await waitForRenderer(
    'live Y control opened',
    renderer,
    root => root.querySelector(
      '.kx-chart-controls details.kx-series-control'
    )?.open === true,
    Boolean
  );
  const yChange = await renderer.evaluate(root => {
    const view = root.ownerDocument.defaultView;
    const details = root.querySelector('.kx-chart-controls details.kx-series-control');
    const option = [...details.querySelectorAll('.kx-series-option')]
      .find(label => label.textContent?.trim() === 'size');
    const checkbox = option?.querySelector('input');
    if (!(checkbox instanceof view.HTMLInputElement)) {
      throw new Error('live size Y checkbox missing');
    }
    const previous = checkbox.checked;
    checkbox.focus();
    checkbox.checked = !previous;
    checkbox.dispatchEvent(new view.Event('change', { bubbles: true }));
    return { previous, next: !previous };
  });
  const yPersistence = await waitForRenderer(
    'live Y open/focus persistence',
    renderer,
    root => {
      const details = root.querySelector('.kx-chart-controls details.kx-series-control');
      const option = [...(details?.querySelectorAll('.kx-series-option') || [])]
        .find(label => label.textContent?.trim() === 'size');
      const checkbox = option?.querySelector('input');
      return {
        open: details?.open === true,
        checked: checkbox?.checked,
        focusedSeries:
          root.ownerDocument.activeElement === checkbox ? 'size' : '',
      };
    },
    value => value.open && value.checked === yChange.next &&
      value.focusedSeries === 'size'
  );
  await renderer.evaluate(root => {
    const render = [...root.querySelectorAll('.kx-chart-controls button')]
      .find(button => button.textContent?.trim() === 'Render');
    if (!render || render.disabled) {
      throw new Error('live chart Render unavailable');
    }
    render.click();
    return true;
  });
  const afterDraw = await waitForRenderer(
    'live actual plot action enablement',
    renderer,
    root => {
      const buttonDisabled = label =>
        [...root.querySelectorAll('.kx-chart-controls button')]
          .find(button => button.textContent?.trim() === label)?.disabled;
      return {
        canvases: root.querySelectorAll('.kx-chart-host canvas').length,
        exportPngDisabled: buttonDisabled('Export PNG'),
        resetDisabled: buttonDisabled('Reset zoom'),
        refineDisabled: buttonDisabled('Refine zoom'),
        statusRole:
          root.querySelector('.kx-chart-panel > .kx-status')?.getAttribute('role') || '',
        statusAriaLive:
          root.querySelector('.kx-chart-panel > .kx-status')
            ?.getAttribute('aria-live') || '',
      };
    },
    value => value.canvases > 0 &&
      value.exportPngDisabled === false &&
      value.resetDisabled === false &&
      value.refineDisabled === false &&
      value.statusRole === 'status' &&
      value.statusAriaLive === 'polite',
    15_000
  );
  const autoRefinements = [];
  for (let zoomIndex = 0; zoomIndex < 2; zoomIndex += 1) {
    await dragNotebookChartInRenderer(renderer);
    const previousEligibleRows = autoRefinements.at(-1)?.eligibleRows || 65;
    autoRefinements.push(await waitForRenderer(
      `live automatic chart refinement ${zoomIndex + 1}`,
      renderer,
      root => {
        const status = root.querySelector('.kx-chart-panel > .kx-status')?.textContent || '';
        const match = /from ([\d,]+) eligible rows/.exec(status);
        return {
          status,
          eligibleRows: match ? Number(match[1].replaceAll(',', '')) : 0,
        };
      },
      value => value.status.startsWith('Refined zoom') &&
        value.eligibleRows > 0 &&
        value.eligibleRows < previousEligibleRows,
      15_000
    ));
  }
  assert(
    autoRefinements[1].eligibleRows < autoRefinements[0].eligibleRows,
    'a second narrower live zoom must trigger a second absolute source refinement'
  );
  await renderer.evaluate(root => {
    const details = root.querySelector('details.kx-columns');
    if (details) {
      details.open = true;
    }
    const deselect = [...(details?.querySelectorAll('button') || [])]
      .find(button => button.textContent?.trim() === 'Deselect all');
    deselect?.focus();
    deselect?.click();
    return true;
  });
  const hiddenColumns = await waitForRenderer(
    'live Close after hiding compatible columns',
    renderer,
    root => ({
      columns: root.querySelector('details.kx-columns > summary')?.textContent || '',
      closeVisible: [...root.querySelectorAll('.kx-primary-toolbar button')]
        .some(button => button.textContent?.trim() === 'Close'),
      columnsOpen: root.querySelector('details.kx-columns')?.open === true,
      focusedControl:
        root.ownerDocument.activeElement?.textContent?.trim() || '',
    }),
    value => value.columns === 'Columns (0/4)' && value.closeVisible &&
      value.columnsOpen && value.focusedControl === 'Deselect all'
  );
  await renderer.evaluate(root => {
    const details = root.querySelector('details.kx-columns');
    const selectAll = [...(details?.querySelectorAll('button') || [])]
      .find(button => button.textContent?.trim() === 'Select all');
    selectAll?.click();
    return true;
  });
  await waitForRenderer(
    'live columns restored after Close assertion',
    renderer,
    root => root.querySelector('[aria-label="KX result table"]')
      ?.getAttribute('aria-colcount') || '',
    value => value === '4'
  );
  await renderer.evaluate(root => {
    const close = [...root.querySelectorAll('.kx-primary-toolbar button')]
      .find(button => button.textContent?.trim() === 'Close');
    close?.click();
    return true;
  });
  await waitForRenderer(
    'live chart closed after action checks',
    renderer,
    root => ({
      panel: !!root.querySelector('.kx-chart-panel'),
      chartToggle: [...root.querySelectorAll('.kx-primary-toolbar button')]
        .some(button => button.textContent?.trim() === 'Chart'),
    }),
    value => !value.panel && value.chartToggle
  );
  return {
    name: 'live-chart-controls-persistence',
    beforeDraw,
    yChange,
    yPersistence,
    afterDraw,
    autoRefinements,
    hiddenColumns,
  };
}

async function exerciseSavedSelectionSearchAndChart(
  renderer,
  captureZoomAfterSetting,
  chartDrag,
  cdpPort
) {
  const search = await renderer.evaluate(root => {
    const view = root.ownerDocument.defaultView;
    const input = root.querySelector('[aria-label="Search saved result rows"]');
    if (!(input instanceof view.HTMLInputElement)) {
      throw new Error('saved search input missing');
    }
    input.focus();
    input.value = 'MSFT';
    input.dispatchEvent(new view.Event('input', { bubbles: true }));
    const describedBy = input.getAttribute('aria-describedby');
    const status = () => describedBy
      ? root.ownerDocument.getElementById(describedBy)?.textContent || ''
      : '';
    const button = label => [...root.querySelectorAll('.kx-live-tools button')]
      .find(candidate => candidate.textContent?.trim() === label);
    const initial = status();
    button('Next')?.click();
    const first = status();
    button('Next')?.click();
    const second = status();
    button('Prev')?.click();
    return {
      initial,
      first,
      second,
      previous: status(),
    };
  });
  assert.strictEqual(search.initial, '6 matches');
  assert.strictEqual(search.first, '1/6');
  assert.strictEqual(search.second, '2/6');
  assert.strictEqual(search.previous, '1/6');
  console.log('Notebook visual interaction: saved search Prev/Next passed');

  const savedSelectionCells = await renderer.evaluate(root => {
    const cell = (row, column) =>
      root.querySelector(`td[role="gridcell"][data-row="${row}"][data-column="${column}"]`);
    const start = cell(0, 0);
    const end = cell(2, 2);
    if (!start || !end) {
      throw new Error('saved range cells are unavailable');
    }
    const absoluteCenter = element => {
      const rect = element.getBoundingClientRect();
      let x = rect.left + rect.width / 2;
      let y = rect.top + rect.height / 2;
      let frameView = element.ownerDocument.defaultView;
      const visitedViews = new Set();
      for (let depth = 0; frameView && depth < 8 && !visitedViews.has(frameView); depth += 1) {
        visitedViews.add(frameView);
        const frame = frameView.frameElement;
        if (!frame) {
          break;
        }
        const frameRect = frame.getBoundingClientRect();
        x += frameRect.left + frame.clientLeft;
        y += frameRect.top + frame.clientTop;
        const parentView = frame.ownerDocument.defaultView;
        if (!parentView || parentView === frameView) {
          break;
        }
        frameView = parentView;
      }
      return { x, y };
    };
    return { start: absoluteCenter(start), end: absoluteCenter(end) };
  });
  await renderer.click(savedSelectionCells.start.x, savedSelectionCells.start.y);
  await renderer.click(
    savedSelectionCells.end.x,
    savedSelectionCells.end.y,
    { shiftKey: true }
  );
  const selection = await waitForRenderer(
    'trusted saved range selection',
    renderer,
    root => ({
      summary: root.querySelector('.kx-selection-summary')?.textContent || '',
      selectedCells: root.querySelectorAll('td[aria-selected="true"]').length,
      activeMatches: root.querySelectorAll('td.is-search-match').length,
      focusedTable: root.ownerDocument.activeElement?.getAttribute('aria-label') || '',
    }),
    value => value.summary === '3 rows × 3 columns (9 cells)' &&
      value.selectedCells === 9 &&
      value.focusedTable === 'Saved KX result preview table'
  );
  assert.strictEqual(selection.summary, '3 rows × 3 columns (9 cells)');
  assert.strictEqual(selection.selectedCells, 9);
  assert(selection.activeMatches > 0, 'saved active search result must remain highlighted');
  assert.strictEqual(selection.focusedTable, 'Saved KX result preview table');
  console.log('Notebook visual interaction: saved range selection passed');
  const savedGridSettingChange = await renderer.evaluate(root => {
    const view = root.ownerDocument.defaultView;
    const grid = root.querySelector('[aria-label="Saved KX result preview table"]');
    const details = root.querySelector('details.kx-settings');
    if (details) {
      details.open = true;
    }
    const density = [...(details?.querySelectorAll('label') || [])]
      .find(label => label.textContent?.trim().startsWith('Density'))
      ?.querySelector('select');
    if (!(grid instanceof view.HTMLElement) ||
        !(density instanceof view.HTMLSelectElement)) {
      throw new Error('saved grid/settings focus fixture missing');
    }
    const previous = density.value;
    density.value = previous === 'compact' ? 'standard' : 'compact';
    density.dispatchEvent(new view.Event('change', { bubbles: true }));
    grid.focus();
    return {
      previous,
      next: density.value,
      focusedTable: root.ownerDocument.activeElement?.getAttribute('aria-label') || '',
    };
  });
  const savedGridBroadcastFocus = await waitForRenderer(
    'saved grid focus after settings broadcast',
    renderer,
    root => {
      const details = root.querySelector('details.kx-settings');
      const density = [...(details?.querySelectorAll('label') || [])]
        .find(label => label.textContent?.trim().startsWith('Density'))
        ?.querySelector('select');
      return {
        density: density?.value || '',
        compact: root.classList.contains('kx-density-compact'),
        settingsOpen: details?.open === true,
        focusedTable:
          root.ownerDocument.activeElement?.getAttribute('aria-label') || '',
        selectionSummary: root.querySelector('.kx-selection-summary')?.textContent || '',
        selectedCells: root.querySelectorAll('td[aria-selected="true"]').length,
      };
    },
    value => value.density === savedGridSettingChange.next &&
      value.compact === (savedGridSettingChange.next === 'compact') &&
      value.settingsOpen &&
      value.focusedTable === 'Saved KX result preview table' &&
      value.selectedCells === 9
  );
  console.log('Notebook visual interaction: saved grid focus survived settings broadcast');

  await renderer.evaluate(root => {
    const details = root.querySelector('.kx-chart-controls details.kx-series-control');
    if (!details) {
      throw new Error('saved Y series control missing');
    }
    if (!details.open) {
      details.querySelector('summary')?.click();
    }
    return true;
  });
  await waitForRenderer(
    'saved Y control opened',
    renderer,
    root => root.querySelector(
      '.kx-chart-controls details.kx-series-control'
    )?.open === true,
    Boolean
  );
  const savedYChange = await renderer.evaluate(root => {
    const view = root.ownerDocument.defaultView;
    const details = root.querySelector('.kx-chart-controls details.kx-series-control');
    const option = [...details.querySelectorAll('.kx-series-option')]
      .find(label => label.textContent?.trim() === 'size');
    const checkbox = option?.querySelector('input');
    if (!(checkbox instanceof view.HTMLInputElement)) {
      throw new Error('saved size Y checkbox missing');
    }
    const previous = checkbox.checked;
    checkbox.focus();
    checkbox.checked = !previous;
    checkbox.dispatchEvent(new view.Event('change', { bubbles: true }));
    return { previous, next: !previous };
  });
  const savedYPersistence = await waitForRenderer(
    'saved Y open/focus persistence',
    renderer,
    root => {
      const details = root.querySelector('.kx-chart-controls details.kx-series-control');
      const option = [...(details?.querySelectorAll('.kx-series-option') || [])]
        .find(label => label.textContent?.trim() === 'size');
      const checkbox = option?.querySelector('input');
      return {
        open: details?.open === true,
        checked: checkbox?.checked,
        focusedSeries:
          root.ownerDocument.activeElement === checkbox ? 'size' : '',
      };
    },
    value => value.open && value.checked === savedYChange.next &&
      value.focusedSeries === 'size'
  );

  await renderer.evaluate(root => {
    const view = root.ownerDocument.defaultView;
    const render = [...root.querySelectorAll('.kx-chart-controls button')]
      .find(button => button.textContent?.trim() === 'Render');
    if (!(render instanceof view.HTMLButtonElement) || render.disabled) {
      throw new Error('saved chart Render button unavailable');
    }
    render.click();
    return true;
  });
  const rendered = await waitForRenderer(
    'saved line chart render',
    renderer,
    root => ({
      canvases: root.querySelectorAll('.kx-chart-host canvas').length,
      legends: root.querySelectorAll('[aria-label^="Toggle chart series "]').length,
      resetDisabled: [...root.querySelectorAll('.kx-chart-controls button')]
        .find(button => button.textContent?.trim() === 'Reset zoom')?.disabled,
    }),
    value => value.canvases > 0 && value.legends >= 2 && value.resetDisabled === false
  );
  await installCanvasTextRecorder(renderer);
  await forceChartRedraw(renderer);
  console.log('Notebook visual interaction: chart tick recorder installed');
  const fullDomainTicks = await waitForCanvasTicks('full chart domain ticks', renderer);
  console.log('Notebook visual interaction: chart rendered and full ticks captured');
  const legendTarget = await renderer.evaluate(root => {
    const legend = root.querySelector('[aria-label^="Toggle chart series "]');
    if (!legend) {
      throw new Error('visible chart legend toggle missing');
    }
    const rect = legend.getBoundingClientRect();
    let x = rect.left + rect.width / 2;
    let y = rect.top + rect.height / 2;
    let frameView = legend.ownerDocument.defaultView;
    const visitedViews = new Set();
    for (let depth = 0; frameView && depth < 8 && !visitedViews.has(frameView); depth += 1) {
      visitedViews.add(frameView);
      const frame = frameView.frameElement;
      if (!frame) {
        break;
      }
      const frameRect = frame.getBoundingClientRect();
      x += frameRect.left + frame.clientLeft;
      y += frameRect.top + frame.clientTop;
      const parentView = frame.ownerDocument.defaultView;
      if (!parentView || parentView === frameView) {
        break;
      }
      frameView = parentView;
    }
    return {
      label: legend.getAttribute('aria-label') || '',
      pressed: legend.getAttribute('aria-pressed') || '',
      x,
      y,
    };
  });
  assert.match(legendTarget.label, /^Toggle chart series /);
  assert.strictEqual(legendTarget.pressed, 'true');

  await renderer.click(legendTarget.x, legendTarget.y);
  const pointerToggle = await waitForLegendState(
    renderer,
    legendTarget.label,
    'false',
    'trusted pointer legend hide',
    false
  );

  await focusLegendToggle(renderer, legendTarget.label);
  await renderer.pressKey('Enter');
  const enterToggle = await waitForLegendState(
    renderer,
    legendTarget.label,
    'true',
    'trusted Enter legend show'
  );

  await focusLegendToggle(renderer, legendTarget.label);
  await renderer.pressKey(' ');
  const spaceToggle = await waitForLegendState(
    renderer,
    legendTarget.label,
    'false',
    'trusted Space legend hide'
  );
  const hidden = {
    label: legendTarget.label,
    pointerToggle,
    enterToggle,
    spaceToggle,
    pressed: spaceToggle.pressed,
    focused: spaceToggle.focused,
  };

  await renderer.evaluate(root => {
    const render = [...root.querySelectorAll('.kx-chart-controls button')]
      .find(button => button.textContent?.trim() === 'Render');
    render?.click();
    return true;
  });
  const hiddenAfterRenderState = await waitForLegendState(
    renderer,
    hidden.label,
    'false',
    'hidden chart series persistence',
    false
  );
  const hiddenAfterRender = hiddenAfterRenderState.pressed;
  console.log('Notebook visual interaction: hidden series persisted across Render');

  await installCanvasTextRecorder(renderer);
  await clearCanvasTextRecorder(renderer);
  await chartDrag();
  const zoomWidth = await waitForRenderer(
    'saved chart completed zoom selection',
    renderer,
    root => root.querySelector('.kx-chart-host .u-select')?.getBoundingClientRect().width || 0,
    value => value <= 1
  );
  const zoomDomainTicks = await waitForCanvasTicks('zoomed chart domain ticks', renderer);
  assert(
    zoomDomainTicks.maximum - zoomDomainTicks.minimum <
      fullDomainTicks.maximum - fullDomainTicks.minimum &&
      (zoomDomainTicks.minimum > fullDomainTicks.minimum ||
        zoomDomainTicks.maximum < fullDomainTicks.maximum),
    'chart drag must narrow the visible x-axis tick domain'
  );
  console.log('Notebook visual interaction: chart zoom narrowed domain');

  await clearCanvasTextRecorder(renderer);
  const settingChange = await renderer.evaluate(root => {
    const view = root.ownerDocument.defaultView;
    const details = root.querySelector('details.kx-settings');
    if (details) {
      details.open = true;
    }
    const density = [...(details?.querySelectorAll('label') || [])]
      .find(label => label.textContent?.trim().startsWith('Density'))
      ?.querySelector('select');
    if (!(density instanceof view.HTMLSelectElement)) {
      throw new Error('chart density setting missing');
    }
    const previous = density.value;
    density.focus();
    density.value = previous === 'compact' ? 'standard' : 'compact';
    density.dispatchEvent(new view.Event('change', { bubbles: true }));
    return { previous, next: density.value };
  });
  const afterSetting = await waitForRenderer(
    'chart settings broadcast rerender',
    renderer,
    (root, hiddenLabel) => ({
      compact: root.classList.contains('kx-density-compact'),
      settingsOpen: root.querySelector('details.kx-settings')?.open === true,
      focusedSetting: (() => {
        const details = root.querySelector('details.kx-settings');
        const density = [...(details?.querySelectorAll('label') || [])]
          .find(label => label.textContent?.trim().startsWith('Density'))
          ?.querySelector('select');
        return root.ownerDocument.activeElement === density ? 'Density' : '';
      })(),
      density: (() => {
        const details = root.querySelector('details.kx-settings');
        return [...(details?.querySelectorAll('label') || [])]
          .find(label => label.textContent?.trim().startsWith('Density'))
          ?.querySelector('select')?.value || '';
      })(),
      hidden: [...root.querySelectorAll('[aria-label^="Toggle chart series "]')]
        .find(legend => legend.getAttribute('aria-label') === hiddenLabel)
        ?.getAttribute('aria-pressed') || '',
      canvases: root.querySelectorAll('.kx-chart-host canvas').length,
      selectionSummary: root.querySelector('.kx-selection-summary')?.textContent || '',
      selectedCells: root.querySelectorAll('td[aria-selected="true"]').length,
    }),
    value => value.density === settingChange.next &&
      value.compact === (settingChange.next === 'compact') &&
      value.settingsOpen && value.focusedSetting === 'Density' &&
      value.hidden === 'false' && value.canvases > 0,
    8_000,
    [hidden.label]
  );
  assert.strictEqual(afterSetting.selectionSummary, '3 rows × 3 columns (9 cells)');
  assert.strictEqual(afterSetting.selectedCells, 9);
  console.log('Notebook visual interaction: Density broadcast preserved chart/selection');
  await installCanvasTextRecorder(renderer);
  await clearCanvasTextRecorder(renderer);
  await forceChartRedraw(renderer);
  const afterSettingTicks = await waitForCanvasTicks(
    'zoomed ticks after settings rerender',
    renderer
  );
  assert(
    afterSettingTicks.minimum >= zoomDomainTicks.minimum &&
      afterSettingTicks.maximum <= zoomDomainTicks.maximum,
    'ordinary settings rerender must preserve the zoomed x-axis domain'
  );
  await scrollNotebookChartIntoView(renderer, cdpPort);
  const hiddenLegendAfterSetting = await captureZoomAfterSetting(hidden.label);

  await clearCanvasTextRecorder(renderer);
  await renderer.evaluate(root => {
    const reset = [...root.querySelectorAll('.kx-chart-controls button')]
      .find(button => button.textContent?.trim() === 'Reset zoom');
    reset?.click();
    return true;
  });
  const resetWidth = await waitForRenderer(
    'saved chart reset zoom',
    renderer,
    root => root.querySelector('.kx-chart-host .u-select')?.getBoundingClientRect().width || 0,
    value => value <= 1
  );
  const resetDomainTicks = await waitForCanvasTicks('reset chart domain ticks', renderer);
  assert(
    resetDomainTicks.minimum < zoomDomainTicks.minimum &&
      resetDomainTicks.maximum > zoomDomainTicks.maximum &&
      resetDomainTicks.maximum - resetDomainTicks.minimum >=
        (fullDomainTicks.maximum - fullDomainTicks.minimum) * 0.75,
    'Reset zoom must restore the full x-axis tick domain'
  );
  console.log('Notebook visual interaction: chart Reset restored full domain');
  await scrollNotebookChartIntoView(renderer, cdpPort);
  await restoreCanvasTextRecorder(renderer);

  const evidence = {
    name: 'saved-range-search-chart',
    search,
    selection,
    savedGridSettingChange,
    savedGridBroadcastFocus,
    savedYChange,
    savedYPersistence,
    rendered,
    legendInteractions: hidden,
    hiddenSeries: hidden.label,
    hiddenAfterRender,
    hiddenAfterRenderState,
    hiddenLegendAfterSetting,
    fullDomainTicks,
    zoomDomainTicks,
    settingChange,
    afterSetting,
    afterSettingTicks,
    zoomSelectionWidth: zoomWidth,
    resetSelectionWidth: resetWidth,
    resetDomainTicks,
  };
  renderer.close();
  return evidence;
}

async function closeResultOverlays(renderer) {
  await renderer.evaluate(root => {
    root.querySelectorAll(
      'details.kx-series-control, details.kx-settings, details.kx-columns'
    ).forEach(details => {
      details.open = false;
    });
    return true;
  });
  await waitForRenderer(
    'chart overlays closed',
    renderer,
    root => [...root.querySelectorAll(
      'details.kx-series-control, details.kx-settings, details.kx-columns'
    )].every(details => details.open === false),
    Boolean
  );
}

async function inspectVisibleChartLegend(renderer, expectedHiddenLabel) {
  await renderer.movePointer(5, 5);
  const evidence = await renderer.evaluate((root, hiddenLabel) => {
    const view = root.ownerDocument.defaultView;
    const rootRect = root.getBoundingClientRect();
    const legend = root.querySelector('.kx-chart-legend .u-legend, .u-legend');
    const legendRect = legend?.getBoundingClientRect();
    const colorCanvas = root.ownerDocument.createElement('canvas');
    colorCanvas.width = 1;
    colorCanvas.height = 1;
    const colorContext = colorCanvas.getContext('2d', { willReadFrequently: true });
    const resolveColor = value => {
      if (!colorContext || !value || /^\[object /.test(String(value))) {
        return undefined;
      }
      colorContext.clearRect(0, 0, 1, 1);
      colorContext.fillStyle = '#000';
      try {
        colorContext.fillStyle = String(value);
      } catch {
        return undefined;
      }
      colorContext.fillRect(0, 0, 1, 1);
      const [red, green, blue, alpha] = colorContext.getImageData(0, 0, 1, 1).data;
      return { red, green, blue, alpha: alpha / 255 };
    };
    const legendBackground =
      resolveColor(view.getComputedStyle(legend?.closest('.kx-chart-legend') || root)
        .backgroundColor) ||
      resolveColor(view.getComputedStyle(root).backgroundColor) ||
      { red: 255, green: 255, blue: 255, alpha: 1 };
    const channel = value => {
      const normalized = value / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    const luminance = color =>
      0.2126 * channel(color.red) +
      0.7152 * channel(color.green) +
      0.0722 * channel(color.blue);
    const contrast = (left, right) => {
      const first = luminance(left);
      const second = luminance(right);
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    };
    const textContrast = (value, opacity) => {
      const foreground = resolveColor(value);
      if (!foreground) {
        return 0;
      }
      const alpha = Math.max(0, Math.min(1, foreground.alpha * opacity));
      const effective = {
        red: foreground.red * alpha + legendBackground.red * (1 - alpha),
        green: foreground.green * alpha + legendBackground.green * (1 - alpha),
        blue: foreground.blue * alpha + legendBackground.blue * (1 - alpha),
      };
      return contrast(effective, legendBackground);
    };
    const transparent = value =>
      !value ||
      value === 'transparent' ||
      /^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(value);
    const items = [...root.querySelectorAll('[aria-label^="Toggle chart series "]')]
      .map(label => {
        const rect = label.getBoundingClientRect();
        const style = view.getComputedStyle(label);
        const marker = label.querySelector('.u-marker');
        const markerRect = marker?.getBoundingClientRect();
        const markerStyle = marker ? view.getComputedStyle(marker) : undefined;
        const row = label.closest('.u-series');
        const markerBackground = markerStyle?.backgroundColor || '';
        const markerBorder = markerStyle?.borderColor || '';
        const swatchColor = transparent(markerBackground)
          ? markerBorder
          : markerBackground;
        const labelOpacity = Number(style.opacity || '1');
        const rowOpacity = Number(row ? view.getComputedStyle(row).opacity || '1' : '1');
        const opacity = labelOpacity * rowOpacity;
        const pressed = label.getAttribute('aria-pressed') || '';
        const off =
          row?.classList.contains('u-off') === true ||
          row?.classList.contains('kx-series-hidden') === true;
        return {
          label: label.getAttribute('aria-label') || '',
          text: label.textContent?.trim() || '',
          pressed,
          role: label.getAttribute('role') || '',
          tabIndex: label.tabIndex,
          off,
          opacity,
          labelOpacity,
          rowOpacity,
          foreground: style.color,
          textContrast: textContrast(style.color, opacity),
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            opacity > 0,
          inResult:
            rect.left >= rootRect.left - 1 &&
            rect.right <= rootRect.right + 1 &&
            rect.top >= rootRect.top - 1 &&
            rect.bottom <= rootRect.bottom + 1,
          inViewport:
            rect.right > 0 &&
            rect.bottom > 0 &&
            rect.left < view.innerWidth &&
            rect.top < view.innerHeight,
          swatch: {
            width: Math.round(markerRect?.width || 0),
            height: Math.round(markerRect?.height || 0),
            background: markerBackground,
            border: markerBorder,
            color: swatchColor,
            visible:
              !!markerRect &&
              markerRect.width >= 6 &&
              markerRect.height >= 6 &&
              !transparent(swatchColor),
          },
        };
      });
    return {
      ariaLabel: legend?.getAttribute('aria-label') || '',
      legendVisible:
        !!legendRect &&
        legendRect.width > 0 &&
        legendRect.height > 0 &&
        view.getComputedStyle(legend).display !== 'none' &&
        view.getComputedStyle(legend).visibility !== 'hidden',
      legendBounds: {
        left: Math.round(legendRect?.left || 0),
        right: Math.round(legendRect?.right || 0),
        top: Math.round(legendRect?.top || 0),
        bottom: Math.round(legendRect?.bottom || 0),
      },
      rootBounds: {
        left: Math.round(rootRect.left),
        right: Math.round(rootRect.right),
        top: Math.round(rootRect.top),
        bottom: Math.round(rootRect.bottom),
      },
      expectedHiddenLabel: hiddenLabel || '',
      items,
    };
  }, expectedHiddenLabel || '');
  assert.strictEqual(evidence.ariaLabel, 'Chart series legend');
  assert.strictEqual(evidence.legendVisible, true);
  assert(evidence.items.length >= 2, 'chart legend must expose at least two series');
  assert(
    evidence.items.every(item =>
      item.visible &&
      item.inResult &&
      item.inViewport &&
      item.swatch.visible &&
      item.role === 'button' &&
      item.tabIndex === 0 &&
      /^(true|false)$/.test(item.pressed) &&
      item.off === (item.pressed === 'false') &&
      (item.pressed === 'false' || item.textContrast >= 4.5)
    ),
    'chart legend items must be visible, readable, color keyed, keyboard reachable, and state accurate: ' +
      JSON.stringify(evidence.items)
  );
  assert(
    new Set(evidence.items.map(item => item.swatch.color)).size >= 2,
    'chart legend must display at least two distinct series colors'
  );
  if (expectedHiddenLabel) {
    const hidden = evidence.items.find(item => item.label === expectedHiddenLabel);
    assert(hidden, `hidden legend item ${expectedHiddenLabel} must remain present`);
    assert.strictEqual(hidden.pressed, 'false');
    assert.strictEqual(hidden.off, true);
    assert(
      hidden.opacity < 0.8 ||
      evidence.items.some(item => item.pressed === 'true' && item.opacity > hidden.opacity),
      'hidden legend item must be visually distinguished'
    );
  }
  return evidence;
}

async function inspectChartSeriesSelectorColors(renderer, themeProbe = '') {
  await renderer.evaluate((root, probe) => {
    const view = root.ownerDocument.defaultView;
    if (probe) {
      view.__kxVisualSeriesThemeProbe = probe;
    }
    const details = root.querySelector(
      '.kx-chart-controls details.kx-series-control'
    );
    if (!details) {
      throw new Error('chart Y-series selector missing for theme inspection');
    }
    details.open = true;
    return true;
  }, themeProbe);
  const evidence = await waitForRenderer(
    'chart Y-series selector plotted-color mapping',
    renderer,
    root => {
      const view = root.ownerDocument.defaultView;
      const details = root.querySelector(
        '.kx-chart-controls details.kx-series-control'
      );
      const transparent = value =>
        !value ||
        value === 'transparent' ||
        /^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(value);
      const elementColor = element => {
        const style = element ? view.getComputedStyle(element) : undefined;
        return transparent(style?.backgroundColor || '')
          ? style?.borderColor || ''
          : style?.backgroundColor || '';
      };
      const selectedOptions = [...root.querySelectorAll('.kx-series-option')]
        .filter(option => option.querySelector('input[type="checkbox"]')?.checked === true)
        .map(option => ({
          name: option.querySelector('.kx-series-name')?.textContent?.trim() || '',
          swatches: [...option.querySelectorAll('.kx-series-swatch')]
            .map(elementColor)
            .filter(color => !transparent(color)),
        }));
      const legendSeries = [
        ...root.querySelectorAll('[aria-label^="Toggle chart series "]'),
      ].map(label => ({
        name: (label.getAttribute('aria-label') || '')
          .replace(/^Toggle chart series /, ''),
        color: elementColor(label.querySelector('.u-marker')),
      }));
      const mappingValid = selectedOptions.every(option => {
        const selectorColors = new Set(option.swatches);
        const plottedColors = new Set(
          legendSeries
            .filter(series =>
              series.name === option.name ||
              series.name.startsWith(`${option.name} [`)
            )
            .map(series => series.color)
        );
        return selectorColors.size > 0 &&
          selectorColors.size === plottedColors.size &&
          [...selectorColors].every(color => plottedColors.has(color));
      });
      return {
        open: details?.open === true,
        themeProbe: view.__kxVisualSeriesThemeProbe || '',
        selectedOptions,
        legendSeries,
        mappingValid,
      };
    },
    value =>
      value.open === true &&
      value.selectedOptions.length >= 2 &&
      value.selectedOptions.every(option => option.swatches.length >= 1) &&
      value.mappingValid === true
  );
  await renderer.evaluate(root => {
    const details = root.querySelector(
      '.kx-chart-controls details.kx-series-control'
    );
    if (details) {
      details.open = false;
    }
    return true;
  });
  await waitForRenderer(
    'chart Y-series selector closed after theme inspection',
    renderer,
    root => root.querySelector(
      '.kx-chart-controls details.kx-series-control'
    )?.open === false,
    Boolean
  );
  return evidence;
}

async function focusLegendToggle(renderer, label) {
  const focused = await renderer.evaluate((root, targetLabel) => {
    const legend = [...root.querySelectorAll('[aria-label^="Toggle chart series "]')]
      .find(candidate => candidate.getAttribute('aria-label') === targetLabel);
    legend?.focus();
    return root.ownerDocument.activeElement === legend;
  }, label);
  assert.strictEqual(focused, true, `chart legend focus failed for ${label}`);
}

async function waitForLegendState(
  renderer,
  label,
  pressed,
  description,
  requireFocus = true
) {
  return waitForRenderer(
    description,
    renderer,
    (root, targetLabel) => {
      const legend = [...root.querySelectorAll('[aria-label^="Toggle chart series "]')]
        .find(candidate => candidate.getAttribute('aria-label') === targetLabel);
      const row = legend?.closest('.u-series');
      const style = legend
        ? root.ownerDocument.defaultView.getComputedStyle(legend)
        : undefined;
      return {
        label: legend?.getAttribute('aria-label') || '',
        pressed: legend?.getAttribute('aria-pressed') || '',
        focused: root.ownerDocument.activeElement === legend,
        off:
          row?.classList.contains('u-off') === true ||
          row?.classList.contains('kx-series-hidden') === true,
        opacity: Number(style?.opacity || '0'),
      };
    },
    value =>
      value.label === label &&
      value.pressed === pressed &&
      (!requireFocus || value.focused) &&
      value.off === (pressed === 'false') &&
      (pressed === 'true' || value.opacity < 0.8),
    8_000,
    [label]
  );
}

async function installCanvasTextRecorder(renderer) {
  await renderer.evaluate(root => {
    const view = root.ownerDocument.defaultView;
    if (!view.__kxVisualCanvasTextRecorder) {
      view.__kxVisualCanvasTextRecorder = { records: [], strokes: [], patches: [] };
    }
    const recorder = view.__kxVisualCanvasTextRecorder;
    recorder.strokes ||= [];
    root.querySelectorAll('.kx-chart-host canvas').forEach(canvas => {
      const context = canvas.getContext('2d');
      if (!context || context.__kxVisualFillTextPatched === true) {
        return;
      }
      const originalFillText = context.fillText;
      const originalStroke = context.stroke;
      context.__kxVisualFillTextPatched = true;
      context.fillText = function (...args) {
        const recorder = view.__kxVisualCanvasTextRecorder;
        recorder?.records.push({
          text: String(args[0]),
          x: Number(args[1]),
          y: Number(args[2]),
          width: this.canvas.width,
          height: this.canvas.height,
          fillStyle: String(this.fillStyle),
          globalAlpha: Number(this.globalAlpha),
        });
        return originalFillText.apply(this, args);
      };
      context.stroke = function (...args) {
        const recorder = view.__kxVisualCanvasTextRecorder;
        recorder?.strokes.push({
          strokeStyle: String(this.strokeStyle),
          lineWidth: Number(this.lineWidth),
          globalAlpha: Number(this.globalAlpha),
        });
        return originalStroke.apply(this, args);
      };
      recorder.patches.push({ context, originalFillText, originalStroke });
    });
    recorder.records.length = 0;
    recorder.strokes.length = 0;
    return !!root.querySelector('.kx-chart-panel');
  });
}

async function clearCanvasTextRecorder(renderer) {
  await renderer.evaluate(root => {
    const view = root.ownerDocument.defaultView;
    if (view.__kxVisualCanvasTextRecorder) {
      view.__kxVisualCanvasTextRecorder.records.length = 0;
      view.__kxVisualCanvasTextRecorder.strokes.length = 0;
    }
    return true;
  });
}

async function restoreCanvasTextRecorder(renderer) {
  await renderer.evaluate(root => {
    const view = root.ownerDocument.defaultView;
    const recorder = view.__kxVisualCanvasTextRecorder;
    recorder?.patches.forEach(patch => {
      patch.context.fillText = patch.originalFillText;
      patch.context.stroke = patch.originalStroke;
      try {
        delete patch.context.__kxVisualFillTextPatched;
      } catch {
        patch.context.__kxVisualFillTextPatched = false;
      }
    });
    delete view.__kxVisualCanvasTextRecorder;
    return true;
  });
}

async function forceChartRedraw(renderer) {
  await renderer.evaluate(root => {
    const view = root.ownerDocument.defaultView;
    const host = root.querySelector('.kx-chart-host');
    if (!(host instanceof view.HTMLElement)) {
      throw new Error('chart host missing for redraw');
    }
    const width = Math.floor(host.getBoundingClientRect().width);
    host.style.width = `${Math.max(320, width - 1)}px`;
    return width;
  });
}

async function waitForCanvasTicks(label, renderer) {
  return waitForRenderer(
    label,
    renderer,
    root => {
      const view = root.ownerDocument.defaultView;
      const records = view.__kxVisualCanvasTextRecorder?.records || [];
      const values = [...new Set(records
        .map(record => String(record.text).trim())
        .filter(text => /^-?\d+(?:\.\d+)?$/.test(text))
        .map(Number)
        .filter(value => Number.isFinite(value) && Math.abs(value) <= 20))]
        .sort((left, right) => left - right);
      return {
        tickTexts: values.map(String),
        minimum: values[0],
        maximum: values[values.length - 1],
        canvasTextCalls: records.length,
        fillStyles: [...new Set(records.map(record => record.fillStyle).filter(Boolean))],
      };
    },
    value => value.tickTexts.length >= 2 &&
      Number.isFinite(value.minimum) &&
      Number.isFinite(value.maximum)
  );
}

async function inspectChartCanvasContrast(renderer) {
  const evidence = await renderer.evaluate(root => {
    const view = root.ownerDocument.defaultView;
    const recorder = view.__kxVisualCanvasTextRecorder;
    const records = recorder?.records || [];
    const strokes = recorder?.strokes || [];
    const colorCanvas = root.ownerDocument.createElement('canvas');
    colorCanvas.width = 1;
    colorCanvas.height = 1;
    const colorContext = colorCanvas.getContext('2d', { willReadFrequently: true });
    const resolveColor = value => {
      if (!colorContext || !value || /^\[object /.test(String(value))) {
        return undefined;
      }
      colorContext.clearRect(0, 0, 1, 1);
      colorContext.fillStyle = '#000';
      try {
        colorContext.fillStyle = String(value);
      } catch {
        return undefined;
      }
      colorContext.fillRect(0, 0, 1, 1);
      const [red, green, blue, alpha] = colorContext.getImageData(0, 0, 1, 1).data;
      return { red, green, blue, alpha: alpha / 255 };
    };
    const chartHost = root.querySelector('.kx-chart-host');
    const rootBackground = resolveColor(view.getComputedStyle(root).backgroundColor) || {
      red: 30,
      green: 30,
      blue: 30,
      alpha: 1,
    };
    const rawBackground = resolveColor(
      chartHost ? view.getComputedStyle(chartHost).backgroundColor : ''
    ) || rootBackground;
    const composite = (foreground, background, additionalAlpha = 1) => {
      const alpha = Math.max(0, Math.min(1, foreground.alpha * additionalAlpha));
      return {
        red: foreground.red * alpha + background.red * (1 - alpha),
        green: foreground.green * alpha + background.green * (1 - alpha),
        blue: foreground.blue * alpha + background.blue * (1 - alpha),
        alpha: 1,
      };
    };
    const background = rawBackground.alpha < 1
      ? composite(rawBackground, rootBackground)
      : rawBackground;
    const channel = value => {
      const normalized = value / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    const luminance = color =>
      0.2126 * channel(color.red) +
      0.7152 * channel(color.green) +
      0.0722 * channel(color.blue);
    const contrast = (left, right) => {
      const first = luminance(left);
      const second = luminance(right);
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    };
    const displayColor = color =>
      `rgb(${Math.round(color.red)}, ${Math.round(color.green)}, ${Math.round(color.blue)})`;
    const effective = (value, globalAlpha) => {
      const parsed = resolveColor(value);
      return parsed ? composite(parsed, background, globalAlpha) : undefined;
    };
    const dominant = (values, keyFor) => {
      const counts = new Map();
      values.forEach(value => {
        const key = keyFor(value);
        if (!key) {
          return;
        }
        const current = counts.get(key) || { key, count: 0, values: [] };
        current.count += 1;
        current.values.push(value);
        counts.set(key, current);
      });
      return [...counts.values()].sort((left, right) => right.count - left.count)[0];
    };
    const numericRecords = records.filter(record =>
      /^-?\d+(?:\.\d+)?$/.test(String(record.text).trim())
    );
    const axisGroup = dominant(
      numericRecords,
      record => `${record.fillStyle}\0${record.globalAlpha}`
    );
    const axisSample = axisGroup?.values[0];
    const axisColor = axisSample
      ? effective(axisSample.fillStyle, axisSample.globalAlpha)
      : undefined;
    const seriesColorKeys = new Set(
      [...root.querySelectorAll('.u-marker')]
        .flatMap(marker => {
          const style = view.getComputedStyle(marker);
          return [style.backgroundColor, style.borderColor];
        })
        .map(value => effective(value, 1))
        .filter(Boolean)
        .map(displayColor)
    );
    const strokeGroups = new Map();
    strokes.forEach(stroke => {
      const color = effective(stroke.strokeStyle, stroke.globalAlpha);
      if (!color) {
        return;
      }
      const colorKey = displayColor(color);
      if (seriesColorKeys.has(colorKey)) {
        return;
      }
      const key = `${colorKey}\0${stroke.lineWidth}`;
      const current = strokeGroups.get(key) || {
        color,
        colorKey,
        lineWidth: stroke.lineWidth,
        count: 0,
      };
      current.count += 1;
      strokeGroups.set(key, current);
    });
    const gridGroup = [...strokeGroups.values()]
      .sort((left, right) =>
        right.count - left.count ||
        left.lineWidth - right.lineWidth)[0];
    return {
      background: displayColor(background),
      numericTextCalls: numericRecords.length,
      totalTextCalls: records.length,
      strokeCalls: strokes.length,
      axis: axisColor
        ? {
          color: displayColor(axisColor),
          raw: String(axisSample.fillStyle),
          calls: axisGroup.count,
          contrast: contrast(axisColor, background),
        }
        : undefined,
      grid: gridGroup
        ? {
          color: gridGroup.colorKey,
          calls: gridGroup.count,
          lineWidth: gridGroup.lineWidth,
          contrast: contrast(gridGroup.color, background),
        }
        : undefined,
    };
  });
  assert(evidence.numericTextCalls >= 2, 'dark chart must draw numeric axis labels');
  assert(evidence.axis, 'dark chart axis text color was not recorded');
  assert(evidence.grid, 'dark chart grid/tick stroke color was not recorded');
  assert(
    evidence.axis.contrast >= 4.5,
    `dark chart axis contrast ${evidence.axis.contrast.toFixed(2)} is below 4.5:1`
  );
  assert(
    evidence.grid.contrast <= evidence.axis.contrast * 0.6,
    `dark chart grid contrast ${evidence.grid.contrast.toFixed(2)} must be materially below axis contrast`
  );
  assert(
    evidence.grid.lineWidth <= 0.5,
    `dark chart grid/tick width ${evidence.grid.lineWidth} must remain restrained`
  );
  return evidence;
}

async function scrollNotebookChartIntoView(renderer, _cdpPort) {
  await revealNotebookOutputBottom();
  return renderer.evaluate(root => {
    const panel = root.querySelector('.kx-chart-panel');
    const host = root.querySelector('.kx-chart-host');
    if (!panel || !host) {
      throw new Error('chart panel/host missing after notebook reveal');
    }
    const bounds = host.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      throw new Error('chart host has no rendered area after notebook reveal');
    }
    return {
      width: bounds.width,
      height: bounds.height,
    };
  });
}

async function revealNotebookOutputBottom() {
  const editor = vscode.window.activeNotebookEditor;
  assert(editor, 'chart navigation requires an active notebook editor');
  const notebook = editor.notebook;
  const sentinelKey = 'vscode-kdb-visual-navigation-sentinel';
  let sentinelIndex = notebook.cellCount - 1;
  if (sentinelIndex < 0 || notebook.cellAt(sentinelIndex).metadata?.[sentinelKey] !== true) {
    const sentinel = new vscode.NotebookCellData(
      vscode.NotebookCellKind.Markup,
      '',
      'markdown'
    );
    sentinel.metadata = { [sentinelKey]: true };
    const edit = new vscode.WorkspaceEdit();
    edit.set(notebook.uri, [
      vscode.NotebookEdit.insertCells(notebook.cellCount, [sentinel]),
    ]);
    assert.strictEqual(
      await vscode.workspace.applyEdit(edit),
      true,
      'failed to add visual notebook navigation sentinel'
    );
    sentinelIndex = notebook.cellCount - 1;
  }
  const range = new vscode.NotebookRange(sentinelIndex, sentinelIndex + 1);
  editor.selections = [range];
  editor.revealRange(range, vscode.NotebookEditorRevealType.InCenter);
  await settleRenderer();
}

async function assertAllNullSavedChartControls(cdpPort, marker) {
  const renderer = await connectNotebookRenderer(cdpPort, marker);
  try {
    const initial = await renderer.evaluate(root => {
      const buttonDisabled = label =>
        [...root.querySelectorAll('.kx-chart-controls button')]
          .find(button => button.textContent?.trim() === label)?.disabled;
      return {
        renderDisabled: buttonDisabled('Render'),
        exportPngDisabled: buttonDisabled('Export PNG'),
        resetDisabled: buttonDisabled('Reset zoom'),
        canvases: root.querySelectorAll('.kx-chart-host canvas').length,
        notice: root.querySelector('.kx-chart-host .kx-notice')?.textContent || '',
        status: root.querySelector('.kx-chart-panel > .kx-status')?.textContent || '',
      };
    });
    assert.strictEqual(initial.renderDisabled, true);
    assert.strictEqual(initial.exportPngDisabled, true);
    assert.strictEqual(initial.resetDisabled, true);
    assert.strictEqual(initial.canvases, 0);
    assert.match(
      `${initial.status} ${initial.notice}`,
      /no finite|no selected y column has finite numeric values|unavailable|not eligible|numeric Y column/i
    );
    await renderer.evaluate(root => {
      const details = root.querySelector('.kx-chart-controls details.kx-series-control');
      if (!details) {
        throw new Error('all-null Y series control missing');
      }
      if (!details.open) {
        details.querySelector('summary')?.click();
      }
      return true;
    });
    await waitForRenderer(
      'all-null Y control opened',
      renderer,
      root => root.querySelector(
        '.kx-chart-controls details.kx-series-control'
      )?.open === true,
      Boolean
    );
    await renderer.evaluate(root => {
      const view = root.ownerDocument.defaultView;
      const details = root.querySelector('.kx-chart-controls details.kx-series-control');
      const option = [...(details?.querySelectorAll('.kx-series-option') || [])]
        .find(label => label.textContent?.trim() === 'valid');
      const checkbox = option?.querySelector('input');
      if (!(checkbox instanceof view.HTMLInputElement)) {
        throw new Error('finite all-null recovery series missing');
      }
      checkbox.focus();
      checkbox.checked = true;
      checkbox.dispatchEvent(new view.Event('change', { bubbles: true }));
      return true;
    });
    const reconfigured = await waitForRenderer(
      'all-null chart re-enabled after valid configuration',
      renderer,
      root => {
        const details = root.querySelector('.kx-chart-controls details.kx-series-control');
        const option = [...(details?.querySelectorAll('.kx-series-option') || [])]
          .find(label => label.textContent?.trim() === 'valid');
        const checkbox = option?.querySelector('input');
        const render = [...root.querySelectorAll('.kx-chart-controls button')]
          .find(button => button.textContent?.trim() === 'Render');
        return {
          renderDisabled: render?.disabled,
          yOpen: details?.open === true,
          validChecked: checkbox?.checked,
          focusedSeries:
            root.ownerDocument.activeElement === checkbox ? 'valid' : '',
        };
      },
      value => value.renderDisabled === false && value.yOpen &&
        value.validChecked && value.focusedSeries === 'valid'
    );
    await renderer.evaluate(root => {
      const render = [...root.querySelectorAll('.kx-chart-controls button')]
        .find(button => button.textContent?.trim() === 'Render');
      render?.focus();
      render?.click();
      return true;
    });
    const recovered = await waitForRenderer(
      'all-null chart finite recovery render',
      renderer,
      root => {
        const buttonDisabled = label =>
          [...root.querySelectorAll('.kx-chart-controls button')]
            .find(button => button.textContent?.trim() === label)?.disabled;
        return {
          canvases: root.querySelectorAll('.kx-chart-host canvas').length,
          exportPngDisabled: buttonDisabled('Export PNG'),
          resetDisabled: buttonDisabled('Reset zoom'),
          focusedControl:
            root.ownerDocument.activeElement?.textContent?.trim() || '',
        };
      },
      value => value.canvases > 0 &&
        value.exportPngDisabled === false &&
        value.resetDisabled === false &&
        value.focusedControl === 'Render'
    );
    return {
      name: 'saved-all-null-chart-guards',
      initial,
      reconfigured,
      recovered,
    };
  } finally {
    renderer.close();
  }
}

async function assertSavedChartFamilies(cdpPort) {
  const familyNames = ['line', 'scatter', 'step', 'bar', 'box', 'candlestick'];
  const families = [];
  for (const type of familyNames) {
    const fixture = savedCases[caseIndex(savedCases, `chart-${type}`)];
    let renderer;
    try {
      const notebook = await openSavedCaseNotebook(fixture);
      await showNotebookCase(notebook, 0);
      renderer = await connectNotebookRenderer(cdpPort, fixture.payload.provenance.label);
      const evidence = await waitForRenderer(
        `saved ${type} chart canvas`,
        renderer,
        root => {
          const typeSelect = [...root.querySelectorAll('.kx-chart-controls label')]
            .find(label => label.textContent?.trim().startsWith('Chart type'))
            ?.querySelector('select');
          const exportPng = [...root.querySelectorAll('.kx-chart-controls button')]
            .find(button => button.textContent?.trim() === 'Export PNG');
          const host = root.querySelector('.kx-chart-host');
          const canvas = host?.querySelector('canvas');
          const dataUrl = canvas?.toDataURL('image/png') || '';
          const encoded = dataUrl.startsWith('data:image/png;base64,')
            ? dataUrl.slice('data:image/png;base64,'.length)
            : '';
          const decoded = encoded ? root.ownerDocument.defaultView.atob(encoded) : '';
          return {
            type: typeSelect?.value || '',
            canvases: host?.querySelectorAll('canvas').length || 0,
            canvasWidth: canvas?.width || 0,
            canvasHeight: canvas?.height || 0,
            hostWidth: Math.round(host?.getBoundingClientRect().width || 0),
            exportPngDisabled: exportPng?.disabled,
            pngBytes: decoded.length,
            pngSignature: [...decoded.slice(0, 8)]
              .map(character => character.charCodeAt(0).toString(16).padStart(2, '0'))
              .join(''),
            notice: host?.querySelector('.kx-notice')?.textContent || '',
          };
        },
        value => value.canvases > 0 &&
          value.canvasWidth > 0 &&
          value.canvasHeight > 0 &&
          value.hostWidth > 100 &&
          value.exportPngDisabled === false &&
          value.pngBytes > 1_000 &&
          value.pngSignature === '89504e470d0a1a0a' &&
          !value.notice,
        15_000
      );
      assert.strictEqual(evidence.type, type);
      families.push(evidence);
    } finally {
      renderer?.close();
      await discardActiveVisualNotebook();
    }
  }
  return {
    name: 'saved-chart-families',
    families,
  };
}

async function exerciseSavedQTextPresentation(cdpPort, marker, captureOptedIn) {
  const renderer = await connectNotebookRenderer(cdpPort, marker);
  try {
    const initial = await renderer.evaluate(root => {
      const setting = label => [...root.querySelectorAll('.kx-settings-panel label')]
        .find(candidate => candidate.textContent?.trim() === label)
        ?.querySelector('input');
      const pre = root.querySelector('[aria-label="qText result"]');
      return {
        highlighting: setting('Highlight qText output')?.checked,
        formatting: setting('Format supported qText output')?.checked,
        text: pre?.textContent || '',
        tokenSpans: pre?.querySelectorAll('[class^="kx-q-"]').length || 0,
      };
    });
    assert.deepStrictEqual(
      {
        highlighting: initial.highlighting,
        formatting: initial.formatting,
        tokenSpans: initial.tokenSpans,
      },
      { highlighting: false, formatting: false, tokenSpans: 0 },
      'qText visual acceptance must start from default-off presentation settings'
    );
    assert(!initial.text.includes('\n'), 'saved qText fixture must begin as one raw line');

    await renderer.evaluate(root => {
      const settings = root.querySelector('details.kx-settings');
      if (!settings) {
        throw new Error('saved qText Settings control missing');
      }
      if (!settings.open) {
        settings.querySelector('summary')?.click();
      }
      return true;
    });
    await toggleQTextSetting(renderer, 'highlighting', true);
    await toggleQTextSetting(renderer, 'formatting', true);
    const optedIn = await waitForRenderer(
      'opted-in qText highlighting and conservative formatting',
      renderer,
      root => {
        const setting = label => [...root.querySelectorAll('.kx-settings-panel label')]
          .find(candidate => candidate.textContent?.trim() === label)
          ?.querySelector('input');
        const pre = root.querySelector('[aria-label="qText result"]');
        return {
          settingsOpen: root.querySelector('details.kx-settings')?.open === true,
          highlighting: setting('Highlight qText output')?.checked,
          formatting: setting('Format supported qText output')?.checked,
          text: pre?.textContent || '',
          tokenSpans: pre?.querySelectorAll('[class^="kx-q-"]').length || 0,
          tokenKinds: [...(pre?.querySelectorAll('[class^="kx-q-"]') || [])]
            .map(span => span.className)
            .filter((value, index, values) => values.indexOf(value) === index),
        };
      },
      value => value.settingsOpen &&
        value.highlighting === true &&
        value.formatting === true &&
        value.text.includes(
          '\n  [x;y] select avg price by sym from trade where price>x\n'
        ) &&
        value.tokenSpans > 3 &&
        value.tokenKinds.includes('kx-q-keyword') &&
        value.tokenKinds.includes('kx-q-builtin') &&
        value.tokenKinds.includes('kx-q-operator')
    );

    await renderer.evaluate(root => {
      const view = root.ownerDocument.defaultView;
      Object.defineProperty(view.navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async value => {
            view.__kxVisualCopiedText = String(value);
          },
        },
      });
      const copy = [...root.querySelectorAll('.kx-saved-toolbar button')]
        .find(button => button.textContent?.trim() === 'Copy');
      if (!copy) {
        throw new Error('saved qText Copy control missing');
      }
      copy.focus();
      copy.click();
      return true;
    });
    const copy = await waitForRenderer(
      'saved qText copy feedback live region',
      renderer,
      root => {
        const status = [...root.querySelectorAll('.kx-status')]
          .find(candidate =>
            /^(Copied\.|Clipboard unavailable\.)$/.test(candidate.textContent?.trim() || ''));
        return {
          message: status?.textContent?.trim() || '',
          role: status?.getAttribute('role') || '',
          ariaLive: status?.getAttribute('aria-live') || '',
          copiedText: root.ownerDocument.defaultView.__kxVisualCopiedText || '',
          focusedControl:
            root.ownerDocument.activeElement?.textContent?.trim() || '',
        };
      },
      value => /^(Copied\.|Clipboard unavailable\.)$/.test(value.message) &&
        value.role === 'status' &&
        value.ariaLive === 'polite' &&
        value.copiedText.length > 0 &&
        value.focusedControl === 'Copy'
    );
    assert.strictEqual(
      copy.copiedText,
      initial.text,
      'qText Copy must preserve the raw source despite opted-in presentation formatting'
    );
    await captureOptedIn();

    await toggleQTextSetting(renderer, 'formatting', false);
    await toggleQTextSetting(renderer, 'highlighting', false);
    const restored = await waitForRenderer(
      'qText presentation settings restored to default off',
      renderer,
      root => {
        const setting = label => [...root.querySelectorAll('.kx-settings-panel label')]
          .find(candidate => candidate.textContent?.trim() === label)
          ?.querySelector('input');
        const pre = root.querySelector('[aria-label="qText result"]');
        return {
          highlighting: setting('Highlight qText output')?.checked,
          formatting: setting('Format supported qText output')?.checked,
          text: pre?.textContent || '',
          tokenSpans: pre?.querySelectorAll('[class^="kx-q-"]').length || 0,
        };
      },
      value => value.highlighting === false &&
        value.formatting === false &&
        value.text === initial.text &&
        value.tokenSpans === 0
    );
    return {
      name: 'saved-qtext-copy-status-a11y',
      initial,
      optedIn,
      copy,
      restored,
      ...copy,
    };
  } finally {
    renderer.close();
  }
}

async function toggleQTextSetting(renderer, setting, checked) {
  const action = setting === 'highlighting'
    ? root => {
        const view = root.ownerDocument.defaultView;
        const input = [...root.querySelectorAll('.kx-settings-panel label')]
          .find(candidate =>
            candidate.textContent?.trim() === 'Highlight qText output')
          ?.querySelector('input');
        if (!(input instanceof view.HTMLInputElement)) {
          throw new Error('Highlight qText output setting missing');
        }
        input.focus();
        input.checked = !input.checked;
        input.dispatchEvent(new view.Event('change', { bubbles: true }));
        return input.checked;
      }
    : root => {
        const view = root.ownerDocument.defaultView;
        const input = [...root.querySelectorAll('.kx-settings-panel label')]
          .find(candidate =>
            candidate.textContent?.trim() === 'Format supported qText output')
          ?.querySelector('input');
        if (!(input instanceof view.HTMLInputElement)) {
          throw new Error('Format supported qText output setting missing');
        }
        input.focus();
        input.checked = !input.checked;
        input.dispatchEvent(new view.Event('change', { bubbles: true }));
        return input.checked;
      };
  const next = await renderer.evaluate(action);
  assert.strictEqual(next, checked);
  await waitForRenderer(
    `qText ${setting} setting ${checked ? 'enabled' : 'disabled'}`,
    renderer,
    root => ({
      highlighting: [...root.querySelectorAll('.kx-settings-panel label')]
        .find(candidate =>
          candidate.textContent?.trim() === 'Highlight qText output')
        ?.querySelector('input')?.checked,
      formatting: [...root.querySelectorAll('.kx-settings-panel label')]
        .find(candidate =>
          candidate.textContent?.trim() === 'Format supported qText output')
        ?.querySelector('input')?.checked,
    }),
    value => value[setting] === checked
  );
}

async function dragNotebookChartInRenderer(renderer) {
  return renderer.evaluate(root => {
    const view = root.ownerDocument.defaultView;
    const overlay = root.querySelector('.kx-chart-host .u-over');
    if (!(overlay instanceof view.HTMLElement)) {
      throw new Error('chart drag overlay is missing');
    }
    const bounds = overlay.getBoundingClientRect();
    if (bounds.width <= 20 || bounds.height <= 20) {
      throw new Error('chart drag overlay has no usable bounds');
    }
    const startX = bounds.left + bounds.width * 0.2;
    const endX = bounds.left + bounds.width * 0.7;
    const y = bounds.top + bounds.height * 0.5;
    const dispatch = (type, x, buttons, movementX = 0) => {
      const event = new view.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
        buttons,
      });
      Object.defineProperty(event, 'movementX', { value: movementX });
      overlay.dispatchEvent(event);
    };
    dispatch('mouseenter', startX, 0);
    dispatch('mousedown', startX, 1);
    for (let step = 1; step <= 6; step += 1) {
      dispatch(
        'mousemove',
        startX + (endX - startX) * (step / 6),
        1,
        (endX - startX) / 6
      );
    }
    dispatch('mouseup', endX, 0);
    return {
      startX,
      endX,
      y,
      coordinateSpace: 'renderer-dom',
    };
  });
}

async function assertNarrowLayout(cdpPort) {
  const saved = await connectNotebookRenderer(cdpPort, 'Saved preview only');
  const live = await connectNotebookRenderer(cdpPort, 'Live full result');
  try {
    const savedEvidence = await saved.evaluate(root => ({
      width: Math.round(root.getBoundingClientRect().width),
      notice: root.querySelector('.kx-notice')?.textContent || '',
      columnCount: root.querySelector('[aria-label="Saved KX result preview table"]')
        ?.getAttribute('aria-colcount') || '',
      buttons: [...root.querySelectorAll('button')].map(button => button.textContent?.trim())
        .filter(Boolean),
      settings:
        root.querySelector('details.kx-settings > summary')?.textContent?.trim() || '',
    }));
    const liveEvidence = await live.evaluate(root => ({
      width: Math.round(root.getBoundingClientRect().width),
      columnCount: root.querySelector('[aria-label="KX result table"]')
        ?.getAttribute('aria-colcount') || '',
      selectionSummaryVisible:
        root.ownerDocument.defaultView
          .getComputedStyle(root.querySelector('.kx-selection-summary')).display !== 'none',
    }));
    assert(savedEvidence.width > 250 && savedEvidence.width < 560);
    assert(liveEvidence.width > 250 && liveEvidence.width < 560);
    assert.match(savedEvidence.notice, /Omitted content is not stored in this notebook/);
    assert.strictEqual(savedEvidence.columnCount, '3');
    assert.strictEqual(liveEvidence.columnCount, '4');
    for (const label of ['Open saved preview', 'Rerun cell']) {
      assert(savedEvidence.buttons.includes(label), `narrow saved preview must retain ${label}`);
    }
    assert.strictEqual(savedEvidence.settings, 'Settings');
    return {
      name: 'narrow-live-saved-layout',
      saved: savedEvidence,
      live: liveEvidence,
    };
  } finally {
    saved.close();
    live.close();
  }
}

async function assertNarrowChartOverlay(renderer) {
  const initial = await renderer.evaluate(root => ({
    width: Math.round(root.getBoundingClientRect().width),
    canvases: root.querySelectorAll('.kx-chart-host canvas').length,
    chartWidth: Math.round(
      root.querySelector('.kx-chart-host')?.getBoundingClientRect().width || 0
    ),
    controls: [...root.querySelectorAll('.kx-chart-controls button')]
      .map(button => button.textContent?.trim())
      .filter(Boolean),
  }));
  assert(initial.width > 250 && initial.width < 560);
  assert(initial.canvases > 0);
  assert(initial.chartWidth > 240 && initial.chartWidth <= initial.width);
  for (const label of ['Render', 'Export PNG', 'Reset zoom']) {
    assert(initial.controls.includes(label), `narrow chart must retain ${label}`);
  }

  await renderer.evaluate(root => {
    const details = root.querySelector('.kx-chart-controls details.kx-series-control');
    if (!details) {
      throw new Error('narrow chart Y-series overlay missing');
    }
    if (!details.open) {
      details.querySelector('summary')?.click();
    }
    const checkbox = details.querySelector('.kx-series-option input');
    checkbox?.focus();
    return true;
  });
  const overlay = await waitForRenderer(
    'narrow chart Y-series overlay containment',
    renderer,
    root => {
      const details = root.querySelector(
        '.kx-chart-controls details.kx-series-control'
      );
      const panel = details?.querySelector('.kx-series-list');
      const rootRect = root.getBoundingClientRect();
      const panelRect = panel?.getBoundingClientRect();
      const view = root.ownerDocument.defaultView;
      const panelStyle = panel ? view.getComputedStyle(panel) : undefined;
      if (panel && panel.scrollHeight > panel.clientHeight) {
        panel.scrollTop = Math.min(40, panel.scrollHeight - panel.clientHeight);
      }
      const transparent = value =>
        !value ||
        value === 'transparent' ||
        /^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(value);
      const options = [...(panel?.querySelectorAll('.kx-series-option') || [])]
        .map(option => {
          const checkbox = option.querySelector('input[type="checkbox"]');
          const name = option.querySelector('.kx-series-name')?.textContent?.trim() ||
            option.textContent?.trim() || '';
          const swatches = [...option.querySelectorAll('.kx-series-swatch')].map(swatch => {
            const rect = swatch.getBoundingClientRect();
            const style = view.getComputedStyle(swatch);
            const color = transparent(style.backgroundColor)
              ? style.borderColor
              : style.backgroundColor;
            return {
              color,
              visible:
                rect.width >= 6 &&
                rect.height >= 6 &&
                !transparent(color),
            };
          });
          return {
            name,
            checked: checkbox?.checked === true,
            swatches,
          };
        });
      const legend = [...root.querySelectorAll('[aria-label^="Toggle chart series "]')]
        .map(label => {
          const marker = label.querySelector('.u-marker');
          const style = marker ? view.getComputedStyle(marker) : undefined;
          return {
            label: label.getAttribute('aria-label') || '',
            color: transparent(style?.backgroundColor || '')
              ? style?.borderColor || ''
              : style?.backgroundColor || '',
          };
        });
      return {
        open: details?.open === true,
        optionCount: options.length,
        focusedTag: root.ownerDocument.activeElement?.tagName || '',
        overflowY: panelStyle?.overflowY || '',
        scrollable:
          !!panel &&
          ['auto', 'scroll'].includes(panelStyle?.overflowY || '') &&
          panel.scrollHeight > panel.clientHeight &&
          panel.scrollTop > 0,
        dimensions: {
          clientHeight: panel?.clientHeight || 0,
          scrollHeight: panel?.scrollHeight || 0,
          scrollTop: panel?.scrollTop || 0,
          panelArea: (panelRect?.width || 0) * (panelRect?.height || 0),
          rootArea: rootRect.width * rootRect.height,
        },
        options,
        legend,
        contained:
          !!panelRect &&
          panelRect.left >= rootRect.left - 1 &&
          panelRect.right <= rootRect.right + 1 &&
          panelRect.top >= rootRect.top - 1 &&
          panelRect.bottom <= rootRect.bottom + 1,
        bounds: {
          rootLeft: Math.round(rootRect.left),
          rootRight: Math.round(rootRect.right),
          rootTop: Math.round(rootRect.top),
          rootBottom: Math.round(rootRect.bottom),
          panelLeft: Math.round(panelRect?.left || 0),
          panelRight: Math.round(panelRect?.right || 0),
          panelTop: Math.round(panelRect?.top || 0),
          panelBottom: Math.round(panelRect?.bottom || 0),
        },
      };
    },
    value => value.open &&
      value.optionCount >= 2 &&
      value.focusedTag === 'INPUT' &&
      value.contained &&
      value.scrollable &&
      value.options.every(option =>
        option.swatches.length >= 1 &&
        option.swatches.every(swatch => swatch.visible)
      ) &&
      value.dimensions.panelArea < value.dimensions.rootArea * 0.65
  );
  const selectedOptions = overlay.options.filter(option => option.checked);
  assert(selectedOptions.length >= 2, 'narrow chart must retain selected Y series');
  for (const option of selectedOptions) {
    const plottedColors = new Set(
      overlay.legend
        .filter(item =>
          item.label === `Toggle chart series ${option.name}` ||
          item.label.startsWith(`Toggle chart series ${option.name} [`)
        )
        .map(item => item.color)
    );
    assert(plottedColors.size > 0, `selected series ${option.name} must appear in the legend`);
    assert(
      option.swatches.every(swatch => plottedColors.has(swatch.color)),
      `selector swatches for ${option.name} must match its plotted legend colors`
    );
  }
  return {
    name: 'narrow-saved-chart-overlay',
    initial,
    overlay,
  };
}

function visualInteractionBoundaries() {
  return [
    {
      actions: ['Copy', 'Ctrl/Cmd+C'],
      reason: 'OS clipboard ownership is not deterministic inside the isolated Xvfb workbench.',
      coverage: 'test/run.js — columnar result windows and exports; notebook renderer sizing, selection, copy, and chart model',
    },
    {
      actions: ['Export', 'Export PNG'],
      reason: 'Native save dialogs and filesystem chooser focus are outside the notebook renderer webview.',
      coverage: 'test/run.js — shared result export metadata, PNG validation, and XLSX generation; shared KX Results panel/notebook UI parity contract',
    },
    {
      actions: ['Open in KX Results', 'Open saved preview'],
      reason: 'Opening the full panel destroys the deterministic inline screenshot state and is asserted at the validated host-message/runtime boundary.',
      coverage: 'test/run.js — shared KX Results panel/notebook UI parity contract; mixed q notebook command and status routing',
    },
    {
      actions: ['Rerun cell', 'stale/reopened preview action result'],
      reason: 'Rerun intentionally replaces output, while stale-handle behavior requires a reopened notebook with no current-session registry entry.',
      coverage: 'test/run.js — shared KX Results panel/notebook UI parity contract; live notebook result registry bounds and lifecycle',
    },
  ];
}

class CdpSession {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.id === undefined) {
        this.events.push(message);
        if (this.events.length > 1_000) {
          this.events.shift();
        }
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new Error(
          `CDP ${pending.method} failed: ${message.error.message || JSON.stringify(message.error)}`
        ));
      } else {
        pending.resolve(message.result);
      }
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`CDP socket closed during ${pending.method}`));
      }
      this.pending.clear();
    });
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`Timed out connecting to CDP target ${url}`));
      }, 5_000);
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(new CdpSession(socket));
      }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error(`Failed to connect to CDP target ${url}`));
      }, { once: true });
    });
  }

  send(method, params = {}) {
    assert.strictEqual(this.socket.readyState, WebSocket.OPEN, 'CDP socket is not open');
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for CDP ${method}`));
      }, 8_000);
      this.pending.set(id, { method, resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, contextId) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
      ...(Number.isSafeInteger(contextId) ? { contextId } : {}),
    });
    if (response.exceptionDetails) {
      const description = response.exceptionDetails.exception?.description ||
        response.exceptionDetails.text ||
        'unknown renderer exception';
      throw new Error(`CDP renderer evaluation failed: ${description}`);
    }
    return response.result?.value;
  }

  close() {
    if (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close();
    }
  }
}

class NotebookRendererCdp {
  constructor(session, marker, targetId, contextId) {
    this.session = session;
    this.marker = marker;
    this.targetId = targetId;
    this.contextId = contextId;
  }

  evaluate(action, ...args) {
    const source = String(action);
    const marker = JSON.stringify(this.marker);
    const serializedArgs = JSON.stringify(args);
    return this.session.evaluate(`(() => {
      const matches = ${KX_ROOT_QUERY_EXPRESSION}
        .map((candidate, index) => {
          const rect = candidate.getBoundingClientRect();
          const style = candidate.ownerDocument.defaultView.getComputedStyle(candidate);
          return {
            candidate,
            index,
            area: rect.width * rect.height,
            visible: candidate.isConnected && rect.width > 0 && rect.height > 0 &&
              style.display !== 'none' && style.visibility !== 'hidden',
          };
        })
        .filter(match => match.candidate.innerText.includes(${marker}));
      matches.sort((left, right) =>
        Number(right.visible) - Number(left.visible) ||
        right.area - left.area ||
        left.index - right.index);
      const root = matches[0]?.candidate;
      if (!root) {
        throw new Error('KX result root not found for marker ' + ${marker});
      }
      return (${source})(root, ...${serializedArgs});
    })()`, this.contextId);
  }

  async click(x, y, { shiftKey = false } = {}) {
    const modifiers = shiftKey ? 8 : 0;
    await this.session.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
      modifiers,
    });
    await this.session.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
      modifiers,
    });
    await delay(100);
  }

  async movePointer(x, y) {
    await this.session.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: 'none',
      buttons: 0,
    });
    await delay(100);
  }

  async drag(startX, startY, endX, endY) {
    await this.session.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: startX,
      y: startY,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    for (let step = 1; step <= 6; step += 1) {
      const ratio = step / 6;
      await this.session.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: startX + (endX - startX) * ratio,
        y: startY + (endY - startY) * ratio,
        button: 'left',
        buttons: 1,
      });
    }
    await this.session.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: endX,
      y: endY,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
    await delay(150);
  }

  async wheel(x, y, deltaY) {
    await this.session.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x,
      y,
      deltaX: 0,
      deltaY,
    });
  }

  async pressKey(key) {
    const keys = {
      Enter: {
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      },
      ' ': {
        key: ' ',
        code: 'Space',
        text: ' ',
        unmodifiedText: ' ',
        windowsVirtualKeyCode: 32,
        nativeVirtualKeyCode: 32,
      },
      Escape: {
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
        nativeVirtualKeyCode: 27,
      },
    };
    const descriptor = keys[key];
    assert(descriptor, `unsupported visual-test key ${String(key)}`);
    await this.session.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      ...descriptor,
    });
    await this.session.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      ...descriptor,
      text: undefined,
      unmodifiedText: undefined,
    });
    await delay(100);
  }

  close() {
    this.session.close();
  }
}

async function connectNotebookRenderer(cdpPort, marker) {
  const deadline = Date.now() + 12_000;
  let lastError;
  let lastTargets = [];
  while (Date.now() <= deadline) {
    let targets = [];
    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
      if (response.ok) {
        targets = await response.json();
        lastTargets = targets.map(target => ({
          type: target.type,
          url: String(target.url || '').slice(0, 240),
          debuggable: typeof target.webSocketDebuggerUrl === 'string',
        }));
      }
    } catch (error) {
      lastError = error;
    }
    // Electron/Chromium has reported notebook webviews as iframe, page, and
    // other targets across VS Code builds. Probe every debuggable target for
    // the semantic KX root marker instead of coupling acceptance to that
    // unstable target classification.
    const rendererTargets = targets
      .filter(target => ['page', 'iframe'].includes(target.type) &&
        typeof target.webSocketDebuggerUrl === 'string')
      .reverse();
    for (const target of rendererTargets) {
      let session;
      try {
        session = await CdpSession.connect(target.webSocketDebuggerUrl);
        await session.send('Runtime.enable');
        await delay(25);
        const contexts = session.events
          .filter(event => event.method === 'Runtime.executionContextCreated' &&
            event.params?.context?.auxData?.isDefault === true &&
            Number.isSafeInteger(event.params.context.id))
          .map(event => event.params.context)
          .reverse();
        for (const context of contexts) {
          try {
            const found = await session.evaluate(
              `${KX_ROOT_QUERY_EXPRESSION}` +
              `.some(root => root.innerText.includes(${JSON.stringify(marker)}))`,
              context.id
            );
            if (found) {
              return new NotebookRendererCdp(session, marker, target.id, context.id);
            }
          } catch (error) {
            lastError = error;
          }
        }
      } catch (error) {
        lastError = error;
      }
      session?.close();
    }
    await delay(100);
  }
  assert.fail(
    `timed out locating notebook renderer marker ${marker}: ` +
    `${lastError instanceof Error ? lastError.message : String(lastError || 'marker not found')}; ` +
    `targets=${JSON.stringify(lastTargets)}`
  );
}

async function waitForRenderer(
  label,
  renderer,
  action,
  predicate,
  timeoutMs = 8_000,
  actionArgs = []
) {
  const deadline = Date.now() + timeoutMs;
  let value;
  let lastError;
  while (Date.now() <= deadline) {
    try {
      value = await renderer.evaluate(action, ...actionArgs);
      if (predicate(value)) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(50);
  }
  assert.fail(
    `timed out waiting for ${label}; last value=${JSON.stringify(value)} ` +
    `last error=${lastError instanceof Error ? lastError.message : String(lastError || '')}`
  );
}

async function setTheme(configuration, theme) {
  await configuration.update('colorTheme', theme, vscode.ConfigurationTarget.Global);
  await settleRenderer();
}

async function showNotebookCase(notebook, index) {
  const editor = await vscode.window.showNotebookDocument(notebook, {
    preserveFocus: false,
    preview: false,
    viewColumn: vscode.ViewColumn.One,
  });
  editor.selections = [new vscode.NotebookRange(index, index + 1)];
  editor.revealRange(
    new vscode.NotebookRange(index, index + 1),
    vscode.NotebookEditorRevealType.InCenter
  );
  await settleRenderer();
}

async function discardActiveVisualNotebook() {
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  await delay(250);
}

async function captureScreenshot(artifactDirectory, fileName, screenSize, metadata) {
  assert(REQUIRED_SCREENSHOTS.includes(fileName), `unexpected screenshot target ${fileName}`);
  const target = path.join(artifactDirectory, fileName);
  const display = x11CaptureDisplay(process.env.DISPLAY);
  const result = cp.spawnSync('/usr/bin/ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'x11grab',
    '-video_size',
    screenSize,
    '-i',
    display,
    '-frames:v',
    '1',
    target,
  ], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (result.error) {
    throw result.error;
  }
  assert.strictEqual(
    result.status,
    0,
    `ffmpeg screenshot ${fileName} failed: ${String(result.stderr || '').trim()}`
  );
  const stat = fs.statSync(target);
  assert(stat.isFile() && stat.size > 1_000, `${fileName} is empty or missing`);
  const signature = fs.readFileSync(target).subarray(0, 8).toString('hex');
  assert.strictEqual(signature, '89504e470d0a1a0a', `${fileName} is not a PNG`);
  const outputEntropy = screenshotOutputEntropy(target, screenSize, metadata.widthMode);
  assert(
    outputEntropy >= 0.01,
    `${fileName} notebook output is blank (normalized entropy ${outputEntropy})`
  );
  return {
    file: target,
    bytes: stat.size,
    outputEntropy,
    ...metadata,
  };
}

function screenshotOutputEntropy(target, screenSize, widthMode) {
  const [width, height] = screenSize.split('x').map(Number);
  const top = 230;
  const cropHeight = Math.min(560, height - top - 30);
  const crop = widthMode === 'split-editor'
    ? {
        width: Math.floor(width * 0.32),
        height: cropHeight,
        left: Math.floor(width * 0.44),
        top,
      }
    : {
        width: Math.floor(width * 0.74),
        height: cropHeight,
        left: 60,
        top,
      };
  const result = cp.spawnSync('/usr/bin/ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'info',
    '-i',
    target,
    '-vf',
    `crop=${crop.width}:${crop.height}:${crop.left}:${crop.top},entropy,metadata=print`,
    '-frames:v',
    '1',
    '-f',
    'null',
    '-',
  ], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (result.error) {
    throw result.error;
  }
  assert.strictEqual(result.status, 0, `failed to inspect screenshot ${target}`);
  const match = String(result.stderr || '').match(
    /lavfi\.entropy\.normalized_entropy\.normal\.G=([0-9.]+)/
  );
  assert(match, `ffmpeg did not report output entropy for ${target}`);
  return Number(match[1]);
}

function liveResultEvidence(notebook) {
  const output = notebook.cellAt(0).outputs[0];
  const reference = output.metadata?.[LIVE_RESULT_METADATA_KEY];
  const payload = outputJson(output, KX_NOTEBOOK_MIME);
  return {
    hasOpaqueLiveReference: !!reference,
    rowCount: payload.result.rowCount,
    savedPreviewRowCount: payload.result.previewRowCount,
    truncatedSavedPreview: payload.result.truncated,
  };
}

function outputJson(output, mime) {
  const item = output.items.find(candidate => candidate.mime === mime);
  assert(item, `missing output item ${mime}`);
  return JSON.parse(Buffer.from(item.data).toString('utf8'));
}

function galleryCaseIds() {
  return [...liveQueries, ...savedCases].map(fixture => fixture.id);
}

function caseIndex(fixtures, id) {
  const index = fixtures.findIndex(fixture => fixture.id === id);
  assert(index >= 0, `gallery case ${id} was not found`);
  return index;
}

async function waitFor(label, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (predicate()) {
      return;
    }
    await delay(50);
  }
  assert.fail(`timed out waiting for ${label}`);
}

async function settleRenderer() {
  await delay(1_800);
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function requiredAbsoluteDirectory(value, label) {
  assert(value, `${label} is required`);
  const resolved = path.resolve(value);
  assert(path.isAbsolute(resolved), `${label} must be absolute`);
  return resolved;
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  assert(Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 65_535,
    `${label} must be a valid TCP port`);
  return parsed;
}

function validScreenSize(value) {
  assert(/^[1-9]\d{2,4}x[1-9]\d{2,4}$/.test(value), 'invalid visual screen size');
  return value;
}

function x11CaptureDisplay(value) {
  assert(/^:\d+(?:\.\d+)?$/.test(value), `invalid X11 DISPLAY ${String(value)}`);
  return /\.\d+$/.test(value) ? value : `${value}.0`;
}

module.exports = { run };
