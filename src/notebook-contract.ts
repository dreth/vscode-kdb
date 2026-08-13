import {
  CellTextOptions,
  allCellsRange,
  cellValueToBoundedText,
  cellValueToText,
  compareColumnarCellValues,
  createColumnarPanelResult,
} from './kx-results';
import {
  PortableQAtomNode,
  PortableQNode,
  QScalarValue,
  isQRuntimeValue,
  portableNodeToQValue,
  portableQNodeToBoundedGridCellText,
  portableQNodeToBoundedLiteral,
  qValueDescription,
  qValueToBoundedLiteral,
  qValueToGridCellText,
  qValueToPortableNode,
  validatePortableQNode,
} from './q-value';
import { isQTemporalType } from './q-type';
import { compareResultCellText } from './result-table-interaction';

export type { PortableQNode } from './q-value';

export const KX_NOTEBOOK_MIME = 'application/vnd.kx.result+json';
export const KX_NOTEBOOK_CONTRACT_VERSION = 1;
export const KX_NOTEBOOK_CONTRACT_VERSION_V2 = 2;

export const DEFAULT_NOTEBOOK_ROW_LIMIT = 20;
export const MIN_NOTEBOOK_ROW_LIMIT = 1;
export const MAX_NOTEBOOK_ROW_LIMIT = 10000;
export const DEFAULT_NOTEBOOK_BYTE_LIMIT = 1000000;
export const MIN_NOTEBOOK_BYTE_LIMIT = 16384;
export const MAX_NOTEBOOK_BYTE_LIMIT = 10000000;

export const MAX_NOTEBOOK_COLUMNS = 256;
export const MAX_NOTEBOOK_COLUMN_NAME_CHARS = 256;
export const MAX_NOTEBOOK_TYPE_NAME_CHARS = 64;
export const MAX_NOTEBOOK_CELL_STRING_CHARS = 32768;
export const MAX_NOTEBOOK_QTEXT_CHARS = 1048576;
export const MAX_NOTEBOOK_LABEL_CHARS = 200;
export const MAX_NOTEBOOK_Q_SOURCE_CHARS = 4000;
export const STATIC_NOTEBOOK_TABLE_ROW_LIMIT = 100;
export const STATIC_NOTEBOOK_CHART_POINT_LIMIT = 240;
const MAX_PORTABLE_JSON_DEPTH = 128;
const MAX_PORTABLE_JSON_NODES = 20_000;

export type NotebookResultMarker = '%%q' | 'direct-ipc';
export type NotebookPersistenceMode = 'preview' | 'full';

export interface NotebookPersistenceMetadata {
  mode: NotebookPersistenceMode;
  previewRowLimit: number;
  byteLimit: number;
}

export type PortableCellKind =
  | 'null'
  | 'boolean'
  | 'number'
  | 'string'
  | 'bigint'
  | 'temporal'
  | 'json'
  | 'q';

export interface PortableNullCell {
  kind: 'null';
}

export interface NotebookBoundedDisplayText {
  text: string;
  truncated: boolean;
}

export interface PortableBooleanCell {
  kind: 'boolean';
  value: boolean;
}

export interface PortableNumberCell {
  kind: 'number';
  value: number;
}

export interface PortableTextCell {
  kind: 'string' | 'bigint' | 'temporal' | 'json';
  value: string;
}

export interface PortableQCell {
  kind: 'q';
  version: 1;
  value: PortableQNode;
}

export type PortableCell =
  | PortableNullCell
  | PortableBooleanCell
  | PortableNumberCell
  | PortableTextCell
  | PortableQCell;

export interface PortableColumn {
  name: string;
  type: string;
}

export type NotebookChartType =
  | 'line'
  | 'scatter'
  | 'step'
  | 'bar'
  | 'box'
  | 'candlestick';

export interface NotebookChartSpec {
  version: 1;
  visible: boolean;
  type: NotebookChartType;
  xColumn: string;
  yColumns: string[];
  groupByColumn?: string;
  openColumn?: string;
  highColumn?: string;
  lowColumn?: string;
  closeColumn?: string;
  title?: string;
}

export type NotebookTruncationReason =
  | 'rowLimit'
  | 'byteLimit'
  | 'cellValueLimit'
  | 'columnLimit'
  | 'sourcePreview';

const NOTEBOOK_TRUNCATION_REASON_LABELS:
Record<NotebookTruncationReason, string> = {
  rowLimit: 'row limit',
  byteLimit: 'byte limit',
  cellValueLimit: 'long cell-value limit',
  columnLimit: 'column limit',
  sourcePreview: 'source preview limit',
};

export interface PortableKxTableResult {
  version: 1 | 2;
  outputId?: string;
  persistence?: NotebookPersistenceMetadata;
  kind: 'table';
  schema: {
    columns: PortableColumn[];
    /** Present only when decoded q keyed-table structure supplied exact key ordinals. */
    keyColumnOrdinals?: number[];
  };
  data: {
    encoding: 'rows';
    rows: PortableCell[][];
  };
  result: {
    rowCount: number;
    columnCount?: number;
    previewRowCount: number;
    truncated: boolean;
    truncationReasons: NotebookTruncationReason[];
    rowLimit: number;
    byteLimit: number;
  };
  provenance: {
    marker: NotebookResultMarker;
    label?: string;
    elapsedMs?: number;
    qSource?: string;
  };
  chart?: NotebookChartSpec;
}

export interface PortableKxTextResult {
  version: 1 | 2;
  outputId?: string;
  persistence?: NotebookPersistenceMetadata;
  kind: 'qText';
  data: {
    text: string;
  };
  result: {
    truncated: boolean;
    truncationReasons: NotebookTruncationReason[];
    byteLimit: number;
  };
  provenance: {
    marker: NotebookResultMarker;
    label?: string;
    elapsedMs?: number;
    qSource?: string;
  };
}

export type PortableKxResult = PortableKxTableResult | PortableKxTextResult;

export interface NotebookResultInput {
  columns: Array<string | PortableColumn>;
  keyColumnOrdinals?: readonly number[];
  rows: unknown[][];
  cellValue?: (rowIndex: number, columnIndex: number) => unknown;
  rowCount?: number;
  rowLimit?: number;
  byteLimit?: number;
  label?: string;
  elapsedMs?: number;
  qSource?: string;
  marker?: NotebookResultMarker;
  chart?: Partial<NotebookChartSpec>;
}

export interface NotebookTextResultInput {
  text: string;
  rowLimit?: number;
  byteLimit?: number;
  label?: string;
  elapsedMs?: number;
  qSource?: string;
  marker?: NotebookResultMarker;
}

export interface NotebookV2ResultOptions {
  outputId: string;
  persistenceMode: NotebookPersistenceMode;
}

export type NotebookV2CreationResult<T extends PortableKxResult = PortableKxResult> =
  | { ok: true; value: T; serializedBytes: number }
  | {
    ok: false;
    error: string;
    rowCount: number;
    columnCount: number;
    serializedBytes?: number;
  };

export type NotebookValidationResult =
  | { ok: true; value: PortableKxResult }
  | { ok: false; error: string };

const CELL_KINDS = new Set<PortableCellKind>([
  'null',
  'boolean',
  'number',
  'string',
  'bigint',
  'temporal',
  'json',
]);
const TRUNCATION_REASONS = new Set<NotebookTruncationReason>([
  'rowLimit',
  'byteLimit',
  'cellValueLimit',
  'columnLimit',
  'sourcePreview',
]);
const CHART_TYPES = new Set<NotebookChartType>([
  'line',
  'scatter',
  'step',
  'bar',
  'box',
  'candlestick',
]);

export function createPortableKxResult(input: NotebookResultInput): PortableKxTableResult {
  return createPortableKxTable(input, false);
}

function createPortableKxTable(
  input: NotebookResultInput,
  allowExactQ: boolean
): PortableKxTableResult {
  const rowLimit = boundedInteger(
    input.rowLimit,
    DEFAULT_NOTEBOOK_ROW_LIMIT,
    MIN_NOTEBOOK_ROW_LIMIT,
    MAX_NOTEBOOK_ROW_LIMIT
  );
  const byteLimit = boundedInteger(
    input.byteLimit,
    DEFAULT_NOTEBOOK_BYTE_LIMIT,
    MIN_NOTEBOOK_BYTE_LIMIT,
    MAX_NOTEBOOK_BYTE_LIMIT
  );
  const reasons = new Set<NotebookTruncationReason>();
  const rawColumns = input.columns.slice(0, MAX_NOTEBOOK_COLUMNS);
  if (input.columns.length > rawColumns.length) {
    reasons.add('columnLimit');
  }
  const usedColumnNames = new Set<string>();
  const columns = rawColumns.map((column, index) => normalizeColumn(column, index, usedColumnNames));
  const suppliedRowCount = nonNegativeSafeInteger(input.rowCount, input.rows.length);
  const rowCount = Math.max(suppliedRowCount, input.rows.length);
  const usesCellAccessor = typeof input.cellValue === 'function';
  const availableRowCount = Math.min(
    rowLimit,
    usesCellAccessor ? rowCount : input.rows.length
  );
  if (rowCount > rowLimit) {
    reasons.add('rowLimit');
  }
  if (!usesCellAccessor && input.rows.length < Math.min(rowCount, rowLimit)) {
    reasons.add('sourcePreview');
  }
  const payload: PortableKxTableResult = {
    version: KX_NOTEBOOK_CONTRACT_VERSION,
    kind: 'table',
    schema: { columns },
    data: { encoding: 'rows', rows: [] },
    result: {
      rowCount,
      previewRowCount: 0,
      truncated: false,
      truncationReasons: [],
      rowLimit,
      byteLimit,
    },
    provenance: {
      marker: input.marker === 'direct-ipc' ? 'direct-ipc' : '%%q',
      ...optionalBoundedString('label', input.label, MAX_NOTEBOOK_LABEL_CHARS),
      ...(finiteNonNegative(input.elapsedMs) ? { elapsedMs: input.elapsedMs } : {}),
      ...optionalBoundedString('qSource', input.qSource, MAX_NOTEBOOK_Q_SOURCE_CHARS),
    },
  };
  trimNotebookColumnsToMetadataBudget(
    payload,
    reasons,
    byteLimit,
    availableRowCount
  );

  const convertedRows: PortableCell[][] = [];
  const encoder = new TextEncoder();
  let convertedRowBytes = 0;
  for (let rowIndex = 0; rowIndex < availableRowCount; rowIndex++) {
    const row = columns.map((column, columnIndex) => portableCell(
      usesCellAccessor
        ? input.cellValue!(rowIndex, columnIndex)
        : input.rows[rowIndex]?.[columnIndex],
      reasons,
      column.type,
      allowExactQ
    ));
    convertedRows.push(row);
    convertedRowBytes += encoder.encode(JSON.stringify(row)).byteLength;
    if (convertedRowBytes + Math.max(0, convertedRows.length - 1) > byteLimit) {
      reasons.add('byteLimit');
      break;
    }
  }
  trimNotebookColumnsToMetadataBudget(
    payload,
    reasons,
    byteLimit,
    convertedRows.length
  );

  const chart = normalizeChart(input.chart, columns);
  if (chart) {
    payload.chart = chart;
    updateResultSummary(payload, reasons, convertedRows.length);
    if (portableKxResultMetadataBytes(payload) > byteLimit) {
      delete payload.chart;
      reasons.add('byteLimit');
      updateResultSummary(payload, reasons, convertedRows.length);
    }
  }

  let rows = convertedRows.map(row => row.slice(0, columns.length));
  let prefixBytes = portableRowPrefixBytes(rows);
  if (portableKxResultBytesForRowCount(payload, reasons, prefixBytes, rows.length) > byteLimit) {
    reasons.add('byteLimit');
    const previousColumnCount = columns.length;
    trimNotebookColumnsToMetadataBudget(payload, reasons, byteLimit, 0);
    if (columns.length !== previousColumnCount) {
      if (payload.chart && !validateChart(payload.chart, columns)) {
        delete payload.chart;
      }
      rows = rows.map(row => row.slice(0, columns.length));
      prefixBytes = portableRowPrefixBytes(rows);
    }

    let lower = 0;
    let upper = rows.length;
    let accepted = 0;
    while (lower <= upper) {
      const candidate = Math.floor((lower + upper) / 2);
      if (portableKxResultBytesForRowCount(payload, reasons, prefixBytes, candidate) <= byteLimit) {
        accepted = candidate;
        lower = candidate + 1;
      } else {
        upper = candidate - 1;
      }
    }
    rows = rows.slice(0, accepted);
  }

  payload.data.rows = rows;
  updateResultSummary(payload, reasons);
  return payload;
}

export function createPortableKxTextResult(input: NotebookTextResultInput): PortableKxTextResult {
  const byteLimit = boundedInteger(
    input.byteLimit,
    DEFAULT_NOTEBOOK_BYTE_LIMIT,
    MIN_NOTEBOOK_BYTE_LIMIT,
    MAX_NOTEBOOK_BYTE_LIMIT
  );
  const reasons = new Set<NotebookTruncationReason>();
  let text = String(input.text);
  if (text.length > MAX_NOTEBOOK_QTEXT_CHARS) {
    text = `${safeTextPrefix(text, MAX_NOTEBOOK_QTEXT_CHARS - 1)}\u2026`;
    reasons.add('cellValueLimit');
  }
  const payload: PortableKxTextResult = {
    version: KX_NOTEBOOK_CONTRACT_VERSION,
    kind: 'qText',
    data: { text },
    result: {
      truncated: reasons.size > 0,
      truncationReasons: [...reasons],
      byteLimit,
    },
    provenance: {
      marker: input.marker === 'direct-ipc' ? 'direct-ipc' : '%%q',
      ...optionalBoundedString('label', input.label, MAX_NOTEBOOK_LABEL_CHARS),
      ...(finiteNonNegative(input.elapsedMs) ? { elapsedMs: input.elapsedMs } : {}),
      ...optionalBoundedString('qSource', input.qSource, MAX_NOTEBOOK_Q_SOURCE_CHARS),
    },
  };
  if (portableKxResultBytes(payload) <= byteLimit) {
    return payload;
  }

  reasons.add('byteLimit');
  payload.result.truncated = true;
  payload.result.truncationReasons = [...reasons];
  let lower = 0;
  let upper = text.length;
  let accepted = 0;
  while (lower <= upper) {
    const candidate = Math.floor((lower + upper) / 2);
    payload.data.text = safeTextPrefix(text, candidate);
    if (portableKxResultBytes(payload) <= byteLimit) {
      accepted = candidate;
      lower = candidate + 1;
    } else {
      upper = candidate - 1;
    }
  }
  payload.data.text = safeTextPrefix(text, accepted);
  return payload;
}

export function createPortableKxResultV2(
  input: NotebookResultInput,
  options: NotebookV2ResultOptions
): NotebookV2CreationResult<PortableKxTableResult> {
  let rowCount = 0;
  let columnCount = 0;
  try {
    rowCount = Math.max(
      nonNegativeSafeInteger(input.rowCount, input.rows.length),
      input.rows.length
    );
    columnCount = input.columns.length;
    if (!validNotebookOutputId(options.outputId)) {
      return v2Failure('KX notebook output identifier is invalid.', rowCount, columnCount);
    }
    if (input.marker !== 'direct-ipc') {
      return v2Failure(
        'Portable v2 output is reserved for first-party Direct IPC results.',
        rowCount,
        columnCount
      );
    }
    if (options.persistenceMode !== 'preview' && options.persistenceMode !== 'full') {
      return v2Failure('KX notebook persistence mode is invalid.', rowCount, columnCount);
    }
    return options.persistenceMode === 'full'
      ? createPortableKxFullTable(input, options.outputId, rowCount, columnCount)
      : createPortableKxPreviewTableV2(input, options.outputId, rowCount, columnCount);
  } catch {
    return v2Failure(
      options.persistenceMode === 'full'
        ? 'Full notebook persistence could not convert every source value exactly.'
        : 'Notebook preview creation could not inspect the source result.',
      rowCount,
      columnCount
    );
  }
}

function createPortableKxFullTable(
  input: NotebookResultInput,
  outputId: string,
  rowCount: number,
  columnCount: number
): NotebookV2CreationResult<PortableKxTableResult> {
  const rowLimit = boundedInteger(
    input.rowLimit,
    DEFAULT_NOTEBOOK_ROW_LIMIT,
    MIN_NOTEBOOK_ROW_LIMIT,
    MAX_NOTEBOOK_ROW_LIMIT
  );
  const byteLimit = boundedInteger(
    input.byteLimit,
    DEFAULT_NOTEBOOK_BYTE_LIMIT,
    MIN_NOTEBOOK_BYTE_LIMIT,
    MAX_NOTEBOOK_BYTE_LIMIT
  );
  const columns = strictPortableColumns(input.columns);
  if (!columns) {
    return v2Failure(
      'Full notebook persistence requires exactly representable column names and types.',
      rowCount,
      columnCount
    );
  }
  const keyColumnOrdinals = strictOptionalKeyColumnOrdinals(
    input.keyColumnOrdinals,
    columns.length
  );
  if (keyColumnOrdinals === null) {
    return v2Failure(
      'Full notebook persistence requires valid unique key-column source ordinals.',
      rowCount,
      columnCount
    );
  }
  const usesCellAccessor = typeof input.cellValue === 'function';
  if (!usesCellAccessor && input.rows.length < rowCount) {
    return v2Failure(
      'Full notebook persistence requires every source row to be available.',
      rowCount,
      columnCount
    );
  }
  if (!usesCellAccessor && input.rows.slice(0, rowCount).some(row =>
    !Array.isArray(row) || row.length !== columnCount
  )) {
    return v2Failure(
      'Full notebook persistence requires every source row to match the declared schema exactly.',
      rowCount,
      columnCount
    );
  }

  const rows: PortableCell[][] = [];
  const chart = normalizeChart(input.chart, columns);
  const payload: PortableKxTableResult = {
    version: KX_NOTEBOOK_CONTRACT_VERSION_V2,
    outputId,
    persistence: { mode: 'full', previewRowLimit: rowLimit, byteLimit },
    kind: 'table',
    schema: {
      columns,
      ...(keyColumnOrdinals === undefined ? {} : { keyColumnOrdinals }),
    },
    data: { encoding: 'rows', rows },
    result: {
      rowCount,
      columnCount,
      previewRowCount: rowCount,
      truncated: false,
      truncationReasons: [],
      rowLimit,
      byteLimit,
    },
    provenance: strictFirstPartyProvenance(input),
    ...(chart ? { chart } : {}),
  };
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const row: PortableCell[] = [];
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
      const raw = usesCellAccessor
        ? input.cellValue!(rowIndex, columnIndex)
        : input.rows[rowIndex][columnIndex];
      const cell = strictPortableCell(raw, columns[columnIndex]?.type);
      if (!cell) {
        const detail = portableEncodingFailureDetail(raw, columns[columnIndex]?.type);
        return v2Failure(
          `Full notebook persistence cannot exactly encode row ${rowIndex + 1}, ` +
            `column ${columnIndex + 1} (${detail}).`,
          rowCount,
          columnCount
        );
      }
      row.push(cell);
    }
    rows.push(row);
  }
  try {
    return { ok: true, value: payload, serializedBytes: portableKxResultBytes(payload) };
  } catch {
    return v2Failure(
      'Full notebook persistence could not serialize the complete result exactly.',
      rowCount,
      columnCount
    );
  }
}

function createPortableKxPreviewTableV2(
  input: NotebookResultInput,
  outputId: string,
  rowCount: number,
  columnCount: number
): NotebookV2CreationResult<PortableKxTableResult> {
  const rowLimit = boundedInteger(
    input.rowLimit,
    DEFAULT_NOTEBOOK_ROW_LIMIT,
    MIN_NOTEBOOK_ROW_LIMIT,
    MAX_NOTEBOOK_ROW_LIMIT
  );
  const byteLimit = boundedInteger(
    input.byteLimit,
    DEFAULT_NOTEBOOK_BYTE_LIMIT,
    MIN_NOTEBOOK_BYTE_LIMIT,
    MAX_NOTEBOOK_BYTE_LIMIT
  );
  const legacy = createPortableKxTable({ ...input, rowLimit, byteLimit }, true);
  const keyColumnOrdinals = strictOptionalKeyColumnOrdinals(
    input.keyColumnOrdinals,
    input.columns.length
  );
  if (keyColumnOrdinals === null) {
    return v2Failure(
      'Notebook preview requires valid unique key-column source ordinals.',
      rowCount,
      columnCount
    );
  }
  const payload: PortableKxTableResult = {
    ...legacy,
    version: KX_NOTEBOOK_CONTRACT_VERSION_V2,
    outputId,
    persistence: { mode: 'preview', previewRowLimit: rowLimit, byteLimit },
    schema: {
      ...legacy.schema,
      ...(keyColumnOrdinals === undefined
        ? {}
        : {
          keyColumnOrdinals: keyColumnOrdinals.filter(
            ordinal => ordinal < legacy.schema.columns.length
          ),
        }),
    },
    result: { ...legacy.result, rowCount, columnCount },
  };
  fitV2PreviewTableToBudget(payload);
  const serializedBytes = portableKxResultBytes(payload);
  return serializedBytes <= byteLimit
    ? { ok: true, value: payload, serializedBytes }
    : {
      ...v2Failure(
        'The configured notebook byte limit is too small for the result metadata.',
        rowCount,
        columnCount
      ),
      serializedBytes,
    };
}

export function createPortableKxTextResultV2(
  input: NotebookTextResultInput,
  options: NotebookV2ResultOptions
): NotebookV2CreationResult<PortableKxTextResult> {
  const byteLimit = boundedInteger(
    input.byteLimit,
    DEFAULT_NOTEBOOK_BYTE_LIMIT,
    MIN_NOTEBOOK_BYTE_LIMIT,
    MAX_NOTEBOOK_BYTE_LIMIT
  );
  const rowLimit = boundedInteger(
    input.rowLimit,
    DEFAULT_NOTEBOOK_ROW_LIMIT,
    MIN_NOTEBOOK_ROW_LIMIT,
    MAX_NOTEBOOK_ROW_LIMIT
  );
  if (!validNotebookOutputId(options.outputId)) {
    return v2Failure('KX notebook output identifier is invalid.', 0, 0);
  }
  if (input.marker !== 'direct-ipc') {
    return v2Failure('Portable v2 output is reserved for first-party Direct IPC results.', 0, 0);
  }
  if (options.persistenceMode === 'full') {
    if (typeof input.text !== 'string') {
      return v2Failure('Full notebook qText persistence requires exact text.', 0, 0);
    }
    const payload: PortableKxTextResult = {
      version: KX_NOTEBOOK_CONTRACT_VERSION_V2,
      outputId: options.outputId,
      persistence: { mode: 'full', previewRowLimit: rowLimit, byteLimit },
      kind: 'qText',
      data: { text: input.text },
      result: { truncated: false, truncationReasons: [], byteLimit },
      provenance: strictFirstPartyProvenance(input),
    };
    try {
      return { ok: true, value: payload, serializedBytes: portableKxResultBytes(payload) };
    } catch {
      return v2Failure('Full notebook qText could not be serialized exactly.', 0, 0);
    }
  }
  if (options.persistenceMode !== 'preview') {
    return v2Failure('KX notebook persistence mode is invalid.', 0, 0);
  }
  const legacy = createPortableKxTextResult({ ...input, byteLimit });
  const payload: PortableKxTextResult = {
    ...legacy,
    version: KX_NOTEBOOK_CONTRACT_VERSION_V2,
    outputId: options.outputId,
    persistence: { mode: 'preview', previewRowLimit: rowLimit, byteLimit },
  };
  fitV2PreviewTextToBudget(payload);
  const serializedBytes = portableKxResultBytes(payload);
  return serializedBytes <= byteLimit
    ? { ok: true, value: payload, serializedBytes }
    : {
      ...v2Failure('The configured notebook byte limit is too small for qText metadata.', 0, 0),
      serializedBytes,
    };
}

export function validatePortableKxResult(raw: unknown): NotebookValidationResult {
  try {
    if (!isRecord(raw)) {
      return invalid('KX notebook output must be a JSON object.');
    }
    if (raw.version === KX_NOTEBOOK_CONTRACT_VERSION_V2) {
      return validatePortableKxResultV2(raw);
    }
    if (raw.version !== KX_NOTEBOOK_CONTRACT_VERSION) {
      return invalid('Unsupported KX notebook output contract version or result kind.');
    }
    if (raw.kind === 'qText') {
      return validatePortableKxTextResult(raw);
    }
    if (raw.kind !== 'table') {
      return invalid('Unsupported KX notebook output contract version or result kind.');
    }
    if (!hasOnlyKeys(raw, ['version', 'kind', 'schema', 'data', 'result', 'provenance', 'chart'])) {
      return invalid('KX notebook output contains unsupported top-level fields.');
    }
    if (!isRecord(raw.schema) || !hasOnlyKeys(raw.schema, ['columns']) || !Array.isArray(raw.schema.columns)) {
      return invalid('KX notebook output schema is invalid.');
    }
    if (raw.schema.columns.length > MAX_NOTEBOOK_COLUMNS) {
      return invalid('KX notebook output has too many columns.');
    }
    const columns: PortableColumn[] = [];
    for (const column of raw.schema.columns) {
      if (!isRecord(column) || !hasOnlyKeys(column, ['name', 'type']) ||
        !boundedString(column.name, 1, MAX_NOTEBOOK_COLUMN_NAME_CHARS) ||
        !boundedString(column.type, 1, MAX_NOTEBOOK_TYPE_NAME_CHARS)) {
        return invalid('KX notebook output contains an invalid column definition.');
      }
      columns.push({ name: column.name, type: column.type });
    }
    if (new Set(columns.map(column => column.name)).size !== columns.length) {
      return invalid('KX notebook output column names must be unique.');
    }
    if (!isRecord(raw.data) || !hasOnlyKeys(raw.data, ['encoding', 'rows']) ||
      raw.data.encoding !== 'rows' || !Array.isArray(raw.data.rows)) {
      return invalid('KX notebook output row data is invalid.');
    }
    if (!isRecord(raw.result) || !hasOnlyKeys(raw.result, [
      'rowCount',
      'previewRowCount',
      'truncated',
      'truncationReasons',
      'rowLimit',
      'byteLimit',
    ])) {
      return invalid('KX notebook output result metadata is invalid.');
    }
    const result = raw.result;
    if (!safeIntegerInRange(result.rowCount, 0, Number.MAX_SAFE_INTEGER) ||
      !safeIntegerInRange(result.previewRowCount, 0, MAX_NOTEBOOK_ROW_LIMIT) ||
      !safeIntegerInRange(result.rowLimit, MIN_NOTEBOOK_ROW_LIMIT, MAX_NOTEBOOK_ROW_LIMIT) ||
      !safeIntegerInRange(result.byteLimit, MIN_NOTEBOOK_BYTE_LIMIT, MAX_NOTEBOOK_BYTE_LIMIT) ||
      typeof result.truncated !== 'boolean' || !Array.isArray(result.truncationReasons)) {
      return invalid('KX notebook output bounds metadata is invalid.');
    }
    if (result.previewRowCount !== raw.data.rows.length || result.previewRowCount > result.rowCount ||
      result.previewRowCount > result.rowLimit) {
      return invalid('KX notebook output preview counts are inconsistent.');
    }
    const truncationReasons: NotebookTruncationReason[] = [];
    for (const reason of result.truncationReasons) {
      if (typeof reason !== 'string' || !TRUNCATION_REASONS.has(reason as NotebookTruncationReason)) {
        return invalid('KX notebook output contains an invalid truncation reason.');
      }
      truncationReasons.push(reason as NotebookTruncationReason);
    }
    if (new Set(truncationReasons).size !== truncationReasons.length ||
      result.truncated !== (truncationReasons.length > 0 || result.previewRowCount < result.rowCount)) {
      return invalid('KX notebook output truncation metadata is inconsistent.');
    }
    const rows: PortableCell[][] = [];
    for (const rawRow of raw.data.rows) {
      if (!Array.isArray(rawRow) || rawRow.length !== columns.length) {
        return invalid('KX notebook output contains a row with the wrong column count.');
      }
      const row: PortableCell[] = [];
      for (const rawCell of rawRow) {
        const cell = validateCell(rawCell);
        if (!cell) {
          return invalid('KX notebook output contains an invalid typed cell.');
        }
        row.push(cell);
      }
      rows.push(row);
    }
    if (!isRecord(raw.provenance) || !hasOnlyKeys(raw.provenance, ['marker', 'label', 'elapsedMs', 'qSource']) ||
      (raw.provenance.marker !== '%%q' && raw.provenance.marker !== 'direct-ipc')) {
      return invalid('KX notebook output provenance is invalid.');
    }
    if (raw.provenance.label !== undefined &&
      !boundedString(raw.provenance.label, 1, MAX_NOTEBOOK_LABEL_CHARS)) {
      return invalid('KX notebook output provenance label is invalid.');
    }
    if (raw.provenance.qSource !== undefined &&
      !boundedString(raw.provenance.qSource, 0, MAX_NOTEBOOK_Q_SOURCE_CHARS)) {
      return invalid('KX notebook output q source display text is invalid.');
    }
    if (raw.provenance.elapsedMs !== undefined && !finiteNonNegative(raw.provenance.elapsedMs)) {
      return invalid('KX notebook output elapsed time is invalid.');
    }
    const chart = raw.chart === undefined ? undefined : validateChart(raw.chart, columns);
    if (raw.chart !== undefined && !chart) {
      return invalid('KX notebook output chart specification is invalid.');
    }

    const value: PortableKxTableResult = {
      version: 1,
      kind: 'table',
      schema: { columns },
      data: { encoding: 'rows', rows },
      result: {
        rowCount: result.rowCount,
        previewRowCount: result.previewRowCount,
        truncated: result.truncated,
        truncationReasons,
        rowLimit: result.rowLimit,
        byteLimit: result.byteLimit,
      },
      provenance: {
        marker: raw.provenance.marker,
        ...(raw.provenance.label === undefined ? {} : { label: raw.provenance.label }),
        ...(raw.provenance.elapsedMs === undefined ? {} : { elapsedMs: raw.provenance.elapsedMs }),
        ...(raw.provenance.qSource === undefined ? {} : { qSource: raw.provenance.qSource }),
      },
      ...(chart ? { chart } : {}),
    };
    if (portableKxResultBytes(value) > value.result.byteLimit) {
      return invalid('KX notebook output exceeds its declared byte limit.');
    }
    return { ok: true, value };
  } catch {
    return invalid('KX notebook output could not be validated.');
  }
}

function validatePortableKxResultV2(raw: Record<string, unknown>): NotebookValidationResult {
  if (!validNotebookOutputId(raw.outputId) || !isRecord(raw.persistence) ||
    !hasOnlyKeys(raw.persistence, ['mode', 'previewRowLimit', 'byteLimit']) ||
    (raw.persistence.mode !== 'preview' && raw.persistence.mode !== 'full') ||
    !safeIntegerInRange(
      raw.persistence.previewRowLimit,
      MIN_NOTEBOOK_ROW_LIMIT,
      MAX_NOTEBOOK_ROW_LIMIT
    ) ||
    !safeIntegerInRange(
      raw.persistence.byteLimit,
      MIN_NOTEBOOK_BYTE_LIMIT,
      MAX_NOTEBOOK_BYTE_LIMIT
    )) {
    return invalid('KX notebook v2 persistence metadata is invalid.');
  }
  if (raw.kind === 'qText') {
    return validatePortableKxTextResultV2(raw);
  }
  if (raw.kind !== 'table' || !hasOnlyKeys(raw, [
    'version',
    'outputId',
    'persistence',
    'kind',
    'schema',
    'data',
    'result',
    'provenance',
    'chart',
  ])) {
    return invalid('Unsupported KX notebook v2 result kind or fields.');
  }
  const mode = raw.persistence.mode as NotebookPersistenceMode;
  const byteLimit = raw.persistence.byteLimit as number;
  const previewRowLimit = raw.persistence.previewRowLimit as number;
  if (!isRecord(raw.schema) || !hasOnlyKeys(raw.schema, ['columns', 'keyColumnOrdinals']) ||
    !Array.isArray(raw.schema.columns) ||
    (mode === 'preview' && raw.schema.columns.length > MAX_NOTEBOOK_COLUMNS)) {
    return invalid('KX notebook v2 schema is invalid.');
  }
  const columns: PortableColumn[] = [];
  for (const column of raw.schema.columns) {
    if (!isRecord(column) || !hasOnlyKeys(column, ['name', 'type']) ||
      (mode === 'full'
        ? typeof column.name !== 'string' || typeof column.type !== 'string'
        : !boundedString(column.name, 1, MAX_NOTEBOOK_COLUMN_NAME_CHARS) ||
          !boundedString(column.type, 1, MAX_NOTEBOOK_TYPE_NAME_CHARS))) {
      return invalid('KX notebook v2 contains an invalid column definition.');
    }
    columns.push({ name: column.name as string, type: column.type as string });
  }
  if (mode === 'preview' && new Set(columns.map(column => column.name)).size !== columns.length) {
    return invalid('KX notebook v2 preview column names must be unique.');
  }
  const keyColumnOrdinals = strictOptionalKeyColumnOrdinals(
    raw.schema.keyColumnOrdinals,
    columns.length
  );
  if (keyColumnOrdinals === null) {
    return invalid('KX notebook v2 key-column ordinals are invalid.');
  }
  if (!isRecord(raw.data) || !hasOnlyKeys(raw.data, ['encoding', 'rows']) ||
    raw.data.encoding !== 'rows' || !Array.isArray(raw.data.rows) ||
    !isRecord(raw.result) || !hasOnlyKeys(raw.result, [
      'rowCount',
      'columnCount',
      'previewRowCount',
      'truncated',
      'truncationReasons',
      'rowLimit',
      'byteLimit',
    ])) {
    return invalid('KX notebook v2 table data or result metadata is invalid.');
  }
  const result = raw.result;
  if (!safeIntegerInRange(result.rowCount, 0, Number.MAX_SAFE_INTEGER) ||
    !safeIntegerInRange(result.columnCount, 0, Number.MAX_SAFE_INTEGER) ||
    !safeIntegerInRange(
      result.previewRowCount,
      0,
      mode === 'full' ? Number.MAX_SAFE_INTEGER : MAX_NOTEBOOK_ROW_LIMIT
    ) ||
    !safeIntegerInRange(result.rowLimit, MIN_NOTEBOOK_ROW_LIMIT, MAX_NOTEBOOK_ROW_LIMIT) ||
    result.rowLimit !== previewRowLimit || result.byteLimit !== byteLimit ||
    typeof result.truncated !== 'boolean' || !Array.isArray(result.truncationReasons) ||
    result.columnCount < columns.length || result.previewRowCount !== raw.data.rows.length ||
    result.previewRowCount > result.rowCount) {
    return invalid('KX notebook v2 bounds metadata is inconsistent.');
  }
  const truncationReasons: NotebookTruncationReason[] = [];
  for (const reason of result.truncationReasons) {
    if (typeof reason !== 'string' || !TRUNCATION_REASONS.has(reason as NotebookTruncationReason)) {
      return invalid('KX notebook v2 contains an invalid truncation reason.');
    }
    truncationReasons.push(reason as NotebookTruncationReason);
  }
  if (new Set(truncationReasons).size !== truncationReasons.length) {
    return invalid('KX notebook v2 truncation reasons must be unique.');
  }
  if (mode === 'full') {
    if (result.truncated || truncationReasons.length !== 0 ||
      result.previewRowCount !== result.rowCount || result.columnCount !== columns.length) {
      return invalid('KX notebook v2 full output must contain every row and column.');
    }
  } else if (result.previewRowCount > result.rowLimit ||
    result.truncated !== (
      truncationReasons.length > 0 ||
      result.previewRowCount < result.rowCount ||
      columns.length < result.columnCount
    )) {
    return invalid('KX notebook v2 preview truncation metadata is inconsistent.');
  }

  const rows = raw.data.rows as unknown as PortableCell[][];
  for (const rawRow of raw.data.rows) {
    if (!Array.isArray(rawRow) || rawRow.length !== columns.length) {
      return invalid('KX notebook v2 contains a row with the wrong column count.');
    }
    for (const rawCell of rawRow) {
      const oversizedPreviewQCell = mode === 'preview' && isRecord(rawCell) &&
        rawCell.kind === 'q' && portableQNodeToBoundedLiteral(rawCell.value, {
          maxChars: MAX_NOTEBOOK_CELL_STRING_CHARS,
          maxDepth: 512,
        }).truncated;
      if (oversizedPreviewQCell || !validateCell(
        rawCell,
        mode === 'full',
        true,
        mode === 'full'
      )) {
        return invalid('KX notebook v2 contains an invalid typed cell.');
      }
    }
  }
  const provenance = validatedProvenance(raw.provenance, mode === 'full');
  if (!provenance || provenance.marker !== 'direct-ipc') {
    return invalid('KX notebook v2 provenance is invalid.');
  }
  const chart = raw.chart === undefined ? undefined : validateChart(raw.chart, columns);
  if (raw.chart !== undefined && !chart) {
    return invalid('KX notebook v2 chart specification is invalid.');
  }
  const value: PortableKxTableResult = {
    version: KX_NOTEBOOK_CONTRACT_VERSION_V2,
    outputId: raw.outputId,
    persistence: { mode, previewRowLimit, byteLimit },
    kind: 'table',
    schema: {
      columns,
      ...(keyColumnOrdinals === undefined ? {} : { keyColumnOrdinals }),
    },
    data: { encoding: 'rows', rows },
    result: {
      rowCount: result.rowCount,
      columnCount: result.columnCount,
      previewRowCount: result.previewRowCount,
      truncated: result.truncated,
      truncationReasons,
      rowLimit: result.rowLimit,
      byteLimit,
    },
    provenance,
    ...(chart ? { chart } : {}),
  };
  return mode === 'full' || portableKxResultBytes(value) <= byteLimit
    ? { ok: true, value }
    : invalid('KX notebook v2 preview exceeds its declared byte limit.');
}

function validatePortableKxTextResultV2(
  raw: Record<string, unknown>
): NotebookValidationResult {
  if (!hasOnlyKeys(raw, [
    'version',
    'outputId',
    'persistence',
    'kind',
    'data',
    'result',
    'provenance',
  ]) || !isRecord(raw.persistence) || !isRecord(raw.data) ||
    !hasOnlyKeys(raw.data, ['text']) ||
    (raw.persistence.mode === 'full'
      ? typeof raw.data.text !== 'string'
      : !boundedString(raw.data.text, 0, MAX_NOTEBOOK_QTEXT_CHARS)) ||
    !isRecord(raw.result) || !hasOnlyKeys(raw.result, [
      'truncated',
      'truncationReasons',
      'byteLimit',
    ]) || typeof raw.result.truncated !== 'boolean' ||
    !Array.isArray(raw.result.truncationReasons) ||
    raw.result.byteLimit !== raw.persistence.byteLimit) {
    return invalid('KX notebook v2 qText output is invalid.');
  }
  const reasons: NotebookTruncationReason[] = [];
  for (const reason of raw.result.truncationReasons) {
    if (typeof reason !== 'string' || !TRUNCATION_REASONS.has(reason as NotebookTruncationReason)) {
      return invalid('KX notebook v2 qText output has an invalid truncation reason.');
    }
    reasons.push(reason as NotebookTruncationReason);
  }
  if (new Set(reasons).size !== reasons.length ||
    raw.result.truncated !== (reasons.length > 0) ||
    (raw.persistence.mode === 'full' && raw.result.truncated)) {
    return invalid('KX notebook v2 qText truncation metadata is inconsistent.');
  }
  const provenance = validatedProvenance(raw.provenance, raw.persistence.mode === 'full');
  if (!provenance || provenance.marker !== 'direct-ipc') {
    return invalid('KX notebook v2 qText provenance is invalid.');
  }
  const value: PortableKxTextResult = {
    version: KX_NOTEBOOK_CONTRACT_VERSION_V2,
    outputId: raw.outputId as string,
    persistence: {
      mode: raw.persistence.mode as NotebookPersistenceMode,
      previewRowLimit: raw.persistence.previewRowLimit as number,
      byteLimit: raw.persistence.byteLimit as number,
    },
    kind: 'qText',
    data: { text: raw.data.text as string },
    result: {
      truncated: raw.result.truncated,
      truncationReasons: reasons,
      byteLimit: raw.result.byteLimit as number,
    },
    provenance,
  };
  return value.persistence?.mode === 'full' || portableKxResultBytes(value) <= value.result.byteLimit
    ? { ok: true, value }
    : invalid('KX notebook v2 qText preview exceeds its declared byte limit.');
}

function validatePortableKxTextResult(raw: Record<string, unknown>): NotebookValidationResult {
  if (!hasOnlyKeys(raw, ['version', 'kind', 'data', 'result', 'provenance']) ||
    !isRecord(raw.data) || !hasOnlyKeys(raw.data, ['text']) ||
    !boundedString(raw.data.text, 0, MAX_NOTEBOOK_QTEXT_CHARS) ||
    !isRecord(raw.result) || !hasOnlyKeys(raw.result, [
      'truncated',
      'truncationReasons',
      'byteLimit',
    ]) ||
    typeof raw.result.truncated !== 'boolean' ||
    !Array.isArray(raw.result.truncationReasons) ||
    !safeIntegerInRange(raw.result.byteLimit, MIN_NOTEBOOK_BYTE_LIMIT, MAX_NOTEBOOK_BYTE_LIMIT)) {
    return invalid('KX notebook qText output is invalid.');
  }
  const truncationReasons: NotebookTruncationReason[] = [];
  for (const reason of raw.result.truncationReasons) {
    if (typeof reason !== 'string' || !TRUNCATION_REASONS.has(reason as NotebookTruncationReason)) {
      return invalid('KX notebook qText output contains an invalid truncation reason.');
    }
    truncationReasons.push(reason as NotebookTruncationReason);
  }
  if (new Set(truncationReasons).size !== truncationReasons.length ||
    raw.result.truncated !== (truncationReasons.length > 0)) {
    return invalid('KX notebook qText truncation metadata is inconsistent.');
  }
  if (!isRecord(raw.provenance) ||
    !hasOnlyKeys(raw.provenance, ['marker', 'label', 'elapsedMs', 'qSource']) ||
    (raw.provenance.marker !== '%%q' && raw.provenance.marker !== 'direct-ipc') ||
    (raw.provenance.label !== undefined &&
      !boundedString(raw.provenance.label, 1, MAX_NOTEBOOK_LABEL_CHARS)) ||
    (raw.provenance.qSource !== undefined &&
      !boundedString(raw.provenance.qSource, 0, MAX_NOTEBOOK_Q_SOURCE_CHARS)) ||
    (raw.provenance.elapsedMs !== undefined && !finiteNonNegative(raw.provenance.elapsedMs))) {
    return invalid('KX notebook qText provenance is invalid.');
  }
  const value: PortableKxTextResult = {
    version: 1,
    kind: 'qText',
    data: { text: raw.data.text },
    result: {
      truncated: raw.result.truncated,
      truncationReasons,
      byteLimit: raw.result.byteLimit,
    },
    provenance: {
      marker: raw.provenance.marker,
      ...(raw.provenance.label === undefined ? {} : { label: raw.provenance.label }),
      ...(raw.provenance.elapsedMs === undefined ? {} : { elapsedMs: raw.provenance.elapsedMs }),
      ...(raw.provenance.qSource === undefined ? {} : { qSource: raw.provenance.qSource }),
    },
  };
  if (portableKxResultBytes(value) > value.result.byteLimit) {
    return invalid('KX notebook qText output exceeds its declared byte limit.');
  }
  return { ok: true, value };
}

export function portableKxResultBytes(value: PortableKxResult): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function portableCellValue(cell: PortableCell): unknown {
  if (cell.kind === 'null') {
    return null;
  }
  if (cell.kind === 'q') {
    return portableNodeToQValue(cell.value) ?? cell.value;
  }
  if (cell.kind === 'json') {
    try {
      const parsed = JSON.parse(cell.value);
      return portableJsonShapeIsSafe(parsed) ? parsed : cell.value;
    } catch {
      return cell.value;
    }
  }
  return cell.value;
}

/** Saved charts accept scalar cells only; exact q vectors stay table values. */
export function portableCellChartValue(cell: PortableCell): unknown {
  return cell.kind === 'q' && cell.value.form === 'vector'
    ? undefined
    : portableCellValue(cell);
}

/** Exact q vectors are scalar table cells, not chartable scalar samples. */
export function portableCellChartColumnType(
  cell: PortableCell | undefined,
  declaredType: string
): string {
  return cell?.kind === 'q' && cell.value.form === 'vector'
    ? 'mixed'
    : declaredType;
}

export function portableCellText(
  cell: PortableCell,
  options: CellTextOptions = {}
): string {
  if (cell.kind === 'null') {
    return '';
  }
  if (cell.kind === 'boolean') {
    return cell.value ? 'true' : 'false';
  }
  if (cell.kind === 'q') {
    const value = portableNodeToQValue(cell.value);
    return value === undefined ? '' : qValueToGridCellText(value);
  }
  if (cell.kind === 'json') {
    return cellValueToText(portableCellValue(cell), options);
  }
  return String(cell.value);
}

export interface PortableCellBoundedText {
  text: string;
  truncated: boolean;
}

/** Display a saved cell without reconstructing or formatting an unneeded q-node tail. */
export function portableCellToBoundedText(
  cell: PortableCell,
  maxChars: number,
  options: CellTextOptions = {}
): PortableCellBoundedText {
  const limit = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 0;
  if (cell.kind === 'q') {
    const rendered = portableQNodeToBoundedGridCellText(cell.value, {
      maxChars: limit,
      maxDepth: 512,
    });
    return { text: rendered.text, truncated: rendered.truncated };
  }
  const rendered = cellValueToBoundedText(portableCellValue(cell), limit, options);
  if (!rendered.truncated || limit === 0) {
    return rendered;
  }
  return {
    text: limit === 1 ? '…' : `${rendered.text.slice(0, limit - 1)}…`,
    truncated: true,
  };
}

/** Deterministic saved-table ordering with nulls last, kind-aware mixed values,
 * and exact bigint/number comparisons without lossy Number coercion. */
export function comparePortableCells(
  left: PortableCell,
  right: PortableCell,
  direction: 'asc' | 'desc' = 'asc'
): number {
  const semanticCompared = compareColumnarCellValues(
    portableSemanticSortValue(left),
    portableSemanticSortValue(right),
    direction
  );
  if (semanticCompared !== undefined) {
    return semanticCompared;
  }
  if (left.kind === 'null' || right.kind === 'null') {
    if (left.kind === 'null' && right.kind === 'null') {
      return 0;
    }
    return left.kind === 'null' ? 1 : -1;
  }
  const compared = compareNonNullPortableCells(left, right);
  return direction === 'desc' ? -compared : compared;
}

const NON_SEMANTIC_PORTABLE_SORT_VALUE = Object.freeze({});

function portableSemanticSortValue(cell: PortableCell): unknown {
  switch (cell.kind) {
    case 'null':
      return null;
    case 'boolean':
    case 'number':
      return cell.value;
    case 'bigint':
      try {
        return BigInt(cell.value);
      } catch {
        return NON_SEMANTIC_PORTABLE_SORT_VALUE;
      }
    case 'q':
      return cell.value.form === 'vector'
        ? NON_SEMANTIC_PORTABLE_SORT_VALUE
        : portableNodeToQValue(cell.value) ?? NON_SEMANTIC_PORTABLE_SORT_VALUE;
    default:
      return NON_SEMANTIC_PORTABLE_SORT_VALUE;
  }
}

function compareNonNullPortableCells(
  left: Exclude<PortableCell, PortableNullCell>,
  right: Exclude<PortableCell, PortableNullCell>
): number {
  if ((left.kind === 'number' || left.kind === 'bigint') &&
    (right.kind === 'number' || right.kind === 'bigint')) {
    try {
      const leftNumeric = left.kind === 'bigint' ? BigInt(left.value) : left.value;
      const rightNumeric = right.kind === 'bigint' ? BigInt(right.value) : right.value;
      return leftNumeric < rightNumeric ? -1 : leftNumeric > rightNumeric ? 1 : 0;
    } catch {
      // Unvalidated cells fall through to stable kind/text ordering.
    }
  }
  if (left.kind === 'boolean' && right.kind === 'boolean') {
    return Number(left.value) - Number(right.value);
  }
  if (left.kind === 'q' && right.kind === 'q') {
    return comparePortableQNodes(left.value, right.value);
  }
  const kindDifference = portableSortKindRank(left.kind) - portableSortKindRank(right.kind);
  return kindDifference || compareResultCellText(
    portableCellText(left),
    portableCellText(right),
    'asc'
  );
}

function comparePortableQNodes(left: PortableQNode, right: PortableQNode): number {
  const formRank = (node: PortableQNode): number =>
    node.form === 'generalNull' ? 0 : node.form === 'atom' ? 1 : 2;
  const formDifference = formRank(left) - formRank(right);
  if (formDifference !== 0 || left.form === 'generalNull' || right.form === 'generalNull') {
    return formDifference;
  }
  const typeDifference = left.type.localeCompare(right.type);
  if (typeDifference !== 0) {
    return typeDifference;
  }
  if (left.form === 'atom' && right.form === 'atom') {
    return comparePortableQScalars(left.type, left.value, right.value);
  }
  if (left.form !== 'vector' || right.form !== 'vector') {
    return formRank(left) - formRank(right);
  }
  const attributeDifference = left.attribute - right.attribute;
  if (attributeDifference !== 0) {
    return attributeDifference;
  }
  const sharedLength = Math.min(left.values.length, right.values.length);
  for (let index = 0; index < sharedLength; index++) {
    const compared = left.type === 'mixed' && right.type === 'mixed'
      ? comparePortableQNodes(
        left.values[index] as PortableQNode,
        right.values[index] as PortableQNode
      )
      : comparePortableQScalars(
        left.type as PortableQAtomNode['type'],
        left.values[index] as QScalarValue,
        right.values[index] as QScalarValue
      );
    if (compared !== 0) {
      return compared;
    }
  }
  return left.values.length - right.values.length;
}

function comparePortableQScalars(
  type: PortableQAtomNode['type'],
  left: QScalarValue,
  right: QScalarValue
): number {
  const leftValue = portableQNegativeZeroValue(left);
  const rightValue = portableQNegativeZeroValue(right);
  const leftSpecial = portableQSpecialSortRank(leftValue);
  const rightSpecial = portableQSpecialSortRank(rightValue);
  if (leftSpecial !== undefined || rightSpecial !== undefined) {
    if (leftSpecial !== undefined && rightSpecial !== undefined) {
      return leftSpecial - rightSpecial;
    }
    return leftSpecial !== undefined
      ? (leftSpecial < 0 ? -1 : 1)
      : (rightSpecial! < 0 ? 1 : -1);
  }
  if (type === 'long' || type === 'timestamp' || type === 'timespan') {
    const leftInteger = BigInt(String(leftValue));
    const rightInteger = BigInt(String(rightValue));
    return leftInteger < rightInteger ? -1 : leftInteger > rightInteger ? 1 : 0;
  }
  if (typeof leftValue === 'number' && typeof rightValue === 'number') {
    return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
  }
  if (typeof leftValue === 'boolean' && typeof rightValue === 'boolean') {
    return Number(leftValue) - Number(rightValue);
  }
  return String(leftValue).localeCompare(String(rightValue));
}

function portableQNegativeZeroValue(value: QScalarValue): QScalarValue {
  return typeof value === 'object' && value.special === 'negativeZero' ? -0 : value;
}

function portableQSpecialSortRank(value: QScalarValue): number | undefined {
  if (typeof value !== 'object') {
    return undefined;
  }
  switch (value.special) {
    case 'negativeInfinity': return -2;
    case 'negativeZero': return -1;
    case 'positiveInfinity': return 1;
    case 'null': return 2;
  }
}

function portableSortKindRank(kind: Exclude<PortableCellKind, 'null'>): number {
  switch (kind) {
    case 'boolean': return 0;
    case 'number':
    case 'bigint': return 1;
    case 'temporal': return 2;
    case 'string': return 3;
    case 'q': return 4;
    case 'json': return 5;
  }
}

function portableJsonShapeIsSafe(value: unknown): boolean {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    nodes++;
    if (nodes > MAX_PORTABLE_JSON_NODES || current.depth > MAX_PORTABLE_JSON_DEPTH) {
      return false;
    }
    if (current.value === null || typeof current.value !== 'object') {
      continue;
    }
    if (Array.isArray(current.value)) {
      for (let index = 0; index < current.value.length; index++) {
        pending.push({ value: current.value[index], depth: current.depth + 1 });
      }
      continue;
    }
    for (const key in current.value as { [key: string]: unknown }) {
      if (Object.prototype.hasOwnProperty.call(current.value, key)) {
        pending.push({
          value: (current.value as { [key: string]: unknown })[key],
          depth: current.depth + 1,
        });
      }
    }
  }
  return true;
}

export function notebookResultToCsv(value: PortableKxTableResult): string {
  const table = createColumnarPanelResult(
    value.schema.columns.map(column => column.name),
    value.data.rows.length,
    (rowIndex, columnIndex) => portableCellValue(value.data.rows[rowIndex][columnIndex])
  );
  return table.toText('csv', allCellsRange(table.rowCount, table.columns.length), true);
}

export function notebookTruncationReasonSummary(
  reasons: readonly NotebookTruncationReason[]
): string {
  return reasons.map(reason => NOTEBOOK_TRUNCATION_REASON_LABELS[reason]).join(', ') ||
    'notebook output limit';
}

export function isPortableKxFullResult(value: PortableKxResult): boolean {
  return value.version === KX_NOTEBOOK_CONTRACT_VERSION_V2 &&
    value.persistence?.mode === 'full';
}

export function isHistoricalDirectPreview(value: PortableKxResult): boolean {
  return value.provenance.marker === 'direct-ipc' && !isPortableKxFullResult(value);
}

export function notebookSavedPreviewNotice(value: PortableKxResult): string {
  const historical = isHistoricalDirectPreview(value);
  const label = historical ? 'Historical saved preview' : 'Saved preview';
  const rerun = historical
    ? ' Rerun the current cell to replace it with a complete new result.'
    : '';
  const reasons = notebookTruncationReasonSummary(value.result.truncationReasons);
  if (value.kind === 'qText') {
    return value.result.truncated
      ? `${label} was shortened by the ${reasons}. ` +
        `Omitted content is not stored in this notebook.${rerun}`
      : `${label} is not marked as a complete result.${rerun}`;
  }
  const rows = value.result.previewRowCount < value.result.rowCount
    ? `showing ${value.result.previewRowCount.toLocaleString()} of ` +
      `${value.result.rowCount.toLocaleString()} rows`
    : `contains ${value.result.previewRowCount.toLocaleString()} saved rows`;
  return value.result.truncated
    ? `${label} ${rows}; bounded by the ${reasons}. ` +
      `Omitted content is not stored in this notebook.${rerun}`
    : `${label} ${rows}. It is not marked as a complete result.${rerun}`;
}

/** Bound qText presentation without changing the exact persisted text. */
export function notebookQTextDisplay(
  value: string,
  maximumChars = MAX_NOTEBOOK_QTEXT_CHARS
): NotebookBoundedDisplayText {
  const limit = Number.isSafeInteger(maximumChars) && maximumChars >= 0
    ? maximumChars
    : MAX_NOTEBOOK_QTEXT_CHARS;
  return value.length <= limit
    ? { text: value, truncated: false }
    : { text: safeTextPrefix(value, limit), truncated: true };
}

export function notebookQTextDisplayNotice(totalChars: number): string {
  return `Display shows the first ${MAX_NOTEBOOK_QTEXT_CHARS.toLocaleString()} of ` +
    `${totalChars.toLocaleString()} saved characters. Copy and Export use the full saved text.`;
}

export function notebookResultStaticHtml(value: PortableKxResult): string {
  const validation = validatePortableKxResult(value);
  if (!validation.ok) {
    throw new Error(validation.error);
  }
  const result = validation.value;
  if (result.kind === 'qText') {
    const display = notebookQTextDisplay(result.data.text);
    const parts = [
      '<div class="kx-notebook-result">',
      '<style>.kx-notebook-result{font-family:system-ui,sans-serif;font-size:13px;color:#202020}',
      '.kx-notebook-result pre{margin:6px 0;max-height:520px;overflow:auto;white-space:pre-wrap;',
      'border:1px solid #bbb;background:#f6f6f6;padding:8px}</style>',
      '<div><strong>KX/q result</strong>',
    ];
    if (result.provenance.label) {
      parts.push(' &middot; ', escapeHtml(result.provenance.label));
    }
    if (result.provenance.elapsedMs !== undefined) {
      parts.push(' &middot; ', escapeHtml(formatElapsed(result.provenance.elapsedMs)));
    }
    parts.push('</div><pre>', escapeHtml(display.text), '</pre>');
    if (display.truncated) {
      parts.push(
        '<div>',
        escapeHtml(notebookQTextDisplayNotice(result.data.text.length)),
        '</div>'
      );
    }
    if (!isPortableKxFullResult(result)) {
      parts.push('<div>', escapeHtml(notebookSavedPreviewNotice(result)), '</div>');
    }
    parts.push('</div>');
    return parts.join('');
  }
  const staticRowCount = Math.min(result.data.rows.length, STATIC_NOTEBOOK_TABLE_ROW_LIMIT);
  const staticColumns = result.schema.columns.slice(0, MAX_NOTEBOOK_COLUMNS);
  const omittedStaticColumns = result.schema.columns.length - staticColumns.length;
  const parts: string[] = [
    '<div class="kx-notebook-result">',
    '<style>.kx-notebook-result{font-family:system-ui,sans-serif;font-size:13px;color:#202020}',
    '.kx-notebook-result table{border-collapse:collapse;max-width:100%}',
    '.kx-notebook-result th,.kx-notebook-result td{border:1px solid #bbb;padding:3px 7px;text-align:left;vertical-align:top}',
    '.kx-notebook-result th{background:#eee}.kx-notebook-result .kx-note{margin:6px 0;color:#555}',
    '.kx-notebook-result svg{display:block;max-width:100%;height:auto;border:1px solid #bbb;background:#fff}</style>',
    '<div><strong>KX/q result</strong>',
  ];
  if (result.provenance.label) {
    parts.push(' &middot; ', escapeHtml(result.provenance.label));
  }
  if (result.provenance.elapsedMs !== undefined) {
    parts.push(' &middot; ', escapeHtml(formatElapsed(result.provenance.elapsedMs)));
  }
  parts.push('</div>');
  const persistedFull = isPortableKxFullResult(result);
  parts.push(
    '<div class="kx-note">Schema: ',
    staticColumns.map(column => `${escapeHtml(column.name)} (${escapeHtml(column.type)})`).join(', ') || 'no columns',
    omittedStaticColumns > 0
      ? `, &hellip; (${omittedStaticColumns.toLocaleString()} more saved columns)`
      : '',
    '</div>',
    '<div class="kx-note">Rows: ',
    String(result.result.rowCount),
    persistedFull
      ? `; all ${result.result.previewRowCount} rows persisted.</div>`
      : `; saved here: ${result.result.previewRowCount} (row limit ` +
        `${result.result.rowLimit}, byte limit ${result.result.byteLimit}).</div>`
  );
  if (!persistedFull) {
    parts.push(
      '<div class="kx-note"><strong>Showing saved preview output.</strong> ',
      escapeHtml(notebookSavedPreviewNotice(result)),
      '</div>'
    );
  }
  if (result.chart?.visible) {
    parts.push(staticChartSvg(result));
  }
  parts.push('<table><thead><tr>');
  for (const column of staticColumns) {
    parts.push('<th>', escapeHtml(column.name), '</th>');
  }
  parts.push('</tr></thead><tbody>');
  for (let rowIndex = 0; rowIndex < staticRowCount; rowIndex++) {
    parts.push('<tr>');
    for (const cell of result.data.rows[rowIndex].slice(0, staticColumns.length)) {
      parts.push('<td>', escapeHtml(portableCellToBoundedText(cell, 2048).text), '</td>');
    }
    parts.push('</tr>');
  }
  parts.push('</tbody></table>');
  if (staticRowCount < result.result.previewRowCount) {
    parts.push(
      '<div class="kx-note">Static export shows the first ',
      String(staticRowCount),
      ' of ',
      String(result.result.previewRowCount),
      ' saved rows.</div>'
    );
  }
  if (omittedStaticColumns > 0) {
    parts.push(
      '<div class="kx-note">Static output shows the first ',
      String(staticColumns.length),
      ' of ',
      String(result.schema.columns.length),
      ' saved columns. Copy and export retain all saved columns.</div>'
    );
  }
  parts.push('</div>');
  return parts.join('');
}

export function notebookResultPlainText(value: PortableKxResult): string {
  const validation = validatePortableKxResult(value);
  if (!validation.ok) {
    throw new Error(validation.error);
  }
  const result = validation.value;
  if (result.kind === 'qText') {
    const display = notebookQTextDisplay(result.data.text);
    const notices = [
      ...(!isPortableKxFullResult(result) ? [notebookSavedPreviewNotice(result)] : []),
      ...(display.truncated ? [notebookQTextDisplayNotice(result.data.text.length)] : []),
    ];
    return notices.length > 0
      ? `${display.text}\n... [${notices.join(' ')}]`
      : display.text;
  }
  const persistedFull = isPortableKxFullResult(result);
  const plainColumns = result.schema.columns.slice(0, 100);
  const omittedColumns = result.schema.columns.length - plainColumns.length;
  const lines = [
    `KX/q result${result.provenance.label ? ` - ${result.provenance.label}` : ''}`,
    `Schema: ${plainColumns.map(column => `${column.name} (${column.type})`).join(', ') || 'no columns'}` +
      (omittedColumns > 0 ? `, … (${omittedColumns} more columns)` : ''),
    persistedFull
      ? `Rows: ${result.result.rowCount}; all rows persisted`
      : `Rows: ${result.result.rowCount}; saved here: ${result.result.previewRowCount}; ` +
        `limits: ${result.result.rowLimit} rows / ${result.result.byteLimit} bytes`,
  ];
  if (!persistedFull) {
    lines.push(notebookSavedPreviewNotice(result));
  }
  const plainRows = result.data.rows.slice(0, 20);
  if (plainColumns.length > 0) {
    lines.push(plainColumns.map(column => plainCell(column.name)).join('\t'));
    plainRows.forEach(row => lines.push(
      row.slice(0, plainColumns.length).map(cell =>
        plainCell(portableCellToBoundedText(cell, 512).text)
      ).join('\t')
    ));
  }
  if (plainRows.length < result.result.previewRowCount) {
    lines.push(`Plain-text output shows ${plainRows.length} of ${result.result.previewRowCount} saved rows.`);
  }
  return lines.join('\n');
}

function normalizeColumn(
  column: string | PortableColumn,
  index: number,
  usedNames: Set<string>
): PortableColumn {
  const rawName = typeof column === 'string' ? column : column.name;
  const rawType = typeof column === 'string' ? 'mixed' : column.type;
  const baseName = clipText(String(rawName || `column${index + 1}`), MAX_NOTEBOOK_COLUMN_NAME_CHARS);
  let name = baseName;
  let suffix = 2;
  while (usedNames.has(name)) {
    const ending = `_${suffix++}`;
    name = `${baseName.slice(0, MAX_NOTEBOOK_COLUMN_NAME_CHARS - ending.length)}${ending}`;
  }
  usedNames.add(name);
  return {
    name,
    type: clipText(String(rawType || 'mixed'), MAX_NOTEBOOK_TYPE_NAME_CHARS),
  };
}

function portableCell(
  value: unknown,
  reasons: Set<NotebookTruncationReason>,
  qType?: string,
  allowExactQ = false
): PortableCell {
  if (allowExactQ && isQRuntimeValue(value)) {
    const preflight = qValueToBoundedLiteral(value, {
      maxChars: MAX_NOTEBOOK_CELL_STRING_CHARS,
      maxDepth: 512,
    });
    if (!preflight.truncated) {
      const exactQ = portableQCell(value);
      if (exactQ) {
        return exactQ;
      }
    }
    reasons.add('cellValueLimit');
    return { kind: 'string', value: preflight.text };
  }
  if (allowExactQ && isRecord(value) && typeof value.qtype === 'string') {
    reasons.add('cellValueLimit');
    return {
      kind: 'string',
      value: clipText(
        `[${portableEncodingFailureDetail(value, qType)}; preview only]`,
        MAX_NOTEBOOK_CELL_STRING_CHARS
      ),
    };
  }
  if (value === null || value === undefined) {
    return { kind: 'null' };
  }
  if (typeof value === 'boolean') {
    return { kind: 'boolean', value };
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { kind: 'number', value } : { kind: 'string', value: String(value) };
  }
  if (typeof value === 'bigint') {
    return { kind: 'bigint', value: value.toString() };
  }
  if (value instanceof Date) {
    return { kind: 'temporal', value: value.toISOString() };
  }
  if (typeof value === 'string') {
    const clipped = clipText(value, MAX_NOTEBOOK_CELL_STRING_CHARS);
    if (clipped.length !== value.length) {
      reasons.add('cellValueLimit');
    }
    return { kind: isQTemporalType(qType) ? 'temporal' : 'string', value: clipped };
  }
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  const clipped = clipText(text, MAX_NOTEBOOK_CELL_STRING_CHARS);
  if (clipped.length !== text.length) {
    reasons.add('cellValueLimit');
  }
  return { kind: 'json', value: clipped };
}

function strictPortableColumns(
  rawColumns: Array<string | PortableColumn>
): PortableColumn[] | undefined {
  const columns: PortableColumn[] = [];
  for (const raw of rawColumns) {
    const name = typeof raw === 'string' ? raw : raw.name;
    const type = typeof raw === 'string' ? 'mixed' : raw.type;
    if (typeof name !== 'string' || typeof type !== 'string') {
      return undefined;
    }
    columns.push({ name, type });
  }
  return columns;
}

function strictOptionalKeyColumnOrdinals(
  raw: unknown,
  columnCount: number
): number[] | undefined | null {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw) || !isDensePrimitiveArray(raw) || raw.some(ordinal =>
    !safeIntegerInRange(ordinal, 0, columnCount - 1)
  ) || new Set(raw).size !== raw.length) {
    return null;
  }
  return raw.slice() as number[];
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

function strictPortableCell(value: unknown, qType?: string): PortableCell | undefined {
  const exactQ = portableQCell(value);
  if (exactQ) {
    return exactQ;
  }
  if (value === null) {
    return { kind: 'null' };
  }
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return { kind: 'boolean', value };
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && !Object.is(value, -0)
      ? { kind: 'number', value }
      : undefined;
  }
  if (typeof value === 'bigint') {
    return { kind: 'bigint', value: value.toString() };
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime())
      ? { kind: 'temporal', value: value.toISOString() }
      : undefined;
  }
  if (typeof value === 'string') {
    return { kind: isQTemporalType(qType) ? 'temporal' : 'string', value };
  }
  if (!losslessJsonValueForExactCreation(value)) {
    return undefined;
  }
  try {
    const text = JSON.stringify(value);
    return typeof text === 'string' ? { kind: 'json', value: text } : undefined;
  } catch {
    return undefined;
  }
}

function portableQCell(value: unknown): PortableQCell | undefined {
  try {
    if (!isQRuntimeValue(value)) {
      return undefined;
    }
    const portable = qValueToPortableNode(value);
    return portable
      ? { kind: 'q', version: 1, value: portable }
      : undefined;
  } catch {
    return undefined;
  }
}

function portableEncodingFailureDetail(value: unknown, declaredQType?: string): string {
  const structuralType = isRecord(value) && value.qtype === 'atom' &&
    typeof value.type === 'string'
    ? value.type
    : isRecord(value) && typeof value.qtype === 'string'
      ? value.qtype
      : typeof declaredQType === 'string' && declaredQType.trim()
        ? declaredQType.trim()
        : value === null
          ? 'null'
          : Array.isArray(value)
            ? 'list'
            : typeof value;
  let rendered: string | undefined;
  try {
    const description = qValueDescription(value);
    if (description) {
      const nested = nestedUnsupportedQValueText(value);
      rendered = nested ? `${description}; unsupported nested ${nested}` : description;
    }
  } catch {
    // Fall through to a conservative structural description.
  }
  if (rendered === undefined) {
    rendered = structuralQValueText(value);
  }
  if (rendered === undefined) {
    try {
      rendered = typeof value === 'string'
        ? JSON.stringify(value)
        : String(value);
    } catch {
      rendered = '<unavailable>';
    }
  }
  return `q type ${clipText(structuralType, 64)}; value ${clipText(rendered, 160)}`;
}

function structuralQValueText(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.qtype !== 'string') {
    return undefined;
  }
  if (value.qtype === 'function') {
    const kind = typeof value.functionType === 'string' ? value.functionType : 'function';
    const source = typeof value.source === 'string' ? ` ${value.source}` : '';
    return `[q ${kind}${source}]`;
  }
  if (value.qtype === 'table') {
    const rows = typeof value.rowCount === 'number' ? value.rowCount : '?';
    const columns = Array.isArray(value.columns) ? value.columns.length : '?';
    return `[q table ${rows}x${columns}]`;
  }
  if (value.qtype === 'keyedTable') {
    const rows = typeof value.rowCount === 'number' ? value.rowCount : '?';
    const columns = Array.isArray(value.columns) ? value.columns.length : '?';
    return `[q keyed table ${rows}x${columns}]`;
  }
  if (value.qtype === 'dict') {
    const entries = Array.isArray(value.entries) ? value.entries.length : '?';
    return `[q dictionary ${entries} entr${entries === 1 ? 'y' : 'ies'}]`;
  }
  return `[q ${value.qtype}]`;
}

function nestedUnsupportedQValueText(root: unknown): string | undefined {
  const pending: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  const seen = new Set<object>();
  let visited = 0;
  while (pending.length > 0 && visited < 64) {
    const current = pending.pop()!;
    visited++;
    if (!current.value || typeof current.value !== 'object' || current.depth > 8 || seen.has(current.value as object)) {
      continue;
    }
    seen.add(current.value as object);
    const structural = structuralQValueText(current.value);
    if (structural && isRecord(current.value) &&
      current.value.qtype !== 'atom' && current.value.qtype !== 'generalNull') {
      return structural;
    }
    if (Array.isArray(current.value)) {
      for (let index = Math.min(current.value.length, 32) - 1; index >= 0; index--) {
        pending.push({ value: current.value[index], depth: current.depth + 1 });
      }
      continue;
    }
    for (const key of Object.keys(current.value as Record<string, unknown>).slice(0, 32).reverse()) {
      pending.push({
        value: (current.value as Record<string, unknown>)[key],
        depth: current.depth + 1,
      });
    }
  }
  return undefined;
}

function losslessJsonValue(value: unknown): boolean {
  return losslessJsonValueWithin(value, new Set<object>(), false);
}

function losslessJsonValueForExactCreation(value: unknown): boolean {
  return losslessJsonValueWithin(value, new Set<object>(), true);
}

function losslessJsonValueWithin(
  value: unknown,
  seen: Set<object>,
  rejectDecodedQStructures: boolean
): boolean {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && !Object.is(value, -0);
  }
  if (typeof value !== 'object' || seen.has(value)) {
    return false;
  }
  // Decoded q structures must use the typed q-cell contract. Treating a q
  // function/dictionary/table object as generic JSON would preserve only our
  // decoder model while silently discarding q type semantics (and, for some
  // function forms, payload detail).
  if (rejectDecodedQStructures && isRecord(value) && typeof value.qtype === 'string') {
    return false;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null && !Array.isArray(value)) {
    return false;
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      if (keys.length !== value.length + 1 || keys.some(key => {
        if (key === 'length') {
          return false;
        }
        return typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length;
      })) {
        return false;
      }
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !('value' in descriptor) || descriptor.value === undefined ||
          !losslessJsonValueWithin(descriptor.value, seen, rejectDecodedQStructures)) {
          return false;
        }
      }
      return true;
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') {
        return false;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor) ||
        descriptor.value === undefined ||
        !losslessJsonValueWithin(descriptor.value, seen, rejectDecodedQStructures)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  } finally {
    seen.delete(value);
  }
}

function validateCell(
  raw: unknown,
  unbounded = false,
  allowExactQ = false,
  requireExactNumber = false
): PortableCell | undefined {
  if (isRecord(raw) && raw.kind === 'q') {
    return allowExactQ && validatePortableQCell(raw)
      ? raw as unknown as PortableQCell
      : undefined;
  }
  if (!isRecord(raw) || typeof raw.kind !== 'string' || !CELL_KINDS.has(raw.kind as PortableCellKind)) {
    return undefined;
  }
  if (raw.kind === 'null') {
    return hasOnlyKeys(raw, ['kind']) ? { kind: 'null' } : undefined;
  }
  if (!hasOnlyKeys(raw, ['kind', 'value'])) {
    return undefined;
  }
  if (raw.kind === 'boolean') {
    return typeof raw.value === 'boolean' ? { kind: 'boolean', value: raw.value } : undefined;
  }
  if (raw.kind === 'number') {
    return typeof raw.value === 'number' && Number.isFinite(raw.value) &&
      (!requireExactNumber || !Object.is(raw.value, -0))
      ? { kind: 'number', value: raw.value }
      : undefined;
  }
  if (!(unbounded
    ? typeof raw.value === 'string'
    : boundedString(raw.value, 0, MAX_NOTEBOOK_CELL_STRING_CHARS))) {
    return undefined;
  }
  if (unbounded && raw.kind === 'json') {
    try {
      if (!losslessJsonValue(JSON.parse(raw.value as string))) {
        return undefined;
      }
    } catch {
      return undefined;
    }
  }
  return { kind: raw.kind as PortableTextCell['kind'], value: raw.value as string };
}

function validatePortableQCell(raw: Record<string, unknown>): boolean {
  return hasOnlyKeys(raw, ['kind', 'version', 'value']) &&
    raw.kind === 'q' && raw.version === 1 &&
    validatePortableQNode(raw.value);
}

function normalizeChart(
  raw: Partial<NotebookChartSpec> | undefined,
  columns: PortableColumn[]
): NotebookChartSpec | undefined {
  if (!raw || raw.visible !== true) {
    return undefined;
  }
  const columnNames = new Set(columns.map(column => column.name));
  const type = CHART_TYPES.has(raw.type as NotebookChartType) ? raw.type as NotebookChartType : 'line';
  const xColumn = typeof raw.xColumn === 'string' && columnNames.has(raw.xColumn) ? raw.xColumn : columns[0]?.name;
  if (!xColumn) {
    return undefined;
  }
  const yColumns = Array.isArray(raw.yColumns)
    ? raw.yColumns.filter((value): value is string => typeof value === 'string' && columnNames.has(value))
    : [];
  const uniqueY = [...new Set(yColumns.filter(value => value !== xColumn))].slice(0, 16);
  if (type !== 'candlestick' && uniqueY.length === 0) {
    const fallback = columns.find(column => column.name !== xColumn)?.name;
    if (!fallback) {
      return undefined;
    }
    uniqueY.push(fallback);
  }
  const groupByColumn = type !== 'box' && type !== 'candlestick' &&
    typeof raw.groupByColumn === 'string' && columnNames.has(raw.groupByColumn)
    ? raw.groupByColumn
    : undefined;
  const ohlc = type === 'candlestick'
    ? [
      raw.openColumn,
      raw.highColumn,
      raw.lowColumn,
      raw.closeColumn,
    ].filter((value): value is string =>
      typeof value === 'string' && columnNames.has(value)
    )
    : [];
  if (type === 'candlestick' && (ohlc.length !== 4 || new Set(ohlc).size !== 4)) {
    return undefined;
  }
  const title = typeof raw.title === 'string' && raw.title.length > 0
    ? clipText(raw.title, MAX_NOTEBOOK_LABEL_CHARS)
    : undefined;
  return {
    version: 1,
    visible: true,
    type,
    xColumn,
    yColumns: uniqueY,
    ...(groupByColumn ? { groupByColumn } : {}),
    ...(type === 'candlestick'
      ? {
        openColumn: ohlc[0],
        highColumn: ohlc[1],
        lowColumn: ohlc[2],
        closeColumn: ohlc[3],
      }
      : {}),
    ...(title ? { title } : {}),
  };
}

function validateChart(raw: unknown, columns: PortableColumn[]): NotebookChartSpec | undefined {
  if (!isRecord(raw) || !hasOnlyKeys(raw, [
    'version',
    'visible',
    'type',
    'xColumn',
    'yColumns',
    'groupByColumn',
    'openColumn',
    'highColumn',
    'lowColumn',
    'closeColumn',
    'title',
  ]) || raw.version !== 1 || raw.visible !== true || typeof raw.type !== 'string' ||
    !CHART_TYPES.has(raw.type as NotebookChartType) || typeof raw.xColumn !== 'string' ||
    !Array.isArray(raw.yColumns) || raw.yColumns.length > 16) {
    return undefined;
  }
  const names = new Set(columns.map(column => column.name));
  if (!names.has(raw.xColumn)) {
    return undefined;
  }
  const yColumns: string[] = [];
  for (const value of raw.yColumns) {
    if (typeof value !== 'string' || !names.has(value) || value === raw.xColumn) {
      return undefined;
    }
    yColumns.push(value);
  }
  if (new Set(yColumns).size !== yColumns.length) {
    return undefined;
  }
  const type = raw.type as NotebookChartType;
  const supportsGroupBy =
    type === 'line' || type === 'scatter' || type === 'step' || type === 'bar';
  const groupByColumn = raw.groupByColumn === undefined
    ? undefined
    : typeof raw.groupByColumn === 'string' && names.has(raw.groupByColumn)
      ? raw.groupByColumn
      : null;
  if (groupByColumn === null || (!supportsGroupBy && groupByColumn !== undefined)) {
    return undefined;
  }
  const ohlc = [raw.openColumn, raw.highColumn, raw.lowColumn, raw.closeColumn];
  if (type === 'candlestick') {
    if (yColumns.length !== 0 ||
      !ohlc.every(value => typeof value === 'string' && names.has(value)) ||
      new Set(ohlc).size !== 4) {
      return undefined;
    }
  } else if (yColumns.length === 0 || ohlc.some(value => value !== undefined)) {
    return undefined;
  }
  if (raw.title !== undefined && !boundedString(raw.title, 1, MAX_NOTEBOOK_LABEL_CHARS)) {
    return undefined;
  }
  return {
    version: 1,
    visible: true,
    type,
    xColumn: raw.xColumn,
    yColumns,
    ...(groupByColumn === undefined ? {} : { groupByColumn }),
    ...(type === 'candlestick'
      ? {
        openColumn: raw.openColumn as string,
        highColumn: raw.highColumn as string,
        lowColumn: raw.lowColumn as string,
        closeColumn: raw.closeColumn as string,
      }
      : {}),
    ...(raw.title === undefined ? {} : { title: raw.title }),
  };
}

function staticChartSvg(result: PortableKxTableResult): string {
  const chart = result.chart;
  if (!chart) {
    return '';
  }
  if (chart.type === 'box' || chart.type === 'candlestick' || chart.groupByColumn) {
    const mode = chart.groupByColumn ? `grouped ${chart.type}` : chart.type;
    return `<div class="kx-note">Static ${escapeHtml(mode)} chart rendering is unavailable; ` +
      'open this notebook in VS Code to use the interactive KX renderer.</div>';
  }
  const xIndex = result.schema.columns.findIndex(column => column.name === chart.xColumn);
  const yIndexes = chart.yColumns.map(name => result.schema.columns.findIndex(column => column.name === name));
  const sampledRows = evenlySample(result.data.rows, STATIC_NOTEBOOK_CHART_POINT_LIMIT);
  const series = yIndexes.map(() => [] as Array<{ x: number; y: number }>);
  sampledRows.forEach((row, rowIndex) => {
    const x = chartNumber(row[xIndex], rowIndex);
    yIndexes.forEach((columnIndex, seriesIndex) => {
      const y = chartNumber(row[columnIndex]);
      if (x !== undefined && y !== undefined) {
        series[seriesIndex].push({ x, y });
      }
    });
  });
  const points = series.flat();
  if (points.length === 0) {
    return '<div class="kx-note">Static chart unavailable: selected columns contain no finite numeric/temporal points.</div>';
  }
  const width = 720;
  const height = 240;
  const pad = 28;
  const minX = Math.min(...points.map(point => point.x));
  const maxX = Math.max(...points.map(point => point.x));
  const minY = Math.min(...points.map(point => point.y));
  const maxY = Math.max(...points.map(point => point.y));
  const scaleX = (value: number) => pad + ((value - minX) / (maxX - minX || 1)) * (width - pad * 2);
  const scaleY = (value: number) => height - pad - ((value - minY) / (maxY - minY || 1)) * (height - pad * 2);
  const colors = ['#006bb6', '#d1495b', '#2e8b57', '#7b2cbf', '#b5651d', '#008b8b'];
  const parts = [
    `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(chart.title ?? `Static ${chart.type} chart of ${chart.yColumns.join(', ')} by ${chart.xColumn}`)}">`,
    `<line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#777"/>`,
    `<line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" stroke="#777"/>`,
  ];
  series.forEach((values, seriesIndex) => {
    const color = colors[seriesIndex % colors.length];
    if (chart.type === 'scatter') {
      values.forEach(point => parts.push(
        `<circle cx="${scaleX(point.x).toFixed(2)}" cy="${scaleY(point.y).toFixed(2)}" r="2" fill="${color}"/>`
      ));
      return;
    }
    if (chart.type === 'bar') {
      const barWidth = Math.max(1, (width - pad * 2) / Math.max(values.length, 1) / Math.max(series.length, 1));
      values.forEach(point => {
        const x = scaleX(point.x) + (seriesIndex - (series.length - 1) / 2) * barWidth;
        const y = scaleY(point.y);
        parts.push(
          `<rect x="${x.toFixed(2)}" y="${Math.min(y, height - pad).toFixed(2)}" width="${barWidth.toFixed(2)}" ` +
          `height="${Math.abs(height - pad - y).toFixed(2)}" fill="${color}" opacity="0.8"/>`
        );
      });
      return;
    }
    const coordinates: string[] = [];
    values.forEach((point, index) => {
      const x = scaleX(point.x).toFixed(2);
      const y = scaleY(point.y).toFixed(2);
      if (chart.type === 'step' && index > 0) {
        coordinates.push(`${x},${scaleY(values[index - 1].y).toFixed(2)}`);
      }
      coordinates.push(`${x},${y}`);
    });
    parts.push(`<polyline points="${coordinates.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5"/>`);
  });
  parts.push('</svg>');
  return parts.join('');
}

function chartNumber(cell: PortableCell | undefined, fallback?: number): number | undefined {
  if (!cell) {
    return fallback;
  }
  if (cell.kind === 'null') {
    return fallback;
  }
  if (cell.kind === 'number') {
    return cell.value;
  }
  if (cell.kind === 'temporal') {
    const value = Date.parse(cell.value);
    return Number.isFinite(value) ? value : fallback;
  }
  const value = Number(portableCellText(cell));
  return Number.isFinite(value) ? value : fallback;
}

function evenlySample<T>(values: T[], limit: number): T[] {
  if (values.length <= limit) {
    return values;
  }
  const sampled: T[] = [];
  for (let index = 0; index < limit; index++) {
    sampled.push(values[Math.floor(index * (values.length - 1) / (limit - 1))]);
  }
  return sampled;
}

function updateResultSummary(
  payload: PortableKxTableResult,
  reasons: Set<NotebookTruncationReason>,
  previewRowCount = payload.data.rows.length
): void {
  payload.result.previewRowCount = previewRowCount;
  payload.result.truncationReasons = [...reasons];
  payload.result.truncated = reasons.size > 0 || payload.result.previewRowCount < payload.result.rowCount;
}

function trimNotebookColumnsToMetadataBudget(
  payload: PortableKxTableResult,
  reasons: Set<NotebookTruncationReason>,
  byteLimit: number,
  previewRowCount: number
): void {
  const savedRows = payload.data.rows;
  payload.data.rows = [];
  updateResultSummary(payload, reasons, previewRowCount);
  while (payload.schema.columns.length > 0 && portableKxResultBytes(payload) > byteLimit) {
    payload.schema.columns.pop();
    reasons.add('columnLimit');
    if (payload.chart && !validateChart(payload.chart, payload.schema.columns)) {
      delete payload.chart;
    }
    updateResultSummary(payload, reasons, previewRowCount);
  }
  payload.data.rows = savedRows;
}

function portableKxResultMetadataBytes(payload: PortableKxTableResult): number {
  const savedRows = payload.data.rows;
  payload.data.rows = [];
  const bytes = portableKxResultBytes(payload);
  payload.data.rows = savedRows;
  return bytes;
}

function portableRowPrefixBytes(rows: readonly PortableCell[][]): number[] {
  const encoder = new TextEncoder();
  const prefixes = [0];
  let total = 0;
  for (const row of rows) {
    total += encoder.encode(JSON.stringify(row)).byteLength;
    prefixes.push(total);
  }
  return prefixes;
}

function portableKxResultBytesForRowCount(
  payload: PortableKxTableResult,
  reasons: Set<NotebookTruncationReason>,
  prefixBytes: readonly number[],
  rowCount: number
): number {
  updateResultSummary(payload, reasons, rowCount);
  return portableKxResultMetadataBytes(payload) +
    prefixBytes[rowCount] +
    Math.max(0, rowCount - 1);
}

function fitV2PreviewTableToBudget(payload: PortableKxTableResult): void {
  const byteLimit = payload.result.byteLimit;
  const reasons = new Set(payload.result.truncationReasons);
  if (portableKxResultBytes(payload) > byteLimit && payload.data.rows.length > 0) {
    reasons.add('byteLimit');
    const allRows = payload.data.rows;
    let lower = 0;
    let upper = allRows.length;
    let accepted = 0;
    while (lower <= upper) {
      const candidate = Math.floor((lower + upper) / 2);
      payload.data.rows = allRows.slice(0, candidate);
      refreshV2PreviewSummary(payload, reasons);
      if (portableKxResultBytes(payload) <= byteLimit) {
        accepted = candidate;
        lower = candidate + 1;
      } else {
        upper = candidate - 1;
      }
    }
    payload.data.rows = allRows.slice(0, accepted);
    refreshV2PreviewSummary(payload, reasons);
  }
  while (payload.schema.columns.length > 0 && portableKxResultBytes(payload) > byteLimit) {
    payload.schema.columns.pop();
    payload.data.rows = payload.data.rows.map(row => row.slice(0, payload.schema.columns.length));
    if (payload.schema.keyColumnOrdinals) {
      payload.schema.keyColumnOrdinals = payload.schema.keyColumnOrdinals.filter(
        ordinal => ordinal < payload.schema.columns.length
      );
    }
    reasons.add('columnLimit');
    if (payload.chart && !validateChart(payload.chart, payload.schema.columns)) {
      delete payload.chart;
    }
    refreshV2PreviewSummary(payload, reasons);
  }
  refreshV2PreviewSummary(payload, reasons);
}

function refreshV2PreviewSummary(
  payload: PortableKxTableResult,
  reasons: Set<NotebookTruncationReason>
): void {
  payload.result.previewRowCount = payload.data.rows.length;
  payload.result.truncationReasons = [...reasons];
  payload.result.truncated = reasons.size > 0 ||
    payload.result.previewRowCount < payload.result.rowCount ||
    payload.schema.columns.length < (payload.result.columnCount ?? payload.schema.columns.length);
}

function fitV2PreviewTextToBudget(payload: PortableKxTextResult): void {
  const byteLimit = payload.result.byteLimit;
  if (portableKxResultBytes(payload) <= byteLimit) {
    return;
  }
  payload.result.truncated = true;
  if (!payload.result.truncationReasons.includes('byteLimit')) {
    payload.result.truncationReasons.push('byteLimit');
  }
  const original = payload.data.text;
  let lower = 0;
  let upper = original.length;
  let accepted = 0;
  while (lower <= upper) {
    const candidate = Math.floor((lower + upper) / 2);
    payload.data.text = safeTextPrefix(original, candidate);
    if (portableKxResultBytes(payload) <= byteLimit) {
      accepted = candidate;
      lower = candidate + 1;
    } else {
      upper = candidate - 1;
    }
  }
  payload.data.text = safeTextPrefix(original, accepted);
}

function strictFirstPartyProvenance(
  input: Pick<NotebookResultInput, 'label' | 'elapsedMs' | 'qSource'>
): PortableKxResult['provenance'] {
  return {
    marker: 'direct-ipc',
    ...(typeof input.label === 'string' ? { label: input.label } : {}),
    ...(finiteNonNegative(input.elapsedMs) ? { elapsedMs: input.elapsedMs } : {}),
    ...(typeof input.qSource === 'string' ? { qSource: input.qSource } : {}),
  };
}

function validatedProvenance(
  raw: unknown,
  unbounded = false
): PortableKxResult['provenance'] | undefined {
  if (!isRecord(raw) || !hasOnlyKeys(raw, ['marker', 'label', 'elapsedMs', 'qSource']) ||
    (raw.marker !== '%%q' && raw.marker !== 'direct-ipc') ||
    (raw.label !== undefined && (unbounded
      ? typeof raw.label !== 'string'
      : !boundedString(raw.label, 1, MAX_NOTEBOOK_LABEL_CHARS))) ||
    (raw.qSource !== undefined && (unbounded
      ? typeof raw.qSource !== 'string'
      : !boundedString(raw.qSource, 0, MAX_NOTEBOOK_Q_SOURCE_CHARS))) ||
    (raw.elapsedMs !== undefined && !finiteNonNegative(raw.elapsedMs))) {
    return undefined;
  }
  return {
    marker: raw.marker,
    ...(raw.label === undefined ? {} : { label: raw.label as string }),
    ...(raw.elapsedMs === undefined ? {} : { elapsedMs: raw.elapsedMs }),
    ...(raw.qSource === undefined ? {} : { qSource: raw.qSource as string }),
  };
}

function validNotebookOutputId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(value);
}

function v2Failure(
  error: string,
  rowCount: number,
  columnCount: number
): Extract<NotebookV2CreationResult, { ok: false }> {
  return { ok: false, error, rowCount, columnCount };
}

function optionalBoundedString<Key extends 'label' | 'qSource'>(
  key: Key,
  value: string | undefined,
  max: number
): Partial<Record<Key, string>> {
  if (typeof value !== 'string' || value.length === 0) {
    return {};
  }
  return { [key]: clipText(value, max) } as Partial<Record<Key, string>>;
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  return Number.isSafeInteger(value) ? Math.min(max, Math.max(min, value as number)) : fallback;
}

function nonNegativeSafeInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : fallback;
}

function safeIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function boundedString(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every(key => allowedKeys.has(key));
}

function invalid(error: string): NotebookValidationResult {
  return { ok: false, error };
}

function clipText(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, Math.max(0, limit - 1))}\u2026`;
}

function safeTextPrefix(value: string, limit: number): string {
  let prefix = value.slice(0, Math.max(0, limit));
  if (prefix.length > 0) {
    const last = prefix.charCodeAt(prefix.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) {
      prefix = prefix.slice(0, -1);
    }
  }
  return prefix;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function plainCell(value: string): string {
  return clipText(value.replace(/[\t\r\n]+/g, ' '), 512);
}

function formatElapsed(value: number): string {
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
}
