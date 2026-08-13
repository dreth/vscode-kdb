import {
  KX_NOTEBOOK_MIME,
  PortableKxResult,
  validatePortableKxResult,
} from './notebook-contract';
import {
  KX_COLUMN_AUTO_TEXT_CHAR_LIMIT,
  KX_COLUMN_MAX_WIDTH,
  KX_COLUMN_MIN_WIDTH,
  PositionalColumnWidths,
  normalizePositionalColumnWidths,
} from './column-sizing';
import { NotebookSettings } from './notebook-settings';
import {
  SharedKxResultSettingKey,
  SharedKxResultSettings,
} from './results-ui-contract';
import type { ExportFormat, TextExportFormat } from './kx-results';

export const NOTEBOOK_LIVE_RESULT_METADATA_KEY = 'vscode-kdb.liveResult';
export const NOTEBOOK_OUTPUT_BINDING_METADATA_KEY = 'vscode-kdb.outputBinding';
export const MIN_NOTEBOOK_LIVE_ID_CHARS = 32;
export const MAX_NOTEBOOK_LIVE_ID_CHARS = 128;
export const MIN_NOTEBOOK_OUTPUT_ID_CHARS = 32;
export const MAX_NOTEBOOK_OUTPUT_ID_CHARS = 128;
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
export type NotebookResultSettingKey = SharedKxResultSettingKey;
export type NotebookLiveCopyFormat = TextExportFormat;

export interface NotebookLiveResultReference {
  version: 1;
  id: string;
}

export type NotebookOutputBindingReference = NotebookLiveResultReference;

export type NotebookRendererMessage =
  | { type: 'ready' }
  | {
    type: 'openPreview';
    outputId?: string;
    payload: PortableKxResult;
    requestId: number;
  }
  | { type: 'requestLiveResult'; outputId: string; liveId: string; requestId: number }
  | {
    type: 'requestLiveColumnTextLengths';
    outputId: string;
    liveId: string;
    requestId: number;
  }
  | {
    type: 'requestLiveSlice';
    outputId: string;
    liveId: string;
    requestId: number;
    startRow: number;
    endRow: number;
    startColumn: number;
    endColumn: number;
    columnIndexes?: number[];
    sortOrdinal?: number;
    sortColumn?: string;
    sortDirection?: NotebookLiveSortDirection;
  }
  | {
    type: 'searchLiveResult';
    outputId: string;
    liveId: string;
    requestId: number;
    query: string;
    columnIndexes?: number[];
    sortOrdinal?: number;
    sortColumn?: string;
    sortDirection?: NotebookLiveSortDirection;
  }
  | {
    type: 'requestLiveChart';
    outputId: string;
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
    xMin?: number;
    xMax?: number;
  }
  | {
    type: 'copyLiveRange';
    outputId: string;
    liveId: string;
    requestId: number;
    startRow: number;
    endRow: number;
    startColumn: number;
    endColumn: number;
    format: NotebookLiveCopyFormat;
    includeHeaders: boolean;
    includeRowIndex: boolean;
    columnIndexes?: number[];
    sortOrdinal?: number;
    sortColumn?: string;
    sortDirection?: NotebookLiveSortDirection;
  }
  | {
    type: 'exportLiveRange';
    outputId: string;
    liveId: string;
    requestId: number;
    startRow: number;
    endRow: number;
    startColumn: number;
    endColumn: number;
    format: ExportFormat;
    includeHeaders: boolean;
    includeRowIndex: boolean;
    columnIndexes?: number[];
    sortOrdinal?: number;
    sortColumn?: string;
    sortDirection?: NotebookLiveSortDirection;
  }
  | {
    type: 'exportPreviewRange';
    outputId?: string;
    requestId: number;
    payload: PortableKxResult;
    startRow: number;
    endRow: number;
    startColumn: number;
    endColumn: number;
    format: ExportFormat;
    includeHeaders: boolean;
    includeRowIndex: boolean;
    columnIndexes?: number[];
    rowIndexes?: number[];
  }
  | {
    type: 'copyPreviewRange';
    outputId?: string;
    requestId: number;
    payload: PortableKxResult;
    startRow: number;
    endRow: number;
    startColumn: number;
    endColumn: number;
    format: NotebookLiveCopyFormat;
    includeHeaders: boolean;
    includeRowIndex: boolean;
    columnIndexes?: number[];
    rowIndexes?: number[];
  }
  | { type: 'copyLiveText'; outputId: string; liveId: string; requestId: number }
  | { type: 'exportLiveText'; outputId: string; liveId: string; requestId: number }
  | {
    type: 'exportPreviewText';
    outputId?: string;
    payload: PortableKxResult;
    requestId: number;
  }
  | {
    type: 'exportChartPng';
    outputId?: string;
    payload: PortableKxResult;
    requestId: number;
    dataUrl: string;
  }
  | { type: 'rerunPreview'; outputId?: string; payload: PortableKxResult; requestId: number }
  | { type: 'openLiveResult'; outputId: string; liveId: string; requestId: number }
  | { type: 'updateResultSetting'; key: NotebookResultSettingKey; value: string | number | boolean }
  | { type: 'setResultColumnWidth'; position: number; width: number }
  | { type: 'resetResultColumnWidths' };

export interface NotebookRendererSettingsMessage extends Pick<NotebookSettings, 'presentation'> {
  type: 'settings';
  resultSettings: NotebookSharedKxResultSettings;
}

export type NotebookSharedKxResultSettings = SharedKxResultSettings;

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
  keyColumnOrdinals?: number[];
  totalColumnCount?: number;
  rowCount?: number;
  chartXColumns?: string[];
  chartYColumns?: string[];
  chartGroupColumns?: string[];
  wholeResultColumnTextLengths?: number[];
  text?: string;
  metadata?: NotebookLiveResultMetadata;
  message?: string;
}

export interface NotebookLiveColumnTextLengthsMessage {
  type: 'liveColumnTextLengths';
  liveId: string;
  requestId: number;
  lengths: number[];
}

export interface NotebookLiveSliceMessage {
  type: 'liveSlice';
  liveId: string;
  requestId: number;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  columnOrdinals: number[];
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
  gapBefore?: boolean[];
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

export interface NotebookActionResultMessage {
  type: 'actionResult';
  requestId: number;
  action: 'copy' | 'export' | 'exportText' | 'exportChartPng' | 'openPreview' | 'rerun';
  ok: boolean;
  canceled: boolean;
  message: string;
}

export type NotebookRendererHostMessage =
  | NotebookRendererSettingsMessage
  | NotebookLiveResultMessage
  | NotebookLiveColumnTextLengthsMessage
  | NotebookLiveSliceMessage
  | NotebookLiveSearchMessage
  | NotebookLiveChartMessage
  | NotebookLiveCopyMessage
  | NotebookActionResultMessage;

export function parseNotebookRendererMessage(raw: unknown): NotebookRendererMessage | undefined {
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    return undefined;
  }
  if (raw.type === 'ready') {
    return Object.keys(raw).length === 1 ? { type: 'ready' } : undefined;
  }
  if (raw.type === 'openPreview') {
    if (!hasOnlyKeys(raw, ['type', 'outputId', 'payload', 'requestId']) ||
      !validOptionalOutputId(raw.outputId) || !validRequestId(raw.requestId)) {
      return undefined;
    }
    const validation = validatePortableKxResult(raw.payload);
    return validation.ok
      ? {
        type: 'openPreview',
        ...(typeof raw.outputId === 'string' ? { outputId: raw.outputId } : {}),
        payload: validation.value,
        requestId: raw.requestId,
      }
      : undefined;
  }
  if (raw.type === 'requestLiveResult') {
    return hasOnlyKeys(raw, ['type', 'outputId', 'liveId', 'requestId']) &&
      validOutputId(raw.outputId) && validLiveId(raw.liveId) &&
      validRequestId(raw.requestId)
      ? {
        type: raw.type,
        outputId: raw.outputId,
        liveId: raw.liveId,
        requestId: raw.requestId,
      }
      : undefined;
  }
  if (raw.type === 'requestLiveColumnTextLengths') {
    return hasOnlyKeys(raw, ['type', 'outputId', 'liveId', 'requestId']) &&
      validOutputId(raw.outputId) && validLiveId(raw.liveId) &&
      validRequestId(raw.requestId)
      ? {
        type: raw.type,
        outputId: raw.outputId,
        liveId: raw.liveId,
        requestId: raw.requestId,
      }
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
  if (raw.type === 'exportLiveRange') {
    return parseLiveExportRequest(raw);
  }
  if (raw.type === 'exportPreviewRange' || raw.type === 'copyPreviewRange') {
    return parsePreviewExportRequest(raw);
  }
  if (raw.type === 'copyLiveText' || raw.type === 'exportLiveText') {
    return hasOnlyKeys(raw, ['type', 'outputId', 'liveId', 'requestId']) &&
      validOutputId(raw.outputId) && validLiveId(raw.liveId) &&
      validRequestId(raw.requestId)
      ? {
        type: raw.type,
        outputId: raw.outputId,
        liveId: raw.liveId,
        requestId: raw.requestId,
      }
      : undefined;
  }
  if (raw.type === 'exportPreviewText' || raw.type === 'rerunPreview') {
    return parsePreviewActionRequest(raw);
  }
  if (raw.type === 'exportChartPng') {
    return parseChartPngExportRequest(raw);
  }
  if (raw.type === 'openLiveResult') {
    return hasOnlyKeys(raw, ['type', 'outputId', 'liveId', 'requestId']) &&
      validOutputId(raw.outputId) && validLiveId(raw.liveId) &&
      validRequestId(raw.requestId)
      ? {
        type: raw.type,
        outputId: raw.outputId,
        liveId: raw.liveId,
        requestId: raw.requestId,
      }
      : undefined;
  }
  if (raw.type === 'updateResultSetting') {
    return parseResultSettingUpdate(raw);
  }
  if (raw.type === 'setResultColumnWidth') {
    return hasOnlyKeys(raw, ['type', 'position', 'width']) &&
      nonNegativeSafeInteger(raw.position) &&
      (raw.width === 0 || integerInRange(
        raw.width,
        KX_COLUMN_MIN_WIDTH,
        KX_COLUMN_MAX_WIDTH
      ))
      ? {
        type: raw.type,
        position: raw.position,
        width: raw.width,
      }
      : undefined;
  }
  if (raw.type === 'resetResultColumnWidths') {
    return hasOnlyKeys(raw, ['type'])
      ? { type: raw.type }
      : undefined;
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
  if (raw.type === 'liveColumnTextLengths') {
    return parseLiveColumnTextLengthsMessage(raw);
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
  if (raw.type === 'actionResult') {
    return parseActionResultMessage(raw);
  }
  return undefined;
}

export function notebookRendererSettingsMessage(
  settings: Pick<NotebookSettings, 'presentation'>,
  resultSettings: NotebookSharedKxResultSettings
): NotebookRendererSettingsMessage {
  return {
    type: 'settings',
    presentation: settings.presentation,
    resultSettings,
  };
}

export function parseNotebookLiveResultReference(raw: unknown): NotebookLiveResultReference | undefined {
  return isRecord(raw) && hasOnlyKeys(raw, ['version', 'id']) &&
    raw.version === 1 && validLiveId(raw.id)
    ? { version: 1, id: raw.id }
    : undefined;
}

export function parseNotebookOutputBindingReference(
  raw: unknown
): NotebookOutputBindingReference | undefined {
  return isRecord(raw) && hasOnlyKeys(raw, ['version', 'id']) &&
    raw.version === 1 && validOutputId(raw.id)
    ? { version: 1, id: raw.id }
    : undefined;
}

/** Accept the immediate renderer metadata and the nested Jupyter metadata that
 * survives an .ipynb save/reopen, while rejecting malformed conflicts. */
export function parseNotebookOutputBindingFromMetadata(
  raw: unknown
): NotebookOutputBindingReference | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const hasDirect = Object.prototype.hasOwnProperty.call(
    raw,
    NOTEBOOK_OUTPUT_BINDING_METADATA_KEY
  );
  const nestedMetadata = isRecord(raw.metadata) ? raw.metadata : undefined;
  const hasNested = !!nestedMetadata && Object.prototype.hasOwnProperty.call(
    nestedMetadata,
    NOTEBOOK_OUTPUT_BINDING_METADATA_KEY
  );
  const direct = parseNotebookOutputBindingReference(
    raw[NOTEBOOK_OUTPUT_BINDING_METADATA_KEY]
  );
  const nested = parseNotebookOutputBindingReference(
    nestedMetadata?.[NOTEBOOK_OUTPUT_BINDING_METADATA_KEY]
  );
  if ((hasDirect && !direct) || (hasNested && !nested) ||
    (direct && nested && direct.id !== nested.id)) {
    return undefined;
  }
  return direct ?? nested;
}

/** Proves that durable outer metadata is backed by one matching first-party
 * v2 MIME item. Callers can inspect outer metadata before invoking this parser. */
export function parseNotebookPortableOutputBinding(
  metadata: unknown,
  items: readonly { mime: string; data: Uint8Array }[]
): NotebookOutputBindingReference | undefined {
  const outer = parseNotebookOutputBindingFromMetadata(metadata);
  if (!outer || !Array.isArray(items)) {
    return undefined;
  }
  let portableItem: { mime: string; data: Uint8Array } | undefined;
  for (const item of items) {
    if (!item || item.mime !== KX_NOTEBOOK_MIME) {
      continue;
    }
    if (portableItem || !(item.data instanceof Uint8Array)) {
      return undefined;
    }
    portableItem = item;
  }
  if (!portableItem) {
    return undefined;
  }
  try {
    const validation = validatePortableKxResult(
      JSON.parse(new TextDecoder().decode(portableItem.data))
    );
    return validation.ok && validation.value.version === 2 &&
      validation.value.outputId === outer.id
      ? outer
      : undefined;
  } catch {
    return undefined;
  }
}

function parseLiveSliceRequest(raw: Record<string, unknown>): NotebookRendererMessage | undefined {
  if (!hasOnlyKeys(raw, [
    'type',
    'outputId',
    'liveId',
    'requestId',
    'startRow',
    'endRow',
    'startColumn',
    'endColumn',
    'columnIndexes',
    'sortOrdinal',
    'sortColumn',
    'sortDirection',
  ]) || !validOutputId(raw.outputId) || !validLiveId(raw.liveId) ||
    !validRequestId(raw.requestId) ||
    !nonNegativeSafeInteger(raw.startRow) || !nonNegativeSafeInteger(raw.endRow) ||
    !nonNegativeSafeInteger(raw.startColumn) || !nonNegativeSafeInteger(raw.endColumn) ||
    !validOptionalColumnIndexes(raw.columnIndexes)) {
    return undefined;
  }
  const startRow = raw.startRow;
  const endRow = raw.endRow;
  const startColumn = raw.startColumn;
  const endColumn = raw.endColumn;
  const rowCount = endRow - startRow + 1;
  const columnIndexes = optionalColumnIndexes(raw.columnIndexes);
  const columnCount = columnIndexes?.length ?? (endColumn - startColumn + 1);
  if (rowCount < 1 || rowCount > MAX_NOTEBOOK_LIVE_SLICE_ROWS ||
    columnCount < 1 || columnCount > MAX_NOTEBOOK_LIVE_SLICE_COLUMNS ||
    rowCount * columnCount > MAX_NOTEBOOK_LIVE_SLICE_CELLS ||
    !validOptionalSort(raw.sortColumn, raw.sortOrdinal, raw.sortDirection)) {
    return undefined;
  }
  return {
    type: 'requestLiveSlice',
    outputId: raw.outputId,
    liveId: raw.liveId,
    requestId: raw.requestId,
    startRow,
    endRow,
    startColumn,
    endColumn,
    ...(columnIndexes ? { columnIndexes } : {}),
    ...sortFields(raw),
  };
}

function parseLiveSearchRequest(raw: Record<string, unknown>): NotebookRendererMessage | undefined {
  if (!hasOnlyKeys(raw, [
    'type',
    'outputId',
    'liveId',
    'requestId',
    'query',
    'columnIndexes',
    'sortOrdinal',
    'sortColumn',
    'sortDirection',
  ]) || !validOutputId(raw.outputId) || !validLiveId(raw.liveId) ||
    !validRequestId(raw.requestId) ||
    typeof raw.query !== 'string' || raw.query.length > MAX_NOTEBOOK_LIVE_SEARCH_CHARS ||
    !validOptionalColumnIndexes(raw.columnIndexes) ||
    !validOptionalSort(raw.sortColumn, raw.sortOrdinal, raw.sortDirection)) {
    return undefined;
  }
  return {
    type: 'searchLiveResult',
    outputId: raw.outputId,
    liveId: raw.liveId,
    requestId: raw.requestId,
    query: raw.query,
    ...(optionalColumnIndexes(raw.columnIndexes)
      ? { columnIndexes: optionalColumnIndexes(raw.columnIndexes) }
      : {}),
    ...sortFields(raw),
  };
}

function parseLiveChartRequest(raw: Record<string, unknown>): NotebookRendererMessage | undefined {
  if (!hasOnlyKeys(raw, [
    'type',
    'outputId',
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
    'xMin',
    'xMax',
  ]) || !validOutputId(raw.outputId) || !validLiveId(raw.liveId) ||
    !validRequestId(raw.requestId) ||
    !isLiveChartType(raw.chartType) || !validColumnName(raw.xColumn) ||
    !Array.isArray(raw.yColumns) || raw.yColumns.length > 16 ||
    !raw.yColumns.every(validColumnName) || new Set(raw.yColumns).size !== raw.yColumns.length ||
    raw.yColumns.includes(raw.xColumn) ||
    !validOptionalColumnName(raw.groupByColumn) ||
    !validOptionalColumnName(raw.openColumn) ||
    !validOptionalColumnName(raw.highColumn) ||
    !validOptionalColumnName(raw.lowColumn) ||
    !validOptionalColumnName(raw.closeColumn) ||
    !positiveSafeInteger(raw.maxPoints) || raw.maxPoints > MAX_NOTEBOOK_LIVE_CHART_POINTS ||
    !validOptionalChartRange(raw.xMin, raw.xMax)) {
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
    outputId: raw.outputId,
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
    ...(typeof raw.xMin === 'number' && typeof raw.xMax === 'number'
      ? { xMin: raw.xMin, xMax: raw.xMax }
      : {}),
  };
}

function parseLiveCopyRequest(raw: Record<string, unknown>): NotebookRendererMessage | undefined {
  if (!hasOnlyKeys(raw, [
    'type',
    'outputId',
    'liveId',
    'requestId',
    'startRow',
    'endRow',
    'startColumn',
    'endColumn',
    'format',
    'includeHeaders',
    'includeRowIndex',
    'columnIndexes',
    'sortOrdinal',
    'sortColumn',
    'sortDirection',
  ]) || !validOutputId(raw.outputId) || !validLiveId(raw.liveId) ||
    !validRequestId(raw.requestId) ||
    !nonNegativeSafeInteger(raw.startRow) || !nonNegativeSafeInteger(raw.endRow) ||
    !nonNegativeSafeInteger(raw.startColumn) || !nonNegativeSafeInteger(raw.endColumn) ||
    raw.endRow < raw.startRow || raw.endColumn < raw.startColumn ||
    !isTextExportFormat(raw.format) ||
    typeof raw.includeHeaders !== 'boolean' ||
    typeof raw.includeRowIndex !== 'boolean' ||
    !validOptionalColumnIndexes(raw.columnIndexes) ||
    !validOptionalSort(raw.sortColumn, raw.sortOrdinal, raw.sortDirection)) {
    return undefined;
  }
  const columnIndexes = optionalColumnIndexes(raw.columnIndexes);
  const columnCount = columnIndexes?.length ?? (raw.endColumn - raw.startColumn + 1);
  const cellCount = (raw.endRow - raw.startRow + 1) * columnCount;
  if (!Number.isSafeInteger(cellCount) || cellCount > MAX_NOTEBOOK_LIVE_COPY_CELLS) {
    return undefined;
  }
  return {
    type: 'copyLiveRange',
    outputId: raw.outputId,
    liveId: raw.liveId,
    requestId: raw.requestId,
    startRow: raw.startRow as number,
    endRow: raw.endRow as number,
    startColumn: raw.startColumn as number,
    endColumn: raw.endColumn as number,
    format: raw.format,
    includeHeaders: raw.includeHeaders,
    includeRowIndex: raw.includeRowIndex,
    ...(columnIndexes ? { columnIndexes } : {}),
    ...sortFields(raw),
  };
}

function parseLiveExportRequest(raw: Record<string, unknown>): NotebookRendererMessage | undefined {
  if (!hasOnlyKeys(raw, [
    'type',
    'outputId',
    'liveId',
    'requestId',
    'startRow',
    'endRow',
    'startColumn',
    'endColumn',
    'format',
    'includeHeaders',
    'includeRowIndex',
    'columnIndexes',
    'sortOrdinal',
    'sortColumn',
    'sortDirection',
  ]) || !validOutputId(raw.outputId) || !validLiveId(raw.liveId) ||
    !validRequestId(raw.requestId) ||
    !validResultRange(raw) || !isExportFormat(raw.format) ||
    typeof raw.includeHeaders !== 'boolean' ||
    typeof raw.includeRowIndex !== 'boolean' ||
    !validOptionalColumnIndexes(raw.columnIndexes) ||
    !validOptionalSort(raw.sortColumn, raw.sortOrdinal, raw.sortDirection)) {
    return undefined;
  }
  const columnIndexes = optionalColumnIndexes(raw.columnIndexes);
  return {
    type: 'exportLiveRange',
    outputId: raw.outputId,
    liveId: raw.liveId,
    requestId: raw.requestId,
    startRow: raw.startRow as number,
    endRow: raw.endRow as number,
    startColumn: raw.startColumn as number,
    endColumn: raw.endColumn as number,
    format: raw.format,
    includeHeaders: raw.includeHeaders,
    includeRowIndex: raw.includeRowIndex,
    ...(columnIndexes ? { columnIndexes } : {}),
    ...sortFields(raw),
  };
}

function parsePreviewExportRequest(
  raw: Record<string, unknown>
): NotebookRendererMessage | undefined {
  if (!hasOnlyKeys(raw, [
    'type',
    'outputId',
    'requestId',
    'payload',
    'startRow',
    'endRow',
    'startColumn',
    'endColumn',
    'format',
    'includeHeaders',
    'includeRowIndex',
    'columnIndexes',
    'rowIndexes',
  ]) || !validOptionalOutputId(raw.outputId) || !validRequestId(raw.requestId) ||
    !validResultRange(raw) ||
    (raw.type === 'copyPreviewRange'
      ? !isTextExportFormat(raw.format)
      : !isExportFormat(raw.format)) ||
    typeof raw.includeHeaders !== 'boolean' ||
    typeof raw.includeRowIndex !== 'boolean' ||
    (raw.columnIndexes !== undefined && !Array.isArray(raw.columnIndexes)) ||
    (raw.rowIndexes !== undefined && !Array.isArray(raw.rowIndexes))) {
    return undefined;
  }
  const validation = validatePortableKxResult(raw.payload);
  if (!validation.ok || validation.value.kind !== 'table') {
    return undefined;
  }
  const payload = validation.value;
  if (!validOptionalSavedIndexes(raw.columnIndexes, payload.schema.columns.length) ||
    !validOptionalSavedIndexes(raw.rowIndexes, payload.data.rows.length)) {
    return undefined;
  }
  if ((raw.endRow as number) >= payload.data.rows.length ||
    (raw.endColumn as number) >= payload.schema.columns.length) {
    return undefined;
  }
  const columnIndexes = optionalColumnIndexes(raw.columnIndexes);
  const rowIndexes = optionalRowIndexes(raw.rowIndexes);
  if (columnIndexes?.some(index => index >= payload.schema.columns.length)) {
    return undefined;
  }
  if (rowIndexes?.some(index => index >= payload.data.rows.length)) {
    return undefined;
  }
  if ((columnIndexes && columnIndexes.length !==
      (raw.endColumn as number) - (raw.startColumn as number) + 1) ||
    (rowIndexes && rowIndexes.length !==
      (raw.endRow as number) - (raw.startRow as number) + 1)) {
    return undefined;
  }
  const common = {
    ...(typeof raw.outputId === 'string' ? { outputId: raw.outputId } : {}),
    requestId: raw.requestId,
    payload,
    startRow: raw.startRow as number,
    endRow: raw.endRow as number,
    startColumn: raw.startColumn as number,
    endColumn: raw.endColumn as number,
    includeHeaders: raw.includeHeaders,
    includeRowIndex: raw.includeRowIndex,
    ...(columnIndexes ? { columnIndexes } : {}),
    ...(rowIndexes ? { rowIndexes } : {}),
  };
  return raw.type === 'copyPreviewRange'
    ? {
      type: 'copyPreviewRange',
      ...common,
      format: raw.format as TextExportFormat,
    }
    : {
      type: 'exportPreviewRange',
      ...common,
      format: raw.format as ExportFormat,
    };
}

function parsePreviewActionRequest(
  raw: Record<string, unknown>
): NotebookRendererMessage | undefined {
  if (!hasOnlyKeys(raw, ['type', 'outputId', 'payload', 'requestId']) ||
    !validOptionalOutputId(raw.outputId) || !validRequestId(raw.requestId)) {
    return undefined;
  }
  const validation = validatePortableKxResult(raw.payload);
  if (!validation.ok ||
    (raw.type === 'exportPreviewText' && validation.value.kind !== 'qText')) {
    return undefined;
  }
  return {
    type: raw.type as 'exportPreviewText' | 'rerunPreview',
    ...(typeof raw.outputId === 'string' ? { outputId: raw.outputId } : {}),
    payload: validation.value,
    requestId: raw.requestId,
  };
}

function parseChartPngExportRequest(
  raw: Record<string, unknown>
): NotebookRendererMessage | undefined {
  const prefix = 'data:image/png;base64,';
  if (!hasOnlyKeys(raw, ['type', 'outputId', 'payload', 'requestId', 'dataUrl']) ||
    !validOptionalOutputId(raw.outputId) || !validRequestId(raw.requestId) ||
    typeof raw.dataUrl !== 'string' ||
    raw.dataUrl.length <= prefix.length || raw.dataUrl.length > 70_000_000 ||
    !raw.dataUrl.startsWith(prefix)) {
    return undefined;
  }
  const validation = validatePortableKxResult(raw.payload);
  if (!validation.ok || validation.value.kind !== 'table') {
    return undefined;
  }
  return {
    type: 'exportChartPng',
    ...(typeof raw.outputId === 'string' ? { outputId: raw.outputId } : {}),
    payload: validation.value,
    requestId: raw.requestId,
    dataUrl: raw.dataUrl,
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
    'resultSettings',
  ]) || !isPresentation(raw.presentation)) {
    return undefined;
  }
  const resultSettings = parseSharedResultSettings(raw.resultSettings);
  return resultSettings
    ? {
      type: 'settings',
      presentation: raw.presentation,
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
    'keyColumnOrdinals',
    'totalColumnCount',
    'rowCount',
    'chartXColumns',
    'chartYColumns',
    'chartGroupColumns',
    'wholeResultColumnTextLengths',
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
    !validOptionalKeyColumnOrdinals(raw.keyColumnOrdinals, raw.columns.length) ||
    (raw.totalColumnCount !== undefined &&
      (!nonNegativeSafeInteger(raw.totalColumnCount) ||
        raw.totalColumnCount < raw.columns.length)) ||
    !validOptionalColumnList(raw.chartXColumns) ||
    !validOptionalColumnList(raw.chartYColumns) ||
    !validOptionalColumnList(raw.chartGroupColumns) ||
    !validOptionalColumnTextLengths(
      raw.wholeResultColumnTextLengths,
      raw.columns.length
    )) {
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
    ...(Array.isArray(raw.keyColumnOrdinals)
      ? { keyColumnOrdinals: raw.keyColumnOrdinals.slice() as number[] }
      : {}),
    ...(typeof raw.totalColumnCount === 'number'
      ? { totalColumnCount: raw.totalColumnCount }
      : {}),
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
    ...(Array.isArray(raw.wholeResultColumnTextLengths)
      ? { wholeResultColumnTextLengths: raw.wholeResultColumnTextLengths.slice() as number[] }
      : {}),
    ...(raw.mode === 'text' ? { text: raw.text as string } : {}),
    metadata,
    ...(typeof raw.message === 'string' ? { message: raw.message } : {}),
  };
}

function parseLiveColumnTextLengthsMessage(
  raw: Record<string, unknown>
): NotebookLiveColumnTextLengthsMessage | undefined {
  if (!hasOnlyKeys(raw, ['type', 'liveId', 'requestId', 'lengths']) ||
    !validLiveId(raw.liveId) ||
    !validRequestId(raw.requestId) ||
    !Array.isArray(raw.lengths) ||
    raw.lengths.length > MAX_NOTEBOOK_LIVE_COLUMNS ||
    !raw.lengths.every(length => integerInRange(
      length,
      0,
      KX_COLUMN_AUTO_TEXT_CHAR_LIMIT
    ))) {
    return undefined;
  }
  return {
    type: 'liveColumnTextLengths',
    liveId: raw.liveId,
    requestId: raw.requestId,
    lengths: raw.lengths.slice() as number[],
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
    'columnOrdinals',
    'cells',
    'error',
  ]) || !validLiveId(raw.liveId) || !validRequestId(raw.requestId) ||
    !nonNegativeSafeInteger(raw.startRow) || !integerAtLeast(raw.endRow, -1) ||
    !nonNegativeSafeInteger(raw.startColumn) || !integerAtLeast(raw.endColumn, -1) ||
    !validColumnOrdinals(raw.columnOrdinals, true) ||
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
    if (raw.endRow !== -1 || raw.endColumn !== -1 || raw.columnOrdinals.length !== 0) {
      return undefined;
    }
  } else {
    const width = cells[0].length;
    if (!cells.every(row => row.length === width) ||
      raw.endRow !== raw.startRow + cells.length - 1 ||
      raw.endColumn !== raw.startColumn + width - 1 ||
      raw.columnOrdinals.length !== width) {
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
    columnOrdinals: raw.columnOrdinals.slice(),
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

function parseActionResultMessage(
  raw: Record<string, unknown>
): NotebookActionResultMessage | undefined {
  if (!hasOnlyKeys(raw, [
    'type',
    'requestId',
    'action',
    'ok',
    'canceled',
    'message',
  ]) || !validRequestId(raw.requestId) ||
    (raw.action !== 'copy' && raw.action !== 'export' && raw.action !== 'exportText' &&
      raw.action !== 'exportChartPng' && raw.action !== 'openPreview' &&
      raw.action !== 'rerun') ||
    typeof raw.ok !== 'boolean' || typeof raw.canceled !== 'boolean' ||
    !validBoundedText(raw.message, 4_096)) {
    return undefined;
  }
  return {
    type: 'actionResult',
    requestId: raw.requestId,
    action: raw.action,
    ok: raw.ok,
    canceled: raw.canceled,
    message: raw.message,
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
      'gapBefore',
    ]) ||
      !validColumnName(value.columnName) || !Array.isArray(value.values) ||
      value.values.length !== raw.x.length ||
      !value.values.every(item => item === null || finiteNumber(item)) ||
      !validOptionalColumnName(value.sourceColumnName) ||
      !validOptionalText(value.groupValue, 512) ||
      (value.gapFlags !== undefined &&
        (!Array.isArray(value.gapFlags) || value.gapFlags.length !== raw.x.length ||
          !value.gapFlags.every(flag => typeof flag === 'boolean'))) ||
      (value.gapBefore !== undefined &&
        (!Array.isArray(value.gapBefore) || value.gapBefore.length !== raw.x.length ||
          !value.gapBefore.every(flag => typeof flag === 'boolean')))) {
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
      ...(Array.isArray(value.gapBefore)
        ? { gapBefore: value.gapBefore.slice() as boolean[] }
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
  if (!isRecord(raw)) {
    return undefined;
  }
  const columnWidths = parsePositionalColumnWidths(raw.columnWidths);
  if (!columnWidths || !hasOnlyKeys(raw, [
    'cellWidth',
    'columnWidths',
    'autoFitColumns',
    'autoFitMode',
    'rowHeight',
    'fontSize',
    'density',
    'showRowIndex',
    'includeHeaders',
    'includeRowIndex',
    'copyExportConfirmCellThreshold',
    'elapsedTimeDisplay',
    'chartDecimalPlaces',
    'chartMaxSourceRows',
    'qTextSyntaxHighlighting',
    'qTextDisplayFormatting',
    'arrayDisplayFormat',
    'functionDisplayStrategy',
    'dictionaryDisplayStrategy',
    'listDisplayStrategy',
    'objectDisplayStrategy',
  ]) || !integerInRange(raw.cellWidth, 80, 600) ||
    typeof raw.autoFitColumns !== 'boolean' ||
    (raw.autoFitMode !== 'wholeResult' && raw.autoFitMode !== 'visibleRows') ||
    !integerInRange(raw.rowHeight, 20, 80) || !integerInRange(raw.fontSize, 0, 32) ||
    (raw.density !== 'compact' && raw.density !== 'standard' && raw.density !== 'comfortable') ||
    typeof raw.showRowIndex !== 'boolean' ||
    typeof raw.includeHeaders !== 'boolean' ||
    typeof raw.includeRowIndex !== 'boolean' ||
    !positiveSafeInteger(raw.copyExportConfirmCellThreshold) ||
    (raw.elapsedTimeDisplay !== 'auto' && raw.elapsedTimeDisplay !== 'milliseconds') ||
    !integerInRange(raw.chartDecimalPlaces, 0, 12) ||
    !positiveSafeInteger(raw.chartMaxSourceRows) ||
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
    columnWidths,
    autoFitColumns: raw.autoFitColumns,
    autoFitMode: raw.autoFitMode,
    rowHeight: raw.rowHeight,
    fontSize: raw.fontSize,
    density: raw.density,
    showRowIndex: raw.showRowIndex,
    includeHeaders: raw.includeHeaders,
    includeRowIndex: raw.includeRowIndex,
    copyExportConfirmCellThreshold: raw.copyExportConfirmCellThreshold,
    elapsedTimeDisplay: raw.elapsedTimeDisplay,
    chartDecimalPlaces: raw.chartDecimalPlaces,
    chartMaxSourceRows: raw.chartMaxSourceRows,
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
    case 'autoFitColumns':
      return typeof value === 'boolean' ? value : undefined;
    case 'autoFitMode':
      return value === 'wholeResult' || value === 'visibleRows' ? value : undefined;
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
    case 'copyExportConfirmCellThreshold':
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

function validResultRange(raw: Record<string, unknown>): boolean {
  return nonNegativeSafeInteger(raw.startRow) && nonNegativeSafeInteger(raw.endRow) &&
    nonNegativeSafeInteger(raw.startColumn) && nonNegativeSafeInteger(raw.endColumn) &&
    raw.endRow >= raw.startRow && raw.endColumn >= raw.startColumn;
}

function validOptionalColumnIndexes(value: unknown): boolean {
  return value === undefined ||
    (Array.isArray(value) && value.length > 0 && value.length <= MAX_NOTEBOOK_LIVE_COLUMNS &&
      value.every(nonNegativeSafeInteger) && new Set(value).size === value.length);
}

function validOptionalSavedIndexes(value: unknown, maximumLength: number): boolean {
  return value === undefined ||
    (Array.isArray(value) && value.length > 0 && value.length <= maximumLength &&
      value.every(nonNegativeSafeInteger) && new Set(value).size === value.length);
}

function validColumnOrdinals(value: unknown, allowEmpty = false): value is number[] {
  return Array.isArray(value) && (allowEmpty || value.length > 0) &&
    value.length <= MAX_NOTEBOOK_LIVE_COLUMNS &&
    isDensePrimitiveArray(value) && value.every(nonNegativeSafeInteger) &&
    new Set(value).size === value.length;
}

function validOptionalKeyColumnOrdinals(
  value: unknown,
  columnCount: number
): boolean {
  return value === undefined || (
    validColumnOrdinals(value, true) && value.every(ordinal => ordinal < columnCount)
  );
}

function isDensePrimitiveArray(value: unknown[]): boolean {
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || keys.some(key => key !== 'length' && (
      typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length
    ))) {
      return false;
    }
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function optionalColumnIndexes(value: unknown): number[] | undefined {
  return Array.isArray(value) ? (value as number[]).slice() : undefined;
}

function optionalRowIndexes(value: unknown): number[] | undefined {
  return Array.isArray(value) ? (value as number[]).slice() : undefined;
}

function validOptionalChartRange(xMin: unknown, xMax: unknown): boolean {
  if (xMin === undefined && xMax === undefined) {
    return true;
  }
  return finiteNumber(xMin) && finiteNumber(xMax) && xMax > xMin;
}

function isTextExportFormat(value: unknown): value is TextExportFormat {
  return value === 'csv' || value === 'json' || value === 'ndjson' ||
    value === 'html' || value === 'markdown' || value === 'tsv';
}

function isExportFormat(value: unknown): value is ExportFormat {
  return value === 'xlsx' || isTextExportFormat(value);
}

function validOptionalSort(
  sortColumn: unknown,
  sortOrdinal: unknown,
  sortDirection: unknown
): boolean {
  if (sortColumn === undefined && sortOrdinal === undefined && sortDirection === undefined) {
    return true;
  }
  const hasColumn = validColumnName(sortColumn);
  const hasOrdinal = nonNegativeSafeInteger(sortOrdinal);
  return hasColumn !== hasOrdinal &&
    (sortDirection === 'asc' || sortDirection === 'desc');
}

function sortFields(raw: Record<string, unknown>): {
  sortOrdinal?: number;
  sortColumn?: string;
  sortDirection?: NotebookLiveSortDirection;
} {
  if (raw.sortDirection !== 'asc' && raw.sortDirection !== 'desc') {
    return {};
  }
  if (nonNegativeSafeInteger(raw.sortOrdinal)) {
    return { sortOrdinal: raw.sortOrdinal, sortDirection: raw.sortDirection };
  }
  return typeof raw.sortColumn === 'string'
    ? { sortColumn: raw.sortColumn, sortDirection: raw.sortDirection }
    : {};
}

function validLiveId(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length >= MIN_NOTEBOOK_LIVE_ID_CHARS &&
    value.length <= MAX_NOTEBOOK_LIVE_ID_CHARS &&
    /^[A-Za-z0-9_-]+$/.test(value);
}

function validOutputId(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length >= MIN_NOTEBOOK_OUTPUT_ID_CHARS &&
    value.length <= MAX_NOTEBOOK_OUTPUT_ID_CHARS &&
    /^[A-Za-z0-9_-]+$/.test(value);
}

function validOptionalOutputId(value: unknown): boolean {
  return value === undefined || validOutputId(value);
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

function validOptionalColumnTextLengths(value: unknown, columnCount: number): boolean {
  return value === undefined ||
    (Array.isArray(value) &&
      value.length === columnCount &&
      value.every(length => integerInRange(
        length,
        0,
        KX_COLUMN_AUTO_TEXT_CHAR_LIMIT
      )));
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

function parsePositionalColumnWidths(
  value: unknown
): PositionalColumnWidths | undefined {
  if (Array.isArray(value)) {
    if (!value.every(width =>
      width === 0 || integerInRange(
        width,
        KX_COLUMN_MIN_WIDTH,
        KX_COLUMN_MAX_WIDTH
      ))) {
      return undefined;
    }
    return normalizePositionalColumnWidths(value);
  }
  if (!isRecord(value) || !Object.keys(value).every(key =>
    /^(0|[1-9]\d*)$/.test(key) &&
    integerInRange(
      value[key],
      KX_COLUMN_MIN_WIDTH,
      KX_COLUMN_MAX_WIDTH
    ))) {
    return undefined;
  }
  return normalizePositionalColumnWidths(value);
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
