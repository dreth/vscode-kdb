/** Host-neutral, deliberately narrow reporting policy. No global error hooks. */
export const FAILURE_COMPONENTS = ['ipc', 'editor', 'notebook', 'qnb', 'results', 'results-renderer',
  'notebook-renderer', 'language', 'local-server'] as const;
export type FailureComponent = typeof FAILURE_COMPONENTS[number];
export const FAILURE_OPERATIONS = ['connect', 'handshake', 'query', 'close', 'render', 'action', 'encode',
  'commit', 'start', 'stop', 'protocol', 'serialize', 'deserialize', 'analysis', 'metadata', 'readiness',
  'chart', 'export', 'copy'] as const;
export type FailureOperation = typeof FAILURE_OPERATIONS[number];
export interface FailureFrame { filename: string; lineno: number; colno: number; function?: string }
export interface SafeException { type: string; value: string; frames: FailureFrame[]; code?: string; category?: string; classification?: string }
export interface SafeFailure { exceptions: SafeException[]; omissions?: string[] }
export interface ReportingState { enabled: boolean; generation: number }
export interface FailureMessage {
  type: 'kxFailure'; generation: number; component: FailureComponent;
  operation: FailureOperation; failure: SafeFailure; details?: SafeOperationDetails;
}
export const FAILURE_STATE_MESSAGE = 'kxFailureReporting';
export const FAILURE_LSP_STATE = 'vscode-kdb/failureReporting';
export const FAILURE_LSP_EVENT = 'vscode-kdb/failure';
const ERROR_TYPES = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError',
  'URIError', 'EvalError', 'KdbIpcError', 'KdbQError', 'NotebookResultEncodingError', 'QnbCodecError', 'QnbJsonTextError']);
const ERROR_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE',
  'EADDRINUSE', 'EACCES', 'ENOMEM', 'ERR_OUT_OF_RANGE', 'ERR_BUFFER_TOO_LARGE', 'ENOENT', 'ENOSPC',
  'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN', 'ERR_STREAM_DESTROYED', 'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE']);
const ARTIFACTS = ['out/extension.js', 'out/q-language-server.js', 'renderer/kx-notebook-renderer.js', 'results-webview.js'];
const OWNED_FUNCTIONS = new Set(['executeQText', 'runCell', 'query', 'connect', 'serializeNotebook',
  'deserializeNotebook', 'renderOutputItem', 'receiveHostMessage', 'drawChart', 'drawSavedChart',
  'createCell', 'columnResizeHandle', 'refreshLiveViewport', 'reportSyntheticFailure', 'setChartData',
  'copySelection', 'exportSelection', 'guardRendererCallback']);
export type SafeOperationDetails = Record<string, number | boolean | string>;
const NUMERIC_DETAILS = ['durationMs', 'timeoutMs', 'rowCount', 'columnCount', 'queryChars',
  'queryBytes', 'protocolVersion', 'mimeVersion', 'retentionRows', 'attemptCount', 'inputBytes',
  'outputBytes', 'cellCount', 'outputCount', 'queueLength', 'generationAgeMs'];
const BOOLEAN_DETAILS = ['issued', 'live', 'saved', 'connected', 'ready', 'canceled', 'stale', 'queued', 'timeoutDisabled'];
const ENUM_DETAILS: Record<string, readonly string[]> = {
  phase: FAILURE_OPERATIONS, status: ['start', 'success', 'failed', 'canceled', 'disconnected', 'stale'],
  surface: ['editor', 'results', 'live-notebook', 'saved-notebook', 'qnb', 'language', 'local-server'],
  transport: ['ipc', 'lsp', 'renderer', 'loopback', 'in-process'],
  outputMode: ['grid', 'qText', 'inline', 'panel', 'both', 'packed', 'columnar'],
  executionMode: ['query', 'script', 'direct', 'q-only', 'python'],
};
const CATEGORIES = ['network', 'filesystem', 'resource', 'validation', 'q-runtime', 'encoding', 'implementation'];
const CLASSIFICATIONS: Record<string, string> = {
  'Notebook output commit failed': 'notebook-output-commit',
  'Synthetic KX-owned reporting smoke test': 'synthetic-owned-failure',
};
function category(type: string, code: unknown): string {
  if (typeof code === 'string') {
    if (['ENOMEM', 'ERR_BUFFER_TOO_LARGE', 'ENOSPC'].includes(code)) return 'resource';
    if (['ENOENT', 'EACCES'].includes(code)) return 'filesystem';
    if (ERROR_CODES.has(code) && !code.startsWith('ERR_')) return 'network';
    if (ERROR_CODES.has(code)) return 'validation';
  }
  if (type === 'KdbIpcError') return 'network';
  if (type === 'KdbQError') return 'q-runtime';
  if (['NotebookResultEncodingError', 'QnbCodecError', 'QnbJsonTextError'].includes(type)) return 'encoding';
  return 'implementation';
}
export function isFailureComponent(value: unknown): value is FailureComponent {
  return FAILURE_COMPONENTS.includes(value as FailureComponent);
}
export function isFailureOperation(value: unknown): value is FailureOperation {
  return FAILURE_OPERATIONS.includes(value as FailureOperation);
}
function field(value: unknown, key: string): unknown {
  try { return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined; }
  catch { return undefined; }
}
export function safeFailure(error: unknown, roots: readonly string[] = []): SafeFailure {
  const exceptions: SafeException[] = [];
  const omissions = new Set<string>();
  const seen = new Set<unknown>();
  let current = error;
  for (; current && !seen.has(current) && exceptions.length < 3; current = field(current, 'cause')) {
    seen.add(current);
    const name = field(current, 'name');
    const code = field(current, 'code');
    const type = typeof name === 'string' && ERROR_TYPES.has(name) ? name : 'Error';
    const value = typeof code === 'string' && ERROR_CODES.has(code) ? code : 'Unstructured error message omitted';
    const stack = field(current, 'stack');
    if (typeof stack === 'string' && stack.length > 32_768) omissions.add('stack-truncated');
    const frames: FailureFrame[] = [];
    if (typeof stack === 'string') for (const line of stack.slice(0, 32_768).split('\n').slice(1, 100)) {
      const match = line.match(/^\s*at\s+(?:(?:async|new)\s+)?(?:[A-Za-z0-9_.$<>]+(?:\s+\[as [^\]]{1,100}\])?\s+\()?(.+):(\d+):(\d+)\)?$/);
      if (!match) continue;
      const location = match[1].replace(/\\/g, '/');
      let filename: string | undefined;
      for (const root of roots) if (location.startsWith(root.replace(/\\/g, '/'))) {
        const relative = location.slice(root.length).replace(/^\//, '');
        if (ARTIFACTS.includes(relative)) filename = relative;
      }
      // Owned browser callbacks know their own packaged renderer; no window-wide harvesting.
      if (!roots.length) filename = ARTIFACTS.find(artifact => location.endsWith('/' + artifact));
      if (filename) {
        const functionName = line.match(/^\s*at\s+(?:Object\.)?([A-Za-z0-9_$]+)\s*\(/)?.[1];
        if (frames.length < 50) frames.push({ filename, lineno: Number(match[2]), colno: Number(match[3]),
          ...(functionName && OWNED_FUNCTIONS.has(functionName) ? { function: functionName } : {}) });
        else omissions.add('frames-truncated');
      }
    }
    const message = field(current, 'message');
    const classification = typeof message === 'string' && Object.hasOwn(CLASSIFICATIONS, message) ? CLASSIFICATIONS[message] : undefined;
    exceptions.push({ type, value, frames, category: category(type, code),
      ...(typeof code === 'string' && ERROR_CODES.has(code) ? { code } : {}),
      ...(classification ? { classification } : {}) });
  }
  if (current) omissions.add('causes-truncated');
  return { exceptions: exceptions.length ? exceptions : [{ type: 'Error', value: 'Thrown value omitted', frames: [] }],
    ...(omissions.size ? { omissions: [...omissions] } : {}) };
}
export function safeOperationDetails(value: unknown): SafeOperationDetails {
  const result: SafeOperationDetails = {};
  for (const key of NUMERIC_DETAILS) {
    const item = field(value, key);
    if (typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= Number.MAX_SAFE_INTEGER) result[key] = item;
  }
  for (const key of BOOLEAN_DETAILS) {
    const item = field(value, key);
    if (typeof item === 'boolean') result[key] = item;
  }
  for (const [key, allowed] of Object.entries(ENUM_DETAILS)) {
    const item = field(value, key);
    if (typeof item === 'string' && allowed.includes(item)) result[key] = item;
  }
  const id = field(value, 'operationId');
  if (typeof id === 'string' && /^kx-[a-f0-9]{1,16}-[a-f0-9]{1,12}$/.test(id)) result.operationId = id;
  return result;
}
function validOperationDetails(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const clean = safeOperationDetails(value);
  return Object.keys(value).length <= 40 && Object.entries(value).every(([key, item]) => clean[key] === item);
}
export function parseFailureMessage(value: unknown, state: ReportingState,
  component: FailureComponent): FailureMessage | undefined {
  try {
    if (!state.enabled || !value || typeof value !== 'object') return undefined;
    const message = value as FailureMessage;
    if (message.type !== 'kxFailure' || message.generation !== state.generation ||
      message.component !== component || !isFailureOperation(message.operation) ||
      Object.keys(message).some(key => !['type', 'generation', 'component', 'operation', 'failure', 'details'].includes(key))) return undefined;
    if (message.details !== undefined && !validOperationDetails(message.details)) return undefined;
    const exceptions = message.failure?.exceptions;
    if (!Array.isArray(exceptions) || !exceptions.length || exceptions.length > 3 ||
      Object.keys(message.failure).some(key => !['exceptions', 'omissions'].includes(key))) return undefined;
    const omissions = message.failure.omissions;
    if (omissions !== undefined && (!Array.isArray(omissions) || omissions.length > 3 ||
      omissions.some(item => !['stack-truncated', 'frames-truncated', 'causes-truncated'].includes(item)))) return undefined;
    for (const item of exceptions) {
      if (!item || !ERROR_TYPES.has(item.type) ||
        !(ERROR_CODES.has(item.value) || ['Unstructured error message omitted', 'Thrown value omitted'].includes(item.value)) ||
        !Array.isArray(item.frames) || item.frames.length > 50 ||
        Object.keys(item).some(key => !['type', 'value', 'frames', 'code', 'category', 'classification'].includes(key))) return undefined;
      if ((item.code !== undefined && !ERROR_CODES.has(item.code)) ||
        (item.category !== undefined && !CATEGORIES.includes(item.category)) ||
        (item.classification !== undefined && !Object.values(CLASSIFICATIONS).includes(item.classification))) return undefined;
      for (const frame of item.frames) if (!frame || !ARTIFACTS.includes(frame.filename) ||
        !Number.isSafeInteger(frame.lineno) || frame.lineno < 0 || frame.lineno > 100_000_000 ||
        !Number.isSafeInteger(frame.colno) || frame.colno < 0 || frame.colno > 100_000_000 ||
        (frame.function !== undefined && !OWNED_FUNCTIONS.has(frame.function)) ||
        Object.keys(frame).some(key => !['filename', 'lineno', 'colno', 'function'].includes(key))) return undefined;
    }
    return message;
  } catch { return undefined; }
}
type Observer = (component: FailureComponent, operation: FailureOperation, error: unknown, details?: unknown) => void;
type SafeObserver = (component: FailureComponent, operation: FailureOperation, failure: SafeFailure, details?: unknown) => void;
let observer: Observer | undefined;
let safeObserver: SafeObserver | undefined;
let breadcrumbObserver: ((component: FailureComponent, operation: FailureOperation, details?: unknown) => void) | undefined;
let reportingState: ReportingState = { enabled: false, generation: 0 };
const stateObservers = new Set<(state: ReportingState) => void>();
export function configureFailureObserver(next: Observer | undefined, state?: ReportingState, safe?: SafeObserver,
  breadcrumb?: (component: FailureComponent, operation: FailureOperation, details?: unknown) => void): void {
  observer = next;
  safeObserver = safe;
  breadcrumbObserver = breadcrumb;
  if (state) {
    reportingState = state;
    for (const notify of stateObservers) { try { notify({ ...state }); } catch { /* Observer isolation. */ } }
  }
}
export function reportKxBreadcrumb(component: FailureComponent, operation: FailureOperation, details?: unknown): void {
  if (!breadcrumbObserver) return;
  try { breadcrumbObserver(component, operation, details); } catch { /* Observer isolation. */ }
}
export function forwardKxFailure(value: unknown, component: FailureComponent): void {
  if (!safeObserver) return;
  const message = parseFailureMessage(value, reportingState, component);
  if (message) { try { safeObserver(component, message.operation, message.failure, message.details); } catch { /* Isolated. */ } }
}
export function currentFailureReportingState(): ReportingState { return { ...reportingState }; }
export function onFailureReportingChanged(callback: (state: ReportingState) => void): { dispose(): void } {
  stateObservers.add(callback);
  return { dispose: () => { stateObservers.delete(callback); } };
}
export function reportKxFailure(component: FailureComponent, operation: FailureOperation, error: unknown, details?: unknown): void {
  if (!observer) return;
  try { observer(component, operation, error, details); } catch { /* Reporting cannot change an operation. */ }
}
export function reportKxFailureLazy(component: FailureComponent, operation: FailureOperation,
  error: () => unknown, details?: unknown): void {
  if (!observer) return;
  try { observer(component, operation, error(), details); } catch { /* Isolated. */ }
}

let operationSequence = 0;
/** Ephemeral tokens only, no URI/query hashes; disabled producers collect nothing. */
export function newFailureOperationId(): string | undefined {
  if (!reportingState.enabled) return undefined;
  operationSequence = (operationSequence + 1) % 0xFFFFFFFF;
  return `kx-${reportingState.generation.toString(16)}-${operationSequence.toString(16)}`;
}
