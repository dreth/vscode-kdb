import uPlot from 'uplot';
import uPlotCss from 'uplot/dist/uPlot.min.css';
import type { ActivationFunction, RendererContext } from 'vscode-notebook-renderer';
import { buildChartData, chartColumnOptions } from '../src/charting';
import { ColumnarPanelResult, createColumnarPanelResult } from '../src/kx-results';
import {
  KX_NOTEBOOK_MIME,
  MAX_NOTEBOOK_BYTE_LIMIT,
  NotebookChartSpec,
  NotebookChartType,
  PortableKxResult,
  notebookResultToCsv,
  portableCellText,
  validatePortableKxResult,
} from '../src/notebook-contract';

type NotebookPresentation = 'inline' | 'panel' | 'both';

interface OutputState {
  id: string;
  element: HTMLElement;
  payload: PortableKxResult;
  chart: NotebookChartSpec | undefined;
  chartVisible: boolean;
  tableVisible: boolean;
  tablePageStart: number;
  maxChartPoints: number;
  plot?: uPlot;
  resizeObserver?: ResizeObserver;
  panelOpened: boolean;
}

interface RendererState {
  presentation?: NotebookPresentation;
}

const TABLE_PAGE_SIZE = 250;
const MAX_TABLE_PAGE_CELLS = 5000;
const states = new Map<string, OutputState>();
let presentation: NotebookPresentation = 'inline';

export const activate: ActivationFunction<RendererState> = context => {
  installStyles();
  const restored = context.getState();
  if (isPresentation(restored?.presentation)) {
    presentation = restored.presentation;
  }
  context.onDidReceiveMessage?.(event => {
    const message = event as unknown;
    if (!isRecord(message) || message.type !== 'settings' || !isPresentation(message.presentation)) {
      return;
    }
    presentation = message.presentation;
    context.setState({ presentation });
    states.forEach(state => renderState(context, state));
  });
  context.postMessage?.({ type: 'ready' });

  return {
    renderOutputItem(outputItem, element) {
      disposeState(outputItem.id);
      element.replaceChildren();
      if (outputItem.mime !== KX_NOTEBOOK_MIME || outputItem.data().byteLength > MAX_NOTEBOOK_BYTE_LIMIT) {
        renderError(element, 'KX notebook output is unsupported or exceeds the renderer safety limit.');
        return;
      }
      let raw: unknown;
      try {
        raw = outputItem.json();
      } catch {
        renderError(element, 'KX notebook output is not valid JSON. Use the static fallback for this cell.');
        return;
      }
      const validation = validatePortableKxResult(raw);
      if (!validation.ok) {
        renderError(element, `${validation.error} Use the static fallback for this cell.`);
        return;
      }
      const payload = validation.value;
      const state: OutputState = {
        id: outputItem.id,
        element,
        payload,
        chart: payload.chart ? { ...payload.chart, yColumns: payload.chart.yColumns.slice() } : undefined,
        chartVisible: payload.chart?.visible === true,
        tableVisible: true,
        tablePageStart: 0,
        maxChartPoints: 1000,
        panelOpened: false,
      };
      states.set(outputItem.id, state);
      renderState(context, state);
    },
    disposeOutputItem(id) {
      if (id === undefined) {
        [...states.keys()].forEach(disposeState);
      } else {
        disposeState(id);
      }
    },
  };
};

function renderState(context: RendererContext<RendererState>, state: OutputState): void {
  destroyPlot(state);
  const { element, payload } = state;
  element.replaceChildren();
  const root = node('section', 'kx-root');
  root.setAttribute('aria-label', 'KX q notebook result');
  element.append(root);

  const header = node('header', 'kx-header');
  const headingWrap = node('div', 'kx-heading-wrap');
  const heading = node('strong', 'kx-heading', 'KX/q result');
  headingWrap.append(heading);
  if (payload.provenance.label) {
    headingWrap.append(node('span', 'kx-meta', payload.provenance.label));
  }
  if (payload.provenance.elapsedMs !== undefined) {
    headingWrap.append(node('span', 'kx-meta', formatElapsed(payload.provenance.elapsedMs)));
  }
  headingWrap.append(node(
    'span',
    'kx-meta',
    `${payload.result.rowCount.toLocaleString()} rows · ${payload.result.previewRowCount.toLocaleString()} saved`
  ));
  header.append(headingWrap);
  const toolbar = node('div', 'kx-toolbar');
  header.append(toolbar);
  root.append(header);

  const status = node('div', 'kx-status');
  status.setAttribute('role', 'status');
  if (presentation === 'both' && !state.panelOpened && context.postMessage) {
    state.panelOpened = true;
    openPreview(context, state, status);
  }

  const tableButton = button(state.tableVisible ? 'Hide table' : 'Show table', () => {
    state.tableVisible = !state.tableVisible;
    renderState(context, state);
  });
  toolbar.append(tableButton);

  if (chartColumns(payload).numeric.length > 0 && payload.schema.columns.length > 1) {
    toolbar.append(button(state.chartVisible ? 'Hide chart' : 'Show chart', () => {
      state.chartVisible = !state.chartVisible;
      ensureChartSpec(state);
      renderState(context, state);
    }));
  }
  toolbar.append(button('Copy preview CSV', () => {
    void copyText(notebookResultToCsv(payload)).then(
      () => { status.textContent = 'Saved preview copied as CSV.'; },
      () => { status.textContent = 'Clipboard access was unavailable. Select and copy table cells instead.'; }
    );
  }));
  if (context.postMessage) {
    toolbar.append(button('Open saved preview in KX panel', () => openPreview(context, state, status)));
  }

  if (payload.result.truncated) {
    const notice = node('div', 'kx-notice');
    notice.append(node('strong', '', 'Preview only. '));
    notice.append(document.createTextNode(
      `${payload.result.previewRowCount.toLocaleString()} of ${payload.result.rowCount.toLocaleString()} rows are saved ` +
      `(${payload.result.truncationReasons.join(', ') || 'configured limit'}). ` +
      'The omitted full result is not in this notebook; use the live originating q session while it is available.'
    ));
    root.append(notice);
  }

  if (presentation === 'panel') {
    root.append(node(
      'div',
      'kx-panel-mode',
      'Notebook presentation is set to panel. The saved preview remains portable and is opened in the KX Results panel.'
    ));
    root.append(status);
    if (!state.panelOpened && context.postMessage) {
      state.panelOpened = true;
      openPreview(context, state, status);
    }
    return;
  }

  if (payload.provenance.qSource) {
    const details = document.createElement('details');
    details.className = 'kx-source';
    const summary = document.createElement('summary');
    summary.textContent = 'q source';
    const pre = document.createElement('pre');
    pre.textContent = payload.provenance.qSource;
    details.append(summary, pre);
    root.append(details);
  }

  if (state.chartVisible) {
    renderChartControls(context, state, root, status);
  }
  if (state.tableVisible) {
    renderTable(context, state, root);
  }
  root.append(status);
}

function renderTable(context: RendererContext<RendererState>, state: OutputState, root: HTMLElement): void {
  const wrap = node('div', 'kx-table-wrap');
  wrap.tabIndex = 0;
  wrap.setAttribute('aria-label', 'Saved KX result preview table');
  const table = document.createElement('table');
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  state.payload.schema.columns.forEach(column => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = column.name;
    const type = node('span', 'kx-column-type', column.type);
    th.append(type);
    headRow.append(th);
  });
  head.append(headRow);
  table.append(head);
  const body = document.createElement('tbody');
  const pageSize = Math.max(1, Math.min(
    TABLE_PAGE_SIZE,
    Math.floor(MAX_TABLE_PAGE_CELLS / Math.max(1, state.payload.schema.columns.length))
  ));
  const lastPageStart = state.payload.data.rows.length === 0
    ? 0
    : Math.floor((state.payload.data.rows.length - 1) / pageSize) * pageSize;
  const pageStart = Math.min(state.tablePageStart, lastPageStart);
  const pageEnd = Math.min(state.payload.data.rows.length, pageStart + pageSize);
  state.payload.data.rows.slice(pageStart, pageEnd).forEach(row => {
    const tr = document.createElement('tr');
    row.forEach(cell => {
      const td = document.createElement('td');
      td.textContent = portableCellText(cell);
      tr.append(td);
    });
    body.append(tr);
  });
  table.append(body);
  wrap.append(table);
  root.append(wrap);
  if (state.payload.data.rows.length > pageSize) {
    const pagination = node('div', 'kx-pagination');
    const previous = button('Previous page', () => {
      state.tablePageStart = Math.max(0, pageStart - pageSize);
      renderState(context, state);
    });
    previous.disabled = pageStart === 0;
    const next = button('Next page', () => {
      state.tablePageStart = Math.min(lastPageStart, pageStart + pageSize);
      renderState(context, state);
    });
    next.disabled = pageEnd >= state.payload.data.rows.length;
    pagination.append(
      previous,
      node('span', 'kx-meta', `Saved rows ${pageStart + 1}-${pageEnd} of ${state.payload.data.rows.length}`),
      next
    );
    root.append(pagination);
  }
}

function renderChartControls(
  context: RendererContext<RendererState>,
  state: OutputState,
  root: HTMLElement,
  status: HTMLElement
): void {
  ensureChartSpec(state);
  const chart = state.chart;
  if (!chart) {
    root.append(node('div', 'kx-notice', 'Chart unavailable: the saved preview has no usable numeric series.'));
    return;
  }
  const candidates = chartColumns(state.payload);
  const panel = node('div', 'kx-chart-panel');
  const controls = node('div', 'kx-chart-controls');
  controls.append(labelledSelect('Type', ['line', 'scatter', 'step', 'bar'], chart.type, value => {
    chart.type = value as NotebookChartType;
    renderState(context, state);
  }));
  controls.append(labelledSelect('X', candidates.x, chart.xColumn, value => {
    chart.xColumn = value;
    chart.yColumns = chart.yColumns.filter(name => name !== value);
    if (chart.yColumns.length === 0) {
      chart.yColumns = candidates.numeric.filter(name => name !== value).slice(0, 1);
    }
    renderState(context, state);
  }));
  const yLabel = node('label', 'kx-control');
  yLabel.append(node('span', '', 'Y series'));
  const ySelect = document.createElement('select');
  ySelect.multiple = true;
  ySelect.size = Math.min(4, Math.max(2, candidates.numeric.length));
  candidates.numeric.filter(name => name !== chart.xColumn).forEach(name => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    option.selected = chart.yColumns.includes(name);
    ySelect.append(option);
  });
  ySelect.addEventListener('change', () => {
    const selected = [...ySelect.selectedOptions].map(option => option.value).slice(0, 8);
    if (selected.length === 0) {
      status.textContent = 'Choose at least one Y series.';
      return;
    }
    chart.yColumns = selected;
    renderState(context, state);
  });
  yLabel.append(ySelect);
  controls.append(yLabel);
  controls.append(labelledSelect('Point cap', ['500', '1000', '2500'], String(state.maxChartPoints), value => {
    state.maxChartPoints = Number(value);
    renderState(context, state);
  }));
  controls.append(button('Reset zoom', () => {
    if (!state.plot) {
      return;
    }
    state.plot.setData(state.plot.data, true);
  }));
  panel.append(controls);
  const chartHost = node('div', 'kx-chart-host');
  panel.append(chartHost);
  root.append(panel);

  const prepared = chartData(state.payload, chart, state.maxChartPoints);
  if (!prepared || prepared.data.length < 2) {
    chartHost.append(node('div', 'kx-notice', 'Chart unavailable: selected columns contain no finite saved points.'));
    return;
  }
  const colors = ['#4da3ff', '#f07178', '#7bd88f', '#c792ea', '#ffcb6b', '#89ddff', '#ff9cac', '#82aaff'];
  const series: uPlot.Series[] = [{ label: chart.xColumn }];
  prepared.seriesNames.forEach((name, index) => {
    const color = colors[index % colors.length];
    const config: uPlot.Series = {
      label: name,
      stroke: color,
      width: chart.type === 'scatter' || chart.type === 'bar' ? 0 : 1.5,
      points: {
        show: chart.type === 'scatter',
        size: chart.type === 'scatter' ? 5 : 3,
        stroke: color,
        fill: color,
      },
    };
    if (chart.type === 'step' && uPlot.paths.stepped) {
      config.paths = uPlot.paths.stepped({ align: 1 });
    }
    if (chart.type === 'bar' && uPlot.paths.bars) {
      config.paths = uPlot.paths.bars({ size: [0.8, 60, 1], gap: 1 });
      config.fill = color;
    }
    series.push(config);
  });
  const options: uPlot.Options = {
    width: Math.max(320, Math.floor(chartHost.getBoundingClientRect().width || 720)),
    height: 260,
    series,
    scales: { x: { time: prepared.temporal }, y: { auto: true } },
    cursor: { drag: { setScale: true, x: true, y: false, dist: 5 } },
    legend: { show: true },
  };
  try {
    state.plot = new uPlot(options, prepared.data, chartHost);
    state.resizeObserver = new ResizeObserver(entries => {
      const width = Math.floor(entries[0]?.contentRect.width || 0);
      if (state.plot && width >= 320) {
        state.plot.setSize({ width, height: 260 });
      }
    });
    state.resizeObserver.observe(chartHost);
  } catch {
    destroyPlot(state);
    chartHost.replaceChildren(node('div', 'kx-notice', 'Chart rendering failed; the saved table preview remains available.'));
  }
}

function chartData(
  payload: PortableKxResult,
  chart: NotebookChartSpec,
  limit: number
): { data: uPlot.AlignedData; temporal: boolean; seriesNames: string[] } | undefined {
  try {
    const built = buildChartData(portableTable(payload), {
      chartType: chart.type,
      xColumn: chart.xColumn,
      yColumns: chart.yColumns,
      width: 720,
      version: 1,
      requestId: 1,
      maxSourceRows: payload.result.previewRowCount,
      maxSampledPoints: limit,
    });
    if (built.x.length === 0 || built.series.length === 0) {
      return undefined;
    }
    return {
      temporal: built.xKind === 'temporal',
      seriesNames: built.series.map(series => series.columnName),
      data: [
        built.x,
        ...built.series.map(series => series.values),
      ],
    };
  } catch {
    return undefined;
  }
}

function chartColumns(payload: PortableKxResult): { x: string[]; numeric: string[] } {
  const options = chartColumnOptions(portableTable(payload), 200);
  return {
    x: options.xColumns.map(option => option.columnName),
    numeric: options.yColumns.map(option => option.columnName),
  };
}

function ensureChartSpec(state: OutputState): void {
  if (state.chart) {
    return;
  }
  const candidates = chartColumns(state.payload);
  const xColumn = candidates.x.find(name => candidates.numeric.some(candidate => candidate !== name));
  const yColumn = candidates.numeric.find(name => name !== xColumn);
  if (!xColumn || !yColumn) {
    return;
  }
  state.chart = {
    version: 1,
    visible: true,
    type: 'line',
    xColumn,
    yColumns: [yColumn],
  };
}

function openPreview(
  context: RendererContext<RendererState>,
  state: OutputState,
  status: HTMLElement
): void {
  if (!context.postMessage) {
    status.textContent = 'The extension host is unavailable; the saved inline preview still works.';
    return;
  }
  context.postMessage({ type: 'openPreview', payload: state.payload });
  status.textContent = 'Opening the saved bounded preview. Omitted rows cannot be recovered from the notebook.';
}

function installStyles(): void {
  if (document.getElementById('kx-notebook-renderer-style')) {
    return;
  }
  const style = document.createElement('style');
  style.id = 'kx-notebook-renderer-style';
  style.textContent = `${uPlotCss}\n${rendererCss}`;
  document.head.append(style);
}

function renderError(element: HTMLElement, message: string): void {
  const root = node('div', 'kx-error', message);
  root.setAttribute('role', 'alert');
  element.append(root);
}

function destroyPlot(state: OutputState): void {
  state.resizeObserver?.disconnect();
  state.resizeObserver = undefined;
  state.plot?.destroy();
  state.plot = undefined;
}

function disposeState(id: string): void {
  const state = states.get(id);
  if (!state) {
    return;
  }
  destroyPlot(state);
  states.delete(id);
}

function node<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  className = '',
  text?: string
): HTMLElementTagNameMap[Tag] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function button(text: string, action: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = text;
  element.addEventListener('click', action);
  return element;
}

function labelledSelect(
  label: string,
  values: string[],
  selected: string,
  onChange: (value: string) => void
): HTMLLabelElement {
  const wrapper = node('label', 'kx-control');
  wrapper.append(node('span', '', label));
  const select = document.createElement('select');
  values.forEach(value => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    option.selected = value === selected;
    select.append(option);
  });
  select.addEventListener('change', () => onChange(select.value));
  wrapper.append(select);
  return wrapper;
}

function portableTable(payload: PortableKxResult): ColumnarPanelResult {
  return createColumnarPanelResult(
    payload.schema.columns.map(column => column.name),
    payload.data.rows.length,
    (rowIndex, columnIndex) => portableCellText(payload.data.rows[rowIndex][columnIndex])
  );
}

async function copyText(value: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error('Clipboard unavailable');
  }
  await navigator.clipboard.writeText(value);
}

function formatElapsed(value: number): string {
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
}

function isPresentation(value: unknown): value is NotebookPresentation {
  return value === 'inline' || value === 'panel' || value === 'both';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const rendererCss = `
.kx-root{box-sizing:border-box;border:1px solid var(--vscode-notebook-cellBorderColor,var(--vscode-panel-border,#555));border-radius:5px;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-family:var(--vscode-font-family,system-ui,sans-serif);font-size:var(--vscode-font-size,13px);padding:8px;max-width:100%}
.kx-header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px}.kx-heading-wrap{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.kx-heading{font-size:1.05em}.kx-meta{color:var(--vscode-descriptionForeground);font-size:.92em}
.kx-toolbar,.kx-chart-controls,.kx-pagination{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.kx-chart-controls{align-items:flex-end}.kx-root button,.kx-root select{font:inherit;color:var(--vscode-button-secondaryForeground,var(--vscode-foreground));background:var(--vscode-button-secondaryBackground,var(--vscode-editorWidget-background));border:1px solid var(--vscode-button-border,var(--vscode-panel-border,#777));border-radius:3px;padding:3px 7px}.kx-root button:hover:not(:disabled){background:var(--vscode-button-secondaryHoverBackground)}.kx-root button:disabled{opacity:.55}
.kx-notice,.kx-panel-mode,.kx-error{margin:7px 0;padding:6px 8px;border-left:3px solid var(--vscode-notificationsWarningIcon-foreground,#cca700);background:var(--vscode-textBlockQuote-background)}.kx-error{border-left-color:var(--vscode-errorForeground,#f14c4c)}
.kx-source{margin:6px 0}.kx-source pre{white-space:pre-wrap;max-height:150px;overflow:auto;background:var(--vscode-textCodeBlock-background);padding:6px}.kx-table-wrap{max-height:420px;overflow:auto;border:1px solid var(--vscode-panel-border,#555);margin:6px 0}.kx-table-wrap table{border-collapse:separate;border-spacing:0;min-width:100%;width:max-content}.kx-table-wrap th,.kx-table-wrap td{border-right:1px solid var(--vscode-panel-border,#555);border-bottom:1px solid var(--vscode-panel-border,#555);padding:3px 7px;max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}.kx-table-wrap th{position:sticky;top:0;z-index:1;background:var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-editor-background))}.kx-column-type{display:block;color:var(--vscode-descriptionForeground);font-size:.78em;font-weight:normal}.kx-control{display:flex;flex-direction:column;gap:2px;color:var(--vscode-descriptionForeground);font-size:.9em}.kx-control select{color:var(--vscode-foreground);min-width:90px}.kx-chart-panel{border-top:1px solid var(--vscode-panel-border,#555);padding-top:7px;margin-top:7px}.kx-chart-host{width:100%;min-height:260px;margin-top:6px;overflow:hidden}.kx-chart-host .uplot{font-family:var(--vscode-font-family,system-ui,sans-serif)}.kx-status{min-height:1.2em;margin-top:5px;color:var(--vscode-descriptionForeground);font-size:.9em}
`;
