import {
  cellValueToBoundedText,
  ColumnarPanelResult,
} from './kx-results';
import {
  isQAtom,
  isQGeneralNull,
  qValueToBoundedLiteral,
  QAtom,
  QSpecialKind,
} from './q-value';
import { normalizeQTypeName, qTypeChartColumnKind } from './q-type';

export const KX_COLUMN_SUMMARY_SCHEMA_VERSION = 1 as const;
export const KX_COLUMN_SUMMARY_EXACT_MAX_ROWS = 50_000;
export const KX_COLUMN_SUMMARY_MAX_EVALUATED_CELLS = 100_000;
export const KX_COLUMN_SUMMARY_SAMPLE_MAX_ROWS = 10_000;
export const KX_COLUMN_SUMMARY_FREQUENT_VALUE_LIMIT = 5;
export const KX_COLUMN_SUMMARY_VALUE_MAX_CHARS = 160;
export const KX_COLUMN_SUMMARY_DEFAULT_YIELD_CELLS = 4_096;

export type KxColumnSummaryMode = 'exact' | 'sampled';
export type KxColumnSummaryAlgorithm = 'allRows' | 'evenlySpacedRows';
export type KxColumnSummaryKind = 'numeric' | 'temporal' | 'text' | 'other';

export interface KxColumnSummaryValue {
  text: string;
  truncated: boolean;
  /** True when the value was calculated rather than copied from a source cell. */
  derived?: boolean;
  /** True when a derived decimal required floating-point or bounded-decimal approximation. */
  approximate?: boolean;
}

export interface KxColumnSummaryFrequentValue extends KxColumnSummaryValue {
  /** Occurrences in the evaluated rows, not an estimate for unevaluated rows. */
  count: number;
}

export interface KxColumnSummary {
  /** Stable zero-based position in the unprojected decoded result. */
  sourceColumnPosition: number;
  columnName: string;
  columnType?: string;
  kind: KxColumnSummaryKind;
  totalRowCount: number;
  evaluatedRowCount: number;
  validCount: number;
  nullCount: number;
  /** Exact for all evaluated scalar values; never extrapolated from a sample. */
  distinctCount: number;
  /** True only when every source row was evaluated and scalar equality was exact. */
  distinctComplete: boolean;
  /** Values compatible with this column's kind-specific metrics. */
  metricValueCount: number;
  /** False when non-null values were incompatible with the kind-specific metrics. */
  metricsComplete: boolean;
  min?: KxColumnSummaryValue;
  max?: KxColumnSummaryValue;
  mean?: KxColumnSummaryValue;
  median?: KxColumnSummaryValue;
  meanUnavailableReason?: 'bothPositiveAndNegativeInfinity';
  medianUnavailableReason?: 'bothPositiveAndNegativeInfinity';
  metricUnavailableReason?: 'mixedTemporalTypes';
  frequentValues?: KxColumnSummaryFrequentValue[];
}

export interface KxColumnSummaryBatch {
  schemaVersion: typeof KX_COLUMN_SUMMARY_SCHEMA_VERSION;
  mode: KxColumnSummaryMode;
  algorithm: KxColumnSummaryAlgorithm;
  totalRowCount: number;
  evaluatedRowCount: number;
  evaluatedCellCount: number;
  columnCount: number;
  /** Normally true; false only when the table is too wide to evaluate both endpoints within budget. */
  endpointsIncluded: boolean;
  columns: KxColumnSummary[];
}

export interface KxColumnSummaryPlan {
  mode: KxColumnSummaryMode;
  algorithm: KxColumnSummaryAlgorithm;
  totalRowCount: number;
  columnCount: number;
  evaluatedRowCount: number;
  evaluatedCellCount: number;
  endpointsIncluded: boolean;
  rowIndexes: number[];
}

export interface ComputeResultColumnSummariesOptions {
  /** Checked before work, at cooperative yield points, and before returning. */
  shouldCancel?: () => boolean;
  /** Optional abort-like state without coupling this pure module to VS Code cancellation types. */
  signal?: { readonly aborted: boolean };
  /** Defaults to 4,096 cells. Values below one use the default. */
  yieldEveryCells?: number;
  /** Injectable for deterministic tests. Defaults to yielding to the Node event loop. */
  yieldControl?: () => void | Promise<void>;
}

interface DistinctIdentityState {
  nextIdentity: number;
  scalarIdentities: Map<string, Map<unknown, number>>;
  objectIdentities: WeakMap<object, number>;
}

interface DistinctKey {
  key: number;
  exact: boolean;
}

interface FrequencyEntry {
  value: unknown;
  count: number;
  firstSeen: number;
}

interface OrderedSemanticValue {
  value: number | bigint;
  infinity: -1 | 0 | 1;
}

interface NumericObservation extends OrderedSemanticValue {
  raw: unknown;
}

interface TemporalObservation extends OrderedSemanticValue {
  raw: unknown;
  type: string;
}

const Q_NUMERIC_TYPES = new Set(['byte', 'short', 'int', 'long', 'real', 'float']);
const Q_INT32_NUMERIC_TYPES = new Set(['byte', 'short', 'int']);
const Q_INT32_TEMPORAL_TYPES = new Set(['month', 'date', 'minute', 'second', 'time']);
const Q_INT64_TEMPORAL_TYPES = new Set(['timestamp', 'timespan']);

/**
 * Selects a deterministic, bounded row set. Exact mode includes both the row
 * and cell limits. Sampled mode uses evenly spaced source rows and includes
 * the first and last row whenever the cell budget permits at least two rows.
 */
export function planResultColumnSummaries(result: ColumnarPanelResult): KxColumnSummaryPlan {
  const totalRowCount = nonNegativeSafeInteger(result.rowCount);
  const columnCount = result.columns.length;
  const exactCellRows = columnCount === 0
    ? Number.MAX_SAFE_INTEGER
    : Math.floor(KX_COLUMN_SUMMARY_MAX_EVALUATED_CELLS / columnCount);
  const exact = totalRowCount <= KX_COLUMN_SUMMARY_EXACT_MAX_ROWS &&
    totalRowCount <= exactCellRows;

  if (exact) {
    const rowIndexes = rangeIndexes(totalRowCount);
    return {
      mode: 'exact',
      algorithm: 'allRows',
      totalRowCount,
      columnCount,
      evaluatedRowCount: rowIndexes.length,
      evaluatedCellCount: rowIndexes.length * columnCount,
      endpointsIncluded: totalRowCount === 0 || rowIndexes.length === totalRowCount,
      rowIndexes,
    };
  }

  const cellBudgetRows = columnCount === 0
    ? KX_COLUMN_SUMMARY_SAMPLE_MAX_ROWS
    : Math.floor(KX_COLUMN_SUMMARY_MAX_EVALUATED_CELLS / columnCount);
  let evaluatedRowCount = Math.min(
    totalRowCount,
    KX_COLUMN_SUMMARY_SAMPLE_MAX_ROWS,
    cellBudgetRows
  );
  const rowIndexes = evenlySpacedRowIndexes(totalRowCount, evaluatedRowCount);
  return {
    mode: 'sampled',
    algorithm: 'evenlySpacedRows',
    totalRowCount,
    columnCount,
    evaluatedRowCount: rowIndexes.length,
    evaluatedCellCount: rowIndexes.length * columnCount,
    endpointsIncluded: totalRowCount === 0 ||
      (rowIndexes.length > 0 && rowIndexes[0] === 0 &&
        rowIndexes[rowIndexes.length - 1] === totalRowCount - 1),
    rowIndexes,
  };
}

/** Returns deterministic, increasing source-row ordinals, including both endpoints when count >= 2. */
export function evenlySpacedRowIndexes(totalRowCount: number, count: number): number[] {
  const rows = nonNegativeSafeInteger(totalRowCount);
  const selected = Math.min(rows, nonNegativeSafeInteger(count));
  if (selected === 0) {
    return [];
  }
  if (selected === 1) {
    return [0];
  }
  if (selected === rows) {
    return rangeIndexes(rows);
  }

  const lastRow = BigInt(rows - 1);
  const denominator = BigInt(selected - 1);
  const indexes = new Array<number>(selected);
  for (let index = 0; index < selected; index++) {
    indexes[index] = Number((BigInt(index) * lastRow) / denominator);
  }
  return indexes;
}

/**
 * Computes summaries without rerunning q or materializing result rows. Returns
 * undefined on cancellation and never exposes partial summaries.
 */
export async function computeResultColumnSummaries(
  result: ColumnarPanelResult,
  options: ComputeResultColumnSummariesOptions = {}
): Promise<KxColumnSummaryBatch | undefined> {
  if (cancelled(options)) {
    return undefined;
  }

  const plan = planResultColumnSummaries(result);
  const columns: KxColumnSummary[] = [];
  const yieldEveryCells = positiveIntegerOrDefault(
    options.yieldEveryCells,
    KX_COLUMN_SUMMARY_DEFAULT_YIELD_CELLS
  );
  let cellsSinceYield = 0;

  for (let columnIndex = 0; columnIndex < plan.columnCount; columnIndex++) {
    const values: Array<{ value: unknown; evaluatedOrdinal: number }> = [];
    for (let evaluatedOrdinal = 0; evaluatedOrdinal < plan.rowIndexes.length; evaluatedOrdinal++) {
      const rowIndex = plan.rowIndexes[evaluatedOrdinal];
      values.push({ value: result.cellValue(rowIndex, columnIndex), evaluatedOrdinal });
      cellsSinceYield++;
      if (cellsSinceYield >= yieldEveryCells) {
        cellsSinceYield = 0;
        if (cancelled(options)) {
          return undefined;
        }
        await yieldForSummary(options);
        if (cancelled(options)) {
          return undefined;
        }
      }
    }
    columns.push(summarizeColumn(result, plan, columnIndex, values));
    if (plan.rowIndexes.length === 0 &&
      (columnIndex + 1) % yieldEveryCells === 0) {
      if (cancelled(options)) {
        return undefined;
      }
      await yieldForSummary(options);
      if (cancelled(options)) {
        return undefined;
      }
    }
  }

  if (cancelled(options)) {
    return undefined;
  }
  return {
    schemaVersion: KX_COLUMN_SUMMARY_SCHEMA_VERSION,
    mode: plan.mode,
    algorithm: plan.algorithm,
    totalRowCount: plan.totalRowCount,
    evaluatedRowCount: plan.evaluatedRowCount,
    evaluatedCellCount: plan.evaluatedCellCount,
    columnCount: plan.columnCount,
    endpointsIncluded: plan.endpointsIncluded,
    columns,
  };
}

function summarizeColumn(
  result: ColumnarPanelResult,
  plan: KxColumnSummaryPlan,
  columnIndex: number,
  cells: Array<{ value: unknown; evaluatedOrdinal: number }>
): KxColumnSummary {
  const declaredType = result.columnTypes?.[columnIndex];
  const declaredKind = declaredColumnKind(declaredType);
  const observedKinds = new Set<KxColumnSummaryKind>();
  const distinct = new Set<number>();
  const identities: DistinctIdentityState = {
    nextIdentity: 1,
    scalarIdentities: new Map<string, Map<unknown, number>>(),
    objectIdentities: new WeakMap<object, number>(),
  };
  const frequencies = new Map<number, FrequencyEntry>();
  const numeric: NumericObservation[] = [];
  const temporal: TemporalObservation[] = [];
  let validCount = 0;
  let nullCount = 0;
  let textValueCount = 0;
  let scalarDistinctExact = true;

  for (const cell of cells) {
    if (isSummaryNull(cell.value)) {
      nullCount++;
      continue;
    }
    validCount++;
    const kind = observedColumnKind(cell.value);
    observedKinds.add(kind);

    const distinctKey = summaryDistinctKey(cell.value, identities);
    distinct.add(distinctKey.key);
    scalarDistinctExact = scalarDistinctExact && distinctKey.exact;

    const numericValue = numericObservation(cell.value);
    if (numericValue) {
      numeric.push(numericValue);
    }
    const temporalValue = temporalObservation(cell.value);
    if (temporalValue) {
      temporal.push(temporalValue);
    }
    if (kind === 'text') {
      textValueCount++;
      const existing = frequencies.get(distinctKey.key);
      if (existing) {
        existing.count++;
      } else {
        frequencies.set(distinctKey.key, {
          value: cell.value,
          count: 1,
          firstSeen: cell.evaluatedOrdinal,
        });
      }
    }
  }

  const kind = declaredKind || inferredColumnKind(observedKinds);
  const base: KxColumnSummary = {
    sourceColumnPosition: columnIndex,
    columnName: String(result.columns[columnIndex] ?? ''),
    ...(declaredType === undefined ? {} : { columnType: String(declaredType) }),
    kind,
    totalRowCount: plan.totalRowCount,
    evaluatedRowCount: plan.evaluatedRowCount,
    validCount,
    nullCount,
    distinctCount: distinct.size,
    distinctComplete: plan.mode === 'exact' && scalarDistinctExact,
    metricValueCount: 0,
    metricsComplete: validCount === 0,
  };

  if (kind === 'numeric') {
    return addNumericStatistics(base, numeric);
  }
  if (kind === 'temporal') {
    return addTemporalStatistics(base, temporal);
  }
  if (kind === 'text') {
    return {
      ...base,
      metricValueCount: textValueCount,
      metricsComplete: textValueCount === validCount,
      frequentValues: [...frequencies.values()]
        .sort((left, right) => right.count - left.count || left.firstSeen - right.firstSeen)
        .slice(0, KX_COLUMN_SUMMARY_FREQUENT_VALUE_LIMIT)
        .map(entry => ({ ...summarySourceValue(entry.value), count: entry.count })),
    };
  }
  return base;
}

function addNumericStatistics(
  base: KxColumnSummary,
  observations: NumericObservation[]
): KxColumnSummary {
  if (observations.length === 0) {
    return {
      ...base,
      metricValueCount: 0,
      metricsComplete: base.validCount === 0,
    };
  }

  const sorted = [...observations].sort(compareOrderedValues);
  const mean = numericMean(observations);
  const median = numericMedian(sorted);
  return {
    ...base,
    metricValueCount: observations.length,
    metricsComplete: observations.length === base.validCount,
    min: summarySourceValue(sorted[0].raw),
    max: summarySourceValue(sorted[sorted.length - 1].raw),
    ...(mean.value ? { mean: mean.value } : {}),
    ...(mean.unavailable ? { meanUnavailableReason: mean.unavailable } : {}),
    ...(median.value ? { median: median.value } : {}),
    ...(median.unavailable ? { medianUnavailableReason: median.unavailable } : {}),
  };
}

function addTemporalStatistics(
  base: KxColumnSummary,
  observations: TemporalObservation[]
): KxColumnSummary {
  if (observations.length === 0) {
    return {
      ...base,
      metricValueCount: 0,
      metricsComplete: base.validCount === 0,
    };
  }
  const types = new Set(observations.map(value => value.type));
  if (types.size !== 1) {
    return {
      ...base,
      metricValueCount: observations.length,
      metricsComplete: false,
      metricUnavailableReason: 'mixedTemporalTypes',
    };
  }
  const sorted = [...observations].sort(compareOrderedValues);
  return {
    ...base,
    metricValueCount: observations.length,
    metricsComplete: observations.length === base.validCount,
    min: summarySourceValue(sorted[0].raw),
    max: summarySourceValue(sorted[sorted.length - 1].raw),
  };
}

function numericMean(observations: NumericObservation[]): {
  value?: KxColumnSummaryValue;
  unavailable?: 'bothPositiveAndNegativeInfinity';
} {
  const positiveInfinity = observations.find(value => value.infinity === 1);
  const negativeInfinity = observations.find(value => value.infinity === -1);
  if (positiveInfinity && negativeInfinity) {
    return { unavailable: 'bothPositiveAndNegativeInfinity' };
  }
  if (positiveInfinity || negativeInfinity) {
    const infinity = positiveInfinity || negativeInfinity!;
    return { value: { ...summarySourceValue(infinity.raw), derived: true } };
  }

  if (observations.every(observation =>
    typeof observation.value === 'number' && Object.is(observation.value, -0))) {
    return {
      value: {
        ...summarySourceValue(observations[0].raw),
        derived: true,
      },
    };
  }

  let integerSum = BigInt(0);
  let floatingSum = 0;
  let compensation = 0;
  let hasFloatingPoint = false;
  for (const observation of observations) {
    if (typeof observation.value === 'bigint') {
      integerSum += observation.value;
      continue;
    }
    hasFloatingPoint = true;
    const adjusted = observation.value - compensation;
    const next = floatingSum + adjusted;
    compensation = (next - floatingSum) - adjusted;
    floatingSum = next;
  }

  if (!hasFloatingPoint) {
    return { value: rationalSummaryValue(integerSum, BigInt(observations.length)) };
  }
  const mean = (Number(integerSum) + floatingSum) / observations.length;
  return { value: derivedNumberSummaryValue(mean, true) };
}

function numericMedian(sorted: NumericObservation[]): {
  value?: KxColumnSummaryValue;
  unavailable?: 'bothPositiveAndNegativeInfinity';
} {
  const upperIndex = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return { value: summarySourceValue(sorted[upperIndex].raw) };
  }

  const lower = sorted[upperIndex - 1];
  const upper = sorted[upperIndex];
  if (lower.infinity === -1 && upper.infinity === 1) {
    return { unavailable: 'bothPositiveAndNegativeInfinity' };
  }
  if (lower.infinity !== 0) {
    return { value: { ...summarySourceValue(lower.raw), derived: true } };
  }
  if (upper.infinity !== 0) {
    return { value: { ...summarySourceValue(upper.raw), derived: true } };
  }
  if (typeof lower.value === 'bigint' && typeof upper.value === 'bigint') {
    return { value: rationalSummaryValue(lower.value + upper.value, BigInt(2)) };
  }
  const average = finiteNumber(lower.value) / 2 + finiteNumber(upper.value) / 2;
  return { value: derivedNumberSummaryValue(average, true) };
}

function rationalSummaryValue(numerator: bigint, denominator: bigint): KxColumnSummaryValue {
  const negative = numerator < BigInt(0);
  let remaining = negative ? -numerator : numerator;
  const whole = remaining / denominator;
  remaining %= denominator;
  let fractional = '';
  const maxDecimalPlaces = 15;
  for (let place = 0; place < maxDecimalPlaces && remaining !== BigInt(0); place++) {
    remaining *= BigInt(10);
    fractional += String(remaining / denominator);
    remaining %= denominator;
  }
  fractional = fractional.replace(/0+$/, '');
  return {
    text: `${negative ? '-' : ''}${whole}${fractional ? `.${fractional}` : ''}`,
    truncated: false,
    derived: true,
    approximate: remaining !== BigInt(0),
  };
}

function derivedNumberSummaryValue(value: number, approximate: boolean): KxColumnSummaryValue {
  return {
    text: Object.is(value, -0) ? '-0' : String(value),
    truncated: false,
    derived: true,
    approximate,
  };
}

function numericObservation(value: unknown): NumericObservation | undefined {
  if (typeof value === 'bigint') {
    return { raw: value, value, infinity: 0 };
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) {
      return undefined;
    }
    return {
      raw: value,
      value,
      infinity: value === Number.NEGATIVE_INFINITY ? -1 :
        value === Number.POSITIVE_INFINITY ? 1 : 0,
    };
  }
  if (!isQAtom(value) || !Q_NUMERIC_TYPES.has(value.type)) {
    return undefined;
  }
  const special = qSpecialKind(value);
  if (special === 'null') {
    return undefined;
  }
  if (special === 'positiveInfinity' || special === 'negativeInfinity') {
    return {
      raw: value,
      value: special === 'positiveInfinity' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY,
      infinity: special === 'positiveInfinity' ? 1 : -1,
    };
  }
  if (special === 'negativeZero') {
    return { raw: value, value: -0, infinity: 0 };
  }
  try {
    if (value.type === 'long') {
      return { raw: value, value: BigInt(String(value.value)), infinity: 0 };
    }
    if (Q_INT32_NUMERIC_TYPES.has(value.type)) {
      return { raw: value, value: BigInt(Number(value.value)), infinity: 0 };
    }
    const number = Number(value.value);
    return Number.isNaN(number) ? undefined : { raw: value, value: number, infinity: 0 };
  } catch {
    return undefined;
  }
}

function temporalObservation(value: unknown): TemporalObservation | undefined {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return { raw: value, type: 'javascript-date', value: value.getTime(), infinity: 0 };
  }
  if (!isQAtom(value) || !isTemporalQType(value.type)) {
    return undefined;
  }
  const special = qSpecialKind(value);
  if (special === 'null') {
    return undefined;
  }
  if (special === 'positiveInfinity' || special === 'negativeInfinity') {
    return {
      raw: value,
      type: value.type,
      value: special === 'positiveInfinity' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY,
      infinity: special === 'positiveInfinity' ? 1 : -1,
    };
  }
  if (special === 'negativeZero') {
    return { raw: value, type: value.type, value: -0, infinity: 0 };
  }
  try {
    if (Q_INT64_TEMPORAL_TYPES.has(value.type)) {
      return { raw: value, type: value.type, value: BigInt(String(value.value)), infinity: 0 };
    }
    if (Q_INT32_TEMPORAL_TYPES.has(value.type)) {
      return { raw: value, type: value.type, value: BigInt(Number(value.value)), infinity: 0 };
    }
    const number = Number(value.value);
    return Number.isNaN(number)
      ? undefined
      : { raw: value, type: value.type, value: number, infinity: 0 };
  } catch {
    return undefined;
  }
}

function compareOrderedValues(left: OrderedSemanticValue, right: OrderedSemanticValue): number {
  if (left.infinity !== right.infinity) {
    return left.infinity < right.infinity ? -1 : 1;
  }
  if (left.infinity !== 0) {
    return 0;
  }
  return compareFiniteValues(left.value, right.value);
}

function compareFiniteValues(left: number | bigint, right: number | bigint): number {
  if (typeof left === 'bigint' && typeof right === 'bigint') {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  return typeof left === 'bigint'
    ? compareBigIntToFiniteNumber(left, right as number)
    : -compareBigIntToFiniteNumber(right as bigint, left);
}

function compareBigIntToFiniteNumber(integer: bigint, numeric: number): number {
  if (Number.isInteger(numeric)) {
    const numericInteger = BigInt(numeric);
    return integer < numericInteger ? -1 : integer > numericInteger ? 1 : 0;
  }
  const truncated = BigInt(Math.trunc(numeric));
  if (integer < truncated) {
    return -1;
  }
  if (integer > truncated) {
    return 1;
  }
  return numeric > 0 ? -1 : 1;
}

function finiteNumber(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

function isSummaryNull(value: unknown): boolean {
  return value === null || value === undefined || isQGeneralNull(value) ||
    (isQAtom(value) && qSpecialKind(value) === 'null');
}

function declaredColumnKind(value: unknown): KxColumnSummaryKind | undefined {
  const chartKind = qTypeChartColumnKind(value);
  if (chartKind) {
    return chartKind;
  }
  const normalized = normalizeQTypeName(value);
  if (normalized === 'char' || normalized === 'symbol') {
    return 'text';
  }
  if (normalized) {
    return 'other';
  }
  if (typeof value === 'string' && value.trim().toLocaleLowerCase() === 'text') {
    return 'text';
  }
  return undefined;
}

function observedColumnKind(value: unknown): KxColumnSummaryKind {
  if (typeof value === 'number' || typeof value === 'bigint') {
    return 'numeric';
  }
  if (typeof value === 'string') {
    return 'text';
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return 'temporal';
  }
  if (!isQAtom(value)) {
    return 'other';
  }
  if (Q_NUMERIC_TYPES.has(value.type)) {
    return 'numeric';
  }
  if (isTemporalQType(value.type)) {
    return 'temporal';
  }
  return value.type === 'symbol' || value.type === 'char' ? 'text' : 'other';
}

function inferredColumnKind(observed: Set<KxColumnSummaryKind>): KxColumnSummaryKind {
  return observed.size === 1 ? observed.values().next().value || 'other' : 'other';
}

function isTemporalQType(type: string): boolean {
  return Q_INT32_TEMPORAL_TYPES.has(type) || Q_INT64_TEMPORAL_TYPES.has(type) ||
    type === 'datetime';
}

function qSpecialKind(value: QAtom): QSpecialKind | undefined {
  const scalar = value.value;
  if (typeof scalar !== 'object' || scalar === null || !('special' in scalar)) {
    return undefined;
  }
  return scalar.special;
}

function summaryDistinctKey(value: unknown, state: DistinctIdentityState): DistinctKey {
  if (isQAtom(value)) {
    const special = qSpecialKind(value);
    if (special) {
      return scalarDistinctKey(state, `q:${value.type}:special`, special);
    }
    const negativeZero = typeof value.value === 'number' && Object.is(value.value, -0);
    return scalarDistinctKey(
      state,
      `q:${value.type}:${typeof value.value}${negativeZero ? ':negativeZero' : ''}`,
      value.value
    );
  }
  if (value instanceof Date) {
    return {
      ...scalarDistinctKey(state, 'js:date', value.getTime()),
      exact: Number.isFinite(value.getTime()),
    };
  }
  const type = typeof value;
  if (type === 'string') {
    return scalarDistinctKey(state, 'js:string', value);
  }
  if (type === 'number') {
    return scalarDistinctKey(
      state,
      Object.is(value, -0) ? 'js:number:negativeZero' : 'js:number',
      value
    );
  }
  if (type === 'bigint') {
    return scalarDistinctKey(state, 'js:bigint', value);
  }
  if (type === 'boolean') {
    return scalarDistinctKey(state, 'js:boolean', value);
  }
  if (type === 'symbol') {
    return scalarDistinctKey(state, 'js:symbol', value);
  }
  if ((type === 'object' && value !== null) || type === 'function') {
    const object = value as object;
    let identity = state.objectIdentities.get(object);
    if (identity === undefined) {
      identity = state.nextIdentity++;
      state.objectIdentities.set(object, identity);
    }
    return { key: identity, exact: false };
  }
  return { ...scalarDistinctKey(state, `js:${type}`, value), exact: false };
}

function scalarDistinctKey(
  state: DistinctIdentityState,
  domain: string,
  value: unknown
): DistinctKey {
  let domainValues = state.scalarIdentities.get(domain);
  if (!domainValues) {
    domainValues = new Map<unknown, number>();
    state.scalarIdentities.set(domain, domainValues);
  }
  let identity = domainValues.get(value);
  if (identity === undefined) {
    identity = state.nextIdentity++;
    domainValues.set(value, identity);
  }
  return { key: identity, exact: true };
}

function summarySourceValue(value: unknown): KxColumnSummaryValue {
  if (isQAtom(value) || isQGeneralNull(value)) {
    const bounded = qValueToBoundedLiteral(value, {
      maxChars: KX_COLUMN_SUMMARY_VALUE_MAX_CHARS,
      maxItems: KX_COLUMN_SUMMARY_FREQUENT_VALUE_LIMIT,
      maxDepth: 4,
    });
    return { text: bounded.text, truncated: bounded.truncated };
  }
  return cellValueToBoundedText(value, KX_COLUMN_SUMMARY_VALUE_MAX_CHARS);
}

function rangeIndexes(count: number): number[] {
  return Array.from({ length: count }, (_value, index) => index);
}

function nonNegativeSafeInteger(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value));
}

function positiveIntegerOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : fallback;
}

function cancelled(options: ComputeResultColumnSummariesOptions): boolean {
  return options.signal?.aborted === true || options.shouldCancel?.() === true;
}

async function yieldForSummary(options: ComputeResultColumnSummariesOptions): Promise<void> {
  if (options.yieldControl) {
    await options.yieldControl();
    return;
  }
  await new Promise<void>(resolve => setImmediate(resolve));
}
