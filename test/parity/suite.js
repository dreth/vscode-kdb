'use strict';

const cp = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

async function runParitySuite(ctx) {
  validateContext(ctx);
  await codecCases(ctx);
  await editorAndNamespaceCases(ctx);
  await chartCases(ctx);
  await exportCases(ctx);
  await ipcLifecycleCases(ctx);
  await localServerCases(ctx);
  await liveQCases(ctx);
  await boundaryCases(ctx);
}

async function codecCases(ctx) {
  const { standalone, reference, fixtures, canonical } = ctx;

  await ctx.case(caseDef(
    'ipc-query-serialization',
    'q IPC query serialization',
    'deterministic',
    'PASS',
    'Synchronous char-vector query frames are byte-identical.'
  ), t => {
    const query = 'select sym,size from trade';
    const left = standalone.ipc.serializeTextQuery(query);
    const right = reference.ipc.serializeTextQuery(query);
    t.deepEqual(left, right);
    t.equal(left.readUInt8(0), 1);
    t.equal(left.readUInt8(1), 1);
    t.equal(left.readInt32LE(4), left.length);
  });

  for (const fixture of fixtures.createIpcFixtures()) {
    await ctx.case(caseDef(
      `ipc-decode-${fixture.id}`,
      `q decode/display: ${fixture.family}`,
      'deterministic',
      'PASS',
      `The same ${fixture.family} payload and supported grid/qText choices were compared.`
    ), t => {
      if (fixture.expectedError) {
        const leftError = captureSyncError(() => standalone.ipc.deserializeQPayload(Buffer.from(fixture.payload)));
        const rightError = captureSyncError(() => reference.ipc.deserializeQPayload(Buffer.from(fixture.payload)));
        const leftCanonical = canonical.canonicalError(leftError);
        const rightCanonical = canonical.canonicalError(rightError);
        t.deepEqual(leftCanonical, rightCanonical);
        t.equal(leftCanonical.name, fixture.expectedError.name);
        t.equal(leftCanonical.classification, fixture.expectedError.classification);
        t.equal(leftCanonical.message, fixture.expectedError.message);
        return;
      }

      const leftValue = standalone.ipc.deserializeQPayload(Buffer.from(fixture.payload));
      const rightValue = reference.ipc.deserializeQPayload(Buffer.from(fixture.payload));
      t.deepEqual(canonical.canonicalQValue(leftValue), fixture.expectedCanonical);
      t.deepEqual(canonical.canonicalQValue(rightValue), fixture.expectedCanonical);

      const leftMessageValue = standalone.ipc.deserializeQMessage(Buffer.from(fixture.frame));
      const rightMessageValue = reference.ipc.deserializeQMessage(Buffer.from(fixture.frame));
      t.deepEqual(canonical.canonicalQValue(leftMessageValue), canonical.canonicalQValue(rightMessageValue));

      for (const displayCase of fixture.displayCases || []) {
        const options = normalizeSharedDisplayOptions(displayCase.options);
        const leftPanel = standalone.ipc.qValueToColumnarPanel(
          standalone.ipc.deserializeQPayload(Buffer.from(fixture.payload)),
          options
        );
        const rightPanel = reference.ipc.qValueToColumnarPanel(
          reference.ipc.deserializeQPayload(Buffer.from(fixture.payload)),
          options
        );
        const leftCanonical = canonical.canonicalPanel(leftPanel);
        const rightCanonical = canonical.canonicalPanel(rightPanel);
        t.deepEqual(leftCanonical, rightCanonical);
        t.equal(leftCanonical.mode, displayCase.mode);
        t.equal(leftCanonical.kind, displayCase.kind);
      }
    });
  }

  await ctx.case({
    id: 'result-display-legacy-aliases',
    area: 'q grid/qText settings aliases',
    mode: 'deterministic',
    expectedStatus: 'DIFFERENT_BY_DESIGN',
    rationale: 'SQLTools retains legacy table/text aliases. Standalone accepts only its KX-owned grid/qText core contract and normalizes UI settings at its own panel boundary.',
  }, t => {
    const payload = fixtures.qIntVector([1, 2]);
    const left = standalone.ipc.qValueToColumnarPanel(
      standalone.ipc.deserializeQPayload(payload),
      { listDisplayStrategy: 'text' }
    );
    const right = reference.ipc.qValueToColumnarPanel(
      reference.ipc.deserializeQPayload(payload),
      { listDisplayStrategy: 'text' }
    );
    t.equal(left.mode, 'grid');
    t.equal(right.mode, 'text');
  });
}

async function editorAndNamespaceCases(ctx) {
  const { standalone, reference, fixtures } = ctx;

  await ctx.case(caseDef(
    'editor-exact-selection-current-line',
    'exact selection and physical current line',
    'deterministic',
    'PASS',
    'Selections, whitespace, CRLF lines, and clamped cursor positions use the same exact-text contract.'
  ), t => {
    for (const fixture of fixtures.SELECTION_FIXTURES) {
      const left = standalone.qText.selectedTextOrCurrentLine(
        fixture.documentText,
        fixture.selectionText,
        fixture.cursorLine
      );
      const right = reference.qText.selectedTextOrCurrentLine(
        fixture.documentText,
        fixture.selectionText,
        fixture.cursorLine
      );
      t.equal(left, fixture.expectedCurrentLine);
      t.equal(right, fixture.expectedCurrentLine);
      t.equal(left, right);
      t.equal(standalone.qText.qSelectionExecutionKind(left), fixture.expectedExecutionKind);
    }
  });

  await ctx.case({
    id: 'editor-blank-line-q-block-helper',
    area: 'blank-line-bounded q block execution',
    mode: 'deterministic',
    expectedStatus: 'GAP',
    rank: 3,
    action: 'Make an explicit first-party product decision: implement a standalone q-block helper/command with tests, or formally exclude it and reclassify this row by design.',
    signoff: 'The reviewed decision is documented and the executable case asserts the resulting standalone contract.',
    detail: 'Reference exposes currentQBlock/selectedTextOrCurrentBlock; standalone intentionally preserves current-line behavior but has not resolved the separate optional block command.',
  }, t => {
    t.equal(typeof reference.qText.currentQBlock, 'function');
    t.equal(typeof reference.qText.selectedTextOrCurrentBlock, 'function');
    t.equal(typeof standalone.qText.currentQBlock, 'undefined');
    for (const fixture of fixtures.BLOCK_FIXTURES) {
      t.equal(
        reference.qText.selectedTextOrCurrentBlock(
          fixture.documentText,
          fixture.selectionText,
          fixture.cursorLine
        ),
        fixture.expectedBlock
      );
    }
  });

  await ctx.case(caseDef(
    'namespace-root-passthrough',
    'root namespace exact-text passthrough',
    'deterministic',
    'PASS',
    'Both public query wrappers preserve root-namespace q text byte-for-byte.'
  ), t => {
    for (const query of ['1+1', '  select from trade\n', 'a:1\na+1']) {
      t.equal(standalone.namespace.queryInNamespace(query, '.'), query);
      t.equal(reference.namespace.queryInNamespace(query, '.'), query);
    }
  });

  await ctx.case({
    id: 'namespace-wrapper-surface',
    area: 'namespace and multiline wrapper surface',
    mode: 'deterministic',
    expectedStatus: 'DIFFERENT_BY_DESIGN',
    rationale: 'Standalone owns strict-root Server Explorer execution and a .Q.ld script wrapper; SQLTools exposes its legacy raw namespace wrapper through the driver. Semantic common behavior is tested live below.',
  }, t => {
    const query = 'answer';
    const left = standalone.namespace.queryInNamespace(query, '.analytics');
    const right = reference.namespace.queryInNamespace(query, '.analytics');
    t.match(left, /previous:string system "d"/);
    t.match(right, /old:string system "d"/);
    t.match(left, /system "d ",ns/);
    t.match(right, /system "d ",ns/);
    t.equal(typeof standalone.namespace.queryInNamespaceStrict, 'function');
    t.equal(typeof standalone.namespace.qScriptInNamespace, 'function');
    t.equal(typeof reference.namespace.qScriptInNamespace, 'undefined');
  });

}

async function chartCases(ctx) {
  const { standalone, reference, fixtures, canonical } = ctx;
  for (const fixture of fixtures.createChartFixtures()) {
    await ctx.case(caseDef(
      `chart-${fixture.id}`,
      `chart data engine: ${fixture.request.chartType}`,
      'deterministic',
      'PASS',
      'The same rows, selection, grouping, validation, and sampling request were executed by both pure engines.'
    ), t => {
      const leftTable = standalone.results.rowsToColumnarPanelResult(fixture.rows, fixture.columns);
      const rightTable = reference.results.rowsToColumnarPanelResult(fixture.rows, fixture.columns);
      if (fixture.expectedErrorPattern) {
        const leftError = captureSyncError(() => standalone.chart.buildChartData(leftTable, fixture.request));
        const rightError = captureSyncError(() => reference.chart.buildChartData(rightTable, fixture.request));
        t.equal(leftError.name, rightError.name);
        t.match(leftError.message, fixture.expectedErrorPattern);
        t.equal(leftError.message, rightError.message);
        return;
      }
      const left = canonical.canonicalChart(standalone.chart.buildChartData(leftTable, fixture.request));
      const right = canonical.canonicalChart(reference.chart.buildChartData(rightTable, fixture.request));
      t.deepEqual(left, right);
      t.equal(left.chartType, fixture.request.chartType);
    });
  }

  await ctx.case(caseDef(
    'chart-ohlc-exported-aggregation',
    'candlestick OHLC aggregation',
    'deterministic',
    'PASS',
    'The exported OHLC aggregator preserved first-open, max-high, min-low, last-close and exact/bucket counts.'
  ), t => {
    const points = [
      { x: 1, xText: '1', open: 10, high: 12, low: 8, close: 11, rowIndex: 0 },
      { x: 1, xText: '1', open: 11, high: 15, low: 9, close: 13, rowIndex: 1 },
      { x: 2, xText: '2', open: 13, high: 18, low: 12, close: 17, rowIndex: 2 },
    ];
    const left = standalone.chart.aggregateCandlestickPoints(points, 1);
    const right = reference.chart.aggregateCandlestickPoints(points, 1);
    t.deepEqual(canonical.canonicalQValue(left), canonical.canonicalQValue(right));
    t.equal(left.exactPointCount, 2);
    t.equal(left.candlesticks[0].open, 10);
    t.equal(left.candlesticks[0].close, 17);
    t.equal(left.candlesticks[0].high, 18);
    t.equal(left.candlesticks[0].low, 8);
  });
}

async function exportCases(ctx) {
  const { standalone, reference, fixtures, canonical } = ctx;
  const fixture = fixtures.createExportFixture();
  for (const format of fixture.formats) {
    await ctx.case(caseDef(
      `export-text-${format}`,
      `text export: ${format.toUpperCase()}`,
      'deterministic',
      'PASS',
      'Exact export text, escaping, headers, row index, nested values, and line breaks were compared.'
    ), t => {
      const left = standalone.results.rowsToTextFormat(
        fixture.rows,
        fixture.columns,
        fixture.range,
        format,
        fixture.options
      );
      const right = reference.results.rowsToTextFormat(
        fixture.rows,
        fixture.columns,
        fixture.range,
        format,
        fixture.options
      );
      t.equal(left, right);
      t.ok(left.length > 0);
    });
  }

  await ctx.case(caseDef(
    'export-xlsx-sheet-limits',
    'XLSX Excel sheet limits',
    'deterministic',
    'PASS',
    'Header/index expansion at Excel row and column limits produced identical validation results.'
  ), t => {
    t.equal(standalone.results.XLSX_MAX_ROWS, reference.results.XLSX_MAX_ROWS);
    t.equal(standalone.results.XLSX_MAX_COLUMNS, reference.results.XLSX_MAX_COLUMNS);
    for (const limit of fixtures.XLSX_LIMIT_FIXTURES) {
      const left = standalone.results.validateXlsxSheetLimits(limit.range, limit.options);
      const right = reference.results.validateXlsxSheetLimits(limit.range, limit.options);
      t.equal(left, right);
      t.equal(left === null, limit.expectedValid);
      if (limit.expectedMessagePattern) {
        t.match(left, limit.expectedMessagePattern);
      }
    }
  });

  await ctx.case(caseDef(
    'export-xlsx-structure',
    'XLSX workbook structure',
    'deterministic',
    'PASS',
    'Private test adapters generated the same unzipped OOXML entries; ZIP timestamps/compression bytes were excluded.'
  ), async t => {
    const rows = [{ note: 'x\u0001<&>"\'', size: 10 }];
    const columns = ['note', 'size'];
    const range = { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 };
    const leftTable = standalone.results.rowsToColumnarPanelResult(rows, columns);
    const rightTable = reference.results.rowsToColumnarPanelResult(rows, columns);
    const leftBytes = await standalone.xlsx.columnarToXlsx(leftTable, range, true, true, {});
    const rightBytes = await reference.xlsx.columnarToXlsx(rightTable, range, true, true, {});
    const left = await canonical.canonicalXlsxStructure(leftBytes);
    const right = await canonical.canonicalXlsxStructure(rightBytes);
    t.deepEqual(left, right);
    const paths = left.entries.map(entry => entry.path);
    t.ok(paths.includes('xl/worksheets/sheet1.xml'));
    t.ok(paths.includes('xl/workbook.xml'));
    const sheet = left.entries.find(entry => entry.path === 'xl/worksheets/sheet1.xml').content;
    t.match(sheet, /<dimension ref="A1:C2"\/>/);
    t.equal(sheet.includes('\u0001'), false);
    t.match(sheet, /x&lt;&amp;&gt;&quot;&apos;/);
  });
}

async function ipcLifecycleCases(ctx) {
  const { standalone, reference, fixtures, canonical } = ctx;

  await ctx.case(caseDef(
    'ipc-connect-refused-classification',
    'direct IPC refused connection',
    'deterministic',
    'PASS',
    'Both direct clients rejected a closed loopback endpoint as a phase-bearing IPC error without query data.'
  ), async t => {
    const port = await unusedPort();
    const errors = [];
    for (const adapter of [standalone, reference]) {
      const client = new adapter.ipc.KdbIpcClient({ host: '127.0.0.1', port, timeoutMs: 250 });
      errors.push(await captureAsyncError(() => client.connect()));
      await client.close();
    }
    const left = canonical.canonicalError(errors[0], { ports: [port] });
    const right = canonical.canonicalError(errors[1], { ports: [port] });
    t.equal(left.name, 'KdbIpcError');
    t.equal(right.name, 'KdbIpcError');
    t.equal(left.classification, right.classification);
    t.equal(left.phase, 'connect');
    t.equal(right.phase, 'connect');
    t.equal(left.message.includes(String(port)), false);
    t.equal(right.message.includes(String(port)), false);
  });

  await ctx.case(caseDef(
    'ipc-handshake-timeout-classification',
    'direct IPC handshake timeout',
    'deterministic',
    'PASS',
    'A TCP peer that never completes q IPC handshake produced the same phase/timeout class and closed cleanly.'
  ), async t => {
    const errors = [];
    const ports = [];
    for (const adapter of [standalone, reference]) {
      const held = [];
      const server = net.createServer(socket => held.push(socket));
      await listen(server);
      const port = server.address().port;
      ports.push(port);
      const client = new adapter.ipc.KdbIpcClient({ host: '127.0.0.1', port, timeoutMs: 80 });
      try {
        errors.push(await captureAsyncError(() => withDeadline(client.connect(), 1500, 'handshake timeout')));
      } finally {
        await client.close().catch(() => undefined);
        held.forEach(socket => socket.destroy());
        await closeServer(server);
      }
    }
    const left = canonical.canonicalError(errors[0], { ports: [ports[0]] });
    const right = canonical.canonicalError(errors[1], { ports: [ports[1]] });
    t.equal(left.name, 'KdbIpcError');
    t.equal(right.name, 'KdbIpcError');
    t.equal(left.classification, 'handshake-timeout');
    t.equal(right.classification, 'handshake-timeout');
    t.equal(left.phase, right.phase);
  });

  await ctx.case(caseDef(
    'ipc-query-timeout-anonymity',
    'direct IPC query timeout and error anonymity',
    'deterministic',
    'PASS',
    'A stalled issued query timed out in the query phase, destroyed the uncertain transport, and omitted q source text from errors.'
  ), async t => {
    const privateQuery = 'private-cross-parity-query-must-not-leak';
    const errors = [];
    const retryErrors = [];
    const ports = [];
    for (const adapter of [standalone, reference]) {
      const mock = await startMockQServer({ onQuery() {} });
      ports.push(mock.port);
      const client = new adapter.ipc.KdbIpcClient({
        host: '127.0.0.1',
        port: mock.port,
        timeoutMs: 100,
      });
      try {
        await client.connect();
        errors.push(await captureAsyncError(() => withDeadline(client.query(privateQuery), 1500, 'query timeout')));
        retryErrors.push(await captureAsyncError(() => client.query('retry-after-timeout')));
      } finally {
        await client.close().catch(() => undefined);
        await mock.close();
      }
    }
    const left = canonical.canonicalError(errors[0], { ports: [ports[0]] });
    const right = canonical.canonicalError(errors[1], { ports: [ports[1]] });
    t.equal(left.classification, 'query-timeout');
    t.equal(right.classification, 'query-timeout');
    t.equal(errors[0].message.includes(privateQuery), false);
    t.equal(errors[1].message.includes(privateQuery), false);
    t.match(retryErrors[0].message, /not open/);
    t.match(retryErrors[1].message, /not open/);
  });

  await ctx.case(caseDef(
    'ipc-genuine-q-error-and-reuse',
    'genuine q error lifecycle',
    'deterministic',
    'PASS',
    'An encoded q error stayed KdbQError and the same healthy socket served the following query.'
  ), async t => {
    const results = [];
    for (const adapter of [standalone, reference]) {
      let queryCount = 0;
      const mock = await startMockQServer({
        onQuery(socket) {
          queryCount += 1;
          socket.write(queryCount === 1
            ? fixtures.qResponse(fixtures.qError('crossParityQError'))
            : fixtures.qResponse(fixtures.qIntAtom(2)));
        },
      });
      const client = new adapter.ipc.KdbIpcClient({ host: '127.0.0.1', port: mock.port, timeoutMs: 500 });
      try {
        await client.connect();
        const error = await captureAsyncError(() => client.query('bad-query'));
        const value = await client.query('1+1');
        results.push({ error: canonical.canonicalError(error), value, queryCount });
      } finally {
        await client.close();
        await mock.close();
      }
    }
    t.deepEqual(results[0], results[1]);
    t.equal(results[0].error.name, 'KdbQError');
    t.equal(results[0].error.classification, 'q-error');
    t.equal(results[0].value, 2);
    t.equal(results[0].queryCount, 2);
  });

  await ctx.case({
    id: 'ipc-split-timeouts-and-diagnostics',
    area: 'direct IPC timeout and diagnostics ownership',
    mode: 'boundary',
    expectedStatus: 'DIFFERENT_BY_DESIGN',
    rationale: 'Standalone owns split connect/query deadlines plus a KX OutputChannel/redaction schema. The pinned SQLTools adapter retains one timeoutMs and console performance tracing.',
  }, t => {
    const standaloneSource = fs.readFileSync(path.join(standalone.root, 'src', 'q-ipc.ts'), 'utf8');
    const referenceSource = fs.readFileSync(path.join(reference.root, 'src', 'ls', 'q-ipc.ts'), 'utf8');
    t.match(standaloneSource, /connectTimeoutMs\?: number/);
    t.match(standaloneSource, /queryTimeoutMs\?: number/);
    t.equal(/connectTimeoutMs\?: number/.test(referenceSource), false);
    t.equal(/queryTimeoutMs\?: number/.test(referenceSource), false);

    const diagnostics = require(path.join(standalone.root, 'out', 'diagnostics.js'));
    const secret = 'cross-parity-secret';
    const query = 'show private cross parity query';
    const lines = [];
    const output = new diagnostics.KxDiagnostics(
      { appendLine: line => lines.push(line) },
      () => new Date('2026-07-22T00:00:00.000Z')
    );
    output.event({
      phase: 'query',
      endpoint: 'safe.example:5000',
      status: 'failed',
      details: { password: secret, query, token: secret, queryChars: query.length },
      error: new Error(secret),
      secrets: [secret],
    });
    t.equal(lines.length, 1);
    t.equal(lines[0].includes(secret), false);
    t.equal(lines[0].includes(query), false);
    const event = JSON.parse(lines[0]);
    t.equal(event.phase, 'query');
    t.equal(event.status, 'failed');
    t.equal(event.queryChars, query.length);
  });
}

async function localServerCases(ctx) {
  const { standalone, reference, fixtures, canonical } = ctx;

  await ctx.case(caseDef(
    'local-data-server-http-contract',
    'local data server token/range/format behavior',
    'deterministic',
    'PASS',
    'Both loopback servers exercised valid/invalid tokens, methods, endpoints, metadata, current/slice/selection CSV/JSON/NDJSON, headers, ranges, and limits.'
  ), async t => {
    const observed = [];
    for (const adapter of [standalone, reference]) {
      observed.push(await exerciseLocalServer(adapter, fixtures, canonical, t));
    }
    t.deepEqual(observed[0], observed[1]);
  });

  await ctx.case({
    id: 'local-data-server-empty-result-wording',
    area: 'local data server product wording',
    mode: 'deterministic',
    expectedStatus: 'DIFFERENT_BY_DESIGN',
    rationale: 'The same no_current_result protocol code is retained, while user-facing text names the owning KX result versus the SQLTools kdb panel.',
  }, async t => {
    const bodies = [];
    for (const adapter of [standalone, reference]) {
      const preferredPort = await unusedPort();
      const server = new adapter.localServer.LocalDataServer({
        preferredPort,
        provider: { current: () => null },
      });
      try {
        const info = await server.start();
        const response = await httpRequest(`${info.baseUrl}/current.json`);
        const body = JSON.parse(response.body);
        t.equal(response.status, 400);
        t.equal(body.error.code, 'no_current_result');
        bodies.push(body.error.message);
      } finally {
        await server.stop();
      }
    }
    t.match(bodies[0], /KX result/);
    t.match(bodies[1], /kdb panel result/);
    t.ok(bodies[0] !== bodies[1]);
  });
}

async function exerciseLocalServer(adapter, fixtures, canonical, t) {
  const fixture = fixtures.createLocalServerFixture();
  const table = adapter.results.rowsToColumnarPanelResult(fixture.rows, fixture.columns);
  const snapshot = {
    metadata: fixture.metadata,
    table,
    selectionRange: fixture.selectionRange,
    cellTextOptions: fixture.cellTextOptions,
  };
  const server = new adapter.localServer.LocalDataServer({
    preferredPort: await unusedPort(),
    provider: { current: () => snapshot },
  });
  try {
    const info = await server.start();
    t.equal(info.host, '127.0.0.1');
    t.match(info.token, /^[0-9a-f]{48}$/);
    t.equal(server.running, true);
    const transport = { ports: [info.port], tokens: [info.token] };
    const responses = [];
    for (const request of fixture.requests) {
      const response = await httpRequest(`${info.baseUrl}/${request.endpoint}`, request.method);
      t.equal(response.status, request.expectedStatus);
      t.equal(response.headers['cache-control'], 'no-store');
      if (request.expectedErrorCode) {
        t.equal(JSON.parse(response.body).error.code, request.expectedErrorCode);
      }
      responses.push({ id: request.id, response: canonical.canonicalLocalHttp(response, transport) });
    }
    const invalidToken = info.token === '0'.repeat(48) ? 'f'.repeat(48) : '0'.repeat(48);
    const wrongToken = await httpRequest(
      `${info.baseUrl.replace(info.token, invalidToken)}/current.json`
    );
    t.equal(wrongToken.status, 404);
    t.equal(JSON.parse(wrongToken.body).error.code, 'unknown_token');
    responses.push({
      id: 'wrong-token',
      response: canonical.canonicalLocalHttp(wrongToken, {
        ports: [info.port],
        tokens: [info.token, invalidToken],
      }),
    });

    const oversized = fixtures.createOversizedLocalServerFixture(10);
    const oversizedServer = new adapter.localServer.LocalDataServer({
      preferredPort: await unusedPort(),
      fullExportCellLimit: () => oversized.fullExportCellLimit,
      provider: {
        current: () => ({
          metadata: oversized.metadata,
          table: {
            columns: oversized.columns,
            rowCount: oversized.rowCount,
            cellValue: oversized.cellValue,
          },
          selectionRange: null,
          cellTextOptions: {},
        }),
      },
    });
    try {
      const oversizedInfo = await oversizedServer.start();
      const response = await httpRequest(`${oversizedInfo.baseUrl}/current.csv`);
      t.equal(response.status, oversized.expectedStatus);
      t.equal(JSON.parse(response.body).error.code, oversized.expectedErrorCode);
      responses.push({
        id: 'full-export-limit',
        response: canonical.canonicalLocalHttp(response, {
          ports: [oversizedInfo.port],
          tokens: [oversizedInfo.token],
        }),
      });
    } finally {
      await oversizedServer.stop();
    }
    return responses;
  } finally {
    await server.stop();
    t.equal(server.running, false);
  }
}

async function liveQCases(ctx) {
  const { standalone, reference, fixtures, canonical, qPath, liveFixturePath } = ctx;
  const live = await startQ(qPath, liveFixturePath);
  const leftClient = new standalone.ipc.KdbIpcClient({ host: '127.0.0.1', port: live.port, timeoutMs: 2000 });
  const rightClient = new reference.ipc.KdbIpcClient({ host: '127.0.0.1', port: live.port, timeoutMs: 2000 });
  try {
    await leftClient.connect();
    await rightClient.connect();

    for (const fixture of fixtures.LIVE_QUERY_FIXTURES) {
      await ctx.case(caseDef(
        `live-q-${fixture.id}`,
        `live direct-q: ${fixture.family}`,
        'live-q',
        'PASS',
        'Both raw IPC clients queried the same anonymous loopback q process and compared decoded values/errors.'
      ), async t => {
        if (fixture.family === 'error') {
          const leftError = await captureAsyncError(() => leftClient.query(fixture.query));
          const rightError = await captureAsyncError(() => rightClient.query(fixture.query));
          t.deepEqual(canonical.canonicalError(leftError), canonical.canonicalError(rightError));
          t.equal(leftError.name, fixture.expectedErrorName);
          t.match(leftError.message, fixture.expectedErrorPattern);
          t.equal(await leftClient.query('1+1'), 2);
          t.equal(await rightClient.query('1+1'), 2);
          return;
        }
        const leftValue = await leftClient.query(fixture.query);
        const rightValue = await rightClient.query(fixture.query);
        const leftCanonical = canonical.canonicalQValue(leftValue);
        const rightCanonical = canonical.canonicalQValue(rightValue);
        t.deepEqual(leftCanonical, rightCanonical);
        if (fixture.expectedCanonical !== undefined) {
          t.deepEqual(leftCanonical, fixture.expectedCanonical);
        }
        if (fixture.expectedColumns) {
          t.deepEqual(leftValue.columns, fixture.expectedColumns);
          t.deepEqual(rightValue.columns, fixture.expectedColumns);
        }
        if (fixture.expectedFunctionType) {
          t.equal(leftValue.functionType, fixture.expectedFunctionType);
          t.equal(rightValue.functionType, fixture.expectedFunctionType);
        }

        const leftPanel = canonical.canonicalPanel(standalone.ipc.qValueToColumnarPanel(leftValue));
        const rightPanel = canonical.canonicalPanel(reference.ipc.qValueToColumnarPanel(rightValue));
        t.deepEqual(leftPanel, rightPanel);
      });
    }

    for (const fixture of fixtures.LIVE_NAMESPACE_FIXTURES) {
      await ctx.case(caseDef(
        `live-namespace-${fixture.id}`,
        'live direct-q namespace execution/restoration',
        'live-q',
        'PASS',
        'Both namespace wrappers ran against the same q process and restored the prior root namespace on success/error.'
      ), async t => {
        const leftQuery = standalone.namespace.queryInNamespace(fixture.query, fixture.namespace);
        const rightQuery = reference.namespace.queryInNamespace(fixture.query, fixture.namespace);
        if (fixture.expectedErrorPattern) {
          const leftError = await captureAsyncError(() => leftClient.query(leftQuery));
          const rightError = await captureAsyncError(() => rightClient.query(rightQuery));
          t.equal(leftError.name, 'KdbQError');
          t.equal(rightError.name, 'KdbQError');
          t.match(leftError.message, fixture.expectedErrorPattern);
          t.match(rightError.message, fixture.expectedErrorPattern);
        } else {
          t.deepEqual(await leftClient.query(leftQuery), fixture.expected);
          t.deepEqual(await rightClient.query(rightQuery), fixture.expected);
        }
        t.equal(await leftClient.query('string system "d"'), '.');
        t.equal(await rightClient.query('string system "d"'), '.');
      });
    }

    await ctx.case({
      id: 'live-q-multiline-script-grouping',
      area: 'live direct-q multiline script grouping',
      mode: 'live-q',
      expectedStatus: 'GAP',
      rank: 2,
      action: 'Backport a compatible q-native script-grouping adapter to the SQLTools driver without changing its UI/session ownership.',
      signoff: 'The shared LF and CRLF script fixtures return 30 and 5 through both adapters and restore the root namespace after success/error.',
      detail: 'The standalone .Q.ld wrapper succeeds; the pinned reference raw value wrapper raises a genuine q error for the same multiline source.',
    }, async t => {
      await leftClient.query('system "d .standaloneParityScript";system "d ."');
      await rightClient.query('system "d .referenceParityScript";system "d ."');
      const failures = [];
      for (const fixture of fixtures.SCRIPT_GROUPING_FIXTURES.filter(item => item.expectedExecutionKind === 'script')) {
        const left = await leftClient.query(standalone.namespace.qScriptInNamespace(
          fixture.text,
          '.standaloneParityScript'
        ));
        t.equal(left, fixture.expectedLiveResult);
        const rightError = await captureAsyncError(() => rightClient.query(
          reference.namespace.queryInNamespace(fixture.text, '.referenceParityScript')
        ));
        t.equal(rightError.name, 'KdbQError');
        failures.push(rightError.name);
      }
      t.deepEqual(failures, ['KdbQError', 'KdbQError']);
      t.equal(await leftClient.query('string system "d"'), '.');
      t.equal(await rightClient.query('string system "d"'), '.');
    });
  } finally {
    await Promise.all([
      leftClient.close().catch(() => undefined),
      rightClient.close().catch(() => undefined),
    ]);
    await live.stop();
  }
}

async function boundaryCases(ctx) {
  const { standalone, reference, roots, liveFixturePath } = ctx;

  await ctx.case(caseDef(
    'manifest-standalone-runtime-boundary',
    'standalone manifest/package boundary',
    'boundary',
    'PASS',
    'The standalone manifest/lock version stayed aligned. Its only SQLTools boundary is an explicit, one-shot read of legacy KDB settings for migration; no SQLTools runtime, extension dependency, contributed setting, SQLTools-owned command, session behavior, or source import entered the KX package.'
  ), t => {
    const packageLock = JSON.parse(fs.readFileSync(path.join(standalone.root, 'package-lock.json'), 'utf8'));
    t.equal(standalone.packageJson.version, packageLock.version);
    t.equal(standalone.packageJson.version, packageLock.packages[''].version);
    const dependencyNames = Object.keys(standalone.packageJson.dependencies || {});
    t.deepEqual(dependencyNames.sort(), ['jszip', 'uplot']);
    t.equal(Array.isArray(standalone.packageJson.extensionDependencies), false);
    const manifestText = JSON.stringify(standalone.packageJson);
    t.equal(/@sqltools|sqltools\./i.test(manifestText), false);
    t.ok(standalone.packageJson.contributes.commands.some(item =>
      item.command === 'vscode-kdb.importSqlToolsConnections' &&
      item.title === 'KX: Import SQLTools KDB Connections'));
    const sources = readFilesRecursively(path.join(standalone.root, 'src'), '.ts');
    t.ok(sources.length > 0);
    for (const filename of sources) {
      const source = fs.readFileSync(filename, 'utf8');
      t.equal(/@sqltools|sqltools\./i.test(source), false);
    }
    const migrationSource = fs.readFileSync(
      path.join(standalone.root, 'src', 'connection-migration.ts'),
      'utf8'
    );
    t.match(migrationSource, /getConfiguration\(SQLTOOLS_CONFIGURATION_SECTION/);
    for (const alias of ['KDB', 'kdb+', 'kdb', 'kdb-sqltools', 'DanielAlonso.kdb-sqltools']) {
      t.ok(migrationSource.includes(`'${alias}'`));
    }
    t.equal(
      /@sqltools\/|\.session\.sql|extensions\.getExtension|sshOptions|(?:registerCommand|executeCommand)\(\s*['"]sqltools\./i
        .test(migrationSource),
      false
    );
  });

  await ctx.case({
    id: 'manifest-product-ux-ownership',
    area: 'KX versus SQLTools product ownership',
    mode: 'boundary',
    expectedStatus: 'DIFFERENT_BY_DESIGN',
    rationale: 'Standalone owns the KX sidebar/form, SecretStorage, focused Server Explorer, Query History, one KX result target, and a one-shot legacy-settings migration review. Reference owns SQLTools driver/session/UI targets and its extension dependency.',
  }, t => {
    t.ok(standalone.packageJson.contributes.viewsContainers.activitybar.some(item => item.id === 'vscode-kdb'));
    t.ok(standalone.packageJson.contributes.commands.some(item => item.command === 'vscode-kdb.addConnection'));
    t.ok(standalone.packageJson.contributes.commands.some(item => item.command === 'vscode-kdb.runScript'));
    t.equal(standalone.packageJson.extensionDependencies, undefined);
    t.ok(reference.packageJson.extensionDependencies.includes('mtxr.sqltools'));
    t.ok(Object.keys(reference.packageJson.dependencies || {}).some(name => name.startsWith('@sqltools/')));
    const storeSource = fs.readFileSync(path.join(standalone.root, 'src', 'connection-store.ts'), 'utf8');
    t.match(storeSource, /context\.secrets\.(?:get|store|delete)/);
  });

  await ctx.case({
    id: 'standalone-extension-host-automation',
    area: 'standalone Extension Host automation',
    mode: 'boundary',
    expectedStatus: 'GAP',
    rank: 1,
    action: 'Add a standalone Extension Host suite for activation, KX connection tree/form/SecretStorage, commands, result-panel protocol, cancellation, and settings without importing SQLTools.',
    signoff: 'The suite runs in CI and locally on a supported VS Code build from a clean standalone commit.',
    detail: 'Reference has test/e2e; standalone has deterministic host-free tests but no test/e2e directory or Extension Host workflow.',
  }, t => {
    t.equal(fs.existsSync(path.join(standalone.root, 'test', 'e2e')), false);
    t.equal(fs.existsSync(path.join(reference.root, 'test', 'e2e', 'run.js')), true);
  });

  await ctx.case({
    id: 'extension-host-visual-manual',
    area: 'VS Code Extension Host and visual/manual UX',
    mode: 'boundary',
    expectedStatus: 'NOT_TESTABLE_HERE',
    rationale: 'Neither code nor code-insiders is installed, and this repository has no truthful cross-extension visual browser/Extension Host fixture. Source and webview parsing are not visual evidence.',
    signoff: 'Record supported VS Code runs for activation, theme/layout, virtual scrolling, selection/keyboard, chart zoom/reset, settings, error states, and screenshots where useful.',
  }, t => {
    t.equal(commandOnPath('code'), false);
    t.equal(commandOnPath('code-insiders'), false);
  });

  await ctx.case({
    id: 'authenticated-q-endpoint',
    area: 'authenticated direct q IPC',
    mode: 'boundary',
    expectedStatus: 'NOT_TESTABLE_HERE',
    rationale: 'The shared fixture is deliberately anonymous and loopback-only; no authenticated endpoint was available or invented.',
    signoff: 'Run accepted and rejected credentials against an authorized real q endpoint and verify SecretStorage/error redaction without recording credentials.',
  }, t => {
    const fixtureSource = fs.readFileSync(liveFixturePath, 'utf8');
    t.equal(fixtureSource.includes('.z.pw'), false);
  });

  await ctx.case({
    id: 'remote-secure-endpoints',
    area: 'SSH/TLS/IPv6/remote endpoint behavior',
    mode: 'boundary',
    expectedStatus: 'NOT_TESTABLE_HERE',
    rationale: 'Only anonymous IPv4 loopback direct q was authorized. No SSH/TLS service, remote host, IPv6 listener, or multi-version q matrix was available.',
    signoff: 'Record separately authorized endpoint tests for every supported transport/address/q-version claim; keep standalone direct-only unless product scope changes.',
  });

  await ctx.case({
    id: 'xlsx-application-rendering',
    area: 'spreadsheet application rendering',
    mode: 'boundary',
    expectedStatus: 'NOT_TESTABLE_HERE',
    rationale: 'The gate proves OOXML ZIP structure and limits but no Excel/LibreOffice GUI application was available for visual rendering.',
    signoff: 'Open representative exports in supported spreadsheet applications and record data, escaping, dimensions, and limits.',
  });

  await ctx.case({
    id: 'marketplace-package-publication',
    area: 'VSIX install and Marketplace publication',
    mode: 'boundary',
    expectedStatus: 'NOT_TESTABLE_HERE',
    rationale: 'The executable parity gate does not package or install a VSIX and is not authorized to upload to Marketplace. The 0.2.5 archive inventory and hashes must be verified separately by the release gate.',
    signoff: 'Record a clean supported Extension Host installation separately; require explicit authorization before any future Marketplace identity, credential, or upload check.',
  }, t => {
    t.equal(standalone.packageJson.version, '0.2.5');
    t.equal(reference.packageJson.version, '0.3.17');
  });

  await ctx.case({
    id: 'server-side-cancellation-after-dispatch',
    area: 'server-side q cancellation after dispatch',
    mode: 'boundary',
    expectedStatus: 'NOT_TESTABLE_HERE',
    rationale: 'Both public products document local wait/transport cancellation limits; the harness does not claim reliable interruption of already-dispatched q work.',
    signoff: 'Define an authorized server interruption protocol and prove side-effect/cancellation semantics before claiming server-side cancellation.',
  });

  await ctx.case(caseDef(
    'documentation-no-complete-parity-claim',
    'documentation conclusion boundary',
    'boundary',
    'PASS',
    'Current standalone documentation explicitly denies complete functional/visual parity and defers source-of-truth sign-off.'
  ), t => {
    for (const relative of ['README.md', 'PARITY.md', 'mkdocs-src/parity-roadmap.md']) {
      const text = fs.readFileSync(path.join(roots.standalone, relative), 'utf8');
      t.match(text, /not|no|remain|pending|before/i);
      t.equal(/complete functional and visual parity (?:is|has been) achieved/i.test(text), false);
    }
  });
}

function caseDef(id, area, mode, expectedStatus, detail) {
  return { id, area, mode, expectedStatus, detail };
}

function normalizeSharedDisplayOptions(options) {
  const normalized = { ...(options || {}) };
  for (const key of [
    'functionDisplayStrategy',
    'dictionaryDisplayStrategy',
    'listDisplayStrategy',
    'objectDisplayStrategy',
  ]) {
    if (normalized[key] === 'text') {
      normalized[key] = 'qText';
    } else if (normalized[key] === 'table') {
      normalized[key] = 'grid';
    }
  }
  return normalized;
}

function captureSyncError(operation) {
  try {
    operation();
  } catch (error) {
    return error;
  }
  throw new Error('Expected synchronous operation to throw.');
}

async function captureAsyncError(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error('Expected asynchronous operation to reject.');
}

function validateContext(ctx) {
  for (const key of ['case', 'standalone', 'reference', 'fixtures', 'canonical', 'qPath', 'roots', 'liveFixturePath']) {
    if (!ctx || !ctx[key]) {
      throw new Error(`Parity suite context is missing ${key}.`);
    }
  }
}

function readFilesRecursively(root, extension) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const filename = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...readFilesRecursively(filename, extension));
    } else if (entry.isFile() && filename.endsWith(extension)) {
      files.push(filename);
    }
  }
  return files.sort();
}

function commandOnPath(command) {
  const executable = process.platform === 'win32' ? `${command}.cmd` : command;
  return String(process.env.PATH || '').split(path.delimiter).filter(Boolean).some(directory => {
    try {
      fs.accessSync(path.join(directory, executable), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

async function startMockQServer(options) {
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
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
        const length = buffered.readInt32LE(4);
        if (length < 8) {
          socket.destroy(new Error(`Invalid mock q IPC frame length ${length}`));
          return;
        }
        if (buffered.length < length) {
          return;
        }
        const frame = buffered.subarray(0, length);
        buffered = buffered.subarray(length);
        options.onQuery(socket, frame);
      }
    });
  });
  await listen(server);
  return {
    port: server.address().port,
    async close() {
      sockets.forEach(socket => socket.destroy());
      await closeServer(server);
    },
  };
}

async function startQ(qPath, fixturePath) {
  const port = await unusedPort();
  const child = cp.spawn(qPath, [fixturePath, '-p', `127.0.0.1:${port}`], {
    cwd: path.dirname(path.dirname(fixturePath)),
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  let spawnError;
  const capture = chunk => {
    output = `${output}${chunk}`.slice(-12000);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.once('error', error => {
    spawnError = error;
  });

  try {
    await waitForPort(port, () => ({ child, output, spawnError }), 15000);
  } catch (error) {
    await stopQ(child);
    throw error;
  }
  return { port, stop: () => stopQ(child) };
}

async function stopQ(child) {
  if (!child || child.exitCode !== null || child.signalCode) {
    return;
  }
  try {
    child.stdin.write('\\\\\n');
    child.stdin.end();
  } catch {
    child.kill('SIGTERM');
  }
  const exited = await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => setTimeout(() => resolve(false), 1500)),
  ]);
  if (exited === false && child.exitCode === null && !child.signalCode) {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 1000)),
    ]);
  }
}

function waitForPort(port, state, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const current = state();
      if (current.spawnError) {
        reject(current.spawnError);
        return;
      }
      if (current.child.exitCode !== null || current.child.signalCode) {
        reject(new Error(`q exited before listening on ${port}.\n${current.output}`));
        return;
      }
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.end();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - started >= timeoutMs) {
          reject(new Error(`Timed out waiting for q on 127.0.0.1:${port}.\n${current.output}`));
          return;
        }
        setTimeout(attempt, 50);
      });
    };
    attempt();
  });
}

function httpRequest(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        url,
      }));
    });
    request.once('error', reject);
    request.setTimeout(3000, () => request.destroy(new Error(`HTTP request timed out: ${method} ${url}`)));
    request.end();
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    const onError = error => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(error => {
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function unusedPort() {
  const server = net.createServer();
  await listen(server);
  const port = server.address().port;
  await closeServer(server);
  return port;
}

async function withDeadline(promise, timeoutMs, label) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { runParitySuite };
