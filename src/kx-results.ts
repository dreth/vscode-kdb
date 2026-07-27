export interface CellPosition {
  row: number;
  column: number;
}

export interface CellRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

export interface VisibleIndexRange {
  start: number;
  end: number;
}

export interface CellWindow {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  cells: string[][];
}

export type RowValue = { [key: string]: unknown };
export type ArrayDisplayFormat = 'commaSpace' | 'space' | 'raw';
export interface CellTextOptions {
  arrayDisplayFormat?: ArrayDisplayFormat;
}
export interface ExportOptions extends CellTextOptions {
  includeHeaders?: boolean;
  includeRowIndex?: boolean;
}

export interface ExportShape {
  selectedRows: number;
  selectedColumns: number;
  outputRows: number;
  outputColumns: number;
  selectedCells: number;
  outputCells: number;
}

export interface ColumnarPanelResult {
  columns: string[];
  rowCount: number;
  cellValue(rowIndex: number, columnIndex: number): unknown;
  cellText(rowIndex: number, columnIndex: number, options?: CellTextOptions): string;
  cellWindow(rowRange: VisibleIndexRange, columnRange: VisibleIndexRange, options?: CellTextOptions): CellWindow;
  toText(format: TextExportFormat, range: CellRange, optionsOrIncludeHeaders?: boolean | ExportOptions): string;
}

export type TextExportFormat = 'tsv' | 'csv' | 'json' | 'ndjson' | 'html' | 'markdown';
export type ExportFormat = TextExportFormat | 'xlsx';
export type ColumnarSortDirection = 'asc' | 'desc';

export const ROW_INDEX_COLUMN = '#';
export const XLSX_MAX_ROWS = 1048576;
export const XLSX_MAX_COLUMNS = 16384;

export function normalizeCellRange(anchor: CellPosition, focus: CellPosition): CellRange {
  return {
    startRow: Math.min(anchor.row, focus.row),
    endRow: Math.max(anchor.row, focus.row),
    startColumn: Math.min(anchor.column, focus.column),
    endColumn: Math.max(anchor.column, focus.column),
  };
}

export function isCellInRange(row: number, column: number, range: CellRange | null | undefined): boolean {
  return !!range &&
    row >= range.startRow &&
    row <= range.endRow &&
    column >= range.startColumn &&
    column <= range.endColumn;
}

export function clampCellRange(range: CellRange, rowCount: number, columnCount: number): CellRange | null {
  if (rowCount <= 0 || columnCount <= 0) {
    return null;
  }

  const maxRow = rowCount - 1;
  const maxColumn = columnCount - 1;
  const clamped = {
    startRow: clamp(range.startRow, 0, maxRow),
    endRow: clamp(range.endRow, 0, maxRow),
    startColumn: clamp(range.startColumn, 0, maxColumn),
    endColumn: clamp(range.endColumn, 0, maxColumn),
  };

  if (clamped.startRow > clamped.endRow || clamped.startColumn > clamped.endColumn) {
    return null;
  }

  return clamped;
}

export function allCellsRange(rowCount: number, columnCount: number): CellRange {
  return {
    startRow: 0,
    endRow: nonNegativeCount(rowCount) - 1,
    startColumn: 0,
    endColumn: nonNegativeCount(columnCount) - 1,
  };
}

export function exportShape(range: CellRange, options: ExportOptions = {}): ExportShape {
  const selectedRows = Math.max(0, range.endRow - range.startRow + 1);
  const selectedColumns = Math.max(0, range.endColumn - range.startColumn + 1);
  const outputRows = selectedRows + (options.includeHeaders ? 1 : 0);
  const outputColumns = selectedColumns + (options.includeRowIndex ? 1 : 0);
  return {
    selectedRows,
    selectedColumns,
    outputRows,
    outputColumns,
    selectedCells: selectedRows * selectedColumns,
    outputCells: outputRows * outputColumns,
  };
}

export function validateXlsxSheetLimits(range: CellRange, options: ExportOptions = {}): string | null {
  const shape = exportShape(range, options);
  const failures: string[] = [];
  if (shape.outputRows > XLSX_MAX_ROWS) {
    failures.push(`${shape.outputRows} rows`);
  }
  if (shape.outputColumns > XLSX_MAX_COLUMNS) {
    failures.push(`${shape.outputColumns} columns`);
  }
  if (failures.length === 0) {
    return null;
  }

  return `XLSX export exceeds Excel sheet limits (${XLSX_MAX_ROWS} rows x ${XLSX_MAX_COLUMNS} columns): ` +
    `${failures.join(', ')} after applying header and row-number options.`;
}

export function rowsToTsv(
  rows: RowValue[],
  columns: string[],
  range: CellRange,
  optionsOrIncludeHeaders: boolean | ExportOptions = false
): string {
  const clamped = clampCellRange(range, rows.length, columns.length);
  if (!clamped) {
    return '';
  }

  const options = normalizeExportOptions(optionsOrIncludeHeaders, false);
  const lines: string[] = [];
  if (options.includeHeaders) {
    const headers: string[] = [];
    if (options.includeRowIndex) {
      headers.push(cellValueToText(rowIndexColumnName(columns, clamped)));
    }
    for (let columnIndex = clamped.startColumn; columnIndex <= clamped.endColumn; columnIndex++) {
      headers.push(cellValueToText(columns[columnIndex], options));
    }
    lines.push(headers.join('\t'));
  }

  for (let rowIndex = clamped.startRow; rowIndex <= clamped.endRow; rowIndex++) {
    const row = rows[rowIndex] || {};
    const values: string[] = [];
    if (options.includeRowIndex) {
      values.push(String(rowIndex + 1));
    }
    for (let columnIndex = clamped.startColumn; columnIndex <= clamped.endColumn; columnIndex++) {
      values.push(cellValueToText(row[columns[columnIndex]], options));
    }
    lines.push(values.join('\t'));
  }
  return lines.join('\n');
}

export function rowsToCsv(
  rows: RowValue[],
  columns: string[],
  range: CellRange,
  optionsOrIncludeHeaders: boolean | ExportOptions = true
): string {
  const clamped = clampCellRange(range, rows.length, columns.length);
  if (!clamped) {
    return '';
  }

  const options = normalizeExportOptions(optionsOrIncludeHeaders, true);
  const lines: string[] = [];
  if (options.includeHeaders) {
    const headers: string[] = [];
    if (options.includeRowIndex) {
      headers.push(escapeCsvCell(cellValueToCsvText(rowIndexColumnName(columns, clamped))));
    }
    for (let columnIndex = clamped.startColumn; columnIndex <= clamped.endColumn; columnIndex++) {
      headers.push(escapeCsvCell(cellValueToCsvText(columns[columnIndex], options)));
    }
    lines.push(headers.join(','));
  }

  for (let rowIndex = clamped.startRow; rowIndex <= clamped.endRow; rowIndex++) {
    const row = rows[rowIndex] || {};
    const values: string[] = [];
    if (options.includeRowIndex) {
      values.push(String(rowIndex + 1));
    }
    for (let columnIndex = clamped.startColumn; columnIndex <= clamped.endColumn; columnIndex++) {
      values.push(escapeCsvCell(cellValueToCsvText(row[columns[columnIndex]], options)));
    }
    lines.push(values.join(','));
  }
  return lines.join('\n');
}

export function rowsToJson(
  rows: RowValue[],
  columns: string[],
  range: CellRange,
  optionsOrIncludeHeaders: boolean | ExportOptions = {}
): string {
  const clamped = clampCellRange(range, rows.length, columns.length);
  if (!clamped) {
    return '[]';
  }

  const options = normalizeExportOptions(optionsOrIncludeHeaders, false);
  return kxResultJsonStringify(selectedRows(rows, columns, clamped, options.includeRowIndex));
}

export function rowsToNdjson(
  rows: RowValue[],
  columns: string[],
  range: CellRange,
  optionsOrIncludeHeaders: boolean | ExportOptions = {}
): string {
  const clamped = clampCellRange(range, rows.length, columns.length);
  if (!clamped) {
    return '';
  }

  const options = normalizeExportOptions(optionsOrIncludeHeaders, false);
  return selectedRows(rows, columns, clamped, options.includeRowIndex)
    .map(row => kxResultJsonStringify(row))
    .join('\n');
}

export function rowsToHtml(
  rows: RowValue[],
  columns: string[],
  range: CellRange,
  optionsOrIncludeHeaders: boolean | ExportOptions = true
): string {
  const clamped = clampCellRange(range, rows.length, columns.length);
  if (!clamped) {
    return '';
  }

  const options = normalizeExportOptions(optionsOrIncludeHeaders, true);
  const parts: string[] = ['<table>'];
  if (options.includeHeaders) {
    parts.push('<thead><tr>');
    if (options.includeRowIndex) {
      parts.push('<th>', escapeHtml(cellValueToCsvText(rowIndexColumnName(columns, clamped))), '</th>');
    }
    for (let columnIndex = clamped.startColumn; columnIndex <= clamped.endColumn; columnIndex++) {
      parts.push('<th>', escapeHtml(cellValueToCsvText(columns[columnIndex], options)), '</th>');
    }
    parts.push('</tr></thead>');
  }

  parts.push('<tbody>');
  for (let rowIndex = clamped.startRow; rowIndex <= clamped.endRow; rowIndex++) {
    const row = rows[rowIndex] || {};
    parts.push('<tr>');
    if (options.includeRowIndex) {
      parts.push('<td>', String(rowIndex + 1), '</td>');
    }
    for (let columnIndex = clamped.startColumn; columnIndex <= clamped.endColumn; columnIndex++) {
      parts.push('<td>', escapeHtml(cellValueToCsvText(row[columns[columnIndex]], options)), '</td>');
    }
    parts.push('</tr>');
  }
  parts.push('</tbody></table>');
  return parts.join('');
}

export function rowsToMarkdown(
  rows: RowValue[],
  columns: string[],
  range: CellRange,
  optionsOrIncludeHeaders: boolean | ExportOptions = true
): string {
  const clamped = clampCellRange(range, rows.length, columns.length);
  if (!clamped) {
    return '';
  }

  const options = normalizeExportOptions(optionsOrIncludeHeaders, true);
  const lines: string[] = [];
  if (options.includeHeaders) {
    const headers: string[] = [];
    if (options.includeRowIndex) {
      headers.push(escapeMarkdownTableCell(rowIndexColumnName(columns, clamped)));
    }
    for (let columnIndex = clamped.startColumn; columnIndex <= clamped.endColumn; columnIndex++) {
      headers.push(escapeMarkdownTableCell(columns[columnIndex]));
    }
    lines.push(markdownTableRow(headers));
    lines.push(markdownTableSeparator(headers.length));
  }

  for (let rowIndex = clamped.startRow; rowIndex <= clamped.endRow; rowIndex++) {
    const row = rows[rowIndex] || {};
    const values: string[] = [];
    if (options.includeRowIndex) {
      values.push(String(rowIndex + 1));
    }
    for (let columnIndex = clamped.startColumn; columnIndex <= clamped.endColumn; columnIndex++) {
      values.push(escapeMarkdownTableCell(row[columns[columnIndex]], options));
    }
    lines.push(markdownTableRow(values));
  }
  return lines.join('\n');
}

export function rowsToTextFormat(
  rows: RowValue[],
  columns: string[],
  range: CellRange,
  format: TextExportFormat,
  optionsOrIncludeHeaders: boolean | ExportOptions = true
): string {
  const options = normalizeExportOptions(optionsOrIncludeHeaders, true);
  switch (format) {
    case 'tsv':
      return rowsToTsv(rows, columns, range, options);
    case 'csv':
      return rowsToCsv(rows, columns, range, options);
    case 'json':
      return rowsToJson(rows, columns, range, options);
    case 'ndjson':
      return rowsToNdjson(rows, columns, range, options);
    case 'html':
      return rowsToHtml(rows, columns, range, options);
    case 'markdown':
      return rowsToMarkdown(rows, columns, range, options);
  }

  throw new Error(`Unsupported text export format: ${format}`);
}

export function createColumnarPanelResult(
  columns: string[],
  rowCount: number,
  cellValue: (rowIndex: number, columnIndex: number) => unknown
): ColumnarPanelResult {
  const normalizedColumns = columns.map(column => String(column));
  const normalizedRowCount = nonNegativeCount(rowCount);
  const result: ColumnarPanelResult = {
    columns: normalizedColumns,
    rowCount: normalizedRowCount,
    cellValue(rowIndex: number, columnIndex: number): unknown {
      if (rowIndex < 0 || rowIndex >= normalizedRowCount || columnIndex < 0 || columnIndex >= normalizedColumns.length) {
        return undefined;
      }
      return cellValue(rowIndex, columnIndex);
    },
    cellText(rowIndex: number, columnIndex: number, options?: CellTextOptions): string {
      return cellValueToText(result.cellValue(rowIndex, columnIndex), options);
    },
    cellWindow(rowRange: VisibleIndexRange, columnRange: VisibleIndexRange, options?: CellTextOptions): CellWindow {
      return columnarToCellWindow(result, rowRange, columnRange, options);
    },
    toText(format: TextExportFormat, range: CellRange, optionsOrIncludeHeaders: boolean | ExportOptions = true): string {
      return columnarToTextFormat(result, range, format, optionsOrIncludeHeaders);
    },
  };
  return result;
}

export function rowsToColumnarPanelResult(rows: RowValue[], columns: string[]): ColumnarPanelResult {
  return createColumnarPanelResult(columns, rows.length, (rowIndex, columnIndex) => {
    const row = rows[rowIndex] || {};
    return row[columns[columnIndex]];
  });
}

export function emptyColumnarPanelResult(): ColumnarPanelResult {
  return createColumnarPanelResult([], 0, () => undefined);
}

export function filterColumnarPanelResult(result: ColumnarPanelResult, visibleColumns: string[]): ColumnarPanelResult {
  const sourceColumnIndexesByName: { [column: string]: number } = Object.create(null);
  result.columns.forEach((column, columnIndex) => {
    if (!Object.prototype.hasOwnProperty.call(sourceColumnIndexesByName, column)) {
      sourceColumnIndexesByName[column] = columnIndex;
    }
  });

  const sourceColumnIndexes: number[] = [];
  const filteredColumns: string[] = [];
  visibleColumns.map(column => String(column)).forEach(column => {
    if (Object.prototype.hasOwnProperty.call(sourceColumnIndexesByName, column)) {
      sourceColumnIndexes.push(sourceColumnIndexesByName[column]);
      filteredColumns.push(column);
    }
  });

  return createColumnarPanelResult(filteredColumns, result.rowCount, (rowIndex, columnIndex) => {
    return result.cellValue(rowIndex, sourceColumnIndexes[columnIndex]);
  });
}

export function applyColumnarRowOrder(result: ColumnarPanelResult, rowOrder: number[] | undefined): ColumnarPanelResult {
  if (!rowOrder) {
    return result;
  }

  const sourceRowIndexes = rowOrder
    .map(rowIndex => Math.floor(Number(rowIndex)))
    .filter(rowIndex => Number.isFinite(rowIndex) && rowIndex >= 0 && rowIndex < result.rowCount);
  return createColumnarPanelResult(result.columns, sourceRowIndexes.length, (rowIndex, columnIndex) => {
    return result.cellValue(sourceRowIndexes[rowIndex], columnIndex);
  });
}

export function sortedColumnarRowOrder(
  result: ColumnarPanelResult,
  columnIndex: number,
  direction: ColumnarSortDirection,
  options?: CellTextOptions
): number[] {
  if (columnIndex < 0 || columnIndex >= result.columns.length) {
    throw new RangeError(`Column index ${columnIndex} is outside ${result.columns.length} columns`);
  }

  const texts: string[] = [];
  const rowOrder: number[] = [];
  for (let rowIndex = 0; rowIndex < result.rowCount; rowIndex++) {
    texts[rowIndex] = result.cellText(rowIndex, columnIndex, options);
    rowOrder.push(rowIndex);
  }

  rowOrder.sort((leftRow, rightRow) => {
    const compared = compareColumnarCellText(texts[leftRow], texts[rightRow], direction);
    return compared === 0 ? leftRow - rightRow : compared;
  });
  return rowOrder;
}

export function compareColumnarCellText(
  left: string,
  right: string,
  direction: ColumnarSortDirection = 'asc'
): number {
  const leftText = String(left);
  const rightText = String(right);
  const leftEmpty = leftText.trim().length === 0;
  const rightEmpty = rightText.trim().length === 0;
  if (leftEmpty || rightEmpty) {
    if (leftEmpty && rightEmpty) {
      return 0;
    }
    return leftEmpty ? 1 : -1;
  }

  const compared = compareNonEmptyCellText(leftText, rightText);
  return direction === 'desc' ? -compared : compared;
}

export function columnarToCellWindow(
  result: ColumnarPanelResult,
  rowRange: VisibleIndexRange,
  columnRange: VisibleIndexRange,
  options?: CellTextOptions
): CellWindow {
  const clamped = clampCellRange(
    {
      startRow: rowRange.start,
      endRow: rowRange.end,
      startColumn: columnRange.start,
      endColumn: columnRange.end,
    },
    result.rowCount,
    result.columns.length
  );

  if (!clamped) {
    return emptyCellWindow();
  }

  const cells: string[][] = [];
  for (let rowIndex = clamped.startRow; rowIndex <= clamped.endRow; rowIndex++) {
    const values: string[] = [];
    for (let columnIndex = clamped.startColumn; columnIndex <= clamped.endColumn; columnIndex++) {
      values.push(result.cellText(rowIndex, columnIndex, options));
    }
    cells.push(values);
  }

  return {
    startRow: clamped.startRow,
    endRow: clamped.endRow,
    startColumn: clamped.startColumn,
    endColumn: clamped.endColumn,
    cells,
  };
}

export function columnarToTextFormat(
  result: ColumnarPanelResult,
  range: CellRange,
  format: TextExportFormat,
  optionsOrIncludeHeaders: boolean | ExportOptions = true
): string {
  const options = normalizeExportOptions(optionsOrIncludeHeaders, true);
  switch (format) {
    case 'tsv':
      return columnarToTsv(result, range, options);
    case 'csv':
      return columnarToCsv(result, range, options);
    case 'json':
      return columnarToJson(result, range, options);
    case 'ndjson':
      return columnarToNdjson(result, range, options);
    case 'html':
      return columnarToHtml(result, range, options);
    case 'markdown':
      return columnarToMarkdown(result, range, options);
  }

  throw new Error(`Unsupported text export format: ${format}`);
}

function columnarToTsv(result: ColumnarPanelResult, range: CellRange, options: NormalizedExportOptions): string {
  const clamped = clampCellRange(range, result.rowCount, result.columns.length);
  if (!clamped) {
    return '';
  }

  const lines: string[] = [];
  if (options.includeHeaders) {
    const headers: string[] = [];
    if (options.includeRowIndex) {
      headers.push(cellValueToText(rowIndexColumnName(result.columns, clamped)));
    }
    for (let columnIndex = clamped.startColumn; columnIndex <= clamped.endColumn; columnIndex++) {
      headers.push(cellValueToText(result.columns[columnIndex], options));
    }
    lines.push(headers.join('\t'));
  }

  for (let rowIndex = clamped.startRow; rowIndex <= clamped.endRow; rowIndex++) {
    const values: string[] = [];
    if (options.includeRowIndex) {
      values.push(String(rowIndex + 1));
    }
    for (let columnIndex = clamped.startColumn; columnIndex <= clamped.endColumn; columnIndex++) {
      values.push(cellValueToText(result.cellValue(rowIndex, columnIndex), options));
    }
    lines.push(values.join('\t'));
  }
  return lines.join('\n');
}

function columnarToCsv(result: ColumnarPanelResult, range: CellRange, options: NormalizedExportOptions): string {
  const clamped = clampCellRange(range, result.rowCount, result.columns.length);
  if (!clamped) {
    return '';
  }

  const lines: string[] = [];
  if (options.includeHeaders) {
    const headers: string[] = [];
    if (options.includeRowIndex) {
      headers.push(escapeCsvCell(cellValueToCsvText(rowIndexColumnName(result.columns, clamped))));
    }
    for (let columnIndex = clamped.startColumn; columnIndex <= clamped.endColumn; columnIndex++) {
      headers.push(escapeCsvCell(cellValueToCsvText(result.columns[columnIndex], options)));
    }
    lines.push(headers.join(','));
  }

  for (let rowIndex = clamped.startRow; rowIndex <= clamped.endRow; rowIndex++) {
    const values: string[] = [];
    if (options.includeRowIndex) {
      values.push(String(rowIndex + 1));
    }
    for (let columnIndex = clamped.startColumn; columnIndex <= clamped.endColumn; columnIndex++) {
      values.push(escapeCsvCell(cellValueToCsvText(result.cellValue(rowIndex, columnIndex), options)));
    }
    lines.push(values.join(','));
  }
  return lines.join('\n');
}

function columnarToJson(result: ColumnarPanelResult, range: CellRange, options: NormalizedExportOptions): string {
  const clamped = clampCellRange(range, result.rowCount, result.columns.length);
  if (!clamped) {
    return '[]';
  }

  return kxResultJsonStringify(
    selectedColumnarRows(result, clamped, options.includeRowIndex)
  );
}

function columnarToNdjson(result: ColumnarPanelResult, range: CellRange, options: NormalizedExportOptions): string {
  const clamped = clampCellRange(range, result.rowCount, result.columns.length);
  if (!clamped) {
    return '';
  }

  return selectedColumnarRows(result, clamped, options.includeRowIndex)
    .map(row => kxResultJsonStringify(row))
    .join('\n');
}

function columnarToHtml(result: ColumnarPanelResult, range: CellRange, options: NormalizedExportOptions): string {
  const clamped = clampCellRange(range, result.rowCount, result.columns.length);
  if (!clamped) {
    return '';
  }

  const parts: string[] = ['<table>'];
  if (options.includeHeaders) {
    parts.push('<thead><tr>');
    if (options.includeRowIndex) {
      parts.push('<th>', escapeHtml(cellValueToCsvText(rowIndexColumnName(result.columns, clamped))), '</th>');
    }
    for (let columnIndex = clamped.startColumn; columnIndex <= clamped.endColumn; columnIndex++) {
      parts.push('<th>', escapeHtml(cellValueToCsvText(result.columns[columnIndex], options)), '</th>');
    }
    parts.push('</tr></thead>');
  }

  parts.push('<tbody>');
  for (let rowIndex = clamped.startRow; rowIndex <= clamped.endRow; rowIndex++) {
    parts.push('<tr>');
    if (options.includeRowIndex) {
      parts.push('<td>', String(rowIndex + 1), '</td>');
    }
    for (let columnIndex = clamped.startColumn; columnIndex <= clamped.endColumn; columnIndex++) {
      parts.push('<td>', escapeHtml(cellValueToCsvText(result.cellValue(rowIndex, columnIndex), options)), '</td>');
    }
    parts.push('</tr>');
  }
  parts.push('</tbody></table>');
  return parts.join('');
}

function columnarToMarkdown(result: ColumnarPanelResult, range: CellRange, options: NormalizedExportOptions): string {
  const clamped = clampCellRange(range, result.rowCount, result.columns.length);
  if (!clamped) {
    return '';
  }

  const lines: string[] = [];
  if (options.includeHeaders) {
    const headers: string[] = [];
    if (options.includeRowIndex) {
      headers.push(escapeMarkdownTableCell(rowIndexColumnName(result.columns, clamped)));
    }
    for (let columnIndex = clamped.startColumn; columnIndex <= clamped.endColumn; columnIndex++) {
      headers.push(escapeMarkdownTableCell(result.columns[columnIndex]));
    }
    lines.push(markdownTableRow(headers));
    lines.push(markdownTableSeparator(headers.length));
  }

  for (let rowIndex = clamped.startRow; rowIndex <= clamped.endRow; rowIndex++) {
    const values: string[] = [];
    if (options.includeRowIndex) {
      values.push(String(rowIndex + 1));
    }
    for (let columnIndex = clamped.startColumn; columnIndex <= clamped.endColumn; columnIndex++) {
      values.push(escapeMarkdownTableCell(result.cellValue(rowIndex, columnIndex), options));
    }
    lines.push(markdownTableRow(values));
  }
  return lines.join('\n');
}

export function rowsToCellWindow(
  rows: RowValue[],
  columns: string[],
  rowRange: VisibleIndexRange,
  columnRange: VisibleIndexRange,
  options?: CellTextOptions
): CellWindow {
  const clamped = clampCellRange(
    {
      startRow: rowRange.start,
      endRow: rowRange.end,
      startColumn: columnRange.start,
      endColumn: columnRange.end,
    },
    rows.length,
    columns.length
  );

  if (!clamped) {
    return emptyCellWindow();
  }

  const cells: string[][] = [];
  for (let rowIndex = clamped.startRow; rowIndex <= clamped.endRow; rowIndex++) {
    const row = rows[rowIndex] || {};
    const values: string[] = [];
    for (let columnIndex = clamped.startColumn; columnIndex <= clamped.endColumn; columnIndex++) {
      values.push(cellValueToText(row[columns[columnIndex]], options));
    }
    cells.push(values);
  }

  return {
    startRow: clamped.startRow,
    endRow: clamped.endRow,
    startColumn: clamped.startColumn,
    endColumn: clamped.endColumn,
    cells,
  };
}

export function cellValueToText(value: unknown, options?: CellTextOptions): string {
  return sanitizeTsvCell(cellValueToReadableText(value, options));
}

export interface BoundedCellText {
  text: string;
  truncated: boolean;
}

interface BoundedReadableTextState {
  chunks: string[];
  length: number;
  limit: number;
  truncated: boolean;
  skipLfAfterCr: boolean;
  stack: Set<object>;
  options: NormalizedCellTextOptions;
}

export function cellValueToBoundedText(
  value: unknown,
  maxChars: number,
  options?: CellTextOptions
): BoundedCellText {
  const limit = Number.isFinite(maxChars)
    ? Math.max(0, Math.floor(maxChars))
    : 0;
  const state: BoundedReadableTextState = {
    chunks: [],
    length: 0,
    limit,
    truncated: false,
    skipLfAfterCr: false,
    stack: new Set<object>(),
    options: normalizeCellTextOptions(options),
  };
  appendBoundedReadableValue(state, value, true, 0);
  return {
    text: state.chunks.join(''),
    truncated: state.truncated,
  };
}

export function visibleIndexRange(
  scrollOffset: number,
  viewportSize: number,
  itemSize: number,
  itemCount: number,
  overscan = 4
): VisibleIndexRange {
  if (itemCount <= 0 || itemSize <= 0 || viewportSize <= 0) {
    return { start: 0, end: -1 };
  }

  const safeOverscan = Math.max(0, Math.floor(overscan));
  const start = clamp(Math.floor(scrollOffset / itemSize) - safeOverscan, 0, itemCount - 1);
  const end = clamp(Math.ceil((scrollOffset + viewportSize) / itemSize) + safeOverscan, 0, itemCount - 1);
  return { start, end };
}

function compareNonEmptyCellText(left: string, right: string): number {
  const leftBoolean = booleanSortValue(left);
  const rightBoolean = booleanSortValue(right);
  if (leftBoolean !== null && rightBoolean !== null) {
    return leftBoolean - rightBoolean;
  }

  const leftNumber = numericSortValue(left);
  const rightNumber = numericSortValue(right);
  if (leftNumber !== null && rightNumber !== null) {
    if (leftNumber < rightNumber) {
      return -1;
    }
    if (leftNumber > rightNumber) {
      return 1;
    }
    return 0;
  }

  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function booleanSortValue(value: string): number | null {
  const normalized = value.trim().toLocaleLowerCase();
  if (normalized === 'false') {
    return 0;
  }
  if (normalized === 'true') {
    return 1;
  }
  return null;
}

function numericSortValue(value: string): number | null {
  const normalized = value.trim();
  if (!/^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?$/.test(normalized)) {
    return null;
  }

  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function cellValueToCsvText(value: unknown, options?: CellTextOptions): string {
  return cellValueToReadableText(value, options);
}

function cellValueToReadableText(value: unknown, options?: CellTextOptions): string {
  return readableValueText(value, true, normalizeCellTextOptions(options));
}

function readableValueText(value: unknown, topLevel: boolean, options: NormalizedCellTextOptions): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const text = value.map(item => readableValueText(item, false, options)).join(arrayDisplaySeparator(options.arrayDisplayFormat));
    return topLevel && options.arrayDisplayFormat !== 'raw' ? text : `[${text}]`;
  }

  if (isPlainObject(value)) {
    const parts = Object.keys(value as { [key: string]: unknown }).map(key => {
      return `${JSON.stringify(key)}: ${readableValueText((value as { [key: string]: unknown })[key], false, options)}`;
    });
    return `{${parts.join(', ')}}`;
  }

  return cellValueToExportText(value);
}

function appendBoundedReadableValue(
  state: BoundedReadableTextState,
  value: unknown,
  topLevel: boolean,
  depth: number
): void {
  if (state.truncated) {
    return;
  }
  if (depth > 512) {
    state.truncated = true;
    return;
  }
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value === 'string') {
    appendBoundedSanitizedText(state, value);
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    appendBoundedSanitizedText(state, String(value));
    return;
  }
  if (Array.isArray(value)) {
    appendBoundedReadableArray(state, value, topLevel, depth);
    return;
  }
  if (isPlainObject(value)) {
    appendBoundedReadableObject(state, value, depth);
    return;
  }

  let estimated: number | undefined;
  try {
    estimated = kxResultJsonCharacterLength(
      value,
      Math.max(0, state.limit - state.length)
    );
  } catch {
    estimated = undefined;
  }
  if (estimated === undefined) {
    state.truncated = true;
    return;
  }
  appendBoundedSanitizedText(state, cellValueToExportText(value));
}

function appendBoundedReadableArray(
  state: BoundedReadableTextState,
  value: unknown[],
  topLevel: boolean,
  depth: number
): void {
  if (state.stack.has(value)) {
    state.truncated = true;
    return;
  }
  state.stack.add(value);
  try {
    const bracketed = !topLevel || state.options.arrayDisplayFormat === 'raw';
    if (bracketed) {
      appendBoundedSanitizedText(state, '[');
    }
    const separator = arrayDisplaySeparator(state.options.arrayDisplayFormat);
    for (let index = 0; index < value.length && !state.truncated; index++) {
      if (index > 0) {
        appendBoundedSanitizedText(state, separator);
      }
      appendBoundedReadableValue(state, value[index], false, depth + 1);
    }
    if (bracketed && !state.truncated) {
      appendBoundedSanitizedText(state, ']');
    }
  } finally {
    state.stack.delete(value);
  }
}

function appendBoundedReadableObject(
  state: BoundedReadableTextState,
  value: { [key: string]: unknown },
  depth: number
): void {
  if (state.stack.has(value)) {
    state.truncated = true;
    return;
  }
  state.stack.add(value);
  try {
    appendBoundedSanitizedText(state, '{');
    let properties = 0;
    for (const key in value) {
      if (state.truncated ||
        !Object.prototype.hasOwnProperty.call(value, key)) {
        continue;
      }
      if (properties > 0) {
        appendBoundedSanitizedText(state, ', ');
      }
      appendBoundedJsonString(state, key);
      appendBoundedSanitizedText(state, ': ');
      appendBoundedReadableValue(state, value[key], false, depth + 1);
      properties++;
    }
    if (!state.truncated) {
      appendBoundedSanitizedText(state, '}');
    }
  } finally {
    state.stack.delete(value);
  }
}

function appendBoundedJsonString(
  state: BoundedReadableTextState,
  value: string
): void {
  appendBoundedSanitizedText(state, '"');
  for (let index = 0; index < value.length && !state.truncated; index++) {
    const code = value.charCodeAt(index);
    switch (code) {
      case 0x08:
        appendBoundedSanitizedText(state, '\\b');
        break;
      case 0x09:
        appendBoundedSanitizedText(state, '\\t');
        break;
      case 0x0a:
        appendBoundedSanitizedText(state, '\\n');
        break;
      case 0x0c:
        appendBoundedSanitizedText(state, '\\f');
        break;
      case 0x0d:
        appendBoundedSanitizedText(state, '\\r');
        break;
      case 0x22:
        appendBoundedSanitizedText(state, '\\"');
        break;
      case 0x5c:
        appendBoundedSanitizedText(state, '\\\\');
        break;
      default:
        if (code <= 0x1f ||
          (code >= 0xd800 && code <= 0xdfff &&
            !(code <= 0xdbff &&
              index + 1 < value.length &&
              value.charCodeAt(index + 1) >= 0xdc00 &&
              value.charCodeAt(index + 1) <= 0xdfff))) {
          appendBoundedSanitizedText(
            state,
            `\\u${code.toString(16).padStart(4, '0')}`
          );
        } else if (code >= 0xd800 && code <= 0xdbff) {
          appendBoundedSanitizedText(state, value.slice(index, index + 2));
          index++;
        } else {
          appendBoundedSanitizedText(state, value.charAt(index));
        }
    }
  }
  if (!state.truncated) {
    appendBoundedSanitizedText(state, '"');
  }
}

function appendBoundedSanitizedText(
  state: BoundedReadableTextState,
  value: string
): void {
  if (state.truncated || value.length === 0) {
    return;
  }
  let index = 0;
  if (state.skipLfAfterCr) {
    state.skipLfAfterCr = false;
    if (value.charCodeAt(0) === 0x0a) {
      index = 1;
    }
  }
  while (index < value.length && !state.truncated) {
    const start = index;
    while (index < value.length) {
      const code = value.charCodeAt(index);
      if (code === 0x09 || code === 0x0a || code === 0x0d) {
        break;
      }
      index++;
    }
    if (index > start) {
      appendBoundedRawText(state, value.slice(start, index));
    }
    if (index >= value.length || state.truncated) {
      break;
    }
    const code = value.charCodeAt(index++);
    appendBoundedRawText(state, ' ');
    if (code === 0x0d) {
      if (index < value.length && value.charCodeAt(index) === 0x0a) {
        index++;
      } else if (index === value.length) {
        state.skipLfAfterCr = true;
      }
    }
  }
}

function appendBoundedRawText(
  state: BoundedReadableTextState,
  value: string
): void {
  if (state.truncated || value.length === 0) {
    return;
  }
  const remaining = state.limit - state.length;
  if (remaining <= 0) {
    state.truncated = true;
    return;
  }
  if (value.length <= remaining) {
    state.chunks.push(value);
    state.length += value.length;
    return;
  }
  state.chunks.push(value.slice(0, remaining));
  state.length += remaining;
  state.truncated = true;
}

function isPlainObject(value: unknown): value is { [key: string]: unknown } {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function cellValueToExportText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

export function rowIndexColumnName(columns: string[], range: CellRange): string {
  let name = ROW_INDEX_COLUMN;
  let suffix = 1;
  while (rangeContainsColumn(columns, range, name)) {
    name = `${ROW_INDEX_COLUMN}_${suffix}`;
    suffix += 1;
  }
  return name;
}

function selectedRows(rows: RowValue[], columns: string[], range: CellRange, includeRowIndex = false): RowValue[] {
  const selected: RowValue[] = [];
  const indexColumn = includeRowIndex ? rowIndexColumnName(columns, range) : '';
  for (let rowIndex = range.startRow; rowIndex <= range.endRow; rowIndex++) {
    const row = rows[rowIndex] || {};
    const value: RowValue = {};
    if (includeRowIndex) {
      value[indexColumn] = rowIndex + 1;
    }
    for (let columnIndex = range.startColumn; columnIndex <= range.endColumn; columnIndex++) {
      const column = columns[columnIndex];
      value[column] = row[column];
    }
    selected.push(value);
  }
  return selected;
}

function selectedColumnarRows(result: ColumnarPanelResult, range: CellRange, includeRowIndex = false): RowValue[] {
  const selected: RowValue[] = [];
  const indexColumn = includeRowIndex ? rowIndexColumnName(result.columns, range) : '';
  for (let rowIndex = range.startRow; rowIndex <= range.endRow; rowIndex++) {
    const value: RowValue = {};
    if (includeRowIndex) {
      value[indexColumn] = rowIndex + 1;
    }
    for (let columnIndex = range.startColumn; columnIndex <= range.endColumn; columnIndex++) {
      value[result.columns[columnIndex]] = result.cellValue(rowIndex, columnIndex);
    }
    selected.push(value);
  }
  return selected;
}

function rangeContainsColumn(columns: string[], range: CellRange, name: string): boolean {
  for (let columnIndex = range.startColumn; columnIndex <= range.endColumn; columnIndex++) {
    if (columns[columnIndex] === name) {
      return true;
    }
  }
  return false;
}

interface NormalizedExportOptions {
  includeHeaders: boolean;
  includeRowIndex: boolean;
  arrayDisplayFormat: ArrayDisplayFormat;
}

interface NormalizedCellTextOptions {
  arrayDisplayFormat: ArrayDisplayFormat;
}

function normalizeExportOptions(
  value: boolean | ExportOptions | undefined,
  defaultIncludeHeaders: boolean
): NormalizedExportOptions {
  if (typeof value === 'boolean') {
    return { includeHeaders: value, includeRowIndex: false, arrayDisplayFormat: 'commaSpace' };
  }

  return {
    includeHeaders: value && typeof value.includeHeaders === 'boolean' ? value.includeHeaders : defaultIncludeHeaders,
    includeRowIndex: value ? value.includeRowIndex === true : false,
    arrayDisplayFormat: normalizeArrayDisplayFormat(value && value.arrayDisplayFormat),
  };
}

function normalizeCellTextOptions(value: CellTextOptions | undefined): NormalizedCellTextOptions {
  return {
    arrayDisplayFormat: normalizeArrayDisplayFormat(value && value.arrayDisplayFormat),
  };
}

function normalizeArrayDisplayFormat(value: any): ArrayDisplayFormat {
  return value === 'space' || value === 'raw' ? value : 'commaSpace';
}

function arrayDisplaySeparator(format: ArrayDisplayFormat): string {
  return format === 'commaSpace' ? ', ' : ' ';
}

export function kxResultJsonStringify(value: unknown): string {
  const json = JSON.stringify(value, jsonReplacer);
  return json === undefined ? 'null' : json;
}

export function kxResultJsonCharacterLength(
  value: unknown,
  maxChars = Number.MAX_SAFE_INTEGER
): number | undefined {
  const limit = safeJsonLengthLimit(maxChars);
  return jsonValueCharacterLength(value, '', limit, new Set<object>(), 0);
}

export function kxResultJsonStringCharacterLength(
  value: string,
  maxChars = Number.MAX_SAFE_INTEGER
): number | undefined {
  const limit = safeJsonLengthLimit(maxChars);
  let chars = 2;
  if (chars > limit) {
    return undefined;
  }
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    let added: number;
    if (code === 0x22 || code === 0x5c ||
      code === 0x08 || code === 0x09 || code === 0x0a ||
      code === 0x0c || code === 0x0d) {
      added = 2;
    } else if (code <= 0x1f) {
      added = 6;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = index + 1 < value.length ? value.charCodeAt(index + 1) : -1;
      if (next >= 0xdc00 && next <= 0xdfff) {
        added = 2;
        index++;
      } else {
        added = 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      added = 6;
    } else {
      added = 1;
    }
    if (added > limit - chars) {
      return undefined;
    }
    chars += added;
  }
  return chars;
}

export function kxResultJsonStringUtf8ByteLength(
  value: string,
  maxBytes = Number.MAX_SAFE_INTEGER
): number | undefined {
  const limit = safeJsonLengthLimit(maxBytes);
  let bytes = 2;
  if (bytes > limit) {
    return undefined;
  }
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    let added: number;
    if (code === 0x22 || code === 0x5c ||
      code === 0x08 || code === 0x09 || code === 0x0a ||
      code === 0x0c || code === 0x0d) {
      added = 2;
    } else if (code <= 0x1f) {
      added = 6;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = index + 1 < value.length ? value.charCodeAt(index + 1) : -1;
      if (next >= 0xdc00 && next <= 0xdfff) {
        added = 4;
        index++;
      } else {
        added = 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      added = 6;
    } else if (code <= 0x7f) {
      added = 1;
    } else if (code <= 0x7ff) {
      added = 2;
    } else {
      added = 3;
    }
    if (added > limit - bytes) {
      return undefined;
    }
    bytes += added;
  }
  return bytes;
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return String(value);
  }

  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return null;
  }

  return value;
}

function jsonValueCharacterLength(
  input: unknown,
  key: string,
  limit: number,
  stack: Set<object>,
  depth: number
): number | undefined {
  if (depth > 512) {
    throw new RangeError('KX result JSON nesting exceeds the safe depth limit');
  }
  let value = input;
  if ((typeof value === 'object' && value !== null) ||
    typeof value === 'function' ||
    typeof value === 'bigint') {
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === 'function') {
      value = toJSON.call(value, key);
    }
  }
  value = jsonReplacer(key, value);

  if (value === null) {
    return boundedJsonPrimitiveLength(4, limit);
  }
  switch (typeof value) {
    case 'string':
      return kxResultJsonStringCharacterLength(value, limit);
    case 'number':
      return boundedJsonPrimitiveLength(
        Number.isFinite(value) ? String(value).length : 4,
        limit
      );
    case 'boolean':
      return boundedJsonPrimitiveLength(value ? 4 : 5, limit);
    case 'undefined':
    case 'function':
    case 'symbol':
      return boundedJsonPrimitiveLength(4, limit);
    case 'bigint':
      return kxResultJsonStringCharacterLength(String(value), limit);
  }

  const object = value as object;
  if (object instanceof Number) {
    const number = Number.prototype.valueOf.call(object);
    return boundedJsonPrimitiveLength(
      Number.isFinite(number) ? String(number).length : 4,
      limit
    );
  }
  if (object instanceof String) {
    return kxResultJsonStringCharacterLength(
      String.prototype.valueOf.call(object),
      limit
    );
  }
  if (object instanceof Boolean) {
    return boundedJsonPrimitiveLength(
      Boolean.prototype.valueOf.call(object) ? 4 : 5,
      limit
    );
  }
  if (object instanceof BigInt) {
    BigInt.prototype.valueOf.call(object);
    throw new TypeError('Do not know how to serialize a BigInt');
  }
  if (stack.has(object)) {
    throw new TypeError('Converting circular structure to JSON');
  }

  stack.add(object);
  try {
    if (Array.isArray(object)) {
      return jsonArrayCharacterLength(object, limit, stack, depth);
    }
    return jsonObjectCharacterLength(
      object as { [key: string]: unknown },
      limit,
      stack,
      depth
    );
  } finally {
    stack.delete(object);
  }
}

function jsonArrayCharacterLength(
  value: unknown[],
  limit: number,
  stack: Set<object>,
  depth: number
): number | undefined {
  let chars = 2;
  if (chars > limit) {
    return undefined;
  }
  const length = safeJsonArrayLength(value.length);
  for (let index = 0; index < length; index++) {
    if (index > 0) {
      const withSeparator = addJsonLength(chars, 1, limit);
      if (withSeparator === undefined) {
        return undefined;
      }
      chars = withSeparator;
    }
    const remaining = limit - chars;
    const itemChars = jsonValueCharacterLength(
      value[index],
      String(index),
      remaining,
      stack,
      depth + 1
    );
    if (itemChars === undefined) {
      return undefined;
    }
    chars += itemChars;
  }
  return chars;
}

function jsonObjectCharacterLength(
  value: { [key: string]: unknown },
  limit: number,
  stack: Set<object>,
  depth: number
): number | undefined {
  let chars = 2;
  let properties = 0;
  if (chars > limit) {
    return undefined;
  }
  for (const property in value) {
    if (!Object.prototype.hasOwnProperty.call(value, property)) {
      continue;
    }
    const keyChars = kxResultJsonStringCharacterLength(
      property,
      limit - chars
    );
    if (keyChars === undefined) {
      return undefined;
    }
    const withKey = addJsonLength(
      chars,
      keyChars + 1 + (properties > 0 ? 1 : 0),
      limit
    );
    if (withKey === undefined) {
      return undefined;
    }
    chars = withKey;
    const itemChars = jsonValueCharacterLength(
      value[property],
      property,
      limit - chars,
      stack,
      depth + 1
    );
    if (itemChars === undefined) {
      return undefined;
    }
    chars += itemChars;
    properties++;
  }
  return chars;
}

function addJsonLength(
  current: number,
  added: number,
  limit: number
): number | undefined {
  return added <= limit - current ? current + added : undefined;
}

function boundedJsonPrimitiveLength(length: number, limit: number): number | undefined {
  return length <= limit ? length : undefined;
}

function safeJsonLengthLimit(value: number): number {
  return Number.isSafeInteger(value) && value >= 0
    ? value
    : Number.MAX_SAFE_INTEGER;
}

function safeJsonArrayLength(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value));
}

function escapeCsvCell(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return /[",\r\n]/.test(value) ? `"${escaped}"` : escaped;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case '\'':
        return '&#39;';
    }
    return char;
  });
}

function escapeMarkdownTableCell(value: unknown, options?: CellTextOptions): string {
  return cellValueToReadableText(value, options)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r\n|\r|\n/g, '<br>');
}

function markdownTableRow(values: string[]): string {
  return `| ${values.join(' | ')} |`;
}

function markdownTableSeparator(columnCount: number): string {
  const separators: string[] = [];
  for (let index = 0; index < columnCount; index++) {
    separators.push('---');
  }
  return markdownTableRow(separators);
}

function sanitizeTsvCell(value: string): string {
  return value.replace(/\r\n|\r|\n|\t/g, ' ');
}

function emptyCellWindow(): CellWindow {
  return {
    startRow: 0,
    endRow: -1,
    startColumn: 0,
    endColumn: -1,
    cells: [],
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.floor(value), min), max);
}

function nonNegativeCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}
