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
  qValueToLosslessPortablePanel,
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
  outputId: string;
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
  columnOrdinals: number[];
  sortOrdinal?: number;
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
}

export interface LiveNotebookCopyRequest {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  columnOrdinals: number[];
  format: 'tsv' | 'csv';
  includeHeaders: boolean;
  includeRowIndex: boolean;
  sortOrdinal?: number;
  sortDirection?: 'asc' | 'desc';
}

interface LiveNotebookRecord extends LiveNotebookResultRegistration {
  id: string;
  createdAt: number;
  staged: boolean;
  viewKey?: string;
  converted?: QPanelResult;
  sortOrders: Map<string, number[]>;
}

export type LiveNotebookInvalidationReason =
  | 'removed'
  | 'replaced'
  | 'evicted'
  | 'output-unbound'
  | 'duplicate-output'
  | 'notebook-closed'
  | 'cleared';

export interface LiveNotebookResultInvalidation {
  id: string;
  notebookUri: string;
  cellUri: string;
  reason: LiveNotebookInvalidationReason;
}

export interface LiveNotebookOutputBinding {
  id: string;
  cellUri: string;
  outputId: string;
}

export class LiveNotebookResultStore {
  private readonly records = new Map<string, LiveNotebookRecord>();
  private readonly cellResults = new Map<string, string>();
  private readonly pendingCellMoves = new Map<string, string>();
  private readonly invalidationListeners = new Set<(
    event: LiveNotebookResultInvalidation
  ) => void>();

  public constructor(
    private readonly maxEntries = MAX_LIVE_NOTEBOOK_RESULTS,
    private readonly idFactory: () => string = () => crypto.randomBytes(24).toString('hex')
  ) {}

  public onDidInvalidate(
    listener: (event: LiveNotebookResultInvalidation) => void
  ): { dispose(): void } {
    this.invalidationListeners.add(listener);
    return { dispose: () => this.invalidationListeners.delete(listener) };
  }

  public register(registration: LiveNotebookResultRegistration): string {
    this.removeCell(registration.notebookUri, registration.cellUri);
    const id = this.uniqueId();
    this.bind(id, registration);
    return id;
  }

  public stage(registration: LiveNotebookResultRegistration): string {
    const stagedLimit = Math.max(1, Math.floor(this.maxEntries));
    const stagedCount = [...this.records.values()].filter(record => record.staged).length;
    if (stagedCount >= stagedLimit) {
      throw new Error(
        `Too many pending KX notebook results (${stagedLimit.toLocaleString()} maximum).`
      );
    }
    const id = this.uniqueId();
    this.records.set(id, {
      ...registration,
      id,
      createdAt: Date.now(),
      staged: true,
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

  public commitStaged(
    id: string,
    registration: LiveNotebookResultRegistration,
    previousCellUri: string
  ): void {
    const staged = this.records.get(id);
    if (!staged || !staged.staged || staged.notebookUri !== registration.notebookUri) {
      throw new Error('Staged KX notebook result is unavailable.');
    }
    const previousKey = cellKey(registration.notebookUri, previousCellUri);
    const targetKey = cellKey(registration.notebookUri, registration.cellUri);
    const replacedIds = new Set<string>();
    const previousId = this.cellResults.get(previousKey);
    const targetId = this.cellResults.get(targetKey);
    if (previousId && previousId !== id) {
      replacedIds.add(previousId);
    }
    if (targetId && targetId !== id) {
      replacedIds.add(targetId);
    }

    for (const replacedId of replacedIds) {
      this.discardRecord(replacedId, 'replaced');
    }
    this.cellResults.delete(previousKey);
    this.cellResults.delete(targetKey);
    this.records.set(id, {
      ...staged,
      ...registration,
      id,
      staged: false,
    });
    this.cellResults.set(targetKey, id);
    this.evictOldest(id);
  }

  public remove(id: string, notebookUri: string): void {
    const record = this.records.get(id);
    if (!record || record.notebookUri !== notebookUri) {
      return;
    }
    this.discardRecord(id, 'removed');
  }

  public removeCell(notebookUri: string, cellUri: string): void {
    const key = cellKey(notebookUri, cellUri);
    const id = this.cellResults.get(key);
    if (!id) {
      return;
    }
    if (this.pendingCellMoves.get(key) === id) {
      return;
    }
    this.discardRecord(id, 'output-unbound');
  }

  public beginCellMove(id: string, notebookUri: string, cellUri: string): boolean {
    const record = this.record(id, notebookUri);
    const key = cellKey(notebookUri, cellUri);
    if (!record || record.cellUri !== cellUri || this.cellResults.get(key) !== id ||
      this.pendingCellMoves.has(key)) {
      return false;
    }
    this.pendingCellMoves.set(key, id);
    return true;
  }

  public completeCellMove(
    id: string,
    notebookUri: string,
    previousCellUri: string,
    nextCellUri: string
  ): boolean {
    const previousKey = cellKey(notebookUri, previousCellUri);
    const nextKey = cellKey(notebookUri, nextCellUri);
    const record = this.record(id, notebookUri);
    if (this.pendingCellMoves.get(previousKey) !== id || !record ||
      record.cellUri !== previousCellUri) {
      return false;
    }
    const replacedId = this.cellResults.get(nextKey);
    if (replacedId && replacedId !== id) {
      this.discardRecord(replacedId, 'replaced');
    }
    this.cellResults.delete(previousKey);
    this.pendingCellMoves.delete(previousKey);
    record.cellUri = nextCellUri;
    this.cellResults.set(nextKey, id);
    return true;
  }

  public cancelCellMove(
    id: string,
    notebookUri: string,
    previousCellUri: string,
    removeResult = false
  ): void {
    const key = cellKey(notebookUri, previousCellUri);
    if (this.pendingCellMoves.get(key) !== id) {
      return;
    }
    this.pendingCellMoves.delete(key);
    if (removeResult) {
      this.remove(id, notebookUri);
    }
  }

  public closeNotebook(notebookUri: string): void {
    for (const [id, record] of [...this.records]) {
      if (record.notebookUri === notebookUri) {
        this.discardRecord(id, 'notebook-closed');
      }
    }
    for (const key of this.pendingCellMoves.keys()) {
      if (key.startsWith(`${notebookUri}\0`)) {
        this.pendingCellMoves.delete(key);
      }
    }
  }

  public clear(): void {
    for (const id of [...this.records.keys()]) {
      this.discardRecord(id, 'cleared');
    }
    this.cellResults.clear();
    this.pendingCellMoves.clear();
  }

  /**
   * Reconciles the session-only store with all live-result metadata currently
   * present in a notebook. This covers in-place output mutation and structural
   * cell replacement/moves; pending first-party moves remain protected until
   * their initiating edit re-resolves the final binding.
   */
  public reconcileNotebookBindings(
    notebookUri: string,
    bindings: readonly LiveNotebookOutputBinding[]
  ): void {
    const bindingsById = new Map<string, LiveNotebookOutputBinding[]>();
    for (const binding of bindings) {
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(binding.id) ||
        !/^[A-Za-z0-9_-]{32,128}$/.test(binding.outputId)) {
        continue;
      }
      let current = bindingsById.get(binding.id);
      if (!current) {
        current = [];
        bindingsById.set(binding.id, current);
      }
      current.push(binding);
    }

    for (const [id, record] of [...this.records]) {
      if (record.notebookUri !== notebookUri || record.staged) {
        continue;
      }
      const exact = (bindingsById.get(id) || []).filter(binding =>
        binding.outputId === record.outputId
      );
      if (exact.length === 0) {
        if (!this.pendingCellMoves.has(cellKey(notebookUri, record.cellUri))) {
          this.discardRecord(id, 'output-unbound');
        }
        continue;
      }
      if (exact.length !== 1) {
        const pendingKey = cellKey(notebookUri, record.cellUri);
        if (exact.length === 2 && this.pendingCellMoves.get(pendingKey) === id &&
          exact.filter(binding => binding.cellUri === record.cellUri).length === 1) {
          // An index-based public NotebookEdit can briefly expose the moving
          // live ID on both the original shifted cell and its stale-index
          // replacement. Keep the original owner protected until the move is
          // completed or canceled; compensation will remove the transient
          // duplicate before the token is released.
          continue;
        }
        this.discardRecord(id, 'duplicate-output');
        continue;
      }
      const nextCellUri = exact[0].cellUri;
      if (nextCellUri === record.cellUri ||
        this.pendingCellMoves.has(cellKey(notebookUri, record.cellUri))) {
        continue;
      }
      const previousKey = cellKey(notebookUri, record.cellUri);
      const nextKey = cellKey(notebookUri, nextCellUri);
      const replacedId = this.cellResults.get(nextKey);
      if (replacedId && replacedId !== id) {
        this.discardRecord(replacedId, 'replaced');
      }
      if (this.cellResults.get(previousKey) === id) {
        this.cellResults.delete(previousKey);
      }
      record.cellUri = nextCellUri;
      this.cellResults.set(nextKey, id);
    }
  }

  public has(id: string, notebookUri: string): boolean {
    return this.record(id, notebookUri) !== undefined;
  }

  public hasForCell(id: string, notebookUri: string, cellUri: string): boolean {
    const record = this.record(id, notebookUri);
    return record?.cellUri === cellUri;
  }

  public hasForOutput(
    id: string,
    notebookUri: string,
    cellUri: string,
    outputId: string
  ): boolean {
    const record = this.record(id, notebookUri);
    return record?.cellUri === cellUri && record.outputId === outputId;
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

  public portablePanel(
    id: string,
    notebookUri: string,
    options: LiveNotebookDisplayOptions = {}
  ): QPanelResult | undefined {
    const record = this.record(id, notebookUri);
    return record
      ? qValueToLosslessPortablePanel(record.value, options)
      : undefined;
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
    const columnOrdinals = validatedColumnOrdinals(
      request.columnOrdinals,
      table.columns.length,
      MAX_LIVE_NOTEBOOK_SLICE_COLUMNS
    );
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
    const startColumn = Math.max(0, Math.floor(request.startColumn));
    const rowCount = Math.min(
      MAX_LIVE_NOTEBOOK_SLICE_ROWS,
      Math.max(1, requestedEndRow - startRow + 1)
    );
    const columnCount = Math.min(
      columnOrdinals.length,
      Math.max(1, Math.floor(MAX_LIVE_NOTEBOOK_SLICE_CELLS / rowCount))
    );
    const selectedOrdinals = columnOrdinals.slice(0, columnCount);
    const endRow = Math.min(table.rowCount - 1, startRow + rowCount - 1);
    const endColumn = startColumn + columnCount - 1;
    const textOptions = cellTextOptions(options);
    let cells = liveSliceCells(
      table,
      startRow,
      endRow,
      selectedOrdinals,
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
        selectedOrdinals,
        textOptions,
        fairCellLimit
      )!;
    }
    return {
      startRow,
      endRow,
      startColumn,
      endColumn,
      columnOrdinals: selectedOrdinals,
      cells,
    };
  }

  public search(
    id: string,
    notebookUri: string,
    query: string,
    options: LiveNotebookDisplayOptions = {},
    sort?: Pick<LiveNotebookSliceRequest, 'sortOrdinal' | 'sortDirection'>
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
      ...(request.xMin !== undefined && request.xMax !== undefined
        ? { xMin: request.xMin, xMax: request.xMax }
        : {}),
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
    const columnOrdinals = validatedColumnOrdinals(
      request.columnOrdinals,
      table.columns.length,
      MAX_LIVE_NOTEBOOK_COPY_CELLS
    );
    if (table.rowCount === 0 || table.columns.length === 0 ||
      endRow < startRow || columnOrdinals.length === 0) {
      return '';
    }
    const cellCount = (endRow - startRow + 1) * columnOrdinals.length;
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
      columnOrdinals.map(ordinal => boundedLiveCellText(table.columns[ordinal], fairCellLimit)),
      table.rowCount,
      (rowIndex, columnIndex) => boundedLiveCellText(
        table.cellText(rowIndex, columnOrdinals[columnIndex], textOptions),
        fairCellLimit
      )
    );
    const text = bounded.toText(request.format, {
      startRow,
      endRow,
      startColumn: 0,
      endColumn: columnOrdinals.length - 1,
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
    return record?.notebookUri === notebookUri && !record.staged ? record : undefined;
  }

  private clearPendingCellMoves(id: string): void {
    for (const [key, pendingId] of this.pendingCellMoves) {
      if (pendingId === id) {
        this.pendingCellMoves.delete(key);
      }
    }
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
      this.discardRecord(replacedId, 'replaced');
    }
    this.records.set(id, {
      ...registration,
      id,
      createdAt: previous?.createdAt ?? Date.now(),
      staged: false,
      viewKey: previous?.viewKey,
      converted: previous?.converted,
      sortOrders: previous?.sortOrders ?? new Map<string, number[]>(),
    });
    this.cellResults.set(targetKey, id);
    this.evictOldest(id);
  }

  private evictOldest(protectedId?: string): void {
    const limit = Math.max(1, Math.floor(this.maxEntries));
    const committedCount = (): number => [...this.records.values()]
      .filter(record => !record.staged).length;
    while (committedCount() > limit) {
      let oldest: LiveNotebookRecord | undefined;
      for (const record of this.records.values()) {
        if (record.staged || record.id === protectedId) {
          continue;
        }
        if (!oldest || record.createdAt < oldest.createdAt) {
          oldest = record;
        }
      }
      if (!oldest) {
        return;
      }
      this.discardRecord(oldest.id, 'evicted');
    }
  }

  private discardRecord(id: string, reason: LiveNotebookInvalidationReason): void {
    const record = this.records.get(id);
    if (!record) {
      return;
    }
    const key = cellKey(record.notebookUri, record.cellUri);
    if (this.cellResults.get(key) === id) {
      this.cellResults.delete(key);
    }
    this.clearPendingCellMoves(id);
    this.records.delete(id);
    if (!record.staged) {
      const event: LiveNotebookResultInvalidation = {
        id,
        notebookUri: record.notebookUri,
        cellUri: record.cellUri,
        reason,
      };
      for (const listener of [...this.invalidationListeners]) {
        try {
          listener(event);
        } catch {
          // Store cleanup must not be held hostage by a UI listener.
        }
      }
    }
  }
}

function sortedTable(
  record: LiveNotebookRecord,
  table: ColumnarPanelResult,
  request: Pick<LiveNotebookSliceRequest, 'sortOrdinal' | 'sortDirection'>,
  options: LiveNotebookDisplayOptions
): ColumnarPanelResult {
  const sourceOrdinal = Number.isSafeInteger(request.sortOrdinal)
    ? request.sortOrdinal as number
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
  columnOrdinals: readonly number[],
  textOptions: CellTextOptions,
  cellLimit: number,
  aggregateLimit?: number
): string[][] | undefined {
  const cells: string[][] = [];
  let textChars = 0;
  for (let rowIndex = startRow; rowIndex <= endRow; rowIndex++) {
    const row: string[] = [];
    for (const columnIndex of columnOrdinals) {
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

function validatedColumnOrdinals(
  ordinals: readonly number[],
  sourceColumnCount: number,
  maximumCount: number
): number[] {
  if (!Array.isArray(ordinals) || ordinals.length < 1 ||
    ordinals.length > maximumCount ||
    ordinals.some(ordinal => !Number.isSafeInteger(ordinal) ||
      ordinal < 0 || ordinal >= sourceColumnCount) ||
    new Set(ordinals).size !== ordinals.length) {
    throw new Error('Requested result column order is invalid or unavailable.');
  }
  return ordinals.slice();
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
