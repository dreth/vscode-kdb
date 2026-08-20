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
  qTextSyntaxHighlighting: boolean;
  qTextDisplayFormatting: boolean;
  arrayDisplayFormat: ArrayDisplayFormat;
  dictionaryDisplayStrategy: KxQResultDisplayStrategy;
  listDisplayStrategy: KxQResultDisplayStrategy;
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
    key: 'chartDecimalPlaces',
    label: 'Chart decimal places',
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
  --kx-results-alternate-row-background: var(--vscode-tree-tableOddRowsBackground, color-mix(in srgb, var(--kx-results-foreground) 5%, var(--kx-results-background)));
  --kx-results-key-column-accent: var(--vscode-symbolIcon-keyForeground, var(--vscode-charts-blue, var(--kx-results-focus)));
  --kx-results-key-column-background: color-mix(in srgb, var(--kx-results-key-column-accent) 9%, var(--kx-results-background));
  --kx-results-key-column-alternate-row-background: color-mix(in srgb, var(--kx-results-key-column-accent) 9%, var(--kx-results-alternate-row-background));
  --kx-results-key-column-header-background: color-mix(in srgb, var(--kx-results-key-column-accent) 12%, var(--kx-results-header-background));
  --kx-results-hover-background: var(--vscode-list-hoverBackground, color-mix(in srgb, var(--kx-results-foreground) 8%, var(--kx-results-background)));
  --kx-results-sorted-header-background: var(--vscode-list-inactiveSelectionBackground, var(--kx-results-header-background));
  --kx-results-sorted-accent: var(--vscode-list-highlightForeground, var(--kx-results-focus));
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
.kx-results-surface .row-odd:not(.is-selected):not(.is-search-match):not(.is-loading):not(.is-error) {
  background: var(--kx-results-alternate-row-background);
}
.kx-results-surface .is-key-column.row-even:not(.is-column-header):not(.is-selected):not(.is-search-match):not(.is-active-cell):not(.is-loading):not(.is-error):not(:hover) {
  background: var(--kx-results-key-column-background);
}
.kx-results-surface .is-key-column.row-odd:not(.is-column-header):not(.is-selected):not(.is-search-match):not(.is-active-cell):not(.is-loading):not(.is-error):not(:hover) {
  background: var(--kx-results-key-column-alternate-row-background);
}
.kx-results-surface .is-column-header.is-key-column {
  border-inline-start: 2px solid var(--kx-results-key-column-accent);
}
.kx-results-surface .is-column-header.is-key-column:not(.is-selected-header):not(.is-sorted-header):not(.is-loading):not(.is-error):not(.drag-target):not(:hover):not(:focus):not(:focus-within) {
  background: var(--kx-results-key-column-header-background);
}
.kx-results-surface .is-cell-hoverable:hover:not(.is-selected):not(.is-selected-header):not(.is-search-match):not(.is-loading):not(.is-error) {
  background: var(--kx-results-hover-background);
}
.kx-results-surface .is-sorted-column:not(.is-selected):not(.is-search-match):not(.is-loading):not(.is-error) {
  box-shadow:
    inset 1px 0 0 color-mix(in srgb, var(--kx-results-sorted-accent) 35%, transparent),
    inset -1px 0 0 color-mix(in srgb, var(--kx-results-sorted-accent) 35%, transparent);
}
.kx-results-surface .is-column-header.is-sorted-header:not(.is-selected-header) {
  background: var(--kx-results-sorted-header-background);
  box-shadow: inset 0 -2px 0 var(--kx-results-sorted-accent);
}
.kx-results-surface .is-column-header.is-selected-header {
  color: var(--kx-results-selection-foreground);
  background: var(--kx-results-selection-background);
  box-shadow: inset 0 0 0 1px var(--kx-results-focus);
}
.kx-results-surface .is-column-header:focus-visible,
.kx-results-surface .is-column-header:focus-within {
  z-index: 7;
  outline: 2px solid var(--kx-results-focus);
  outline-offset: -2px;
}
.kx-results-surface [role="grid"]:focus .is-active-cell {
  outline: 2px solid var(--kx-results-focus);
  outline-offset: -2px;
}
.kx-results-surface .is-selected {
  color: var(--kx-results-selection-foreground);
  background: var(--kx-results-selection-background);
}
.kx-results-surface .is-search-match:not(.is-selected) {
  background: var(--kx-results-search-background);
}
.kx-results-surface .kx-chart-navigator {
  position: relative;
  height: 38px;
  min-height: 38px;
  overflow: hidden;
  border: 1px solid var(--kx-results-border);
  border-radius: 3px;
  background: var(--kx-results-background);
  color: var(--vscode-charts-blue, var(--kx-results-focus));
  box-sizing: border-box;
  touch-action: none;
  user-select: none;
}
.kx-results-surface .kx-chart-navigator[hidden] {
  display: none;
}
.kx-results-surface .kx-chart-navigator-overview {
  position: absolute;
  inset: 4px 0;
  width: 100%;
  height: calc(100% - 8px);
  pointer-events: none;
}
.kx-results-surface .kx-chart-navigator-overview path {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  vector-effect: non-scaling-stroke;
  opacity: .75;
}
.kx-results-surface .kx-chart-navigator-window {
  position: absolute;
  top: 2px;
  bottom: 2px;
  min-width: 2px;
  border: 2px solid var(--kx-results-focus);
  border-radius: 2px;
  background: color-mix(in srgb, var(--kx-results-focus) 15%, transparent);
  box-shadow: 0 0 0 100vw color-mix(in srgb, var(--kx-results-background) 58%, transparent);
  box-sizing: border-box;
  cursor: grab;
}
.kx-results-surface .kx-chart-navigator-window.is-dragging {
  cursor: grabbing;
}
.kx-results-surface .kx-chart-navigator-handle {
  position: absolute;
  top: 2px;
  bottom: 2px;
  z-index: 2;
  width: 10px;
  border: 1px solid var(--kx-results-focus);
  border-radius: 2px;
  background: var(--kx-results-background);
  box-sizing: border-box;
  cursor: ew-resize;
  transform: translateX(-50%);
}
.kx-results-surface .kx-chart-navigator-handle::after {
  content: "";
  position: absolute;
  top: 7px;
  bottom: 7px;
  left: 3px;
  border-left: 1px solid var(--kx-results-focus);
}
.kx-results-surface .kx-chart-navigator-window:focus-visible,
.kx-results-surface .kx-chart-navigator-handle:focus-visible {
  z-index: 2;
  outline: 2px solid var(--kx-results-focus);
  outline-offset: 1px;
}
.kx-results-surface .kx-chart-navigator[aria-disabled="true"] {
  opacity: .55;
}
.kx-results-surface .kx-chart-navigator[aria-disabled="true"] :where(.kx-chart-navigator-window, .kx-chart-navigator-handle) {
  cursor: not-allowed;
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
body.vscode-high-contrast .kx-results-surface .row-odd:not(.is-selected):not(.is-search-match):not(.is-loading):not(.is-error),
body.vscode-high-contrast-light .kx-results-surface .row-odd:not(.is-selected):not(.is-search-match):not(.is-loading):not(.is-error) {
  background: var(--kx-results-background);
}
body.vscode-high-contrast .kx-results-surface .is-cell-hoverable:hover:not(.is-selected):not(.is-selected-header):not(.is-search-match):not(.is-loading):not(.is-error),
body.vscode-high-contrast-light .kx-results-surface .is-cell-hoverable:hover:not(.is-selected):not(.is-selected-header):not(.is-search-match):not(.is-loading):not(.is-error) {
  outline: 1px dotted var(--kx-results-focus);
  outline-offset: -1px;
}
body.vscode-high-contrast .kx-results-surface .is-sorted-column:not(.is-selected):not(.is-search-match):not(.is-loading):not(.is-error),
body.vscode-high-contrast-light .kx-results-surface .is-sorted-column:not(.is-selected):not(.is-search-match):not(.is-loading):not(.is-error) {
  box-shadow: inset 1px 0 0 var(--kx-results-focus), inset -1px 0 0 var(--kx-results-focus);
}
body.vscode-high-contrast .kx-results-surface .is-column-header.is-sorted-header:not(.is-selected-header),
body.vscode-high-contrast-light .kx-results-surface .is-column-header.is-sorted-header:not(.is-selected-header) {
  color: var(--kx-results-foreground);
  background: var(--kx-results-header-background);
  box-shadow: inset 0 -2px 0 var(--kx-results-focus);
}
body.vscode-high-contrast .kx-results-surface .is-column-header.is-selected-header,
body.vscode-high-contrast-light .kx-results-surface .is-column-header.is-selected-header,
body.vscode-high-contrast .kx-results-surface [role="grid"]:focus .is-active-cell,
body.vscode-high-contrast-light .kx-results-surface [role="grid"]:focus .is-active-cell {
  outline: 2px solid var(--kx-results-focus);
  outline-offset: -2px;
}
body.vscode-high-contrast .kx-results-surface .is-key-column,
body.vscode-high-contrast-light .kx-results-surface .is-key-column {
  border-inline-start: 3px double var(--kx-results-foreground);
}
body.vscode-high-contrast .kx-results-surface .is-key-column:is(.row-even, .row-odd):not(.is-column-header):not(.is-selected):not(.is-search-match):not(.is-active-cell):not(.is-loading):not(.is-error):not(:hover),
body.vscode-high-contrast-light .kx-results-surface .is-key-column:is(.row-even, .row-odd):not(.is-column-header):not(.is-selected):not(.is-search-match):not(.is-active-cell):not(.is-loading):not(.is-error):not(:hover) {
  background: var(--kx-results-background);
}
body.vscode-high-contrast .kx-results-surface .is-column-header.is-key-column:not(.is-selected-header):not(.is-sorted-header):not(.is-loading):not(.is-error):not(.drag-target):not(:hover):not(:focus):not(:focus-within),
body.vscode-high-contrast-light .kx-results-surface .is-column-header.is-key-column:not(.is-selected-header):not(.is-sorted-header):not(.is-loading):not(.is-error):not(.drag-target):not(:hover):not(:focus):not(:focus-within) {
  background: var(--kx-results-header-background);
}
@media (forced-colors: active) {
  .kx-results-surface .row-odd:not(.is-selected):not(.is-search-match):not(.is-loading):not(.is-error) {
    background: Canvas;
  }
  .kx-results-surface .is-cell-hoverable:hover:not(.is-selected):not(.is-selected-header):not(.is-search-match):not(.is-loading):not(.is-error) {
    outline: 1px dotted Highlight;
    outline-offset: -1px;
  }
  .kx-results-surface .is-sorted-column:not(.is-selected):not(.is-search-match):not(.is-loading):not(.is-error) {
    box-shadow: inset 1px 0 0 Highlight, inset -1px 0 0 Highlight;
  }
  .kx-results-surface .is-column-header.is-sorted-header:not(.is-selected-header) {
    color: CanvasText;
    background: Canvas;
    box-shadow: inset 0 -2px 0 Highlight;
  }
  .kx-results-surface .is-column-header.is-selected-header {
    color: HighlightText;
    background: Highlight;
    outline: 1px solid HighlightText;
    outline-offset: -1px;
  }
  .kx-results-surface .is-selected,
  .kx-results-surface .is-search-match {
    outline: 1px solid CanvasText;
    outline-offset: -1px;
  }
  .kx-results-surface [role="grid"]:focus .is-active-cell {
    outline: 2px solid Highlight;
    outline-offset: -2px;
  }
  .kx-results-surface .is-key-column {
    border-inline-start: 3px double CanvasText;
  }
  .kx-results-surface .is-key-column:is(.row-even, .row-odd):not(.is-column-header):not(.is-selected):not(.is-search-match):not(.is-active-cell):not(.is-loading):not(.is-error):not(:hover) {
    background: Canvas;
  }
  .kx-results-surface .is-column-header.is-key-column:not(.is-selected-header):not(.is-sorted-header):not(.is-loading):not(.is-error):not(.drag-target):not(:hover):not(:focus):not(:focus-within) {
    background: Canvas;
  }
  .kx-results-surface .kx-chart-navigator {
    border-color: CanvasText;
    background: Canvas;
    color: CanvasText;
  }
  .kx-results-surface .kx-chart-navigator-window {
    border-color: Highlight;
    background: transparent;
    box-shadow: none;
  }
  .kx-results-surface .kx-chart-navigator-handle {
    border-color: Highlight;
    background: Canvas;
  }
}
`;
