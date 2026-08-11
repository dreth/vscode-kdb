'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const POLL_MS = 100;
const TIMEOUT_MS = 50_000;
const STATE_TIMEOUT_MS = 5_000;
const STATE_PROBE_TIMEOUT_MS = 500;
const CDP_COMMAND_TIMEOUT_MS = 5_000;
const INPUT_ACK_TIMEOUT_MS = 250;
const NATIVE_VIEWPORT_MARGIN_PX = 48;

async function runNotebookVisualAcceptance({ port, controlDir }) {
  const markerPath = path.join(controlDir, 'notebook-reopened-ready.json');
  const resultPath = path.join(controlDir, 'notebook-visual-result.json');
  const setupDeadline = Date.now() + TIMEOUT_MS;
  let session;
  const waitState = async (_client, predicate, label, stableMs = 0) => {
    const deadline = Date.now() + STATE_TIMEOUT_MS;
    let latest;
    let latestProbeFailure;
    let missingStates = 0;
    let matchingSince;
    while (Date.now() < deadline) {
      latest = await notebookState(session.webview).catch(() => undefined);
      latestProbeFailure = latest === undefined
        ? session.webview.lastEvaluationFailure
        : undefined;
      if (latest && predicate(latest)) {
        matchingSince ??= Date.now();
        if (Date.now() - matchingSince >= stableMs) return latest;
      } else {
        matchingSince = undefined;
      }
      missingStates = latest === undefined ? missingStates + 1 : 0;
      if (missingStates >= 2) {
        const previous = session;
        previous?.webview.close();
        previous?.root.close();
        try {
          // A native event that synchronously rebuilds the renderer can omit its
          // CDP acknowledgement. Release that stale root session before opening
          // another debugger connection to the same workbench target.
          await delay(POLL_MS);
          session = await findNotebookWebview(
            port,
            Math.max(1, deadline - Date.now())
          );
          missingStates = 0;
          matchingSince = undefined;
          continue;
        } catch (error) {
          latestProbeFailure = error && error.stack ? error.stack : String(error);
          // The replacement webview can appear between target inventory polls.
        }
      }
      await delay(POLL_MS);
    }
    throw new Error(
      `Timed out waiting for ${label}; last state ${JSON.stringify(latest)}; ` +
      `last probe failure ${String(latestProbeFailure || 'none')}`
    );
  };
  try {
    await waitForJson(markerPath, 'reopened notebook marker', setupDeadline);
    session = await findNotebookWebview(
      port,
      remainingTime(setupDeadline, 'reopened KX notebook renderer')
    );
    const initial = await waitState(
      session.webview,
      state => state && state.metricValues.length === 30 && state.metricSort === 'none',
      'saved KX table'
    );
    assertExactRowOrder(initial, expectedSourceRows(), 'source');
    const resizeHandleSelector =
      '.kx-table-wrap th[data-kx-source-ordinal="1"] .kx-column-resize-handle';
    const focusResizeHandle = async () => {
      await nativeClick(
        session,
        `document.querySelector('input[aria-label="Search saved result rows"]')`
      );
      await nativeTabTo(session, resizeHandleSelector);
    };
    await nativeClick(session, `document.querySelector('input[aria-label="Search saved result rows"]')`);
    await session.root.send('Input.insertText', { text: 'definitely absent' });
    const completedSearch = await waitState(
      session.webview,
      state => state.savedSearchValue === 'definitely absent' &&
        state.savedSearchStatus === 'No matches' && state.savedSearchFocused,
      'incremental saved no-match search with retained native focus'
    );
    await nativeDragBy(
      session,
      resizeHandleSelector,
      60
    );
    const resized = await waitState(
      session.webview,
      state => state.resizeWidth > initial.resizeWidth + 30,
      'native saved-column resize'
    );
    await nativeDoubleClick(
      session,
      resizeHandleSelector
    );
    const resizedReset = await waitState(
      session.webview,
      state => Math.abs(state.resizeWidth - initial.resizeWidth) <= 2,
      'settled native saved-column width reset',
      500
    );
    await focusResizeHandle();
    const keyboardFocusRestores = [];
    await beginResizeKeyProbe(session);
    await dispatchNativeKey(session.root, 'ArrowRight', 'ArrowRight', 39);
    keyboardFocusRestores.push(await assertResizeKeyProbe(
      session,
      'first keyboard saved-column resize',
      'ArrowRight',
      initial.resizeWidth + 10
    ));
    await waitState(
      session.webview,
      state => Math.abs(state.resizeWidth - (initial.resizeWidth + 10)) <= 2,
      'settled first keyboard saved-column resize',
      500
    );
    await focusResizeHandle();
    await beginResizeKeyProbe(session);
    await dispatchNativeKey(session.root, 'ArrowRight', 'ArrowRight', 39);
    keyboardFocusRestores.push(await assertResizeKeyProbe(
      session,
      'second keyboard saved-column resize',
      'ArrowRight',
      initial.resizeWidth + 20
    ));
    await waitState(
      session.webview,
      state => Math.abs(state.resizeWidth - (initial.resizeWidth + 20)) <= 2,
      'settled second keyboard saved-column resize',
      500
    );
    await focusResizeHandle();
    const keyboardResized = await waitState(
      session.webview,
      state => Math.abs(state.resizeWidth - (initial.resizeWidth + 20)) <= 2 &&
        state.resizeFocused,
      'repeated keyboard saved-column resize through a tab-focused separator'
    );
    const resizeAccessibility = await accessibilityState(session.webview);
    await beginResizeKeyProbe(session);
    await dispatchNativeKey(session.root, 'ArrowLeft', 'ArrowLeft', 37);
    keyboardFocusRestores.push(await assertResizeKeyProbe(
      session,
      'first keyboard saved-column reset step',
      'ArrowLeft',
      initial.resizeWidth + 10
    ));
    await waitState(
      session.webview,
      state => Math.abs(state.resizeWidth - (initial.resizeWidth + 10)) <= 2,
      'settled first keyboard saved-column reset step',
      500
    );
    await focusResizeHandle();
    await beginResizeKeyProbe(session);
    await dispatchNativeKey(session.root, 'ArrowLeft', 'ArrowLeft', 37);
    keyboardFocusRestores.push(await assertResizeKeyProbe(
      session,
      'second keyboard saved-column reset step',
      'ArrowLeft',
      initial.resizeWidth
    ));
    await waitState(
      session.webview,
      state => Math.abs(state.resizeWidth - initial.resizeWidth) <= 2,
      'settled repeated keyboard saved-column resize reset',
      500
    );
    await focusResizeHandle();
    await waitState(
      session.webview,
      state => Math.abs(state.resizeWidth - initial.resizeWidth) <= 2 &&
        state.resizeFocused,
      'tab-focused separator after repeated keyboard saved-column resize reset'
    );
    await nativeClick(session, `document.querySelector('.kx-saved-sort[data-kx-source-ordinal="2"]')`);
    const ascending = await waitState(
      session.webview,
      state => state.metricSort === 'ascending' && ordered(state.metricValues, 1) &&
        state.metricSortFocused,
      'native ascending saved-table sort'
    );
    assertExactRowOrder(ascending, expectedMetricRows(1), 'ascending');
    const ascendingAccessibility = await accessibilityState(session.webview);
    await nativeClick(session, `document.querySelector('.kx-saved-sort[data-kx-source-ordinal="2"]')`);
    const descending = await waitState(
      session.webview,
      state => state.metricSort === 'descending' && ordered(state.metricValues, -1),
      'native descending saved-table sort'
    );
    assertExactRowOrder(descending, expectedMetricRows(-1), 'descending');
    await nativeClick(session, `document.querySelector('.kx-saved-sort[data-kx-source-ordinal="2"]')`);
    const restored = await waitState(
      session.webview,
      state => state.metricSort === 'none' &&
        JSON.stringify(state.metricValues) === JSON.stringify(initial.metricValues),
      'native source-order restore'
    );
    assertExactRowOrder(restored, expectedSourceRows(), 'restored source');
    await nativeClick(
      session,
      `document.querySelector('.kx-saved-sort[data-kx-source-ordinal="2"]')`,
      2
    );
    await waitState(
      session.webview,
      state => state.selectedCellCount === 30,
      'native saved-table column selection'
    );
    const accessibility = await accessibilityState(session.webview);
    accessibility.ascendingSort = ascendingAccessibility.ariaSort === 'ascending' &&
      (ascendingAccessibility.axSort === 'ascending' ||
        ascendingAccessibility.metricHeaderName.includes('sorted ascending'));
    accessibility.ascendingSortEvidence = {
      ariaSort: ascendingAccessibility.ariaSort,
      axSort: ascendingAccessibility.axSort,
      metricHeaderName: ascendingAccessibility.metricHeaderName,
      metricHeaderProperties: ascendingAccessibility.metricHeaderProperties,
    };
    accessibility.resizeControl = resizeAccessibility.resizeControl;

    await waitState(
      session.webview,
      state => state && state.tableVisible === true,
      'saved table retained before chart input'
    );

    await nativeClick(
      session,
      `document.querySelector('[data-kx-focus-key="toolbar:saved:chart-toggle"]')`
    );
    await waitState(
      session.webview,
      state => state.tableVisible && state.chartPanel && state.chartReady,
      'saved chart controls and default render alongside the table'
    );
    await selectOptionInWebview(session, 'Chart type', 'bar');
    await waitState(
      session.webview,
      state => state.chartReady && state.chartControlType === 'bar' &&
        state.chartResetDisabled === true &&
        state.chartStatus === 'Chart settings changed — Render to update.',
      'saved bar chart dirty state before render'
    );
    await nativeClick(
      session,
      `document.querySelector('[data-kx-focus-key="chart:saved:render"]')`
    );
    const full = await waitState(
      session.webview,
      state => state.chartReady && state.chartControlType === 'bar' &&
        state.chartResetDisabled === false && state.chartRenderFocused &&
        state.chartStatus === '' && validChartRange(state.chart),
      'saved padded-family chart render for viewport input'
    );
    const familySignature = JSON.stringify({
      chartType: 'bar',
      range: full.chart,
      ready: full.chartReady,
    });
    const families = {
      bar: {
        range: full.chart,
        sha256: crypto.createHash('sha256').update(familySignature).digest('hex'),
        source: 'uplot-dom',
      },
    };
    const legendShown = await waitState(
      session.webview,
      state => state.legendPressed[0] === 'true' &&
        state.legendControlIsTableHeader,
      'saved-chart baseline legend'
    );
    const legendAccessibility = await chartLegendAccessibilityState(session.webview);

    await nativeDrag(session, '.kx-chart-host .u-over', 0.2, 0.8, 0);
    const zoomed = await waitState(
      session.webview,
      state => validChartRange(state.chart) && chartSpan(state.chart) < chartSpan(full.chart) * 0.9,
      'native saved-chart zoom'
    );
    await nativeDrag(session, '.kx-chart-host', 0.58, 0.42, 8);
    const shiftPanned = await waitState(
      session.webview,
      state => validChartRange(state.chart) &&
        sameSpan(state.chart, zoomed.chart) &&
        !sameRange(state.chart, zoomed.chart) && state.chartFocused,
      'native Shift saved-chart pan'
    );
    await delay(600);
    const settledShiftPan = await notebookState(session.webview);
    if (!settledShiftPan || !sameRange(settledShiftPan.chart, shiftPanned.chart)) {
      throw new Error(
        `Saved-chart pan settlement did not preserve the native range; state ${JSON.stringify(settledShiftPan)}`
      );
    }
    await nativeKey(session, '.kx-chart-host', 'ArrowRight');
    const keyboardPanned = await waitState(
      session.webview,
      state => validChartRange(state.chart) &&
        sameSpan(state.chart, shiftPanned.chart) &&
        !sameRange(state.chart, shiftPanned.chart) && state.chartFocused,
      'native keyboard saved-chart pan'
    );
    await delay(600);
    const settledKeyboardPan = await notebookState(session.webview);
    if (!settledKeyboardPan || !sameRange(settledKeyboardPan.chart, keyboardPanned.chart)) {
      throw new Error(
        `Saved-chart keyboard pan settlement did not preserve the native range; state ${JSON.stringify(settledKeyboardPan)}`
      );
    }
    await nativeKey(session, '.kx-chart-host', 'Home');
    const reset = await waitState(
      session.webview,
      state => validChartRange(state.chart) && sameRange(state.chart, full.chart),
      'native saved-chart reset'
    );
    // Queue the real drag and Home key in a single root-target CDP sequence. The
    // mouseup schedules the 450 ms refinement before the immediately following
    // keydown resets it. Prove both the immediate reset and its survival beyond
    // that refinement delay.
    await nativeDragThenHome(session, '.kx-chart-host .u-over', 0.2, 0.8);
    const pendingReset = await waitState(
      session.webview,
      state => validChartRange(state.chart) && sameRange(state.chart, full.chart),
      'native saved-chart reset while viewport refinement is pending'
    );
    await delay(600);
    const settledPendingReset = await notebookState(session.webview);
    if (!settledPendingReset || !sameRange(settledPendingReset.chart, full.chart)) {
      throw new Error(
        `A stale pending viewport reply displaced the native reset; state ${JSON.stringify(settledPendingReset)}`
      );
    }

    writeResult(resultPath, {
      ok: true,
      nativeInput: true,
      search: {
        noMatch: completedSearch.savedSearchStatus === 'No matches',
        focusRetained: completedSearch.savedSearchFocused,
      },
      sort: {
        ascending: ordered(ascending.metricValues, 1),
        descending: ordered(descending.metricValues, -1),
        nullLast: nullSuffix(ascending.metricValues) && nullSuffix(descending.metricValues),
        nullCount: ascending.metricValues.filter(value => value === null).length,
        sourceRestored: JSON.stringify(restored.metricValues) === JSON.stringify(initial.metricValues),
        exactRows: initial.bodyRowCount === 30 && ascending.bodyRowCount === 30 &&
          descending.bodyRowCount === 30 && restored.bodyRowCount === 30,
        associations: exactRowOrder(ascending, expectedMetricRows(1)) &&
          exactRowOrder(descending, expectedMetricRows(-1)) &&
          exactRowOrder(restored, expectedSourceRows()),
        sourceHead: initial.metricValues.slice(0, 6),
        ascendingHead: ascending.metricValues.slice(0, 6),
        descendingHead: descending.metricValues.slice(0, 6),
      },
      resize: {
        dragged: resized.resizeWidth > initial.resizeWidth + 30,
        reset: Math.abs(resizedReset.resizeWidth - initial.resizeWidth) <= 2,
        keyboard: keyboardResized.resizeFocused && keyboardFocusRestores.every(Boolean),
      },
      chart: {
        zoomed: chartSpan(zoomed.chart) < chartSpan(full.chart),
        panned: !sameRange(keyboardPanned.chart, zoomed.chart),
        reset: sameRange(reset.chart, full.chart),
        pendingReset: sameRange(pendingReset.chart, full.chart) &&
          sameRange(settledPendingReset.chart, full.chart),
        legend: legendShown.legendPressed[0] === 'true' &&
          legendShown.legendControlIsTableHeader &&
          legendAccessibility.chartRegion && legendAccessibility.pressedButton,
        legendAccessibility,
        full: full.chart,
        zoom: zoomed.chart,
        shiftPan: shiftPanned.chart,
        keyboardPan: keyboardPanned.chart,
        families,
      },
      accessibility,
    });
  } catch (error) {
    writeResult(resultPath, {
      ok: false,
      error: error && error.stack ? error.stack : String(error),
    });
    throw error;
  } finally {
    session?.webview.close();
    session?.root.close();
  }
}

async function findNotebookWebview(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  let targetInventory = 'no targets returned';
  while (Date.now() < deadline) {
    let targets = [];
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      targets = await response.json();
      targetInventory = targets.map(target =>
        `${String(target.type)}:${String(target.url || '').slice(0, 160)}`
      ).join(', ') || 'no targets returned';
    } catch (error) {
      lastError = error.message;
      await delay(POLL_MS);
      continue;
    }
    const rootTarget = targets.find(target =>
      target && target.type === 'page' && target.webSocketDebuggerUrl &&
      !String(target.url || '').startsWith('vscode-webview://')
    ) || targets.find(target => target && target.type === 'page' && target.webSocketDebuggerUrl);
    let root;
    try {
      if (!rootTarget) throw new Error('VS Code workbench CDP target is unavailable');
      root = await CdpClient.connect(rootTarget.webSocketDebuggerUrl);
      await root.send('Runtime.enable');
      await root.send('Page.enable');
      const visibleWebviewUrl = await visibleWebviewTargetUrl(root);
      const webviewTargets = targets.filter(target =>
        target?.webSocketDebuggerUrl &&
        ['page', 'webview', 'iframe'].includes(target.type) &&
        target !== rootTarget && sameTargetUrl(target.url, visibleWebviewUrl)
      );
      if (webviewTargets.length !== 1) {
        throw new Error(
          `Expected one CDP target for visible webview ${visibleWebviewUrl}; found ${webviewTargets.length}`
        );
      }
      const target = webviewTargets[0];
      let client;
      try {
        client = await CdpClient.connect(target.webSocketDebuggerUrl);
        await client.send('Runtime.enable');
        await client.send('Page.enable').catch(() => undefined);
        await delay(50);
        if (!await notebookWebviewReady(client)) {
          client.close();
          throw new Error('The visible notebook webview target is not ready');
        }
        const sessionRoot = root;
        root = undefined;
        return { webview: client, root: sessionRoot };
      } catch (error) {
        lastError = error.message;
        client?.close();
      }
    } catch (error) {
      lastError = error.message;
    } finally {
      root?.close();
    }
    await delay(POLL_MS);
  }
  throw new Error(
    `Timed out finding reopened KX notebook renderer${lastError ? `: ${lastError}` : ''}; ` +
    `CDP targets: ${targetInventory}`
  );
}

async function visibleWebviewTargetUrl(root) {
  const response = await root.send('Runtime.evaluate', {
    expression: `(() => {
      const frames = Array.from(document.querySelectorAll('iframe.webview.ready'))
        .filter(frame => {
          const rect = frame.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      return frames.length === 1 ? frames[0].src : 'visible-webviews-' + frames.length;
    })()`,
    returnByValue: true,
  });
  const url = String(response.result?.value || '');
  if (!url.startsWith('vscode-webview://')) {
    throw new Error(`Could not resolve the visible notebook webview URL: ${url || 'none'}`);
  }
  return url;
}

function sameTargetUrl(left, right) {
  try {
    const leftUrl = new URL(String(left));
    const rightUrl = new URL(String(right));
    leftUrl.hash = '';
    rightUrl.hash = '';
    return leftUrl.href === rightUrl.href;
  } catch {
    return String(left) === String(right);
  }
}

async function notebookWebviewReady(client) {
  const value = await evaluateAnyContext(client, `(() => {
    const root = Array.from(document.querySelectorAll('.kx-root[aria-label="KX q notebook result"]'))
      .find(candidate => {
        const rect = candidate.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    const surface = root && (root.querySelector('.kx-table-wrap[role="grid"]') ||
      root.querySelector('.kx-chart-panel'));
    if (!root || !surface) return false;
    const rect = surface.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  })()`, candidate => candidate === true);
  return value === true;
}

async function notebookState(client) {
  return evaluateAnyContext(client, `(() => {
    const root = Array.from(document.querySelectorAll('.kx-root[aria-label="KX q notebook result"]'))
      .find(candidate => {
        const rect = candidate.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    if (!root) return null;
    const metricHeader = root.querySelector('.kx-saved-sort[data-kx-source-ordinal="2"]');
    const resizeHeader = root.querySelector('.kx-saved-sort[data-kx-source-ordinal="1"]');
    const metricValues = Array.from(root.querySelectorAll('.kx-table-wrap tbody td[data-column="2"]'))
      .map(cell => {
        const text = String(cell.textContent || '').trim();
        return text === '' || text.toLowerCase() === 'null' ? null : Number(text);
      });
    const bodyRows = Array.from(root.querySelectorAll('.kx-table-wrap tbody tr'));
    const rowTuples = bodyRows.map(row => {
      const rowText = String(row.querySelector('td[data-column="0"]')?.textContent || '').trim();
      const metricText = String(row.querySelector('td[data-column="2"]')?.textContent || '').trim();
      return [
        Number(rowText),
        metricText === '' || metricText.toLowerCase() === 'null' ? null : Number(metricText),
      ];
    });
    const grid = root.querySelector('.kx-table-wrap[role="grid"]');
    const host = root.querySelector('.kx-chart-host');
    const active = document.activeElement;
    const savedSearch = root.querySelector('input[aria-label="Search saved result rows"]');
    const savedSearchStatus = savedSearch?.getAttribute('aria-describedby')
      ? document.getElementById(savedSearch.getAttribute('aria-describedby'))
      : null;
    const resizeHandle = root.querySelector('.kx-table-wrap th[data-kx-source-ordinal="1"] .kx-column-resize-handle');
    const resizeRect = resizeHandle?.getBoundingClientRect();
    const resizeHit = resizeRect
      ? document.elementFromPoint(resizeRect.left + resizeRect.width / 2,
        resizeRect.top + resizeRect.height / 2)
      : null;
    const tableRect = resizeHandle?.closest('.kx-table-wrap')?.getBoundingClientRect();
    const legendControls = Array.from(root.querySelectorAll(
      '.kx-chart-host th[data-kx-series-index][role="button"]'
    ));
    const chartTypeControl = Array.from(root.querySelectorAll('.kx-chart-controls label'))
      .find(label => label.textContent.trim().startsWith('Chart type'))?.querySelector('select');
    const chartStatus = root.querySelector('.kx-chart-panel > .kx-status');
    const chartRender = root.querySelector('[data-kx-focus-key="chart:saved:render"]');
    const chartReset = root.querySelector('[data-kx-focus-key="chart:saved:reset"]');
    const number = name => host ? Number(host.dataset[name]) : NaN;
    return {
      metricValues,
      bodyRowCount: bodyRows.length,
      rowTuples,
      metricSort: metricHeader ? String(metricHeader.closest('th').getAttribute('aria-sort') || '') : '',
      selectedCellCount: grid
        ? grid.querySelectorAll('[role="gridcell"][aria-selected="true"]').length
        : 0,
      metricWidth: metricHeader ? metricHeader.closest('th').getBoundingClientRect().width : 0,
      resizeWidth: resizeHeader ? resizeHeader.closest('th').getBoundingClientRect().width : 0,
      metricSortFocused: !!active && active.matches('.kx-saved-sort[data-kx-source-ordinal="2"]'),
      resizeFocused: !!active && active.matches('.kx-column-resize-handle[data-kx-source-ordinal="1"]'),
      savedSearchValue: savedSearch ? savedSearch.value : '',
      savedSearchStatus: String(savedSearchStatus?.textContent || '').trim(),
      savedSearchFocused: !!savedSearch && active === savedSearch,
      chartPanel: !!root.querySelector('.kx-chart-panel'),
      tableVisible: !!root.querySelector('.kx-table-wrap'),
      chartReady: !!host && !!host.querySelector('.u-over') && !!host.querySelector('canvas'),
      chartControlType: chartTypeControl ? chartTypeControl.value : '',
      chartControlFocused: !!chartTypeControl && active === chartTypeControl,
      chartRenderFocused: !!chartRender && active === chartRender,
      chartResetDisabled: chartReset ? chartReset.disabled : null,
      chartStatus: String(chartStatus?.textContent || '').trim(),
      chartFocused: !!host && document.activeElement === host,
      legendPressed: legendControls.map(control => String(control.getAttribute('aria-pressed') || '')),
      legendFocused: legendControls.includes(document.activeElement),
      legendControlIsTableHeader: legendControls.every(control =>
        control.matches('th[role="button"]') && control.closest('th') === control &&
        control.tabIndex === 0 &&
        String(control.getAttribute('aria-label') || '').startsWith('Toggle chart series ')
      ),
      pointerTrace: Array.isArray(window.__kxPointerTrace)
        ? window.__kxPointerTrace.slice(-12)
        : [],
      resizeGeometry: resizeRect ? {
        rect: { left: resizeRect.left, top: resizeRect.top, width: resizeRect.width, height: resizeRect.height },
        table: tableRect
          ? { left: tableRect.left, top: tableRect.top, width: tableRect.width, height: tableRect.height }
          : null,
        hit: resizeHit instanceof Element
          ? [resizeHit.tagName, resizeHit.className].join('.')
          : String(resizeHit),
        pointerEvents: getComputedStyle(resizeHandle).pointerEvents,
      } : null,
      chart: host ? {
        min: number('kxViewportMin'),
        max: number('kxViewportMax'),
        fullMin: number('kxFullRangeMin'),
        fullMax: number('kxFullRangeMax')
      } : null
    };
  })()`, undefined, STATE_PROBE_TIMEOUT_MS);
}

async function accessibilityState(client) {
  const dom = await evaluateAnyContext(client, `(() => {
    const grid = document.querySelector('.kx-table-wrap[role="grid"][aria-label="Saved KX result preview table"]');
    if (!grid) return null;
    const rowCount = Number(grid.getAttribute('aria-rowcount'));
    const colCount = Number(grid.getAttribute('aria-colcount'));
    const headers = Array.from(grid.querySelectorAll('[role="columnheader"]'));
    const rows = Array.from(grid.querySelectorAll('[role="row"]'));
    const cells = Array.from(grid.querySelectorAll('[role="gridcell"]'));
    const rowHeaders = Array.from(grid.querySelectorAll('[role="rowheader"]'));
    const directTables = Array.from(grid.children).filter(child => child.tagName === 'TABLE');
    const nativeTable = directTables.length === 1 ? directTables[0] : null;
    const corner = nativeTable?.querySelector(':scope > thead > tr > th.kx-saved-corner[scope="col"]');
    const selectAll = corner?.querySelector('button[aria-label="Select all saved preview cells"]');
    const metric = grid.querySelector('[data-kx-source-ordinal="2"]')?.closest('[role="columnheader"]');
    const focusedSeparator = document.activeElement?.matches('.kx-column-resize-handle')
      ? document.activeElement
      : null;
    const headerIndices = headers.map(header => Number(header.getAttribute('aria-colindex')));
    const rowIndices = rows.map(row => Number(row.getAttribute('aria-rowindex')));
    return {
      rowCount,
      colCount,
      headerCount: headers.length,
      rowRoleCount: rows.length,
      cellCount: cells.length,
      selectedHeaderCount: headers.filter(header =>
        header.getAttribute('aria-selected') === 'true'
      ).length,
      selectedCellCount: grid.querySelectorAll('[role="gridcell"][aria-selected="true"]').length,
      multiselectable: grid.getAttribute('aria-multiselectable') === 'true',
      ariaSort: metric ? String(metric.getAttribute('aria-sort') || '') : '',
      exactShape: headers.length === 7 && rows.length === 31 && cells.length === 210,
      singleNativeTable: !!nativeTable && nativeTable.getAttribute('role') === null,
      nativeCornerHeader: !!corner && !!selectAll && corner.parentElement?.children[0] === corner,
      separator: focusedSeparator ? {
        focused: true,
        min: Number(focusedSeparator.getAttribute('aria-valuemin')),
        max: Number(focusedSeparator.getAttribute('aria-valuemax')),
        now: Number(focusedSeparator.getAttribute('aria-valuenow')),
      } : null,
      indices: Number.isSafeInteger(rowCount) && rowCount === 31 &&
        Number.isSafeInteger(colCount) && colCount === 8 &&
        JSON.stringify(headerIndices) === JSON.stringify([2, 3, 4, 5, 6, 7, 8]) &&
        JSON.stringify(rowIndices) === JSON.stringify(Array.from({ length: 31 }, (_v, i) => i + 1)) &&
        rowHeaders.length === 30 && rowHeaders.every(header =>
          Number(header.getAttribute('aria-colindex')) === 1
        ) && rows.slice(1).every(row =>
          JSON.stringify(Array.from(row.querySelectorAll('[role="gridcell"]')).map(cell =>
            Number(cell.getAttribute('aria-colindex'))
          )) === JSON.stringify([2, 3, 4, 5, 6, 7, 8])
        )
    };
  })()`);
  await client.send('Accessibility.enable');
  const activeContext = client.executionContexts.find(context => context.id === client.contextId);
  const frameId = activeContext?.auxData?.frameId;
  const response = await client.send(
    'Accessibility.getFullAXTree',
    frameId ? { frameId } : {}
  );
  const nodes = response.nodes || [];
  const byId = new Map(nodes.map(node => [node.nodeId, node]));
  const grid = nodes.find(node => !node.ignored &&
    String(node.role?.value || '').toLowerCase() === 'grid' &&
    String(node.name?.value || '') === 'Saved KX result preview table');
  const descendants = [];
  const pending = grid ? [...(grid.childIds || [])] : [];
  const seen = new Set();
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    const node = byId.get(nodeId);
    if (!node) continue;
    descendants.push(node);
    pending.push(...(node.childIds || []));
  }
  const roleCount = role => descendants.filter(node => !node.ignored &&
    String(node.role?.value || '').toLowerCase() === role).length;
  const property = (node, name) => node?.properties?.find(item => item.name === name)?.value?.value;
  const selectedGridcells = descendants.filter(node => !node.ignored &&
    String(node.role?.value || '').toLowerCase() === 'gridcell' &&
    property(node, 'selected') === true).length;
  const selectedColumnheaders = descendants.filter(node => !node.ignored &&
    String(node.role?.value || '').toLowerCase() === 'columnheader' &&
    property(node, 'selected') === true).length;
  const selectedColumnheaderNames = descendants.filter(node => !node.ignored &&
    String(node.role?.value || '').toLowerCase() === 'columnheader' &&
    /(?:^|, )selected(?:,|;|$)/i.test(String(node.name?.value || ''))).length;
  const metricHeader = descendants.find(node => !node.ignored &&
    String(node.role?.value || '').toLowerCase() === 'columnheader' &&
    String(node.name?.value || '').startsWith('metric,'));
  const focusedSeparator = descendants.find(node => !node.ignored &&
    String(node.role?.value || '').toLowerCase() === 'separator' &&
    property(node, 'focused') === true);
  return {
    axFrameId: String(frameId || ''),
    axNodeCount: nodes.length,
    grid: !!grid,
    namedGrid: !!grid,
    columnheader: roleCount('columnheader') === 8,
    gridcell: roleCount('gridcell') === 210,
    ownedRows: roleCount('row') === 31,
    singleNativeTable: roleCount('table') === 1 && dom?.singleNativeTable === true &&
      dom?.nativeCornerHeader === true,
    multiselectable: property(grid, 'multiselectable') === true && dom?.multiselectable === true,
    selection: selectedGridcells === 30 && dom?.selectedCellCount === 30,
    headerSelection: selectedColumnheaderNames === 1 && dom?.selectedHeaderCount === 1,
    headerSelectionEvidence: {
      selectedColumnheaders,
      selectedColumnheaderNames,
      domSelectedHeaderCount: dom?.selectedHeaderCount,
      columnheaders: nodes
        .filter(node => node.role?.value === 'columnheader')
        .map(node => ({
          name: String(node.name?.value || ''),
          selected: property(node, 'selected'),
        })),
    },
    focusedWithin: descendants.some(node => property(node, 'focused') === true),
    domIndices: dom?.indices === true && dom?.exactShape === true,
    ariaSort: dom?.ariaSort || '',
    axSort: String(property(metricHeader, 'sort') || ''),
    metricHeaderName: String(metricHeader?.name?.value || ''),
    metricHeaderProperties: Object.fromEntries((metricHeader?.properties || []).map(item => [
      item.name,
      item.value?.value,
    ])),
    resizeControl: !!focusedSeparator && roleCount('separator') === 7 &&
      dom?.separator?.focused === true && dom.separator.min === 80 &&
      dom.separator.max === 2000 && Number.isFinite(dom.separator.now),
  };
}

async function chartLegendAccessibilityState(client) {
  await client.send('Accessibility.enable');
  const deadline = Date.now() + 1_000;
  let result = { chartRegion: false, pressedButton: false };
  while (Date.now() < deadline) {
    const regions = await accessibilityNodesForElement(
      client,
      visibleElementExpression('.kx-chart-host')
    );
    const buttons = (await accessibilityNodesForElement(
      client,
      visibleElementExpression(
        '.kx-chart-host th[data-kx-series-index][role="button"]'
      )
    )).filter(node => !node.ignored &&
      String(node.role?.value || '').toLowerCase() === 'button' &&
      String(node.name?.value || '').startsWith('Toggle chart series '));
    result = {
      chartRegion: regions.some(node => !node.ignored &&
        String(node.role?.value || '').toLowerCase() === 'region' &&
        String(node.name?.value || '').startsWith('Chart plot.')),
      pressedButton: buttons.some(node => node.properties?.some(property =>
        property.name === 'pressed' && String(property.value?.value) === 'true'
      )),
    };
    if (result.chartRegion && result.pressedButton) break;
    await delay(50);
  }
  return result;
}

async function accessibilityNodesForElement(client, expression) {
  const contexts = client.executionContexts
    .filter(context => !context.auxData || context.auxData.isDefault !== false)
    .map(context => context.id);
  const prioritized = client.contextId === undefined
    ? contexts
    : [client.contextId, ...contexts.filter(contextId => contextId !== client.contextId)];
  for (const contextId of [...prioritized, undefined]) {
    const evaluation = await client.send('Runtime.evaluate', {
      expression,
      returnByValue: false,
      ...(contextId === undefined ? {} : { contextId }),
    }).catch(() => null);
    const objectId = evaluation?.result?.objectId;
    if (!objectId) continue;
    try {
      const response = await client.send('Accessibility.getPartialAXTree', {
        objectId,
        fetchRelatives: true,
      });
      client.contextId = contextId;
      return response.nodes || [];
    } finally {
      await client.send('Runtime.releaseObject', { objectId }).catch(() => undefined);
    }
  }
  return [];
}

async function nativeClick(session, elementExpression, modifiers = 0) {
  session.root.actionLabel = `click ${elementExpression}`;
  const { rect, outer } = await nativeElementGeometry(session, elementExpression);
  const x = outer.left + rect.left + rect.width / 2;
  const y = outer.top + rect.top + rect.height / 2;
  await session.root.send('Page.bringToFront');
  await dispatchMouseEvent(session.root, { type: 'mouseMoved', x, y, modifiers });
  await dispatchMouseEvent(session.root, {
    type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, modifiers,
  });
  await dispatchMouseEvent(session.root, {
    type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, modifiers,
  });
}

async function nativeDrag(session, selector, startRatio, endRatio, modifiers) {
  session.root.actionLabel = `drag ${selector}`;
  const { rect, outer } = await nativeElementGeometry(
    session,
    visibleElementExpression(selector)
  );
  const startX = outer.left + rect.left + rect.width * startRatio;
  const endX = outer.left + rect.left + rect.width * endRatio;
  const y = outer.top + rect.top + rect.height * 0.5;
  await session.root.send('Page.bringToFront');
  await dispatchMouseEvent(session.root, { type: 'mouseMoved', x: startX, y, modifiers });
  await delay(30);
  await dispatchMouseEvent(session.root, {
    type: 'mousePressed', x: startX, y, button: 'left', buttons: 1,
    clickCount: 1, modifiers,
  });
  await delay(30);
  for (let step = 1; step <= 6; step++) {
    await dispatchMouseEvent(session.root, {
      type: 'mouseMoved',
      x: startX + (endX - startX) * step / 6,
      y,
      button: 'left',
      buttons: 1,
      modifiers,
    });
    await delay(20);
  }
  await dispatchMouseEvent(session.root, {
    type: 'mouseReleased', x: endX, y, button: 'left', buttons: 0, clickCount: 1, modifiers,
  });
}

async function nativeDragThenHome(session, selector, startRatio, endRatio) {
  session.root.actionLabel = `drag-then-Home ${selector}`;
  const { rect, outer } = await nativeElementGeometry(
    session,
    visibleElementExpression(selector)
  );
  const startX = outer.left + rect.left + rect.width * startRatio;
  const endX = outer.left + rect.left + rect.width * endRatio;
  const y = outer.top + rect.top + rect.height * 0.5;
  await session.root.send('Page.bringToFront');
  await dispatchMouseEvent(session.root, { type: 'mouseMoved', x: startX, y });
  await delay(30);
  await dispatchMouseEvent(session.root, {
    type: 'mousePressed', x: startX, y, button: 'left', buttons: 1, clickCount: 1,
  });
  await delay(30);
  for (let step = 1; step <= 6; step++) {
    await dispatchMouseEvent(session.root, {
      type: 'mouseMoved',
      x: startX + (endX - startX) * step / 6,
      y,
      button: 'left',
      buttons: 1,
    });
    await delay(20);
  }
  await dispatchMouseEvent(session.root, {
    type: 'mouseReleased', x: endX, y, button: 'left', buttons: 0, clickCount: 1,
  });
  const home = { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36, nativeVirtualKeyCode: 36 };
  await session.root.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...home });
  await dispatchKeyUp(session.root, home);
}

async function nativeDragBy(session, selector, deltaX) {
  session.root.actionLabel = `drag-by ${selector}`;
  await evaluateAnyContext(session.webview, `(() => {
    window.__kxPointerTrace = [];
    if (!window.__kxPointerTraceInstalled) {
      window.__kxPointerTraceInstalled = true;
      for (const type of ['mousedown', 'mousemove', 'mouseup']) {
        window.addEventListener(type, event => {
          window.__kxPointerTrace.push({
            type,
            x: event.clientX,
            y: event.clientY,
            buttons: event.buttons,
            target: event.target instanceof Element
              ? [event.target.tagName, event.target.className].join('.')
              : String(event.target),
          });
          if (window.__kxPointerTrace.length > 40) window.__kxPointerTrace.shift();
        }, true);
      }
    }
    return true;
  })()`, candidate => candidate === true);
  const { rect, outer } = await nativeElementGeometry(
    session,
    visibleElementExpression(selector)
  );
  const startX = outer.left + rect.left + rect.width / 2;
  const endX = startX + deltaX;
  const y = outer.top + rect.top + rect.height / 2;
  await session.root.send('Page.bringToFront');
  await dispatchMouseEvent(session.root, { type: 'mouseMoved', x: startX, y });
  await dispatchMouseEvent(session.root, {
    type: 'mousePressed', x: startX, y, button: 'left', buttons: 1, clickCount: 1,
  });
  await delay(20);
  for (let step = 1; step <= 6; step++) {
    await dispatchMouseEvent(session.root, {
      type: 'mouseMoved',
      x: startX + deltaX * step / 6,
      y,
      button: 'left',
      buttons: 1,
    });
    await delay(20);
  }
  await dispatchMouseEvent(session.root, {
    type: 'mouseReleased', x: endX, y, button: 'left', buttons: 0, clickCount: 1,
  });
}

async function nativeDoubleClick(session, selector) {
  session.root.actionLabel = `double-click ${selector}`;
  const { rect, outer } = await nativeElementGeometry(
    session,
    visibleElementExpression(selector)
  );
  const x = outer.left + rect.left + rect.width / 2;
  const y = outer.top + rect.top + rect.height / 2;
  await session.root.send('Page.bringToFront');
  await dispatchMouseEvent(session.root, { type: 'mouseMoved', x, y });
  for (const clickCount of [1, 2]) {
    await dispatchMouseEvent(session.root, {
      type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount,
    });
    await dispatchMouseEvent(session.root, {
      type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount,
    });
  }
}

async function dispatchMouseEvent(root, params) {
  try {
    await root.send('Input.dispatchMouseEvent', params, INPUT_ACK_TIMEOUT_MS);
  } catch (error) {
    if (!String(error && error.message || error).includes('Timed out waiting for CDP command')) {
      throw error;
    }
    // Electron can omit the CDP acknowledgement when any pointer event
    // synchronously replaces the renderer subtree. Every native action below
    // is followed by an exact state assertion proving delivery and outcome.
    root.inputAckTimeouts = (root.inputAckTimeouts || 0) + 1;
  }
}

async function selectOptionInWebview(session, labelText, value) {
  const expression = chartSelectExpression(labelText);
  const changed = await evaluateAnyContext(session.webview, `(() => {
    const select = ${expression};
    if (!select || !Array.from(select.options).some(option => option.value === ${JSON.stringify(value)})) {
      return false;
    }
    if (select.value === ${JSON.stringify(value)}) return true;
    select.value = ${JSON.stringify(value)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`, candidate => candidate === true);
  if (changed !== true ||
    !await waitForSelectValue(session.webview, chartSelectExpression(labelText), value, 1_000)) {
    throw new Error(`Chart option ${labelText}=${value} was not applied`);
  }
}

function chartSelectExpression(labelText) {
  return `Array.from(document.querySelectorAll('.kx-chart-controls label'))
    .filter(label => label.textContent.trim().startsWith(${JSON.stringify(labelText)}))
    .map(label => label.querySelector('select'))
    .find(select => {
      if (!select) return false;
      const rect = select.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })`;
}

async function waitForSelectValue(client, expression, expectedValue, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await selectInputState(client, expression);
    if (state?.value === expectedValue) return true;
    await delay(30);
  }
  return false;
}

async function selectInputState(client, expression) {
  return evaluateAnyContext(client, `(() => {
    const select = ${expression};
    return select ? {
      value: select.value,
      selectedIndex: select.selectedIndex,
      focused: document.activeElement === select,
    } : null;
  })()`, candidate => candidate && typeof candidate.value === 'string');
}

async function dispatchNativeKey(root, key, code, keyCode, modifiers = 0) {
  const description = {
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
    modifiers,
  };
  await root.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...description });
  await dispatchKeyUp(root, description);
}

async function nativeKey(session, selector, key, click = true) {
  const elementExpression = visibleElementExpression(selector);
  if (click) {
    await nativeClick(session, elementExpression);
  }
  const focused = await evaluateAnyContext(session.webview, `(() => {
    const element = ${elementExpression};
    if (!element) return false;
    return document.activeElement === element;
  })()`, candidate => candidate === true);
  if (!focused) throw new Error(`Could not focus notebook element for ${key}: ${selector}`);
  const description = key === 'Home'
    ? { key, code: 'Home', windowsVirtualKeyCode: 36, nativeVirtualKeyCode: 36 }
    : { key, code: key, windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 };
  await session.root.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...description });
  await dispatchKeyUp(session.root, description);
}

async function nativeTabTo(session, selector, maxSteps = 24) {
  const elementExpression = visibleElementExpression(selector);
  session.root.actionLabel = `tab to ${selector}`;
  for (let step = 0; step <= maxSteps; step++) {
    const focused = await evaluateAnyContext(session.webview, `(() => {
      const element = ${elementExpression};
      return !!element && document.activeElement === element;
    })()`, candidate => candidate === true);
    if (focused === true) {
      return;
    }
    if (step < maxSteps) {
      await dispatchNativeKey(session.root, 'Tab', 'Tab', 9);
      await delay(30);
    }
  }
  throw new Error(`Could not reach notebook element through native Tab navigation: ${selector}`);
}

async function beginResizeKeyProbe(session) {
  const installed = await evaluateAnyContext(session.webview, `(() => {
    window.__kxResizeKeyTrace = [];
    const handle = document.activeElement;
    if (!(handle instanceof Element) ||
      !handle.matches('.kx-column-resize-handle[data-kx-source-ordinal="1"]')) return false;
    handle.addEventListener('keydown', event => {
      const replacement = document.querySelector(
        '.kx-table-wrap th[data-kx-source-ordinal="1"] .kx-column-resize-handle'
      );
      window.__kxResizeKeyTrace.push({
        key: event.key,
        trusted: event.isTrusted,
        defaultPrevented: event.defaultPrevented,
        oldConnected: handle.isConnected,
        replaced: replacement !== handle,
        focused: document.activeElement === replacement,
        role: replacement?.getAttribute('role'),
        ariaNow: Number(replacement?.getAttribute('aria-valuenow')),
        width: replacement?.closest('th')?.getBoundingClientRect().width,
      });
    }, { once: true });
    return true;
  })()`, candidate => candidate === true);
  if (installed !== true) {
    throw new Error('Could not arm the notebook resize key probe on the focused separator.');
  }
}

async function assertResizeKeyProbe(session, label, expectedKey, expectedWidth) {
  const trace = await evaluateAnyContext(session.webview, `(() =>
    Array.isArray(window.__kxResizeKeyTrace)
      ? window.__kxResizeKeyTrace.slice()
      : []
  )()`, candidate => Array.isArray(candidate));
  const entry = trace?.length === 1 ? trace[0] : undefined;
  const restored = entry?.key === expectedKey && entry.trusted === true &&
    entry.defaultPrevented === true && entry.oldConnected === false &&
    entry.replaced === true && entry.focused === true && entry.role === 'separator' &&
    Number.isFinite(entry.ariaNow) && Math.abs(entry.ariaNow - expectedWidth) <= 2 &&
    Number.isFinite(entry.width) && Math.abs(entry.width - expectedWidth) <= 2;
  if (!restored) {
    throw new Error(
      `The ${label} did not synchronously resize and restore the replacement separator; ` +
      `expected ${expectedKey} at ${expectedWidth}px, trace ${JSON.stringify(trace)}`
    );
  }
  return true;
}

function visibleElementExpression(selector) {
  return `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(element => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  })`;
}

async function dispatchKeyUp(client, description) {
  try {
    await client.send(
      'Input.dispatchKeyEvent',
      { type: 'keyUp', ...description },
      INPUT_ACK_TIMEOUT_MS
    );
  } catch (error) {
    if (!String(error && error.message || error).includes('Timed out waiting for CDP command')) {
      throw error;
    }
    // A keydown can synchronously rebuild the focused control. Chromium then
    // omits the acknowledgement for the keyup aimed at that obsolete surface.
    // Callers always verify the exact resulting focus/value/range state.
    client.inputAckTimeouts = (client.inputAckTimeouts || 0) + 1;
  }
}

async function nativeElementGeometry(session, elementExpression) {
  let latest;
  for (let attempt = 0; attempt < 16; attempt++) {
    const rect = await elementRect(session.webview, elementExpression);
    const outer = await visibleWebviewRect(session.root);
    const viewportResponse = await session.root.send('Runtime.evaluate', {
      expression: '({ width: window.innerWidth, height: window.innerHeight })',
      returnByValue: true,
    });
    const viewport = viewportResponse.result?.value;
    const centerX = outer.left + rect.left + rect.width / 2;
    const centerY = outer.top + rect.top + rect.height / 2;
    latest = { rect, outer, viewport, centerX, centerY };
    if (rect.hit && viewport && centerX >= NATIVE_VIEWPORT_MARGIN_PX &&
      centerX < viewport.width - NATIVE_VIEWPORT_MARGIN_PX &&
      centerY >= NATIVE_VIEWPORT_MARGIN_PX &&
      centerY < viewport.height - NATIVE_VIEWPORT_MARGIN_PX) {
      return { rect, outer };
    }
    if (!viewport) break;
    const visibleTop = Math.max(1, outer.top);
    const visibleBottom = Math.min(viewport.height - 1, outer.top + outer.height);
    if (visibleBottom <= visibleTop) break;
    const wheelX = Math.max(1, Math.min(viewport.width - 1,
      outer.left + Math.min(Math.max(outer.width / 2, 1), outer.width - 1)));
    const wheelY = (visibleTop + visibleBottom) / 2;
    const deltaY = centerY > viewport.height - NATIVE_VIEWPORT_MARGIN_PX
      ? Math.min(600, Math.max(120, centerY - viewport.height / 2))
      : centerY < NATIVE_VIEWPORT_MARGIN_PX
        ? -Math.min(600, Math.max(120, viewport.height / 2 - centerY))
        : 0;
    if (deltaY === 0) {
      await delay(100);
      continue;
    }
    session.root.actionLabel = `scroll to ${elementExpression}`;
    await dispatchMouseEvent(session.root, {
      type: 'mouseWheel',
      x: wheelX,
      y: wheelY,
      deltaX: 0,
      deltaY,
    });
    await delay(100);
  }
  throw new Error(`Could not bring notebook element into the native viewport: ${JSON.stringify(latest)}`);
}

async function elementRect(client, elementExpression) {
  const rect = await evaluateAnyContext(client, `(() => {
    const element = ${elementExpression};
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      hit: !!hit && (hit === element || element.contains(hit)),
      hitDescription: hit instanceof Element ? [hit.tagName, hit.className].join('.') : String(hit),
    };
  })()`, candidate => candidate && candidate.width > 0 && candidate.height > 0);
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) {
    throw new Error(`Could not locate visible notebook element: ${elementExpression}`);
  }
  return rect;
}

async function visibleWebviewRect(root) {
  let previous;
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await root.send('Runtime.evaluate', {
      expression: `(() => {
        const frames = Array.from(document.querySelectorAll('iframe.webview.ready'));
        const visible = frames.map(frame => frame.getBoundingClientRect())
          .filter(rect => rect.width > 0 && rect.height > 0);
        if (visible.length !== 1) return { error: 'visible-webviews-' + visible.length };
        const rect = visible[0];
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      })()`,
      returnByValue: true,
    });
    const rect = response.result?.value;
    if (!rect || rect.error) {
      throw new Error(`Expected one visible notebook webview frame; received ${rect?.error || 'none'}`);
    }
    if (previous && ['left', 'top', 'width', 'height'].every(key =>
      Math.abs(previous[key] - rect[key]) < 0.5)) {
      return rect;
    }
    previous = rect;
    await delay(50);
  }
  throw new Error(`Notebook webview frame did not settle: ${JSON.stringify(previous)}`);
}

async function evaluateAnyContext(
  client,
  expression,
  accept = value => value !== undefined && value !== null,
  timeoutMs = CDP_COMMAND_TIMEOUT_MS
) {
  const deadline = Date.now() + timeoutMs;
  const contexts = client.executionContexts
    .filter(context => !context.auxData || context.auxData.isDefault !== false)
    .map(context => context.id);
  const prioritized = client.contextId === undefined
    ? contexts
    : [client.contextId, ...contexts.filter(contextId => contextId !== client.contextId)];
  const candidates = [...prioritized, undefined];
  client.lastEvaluationFailure = undefined;
  for (let index = 0; index < candidates.length; index++) {
    const contextId = candidates[index];
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const candidatesRemaining = candidates.length - index;
    const candidateTimeout = Math.max(25, Math.floor(remaining / candidatesRemaining));
    let response;
    try {
      response = await client.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
        ...(contextId === undefined ? {} : { contextId }),
      }, candidateTimeout);
    } catch (error) {
      client.lastEvaluationFailure = error && error.stack ? error.stack : String(error);
      continue;
    }
    if (response.exceptionDetails) {
      client.lastEvaluationFailure = response.exceptionDetails.exception?.description ||
        response.exceptionDetails.text || 'Runtime.evaluate failed';
    }
    if (response?.result && accept(response.result.value)) {
      client.contextId = contextId;
      return response.result.value;
    }
  }
  return undefined;
}

function validChartRange(range) {
  return range && Number.isFinite(range.min) && Number.isFinite(range.max) && range.max > range.min;
}

function chartSpan(range) {
  return range.max - range.min;
}

function sameSpan(left, right) {
  return Math.abs(chartSpan(left) - chartSpan(right)) <= Math.max(1e-8, chartSpan(right) * 1e-8);
}

function sameRange(left, right) {
  return sameSpan(left, right) &&
    Math.abs(left.min - right.min) <= Math.max(1e-8, chartSpan(right) * 1e-8);
}

function ordered(values, direction) {
  if (values.length <= 1 || !nullSuffix(values)) return false;
  const finite = values.filter(value => value !== null);
  return finite.length > 1 && finite.every((value, index) =>
    Number.isFinite(value) && (index === 0 || direction * value >= direction * finite[index - 1])
  );
}

function nullSuffix(values) {
  const firstNull = values.indexOf(null);
  return firstNull >= 0 && values.slice(firstNull).every(value => value === null) &&
    values.slice(0, firstNull).every(Number.isFinite);
}

function expectedSourceRows() {
  return Array.from({ length: 30 }, (_value, rowId) => [
    rowId,
    rowId === 7 ? null : (rowId * 7) % 30,
  ]);
}

function expectedMetricRows(direction) {
  return expectedSourceRows().slice().sort((left, right) => {
    if (left[1] === null) return right[1] === null ? left[0] - right[0] : 1;
    if (right[1] === null) return -1;
    return direction * (left[1] - right[1]) || left[0] - right[0];
  });
}

function exactRowOrder(state, expected) {
  return state?.bodyRowCount === 30 &&
    JSON.stringify(state.rowTuples) === JSON.stringify(expected) &&
    JSON.stringify(state.rowTuples.slice().sort((left, right) => left[0] - right[0])) ===
      JSON.stringify(expectedSourceRows());
}

function assertExactRowOrder(state, expected, label) {
  if (!exactRowOrder(state, expected)) {
    throw new Error(
      `Native ${label} sort changed row associations/order: ${JSON.stringify(state?.rowTuples)}`
    );
  }
}

async function waitForJson(filePath, label, deadline = Date.now() + TIMEOUT_MS) {
  while (Date.now() < deadline) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    await delay(POLL_MS);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function remainingTime(deadline, label) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new Error(`Timed out before ${label}`);
  }
  return remaining;
}

function writeResult(filePath, result) {
  fs.writeFileSync(filePath, `${JSON.stringify(result)}\n`, { flag: 'wx' });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.executionContexts = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.method === 'Runtime.executionContextCreated' && message.params?.context) {
        this.executionContexts.push(message.params.context);
        return;
      }
      if (message.method === 'Runtime.executionContextDestroyed') {
        this.executionContexts = this.executionContexts.filter(
          context => context.id !== message.params.executionContextId
        );
        if (this.contextId === message.params.executionContextId) {
          this.contextId = undefined;
        }
        return;
      }
      if (message.method === 'Runtime.executionContextsCleared') {
        this.executionContexts = [];
        this.contextId = undefined;
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result || {});
    });
    socket.addEventListener('close', () => {
      this.executionContexts = [];
      this.contextId = undefined;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(`CDP socket closed while waiting for ${pending.method}`));
      }
      this.pending.clear();
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error('Timed out connecting to CDP target'));
      }, 5000);
      socket.addEventListener('open', () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('Failed to connect to CDP target'));
      }, { once: true });
    });
    return new CdpClient(socket);
  }

  send(method, params = {}, timeoutMs = CDP_COMMAND_TIMEOUT_MS) {
    const description = method.startsWith('Input.')
      ? `${method}${this.actionLabel ? ` [${this.actionLabel}]` : ''} ${JSON.stringify(params)}`
      : method;
    if (this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`CDP socket is not open for ${description}`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new Error(`Timed out waiting for CDP command ${description}`));
      }, timeoutMs);
      this.pending.set(id, { method: description, resolve, reject, timeout });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  close() {
    this.socket.close();
  }
}

module.exports = { runNotebookVisualAcceptance };
