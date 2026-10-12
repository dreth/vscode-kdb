import * as os from 'node:os';
import * as v8 from 'node:v8';
/** Audited manifest fields only. No arbitrary configuration or string values. */
export const SAFE_BOOLEAN_SETTINGS = ['diagnostics.failSilently', 'languageServer.enabled', 'languageServer.connectedIntelligence',
  'languageServer.lint.enabled', 'notebook.enableDirectController', 'performance.trace',
  'features.serverExplorer', 'features.queryHistory', 'results.qText.syntaxHighlighting',
  'results.qText.displayFormatting', 'results.viewer.autoFitColumns', 'results.showRowIndex',
  'results.includeHeaders', 'results.includeRowIndex', 'results.hideLargeResultWarnings',
  'results.hideLargeSortWarnings', 'results.showColumnSummaryStatistics'];
export const SAFE_NUMERIC_SETTINGS = ['languageServer.diagnostics.debounceMs', 'languageServer.diagnostics.maxProblems',
  'languageServer.maxFileSizeBytes', 'languageServer.workspace.maxFiles', 'notebook.maxOutputRows',
  'notebook.maxOutputBytes', 'connectionTimeoutMs', 'queryTimeoutMs', 'serverExplorer.previewCellLimit',
  'queryHistory.maxEntries', 'results.viewer.chartMaxSourceRows', 'results.viewer.chartDecimalPlaces',
  'results.viewer.tableDecimalPlaces', 'results.largeSortWarningRowThreshold', 'results.copyExportConfirmCellThreshold',
  'results.localDataServerFullExportCellLimit', 'results.viewer.chartScientificNotationThreshold',
  ...['compact', 'standard', 'comfortable'].flatMap(density => ['cellWidth', 'rowHeight', 'fontSize'].map(key => `results.${density}.${key}`))];
export const SAFE_ENUM_SETTINGS: Record<string, readonly string[]> = {
  'notebook.presentation': ['inline', 'panel', 'both'], 'results.density': ['compact', 'standard', 'comfortable'],
  'results.viewer.initialViewColumn': ['active', 'beside', 'one', 'two', 'three'],
  'results.viewer.arrayDisplayFormat': ['commaSpace', 'space', 'raw'],
  'results.viewer.dictionaryDisplayStrategy': ['grid', 'qText'], 'results.viewer.listDisplayStrategy': ['grid', 'qText'],
  'results.viewer.autoFitMode': ['wholeResult', 'visibleRows'], 'results.elapsedTimeDisplay': ['auto', 'milliseconds'],
};
export const SAFE_SETTING_KEYS = [...SAFE_BOOLEAN_SETTINGS, ...SAFE_NUMERIC_SETTINGS, ...Object.keys(SAFE_ENUM_SETTINGS)];
export const RESOURCE_KEYS = ['userCPUTime', 'systemCPUTime', 'maxRSS', 'minorPageFault', 'majorPageFault',
  'fsRead', 'fsWrite', 'voluntaryContextSwitches', 'involuntaryContextSwitches'];
export const HEAP_KEYS = ['total_heap_size', 'total_heap_size_executable', 'total_physical_size', 'total_available_size',
  'used_heap_size', 'heap_size_limit', 'malloced_memory', 'peak_malloced_memory', 'number_of_native_contexts',
  'number_of_detached_contexts', 'total_global_handles_size', 'used_global_handles_size', 'external_memory'];
export const VERSION_KEYS = ['v8', 'uv', 'openssl', 'zlib', 'brotli', 'llhttp', 'icu', 'unicode', 'nghttp2', 'napi'];
export const LIBRARY_KEYS = ['@sentry/core', '@sentry/node', 'chevrotain', 'jszip', 'pako', 'uplot', 'vscode-languageclient', 'vscode-languageserver', 'vscode-languageserver-textdocument'];
/** Each API is independent so constrained hosts keep the remaining measurements. */
export function collectRuntimeFacts(): Record<string, unknown> {
  const facts: Record<string, unknown> = {};
  const unavailable: string[] = [];
  const read = (key: string, get: () => unknown): void => {
    try { facts[key] = get(); } catch { unavailable.push(key); }
  };
  read('processUptimeSeconds', () => process.uptime());
  read('hostUptimeSeconds', () => os.uptime());
  read('cpuCount', () => os.availableParallelism());
  read('totalMemory', () => os.totalmem());
  read('freeMemory', () => os.freemem());
  read('memory', () => process.memoryUsage());
  read('resourceUsage', () => process.resourceUsage());
  read('cpuUsage', () => process.cpuUsage());
  read('heapStatistics', () => v8.getHeapStatistics());
  read('versions', () => Object.fromEntries(VERSION_KEYS.map(key => [key, process.versions[key]])));
  facts.unavailableSections = unavailable;
  return facts;
}
