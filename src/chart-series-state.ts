export function updateHiddenChartSeriesKeys(
  previousHiddenKeys: readonly string[] | null | undefined,
  renderedKeys: readonly string[] | null | undefined,
  hiddenRenderedKeys: readonly string[] | null | undefined
): string[] {
  const hidden = new Set<string>();
  for (const key of previousHiddenKeys || []) {
    if (typeof key === 'string' && key) {
      hidden.add(key);
    }
  }
  for (const key of renderedKeys || []) {
    if (typeof key === 'string' && key) {
      hidden.delete(key);
    }
  }
  for (const key of hiddenRenderedKeys || []) {
    if (typeof key === 'string' && key) {
      hidden.add(key);
    }
  }
  return [...hidden];
}

export function chartSeriesVisible(
  hiddenKeys: readonly string[] | null | undefined,
  key: string
): boolean {
  return !(hiddenKeys || []).includes(key);
}

export function chartLegendToggleKey(key: string): boolean {
  return key === 'Enter' || key === ' ' || key === 'Spacebar';
}
