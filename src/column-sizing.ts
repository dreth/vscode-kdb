import {
  CellTextOptions,
  ColumnarPanelResult,
  cellValueToBoundedText,
} from './kx-results';

export type KxColumnAutoFitMode = 'wholeResult' | 'visibleRows';
export interface PositionalColumnWidths {
  [position: string]: number;
}

export const KX_COLUMN_MIN_WIDTH = 80;
export const KX_COLUMN_MAX_WIDTH = 2_000;
export const KX_COLUMN_AUTO_WIDTH_CAP = 1_200;
export const KX_COLUMN_AUTO_FIT_YIELD_CELL_INTERVAL = 10_000;
export const KX_COLUMN_AUTO_TEXT_CHAR_LIMIT =
  Math.ceil(KX_COLUMN_AUTO_WIDTH_CAP / 7);

export class PositionalColumnWidthPersistenceQueue {
  private pendingWrite: Promise<void> = Promise.resolve();

  public constructor(
    private readonly read: () => unknown | PromiseLike<unknown>,
    private readonly write: (
      widths: PositionalColumnWidths
    ) => void | PromiseLike<void>,
    private readonly minWidth = KX_COLUMN_MIN_WIDTH,
    private readonly maxWidth = KX_COLUMN_MAX_WIDTH
  ) {}

  public update(
    transform: (current: PositionalColumnWidths) => unknown,
    afterWrite?: (
      widths: PositionalColumnWidths
    ) => void | PromiseLike<void>
  ): Promise<PositionalColumnWidths> {
    const operation = this.pendingWrite.then(async () => {
      const current = normalizePositionalColumnWidths(
        await this.read(),
        this.minWidth,
        this.maxWidth
      );
      const next = normalizePositionalColumnWidths(
        transform({ ...current }),
        this.minWidth,
        this.maxWidth
      );
      await this.write(next);
      if (afterWrite) {
        await afterWrite(next);
      }
      return next;
    });
    this.pendingWrite = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }
}

export function normalizeColumnAutoFitMode(value: unknown): KxColumnAutoFitMode {
  return value === 'visibleRows' ? 'visibleRows' : 'wholeResult';
}

/**
 * Normalizes persisted widths without attaching them to a query or column
 * name. Legacy array state is migrated to the same sparse positional map; its
 * zero/sub-minimum sentinel entries remain unset. Only canonical nonnegative
 * integer keys are retained from map-shaped state.
 */
export function normalizePositionalColumnWidths(
  value: unknown,
  minWidth = KX_COLUMN_MIN_WIDTH,
  maxWidth = KX_COLUMN_MAX_WIDTH
): PositionalColumnWidths {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const min = Number.isFinite(minWidth)
    ? Math.floor(minWidth)
    : KX_COLUMN_MIN_WIDTH;
  const max = Number.isFinite(maxWidth)
    ? Math.max(min, Math.floor(maxWidth))
    : KX_COLUMN_MAX_WIDTH;
  const legacyArray = Array.isArray(value);
  const source: { [position: string]: unknown } = legacyArray
    ? value.reduce((mapped: { [position: string]: unknown }, item, index) => {
      if (item !== null && item !== undefined) {
        mapped[String(index)] = item;
      }
      return mapped;
    }, {})
    : value as { [position: string]: unknown };
  const widths: PositionalColumnWidths = {};
  Object.keys(source).forEach(key => {
    if (!/^(0|[1-9]\d*)$/.test(key)) {
      return;
    }
    const rawWidth = source[key];
    if (rawWidth === null || rawWidth === undefined ||
      typeof rawWidth === 'boolean' || rawWidth === '') {
      return;
    }
    const width = Number(rawWidth);
    if (!Number.isFinite(width) || (legacyArray && width < min)) {
      return;
    }
    widths[key] = Math.min(Math.max(Math.floor(width), min), max);
  });
  return widths;
}

export function positionalColumnWidthEntries(
  value: unknown
): Array<[number, number]> {
  const widths = normalizePositionalColumnWidths(value);
  return Object.keys(widths)
    .map(key => [Number(key), widths[key]] as [number, number])
    .sort((left, right) => left[0] - right[0]);
}

export function hasPositionalColumnWidths(value: unknown): boolean {
  return Object.keys(normalizePositionalColumnWidths(value)).length > 0;
}

function canonicalPosition(value: unknown): string | null {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.floor(number) !== number || number < 0) {
    return null;
  }
  return String(number);
}

export function updatePositionalColumnWidth(
  value: unknown,
  position: unknown,
  width: unknown,
  minWidth = KX_COLUMN_MIN_WIDTH,
  maxWidth = KX_COLUMN_MAX_WIDTH
): PositionalColumnWidths {
  const widths = normalizePositionalColumnWidths(value, minWidth, maxWidth);
  const key = canonicalPosition(position);
  if (key === null) {
    return widths;
  }
  if (width === null || width === undefined) {
    delete widths[key];
    return widths;
  }
  const normalized = normalizePositionalColumnWidths(
    { [key]: width },
    minWidth,
    maxWidth
  );
  if (Object.prototype.hasOwnProperty.call(normalized, key)) {
    widths[key] = normalized[key];
  } else {
    delete widths[key];
  }
  return widths;
}

/**
 * Maps the current visible/reordered columns back to their original source
 * ordinals so a width stays attached to one positional source slot.
 */
export function displayedSourceColumnPositions(
  sourceColumns: readonly string[],
  displayedColumns: readonly string[]
): number[] {
  const used = new Set<number>();
  return displayedColumns.map((column, displayedPosition) => {
    const sourcePosition = sourceColumns.findIndex(
      (candidate, position) => candidate === column && !used.has(position)
    );
    const position = sourcePosition >= 0 ? sourcePosition : displayedPosition;
    used.add(position);
    return position;
  });
}

export function resolvedColumnWidth(
  zeroBasedPosition: number,
  baseWidth: number,
  positionalWidths: unknown,
  autoFitEnabled: boolean,
  automaticWidths: unknown = {}
): number {
  const fallback = clampColumnWidth(baseWidth);
  const position = Number(zeroBasedPosition);
  if (!Number.isFinite(position) || Math.floor(position) !== position ||
    position < 0) {
    return fallback;
  }
  const widthAt = (widths: unknown): number | undefined => {
    if (!widths || typeof widths !== 'object') {
      return undefined;
    }
    const width = (widths as { [position: string]: unknown })[String(position)];
    return width !== null && width !== undefined &&
      Number.isFinite(Number(width))
      ? clampColumnWidth(Number(width))
      : undefined;
  };
  return widthAt(positionalWidths) ??
    (autoFitEnabled ? widthAt(automaticWidths) : undefined) ??
    fallback;
}

export function clampColumnWidth(width: number): number {
  const finite = Number.isFinite(width) ? Math.round(width) : KX_COLUMN_MIN_WIDTH;
  return Math.min(KX_COLUMN_MAX_WIDTH, Math.max(KX_COLUMN_MIN_WIDTH, finite));
}

export function measuredColumnTextWidth(
  textLength: number,
  fontSize: number,
  horizontalPadding: number,
  maximum = KX_COLUMN_AUTO_WIDTH_CAP
): number {
  const length = Math.max(0, safeInteger(textLength, 0));
  const safeFontSize = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 13;
  const characterWidth = Math.max(7, safeFontSize * 0.58);
  const desired = Math.ceil(
    length * characterWidth +
    Math.max(0, Number(horizontalPadding) || 0) * 2 +
    18
  );
  return Math.min(clampColumnWidth(maximum), clampColumnWidth(desired));
}

/**
 * Scans the complete displayed table, including values that are outside every
 * virtual viewport. Only lengths are retained so a very wide value is not
 * duplicated into a webview message.
 */
export function widestDisplayedColumnTextLengths(
  table: ColumnarPanelResult,
  options: CellTextOptions = {}
): number[] {
  const lengths = table.columns.map(column =>
    Math.min(String(column).length, KX_COLUMN_AUTO_TEXT_CHAR_LIMIT));
  let unfinishedColumns = lengths.reduce(
    (count, length) => count + Number(length < KX_COLUMN_AUTO_TEXT_CHAR_LIMIT),
    0
  );
  for (let row = 0; row < table.rowCount; row += 1) {
    if (unfinishedColumns === 0) {
      break;
    }
    for (let column = 0; column < table.columns.length; column += 1) {
      if (lengths[column] >= KX_COLUMN_AUTO_TEXT_CHAR_LIMIT) {
        continue;
      }
      const bounded = cellValueToBoundedText(
        table.cellValue(row, column),
        KX_COLUMN_AUTO_TEXT_CHAR_LIMIT,
        options
      );
      const previous = lengths[column];
      lengths[column] = Math.max(
        lengths[column],
        bounded.truncated
          ? KX_COLUMN_AUTO_TEXT_CHAR_LIMIT
          : bounded.text.length
      );
      if (previous < KX_COLUMN_AUTO_TEXT_CHAR_LIMIT &&
        lengths[column] >= KX_COLUMN_AUTO_TEXT_CHAR_LIMIT) {
        unfinishedColumns -= 1;
      }
    }
  }
  return lengths;
}

export interface ColumnTextLengthScanControl {
  yieldEveryCells?: number;
  continueScanning?: () => boolean;
  yieldNow?: () => Promise<void>;
}

/**
 * Cooperative host-side variant for unbounded live/full results. It retains
 * exact whole-result semantics while yielding often enough for newer results,
 * cancellation, and renderer messages to invalidate stale work.
 */
export async function widestDisplayedColumnTextLengthsAsync(
  table: ColumnarPanelResult,
  options: CellTextOptions = {},
  control: ColumnTextLengthScanControl = {}
): Promise<number[] | undefined> {
  const lengths = table.columns.map(column =>
    Math.min(String(column).length, KX_COLUMN_AUTO_TEXT_CHAR_LIMIT));
  let unfinishedColumns = lengths.reduce(
    (count, length) => count + Number(length < KX_COLUMN_AUTO_TEXT_CHAR_LIMIT),
    0
  );
  const yieldEveryCells = Math.max(
    1,
    safeInteger(
      control.yieldEveryCells,
      KX_COLUMN_AUTO_FIT_YIELD_CELL_INTERVAL
    )
  );
  const continueScanning = control.continueScanning || (() => true);
  const yieldNow = control.yieldNow || yieldToEventLoop;
  let cellsSinceYield = 0;
  if (!continueScanning()) {
    return undefined;
  }
  for (let row = 0; row < table.rowCount; row += 1) {
    if (unfinishedColumns === 0) {
      break;
    }
    for (let column = 0; column < table.columns.length; column += 1) {
      cellsSinceYield += 1;
      if (cellsSinceYield >= yieldEveryCells) {
        cellsSinceYield = 0;
        await yieldNow();
        if (!continueScanning()) {
          return undefined;
        }
      }
      if (lengths[column] >= KX_COLUMN_AUTO_TEXT_CHAR_LIMIT) {
        continue;
      }
      const bounded = cellValueToBoundedText(
        table.cellValue(row, column),
        KX_COLUMN_AUTO_TEXT_CHAR_LIMIT,
        options
      );
      const previous = lengths[column];
      lengths[column] = Math.max(
        lengths[column],
        bounded.truncated
          ? KX_COLUMN_AUTO_TEXT_CHAR_LIMIT
          : bounded.text.length
      );
      if (previous < KX_COLUMN_AUTO_TEXT_CHAR_LIMIT &&
        lengths[column] >= KX_COLUMN_AUTO_TEXT_CHAR_LIMIT) {
        unfinishedColumns -= 1;
      }
    }
  }
  return continueScanning() ? lengths : undefined;
}

export function automaticColumnWidthsForLengths(
  textLengths: readonly number[],
  fontSize: number,
  horizontalPadding: number
): number[] {
  return textLengths.map(length =>
    measuredColumnTextWidth(length, fontSize, horizontalPadding));
}

export interface VariableColumnMetrics {
  lefts: number[];
  widths: number[];
  totalWidth: number;
}

export function variableColumnMetrics(widths: readonly number[]): VariableColumnMetrics {
  const lefts: number[] = [];
  const normalized: number[] = [];
  let totalWidth = 0;
  widths.forEach((width, index) => {
    lefts[index] = totalWidth;
    normalized[index] = clampColumnWidth(width);
    totalWidth += normalized[index];
  });
  return { lefts, widths: normalized, totalWidth };
}

export function variableVisibleColumnRange(
  widths: readonly number[],
  scrollOffset: number,
  viewportWidth: number,
  overscan = 0
): { start: number; end: number } {
  if (widths.length === 0 || viewportWidth <= 0) {
    return { start: 0, end: -1 };
  }
  const metrics = variableColumnMetrics(widths);
  const offset = Math.max(0, Number(scrollOffset) || 0);
  const endOffset = offset + Math.max(1, Number(viewportWidth) || 1);
  const safeOverscan = Math.max(0, safeInteger(overscan, 0));
  const first = firstIntersectingColumn(metrics, offset);
  const last = lastIntersectingColumn(metrics, endOffset);
  return {
    start: Math.max(0, first - safeOverscan),
    end: Math.min(metrics.widths.length - 1, last + safeOverscan),
  };
}

function firstIntersectingColumn(metrics: VariableColumnMetrics, offset: number): number {
  let low = 0;
  let high = metrics.widths.length - 1;
  let result = high;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (metrics.lefts[middle] + metrics.widths[middle] > offset) {
      result = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  return result;
}

function lastIntersectingColumn(metrics: VariableColumnMetrics, offset: number): number {
  let low = 0;
  let high = metrics.widths.length - 1;
  let result = low;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (metrics.lefts[middle] < offset) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

function safeInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : fallback;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}
