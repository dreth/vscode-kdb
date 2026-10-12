/** Display-only policies: never apply these to persisted or exported values. */
export function tableDecimalPlaces(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= -1 && value <= 12 ? value : -1;
}

export function scientificNotationThreshold(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1_000_000;
}

export function formatNumericAxis(value: number, precision: number, threshold: number): string {
  if (!Number.isFinite(value)) { return ''; }
  const normalized = Object.is(value, -0) ? 0 : value;
  const places = Number.isInteger(precision) ? Math.max(0, Math.min(12, precision)) : 4;
  const abs = Math.abs(normalized);
  return abs !== 0 && (abs >= scientificNotationThreshold(threshold) || abs < 0.001)
    ? normalized.toExponential(places)
    : normalized.toLocaleString(undefined, { minimumFractionDigits: places, maximumFractionDigits: places });
}
