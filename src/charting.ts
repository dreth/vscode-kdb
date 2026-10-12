import { ColumnarPanelResult } from './kx-results';
import {
  isKnownQType,
  qTypeChartColumnKind,
} from './q-type';
import { isQRuntimeValue, qValueToSemanticPrimitive } from './q-value';

export type ChartColumnKind = 'numeric' | 'temporal';
export type ChartGroupColumnKind = 'categorical';
export type ChartType = 'line' | 'scatter' | 'step' | 'bar' | 'box' | 'candlestick';

export interface ChartTypeCapabilities {
  usesGenericY: boolean;
  supportsGroupBy: boolean;
  usesOhlc: boolean;
}

export interface ChartColumnOption {
  columnName: string;
  columnIndex: number;
  kind: ChartColumnKind;
  qType?: string;
}

export interface ChartGroupColumnOption {
  columnName: string;
  columnIndex: number;
  kind: ChartGroupColumnKind;
}

export interface ChartColumnOptions {
  xColumns: ChartColumnOption[];
  yColumns: ChartColumnOption[];
  groupColumns: ChartGroupColumnOption[];
  warnings: string[];
}

export interface LineChartRequest {
  chartType?: ChartType;
  xColumn: string;
  yColumns?: string[];
  groupByColumn?: string;
  openColumn?: string;
  highColumn?: string;
  lowColumn?: string;
  closeColumn?: string;
  xMin?: number;
  xMax?: number;
  width: number;
  version: number;
  requestId: number;
  maxSourceRows?: number;
  maxSampledPoints?: number;
  samplingStrategy?: 'point-count' | 'temporal-auto' | 'temporal-fixed';
  temporalBucketIntervalMs?: number;
}

export interface LineChartSeries {
  columnName: string;
  sourceColumnName?: string;
  groupValue?: string;
  values: Array<number | null>;
  gapFlags?: boolean[];
  /** A real source null/non-finite run occurs before this retained point. */
  gapBefore?: boolean[];
}

export interface CandlestickColumns {
  open: string;
  high: string;
  low: string;
  close: string;
}

export interface CandlestickInputPoint {
  rowIndex?: number;
  group?: string;
  x: number;
  xText: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
}

export interface CandlestickDataPoint {
  x: number;
  xText: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface CandlestickAggregationResult {
  candlesticks: CandlestickDataPoint[];
  exactPointCount: number;
  algorithm: string;
  xDomain?: { min: number; max: number };
}

export interface BoxChartStats {
  count: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
}

export interface BoxChartSeries {
  columnName: string;
  sourceColumnName?: string;
  groupValue?: string;
  stats: Array<BoxChartStats | null>;
}

export interface CandlestickSeries {
  groupValue: string;
  candlesticks: Array<CandlestickDataPoint | null>;
}

export interface LineChartData {
  version: number;
  requestId: number;
  chartType: ChartType;
  xColumn: string;
  groupByColumn?: string;
  xKind: ChartColumnKind;
  x: number[];
  xText: string[];
  xDomain?: { min: number; max: number };
  series: LineChartSeries[];
  boxSeries?: BoxChartSeries[];
  ohlcColumns?: CandlestickColumns;
  candlesticks?: CandlestickDataPoint[];
  candlestickSeries?: CandlestickSeries[];
  retainedGroupCount?: number;
  sourceRowCount: number;
  eligibleRowCount: number;
  sampledPointCount: number;
  algorithm: string;
  samplingStrategy?: 'point-count' | 'temporal-auto' | 'temporal-fixed';
  temporalBucketIntervalMs?: number;
  temporalBucketOrigin?: 0;
  temporalReusedPointCount?: number;
  temporalBuiltPointCount?: number;
  sorted: boolean;
  warnings: string[];
}

export interface TemporalPanChartCache {
  key: string;
  min: number;
  max: number;
  data: LineChartData;
}

export interface TemporalPanChartBuild {
  data: LineChartData;
  cache?: TemporalPanChartCache;
}

interface ChartPoint {
  rowIndex: number;
  x: number;
  xText: string;
  group?: string;
  y: Array<number | null>;
  gapFlags?: boolean[];
  /** Per-series source origin for aligned grouped occurrences. */
  sourceRowIndexes?: Array<number | undefined>;
}

interface ChartXIndex {
  columnIndex: number;
  kind: ChartColumnKind;
  sourceVersion: number;
  rowCount: number;
  x: number[];
  xText: string[];
  rowIndexes: number[];
  droppedX: number;
  sourceWasUnsorted: boolean;
  eligibility?: ChartEligibilityIndex;
}

interface ChartEligibilitySegment {
  start: number;
  end: number;
  prefix: Uint32Array;
}

interface ChartEligibilityIndex {
  key: string;
  entryCount: number;
  segments: ChartEligibilitySegment[];
}

interface NormalizedValue {
  value: number;
  text: string;
}

interface ColumnInference {
  numeric: boolean;
  temporal: boolean;
  categorical: boolean;
  sampled: number;
  missing: number;
  invalid: number;
}

interface PreparedChartSource {
  xOption: ChartColumnOption;
  yColumnNames: string[];
  yColumnIndexes: number[];
  groupColumnName?: string;
  groupColumnIndex?: number;
  warnings: string[];
}

interface PreparedCandlestickSource {
  xOption: ChartColumnOption;
  ohlcColumns: CandlestickColumns;
  ohlcColumnIndexes: [number, number, number, number];
  groupColumnName?: string;
  groupColumnIndex?: number;
  warnings: string[];
}

interface CollectedChartPoints {
  points: ChartPoint[];
  droppedX: number;
  droppedGroup: number;
  rangeExcluded: number;
  yMissing: number;
  yInvalid: number;
  sourceWasUnsorted: boolean;
}

interface CollectedCandlestickPoints {
  points: CandlestickInputPoint[];
  droppedX: number;
  droppedGroup: number;
  rangeExcluded: number;
  sourceWasUnsorted: boolean;
}

interface BoxChartBin {
  x: number;
  xText: string;
  stats: Array<BoxChartStats | null>;
  points: ChartPoint[];
}

interface ChartXRange {
  min: number;
  max: number;
}

interface ChartSeriesDefinition {
  columnName: string;
  sourceColumnName?: string;
  groupValue?: string;
}

export class ChartDataError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ChartDataError';
    Object.setPrototypeOf(this, ChartDataError.prototype);
  }
}

export const CHART_INFERENCE_SAMPLE_SIZE = 200;
export const CHART_MAX_SOURCE_ROWS = 2000000;
export const CHART_MAX_SAMPLED_POINTS = 12000;
export const CHART_ORDINARY_TARGET_POINTS = 7000;
export const CHART_POINTS_PER_PIXEL = 3;
export const CHART_CANDLES_PER_PIXEL = 1;
export const CHART_MAX_BOX_GROUPS = 120;
export const CHART_MAX_GROUPS = 12;
export const CHART_MAX_GROUPED_SERIES = 36;

interface ChartXIndexCache {
  sourceVersion: number;
  indexes: Map<string, ChartXIndex>;
}

interface ChartXIndexCacheSlot {
  cache: ChartXIndexCache;
  key: string;
  cached?: ChartXIndex;
}

const chartXIndexes = new WeakMap<object, ChartXIndexCache>();

/** Explicitly invalidate normalized X state when a mutable table identity changes in place. */
export function invalidateChartSourceIndex(table: ColumnarPanelResult): void {
  chartXIndexes.delete(table as unknown as object);
}

export function chartColumnOptions(table: ColumnarPanelResult, sampleSize = CHART_INFERENCE_SAMPLE_SIZE): ChartColumnOptions {
  const xColumns: ChartColumnOption[] = [];
  const yColumns: ChartColumnOption[] = [];
  const groupColumns: ChartGroupColumnOption[] = [];
  const warnings: string[] = [];

  table.columns.forEach((columnName, columnIndex) => {
    const qType = table.columnTypes?.[columnIndex];
    const inference = inferColumn(table, columnIndex, sampleSize);
    if (inference.numeric) {
      xColumns.push({ columnName, columnIndex, kind: 'numeric', ...(qType ? { qType } : {}) });
      yColumns.push({ columnName, columnIndex, kind: 'numeric', ...(qType ? { qType } : {}) });
    } else if (inference.temporal) {
      xColumns.push({ columnName, columnIndex, kind: 'temporal', ...(qType ? { qType } : {}) });
    }
    if (inference.categorical) {
      groupColumns.push({ columnName, columnIndex, kind: 'categorical' });
    }

    if (inference.sampled === 0 && table.rowCount > 0) {
      warnings.push(`${columnName} has no sampled scalar values.`);
    }
  });

  if (xColumns.length === 0) {
    warnings.push('No numeric or temporal x columns were detected in the visible columns.');
  }
  if (yColumns.length === 0) {
    warnings.push('No numeric y columns were detected in the visible columns.');
  }

  return { xColumns, yColumns, groupColumns, warnings };
}

export function buildLineChartData(table: ColumnarPanelResult, request: LineChartRequest): LineChartData {
  return buildChartData(table, { ...request, chartType: 'line' });
}

export function buildChartData(table: ColumnarPanelResult, request: LineChartRequest): LineChartData {
  return buildChartDataInternal(table, request, false);
}

function buildChartDataInternal(
  table: ColumnarPanelResult,
  request: LineChartRequest,
  recordPanEligibility: boolean
): LineChartData {
  const chartType = normalizeChartType(request.chartType);
  if (chartType === 'candlestick') {
    return buildCandlestickChartData(table, request);
  }
  if (chartType === 'box') {
    return buildBoxChartData(table, request);
  }
  return buildXyChartData(table, request, chartType, recordPanEligibility);
}

/** Reuse only the overlapping summaries of one bounded, compatible temporal viewport. */
export function buildChartDataWithTemporalPanReuse(
  table: ColumnarPanelResult,
  request: LineChartRequest,
  previous?: TemporalPanChartCache
): TemporalPanChartBuild {
  const key = temporalPanCacheKey(request);
  const min = Number(request.xMin);
  const max = Number(request.xMax);
  const interval = Number(request.temporalBucketIntervalMs);
  const chartType = normalizeChartType(request.chartType);
  const cleanBuild = (): TemporalPanChartBuild => {
    const data = buildChartDataInternal(table, request, true);
    const responseKey = data.temporalBucketIntervalMs
      ? temporalPanCacheKey({ ...request, temporalBucketIntervalMs: data.temporalBucketIntervalMs })
      : key;
    return { data, cache: temporalPanCacheForResponse(responseKey, min, max, data) };
  };
  const temporalEligible = request.samplingStrategy === 'temporal-fixed' &&
    Number.isFinite(min) && Number.isFinite(max) && min < max &&
    Number.isFinite(interval) && interval > 0 &&
    !String(request.groupByColumn || '').trim() &&
    (chartType === 'line' || chartType === 'scatter' || chartType === 'step');
  const observationEligible = request.samplingStrategy === 'point-count' &&
    Number.isFinite(min) && Number.isFinite(max) && min < max &&
    !String(request.groupByColumn || '').trim() &&
    (chartType === 'line' || chartType === 'scatter' || chartType === 'step');

  if ((!temporalEligible && !observationEligible) || !previous || previous.key !== key ||
    previous.max < min || previous.min > max) {
    return cleanBuild();
  }

  if (observationEligible && previous.data.xKind === 'numeric') {
    const previousSpan = previous.max - previous.min;
    const requestedSpan = max - min;
    const tolerance = Math.max(1e-9, Math.abs(previousSpan) * 1e-9);
    if (Math.abs(previousSpan - requestedSpan) > tolerance) {
      return cleanBuild();
    }
    return buildObservationPanReuse(table, request, previous, key, min, max, cleanBuild);
  }
  if (!temporalEligible || previous.data.xKind !== 'temporal') {
    return cleanBuild();
  }

  const reusable = temporalReusableBucketRange(min, max, previous.min, previous.max, interval);
  if (!reusable) {
    return cleanBuild();
  }
  const pieces: Array<{ data: LineChartData; reused: boolean }> = [];
  try {
    if (min < reusable.start) {
      const leftContext = buildChartDataInternal(
        table,
        { ...request, xMin: min, xMax: reusable.start + interval },
        true
      );
      if (!leftContext.x.some(x => x >= reusable.start)) {
        return cleanBuild();
      }
      const leftRequestFirstX = leftContext.xDomain?.min;
      const left = filterTemporalChartData(
        leftContext,
        x => x < reusable.start || (Number.isFinite(leftRequestFirstX) && x === leftRequestFirstX)
      );
      if (left) {
        pieces.push({ data: left, reused: false });
      }
    }
    const reused = sliceTemporalChartDataByBuckets(
      previous.data,
      reusable.start,
      reusable.end,
      interval
    );
    if (!reused) {
      return cleanBuild();
    }
    pieces.push({ data: reused, reused: true });
    if (max > reusable.end) {
      const rightContext = buildChartDataInternal(
        table,
        { ...request, xMin: reusable.end - interval, xMax: max },
        true
      );
      if (!rightContext.x.some(x => x < reusable.end)) {
        return cleanBuild();
      }
      const rightRequestLastX = rightContext.xDomain?.max;
      const right = filterTemporalChartData(
        rightContext,
        x => x >= reusable.end || (Number.isFinite(rightRequestLastX) && x === rightRequestLastX)
      );
      if (right) {
        pieces.push({ data: right, reused: false });
      }
    }
  } catch (error) {
    if (error instanceof ChartDataError) {
      return cleanBuild();
    }
    throw error;
  }

  if (!pieces.every(piece => temporalPieceIsUncapped(piece.data))) {
    return cleanBuild();
  }
  const summary = temporalRequestSummary(table, request, previous.data.xKind, pieces);
  if (!summary) {
    return cleanBuild();
  }

  const data = mergeTemporalChartPieces(
    pieces,
    request,
    summary.xDomain,
    summary.eligibleRowCount,
    summary.warnings
  );
  if (data.sampledPointCount > CHART_ORDINARY_TARGET_POINTS ||
    data.x.length > CHART_ORDINARY_TARGET_POINTS) {
    return cleanBuild();
  }
  if (data.sampledPointCount !== Math.min(data.eligibleRowCount, CHART_ORDINARY_TARGET_POINTS)) {
    // A source edge or materially changed effective span can leave the retained
    // overlap too sparse to satisfy the authoritative density without decoding
    // omitted overlap values. Treat that as incompatible and rebuild cleanly.
    return cleanBuild();
  }
  return { data, cache: { key, min, max, data } };
}

function buildObservationPanReuse(
  table: ColumnarPanelResult,
  request: LineChartRequest,
  previous: TemporalPanChartCache,
  key: string,
  min: number,
  max: number,
  cleanBuild: () => TemporalPanChartBuild
): TemporalPanChartBuild {
  const overlapMin = Math.max(min, previous.min);
  const overlapMax = Math.min(max, previous.max);
  const pieces: Array<{ data: LineChartData; reused: boolean }> = [];
  try {
    if (min < previous.min) {
      pieces.push({
        data: buildChartDataInternal(
          table,
          { ...request, xMin: min, xMax: previous.min },
          true
        ),
        reused: false,
      });
    }
    const reused = filterTemporalChartData(
      previous.data,
      x => x >= overlapMin && x <= overlapMax
    );
    if (!reused) {
      return cleanBuild();
    }
    pieces.push({ data: reused, reused: true });
    if (max > previous.max) {
      pieces.push({
        data: buildChartDataInternal(
          table,
          { ...request, xMin: previous.max, xMax: max },
          true
        ),
        reused: false,
      });
    }
  } catch (error) {
    if (error instanceof ChartDataError) {
      return cleanBuild();
    }
    throw error;
  }
  const summary = temporalRequestSummary(table, request, 'numeric', pieces);
  if (!summary) {
    return cleanBuild();
  }
  const data = mergeTemporalChartPieces(
    pieces,
    request,
    summary.xDomain,
    summary.eligibleRowCount,
    summary.warnings
  );
  if (data.sampledPointCount !== Math.min(data.eligibleRowCount, CHART_ORDINARY_TARGET_POINTS)) {
    return cleanBuild();
  }
  return { data, cache: { key, min, max, data } };
}

function temporalPanCacheKey(request: LineChartRequest): string {
  return JSON.stringify([
    request.version,
    normalizeChartType(request.chartType),
    request.xColumn,
    request.yColumns || [],
    String(request.groupByColumn || ''),
    Number(request.temporalBucketIntervalMs) || 0,
    positiveInteger(request.maxSourceRows, CHART_MAX_SOURCE_ROWS),
    positiveInteger(request.maxSampledPoints, CHART_MAX_SAMPLED_POINTS),
  ]);
}

function temporalPanCacheForResponse(
  key: string,
  min: number,
  max: number,
  data: LineChartData
): TemporalPanChartCache | undefined {
  const reusableAlgorithm = data.xKind === 'temporal'
    ? data.temporalBucketOrigin === 0 &&
      (data.algorithm === 'none' || /^temporal-minmax\/[^+]+$/.test(data.algorithm))
    : data.samplingStrategy === 'point-count' &&
      (data.algorithm === 'none' || /^minmax-bucket\/[^+]+$/.test(data.algorithm));
  if (!reusableAlgorithm ||
    !Number.isFinite(min) || !Number.isFinite(max) || min >= max || data.groupByColumn ||
    (data.chartType !== 'line' && data.chartType !== 'scatter' && data.chartType !== 'step')) {
    return undefined;
  }
  return { key, min, max, data };
}

function temporalReusableBucketRange(
  min: number,
  max: number,
  previousMin: number,
  previousMax: number,
  interval: number
): { start: number; end: number } | undefined {
  const lower = Math.max(min, previousMin);
  const upper = Math.min(max, previousMax);
  const firstStart = Math.floor(lower / interval) * interval + interval;
  const lastStart = Math.floor(nextDown(upper - interval) / interval) * interval;
  if (!Number.isFinite(firstStart) || !Number.isFinite(lastStart) || firstStart > lastStart) {
    return undefined;
  }
  return { start: firstStart, end: lastStart + interval };
}

function nextDown(value: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  if (value === 0) {
    return -Number.MIN_VALUE;
  }
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value, false);
  const bits = view.getBigUint64(0, false);
  view.setBigUint64(0, value > 0 ? bits - 1n : bits + 1n, false);
  return view.getFloat64(0, false);
}

function sliceTemporalChartDataByBuckets(
  data: LineChartData,
  minBucketStart: number,
  maxBucketEnd: number,
  interval: number
): LineChartData | undefined {
  return filterTemporalChartData(data, x => {
    const bucketStart = Math.floor(x / interval) * interval;
    return bucketStart >= minBucketStart && bucketStart < maxBucketEnd;
  });
}

function filterTemporalChartData(data: LineChartData, include: (x: number) => boolean): LineChartData | undefined {
  const indexes: number[] = [];
  data.x.forEach((x, index) => {
    if (include(x)) indexes.push(index);
  });
  if (indexes.length === 0) {
    return undefined;
  }
  return {
    ...data,
    x: indexes.map(index => data.x[index]),
    xText: indexes.map(index => data.xText[index]),
    series: data.series.map(series => ({
      ...series,
      values: indexes.map(index => series.values[index]),
      ...(series.gapFlags ? { gapFlags: indexes.map(index => !!series.gapFlags![index]) } : {}),
      ...(series.gapBefore ? { gapBefore: indexes.map(index => !!series.gapBefore![index]) } : {}),
    })),
    sampledPointCount: indexes.length,
  };
}

function temporalPieceIsUncapped(data: LineChartData): boolean {
  return data.algorithm === 'none' || /^temporal-minmax\/[^+]+$/.test(data.algorithm);
}

function temporalRequestSummary(
  table: ColumnarPanelResult,
  request: LineChartRequest,
  xKind: ChartColumnKind,
  pieces: Array<{ data: LineChartData; reused: boolean }>
): { xDomain: { min: number; max: number }; eligibleRowCount: number; warnings: string[] } | undefined {
  const sourceWarnings = new Set<string>();
  for (const piece of pieces) {
    for (const warning of piece.data.warnings) {
      if (isTemporalRangeWarning(warning, xKind) || warning === 'x values were sorted for this chart; table order was not changed.') {
        continue;
      }
      sourceWarnings.add(warning);
    }
  }

  const xColumnIndex = table.columns.indexOf(request.xColumn);
  if (xColumnIndex === -1) {
    return undefined;
  }
  const index = chartXIndex(table, xColumnIndex, xKind, request.version);
  if (index.sourceWasUnsorted) {
    return undefined;
  }
  const xRange = normalizedChartXRange(request);
  const bounds = chartXIndexBounds(index, xRange);
  const yColumnIndexes = uniqueStrings(request.yColumns || [])
    .map(columnName => table.columns.indexOf(columnName));
  if (yColumnIndexes.length === 0 || yColumnIndexes.some(columnIndex => columnIndex < 0)) {
    return undefined;
  }
  const eligibleRowCount = chartEligibilityCount(
    index,
    chartEligibilityKey(yColumnIndexes),
    bounds.start,
    bounds.end
  );
  if (eligibleRowCount === undefined) {
    // Reuse must not guess eligibility from valid X alone. A full ungrouped
    // source/range build installs these summaries while already decoding Y.
    return undefined;
  }
  if (eligibleRowCount === 0) {
    return undefined;
  }

  const warnings = Array.from(sourceWarnings);
  if (index.droppedX > 0) {
    warnings.push(`${index.droppedX} row${index.droppedX === 1 ? '' : 's'} dropped because x was null, non-finite, or not ${xKind}.`);
  }
  if (bounds.rangeExcluded > 0) {
    warnings.push(`${bounds.rangeExcluded} row${bounds.rangeExcluded === 1 ? '' : 's'} outside the selected x range were skipped.`);
  }
  return {
    xDomain: {
      min: index.x[bounds.start],
      max: index.x[bounds.end - 1],
    },
    eligibleRowCount,
    warnings,
  };
}

function isTemporalRangeWarning(warning: string, xKind: ChartColumnKind): boolean {
  return warning === `1 row dropped because x was null, non-finite, or not ${xKind}.` ||
    new RegExp(`^\\d+ rows dropped because x was null, non-finite, or not ${xKind}\\.$`).test(warning) ||
    warning === '1 row outside the selected x range was skipped.' ||
    /^\d+ rows outside the selected x range were skipped\.$/.test(warning);
}

function mergeTemporalChartPieces(
  pieces: Array<{ data: LineChartData; reused: boolean }>,
  request: LineChartRequest,
  xDomain: { min: number; max: number },
  eligibleRowCount: number,
  warnings: string[]
): LineChartData {
  interface TemporalMergeRecord {
    x: number;
    xText: string;
    values: Array<number | null>;
    gapFlags: boolean[];
    gapBefore: boolean[];
    reused: boolean;
    firstOrder: number;
  }

  const mergeRecordOverlap = (
    record: TemporalMergeRecord,
    overlap: TemporalMergeRecord
  ): TemporalMergeRecord => ({
    ...record,
    gapFlags: record.gapFlags.map((value, index) => value || overlap.gapFlags[index]),
    gapBefore: record.gapBefore.map((value, index) => value || overlap.gapBefore[index]),
    reused: record.reused || overlap.reused,
  });
  const recordsByPiece = pieces.map(piece => piece.data.x.map((x, pointIndex) => {
    return {
        x,
        xText: piece.data.xText[pointIndex],
        values: piece.data.series.map(series => series.values[pointIndex]),
        gapFlags: piece.data.series.map(series => !!series.gapFlags?.[pointIndex]),
        gapBefore: piece.data.series.map(series => !!series.gapBefore?.[pointIndex]),
        reused: piece.reused,
        firstOrder: 0,
      };
  }));
  const disjointAndOrdered = recordsByPiece.every((pieceRecords, index) =>
    index === 0 || pieceRecords.length === 0 || recordsByPiece[index - 1].length === 0 ||
      recordsByPiece[index - 1][recordsByPiece[index - 1].length - 1].x < pieceRecords[0].x
  );
  let merged: Array<TemporalMergeRecord & { duplicateOrdinal: number }>;
  if (disjointAndOrdered) {
    let nextOrder = 0;
    merged = recordsByPiece.flatMap(pieceRecords => pieceRecords.map(record => ({
      ...record,
      firstOrder: nextOrder++,
      duplicateOrdinal: 0,
    })));
  } else {
    const records = new Map<string, {
      firstOrder: number;
      occurrences: TemporalMergeRecord[];
    }>();
    let nextOrder = 0;
    recordsByPiece.forEach(recordsForPiece => {
      const pieceRecords = new Map<string, TemporalMergeRecord[]>();
      recordsForPiece.forEach(record => {
        const key = JSON.stringify([record.x, record.values]);
        const occurrences = pieceRecords.get(key);
      if (occurrences) {
        occurrences.push(record);
      } else {
        pieceRecords.set(key, [record]);
      }
      });
      pieceRecords.forEach((occurrences, key) => {
        const existing = records.get(key);
        if (!existing) {
          const firstOrder = nextOrder++;
          records.set(key, {
            firstOrder,
            occurrences: occurrences.map(record => ({ ...record, firstOrder })),
          });
          return;
        }
        if (occurrences.length > existing.occurrences.length) {
          existing.occurrences = occurrences.map((record, index) => {
            const next = { ...record, firstOrder: existing.firstOrder };
            return existing.occurrences[index]
              ? mergeRecordOverlap(next, existing.occurrences[index])
              : next;
          });
          return;
        }
        occurrences.forEach((record, index) => {
          existing.occurrences[index] = mergeRecordOverlap(
            existing.occurrences[index],
            { ...record, firstOrder: existing.firstOrder }
          );
        });
      });
    });
    merged = Array.from(records.values())
      .flatMap(record => record.occurrences.map((occurrence, duplicateOrdinal) => ({
        ...occurrence,
        duplicateOrdinal,
      })))
      .sort((left, right) =>
        left.x - right.x ||
        left.firstOrder - right.firstOrder ||
        left.duplicateOrdinal - right.duplicateOrdinal
      );
  }
  if (merged.length > CHART_ORDINARY_TARGET_POINTS) {
    const selected = new Uint8Array(merged.length);
    merged.forEach((record, index) => {
      if (record.reused) {
        selected[index] = 1;
      }
    });
    selected[0] = 1;
    selected[merged.length - 1] = 1;
    const seriesCount = merged[0]?.values.length || 0;
    for (let seriesIndex = 0; seriesIndex < seriesCount; seriesIndex += 1) {
      let minValue = Infinity;
      let maxValue = -Infinity;
      let minIndex = -1;
      let maxIndex = -1;
      for (let index = 0; index < merged.length; index += 1) {
        const record = merged[index];
        const value = record.values[seriesIndex];
        if (record.gapFlags[seriesIndex] || record.gapBefore[seriesIndex]) {
          selected[index] = 1;
        }
        if (Number.isFinite(value) && (value as number) < minValue) {
          minValue = value as number;
          minIndex = index;
        }
        if (Number.isFinite(value) && (value as number) > maxValue) {
          maxValue = value as number;
          maxIndex = index;
        }
      }
      if (minIndex >= 0) selected[minIndex] = 1;
      if (maxIndex >= 0) selected[maxIndex] = 1;
    }
    fillSelectedPointIndexes(selected, merged.length, CHART_ORDINARY_TARGET_POINTS);
    const originalRecords = merged;
    const selectedRecords = merged.filter((_record, index) => selected[index]);
    merged = selectedRecords.length <= CHART_ORDINARY_TARGET_POINTS
      ? selectedRecords
      : evenlyThin(selectedRecords, CHART_ORDINARY_TARGET_POINTS);
    // Carry breaks from removed samples without decoding the cached source again.
    if (pieces.some(piece => piece.data.series.some(series => series.gapBefore?.some(Boolean)))) {
      const retained = new Set(merged);
      for (let seriesIndex = 0; seriesIndex < seriesCount; seriesIndex++) {
        let gapPending = false;
        for (const record of originalRecords) {
          if (record.gapBefore[seriesIndex] || record.values[seriesIndex] === null) gapPending = true;
          if (retained.has(record) && Number.isFinite(record.values[seriesIndex])) {
            record.gapBefore[seriesIndex] ||= gapPending;
            gapPending = false;
          }
        }
      }
    }
  }
  const first = pieces[0].data;
  const reusedPointCount = merged.filter(record => record.reused).length;
  const builtPointCount = merged.length - reusedPointCount;
  return {
    ...first,
    version: request.version,
    requestId: request.requestId,
    x: merged.map(record => record.x),
    xText: merged.map(record => record.xText),
    xDomain,
    series: first.series.map((series, seriesIndex) => ({
      ...series,
      values: merged.map(record => record.values[seriesIndex]),
      ...(series.gapFlags ? { gapFlags: merged.map(record => record.gapFlags[seriesIndex]) } : {}),
      ...(pieces.some(piece => piece.data.series[seriesIndex].gapBefore)
        ? { gapBefore: merged.map(record => record.gapBefore[seriesIndex]) } : {}),
    })),
    eligibleRowCount,
    sampledPointCount: merged.length,
    algorithm: `${first.algorithm}+overlap-cache`,
    temporalReusedPointCount: reusedPointCount,
    temporalBuiltPointCount: builtPointCount,
    warnings,
  };
}

export function normalizeChartType(value: unknown): ChartType {
  switch (String(value || '').toLowerCase()) {
    case 'scatter':
      return 'scatter';
    case 'step':
      return 'step';
    case 'bar':
      return 'bar';
    case 'box':
      return 'box';
    case 'candlestick':
      return 'candlestick';
    case 'line':
    default:
      return 'line';
  }
}

export function chartTypeCapabilities(value: unknown): ChartTypeCapabilities {
  const chartType = normalizeChartType(value);
  if (chartType === 'candlestick') {
    return { usesGenericY: false, supportsGroupBy: true, usesOhlc: true };
  }
  if (chartType === 'box') {
    return { usesGenericY: true, supportsGroupBy: true, usesOhlc: false };
  }
  return { usesGenericY: true, supportsGroupBy: true, usesOhlc: false };
}

function buildXyChartData(
  table: ColumnarPanelResult,
  request: LineChartRequest,
  chartType: ChartType,
  recordPanEligibility: boolean
): LineChartData {
  const source = prepareChartSource(table, request);
  const xRange = normalizedChartXRange(request);
  const warnings = source.warnings.slice();
  const collected = collectChartPoints(
    table,
    source.xOption,
    source.yColumnIndexes,
    source.groupColumnIndex,
    xRange,
    request.version,
    recordPanEligibility
  );
  appendCollectedWarnings(warnings, collected, source.xOption.kind, chartType === 'line' || chartType === 'step'
    ? 'Null and non-finite y values are rendered as gaps where sampled.'
    : 'Null and non-finite y values are skipped where sampled.', source.groupColumnName);

  const points = collected.points;
  if (points.length === 0) {
    throw new ChartDataError(xRange ? 'No rows have a plottable x value in the selected x range.' : 'No rows have a plottable x value.');
  }
  const sorted = collected.sourceWasUnsorted;
  if (sorted) {
    warnings.push('x values were sorted for this chart; table order was not changed.');
  }
  const grouped = source.groupColumnName
    ? groupedChartPoints(points, source.yColumnNames, source.groupColumnName, warnings)
    : ungroupedChartPoints(points, source.yColumnNames);
  if (!hasAnyFiniteY(grouped.points)) {
    throw new ChartDataError('No selected y column has finite numeric values.');
  }
  const mayHaveSourceGaps = collected.yMissing > 0 || collected.yInvalid > 0;
  const finiteGroupedPoints = !source.groupColumnName && !mayHaveSourceGaps
    ? grouped.points
    : grouped.points.filter(chartPointHasFiniteY);
  const eligibleRowCount = finiteGroupedPoints.length;

  // Ordinary point charts use one fixed full/ranged density contract. Semantic
  // grouping still happens before sampling and can therefore yield fewer items.
  const targetPointCount = chartType === 'bar'
    ? Math.min(CHART_ORDINARY_TARGET_POINTS, chartTargetPointCount(request.width, request.maxSampledPoints))
    : CHART_ORDINARY_TARGET_POINTS;
  const preparedPoints = chartType === 'bar'
    ? consolidateChartPointsByX(finiteGroupedPoints, grouped.series, chartType, warnings)
    : source.groupColumnName
      ? alignGroupedChartPointsByXOccurrence(finiteGroupedPoints, grouped.series, chartType, warnings,
          (chartType === 'line' || chartType === 'step') && mayHaveSourceGaps)
      : finiteGroupedPoints;
  const temporalSampling = source.xOption.kind === 'temporal' && !source.groupColumnName &&
    chartType !== 'bar' && request.samplingStrategy !== undefined &&
    request.samplingStrategy !== 'point-count';
  const temporalIntervalMs = temporalSampling
    ? request.samplingStrategy === 'temporal-fixed'
      ? (Number.isFinite(request.temporalBucketIntervalMs) && request.temporalBucketIntervalMs! > 0
        ? request.temporalBucketIntervalMs!
        : 1)
      : temporalAutoInterval(preparedPoints, grouped.series.length)
    : undefined;
  const sampled = chartType === 'bar'
    ? downsampleBarClusters(
      preparedPoints,
      source.groupColumnName
        ? Math.max(1, Math.floor(targetPointCount / Math.max(1, grouped.series.length)))
        : targetPointCount,
      warnings
    )
    : temporalSampling
      ? downsampleTemporalMinMax(
        preparedPoints,
        grouped.series.length,
        temporalIntervalMs!,
        (chartType === 'line' || chartType === 'step') && mayHaveSourceGaps,
        targetPointCount
      )
      : downsampleMinMax(
        preparedPoints,
        grouped.series.length,
        targetPointCount,
        (chartType === 'line' || chartType === 'step') && mayHaveSourceGaps
      );
  // Keep the navigator on the full valid-X domain. Missing-Y edge rows are
  // not eligible plotted points, but still define the source domain.
  const xDomain = { min: points[0].x, max: points[points.length - 1].x };
  const series = grouped.series.map((definition, seriesIndex) => {
    const gapFlags = source.groupColumnName
      ? sampled.points.map(point => !!point.gapFlags && point.gapFlags[seriesIndex] === true)
      : [];
    const gapBefore = (chartType === 'line' || chartType === 'step') && mayHaveSourceGaps
      ? sourceGapBeforeSampledPoints(grouped.points, sampled.points, seriesIndex)
      : [];
    const result: LineChartSeries = {
      ...definition,
      values: sampled.points.map(point => point.y[seriesIndex]),
    };
    if (source.groupColumnName) {
      result.gapFlags = gapFlags;
    }
    if (gapBefore.some(Boolean)) {
      result.gapBefore = gapBefore;
    }
    return result;
  });
  const sampledPointCount = chartType === 'bar' && !!source.groupColumnName
    ? series.reduce(
      (count, value) => count + value.values.filter(item => Number.isFinite(item)).length,
      0
    )
    : sampled.points.length;

  return {
    version: request.version,
    requestId: request.requestId,
    chartType,
    xColumn: request.xColumn,
    groupByColumn: source.groupColumnName,
    xKind: source.xOption.kind,
    x: sampled.points.map(point => point.x),
    xText: sampled.points.map(point => point.xText),
    xDomain,
    series,
    sourceRowCount: table.rowCount,
    eligibleRowCount,
    sampledPointCount,
    algorithm: sampled.algorithm,
    samplingStrategy: temporalSampling ? request.samplingStrategy : 'point-count',
    temporalBucketIntervalMs: temporalIntervalMs,
    temporalBucketOrigin: temporalSampling ? 0 : undefined,
    sorted,
    warnings,
  };
}

function buildCandlestickChartData(table: ColumnarPanelResult, request: LineChartRequest): LineChartData {
  const source = prepareCandlestickSource(table, request);
  const xRange = normalizedChartXRange(request);
  const warnings = source.warnings.slice();
  const collected = collectCandlestickPoints(table, source, xRange, request.version);
  if (collected.droppedX > 0) {
    warnings.push(`${collected.droppedX} row${collected.droppedX === 1 ? '' : 's'} dropped because x was null, non-finite, or not ${source.xOption.kind}.`);
  }
  if (collected.rangeExcluded > 0) {
    warnings.push(`${collected.rangeExcluded} row${collected.rangeExcluded === 1 ? '' : 's'} outside the selected x range were skipped.`);
  }
  if (source.groupColumnName && collected.droppedGroup > 0) {
    warnings.push(`${collected.droppedGroup} row${collected.droppedGroup === 1 ? '' : 's'} dropped because ${source.groupColumnName} was empty or not scalar.`);
  }
  if (collected.points.length === 0) {
    throw new ChartDataError(xRange ? 'No rows have a plottable candlestick x value in the selected x range.' : 'No rows have a plottable candlestick x value.');
  }

  const sorted = collected.sourceWasUnsorted;
  if (sorted) {
    warnings.push('x values were sorted for this candlestick chart; table order was not changed.');
  }
  if (source.groupColumnName) {
    return buildGroupedCandlestickChartData(
      table,
      request,
      source,
      collected,
      warnings,
      sorted,
      !!xRange
    );
  }
  const targetPointCount = candlestickTargetPointCount(
    request.width,
    request.maxSampledPoints
  );
  const aggregation = aggregateCandlestickPoints(collected.points, targetPointCount, !!xRange);
  if (aggregation.exactPointCount < collected.points.length) {
    warnings.push(`Candlestick data aggregated ${collected.points.length} eligible rows into ${aggregation.exactPointCount} distinct x candles.`);
  }
  if (aggregation.candlesticks.length < aggregation.exactPointCount) {
    warnings.push(`Candlestick data downsampled ${aggregation.exactPointCount} distinct x candles into ${aggregation.candlesticks.length} financial x buckets.`);
  }

  return {
    version: request.version,
    requestId: request.requestId,
    chartType: 'candlestick',
    xColumn: request.xColumn,
    groupByColumn: undefined,
    xKind: source.xOption.kind,
    x: aggregation.candlesticks.map(candlestick => candlestick.x),
    xText: aggregation.candlesticks.map(candlestick => candlestick.xText),
    xDomain: aggregation.xDomain,
    series: [{
      columnName: 'OHLC',
      sourceColumnName: source.ohlcColumns.close,
      values: aggregation.candlesticks.map(candlestick => candlestick.close),
    }],
    ohlcColumns: source.ohlcColumns,
    candlesticks: aggregation.candlesticks,
    sourceRowCount: table.rowCount,
    eligibleRowCount: collected.points.length,
    sampledPointCount: aggregation.candlesticks.length,
    algorithm: aggregation.algorithm,
    sorted,
    warnings,
  };
}

function buildGroupedCandlestickChartData(
  table: ColumnarPanelResult,
  request: LineChartRequest,
  source: PreparedCandlestickSource,
  collected: CollectedCandlestickPoints,
  warnings: string[],
  sorted: boolean,
  balanceBucketsByCount: boolean
): LineChartData {
  const groupColumnName = source.groupColumnName!;
  const allGroups: string[] = [];
  const seen = new Set<string>();
  collected.points.slice().sort((left, right) => left.rowIndex! - right.rowIndex!).forEach(point => {
    if (point.group && !seen.has(point.group)) {
      seen.add(point.group);
      allGroups.push(point.group);
    }
  });
  if (allGroups.length === 0) {
    throw new ChartDataError(`No grouped candlestick rows have a scalar value for ${groupColumnName}.`);
  }
  const totalBudget = Math.max(1, Math.min(
    CHART_ORDINARY_TARGET_POINTS,
    candlestickTargetPointCount(request.width, request.maxSampledPoints)
  ));
  const retainedGroups = allGroups.slice(0, Math.min(CHART_MAX_GROUPS, totalBudget));
  if (allGroups.length > retainedGroups.length) {
    warnings.push(`Group by ${groupColumnName} has ${allGroups.length} categories with valid OHLC values; showing first ${retainedGroups.length}.`);
  }
  const baseBudget = Math.floor(totalBudget / retainedGroups.length);
  let remainder = totalBudget % retainedGroups.length;
  const aggregated = retainedGroups.map(group => {
    const groupPoints = collected.points.filter(point => point.group === group);
    const budget = Math.max(1, baseBudget + (remainder > 0 ? 1 : 0));
    remainder = Math.max(0, remainder - 1);
    const result = aggregateCandlestickPoints(groupPoints, budget, balanceBucketsByCount);
    return { group, sourceCount: groupPoints.length, result };
  });
  const exactCount = aggregated.reduce((count, value) => count + value.result.exactPointCount, 0);
  const returnedCount = aggregated.reduce((count, value) => count + value.result.candlesticks.length, 0);
  if (exactCount < collected.points.length) {
    warnings.push(`Grouped candlestick data aggregated ${collected.points.length} eligible rows into ${exactCount} category-specific x candles.`);
  }
  if (returnedCount < exactCount) {
    warnings.push(`Grouped candlestick data downsampled ${exactCount} category-specific x candles into ${returnedCount} financial x buckets within one shared budget.`);
  }

  const xTextByValue = new Map<number, string>();
  aggregated.forEach(value => value.result.candlesticks.forEach(candle => {
    if (!xTextByValue.has(candle.x)) xTextByValue.set(candle.x, candle.xText);
  }));
  const x = [...xTextByValue.keys()].sort((left, right) => left - right);
  const xText = x.map(value => xTextByValue.get(value) || String(value));
  const candlestickSeries: CandlestickSeries[] = aggregated.map(value => {
    const byX = new Map(value.result.candlesticks.map(candle => [candle.x, candle]));
    return {
      groupValue: value.group,
      candlesticks: x.map(item => byX.get(item) || null),
    };
  });
  const series: LineChartSeries[] = candlestickSeries.map(value => ({
    columnName: `OHLC [${value.groupValue}]`,
    sourceColumnName: source.ohlcColumns.close,
    groupValue: value.groupValue,
    values: value.candlesticks.map(candle => candle ? candle.close : null),
  }));
  return {
    version: request.version,
    requestId: request.requestId,
    chartType: 'candlestick',
    xColumn: request.xColumn,
    groupByColumn: groupColumnName,
    xKind: source.xOption.kind,
    x,
    xText,
    xDomain: {
      min: collected.points[0].x,
      max: collected.points[collected.points.length - 1].x,
    },
    series,
    ohlcColumns: source.ohlcColumns,
    candlestickSeries,
    retainedGroupCount: retainedGroups.length,
    sourceRowCount: table.rowCount,
    eligibleRowCount: collected.points.length,
    sampledPointCount: returnedCount,
    algorithm: `ohlc-grouped/${returnedCount}`,
    sorted,
    warnings,
  };
}

function buildBoxChartData(table: ColumnarPanelResult, request: LineChartRequest): LineChartData {
  const source = prepareChartSource(table, request);
  const xRange = normalizedChartXRange(request);
  const warnings = source.warnings.slice();
  const collected = collectChartPoints(
    table,
    source.xOption,
    source.yColumnIndexes,
    source.groupColumnIndex,
    xRange,
    request.version
  );
  appendCollectedWarnings(
    warnings,
    collected,
    source.xOption.kind,
    'Null and non-finite y values are skipped for box statistics.',
    source.groupColumnName
  );

  const points = collected.points;
  if (points.length === 0) {
    throw new ChartDataError(xRange ? 'No rows have a plottable x value in the selected x range.' : 'No rows have a plottable x value.');
  }
  if (!hasAnyFiniteY(points)) {
    throw new ChartDataError('No selected y column has finite numeric values.');
  }

  const sorted = collected.sourceWasUnsorted;
  if (sorted) {
    warnings.push('x values were sorted for this chart; table order was not changed.');
  }
  const eligiblePoints = points.filter(chartPointHasFiniteY);
  const grouped = source.groupColumnName
    ? groupedChartPoints(eligiblePoints, source.yColumnNames, source.groupColumnName, warnings)
    : ungroupedChartPoints(eligiblePoints, source.yColumnNames);
  const maxGroups = boxChartTargetGroupCount(
    eligiblePoints.length,
    grouped.series.length,
    request.width,
    request.maxSampledPoints
  );
  const bins = buildBoxChartBins(grouped.points, grouped.series.length, maxGroups);
  const xDomain = { min: points[0].x, max: points[points.length - 1].x };
  const boxSeries = grouped.series.map((definition, seriesIndex) => {
    return {
      columnName: definition.columnName,
      ...(definition.sourceColumnName && definition.sourceColumnName !== definition.columnName
        ? { sourceColumnName: definition.sourceColumnName }
        : {}),
      ...(definition.groupValue ? { groupValue: definition.groupValue } : {}),
      stats: bins.map(bin => bin.stats[seriesIndex]),
    };
  });
  if (!boxSeries.some(series => series.stats.some(stats => stats !== null))) {
    throw new ChartDataError('No selected y column has finite numeric values for box statistics.');
  }

  if (bins.length < distinctXCount(grouped.points)) {
    warnings.push(`Box plot grouped ${eligiblePoints.length} eligible rows into ${bins.length} x buckets.`);
  }

  const retainedGroups = [...new Set(grouped.series
    .map(series => series.groupValue)
    .filter((value): value is string => !!value))];
  const visualItemCount = source.groupColumnName
    ? boxSeries.reduce((count, series) => count + series.stats.filter(Boolean).length, 0)
    : bins.length;

  return {
    version: request.version,
    requestId: request.requestId,
    chartType: 'box',
    xColumn: request.xColumn,
    groupByColumn: source.groupColumnName,
    xKind: source.xOption.kind,
    x: bins.map(bin => bin.x),
    xText: bins.map(bin => bin.xText),
    xDomain,
    series: grouped.series.map((definition, seriesIndex) => {
      return {
        ...definition,
        values: bins.map(bin => {
          const stats = bin.stats[seriesIndex];
          return stats ? stats.median : null;
        }),
      };
    }),
    boxSeries,
    ...(retainedGroups.length > 0 ? { retainedGroupCount: retainedGroups.length } : {}),
    sourceRowCount: table.rowCount,
    eligibleRowCount: eligiblePoints.length,
    sampledPointCount: visualItemCount,
    algorithm: bins.length < distinctXCount(grouped.points) ? `box-bucket/${bins.length}` : `box-exact/${bins.length}`,
    sorted,
    warnings,
  };
}

function prepareChartSource(table: ColumnarPanelResult, request: LineChartRequest): PreparedChartSource {
  const maxSourceRows = positiveInteger(request.maxSourceRows, CHART_MAX_SOURCE_ROWS);
  if (table.rowCount > maxSourceRows) {
    throw new ChartDataError(`Chart source has ${table.rowCount} rows; limit the q result or use the local data server for sources above ${maxSourceRows} rows.`);
  }
  const raisedSourceRowLimit = maxSourceRows > CHART_MAX_SOURCE_ROWS && table.rowCount > CHART_MAX_SOURCE_ROWS;

  const xColumnIndex = table.columns.indexOf(request.xColumn);
  if (xColumnIndex === -1) {
    throw new ChartDataError(`Chart x column not found: ${request.xColumn}`);
  }

  const options = chartColumnOptions(table);
  const xOption = options.xColumns.filter(option => option.columnName === request.xColumn)[0];
  if (!xOption) {
    throw new ChartDataError(`${request.xColumn} is not eligible as a numeric or temporal x column.`);
  }

  const yColumnNames = uniqueStrings(request.yColumns || []);
  if (yColumnNames.length === 0) {
    throw new ChartDataError('Select at least one numeric y column.');
  }

  const yOptionsByName = optionLookup(options.yColumns);
  const yColumnIndexes: number[] = [];
  yColumnNames.forEach(columnName => {
    const option = yOptionsByName[columnName];
    if (!option) {
      throw new ChartDataError(`${columnName} is not eligible as a numeric y column.`);
    }
    yColumnIndexes.push(option.columnIndex);
  });

  const warnings = options.warnings.slice();
  if (raisedSourceRowLimit) {
    warnings.push('Chart source exceeds the default row guard. Very large chartMaxSourceRows values can make rendering slow or temporarily block the extension host, especially with multiple y columns.');
  }

  const groupByColumn = String(request.groupByColumn || '');
  const groupOptionsByName = groupOptionLookup(options.groupColumns);
  const groupOption = groupByColumn ? groupOptionsByName[groupByColumn] : undefined;
  if (groupByColumn && !groupOption) {
    throw new ChartDataError(`${groupByColumn} is not eligible as a scalar group-by column.`);
  }
  if (groupByColumn && (groupByColumn === request.xColumn || yColumnNames.includes(groupByColumn))) {
    throw new ChartDataError('Group by must use a column distinct from X and selected Y columns.');
  }

  return {
    xOption,
    yColumnNames,
    yColumnIndexes,
    groupColumnName: groupOption ? groupOption.columnName : undefined,
    groupColumnIndex: groupOption ? groupOption.columnIndex : undefined,
    warnings,
  };
}

function prepareCandlestickSource(table: ColumnarPanelResult, request: LineChartRequest): PreparedCandlestickSource {
  const maxSourceRows = positiveInteger(request.maxSourceRows, CHART_MAX_SOURCE_ROWS);
  if (table.rowCount > maxSourceRows) {
    throw new ChartDataError(`Chart source has ${table.rowCount} rows; limit the q result or use the local data server for sources above ${maxSourceRows} rows.`);
  }
  const raisedSourceRowLimit = maxSourceRows > CHART_MAX_SOURCE_ROWS && table.rowCount > CHART_MAX_SOURCE_ROWS;

  const xColumnIndex = table.columns.indexOf(request.xColumn);
  if (xColumnIndex === -1) {
    throw new ChartDataError(`Chart x column not found: ${request.xColumn}`);
  }

  const options = chartColumnOptions(table);
  const xOption = options.xColumns.filter(option => option.columnName === request.xColumn)[0];
  if (!xOption) {
    throw new ChartDataError(`${request.xColumn} is not eligible as a numeric or temporal x column.`);
  }

  const selections = [
    { role: 'open', label: 'Open', columnName: String(request.openColumn || '') },
    { role: 'high', label: 'High', columnName: String(request.highColumn || '') },
    { role: 'low', label: 'Low', columnName: String(request.lowColumn || '') },
    { role: 'close', label: 'Close', columnName: String(request.closeColumn || '') },
  ];
  selections.forEach(selection => {
    if (!selection.columnName.trim()) {
      throw new ChartDataError(`Select a numeric ${selection.label} column for candlestick charts.`);
    }
  });

  const rolesByColumn: { [columnName: string]: string[] } = Object.create(null);
  selections.forEach(selection => {
    const roles = rolesByColumn[selection.columnName] || [];
    roles.push(selection.label);
    rolesByColumn[selection.columnName] = roles;
  });
  const duplicateColumn = Object.keys(rolesByColumn).filter(columnName => rolesByColumn[columnName].length > 1)[0];
  if (duplicateColumn) {
    throw new ChartDataError(`Candlestick Open, High, Low, and Close must use four distinct numeric columns; ${rolesByColumn[duplicateColumn].join(' and ')} both select ${duplicateColumn}.`);
  }

  const yOptionsByName = optionLookup(options.yColumns);
  const indexes: number[] = [];
  selections.forEach(selection => {
    const option = yOptionsByName[selection.columnName];
    if (!option) {
      throw new ChartDataError(`Candlestick ${selection.label} column ${selection.columnName} is not eligible as a numeric column.`);
    }
    indexes.push(option.columnIndex);
  });

  const warnings = options.warnings.slice();
  if (raisedSourceRowLimit) {
    warnings.push('Chart source exceeds the default row guard. Very large chartMaxSourceRows values can make rendering slow or temporarily block the extension host, especially with multiple y columns.');
  }

  const groupByColumn = String(request.groupByColumn || '');
  const groupOption = groupByColumn
    ? groupOptionLookup(options.groupColumns)[groupByColumn]
    : undefined;
  if (groupByColumn && !groupOption) {
    throw new ChartDataError(`${groupByColumn} is not eligible as a scalar group-by column.`);
  }
  if (groupByColumn && (groupByColumn === request.xColumn ||
    selections.some(selection => selection.columnName === groupByColumn))) {
    throw new ChartDataError('Group by must use a column distinct from X and OHLC columns.');
  }

  return {
    xOption,
    ohlcColumns: {
      open: selections[0].columnName,
      high: selections[1].columnName,
      low: selections[2].columnName,
      close: selections[3].columnName,
    },
    ohlcColumnIndexes: [indexes[0], indexes[1], indexes[2], indexes[3]],
    ...(groupOption
      ? { groupColumnName: groupOption.columnName, groupColumnIndex: groupOption.columnIndex }
      : {}),
    warnings,
  };
}

function collectCandlestickPoints(
  table: ColumnarPanelResult,
  source: PreparedCandlestickSource,
  xRange: ChartXRange | undefined,
  sourceVersion: number
): CollectedCandlestickPoints {
  const points: CandlestickInputPoint[] = [];
  let droppedGroup = 0;
  const roles = [
    { label: 'Open', columnName: source.ohlcColumns.open, columnIndex: source.ohlcColumnIndexes[0] },
    { label: 'High', columnName: source.ohlcColumns.high, columnIndex: source.ohlcColumnIndexes[1] },
    { label: 'Low', columnName: source.ohlcColumns.low, columnIndex: source.ohlcColumnIndexes[2] },
    { label: 'Close', columnName: source.ohlcColumns.close, columnIndex: source.ohlcColumnIndexes[3] },
  ];

  const append = (rowIndex: number, x: NormalizedValue): void => {
    if (xRange && (x.value < xRange.min || x.value > xRange.max)) {
      return;
    }
    let group: string | undefined;
    if (source.groupColumnIndex !== undefined) {
      group = normalizeCategoricalValue(table.cellValue(rowIndex, source.groupColumnIndex)) || undefined;
      if (!group) {
        droppedGroup += 1;
        return;
      }
    }
    const values: number[] = [];
    roles.forEach(role => {
      const raw = table.cellValue(rowIndex, role.columnIndex);
      if (isMissing(raw)) {
        throw new ChartDataError(`Candlestick ${role.label} column ${role.columnName} is missing at row ${rowIndex + 1} (x ${x.text}); filter or fill the source value before rendering.`);
      }
      const value = normalizeNumericValue(raw);
      if (value === null) {
        throw new ChartDataError(`Candlestick ${role.label} column ${role.columnName} must contain a finite numeric value at row ${rowIndex + 1} (x ${x.text}).`);
      }
      values.push(value);
    });

    const groupContext = group ? `, group ${group}` : '';
    validateCandlestickEnvelope(values[0], values[1], values[2], values[3], `row ${rowIndex + 1} (x ${x.text}${groupContext})`);
    points.push({
      rowIndex,
      ...(group ? { group } : {}),
      x: x.value,
      xText: x.text,
      open: values[0],
      high: values[1],
      low: values[2],
      close: values[3],
    });
  };
  let builtIndex = false;
  const xIndex = chartXIndex(
    table,
    source.xOption.columnIndex,
    source.xOption.kind,
    sourceVersion,
    (rowIndex, x) => {
      builtIndex = true;
      append(rowIndex, x);
    }
  );
  const bounds = chartXIndexBounds(xIndex, xRange);
  if (!builtIndex) {
    for (let entryIndex = bounds.start; entryIndex < bounds.end; entryIndex += 1) {
      append(xIndex.rowIndexes[entryIndex], {
        value: xIndex.x[entryIndex],
        text: xIndex.xText[entryIndex],
      });
    }
  } else if (xIndex.sourceWasUnsorted) {
    points.sort((left, right) => left.x - right.x || (left.rowIndex || 0) - (right.rowIndex || 0));
  }

  return {
    points,
    droppedX: xIndex.droppedX,
    droppedGroup,
    rangeExcluded: bounds.rangeExcluded,
    sourceWasUnsorted: xIndex.sourceWasUnsorted,
  };
}

function collectChartPoints(
  table: ColumnarPanelResult,
  xOption: ChartColumnOption,
  yColumnIndexes: number[],
  groupColumnIndex?: number,
  xRange?: ChartXRange,
  sourceVersion = 0,
  recordPanEligibility = false
): CollectedChartPoints {
  const points: ChartPoint[] = [];
  let droppedGroup = 0;
  let yMissing = 0;
  let yInvalid = 0;
  const append = (rowIndex: number, x: NormalizedValue): void => {
    if (xRange && (x.value < xRange.min || x.value > xRange.max)) {
      return;
    }
    let group: string | undefined;
    if (groupColumnIndex !== undefined) {
      const groupValue = normalizeCategoricalValue(table.cellValue(rowIndex, groupColumnIndex));
      if (groupValue === null) {
        droppedGroup += 1;
        return;
      }
      group = groupValue;
    }

    const yValues = yColumnIndexes.map(columnIndex => {
      const raw = table.cellValue(rowIndex, columnIndex);
      if (isMissing(raw)) {
        yMissing += 1;
        return null;
      }
      const y = normalizeNumericValue(raw);
      if (y === null) {
        yInvalid += 1;
      }
      return y;
    });
    points.push({ rowIndex, x: x.value, xText: x.text, group, y: yValues });
  };
  const slot = chartXIndexCacheSlot(table, xOption.columnIndex, xOption.kind, sourceVersion);
  let xIndex = slot.cached;
  if (!xIndex) {
    let x: number[] = [];
    let xText: string[] = [];
    let rowIndexes: number[] = [];
    let droppedX = 0;
    let sourceWasUnsorted = false;
    let previousX = -Infinity;
    for (let rowIndex = 0; rowIndex < table.rowCount; rowIndex += 1) {
      const normalized = normalizeXValue(table.cellValue(rowIndex, xOption.columnIndex), xOption.kind);
      if (!normalized) {
        droppedX += 1;
        continue;
      }
      if (normalized.value < previousX) {
        sourceWasUnsorted = true;
      }
      previousX = normalized.value;
      x.push(normalized.value);
      xText.push(normalized.text);
      rowIndexes.push(rowIndex);
      append(rowIndex, normalized);
    }
    if (sourceWasUnsorted) {
      const order = x.map((_value, index) => index)
        .sort((left, right) => x[left] - x[right] || rowIndexes[left] - rowIndexes[right]);
      x = order.map(index => x[index]);
      xText = order.map(index => xText[index]);
      rowIndexes = order.map(index => rowIndexes[index]);
      points.sort((left, right) => left.x - right.x || left.rowIndex - right.rowIndex);
    }
    xIndex = {
      columnIndex: xOption.columnIndex,
      kind: xOption.kind,
      sourceVersion,
      rowCount: table.rowCount,
      x,
      xText,
      rowIndexes,
      droppedX,
      sourceWasUnsorted,
    };
    slot.cache.indexes.set(slot.key, xIndex);
  }
  const bounds = chartXIndexBounds(xIndex, xRange);
  if (slot.cached) {
    for (let entryIndex = bounds.start; entryIndex < bounds.end; entryIndex += 1) {
      append(xIndex.rowIndexes[entryIndex], {
        value: xIndex.x[entryIndex],
        text: xIndex.xText[entryIndex],
      });
    }
  }
  if (recordPanEligibility && groupColumnIndex === undefined &&
    points.length === bounds.end - bounds.start) {
    recordChartEligibility(
      xIndex,
      chartEligibilityKey(yColumnIndexes),
      bounds.start,
      bounds.end,
      points
    );
  }

  return {
    points,
    droppedX: xIndex.droppedX,
    droppedGroup,
    rangeExcluded: bounds.rangeExcluded,
    yMissing,
    yInvalid,
    sourceWasUnsorted: xIndex.sourceWasUnsorted,
  };
}

function appendCollectedWarnings(
  warnings: string[],
  collected: CollectedChartPoints,
  xKind: ChartColumnKind,
  yWarning: string,
  groupColumnName?: string
): void {
  if (collected.droppedX > 0) {
    warnings.push(`${collected.droppedX} row${collected.droppedX === 1 ? '' : 's'} dropped because x was null, non-finite, or not ${xKind}.`);
  }
  if (collected.rangeExcluded > 0) {
    warnings.push(`${collected.rangeExcluded} row${collected.rangeExcluded === 1 ? '' : 's'} outside the selected x range were skipped.`);
  }
  if (groupColumnName && collected.droppedGroup > 0) {
    warnings.push(`${collected.droppedGroup} row${collected.droppedGroup === 1 ? '' : 's'} dropped because ${groupColumnName} was empty or not scalar.`);
  }
  if (collected.yMissing > 0 || collected.yInvalid > 0) {
    warnings.push(yWarning);
  }
}

function ungroupedChartPoints(points: ChartPoint[], yColumnNames: string[]): { points: ChartPoint[]; series: ChartSeriesDefinition[] } {
  return {
    points,
    series: yColumnNames.map(columnName => ({ columnName, sourceColumnName: columnName })),
  };
}

function groupedChartPoints(
  points: ChartPoint[],
  yColumnNames: string[],
  groupColumnName: string,
  warnings: string[]
): { points: ChartPoint[]; series: ChartSeriesDefinition[] } {
  const groups = retainedChartGroups(points, groupColumnName, warnings);
  if (groups.length === 0) {
    throw new ChartDataError(`No grouped series has a finite selected y value for ${groupColumnName}.`);
  }
  const finiteCombinations: { [key: string]: boolean } = Object.create(null);
  points.forEach(point => {
    const group = point.group || '';
    if (groups.indexOf(group) === -1) {
      return;
    }
    point.y.forEach((value, yIndex) => {
      if (Number.isFinite(value)) {
        finiteCombinations[`${group}\u0000${yIndex}`] = true;
      }
    });
  });
  const totalFiniteCombinationCount = groups.reduce((count, group) => {
    return count + yColumnNames.reduce((groupCount, _columnName, yIndex) => {
      return groupCount + (finiteCombinations[`${group}\u0000${yIndex}`] ? 1 : 0);
    }, 0);
  }, 0);
  const mappings: Array<{ group: string; yIndex: number }> = [];
  const series: ChartSeriesDefinition[] = [];
  groups.forEach(group => {
    yColumnNames.forEach((columnName, yIndex) => {
      if (!finiteCombinations[`${group}\u0000${yIndex}`] || series.length >= CHART_MAX_GROUPED_SERIES) {
        return;
      }
      mappings.push({ group, yIndex });
      series.push({
        columnName: `${columnName} [${group}]`,
        sourceColumnName: columnName,
        groupValue: group,
      });
    });
  });
  const emptyCombinationCount = groups.length * yColumnNames.length - totalFiniteCombinationCount;
  if (emptyCombinationCount > 0) {
    warnings.push(`Group by ${groupColumnName} omitted ${emptyCombinationCount} group/Y combination${emptyCombinationCount === 1 ? '' : 's'} with no finite values.`);
  }
  if (totalFiniteCombinationCount > CHART_MAX_GROUPED_SERIES) {
    warnings.push(`Group by ${groupColumnName} has ${totalFiniteCombinationCount} finite generated series; showing first ${CHART_MAX_GROUPED_SERIES}.`);
  }
  const mappedGroups: { [group: string]: boolean } = Object.create(null);
  mappings.forEach(mapping => {
    mappedGroups[mapping.group] = true;
  });
  const expandedPoints: ChartPoint[] = [];
  points.forEach(point => {
    const group = point.group || '';
    if (!mappedGroups[group]) {
      return;
    }
    const y = series.map(() => null as number | null);
    const gapFlags = series.map(() => false);
    mappings.forEach((mapping, seriesIndex) => {
      if (mapping.group !== group) {
        return;
      }
      y[seriesIndex] = point.y[mapping.yIndex];
      gapFlags[seriesIndex] = point.y[mapping.yIndex] === null;
    });
    expandedPoints.push({ ...point, y, gapFlags });
  });
  return { points: expandedPoints, series };
}

function consolidateChartPointsByX(
  points: ChartPoint[],
  series: ChartSeriesDefinition[],
  chartType: ChartType,
  warnings: string[]
): ChartPoint[] {
  const clusters: ChartPoint[] = [];
  let start = 0;
  while (start < points.length) {
    let end = start + 1;
    while (end < points.length && points[end].x === points[start].x) {
      end += 1;
    }

    const clusterPoints = points.slice(start, end);
    const values = series.map(() => null as number | null);
    const hasGapFlags = clusterPoints.some(point => Array.isArray(point.gapFlags));
    const gapFlags = series.map(() => false);
    clusterPoints.forEach(point => {
      series.forEach((definition, seriesIndex) => {
        const value = point.y[seriesIndex];
        if (!Number.isFinite(value)) {
          if (point.gapFlags && point.gapFlags[seriesIndex] === true) {
            gapFlags[seriesIndex] = true;
          }
          return;
        }
        if (Number.isFinite(values[seriesIndex])) {
          const label = chartType === 'bar' ? 'Bar chart' : `${chartTypeLabel(chartType)} chart grouping`;
          throw new ChartDataError(`${label} has multiple finite values for ${definition.columnName} at x ${points[start].xText}; use a unique x value per group or aggregate the source in q.`);
        }
        values[seriesIndex] = value;
        gapFlags[seriesIndex] = false;
      });
    });
    values.forEach((value, seriesIndex) => {
      if (Number.isFinite(value)) {
        gapFlags[seriesIndex] = false;
      }
    });

    const cluster: ChartPoint = {
      ...points[start],
      y: values,
    };
    if (hasGapFlags) {
      cluster.gapFlags = gapFlags;
    } else {
      delete cluster.gapFlags;
    }
    clusters.push(cluster);
    start = end;
  }

  if (clusters.length < points.length) {
    warnings.push(chartType === 'bar'
      ? `Bar chart aligned ${points.length} eligible rows into ${clusters.length} distinct x clusters without stacking overlapping bars.`
      : `${chartTypeLabel(chartType)} chart aligned ${points.length} grouped rows into ${clusters.length} distinct x positions.`);
  }
  return clusters;
}

/**
 * Align ordinary grouped series without discarding repeated observations.
 * Every (x, group) cluster keeps its stable source-order occurrences. Groups
 * with fewer occurrences receive structural nulls so every series remains
 * aligned to the same repeated-X slots.
 */
function alignGroupedChartPointsByXOccurrence(
  points: ChartPoint[],
  series: ChartSeriesDefinition[],
  chartType: ChartType,
  warnings: string[],
  preserveSourceGaps: boolean
): ChartPoint[] {
  const aligned: ChartPoint[] = [];
  let repeatedGroupObservationCount = 0;
  let start = 0;
  while (start < points.length) {
    let end = start + 1;
    while (end < points.length && points[end].x === points[start].x) {
      end += 1;
    }
    const clusterPoints = points.slice(start, end);
    const byGroup: { [group: string]: ChartPoint[] } = Object.create(null);
    const groups: string[] = [];
    clusterPoints.forEach(point => {
      const group = point.group || '';
      if (!byGroup[group]) {
        byGroup[group] = [];
        groups.push(group);
      }
      byGroup[group].push(point);
    });
    const occurrenceCount = groups.reduce(
      (maximum, group) => Math.max(maximum, byGroup[group].length),
      0
    );
    groups.forEach(group => {
      repeatedGroupObservationCount += Math.max(0, byGroup[group].length - 1);
    });
    for (let occurrence = 0; occurrence < occurrenceCount; occurrence += 1) {
      const occurrencePoints = groups
        .map(group => byGroup[group][occurrence])
        .filter((point): point is ChartPoint => !!point);
      const values = series.map(() => null as number | null);
      const gapFlags = series.map(() => false);
      const sourceRowIndexes = preserveSourceGaps
        ? series.map(() => undefined as number | undefined) : undefined;
      occurrencePoints.forEach(point => {
        series.forEach((_definition, seriesIndex) => {
          const value = point.y[seriesIndex];
          if (Number.isFinite(value)) {
            values[seriesIndex] = value;
            if (sourceRowIndexes) sourceRowIndexes[seriesIndex] = point.rowIndex;
            gapFlags[seriesIndex] = false;
          } else if (point.gapFlags?.[seriesIndex] === true) {
            gapFlags[seriesIndex] = true;
          }
        });
      });
      aligned.push({
        ...clusterPoints[0],
        rowIndex: Math.min(...occurrencePoints.map(point => point.rowIndex)),
        y: values,
        gapFlags,
        ...(sourceRowIndexes ? { sourceRowIndexes } : {}),
      });
    }
    start = end;
  }

  if (repeatedGroupObservationCount > 0) {
    warnings.push(
      `${chartTypeLabel(chartType)} chart preserved ${repeatedGroupObservationCount} repeated grouped observation${repeatedGroupObservationCount === 1 ? '' : 's'} in stable source-occurrence slots.`
    );
  } else if (aligned.length < points.length) {
    warnings.push(
      `${chartTypeLabel(chartType)} chart aligned ${points.length} grouped rows into ${aligned.length} distinct x positions.`
    );
  }
  return aligned;
}

function downsampleBarClusters(
  points: ChartPoint[],
  maxPoints: number,
  warnings: string[]
): { points: ChartPoint[]; algorithm: string } {
  const limit = positiveInteger(maxPoints, CHART_MAX_SAMPLED_POINTS);
  if (points.length <= limit) {
    return { points, algorithm: `bar-cluster/${points.length}` };
  }
  if (limit === 1) {
    warnings.push(`Bar chart sampled ${points.length} distinct x clusters to 1; the first cluster keeps all selected series.`);
    return { points: [points[0]], algorithm: 'bar-cluster-even/1' };
  }
  const sampled = evenlyThin(points, limit);
  warnings.push(`Bar chart sampled ${points.length} distinct x clusters to ${sampled.length}; every retained cluster keeps all selected series.`);
  return { points: sampled, algorithm: `bar-cluster-even/${limit}` };
}

function retainedChartGroups(points: ChartPoint[], groupColumnName: string, warnings: string[]): string[] {
  const groups: string[] = [];
  const seen: { [group: string]: boolean } = Object.create(null);
  const hasFiniteY: { [group: string]: boolean } = Object.create(null);
  points.slice().sort((left, right) => left.rowIndex - right.rowIndex).forEach(point => {
    const group = point.group || '';
    if (group && !seen[group]) {
      seen[group] = true;
      groups.push(group);
    }
    if (group && point.y.some(value => Number.isFinite(value))) {
      hasFiniteY[group] = true;
    }
  });
  const finiteGroups = groups.filter(group => hasFiniteY[group]);
  const omittedEmptyCount = groups.length - finiteGroups.length;
  if (omittedEmptyCount > 0) {
    warnings.push(`Group by ${groupColumnName} omitted ${omittedEmptyCount} categor${omittedEmptyCount === 1 ? 'y' : 'ies'} with no finite selected y values.`);
  }
  if (finiteGroups.length > CHART_MAX_GROUPS) {
    warnings.push(`Group by ${groupColumnName} has ${finiteGroups.length} categories with finite values; showing first ${CHART_MAX_GROUPS}.`);
  }
  return finiteGroups.slice(0, CHART_MAX_GROUPS);
}

function chartTypeLabel(chartType: ChartType): string {
  return chartType.slice(0, 1).toUpperCase() + chartType.slice(1);
}

export function chartTargetPointCount(
  width: number,
  maxSampledPoints = CHART_MAX_SAMPLED_POINTS
): number {
  const pixelWidth = Math.max(1, Math.floor(Number(width) || 0));
  const maxPoints = positiveInteger(maxSampledPoints, CHART_MAX_SAMPLED_POINTS);
  const target = Math.max(200, pixelWidth * CHART_POINTS_PER_PIXEL);
  return Math.min(maxPoints, target);
}

export function candlestickTargetPointCount(
  width: number,
  maxSampledPoints = CHART_MAX_SAMPLED_POINTS
): number {
  const pixelWidth = Math.max(1, Math.floor(Number(width) || 0));
  const maxPoints = positiveInteger(maxSampledPoints, CHART_MAX_SAMPLED_POINTS);
  return Math.min(CHART_ORDINARY_TARGET_POINTS, maxPoints, pixelWidth * CHART_CANDLES_PER_PIXEL);
}

export function boxChartTargetGroupCount(
  eligibleRows: number,
  seriesCount: number,
  width: number,
  maxSampledPoints = CHART_MAX_SAMPLED_POINTS
): number {
  const target = chartTargetPointCount(width, maxSampledPoints);
  const maxBySeries = Math.max(8, Math.floor(target / Math.max(1, seriesCount * 8)));
  return Math.max(1, Math.min(Math.max(1, Math.floor(eligibleRows)), CHART_MAX_BOX_GROUPS, maxBySeries));
}

export function aggregateCandlestickPoints(
  points: CandlestickInputPoint[],
  maxPoints: number,
  balanceBucketsByCount = false
): CandlestickAggregationResult {
  if (points.length === 0) {
    return { candlesticks: [], exactPointCount: 0, algorithm: 'ohlc-exact/0' };
  }

  if (points.some(point => !Number.isFinite(point.x))) {
    throw new ChartDataError('Candlestick aggregation requires finite numeric x values.');
  }

  const sorted = points.map((point, index) => ({ point, index })).sort((left, right) => {
    if (left.point.x < right.point.x) {
      return -1;
    }
    if (left.point.x > right.point.x) {
      return 1;
    }
    const leftRow = Number.isFinite(left.point.rowIndex) ? Number(left.point.rowIndex) : left.index;
    const rightRow = Number.isFinite(right.point.rowIndex) ? Number(right.point.rowIndex) : right.index;
    return leftRow === rightRow ? left.index - right.index : leftRow - rightRow;
  }).map(item => item.point);

  sorted.forEach(point => validatePartialCandlestickEnvelope(point, `x ${point.xText || point.x}`));

  const exact: CandlestickDataPoint[] = [];
  let start = 0;
  while (start < sorted.length) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].x === sorted[start].x) {
      end += 1;
    }
    exact.push(aggregateCandlestickBucket(sorted.slice(start, end)));
    start = end;
  }
  const xDomain = { min: exact[0].x, max: exact[exact.length - 1].x };

  const limit = positiveInteger(maxPoints, CHART_MAX_SAMPLED_POINTS);
  if (exact.length <= limit) {
    return {
      candlesticks: exact,
      exactPointCount: exact.length,
      algorithm: `ohlc-exact/${exact.length}`,
      xDomain,
    };
  }

  const bucketCount = Math.max(1, Math.min(limit, exact.length));
  if (balanceBucketsByCount) {
    const candlesticks: CandlestickDataPoint[] = [];
    for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex++) {
      const start = Math.floor(bucketIndex * exact.length / bucketCount);
      const end = Math.max(start + 1, Math.floor((bucketIndex + 1) * exact.length / bucketCount));
      candlesticks.push(aggregateCandlestickBucket(exact.slice(start, end)));
    }
    return {
      candlesticks,
      exactPointCount: exact.length,
      algorithm: `ohlc-bucket/${candlesticks.length}`,
      xDomain,
    };
  }

  const buckets: CandlestickDataPoint[][] = Array.from({ length: bucketCount }, () => []);
  const domainScale = Math.max(1, Math.abs(xDomain.min), Math.abs(xDomain.max));
  const scaledMin = xDomain.min / domainScale;
  const scaledMax = xDomain.max / domainScale;
  const scaledSpan = scaledMax - scaledMin;
  exact.forEach((point, pointIndex) => {
    const position = scaledSpan > 0
      ? ((point.x / domainScale) - scaledMin) / scaledSpan
      : pointIndex / Math.max(1, exact.length - 1);
    const bucketIndex = pointIndex === exact.length - 1
      ? bucketCount - 1
      : Math.max(0, Math.min(bucketCount - 1, Math.floor(position * bucketCount)));
    buckets[bucketIndex].push(point);
  });
  const candlesticks: CandlestickDataPoint[] = [];
  buckets.forEach(bucket => {
    if (bucket.length === 0) {
      return;
    }
    candlesticks.push(aggregateCandlestickBucket(bucket.map((point, pointIndex) => ({
      ...point,
      rowIndex: pointIndex,
    }))));
  });
  return {
    candlesticks,
    exactPointCount: exact.length,
    algorithm: `ohlc-bucket/${candlesticks.length}`,
    xDomain,
  };
}

function aggregateCandlestickBucket(points: CandlestickInputPoint[]): CandlestickDataPoint {
  if (points.length === 0) {
    throw new ChartDataError('Candlestick aggregation cannot create an empty x bucket.');
  }
  let open: number | null = null;
  let high: number | null = null;
  let low: number | null = null;
  let close: number | null = null;
  points.forEach(point => {
    if (open === null && Number.isFinite(point.open)) {
      open = point.open;
    }
    if (Number.isFinite(point.high)) {
      high = high === null ? point.high : Math.max(high, point.high as number);
    }
    if (Number.isFinite(point.low)) {
      low = low === null ? point.low : Math.min(low, point.low as number);
    }
    if (Number.isFinite(point.close)) {
      close = point.close;
    }
  });

  const first = points[0];
  const last = points[points.length - 1];
  const xDescription = first.x === last.x
    ? (first.xText || String(first.x))
    : `${first.xText || first.x}..${last.xText || last.x}`;
  if (open === null) {
    throw new ChartDataError(`Candlestick x bucket ${xDescription} has no finite Open value.`);
  }
  if (high === null) {
    throw new ChartDataError(`Candlestick x bucket ${xDescription} has no finite High value.`);
  }
  if (low === null) {
    throw new ChartDataError(`Candlestick x bucket ${xDescription} has no finite Low value.`);
  }
  if (close === null) {
    throw new ChartDataError(`Candlestick x bucket ${xDescription} has no finite Close value.`);
  }
  validateCandlestickEnvelope(open, high, low, close, `x bucket ${xDescription}`);
  return {
    x: first.x === last.x ? first.x : first.x / 2 + last.x / 2,
    xText: xDescription,
    open,
    high,
    low,
    close,
  };
}

function validatePartialCandlestickEnvelope(point: CandlestickInputPoint, context: string): void {
  const open = Number.isFinite(point.open) ? point.open as number : null;
  const high = Number.isFinite(point.high) ? point.high as number : null;
  const low = Number.isFinite(point.low) ? point.low as number : null;
  const close = Number.isFinite(point.close) ? point.close as number : null;
  if (high !== null && low !== null && high < low) {
    throw new ChartDataError(`Invalid candlestick ${context}: High ${high} must be greater than or equal to Low ${low}.`);
  }
  if (high !== null && ((open !== null && high < open) || (close !== null && high < close))) {
    throw new ChartDataError(`Invalid candlestick ${context}: High ${high} must be greater than or equal to Open and Close.`);
  }
  if (low !== null && ((open !== null && low > open) || (close !== null && low > close))) {
    throw new ChartDataError(`Invalid candlestick ${context}: Low ${low} must be less than or equal to Open and Close.`);
  }
}

function validateCandlestickEnvelope(open: number, high: number, low: number, close: number, context: string): void {
  validatePartialCandlestickEnvelope({ x: 0, xText: context, open, high, low, close }, context);
}

export function boxStats(values: number[]): BoxChartStats | null {
  const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (finite.length === 0) {
    return null;
  }
  return {
    count: finite.length,
    min: finite[0],
    q1: quantile(finite, 0.25),
    median: quantile(finite, 0.5),
    q3: quantile(finite, 0.75),
    max: finite[finite.length - 1],
  };
}

export function inferColumn(
  table: ColumnarPanelResult,
  columnIndex: number,
  sampleSize = CHART_INFERENCE_SAMPLE_SIZE
): ColumnInference {
  const qType = table.columnTypes?.[columnIndex];
  const declaredKind = qTypeChartColumnKind(qType);
  if (declaredKind) {
    return {
      numeric: declaredKind === 'numeric',
      temporal: declaredKind === 'temporal',
      categorical: true,
      sampled: sampledScalarCount(table, columnIndex, sampleSize),
      missing: 0,
      invalid: 0,
    };
  }
  if (isKnownQType(qType)) {
    return {
      numeric: false,
      temporal: false,
      categorical: declaredScalarGroupQType(qType),
      sampled: sampledScalarCount(table, columnIndex, sampleSize),
      missing: 0,
      invalid: 0,
    };
  }
  let sampled = 0;
  let missing = 0;
  let numeric = 0;
  let temporal = 0;
  let categorical = 0;
  let invalid = 0;
  if (columnIndex < 0 || columnIndex >= table.columns.length || table.rowCount <= 0) {
    return { numeric: false, temporal: false, categorical: false, sampled, missing, invalid };
  }

  const targetSamples = Math.max(1, Math.floor(sampleSize));
  const step = Math.max(1, Math.floor(table.rowCount / targetSamples));
  for (let rowIndex = 0; rowIndex < table.rowCount && sampled < targetSamples; rowIndex += step) {
    const value = table.cellValue(rowIndex, columnIndex);
    if (isMissing(value) || isNonFiniteScalar(value)) {
      missing += 1;
      continue;
    }
    sampled += 1;
    if (normalizeNumericValue(value) !== null) {
      numeric += 1;
      continue;
    }
    if (normalizeTemporalValue(value) !== null) {
      temporal += 1;
      continue;
    }
    if (normalizeCategoricalValue(value) !== null) {
      categorical += 1;
      continue;
    }
    invalid += 1;
  }

  return {
    numeric: sampled > 0 && numeric === sampled,
    temporal: sampled > 0 && temporal === sampled,
    categorical: sampled > 0 && numeric + temporal + categorical === sampled && invalid === 0,
    sampled,
    missing,
    invalid,
  };
}

function sampledScalarCount(
  table: ColumnarPanelResult,
  columnIndex: number,
  sampleSize: number
): number {
  if (columnIndex < 0 || columnIndex >= table.columns.length || table.rowCount <= 0) {
    return 0;
  }
  const targetSamples = Math.max(1, Math.floor(sampleSize));
  const step = Math.max(1, Math.floor(table.rowCount / targetSamples));
  let sampled = 0;
  for (let rowIndex = 0; rowIndex < table.rowCount && sampled < targetSamples; rowIndex += step) {
    const value = table.cellValue(rowIndex, columnIndex);
    if (!isMissing(value) && !isNonFiniteScalar(value)) {
      sampled += 1;
    }
  }
  return sampled;
}

function declaredScalarGroupQType(qType: unknown): boolean {
  return isKnownQType(qType);
}

function buildBoxChartBins(points: ChartPoint[], seriesCount: number, maxGroups: number): BoxChartBin[] {
  if (points.length === 0) {
    return [];
  }

  const uniqueCount = distinctXCount(points);
  if (uniqueCount <= maxGroups) {
    const bins: BoxChartBin[] = [];
    let start = 0;
    while (start < points.length) {
      let end = start + 1;
      while (end < points.length && points[end].x === points[start].x) {
        end += 1;
      }
      const group = points.slice(start, end);
      bins.push({
        x: points[start].x,
        xText: points[start].xText,
        stats: boxStatsForPoints(group, seriesCount),
        points: group,
      });
      start = end;
    }
    return bins;
  }

  const xRuns: Array<{ start: number; end: number }> = [];
  let runStart = 0;
  while (runStart < points.length) {
    let runEnd = runStart + 1;
    while (runEnd < points.length && points[runEnd].x === points[runStart].x) {
      runEnd += 1;
    }
    xRuns.push({ start: runStart, end: runEnd });
    runStart = runEnd;
  }

  const groupCount = Math.max(1, Math.min(maxGroups, xRuns.length));
  const bins: BoxChartBin[] = [];
  for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
    const firstRunIndex = Math.floor(groupIndex * xRuns.length / groupCount);
    const lastRunIndex = Math.max(firstRunIndex, Math.floor((groupIndex + 1) * xRuns.length / groupCount) - 1);
    const group = points.slice(xRuns[firstRunIndex].start, xRuns[lastRunIndex].end);
    const first = group[0];
    const last = group[group.length - 1];
    bins.push({
      x: (first.x + last.x) / 2,
      xText: first.x === last.x ? first.xText : `${first.xText}..${last.xText}`,
      stats: boxStatsForPoints(group, seriesCount),
      points: group,
    });
  }
  return bins;
}

function boxStatsForPoints(points: ChartPoint[], seriesCount: number): Array<BoxChartStats | null> {
  const stats: Array<BoxChartStats | null> = [];
  for (let seriesIndex = 0; seriesIndex < seriesCount; seriesIndex++) {
    const values: number[] = [];
    points.forEach(point => {
      const value = point.y[seriesIndex];
      if (Number.isFinite(value)) {
        values.push(value as number);
      }
    });
    stats.push(boxStats(values));
  }
  return stats;
}

function distinctXCount(points: ChartPoint[]): number {
  if (points.length === 0) {
    return 0;
  }
  let count = 1;
  for (let index = 1; index < points.length; index++) {
    if (points[index].x !== points[index - 1].x) {
      count += 1;
    }
  }
  return count;
}

function quantile(sortedValues: number[], fraction: number): number {
  if (sortedValues.length === 1) {
    return sortedValues[0];
  }
  const position = (sortedValues.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) {
    return sortedValues[lower];
  }
  const weight = position - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function optionLookup(options: ChartColumnOption[]): { [columnName: string]: ChartColumnOption } {
  const lookup: { [columnName: string]: ChartColumnOption } = Object.create(null);
  options.forEach(option => {
    if (!lookup[option.columnName]) {
      lookup[option.columnName] = option;
    }
  });
  return lookup;
}

function groupOptionLookup(options: ChartGroupColumnOption[]): { [columnName: string]: ChartGroupColumnOption } {
  const lookup: { [columnName: string]: ChartGroupColumnOption } = Object.create(null);
  options.forEach(option => {
    if (!lookup[option.columnName]) {
      lookup[option.columnName] = option;
    }
  });
  return lookup;
}

function uniqueStrings(values: string[]): string[] {
  const seen: { [value: string]: boolean } = Object.create(null);
  const result: string[] = [];
  values.forEach(value => {
    const text = String(value || '');
    if (text && !seen[text]) {
      seen[text] = true;
      result.push(text);
    }
  });
  return result;
}

/** Shared scalar coordinates for interactive charts and static saved fallbacks. */
export function chartScalarNumber(value: unknown, kind: ChartColumnKind = 'numeric'): number | undefined {
  return normalizeXValue(value, kind)?.value;
}

function normalizeXValue(value: unknown, kind: ChartColumnKind): NormalizedValue | null {
  return kind === 'temporal' ? normalizeTemporalValue(value) : normalizeNumericValueWithText(value);
}

function normalizeNumericValue(value: unknown): number | null {
  value = semanticQValue(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  // Y values need no per-observation formatted X label.
  return typeof value === 'string' ? normalizeNumericValueWithText(value)?.value ?? null : null;
}

function normalizeNumericValueWithText(value: unknown): NormalizedValue | null {
  value = semanticQValue(value);
  if (isMissing(value)) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { value, text: String(value) } : null;
  }
  if (typeof value === 'bigint') {
    const number = Number(value);
    return Number.isFinite(number) ? { value: number, text: String(value) } : null;
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!/^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?$/.test(text)) {
      return null;
    }
    const number = Number(text);
    return Number.isFinite(number) ? { value: number, text } : null;
  }
  return null;
}

function normalizeTemporalValue(value: unknown): NormalizedValue | null {
  value = semanticQValue(value);
  if (isMissing(value)) {
    return null;
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? { value: time, text: value.toISOString() } : null;
  }
  if (typeof value !== 'string') {
    return null;
  }

  const text = value.trim();
  let match = /^(\d{4})\.(\d{2})$/.exec(text);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month >= 1 && month <= 12) {
      return { value: Date.UTC(year, month - 1, 1), text };
    }
  }

  match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(text);
  if (match) {
    const time = parseIsoTemporalMilliseconds(text);
    return Number.isFinite(time) ? { value: time, text } : null;
  }

  match = /^([+-])?(?:(\d+)D )?(\d{1,2}):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,9}))?)?$/.exec(text);
  if (match) {
    const sign = match[1] === '-' ? -1 : 1;
    const days = match[2] ? Number(match[2]) : 0;
    const hours = Number(match[3]);
    const minutes = Number(match[4]);
    const seconds = match[5] ? Number(match[5]) : 0;
    const fraction = match[6] ? Number(`0.${match[6]}`) : 0;
    if (hours <= 23 || days === 0) {
      return {
        value: sign * ((((days * 24 + hours) * 60 + minutes) * 60 + seconds + fraction) * 1000),
        text,
      };
    }
  }

  return null;
}

function parseIsoTemporalMilliseconds(text: string): number {
  const normalized = text.replace(
    /(\.\d{3})\d+(?=(?:Z|[+-]\d{2}:?\d{2})?$)/,
    '$1'
  );
  return Date.parse(normalized);
}

function normalizeCategoricalValue(value: unknown): string | null {
  value = semanticQValue(value);
  if (isMissing(value) || isNonFiniteScalar(value)) {
    return null;
  }
  let text = '';
  if (typeof value === 'string') {
    text = value.trim();
  } else if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'bigint') {
    text = String(value);
  } else if (value instanceof Date) {
    text = value.toISOString();
  }
  if (!text) {
    return null;
  }
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function normalizedChartXRange(request: LineChartRequest): ChartXRange | undefined {
  const hasMin = request.xMin !== undefined && request.xMin !== null;
  const hasMax = request.xMax !== undefined && request.xMax !== null;
  if (!hasMin && !hasMax) {
    return undefined;
  }
  const min = Number(request.xMin);
  const max = Number(request.xMax);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    throw new ChartDataError('Chart range needs valid minimum and maximum X values.');
  }
  return { min, max };
}

function chartXIndex(
  table: ColumnarPanelResult,
  columnIndex: number,
  kind: ChartColumnKind,
  sourceVersion: number,
  onBuiltEntry?: (rowIndex: number, x: NormalizedValue) => void
): ChartXIndex {
  const slot = chartXIndexCacheSlot(table, columnIndex, kind, sourceVersion);
  if (slot.cached) {
    return slot.cached;
  }

  let x: number[] = [];
  let xText: string[] = [];
  let rowIndexes: number[] = [];
  let droppedX = 0;
  let sourceWasUnsorted = false;
  let previousX = -Infinity;
  for (let rowIndex = 0; rowIndex < table.rowCount; rowIndex += 1) {
    const normalized = normalizeXValue(table.cellValue(rowIndex, columnIndex), kind);
    if (!normalized) {
      droppedX += 1;
      continue;
    }
    if (normalized.value < previousX) {
      sourceWasUnsorted = true;
    }
    previousX = normalized.value;
    x.push(normalized.value);
    xText.push(normalized.text);
    rowIndexes.push(rowIndex);
    onBuiltEntry?.(rowIndex, normalized);
  }
  if (sourceWasUnsorted) {
    const order = x.map((_value, index) => index)
      .sort((left, right) => x[left] - x[right] || rowIndexes[left] - rowIndexes[right]);
    x = order.map(index => x[index]);
    xText = order.map(index => xText[index]);
    rowIndexes = order.map(index => rowIndexes[index]);
  }
  const built = {
    columnIndex,
    kind,
    sourceVersion,
    rowCount: table.rowCount,
    x,
    xText,
    rowIndexes,
    droppedX,
    sourceWasUnsorted,
  };
  slot.cache.indexes.set(slot.key, built);
  return built;
}

function chartEligibilityKey(yColumnIndexes: readonly number[]): string {
  return yColumnIndexes.join(',');
}

function recordChartEligibility(
  index: ChartXIndex,
  key: string,
  start: number,
  end: number,
  points: readonly ChartPoint[]
): void {
  let eligibility = index.eligibility;
  if (!eligibility || eligibility.key !== key) {
    eligibility = { key, entryCount: 0, segments: [] };
    index.eligibility = eligibility;
  }
  if (eligibility.segments.some(segment => segment.start <= start && segment.end >= end)) {
    return;
  }
  const prefix = new Uint32Array(points.length + 1);
  for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
    prefix[pointIndex + 1] = prefix[pointIndex] + (chartPointHasFiniteY(points[pointIndex]) ? 1 : 0);
  }
  if (eligibility.segments.length >= 64 ||
    eligibility.entryCount + points.length > Math.max(index.x.length, 1) * 2) {
    eligibility.segments = [];
    eligibility.entryCount = 0;
  }
  eligibility.segments.push({ start, end, prefix });
  eligibility.entryCount += points.length;
}

function chartEligibilityCount(
  index: ChartXIndex,
  key: string,
  start: number,
  end: number
): number | undefined {
  const eligibility = index.eligibility;
  if (!eligibility || eligibility.key !== key) {
    return undefined;
  }
  let cursor = start;
  let count = 0;
  while (cursor < end) {
    let covering: ChartEligibilitySegment | undefined;
    for (const segment of eligibility.segments) {
      if (segment.start <= cursor && segment.end > cursor &&
        (!covering || segment.end > covering.end)) {
        covering = segment;
      }
    }
    if (!covering) {
      return undefined;
    }
    const coveredEnd = Math.min(end, covering.end);
    count += covering.prefix[coveredEnd - covering.start] -
      covering.prefix[cursor - covering.start];
    cursor = coveredEnd;
  }
  return count;
}

function chartXIndexCacheSlot(
  table: ColumnarPanelResult,
  columnIndex: number,
  kind: ChartColumnKind,
  sourceVersion: number
): ChartXIndexCacheSlot {
  const key = JSON.stringify([
    columnIndex,
    kind,
    table.rowCount,
    table.columns[columnIndex],
    table.columnTypes?.[columnIndex] || '',
  ]);
  let cache = chartXIndexes.get(table as unknown as object);
  if (!cache || cache.sourceVersion !== sourceVersion) {
    cache = { sourceVersion, indexes: new Map<string, ChartXIndex>() };
    chartXIndexes.set(table as unknown as object, cache);
  }
  return { cache, key, cached: cache.indexes.get(key) };
}

function chartXIndexBounds(
  index: ChartXIndex,
  range?: ChartXRange
): { start: number; end: number; rangeExcluded: number } {
  if (!range) {
    return { start: 0, end: index.x.length, rangeExcluded: 0 };
  }
  const start = lowerBoundChartX(index.x, range.min);
  const end = upperBoundChartX(index.x, range.max);
  return {
    start,
    end,
    rangeExcluded: index.x.length - (end - start),
  };
}

function lowerBoundChartX(values: readonly number[], value: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (values[middle] < value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function upperBoundChartX(values: readonly number[], value: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (values[middle] <= value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function isMissing(value: unknown): boolean {
  value = semanticQValue(value);
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function isNonFiniteScalar(value: unknown): boolean {
  value = semanticQValue(value);
  if (typeof value === 'number') {
    return !Number.isFinite(value);
  }
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    return text === 'nan' || text === 'inf' || text === '+inf' || text === '-inf' ||
      text === 'infinity' || text === '+infinity' || text === '-infinity';
  }
  return false;
}

function semanticQValue(value: unknown): unknown {
  return isQRuntimeValue(value) ? qValueToSemanticPrimitive(value) : value;
}

function hasAnyFiniteY(points: ChartPoint[]): boolean {
  for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
    const point = points[pointIndex];
    for (let seriesIndex = 0; seriesIndex < point.y.length; seriesIndex++) {
      if (Number.isFinite(point.y[seriesIndex])) {
        return true;
      }
    }
  }
  return false;
}

function chartPointHasFiniteY(point: ChartPoint): boolean {
  return point.y.some(value => Number.isFinite(value));
}

/**
 * Preserve real source discontinuities without spending sampled-point slots on
 * nonvisual all-null rows. The returned flags align with the finite sampled
 * points and mark a break immediately before a retained point.
 *
 * Grouped charts use gapFlags to distinguish a null in the retained group
 * (true) from a structural hole belonging to another group (false).
 */
function sourceGapBeforeSampledPoints(
  sourcePoints: ChartPoint[],
  sampledPoints: ChartPoint[],
  seriesIndex: number
): boolean[] {
  const result = sampledPoints.map(() => false);
  if (sampledPoints.length < 2 || sourcePoints.length < 3) {
    return result;
  }

  let sourceIndex = 0;
  let previousFinite: { x: number; row: number } | undefined;
  const before = (point: ChartPoint, endpoint: { x: number; row: number }): boolean =>
    point.x < endpoint.x || (point.x === endpoint.x && point.rowIndex < endpoint.row);
  for (let sampledIndex = 0; sampledIndex < sampledPoints.length; sampledIndex++) {
    const sampled = sampledPoints[sampledIndex];
    if (!Number.isFinite(sampled.y[seriesIndex])) continue;
    const current = { x: sampled.x, row: sampled.sourceRowIndexes?.[seriesIndex] ?? sampled.rowIndex };
    if (previousFinite) {
      while (sourceIndex < sourcePoints.length &&
        (before(sourcePoints[sourceIndex], previousFinite) ||
          (sourcePoints[sourceIndex].x === previousFinite.x &&
            sourcePoints[sourceIndex].rowIndex === previousFinite.row))) sourceIndex++;
      for (; sourceIndex < sourcePoints.length && before(sourcePoints[sourceIndex], current); sourceIndex++) {
        const point = sourcePoints[sourceIndex];
        const realGap = Array.isArray(point.gapFlags)
          ? point.gapFlags[seriesIndex] === true : point.y[seriesIndex] === null;
        if (realGap) { result[sampledIndex] = true; break; }
      }
    }
    previousFinite = current;
  }
  return result;
}

function temporalAutoInterval(points: readonly ChartPoint[], seriesCount: number): number {
  if (points.length < 2) {
    return 1;
  }
  const span = Math.max(1, points[points.length - 1].x - points[0].x);
  const picksPerBucket = Math.max(2, seriesCount * 2 + seriesCount);
  const bucketTarget = Math.max(1, Math.floor((CHART_ORDINARY_TARGET_POINTS - 2) / picksPerBucket));
  const raw = span / bucketTarget;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  const normalized = raw / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

function downsampleTemporalMinMax(
  points: ChartPoint[],
  seriesCount: number,
  intervalMs: number,
  preserveSourceGaps: boolean,
  maxPoints: number
): { points: ChartPoint[]; algorithm: string } {
  if (points.length <= maxPoints) {
    return { points, algorithm: 'none' };
  }
  const selected = new Uint8Array(points.length);
  selected[0] = 1;
  selected[points.length - 1] = 1;
  let start = 0;
  while (start < points.length) {
    const bucket = Math.floor(points[start].x / intervalMs);
    const bucketEnd = (bucket + 1) * intervalMs;
    let end = start + 1;
    if (intervalMs >= 1 && Number.isFinite(bucketEnd)) {
      while (end < points.length && points[end].x < bucketEnd) {
        end += 1;
      }
    } else {
      while (end < points.length && Math.floor(points[end].x / intervalMs) === bucket) {
        end += 1;
      }
    }
    for (let seriesIndex = 0; seriesIndex < seriesCount; seriesIndex += 1) {
      let minIndex = -1;
      let maxIndex = -1;
      let gapIndex = -1;
      let minValue = Infinity;
      let maxValue = -Infinity;
      for (let index = start; index < end; index += 1) {
        const value = points[index].y[seriesIndex];
        if (Number.isFinite(value)) {
          if ((value as number) < minValue) {
            minValue = value as number;
            minIndex = index;
          }
          if ((value as number) > maxValue) {
            maxValue = value as number;
            maxIndex = index;
          }
        } else if (preserveSourceGaps && gapIndex === -1) {
          gapIndex = index;
        }
      }
      if (minIndex >= 0) selected[minIndex] = 1;
      if (maxIndex >= 0) selected[maxIndex] = 1;
      if (gapIndex >= 0) selected[gapIndex] = 1;
    }
    start = end;
  }
  fillSelectedPointIndexes(selected, points.length, maxPoints);
  const temporalPoints = points.filter((_point, index) => selected[index]);
  if (temporalPoints.length > maxPoints) {
    const capped = downsampleMinMax(temporalPoints, seriesCount, maxPoints, preserveSourceGaps);
    return {
      points: capped.points,
      algorithm: `temporal-minmax/${intervalMs}ms@0+${capped.algorithm}`,
    };
  }
  return { points: temporalPoints, algorithm: `temporal-minmax/${intervalMs}ms@0` };
}

function downsampleMinMax(
  points: ChartPoint[],
  seriesCount: number,
  maxPoints: number,
  preserveSourceGaps: boolean
): { points: ChartPoint[]; algorithm: string } {
  if (points.length <= maxPoints) {
    return { points, algorithm: 'none' };
  }

  if (maxPoints < 4 || points.length <= 2) {
    return {
      points: [points[0], points[points.length - 1]],
      algorithm: `minmax-bucket/${maxPoints}`,
    };
  }

  const selected = new Uint8Array(points.length);
  selected[0] = 1;
  selected[points.length - 1] = 1;

  const gapSeries = new Array(seriesCount).fill(false);
  if (preserveSourceGaps) {
    points.forEach(point => {
      for (let seriesIndex = 0; seriesIndex < seriesCount; seriesIndex++) {
        const sourceGap = Array.isArray(point.gapFlags)
          ? point.gapFlags[seriesIndex] === true
          : point.y[seriesIndex] === null;
        gapSeries[seriesIndex] = gapSeries[seriesIndex] || sourceGap;
      }
    });
  }
  const gapSeriesCount = gapSeries.filter(Boolean).length;
  const pickSlotsPerBucket = Math.max(1, seriesCount * 2 + gapSeriesCount);
  const bucketCount = Math.max(1, Math.floor((maxPoints - 2) / pickSlotsPerBucket));
  const innerStart = 1;
  const innerEnd = points.length - 2;
  const innerCount = Math.max(0, innerEnd - innerStart + 1);
  const bucketSize = innerCount / bucketCount;

  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const start = Math.min(innerEnd, innerStart + Math.floor(bucket * bucketSize));
    const end = Math.min(innerEnd, innerStart + Math.floor((bucket + 1) * bucketSize) - 1);
    if (start > end) {
      continue;
    }
    let anySelected = false;
    for (let seriesIndex = 0; seriesIndex < seriesCount; seriesIndex++) {
      let minValue = Infinity;
      let maxValue = -Infinity;
      let minIndex = -1;
      let maxIndex = -1;
      let gapIndex = -1;
      for (let index = start; index <= end; index++) {
        const value = points[index].y[seriesIndex];
        if (!Number.isFinite(value)) {
          const isSourceGap = gapSeries[seriesIndex] && (Array.isArray(points[index].gapFlags)
            ? points[index].gapFlags![seriesIndex] === true
            : value === null);
          if (isSourceGap && gapIndex === -1) {
            gapIndex = index;
          }
          continue;
        }
        if ((value as number) < minValue) {
          minValue = value as number;
          minIndex = index;
        }
        if ((value as number) > maxValue) {
          maxValue = value as number;
          maxIndex = index;
        }
      }
      if (minIndex >= 0) {
        selected[minIndex] = 1;
        anySelected = true;
      }
      if (maxIndex >= 0) {
        selected[maxIndex] = 1;
        anySelected = true;
      }
      if (gapIndex >= 0) {
        selected[gapIndex] = 1;
        anySelected = true;
      }
    }
    if (!anySelected) {
      selected[start] = 1;
    }
  }

  fillSelectedPointIndexes(selected, points.length, maxPoints);
  const sampled = points.filter((_point, index) => selected[index]);
  return {
    points: sampled.length <= maxPoints ? sampled : evenlyThin(sampled, maxPoints),
    algorithm: `minmax-bucket/${maxPoints}`,
  };
}

function fillSelectedPointIndexes(
  selected: Uint8Array,
  pointCount: number,
  targetCount: number
): void {
  const boundedTarget = Math.max(0, Math.min(pointCount, Math.floor(targetCount)));
  let selectedCount = 0;
  for (let index = 0; index < pointCount; index++) {
    if (selected[index]) {
      selectedCount += 1;
    }
  }

  const needed = boundedTarget - selectedCount;
  const available = pointCount - selectedCount;
  if (needed <= 0 || available <= 0) {
    return;
  }

  let availableRank = 0;
  let targetRankIndex = 0;
  let nextTargetRank = needed === 1 ? Math.floor((available - 1) / 2) : 0;
  for (let index = 0; index < pointCount && targetRankIndex < needed; index++) {
    if (selected[index]) {
      continue;
    }
    if (availableRank === nextTargetRank) {
      selected[index] = 1;
      targetRankIndex += 1;
      nextTargetRank = targetRankIndex < needed
        ? Math.round(targetRankIndex * (available - 1) / (needed - 1))
        : -1;
    }
    availableRank += 1;
  }
}

function evenlyThin<T>(points: T[], maxPoints: number): T[] {
  if (points.length <= maxPoints) {
    return points;
  }
  const result: T[] = [];
  const last = points.length - 1;
  for (let index = 0; index < maxPoints; index++) {
    result.push(points[Math.round(index * last / (maxPoints - 1))]);
  }
  return result;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
