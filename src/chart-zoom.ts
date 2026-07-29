export interface ChartRange {
  readonly min: number;
  readonly max: number;
}

export interface ChartZoomDataState<T> {
  readonly data: T;
  readonly originalData: T | null;
  readonly dataIsRefinement: boolean;
}

export interface ChartZoomResetPlan<T> {
  readonly data: T | null;
  readonly dataIsRefinement: boolean;
  readonly requestIsRefinement: false;
  readonly restoredOriginalData: boolean;
  readonly xScale: ChartRange | null;
  readonly yScale: { readonly min: null; readonly max: null } | null;
  readonly autoRefineKey: '';
  readonly clearAutoRefineTimer: true;
  readonly clearSelection: true;
  readonly hideTooltip: true;
}

export interface ChartAutoRefinePlan {
  readonly range: ChartRange;
  readonly key: string;
}

export interface ChartZoomLifecycleState<T> {
  readonly activeRequestId: number;
  readonly requestedRange: ChartRange | null;
  readonly settledRange: ChartRange | null;
  readonly requestedRenderRange: ChartRange | null;
  readonly fullRange: ChartRange | null;
  readonly fullData: T | null;
  readonly data: T | null;
  readonly dataIsRefinement: boolean;
}

export type ChartZoomLifecycleAction<T> =
  | { readonly type: 'clear'; readonly requestId: number }
  | { readonly type: 'request'; readonly requestId: number; readonly range: ChartRange | null | undefined }
  | { readonly type: 'response'; readonly requestId: number; readonly data: T }
  | { readonly type: 'cancel'; readonly requestId: number }
  | { readonly type: 'rendered'; readonly requestId: number; readonly naturalRange: ChartRange | null | undefined }
  | { readonly type: 'reset'; readonly requestId: number };

export interface ChartZoomIssuedRequest {
  readonly requestId: number;
  readonly range: ChartRange | null;
}

export interface ChartZoomAppliedData<T> {
  readonly state: ChartZoomLifecycleState<T>;
  readonly data: T;
  readonly requestedRenderRange: ChartRange | null;
}

export interface ChartZoomAppliedFailure<T> {
  readonly state: ChartZoomLifecycleState<T>;
  readonly requestWasRefinement: boolean;
}

/**
 * Keeps the original sample/domain separate from the exact absolute viewport
 * requested for a refinement. This is intentionally self-contained so the
 * reducer can also be embedded in the results webview.
 */
export function reduceChartZoomLifecycle<T>(
  state: ChartZoomLifecycleState<T> | null | undefined,
  action: ChartZoomLifecycleAction<T>
): ChartZoomLifecycleState<T> {
  const current = state || {
    activeRequestId: -1,
    requestedRange: null,
    settledRange: null,
    requestedRenderRange: null,
    fullRange: null,
    fullData: null,
    data: null,
    dataIsRefinement: false,
  };

  if (action.type === 'clear') {
    return {
      activeRequestId: action.requestId,
      requestedRange: null,
      settledRange: null,
      requestedRenderRange: null,
      fullRange: null,
      fullData: null,
      data: null,
      dataIsRefinement: false,
    };
  }

  if (action.type === 'request') {
    const range = action.range &&
      Number.isFinite(action.range.min) &&
      Number.isFinite(action.range.max) &&
      action.range.max > action.range.min
      ? Object.freeze({ min: action.range.min, max: action.range.max })
      : null;
    return range
      ? {
        activeRequestId: action.requestId,
        requestedRange: range,
        settledRange: current.settledRange,
        requestedRenderRange: null,
        fullRange: current.fullRange,
        fullData: current.fullData,
        data: current.data,
        dataIsRefinement: current.dataIsRefinement,
      }
      : {
        activeRequestId: action.requestId,
        requestedRange: null,
        settledRange: null,
        requestedRenderRange: null,
        fullRange: null,
        fullData: null,
        data: null,
        dataIsRefinement: false,
      };
  }

  if (action.type === 'response') {
    if (action.requestId !== current.activeRequestId) {
      return current;
    }
    return current.requestedRange
      ? {
        activeRequestId: current.activeRequestId,
        requestedRange: current.requestedRange,
        settledRange: current.requestedRange,
        requestedRenderRange: current.requestedRange,
        fullRange: current.fullRange,
        fullData: current.fullData,
        data: action.data,
        dataIsRefinement: true,
      }
      : {
        activeRequestId: current.activeRequestId,
        requestedRange: null,
        settledRange: null,
        requestedRenderRange: null,
        fullRange: current.fullRange,
        fullData: action.data,
        data: action.data,
        dataIsRefinement: false,
      };
  }

  if (action.type === 'cancel') {
    if (action.requestId !== current.activeRequestId) {
      return current;
    }
    return {
      activeRequestId: current.activeRequestId,
      requestedRange: current.settledRange,
      settledRange: current.settledRange,
      requestedRenderRange: null,
      fullRange: current.fullRange,
      fullData: current.fullData,
      data: current.data,
      dataIsRefinement: current.settledRange !== null,
    };
  }

  if (action.type === 'rendered') {
    if (action.requestId !== current.activeRequestId) {
      return current;
    }
    if (current.requestedRange) {
      return {
        activeRequestId: current.activeRequestId,
        requestedRange: current.requestedRange,
        settledRange: current.settledRange,
        requestedRenderRange: null,
        fullRange: current.fullRange,
        fullData: current.fullData,
        data: current.data,
        dataIsRefinement: current.dataIsRefinement,
      };
    }
    const range = action.naturalRange &&
      Number.isFinite(action.naturalRange.min) &&
      Number.isFinite(action.naturalRange.max) &&
      action.naturalRange.max > action.naturalRange.min
      ? Object.freeze({ min: action.naturalRange.min, max: action.naturalRange.max })
      : null;
    return {
      activeRequestId: current.activeRequestId,
      requestedRange: null,
      settledRange: null,
      requestedRenderRange: null,
      fullRange: range,
      fullData: current.fullData,
      data: current.data,
      dataIsRefinement: current.dataIsRefinement,
    };
  }

  const restoredData = current.fullData &&
    typeof current.fullData === 'object' &&
    Object.prototype.hasOwnProperty.call(current.fullData, 'requestId')
    ? Object.assign({}, current.fullData, { requestId: action.requestId }) as T
    : current.fullData;
  return {
    activeRequestId: action.requestId,
    requestedRange: null,
    settledRange: null,
    requestedRenderRange: current.fullRange,
    fullRange: current.fullRange,
    fullData: current.fullData,
    data: restoredData,
    dataIsRefinement: false,
  };
}

/**
 * Production request boundary shared by panel and notebook clients. The
 * callback is invoked exactly once with the reducer-normalized absolute range.
 */
export function issueChartZoomLifecycleRequest<T>(
  state: ChartZoomLifecycleState<T> | null | undefined,
  requestId: number,
  range: ChartRange | null | undefined,
  issue: (request: ChartZoomIssuedRequest) => void
): ChartZoomLifecycleState<T> {
  const next = reduceChartZoomLifecycle(state, {
    type: 'request',
    requestId,
    range,
  });
  issue({
    requestId,
    range: next.requestedRange
      ? { min: next.requestedRange.min, max: next.requestedRange.max }
      : null,
  });
  return next;
}

/**
 * Production response boundary shared by panel and notebook clients. Stale
 * responses retain object identity and never invoke the reconstruction hook.
 */
export function applyChartZoomLifecycleResponse<T>(
  state: ChartZoomLifecycleState<T> | null | undefined,
  requestId: number,
  data: T,
  apply: (accepted: ChartZoomAppliedData<T>) => void
): ChartZoomLifecycleState<T> {
  const next = reduceChartZoomLifecycle(state, {
    type: 'response',
    requestId,
    data,
  });
  if (next === state || next.data === null || next.data === undefined) {
    return next;
  }
  apply({
    state: next,
    data: next.data,
    requestedRenderRange: chartZoomRequestedRenderRange(next),
  });
  return next;
}

/**
 * Production failure boundary shared by panel and notebook clients. A stale
 * failure retains object identity and never invokes the failure hook, including
 * after Reset has advanced the active request id.
 */
export function applyChartZoomLifecycleFailure<T>(
  state: ChartZoomLifecycleState<T> | null | undefined,
  requestId: number,
  apply: (accepted: ChartZoomAppliedFailure<T>) => void
): ChartZoomLifecycleState<T> {
  if (!state || requestId !== state.activeRequestId) {
    return state || reduceChartZoomLifecycle<T>(state, {
      type: 'cancel',
      requestId,
    });
  }
  const requestWasRefinement = state.requestedRange !== null;
  const next = reduceChartZoomLifecycle(state, {
    type: 'cancel',
    requestId,
  });
  apply({
    state: next,
    requestWasRefinement,
  });
  return next;
}

/**
 * Restores the immutable baseline locally. An optional invalidation callback
 * may notify a host, but this helper never issues another data request.
 */
export function resetChartZoomLifecycle<T>(
  state: ChartZoomLifecycleState<T> | null | undefined,
  requestId: number,
  apply: (restored: ChartZoomAppliedData<T>) => void,
  invalidate?: (requestId: number) => void
): ChartZoomLifecycleState<T> {
  const next = reduceChartZoomLifecycle(state, {
    type: 'reset',
    requestId,
  });
  invalidate?.(requestId);
  if (next.data !== null && next.data !== undefined) {
    apply({
      state: next,
      data: next.data,
      requestedRenderRange: chartZoomRequestedRenderRange(next),
    });
  }
  return next;
}

export function chartZoomRequestedRenderRange<T>(
  state: ChartZoomLifecycleState<T> | null | undefined
): ChartRange | null {
  const range = state && state.requestedRenderRange;
  if (!range ||
    !Number.isFinite(range.min) ||
    !Number.isFinite(range.max) ||
    range.max <= range.min) {
    return null;
  }
  return { min: range.min, max: range.max };
}

export function chartZoomRangeMatchesRequest<T>(
  state: ChartZoomLifecycleState<T> | null | undefined,
  range: ChartRange | null | undefined
): boolean {
  const requested = state && state.requestedRange;
  if (!requested || !range ||
    !Number.isFinite(requested.min) ||
    !Number.isFinite(requested.max) ||
    !Number.isFinite(range.min) ||
    !Number.isFinite(range.max) ||
    requested.max <= requested.min ||
    range.max <= range.min) {
    return false;
  }
  return chartZoomRangeKey(requested) === chartZoomRangeKey(range);
}

export function chartZoomCanReset<T>(
  state: ChartZoomLifecycleState<T> | null | undefined,
  chartZoomed: boolean
): boolean {
  return !!state &&
    isValidChartRange(state.fullRange) &&
    state.fullData !== null &&
    state.fullData !== undefined &&
    (chartZoomed || isValidChartRange(state.requestedRange));
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

export function planChartZoomReset<T extends { readonly requestId: number }>(
  displayedData: T | null | undefined,
  originalData: T | null | undefined,
  dataIsRefinement: boolean,
  fullXRange: ChartRange | null | undefined,
  latestRequestId: number
): ChartZoomResetPlan<T> {
  const xScale = isValidChartRange(fullXRange)
    ? { min: fullXRange.min, max: fullXRange.max }
    : null;
  const restoredOriginalData = !!(dataIsRefinement && originalData && xScale);
  const data = restoredOriginalData
    ? { ...originalData, requestId: latestRequestId } as T
    : (displayedData || null);
  return {
    data,
    dataIsRefinement: restoredOriginalData ? false : dataIsRefinement,
    requestIsRefinement: false,
    restoredOriginalData,
    xScale,
    yScale: xScale ? { min: null, max: null } : null,
    autoRefineKey: '',
    clearAutoRefineTimer: true,
    clearSelection: true,
    hideTooltip: true,
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
  const tolerance = Math.max(1e-9, spanTolerance, magnitudeTolerance);
  return Math.abs(current.min - full.min) > tolerance || Math.abs(current.max - full.max) > tolerance;
}

export function planChartAutoRefine(
  full: ChartRange | null | undefined,
  current: ChartRange | null | undefined,
  lastRangeKey: string,
  blocked = false
): ChartAutoRefinePlan | null {
  if (blocked || !isValidChartRange(full) || !isValidChartRange(current)) {
    return null;
  }
  const range = {
    min: Math.max(full.min, current.min),
    max: Math.min(full.max, current.max),
  };
  if (!isValidChartRange(range) || !chartRangeIsZoomed(full, range)) {
    return null;
  }
  const key = chartZoomRangeKey(range);
  return key === lastRangeKey ? null : { range, key };
}

export function chartZoomRangeKey(range: ChartRange): string {
  // Number#toString uses the shortest round-trip-safe representation, so two
  // distinct finite IEEE-754 endpoints cannot collapse merely because the
  // axis has an epoch-sized offset. Normalize signed zero for stable dedupe.
  const min = Object.is(Number(range.min), -0) ? 0 : Number(range.min);
  const max = Object.is(Number(range.max), -0) ? 0 : Number(range.max);
  return `${min}:${max}`;
}

export function chartRequestIsCurrent(
  currentRequestId: number,
  responseRequestId: number
): boolean {
  return responseRequestId === currentRequestId;
}

export function isValidChartRange(value: ChartRange | null | undefined): value is ChartRange {
  return !!value &&
    Number.isFinite(value.min) &&
    Number.isFinite(value.max) &&
    value.max > value.min;
}
