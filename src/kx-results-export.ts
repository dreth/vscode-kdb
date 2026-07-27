import JSZip = require('jszip');
import {
  CellRange,
  CellTextOptions,
  ColumnarPanelResult,
  ExportFormat,
  TextExportFormat,
  cellValueToBoundedText,
  cellValueToText,
  exportShape,
  kxResultJsonStringUtf8ByteLength,
  rowIndexColumnName,
  validateXlsxSheetLimits,
} from './kx-results';
import {
  KX_RESULT_EXPORT_FORMATS,
  KxResultExportFormatDefinition,
} from './results-ui-contract';

export { KX_RESULT_EXPORT_FORMATS } from './results-ui-contract';
export type { KxResultExportFormatDefinition } from './results-ui-contract';

export const CHART_PNG_DATA_URL_PREFIX = 'data:image/png;base64,';
export const CHART_EXPORT_MAX_BYTES = 50 * 1024 * 1024;
export const COPY_EXPORT_CONFIRM_BYTES = 50 * 1024 * 1024;

const COPY_EXPORT_CONFIRM_CELL_THRESHOLD = 1_000_000;
const COPY_EXPORT_SAMPLE_ROWS = 32;
const COPY_EXPORT_SAMPLE_COLUMNS = 12;
const COPY_EXPORT_SAMPLE_CELL_MAX_CHARS = 65_536;

const ALTERNATE_EXPORT_EXTENSIONS: Partial<Record<ExportFormat, readonly string[]>> = {
  html: ['htm'],
  markdown: ['markdown'],
};
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface CopyExportEstimate {
  selectedRows: number;
  selectedColumns: number;
  outputRows: number;
  outputColumns: number;
  selectedCells: number;
  outputCells: number;
  estimatedBytes: number;
}

export function normalizeKxResultExportFormat(value: unknown): ExportFormat {
  return exportFormatDefinition(value)?.value ?? 'csv';
}

export function normalizeKxResultTextExportFormat(value: unknown): TextExportFormat {
  const definition = exportFormatDefinition(value);
  return definition && definition.copy && definition.value !== 'xlsx'
    ? definition.value
    : 'csv';
}

export function kxResultExportFileExtension(format: ExportFormat): string {
  return requiredExportFormatDefinition(format).extension;
}

export function kxResultExportSaveFilters(format: ExportFormat): Record<string, string[]> {
  const definition = requiredExportFormatDefinition(format);
  return {
    [definition.label]: [
      definition.extension,
      ...(ALTERNATE_EXPORT_EXTENSIONS[format] ?? []),
    ],
  };
}

export function estimateCopyExport(
  result: ColumnarPanelResult,
  range: CellRange,
  format: ExportFormat,
  includeHeaders: boolean,
  includeRowIndex: boolean,
  cellTextOptions: CellTextOptions = {}
): CopyExportEstimate {
  const shape = exportShape(range, { includeHeaders, includeRowIndex });
  const cellEstimate = estimateAverageCellBytes(
    result,
    range,
    shape.selectedRows,
    shape.selectedColumns,
    cellTextOptions
  );
  const estimatedDataBytes = cellEstimate.saturated
    ? COPY_EXPORT_CONFIRM_BYTES
    : shape.selectedCells *
      (cellEstimate.averageBytes + formatCellOverhead(format));
  const structuredKeys = format === 'json' || format === 'ndjson';
  const estimatedHeaderBytes = structuredKeys
    ? estimateJsonObjectKeyBytes(
      result,
      range,
      includeRowIndex,
      shape.selectedRows
    )
    : includeHeaders
      ? estimateHeaderBytes(result, range, includeRowIndex) +
        shape.outputColumns * formatCellOverhead(format)
      : 0;
  const estimatedRowIndexBytes =
    includeRowIndex ? estimateRowIndexBytes(range, shape.selectedRows) : 0;
  const estimatedBytes = Math.ceil(
    estimatedDataBytes +
    estimatedHeaderBytes +
    estimatedRowIndexBytes +
    shape.outputRows * formatRowOverhead(format) +
    formatDocumentOverhead(format)
  );

  return {
    selectedRows: shape.selectedRows,
    selectedColumns: shape.selectedColumns,
    outputRows: shape.outputRows,
    outputColumns: shape.outputColumns,
    selectedCells: shape.selectedCells,
    outputCells: shape.outputCells,
    estimatedBytes,
  };
}

export function largeCopyExportConfirmationMessage(
  action: 'copy' | 'export',
  format: ExportFormat,
  estimate: CopyExportEstimate,
  confirmCellThreshold = COPY_EXPORT_CONFIRM_CELL_THRESHOLD
): string | undefined {
  if (
    estimate.selectedCells < confirmCellThreshold &&
    estimate.estimatedBytes < COPY_EXPORT_CONFIRM_BYTES
  ) {
    return undefined;
  }

  const actionLabel = action === 'copy' ? 'Copy' : 'Export';
  return `${actionLabel} ${format.toUpperCase()} selection is large: ` +
    `${formatCount(estimate.selectedRows)} rows x ` +
    `${formatCount(estimate.selectedColumns)} columns ` +
    `(${formatCount(estimate.selectedCells)} cells; ` +
    `estimated ${formatBytes(estimate.estimatedBytes)}). Continue?`;
}

export function chartPngBytesFromDataUrl(value: unknown): Uint8Array {
  if (typeof value !== 'string' || !value.startsWith(CHART_PNG_DATA_URL_PREFIX)) {
    throw new Error('Chart export requires a PNG data URL.');
  }

  const base64 = value.slice(CHART_PNG_DATA_URL_PREFIX.length);
  if (base64.length === 0 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error('Invalid chart PNG data URL.');
  }

  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const decodedBytes = base64.length / 4 * 3 - padding;
  if (decodedBytes > CHART_EXPORT_MAX_BYTES) {
    throw new Error(`Chart PNG export is too large: ${formatBytes(decodedBytes)}.`);
  }

  const content = Buffer.from(base64, 'base64');
  if (content.length < PNG_SIGNATURE.length) {
    throw new Error('Invalid chart PNG data.');
  }
  for (let index = 0; index < PNG_SIGNATURE.length; index++) {
    if (content[index] !== PNG_SIGNATURE[index]) {
      throw new Error('Invalid chart PNG data.');
    }
  }
  return content;
}

export async function columnarToXlsx(
  result: ColumnarPanelResult,
  range: CellRange,
  includeHeaders: boolean,
  includeRowIndex: boolean,
  cellTextOptions: CellTextOptions = {}
): Promise<Uint8Array> {
  const limitError = validateXlsxSheetLimits(range, { includeHeaders, includeRowIndex });
  if (limitError) {
    throw new Error(limitError);
  }

  const zip = new JSZip();
  zip.file('[Content_Types].xml', xmlDeclaration() +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>');
  zip.file('_rels/.rels', xmlDeclaration() +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>');
  zip.file('xl/workbook.xml', xmlDeclaration() +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Results" sheetId="1" r:id="rId1"/></sheets>' +
    '</workbook>');
  zip.file('xl/_rels/workbook.xml.rels', xmlDeclaration() +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>');
  zip.file('xl/styles.xml', stylesXml());
  zip.file('xl/worksheets/sheet1.xml', sheetXml(result, range, includeHeaders, includeRowIndex, cellTextOptions));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

function exportFormatDefinition(value: unknown): KxResultExportFormatDefinition | undefined {
  return KX_RESULT_EXPORT_FORMATS.find(definition => definition.value === value);
}

function requiredExportFormatDefinition(format: ExportFormat): KxResultExportFormatDefinition {
  const definition = exportFormatDefinition(format);
  if (!definition) {
    throw new Error(`Unsupported KX result export format: ${String(format)}`);
  }
  return definition;
}

export function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCount(count: number): string {
  return String(Math.floor(count)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function estimateAverageCellBytes(
  result: ColumnarPanelResult,
  range: CellRange,
  selectedRows: number,
  selectedColumns: number,
  cellTextOptions: CellTextOptions
): { averageBytes: number; saturated: boolean } {
  if (selectedRows <= 0 || selectedColumns <= 0) {
    return { averageBytes: 4, saturated: false };
  }

  const sampledRows = Math.min(selectedRows, COPY_EXPORT_SAMPLE_ROWS);
  const sampledColumns = Math.min(selectedColumns, COPY_EXPORT_SAMPLE_COLUMNS);
  const rowStep = Math.max(1, Math.floor(selectedRows / sampledRows));
  const columnStep = Math.max(1, Math.floor(selectedColumns / sampledColumns));
  let sampledCells = 0;
  let sampledBytes = 0;

  for (
    let rowOffset = 0;
    rowOffset < selectedRows && sampledCells < sampledRows * sampledColumns;
    rowOffset += rowStep
  ) {
    const rowIndex = Math.min(range.endRow, range.startRow + rowOffset);
    for (
      let columnOffset = 0;
      columnOffset < selectedColumns && sampledCells < sampledRows * sampledColumns;
      columnOffset += columnStep
    ) {
      const columnIndex = Math.min(range.endColumn, range.startColumn + columnOffset);
      const rendered = cellValueToBoundedText(
        result.cellValue(rowIndex, columnIndex),
        COPY_EXPORT_SAMPLE_CELL_MAX_CHARS,
        cellTextOptions
      );
      if (rendered.truncated) {
        return {
          averageBytes: COPY_EXPORT_SAMPLE_CELL_MAX_CHARS,
          saturated: true,
        };
      }
      sampledBytes += Buffer.byteLength(rendered.text, 'utf8');
      sampledCells += 1;
    }
  }

  return {
    averageBytes: sampledCells > 0
      ? Math.max(4, sampledBytes / sampledCells)
      : 4,
    saturated: false,
  };
}

function estimateHeaderBytes(
  result: ColumnarPanelResult,
  range: CellRange,
  includeRowIndex: boolean
): number {
  let bytes = includeRowIndex
    ? Buffer.byteLength(rowIndexColumnName(result.columns, range), 'utf8')
    : 0;
  for (let columnIndex = range.startColumn; columnIndex <= range.endColumn; columnIndex++) {
    bytes += Buffer.byteLength(result.columns[columnIndex], 'utf8');
  }
  return bytes;
}

function estimateJsonObjectKeyBytes(
  result: ColumnarPanelResult,
  range: CellRange,
  includeRowIndex: boolean,
  selectedRows: number
): number {
  if (selectedRows <= 0) {
    return 0;
  }
  const perRowLimit = Math.max(
    1,
    Math.ceil(COPY_EXPORT_CONFIRM_BYTES / selectedRows)
  );
  let bytes = 0;
  let names = 0;
  const addName = (name: string): boolean => {
    const punctuation = 1 + (names > 0 ? 1 : 0);
    if (punctuation > perRowLimit - bytes) {
      return false;
    }
    bytes += punctuation;
    const encodedBytes = kxResultJsonStringUtf8ByteLength(
      String(name),
      perRowLimit - bytes
    );
    if (encodedBytes === undefined) {
      return false;
    }
    bytes += encodedBytes;
    names++;
    return bytes < perRowLimit;
  };

  if (includeRowIndex &&
    !addName(rowIndexColumnName(result.columns, range))) {
    return COPY_EXPORT_CONFIRM_BYTES;
  }
  for (let columnIndex = range.startColumn;
    columnIndex <= range.endColumn;
    columnIndex++) {
    if (!addName(result.columns[columnIndex])) {
      return COPY_EXPORT_CONFIRM_BYTES;
    }
  }
  return Math.min(COPY_EXPORT_CONFIRM_BYTES, bytes * selectedRows);
}

function estimateRowIndexBytes(range: CellRange, selectedRows: number): number {
  if (selectedRows <= 0) {
    return 0;
  }
  const first = range.startRow + 1;
  const last = range.endRow + 1;
  const averageDigits = (String(first).length + String(last).length) / 2;
  return Math.ceil(selectedRows * averageDigits);
}

function formatCellOverhead(format: ExportFormat): number {
  switch (format) {
    case 'html':
      return 18;
    case 'json':
    case 'ndjson':
      return 10;
    case 'markdown':
      return 4;
    case 'xlsx':
      return 64;
    case 'csv':
    case 'tsv':
      return 2;
  }
}

function formatRowOverhead(format: ExportFormat): number {
  switch (format) {
    case 'html':
      return 12;
    case 'markdown':
      return 4;
    case 'json':
      return 4;
    case 'xlsx':
      return 18;
    case 'csv':
    case 'tsv':
    case 'ndjson':
      return 1;
  }
}

function formatDocumentOverhead(format: ExportFormat): number {
  switch (format) {
    case 'html':
      return 64;
    case 'markdown':
      return 32;
    case 'xlsx':
      return 2048;
    case 'json':
      return 2;
    case 'csv':
    case 'tsv':
    case 'ndjson':
      return 0;
  }
}

function sheetXml(
  result: ColumnarPanelResult,
  range: CellRange,
  includeHeaders: boolean,
  includeRowIndex: boolean,
  cellTextOptions: CellTextOptions
): string {
  const selectedRows = range.endRow - range.startRow + 1;
  const selectedColumns = range.endColumn - range.startColumn + 1 + (includeRowIndex ? 1 : 0);
  const outputRows = selectedRows + (includeHeaders ? 1 : 0);
  const dimension = `A1:${excelColumnName(selectedColumns - 1)}${Math.max(outputRows, 1)}`;
  return xmlDeclaration() +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="${dimension}"/>` +
    '<sheetData>' +
    sheetRowsXml(result, range, includeHeaders, includeRowIndex, cellTextOptions) +
    '</sheetData>' +
    '</worksheet>';
}

function sheetRowsXml(
  result: ColumnarPanelResult,
  range: CellRange,
  includeHeaders: boolean,
  includeRowIndex: boolean,
  cellTextOptions: CellTextOptions
): string {
  const parts: string[] = [];
  let outputRow = 1;
  if (includeHeaders) {
    const headers: string[] = [];
    if (includeRowIndex) {
      headers.push(cellValueToText(rowIndexColumnName(result.columns, range)));
    }
    for (let columnIndex = range.startColumn; columnIndex <= range.endColumn; columnIndex++) {
      headers.push(cellValueToText(result.columns[columnIndex]));
    }
    parts.push(sheetRowXml(outputRow, headers));
    outputRow += 1;
  }

  for (let rowIndex = range.startRow; rowIndex <= range.endRow; rowIndex++) {
    const values: string[] = [];
    if (includeRowIndex) {
      values.push(String(rowIndex + 1));
    }
    for (let columnIndex = range.startColumn; columnIndex <= range.endColumn; columnIndex++) {
      values.push(result.cellText(rowIndex, columnIndex, cellTextOptions));
    }
    parts.push(sheetRowXml(outputRow, values));
    outputRow += 1;
  }
  return parts.join('');
}

function sheetRowXml(rowNumber: number, values: string[]): string {
  const parts = [`<row r="${rowNumber}">`];
  for (let columnIndex = 0; columnIndex < values.length; columnIndex++) {
    parts.push(textCellXml(excelCellRef(columnIndex, rowNumber), values[columnIndex]));
  }
  parts.push('</row>');
  return parts.join('');
}

function textCellXml(ref: string, value: string): string {
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function excelCellRef(columnIndex: number, rowNumber: number): string {
  return `${excelColumnName(columnIndex)}${rowNumber}`;
}

function excelColumnName(columnIndex: number): string {
  let value = columnIndex + 1;
  let name = '';
  while (value > 0) {
    const modulo = (value - 1) % 26;
    name = String.fromCharCode(65 + modulo) + name;
    value = Math.floor((value - modulo) / 26);
  }
  return name;
}

function stylesXml(): string {
  return xmlDeclaration() +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
    '<borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';
}

function xmlDeclaration(): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
}

function escapeXml(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F&<>"']/g, char => {
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
        return '&apos;';
    }
    return '';
  });
}
