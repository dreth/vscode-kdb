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
  assert(commands.has('workbench.action.revertAndCloseActiveEditor'),
    'visual acceptance requires the built-in discard-and-close editor command');

  const workbenchConfiguration = vscode.workspace.getConfiguration('workbench');
  const previousTheme = workbenchConfiguration.inspect('colorTheme')?.globalValue;
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
  const screenshots = [];
  const interactions = [];
  try {
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
    await testApi.setActiveConnection(VISUAL_CONNECTION_ID);

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
      interactions.push(await exerciseSettingsOverlay(liveRenderer));
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
    screenshots.push(await captureScreenshot(
      artifactDirectory,
      'light-chart.png',
      screenSize,
      { theme: LIGHT_THEME, caseId: 'chart-line', widthMode: 'wide' }
    ));
    console.log('Notebook visual interaction: line-chart baseline captured');
    try {
      console.log('Notebook visual interaction: saved line renderer connected');
      interactions.push(await exerciseSavedSelectionSearchAndChart(
        savedRenderer,
        async () => {
          screenshots.push(await captureScreenshot(
            artifactDirectory,
            'light-chart-zoom-settings.png',
            screenSize,
            {
              theme: LIGHT_THEME,
              caseId: 'chart-line',
              widthMode: 'wide',
              interaction: 'saved-hidden-series-zoom-preserved-after-density-setting',
            }
          ));
          console.log('Notebook visual interaction: zoom/settings persistence captured');
        },
        () => dragNotebookChartInRenderer(savedRenderer),
        cdpPort
      ));
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
    screenshots.push(await captureScreenshot(
      artifactDirectory,
      'dark-chart.png',
      screenSize,
      { theme: DARK_THEME, caseId: 'chart-line', widthMode: 'wide' }
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
      interactions.push(await assertNarrowChartOverlay(narrowChartRenderer));
      screenshots.push(await captureScreenshot(
        artifactDirectory,
        'narrow-chart-overlay.png',
        screenSize,
        {
          theme: DARK_THEME,
          caseId: 'chart-line',
          widthMode: 'split-editor',
          interaction: 'narrow-saved-chart-y-series-overlay',
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

    const report = {
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
    fs.writeFileSync(
      path.join(artifactDirectory, 'visual-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8'
    );
    console.log(
      `KX notebook visual gallery captured ${screenshots.length} screenshots in ${artifactDirectory}`
    );
  } finally {
    await workbenchConfiguration.update(
      'colorTheme',
      previousTheme,
      vscode.ConfigurationTarget.Global
    ).catch(() => undefined);
    await testApi.removeConnection(VISUAL_CONNECTION_ID).catch(() => undefined);
    await testApi.setActiveConnection(undefined).catch(() => undefined);
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
    outputCollapsed: collapseOutput || fixture.id !== 'live-full-result',
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
  const change = await renderer.evaluate(root => {
    const view = root.ownerDocument.defaultView;
    const columns = root.querySelector('details.kx-columns');
    if (columns) {
      columns.open = false;
    }
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
      const rootRect = root.getBoundingClientRect();
      const panelRect = details?.querySelector('.kx-settings-panel')?.getBoundingClientRect();
      return {
      open: details?.open === true,
      panelVisible: !!details?.querySelector('.kx-settings-panel'),
      settingCount: details?.querySelectorAll('.kx-settings-panel > label').length || 0,
      focusedTag: root.ownerDocument.activeElement?.tagName || '',
      focusedSetting: root.ownerDocument.activeElement === density ? 'Density' : '',
        density: density?.value || '',
        compact: root.classList.contains('kx-density-compact'),
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
    value => value.open && value.focusedSetting === 'Density' &&
      value.density === change.next &&
      value.compact === (change.next === 'compact') &&
      value.contained
  );
  assert.strictEqual(overlay.open, true);
  assert.strictEqual(overlay.panelVisible, true);
  assert(overlay.settingCount >= 18, 'shared settings overlay must expose the shared schema');
  assert.strictEqual(overlay.focusedTag, 'SELECT');
  assert.strictEqual(overlay.focusedSetting, 'Density');
  return {
    name: 'shared-settings-overlay',
    change,
    ...overlay,
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
  const hidden = await renderer.evaluate(root => {
    const view = root.ownerDocument.defaultView;
    const legend = root.querySelector('[aria-label^="Toggle chart series "]');
    legend?.focus();
    legend?.dispatchEvent(new view.KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
    }));
    return {
      label: legend?.getAttribute('aria-label') || '',
      pressed: legend?.getAttribute('aria-pressed') || '',
      focused: root.ownerDocument.activeElement === legend,
    };
  });
  assert.match(hidden.label, /^Toggle chart series /);
  assert.strictEqual(hidden.pressed, 'false');
  assert.strictEqual(hidden.focused, true);

  await renderer.evaluate(root => {
    const render = [...root.querySelectorAll('.kx-chart-controls button')]
      .find(button => button.textContent?.trim() === 'Render');
    render?.click();
    return true;
  });
  const hiddenAfterRender = await waitForRenderer(
    'hidden chart series persistence',
    renderer,
    root => root.querySelector('[aria-label^="Toggle chart series "]')
      ?.getAttribute('aria-pressed') || '',
    value => value === 'false'
  );
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
    root => ({
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
      hidden: root.querySelector('[aria-label^="Toggle chart series "]')
        ?.getAttribute('aria-pressed') || '',
      canvases: root.querySelectorAll('.kx-chart-host canvas').length,
      selectionSummary: root.querySelector('.kx-selection-summary')?.textContent || '',
      selectedCells: root.querySelectorAll('td[aria-selected="true"]').length,
    }),
    value => value.density === settingChange.next &&
      value.compact === (settingChange.next === 'compact') &&
      value.settingsOpen && value.focusedSetting === 'Density' &&
      value.hidden === 'false' && value.canvases > 0
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
  await captureZoomAfterSetting();

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
    hiddenSeries: hidden.label,
    hiddenAfterRender,
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

async function installCanvasTextRecorder(renderer) {
  await renderer.evaluate(root => {
    const view = root.ownerDocument.defaultView;
    if (!view.__kxVisualCanvasTextRecorder) {
      view.__kxVisualCanvasTextRecorder = { records: [], patches: [] };
    }
    const recorder = view.__kxVisualCanvasTextRecorder;
    root.querySelectorAll('.kx-chart-host canvas').forEach(canvas => {
      const context = canvas.getContext('2d');
      if (!context || context.__kxVisualFillTextPatched === true) {
        return;
      }
      const original = context.fillText;
      context.__kxVisualFillTextPatched = true;
      context.fillText = function (...args) {
        const recorder = view.__kxVisualCanvasTextRecorder;
        recorder?.records.push({
          text: String(args[0]),
          x: Number(args[1]),
          y: Number(args[2]),
          width: this.canvas.width,
          height: this.canvas.height,
        });
        return original.apply(this, args);
      };
      recorder.patches.push({ context, original });
    });
    recorder.records.length = 0;
    return !!root.querySelector('.kx-chart-panel');
  });
}

async function clearCanvasTextRecorder(renderer) {
  await renderer.evaluate(root => {
    const view = root.ownerDocument.defaultView;
    if (view.__kxVisualCanvasTextRecorder) {
      view.__kxVisualCanvasTextRecorder.records.length = 0;
    }
    return true;
  });
}

async function restoreCanvasTextRecorder(renderer) {
  await renderer.evaluate(root => {
    const view = root.ownerDocument.defaultView;
    const recorder = view.__kxVisualCanvasTextRecorder;
    recorder?.patches.forEach(patch => {
      patch.context.fillText = patch.original;
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
      };
    },
    value => value.tickTexts.length >= 2 &&
      Number.isFinite(value.minimum) &&
      Number.isFinite(value.maximum)
  );
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
      /no finite|unavailable|not eligible|numeric Y column/i
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
      return {
        open: details?.open === true,
        optionCount: panel?.querySelectorAll('.kx-series-option').length || 0,
        focusedTag: root.ownerDocument.activeElement?.tagName || '',
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
    value => value.open &&
      value.optionCount >= 2 &&
      value.focusedTag === 'INPUT' &&
      value.contained
  );
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

  evaluate(action) {
    const source = String(action);
    const marker = JSON.stringify(this.marker);
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
      return (${source})(root);
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

async function waitForRenderer(label, renderer, action, predicate, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  let lastError;
  while (Date.now() <= deadline) {
    try {
      value = await renderer.evaluate(action);
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
