import * as crypto from 'crypto';
import {
  CHART_MAX_SOURCE_ROWS,
  ChartType,
  LineChartData,
  buildChartData,
  chartColumnOptions,
  normalizeChartType,
} from './charting';
import {
  ArrayDisplayFormat,
  CellTextOptions,
  ColumnarPanelResult,
  applyColumnarRowOrder,
  createColumnarPanelResult,
  sortedColumnarRowOrder,
} from './kx-results';
import {
  MAX_NOTEBOOK_LIVE_COPY_CELLS,
  MAX_NOTEBOOK_LIVE_COLUMNS,
} from './notebook-message';
import {
  QPanelResult,
  QResultDisplayOptions,
  QValue,
  qValueToColumnarPanel,
} from './q-ipc';

export const MAX_LIVE_NOTEBOOK_RESULTS = 512;
export const MAX_LIVE_NOTEBOOK_SLICE_ROWS = 500;
export const MAX_LIVE_NOTEBOOK_SLICE_COLUMNS = 128;
export const MAX_LIVE_NOTEBOOK_SLICE_CELLS = 20_000;
export const MAX_LIVE_NOTEBOOK_SLICE_TEXT_CHARS = 2_000_000;
export const MAX_LIVE_NOTEBOOK_SEARCH_MATCHES = 1_000;
export const MAX_LIVE_NOTEBOOK_SEARCH_CELLS = 2_000_000;
export const MAX_LIVE_NOTEBOOK_SEARCH_MS = 1_500;
export const MAX_LIVE_NOTEBOOK_INLINE_SORT_ROWS = 250_000;
export const MAX_LIVE_NOTEBOOK_CELL_TEXT_CHARS = 65_536;
export const MAX_LIVE_NOTEBOOK_SORT_CACHE_ENTRIES = 4;
export const MAX_LIVE_NOTEBOOK_COPY_CELLS = MAX_NOTEBOOK_LIVE_COPY_CELLS;
export const MAX_LIVE_NOTEBOOK_COPY_TEXT_CHARS = 2_000_000;

export interface LiveNotebookResultRegistration {
  notebookUri: string;
  cellUri: string;
  query: string;
  connectionName: string;
  elapsedMs: number;
  value: QValue;
}

export interface LiveNotebookDisplayOptions extends QResultDisplayOptions {
  arrayDisplayFormat?: ArrayDisplayFormat;
}

export interface LiveNotebookResultView {
  id: string;
  mode: 'table' | 'text';
  kind: string;
  query: string;
  connectionName: string;
  elapsedMs: number;
  columns: string[];
  rowCount: number;
  chartXColumns: string[];
  chartYColumns: string[];
  chartGroupColumns: string[];
  text?: string;
  table?: ColumnarPanelResult;
}

export interface LiveNotebookSliceRequest {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
}

export interface LiveNotebookSlice {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  cells: string[][];
}

export interface LiveNotebookSearchResult {
  matches: number[];
  totalScanned: number;
  scannedCells: number;
  capped: boolean;
  partial: boolean;
}

export interface LiveNotebookChartRequest {
  requestId: number;
  chartType: ChartType | string;
  xColumn: string;
  yColumns: string[];
  groupByColumn?: string;
  openColumn?: string;
  highColumn?: string;
  lowColumn?: string;
  closeColumn?: string;
  maxPoints: number;
  maxSourceRows?: number;
}

export interface LiveNotebookCopyRequest {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  format: 'tsv' | 'csv';
  includeHeaders: boolean;
  includeRowIndex: boolean;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
}

interface LiveNotebookRecord extends LiveNotebookResultRegistration {
  id: string;
  createdAt: number;
  viewKey?: string;
  converted?: QPanelResult;
  sortOrders: Map<string, number[]>;
}

export class LiveNotebookResultStore {
  private readonly records = new Map<string, LiveNotebookRecord>();
  private readonly cellResults = new Map<string, string>();

  public constructor(
    private readonly maxEntries = MAX_LIVE_NOTEBOOK_RESULTS,
    private readonly idFactory: () => string = () => crypto.randomBytes(24).toString('hex')
  ) {}

  public register(registration: LiveNotebookResultRegistration): string {
    this.removeCell(registration.notebookUri, registration.cellUri);
    const id = this.uniqueId();
    this.bind(id, registration);
    return id;
  }

  public stage(registration: LiveNotebookResultRegistration): string {
    const id = this.uniqueId();
    this.records.set(id, {
      ...registration,
      id,
      createdAt: Date.now(),
      sortOrders: new Map<string, number[]>(),
    });
    return id;
  }

  public rebind(id: string, registration: LiveNotebookResultRegistration): void {
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(id)) {
      throw new Error('Live KX notebook result identifier is invalid.');
    }
    this.bind(id, registration);
  }

  public remove(id: string, notebookUri: string): void {
    const record = this.records.get(id);
    if (!record || record.notebookUri !== notebookUri) {
      return;
    }
    const key = cellKey(record.notebookUri, record.cellUri);
    if (this.cellResults.get(key) === id) {
      this.cellResults.delete(key);
    }
    this.records.delete(id);
  }

  public removeCell(notebookUri: string, cellUri: string): void {
    const key = cellKey(notebookUri, cellUri);
    const id = this.cellResults.get(key);
    if (!id) {
      return;
    }
    this.cellResults.delete(key);
    this.records.delete(id);
  }

  public closeNotebook(notebookUri: string): void {
    for (const [id, record] of this.records) {
      if (record.notebookUri === notebookUri) {
        this.records.delete(id);
        this.cellResults.delete(cellKey(record.notebookUri, record.cellUri));
      }
    }
  }

  public clear(): void {
    this.records.clear();
    this.cellResults.clear();
  }

  public has(id: string, notebookUri: string): boolean {
    return this.record(id, notebookUri) !== undefined;
  }

  public tableColumns(
    id: string,
    notebookUri: string,
    options: LiveNotebookDisplayOptions = {}
  ): string[] | undefined {
    const record = this.record(id, notebookUri);
    if (!record) {
      return undefined;
    }
    const converted = this.converted(record, options);
    return converted.mode === 'grid' ? converted.result.columns.slice() : [];
  }

  public view(
    id: string,
    notebookUri: string,
    options: LiveNotebookDisplayOptions = {}
  ): LiveNotebookResultView | undefined {
    const record = this.record(id, notebookUri);
    if (!record) {
      return undefined;
    }
    const converted = this.converted(record, options);
    if (converted.mode === 'text') {
      return {
        id,
        mode: 'text',
        kind: converted.kind,
        query: record.query,
        connectionName: record.connectionName,
        elapsedMs: record.elapsedMs,
        columns: [],
        rowCount: 0,
        chartXColumns: [],
        chartYColumns: [],
        chartGroupColumns: [],
        text: converted.text,
      };
    }
    const chartTable = inlineChartSource(converted.result);
    const chartOptions = chartColumnOptions(chartTable);
    return {
      id,
      mode: 'table',
      kind: converted.kind,
      query: record.query,
      connectionName: record.connectionName,
      elapsedMs: record.elapsedMs,
      columns: converted.result.columns.slice(),
      rowCount: converted.result.rowCount,
      chartXColumns: chartOptions.xColumns.map(option => option.columnName),
      chartYColumns: chartOptions.yColumns.map(option => option.columnName),
      chartGroupColumns: chartOptions.groupColumns.map(option => option.columnName),
      table: converted.result,
    };
  }

  public slice(
    id: string,
    notebookUri: string,
    request: LiveNotebookSliceRequest,
    options: LiveNotebookDisplayOptions = {}
  ): LiveNotebookSlice | undefined {
    const record = this.record(id, notebookUri);
    if (!record) {
      return undefined;
    }
    const converted = this.converted(record, options);
    if (converted.mode !== 'grid') {
      return undefined;
    }
    const table = sortedTable(record, converted.result, request, options);
    if (table.rowCount === 0 || table.columns.length === 0) {
      return {
        startRow: 0,
        endRow: -1,
        startColumn: 0,
        endColumn: -1,
        cells: [],
      };
    }

    const startRow = boundedIndex(request.startRow, table.rowCount - 1);
    const requestedEndRow = boundedIndex(request.endRow, table.rowCount - 1);
    const startColumn = boundedIndex(request.startColumn, table.columns.length - 1);
    const requestedEndColumn = boundedIndex(request.endColumn, table.columns.length - 1);
    const rowCount = Math.min(
      MAX_LIVE_NOTEBOOK_SLICE_ROWS,
      Math.max(1, requestedEndRow - startRow + 1)
    );
    const columnCount = Math.min(
      MAX_LIVE_NOTEBOOK_SLICE_COLUMNS,
      Math.max(
        1,
        Math.min(
          requestedEndColumn - startColumn + 1,
          Math.floor(MAX_LIVE_NOTEBOOK_SLICE_CELLS / rowCount)
        )
      )
    );
    const endRow = Math.min(table.rowCount - 1, startRow + rowCount - 1);
    const endColumn = Math.min(table.columns.length - 1, startColumn + columnCount - 1);
    const textOptions = cellTextOptions(options);
    let cells = liveSliceCells(
      table,
      startRow,
      endRow,
      startColumn,
      endColumn,
      textOptions,
      MAX_LIVE_NOTEBOOK_CELL_TEXT_CHARS,
      MAX_LIVE_NOTEBOOK_SLICE_TEXT_CHARS
    );
    if (!cells) {
      const cellCount = rowCount * columnCount;
      const fairCellLimit = Math.max(
        1,
        Math.min(
          MAX_LIVE_NOTEBOOK_CELL_TEXT_CHARS,
          Math.floor(MAX_LIVE_NOTEBOOK_SLICE_TEXT_CHARS / cellCount)
        )
      );
      cells = liveSliceCells(
        table,
        startRow,
        endRow,
        startColumn,
        endColumn,
        textOptions,
        fairCellLimit
      )!;
    }
    return { startRow, endRow, startColumn, endColumn, cells };
  }

  public search(
    id: string,
    notebookUri: string,
    query: string,
    options: LiveNotebookDisplayOptions = {},
    sort?: Pick<LiveNotebookSliceRequest, 'sortColumn' | 'sortDirection'>
  ): LiveNotebookSearchResult | undefined {
    const record = this.record(id, notebookUri);
    if (!record) {
      return undefined;
    }
    const converted = this.converted(record, options);
    if (converted.mode !== 'grid') {
      return undefined;
    }
    const table = sortedTable(record, converted.result, {
      ...sort,
    }, options);
    const needle = boundedSearchText(query).toLocaleLowerCase();
    if (!needle) {
      return { matches: [], totalScanned: 0, scannedCells: 0, capped: false, partial: false };
    }

    const startedAt = Date.now();
    const matches: number[] = [];
    let totalScanned = 0;
    let scannedCells = 0;
    let partial = false;
    const textOptions = cellTextOptions(options);
    outer: for (let rowIndex = 0; rowIndex < table.rowCount; rowIndex++) {
      totalScanned += 1;
      for (let columnIndex = 0; columnIndex < table.columns.length; columnIndex++) {
        scannedCells += 1;
        if (table.cellText(rowIndex, columnIndex, textOptions).toLocaleLowerCase().includes(needle)) {
          matches.push(rowIndex);
          if (matches.length >= MAX_LIVE_NOTEBOOK_SEARCH_MATCHES) {
            partial = rowIndex + 1 < table.rowCount;
            break outer;
          }
          break;
        }
        if (scannedCells >= MAX_LIVE_NOTEBOOK_SEARCH_CELLS ||
          Date.now() - startedAt >= MAX_LIVE_NOTEBOOK_SEARCH_MS) {
          partial = rowIndex + 1 < table.rowCount || columnIndex + 1 < table.columns.length;
          break outer;
        }
      }
    }
    return {
      matches,
      totalScanned,
      scannedCells,
      capped: matches.length >= MAX_LIVE_NOTEBOOK_SEARCH_MATCHES,
      partial,
    };
  }

  public chart(
    id: string,
    notebookUri: string,
    request: LiveNotebookChartRequest,
    options: LiveNotebookDisplayOptions = {}
  ): LineChartData | undefined {
    const view = this.view(id, notebookUri, options);
    if (!view?.table) {
      return undefined;
    }
    const chartType = normalizeChartType(request.chartType);
    return buildChartData(view.table, {
      version: 1,
      requestId: safeRequestId(request.requestId),
      chartType,
      xColumn: request.xColumn,
      yColumns: request.yColumns.slice(0, 16),
      groupByColumn: request.groupByColumn,
      openColumn: request.openColumn,
      highColumn: request.highColumn,
      lowColumn: request.lowColumn,
      closeColumn: request.closeColumn,
      width: 720,
      maxSourceRows: safePositiveInteger(request.maxSourceRows, CHART_MAX_SOURCE_ROWS),
      maxSampledPoints: safePositiveInteger(request.maxPoints, 2_500),
    });
  }

  public copyText(
    id: string,
    notebookUri: string,
    request: LiveNotebookCopyRequest,
    options: LiveNotebookDisplayOptions = {}
  ): string | undefined {
    const record = this.record(id, notebookUri);
    if (!record) {
      return undefined;
    }
    const converted = this.converted(record, options);
    if (converted.mode !== 'grid') {
      return undefined;
    }
    const table = sortedTable(record, converted.result, request, options);
    const startRow = boundedIndex(request.startRow, Math.max(0, table.rowCount - 1));
    const endRow = boundedIndex(request.endRow, Math.max(0, table.rowCount - 1));
    const startColumn = boundedIndex(request.startColumn, Math.max(0, table.columns.length - 1));
    const endColumn = boundedIndex(request.endColumn, Math.max(0, table.columns.length - 1));
    if (table.rowCount === 0 || table.columns.length === 0 ||
      endRow < startRow || endColumn < startColumn) {
      return '';
    }
    const cellCount = (endRow - startRow + 1) * (endColumn - startColumn + 1);
    if (cellCount > MAX_LIVE_NOTEBOOK_COPY_CELLS) {
      throw new Error(
        `Inline copy is limited to ${MAX_LIVE_NOTEBOOK_COPY_CELLS.toLocaleString()} cells.`
      );
    }
    const fairCellLimit = Math.max(
      1,
      Math.min(
        MAX_LIVE_NOTEBOOK_CELL_TEXT_CHARS,
        Math.floor(MAX_LIVE_NOTEBOOK_COPY_TEXT_CHARS / Math.max(1, cellCount * 2))
      )
    );
    const textOptions = cellTextOptions(options);
    const bounded = createColumnarPanelResult(
      table.columns.map(column => boundedLiveCellText(column, fairCellLimit)),
      table.rowCount,
      (rowIndex, columnIndex) => boundedLiveCellText(
        table.cellText(rowIndex, columnIndex, textOptions),
        fairCellLimit
      )
    );
    const text = bounded.toText(request.format, {
      startRow,
      endRow,
      startColumn,
      endColumn,
    }, {
      includeHeaders: request.includeHeaders,
      includeRowIndex: request.includeRowIndex,
    });
    if (text.length > MAX_LIVE_NOTEBOOK_COPY_TEXT_CHARS) {
      throw new Error(
        `Inline copy exceeds the ${MAX_LIVE_NOTEBOOK_COPY_TEXT_CHARS.toLocaleString()} character limit.`
      );
    }
    return text;
  }

  private record(id: string, notebookUri: string): LiveNotebookRecord | undefined {
    const record = this.records.get(id);
    return record?.notebookUri === notebookUri ? record : undefined;
  }

  private converted(
    record: LiveNotebookRecord,
    options: LiveNotebookDisplayOptions
  ): QPanelResult {
    const key = JSON.stringify([
      options.functionDisplayStrategy,
      options.dictionaryDisplayStrategy,
      options.listDisplayStrategy,
      options.objectDisplayStrategy,
    ]);
    if (!record.converted || record.viewKey !== key) {
      record.converted = qValueToColumnarPanel(record.value, options);
      record.viewKey = key;
      record.sortOrders.clear();
    }
    return record.converted;
  }

  private uniqueId(): string {
    for (let attempt = 0; attempt < 16; attempt++) {
      const candidate = String(this.idFactory());
      if (/^[A-Za-z0-9_-]{32,128}$/.test(candidate) && !this.records.has(candidate)) {
        return candidate;
      }
    }
    throw new Error('Could not allocate a safe live notebook result identifier.');
  }

  private bind(id: string, registration: LiveNotebookResultRegistration): void {
    const previous = this.records.get(id);
    if (previous) {
      this.cellResults.delete(cellKey(previous.notebookUri, previous.cellUri));
    }
    const targetKey = cellKey(registration.notebookUri, registration.cellUri);
    const replacedId = this.cellResults.get(targetKey);
    if (replacedId && replacedId !== id) {
      this.records.delete(replacedId);
    }
    this.records.set(id, {
      ...registration,
      id,
      createdAt: previous?.createdAt ?? Date.now(),
      viewKey: previous?.viewKey,
      converted: previous?.converted,
      sortOrders: previous?.sortOrders ?? new Map<string, number[]>(),
    });
    this.cellResults.set(targetKey, id);
    this.evictOldest();
  }

  private evictOldest(): void {
    const limit = Math.max(1, Math.floor(this.maxEntries));
    while (this.records.size > limit) {
      let oldest: LiveNotebookRecord | undefined;
      for (const record of this.records.values()) {
        if (!oldest || record.createdAt < oldest.createdAt) {
          oldest = record;
        }
      }
      if (!oldest) {
        return;
      }
      this.records.delete(oldest.id);
      this.cellResults.delete(cellKey(oldest.notebookUri, oldest.cellUri));
    }
  }
}

function sortedTable(
  record: LiveNotebookRecord,
  table: ColumnarPanelResult,
  request: Pick<LiveNotebookSliceRequest, 'sortColumn' | 'sortDirection'>,
  options: LiveNotebookDisplayOptions
): ColumnarPanelResult {
  const columnName = typeof request.sortColumn === 'string' ? request.sortColumn : '';
  const direction = request.sortDirection;
  if (!columnName || (direction !== 'asc' && direction !== 'desc')) {
    return table;
  }
  const columnIndex = table.columns.indexOf(columnName);
  if (columnIndex < 0) {
    return table;
  }
  if (table.rowCount >= MAX_LIVE_NOTEBOOK_INLINE_SORT_ROWS) {
    throw new Error(
      `Inline notebook sort is limited to fewer than ${MAX_LIVE_NOTEBOOK_INLINE_SORT_ROWS} rows. ` +
      'Open the full KX Results panel for the large-sort confirmation flow.'
    );
  }
  const key = `${record.viewKey || ''}\0${options.arrayDisplayFormat || ''}\0${columnName}\0${direction}`;
  let order = record.sortOrders.get(key);
  if (order) {
    record.sortOrders.delete(key);
    record.sortOrders.set(key, order);
  } else {
    order = sortedColumnarRowOrder(table, columnIndex, direction, cellTextOptions(options));
    while (record.sortOrders.size >= MAX_LIVE_NOTEBOOK_SORT_CACHE_ENTRIES) {
      const oldest = record.sortOrders.keys().next().value as string | undefined;
      if (oldest === undefined) {
        break;
      }
      record.sortOrders.delete(oldest);
    }
    record.sortOrders.set(key, order);
  }
  return applyColumnarRowOrder(table, order);
}

function inlineChartSource(table: ColumnarPanelResult): ColumnarPanelResult {
  if (table.columns.length <= MAX_NOTEBOOK_LIVE_COLUMNS) {
    return table;
  }
  const columns = table.columns.slice(0, MAX_NOTEBOOK_LIVE_COLUMNS);
  return createColumnarPanelResult(
    columns,
    table.rowCount,
    (rowIndex, columnIndex) => table.cellValue(rowIndex, columnIndex)
  );
}

function cellTextOptions(options: LiveNotebookDisplayOptions): CellTextOptions {
  return {
    arrayDisplayFormat: options.arrayDisplayFormat === 'space' || options.arrayDisplayFormat === 'raw'
      ? options.arrayDisplayFormat
      : 'commaSpace',
  };
}

function cellKey(notebookUri: string, cellUri: string): string {
  return `${notebookUri}\0${cellUri}`;
}

function boundedIndex(value: number, maximum: number): number {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(0, Math.floor(number)))
    : 0;
}

function boundedSearchText(value: string): string {
  return String(value || '').replace(/\0/g, '').slice(0, 512);
}

function liveSliceCells(
  table: ColumnarPanelResult,
  startRow: number,
  endRow: number,
  startColumn: number,
  endColumn: number,
  textOptions: CellTextOptions,
  cellLimit: number,
  aggregateLimit?: number
): string[][] | undefined {
  const cells: string[][] = [];
  let textChars = 0;
  for (let rowIndex = startRow; rowIndex <= endRow; rowIndex++) {
    const row: string[] = [];
    for (let columnIndex = startColumn; columnIndex <= endColumn; columnIndex++) {
      const value = boundedLiveCellText(
        table.cellText(rowIndex, columnIndex, textOptions),
        cellLimit
      );
      textChars += value.length;
      if (aggregateLimit !== undefined && textChars > aggregateLimit) {
        return undefined;
      }
      row.push(value);
    }
    cells.push(row);
  }
  return cells;
}

function boundedLiveCellText(value: string, maxChars: number): string {
  const limit = Math.max(1, Math.min(MAX_LIVE_NOTEBOOK_CELL_TEXT_CHARS, Math.floor(maxChars)));
  if (value.length <= limit) {
    return value;
  }
  const suffix = '\u2026 [cell truncated; open KX Results]';
  if (limit <= suffix.length) {
    return suffix.slice(0, limit);
  }
  return `${value.slice(0, limit - suffix.length)}${suffix}`;
}

function safePositiveInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1
    ? Math.floor(number)
    : fallback;
}

function safeRequestId(value: unknown): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}
