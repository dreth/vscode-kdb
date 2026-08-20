import JSZip = require('jszip');
import { Readable } from 'stream';
import {
  CellRange,
  CellTextOptions,
  ColumnarPanelResult,
  ExportFormat,
  TextExportFormat,
  cellValueToAnalystValue,
  cellValueToBoundedExportText,
  exportShape,
  kxResultJsonStringUtf8ByteLength,
  kxResultJsonStringify,
  rowIndexColumnName,
  validateXlsxSheetLimits,
} from './kx-results';
import { isQAtom, isQGeneralNull, isQVector } from './q-value';
import {
  KX_RESULT_EXPORT_FORMATS,
  KxResultExportFormatDefinition,
} from './results-ui-contract';

export { KX_RESULT_EXPORT_FORMATS } from './results-ui-contract';
export type { KxResultExportFormatDefinition } from './results-ui-contract';

export const CHART_PNG_DATA_URL_PREFIX = 'data:image/png;base64,';
export const CHART_EXPORT_MAX_BYTES = 50 * 1024 * 1024;
export const COPY_EXPORT_CONFIRM_BYTES = 50 * 1024 * 1024;
export const KX_RESULT_FILE_EXPORT_MAX_CELLS = 5_000_000;
export const KX_RESULT_FILE_EXPORT_MAX_COLUMNS = 100_000;
export const KX_RESULT_TEXT_EXPORT_MAX_BYTES = 128 * 1024 * 1024;
export const KX_RESULT_TEXT_EXPORT_MAX_CELL_CHARACTERS = 8 * 1024 * 1024;
export const KX_RESULT_XLSX_EXPORT_MAX_CELLS = 1_000_000;
export const KX_RESULT_XLSX_WORKSHEET_XML_MAX_BYTES = 64 * 1024 * 1024;
export const XLSX_MAX_CELL_CHARACTERS = 32_767;

const COPY_EXPORT_CONFIRM_CELL_THRESHOLD = 1_000_000;
const COPY_EXPORT_SAMPLE_ROWS = 32;
const COPY_EXPORT_SAMPLE_COLUMNS = 12;
const COPY_EXPORT_SAMPLE_CELL_MAX_CHARS = 65_536;
const XLSX_MIN_NORMAL_NUMBER = 2.2250738585072014e-308;
const XLSX_MAX_SIGNIFICANT_DIGITS = 15;

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

export interface KxResultTextExportHardLimits {
  maxBytes?: number;
  maxOutputCells?: number;
  maxOutputColumns?: number;
  maxCellCharacters?: number;
}

export interface KxResultXlsxExportHardLimits {
  maxOutputCells?: number;
  maxWorksheetXmlBytes?: number;
}

export type KxResultExportLimitKind =
  | 'textBytes'
  | 'outputCells'
  | 'outputColumns'
  | 'cellCharacters'
  | 'xlsxXmlBytes';

export class KxResultExportLimitError extends Error {
  public readonly kind: KxResultExportLimitKind;

  public constructor(kind: KxResultExportLimitKind, message: string) {
    super(message);
    this.name = 'KxResultExportLimitError';
    this.kind = kind;
  }
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

/**
 * Builds a text file export without ever retaining a whole-result string and
 * its encoded Buffer at the same time. The first pass measures the exact UTF-8
 * per-cell/syntax fragments; the second fills one right-sized Buffer. Hard limits are
 * checked before that whole-result allocation.
 */
export function columnarToTextBytes(
  result: ColumnarPanelResult,
  range: CellRange,
  format: TextExportFormat,
  includeHeaders: boolean,
  includeRowIndex: boolean,
  hardLimits: KxResultTextExportHardLimits = {},
  cellTextOptions: CellTextOptions = {}
): Uint8Array {
  const limits = normalizedTextExportHardLimits(hardLimits);
  const shape = exportShape(range, {
    includeHeaders: includeHeaders && format !== 'json' && format !== 'ndjson',
    includeRowIndex,
  });
  assertFileExportCellLimit(
    format,
    shape.outputCells,
    limits.maxOutputCells
  );
  assertFileExportColumnLimit(format, shape.outputColumns, limits.maxOutputColumns);
  let realizedBytes = 0;
  for (const segment of columnarTextExportSegments(
    result,
    range,
    format,
    includeHeaders,
    includeRowIndex,
    limits.maxCellCharacters,
    limits.maxBytes,
    cellTextOptions,
    true
  )) {
    const segmentBytes = Buffer.byteLength(segment, 'utf8');
    if (segmentBytes > limits.maxBytes - realizedBytes) {
      throw textExportByteLimitError(format, limits.maxBytes);
    }
    realizedBytes += segmentBytes;
  }

  const content = Buffer.allocUnsafe(realizedBytes);
  let offset = 0;
  for (const segment of columnarTextExportSegments(
    result,
    range,
    format,
    includeHeaders,
    includeRowIndex,
    limits.maxCellCharacters,
    limits.maxBytes,
    cellTextOptions,
    false
  )) {
    const segmentBytes = Buffer.byteLength(segment, 'utf8');
    if (segmentBytes > realizedBytes - offset) {
      throw changedDuringTextExportError(format);
    }
    const written = content.write(segment, offset, segmentBytes, 'utf8');
    if (written !== segmentBytes) {
      throw changedDuringTextExportError(format);
    }
    offset += written;
  }
  if (offset !== realizedBytes) {
    throw changedDuringTextExportError(format);
  }
  return content;
}

export async function columnarToXlsx(
  result: ColumnarPanelResult,
  range: CellRange,
  includeHeaders: boolean,
  includeRowIndex: boolean,
  cellTextOptions: CellTextOptions = {},
  hardLimits: KxResultXlsxExportHardLimits = {}
): Promise<Uint8Array> {
  const limitError = validateXlsxSheetLimits(range, { includeHeaders, includeRowIndex });
  if (limitError) {
    throw new Error(
      `${limitError} Export a smaller row/column range, hide columns, or split ` +
      'the result. No partial file was written.'
    );
  }

  const limits = normalizedXlsxExportHardLimits(hardLimits);
  assertFileExportCellLimit(
    'xlsx',
    exportShape(range, { includeHeaders, includeRowIndex }).outputCells,
    limits.maxOutputCells
  );
  measureXlsxWorksheetXml(
    result,
    range,
    includeHeaders,
    includeRowIndex,
    cellTextOptions,
    limits.maxWorksheetXmlBytes
  );

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
  zip.file(
    'xl/worksheets/sheet1.xml',
    Readable.from(boundedXlsxWorksheetXmlSegments(
      result,
      range,
      includeHeaders,
      includeRowIndex,
      cellTextOptions,
      limits.maxWorksheetXmlBytes
    )),
    { binary: false }
  );
  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    streamFiles: true,
  });
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

interface NormalizedTextExportHardLimits {
  maxBytes: number;
  maxOutputCells: number;
  maxOutputColumns: number;
  maxCellCharacters: number;
}

interface NormalizedXlsxExportHardLimits {
  maxOutputCells: number;
  maxWorksheetXmlBytes: number;
}

function normalizedTextExportHardLimits(
  limits: KxResultTextExportHardLimits
): NormalizedTextExportHardLimits {
  return {
    maxBytes: positiveIntegerHardLimit(
      limits.maxBytes,
      KX_RESULT_TEXT_EXPORT_MAX_BYTES
    ),
    maxOutputCells: positiveIntegerHardLimit(
      limits.maxOutputCells,
      KX_RESULT_FILE_EXPORT_MAX_CELLS
    ),
    maxOutputColumns: positiveIntegerHardLimit(
      limits.maxOutputColumns,
      KX_RESULT_FILE_EXPORT_MAX_COLUMNS
    ),
    maxCellCharacters: positiveIntegerHardLimit(
      limits.maxCellCharacters,
      KX_RESULT_TEXT_EXPORT_MAX_CELL_CHARACTERS
    ),
  };
}

function normalizedXlsxExportHardLimits(
  limits: KxResultXlsxExportHardLimits
): NormalizedXlsxExportHardLimits {
  return {
    maxOutputCells: positiveIntegerHardLimit(
      limits.maxOutputCells,
      KX_RESULT_XLSX_EXPORT_MAX_CELLS
    ),
    maxWorksheetXmlBytes: positiveIntegerHardLimit(
      limits.maxWorksheetXmlBytes,
      KX_RESULT_XLSX_WORKSHEET_XML_MAX_BYTES
    ),
  };
}

function positiveIntegerHardLimit(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;
}

function assertFileExportCellLimit(
  format: ExportFormat,
  outputCells: number,
  maxOutputCells: number
): void {
  if (Number.isSafeInteger(outputCells) && outputCells <= maxOutputCells) {
    return;
  }
  throw new KxResultExportLimitError('outputCells',
    `${format.toUpperCase()} file export exceeds the hard ` +
    `${formatCount(maxOutputCells)}-cell limit ` +
    `(${formatCount(outputCells)} output cells requested). ` +
    'Export a smaller row/column range, hide columns, or split the result. ' +
    'No partial file was written.'
  );
}

function assertFileExportColumnLimit(
  format: TextExportFormat,
  outputColumns: number,
  maxOutputColumns: number
): void {
  if (Number.isSafeInteger(outputColumns) && outputColumns <= maxOutputColumns) {
    return;
  }
  throw new KxResultExportLimitError('outputColumns',
    `${format.toUpperCase()} file export exceeds the hard ` +
    `${formatCount(maxOutputColumns)}-column limit ` +
    `(${formatCount(outputColumns)} output columns requested). ` +
    'Export a smaller column range, hide columns, or split the result. ' +
    'No partial file was written.'
  );
}

function textExportByteLimitError(
  format: TextExportFormat,
  maxBytes: number
): Error {
  return new KxResultExportLimitError('textBytes',
    `${format.toUpperCase()} file export exceeds the hard ` +
    `${formatBytes(maxBytes)} realized UTF-8 limit. ` +
    'Export a smaller row/column range, hide columns, or split the result. ' +
    'No partial file was written.'
  );
}

function changedDuringTextExportError(format: TextExportFormat): Error {
  return new Error(
    `${format.toUpperCase()} file export changed while it was being encoded. ` +
    'Run the export again after the displayed result has settled. ' +
    'No partial file was written.'
  );
}

function textExportCellText(
  value: unknown,
  format: TextExportFormat,
  location: string,
  maxCellCharacters: number,
  cellTextOptions: CellTextOptions
): string {
  const rendered = cellValueToBoundedExportText(
    value,
    maxCellCharacters + 1,
    cellTextOptions
  );
  if (!rendered.truncated && rendered.text.length <= maxCellCharacters) {
    return rendered.text;
  }
  throw new KxResultExportLimitError('cellCharacters',
    `${format.toUpperCase()} file export ${location} exceeds the hard ` +
    `${formatCount(maxCellCharacters)}-character analyst-text limit. ` +
    'Export a smaller row/column range, hide the column, or reduce the source value. ' +
    'No partial file was written.'
  );
}

function* columnarTextExportSegments(
  result: ColumnarPanelResult,
  range: CellRange,
  format: TextExportFormat,
  includeHeaders: boolean,
  includeRowIndex: boolean,
  maxCellCharacters: number,
  maxBytes: number,
  cellTextOptions: CellTextOptions,
  validateCellLimits: boolean
): Generator<string> {
  const selectedRows = Math.max(0, range.endRow - range.startRow + 1);
  const selectedColumns = Math.max(0, range.endColumn - range.startColumn + 1);
  if (selectedRows === 0 || selectedColumns === 0) {
    yield format === 'json' ? '[]' : '';
    return;
  }

  if (format === 'json' || format === 'ndjson') {
    yield* structuredTextExportSegments(
      result,
      range,
      format,
      includeRowIndex,
      maxCellCharacters,
      maxBytes,
      cellTextOptions,
      validateCellLimits
    );
    return;
  }
  if (format === 'html') {
    yield* htmlTextExportSegments(
      result,
      range,
      includeHeaders,
      includeRowIndex,
      maxCellCharacters,
      cellTextOptions,
      validateCellLimits
    );
    return;
  }
  if (format === 'markdown') {
    yield* markdownTextExportSegments(
      result,
      range,
      includeHeaders,
      includeRowIndex,
      maxCellCharacters,
      cellTextOptions,
      validateCellLimits
    );
    return;
  }
  yield* delimitedTextExportSegments(
    result,
    range,
    format,
    includeHeaders,
    includeRowIndex,
    maxCellCharacters,
    cellTextOptions,
    validateCellLimits
  );
}

function* structuredTextExportSegments(
  result: ColumnarPanelResult,
  range: CellRange,
  format: 'json' | 'ndjson',
  includeRowIndex: boolean,
  maxCellCharacters: number,
  maxBytes: number,
  cellTextOptions: CellTextOptions,
  _validateCellLimits: boolean
): Generator<string> {
  const indexName = includeRowIndex
    ? rowIndexColumnName(result.columns, range)
    : '';
  const entries: Array<{ key: string; columnIndex: number | null }> = [];
  const used = new Set<string>();
  let minimumRowBytes = 2;
  const addEntry = (
    key: string,
    columnIndex: number | null,
    location: string
  ): void => {
    textExportCellText(
      key,
      format,
      location,
      maxCellCharacters,
      cellTextOptions
    );
    const encodedKeyBytes = kxResultJsonStringUtf8ByteLength(
      key,
      Math.max(0, maxBytes - minimumRowBytes)
    );
    const punctuationAndMinimumValueBytes = 2 + (entries.length > 0 ? 1 : 0);
    if (encodedKeyBytes === undefined ||
      encodedKeyBytes > maxBytes - minimumRowBytes - punctuationAndMinimumValueBytes) {
      throw textExportByteLimitError(format, maxBytes);
    }
    minimumRowBytes += encodedKeyBytes + punctuationAndMinimumValueBytes;
    used.add(key);
    entries.push({ key, columnIndex });
  };

  if (includeRowIndex) {
    addEntry(indexName, null, 'row-number key');
  }
  for (let columnIndex = range.startColumn;
    columnIndex <= range.endColumn;
    columnIndex++) {
    const base = String(result.columns[columnIndex] ?? '');
    let key = base;
    let suffix = 2;
    while (used.has(key)) {
      key = `${base}_${suffix}`;
      suffix += 1;
    }
    addEntry(
      key,
      columnIndex,
      `key at displayed column ${columnIndex + 1}`
    );
  }

  const entryOrdinalsByKey: Record<string, number> = Object.create(null) as Record<string, number>;
  entries.forEach((entry, ordinal) => {
    entryOrdinalsByKey[entry.key] = ordinal;
  });
  const orderedKeys = Object.keys(entryOrdinalsByKey);
  if (format === 'json') {
    yield '[';
  }
  for (let rowIndex = range.startRow; rowIndex <= range.endRow; rowIndex++) {
    if (rowIndex > range.startRow) {
      yield format === 'json' ? ',' : '\n';
    }
    yield '{';
    for (let outputColumn = 0; outputColumn < orderedKeys.length; outputColumn++) {
      if (outputColumn > 0) {
        yield ',';
      }
      const entry = entries[entryOrdinalsByKey[orderedKeys[outputColumn]]];
      let value: unknown;
      if (entry.columnIndex === null) {
        value = rowIndex + 1;
      } else {
        value = result.cellValue(rowIndex, entry.columnIndex);
        textExportCellText(
          value,
          format,
          `cell at displayed row ${rowIndex + 1}, column ${entry.columnIndex + 1}`,
          maxCellCharacters,
          cellTextOptions
        );
        value = cellValueToAnalystValue(value);
      }
      yield encodedJsonObjectProperty(entry.key, value, format);
    }
    yield '}';
  }
  if (format === 'json') {
    yield ']';
  }
}

function encodedJsonObjectProperty(
  key: string,
  value: unknown,
  format: 'json' | 'ndjson'
): string {
  const holder: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  holder[key] = value;
  const encoded = kxResultJsonStringify(holder);
  if (!encoded.startsWith('{') || !encoded.endsWith('}') || encoded === '{}') {
    throw changedDuringTextExportError(format);
  }
  return encoded.slice(1, -1);
}

function* delimitedTextExportSegments(
  result: ColumnarPanelResult,
  range: CellRange,
  format: 'csv' | 'tsv',
  includeHeaders: boolean,
  includeRowIndex: boolean,
  maxCellCharacters: number,
  cellTextOptions: CellTextOptions,
  _validateCellLimits: boolean
): Generator<string> {
  const delimiter = format === 'csv' ? ',' : '\t';
  let wroteRow = false;
  if (includeHeaders) {
    let outputColumn = 0;
    if (includeRowIndex) {
      yield escapedDelimitedExportCell(
        textExportCellText(
          rowIndexColumnName(result.columns, range),
          format,
          'row-number header',
          maxCellCharacters,
          cellTextOptions
        ),
        delimiter
      );
      outputColumn += 1;
    }
    for (let columnIndex = range.startColumn;
      columnIndex <= range.endColumn;
      columnIndex++) {
      if (outputColumn > 0) {
        yield delimiter;
      }
      yield escapedDelimitedExportCell(
        textExportCellText(
          result.columns[columnIndex],
          format,
          `header at displayed column ${columnIndex + 1}`,
          maxCellCharacters,
          cellTextOptions
        ),
        delimiter
      );
      outputColumn += 1;
    }
    wroteRow = true;
  }
  for (let rowIndex = range.startRow; rowIndex <= range.endRow; rowIndex++) {
    if (wroteRow) {
      yield '\n';
    }
    let outputColumn = 0;
    if (includeRowIndex) {
      yield String(rowIndex + 1);
      outputColumn += 1;
    }
    for (let columnIndex = range.startColumn;
      columnIndex <= range.endColumn;
      columnIndex++) {
      if (outputColumn > 0) {
        yield delimiter;
      }
      const location = `cell at displayed row ${rowIndex + 1}, column ${columnIndex + 1}`;
      const value = result.cellValue(rowIndex, columnIndex);
      const text = textExportCellText(
        value,
        format,
        location,
        maxCellCharacters,
        cellTextOptions
      );
      yield escapedDelimitedExportCell(text, delimiter);
      outputColumn += 1;
    }
    wroteRow = true;
  }
}

function escapedDelimitedExportCell(value: string, delimiter: ',' | '\t'): string {
  const escaped = value.replace(/"/g, '""');
  const requiresQuotes = delimiter === ','
    ? /[",\r\n]/.test(value)
    : /["\t\r\n]/.test(value);
  return requiresQuotes ? `"${escaped}"` : escaped;
}

function* htmlTextExportSegments(
  result: ColumnarPanelResult,
  range: CellRange,
  includeHeaders: boolean,
  includeRowIndex: boolean,
  maxCellCharacters: number,
  cellTextOptions: CellTextOptions,
  _validateCellLimits: boolean
): Generator<string> {
  yield '<table>';
  if (includeHeaders) {
    yield '<thead><tr>';
    if (includeRowIndex) {
      yield '<th>';
      yield escapedHtmlExportText(textExportCellText(
        rowIndexColumnName(result.columns, range),
        'html',
        'row-number header',
        maxCellCharacters,
        cellTextOptions
      ));
      yield '</th>';
    }
    for (let columnIndex = range.startColumn;
      columnIndex <= range.endColumn;
      columnIndex++) {
      yield '<th>';
      yield escapedHtmlExportText(textExportCellText(
        result.columns[columnIndex],
        'html',
        `header at displayed column ${columnIndex + 1}`,
        maxCellCharacters,
        cellTextOptions
      ));
      yield '</th>';
    }
    yield '</tr></thead>';
  }
  yield '<tbody>';
  for (let rowIndex = range.startRow; rowIndex <= range.endRow; rowIndex++) {
    yield '<tr>';
    if (includeRowIndex) {
      yield '<td>';
      yield String(rowIndex + 1);
      yield '</td>';
    }
    for (let columnIndex = range.startColumn;
      columnIndex <= range.endColumn;
      columnIndex++) {
      yield '<td>';
      yield escapedHtmlExportText(textExportCellText(
        result.cellValue(rowIndex, columnIndex),
        'html',
        `cell at displayed row ${rowIndex + 1}, column ${columnIndex + 1}`,
        maxCellCharacters,
        cellTextOptions
      ));
      yield '</td>';
    }
    yield '</tr>';
  }
  yield '</tbody></table>';
}

function escapedHtmlExportText(value: string): string {
  return value.replace(/[&<>"']/g, char => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
    }
    return char;
  });
}

function* markdownTextExportSegments(
  result: ColumnarPanelResult,
  range: CellRange,
  includeHeaders: boolean,
  includeRowIndex: boolean,
  maxCellCharacters: number,
  cellTextOptions: CellTextOptions,
  _validateCellLimits: boolean
): Generator<string> {
  const columnCount = range.endColumn - range.startColumn + 1 +
    (includeRowIndex ? 1 : 0);
  let wroteRow = false;
  if (includeHeaders) {
    yield '| ';
    let outputColumn = 0;
    if (includeRowIndex) {
      yield escapedMarkdownExportText(textExportCellText(
        rowIndexColumnName(result.columns, range),
        'markdown',
        'row-number header',
        maxCellCharacters,
        cellTextOptions
      ));
      outputColumn += 1;
    }
    for (let columnIndex = range.startColumn;
      columnIndex <= range.endColumn;
      columnIndex++) {
      if (outputColumn > 0) {
        yield ' | ';
      }
      yield escapedMarkdownExportText(textExportCellText(
        result.columns[columnIndex],
        'markdown',
        `header at displayed column ${columnIndex + 1}`,
        maxCellCharacters,
        cellTextOptions
      ));
      outputColumn += 1;
    }
    yield ' |\n| ';
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
      if (columnIndex > 0) {
        yield ' | ';
      }
      yield '---';
    }
    yield ' |';
    wroteRow = true;
  }
  for (let rowIndex = range.startRow; rowIndex <= range.endRow; rowIndex++) {
    if (wroteRow) {
      yield '\n';
    }
    yield '| ';
    let outputColumn = 0;
    if (includeRowIndex) {
      yield String(rowIndex + 1);
      outputColumn += 1;
    }
    for (let columnIndex = range.startColumn;
      columnIndex <= range.endColumn;
      columnIndex++) {
      if (outputColumn > 0) {
        yield ' | ';
      }
      yield escapedMarkdownExportText(textExportCellText(
        result.cellValue(rowIndex, columnIndex),
        'markdown',
        `cell at displayed row ${rowIndex + 1}, column ${columnIndex + 1}`,
        maxCellCharacters,
        cellTextOptions
      ));
      outputColumn += 1;
    }
    yield ' |';
    wroteRow = true;
  }
}

function escapedMarkdownExportText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\|/g, '\\|')
    .replace(/\r\n|\r|\n/g, '<br>');
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
      const rendered = cellValueToBoundedExportText(
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

function measureXlsxWorksheetXml(
  result: ColumnarPanelResult,
  range: CellRange,
  includeHeaders: boolean,
  includeRowIndex: boolean,
  cellTextOptions: CellTextOptions,
  maxWorksheetXmlBytes: number
): void {
  let bytes = 0;
  for (const segment of xlsxWorksheetXmlSegments(
    result,
    range,
    includeHeaders,
    includeRowIndex,
    cellTextOptions
  )) {
    const segmentBytes = Buffer.byteLength(segment, 'utf8');
    if (segmentBytes > maxWorksheetXmlBytes - bytes) {
      throw xlsxWorksheetXmlLimitError(maxWorksheetXmlBytes);
    }
    bytes += segmentBytes;
  }
}

function* boundedXlsxWorksheetXmlSegments(
  result: ColumnarPanelResult,
  range: CellRange,
  includeHeaders: boolean,
  includeRowIndex: boolean,
  cellTextOptions: CellTextOptions,
  maxWorksheetXmlBytes: number
): Generator<string> {
  let bytes = 0;
  for (const segment of xlsxWorksheetXmlSegments(
    result,
    range,
    includeHeaders,
    includeRowIndex,
    cellTextOptions
  )) {
    const segmentBytes = Buffer.byteLength(segment, 'utf8');
    if (segmentBytes > maxWorksheetXmlBytes - bytes) {
      throw xlsxWorksheetXmlLimitError(maxWorksheetXmlBytes);
    }
    bytes += segmentBytes;
    yield segment;
  }
}

function xlsxWorksheetXmlLimitError(maxWorksheetXmlBytes: number): Error {
  return new KxResultExportLimitError('xlsxXmlBytes',
    'XLSX file export exceeds the hard ' +
    `${formatBytes(maxWorksheetXmlBytes)} uncompressed worksheet XML limit. ` +
    'Export a smaller row/column range, hide columns, or split the result. ' +
    'No partial file was written.'
  );
}

function* xlsxWorksheetXmlSegments(
  result: ColumnarPanelResult,
  range: CellRange,
  includeHeaders: boolean,
  includeRowIndex: boolean,
  cellTextOptions: CellTextOptions
): Generator<string> {
  const selectedRows = range.endRow - range.startRow + 1;
  const selectedColumns = range.endColumn - range.startColumn + 1 + (includeRowIndex ? 1 : 0);
  const outputRows = selectedRows + (includeHeaders ? 1 : 0);
  const dimension = `A1:${excelColumnName(selectedColumns - 1)}${Math.max(outputRows, 1)}`;
  yield xmlDeclaration();
  yield '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
  yield `<dimension ref="${dimension}"/>`;
  yield '<sheetData>';

  let outputRow = 1;
  if (includeHeaders) {
    let outputColumn = 0;
    yield `<row r="${outputRow}">`;
    if (includeRowIndex) {
      yield xlsxCellXml(
        excelCellRef(outputColumn, outputRow),
        xlsxTextCell(
          rowIndexColumnName(result.columns, range),
          outputRow,
          outputColumn + 1
        )
      );
      outputColumn += 1;
    }
    for (let columnIndex = range.startColumn; columnIndex <= range.endColumn; columnIndex++) {
      yield xlsxCellXml(
        excelCellRef(outputColumn, outputRow),
        xlsxTextCell(
          result.columns[columnIndex],
          outputRow,
          outputColumn + 1
        )
      );
      outputColumn += 1;
    }
    yield '</row>';
    outputRow += 1;
  }

  for (let rowIndex = range.startRow; rowIndex <= range.endRow; rowIndex++) {
    let outputColumn = 0;
    yield `<row r="${outputRow}">`;
    if (includeRowIndex) {
      yield xlsxCellXml(
        excelCellRef(outputColumn, outputRow),
        { kind: 'number', value: String(rowIndex + 1) }
      );
      outputColumn += 1;
    }
    for (let columnIndex = range.startColumn; columnIndex <= range.endColumn; columnIndex++) {
      yield xlsxCellXml(
        excelCellRef(outputColumn, outputRow),
        xlsxCellValue(
          result.cellValue(rowIndex, columnIndex),
          outputRow,
          outputColumn + 1,
          cellTextOptions
        )
      );
      outputColumn += 1;
    }
    yield '</row>';
    outputRow += 1;
  }
  yield '</sheetData>';
  yield '</worksheet>';
}

type XlsxCellValue =
  | { kind: 'blank' }
  | { kind: 'number'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'text'; value: string };

function xlsxCellValue(
  value: unknown,
  outputRow: number,
  outputColumn: number,
  cellTextOptions: CellTextOptions = {}
): XlsxCellValue {
  let scalar = value;
  if (isQGeneralNull(value)) {
    scalar = null;
  } else if (isQAtom(value)) {
    scalar = cellValueToAnalystValue(value);
  } else if (isQVector(value)) {
    return xlsxTextCell(value, outputRow, outputColumn, cellTextOptions);
  } else if (value instanceof Date) {
    scalar = Number.isFinite(value.getTime()) ? value.toISOString() : String(value);
  } else if (typeof value === 'object' && value !== null) {
    return xlsxTextCell(value, outputRow, outputColumn, cellTextOptions);
  }

  if (scalar === null || scalar === undefined) {
    return { kind: 'blank' };
  }
  if (typeof scalar === 'number' && Number.isFinite(scalar)) {
    return xlsxSafeNumber(scalar)
      ? { kind: 'number', value: String(scalar) }
      : xlsxTextCell(
        Object.is(scalar, -0) ? '-0' : String(scalar),
        outputRow,
        outputColumn,
        cellTextOptions
      );
  }
  if (typeof scalar === 'boolean') {
    return { kind: 'boolean', value: scalar };
  }
  return xlsxTextCell(scalar, outputRow, outputColumn, cellTextOptions);
}

function xlsxSafeNumber(value: number): boolean {
  if (Object.is(value, -0)) {
    return false;
  }
  const magnitude = Math.abs(value);
  if (magnitude > 0 && magnitude < XLSX_MIN_NORMAL_NUMBER) {
    return false;
  }
  const mantissa = String(magnitude).split(/[eE]/, 1)[0];
  const significant = mantissa.replace('.', '').replace(/^0+/, '').replace(/0+$/, '');
  return significant.length <= XLSX_MAX_SIGNIFICANT_DIGITS;
}

function xlsxTextCell(
  value: unknown,
  outputRow: number,
  outputColumn: number,
  cellTextOptions: CellTextOptions = {}
): XlsxCellValue {
  const rendered = cellValueToBoundedExportText(
    value,
    XLSX_MAX_CELL_CHARACTERS + 1,
    cellTextOptions
  );
  if (rendered.truncated || rendered.text.length > XLSX_MAX_CELL_CHARACTERS) {
    throw new KxResultExportLimitError('cellCharacters',
      `XLSX export cell at row ${outputRow}, column ${outputColumn} ` +
      `exceeds Excel's ${XLSX_MAX_CELL_CHARACTERS}-character cell limit. ` +
      'Export a smaller row/column range or reduce that source value. ' +
      'No partial file was written.'
    );
  }
  return { kind: 'text', value: rendered.text };
}

function xlsxCellXml(ref: string, cell: XlsxCellValue): string {
  switch (cell.kind) {
    case 'blank':
      return `<c r="${ref}"/>`;
    case 'number':
      return `<c r="${ref}"><v>${cell.value}</v></c>`;
    case 'boolean':
      return `<c r="${ref}" t="b"><v>${cell.value ? '1' : '0'}</v></c>`;
    case 'text':
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.value)}</t></is></c>`;
  }
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
  const parts: string[] = [];
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (value.charAt(index) === '_' && /^_x[0-9a-fA-F]{4}_/.test(value.slice(index))) {
      parts.push('_x005F_');
      continue;
    }
    if (spreadsheetXstringCode(code) || unpairedSurrogate(value, index, code)) {
      parts.push(`_x${code.toString(16).toUpperCase().padStart(4, '0')}_`);
      continue;
    }
    const char = value.charAt(index);
    switch (char) {
      case '&':
        parts.push('&amp;');
        break;
      case '<':
        parts.push('&lt;');
        break;
      case '>':
        parts.push('&gt;');
        break;
      case '"':
        parts.push('&quot;');
        break;
      case '\'':
        parts.push('&apos;');
        break;
      default:
        parts.push(char);
    }
  }
  return parts.join('');
}

function spreadsheetXstringCode(code: number): boolean {
  return (code >= 0x0000 && code <= 0x001f && code !== 0x0009 && code !== 0x000a) ||
    (code >= 0x007f && code <= 0x009f) || code === 0xfffe || code === 0xffff;
}

function unpairedSurrogate(value: string, index: number, code: number): boolean {
  if (code >= 0xd800 && code <= 0xdbff) {
    const next = value.charCodeAt(index + 1);
    return !(next >= 0xdc00 && next <= 0xdfff);
  }
  if (code >= 0xdc00 && code <= 0xdfff) {
    const previous = value.charCodeAt(index - 1);
    return !(previous >= 0xd800 && previous <= 0xdbff);
  }
  return false;
}
