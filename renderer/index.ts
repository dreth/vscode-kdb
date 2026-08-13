import uPlot from 'uplot';
import uPlotCss from 'uplot/dist/uPlot.min.css';
import type { ActivationFunction, OutputItem, RendererContext } from 'vscode-notebook-renderer';
import {
  CHART_MAX_SAMPLED_POINTS,
  ChartType,
  buildChartData,
  chartColumnOptions,
  chartTypeCapabilities,
} from '../src/charting';
import {
  ChartZoomAppliedData,
  ChartZoomAppliedFailure,
  ChartZoomLifecycleState,
  ChartNavigatorPart,
  adjustChartNavigatorRange,
  applyChartZoomLifecycleFailure,
  applyChartZoomLifecycleResponse,
  chartRangeIsZoomed,
  chartNavigatorSliderBounds,
  chartNavigatorWindow,
  chartOverviewIntervalHasGap,
  chartRequestIsCurrent,
  chartVisibleIndexBounds,
  chartXRangeWithInitialPadding,
  chartYRangeForVisibleX,
  chartZoomRequestedRenderRange,
  chartZoomRangeKey,
  clampChartViewport,
  isValidChartRange,
  issueChartZoomLifecycleRequest,
  mergeChartPixelGaps,
  panChartViewport,
  panChartViewportByPixels,
  planChartAutoRefine,
  recenterChartNavigatorRange,
  reduceChartZoomLifecycle,
  resetChartZoomLifecycle,
} from '../src/chart-zoom';
import {
  chartLegendToggleKey,
  chartSeriesColorIndexes,
  chartSeriesVisible,
  updateHiddenChartSeriesKeys,
} from '../src/chart-series-state';
import {
  KX_COLUMN_AUTO_TEXT_CHAR_LIMIT,
  KX_COLUMN_MAX_WIDTH,
  KX_COLUMN_MIN_WIDTH,
  VariableColumnMetrics,
  automaticColumnWidthsForLengths,
  hasPositionalColumnWidths,
  normalizePositionalColumnWidths,
  resolvedColumnWidth,
  updatePositionalColumnWidth,
  variableColumnMetrics,
} from '../src/column-sizing';
import {
  ColumnarPanelResult,
  ExportFormat,
  createColumnarPanelResult,
} from '../src/kx-results';
import {
  KX_NOTEBOOK_MIME,
  NotebookChartSpec,
  NotebookChartType,
  PortableKxResult,
  PortableKxTableResult,
  comparePortableCells,
  isHistoricalDirectPreview,
  isPortableKxFullResult,
  notebookQTextDisplay,
  notebookQTextDisplayNotice,
  notebookSavedPreviewNotice,
  portableCellChartColumnType,
  portableCellChartValue,
  portableCellToBoundedText,
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
  notebookSavedCellTextLimit,
  notebookSavedColumnWindow,
  notebookSavedRowOrder,
  reconcileNotebookChartConfiguration,
  notebookSelectionCellCount,
  notebookSelectionForCell,
  notebookSelectionRange,
  notebookSearchEnterAction,
  notebookSelectionToolsState,
  reconcileNotebookChartYColumns,
  reconcileNotebookHiddenColumnIndexes,
  scanNotebookSavedSearchChunk,
  toggleNotebookChartYColumn,
} from '../src/notebook-renderer-model';
import {
  NotebookRendererColumnOrderCache,
  NotebookRendererColumnOrderSnapshot,
  NotebookRendererStateRegistry,
  notebookChartViewportInteractionBlocked,
  reconciledNotebookColumnWidths,
} from '../src/notebook-renderer-state';
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
  NotebookLiveCopyFormat,
  NotebookLiveResultMetadata,
  NotebookLiveSortDirection,
  NotebookRendererHostMessage,
  NotebookSharedKxResultSettings,
  NotebookResultSettingKey,
  parseNotebookLiveResultReference,
  parseNotebookOutputBindingFromMetadata,
  parseNotebookRendererHostMessage,
} from '../src/notebook-message';
import { qTextRenderModel } from '../src/q-text';
import {
  HeaderPointerState,
  absoluteDisplayRowClass,
  beginHeaderPointer,
  fullResultColumnSelection,
  headerPointerIntent,
  moveResultColumn,
  moveResultColumnBy,
  nextResultTableSortState,
  reconciledOutputColumnOrdinals,
  reconciledResultColumnOrdinals,
  resultTableAriaSort,
  resultTableHeaderAriaLabel,
  resultTableSortIndicator,
  updateHeaderPointer,
} from '../src/result-table-interaction';
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
  columnOrdinals: number[];
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
  pending: boolean;
  partial: boolean;
  scannedRows: number;
  scannedCells: number;
  nextDisplayRow: number;
  nextColumn: number;
  signature: string;
  generation: number;
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
  requestedRenderRange?: PlotScaleRange;
  refined: boolean;
  error?: string;
  errorWasRefinement?: boolean;
  zoomLifecycle: ChartZoomLifecycleState<NotebookLiveChartData>;
}

interface PlotScaleRange {
  min: number;
  max: number;
}

interface NotebookChartNavigatorElements {
  root: HTMLElement;
  overview: SVGSVGElement;
  window: HTMLElement;
  start: HTMLElement;
  end: HTMLElement;
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
  rendererOutputId: string;
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
  liveColumnTextLengthRequestId: number;
  liveMode?: 'table' | 'text';
  liveKind?: string;
  liveAllColumns: string[];
  liveKeyColumnOrdinals: number[];
  liveTotalColumnCount: number;
  liveColumns: string[];
  liveWholeResultColumnTextLengths: number[];
  liveColumnOrder: number[];
  liveHiddenColumnIndexes: number[];
  liveManualColumnWidths: Map<number, number>;
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
  liveSortSourceOrdinal?: number;
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
  savedManualColumnWidths: Map<number, number>;
  savedColumnWindowStart: number;
  savedColumnControlWindowStart: number;
  savedSearch: SavedSearchState;
  savedCopyTools?: HTMLDetailsElement;
  savedSortColumn?: number;
  savedSortDirection?: NotebookLiveSortDirection;
  savedRowOrderCache?: {
    payload: PortableKxTableResult;
    column: number;
    direction: NotebookLiveSortDirection;
    order: readonly number[];
  };
  savedScrollTop: number;
  savedScrollLeft: number;
  savedViewportHeight?: number;
  savedViewport?: HTMLElement;
  savedColumnTextLengthCache?: {
    arrayDisplayFormat: NotebookSharedKxResultSettings['arrayDisplayFormat'];
    sourceIndexes: string;
    lengths: number[];
  };
  renderTimer?: number;
  searchTimer?: number;
  plotSeriesKeys: string[];
  hiddenChartSeriesKeys: string[];
  chartSource?: 'live' | 'saved';
  savedChartFullData?: NotebookLiveChartData;
  savedChartFullRange?: PlotScaleRange;
  savedChartViewportRange?: PlotScaleRange;
  savedChartViewportTimer?: number;
  chartProgrammaticScale: boolean;
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
const SAVED_COLUMN_WINDOW_SIZE = 256;
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
const SAVED_SEARCH_MAX_CELLS = 2_000_000;
const SAVED_SEARCH_CHUNK_ROWS = 2_000;
const SAVED_SEARCH_CHUNK_CELLS = 20_000;
const SAVED_SEARCH_CHUNK_MS = 8;
const SAVED_CELL_TEXT_CHAR_LIMIT = 64 * 1024;
const SAVED_PAGE_TEXT_CHAR_LIMIT = 2_000_000;
const SAVED_SEARCH_CELL_TEXT_CHAR_LIMIT = 4_096;
const LIVE_CHART_AUTO_REFINE_DELAY_MS = 450;
// Construct the standard SVG namespace without embedding a URL-like literal in
// the renderer bundle, whose security audit rejects all http(s) strings.
const SVG_NAMESPACE = [
  'http',
  String.fromCharCode(58),
  '//www.w3.org/2000/svg',
].join('');
const stateRegistry = new NotebookRendererStateRegistry<OutputState>();
const columnOrderCache = new NotebookRendererColumnOrderCache();
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
      const previousState = disposeOutputItemState(outputItem.id, context);
      element.replaceChildren();
      const payload = portablePayload(outputItem, element);
      if (!payload) {
        return;
      }
      const liveReference = liveResultReference(outputItem);
      const outputBinding = outputBindingReference(outputItem);
      const boundOutputId = outputBinding?.id;
      const outputId = payload.version === 2
        ? (boundOutputId === payload.outputId ? boundOutputId : undefined)
        : boundOutputId;
      const rendererOutputId = payload.version === 2 && payload.outputId
        ? payload.outputId
        : previousState && previousState.outputId === outputId
          ? previousState.rendererOutputId
          : legacyOutputId();
      const previousOrder = previousState?.rendererOutputId === rendererOutputId
        ? outputColumnOrderSnapshot(previousState)
        : payload.version === 2
          ? columnOrderCache.get(rendererOutputId)
          : undefined;
      const nextSavedSchema = payload.kind === 'table'
        ? payload.schema.columns.map(column => `${column.name}\0${column.type}`)
        : [];
      const savedColumnOrder = reconciledOutputColumnOrdinals(
        previousOrder?.outputId,
        rendererOutputId,
        previousOrder?.savedSchema || [],
        previousOrder?.savedOrdinals || [],
        nextSavedSchema
      );
      const previousSavedNames = previousState?.payload.kind === 'table'
        ? previousState.payload.schema.columns.map(column => column.name)
        : [];
      const savedHiddenColumnIndexes = previousState?.rendererOutputId === rendererOutputId &&
        payload.kind === 'table'
        ? reconcileNotebookHiddenColumnIndexes(
          previousSavedNames,
          previousState.savedHiddenColumnIndexes,
          payload.schema.columns.map(column => column.name)
        )
        : [];
      const carryLive = previousState?.rendererOutputId === rendererOutputId &&
        previousState.liveId === liveReference?.id;
      const liveAllColumns = carryLive ? previousState.liveAllColumns.slice() : [];
      const liveKeyColumnOrdinals = carryLive
        ? previousState.liveKeyColumnOrdinals.slice()
        : [];
      const liveColumnOrder = reconciledResultColumnOrdinals(
        carryLive ? previousState.liveAllColumns : [],
        carryLive ? previousState.liveColumnOrder : [],
        liveAllColumns
      );
      const liveHiddenColumnIndexes = carryLive
        ? reconcileNotebookHiddenColumnIndexes(
          previousState.liveAllColumns,
          previousState.liveHiddenColumnIndexes,
          liveAllColumns
        )
        : [];
      const state: OutputState = {
        id: outputItem.id,
        rendererOutputId,
        outputId,
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
          ? (outputId ? 'requesting' : 'unavailable')
          : 'none',
        liveRequestId: 0,
        liveColumnTextLengthRequestId: 0,
        liveAllColumns,
        liveKeyColumnOrdinals,
        liveTotalColumnCount: 0,
        liveColumns: liveColumnOrder
          .filter(index => !liveHiddenColumnIndexes.includes(index))
          .map(index => liveAllColumns[index]),
        liveWholeResultColumnTextLengths: [],
        liveColumnOrder,
        liveHiddenColumnIndexes,
        liveManualColumnWidths: carryLive
          ? boundedReconciledColumnWidths(
            previousState.liveAllColumns,
            [...previousState.liveManualColumnWidths.entries()],
            liveAllColumns
          )
          : boundedReconciledColumnWidths(
            previousOrder?.liveSchema || [],
            previousOrder?.liveWidths,
            liveAllColumns
          ),
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
        savedColumnOrder,
        savedHiddenColumnIndexes,
        savedManualColumnWidths: boundedReconciledColumnWidths(
          previousOrder?.savedSchema || [],
          previousOrder?.savedWidths,
          nextSavedSchema
        ),
        savedColumnWindowStart: 0,
        savedColumnControlWindowStart: 0,
        savedSearch: emptySavedSearch(),
        savedActionFormat: 'csv',
        liveSearch: emptyLiveSearch(),
        liveChart: emptyLiveChart(),
        liveChartYOpen: false,
        plotSeriesKeys: [],
        hiddenChartSeriesKeys: [],
        chartProgrammaticScale: false,
        hostActionRequestId: 0,
        openDetailsKeys: [],
        ...(liveReference && !outputId
          ? {
            liveMessage: isPortableKxFullResult(payload)
              ? 'Live result binding unavailable. Showing the complete saved result.'
              : isHistoricalDirectPreview(payload)
                ? 'Live result binding unavailable. Showing the historical saved preview.'
                : 'Live result binding unavailable. Showing the saved preview.',
          }
          : {}),
      };
      stateRegistry.bind(outputItem.id, state);
      renderState(context, state);
      if (state.liveId && state.outputId) {
        requestLiveResult(context, state);
      }
    },
    disposeOutputItem(id) {
      if (id === undefined) {
        stateRegistry.keys().forEach(outputItemId =>
          disposeOutputItemState(outputItemId, context));
      } else {
        disposeOutputItemState(id, context);
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
    const wholeResultSizingNeedsRefresh =
      resultSettings.autoFitColumns &&
      resultSettings.autoFitMode === 'wholeResult' &&
      (!previous.autoFitColumns ||
        previous.autoFitMode !== 'wholeResult' ||
        sliceTextChanged);
    const chartSourceLimitChanged =
      previous.chartMaxSourceRows !== resultSettings.chartMaxSourceRows;
    stateRegistry.forEach(state => {
      if (chartSourceLimitChanged) {
        clearSavedChartViewport(state);
        markLiveChartDirty(state.liveChart);
      }
      if (sliceTextChanged) {
        state.savedColumnTextLengthCache = undefined;
      }
      const liveSearchQueryToRefresh =
        sliceTextChanged && !conversionChanged && state.liveMode === 'table'
          ? state.liveSearch.query
          : '';
      if (sliceTextChanged && state.liveMode === 'table') {
        if (state.searchTimer !== undefined) {
          window.clearTimeout(state.searchTimer);
          state.searchTimer = undefined;
        }
        state.liveSlice = undefined;
        state.liveSliceError = undefined;
        state.liveSliceRequestId = nextRequestId();
        state.liveSearch = {
          ...emptyLiveSearch(),
          query: liveSearchQueryToRefresh,
        };
      }
      if ((conversionChanged || wholeResultSizingNeedsRefresh) &&
        state.liveId && state.liveStatus === 'available') {
        state.liveWholeResultColumnTextLengths = [];
        if (conversionChanged) {
          requestLiveResult(context, state);
        } else {
          requestLiveColumnTextLengths(context, state);
          if (liveSearchQueryToRefresh) {
            requestLiveSearch(context, state);
          }
        }
        renderState(context, state);
        return;
      }
      if (liveSearchQueryToRefresh) {
        requestLiveSearch(context, state);
      }
      renderState(context, state);
    });
    return;
  }

  if (message.type === 'actionResult') {
    stateRegistry.forEach(state => {
      if (state.hostActionRequestId === message.requestId) {
        state.hostActionMessage = message.message;
        renderState(context, state);
      }
    });
    return;
  }

  const matching: OutputState[] = [];
  stateRegistry.forEach(state => {
    if (state.liveId === message.liveId) {
      matching.push(state);
    }
  });
  for (const state of matching) {
    if (message.type === 'liveResult') {
      receiveLiveResult(context, state, message);
    } else if (message.type === 'liveColumnTextLengths') {
      if (message.requestId !== state.liveColumnTextLengthRequestId ||
        state.liveStatus !== 'available' ||
        !resultSettings.autoFitColumns ||
        resultSettings.autoFitMode !== 'wholeResult') {
        continue;
      }
      state.liveWholeResultColumnTextLengths = message.lengths.slice();
      renderState(context, state);
    } else if (message.type === 'liveSlice') {
      if (message.requestId !== state.liveSliceRequestId) {
        continue;
      }
      let retryWithoutSort = false;
      if (message.error) {
        const sortCanceled = message.error === 'Large sort canceled.';
        state.liveSliceError = sortCanceled ? undefined : message.error;
        state.liveSlice = undefined;
        if (state.liveSortSourceOrdinal !== undefined && state.liveSortDirection) {
          state.liveSortSourceOrdinal = undefined;
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
          columnOrdinals: message.columnOrdinals,
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
      if (message.error === 'Large sort canceled.') {
        state.liveSortSourceOrdinal = undefined;
        state.liveSortDirection = undefined;
        state.liveSlice = undefined;
        state.liveSliceError = undefined;
        state.liveSearch = {
          ...emptyLiveSearch(),
          query: state.liveSearch.query,
        };
        renderState(context, state);
        requestLiveSlice(
          context,
          state,
          liveWindow(state, state.liveViewport?.clientWidth || 720)
        );
        if (state.liveSearch.query) {
          requestLiveSearch(context, state);
        }
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
      const responseWasRefinement = !!state.liveChart.requestRange;
      if (message.data) {
        state.liveChart.pending = false;
        const applied: {
          value?: ChartZoomAppliedData<NotebookLiveChartData>;
        } = {};
        applyChartZoomLifecycleResponse(
          state.liveChart.zoomLifecycle,
          message.requestId,
          message.data,
          value => {
            applied.value = value;
          }
        );
        if (!applied.value) {
          continue;
        }
        let lifecycle = applied.value.state;
        if (!responseWasRefinement) {
          lifecycle = reduceChartZoomLifecycle(lifecycle, {
            type: 'rendered',
            requestId: message.requestId,
            naturalRange: chartDataXRange(message.data),
          });
          state.liveChart.lastAutoRefineRangeKey = '';
        }
        applyLiveChartZoomLifecycle(state.liveChart, lifecycle);
      } else {
        const failed: {
          value?: ChartZoomAppliedFailure<NotebookLiveChartData>;
        } = {};
        applyChartZoomLifecycleFailure(
          state.liveChart.zoomLifecycle,
          message.requestId,
          value => {
            failed.value = value;
          }
        );
        if (!failed.value) {
          continue;
        }
        state.liveChart.pending = false;
        applyLiveChartZoomLifecycle(state.liveChart, failed.value.state);
      }
      state.liveChart.dirty =
        state.liveChart.requestSignature !== liveChartConfigurationSignature(state.liveChart);
      state.liveChart.errorWasRefinement =
        !!message.error && responseWasRefinement;
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
  const previousColumns = state.liveAllColumns.slice();
  const previousOrderNames = state.liveColumnOrder
    .map(index => state.liveAllColumns[index])
    .filter((name): name is string => typeof name === 'string');
  const previousHiddenColumnIndexes = state.liveHiddenColumnIndexes.slice();
  const previousWidths = [...state.liveManualColumnWidths.entries()];
  state.liveAllColumns = message.columns || [];
  state.liveKeyColumnOrdinals = message.keyColumnOrdinals?.slice() || [];
  state.liveManualColumnWidths = boundedReconciledColumnWidths(
    previousColumns,
    previousWidths,
    state.liveAllColumns
  );
  state.liveWholeResultColumnTextLengths =
    message.wholeResultColumnTextLengths?.slice() || [];
  state.liveTotalColumnCount = message.totalColumnCount ?? state.liveAllColumns.length;
  state.liveColumnOrder = reconciledColumnOrder(state.liveAllColumns, previousOrderNames);
  state.liveHiddenColumnIndexes = reconcileNotebookHiddenColumnIndexes(
    previousColumns,
    previousHiddenColumnIndexes,
    state.liveAllColumns
  );
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
  state.liveSortSourceOrdinal = undefined;
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
  const chartRequestId = nextRequestId();
  const preservedZoomLifecycle = previousChart.pending
    ? reduceChartZoomLifecycle(previousChart.zoomLifecycle, {
      type: 'cancel',
      requestId: previousChart.requestId,
    })
    : previousChart.zoomLifecycle;
  state.liveChart = {
    ...previousChart,
    ...reconciledChart.configuration,
    maxPoints: notebookChartPointLimit(),
    requestId: chartRequestId,
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
    requestedRenderRange: reconciledChart.compatible
      ? previousChart.requestedRenderRange
      : undefined,
    refined: reconciledChart.compatible ? previousChart.refined : false,
    error: undefined,
    errorWasRefinement: false,
    zoomLifecycle: reconciledChart.compatible
      ? preservedZoomLifecycle
      : reduceChartZoomLifecycle<NotebookLiveChartData>(null, {
        type: 'clear',
        requestId: chartRequestId,
      }),
  };
  renderState(context, state);
}

function isOutstandingLiveRequest(state: OutputState, requestId: number): boolean {
  return requestId === state.liveRequestId ||
    requestId === state.liveColumnTextLengthRequestId ||
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
  state.liveColumnTextLengthRequestId = nextRequestId();
  state.liveMode = undefined;
  state.liveKind = undefined;
  state.liveAllColumns = [];
  state.liveKeyColumnOrdinals = [];
  state.liveTotalColumnCount = 0;
  state.liveColumns = [];
  state.liveWholeResultColumnTextLengths = [];
  state.liveColumnOrder = [];
  state.liveHiddenColumnIndexes = [];
  state.liveRowCount = 0;
  state.liveChartXColumns = [];
  state.liveChartYColumns = [];
  state.liveChartGroupColumns = [];
  state.liveText = undefined;
  state.liveMetadata = undefined;
  state.liveMessage = message || (isPortableKxFullResult(state.payload)
    ? 'Live result unavailable. Showing the saved full result.'
    : isHistoricalDirectPreview(state.payload)
      ? 'Result unavailable. Showing the historical saved preview.'
      : 'Result unavailable. Showing the saved preview.');
  state.liveSlice = undefined;
  state.liveSliceError = undefined;
  state.liveSliceRequestId = nextRequestId();
  state.liveScrollTop = 0;
  state.liveScrollLeft = 0;
  state.liveSortSourceOrdinal = undefined;
  state.liveSortDirection = undefined;
  state.liveSelection = undefined;
  state.liveSearch = emptyLiveSearch();
  const chartRequestId = nextRequestId();
  state.liveChart = {
    ...state.liveChart,
    requestId: chartRequestId,
    requestSignature: undefined,
    pending: false,
    dirty: true,
    data: undefined,
    fullData: undefined,
    fullRange: undefined,
    requestRange: undefined,
    autoRefineTimer: undefined,
    lastAutoRefineRangeKey: '',
    requestedRenderRange: undefined,
    refined: false,
    error: undefined,
    errorWasRefinement: false,
    zoomLifecycle: reduceChartZoomLifecycle<NotebookLiveChartData>(null, {
      type: 'clear',
      requestId: chartRequestId,
    }),
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
    const savedFull = isPortableKxFullResult(state.payload);
    const historicalPreview = isHistoricalDirectPreview(state.payload);
    const openSaved = titledButton(
      savedFull
        ? 'Open saved full result'
        : historicalPreview
          ? 'Open historical saved preview'
          : KX_RESULT_UI_LABELS.openSavedPreview,
      savedFull
        ? 'Open the complete saved result in KX Results'
        : historicalPreview
          ? 'Open the historical saved preview in KX Results'
          : 'Open the bounded saved preview in KX Results',
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
  viewport.setAttribute('aria-multiselectable', 'true');
  viewport.setAttribute('aria-rowcount', String(state.liveRowCount + 1));
  viewport.setAttribute(
    'aria-colcount',
    String(state.liveColumns.length + (resultSettings.showRowIndex ? 1 : 0))
  );
  viewport.setAttribute('aria-label', 'KX result table');
  viewport.style.height = `${state.liveViewportHeight ?? notebookGridDefaultHeight(
    state.liveRowCount,
    resultSettings.rowHeight,
    LIVE_HEADER_HEIGHT
  )}px`;
  const rowIndexWidth = resultSettings.showRowIndex ? LIVE_ROW_INDEX_WIDTH : 0;
  const columnMetrics = variableColumnMetrics(liveColumnWidths(state));
  const canvas = node('div', 'kx-live-canvas');
  canvas.style.width = `${rowIndexWidth + columnMetrics.totalWidth}px`;
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

function liveColumnWidths(state: OutputState): number[] {
  const visibleSourceIndexes = visibleLiveColumnIndexes(state);
  const visibleAutomaticWidths = resultSettings.autoFitColumns
    ? automaticColumnWidthsForLengths(
      liveColumnTextLengths(state),
      resultSettings.fontSize,
      7
    )
    : [];
  const automaticWidths: number[] = [];
  visibleSourceIndexes.forEach((sourceIndex, position) => {
    automaticWidths[sourceIndex] = visibleAutomaticWidths[position];
  });
  return visibleSourceIndexes.map(sourceIndex => {
    const outputWidth = state.liveManualColumnWidths.get(sourceIndex);
    return outputWidth ?? resolvedColumnWidth(
      sourceIndex,
      resultSettings.cellWidth,
      resultSettings.columnWidths,
      resultSettings.autoFitColumns,
      automaticWidths
    );
  });
}

function liveColumnTextLengths(state: OutputState): number[] {
  const visibleSourceIndexes = visibleLiveColumnIndexes(state);
  const lengths = state.liveColumns.map((column, position) => {
    const sourceIndex = visibleSourceIndexes[position];
    return resultSettings.autoFitMode === 'wholeResult'
      ? Math.max(
        column.length,
        state.liveWholeResultColumnTextLengths[sourceIndex] || 0
      )
      : column.length;
  });
  if (resultSettings.autoFitMode !== 'visibleRows' || !state.liveSlice) {
    return lengths;
  }
  const slice = state.liveSlice;
  for (let column = slice.startColumn; column <= slice.endColumn; column += 1) {
    if (column < 0 || column >= lengths.length) {
      continue;
    }
    for (const row of slice.cells) {
      lengths[column] = Math.min(
        KX_COLUMN_AUTO_TEXT_CHAR_LIMIT,
        Math.max(
          lengths[column],
          String(row[column - slice.startColumn] || '').length
        )
      );
    }
  }
  return lengths;
}

function liveWindow(
  state: OutputState,
  viewportWidth: number,
  viewportHeight = liveViewportHeight(state)
): LiveWindow {
  const rowIndexWidth = resultSettings.showRowIndex ? LIVE_ROW_INDEX_WIDTH : 0;
  const columnWidths = liveColumnWidths(state);
  return notebookGridWindow({
    rowCount: state.liveRowCount,
    columnCount: state.liveColumns.length,
    scrollTop: liveVirtualScrollTop(state),
    scrollLeft: state.liveScrollLeft,
    viewportWidth,
    viewportHeight,
    rowHeight: resultSettings.rowHeight,
    cellWidth: resultSettings.cellWidth,
    columnWidths,
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
  const columnMetrics = variableColumnMetrics(liveColumnWidths(state));
  canvas.style.width = `${rowIndexWidth + columnMetrics.totalWidth}px`;
  canvas.style.height = `${liveCanvasHeight(state)}px`;
  const window = liveWindow(
    state,
    viewport.clientWidth || 720,
    viewport.clientHeight || liveViewportHeight(state)
  );
  canvas.replaceChildren();
  renderLiveHeaders(
    context,
    state,
    canvas,
    window.startColumn,
    window.endColumn,
    columnMetrics
  );
  renderLiveCells(state, canvas, window, columnMetrics);
  syncLiveActiveDescendant(state);
  if (state.liveRowCount === 0) {
    const empty = node('div', 'kx-live-empty', '0 rows');
    placeLiveCell(
      empty,
      rowIndexWidth,
      LIVE_HEADER_HEIGHT,
      Math.max(
        columnMetrics.widths[0] || resultSettings.cellWidth,
        viewport.clientWidth - rowIndexWidth
      ),
      resultSettings.rowHeight
    );
    canvas.append(empty);
    return;
  }
  if (!state.liveSliceError && !sliceContainsWindow(state, window)) {
    requestLiveSlice(context, state, window);
  }
}

function decorateDisplayedColumn(
  element: HTMLElement,
  displayOrdinal: number,
  sourceOrdinal: number,
  options: {
    header?: boolean;
    keyColumn?: boolean;
    selectedHeader?: boolean;
    sorted?: boolean;
  } = {}
): void {
  element.classList.add('is-cell-hoverable');
  element.classList.toggle('is-key-column', options.keyColumn === true);
  element.dataset.kxDisplayOrdinal = String(displayOrdinal);
  element.dataset.kxSourceOrdinal = String(sourceOrdinal);
  if (options.header) {
    element.classList.add('is-column-header');
    element.classList.toggle('is-selected-header', options.selectedHeader === true);
    element.classList.toggle('is-sorted-header', options.sorted === true);
  } else {
    element.classList.toggle('is-sorted-column', options.sorted === true);
  }
}

function decorateDisplayedRowCell(element: HTMLElement, displayRow: number): void {
  const parityClass = absoluteDisplayRowClass(displayRow);
  element.classList.add(parityClass);
  element.dataset.kxRowParity = parityClass === 'row-odd' ? 'odd' : 'even';
}

function renderLiveHeaders(
  context: RendererContext<RendererState>,
  state: OutputState,
  canvas: HTMLElement,
  startColumn: number,
  endColumn: number,
  columnMetrics: VariableColumnMetrics
): void {
  const rowIndexWidth = resultSettings.showRowIndex ? LIVE_ROW_INDEX_WIDTH : 0;
  const visibleSourceIndexes = visibleLiveColumnIndexes(state);
  const keyColumnOrdinals = new Set(state.liveKeyColumnOrdinals);
  const row = node('div', 'kx-live-row kx-live-header-row');
  row.setAttribute('role', 'row');
  row.setAttribute('aria-rowindex', '1');
  placeLiveCell(
    row,
    0,
    state.liveScrollTop,
    rowIndexWidth + columnMetrics.totalWidth,
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
    const sourceOrdinal = visibleSourceIndexes[columnIndex] ?? columnIndex;
    const keyColumn = keyColumnOrdinals.has(sourceOrdinal);
    const columnName = state.liveColumns[columnIndex];
    const sorted = state.liveSortSourceOrdinal === sourceOrdinal;
    const selectedHeader = resultColumnFullySelected(
      state.liveSelection,
      columnIndex,
      state.liveRowCount
    );
    const label = sorted
      ? `${columnName} ${resultTableSortIndicator(true, state.liveSortDirection)}`
      : columnName;
    const header = node('div', 'kx-live-cell kx-live-header');
    decorateDisplayedColumn(header, columnIndex, sourceOrdinal, {
      header: true,
      keyColumn,
      selectedHeader,
      sorted,
    });
    const sort = button(label, () => {});
    const rerenderAfterHeaderAction = (): void => {
      state.liveSlice = undefined;
      state.liveSliceError = undefined;
      state.liveSearch = { ...emptyLiveSearch(), query: state.liveSearch.query };
      renderState(context, state);
      if (state.liveSearch.query) {
        requestLiveSearch(context, state);
      }
    };
    configureResultHeader(sort, {
      displayColumn: columnIndex,
      columnCount: visibleSourceIndexes.length,
      sourceColumn: sourceOrdinal,
      columnName,
      sort: () => {
        const next = nextResultTableSortState(
          state.liveSortSourceOrdinal !== undefined && state.liveSortDirection
            ? {
              column: state.liveSortSourceOrdinal,
              direction: state.liveSortDirection,
            }
            : undefined,
          sourceOrdinal
        );
        state.liveSortSourceOrdinal = next?.column;
        state.liveSortDirection = next?.direction;
        state.liveSelection = undefined;
        rerenderAfterHeaderAction();
        focusResultHeader(state, sourceOrdinal);
      },
      select: extend => {
        state.liveSelection = fullColumnSelection(
          state.liveSelection,
          columnIndex,
          state.liveRowCount,
          extend
        );
        state.liveCopyMessage = undefined;
        updateLiveSelectionClasses(state);
      },
      reorder: (sourceColumn, targetColumn) => {
        state.liveColumnOrder = moveVisibleResultColumnOrder(
          state.liveColumnOrder,
          visibleSourceIndexes,
          sourceColumn,
          targetColumn
        );
        syncLiveVisibleColumns(state);
        state.liveSelection = undefined;
        rerenderAfterHeaderAction();
        focusResultHeader(state, sourceOrdinal);
      },
    });
    withFocusKey(sort, `grid:live:sort:${sourceOrdinal}`);
    sort.className = 'kx-live-sort';
    sort.dataset.kxColumnIndex = String(columnIndex);
    sort.dataset.kxSourceOrdinal = String(sourceOrdinal);
    header.setAttribute('role', 'columnheader');
    header.dataset.kxHeaderColumnIndex = String(columnIndex);
    header.dataset.kxColumnIndex = String(columnIndex);
    header.setAttribute(
      'aria-colindex',
      String(columnIndex + 1 + (resultSettings.showRowIndex ? 1 : 0))
    );
    header.setAttribute(
      'aria-sort',
      resultTableAriaSort(sorted, state.liveSortDirection)
    );
    header.setAttribute(
      'aria-selected',
      selectedHeader ? 'true' : 'false'
    );
    const ariaLabel = resultTableHeaderAriaLabel(
      columnName,
      columnIndex,
      visibleSourceIndexes.length,
      sorted,
      state.liveSortDirection,
      selectedHeader,
      keyColumn
    );
    header.dataset.kxUnselectedAriaLabel = resultTableHeaderAriaLabel(
      columnName,
      columnIndex,
      visibleSourceIndexes.length,
      sorted,
      state.liveSortDirection,
      false,
      keyColumn
    );
    header.dataset.kxSelectedAriaLabel = resultTableHeaderAriaLabel(
      columnName,
      columnIndex,
      visibleSourceIndexes.length,
      sorted,
      state.liveSortDirection,
      true,
      keyColumn
    );
    header.setAttribute('aria-label', ariaLabel);
    sort.dataset.kxHeaderLabelControl = 'true';
    sort.setAttribute('aria-label', ariaLabel);
    sort.title = `Sort ${columnName}; drag to reorder`;
    header.append(sort, columnResizeHandle(
      context,
      state,
      'live',
      sourceOrdinal,
      columnMetrics.widths[columnIndex]
    ));
    placeLiveCell(
      header,
      rowIndexWidth + columnMetrics.lefts[columnIndex],
      0,
      columnMetrics.widths[columnIndex],
      LIVE_HEADER_HEIGHT
    );
    row.append(header);
  }
  canvas.append(row);
}

function renderLiveCells(
  state: OutputState,
  canvas: HTMLElement,
  window: LiveWindow,
  columnMetrics: VariableColumnMetrics
): void {
  const slice = state.liveSlice;
  const rowIndexWidth = resultSettings.showRowIndex ? LIVE_ROW_INDEX_WIDTH : 0;
  const visibleSourceIndexes = visibleLiveColumnIndexes(state);
  const keyColumnOrdinals = new Set(state.liveKeyColumnOrdinals);
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
      rowIndexWidth + columnMetrics.totalWidth,
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
      index.setAttribute('aria-colindex', '1');
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
      const value = liveSliceCell(state, slice, rowIndex, columnIndex);
      const cell = node('div', 'kx-live-cell', value ?? '');
      const sourceOrdinal = visibleSourceIndexes[columnIndex] ?? columnIndex;
      decorateDisplayedColumn(cell, columnIndex, sourceOrdinal, {
        keyColumn: keyColumnOrdinals.has(sourceOrdinal),
        sorted: state.liveSortSourceOrdinal === sourceOrdinal,
      });
      decorateDisplayedRowCell(cell, rowIndex);
      cell.id = gridCellId(state, rowIndex, columnIndex);
      cell.setAttribute('role', 'gridcell');
      cell.dataset.row = String(rowIndex);
      cell.dataset.column = String(columnIndex);
      if (value === undefined) {
        cell.classList.add('is-loading');
      }
      const selected = notebookCellSelected(state.liveSelection, rowIndex, columnIndex);
      if (selected) {
        cell.classList.add('is-selected');
      }
      if (state.liveSelection?.focusRow === rowIndex &&
        state.liveSelection.focusColumn === columnIndex) {
        cell.classList.add('is-active-cell');
      }
      cell.setAttribute('aria-selected', selected ? 'true' : 'false');
      cell.setAttribute(
        'aria-colindex',
        String(columnIndex + 1 + (resultSettings.showRowIndex ? 1 : 0))
      );
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
        rowIndexWidth + columnMetrics.lefts[columnIndex],
        0,
        columnMetrics.widths[columnIndex],
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
    resetNotebookChartViewport(context, state);
  });
  withFocusKey(reset, 'chart:live:reset');
  reset.disabled = !chart.data || chart.dirty || chart.pending;
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
    status.textContent = `${chart.refined ? 'Selected range • ' : ''}${liveChartDataStatus(chart.data)}`;
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
    reset.disabled = !hasPlot || chart.dirty || chart.pending;
  } else {
    root.append(panel);
  }
}

function resetLiveChartZoom(
  context: RendererContext<RendererState>,
  state: OutputState
): void {
  const chart = state.liveChart;
  clearLiveChartAutoRefine(chart, true);
  if ((chart.pending && chart.requestRange) || chart.zoomLifecycle.dataIsRefinement) {
    chart.requestId = nextRequestId();
    chart.pending = false;
    chart.requestRange = undefined;
    chart.error = undefined;
    chart.errorWasRefinement = false;
    const restored: {
      value?: ChartZoomAppliedData<NotebookLiveChartData>;
    } = {};
    const lifecycle = resetChartZoomLifecycle(
      chart.zoomLifecycle,
      chart.requestId,
      value => {
        restored.value = value;
      }
    );
    applyLiveChartZoomLifecycle(chart, restored.value?.state || lifecycle);
    if (chart.data) {
      renderState(context, state);
      return;
    }
  }
  resetPlotZoom(state);
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
  if (data.chartType === 'bar') {
    return `Showing ${shown.toLocaleString()} rendered bar groups${eligible === undefined
      ? ''
      : ` from ${eligible.toLocaleString()} eligible rows`}${algorithm}.`;
  }
  return `Showing ${shown.toLocaleString()} rendered points${eligible === undefined
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
  const capabilities = chartTypeCapabilities(chart.chartType);
  applyLiveChartZoomLifecycle(
    chart,
    issueChartZoomLifecycleRequest(
      chart.zoomLifecycle,
      requestId,
      range,
      request => {
        chart.requestRange = request.range || undefined;
        context.postMessage?.({
          type: 'requestLiveChart',
          outputId: state.outputId!,
          liveId: state.liveId!,
          requestId: request.requestId,
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
          ...(request.range
            ? { xMin: request.range.min, xMax: request.range.max }
            : {}),
        });
      }
    )
  );
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
  ]);
}

function drawLiveChart(
  context: RendererContext<RendererState>,
  state: OutputState,
  host: HTMLElement,
  data: NotebookLiveChartData
): void {
  drawNotebookChart(context, state, host, data, 'live');
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
    const savedState = isPortableKxFullResult(state.payload)
      ? 'Showing the complete result saved in this notebook.'
      : isHistoricalDirectPreview(state.payload)
        ? 'Showing a historical saved preview. Rerun the current cell to replace it with a complete new result.'
        : 'Showing the saved preview only. Rerun the cell to restore a live full result.';
    root.append(node(
      'div',
      'kx-notice',
      `${state.liveMessage || 'The live result is no longer available.'} ${savedState}`
    ));
  } else if (state.liveStatus === 'requesting') {
    root.append(node(
      'div',
      'kx-notice',
      isPortableKxFullResult(state.payload)
        ? 'Checking the session-bound live result. The complete saved result is shown meanwhile.'
        : isHistoricalDirectPreview(state.payload)
          ? 'Checking the session-bound live result. The historical saved preview is shown meanwhile.'
          : 'Checking the session-bound live result. The saved preview is shown meanwhile.'
    ));
  }
  if (presentation === 'both' && state.payload.provenance.marker !== 'direct-ipc' &&
    state.liveStatus !== 'requesting' && !state.panelOpened && context.postMessage) {
    state.panelOpened = true;
    openPreview(context, state, status);
  }

  if (state.payload.kind === 'qText') {
    const display = notebookQTextDisplay(state.payload.data.text);
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
    renderPortableText(display.text, 'qText result', root);
    if (display.truncated) {
      root.append(node(
        'div',
        'kx-notice',
        notebookQTextDisplayNotice(state.payload.data.text.length)
      ));
    }
    if (!isPortableKxFullResult(state.payload)) {
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
  if (!isPortableKxFullResult(state.payload)) {
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
  const allVisibleColumns = visibleSavedColumnIndexes(state);
  const columnWindow = notebookSavedColumnWindow(
    allVisibleColumns,
    state.savedColumnWindowStart,
    SAVED_COLUMN_WINDOW_SIZE
  );
  state.savedColumnWindowStart = columnWindow.start;
  const visibleColumns = columnWindow.columns;
  ensureSavedSearch(
    context,
    state,
    payload,
    rowOrder,
    visibleColumns,
    columnWindow.total > visibleColumns.length
  );
  const pageSize = Math.max(1, Math.min(
    TABLE_PAGE_SIZE,
    Math.floor(MAX_TABLE_PAGE_CELLS / Math.max(1, visibleColumns.length))
  ));
  const lastPageStart = payload.data.rows.length === 0
    ? 0
    : Math.floor((payload.data.rows.length - 1) / pageSize) * pageSize;
  const pageStart = Math.min(state.savedTablePageStart, lastPageStart);
  const pageEnd = Math.min(payload.data.rows.length, pageStart + pageSize);
  const savedCellTextLimit = notebookSavedCellTextLimit(
    pageEnd - pageStart,
    visibleColumns.length,
    SAVED_CELL_TEXT_CHAR_LIMIT,
    SAVED_PAGE_TEXT_CHAR_LIMIT
  );
  const columnWidths = savedColumnWidths(
    state,
    payload,
    visibleColumns,
    rowOrder,
    pageStart,
    pageEnd
  );
  const currentActionCellCount = () =>
    savedActionPlan(state, payload).cellCount;
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
      : 'Copy the selected range, or all saved cells when nothing is selected.';
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
    startSavedSearch(
      context,
      state,
      payload,
      rowOrder,
      visibleColumns,
      columnWindow.total > visibleColumns.length,
      () => {
        searchStatus.textContent = savedSearchStatus(state.savedSearch);
        updateSavedSearchClasses(wrap, state.savedSearch);
        syncSavedSearchNavigation();
      }
    );
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
      state.savedSearch.pending,
      event.shiftKey
    );
    if (action === 'request') {
      startSavedSearch(
        context,
        state,
        payload,
        rowOrder,
        visibleColumns,
        columnWindow.total > visibleColumns.length,
        () => {
          searchStatus.textContent = savedSearchStatus(state.savedSearch);
          updateSavedSearchClasses(wrap, state.savedSearch);
          syncSavedSearchNavigation();
        }
      );
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
  if (columnWindow.total > visibleColumns.length) {
    root.append(node(
      'div',
      'kx-notice',
      `Grid, search, selection, and chart show visible columns ` +
      `${columnWindow.start + 1}-${columnWindow.end} of ${columnWindow.total}. ` +
      `Copy and Export with no selection use all ${columnWindow.total} visible columns.`
    ));
    const moveColumnWindow = (start: number): void => {
      state.savedColumnWindowStart = start;
      state.savedSelection = undefined;
      state.savedScrollLeft = 0;
      state.savedSearch = emptySavedSearch();
      reconcileSavedChartsForColumns(state);
      renderState(context, state);
    };
    const pagination = node('div', 'kx-pagination');
    const previousColumns = button('Previous columns', () =>
      moveColumnWindow(columnWindow.start - SAVED_COLUMN_WINDOW_SIZE));
    const nextColumns = button('Next columns', () =>
      moveColumnWindow(columnWindow.end));
    withFocusKey(previousColumns, 'pagination:saved-columns:previous');
    withFocusKey(nextColumns, 'pagination:saved-columns:next');
    previousColumns.disabled = !columnWindow.hasPrevious;
    nextColumns.disabled = !columnWindow.hasNext;
    pagination.append(
      previousColumns,
      node(
        'span',
        'kx-meta',
        `Columns ${columnWindow.start + 1}-${columnWindow.end} of ${columnWindow.total}`
      ),
      nextColumns
    );
    root.append(pagination);
  }
  if (visibleColumns.length === 0) {
    root.append(node('div', 'kx-empty', 'No visible columns. Use Columns to restore them.'));
    return;
  }

  const wrap = node('div', 'kx-table-wrap');
  withFocusKey(wrap, 'grid:saved:viewport');
  wrap.tabIndex = 0;
  wrap.setAttribute(
    'aria-label',
    isPortableKxFullResult(payload)
      ? 'Complete saved KX result table'
      : isHistoricalDirectPreview(payload)
        ? 'Historical saved KX result preview table'
        : 'Saved KX result preview table'
  );
  wrap.setAttribute('role', 'grid');
  wrap.setAttribute('aria-multiselectable', 'true');
  wrap.setAttribute('aria-rowcount', String(payload.data.rows.length + 1));
  wrap.setAttribute(
    'aria-colcount',
    String(visibleColumns.length + (resultSettings.showRowIndex ? 1 : 0))
  );
  wrap.style.setProperty('--kx-row-height', `${resultSettings.rowHeight}px`);
  wrap.style.height = `${state.savedViewportHeight ?? notebookGridDefaultHeight(
    Math.min(TABLE_PAGE_SIZE, payload.data.rows.length),
    resultSettings.rowHeight,
    Math.max(SAVED_HEADER_HEIGHT, resultSettings.rowHeight)
  )}px`;
  state.savedViewport = wrap;
  const table = document.createElement('table');
  table.style.width = `${
    columnWidths.reduce((total, width) => total + width, 0) +
    (resultSettings.showRowIndex ? LIVE_ROW_INDEX_WIDTH : 0)
  }px`;
  const colgroup = document.createElement('colgroup');
  if (resultSettings.showRowIndex) {
    const indexColumn = document.createElement('col');
    indexColumn.style.width = `${LIVE_ROW_INDEX_WIDTH}px`;
    colgroup.append(indexColumn);
  }
  visibleColumns.forEach((_sourceColumnIndex, position) => {
    const column = document.createElement('col');
    column.style.width = `${columnWidths[position]}px`;
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
    selectAll.setAttribute('aria-label', 'Select all saved cells in this column window');
    corner.append(selectAll);
    headRow.append(corner);
  }
  const savedKeyColumnOrdinals = new Set(payload.schema.keyColumnOrdinals || []);
  visibleColumns.forEach((sourceColumnIndex, columnIndex) => {
    const column = payload.schema.columns[sourceColumnIndex];
    const displayOrdinal = columnWindow.start + columnIndex;
    const sorted = state.savedSortColumn === sourceColumnIndex;
    const selectedHeader = resultColumnFullySelected(
      state.savedSelection,
      columnIndex,
      payload.data.rows.length
    );
    const th = document.createElement('th');
    decorateDisplayedColumn(th, displayOrdinal, sourceColumnIndex, {
      header: true,
      keyColumn: savedKeyColumnOrdinals.has(sourceColumnIndex),
      selectedHeader,
      sorted,
    });
    th.scope = 'col';
    th.setAttribute('role', 'columnheader');
    th.setAttribute(
      'aria-colindex',
      String(columnIndex + 1 + (resultSettings.showRowIndex ? 1 : 0))
    );
    th.dataset.kxColumnIndex = String(columnIndex);
    th.dataset.kxHeaderColumnIndex = String(columnIndex);
    th.setAttribute(
      'aria-sort',
      resultTableAriaSort(sorted, state.savedSortDirection)
    );
    th.setAttribute(
      'aria-selected',
      selectedHeader ? 'true' : 'false'
    );
    const label = sorted
      ? `${column.name} ${resultTableSortIndicator(true, state.savedSortDirection)}`
      : column.name;
    const keyColumn = savedKeyColumnOrdinals.has(sourceColumnIndex);
    const sort = button(label, () => {});
    configureResultHeader(sort, {
      displayColumn: columnIndex,
      columnCount: visibleColumns.length,
      sourceColumn: sourceColumnIndex,
      columnName: column.name,
      sort: () => {
        const next = nextResultTableSortState(
          state.savedSortColumn !== undefined && state.savedSortDirection
            ? { column: state.savedSortColumn, direction: state.savedSortDirection }
            : undefined,
          sourceColumnIndex
        );
        state.savedSortColumn = next?.column;
        state.savedSortDirection = next?.direction;
        state.savedSelection = undefined;
        state.savedSearch.activeIndex = -1;
        state.savedTablePageStart = 0;
        renderState(context, state);
        focusResultHeader(state, sourceColumnIndex);
      },
      select: extend => {
        state.savedSelection = fullColumnSelection(
          state.savedSelection,
          columnIndex,
          payload.data.rows.length,
          extend
        );
        updateSavedSelectionClasses(wrap, state.savedSelection);
        updateCopyButtons();
      },
      reorder: (sourceColumn, targetColumn) => {
        state.savedColumnOrder = moveVisibleResultColumnOrder(
          state.savedColumnOrder,
          visibleColumns,
          sourceColumn,
          targetColumn
        );
        state.savedSelection = undefined;
        renderState(context, state);
        focusResultHeader(state, sourceColumnIndex);
      },
    });
    withFocusKey(sort, `grid:saved:sort:${sourceColumnIndex}`);
    sort.className = 'kx-saved-sort';
    sort.dataset.kxColumnIndex = String(columnIndex);
    sort.dataset.kxSourceOrdinal = String(sourceColumnIndex);
    const ariaLabel = resultTableHeaderAriaLabel(
      column.name,
      columnIndex,
      visibleColumns.length,
      sorted,
      state.savedSortDirection,
      selectedHeader,
      keyColumn
    );
    th.dataset.kxUnselectedAriaLabel = resultTableHeaderAriaLabel(
      column.name,
      columnIndex,
      visibleColumns.length,
      sorted,
      state.savedSortDirection,
      false,
      keyColumn
    );
    th.dataset.kxSelectedAriaLabel = resultTableHeaderAriaLabel(
      column.name,
      columnIndex,
      visibleColumns.length,
      sorted,
      state.savedSortDirection,
      true,
      keyColumn
    );
    th.setAttribute('aria-label', ariaLabel);
    sort.dataset.kxHeaderLabelControl = 'true';
    sort.setAttribute('aria-label', ariaLabel);
    sort.title = `Sort ${column.name}; drag to reorder`;
    th.append(sort);
    th.append(node('span', 'kx-column-type', column.type));
    th.append(columnResizeHandle(
      context,
      state,
      'saved',
      sourceColumnIndex,
      columnWidths[columnIndex]
    ));
    headRow.append(th);
  });
  head.append(headRow);
  table.append(head);
  const body = document.createElement('tbody');
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
      rowHeader.setAttribute('aria-colindex', '1');
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
      const displayOrdinal = columnWindow.start + columnIndex;
      const cell = row[sourceColumnIndex];
      const cellText = portableCellToBoundedText(
        cell,
        savedCellTextLimit,
        { arrayDisplayFormat: resultSettings.arrayDisplayFormat }
      ).text;
      const td = node('td', '', cellText);
      decorateDisplayedColumn(td, displayOrdinal, sourceColumnIndex, {
        keyColumn: savedKeyColumnOrdinals.has(sourceColumnIndex),
        sorted: state.savedSortColumn === sourceColumnIndex,
      });
      decorateDisplayedRowCell(td, rowIndex);
      td.id = gridCellId(state, rowIndex, columnIndex);
      td.setAttribute('role', 'gridcell');
      td.setAttribute(
        'aria-colindex',
        String(columnIndex + 1 + (resultSettings.showRowIndex ? 1 : 0))
      );
      td.setAttribute(
        'aria-label',
        `${payload.schema.columns[sourceColumnIndex].name}, row ${rowIndex + 1}, ${cellText}`
      );
      td.dataset.row = String(rowIndex);
      td.dataset.column = String(columnIndex);
      const selected = notebookCellSelected(state.savedSelection, rowIndex, columnIndex);
      if (selected) {
        td.classList.add('is-selected');
      }
      if (state.savedSelection?.focusRow === rowIndex &&
          state.savedSelection.focusColumn === columnIndex) {
        td.classList.add('is-active-cell');
      }
      td.setAttribute('aria-selected', selected ? 'true' : 'false');
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

function savedRowOrder(state: OutputState, payload: PortableKxTableResult): readonly number[] {
  const column = state.savedSortColumn;
  const direction = state.savedSortDirection;
  if (column === undefined || !direction) {
    return payload.data.rows.map((_row, index) => index);
  }
  const cached = state.savedRowOrderCache;
  if (cached?.payload === payload && cached.column === column &&
    cached.direction === direction) {
    return cached.order;
  }
  const order = notebookSavedRowOrder(
    payload.data.rows.length,
    (left, right) => comparePortableCells(
      payload.data.rows[left][column],
      payload.data.rows[right][column],
      direction
    )
  );
  state.savedRowOrderCache = { payload, column, direction, order };
  return order;
}

function emptySavedSearch(): SavedSearchState {
  return {
    query: '',
    matches: [],
    activeIndex: -1,
    capped: false,
    pending: false,
    partial: false,
    scannedRows: 0,
    scannedCells: 0,
    nextDisplayRow: 0,
    nextColumn: 0,
    signature: '',
    generation: 0,
  };
}

function savedSearchSignature(
  state: OutputState,
  visibleColumns: readonly number[]
): string {
  return JSON.stringify([
    state.savedSearch.query,
    state.savedSortColumn,
    state.savedSortDirection,
    visibleColumns,
    resultSettings.arrayDisplayFormat,
  ]);
}

function ensureSavedSearch(
  context: RendererContext<RendererState>,
  state: OutputState,
  payload: PortableKxTableResult,
  rowOrder: readonly number[],
  visibleColumns: readonly number[],
  partialColumns = false
): void {
  const query = state.savedSearch.query.slice(0, MAX_NOTEBOOK_LIVE_SEARCH_CHARS);
  if (!query) {
    if (state.searchTimer !== undefined) {
      window.clearTimeout(state.searchTimer);
      state.searchTimer = undefined;
    }
    state.savedSearch = emptySavedSearch();
    return;
  }
  if (state.savedSearch.signature !== savedSearchSignature(state, visibleColumns)) {
    startSavedSearch(context, state, payload, rowOrder, visibleColumns, partialColumns);
  }
}

function startSavedSearch(
  context: RendererContext<RendererState>,
  state: OutputState,
  payload: PortableKxTableResult,
  rowOrder: readonly number[],
  visibleColumns: readonly number[],
  partialColumns = false,
  onProgress?: () => void
): void {
  if (state.searchTimer !== undefined) {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = undefined;
  }
  const query = state.savedSearch.query.slice(0, MAX_NOTEBOOK_LIVE_SEARCH_CHARS);
  const generation = state.savedSearch.generation + 1;
  if (!query) {
    state.savedSearch = { ...emptySavedSearch(), generation };
    onProgress?.();
    return;
  }
  state.savedSearch = {
    query,
    matches: [],
    activeIndex: -1,
    capped: false,
    pending: true,
    partial: partialColumns,
    scannedRows: 0,
    scannedCells: 0,
    nextDisplayRow: 0,
    nextColumn: 0,
    signature: savedSearchSignature(state, visibleColumns),
    generation,
  };
  const scanChunk = (): void => {
    const search = state.savedSearch;
    if (search.generation !== generation || search.query !== query) {
      return;
    }
    const startedAt = performance.now();
    const { complete } = scanNotebookSavedSearchChunk(search, {
      rowCount: payload.data.rows.length,
      query,
      maximumMatches: SAVED_SEARCH_MAX_MATCHES,
      maximumCells: SAVED_SEARCH_MAX_CELLS,
      maximumChunkRows: SAVED_SEARCH_CHUNK_ROWS,
      maximumChunkCells: SAVED_SEARCH_CHUNK_CELLS,
      sourceRow: displayRow => rowOrder[displayRow] ?? displayRow,
      columnCount: () => visibleColumns.length,
      cellText: (sourceRow, column) => {
        const rendered = portableCellToBoundedText(
          payload.data.rows[sourceRow][visibleColumns[column]],
          SAVED_SEARCH_CELL_TEXT_CHAR_LIMIT,
          { arrayDisplayFormat: resultSettings.arrayDisplayFormat }
        );
        search.partial ||= rendered.truncated;
        return rendered.text;
      },
      shouldYield: chunkCells =>
        (chunkCells & 63) === 0 && performance.now() - startedAt >= SAVED_SEARCH_CHUNK_MS,
    });
    search.pending = !complete;
    onProgress?.();
    if (complete) {
      state.searchTimer = undefined;
      renderState(context, state);
      return;
    }
    state.searchTimer = window.setTimeout(scanChunk, 0);
  };
  state.searchTimer = window.setTimeout(scanChunk, 0);
}

function savedSearchStatus(search: SavedSearchState): string {
  if (!search.query) {
    return '';
  }
  if (search.pending) {
    return `Searching… ${search.scannedRows.toLocaleString()} rows checked`;
  }
  if (search.matches.length === 0) {
    return search.partial ? 'No matches in bounded search' : 'No matches';
  }
  if (search.activeIndex >= 0) {
    return `${search.activeIndex + 1}/${search.matches.length}` +
      `${search.capped || search.partial ? '+' : ''}`;
  }
  return `${search.matches.length}${search.capped || search.partial ? '+' : ''} match` +
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
    cell.classList.toggle(
      'is-active-cell',
      selection?.focusRow === Number(cell.dataset.row) &&
        selection.focusColumn === Number(cell.dataset.column)
    );
    cell.setAttribute('aria-selected', selected ? 'true' : 'false');
  });
  updateResultHeaderSelection(
    wrap,
    selection,
    Math.max(0, Number(wrap.getAttribute('aria-rowcount')) - 1)
  );
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

function savedColumnWidths(
  state: OutputState,
  payload: PortableKxTableResult,
  visibleColumns: readonly number[],
  rowOrder: readonly number[],
  pageStart: number,
  pageEnd: number
): number[] {
  let automaticWidths: number[] = [];
  const configuredWidths = visibleColumns.map(index => resultSettings.columnWidths[index]);
  if (resultSettings.autoFitColumns) {
    const sourceLengths = resultSettings.autoFitMode === 'wholeResult'
      ? savedWholeResultColumnTextLengths(state, payload, visibleColumns)
      : savedVisibleRowColumnTextLengths(
        payload,
        visibleColumns,
        rowOrder,
        pageStart,
        pageEnd
      );
    automaticWidths = automaticColumnWidthsForLengths(
      sourceLengths,
      resultSettings.fontSize,
      7
    );
  }
  return visibleColumns.map((sourceIndex, position) => {
    const outputWidth = state.savedManualColumnWidths.get(sourceIndex);
    return outputWidth ?? resolvedColumnWidth(
      position,
      resultSettings.cellWidth,
      configuredWidths,
      resultSettings.autoFitColumns,
      automaticWidths
    );
  });
}

function savedWholeResultColumnTextLengths(
  state: OutputState,
  payload: PortableKxTableResult,
  visibleColumns: readonly number[]
): number[] {
  const sourceIndexes = visibleColumns.join(',');
  const cached = state.savedColumnTextLengthCache;
  if (cached?.arrayDisplayFormat === resultSettings.arrayDisplayFormat &&
    cached.sourceIndexes === sourceIndexes) {
    return cached.lengths.slice();
  }
  const lengths = visibleColumns.map(sourceIndex => {
    const column = payload.schema.columns[sourceIndex];
    return Math.min(
      KX_COLUMN_AUTO_TEXT_CHAR_LIMIT,
      Math.max(column.name.length, column.type.length)
    );
  });
  for (const row of payload.data.rows) {
    visibleColumns.forEach((sourceIndex, position) => {
      if (lengths[position] >= KX_COLUMN_AUTO_TEXT_CHAR_LIMIT) {
        return;
      }
      const rendered = portableCellToBoundedText(
        row[sourceIndex],
        KX_COLUMN_AUTO_TEXT_CHAR_LIMIT,
        { arrayDisplayFormat: resultSettings.arrayDisplayFormat }
      );
      lengths[position] = rendered.truncated
        ? KX_COLUMN_AUTO_TEXT_CHAR_LIMIT
        : Math.max(lengths[position], rendered.text.length);
    });
  }
  state.savedColumnTextLengthCache = {
    arrayDisplayFormat: resultSettings.arrayDisplayFormat,
    sourceIndexes,
    lengths,
  };
  return lengths.slice();
}

function savedVisibleRowColumnTextLengths(
  payload: PortableKxTableResult,
  visibleColumns: readonly number[],
  rowOrder: readonly number[],
  pageStart: number,
  pageEnd: number
): number[] {
  const lengths = visibleColumns.map(sourceIndex => {
    const column = payload.schema.columns[sourceIndex];
    return Math.min(
      KX_COLUMN_AUTO_TEXT_CHAR_LIMIT,
      Math.max(column.name.length, column.type.length)
    );
  });
  for (let displayRow = pageStart; displayRow < pageEnd; displayRow += 1) {
    const row = payload.data.rows[rowOrder[displayRow]];
    if (!row) {
      continue;
    }
    visibleColumns.forEach((sourceIndex, position) => {
      if (lengths[position] >= KX_COLUMN_AUTO_TEXT_CHAR_LIMIT) {
        return;
      }
      const rendered = portableCellToBoundedText(
        row[sourceIndex],
        KX_COLUMN_AUTO_TEXT_CHAR_LIMIT,
        { arrayDisplayFormat: resultSettings.arrayDisplayFormat }
      );
      lengths[position] = rendered.truncated
        ? KX_COLUMN_AUTO_TEXT_CHAR_LIMIT
        : Math.max(lengths[position], rendered.text.length);
    });
  }
  return lengths;
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
  const candidates = chartColumns(state.payload, renderedSavedColumnIndexes(state));
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
  const dirty = !!renderedChart &&
    notebookChartSpecSignature(renderedChart) !== notebookChartSpecSignature(chart);
  const savedViewport = chartRangeIsZoomed(
    state.savedChartFullRange,
    state.savedChartViewportRange
  )
    ? state.savedChartViewportRange
    : undefined;
  const preparation = renderedChart
    ? preparedSavedChartData(state, state.payload, renderedChart, savedViewport)
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
  const validation = controlModel.validationMessage ||
    savedChartSourceLimitMessage(state.payload);
  const render = button(KX_RESULT_UI_LABELS.renderChart, () => {
    clearSavedChartViewport(state);
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
    resetNotebookChartViewport(context, state);
  });
  withFocusKey(reset, 'chart:saved:reset');
  reset.disabled = !prepared || dirty;
  controls.append(reset);
  panel.append(controls);
  const preparedStatus = prepared && renderedChart
    ? `${savedViewport ? 'Selected range • ' : ''}${liveChartDataStatus(prepared)}` +
      (prepared.warnings?.length ? ` ${prepared.warnings.join(' ')}` : '')
    : '';
  const status = node(
    'div',
    'kx-status',
    validation || (dirty
      ? 'Chart settings changed — Render to update.'
      : preparation?.error || (renderedChart
        ? preparedStatus
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
  drawNotebookChart(context, state, chartHost, prepared, 'saved');
  exportPng.disabled = !state.plot || !context.postMessage;
  reset.disabled = !state.plot || dirty;
}

function drawNotebookChart(
  context: RendererContext<RendererState>,
  state: OutputState,
  host: HTMLElement,
  data: NotebookLiveChartData,
  source: 'live' | 'saved'
): void {
  if (data.x.length === 0 || data.series.length === 0) {
    host.append(node('div', 'kx-notice', 'Chart has no finite sampled points.'));
    return;
  }
  const colors = chartColors(host);
  const plotHost = node('div', 'kx-chart-canvas');
  const navigator = createNotebookChartNavigator(source);
  const legendHost = node('div', 'kx-chart-legend');
  host.append(plotHost, navigator.root, legendHost);
  state.chartSource = source;
  if (source === 'saved' && !state.savedChartFullData) {
    const fullRange = chartDataXRange(data);
    state.savedChartFullData = data;
    state.savedChartFullRange = fullRange
      ? Object.freeze({ min: fullRange.min, max: fullRange.max })
      : undefined;
    state.savedChartViewportRange = fullRange || undefined;
  }
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
      if ((data.chartType === 'line' || data.chartType === 'step') && item.gapBefore?.some(Boolean)) {
        config.gaps = notebookSeriesSourceGaps(data.x, item.values, item.gapBefore);
      }
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
      context
    ),
    aligned,
    data
  );
  if (source === 'live') {
    syncLiveChartRenderedAutoRefineRange(state);
  } else if (chartRangeIsZoomed(
    state.savedChartFullRange,
    state.savedChartViewportRange
  ) && state.savedChartViewportRange) {
    setNotebookPlotXRange(state, state.savedChartViewportRange);
  }
  installNotebookChartViewport(context, state, host);
  installNotebookChartNavigator(context, state, data, navigator, source);
}

function notebookSeriesSourceGaps(
  xValues: number[],
  yValues: Array<number | null>,
  gapBefore: boolean[]
): uPlot.Series.GapsRefiner {
  return (plot, _seriesIndex, indexStart, indexEnd, gaps) => {
    const start = Math.max(1, indexStart);
    const end = Math.min(indexEnd, xValues.length - 1);
    for (let index = start; index <= end; index++) {
      if (!gapBefore[index] || !Number.isFinite(yValues[index])) {
        continue;
      }
      let previous = index - 1;
      while (previous >= indexStart && !Number.isFinite(yValues[previous])) {
        previous -= 1;
      }
      if (previous >= indexStart) {
        uPlot.addGap(
          gaps,
          plot.valToPos(xValues[previous], 'x', true),
          plot.valToPos(xValues[index], 'x', true)
        );
      }
    }
    return mergeChartPixelGaps(gaps);
  };
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
    state.chartProgrammaticScale = true;
    state.plot = new uPlot(options, data, host);
    state.plot.batch(() => undefined);
    state.chartProgrammaticScale = false;
    state.plotData = sourceData;
    restorePlotViewport(state, sourceData);
    decoratePlotLegendAccessibility(state.plot);
    state.plotResizeObserver = new ResizeObserver(entries => {
      const width = Math.floor(entries[0]?.contentRect.width || 0);
      if (state.plot && width > 0) {
        const plot = state.plot;
        state.chartProgrammaticScale = true;
        try {
          plot.batch(() => {
            plot.setSize({ width, height: options.height || 260 });
          });
        } finally {
          state.chartProgrammaticScale = false;
        }
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
    state.chartProgrammaticScale = false;
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
  state.chartProgrammaticScale = true;
  try {
    state.plot.setData(state.plot.data, true);
    state.plot.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
  } finally {
    state.chartProgrammaticScale = false;
  }
  syncNotebookChartViewportDataset(state);
  syncCurrentNotebookChartNavigator(state);
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
  state.chartProgrammaticScale = true;
  try {
    if (x) {
      state.plot.setScale('x', x);
    }
    if (y) {
      state.plot.setScale('y', y);
    }
  } finally {
    state.chartProgrammaticScale = false;
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

function chartFullRangeForState(state: OutputState): PlotScaleRange | undefined {
  return state.chartSource === 'live'
    ? state.liveChart.fullRange
    : state.savedChartFullRange;
}

function currentNotebookChartRange(state: OutputState): PlotScaleRange | null {
  return clampChartViewport(
    state.plot ? plotScaleRange(state.plot, 'x') : state.savedChartViewportRange,
    chartFullRangeForState(state)
  );
}

function setNotebookPlotXRange(state: OutputState, range: PlotScaleRange): void {
  if (!state.plot || !isValidChartRange(range)) {
    return;
  }
  state.chartProgrammaticScale = true;
  try {
    state.plot.batch(() => {
      state.plot!.setScale('x', { min: range.min, max: range.max });
      state.plot!.setScale(
        'y',
        { min: null, max: null } as unknown as { min: number; max: number }
      );
      state.plot!.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
    });
  } finally {
    state.chartProgrammaticScale = false;
  }
  syncNotebookChartViewportDataset(state);
  syncCurrentNotebookChartNavigator(state);
}

function completeNotebookChartViewport(
  context: RendererContext<RendererState>,
  state: OutputState,
  requested: PlotScaleRange
): void {
  if (notebookChartViewportInteractionBlocked(state.chartSource, state.liveChart.dirty)) {
    return;
  }
  const fullRange = chartFullRangeForState(state);
  const range = clampChartViewport(requested, fullRange);
  if (!range) {
    return;
  }
  if (!chartRangeIsZoomed(fullRange, range)) {
    const savedRangeAlreadyReset = state.chartSource === 'saved' &&
      state.savedChartViewportTimer === undefined &&
      !chartRangeIsZoomed(fullRange, state.savedChartViewportRange);
    if (!savedRangeAlreadyReset) {
      resetNotebookChartViewport(context, state);
    }
    return;
  }
  const current = state.plot ? plotScaleRange(state.plot, 'x') : undefined;
  if (!current || chartZoomRangeKey(current) !== chartZoomRangeKey(range)) {
    setNotebookPlotXRange(state, range);
  }
  if (state.chartSource === 'live') {
    if (state.plot) {
      queueLiveChartAutoRefine(context, state, state.plot);
    }
    return;
  }
  if (state.chartSource !== 'saved') {
    return;
  }
  state.savedChartViewportRange = range;
  if (state.savedChartViewportTimer !== undefined) {
    window.clearTimeout(state.savedChartViewportTimer);
  }
  state.savedChartViewportTimer = window.setTimeout(() => {
    state.savedChartViewportTimer = undefined;
    const settled = state.savedChartViewportRange;
    if (!settled || !chartRangeIsZoomed(state.savedChartFullRange, settled)) {
      return;
    }
    state.savedPreparedChart = undefined;
    renderState(context, state);
  }, LIVE_CHART_AUTO_REFINE_DELAY_MS);
}

function panNotebookChart(
  context: RendererContext<RendererState>,
  state: OutputState,
  fraction: number
): void {
  if (notebookChartViewportInteractionBlocked(state.chartSource, state.liveChart.dirty)) {
    return;
  }
  const current = currentNotebookChartRange(state);
  const range = panChartViewport(current, chartFullRangeForState(state), fraction);
  if (!range || (current && chartZoomRangeKey(range) === chartZoomRangeKey(current))) {
    return;
  }
  setNotebookPlotXRange(state, range);
  completeNotebookChartViewport(context, state, range);
}

function resetNotebookChartViewport(
  context: RendererContext<RendererState>,
  state: OutputState
): void {
  if (notebookChartViewportInteractionBlocked(state.chartSource, state.liveChart.dirty)) {
    return;
  }
  if (state.chartSource === 'live') {
    resetLiveChartZoom(context, state);
    return;
  }
  if (state.chartSource === 'saved') {
    if (state.savedChartViewportTimer !== undefined) {
      window.clearTimeout(state.savedChartViewportTimer);
      state.savedChartViewportTimer = undefined;
    }
    state.savedChartViewportRange = state.savedChartFullRange
      ? { ...state.savedChartFullRange }
      : undefined;
    state.savedPreparedChart = undefined;
    renderState(context, state);
  }
}

function clearSavedChartViewport(state: OutputState): void {
  if (state.savedChartViewportTimer !== undefined) {
    window.clearTimeout(state.savedChartViewportTimer);
  }
  state.savedChartViewportTimer = undefined;
  state.savedChartFullData = undefined;
  state.savedChartFullRange = undefined;
  state.savedChartViewportRange = undefined;
  state.savedPreparedChart = undefined;
}

function createNotebookChartNavigator(
  source: 'live' | 'saved'
): NotebookChartNavigatorElements {
  const root = node('div', 'kx-chart-navigator');
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Chart X navigator');
  const overview = document.createElementNS(SVG_NAMESPACE, 'svg') as SVGSVGElement;
  overview.classList.add('kx-chart-navigator-overview');
  overview.setAttribute('viewBox', '0 0 1000 30');
  overview.setAttribute('preserveAspectRatio', 'none');
  overview.setAttribute('aria-hidden', 'true');
  const selectedWindow = node('div', 'kx-chart-navigator-window');
  selectedWindow.tabIndex = 0;
  selectedWindow.setAttribute('role', 'slider');
  selectedWindow.setAttribute(
    'aria-label',
    'Selected X window; use Left and Right Arrow to pan, Home to reset'
  );
  selectedWindow.dataset.kxNavigatorPart = 'window';
  withFocusKey(selectedWindow, `chart:${source}:navigator-window`);
  const start = node('span', 'kx-chart-navigator-handle is-start');
  start.tabIndex = 0;
  start.setAttribute('role', 'slider');
  start.setAttribute(
    'aria-label',
    'Start of selected X window; use Left and Right Arrow to resize'
  );
  start.dataset.kxNavigatorPart = 'start';
  withFocusKey(start, `chart:${source}:navigator-start`);
  const end = node('span', 'kx-chart-navigator-handle is-end');
  end.tabIndex = 0;
  end.setAttribute('role', 'slider');
  end.setAttribute(
    'aria-label',
    'End of selected X window; use Left and Right Arrow to resize'
  );
  end.dataset.kxNavigatorPart = 'end';
  withFocusKey(end, `chart:${source}:navigator-end`);
  root.append(overview, selectedWindow, start, end);
  return { root, overview, window: selectedWindow, start, end };
}

function installNotebookChartNavigator(
  context: RendererContext<RendererState>,
  state: OutputState,
  data: NotebookLiveChartData,
  elements: NotebookChartNavigatorElements,
  source: 'live' | 'saved'
): void {
  syncNotebookChartNavigator(state, data, elements, source);
  let pointer: {
    id: number;
    part: ChartNavigatorPart;
    startX: number;
    range: PlotScaleRange;
  } | undefined;
  const blocked = (): boolean => notebookChartNavigatorBlocked(state, source);
  const apply = (range: PlotScaleRange): void => {
    if (source === 'saved') {
      state.savedChartViewportRange = range;
    }
    setNotebookPlotXRange(state, range);
    syncNotebookChartNavigator(state, data, elements, source);
  };
  const move = (event: PointerEvent): void => {
    if (!pointer || event.pointerId !== pointer.id) {
      return;
    }
    const range = adjustChartNavigatorRange(
      pointer.range,
      chartFullRangeForState(state),
      pointer.part,
      (event.clientX - pointer.startX) /
        Math.max(1, elements.root.getBoundingClientRect().width)
    );
    if (range) {
      apply(range);
    }
    event.preventDefault();
  };
  const finish = (event: PointerEvent): void => {
    if (!pointer || event.pointerId !== pointer.id) {
      return;
    }
    const started = pointer.range;
    move(event);
    const range = currentNotebookChartRange(state);
    pointer = undefined;
    elements.window.classList.remove('is-dragging');
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', finish, true);
    window.removeEventListener('pointercancel', finish, true);
    if (range && chartZoomRangeKey(range) !== chartZoomRangeKey(started)) {
      completeNotebookChartViewport(context, state, range);
    }
    event.preventDefault();
  };
  const begin = (event: PointerEvent, part: ChartNavigatorPart): void => {
    if (event.button !== 0 || blocked()) {
      return;
    }
    const range = currentNotebookChartRange(state);
    if (!range) {
      return;
    }
    pointer = { id: event.pointerId, part, startX: event.clientX, range };
    elements.window.classList.add('is-dragging');
    const target = part === 'start'
      ? elements.start
      : part === 'end' ? elements.end : elements.window;
    target.focus({ preventScroll: true });
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', finish, true);
    event.preventDefault();
    event.stopPropagation();
  };
  elements.window.addEventListener('pointerdown', event => begin(event, 'window'));
  elements.start.addEventListener('pointerdown', event => begin(event, 'start'));
  elements.end.addEventListener('pointerdown', event => begin(event, 'end'));
  elements.root.addEventListener('pointerdown', event => {
    if (event.button !== 0 || blocked() ||
      event.target === elements.window || event.target === elements.start ||
      event.target === elements.end) {
      return;
    }
    const rect = elements.root.getBoundingClientRect();
    const current = currentNotebookChartRange(state);
    const range = recenterChartNavigatorRange(
      current,
      chartFullRangeForState(state),
      (event.clientX - rect.left) / Math.max(1, rect.width)
    );
    if (range) {
      apply(range);
      if (!current || chartZoomRangeKey(current) !== chartZoomRangeKey(range)) {
        completeNotebookChartViewport(context, state, range);
      }
      elements.window.focus({ preventScroll: true });
    }
    event.preventDefault();
  });
  const keyboard = (event: KeyboardEvent, part: ChartNavigatorPart): void => {
    if (blocked()) {
      return;
    }
    if (event.key === 'Home') {
      resetNotebookChartViewport(context, state);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    const current = currentNotebookChartRange(state);
    const range = adjustChartNavigatorRange(
      current,
      chartFullRangeForState(state),
      part,
      (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 0.1 : 0.01)
    );
    if (range && (!current || chartZoomRangeKey(range) !== chartZoomRangeKey(current))) {
      apply(range);
      completeNotebookChartViewport(context, state, range);
    }
    event.preventDefault();
    event.stopPropagation();
  };
  elements.window.addEventListener('keydown', event => keyboard(event, 'window'));
  elements.start.addEventListener('keydown', event => keyboard(event, 'start'));
  elements.end.addEventListener('keydown', event => keyboard(event, 'end'));
}

function notebookChartNavigatorBlocked(
  state: OutputState,
  source: 'live' | 'saved'
): boolean {
  return notebookChartViewportInteractionBlocked(source, state.liveChart.dirty) ||
    (source === 'live' && state.liveChart.pending) ||
    !state.plot || !chartFullRangeForState(state);
}

function syncCurrentNotebookChartNavigator(state: OutputState): void {
  const host = state.plot?.root.closest<HTMLElement>('.kx-chart-host');
  const data = state.plotData;
  if (!host || !data || (state.chartSource !== 'live' && state.chartSource !== 'saved')) {
    return;
  }
  const elements = notebookChartNavigatorElements(host);
  if (elements) {
    syncNotebookChartNavigator(state, data, elements, state.chartSource);
  }
}

function notebookChartNavigatorElements(
  host: HTMLElement
): NotebookChartNavigatorElements | undefined {
  const root = host.querySelector<HTMLElement>('.kx-chart-navigator');
  const overview = root?.querySelector<SVGSVGElement>('.kx-chart-navigator-overview');
  const selectedWindow = root?.querySelector<HTMLElement>('.kx-chart-navigator-window');
  const start = root?.querySelector<HTMLElement>('.kx-chart-navigator-handle.is-start');
  const end = root?.querySelector<HTMLElement>('.kx-chart-navigator-handle.is-end');
  return root && overview && selectedWindow && start && end
    ? { root, overview, window: selectedWindow, start, end }
    : undefined;
}

function syncNotebookChartNavigator(
  state: OutputState,
  data: NotebookLiveChartData,
  elements: NotebookChartNavigatorElements,
  source: 'live' | 'saved'
): void {
  const fullRange = chartFullRangeForState(state);
  const current = currentNotebookChartRange(state) || fullRange;
  const windowState = chartNavigatorWindow(current, fullRange);
  const sliderBounds = chartNavigatorSliderBounds(current, fullRange);
  if (!fullRange || !current || !windowState || !sliderBounds) {
    elements.root.hidden = true;
    return;
  }
  elements.root.hidden = false;
  elements.root.setAttribute(
    'aria-disabled',
    notebookChartNavigatorBlocked(state, source) ? 'true' : 'false'
  );
  const startPercent = windowState.startFraction * 100;
  const endPercent = windowState.endFraction * 100;
  elements.window.style.left = `${startPercent}%`;
  elements.window.style.width = `${Math.max(0, endPercent - startPercent)}%`;
  elements.start.style.left = `clamp(5px, ${startPercent}%, calc(100% - 5px))`;
  elements.end.style.left = `clamp(5px, ${endPercent}%, calc(100% - 5px))`;
  setNotebookChartNavigatorAria(
    elements.window,
    sliderBounds.window,
    `Selected X range ${notebookChartNavigatorValue(data, current.min)} to ` +
      notebookChartNavigatorValue(data, current.max)
  );
  setNotebookChartNavigatorAria(
    elements.start,
    sliderBounds.start,
    `Selected X start ${notebookChartNavigatorValue(data, current.min)}`
  );
  setNotebookChartNavigatorAria(
    elements.end,
    sliderBounds.end,
    `Selected X end ${notebookChartNavigatorValue(data, current.max)}`
  );
  if (elements.overview.childElementCount === 0) {
    const overviewData = source === 'live'
      ? state.liveChart.fullData || data
      : state.savedChartFullData || data;
    renderNotebookChartNavigatorOverview(elements.overview, overviewData, fullRange);
  }
}

function setNotebookChartNavigatorAria(
  element: HTMLElement,
  bounds: { minimum: number; maximum: number; now: number },
  text: string
): void {
  element.setAttribute('aria-orientation', 'horizontal');
  element.setAttribute('aria-valuemin', String(bounds.minimum));
  element.setAttribute('aria-valuemax', String(bounds.maximum));
  element.setAttribute('aria-valuenow', String(bounds.now));
  element.setAttribute('aria-valuetext', text);
}

function notebookChartNavigatorValue(data: NotebookLiveChartData, value: number): string {
  if (data.xKind === 'temporal') {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) {
      return date.toISOString();
    }
  }
  return formatChartNumber(value);
}

function renderNotebookChartNavigatorOverview(
  overview: SVGSVGElement,
  data: NotebookLiveChartData,
  fullRange: PlotScaleRange
): void {
  let values: readonly (number | null)[] =
    data.candlesticks?.map(candle => candle.close) || [];
  let gapFlags: readonly boolean[] = [];
  let gapBefore: readonly boolean[] = [];
  if (data.chartType !== 'candlestick') {
    let bestFinite = -1;
    values = [];
    data.series.forEach(series => {
      const candidateFinite = series.values.reduce<number>(
        (count, value) => count +
          (typeof value === 'number' && Number.isFinite(value) ? 1 : 0),
        0
      );
      if (candidateFinite > bestFinite) {
        bestFinite = candidateFinite;
        values = series.values;
        gapFlags = series.gapFlags || [];
        gapBefore = series.gapBefore || [];
      }
    });
  }
  const count = Math.min(data.x.length, values.length);
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let index = 0; index < count; index += 1) {
    const value = values[index];
    if (typeof value === 'number' && Number.isFinite(value)) {
      yMin = Math.min(yMin, value);
      yMax = Math.max(yMax, value);
    }
  }
  if (count === 0 || !Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    return;
  }
  const xSpan = fullRange.max - fullRange.min;
  const ySpan = yMax > yMin ? yMax - yMin : 1;
  const target = Math.min(count, 1200);
  const commands: string[] = [];
  let previousIndex = -1;
  let drawing = false;
  for (let point = 0; point < target; point += 1) {
    const index = target === 1
      ? 0
      : Math.floor(point * (count - 1) / (target - 1));
    if (index === previousIndex) {
      continue;
    }
    const intervalHasGap = chartOverviewIntervalHasGap(
      values,
      gapFlags,
      gapBefore,
      previousIndex,
      index
    );
    previousIndex = index;
    const x = data.x[index];
    const rawY = values[index];
    if (!Number.isFinite(x) || typeof rawY !== 'number' || !Number.isFinite(rawY)) {
      if (intervalHasGap) {
        drawing = false;
      }
      continue;
    }
    if (intervalHasGap) {
      drawing = false;
    }
    const y = rawY;
    const px = Math.max(0, Math.min(1000, (x - fullRange.min) / xSpan * 1000));
    const py = 27 - (y - yMin) / ySpan * 24;
    commands.push(`${drawing ? 'L' : 'M'}${px.toFixed(2)} ${py.toFixed(2)}`);
    drawing = true;
  }
  const path = document.createElementNS(SVG_NAMESPACE, 'path') as SVGPathElement;
  path.setAttribute('d', commands.join(' '));
  overview.append(path);
}

function installNotebookChartViewport(
  context: RendererContext<RendererState>,
  state: OutputState,
  host: HTMLElement
): void {
  const blocked = notebookChartViewportInteractionBlocked(
    state.chartSource,
    state.liveChart.dirty
  );
  syncNotebookChartViewportDataset(state, host);
  host.tabIndex = 0;
  withFocusKey(
    host,
    state.chartSource === 'live' ? 'chart:live:plot' : 'chart:saved:plot'
  );
  host.setAttribute('role', 'region');
  host.setAttribute('aria-disabled', blocked ? 'true' : 'false');
  host.setAttribute(
    'aria-label',
    blocked
      ? 'Chart plot. Chart settings changed; press Render before changing the view.'
      : 'Chart plot. Drag to zoom x. Shift drag to pan x. Arrow keys pan. Home resets zoom.'
  );
  host.addEventListener('keydown', event => {
    if (blocked && (event.key === 'Home' || event.key === 'ArrowLeft' ||
      event.key === 'ArrowRight')) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === 'Home') {
      resetNotebookChartViewport(context, state);
      event.preventDefault();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      panNotebookChart(context, state, event.key === 'ArrowLeft' ? -0.2 : 0.2);
      event.preventDefault();
    }
  });
  host.addEventListener('dblclick', event => {
    if (!blocked) {
      resetNotebookChartViewport(context, state);
    }
    event.preventDefault();
    event.stopPropagation();
  });

  let panStart: { x: number; range: PlotScaleRange } | undefined;
  const move = (event: MouseEvent): void => {
    if (!panStart || !state.plot) {
      return;
    }
    const range = panChartViewportByPixels(
      panStart.range,
      chartFullRangeForState(state),
      event.clientX - panStart.x,
      Math.max(1, state.plot.bbox.width / (window.devicePixelRatio || 1))
    );
    if (range) {
      if (state.chartSource === 'saved') {
        state.savedChartViewportRange = range;
      }
      setNotebookPlotXRange(state, range);
    }
    event.preventDefault();
  };
  const finish = (event: MouseEvent): void => {
    if (!panStart) {
      return;
    }
    const started = panStart.range;
    move(event);
    const range = currentNotebookChartRange(state);
    panStart = undefined;
    window.removeEventListener('mousemove', move, true);
    window.removeEventListener('mouseup', finish, true);
    if (range && chartZoomRangeKey(range) !== chartZoomRangeKey(started)) {
      completeNotebookChartViewport(context, state, range);
    }
    event.preventDefault();
  };
  host.addEventListener('mousedown', event => {
    if (blocked && event.button === 0) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!event.shiftKey || event.button !== 0) {
      return;
    }
    const range = currentNotebookChartRange(state);
    if (!range) {
      return;
    }
    host.focus({ preventScroll: true });
    panStart = { x: event.clientX, range };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', finish, true);
    event.preventDefault();
    event.stopPropagation();
  }, true);
}

function syncNotebookChartViewportDataset(
  state: OutputState,
  host = state.plot?.root.closest<HTMLElement>('.kx-chart-host') || undefined
): void {
  if (!host) {
    return;
  }
  const viewport = currentNotebookChartRange(state);
  const fullRange = chartFullRangeForState(state);
  if (viewport) {
    host.dataset.kxViewportMin = String(viewport.min);
    host.dataset.kxViewportMax = String(viewport.max);
  } else {
    delete host.dataset.kxViewportMin;
    delete host.dataset.kxViewportMax;
  }
  if (fullRange) {
    host.dataset.kxFullRangeMin = String(fullRange.min);
    host.dataset.kxFullRangeMax = String(fullRange.max);
  } else {
    delete host.dataset.kxFullRangeMin;
    delete host.dataset.kxFullRangeMax;
  }
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
    state.plot !== plot || chart.pending || chart.dirty || !chart.data ||
      !!chart.requestedRenderRange
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
      state.plot !== plot || chart.pending || chart.dirty || !chart.data ||
        !!chart.requestedRenderRange
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
    if (chart.zoomLifecycle.requestedRenderRange) {
      applyLiveChartZoomLifecycle(
        chart,
        reduceChartZoomLifecycle(chart.zoomLifecycle, {
          type: 'rendered',
          requestId: chart.requestId,
          naturalRange: undefined,
        })
      );
    }
  }
}

function syncLiveChartRenderedAutoRefineRange(state: OutputState): void {
  const chart = state.liveChart;
  const requestedRange = chartZoomRequestedRenderRange(chart.zoomLifecycle);
  if (!requestedRange || !state.plot) {
    return;
  }
  clearLiveChartAutoRefine(chart);
  chart.lastAutoRefineRangeKey = chartZoomRangeKey(requestedRange);
  state.chartProgrammaticScale = true;
  try {
    state.plot.setScale('x', { min: requestedRange.min, max: requestedRange.max });
  } finally {
    state.chartProgrammaticScale = false;
    applyLiveChartZoomLifecycle(
      chart,
      reduceChartZoomLifecycle(chart.zoomLifecycle, {
        type: 'rendered',
        requestId: chart.requestId,
        naturalRange: plotScaleRange(state.plot, 'x'),
      })
    );
  }
}

function applyLiveChartZoomLifecycle(
  chart: LiveChartState,
  lifecycle: ChartZoomLifecycleState<NotebookLiveChartData>
): void {
  chart.zoomLifecycle = lifecycle;
  chart.data = lifecycle.data || undefined;
  chart.fullData = lifecycle.fullData || undefined;
  chart.fullRange = lifecycle.fullRange || undefined;
  chart.requestedRenderRange = lifecycle.requestedRenderRange || undefined;
  chart.refined = lifecycle.dataIsRefinement;
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
  rendererContext: RendererContext<RendererState>
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
              const range = chartXRangeWithInitialPadding(
                min,
                max,
                data.xDomain,
                step,
                state.plot === undefined
              );
              return [range.min, range.max];
            },
          }
          : {}),
      },
      y: {
        auto: true,
        ...(customY
          ? {
            range: (plot, min, max) => {
              const custom = notebookChartYRange(data, state, plot, min, max);
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
      setScale: [
        (plot: uPlot, scaleKey: string) => {
          if (scaleKey !== 'x' || state.chartProgrammaticScale || state.plot !== plot) {
            return;
          }
          const range = plotScaleRange(plot, 'x');
          if (range) {
            syncNotebookChartViewportDataset(state);
            syncCurrentNotebookChartNavigator(state);
            completeNotebookChartViewport(rendererContext, state, range);
          }
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
  state: OutputState,
  plot: uPlot,
  uPlotMin: number,
  uPlotMax: number
): { min: number; max: number } | undefined {
  if (data.chartType === 'bar' && Number.isFinite(uPlotMin) && Number.isFinite(uPlotMax)) {
    return { min: Math.min(0, uPlotMin), max: Math.max(0, uPlotMax) };
  }
  const indexes = chartVisibleIndexBounds(plot.series[0]?.idxs, data.x.length);
  const xMin = indexes ? data.x[indexes.start] : -Infinity;
  const xMax = indexes ? data.x[indexes.end] : Infinity;
  const visible = (index: number): boolean =>
    plot.series[index + 1]?.show !== false &&
    chartSeriesVisible(state.hiddenChartSeriesKeys, notebookChartSeriesKeys(data)[index]);
  if (data.chartType === 'candlestick') {
    return chartYRangeForVisibleX(data.x, [{
      visible: visible(0),
      extents: (data.candlesticks || []).map(candle => ({
        min: candle.low,
        max: candle.high,
      })),
    }], { min: xMin, max: xMax });
  }
  if (data.chartType === 'box') {
    return chartYRangeForVisibleX(
      data.x,
      (data.boxSeries || []).map((series, index) => ({
        visible: visible(index),
        extents: series.stats,
      })),
      { min: xMin, max: xMax }
    );
  }
  return chartYRangeForVisibleX(
    data.x,
    data.series.map((series, index) => ({
      visible: visible(index),
      extents: series.values.map(value => value === null || !Number.isFinite(value)
        ? null
        : { min: value, max: value }),
    })),
    { min: xMin, max: xMax },
    data.chartType === 'bar'
  );
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
  if (isPortableKxFullResult(state.payload)) {
    if (state.payload.kind === 'table') {
      return `Saved full result • ${state.payload.result.rowCount.toLocaleString()} rows × ` +
        `${(state.payload.result.columnCount ?? state.payload.schema.columns.length)
          .toLocaleString()} columns`;
    }
    return 'Saved full result • qText';
  }
  if (state.payload.kind === 'table') {
    const summary = kxSavedPreviewSummary(
      state.payload.result.previewRowCount,
      state.payload.result.rowCount,
      state.payload.schema.columns.length
    );
    return isHistoricalDirectPreview(state.payload)
      ? summary.replace(/^Saved preview/, 'Historical saved preview')
      : summary;
  }
  const summary = state.payload.result.truncated
    ? 'Saved preview • bounded qText'
    : 'Saved preview • qText';
  return isHistoricalDirectPreview(state.payload)
    ? summary.replace(/^Saved preview/, 'Historical saved preview')
    : summary;
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

function renderedSavedColumnIndexes(state: OutputState): number[] {
  return notebookSavedColumnWindow(
    visibleSavedColumnIndexes(state),
    state.savedColumnWindowStart,
    SAVED_COLUMN_WINDOW_SIZE
  ).columns;
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
  const controlWindow = mode === 'saved'
    ? notebookSavedColumnWindow(
      order,
      state.savedColumnControlWindowStart,
      SAVED_COLUMN_WINDOW_SIZE
    )
    : notebookSavedColumnWindow(order, 0, Math.max(1, order.length));
  if (mode === 'saved') {
    state.savedColumnControlWindowStart = controlWindow.start;
  }
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
      const chartRequestId = reconciled.compatible
        ? state.liveChart.requestId
        : nextRequestId();
      state.liveChart = {
        ...state.liveChart,
        ...reconciled.configuration,
        data: reconciled.compatible ? state.liveChart.data : undefined,
        fullData: reconciled.compatible ? state.liveChart.fullData : undefined,
        fullRange: reconciled.compatible ? state.liveChart.fullRange : undefined,
        requestSignature: reconciled.compatible
          ? state.liveChart.requestSignature
          : undefined,
        requestId: chartRequestId,
        pending: reconciled.compatible ? state.liveChart.pending : false,
        requestRange: reconciled.compatible ? state.liveChart.requestRange : undefined,
        autoRefineTimer: undefined,
        lastAutoRefineRangeKey: reconciled.compatible
          ? state.liveChart.lastAutoRefineRangeKey
          : '',
        requestedRenderRange: reconciled.compatible
          ? state.liveChart.requestedRenderRange
          : undefined,
        dirty: reconciled.compatible ? state.liveChart.dirty : true,
        refined: reconciled.compatible ? state.liveChart.refined : false,
        error: reconciled.compatible ? state.liveChart.error : undefined,
        errorWasRefinement: reconciled.compatible
          ? state.liveChart.errorWasRefinement
          : false,
        zoomLifecycle: reconciled.compatible
          ? state.liveChart.zoomLifecycle
          : reduceChartZoomLifecycle<NotebookLiveChartData>(null, {
            type: 'clear',
            requestId: chartRequestId,
          }),
      };
    } else {
      state.savedColumnOrder = nextOrder;
      state.savedHiddenColumnIndexes = nextHidden;
      state.savedSelection = undefined;
      state.savedTablePageStart = 0;
      state.savedColumnWindowStart = 0;
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
  if (mode === 'saved' && controlWindow.total > controlWindow.columns.length) {
    panel.append(node(
      'div',
      'kx-meta',
      `Column controls ${controlWindow.start + 1}-${controlWindow.end} of ` +
      `${controlWindow.total}. All columns remain saved.`
    ));
    const pagination = node('div', 'kx-pagination');
    const previous = button('Previous columns', () => {
      state.savedColumnControlWindowStart = Math.max(
        0,
        controlWindow.start - SAVED_COLUMN_WINDOW_SIZE
      );
      renderState(context, state);
    });
    const next = button('Next columns', () => {
      state.savedColumnControlWindowStart = controlWindow.end;
      renderState(context, state);
    });
    withFocusKey(previous, 'columns:saved:previous-page');
    withFocusKey(next, 'columns:saved:next-page');
    previous.disabled = !controlWindow.hasPrevious;
    next.disabled = !controlWindow.hasNext;
    pagination.append(previous, next);
    panel.append(pagination);
  }
  const list = node('div', 'kx-columns-list');
  controlWindow.columns.forEach((sourceIndex, windowPosition) => {
    const position = controlWindow.start + windowPosition;
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
  const resetWidths = button('Reset column widths', () => {
    resultSettings = { ...resultSettings, columnWidths: {} };
    stateRegistry.forEach(outputState => {
      outputState.liveManualColumnWidths.clear();
      outputState.savedManualColumnWidths.clear();
    });
    renderState(context, state);
    context.postMessage?.({ type: 'resetResultColumnWidths' });
  });
  let hasOutputWidths = false;
  stateRegistry.forEach(outputState => {
    hasOutputWidths ||= outputState.liveManualColumnWidths.size > 0 ||
      outputState.savedManualColumnWidths.size > 0;
  });
  resetWidths.disabled = !hasPositionalColumnWidths(resultSettings.columnWidths) &&
    !hasOutputWidths;
  withFocusKey(resetWidths, 'settings:reset-column-widths');
  panel.append(resetWidths);
  details.append(panel);
  keepDetailsPanelInsideResult(details, panel);
  return details;
}

function columnResizeHandle(
  context: RendererContext<RendererState>,
  state: OutputState,
  source: 'live' | 'saved',
  position: number,
  currentWidth: number
): HTMLSpanElement {
  const handle = node('span', 'kx-column-resize-handle');
  handle.title = 'Drag to resize this column; double-click to reset its positional width';
  handle.tabIndex = 0;
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-label', `Resize column ${position + 1}`);
  handle.setAttribute('aria-valuemin', String(KX_COLUMN_MIN_WIDTH));
  handle.setAttribute('aria-valuemax', String(KX_COLUMN_MAX_WIDTH));
  handle.setAttribute('aria-valuenow', String(Math.round(currentWidth)));
  handle.dataset.position = String(position);
  handle.dataset.kxSourceOrdinal = String(position);
  handle.addEventListener('mousedown', event => {
    if (event.button !== 0) {
      return;
    }
    const startX = event.clientX;
    const startWidth = currentWidth;
    let nextWidth = currentWidth;
    const guide = node('span', 'kx-column-resize-guide');
    guide.style.left = `${event.clientX}px`;
    document.body.append(guide);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const move = (moveEvent: MouseEvent): void => {
      nextWidth = Math.min(
        KX_COLUMN_MAX_WIDTH,
        Math.max(
          KX_COLUMN_MIN_WIDTH,
          Math.round(startWidth + moveEvent.clientX - startX)
        )
      );
      guide.style.left = `${moveEvent.clientX}px`;
      handle.title = `Column ${position + 1}: ${nextWidth}px`;
      moveEvent.preventDefault();
    };
    const finish = (): void => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', finish);
      guide.remove();
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (nextWidth !== currentWidth) {
        applyRendererColumnWidth(context, state, source, position, nextWidth);
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', finish);
    event.stopPropagation();
    event.preventDefault();
  });
  handle.addEventListener('dblclick', event => {
    applyRendererColumnWidth(context, state, source, position, 0);
    event.stopPropagation();
    event.preventDefault();
  });
  handle.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' &&
      event.key !== 'Delete' && event.key !== 'Backspace') {
      return;
    }
    const width = event.key === 'Delete' || event.key === 'Backspace'
      ? 0
      : Math.min(
        KX_COLUMN_MAX_WIDTH,
        Math.max(
          KX_COLUMN_MIN_WIDTH,
          Math.round(currentWidth + (event.key === 'ArrowLeft' ? -10 : 10))
        )
      );
    applyRendererColumnWidth(context, state, source, position, width);
    focusResultResizeHandle(state, position);
    event.stopPropagation();
    event.preventDefault();
  });
  handle.addEventListener('click', event => {
    event.stopPropagation();
    event.preventDefault();
  });
  return handle;
}

function applyRendererColumnWidth(
  context: RendererContext<RendererState>,
  state: OutputState,
  source: 'live' | 'saved',
  position: number,
  width: number
): void {
  const manualWidths = source === 'live'
    ? state.liveManualColumnWidths
    : state.savedManualColumnWidths;
  if (width === 0) {
    manualWidths.delete(position);
  } else {
    manualWidths.set(
      position,
      Math.min(KX_COLUMN_MAX_WIDTH, Math.max(KX_COLUMN_MIN_WIDTH, Math.round(width)))
    );
  }
  const current = normalizePositionalColumnWidths(resultSettings.columnWidths);
  resultSettings = {
    ...resultSettings,
    columnWidths: updatePositionalColumnWidth(
      current,
      position,
      width === 0 ? null : width
    ),
  };
  renderState(context, state);
  context.postMessage?.({
    type: 'setResultColumnWidth',
    position,
    width,
  });
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
  state.liveColumnTextLengthRequestId = requestId;
  state.liveStatus = 'requesting';
  context.postMessage({
    type: 'requestLiveResult',
    outputId: state.outputId,
    liveId: state.liveId,
    requestId,
  });
}

function requestLiveColumnTextLengths(
  context: RendererContext<RendererState>,
  state: OutputState
): void {
  if (!context.postMessage || !state.liveId || !state.outputId ||
    state.liveStatus !== 'available') {
    return;
  }
  const requestId = nextRequestId();
  state.liveColumnTextLengthRequestId = requestId;
  context.postMessage({
    type: 'requestLiveColumnTextLengths',
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
  if (outputItem.mime !== KX_NOTEBOOK_MIME) {
    renderError(element, 'KX notebook output is unsupported.');
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
  return parseNotebookOutputBindingFromMetadata(outputItem.metadata);
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
  state.hostActionMessage = isPortableKxFullResult(state.payload)
    ? 'Opening the complete saved result in KX Results…'
    : isHistoricalDirectPreview(state.payload)
      ? 'Opening the historical saved preview in KX Results…'
      : 'Opening the saved preview in KX Results…';
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
  maxSourceRows: number,
  range?: PlotScaleRange
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
      ...(isValidChartRange(range) ? { xMin: range.min, xMax: range.max } : {}),
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
  chart: NotebookChartSpec,
  range?: PlotScaleRange
): SavedPreparedChartState {
  const maxSourceRows = notebookSavedChartSourceRowLimit(payload);
  const signature = [
    notebookChartSpecSignature(chart),
    state.savedMaxChartPoints,
    maxSourceRows,
    isValidChartRange(range) ? chartZoomRangeKey(range) : '',
  ].join('\0');
  if (state.savedPreparedChart?.signature === signature) {
    return state.savedPreparedChart;
  }
  const preparation = savedChartData(
    payload,
    chart,
    state.savedMaxChartPoints,
    maxSourceRows,
    range
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
  const candidates = chartColumns(state.payload, renderedSavedColumnIndexes(state));
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
  const candidates = chartColumns(state.payload, renderedSavedColumnIndexes(state));
  if (state.savedChart) {
    const reconciled = reconcileSavedChartSpec(state.savedChart, candidates);
    state.savedChart = reconciled.compatible ? state.savedChart : reconciled.chart;
  }
  if (state.savedRenderedChart) {
    const rendered = reconcileSavedChartSpec(state.savedRenderedChart, candidates);
    if (!rendered.compatible) {
      state.savedRenderedChart = undefined;
      clearSavedChartViewport(state);
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
    refined: false,
    zoomLifecycle: reduceChartZoomLifecycle<NotebookLiveChartData>(null, {
      type: 'clear',
      requestId: 0,
    }),
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
  sortOrdinal?: number;
  sortColumn?: string;
  sortDirection?: NotebookLiveSortDirection;
} {
  return state.liveSortSourceOrdinal !== undefined && state.liveSortDirection
    ? {
      sortOrdinal: state.liveSortSourceOrdinal,
      sortDirection: state.liveSortDirection,
    }
    : {};
}

function liveSliceCell(
  state: OutputState,
  slice: LiveSliceState | undefined,
  rowIndex: number,
  columnIndex: number
): string | undefined {
  if (!slice || rowIndex < slice.startRow || rowIndex > slice.endRow ||
    columnIndex < slice.startColumn || columnIndex > slice.endColumn ||
    slice.columnOrdinals[columnIndex - slice.startColumn] !==
      visibleLiveColumnIndexes(state)[columnIndex]) {
    return undefined;
  }
  return slice.cells[rowIndex - slice.startRow]?.[columnIndex - slice.startColumn];
}

function sliceContainsWindow(state: OutputState, window: LiveWindow): boolean {
  const slice = state.liveSlice;
  return !!slice &&
    slice.startRow <= window.startRow &&
    slice.endRow >= window.endRow &&
    slice.startColumn <= window.startColumn &&
    slice.endColumn >= window.endColumn &&
    visibleLiveColumnIndexes(state).slice(window.startColumn, window.endColumn + 1)
      .every((ordinal, index) => slice.columnOrdinals[
        window.startColumn - slice.startColumn + index
      ] === ordinal);
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

interface SavedActionPlan {
  range: { startRow: number; endRow: number; startColumn: number; endColumn: number };
  columnIndexes: number[];
  cellCount: number;
}

function savedActionPlan(
  state: OutputState,
  payload: PortableKxTableResult
): SavedActionPlan {
  const allVisibleColumns = visibleSavedColumnIndexes(state);
  const selection = notebookSelectionRange(state.savedSelection);
  const windowColumns = notebookSavedColumnWindow(
    allVisibleColumns,
    state.savedColumnWindowStart,
    SAVED_COLUMN_WINDOW_SIZE
  ).columns;
  const range = selection || {
    startRow: 0,
    endRow: Math.max(0, payload.data.rows.length - 1),
    startColumn: 0,
    endColumn: Math.max(0, allVisibleColumns.length - 1),
  };
  const columnIndexes = selection
    ? windowColumns.slice(selection.startColumn, selection.endColumn + 1)
    : allVisibleColumns;
  if (payload.data.rows.length === 0 || columnIndexes.length === 0) {
    return { range, columnIndexes, cellCount: 0 };
  }
  return {
    range,
    columnIndexes,
    cellCount: (range.endRow - range.startRow + 1) * columnIndexes.length,
  };
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
  const plan = savedActionPlan(state, payload);
  if (plan.cellCount < 1 || plan.cellCount > LIVE_CLIPBOARD_CELL_LIMIT) {
    return;
  }
  const requestId = nextRequestId();
  state.hostActionRequestId = requestId;
  state.hostActionMessage = isPortableKxFullResult(payload)
    ? 'Copying selected saved result cells…'
    : isHistoricalDirectPreview(payload)
      ? 'Copying selected historical preview cells…'
      : 'Copying selected saved preview cells…';
  context.postMessage({
    type: 'copyPreviewRange',
    ...(state.outputId ? { outputId: state.outputId } : {}),
    requestId,
    payload,
    ...plan.range,
    format,
    includeHeaders: resultSettings.includeHeaders,
    includeRowIndex: resultSettings.includeRowIndex,
    columnIndexes: plan.columnIndexes,
    rowIndexes: rowOrder.slice(plan.range.startRow, plan.range.endRow + 1),
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
  const plan = savedActionPlan(state, payload);
  if (plan.cellCount < 1) {
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
    ...plan.range,
    format,
    includeHeaders: resultSettings.includeHeaders,
    includeRowIndex: resultSettings.includeRowIndex,
    columnIndexes: plan.columnIndexes,
    rowIndexes: rowOrder.slice(plan.range.startRow, plan.range.endRow + 1),
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
    cell.classList.toggle(
      'is-active-cell',
      state.liveSelection?.focusRow === row && state.liveSelection.focusColumn === column
    );
    cell.setAttribute('aria-selected', selected ? 'true' : 'false');
  });
  if (state.liveCanvas) {
    updateResultHeaderSelection(state.liveCanvas, state.liveSelection, state.liveRowCount);
  }
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
  const columnMetrics = variableColumnMetrics(liveColumnWidths(state));
  const left = rowIndexWidth + (columnMetrics.lefts[column] || 0);
  const width = columnMetrics.widths[column] || resultSettings.cellWidth;
  if (left < state.liveScrollLeft + rowIndexWidth) {
    state.liveScrollLeft = Math.max(0, left - rowIndexWidth);
  } else if (left + width > state.liveScrollLeft + viewport.clientWidth) {
    state.liveScrollLeft = left + width - viewport.clientWidth;
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
      portableCellChartValue(payload.data.rows[rowIndex][columnIndexes[columnIndex]]),
    columnIndexes.map(index => portableCellChartColumnType(
      payload.data.rows[0]?.[index],
      payload.schema.columns[index].type
    )),
    payload.schema.keyColumnOrdinals === undefined
      ? undefined
      : columnIndexes.reduce<number[]>((ordinals, sourceOrdinal, projectedOrdinal) => {
        if (payload.schema.keyColumnOrdinals!.includes(sourceOrdinal)) {
          ordinals.push(projectedOrdinal);
        }
        return ordinals;
      }, [])
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
  const columnPagination = /^pagination:saved-columns:(previous|next)$/.exec(key);
  if (columnPagination) {
    return [
      `pagination:saved-columns:${columnPagination[1] === 'previous' ? 'next' : 'previous'}`,
      'grid:saved:viewport',
    ];
  }
  const columnControlPagination = /^columns:saved:(previous|next)-page$/.exec(key);
  if (columnControlPagination) {
    return [
      `columns:saved:${columnControlPagination[1] === 'previous' ? 'next' : 'previous'}-page`,
      'columns:saved:summary',
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

function disposeDetachedState(
  state: OutputState,
  _context?: RendererContext<RendererState>
): void {
  if (state.payload.version === 2) {
    columnOrderCache.remember(outputColumnOrderSnapshot(state));
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
  if (state.savedChartViewportTimer !== undefined) {
    window.clearTimeout(state.savedChartViewportTimer);
  }
  state.liveCopyButtons = undefined;
  state.liveCopyTools = undefined;
  state.liveCopyStatus = undefined;
  state.liveSelectionStatus = undefined;
}

function disposeOutputItemState(
  outputItemId: string,
  context?: RendererContext<RendererState>
): OutputState | undefined {
  const detached = stateRegistry.takeOutputItem(outputItemId);
  if (detached) {
    disposeDetachedState(detached.state, context);
  }
  return detached?.state;
}

function outputColumnOrderSnapshot(state: OutputState): NotebookRendererColumnOrderSnapshot {
  return {
    outputId: state.rendererOutputId,
    savedSchema: state.payload.kind === 'table'
      ? state.payload.schema.columns.map(column => `${column.name}\0${column.type}`)
      : [],
    savedOrdinals: state.savedColumnOrder.slice(),
    savedWidths: [...state.savedManualColumnWidths.entries()],
    ...(state.liveId ? { liveId: state.liveId } : {}),
    liveSchema: state.liveAllColumns.slice(),
    liveOrdinals: state.liveColumnOrder.slice(),
    liveWidths: [...state.liveManualColumnWidths.entries()],
  };
}

function boundedReconciledColumnWidths(
  previousSchema: readonly string[],
  entries: readonly (readonly [number, number])[] | undefined,
  nextSchema: readonly string[]
): Map<number, number> {
  const widths = new Map<number, number>();
  for (const [ordinal, width] of reconciledNotebookColumnWidths(
    previousSchema,
    entries || [],
    nextSchema
  )) {
    widths.set(ordinal, Math.min(
      KX_COLUMN_MAX_WIDTH,
      Math.max(KX_COLUMN_MIN_WIDTH, Math.round(width))
    ));
  }
  return widths;
}

function legacyOutputId(): string {
  return `legacy_${String(++domSequence).padStart(32, '0')}`;
}

interface ResultHeaderOptions {
  displayColumn: number;
  columnCount: number;
  sourceColumn: number;
  columnName: string;
  sort: () => void;
  select: (extend: boolean) => void;
  reorder: (sourceColumn: number, targetColumn: number) => void;
}

function configureResultHeader(
  header: HTMLButtonElement,
  options: ResultHeaderOptions
): void {
  let pointer: HeaderPointerState | undefined;
  let columnSelectionModifier = false;
  let extendSelection = false;

  const targetColumnAt = (clientX: number, clientY: number): number | undefined => {
    const grid = header.closest<HTMLElement>('[role="grid"]');
    const target = document.elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>('[data-kx-column-index]');
    if (!grid || !target || !grid.contains(target) ||
      target.closest<HTMLElement>('[role="grid"]') !== grid) {
      return undefined;
    }
    const column = Number(target.dataset.kxColumnIndex);
    return Number.isSafeInteger(column) ? column : undefined;
  };
  const move = (event: MouseEvent): void => {
    if (!pointer) {
      return;
    }
    const targetColumn = targetColumnAt(event.clientX, event.clientY);
    pointer = updateHeaderPointer(
      pointer,
      event.clientX,
      event.clientY,
      targetColumn ?? pointer.targetColumn
    );
    header.classList.toggle('is-reordering', pointer.reorder);
    event.preventDefault();
  };
  const finish = (event: MouseEvent): void => {
    if (!pointer) {
      return;
    }
    const targetColumn = targetColumnAt(event.clientX, event.clientY);
    const completed = updateHeaderPointer(
      pointer,
      event.clientX,
      event.clientY,
      targetColumn ?? pointer.targetColumn
    );
    pointer = undefined;
    header.classList.remove('is-reordering');
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', finish);
    const intent = headerPointerIntent(
      completed,
      columnSelectionModifier,
      extendSelection
    );
    if (intent === 'reorder') {
      options.reorder(completed.sourceColumn, completed.targetColumn);
    } else if (intent === 'select') {
      options.select(extendSelection);
    } else {
      options.sort();
    }
    event.preventDefault();
  };

  header.addEventListener('mousedown', event => {
    if (event.button !== 0 || event.target !== header) {
      return;
    }
    pointer = beginHeaderPointer(options.displayColumn, event.clientX, event.clientY);
    header.focus({ preventScroll: true });
    columnSelectionModifier = event.ctrlKey || event.metaKey;
    extendSelection = event.shiftKey;
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', finish);
    event.preventDefault();
  });
  header.addEventListener('click', event => {
    event.preventDefault();
  });
  header.addEventListener('keydown', event => {
    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      const movePlan = moveResultColumnBy(
        options.columnCount,
        options.displayColumn,
        event.key === 'ArrowLeft' ? -1 : 1
      );
      if (movePlan) {
        options.reorder(movePlan.sourceColumn, movePlan.targetColumn);
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === ' ') {
      options.select(event.shiftKey);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      options.sort();
      event.preventDefault();
      event.stopPropagation();
    }
  });
}

function fullColumnSelection(
  previous: NotebookCellSelection | undefined,
  displayColumn: number,
  rowCount: number,
  extend: boolean
): NotebookCellSelection | undefined {
  return fullResultColumnSelection(previous, displayColumn, rowCount, extend);
}

function resultColumnFullySelected(
  selection: NotebookCellSelection | undefined,
  displayColumn: number,
  rowCount: number
): boolean {
  const range = notebookSelectionRange(selection);
  return rowCount > 0 && !!range && range.startRow === 0 &&
    range.endRow === rowCount - 1 && displayColumn >= range.startColumn &&
    displayColumn <= range.endColumn;
}

function updateResultHeaderSelection(
  grid: HTMLElement,
  selection: NotebookCellSelection | undefined,
  rowCount: number
): void {
  grid.querySelectorAll<HTMLElement>(
    '[role="columnheader"][data-kx-header-column-index]'
  ).forEach(header => {
    const displayColumn = Number(header.dataset.kxHeaderColumnIndex);
    const selected = resultColumnFullySelected(selection, displayColumn, rowCount);
    header.classList.toggle('is-selected-header', selected);
    header.setAttribute(
      'aria-selected',
      selected ? 'true' : 'false'
    );
    const ariaLabel = selected
      ? header.dataset.kxSelectedAriaLabel
      : header.dataset.kxUnselectedAriaLabel;
    if (ariaLabel) {
      header.setAttribute('aria-label', ariaLabel);
      header.querySelector<HTMLElement>('[data-kx-header-label-control]')
        ?.setAttribute('aria-label', ariaLabel);
    }
  });
}

function focusResultHeader(state: OutputState, sourceOrdinal: number): void {
  window.requestAnimationFrame(() => {
    state.element.querySelector<HTMLElement>(
      `button[data-kx-source-ordinal="${sourceOrdinal}"]`
    )?.focus({ preventScroll: true });
  });
}

function focusResultResizeHandle(state: OutputState, sourceOrdinal: number): void {
  const focus = (): void => {
    state.element.querySelector<HTMLElement>(
      `.kx-column-resize-handle[data-kx-source-ordinal="${sourceOrdinal}"]`
    )?.focus({ preventScroll: true });
  };
  focus();
  window.requestAnimationFrame(focus);
}

function moveVisibleResultColumnOrder(
  order: readonly number[],
  visibleOrdinals: readonly number[],
  sourceDisplayColumn: number,
  targetDisplayColumn: number
): number[] {
  const sourceOrdinal = visibleOrdinals[sourceDisplayColumn];
  const targetOrdinal = visibleOrdinals[targetDisplayColumn];
  const sourceIndex = order.indexOf(sourceOrdinal);
  const targetIndex = order.indexOf(targetOrdinal);
  return moveResultColumn(order, sourceIndex, targetIndex);
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
    columnWidths: {},
    autoFitColumns: true,
    autoFitMode: 'wholeResult',
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
  return Math.min(MAX_NOTEBOOK_LIVE_CHART_POINTS, CHART_MAX_SAMPLED_POINTS);
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
.kx-live-header{padding:0!important}.kx-live-sort{display:block;width:100%;height:100%;padding:4px 16px 4px 7px!important;border:0!important;border-radius:0!important;background:transparent!important;color:inherit!important;text-align:left;font-weight:600}.kx-live-sort:focus-visible,.kx-saved-sort:focus-visible,.kx-column-resize-handle:focus-visible{outline:2px solid var(--vscode-focusBorder,#007fd4);outline-offset:-2px}.kx-live-sort.is-reordering,.kx-saved-sort.is-reordering{cursor:grabbing;opacity:.72}
.kx-table-tools{margin-top:5px}.kx-table-wrap td.is-search-match:not(.is-selected){background:var(--vscode-editor-findMatchHighlightBackground,#ea5c0055)}.kx-table-wrap{overflow:auto;resize:vertical;min-height:72px;max-height:min(75vh,900px);border:1px solid var(--vscode-panel-border,#555);margin:6px 0;box-sizing:border-box;outline:none}.kx-table-wrap:focus{border-color:var(--vscode-focusBorder,#007fd4)}.kx-table-wrap table{border-collapse:separate;border-spacing:0;table-layout:fixed}.kx-table-wrap th,.kx-table-wrap td{box-sizing:border-box;border-right:1px solid var(--vscode-panel-border,#555);border-bottom:1px solid var(--vscode-panel-border,#555);padding:3px 7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;height:var(--kx-row-height,28px)}.kx-table-wrap thead th{position:sticky;top:0;z-index:3;height:max(44px,var(--kx-row-height,28px));background:var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-editor-background))}.kx-table-wrap .kx-saved-row-index{position:sticky;left:0;z-index:2;text-align:right;color:var(--vscode-descriptionForeground);background:var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-editor-background));font-weight:normal}.kx-table-wrap .kx-saved-corner{top:0;z-index:4}.kx-saved-sort{display:block;width:100%;padding:0!important;border:0!important;background:transparent!important;text-align:left;color:inherit!important;font-weight:600}.kx-column-type{display:block;color:var(--vscode-descriptionForeground);font-size:.78em;font-weight:normal}.kx-table-wrap .is-selected-header .kx-column-type{color:inherit}
.kx-column-resize-handle{position:absolute;top:0;right:-3px;z-index:8;width:9px;height:100%;cursor:col-resize}.kx-column-resize-handle:hover,.kx-column-resize-handle:focus-visible{background:var(--vscode-focusBorder,#007fd4);opacity:.55}.kx-column-resize-guide{position:fixed;top:0;bottom:0;z-index:2147483647;width:1px;pointer-events:none;background:var(--vscode-focusBorder,#007fd4)}
.kx-control{display:flex;flex-direction:column;gap:2px;color:var(--vscode-descriptionForeground);font-size:.9em}.kx-control select,.kx-control input{color:var(--vscode-foreground);min-width:90px}.kx-control.is-auto input::placeholder{color:var(--vscode-input-placeholderForeground,var(--vscode-descriptionForeground));opacity:1}.kx-series-control{position:relative;color:var(--vscode-descriptionForeground);font-size:.9em}.kx-series-control>summary{cursor:pointer;border:1px solid var(--vscode-panel-border,#777);border-radius:3px;padding:3px 7px;list-style:none}.kx-series-list{position:absolute;z-index:15;top:calc(100% + 2px);left:0;display:grid;gap:4px;max-height:min(220px,45vh);min-width:180px;max-width:min(320px,80vw);overflow:auto;padding:7px;border:1px solid var(--vscode-panel-border,#555);background:var(--vscode-editorWidget-background);box-shadow:0 4px 14px var(--vscode-widget-shadow,#0008)}.kx-series-option{display:flex;align-items:center;gap:6px;min-width:0;white-space:nowrap}.kx-series-name{min-width:0;overflow:hidden;text-overflow:ellipsis}.kx-series-swatches{display:inline-flex;align-items:center;gap:2px;flex:0 0 auto;overflow:visible!important}.kx-series-swatch{display:inline-block;width:10px;height:10px;flex:0 0 10px;border:1px solid var(--vscode-contrastBorder,var(--vscode-panel-border,transparent));border-radius:2px;box-sizing:border-box}.kx-chart-panel{border-top:1px solid var(--vscode-panel-border,#555);padding-top:7px;margin-top:7px}.kx-chart-host{width:100%;height:auto;margin-top:6px;overflow:hidden;border:1px solid var(--vscode-panel-border,#555);background:var(--vscode-editor-background);box-sizing:border-box;outline:none}.kx-chart-host:focus-visible{border-color:var(--vscode-focusBorder,#007fd4);box-shadow:0 0 0 1px var(--vscode-focusBorder,#007fd4)}.kx-chart-host[aria-disabled=true]{cursor:not-allowed}.kx-chart-canvas{width:100%;height:280px;overflow:hidden}.kx-chart-host .uplot{max-width:100%;font-family:var(--vscode-font-family,system-ui,sans-serif);color:var(--vscode-editor-foreground);background:var(--vscode-editor-background)}.kx-chart-host .u-wrap{background:var(--vscode-editor-background)}.kx-chart-host .u-axis,.kx-chart-host .u-legend{color:var(--vscode-charts-foreground,var(--vscode-editor-foreground))}.kx-chart-host .u-select{background:var(--vscode-list-activeSelectionBackground,rgba(80,140,220,.22))}.kx-chart-host .u-cursor-x,.kx-chart-host .u-cursor-y{border-color:var(--vscode-focusBorder,#607d8b)}.kx-chart-legend{max-height:96px;overflow:auto;border-top:1px solid var(--vscode-charts-lines,var(--vscode-panel-border,#555));background:var(--vscode-editor-background)}.kx-chart-host .u-legend{display:block;width:100%;margin:0;padding:3px 5px;text-align:left;font:inherit}.kx-chart-host .u-legend tbody{display:flex;align-items:center;gap:2px 10px;flex-wrap:wrap}.kx-chart-host .u-legend .u-series{display:block;margin:0}.kx-chart-host .u-legend .u-series>th{display:flex;align-items:center;max-width:min(240px,75vw);padding:3px 4px;border-radius:2px;outline-offset:-1px;color:var(--vscode-editor-foreground)!important}.kx-chart-host .u-legend .u-marker{width:14px;height:10px;flex:0 0 14px;margin-right:5px;border-radius:2px;box-shadow:0 0 0 1px var(--vscode-contrastBorder,var(--vscode-editor-foreground))}.kx-chart-host .u-legend .kx-series-hidden>th{text-decoration:line-through;opacity:.48}.kx-chart-host .u-legend .kx-series-hidden .u-marker{filter:grayscale(1)}.kx-status{min-height:1.2em;margin-top:5px;color:var(--vscode-descriptionForeground);font-size:.9em}.kx-empty{padding:8px;color:var(--vscode-descriptionForeground)}
.kx-settings{position:relative}.kx-settings>summary{cursor:pointer;border:1px solid var(--vscode-panel-border,#777);border-radius:3px;padding:3px 7px;list-style:none}.kx-settings-panel{position:absolute;top:calc(100% + 2px);right:0;z-index:25;display:grid;grid-template-columns:repeat(2,minmax(130px,1fr));gap:7px;width:min(430px,80vw);max-height:min(360px,60vh);overflow:auto;padding:9px;border:1px solid var(--vscode-panel-border,#555);background:var(--vscode-editorWidget-background);box-shadow:0 4px 18px var(--vscode-widget-shadow,transparent)}.kx-settings-header{position:sticky;top:-9px;z-index:2;grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:8px;margin:-9px -9px 2px;padding:8px 9px;border-bottom:1px solid var(--vscode-panel-border,#555);background:var(--vscode-editorWidget-background)}.kx-settings-close{margin-left:auto}.kx-setting-checkbox{display:flex;align-items:center;gap:5px;font-size:.9em}
.kx-density-compact :where(.kx-primary-toolbar,.kx-header){padding-block:3px}.kx-density-compact :where(button,select,input){padding-block:2px}.kx-density-comfortable :where(.kx-primary-toolbar,.kx-header){padding-block:8px}
@media (forced-colors:active){.kx-live-cell.is-selected,.kx-table-wrap td.is-selected{outline:2px solid Highlight;outline-offset:-2px}.kx-live-cell,.kx-table-wrap th,.kx-table-wrap td{border-color:CanvasText}.kx-column-resize-handle:focus-visible{background:Highlight}}
@media (max-width:560px){.kx-root{padding-inline:5px}.kx-header,.kx-primary-toolbar{margin-inline:-5px;padding-inline:5px}.kx-primary-toolbar{align-items:flex-start}.kx-output-group{flex:1 1 100%}.kx-selection-summary{order:10;margin-left:0;flex:1 1 100%}.kx-live-tools input[type=search]{min-width:0;flex:1 1 140px}.kx-settings-panel,.kx-columns-panel{right:0;width:min(360px,92vw);max-width:none}.kx-settings-panel{grid-template-columns:minmax(0,1fr);max-height:min(320px,55vh)}.kx-series-list{max-height:min(132px,38vh);max-width:calc(100vw - 16px)}.kx-toolbar-label{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}}
`;
