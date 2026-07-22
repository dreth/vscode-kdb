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

export function isValidChartRange(value: ChartRange | null | undefined): value is ChartRange {
  return !!value &&
    Number.isFinite(value.min) &&
    Number.isFinite(value.max) &&
    value.max > value.min;
}
