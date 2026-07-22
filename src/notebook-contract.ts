import { allCellsRange, createColumnarPanelResult } from './kx-results';

export const KX_NOTEBOOK_MIME = 'application/vnd.kx.result+json';
export const KX_NOTEBOOK_CONTRACT_VERSION = 1;

export const DEFAULT_NOTEBOOK_ROW_LIMIT = 1000;
export const MIN_NOTEBOOK_ROW_LIMIT = 1;
export const MAX_NOTEBOOK_ROW_LIMIT = 10000;
export const DEFAULT_NOTEBOOK_BYTE_LIMIT = 1000000;
export const MIN_NOTEBOOK_BYTE_LIMIT = 16384;
export const MAX_NOTEBOOK_BYTE_LIMIT = 10000000;

export const MAX_NOTEBOOK_COLUMNS = 256;
export const MAX_NOTEBOOK_COLUMN_NAME_CHARS = 256;
export const MAX_NOTEBOOK_TYPE_NAME_CHARS = 64;
export const MAX_NOTEBOOK_CELL_STRING_CHARS = 32768;
export const MAX_NOTEBOOK_LABEL_CHARS = 200;
export const MAX_NOTEBOOK_Q_SOURCE_CHARS = 4000;
export const STATIC_NOTEBOOK_TABLE_ROW_LIMIT = 100;
export const STATIC_NOTEBOOK_CHART_POINT_LIMIT = 240;

export type PortableCellKind =
  | 'null'
  | 'boolean'
  | 'number'
  | 'string'
  | 'bigint'
  | 'temporal'
  | 'json';

export interface PortableNullCell {
  kind: 'null';
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

export type PortableCell = PortableNullCell | PortableBooleanCell | PortableNumberCell | PortableTextCell;

export interface PortableColumn {
  name: string;
  type: string;
}

export type NotebookChartType = 'line' | 'scatter' | 'step' | 'bar';

export interface NotebookChartSpec {
  version: 1;
  visible: boolean;
  type: NotebookChartType;
  xColumn: string;
  yColumns: string[];
  title?: string;
}

export type NotebookTruncationReason =
  | 'rowLimit'
  | 'byteLimit'
  | 'cellValueLimit'
  | 'columnLimit'
  | 'sourcePreview';

export interface PortableKxResult {
  version: 1;
  kind: 'table';
  schema: {
    columns: PortableColumn[];
  };
  data: {
    encoding: 'rows';
    rows: PortableCell[][];
  };
  result: {
    rowCount: number;
    previewRowCount: number;
    truncated: boolean;
    truncationReasons: NotebookTruncationReason[];
    rowLimit: number;
    byteLimit: number;
  };
  provenance: {
    marker: '%%q';
    label?: string;
    elapsedMs?: number;
    qSource?: string;
  };
  chart?: NotebookChartSpec;
}

export interface NotebookResultInput {
  columns: Array<string | PortableColumn>;
  rows: unknown[][];
  rowCount?: number;
  rowLimit?: number;
  byteLimit?: number;
  label?: string;
  elapsedMs?: number;
  qSource?: string;
  chart?: Partial<NotebookChartSpec>;
}

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
const CHART_TYPES = new Set<NotebookChartType>(['line', 'scatter', 'step', 'bar']);

export function createPortableKxResult(input: NotebookResultInput): PortableKxResult {
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
  const payload: PortableKxResult = {
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
      marker: '%%q',
      ...optionalBoundedString('label', input.label, MAX_NOTEBOOK_LABEL_CHARS),
      ...(finiteNonNegative(input.elapsedMs) ? { elapsedMs: input.elapsedMs } : {}),
      ...optionalBoundedString('qSource', input.qSource, MAX_NOTEBOOK_Q_SOURCE_CHARS),
    },
  };
  while (columns.length > 0 && portableKxResultBytes(payload) > byteLimit) {
    columns.pop();
    reasons.add('columnLimit');
    updateResultSummary(payload, reasons);
  }
  const chart = normalizeChart(input.chart, columns);
  if (chart) {
    payload.chart = chart;
    if (portableKxResultBytes(payload) > byteLimit) {
      delete payload.chart;
      reasons.add('byteLimit');
      updateResultSummary(payload, reasons);
    }
  }

  const availableRows = input.rows.slice(0, rowLimit);
  if (rowCount > availableRows.length || input.rows.length > rowLimit) {
    reasons.add('rowLimit');
  }
  for (const rawRow of availableRows) {
    const row = columns.map((_column, index) => portableCell(rawRow[index], reasons));
    payload.data.rows.push(row);
    updateResultSummary(payload, reasons);
    if (portableKxResultBytes(payload) > byteLimit) {
      payload.data.rows.pop();
      reasons.add('byteLimit');
      updateResultSummary(payload, reasons);
      break;
    }
  }
  updateResultSummary(payload, reasons);
  while (payload.data.rows.length > 0 && portableKxResultBytes(payload) > byteLimit) {
    payload.data.rows.pop();
    reasons.add('byteLimit');
    updateResultSummary(payload, reasons);
  }
  return payload;
}

export function validatePortableKxResult(raw: unknown): NotebookValidationResult {
  try {
    if (!isRecord(raw)) {
      return invalid('KX notebook output must be a JSON object.');
    }
    if (raw.version !== KX_NOTEBOOK_CONTRACT_VERSION || raw.kind !== 'table') {
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
      raw.provenance.marker !== '%%q') {
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

    const value: PortableKxResult = {
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
        marker: '%%q',
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

export function portableKxResultBytes(value: PortableKxResult): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function portableCellValue(cell: PortableCell): unknown {
  if (cell.kind === 'null') {
    return null;
  }
  return cell.value;
}

export function portableCellText(cell: PortableCell): string {
  if (cell.kind === 'null') {
    return '';
  }
  if (cell.kind === 'boolean') {
    return cell.value ? 'true' : 'false';
  }
  return String(cell.value);
}

export function notebookResultToCsv(value: PortableKxResult): string {
  const table = createColumnarPanelResult(
    value.schema.columns.map(column => column.name),
    value.data.rows.length,
    (rowIndex, columnIndex) => portableCellValue(value.data.rows[rowIndex][columnIndex])
  );
  return table.toText('csv', allCellsRange(table.rowCount, table.columns.length), true);
}

export function notebookResultStaticHtml(value: PortableKxResult): string {
  const validation = validatePortableKxResult(value);
  if (!validation.ok) {
    throw new Error(validation.error);
  }
  const result = validation.value;
  const staticRowCount = Math.min(result.data.rows.length, STATIC_NOTEBOOK_TABLE_ROW_LIMIT);
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
  parts.push(
    '<div class="kx-note">Schema: ',
    result.schema.columns.map(column => `${escapeHtml(column.name)} (${escapeHtml(column.type)})`).join(', ') || 'no columns',
    '</div>',
    '<div class="kx-note">Rows: ',
    String(result.result.rowCount),
    '; persisted preview: ',
    String(result.result.previewRowCount),
    ' (row limit ',
    String(result.result.rowLimit),
    ', byte limit ',
    String(result.result.byteLimit),
    ').</div>'
  );
  if (result.result.truncated) {
    parts.push(
      '<div class="kx-note"><strong>Preview only.</strong> The notebook does not contain the omitted full result. ',
      'Open the live originating result/session when it is still available. Reasons: ',
      escapeHtml(result.result.truncationReasons.join(', ') || 'preview limit'),
      '.</div>'
    );
  }
  if (result.chart?.visible) {
    parts.push(staticChartSvg(result));
  }
  parts.push('<table><thead><tr>');
  for (const column of result.schema.columns) {
    parts.push('<th>', escapeHtml(column.name), '</th>');
  }
  parts.push('</tr></thead><tbody>');
  for (let rowIndex = 0; rowIndex < staticRowCount; rowIndex++) {
    parts.push('<tr>');
    for (const cell of result.data.rows[rowIndex]) {
      parts.push('<td>', escapeHtml(clipText(portableCellText(cell), 2048)), '</td>');
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
      ' persisted preview rows.</div>'
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
  const lines = [
    `KX/q result${result.provenance.label ? ` - ${result.provenance.label}` : ''}`,
    `Schema: ${result.schema.columns.map(column => `${column.name} (${column.type})`).join(', ') || 'no columns'}`,
    `Rows: ${result.result.rowCount}; persisted preview: ${result.result.previewRowCount}; ` +
      `limits: ${result.result.rowLimit} rows / ${result.result.byteLimit} bytes`,
  ];
  if (result.result.truncated) {
    lines.push(
      `Preview only (${result.result.truncationReasons.join(', ') || 'preview limit'}). ` +
      'The omitted full result is not stored in this notebook.'
    );
  }
  const plainRows = result.data.rows.slice(0, 20);
  if (result.schema.columns.length > 0) {
    lines.push(result.schema.columns.map(column => plainCell(column.name)).join('\t'));
    plainRows.forEach(row => lines.push(row.map(cell => plainCell(portableCellText(cell))).join('\t')));
  }
  if (plainRows.length < result.result.previewRowCount) {
    lines.push(`Plain-text fallback shows ${plainRows.length} of ${result.result.previewRowCount} preview rows.`);
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

function portableCell(value: unknown, reasons: Set<NotebookTruncationReason>): PortableCell {
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
    return { kind: 'string', value: clipped };
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

function validateCell(raw: unknown): PortableCell | undefined {
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
    return typeof raw.value === 'number' && Number.isFinite(raw.value)
      ? { kind: 'number', value: raw.value }
      : undefined;
  }
  return boundedString(raw.value, 0, MAX_NOTEBOOK_CELL_STRING_CHARS)
    ? { kind: raw.kind as PortableTextCell['kind'], value: raw.value }
    : undefined;
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
  if (uniqueY.length === 0) {
    const fallback = columns.find(column => column.name !== xColumn)?.name;
    if (!fallback) {
      return undefined;
    }
    uniqueY.push(fallback);
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
    'title',
  ]) || raw.version !== 1 || raw.visible !== true || typeof raw.type !== 'string' ||
    !CHART_TYPES.has(raw.type as NotebookChartType) || typeof raw.xColumn !== 'string' ||
    !Array.isArray(raw.yColumns) || raw.yColumns.length === 0 || raw.yColumns.length > 16) {
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
  if (raw.title !== undefined && !boundedString(raw.title, 1, MAX_NOTEBOOK_LABEL_CHARS)) {
    return undefined;
  }
  return {
    version: 1,
    visible: true,
    type: raw.type as NotebookChartType,
    xColumn: raw.xColumn,
    yColumns,
    ...(raw.title === undefined ? {} : { title: raw.title }),
  };
}

function staticChartSvg(result: PortableKxResult): string {
  const chart = result.chart;
  if (!chart) {
    return '';
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

function updateResultSummary(payload: PortableKxResult, reasons: Set<NotebookTruncationReason>): void {
  payload.result.previewRowCount = payload.data.rows.length;
  if (payload.result.previewRowCount < payload.result.rowCount && reasons.size === 0) {
    reasons.add('rowLimit');
  }
  payload.result.truncationReasons = [...reasons];
  payload.result.truncated = reasons.size > 0 || payload.result.previewRowCount < payload.result.rowCount;
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
