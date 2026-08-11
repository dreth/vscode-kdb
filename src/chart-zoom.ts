export interface ChartRange {
  readonly min: number;
  readonly max: number;
}

export interface ChartYExtent {
  readonly min: number;
  readonly max: number;
}

export interface ChartYExtentSeries {
  readonly visible: boolean;
  readonly extents: readonly (ChartYExtent | null | undefined)[];
}

export interface ChartVisibleIndexBounds {
  readonly start: number;
  readonly end: number;
}

/** Normalize uPlot's current X-series index window without consulting its stale committed scale. */
export function chartVisibleIndexBounds(
  indexes: readonly number[] | null | undefined,
  length: number
): ChartVisibleIndexBounds | undefined {
  const count = Math.max(0, Math.floor(length));
  if (count === 0 || !indexes || indexes.length < 2) {
    return undefined;
  }
  const start = Math.max(0, Math.min(count - 1, Math.floor(indexes[0])));
  const end = Math.max(0, Math.min(count - 1, Math.floor(indexes[1])));
  return Number.isFinite(indexes[0]) && Number.isFinite(indexes[1]) && end >= start
    ? { start, end }
    : undefined;
}

/** Pad discrete glyph families only during initial auto-scale, never an explicit viewport. */
export function chartXRangeWithInitialPadding(
  min: number,
  max: number,
  domain: ChartRange | null | undefined,
  step: number,
  initialAutoScale: boolean
): ChartRange {
  if (!initialAutoScale) {
    return { min, max };
  }
  const low = isValidChartRange(domain) ? Math.min(min, domain.min) : min;
  const high = isValidChartRange(domain) ? Math.max(max, domain.max) : max;
  const padding = Number.isFinite(step) && step > 0 ? step * 0.55 : 0.55;
  return { min: low - padding, max: high + padding };
}

/** Compute Y auto-scale only from visible-X points in visible series. */
export function chartYRangeForVisibleX(
  xValues: readonly number[],
  series: readonly ChartYExtentSeries[],
  xRange: ChartRange | null | undefined,
  includeZero = false
): ChartRange | undefined {
  const xMin = xRange && Number.isFinite(xRange.min) ? xRange.min : -Infinity;
  const xMax = xRange && Number.isFinite(xRange.max) ? xRange.max : Infinity;
  let min = Infinity;
  let max = -Infinity;
  for (const candidate of series) {
    if (!candidate.visible) {
      continue;
    }
    for (let index = 0; index < candidate.extents.length; index += 1) {
      const x = xValues[index];
      const extent = candidate.extents[index];
      if (!Number.isFinite(x) || x < xMin || x > xMax || !extent ||
        !Number.isFinite(extent.min) || !Number.isFinite(extent.max)) {
        continue;
      }
      min = Math.min(min, extent.min, extent.max);
      max = Math.max(max, extent.min, extent.max);
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return undefined;
  }
  return {
    min: includeZero ? Math.min(0, min) : min,
    max: includeZero ? Math.max(0, max) : max,
  };
}

export type ChartViewportQueueAction =
  | { type: 'schedule'; range: ChartRange }
  | { type: 'duplicate' }
  | { type: 'flush'; ranges: ChartRange[] };

export interface ChartViewportIntentTransition {
  readonly duplicate: boolean;
  readonly invalidatesRequestedRange: boolean;
  readonly invalidatesLastRequestedKey: boolean;
}

/** Yield once, then skip a chart build whose owning request became stale. */
export async function runCurrentChartBuild<T>(
  yieldControl: () => Promise<void>,
  isCurrent: () => boolean,
  build: () => T | Promise<T>
): Promise<T | undefined> {
  await yieldControl();
  if (!isCurrent()) {
    return undefined;
  }
  return build();
}

/**
 * Classify a completed viewport before mutating an in-flight/scheduled request.
 * An exact duplicate must preserve its request identity; a distinct intent must
 * invalidate an in-flight range so returning to it is not incorrectly deduped.
 */
export function chartViewportIntentTransition(
  next: ChartRange,
  requested: ChartRange | null | undefined,
  scheduled: ChartRange | null | undefined,
  lastRequestedKey = ''
): ChartViewportIntentTransition {
  const key = chartZoomRangeKey(next);
  const requestedMatches = isValidChartRange(requested) && chartZoomRangeKey(requested) === key;
  const scheduledMatches = isValidChartRange(scheduled) && chartZoomRangeKey(scheduled) === key;
  return {
    duplicate: requestedMatches || scheduledMatches,
    invalidatesRequestedRange: isValidChartRange(requested) && !requestedMatches,
    invalidatesLastRequestedKey: !!lastRequestedKey && lastRequestedKey !== key,
  };
}

export interface ChartZoomLifecycleState<T> {
  activeRequestId: number;
  pendingRequestId: number | null;
  requestedRange: ChartRange | null;
  fullRange: ChartRange | null;
  fullData: T | null;
}

export type ChartZoomLifecycleAction<T> =
  | { type: 'clear'; requestId: number }
  | { type: 'request'; requestId: number; range: ChartRange | null }
  | { type: 'response'; requestId: number; data: T }
  | { type: 'failed'; requestId: number }
  | { type: 'rendered'; requestId: number; naturalRange: ChartRange | null }
  | { type: 'reset' };

export interface ChartZoomDataState<T> {
  readonly data: T;
  readonly originalData: T | null;
  readonly dataIsRefinement: boolean;
}

export interface ChartZoomLocalViewportSettlement<T> {
  readonly lifecycle: ChartZoomLifecycleState<T>;
  readonly invalidatedPendingRequest: boolean;
}

export interface ChartViewportResamplingInput {
  readonly dataIsRefinement: boolean;
  readonly canResample: boolean;
  readonly eligiblePointCount: number;
  readonly visibleSamplePointCount: number;
  readonly sampledPointCount: number;
  readonly minSampledPoints: number;
}

export function chartAlgorithmSupportsSourceResampling(algorithm: string | null | undefined): boolean {
  return typeof algorithm === 'string' && (
    algorithm.startsWith('minmax-bucket/') ||
    algorithm.startsWith('bar-cluster-even/') ||
    algorithm.startsWith('box-bucket/') ||
    algorithm.startsWith('ohlc-bucket/')
  );
}

export function chartViewportNeedsSourceResampling(input: ChartViewportResamplingInput): boolean {
  if (input.dataIsRefinement) {
    return true;
  }
  if (!input.canResample) {
    return false;
  }
  const visible = Math.max(0, Math.floor(input.visibleSamplePointCount));
  const eligible = Math.max(0, Math.floor(input.eligiblePointCount));
  if (eligible <= visible) {
    return false;
  }
  const sampled = Math.max(1, Math.floor(input.sampledPointCount));
  const configuredMinimum = Math.max(1, Math.floor(input.minSampledPoints));
  return visible < Math.min(configuredMinimum, sampled);
}

export function chartZoomDataAfterResponse<T>(
  currentOriginalData: T | null | undefined,
  renderedData: T,
  requestIsRefinement: boolean
): ChartZoomDataState<T> {
  return {
    data: renderedData,
    originalData: requestIsRefinement ? (currentOriginalData || null) : renderedData,
    dataIsRefinement: requestIsRefinement,
  };
}

export function captureChartFullXRange(
  current: ChartRange | null | undefined,
  rendered: ChartRange | null | undefined,
  preserveCurrent: boolean
): ChartRange | null {
  if (preserveCurrent && isValidChartRange(current)) {
    return Object.isFrozen(current)
      ? current
      : Object.freeze({ min: current.min, max: current.max });
  }
  if (!isValidChartRange(rendered)) {
    return null;
  }
  return Object.freeze({ min: rendered.min, max: rendered.max });
}

export function chartRangeIsZoomed(
  full: ChartRange | null | undefined,
  current: ChartRange | null | undefined
): boolean {
  if (!isValidChartRange(full) || !isValidChartRange(current)) {
    return false;
  }

  const spanTolerance = Math.abs(full.max - full.min) * 1e-9;
  const magnitudeTolerance = Math.max(Math.abs(full.min), Math.abs(full.max)) * Number.EPSILON * 16;
  const tolerance = Math.max(Number.MIN_VALUE, spanTolerance, magnitudeTolerance);
  return Math.abs(current.min - full.min) > tolerance || Math.abs(current.max - full.max) > tolerance;
}

export function chartDataForViewport<T>(options: {
  fullData: T | undefined;
  fullRange: ChartRange | null | undefined;
  viewportRange: ChartRange | null | undefined;
  rebuild: (range: ChartRange | undefined) => T | undefined;
}): T | undefined {
  const range = clampChartViewport(options.viewportRange, options.fullRange);
  const ranged = chartRangeIsZoomed(options.fullRange, range);
  if (!ranged && options.fullData !== undefined) {
    return options.fullData;
  }
  return options.rebuild(ranged && range ? range : undefined);
}

export function isValidChartRange(value: ChartRange | null | undefined): value is ChartRange {
  return !!value &&
    Number.isFinite(value.min) &&
    Number.isFinite(value.max) &&
    value.max > value.min;
}

/**
 * Tracks the immutable full response and the exact absolute viewport being
 * reconstructed. The reducer is deliberately browser-free so both panels and
 * notebook charts can share its stale-response/reset rules.
 */
export function reduceChartZoomLifecycle<T>(
  state: ChartZoomLifecycleState<T> | null | undefined,
  action: ChartZoomLifecycleAction<T>
): ChartZoomLifecycleState<T> {
  const current = state || {
    activeRequestId: -1,
    pendingRequestId: null,
    requestedRange: null,
    fullRange: null,
    fullData: null,
  };

  if (action.type === 'clear') {
    return {
      activeRequestId: action.requestId,
      pendingRequestId: null,
      requestedRange: null,
      fullRange: null,
      fullData: null,
    };
  }

  if (action.type === 'request') {
    const range = isValidChartRange(action.range)
      ? { min: action.range.min, max: action.range.max }
      : null;
    return range
      ? {
        activeRequestId: action.requestId,
        pendingRequestId: action.requestId,
        requestedRange: range,
        fullRange: current.fullRange,
        fullData: current.fullData,
      }
      : {
        activeRequestId: action.requestId,
        pendingRequestId: action.requestId,
        requestedRange: null,
        fullRange: null,
        fullData: null,
      };
  }

  if (action.type === 'response') {
    if (action.requestId !== current.activeRequestId ||
      action.requestId !== current.pendingRequestId) {
      return current;
    }
    return current.requestedRange
      ? { ...current, pendingRequestId: null }
      : {
        activeRequestId: current.activeRequestId,
        pendingRequestId: null,
        requestedRange: null,
        fullRange: current.fullRange,
        fullData: action.data,
      };
  }

  if (action.type === 'failed') {
    if (action.requestId !== current.activeRequestId ||
      action.requestId !== current.pendingRequestId) {
      return current;
    }
    return {
      activeRequestId: current.activeRequestId,
      pendingRequestId: null,
      requestedRange: null,
      fullRange: current.fullRange,
      fullData: current.fullData,
    };
  }

  if (action.type === 'rendered') {
    if (action.requestId !== current.activeRequestId || current.requestedRange) {
      return current;
    }
    const range = isValidChartRange(action.naturalRange)
      ? { min: action.naturalRange.min, max: action.naturalRange.max }
      : null;
    return {
      activeRequestId: current.activeRequestId,
      pendingRequestId: current.pendingRequestId,
      requestedRange: null,
      fullRange: range,
      fullData: current.fullData,
    };
  }

  return {
    activeRequestId: current.activeRequestId,
    pendingRequestId: null,
    requestedRange: null,
    fullRange: current.fullRange,
    fullData: current.fullData,
  };
}

/** Reject a pending source rebuild when the newer viewport is fully local. */
export function chartZoomLifecycleAfterLocalViewport<T>(
  state: ChartZoomLifecycleState<T>
): ChartZoomLocalViewportSettlement<T> {
  if (state.pendingRequestId === null) {
    return { lifecycle: state, invalidatedPendingRequest: false };
  }
  return {
    lifecycle: reduceChartZoomLifecycle(state, { type: 'reset' }),
    invalidatedPendingRequest: true,
  };
}

export function chartZoomRangeKey(range: ChartRange): string {
  return `${Number(range.min)}:${Number(range.max)}`;
}

export function chartZoomAutoRefineQueueAction(
  scheduledRange: ChartRange | null | undefined,
  nextRange: ChartRange
): ChartViewportQueueAction {
  const next = { min: nextRange.min, max: nextRange.max };
  if (!scheduledRange) {
    return { type: 'schedule', range: next };
  }
  if (chartZoomRangeKey(scheduledRange) === chartZoomRangeKey(next)) {
    return { type: 'duplicate' };
  }
  return {
    type: 'flush',
    ranges: [
      { min: scheduledRange.min, max: scheduledRange.max },
      next,
    ],
  };
}

export function chartZoomRequestedRenderRange<T>(
  state: ChartZoomLifecycleState<T> | null | undefined
): ChartRange | null {
  const range = state?.requestedRange;
  return isValidChartRange(range) ? { min: range.min, max: range.max } : null;
}

export function chartZoomRangeMatchesRequest<T>(
  state: ChartZoomLifecycleState<T> | null | undefined,
  range: ChartRange | null | undefined
): boolean {
  return isValidChartRange(state?.requestedRange) && isValidChartRange(range) &&
    chartZoomRangeKey(state!.requestedRange!) === chartZoomRangeKey(range);
}

export function chartZoomResponseIsPending<T>(
  state: ChartZoomLifecycleState<T> | null | undefined,
  requestId: number
): boolean {
  return !!state && Number.isFinite(requestId) &&
    state.activeRequestId === requestId && state.pendingRequestId === requestId;
}

export function chartZoomShouldRequestRange<T>(
  state: ChartZoomLifecycleState<T> | null | undefined,
  range: ChartRange | null | undefined,
  lastRequestedKey = ''
): boolean {
  if (!isValidChartRange(range)) {
    return false;
  }
  const key = chartZoomRangeKey(range);
  return key !== lastRequestedKey && !chartZoomRangeMatchesRequest(state, range);
}

/** Clamp a viewport while preserving its span whenever the full domain allows it. */
export function clampChartViewport(
  range: ChartRange | null | undefined,
  fullRange: ChartRange | null | undefined
): ChartRange | null {
  if (!isValidChartRange(range) || !isValidChartRange(fullRange)) {
    return null;
  }
  const fullSpan = fullRange.max - fullRange.min;
  const requestedSpan = range.max - range.min;
  if (requestedSpan >= fullSpan) {
    return { min: fullRange.min, max: fullRange.max };
  }
  let min = range.min;
  let max = range.max;
  if (min < fullRange.min) {
    min = fullRange.min;
    max = min + requestedSpan;
  }
  if (max > fullRange.max) {
    max = fullRange.max;
    min = max - requestedSpan;
  }
  return { min, max };
}

/**
 * Shift an absolute viewport by a fraction of its own span. Negative values pan
 * left; positive values pan right. The returned range never changes Y state.
 */
export function panChartViewport(
  currentRange: ChartRange | null | undefined,
  fullRange: ChartRange | null | undefined,
  spanFraction: number
): ChartRange | null {
  if (!isValidChartRange(currentRange) || !isValidChartRange(fullRange) ||
    !Number.isFinite(spanFraction)) {
    return null;
  }
  const span = currentRange.max - currentRange.min;
  const delta = span * spanFraction;
  return clampChartViewport({
    min: currentRange.min + delta,
    max: currentRange.max + delta,
  }, fullRange);
}

/** Dragging content right moves the viewed domain left (grab-content motion). */
export function panChartViewportByPixels(
  currentRange: ChartRange | null | undefined,
  fullRange: ChartRange | null | undefined,
  deltaPixels: number,
  plotWidth: number
): ChartRange | null {
  if (!Number.isFinite(deltaPixels) || !Number.isFinite(plotWidth) || plotWidth <= 0) {
    return null;
  }
  return panChartViewport(currentRange, fullRange, -deltaPixels / plotWidth);
}
