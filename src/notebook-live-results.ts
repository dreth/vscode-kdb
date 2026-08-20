import * as crypto from 'crypto';
import {
  CHART_MAX_SOURCE_ROWS,
  ChartType,
  LineChartData,
  TemporalPanChartCache,
  buildChartDataWithTemporalPanReuse,
  chartColumnOptions,
  normalizeChartType,
} from './charting';
import {
  ArrayDisplayFormat,
  CellRange,
  CellTextOptions,
  ColumnarPanelResult,
  TextExportFormat,
  analystExportColumnNames,
  applyColumnarRowOrder,
  cellValueToBoundedExportText,
  cellValueToBoundedText,
  createColumnarPanelResult,
  kxResultJsonCharacterLength,
  kxResultJsonStringCharacterLength,
  projectColumnarPanelResult,
  rowIndexColumnName,
  sortedColumnarRowOrder,
} from './kx-results';
import {
  MAX_NOTEBOOK_LIVE_COPY_CELLS,
  MAX_NOTEBOOK_LIVE_COLUMNS,
  inspectNotebookKxOutputIdentity,
} from './notebook-message';
import { widestDisplayedColumnTextLengthsAsync } from './column-sizing';
import {
  QPanelResult,
  QResultDisplayOptions,
  QValue,
  qValueToColumnarPanel,
  qValueToQText,
} from './q-ipc';

export const MAX_LIVE_NOTEBOOK_RESULTS = 512;
export const MAX_LIVE_NOTEBOOK_SLICE_ROWS = 500;
export const MAX_LIVE_NOTEBOOK_SLICE_COLUMNS = 128;
export const MAX_LIVE_NOTEBOOK_SLICE_CELLS = 20_000;
export const MAX_LIVE_NOTEBOOK_SLICE_TEXT_CHARS = 2_000_000;
export const MAX_LIVE_NOTEBOOK_SEARCH_MATCHES = 1_000;
export const MAX_LIVE_NOTEBOOK_SEARCH_CELLS = 2_000_000;
export const MAX_LIVE_NOTEBOOK_SEARCH_MS = 1_500;
export const MAX_LIVE_NOTEBOOK_CELL_TEXT_CHARS = 65_536;
export const MAX_LIVE_NOTEBOOK_SORT_CACHE_ENTRIES = 4;
export const MAX_LIVE_NOTEBOOK_COPY_CELLS = MAX_NOTEBOOK_LIVE_COPY_CELLS;
export const MAX_LIVE_NOTEBOOK_COPY_TEXT_CHARS = 2_000_000;

export interface LiveNotebookResultRegistration {
  notebookUri: string;
  cellUri: string;
  outputId?: string;
  query: string;
  connectionName: string;
  elapsedMs: number;
  value: QValue;
}

export interface NotebookOutputSnapshot {
  metadata?: { [key: string]: unknown };
  items: readonly { mime: string; data: Uint8Array }[];
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
  keyColumnOrdinals?: number[];
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
  columnIndexes?: number[];
  sortOrdinal?: number;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
}

export interface LiveNotebookSlice {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  columnOrdinals: number[];
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
  xMin?: number;
  xMax?: number;
  temporalBucketIntervalMs?: number;
}

export interface LiveNotebookRangeRequest {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  columnIndexes?: number[];
  sortOrdinal?: number;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
}

export interface LiveNotebookCopyRequest extends LiveNotebookRangeRequest {
  format: TextExportFormat;
  includeHeaders: boolean;
  includeRowIndex: boolean;
}

export interface LiveNotebookResultRange {
  table: ColumnarPanelResult;
  range: CellRange;
}

export interface LiveNotebookSortWarningState {
  generation: number;
  rowCount: number;
  approved: boolean;
}

interface LiveNotebookRecord extends LiveNotebookResultRegistration {
  id: string;
  generation: number;
  createdAt: number;
  sortWarningApproved: boolean;
  staged?: boolean;
  viewKey?: string;
  converted?: QPanelResult;
  columnTextLengthCache?: {
    key: string;
    lengths: number[];
  };
  columnTextLengthScan?: {
    key: string;
    promise?: Promise<number[] | undefined>;
  };
  temporalPanChartCache?: TemporalPanChartCache;
  sortOrders: Map<string, number[]>;
}

export class LiveNotebookResultStore {
  private readonly records = new Map<string, LiveNotebookRecord>();
  private readonly cellResults = new Map<string, string>();
  private nextRecordGeneration = 0;

  public constructor(
    private readonly maxEntries = MAX_LIVE_NOTEBOOK_RESULTS,
    private readonly idFactory: () => string = () => crypto.randomBytes(24).toString('hex')
  ) {}

  public cancelColumnTextLengthScans(): void {
    this.records.forEach(record => {
      record.columnTextLengthScan = undefined;
    });
  }

  public register(registration: LiveNotebookResultRegistration, excludedId?: string): string {
    this.removeCell(registration.notebookUri, registration.cellUri);
    const id = this.uniqueId(excludedId);
    this.bind(id, registration);
    return id;
  }

  public stage(registration: LiveNotebookResultRegistration, excludedId?: string): string {
    const id = this.uniqueId(excludedId);
    this.records.set(id, {
      ...registration,
      id,
      generation: ++this.nextRecordGeneration,
      createdAt: Date.now(),
      staged: true,
      sortWarningApproved: false,
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

  public bindStagedOutput(
    id: string,
    notebookUri: string,
    cellUri: string,
    outputId: string
  ): boolean {
    const record = this.records.get(id);
    if (!record?.staged || record.notebookUri !== notebookUri ||
      record.outputId !== outputId) {
      return false;
    }
    this.bind(id, {
      notebookUri,
      cellUri,
      query: record.query,
      connectionName: record.connectionName,
      elapsedMs: record.elapsedMs,
      value: record.value,
      outputId: record.outputId,
    });
    return true;
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

  public has(id: string, notebookUri: string, cellUri?: string): boolean {
    return !!this.record(id, notebookUri, cellUri);
  }

  public hasForOutput(
    id: string,
    notebookUri: string,
    cellUri: string,
    outputId: string
  ): boolean {
    const record = this.record(id, notebookUri, cellUri);
    return record?.outputId === outputId;
  }

  public sortWarningState(
    id: string,
    notebookUri: string,
    options: LiveNotebookDisplayOptions = {},
    cellUri?: string
  ): LiveNotebookSortWarningState | undefined {
    const record = this.record(id, notebookUri, cellUri);
    if (!record) {
      return undefined;
    }
    const converted = this.converted(record, options);
    return {
      generation: record.generation,
      rowCount: converted.mode === 'grid' ? converted.result.rowCount : 0,
      approved: record.sortWarningApproved,
    };
  }

  public approveSortWarning(
    id: string,
    notebookUri: string,
    generation: number,
    cellUri?: string
  ): boolean {
    const record = this.record(id, notebookUri, cellUri);
    if (!record || record.generation !== generation) {
      return false;
    }
    record.sortWarningApproved = true;
    return true;
  }

  public tableColumns(
    id: string,
    notebookUri: string,
    options: LiveNotebookDisplayOptions = {},
    cellUri?: string
  ): string[] | undefined {
    const record = this.record(id, notebookUri, cellUri);
    if (!record) {
      return undefined;
    }
    const converted = this.converted(record, options);
    return converted.mode === 'grid' ? converted.result.columns.slice() : [];
  }

  public view(
    id: string,
    notebookUri: string,
    options: LiveNotebookDisplayOptions = {},
    cellUri?: string
  ): LiveNotebookResultView | undefined {
    const record = this.record(id, notebookUri, cellUri);
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
      ...(converted.result.keyColumnOrdinals === undefined
        ? {}
        : { keyColumnOrdinals: converted.result.keyColumnOrdinals.slice() }),
      rowCount: converted.result.rowCount,
      chartXColumns: chartOptions.xColumns.map(option => option.columnName),
      chartYColumns: chartOptions.yColumns.map(option => option.columnName),
      chartGroupColumns: chartOptions.groupColumns.map(option => option.columnName),
      table: converted.result,
    };
  }

  public async columnTextLengths(
    id: string,
    notebookUri: string,
    options: LiveNotebookDisplayOptions = {},
    cellUri?: string,
    maximumColumns = Number.MAX_SAFE_INTEGER
  ): Promise<number[] | undefined> {
    const record = this.record(id, notebookUri, cellUri);
    if (!record) {
      return undefined;
    }
    const converted = this.converted(record, options);
    if (converted.mode !== 'grid') {
      return undefined;
    }
    const columnLimit = Math.min(
      converted.result.columns.length,
      Math.max(0, Math.floor(Number(maximumColumns) || 0))
    );
    const key =
      `${record.viewKey || ''}\0${options.arrayDisplayFormat || ''}\0${columnLimit}`;
    if (record.columnTextLengthCache?.key === key) {
      return record.columnTextLengthCache.lengths.slice();
    }
    const pending = record.columnTextLengthScan;
    if (pending?.key === key && pending.promise) {
      const lengths = await pending.promise;
      return lengths?.slice();
    }
    const scan: NonNullable<LiveNotebookRecord['columnTextLengthScan']> = { key };
    record.columnTextLengthScan = scan;
    const scanTable = columnLimit === converted.result.columns.length
      ? converted.result
      : createColumnarPanelResult(
        converted.result.columns.slice(0, columnLimit),
        converted.result.rowCount,
        (row, column) => converted.result.cellValue(row, column),
        converted.result.columnTypes?.slice(0, columnLimit),
        converted.result.keyColumnOrdinals?.filter(ordinal => ordinal < columnLimit)
      );
    scan.promise = widestDisplayedColumnTextLengthsAsync(
      scanTable,
      { arrayDisplayFormat: options.arrayDisplayFormat },
      {
        continueScanning: () =>
          this.records.get(id) === record &&
          record.columnTextLengthScan === scan,
      }
    );
    try {
      const lengths = await scan.promise;
      if (!lengths ||
        this.records.get(id) !== record ||
        record.columnTextLengthScan !== scan) {
        return undefined;
      }
      record.columnTextLengthCache = { key, lengths };
      return lengths.slice();
    } finally {
      if (record.columnTextLengthScan === scan) {
        record.columnTextLengthScan = undefined;
      }
    }
  }

  public fullText(
    id: string,
    notebookUri: string,
    options: LiveNotebookDisplayOptions = {},
    cellUri?: string
  ): string | undefined {
    const record = this.record(id, notebookUri, cellUri);
    if (!record || this.converted(record, options).mode !== 'text') {
      return undefined;
    }
    return qValueToQText(record.value, { maxChars: Number.MAX_SAFE_INTEGER });
  }

  public slice(
    id: string,
    notebookUri: string,
    request: LiveNotebookSliceRequest,
    options: LiveNotebookDisplayOptions = {},
    cellUri?: string
  ): LiveNotebookSlice | undefined {
    const record = this.record(id, notebookUri, cellUri);
    if (!record) {
      return undefined;
    }
    const converted = this.converted(record, options);
    if (converted.mode !== 'grid') {
      return undefined;
    }
    const sorted = sortedTable(record, converted.result, request, options);
    const requestedColumnIndexes = liveNotebookColumnIndexes(sorted, request);
    const table = columnSelectionTable(sorted, requestedColumnIndexes);
    if (table.rowCount === 0 || table.columns.length === 0) {
      return {
        startRow: 0,
        endRow: -1,
        startColumn: 0,
        endColumn: -1,
        columnOrdinals: [],
        cells: [],
      };
    }

    const startRow = boundedIndex(request.startRow, table.rowCount - 1);
    const requestedEndRow = boundedIndex(request.endRow, table.rowCount - 1);
    const startColumn = request.columnIndexes
      ? 0
      : boundedIndex(request.startColumn, table.columns.length - 1);
    const requestedEndColumn = request.columnIndexes
      ? table.columns.length - 1
      : boundedIndex(request.endColumn, table.columns.length - 1);
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
    const responseStartColumn = request.columnIndexes ? request.startColumn : startColumn;
    return {
      startRow,
      endRow,
      startColumn: responseStartColumn,
      endColumn: responseStartColumn + columnCount - 1,
      columnOrdinals: requestedColumnIndexes.slice(startColumn, endColumn + 1),
      cells,
    };
  }

  public search(
    id: string,
    notebookUri: string,
    query: string,
    options: LiveNotebookDisplayOptions = {},
    request?: Pick<
      LiveNotebookSliceRequest,
      'sortOrdinal' | 'sortColumn' | 'sortDirection' | 'columnIndexes'
    >,
    cellUri?: string
  ): LiveNotebookSearchResult | undefined {
    const record = this.record(id, notebookUri, cellUri);
    if (!record) {
      return undefined;
    }
    const converted = this.converted(record, options);
    if (converted.mode !== 'grid') {
      return undefined;
    }
    const sorted = sortedTable(record, converted.result, { ...request }, options);
    const table = request?.columnIndexes
      ? columnSelectionTable(sorted, validColumnIndexes(request.columnIndexes, sorted.columns.length))
      : sorted;
    const needle = boundedSearchText(query).toLocaleLowerCase();
    if (!needle) {
      return { matches: [], totalScanned: 0, scannedCells: 0, capped: false, partial: false };
    }

    const startedAt = Date.now();
    const matches: number[] = [];
    let totalScanned = 0;
    let scannedCells = 0;
    let partial = false;
    let truncatedCells = false;
    const textOptions = cellTextOptions(options);
    outer: for (let rowIndex = 0; rowIndex < table.rowCount; rowIndex++) {
      totalScanned += 1;
      for (let columnIndex = 0; columnIndex < table.columns.length; columnIndex++) {
        scannedCells += 1;
        const rendered = cellValueToBoundedText(
          table.cellValue(rowIndex, columnIndex),
          MAX_LIVE_NOTEBOOK_CELL_TEXT_CHARS,
          textOptions
        );
        truncatedCells = truncatedCells || rendered.truncated;
        if (rendered.text.toLocaleLowerCase().includes(needle)) {
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
      partial: partial || truncatedCells,
    };
  }

  public chart(
    id: string,
    notebookUri: string,
    request: LiveNotebookChartRequest,
    options: LiveNotebookDisplayOptions = {},
    cellUri?: string
  ): LineChartData | undefined {
    const record = this.record(id, notebookUri, cellUri);
    const view = this.view(id, notebookUri, options, cellUri);
    if (!record || !view?.table) {
      return undefined;
    }
    const chartType = normalizeChartType(request.chartType);
    const built = buildChartDataWithTemporalPanReuse(view.table, {
      version: record.generation,
      requestId: safeRequestId(request.requestId),
      chartType,
      xColumn: request.xColumn,
      yColumns: request.yColumns.slice(0, 16),
      groupByColumn: request.groupByColumn,
      openColumn: request.openColumn,
      highColumn: request.highColumn,
      lowColumn: request.lowColumn,
      closeColumn: request.closeColumn,
      xMin: request.xMin,
      xMax: request.xMax,
      width: 720,
      maxSourceRows: safePositiveInteger(request.maxSourceRows, CHART_MAX_SOURCE_ROWS),
      maxSampledPoints: safePositiveInteger(request.maxPoints, 2_500),
      samplingStrategy: Number.isFinite(request.temporalBucketIntervalMs) &&
        Number(request.temporalBucketIntervalMs) > 0
        ? 'temporal-fixed'
        : 'temporal-auto',
      temporalBucketIntervalMs: request.temporalBucketIntervalMs,
    }, record.temporalPanChartCache);
    record.temporalPanChartCache = built.cache;
    return built.data;
  }

  public copyText(
    id: string,
    notebookUri: string,
    request: LiveNotebookCopyRequest,
    options: LiveNotebookDisplayOptions = {},
    cellUri?: string
  ): string | undefined {
    const selected = this.resultRange(id, notebookUri, request, options, cellUri);
    if (!selected) {
      return undefined;
    }
    const { table, range } = selected;
    if (table.rowCount === 0 || table.columns.length === 0) {
      return '';
    }
    const cellCount =
      (range.endRow - range.startRow + 1) *
      (range.endColumn - range.startColumn + 1);
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
    const structured = request.format === 'json' || request.format === 'ndjson';
    if (structured) {
      assertStructuredLiveCopyBounded(
        table,
        range,
        request.format,
        request.includeRowIndex,
        fairCellLimit
      );
    }
    const copyTable = structured
      ? table
      : createColumnarPanelResult(
        table.columns.map(column => boundedLiveCellText(column, fairCellLimit)),
        table.rowCount,
        (rowIndex, columnIndex) => {
          const rendered = cellValueToBoundedExportText(
            table.cellValue(rowIndex, columnIndex),
            fairCellLimit,
            textOptions
          );
          return boundedLiveCellText(
            rendered.text,
            fairCellLimit,
            rendered.truncated
          );
        }
      );
    const text = copyTable.toText(request.format, range, {
      includeHeaders: request.includeHeaders,
      includeRowIndex: request.includeRowIndex,
      arrayDisplayFormat: textOptions.arrayDisplayFormat,
    });
    if (text.length > MAX_LIVE_NOTEBOOK_COPY_TEXT_CHARS) {
      throw liveCopyAggregateLimitError();
    }
    return text;
  }

  public resultRange(
    id: string,
    notebookUri: string,
    request: LiveNotebookRangeRequest,
    options: LiveNotebookDisplayOptions = {},
    cellUri?: string
  ): LiveNotebookResultRange | undefined {
    const record = this.record(id, notebookUri, cellUri);
    if (!record) {
      return undefined;
    }
    const converted = this.converted(record, options);
    if (converted.mode !== 'grid') {
      return undefined;
    }
    const sorted = sortedTable(record, converted.result, request, options);
    const indexes = request.columnIndexes || columnRangeIndexes(
      request.startColumn,
      request.endColumn,
      sorted.columns.length
    );
    const table = columnSelectionTable(sorted, indexes);
    const startRow = boundedIndex(request.startRow, Math.max(0, table.rowCount - 1));
    const endRow = boundedIndex(request.endRow, Math.max(0, table.rowCount - 1));
    if (table.rowCount === 0 || table.columns.length === 0 ||
      endRow < startRow) {
      return {
        table,
        range: { startRow: 0, endRow: -1, startColumn: 0, endColumn: -1 },
      };
    }
    return {
      table,
      range: {
        startRow,
        endRow,
        startColumn: 0,
        endColumn: table.columns.length - 1,
      },
    };
  }

  private record(
    id: string,
    notebookUri: string,
    cellUri?: string
  ): LiveNotebookRecord | undefined {
    const record = this.records.get(id);
    return record?.notebookUri === notebookUri &&
      (cellUri === undefined || record.cellUri === cellUri)
      ? record
      : undefined;
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
      record.columnTextLengthCache = undefined;
      record.columnTextLengthScan = undefined;
      record.sortOrders.clear();
    }
    return record.converted;
  }

  private uniqueId(excludedId?: string): string {
    for (let attempt = 0; attempt < 16; attempt++) {
      const candidate = String(this.idFactory());
      if (/^[A-Za-z0-9_-]{32,128}$/.test(candidate) &&
        candidate !== excludedId && !this.records.has(candidate)) {
        return candidate;
      }
    }
    throw new Error('Could not allocate a safe live notebook result identifier.');
  }

  private bind(id: string, registration: LiveNotebookResultRegistration): void {
    const previous = this.records.get(id);
    const sameDisplayedResult = !!previous &&
      previous.value === registration.value &&
      previous.outputId === registration.outputId;
    if (previous) {
      const previousKey = cellKey(previous.notebookUri, previous.cellUri);
      if (this.cellResults.get(previousKey) === id) {
        this.cellResults.delete(previousKey);
      }
    }
    const targetKey = cellKey(registration.notebookUri, registration.cellUri);
    const replacedId = this.cellResults.get(targetKey);
    if (replacedId && replacedId !== id) {
      this.records.delete(replacedId);
    }
    this.records.set(id, {
      ...registration,
      id,
      generation: sameDisplayedResult
        ? previous!.generation
        : ++this.nextRecordGeneration,
      createdAt: sameDisplayedResult ? previous!.createdAt : Date.now(),
      staged: false,
      sortWarningApproved: sameDisplayedResult
        ? previous!.sortWarningApproved
        : false,
      viewKey: sameDisplayedResult ? previous!.viewKey : undefined,
      converted: sameDisplayedResult ? previous!.converted : undefined,
      columnTextLengthCache: undefined,
      columnTextLengthScan: undefined,
      sortOrders: sameDisplayedResult
        ? previous!.sortOrders
        : new Map<string, number[]>(),
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

/** Reconcile public VS Code/Jupyter output changes with the transient live owner.
 * Native Clear Cell Output/Clear All Outputs leave no valid owned KX output, so
 * the old live value is removed and cannot be reached by a stale renderer. */
export function reconcileLiveNotebookCellOutputs(
  liveResults: Pick<LiveNotebookResultStore, 'hasForOutput' | 'removeCell'>,
  notebookUri: string,
  cellUri: string,
  outputs: readonly NotebookOutputSnapshot[]
): boolean {
  const retainsOwner = outputs.some(output => {
    const inspected = inspectNotebookKxOutputIdentity(output.metadata, output.items);
    return inspected.status === 'valid' && !!inspected.identity.live && liveResults.hasForOutput(
      inspected.identity.live.id,
      notebookUri,
      cellUri,
      inspected.identity.binding.id
    );
  });
  if (!retainsOwner) {
    liveResults.removeCell(notebookUri, cellUri);
  }
  return retainsOwner;
}

function sortedTable(
  record: LiveNotebookRecord,
  table: ColumnarPanelResult,
  request: Pick<
    LiveNotebookSliceRequest,
    'sortOrdinal' | 'sortColumn' | 'sortDirection'
  >,
  options: LiveNotebookDisplayOptions
): ColumnarPanelResult {
  const sourceOrdinal = Number.isSafeInteger(request.sortOrdinal)
    ? request.sortOrdinal as number
    : typeof request.sortColumn === 'string'
      ? table.columns.indexOf(request.sortColumn)
      : -1;
  const direction = request.sortDirection;
  if (sourceOrdinal < 0 || sourceOrdinal >= table.columns.length ||
    (direction !== 'asc' && direction !== 'desc')) {
    return table;
  }
  const key = `${record.viewKey || ''}\0${options.arrayDisplayFormat || ''}\0${sourceOrdinal}\0${direction}`;
  let order = record.sortOrders.get(key);
  if (order) {
    record.sortOrders.delete(key);
    record.sortOrders.set(key, order);
  } else {
    order = sortedColumnarRowOrder(table, sourceOrdinal, direction, cellTextOptions(options));
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

function liveNotebookColumnIndexes(
  table: ColumnarPanelResult,
  request: Pick<LiveNotebookSliceRequest, 'columnIndexes'>
): number[] {
  return request.columnIndexes
    ? validColumnIndexes(request.columnIndexes, table.columns.length)
    : table.columns.map((_column, index) => index);
}

function columnRangeIndexes(start: number, end: number, columnCount: number): number[] {
  if (columnCount <= 0) {
    return [];
  }
  const first = boundedIndex(start, columnCount - 1);
  const last = boundedIndex(end, columnCount - 1);
  const result: number[] = [];
  for (let index = first; index <= last; index += 1) {
    result.push(index);
  }
  return result;
}

function validColumnIndexes(indexes: readonly number[], columnCount: number): number[] {
  const seen = new Set<number>();
  return indexes.filter(index => {
    const valid = Number.isSafeInteger(index) && index >= 0 &&
      index < columnCount && !seen.has(index);
    if (valid) {
      seen.add(index);
    }
    return valid;
  });
}

function columnSelectionTable(
  table: ColumnarPanelResult,
  rawIndexes: readonly number[]
): ColumnarPanelResult {
  const indexes = validColumnIndexes(rawIndexes, table.columns.length);
  return projectColumnarPanelResult(table, indexes);
}

function inlineChartSource(table: ColumnarPanelResult): ColumnarPanelResult {
  if (table.columns.length <= MAX_NOTEBOOK_LIVE_COLUMNS) {
    return table;
  }
  return projectColumnarPanelResult(
    table,
    Array.from({ length: MAX_NOTEBOOK_LIVE_COLUMNS }, (_value, index) => index)
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
      const rendered = cellValueToBoundedText(
        table.cellValue(rowIndex, columnIndex),
        cellLimit,
        textOptions
      );
      const value = boundedLiveCellText(
        rendered.text,
        cellLimit,
        rendered.truncated
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

function boundedLiveCellText(
  value: string,
  maxChars: number,
  truncated = false
): string {
  const limit = Math.max(1, Math.min(MAX_LIVE_NOTEBOOK_CELL_TEXT_CHARS, Math.floor(maxChars)));
  if (!truncated && value.length <= limit) {
    return value;
  }
  const suffix = '\u2026 [cell truncated; open KX Results]';
  if (limit <= suffix.length) {
    return suffix.slice(0, limit);
  }
  return `${value.slice(0, limit - suffix.length)}${suffix}`;
}

interface StructuredLiveCopyColumn {
  columnIndex: number;
  jsonKeyChars: number;
}

function assertStructuredLiveCopyBounded(
  table: ColumnarPanelResult,
  range: CellRange,
  format: TextExportFormat,
  includeRowIndex: boolean,
  maxCellChars: number
): void {
  const rowCount = range.endRow - range.startRow + 1;
  const columns = structuredLiveCopyColumns(table, range);
  const indexKeyChars = includeRowIndex
    ? structuredLiveCopyKeyChars(rowIndexColumnName(table.columns, range))
    : 0;
  const propertyCount = columns.length + (includeRowIndex ? 1 : 0);
  let rowSyntaxChars = 2;
  rowSyntaxChars = addStructuredLiveCopyChars(rowSyntaxChars, indexKeyChars);
  for (const column of columns) {
    rowSyntaxChars = addStructuredLiveCopyChars(
      rowSyntaxChars,
      column.jsonKeyChars
    );
  }
  rowSyntaxChars = addStructuredLiveCopyChars(rowSyntaxChars, propertyCount);
  rowSyntaxChars = addStructuredLiveCopyChars(
    rowSyntaxChars,
    Math.max(0, propertyCount - 1)
  );

  let aggregateChars = format === 'json' ? 2 : 0;
  aggregateChars = addStructuredLiveCopyChars(
    aggregateChars,
    Math.max(0, rowCount - 1)
  );
  aggregateChars = addStructuredLiveCopyProduct(
    aggregateChars,
    rowSyntaxChars,
    rowCount
  );
  if (includeRowIndex) {
    for (let rowIndex = range.startRow; rowIndex <= range.endRow; rowIndex++) {
      aggregateChars = addStructuredLiveCopyChars(
        aggregateChars,
        String(rowIndex + 1).length
      );
    }
  }

  for (let rowIndex = range.startRow; rowIndex <= range.endRow; rowIndex++) {
    for (const column of columns) {
      let serializedChars: number | undefined;
      try {
        serializedChars = kxResultJsonCharacterLength(
          table.cellValue(rowIndex, column.columnIndex),
          maxCellChars
        );
      } catch {
        throw new Error('Inline structured copy contains a value that cannot be serialized safely.');
      }
      if (serializedChars === undefined) {
        throw new Error(
          `Inline structured copy cell exceeds the ${maxCellChars.toLocaleString()} character limit. ` +
          'Open KX Results to export the full value.'
        );
      }
      aggregateChars = addStructuredLiveCopyChars(
        aggregateChars,
        serializedChars
      );
    }
  }
}

function structuredLiveCopyColumns(
  table: ColumnarPanelResult,
  range: CellRange
): StructuredLiveCopyColumn[] {
  const columns: StructuredLiveCopyColumn[] = [];
  const exportNames = analystExportColumnNames(table.columns, range);
  for (let columnIndex = range.startColumn;
    columnIndex <= range.endColumn;
    columnIndex++) {
    columns.push({
      columnIndex,
      jsonKeyChars: structuredLiveCopyKeyChars(
        exportNames[columnIndex - range.startColumn]
      ),
    });
  }
  return columns;
}

function structuredLiveCopyKeyChars(value: string): number {
  const chars = kxResultJsonStringCharacterLength(
    value,
    MAX_LIVE_NOTEBOOK_COPY_TEXT_CHARS
  );
  if (chars === undefined) {
    throw liveCopyAggregateLimitError();
  }
  return chars;
}

function addStructuredLiveCopyChars(total: number, additional: number): number {
  if (!Number.isSafeInteger(additional) ||
    additional < 0 ||
    additional > MAX_LIVE_NOTEBOOK_COPY_TEXT_CHARS - total) {
    throw liveCopyAggregateLimitError();
  }
  return total + additional;
}

function addStructuredLiveCopyProduct(
  total: number,
  value: number,
  count: number
): number {
  if (!Number.isSafeInteger(value) ||
    !Number.isSafeInteger(count) ||
    value < 0 ||
    count < 0 ||
    (count > 0 &&
      value > Math.floor((MAX_LIVE_NOTEBOOK_COPY_TEXT_CHARS - total) / count))) {
    throw liveCopyAggregateLimitError();
  }
  return total + value * count;
}

function liveCopyAggregateLimitError(): Error {
  return new Error(
    `Inline copy exceeds the ${MAX_LIVE_NOTEBOOK_COPY_TEXT_CHARS.toLocaleString()} character limit.`
  );
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
