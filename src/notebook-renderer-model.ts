import {
  ChartType,
  ChartTypeCapabilities,
  chartTypeCapabilities,
} from './charting';

export interface NotebookCellSelection {
  anchorRow: number;
  anchorColumn: number;
  focusRow: number;
  focusColumn: number;
}

export interface NotebookCellRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

export interface NotebookGridWindowInput {
  rowCount: number;
  columnCount: number;
  scrollTop: number;
  scrollLeft: number;
  viewportWidth: number;
  viewportHeight: number;
  rowHeight: number;
  cellWidth: number;
  rowIndexWidth: number;
  headerHeight: number;
  rowOverscan: number;
  columnOverscan: number;
  maxRows: number;
  maxColumns: number;
  maxCells: number;
}

export interface NotebookGridWindow {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

export type NotebookCopyFormat = 'tsv' | 'csv';

export const NOTEBOOK_GRID_MIN_HEIGHT = 72;
export const NOTEBOOK_GRID_DEFAULT_MAX_HEIGHT = 420;
export const NOTEBOOK_GRID_RESIZE_MAX_HEIGHT = 900;
export const NOTEBOOK_CHART_MAX_Y_COLUMNS = 16;

export function notebookGridDefaultHeight(
  rowCount: number,
  rowHeight: number,
  headerHeight: number,
  maximum = NOTEBOOK_GRID_DEFAULT_MAX_HEIGHT
): number {
  const rows = Math.max(1, nonNegativeInteger(rowCount));
  const natural = positiveInteger(headerHeight, 30) + rows * positiveInteger(rowHeight, 28) + 2;
  return Math.min(
    Math.max(NOTEBOOK_GRID_MIN_HEIGHT, positiveInteger(maximum, NOTEBOOK_GRID_DEFAULT_MAX_HEIGHT)),
    Math.max(NOTEBOOK_GRID_MIN_HEIGHT, natural)
  );
}

export function notebookGridResizedHeight(value: number): number {
  const height = Number.isFinite(value) ? Math.round(value) : NOTEBOOK_GRID_DEFAULT_MAX_HEIGHT;
  return Math.min(
    NOTEBOOK_GRID_RESIZE_MAX_HEIGHT,
    Math.max(NOTEBOOK_GRID_MIN_HEIGHT, height)
  );
}

export function notebookGridWindow(input: NotebookGridWindowInput): NotebookGridWindow {
  const rowCount = nonNegativeInteger(input.rowCount);
  const columnCount = nonNegativeInteger(input.columnCount);
  if (columnCount === 0) {
    return { startRow: 0, endRow: -1, startColumn: 0, endColumn: -1 };
  }
  const rowHeight = positiveInteger(input.rowHeight, 28);
  const cellWidth = positiveInteger(input.cellWidth, 160);
  const rowOverscan = nonNegativeInteger(input.rowOverscan);
  const columnOverscan = nonNegativeInteger(input.columnOverscan);
  const rawStartRow = Math.floor(
    Math.max(0, finiteNumber(input.scrollTop) - nonNegativeInteger(input.headerHeight)) / rowHeight
  );
  const rawStartColumn = Math.floor(
    Math.max(0, finiteNumber(input.scrollLeft) - nonNegativeInteger(input.rowIndexWidth)) / cellWidth
  );
  const visibleRows = Math.max(1, Math.ceil(positiveInteger(input.viewportHeight, 1) / rowHeight));
  const visibleColumns = Math.max(
    1,
    Math.ceil(
      Math.max(1, positiveInteger(input.viewportWidth, 1) - nonNegativeInteger(input.rowIndexWidth)) /
      cellWidth
    )
  );
  const startRow = Math.max(0, rawStartRow - rowOverscan);
  const startColumn = Math.max(0, rawStartColumn - columnOverscan);
  const maxRows = Math.max(1, positiveInteger(input.maxRows, visibleRows));
  const maxColumns = Math.max(1, positiveInteger(input.maxColumns, visibleColumns));
  let endRow = rowCount === 0
    ? -1
    : Math.min(
      rowCount - 1,
      startRow + Math.min(maxRows, visibleRows + rowOverscan * 2) - 1
    );
  let endColumn = Math.min(
    columnCount - 1,
    startColumn + Math.min(maxColumns, visibleColumns + columnOverscan * 2) - 1
  );
  const renderedRows = Math.max(1, endRow - startRow + 1);
  const maxCells = Math.max(1, positiveInteger(input.maxCells, renderedRows));
  endColumn = Math.min(
    endColumn,
    startColumn + Math.max(1, Math.floor(maxCells / renderedRows)) - 1
  );
  endRow = rowCount === 0 ? -1 : Math.max(startRow, endRow);
  endColumn = Math.max(startColumn, endColumn);
  return { startRow, endRow, startColumn, endColumn };
}

export function notebookSelectionForCell(
  previous: NotebookCellSelection | undefined,
  row: number,
  column: number,
  extend: boolean
): NotebookCellSelection {
  const focusRow = nonNegativeInteger(row);
  const focusColumn = nonNegativeInteger(column);
  if (extend && previous) {
    return { ...previous, focusRow, focusColumn };
  }
  return {
    anchorRow: focusRow,
    anchorColumn: focusColumn,
    focusRow,
    focusColumn,
  };
}

export function notebookMoveSelection(
  previous: NotebookCellSelection | undefined,
  rowDelta: number,
  columnDelta: number,
  extend: boolean,
  rowCount: number,
  columnCount: number
): NotebookCellSelection | undefined {
  if (rowCount < 1 || columnCount < 1) {
    return undefined;
  }
  const current = previous ?? {
    anchorRow: 0,
    anchorColumn: 0,
    focusRow: 0,
    focusColumn: 0,
  };
  const focusRow = boundedIndex(current.focusRow + Math.trunc(rowDelta), rowCount);
  const focusColumn = boundedIndex(current.focusColumn + Math.trunc(columnDelta), columnCount);
  return extend
    ? { ...current, focusRow, focusColumn }
    : {
      anchorRow: focusRow,
      anchorColumn: focusColumn,
      focusRow,
      focusColumn,
    };
}

export function notebookSelectionRange(
  selection: NotebookCellSelection | undefined
): NotebookCellRange | undefined {
  if (!selection) {
    return undefined;
  }
  return {
    startRow: Math.min(selection.anchorRow, selection.focusRow),
    endRow: Math.max(selection.anchorRow, selection.focusRow),
    startColumn: Math.min(selection.anchorColumn, selection.focusColumn),
    endColumn: Math.max(selection.anchorColumn, selection.focusColumn),
  };
}

export function notebookCellSelected(
  selection: NotebookCellSelection | undefined,
  row: number,
  column: number
): boolean {
  const range = notebookSelectionRange(selection);
  return !!range &&
    row >= range.startRow && row <= range.endRow &&
    column >= range.startColumn && column <= range.endColumn;
}

export function notebookSelectionCellCount(
  selection: NotebookCellSelection | undefined
): number {
  const range = notebookSelectionRange(selection);
  return range
    ? (range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1)
    : 0;
}

export function notebookSelectionCopyAllowed(
  selection: NotebookCellSelection | undefined,
  maximumCells: number
): boolean {
  const cells = notebookSelectionCellCount(selection);
  return cells > 0 && cells <= Math.max(0, nonNegativeInteger(maximumCells));
}

export interface NotebookSelectionToolsState {
  visible: boolean;
  open: boolean;
  copyEnabled: boolean;
}

export function notebookSelectionToolsState(
  selection: NotebookCellSelection | undefined,
  maximumCells: number,
  requestedOpen: boolean
): NotebookSelectionToolsState {
  const visible = notebookSelectionCopyAllowed(selection, maximumCells);
  return {
    visible,
    open: visible && requestedOpen,
    copyEnabled: visible,
  };
}

export type NotebookSearchEnterAction = 'request' | 'next' | 'previous';

export function notebookSearchEnterAction(
  matchCount: number,
  pending: boolean,
  shiftKey: boolean
): NotebookSearchEnterAction {
  if (Math.max(0, nonNegativeInteger(matchCount)) < 1 || pending) {
    return 'request';
  }
  return shiftKey ? 'previous' : 'next';
}

export interface NotebookSavedSearchMatch {
  displayRow: number;
  sourceRow: number;
}

export function notebookSavedSearchMatches(
  rowTexts: readonly (readonly string[])[],
  rowOrder: readonly number[],
  query: string,
  maximumMatches: number
): { matches: NotebookSavedSearchMatch[]; capped: boolean } {
  const needle = query.toLocaleLowerCase();
  const maximum = Math.max(0, nonNegativeInteger(maximumMatches));
  if (!needle || maximum === 0) {
    return { matches: [], capped: false };
  }
  const matches: NotebookSavedSearchMatch[] = [];
  let capped = false;
  for (let displayRow = 0; displayRow < rowOrder.length; displayRow += 1) {
    const sourceRow = rowOrder[displayRow];
    if (!Number.isSafeInteger(sourceRow) || sourceRow < 0 || sourceRow >= rowTexts.length ||
      !rowTexts[sourceRow].some(value => value.toLocaleLowerCase().includes(needle))) {
      continue;
    }
    if (matches.length >= maximum) {
      capped = true;
      break;
    }
    matches.push({ displayRow, sourceRow });
  }
  return { matches, capped };
}

export function notebookMovedSearchMatchIndex(
  activeIndex: number,
  matchCount: number,
  direction: number
): number {
  const count = nonNegativeInteger(matchCount);
  if (count < 1) {
    return -1;
  }
  const current = Number.isSafeInteger(activeIndex) && activeIndex >= 0 && activeIndex < count
    ? activeIndex
    : direction < 0 ? 0 : -1;
  return (current + (direction < 0 ? -1 : 1) + count) % count;
}

export function notebookDelimitedRangeText(
  columns: readonly string[],
  selection: NotebookCellSelection,
  format: NotebookCopyFormat,
  includeHeaders: boolean,
  cellText: (row: number, column: number) => string,
  includeRowIndex = false
): string {
  const range = notebookSelectionRange(selection)!;
  const delimiter = format === 'csv' ? ',' : '\t';
  const lines: string[] = [];
  if (includeHeaders) {
    const headers: string[] = [];
    if (includeRowIndex) {
      let rowHeader = '#';
      let suffix = 1;
      while (columns.slice(range.startColumn, range.endColumn + 1).includes(rowHeader)) {
        rowHeader = `#_${suffix++}`;
      }
      headers.push(delimitedCell(rowHeader, delimiter));
    }
    for (let column = range.startColumn; column <= range.endColumn; column += 1) {
      headers.push(delimitedCell(columns[column] || '', delimiter));
    }
    lines.push(headers.join(delimiter));
  }
  for (let row = range.startRow; row <= range.endRow; row += 1) {
    const cells: string[] = [];
    if (includeRowIndex) {
      cells.push(String(row + 1));
    }
    for (let column = range.startColumn; column <= range.endColumn; column += 1) {
      cells.push(delimitedCell(cellText(row, column), delimiter));
    }
    lines.push(cells.join(delimiter));
  }
  return lines.join('\n');
}

export function reconcileNotebookChartYColumns(
  eligibleColumns: readonly string[],
  xColumn: string,
  current: readonly string[],
  limit = NOTEBOOK_CHART_MAX_Y_COLUMNS
): string[] {
  const eligible = new Set(eligibleColumns.filter(column => column !== xColumn));
  const selected: string[] = [];
  for (const column of current) {
    if (eligible.has(column) && !selected.includes(column)) {
      selected.push(column);
      if (selected.length >= Math.max(1, Math.min(NOTEBOOK_CHART_MAX_Y_COLUMNS, limit))) {
        break;
      }
    }
  }
  if (selected.length === 0) {
    const fallback = eligibleColumns.find(column => column !== xColumn);
    if (fallback) {
      selected.push(fallback);
    }
  }
  return selected;
}

export function toggleNotebookChartYColumn(
  eligibleColumns: readonly string[],
  xColumn: string,
  current: readonly string[],
  column: string,
  checked: boolean
): string[] {
  const selected = reconcileNotebookChartYColumns(eligibleColumns, xColumn, current);
  if (column === xColumn || !eligibleColumns.includes(column)) {
    return selected;
  }
  if (checked) {
    return reconcileNotebookChartYColumns(
      eligibleColumns,
      xColumn,
      [...selected, column]
    );
  }
  if (!selected.includes(column) || selected.length === 1) {
    return selected;
  }
  return selected.filter(value => value !== column);
}

export type NotebookRendererChartType =
  | 'line'
  | 'scatter'
  | 'step'
  | 'bar'
  | 'box'
  | 'candlestick';

export interface NotebookRendererChartConfiguration {
  visible: boolean;
  chartType: NotebookRendererChartType;
  xColumn: string;
  yColumns: string[];
  groupByColumn: string;
  openColumn: string;
  highColumn: string;
  lowColumn: string;
  closeColumn: string;
}

export interface NotebookChartControlConfiguration {
  chartType: ChartType;
  xColumn: string;
  yColumns: readonly string[];
  groupByColumn?: string;
  openColumn?: string;
  highColumn?: string;
  lowColumn?: string;
  closeColumn?: string;
}

export interface NotebookChartControlModel {
  capabilities: ChartTypeCapabilities;
  yColumns: string[];
  groupColumns: string[];
  validationMessage: string;
}

export function notebookChartControlModel(
  configuration: NotebookChartControlConfiguration,
  xColumns: readonly string[],
  numericColumns: readonly string[],
  groupColumns: readonly string[]
): NotebookChartControlModel {
  const capabilities = chartTypeCapabilities(configuration.chartType);
  const yColumns = numericColumns.filter(name => name !== configuration.xColumn);
  const eligibleGroupColumns = capabilities.supportsGroupBy ? [...groupColumns] : [];
  let validationMessage = '';
  if (!configuration.xColumn || !xColumns.includes(configuration.xColumn)) {
    validationMessage = 'Select one numeric or temporal X column.';
  } else if (capabilities.usesOhlc) {
    const entries = [
      ['Open', configuration.openColumn || ''],
      ['High', configuration.highColumn || ''],
      ['Low', configuration.lowColumn || ''],
      ['Close', configuration.closeColumn || ''],
    ];
    const missing = entries.filter(([, value]) => !value).map(([label]) => label);
    const values = entries.map(([, value]) => value);
    if (missing.length > 0) {
      validationMessage =
        `Select numeric ${missing.join(', ')} column${missing.length === 1 ? '' : 's'}.`;
    } else if (new Set(values).size !== values.length) {
      validationMessage = 'Open, High, Low, and Close must use four distinct numeric columns.';
    } else if (values.some(value => !yColumns.includes(value))) {
      validationMessage = 'Candlestick fields must use numeric columns available in this result.';
    }
  } else if (configuration.yColumns.length === 0 ||
    configuration.yColumns.some(value => !yColumns.includes(value))) {
    validationMessage = 'Select at least one numeric Y column distinct from X.';
  } else if (capabilities.supportsGroupBy && configuration.groupByColumn &&
    !eligibleGroupColumns.includes(configuration.groupByColumn)) {
    validationMessage = 'Selected Group by column is unavailable.';
  }
  return {
    capabilities,
    yColumns,
    groupColumns: eligibleGroupColumns,
    validationMessage,
  };
}

export function reconcileNotebookChartConfiguration(
  previous: NotebookRendererChartConfiguration,
  xColumns: readonly string[],
  yColumns: readonly string[],
  groupColumns: readonly string[]
): { configuration: NotebookRendererChartConfiguration; compatible: boolean } {
  const defaultX = xColumns.find(name => yColumns.some(candidate => candidate !== name)) ||
    xColumns[0] || '';
  const xColumn = xColumns.includes(previous.xColumn) ? previous.xColumn : defaultX;
  const selectedY = reconcileNotebookChartYColumns(
    yColumns,
    xColumn,
    previous.yColumns
  );
  const supportsGroup = previous.chartType === 'line' ||
    previous.chartType === 'scatter' ||
    previous.chartType === 'step' ||
    previous.chartType === 'bar';
  const groupByColumn = supportsGroup && groupColumns.includes(previous.groupByColumn)
    ? previous.groupByColumn
    : '';
  const roleColumn = (current: string, role: string): string => {
    if (yColumns.includes(current)) {
      return current;
    }
    const normalized = role.toLocaleLowerCase();
    const matches = yColumns.filter(name => name.trim().toLocaleLowerCase() === normalized);
    return matches.length === 1 ? matches[0] : '';
  };
  const configuration: NotebookRendererChartConfiguration = {
    visible: previous.visible,
    chartType: previous.chartType,
    xColumn,
    yColumns: selectedY,
    groupByColumn,
    openColumn: roleColumn(previous.openColumn, 'open'),
    highColumn: roleColumn(previous.highColumn, 'high'),
    lowColumn: roleColumn(previous.lowColumn, 'low'),
    closeColumn: roleColumn(previous.closeColumn, 'close'),
  };
  const sameY = previous.yColumns.length === selectedY.length &&
    previous.yColumns.every((value, index) => value === selectedY[index]);
  const compatible = previous.xColumn === xColumn && (
    previous.chartType === 'candlestick'
      ? previous.openColumn === configuration.openColumn &&
        previous.highColumn === configuration.highColumn &&
        previous.lowColumn === configuration.lowColumn &&
        previous.closeColumn === configuration.closeColumn
      : sameY && (!supportsGroup || previous.groupByColumn === groupByColumn)
  );
  return { configuration, compatible };
}

function delimitedCell(value: string, delimiter: string): string {
  const text = String(value);
  return text.includes(delimiter) || /["\r\n]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

function boundedIndex(value: number, count: number): number {
  return Math.min(Math.max(0, count - 1), Math.max(0, Math.trunc(value)));
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function finiteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
