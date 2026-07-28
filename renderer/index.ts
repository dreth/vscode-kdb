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
  chartRequestIsCurrent,
  chartZoomRangeKey,
  isValidChartRange,
  planChartAutoRefine,
} from '../src/chart-zoom';
import {
  chartLegendToggleKey,
  chartSeriesColorIndexes,
  chartSeriesVisible,
  updateHiddenChartSeriesKeys,
} from '../src/chart-series-state';
import {
  ColumnarPanelResult,
  ExportFormat,
  createColumnarPanelResult,
  sortedColumnarRowOrder,
} from '../src/kx-results';
import {
  KX_NOTEBOOK_MIME,
  MAX_NOTEBOOK_BYTE_LIMIT,
  NotebookChartSpec,
  NotebookChartType,
  PortableKxResult,
  PortableKxTableResult,
  notebookSavedPreviewNotice,
  portableCellValue,
  portableCellText,
  validatePortableKxResult,
} from '../src/notebook-contract';
import {
  NotebookCellSelection,
  NotebookSavedSearchMatch,
  notebookCellSelected,
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
  notebookSelectionForColumn,
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
  NOTEBOOK_OUTPUT_BINDING_METADATA_KEY,
  NotebookLiveChartData,
  NotebookLiveChartType,
  NotebookLiveCopyFormat,
  NotebookLiveResultMetadata,
  NotebookLiveSortDirection,
  NotebookRendererHostMessage,
  NotebookSharedKxResultSettings,
  NotebookResultSettingKey,
  parseNotebookLiveResultReference,
  parseNotebookOutputBindingReference,
  parseNotebookRendererHostMessage,
} from '../src/notebook-message';
import { qTextRenderModel } from '../src/q-text';
import {
  KX_RESULT_CHART_TYPE_OPTIONS,
  KX_RESULT_EXPORT_FORMATS,
  KX_RESULT_SETTING_DEFINITIONS,
  KX_RESULT_UI_LABELS,
  KX_RESULTS_SHARED_CSS,
  kxLiveResultSummary,
  kxResultSelectionSummary,
  kxSavedPreviewSummary,
  moveKxResultColumn,
} from '../src/results-ui-contract';

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
  fullData?: NotebookLiveChartData;
  fullRange?: PlotScaleRange;
  requestRange?: { min: number; max: number };
  autoRefineTimer?: number;
  lastAutoRefineRangeKey: string;
  syncAutoRefineRangeOnNextPlot: boolean;
  refined: boolean;
  error?: string;
  errorWasRefinement?: boolean;
}

interface PlotScaleRange {
  min: number;
  max: number;
}

interface PlotViewportState {
  data: NotebookLiveChartData;
  x?: PlotScaleRange;
  y?: PlotScaleRange;
}

interface SavedPreparedChartState {
  signature: string;
  data?: NotebookLiveChartData;
  error?: string;
}

interface RerenderFocusState {
  key: string;
  selectionStart?: number;
  selectionEnd?: number;
}

interface OutputState {
  id: string;
  outputId?: string;
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
  plotData?: NotebookLiveChartData;
  plotViewport?: PlotViewportState;
  plotResizeObserver?: ResizeObserver;
  plotThemeObserver?: MutationObserver;
  savedPreparedChart?: SavedPreparedChartState;
  panelOpened: boolean;
  liveId?: string;
  liveStatus: LiveStatus;
  liveRequestId: number;
  liveMode?: 'table' | 'text';
  liveKind?: string;
  liveAllColumns: string[];
  liveTotalColumnCount: number;
  liveColumns: string[];
  liveColumnOrder: number[];
  liveHiddenColumnIndexes: number[];
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
  liveOpenRequestId: number;
  liveActionFormat: ExportFormat;
  liveCopyMessage?: string;
  liveCopyButtons?: HTMLButtonElement[];
  liveCopyTools?: HTMLDetailsElement;
  liveCopyStatus?: HTMLElement;
  liveSelectionStatus?: HTMLElement;
  savedSelection?: NotebookCellSelection;
  savedActionFormat: ExportFormat;
  savedColumnOrder: number[];
  savedHiddenColumnIndexes: number[];
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
  hostActionRequestId: number;
  hostActionMessage?: string;
  openDetailsKeys: string[];
  rerenderFocus?: RerenderFocusState;
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
const LIVE_CHART_AUTO_REFINE_DELAY_MS = 450;
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
      const outputBinding = outputBindingReference(outputItem);
      const state: OutputState = {
        id: outputItem.id,
        outputId: outputBinding?.id,
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
        liveStatus: liveReference
          ? (outputBinding ? 'requesting' : 'unavailable')
          : 'none',
        liveRequestId: 0,
        liveAllColumns: [],
        liveTotalColumnCount: 0,
        liveColumns: [],
        liveColumnOrder: [],
        liveHiddenColumnIndexes: [],
        liveRowCount: 0,
        liveChartXColumns: [],
        liveChartYColumns: [],
        liveChartGroupColumns: [],
        liveSliceRequestId: 0,
        liveScrollTop: 0,
        liveScrollLeft: 0,
        liveCopyRequestId: 0,
        liveOpenRequestId: 0,
        liveActionFormat: 'csv',
        savedScrollTop: 0,
        savedScrollLeft: 0,
        savedColumnOrder: payload.kind === 'table'
          ? payload.schema.columns.map((_column, index) => index)
          : [],
        savedHiddenColumnIndexes: [],
        savedSearch: emptySavedSearch(),
        savedActionFormat: 'csv',
        liveSearch: emptyLiveSearch(),
        liveChart: emptyLiveChart(),
        liveChartYOpen: false,
        plotSeriesKeys: [],
        hiddenChartSeriesKeys: [],
        hostActionRequestId: 0,
        openDetailsKeys: [],
        ...(liveReference && !outputBinding
          ? {
            liveMessage:
              'Live result binding unavailable. Showing the bounded saved preview.',
          }
          : {}),
      };
      states.set(outputItem.id, state);
      renderState(context, state);
      if (state.liveId && state.outputId) {
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
    const chartMaxPointLimitChanged =
      previous.chartZoomMaxSampledPoints !== resultSettings.chartZoomMaxSampledPoints;
    const chartSourceLimitChanged =
      previous.chartMaxSourceRows !== resultSettings.chartMaxSourceRows;
    const chartMinPointLimitChanged =
      previous.chartZoomMinSampledPoints !== resultSettings.chartZoomMinSampledPoints;
    const liveChartSamplingChanged =
      chartMaxPointLimitChanged || chartSourceLimitChanged || chartMinPointLimitChanged;
    states.forEach(state => {
      if (chartMaxPointLimitChanged) {
        const maxPoints = notebookChartPointLimit();
        state.savedMaxChartPoints = maxPoints;
        if (state.liveChart.maxPoints !== maxPoints) {
          state.liveChart.maxPoints = maxPoints;
        }
      }
      if (chartMaxPointLimitChanged || chartSourceLimitChanged) {
        state.savedPreparedChart = undefined;
      }
      if (liveChartSamplingChanged) {
        markLiveChartDirty(state.liveChart);
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

  if (message.type === 'actionResult') {
    states.forEach(state => {
      if (state.hostActionRequestId === message.requestId) {
        state.hostActionMessage = message.message;
        renderState(context, state);
      }
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
      if (!chartRequestIsCurrent(state.liveChart.requestId, message.requestId)) {
        continue;
      }
      state.liveChart.pending = false;
      if (message.data) {
        if (state.liveChart.requestRange) {
          state.liveChart.fullData = state.liveChart.fullData || state.liveChart.data;
          state.liveChart.syncAutoRefineRangeOnNextPlot = true;
          state.liveChart.refined = true;
        } else {
          state.liveChart.fullData = message.data;
          state.liveChart.fullRange = chartDataXRange(message.data);
          state.liveChart.lastAutoRefineRangeKey = '';
          state.liveChart.syncAutoRefineRangeOnNextPlot = false;
          state.liveChart.refined = false;
        }
        state.liveChart.data = message.data;
      }
      state.liveChart.dirty =
        state.liveChart.requestSignature !== liveChartConfigurationSignature(state.liveChart);
      state.liveChart.errorWasRefinement =
        !!message.error && !!state.liveChart.requestRange;
      state.liveChart.requestRange = undefined;
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
  if (!message.available) {
    if (!isOutstandingLiveRequest(state, message.requestId)) {
      return;
    }
    transitionLiveResultUnavailable(state, message.message);
    renderState(context, state);
    return;
  }
  if (message.requestId !== state.liveRequestId) {
    return;
  }
  const previousChart = state.liveChart;
  clearLiveChartAutoRefine(previousChart, true);
  state.liveStatus = 'available';
  state.liveMode = message.mode;
  state.liveKind = message.kind;
  const previousOrderNames = state.liveColumnOrder
    .map(index => state.liveAllColumns[index])
    .filter((name): name is string => typeof name === 'string');
  const previousHiddenNames = new Set(
    state.liveHiddenColumnIndexes
      .map(index => state.liveAllColumns[index])
      .filter((name): name is string => typeof name === 'string')
  );
  state.liveAllColumns = message.columns || [];
  state.liveTotalColumnCount = message.totalColumnCount ?? state.liveAllColumns.length;
  state.liveColumnOrder = reconciledColumnOrder(state.liveAllColumns, previousOrderNames);
  state.liveHiddenColumnIndexes = state.liveAllColumns
    .map((_name, index) => index)
    .filter(index => previousHiddenNames.has(state.liveAllColumns[index]));
  syncLiveVisibleColumns(state);
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
  const visibleChartColumns = liveChartColumns(state);
  const reconciledChart = reconcileNotebookChartConfiguration(
    previousChart,
    visibleChartColumns.x,
    visibleChartColumns.numeric,
    visibleChartColumns.group
  );
  state.liveChart = {
    ...previousChart,
    ...reconciledChart.configuration,
    maxPoints: notebookChartPointLimit(),
    requestId: nextRequestId(),
    requestSignature: reconciledChart.compatible
      ? previousChart.requestSignature
      : undefined,
    pending: false,
    dirty: reconciledChart.compatible ? previousChart.dirty : true,
    data: reconciledChart.compatible ? previousChart.data : undefined,
    fullData: reconciledChart.compatible ? previousChart.fullData : undefined,
    fullRange: reconciledChart.compatible ? previousChart.fullRange : undefined,
    requestRange: undefined,
    autoRefineTimer: undefined,
    lastAutoRefineRangeKey: reconciledChart.compatible
      ? previousChart.lastAutoRefineRangeKey
      : '',
    syncAutoRefineRangeOnNextPlot: reconciledChart.compatible
      ? previousChart.syncAutoRefineRangeOnNextPlot
      : false,
    refined: reconciledChart.compatible ? previousChart.refined : false,
    error: undefined,
    errorWasRefinement: false,
  };
  renderState(context, state);
}

function isOutstandingLiveRequest(state: OutputState, requestId: number): boolean {
  return requestId === state.liveRequestId ||
    requestId === state.liveSliceRequestId ||
    requestId === state.liveSearch.requestId ||
    requestId === state.liveChart.requestId ||
    requestId === state.liveCopyRequestId ||
    requestId === state.liveOpenRequestId ||
    requestId === state.hostActionRequestId;
}

function transitionLiveResultUnavailable(state: OutputState, message?: string): void {
  if (state.searchTimer !== undefined) {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = undefined;
  }
  clearLiveChartAutoRefine(state.liveChart, true);
  state.liveStatus = 'unavailable';
  state.liveRequestId = nextRequestId();
  state.liveMode = undefined;
  state.liveKind = undefined;
  state.liveAllColumns = [];
  state.liveTotalColumnCount = 0;
  state.liveColumns = [];
  state.liveColumnOrder = [];
  state.liveHiddenColumnIndexes = [];
  state.liveRowCount = 0;
  state.liveChartXColumns = [];
  state.liveChartYColumns = [];
  state.liveChartGroupColumns = [];
  state.liveText = undefined;
  state.liveMetadata = undefined;
  state.liveMessage = message || 'Result unavailable. Showing the bounded saved preview.';
  state.liveSlice = undefined;
  state.liveSliceError = undefined;
  state.liveSliceRequestId = nextRequestId();
  state.liveScrollTop = 0;
  state.liveScrollLeft = 0;
  state.liveSortColumn = undefined;
  state.liveSortDirection = undefined;
  state.liveSelection = undefined;
  state.liveSearch = emptyLiveSearch();
  state.liveChart = {
    ...state.liveChart,
    requestId: nextRequestId(),
    requestSignature: undefined,
    pending: false,
    dirty: true,
    data: undefined,
    fullData: undefined,
    fullRange: undefined,
    requestRange: undefined,
    autoRefineTimer: undefined,
    lastAutoRefineRangeKey: '',
    syncAutoRefineRangeOnNextPlot: false,
    refined: false,
    error: undefined,
    errorWasRefinement: false,
  };
  state.liveCopyRequestId = nextRequestId();
  state.liveOpenRequestId = nextRequestId();
  state.liveCopyMessage = undefined;
  state.hostActionRequestId = nextRequestId();
  state.hostActionMessage = undefined;
  state.plotData = undefined;
  state.plotViewport = undefined;
  state.panelOpened = false;
}

function renderState(context: RendererContext<RendererState>, state: OutputState): void {
  captureRerenderUiState(state);
  captureViewportState(state);
  destroyPlot(state);
  state.liveViewportResizeObserver?.disconnect();
  state.liveViewportResizeObserver = undefined;
  state.liveViewport = undefined;
  state.liveCanvas = undefined;
  state.savedViewport = undefined;
  state.liveCopyButtons = undefined;
  state.liveCopyTools = undefined;
  state.liveCopyStatus = undefined;
  state.liveSelectionStatus = undefined;
  state.element.replaceChildren();
  const root = node('section', 'kx-results-surface kx-results-notebook-host kx-root');
  root.classList.add(`kx-density-${resultSettings.density}`);
  if (resultSettings.fontSize > 0) {
    root.style.fontSize = `${resultSettings.fontSize}px`;
  }
  root.setAttribute('aria-label', 'KX q notebook result');
  state.element.append(root);

  renderHeader(context, state, root);
  if (usePanelOnlyPresentation(state)) {
    renderPanelOnly(context, state, root);
    restoreRerenderFocus(state);
    return;
  }

  if (state.liveStatus === 'available') {
    renderLiveResult(context, state, root);
  } else {
    renderSavedResult(context, state, root);
  }
  restoreRerenderFocus(state);
}

function renderHeader(
  context: RendererContext<RendererState>,
  state: OutputState,
  root: HTMLElement
): void {
  const header = node('header', 'kx-header');
  const headingWrap = node('div', 'kx-heading-wrap');
  headingWrap.append(node('strong', 'kx-heading', KX_RESULT_UI_LABELS.title));
  const label = state.liveMetadata?.connectionName || state.payload.provenance.label;
  if (label) {
    headingWrap.append(node('span', 'kx-meta', label));
  }
  const elapsed = state.liveMetadata?.elapsedMs ?? state.payload.provenance.elapsedMs;
  if (elapsed !== undefined) {
    headingWrap.append(node('span', 'kx-meta', formatElapsed(elapsed)));
  }
  const stateBadge = node('span', 'kx-state-badge', notebookResultStateSummary(state));
  if (state.liveStatus === 'available') {
    stateBadge.classList.add('is-live');
  }
  headingWrap.append(stateBadge);
  if (state.liveKind && state.liveStatus === 'available') {
    headingWrap.append(node('span', 'kx-meta kx-kind', state.liveKind));
  }
  if (state.liveStatus === 'available' && state.payload.kind === 'table' &&
    state.payload.result.truncated) {
    headingWrap.append(node(
      'span',
      'kx-meta',
      `Saved copy: ${state.payload.result.previewRowCount.toLocaleString()} of ` +
        `${state.payload.result.rowCount.toLocaleString()} rows`
    ));
  }
  header.append(headingWrap);

  const toolbar = node('div', 'kx-toolbar');
  if (state.liveStatus === 'available' && state.liveId && state.outputId &&
    context.postMessage) {
    const openFull = titledButton(
      KX_RESULT_UI_LABELS.openFullResult,
      KX_RESULT_UI_LABELS.openFullResult,
      () => {
        requestOpenLiveResult(context, state);
      }
    );
    toolbar.append(withFocusKey(openFull, 'header:open-live'));
  } else if (context.postMessage) {
    const openSaved = titledButton(
      KX_RESULT_UI_LABELS.openSavedPreview,
      'Open the bounded saved preview in KX Results',
      () => {
        openPreview(context, state, statusNode(root));
      }
    );
    const helperPreview = state.payload.provenance.marker === '%%q';
    const rerun = titledButton(
      helperPreview
        ? KX_RESULT_UI_LABELS.runSavedQResultLive
        : KX_RESULT_UI_LABELS.rerunCell,
      helperPreview
        ? 'Run the %%q body as a new first-party KX Direct IPC execution; the Python kernel stays selected'
        : 'Rerun this first-party Direct IPC cell',
      () => requestPreviewRerun(context, state)
    );
    toolbar.append(
      withFocusKey(openSaved, 'header:open-saved'),
      withFocusKey(rerun, 'header:rerun')
    );
  }
  if (context.postMessage) {
    toolbar.append(resultSettingsControl(context, state));
  }
  header.append(toolbar);
  root.append(header);
  if (state.hostActionMessage) {
    const status = node('div', 'kx-status', state.hostActionMessage);
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    root.append(status);
  }
}

function renderPanelOnly(
  context: RendererContext<RendererState>,
  state: OutputState,
  root: HTMLElement
): void {
  const status = node('div', 'kx-status');
  root.append(status);
  if (state.panelOpened || !context.postMessage) {
    return;
  }
  if (state.liveId && state.liveStatus === 'requesting') {
    status.textContent = 'Checking the live result before opening KX Results…';
    return;
  }
  state.panelOpened = true;
  if (state.liveStatus === 'available' && state.liveId && state.outputId) {
    requestOpenLiveResult(context, state);
    status.textContent = 'Opening the live full result in KX Results…';
  } else {
    openPreview(context, state, status);
  }
}

function renderLiveResult(
  context: RendererContext<RendererState>,
  state: OutputState,
  root: HTMLElement
): void {
  if (presentation === 'both' && state.payload.provenance.marker !== 'direct-ipc' &&
    !state.panelOpened && context.postMessage && state.liveId && state.outputId) {
    state.panelOpened = true;
    requestOpenLiveResult(context, state);
  }
  if (state.liveMetadata?.messages?.length) {
    const messages = node('div', 'kx-messages');
    state.liveMetadata.messages.forEach(message => messages.append(node('div', '', message)));
    root.append(messages);
  }
  if (state.liveMessage) {
    const status = node('div', 'kx-status', state.liveMessage);
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    root.append(status);
  }
  if (state.liveSliceError) {
    const status = node('div', 'kx-status', state.liveSliceError);
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    root.append(status);
  }

  if (state.liveMode === 'text') {
    renderLiveText(context, state, root);
  } else {
    renderLiveTableTools(context, state, root);
    renderLiveGrid(context, state, root);
    if (state.liveChart.visible) {
      renderLiveChart(context, state, root);
    }
  }
  renderSource(state, root);
}

function renderLiveText(
  context: RendererContext<RendererState>,
  state: OutputState,
  root: HTMLElement
): void {
  const status = node('span', 'kx-meta');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const toolbar = node('div', 'kx-toolbar kx-saved-toolbar');
  const copyButton = button(KX_RESULT_UI_LABELS.copy, () => {
    if (!context.postMessage || !state.liveId || !state.outputId) {
      return;
    }
    const requestId = nextRequestId();
    state.hostActionRequestId = requestId;
    state.hostActionMessage = 'Copying the full live qText result…';
    context.postMessage({
      type: 'copyLiveText',
      outputId: state.outputId,
      liveId: state.liveId,
      requestId,
    });
    renderState(context, state);
  });
  copyButton.disabled = !context.postMessage || !state.liveId || !state.outputId;
  toolbar.append(copyButton);
  const exportButton = button(KX_RESULT_UI_LABELS.export, () => {
    if (!context.postMessage || !state.liveId || !state.outputId) {
      return;
    }
    const requestId = nextRequestId();
    state.hostActionRequestId = requestId;
    state.hostActionMessage = 'Choosing a text export destination…';
    context.postMessage({
      type: 'exportLiveText',
      outputId: state.outputId,
      liveId: state.liveId,
      requestId,
    });
    renderState(context, state);
  });
  exportButton.disabled = !context.postMessage || !state.liveId || !state.outputId;
  toolbar.append(exportButton, status);
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
  const primary = node('div', 'kx-primary-toolbar');
  primary.setAttribute('role', 'toolbar');
  primary.setAttribute('aria-label', 'KX result actions');
  const output = node('div', 'kx-output-group');
  output.append(node('span', 'kx-toolbar-label', KX_RESULT_UI_LABELS.output));
  const formatSelect = resultFormatSelect(
    state.liveActionFormat,
    value => {
      state.liveActionFormat = value;
      renderState(context, state);
    },
    'toolbar:live:format'
  );
  output.append(formatSelect);
  output.append(settingToggle(
    KX_RESULT_UI_LABELS.headers,
    resultSettings.includeHeaders,
    checked => updateResultSetting(context, 'includeHeaders', checked),
    'toolbar:live:headers'
  ));
  output.append(settingToggle(
    KX_RESULT_UI_LABELS.rowIndex,
    resultSettings.includeRowIndex,
    checked => updateResultSetting(context, 'includeRowIndex', checked),
    'toolbar:live:row-index'
  ));
  const actionRange = notebookSelectionRange(state.liveSelection) || {
    startRow: 0,
    endRow: Math.max(0, state.liveRowCount - 1),
    startColumn: 0,
    endColumn: Math.max(0, state.liveColumns.length - 1),
  };
  const selectedCellCount = state.liveRowCount === 0 || state.liveColumns.length === 0
    ? 0
    : (actionRange.endRow - actionRange.startRow + 1) *
      (actionRange.endColumn - actionRange.startColumn + 1);
  const copy = button(KX_RESULT_UI_LABELS.copy, () => {
    if (state.liveActionFormat !== 'xlsx') {
      requestLiveCopy(context, state, state.liveActionFormat);
    }
  });
  withFocusKey(copy, 'toolbar:live:copy');
  copy.disabled = state.liveActionFormat === 'xlsx' ||
    selectedCellCount === 0 || selectedCellCount > LIVE_CLIPBOARD_CELL_LIMIT;
  copy.title = state.liveActionFormat === 'xlsx'
    ? 'XLSX is export-only.'
    : selectedCellCount > LIVE_CLIPBOARD_CELL_LIMIT
      ? `Inline copy is limited to ${LIVE_CLIPBOARD_CELL_LIMIT.toLocaleString()} cells.`
      : 'Copy the selected range, or all visible columns when nothing is selected.';
  const exportButton = button(KX_RESULT_UI_LABELS.export, () => {
    requestLiveExport(context, state, state.liveActionFormat);
  });
  withFocusKey(exportButton, 'toolbar:live:export');
  exportButton.disabled = selectedCellCount === 0;
  output.append(copy, exportButton);
  primary.append(output);
  const liveChartCandidates = liveChartColumns(state);
  if (state.liveChart.visible ||
    (liveChartCandidates.x.length > 0 && liveChartCandidates.numeric.length > 0)) {
    const chartToggle = button(state.liveChart.visible
      ? KX_RESULT_UI_LABELS.closeChart
      : KX_RESULT_UI_LABELS.chart, () => {
      state.liveChart.visible = !state.liveChart.visible;
      if (!state.liveChart.visible) {
        clearLiveChartAutoRefine(state.liveChart);
      }
      renderState(context, state);
    });
    withFocusKey(chartToggle, 'toolbar:live:chart-toggle');
    primary.append(chartToggle);
  }
  primary.append(resultColumnControl(context, state, 'live'));
  const selectionStatus = node(
    'span',
    'kx-selection-summary',
    kxResultSelectionSummary(notebookSelectionRange(state.liveSelection))
  );
  selectionStatus.setAttribute('role', 'status');
  selectionStatus.setAttribute('aria-live', 'polite');
  state.liveSelectionStatus = selectionStatus;
  primary.append(selectionStatus);
  root.append(primary);

  const tools = node('div', 'kx-live-tools kx-view-tools');
  const input = document.createElement('input');
  withFocusKey(input, 'search:live:input');
  input.type = 'search';
  input.maxLength = MAX_NOTEBOOK_LIVE_SEARCH_CHARS;
  input.placeholder = KX_RESULT_UI_LABELS.searchRows;
  input.setAttribute('aria-label', 'Search result rows');
  input.disabled = state.liveColumns.length === 0;
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
  const previous = button(KX_RESULT_UI_LABELS.previousMatch, () =>
    moveLiveSearchMatch(context, state, -1));
  const next = button(KX_RESULT_UI_LABELS.nextMatch, () =>
    moveLiveSearchMatch(context, state, 1));
  withFocusKey(previous, 'search:live:previous');
  withFocusKey(next, 'search:live:next');
  previous.disabled = state.liveSearch.matches.length === 0;
  next.disabled = state.liveSearch.matches.length === 0;
  tools.append(input, previous, next, searchStatus);
  state.liveCopyButtons = [copy];
  state.liveCopyTools = undefined;
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
    root.append(node('div', 'kx-empty', 'No visible columns. Use Columns to restore them.'));
    return;
  }
  const viewport = node('div', 'kx-live-viewport');
  withFocusKey(viewport, 'grid:live:viewport');
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
    const corner = button('#', () => {
      if (state.liveRowCount > 0 && state.liveColumns.length > 0) {
        state.liveSelection = {
          anchorRow: 0,
          anchorColumn: 0,
          focusRow: state.liveRowCount - 1,
          focusColumn: state.liveColumns.length - 1,
        };
        updateLiveSelectionClasses(state);
      }
    });
    corner.className = 'kx-live-cell kx-live-header kx-live-corner';
    corner.setAttribute('aria-label', 'Select all result cells');
    placeLiveCell(corner, state.liveScrollLeft, 0, LIVE_ROW_INDEX_WIDTH, LIVE_HEADER_HEIGHT);
    row.append(corner);
  }
  for (let columnIndex = startColumn; columnIndex <= endColumn; columnIndex++) {
    const columnName = state.liveColumns[columnIndex];
    const label = state.liveSortColumn === columnName
      ? `${columnName} ${state.liveSortDirection === 'asc' ? '▲' : '▼'}`
      : columnName;
    const header = button(label, event => {
      if (event.shiftKey) {
        state.liveSelection = notebookSelectionForColumn(
          state.liveSelection,
          columnIndex,
          state.liveRowCount,
          true
        );
        state.liveCopyMessage = undefined;
        updateLiveSelectionClasses(state);
        event.preventDefault();
        return;
      }
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
    withFocusKey(header, `grid:live:sort:${columnName}`);
    header.className = 'kx-live-cell kx-live-header';
    header.setAttribute('role', 'columnheader');
    header.setAttribute('aria-colindex', String(columnIndex + 1));
    header.setAttribute(
      'aria-sort',
      state.liveSortColumn === columnName
        ? state.liveSortDirection === 'asc' ? 'ascending' : 'descending'
        : 'none'
    );
    header.title = `Sort by ${columnName}; Shift+click selects a column range`;
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
      const index = button(String(rowIndex + 1), () => {
        if (state.liveColumns.length > 0) {
          state.liveSelection = {
            anchorRow: rowIndex,
            anchorColumn: 0,
            focusRow: rowIndex,
            focusColumn: state.liveColumns.length - 1,
          };
          updateLiveSelectionClasses(state);
        }
      });
      index.className = 'kx-live-cell kx-live-row-index';
      index.setAttribute('role', 'rowheader');
      index.setAttribute('aria-label', `Select row ${rowIndex + 1}`);
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
      cell.setAttribute(
        'aria-label',
        `${state.liveColumns[columnIndex]}, row ${rowIndex + 1}, ${value ?? 'Loading'}`
      );
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
  if (!context.postMessage || !state.liveId || !state.outputId ||
    state.liveStatus !== 'available' ||
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
    outputId: state.outputId,
    liveId: state.liveId,
    requestId,
    startRow: window.startRow,
    endRow: window.endRow,
    startColumn: window.startColumn,
    endColumn: window.endColumn,
    columnIndexes: visibleLiveColumnIndexes(state)
      .slice(window.startColumn, window.endColumn + 1),
    ...liveSortFields(state),
  });
}

function renderLiveChart(
  context: RendererContext<RendererState>,
  state: OutputState,
  root: HTMLElement
): void {
  const chart = state.liveChart;
  const candidates = liveChartColumns(state);
  const controlModel = notebookChartControlModel(
    chart,
    candidates.x,
    candidates.numeric,
    candidates.group
  );
  const capabilities = controlModel.capabilities;
  const panel = node('div', 'kx-chart-panel');
  const controls = node('div', 'kx-chart-controls');
  controls.append(labelledSelectOptions(
    'Chart type',
    [...KX_RESULT_CHART_TYPE_OPTIONS],
    chart.chartType,
    value => {
      chart.chartType = value as NotebookLiveChartType;
      markLiveChartDirty(chart);
      renderState(context, state);
    },
    'chart:live:type'
  ));
  controls.append(labelledSelect(
    'X',
    candidates.x,
    chart.xColumn,
    value => {
      chart.xColumn = value;
      chart.yColumns = reconcileNotebookChartYColumns(
        candidates.numeric,
        value,
        chart.yColumns
      );
      markLiveChartDirty(chart);
      renderState(context, state);
    },
    'chart:live:x'
  ));
  if (capabilities.usesGenericY) {
    controls.append(multiColumnControl(
      'Y',
      controlModel.yColumns,
      chart.yColumns,
      state.liveChartYOpen,
      (column, checked) => {
        chart.yColumns = toggleNotebookChartYColumn(
          candidates.numeric,
          chart.xColumn,
          chart.yColumns,
          column,
          checked
        );
        markLiveChartDirty(chart);
        renderState(context, state);
      },
      open => { state.liveChartYOpen = open; },
      'chart:live:y',
      seriesSelectorSwatches(controlModel.yColumns, chart.data, root)
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
      },
      'chart:live:group'
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
        },
        `chart:live:${key}`
      ));
    });
  }
  const render = button(KX_RESULT_UI_LABELS.renderChart, () => {
    requestLiveChart(context, state);
    renderState(context, state);
  });
  withFocusKey(render, 'chart:live:render');
  render.disabled = chart.pending || !!liveChartValidationMessage(state) ||
    (!!chart.error && !chart.dirty && !chart.errorWasRefinement);
  controls.append(render);
  const exportPng = button(KX_RESULT_UI_LABELS.exportChartPng, () => {
    requestChartPngExport(context, state);
    renderState(context, state);
  });
  withFocusKey(exportPng, 'chart:live:export-png');
  exportPng.disabled = !chart.data || !state.plot;
  controls.append(exportPng);
  const reset = button(KX_RESULT_UI_LABELS.resetZoom, () => {
    clearLiveChartAutoRefine(chart, true);
    if (chart.pending && chart.requestRange) {
      chart.requestId = nextRequestId();
      chart.pending = false;
      chart.requestRange = undefined;
      chart.syncAutoRefineRangeOnNextPlot = false;
      chart.error = undefined;
      chart.errorWasRefinement = false;
    }
    if (chart.refined && chart.fullData) {
      chart.data = chart.fullData;
      chart.refined = false;
      renderState(context, state);
      return;
    }
    resetPlotZoom(state);
  });
  withFocusKey(reset, 'chart:live:reset');
  reset.disabled = !chart.data;
  controls.append(reset);
  const refine = button(KX_RESULT_UI_LABELS.refineZoom, () => {
    const range = currentPlotXRange(state);
    if (!range) {
      chart.error = 'Zoom the chart before refining.';
      chart.errorWasRefinement = true;
      renderState(context, state);
      return;
    }
    requestLiveChart(context, state, range);
    renderState(context, state);
  });
  withFocusKey(refine, 'chart:live:refine');
  refine.disabled = chart.pending || !chart.data || chart.dirty || !state.plot;
  controls.append(refine);
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
    status.textContent = `${chart.refined ? 'Refined zoom • ' : ''}${liveChartDataStatus(chart.data)}`;
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
    drawLiveChart(context, state, host, chart.data);
    const hasPlot = !!state.plot;
    exportPng.disabled = !hasPlot;
    reset.disabled = !hasPlot;
    refine.disabled = chart.pending || !hasPlot || chart.dirty;
  } else {
    root.append(panel);
  }
}

function markLiveChartDirty(chart: LiveChartState): void {
  clearLiveChartAutoRefine(chart, true);
  chart.dirty = true;
  chart.error = undefined;
  chart.errorWasRefinement = false;
}

function liveChartValidationMessage(state: OutputState): string {
  const candidates = liveChartColumns(state);
  return notebookChartControlModel(
    state.liveChart,
    candidates.x,
    candidates.numeric,
    candidates.group
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
  state: OutputState,
  range?: { min: number; max: number }
): void {
  const chart = state.liveChart;
  clearLiveChartAutoRefine(chart);
  if (!context.postMessage || !state.liveId || !state.outputId ||
    liveChartValidationMessage(state)) {
    return;
  }
  chart.lastAutoRefineRangeKey = range ? chartZoomRangeKey(range) : '';
  const requestId = nextRequestId();
  chart.requestId = requestId;
  chart.requestSignature = liveChartConfigurationSignature(chart);
  chart.pending = true;
  chart.error = undefined;
  chart.errorWasRefinement = false;
  chart.requestRange = range;
  if (!range) {
    chart.fullData = undefined;
    chart.fullRange = undefined;
    chart.refined = false;
  }
  const capabilities = chartTypeCapabilities(chart.chartType);
  context.postMessage({
    type: 'requestLiveChart',
    outputId: state.outputId,
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
    ...(range ? { xMin: range.min, xMax: range.max } : {}),
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
    chart.maxPoints,
    resultSettings.chartMaxSourceRows,
    resultSettings.chartZoomMinSampledPoints,
  ]);
}

function drawLiveChart(
  context: RendererContext<RendererState>,
  state: OutputState,
  host: HTMLElement,
  data: NotebookLiveChartData
): void {
  drawNotebookChart(context, state, host, data, true);
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
  if (!context.postMessage || !state.liveId || !state.outputId ||
    state.liveMode !== 'table' ||
    state.liveColumns.length === 0) {
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
    outputId: state.outputId,
    liveId: state.liveId,
    requestId,
    query,
    columnIndexes: visibleLiveColumnIndexes(state),
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
  status.setAttribute('aria-live', 'polite');
  if (state.liveStatus === 'unavailable') {
    root.append(node(
      'div',
      'kx-notice',
      `${state.liveMessage || 'The live result is no longer available.'} ` +
      'Showing the bounded saved preview only. Rerun the cell to restore a live full result.'
    ));
  } else if (state.liveStatus === 'requesting') {
    root.append(node(
      'div',
      'kx-notice',
      'Checking the session-bound live result. The bounded saved preview is shown meanwhile.'
    ));
  }
  if (presentation === 'both' && state.payload.provenance.marker !== 'direct-ipc' &&
    state.liveStatus !== 'requesting' && !state.panelOpened && context.postMessage) {
    state.panelOpened = true;
    openPreview(context, state, status);
  }

  if (state.payload.kind === 'qText') {
    const toolbar = node('div', 'kx-toolbar kx-saved-toolbar');
    toolbar.append(button(KX_RESULT_UI_LABELS.copy, () => {
      void copyText(state.payload.kind === 'qText' ? state.payload.data.text : '').then(
        () => { status.textContent = 'Copied.'; },
        () => { status.textContent = 'Clipboard unavailable.'; }
      );
    }));
    const exportButton = button(KX_RESULT_UI_LABELS.export, () => {
      if (!context.postMessage) {
        return;
      }
      const requestId = nextRequestId();
      state.hostActionRequestId = requestId;
      state.hostActionMessage = 'Choosing a text export destination…';
      context.postMessage({
        type: 'exportPreviewText',
        ...(state.outputId ? { outputId: state.outputId } : {}),
        payload: state.payload,
        requestId,
      });
      renderState(context, state);
    });
    exportButton.disabled = !context.postMessage;
    toolbar.append(exportButton);
    root.append(toolbar);
    renderPortableText(state.payload.data.text, 'qText result', root);
    if (state.payload.result.truncated) {
      root.append(node(
        'div',
        'kx-notice',
        notebookSavedPreviewNotice(state.payload)
      ));
    }
    renderSource(state, root);
    root.append(status);
    return;
  }
  const result = state.payload.result;
  if (result.truncated) {
    root.append(node(
      'div',
      'kx-notice',
      notebookSavedPreviewNotice(state.payload)
    ));
  }
  renderSavedTable(context, state, root);
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
  const visibleColumns = visibleSavedColumnIndexes(state);
  const currentActionCellCount = () =>
    savedActionCellCount(state, payload, visibleColumns.length);
  const copySelection = (format: NotebookLiveCopyFormat): void =>
    requestSavedCopy(context, state, format, rowOrder);

  const primary = node('div', 'kx-primary-toolbar');
  primary.setAttribute('role', 'toolbar');
  primary.setAttribute('aria-label', 'Saved KX result actions');
  const output = node('div', 'kx-output-group');
  output.append(node('span', 'kx-toolbar-label', KX_RESULT_UI_LABELS.output));
  output.append(resultFormatSelect(
    state.savedActionFormat,
    value => {
      state.savedActionFormat = value;
      renderState(context, state);
    },
    'toolbar:saved:format'
  ));
  output.append(settingToggle(
    KX_RESULT_UI_LABELS.headers,
    resultSettings.includeHeaders,
    checked => updateResultSetting(context, 'includeHeaders', checked),
    'toolbar:saved:headers'
  ));
  output.append(settingToggle(
    KX_RESULT_UI_LABELS.rowIndex,
    resultSettings.includeRowIndex,
    checked => updateResultSetting(context, 'includeRowIndex', checked),
    'toolbar:saved:row-index'
  ));
  const copyButton = button(KX_RESULT_UI_LABELS.copy, () => {
    if (state.savedActionFormat !== 'xlsx') {
      copySelection(state.savedActionFormat);
    }
  });
  withFocusKey(copyButton, 'toolbar:saved:copy');
  const actionCellCount = currentActionCellCount();
  copyButton.disabled = state.savedActionFormat === 'xlsx' ||
    actionCellCount < 1 || actionCellCount > LIVE_CLIPBOARD_CELL_LIMIT ||
    !context.postMessage;
  copyButton.title = state.savedActionFormat === 'xlsx'
    ? 'XLSX is export-only.'
    : actionCellCount > LIVE_CLIPBOARD_CELL_LIMIT
      ? `Inline copy is limited to ${LIVE_CLIPBOARD_CELL_LIMIT.toLocaleString()} cells.`
      : 'Copy the selected range, or all preview cells when nothing is selected.';
  const exportButton = button(KX_RESULT_UI_LABELS.export, () =>
    requestSavedExport(context, state, state.savedActionFormat, rowOrder));
  withFocusKey(exportButton, 'toolbar:saved:export');
  exportButton.disabled = actionCellCount < 1 || !context.postMessage;
  output.append(copyButton, exportButton);
  if (context.postMessage) {
    primary.append(output);
  }
  const chartCandidates = chartColumns(payload, visibleColumns);
  if (state.savedChartVisible ||
    (chartCandidates.numeric.length > 0 && visibleColumns.length > 1)) {
    const chartToggle = button(
      state.savedChartVisible ? KX_RESULT_UI_LABELS.closeChart : KX_RESULT_UI_LABELS.chart,
      () => {
        state.savedChartVisible = !state.savedChartVisible;
        ensureSavedChartSpec(state);
        renderState(context, state);
      }
    );
    withFocusKey(chartToggle, 'toolbar:saved:chart-toggle');
    primary.append(chartToggle);
  }
  primary.append(resultColumnControl(context, state, 'saved'));
  const selectionStatus = node(
    'span',
    'kx-selection-summary',
    kxResultSelectionSummary(notebookSelectionRange(state.savedSelection))
  );
  selectionStatus.setAttribute('role', 'status');
  selectionStatus.setAttribute('aria-live', 'polite');
  primary.append(selectionStatus);
  const updateCopyButtons = (): void => {
    const cells = currentActionCellCount();
    copyButton.disabled = state.savedActionFormat === 'xlsx' ||
      cells < 1 || cells > LIVE_CLIPBOARD_CELL_LIMIT || !context.postMessage;
    exportButton.disabled = cells < 1 || !context.postMessage;
    selectionStatus.textContent = kxResultSelectionSummary(
      notebookSelectionRange(state.savedSelection)
    );
  };
  root.append(primary);

  const tableTools = node('div', 'kx-live-tools kx-view-tools');
  const searchInput = document.createElement('input');
  withFocusKey(searchInput, 'search:saved:input');
  searchInput.id = `${state.domIdPrefix}-saved-search`;
  searchInput.type = 'search';
  searchInput.maxLength = MAX_NOTEBOOK_LIVE_SEARCH_CHARS;
  searchInput.placeholder = KX_RESULT_UI_LABELS.searchRows;
  searchInput.setAttribute('aria-label', 'Search saved result rows');
  searchInput.title = 'Enter: next match; Shift+Enter: previous match';
  searchInput.disabled = visibleColumns.length === 0;
  searchInput.value = state.savedSearch.query;
  const searchStatus = node('span', 'kx-meta', savedSearchStatus(state.savedSearch));
  searchStatus.id = `${state.domIdPrefix}-saved-search-status`;
  searchStatus.setAttribute('role', 'status');
  searchStatus.setAttribute('aria-live', 'polite');
  searchInput.setAttribute('aria-describedby', searchStatus.id);
  let previousSearch: HTMLButtonElement;
  let nextSearch: HTMLButtonElement;
  const syncSavedSearchNavigation = (): void => {
    const disabled = state.savedSearch.matches.length === 0;
    previousSearch.disabled = disabled;
    nextSearch.disabled = disabled;
  };
  searchInput.addEventListener('input', () => {
    state.savedSearch.query = searchInput.value.slice(0, MAX_NOTEBOOK_LIVE_SEARCH_CHARS);
    state.savedSearch.activeIndex = -1;
    reconcileSavedSearch(state, payload, rowOrder);
    searchStatus.textContent = savedSearchStatus(state.savedSearch);
    updateSavedSearchClasses(wrap, state.savedSearch);
    syncSavedSearchNavigation();
  });
  searchInput.addEventListener('keydown', event => {
    if (event.key === 'Escape' && searchInput.value) {
      event.preventDefault();
      searchInput.value = '';
      state.savedSearch = emptySavedSearch();
      searchStatus.textContent = '';
      updateSavedSearchClasses(wrap, state.savedSearch);
      syncSavedSearchNavigation();
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
      updateSavedSearchClasses(wrap, state.savedSearch);
      syncSavedSearchNavigation();
      return;
    }
    moveSavedSearch(action === 'previous' ? -1 : 1);
  });
  const moveSavedSearch = (delta: -1 | 1): void => {
    state.savedSearch.activeIndex = notebookMovedSearchMatchIndex(
      state.savedSearch.activeIndex,
      state.savedSearch.matches.length,
      delta
    );
    syncSavedSearchNavigation();
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
      document.getElementById(searchInputId)?.focus({ preventScroll: true });
      return;
    }
    searchStatus.textContent = savedSearchStatus(state.savedSearch);
    updateSavedSearchClasses(wrap, state.savedSearch);
    wrap.querySelector<HTMLElement>(`tr[data-row="${match.displayRow}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    state.savedScrollTop = wrap.scrollTop;
  };
  previousSearch = button(KX_RESULT_UI_LABELS.previousMatch, () => moveSavedSearch(-1));
  nextSearch = button(KX_RESULT_UI_LABELS.nextMatch, () => moveSavedSearch(1));
  withFocusKey(previousSearch, 'search:saved:previous');
  withFocusKey(nextSearch, 'search:saved:next');
  syncSavedSearchNavigation();
  tableTools.append(searchInput, previousSearch, nextSearch, searchStatus);
  root.append(tableTools);
  if (visibleColumns.length === 0) {
    root.append(node('div', 'kx-empty', 'No visible columns. Use Columns to restore them.'));
    return;
  }

  const wrap = node('div', 'kx-table-wrap');
  withFocusKey(wrap, 'grid:saved:viewport');
  wrap.tabIndex = 0;
  wrap.setAttribute('aria-label', 'Saved KX result preview table');
  wrap.setAttribute('role', 'grid');
  wrap.setAttribute('aria-rowcount', String(payload.data.rows.length + 1));
  wrap.setAttribute('aria-colcount', String(visibleColumns.length));
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
  visibleColumns.forEach(() => {
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
    const selectAll = button('#', () => {
      if (payload.data.rows.length > 0 && visibleColumns.length > 0) {
        state.savedSelection = {
          anchorRow: 0,
          anchorColumn: 0,
          focusRow: payload.data.rows.length - 1,
          focusColumn: visibleColumns.length - 1,
        };
        updateSavedSelectionClasses(wrap, state.savedSelection);
        updateCopyButtons();
      }
    });
    selectAll.className = 'kx-saved-sort';
    selectAll.setAttribute('aria-label', 'Select all saved preview cells');
    corner.append(selectAll);
    headRow.append(corner);
  }
  visibleColumns.forEach((sourceColumnIndex, columnIndex) => {
    const column = payload.schema.columns[sourceColumnIndex];
    const th = document.createElement('th');
    th.scope = 'col';
    th.setAttribute(
      'aria-sort',
      state.savedSortColumn === sourceColumnIndex
        ? state.savedSortDirection === 'asc' ? 'ascending' : 'descending'
        : 'none'
    );
    const label = state.savedSortColumn === sourceColumnIndex
      ? `${column.name} ${state.savedSortDirection === 'asc' ? '▲' : '▼'}`
      : column.name;
    const sort = button(label, event => {
      if (event.shiftKey) {
        state.savedSelection = notebookSelectionForColumn(
          state.savedSelection,
          columnIndex,
          payload.data.rows.length,
          true
        );
        updateSavedSelectionClasses(wrap, state.savedSelection);
        updateCopyButtons();
        event.preventDefault();
        return;
      }
      if (state.savedSortColumn !== sourceColumnIndex) {
        state.savedSortColumn = sourceColumnIndex;
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
    withFocusKey(sort, `grid:saved:sort:${sourceColumnIndex}`);
    sort.className = 'kx-saved-sort';
    sort.title = `Sort by ${column.name}; Shift+click selects a column range`;
    th.append(sort);
    th.append(node('span', 'kx-column-type', column.type));
    headRow.append(th);
  });
  head.append(headRow);
  table.append(head);
  const body = document.createElement('tbody');
  const pageSize = Math.max(1, Math.min(
    TABLE_PAGE_SIZE,
    Math.floor(MAX_TABLE_PAGE_CELLS / Math.max(1, visibleColumns.length))
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
      const rowHeader = node('th', 'kx-saved-row-index');
      rowHeader.setAttribute('role', 'rowheader');
      rowHeader.setAttribute('scope', 'row');
      const selectRow = button(String(rowIndex + 1), () => {
        state.savedSelection = {
          anchorRow: rowIndex,
          anchorColumn: 0,
          focusRow: rowIndex,
          focusColumn: visibleColumns.length - 1,
        };
        updateSavedSelectionClasses(wrap, state.savedSelection);
        updateCopyButtons();
      });
      selectRow.className = 'kx-saved-sort';
      selectRow.setAttribute('aria-label', `Select row ${rowIndex + 1}`);
      rowHeader.append(selectRow);
      tr.append(rowHeader);
    }
    visibleColumns.forEach((sourceColumnIndex, columnIndex) => {
      const cell = row[sourceColumnIndex];
      const cellText = portableCellText(cell, {
        arrayDisplayFormat: resultSettings.arrayDisplayFormat,
      });
      const td = node('td', '', cellText);
      td.id = gridCellId(state, rowIndex, columnIndex);
      td.setAttribute('role', 'gridcell');
      td.setAttribute('aria-colindex', String(columnIndex + 1));
      td.setAttribute(
        'aria-label',
        `${payload.schema.columns[sourceColumnIndex].name}, row ${rowIndex + 1}, ${cellText}`
      );
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
      visibleColumns.length
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
    withFocusKey(previous, 'pagination:saved:previous');
    previous.disabled = pageStart === 0;
    const next = button('Next page', () => {
      state.savedTablePageStart = Math.min(lastPageStart, pageStart + pageSize);
      renderState(context, state);
    });
    withFocusKey(next, 'pagination:saved:next');
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
  const column = state.savedSortColumn;
  const direction = state.savedSortDirection;
  if (column === undefined || !direction) {
    return payload.data.rows.map((_row, index) => index);
  }
  return sortedColumnarRowOrder(
    portableTable(payload),
    column,
    direction,
    { arrayDisplayFormat: resultSettings.arrayDisplayFormat }
  );
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
  const visibleColumns = visibleSavedColumnIndexes(state);
  const result = notebookSavedSearchMatches(
    payload.data.rows.map(row =>
      visibleColumns.map(columnIndex => portableCellText(row[columnIndex], {
        arrayDisplayFormat: resultSettings.arrayDisplayFormat,
      }))
    ),
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
  const candidates = chartColumns(state.payload, visibleSavedColumnIndexes(state));
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
  const renderedChart = state.savedRenderedChart;
  const preparation = renderedChart
    ? preparedSavedChartData(state, state.payload, renderedChart)
    : undefined;
  const prepared = preparation?.data;
  const panel = node('div', 'kx-chart-panel');
  const controls = node('div', 'kx-chart-controls');
  controls.append(labelledSelectOptions(
    'Chart type',
    [...KX_RESULT_CHART_TYPE_OPTIONS],
    chart.type,
    value => {
      chart.type = value as NotebookChartType;
      renderState(context, state);
    },
    'chart:saved:type'
  ));
  controls.append(labelledSelect(
    'X',
    candidates.x,
    chart.xColumn,
    value => {
      chart.xColumn = value;
      chart.yColumns = reconcileNotebookChartYColumns(
        candidates.numeric,
        value,
        chart.yColumns
      );
      renderState(context, state);
    },
    'chart:saved:x'
  ));
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
      open => { state.savedChartYOpen = open; },
      'chart:saved:y',
      seriesSelectorSwatches(controlModel.yColumns, prepared, root)
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
      },
      'chart:saved:group'
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
        },
        `chart:saved:${key}`
      ));
    });
  }
  const dirty = !!renderedChart &&
    notebookChartSpecSignature(renderedChart) !== notebookChartSpecSignature(chart);
  const validation = controlModel.validationMessage ||
    savedChartSourceLimitMessage(state.payload);
  const render = button(KX_RESULT_UI_LABELS.renderChart, () => {
    state.savedRenderedChart = cloneNotebookChartSpec(chart);
    renderState(context, state);
  });
  withFocusKey(render, 'chart:saved:render');
  render.disabled = !!validation || (!!preparation?.error && !dirty);
  controls.append(render);
  const exportPng = button(KX_RESULT_UI_LABELS.exportChartPng, () => {
    requestChartPngExport(context, state);
    renderState(context, state);
  });
  withFocusKey(exportPng, 'chart:saved:export-png');
  exportPng.disabled = !prepared || !context.postMessage;
  if (!context.postMessage) {
    exportPng.title = 'PNG export requires notebook renderer messaging.';
  }
  controls.append(exportPng);
  const reset = button(KX_RESULT_UI_LABELS.resetZoom, () => {
    resetPlotZoom(state);
  });
  withFocusKey(reset, 'chart:saved:reset');
  reset.disabled = !prepared;
  controls.append(reset);
  panel.append(controls);
  const status = node(
    'div',
    'kx-status',
    validation || (dirty
      ? 'Chart settings changed — Render to update.'
      : preparation?.error || (renderedChart
        ? ''
        : 'Press Render to create chart.'))
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

  if (!prepared) {
    chartHost.append(node(
      'div',
      'kx-notice',
      preparation?.error ||
        'Chart unavailable: selected columns contain no finite saved points.'
    ));
    return;
  }
  drawNotebookChart(context, state, chartHost, prepared, false);
  exportPng.disabled = !state.plot || !context.postMessage;
  reset.disabled = !state.plot;
}

function drawNotebookChart(
  context: RendererContext<RendererState>,
  state: OutputState,
  host: HTMLElement,
  data: NotebookLiveChartData,
  autoRefine: boolean
): void {
  if (data.x.length === 0 || data.series.length === 0) {
    host.append(node('div', 'kx-notice', 'Chart has no finite sampled points.'));
    return;
  }
  const colors = chartColors(host);
  const plotHost = node('div', 'kx-chart-canvas');
  const legendHost = node('div', 'kx-chart-legend');
  host.append(plotHost, legendHost);
  const keys = notebookChartSeriesKeys(data);
  state.plotSeriesKeys = keys;
  const series: uPlot.Series[] = [{ label: data.xColumn }];
  if (data.chartType === 'candlestick') {
    const color = (): CanvasRenderingContext2D['strokeStyle'] =>
      cssColor(host, '--vscode-charts-green', '#2ea043');
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
      const colorIndex = index % colors.length;
      const color = (): CanvasRenderingContext2D['strokeStyle'] =>
        chartColors(host)[colorIndex];
      const config: uPlot.Series = {
        label: item.columnName,
        show: chartSeriesVisible(state.hiddenChartSeriesKeys, keys[index]),
        stroke: color,
        spanGaps: false,
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
        config.fill = () => alphaColor(String(color()), 0.5);
      }
      series.push(config);
    });
  }
  const aligned = data.chartType === 'candlestick'
    ? [
      data.x,
      data.candlesticks?.map(candle => candle.close) || [],
    ] as uPlot.AlignedData
    : [
      data.x,
      ...data.series.map(item => {
        const hasGapFlags = Array.isArray(item.gapFlags) && item.gapFlags.length > 0;
        return item.values.map((value, index) =>
          Number.isFinite(value)
            ? value
            : (hasGapFlags
              ? (item.gapFlags?.[index] === true ? null : undefined)
              : null)
        );
      }),
    ] as uPlot.AlignedData;
  createPlot(
    state,
    plotHost,
    notebookPlotOptions(
      plotHost,
      data.chartType,
      data.xKind === 'temporal',
      series,
      data.x,
      colors,
      280,
      data,
      state,
      legendHost,
      autoRefine ? context : undefined
    ),
    aligned,
    data
  );
  if (autoRefine) {
    syncLiveChartRenderedAutoRefineRange(state);
  }
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
  data: uPlot.AlignedData,
  sourceData: NotebookLiveChartData
): void {
  try {
    state.plot = new uPlot(options, data, host);
    state.plotData = sourceData;
    restorePlotViewport(state, sourceData);
    decoratePlotLegendAccessibility(state.plot);
    host.addEventListener('dblclick', event => {
      event.preventDefault();
      resetPlotZoom(state);
    });
    state.plotResizeObserver = new ResizeObserver(entries => {
      const width = Math.floor(entries[0]?.contentRect.width || 0);
      if (state.plot && width > 0) {
        state.plot.setSize({ width, height: options.height || 260 });
      }
    });
    state.plotResizeObserver.observe(host);
    state.plotThemeObserver = new MutationObserver(() => {
      state.plot?.redraw();
    });
    for (const target of [document.documentElement, document.body]) {
      state.plotThemeObserver.observe(target, {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-vscode-theme-id', 'data-vscode-theme-kind'],
      });
    }
  } catch {
    destroyPlot(state);
    host.replaceChildren(node('div', 'kx-notice', 'Chart rendering failed; the result table remains available.'));
  }
}

function decoratePlotLegendAccessibility(plot: uPlot): void {
  const legend = plotLegendElement(plot);
  legend?.setAttribute('aria-label', 'Chart series legend');
  const labels = plotLegendLabels(plot);
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
  syncPlotLegendColors(plot);
  syncPlotLegendAccessibility(plot);
}

function syncPlotLegendAccessibility(plot: uPlot): void {
  plotLegendLabels(plot).forEach(label => {
    const seriesIndex = Number(label.dataset.kxSeriesIndex);
    if (Number.isSafeInteger(seriesIndex) && seriesIndex > 0 && seriesIndex < plot.series.length) {
      const hidden = plot.series[seriesIndex].show === false;
      label.setAttribute('aria-pressed', hidden ? 'false' : 'true');
      label.closest('.u-series')?.classList.toggle('kx-series-hidden', hidden);
    }
  });
}

function syncPlotLegendColors(plot: uPlot): void {
  const labels = plotLegendLabels(plot);
  const offset = labels.length === plot.series.length ? 0 : 1;
  labels.forEach((label, labelIndex) => {
    const seriesIndex = labelIndex + offset;
    const stroke = plot.series[seriesIndex]?.stroke;
    const color = typeof stroke === 'function'
      ? String(stroke(plot, seriesIndex))
      : String(stroke || '');
    const marker = label.querySelector<HTMLElement>('.u-marker');
    if (marker && color) {
      marker.style.backgroundColor = color;
      marker.style.borderColor = color;
    }
  });
}

function plotLegendElement(plot: uPlot): HTMLElement | null {
  return plot.root.closest('.kx-chart-host')
    ?.querySelector<HTMLElement>('.u-legend') || null;
}

function plotLegendLabels(plot: uPlot): HTMLElement[] {
  return Array.from(
    plotLegendElement(plot)
      ?.querySelectorAll<HTMLElement>('.u-series > th') || []
  );
}

function resetPlotZoom(state: OutputState): void {
  clearLiveChartAutoRefine(state.liveChart, true);
  if (!state.plot) {
    return;
  }
  state.plot.setData(state.plot.data, true);
  state.plot.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
}

function capturePlotViewport(state: OutputState): void {
  if (!state.plot || !state.plotData) {
    return;
  }
  state.plotViewport = {
    data: state.plotData,
    x: plotScaleRange(state.plot, 'x'),
    y: plotScaleRange(state.plot, 'y'),
  };
}

function restorePlotViewport(state: OutputState, data: NotebookLiveChartData): void {
  if (!state.plot || state.plotViewport?.data !== data) {
    return;
  }
  const { x, y } = state.plotViewport;
  if (x) {
    state.plot.setScale('x', x);
  }
  if (y) {
    state.plot.setScale('y', y);
  }
}

function plotScaleRange(plot: uPlot, scaleKey: 'x' | 'y'): PlotScaleRange | undefined {
  const scale = plot.scales[scaleKey];
  const min = Number(scale?.min);
  const max = Number(scale?.max);
  return Number.isFinite(min) && Number.isFinite(max) && max > min
    ? { min, max }
    : undefined;
}

function currentPlotXRange(state: OutputState): { min: number; max: number } | undefined {
  return planChartAutoRefine(
    state.liveChart.fullRange,
    state.plot ? plotScaleRange(state.plot, 'x') : undefined,
    '',
    false
  )?.range;
}

function queueLiveChartAutoRefine(
  context: RendererContext<RendererState>,
  state: OutputState,
  plot: uPlot
): void {
  const chart = state.liveChart;
  const plan = planChartAutoRefine(
    chart.fullRange,
    plotScaleRange(plot, 'x'),
    chart.lastAutoRefineRangeKey,
    state.plot !== plot || chart.pending || chart.dirty || !chart.data
  );
  if (!plan) {
    clearLiveChartAutoRefine(chart);
    return;
  }
  clearLiveChartAutoRefine(chart);
  chart.autoRefineTimer = window.setTimeout(() => {
    chart.autoRefineTimer = undefined;
    const current = planChartAutoRefine(
      chart.fullRange,
      state.plot === plot ? plotScaleRange(plot, 'x') : undefined,
      chart.lastAutoRefineRangeKey,
      state.plot !== plot || chart.pending || chart.dirty || !chart.data
    );
    if (!current || current.key !== plan.key) {
      return;
    }
    requestLiveChart(context, state, current.range);
    renderState(context, state);
  }, LIVE_CHART_AUTO_REFINE_DELAY_MS);
}

function clearLiveChartAutoRefine(chart: LiveChartState, resetRangeKey = false): void {
  if (chart.autoRefineTimer !== undefined) {
    window.clearTimeout(chart.autoRefineTimer);
    chart.autoRefineTimer = undefined;
  }
  if (resetRangeKey) {
    chart.lastAutoRefineRangeKey = '';
    chart.syncAutoRefineRangeOnNextPlot = false;
  }
}

function syncLiveChartRenderedAutoRefineRange(state: OutputState): void {
  const chart = state.liveChart;
  if (!chart.syncAutoRefineRangeOnNextPlot || !state.plot) {
    return;
  }
  chart.syncAutoRefineRangeOnNextPlot = false;
  clearLiveChartAutoRefine(chart);
  const rendered = planChartAutoRefine(
    chart.fullRange,
    plotScaleRange(state.plot, 'x'),
    '',
    false
  );
  chart.lastAutoRefineRangeKey = rendered?.key || '';
}

function chartDataXRange(data: NotebookLiveChartData): PlotScaleRange | undefined {
  if (isValidChartRange(data.xDomain)) {
    return { min: data.xDomain.min, max: data.xDomain.max };
  }
  if (data.x.length === 0) {
    return undefined;
  }
  const range = {
    min: Math.min(...data.x),
    max: Math.max(...data.x),
  };
  return isValidChartRange(range) ? range : undefined;
}

function requestChartPngExport(
  context: RendererContext<RendererState>,
  state: OutputState
): void {
  const canvas = state.plot?.ctx.canvas;
  if (!context.postMessage || !canvas || typeof canvas.toDataURL !== 'function') {
    state.hostActionMessage = 'Chart canvas is unavailable.';
    return;
  }
  try {
    const requestId = nextRequestId();
    state.hostActionRequestId = requestId;
    state.hostActionMessage = 'Choosing a PNG export destination…';
    context.postMessage({
      type: 'exportChartPng',
      ...(state.outputId ? { outputId: state.outputId } : {}),
      payload: state.payload,
      requestId,
      dataUrl: canvas.toDataURL('image/png'),
    });
  } catch {
    state.hostActionMessage = 'Chart PNG export failed.';
  }
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
  state: OutputState,
  legendHost: HTMLElement,
  liveContext?: RendererContext<RendererState>
): uPlot.Options {
  const axisColor = (): CanvasRenderingContext2D['strokeStyle'] => {
    const foreground = getComputedStyle(host).color;
    return firstCssColor(
      host,
      [
        '--vscode-charts-foreground',
        '--vscode-editor-foreground',
        '--vscode-foreground',
      ],
      foreground
    );
  };
  const gridColor = (): CanvasRenderingContext2D['strokeStyle'] =>
    firstCssColor(
      host,
      [
        '--vscode-editorIndentGuide-background1',
        '--vscode-charts-lines',
        '--vscode-editorRuler-foreground',
        '--vscode-panel-border',
      ],
      String(axisColor())
    );
  const paddedX =
    chartType === 'bar' || chartType === 'box' || chartType === 'candlestick';
  const customY =
    chartType === 'bar' || chartType === 'box' || chartType === 'candlestick';
  const drawHook = chartType === 'bar'
    ? (plot: uPlot) => drawClusteredBars(plot, chartColors(host))
    : chartType === 'box'
      ? (plot: uPlot) => drawNotebookBoxes(plot, data, chartColors(host))
      : chartType === 'candlestick'
        ? (plot: uPlot) => drawNotebookCandlesticks(plot, data, host)
        : undefined;
  const seriesColor = (plot: uPlot, seriesIndex: number): string => {
    const stroke = series[seriesIndex]?.stroke;
    return typeof stroke === 'function'
      ? String(stroke(plot, seriesIndex))
      : String(stroke || chartColors(host)[(seriesIndex - 1) % colors.length]);
  };
  return {
    width: Math.max(1, Math.floor(host.getBoundingClientRect().width || 720)),
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
        grid: { stroke: gridColor, width: 0.5 },
        ticks: { stroke: gridColor, width: 0.5 },
      },
      {
        scale: 'y',
        stroke: axisColor,
        grid: { stroke: gridColor, width: 0.5 },
        ticks: { stroke: gridColor, width: 0.5 },
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
    legend: {
      show: true,
      live: false,
      isolate: false,
      mount: (_plot, table) => legendHost.append(table),
      markers: {
        width: 2,
        stroke: seriesColor,
        fill: seriesColor,
      },
    },
    hooks: {
      draw: [
        (plot: uPlot) => {
          drawHook?.(plot);
          syncPlotLegendColors(plot);
        },
      ],
      setSeries: [
        (plot: uPlot) => {
          capturePlotSeriesVisibility(state, plot);
          syncPlotLegendAccessibility(plot);
        },
      ],
      ...(liveContext
        ? {
          setScale: [
            (plot: uPlot, scaleKey: string) => {
              if (scaleKey === 'x') {
                queueLiveChartAutoRefine(liveContext, state, plot);
              }
            },
          ],
        }
        : {}),
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

function firstCssColor(
  host: HTMLElement,
  properties: readonly string[],
  fallback: string
): string {
  const style = getComputedStyle(host);
  for (const property of properties) {
    const value = style.getPropertyValue(property).trim();
    if (value) {
      return value;
    }
  }
  return fallback;
}

function alphaColor(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) {
    return color;
  }
  const value = Number.parseInt(match[1], 16);
  return `rgba(${value >> 16},${(value >> 8) & 255},${value & 255},${alpha})`;
}

function notebookResultStateSummary(state: OutputState): string {
  if (state.liveStatus === 'available') {
    return state.liveMode === 'table'
      ? kxLiveResultSummary(
        state.liveRowCount,
        state.liveTotalColumnCount,
        state.liveAllColumns.length
      )
      : `Live full result • ${state.liveKind || 'qText'}`;
  }
  if (state.payload.kind === 'table') {
    return kxSavedPreviewSummary(
      state.payload.result.previewRowCount,
      state.payload.result.rowCount,
      state.payload.schema.columns.length
    );
  }
  return state.payload.result.truncated
    ? 'Saved preview • bounded qText'
    : 'Saved preview • qText';
}

function reconciledColumnOrder(columns: readonly string[], previousNames: readonly string[]): number[] {
  const unused = new Set(columns.map((_column, index) => index));
  const result: number[] = [];
  previousNames.forEach(name => {
    const index = columns.findIndex((candidate, candidateIndex) =>
      unused.has(candidateIndex) && candidate === name
    );
    if (index >= 0) {
      result.push(index);
      unused.delete(index);
    }
  });
  columns.forEach((_column, index) => {
    if (unused.has(index)) {
      result.push(index);
    }
  });
  return result;
}

function visibleLiveColumnIndexes(state: OutputState): number[] {
  const hidden = new Set(state.liveHiddenColumnIndexes);
  return state.liveColumnOrder.filter(index =>
    index >= 0 && index < state.liveAllColumns.length && !hidden.has(index)
  );
}

function visibleSavedColumnIndexes(state: OutputState): number[] {
  if (state.payload.kind !== 'table') {
    return [];
  }
  const payload = state.payload;
  const hidden = new Set(state.savedHiddenColumnIndexes);
  return state.savedColumnOrder.filter(index =>
    index >= 0 && index < payload.schema.columns.length && !hidden.has(index)
  );
}

function syncLiveVisibleColumns(state: OutputState): void {
  state.liveColumns = visibleLiveColumnIndexes(state)
    .map(index => state.liveAllColumns[index]);
}

function liveChartColumns(
  state: OutputState
): { x: string[]; numeric: string[]; group: string[] } {
  const visible = new Set(state.liveColumns);
  return {
    x: state.liveChartXColumns.filter(column => visible.has(column)),
    numeric: state.liveChartYColumns.filter(column => visible.has(column)),
    group: state.liveChartGroupColumns.filter(column => visible.has(column)),
  };
}

function resultFormatSelect(
  selected: ExportFormat,
  onChange: (format: ExportFormat) => void,
  focusKey?: string
): HTMLSelectElement {
  const select = document.createElement('select');
  if (focusKey) {
    withFocusKey(select, focusKey);
  }
  select.setAttribute('aria-label', KX_RESULT_UI_LABELS.format);
  KX_RESULT_EXPORT_FORMATS.forEach(format => {
    const option = document.createElement('option');
    option.value = format.value;
    option.textContent = format.label;
    option.selected = format.value === selected;
    select.append(option);
  });
  select.addEventListener('change', () => onChange(select.value as ExportFormat));
  return select;
}

function settingToggle(
  label: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
  focusKey?: string
): HTMLLabelElement {
  const wrapper = node('label', 'kx-setting-toggle');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  if (focusKey) {
    withFocusKey(input, focusKey);
  }
  input.addEventListener('change', () => onChange(input.checked));
  wrapper.append(input, document.createTextNode(label));
  return wrapper;
}

function resultColumnControl(
  context: RendererContext<RendererState>,
  state: OutputState,
  mode: 'live' | 'saved'
): HTMLDetailsElement {
  const detailsKey = `columns:${mode}`;
  const details = persistentDetails(state, document.createElement('details'), detailsKey);
  details.className = 'kx-columns';
  const order = mode === 'live' ? state.liveColumnOrder : state.savedColumnOrder;
  const hidden = new Set(
    mode === 'live' ? state.liveHiddenColumnIndexes : state.savedHiddenColumnIndexes
  );
  const names = mode === 'live'
    ? state.liveAllColumns
    : state.payload.kind === 'table'
      ? state.payload.schema.columns.map(column => column.name)
      : [];
  const visibleCount = order.filter(index => !hidden.has(index)).length;
  const summary = document.createElement('summary');
  withFocusKey(summary, `${detailsKey}:summary`);
  summary.textContent = `${KX_RESULT_UI_LABELS.columns} (${visibleCount}/${names.length})`;
  summary.setAttribute(
    'aria-label',
    `${KX_RESULT_UI_LABELS.columns}, ${visibleCount} of ${names.length} visible`
  );
  details.append(summary);
  const panel = node('div', 'kx-columns-panel');
  const actions = node('div', 'kx-columns-actions');
  const apply = (nextOrder: number[], nextHidden: number[]): void => {
    if (mode === 'live') {
      clearLiveChartAutoRefine(state.liveChart, true);
      state.liveColumnOrder = nextOrder;
      state.liveHiddenColumnIndexes = nextHidden;
      syncLiveVisibleColumns(state);
      state.liveSelection = undefined;
      state.liveSlice = undefined;
      state.liveSliceError = undefined;
      state.liveScrollLeft = 0;
      state.liveSearch = emptyLiveSearch();
      const candidates = liveChartColumns(state);
      const reconciled = reconcileNotebookChartConfiguration(
        state.liveChart,
        candidates.x,
        candidates.numeric,
        candidates.group
      );
      state.liveChart = {
        ...state.liveChart,
        ...reconciled.configuration,
        data: reconciled.compatible ? state.liveChart.data : undefined,
        fullData: reconciled.compatible ? state.liveChart.fullData : undefined,
        fullRange: reconciled.compatible ? state.liveChart.fullRange : undefined,
        requestSignature: reconciled.compatible
          ? state.liveChart.requestSignature
          : undefined,
        requestId: reconciled.compatible ? state.liveChart.requestId : nextRequestId(),
        pending: reconciled.compatible ? state.liveChart.pending : false,
        requestRange: reconciled.compatible ? state.liveChart.requestRange : undefined,
        autoRefineTimer: undefined,
        lastAutoRefineRangeKey: reconciled.compatible
          ? state.liveChart.lastAutoRefineRangeKey
          : '',
        syncAutoRefineRangeOnNextPlot: reconciled.compatible
          ? state.liveChart.syncAutoRefineRangeOnNextPlot
          : false,
        dirty: reconciled.compatible ? state.liveChart.dirty : true,
        refined: reconciled.compatible ? state.liveChart.refined : false,
        error: reconciled.compatible ? state.liveChart.error : undefined,
        errorWasRefinement: reconciled.compatible
          ? state.liveChart.errorWasRefinement
          : false,
      };
    } else {
      state.savedColumnOrder = nextOrder;
      state.savedHiddenColumnIndexes = nextHidden;
      state.savedSelection = undefined;
      state.savedTablePageStart = 0;
      state.savedScrollLeft = 0;
      state.savedSearch = emptySavedSearch();
      reconcileSavedChartsForColumns(state);
    }
    renderState(context, state);
  };
  actions.append(
    withFocusKey(
      button(KX_RESULT_UI_LABELS.selectAllColumns, () => apply(order.slice(), [])),
      `${detailsKey}:select-all`
    ),
    withFocusKey(
      button(KX_RESULT_UI_LABELS.deselectAllColumns, () => apply(order.slice(), order.slice())),
      `${detailsKey}:deselect-all`
    ),
    withFocusKey(
      button(KX_RESULT_UI_LABELS.resetColumns, () =>
        apply(names.map((_name, index) => index), [])),
      `${detailsKey}:reset`
    )
  );
  panel.append(actions);
  const list = node('div', 'kx-columns-list');
  order.forEach((sourceIndex, position) => {
    const row = node('div', 'kx-column-option');
    const label = node('label', '');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !hidden.has(sourceIndex);
    withFocusKey(checkbox, `${detailsKey}:column:${sourceIndex}:visible`);
    checkbox.setAttribute('aria-label', `Show column ${names[sourceIndex]}`);
    checkbox.addEventListener('change', () => {
      const next = new Set(hidden);
      if (checkbox.checked) {
        next.delete(sourceIndex);
      } else {
        next.add(sourceIndex);
      }
      apply(order.slice(), [...next]);
    });
    label.append(checkbox, document.createTextNode(names[sourceIndex] || `Column ${sourceIndex + 1}`));
    const up = titledButton('↑', `Move ${names[sourceIndex]} left`, () =>
      apply(moveKxResultColumn(order, sourceIndex, -1), [...hidden]));
    const down = titledButton('↓', `Move ${names[sourceIndex]} right`, () =>
      apply(moveKxResultColumn(order, sourceIndex, 1), [...hidden]));
    withFocusKey(up, `${detailsKey}:column:${sourceIndex}:up`);
    withFocusKey(down, `${detailsKey}:column:${sourceIndex}:down`);
    up.disabled = position === 0;
    down.disabled = position === order.length - 1;
    row.append(label, up, down);
    list.append(row);
  });
  if (order.length === 0) {
    list.append(node('span', 'kx-meta', 'No columns'));
  }
  panel.append(list);
  details.append(panel);
  keepDetailsPanelInsideResult(details, panel);
  return details;
}

function resultSettingsControl(
  context: RendererContext<RendererState>,
  state: OutputState
): HTMLDetailsElement {
  const details = persistentDetails(state, document.createElement('details'), 'settings');
  details.className = 'kx-settings';
  const summary = document.createElement('summary');
  withFocusKey(summary, 'settings:summary');
  summary.textContent = KX_RESULT_UI_LABELS.settings;
  summary.title = 'Result settings';
  summary.setAttribute('aria-label', 'Result settings');
  details.append(summary);
  const panel = node('div', 'kx-settings-panel');
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', 'Results Settings');
  const dismiss = (): void => {
    details.open = false;
    summary.focus({ preventScroll: true });
  };
  const panelHeader = node('div', 'kx-settings-header');
  panelHeader.append(node('strong', '', 'Results Settings'));
  const close = button('Close', dismiss);
  close.classList.add('kx-settings-close');
  close.title = 'Close Results Settings';
  close.setAttribute('aria-label', 'Close Results Settings');
  withFocusKey(close, 'settings:close');
  panelHeader.append(close);
  panel.append(panelHeader);
  details.addEventListener('keydown', event => {
    if (details.open && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    }
  });
  KX_RESULT_SETTING_DEFINITIONS.forEach(definition => {
    const value = resultSettings[definition.key];
    if (definition.control === 'checkbox' && typeof value === 'boolean') {
      panel.append(settingCheckbox(
        context,
        definition.label,
        definition.key,
        value
      ));
    } else if (definition.control === 'select' && typeof value === 'string') {
      panel.append(settingSelect(
        context,
        definition.label,
        definition.key,
        [...(definition.values || [])],
        value
      ));
    } else if (definition.control === 'number' && typeof value === 'number') {
      panel.append(settingNumber(
        context,
        definition.label,
        definition.key,
        value,
        definition.minimum ?? 0,
        definition.maximum,
        definition.autoValue,
        definition.autoLabel
      ));
    }
  });
  details.append(panel);
  keepDetailsPanelInsideResult(details, panel);
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
  withFocusKey(input, `settings:${key}`);
  input.addEventListener('change', () => updateResultSetting(context, key, input.checked));
  wrapper.append(input, document.createTextNode(label));
  return wrapper;
}

function settingSelect(
  context: RendererContext<RendererState>,
  label: string,
  key: NotebookResultSettingKey,
  values: Array<{ value: string; label: string }>,
  selected: string
): HTMLLabelElement {
  return labelledSelectOptions(
    label,
    values,
    selected,
    value => updateResultSetting(context, key, value),
    `settings:${key}`
  );
}

function settingNumber(
  context: RendererContext<RendererState>,
  label: string,
  key: NotebookResultSettingKey,
  value: number,
  minimum: number,
  maximum?: number,
  autoValue?: number,
  autoLabel?: string
): HTMLLabelElement {
  const wrapper = node('label', 'kx-control');
  wrapper.append(node('span', '', label));
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(minimum);
  if (maximum !== undefined) {
    input.max = String(maximum);
  }
  input.step = '1';
  const auto = autoValue !== undefined && value === autoValue;
  input.value = auto ? '' : String(value);
  if (autoValue !== undefined && autoLabel) {
    input.placeholder = autoLabel;
    input.title = `${autoLabel}; enter a number from ${minimum}` +
      `${maximum === undefined ? '' : ` to ${maximum}`}.`;
    if (auto) {
      input.setAttribute('aria-valuetext', autoLabel);
      wrapper.classList.add('is-auto');
    }
  }
  withFocusKey(input, `settings:${key}`);
  input.addEventListener('change', () => {
    const next = input.value.trim() === '' && autoValue !== undefined
      ? autoValue
      : Number(input.value);
    if (Number.isSafeInteger(next) && next >= minimum &&
      (maximum === undefined || next <= maximum)) {
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
  if (!context.postMessage || !state.liveId || !state.outputId) {
    return;
  }
  const requestId = nextRequestId();
  state.liveRequestId = requestId;
  state.liveStatus = 'requesting';
  context.postMessage({
    type: 'requestLiveResult',
    outputId: state.outputId,
    liveId: state.liveId,
    requestId,
  });
}

function requestOpenLiveResult(
  context: RendererContext<RendererState>,
  state: OutputState
): void {
  if (!context.postMessage || !state.liveId || !state.outputId ||
    state.liveStatus !== 'available') {
    return;
  }
  const requestId = nextRequestId();
  state.liveOpenRequestId = requestId;
  context.postMessage({
    type: 'openLiveResult',
    outputId: state.outputId,
    liveId: state.liveId,
    requestId,
  });
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

function outputBindingReference(outputItem: OutputItem): { version: 1; id: string } | undefined {
  if (!isRecord(outputItem.metadata)) {
    return undefined;
  }
  return parseNotebookOutputBindingReference(
    outputItem.metadata[NOTEBOOK_OUTPUT_BINDING_METADATA_KEY]
  );
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
  const requestId = nextRequestId();
  state.hostActionRequestId = requestId;
  state.hostActionMessage = 'Opening the saved preview in KX Results…';
  context.postMessage({
    type: 'openPreview',
    ...(state.outputId ? { outputId: state.outputId } : {}),
    payload: state.payload,
    requestId,
  });
  status.textContent = state.hostActionMessage;
}

function savedChartData(
  payload: PortableKxTableResult,
  chart: NotebookChartSpec,
  maxSampledPoints: number,
  maxSourceRows: number
): Pick<SavedPreparedChartState, 'data' | 'error'> {
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
      maxSourceRows,
      maxSampledPoints,
    });
    if (built.x.length === 0 || built.series.length === 0) {
      return {
        error: 'Chart unavailable: selected columns contain no finite saved points.',
      };
    }
    return { data: built };
  } catch (error) {
    return {
      error: error instanceof Error && error.message
        ? error.message
        : 'Chart unavailable: the saved chart could not be prepared.',
    };
  }
}

function preparedSavedChartData(
  state: OutputState,
  payload: PortableKxTableResult,
  chart: NotebookChartSpec
): SavedPreparedChartState {
  const maxSourceRows = notebookSavedChartSourceRowLimit(payload);
  const signature = [
    notebookChartSpecSignature(chart),
    state.savedMaxChartPoints,
    maxSourceRows,
  ].join('\0');
  if (state.savedPreparedChart?.signature === signature) {
    return state.savedPreparedChart;
  }
  const preparation = savedChartData(
    payload,
    chart,
    state.savedMaxChartPoints,
    maxSourceRows
  );
  state.savedPreparedChart = { signature, ...preparation };
  return state.savedPreparedChart;
}

function chartColumns(
  payload: PortableKxTableResult,
  columnIndexes?: readonly number[]
): { x: string[]; numeric: string[]; group: string[] } {
  const options = chartColumnOptions(portableTable(payload, columnIndexes), 200);
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
  const candidates = chartColumns(state.payload, visibleSavedColumnIndexes(state));
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

function reconcileSavedChartsForColumns(state: OutputState): void {
  if (state.payload.kind !== 'table') {
    state.savedChart = undefined;
    state.savedRenderedChart = undefined;
    state.savedPreparedChart = undefined;
    return;
  }
  const candidates = chartColumns(state.payload, visibleSavedColumnIndexes(state));
  if (state.savedChart) {
    const reconciled = reconcileSavedChartSpec(state.savedChart, candidates);
    state.savedChart = reconciled.compatible ? state.savedChart : reconciled.chart;
  }
  if (state.savedRenderedChart) {
    const rendered = reconcileSavedChartSpec(state.savedRenderedChart, candidates);
    if (!rendered.compatible) {
      state.savedRenderedChart = undefined;
      state.savedPreparedChart = undefined;
    }
  }
  ensureSavedChartSpec(state);
}

function reconcileSavedChartSpec(
  chart: NotebookChartSpec,
  candidates: { x: string[]; numeric: string[]; group: string[] }
): { chart: NotebookChartSpec; compatible: boolean } {
  const reconciled = reconcileNotebookChartConfiguration(
    {
      visible: chart.visible,
      chartType: chart.type,
      xColumn: chart.xColumn,
      yColumns: chart.yColumns,
      groupByColumn: chart.groupByColumn || '',
      openColumn: chart.openColumn || '',
      highColumn: chart.highColumn || '',
      lowColumn: chart.lowColumn || '',
      closeColumn: chart.closeColumn || '',
    },
    candidates.x,
    candidates.numeric,
    candidates.group
  );
  const configuration = reconciled.configuration;
  return {
    compatible: reconciled.compatible,
    chart: {
      ...chart,
      visible: configuration.visible,
      type: configuration.chartType,
      xColumn: configuration.xColumn,
      yColumns: configuration.yColumns.slice(),
      groupByColumn: configuration.groupByColumn || undefined,
      openColumn: configuration.openColumn || undefined,
      highColumn: configuration.highColumn || undefined,
      lowColumn: configuration.lowColumn || undefined,
      closeColumn: configuration.closeColumn || undefined,
    },
  };
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
    lastAutoRefineRangeKey: '',
    syncAutoRefineRangeOnNextPlot: false,
    refined: false,
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
  format: NotebookLiveCopyFormat
): void {
  const selectionRange = notebookSelectionRange(state.liveSelection);
  const range = selectionRange || {
    startRow: 0,
    endRow: Math.max(0, state.liveRowCount - 1),
    startColumn: 0,
    endColumn: Math.max(0, state.liveColumns.length - 1),
  };
  const cellCount = state.liveRowCount === 0 || state.liveColumns.length === 0
    ? 0
    : (range.endRow - range.startRow + 1) *
      (range.endColumn - range.startColumn + 1);
  if (!context.postMessage || !state.liveId || !state.outputId ||
    cellCount < 1 || cellCount > LIVE_CLIPBOARD_CELL_LIMIT) {
    return;
  }
  const visibleColumns = visibleLiveColumnIndexes(state);
  const columnIndexes = visibleColumns.slice(range.startColumn, range.endColumn + 1);
  const requestId = nextRequestId();
  state.liveCopyRequestId = requestId;
  state.liveCopyMessage = 'Copying…';
  context.postMessage({
    type: 'copyLiveRange',
    outputId: state.outputId,
    liveId: state.liveId,
    requestId,
    ...range,
    format,
    includeHeaders: resultSettings.includeHeaders,
    includeRowIndex: resultSettings.includeRowIndex,
    columnIndexes,
    ...liveSortFields(state),
  });
  renderState(context, state);
}

function requestLiveExport(
  context: RendererContext<RendererState>,
  state: OutputState,
  format: ExportFormat
): void {
  if (!context.postMessage || !state.liveId || !state.outputId ||
    state.liveRowCount < 1 || state.liveColumns.length < 1) {
    return;
  }
  const range = notebookSelectionRange(state.liveSelection) || {
    startRow: 0,
    endRow: state.liveRowCount - 1,
    startColumn: 0,
    endColumn: state.liveColumns.length - 1,
  };
  const requestId = nextRequestId();
  state.hostActionRequestId = requestId;
  state.hostActionMessage = `Choosing a ${format.toUpperCase()} export destination…`;
  context.postMessage({
    type: 'exportLiveRange',
    outputId: state.outputId,
    liveId: state.liveId,
    requestId,
    ...range,
    format,
    includeHeaders: resultSettings.includeHeaders,
    includeRowIndex: resultSettings.includeRowIndex,
    columnIndexes: visibleLiveColumnIndexes(state)
      .slice(range.startColumn, range.endColumn + 1),
    ...liveSortFields(state),
  });
  renderState(context, state);
}

function savedActionRange(
  state: OutputState,
  payload: PortableKxTableResult,
  visibleColumnCount: number
): { startRow: number; endRow: number; startColumn: number; endColumn: number } {
  return notebookSelectionRange(state.savedSelection) || {
    startRow: 0,
    endRow: Math.max(0, payload.data.rows.length - 1),
    startColumn: 0,
    endColumn: Math.max(0, visibleColumnCount - 1),
  };
}

function savedActionCellCount(
  state: OutputState,
  payload: PortableKxTableResult,
  visibleColumnCount: number
): number {
  if (payload.data.rows.length === 0 || visibleColumnCount === 0) {
    return 0;
  }
  const range = savedActionRange(state, payload, visibleColumnCount);
  return (range.endRow - range.startRow + 1) *
    (range.endColumn - range.startColumn + 1);
}

function requestSavedCopy(
  context: RendererContext<RendererState>,
  state: OutputState,
  format: NotebookLiveCopyFormat,
  rowOrder: readonly number[]
): void {
  if (!context.postMessage || state.payload.kind !== 'table') {
    return;
  }
  const payload = state.payload;
  const visibleColumns = visibleSavedColumnIndexes(state);
  const range = savedActionRange(state, payload, visibleColumns.length);
  const cellCount = savedActionCellCount(state, payload, visibleColumns.length);
  if (cellCount < 1 || cellCount > LIVE_CLIPBOARD_CELL_LIMIT) {
    return;
  }
  const requestId = nextRequestId();
  state.hostActionRequestId = requestId;
  state.hostActionMessage = 'Copying selected saved preview cells…';
  context.postMessage({
    type: 'copyPreviewRange',
    ...(state.outputId ? { outputId: state.outputId } : {}),
    requestId,
    payload,
    ...range,
    format,
    includeHeaders: resultSettings.includeHeaders,
    includeRowIndex: resultSettings.includeRowIndex,
    columnIndexes: visibleColumns.slice(range.startColumn, range.endColumn + 1),
    rowIndexes: rowOrder.slice(range.startRow, range.endRow + 1),
  });
  renderState(context, state);
}

function requestSavedExport(
  context: RendererContext<RendererState>,
  state: OutputState,
  format: ExportFormat,
  rowOrder: readonly number[]
): void {
  if (!context.postMessage || state.payload.kind !== 'table') {
    return;
  }
  const payload = state.payload;
  const visibleColumns = visibleSavedColumnIndexes(state);
  const range = savedActionRange(state, payload, visibleColumns.length);
  if (savedActionCellCount(state, payload, visibleColumns.length) < 1) {
    return;
  }
  const requestId = nextRequestId();
  state.hostActionRequestId = requestId;
  state.hostActionMessage = `Choosing a ${format.toUpperCase()} export destination…`;
  context.postMessage({
    type: 'exportPreviewRange',
    ...(state.outputId ? { outputId: state.outputId } : {}),
    requestId,
    payload,
    ...range,
    format,
    includeHeaders: resultSettings.includeHeaders,
    includeRowIndex: resultSettings.includeRowIndex,
    columnIndexes: visibleColumns.slice(range.startColumn, range.endColumn + 1),
    rowIndexes: rowOrder.slice(range.startRow, range.endRow + 1),
  });
  renderState(context, state);
}

function requestPreviewRerun(
  context: RendererContext<RendererState>,
  state: OutputState
): void {
  if (!context.postMessage) {
    return;
  }
  const requestId = nextRequestId();
  state.hostActionRequestId = requestId;
  state.hostActionMessage = state.payload.provenance.marker === '%%q'
    ? 'Requesting a new KX Direct IPC execution…'
    : 'Requesting cell rerun…';
  context.postMessage({
    type: 'rerunPreview',
    ...(state.outputId ? { outputId: state.outputId } : {}),
    payload: state.payload,
    requestId,
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
  const selectedCells = notebookSelectionCellCount(state.liveSelection);
  const allCells = state.liveRowCount * state.liveColumns.length;
  const copyCells = selectedCells || allCells;
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
    copyButton.disabled = state.liveActionFormat === 'xlsx' ||
      copyCells < 1 || copyCells > LIVE_CLIPBOARD_CELL_LIMIT;
  });
  if (state.liveCopyStatus) {
    state.liveCopyStatus.textContent = state.liveCopyMessage || '';
    state.liveCopyStatus.hidden = !state.liveCopyMessage;
  }
  if (state.liveSelectionStatus) {
    state.liveSelectionStatus.textContent = kxResultSelectionSummary(
      notebookSelectionRange(state.liveSelection)
    );
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

function portableTable(
  payload: PortableKxTableResult,
  columnIndexes: readonly number[] = payload.schema.columns.map((_column, index) => index)
): ColumnarPanelResult {
  return createColumnarPanelResult(
    columnIndexes.map(index => payload.schema.columns[index].name),
    payload.data.rows.length,
    (rowIndex, columnIndex) =>
      portableCellValue(payload.data.rows[rowIndex][columnIndexes[columnIndex]]),
    columnIndexes.map(index => payload.schema.columns[index].type)
  );
}

function nextRequestId(): number {
  requestSequence = requestSequence >= MAX_NOTEBOOK_LIVE_REQUEST_ID ? 1 : requestSequence + 1;
  return requestSequence;
}

function gridCellId(state: OutputState, row: number, column: number): string {
  return `${state.domIdPrefix}-r${row}-c${column}`;
}

function cssVariableColor(properties: readonly string[], fallback: string): string {
  return properties.reduceRight(
    (value, property) => `var(${property}, ${value})`,
    fallback
  );
}

function chartColors(host: HTMLElement, preserveCssVariables = false): string[] {
  const color = (properties: readonly string[], fallback: string): string =>
    preserveCssVariables
      ? cssVariableColor(properties, fallback)
      : firstCssColor(host, properties, fallback);
  return [
    color(['--vscode-charts-blue', '--vscode-terminal-ansiBlue'], '#4da3ff'),
    color(['--vscode-charts-red', '--vscode-terminal-ansiRed'], '#f07178'),
    color(['--vscode-charts-green', '--vscode-terminal-ansiGreen'], '#7bd88f'),
    color(['--vscode-charts-purple', '--vscode-terminal-ansiMagenta'], '#c792ea'),
    color(['--vscode-charts-yellow', '--vscode-terminal-ansiYellow'], '#ffcb6b'),
    color(['--vscode-charts-orange', '--vscode-terminal-ansiBrightRed'], '#ff9cac'),
    color(['--vscode-terminal-ansiCyan', '--vscode-charts-blue'], '#89ddff'),
    color(['--vscode-terminal-ansiBrightMagenta', '--vscode-charts-purple'], '#82aaff'),
  ];
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
  style.textContent = `${uPlotCss}\n${KX_RESULTS_SHARED_CSS}\n${rendererCss}`;
  document.head.append(style);
}

function renderError(element: HTMLElement, message: string): void {
  const root = node('div', 'kx-error', message);
  root.setAttribute('role', 'alert');
  element.append(root);
}

function destroyPlot(state: OutputState): void {
  capturePlotViewport(state);
  capturePlotSeriesVisibility(state);
  state.plotResizeObserver?.disconnect();
  state.plotResizeObserver = undefined;
  state.plotThemeObserver?.disconnect();
  state.plotThemeObserver = undefined;
  state.plot?.destroy();
  state.plot = undefined;
  state.plotData = undefined;
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

function captureRerenderUiState(state: OutputState): void {
  const openDetails = new Set(state.openDetailsKeys);
  state.element.querySelectorAll<HTMLDetailsElement>('details[data-kx-details-key]')
    .forEach(details => {
      const key = details.dataset.kxDetailsKey;
      if (!key) {
        return;
      }
      if (details.open) {
        openDetails.add(key);
      } else {
        openDetails.delete(key);
      }
    });
  state.openDetailsKeys = [...openDetails];

  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !state.element.contains(active)) {
    state.rerenderFocus = undefined;
    return;
  }
  const keyed = active.closest<HTMLElement>('[data-kx-focus-key]');
  const key = keyed?.dataset.kxFocusKey;
  if (!key) {
    state.rerenderFocus = undefined;
    return;
  }
  state.rerenderFocus = {
    key,
    ...(active instanceof HTMLInputElement &&
      typeof active.selectionStart === 'number' &&
      typeof active.selectionEnd === 'number'
      ? {
        selectionStart: active.selectionStart,
        selectionEnd: active.selectionEnd,
      }
      : {}),
  };
}

function restoreRerenderFocus(state: OutputState): void {
  const saved = state.rerenderFocus;
  state.rerenderFocus = undefined;
  if (!saved) {
    return;
  }
  const targets = [...state.element.querySelectorAll<HTMLElement>('[data-kx-focus-key]')];
  const target = [saved.key, ...rerenderFocusFallbackKeys(saved.key)]
    .map(key => targets.find(element => element.dataset.kxFocusKey === key))
    .find(enabledFocusTarget);
  if (!target) {
    return;
  }
  target.focus({ preventScroll: true });
  if (target instanceof HTMLInputElement &&
    saved.selectionStart !== undefined && saved.selectionEnd !== undefined &&
    (target.type === 'search' || target.type === 'text')) {
    target.setSelectionRange(saved.selectionStart, saved.selectionEnd);
  }
}

function rerenderFocusFallbackKeys(key: string): string[] {
  const columnMove = /^(columns:(?:live|saved)):column:(\d+):(up|down)$/.exec(key);
  if (columnMove) {
    const [, detailsKey, columnIndex, direction] = columnMove;
    return [
      `${detailsKey}:column:${columnIndex}:${direction === 'up' ? 'down' : 'up'}`,
      `${detailsKey}:column:${columnIndex}:visible`,
      `${detailsKey}:summary`,
    ];
  }
  const pagination = /^pagination:saved:(previous|next)$/.exec(key);
  if (pagination) {
    return [
      `pagination:saved:${pagination[1] === 'previous' ? 'next' : 'previous'}`,
      'grid:saved:viewport',
    ];
  }
  const chartRender = /^chart:(live|saved):render$/.exec(key);
  if (chartRender) {
    return [
      `chart:${chartRender[1]}:type`,
      `toolbar:${chartRender[1]}:chart-toggle`,
      `columns:${chartRender[1]}:summary`,
    ];
  }
  const chartToggle = /^toolbar:(live|saved):chart-toggle$/.exec(key);
  return chartToggle ? [`columns:${chartToggle[1]}:summary`] : [];
}

function enabledFocusTarget(
  target: HTMLElement | undefined
): target is HTMLElement {
  return !!target && !('disabled' in target && (target as HTMLButtonElement).disabled);
}

function persistentDetails(
  state: OutputState,
  details: HTMLDetailsElement,
  key: string
): HTMLDetailsElement {
  details.dataset.kxDetailsKey = key;
  details.open = state.openDetailsKeys.includes(key);
  details.addEventListener('toggle', () => {
    const open = new Set(state.openDetailsKeys);
    if (details.open) {
      open.add(key);
    } else {
      open.delete(key);
    }
    state.openDetailsKeys = [...open];
  });
  return details;
}

function keepDetailsPanelInsideResult(
  details: HTMLDetailsElement,
  panel: HTMLElement
): void {
  const position = (): void => {
    if (!details.isConnected || !details.open) {
      return;
    }
    const root = details.closest<HTMLElement>('.kx-root');
    if (!root) {
      return;
    }
    const rootRect = root.getBoundingClientRect();
    const inset = 4;
    panel.style.boxSizing = 'border-box';
    panel.style.maxHeight = '';
    panel.style.maxWidth = `${Math.max(1, Math.floor(rootRect.width - inset * 2))}px`;
    panel.style.transform = '';
    const panelRect = panel.getBoundingClientRect();
    const cssMaxHeight = Number.parseFloat(getComputedStyle(panel).maxHeight);
    const availableHeight = Math.floor(
      Math.min(rootRect.bottom, window.innerHeight - inset) - panelRect.top - inset
    );
    if (availableHeight > 0) {
      panel.style.maxHeight = `${Math.max(
        1,
        Math.min(
          availableHeight,
          Number.isFinite(cssMaxHeight) ? cssMaxHeight : availableHeight
        )
      )}px`;
    }
    const minimumLeft = rootRect.left + inset;
    const maximumRight = rootRect.right - inset;
    const shift = panelRect.left < minimumLeft
      ? minimumLeft - panelRect.left
      : panelRect.right > maximumRight
        ? maximumRight - panelRect.right
        : 0;
    if (shift !== 0) {
      panel.style.transform = `translateX(${Math.round(shift)}px)`;
    }
  };
  const schedule = (): void => {
    if (details.open) {
      window.requestAnimationFrame(position);
    } else {
      panel.style.maxHeight = '';
      panel.style.transform = '';
    }
  };
  details.addEventListener('toggle', schedule);
  schedule();
}

function withFocusKey<Element extends HTMLElement>(element: Element, key: string): Element {
  element.dataset.kxFocusKey = key;
  return element;
}

function disposeState(id: string): void {
  const state = states.get(id);
  if (!state) {
    return;
  }
  clearLiveChartAutoRefine(state.liveChart, true);
  destroyPlot(state);
  state.liveViewportResizeObserver?.disconnect();
  if (state.renderTimer !== undefined) {
    window.cancelAnimationFrame(state.renderTimer);
  }
  if (state.searchTimer !== undefined) {
    window.clearTimeout(state.searchTimer);
  }
  state.liveCopyButtons = undefined;
  state.liveCopyTools = undefined;
  state.liveCopyStatus = undefined;
  state.liveSelectionStatus = undefined;
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

function button(text: string, action: (event: MouseEvent) => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = text;
  element.addEventListener('click', event => action(event));
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
  onChange: (value: string) => void,
  focusKey?: string
): HTMLLabelElement {
  const wrapper = node('label', 'kx-control');
  wrapper.append(node('span', '', label));
  const select = document.createElement('select');
  if (focusKey) {
    withFocusKey(select, focusKey);
  }
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
  onChange: (value: string) => void,
  focusKey?: string
): HTMLLabelElement {
  const wrapper = node('label', 'kx-control');
  wrapper.append(node('span', '', label));
  const select = document.createElement('select');
  if (focusKey) {
    withFocusKey(select, focusKey);
  }
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
  onToggle: (open: boolean) => void,
  focusKeyPrefix?: string,
  swatches: ReadonlyMap<string, readonly string[]> = new Map()
): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'kx-series-control';
  details.open = open;
  const summary = document.createElement('summary');
  if (focusKeyPrefix) {
    withFocusKey(summary, `${focusKeyPrefix}:summary`);
  }
  summary.textContent = `${label} (${selected.length})`;
  summary.setAttribute('aria-label', `${label} series, ${selected.length} selected`);
  details.append(summary);
  const list = node('div', 'kx-series-list');
  values.forEach(value => {
    const wrapper = node('label', 'kx-series-option');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = selected.includes(value);
    if (focusKeyPrefix) {
      withFocusKey(input, `${focusKeyPrefix}:column:${value}`);
    }
    input.addEventListener('change', () => onChange(value, input.checked));
    const colorKey = node('span', 'kx-series-swatches');
    colorKey.setAttribute('aria-hidden', 'true');
    (swatches.get(value) || []).forEach(color => {
      const swatch = node('span', 'kx-series-swatch');
      swatch.style.backgroundColor = color;
      colorKey.append(swatch);
    });
    wrapper.append(input, colorKey, node('span', 'kx-series-name', value));
    list.append(wrapper);
  });
  if (values.length === 0) {
    list.append(node('span', 'kx-meta', 'No numeric series'));
  }
  details.append(list);
  details.addEventListener('toggle', () => onToggle(details.open));
  keepDetailsPanelInsideResult(details, list);
  return details;
}

function seriesSelectorSwatches(
  columns: readonly string[],
  data: NotebookLiveChartData | undefined,
  host: HTMLElement
): ReadonlyMap<string, readonly string[]> {
  const palette = chartColors(host, true);
  return new Map(columns.map(column => [
    column,
    chartSeriesColorIndexes(
      column,
      columns,
      data?.series,
      palette.length
    ).map(index => palette[index]),
  ]));
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
    copyExportConfirmCellThreshold: 1_000_000,
    elapsedTimeDisplay: 'auto',
    chartDecimalPlaces: 4,
    chartMaxSourceRows: 2_000_000,
    chartZoomMinSampledPoints: 3_000,
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

function notebookSavedChartSourceRowLimit(payload: PortableKxTableResult): number {
  const configured = Number(resultSettings.chartMaxSourceRows);
  const limit = Number.isSafeInteger(configured) && configured >= 1
    ? configured
    : payload.result.previewRowCount;
  return Math.min(payload.result.previewRowCount, limit);
}

function savedChartSourceLimitMessage(payload: PortableKxTableResult): string {
  const rowCount = payload.data.rows.length;
  const limit = notebookSavedChartSourceRowLimit(payload);
  return rowCount > limit
    ? `Chart source has ${rowCount.toLocaleString()} rows; limit the q result or ` +
      `open the live result in KX Results for sources above ${limit.toLocaleString()} rows.`
    : '';
}

const rendererCss = `
.kx-root{box-sizing:border-box;border:1px solid var(--vscode-notebook-cellBorderColor,var(--vscode-panel-border,#555));border-radius:4px;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-family:var(--vscode-font-family,system-ui,sans-serif);font-size:var(--vscode-font-size,13px);padding:0 8px 8px;max-width:100%;min-width:0}
.kx-header{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:0 -8px 6px;padding:6px 8px;border-bottom:1px solid var(--kx-results-border);background:var(--kx-results-toolbar-background)}.kx-heading-wrap{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}.kx-heading{font-size:1.05em}.kx-meta{color:var(--vscode-descriptionForeground);font-size:.92em}.kx-kind{font-family:var(--vscode-editor-font-family,monospace)}
.kx-toolbar,.kx-live-tools,.kx-chart-controls,.kx-pagination{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.kx-chart-controls{align-items:flex-end}.kx-root button,.kx-root select,.kx-root input{font:inherit;color:var(--vscode-button-secondaryForeground,var(--vscode-foreground));background:var(--vscode-button-secondaryBackground,var(--vscode-editorWidget-background));border:1px solid var(--vscode-button-border,var(--vscode-panel-border,#777));border-radius:3px;padding:3px 7px}.kx-root button:hover:not(:disabled){background:var(--vscode-button-secondaryHoverBackground)}.kx-root button:disabled{opacity:.55}.kx-live-tools input[type=search]{min-width:220px}.kx-tools{position:relative}.kx-tools>summary{cursor:pointer;border:1px solid var(--vscode-panel-border,#777);border-radius:3px;padding:3px 7px;list-style:none}.kx-tools-panel{position:absolute;z-index:20;top:100%;right:0;display:flex;align-items:flex-end;gap:7px;min-width:210px;padding:8px;border:1px solid var(--vscode-panel-border,#555);background:var(--vscode-editorWidget-background);box-shadow:0 4px 14px var(--vscode-widget-shadow,#0008)}
.kx-primary-toolbar{display:flex;align-items:center;gap:6px;min-width:0;margin:0 -8px;padding:5px 8px;border-block:1px solid var(--kx-results-border);background:var(--kx-results-toolbar-background);flex-wrap:wrap}.kx-output-group{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap}.kx-toolbar-label{font-weight:600}.kx-setting-toggle{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}.kx-selection-summary{margin-left:auto;color:var(--kx-results-muted);font-size:.9em;white-space:nowrap}.kx-view-tools{padding-top:5px}
.kx-columns{position:relative}.kx-columns>summary{cursor:pointer;border:1px solid var(--vscode-panel-border,#777);border-radius:3px;padding:3px 7px;list-style:none;white-space:nowrap}.kx-columns-panel{position:absolute;z-index:24;top:calc(100% + 2px);right:0;width:min(420px,85vw);max-height:min(420px,65vh);overflow:auto;padding:8px;border:1px solid var(--kx-results-border);background:var(--vscode-editorWidget-background);box-shadow:0 4px 18px var(--vscode-widget-shadow,#0008)}.kx-columns-actions{display:flex;gap:5px;flex-wrap:wrap;padding-bottom:6px;border-bottom:1px solid var(--kx-results-border)}.kx-columns-list{display:grid;gap:3px;padding-top:5px}.kx-column-option{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:4px}.kx-column-option label{display:flex;align-items:center;gap:5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.kx-column-option button{padding-inline:6px}
.kx-notice,.kx-panel-mode,.kx-error{margin:7px 0;padding:6px 8px;border-left:3px solid var(--vscode-notificationsWarningIcon-foreground,#cca700);background:var(--vscode-textBlockQuote-background)}.kx-error{border-left-color:var(--vscode-errorForeground,#f14c4c)}
.kx-messages{margin:5px 0;color:var(--vscode-descriptionForeground)}.kx-source{margin:6px 0}.kx-source pre{white-space:pre-wrap;max-height:150px;overflow:auto;background:var(--vscode-textCodeBlock-background);padding:6px}
.kx-qtext{white-space:pre-wrap;max-height:520px;overflow:auto;background:var(--vscode-textCodeBlock-background);padding:8px;border:1px solid var(--vscode-panel-border,#555)}.kx-q-comment{color:var(--vscode-editorCodeLens-foreground)}.kx-q-string,.kx-q-symbol{color:var(--vscode-debugTokenExpression-string)}.kx-q-number,.kx-q-temporal{color:var(--vscode-debugTokenExpression-number)}.kx-q-keyword,.kx-q-command{color:var(--vscode-debugTokenExpression-name);font-weight:600}.kx-q-builtin,.kx-q-system,.kx-q-namespace{color:var(--vscode-symbolIcon-functionForeground)}.kx-q-operator{color:var(--vscode-symbolIcon-operatorForeground)}
.kx-live-viewport{position:relative;overflow:auto;resize:vertical;min-height:72px;max-height:min(75vh,900px);border:1px solid var(--vscode-panel-border,#555);margin:6px 0;contain:strict;box-sizing:border-box;outline:none}.kx-live-viewport:focus{border-color:var(--vscode-focusBorder,#007fd4)}.kx-live-canvas{position:relative;min-width:100%}.kx-live-row{position:absolute;left:0}.kx-live-header-row{z-index:3}.kx-live-cell,.kx-live-empty{box-sizing:border-box;position:absolute;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:4px 7px;border-right:1px solid var(--vscode-panel-border,#555);border-bottom:1px solid var(--vscode-panel-border,#555);background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);user-select:none}.kx-live-empty{color:var(--vscode-descriptionForeground)}button.kx-live-cell{text-align:left;border-radius:0}.kx-live-header{z-index:3;font-weight:600;background:var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-editor-background))}.kx-live-row-index{z-index:2;text-align:right;color:var(--vscode-descriptionForeground);background:var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-editor-background))}.kx-live-corner{z-index:4}.kx-live-cell.is-loading{color:transparent;background:linear-gradient(90deg,var(--vscode-editor-background),var(--vscode-editorWidget-background),var(--vscode-editor-background))}.kx-live-cell.is-selected,.kx-table-wrap td.is-selected{color:var(--vscode-list-activeSelectionForeground,var(--vscode-editor-foreground));background:var(--vscode-list-activeSelectionBackground,#094771);box-shadow:inset 0 0 0 1px var(--vscode-focusBorder,#007fd4)}.kx-live-cell.is-search-match:not(.is-selected){background:var(--vscode-editor-findMatchHighlightBackground,#ea5c0055)}
.kx-table-tools{margin-top:5px}.kx-table-wrap td.is-search-match:not(.is-selected){background:var(--vscode-editor-findMatchHighlightBackground,#ea5c0055)}.kx-table-wrap{overflow:auto;resize:vertical;min-height:72px;max-height:min(75vh,900px);border:1px solid var(--vscode-panel-border,#555);margin:6px 0;box-sizing:border-box;outline:none}.kx-table-wrap:focus{border-color:var(--vscode-focusBorder,#007fd4)}.kx-table-wrap table{border-collapse:separate;border-spacing:0;min-width:100%;width:max-content;table-layout:fixed}.kx-table-wrap th,.kx-table-wrap td{box-sizing:border-box;border-right:1px solid var(--vscode-panel-border,#555);border-bottom:1px solid var(--vscode-panel-border,#555);padding:3px 7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;height:var(--kx-row-height,28px)}.kx-table-wrap thead th{position:sticky;top:0;z-index:3;height:max(44px,var(--kx-row-height,28px));background:var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-editor-background))}.kx-table-wrap .kx-saved-row-index{position:sticky;left:0;z-index:2;text-align:right;color:var(--vscode-descriptionForeground);background:var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-editor-background));font-weight:normal}.kx-table-wrap .kx-saved-corner{top:0;z-index:4}.kx-saved-sort{display:block;width:100%;padding:0!important;border:0!important;background:transparent!important;text-align:left;color:inherit!important;font-weight:600}.kx-column-type{display:block;color:var(--vscode-descriptionForeground);font-size:.78em;font-weight:normal}
.kx-control{display:flex;flex-direction:column;gap:2px;color:var(--vscode-descriptionForeground);font-size:.9em}.kx-control select,.kx-control input{color:var(--vscode-foreground);min-width:90px}.kx-control.is-auto input::placeholder{color:var(--vscode-input-placeholderForeground,var(--vscode-descriptionForeground));opacity:1}.kx-series-control{position:relative;color:var(--vscode-descriptionForeground);font-size:.9em}.kx-series-control>summary{cursor:pointer;border:1px solid var(--vscode-panel-border,#777);border-radius:3px;padding:3px 7px;list-style:none}.kx-series-list{position:absolute;z-index:15;top:calc(100% + 2px);left:0;display:grid;gap:4px;max-height:min(220px,45vh);min-width:180px;max-width:min(320px,80vw);overflow:auto;padding:7px;border:1px solid var(--vscode-panel-border,#555);background:var(--vscode-editorWidget-background);box-shadow:0 4px 14px var(--vscode-widget-shadow,#0008)}.kx-series-option{display:flex;align-items:center;gap:6px;min-width:0;white-space:nowrap}.kx-series-name{min-width:0;overflow:hidden;text-overflow:ellipsis}.kx-series-swatches{display:inline-flex;align-items:center;gap:2px;flex:0 0 auto;overflow:visible!important}.kx-series-swatch{display:inline-block;width:10px;height:10px;flex:0 0 10px;border:1px solid var(--vscode-contrastBorder,var(--vscode-panel-border,transparent));border-radius:2px;box-sizing:border-box}.kx-chart-panel{border-top:1px solid var(--vscode-panel-border,#555);padding-top:7px;margin-top:7px}.kx-chart-host{width:100%;height:auto;margin-top:6px;overflow:hidden;border:1px solid var(--vscode-panel-border,#555);background:var(--vscode-editor-background);box-sizing:border-box}.kx-chart-canvas{width:100%;height:280px;overflow:hidden}.kx-chart-host .uplot{max-width:100%;font-family:var(--vscode-font-family,system-ui,sans-serif);color:var(--vscode-editor-foreground);background:var(--vscode-editor-background)}.kx-chart-host .u-wrap{background:var(--vscode-editor-background)}.kx-chart-host .u-axis,.kx-chart-host .u-legend{color:var(--vscode-charts-foreground,var(--vscode-editor-foreground))}.kx-chart-host .u-select{background:var(--vscode-list-activeSelectionBackground,rgba(80,140,220,.22))}.kx-chart-host .u-cursor-x,.kx-chart-host .u-cursor-y{border-color:var(--vscode-focusBorder,#607d8b)}.kx-chart-legend{max-height:96px;overflow:auto;border-top:1px solid var(--vscode-charts-lines,var(--vscode-panel-border,#555));background:var(--vscode-editor-background)}.kx-chart-host .u-legend{display:block;width:100%;margin:0;padding:3px 5px;text-align:left;font:inherit}.kx-chart-host .u-legend tbody{display:flex;align-items:center;gap:2px 10px;flex-wrap:wrap}.kx-chart-host .u-legend .u-series{display:block;margin:0}.kx-chart-host .u-legend .u-series>th{display:flex;align-items:center;max-width:min(240px,75vw);padding:3px 4px;border-radius:2px;outline-offset:-1px;color:var(--vscode-editor-foreground)!important}.kx-chart-host .u-legend .u-marker{width:14px;height:10px;flex:0 0 14px;margin-right:5px;border-radius:2px;box-shadow:0 0 0 1px var(--vscode-contrastBorder,var(--vscode-editor-foreground))}.kx-chart-host .u-legend .kx-series-hidden>th{text-decoration:line-through;opacity:.48}.kx-chart-host .u-legend .kx-series-hidden .u-marker{filter:grayscale(1)}.kx-status{min-height:1.2em;margin-top:5px;color:var(--vscode-descriptionForeground);font-size:.9em}.kx-empty{padding:8px;color:var(--vscode-descriptionForeground)}
.kx-settings{position:relative}.kx-settings>summary{cursor:pointer;border:1px solid var(--vscode-panel-border,#777);border-radius:3px;padding:3px 7px;list-style:none}.kx-settings-panel{position:absolute;top:calc(100% + 2px);right:0;z-index:25;display:grid;grid-template-columns:repeat(2,minmax(130px,1fr));gap:7px;width:min(430px,80vw);max-height:min(360px,60vh);overflow:auto;padding:9px;border:1px solid var(--vscode-panel-border,#555);background:var(--vscode-editorWidget-background);box-shadow:0 4px 18px var(--vscode-widget-shadow,transparent)}.kx-settings-header{position:sticky;top:-9px;z-index:2;grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:8px;margin:-9px -9px 2px;padding:8px 9px;border-bottom:1px solid var(--vscode-panel-border,#555);background:var(--vscode-editorWidget-background)}.kx-settings-close{margin-left:auto}.kx-setting-checkbox{display:flex;align-items:center;gap:5px;font-size:.9em}
.kx-density-compact :where(.kx-primary-toolbar,.kx-header){padding-block:3px}.kx-density-compact :where(button,select,input){padding-block:2px}.kx-density-comfortable :where(.kx-primary-toolbar,.kx-header){padding-block:8px}
@media (max-width:560px){.kx-root{padding-inline:5px}.kx-header,.kx-primary-toolbar{margin-inline:-5px;padding-inline:5px}.kx-primary-toolbar{align-items:flex-start}.kx-output-group{flex:1 1 100%}.kx-selection-summary{order:10;margin-left:0;flex:1 1 100%}.kx-live-tools input[type=search]{min-width:0;flex:1 1 140px}.kx-settings-panel,.kx-columns-panel{right:0;width:min(360px,92vw);max-width:none}.kx-settings-panel{grid-template-columns:minmax(0,1fr);max-height:min(320px,55vh)}.kx-series-list{max-height:min(132px,38vh);max-width:calc(100vw - 16px)}.kx-toolbar-label{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}}
`;
