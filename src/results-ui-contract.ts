import type { ArrayDisplayFormat, ExportFormat } from './kx-results';
import type { ChartType } from './charting';
import type {
  KxColumnAutoFitMode,
  PositionalColumnWidths,
} from './column-sizing';

export type KxResultDensity = 'compact' | 'standard' | 'comfortable';
export type KxResultElapsedTimeDisplay = 'auto' | 'milliseconds';
export type KxQResultDisplayStrategy = 'grid' | 'qText';

export interface SharedKxResultSettings {
  cellWidth: number;
  columnWidths: PositionalColumnWidths;
  autoFitColumns: boolean;
  autoFitMode: KxColumnAutoFitMode;
  rowHeight: number;
  fontSize: number;
  density: KxResultDensity;
  showRowIndex: boolean;
  includeHeaders: boolean;
  includeRowIndex: boolean;
  copyExportConfirmCellThreshold: number;
  elapsedTimeDisplay: KxResultElapsedTimeDisplay;
  chartDecimalPlaces: number;
  chartMaxSourceRows: number;
  chartZoomMinSampledPoints: number;
  chartZoomMaxSampledPoints: number;
  qTextSyntaxHighlighting: boolean;
  qTextDisplayFormatting: boolean;
  arrayDisplayFormat: ArrayDisplayFormat;
  functionDisplayStrategy: KxQResultDisplayStrategy;
  dictionaryDisplayStrategy: KxQResultDisplayStrategy;
  listDisplayStrategy: KxQResultDisplayStrategy;
  objectDisplayStrategy: KxQResultDisplayStrategy;
}

export type SharedKxResultSettingKey = keyof SharedKxResultSettings;

export interface KxResultExportFormatDefinition {
  value: ExportFormat;
  label: string;
  extension: string;
  copy: boolean;
}

export const KX_RESULT_EXPORT_FORMATS: readonly KxResultExportFormatDefinition[] = [
  { value: 'csv', label: 'CSV', extension: 'csv', copy: true },
  { value: 'xlsx', label: 'XLSX', extension: 'xlsx', copy: false },
  { value: 'tsv', label: 'TSV', extension: 'tsv', copy: true },
  { value: 'json', label: 'JSON', extension: 'json', copy: true },
  { value: 'ndjson', label: 'NDJSON', extension: 'ndjson', copy: true },
  { value: 'html', label: 'HTML', extension: 'html', copy: true },
  { value: 'markdown', label: 'Markdown', extension: 'md', copy: true },
] as const;

export interface KxResultOptionDefinition<Value extends string = string> {
  value: Value;
  label: string;
}

export const KX_RESULT_CHART_TYPE_OPTIONS:
readonly KxResultOptionDefinition<ChartType>[] = [
  { value: 'line', label: 'Line' },
  { value: 'scatter', label: 'Scatter' },
  { value: 'step', label: 'Step' },
  { value: 'bar', label: 'Bar' },
  { value: 'box', label: 'Box' },
  { value: 'candlestick', label: 'Candlestick' },
] as const;

export const KX_RESULT_CHART_TYPES: readonly ChartType[] =
  KX_RESULT_CHART_TYPE_OPTIONS.map(option => option.value);

export const KX_RESULT_UI_LABELS = {
  title: 'KX Results',
  output: 'Output:',
  format: 'Copy/export format',
  headers: 'Headers',
  rowIndex: 'Row #',
  copy: 'Copy',
  export: 'Export',
  chart: 'Chart',
  settings: 'Settings',
  columns: 'Columns',
  search: 'Search',
  searchRows: 'Search rows',
  previousMatch: 'Prev',
  nextMatch: 'Next',
  renderChart: 'Render',
  exportChartPng: 'Export PNG',
  resetZoom: 'Reset zoom',
  refineZoom: 'Refine zoom',
  closeChart: 'Close',
  openFullResult: 'Open in KX Results',
  openSavedPreview: 'Open saved preview',
  rerunCell: 'Rerun cell',
  runSavedQResultLive: 'Run %%q live with KX',
  selectAllColumns: 'Select all',
  deselectAllColumns: 'Deselect all',
  resetColumns: 'Reset columns',
} as const;

export interface KxResultSettingDefinition {
  key: SharedKxResultSettingKey;
  label: string;
  control: 'checkbox' | 'number' | 'select';
  minimum?: number;
  maximum?: number;
  autoValue?: number;
  autoLabel?: string;
  values?: readonly KxResultOptionDefinition[];
}

export const KX_RESULT_SETTING_DEFINITIONS: readonly KxResultSettingDefinition[] = [
  {
    key: 'density',
    label: 'Density',
    control: 'select',
    values: [
      { value: 'compact', label: 'Compact' },
      { value: 'standard', label: 'Standard' },
      { value: 'comfortable', label: 'Comfortable' },
    ],
  },
  { key: 'cellWidth', label: 'Cell width', control: 'number', minimum: 80, maximum: 600 },
  { key: 'autoFitColumns', label: 'Auto-fit columns', control: 'checkbox' },
  {
    key: 'autoFitMode',
    label: 'Auto-fit scope',
    control: 'select',
    values: [
      { value: 'wholeResult', label: 'Whole result' },
      { value: 'visibleRows', label: 'Visible rows' },
    ],
  },
  { key: 'rowHeight', label: 'Row height', control: 'number', minimum: 20, maximum: 80 },
  {
    key: 'fontSize',
    label: 'Font size',
    control: 'number',
    minimum: 0,
    maximum: 32,
    autoValue: 0,
    autoLabel: 'Auto (VS Code default)',
  },
  { key: 'showRowIndex', label: 'Show row #', control: 'checkbox' },
  { key: 'includeHeaders', label: 'Include headers', control: 'checkbox' },
  { key: 'includeRowIndex', label: 'Include row #', control: 'checkbox' },
  {
    key: 'copyExportConfirmCellThreshold',
    label: 'Copy/export confirm cells',
    control: 'number',
    minimum: 1,
  },
  {
    key: 'elapsedTimeDisplay',
    label: 'Elapsed time',
    control: 'select',
    values: [
      { value: 'auto', label: 'Auto' },
      { value: 'milliseconds', label: 'Milliseconds' },
    ],
  },
  {
    key: 'arrayDisplayFormat',
    label: 'Arrays',
    control: 'select',
    values: [
      { value: 'commaSpace', label: 'Comma + space' },
      { value: 'space', label: 'Space' },
      { value: 'raw', label: 'Raw' },
    ],
  },
  { key: 'qTextSyntaxHighlighting', label: 'Highlight qText output', control: 'checkbox' },
  { key: 'qTextDisplayFormatting', label: 'Format supported qText output', control: 'checkbox' },
  {
    key: 'functionDisplayStrategy',
    label: 'Functions',
    control: 'select',
    values: [
      { value: 'grid', label: 'Grid' },
      { value: 'qText', label: 'qText' },
    ],
  },
  {
    key: 'dictionaryDisplayStrategy',
    label: 'Dictionaries',
    control: 'select',
    values: [
      { value: 'grid', label: 'Grid' },
      { value: 'qText', label: 'qText' },
    ],
  },
  {
    key: 'listDisplayStrategy',
    label: 'Lists',
    control: 'select',
    values: [
      { value: 'grid', label: 'Grid' },
      { value: 'qText', label: 'qText' },
    ],
  },
  {
    key: 'objectDisplayStrategy',
    label: 'Objects',
    control: 'select',
    values: [
      { value: 'grid', label: 'Grid' },
      { value: 'qText', label: 'qText' },
    ],
  },
  {
    key: 'chartDecimalPlaces',
    label: 'Chart decimals',
    control: 'number',
    minimum: 0,
    maximum: 12,
  },
  {
    key: 'chartMaxSourceRows',
    label: 'Chart source rows',
    control: 'number',
    minimum: 1,
  },
  {
    key: 'chartZoomMinSampledPoints',
    label: 'Zoom minimum points',
    control: 'number',
    minimum: 1,
  },
  {
    key: 'chartZoomMaxSampledPoints',
    label: 'Zoom maximum points',
    control: 'number',
    minimum: 1,
  },
] as const;

export interface KxResultSelectionShape {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

export function kxResultSelectionSummary(
  selection: KxResultSelectionShape | undefined
): string {
  if (!selection) {
    return 'No cells selected';
  }
  const rows = Math.max(0, selection.endRow - selection.startRow + 1);
  const columns = Math.max(0, selection.endColumn - selection.startColumn + 1);
  const cells = rows * columns;
  return `${formatUiCount(rows)} row${rows === 1 ? '' : 's'} × ` +
    `${formatUiCount(columns)} column${columns === 1 ? '' : 's'} ` +
    `(${formatUiCount(cells)} cell${cells === 1 ? '' : 's'})`;
}

export function kxLiveResultSummary(
  rowCount: number,
  totalColumnCount: number,
  inlineColumnCount = totalColumnCount
): string {
  const summary = `Live full result • ${formatUiCount(rowCount)} rows × ` +
    `${formatUiCount(totalColumnCount)} columns`;
  return inlineColumnCount < totalColumnCount
    ? `${summary} • ${formatUiCount(inlineColumnCount)} columns inline`
    : summary;
}

export function kxSavedPreviewSummary(
  previewRowCount: number,
  totalRowCount: number,
  columnCount: number
): string {
  const rows = previewRowCount === totalRowCount
    ? `${formatUiCount(previewRowCount)} rows`
    : `${formatUiCount(previewRowCount)} of ${formatUiCount(totalRowCount)} rows`;
  return `Saved preview • ${rows} × ${formatUiCount(columnCount)} columns`;
}

export function moveKxResultColumn(
  order: readonly number[],
  sourceIndex: number,
  direction: -1 | 1
): number[] {
  const current = order.indexOf(sourceIndex);
  const target = current + direction;
  if (current < 0 || target < 0 || target >= order.length) {
    return order.slice();
  }
  const next = order.slice();
  [next[current], next[target]] = [next[target], next[current]];
  return next;
}

function formatUiCount(value: number): string {
  return Math.max(0, Math.floor(value)).toLocaleString('en-US');
}

/**
 * Shared semantic tokens and interaction states. Each host keeps only its
 * geometry/layout adapter; both surfaces consume these colors, focus rules,
 * control density, and reduced-motion behavior.
 */
export const KX_RESULTS_SHARED_CSS = `
.kx-results-surface {
  --kx-results-border: var(--vscode-panel-border, #555);
  --kx-results-background: var(--vscode-editor-background);
  --kx-results-foreground: var(--vscode-editor-foreground);
  --kx-results-muted: var(--vscode-descriptionForeground);
  --kx-results-toolbar-background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  --kx-results-header-background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-editor-background));
  --kx-results-selection-background: var(--vscode-list-activeSelectionBackground, #094771);
  --kx-results-selection-foreground: var(--vscode-list-activeSelectionForeground, var(--vscode-editor-foreground));
  --kx-results-search-background: var(--vscode-editor-findMatchHighlightBackground, #ea5c0055);
  --kx-results-focus: var(--vscode-focusBorder, #007fd4);
  color: var(--kx-results-foreground);
  background: var(--kx-results-background);
  font-family: var(--vscode-font-family, system-ui, sans-serif);
}
.kx-results-surface :where(button, summary, select, input, [tabindex]):focus-visible {
  outline: 1px solid var(--kx-results-focus);
  outline-offset: 2px;
}
.kx-results-surface :where(button, select, input) {
  font: inherit;
}
.kx-results-surface .kx-state-badge {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 0 7px;
  border: 1px solid var(--kx-results-border);
  border-radius: 999px;
  color: var(--kx-results-muted);
  background: var(--kx-results-background);
  font-size: .88em;
  white-space: nowrap;
}
.kx-results-surface .kx-state-badge.is-live::before {
  content: "";
  width: 7px;
  height: 7px;
  margin-right: 5px;
  border-radius: 50%;
  background: var(--vscode-testing-iconPassed, #2ea043);
}
.kx-results-surface .is-selected {
  color: var(--kx-results-selection-foreground);
  background: var(--kx-results-selection-background);
}
.kx-results-surface .is-search-match:not(.is-selected) {
  background: var(--kx-results-search-background);
}
@media (prefers-reduced-motion: reduce) {
  .kx-results-surface *,
  .kx-results-surface *::before,
  .kx-results-surface *::after {
    scroll-behavior: auto !important;
    animation-duration: .001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .001ms !important;
  }
}
@media (forced-colors: active) {
  .kx-results-surface .is-selected,
  .kx-results-surface .is-search-match {
    outline: 1px solid CanvasText;
    outline-offset: -1px;
  }
}
`;
