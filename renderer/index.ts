import uPlot from 'uplot';
import uPlotCss from 'uplot/dist/uPlot.min.css';
import type { ActivationFunction, OutputItem, RendererContext } from 'vscode-notebook-renderer';
import {
  CHART_ZOOM_MAX_SAMPLED_POINTS,
  ChartType,
  buildChartData,
  chartColumnOptions,
  chartTypeCapabilities,
} from '../src/charting';
import {
  chartLegendToggleKey,
  chartSeriesVisible,
  updateHiddenChartSeriesKeys,
} from '../src/chart-series-state';
import {
  ColumnarPanelResult,
  createColumnarPanelResult,
} from '../src/kx-results';
import {
  KX_NOTEBOOK_MIME,
  MAX_NOTEBOOK_BYTE_LIMIT,
  NotebookChartSpec,
  NotebookChartType,
  PortableKxResult,
  PortableKxTableResult,
  portableCellValue,
  portableCellText,
  validatePortableKxResult,
} from '../src/notebook-contract';
import {
  NotebookCellSelection,
  NotebookSavedSearchMatch,
  notebookCellSelected,
  notebookDelimitedRangeText,
  notebookGridDefaultHeight,
  notebookGridResizedHeight,
  notebookGridWindow,
  notebookChartControlModel,
  notebookMoveSelection,
  notebookMovedSearchMatchIndex,
  reconcileNotebookChartConfiguration,
  notebookSavedSearchMatches,
  notebookSelectionCellCount,
  notebookSelectionForCell,
  notebookSelectionRange,
  notebookSearchEnterAction,
  notebookSelectionToolsState,
  reconcileNotebookChartYColumns,
  toggleNotebookChartYColumn,
} from '../src/notebook-renderer-model';
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

interface SavedSearchState {
  query: string;
  matches: NotebookSavedSearchMatch[];
  activeIndex: number;
  capped: boolean;
}

interface LiveChartState {
  visible: boolean;
  chartType: NotebookLiveChartType;
  xColumn: string;
  yColumns: string[];
  groupByColumn: string;
  openColumn: string;
  highColumn: string;
  lowColumn: string;
  closeColumn: string;
  maxPoints: number;
  requestId: number;
  requestSignature?: string;
  pending: boolean;
  dirty: boolean;
  data?: NotebookLiveChartData;
  error?: string;
}

interface OutputState {
  id: string;
  domIdPrefix: string;
  element: HTMLElement;
  payload: PortableKxResult;
  savedChart: NotebookChartSpec | undefined;
  savedRenderedChart: NotebookChartSpec | undefined;
  savedChartVisible: boolean;
  savedTableVisible: boolean;
  savedTablePageStart: number;
  savedMaxChartPoints: number;
  savedChartYOpen: boolean;
  plot?: uPlot;
  plotResizeObserver?: ResizeObserver;
  panelOpened: boolean;
  liveId?: string;
  liveStatus: LiveStatus;
  liveRequestId: number;
  liveMode?: 'table' | 'text';
  liveKind?: string;
  liveColumns: string[];
  liveRowCount: number;
  liveChartXColumns: string[];
  liveChartYColumns: string[];
  liveChartGroupColumns: string[];
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
  liveSelection?: NotebookCellSelection;
  liveSearch: LiveSearchState;
  liveChart: LiveChartState;
  liveChartYOpen: boolean;
  liveViewport?: HTMLElement;
  liveCanvas?: HTMLElement;
  liveViewportHeight?: number;
  liveViewportResizeObserver?: ResizeObserver;
  liveCopyRequestId: number;
  liveCopyMessage?: string;
  liveCopyButtons?: HTMLButtonElement[];
  liveCopyTools?: HTMLDetailsElement;
  liveCopyStatus?: HTMLElement;
  savedSelection?: NotebookCellSelection;
  savedSearch: SavedSearchState;
  savedCopyTools?: HTMLDetailsElement;
  savedSortColumn?: number;
  savedSortDirection?: NotebookLiveSortDirection;
  savedScrollTop: number;
  savedScrollLeft: number;
  savedViewportHeight?: number;
  savedViewport?: HTMLElement;
  renderTimer?: number;
  searchTimer?: number;
  plotSeriesKeys: string[];
  hiddenChartSeriesKeys: string[];
}

interface RendererState {
  presentation?: NotebookPresentation;
}

const TABLE_PAGE_SIZE = 250;
const MAX_TABLE_PAGE_CELLS = 5000;
const LIVE_HEADER_HEIGHT = 30;
const SAVED_HEADER_HEIGHT = 44;
const LIVE_ROW_INDEX_WIDTH = 64;
const LIVE_ROW_OVERSCAN = 8;
const LIVE_COLUMN_OVERSCAN = 2;
const LIVE_MAX_RENDER_ROWS = 120;
const LIVE_MAX_RENDER_COLUMNS = 48;
const LIVE_MAX_CANVAS_HEIGHT = 8_000_000;
const LIVE_CLIPBOARD_CELL_LIMIT = 20_000;
const SAVED_SEARCH_MAX_MATCHES = 10_000;
const states = new Map<string, OutputState>();
let presentation: NotebookPresentation = 'inline';
let requestSequence = 0;
let domSequence = 0;
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
        domIdPrefix: `kx-grid-${++domSequence}`,
        element,
        payload,
        savedChart: payload.kind === 'table' && payload.chart
          ? {
            ...defaultNotebookOhlcColumns(payload.schema.columns.map(column => column.name)),
            ...payload.chart,
            yColumns: payload.chart.yColumns.slice(),
          }
          : undefined,
        savedRenderedChart: payload.kind === 'table' && payload.chart
          ? {
            ...defaultNotebookOhlcColumns(payload.schema.columns.map(column => column.name)),
            ...payload.chart,
            yColumns: payload.chart.yColumns.slice(),
          }
          : undefined,
        savedChartVisible: payload.kind === 'table' && payload.chart?.visible === true,
        savedTableVisible: true,
        savedTablePageStart: 0,
        savedMaxChartPoints: notebookChartPointLimit(),
        savedChartYOpen: false,
        panelOpened: false,
        liveId: liveReference?.id,
        liveStatus: liveReference ? 'requesting' : 'none',
        liveRequestId: 0,
        liveColumns: [],
        liveRowCount: 0,
        liveChartXColumns: [],
        liveChartYColumns: [],
        liveChartGroupColumns: [],
        liveSliceRequestId: 0,
        liveScrollTop: 0,
        liveScrollLeft: 0,
        liveCopyRequestId: 0,
        savedScrollTop: 0,
        savedScrollLeft: 0,
        savedSearch: emptySavedSearch(),
        liveSearch: emptyLiveSearch(),
        liveChart: emptyLiveChart(),
        liveChartYOpen: false,
        plotSeriesKeys: [],
        hiddenChartSeriesKeys: [],
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
    const chartPointLimitChanged =
      previous.chartZoomMaxSampledPoints !== resultSettings.chartZoomMaxSampledPoints;
    states.forEach(state => {
      if (chartPointLimitChanged) {
        const maxPoints = notebookChartPointLimit();
        state.savedMaxChartPoints = maxPoints;
        if (state.liveChart.maxPoints !== maxPoints) {
          state.liveChart.maxPoints = maxPoints;
          markLiveChartDirty(state.liveChart);
        }
      }
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
      if (message.error) {
        renderState(context, state);
      } else {
        refreshLiveViewport(context, state);
      }
      if (retryWithoutSort) {
        requestLiveSlice(
          context,
          state,
          liveWindow(state, state.liveViewport?.clientWidth || 720)
        );
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
      if (message.data) {
        state.liveChart.data = message.data;
        state.liveChart.dirty =
          state.liveChart.requestSignature !== liveChartConfigurationSignature(state.liveChart);
      }
      state.liveChart.error = message.error;
      renderState(context, state);
    } else if (message.type === 'liveCopy') {
      if (message.requestId !== state.liveCopyRequestId) {
        continue;
      }
      state.liveCopyMessage = message.ok ? 'Copied.' : (message.message || 'Copy failed.');
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
  const previousChart = state.liveChart;
  if (!message.available) {
    state.liveStatus = 'unavailable';
    state.liveMode = undefined;
    state.liveColumns = [];
    state.liveRowCount = 0;
    state.liveChartXColumns = [];
    state.liveChartYColumns = [];
    state.liveChartGroupColumns = [];
    state.liveText = undefined;
    state.liveMetadata = undefined;
    state.liveSlice = undefined;
    state.liveSliceError = undefined;
    state.liveMessage = message.message || 'Result unavailable.';
    renderState(context, state);
    return;
  }
  state.liveStatus = 'available';
  state.liveMode = message.mode;
  state.liveKind = message.kind;
  state.liveColumns = message.columns || [];
  state.liveRowCount = message.rowCount || 0;
  state.liveChartXColumns = message.chartXColumns || [];
  state.liveChartYColumns = message.chartYColumns || [];
  state.liveChartGroupColumns = message.chartGroupColumns || [];
  state.liveText = message.text;
  state.liveMetadata = message.metadata;
  state.liveMessage = message.message;
  state.liveSlice = undefined;
  state.liveSliceError = undefined;
  state.liveSortColumn = undefined;
  state.liveSortDirection = undefined;
  state.liveSelection = undefined;
  state.liveSearch = emptyLiveSearch();
  const reconciledChart = reconcileNotebookChartConfiguration(
    previousChart,
    state.liveChartXColumns,
    state.liveChartYColumns,
    state.liveChartGroupColumns
  );
  state.liveChart = {
    ...previousChart,
    ...reconciledChart.configuration,
    maxPoints: notebookChartPointLimit(),
    requestId: nextRequestId(),
    requestSignature: undefined,
    pending: false,
    dirty: true,
    ...(reconciledChart.compatible && previousChart.data
      ? { data: previousChart.data }
      : { data: undefined }),
    error: undefined,
  };
  renderState(context, state);
}

function renderState(context: RendererContext<RendererState>, state: OutputState): void {
  captureViewportState(state);
  destroyPlot(state);
  state.liveViewportResizeObserver?.disconnect();
  state.liveViewportResizeObserver = undefined;
  state.liveViewport = undefined;
  state.liveCanvas = undefined;
  state.savedViewport = undefined;
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
  headingWrap.append(node('strong', 'kx-heading', 'KX Results'));
  const label = state.liveMetadata?.connectionName || state.payload.provenance.label;
  if (label) {
    headingWrap.append(node('span', 'kx-meta', label));
  }
  const elapsed = state.liveMetadata?.elapsedMs ?? state.payload.provenance.elapsedMs;
  if (elapsed !== undefined) {
    headingWrap.append(node('span', 'kx-meta', formatElapsed(elapsed)));
  }
  header.append(headingWrap);

  const toolbar = node('div', 'kx-toolbar');
  if (state.liveStatus === 'available' && state.liveId && context.postMessage) {
    toolbar.append(titledButton('↗ KX Results', 'Open in KX Results', () => {
      context.postMessage?.({ type: 'openLiveResult', liveId: state.liveId });
    }));
  } else if (context.postMessage) {
    toolbar.append(titledButton('↗ KX Results', 'Open in KX Results', () => {
      openPreview(context, state, statusNode(root));
    }));
  }
  toolbar.append(resultSettingsControl(context));
  header.append(toolbar);
  root.append(header);
}

function renderPanelOnly(
  context: RendererContext<RendererState>,
  state: OutputState,
  root: HTMLElement
): void {
  const status = node('div', 'kx-status');
  root.append(status);
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
  const status = node('span', 'kx-meta');
  const toolbar = node('div', 'kx-toolbar kx-saved-toolbar');
  toolbar.append(button('Copy', () => {
    void copyText(state.liveText || '').then(
      () => { status.textContent = 'Copied.'; },
      () => { status.textContent = 'Clipboard unavailable.'; }
    );
  }), status);
  root.append(toolbar);
  renderPortableText(state.liveText || '', `${state.liveKind || 'qText'} result`, root);
}

function renderPortableText(raw: string, ariaLabel: string, root: HTMLElement): void {
  const model = qTextRenderModel(raw, {
    syntaxHighlighting: resultSettings.qTextSyntaxHighlighting,
    displayFormatting: resultSettings.qTextDisplayFormatting,
  });
  const pre = node('pre', 'kx-qtext');
  pre.setAttribute('aria-label', ariaLabel);
  if (!resultSettings.qTextSyntaxHighlighting || !model.highlighted) {
    pre.textContent = resultSettings.qTextDisplayFormatting ? model.text : raw;
  } else {
    model.segments.forEach(segment => {
      const span = node('span', qTextTokenClass(segment.kind), segment.text);
      pre.append(span);
    });
  }
  root.append(pre);
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
  input.placeholder = 'Search rows';
  input.setAttribute('aria-label', 'Search result rows');
  const searchStatus = node('span', 'kx-meta', liveSearchStatus(state));
  searchStatus.id = `${state.domIdPrefix}-search-status`;
  searchStatus.setAttribute('role', 'status');
  searchStatus.setAttribute('aria-live', 'polite');
  input.setAttribute('aria-describedby', searchStatus.id);
  input.value = state.liveSearch.query;
  input.addEventListener('input', () => {
    state.liveSearch = {
      ...emptyLiveSearch(),
      query: input.value.slice(0, MAX_NOTEBOOK_LIVE_SEARCH_CHARS),
    };
    scheduleLiveSearch(context, state);
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const action = notebookSearchEnterAction(
        state.liveSearch.matches.length,
        state.liveSearch.pending,
        event.shiftKey
      );
      if (action === 'request') {
        requestLiveSearch(context, state);
      } else {
        moveLiveSearchMatch(context, state, action === 'previous' ? -1 : 1);
      }
    } else if (event.key === 'Escape' && input.value) {
      input.value = '';
      state.liveSearch = emptyLiveSearch();
      requestLiveSearch(context, state);
    }
  });
  input.title = 'Enter: next match; Shift+Enter: previous match';
  tools.append(input, searchStatus);
  const copyTools = document.createElement('details');
  copyTools.className = 'kx-tools';
  const copyToolsState = notebookSelectionToolsState(
    state.liveSelection,
    LIVE_CLIPBOARD_CELL_LIMIT,
    false
  );
  copyTools.hidden = !copyToolsState.visible;
  copyTools.open = copyToolsState.open;
  const copySummary = document.createElement('summary');
  copySummary.textContent = 'Tools';
  copySummary.setAttribute('aria-label', 'Selected cells tools');
  const copyPanel = node('div', 'kx-tools-panel');
  const format = labelledSelect('Format', ['tsv', 'csv'], 'tsv', () => {});
  const formatSelect = format.querySelector('select')!;
  const copy = button('Copy', () => {
    requestLiveCopy(context, state, formatSelect.value === 'csv' ? 'csv' : 'tsv');
  });
  copy.disabled = !copyToolsState.copyEnabled;
  copyPanel.append(format, copy);
  copyTools.append(copySummary, copyPanel);
  state.liveCopyButtons = [copy];
  state.liveCopyTools = copyTools;
  tools.append(copyTools);
  if (state.liveChartXColumns.length > 0 && state.liveChartYColumns.length > 0) {
    tools.append(button(state.liveChart.visible ? 'Close chart' : 'Chart', () => {
      state.liveChart.visible = !state.liveChart.visible;
      renderState(context, state);
    }));
  }
  const copyStatus = node('span', 'kx-meta', state.liveCopyMessage || '');
  copyStatus.hidden = !state.liveCopyMessage;
  copyStatus.setAttribute('aria-live', 'polite');
  state.liveCopyStatus = copyStatus;
  tools.append(copyStatus);
  root.append(tools);
}

function renderLiveGrid(
  context: RendererContext<RendererState>,
  state: OutputState,
  root: HTMLElement
): void {
  if (state.liveColumns.length === 0) {
    root.append(node('div', 'kx-empty', '0 rows'));
    return;
  }
  const viewport = node('div', 'kx-live-viewport');
  viewport.tabIndex = 0;
  viewport.setAttribute('role', 'grid');
  viewport.setAttribute('aria-rowcount', String(state.liveRowCount + 1));
  viewport.setAttribute('aria-colcount', String(state.liveColumns.length));
  viewport.setAttribute('aria-label', 'KX result table');
  viewport.style.height = `${state.liveViewportHeight ?? notebookGridDefaultHeight(
    state.liveRowCount,
    resultSettings.rowHeight,
    LIVE_HEADER_HEIGHT
  )}px`;
  const cellWidth = resultSettings.cellWidth;
  const rowIndexWidth = resultSettings.showRowIndex ? LIVE_ROW_INDEX_WIDTH : 0;
  const canvas = node('div', 'kx-live-canvas');
  canvas.style.width = `${rowIndexWidth + state.liveColumns.length * cellWidth}px`;
  canvas.style.height = `${liveCanvasHeight(state)}px`;
  viewport.append(canvas);
  root.append(viewport);
  state.liveViewport = viewport;
  state.liveCanvas = canvas;

  viewport.scrollTop = state.liveScrollTop;
  viewport.scrollLeft = state.liveScrollLeft;
  refreshLiveViewport(context, state);
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
    updateLiveSelectionClasses(state);
  });
  viewport.addEventListener('keydown', event => handleLiveGridKeydown(context, state, event));
  state.liveViewportResizeObserver = new ResizeObserver(() => {
    const height = Math.round(viewport.offsetHeight || 0);
    if (height >= 1) {
      const next = notebookGridResizedHeight(height);
      if (state.liveViewportHeight !== next) {
        state.liveViewportHeight = next;
        scheduleLiveViewportRender(context, state);
      }
    }
  });
  state.liveViewportResizeObserver.observe(viewport);
}

interface LiveWindow {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

function liveWindow(
  state: OutputState,
  viewportWidth: number,
  viewportHeight = liveViewportHeight(state)
): LiveWindow {
  const rowIndexWidth = resultSettings.showRowIndex ? LIVE_ROW_INDEX_WIDTH : 0;
  return notebookGridWindow({
    rowCount: state.liveRowCount,
    columnCount: state.liveColumns.length,
    scrollTop: liveVirtualScrollTop(state),
    scrollLeft: state.liveScrollLeft,
    viewportWidth,
    viewportHeight,
    rowHeight: resultSettings.rowHeight,
    cellWidth: resultSettings.cellWidth,
    rowIndexWidth,
    headerHeight: LIVE_HEADER_HEIGHT,
    rowOverscan: LIVE_ROW_OVERSCAN,
    columnOverscan: LIVE_COLUMN_OVERSCAN,
    maxRows: Math.min(LIVE_MAX_RENDER_ROWS, MAX_NOTEBOOK_LIVE_SLICE_ROWS),
    maxColumns: Math.min(LIVE_MAX_RENDER_COLUMNS, MAX_NOTEBOOK_LIVE_SLICE_COLUMNS),
    maxCells: MAX_NOTEBOOK_LIVE_SLICE_CELLS,
  });
}

function refreshLiveViewport(
  context: RendererContext<RendererState>,
  state: OutputState
): void {
  const viewport = state.liveViewport;
  const canvas = state.liveCanvas;
  if (!viewport || !canvas) {
    return;
  }
  const rowIndexWidth = resultSettings.showRowIndex ? LIVE_ROW_INDEX_WIDTH : 0;
  canvas.style.width = `${rowIndexWidth + state.liveColumns.length * resultSettings.cellWidth}px`;
  canvas.style.height = `${liveCanvasHeight(state)}px`;
  const window = liveWindow(
    state,
    viewport.clientWidth || 720,
    viewport.clientHeight || liveViewportHeight(state)
  );
  canvas.replaceChildren();
  renderLiveHeaders(context, state, canvas, window.startColumn, window.endColumn);
  renderLiveCells(state, canvas, window);
  syncLiveActiveDescendant(state);
  if (state.liveRowCount === 0) {
    const empty = node('div', 'kx-live-empty', '0 rows');
    placeLiveCell(
      empty,
      rowIndexWidth,
      LIVE_HEADER_HEIGHT,
      Math.max(resultSettings.cellWidth, viewport.clientWidth - rowIndexWidth),
      resultSettings.rowHeight
    );
    canvas.append(empty);
    return;
  }
  if (!state.liveSliceError && !sliceContainsWindow(state.liveSlice, window)) {
    requestLiveSlice(context, state, window);
  }
}

function renderLiveHeaders(
  context: RendererContext<RendererState>,
  state: OutputState,
  canvas: HTMLElement,
  startColumn: number,
  endColumn: number
): void {
  const rowIndexWidth = resultSettings.showRowIndex ? LIVE_ROW_INDEX_WIDTH : 0;
  const row = node('div', 'kx-live-row kx-live-header-row');
  row.setAttribute('role', 'row');
  row.setAttribute('aria-rowindex', '1');
  placeLiveCell(
    row,
    0,
    state.liveScrollTop,
    rowIndexWidth + state.liveColumns.length * resultSettings.cellWidth,
    LIVE_HEADER_HEIGHT
  );
  if (resultSettings.showRowIndex) {
    const corner = node('div', 'kx-live-cell kx-live-header kx-live-corner', '#');
    corner.setAttribute('aria-hidden', 'true');
    placeLiveCell(corner, state.liveScrollLeft, 0, LIVE_ROW_INDEX_WIDTH, LIVE_HEADER_HEIGHT);
    row.append(corner);
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
    header.setAttribute('role', 'columnheader');
    header.setAttribute('aria-colindex', String(columnIndex + 1));
    header.title = `Sort by ${columnName}`;
    placeLiveCell(
      header,
      rowIndexWidth + columnIndex * resultSettings.cellWidth,
      0,
      resultSettings.cellWidth,
      LIVE_HEADER_HEIGHT
    );
    row.append(header);
  }
  canvas.append(row);
}

function renderLiveCells(state: OutputState, canvas: HTMLElement, window: LiveWindow): void {
  const slice = state.liveSlice;
  const rowIndexWidth = resultSettings.showRowIndex ? LIVE_ROW_INDEX_WIDTH : 0;
  const virtualTop = liveVirtualScrollTop(state);
  for (let rowIndex = window.startRow; rowIndex <= window.endRow; rowIndex++) {
    const top = state.liveScrollTop +
      (LIVE_HEADER_HEIGHT + rowIndex * resultSettings.rowHeight - virtualTop);
    const row = node('div', 'kx-live-row');
    row.setAttribute('role', 'row');
    row.setAttribute('aria-rowindex', String(rowIndex + 2));
    placeLiveCell(
      row,
      0,
      top,
      rowIndexWidth + state.liveColumns.length * resultSettings.cellWidth,
      resultSettings.rowHeight
    );
    if (resultSettings.showRowIndex) {
      const index = node('div', 'kx-live-cell kx-live-row-index', String(rowIndex + 1));
      index.setAttribute('role', 'rowheader');
      placeLiveCell(
        index,
        state.liveScrollLeft,
        0,
        LIVE_ROW_INDEX_WIDTH,
        resultSettings.rowHeight
      );
      row.append(index);
    }
    for (let columnIndex = window.startColumn; columnIndex <= window.endColumn; columnIndex++) {
      const value = liveSliceCell(slice, rowIndex, columnIndex);
      const cell = node('div', 'kx-live-cell', value ?? '');
      cell.id = gridCellId(state, rowIndex, columnIndex);
      cell.setAttribute('role', 'gridcell');
      cell.dataset.row = String(rowIndex);
      cell.dataset.column = String(columnIndex);
      if (value === undefined) {
        cell.classList.add('is-loading');
      }
      if (notebookCellSelected(state.liveSelection, rowIndex, columnIndex)) {
        cell.classList.add('is-selected');
        cell.setAttribute('aria-selected', 'true');
      }
      cell.setAttribute('aria-colindex', String(columnIndex + 1));
      cell.setAttribute('aria-label', `${state.liveColumns[columnIndex]}, row ${rowIndex + 1}`);
      if (activeSearchRow(state, rowIndex)) {
        cell.classList.add('is-search-match');
      }
      cell.addEventListener('mousedown', event => {
        if (event.button !== 0) {
          return;
        }
        state.liveSelection = notebookSelectionForCell(
          state.liveSelection,
          rowIndex,
          columnIndex,
          event.shiftKey
        );
        state.liveCopyMessage = undefined;
        state.liveViewport?.focus({ preventScroll: true });
        updateLiveSelectionClasses(state);
        event.preventDefault();
      });
      cell.addEventListener('mouseenter', event => {
        if ((event.buttons & 1) && state.liveSelection) {
          state.liveSelection = notebookSelectionForCell(
            state.liveSelection,
            rowIndex,
            columnIndex,
            true
          );
          updateLiveSelectionClasses(state);
        }
      });
      placeLiveCell(
        cell,
        rowIndexWidth + columnIndex * resultSettings.cellWidth,
        0,
        resultSettings.cellWidth,
        resultSettings.rowHeight
      );
      row.append(cell);
    }
    canvas.append(row);
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
  const chart = state.liveChart;
  const controlModel = notebookChartControlModel(
    chart,
    state.liveChartXColumns,
    state.liveChartYColumns,
    state.liveChartGroupColumns
  );
  const capabilities = controlModel.capabilities;
  const panel = node('div', 'kx-chart-panel');
  const controls = node('div', 'kx-chart-controls');
  controls.append(labelledSelect(
    'Chart type',
    ['line', 'scatter', 'step', 'bar', 'box', 'candlestick'],
    chart.chartType,
    value => {
      chart.chartType = value as NotebookLiveChartType;
      markLiveChartDirty(chart);
      renderState(context, state);
    }
  ));
  controls.append(labelledSelect('X', state.liveChartXColumns, chart.xColumn, value => {
    chart.xColumn = value;
    chart.yColumns = reconcileNotebookChartYColumns(
      state.liveChartYColumns,
      value,
      chart.yColumns
    );
    markLiveChartDirty(chart);
    renderState(context, state);
  }));
  if (capabilities.usesGenericY) {
    controls.append(multiColumnControl(
      'Y',
      controlModel.yColumns,
      chart.yColumns,
      state.liveChartYOpen,
      (column, checked) => {
        chart.yColumns = toggleNotebookChartYColumn(
          state.liveChartYColumns,
          chart.xColumn,
          chart.yColumns,
          column,
          checked
        );
        markLiveChartDirty(chart);
        renderState(context, state);
      },
      open => { state.liveChartYOpen = open; }
    ));
  }
  if (capabilities.supportsGroupBy) {
    controls.append(labelledSelectOptions(
      'Group by',
      [
        { value: '', label: 'None' },
        ...controlModel.groupColumns.map(value => ({ value, label: value })),
      ],
      chart.groupByColumn,
      value => {
        chart.groupByColumn = value;
        markLiveChartDirty(chart);
        renderState(context, state);
      }
    ));
  }
  if (capabilities.usesOhlc) {
    const numeric = controlModel.yColumns;
    const ohlcControls: Array<[string, keyof Pick<
      LiveChartState,
      'openColumn' | 'highColumn' | 'lowColumn' | 'closeColumn'
    >]> = [
      ['Open', 'openColumn'],
      ['High', 'highColumn'],
      ['Low', 'lowColumn'],
      ['Close', 'closeColumn'],
    ];
    ohlcControls.forEach(([label, key]) => {
      controls.append(labelledSelectOptions(
        label,
        [
          { value: '', label: `Select ${label}` },
          ...numeric.map(value => ({ value, label: value })),
        ],
        chart[key],
        value => {
          chart[key] = value;
          markLiveChartDirty(chart);
          renderState(context, state);
        }
      ));
    });
  }
  const render = button('Render', () => {
    requestLiveChart(context, state);
    renderState(context, state);
  });
  render.disabled = !!liveChartValidationMessage(state);
  controls.append(render);
  const reset = button('Reset zoom', () => {
    resetPlotZoom(state);
  });
  reset.disabled = !chart.data;
  controls.append(reset);
  panel.append(controls);
  const status = node('div', 'kx-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const validation = liveChartValidationMessage(state);
  if (chart.pending) {
    status.textContent = chart.data
      ? 'Preparing updated chart; the previous chart remains visible.'
      : 'Preparing chart…';
  } else if (chart.error) {
    status.textContent = chart.error;
  } else if (validation) {
    status.textContent = validation;
  } else if (chart.dirty) {
    status.textContent = chart.data
      ? 'Chart settings changed — Render to update.'
      : 'Press Render to create chart.';
  } else if (chart.data) {
    status.textContent = liveChartDataStatus(chart.data);
  }
  if (chart.data?.warnings?.length) {
    status.textContent = `${status.textContent ? `${status.textContent} ` : ''}${chart.data.warnings.join(' ')}`;
  }
  if (status.textContent) {
    panel.append(status);
  }
  if (chart.data) {
    const host = node('div', 'kx-chart-host');
    panel.append(host);
    root.append(panel);
    drawLiveChart(state, host, chart.data);
  } else {
    root.append(panel);
  }
}

function markLiveChartDirty(chart: LiveChartState): void {
  chart.dirty = true;
  chart.error = undefined;
}

function liveChartValidationMessage(state: OutputState): string {
  return notebookChartControlModel(
    state.liveChart,
    state.liveChartXColumns,
    state.liveChartYColumns,
    state.liveChartGroupColumns
  ).validationMessage;
}

function liveChartDataStatus(data: NotebookLiveChartData): string {
  const shown = data.sampledPointCount ?? data.x.length;
  const eligible = data.eligibleRowCount;
  const algorithm = data.algorithm ? ` (${data.algorithm})` : '';
  if (data.chartType === 'candlestick') {
    return `Showing ${shown.toLocaleString()} candles${eligible === undefined
      ? ''
      : ` from ${eligible.toLocaleString()} eligible rows`}${algorithm}.`;
  }
  if (data.chartType === 'box') {
    return `Showing ${shown.toLocaleString()} box groups${eligible === undefined
      ? ''
      : ` from ${eligible.toLocaleString()} eligible rows`}${algorithm}.`;
  }
  return `Showing ${shown.toLocaleString()} sampled points${eligible === undefined
    ? ''
    : ` from ${eligible.toLocaleString()} eligible rows`}${algorithm}.`;
}

function requestLiveChart(
  context: RendererContext<RendererState>,
  state: OutputState
): void {
  const chart = state.liveChart;
  if (!context.postMessage || !state.liveId || liveChartValidationMessage(state)) {
    return;
  }
  const requestId = nextRequestId();
  chart.requestId = requestId;
  chart.requestSignature = liveChartConfigurationSignature(chart);
  chart.pending = true;
  chart.error = undefined;
  const capabilities = chartTypeCapabilities(chart.chartType);
  context.postMessage({
    type: 'requestLiveChart',
    liveId: state.liveId,
    requestId,
    chartType: chart.chartType,
    xColumn: chart.xColumn,
    yColumns: capabilities.usesGenericY ? chart.yColumns.slice(0, 16) : [],
    ...(capabilities.supportsGroupBy && chart.groupByColumn
      ? { groupByColumn: chart.groupByColumn }
      : {}),
    ...(capabilities.usesOhlc
      ? {
        openColumn: chart.openColumn,
        highColumn: chart.highColumn,
        lowColumn: chart.lowColumn,
        closeColumn: chart.closeColumn,
      }
      : {}),
    maxPoints: Math.min(MAX_NOTEBOOK_LIVE_CHART_POINTS, Math.max(1, chart.maxPoints)),
  });
}

function liveChartConfigurationSignature(chart: LiveChartState): string {
  return JSON.stringify([
    chart.chartType,
    chart.xColumn,
    chart.yColumns,
    chart.groupByColumn,
    chart.openColumn,
    chart.highColumn,
    chart.lowColumn,
    chart.closeColumn,
  ]);
}

function drawLiveChart(state: OutputState, host: HTMLElement, data: NotebookLiveChartData): void {
  drawNotebookChart(state, host, data);
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
  if (state.searchTimer !== undefined) {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = undefined;
  }
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
  const viewportHeight = liveViewportHeight(state);
  const virtualTop = Math.max(
    0,
    LIVE_HEADER_HEIGHT + row * resultSettings.rowHeight - Math.floor(viewportHeight / 2)
  );
  state.liveScrollTop = livePhysicalScrollTop(state, virtualTop);
  if (state.liveViewport) {
    state.liveViewport.scrollTop = state.liveScrollTop;
  }
  state.liveSlice = undefined;
}

function liveCanvasHeight(state: OutputState): number {
  return Math.max(
    liveViewportHeight(state),
    Math.min(LIVE_MAX_CANVAS_HEIGHT, liveVirtualHeight(state))
  );
}

function liveVirtualHeight(state: OutputState): number {
  return Math.max(
    liveViewportHeight(state),
    LIVE_HEADER_HEIGHT + state.liveRowCount * resultSettings.rowHeight
  );
}

function liveVirtualScrollTop(state: OutputState): number {
  const viewportHeight = liveViewportHeight(state);
  const maximumPhysical = Math.max(0, liveCanvasHeight(state) - viewportHeight);
  const maximumVirtual = Math.max(0, liveVirtualHeight(state) - viewportHeight);
  if (maximumPhysical === 0 || maximumVirtual === 0) {
    return 0;
  }
  return Math.min(maximumPhysical, Math.max(0, state.liveScrollTop)) /
    maximumPhysical * maximumVirtual;
}

function livePhysicalScrollTop(state: OutputState, virtualTop: number): number {
  const viewportHeight = liveViewportHeight(state);
  const maximumPhysical = Math.max(0, liveCanvasHeight(state) - viewportHeight);
  const maximumVirtual = Math.max(0, liveVirtualHeight(state) - viewportHeight);
  if (maximumPhysical === 0 || maximumVirtual === 0) {
    return 0;
  }
  return Math.min(maximumVirtual, Math.max(0, virtualTop)) /
    maximumVirtual * maximumPhysical;
}

function liveViewportHeight(state: OutputState): number {
  return state.liveViewport?.clientHeight ||
    state.liveViewportHeight ||
    notebookGridDefaultHeight(
      state.liveRowCount,
      resultSettings.rowHeight,
      LIVE_HEADER_HEIGHT
    );
}

function renderSavedResult(
  context: RendererContext<RendererState>,
  state: OutputState,
  root: HTMLElement
): void {
  const status = node('div', 'kx-status');
  status.setAttribute('role', 'status');
  if (state.liveStatus === 'unavailable') {
    root.append(node(
      'div',
      'kx-notice',
      state.liveMessage || 'Result unavailable.'
    ));
  }
  if (presentation === 'both' && state.payload.provenance.marker !== 'direct-ipc' &&
    !state.panelOpened && context.postMessage) {
    state.panelOpened = true;
    openPreview(context, state, status);
  }

  if (state.payload.kind === 'qText') {
    const toolbar = node('div', 'kx-toolbar kx-saved-toolbar');
    toolbar.append(button('Copy', () => {
      void copyText(state.payload.kind === 'qText' ? state.payload.data.text : '').then(
        () => { status.textContent = 'Copied.'; },
        () => { status.textContent = 'Clipboard unavailable.'; }
      );
    }));
    root.append(toolbar);
    renderPortableText(state.payload.data.text, 'qText result', root);
    if (state.payload.result.truncated) {
      root.append(node(
        'div',
        'kx-notice',
        `Output truncated at the notebook limit (${state.payload.result.byteLimit.toLocaleString()} bytes).`
      ));
    }
    renderSource(state, root);
    root.append(status);
    return;
  }
  const tablePayload = state.payload;

  const toolbar = node('div', 'kx-toolbar kx-saved-toolbar');
  toolbar.append(button(state.savedTableVisible ? 'Hide table' : 'Show table', () => {
    state.savedTableVisible = !state.savedTableVisible;
    renderState(context, state);
  }));
  if (chartColumns(tablePayload).numeric.length > 0 && tablePayload.schema.columns.length > 1) {
    toolbar.append(button(state.savedChartVisible ? 'Hide chart' : 'Chart', () => {
      state.savedChartVisible = !state.savedChartVisible;
      ensureSavedChartSpec(state);
      renderState(context, state);
    }));
  }
  root.append(toolbar);

  const result = state.payload.result;
  if (result.truncated) {
    const notice = result.previewRowCount < result.rowCount
      ? `Saved preview: showing ${result.previewRowCount.toLocaleString()} of ` +
        `${result.rowCount.toLocaleString()} rows. Omitted rows are not stored in this notebook.`
      : 'Saved output was shortened to notebook limits; ' +
        'omitted content is not stored in this notebook.';
    root.append(node(
      'div',
      'kx-notice',
      notice
    ));
  }
  if (state.savedTableVisible) {
    renderSavedTable(context, state, root);
  }
  if (state.savedChartVisible) {
    renderSavedChartControls(context, state, root);
  }
  renderSource(state, root);
  root.append(status);
}

function renderSavedTable(
  context: RendererContext<RendererState>,
  state: OutputState,
  root: HTMLElement
): void {
  if (state.payload.kind !== 'table') {
    return;
  }
  const payload = state.payload;
  const rowOrder = savedRowOrder(state, payload);
  reconcileSavedSearch(state, payload, rowOrder);
  const copyStatus = node('span', 'kx-meta');
  const tableTools = node('div', 'kx-toolbar kx-table-tools');
  const copySelection = (format: 'tsv' | 'csv'): void => {
    if (!state.savedSelection) {
      return;
    }
    const text = notebookDelimitedRangeText(
      payload.schema.columns.map(column => column.name),
      state.savedSelection,
      format,
      resultSettings.includeHeaders,
      (row, column) => portableCellText(payload.data.rows[rowOrder[row]][column]),
      resultSettings.includeRowIndex
    );
    void copyText(text).then(
      () => { copyStatus.textContent = 'Copied.'; },
      () => { copyStatus.textContent = 'Clipboard unavailable.'; }
    );
  };
  const copyTools = document.createElement('details');
  copyTools.className = 'kx-tools';
  const copySummary = document.createElement('summary');
  copySummary.textContent = 'Tools';
  copySummary.setAttribute('aria-label', 'Selected cells tools');
  const copyPanel = node('div', 'kx-tools-panel');
  const format = labelledSelect('Format', ['tsv', 'csv'], 'tsv', () => {});
  const formatSelect = format.querySelector('select')!;
  const copyButton = button('Copy', () => {
    copySelection(formatSelect.value === 'csv' ? 'csv' : 'tsv');
  });
  const updateCopyButtons = (): void => {
    const toolsState = notebookSelectionToolsState(
      state.savedSelection,
      LIVE_CLIPBOARD_CELL_LIMIT,
      copyTools.open
    );
    copyTools.hidden = !toolsState.visible;
    copyTools.open = toolsState.open;
    copyButton.disabled = !toolsState.copyEnabled;
  };
  updateCopyButtons();
  copyPanel.append(format, copyButton);
  copyTools.append(copySummary, copyPanel);
  state.savedCopyTools = copyTools;
  const searchInput = document.createElement('input');
  searchInput.id = `${state.domIdPrefix}-saved-search`;
  searchInput.type = 'search';
  searchInput.maxLength = MAX_NOTEBOOK_LIVE_SEARCH_CHARS;
  searchInput.placeholder = 'Search rows';
  searchInput.setAttribute('aria-label', 'Search saved result rows');
  searchInput.title = 'Enter: next match; Shift+Enter: previous match';
  searchInput.value = state.savedSearch.query;
  const searchStatus = node('span', 'kx-meta', savedSearchStatus(state.savedSearch));
  searchStatus.id = `${state.domIdPrefix}-saved-search-status`;
  searchStatus.setAttribute('role', 'status');
  searchStatus.setAttribute('aria-live', 'polite');
  searchInput.setAttribute('aria-describedby', searchStatus.id);
  searchInput.addEventListener('input', () => {
    state.savedSearch.query = searchInput.value.slice(0, MAX_NOTEBOOK_LIVE_SEARCH_CHARS);
    state.savedSearch.activeIndex = -1;
    reconcileSavedSearch(state, payload, rowOrder);
    searchStatus.textContent = savedSearchStatus(state.savedSearch);
    updateSavedSearchClasses(wrap, state.savedSearch);
  });
  searchInput.addEventListener('keydown', event => {
    if (event.key === 'Escape' && searchInput.value) {
      event.preventDefault();
      searchInput.value = '';
      state.savedSearch = emptySavedSearch();
      searchStatus.textContent = '';
      updateSavedSearchClasses(wrap, state.savedSearch);
      return;
    }
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    const action = notebookSearchEnterAction(
      state.savedSearch.matches.length,
      false,
      event.shiftKey
    );
    if (action === 'request') {
      reconcileSavedSearch(state, payload, rowOrder);
      searchStatus.textContent = savedSearchStatus(state.savedSearch);
      return;
    }
    state.savedSearch.activeIndex = notebookMovedSearchMatchIndex(
      state.savedSearch.activeIndex,
      state.savedSearch.matches.length,
      action === 'previous' ? -1 : 1
    );
    const match = state.savedSearch.matches[state.savedSearch.activeIndex];
    if (!match) {
      return;
    }
    const targetPageStart = Math.floor(match.displayRow / pageSize) * pageSize;
    if (targetPageStart !== pageStart) {
      state.savedViewportHeight = notebookGridResizedHeight(wrap.offsetHeight);
      state.savedViewport = undefined;
      state.savedTablePageStart = targetPageStart;
      state.savedScrollTop = 0;
      const searchInputId = searchInput.id;
      renderState(context, state);
      const nextViewport = state.savedViewport as HTMLElement | undefined;
      nextViewport?.querySelector<HTMLElement>(`tr[data-row="${match.displayRow}"]`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (nextViewport) {
        state.savedScrollTop = nextViewport.scrollTop;
      }
      document.getElementById(searchInputId)?.focus({ preventScroll: true });
      return;
    }
    searchStatus.textContent = savedSearchStatus(state.savedSearch);
    updateSavedSearchClasses(wrap, state.savedSearch);
    wrap.querySelector<HTMLElement>(`tr[data-row="${match.displayRow}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    state.savedScrollTop = wrap.scrollTop;
  });
  tableTools.append(searchInput, searchStatus, copyTools, copyStatus);
  root.append(tableTools);

  const wrap = node('div', 'kx-table-wrap');
  wrap.tabIndex = 0;
  wrap.setAttribute('aria-label', 'Saved KX result preview table');
  wrap.setAttribute('role', 'grid');
  wrap.setAttribute('aria-rowcount', String(payload.data.rows.length + 1));
  wrap.setAttribute('aria-colcount', String(payload.schema.columns.length));
  wrap.style.setProperty('--kx-row-height', `${resultSettings.rowHeight}px`);
  wrap.style.height = `${state.savedViewportHeight ?? notebookGridDefaultHeight(
    Math.min(TABLE_PAGE_SIZE, payload.data.rows.length),
    resultSettings.rowHeight,
    Math.max(SAVED_HEADER_HEIGHT, resultSettings.rowHeight)
  )}px`;
  state.savedViewport = wrap;
  const table = document.createElement('table');
  const colgroup = document.createElement('colgroup');
  if (resultSettings.showRowIndex) {
    const indexColumn = document.createElement('col');
    indexColumn.style.width = `${LIVE_ROW_INDEX_WIDTH}px`;
    colgroup.append(indexColumn);
  }
  payload.schema.columns.forEach(() => {
    const column = document.createElement('col');
    column.style.width = `${resultSettings.cellWidth}px`;
    colgroup.append(column);
  });
  table.append(colgroup);
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.setAttribute('role', 'row');
  headRow.setAttribute('aria-rowindex', '1');
  if (resultSettings.showRowIndex) {
    const corner = document.createElement('th');
    corner.className = 'kx-saved-row-index kx-saved-corner';
    corner.scope = 'col';
    corner.textContent = '#';
    headRow.append(corner);
  }
  payload.schema.columns.forEach((column, columnIndex) => {
    const th = document.createElement('th');
    th.scope = 'col';
    const label = state.savedSortColumn === columnIndex
      ? `${column.name} ${state.savedSortDirection === 'asc' ? '▲' : '▼'}`
      : column.name;
    const sort = button(label, () => {
      if (state.savedSortColumn !== columnIndex) {
        state.savedSortColumn = columnIndex;
        state.savedSortDirection = 'asc';
      } else if (state.savedSortDirection === 'asc') {
        state.savedSortDirection = 'desc';
      } else {
        state.savedSortColumn = undefined;
        state.savedSortDirection = undefined;
      }
      state.savedSelection = undefined;
      state.savedSearch.activeIndex = -1;
      state.savedTablePageStart = 0;
      renderState(context, state);
    });
    sort.className = 'kx-saved-sort';
    sort.title = `Sort by ${column.name}`;
    th.append(sort);
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
  const lastPageStart = payload.data.rows.length === 0
    ? 0
    : Math.floor((payload.data.rows.length - 1) / pageSize) * pageSize;
  const pageStart = Math.min(state.savedTablePageStart, lastPageStart);
  const pageEnd = Math.min(payload.data.rows.length, pageStart + pageSize);
  rowOrder.slice(pageStart, pageEnd).forEach((sourceRow, pageIndex) => {
    const rowIndex = pageStart + pageIndex;
    const row = payload.data.rows[sourceRow];
    const tr = document.createElement('tr');
    tr.dataset.row = String(rowIndex);
    tr.setAttribute('role', 'row');
    tr.setAttribute('aria-rowindex', String(rowIndex + 2));
    if (resultSettings.showRowIndex) {
      const rowHeader = node('th', 'kx-saved-row-index', String(rowIndex + 1));
      rowHeader.setAttribute('role', 'rowheader');
      rowHeader.setAttribute('scope', 'row');
      tr.append(rowHeader);
    }
    row.forEach((cell, columnIndex) => {
      const td = node('td', '', portableCellText(cell));
      td.id = gridCellId(state, rowIndex, columnIndex);
      td.setAttribute('role', 'gridcell');
      td.setAttribute('aria-colindex', String(columnIndex + 1));
      td.setAttribute('aria-label', `${payload.schema.columns[columnIndex].name}, row ${rowIndex + 1}`);
      td.dataset.row = String(rowIndex);
      td.dataset.column = String(columnIndex);
      if (notebookCellSelected(state.savedSelection, rowIndex, columnIndex)) {
        td.classList.add('is-selected');
        td.setAttribute('aria-selected', 'true');
      }
      if (activeSavedSearchRow(state.savedSearch, rowIndex)) {
        td.classList.add('is-search-match');
      }
      td.addEventListener('mousedown', event => {
        if (event.button !== 0) {
          return;
        }
        state.savedSelection = notebookSelectionForCell(
          state.savedSelection,
          rowIndex,
          columnIndex,
          event.shiftKey
        );
        updateSavedSelectionClasses(wrap, state.savedSelection);
        syncSavedActiveDescendant(wrap, state.savedSelection, state);
        updateCopyButtons();
        wrap.focus({ preventScroll: true });
        event.preventDefault();
      });
      td.addEventListener('mouseenter', event => {
        if ((event.buttons & 1) && state.savedSelection) {
          state.savedSelection = notebookSelectionForCell(
            state.savedSelection,
            rowIndex,
            columnIndex,
            true
          );
          updateSavedSelectionClasses(wrap, state.savedSelection);
          syncSavedActiveDescendant(wrap, state.savedSelection, state);
          updateCopyButtons();
        }
      });
      tr.append(td);
    });
    body.append(tr);
  });
  table.append(body);
  wrap.append(table);
  root.append(wrap);
  wrap.scrollTop = state.savedScrollTop;
  wrap.scrollLeft = state.savedScrollLeft;
  syncSavedActiveDescendant(wrap, state.savedSelection, state);
  wrap.addEventListener('scroll', () => {
    state.savedScrollTop = wrap.scrollTop;
    state.savedScrollLeft = wrap.scrollLeft;
  }, { passive: true });
  wrap.addEventListener('keydown', event => {
    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'c' &&
      notebookSelectionCellCount(state.savedSelection) > 0) {
      event.preventDefault();
      copySelection('tsv');
      return;
    }
    const move = moves[event.key];
    if (!move) {
      return;
    }
    const selection = notebookMoveSelection(
      state.savedSelection,
      move[0],
      move[1],
      event.shiftKey,
      payload.data.rows.length,
      payload.schema.columns.length
    );
    if (!selection) {
      return;
    }
    state.savedSelection = selection;
    const focusPageStart = Math.floor(selection.focusRow / pageSize) * pageSize;
    if (focusPageStart !== pageStart) {
      state.savedViewportHeight = notebookGridResizedHeight(wrap.offsetHeight);
      state.savedViewport = undefined;
      state.savedTablePageStart = focusPageStart;
      state.savedScrollTop = 0;
      renderState(context, state);
      const nextViewport = state.savedViewport as HTMLElement | undefined;
      nextViewport?.focus({ preventScroll: true });
      if (nextViewport) {
        revealSavedSelection(nextViewport, selection, state);
      }
      event.preventDefault();
      return;
    }
    updateSavedSelectionClasses(wrap, state.savedSelection);
    revealSavedSelection(wrap, state.savedSelection, state);
    updateCopyButtons();
    event.preventDefault();
  });
  if (payload.data.rows.length > pageSize) {
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
      node('span', 'kx-meta', `Rows ${pageStart + 1}-${pageEnd} of ${payload.data.rows.length}`),
      next
    );
    root.append(pagination);
  }
}

function savedRowOrder(state: OutputState, payload: PortableKxTableResult): number[] {
  const order = payload.data.rows.map((_row, index) => index);
  const column = state.savedSortColumn;
  const direction = state.savedSortDirection;
  if (column === undefined || !direction) {
    return order;
  }
  return order.sort((left, right) => {
    const leftText = portableCellText(payload.data.rows[left][column]);
    const rightText = portableCellText(payload.data.rows[right][column]);
    const leftNumber = Number(leftText);
    const rightNumber = Number(rightText);
    const comparison = Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
      ? leftNumber - rightNumber
      : leftText.localeCompare(rightText, undefined, { numeric: true, sensitivity: 'base' });
    return direction === 'asc' ? comparison : -comparison;
  });
}

function emptySavedSearch(): SavedSearchState {
  return {
    query: '',
    matches: [],
    activeIndex: -1,
    capped: false,
  };
}

function reconcileSavedSearch(
  state: OutputState,
  payload: PortableKxTableResult,
  rowOrder: readonly number[]
): void {
  const query = state.savedSearch.query.slice(0, MAX_NOTEBOOK_LIVE_SEARCH_CHARS);
  if (!query) {
    state.savedSearch = emptySavedSearch();
    return;
  }
  const activeSourceRow =
    state.savedSearch.matches[state.savedSearch.activeIndex]?.sourceRow;
  const result = notebookSavedSearchMatches(
    payload.data.rows.map(row => row.map(portableCellText)),
    rowOrder,
    query,
    SAVED_SEARCH_MAX_MATCHES
  );
  state.savedSearch = {
    query,
    matches: result.matches,
    activeIndex: activeSourceRow === undefined
      ? -1
      : result.matches.findIndex(match => match.sourceRow === activeSourceRow),
    capped: result.capped,
  };
}

function savedSearchStatus(search: SavedSearchState): string {
  if (!search.query) {
    return '';
  }
  if (search.matches.length === 0) {
    return 'No matches';
  }
  if (search.activeIndex >= 0) {
    return `${search.activeIndex + 1}/${search.matches.length}${search.capped ? '+' : ''}`;
  }
  return `${search.matches.length}${search.capped ? '+' : ''} match` +
    `${search.matches.length === 1 ? '' : 'es'}`;
}

function activeSavedSearchRow(search: SavedSearchState, row: number): boolean {
  return search.activeIndex >= 0 &&
    search.matches[search.activeIndex]?.displayRow === row;
}

function updateSavedSearchClasses(wrap: HTMLElement, search: SavedSearchState): void {
  wrap.querySelectorAll<HTMLElement>('tr[data-row]').forEach(row => {
    const active = activeSavedSearchRow(search, Number(row.dataset.row));
    row.querySelectorAll<HTMLElement>('td[role="gridcell"]').forEach(cell => {
      cell.classList.toggle('is-search-match', active);
    });
  });
}

function updateSavedSelectionClasses(
  wrap: HTMLElement,
  selection: NotebookCellSelection | undefined
): void {
  wrap.querySelectorAll<HTMLElement>('td[role="gridcell"]').forEach(cell => {
    const selected = notebookCellSelected(
      selection,
      Number(cell.dataset.row),
      Number(cell.dataset.column)
    );
    cell.classList.toggle('is-selected', selected);
    if (selected) {
      cell.setAttribute('aria-selected', 'true');
    } else {
      cell.removeAttribute('aria-selected');
    }
  });
}

function syncSavedActiveDescendant(
  wrap: HTMLElement,
  selection: NotebookCellSelection | undefined,
  state: OutputState
): void {
  if (!selection) {
    wrap.removeAttribute('aria-activedescendant');
    return;
  }
  const id = gridCellId(state, selection.focusRow, selection.focusColumn);
  if (document.getElementById(id)) {
    wrap.setAttribute('aria-activedescendant', id);
  } else {
    wrap.removeAttribute('aria-activedescendant');
  }
}

function revealSavedSelection(
  wrap: HTMLElement,
  selection: NotebookCellSelection | undefined,
  state: OutputState
): void {
  syncSavedActiveDescendant(wrap, selection, state);
  if (!selection) {
    return;
  }
  document.getElementById(gridCellId(state, selection.focusRow, selection.focusColumn))
    ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  state.savedScrollTop = wrap.scrollTop;
  state.savedScrollLeft = wrap.scrollLeft;
}

function renderSavedChartControls(
  context: RendererContext<RendererState>,
  state: OutputState,
  root: HTMLElement
): void {
  if (state.payload.kind !== 'table') {
    return;
  }
  ensureSavedChartSpec(state);
  const chart = state.savedChart;
  if (!chart) {
    root.append(node('div', 'kx-notice', 'Chart unavailable: the saved rows have no usable numeric series.'));
    return;
  }
  const candidates = chartColumns(state.payload);
  const controlModel = notebookChartControlModel(
    {
      chartType: chart.type,
      xColumn: chart.xColumn,
      yColumns: chart.yColumns,
      groupByColumn: chart.groupByColumn,
      openColumn: chart.openColumn,
      highColumn: chart.highColumn,
      lowColumn: chart.lowColumn,
      closeColumn: chart.closeColumn,
    },
    candidates.x,
    candidates.numeric,
    candidates.group
  );
  const capabilities = controlModel.capabilities;
  const panel = node('div', 'kx-chart-panel');
  const controls = node('div', 'kx-chart-controls');
  controls.append(labelledSelect(
    'Chart type',
    ['line', 'scatter', 'step', 'bar', 'box', 'candlestick'],
    chart.type,
    value => {
    chart.type = value as NotebookChartType;
    renderState(context, state);
    }
  ));
  controls.append(labelledSelect('X', candidates.x, chart.xColumn, value => {
    chart.xColumn = value;
    chart.yColumns = reconcileNotebookChartYColumns(
      candidates.numeric,
      value,
      chart.yColumns
    );
    renderState(context, state);
  }));
  if (capabilities.usesGenericY) {
    controls.append(multiColumnControl(
      'Y',
      controlModel.yColumns,
      chart.yColumns,
      state.savedChartYOpen,
      (column, checked) => {
        chart.yColumns = toggleNotebookChartYColumn(
          candidates.numeric,
          chart.xColumn,
          chart.yColumns,
          column,
          checked
        );
        renderState(context, state);
      },
      open => { state.savedChartYOpen = open; }
    ));
  }
  if (capabilities.supportsGroupBy) {
    controls.append(labelledSelectOptions(
      'Group by',
      [
        { value: '', label: 'None' },
        ...controlModel.groupColumns.map(value => ({ value, label: value })),
      ],
      chart.groupByColumn || '',
      value => {
        chart.groupByColumn = value || undefined;
        renderState(context, state);
      }
    ));
  }
  if (capabilities.usesOhlc) {
    const numeric = controlModel.yColumns;
    const ohlcControls: Array<[string, keyof Pick<
      NotebookChartSpec,
      'openColumn' | 'highColumn' | 'lowColumn' | 'closeColumn'
    >]> = [
      ['Open', 'openColumn'],
      ['High', 'highColumn'],
      ['Low', 'lowColumn'],
      ['Close', 'closeColumn'],
    ];
    ohlcControls.forEach(([label, key]) => {
      controls.append(labelledSelectOptions(
        label,
        [
          { value: '', label: `Select ${label}` },
          ...numeric.map(value => ({ value, label: value })),
        ],
        chart[key] || '',
        value => {
          chart[key] = value || undefined;
          renderState(context, state);
        }
      ));
    });
  }
  const validation = controlModel.validationMessage;
  const render = button('Render', () => {
    state.savedRenderedChart = cloneNotebookChartSpec(chart);
    renderState(context, state);
  });
  render.disabled = !!validation;
  controls.append(render);
  const reset = button('Reset zoom', () => {
    resetPlotZoom(state);
  });
  reset.disabled = !state.savedRenderedChart;
  controls.append(reset);
  panel.append(controls);
  const renderedChart = state.savedRenderedChart;
  const dirty = !!renderedChart &&
    notebookChartSpecSignature(renderedChart) !== notebookChartSpecSignature(chart);
  const status = node(
    'div',
    'kx-status',
    validation || (dirty
      ? 'Chart settings changed — Render to update.'
      : renderedChart
        ? ''
        : 'Press Render to create chart.')
  );
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  if (status.textContent) {
    panel.append(status);
  }
  if (!renderedChart) {
    root.append(panel);
    return;
  }
  const chartHost = node('div', 'kx-chart-host');
  panel.append(chartHost);
  root.append(panel);

  const prepared = savedChartData(state.payload, renderedChart, state.savedMaxChartPoints);
  if (!prepared) {
    chartHost.append(node('div', 'kx-notice', 'Chart unavailable: selected columns contain no finite saved points.'));
    return;
  }
  drawNotebookChart(state, chartHost, prepared);
}

function drawNotebookChart(
  state: OutputState,
  host: HTMLElement,
  data: NotebookLiveChartData
): void {
  if (data.x.length === 0 || data.series.length === 0) {
    host.append(node('div', 'kx-notice', 'Chart has no finite sampled points.'));
    return;
  }
  const colors = chartColors();
  const keys = notebookChartSeriesKeys(data);
  state.plotSeriesKeys = keys;
  const series: uPlot.Series[] = [{ label: data.xColumn }];
  if (data.chartType === 'candlestick') {
    const color = cssColor(host, '--vscode-charts-green', '#2ea043');
    series.push({
      label: 'OHLC',
      show: chartSeriesVisible(state.hiddenChartSeriesKeys, keys[0]),
      stroke: color,
      width: 0,
      points: { show: false },
      value: (_self, _rawValue, _seriesIndex, index) => {
        const candle = index === null || index === undefined
          ? undefined
          : data.candlesticks?.[index];
        return candle
          ? `O ${formatChartNumber(candle.open)} H ${formatChartNumber(candle.high)} ` +
            `L ${formatChartNumber(candle.low)} C ${formatChartNumber(candle.close)}`
          : '';
      },
    });
  } else {
    data.series.forEach((item, index) => {
      const color = colors[index % colors.length];
      const config: uPlot.Series = {
        label: item.columnName,
        show: chartSeriesVisible(state.hiddenChartSeriesKeys, keys[index]),
        stroke: color,
        width: data.chartType === 'scatter' ||
          data.chartType === 'bar' ||
          data.chartType === 'box'
          ? 0
          : 1.5,
        points: {
          show: data.chartType === 'scatter',
          size: data.chartType === 'scatter' ? 5 : 3,
          stroke: color,
          fill: color,
        },
        value: (_self, rawValue) => rawValue === null || rawValue === undefined
          ? ''
          : formatChartNumber(Number(rawValue)),
      };
      if (data.chartType === 'step' && uPlot.paths.stepped) {
        config.paths = uPlot.paths.stepped({ align: 1 });
      } else if (data.chartType === 'bar') {
        config.fill = alphaColor(color, 0.5);
      }
      series.push(config);
    });
  }
  const aligned = data.chartType === 'candlestick'
    ? [
      data.x,
      data.candlesticks?.map(candle => candle.close) || [],
    ] as uPlot.AlignedData
    : [data.x, ...data.series.map(item => item.values)] as uPlot.AlignedData;
  createPlot(
    state,
    host,
    notebookPlotOptions(
      host,
      data.chartType,
      data.xKind === 'temporal',
      series,
      data.x,
      colors,
      280,
      data,
      state
    ),
    aligned
  );
}

function notebookChartSeriesKeys(data: NotebookLiveChartData): string[] {
  if (data.chartType === 'candlestick') {
    const roles = data.ohlcColumns;
    return [
      `candlestick\0${roles?.open || ''}\0${roles?.high || ''}\0` +
      `${roles?.low || ''}\0${roles?.close || ''}`,
    ];
  }
  return data.series.map(series =>
    `${series.sourceColumnName || series.columnName}\0${series.groupValue || ''}\0${series.columnName}`
  );
}

function capturePlotSeriesVisibility(state: OutputState, plot = state.plot): void {
  if (!plot || state.plotSeriesKeys.length === 0) {
    return;
  }
  const hiddenRenderedKeys = state.plotSeriesKeys.filter((_key, index) =>
    plot.series[index + 1]?.show === false
  );
  state.hiddenChartSeriesKeys = updateHiddenChartSeriesKeys(
    state.hiddenChartSeriesKeys,
    state.plotSeriesKeys,
    hiddenRenderedKeys
  );
}

function createPlot(
  state: OutputState,
  host: HTMLElement,
  options: uPlot.Options,
  data: uPlot.AlignedData
): void {
  try {
    state.plot = new uPlot(options, data, host);
    decoratePlotLegendAccessibility(state.plot);
    host.addEventListener('dblclick', event => {
      event.preventDefault();
      resetPlotZoom(state);
    });
    state.plotResizeObserver = new ResizeObserver(entries => {
      const width = Math.floor(entries[0]?.contentRect.width || 0);
      if (state.plot && width >= 320) {
        state.plot.setSize({ width, height: options.height || 260 });
      }
    });
    state.plotResizeObserver.observe(host);
  } catch {
    destroyPlot(state);
    host.replaceChildren(node('div', 'kx-notice', 'Chart rendering failed; the result table remains available.'));
  }
}

function decoratePlotLegendAccessibility(plot: uPlot): void {
  const labels = Array.from(
    plot.root.querySelectorAll<HTMLElement>('.u-legend .u-series > th')
  );
  const offset = labels.length === plot.series.length ? 0 : 1;
  labels.forEach((label, labelIndex) => {
    const seriesIndex = labelIndex + offset;
    if (seriesIndex < 1 || seriesIndex >= plot.series.length) {
      return;
    }
    label.tabIndex = 0;
    label.setAttribute('role', 'button');
    label.setAttribute('aria-label', `Toggle chart series ${plot.series[seriesIndex].label || seriesIndex}`);
    label.dataset.kxSeriesIndex = String(seriesIndex);
    if (label.dataset.kxKeyboardToggle !== 'true') {
      label.dataset.kxKeyboardToggle = 'true';
      label.addEventListener('keydown', event => {
        if (!chartLegendToggleKey(event.key)) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const index = Number(label.dataset.kxSeriesIndex);
        if (Number.isSafeInteger(index) && index > 0 && index < plot.series.length) {
          plot.setSeries(index, { show: plot.series[index].show === false });
        }
      });
    }
  });
  syncPlotLegendAccessibility(plot);
}

function syncPlotLegendAccessibility(plot: uPlot): void {
  plot.root.querySelectorAll<HTMLElement>('.u-legend .u-series > th').forEach(label => {
    const seriesIndex = Number(label.dataset.kxSeriesIndex);
    if (Number.isSafeInteger(seriesIndex) && seriesIndex > 0 && seriesIndex < plot.series.length) {
      label.setAttribute('aria-pressed', plot.series[seriesIndex].show === false ? 'false' : 'true');
    }
  });
}

function resetPlotZoom(state: OutputState): void {
  if (!state.plot) {
    return;
  }
  state.plot.setData(state.plot.data, true);
  state.plot.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
}

function notebookPlotOptions(
  host: HTMLElement,
  chartType: ChartType,
  temporal: boolean,
  series: uPlot.Series[],
  xValues: number[],
  colors: string[],
  height: number,
  data: NotebookLiveChartData,
  state: OutputState
): uPlot.Options {
  const axisColor = cssColor(host, '--vscode-descriptionForeground', '#999');
  const gridColor = cssColor(host, '--vscode-panel-border', '#555');
  const paddedX =
    chartType === 'bar' || chartType === 'box' || chartType === 'candlestick';
  const customY =
    chartType === 'bar' || chartType === 'box' || chartType === 'candlestick';
  const drawHook = chartType === 'bar'
    ? (plot: uPlot) => drawClusteredBars(plot, colors)
    : chartType === 'box'
      ? (plot: uPlot) => drawNotebookBoxes(plot, data, colors)
      : chartType === 'candlestick'
        ? (plot: uPlot) => drawNotebookCandlesticks(plot, data, host)
        : undefined;
  return {
    width: Math.max(320, Math.floor(host.getBoundingClientRect().width || 720)),
    height,
    ms: 1,
    series,
    scales: {
      x: {
        time: temporal,
        ...(paddedX
          ? {
            range: (_self, min, max) => {
              const step = minimumPositiveStep(xValues) || (temporal ? 86_400_000 : 1);
              return [min - step * 0.55, max + step * 0.55];
            },
          }
          : {}),
      },
      y: {
        auto: true,
        ...(customY
          ? {
            range: (_self, min, max) => {
              const custom = notebookChartYRange(data, state);
              const low = chartType === 'bar'
                ? Math.min(0, custom?.min ?? min)
                : (custom?.min ?? min);
              const high = chartType === 'bar'
                ? Math.max(0, custom?.max ?? max)
                : (custom?.max ?? max);
              const padding = Math.max(1, Math.abs(high - low) * 0.05);
              return [low - padding, high + padding];
            },
          }
          : {}),
      },
    },
    axes: [
      {
        scale: 'x',
        stroke: axisColor,
        grid: { stroke: gridColor, width: 1 },
        ticks: { stroke: gridColor, width: 1 },
      },
      {
        scale: 'y',
        stroke: axisColor,
        grid: { stroke: gridColor, width: 1 },
        ticks: { stroke: gridColor, width: 1 },
      },
    ],
    cursor: {
      show: true,
      x: true,
      y: true,
      points: { show: true, size: 6 },
      drag: { setScale: true, x: true, y: false, dist: 5 },
      focus: { prox: 24 },
    },
    legend: { show: true, live: true, isolate: false },
    hooks: {
      ...(drawHook ? { draw: [drawHook] } : {}),
      setSeries: [
        (plot: uPlot) => {
          capturePlotSeriesVisibility(state, plot);
          syncPlotLegendAccessibility(plot);
        },
      ],
    },
  };
}

function drawClusteredBars(plot: uPlot, colors: string[]): void {
  const xValues = plot.data[0] as number[];
  const seriesCount = Math.max(1, plot.data.length - 1);
  if (xValues.length === 0 || seriesCount === 0) {
    return;
  }
  const ratio = window.devicePixelRatio || 1;
  const zero = plot.valToPos(0, 'y', true);
  const context = plot.ctx;
  context.save();
  context.beginPath();
  context.rect(plot.bbox.left, plot.bbox.top, plot.bbox.width, plot.bbox.height);
  context.clip();
  xValues.forEach((x, xIndex) => {
    const center = plot.valToPos(x, 'x', true);
    let gap = 44 * ratio;
    if (xIndex > 0) {
      gap = Math.min(gap, Math.abs(center - plot.valToPos(xValues[xIndex - 1], 'x', true)));
    }
    if (xIndex + 1 < xValues.length) {
      gap = Math.min(gap, Math.abs(plot.valToPos(xValues[xIndex + 1], 'x', true) - center));
    }
    const clusterWidth = Math.max(1 * ratio, Math.min(72 * ratio, gap * 0.78));
    const slotWidth = clusterWidth / seriesCount;
    if (slotWidth < 0.75 * ratio) {
      return;
    }
    const barWidth = Math.max(1 * ratio, Math.min(28 * ratio, slotWidth * 0.86));
    for (let seriesIndex = 0; seriesIndex < seriesCount; seriesIndex += 1) {
      if (plot.series[seriesIndex + 1]?.show === false) {
        continue;
      }
      const value = Number(plot.data[seriesIndex + 1][xIndex]);
      if (!Number.isFinite(value) || value === 0) {
        continue;
      }
      const y = plot.valToPos(value, 'y', true);
      const seriesCenter =
        center - clusterWidth / 2 + slotWidth * seriesIndex + slotWidth / 2;
      const color = colors[seriesIndex % colors.length];
      context.fillStyle = alphaColor(color, 0.55);
      context.strokeStyle = color;
      context.lineWidth = Math.max(1, ratio);
      context.fillRect(
        seriesCenter - barWidth / 2,
        Math.min(y, zero),
        barWidth,
        Math.max(1 * ratio, Math.abs(zero - y))
      );
      context.strokeRect(
        seriesCenter - barWidth / 2,
        Math.min(y, zero),
        barWidth,
        Math.max(1 * ratio, Math.abs(zero - y))
      );
    }
  });
  context.restore();
}

function drawNotebookCandlesticks(
  plot: uPlot,
  data: NotebookLiveChartData,
  host: HTMLElement
): void {
  if (!data.candlesticks?.length || plot.series[1]?.show === false) {
    return;
  }
  const ratio = window.devicePixelRatio || 1;
  const up = cssColor(host, '--vscode-charts-green', '#2ea043');
  const down = cssColor(host, '--vscode-charts-red', '#d73a49');
  const hollow = cssColor(host, '--vscode-editor-background', '#1e1e1e');
  const context = plot.ctx;
  context.save();
  context.beginPath();
  context.rect(plot.bbox.left, plot.bbox.top, plot.bbox.width, plot.bbox.height);
  context.clip();
  data.candlesticks.forEach((candle, index) => {
    const center = plot.valToPos(candle.x, 'x', true);
    const bodyWidth = Math.max(
      1 * ratio,
      Math.min(18 * ratio, notebookLocalXGap(plot, data.x, index, 16 * ratio) * 0.68)
    );
    const high = plot.valToPos(candle.high, 'y', true);
    const low = plot.valToPos(candle.low, 'y', true);
    const open = plot.valToPos(candle.open, 'y', true);
    const close = plot.valToPos(candle.close, 'y', true);
    const rising = candle.close >= candle.open;
    const color = rising ? up : down;
    const top = Math.min(open, close);
    const height = Math.max(1 * ratio, Math.abs(close - open));
    context.strokeStyle = color;
    context.fillStyle = rising ? hollow : color;
    context.lineWidth = Math.max(1, ratio);
    context.beginPath();
    context.moveTo(center, high);
    context.lineTo(center, low);
    context.stroke();
    context.fillRect(center - bodyWidth / 2, top, bodyWidth, height);
    context.strokeRect(center - bodyWidth / 2, top, bodyWidth, height);
  });
  context.restore();
}

function drawNotebookBoxes(
  plot: uPlot,
  data: NotebookLiveChartData,
  colors: string[]
): void {
  if (!data.boxSeries?.length) {
    return;
  }
  const ratio = window.devicePixelRatio || 1;
  const seriesCount = data.boxSeries.length;
  const context = plot.ctx;
  context.save();
  context.beginPath();
  context.rect(plot.bbox.left, plot.bbox.top, plot.bbox.width, plot.bbox.height);
  context.clip();
  data.x.forEach((x, xIndex) => {
    const center = plot.valToPos(x, 'x', true);
    const groupWidth = Math.max(
      2 * ratio,
      Math.min(72 * ratio, notebookLocalXGap(plot, data.x, xIndex, 44 * ratio) * 0.78)
    );
    const slotWidth = groupWidth / Math.max(1, seriesCount);
    if (slotWidth < 1.75 * ratio) {
      return;
    }
    data.boxSeries!.forEach((series, seriesIndex) => {
      if (plot.series[seriesIndex + 1]?.show === false) {
        return;
      }
      const stats = series.stats[xIndex];
      if (!stats) {
        return;
      }
      const seriesCenter =
        center - groupWidth / 2 + slotWidth * seriesIndex + slotWidth / 2;
      const width = Math.max(
        1 * ratio,
        Math.min(28 * ratio, slotWidth * 0.72, slotWidth - ratio)
      );
      const min = plot.valToPos(stats.min, 'y', true);
      const q1 = plot.valToPos(stats.q1, 'y', true);
      const median = plot.valToPos(stats.median, 'y', true);
      const q3 = plot.valToPos(stats.q3, 'y', true);
      const max = plot.valToPos(stats.max, 'y', true);
      const color = colors[seriesIndex % colors.length];
      context.strokeStyle = color;
      context.fillStyle = alphaColor(color, 0.22);
      context.lineWidth = Math.max(1, ratio);
      context.beginPath();
      context.moveTo(seriesCenter, max);
      context.lineTo(seriesCenter, min);
      context.moveTo(seriesCenter - width * 0.34, min);
      context.lineTo(seriesCenter + width * 0.34, min);
      context.moveTo(seriesCenter - width * 0.34, max);
      context.lineTo(seriesCenter + width * 0.34, max);
      context.stroke();
      context.fillRect(
        seriesCenter - width / 2,
        Math.min(q1, q3),
        width,
        Math.max(1, Math.abs(q3 - q1))
      );
      context.strokeRect(
        seriesCenter - width / 2,
        Math.min(q1, q3),
        width,
        Math.max(1, Math.abs(q3 - q1))
      );
      context.beginPath();
      context.moveTo(seriesCenter - width / 2, median);
      context.lineTo(seriesCenter + width / 2, median);
      context.stroke();
    });
  });
  context.restore();
}

function notebookLocalXGap(
  plot: uPlot,
  values: number[],
  index: number,
  fallback: number
): number {
  if (values.length <= 1) {
    return fallback;
  }
  const center = plot.valToPos(values[index], 'x', true);
  let gap = Infinity;
  if (index > 0) {
    gap = Math.min(gap, Math.abs(center - plot.valToPos(values[index - 1], 'x', true)));
  }
  if (index + 1 < values.length) {
    gap = Math.min(gap, Math.abs(plot.valToPos(values[index + 1], 'x', true) - center));
  }
  return Number.isFinite(gap) && gap > 0 ? gap : fallback;
}

function notebookChartYRange(
  data: NotebookLiveChartData,
  state: OutputState
): { min: number; max: number } | undefined {
  let min = Infinity;
  let max = -Infinity;
  const visible = (index: number): boolean =>
    chartSeriesVisible(state.hiddenChartSeriesKeys, notebookChartSeriesKeys(data)[index]);
  if (data.chartType === 'candlestick') {
    if (visible(0)) {
      data.candlesticks?.forEach(candle => {
        min = Math.min(min, candle.low);
        max = Math.max(max, candle.high);
      });
    }
  } else if (data.chartType === 'box') {
    data.boxSeries?.forEach((series, index) => {
      if (!visible(index)) {
        return;
      }
      series.stats.forEach(stats => {
        if (stats) {
          min = Math.min(min, stats.min);
          max = Math.max(max, stats.max);
        }
      });
    });
  } else {
    data.series.forEach((series, index) => {
      if (!visible(index)) {
        return;
      }
      series.values.forEach(value => {
        if (value !== null && Number.isFinite(value)) {
          min = Math.min(min, value);
          max = Math.max(max, value);
        }
      });
    });
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : undefined;
}

function formatChartNumber(value: number): string {
  return Number.isFinite(value)
    ? value.toFixed(resultSettings.chartDecimalPlaces)
    : '';
}

function minimumPositiveStep(values: number[]): number | undefined {
  let minimum = Infinity;
  for (let index = 1; index < values.length; index += 1) {
    const step = values[index] - values[index - 1];
    if (Number.isFinite(step) && step > 0) {
      minimum = Math.min(minimum, step);
    }
  }
  return Number.isFinite(minimum) ? minimum : undefined;
}

function cssColor(host: HTMLElement, property: string, fallback: string): string {
  return getComputedStyle(host).getPropertyValue(property).trim() || fallback;
}

function alphaColor(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) {
    return color;
  }
  const value = Number.parseInt(match[1], 16);
  return `rgba(${value >> 16},${(value >> 8) & 255},${value & 255},${alpha})`;
}

function resultSettingsControl(
  context: RendererContext<RendererState>
): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'kx-settings';
  const summary = document.createElement('summary');
  summary.textContent = 'Settings';
  summary.title = 'Result settings';
  summary.setAttribute('aria-label', 'Result settings');
  details.append(summary);
  const panel = node('div', 'kx-settings-panel');
  panel.append(
    settingSelect(context, 'Density', 'density', ['compact', 'standard', 'comfortable'], resultSettings.density),
    settingNumber(context, 'Cell width', 'cellWidth', resultSettings.cellWidth, 80, 600),
    settingNumber(context, 'Row height', 'rowHeight', resultSettings.rowHeight, 20, 80),
    settingNumber(context, 'Font size', 'fontSize', resultSettings.fontSize, 0, 32),
    settingCheckbox(context, 'Show row numbers', 'showRowIndex', resultSettings.showRowIndex),
    settingCheckbox(context, 'Copy headers', 'includeHeaders', resultSettings.includeHeaders),
    settingCheckbox(context, 'Copy row numbers', 'includeRowIndex', resultSettings.includeRowIndex),
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
    status.textContent = 'KX Results unavailable.';
    return;
  }
  context.postMessage({ type: 'openPreview', payload: state.payload });
  status.textContent = 'Opening KX Results…';
}

function savedChartData(
  payload: PortableKxTableResult,
  chart: NotebookChartSpec,
  limit: number
): NotebookLiveChartData | undefined {
  try {
    const built = buildChartData(portableTable(payload), {
      chartType: chart.type,
      xColumn: chart.xColumn,
      yColumns: chart.yColumns,
      groupByColumn: chart.groupByColumn,
      openColumn: chart.openColumn,
      highColumn: chart.highColumn,
      lowColumn: chart.lowColumn,
      closeColumn: chart.closeColumn,
      width: 720,
      version: 1,
      requestId: 1,
      maxSourceRows: payload.result.previewRowCount,
      maxSampledPoints: limit,
    });
    if (built.x.length === 0 || built.series.length === 0) {
      return undefined;
    }
    return built;
  } catch {
    return undefined;
  }
}

function chartColumns(
  payload: PortableKxTableResult
): { x: string[]; numeric: string[]; group: string[] } {
  const options = chartColumnOptions(portableTable(payload), 200);
  return {
    x: options.xColumns.map(option => option.columnName),
    numeric: options.yColumns.map(option => option.columnName),
    group: options.groupColumns.map(option => option.columnName),
  };
}

function ensureSavedChartSpec(state: OutputState): void {
  if (state.savedChart || state.payload.kind !== 'table') {
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
    ...defaultNotebookOhlcColumns(candidates.numeric),
  };
  state.savedRenderedChart = cloneNotebookChartSpec(state.savedChart);
}

function defaultNotebookOhlcColumns(columns: string[]): Pick<
  NotebookChartSpec,
  'openColumn' | 'highColumn' | 'lowColumn' | 'closeColumn'
> {
  const match = (role: string): string | undefined => {
    const matches = columns.filter(name =>
      name.trim().toLocaleLowerCase() === role.toLocaleLowerCase()
    );
    return matches.length === 1 ? matches[0] : undefined;
  };
  return {
    openColumn: match('open'),
    highColumn: match('high'),
    lowColumn: match('low'),
    closeColumn: match('close'),
  };
}

function cloneNotebookChartSpec(chart: NotebookChartSpec): NotebookChartSpec {
  return { ...chart, yColumns: chart.yColumns.slice() };
}

function notebookChartSpecSignature(chart: NotebookChartSpec): string {
  return JSON.stringify([
    chart.type,
    chart.xColumn,
    chart.yColumns,
    chart.groupByColumn || '',
    chart.openColumn || '',
    chart.highColumn || '',
    chart.lowColumn || '',
    chart.closeColumn || '',
  ]);
}

function chartForColumns(
  xColumns: string[],
  yColumns: string[],
  _groupColumns: string[] = []
): LiveChartState {
  const xColumn = xColumns.find(name => yColumns.some(candidate => candidate !== name)) ||
    xColumns[0] || '';
  const roleColumn = (role: string): string => {
    const normalized = role.toLocaleLowerCase();
    const matches = yColumns.filter(name => name.trim().toLocaleLowerCase() === normalized);
    return matches.length === 1 ? matches[0] : '';
  };
  return {
    visible: false,
    chartType: 'line',
    xColumn,
    yColumns: reconcileNotebookChartYColumns(yColumns, xColumn, []),
    groupByColumn: '',
    openColumn: roleColumn('open'),
    highColumn: roleColumn('high'),
    lowColumn: roleColumn('low'),
    closeColumn: roleColumn('close'),
    maxPoints: notebookChartPointLimit(),
    requestId: 0,
    pending: false,
    dirty: true,
  };
}

function emptyLiveChart(): LiveChartState {
  return chartForColumns([], []);
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
    return 'Searching…';
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

function requestLiveCopy(
  context: RendererContext<RendererState>,
  state: OutputState,
  format: 'tsv' | 'csv'
): void {
  const range = notebookSelectionRange(state.liveSelection);
  const cellCount = notebookSelectionCellCount(state.liveSelection);
  if (!context.postMessage || !state.liveId || !range ||
    cellCount < 1 || cellCount > LIVE_CLIPBOARD_CELL_LIMIT) {
    return;
  }
  const requestId = nextRequestId();
  state.liveCopyRequestId = requestId;
  state.liveCopyMessage = 'Copying…';
  context.postMessage({
    type: 'copyLiveRange',
    liveId: state.liveId,
    requestId,
    ...range,
    format,
    includeHeaders: resultSettings.includeHeaders,
    includeRowIndex: resultSettings.includeRowIndex,
    ...liveSortFields(state),
  });
  renderState(context, state);
}

function updateLiveSelectionClasses(state: OutputState): void {
  state.liveCanvas?.querySelectorAll<HTMLElement>('.kx-live-cell[role="gridcell"]').forEach(cell => {
    const row = Number(cell.dataset.row);
    const column = Number(cell.dataset.column);
    const selected = notebookCellSelected(state.liveSelection, row, column);
    cell.classList.toggle('is-selected', selected);
    if (selected) {
      cell.setAttribute('aria-selected', 'true');
    } else {
      cell.removeAttribute('aria-selected');
    }
  });
  updateLiveCopyControls(state);
  syncLiveActiveDescendant(state);
}

function updateLiveCopyControls(state: OutputState): void {
  const toolsState = notebookSelectionToolsState(
    state.liveSelection,
    LIVE_CLIPBOARD_CELL_LIMIT,
    state.liveCopyTools?.open === true
  );
  if (state.liveCopyTools) {
    state.liveCopyTools.hidden = !toolsState.visible;
    state.liveCopyTools.open = toolsState.open;
  }
  state.liveCopyButtons?.forEach(copyButton => {
    copyButton.disabled = !toolsState.copyEnabled;
  });
  if (state.liveCopyStatus) {
    state.liveCopyStatus.textContent = state.liveCopyMessage || '';
    state.liveCopyStatus.hidden = !state.liveCopyMessage;
  }
}

function syncLiveActiveDescendant(state: OutputState): void {
  const viewport = state.liveViewport;
  const selection = state.liveSelection;
  if (!viewport || !selection) {
    viewport?.removeAttribute('aria-activedescendant');
    return;
  }
  const id = gridCellId(state, selection.focusRow, selection.focusColumn);
  if (document.getElementById(id)) {
    viewport.setAttribute('aria-activedescendant', id);
  } else {
    viewport.removeAttribute('aria-activedescendant');
  }
}

function handleLiveGridKeydown(
  context: RendererContext<RendererState>,
  state: OutputState,
  event: KeyboardEvent
): void {
  const moves: Record<string, [number, number]> = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
    Home: [0, -Number.MAX_SAFE_INTEGER],
    End: [0, Number.MAX_SAFE_INTEGER],
    PageUp: [-Math.max(1, Math.floor(liveViewportHeight(state) / resultSettings.rowHeight)), 0],
    PageDown: [Math.max(1, Math.floor(liveViewportHeight(state) / resultSettings.rowHeight)), 0],
  };
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'c' &&
    notebookSelectionCellCount(state.liveSelection) > 0) {
    event.preventDefault();
    requestLiveCopy(context, state, 'tsv');
    return;
  }
  const move = moves[event.key];
  if (!move) {
    return;
  }
  const selection = notebookMoveSelection(
    state.liveSelection,
    move[0],
    move[1],
    event.shiftKey,
    state.liveRowCount,
    state.liveColumns.length
  );
  if (!selection) {
    return;
  }
  state.liveSelection = selection;
  state.liveCopyMessage = undefined;
  updateLiveCopyControls(state);
  scrollLiveCellIntoView(state, selection.focusRow, selection.focusColumn);
  refreshLiveViewport(context, state);
  event.preventDefault();
}

function scrollLiveCellIntoView(state: OutputState, row: number, column: number): void {
  const viewport = state.liveViewport;
  if (!viewport) {
    return;
  }
  const rowIndexWidth = resultSettings.showRowIndex ? LIVE_ROW_INDEX_WIDTH : 0;
  const virtualTop = LIVE_HEADER_HEIGHT + row * resultSettings.rowHeight;
  const currentVirtualTop = liveVirtualScrollTop(state);
  const viewportHeight = liveViewportHeight(state);
  let targetVirtualTop = currentVirtualTop;
  if (virtualTop < currentVirtualTop + LIVE_HEADER_HEIGHT) {
    targetVirtualTop = Math.max(0, virtualTop - LIVE_HEADER_HEIGHT);
  } else if (virtualTop + resultSettings.rowHeight > currentVirtualTop + viewportHeight) {
    targetVirtualTop = virtualTop + resultSettings.rowHeight - viewportHeight;
  }
  state.liveScrollTop = livePhysicalScrollTop(state, targetVirtualTop);
  const left = rowIndexWidth + column * resultSettings.cellWidth;
  if (left < state.liveScrollLeft + rowIndexWidth) {
    state.liveScrollLeft = Math.max(0, left - rowIndexWidth);
  } else if (left + resultSettings.cellWidth > state.liveScrollLeft + viewport.clientWidth) {
    state.liveScrollLeft = left + resultSettings.cellWidth - viewport.clientWidth;
  }
  viewport.scrollTop = state.liveScrollTop;
  viewport.scrollLeft = state.liveScrollLeft;
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
    refreshLiveViewport(context, state);
  });
}

function portableTable(payload: PortableKxTableResult): ColumnarPanelResult {
  return createColumnarPanelResult(
    payload.schema.columns.map(column => column.name),
    payload.data.rows.length,
    (rowIndex, columnIndex) => portableCellValue(payload.data.rows[rowIndex][columnIndex])
  );
}

function nextRequestId(): number {
  requestSequence = requestSequence >= MAX_NOTEBOOK_LIVE_REQUEST_ID ? 1 : requestSequence + 1;
  return requestSequence;
}

function gridCellId(state: OutputState, row: number, column: number): string {
  return `${state.domIdPrefix}-r${row}-c${column}`;
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
  capturePlotSeriesVisibility(state);
  state.plotResizeObserver?.disconnect();
  state.plotResizeObserver = undefined;
  state.plot?.destroy();
  state.plot = undefined;
  state.plotSeriesKeys = [];
}

function captureViewportState(state: OutputState): void {
  if (state.liveViewport?.isConnected) {
    state.liveScrollTop = state.liveViewport.scrollTop;
    state.liveScrollLeft = state.liveViewport.scrollLeft;
    state.liveViewportHeight = notebookGridResizedHeight(state.liveViewport.offsetHeight);
  }
  if (state.savedViewport?.isConnected) {
    state.savedScrollTop = state.savedViewport.scrollTop;
    state.savedScrollLeft = state.savedViewport.scrollLeft;
    state.savedViewportHeight = notebookGridResizedHeight(state.savedViewport.offsetHeight);
  }
}

function disposeState(id: string): void {
  const state = states.get(id);
  if (!state) {
    return;
  }
  destroyPlot(state);
  state.liveViewportResizeObserver?.disconnect();
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

function titledButton(text: string, title: string, action: () => void): HTMLButtonElement {
  const element = button(text, action);
  element.title = title;
  element.setAttribute('aria-label', title);
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

function labelledSelectOptions(
  label: string,
  values: Array<{ value: string; label: string }>,
  selected: string,
  onChange: (value: string) => void
): HTMLLabelElement {
  const wrapper = node('label', 'kx-control');
  wrapper.append(node('span', '', label));
  const select = document.createElement('select');
  values.forEach(value => {
    const option = document.createElement('option');
    option.value = value.value;
    option.textContent = value.label;
    option.selected = value.value === selected;
    select.append(option);
  });
  select.addEventListener('change', () => onChange(select.value));
  wrapper.append(select);
  return wrapper;
}

function multiColumnControl(
  label: string,
  values: string[],
  selected: string[],
  open: boolean,
  onChange: (column: string, checked: boolean) => void,
  onToggle: (open: boolean) => void
): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'kx-series-control';
  details.open = open;
  const summary = document.createElement('summary');
  summary.textContent = `${label} (${selected.length})`;
  summary.setAttribute('aria-label', `${label} series, ${selected.length} selected`);
  details.append(summary);
  const list = node('div', 'kx-series-list');
  values.forEach(value => {
    const wrapper = node('label', 'kx-series-option');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = selected.includes(value);
    input.addEventListener('change', () => onChange(value, input.checked));
    wrapper.append(input, node('span', '', value));
    list.append(wrapper);
  });
  if (values.length === 0) {
    list.append(node('span', 'kx-meta', 'No numeric series'));
  }
  details.append(list);
  details.addEventListener('toggle', () => onToggle(details.open));
  return details;
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
    includeHeaders: true,
    includeRowIndex: true,
    elapsedTimeDisplay: 'auto',
    chartDecimalPlaces: 4,
    chartMaxSourceRows: 2_000_000,
    chartZoomMaxSampledPoints: CHART_ZOOM_MAX_SAMPLED_POINTS,
    qTextSyntaxHighlighting: false,
    qTextDisplayFormatting: false,
    arrayDisplayFormat: 'commaSpace',
    functionDisplayStrategy: 'qText',
    dictionaryDisplayStrategy: 'grid',
    listDisplayStrategy: 'grid',
    objectDisplayStrategy: 'grid',
  };
}

function notebookChartPointLimit(): number {
  const configured = Number(resultSettings.chartZoomMaxSampledPoints);
  return Math.min(
    MAX_NOTEBOOK_LIVE_CHART_POINTS,
    Number.isSafeInteger(configured) && configured >= 1
      ? configured
      : CHART_ZOOM_MAX_SAMPLED_POINTS
  );
}

const rendererCss = `
.kx-root{box-sizing:border-box;border:1px solid var(--vscode-notebook-cellBorderColor,var(--vscode-panel-border,#555));border-radius:5px;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-family:var(--vscode-font-family,system-ui,sans-serif);font-size:var(--vscode-font-size,13px);padding:8px;max-width:100%}
.kx-header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px}.kx-heading-wrap{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.kx-heading{font-size:1.05em}.kx-meta{color:var(--vscode-descriptionForeground);font-size:.92em}
.kx-toolbar,.kx-live-tools,.kx-chart-controls,.kx-pagination{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.kx-chart-controls{align-items:flex-end}.kx-root button,.kx-root select,.kx-root input{font:inherit;color:var(--vscode-button-secondaryForeground,var(--vscode-foreground));background:var(--vscode-button-secondaryBackground,var(--vscode-editorWidget-background));border:1px solid var(--vscode-button-border,var(--vscode-panel-border,#777));border-radius:3px;padding:3px 7px}.kx-root button:hover:not(:disabled){background:var(--vscode-button-secondaryHoverBackground)}.kx-root button:disabled{opacity:.55}.kx-live-tools input[type=search]{min-width:220px}.kx-tools{position:relative}.kx-tools>summary{cursor:pointer;border:1px solid var(--vscode-panel-border,#777);border-radius:3px;padding:3px 7px;list-style:none}.kx-tools-panel{position:absolute;z-index:20;top:100%;right:0;display:flex;align-items:flex-end;gap:7px;min-width:210px;padding:8px;border:1px solid var(--vscode-panel-border,#555);background:var(--vscode-editorWidget-background);box-shadow:0 4px 14px var(--vscode-widget-shadow,#0008)}
.kx-notice,.kx-panel-mode,.kx-error{margin:7px 0;padding:6px 8px;border-left:3px solid var(--vscode-notificationsWarningIcon-foreground,#cca700);background:var(--vscode-textBlockQuote-background)}.kx-error{border-left-color:var(--vscode-errorForeground,#f14c4c)}
.kx-messages{margin:5px 0;color:var(--vscode-descriptionForeground)}.kx-source{margin:6px 0}.kx-source pre{white-space:pre-wrap;max-height:150px;overflow:auto;background:var(--vscode-textCodeBlock-background);padding:6px}
.kx-qtext{white-space:pre-wrap;max-height:520px;overflow:auto;background:var(--vscode-textCodeBlock-background);padding:8px;border:1px solid var(--vscode-panel-border,#555)}.kx-q-comment{color:var(--vscode-editorCodeLens-foreground)}.kx-q-string,.kx-q-symbol{color:var(--vscode-debugTokenExpression-string)}.kx-q-number,.kx-q-temporal{color:var(--vscode-debugTokenExpression-number)}.kx-q-keyword,.kx-q-command{color:var(--vscode-debugTokenExpression-name);font-weight:600}.kx-q-builtin,.kx-q-system,.kx-q-namespace{color:var(--vscode-symbolIcon-functionForeground)}.kx-q-operator{color:var(--vscode-symbolIcon-operatorForeground)}
.kx-live-viewport{position:relative;overflow:auto;resize:vertical;min-height:72px;max-height:min(75vh,900px);border:1px solid var(--vscode-panel-border,#555);margin:6px 0;contain:strict;box-sizing:border-box;outline:none}.kx-live-viewport:focus{border-color:var(--vscode-focusBorder,#007fd4)}.kx-live-canvas{position:relative;min-width:100%}.kx-live-row{position:absolute;left:0}.kx-live-header-row{z-index:3}.kx-live-cell,.kx-live-empty{box-sizing:border-box;position:absolute;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:4px 7px;border-right:1px solid var(--vscode-panel-border,#555);border-bottom:1px solid var(--vscode-panel-border,#555);background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);user-select:none}.kx-live-empty{color:var(--vscode-descriptionForeground)}button.kx-live-cell{text-align:left;border-radius:0}.kx-live-header{z-index:3;font-weight:600;background:var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-editor-background))}.kx-live-row-index{z-index:2;text-align:right;color:var(--vscode-descriptionForeground);background:var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-editor-background))}.kx-live-corner{z-index:4}.kx-live-cell.is-loading{color:transparent;background:linear-gradient(90deg,var(--vscode-editor-background),var(--vscode-editorWidget-background),var(--vscode-editor-background))}.kx-live-cell.is-selected,.kx-table-wrap td.is-selected{color:var(--vscode-list-activeSelectionForeground,var(--vscode-editor-foreground));background:var(--vscode-list-activeSelectionBackground,#094771);box-shadow:inset 0 0 0 1px var(--vscode-focusBorder,#007fd4)}.kx-live-cell.is-search-match{background:var(--vscode-editor-findMatchHighlightBackground,#ea5c0055)}
.kx-table-tools{margin-top:5px}.kx-table-wrap td.is-search-match{background:var(--vscode-editor-findMatchHighlightBackground,#ea5c0055)}.kx-table-wrap{overflow:auto;resize:vertical;min-height:72px;max-height:min(75vh,900px);border:1px solid var(--vscode-panel-border,#555);margin:6px 0;box-sizing:border-box;outline:none}.kx-table-wrap:focus{border-color:var(--vscode-focusBorder,#007fd4)}.kx-table-wrap table{border-collapse:separate;border-spacing:0;min-width:100%;width:max-content;table-layout:fixed}.kx-table-wrap th,.kx-table-wrap td{box-sizing:border-box;border-right:1px solid var(--vscode-panel-border,#555);border-bottom:1px solid var(--vscode-panel-border,#555);padding:3px 7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;height:var(--kx-row-height,28px)}.kx-table-wrap thead th{position:sticky;top:0;z-index:3;height:max(44px,var(--kx-row-height,28px));background:var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-editor-background))}.kx-table-wrap .kx-saved-row-index{position:sticky;left:0;z-index:2;text-align:right;color:var(--vscode-descriptionForeground);background:var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-editor-background));font-weight:normal}.kx-table-wrap .kx-saved-corner{top:0;z-index:4}.kx-saved-sort{display:block;width:100%;padding:0!important;border:0!important;background:transparent!important;text-align:left;color:inherit!important;font-weight:600}.kx-column-type{display:block;color:var(--vscode-descriptionForeground);font-size:.78em;font-weight:normal}
.kx-control{display:flex;flex-direction:column;gap:2px;color:var(--vscode-descriptionForeground);font-size:.9em}.kx-control select,.kx-control input{color:var(--vscode-foreground);min-width:90px}.kx-series-control{position:relative;color:var(--vscode-descriptionForeground);font-size:.9em}.kx-series-control>summary{cursor:pointer;border:1px solid var(--vscode-panel-border,#777);border-radius:3px;padding:3px 7px;list-style:none}.kx-series-list{position:absolute;z-index:15;top:100%;left:0;display:grid;gap:4px;max-height:220px;min-width:180px;max-width:min(360px,80vw);overflow:auto;padding:7px;border:1px solid var(--vscode-panel-border,#555);background:var(--vscode-editorWidget-background);box-shadow:0 4px 14px var(--vscode-widget-shadow,#0008)}.kx-series-option{display:flex;align-items:center;gap:5px;white-space:nowrap}.kx-series-option span{overflow:hidden;text-overflow:ellipsis}.kx-chart-panel{border-top:1px solid var(--vscode-panel-border,#555);padding-top:7px;margin-top:7px}.kx-chart-host{width:100%;height:280px;margin-top:6px;overflow:hidden;border:1px solid var(--vscode-panel-border,#555);background:var(--vscode-editor-background);box-sizing:border-box}.kx-chart-host .uplot{font-family:var(--vscode-font-family,system-ui,sans-serif);color:var(--vscode-editor-foreground);background:var(--vscode-editor-background)}.kx-chart-host .u-wrap{background:var(--vscode-editor-background)}.kx-chart-host .u-axis,.kx-chart-host .u-legend{color:var(--vscode-descriptionForeground)}.kx-chart-host .u-select{background:var(--vscode-list-activeSelectionBackground,rgba(80,140,220,.22))}.kx-chart-host .u-cursor-x,.kx-chart-host .u-cursor-y{border-color:var(--vscode-focusBorder,#607d8b)}.kx-chart-host .u-legend{margin:0;text-align:left;font:inherit}.kx-status{min-height:1.2em;margin-top:5px;color:var(--vscode-descriptionForeground);font-size:.9em}.kx-empty{padding:8px;color:var(--vscode-descriptionForeground)}
.kx-settings{position:relative}.kx-settings>summary{cursor:pointer;border:1px solid var(--vscode-panel-border,#777);border-radius:3px;padding:3px 7px;list-style:none}.kx-settings-panel{position:absolute;right:0;z-index:20;display:grid;grid-template-columns:repeat(2,minmax(130px,1fr));gap:7px;width:min(430px,80vw);padding:9px;border:1px solid var(--vscode-panel-border,#555);background:var(--vscode-editorWidget-background);box-shadow:0 4px 18px #0006}.kx-setting-checkbox{display:flex;align-items:center;gap:5px;font-size:.9em}
`;
