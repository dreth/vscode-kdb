import { PortableKxResult, validatePortableKxResult } from './notebook-contract';
import { NotebookSettings } from './notebook-settings';

export const NOTEBOOK_LIVE_RESULT_METADATA_KEY = 'vscode-kdb.liveResult';
export const MIN_NOTEBOOK_LIVE_ID_CHARS = 32;
export const MAX_NOTEBOOK_LIVE_ID_CHARS = 128;
export const MAX_NOTEBOOK_LIVE_REQUEST_ID = 0x7fffffff;
export const MAX_NOTEBOOK_LIVE_SLICE_ROWS = 500;
export const MAX_NOTEBOOK_LIVE_SLICE_COLUMNS = 128;
export const MAX_NOTEBOOK_LIVE_SLICE_CELLS = 20_000;
export const MAX_NOTEBOOK_LIVE_SLICE_TEXT_CHARS = 2_000_000;
export const MAX_NOTEBOOK_LIVE_SEARCH_CHARS = 512;
export const MAX_NOTEBOOK_LIVE_SEARCH_MATCHES = 1_000;
export const MAX_NOTEBOOK_LIVE_CHART_POINTS = 10_000;
export const MAX_NOTEBOOK_LIVE_CHART_SERIES = 36;
export const MAX_NOTEBOOK_LIVE_COLUMNS = 4_096;
export const MAX_NOTEBOOK_LIVE_TEXT_CHARS = 1_048_576;
export const MAX_NOTEBOOK_LIVE_COPY_CELLS = 20_000;

export type NotebookLiveSortDirection = 'asc' | 'desc';
export type NotebookLiveChartType =
  | 'line'
  | 'scatter'
  | 'step'
  | 'bar'
  | 'box'
  | 'candlestick';
export type NotebookResultSettingKey =
  | 'cellWidth'
  | 'rowHeight'
  | 'fontSize'
  | 'density'
  | 'showRowIndex'
  | 'includeHeaders'
  | 'includeRowIndex'
  | 'elapsedTimeDisplay'
  | 'chartDecimalPlaces'
  | 'chartMaxSourceRows'
  | 'qTextSyntaxHighlighting'
  | 'qTextDisplayFormatting'
  | 'arrayDisplayFormat'
  | 'functionDisplayStrategy'
  | 'dictionaryDisplayStrategy'
  | 'listDisplayStrategy'
  | 'objectDisplayStrategy';

export interface NotebookLiveResultReference {
  version: 1;
  id: string;
}

export type NotebookRendererMessage =
  | { type: 'ready' }
  | { type: 'openPreview'; payload: PortableKxResult }
  | { type: 'requestLiveResult'; liveId: string; requestId: number }
  | {
    type: 'requestLiveSlice';
    liveId: string;
    requestId: number;
    startRow: number;
    endRow: number;
    startColumn: number;
    endColumn: number;
    sortColumn?: string;
    sortDirection?: NotebookLiveSortDirection;
  }
  | {
    type: 'searchLiveResult';
    liveId: string;
    requestId: number;
    query: string;
    sortColumn?: string;
    sortDirection?: NotebookLiveSortDirection;
  }
  | {
    type: 'requestLiveChart';
    liveId: string;
    requestId: number;
    chartType: NotebookLiveChartType;
    xColumn: string;
    yColumns: string[];
    groupByColumn?: string;
    openColumn?: string;
    highColumn?: string;
    lowColumn?: string;
    closeColumn?: string;
    maxPoints: number;
  }
  | {
    type: 'copyLiveRange';
    liveId: string;
    requestId: number;
    startRow: number;
    endRow: number;
    startColumn: number;
    endColumn: number;
    format: 'tsv' | 'csv';
    includeHeaders: boolean;
    includeRowIndex: boolean;
    sortColumn?: string;
    sortDirection?: NotebookLiveSortDirection;
  }
  | { type: 'openLiveResult'; liveId: string }
  | { type: 'updateResultSetting'; key: NotebookResultSettingKey; value: string | number | boolean };

export interface NotebookRendererSettingsMessage extends NotebookSettings {
  type: 'settings';
  resultSettings: NotebookSharedKxResultSettings;
}

export interface NotebookSharedKxResultSettings {
  cellWidth: number;
  rowHeight: number;
  fontSize: number;
  density: 'compact' | 'standard' | 'comfortable';
  showRowIndex: boolean;
  includeHeaders: boolean;
  includeRowIndex: boolean;
  elapsedTimeDisplay: 'auto' | 'milliseconds';
  chartDecimalPlaces: number;
  chartMaxSourceRows: number;
  chartZoomMaxSampledPoints: number;
  qTextSyntaxHighlighting: boolean;
  qTextDisplayFormatting: boolean;
  arrayDisplayFormat: 'commaSpace' | 'space' | 'raw';
  functionDisplayStrategy: 'grid' | 'qText';
  dictionaryDisplayStrategy: 'grid' | 'qText';
  listDisplayStrategy: 'grid' | 'qText';
  objectDisplayStrategy: 'grid' | 'qText';
}

export interface NotebookLiveResultMetadata {
  query?: string;
  connectionName?: string;
  elapsedMs?: number;
  messages?: string[];
}

export interface NotebookLiveResultMessage {
  type: 'liveResult';
  liveId: string;
  requestId: number;
  available: boolean;
  mode?: 'table' | 'text';
  kind?: string;
  columns?: string[];
  rowCount?: number;
  chartXColumns?: string[];
  chartYColumns?: string[];
  chartGroupColumns?: string[];
  text?: string;
  metadata?: NotebookLiveResultMetadata;
  message?: string;
}

export interface NotebookLiveSliceMessage {
  type: 'liveSlice';
  liveId: string;
  requestId: number;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  cells: string[][];
  error?: string;
}

export interface NotebookLiveSearchMessage {
  type: 'liveSearch';
  liveId: string;
  requestId: number;
  matches: number[];
  totalScanned: number;
  scannedCells: number;
  capped: boolean;
  partial: boolean;
  error?: string;
}

export interface NotebookLiveChartSeries {
  columnName: string;
  sourceColumnName?: string;
  groupValue?: string;
  values: Array<number | null>;
  gapFlags?: boolean[];
}

export interface NotebookLiveBoxStats {
  count: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
}

export interface NotebookLiveBoxSeries {
  columnName: string;
  stats: Array<NotebookLiveBoxStats | null>;
}

export interface NotebookLiveCandlestick {
  x: number;
  xText: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface NotebookLiveChartData {
  chartType: NotebookLiveChartType;
  xColumn: string;
  groupByColumn?: string;
  xKind: 'numeric' | 'temporal';
  x: number[];
  xText?: string[];
  xDomain?: { min: number; max: number };
  series: NotebookLiveChartSeries[];
  boxSeries?: NotebookLiveBoxSeries[];
  ohlcColumns?: {
    open: string;
    high: string;
    low: string;
    close: string;
  };
  candlesticks?: NotebookLiveCandlestick[];
  sourceRowCount?: number;
  eligibleRowCount?: number;
  sampledPointCount?: number;
  algorithm?: string;
  warnings?: string[];
}

export interface NotebookLiveChartMessage {
  type: 'liveChart';
  liveId: string;
  requestId: number;
  data?: NotebookLiveChartData;
  error?: string;
}

export interface NotebookLiveCopyMessage {
  type: 'liveCopy';
  liveId: string;
  requestId: number;
  ok: boolean;
  message?: string;
}

export type NotebookRendererHostMessage =
  | NotebookRendererSettingsMessage
  | NotebookLiveResultMessage
  | NotebookLiveSliceMessage
  | NotebookLiveSearchMessage
  | NotebookLiveChartMessage
  | NotebookLiveCopyMessage;

export function parseNotebookRendererMessage(raw: unknown): NotebookRendererMessage | undefined {
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    return undefined;
  }
  if (raw.type === 'ready') {
    return Object.keys(raw).length === 1 ? { type: 'ready' } : undefined;
  }
  if (raw.type === 'openPreview') {
    if (!hasOnlyKeys(raw, ['type', 'payload'])) {
      return undefined;
    }
    const validation = validatePortableKxResult(raw.payload);
    return validation.ok ? { type: 'openPreview', payload: validation.value } : undefined;
  }
  if (raw.type === 'requestLiveResult') {
    return hasOnlyKeys(raw, ['type', 'liveId', 'requestId']) &&
      validLiveId(raw.liveId) && validRequestId(raw.requestId)
      ? { type: raw.type, liveId: raw.liveId, requestId: raw.requestId }
      : undefined;
  }
  if (raw.type === 'requestLiveSlice') {
    return parseLiveSliceRequest(raw);
  }
  if (raw.type === 'searchLiveResult') {
    return parseLiveSearchRequest(raw);
  }
  if (raw.type === 'requestLiveChart') {
    return parseLiveChartRequest(raw);
  }
  if (raw.type === 'copyLiveRange') {
    return parseLiveCopyRequest(raw);
  }
  if (raw.type === 'openLiveResult') {
    return hasOnlyKeys(raw, ['type', 'liveId']) && validLiveId(raw.liveId)
      ? { type: raw.type, liveId: raw.liveId }
      : undefined;
  }
  if (raw.type === 'updateResultSetting') {
    return parseResultSettingUpdate(raw);
  }
  return undefined;
}

export function parseNotebookRendererHostMessage(raw: unknown): NotebookRendererHostMessage | undefined {
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    return undefined;
  }
  if (raw.type === 'settings') {
    return parseSettingsMessage(raw);
  }
  if (raw.type === 'liveResult') {
    return parseLiveResultMessage(raw);
  }
  if (raw.type === 'liveSlice') {
    return parseLiveSliceMessage(raw);
  }
  if (raw.type === 'liveSearch') {
    return parseLiveSearchMessage(raw);
  }
  if (raw.type === 'liveChart') {
    return parseLiveChartMessage(raw);
  }
  if (raw.type === 'liveCopy') {
    return parseLiveCopyMessage(raw);
  }
  return undefined;
}

export function notebookRendererSettingsMessage(
  settings: NotebookSettings,
  resultSettings: NotebookSharedKxResultSettings
): NotebookRendererSettingsMessage {
  return { type: 'settings', ...settings, resultSettings };
}

export function parseNotebookLiveResultReference(raw: unknown): NotebookLiveResultReference | undefined {
  return isRecord(raw) && hasOnlyKeys(raw, ['version', 'id']) &&
    raw.version === 1 && validLiveId(raw.id)
    ? { version: 1, id: raw.id }
    : undefined;
}

function parseLiveSliceRequest(raw: Record<string, unknown>): NotebookRendererMessage | undefined {
  if (!hasOnlyKeys(raw, [
    'type',
    'liveId',
    'requestId',
    'startRow',
    'endRow',
    'startColumn',
    'endColumn',
    'sortColumn',
    'sortDirection',
  ]) || !validLiveId(raw.liveId) || !validRequestId(raw.requestId) ||
    !nonNegativeSafeInteger(raw.startRow) || !nonNegativeSafeInteger(raw.endRow) ||
    !nonNegativeSafeInteger(raw.startColumn) || !nonNegativeSafeInteger(raw.endColumn)) {
    return undefined;
  }
  const startRow = raw.startRow;
  const endRow = raw.endRow;
  const startColumn = raw.startColumn;
  const endColumn = raw.endColumn;
  const rowCount = endRow - startRow + 1;
  const columnCount = endColumn - startColumn + 1;
  if (rowCount < 1 || rowCount > MAX_NOTEBOOK_LIVE_SLICE_ROWS ||
    columnCount < 1 || columnCount > MAX_NOTEBOOK_LIVE_SLICE_COLUMNS ||
    rowCount * columnCount > MAX_NOTEBOOK_LIVE_SLICE_CELLS ||
    !validOptionalSort(raw.sortColumn, raw.sortDirection)) {
    return undefined;
  }
  return {
    type: 'requestLiveSlice',
    liveId: raw.liveId,
    requestId: raw.requestId,
    startRow,
    endRow,
    startColumn,
    endColumn,
    ...sortFields(raw),
  };
}

function parseLiveSearchRequest(raw: Record<string, unknown>): NotebookRendererMessage | undefined {
  if (!hasOnlyKeys(raw, [
    'type',
    'liveId',
    'requestId',
    'query',
    'sortColumn',
    'sortDirection',
  ]) || !validLiveId(raw.liveId) || !validRequestId(raw.requestId) ||
    typeof raw.query !== 'string' || raw.query.length > MAX_NOTEBOOK_LIVE_SEARCH_CHARS ||
    !validOptionalSort(raw.sortColumn, raw.sortDirection)) {
    return undefined;
  }
  return {
    type: 'searchLiveResult',
    liveId: raw.liveId,
    requestId: raw.requestId,
    query: raw.query,
    ...sortFields(raw),
  };
}

function parseLiveChartRequest(raw: Record<string, unknown>): NotebookRendererMessage | undefined {
  if (!hasOnlyKeys(raw, [
    'type',
    'liveId',
    'requestId',
    'chartType',
    'xColumn',
    'yColumns',
    'groupByColumn',
    'openColumn',
    'highColumn',
    'lowColumn',
    'closeColumn',
    'maxPoints',
  ]) || !validLiveId(raw.liveId) || !validRequestId(raw.requestId) ||
    !isLiveChartType(raw.chartType) || !validColumnName(raw.xColumn) ||
    !Array.isArray(raw.yColumns) || raw.yColumns.length > 16 ||
    !raw.yColumns.every(validColumnName) || new Set(raw.yColumns).size !== raw.yColumns.length ||
    raw.yColumns.includes(raw.xColumn) ||
    !validOptionalColumnName(raw.groupByColumn) ||
    !validOptionalColumnName(raw.openColumn) ||
    !validOptionalColumnName(raw.highColumn) ||
    !validOptionalColumnName(raw.lowColumn) ||
    !validOptionalColumnName(raw.closeColumn) ||
    !positiveSafeInteger(raw.maxPoints) || raw.maxPoints > MAX_NOTEBOOK_LIVE_CHART_POINTS) {
    return undefined;
  }
  const groupByColumn = optionalColumnName(raw.groupByColumn);
  const ohlc = [
    optionalColumnName(raw.openColumn),
    optionalColumnName(raw.highColumn),
    optionalColumnName(raw.lowColumn),
    optionalColumnName(raw.closeColumn),
  ];
  if (raw.chartType === 'candlestick') {
    if (raw.yColumns.length !== 0 || groupByColumn !== undefined ||
      ohlc.some(column => column === undefined) ||
      new Set(ohlc as string[]).size !== 4) {
      return undefined;
    }
  } else if (raw.yColumns.length < 1 ||
    ohlc.some(column => column !== undefined) ||
    (raw.chartType === 'box' && groupByColumn !== undefined)) {
    return undefined;
  }
  return {
    type: 'requestLiveChart',
    liveId: raw.liveId,
    requestId: raw.requestId,
    chartType: raw.chartType,
    xColumn: raw.xColumn,
    yColumns: raw.yColumns.slice(),
    ...(groupByColumn === undefined ? {} : { groupByColumn }),
    ...(raw.chartType === 'candlestick'
      ? {
        openColumn: ohlc[0]!,
        highColumn: ohlc[1]!,
        lowColumn: ohlc[2]!,
        closeColumn: ohlc[3]!,
      }
      : {}),
    maxPoints: raw.maxPoints,
  };
}

function parseLiveCopyRequest(raw: Record<string, unknown>): NotebookRendererMessage | undefined {
  if (!hasOnlyKeys(raw, [
    'type',
    'liveId',
    'requestId',
    'startRow',
    'endRow',
    'startColumn',
    'endColumn',
    'format',
    'includeHeaders',
    'includeRowIndex',
    'sortColumn',
    'sortDirection',
  ]) || !validLiveId(raw.liveId) || !validRequestId(raw.requestId) ||
    !nonNegativeSafeInteger(raw.startRow) || !nonNegativeSafeInteger(raw.endRow) ||
    !nonNegativeSafeInteger(raw.startColumn) || !nonNegativeSafeInteger(raw.endColumn) ||
    raw.endRow < raw.startRow || raw.endColumn < raw.startColumn ||
    (raw.format !== 'tsv' && raw.format !== 'csv') ||
    typeof raw.includeHeaders !== 'boolean' ||
    typeof raw.includeRowIndex !== 'boolean' ||
    !validOptionalSort(raw.sortColumn, raw.sortDirection)) {
    return undefined;
  }
  const cellCount =
    (raw.endRow - raw.startRow + 1) * (raw.endColumn - raw.startColumn + 1);
  if (!Number.isSafeInteger(cellCount) || cellCount > MAX_NOTEBOOK_LIVE_COPY_CELLS) {
    return undefined;
  }
  return {
    type: 'copyLiveRange',
    liveId: raw.liveId,
    requestId: raw.requestId,
    startRow: raw.startRow,
    endRow: raw.endRow,
    startColumn: raw.startColumn,
    endColumn: raw.endColumn,
    format: raw.format,
    includeHeaders: raw.includeHeaders,
    includeRowIndex: raw.includeRowIndex,
    ...sortFields(raw),
  };
}

function parseResultSettingUpdate(raw: Record<string, unknown>): NotebookRendererMessage | undefined {
  if (!hasOnlyKeys(raw, ['type', 'key', 'value']) || typeof raw.key !== 'string') {
    return undefined;
  }
  const value = normalizedResultSettingValue(raw.key, raw.value);
  return value === undefined
    ? undefined
    : {
      type: 'updateResultSetting',
      key: raw.key as NotebookResultSettingKey,
      value,
    };
}

function parseSettingsMessage(raw: Record<string, unknown>): NotebookRendererSettingsMessage | undefined {
  if (!hasOnlyKeys(raw, [
    'type',
    'presentation',
    'rowLimit',
    'byteLimit',
    'resultSettings',
  ]) || !isPresentation(raw.presentation) || !positiveSafeInteger(raw.rowLimit) ||
    !positiveSafeInteger(raw.byteLimit)) {
    return undefined;
  }
  const resultSettings = parseSharedResultSettings(raw.resultSettings);
  return resultSettings
    ? {
      type: 'settings',
      presentation: raw.presentation,
      rowLimit: raw.rowLimit,
      byteLimit: raw.byteLimit,
      resultSettings,
    }
    : undefined;
}

function parseLiveResultMessage(raw: Record<string, unknown>): NotebookLiveResultMessage | undefined {
  if (!hasOnlyKeys(raw, [
    'type',
    'liveId',
    'requestId',
    'available',
    'mode',
    'kind',
    'columns',
    'rowCount',
    'chartXColumns',
    'chartYColumns',
    'chartGroupColumns',
    'text',
    'metadata',
    'message',
  ]) || !validLiveId(raw.liveId) || !validRequestId(raw.requestId) ||
    typeof raw.available !== 'boolean' || !validOptionalText(raw.message, 4_096)) {
    return undefined;
  }
  if (!raw.available) {
    return {
      type: 'liveResult',
      liveId: raw.liveId,
      requestId: raw.requestId,
      available: false,
      ...(typeof raw.message === 'string' ? { message: raw.message } : {}),
    };
  }
  if ((raw.mode !== 'table' && raw.mode !== 'text') ||
    !validBoundedText(raw.kind, 128) ||
    !Array.isArray(raw.columns) || raw.columns.length > MAX_NOTEBOOK_LIVE_COLUMNS ||
    !raw.columns.every(validColumnName) || !nonNegativeSafeInteger(raw.rowCount) ||
    !validOptionalColumnList(raw.chartXColumns) ||
    !validOptionalColumnList(raw.chartYColumns) ||
    !validOptionalColumnList(raw.chartGroupColumns)) {
    return undefined;
  }
  const metadata = parseLiveResultMetadata(raw.metadata);
  if (!metadata || (raw.mode === 'text' && !validBoundedText(raw.text, MAX_NOTEBOOK_LIVE_TEXT_CHARS))) {
    return undefined;
  }
  return {
    type: 'liveResult',
    liveId: raw.liveId,
    requestId: raw.requestId,
    available: true,
    mode: raw.mode,
    kind: raw.kind,
    columns: raw.columns.slice(),
    rowCount: raw.rowCount,
    ...(Array.isArray(raw.chartXColumns)
      ? { chartXColumns: raw.chartXColumns.slice() as string[] }
      : {}),
    ...(Array.isArray(raw.chartYColumns)
      ? { chartYColumns: raw.chartYColumns.slice() as string[] }
      : {}),
    ...(Array.isArray(raw.chartGroupColumns)
      ? { chartGroupColumns: raw.chartGroupColumns.slice() as string[] }
      : {}),
    ...(raw.mode === 'text' ? { text: raw.text as string } : {}),
    metadata,
    ...(typeof raw.message === 'string' ? { message: raw.message } : {}),
  };
}

function parseLiveSliceMessage(raw: Record<string, unknown>): NotebookLiveSliceMessage | undefined {
  if (!hasOnlyKeys(raw, [
    'type',
    'liveId',
    'requestId',
    'startRow',
    'endRow',
    'startColumn',
    'endColumn',
    'cells',
    'error',
  ]) || !validLiveId(raw.liveId) || !validRequestId(raw.requestId) ||
    !nonNegativeSafeInteger(raw.startRow) || !integerAtLeast(raw.endRow, -1) ||
    !nonNegativeSafeInteger(raw.startColumn) || !integerAtLeast(raw.endColumn, -1) ||
    !Array.isArray(raw.cells) || raw.cells.length > MAX_NOTEBOOK_LIVE_SLICE_ROWS ||
    !validOptionalText(raw.error, 4_096)) {
    return undefined;
  }
  const cells: string[][] = [];
  let cellCount = 0;
  let textChars = 0;
  for (const rawRow of raw.cells) {
    if (!Array.isArray(rawRow) || rawRow.length > MAX_NOTEBOOK_LIVE_SLICE_COLUMNS ||
      !rawRow.every(value => validBoundedText(value, 65_536))) {
      return undefined;
    }
    cellCount += rawRow.length;
    textChars += rawRow.reduce((total, value) => total + (value as string).length, 0);
    if (cellCount > MAX_NOTEBOOK_LIVE_SLICE_CELLS ||
      textChars > MAX_NOTEBOOK_LIVE_SLICE_TEXT_CHARS) {
      return undefined;
    }
    cells.push(rawRow.slice());
  }
  if (cells.length === 0) {
    if (raw.endRow !== -1 || raw.endColumn !== -1) {
      return undefined;
    }
  } else {
    const width = cells[0].length;
    if (!cells.every(row => row.length === width) ||
      raw.endRow !== raw.startRow + cells.length - 1 ||
      raw.endColumn !== raw.startColumn + width - 1) {
      return undefined;
    }
  }
  return {
    type: 'liveSlice',
    liveId: raw.liveId,
    requestId: raw.requestId,
    startRow: raw.startRow,
    endRow: raw.endRow,
    startColumn: raw.startColumn,
    endColumn: raw.endColumn,
    cells,
    ...(typeof raw.error === 'string' ? { error: raw.error } : {}),
  };
}

function parseLiveSearchMessage(raw: Record<string, unknown>): NotebookLiveSearchMessage | undefined {
  if (!hasOnlyKeys(raw, [
    'type',
    'liveId',
    'requestId',
    'matches',
    'totalScanned',
    'scannedCells',
    'capped',
    'partial',
    'error',
  ]) || !validLiveId(raw.liveId) || !validRequestId(raw.requestId) ||
    !Array.isArray(raw.matches) || raw.matches.length > MAX_NOTEBOOK_LIVE_SEARCH_MATCHES ||
    !raw.matches.every(nonNegativeSafeInteger) ||
    !nonNegativeSafeInteger(raw.totalScanned) || !nonNegativeSafeInteger(raw.scannedCells) ||
    typeof raw.capped !== 'boolean' || typeof raw.partial !== 'boolean' ||
    !validOptionalText(raw.error, 4_096)) {
    return undefined;
  }
  return {
    type: 'liveSearch',
    liveId: raw.liveId,
    requestId: raw.requestId,
    matches: raw.matches.slice(),
    totalScanned: raw.totalScanned,
    scannedCells: raw.scannedCells,
    capped: raw.capped,
    partial: raw.partial,
    ...(typeof raw.error === 'string' ? { error: raw.error } : {}),
  };
}

function parseLiveChartMessage(raw: Record<string, unknown>): NotebookLiveChartMessage | undefined {
  if (!hasOnlyKeys(raw, ['type', 'liveId', 'requestId', 'data', 'error']) ||
    !validLiveId(raw.liveId) || !validRequestId(raw.requestId) ||
    !validOptionalText(raw.error, 4_096)) {
    return undefined;
  }
  const data = raw.data === undefined ? undefined : parseLiveChartData(raw.data);
  if (raw.data !== undefined && !data) {
    return undefined;
  }
  if (!data && typeof raw.error !== 'string') {
    return undefined;
  }
  return {
    type: 'liveChart',
    liveId: raw.liveId,
    requestId: raw.requestId,
    ...(data ? { data } : {}),
    ...(typeof raw.error === 'string' ? { error: raw.error } : {}),
  };
}

function parseLiveCopyMessage(raw: Record<string, unknown>): NotebookLiveCopyMessage | undefined {
  if (!hasOnlyKeys(raw, ['type', 'liveId', 'requestId', 'ok', 'message']) ||
    !validLiveId(raw.liveId) || !validRequestId(raw.requestId) ||
    typeof raw.ok !== 'boolean' || !validOptionalText(raw.message, 4_096) ||
    (!raw.ok && typeof raw.message !== 'string')) {
    return undefined;
  }
  return {
    type: 'liveCopy',
    liveId: raw.liveId,
    requestId: raw.requestId,
    ok: raw.ok,
    ...(typeof raw.message === 'string' ? { message: raw.message } : {}),
  };
}

function parseLiveChartData(raw: unknown): NotebookLiveChartData | undefined {
  if (!isRecord(raw) || !hasOnlyKeys(raw, [
    'chartType',
    'xColumn',
    'groupByColumn',
    'xKind',
    'x',
    'xText',
    'xDomain',
    'series',
    'boxSeries',
    'ohlcColumns',
    'candlesticks',
    'sourceRowCount',
    'eligibleRowCount',
    'sampledPointCount',
    'algorithm',
    'warnings',
  ]) || !isLiveChartType(raw.chartType) || !validColumnName(raw.xColumn) ||
    !validOptionalColumnName(raw.groupByColumn) ||
    (raw.xKind !== 'numeric' && raw.xKind !== 'temporal') ||
    !Array.isArray(raw.x) || raw.x.length > MAX_NOTEBOOK_LIVE_CHART_POINTS ||
    !raw.x.every(finiteNumber) || !Array.isArray(raw.series) ||
    raw.series.length < 1 || raw.series.length > MAX_NOTEBOOK_LIVE_CHART_SERIES ||
    !validOptionalCount(raw.sourceRowCount) || !validOptionalCount(raw.eligibleRowCount) ||
    !validOptionalCount(raw.sampledPointCount) ||
    !validOptionalText(raw.algorithm, 256)) {
    return undefined;
  }
  if (raw.xText !== undefined &&
    (!Array.isArray(raw.xText) || raw.xText.length !== raw.x.length ||
      !raw.xText.every(value => validBoundedText(value, 512)))) {
    return undefined;
  }
  const series: NotebookLiveChartSeries[] = [];
  for (const value of raw.series) {
    if (!isRecord(value) || !hasOnlyKeys(value, [
      'columnName',
      'sourceColumnName',
      'groupValue',
      'values',
      'gapFlags',
    ]) ||
      !validColumnName(value.columnName) || !Array.isArray(value.values) ||
      value.values.length !== raw.x.length ||
      !value.values.every(item => item === null || finiteNumber(item)) ||
      !validOptionalColumnName(value.sourceColumnName) ||
      !validOptionalText(value.groupValue, 512) ||
      (value.gapFlags !== undefined &&
        (!Array.isArray(value.gapFlags) || value.gapFlags.length !== raw.x.length ||
          !value.gapFlags.every(flag => typeof flag === 'boolean')))) {
      return undefined;
    }
    series.push({
      columnName: value.columnName,
      ...(typeof value.sourceColumnName === 'string'
        ? { sourceColumnName: value.sourceColumnName }
        : {}),
      ...(typeof value.groupValue === 'string' ? { groupValue: value.groupValue } : {}),
      values: value.values.slice() as Array<number | null>,
      ...(Array.isArray(value.gapFlags)
        ? { gapFlags: value.gapFlags.slice() as boolean[] }
        : {}),
    });
  }
  const xDomain = parseChartDomain(raw.xDomain);
  if (raw.xDomain !== undefined && !xDomain) {
    return undefined;
  }
  const boxSeries = parseLiveBoxSeries(raw.boxSeries, raw.x.length);
  if (raw.boxSeries !== undefined && !boxSeries) {
    return undefined;
  }
  const ohlcColumns = parseLiveOhlcColumns(raw.ohlcColumns);
  if (raw.ohlcColumns !== undefined && !ohlcColumns) {
    return undefined;
  }
  const candlesticks = parseLiveCandlesticks(raw.candlesticks, raw.x.length);
  if (raw.candlesticks !== undefined && !candlesticks) {
    return undefined;
  }
  if (raw.chartType === 'candlestick') {
    if (!ohlcColumns || !candlesticks || candlesticks.length !== raw.x.length ||
      raw.groupByColumn !== undefined || boxSeries !== undefined) {
      return undefined;
    }
  } else if (raw.chartType === 'box') {
    if (!boxSeries || raw.groupByColumn !== undefined ||
      ohlcColumns !== undefined || candlesticks !== undefined) {
      return undefined;
    }
  } else if (boxSeries !== undefined || ohlcColumns !== undefined || candlesticks !== undefined) {
    return undefined;
  }
  const warnings = raw.warnings === undefined
    ? undefined
    : Array.isArray(raw.warnings) && raw.warnings.length <= 32 &&
      raw.warnings.every(value => validBoundedText(value, 1_024))
      ? raw.warnings.slice() as string[]
      : null;
  if (warnings === null) {
    return undefined;
  }
  return {
    chartType: raw.chartType,
    xColumn: raw.xColumn,
    ...(typeof raw.groupByColumn === 'string'
      ? { groupByColumn: raw.groupByColumn }
      : {}),
    xKind: raw.xKind,
    x: raw.x.slice() as number[],
    ...(raw.xText === undefined ? {} : { xText: raw.xText.slice() as string[] }),
    ...(xDomain ? { xDomain } : {}),
    series,
    ...(boxSeries ? { boxSeries } : {}),
    ...(ohlcColumns ? { ohlcColumns } : {}),
    ...(candlesticks ? { candlesticks } : {}),
    ...(typeof raw.sourceRowCount === 'number' ? { sourceRowCount: raw.sourceRowCount } : {}),
    ...(typeof raw.eligibleRowCount === 'number' ? { eligibleRowCount: raw.eligibleRowCount } : {}),
    ...(typeof raw.sampledPointCount === 'number' ? { sampledPointCount: raw.sampledPointCount } : {}),
    ...(typeof raw.algorithm === 'string' ? { algorithm: raw.algorithm } : {}),
    ...(warnings === undefined ? {} : { warnings }),
  };
}

function parseChartDomain(raw: unknown): { min: number; max: number } | undefined {
  return isRecord(raw) && hasOnlyKeys(raw, ['min', 'max']) &&
    finiteNumber(raw.min) && finiteNumber(raw.max) && raw.max >= raw.min
    ? { min: raw.min, max: raw.max }
    : undefined;
}

function parseLiveBoxSeries(
  raw: unknown,
  pointCount: number
): NotebookLiveBoxSeries[] | undefined {
  if (!Array.isArray(raw) || raw.length < 1 ||
    raw.length > MAX_NOTEBOOK_LIVE_CHART_SERIES) {
    return undefined;
  }
  const result: NotebookLiveBoxSeries[] = [];
  for (const value of raw) {
    if (!isRecord(value) || !hasOnlyKeys(value, ['columnName', 'stats']) ||
      !validColumnName(value.columnName) || !Array.isArray(value.stats) ||
      value.stats.length !== pointCount) {
      return undefined;
    }
    const stats: Array<NotebookLiveBoxStats | null> = [];
    for (const rawStats of value.stats) {
      if (rawStats === null) {
        stats.push(null);
        continue;
      }
      if (!isRecord(rawStats) || !hasOnlyKeys(rawStats, [
        'count',
        'min',
        'q1',
        'median',
        'q3',
        'max',
      ]) || !positiveSafeInteger(rawStats.count) ||
        !finiteNumber(rawStats.min) || !finiteNumber(rawStats.q1) ||
        !finiteNumber(rawStats.median) || !finiteNumber(rawStats.q3) ||
        !finiteNumber(rawStats.max) ||
        rawStats.min > rawStats.q1 || rawStats.q1 > rawStats.median ||
        rawStats.median > rawStats.q3 || rawStats.q3 > rawStats.max) {
        return undefined;
      }
      stats.push({
        count: rawStats.count,
        min: rawStats.min,
        q1: rawStats.q1,
        median: rawStats.median,
        q3: rawStats.q3,
        max: rawStats.max,
      });
    }
    result.push({ columnName: value.columnName, stats });
  }
  return result;
}

function parseLiveOhlcColumns(
  raw: unknown
): NotebookLiveChartData['ohlcColumns'] | undefined {
  if (!isRecord(raw) || !hasOnlyKeys(raw, ['open', 'high', 'low', 'close']) ||
    !validColumnName(raw.open) || !validColumnName(raw.high) ||
    !validColumnName(raw.low) || !validColumnName(raw.close) ||
    new Set([raw.open, raw.high, raw.low, raw.close]).size !== 4) {
    return undefined;
  }
  return { open: raw.open, high: raw.high, low: raw.low, close: raw.close };
}

function parseLiveCandlesticks(
  raw: unknown,
  pointCount: number
): NotebookLiveCandlestick[] | undefined {
  if (!Array.isArray(raw) || raw.length !== pointCount) {
    return undefined;
  }
  const result: NotebookLiveCandlestick[] = [];
  for (const value of raw) {
    if (!isRecord(value) || !hasOnlyKeys(value, [
      'x',
      'xText',
      'open',
      'high',
      'low',
      'close',
    ]) || !finiteNumber(value.x) || !validBoundedText(value.xText, 512) ||
      !finiteNumber(value.open) || !finiteNumber(value.high) ||
      !finiteNumber(value.low) || !finiteNumber(value.close) ||
      value.high < Math.max(value.open, value.close, value.low) ||
      value.low > Math.min(value.open, value.close, value.high)) {
      return undefined;
    }
    result.push({
      x: value.x,
      xText: value.xText,
      open: value.open,
      high: value.high,
      low: value.low,
      close: value.close,
    });
  }
  return result;
}

function parseLiveResultMetadata(raw: unknown): NotebookLiveResultMetadata | undefined {
  if (!isRecord(raw) || !hasOnlyKeys(raw, ['query', 'connectionName', 'elapsedMs', 'messages']) ||
    !validOptionalText(raw.query, 16_384) || !validOptionalText(raw.connectionName, 512) ||
    (raw.elapsedMs !== undefined && (!finiteNumber(raw.elapsedMs) || raw.elapsedMs < 0)) ||
    (raw.messages !== undefined &&
      (!Array.isArray(raw.messages) || raw.messages.length > 64 ||
        !raw.messages.every(value => validBoundedText(value, 2_048))))) {
    return undefined;
  }
  return {
    ...(typeof raw.query === 'string' ? { query: raw.query } : {}),
    ...(typeof raw.connectionName === 'string' ? { connectionName: raw.connectionName } : {}),
    ...(typeof raw.elapsedMs === 'number' ? { elapsedMs: raw.elapsedMs } : {}),
    ...(Array.isArray(raw.messages) ? { messages: raw.messages.slice() as string[] } : {}),
  };
}

function parseSharedResultSettings(raw: unknown): NotebookSharedKxResultSettings | undefined {
  if (!isRecord(raw) || !hasOnlyKeys(raw, [
    'cellWidth',
    'rowHeight',
    'fontSize',
    'density',
    'showRowIndex',
    'includeHeaders',
    'includeRowIndex',
    'elapsedTimeDisplay',
    'chartDecimalPlaces',
    'chartMaxSourceRows',
    'chartZoomMaxSampledPoints',
    'qTextSyntaxHighlighting',
    'qTextDisplayFormatting',
    'arrayDisplayFormat',
    'functionDisplayStrategy',
    'dictionaryDisplayStrategy',
    'listDisplayStrategy',
    'objectDisplayStrategy',
  ]) || !integerInRange(raw.cellWidth, 80, 600) ||
    !integerInRange(raw.rowHeight, 20, 80) || !integerInRange(raw.fontSize, 0, 32) ||
    (raw.density !== 'compact' && raw.density !== 'standard' && raw.density !== 'comfortable') ||
    typeof raw.showRowIndex !== 'boolean' ||
    typeof raw.includeHeaders !== 'boolean' ||
    typeof raw.includeRowIndex !== 'boolean' ||
    (raw.elapsedTimeDisplay !== 'auto' && raw.elapsedTimeDisplay !== 'milliseconds') ||
    !integerInRange(raw.chartDecimalPlaces, 0, 12) ||
    !positiveSafeInteger(raw.chartMaxSourceRows) ||
    !positiveSafeInteger(raw.chartZoomMaxSampledPoints) ||
    typeof raw.qTextSyntaxHighlighting !== 'boolean' ||
    typeof raw.qTextDisplayFormatting !== 'boolean' ||
    (raw.arrayDisplayFormat !== 'commaSpace' && raw.arrayDisplayFormat !== 'space' &&
      raw.arrayDisplayFormat !== 'raw') ||
    !isDisplayStrategy(raw.functionDisplayStrategy) ||
    !isDisplayStrategy(raw.dictionaryDisplayStrategy) ||
    !isDisplayStrategy(raw.listDisplayStrategy) ||
    !isDisplayStrategy(raw.objectDisplayStrategy)) {
    return undefined;
  }
  return {
    cellWidth: raw.cellWidth,
    rowHeight: raw.rowHeight,
    fontSize: raw.fontSize,
    density: raw.density,
    showRowIndex: raw.showRowIndex,
    includeHeaders: raw.includeHeaders,
    includeRowIndex: raw.includeRowIndex,
    elapsedTimeDisplay: raw.elapsedTimeDisplay,
    chartDecimalPlaces: raw.chartDecimalPlaces,
    chartMaxSourceRows: raw.chartMaxSourceRows,
    chartZoomMaxSampledPoints: raw.chartZoomMaxSampledPoints,
    qTextSyntaxHighlighting: raw.qTextSyntaxHighlighting,
    qTextDisplayFormatting: raw.qTextDisplayFormatting,
    arrayDisplayFormat: raw.arrayDisplayFormat,
    functionDisplayStrategy: raw.functionDisplayStrategy,
    dictionaryDisplayStrategy: raw.dictionaryDisplayStrategy,
    listDisplayStrategy: raw.listDisplayStrategy,
    objectDisplayStrategy: raw.objectDisplayStrategy,
  };
}

function normalizedResultSettingValue(
  key: string,
  value: unknown
): string | number | boolean | undefined {
  switch (key as NotebookResultSettingKey) {
    case 'cellWidth':
      return integerInRange(value, 80, 600) ? value : undefined;
    case 'rowHeight':
      return integerInRange(value, 20, 80) ? value : undefined;
    case 'fontSize':
      return integerInRange(value, 0, 32) ? value : undefined;
    case 'density':
      return value === 'compact' || value === 'standard' || value === 'comfortable'
        ? value
        : undefined;
    case 'showRowIndex':
    case 'includeHeaders':
    case 'includeRowIndex':
    case 'qTextSyntaxHighlighting':
    case 'qTextDisplayFormatting':
      return typeof value === 'boolean' ? value : undefined;
    case 'elapsedTimeDisplay':
      return value === 'auto' || value === 'milliseconds' ? value : undefined;
    case 'chartDecimalPlaces':
      return integerInRange(value, 0, 12) ? value : undefined;
    case 'chartMaxSourceRows':
      return positiveSafeInteger(value) ? value : undefined;
    case 'arrayDisplayFormat':
      return value === 'commaSpace' || value === 'space' || value === 'raw'
        ? value
        : undefined;
    case 'functionDisplayStrategy':
    case 'dictionaryDisplayStrategy':
    case 'listDisplayStrategy':
    case 'objectDisplayStrategy':
      return isDisplayStrategy(value) ? value : undefined;
    default:
      return undefined;
  }
}

function validOptionalSort(sortColumn: unknown, sortDirection: unknown): boolean {
  if (sortColumn === undefined && sortDirection === undefined) {
    return true;
  }
  return validColumnName(sortColumn) && (sortDirection === 'asc' || sortDirection === 'desc');
}

function sortFields(raw: Record<string, unknown>): {
  sortColumn?: string;
  sortDirection?: NotebookLiveSortDirection;
} {
  return typeof raw.sortColumn === 'string' &&
    (raw.sortDirection === 'asc' || raw.sortDirection === 'desc')
    ? { sortColumn: raw.sortColumn, sortDirection: raw.sortDirection }
    : {};
}

function validLiveId(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length >= MIN_NOTEBOOK_LIVE_ID_CHARS &&
    value.length <= MAX_NOTEBOOK_LIVE_ID_CHARS &&
    /^[A-Za-z0-9_-]+$/.test(value);
}

function validRequestId(value: unknown): value is number {
  return positiveSafeInteger(value) && value <= MAX_NOTEBOOK_LIVE_REQUEST_ID;
}

function validColumnName(value: unknown): value is string {
  return validBoundedText(value, 256) && value.length > 0 && !/[\0\r\n]/.test(value);
}

function validOptionalColumnName(value: unknown): boolean {
  return value === undefined || validColumnName(value);
}

function optionalColumnName(value: unknown): string | undefined {
  return validColumnName(value) ? value : undefined;
}

function validOptionalColumnList(value: unknown): boolean {
  return value === undefined ||
    (Array.isArray(value) && value.length <= MAX_NOTEBOOK_LIVE_COLUMNS &&
      value.every(validColumnName) && new Set(value).size === value.length);
}

function validBoundedText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}

function validOptionalText(value: unknown, max: number): boolean {
  return value === undefined || validBoundedText(value, max);
}

function validOptionalCount(value: unknown): boolean {
  return value === undefined || nonNegativeSafeInteger(value);
}

function isLiveChartType(value: unknown): value is NotebookLiveChartType {
  return value === 'line' || value === 'scatter' || value === 'step' || value === 'bar' ||
    value === 'box' || value === 'candlestick';
}

function isDisplayStrategy(value: unknown): value is 'grid' | 'qText' {
  return value === 'grid' || value === 'qText';
}

function isPresentation(value: unknown): value is NotebookSettings['presentation'] {
  return value === 'inline' || value === 'panel' || value === 'both';
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function integerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) &&
    value >= minimum && value <= maximum;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return integerAtLeast(value, 0);
}

function positiveSafeInteger(value: unknown): value is number {
  return integerAtLeast(value, 1);
}

function integerAtLeast(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every(key => allowedKeys.has(key));
}
