import uPlot from 'uplot';
import uPlotCss from 'uplot/dist/uPlot.min.css';
import type { ActivationFunction, OutputItem, RendererContext } from 'vscode-notebook-renderer';
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
import {
  MAX_NOTEBOOK_LIVE_CHART_POINTS,
  MAX_NOTEBOOK_LIVE_REQUEST_ID,
  MAX_NOTEBOOK_LIVE_SEARCH_CHARS,
  MAX_NOTEBOOK_LIVE_SLICE_CELLS,
  MAX_NOTEBOOK_LIVE_SLICE_COLUMNS,
  MAX_NOTEBOOK_LIVE_SLICE_ROWS,
  NOTEBOOK_LIVE_RESULT_METADATA_KEY,
  NotebookLiveChartData,
  NotebookLiveChartType,
  NotebookLiveResultMetadata,
  NotebookLiveSortDirection,
  NotebookRendererHostMessage,
  NotebookSharedKxResultSettings,
  NotebookResultSettingKey,
  parseNotebookLiveResultReference,
  parseNotebookRendererHostMessage,
} from '../src/notebook-message';
import { qTextRenderModel } from '../src/q-text';

type NotebookPresentation = 'inline' | 'panel' | 'both';
type LiveStatus = 'none' | 'requesting' | 'available' | 'unavailable';

interface LiveSliceState {
  requestId: number;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  cells: string[][];
}

interface LiveSelection {
  anchorRow: number;
  anchorColumn: number;
  focusRow: number;
  focusColumn: number;
}

interface LiveSearchState {
  query: string;
  requestId: number;
  pending: boolean;
  matches: number[];
  activeIndex: number;
  capped: boolean;
  partial: boolean;
  error?: string;
}

interface LiveChartState {
  visible: boolean;
  chartType: NotebookLiveChartType;
  xColumn: string;
  yColumns: string[];
  maxPoints: number;
  requestId: number;
  pending: boolean;
  data?: NotebookLiveChartData;
  error?: string;
}

interface OutputState {
  id: string;
  element: HTMLElement;
  payload: PortableKxResult;
  savedChart: NotebookChartSpec | undefined;
  savedChartVisible: boolean;
  savedTableVisible: boolean;
  savedTablePageStart: number;
  savedMaxChartPoints: number;
  plot?: uPlot;
  resizeObserver?: ResizeObserver;
  panelOpened: boolean;
  liveId?: string;
  liveStatus: LiveStatus;
  liveRequestId: number;
  liveMode?: 'table' | 'text';
  liveKind?: string;
  liveColumns: string[];
  liveRowCount: number;
  liveText?: string;
  liveMetadata?: NotebookLiveResultMetadata;
  liveMessage?: string;
  liveSlice?: LiveSliceState;
  liveSliceError?: string;
  liveSliceRequestId: number;
  liveScrollTop: number;
  liveScrollLeft: number;
  liveSortColumn?: string;
  liveSortDirection?: NotebookLiveSortDirection;
  liveSelection?: LiveSelection;
  liveSearch: LiveSearchState;
  liveChart: LiveChartState;
  renderTimer?: number;
  searchTimer?: number;
}

interface RendererState {
  presentation?: NotebookPresentation;
}

const TABLE_PAGE_SIZE = 250;
const MAX_TABLE_PAGE_CELLS = 5000;
const LIVE_GRID_HEIGHT = 420;
const LIVE_HEADER_HEIGHT = 30;
const LIVE_ROW_INDEX_WIDTH = 64;
const LIVE_ROW_OVERSCAN = 8;
const LIVE_COLUMN_OVERSCAN = 2;
const LIVE_MAX_RENDER_ROWS = 120;
const LIVE_MAX_RENDER_COLUMNS = 48;
const LIVE_MAX_CANVAS_HEIGHT = 8_000_000;
const LIVE_DEFAULT_CHART_POINTS = 2500;
const LIVE_CLIPBOARD_CELL_LIMIT = 20_000;
const states = new Map<string, OutputState>();
let presentation: NotebookPresentation = 'inline';
let requestSequence = 0;
let resultSettings: NotebookSharedKxResultSettings = defaultResultSettings();

export const activate: ActivationFunction<RendererState> = context => {
  installStyles();
  const restored = context.getState();
  if (isPresentation(restored?.presentation)) {
    presentation = restored.presentation;
  }
  context.onDidReceiveMessage?.(event => {
    const message = parseNotebookRendererHostMessage(event);
    if (message) {
      receiveHostMessage(context, message);
    }
  });
  context.postMessage?.({ type: 'ready' });

  return {
    renderOutputItem(outputItem, element) {
      disposeState(outputItem.id);
      element.replaceChildren();
      const payload = portablePayload(outputItem, element);
      if (!payload) {
        return;
      }
      const liveReference = liveResultReference(outputItem);
      const state: OutputState = {
        id: outputItem.id,
        element,
        payload,
        savedChart: payload.chart
          ? { ...payload.chart, yColumns: payload.chart.yColumns.slice() }
          : undefined,
        savedChartVisible: payload.chart?.visible === true,
        savedTableVisible: true,
        savedTablePageStart: 0,
        savedMaxChartPoints: 1000,
        panelOpened: false,
        liveId: liveReference?.id,
        liveStatus: liveReference ? 'requesting' : 'none',
        liveRequestId: 0,
        liveColumns: [],
        liveRowCount: 0,
        liveSliceRequestId: 0,
        liveScrollTop: 0,
        liveScrollLeft: 0,
        liveSearch: emptyLiveSearch(),
        liveChart: emptyLiveChart(),
      };
      states.set(outputItem.id, state);
      renderState(context, state);
      if (state.liveId) {
        requestLiveResult(context, state);
      }
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

function receiveHostMessage(
  context: RendererContext<RendererState>,
  message: NotebookRendererHostMessage
): void {
  if (message.type === 'settings') {
    const previous = resultSettings;
    presentation = message.presentation;
    resultSettings = message.resultSettings;
    context.setState({ presentation });
    const conversionChanged =
      previous.functionDisplayStrategy !== resultSettings.functionDisplayStrategy ||
      previous.dictionaryDisplayStrategy !== resultSettings.dictionaryDisplayStrategy ||
      previous.listDisplayStrategy !== resultSettings.listDisplayStrategy ||
      previous.objectDisplayStrategy !== resultSettings.objectDisplayStrategy;
    const sliceTextChanged = previous.arrayDisplayFormat !== resultSettings.arrayDisplayFormat;
    states.forEach(state => {
      if (conversionChanged && state.liveId && state.liveStatus === 'available') {
        requestLiveResult(context, state);
        return;
      }
      if (sliceTextChanged && state.liveMode === 'table') {
        state.liveSlice = undefined;
        state.liveSliceError = undefined;
      }
      renderState(context, state);
    });
    return;
  }

  const matching = [...states.values()].filter(state => state.liveId === message.liveId);
  for (const state of matching) {
    if (message.type === 'liveResult') {
      receiveLiveResult(context, state, message);
    } else if (message.type === 'liveSlice') {
      if (message.requestId !== state.liveSliceRequestId) {
        continue;
      }
      let retryWithoutSort = false;
      if (message.error) {
        state.liveSliceError = message.error;
        state.liveSlice = undefined;
        if (state.liveSortColumn && state.liveSortDirection) {
          state.liveSortColumn = undefined;
          state.liveSortDirection = undefined;
          retryWithoutSort = true;
        }
      } else {
        state.liveSliceError = undefined;
        state.liveSlice = {
          requestId: message.requestId,
          startRow: message.startRow,
          endRow: message.endRow,
          startColumn: message.startColumn,
          endColumn: message.endColumn,
          cells: message.cells,
        };
      }
      renderState(context, state);
      if (retryWithoutSort) {
        requestLiveSlice(context, state, liveWindow(state, 720));
      }
    } else if (message.type === 'liveSearch') {
      if (message.requestId !== state.liveSearch.requestId) {
        continue;
      }
      state.liveSearch.pending = false;
      state.liveSearch.matches = message.matches;
      state.liveSearch.activeIndex = message.matches.length > 0 ? 0 : -1;
      state.liveSearch.capped = message.capped;
      state.liveSearch.partial = message.partial;
      state.liveSearch.error = message.error;
      if (state.liveSearch.activeIndex >= 0) {
        scrollLiveRowIntoView(state, state.liveSearch.matches[0]);
      }
      renderState(context, state);
    } else if (message.type === 'liveChart') {
      if (message.requestId !== state.liveChart.requestId) {
        continue;
      }
      state.liveChart.pending = false;
      state.liveChart.data = message.data;
      state.liveChart.error = message.error;
      renderState(context, state);
    }
  }
}

function receiveLiveResult(
  context: RendererContext<RendererState>,
  state: OutputState,
  message: Extract<NotebookRendererHostMessage, { type: 'liveResult' }>
): void {
  if (message.requestId !== state.liveRequestId) {
    return;
  }
  if (!message.available) {
    state.liveStatus = 'unavailable';
    state.liveMode = undefined;
    state.liveColumns = [];
    state.liveRowCount = 0;
    state.liveText = undefined;
    state.liveMetadata = undefined;
    state.liveSlice = undefined;
    state.liveSliceError = undefined;
    state.liveMessage = message.message ||
      'The in-session full result is no longer available; the saved bounded snapshot remains.';
    renderState(context, state);
    return;
  }
  state.liveStatus = 'available';
  state.liveMode = message.mode;
  state.liveKind = message.kind;
  state.liveColumns = message.columns || [];
  state.liveRowCount = message.rowCount || 0;
  state.liveText = message.text;
  state.liveMetadata = message.metadata;
  state.liveMessage = message.message;
  state.liveSlice = undefined;
  state.liveSliceError = undefined;
  state.liveSortColumn = undefined;
  state.liveSortDirection = undefined;
  state.liveSelection = undefined;
  state.liveSearch = emptyLiveSearch();
  state.liveChart = chartForColumns(state.liveColumns);
  renderState(context, state);
}

function renderState(context: RendererContext<RendererState>, state: OutputState): void {
  destroyPlot(state);
  state.element.replaceChildren();
  const root = node('section', 'kx-root');
  root.setAttribute('aria-label', 'KX q notebook result');
  state.element.append(root);

  renderHeader(context, state, root);
  if (usePanelOnlyPresentation(state)) {
    renderPanelOnly(context, state, root);
    return;
  }

  if (state.liveStatus === 'available') {
    renderLiveResult(context, state, root);
  } else {
    renderSavedResult(context, state, root);
  }
}

function renderHeader(
  context: RendererContext<RendererState>,
  state: OutputState,
  root: HTMLElement
): void {
  const header = node('header', 'kx-header');
  const headingWrap = node('div', 'kx-heading-wrap');
  headingWrap.append(node('strong', 'kx-heading', 'KX/q result'));
  const label = state.liveMetadata?.connectionName || state.payload.provenance.label;
  if (label) {
    headingWrap.append(node('span', 'kx-meta', label));
  }
  const elapsed = state.liveMetadata?.elapsedMs ?? state.payload.provenance.elapsedMs;
  if (elapsed !== undefined) {
    headingWrap.append(node('span', 'kx-meta', formatElapsed(elapsed)));
  }
  headingWrap.append(liveBadge(state));
  header.append(headingWrap);

  const toolbar = node('div', 'kx-toolbar');
  if (state.liveStatus === 'available' && state.liveId && context.postMessage) {
    toolbar.append(button('Open full result in KX Results', () => {
      context.postMessage?.({ type: 'openLiveResult', liveId: state.liveId });
    }));
  } else if (context.postMessage) {
    toolbar.append(button('Open saved preview in KX Results', () => {
      openPreview(context, state, statusNode(root));
    }));
  }
  toolbar.append(resultSettingsControl(context));
  header.append(toolbar);
  root.append(header);
}

function liveBadge(state: OutputState): HTMLElement {
  if (state.liveStatus === 'available') {
    return node('span', 'kx-badge kx-badge-live', 'Live full result');
  }
  if (state.liveStatus === 'requesting') {
    return node('span', 'kx-badge', 'Checking live result…');
  }
  return node('span', 'kx-badge kx-badge-saved', 'Saved bounded snapshot');
}

function renderPanelOnly(
  context: RendererContext<RendererState>,
  state: OutputState,
  root: HTMLElement
): void {
  const status = node('div', 'kx-status');
  root.append(node(
    'div',
    'kx-panel-mode',
    'Notebook presentation is set to panel. This cell keeps a bounded portable snapshot.'
  ), status);
  if (!state.panelOpened && context.postMessage) {
    state.panelOpened = true;
    openPreview(context, state, status);
  }
}

function renderLiveResult(
  context: RendererContext<RendererState>,
  state: OutputState,
  root: HTMLElement
): void {
  const saved = state.payload.result;
  const liveCount = state.liveMode === 'table' ? state.liveRowCount : 1;
  const notice = node('div', 'kx-live-notice');
  notice.append(node('strong', '', 'Live in-session view. '));
  notice.append(document.createTextNode(
    `${liveCount.toLocaleString()} ${state.liveMode === 'table' ? 'rows' : 'result'} are available from the decoded Direct IPC response. ` +
    `The .ipynb stores only ${saved.previewRowCount.toLocaleString()} of ${saved.rowCount.toLocaleString()} preview rows; ` +
    'closing or reloading the extension can leave only that snapshot.'
  ));
  root.append(notice);

  if (state.liveMetadata?.messages?.length) {
    const messages = node('div', 'kx-messages');
    state.liveMetadata.messages.forEach(message => messages.append(node('div', '', message)));
    root.append(messages);
  }
  if (state.liveMessage) {
    root.append(node('div', 'kx-status', state.liveMessage));
  }
  if (state.liveSliceError) {
    root.append(node('div', 'kx-status', state.liveSliceError));
  }

  if (state.liveMode === 'text') {
    renderLiveText(state, root);
  } else {
    renderLiveTableTools(context, state, root);
    renderLiveGrid(context, state, root);
    if (state.liveChart.visible) {
      renderLiveChart(context, state, root);
    }
  }
  renderSource(state, root);
}

function renderLiveText(state: OutputState, root: HTMLElement): void {
  const raw = state.liveText || '';
  const model = qTextRenderModel(raw, {
    syntaxHighlighting: resultSettings.qTextSyntaxHighlighting,
    displayFormatting: resultSettings.qTextDisplayFormatting,
  });
  const pre = node('pre', 'kx-qtext');
  pre.setAttribute('aria-label', `Live ${state.liveKind || 'qText'} result`);
  if (!resultSettings.qTextSyntaxHighlighting || !model.highlighted) {
    pre.textContent = resultSettings.qTextDisplayFormatting ? model.text : raw;
  } else {
    model.segments.forEach(segment => {
      const span = node('span', qTextTokenClass(segment.kind), segment.text);
      pre.append(span);
    });
  }
  root.append(pre);
  if (resultSettings.qTextDisplayFormatting) {
    root.append(node(
      'div',
      'kx-status',
      model.formatted
        ? 'Display-only qText formatting applied. Copy/open-full actions retain the underlying result.'
        : 'Display-only qText formatting left this output unchanged.'
    ));
  }
}

function renderLiveTableTools(
  context: RendererContext<RendererState>,
  state: OutputState,
  root: HTMLElement
): void {
  const tools = node('div', 'kx-live-tools');
  const input = document.createElement('input');
  input.type = 'search';
  input.maxLength = MAX_NOTEBOOK_LIVE_SEARCH_CHARS;
  input.placeholder = 'Search full live result';
  input.setAttribute('aria-label', 'Search full live KX result');
  input.value = state.liveSearch.query;
  input.addEventListener('input', () => {
    state.liveSearch.query = input.value.slice(0, MAX_NOTEBOOK_LIVE_SEARCH_CHARS);
    scheduleLiveSearch(context, state);
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      requestLiveSearch(context, state);
    }
  });
  tools.append(input);
  const previous = button('Previous match', () => moveLiveSearchMatch(context, state, -1));
  const next = button('Next match', () => moveLiveSearchMatch(context, state, 1));
  previous.disabled = state.liveSearch.matches.length === 0;
  next.disabled = state.liveSearch.matches.length === 0;
  tools.append(previous, next, node('span', 'kx-meta', liveSearchStatus(state)));
  const copy = button('Copy loaded selection', () => {
    void copyLiveSelection(state).catch(() => undefined);
  });
  copy.disabled = !selectionWithinLiveSlice(state);
  tools.append(copy);
  tools.append(button(state.liveChart.visible ? 'Hide chart' : 'Chart full result', () => {
    state.liveChart.visible = !state.liveChart.visible;
    if (state.liveChart.visible && !state.liveChart.data && !state.liveChart.pending) {
      requestLiveChart(context, state);
    }
    renderState(context, state);
  }));
  root.append(tools);
}

function renderLiveGrid(
  context: RendererContext<RendererState>,
  state: OutputState,
  root: HTMLElement
): void {
  if (state.liveColumns.length === 0 || state.liveRowCount === 0) {
    root.append(node('div', 'kx-empty', 'The live result is an empty table.'));
    return;
  }
  const viewport = node('div', 'kx-live-viewport');
  viewport.tabIndex = 0;
  viewport.setAttribute('role', 'grid');
  viewport.setAttribute('aria-rowcount', String(state.liveRowCount));
  viewport.setAttribute('aria-colcount', String(state.liveColumns.length));
  viewport.style.height = `${LIVE_GRID_HEIGHT}px`;
  const cellWidth = resultSettings.cellWidth;
  const rowIndexWidth = resultSettings.showRowIndex ? LIVE_ROW_INDEX_WIDTH : 0;
  const canvas = node('div', 'kx-live-canvas');
  canvas.style.width = `${rowIndexWidth + state.liveColumns.length * cellWidth}px`;
  canvas.style.height = `${liveCanvasHeight(state)}px`;
  viewport.append(canvas);
  root.append(viewport);

  const window = liveWindow(state, viewport.clientWidth || 720);
  renderLiveHeaders(context, state, canvas, window.startColumn, window.endColumn);
  renderLiveCells(state, canvas, window);
  viewport.scrollTop = state.liveScrollTop;
  viewport.scrollLeft = state.liveScrollLeft;
  viewport.addEventListener('scroll', () => {
    if (viewport.scrollTop === state.liveScrollTop &&
      viewport.scrollLeft === state.liveScrollLeft) {
      return;
    }
    state.liveScrollTop = viewport.scrollTop;
    state.liveScrollLeft = viewport.scrollLeft;
    scheduleLiveViewportRender(context, state);
  }, { passive: true });
  viewport.addEventListener('mouseup', () => {
    if (state.liveSelection) {
      renderState(context, state);
    }
  });

  if (!state.liveSliceError && !sliceContainsWindow(state.liveSlice, window)) {
    requestLiveSlice(context, state, window);
  }
}

interface LiveWindow {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

function liveWindow(state: OutputState, viewportWidth: number): LiveWindow {
  const rowHeight = resultSettings.rowHeight;
  const cellWidth = resultSettings.cellWidth;
  const rowIndexWidth = resultSettings.showRowIndex ? LIVE_ROW_INDEX_WIDTH : 0;
  const rawStartRow = Math.floor(
    Math.max(0, liveVirtualScrollTop(state) - LIVE_HEADER_HEIGHT) / rowHeight
  );
  const visibleRows = Math.ceil(LIVE_GRID_HEIGHT / rowHeight);
  const rawStartColumn = Math.floor(Math.max(0, state.liveScrollLeft - rowIndexWidth) / cellWidth);
  const visibleColumns = Math.ceil(Math.max(1, viewportWidth - rowIndexWidth) / cellWidth);
  const startRow = Math.max(0, rawStartRow - LIVE_ROW_OVERSCAN);
  const startColumn = Math.max(0, rawStartColumn - LIVE_COLUMN_OVERSCAN);
  let endRow = Math.min(
    state.liveRowCount - 1,
    startRow + Math.min(LIVE_MAX_RENDER_ROWS, visibleRows + LIVE_ROW_OVERSCAN * 2) - 1
  );
  let endColumn = Math.min(
    state.liveColumns.length - 1,
    startColumn + Math.min(LIVE_MAX_RENDER_COLUMNS, visibleColumns + LIVE_COLUMN_OVERSCAN * 2) - 1
  );
  const rows = endRow - startRow + 1;
  const columns = endColumn - startColumn + 1;
  if (rows * columns > MAX_NOTEBOOK_LIVE_SLICE_CELLS) {
    endColumn = startColumn + Math.max(1, Math.floor(MAX_NOTEBOOK_LIVE_SLICE_CELLS / rows)) - 1;
  }
  endRow = Math.min(endRow, startRow + MAX_NOTEBOOK_LIVE_SLICE_ROWS - 1);
  endColumn = Math.min(endColumn, startColumn + MAX_NOTEBOOK_LIVE_SLICE_COLUMNS - 1);
  return { startRow, endRow, startColumn, endColumn };
}

function renderLiveHeaders(
  context: RendererContext<RendererState>,
  state: OutputState,
  canvas: HTMLElement,
  startColumn: number,
  endColumn: number
): void {
  const rowIndexWidth = resultSettings.showRowIndex ? LIVE_ROW_INDEX_WIDTH : 0;
  if (resultSettings.showRowIndex) {
    const corner = node('div', 'kx-live-cell kx-live-header kx-live-corner', '#');
    placeLiveCell(corner, state.liveScrollLeft, state.liveScrollTop, LIVE_ROW_INDEX_WIDTH, LIVE_HEADER_HEIGHT);
    canvas.append(corner);
  }
  for (let columnIndex = startColumn; columnIndex <= endColumn; columnIndex++) {
    const columnName = state.liveColumns[columnIndex];
    const label = state.liveSortColumn === columnName
      ? `${columnName} ${state.liveSortDirection === 'asc' ? '▲' : '▼'}`
      : columnName;
    const header = button(label, () => {
      if (state.liveSortColumn === columnName) {
        if (state.liveSortDirection === 'asc') {
          state.liveSortDirection = 'desc';
        } else {
          state.liveSortColumn = undefined;
          state.liveSortDirection = undefined;
        }
      } else {
        state.liveSortColumn = columnName;
        state.liveSortDirection = 'asc';
      }
      state.liveSlice = undefined;
      state.liveSliceError = undefined;
      state.liveSelection = undefined;
      state.liveSearch = { ...emptyLiveSearch(), query: state.liveSearch.query };
      renderState(context, state);
      if (state.liveSearch.query) {
        requestLiveSearch(context, state);
      }
    });
    header.className = 'kx-live-cell kx-live-header';
    header.title = `Sort full live result by ${columnName}`;
    placeLiveCell(
      header,
      rowIndexWidth + columnIndex * resultSettings.cellWidth,
      state.liveScrollTop,
      resultSettings.cellWidth,
      LIVE_HEADER_HEIGHT
    );
    canvas.append(header);
  }
}

function renderLiveCells(state: OutputState, canvas: HTMLElement, window: LiveWindow): void {
  const slice = state.liveSlice;
  const rowIndexWidth = resultSettings.showRowIndex ? LIVE_ROW_INDEX_WIDTH : 0;
  const virtualTop = liveVirtualScrollTop(state);
  for (let rowIndex = window.startRow; rowIndex <= window.endRow; rowIndex++) {
    const top = state.liveScrollTop +
      (LIVE_HEADER_HEIGHT + rowIndex * resultSettings.rowHeight - virtualTop);
    if (resultSettings.showRowIndex) {
      const index = node('div', 'kx-live-cell kx-live-row-index', String(rowIndex + 1));
      placeLiveCell(
        index,
        state.liveScrollLeft,
        top,
        LIVE_ROW_INDEX_WIDTH,
        resultSettings.rowHeight
      );
      canvas.append(index);
    }
    for (let columnIndex = window.startColumn; columnIndex <= window.endColumn; columnIndex++) {
      const value = liveSliceCell(slice, rowIndex, columnIndex);
      const cell = node('div', 'kx-live-cell', value ?? '');
      cell.setAttribute('role', 'gridcell');
      cell.dataset.row = String(rowIndex);
      cell.dataset.column = String(columnIndex);
      if (value === undefined) {
        cell.classList.add('is-loading');
      }
      if (liveCellSelected(state.liveSelection, rowIndex, columnIndex)) {
        cell.classList.add('is-selected');
      }
      if (activeSearchRow(state, rowIndex)) {
        cell.classList.add('is-search-match');
      }
      cell.addEventListener('mousedown', event => {
        if (event.button !== 0) {
          return;
        }
        state.liveSelection = event.shiftKey && state.liveSelection
          ? { ...state.liveSelection, focusRow: rowIndex, focusColumn: columnIndex }
          : {
            anchorRow: rowIndex,
            anchorColumn: columnIndex,
            focusRow: rowIndex,
            focusColumn: columnIndex,
          };
        cell.classList.add('is-selected');
        event.preventDefault();
      });
      cell.addEventListener('mouseenter', event => {
        if ((event.buttons & 1) && state.liveSelection) {
          state.liveSelection.focusRow = rowIndex;
          state.liveSelection.focusColumn = columnIndex;
          cell.classList.add('is-selected');
        }
      });
      placeLiveCell(
        cell,
        rowIndexWidth + columnIndex * resultSettings.cellWidth,
        top,
        resultSettings.cellWidth,
        resultSettings.rowHeight
      );
      canvas.append(cell);
    }
  }
}

function placeLiveCell(
  element: HTMLElement,
  left: number,
  top: number,
  width: number,
  height: number
): void {
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
  if (resultSettings.fontSize > 0) {
    element.style.fontSize = `${resultSettings.fontSize}px`;
  }
}

function requestLiveSlice(
  context: RendererContext<RendererState>,
  state: OutputState,
  window: LiveWindow
): void {
  if (!context.postMessage || !state.liveId || state.liveStatus !== 'available' ||
    window.endRow < window.startRow || window.endColumn < window.startColumn) {
    return;
  }
  const rows = window.endRow - window.startRow + 1;
  const columns = window.endColumn - window.startColumn + 1;
  if (rows > MAX_NOTEBOOK_LIVE_SLICE_ROWS || columns > MAX_NOTEBOOK_LIVE_SLICE_COLUMNS ||
    rows * columns > MAX_NOTEBOOK_LIVE_SLICE_CELLS) {
    return;
  }
  const requestId = nextRequestId();
  state.liveSliceRequestId = requestId;
  context.postMessage({
    type: 'requestLiveSlice',
    liveId: state.liveId,
    requestId,
    startRow: window.startRow,
    endRow: window.endRow,
    startColumn: window.startColumn,
    endColumn: window.endColumn,
    ...liveSortFields(state),
  });
}

function renderLiveChart(
  context: RendererContext<RendererState>,
  state: OutputState,
  root: HTMLElement
): void {
  const panel = node('div', 'kx-chart-panel');
  const controls = node('div', 'kx-chart-controls');
  controls.append(labelledSelect(
    'Type',
    ['line', 'scatter', 'step', 'bar'],
    state.liveChart.chartType,
    value => {
      state.liveChart.chartType = value as NotebookLiveChartType;
      requestLiveChart(context, state);
      renderState(context, state);
    }
  ));
  controls.append(labelledSelect('X', state.liveColumns, state.liveChart.xColumn, value => {
    state.liveChart.xColumn = value;
    state.liveChart.yColumns = state.liveChart.yColumns.filter(name => name !== value);
    if (state.liveChart.yColumns.length === 0) {
      const fallback = state.liveColumns.find(name => name !== value);
      state.liveChart.yColumns = fallback ? [fallback] : [];
    }
    requestLiveChart(context, state);
    renderState(context, state);
  }));
  const y = labelledSelect(
    'Y',
    state.liveColumns.filter(name => name !== state.liveChart.xColumn),
    state.liveChart.yColumns[0] || '',
    value => {
      state.liveChart.yColumns = value ? [value] : [];
      requestLiveChart(context, state);
      renderState(context, state);
    }
  );
  controls.append(y);
  controls.append(labelledSelect(
    'Point cap',
    ['500', '1000', '2500', '7000'],
    String(state.liveChart.maxPoints),
    value => {
      state.liveChart.maxPoints = Math.min(MAX_NOTEBOOK_LIVE_CHART_POINTS, Number(value));
      requestLiveChart(context, state);
      renderState(context, state);
    }
  ));
  controls.append(button('Reset zoom', () => {
    if (state.plot) {
      state.plot.setData(state.plot.data, true);
    }
  }));
  panel.append(controls);
  const status = node('div', 'kx-status');
  if (state.liveChart.pending) {
    status.textContent = 'Preparing sampled chart data from the full live result…';
  } else if (state.liveChart.error) {
    status.textContent = state.liveChart.error;
  } else if (state.liveChart.data?.warnings?.length) {
    status.textContent = state.liveChart.data.warnings.join(' ');
  }
  panel.append(status);
  const host = node('div', 'kx-chart-host');
  panel.append(host);
  root.append(panel);

  if (!state.liveChart.pending && !state.liveChart.error && state.liveChart.data) {
    drawLiveChart(state, host, state.liveChart.data);
  }
}

function requestLiveChart(
  context: RendererContext<RendererState>,
  state: OutputState
): void {
  const chart = state.liveChart;
  if (!context.postMessage || !state.liveId || !chart.xColumn || chart.yColumns.length === 0) {
    return;
  }
  const requestId = nextRequestId();
  chart.requestId = requestId;
  chart.pending = true;
  chart.data = undefined;
  chart.error = undefined;
  context.postMessage({
    type: 'requestLiveChart',
    liveId: state.liveId,
    requestId,
    chartType: chart.chartType,
    xColumn: chart.xColumn,
    yColumns: chart.yColumns.slice(0, 16),
    maxPoints: Math.min(MAX_NOTEBOOK_LIVE_CHART_POINTS, Math.max(1, chart.maxPoints)),
  });
}

function drawLiveChart(state: OutputState, host: HTMLElement, data: NotebookLiveChartData): void {
  if (data.x.length === 0 || data.series.length === 0) {
    host.append(node('div', 'kx-notice', 'Chart has no finite sampled points.'));
    return;
  }
  const colors = chartColors();
  const series: uPlot.Series[] = [{ label: data.xColumn }];
  data.series.forEach((item, index) => {
    const color = colors[index % colors.length];
    const config: uPlot.Series = {
      label: item.columnName,
      stroke: color,
      width: data.chartType === 'scatter' || data.chartType === 'bar' ? 0 : 1.5,
      points: {
        show: data.chartType === 'scatter',
        size: data.chartType === 'scatter' ? 5 : 3,
        stroke: color,
        fill: color,
      },
      value: (_self, rawValue) => rawValue === null || rawValue === undefined
        ? ''
        : Number(rawValue).toFixed(resultSettings.chartDecimalPlaces),
    };
    if (data.chartType === 'step' && uPlot.paths.stepped) {
      config.paths = uPlot.paths.stepped({ align: 1 });
    }
    if (data.chartType === 'bar' && uPlot.paths.bars) {
      config.paths = uPlot.paths.bars({ size: [0.8, 60, 1], gap: 1 });
      config.fill = color;
    }
    series.push(config);
  });
  createPlot(state, host, {
    width: Math.max(320, Math.floor(host.getBoundingClientRect().width || 720)),
    height: 280,
    series,
    scales: { x: { time: data.xKind === 'temporal' }, y: { auto: true } },
    cursor: { drag: { setScale: true, x: true, y: false, dist: 5 } },
    legend: { show: true },
  }, [data.x, ...data.series.map(item => item.values)] as uPlot.AlignedData);
}

function scheduleLiveSearch(
  context: RendererContext<RendererState>,
  state: OutputState
): void {
  if (state.searchTimer !== undefined) {
    window.clearTimeout(state.searchTimer);
  }
  state.searchTimer = window.setTimeout(() => {
    state.searchTimer = undefined;
    requestLiveSearch(context, state);
  }, 250);
}

function requestLiveSearch(
  context: RendererContext<RendererState>,
  state: OutputState
): void {
  if (!context.postMessage || !state.liveId || state.liveMode !== 'table') {
    return;
  }
  const query = state.liveSearch.query.slice(0, MAX_NOTEBOOK_LIVE_SEARCH_CHARS);
  if (!query) {
    state.liveSearch = emptyLiveSearch();
    renderState(context, state);
    return;
  }
  const requestId = nextRequestId();
  state.liveSearch.requestId = requestId;
  state.liveSearch.pending = true;
  state.liveSearch.error = undefined;
  context.postMessage({
    type: 'searchLiveResult',
    liveId: state.liveId,
    requestId,
    query,
    ...liveSortFields(state),
  });
}

function moveLiveSearchMatch(
  context: RendererContext<RendererState>,
  state: OutputState,
  direction: number
): void {
  if (state.liveSearch.matches.length === 0) {
    return;
  }
  const count = state.liveSearch.matches.length;
  state.liveSearch.activeIndex =
    (state.liveSearch.activeIndex + direction + count) % count;
  scrollLiveRowIntoView(state, state.liveSearch.matches[state.liveSearch.activeIndex]);
  renderState(context, state);
}

function scrollLiveRowIntoView(state: OutputState, row: number): void {
  const virtualTop = Math.max(
    0,
    LIVE_HEADER_HEIGHT + row * resultSettings.rowHeight - Math.floor(LIVE_GRID_HEIGHT / 2)
  );
  state.liveScrollTop = livePhysicalScrollTop(state, virtualTop);
  state.liveSlice = undefined;
}

function liveCanvasHeight(state: OutputState): number {
  return Math.max(
    LIVE_GRID_HEIGHT,
    Math.min(LIVE_MAX_CANVAS_HEIGHT, liveVirtualHeight(state))
  );
}

function liveVirtualHeight(state: OutputState): number {
  return Math.max(
    LIVE_GRID_HEIGHT,
    LIVE_HEADER_HEIGHT + state.liveRowCount * resultSettings.rowHeight
  );
}

function liveVirtualScrollTop(state: OutputState): number {
  const maximumPhysical = Math.max(0, liveCanvasHeight(state) - LIVE_GRID_HEIGHT);
  const maximumVirtual = Math.max(0, liveVirtualHeight(state) - LIVE_GRID_HEIGHT);
  if (maximumPhysical === 0 || maximumVirtual === 0) {
    return 0;
  }
  return Math.min(maximumPhysical, Math.max(0, state.liveScrollTop)) /
    maximumPhysical * maximumVirtual;
}

function livePhysicalScrollTop(state: OutputState, virtualTop: number): number {
  const maximumPhysical = Math.max(0, liveCanvasHeight(state) - LIVE_GRID_HEIGHT);
  const maximumVirtual = Math.max(0, liveVirtualHeight(state) - LIVE_GRID_HEIGHT);
  if (maximumPhysical === 0 || maximumVirtual === 0) {
    return 0;
  }
  return Math.min(maximumVirtual, Math.max(0, virtualTop)) /
    maximumVirtual * maximumPhysical;
}

function renderSavedResult(
  context: RendererContext<RendererState>,
  state: OutputState,
  root: HTMLElement
): void {
  const status = node('div', 'kx-status');
  status.setAttribute('role', 'status');
  if (state.liveStatus === 'requesting') {
    root.append(node(
      'div',
      'kx-live-pending',
      'Checking whether the full decoded result is still available in this extension-host session…'
    ));
  } else if (state.liveStatus === 'unavailable') {
    root.append(node(
      'div',
      'kx-notice',
      state.liveMessage ||
        'The full in-session result is unavailable. Rendering only the bounded snapshot stored in this notebook.'
    ));
  }
  if (presentation === 'both' && state.payload.provenance.marker !== 'direct-ipc' &&
    !state.panelOpened && context.postMessage) {
    state.panelOpened = true;
    openPreview(context, state, status);
  }

  const toolbar = node('div', 'kx-toolbar kx-saved-toolbar');
  toolbar.append(button(state.savedTableVisible ? 'Hide saved table' : 'Show saved table', () => {
    state.savedTableVisible = !state.savedTableVisible;
    renderState(context, state);
  }));
  if (chartColumns(state.payload).numeric.length > 0 && state.payload.schema.columns.length > 1) {
    toolbar.append(button(state.savedChartVisible ? 'Hide saved chart' : 'Chart saved preview', () => {
      state.savedChartVisible = !state.savedChartVisible;
      ensureSavedChartSpec(state);
      renderState(context, state);
    }));
  }
  toolbar.append(button('Copy saved preview CSV', () => {
    void copyText(notebookResultToCsv(state.payload)).then(
      () => { status.textContent = 'Saved bounded preview copied as CSV.'; },
      () => { status.textContent = 'Clipboard access was unavailable.'; }
    );
  }));
  root.append(toolbar);

  const result = state.payload.result;
  const notice = node('div', 'kx-notice');
  notice.append(node('strong', '', 'Saved bounded snapshot. '));
  notice.append(document.createTextNode(
    `${result.previewRowCount.toLocaleString()} of ${result.rowCount.toLocaleString()} rows are stored` +
    `${result.truncated ? ` (${result.truncationReasons.join(', ') || 'configured limit'})` : ''}. ` +
    'Rows omitted from the .ipynb cannot be recovered from this output.'
  ));
  root.append(notice);
  renderSource(state, root);
  if (state.savedChartVisible) {
    renderSavedChartControls(context, state, root, status);
  }
  if (state.savedTableVisible) {
    renderSavedTable(context, state, root);
  }
  root.append(status);
}

function renderSavedTable(
  context: RendererContext<RendererState>,
  state: OutputState,
  root: HTMLElement
): void {
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
    th.append(node('span', 'kx-column-type', column.type));
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
  const pageStart = Math.min(state.savedTablePageStart, lastPageStart);
  const pageEnd = Math.min(state.payload.data.rows.length, pageStart + pageSize);
  state.payload.data.rows.slice(pageStart, pageEnd).forEach(row => {
    const tr = document.createElement('tr');
    row.forEach(cell => {
      tr.append(node('td', '', portableCellText(cell)));
    });
    body.append(tr);
  });
  table.append(body);
  wrap.append(table);
  root.append(wrap);
  if (state.payload.data.rows.length > pageSize) {
    const pagination = node('div', 'kx-pagination');
    const previous = button('Previous page', () => {
      state.savedTablePageStart = Math.max(0, pageStart - pageSize);
      renderState(context, state);
    });
    previous.disabled = pageStart === 0;
    const next = button('Next page', () => {
      state.savedTablePageStart = Math.min(lastPageStart, pageStart + pageSize);
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

function renderSavedChartControls(
  context: RendererContext<RendererState>,
  state: OutputState,
  root: HTMLElement,
  status: HTMLElement
): void {
  ensureSavedChartSpec(state);
  const chart = state.savedChart;
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
  controls.append(labelledSelect(
    'Y',
    candidates.numeric.filter(name => name !== chart.xColumn),
    chart.yColumns[0] || '',
    value => {
      chart.yColumns = value ? [value] : [];
      renderState(context, state);
    }
  ));
  controls.append(labelledSelect(
    'Point cap',
    ['500', '1000', '2500'],
    String(state.savedMaxChartPoints),
    value => {
      state.savedMaxChartPoints = Number(value);
      renderState(context, state);
    }
  ));
  controls.append(button('Reset zoom', () => {
    if (state.plot) {
      state.plot.setData(state.plot.data, true);
    }
  }));
  panel.append(controls);
  const chartHost = node('div', 'kx-chart-host');
  panel.append(chartHost);
  root.append(panel);

  const prepared = savedChartData(state.payload, chart, state.savedMaxChartPoints);
  if (!prepared || prepared.data.length < 2) {
    chartHost.append(node('div', 'kx-notice', 'Chart unavailable: selected columns contain no finite saved points.'));
    return;
  }
  const colors = chartColors();
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
  createPlot(state, chartHost, {
    width: Math.max(320, Math.floor(chartHost.getBoundingClientRect().width || 720)),
    height: 260,
    series,
    scales: { x: { time: prepared.temporal }, y: { auto: true } },
    cursor: { drag: { setScale: true, x: true, y: false, dist: 5 } },
    legend: { show: true },
  }, prepared.data);
  status.textContent = 'This chart uses only rows stored in the bounded notebook snapshot.';
}

function createPlot(
  state: OutputState,
  host: HTMLElement,
  options: uPlot.Options,
  data: uPlot.AlignedData
): void {
  try {
    state.plot = new uPlot(options, data, host);
    state.resizeObserver = new ResizeObserver(entries => {
      const width = Math.floor(entries[0]?.contentRect.width || 0);
      if (state.plot && width >= 320) {
        state.plot.setSize({ width, height: options.height || 260 });
      }
    });
    state.resizeObserver.observe(host);
  } catch {
    destroyPlot(state);
    host.replaceChildren(node('div', 'kx-notice', 'Chart rendering failed; the result table remains available.'));
  }
}

function resultSettingsControl(
  context: RendererContext<RendererState>
): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'kx-settings';
  const summary = document.createElement('summary');
  summary.textContent = 'Result settings';
  details.append(summary);
  const panel = node('div', 'kx-settings-panel');
  panel.append(
    settingSelect(context, 'Density', 'density', ['compact', 'standard', 'comfortable'], resultSettings.density),
    settingNumber(context, 'Cell width', 'cellWidth', resultSettings.cellWidth, 80, 600),
    settingNumber(context, 'Row height', 'rowHeight', resultSettings.rowHeight, 20, 80),
    settingNumber(context, 'Font size', 'fontSize', resultSettings.fontSize, 0, 32),
    settingCheckbox(context, 'Show row numbers', 'showRowIndex', resultSettings.showRowIndex),
    settingSelect(
      context,
      'Array display',
      'arrayDisplayFormat',
      ['commaSpace', 'space', 'raw'],
      resultSettings.arrayDisplayFormat
    ),
    settingCheckbox(
      context,
      'Highlight qText',
      'qTextSyntaxHighlighting',
      resultSettings.qTextSyntaxHighlighting
    ),
    settingCheckbox(
      context,
      'Format supported qText',
      'qTextDisplayFormatting',
      resultSettings.qTextDisplayFormatting
    ),
    settingSelect(
      context,
      'Functions',
      'functionDisplayStrategy',
      ['grid', 'qText'],
      resultSettings.functionDisplayStrategy
    ),
    settingSelect(
      context,
      'Dictionaries',
      'dictionaryDisplayStrategy',
      ['grid', 'qText'],
      resultSettings.dictionaryDisplayStrategy
    ),
    settingSelect(
      context,
      'Lists',
      'listDisplayStrategy',
      ['grid', 'qText'],
      resultSettings.listDisplayStrategy
    ),
    settingSelect(
      context,
      'Objects',
      'objectDisplayStrategy',
      ['grid', 'qText'],
      resultSettings.objectDisplayStrategy
    ),
    settingNumber(
      context,
      'Chart decimals',
      'chartDecimalPlaces',
      resultSettings.chartDecimalPlaces,
      0,
      12
    )
  );
  details.append(panel);
  return details;
}

function settingCheckbox(
  context: RendererContext<RendererState>,
  label: string,
  key: NotebookResultSettingKey,
  checked: boolean
): HTMLLabelElement {
  const wrapper = node('label', 'kx-setting-checkbox');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => updateResultSetting(context, key, input.checked));
  wrapper.append(input, document.createTextNode(label));
  return wrapper;
}

function settingSelect(
  context: RendererContext<RendererState>,
  label: string,
  key: NotebookResultSettingKey,
  values: string[],
  selected: string
): HTMLLabelElement {
  return labelledSelect(label, values, selected, value => updateResultSetting(context, key, value));
}

function settingNumber(
  context: RendererContext<RendererState>,
  label: string,
  key: NotebookResultSettingKey,
  value: number,
  minimum: number,
  maximum: number
): HTMLLabelElement {
  const wrapper = node('label', 'kx-control');
  wrapper.append(node('span', '', label));
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(minimum);
  input.max = String(maximum);
  input.step = '1';
  input.value = String(value);
  input.addEventListener('change', () => {
    const next = Number(input.value);
    if (Number.isSafeInteger(next) && next >= minimum && next <= maximum) {
      updateResultSetting(context, key, next);
    }
  });
  wrapper.append(input);
  return wrapper;
}

function updateResultSetting(
  context: RendererContext<RendererState>,
  key: NotebookResultSettingKey,
  value: string | number | boolean
): void {
  if (!context.postMessage) {
    return;
  }
  context.postMessage({ type: 'updateResultSetting', key, value });
}

function requestLiveResult(
  context: RendererContext<RendererState>,
  state: OutputState
): void {
  if (!context.postMessage || !state.liveId) {
    return;
  }
  const requestId = nextRequestId();
  state.liveRequestId = requestId;
  state.liveStatus = 'requesting';
  context.postMessage({ type: 'requestLiveResult', liveId: state.liveId, requestId });
}

function portablePayload(outputItem: OutputItem, element: HTMLElement): PortableKxResult | undefined {
  if (outputItem.mime !== KX_NOTEBOOK_MIME ||
    outputItem.data().byteLength > MAX_NOTEBOOK_BYTE_LIMIT) {
    renderError(element, 'KX notebook output is unsupported or exceeds the renderer safety limit.');
    return undefined;
  }
  let raw: unknown;
  try {
    raw = outputItem.json();
  } catch {
    renderError(element, 'KX notebook output is not valid JSON. Use the static fallback for this cell.');
    return undefined;
  }
  const validation = validatePortableKxResult(raw);
  if (!validation.ok) {
    renderError(element, `${validation.error} Use the static fallback for this cell.`);
    return undefined;
  }
  return validation.value;
}

function liveResultReference(outputItem: OutputItem): { version: 1; id: string } | undefined {
  if (!isRecord(outputItem.metadata)) {
    return undefined;
  }
  return parseNotebookLiveResultReference(outputItem.metadata[NOTEBOOK_LIVE_RESULT_METADATA_KEY]);
}

function renderSource(state: OutputState, root: HTMLElement): void {
  if (!state.payload.provenance.qSource) {
    return;
  }
  const details = document.createElement('details');
  details.className = 'kx-source';
  const summary = document.createElement('summary');
  summary.textContent = 'q source';
  const pre = document.createElement('pre');
  pre.textContent = state.payload.provenance.qSource;
  details.append(summary, pre);
  root.append(details);
}

function usePanelOnlyPresentation(state: OutputState): boolean {
  return presentation === 'panel' && state.payload.provenance.marker !== 'direct-ipc';
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
  status.textContent =
    'Opening the saved bounded preview. Rows omitted from the notebook cannot be recovered.';
}

function savedChartData(
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
      data: [built.x, ...built.series.map(series => series.values)],
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

function ensureSavedChartSpec(state: OutputState): void {
  if (state.savedChart) {
    return;
  }
  const candidates = chartColumns(state.payload);
  const xColumn = candidates.x.find(name => candidates.numeric.some(candidate => candidate !== name));
  const yColumn = candidates.numeric.find(name => name !== xColumn);
  if (!xColumn || !yColumn) {
    return;
  }
  state.savedChart = {
    version: 1,
    visible: true,
    type: 'line',
    xColumn,
    yColumns: [yColumn],
  };
}

function chartForColumns(columns: string[]): LiveChartState {
  return {
    visible: false,
    chartType: 'line',
    xColumn: columns[0] || '',
    yColumns: columns.length > 1 ? [columns[1]] : [],
    maxPoints: LIVE_DEFAULT_CHART_POINTS,
    requestId: 0,
    pending: false,
  };
}

function emptyLiveChart(): LiveChartState {
  return chartForColumns([]);
}

function emptyLiveSearch(): LiveSearchState {
  return {
    query: '',
    requestId: 0,
    pending: false,
    matches: [],
    activeIndex: -1,
    capped: false,
    partial: false,
  };
}

function liveSearchStatus(state: OutputState): string {
  const search = state.liveSearch;
  if (!search.query) {
    return '';
  }
  if (search.pending) {
    return 'Searching full result…';
  }
  if (search.error) {
    return search.error;
  }
  if (search.matches.length === 0) {
    return search.partial ? 'No matches in bounded scan' : 'No matches';
  }
  return `${search.activeIndex + 1}/${search.matches.length}` +
    `${search.capped ? '+' : ''}${search.partial ? ' partial' : ''}`;
}

function liveSortFields(state: OutputState): {
  sortColumn?: string;
  sortDirection?: NotebookLiveSortDirection;
} {
  return state.liveSortColumn && state.liveSortDirection
    ? { sortColumn: state.liveSortColumn, sortDirection: state.liveSortDirection }
    : {};
}

function liveSliceCell(
  slice: LiveSliceState | undefined,
  rowIndex: number,
  columnIndex: number
): string | undefined {
  if (!slice || rowIndex < slice.startRow || rowIndex > slice.endRow ||
    columnIndex < slice.startColumn || columnIndex > slice.endColumn) {
    return undefined;
  }
  return slice.cells[rowIndex - slice.startRow]?.[columnIndex - slice.startColumn];
}

function sliceContainsWindow(slice: LiveSliceState | undefined, window: LiveWindow): boolean {
  return !!slice &&
    slice.startRow <= window.startRow &&
    slice.endRow >= window.endRow &&
    slice.startColumn <= window.startColumn &&
    slice.endColumn >= window.endColumn;
}

function liveCellSelected(
  selection: LiveSelection | undefined,
  row: number,
  column: number
): boolean {
  if (!selection) {
    return false;
  }
  const startRow = Math.min(selection.anchorRow, selection.focusRow);
  const endRow = Math.max(selection.anchorRow, selection.focusRow);
  const startColumn = Math.min(selection.anchorColumn, selection.focusColumn);
  const endColumn = Math.max(selection.anchorColumn, selection.focusColumn);
  return row >= startRow && row <= endRow && column >= startColumn && column <= endColumn;
}

function selectionWithinLiveSlice(state: OutputState): boolean {
  const selection = state.liveSelection;
  const slice = state.liveSlice;
  if (!selection || !slice) {
    return false;
  }
  const startRow = Math.min(selection.anchorRow, selection.focusRow);
  const endRow = Math.max(selection.anchorRow, selection.focusRow);
  const startColumn = Math.min(selection.anchorColumn, selection.focusColumn);
  const endColumn = Math.max(selection.anchorColumn, selection.focusColumn);
  return startRow >= slice.startRow && endRow <= slice.endRow &&
    startColumn >= slice.startColumn && endColumn <= slice.endColumn &&
    (endRow - startRow + 1) * (endColumn - startColumn + 1) <= LIVE_CLIPBOARD_CELL_LIMIT;
}

async function copyLiveSelection(state: OutputState): Promise<void> {
  if (!selectionWithinLiveSlice(state) || !state.liveSelection || !state.liveSlice) {
    return;
  }
  const selection = state.liveSelection;
  const startRow = Math.min(selection.anchorRow, selection.focusRow);
  const endRow = Math.max(selection.anchorRow, selection.focusRow);
  const startColumn = Math.min(selection.anchorColumn, selection.focusColumn);
  const endColumn = Math.max(selection.anchorColumn, selection.focusColumn);
  const lines: string[] = [];
  for (let row = startRow; row <= endRow; row++) {
    const cells: string[] = [];
    for (let column = startColumn; column <= endColumn; column++) {
      cells.push(liveSliceCell(state.liveSlice, row, column) || '');
    }
    lines.push(cells.join('\t'));
  }
  await copyText(lines.join('\n'));
}

function activeSearchRow(state: OutputState, row: number): boolean {
  const search = state.liveSearch;
  return search.activeIndex >= 0 && search.matches[search.activeIndex] === row;
}

function scheduleLiveViewportRender(
  context: RendererContext<RendererState>,
  state: OutputState
): void {
  if (state.renderTimer !== undefined) {
    window.cancelAnimationFrame(state.renderTimer);
  }
  state.renderTimer = window.requestAnimationFrame(() => {
    state.renderTimer = undefined;
    renderState(context, state);
  });
}

function portableTable(payload: PortableKxResult): ColumnarPanelResult {
  return createColumnarPanelResult(
    payload.schema.columns.map(column => column.name),
    payload.data.rows.length,
    (rowIndex, columnIndex) => portableCellText(payload.data.rows[rowIndex][columnIndex])
  );
}

function nextRequestId(): number {
  requestSequence = requestSequence >= MAX_NOTEBOOK_LIVE_REQUEST_ID ? 1 : requestSequence + 1;
  return requestSequence;
}

function chartColors(): string[] {
  return ['#4da3ff', '#f07178', '#7bd88f', '#c792ea', '#ffcb6b', '#89ddff', '#ff9cac', '#82aaff'];
}

function statusNode(root: HTMLElement): HTMLElement {
  const status = node('div', 'kx-status');
  root.append(status);
  return status;
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
  if (state.renderTimer !== undefined) {
    window.cancelAnimationFrame(state.renderTimer);
  }
  if (state.searchTimer !== undefined) {
    window.clearTimeout(state.searchTimer);
  }
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

async function copyText(value: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error('Clipboard unavailable');
  }
  await navigator.clipboard.writeText(value);
}

function formatElapsed(value: number): string {
  if (resultSettings.elapsedTimeDisplay === 'milliseconds') {
    return `${Math.round(value)} ms`;
  }
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
}

function qTextTokenClass(kind: string): string {
  return `kx-q-${kind.replace(/[^a-z]/gi, '')}`;
}

function isPresentation(value: unknown): value is NotebookPresentation {
  return value === 'inline' || value === 'panel' || value === 'both';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defaultResultSettings(): NotebookSharedKxResultSettings {
  return {
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
}

const rendererCss = `
.kx-root{box-sizing:border-box;border:1px solid var(--vscode-notebook-cellBorderColor,var(--vscode-panel-border,#555));border-radius:5px;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-family:var(--vscode-font-family,system-ui,sans-serif);font-size:var(--vscode-font-size,13px);padding:8px;max-width:100%}
.kx-header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px}.kx-heading-wrap{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.kx-heading{font-size:1.05em}.kx-meta{color:var(--vscode-descriptionForeground);font-size:.92em}
.kx-badge{border:1px solid var(--vscode-panel-border,#777);border-radius:999px;padding:1px 7px;font-size:.82em}.kx-badge-live{border-color:var(--vscode-testing-iconPassed,#3a3);color:var(--vscode-testing-iconPassed,#3a3)}.kx-badge-saved{color:var(--vscode-descriptionForeground)}
.kx-toolbar,.kx-live-tools,.kx-chart-controls,.kx-pagination{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.kx-chart-controls{align-items:flex-end}.kx-root button,.kx-root select,.kx-root input{font:inherit;color:var(--vscode-button-secondaryForeground,var(--vscode-foreground));background:var(--vscode-button-secondaryBackground,var(--vscode-editorWidget-background));border:1px solid var(--vscode-button-border,var(--vscode-panel-border,#777));border-radius:3px;padding:3px 7px}.kx-root button:hover:not(:disabled){background:var(--vscode-button-secondaryHoverBackground)}.kx-root button:disabled{opacity:.55}.kx-live-tools input[type=search]{min-width:220px}
.kx-notice,.kx-panel-mode,.kx-error,.kx-live-pending,.kx-live-notice{margin:7px 0;padding:6px 8px;border-left:3px solid var(--vscode-notificationsWarningIcon-foreground,#cca700);background:var(--vscode-textBlockQuote-background)}.kx-error{border-left-color:var(--vscode-errorForeground,#f14c4c)}.kx-live-notice{border-left-color:var(--vscode-testing-iconPassed,#3a3)}
.kx-messages{margin:5px 0;color:var(--vscode-descriptionForeground)}.kx-source{margin:6px 0}.kx-source pre{white-space:pre-wrap;max-height:150px;overflow:auto;background:var(--vscode-textCodeBlock-background);padding:6px}
.kx-qtext{white-space:pre-wrap;max-height:520px;overflow:auto;background:var(--vscode-textCodeBlock-background);padding:8px;border:1px solid var(--vscode-panel-border,#555)}.kx-q-comment{color:var(--vscode-editorCodeLens-foreground)}.kx-q-string,.kx-q-symbol{color:var(--vscode-debugTokenExpression-string)}.kx-q-number,.kx-q-temporal{color:var(--vscode-debugTokenExpression-number)}.kx-q-keyword,.kx-q-command{color:var(--vscode-debugTokenExpression-name);font-weight:600}.kx-q-builtin,.kx-q-system,.kx-q-namespace{color:var(--vscode-symbolIcon-functionForeground)}.kx-q-operator{color:var(--vscode-symbolIcon-operatorForeground)}
.kx-live-viewport{position:relative;overflow:auto;border:1px solid var(--vscode-panel-border,#555);margin:6px 0;contain:strict}.kx-live-canvas{position:relative;min-width:100%}.kx-live-cell{box-sizing:border-box;position:absolute;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:4px 7px;border-right:1px solid var(--vscode-panel-border,#555);border-bottom:1px solid var(--vscode-panel-border,#555);background:var(--vscode-editor-background);color:var(--vscode-editor-foreground)}button.kx-live-cell{text-align:left;border-radius:0}.kx-live-header{z-index:3;font-weight:600;background:var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-editor-background))}.kx-live-row-index,.kx-live-corner{z-index:2;text-align:right;color:var(--vscode-descriptionForeground);background:var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-editor-background))}.kx-live-cell.is-loading{color:transparent;background:linear-gradient(90deg,var(--vscode-editor-background),var(--vscode-editorWidget-background),var(--vscode-editor-background))}.kx-live-cell.is-selected{outline:2px solid var(--vscode-focusBorder,#007fd4);outline-offset:-2px}.kx-live-cell.is-search-match{background:var(--vscode-editor-findMatchHighlightBackground,#ea5c0055)}
.kx-table-wrap{max-height:420px;overflow:auto;border:1px solid var(--vscode-panel-border,#555);margin:6px 0}.kx-table-wrap table{border-collapse:separate;border-spacing:0;min-width:100%;width:max-content}.kx-table-wrap th,.kx-table-wrap td{border-right:1px solid var(--vscode-panel-border,#555);border-bottom:1px solid var(--vscode-panel-border,#555);padding:3px 7px;max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}.kx-table-wrap th{position:sticky;top:0;z-index:1;background:var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-editor-background))}.kx-column-type{display:block;color:var(--vscode-descriptionForeground);font-size:.78em;font-weight:normal}
.kx-control{display:flex;flex-direction:column;gap:2px;color:var(--vscode-descriptionForeground);font-size:.9em}.kx-control select,.kx-control input{color:var(--vscode-foreground);min-width:90px}.kx-chart-panel{border-top:1px solid var(--vscode-panel-border,#555);padding-top:7px;margin-top:7px}.kx-chart-host{width:100%;min-height:260px;margin-top:6px;overflow:hidden}.kx-chart-host .uplot{font-family:var(--vscode-font-family,system-ui,sans-serif)}.kx-status{min-height:1.2em;margin-top:5px;color:var(--vscode-descriptionForeground);font-size:.9em}.kx-empty{padding:12px;color:var(--vscode-descriptionForeground)}
.kx-settings{position:relative}.kx-settings>summary{cursor:pointer;border:1px solid var(--vscode-panel-border,#777);border-radius:3px;padding:3px 7px;list-style:none}.kx-settings-panel{position:absolute;right:0;z-index:20;display:grid;grid-template-columns:repeat(2,minmax(130px,1fr));gap:7px;width:min(430px,80vw);padding:9px;border:1px solid var(--vscode-panel-border,#555);background:var(--vscode-editorWidget-background);box-shadow:0 4px 18px #0006}.kx-setting-checkbox{display:flex;align-items:center;gap:5px;font-size:.9em}
`;
