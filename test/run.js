'use strict';

const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const net = require('net');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const {
  KdbIpcClient,
  KdbQError,
  KdbQueryCanceledError,
  QIpcReceiveBuffer,
  deserializeQMessage,
  deserializeQPayload,
  qValueRowsMaterialized,
  qValueToColumnarPanel,
  serializeTextQuery,
} = requireOut('q-ipc');
const {
  formatQTextForDisplay,
  lexQText,
  qSelectionExecutionKind,
  qTextRenderModel,
  selectedTextOrCurrentLine,
} = requireOut('q-text');
const {
  captureChartFullXRange,
  chartZoomDataAfterResponse,
  chartRangeIsZoomed,
  planChartZoomReset,
} = requireOut('chart-zoom');
const {
  DEFAULT_CONNECTION_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  connectionSessionChanged,
  connectionEndpoint,
  normalizeNamespace,
  parseOptionalTimeout,
  qScriptInNamespace,
  qString,
  queryInNamespace,
  queryInNamespaceStrict,
  resolveConnectionTimeouts,
  safeTimeoutMs,
  safeStoredConnections,
  validateConnection,
} = requireOut('connection');
const {
  ConnectionMigrationCommand,
  LEGACY_CONNECTION_TIMEOUT_SECONDS,
  LEGACY_KDB_DRIVER_ALIASES,
  SQLTOOLS_SSH_UNSUPPORTED_REASON,
  discoverSqlToolsConnections,
  findImportConflicts,
  mapSqlToolsCandidate,
  migrationCandidateReviewDetail,
  normalizeLegacyDriverAlias,
  parseSqlToolsConnection,
  readConfirmedCandidatePassword,
  readSqlToolsConfigurationScopes,
  sanitizeConnectionLabel,
  sqlToolsCandidateIdentity,
  suggestImportedConnectionName,
} = requireOut('connection-migration');
const {
  ConnectionFormValidationError,
  parseConnectionFormPayload,
  passwordUpdateForForm,
} = requireOut('connection-form-model');
const {
  CONNECTION_TEST_QUERY,
  ConnectionTestError,
  connectionTestNamespaceQuery,
  connectionTestNamespaceResultIsSafe,
} = requireOut('connection-test');
const { persistConnectionUpdate } = requireOut('connection-lifecycle');
const {
  KX_OUTPUT_CHANNEL_NAME,
  KxDiagnostics,
  REDACTED_DIAGNOSTIC_VALUE,
  redactDiagnosticText,
  sanitizeDiagnosticDetails,
} = requireOut('diagnostics');
const {
  configurePerfOutput,
  configurePerfTrace,
  perfMark,
} = requireOut('perf');
const {
  createColumnarPanelResult,
  rowsToColumnarPanelResult,
} = requireOut('kx-results');
const {
  DEFAULT_NOTEBOOK_BYTE_LIMIT,
  DEFAULT_NOTEBOOK_ROW_LIMIT,
  KX_NOTEBOOK_MIME,
  MAX_NOTEBOOK_BYTE_LIMIT,
  MAX_NOTEBOOK_ROW_LIMIT,
  MIN_NOTEBOOK_BYTE_LIMIT,
  MIN_NOTEBOOK_ROW_LIMIT,
  createPortableKxResult,
  notebookResultPlainText,
  notebookResultStaticHtml,
  notebookResultToCsv,
  portableKxResultBytes,
  validatePortableKxResult,
} = requireOut('notebook-contract');
const {
  hasNotebookQMarker,
  notebookQMagicLine,
  safeNotebookByteLimit,
  safeNotebookPresentation,
  safeNotebookRowLimit,
} = requireOut('notebook-settings');
const {
  LiveNotebookResultStore,
  MAX_LIVE_NOTEBOOK_SEARCH_MATCHES,
  MAX_LIVE_NOTEBOOK_SLICE_CELLS,
  MAX_LIVE_NOTEBOOK_SLICE_COLUMNS,
  MAX_LIVE_NOTEBOOK_SLICE_ROWS,
  MAX_LIVE_NOTEBOOK_SLICE_TEXT_CHARS,
  MAX_LIVE_NOTEBOOK_SORT_CACHE_ENTRIES,
} = requireOut('notebook-live-results');
const {
  NotebookCellLanguageProvider,
  jupyterNotebookDefaultLanguageId,
  selectedNotebookCellIndexes,
} = requireOut('notebook-cell-language');
const {
  KX_NOTEBOOK_METADATA_KEY,
  KX_NOTEBOOK_METADATA_VERSION,
  notebookQMarkerInsertion,
  preparedNotebookQCellMetadata,
} = requireOut('notebook-cell-preparation');
const {
  MAX_NOTEBOOK_LIVE_SLICE_TEXT_CHARS,
  notebookRendererSettingsMessage,
  parseNotebookLiveResultReference,
  parseNotebookRendererHostMessage,
  parseNotebookRendererMessage,
} = requireOut('notebook-message');
const {
  DEFAULT_SERVER_PREVIEW_CELL_LIMIT,
  MAX_SERVER_PREVIEW_CELL_LIMIT,
  MIN_SERVER_PREVIEW_CELL_LIMIT,
  SERVER_TABLES_QUERY,
  SERVER_VARIABLES_QUERY,
  buildServerPreviewQuery,
  buildServerTableMetaQuery,
  parseServerColumns,
  parseServerTableNames,
  parseServerVariables,
  qMetaTypeName,
  safeServerPreviewCellLimit,
  serverExplorerSnapshotMatches,
  serverPreviewWarning,
  validateServerObjectIdentifier,
} = requireOut('server-explorer-model');
const {
  DEFAULT_QUERY_HISTORY_MAX_ENTRIES,
  MAX_QUERY_HISTORY_MAX_ENTRIES,
  MIN_QUERY_HISTORY_MAX_ENTRIES,
  QUERY_HISTORY_STORAGE_KEY,
  QueryHistoryStore,
  historyRerunRequiresConfirmation,
  historyTransportKind,
  normalizeQueryHistoryEntries,
  normalizeQueryHistoryEntry,
  safeHistoryLimit,
  sortHistoryNewestFirst,
} = requireOut('query-history-model');

const tests = [
  ['q IPC codec and receive buffering', testQIpc],
  ['diagnostics and performance trace redaction', testDiagnostics],
  ['exact q selection/current-line text', testQText],
  ['qText result settings and live panel updates', testQTextResultPanelSettings],
  ['connection validation and namespace wrapping', testConnections],
  ['SQLTools migration parsing and mapping', testSqlToolsMigrationParsing],
  ['SQLTools migration configuration discovery', testSqlToolsMigrationDiscovery],
  ['SQLTools migration consent, conflicts, and persistence', testSqlToolsMigrationCommand],
  ['server explorer request and metadata model', testServerExplorerModel],
  ['query history privacy and persistence model', testQueryHistoryModel],
  ['webview-free server and history tree providers', testTreeProviders],
  ['feature controls enable and disable lifecycle', testFeatureControlsLifecycle],
  ['connection form payload and password semantics', testConnectionFormModel],
  ['connection webview lifecycle', testConnectionFormPanelLifecycle],
  ['connection form host testing', testConnectionFormHostTesting],
  ['connection SecretStorage transactions', testConnectionStoreTransactions],
  ['post-persist active connection lifecycle', testConnectionUpdateLifecycle],
  ['connection manager lifecycle races', testConnectionManagerLifecycle],
  ['chart zoom baseline and reset lifecycle', testChartZoomLifecycle],
  ['columnar result windows and exports', testColumnarResults],
  ['actual notebook cell language provider and q preparation', testNotebookCellLanguage],
  ['portable notebook MIME contract and static fallbacks', testNotebookContract],
  ['live notebook result registry bounds and lifecycle', testLiveNotebookResultStore],
  ['native direct q notebook controller provider', testDirectQNotebookController],
  ['local data server start/stop concurrency', testLocalDataServerConcurrency],
  ['extension manifest and standalone-source guards', testManifestAndSources],
];

(async () => {
  for (const [name, test] of tests) {
    await test();
    process.stdout.write(`ok - ${name}\n`);
  }
  process.stdout.write(`\n${tests.length} focused test groups passed.\n`);
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

function testChartZoomLifecycle() {
  let deferredFull = captureChartFullXRange(null, null, false);
  assert.strictEqual(deferredFull, null, 'pre-commit scale state must not invent a baseline');
  const initialCandidate = { min: 0, max: 100 };
  deferredFull = captureChartFullXRange(deferredFull, initialCandidate, false);
  const full = deferredFull;
  assert.deepStrictEqual(full, { min: 0, max: 100 });
  assert.ok(Object.isFrozen(full), 'the original full X range must be immutable');
  initialCandidate.min = 25;
  assert.deepStrictEqual(full, { min: 0, max: 100 }, 'baseline capture must copy the rendered range');
  const replacement = captureChartFullXRange(full, { min: 200, max: 300 }, false);
  assert.deepStrictEqual(replacement, { min: 200, max: 300 }, 'a new base render must capture its own full domain');
  assert.notStrictEqual(replacement, full);

  const originalSample = {
    requestId: 1,
    x: [0, 50, 100],
    series: [{ columnName: 'price', values: [10, 20, 30] }],
  };
  const initialDataState = chartZoomDataAfterResponse(null, originalSample, false);
  assert.strictEqual(initialDataState.data, originalSample);
  assert.strictEqual(initialDataState.originalData, originalSample, 'base response must capture the original sample');
  assert.strictEqual(initialDataState.dataIsRefinement, false);

  const manualZoom = { min: 20, max: 40 };
  assert.strictEqual(chartRangeIsZoomed(full, manualZoom), true, 'manual drag range must be detected as zoomed');
  const manualReset = planChartZoomReset(
    initialDataState.data,
    initialDataState.originalData,
    initialDataState.dataIsRefinement,
    full,
    1
  );
  assert.strictEqual(manualReset.data, originalSample);
  assert.strictEqual(manualReset.restoredOriginalData, false);
  assert.strictEqual(manualReset.dataIsRefinement, false);
  assert.strictEqual(manualReset.requestIsRefinement, false);
  assert.deepStrictEqual(manualReset.xScale, full, 'manual reset must target the immutable original X range');
  assert.notStrictEqual(manualReset.xScale, full, 'the plot scale input must stay separate from the baseline object');
  assert.deepStrictEqual(manualReset.yScale, { min: null, max: null }, 'manual reset must restore Y auto-scale');
  assert.strictEqual(chartRangeIsZoomed(full, manualReset.xScale), false, 'manual zoom reset must return to the baseline');
  assert.strictEqual(manualReset.autoRefineKey, '');
  assert.strictEqual(manualReset.clearAutoRefineTimer, true);
  assert.strictEqual(manualReset.clearSelection, true);
  assert.strictEqual(manualReset.hideTooltip, true);

  const refinedSample = {
    requestId: 2,
    x: [20, 30, 40],
    series: [{ columnName: 'price', values: [14, 16, 18] }],
  };
  const refinedDataState = chartZoomDataAfterResponse(
    initialDataState.originalData,
    refinedSample,
    true
  );
  assert.strictEqual(refinedDataState.data, refinedSample);
  assert.strictEqual(refinedDataState.originalData, originalSample, 'refinement must preserve the original sample');
  assert.strictEqual(refinedDataState.dataIsRefinement, true);
  const refinedRender = { min: 20, max: 40 };
  const afterRefine = captureChartFullXRange(full, refinedRender, true);
  assert.strictEqual(afterRefine, full, 'refinement render must retain the original baseline object');
  assert.strictEqual(chartRangeIsZoomed(afterRefine, refinedRender), true);
  const afterRefineRerender = captureChartFullXRange(afterRefine, { min: 21, max: 39 }, true);
  assert.strictEqual(afterRefineRerender, full, 'refinement rerender must not replace the original domain');
  const refinedReset = planChartZoomReset(
    refinedDataState.data,
    refinedDataState.originalData,
    refinedDataState.dataIsRefinement,
    afterRefineRerender,
    3
  );
  assert.strictEqual(refinedReset.restoredOriginalData, true);
  assert.notStrictEqual(refinedReset.data, originalSample, 'restoration must not mutate the retained sample object');
  assert.deepStrictEqual(refinedReset.data, { ...originalSample, requestId: 3 });
  assert.deepStrictEqual(originalSample, {
    requestId: 1,
    x: [0, 50, 100],
    series: [{ columnName: 'price', values: [10, 20, 30] }],
  });
  assert.strictEqual(refinedReset.dataIsRefinement, false);
  assert.strictEqual(refinedReset.requestIsRefinement, false);
  assert.deepStrictEqual(refinedReset.xScale, full, 'refined reset must target the original domain, not the refined range');
  assert.notStrictEqual(refinedReset.xScale, full);
  assert.deepStrictEqual(refinedReset.yScale, { min: null, max: null });
  assert.strictEqual(chartRangeIsZoomed(full, refinedReset.xScale), false);
  assert.strictEqual(refinedReset.autoRefineKey, '');
  assert.strictEqual(refinedReset.clearAutoRefineTimer, true);
  assert.strictEqual(refinedReset.clearSelection, true);
  assert.strictEqual(refinedReset.hideTooltip, true);

  const numericEpsilonFull = { min: -50, max: 50 };
  assert.strictEqual(chartRangeIsZoomed(numericEpsilonFull, { min: -50 + 5e-8, max: 50 - 5e-8 }), false);
  assert.strictEqual(chartRangeIsZoomed(numericEpsilonFull, { min: -50 + 2e-7, max: 50 }), true);
  const day = 24 * 60 * 60 * 1000;
  const temporalFull = { min: 1700000000000, max: 1700000000000 + day };
  assert.strictEqual(chartRangeIsZoomed(temporalFull, { min: temporalFull.min + 0.01, max: temporalFull.max }), false);
  assert.strictEqual(chartRangeIsZoomed(temporalFull, { min: temporalFull.min + 1, max: temporalFull.max }), true);
  assert.strictEqual(captureChartFullXRange(null, { min: 4, max: 4 }, false), null);
  assert.strictEqual(chartRangeIsZoomed(full, { min: NaN, max: 40 }), false);

  const panelSource = readSource('kx-results-panel.ts');
  const zoomSource = readSource('chart-zoom.ts');
  assert.match(zoomSource, /return Object\.freeze\(\{ min: rendered\.min, max: rendered\.max \}\)/);
  assert.match(panelSource, /let chartOriginalData = null;/);
  assert.match(panelSource, /let chartDataIsRefinement = false;/);
  assert.match(panelSource, /\$\{isValidChartRange\.toString\(\)\}/);
  assert.match(panelSource, /\$\{captureChartFullXRange\.toString\(\)\}/);
  assert.match(panelSource, /\$\{chartZoomDataAfterResponse\.toString\(\)\}/);
  assert.match(panelSource, /\$\{planChartZoomReset\.toString\(\)\}/);
  assert.match(panelSource, /\$\{chartRangeIsZoomed\.toString\(\)\}/);
  assert.match(panelSource, /<button id="resetChartZoom" disabled>Reset zoom<\/button>/);
  assert.match(panelSource, /resetChartZoomButton\.addEventListener\('click', resetChartZoom\)/);
  assert.match(panelSource, /setScale: \[updateChartZoomState\]/);
  assert.match(panelSource, /chartFullXRange = captureChartFullXRange\([\s\S]*?chartDataIsRefinement \|\| !!chartFullXRange[\s\S]*?\);/);
  const zoomStateSource = sourceSection(panelSource, '      function updateChartZoomState(self) {', '      function currentChartZoomRange() {');
  assert.match(zoomStateSource, /const currentRange = chartXScaleRange\(self\);/);
  assert.match(zoomStateSource, /if \(!chartFullXRange && !chartDataIsRefinement\)/);
  assert.match(zoomStateSource, /chartFullXRange = captureChartFullXRange\(null, currentRange, false\);/);
  assert.match(zoomStateSource, /chartZoomed = chartRangeIsZoomed\(chartFullXRange, currentRange\);/);

  const chartDataSource = sourceSection(panelSource, '      function setChartData(value) {', '      function normalizeChartData(value) {');
  assert.match(chartDataSource, /const chartDataState = chartZoomDataAfterResponse\(/);
  assert.match(chartDataSource, /chartOriginalData = chartDataState\.originalData;/);
  assert.match(chartDataSource, /chartDataIsRefinement = chartDataState\.dataIsRefinement;/);

  const resetSource = sourceSection(panelSource, '      function resetChartZoom() {', '      function clearChartZoomTransientState() {');
  assert.match(resetSource, /const reset = planChartZoomReset\(/);
  assert.match(resetSource, /chartData = reset\.data;/);
  assert.match(resetSource, /chartDataIsRefinement = reset\.dataIsRefinement;/);
  assert.match(resetSource, /chartRequestIsRefinement = reset\.requestIsRefinement;/);
  assert.match(resetSource, /if \(reset\.restoredOriginalData\) \{[\s\S]*?drawChart\(\);[\s\S]*?\}/);
  assert.match(resetSource, /chartUPlot\.setScale\('x', reset\.xScale\);/);
  assert.match(resetSource, /chartUPlot\.setScale\('y', reset\.yScale\);/);
  assert.match(resetSource, /chartLastAutoRefineKey = reset\.autoRefineKey;/);
  assert.match(resetSource, /if \(reset\.clearAutoRefineTimer\) \{[\s\S]*?clearChartAutoRefineTimer\(\);/);
  assert.match(resetSource, /if \(reset\.clearSelection\) \{[\s\S]*?clearChartSelection\(\);/);
  assert.match(resetSource, /if \(reset\.hideTooltip\) \{[\s\S]*?hideChartTooltip\(\);/);

  const optionsSource = sourceSection(panelSource, '      function renderChartOptions() {', '      function populateCandlestickColumnSelect');
  assert.match(optionsSource, /if \(!chartRendered\) \{[\s\S]*?clearChartZoomBaseline\(\);[\s\S]*?\}/);
  assert.ok(!/clearChartZoomBaseline\(\);\s*chartXColumn/.test(optionsSource), 'option refresh must preserve a rendered chart baseline');

  const requestSource = sourceSection(panelSource, '      function requestChartDataForRange(xRange, messageText) {', '      function exportChartPng() {');
  assert.match(requestSource, /type: 'requestChart'/);
  assert.match(requestSource, /version: data\.version/);
  assert.match(requestSource, /requestId: latestChartRequestId/);
  assert.match(requestSource, /message\.xMin = xRange\.min;/);
  assert.match(requestSource, /message\.xMax = xRange\.max;/);
  assert.match(chartDataSource, /toNonNegativeInteger\(value\.version, -1\) !== data\.version/);
  assert.match(chartDataSource, /toNonNegativeInteger\(value\.requestId, -1\) !== latestChartRequestId/);
  const messageSource = sourceSection(panelSource, "        } else if (msg.type === 'chartData' && msg.data) {", "      actionFormat.addEventListener('change'");
  assert.match(messageSource, /setChartData\(msg\.data\);/);
}

async function testQIpc() {
  assert.strictEqual(
    serializeTextQuery('1+1').toString('hex'),
    '01010000110000000a0003000000312b31',
    'q queries must be synchronous char-vector IPC messages'
  );
  assert.strictEqual(deserializeQMessage(hex('010000000d000000fa01000000')), 1);
  assert.deepStrictEqual(deserializeQPayload(intVector([1, -2, 3])), [1, -2, 3]);

  const scalarMessage = hex('010000000d000000fa01000000');
  const fragmented = new QIpcReceiveBuffer();
  fragmented.append(scalarMessage.subarray(0, 3));
  fragmented.append(scalarMessage.subarray(3, 8));
  assert.strictEqual(fragmented.readMessage(), null);
  fragmented.append(scalarMessage.subarray(8, 11));
  assert.strictEqual(fragmented.readMessage(), null);
  fragmented.append(scalarMessage.subarray(11));
  assert.strictEqual(fragmented.readMessage().toString('hex'), scalarMessage.toString('hex'));
  assert.strictEqual(fragmented.bufferedBytes, 0);
  assert.strictEqual(fragmented.copyCount, 1, 'a fragmented message should be copied once');
  assert.strictEqual(fragmented.copyBytesCopied, scalarMessage.length);

  const secondMessage = serializeTextQuery('show 42');
  const combinedChunk = Buffer.concat([scalarMessage, secondMessage]);
  const combined = new QIpcReceiveBuffer();
  combined.append(combinedChunk);
  const first = combined.readMessage();
  const second = combined.readMessage();
  assert.strictEqual(first.toString('hex'), scalarMessage.toString('hex'));
  assert.strictEqual(second.toString('hex'), secondMessage.toString('hex'));
  assert.strictEqual(first.buffer, combinedChunk.buffer, 'contiguous messages should use zero-copy slices');
  assert.strictEqual(second.buffer, combinedChunk.buffer);
  assert.strictEqual(combined.readMessage(), null);
  assert.strictEqual(combined.copyCount, 0);

  const invalidEndian = Buffer.from(scalarMessage);
  invalidEndian[0] = 2;
  const invalidBuffer = new QIpcReceiveBuffer();
  invalidBuffer.append(invalidEndian);
  assert.throws(() => invalidBuffer.readMessage(), /Invalid q IPC endian flag 2/);
  assert.throws(() => deserializeQPayload(vectorHeader(20, 1)), /Unsupported q IPC type 20/);

  const table = deserializeQPayload(qTable(
    ['sym', 'size'],
    [symbolVector(['AAPL', 'MSFT']), intVector([100, 250])]
  ));
  assert.strictEqual(qValueRowsMaterialized(table), false);
  const panel = qValueToColumnarPanel(table);
  assert.strictEqual(panel.mode, 'grid');
  assert.deepStrictEqual(panel.cols, ['sym', 'size']);
  assert.deepStrictEqual(
    panel.result.cellWindow({ start: 0, end: 1 }, { start: 0, end: 1 }).cells,
    [['AAPL', '100'], ['MSFT', '250']]
  );
  assert.strictEqual(qValueRowsMaterialized(table), false, 'viewer conversion must stay columnar/lazy');
  const server = net.createServer();
  await listen(server);
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  await closeServer(server);
  await assert.rejects(
    () => new KdbIpcClient({ host: '127.0.0.1', port, timeoutMs: 500 }).connect(),
    error => error &&
      error.name === 'KdbIpcError' &&
      error.phase === 'connect' &&
      error.message.includes(`127.0.0.1:${port}`) &&
      /connect failed/i.test(error.message),
    'connection errors must identify the direct q host and port'
  );

  let resetConnections = 0;
  const resetServer = net.createServer(socket => {
    resetConnections++;
    socket.destroy();
  });
  await listen(resetServer);
  const resetAddress = resetServer.address();
  const resetPort = resetAddress && typeof resetAddress === 'object' ? resetAddress.port : 0;
  const resetClient = new KdbIpcClient({ host: '127.0.0.1', port: resetPort, timeoutMs: 500 });
  try {
    for (const attempt of ['initial', 'retry']) {
      await assertCompletesWithin(
        `q IPC handshake reset ${attempt}`,
        () => assert.rejects(
          () => resetClient.connect(),
          error => error &&
            error.phase === 'handshake' &&
            /handshake failed/i.test(error.message) &&
            error.message.includes(`127.0.0.1:${resetPort}`)
        ),
        1000
      );
    }
    assert.strictEqual(resetConnections, 2, 'a failed handshake must clear connectPromise for retry');
  } finally {
    await closeServer(resetServer);
  }

  const heldSockets = [];
  const stalledServer = net.createServer(socket => heldSockets.push(socket));
  const accepted = new Promise(resolve => stalledServer.once('connection', resolve));
  await listen(stalledServer);
  const stalledAddress = stalledServer.address();
  const stalledPort = stalledAddress && typeof stalledAddress === 'object' ? stalledAddress.port : 0;
  const stalledClient = new KdbIpcClient({ host: '127.0.0.1', port: stalledPort, timeoutMs: 5000 });
  const stalledConnect = stalledClient.connect();
  try {
    await accepted;
    stalledClient.cancel(new Error('test cancel'));
    await assertCompletesWithin(
      'q IPC handshake cancellation',
      () => assert.rejects(
        () => stalledConnect,
        error => error &&
          /(connect|handshake) failed/i.test(error.message) &&
          error.message.includes(`127.0.0.1:${stalledPort}`) &&
          /test cancel/.test(error.message)
      ),
      1000
    );
    await assert.rejects(
      () => stalledClient.query('1'),
      /connection is not open/,
      'canceling an in-flight connect must leave no usable stale socket state'
    );
  } finally {
    heldSockets.forEach(socket => socket.destroy());
    await closeServer(stalledServer);
  }

  const timeoutUsername = ['timeout', 'user'].join('-');
  const timeoutPassword = ['timeout', 'secret'].join('-');
  const handshakeSockets = [];
  let markHandshakeReceived;
  const handshakeReceived = new Promise(resolve => {
    markHandshakeReceived = resolve;
  });
  const handshakeServer = net.createServer(socket => {
    handshakeSockets.push(socket);
    socket.once('data', markHandshakeReceived);
  });
  await listen(handshakeServer);
  const handshakeAddress = handshakeServer.address();
  const handshakePort = handshakeAddress && typeof handshakeAddress === 'object' ? handshakeAddress.port : 0;
  const handshakeClient = new KdbIpcClient({
    host: '127.0.0.1',
    port: handshakePort,
    username: timeoutUsername,
    password: timeoutPassword,
    connectTimeoutMs: 100,
    queryTimeoutMs: 5000,
  });
  const handshakeConnect = handshakeClient.connect();
  const handshakeRejection = assert.rejects(
    () => handshakeConnect,
    error => error &&
      error.name === 'KdbIpcError' &&
      /handshake failed/i.test(error.message) &&
      error.message.includes(`127.0.0.1:${handshakePort}`) &&
      /timed out after 100 ms/i.test(error.message) &&
      !error.message.includes(timeoutUsername) &&
      !error.message.includes(timeoutPassword)
  );
  try {
    await assertCompletesWithin('q IPC handshake write', () => handshakeReceived, 1000);
    await assertCompletesWithin(
      'q IPC handshake timeout',
      () => handshakeRejection,
      1500
    );
  } finally {
    await handshakeClient.close();
    handshakeSockets.forEach(socket => socket.destroy());
    await closeServer(handshakeServer);
  }

  const querySockets = [];
  let markQueryReceived;
  const queryReceived = new Promise(resolve => {
    markQueryReceived = resolve;
  });
  const timeoutServer = net.createServer(socket => {
    querySockets.push(socket);
    let handshakeComplete = false;
    socket.on('data', chunk => {
      if (!handshakeComplete) {
        handshakeComplete = true;
        socket.write(Buffer.from([3]));
        return;
      }
      markQueryReceived(chunk);
    });
  });
  await listen(timeoutServer);
  const timeoutAddress = timeoutServer.address();
  const timeoutPort = timeoutAddress && typeof timeoutAddress === 'object' ? timeoutAddress.port : 0;
  const privateQuery = ['private', 'query', 'must', 'not', 'leak'].join('-');
  const timeoutDiagnosticLines = [];
  const queryTimeoutClient = new KdbIpcClient({
    host: '127.0.0.1',
    port: timeoutPort,
    username: timeoutUsername,
    password: timeoutPassword,
    connectTimeoutMs: 1000,
    queryTimeoutMs: 100,
    diagnostics: new KxDiagnostics({ appendLine: value => timeoutDiagnosticLines.push(value) }),
  });
  try {
    await queryTimeoutClient.connect();
    const timedQuery = queryTimeoutClient.query(privateQuery);
    const queryTimeoutRejection = assert.rejects(
      () => timedQuery,
      error => error &&
        error.name === 'KdbIpcError' &&
        /query failed/i.test(error.message) &&
        error.message.includes(`127.0.0.1:${timeoutPort}`) &&
        /timed out after 100 ms/i.test(error.message) &&
        !error.message.includes(privateQuery) &&
        !error.message.includes(timeoutUsername) &&
        !error.message.includes(timeoutPassword)
    );
    await assertCompletesWithin('q IPC query write', () => queryReceived, 1000);
    await assertCompletesWithin(
      'q IPC query timeout',
      () => queryTimeoutRejection,
      1500
    );
    await assert.rejects(
      () => queryTimeoutClient.query('retry-after-timeout'),
      /connection is not open/,
      'a timed-out query must destroy the transport instead of leaving a stale session'
    );
    const timeoutDiagnostics = timeoutDiagnosticLines.join('\n');
    assert.ok(!timeoutDiagnostics.includes(privateQuery));
    assert.ok(!timeoutDiagnostics.includes(timeoutUsername));
    assert.ok(!timeoutDiagnostics.includes(timeoutPassword));
    assert.ok(timeoutDiagnosticLines.map(line => JSON.parse(line)).some(event =>
      event.phase === 'query' && event.status === 'failed' && event.endpoint === `127.0.0.1:${timeoutPort}`
    ));
  } finally {
    await queryTimeoutClient.close();
    querySockets.forEach(socket => socket.destroy());
    await closeServer(timeoutServer);
  }

  const queuedSockets = [];
  const queuedFrames = [];
  const frameArrivals = Array.from({ length: 10 }, () => deferred());
  const queueDiagnosticLines = [];
  const queueServer = net.createServer(socket => {
    queuedSockets.push(socket);
    let handshakeComplete = false;
    let buffered = Buffer.alloc(0);
    socket.on('data', chunk => {
      if (!handshakeComplete) {
        handshakeComplete = true;
        socket.write(Buffer.from([3]));
        return;
      }

      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 8) {
        const messageLength = buffered.readInt32LE(4);
        if (messageLength < 8) {
          socket.destroy(new Error(`invalid test q IPC frame length ${messageLength}`));
          return;
        }
        if (buffered.length < messageLength) {
          return;
        }
        const frame = buffered.subarray(0, messageLength);
        buffered = buffered.subarray(messageLength);
        const index = queuedFrames.push(frame) - 1;
        frameArrivals[index]?.resolve(socket);
      }
    });
  });
  await listen(queueServer);
  const queueAddress = queueServer.address();
  const queuePort = queueAddress && typeof queueAddress === 'object' ? queueAddress.port : 0;
  const queueClient = new KdbIpcClient({
    host: '127.0.0.1',
    port: queuePort,
    connectTimeoutMs: 1000,
    queryTimeoutMs: 1000,
    diagnostics: new KxDiagnostics({ appendLine: value => queueDiagnosticLines.push(value) }),
  });
  const issued = [];
  const scalarResponse = hex('010200000d000000fa01000000');
  try {
    await queueClient.connect();
    const firstQuery = queueClient.query('first-boundary', () => issued.push('first'));
    const secondQuery = queueClient.query('second-boundary', () => issued.push('second'));
    const queueSocket = await assertCompletesWithin(
      'first queued q IPC write',
      () => frameArrivals[0].promise,
      1000
    );
    assert.deepStrictEqual(issued, ['first']);
    assert.strictEqual(queuedFrames.length, 1, 'only the active request may reach socket.write');
    assert.deepStrictEqual(queuedFrames[0], serializeTextQuery('first-boundary'));

    queueSocket.write(scalarResponse);
    assert.strictEqual(await firstQuery, 1);
    await assertCompletesWithin('second queued q IPC write', () => frameArrivals[1].promise, 1000);
    assert.deepStrictEqual(
      issued,
      ['first', 'second'],
      'a queued history observer must not fire until that request reaches socket.write'
    );
    assert.strictEqual(queuedFrames.length, 2);
    assert.deepStrictEqual(queuedFrames[1], serializeTextQuery('second-boundary'));
    queueSocket.write(scalarResponse);
    assert.strictEqual(await secondQuery, 1);

    const throwingObserverQuery = queueClient.query('observer-cannot-break-write', () => {
      issued.push('throwing');
      throw new Error('injected history observer failure');
    });
    await assertCompletesWithin('observer q IPC write', () => frameArrivals[2].promise, 1000);
    assert.deepStrictEqual(issued, ['first', 'second', 'throwing']);
    assert.deepStrictEqual(queuedFrames[2], serializeTextQuery('observer-cannot-break-write'));
    queueSocket.write(scalarResponse);
    assert.strictEqual(await throwingObserverQuery, 1);

    const preDispatchController = new AbortController();
    preDispatchController.abort();
    const framesBeforePreDispatchCancel = queuedFrames.length;
    let preDispatchIssued = 0;
    await assert.rejects(
      () => queueClient.query(
        'canceled-before-queue',
        () => preDispatchIssued++,
        preDispatchController.signal
      ),
      error => error instanceof KdbQueryCanceledError &&
        /canceled locally/i.test(error.message)
    );
    await eventLoopTurn();
    assert.strictEqual(preDispatchIssued, 0, 'a pre-aborted query must never be marked issued');
    assert.strictEqual(
      queuedFrames.length,
      framesBeforePreDispatchCancel,
      'a pre-aborted query must not write an IPC frame'
    );

    const queueBlocker = queueClient.query(
      'queued-cancel-blocker',
      () => issued.push('queued-cancel-blocker')
    );
    const queuedCancelController = new AbortController();
    const canceledWhileQueued = queueClient.query(
      'canceled-while-queued',
      () => issued.push('canceled-while-queued'),
      queuedCancelController.signal
    );
    const canceledWhileQueuedRejection = assert.rejects(
      () => canceledWhileQueued,
      error => error instanceof KdbQueryCanceledError &&
        /canceled locally/i.test(error.message)
    );
    const afterQueuedCancel = queueClient.query(
      'after-queued-cancel',
      () => issued.push('after-queued-cancel')
    );
    await assertCompletesWithin(
      'queued cancellation blocker write',
      () => frameArrivals[3].promise,
      1000
    );
    queuedCancelController.abort();
    await assertCompletesWithin(
      'queued query local cancellation',
      () => canceledWhileQueuedRejection,
      1000
    );
    await eventLoopTurn();
    assert.deepStrictEqual(
      issued.slice(-1),
      ['queued-cancel-blocker'],
      'canceling a queued query must not invoke its issue observer or skip ahead while a request is active'
    );
    assert.strictEqual(
      queuedFrames.length,
      4,
      'only the blocker may be written before its response'
    );
    queueSocket.write(scalarResponse);
    assert.strictEqual(await queueBlocker, 1);
    await assertCompletesWithin(
      'query after queued cancellation write',
      () => frameArrivals[4].promise,
      1000
    );
    assert.deepStrictEqual(
      queuedFrames[4],
      serializeTextQuery('after-queued-cancel'),
      'the canceled queued query must be removed without disturbing the following request'
    );
    assert.deepStrictEqual(issued.slice(-1), ['after-queued-cancel']);
    queueSocket.write(scalarResponse);
    assert.strictEqual(await afterQueuedCancel, 1);

    const dispatchedCancelController = new AbortController();
    const canceledAfterDispatch = queueClient.query(
      'canceled-after-dispatch',
      () => issued.push('canceled-after-dispatch'),
      dispatchedCancelController.signal
    );
    const canceledAfterDispatchRejection = assert.rejects(
      () => canceledAfterDispatch,
      error => error instanceof KdbQueryCanceledError &&
        /server work may continue/i.test(error.message)
    );
    await assertCompletesWithin(
      'post-dispatch cancellation query write',
      () => frameArrivals[5].promise,
      1000
    );
    assert.deepStrictEqual(queuedFrames[5], serializeTextQuery('canceled-after-dispatch'));
    dispatchedCancelController.abort();
    await assertCompletesWithin(
      'post-dispatch local cancellation',
      () => canceledAfterDispatchRejection,
      1000
    );

    const afterDispatchedCancel = queueClient.query(
      'after-dispatched-cancel',
      () => issued.push('after-dispatched-cancel')
    );
    await eventLoopTurn();
    assert.strictEqual(
      queuedFrames.length,
      6,
      'a canceled dispatched request must retain the protocol response slot before the next query is written'
    );
    assert.deepStrictEqual(
      issued.slice(-1),
      ['canceled-after-dispatch'],
      'the following query must remain queued until the canceled request response is consumed'
    );
    queueSocket.write(scalarResponse);
    await assertCompletesWithin(
      'query after dispatched cancellation write',
      () => frameArrivals[6].promise,
      1000
    );
    assert.deepStrictEqual(
      queuedFrames[6],
      serializeTextQuery('after-dispatched-cancel'),
      'the canceled request response must not be mis-associated with the following query'
    );
    assert.deepStrictEqual(issued.slice(-1), ['after-dispatched-cancel']);
    queueSocket.write(scalarResponse);
    assert.strictEqual(await afterDispatchedCancel, 1);

    const cancellationEvents = queueDiagnosticLines.map(line => JSON.parse(line)).filter(event =>
      event.phase === 'query' && event.status === 'canceled'
    );
    assert.ok(
      cancellationEvents.some(event => event.stage === 'preflight'),
      'pre-dispatch cancellation must be diagnosed without query text'
    );
    assert.ok(
      cancellationEvents.some(event => event.queued === true),
      'queued cancellation must be distinguishable in diagnostics'
    );
    assert.ok(
      cancellationEvents.some(event => event.queued === false),
      'post-dispatch cancellation must be distinguishable in diagnostics'
    );
    const cancellationDiagnostics = queueDiagnosticLines.join('\n');
    for (const queryText of [
      'canceled-before-queue',
      'canceled-while-queued',
      'canceled-after-dispatch',
    ]) {
      assert.ok(
        !cancellationDiagnostics.includes(queryText),
        'cancellation diagnostics must never include q source text'
      );
    }
  } finally {
    await queueClient.close();
    queuedSockets.forEach(socket => socket.destroy());
    await closeServer(queueServer);
  }

  const disconnectedObserverClient = new KdbIpcClient({ host: '127.0.0.1', port: 1, timeoutMs: 1 });
  let disconnectedIssued = 0;
  await assert.rejects(
    () => disconnectedObserverClient.query('never-written', () => disconnectedIssued++),
    /connection is not open/
  );
  assert.strictEqual(disconnectedIssued, 0, 'preflight failures must not be recorded as issued queries');
}

async function testDiagnostics() {
  assert.strictEqual(KX_OUTPUT_CHANNEL_NAME, 'KX');
  const fakeUsername = ['diag', 'user'].join('-');
  const fakeSecret = ['never', 'emit', 'this'].join('-');
  const queryText = ['show', 'private', 'query', 'value'].join(' ');
  const qErrorText = ['private', 'q', 'error', 'value'].join('-');

  const redacted = redactDiagnosticText(
    `password=${fakeSecret} token:abc https://${fakeUsername}:${fakeSecret}@q.example.test/`,
    [fakeUsername, fakeSecret]
  );
  assert.ok(!redacted.includes(fakeUsername));
  assert.ok(!redacted.includes(fakeSecret));
  assert.ok(!redacted.includes('abc'));
  assert.ok(redacted.includes(REDACTED_DIAGNOSTIC_VALUE));

  const circular = {};
  circular.self = circular;
  const safeDetails = sanitizeDiagnosticDetails({
    password: fakeSecret,
    query: queryText,
    queryChars: queryText.length,
    note: `authorization: ${fakeSecret}`,
    nested: { token: fakeSecret },
    circular,
  }, [fakeSecret]);
  assert.strictEqual(safeDetails.password, REDACTED_DIAGNOSTIC_VALUE);
  assert.strictEqual(safeDetails.query, REDACTED_DIAGNOSTIC_VALUE);
  assert.strictEqual(safeDetails.queryChars, queryText.length);
  assert.ok(!JSON.stringify(safeDetails).includes(fakeSecret));
  assert.strictEqual(safeDetails.circular.self, '[circular]');

  const structuredLines = [];
  const structuredDiagnostics = new KxDiagnostics({ appendLine: value => structuredLines.push(value) });
  structuredDiagnostics.event({
    phase: 'connect',
    endpoint: 'safe.example.test:5000',
    status: 'start',
    details: {
      phase: 'query',
      endpoint: `password=${fakeSecret}`,
      status: 'failed',
    },
    secrets: [fakeSecret],
  });
  const structuredEvent = JSON.parse(structuredLines[0]);
  assert.strictEqual(structuredEvent.phase, 'connect', 'details must not override the diagnostic phase');
  assert.strictEqual(structuredEvent.endpoint, 'safe.example.test:5000', 'details must not override the endpoint');
  assert.strictEqual(structuredEvent.status, 'start', 'details must not override the diagnostic status');
  assert.ok(!structuredLines[0].includes(fakeSecret));

  const diagnosticLines = [];
  const diagnostics = new KxDiagnostics(
    { appendLine: value => diagnosticLines.push(value) },
    () => new Date('2026-07-22T00:00:00.000Z')
  );
  const scalarResponse = hex('010200000d000000fa01000000');
  const errorResponse = qResponse(Buffer.concat([int8(-128), cString(qErrorText)]));
  let queryCount = 0;
  const server = net.createServer(socket => {
    let handshakeComplete = false;
    socket.on('data', () => {
      if (!handshakeComplete) {
        handshakeComplete = true;
        socket.write(Buffer.from([3]));
        return;
      }
      queryCount++;
      socket.write(queryCount === 1 ? scalarResponse : errorResponse);
    });
  });
  await listen(server);
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  const client = new KdbIpcClient({
    host: '127.0.0.1',
    port,
    username: fakeUsername,
    password: fakeSecret,
    timeoutMs: 1000,
    diagnostics,
  });
  try {
    await client.connect();
    assert.strictEqual(await client.query(queryText), 1);
    await assert.rejects(
      () => client.query(`${queryText};second`),
      error => error instanceof KdbQError && error.message === qErrorText,
      'a genuine q IPC error must reject as KdbQError'
    );
  } finally {
    await client.close();
    await closeServer(server);
  }

  const diagnosticsText = diagnosticLines.join('\n');
  assert.ok(!diagnosticsText.includes(fakeUsername), 'diagnostics must redact the authentication username');
  assert.ok(!diagnosticsText.includes(fakeSecret), 'diagnostics must redact the authentication secret');
  assert.ok(!diagnosticsText.includes(queryText), 'diagnostics must omit q source text');
  assert.ok(!diagnosticsText.includes(qErrorText), 'diagnostics must omit q error values');
  const events = diagnosticLines.map(line => JSON.parse(line));
  const endpoint = `127.0.0.1:${port}`;
  assert.ok(events.every(event => event.endpoint === endpoint));
  assert.ok(events.some(event => event.phase === 'connect' && event.status === 'success'));
  assert.ok(events.some(event => event.phase === 'handshake' && event.status === 'success'));
  assert.ok(events.some(event => event.phase === 'query' && event.status === 'success'));
  assert.ok(events.some(event =>
    event.phase === 'query' && event.status === 'failed' && event.errorName === 'KdbQError'
  ));
  assert.ok(events.some(event => event.phase === 'close' && event.status === 'success'));

  const perfLines = [];
  const originalConsoleLog = console.log;
  console.log = () => undefined;
  configurePerfOutput(value => perfLines.push(value));
  configurePerfTrace(true);
  try {
    perfMark('test.redaction', {
      query: queryText,
      queryChars: queryText.length,
      password: fakeSecret,
      endpoint,
    });
  } finally {
    configurePerfTrace(undefined);
    configurePerfOutput(undefined);
    console.log = originalConsoleLog;
  }
  assert.strictEqual(perfLines.length, 1);
  assert.ok(!perfLines[0].includes(queryText));
  assert.ok(!perfLines[0].includes(fakeSecret));
  assert.ok(perfLines[0].includes(`"queryChars":${queryText.length}`));
}

function testQText() {
  const source = 'first:1\r\n  second:2  \r\n\r\nf:{[x]\r\n x+1\r\n}';
  assert.strictEqual(
    selectedTextOrCurrentLine(source, '  a:1\nb:2  ', 4),
    '  a:1\nb:2  ',
    'a non-empty selection must be returned byte-for-byte'
  );
  assert.strictEqual(selectedTextOrCurrentLine(source, '  ', 1), '  ');
  assert.strictEqual(selectedTextOrCurrentLine(source, '', 1), '  second:2  ');
  assert.strictEqual(selectedTextOrCurrentLine(source, '', 2), '');
  assert.strictEqual(selectedTextOrCurrentLine(source, '', 4), ' x+1');
  assert.strictEqual(selectedTextOrCurrentLine('a\nb', '', -5), 'a');
  assert.strictEqual(selectedTextOrCurrentLine('a\nb', '', 50), 'b');
  assert.strictEqual(selectedTextOrCurrentLine('', '', 0), '');
  assert.strictEqual(qSelectionExecutionKind('a:1'), 'query');
  assert.strictEqual(qSelectionExecutionKind('a:1\nb:2'), 'script');
  assert.strictEqual(qSelectionExecutionKind('a:1\r\nb:2'), 'script');

  const tokenSource = [
    '/ <tag data-x="comment"> &',
    '\\l /safe/path',
    'select sum price by sym from .analytics.trade where date=2026.07.22, ts=2026.07.22D12:34:56.123;',
    'if[0101b;show "<img src=x> \\\"quoted\\\" &";`"symbol;<tag>"]; .Q.enlist 0x2a 0N -42.5e2 +/: 1',
  ].join('\n');
  const lexed = lexQText(tokenSource);
  assert.strictEqual(lexed.valid, true);
  assert.strictEqual(lexed.tokens.map(token => token.text).join(''), tokenSource, 'lexer tokens must preserve exact order and bytes');
  lexed.tokens.forEach((token, index) => {
    assert.strictEqual(token.text, tokenSource.slice(token.start, token.end));
    if (index > 0) {
      assert.strictEqual(token.start, lexed.tokens[index - 1].end, 'lexer tokens must be contiguous');
    }
  });
  const tokenKinds = new Set(lexed.tokens.map(token => token.kind));
  for (const kind of ['comment', 'command', 'system', 'namespace', 'string', 'symbol', 'temporal', 'number', 'keyword', 'builtin', 'operator']) {
    assert.ok(tokenKinds.has(kind), `qText lexer did not emit ${kind}`);
  }
  assert.ok(lexed.tokens.some(token => token.kind === 'string' && token.text.includes('<img src=x>')));
  assert.ok(lexed.tokens.some(token => token.kind === 'comment' && token.text.includes('<tag')));
  assert.ok(lexed.tokens.some(token => token.kind === 'number' && token.text === '0101b'));
  assert.strictEqual(lexQText('"unterminated <tag>').valid, false);
  assert.strictEqual(lexQText('/\nunterminated block').valid, false);

  const slashSource = [
    '+/1 2 3',
    'f/[1 2;3 4]',
    'a:1/2',
    'a:1 / trailing <tag attr="x"> & ; { [ ) ] }  ',
    'b:2\t/tab trailing comment',
  ].join('\n');
  const slashLexed = lexQText(slashSource);
  assert.strictEqual(slashLexed.valid, true);
  assert.strictEqual(slashLexed.tokens.map(token => token.text).join(''), slashSource);
  assert.ok(slashLexed.tokens.some(token => token.kind === 'operator' && token.text.includes('+/')));
  assert.strictEqual(
    slashLexed.tokens.filter(token => token.kind === 'operator' && token.text.includes('/')).length,
    3,
    'attached over/adverb and operator slashes must not become comments'
  );
  assert.strictEqual(slashLexed.tokens.filter(token => token.kind === 'comment').length, 2);
  assert.ok(slashLexed.tokens.some(token => token.kind === 'comment' && token.text === '/ trailing <tag attr="x"> & ; { [ ) ] }  '));
  assert.ok(slashLexed.tokens.some(token => token.kind === 'comment' && token.text === '/tab trailing comment'));

  const validEscapedString = String.raw`"\\\"\n\r\t\123\377"`;
  const validEscapedSymbol = '`' + String.raw`"symbol\\\"\141"`;
  const validEscapedSource = `{[x]a:${validEscapedString};b:${validEscapedSymbol};x}`;
  const validEscapedLexed = lexQText(validEscapedSource);
  assert.strictEqual(validEscapedLexed.valid, true, 'documented q string escapes must be accepted');
  assert.ok(validEscapedLexed.tokens.some(token => token.kind === 'string' && token.text === validEscapedString));
  assert.ok(validEscapedLexed.tokens.some(token => token.kind === 'symbol' && token.text === validEscapedSymbol));
  const validEscapedFormatted = formatQTextForDisplay(validEscapedSource);
  assert.strictEqual(validEscapedFormatted.applied, true);
  assert.ok(validEscapedFormatted.text.includes(validEscapedString));
  assert.ok(validEscapedFormatted.text.includes(validEscapedSymbol));

  const hostileRaw = '<script>"&\'\u0000\u0001\n / not-a-comment-after-code';
  const disabled = qTextRenderModel(hostileRaw, { syntaxHighlighting: false, displayFormatting: false });
  assert.deepStrictEqual(disabled, {
    text: hostileRaw,
    formatted: false,
    highlighted: false,
    segments: [{ kind: 'plain', text: hostileRaw }],
  });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(disabled, 'html'), false);
  assert.strictEqual(disabled.segments.map(segment => segment.text).join(''), hostileRaw);

  const supported = '{[x;y]a:x+y;b:{[z]"literal;{<tag>&}";z*2};b[a]}[1]';
  const formatted = formatQTextForDisplay(supported);
  assert.strictEqual(formatted.applied, true);
  assert.strictEqual(
    formatted.text,
    '{\n  [x;y]a:x+y;\n  b:{\n    [z]"literal;{<tag>&}";\n    z*2\n  };\n  b[a]\n}[1]'
  );
  assert.strictEqual(formatQTextForDisplay(formatted.text).text, formatted.text, 'display formatting must be idempotent');
  assert.ok(formatted.text.includes('"literal;{<tag>&}"'), 'string bytes must remain unchanged');
  assert.ok(formatted.text.endsWith('}[1]'), 'a safe projection suffix must remain byte-for-byte after lambda formatting');

  const commentSource = '{[x]a:1;\n / comment ; { <tag> &  \nb:x+1;b}';
  const formattedComment = formatQTextForDisplay(commentSource);
  assert.strictEqual(formattedComment.applied, true);
  assert.ok(formattedComment.text.includes('/ comment ; { <tag> &  '), 'comment bytes must remain unchanged');
  const trailingComment = '/ trailing <tag data-x="&"> & ; { [ ) ] }  ';
  const trailingCommentSource = `{[x]a:1; b:x+1 ${trailingComment}\n b}`;
  const trailingCommentFormatted = formatQTextForDisplay(trailingCommentSource);
  assert.strictEqual(trailingCommentFormatted.applied, true);
  assert.ok(trailingCommentFormatted.text.includes(trailingComment), 'trailing comment bytes must remain unchanged');
  assert.strictEqual(
    lexQText(trailingCommentFormatted.text).tokens.find(token => token.kind === 'comment').text,
    trailingComment
  );
  const malformedEscapes = [
    String.raw`{[x]a:"bad\q";x}`,
    '{[x]a:`' + String.raw`"bad\8"` + ';x}',
    String.raw`{[x]a:"short\12";x}`,
    String.raw`{[x]a:"out-of-byte-range\400";x}`,
    String.raw`{[x]a:"out-of-byte-range\777";x}`,
    '{[x]a:"raw\nnewline";x}',
    '{[x]a:`"raw\rnewline";x}',
  ];
  malformedEscapes.forEach(value => {
    assert.strictEqual(lexQText(value).valid, false, `malformed q quoted literal must be rejected: ${JSON.stringify(value)}`);
    assert.deepStrictEqual(formatQTextForDisplay(value), { text: value, applied: false });
  });
  for (const malformed of [
    '{[x]"unterminated}',
    '{[x]a:(1;2}',
    '{[x]a:1',
    '{[x]a:1}\u0000',
    'select from t where x=1',
  ]) {
    assert.deepStrictEqual(formatQTextForDisplay(malformed), { text: malformed, applied: false });
  }

  const highlighted = qTextRenderModel(supported, { syntaxHighlighting: true, displayFormatting: true });
  assert.strictEqual(highlighted.formatted, true);
  assert.strictEqual(highlighted.highlighted, true);
  assert.strictEqual(highlighted.segments.map(segment => segment.text).join(''), highlighted.text);
  assert.ok(highlighted.segments.some(segment => segment.kind === 'string' && segment.text === '"literal;{<tag>&}"'));
  assert.ok(!highlighted.segments.some(segment => segment.kind !== 'string' && segment.text.includes('<tag>')));
  const malformedHighlighted = qTextRenderModel('"<tag attr=\'x\'>&\u0001', {
    syntaxHighlighting: true,
    displayFormatting: true,
  });
  assert.strictEqual(malformedHighlighted.text, '"<tag attr=\'x\'>&\u0001');
  assert.strictEqual(malformedHighlighted.formatted, false);
  assert.strictEqual(malformedHighlighted.highlighted, false);
  assert.deepStrictEqual(malformedHighlighted.segments, [{ kind: 'plain', text: malformedHighlighted.text }]);
  assert.strictEqual(malformedHighlighted.segments.map(segment => segment.text).join(''), malformedHighlighted.text);
}

async function testQTextResultPanelSettings() {
  const harness = createQTextResultsPanelHarness();
  const {
    KxResultsPanel,
    sharedKxResultSettings,
    updateSharedKxResultSetting,
  } = requireOutWithVscode('kx-results-panel', harness.vscode);
  const firstRaw = '{[x;y]a:x+y;b:a*2;b}[1]';
  const secondRaw = '<tag attr="x"> & "raw"';
  KxResultsPanel.showResult(harness.context, {
    mode: 'text',
    text: firstRaw,
    query: 'value f',
    connectionName: 'local',
    elapsedMs: 1,
    messages: [],
  });
  await harness.emitMessage(0, { type: 'ready' });
  const firstPanel = harness.panels[0];
  const firstMetadata = firstPanel.posted.find(message => message.type === 'resultMeta').result;
  assert.strictEqual(firstMetadata.settings.qTextSyntaxHighlighting, false);
  assert.strictEqual(firstMetadata.settings.qTextDisplayFormatting, false);
  assert.deepStrictEqual(firstMetadata.qTextRender, {
    text: firstRaw,
    formatted: false,
    highlighted: false,
    segments: [{ kind: 'plain', text: firstRaw }],
  });
  assert.ok(firstPanel.webview.html.includes('var(--vscode-symbolIcon-functionForeground'));
  assert.ok(firstPanel.webview.html.includes("span.textContent = segment.text"));
  assert.ok(firstPanel.webview.html.includes("toNonNegativeInteger(msg.version, -1) === data.version"));
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(firstPanel.webview.html));

  KxResultsPanel.showResult(harness.context, {
    mode: 'text',
    text: secondRaw,
    query: 'value g',
    connectionName: 'local',
    elapsedMs: 2,
    messages: [],
  }, 'new');
  await harness.emitMessage(1, { type: 'ready' });
  const secondPanel = harness.panels[1];

  await harness.emitMessage(0, {
    type: 'updateSetting',
    key: 'qTextSyntaxHighlighting',
    value: true,
    density: 'standard',
  });
  assert.deepStrictEqual(harness.updates.at(-1), {
    key: 'vscode-kdb.results.qText.syntaxHighlighting',
    value: true,
    target: 'global',
  });
  for (const panel of [firstPanel, secondPanel]) {
    const message = panel.posted.filter(value => value.type === 'settings').at(-1);
    assert.strictEqual(message.settings.qTextSyntaxHighlighting, true, 'setting updates must reach every open panel');
    assert.strictEqual(message.qTextRender.highlighted, true);
  }

  await harness.emitMessage(0, {
    type: 'updateSetting',
    key: 'qTextDisplayFormatting',
    value: true,
    density: 'standard',
  });
  assert.deepStrictEqual(harness.updates.at(-1), {
    key: 'vscode-kdb.results.qText.displayFormatting',
    value: true,
    target: 'global',
  });
  const formattedMessage = firstPanel.posted.filter(value => value.type === 'settings').at(-1);
  assert.strictEqual(formattedMessage.version, firstMetadata.version);
  assert.strictEqual(formattedMessage.qTextRender.formatted, true);
  assert.strictEqual(formattedMessage.qTextRender.highlighted, true);
  assert.strictEqual(formattedMessage.qTextRender.text, formatQTextForDisplay(firstRaw).text);
  const fallbackMessage = secondPanel.posted.filter(value => value.type === 'settings').at(-1);
  assert.strictEqual(fallbackMessage.qTextRender.text, secondRaw);
  assert.strictEqual(fallbackMessage.qTextRender.formatted, false);

  const sharedBefore = sharedKxResultSettings();
  assert.deepStrictEqual(
    parseNotebookRendererHostMessage(notebookRendererSettingsMessage({
      presentation: 'inline',
      rowLimit: DEFAULT_NOTEBOOK_ROW_LIMIT,
      byteLimit: DEFAULT_NOTEBOOK_BYTE_LIMIT,
    }, sharedBefore)).resultSettings,
    sharedBefore,
    'the notebook renderer must validate the same durable setting values used by the KX panel'
  );
  assert.strictEqual(
    await updateSharedKxResultSetting('arrayDisplayFormat', 'space'),
    true
  );
  assert.deepStrictEqual(harness.updates.at(-1), {
    key: 'vscode-kdb.results.viewer.arrayDisplayFormat',
    value: 'space',
    target: 'global',
  });
  const sharedAfter = sharedKxResultSettings();
  assert.strictEqual(sharedAfter.arrayDisplayFormat, 'space');
  assert.strictEqual(
    parseNotebookRendererHostMessage(notebookRendererSettingsMessage({
      presentation: 'inline',
      rowLimit: DEFAULT_NOTEBOOK_ROW_LIMIT,
      byteLimit: DEFAULT_NOTEBOOK_BYTE_LIMIT,
    }, sharedAfter)).resultSettings.arrayDisplayFormat,
    'space',
    'a notebook-originated shared setting update must round-trip to the common configuration source'
  );

  harness.setSetting('vscode-kdb.results.qText.syntaxHighlighting', false);
  harness.setSetting('vscode-kdb.results.qText.displayFormatting', false);
  KxResultsPanel.configurationChanged(configurationEvent('vscode-kdb.results'));
  for (const panel of [firstPanel, secondPanel]) {
    const message = panel.posted.filter(value => value.type === 'settings').at(-1);
    assert.strictEqual(message.settings.qTextSyntaxHighlighting, false);
    assert.strictEqual(message.settings.qTextDisplayFormatting, false);
    assert.strictEqual(message.qTextRender.text, panel === firstPanel ? firstRaw : secondRaw);
  }

  const replacementRaw = '{[z]z+1;z}';
  KxResultsPanel.showResult(harness.context, {
    mode: 'text',
    text: replacementRaw,
    query: 'value h',
    connectionName: 'local',
    elapsedMs: 3,
    messages: [],
  });
  const replacementMetadata = firstPanel.posted.filter(message => message.type === 'resultMeta').at(-1).result;
  assert.strictEqual(replacementMetadata.text, replacementRaw, 'a reused panel must keep the new raw qText');
  assert.strictEqual(replacementMetadata.qTextRender.text, replacementRaw);
  await harness.emitMessage(0, { type: 'copyText', version: replacementMetadata.version });
  assert.strictEqual(harness.clipboard.at(-1), replacementRaw, 'copy must use underlying raw qText, never formatted display text');

  firstPanel.dispose();
  secondPanel.dispose();
}

function testConnections() {
  const connection = validateConnection({
    id: 'kx-local',
    name: ' Local q ',
    host: ' [::1] ',
    port: '5000',
    database: 'analytics.market',
    username: 'daniel',
  });
  assert.deepStrictEqual(connection, {
    id: 'kx-local',
    name: 'Local q',
    host: '::1',
    port: 5000,
    database: '.analytics.market',
    username: 'daniel',
  });
  assert.strictEqual(connectionEndpoint(connection), '[::1]:5000');
  assert.strictEqual(normalizeNamespace(''), '.');
  assert.strictEqual(normalizeNamespace('analytics'), '.analytics');
  assert.strictEqual(normalizeNamespace('.analytics.market'), '.analytics.market');

  const existing = [{ ...connection, host: 'localhost' }];
  assert.throws(
    () => validateConnection({ ...connection, id: 'other', name: 'local Q' }, existing),
    /already exists/
  );
  assert.doesNotThrow(() => validateConnection({ ...connection, name: 'Renamed' }, existing, connection.id));
  assert.throws(() => validateConnection({ ...connection, host: 'http://localhost' }), /without a URL scheme or path/);
  assert.throws(() => validateConnection({ ...connection, host: 'localhost:6000' }), /without a URL scheme or path/);
  assert.throws(() => validateConnection({ ...connection, host: 'http:localhost' }), /without a URL scheme or path/);
  assert.throws(() => validateConnection({ ...connection, host: 'bad::g' }), /without a URL scheme or path/);
  assert.throws(() => validateConnection({ ...connection, host: 'exa$mple' }), /only letters/);
  assert.throws(() => validateConnection({ ...connection, host: '[localhost]' }), /only letters/);
  assert.throws(() => validateConnection({ ...connection, host: '999.999.999.999' }), /valid host name/);
  assert.throws(() => validateConnection({ ...connection, host: 'local host' }), /whitespace/);
  assert.throws(() => validateConnection({ ...connection, port: 0 }), /1 to 65535/);
  assert.throws(() => validateConnection({ ...connection, port: 1.5 }), /integer/);
  assert.throws(() => validateConnection({ ...connection, database: '.bad-name' }), /dot-separated q identifiers/);
  assert.throws(() => validateConnection({ ...connection, name: ' ' }), /name is required/);
  assert.throws(() => validateConnection({ ...connection, id: 'bad id' }), /unsupported characters/);
  assert.throws(() => validateConnection({ ...connection, username: 'user:name' }), /cannot contain colons/);
  assert.strictEqual(MAX_TIMEOUT_MS, 2147483647);
  assert.strictEqual(DEFAULT_CONNECTION_TIMEOUT_MS, 30000);
  assert.strictEqual(parseOptionalTimeout('', 'Timeout'), undefined);
  assert.strictEqual(parseOptionalTimeout('  ', 'Timeout'), undefined);
  assert.strictEqual(parseOptionalTimeout('0', 'Timeout'), 0);
  assert.strictEqual(parseOptionalTimeout(String(MAX_TIMEOUT_MS), 'Timeout'), MAX_TIMEOUT_MS);
  for (const invalid of ['-1', '1.5', '1e3', String(MAX_TIMEOUT_MS + 1), NaN, Infinity]) {
    assert.throws(() => parseOptionalTimeout(invalid, 'Timeout'), /whole number/);
  }
  assert.strictEqual(safeTimeoutMs(0, 42), 0);
  assert.strictEqual(safeTimeoutMs(MAX_TIMEOUT_MS, 42), MAX_TIMEOUT_MS);
  assert.strictEqual(safeTimeoutMs('1000', 42), 42, 'hand-edited global settings must not coerce strings');
  assert.strictEqual(safeTimeoutMs(-1, 42), 42);
  assert.strictEqual(safeTimeoutMs(MAX_TIMEOUT_MS + 1, 42), 42);

  const timedConnection = validateConnection({
    ...connection,
    connectTimeoutMs: '0',
    queryTimeoutMs: String(MAX_TIMEOUT_MS),
  });
  assert.strictEqual(timedConnection.connectTimeoutMs, 0, 'zero is an explicit disabled override');
  assert.strictEqual(timedConnection.queryTimeoutMs, MAX_TIMEOUT_MS);
  assert.deepStrictEqual(
    resolveConnectionTimeouts(connection, { connectTimeoutMs: 1200, queryTimeoutMs: 3400 }),
    { connectTimeoutMs: 1200, queryTimeoutMs: 3400 }
  );
  assert.deepStrictEqual(
    resolveConnectionTimeouts(timedConnection, { connectTimeoutMs: 1200, queryTimeoutMs: 3400 }),
    { connectTimeoutMs: 0, queryTimeoutMs: MAX_TIMEOUT_MS },
    'connection overrides, including zero, must win independently'
  );
  assert.strictEqual(connectionSessionChanged(connection, { ...connection, name: 'Renamed' }), false);
  assert.strictEqual(connectionSessionChanged(connection, { ...connection, database: '.other' }), false);
  assert.strictEqual(connectionSessionChanged(connection, { ...connection, host: 'other.example.test' }), true);
  assert.strictEqual(connectionSessionChanged(connection, { ...connection, port: 6000 }), true);
  assert.strictEqual(connectionSessionChanged(connection, { ...connection, username: 'other' }), true);
  assert.strictEqual(connectionSessionChanged(connection, { ...connection, connectTimeoutMs: 0 }), true);
  assert.strictEqual(connectionSessionChanged(connection, { ...connection, queryTimeoutMs: 0 }), true);
  assert.strictEqual(connectionSessionChanged(connection, connection, true), true);

  assert.deepStrictEqual(
    safeStoredConnections([connection, { ...connection, id: 'bad', name: 'Local q' }, null, 'bad']),
    [connection],
    'invalid or duplicate hand-edited settings must be ignored'
  );
  assert.deepStrictEqual(safeStoredConnections([timedConnection]), [timedConnection]);
  assert.deepStrictEqual(
    safeStoredConnections([{ ...connection, connectTimeoutMs: MAX_TIMEOUT_MS + 1 }]),
    [],
    'out-of-range persisted overrides must be ignored instead of reaching timers'
  );
  assert.strictEqual(qString('a"b\\c\r\n\t'), '"a\\"b\\\\c\\r\\n\\t"');
  assert.strictEqual(queryInNamespace('  select from trade\n', '.'), '  select from trade\n');

  const rawQuery = 'a:"quoted";\nselect from trade';
  const wrapped = queryInNamespace(rawQuery, 'analytics.market');
  assert.ok(wrapped.includes('system "d ",ns'));
  assert.ok(wrapped.includes('previous:string system "d"'));
  assert.ok(wrapped.includes('if[not first outcome;\'last outcome]'));
  assert.ok(wrapped.includes(qString('.analytics.market')));
  assert.ok(wrapped.includes(qString(rawQuery)), 'the raw q text must be passed as one escaped q string');

  const strictRoot = queryInNamespaceStrict(rawQuery, '.');
  assert.notStrictEqual(strictRoot, rawQuery, 'strict metadata/preview execution must wrap even the root namespace');
  assert.ok(strictRoot.includes('previous:string system "d"'));
  assert.ok(strictRoot.includes('system "d ",previous'));
  assert.ok(strictRoot.includes(qString('.')));
  assert.ok(strictRoot.includes(qString(rawQuery)));
  assert.strictEqual(
    queryInNamespaceStrict(rawQuery, 'analytics.market'),
    queryInNamespace(rawQuery, '.analytics.market'),
    'strict and editor wrappers must agree for non-root configured namespaces'
  );

  const singleCharacter = queryInNamespace('1', '.analytics');
  assert.ok(singleCharacter.includes('src:$[-10h=type src;enlist src;src]'));
  const script = 'a:1\r\nb:2\r\na+b';
  const scriptWrapper = qScriptInNamespace(script, '.analytics');
  assert.ok(scriptWrapper.includes('.Q.ld'));
  assert.ok(scriptWrapper.includes('{[unused;expression] value expression}/[::;groups]'));
  assert.ok(scriptWrapper.includes('q 4.0 2023.03.28 or newer'));
  assert.ok(scriptWrapper.includes(qString(script)));
  assert.ok(scriptWrapper.includes(qString('.analytics')));
}

function testSqlToolsMigrationParsing() {
  assert.deepStrictEqual([...LEGACY_KDB_DRIVER_ALIASES], [
    'KDB',
    'kdb+',
    'kdb',
    'kdb-sqltools',
    'DanielAlonso.kdb-sqltools',
  ]);
  assert.strictEqual(LEGACY_CONNECTION_TIMEOUT_SECONDS, 30);
  for (const alias of LEGACY_KDB_DRIVER_ALIASES) {
    assert.strictEqual(
      normalizeLegacyDriverAlias(`  ${alias.toLocaleUpperCase()}  `),
      alias.trim().toLocaleLowerCase()
    );
    const parsed = parseSqlToolsConnection(legacySqlToolsProfile({ driver: alias }));
    assert.strictEqual(parsed.status, 'candidate');
    assert.strictEqual(parsed.candidate.status, 'importable');
  }
  for (const rejected of [
    '',
    'postgres',
    'KDB2',
    'foo.kdb',
    'DanielAlonso.kdb-sqltools.extra',
    42,
    new String('KDB'),
    { toString() { throw new Error('must not coerce driver aliases'); } },
  ]) {
    assert.strictEqual(normalizeLegacyDriverAlias(rejected), undefined);
  }

  let nonKdbSensitiveReads = 0;
  const nonKdb = { driver: 'PostgreSQL' };
  for (const field of ['name', 'server', 'port', 'password']) {
    Object.defineProperty(nonKdb, field, {
      enumerable: true,
      get() {
        nonKdbSensitiveReads++;
        throw new Error(`non-KDB ${field} must not be read`);
      },
    });
  }
  assert.deepStrictEqual(parseSqlToolsConnection(nonKdb), { status: 'ignored' });
  assert.strictEqual(nonKdbSensitiveReads, 0, 'non-KDB fields, especially passwords, must remain untouched');

  let sourceIdReads = 0;
  const sourceIdIgnored = legacySqlToolsProfile();
  Object.defineProperty(sourceIdIgnored, 'id', {
    enumerable: true,
    get() {
      sourceIdReads++;
      throw new Error('unsafe source IDs must not participate in migration');
    },
  });
  const rootParsed = parseSqlToolsConnection(sourceIdIgnored);
  assert.strictEqual(rootParsed.status, 'candidate');
  assert.strictEqual(rootParsed.candidate.status, 'importable');
  assert.strictEqual(sourceIdReads, 0);
  assert.strictEqual(rootParsed.candidate.database, '.');
  assert.strictEqual(rootParsed.candidate.username, '');
  assert.strictEqual(rootParsed.candidate.connectTimeoutMs, 30000);
  assert.strictEqual(rootParsed.candidate.connectionTimeoutSeconds, 30);
  assert.strictEqual(rootParsed.candidate.timeoutUsesSchemaDefault, true);
  assert.strictEqual(rootParsed.candidate.passwordState, 'absent');
  assert.ok(!Object.prototype.hasOwnProperty.call(rootParsed.candidate, 'queryTimeoutMs'));
  assert.ok(!Object.prototype.hasOwnProperty.call(rootParsed.candidate, 'password'));

  const explicitRoot = parseSqlToolsConnection(legacySqlToolsProfile({ database: '   ' }));
  assert.strictEqual(explicitRoot.candidate.database, '.');
  const namespace = parseSqlToolsConnection(legacySqlToolsProfile({ database: 'analytics.market' }));
  assert.strictEqual(namespace.candidate.database, '.analytics.market');

  const zeroTimeout = parseSqlToolsConnection(legacySqlToolsProfile({ connectionTimeout: 0 }));
  assert.strictEqual(zeroTimeout.candidate.status, 'importable');
  assert.strictEqual(zeroTimeout.candidate.connectTimeoutMs, 0);
  assert.strictEqual(zeroTimeout.candidate.timeoutUsesSchemaDefault, false);
  const fractionalTimeout = parseSqlToolsConnection(legacySqlToolsProfile({ connectionTimeout: 1.25 }));
  assert.strictEqual(fractionalTimeout.candidate.connectTimeoutMs, 1250);
  for (const invalidTimeout of [
    -1,
    Infinity,
    NaN,
    '30',
    0.0001,
    (MAX_TIMEOUT_MS + 1) / 1000,
  ]) {
    const parsed = parseSqlToolsConnection(legacySqlToolsProfile({ connectionTimeout: invalidTimeout }));
    assert.strictEqual(parsed.status, 'candidate');
    assert.strictEqual(parsed.candidate.status, 'unsupported');
    assert.match(parsed.candidate.reason, /connection timeout/i);
  }

  const mapped = mapSqlToolsCandidate(
    zeroTimeout.candidate,
    'kx-sqltools-zero',
    zeroTimeout.candidate.name
  );
  assert.deepStrictEqual(mapped, {
    id: 'kx-sqltools-zero',
    name: 'Legacy q',
    host: 'localhost',
    port: 5000,
    database: '.',
    username: '',
    connectTimeoutMs: 0,
  });
  assert.deepStrictEqual(
    resolveConnectionTimeouts(mapped, { connectTimeoutMs: 5000, queryTimeoutMs: 9000 }),
    { connectTimeoutMs: 0, queryTimeoutMs: 9000 },
    'legacy connectionTimeout must map to connect only; query remains inherited independently'
  );

  let sshOptionsReads = 0;
  const sshProfile = legacySqlToolsProfile({
    ssh: 'Enabled',
    password: ['direct', 'profile', 'secret'].join('-'),
  });
  Object.defineProperty(sshProfile, 'sshOptions', {
    enumerable: true,
    get() {
      sshOptionsReads++;
      throw new Error('SSH options and credentials must never be inspected');
    },
  });
  const ssh = parseSqlToolsConnection(sshProfile);
  assert.strictEqual(ssh.status, 'candidate');
  assert.strictEqual(ssh.candidate.status, 'unsupported');
  assert.strictEqual(ssh.candidate.reason, SQLTOOLS_SSH_UNSUPPORTED_REASON);
  assert.strictEqual(sshOptionsReads, 0);
  assert.ok(!Object.prototype.hasOwnProperty.call(ssh.candidate, 'sshOptions'));

  const malformedCases = [
    [legacySqlToolsProfile({ server: '' }), /missing server/i],
    [legacySqlToolsProfile({ port: 0 }), /port must be an integer/i],
    [legacySqlToolsProfile({ port: '5000' }), /port must be an integer/i],
    [legacySqlToolsProfile({ database: '.bad-name' }), /namespace/i],
    [legacySqlToolsProfile({ username: 'bad:user' }), /username/i],
    [legacySqlToolsProfile({ password: { unsafe: true } }), /password must be text/i],
    [legacySqlToolsProfile({ password: 'bad\0password' }), /password cannot contain null/i],
    [legacySqlToolsProfile({ password: 'x'.repeat(65536) }), /password must be 65535 characters/i],
    [legacySqlToolsProfile({ ssh: 'Unexpected' }), /unsupported SSH mode/i],
    [legacySqlToolsProfile({ name: '' }), /missing connection name/i],
  ];
  for (const [profile, reason] of malformedCases) {
    const parsed = parseSqlToolsConnection(profile);
    assert.strictEqual(parsed.status, 'candidate');
    assert.strictEqual(parsed.candidate.status, 'unsupported');
    assert.match(parsed.candidate.reason, reason);
  }
  for (const untrusted of [
    undefined,
    null,
    1,
    'KDB',
    [],
    new Proxy({ driver: 'KDB' }, {
      getOwnPropertyDescriptor() {
        throw new Error('hostile configuration proxy');
      },
    }),
  ]) {
    assert.doesNotThrow(() => parseSqlToolsConnection(untrusted));
  }

  const sanitized = sanitizeConnectionLabel('  $(zap)\u0000 Legacy\n q \u202e ');
  assert.strictEqual(sanitized, '$ (zap) Legacy q');
  assert.strictEqual(Array.from(sanitizeConnectionLabel('x'.repeat(120))).length, 100);
  const identity = sqlToolsCandidateIdentity('Legacy q', 'LOCALHOST', 5000, '.', 'runner');
  assert.strictEqual(
    identity,
    sqlToolsCandidateIdentity('legacy Q', 'localhost', 5000, '.', 'runner')
  );
  assert.ok(!identity.includes('source-id'));
  assert.ok(!identity.includes('secret'));

  const existing = validateConnection({
    id: 'kx-existing',
    name: 'Legacy q',
    host: 'localhost',
    port: 5000,
    database: '.',
    username: '',
  });
  assert.deepStrictEqual(findImportConflicts(rootParsed.candidate, 'Legacy q', [existing]), [existing]);
  assert.deepStrictEqual(findImportConflicts(rootParsed.candidate, 'Renamed import', [existing]), [existing]);
  assert.strictEqual(suggestImportedConnectionName('Legacy q', [existing]), 'Legacy q (imported)');
}

function testSqlToolsMigrationDiscovery() {
  const lowerSecret = ['lower', 'scope', 'secret'].join('-');
  const preferredSecret = ['preferred', 'scope', 'secret'].join('-');
  const globalProfile = legacySqlToolsProfile({
    id: 'unsafe-global-id',
    password: preferredSecret,
    connectionTimeout: 4,
  });
  const workspaceProfile = legacySqlToolsProfile({
    id: 'different-workspace-id',
    password: preferredSecret,
    connectionTimeout: 4,
  });
  const scopes = [
    {
      key: 'global',
      kind: 'global',
      label: 'User settings',
      priority: 10,
      value: [globalProfile, { driver: 'PostgreSQL', password: 'must-not-appear' }],
    },
    {
      key: 'workspace',
      kind: 'workspace',
      label: 'Workspace\nsettings',
      priority: 20,
      value: [workspaceProfile],
    },
    {
      key: 'folder',
      kind: 'workspaceFolder',
      label: 'Workspace folder: prices',
      priority: 30,
      value: [legacySqlToolsProfile({ password: preferredSecret, connectionTimeout: 4 })],
    },
    {
      key: 'malformed',
      kind: 'effective',
      label: 'Malformed effective',
      priority: 40,
      value: { connections: [] },
    },
  ];
  const discovery = discoverSqlToolsConnections(scopes);
  assert.strictEqual(discovery.candidates.length, 1, 'equivalent scope candidates must deduplicate');
  assert.strictEqual(discovery.issues.length, 1);
  const candidate = discovery.candidates[0];
  assert.strictEqual(candidate.status, 'importable');
  assert.strictEqual(candidate.preferredSourceKey, 'folder');
  assert.deepStrictEqual(candidate.sources.map(source => source.label), [
    'User settings',
    'Workspace settings',
    'Workspace folder: prices',
  ]);
  assert.strictEqual(candidate.connectTimeoutMs, 4000);
  assert.strictEqual(candidate.passwordState, 'present');
  assert.deepStrictEqual(readConfirmedCandidatePassword(scopes, candidate), {
    status: 'available',
    password: preferredSecret,
  });
  assert.ok(!JSON.stringify(candidate).includes(lowerSecret));
  assert.ok(!JSON.stringify(candidate).includes(preferredSecret));
  assert.ok(!migrationCandidateReviewDetail(candidate).includes(lowerSecret));
  assert.ok(!migrationCandidateReviewDetail(candidate).includes(preferredSecret));
  assert.match(migrationCandidateReviewDetail(candidate), /Password: present \(value hidden\)/);
  assert.match(migrationCandidateReviewDetail(candidate), /4000 ms connect only/);
  assert.match(migrationCandidateReviewDetail(candidate), /Query timeout: inherits the KX default/);
  assert.match(migrationCandidateReviewDetail(candidate), /Selected source entry: 1/);

  const credentialVariants = discoverSqlToolsConnections([
    {
      key: 'global-variants',
      kind: 'global',
      label: 'User variants',
      priority: 10,
      value: [
        legacySqlToolsProfile({ password: lowerSecret, connectionTimeout: 4 }),
        legacySqlToolsProfile({ password: preferredSecret, connectionTimeout: 4 }),
      ],
    },
  ]);
  assert.strictEqual(
    credentialVariants.candidates.length,
    2,
    'same-scope entries remain independently reviewable even when candidate identity matches'
  );
  assert.deepStrictEqual(
    credentialVariants.candidates.map(item =>
      readConfirmedCandidatePassword([
        {
          key: 'global-variants',
          kind: 'global',
          label: 'User variants',
          priority: 10,
          value: [
            legacySqlToolsProfile({ password: lowerSecret, connectionTimeout: 4 }),
            legacySqlToolsProfile({ password: preferredSecret, connectionTimeout: 4 }),
          ],
        },
      ], item).password
    ).sort(),
    [lowerSecret, preferredSecret].sort()
  );
  assert.ok(!JSON.stringify(credentialVariants.candidates).includes(lowerSecret));
  assert.ok(!JSON.stringify(credentialVariants.candidates).includes(preferredSecret));

  const credentialReadCounts = [0, 0];
  const indexedProfiles = [lowerSecret, preferredSecret].map((secret, index) => {
    const profile = legacySqlToolsProfile({
      name: `Indexed q ${index + 1}`,
      connectionTimeout: 4,
    });
    Object.defineProperty(profile, 'password', {
      enumerable: true,
      get() {
        credentialReadCounts[index]++;
        return secret;
      },
    });
    return profile;
  });
  const indexedDiscovery = discoverSqlToolsConnections([{
    key: 'indexed',
    kind: 'global',
    label: 'Indexed source',
    priority: 10,
    value: indexedProfiles,
  }]);
  credentialReadCounts.fill(0);
  const indexedCandidate = indexedDiscovery.candidates.find(item => item.preferredEntryIndex === 1);
  assert.ok(indexedCandidate && indexedCandidate.status === 'importable');
  assert.deepStrictEqual(
    readConfirmedCandidatePassword([{
      key: 'indexed',
      kind: 'global',
      label: 'Indexed source',
      priority: 10,
      value: indexedProfiles,
    }], indexedCandidate),
    { status: 'available', password: preferredSecret }
  );
  assert.deepStrictEqual(
    credentialReadCounts,
    [0, 1],
    'confirmed migration must read only the selected exact source entry password once'
  );

  const unreadablePasswordProfile = () => {
    const profile = legacySqlToolsProfile({ connectionTimeout: 4 });
    Object.defineProperty(profile, 'password', {
      enumerable: true,
      get() {
        throw new Error('unreadable credential');
      },
    });
    return profile;
  };
  const unreadableDiscovery = discoverSqlToolsConnections([
    {
      key: 'unreadable-global',
      kind: 'global',
      label: 'Unreadable user profile',
      priority: 10,
      value: [unreadablePasswordProfile()],
    },
    {
      key: 'unreadable-workspace',
      kind: 'workspace',
      label: 'Unreadable workspace profile',
      priority: 20,
      value: [unreadablePasswordProfile()],
    },
  ]);
  assert.strictEqual(
    unreadableDiscovery.candidates.length,
    1,
    'equivalent unreadable credentials must deduplicate without retaining a password value'
  );
  assert.strictEqual(unreadableDiscovery.candidates[0].status, 'unsupported');
  assert.strictEqual(unreadableDiscovery.candidates[0].passwordState, 'unavailable');
  assert.deepStrictEqual(
    unreadableDiscovery.candidates[0].sources.map(source => source.label),
    ['Unreadable user profile', 'Unreadable workspace profile']
  );

  const directAndSsh = discoverSqlToolsConnections([{
    key: 'same-scope-security-boundary',
    kind: 'global',
    label: 'Same scope',
    priority: 10,
    value: [
      legacySqlToolsProfile(),
      legacySqlToolsProfile({ ssh: 'Enabled' }),
    ],
  }]);
  assert.strictEqual(
    directAndSsh.candidates.length,
    2,
    'identity deduplication must never hide an SSH-dependent candidate in the same scope'
  );
  assert.strictEqual(
    directAndSsh.candidates.filter(item => item.status === 'importable').length,
    1
  );
  assert.strictEqual(
    directAndSsh.candidates.find(item => item.status === 'unsupported').reason,
    SQLTOOLS_SSH_UNSUPPORTED_REASON
  );

  const changedScopes = scopes.map(scope => scope.key === 'folder'
    ? { ...scope, value: [legacySqlToolsProfile({ password: '', connectionTimeout: 4 })] }
    : scope);
  assert.deepStrictEqual(readConfirmedCandidatePassword(changedScopes, candidate), { status: 'changed' });
  const noPasswordDiscovery = discoverSqlToolsConnections([{
    key: 'global',
    kind: 'global',
    label: 'User',
    priority: 10,
    value: [legacySqlToolsProfile()],
  }]);
  assert.deepStrictEqual(
    readConfirmedCandidatePassword([{
      key: 'global',
      kind: 'global',
      label: 'User',
      priority: 10,
      value: [legacySqlToolsProfile()],
    }], noPasswordDiscovery.candidates[0]),
    { status: 'not-present' }
  );

  const folderAUri = {
    key: 'a',
    toString() {
      return 'file:///workspace/a';
    },
  };
  const folderBUri = {
    key: 'b',
    toString() {
      return 'file:///workspace/b';
    },
  };
  const inspectedApi = createSqlToolsConfigurationApi({
    rootInspection: {
      key: 'sqltools.connections',
      defaultValue: [legacySqlToolsProfile({ name: 'Default must not import' })],
      globalValue: [globalProfile],
      workspaceValue: [workspaceProfile],
    },
    folders: [
      {
        name: 'Folder\nA',
        uri: folderAUri,
        inspection: {
          key: 'sqltools.connections',
          globalValue: [globalProfile],
          workspaceValue: [workspaceProfile],
          workspaceFolderValue: [legacySqlToolsProfile({ name: 'Folder A q' })],
        },
        effective: [legacySqlToolsProfile({ name: 'Effective A must not duplicate' })],
      },
      {
        name: 'Folder B',
        uri: folderBUri,
        inspection: {
          key: 'sqltools.connections',
          globalValue: [globalProfile],
          workspaceValue: [workspaceProfile],
          workspaceFolderValue: [legacySqlToolsProfile({
            name: 'Folder B q',
            password: preferredSecret,
          })],
        },
        effective: [legacySqlToolsProfile({ name: 'Effective B must not duplicate' })],
      },
    ],
  });
  const inspectedScopes = readSqlToolsConfigurationScopes(inspectedApi);
  assert.deepStrictEqual(inspectedScopes.map(scope => [scope.kind, scope.label]), [
    ['global', 'User settings'],
    ['workspace', 'Workspace settings'],
    ['workspaceFolder', 'Workspace folder: Folder A'],
    ['workspaceFolder', 'Workspace folder: Folder B'],
  ]);
  const folderKeys = new Map(
    inspectedScopes
      .filter(scope => scope.kind === 'workspaceFolder')
      .map(scope => [scope.label, scope.key])
  );
  assert.ok([...folderKeys.values()].every(key =>
    /^workspace-folder-[a-f0-9]{64}$/.test(key) &&
    !key.includes('/workspace/')
  ));
  const reorderedApi = createSqlToolsConfigurationApi({
    rootInspection: inspectedApi.workspace.getConfiguration('sqltools').inspect('connections'),
    folders: [
      {
        name: 'Folder B',
        uri: folderBUri,
        inspection: inspectedApi.workspace
          .getConfiguration('sqltools', folderBUri)
          .inspect('connections'),
      },
      {
        name: 'Folder A',
        uri: folderAUri,
        inspection: inspectedApi.workspace
          .getConfiguration('sqltools', folderAUri)
          .inspect('connections'),
      },
    ],
  });
  const reorderedScopes = readSqlToolsConfigurationScopes(reorderedApi);
  const reorderedFolderKeys = new Map(
    reorderedScopes
      .filter(scope => scope.kind === 'workspaceFolder')
      .map(scope => [scope.label, scope.key])
  );
  assert.deepStrictEqual(
    [...reorderedFolderKeys].sort(),
    [...folderKeys].sort(),
    'workspace-folder source keys must remain stable when folder order changes'
  );
  assert.strictEqual(inspectedApi.extensions, undefined, 'discovery must not require an installed SQLTools extension');
  const inspectedDiscovery = discoverSqlToolsConnections(inspectedScopes);
  const inspectedNames = inspectedDiscovery.candidates.map(item => item.name);
  assert.ok(inspectedNames.includes('Legacy q'));
  assert.ok(inspectedNames.includes('Folder A q'));
  assert.ok(inspectedNames.includes('Folder B q'));
  assert.ok(!inspectedNames.some(name => /Default|Effective/.test(name)));
  const folderBCandidate = inspectedDiscovery.candidates.find(item => item.name === 'Folder B q');
  assert.ok(folderBCandidate && folderBCandidate.status === 'importable');
  assert.deepStrictEqual(
    readConfirmedCandidatePassword(reorderedScopes, folderBCandidate),
    { status: 'available', password: preferredSecret },
    'fresh confirmed reads must resolve the same folder after workspace-folder reordering'
  );

  const effectiveApi = createSqlToolsConfigurationApi({
    rootInspection: undefined,
    folders: [{
      name: 'Only folder',
      uri: {
        key: 'only',
        toString() {
          return 'file:///workspace/only';
        },
      },
      inspection: undefined,
      effective: [legacySqlToolsProfile({ name: 'Effective q' })],
    }],
  });
  const effectiveScopes = readSqlToolsConfigurationScopes(effectiveApi);
  assert.deepStrictEqual(effectiveScopes.map(scope => [scope.kind, scope.label]), [
    ['effective', 'Effective settings for workspace folder: Only folder'],
  ]);
  assert.deepStrictEqual(
    discoverSqlToolsConnections(effectiveScopes).candidates.map(item => item.name),
    ['Effective q']
  );

  const rootEffectiveApi = createSqlToolsConfigurationApi({
    rootInspection: undefined,
    rootEffective: [legacySqlToolsProfile({ name: 'Root effective q' })],
    folders: [],
  });
  assert.deepStrictEqual(
    readSqlToolsConfigurationScopes(rootEffectiveApi).map(scope => [scope.key, scope.kind]),
    [['effective', 'effective']]
  );
  const brokenApi = {
    workspace: {
      get workspaceFolders() {
        throw new Error('hostile workspace folders');
      },
      getConfiguration() {
        throw new Error('configuration unavailable');
      },
    },
  };
  assert.doesNotThrow(() => readSqlToolsConfigurationScopes({
    workspace: {
      workspaceFolders: undefined,
      getConfiguration() {
        throw new Error('configuration unavailable');
      },
    },
  }));
  assert.deepStrictEqual(readSqlToolsConfigurationScopes({
    workspace: {
      workspaceFolders: undefined,
      getConfiguration() {
        throw new Error('configuration unavailable');
      },
    },
  }), []);
  assert.deepStrictEqual(readSqlToolsConfigurationScopes(brokenApi), []);
}

async function testSqlToolsMigrationCommand() {
  const sourceSecret = ['migration', 'source', 'secret'].join('-');
  const sshSecret = ['ssh', 'must', 'remain', 'hidden'].join('-');

  const noCandidates = createMigrationCommandHarness({ sqlToolsGlobal: [] });
  await noCandidates.command.run();
  assert.strictEqual(noCandidates.quickPicks.length, 0);
  assert.strictEqual(noCandidates.treeRefreshes, 0);
  assert.strictEqual(noCandidates.information.length, 1);
  assert.match(noCandidates.information[0].message, /No legacy SQLTools KDB connection candidates/i);
  assert.match(noCandidates.information[0].message, /does not need to be installed/i);
  assert.deepStrictEqual(noCandidates.connections, []);

  const declined = createMigrationCommandHarness({
    sqlToolsGlobal: [legacySqlToolsProfile({ password: sourceSecret })],
    passwordDecision: undefined,
  });
  await declined.command.run();
  assert.deepStrictEqual(declined.connections, []);
  assert.strictEqual(declined.treeRefreshes, 0);
  assert.strictEqual(declined.warnings.length, 1);
  assert.deepStrictEqual(declined.warnings[0].actions, [
    'Copy Passwords and Import',
    'Import Without Passwords',
  ]);
  assert.match(declined.warnings[0].message, /one time into VS Code SecretStorage/i);
  assert.match(declined.warnings[0].message, /existing SQLTools setting will remain unchanged/i);
  assert.strictEqual(declined.sqlToolsUpdates, 0);
  assert.ok(!JSON.stringify({
    quickPicks: declined.quickPicks,
    warnings: declined.warnings,
    information: declined.information,
  }).includes(sourceSecret));
  assert.match(declined.information.at(-1).message, /import canceled/i);

  const imported = createMigrationCommandHarness({
    sqlToolsGlobal: [
      legacySqlToolsProfile({
        name: 'Imported q',
        server: 'q.example.test',
        database: 'analytics',
        username: 'runner',
        password: sourceSecret,
        connectionTimeout: 0,
      }),
      legacySqlToolsProfile({
        name: 'SSH q',
        server: 'ssh-target.example.test',
        password: 'direct-profile-secret',
        ssh: 'Enabled',
        sshOptions: {
          host: 'bastion.example.test',
          username: 'ssh-user',
          password: sshSecret,
        },
      }),
    ],
    passwordDecision: 'Copy Passwords and Import',
    reviewAfterImport: true,
    selectUnsupported: true,
  });
  await imported.command.run();
  assert.strictEqual(imported.quickPicks.length, 1);
  const reviewItems = imported.quickPicks[0].items;
  assert.strictEqual(reviewItems.length, 2);
  assert.strictEqual(reviewItems.filter(item => item.selectable).length, 1);
  assert.strictEqual(reviewItems.find(item => !item.selectable).candidate.reason, SQLTOOLS_SSH_UNSUPPORTED_REASON);
  assert.ok(!JSON.stringify(reviewItems).includes(sourceSecret));
  assert.ok(!JSON.stringify(reviewItems).includes(sshSecret));
  assert.deepStrictEqual(imported.connections, [{
    id: 'kx-import-1',
    name: 'Imported q',
    host: 'q.example.test',
    port: 5000,
    database: '.analytics',
    username: 'runner',
    connectTimeoutMs: 0,
  }]);
  assert.strictEqual(imported.secretFor('kx-import-1'), sourceSecret);
  assert.strictEqual(imported.sourcePassword(), sourceSecret, 'source SQLTools settings must remain unchanged');
  assert.strictEqual(imported.sqlToolsUpdates, 0);
  assert.strictEqual(imported.treeRefreshes, 1);
  assert.strictEqual(imported.activeId, 'kx-import-1');
  assert.match(imported.information.at(-1).message, /1 imported, 0 skipped, 1 unsupported, 0 failed/);
  assert.match(imported.information.at(-1).message, /no automatic ongoing sync/i);
  assert.deepStrictEqual(imported.executedCommands, [{
    command: 'vscode-kdb.editConnection',
    args: ['kx-import-1'],
  }]);

  const withoutPassword = createMigrationCommandHarness({
    sqlToolsGlobal: [legacySqlToolsProfile({ name: 'No copied password', password: sourceSecret })],
    passwordDecision: 'Import Without Passwords',
  });
  await withoutPassword.command.run();
  assert.strictEqual(withoutPassword.connections.length, 1);
  assert.strictEqual(withoutPassword.secretFor('kx-import-1'), undefined);
  assert.strictEqual(withoutPassword.sourcePassword(), sourceSecret);
  assert.strictEqual(withoutPassword.sqlToolsUpdates, 0);
  assert.match(withoutPassword.information.at(-1).message, /1 imported/);

  const existing = validateConnection({
    id: 'kx-existing-import',
    name: 'Legacy q',
    host: 'localhost',
    port: 5000,
    database: '.',
    username: '',
  });
  const existingSecret = ['existing', 'saved', 'secret'].join('-');
  const skipped = createMigrationCommandHarness({
    sqlToolsGlobal: [legacySqlToolsProfile({ password: sourceSecret })],
    initialConnections: [existing],
    initialActiveId: existing.id,
    initialSecrets: { [existing.id]: existingSecret },
    conflictDecision: 'skip',
    passwordDecision: 'Copy Passwords and Import',
  });
  await skipped.command.run();
  assert.deepStrictEqual(skipped.connections, [existing]);
  assert.strictEqual(skipped.activeId, existing.id);
  assert.strictEqual(skipped.secretFor(existing.id), existingSecret);
  assert.strictEqual(skipped.treeRefreshes, 0);
  assert.strictEqual(skipped.conflictPicks.length, 1);
  assert.deepStrictEqual(
    skipped.conflictPicks[0].items.map(item => item.action),
    ['skip', 'rename'],
    'replace must not be offered; existing profiles are never overwritten'
  );
  assert.strictEqual(
    skipped.conflictPicks[0].items.some(item => /replace/i.test(`${item.label} ${item.description}`)),
    false
  );
  assert.match(skipped.information.at(-1).message, /0 imported, 1 skipped/);
  assert.strictEqual(skipped.warnings.length, 0, 'skipped conflicts must not prompt to copy an unused password');

  const renamed = createMigrationCommandHarness({
    sqlToolsGlobal: [legacySqlToolsProfile({ password: sourceSecret })],
    initialConnections: [existing],
    initialActiveId: existing.id,
    initialSecrets: { [existing.id]: existingSecret },
    conflictDecision: 'rename',
    renameValue: 'Legacy q migrated',
    passwordDecision: 'Copy Passwords and Import',
  });
  await renamed.command.run();
  assert.deepStrictEqual(renamed.connections.map(connection => connection.name), [
    'Legacy q',
    'Legacy q migrated',
  ]);
  assert.strictEqual(renamed.connections[1].id, 'kx-import-1');
  assert.strictEqual(renamed.activeId, existing.id, 'rename import must not replace or reactivate an existing profile');
  assert.strictEqual(renamed.secretFor(existing.id), existingSecret);
  assert.strictEqual(renamed.secretFor('kx-import-1'), sourceSecret);
  assert.strictEqual(renamed.treeRefreshes, 1);
  assert.deepStrictEqual(renamed.conflictPicks[0].items.map(item => item.action), ['skip', 'rename']);
  assert.strictEqual(renamed.inputBoxes.length, 1);
  assert.match(renamed.inputBoxes[0].prompt, /saved profile will not be replaced/i);

  const lateConflict = validateConnection({
    id: 'kx-late-conflict',
    name: 'Late conflict q',
    host: 'other.example.test',
    port: 5100,
    database: '.',
    username: '',
  });
  const raced = createMigrationCommandHarness({
    sqlToolsGlobal: [legacySqlToolsProfile({
      name: 'Late conflict q',
      server: 'candidate.example.test',
      password: sourceSecret,
    })],
    kxConnectionsAfterPasswordDecision: [lateConflict],
    passwordDecision: 'Copy Passwords and Import',
  });
  await raced.command.run();
  assert.deepStrictEqual(raced.connections, [lateConflict]);
  assert.strictEqual(raced.secretFor('kx-import-1'), undefined);
  assert.strictEqual(raced.treeRefreshes, 0);
  assert.match(
    raced.information.at(-1).message,
    /0 imported, 1 skipped, 0 unsupported, 0 failed/,
    'a conflict introduced after planning must be rechecked and safely skipped'
  );

  const failed = createMigrationCommandHarness({
    sqlToolsGlobal: [legacySqlToolsProfile({ name: 'Failure q', password: sourceSecret })],
    passwordDecision: 'Copy Passwords and Import',
    failSecretStore: true,
  });
  await failed.command.run();
  assert.deepStrictEqual(failed.connections, []);
  assert.strictEqual(failed.treeRefreshes, 0);
  assert.match(failed.information.at(-1).message, /0 imported, 0 skipped, 0 unsupported, 1 failed/);
  assert.ok(!JSON.stringify({
    quickPicks: failed.quickPicks,
    warnings: failed.warnings,
    information: failed.information,
  }).includes(sourceSecret), 'SecretStorage failures must not expose the selected password');

  const mixedExisting = validateConnection({
    id: 'kx-mixed-existing',
    name: 'Conflict q',
    host: 'saved.example.test',
    port: 5100,
    database: '.',
    username: '',
  });
  const mixedSource = [
    legacySqlToolsProfile({ name: 'Good q', server: 'good.example.test' }),
    legacySqlToolsProfile({
      name: 'Failure q',
      server: 'failure.example.test',
      password: sourceSecret,
    }),
    legacySqlToolsProfile({ name: 'Conflict q', server: 'new.example.test' }),
    legacySqlToolsProfile({ name: 'Unselected q', server: 'unselected.example.test' }),
    legacySqlToolsProfile({ name: 'SSH q', server: 'ssh.example.test', ssh: 'Enabled' }),
  ];
  const mixedAfterConsent = mixedSource.map(profile => profile.name === 'Failure q'
    ? { ...profile, password: '' }
    : profile);
  const mixed = createMigrationCommandHarness({
    sqlToolsGlobal: mixedSource,
    sqlToolsAfterPasswordDecision: mixedAfterConsent,
    initialConnections: [mixedExisting],
    initialActiveId: mixedExisting.id,
    conflictDecision: 'skip',
    passwordDecision: 'Copy Passwords and Import',
    selectCandidate: candidate => candidate.name !== 'Unselected q',
  });
  await mixed.command.run();
  assert.deepStrictEqual(
    mixed.connections.map(connection => connection.name),
    ['Conflict q', 'Good q'],
    'only the non-conflicting candidate with an available confirmed credential state is imported'
  );
  assert.strictEqual(mixed.activeId, mixedExisting.id);
  assert.strictEqual(mixed.secretFor('kx-import-1'), undefined);
  assert.strictEqual(mixed.treeRefreshes, 1, 'a partial success refreshes the KX trees exactly once');
  assert.strictEqual(mixed.conflictPicks.length, 1, 'same-name/different-endpoint conflicts require a choice');
  assert.match(
    mixed.information.at(-1).message,
    /1 imported, 2 skipped, 1 unsupported, 1 failed/,
    'mixed summary counts must include selection, conflict, unsupported, and changed-source outcomes'
  );
  assert.strictEqual(mixed.sqlToolsUpdates, 0);
}

function testServerExplorerModel() {
  assert.strictEqual(DEFAULT_SERVER_PREVIEW_CELL_LIMIT, 10_000);
  assert.strictEqual(MIN_SERVER_PREVIEW_CELL_LIMIT, 1);
  assert.strictEqual(MAX_SERVER_PREVIEW_CELL_LIMIT, 1_000_000);
  assert.strictEqual(SERVER_TABLES_QUERY, 'string tables[]');
  assert.strictEqual(
    SERVER_VARIABLES_QUERY,
    [
      '{[]',
      '  names:key `$string system "d";',
      '  names:names where 0<count each string names;',
      '  names:names except tables[];',
      '  types:{@[{type value x};x;{0Nh}]} each names;',
      '  flip `name`type!(string names;types)',
      '}[]',
    ].join('\n'),
    'variables metadata must return names/type atoms without returning remote values'
  );

  assert.strictEqual(validateServerObjectIdentifier('trade'), 'trade');
  assert.strictEqual(validateServerObjectIdentifier('Trade_2026'), 'Trade_2026');
  assert.strictEqual(validateServerObjectIdentifier(`a${'b'.repeat(254)}`).length, 255);
  for (const hostile of [
    '',
    '.analytics.trade',
    '1trade',
    '_trade',
    'trade price',
    'trade;delete from trade',
    'trade\nshow 1',
    'trade"',
    'trade\\path',
    `a${'b'.repeat(255)}`,
  ]) {
    assert.throws(
      () => validateServerObjectIdentifier(hostile),
      /standard q identifiers up to 255 characters/,
      `unsafe Server Explorer identifier must be rejected: ${JSON.stringify(hostile)}`
    );
    assert.throws(() => buildServerTableMetaQuery(hostile), /standard q identifiers/);
    assert.throws(() => buildServerPreviewQuery(hostile, 'table', 100), /standard q identifiers/);
  }

  assert.strictEqual(buildServerTableMetaQuery('trade'), '0!meta `trade');
  assert.strictEqual(
    buildServerPreviewQuery('trade', 'table', 12),
    [
      '{[objectName;limit]',
      '  objectValue:value objectName;',
      '  (limit div 1|count cols objectName)#objectValue',
      '}[`trade;12]',
    ].join('\n')
  );
  const variablePreview = buildServerPreviewQuery('items', 'variable', 25);
  assert.strictEqual(
    variablePreview,
    [
      '{[objectName;limit]',
      '  objectValue:value objectName;',
      '  objectType:type objectValue;',
      `  if[objectType>=100h;'"Function and projection previews are disabled."];`,
      '  $[98h=objectType;(limit div 1|count cols objectName)#objectValue;',
      '    99h=objectType;$[98h=type key objectValue;(limit div 1|count cols objectName)#objectValue;limit#objectValue];',
      '    objectType<0h;objectValue;',
      '    objectType<98h;limit#objectValue;',
      '    objectValue]',
      '}[`items;25]',
    ].join('\n')
  );
  assert.match(variablePreview, /objectType>=100h/, 'runtime type checks must reject disguised functions/projections');
  assert.throws(
    () => buildServerPreviewQuery('calculate', 'function', 25),
    /limited to tables and variables/
  );
  assert.throws(() => serverPreviewWarning('calculate', 'function', '.', 25), /limited to tables and variables/);
  assert.throws(() => buildServerPreviewQuery('trade', 'view', 10), /limited to tables and variables/);

  assert.strictEqual(safeServerPreviewCellLimit(1), 1);
  assert.strictEqual(safeServerPreviewCellLimit(1_000_000), 1_000_000);
  for (const invalid of [0, -1, 1.5, 1_000_001, '100', null, undefined, NaN, Infinity]) {
    assert.strictEqual(
      safeServerPreviewCellLimit(invalid),
      DEFAULT_SERVER_PREVIEW_CELL_LIMIT,
      'hand-edited preview limits must fail closed to the bounded default'
    );
  }
  assert.ok(buildServerPreviewQuery('trade', 'table', 'untrusted').endsWith('}[`trade;10000]'));
  const tableWarning = serverPreviewWarning('trade', 'table', '.analytics', 12_345);
  assert.match(tableWarning, /Preview table "trade" from namespace \.analytics\?/);
  assert.match(tableWarning, /12,345 cells/);
  assert.match(tableWarning, /nested values can still be large/i);
  const variableWarning = serverPreviewWarning('items', 'variable', '.', 25);
  assert.match(variableWarning, /Lists and dictionaries are capped to 25 outer items/);
  assert.match(variableWarning, /scalars and nested values may still be large/);
  assert.match(variableWarning, /Functions and projections are metadata-only/);

  assert.deepStrictEqual(
    parseServerTableNames(['zeta', 'alpha', 'zeta', 'bad;name', '', 42]),
    { names: ['alpha', 'zeta'], omittedUnsafeNames: 2 }
  );
  assert.deepStrictEqual(
    parseServerTableNames('trade'),
    { names: ['trade'], omittedUnsafeNames: 0 }
  );
  assert.throws(() => parseServerTableNames(42), /unexpected table-list shape/);

  const variables = parseServerVariables(modelQTable(
    ['name', 'type'],
    [
      { name: 'vector', type: 7 },
      { name: 'fn', type: 100 },
      { name: 'projection', type: 104 },
      { name: 'futureType', type: 113 },
      { name: 'unknownType', type: null },
      { name: 'fn', type: 101 },
      { name: 'bad;name', type: 100 },
    ]
  ));
  assert.deepStrictEqual(variables, {
    variables: [
      { name: 'fn', kind: 'function', qType: 100 },
      { name: 'futureType', kind: 'variable', qType: 113 },
      { name: 'projection', kind: 'function', qType: 104 },
      { name: 'unknownType', kind: 'variable' },
      { name: 'vector', kind: 'variable', qType: 7 },
    ],
    omittedUnsafeNames: 1,
  });
  assert.throws(
    () => parseServerVariables(modelQTable(['object', 'type'], [])),
    /unexpected variables metadata shape/
  );

  assert.deepStrictEqual(
    parseServerColumns(modelQTable(
      ['c', 't', 'f', 'a'],
      [
        { c: 'sym', t: 's', f: '', a: 'p' },
        { c: 'size\u0000', t: 'j', f: 'ref', a: '' },
        { c: 'mystery', t: '?', f: null, a: null },
      ]
    )),
    [
      { name: 'sym', qTypeCode: 's', qTypeName: 'symbol', foreignKey: '', attribute: 'p' },
      { name: 'size', qTypeCode: 'j', qTypeName: 'long', foreignKey: 'ref', attribute: '' },
      { name: 'mystery', qTypeCode: '?', qTypeName: 'q type ?', foreignKey: '', attribute: '' },
    ]
  );
  assert.strictEqual(qMetaTypeName('p'), 'timestamp');
  assert.strictEqual(qMetaTypeName(''), 'unknown');
  assert.throws(
    () => parseServerColumns(modelQTable(['name', 'type'], [])),
    /unexpected meta shape/
  );

  const snapshot = { connectionId: 'kx-active', namespace: '.analytics' };
  assert.strictEqual(serverExplorerSnapshotMatches(snapshot, 'kx-active', '.analytics', true), true);
  assert.strictEqual(serverExplorerSnapshotMatches(snapshot, 'kx-other', '.analytics', true), false);
  assert.strictEqual(serverExplorerSnapshotMatches(snapshot, 'kx-active', '.other', true), false);
  assert.strictEqual(serverExplorerSnapshotMatches(snapshot, 'kx-active', '.analytics', false), false);
  assert.strictEqual(serverExplorerSnapshotMatches(snapshot, undefined, undefined, true), false);
}

async function testQueryHistoryModel() {
  assert.strictEqual(historyRerunRequiresConfirmation('kx-one', 'kx-one'), false);
  assert.strictEqual(historyRerunRequiresConfirmation('kx-recorded', 'kx-target'), true);

  assert.strictEqual(DEFAULT_QUERY_HISTORY_MAX_ENTRIES, 100);
  assert.strictEqual(MIN_QUERY_HISTORY_MAX_ENTRIES, 1);
  assert.strictEqual(MAX_QUERY_HISTORY_MAX_ENTRIES, 1000);
  assert.strictEqual(safeHistoryLimit(1), 1);
  assert.strictEqual(safeHistoryLimit(1000), 1000);
  assert.strictEqual(safeHistoryLimit('10'), DEFAULT_QUERY_HISTORY_MAX_ENTRIES);
  assert.strictEqual(safeHistoryLimit(0), DEFAULT_QUERY_HISTORY_MAX_ENTRIES);
  assert.strictEqual(safeHistoryLimit(1001), DEFAULT_QUERY_HISTORY_MAX_ENTRIES);
  assert.strictEqual(safeHistoryLimit(12, 7), 12);
  assert.strictEqual(safeHistoryLimit('bad', 7), 7);

  const safe = historyEntry({
    id: 'entry-safe',
    timestamp: 300,
    kind: 'selection',
    status: 'failed',
    durationMs: 12.5,
    queryText: 'select from trade',
  });
  const normalized = normalizeQueryHistoryEntry({
    ...safe,
    result: [{ password: 'must-not-persist' }],
    password: 'must-not-persist',
    error: 'remote payload',
    host: 'private.example.test',
    username: 'private-user',
  });
  assert.deepStrictEqual(normalized, safe);
  assert.deepStrictEqual(
    Object.keys(normalized).sort(),
    ['connectionId', 'connectionName', 'durationMs', 'id', 'kind', 'queryText', 'status', 'timestamp']
  );
  for (const invalid of [
    null,
    {},
    { ...safe, id: '' },
    { ...safe, connectionId: '' },
    { ...safe, connectionName: '' },
    { ...safe, timestamp: -1 },
    { ...safe, timestamp: 1.5 },
    { ...safe, kind: 'preview' },
    { ...safe, status: 'pending' },
    { ...safe, durationMs: -1 },
    { ...safe, durationMs: Infinity },
    { ...safe, queryText: '' },
  ]) {
    assert.strictEqual(normalizeQueryHistoryEntry(invalid), undefined);
  }
  for (const kind of ['line', 'selection', 'script']) {
    for (const status of ['succeeded', 'failed', 'canceled']) {
      assert.ok(normalizeQueryHistoryEntry(historyEntry({ id: `${kind}-${status}`, kind, status })));
    }
  }

  const oldest = historyEntry({ id: 'oldest', timestamp: 100 });
  const equalA = historyEntry({ id: 'equal-a', timestamp: 200 });
  const equalB = historyEntry({ id: 'equal-b', timestamp: 200 });
  const newest = historyEntry({ id: 'newest', timestamp: 300 });
  assert.deepStrictEqual(
    sortHistoryNewestFirst([oldest, equalA, newest, equalB]).map(entry => entry.id),
    ['newest', 'equal-a', 'equal-b', 'oldest'],
    'newest ordering must be deterministic and stable for equal timestamps'
  );
  assert.deepStrictEqual(
    normalizeQueryHistoryEntries([
      oldest,
      { ...newest, result: [1, 2, 3] },
      { ...newest, timestamp: 50 },
      equalA,
      { ...safe, id: '' },
    ], 3).map(entry => entry.id),
    ['newest', 'equal-a', 'oldest'],
    'corrupt entries and duplicate IDs must be stripped before the configured bound is applied'
  );
  assert.deepStrictEqual(normalizeQueryHistoryEntries('corrupt'), []);

  assert.strictEqual(historyTransportKind('line', 'a:1'), 'query');
  assert.strictEqual(historyTransportKind('selection', 'a:1'), 'query');
  assert.strictEqual(historyTransportKind('selection', 'a:1\nb:2'), 'script');
  assert.strictEqual(historyTransportKind('selection', 'a:1\r\nb:2'), 'script');
  assert.strictEqual(historyTransportKind('script', '1+1'), 'script');
  assert.strictEqual(historyTransportKind({ ...safe, kind: 'selection', queryText: 'x\ny' }), 'script');

  const initialMemento = createHistoryMemento([
    { ...oldest, password: 'strip-me', result: [42] },
    { ...newest, error: 'strip-me' },
    { ...safe, id: '' },
  ]);
  const initialStore = new QueryHistoryStore(initialMemento, { maxEntries: 2 });
  assert.deepStrictEqual(initialStore.entries().map(entry => entry.id), ['newest', 'oldest']);
  const pruned = await initialStore.prune();
  assert.deepStrictEqual(pruned.map(entry => entry.id), ['newest', 'oldest']);
  assertHistoryStorageShape(initialMemento.value);
  assert.ok(!JSON.stringify(initialMemento.value).includes('strip-me'));

  let nextId = 0;
  let configuredLimit = 3;
  const memento = createHistoryMemento();
  const store = new QueryHistoryStore(memento, {
    maxEntries: () => configuredLimit,
    now: () => 999,
    createId: () => `generated-${++nextId}`,
  });
  const generation = store.captureGeneration();
  const inputs = [
    { timestamp: 100, queryText: 'line query', kind: 'line', status: 'succeeded' },
    { timestamp: 300, queryText: 'selection query', kind: 'selection', status: 'failed' },
    { timestamp: 200, queryText: 'script query', kind: 'script', status: 'canceled' },
  ].map(item => ({
    connectionId: 'kx-history',
    connectionName: 'History q',
    durationMs: 5,
    ...item,
    result: ['must not persist'],
    password: 'must not persist',
  }));
  await Promise.all(inputs.map(input => store.record(input, generation)));
  assert.deepStrictEqual(
    store.entries().map(entry => entry.queryText),
    ['selection query', 'script query', 'line query'],
    'serialized concurrent writes must retain every issued execution newest-first'
  );
  assert.strictEqual(memento.updates.length, 3);
  assertHistoryStorageShape(memento.value);
  assert.ok(!JSON.stringify(memento.value).includes('must not persist'));

  configuredLimit = 2;
  assert.deepStrictEqual((await store.prune()).map(entry => entry.queryText), ['selection query', 'script query']);
  const deletedId = store.entries()[0].id;
  assert.strictEqual(await store.delete('missing-id'), false);
  assert.strictEqual(await store.delete(deletedId), true);
  assert.strictEqual(store.entries().some(entry => entry.id === deletedId), false);
  assert.strictEqual(await store.delete(deletedId), false);
  configuredLimit = 1;
  assert.strictEqual((await store.prune()).length, 1);

  const invalidGeneration = store.captureGeneration();
  store.invalidatePending();
  const writesBeforeInvalidRecord = memento.updates.length;
  assert.strictEqual(await store.record(inputs[0], invalidGeneration), undefined);
  assert.strictEqual(memento.updates.length, writesBeforeInvalidRecord);
  await assert.rejects(
    () => store.record({ ...inputs[0], queryText: '' }, store.captureGeneration()),
    /invalid KX query history entry/
  );

  const beforeRaceEntry = historyEntry({ id: 'before-race', timestamp: 1, queryText: 'before race' });
  const delayedMemento = createBlockingHistoryMemento([beforeRaceEntry]);
  const delayedStore = new QueryHistoryStore(delayedMemento, {
    createId: (() => {
      let id = 0;
      return () => `delayed-${++id}`;
    })(),
  });
  const beforeClear = delayedStore.captureGeneration();
  const firstRecord = delayedStore.record({ ...inputs[0], timestamp: 10 }, beforeClear);
  await delayedMemento.updateStarted;
  const queuedStaleRecord = delayedStore.record({ ...inputs[1], timestamp: 20 }, beforeClear);
  const clearing = delayedStore.clear();
  delayedMemento.releaseUpdate();
  assert.strictEqual(await firstRecord, undefined, 'a write invalidated while pending must not return a live entry');
  assert.strictEqual(await queuedStaleRecord, undefined, 'a pre-clear token must not write after Clear');
  await clearing;
  assert.deepStrictEqual(delayedStore.entries(), []);
  assert.strictEqual(delayedMemento.value, undefined);
  assert.strictEqual(
    delayedMemento.updates.length,
    3,
    'the in-flight write must roll back its previous snapshot before the queued clear is committed'
  );
  assert.deepStrictEqual(delayedMemento.updates[1], [beforeRaceEntry]);
  assert.strictEqual(delayedMemento.updates[2], undefined);

  const staleAfterClear = delayedStore.record({ ...inputs[2], timestamp: 30 }, beforeClear);
  assert.strictEqual(await staleAfterClear, undefined);
  assert.strictEqual(delayedMemento.value, undefined);
  assert.strictEqual(QUERY_HISTORY_STORAGE_KEY, 'vscode-kdb.queryHistory.v1');
}

async function testTreeProviders() {
  const treeVscode = createVscodeTreeHarness();
  const {
    ServerCategoryTreeItem,
    ServerExplorerTreeProvider,
    ServerObjectTreeItem,
    ServerStatusTreeItem,
  } = requireOutWithMocks('server-explorer', { vscode: treeVscode.vscode });
  const {
    EmptyQueryHistoryTreeItem,
    QueryHistoryFeature,
    QueryHistoryTreeItem,
    QueryHistoryTreeProvider,
  } = requireOutWithMocks('query-history', { vscode: treeVscode.vscode });

  let active = validateConnection({
    id: 'kx-tree',
    name: 'Tree q',
    host: 'localhost',
    port: 5000,
    database: '.analytics',
    username: '',
  });
  let connected = false;
  let metaFailure;
  const managerCalls = [];
  const diagnostics = [];
  const variablesValue = modelQTable(['name', 'type'], [
    { name: 'answer', type: -7 },
    { name: 'calculate', type: 100 },
  ]);
  const columnsValue = modelQTable(['c', 't', 'f', 'a'], [
    { c: 'sym', t: 's', f: '', a: '' },
    { c: 'size', t: 'j', f: '', a: '' },
  ]);
  const store = {
    activeConnection: () => active,
  };
  const manager = {
    isConnected: id => !!active && connected && id === active.id,
    async executeInConfiguredNamespace(connection, query) {
      managerCalls.push({ connection: { ...connection }, query });
      if (query === SERVER_TABLES_QUERY) {
        return ['trade'];
      }
      if (query === SERVER_VARIABLES_QUERY) {
        return variablesValue;
      }
      if (query === buildServerTableMetaQuery('trade')) {
        if (metaFailure) {
          throw metaFailure;
        }
        return columnsValue;
      }
      throw new Error(`unexpected tree query ${query}`);
    },
  };
  const provider = new ServerExplorerTreeProvider(store, manager, {
    event: event => diagnostics.push(event),
  });

  assert.strictEqual(
    provider.hasAvailableConnection(),
    true,
    'a configured active profile keeps the opt-in view available even while disconnected'
  );
  let root = await provider.getChildren();
  assert.strictEqual(root.length, 1);
  assert.ok(root[0] instanceof ServerStatusTreeItem);
  assert.match(String(root[0].label), /active KX profile is disconnected/i);
  assert.deepStrictEqual(managerCalls, [], 'provider construction and initial tree reads must not query q');

  await provider.refresh();
  assert.deepStrictEqual(managerCalls, [], 'Refresh while disconnected must not issue metadata');
  assert.match(treeVscode.warnings.at(-1), /active connected direct q IPC profile/);

  connected = true;
  assert.strictEqual(provider.hasAvailableConnection(), true);
  await provider.refresh();
  assert.deepStrictEqual(
    managerCalls.map(call => call.query),
    [SERVER_TABLES_QUERY, SERVER_VARIABLES_QUERY]
  );
  assert.ok(managerCalls.every(call => call.connection.database === '.analytics'));
  root = await provider.getChildren();
  assert.strictEqual(root.length, 2);
  assert.ok(root.every(item => item instanceof ServerCategoryTreeItem));
  assert.deepStrictEqual(root.map(item => [item.label, item.description]), [
    ['Tables', '1'],
    ['Variables & Functions', '2'],
  ]);
  const tableCategory = root.find(item => item.category === 'tables');
  const variableCategory = root.find(item => item.category === 'variables');
  const tableItems = await provider.getChildren(tableCategory);
  const variableItems = await provider.getChildren(variableCategory);
  assert.strictEqual(tableItems.length, 1);
  assert.strictEqual(tableItems[0].objectName, 'trade');
  assert.deepStrictEqual(variableItems.map(item => [item.objectName, item.kind]), [
    ['answer', 'variable'],
    ['calculate', 'function'],
  ]);
  assert.deepStrictEqual(provider.resolveObject(tableItems[0]), tableItems[0]);
  assert.strictEqual(
    provider.resolveObject(new ServerObjectTreeItem(
      'trade',
      'table',
      tableItems[0].snapshot,
      true,
      tableItems[0].generation
    )),
    undefined,
    'commands must reject lookalike/unowned tree items'
  );
  assert.strictEqual(provider.resolveObject({ label: 'trade' }), undefined);

  const columns = await provider.getChildren(tableItems[0]);
  assert.deepStrictEqual(columns.map(item => item.column.name), ['sym', 'size']);
  assert.strictEqual(managerCalls.at(-1).query, '0!meta `trade');
  assert.ok(diagnostics.some(event =>
    event.phase === 'query' && event.status === 'success' && event.details.operation === 'meta'
  ));

  await provider.refresh();
  root = await provider.getChildren();
  assert.ok(root.every(item => item.generation > tableCategory.generation));
  const callsAfterSameProfileRefresh = managerCalls.length;
  const staleCategoryChildren = await provider.getChildren(tableCategory);
  assert.strictEqual(staleCategoryChildren.length, 1);
  assert.ok(staleCategoryChildren[0] instanceof ServerStatusTreeItem);
  assert.match(String(staleCategoryChildren[0].label), /metadata changed/i);
  assert.strictEqual(provider.resolveObject(tableItems[0]), undefined);
  const staleTableChildren = await provider.getChildren(tableItems[0]);
  assert.strictEqual(staleTableChildren.length, 1);
  assert.ok(staleTableChildren[0] instanceof ServerStatusTreeItem);
  assert.match(String(staleTableChildren[0].label), /metadata changed/i);
  assert.strictEqual(
    managerCalls.length,
    callsAfterSameProfileRefresh,
    'old category/object generations must never trigger same-profile metadata calls'
  );
  const refreshedTableCategory = root.find(item => item.category === 'tables');
  const refreshedTable = (await provider.getChildren(refreshedTableCategory))[0];
  metaFailure = new Error('missing/permission denied');
  const failedColumns = await provider.getChildren(refreshedTable);
  assert.strictEqual(failedColumns.length, 1);
  assert.ok(failedColumns[0] instanceof ServerStatusTreeItem);
  assert.match(String(failedColumns[0].label), /missing\/permission denied/);
  const callsAfterMetaFailure = managerCalls.length;
  await provider.getChildren(refreshedTable);
  assert.strictEqual(
    managerCalls.length,
    callsAfterMetaFailure + 1,
    'a failed meta lookup must remain retryable on the next expansion instead of crashing/staying stale'
  );
  metaFailure = undefined;
  await provider.refresh();
  root = await provider.getChildren();
  const retryTable = (await provider.getChildren(root.find(item => item.category === 'tables')))[0];
  assert.deepStrictEqual((await provider.getChildren(retryTable)).map(item => item.column.name), ['sym', 'size']);

  active = { ...active, database: '.other' };
  provider.connectionStateChanged();
  root = await provider.getChildren();
  assert.strictEqual(root.length, 1);
  assert.ok(root[0] instanceof ServerStatusTreeItem);
  assert.match(String(root[0].label), /Select Refresh Server Explorer/);
  active = { ...active, id: 'kx-tree-replaced' };
  provider.connectionStateChanged();
  assert.strictEqual((await provider.getChildren()).length, 1);
  connected = false;
  provider.connectionStateChanged();
  assert.strictEqual(provider.hasAvailableConnection(), true);
  assert.match(String((await provider.getChildren())[0].label), /disconnected/i);
  active = undefined;
  provider.connectionStateChanged();
  assert.strictEqual(provider.hasAvailableConnection(), false);
  provider.dispose();

  const staleTables = deferred();
  let staleActive = validateConnection({
    id: 'kx-stale',
    name: 'Stale q',
    host: 'localhost',
    port: 5001,
    database: '.analytics',
    username: '',
  });
  const staleProvider = new ServerExplorerTreeProvider(
    { activeConnection: () => staleActive },
    {
      isConnected: id => id === staleActive.id,
      async executeInConfiguredNamespace(_connection, query) {
        return query === SERVER_TABLES_QUERY ? staleTables.promise : variablesValue;
      },
    },
    { event() {} }
  );
  const staleRefresh = staleProvider.refresh();
  staleActive = { ...staleActive, database: '.changed' };
  staleProvider.connectionStateChanged();
  staleTables.resolve(['staleTable']);
  await staleRefresh;
  const staleRoot = await staleProvider.getChildren();
  assert.strictEqual(staleRoot.length, 1);
  assert.ok(staleRoot[0] instanceof ServerStatusTreeItem);
  assert.match(String(staleRoot[0].label), /Select Refresh Server Explorer/);
  staleProvider.dispose();

  const cancellationTables = deferred();
  const cancellationCalls = [];
  const cancellationConnection = validateConnection({
    id: 'kx-cancel-metadata',
    name: 'Cancelable q',
    host: 'localhost',
    port: 5002,
    database: '.analytics',
    username: '',
  });
  const cancellationProvider = new ServerExplorerTreeProvider(
    { activeConnection: () => cancellationConnection },
    {
      isConnected: id => id === cancellationConnection.id,
      async executeInConfiguredNamespace(_connection, query) {
        cancellationCalls.push(query);
        if (query === SERVER_TABLES_QUERY) {
          return cancellationTables.promise;
        }
        if (query === SERVER_VARIABLES_QUERY) {
          return variablesValue;
        }
        throw new Error(`unexpected cancellation query ${query}`);
      },
    },
    { event: event => diagnostics.push(event) }
  );
  const canceledRefresh = cancellationProvider.refresh();
  assert.deepStrictEqual(cancellationCalls, [SERVER_TABLES_QUERY]);
  treeVscode.cancelLatestProgress();
  await canceledRefresh;
  assert.deepStrictEqual(
    cancellationCalls,
    [SERVER_TABLES_QUERY],
    'canceling the lazy metadata chain must not enqueue the variables request'
  );
  assert.match(String((await cancellationProvider.getChildren())[0].label), /canceled locally/i);
  cancellationTables.resolve(['lateTable']);
  await Promise.resolve();
  assert.deepStrictEqual(cancellationCalls, [SERVER_TABLES_QUERY]);
  cancellationProvider.dispose();

  const timeoutTables = deferred();
  const timeoutCalls = [];
  const timeoutDiagnostics = [];
  let timeoutConnected = false;
  const timeoutConnection = validateConnection({
    id: 'kx-timeout-metadata',
    name: 'Timeout q',
    host: 'localhost',
    port: 5003,
    database: '.analytics',
    username: '',
  });
  const timeoutProvider = new ServerExplorerTreeProvider(
    { activeConnection: () => timeoutConnection },
    {
      isConnected: id => timeoutConnected && id === timeoutConnection.id,
      async executeInConfiguredNamespace(_connection, query) {
        timeoutCalls.push(query);
        if (query === SERVER_TABLES_QUERY) {
          return timeoutTables.promise;
        }
        throw new Error(`unexpected timeout query ${query}`);
      },
    },
    { event: event => timeoutDiagnostics.push(event) }
  );
  timeoutProvider.connectionStateChanged();
  assert.match(String((await timeoutProvider.getChildren())[0].label), /disconnected/i);
  timeoutConnected = true;
  timeoutProvider.connectionStateChanged();
  assert.match(
    String((await timeoutProvider.getChildren())[0].label),
    /Connected\. Select Refresh Server Explorer to load/i,
    'reconnecting an idle explorer must present an explicit manual Refresh state'
  );

  const timedOutRefresh = timeoutProvider.refresh();
  assert.deepStrictEqual(timeoutCalls, [SERVER_TABLES_QUERY]);
  timeoutConnected = false;
  timeoutProvider.connectionStateChanged();
  timeoutTables.reject(new Error('timed out after 25 ms'));
  await timedOutRefresh;
  let timeoutRoot = await timeoutProvider.getChildren();
  assert.strictEqual(timeoutRoot.length, 1);
  assert.match(timeoutRoot[0].contextValue, /status\.error$/);
  assert.match(String(timeoutRoot[0].label), /Server Explorer refresh failed/i);
  assert.match(String(timeoutRoot[0].label), /timed out after 25 ms/i);
  assert.match(String(timeoutRoot[0].label), /active KX profile is disconnected/i);
  assert.match(String(timeoutRoot[0].label), /reconnect it before retrying/i);
  const timeoutRefreshDiagnostics = timeoutDiagnostics.filter(event =>
    event.details?.operation === 'refresh'
  );
  assert.deepStrictEqual(
    timeoutRefreshDiagnostics.map(event => event.status),
    ['start', 'failed'],
    'a transport timeout racing disconnect is a failed refresh, not a canceled/stale result'
  );

  timeoutConnected = true;
  timeoutProvider.connectionStateChanged();
  timeoutRoot = await timeoutProvider.getChildren();
  assert.match(String(timeoutRoot[0].label), /Server Explorer refresh failed/i);
  assert.match(String(timeoutRoot[0].label), /timed out after 25 ms/i);
  assert.match(String(timeoutRoot[0].label), /Connected\. Select Refresh Server Explorer to retry/i);
  assert.doesNotMatch(String(timeoutRoot[0].label), /is disconnected|reconnect it/i);
  timeoutConnected = false;
  timeoutProvider.connectionStateChanged();
  timeoutRoot = await timeoutProvider.getChildren();
  assert.match(String(timeoutRoot[0].label), /Server Explorer refresh failed/i);
  assert.match(String(timeoutRoot[0].label), /timed out after 25 ms/i);
  assert.match(String(timeoutRoot[0].label), /active KX profile is disconnected/i);
  assert.match(String(timeoutRoot[0].label), /reconnect it before retrying/i);
  assert.doesNotMatch(
    String(timeoutRoot[0].label),
    /Connected\. Select Refresh/,
    'disconnecting again must replace connected retry guidance instead of retaining contradictory states'
  );
  timeoutProvider.dispose();

  const historyMemento = createHistoryMemento([
    historyEntry({
      id: 'removed',
      connectionId: 'kx-removed',
      connectionName: 'Removed q',
      timestamp: 300,
      queryText: '[command](command:evil)',
    }),
    historyEntry({
      id: 'renamed',
      connectionId: 'kx-renamed',
      connectionName: 'Old q name',
      timestamp: 200,
      queryText: 'select from trade',
    }),
  ]);
  const historyStore = new QueryHistoryStore(historyMemento);
  const historyProvider = new QueryHistoryTreeProvider(historyStore, {
    connection(id) {
      return id === 'kx-renamed'
        ? { id, name: 'Current q name', database: '.analytics' }
        : undefined;
    },
  });
  const historyItems = historyProvider.getChildren();
  assert.deepStrictEqual(historyItems.map(item => item.entry.id), ['removed', 'renamed']);
  assert.ok(historyItems.every(item => item instanceof QueryHistoryTreeItem));
  assert.match(historyItems[0].description, /Removed q \(profile removed\)/);
  assert.match(historyItems[1].description, /Current q name \(recorded as Old q name\)/);
  assert.strictEqual(typeof historyItems[0].tooltip, 'string', 'sensitive query tooltips must remain untrusted plain text');
  assert.match(historyItems[0].tooltip, /\[command\]\(command:evil\)/);
  assert.deepStrictEqual(historyProvider.resolveEntry(historyItems[1]).id, 'renamed');
  assert.strictEqual(
    historyProvider.resolveEntry(new QueryHistoryTreeItem(historyItems[1].entry, 'Current q name')),
    undefined,
    'history commands must reject lookalike/unowned items'
  );
  assert.strictEqual(historyProvider.resolveEntry({ entry: historyItems[1].entry }), undefined);
  await historyStore.delete('renamed');
  assert.strictEqual(historyProvider.resolveEntry(historyItems[1]), undefined, 'deleted owned items must resolve stale-safe');
  historyProvider.dispose();

  const labelEntry = historyEntry({
    id: 'live-label',
    connectionId: 'kx-live-label',
    connectionName: 'Recorded label',
    timestamp: 400,
    queryText: 'show label',
  });
  const labelStore = new QueryHistoryStore(createHistoryMemento([labelEntry]));
  let currentLabel = 'First current label';
  const connectionTreeChanges = new treeVscode.vscode.EventEmitter();
  const historyFeature = new QueryHistoryFeature(
    labelStore,
    {
      connection(id) {
        return id === 'kx-live-label'
          ? { id, name: currentLabel, database: '.analytics' }
          : undefined;
      },
    },
    { onDidChangeTreeData: connectionTreeChanges.event },
    async () => undefined
  );
  const historyTreeView = treeVscode.createdTreeViews.find(view => view.id === 'vscode-kdb.queryHistory');
  assert.ok(historyTreeView, 'QueryHistoryFeature must register its tree view');
  const featureProvider = historyTreeView.options.treeDataProvider;
  assert.match(featureProvider.getChildren()[0].description, /First current label/);
  let labelRefreshes = 0;
  featureProvider.onDidChangeTreeData(() => labelRefreshes++);
  const refreshesBeforeRename = labelRefreshes;
  currentLabel = 'Renamed current label';
  connectionTreeChanges.fire(undefined);
  assert.strictEqual(
    labelRefreshes,
    refreshesBeforeRename + 1,
    'connection tree changes must invalidate rendered Query History labels'
  );
  assert.match(featureProvider.getChildren()[0].description, /Renamed current label/);
  historyFeature.dispose();
  const refreshesAfterDispose = labelRefreshes;
  connectionTreeChanges.fire(undefined);
  assert.strictEqual(labelRefreshes, refreshesAfterDispose, 'disposed history features must release label listeners');

  const emptyProvider = new QueryHistoryTreeProvider(
    new QueryHistoryStore(createHistoryMemento()),
    { connection: () => undefined }
  );
  const emptyItems = emptyProvider.getChildren();
  assert.strictEqual(emptyItems.length, 1);
  assert.ok(emptyItems[0] instanceof EmptyQueryHistoryTreeItem);
  emptyProvider.dispose();
}

async function testFeatureControlsLifecycle() {
  const settings = {
    'vscode-kdb.features.serverExplorer': false,
    'vscode-kdb.features.queryHistory': false,
    'vscode-kdb.queryHistory.maxEntries': 100,
  };
  const contextCommands = [];
  const serverInstances = [];
  const historyInstances = [];
  class FakeServerExplorerFeature {
    constructor(...args) {
      this.args = args;
      this.disposed = false;
      serverInstances.push(this);
    }

    dispose() {
      this.disposed = true;
    }
  }
  class FakeQueryHistoryFeature {
    constructor(...args) {
      this.args = args;
      this.disposed = false;
      this.pruneCalls = 0;
      historyInstances.push(this);
    }

    capture() {
      return { feature: this, generation: 0 };
    }

    async record() {}

    async prune() {
      this.pruneCalls++;
    }

    dispose() {
      this.disposed = true;
    }
  }
  const fakeVscode = {
    workspace: {
      getConfiguration(section) {
        return {
          get(key, fallback) {
            const fullKey = `${section}.${key}`;
            return Object.prototype.hasOwnProperty.call(settings, fullKey) ? settings[fullKey] : fallback;
          },
        };
      },
    },
    commands: {
      async executeCommand(...args) {
        contextCommands.push(args);
      },
    },
    window: {
      showWarningMessage() {},
    },
  };
  const { FeatureControls } = requireOutWithMocks('feature-controls', {
    vscode: fakeVscode,
    './server-explorer': {
      SERVER_EXPLORER_AVAILABLE_CONTEXT: 'vscode-kdb.serverExplorer.available',
      ServerExplorerFeature: FakeServerExplorerFeature,
    },
    './query-history': {
      QueryHistoryFeature: FakeQueryHistoryFeature,
    },
  });
  const workspaceState = createHistoryMemento();
  const featureConnectionTree = { onDidChangeTreeData() { return { dispose() {} }; } };
  const controls = new FeatureControls(
    { workspaceState },
    { connection: () => undefined },
    {},
    featureConnectionTree,
    {},
    async () => undefined,
    async () => undefined
  );
  assert.strictEqual(serverInstances.length, 0, 'disabled Server Explorer must not register its view/commands');
  assert.strictEqual(historyInstances.length, 0, 'disabled Query History must not register its view/commands');
  assert.ok(contextCommands.some(args =>
    args[0] === 'setContext' && args[1] === 'vscode-kdb.serverExplorer.available' && args[2] === false
  ));

  settings['vscode-kdb.features.serverExplorer'] = true;
  controls.configurationChanged(configurationEvent('vscode-kdb.features.serverExplorer'));
  assert.strictEqual(serverInstances.length, 1);
  assert.strictEqual(serverInstances[0].args[2], featureConnectionTree);
  controls.configurationChanged(configurationEvent('unrelated.setting'));
  assert.strictEqual(serverInstances.length, 1, 'unrelated changes must not duplicate feature registrations');
  settings['vscode-kdb.features.serverExplorer'] = false;
  controls.configurationChanged(configurationEvent('vscode-kdb.features.serverExplorer'));
  assert.strictEqual(serverInstances[0].disposed, true);

  settings['vscode-kdb.features.queryHistory'] = true;
  controls.configurationChanged(configurationEvent('vscode-kdb.features.queryHistory'));
  assert.strictEqual(historyInstances.length, 1);
  assert.strictEqual(
    historyInstances[0].args[2],
    featureConnectionTree,
    'Query History must observe connection tree changes so stored labels rerender after rename/removal'
  );
  const sharedHistoryStore = historyInstances[0].args[0];
  controls.configurationChanged(configurationEvent('vscode-kdb.queryHistory.maxEntries'));
  await Promise.resolve();
  assert.strictEqual(historyInstances[0].pruneCalls, 1);
  settings['vscode-kdb.features.queryHistory'] = false;
  controls.configurationChanged(configurationEvent('vscode-kdb.features.queryHistory'));
  assert.strictEqual(historyInstances[0].disposed, true);
  settings['vscode-kdb.features.queryHistory'] = true;
  controls.configurationChanged(configurationEvent('vscode-kdb.features.queryHistory'));
  assert.strictEqual(historyInstances.length, 2);
  assert.strictEqual(historyInstances[1].args[0], sharedHistoryStore, 'toggle cycles must reuse local history storage safely');

  controls.dispose();
  assert.strictEqual(historyInstances[1].disposed, true);
  settings['vscode-kdb.features.serverExplorer'] = true;
  controls.configurationChanged(configurationEvent('vscode-kdb.features.serverExplorer'));
  assert.strictEqual(serverInstances.length, 1, 'disposed controls must never register features again');
}

function testConnectionFormModel() {
  const saved = validateConnection({
    id: 'kx-saved',
    name: 'Saved q',
    host: 'saved.example.test',
    port: 5000,
    database: '.',
    username: 'saved-user',
    connectTimeoutMs: 2000,
  });
  const formSecret = ['form', 'secret', 'value'].join('-');
  const addOptions = {
    id: 'kx-new',
    existingConnections: [saved],
    hasStoredPassword: false,
  };
  const payload = {
    name: ' New direct q ',
    host: ' [::1] ',
    port: '6000',
    database: 'analytics.market',
    username: 'new-user',
    password: formSecret,
    clearPassword: false,
    connectTimeoutMs: '',
    queryTimeoutMs: '0',
  };
  const parsed = parseConnectionFormPayload(payload, addOptions);
  assert.deepStrictEqual(parsed.connection, {
    id: 'kx-new',
    name: 'New direct q',
    host: '::1',
    port: 6000,
    database: '.analytics.market',
    username: 'new-user',
    queryTimeoutMs: 0,
  });
  assert.strictEqual(parsed.passwordUpdate, formSecret);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(parsed.connection, 'password'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(parsed.connection, 'clearPassword'), false);
  assert.ok(!JSON.stringify(parsed.connection).includes(formSecret), 'form secrets must not enter the safe connection model');

  const inherited = parseConnectionFormPayload({
    ...payload,
    name: 'Inherited timeouts',
    password: '',
    connectTimeoutMs: '   ',
    queryTimeoutMs: '',
  }, { ...addOptions, id: 'kx-inherited' });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(inherited.connection, 'connectTimeoutMs'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(inherited.connection, 'queryTimeoutMs'), false);
  assert.strictEqual(inherited.passwordUpdate, undefined);

  const explicitBounds = parseConnectionFormPayload({
    ...payload,
    name: 'Timeout boundaries',
    password: '',
    connectTimeoutMs: '0',
    queryTimeoutMs: String(MAX_TIMEOUT_MS),
  }, { ...addOptions, id: 'kx-bounds' });
  assert.strictEqual(explicitBounds.connection.connectTimeoutMs, 0);
  assert.strictEqual(explicitBounds.connection.queryTimeoutMs, MAX_TIMEOUT_MS);

  const expectFormError = (candidate, options, field, pattern) => {
    assert.throws(
      () => parseConnectionFormPayload(candidate, options),
      error => error instanceof ConnectionFormValidationError &&
        error.field === field &&
        pattern.test(error.message),
      `expected ${String(field)} form error ${pattern}`
    );
  };
  expectFormError({ ...payload, name: 'saved Q' }, addOptions, 'name', /already exists/i);
  expectFormError({ ...payload, host: 'https://q.example.test' }, addOptions, 'host', /without a URL/i);
  expectFormError({ ...payload, port: '1.5' }, addOptions, 'port', /integer from 1 to 65535/i);
  expectFormError({ ...payload, database: '.bad-name' }, addOptions, 'database', /namespace/i);
  expectFormError({ ...payload, username: 'bad:user' }, addOptions, 'username', /cannot contain colons/i);
  expectFormError({ ...payload, connectTimeoutMs: '-1' }, addOptions, 'connectTimeoutMs', /whole number/i);
  expectFormError(
    { ...payload, queryTimeoutMs: String(MAX_TIMEOUT_MS + 1) },
    addOptions,
    'queryTimeoutMs',
    /whole number/i
  );
  expectFormError({ ...payload, clearPassword: 'false' }, addOptions, 'password', /true or false/i);
  expectFormError({ ...payload, password: 'bad\0secret' }, addOptions, 'password', /null characters/i);
  expectFormError({ ...payload, password: 'x'.repeat(65536) }, addOptions, 'password', /65535 characters/i);
  assert.throws(
    () => parseConnectionFormPayload({ ...payload, unsupported: true }, addOptions),
    error => error instanceof ConnectionFormValidationError && /unsupported field/i.test(error.message)
  );
  assert.throws(
    () => parseConnectionFormPayload(null, addOptions),
    error => error instanceof ConnectionFormValidationError && /invalid/i.test(error.message)
  );

  const editOptions = {
    id: saved.id,
    existingConnections: [saved],
    editing: saved,
    hasStoredPassword: true,
  };
  const editPayload = {
    name: saved.name,
    host: saved.host,
    port: String(saved.port),
    database: saved.database,
    username: saved.username,
    password: '',
    clearPassword: false,
    connectTimeoutMs: String(saved.connectTimeoutMs),
    queryTimeoutMs: '',
  };
  assert.strictEqual(parseConnectionFormPayload(editPayload, editOptions).passwordUpdate, undefined);
  assert.strictEqual(
    parseConnectionFormPayload({ ...editPayload, password: formSecret }, editOptions).passwordUpdate,
    formSecret
  );
  assert.strictEqual(
    parseConnectionFormPayload({ ...editPayload, clearPassword: true }, editOptions).passwordUpdate,
    null
  );
  expectFormError(
    { ...editPayload, password: formSecret, clearPassword: true },
    editOptions,
    'password',
    /not both/i
  );
  expectFormError(
    { ...editPayload, clearPassword: true },
    { ...editOptions, hasStoredPassword: false },
    'password',
    /no saved password/i
  );

  assert.strictEqual(passwordUpdateForForm('add', '', false, false), undefined);
  assert.strictEqual(passwordUpdateForForm('add', formSecret, false, false), formSecret);
  assert.strictEqual(passwordUpdateForForm('edit', '', false, true), undefined, 'blank edit keeps the secret');
  assert.strictEqual(passwordUpdateForForm('edit', formSecret, false, true), formSecret);
  assert.strictEqual(passwordUpdateForForm('edit', '', true, true), null, 'clear is explicit');
  assert.throws(() => passwordUpdateForForm('add', '', true, false), /no saved password/i);
  assert.throws(() => passwordUpdateForForm('edit', '', true, false), /no saved password/i);

  const namespaceProbe = connectionTestNamespaceQuery('.analytics.market');
  assert.strictEqual(
    namespaceProbe,
    '(string system"d";99h=type value `.analytics.market;string system"d")'
  );
  assert.ok(!namespaceProbe.includes('{'), 'connection testing must not inject a server-side lambda');
  assert.ok(!/system\s*"d\s+/.test(namespaceProbe), 'the namespace probe must never change the q session namespace');
  assert.strictEqual(connectionTestNamespaceResultIsSafe(['.', true, '.']), true);
  assert.strictEqual(connectionTestNamespaceResultIsSafe(['.', false, '.']), false);
  assert.strictEqual(connectionTestNamespaceResultIsSafe(['.', true, '.changed']), false);
  assert.strictEqual(connectionTestNamespaceResultIsSafe(['.', true]), false);
  assert.throws(() => connectionTestNamespaceQuery('.bad-name'), /namespace/i);
  assert.throws(() => connectionTestNamespaceQuery('.'), /does not require/i);
  assert.strictEqual(CONNECTION_TEST_QUERY, '0b', 'the standalone query probe must be a read-only literal');
}

async function testConnectionFormPanelLifecycle() {
  const panelHarness = createVscodePanelHarness();
  const {
    ConnectionFormPanel,
    initialConnectionFormValues,
  } = requireOutWithVscode('connection-form-panel', panelHarness.vscode);
  const connection = validateConnection({
    id: 'kx-panel',
    name: 'Panel q',
    host: 'panel.example.test',
    port: 5000,
    database: '.analytics',
    username: 'runner',
    connectTimeoutMs: 0,
    queryTimeoutMs: 4500,
  });
  const initial = initialConnectionFormValues(
    'edit',
    connection,
    30000,
    15000,
    true,
    ['Reserved q']
  );
  assert.strictEqual(Object.prototype.hasOwnProperty.call(initial, 'password'), false);
  assert.deepStrictEqual(initial, {
    mode: 'edit',
    name: 'Panel q',
    host: 'panel.example.test',
    port: 5000,
    database: '.analytics',
    username: 'runner',
    connectTimeoutMs: 0,
    queryTimeoutMs: 4500,
    globalConnectTimeoutMs: 30000,
    globalQueryTimeoutMs: 15000,
    hasStoredPassword: true,
    reservedNames: ['Reserved q'],
  });

  const submitted = [];
  let rejectFirstSave = true;
  const formPanel = new ConnectionFormPanel(initial, {
    async onSave(payload) {
      submitted.push(payload);
      if (rejectFirstSave) {
        rejectFirstSave = false;
        throw new ConnectionFormValidationError('Injected invalid connection name.', 'name');
      }
    },
  });
  assert.deepStrictEqual(panelHarness.created, {
    viewType: 'vscodeKdbConnection',
    title: 'KX Connection',
    column: 'active',
    options: { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
  });
  assert.ok(panelHarness.panel.webview.html.includes('<title>KX Connection</title>'));
  const session = formPanel.session;
  assert.match(session, /^[a-f0-9]{48}$/);

  await formPanel.onMessage({ type: 'ready', session: 'stale-session' });
  assert.deepStrictEqual(panelHarness.posted, [], 'messages from another panel session must be ignored');
  await formPanel.onMessage({ type: 'ready', session });
  const initialization = panelHarness.posted.find(message => message.type === 'initialize');
  assert.strictEqual(initialization.type, 'initialize');
  assert.strictEqual(initialization.maxTimeoutMs, MAX_TIMEOUT_MS);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(initialization.values, 'password'), false);
  assert.deepStrictEqual(
    panelHarness.posted.at(-1),
    { type: 'busy', busy: false },
    'a reloaded renderer must receive the current host busy state'
  );

  const rejectedPayload = { sentinel: 'invalid payload stays local until extension validation' };
  await formPanel.onMessage({ type: 'save', session, payload: rejectedPayload });
  assert.strictEqual(panelHarness.panel.disposed, false, 'validation failure must keep the form available');
  assert.strictEqual(submitted[0], rejectedPayload);
  const postedError = panelHarness.posted.find(message => message.type === 'error');
  assert.deepStrictEqual(postedError, {
    type: 'error',
    field: 'name',
    message: 'Injected invalid connection name.',
  });

  const acceptedPayload = { sentinel: 'accepted' };
  const savedCompletion = formPanel.waitForCompletion();
  await formPanel.onMessage({ type: 'save', session, payload: acceptedPayload });
  assert.strictEqual(submitted[1], acceptedPayload);
  assert.strictEqual(panelHarness.panel.disposed, true);
  assert.strictEqual(await savedCompletion, 'saved');
  await formPanel.onMessage({ type: 'save', session, payload: { sentinel: 'stale-after-dispose' } });
  assert.strictEqual(submitted.length, 2, 'disposed panels must ignore delayed webview messages');

  const deleteHarness = createVscodePanelHarness();
  const { ConnectionFormPanel: DeleteFormPanel } = requireOutWithVscode('connection-form-panel', deleteHarness.vscode);
  let deleteAllowed = false;
  let deleteAttempts = 0;
  const deletePanel = new DeleteFormPanel(initial, {
    async onSave() {},
    async onDelete() {
      deleteAttempts++;
      return deleteAllowed;
    },
  });
  await deletePanel.onMessage({ type: 'delete', session: deletePanel.session });
  assert.strictEqual(deleteAttempts, 1);
  assert.strictEqual(deleteHarness.panel.disposed, false, 'declined extension-host confirmation keeps the form');
  deleteAllowed = true;
  const deletedCompletion = deletePanel.waitForCompletion();
  await deletePanel.onMessage({ type: 'delete', session: deletePanel.session });
  assert.strictEqual(deleteAttempts, 2);
  assert.strictEqual(deleteHarness.panel.disposed, true);
  assert.strictEqual(await deletedCompletion, 'deleted');

  const cancelHarness = createVscodePanelHarness();
  const { ConnectionFormPanel: CancelFormPanel } = requireOutWithVscode('connection-form-panel', cancelHarness.vscode);
  const cancelPanel = new CancelFormPanel({ ...initial, mode: 'add', hasStoredPassword: false }, {
    async onSave() {
      throw new Error('cancel must not save');
    },
  });
  const cancelledCompletion = cancelPanel.waitForCompletion();
  await cancelPanel.onMessage({ type: 'cancel', session: cancelPanel.session });
  assert.strictEqual(cancelHarness.panel.disposed, true);
  assert.strictEqual(await cancelledCompletion, 'cancelled');

  const closeHarness = createVscodePanelHarness();
  const { ConnectionFormPanel: ClosedFormPanel } = requireOutWithVscode('connection-form-panel', closeHarness.vscode);
  const closedPanel = new ClosedFormPanel(initial, { async onSave() {} });
  const closedCompletion = closedPanel.waitForCompletion();
  closeHarness.panel.dispose();
  assert.strictEqual(await closedCompletion, 'cancelled', 'closing the tab must release command callers');

  const testHarness = createVscodePanelHarness();
  const { ConnectionFormPanel: TestFormPanel } = requireOutWithVscode('connection-form-panel', testHarness.vscode);
  const testAttempts = [];
  const panelSecret = ['panel', 'test', 'secret'].join('-');
  const testPanel = new TestFormPanel(initial, {
    async onSave() {},
    onTest(payload, signal, onProgress) {
      const pending = deferred();
      const attempt = { payload, signal, pending };
      testAttempts.push(attempt);
      onProgress({
        phase: 'connect',
        endpoint: 'unsaved.example.test:6100',
        usedSavedPassword: true,
      });
      return pending.promise;
    },
  });
  const testPayload = { password: panelSecret, sentinel: 'current-unsaved-values' };
  const firstRun = testPanel.onMessage({ type: 'test', session: testPanel.session, payload: testPayload });
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(testAttempts.length, 1);
  const firstTestId = testHarness.posted.find(message => message.type === 'testStatus').testId;

  const secondRun = testPanel.onMessage({ type: 'test', session: testPanel.session, payload: testPayload });
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(testAttempts.length, 2);
  assert.strictEqual(testAttempts[0].signal.aborted, true, 'a new test must cancel the previous temporary test');
  const secondRunning = testHarness.posted.filter(message =>
    message.type === 'testStatus' && message.state === 'running'
  ).at(-1);
  assert.ok(secondRunning.testId > firstTestId);
  await testPanel.onMessage({
    type: 'cancelTest',
    session: testPanel.session,
    testId: firstTestId,
  });
  assert.strictEqual(testAttempts[1].signal.aborted, false, 'a stale cancel message must not cancel the replacement test');
  testAttempts[1].pending.resolve({
    endpoint: 'unsaved.example.test:6100',
    connectTimeoutMs: 1250,
    queryTimeoutMs: 2500,
    namespaceTested: true,
    usedSavedPassword: true,
  });
  await secondRun;
  testAttempts[0].pending.resolve({
    endpoint: 'stale.example.test:1',
    connectTimeoutMs: 1,
    queryTimeoutMs: 1,
    namespaceTested: false,
    usedSavedPassword: false,
  });
  await firstRun;
  const successfulStatuses = testHarness.posted.filter(message =>
    message.type === 'testStatus' && message.state === 'success'
  );
  assert.strictEqual(successfulStatuses.length, 1, 'a superseded test must not overwrite current status');
  assert.strictEqual(successfulStatuses[0].testId, secondRunning.testId);
  assert.match(successfulStatuses[0].message, /saved password from VS Code SecretStorage was used/i);
  assert.ok(!JSON.stringify(testHarness.posted).includes(panelSecret), 'the extension must never reflect a form password');
  assert.ok(!JSON.stringify(testHarness.posted).includes('stale.example.test'), 'stale completions must not post diagnostics');

  const explicitCancelRun = testPanel.onMessage({
    type: 'test',
    session: testPanel.session,
    payload: testPayload,
  });
  await new Promise(resolve => setImmediate(resolve));
  const cancelAttempt = testAttempts.at(-1);
  const cancelTestId = testHarness.posted.filter(message =>
    message.type === 'testStatus' && message.state === 'running'
  ).at(-1).testId;
  await testPanel.onMessage({
    type: 'cancelTest',
    session: testPanel.session,
    testId: cancelTestId,
  });
  assert.strictEqual(cancelAttempt.signal.aborted, true);
  assert.match(testHarness.posted.at(-1).message, /^Cancel phase:/);
  cancelAttempt.pending.reject(new ConnectionTestError('cancel', 'unsaved.example.test:6100'));
  await explicitCancelRun;

  const validationHarness = createVscodePanelHarness();
  const { ConnectionFormPanel: ValidationFormPanel } = requireOutWithVscode(
    'connection-form-panel',
    validationHarness.vscode
  );
  const validationPanel = new ValidationFormPanel(initial, {
    async onSave() {},
    async onTest() {
      throw new ConnectionFormValidationError('Port must be an integer from 1 to 65535.', 'port');
    },
  });
  await validationPanel.onMessage({ type: 'test', session: validationPanel.session, payload: {} });
  assert.deepStrictEqual(
    validationHarness.posted.find(message => message.type === 'error'),
    { type: 'error', field: 'port', message: 'Port must be an integer from 1 to 65535.' }
  );
  assert.deepStrictEqual(
    validationHarness.posted.filter(message => message.type === 'testStatus').at(-1).phase,
    'validation'
  );

  const saveTestHarness = createVscodePanelHarness();
  const { ConnectionFormPanel: SaveTestFormPanel } = requireOutWithVscode(
    'connection-form-panel',
    saveTestHarness.vscode
  );
  const pendingSaveTest = deferred();
  let saveTestSignal;
  const savePayloads = [];
  const saveTestPanel = new SaveTestFormPanel(initial, {
    async onSave(payload) {
      savePayloads.push(payload);
    },
    async onTest(_payload, signal) {
      saveTestSignal = signal;
      return pendingSaveTest.promise;
    },
  });
  const pendingRun = saveTestPanel.onMessage({ type: 'test', session: saveTestPanel.session, payload: testPayload });
  await new Promise(resolve => setImmediate(resolve));
  const saveCompletion = saveTestPanel.waitForCompletion();
  await saveTestPanel.onMessage({ type: 'save', session: saveTestPanel.session, payload: { save: true } });
  assert.strictEqual(saveTestSignal.aborted, true, 'Save must cancel the temporary test before persisting');
  assert.deepStrictEqual(savePayloads, [{ save: true }]);
  assert.strictEqual(await saveCompletion, 'saved');
  pendingSaveTest.reject(new ConnectionTestError('cancel', 'unsaved.example.test:6100'));
  await pendingRun;

  const closeTestHarness = createVscodePanelHarness();
  const { ConnectionFormPanel: CloseTestFormPanel } = requireOutWithVscode(
    'connection-form-panel',
    closeTestHarness.vscode
  );
  const pendingCloseTest = deferred();
  let closeTestSignal;
  const closeTestPanel = new CloseTestFormPanel(initial, {
    async onSave() {},
    async onTest(_payload, signal) {
      closeTestSignal = signal;
      return pendingCloseTest.promise;
    },
  });
  const closeRun = closeTestPanel.onMessage({ type: 'test', session: closeTestPanel.session, payload: {} });
  await new Promise(resolve => setImmediate(resolve));
  const closeTestCompletion = closeTestPanel.waitForCompletion();
  closeTestHarness.panel.dispose();
  assert.strictEqual(closeTestSignal.aborted, true, 'closing the form must cancel its temporary transport');
  assert.strictEqual(await closeTestCompletion, 'cancelled');
  pendingCloseTest.reject(new ConnectionTestError('cancel', 'panel.example.test:5000'));
  await closeRun;
}

async function testConnectionFormHostTesting() {
  const vscodeHarness = createVscodeTreeHarness();
  const { ConnectionCommands } = requireOutWithVscode('connection-commands', vscodeHarness.vscode);
  const savedSecret = ['saved', 'host', 'secret'].join('-');
  const enteredSecret = ['entered', 'host', 'secret'].join('-');
  const editing = validateConnection({
    id: 'kx-host-test',
    name: 'Saved profile',
    host: 'saved.example.test',
    port: 5000,
    database: '.',
    username: 'saved-user',
  });
  let passwordReads = 0;
  const forbiddenMutations = [];
  const store = {
    connections: () => [editing],
    async password(id) {
      passwordReads++;
      assert.strictEqual(id, editing.id);
      return savedSecret;
    },
    async add() { forbiddenMutations.push('add'); },
    async update() { forbiddenMutations.push('update'); },
    async remove() { forbiddenMutations.push('remove'); },
    async setActiveConnection() { forbiddenMutations.push('setActive'); },
  };
  const temporaryTests = [];
  const manager = {
    async testTemporary(connection, options) {
      temporaryTests.push({ connection, options });
      options.onPhase('connect');
      options.onPhase('handshake');
      options.onPhase('namespace');
      options.onPhase('query');
      return { connectTimeoutMs: 0, queryTimeoutMs: 9876 };
    },
    connect() { throw new Error('form testing must not touch an active saved connection'); },
    disconnect() { throw new Error('form testing must not touch an active saved connection'); },
  };
  let treeRefreshes = 0;
  const commands = new ConnectionCommands(store, manager, { refresh: () => treeRefreshes++ });
  const payload = {
    name: ' Unsaved profile ',
    host: 'unsaved.example.test',
    port: '6100',
    database: 'analytics',
    username: 'unsaved-user',
    password: '',
    clearPassword: false,
    connectTimeoutMs: '0',
    queryTimeoutMs: '9876',
  };
  const progress = [];
  const controller = new AbortController();
  const result = await commands.testConnectionForm(
    payload,
    editing.id,
    editing,
    true,
    controller.signal,
    value => progress.push(value)
  );
  assert.deepStrictEqual(temporaryTests[0].connection, {
    id: editing.id,
    name: 'Unsaved profile',
    host: 'unsaved.example.test',
    port: 6100,
    database: '.analytics',
    username: 'unsaved-user',
    connectTimeoutMs: 0,
    queryTimeoutMs: 9876,
  });
  assert.strictEqual(temporaryTests[0].options.password, savedSecret);
  assert.strictEqual(temporaryTests[0].options.signal, controller.signal);
  assert.deepStrictEqual(progress.map(item => item.phase), ['connect', 'handshake', 'namespace', 'query']);
  assert.ok(progress.every(item => item.usedSavedPassword === true));
  assert.deepStrictEqual(result, {
    endpoint: 'unsaved.example.test:6100',
    connectTimeoutMs: 0,
    queryTimeoutMs: 9876,
    namespaceTested: true,
    usedSavedPassword: true,
  });
  assert.strictEqual(passwordReads, 1);
  assert.deepStrictEqual(forbiddenMutations, []);
  assert.strictEqual(treeRefreshes, 0);
  assert.ok(!JSON.stringify(result).includes(savedSecret), 'saved secrets must not be returned to the renderer');

  await commands.testConnectionForm(
    { ...payload, password: enteredSecret },
    editing.id,
    editing,
    true,
    new AbortController().signal,
    () => undefined
  );
  assert.strictEqual(temporaryTests.at(-1).options.password, enteredSecret);
  assert.strictEqual(passwordReads, 1, 'an entered password must not read or combine with the saved secret');

  await commands.testConnectionForm(
    { ...payload, clearPassword: true },
    editing.id,
    editing,
    true,
    new AbortController().signal,
    () => undefined
  );
  assert.strictEqual(temporaryTests.at(-1).options.password, undefined);
  assert.strictEqual(passwordReads, 1, 'explicit Clear must not fetch the saved secret for testing');

  const testsBeforeValidation = temporaryTests.length;
  await assert.rejects(
    () => commands.testConnectionForm(
      { ...payload, port: 'not-a-port' },
      editing.id,
      editing,
      true,
      new AbortController().signal,
      () => undefined
    ),
    error => error instanceof ConnectionFormValidationError && error.field === 'port'
  );
  assert.strictEqual(temporaryTests.length, testsBeforeValidation, 'validation failure must not open a socket');

  const canceled = new AbortController();
  canceled.abort();
  await assert.rejects(
    () => commands.testConnectionForm(
      payload,
      editing.id,
      editing,
      true,
      canceled.signal,
      () => undefined
    ),
    error => error instanceof ConnectionTestError && error.phase === 'cancel'
  );
  assert.strictEqual(temporaryTests.length, testsBeforeValidation);

  const secretFailureCommands = new ConnectionCommands({
    connections: () => [editing],
    async password() {
      throw new Error(`injected SecretStorage failure ${savedSecret}`);
    },
  }, manager, { refresh() {} });
  await assert.rejects(
    () => secretFailureCommands.testConnectionForm(
      payload,
      editing.id,
      editing,
      true,
      new AbortController().signal,
      () => undefined
    ),
    error => error instanceof ConnectionTestError &&
      error.phase === 'validation' &&
      !error.message.includes(savedSecret)
  );
  assert.deepStrictEqual(forbiddenMutations, []);
}

async function testConnectionStoreTransactions() {
  const harness = createVscodeStoreHarness();
  const { ConnectionStore } = requireOutWithVscode('connection-store', harness.vscode);
  const store = new ConnectionStore(harness.context);
  const connection = validateConnection({
    id: 'kx-transaction',
    name: 'Transactional q',
    host: 'localhost',
    port: 5000,
    database: '.',
    username: 'runner',
    connectTimeoutMs: 0,
    queryTimeoutMs: 2500,
  });
  const firstAuthValue = ['first', 'auth', 'value'].join('-');
  const nextAuthValue = ['next', 'auth', 'value'].join('-');

  harness.failSecretStore = 1;
  await assert.rejects(() => store.add(connection, firstAuthValue), /injected SecretStorage store failure/);
  assert.deepStrictEqual(harness.connections, []);
  assert.strictEqual(harness.activeId, undefined);
  assert.strictEqual(harness.secretFor(connection.id), undefined);

  harness.failActiveUpdate = 1;
  await assert.rejects(() => store.add(connection, firstAuthValue), /injected active-state update failure/);
  assert.deepStrictEqual(harness.connections, []);
  assert.strictEqual(harness.activeId, undefined);
  assert.strictEqual(
    harness.secretFor(connection.id),
    undefined,
    'first-profile activation failure must roll back the newly written secret'
  );

  harness.failConfigurationUpdate = 1;
  await assert.rejects(() => store.add(connection, firstAuthValue), /injected configuration update failure/);
  assert.deepStrictEqual(harness.connections, []);
  assert.strictEqual(harness.activeId, undefined);
  assert.strictEqual(
    harness.secretFor(connection.id),
    undefined,
    'add settings failure must roll back both activation and the newly written secret'
  );

  await store.add(connection, firstAuthValue);
  assert.strictEqual(harness.connections.length, 1);
  assert.deepStrictEqual(
    Object.keys(harness.connections[0]).sort(),
    ['connectTimeoutMs', 'database', 'host', 'id', 'name', 'port', 'queryTimeoutMs', 'username']
  );
  assert.strictEqual(harness.connections[0].connectTimeoutMs, 0);
  assert.strictEqual(harness.connections[0].queryTimeoutMs, 2500);
  assert.strictEqual(harness.activeId, connection.id);
  assert.strictEqual(harness.secretFor(connection.id), firstAuthValue);
  assert.strictEqual(await store.hasPassword(connection.id), true);
  assert.ok(!JSON.stringify(harness.connections).includes(firstAuthValue));
  assert.ok(!JSON.stringify(harness.connections).toLocaleLowerCase().includes('password'));

  await store.update({ ...connection, name: 'Metadata-only rename' });
  assert.strictEqual(
    harness.secretFor(connection.id),
    firstAuthValue,
    'an undefined password update must keep the SecretStorage value'
  );
  await store.update(connection, nextAuthValue);
  assert.strictEqual(harness.secretFor(connection.id), nextAuthValue, 'a non-empty password must replace the secret');
  assert.ok(!JSON.stringify(harness.connections).includes(nextAuthValue));
  await store.update(connection, null);
  assert.strictEqual(harness.secretFor(connection.id), undefined, 'null must explicitly clear the saved password');
  assert.strictEqual(await store.hasPassword(connection.id), false);
  await store.update(connection, firstAuthValue);

  const { connectTimeoutMs: _connectTimeoutMs, queryTimeoutMs: _queryTimeoutMs, ...withoutOverrides } = connection;
  await store.update(withoutOverrides);
  assert.deepStrictEqual(
    Object.keys(harness.connections[0]).sort(),
    ['database', 'host', 'id', 'name', 'port', 'username'],
    'blank/inherited timeout overrides must be omitted from settings'
  );
  assert.strictEqual(harness.secretFor(connection.id), firstAuthValue);
  await store.update(connection);

  const changed = { ...connection, host: 'q.example.test' };
  harness.failSecretStore = 1;
  await assert.rejects(() => store.update(changed, nextAuthValue), /injected SecretStorage store failure/);
  assert.strictEqual(harness.connections[0].host, connection.host);
  assert.strictEqual(harness.secretFor(connection.id), firstAuthValue);

  harness.failConfigurationUpdate = 1;
  await assert.rejects(() => store.update(changed, nextAuthValue), /injected configuration update failure/);
  assert.strictEqual(harness.connections[0].host, connection.host);
  assert.strictEqual(harness.secretFor(connection.id), firstAuthValue);

  harness.failConfigurationUpdate = 2;
  await assert.rejects(
    () => store.update(changed, nextAuthValue),
    /could not fully restore the previous connection state/
  );
  assert.strictEqual(
    harness.secretFor(connection.id),
    undefined,
    'an uncertain endpoint rollback must clear the secret instead of pairing old credentials with a changed host'
  );
  await store.update(connection, firstAuthValue);

  const expected = store.connection(connection.id);
  const newer = { ...expected, name: 'Newer saved name' };
  await store.update(newer, undefined, expected);
  await assert.rejects(
    () => store.update({ ...expected, host: 'stale.example.test' }, nextAuthValue, expected),
    /changed after this form was opened/
  );
  assert.strictEqual(store.connection(connection.id).name, newer.name);
  assert.strictEqual(store.connection(connection.id).host, connection.host);
  assert.strictEqual(
    harness.secretFor(connection.id),
    firstAuthValue,
    'a stale edit must be rejected before changing SecretStorage'
  );
  await store.update(connection, undefined, newer);

  harness.failSecretDelete = 1;
  await assert.rejects(() => store.remove(connection.id), /injected SecretStorage delete failure/);
  assert.strictEqual(harness.connections.length, 1);
  assert.strictEqual(harness.activeId, connection.id);
  assert.strictEqual(harness.secretFor(connection.id), firstAuthValue);

  await store.remove(connection.id);
  assert.deepStrictEqual(harness.connections, []);
  assert.strictEqual(harness.activeId, undefined);
  assert.strictEqual(harness.secretFor(connection.id), undefined);

  const concurrentA = { ...connection, id: 'kx-concurrent-a', name: 'Concurrent A' };
  const concurrentB = { ...connection, id: 'kx-concurrent-b', name: 'Concurrent B' };
  await Promise.all([
    store.add(concurrentA, firstAuthValue),
    store.add(concurrentB, nextAuthValue),
  ]);
  assert.deepStrictEqual(
    harness.connections.map(item => item.id).sort(),
    [concurrentA.id, concurrentB.id],
    'serialized read/modify/write mutations must not lose a concurrently added profile'
  );
  assert.strictEqual(harness.secretFor(concurrentA.id), firstAuthValue);
  assert.strictEqual(harness.secretFor(concurrentB.id), nextAuthValue);
  await Promise.all([store.remove(concurrentA.id), store.remove(concurrentB.id)]);
  assert.deepStrictEqual(harness.connections, []);
  assert.strictEqual(harness.activeId, undefined);
}

async function testConnectionUpdateLifecycle() {
  const previous = validateConnection({
    id: 'kx-update-lifecycle',
    name: 'Lifecycle q',
    host: 'old.example.test',
    port: 5000,
    database: '.',
    username: 'runner',
  });

  const unchangedCalls = [];
  const unchangedManager = {
    isConnected(id) {
      unchangedCalls.push(`state:${id}`);
      return true;
    },
    async disconnect(id) {
      unchangedCalls.push(`disconnect:${id}`);
    },
    async connect(connection) {
      unchangedCalls.push(`connect:${connection.host}`);
    },
  };
  const unchanged = await persistConnectionUpdate(
    unchangedManager,
    previous,
    { ...previous, name: 'Renamed', database: '.analytics' },
    false,
    async () => unchangedCalls.push('persist')
  );
  assert.deepStrictEqual(unchanged, { sessionState: 'unchanged' });
  assert.deepStrictEqual(unchangedCalls, [`state:${previous.id}`, 'persist']);

  const failedPersistCalls = [];
  await assert.rejects(
    () => persistConnectionUpdate(
      {
        isConnected() {
          failedPersistCalls.push('state');
          return true;
        },
        async disconnect() {
          failedPersistCalls.push('disconnect');
        },
        async connect() {
          failedPersistCalls.push('connect');
        },
      },
      previous,
      { ...previous, host: 'new.example.test' },
      false,
      async () => {
        failedPersistCalls.push('persist');
        throw new Error('injected persistence failure');
      }
    ),
    /injected persistence failure/
  );
  assert.deepStrictEqual(
    failedPersistCalls,
    ['state', 'persist'],
    'validation/settings/SecretStorage failure must not disturb the active transport'
  );

  const inactiveCalls = [];
  const inactive = await persistConnectionUpdate(
    {
      isConnected() {
        return false;
      },
      async disconnect(id) {
        inactiveCalls.push(`disconnect:${id}`);
      },
      async connect() {
        inactiveCalls.push('connect');
      },
    },
    previous,
    { ...previous, connectTimeoutMs: 0 },
    false,
    async () => inactiveCalls.push('persist')
  );
  assert.deepStrictEqual(inactive, { sessionState: 'disconnected' });
  assert.deepStrictEqual(inactiveCalls, ['persist', `disconnect:${previous.id}`]);

  const reconnectCalls = [];
  const next = { ...previous, host: 'new.example.test', queryTimeoutMs: 1250 };
  const reconnected = await persistConnectionUpdate(
    {
      isConnected() {
        return true;
      },
      async disconnect(id) {
        reconnectCalls.push(`disconnect:${id}`);
      },
      async connect(connection) {
        reconnectCalls.push(`connect:${connection.host}:${connection.queryTimeoutMs}`);
      },
    },
    previous,
    next,
    false,
    async () => reconnectCalls.push('persist')
  );
  assert.deepStrictEqual(reconnected, { sessionState: 'reconnected' });
  assert.deepStrictEqual(
    reconnectCalls,
    ['persist', `disconnect:${previous.id}`, 'connect:new.example.test:1250'],
    'changed active sessions must reconnect only after the safe settings transaction commits'
  );

  const passwordCalls = [];
  const passwordOutcome = await persistConnectionUpdate(
    {
      isConnected: () => true,
      async disconnect() {
        passwordCalls.push('disconnect');
      },
      async connect(connection) {
        assert.strictEqual(connection, previous);
        passwordCalls.push('connect');
      },
    },
    previous,
    previous,
    true,
    async () => passwordCalls.push('persist-secret')
  );
  assert.deepStrictEqual(passwordOutcome, { sessionState: 'reconnected' });
  assert.deepStrictEqual(passwordCalls, ['persist-secret', 'disconnect', 'connect']);

  const reconnectFailure = new Error('injected reconnect failure');
  const reconnectFailed = await persistConnectionUpdate(
    {
      isConnected: () => true,
      async disconnect() {},
      async connect() {
        throw reconnectFailure;
      },
    },
    previous,
    { ...previous, port: 6000 },
    false,
    async () => undefined
  );
  assert.strictEqual(reconnectFailed.sessionState, 'reconnect-failed');
  assert.strictEqual(reconnectFailed.error, reconnectFailure);
}

async function testConnectionManagerLifecycle() {
  const runtimeSettings = {
    connectionTimeoutMs: 1500,
    queryTimeoutMs: 2750,
  };
  const fakeVscode = createVscodeRuntimeMock(runtimeSettings);
  class FakeKdbQError extends Error {}
  class FakeKdbIpcError extends Error {
    constructor(message, phase, code) {
      super(message);
      this.phase = phase;
      this.code = code;
    }
  }
  const capturedQueries = [];
  const capturedQuerySignals = [];
  const createdClients = [];
  let nextConnectError;
  let nextConnectDeferred;
  let nextQueryError;
  let nextQueryDeferred;
  class FakeKdbIpcClient {
    constructor(options) {
      this.options = options;
      this.closed = false;
      this.canceled = false;
      createdClients.push(this);
    }

    async connect() {
      this.options.onDidPhase?.('connect', 'start');
      if (nextConnectError) {
        const error = nextConnectError;
        nextConnectError = undefined;
        throw error;
      }
      if (nextConnectDeferred) {
        const pending = nextConnectDeferred;
        nextConnectDeferred = undefined;
        pending.started.resolve();
        await pending.promise;
      }
      this.options.onDidPhase?.('connect', 'success');
      this.options.onDidPhase?.('handshake', 'start');
      this.options.onDidPhase?.('handshake', 'success');
    }

    async close() {
      this.closed = true;
      if (this.options.onDidClose) {
        this.options.onDidClose();
      }
    }

    cancel() {
      this.closed = true;
      this.canceled = true;
    }

    async query(query, onIssued, signal) {
      if (signal?.aborted) {
        throw new KdbQueryCanceledError();
      }
      capturedQueries.push(query);
      capturedQuerySignals.push(signal);
      try {
        onIssued?.();
      } catch {
        // Match KdbIpcClient: local history observers cannot disrupt a written request.
      }
      if (nextQueryError) {
        const error = nextQueryError;
        nextQueryError = undefined;
        throw error;
      }
      if (nextQueryDeferred) {
        const pending = nextQueryDeferred;
        nextQueryDeferred = undefined;
        if (!signal) {
          return pending.promise;
        }
        return new Promise((resolve, reject) => {
          let settled = false;
          const finish = action => {
            if (settled) {
              return;
            }
            settled = true;
            signal.removeEventListener('abort', onAbort);
            action();
          };
          const onAbort = () => finish(() => reject(new KdbQueryCanceledError()));
          signal.addEventListener('abort', onAbort, { once: true });
          if (signal.aborted) {
            onAbort();
          }
          pending.promise.then(
            value => finish(() => resolve(value)),
            error => finish(() => reject(error))
          );
        });
      }
      if (query === CONNECTION_TEST_QUERY) {
        return false;
      }
      if (query === connectionTestNamespaceQuery('.analytics')) {
        return ['.', true, '.'];
      }
      return 2;
    }
  }
  const { ConnectionManager } = requireOutWithMocks('connection-manager', {
    vscode: fakeVscode,
    './q-ipc': {
      KdbIpcClient: FakeKdbIpcClient,
      KdbIpcError: FakeKdbIpcError,
      KdbQError: FakeKdbQError,
      KdbQueryCanceledError,
    },
  });
  const connection = validateConnection({
    id: 'kx-lifecycle',
    name: 'Lifecycle q',
    host: 'localhost',
    port: 5000,
    database: '.',
    username: '',
  });

  const sharedConnectGate = deferred();
  const sharedConnectStarted = deferred();
  nextConnectDeferred = {
    promise: sharedConnectGate.promise,
    started: sharedConnectStarted,
  };
  const connectCancellationManager = new ConnectionManager({
    async password() {
      return undefined;
    },
  });
  const connectCancellationController = new AbortController();
  const clientsBeforeCanceledConnect = createdClients.length;
  const canceledConnect = connectCancellationManager.connect(
    connection,
    connectCancellationController.signal
  );
  await assertCompletesWithin(
    'abortable shared connection start',
    () => sharedConnectStarted.promise,
    1000
  );
  const canceledConnectRejection = assert.rejects(
    () => canceledConnect,
    error => error instanceof KdbQueryCanceledError
  );
  connectCancellationController.abort();
  await assertCompletesWithin(
    'local connection wait cancellation',
    () => canceledConnectRejection,
    1000
  );
  assert.strictEqual(
    connectCancellationManager.isConnected(connection.id),
    false,
    'canceling one caller wait must not report an opening connection as ready'
  );
  assert.strictEqual(createdClients.length, clientsBeforeCanceledConnect + 1);
  const openingClient = createdClients.at(-1);
  const sharedConnect = connectCancellationManager.connect(connection);
  sharedConnectGate.resolve();
  assert.strictEqual(
    await sharedConnect,
    openingClient,
    'a local wait cancellation must not poison or duplicate a shared in-progress connection'
  );
  assert.strictEqual(connectCancellationManager.isConnected(connection.id), true);
  await connectCancellationManager.disconnectAll();
  connectCancellationManager.dispose();

  let passwordAttempts = 0;
  const retryManager = new ConnectionManager({
    async password() {
      passwordAttempts++;
      if (passwordAttempts === 1) {
        throw new Error('injected SecretStorage get failure');
      }
      return undefined;
    },
  });
  let stateChanges = 0;
  const stateSubscription = retryManager.onDidChangeState(() => stateChanges++);
  let connectFailureIssued = 0;
  await assert.rejects(
    () => retryManager.execute(connection, '1+1', () => connectFailureIssued++),
    /injected SecretStorage get failure/
  );
  assert.strictEqual(connectFailureIssued, 0, 'queries that fail before connect must not be marked issued');
  const initialClient = await retryManager.connect(connection);
  assert.strictEqual(passwordAttempts, 2, 'a failed secret lookup must not poison later connection attempts');
  assert.strictEqual(retryManager.isConnected(connection.id), true);
  assert.strictEqual(initialClient.options.connectTimeoutMs, 1500);
  assert.strictEqual(initialClient.options.queryTimeoutMs, 2750);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(initialClient.options, 'timeoutMs'), false);

  const namespacedConnection = { ...connection, database: '.analytics' };
  const preCanceledManagerController = new AbortController();
  preCanceledManagerController.abort();
  const queriesBeforeManagerPreCancel = capturedQueries.length;
  const clientsBeforeManagerPreCancel = createdClients.length;
  let managerPreCanceledIssued = 0;
  await assert.rejects(
    () => retryManager.execute(
      namespacedConnection,
      'never-dispatch-manager-query',
      () => managerPreCanceledIssued++,
      preCanceledManagerController.signal
    ),
    error => error instanceof KdbQueryCanceledError
  );
  assert.strictEqual(managerPreCanceledIssued, 0);
  assert.strictEqual(
    capturedQueries.length,
    queriesBeforeManagerPreCancel,
    'ConnectionManager must honor a pre-aborted signal before invoking the q client'
  );
  assert.strictEqual(
    createdClients.length,
    clientsBeforeManagerPreCancel,
    'a pre-aborted manager execution must not create a replacement session'
  );
  assert.strictEqual(
    retryManager.isConnected(connection.id),
    true,
    'pre-dispatch cancellation must not drop the shared active q session'
  );

  let successfulQueryIssued = 0;
  await retryManager.execute(namespacedConnection, 'answer', () => successfulQueryIssued++);
  assert.strictEqual(successfulQueryIssued, 1);
  assert.strictEqual(capturedQueries.at(-1), queryInNamespace('answer', '.analytics'));
  let successfulScriptIssued = 0;
  const successfulScriptController = new AbortController();
  await retryManager.executeScript(
    namespacedConnection,
    'a:1\na+1',
    () => successfulScriptIssued++,
    successfulScriptController.signal
  );
  assert.strictEqual(successfulScriptIssued, 1);
  assert.strictEqual(capturedQueries.at(-1), qScriptInNamespace('a:1\na+1', '.analytics'));
  assert.strictEqual(
    capturedQuerySignals.at(-1),
    successfulScriptController.signal,
    'ConnectionManager must pass the caller AbortSignal through the full-cell script path'
  );
  let strictIssued = 0;
  await retryManager.executeInConfiguredNamespace(connection, 'string system "d"', () => strictIssued++);
  assert.strictEqual(strictIssued, 1);
  assert.strictEqual(
    capturedQueries.at(-1),
    queryInNamespaceStrict('string system "d"', '.'),
    'Server Explorer preview/metadata must use the strict root namespace wrapper'
  );
  await retryManager.executeInConfiguredNamespace(namespacedConnection, 'tables[]');
  assert.strictEqual(capturedQueries.at(-1), queryInNamespaceStrict('tables[]', '.analytics'));
  await retryManager.execute(namespacedConnection, '2+2', () => {
    throw new Error('history observer failure');
  });
  assert.strictEqual(
    capturedQueries.at(-1),
    queryInNamespace('2+2', '.analytics'),
    'history observers must never prevent the q transport call'
  );

  const managerCanceledQueryDeferred = deferred();
  nextQueryDeferred = managerCanceledQueryDeferred;
  const managerPostDispatchController = new AbortController();
  const managerQueryIssued = deferred();
  const managerCanceledQuery = retryManager.executeScript(
    namespacedConnection,
    'longRunning[]',
    () => managerQueryIssued.resolve(),
    managerPostDispatchController.signal
  );
  await assertCompletesWithin(
    'ConnectionManager post-dispatch query issue',
    () => managerQueryIssued.promise,
    1000
  );
  const managerCanceledQueryRejection = assert.rejects(
    () => managerCanceledQuery,
    error => error instanceof KdbQueryCanceledError
  );
  managerPostDispatchController.abort();
  await assertCompletesWithin(
    'ConnectionManager post-dispatch local cancellation',
    () => managerCanceledQueryRejection,
    1000
  );
  assert.strictEqual(
    retryManager.isConnected(connection.id),
    true,
    'a local query cancellation must not drop the shared active q session'
  );
  assert.strictEqual(initialClient.canceled, false);
  managerCanceledQueryDeferred.resolve(2);
  await eventLoopTurn();

  const genuineQError = new FakeKdbQError('type');
  nextQueryError = genuineQError;
  let qFailureIssued = 0;
  await assert.rejects(
    () => retryManager.execute(namespacedConnection, 'badQuery', () => qFailureIssued++),
    error => error === genuineQError
  );
  assert.strictEqual(qFailureIssued, 1, 'genuine q failures occur after the request is issued');
  assert.strictEqual(
    retryManager.isConnected(connection.id),
    true,
    'a genuine q error must not be converted to result data or drop a healthy connection'
  );

  nextQueryError = new Error('injected transport failure');
  let transportFailureIssued = 0;
  await assert.rejects(
    () => retryManager.execute(namespacedConnection, '1+1', () => transportFailureIssued++),
    /transport failure/
  );
  assert.strictEqual(transportFailureIssued, 1, 'transport failures after query() starts are issued');
  assert.strictEqual(
    retryManager.isConnected(connection.id),
    false,
    'a transport failure must immediately clear the connected tree state'
  );

  nextConnectError = new Error('injected connect failure');
  let openFailureIssued = 0;
  await assert.rejects(
    () => retryManager.execute(connection, '1+1', () => openFailureIssued++),
    /connect failure/
  );
  assert.strictEqual(openFailureIssued, 0, 'TCP/handshake failure must not create a history entry');
  assert.strictEqual(retryManager.isConnected(connection.id), false, 'failed opens must not leave stale state');
  const reconnectedClient = await retryManager.connect(connection);
  assert.strictEqual(retryManager.isConnected(connection.id), true, 'a failed open must remain retryable');
  reconnectedClient.options.onDidClose();
  assert.strictEqual(
    retryManager.isConnected(connection.id),
    false,
    'a remote close callback must refresh the connection state immediately'
  );
  assert.ok(stateChanges >= 5, 'connection lifecycle transitions must emit tree refresh events');

  await retryManager.disconnectAll();
  assert.strictEqual(retryManager.isConnected(connection.id), false);
  stateSubscription.dispose();
  retryManager.dispose();

  let resolvePassword;
  const delayedPassword = new Promise(resolve => {
    resolvePassword = resolve;
  });
  const delayedManager = new ConnectionManager({ password: () => delayedPassword });
  const opening = delayedManager.connect(connection);
  const openingRejected = assert.rejects(opening, /connection canceled/i);
  await Promise.resolve();
  const disconnected = delayedManager.disconnectAll();
  resolvePassword(undefined);
  await Promise.all([openingRejected, disconnected]);
  assert.strictEqual(delayedManager.isConnected(connection.id), false);
  delayedManager.dispose();

  const timeoutManager = new ConnectionManager({ password: async () => 'secret-from-storage' });
  assert.deepStrictEqual(timeoutManager.globalTimeouts(), {
    connectTimeoutMs: 1500,
    queryTimeoutMs: 2750,
  });
  assert.deepStrictEqual(timeoutManager.timeoutsFor({
    ...connection,
    connectTimeoutMs: 0,
    queryTimeoutMs: MAX_TIMEOUT_MS,
  }), {
    connectTimeoutMs: 0,
    queryTimeoutMs: MAX_TIMEOUT_MS,
  });

  const inheritedClient = await timeoutManager.connect(connection);
  assert.strictEqual(inheritedClient.options.password, 'secret-from-storage');
  assert.strictEqual(inheritedClient.options.connectTimeoutMs, 1500);
  assert.strictEqual(inheritedClient.options.queryTimeoutMs, 2750);
  assert.strictEqual(
    await timeoutManager.connect({ ...connection, name: 'Display rename', database: '.analytics' }),
    inheritedClient,
    'display/namespace-only edits must keep the healthy direct session'
  );

  const oldCloseCallback = inheritedClient.options.onDidClose;
  const changedRuntime = {
    ...connection,
    host: 'replacement.example.test',
    connectTimeoutMs: 0,
    queryTimeoutMs: 9750,
  };
  const replacementClient = await timeoutManager.connect(changedRuntime);
  assert.notStrictEqual(replacementClient, inheritedClient);
  assert.strictEqual(inheritedClient.closed, true, 'a signature change must close the stale client first');
  assert.strictEqual(replacementClient.options.host, changedRuntime.host);
  assert.strictEqual(replacementClient.options.connectTimeoutMs, 0);
  assert.strictEqual(replacementClient.options.queryTimeoutMs, 9750);
  oldCloseCallback();
  assert.strictEqual(
    timeoutManager.isConnected(connection.id),
    true,
    'a delayed close callback from the old client must not drop its replacement'
  );
  await timeoutManager.disconnectIfConfigurationChanged(connection.id, changedRuntime);
  assert.strictEqual(
    timeoutManager.isConnected(connection.id),
    true,
    'an unrelated profile add/configuration event must keep the matching active session'
  );
  assert.strictEqual(
    replacementClient.closed,
    false,
    'the matching connected client must not be closed or recycled after an unrelated profile add'
  );

  const globallyConfigured = validateConnection({
    ...connection,
    id: 'kx-global-timeouts',
    name: 'Global timeout q',
  });
  const globalClient = await timeoutManager.connect(globallyConfigured);
  runtimeSettings.queryTimeoutMs = 3250;
  await timeoutManager.disconnectIfConfigurationChanged(globallyConfigured.id, globallyConfigured);
  assert.strictEqual(globalClient.closed, true);
  assert.strictEqual(
    timeoutManager.isConnected(globallyConfigured.id),
    false,
    'a changed inherited global timeout must invalidate the old session signature'
  );

  const beforeTestCount = createdClients.length;
  await timeoutManager.test(changedRuntime);
  assert.strictEqual(createdClients.length, beforeTestCount + 1);
  const testClient = createdClients.at(-1);
  assert.strictEqual(testClient.options.connectTimeoutMs, 0);
  assert.strictEqual(testClient.options.queryTimeoutMs, 9750);
  assert.strictEqual(testClient.closed, true, 'test connections must always be temporary');
  assert.strictEqual(timeoutManager.isConnected(changedRuntime.id), true, 'testing must not disrupt the saved active client');

  const temporaryPhases = [];
  const queriesBeforeNamespaceTest = capturedQueries.length;
  const formSecret = ['temporary', 'form', 'secret'].join('-');
  const temporaryTimeouts = await timeoutManager.testTemporary(
    { ...changedRuntime, database: '.analytics' },
    { password: formSecret, onPhase: phase => temporaryPhases.push(phase) }
  );
  assert.deepStrictEqual(temporaryTimeouts, { connectTimeoutMs: 0, queryTimeoutMs: 9750 });
  assert.deepStrictEqual(temporaryPhases, ['connect', 'handshake', 'namespace', 'query']);
  assert.deepStrictEqual(capturedQueries.slice(queriesBeforeNamespaceTest), [
    connectionTestNamespaceQuery('.analytics'),
    CONNECTION_TEST_QUERY,
  ]);
  const namespacedTestClient = createdClients.at(-1);
  assert.strictEqual(namespacedTestClient.options.password, formSecret);
  assert.strictEqual(namespacedTestClient.closed, true);
  assert.notStrictEqual(namespacedTestClient, replacementClient);
  assert.strictEqual(replacementClient.closed, false, 'the active saved transport must remain untouched');

  const diagnosticSecret = ['diagnostic', 'secret'].join('-');
  nextConnectError = new FakeKdbIpcError(
    `handshake rejected ${diagnosticSecret} ${CONNECTION_TEST_QUERY}`,
    'handshake',
    'EAUTH'
  );
  await assert.rejects(
    () => timeoutManager.testTemporary(changedRuntime, { password: diagnosticSecret }),
    error => error instanceof ConnectionTestError &&
      error.phase === 'handshake' &&
      error.code === 'EAUTH' &&
      !error.message.includes(diagnosticSecret) &&
      !error.message.includes(CONNECTION_TEST_QUERY)
  );
  assert.strictEqual(createdClients.at(-1).closed, true, 'handshake failures must close the temporary client');

  nextConnectError = new FakeKdbIpcError('connect refused', 'connect', 'ECONNREFUSED');
  await assert.rejects(
    () => timeoutManager.testTemporary(changedRuntime),
    error => error instanceof ConnectionTestError &&
      error.phase === 'connect' &&
      /ECONNREFUSED/.test(error.message)
  );
  assert.strictEqual(createdClients.at(-1).closed, true);

  nextQueryError = new FakeKdbQError(`namespace request failed ${diagnosticSecret}`);
  await assert.rejects(
    () => timeoutManager.testTemporary({ ...changedRuntime, database: '.analytics' }),
    error => error instanceof ConnectionTestError &&
      error.phase === 'namespace' &&
      !error.message.includes(diagnosticSecret) &&
      !error.message.includes(connectionTestNamespaceQuery('.analytics'))
  );
  assert.strictEqual(createdClients.at(-1).closed, true);

  nextQueryError = new Error(`query request failed ${diagnosticSecret} ${CONNECTION_TEST_QUERY}`);
  await assert.rejects(
    () => timeoutManager.testTemporary(changedRuntime),
    error => error instanceof ConnectionTestError &&
      error.phase === 'query' &&
      !error.message.includes(diagnosticSecret) &&
      !error.message.includes(CONNECTION_TEST_QUERY)
  );
  assert.strictEqual(createdClients.at(-1).closed, true);

  const testCancellation = new AbortController();
  const pendingCancellationQuery = deferred();
  nextQueryDeferred = pendingCancellationQuery;
  const canceledTestPromise = timeoutManager.testTemporary(changedRuntime, {
    signal: testCancellation.signal,
  });
  await Promise.resolve();
  await Promise.resolve();
  const canceledClient = createdClients.at(-1);
  testCancellation.abort();
  assert.strictEqual(canceledClient.canceled, true, 'abort must destroy the in-flight temporary transport');
  assert.strictEqual(capturedQueries.at(-1), CONNECTION_TEST_QUERY);
  // The real client rejects a pending query in cancel(); release the deterministic fake the same way.
  pendingCancellationQuery.reject(new Error('fake transport canceled'));
  await assert.rejects(
    canceledTestPromise,
    error => error instanceof ConnectionTestError &&
      error.phase === 'cancel' &&
      !error.message.includes('fake transport canceled')
  );
  assert.strictEqual(canceledClient.closed, true);

  runtimeSettings.connectionTimeoutMs = 4321;
  runtimeSettings.queryTimeoutMs = null;
  assert.deepStrictEqual(
    timeoutManager.globalTimeouts(),
    { connectTimeoutMs: 4321, queryTimeoutMs: 4321 },
    'null query timeout must preserve the pre-0.1.3 connectionTimeoutMs behavior'
  );
  runtimeSettings.connectionTimeoutMs = MAX_TIMEOUT_MS + 1;
  runtimeSettings.queryTimeoutMs = -1;
  assert.deepStrictEqual(
    timeoutManager.globalTimeouts(),
    { connectTimeoutMs: DEFAULT_CONNECTION_TIMEOUT_MS, queryTimeoutMs: DEFAULT_CONNECTION_TIMEOUT_MS },
    'invalid hand-edited global values must resolve to bounded safe defaults'
  );
  await timeoutManager.disconnectAll();
  timeoutManager.dispose();
}

function testColumnarResults() {
  let reads = 0;
  const millionRows = createColumnarPanelResult(['id', 'value', 'note'], 1_000_000, (row, column) => {
    reads++;
    return column === 0 ? row : column === 1 ? row * 2 : `row ${row}`;
  });
  assert.deepStrictEqual(
    millionRows.cellWindow({ start: 999_998, end: 999_999 }, { start: 0, end: 1 }),
    {
      startRow: 999_998,
      endRow: 999_999,
      startColumn: 0,
      endColumn: 1,
      cells: [['999998', '1999996'], ['999999', '1999998']],
    }
  );
  assert.strictEqual(reads, 4, 'a visible window must not materialize the full result');
  assert.deepStrictEqual(
    millionRows.cellWindow({ start: -5, end: 0 }, { start: 2, end: 99 }).cells,
    [['row 0']]
  );

  const result = rowsToColumnarPanelResult([
    { sym: 'AAPL', note: 'line\nbreak', nums: [1, 2, 3] },
    { sym: 'MSFT', note: null, nums: [4, 5] },
  ], ['sym', 'note', 'nums']);
  assert.deepStrictEqual(
    result.cellWindow({ start: 0, end: 1 }, { start: 1, end: 2 }).cells,
    [['line break', '1, 2, 3'], ['', '4, 5']]
  );
  assert.deepStrictEqual(
    result.cellWindow({ start: 0, end: 0 }, { start: 2, end: 2 }, { arrayDisplayFormat: 'raw' }).cells,
    [['[1 2 3]']]
  );
  const range = { startRow: 0, endRow: 1, startColumn: 0, endColumn: 2 };
  assert.strictEqual(
    result.toText('csv', range, { includeHeaders: true, includeRowIndex: true }),
    '#,sym,note,nums\n1,AAPL,"line\nbreak","1, 2, 3"\n2,MSFT,,"4, 5"'
  );
  assert.strictEqual(
    result.toText('json', range, { includeRowIndex: true }),
    '[{"#":1,"sym":"AAPL","note":"line\\nbreak","nums":[1,2,3]},{"#":2,"sym":"MSFT","note":null,"nums":[4,5]}]'
  );
  assert.strictEqual(
    result.toText('markdown', { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 }, true),
    '| sym | note |\n| --- | --- |\n| AAPL | line<br>break |'
  );
}

async function testLocalDataServerConcurrency() {
  const { LocalDataServer } = requireOut('local-data-server');
  const preferredPort = await unusedLoopbackPort();
  const server = new LocalDataServer({
    preferredPort,
    provider: { current: () => null },
  });
  try {
    const [first, second] = await Promise.all([server.start(), server.start()]);
    assert.deepStrictEqual(second, first, 'concurrent starts must share one listener and token');
    assert.strictEqual(server.running, true);
    await server.stop();
    assert.strictEqual(server.running, false);
    await assert.rejects(() => connectToLoopback(first.port), /ECONNREFUSED|closed before connect/);

    const starting = server.start();
    const stopping = server.stop();
    await Promise.all([starting, stopping]);
    assert.strictEqual(server.running, false, 'stop during start must close the listener that finishes opening');
  } finally {
    await server.stop();
  }
}

async function testNotebookCellLanguage() {
  assert.deepStrictEqual(
    selectedNotebookCellIndexes(6, [
      { start: 1, end: 4 },
      { start: 3, end: 6 },
      { start: 1, end: 1 },
    ]),
    [1, 2, 3, 4, 5],
    'all selected notebook ranges must be flattened, de-duplicated, and sorted'
  );
  assert.deepStrictEqual(selectedNotebookCellIndexes(3, []), []);

  const python0 = { id: 'python-0', languageId: 'python' };
  const q1 = { id: 'q-1', languageId: 'q' };
  const markdown2 = { id: 'markdown-2', languageId: 'markdown' };
  const failing3 = { id: 'failing-3', languageId: 'python' };
  const python4 = { id: 'python-4', languageId: 'python' };
  const setterCalls = [];
  const provider = new NotebookCellLanguageProvider(async (document, languageId) => {
    setterCalls.push([document, languageId]);
    if (document === failing3) {
      throw new Error('simulated language failure');
    }
    return { ...document, languageId };
  });
  const languageResult = await provider.setLanguage([
    { index: 4, isCode: true, document: python4 },
    { index: 0, isCode: true, document: python0 },
    { index: 1, isCode: true, document: q1 },
    { index: 2, isCode: false, document: markdown2 },
    { index: 3, isCode: true, document: failing3 },
    { index: 0, isCode: true, document: python0 },
  ], 'q');
  assert.deepStrictEqual(setterCalls, [
    [python0, 'q'],
    [failing3, 'q'],
    [python4, 'q'],
  ], 'the provider must call the actual language setter once per non-q code cell with q');
  assert.strictEqual(languageResult.selected, 5);
  assert.strictEqual(languageResult.codeCells, 4);
  assert.strictEqual(languageResult.skippedNonCode, 1, 'Markdown must be rejected without mutation');
  assert.strictEqual(languageResult.changed, 2);
  assert.strictEqual(languageResult.unchanged, 1, 'an already-q cell must be idempotent');
  assert.deepStrictEqual(languageResult.successes.map(item => [item.index, item.changed]), [
    [0, true],
    [1, false],
    [4, true],
  ]);
  assert.deepStrictEqual(languageResult.failures, [
    { index: 3, message: 'simulated language failure' },
  ], 'one failure must not prevent later selected cells from changing');

  let markdownSetterCalled = false;
  const markdownOnly = new NotebookCellLanguageProvider(async document => {
    markdownSetterCalled = true;
    return document;
  });
  const markdownResult = await markdownOnly.setLanguage([
    { index: 0, isCode: false, document: markdown2 },
  ], 'q');
  assert.strictEqual(markdownSetterCalled, false);
  assert.strictEqual(markdownResult.codeCells, 0);
  assert.strictEqual(markdownResult.skippedNonCode, 1);

  const badSetter = new NotebookCellLanguageProvider(async document => document);
  const wrongLanguage = await badSetter.setLanguage([
    { index: 0, isCode: true, document: python0 },
  ], 'q');
  assert.strictEqual(wrongLanguage.changed, 0);
  assert.match(wrongLanguage.failures[0].message, /returned language 'python'/);

  assert.strictEqual(jupyterNotebookDefaultLanguageId({
    metadata: {
      language_info: { name: 'Python3' },
      kernelspec: { language: 'julia' },
    },
  }), 'python');
  assert.strictEqual(jupyterNotebookDefaultLanguageId({
    metadata: { kernelspec: { language: 'bash' } },
  }), 'shellscript');
  assert.strictEqual(jupyterNotebookDefaultLanguageId({ metadata: {} }), undefined);

  const settings = { rowLimit: 25, byteLimit: 20_000 };
  const userSource = 'select from trade';
  const markerInsertion = notebookQMarkerInsertion(userSource, settings);
  assert.deepStrictEqual(markerInsertion, {
    character: 0,
    text: '%%q --max-rows 25 --max-bytes 20000\n',
  });
  assert.strictEqual(
    userSource.slice(0, markerInsertion.character) +
      markerInsertion.text +
      userSource.slice(markerInsertion.character),
    '%%q --max-rows 25 --max-bytes 20000\nselect from trade',
    'marker preparation must only insert a prefix and retain all user q source'
  );
  assert.deepStrictEqual(notebookQMarkerInsertion('\uFEFFselect from trade', settings), {
    character: 1,
    text: '%%q --max-rows 25 --max-bytes 20000\n',
  }, 'a UTF-8 BOM must stay at the beginning of the cell');
  assert.strictEqual(
    notebookQMarkerInsertion('%%q --max-rows 5\nselect from trade', settings),
    undefined,
    'an existing marker must be preserved without duplication'
  );

  const originalMetadata = {
    id: 'cell-id',
    execution_count: 7,
    foreignTopLevel: { keep: true },
    metadata: {
      collapsed: true,
      foreign: { keep: 'nested' },
      vscode: { languageId: 'q', future: true },
      [KX_NOTEBOOK_METADATA_KEY]: { futureKxField: 'keep', rowLimit: 1 },
    },
  };
  const metadataSnapshot = cloneJson(originalMetadata);
  const preparedMetadata = preparedNotebookQCellMetadata(originalMetadata, settings);
  assert.deepStrictEqual(originalMetadata, metadataSnapshot, 'metadata input must not be mutated');
  assert.strictEqual(preparedMetadata.id, 'cell-id');
  assert.deepStrictEqual(preparedMetadata.foreignTopLevel, { keep: true });
  assert.deepStrictEqual(preparedMetadata.metadata.foreign, { keep: 'nested' });
  assert.deepStrictEqual(preparedMetadata.metadata.vscode, {
    languageId: 'q',
    future: true,
  }, 'the ipynb serializer-owned vscode language metadata must be preserved');
  assert.deepStrictEqual(preparedMetadata.metadata[KX_NOTEBOOK_METADATA_KEY], {
    futureKxField: 'keep',
    rowLimit: 25,
    version: KX_NOTEBOOK_METADATA_VERSION,
    language: 'q',
    marker: '%%q',
    byteLimit: 20_000,
  });

  const languageSource = fs.readFileSync(
    path.join(ROOT, 'src', 'notebook-cell-language.ts'),
    'utf8'
  );
  assert.ok(!/from ['"]vscode['"]|q-ipc|ConnectionManager|executeQText|createNotebookController/.test(languageSource),
    'the notebook language provider must remain a pure setter boundary with no direct q IPC/controller path');
}

function testNotebookContract() {
  assert.strictEqual(KX_NOTEBOOK_MIME, 'application/vnd.kx.result+json');
  assert.strictEqual(safeNotebookPresentation(undefined), 'inline');
  assert.strictEqual(safeNotebookPresentation('unexpected'), 'inline');
  assert.strictEqual(safeNotebookPresentation('panel'), 'panel');
  assert.strictEqual(safeNotebookPresentation('both'), 'both');
  assert.strictEqual(safeNotebookRowLimit(undefined), DEFAULT_NOTEBOOK_ROW_LIMIT);
  assert.strictEqual(safeNotebookRowLimit(-5), MIN_NOTEBOOK_ROW_LIMIT);
  assert.strictEqual(safeNotebookRowLimit(MAX_NOTEBOOK_ROW_LIMIT + 1), MAX_NOTEBOOK_ROW_LIMIT);
  assert.strictEqual(safeNotebookByteLimit(undefined), DEFAULT_NOTEBOOK_BYTE_LIMIT);
  assert.strictEqual(safeNotebookByteLimit(1), MIN_NOTEBOOK_BYTE_LIMIT);
  assert.strictEqual(safeNotebookByteLimit(MAX_NOTEBOOK_BYTE_LIMIT + 1), MAX_NOTEBOOK_BYTE_LIMIT);
  assert.strictEqual(hasNotebookQMarker('%%q\nselect from t'), true);
  assert.strictEqual(hasNotebookQMarker('%%q --max-rows 5 --max-bytes 20000\nselect from t'), true);
  assert.strictEqual(hasNotebookQMarker('\n%%q\nselect from t'), false);
  assert.strictEqual(hasNotebookQMarker('x:42'), false);
  assert.strictEqual(notebookQMagicLine({ rowLimit: 25, byteLimit: 20000 }),
    '%%q --max-rows 25 --max-bytes 20000');

  const source = '<script>alert("source")</script>\n([] sym:`A`B; px:10 20; ts:2026.01.01 2026.01.02)';
  const payload = createPortableKxResult({
    columns: [
      { name: 'sym', type: 'symbol' },
      { name: 'px', type: 'float' },
      { name: 'ts', type: 'timestamp' },
      { name: 'note', type: 'string' },
    ],
    rows: [
      ['<img src=x onerror=alert(1)>', 10.5, new Date('2026-01-01T00:00:00Z'), 'a&b'],
      ['B', 20.25, new Date('2026-01-02T00:00:00Z'), 'line\nbreak'],
      ['C', 30, new Date('2026-01-03T00:00:00Z'), { nested: true }],
    ],
    rowCount: 1000000,
    rowLimit: 2,
    byteLimit: MIN_NOTEBOOK_BYTE_LIMIT,
    label: '<unsafe session>',
    elapsedMs: 12.5,
    qSource: source,
    chart: { visible: true, type: 'line', xColumn: 'ts', yColumns: ['px'] },
  });
  assert.strictEqual(payload.version, 1);
  assert.strictEqual(payload.kind, 'table');
  assert.strictEqual(payload.data.encoding, 'rows');
  assert.strictEqual(payload.result.rowCount, 1000000);
  assert.strictEqual(payload.result.previewRowCount, 2);
  assert.strictEqual(payload.result.truncated, true);
  assert.ok(payload.result.truncationReasons.includes('rowLimit'));
  assert.strictEqual(payload.chart.type, 'line');
  assert.deepStrictEqual(payload.chart.yColumns, ['px']);
  assert.strictEqual(payload.data.rows[0][1].kind, 'number');
  assert.strictEqual(payload.data.rows[0][2].kind, 'temporal');
  assert.ok(portableKxResultBytes(payload) <= payload.result.byteLimit);
  assert.deepStrictEqual(validatePortableKxResult(payload), { ok: true, value: payload });
  assert.deepStrictEqual(parseNotebookRendererMessage({ type: 'ready' }), { type: 'ready' });
  assert.strictEqual(parseNotebookRendererMessage({ type: 'ready', payload }), undefined);
  assert.deepStrictEqual(
    parseNotebookRendererMessage({ type: 'openPreview', payload }),
    { type: 'openPreview', payload }
  );
  assert.strictEqual(parseNotebookRendererMessage({ type: 'openPreview', payload, token: 'forbidden' }), undefined);
  const sharedResultSettings = {
    density: 'standard',
    functionDisplayStrategy: 'qText',
  };
  assert.deepStrictEqual(notebookRendererSettingsMessage({
    presentation: 'inline',
    rowLimit: DEFAULT_NOTEBOOK_ROW_LIMIT,
    byteLimit: DEFAULT_NOTEBOOK_BYTE_LIMIT,
  }, sharedResultSettings), {
    type: 'settings',
    presentation: 'inline',
    rowLimit: DEFAULT_NOTEBOOK_ROW_LIMIT,
    byteLimit: DEFAULT_NOTEBOOK_BYTE_LIMIT,
    resultSettings: sharedResultSettings,
  });

  const liveId = `live_${'a'.repeat(32)}`;
  assert.deepStrictEqual(
    parseNotebookLiveResultReference({ version: 1, id: liveId }),
    { version: 1, id: liveId }
  );
  assert.strictEqual(parseNotebookLiveResultReference({ version: 1, id: 'short' }), undefined);
  assert.strictEqual(
    parseNotebookLiveResultReference({ version: 1, id: liveId, handle: 'forbidden' }),
    undefined
  );
  assert.deepStrictEqual(
    parseNotebookRendererMessage({ type: 'requestLiveResult', liveId, requestId: 1 }),
    { type: 'requestLiveResult', liveId, requestId: 1 }
  );
  assert.deepStrictEqual(
    parseNotebookRendererMessage({
      type: 'requestLiveSlice',
      liveId,
      requestId: 2,
      startRow: 10,
      endRow: 19,
      startColumn: 2,
      endColumn: 5,
      sortColumn: 'sym',
      sortDirection: 'asc',
    }),
    {
      type: 'requestLiveSlice',
      liveId,
      requestId: 2,
      startRow: 10,
      endRow: 19,
      startColumn: 2,
      endColumn: 5,
      sortColumn: 'sym',
      sortDirection: 'asc',
    }
  );
  assert.strictEqual(parseNotebookRendererMessage({
    type: 'requestLiveSlice',
    liveId,
    requestId: 2,
    startRow: 0,
    endRow: MAX_LIVE_NOTEBOOK_SLICE_ROWS,
    startColumn: 0,
    endColumn: 0,
  }), undefined);
  assert.deepStrictEqual(
    parseNotebookRendererMessage({
      type: 'searchLiveResult',
      liveId,
      requestId: 3,
      query: 'AAPL',
    }),
    { type: 'searchLiveResult', liveId, requestId: 3, query: 'AAPL' }
  );
  assert.deepStrictEqual(
    parseNotebookRendererMessage({
      type: 'requestLiveChart',
      liveId,
      requestId: 4,
      chartType: 'line',
      xColumn: 'time',
      yColumns: ['price'],
      maxPoints: 2500,
    }),
    {
      type: 'requestLiveChart',
      liveId,
      requestId: 4,
      chartType: 'line',
      xColumn: 'time',
      yColumns: ['price'],
      maxPoints: 2500,
    }
  );
  assert.deepStrictEqual(
    parseNotebookRendererMessage({
      type: 'updateResultSetting',
      key: 'arrayDisplayFormat',
      value: 'space',
    }),
    { type: 'updateResultSetting', key: 'arrayDisplayFormat', value: 'space' }
  );
  assert.strictEqual(parseNotebookRendererMessage({
    type: 'updateResultSetting',
    key: 'arrayDisplayFormat',
    value: 'unsafe',
  }), undefined);
  assert.deepStrictEqual(
    parseNotebookRendererMessage({ type: 'openLiveResult', liveId }),
    { type: 'openLiveResult', liveId }
  );

  const completeResultSettings = {
    cellWidth: 160,
    rowHeight: 28,
    fontSize: 0,
    density: 'standard',
    showRowIndex: true,
    elapsedTimeDisplay: 'auto',
    chartDecimalPlaces: 4,
    chartMaxSourceRows: 2_000_000,
    qTextSyntaxHighlighting: false,
    qTextDisplayFormatting: false,
    arrayDisplayFormat: 'commaSpace',
    functionDisplayStrategy: 'qText',
    dictionaryDisplayStrategy: 'grid',
    listDisplayStrategy: 'grid',
    objectDisplayStrategy: 'grid',
  };
  const completeSettingsMessage = notebookRendererSettingsMessage({
    presentation: 'inline',
    rowLimit: DEFAULT_NOTEBOOK_ROW_LIMIT,
    byteLimit: DEFAULT_NOTEBOOK_BYTE_LIMIT,
  }, completeResultSettings);
  assert.deepStrictEqual(
    parseNotebookRendererHostMessage(completeSettingsMessage),
    completeSettingsMessage,
    'shared durable KX result settings must survive the validated host-to-renderer path'
  );
  assert.deepStrictEqual(parseNotebookRendererHostMessage({
    type: 'liveResult',
    liveId,
    requestId: 5,
    available: true,
    mode: 'table',
    kind: 'table',
    columns: ['sym', 'price'],
    rowCount: 1_000_000,
    metadata: {
      query: 'select from trade',
      connectionName: 'Local q • Direct IPC • .analytics',
      elapsedMs: 12,
      messages: ['Full live table.'],
    },
  }), {
    type: 'liveResult',
    liveId,
    requestId: 5,
    available: true,
    mode: 'table',
    kind: 'table',
    columns: ['sym', 'price'],
    rowCount: 1_000_000,
    metadata: {
      query: 'select from trade',
      connectionName: 'Local q • Direct IPC • .analytics',
      elapsedMs: 12,
      messages: ['Full live table.'],
    },
  });
  const validSliceMessage = {
    type: 'liveSlice',
    liveId,
    requestId: 6,
    startRow: 10,
    endRow: 11,
    startColumn: 0,
    endColumn: 1,
    cells: [['AAPL', '10'], ['MSFT', '20']],
  };
  assert.deepStrictEqual(
    parseNotebookRendererHostMessage(validSliceMessage),
    validSliceMessage
  );
  const oversizedSliceCells = [Array.from(
    { length: Math.floor(MAX_NOTEBOOK_LIVE_SLICE_TEXT_CHARS / 65_536) + 1 },
    () => 'x'.repeat(65_536)
  )];
  assert.strictEqual(parseNotebookRendererHostMessage({
    type: 'liveSlice',
    liveId,
    requestId: 7,
    startRow: 0,
    endRow: 0,
    startColumn: 0,
    endColumn: oversizedSliceCells[0].length - 1,
    cells: oversizedSliceCells,
  }), undefined, 'host messages must reject aggregate live slice text above the IPC ceiling');
  assert.deepStrictEqual(parseNotebookRendererHostMessage({
    type: 'liveSearch',
    liveId,
    requestId: 8,
    matches: [1, 9],
    totalScanned: 10,
    scannedCells: 20,
    capped: false,
    partial: false,
  }), {
    type: 'liveSearch',
    liveId,
    requestId: 8,
    matches: [1, 9],
    totalScanned: 10,
    scannedCells: 20,
    capped: false,
    partial: false,
  });
  assert.deepStrictEqual(parseNotebookRendererHostMessage({
    type: 'liveChart',
    liveId,
    requestId: 9,
    data: {
      chartType: 'line',
      xColumn: 'time',
      xKind: 'numeric',
      x: [1, 2],
      series: [{ columnName: 'price', values: [10, null] }],
    },
  }), {
    type: 'liveChart',
    liveId,
    requestId: 9,
    data: {
      chartType: 'line',
      xColumn: 'time',
      xKind: 'numeric',
      x: [1, 2],
      series: [{ columnName: 'price', values: [10, null] }],
    },
  });
  assert.strictEqual(parseNotebookRendererHostMessage({
    ...validSliceMessage,
    password: 'forbidden',
  }), undefined);

  const html = notebookResultStaticHtml(payload);
  assert.match(html, /Schema:/);
  assert.match(html, /Rows: 1000000/);
  assert.match(html, /persisted preview: 2/);
  assert.match(html, /Preview only/);
  assert.match(html, /<svg/);
  assert.match(html, /&lt;unsafe session&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(!html.includes('<img src=x'));
  const plain = notebookResultPlainText(payload);
  assert.match(plain, /KX\/q result/);
  assert.match(plain, /omitted full result is not stored/i);
  const csv = notebookResultToCsv(payload);
  assert.match(csv, /^sym,px,ts,note\n/);
  assert.ok(csv.includes('<img src=x onerror=alert(1)>'));

  const byteBounded = createPortableKxResult({
    columns: ['value'],
    rows: Array.from({ length: 500 }, (_, index) => [`${index}-${'x'.repeat(4000)}`]),
    rowCount: 500,
    rowLimit: 500,
    byteLimit: MIN_NOTEBOOK_BYTE_LIMIT,
  });
  assert.ok(byteBounded.result.previewRowCount < 500);
  assert.ok(byteBounded.result.truncationReasons.includes('byteLimit'));
  assert.ok(portableKxResultBytes(byteBounded) <= MIN_NOTEBOOK_BYTE_LIMIT);
  assert.strictEqual(validatePortableKxResult(byteBounded).ok, true);

  const sourcePreview = createPortableKxResult({
    columns: ['value'],
    rows: [[1], [2]],
    rowCount: 20,
    rowLimit: 1000,
    byteLimit: MIN_NOTEBOOK_BYTE_LIMIT,
  });
  assert.deepStrictEqual(sourcePreview.result.truncationReasons, ['sourcePreview']);
  assert.strictEqual(sourcePreview.result.previewRowCount, 2);
  assert.strictEqual(validatePortableKxResult(sourcePreview).ok, true);

  const sourceAndRowLimited = createPortableKxResult({
    columns: ['value'],
    rows: [[1], [2]],
    rowCount: 20,
    rowLimit: 10,
    byteLimit: MIN_NOTEBOOK_BYTE_LIMIT,
  });
  assert.deepStrictEqual(
    sourceAndRowLimited.result.truncationReasons,
    ['rowLimit', 'sourcePreview'],
    'a short source below a configured row cap must distinguish both truncation boundaries'
  );
  assert.strictEqual(validatePortableKxResult(sourceAndRowLimited).ok, true);

  const completeAccessorPreview = createPortableKxResult({
    columns: ['value'],
    rows: [],
    cellValue: rowIndex => rowIndex,
    rowCount: 20,
    rowLimit: 1000,
    byteLimit: MIN_NOTEBOOK_BYTE_LIMIT,
  });
  assert.deepStrictEqual(
    completeAccessorPreview.result.truncationReasons,
    [],
    'a complete lazy accessor must not be reported as a short source preview'
  );
  assert.strictEqual(completeAccessorPreview.result.previewRowCount, 20);
  assert.strictEqual(validatePortableKxResult(completeAccessorPreview).ok, true);

  let accessorReads = 0;
  const accessorColumns = Array.from({ length: 256 }, (_, index) => `c${index}`);
  const accessorBounded = createPortableKxResult({
    columns: accessorColumns,
    rows: [],
    cellValue(rowIndex, columnIndex) {
      accessorReads += 1;
      return rowIndex * accessorColumns.length + columnIndex;
    },
    rowCount: 10_000,
    rowLimit: 10_000,
    byteLimit: MIN_NOTEBOOK_BYTE_LIMIT,
    marker: 'direct-ipc',
  });
  assert.ok(
    accessorReads < 5_000,
    `the direct table accessor must stop near the byte budget, not materialize 2.56M cells (${accessorReads} reads)`
  );
  assert.ok(accessorBounded.result.truncationReasons.includes('byteLimit'));
  assert.ok(portableKxResultBytes(accessorBounded) <= MIN_NOTEBOOK_BYTE_LIMIT);
  assert.strictEqual(validatePortableKxResult(accessorBounded).ok, true);

  const clipped = createPortableKxResult({
    columns: ['duplicate', 'duplicate'],
    rows: [['x'.repeat(40000), 1]],
  });
  assert.deepStrictEqual(clipped.schema.columns.map(column => column.name), ['duplicate', 'duplicate_2']);
  assert.ok(clipped.result.truncationReasons.includes('cellValueLimit'));
  assert.strictEqual(validatePortableKxResult(clipped).ok, true);

  const extraField = JSON.parse(JSON.stringify(payload));
  extraField.credentials = { password: 'no' };
  assert.strictEqual(validatePortableKxResult(extraField).ok, false);
  const invalidCell = JSON.parse(JSON.stringify(payload));
  invalidCell.data.rows[0][1].value = Infinity;
  assert.strictEqual(validatePortableKxResult(invalidCell).ok, false);
  const invalidChart = JSON.parse(JSON.stringify(payload));
  invalidChart.chart.yColumns = ['missing'];
  assert.strictEqual(validatePortableKxResult(invalidChart).ok, false);
  const badCounts = JSON.parse(JSON.stringify(payload));
  badCounts.result.previewRowCount = 999;
  assert.strictEqual(validatePortableKxResult(badCounts).ok, false);
  const directPayload = createPortableKxResult({
    columns: ['value'],
    rows: [[42]],
    marker: 'direct-ipc',
    label: 'Notebook q • Direct IPC • .analytics',
  });
  assert.strictEqual(directPayload.provenance.marker, 'direct-ipc');
  assert.deepStrictEqual(
    validatePortableKxResult(directPayload),
    { ok: true, value: directPayload }
  );
  const invalidMarker = JSON.parse(JSON.stringify(directPayload));
  invalidMarker.provenance.marker = 'python-kernel-masquerade';
  assert.strictEqual(validatePortableKxResult(invalidMarker).ok, false);

  const rendererSource = fs.readFileSync(path.join(ROOT, 'renderer', 'index.ts'), 'utf8');
  assert.ok(rendererSource.includes("from 'uplot'"));
  assert.match(rendererSource, /buildChartData\(portableTable\(payload\)/);
  assert.match(rendererSource, /chartColumnOptions\(portableTable\(payload\)/);
  assert.match(rendererSource, /MAX_TABLE_PAGE_CELLS\s*=\s*5000/);
  assert.match(rendererSource, /Previous page/);
  assert.match(rendererSource, /Next page/);
  assert.match(rendererSource, /validatePortableKxResult\(raw\)/);
  assert.match(rendererSource, /context\.postMessage\?\.\(\{ type: 'ready' \}\)/);
  assert.match(rendererSource, /type: 'openPreview'/);
  assert.match(rendererSource, /textContent/);
  assert.ok(!/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write|\beval\s*\(/.test(rendererSource));
  const rendererBundlePath = path.join(ROOT, 'renderer', 'kx-notebook-renderer.js');
  assert.ok(fs.existsSync(rendererBundlePath));
  const rendererBundle = fs.readFileSync(rendererBundlePath, 'utf8');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function|https?:\/\//.test(rendererBundle));
}

function testLiveNotebookResultStore() {
  const {
    liveNotebookDisplayOptions,
    liveResultMessage,
    liveSliceMessage,
  } = requireOutWithMocks('notebook-integration', {
    vscode: createVscodeRuntimeMock(),
  });
  let nextId = 0;
  const idFactory = () => `live-result-${String(++nextId).padStart(24, '0')}`;
  const store = new LiveNotebookResultStore(32, idFactory);
  const notebookUri = 'file:///workspace/analysis.ipynb';
  const otherNotebookUri = 'file:///workspace/other.ipynb';

  const baseId = store.register({
    notebookUri,
    cellUri: 'vscode-notebook-cell:///analysis/0',
    query: 'select from trade',
    connectionName: 'Local q • Direct IPC • .analytics',
    elapsedMs: 12,
    value: modelQTable(
      ['n', 'name', 'values'],
      [
        { n: 3, name: 'gamma', values: [3, 4] },
        { n: 1, name: 'alpha hit', values: [1, 2] },
        { n: 2, name: 'beta hit', values: [2, 3] },
      ]
    ),
  });
  assert.strictEqual(store.has(baseId, notebookUri), true);
  assert.strictEqual(store.has(baseId, otherNotebookUri), false);
  assert.strictEqual(store.view(baseId, otherNotebookUri), undefined);
  const baseView = store.view(baseId, notebookUri);
  assert.strictEqual(baseView.mode, 'table');
  assert.strictEqual(baseView.rowCount, 3);
  assert.deepStrictEqual(baseView.columns, ['n', 'name', 'values']);
  assert.strictEqual(baseView.query, 'select from trade');
  assert.strictEqual(baseView.connectionName, 'Local q • Direct IPC • .analytics');
  const hostDisplayOptions = liveNotebookDisplayOptions({
    arrayDisplayFormat: 'commaSpace',
    functionDisplayStrategy: 'qText',
    dictionaryDisplayStrategy: 'grid',
    listDisplayStrategy: 'grid',
    objectDisplayStrategy: 'grid',
  });
  const hostLiveResult = liveResultMessage(
    store,
    notebookUri,
    baseId,
    1,
    hostDisplayOptions
  );
  assert.strictEqual(parseNotebookRendererHostMessage(hostLiveResult).available, true);
  assert.strictEqual(hostLiveResult.rowCount, 3);
  assert.deepStrictEqual(hostLiveResult.columns, ['n', 'name', 'values']);
  const hostLiveSlice = liveSliceMessage(
    store,
    notebookUri,
    {
      type: 'requestLiveSlice',
      liveId: baseId,
      requestId: 2,
      startRow: 0,
      endRow: 1,
      startColumn: 0,
      endColumn: 2,
    },
    hostDisplayOptions
  );
  assert.deepStrictEqual(
    parseNotebookRendererHostMessage(hostLiveSlice),
    hostLiveSlice,
    'the extension-host live slice helper must emit the renderer-validated bounded contract'
  );
  assert.strictEqual(
    liveResultMessage(
      { view() { throw new Error('conversion detail must stay local'); } },
      notebookUri,
      baseId,
      3,
      hostDisplayOptions
    ).available,
    false,
    'live conversion failures must produce a terminal saved-snapshot response'
  );

  const sortedSlice = store.slice(baseId, notebookUri, {
    startRow: 0,
    endRow: 1,
    startColumn: 0,
    endColumn: 2,
    sortColumn: 'n',
    sortDirection: 'asc',
  });
  assert.deepStrictEqual(sortedSlice.cells, [
    ['1', 'alpha hit', '1, 2'],
    ['2', 'beta hit', '2, 3'],
  ]);
  assert.deepStrictEqual(
    store.slice(baseId, notebookUri, {
      startRow: 0,
      endRow: 0,
      startColumn: 2,
      endColumn: 2,
    }, { arrayDisplayFormat: 'space' }).cells,
    [['3 4']],
    'live slice formatting must follow the shared array display option'
  );
  const sortedSearch = store.search(
    baseId,
    notebookUri,
    'HIT',
    {},
    { sortColumn: 'n', sortDirection: 'asc' }
  );
  assert.deepStrictEqual(sortedSearch.matches, [0, 1]);
  assert.strictEqual(sortedSearch.totalScanned, 3);
  assert.strictEqual(sortedSearch.partial, false);
  assert.deepStrictEqual(
    store.search(baseId, notebookUri, '\0', {}),
    { matches: [], totalScanned: 0, scannedCells: 0, capped: false, partial: false }
  );

  const wideColumns = Array.from(
    { length: MAX_LIVE_NOTEBOOK_SLICE_COLUMNS + 22 },
    (_, index) => `c${index}`
  );
  const wideRows = Array.from(
    { length: MAX_LIVE_NOTEBOOK_SLICE_ROWS + 100 },
    (_, rowIndex) => Object.fromEntries(wideColumns.map((column, columnIndex) =>
      [column, rowIndex * wideColumns.length + columnIndex]))
  );
  const wideId = store.register({
    notebookUri,
    cellUri: 'vscode-notebook-cell:///analysis/1',
    query: 'wideTable',
    connectionName: 'Local q',
    elapsedMs: 20,
    value: modelQTable(wideColumns, wideRows),
  });
  const boundedSlice = store.slice(wideId, notebookUri, {
    startRow: 0,
    endRow: Number.MAX_SAFE_INTEGER,
    startColumn: 0,
    endColumn: Number.MAX_SAFE_INTEGER,
  });
  assert.strictEqual(boundedSlice.cells.length, MAX_LIVE_NOTEBOOK_SLICE_ROWS);
  assert.ok(boundedSlice.cells[0].length <= MAX_LIVE_NOTEBOOK_SLICE_COLUMNS);
  assert.ok(
    boundedSlice.cells.length * boundedSlice.cells[0].length <= MAX_LIVE_NOTEBOOK_SLICE_CELLS,
    'live viewport responses must enforce the row/column/cell ceilings together'
  );
  assert.strictEqual(
    MAX_LIVE_NOTEBOOK_SLICE_TEXT_CHARS,
    MAX_NOTEBOOK_LIVE_SLICE_TEXT_CHARS,
    'the live store and renderer message validator must share one aggregate text ceiling'
  );

  const largeCell = 'x'.repeat(10_000);
  const aggregateColumns = Array.from({ length: 100 }, (_, index) => `value${index}`);
  const aggregateRows = Array.from({ length: 200 }, () =>
    Object.fromEntries(aggregateColumns.map(column => [column, largeCell])));
  const aggregateId = store.register({
    notebookUri,
    cellUri: 'vscode-notebook-cell:///analysis/aggregate',
    query: 'largeCells',
    connectionName: 'Local q',
    elapsedMs: 20,
    value: modelQTable(aggregateColumns, aggregateRows),
  });
  const aggregateSlice = store.slice(aggregateId, notebookUri, {
    startRow: 0,
    endRow: 199,
    startColumn: 0,
    endColumn: 99,
  });
  const aggregateTextChars = aggregateSlice.cells.reduce(
    (total, row) => total + row.reduce((rowTotal, value) => rowTotal + value.length, 0),
    0
  );
  assert.ok(aggregateTextChars <= MAX_LIVE_NOTEBOOK_SLICE_TEXT_CHARS);
  assert.match(aggregateSlice.cells[0][0], /truncated for live slice response/i);

  for (let index = 0; index < MAX_LIVE_NOTEBOOK_SORT_CACHE_ENTRIES + 3; index++) {
    store.slice(wideId, notebookUri, {
      startRow: 0,
      endRow: 1,
      startColumn: 0,
      endColumn: 2,
      sortColumn: wideColumns[index],
      sortDirection: index % 2 === 0 ? 'asc' : 'desc',
    });
  }
  assert.ok(
    store.records.get(wideId).sortOrders.size <= MAX_LIVE_NOTEBOOK_SORT_CACHE_ENTRIES,
    'each live result must retain only the bounded LRU of full row-order arrays'
  );
  assert.strictEqual(
    boundedSlice.endRow - boundedSlice.startRow + 1,
    boundedSlice.cells.length
  );
  assert.strictEqual(
    boundedSlice.endColumn - boundedSlice.startColumn + 1,
    boundedSlice.cells[0].length
  );

  const searchCapId = store.register({
    notebookUri,
    cellUri: 'vscode-notebook-cell:///analysis/2',
    query: 'manyMatches',
    connectionName: 'Local q',
    elapsedMs: 1,
    value: modelQTable(
      ['value'],
      Array.from(
        { length: MAX_LIVE_NOTEBOOK_SEARCH_MATCHES + 25 },
        (_, index) => ({ value: `match-${index}` })
      )
    ),
  });
  const cappedSearch = store.search(searchCapId, notebookUri, 'match');
  assert.strictEqual(cappedSearch.matches.length, MAX_LIVE_NOTEBOOK_SEARCH_MATCHES);
  assert.strictEqual(cappedSearch.capped, true);
  assert.strictEqual(cappedSearch.partial, true);
  assert.ok(cappedSearch.scannedCells <= MAX_LIVE_NOTEBOOK_SEARCH_MATCHES);

  const chartRows = Array.from({ length: 120 }, (_, index) => ({
    time: index,
    price: index * 2,
  }));
  const chartId = store.register({
    notebookUri,
    cellUri: 'vscode-notebook-cell:///analysis/3',
    query: 'chartSource',
    connectionName: 'Local q',
    elapsedMs: 3,
    value: modelQTable(['time', 'price'], chartRows),
  });
  const chart = store.chart(chartId, notebookUri, {
    requestId: 7,
    chartType: 'line',
    xColumn: 'time',
    yColumns: ['price'],
    maxPoints: 20,
    maxSourceRows: 120,
  });
  assert.strictEqual(chart.requestId, 7);
  assert.strictEqual(chart.chartType, 'line');
  assert.strictEqual(chart.sourceRowCount, 120);
  assert.ok(chart.sampledPointCount <= 20);
  assert.deepStrictEqual(chart.series.map(series => series.columnName), ['price']);
  assert.strictEqual(store.chart(chartId, otherNotebookUri, {
    requestId: 1,
    chartType: 'line',
    xColumn: 'time',
    yColumns: ['price'],
    maxPoints: 10,
  }), undefined);

  const dictionary = {
    qtype: 'dict',
    keys: ['a', 'b'],
    values: [1, 2],
    entries: [
      { key: 'a', value: 1 },
      { key: 'b', value: 2 },
    ],
  };
  const dictionaryId = store.register({
    notebookUri,
    cellUri: 'vscode-notebook-cell:///analysis/4',
    query: 'dictionary',
    connectionName: 'Local q',
    elapsedMs: 2,
    value: dictionary,
  });
  assert.strictEqual(
    store.view(dictionaryId, notebookUri, { dictionaryDisplayStrategy: 'grid' }).mode,
    'table'
  );
  const dictionaryText = store.view(
    dictionaryId,
    notebookUri,
    { dictionaryDisplayStrategy: 'qText' }
  );
  assert.strictEqual(dictionaryText.mode, 'text');
  assert.match(dictionaryText.text, /a/);
  assert.strictEqual(
    store.view(dictionaryId, notebookUri, { dictionaryDisplayStrategy: 'grid' }).mode,
    'table',
    'changing a shared display strategy must recompute the cached live view'
  );
  assert.strictEqual(
    store.slice(
      dictionaryId,
      notebookUri,
      { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 },
      { dictionaryDisplayStrategy: 'qText' }
    ),
    undefined,
    'qText live views must not masquerade as grid slices'
  );

  const replacementId = store.register({
    notebookUri,
    cellUri: 'vscode-notebook-cell:///analysis/0',
    query: 'replacement',
    connectionName: 'Local q',
    elapsedMs: 1,
    value: 42,
  });
  assert.strictEqual(store.has(baseId, notebookUri), false);
  assert.strictEqual(store.has(replacementId, notebookUri), true);
  const newSessionStore = new LiveNotebookResultStore(
    32,
    () => 'other-session-result-0000000000000001'
  );
  assert.strictEqual(
    newSessionStore.has(replacementId, notebookUri),
    false,
    'live result identifiers are valid only inside the owning extension-host session'
  );

  let evictionId = 0;
  const evictionStore = new LiveNotebookResultStore(
    2,
    () => `eviction-result-${String(++evictionId).padStart(20, '0')}`
  );
  const evicted = evictionStore.register(liveRegistration('file:///one.ipynb', 'cell:///1', 1));
  const retainedOne = evictionStore.register(liveRegistration('file:///one.ipynb', 'cell:///2', 2));
  const retainedTwo = evictionStore.register(liveRegistration('file:///two.ipynb', 'cell:///3', 3));
  assert.strictEqual(evictionStore.has(evicted, 'file:///one.ipynb'), false);
  assert.strictEqual(evictionStore.has(retainedOne, 'file:///one.ipynb'), true);
  assert.strictEqual(evictionStore.has(retainedTwo, 'file:///two.ipynb'), true);
  evictionStore.closeNotebook('file:///one.ipynb');
  assert.strictEqual(evictionStore.has(retainedOne, 'file:///one.ipynb'), false);
  assert.strictEqual(evictionStore.has(retainedTwo, 'file:///two.ipynb'), true);
  evictionStore.removeCell('file:///two.ipynb', 'cell:///3');
  assert.strictEqual(evictionStore.has(retainedTwo, 'file:///two.ipynb'), false);
  const cleared = evictionStore.register(liveRegistration('file:///two.ipynb', 'cell:///4', 4));
  evictionStore.clear();
  assert.strictEqual(evictionStore.has(cleared, 'file:///two.ipynb'), false);
}

function liveRegistration(notebookUri, cellUri, value) {
  return {
    notebookUri,
    cellUri,
    query: String(value),
    connectionName: 'Local q',
    elapsedMs: 1,
    value,
  };
}

async function testDirectQNotebookController() {
  const runtime = createNotebookControllerRuntime();
  const {
    KX_NOTEBOOK_LIVE_METADATA_KEY,
    KX_Q_NOTEBOOK_CONTROLLER_ID,
    KX_Q_NOTEBOOK_CONTROLLER_LABEL,
    KX_Q_NOTEBOOK_TYPE,
    KxQNotebookController,
  } = requireOutWithMocks('notebook-controller', { vscode: runtime.vscode });
  let liveId = 0;
  const liveResults = new LiveNotebookResultStore(
    64,
    () => `controller-live-${String(++liveId).padStart(24, '0')}`
  );
  const bridge = createDirectQNotebookBridgeHarness();
  const directController = new KxQNotebookController(bridge, liveResults);

  assert.strictEqual(runtime.controllers.length, 1);
  const registered = runtime.controllers[0];
  assert.strictEqual(registered.id, KX_Q_NOTEBOOK_CONTROLLER_ID);
  assert.strictEqual(registered.id, 'vscode-kdb.q-notebook-controller');
  assert.strictEqual(registered.notebookType, KX_Q_NOTEBOOK_TYPE);
  assert.strictEqual(registered.notebookType, 'jupyter-notebook');
  assert.strictEqual(registered.label, KX_Q_NOTEBOOK_CONTROLLER_LABEL);
  assert.strictEqual(registered.label, 'KX q (Direct IPC)');
  assert.deepStrictEqual(registered.supportedLanguages, ['q']);
  assert.strictEqual(registered.supportsExecutionOrder, true);
  assert.strictEqual(registered.description, 'Direct IPC');
  assert.match(registered.detail, /No active KX connection/);
  assert.match(registered.detail, /KX Connections view/);

  const connection = {
    id: 'kx-notebook',
    name: 'Notebook q',
    host: '127.0.0.1',
    port: 5001,
    database: '.analytics',
    username: '',
  };
  bridge.connection = connection;
  bridge.connected = false;
  bridge.fireState();
  assert.strictEqual(registered.description, 'Direct IPC • Notebook q');
  assert.match(registered.detail, /Direct IPC/);
  assert.match(registered.detail, /Notebook q/);
  assert.match(registered.detail, /127\.0\.0\.1:5001/);
  assert.match(registered.detail, /namespace \.analytics/);
  assert.match(registered.detail, /disconnected; connects on Run while this controller is selected/);
  bridge.connected = true;
  bridge.fireState();
  assert.match(registered.detail, /connected/);

  const notebook = runtime.notebook('file:///workspace/native-q.ipynb');
  let selectionEvents = 0;
  const selectionSubscription = directController.onDidChangeSelection(() => selectionEvents++);
  registered.selectionEmitter.fire({ notebook, selected: true });
  assert.strictEqual(directController.isSelected(notebook), true);
  assert.strictEqual(selectionEvents, 1);
  registered.selectionEmitter.fire({ notebook, selected: false });
  assert.strictEqual(directController.isSelected(notebook), false);
  assert.strictEqual(selectionEvents, 2);
  const deselectedCell = runtime.cell({
    languageId: 'q',
    source: '1+1',
    uri: 'vscode-notebook-cell:///native-q/deselected',
  });
  await registered.executeHandler([deselectedCell], notebook, registered);
  assert.strictEqual(bridge.calls.length, 0);
  assert.match(
    notebookErrorText(runtime.executionFor(deselectedCell).output),
    /Select KX q \(Direct IPC\).*kernel\/controller picker/i
  );
  const selectionEventsBeforeReselect = selectionEvents;
  registered.selectionEmitter.fire({ notebook, selected: true });
  assert.strictEqual(directController.isSelected(notebook), true);
  assert.strictEqual(selectionEvents, selectionEventsBeforeReselect + 1);

  const markdownCell = runtime.cell({
    kind: runtime.vscode.NotebookCellKind.Markup,
    languageId: 'markdown',
    source: '# title',
    uri: 'vscode-notebook-cell:///native-q/0',
  });
  const pythonCell = runtime.cell({
    languageId: 'python',
    source: 'print("not q")',
    uri: 'vscode-notebook-cell:///native-q/1',
  });
  const fullSource = 'a:41\n/ preserve the complete cell\na+1';
  const qCell = runtime.cell({
    languageId: 'q',
    source: fullSource,
    uri: 'vscode-notebook-cell:///native-q/2',
  });
  bridge.executeImpl = async (_connection, _source, onIssued) => {
    onIssued();
    return modelQTable(
      ['sym', 'size'],
      [
        { sym: 'AAPL', size: 100 },
        { sym: 'MSFT', size: 200 },
        { sym: 'IBM', size: 300 },
      ]
    );
  };
  await registered.executeHandler([markdownCell, pythonCell, qCell], notebook, registered);
  assert.strictEqual(
    runtime.executions.filter(execution => execution.cell === markdownCell).length,
    0,
    'Markdown cells must not create or dispatch a q execution'
  );
  const pythonExecution = runtime.executionFor(pythonCell);
  assert.ok(pythonExecution);
  assert.strictEqual(bridge.calls.length, 1, 'non-q code cells must never reach direct IPC');
  assert.match(notebookErrorText(pythonExecution.output), /supports q code cells only/);
  assert.match(notebookErrorText(pythonExecution.output), /'python'/);
  assert.deepStrictEqual(pythonExecution.endCalls.map(call => call.success), [false]);

  const qExecution = runtime.executionFor(qCell);
  assert.ok(qExecution);
  assert.strictEqual(bridge.calls[0].connection, connection);
  assert.strictEqual(bridge.calls[0].source, fullSource);
  assert.ok(bridge.calls[0].signal instanceof AbortSignal);
  assert.strictEqual(qExecution.startCalls.length, 1);
  assert.strictEqual(qExecution.clearOutputCalls, 1);
  assert.deepStrictEqual(qExecution.endCalls.map(call => call.success), [true]);
  const tableOutput = qExecution.output;
  assert.ok(tableOutput instanceof runtime.vscode.NotebookCellOutput);
  const portableTableItem = notebookOutputItem(tableOutput, KX_NOTEBOOK_MIME);
  assert.ok(portableTableItem);
  assert.strictEqual(portableTableItem.value.provenance.marker, 'direct-ipc');
  assert.strictEqual(
    portableTableItem.value.provenance.qSource,
    undefined,
    'the bounded output need not duplicate cell source into persisted provenance'
  );
  assert.strictEqual(portableTableItem.value.result.rowCount, 3);
  assert.strictEqual(
    portableTableItem.value.data.rows.length,
    2,
    'the persisted MIME snapshot must obey the configured notebook row limit'
  );
  assert.ok(notebookOutputItem(tableOutput, 'text/plain'));
  const liveMetadata = tableOutput.metadata[KX_NOTEBOOK_LIVE_METADATA_KEY];
  assert.strictEqual(liveMetadata.version, 1);
  assert.match(liveMetadata.id, /^[A-Za-z0-9_-]{32,128}$/);
  const liveTable = liveResults.view(liveMetadata.id, notebook.uri.toString());
  assert.strictEqual(liveTable.rowCount, 3);
  assert.strictEqual(liveTable.query, fullSource);
  assert.deepStrictEqual(
    liveResults.slice(liveMetadata.id, notebook.uri.toString(), {
      startRow: 2,
      endRow: 2,
      startColumn: 0,
      endColumn: 1,
    }).cells,
    [['IBM', '300']],
    'the live registry must retain rows omitted from the bounded persisted snapshot'
  );
  assert.strictEqual(
    liveResults.has(liveMetadata.id, 'file:///workspace/unrelated.ipynb'),
    false,
    'live output metadata must remain scoped to its owning notebook'
  );

  bridge.connection = undefined;
  bridge.fireState();
  const noConnectionCell = runtime.cell({
    languageId: 'q',
    source: '1+1',
    uri: 'vscode-notebook-cell:///native-q/3',
  });
  const callsBeforeNoConnection = bridge.calls.length;
  await registered.executeHandler([noConnectionCell], notebook, registered);
  const noConnectionExecution = runtime.executionFor(noConnectionCell);
  assert.strictEqual(bridge.calls.length, callsBeforeNoConnection);
  const noConnectionError = notebookErrorText(noConnectionExecution.output);
  assert.match(noConnectionError, /Add or select a KX connection/);
  assert.match(noConnectionError, /KX Connections view/);
  assert.deepStrictEqual(noConnectionExecution.endCalls.map(call => call.success), [false]);

  bridge.connection = connection;
  bridge.connected = true;
  bridge.fireState();
  const startupSecret = 'startup-password-must-not-leak';
  bridge.executeImpl = async () => {
    throw new Error(`password=${startupSecret}`);
  };
  bridge.errorImpl = async (error, target) => {
    bridge.errorTargets.push(target);
    return error.message.replace(startupSecret, '[redacted]');
  };
  const startupFailureCell = runtime.cell({
    languageId: 'q',
    source: 'connectThenRun[]',
    uri: 'vscode-notebook-cell:///native-q/startup-failure',
  });
  const callsBeforeStartupFailure = bridge.calls.length;
  await registered.executeHandler([startupFailureCell], notebook, registered);
  const startupFailureExecution = runtime.executionFor(startupFailureCell);
  assert.strictEqual(bridge.calls.length, callsBeforeStartupFailure + 1);
  assert.strictEqual(bridge.errorTargets.at(-1), connection);
  const startupFailureError = notebookErrorText(startupFailureExecution.output);
  assert.match(startupFailureError, /Direct IPC execution failed/i);
  assert.match(startupFailureError, /KX: Test Connection/i);
  assert.match(startupFailureError, /\[redacted\]/);
  assert.ok(!startupFailureError.includes(startupSecret));
  assert.strictEqual(notebookOutputItem(startupFailureExecution.output, KX_NOTEBOOK_MIME), undefined);
  assert.strictEqual(
    startupFailureExecution.output.metadata[KX_NOTEBOOK_LIVE_METADATA_KEY],
    undefined,
    'a startup failure must not allocate a live-result record'
  );
  assert.deepStrictEqual(startupFailureExecution.endCalls.map(call => call.success), [false]);

  bridge.errorImpl = async error => error instanceof Error ? error.message : String(error);
  bridge.executeImpl = async (_connection, _source, onIssued) => {
    onIssued();
    return 42;
  };
  const scalarCell = runtime.cell({
    languageId: 'q',
    source: '6*7',
    uri: 'vscode-notebook-cell:///native-q/4',
  });
  await registered.executeHandler([scalarCell], notebook, registered);
  const scalarExecution = runtime.executionFor(scalarCell);
  const scalarPayload = notebookOutputItem(scalarExecution.output, KX_NOTEBOOK_MIME).value;
  assert.deepStrictEqual(scalarPayload.schema.columns.map(column => column.name), ['value']);
  assert.strictEqual(scalarPayload.data.rows[0][0].value, 42);
  assert.deepStrictEqual(scalarExecution.endCalls.map(call => call.success), [true]);

  bridge.executeImpl = async (_connection, _source, onIssued) => {
    onIssued();
    return {
      qtype: 'function',
      functionType: 'lambda',
      ipcType: 100,
      source: '{x+y}',
    };
  };
  const qTextCell = runtime.cell({
    languageId: 'q',
    source: 'value f',
    uri: 'vscode-notebook-cell:///native-q/5',
  });
  await registered.executeHandler([qTextCell], notebook, registered);
  const qTextExecution = runtime.executionFor(qTextCell);
  const qTextPayload = notebookOutputItem(qTextExecution.output, KX_NOTEBOOK_MIME).value;
  assert.deepStrictEqual(qTextPayload.schema.columns.map(column => column.name), ['qText']);
  assert.strictEqual(qTextPayload.data.rows[0][0].value, '{x+y}');
  const qTextLiveId = qTextExecution.output.metadata[KX_NOTEBOOK_LIVE_METADATA_KEY].id;
  const qTextLiveView = liveResults.view(qTextLiveId, notebook.uri.toString(), {
    functionDisplayStrategy: 'qText',
  });
  assert.strictEqual(qTextLiveView.mode, 'text');
  assert.strictEqual(qTextLiveView.text, '{x+y}');

  const magicCell = runtime.cell({
    languageId: 'q',
    source: '%%q\n1+1',
    uri: 'vscode-notebook-cell:///native-q/magic',
  });
  const callsBeforeMagic = bridge.calls.length;
  await registered.executeHandler([magicCell], notebook, registered);
  const magicExecution = runtime.executionFor(magicCell);
  assert.strictEqual(bridge.calls.length, callsBeforeMagic);
  assert.match(notebookErrorText(magicExecution.output), /does not use %%q/i);
  assert.match(notebookErrorText(magicExecution.output), /select the Python controller/i);
  assert.deepStrictEqual(magicExecution.endCalls.map(call => call.success), [false]);

  const preCanceledCell = runtime.cell({
    languageId: 'q',
    source: 'neverSent[]',
    uri: 'vscode-notebook-cell:///native-q/6',
    preCanceled: true,
  });
  const callsBeforePreCancel = bridge.calls.length;
  await registered.executeHandler([preCanceledCell], notebook, registered);
  const preCanceledExecution = runtime.executionFor(preCanceledCell);
  assert.strictEqual(bridge.calls.length, callsBeforePreCancel);
  assert.deepStrictEqual(preCanceledExecution.endCalls.map(call => call.success), [undefined]);

  const issued = deferred();
  bridge.executeImpl = (_connection, _source, onIssued, signal) => {
    onIssued();
    issued.resolve(signal);
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('local wait canceled')), { once: true });
    });
  };
  const postCanceledCell = runtime.cell({
    languageId: 'q',
    source: 'longRunning[]',
    uri: 'vscode-notebook-cell:///native-q/7',
  });
  const postCanceledRun = registered.executeHandler(
    [postCanceledCell],
    notebook,
    registered
  );
  const dispatchedSignal = await assertCompletesWithin(
    'notebook controller query dispatch',
    () => issued.promise,
    1000
  );
  const postCanceledExecution = runtime.executionFor(postCanceledCell);
  postCanceledExecution.token.cancel();
  await assertCompletesWithin(
    'notebook controller post-dispatch cancellation',
    () => postCanceledRun,
    1000
  );
  assert.strictEqual(dispatchedSignal.aborted, true);
  assert.match(notebookTextOutput(postCanceledExecution.output), /server work already sent may continue/i);
  assert.deepStrictEqual(postCanceledExecution.endCalls.map(call => call.success), [undefined]);

  const privateSecret = 'notebook-password-must-not-leak';
  const replacementConnection = {
    ...connection,
    id: 'kx-other',
    name: 'Wrong later target',
    port: 5999,
    database: '.wrong',
  };
  bridge.executeImpl = async (_connection, _source, onIssued) => {
    onIssued();
    bridge.connection = replacementConnection;
    throw new Error(`password=${privateSecret}`);
  };
  bridge.errorImpl = async (error, target) => {
    bridge.errorTargets.push(target);
    return error.message.replace(privateSecret, '[redacted]');
  };
  const errorCell = runtime.cell({
    languageId: 'q',
    source: 'willFail[]',
    uri: 'vscode-notebook-cell:///native-q/8',
  });
  await registered.executeHandler([errorCell], notebook, registered);
  const errorExecution = runtime.executionFor(errorCell);
  const renderedError = notebookErrorText(errorExecution.output);
  assert.strictEqual(bridge.errorTargets.at(-1), connection);
  assert.match(renderedError, /selected active KX connection/);
  assert.ok(!renderedError.includes('Wrong later target'));
  assert.ok(!renderedError.includes('127.0.0.1:5999'));
  assert.ok(!renderedError.includes(privateSecret));
  assert.match(renderedError, /\[redacted\]/);
  assert.deepStrictEqual(errorExecution.endCalls.map(call => call.success), [false]);

  bridge.connection = connection;
  bridge.errorImpl = async error => error.message;
  const startFailureCell = runtime.cell({
    languageId: 'q',
    source: 'notStarted[]',
    uri: 'vscode-notebook-cell:///native-q/9',
    startThrows: true,
  });
  const callsBeforeStartFailure = bridge.calls.length;
  await registered.executeHandler([startFailureCell], notebook, registered);
  const startFailureExecution = runtime.executionFor(startFailureCell);
  assert.strictEqual(bridge.calls.length, callsBeforeStartFailure);
  assert.strictEqual(startFailureExecution.startCalls.length, 1);
  assert.strictEqual(
    startFailureExecution.endCalls.length,
    1,
    'execution finalization must happen exactly once even when start throws'
  );

  for (const execution of runtime.executions) {
    assert.strictEqual(
      execution.endCalls.length,
      1,
      `cell ${execution.cell.document.uri.toString()} must be finalized exactly once`
    );
  }

  selectionSubscription.dispose();
  directController.dispose();
  directController.dispose();
  assert.strictEqual(registered.disposeCalls, 1);
  assert.strictEqual(bridge.stateSubscriptionDisposals, 1);
  assert.strictEqual(registered.selectionEmitter.listenerCount, 0);
  assert.strictEqual(directController.isSelected(notebook), false);
}

function testManifestAndSources() {
  const manifestPath = path.join(ROOT, 'package.json');
  assert.ok(fs.existsSync(manifestPath), 'package.json is missing; run this test after the extension scaffold is present');
  const manifestSource = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestSource);

  assert.strictEqual(manifest.name, 'vscode-kdb');
  assert.strictEqual(manifest.displayName, 'KX for VS Code');
  assert.strictEqual(manifest.publisher, 'DanielAlonso');
  assert.strictEqual(manifest.version, '0.2.3');
  const packageLock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  assert.strictEqual(packageLock.version, '0.2.3');
  assert.strictEqual(packageLock.packages[''].version, '0.2.3');
  const pythonNotebookPyproject = fs.readFileSync(
    path.join(ROOT, 'python', 'kx_notebook', 'pyproject.toml'),
    'utf8'
  );
  assert.match(pythonNotebookPyproject, /^version = "0\.2\.3"$/m);
  assert.strictEqual(manifest.icon, 'icons/kx-marketplace.png');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(manifest, 'files'), false, 'package via .vscodeignore, not files');
  assert.ok(!manifest.extensionDependencies || manifest.extensionDependencies.length === 0);
  assert.ok(!/@sqltools\//i.test(manifestSource), 'package.json must not reference @sqltools packages');
  assert.ok(!/sqltools\.connections/i.test(manifestSource), 'package.json must not contribute legacy connection settings');

  const dependencies = {
    ...(manifest.dependencies || {}),
    ...(manifest.devDependencies || {}),
  };
  assert.strictEqual(Object.keys(dependencies).some(name => /^@sqltools\//i.test(name)), false);

  const commands = (((manifest.contributes || {}).commands) || []);
  assert.strictEqual(commands.some(command => /^sqltools\./i.test(String(command.command || ''))), false);
  const commandTitles = new Set(commands.map(command => command.title));
  [
    'KX: Add Connection',
    'KX: Edit Connection',
    'KX: Remove Connection',
    'KX: Set Active Connection',
    'KX: Connect',
    'KX: Disconnect',
    'KX: Test Connection',
    'KX: Import SQLTools KDB Connections',
    'KX: Refresh Server Explorer',
    'KX: Preview Server Object',
    'KX Query History: Rerun Query',
    'KX Query History: Copy Query',
    'KX Query History: Insert into Active Editor',
    'KX Query History: Delete Entry',
    'KX: Clear Query History',
    'KX: Run Selection / Current Line',
    'KX: Run q Script',
    'KX: Run Selection in New Result',
    'KX: Set Notebook Cell Language to q',
    'KX: Restore Notebook Cell Language',
    'KX: Tag Notebook Cell as q',
    'Prepare this q cell for the active Python kernel',
    'KX: Open Saved Notebook Preview in Results Panel',
  ].forEach(title => assert.ok(commandTitles.has(title), `missing command contribution: ${title}`));

  const contributedCommandIds = new Set(commands.map(command => String(command.command)));
  const registeredCommandIds = new Set();
  for (const [, source] of sourcesFromDirectory(path.join(ROOT, 'src'))) {
    for (const match of source.matchAll(/registerCommand\(\s*['"]([^'"]+)['"]/g)) {
      registeredCommandIds.add(match[1]);
    }
  }
  assert.deepStrictEqual(
    [...registeredCommandIds].sort(),
    [...contributedCommandIds].sort(),
    'contributed and registered command IDs must match exactly'
  );
  const activatedCommandIds = new Set((manifest.activationEvents || [])
    .filter(event => String(event).startsWith('onCommand:'))
    .map(event => String(event).slice('onCommand:'.length)));
  assert.deepStrictEqual(
    [...activatedCommandIds].sort(),
    [...contributedCommandIds].sort(),
    'every command must have an explicit activation event'
  );
  assert.ok(
    manifest.activationEvents.includes('onRenderer:vscode-kdb.kx-notebook-renderer'),
    'renderer messaging must activate the extension host'
  );
  assert.ok(
    manifest.activationEvents.includes('onNotebook:jupyter-notebook'),
    'opening an ordinary Jupyter notebook must activate native KX controller registration'
  );

  const commandByTitle = Object.fromEntries(commands.map(command => [command.title, command.command]));
  const keybindings = ((manifest.contributes || {}).keybindings) || [];
  assertKeybinding(keybindings, commandByTitle['KX: Run Selection / Current Line'], 'ctrl+enter', 'cmd+enter');
  assertKeybinding(keybindings, commandByTitle['KX: Run q Script'], 'ctrl+alt+enter', 'cmd+alt+enter');
  assertKeybinding(keybindings, commandByTitle['KX: Run Selection in New Result'], 'ctrl+shift+enter', 'cmd+shift+enter');
  keybindings.forEach(binding => {
    assert.match(
      String(binding.when || ''),
      /!notebookEditorFocused/,
      `${binding.command} must not steal a Jupyter notebook execution keybinding`
    );
  });
  assert.strictEqual(keybindings.some(binding =>
    [
      'vscode-kdb.setNotebookCellLanguageQ',
      'vscode-kdb.restoreNotebookCellLanguage',
      'vscode-kdb.tagNotebookCellAsQ',
      'vscode-kdb.prepareNotebookCellForPythonKernel',
    ].includes(binding.command)
  ), false, 'notebook language/preparation commands must remain keyboard-discoverable without stealing Run');
  for (const commandId of [
    commandByTitle['KX: Run Selection / Current Line'],
    commandByTitle['KX: Run q Script'],
    commandByTitle['KX: Run Selection in New Result'],
  ]) {
    assert.ok(
      (((manifest.contributes || {}).menus || {}).commandPalette || []).some(item =>
        item.command === commandId && item.when === "notebookType != 'jupyter-notebook'"
      ),
      `${commandId} must be hidden from Command Palette while a notebook editor is focused`
    );
  }

  const contributions = manifest.contributes || {};
  const notebookRenderers = contributions.notebookRenderer || [];
  assert.strictEqual(notebookRenderers.length, 1);
  assert.deepStrictEqual(notebookRenderers[0], {
    id: 'vscode-kdb.kx-notebook-renderer',
    displayName: 'KX Notebook Result',
    entrypoint: './renderer/kx-notebook-renderer.js',
    mimeTypes: [KX_NOTEBOOK_MIME],
    requiresMessaging: 'optional',
  });
  assert.ok(fs.existsSync(path.join(ROOT, notebookRenderers[0].entrypoint)));
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(contributions, 'notebooks'),
    false,
    'NotebookController registration is dynamic; do not invent an unsupported manifest contribution'
  );
  const qLanguage = (contributions.languages || []).find(language => language.id === 'q');
  assert.ok(qLanguage, 'q must remain a registered VS Code language');
  assert.deepStrictEqual(
    Object.keys(qLanguage).sort(),
    ['aliases', 'configuration', 'extensions', 'id'],
    'do not invent a notebook-scoping language contribution unsupported by VS Code'
  );
  const qGrammarContribution = (contributions.grammars || [])
    .find(grammar => grammar.language === 'q');
  assert.ok(qGrammarContribution, 'q TextMate grammar contribution is missing');
  const qGrammar = JSON.parse(fs.readFileSync(
    path.join(ROOT, qGrammarContribution.path),
    'utf8'
  ));
  assert.strictEqual(qGrammar.patterns[0].include, '#notebookMagic');
  assert.strictEqual(
    qGrammar.repository.notebookMagic.patterns[0].name,
    'meta.preprocessor.notebook.magic.q'
  );
  assert.match(qGrammar.repository.notebookMagic.patterns[0].match, /^\\A/);
  assert.ok(
    qGrammar.patterns.some(pattern => pattern.include === '#keywords') &&
      qGrammar.patterns.some(pattern => pattern.include === '#builtins'),
    'the one-line %%q directive must retain normal q highlighting below it'
  );
  const activityContainers = (((contributions.viewsContainers || {}).activitybar) || []);
  assert.ok(activityContainers.some(container => container.title === 'KX' && container.icon === 'icons/kx-activity.png'));
  const viewGroups = Object.values(contributions.views || {}).flat();
  assert.ok(viewGroups.some(view => view && view.name === 'KX Connections'));
  const serverExplorerView = viewGroups.find(view => view && view.id === 'vscode-kdb.serverExplorer');
  assert.ok(serverExplorerView, 'KX Server Explorer view contribution is missing');
  assert.strictEqual(serverExplorerView.name, 'KX Server Explorer');
  assert.match(serverExplorerView.when, /config\.vscode-kdb\.features\.serverExplorer/);
  assert.match(serverExplorerView.when, /vscode-kdb\.serverExplorer\.available/);
  const queryHistoryView = viewGroups.find(view => view && view.id === 'vscode-kdb.queryHistory');
  assert.ok(queryHistoryView, 'KX Query History view contribution is missing');
  assert.strictEqual(queryHistoryView.name, 'KX Query History');
  assert.match(queryHistoryView.when, /config\.vscode-kdb\.features\.queryHistory/);

  const commandById = Object.fromEntries(commands.map(command => [command.command, command]));
  assert.deepStrictEqual(commandById['vscode-kdb.setNotebookCellLanguageQ'], {
    command: 'vscode-kdb.setNotebookCellLanguageQ',
    title: 'KX: Set Notebook Cell Language to q',
    icon: '$(symbol-keyword)',
    enablement: "notebookType == 'jupyter-notebook'",
  });
  assert.strictEqual(
    commandById['vscode-kdb.restoreNotebookCellLanguage'].title,
    'KX: Restore Notebook Cell Language'
  );
  assert.strictEqual(
    commandById['vscode-kdb.prepareNotebookCellForPythonKernel'].title,
    'Prepare this q cell for the active Python kernel'
  );
  const serverCommandIds = [
    'vscode-kdb.refreshServerExplorer',
    'vscode-kdb.previewServerObject',
  ];
  const historyCommandIds = [
    'vscode-kdb.rerunQueryHistoryEntry',
    'vscode-kdb.copyQueryHistoryEntry',
    'vscode-kdb.insertQueryHistoryEntry',
    'vscode-kdb.deleteQueryHistoryEntry',
    'vscode-kdb.clearQueryHistory',
  ];
  serverCommandIds.forEach(id => {
    assert.match(commandById[id].enablement, /config\.vscode-kdb\.features\.serverExplorer/);
    assert.match(commandById[id].enablement, /vscode-kdb\.serverExplorer\.available/);
  });
  historyCommandIds.forEach(id => {
    assert.match(commandById[id].enablement, /config\.vscode-kdb\.features\.queryHistory/);
  });
  const menus = contributions.menus || {};
  const allMenuItems = Object.values(menus).flat();
  const notebookCellTitleItems = menus['notebook/cell/title'] || [];
  const setQCellItems = notebookCellTitleItems.filter(item =>
    item.command === 'vscode-kdb.setNotebookCellLanguageQ'
  );
  assert.strictEqual(
    setQCellItems.length,
    1,
    'one notebook/cell/title entry must serve both the q toolbar button and cell context menu'
  );
  assert.match(setQCellItems[0].group, /^inline@/);
  assert.match(setQCellItems[0].when, /notebookType == 'jupyter-notebook'/);
  assert.match(setQCellItems[0].when, /notebookCellType == 'code'/);
  for (const id of [
    'vscode-kdb.restoreNotebookCellLanguage',
    'vscode-kdb.tagNotebookCellAsQ',
    'vscode-kdb.prepareNotebookCellForPythonKernel',
  ]) {
    const item = notebookCellTitleItems.find(candidate => candidate.command === id);
    assert.ok(item, `${id} must be available from the contextual notebook cell title menu`);
    assert.match(item.when, /notebookType == 'jupyter-notebook'/);
    assert.match(item.when, /notebookCellType == 'code'/);
  }
  const notebookPaletteCommandIds = new Set((menus.commandPalette || [])
    .filter(item => /NotebookCell|notebookCell/.test(String(item.command)))
    .map(item => item.command));
  for (const id of [
    'vscode-kdb.setNotebookCellLanguageQ',
    'vscode-kdb.restoreNotebookCellLanguage',
    'vscode-kdb.tagNotebookCellAsQ',
    'vscode-kdb.prepareNotebookCellForPythonKernel',
  ]) {
    assert.ok(notebookPaletteCommandIds.has(id), `${id} must be explicitly discoverable in Command Palette`);
    const command = commandById[id];
    const paletteItem = (menus.commandPalette || []).find(item => item.command === id);
    assert.ok(!String(command.enablement || '').includes('notebookEditorFocused'),
      `${id} enablement must survive Command Palette focus`);
    assert.ok(!String(paletteItem.when || '').includes('notebookEditorFocused'),
      `${id} palette visibility must survive Command Palette focus`);
  }
  assert.strictEqual(
    Object.keys(menus).some(menuId => menuId === 'notebook/cell/context'),
    false,
    'VS Code exposes notebook/cell/title for both toolbar and cell context; do not invent a menu id'
  );
  const importCommand = commandById['vscode-kdb.importSqlToolsConnections'];
  assert.ok(importCommand, 'SQLTools KDB migration command contribution is missing');
  assert.strictEqual(importCommand.title, 'KX: Import SQLTools KDB Connections');
  assert.ok(
    (menus['view/title'] || []).some(item =>
      item.command === 'vscode-kdb.importSqlToolsConnections' &&
      item.when === 'view == vscode-kdb.connections'),
    'migration command must be available from the KX Connections toolbar'
  );
  assert.ok(
    (menus['view/item/context'] || []).some(item =>
      item.command === 'vscode-kdb.importSqlToolsConnections' &&
      /vscode-kdb\.connections\.empty/.test(String(item.when || ''))),
    'migration command must be available from the empty KX Connections context'
  );
  assert.strictEqual(
    (menus.commandPalette || []).some(item =>
      item.command === 'vscode-kdb.importSqlToolsConnections' && item.when === 'false'),
    false,
    'migration command must remain discoverable in the Command Palette'
  );
  for (const id of [...serverCommandIds, ...historyCommandIds]) {
    const items = allMenuItems.filter(item => item.command === id);
    assert.ok(items.length > 0, `${id} must have an explicitly gated menu contribution`);
    items.forEach(item => {
      const when = String(item.when || '');
      const expectedFeature = serverCommandIds.includes(id) ? 'serverExplorer' : 'queryHistory';
      assert.ok(
        when === 'false' || when.includes(`config.vscode-kdb.features.${expectedFeature}`),
        `${id} menu item is not feature-gated: ${when}`
      );
    });
  }
  const previewContextItems = (menus['view/item/context'] || [])
    .filter(item => item.command === 'vscode-kdb.previewServerObject');
  assert.strictEqual(previewContextItems.length, 1);
  assert.ok(
    previewContextItems[0].when.includes('serverExplorer\\.object\\.(table|variable)$'),
    'Preview must be contributed only for table and variable tree contexts'
  );
  assert.ok(!previewContextItems[0].when.includes('function'));
  const paletteItems = (menus.commandPalette || []);
  assert.match(
    paletteItems.find(item => item.command === 'vscode-kdb.refreshServerExplorer').when,
    /serverExplorer\.available/
  );
  for (const itemOnlyId of [
    'vscode-kdb.previewServerObject',
    'vscode-kdb.rerunQueryHistoryEntry',
    'vscode-kdb.copyQueryHistoryEntry',
    'vscode-kdb.insertQueryHistoryEntry',
    'vscode-kdb.deleteQueryHistoryEntry',
  ]) {
    assert.strictEqual(
      paletteItems.find(item => item.command === itemOnlyId).when,
      'false',
      `${itemOnlyId} must not appear as a dead item-only command in the Command Palette`
    );
  }

  const configuration = Array.isArray(contributions.configuration)
    ? contributions.configuration
    : [contributions.configuration || {}];
  const configurationProperties = Object.assign({}, ...configuration.map(item => item.properties || {}));
  const notebookPresentation = configurationProperties['vscode-kdb.notebook.presentation'];
  assert.strictEqual(notebookPresentation.type, 'string');
  assert.strictEqual(notebookPresentation.scope, 'window');
  assert.strictEqual(notebookPresentation.default, 'inline');
  assert.deepStrictEqual(notebookPresentation.enum, ['inline', 'panel', 'both']);
  assert.match(notebookPresentation.description, /Direct-controller results/i);
  assert.match(notebookPresentation.description, /saved or reopened output is the bounded portable snapshot/i);
  assert.match(notebookPresentation.description, /cannot recover omitted rows/i);
  const notebookRowLimit = configurationProperties['vscode-kdb.notebook.maxOutputRows'];
  assert.strictEqual(notebookRowLimit.type, 'integer');
  assert.strictEqual(notebookRowLimit.default, DEFAULT_NOTEBOOK_ROW_LIMIT);
  assert.strictEqual(notebookRowLimit.minimum, MIN_NOTEBOOK_ROW_LIMIT);
  assert.strictEqual(notebookRowLimit.maximum, MAX_NOTEBOOK_ROW_LIMIT);
  assert.match(notebookRowLimit.description, /%%q/);
  assert.match(notebookRowLimit.description, /Direct IPC controller output/i);
  assert.match(notebookRowLimit.description, /in-memory result record/i);
  const notebookByteLimit = configurationProperties['vscode-kdb.notebook.maxOutputBytes'];
  assert.strictEqual(notebookByteLimit.type, 'integer');
  assert.strictEqual(notebookByteLimit.default, DEFAULT_NOTEBOOK_BYTE_LIMIT);
  assert.strictEqual(notebookByteLimit.minimum, MIN_NOTEBOOK_BYTE_LIMIT);
  assert.strictEqual(notebookByteLimit.maximum, MAX_NOTEBOOK_BYTE_LIMIT);
  assert.match(notebookByteLimit.description, /direct-controller output/i);
  assert.match(notebookByteLimit.description, /No credentials, connection objects, or recoverable IPC handles/i);
  const serverFeatureSetting = configurationProperties['vscode-kdb.features.serverExplorer'];
  assert.strictEqual(serverFeatureSetting.type, 'boolean');
  assert.strictEqual(serverFeatureSetting.scope, 'window');
  assert.strictEqual(serverFeatureSetting.default, false);
  assert.match(serverFeatureSetting.description, /Disabled by default/);
  assert.match(serverFeatureSetting.description, /active direct q IPC profile/i);
  assert.match(serverFeatureSetting.description, /disconnected state stays visible/i);
  assert.match(serverFeatureSetting.description, /only while connected/i);
  assert.match(serverFeatureSetting.description, /explicitly invoked|explicit/i);
  const historyFeatureSetting = configurationProperties['vscode-kdb.features.queryHistory'];
  assert.strictEqual(historyFeatureSetting.type, 'boolean');
  assert.strictEqual(historyFeatureSetting.scope, 'window');
  assert.strictEqual(historyFeatureSetting.default, false);
  assert.match(historyFeatureSetting.description, /Disabled by default/);
  assert.match(historyFeatureSetting.description, /local VS Code workspace extension storage/i);
  assert.match(historyFeatureSetting.description, /not sent as telemetry/i);
  assert.match(historyFeatureSetting.description, /not.*Settings Sync/i);
  const previewLimitSetting = configurationProperties['vscode-kdb.serverExplorer.previewCellLimit'];
  assert.strictEqual(previewLimitSetting.type, 'integer');
  assert.strictEqual(previewLimitSetting.scope, 'window');
  assert.strictEqual(previewLimitSetting.default, DEFAULT_SERVER_PREVIEW_CELL_LIMIT);
  assert.strictEqual(previewLimitSetting.minimum, MIN_SERVER_PREVIEW_CELL_LIMIT);
  assert.strictEqual(previewLimitSetting.maximum, MAX_SERVER_PREVIEW_CELL_LIMIT);
  assert.match(previewLimitSetting.description, /server-side .*preview cap/i);
  assert.match(previewLimitSetting.description, /explicit confirmation/i);
  assert.match(previewLimitSetting.description, /functions\/projections are metadata-only/i);
  const historyLimitSetting = configurationProperties['vscode-kdb.queryHistory.maxEntries'];
  assert.strictEqual(historyLimitSetting.type, 'integer');
  assert.strictEqual(historyLimitSetting.scope, 'window');
  assert.strictEqual(historyLimitSetting.default, DEFAULT_QUERY_HISTORY_MAX_ENTRIES);
  assert.strictEqual(historyLimitSetting.minimum, MIN_QUERY_HISTORY_MAX_ENTRIES);
  assert.strictEqual(historyLimitSetting.maximum, MAX_QUERY_HISTORY_MAX_ENTRIES);
  assert.match(historyLimitSetting.description, /local VS Code workspace extension storage/i);
  assert.match(historyLimitSetting.description, /Result payloads are never stored/i);
  assert.strictEqual(
    Object.keys(configurationProperties).some(key => /queryHistory\.(?:entries|queries|storage)/i.test(key)),
    false,
    'query text must not be persisted through syncable VS Code settings'
  );
  const connectionsSetting = configurationProperties['vscode-kdb.connections'];
  assert.ok(connectionsSetting, 'vscode-kdb.connections must be globally configurable');
  assert.strictEqual(connectionsSetting.type, 'array');
  const storedFields = Object.keys(((connectionsSetting.items || {}).properties) || {}).sort();
  assert.deepStrictEqual(
    storedFields,
    ['connectTimeoutMs', 'database', 'host', 'id', 'name', 'port', 'queryTimeoutMs', 'username']
  );
  assert.strictEqual(connectionsSetting.items.additionalProperties, false);
  assert.deepStrictEqual(
    [...connectionsSetting.items.required].sort(),
    ['database', 'host', 'id', 'name', 'port', 'username'],
    'timeout overrides must stay optional/blank-to-inherit'
  );
  assert.match(connectionsSetting.description, /direct q IPC/i);
  assert.match(connectionsSetting.description, /SecretStorage/);
  for (const timeoutField of ['connectTimeoutMs', 'queryTimeoutMs']) {
    const schema = connectionsSetting.items.properties[timeoutField];
    assert.strictEqual(schema.type, 'integer');
    assert.strictEqual(schema.minimum, 0);
    assert.strictEqual(schema.maximum, MAX_TIMEOUT_MS);
    assert.match(schema.description, /inherit the global default/i);
  }
  assert.match(connectionsSetting.items.properties.connectTimeoutMs.description, /handshake/i);
  assert.match(connectionsSetting.items.properties.connectTimeoutMs.description, /0 disables/i);
  assert.match(connectionsSetting.items.properties.queryTimeoutMs.description, /query/i);
  assert.match(connectionsSetting.items.properties.queryTimeoutMs.description, /0 disables/i);

  const connectTimeoutSetting = configurationProperties['vscode-kdb.connectionTimeoutMs'];
  assert.strictEqual(connectTimeoutSetting.type, 'integer');
  assert.strictEqual(connectTimeoutSetting.default, DEFAULT_CONNECTION_TIMEOUT_MS);
  assert.strictEqual(connectTimeoutSetting.minimum, 0);
  assert.strictEqual(connectTimeoutSetting.maximum, MAX_TIMEOUT_MS);
  assert.match(connectTimeoutSetting.description, /connect and handshake/i);
  assert.match(connectTimeoutSetting.description, /0 to disable/i);
  const queryTimeoutSetting = configurationProperties['vscode-kdb.queryTimeoutMs'];
  assert.deepStrictEqual(queryTimeoutSetting.type, ['integer', 'null']);
  assert.strictEqual(queryTimeoutSetting.default, null);
  assert.strictEqual(queryTimeoutSetting.minimum, 0);
  assert.strictEqual(queryTimeoutSetting.maximum, MAX_TIMEOUT_MS);
  assert.match(queryTimeoutSetting.description, /inherits connectionTimeoutMs/i);
  assert.match(queryTimeoutSetting.description, /0 disables/i);
  const performanceTraceSetting = configurationProperties['vscode-kdb.performance.trace'];
  assert.strictEqual(performanceTraceSetting.type, 'boolean');
  assert.strictEqual(performanceTraceSetting.default, false);
  assert.match(performanceTraceSetting.description, /Output > KX/);
  assert.match(performanceTraceSetting.description, /Query text and credentials are omitted/);
  const qTextSyntaxSetting = configurationProperties['vscode-kdb.results.qText.syntaxHighlighting'];
  assert.strictEqual(qTextSyntaxSetting.type, 'boolean');
  assert.strictEqual(qTextSyntaxSetting.default, false);
  assert.match(qTextSyntaxSetting.description, /result webviews only/i);
  assert.match(qTextSyntaxSetting.description, /theme colors/i);
  assert.match(qTextSyntaxSetting.description, /does not change q source-editor/i);
  const qTextFormattingSetting = configurationProperties['vscode-kdb.results.qText.displayFormatting'];
  assert.strictEqual(qTextFormattingSetting.type, 'boolean');
  assert.strictEqual(qTextFormattingSetting.default, false);
  assert.match(qTextFormattingSetting.description, /non-mutating display-only/i);
  assert.match(qTextFormattingSetting.description, /lambda, projection, and block/i);
  assert.match(qTextFormattingSetting.description, /unsupported, ambiguous, or malformed text is shown exactly as returned/i);
  assert.match(qTextFormattingSetting.description, /q is never evaluated/i);
  assert.strictEqual(Object.keys(configurationProperties).some(key => /^sqltools\./i.test(key)), false);

  const sourceFiles = walkFiles(path.join(ROOT, 'src')).filter(file => file.endsWith('.ts'));
  assert.ok(sourceFiles.length >= 5, 'expected standalone TypeScript implementation files');
  const sources = sourceFiles.map(file => [file, fs.readFileSync(file, 'utf8')]);
  const controllerSource = sources.find(([file]) => path.basename(file) === 'notebook-controller.ts');
  assert.ok(controllerSource, 'native q notebook controller source is missing');
  assert.match(controllerSource[1], /vscode\.notebooks\.createNotebookController\(/);
  assert.match(controllerSource[1], /supportedLanguages = \['q'\]/);
  assert.strictEqual(
    sources.some(([, source]) => /ms-toolsai\.jupyter|vscode-jupyter/.test(source)),
    false,
    'the public NotebookController must not intercept or import private Jupyter extension APIs'
  );
  assert.strictEqual(
    /ms-toolsai\.jupyter|vscode-jupyter/.test(manifestSource),
    false,
    'the native direct controller must not depend on the Jupyter extension'
  );
  sources.forEach(([file, source]) => {
    const label = path.relative(ROOT, file);
    if (path.basename(file) === 'connection-migration.ts') {
      assertSqlToolsMigrationBridgeSource(source, label);
    } else {
      assertNoSqlToolsRuntimeReference(source, label);
    }
    assertNoVscodeQRuntimeReference(source, label);
  });

  const lockPackagePaths = Object.keys(packageLock.packages || {});
  assert.strictEqual(
    lockPackagePaths.some(name => /node_modules\/(?:@sqltools(?:\/|$)|[^/]*vscode-q(?:\/|$))/i.test(name)),
    false,
    'package-lock.json must not contain SQLTools or vscode-q packages'
  );
  const forbiddenHeavyDependencies = /(?:ag-grid|plotly|perspective|shiki|prism|monaco|tree-sitter|language-server|vscode-languageclient)/i;
  assert.strictEqual(Object.keys(dependencies).some(name => forbiddenHeavyDependencies.test(name)), false);
  assert.strictEqual(
    Object.keys(dependencies).some(name => /notebook/i.test(name) && name !== '@types/vscode-notebook-renderer'),
    false,
    'do not add a broad notebook framework dependency'
  );

  const storeSource = readSource('connection-store.ts');
  assert.ok(/context\.secrets\.(store|get|delete)/.test(storeSource), 'passwords must use VS Code SecretStorage');
  const migrationSource = readSource('connection-migration.ts');
  const commandsSourceForMigration = readSource('connection-commands.ts');
  assert.match(
    commandsSourceForMigration,
    /registerCommand\(\s*'vscode-kdb\.importSqlToolsConnections'[\s\S]*?this\.migration\.run\(\)/
  );
  assert.ok(
    !/ConnectionManager/.test(migrationSource),
    'the one-shot settings bridge must not own SQLTools sessions or KX client lifecycle'
  );
  assert.ok(storeSource.includes('ConfigurationTarget.Global'), 'connections must use global settings');
  const safeBlock = sourceSection(storeSource, 'const safeConnections', 'await vscode.workspace');
  assert.ok(safeBlock.includes('username: connection.username'));
  assert.ok(safeBlock.includes('connectTimeoutMs: connection.connectTimeoutMs'));
  assert.ok(safeBlock.includes('queryTimeoutMs: connection.queryTimeoutMs'));
  assert.ok(!/password/i.test(safeBlock), 'serialized connection settings must never include passwords');
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(connectionsSetting.items.properties, 'password'),
    false,
    'password must never be a vscode-kdb.connections property'
  );

  const panelSource = readSource('connection-form-panel.ts');
  const commandsSource = readSource('connection-commands.ts');
  const modelSource = readSource('connection-form-model.ts');
  const managerSource = readSource('connection-manager.ts');
  const ipcSource = readSource('q-ipc.ts');
  const connectionTestSource = readSource('connection-test.ts');
  const extensionSource = readSource('extension.ts');
  const resultsPanelSource = readSource('kx-results-panel.ts');
  const featureControlsSource = readSource('feature-controls.ts');
  const serverExplorerSource = readSource('server-explorer.ts');
  const historySource = readSource('query-history.ts');
  const historyModelSource = readSource('query-history-model.ts');
  const notebookIntegrationSource = readSource('notebook-integration.ts');
  const notebookControllerSource = readSource('notebook-controller.ts');
  const liveNotebookResultsSource = readSource('notebook-live-results.ts');
  assert.match(extensionSource, /new KxQNotebookController\(/);
  assert.match(extensionSource, /directQNotebookBridge\(store, manager, tree\)/);
  assert.match(
    extensionSource,
    /context\.subscriptions\.push\([\s\S]*?notebookController,[\s\S]*?notebookIntegration/
  );
  assert.match(
    extensionSource,
    /manager\.executeScript\(connection, source, onIssued, signal\)/
  );
  assert.match(extensionSource, /activeConnection: \(\) => store\.activeConnection\(\)/);
  assert.match(extensionSource, /redactDiagnosticText\(message, secrets\)/);
  assert.match(extensionSource, /onDidCloseNotebookDocument\([\s\S]*?closeNotebook/);
  assert.match(notebookControllerSource, /cell\.document\.getText\(\)/);
  assert.match(notebookControllerSource, /cell\.document\.languageId !== 'q'/);
  assert.match(notebookControllerSource, /this\.liveResults\.register\(/);
  assert.match(liveNotebookResultsSource, /MAX_LIVE_NOTEBOOK_SLICE_CELLS/);
  assert.ok(!/ms-toolsai\.jupyter|vscode-jupyter/.test(
    `${extensionSource}\n${notebookControllerSource}\n${liveNotebookResultsSource}`
  ));
  assert.match(featureControlsSource, /context\.workspaceState/);
  assert.ok(
    !/context\.globalState/.test(`${featureControlsSource}\n${historySource}`),
    'query history must use workspace-local Memento storage'
  );
  assert.ok(!/ConfigurationTarget|\.update\([^)]*queryHistory/.test(historySource));
  assert.ok(!/sendTelemetry|createTelemetryLogger|TelemetryLogger|\bfetch\s*\(|XMLHttpRequest/.test(
    `${historySource}\n${historyModelSource}`
  ), 'query history must not transmit query contents or telemetry');
  assert.ok(!/createWebviewPanel|WebviewPanel|\.webview\b/.test(`${serverExplorerSource}\n${historySource}`));
  assert.ok(!/setInterval\s*\(/.test(serverExplorerSource), 'Server Explorer must remain manual-refresh by default');
  assert.match(serverExplorerSource, /executeInConfiguredNamespace/);
  assert.match(serverExplorerSource, /showWarningMessage\([\s\S]*?\{ modal: true \}[\s\S]*?'Preview'/);
  const serverPreviewSource = sourceSection(
    serverExplorerSource,
    'private async preview(',
    'export class ServerExplorerTreeProvider'
  );
  const initialPreviewResolveIndex = serverPreviewSource.indexOf(
    'const item = this.provider.resolveObject(argument)'
  );
  const previewModalIndex = serverPreviewSource.indexOf('const decision = await vscode.window.showWarningMessage(');
  const confirmedPreviewResolveIndex = serverPreviewSource.indexOf(
    'const confirmedItem = this.provider.resolveObject(item)'
  );
  const confirmedConnectionIndex = serverPreviewSource.indexOf(
    'this.provider.currentConnectionFor(confirmedItem.snapshot)'
  );
  const runPreviewIndex = serverPreviewSource.indexOf('await runPreview(');
  assert.ok(
    initialPreviewResolveIndex >= 0 && initialPreviewResolveIndex < previewModalIndex &&
      previewModalIndex < confirmedPreviewResolveIndex &&
      confirmedPreviewResolveIndex < confirmedConnectionIndex &&
      confirmedConnectionIndex < runPreviewIndex,
    'Preview approval must re-resolve the same owned generation and active namespace before any q preview is run'
  );
  assert.match(
    serverPreviewSource,
    /await runPreview\([\s\S]*?buildServerPreviewQuery\(confirmedItem\.objectName, confirmedItem\.kind, limit\)[\s\S]*?stillCurrent\.id/
  );
  assert.match(featureControlsSource, /get<boolean>\('serverExplorer', false\)/);
  assert.match(featureControlsSource, /get<boolean>\('queryHistory', false\)/);
  assert.match(featureControlsSource, /this\.serverExplorer\.dispose\(\)/);
  assert.match(featureControlsSource, /this\.queryHistory\.dispose\(\)/);
  assert.match(extensionSource, /historyKind: hasSelection \? 'selection' : 'line'/);
  assert.match(extensionSource, /historyKind: 'script'/);
  assert.match(extensionSource, /manager\.executeInConfiguredNamespace\(connection, text, onIssued\)/);
  assert.match(extensionSource, /uri\.scheme === 'vscode-notebook-cell'/);
  assert.match(
    extensionSource,
    /Prepare this q cell for the active Python kernel[\s\S]*?showInformationMessage\([\s\S]*?PREPARE_NOTEBOOK_CELL_FOR_PYTHON_COMMAND/
  );
  assert.match(
    extensionSource,
    /provideCodeLenses\(document: vscode\.TextDocument\)[\s\S]*?document\.uri\.scheme === 'vscode-notebook-cell'[\s\S]*?return \[\]/
  );
  assert.match(
    notebookIntegrationSource,
    /vscode\.languages\.setTextDocumentLanguage\(document, languageId\)/
  );
  assert.match(
    notebookIntegrationSource,
    /registerNotebookCellStatusBarItemProvider\([\s\S]*?'jupyter-notebook'/
  );
  assert.match(notebookIntegrationSource, /cell\.document\.languageId === 'q'/);
  assert.ok(
    !/ConnectionManager|executeQText|createNotebookController|q-ipc/.test(notebookIntegrationSource),
    'notebook language/preparation integration must not invoke direct q IPC or create a controller'
  );
  assert.match(extensionSource, /KxResultsPanel\.configurationChanged\(event\)/);
  assert.match(resultsPanelSource, /event\.affectsConfiguration\('vscode-kdb\.results'\)/);
  assert.match(resultsPanelSource, /qTextRenderModel\(this\.result\.text, qTextRenderOptions\(settings\)\)/);
  const copyQTextSource = sourceSection(resultsPanelSource, '  private async copyText(', '  private async exportText(');
  assert.match(copyQTextSource, /clipboard\.writeText\(this\.result\.text\)/);
  const exportQTextSource = sourceSection(resultsPanelSource, '  private async exportText(', '  private async confirmLargeCopyExport(');
  assert.match(exportQTextSource, /const text = this\.result\.text;/);
  assert.match(exportQTextSource, /Buffer\.from\(text, 'utf8'\)/);
  const executeQTextSource = sourceSection(
    extensionSource,
    'async function executeQText(',
    'function toPanelResult('
  );
  const targetSelectionIndex = executeQTextSource.indexOf('await activeConnectionForRun(store, manager)');
  const noTargetIndex = executeQTextSource.indexOf('if (!connection)');
  const rerunConfirmationIndex = executeQTextSource.indexOf('historyRerunRequiresConfirmation(');
  const latestTargetIndex = executeQTextSource.indexOf('const latestTarget = store.activeConnection()');
  const sameTargetIndex = executeQTextSource.indexOf('sameExecutionTarget(connection, latestTarget)');
  const resultsPanelIndex = executeQTextSource.indexOf('KxResultsPanel.showLoading(');
  const transportIssueIndex = executeQTextSource.indexOf('const executionPromise = request.transport');
  assert.ok(
    targetSelectionIndex >= 0 && targetSelectionIndex < noTargetIndex &&
      noTargetIndex < rerunConfirmationIndex && rerunConfirmationIndex < latestTargetIndex &&
      latestTargetIndex < sameTargetIndex && sameTargetIndex < resultsPanelIndex &&
      resultsPanelIndex < transportIssueIndex,
    'history reruns must select a target, confirm mismatches, then revalidate the exact target before panel creation or q issue'
  );
  assert.match(
    executeQTextSource,
    /historyRerunRequiresConfirmation\([\s\S]*?showWarningMessage\([\s\S]*?\{ modal: true \}[\s\S]*?'Rerun on Active Connection'/
  );
  assert.match(
    executeQTextSource,
    /if \(request\.recordedHistoryConnection\) \{[\s\S]*?store\.activeConnection\(\)[\s\S]*?sameExecutionTarget\(connection, latestTarget\)[\s\S]*?connection = latestTarget;/
  );
  const sameTargetSource = sourceSection(
    extensionSource,
    'function sameExecutionTarget(',
    'class QRunCodeLensProvider'
  );
  for (const field of ['id', 'host', 'port', 'database', 'username', 'connectTimeoutMs', 'queryTimeoutMs']) {
    assert.match(
      sameTargetSource,
      new RegExp(`left\\.${field} === right\\.${field}`),
      `history rerun target revalidation must include ${field}`
    );
  }
  const activeRunSource = sourceSection(
    extensionSource,
    'async function activeConnectionForRun(',
    'function updatePerfTraceSetting('
  );
  assert.match(activeRunSource, /const active = store\.activeConnection\(\);[\s\S]*?if \(active\) \{[\s\S]*?return active;/);
  assert.match(activeRunSource, /if \(!connections\.length\)[\s\S]*?return undefined;/);
  assert.match(
    activeRunSource,
    /let connection = connections\[0\];[\s\S]*?if \(connections\.length > 1\)[\s\S]*?setActiveConnection\(connection\.id\)/,
    'a sole configured but unrelated profile is selected as the target and still reaches the post-selection mismatch confirmation'
  );
  const historyRerunSource = sourceSection(historySource, 'private async rerun(', 'private async copy(');
  assert.match(historyRerunSource, /await runQuery\(entry\)/);
  assert.ok(!/Rerun on Active Connection|\{ modal: true \}/.test(historyRerunSource));
  assert.match(historySource, /connectionTree\.onDidChangeTreeData\(\(\) => this\.provider\.refresh\(\)\)/);

  const firstPartyCodeAndAssets = [
    path.join(ROOT, 'syntaxes', 'q.tmLanguage.json'),
    ...walkFiles(path.join(ROOT, 'icons')),
  ];
  firstPartyCodeAndAssets.forEach(file => {
    const content = fs.readFileSync(file).toString('latin1');
    assertNoVscodeQRuntimeReference(content, path.relative(ROOT, file));
    assertNoSqlToolsRuntimeReference(content, path.relative(ROOT, file));
    assert.ok(!/jshinonome/i.test(content), `${path.relative(ROOT, file)} must not contain q Professional assets/source`);
  });
  const htmlSection = sourceSection(panelSource, 'export function connectionFormHtml', 'function isRecord');
  const interpolations = [...htmlSection.matchAll(/\$\{([^}]+)\}/g)].map(match => match[1]);
  assert.deepStrictEqual(
    [...new Set(interpolations)].sort(),
    ['DEFAULT_NAMESPACE', 'cspSource', 'nonce', 'session'],
    'static webview HTML may interpolate only extension-owned CSP/session/default values'
  );
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(panelSource));
  assert.ok(!/\$\{\s*(?:initial|values|connection|payload)/.test(htmlSection));
  assert.match(panelSource, /message\.session\s*!==\s*this\.session/);
  assert.match(panelSource, /this\.disposed\s*\|\|\s*!isRecord\(value\)/);
  assert.match(panelSource, /typeof message\.type\s*!==\s*'string'/);
  assert.match(panelSource, /public waitForCompletion\(\): Promise<ConnectionFormResult>/);
  assert.match(panelSource, /this\.finish\('cancelled'\)/);
  assert.match(panelSource, /localResourceRoots: \[\]/);
  assert.match(panelSource, /private nextTestId = 1;/);
  assert.match(panelSource, /this\.activeTest !== test/);
  assert.match(panelSource, /test\.controller\.abort\(\)/);
  assert.match(panelSource, /await this\.cancelActiveTest\(true\);[\s\S]*?this\.callbacks\.onSave/);
  assert.match(commandsSource, /onTest: \(payload, signal, onProgress\) => this\.testConnectionForm/);
  assert.match(commandsSource, /password = await this\.store\.password\(editing\.id\)/);
  assert.match(commandsSource, /this\.manager\.testTemporary\(parsed\.connection/);
  assert.match(managerSource, /public async testTemporary\(/);
  assert.match(managerSource, /finally \{[\s\S]*?await client\.close\(\)/);
  assert.match(managerSource, /connectionTestNamespaceResultIsSafe/);
  assert.match(ipcSource, /public readonly phase\?: KdbIpcPhase/);
  assert.match(connectionTestSource, /export const CONNECTION_TEST_QUERY = '0b'/);
  assert.match(connectionTestSource, /99h=type value/);
  assert.ok(!/queryInNamespace|qScriptInNamespace/.test(connectionTestSource));
  assert.ok(!/system\\?"d\s+/.test(connectionTestSource), 'temporary testing must not change the remote namespace');

  const htmlHarness = createVscodePanelHarness();
  const {
    connectionFormHtml,
    initialConnectionFormValues,
  } = requireOutWithVscode('connection-form-panel', htmlHarness.vscode);
  const formHtml = connectionFormHtml(
    'vscode-webview://connection-form-source-test',
    'fixed-test-nonce',
    'fixed-test-session'
  );
  assert.match(formHtml, /<title>KX Connection<\/title>/);
  assert.match(formHtml, /default-src 'none'/);
  assert.match(formHtml, /var\(--vscode-editor-background\)/);
  assert.match(formHtml, /<form id="connectionForm" aria-labelledby="formTitle">/);
  const formControls = [
    ['name', 'Connection name'],
    ['host', 'Host'],
    ['port', 'Port'],
    ['database', 'Namespace / database'],
    ['username', 'Username'],
    ['password', 'Password'],
    ['connectTimeoutMs', 'Connect / handshake timeout (ms)'],
    ['queryTimeoutMs', 'Query timeout (ms)'],
  ];
  formControls.forEach(([id, label]) => {
    assert.ok(formHtml.includes(`<label for="${id}">${label}`), `missing visible label for ${id}`);
    assert.ok(formHtml.includes(`id="${id}"`), `missing ${id} form control`);
  });
  assert.match(formHtml, /id="password"[^>]*type="password"/);
  assert.match(formHtml, /Leave blank to keep the saved password/);
  assert.match(formHtml, /Clear saved password/);
  assert.match(formHtml, /<details id="advanced">/);
  assert.match(formHtml, /<summary>Advanced direct q IPC<\/summary>/);
  assert.match(formHtml, /blank to use its global default/i);
  assert.match(formHtml, /Use <code>0<\/code> to disable/i);
  assert.match(formHtml, /TCP connect and q IPC handshake/i);
  assert.match(formHtml, /timer starts when (?:this connection sends|the query is sent)/i);
  assert.match(formHtml, /id="formError"[^>]*role="alert"[^>]*aria-live="assertive"[^>]*tabindex="-1"/);
  assert.match(formHtml, /id="testStatus"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(formHtml, /id="save"[^>]*type="submit"[^>]*>Save Connection<\/button>/);
  assert.match(formHtml, /id="testConnection"[^>]*type="button"[^>]*>Test Connection<\/button>/);
  assert.match(formHtml, /id="cancelTest"[^>]*type="button"[^>]*>Cancel Test<\/button>/);
  assert.match(formHtml, /id="cancel"[^>]*>Cancel<\/button>/);
  assert.match(formHtml, /id="delete"[^>]*>Delete Connection<\/button>/);
  assert.match(formHtml, /form\.addEventListener\('submit'/);
  assert.match(formHtml, /testConnection\.addEventListener\('click'/);
  assert.match(formHtml, /post\('test', formPayload\(\)\)/);
  assert.match(formHtml, /post\('cancelTest'[^\n]*testId: activeTestId/);
  assert.match(formHtml, /message\.testId === activeTestId && message\.sequence <= activeTestSequence/);
  assert.match(formHtml, /save\.disabled = busy \|\| !form\.checkValidity\(\)/);
  assert.ok(!/save\.disabled\s*=\s*[^;]*testing/.test(formHtml), 'testing must not disable Save');
  assert.match(formHtml, /event\.key === 'Escape'/);
  assert.match(formHtml, /window\.setTimeout\(\(\) => controls\.name\.focus\(\)/);
  assert.match(formHtml, /controls\.password\.value = ''/);
  assert.match(formHtml, /\.textContent =/);
  assert.match(formHtml, /serverErrorField/);
  assert.match(formHtml, /setCustomValidity\(serverErrorMessage\)/);
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\bconfirm\s*\(/.test(formHtml));
  const inlineScript = formHtml.match(/<script nonce="fixed-test-nonce">([\s\S]*?)<\/script>/);
  assert.ok(inlineScript, 'connection form inline script is missing');
  assert.doesNotThrow(() => new Function(inlineScript[1]), 'connection form inline script must parse');

  const hostileName = '<img src=x onerror=alert(1)>';
  const hostileInitial = initialConnectionFormValues(
    'edit',
    { id: 'kx-hostile', name: hostileName, host: 'localhost', port: 5000, database: '.', username: '' },
    30000,
    30000,
    true,
    []
  );
  assert.strictEqual(hostileInitial.name, hostileName);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(hostileInitial, 'password'), false);
  assert.ok(!formHtml.includes(hostileName), 'user values must be assigned through DOM value/textContent, not raw HTML');

  assert.ok(!/showInputBox/.test(commandsSource), 'Add/Edit must not use sequential input boxes');
  assert.match(commandsSource, /registerCommand\('vscode-kdb\.addConnection'/);
  assert.match(commandsSource, /registerCommand\('vscode-kdb\.editConnection'/);
  assert.match(commandsSource, /public async add\(\)[\s\S]*?openConnectionForm\(\)/);
  assert.match(commandsSource, /public async edit\([\s\S]*?openConnectionForm\(connection\)/);
  assert.match(commandsSource, /const panel = new ConnectionFormPanel\(initial/);
  assert.match(commandsSource, /await panel\.waitForCompletion\(\)/);
  assert.match(commandsSource, /private activeForm: ConnectionFormPanel \| undefined/);
  assert.match(commandsSource, /this\.activeForm\.reveal\(\)/);
  assert.match(commandsSource, /parseConnectionFormPayload\(payload/);
  assert.match(commandsSource, /persistConnectionUpdate\(/);
  assert.match(commandsSource, /showWarningMessage\([\s\S]*?\{ modal: true \}[\s\S]*?'Delete Connection'/);
  assert.ok(!/\bconfirm\s*\(/.test(commandsSource), 'delete confirmation must stay in the extension host');
  assert.match(modelSource, /FORM_FIELDS/);
  assert.match(modelSource, /unsupported field/);
  assert.match(storeSource, /private mutationQueue: Promise<void>/);
  assert.match(storeSource, /return this\.mutate\(async \(\) =>/);
  assert.match(extensionSource, /disconnectIfConfigurationChanged/);
  assert.match(extensionSource, /vscode-kdb\.connectionTimeoutMs/);
  assert.match(extensionSource, /vscode-kdb\.queryTimeoutMs/);

  const vscodeIgnore = fs.readFileSync(path.join(ROOT, '.vscodeignore'), 'utf8');
  [
    'src/**',
    'test/**',
    'scripts/**',
    'tmp/**',
    'docs/**',
    'mkdocs-src/**',
    'mkdocs.yml',
    'PARITY.md',
    'PARITY_RUN.md',
    'PARITY_RUN.json',
    '**/*.map',
    'CODEX*',
    'PROMPT*',
    '**/*.pem',
    '**/*.key',
    '**/*.p12',
    '**/*.pfx',
    '**/.npmrc',
    '**/coverage/**',
    '**/*.tar',
    '**/*.gz',
    '**/*.7z',
    '**/*.rar',
    '*.vsix',
    '*.zip',
  ].forEach(pattern => {
    assert.ok(vscodeIgnore.includes(pattern), `.vscodeignore must exclude ${pattern}`);
  });
}

function requireOut(moduleName) {
  const candidates = [
    path.join(ROOT, 'out', moduleName),
    path.join(ROOT, 'out', 'src', moduleName),
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      if (error && error.code !== 'MODULE_NOT_FOUND') {
        throw error;
      }
    }
  }
  throw new Error(`Compiled module out/${moduleName}.js is missing. Run npm run compile first.`);
}

function requireOutWithVscode(moduleName, vscode) {
  return requireOutWithMocks(moduleName, { vscode });
}

function requireOutWithMocks(moduleName, mocks) {
  const candidates = [
    path.join(ROOT, 'out', moduleName),
    path.join(ROOT, 'out', 'src', moduleName),
  ];
  for (const candidate of candidates) {
    let resolved;
    try {
      resolved = require.resolve(candidate);
    } catch (error) {
      if (error && error.code === 'MODULE_NOT_FOUND') {
        continue;
      }
      throw error;
    }
    delete require.cache[resolved];
    const originalLoad = Module._load;
    Module._load = function loadWithMocks(request, parent, isMain) {
      return Object.prototype.hasOwnProperty.call(mocks, request)
        ? mocks[request]
        : originalLoad.call(this, request, parent, isMain);
    };
    try {
      return require(resolved);
    } finally {
      Module._load = originalLoad;
    }
  }
  throw new Error(`Compiled module out/${moduleName}.js is missing. Run npm run compile first.`);
}

function modelQTable(columns, rows) {
  return {
    qtype: 'table',
    columns: columns.slice(),
    rows: rows.map(row => ({ ...row })),
    columnData: [],
    rowCount: rows.length,
  };
}

function historyEntry(overrides = {}) {
  return {
    id: 'entry-default',
    connectionId: 'kx-history',
    connectionName: 'History q',
    timestamp: 100,
    kind: 'line',
    status: 'succeeded',
    durationMs: 5,
    queryText: '1+1',
    ...overrides,
  };
}

function cloneMaybe(value) {
  return value === undefined ? undefined : cloneJson(value);
}

function createHistoryMemento(initialValue) {
  let stored = cloneMaybe(initialValue);
  const updates = [];
  return {
    get(key) {
      assert.strictEqual(key, QUERY_HISTORY_STORAGE_KEY);
      return cloneMaybe(stored);
    },
    async update(key, value) {
      assert.strictEqual(key, QUERY_HISTORY_STORAGE_KEY);
      await Promise.resolve();
      stored = cloneMaybe(value);
      updates.push(cloneMaybe(value));
    },
    get value() {
      return cloneMaybe(stored);
    },
    updates,
  };
}

function createBlockingHistoryMemento(initialValue) {
  let stored = cloneMaybe(initialValue);
  let firstUpdate = true;
  let markUpdateStarted;
  let releaseUpdate;
  const updateStarted = new Promise(resolve => {
    markUpdateStarted = resolve;
  });
  const gate = new Promise(resolve => {
    releaseUpdate = resolve;
  });
  const updates = [];
  return {
    get(key) {
      assert.strictEqual(key, QUERY_HISTORY_STORAGE_KEY);
      return cloneMaybe(stored);
    },
    async update(key, value) {
      assert.strictEqual(key, QUERY_HISTORY_STORAGE_KEY);
      if (firstUpdate) {
        firstUpdate = false;
        markUpdateStarted();
        await gate;
      }
      stored = cloneMaybe(value);
      updates.push(cloneMaybe(value));
    },
    get value() {
      return cloneMaybe(stored);
    },
    updateStarted,
    releaseUpdate,
    updates,
  };
}

function assertHistoryStorageShape(value) {
  assert.ok(Array.isArray(value));
  const allowed = ['connectionId', 'connectionName', 'durationMs', 'id', 'kind', 'queryText', 'status', 'timestamp'];
  value.forEach(entry => {
    assert.deepStrictEqual(Object.keys(entry).sort(), allowed);
    for (const forbidden of ['result', 'results', 'password', 'username', 'host', 'error', 'messages']) {
      assert.strictEqual(Object.prototype.hasOwnProperty.call(entry, forbidden), false);
    }
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function eventLoopTurn() {
  return new Promise(resolve => setImmediate(resolve));
}

function createNotebookControllerRuntime() {
  const controllers = [];
  const executions = [];
  const configuration = new Map([
    ['vscode-kdb.notebook.maxOutputRows', 2],
    ['vscode-kdb.notebook.maxOutputBytes', 4096],
    ['vscode-kdb.results.viewer.functionDisplayStrategy', 'qText'],
    ['vscode-kdb.results.viewer.dictionaryDisplayStrategy', 'grid'],
    ['vscode-kdb.results.viewer.listDisplayStrategy', 'grid'],
    ['vscode-kdb.results.viewer.objectDisplayStrategy', 'grid'],
  ]);

  class EventEmitter {
    constructor() {
      this.listeners = new Set();
      this.disposed = false;
      this.event = listener => {
        if (this.disposed) {
          return { dispose() {} };
        }
        this.listeners.add(listener);
        let active = true;
        return {
          dispose: () => {
            if (!active) {
              return;
            }
            active = false;
            this.listeners.delete(listener);
          },
        };
      };
    }

    get listenerCount() {
      return this.listeners.size;
    }

    fire(value) {
      for (const listener of [...this.listeners]) {
        listener(value);
      }
    }

    dispose() {
      this.disposed = true;
      this.listeners.clear();
    }
  }

  class NotebookCellOutput {
    constructor(items, metadata = {}) {
      this.items = items;
      this.metadata = metadata;
    }
  }

  class CancellationToken {
    constructor(preCanceled) {
      this.canceled = !!preCanceled;
      this.listeners = new Set();
    }

    get isCancellationRequested() {
      return this.canceled;
    }

    onCancellationRequested(listener) {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    }

    cancel() {
      if (this.canceled) {
        return;
      }
      this.canceled = true;
      for (const listener of [...this.listeners]) {
        listener();
      }
    }
  }

  function createExecution(cell) {
    const token = new CancellationToken(cell.preCanceled);
    const execution = {
      cell,
      token,
      executionOrder: undefined,
      startCalls: [],
      endCalls: [],
      clearOutputCalls: 0,
      replaceOutputCalls: [],
      output: undefined,
      start(time) {
        this.startCalls.push(time);
        if (cell.startThrows) {
          throw new Error('injected notebook execution start failure');
        }
      },
      end(success, time) {
        this.endCalls.push({ success, time });
        if (cell.endThrows) {
          throw new Error('injected notebook execution end failure');
        }
      },
      async clearOutput() {
        this.clearOutputCalls += 1;
        this.output = undefined;
      },
      async replaceOutput(output) {
        this.replaceOutputCalls.push(output);
        this.output = output;
      },
    };
    executions.push(execution);
    return execution;
  }

  const vscode = {
    EventEmitter,
    NotebookCellKind: {
      Markup: 1,
      Code: 2,
    },
    NotebookCellOutput,
    NotebookCellOutputItem: {
      json(value, mime) {
        return { kind: 'json', mime, value };
      },
      text(value, mime = 'text/plain') {
        return { kind: 'text', mime, value };
      },
      error(error) {
        return {
          kind: 'error',
          mime: 'application/vnd.code.notebook.error',
          error,
        };
      },
    },
    workspace: {
      getConfiguration(section) {
        return {
          get(key, fallback) {
            const setting = `${section}.${key}`;
            return configuration.has(setting) ? configuration.get(setting) : fallback;
          },
        };
      },
    },
    notebooks: {
      createNotebookController(id, notebookType, label, executeHandler) {
        const selectionEmitter = new EventEmitter();
        const controller = {
          id,
          notebookType,
          label,
          executeHandler,
          selectionEmitter,
          onDidChangeSelectedNotebooks: selectionEmitter.event,
          supportedLanguages: undefined,
          supportsExecutionOrder: false,
          description: undefined,
          detail: undefined,
          disposeCalls: 0,
          createNotebookCellExecution(cell) {
            if (cell.createExecutionThrows) {
              throw new Error('injected duplicate execution');
            }
            return createExecution(cell);
          },
          dispose() {
            this.disposeCalls += 1;
          },
        };
        controllers.push(controller);
        return controller;
      },
    },
  };

  return {
    vscode,
    controllers,
    executions,
    cell({
      kind = vscode.NotebookCellKind.Code,
      languageId = 'q',
      source = '',
      uri = `vscode-notebook-cell:///cell/${executions.length}`,
      preCanceled = false,
      startThrows = false,
      endThrows = false,
      createExecutionThrows = false,
    } = {}) {
      return {
        kind,
        preCanceled,
        startThrows,
        endThrows,
        createExecutionThrows,
        document: {
          languageId,
          uri: testUri(uri),
          getText: () => source,
        },
      };
    },
    notebook(uri) {
      return {
        uri: testUri(uri),
        notebookType: 'jupyter-notebook',
      };
    },
    executionFor(cell) {
      return executions.filter(execution => execution.cell === cell).at(-1);
    },
  };
}

function createDirectQNotebookBridgeHarness() {
  const listeners = new Set();
  return {
    connection: undefined,
    connected: false,
    calls: [],
    errorTargets: [],
    stateSubscriptionDisposals: 0,
    executeImpl: async (_connection, _source, onIssued) => {
      onIssued();
      return 1;
    },
    errorImpl: async error => error instanceof Error ? error.message : String(error),
    activeConnection() {
      return this.connection;
    },
    isConnected(connectionId) {
      return !!this.connection && this.connection.id === connectionId && this.connected;
    },
    async executeScript(connection, source, onIssued, signal) {
      this.calls.push({ connection, source, signal });
      return this.executeImpl(connection, source, onIssued, signal);
    },
    async errorMessage(error, connection) {
      return this.errorImpl(error, connection);
    },
    onDidChangeState(listener) {
      listeners.add(listener);
      let active = true;
      return {
        dispose: () => {
          if (!active) {
            return;
          }
          active = false;
          listeners.delete(listener);
          this.stateSubscriptionDisposals += 1;
        },
      };
    },
    fireState() {
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

function testUri(value) {
  return {
    toString() {
      return value;
    },
  };
}

function notebookOutputItem(output, mime) {
  return output && Array.isArray(output.items)
    ? output.items.find(item => item.mime === mime)
    : undefined;
}

function notebookErrorText(output) {
  const item = output && Array.isArray(output.items)
    ? output.items.find(candidate => candidate.kind === 'error')
    : undefined;
  return item?.error?.stack || item?.error?.message || '';
}

function notebookTextOutput(output) {
  const item = notebookOutputItem(output, 'text/plain');
  return item ? String(item.value) : '';
}

function configurationEvent(changedKey) {
  return {
    affectsConfiguration(key) {
      return key === changedKey;
    },
  };
}

function createVscodeTreeHarness() {
  const warnings = [];
  const errors = [];
  const information = [];
  const createdTreeViews = [];
  const registeredCommands = new Map();
  const progressControllers = [];
  class EventEmitter {
    constructor() {
      this.listeners = new Set();
      this.event = listener => {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
      };
    }

    fire(value) {
      [...this.listeners].forEach(listener => listener(value));
    }

    dispose() {
      this.listeners.clear();
    }
  }
  class TreeItem {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  }
  class ThemeIcon {
    constructor(id, color) {
      this.id = id;
      this.color = color;
    }
  }
  const createCancellationController = () => {
    let canceled = false;
    const listeners = new Set();
    return {
      token: {
        get isCancellationRequested() {
          return canceled;
        },
        onCancellationRequested(listener) {
          listeners.add(listener);
          return { dispose: () => listeners.delete(listener) };
        },
      },
      cancel() {
        if (canceled) {
          return;
        }
        canceled = true;
        [...listeners].forEach(listener => listener());
      },
    };
  };
  const harness = {
    warnings,
    errors,
    information,
    createdTreeViews,
    registeredCommands,
    progressControllers,
    cancelLatestProgress() {
      assert.ok(progressControllers.length > 0, 'no cancellable progress operation was created');
      progressControllers.at(-1).cancel();
    },
    vscode: {
      EventEmitter,
      TreeItem,
      ThemeIcon,
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      ProgressLocation: { Notification: 15 },
      commands: {
        registerCommand(id, handler) {
          registeredCommands.set(id, handler);
          return { dispose: () => registeredCommands.delete(id) };
        },
      },
      window: {
        createTreeView(id, options) {
          const view = { id, options, disposed: false };
          createdTreeViews.push(view);
          return { dispose: () => { view.disposed = true; } };
        },
        async withProgress(_options, task) {
          const controller = createCancellationController();
          progressControllers.push(controller);
          return task({}, controller.token);
        },
        showWarningMessage(message) {
          warnings.push(message);
          return undefined;
        },
        showErrorMessage(message) {
          errors.push(message);
          return undefined;
        },
        showInformationMessage(message) {
          information.push(message);
          return undefined;
        },
      },
    },
  };
  return harness;
}

function createVscodeRuntimeMock(settings = {}) {
  class EventEmitter {
    constructor() {
      this.listeners = new Set();
      this.event = listener => {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
      };
    }

    fire(value) {
      this.listeners.forEach(listener => listener(value));
    }

    dispose() {
      this.listeners.clear();
    }
  }
  return {
    EventEmitter,
    workspace: {
      getConfiguration() {
        return {
          get(key, fallback) {
            return Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : fallback;
          },
        };
      },
    },
  };
}

function createVscodePanelHarness() {
  const disposeListeners = new Set();
  const messageListeners = new Set();
  const posted = [];
  const webview = {
    cspSource: 'vscode-webview://connection-form-test',
    html: '',
    async postMessage(message) {
      posted.push(message);
      return true;
    },
    onDidReceiveMessage(listener) {
      messageListeners.add(listener);
      return { dispose: () => messageListeners.delete(listener) };
    },
  };
  const panel = {
    webview,
    disposed: false,
    onDidDispose(listener) {
      disposeListeners.add(listener);
      return { dispose: () => disposeListeners.delete(listener) };
    },
    dispose() {
      if (panel.disposed) {
        return;
      }
      panel.disposed = true;
      [...disposeListeners].forEach(listener => listener());
    },
  };
  const harness = {
    posted,
    panel,
    created: undefined,
    vscode: {
      ViewColumn: { Active: 'active' },
      window: {
        createWebviewPanel(viewType, title, column, options) {
          harness.created = { viewType, title, column, options };
          return panel;
        },
      },
    },
  };
  return harness;
}

function createQTextResultsPanelHarness() {
  const panels = [];
  const updates = [];
  const clipboard = [];
  const settings = Object.create(null);
  const context = {
    extensionPath: ROOT,
    globalState: {
      get() {
        return undefined;
      },
      async update() {
        return undefined;
      },
    },
  };

  class Disposable {
    constructor(dispose) {
      this.disposeCallback = dispose;
    }
    dispose() {
      this.disposeCallback();
    }
  }

  const harness = {
    panels,
    updates,
    clipboard,
    context,
    setSetting(key, value) {
      settings[key] = value;
    },
    async emitMessage(panelIndex, message) {
      const panel = panels[panelIndex];
      assert.ok(panel, `result panel ${panelIndex} does not exist`);
      [...panel.messageListeners].forEach(listener => listener(message));
      await new Promise(resolve => setImmediate(resolve));
    },
    vscode: {
      ConfigurationTarget: { Global: 'global' },
      Disposable,
      Uri: {
        file(fsPath) {
          return {
            fsPath,
            toString() {
              return `file://${fsPath}`;
            },
          };
        },
      },
      ViewColumn: {
        Active: 'active',
        Beside: 'beside',
        One: 'one',
        Two: 'two',
        Three: 'three',
      },
      env: {
        clipboard: {
          async writeText(value) {
            clipboard.push(value);
          },
        },
      },
      workspace: {
        getConfiguration(section) {
          return {
            get(key, fallback) {
              const fullKey = `${section}.${key}`;
              return Object.prototype.hasOwnProperty.call(settings, fullKey) ? settings[fullKey] : fallback;
            },
            async update(key, value, target) {
              const fullKey = `${section}.${key}`;
              settings[fullKey] = value;
              updates.push({ key: fullKey, value, target });
            },
          };
        },
      },
      window: {
        activeTextEditor: undefined,
        createWebviewPanel(viewType, title, viewColumn, options) {
          const disposeListeners = new Set();
          const messageListeners = new Set();
          const viewStateListeners = new Set();
          const posted = [];
          const webview = {
            cspSource: 'vscode-webview://qtext-results-test',
            html: '',
            asWebviewUri(uri) {
              return `vscode-webview-resource://${uri.fsPath}`;
            },
            async postMessage(message) {
              posted.push(message);
              return true;
            },
            onDidReceiveMessage(listener) {
              messageListeners.add(listener);
              return { dispose: () => messageListeners.delete(listener) };
            },
          };
          const panel = {
            viewType,
            title,
            viewColumn,
            options,
            webview,
            posted,
            messageListeners,
            active: true,
            visible: true,
            disposed: false,
            reveal(column) {
              panel.viewColumn = column;
              panel.visible = true;
              panel.active = true;
            },
            onDidDispose(listener) {
              disposeListeners.add(listener);
              return { dispose: () => disposeListeners.delete(listener) };
            },
            onDidChangeViewState(listener) {
              viewStateListeners.add(listener);
              return { dispose: () => viewStateListeners.delete(listener) };
            },
            dispose() {
              if (panel.disposed) {
                return;
              }
              panel.disposed = true;
              panel.active = false;
              panel.visible = false;
              [...disposeListeners].forEach(listener => listener());
            },
          };
          panels.push(panel);
          return panel;
        },
        showErrorMessage() {
          return undefined;
        },
        showWarningMessage() {
          return undefined;
        },
      },
    },
  };
  return harness;
}

function createVscodeStoreHarness() {
  const state = {
    activeId: undefined,
    connections: [],
    secrets: new Map(),
    failSecretStore: 0,
    failSecretDelete: 0,
    failConfigurationUpdate: 0,
    failActiveUpdate: 0,
  };
  const configuration = {
    inspect(key) {
      assert.strictEqual(key, 'connections');
      return { globalValue: cloneJson(state.connections) };
    },
    async update(key, value, target) {
      assert.strictEqual(key, 'connections');
      assert.strictEqual(target, 'global');
      if (state.failConfigurationUpdate > 0) {
        state.failConfigurationUpdate--;
        throw new Error('injected configuration update failure');
      }
      state.connections = cloneJson(value);
    },
  };
  const context = {
    globalState: {
      get() {
        return state.activeId;
      },
      async update(_key, value) {
        if (state.failActiveUpdate > 0) {
          state.failActiveUpdate--;
          throw new Error('injected active-state update failure');
        }
        state.activeId = value;
      },
    },
    secrets: {
      async get(key) {
        return state.secrets.get(key);
      },
      async store(key, value) {
        if (state.failSecretStore > 0) {
          state.failSecretStore--;
          throw new Error('injected SecretStorage store failure');
        }
        state.secrets.set(key, value);
      },
      async delete(key) {
        if (state.failSecretDelete > 0) {
          state.failSecretDelete--;
          throw new Error('injected SecretStorage delete failure');
        }
        state.secrets.delete(key);
      },
    },
  };
  const harness = {
    vscode: {
      ConfigurationTarget: { Global: 'global' },
      workspace: { getConfiguration: () => configuration },
    },
    context,
    get connections() {
      return cloneJson(state.connections);
    },
    get activeId() {
      return state.activeId;
    },
    set failSecretStore(value) {
      state.failSecretStore = value;
    },
    set failSecretDelete(value) {
      state.failSecretDelete = value;
    },
    set failConfigurationUpdate(value) {
      state.failConfigurationUpdate = value;
    },
    set failActiveUpdate(value) {
      state.failActiveUpdate = value;
    },
    secretFor(id) {
      return state.secrets.get(`vscode-kdb.connectionPassword.${id}`);
    },
  };
  return harness;
}

function legacySqlToolsProfile(overrides = {}) {
  return {
    driver: 'KDB',
    name: 'Legacy q',
    server: 'localhost',
    port: 5000,
    ...overrides,
  };
}

function createSqlToolsConfigurationApi(options = {}) {
  const folders = options.folders || [];
  const rootConfiguration = {
    inspect(key) {
      assert.strictEqual(key, 'connections');
      return options.rootInspection;
    },
    get(key) {
      assert.strictEqual(key, 'connections');
      return options.rootEffective;
    },
  };
  const folderConfigurations = new Map(folders.map(folder => [
    folder.uri,
    {
      inspect(key) {
        assert.strictEqual(key, 'connections');
        return folder.inspection;
      },
      get(key) {
        assert.strictEqual(key, 'connections');
        return folder.effective;
      },
    },
  ]));
  return {
    workspace: {
      workspaceFolders: folders.map(folder => ({
        name: folder.name,
        uri: folder.uri,
      })),
      getConfiguration(section, resource) {
        assert.strictEqual(section, 'sqltools');
        if (resource === undefined) {
          return rootConfiguration;
        }
        const configuration = folderConfigurations.get(resource);
        assert.ok(configuration, 'unexpected workspace-folder configuration resource');
        return configuration;
      },
    },
  };
}

function createMigrationCommandHarness(options = {}) {
  const state = {
    activeId: options.initialActiveId,
    connections: cloneJson(options.initialConnections || []),
    secrets: new Map(),
    sqlToolsGlobal: options.sqlToolsGlobal || [],
    sqlToolsUpdates: 0,
    failSecretStore: !!options.failSecretStore,
    nextConnectionId: 1,
    treeRefreshes: 0,
  };
  for (const [id, password] of Object.entries(options.initialSecrets || {})) {
    state.secrets.set(`vscode-kdb.connectionPassword.${id}`, password);
  }

  const quickPicks = [];
  const conflictPicks = [];
  const inputBoxes = [];
  const warnings = [];
  const information = [];
  const executedCommands = [];

  const sqlToolsConfiguration = {
    inspect(key) {
      assert.strictEqual(key, 'connections');
      return {
        key: 'sqltools.connections',
        globalValue: state.sqlToolsGlobal,
      };
    },
    get(key) {
      assert.strictEqual(key, 'connections');
      return state.sqlToolsGlobal;
    },
    async update() {
      state.sqlToolsUpdates++;
      throw new Error('the SQLTools source setting must remain read-only');
    },
  };
  const kxConfiguration = {
    inspect(key) {
      assert.strictEqual(key, 'connections');
      return { globalValue: cloneJson(state.connections) };
    },
    async update(key, value, target) {
      assert.strictEqual(key, 'connections');
      assert.strictEqual(target, 'global');
      state.connections = cloneJson(value);
    },
  };

  const vscode = {
    ConfigurationTarget: { Global: 'global' },
    workspace: {
      workspaceFolders: undefined,
      getConfiguration(section) {
        if (section === 'sqltools') {
          return sqlToolsConfiguration;
        }
        assert.strictEqual(section, 'vscode-kdb');
        return kxConfiguration;
      },
    },
    window: {
      createQuickPick() {
        const selectionListeners = new Set();
        const acceptListeners = new Set();
        const hideListeners = new Set();
        let selectedItems = [];
        let hidden = false;
        const quickPick = {
          title: '',
          placeholder: '',
          canSelectMany: false,
          ignoreFocusOut: false,
          matchOnDescription: false,
          matchOnDetail: false,
          items: [],
          get selectedItems() {
            return selectedItems;
          },
          set selectedItems(items) {
            selectedItems = items;
            [...selectionListeners].forEach(listener => listener(items));
          },
          onDidChangeSelection(listener) {
            selectionListeners.add(listener);
            return { dispose: () => selectionListeners.delete(listener) };
          },
          onDidAccept(listener) {
            acceptListeners.add(listener);
            return { dispose: () => acceptListeners.delete(listener) };
          },
          onDidHide(listener) {
            hideListeners.add(listener);
            return { dispose: () => hideListeners.delete(listener) };
          },
          show() {
            quickPick.selectedItems = options.selectUnsupported
              ? [...quickPick.items]
              : quickPick.items.filter(item =>
                item.selectable &&
                (!options.selectCandidate || options.selectCandidate(item.candidate))
              );
            [...acceptListeners].forEach(listener => listener());
          },
          hide() {
            if (hidden) {
              return;
            }
            hidden = true;
            [...hideListeners].forEach(listener => listener());
          },
          dispose() {
            selectionListeners.clear();
            acceptListeners.clear();
            hideListeners.clear();
          },
        };
        quickPicks.push(quickPick);
        return quickPick;
      },
      async showQuickPick(items, pickerOptions) {
        conflictPicks.push({ items, options: pickerOptions });
        return items.find(item => item.action === options.conflictDecision);
      },
      async showInputBox(inputOptions) {
        inputBoxes.push(inputOptions);
        return options.renameValue;
      },
      async showWarningMessage(message, modal, ...actions) {
        warnings.push({ message, modal, actions });
        if (actions.includes('Copy Passwords and Import')) {
          if (options.sqlToolsAfterPasswordDecision) {
            state.sqlToolsGlobal = options.sqlToolsAfterPasswordDecision;
          }
          if (options.kxConnectionsAfterPasswordDecision) {
            state.connections = cloneJson(options.kxConnectionsAfterPasswordDecision);
          }
          return options.passwordDecision;
        }
        return undefined;
      },
      async showInformationMessage(message, ...actions) {
        information.push({ message, actions });
        return options.reviewAfterImport && actions.includes('Review Imported Connection')
          ? 'Review Imported Connection'
          : undefined;
      },
    },
    commands: {
      async executeCommand(command, ...args) {
        executedCommands.push({ command, args });
      },
    },
  };
  const context = {
    globalState: {
      get() {
        return state.activeId;
      },
      async update(_key, value) {
        state.activeId = value;
      },
    },
    secrets: {
      async get(key) {
        return state.secrets.get(key);
      },
      async store(key, value) {
        if (state.failSecretStore) {
          throw new Error('injected SecretStorage store failure');
        }
        state.secrets.set(key, value);
      },
      async delete(key) {
        state.secrets.delete(key);
      },
    },
  };
  const { ConnectionStore } = requireOutWithVscode('connection-store', vscode);
  const store = new ConnectionStore(context);
  store.newConnectionId = () => `kx-import-${state.nextConnectionId++}`;
  const tree = {
    refresh() {
      state.treeRefreshes++;
    },
  };
  const command = new ConnectionMigrationCommand(vscode, store, tree);

  return {
    command,
    quickPicks,
    conflictPicks,
    inputBoxes,
    warnings,
    information,
    executedCommands,
    get connections() {
      return cloneJson(state.connections);
    },
    get activeId() {
      return state.activeId;
    },
    get treeRefreshes() {
      return state.treeRefreshes;
    },
    secretFor(id) {
      return state.secrets.get(`vscode-kdb.connectionPassword.${id}`);
    },
    sourcePassword() {
      const source = state.sqlToolsGlobal.find(profile =>
        profile && typeof profile === 'object' && typeof profile.password === 'string');
      return source && source.password;
    },
    get sqlToolsUpdates() {
      return state.sqlToolsUpdates;
    },
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function hex(value) {
  return Buffer.from(value.replace(/\s/g, ''), 'hex');
}

function qTable(columns, vectors) {
  return Buffer.concat([
    int8(98),
    Buffer.from([0]),
    int8(99),
    symbolVector(columns),
    genericList(vectors),
  ]);
}

function qResponse(payload) {
  const message = Buffer.alloc(8 + payload.length);
  message.writeUInt8(1, 0);
  message.writeUInt8(2, 1);
  message.writeInt32LE(message.length, 4);
  payload.copy(message, 8);
  return message;
}

function genericList(items) {
  return Buffer.concat([vectorHeader(0, items.length), ...items]);
}

function symbolVector(values) {
  return Buffer.concat([vectorHeader(11, values.length), ...values.map(value => cString(value))]);
}

function intVector(values) {
  const body = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => body.writeInt32LE(value, index * 4));
  return Buffer.concat([vectorHeader(6, values.length), body]);
}

function vectorHeader(type, length) {
  const header = Buffer.alloc(6);
  header.writeInt8(type, 0);
  header.writeUInt8(0, 1);
  header.writeInt32LE(length, 2);
  return header;
}

function int8(value) {
  const result = Buffer.alloc(1);
  result.writeInt8(value, 0);
  return result;
}

function cString(value) {
  return Buffer.from(`${value}\0`, 'utf8');
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function assertCompletesWithin(label, operation, timeoutMs) {
  let timeout;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} did not complete within ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function unusedLoopbackPort() {
  const server = net.createServer();
  await listen(server);
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  await closeServer(server);
  return port;
}

function connectToLoopback(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve();
    });
    socket.once('error', reject);
  });
}

function assertKeybinding(keybindings, command, key, mac) {
  const binding = keybindings.find(candidate => candidate.command === command);
  assert.ok(binding, `missing keybinding for ${command}`);
  assert.strictEqual(String(binding.key).toLowerCase(), key);
  assert.strictEqual(String(binding.mac).toLowerCase(), mac);
  assert.match(String(binding.when || ''), /editorTextFocus/);
  assert.match(String(binding.when || ''), /q/);
}

function assertNoSqlToolsRuntimeReference(source, label) {
  const forbidden = [
    /@sqltools\//i,
    /sqltools\.connections/i,
    /["']sqltools\./i,
    /\.session\.sql/i,
    /kdb-sqltools/i,
  ];
  forbidden.forEach(pattern => assert.ok(!pattern.test(source), `${label} contains forbidden standalone dependency/path ${pattern}`));
}

function assertSqlToolsMigrationBridgeSource(source, label) {
  for (const alias of [
    'KDB',
    'kdb+',
    'kdb',
    'kdb-sqltools',
    'DanielAlonso.kdb-sqltools',
  ]) {
    assert.ok(source.includes(`'${alias}'`), `${label} is missing the exact legacy alias ${alias}`);
  }
  assert.match(source, /const SQLTOOLS_CONFIGURATION_SECTION = 'sqltools'/);
  assert.match(source, /const SQLTOOLS_CONNECTIONS_SETTING = 'connections'/);
  assert.match(
    source,
    /getConfiguration\(SQLTOOLS_CONFIGURATION_SECTION(?:,\s*folder\.uri)?\)/
  );
  assert.ok(!/sshOptions/.test(source), `${label} must not inspect or copy SQLTools SSH options`);
  const forbidden = [
    /@sqltools\//i,
    /\.session\.sql/i,
    /extensions\.getExtension/i,
    /(?:registerCommand|executeCommand)\(\s*['"]sqltools\./i,
    /onDidChangeConfiguration/i,
    /setInterval\s*\(/i,
    /\b(?:console|logger)\s*\./i,
  ];
  forbidden.forEach(pattern => assert.ok(
    !pattern.test(source),
    `${label} exceeds the read-only migration bridge boundary ${pattern}`
  ));
}

function assertNoVscodeQRuntimeReference(source, label) {
  const forbidden = [
    /jshinonome\/vscode-q/i,
    /(?:from|require\s*\()\s*['"][^'"]*vscode-q/i,
    /[\\/]vscode-q[\\/]/i,
  ];
  forbidden.forEach(pattern => assert.ok(
    !pattern.test(source),
    `${label} contains forbidden q Professional/vscode-q runtime source or asset reference ${pattern}`
  ));
}

function walkFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(target) : [target];
  });
}

function sourcesFromDirectory(directory) {
  return walkFiles(directory)
    .filter(file => file.endsWith('.ts'))
    .map(file => [file, fs.readFileSync(file, 'utf8')]);
}

function readSource(fileName) {
  return fs.readFileSync(path.join(ROOT, 'src', fileName), 'utf8');
}

function sourceSection(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, `cannot find source section ${startNeedle} .. ${endNeedle}`);
  return source.slice(start, end);
}
