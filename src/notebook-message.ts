import {
  KX_NOTEBOOK_MIME,
  PortableKxResult,
  validatePortableKxResult,
} from './notebook-contract';
import { NotebookSettings } from './notebook-settings';

export const NOTEBOOK_LIVE_RESULT_METADATA_KEY = 'vscode-kdb.liveResult';
export const NOTEBOOK_OUTPUT_METADATA_KEY = 'vscode-kdb.output';
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

export interface NotebookOutputReference {
  version: 1;
  id: string;
}

export interface NotebookOutputMessageIdentity {
  outputId: string;
  renderGeneration: number;
  requestId: number;
}

export interface NotebookLiveMessageIdentity extends NotebookOutputMessageIdentity {
  liveId: string;
}

export type NotebookRendererMessage =
  | { type: 'ready' }
  | ({ type: 'bindOutput'; liveId?: string } & NotebookOutputMessageIdentity)
  | ({ type: 'unbindOutput'; liveId?: string } & NotebookOutputMessageIdentity)
  | ({ type: 'openPreview'; payload: PortableKxResult } & NotebookOutputMessageIdentity)
  | ({ type: 'requestLiveResult' } & NotebookLiveMessageIdentity)
  | ({
    type: 'requestLiveSlice';
    startRow: number;
    endRow: number;
    startColumn: number;
    endColumn: number;
    columnOrdinals: number[];
    sortOrdinal?: number;
    sortDirection?: NotebookLiveSortDirection;
  } & NotebookLiveMessageIdentity)
  | ({
    type: 'searchLiveResult';
    query: string;
    sortOrdinal?: number;
    sortDirection?: NotebookLiveSortDirection;
  } & NotebookLiveMessageIdentity)
  | ({
    type: 'requestLiveChart';
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
  } & NotebookLiveMessageIdentity)
  | ({
    type: 'copyLiveRange';
    startRow: number;
    endRow: number;
    startColumn: number;
    endColumn: number;
    columnOrdinals: number[];
    format: 'tsv' | 'csv';
    includeHeaders: boolean;
    includeRowIndex: boolean;
    sortOrdinal?: number;
    sortDirection?: NotebookLiveSortDirection;
  } & NotebookLiveMessageIdentity)
  | ({ type: 'openLiveResult' } & NotebookLiveMessageIdentity)
  | ({
    type: 'setOutputPersistence';
    mode: 'preview' | 'full';
    liveId?: string;
  } & NotebookOutputMessageIdentity)
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
  chartZoomMinSampledPoints: number;
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
  connectionName?: string;
  elapsedMs?: number;
  messages?: string[];
}

export interface NotebookLiveResultMessage extends NotebookLiveMessageIdentity {
  type: 'liveResult';
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

export interface NotebookLiveSliceMessage extends NotebookLiveMessageIdentity {
  type: 'liveSlice';
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  columnOrdinals: number[];
  cells: string[][];
  error?: string;
}

export interface NotebookLiveSearchMessage extends NotebookLiveMessageIdentity {
  type: 'liveSearch';
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

export interface NotebookLiveChartMessage extends NotebookLiveMessageIdentity {
  type: 'liveChart';
  data?: NotebookLiveChartData;
  error?: string;
}

export interface NotebookLiveCopyMessage extends NotebookLiveMessageIdentity {
  type: 'liveCopy';
  ok: boolean;
  message?: string;
}

export interface NotebookOutputPersistenceMessage extends NotebookOutputMessageIdentity {
  type: 'outputPersistence';
  mode: 'preview' | 'full';
  enabled: boolean;
  checked: boolean;
  message?: string;
}

export interface NotebookLiveInvalidatedMessage {
  type: 'liveResultInvalidated';
  liveId: string;
  reason:
    | 'removed'
    | 'replaced'
    | 'evicted'
    | 'output-unbound'
    | 'duplicate-output'
    | 'notebook-closed'
    | 'cleared';
  message: string;
}

export type NotebookRendererHostMessage =
  | NotebookRendererSettingsMessage
  | NotebookLiveResultMessage
  | NotebookLiveSliceMessage
  | NotebookLiveSearchMessage
  | NotebookLiveChartMessage
  | NotebookLiveCopyMessage
  | NotebookOutputPersistenceMessage
  | NotebookLiveInvalidatedMessage;

export function parseNotebookRendererMessage(raw: unknown): NotebookRendererMessage | undefined {
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    return undefined;
  }
  if (raw.type === 'ready') {
    return Object.keys(raw).length === 1 ? { type: 'ready' } : undefined;
  }
  if (raw.type === 'bindOutput' || raw.type === 'unbindOutput') {
    return hasOnlyKeys(raw, [
      'type',
      'outputId',
      'liveId',
      'renderGeneration',
      'requestId',
    ]) && validOutputIdentity(raw) &&
      (raw.liveId === undefined || validLiveId(raw.liveId))
      ? {
        type: raw.type,
        ...outputIdentity(raw),
        ...(typeof raw.liveId === 'string' ? { liveId: raw.liveId } : {}),
      }
      : undefined;
  }
  if (raw.type === 'openPreview') {
    if (!hasOnlyKeys(raw, [
      'type',
      'payload',
      'outputId',
      'renderGeneration',
      'requestId',
    ]) || !validOutputIdentity(raw)) {
      return undefined;
    }
    const validation = validatePortableKxResult(raw.payload);
    return validation.ok
      ? { type: 'openPreview', payload: validation.value, ...outputIdentity(raw) }
      : undefined;
  }
  if (raw.type === 'requestLiveResult') {
    return hasOnlyKeys(raw, [
      'type',
      'outputId',
      'liveId',
      'renderGeneration',
      'requestId',
    ]) && validLiveIdentity(raw)
      ? { type: raw.type, ...liveIdentity(raw) }
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
    return hasOnlyKeys(raw, [
      'type',
      'outputId',
      'liveId',
      'renderGeneration',
      'requestId',
    ]) && validLiveIdentity(raw)
      ? { type: raw.type, ...liveIdentity(raw) }
      : undefined;
  }
  if (raw.type === 'setOutputPersistence') {
    return hasOnlyKeys(raw, [
      'type',
      'outputId',
      'liveId',
      'renderGeneration',
      'requestId',
      'mode',
    ]) && validOutputIdentity(raw) &&
      (raw.liveId === undefined || validLiveId(raw.liveId)) &&
      (raw.mode === 'preview' || raw.mode === 'full')
      ? {
        type: raw.type,
        ...outputIdentity(raw),
        ...(typeof raw.liveId === 'string' ? { liveId: raw.liveId } : {}),
        mode: raw.mode,
      }
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
  if (raw.type === 'outputPersistence') {
    return parseOutputPersistenceMessage(raw);
  }
  if (raw.type === 'liveResultInvalidated') {
    const reasons = new Set([
      'removed',
      'replaced',
      'evicted',
      'output-unbound',
      'duplicate-output',
      'notebook-closed',
      'cleared',
    ]);
    return hasOnlyKeys(raw, ['type', 'liveId', 'reason', 'message']) &&
      validLiveId(raw.liveId) && typeof raw.reason === 'string' &&
      reasons.has(raw.reason) && validBoundedText(raw.message, 4_096)
      ? {
        type: 'liveResultInvalidated',
        liveId: raw.liveId,
        reason: raw.reason as NotebookLiveInvalidatedMessage['reason'],
        message: raw.message,
      }
      : undefined;
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

export function parseNotebookOutputReference(raw: unknown): NotebookOutputReference | undefined {
  return isRecord(raw) && hasOnlyKeys(raw, ['version', 'id']) &&
    raw.version === 1 && validLiveId(raw.id)
    ? { version: 1, id: raw.id }
    : undefined;
}

/**
 * VS Code's built-in ipynb serializer persists custom output metadata from the
 * nested `metadata` object. Accept the legacy/immediate top-level location and
 * that serialized location, but reject malformed or conflicting duplicates.
 */
export function parseNotebookOutputReferenceFromMetadata(
  raw: unknown
): NotebookOutputReference | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const hasDirect = Object.prototype.hasOwnProperty.call(raw, NOTEBOOK_OUTPUT_METADATA_KEY);
  const nestedMetadata = isRecord(raw.metadata) ? raw.metadata : undefined;
  const hasNested = !!nestedMetadata &&
    Object.prototype.hasOwnProperty.call(nestedMetadata, NOTEBOOK_OUTPUT_METADATA_KEY);
  const direct = parseNotebookOutputReference(raw[NOTEBOOK_OUTPUT_METADATA_KEY]);
  const nested = parseNotebookOutputReference(
    nestedMetadata?.[NOTEBOOK_OUTPUT_METADATA_KEY]
  );
  if ((hasDirect && !direct) || (hasNested && !nested) ||
    (direct && nested && direct.id !== nested.id)) {
    return undefined;
  }
  return direct ?? nested;
}

/**
 * Proves that outer notebook-output metadata is backed by exactly one valid
 * first-party v2 MIME item carrying the same durable output identity.
 * Session-only live metadata is never sufficient by itself.
 */
export function parseNotebookPortableOutputBinding(
  metadata: unknown,
  items: readonly { mime: string; data: Uint8Array }[]
): NotebookOutputReference | undefined {
  const outer = parseNotebookOutputReferenceFromMetadata(metadata);
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
    'renderGeneration',
    'requestId',
    'startRow',
    'endRow',
    'startColumn',
    'endColumn',
    'columnOrdinals',
    'sortOrdinal',
    'sortDirection',
  ]) || !validLiveIdentity(raw) ||
    !nonNegativeSafeInteger(raw.startRow) || !nonNegativeSafeInteger(raw.endRow) ||
    !nonNegativeSafeInteger(raw.startColumn) || !nonNegativeSafeInteger(raw.endColumn) ||
    !validColumnOrdinals(raw.columnOrdinals)) {
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
    raw.columnOrdinals.length !== columnCount ||
    rowCount * columnCount > MAX_NOTEBOOK_LIVE_SLICE_CELLS ||
    !validOptionalSort(raw.sortOrdinal, raw.sortDirection)) {
    return undefined;
  }
  return {
    type: 'requestLiveSlice',
    ...liveIdentity(raw),
    startRow,
    endRow,
    startColumn,
    endColumn,
    columnOrdinals: raw.columnOrdinals.slice(),
    ...sortFields(raw),
  };
}

function parseLiveSearchRequest(raw: Record<string, unknown>): NotebookRendererMessage | undefined {
  if (!hasOnlyKeys(raw, [
    'type',
    'outputId',
    'liveId',
    'renderGeneration',
    'requestId',
    'query',
    'sortOrdinal',
    'sortDirection',
  ]) || !validLiveIdentity(raw) ||
    typeof raw.query !== 'string' || raw.query.length > MAX_NOTEBOOK_LIVE_SEARCH_CHARS ||
    !validOptionalSort(raw.sortOrdinal, raw.sortDirection)) {
    return undefined;
  }
  return {
    type: 'searchLiveResult',
    ...liveIdentity(raw),
    query: raw.query,
    ...sortFields(raw),
  };
}

function parseLiveChartRequest(raw: Record<string, unknown>): NotebookRendererMessage | undefined {
  if (!hasOnlyKeys(raw, [
    'type',
    'outputId',
    'liveId',
    'renderGeneration',
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
  ]) || !validLiveIdentity(raw) ||
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
    ...liveIdentity(raw),
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
    'renderGeneration',
    'requestId',
    'startRow',
    'endRow',
    'startColumn',
    'endColumn',
    'columnOrdinals',
    'format',
    'includeHeaders',
    'includeRowIndex',
    'sortOrdinal',
    'sortDirection',
  ]) || !validLiveIdentity(raw) ||
    !nonNegativeSafeInteger(raw.startRow) || !nonNegativeSafeInteger(raw.endRow) ||
    !nonNegativeSafeInteger(raw.startColumn) || !nonNegativeSafeInteger(raw.endColumn) ||
    raw.endRow < raw.startRow || raw.endColumn < raw.startColumn ||
    !validColumnOrdinals(raw.columnOrdinals, false, MAX_NOTEBOOK_LIVE_COLUMNS) ||
    raw.columnOrdinals.length !== raw.endColumn - raw.startColumn + 1 ||
    (raw.format !== 'tsv' && raw.format !== 'csv') ||
    typeof raw.includeHeaders !== 'boolean' ||
    typeof raw.includeRowIndex !== 'boolean' ||
    !validOptionalSort(raw.sortOrdinal, raw.sortDirection)) {
    return undefined;
  }
  const cellCount =
    (raw.endRow - raw.startRow + 1) * (raw.endColumn - raw.startColumn + 1);
  if (!Number.isSafeInteger(cellCount) || cellCount > MAX_NOTEBOOK_LIVE_COPY_CELLS) {
    return undefined;
  }
  return {
    type: 'copyLiveRange',
    ...liveIdentity(raw),
    startRow: raw.startRow,
    endRow: raw.endRow,
    startColumn: raw.startColumn,
    endColumn: raw.endColumn,
    columnOrdinals: raw.columnOrdinals.slice(),
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
    'preserveFullResultByDefault',
    'resultSettings',
  ]) || !isPresentation(raw.presentation) || !positiveSafeInteger(raw.rowLimit) ||
    !positiveSafeInteger(raw.byteLimit) || typeof raw.preserveFullResultByDefault !== 'boolean') {
    return undefined;
  }
  const resultSettings = parseSharedResultSettings(raw.resultSettings);
  return resultSettings
    ? {
      type: 'settings',
      presentation: raw.presentation,
      rowLimit: raw.rowLimit,
      byteLimit: raw.byteLimit,
      preserveFullResultByDefault: raw.preserveFullResultByDefault,
      resultSettings,
    }
    : undefined;
}

function parseLiveResultMessage(raw: Record<string, unknown>): NotebookLiveResultMessage | undefined {
  if (!hasOnlyKeys(raw, [
    'type',
    'outputId',
    'liveId',
    'renderGeneration',
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
  ]) || !validLiveIdentity(raw) ||
    typeof raw.available !== 'boolean' || !validOptionalText(raw.message, 4_096)) {
    return undefined;
  }
  if (!raw.available) {
    return {
      type: 'liveResult',
      ...liveIdentity(raw),
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
    ...liveIdentity(raw),
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
    'outputId',
    'liveId',
    'renderGeneration',
    'requestId',
    'startRow',
    'endRow',
    'startColumn',
    'endColumn',
    'columnOrdinals',
    'cells',
    'error',
  ]) || !validLiveIdentity(raw) ||
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
    if (raw.endRow !== -1 || raw.endColumn !== -1) {
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
  if (cells.length === 0 && raw.columnOrdinals.length !== 0) {
    return undefined;
  }
  return {
    type: 'liveSlice',
    ...liveIdentity(raw),
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
    'outputId',
    'liveId',
    'renderGeneration',
    'requestId',
    'matches',
    'totalScanned',
    'scannedCells',
    'capped',
    'partial',
    'error',
  ]) || !validLiveIdentity(raw) ||
    !Array.isArray(raw.matches) || raw.matches.length > MAX_NOTEBOOK_LIVE_SEARCH_MATCHES ||
    !raw.matches.every(nonNegativeSafeInteger) ||
    !nonNegativeSafeInteger(raw.totalScanned) || !nonNegativeSafeInteger(raw.scannedCells) ||
    typeof raw.capped !== 'boolean' || typeof raw.partial !== 'boolean' ||
    !validOptionalText(raw.error, 4_096)) {
    return undefined;
  }
  return {
    type: 'liveSearch',
    ...liveIdentity(raw),
    matches: raw.matches.slice(),
    totalScanned: raw.totalScanned,
    scannedCells: raw.scannedCells,
    capped: raw.capped,
    partial: raw.partial,
    ...(typeof raw.error === 'string' ? { error: raw.error } : {}),
  };
}

function parseLiveChartMessage(raw: Record<string, unknown>): NotebookLiveChartMessage | undefined {
  if (!hasOnlyKeys(raw, [
    'type',
    'outputId',
    'liveId',
    'renderGeneration',
    'requestId',
    'data',
    'error',
  ]) || !validLiveIdentity(raw) ||
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
    ...liveIdentity(raw),
    ...(data ? { data } : {}),
    ...(typeof raw.error === 'string' ? { error: raw.error } : {}),
  };
}

function parseLiveCopyMessage(raw: Record<string, unknown>): NotebookLiveCopyMessage | undefined {
  if (!hasOnlyKeys(raw, [
    'type',
    'outputId',
    'liveId',
    'renderGeneration',
    'requestId',
    'ok',
    'message',
  ]) || !validLiveIdentity(raw) ||
    typeof raw.ok !== 'boolean' || !validOptionalText(raw.message, 4_096) ||
    (!raw.ok && typeof raw.message !== 'string')) {
    return undefined;
  }
  return {
    type: 'liveCopy',
    ...liveIdentity(raw),
    ok: raw.ok,
    ...(typeof raw.message === 'string' ? { message: raw.message } : {}),
  };
}

function parseOutputPersistenceMessage(
  raw: Record<string, unknown>
): NotebookOutputPersistenceMessage | undefined {
  if (!hasOnlyKeys(raw, [
    'type',
    'outputId',
    'renderGeneration',
    'requestId',
    'mode',
    'enabled',
    'checked',
    'message',
  ]) || !validOutputIdentity(raw) ||
    (raw.mode !== 'preview' && raw.mode !== 'full') ||
    typeof raw.enabled !== 'boolean' || typeof raw.checked !== 'boolean' ||
    !validOptionalText(raw.message, 4_096)) {
    return undefined;
  }
  return {
    type: 'outputPersistence',
    ...outputIdentity(raw),
    mode: raw.mode,
    enabled: raw.enabled,
    checked: raw.checked,
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
  if (!isRecord(raw) || !hasOnlyKeys(raw, ['connectionName', 'elapsedMs', 'messages']) ||
    !validOptionalText(raw.connectionName, 512) ||
    (raw.elapsedMs !== undefined && (!finiteNumber(raw.elapsedMs) || raw.elapsedMs < 0)) ||
    (raw.messages !== undefined &&
      (!Array.isArray(raw.messages) || raw.messages.length > 64 ||
        !raw.messages.every(value => validBoundedText(value, 2_048))))) {
    return undefined;
  }
  return {
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
    'chartZoomMinSampledPoints',
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
    !positiveSafeInteger(raw.chartZoomMinSampledPoints) ||
    !positiveSafeInteger(raw.chartZoomMaxSampledPoints) ||
    raw.chartZoomMinSampledPoints > raw.chartZoomMaxSampledPoints ||
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
    chartZoomMinSampledPoints: raw.chartZoomMinSampledPoints,
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

function validOptionalSort(sortOrdinal: unknown, sortDirection: unknown): boolean {
  if (sortOrdinal === undefined && sortDirection === undefined) {
    return true;
  }
  return nonNegativeSafeInteger(sortOrdinal) &&
    (sortDirection === 'asc' || sortDirection === 'desc');
}

function sortFields(raw: Record<string, unknown>): {
  sortOrdinal?: number;
  sortDirection?: NotebookLiveSortDirection;
} {
  return nonNegativeSafeInteger(raw.sortOrdinal) &&
    (raw.sortDirection === 'asc' || raw.sortDirection === 'desc')
    ? { sortOrdinal: raw.sortOrdinal, sortDirection: raw.sortDirection }
    : {};
}

function validLiveId(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length >= MIN_NOTEBOOK_LIVE_ID_CHARS &&
    value.length <= MAX_NOTEBOOK_LIVE_ID_CHARS &&
    /^[A-Za-z0-9_-]+$/.test(value);
}

function validOutputIdentity(raw: Record<string, unknown>): boolean {
  return validLiveId(raw.outputId) &&
    validRequestId(raw.renderGeneration) &&
    validRequestId(raw.requestId);
}

function validLiveIdentity(raw: Record<string, unknown>): boolean {
  return validOutputIdentity(raw) && validLiveId(raw.liveId);
}

function outputIdentity(raw: Record<string, unknown>): NotebookOutputMessageIdentity {
  return {
    outputId: raw.outputId as string,
    renderGeneration: raw.renderGeneration as number,
    requestId: raw.requestId as number,
  };
}

function liveIdentity(raw: Record<string, unknown>): NotebookLiveMessageIdentity {
  return {
    ...outputIdentity(raw),
    liveId: raw.liveId as string,
  };
}

function validColumnOrdinals(
  value: unknown,
  allowEmpty = false,
  maximumCount = MAX_NOTEBOOK_LIVE_SLICE_COLUMNS
): value is number[] {
  return Array.isArray(value) &&
    (allowEmpty || value.length > 0) &&
    value.length <= maximumCount &&
    value.every(ordinal => integerInRange(ordinal, 0, MAX_NOTEBOOK_LIVE_COLUMNS - 1)) &&
    new Set(value).size === value.length;
}

function validOptionalChartRange(xMin: unknown, xMax: unknown): boolean {
  return (xMin === undefined && xMax === undefined) ||
    (finiteNumber(xMin) && finiteNumber(xMax) && xMax > xMin);
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
