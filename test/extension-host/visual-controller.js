'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const POLL_MS = 100;
const TIMEOUT_MS = 50_000;
const STATE_TIMEOUT_MS = 5_000;
const CDP_COMMAND_TIMEOUT_MS = 5_000;
const INPUT_ACK_TIMEOUT_MS = 250;
const NATIVE_VIEWPORT_MARGIN_PX = 48;

async function runNotebookVisualAcceptance({ port, controlDir }) {
  const markerPath = path.join(controlDir, 'notebook-reopened-ready.json');
  const resultPath = path.join(controlDir, 'notebook-visual-result.json');
  const setupDeadline = Date.now() + TIMEOUT_MS;
  let session;
  const waitState = async (_client, predicate, label) => {
    const deadline = Date.now() + STATE_TIMEOUT_MS;
    let latest;
    let missingStates = 0;
    while (Date.now() < deadline) {
      latest = await notebookState(session.webview).catch(() => undefined);
      if (latest && predicate(latest)) return latest;
      missingStates = latest === undefined ? missingStates + 1 : 0;
      if (missingStates >= 2) {
        const previous = session;
        try {
          session = await findNotebookWebview(
            port,
            Math.max(1, deadline - Date.now())
          );
          previous?.webview.close();
          previous?.root.close();
          missingStates = 0;
          continue;
        } catch {
          // The replacement webview can appear between target inventory polls.
        }
      }
      await delay(POLL_MS);
    }
    throw new Error(`Timed out waiting for ${label}; last state ${JSON.stringify(latest)}`);
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
      '.kx-table-wrap th[data-kx-source-ordinal="1"] .kx-column-resize',
      60
    );
    const resized = await waitState(
      session.webview,
      state => state.resizeWidth > initial.resizeWidth + 30,
      'native saved-column resize'
    );
    await nativeDoubleClick(
      session,
      '.kx-table-wrap th[data-kx-source-ordinal="1"] .kx-column-resize'
    );
    const resizedReset = await waitState(
      session.webview,
      state => Math.abs(state.resizeWidth - initial.resizeWidth) <= 2,
      'native saved-column width reset'
    );
    await nativeClick(
      session,
      `document.querySelector('.kx-table-wrap th[data-kx-source-ordinal="1"] .kx-column-resize')`
    );
    await dispatchNativeKey(session.root, 'ArrowRight', 'ArrowRight', 39);
    await delay(40);
    await dispatchNativeKey(session.root, 'ArrowRight', 'ArrowRight', 39);
    const keyboardResized = await waitState(
      session.webview,
      state => state.resizeWidth >= initial.resizeWidth + 18 && state.resizeFocused,
      'repeated keyboard saved-column resize with restored separator focus'
    );
    const resizeAccessibility = await accessibilityState(session.webview);
    await dispatchNativeKey(session.root, 'ArrowLeft', 'ArrowLeft', 37);
    await delay(40);
    await dispatchNativeKey(session.root, 'ArrowLeft', 'ArrowLeft', 37);
    await waitState(
      session.webview,
      state => Math.abs(state.resizeWidth - initial.resizeWidth) <= 2 &&
        state.resizeFocused,
      'repeated keyboard saved-column resize reset'
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

    await nativeClick(
      session,
      `Array.from(document.querySelectorAll('.kx-saved-toolbar button')).find(button => button.textContent.trim() === 'Hide table')`
    );
    await waitState(
      session.webview,
      state => state && state.tableVisible === false,
      'native saved-table hide before chart input'
    );

    await nativeClick(session, `Array.from(document.querySelectorAll('.kx-saved-toolbar button')).find(button => button.textContent.trim() === 'Chart')`);
    await waitState(
      session.webview,
      state => state.chartPanel && state.chartReady,
      'saved chart controls and default render'
    );
    await selectOptionInWebview(session, 'Chart type', 'bar');
    await nativeClick(session, `Array.from(document.querySelectorAll('.kx-chart-controls button')).find(button => {
      const rect = button.getBoundingClientRect();
      return button.textContent.trim() === 'Render' && rect.width > 0 && rect.height > 0;
    })`);
    const full = await waitState(
      session.webview,
      state => state.chartReady && state.chartType === 'bar' && validChartRange(state.chart),
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
        !sameRange(state.chart, zoomed.chart),
      'native Shift saved-chart pan'
    );
    await delay(600);
    const settledShiftPan = await notebookState(session.webview);
    if (!settledShiftPan?.chartFocused || !sameRange(settledShiftPan.chart, shiftPanned.chart)) {
      throw new Error(
        `Saved-chart pan settlement did not preserve native plot focus; state ${JSON.stringify(settledShiftPan)}`
      );
    }
    await nativeKey(session, '.kx-chart-host', 'ArrowRight', false);
    const keyboardPanned = await waitState(
      session.webview,
      state => validChartRange(state.chart) &&
        sameSpan(state.chart, shiftPanned.chart) &&
        !sameRange(state.chart, shiftPanned.chart),
      'native keyboard saved-chart pan'
    );
    await delay(600);
    const settledKeyboardPan = await notebookState(session.webview);
    if (!settledKeyboardPan?.chartFocused ||
      !sameRange(settledKeyboardPan.chart, keyboardPanned.chart)) {
      throw new Error(
        `Saved-chart keyboard pan settlement did not preserve plot focus; state ${JSON.stringify(settledKeyboardPan)}`
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
    // keydown resets it; sampling the brief pending flag through the separate
    // webview target would add enough latency to miss the race itself.
    await nativeDragThenHome(session, '.kx-chart-host .u-over', 0.2, 0.8);
    const pendingReset = await waitState(
      session.webview,
      state => validChartRange(state.chart) && sameRange(state.chart, full.chart) &&
        !state.chartViewportPending,
      'native saved-chart reset while viewport refinement is pending'
    );
    await delay(600);
    const settledPendingReset = await notebookState(session.webview);
    if (!settledPendingReset || settledPendingReset.chartViewportPending ||
      !sameRange(settledPendingReset.chart, full.chart)) {
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
        keyboard: keyboardResized.resizeFocused,
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
    const resizeHandle = root.querySelector('.kx-table-wrap th[data-kx-source-ordinal="1"] .kx-column-resize');
    const resizeRect = resizeHandle?.getBoundingClientRect();
    const resizeHit = resizeRect
      ? document.elementFromPoint(resizeRect.left + resizeRect.width / 2,
        resizeRect.top + resizeRect.height / 2)
      : null;
    const tableRect = resizeHandle?.closest('.kx-table-wrap')?.getBoundingClientRect();
    const legendControls = Array.from(root.querySelectorAll(
      '.kx-chart-host .u-legend .u-series > th[data-kx-series-index]'
    ));
    const chartTypeControl = Array.from(root.querySelectorAll('.kx-chart-controls label'))
      .find(label => label.textContent.trim().startsWith('Chart type'))?.querySelector('select');
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
      resizeFocused: !!active && active.matches('.kx-column-resize[data-kx-source-ordinal="1"]'),
      savedSearchValue: savedSearch ? savedSearch.value : '',
      savedSearchStatus: String(savedSearchStatus?.textContent || '').trim(),
      savedSearchFocused: !!savedSearch && active === savedSearch,
      chartPanel: !!root.querySelector('.kx-chart-panel'),
      tableVisible: !!root.querySelector('.kx-table-wrap'),
      chartReady: !!host && !!host.querySelector('.u-over'),
      chartType: host ? String(host.dataset.kxChartType || '') : '',
      chartControlType: chartTypeControl ? chartTypeControl.value : '',
      chartControlFocused: !!chartTypeControl && active === chartTypeControl,
      chartFocused: !!host && document.activeElement === host,
      chartViewportPending: host?.dataset.kxViewportPending === 'true',
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
  })()`);
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
    const metric = grid.querySelector('[data-kx-source-ordinal="2"]')?.closest('[role="columnheader"]');
    const focusedSeparator = document.activeElement?.matches('.kx-column-resize')
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
      exactShape: headers.length === 8 && rows.length === 31 && cells.length === 210,
      noNestedTable: grid.querySelector('table')?.getAttribute('role') === 'presentation',
      separator: focusedSeparator ? {
        focused: true,
        min: Number(focusedSeparator.getAttribute('aria-valuemin')),
        max: Number(focusedSeparator.getAttribute('aria-valuemax')),
        now: Number(focusedSeparator.getAttribute('aria-valuenow')),
      } : null,
      indices: Number.isSafeInteger(rowCount) && rowCount === 31 &&
        Number.isSafeInteger(colCount) && colCount === 8 &&
        JSON.stringify(headerIndices) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8]) &&
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
    noNestedTable: roleCount('table') === 0 && dom?.noNestedTable === true,
    multiselectable: property(grid, 'multiselectable') === true && dom?.multiselectable === true,
    selection: selectedGridcells === 30 && dom?.selectedCellCount === 30,
    headerSelection: selectedColumnheaders === 1 && dom?.selectedHeaderCount === 1,
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
      dom?.separator?.focused === true && dom.separator.min === 60 &&
      dom.separator.max === 1000 && Number.isFinite(dom.separator.now),
  };
}

async function chartLegendAccessibilityState(client) {
  await client.send('Accessibility.enable');
  const deadline = Date.now() + 1_000;
  let result = { chartRegion: false, pressedButton: false, focusedButton: false };
  while (Date.now() < deadline) {
    const regions = await accessibilityNodesForElement(
      client,
      visibleElementExpression('.kx-chart-host')
    );
    const buttons = (await accessibilityNodesForElement(
      client,
      visibleElementExpression(
        '.kx-chart-host .u-legend .u-series > th[data-kx-series-index]'
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
      focusedButton: buttons.some(node => node.properties?.some(property =>
        property.name === 'focused' && property.value?.value === true
      )),
    };
    if (result.chartRegion && result.pressedButton && result.focusedButton) break;
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
  const events = [
    { type: 'mouseMoved', x: startX, y, modifiers },
    {
      type: 'mousePressed', x: startX, y, button: 'left', buttons: 1,
      clickCount: 1, modifiers,
    },
  ];
  for (let step = 1; step <= 6; step++) {
    events.push({
      type: 'mouseMoved',
      x: startX + (endX - startX) * step / 6,
      y,
      button: 'left',
      buttons: 1,
      modifiers,
    });
  }
  events.push({
    type: 'mouseReleased', x: endX, y, button: 'left', buttons: 0, clickCount: 1, modifiers,
  });
  await Promise.all(events.map(event => dispatchMouseEvent(session.root, event)));
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
  const events = [
    { type: 'mouseMoved', x: startX, y },
    { type: 'mousePressed', x: startX, y, button: 'left', buttons: 1, clickCount: 1 },
  ];
  for (let step = 1; step <= 6; step++) {
    events.push({
      type: 'mouseMoved',
      x: startX + (endX - startX) * step / 6,
      y,
      button: 'left',
      buttons: 1,
    });
  }
  events.push({
    type: 'mouseReleased', x: endX, y, button: 'left', buttons: 0, clickCount: 1,
  });
  await Promise.all(events.map(event => dispatchMouseEvent(session.root, event)));
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
  accept = value => value !== undefined && value !== null
) {
  const contexts = client.executionContexts
    .filter(context => !context.auxData || context.auxData.isDefault !== false)
    .map(context => context.id);
  const prioritized = client.contextId === undefined
    ? contexts
    : [client.contextId, ...contexts.filter(contextId => contextId !== client.contextId)];
  const candidates = [...prioritized, undefined];
  for (const contextId of candidates) {
    const response = await client.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      ...(contextId === undefined ? {} : { contextId }),
    }).catch(() => null);
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
        return;
      }
      if (message.method === 'Runtime.executionContextsCleared') {
        this.executionContexts = [];
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
    const id = this.nextId++;
    const description = method.startsWith('Input.')
      ? `${method}${this.actionLabel ? ` [${this.actionLabel}]` : ''} ${JSON.stringify(params)}`
      : method;
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
