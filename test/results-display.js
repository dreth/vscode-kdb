'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.resolve(__dirname, '..');
function testAutoFitActivation() {
    const source = fs.readFileSync(path.join(root, 'src/kx-results-panel.ts'), 'utf8');
    const body = source.match(/function setAutoFitEnabled\(enabled\) \{([\s\S]*?)\n      function updateAutoColumnWidthsFromSlice/)[0].replace(/\n      function updateAutoColumnWidthsFromSlice$/, '');
    const messages = [];
    const context = {
        settings: { autoFitColumns: false, columnWidths: { 0: 220, 2: 330, 99: 440 } },
        data: { columns: ['b', 'a'], columnPositions: [2, 0] },
        columnWidthOverrides: { 0: 220, 2: 330, 99: 440 },
        columnWidthKey: i => String([2, 0][i]),
        updateSetting: () => { }, status: {},
        vscode: { postMessage: m => messages.push(m) },
    };
    vm.runInNewContext(body + '\nsetAutoFitEnabled(true);', context);
    assert.deepStrictEqual(Object.keys(context.settings.columnWidths), ['99'], 'explicit autofit must clear current manual widths');
    assert.strictEqual(messages.filter(m => m.type === 'setResultColumnWidth' && m.width === 0).length, 2);
}
testAutoFitActivation();
function testAutoFitReapply() {
    const source = fs.readFileSync(path.join(root, 'src/kx-results-panel.ts'), 'utf8');
    const body = source.match(/function setAutoFitEnabled\(enabled\) \{([\s\S]*?)\n      function updateAutoColumnWidthsFromSlice/)[0].replace(/\n      function updateAutoColumnWidthsFromSlice$/, '');
    const messages = [];
    const updates = [];
    const context = {
        settings: { autoFitColumns: true, autoFitMode: 'visibleRows', columnWidths: { 0: 220, 2: 330, 99: 440 } },
        data: { columns: ['b', 'a'], columnPositions: [2, 0] },
        columnWidthOverrides: { 0: 220, 2: 330, 99: 440 },
        columnWidthKey: i => String([2, 0][i]),
        updateSetting: (key, value) => { context.settings[key] = value; updates.push([key, value]); },
        refreshAutoColumnWidths: () => {}, renderColumnSettings: () => {}, requestRender: () => {},
        status: {},
        vscode: { postMessage: m => messages.push(m) },
    };
    vm.runInNewContext(body + '\nfitColumnsNow();', context);
    assert.deepStrictEqual(Object.keys(context.settings.columnWidths), ['99'], 'Fit now must clear current widths even while autofit is already enabled');
    assert.deepStrictEqual(updates, [['autoFitColumns', true]]);
    assert.strictEqual(messages.filter(m => m.type === 'setResultColumnWidth' && m.width === 0).length, 2);
    assert.strictEqual(messages.some(m => m.type === 'query' || m.type === 'rerun'), false, 'Fit now must not execute q');
}
testAutoFitReapply();
function testVisibleAutoFitUsesScreenText() {
    const source = fs.readFileSync(path.join(root, 'src/kx-results-panel.ts'), 'utf8');
    const body = source.match(/function updateAutoColumnWidthsFromSlice\(\) \{[\s\S]*?\n      function refreshAutoColumnWidths/)[0]
        .replace(/\n      function refreshAutoColumnWidths$/, '');
    const context = {
        settings: { autoFitMode: 'visibleRows' }, autoFitEnabled: true,
        data: { columns: ['label'] }, slice: { startRow: 0, startColumn: 0, endColumn: 0, cells: [['ii'], ['WW']] },
        viewport: { scrollTop: 0, clientHeight: 20 }, layout: { rowHeight: 20, headerHeight: 0 },
        hasVisibleSliceColumns: () => true, columnWidthKey: () => '0',
        scrollStateForViewport: () => ({ rowOffset: context.viewport.scrollTop }),
        measuredRenderedTextWidth: (value) => value === 'WW' ? 250 : 90,
        clampInteger: (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
        MIN_COLUMN_WIDTH: 80, AUTO_COLUMN_WIDTH_CAP: 1200,
    };
    vm.runInNewContext(body + '\nupdateAutoColumnWidthsFromSlice();', context);
    assert.strictEqual(context.autoColumnWidths['0'], 90, 'an offscreen wide value must not determine the checked visible fit');
    context.viewport.scrollTop = 20;
    vm.runInNewContext('updateAutoColumnWidthsFromSlice();', context);
    assert.strictEqual(context.autoColumnWidths['0'], 250, 'scrolling within the same loaded slice must update the fitted width');
}
testVisibleAutoFitUsesScreenText();
function testNotebookVisibleTextMeasurement() {
    const ts = require('../node_modules/typescript');
    const source = fs.readFileSync(path.join(root, 'renderer/index.ts'), 'utf8');
    const body = source.match(/function renderedColumnWidths\([\s\S]*?\n}\n\nfunction liveColumnWidths/)[0]
        .replace(/\n\nfunction liveColumnWidths$/, '');
    const javascript = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const sizing = require('../out/column-sizing');
    const context = {
        resultSettings: { fontSize: 13 }, measuredColumnRenderedTextWidth: sizing.measuredColumnRenderedTextWidth,
        getComputedStyle: () => ({ fontSize: '13px', fontFamily: 'sans-serif' }),
        document: { createElement: () => ({ getContext: () => ({ measureText: value => ({ width: Array.from(value).reduce((sum, char) => sum + (char === 'W' ? 20 : 4), 0) }) }) }) },
        automaticColumnWidthsForLengths: sizing.automaticColumnWidthsForLengths,
    };
    vm.runInNewContext(javascript + '\nthis.fit = renderedColumnWidths;', context);
    const state = { element: { querySelector: () => null } };
    assert.strictEqual(context.fit(state, ['x'], [['iiii']])[0], 80);
    assert.strictEqual(context.fit(state, ['x'], [['WWWW']])[0], 112);
}
testNotebookVisibleTextMeasurement();
function testNotebookVisibleWindows() {
    const ts = require('../node_modules/typescript');
    const source = fs.readFileSync(path.join(root, 'renderer/index.ts'), 'utf8');
    const extract = (start, next) => ts.transpileModule(
        source.match(new RegExp(`function ${start}\\([\\s\\S]*?\\n}\\n\\nfunction ${next}`))[0]
            .replace(new RegExp(`\\n\\nfunction ${next}$`), ''),
        { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
    ).outputText;
    const liveContext = {
        resultSettings: { rowHeight: 20 }, LIVE_HEADER_HEIGHT: 0,
        liveVirtualScrollTop: state => state.liveScrollTop,
        liveViewportHeight: () => 20,
        renderedColumnWidths: (_state, _headers, rows) => rows.map(row => row[0]),
    };
    vm.runInNewContext(extract('liveVisibleColumnWidths', 'liveColumnTextLengths') + '\nthis.fitLive = liveVisibleColumnWidths;', liveContext);
    const live = { liveScrollTop: 0, liveColumns: ['x'], liveSlice: { startRow: 0, startColumn: 0, endColumn: 0, cells: [['ii'], ['WW']] } };
    assert.deepStrictEqual(Array.from(liveContext.fitLive(live)), ['ii']);
    live.liveScrollTop = 20;
    assert.deepStrictEqual(Array.from(liveContext.fitLive(live)), ['WW']);
    const savedContext = {
        resultSettings: { rowHeight: 20, arrayDisplayFormat: 'commaSpace', tableDecimalPlaces: -1 },
        window: { innerHeight: 200 },
        portableCellToBoundedText: cell => ({ text: cell }),
        portableTableRow: require('../out/notebook-contract').portableTableRow,
        renderedColumnWidths: (_state, _headers, rows) => rows.map(row => row[0]),
    };
    vm.runInNewContext(extract('savedVisibleColumnWidths', 'savedWholeResultColumnTextLengths') + '\nthis.fitSaved = savedVisibleColumnWidths;', savedContext);
    const saved = { savedScrollTop: 0, savedViewport: { clientHeight: 64 } };
    const payload = { schema: { columns: [{ name: 'x', type: 'symbol' }] }, data: { encoding: 'rows', rows: [['ii'], ['WW']] } };
    assert.deepStrictEqual(Array.from(savedContext.fitSaved(saved, payload, [0], [0, 1], 0, 2, 100)), ['symbol', 'ii']);
    saved.savedScrollTop = 20;
    assert.deepStrictEqual(Array.from(savedContext.fitSaved(saved, payload, [0], [0, 1], 0, 2, 100)), ['symbol', 'WW']);
}
testNotebookVisibleWindows();
function testNotebookScrollUpdatesKeepViewport() {
    const ts = require('../node_modules/typescript');
    const source = fs.readFileSync(path.join(root, 'renderer/index.ts'), 'utf8');
    const liveBody = source.match(/function refreshLiveViewport\([\s\S]*?\n}\n\nfunction decorateDisplayedColumn/)[0]
        .replace(/\n\nfunction decorateDisplayedColumn$/, '');
    const liveCode = ts.transpileModule(liveBody, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const viewport = { scrollTop: 420, scrollLeft: 180, clientWidth: 600, clientHeight: 120 };
    const canvas = {
        style: {},
        replaceChildren() {
            viewport.scrollTop = 0;
            viewport.scrollLeft = 0;
        },
        append() {},
    };
    const requested = [];
    const liveState = {
        liveViewport: viewport, liveCanvas: canvas, liveRowCount: 100,
        liveScrollTop: 420, liveScrollLeft: 180,
        liveSliceError: undefined,
    };
    const liveContext = {
        resultSettings: { showRowIndex: false, cellWidth: 120 },
        LIVE_ROW_INDEX_WIDTH: 64,
        liveColumnWidths: () => [120],
        variableColumnMetrics: () => ({ totalWidth: 120, widths: [120] }),
        liveCanvasHeight: () => 2000,
        liveWindow: () => ({ startRow: 20, endRow: 30, startColumn: 0, endColumn: 0 }),
        renderLiveHeaders: () => {}, renderLiveCells: () => {},
        syncLiveActiveDescendant: () => {},
        sliceContainsWindow: () => false,
        requestLiveSlice: (_context, _state, window) => requested.push(window),
    };
    vm.runInNewContext(liveCode + '\nthis.refresh = refreshLiveViewport;', liveContext);
    liveContext.refresh({}, liveState);
    assert.strictEqual(viewport.scrollTop, 420, 'virtual row replacement must preserve vertical scroll');
    assert.strictEqual(viewport.scrollLeft, 180, 'virtual column replacement must preserve horizontal scroll');
    assert.strictEqual(requested[0].startRow, 20, 'the scrolled row window must still be requested');
    assert.match(source, /\.kx-live-viewport\{[^}]*overflow-anchor:none/);

    const savedBody = source.match(/let fittedFirstRow = [\s\S]*?\n  wrap\.addEventListener\('keydown'/)[0]
        .replace(/\n  wrap\.addEventListener\('keydown'$/, '');
    const savedCode = ts.transpileModule(savedBody, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const handlers = {};
    const wrap = {
        scrollTop: 40, scrollLeft: 30, isConnected: true,
        addEventListener(name, callback) { handlers[name] = callback; },
    };
    const cols = [{ style: {} }, { style: {} }, { style: {} }];
    const table = { style: {} };
    let widthMeasurements = 0;
    const savedContext = {
        state: { savedScrollTop: 0, savedScrollLeft: 0 }, wrap,
        resultSettings: { rowHeight: 20, autoFitColumns: true, autoFitMode: 'visibleRows', showRowIndex: true },
        savedColumnWidths: () => { widthMeasurements++; return [150, 200]; },
        payload: {}, visibleColumns: [0, 1], rowOrder: [], pageStart: 0, pageEnd: 5,
        savedCellTextLimit: 100, colgroup: { children: cols }, table,
        LIVE_ROW_INDEX_WIDTH: 64,
        renderState: () => { throw new Error('scroll must not replace the saved viewport'); },
    };
    const guard = ts.createSourceFile('renderer.ts', source, ts.ScriptTarget.Latest, true).statements
        .find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'guardRendererCallback');
    savedContext.failureReporting = { enabled: false };
    vm.runInNewContext(ts.transpileModule(guard.getText(), {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText + savedCode, savedContext);
    handlers.scroll();
    assert.strictEqual(widthMeasurements, 1);
    assert.strictEqual(cols[1].style.width, '150px');
    assert.strictEqual(cols[2].style.width, '200px');
    assert.strictEqual(table.style.width, '414px');
    assert.strictEqual(wrap.scrollTop, 40);
    assert.strictEqual(wrap.scrollLeft, 30);
    handlers.scroll();
    assert.strictEqual(widthMeasurements, 1, 'same visible row must not repeat width measurement');
    assert.match(source, /\.kx-table-wrap\{[^}]*overflow-anchor:none/);
}
testNotebookScrollUpdatesKeepViewport();
console.log('Results display tests passed');
const numbers = require('../out/number-display');
const q = require('../out/q-value');
const results = require('../out/kx-results');
const notebook = require('../out/notebook-contract');
const { KX_RESULT_SETTING_DEFINITIONS } = require('../out/results-ui-contract');
for (const invalid of [undefined, null, 0, -1, NaN, Infinity, '1000']) {
    assert.strictEqual(numbers.scientificNotationThreshold(invalid), 1e6);
}
for (const value of [1e6, -1e6, 1e12, -1e12]) {
    assert.strictEqual(numbers.formatNumericAxis(value, 4, 1e6), value.toExponential(4));
}
assert(!numbers.formatNumericAxis(999999, 2, 1e6).includes('e'));
assert(!numbers.formatNumericAxis(0, 2, 1e6).includes('e'));
assert.strictEqual(numbers.formatNumericAxis(1e4, 2, 1e4), '1.00e+4');
assert.strictEqual(numbers.formatNumericAxis(0.00001, 2, 1e6), '1.00e-5');
for (const places of [-1, 0, 2, 12]) {
    const options = { tableDecimalPlaces: places };
    for (const type of ['float', 'real']) {
        const atom = q.qAtom(type, 1.23456);
        const before = q.qValueToPortableNode(atom);
        const expected = places < 0 ? '1.23456' : (1.23456).toFixed(places);
        assert.strictEqual(results.cellValueToText(atom, options), expected);
        assert.strictEqual(results.cellValueToBoundedText(atom, 100, options).text, expected);
        const cell = { kind: 'q', value: before };
        assert.strictEqual(notebook.portableCellText(cell, options), expected);
        assert.strictEqual(notebook.portableCellToBoundedText(cell, 100, options).text, expected);
        assert.deepStrictEqual(q.qValueToPortableNode(atom), before);
        assert.strictEqual(results.cellValueToBoundedExportText(atom, 100, options).text, '1.23456');
        const vector = q.qVector([1.23456, 5.6789], type);
        const nested = q.qVector([vector, q.qAtom('int', 3)], 'mixed');
        const text = results.cellValueToBoundedText(nested, 100, options).text;
        assert(text.includes(expected));
        assert(text.endsWith(';3)'));
        const saved = { kind: 'q', value: q.qValueToPortableNode(nested) };
        assert.strictEqual(notebook.portableCellToBoundedText(saved, 100, options).text, text);
    }
    for (const value of [q.qAtom('int', 3), q.qAtom('long', '9007199254740993'), q.qAtom('timestamp', '1234567890123456'), q.qAtom('float', q.qSpecial('null')), q.qAtom('float', q.qSpecial('negativeInfinity')), '1.23456']) {
        assert.strictEqual(results.cellValueToText(value, options), results.cellValueToText(value));
    }
}
for (const invalid of [NaN, Infinity, -2, 13, 1.5, '2']) {
    assert.strictEqual(numbers.tableDecimalPlaces(invalid), -1);
    assert.strictEqual(results.cellValueToText(q.qAtom('float', 1.23456), { tableDecimalPlaces: invalid }), '1.23456');
}
const quick = KX_RESULT_SETTING_DEFINITIONS.filter(d => d.quick !== false).map(d => d.key);
assert(quick.includes('tableDecimalPlaces') && quick.includes('chartDecimalPlaces'));
for (const hidden of ['arrayDisplayFormat', 'elapsedTimeDisplay', 'copyExportConfirmCellThreshold', 'chartMaxSourceRows'])
    assert(!quick.includes(hidden));
const panelSource = fs.readFileSync(path.join(root, 'src/kx-results-panel.ts'), 'utf8');
for (const id of ['settingsArrayDisplayFormat', 'settingsElapsedTimeDisplay', 'settingsChartMaxSourceRows', 'settingsLargeSortWarningRowThreshold', 'settingsCopyExportConfirmCellThreshold', 'settingsLocalDataServerFullExportCellLimit'])
    assert(!panelSource.includes(`id="${id}"`));
console.log('Numeric formatting and quick-settings regressions passed');
