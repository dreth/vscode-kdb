import { SAFE_BOOLEAN_SETTINGS, SAFE_NUMERIC_SETTINGS, SAFE_ENUM_SETTINGS, RESOURCE_KEYS, HEAP_KEYS, VERSION_KEYS, LIBRARY_KEYS } from './failure-context';
import { randomBytes } from 'node:crypto';
import * as http from 'node:http';
import * as https from 'node:https';
import {
  FailureComponent, FailureOperation, SafeFailure, ReportingState, isFailureComponent,
  isFailureOperation, safeFailure, safeOperationDetails, parseFailureMessage, SafeOperationDetails,
} from './failure-record';

const MAX_BYTES = 256 * 1024;
const DELIVERY_COOLDOWN_MS = 60 * 60 * 1000;
export function machineSetting(inspection: { globalValue?: unknown; defaultValue?: unknown } | undefined): string {
  const value = inspection?.globalValue ?? inspection?.defaultValue;
  return typeof value === 'string' ? value.trim() : '';
}
export function machineBooleanSetting(inspection: { globalValue?: unknown; defaultValue?: unknown } | undefined): boolean {
  const value = inspection?.globalValue ?? inspection?.defaultValue;
  return typeof value === 'boolean' ? value : true;
}
export function resolveReportUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.hash) return undefined;
    return url.href;
  } catch { return undefined; }
}
export function resolveSentryDsn(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || !/^[a-zA-Z0-9_-]+$/.test(url.username) ||
      url.password || url.hash || url.search || !/\/\d+$/.test(url.pathname)) return undefined;
    return url.href;
  } catch { return undefined; }
}
export interface FailureReport {
  schemaVersion: 1; eventId: string; sessionId: string; timestamp: string;
  component: FailureComponent; operationName: FailureOperation; failure: SafeFailure;
  environment: Record<string, unknown>; operation: SafeOperationDetails;
  breadcrumbs: { component: FailureComponent; operation: FailureOperation; timestamp: string; details: SafeOperationDetails }[];
  omissions: string[];
}
export type SendReport = (url: string, body: string | Uint8Array, contentType: string, signal: AbortSignal) => Promise<void>;
interface ReporterOptions {
  environment: () => unknown;
  artifactRoots?: readonly string[];
  status?: (status: string) => void;
  now?: () => number;
  send?: SendReport;
  loadSentry?: () => Promise<typeof import('@sentry/node')>;
}
interface Sink {
  url: string; kind: 'json' | 'sentry'; queue: FailureReport[]; abort: AbortController;
  attempts: number[]; fingerprints: Map<string, number>; task?: Promise<void>;
  client?: import('@sentry/core').Client; scope?: import('@sentry/node').Scope;
  sdk?: typeof import('@sentry/node'); cooldownUntil: number;
  pending?: Promise<void>; currentReport?: FailureReport; seen: WeakSet<object>;
}
export class FailureReporter {
  private sinks: Sink[] = [];
  private disposed = false;
  private failSilently = true;
  private readonly deliveryErrors = new WeakSet<object>();
  private generation = 0;
  private sessionId = '';
  private breadcrumbs: FailureReport['breadcrumbs'] = [];
  private breadcrumbOmissions = 0;
  private operationSequence = 0;
  private readonly now: () => number;
  private readonly send: SendReport;
  public constructor(private readonly options: ReporterOptions) {
    this.now = options.now ?? Date.now;
    this.send = options.send ?? postReport;
  }
  public get state(): ReportingState { return { enabled: !!this.sinks.length && !this.disposed, generation: this.generation }; }
  public configure(config: { reportServerUrl?: unknown; sentryDsn?: unknown; failSilently?: unknown }): void {
    if (this.disposed) return;
    this.failSilently = config.failSilently !== false;
    const values = [resolveReportUrl(config.reportServerUrl), resolveSentryDsn(config.sentryDsn)];
    for (const [index, raw] of [config.reportServerUrl, config.sentryDsn].entries()) {
      if (typeof raw === 'string' && raw.trim() && !values[index]) this.status('invalid-configuration');
    }
    const previous = this.sinks;
    this.sinks = [];
    for (const [index, url] of values.entries()) if (url) {
      const kind = index === 0 ? 'json' : 'sentry';
      const existing = previous.find(sink => sink.kind === kind && sink.url === url);
      this.sinks.push(existing ?? { url, kind, queue: [], abort: new AbortController(), attempts: [], fingerprints: new Map(), seen: new WeakSet(), cooldownUntil: 0 });
    }
    if (previous.length === this.sinks.length && previous.every(sink => this.sinks.includes(sink))) return;
    this.generation++;
    for (const sink of previous) if (!this.sinks.includes(sink)) this.revoke(sink);
    if (!previous.length && this.sinks.length) {
      this.sessionId = randomBytes(16).toString('hex');
      // Producer records from a previous activation cannot match a fresh host.
      this.generation = Number.parseInt(this.sessionId.slice(0, 12), 16) + 1;
    }
    if (!this.sinks.length) { this.sessionId = ''; this.breadcrumbs = []; this.breadcrumbOmissions = 0; }
  }
  public capture(component: FailureComponent, operation: FailureOperation, error: unknown, details?: unknown): string | undefined {
    if (!this.state.enabled || !isFailureComponent(component) || !isFailureOperation(operation)) return;
    if (error && typeof error === 'object' && this.deliveryErrors.has(error)) return;
    try { return this.captureSafe(component, operation, safeFailure(error, this.options.artifactRoots), details,
      error && typeof error === 'object' ? error : undefined); }
    catch { this.status('collection-failed'); }
  }
  public captureSafe(component: FailureComponent, operationName: FailureOperation, failure: SafeFailure, details?: unknown, identity?: object): string | undefined {
    if (!this.state.enabled || !isFailureComponent(component) || !isFailureOperation(operationName)) return;
    try {
      if (!parseFailureMessage({ type: 'kxFailure', generation: this.generation, component,
        operation: operationName, failure }, this.state, component)) return;
      failure = JSON.parse(JSON.stringify(failure)) as SafeFailure;
      if (!parseFailureMessage({ type: 'kxFailure', generation: this.generation, component,
        operation: operationName, failure }, this.state, component)) return;
      const now = this.now();
      const fingerprint = JSON.stringify([component, operationName, failure]);
      const eligible = this.sinks.filter(sink => {
        const previous = sink.fingerprints.get(fingerprint);
        return now >= sink.cooldownUntil && (!identity || !sink.seen.has(identity)) && (previous === undefined || now - previous >= 60_000) &&
          sink.queue.length + (sink.task ? 1 : 0) < 20;
      });
      if (!eligible.length) return;
      const generation = this.generation;
      let environment: Record<string, unknown>;
      try { environment = safeEnvironment(this.options.environment()); }
      catch { environment = { unavailable: true }; }
      if (generation !== this.generation || !this.state.enabled) return;
      const report: FailureReport = { schemaVersion: 1, eventId: randomBytes(16).toString('hex'),
        sessionId: this.sessionId, timestamp: new Date(now).toISOString(), component, operationName,
        failure, environment, operation: { operationId: `kx-${this.generation.toString(16)}-${(++this.operationSequence).toString(16)}`,
          phase: operationName, status: 'failed', ...safeOperationDetails(details) }, breadcrumbs: [...this.breadcrumbs],
        omissions: [...(failure.omissions ?? []), 'q-runtime-not-probed', 'python-runtime-not-probed'] };
      if (!failure.exceptions.some(item => item.frames.length)) report.omissions.push('stack-unavailable');
      if (environment.unavailable) report.omissions.push('environment-unavailable');
      if (this.breadcrumbOmissions) report.omissions.push('breadcrumbs-history-truncated');
      for (const key of ['durationMs', 'timeoutMs', 'transport', 'protocolVersion', 'issued', 'ready', 'connected', 'canceled', 'stale', 'rowCount', 'columnCount']) {
        if (report.operation[key] === undefined) report.omissions.push(`operation-${key}-unavailable`);
      }
      if (!report.operation.operationId) report.omissions.push('operation-correlation-unavailable');
      if (!report.operation.surface) report.omissions.push('surface-unavailable');
      for (const key of ['buildId', 'versions', 'resourceUsage', 'heapStatistics', 'cpuUsage', 'processUptimeSeconds', 'hostUptimeSeconds', 'freeMemory']) {
        if (environment[key] === undefined) report.omissions.push(`${key}-unavailable`);
      }
      if (Array.isArray(environment.unavailableSections)) report.omissions.push(...environment.unavailableSections.map(key => `${key}-unavailable`));
      if (Number(environment.omittedExtensions) > 0) report.omissions.push('extensions-truncated');
      for (const key of ['kxVersion', 'vscodeVersion', 'nodeVersion', 'electronVersion', 'chromeVersion']) {
        if (environment[key] === undefined) report.omissions.push(`${key}-unavailable`);
      }
      if (!reduceFailureReport(report)) { this.status('oversized'); return; }
      for (const sink of eligible) if (this.sinks.includes(sink)) {
        if (identity) sink.seen.add(identity);
        sink.fingerprints.set(fingerprint, now);
        while (sink.fingerprints.size > 200) sink.fingerprints.delete(sink.fingerprints.keys().next().value!);
        sink.queue.push(report);
        this.pump(sink);
      }
      return report.eventId;
    } catch { this.status('collection-failed'); }
  }
  public breadcrumb(component: FailureComponent, operation: FailureOperation, details?: unknown): void {
    if (!this.state.enabled || !isFailureComponent(component) || !isFailureOperation(operation)) return;
    try {
      this.breadcrumbs.push({ component, operation, timestamp: new Date(this.now()).toISOString(), details: safeOperationDetails(details) });
      while (this.breadcrumbs.length > 100 || Buffer.byteLength(JSON.stringify(this.breadcrumbs)) > 64 * 1024) { this.breadcrumbs.shift(); this.breadcrumbOmissions++; }
    } catch { /* Optional history cannot interrupt an operation. */ }
  }
  public async idle(): Promise<void> { while (this.sinks.some(sink => sink.task)) await Promise.all(this.sinks.map(sink => sink.task)); }
  public dispose(): void {
    this.disposed = true; this.generation++;
    for (const sink of this.sinks) this.revoke(sink);
    this.sinks = []; this.sessionId = ''; this.breadcrumbs = []; this.breadcrumbOmissions = 0;
  }
  private revoke(sink: Sink): void {
    sink.abort.abort(); sink.queue = []; sink.fingerprints.clear();
    // The guarded transport is revoked first: close cannot flush to an old host.
    if (sink.client) void Promise.resolve(sink.client.close(0)).catch(() => undefined);
  }
  private status(value: string): void { if (this.failSilently) return; try { this.options.status?.(`[reporting] ${value}`); } catch { /* No recursion. */ } }
  private pump(sink: Sink): void {
    if (sink.task || sink.abort.signal.aborted || this.now() < sink.cooldownUntil) return;
    sink.task = (async () => {
      while (sink.queue.length && !sink.abort.signal.aborted && this.now() >= sink.cooldownUntil) {
        const report = sink.queue.shift()!;
        const now = this.now();
        sink.attempts = sink.attempts.filter(timestamp => now - timestamp < 60_000);
        if (sink.attempts.length >= 10) { this.status('rate-limited'); continue; }
        sink.attempts.push(now);
        try {
          if (sink.kind === 'json') await this.sendTo(sink, sink.url, JSON.stringify(report), 'application/json');
          else await this.sendSentry(sink, report);
        } catch { this.deliveryFailed(sink); }
      }
    })().finally(() => { sink.task = undefined; if (sink.queue.length && !sink.abort.signal.aborted) this.pump(sink); });
  }
  /** No retry timer: a subsequent NEW eligible failure after cooldown is the only next attempt. */
  private deliveryFailed(sink: Sink): void {
    if (sink.abort.signal.aborted || this.now() < sink.cooldownUntil) return;
    sink.cooldownUntil = this.now() + DELIVERY_COOLDOWN_MS;
    sink.queue = [];
    this.status('delivery-failed');
  }
  private async sendTo(sink: Sink, url: string, body: string, contentType: string): Promise<void> {
    try { await this.send(url, body, contentType, sink.abort.signal); }
    catch (error) {
      if (error && typeof error === 'object') this.deliveryErrors.add(error);
      this.deliveryFailed(sink);
      throw error;
    }
  }
  private async sendSentry(sink: Sink, report: FailureReport): Promise<void> {
    if (!sink.client) {
      try {
        const sdk = await (this.options.loadSentry?.() ?? import('@sentry/node'));
        if (sink.abort.signal.aborted) return;
        const core = await import('@sentry/core');
        if (sink.abort.signal.aborted) return;
        sink.sdk = sdk;
        // The standard NodeClient installs a process exit listener even without
        // integrations. The base client also normally processes global scopes.
        // Keep both scopes and event preparation private to this reporting sink.
        class OwnedClient extends core.Client {
          private readonly isolation = new core.Scope();
          public constructor(options: import('@sentry/core').ClientOptions) { super(options); }
          public eventFromException(): Promise<import('@sentry/core').Event> { return Promise.resolve({}); }
          public eventFromMessage(): Promise<import('@sentry/core').Event> { return Promise.resolve({}); }
          // SDK pipeline errors are dropped, never captured recursively.
          public override captureException(): string { return ''; }
          public override captureMessage(): string { return ''; }
          protected override _prepareEvent(event: import('@sentry/core').Event): Promise<import('@sentry/core').Event> {
            return Promise.resolve(event);
          }
          protected override _captureEvent(event: import('@sentry/core').Event,
            hint?: import('@sentry/core').EventHint, scope?: import('@sentry/core').Scope): PromiseLike<string | undefined> {
            return super._captureEvent(event, hint, scope ?? this.isolation, this.isolation);
          }
        }
        const parsed = new URL(sink.url);
        const segments = parsed.pathname.split('/');
        const project = segments.pop()!;
        const key = parsed.username;
        parsed.username = ''; parsed.password = '';
        parsed.pathname = segments.join('/') + '/api/' + project + '/envelope/';
        parsed.search = new URLSearchParams({ sentry_version: '7', sentry_key: key }).toString();
        const destination = parsed.href;
        const client = new OwnedClient({ dsn: sink.url, integrations: [],
          transport: () => ({ send: async envelope => {
            if (sink.abort.signal.aborted || this.now() < sink.cooldownUntil) return {};
            // Construct a minimal wire envelope: SDK cannot attach sessions or user/global data.
            const events = envelope[1].filter(([header]) => header.type === 'event');
            for (const [, event] of events) {
              const serialized = JSON.stringify(event);
              if (Buffer.byteLength(serialized) > MAX_BYTES) { this.status('oversized'); continue; }
              const body = JSON.stringify({ event_id: (event as { event_id?: string }).event_id }) + '\n' +
                JSON.stringify({ type: 'event', length: Buffer.byteLength(serialized) }) + '\n' + serialized;
              sink.pending = this.sendTo(sink, destination, body, 'application/x-sentry-envelope');
              await sink.pending;
            }
            return { statusCode: 200 };
          }, flush: async () => { await sink.pending; return true; } }),
          stackParser: sdk.defaultStackParser, sendDefaultPii: false, sendClientReports: false,
          enableLogs: false, enableMetrics: false, tracesSampleRate: 0,
          beforeSend: () => sink.abort.signal.aborted || !sink.currentReport ? null : sentryEvent(sink.currentReport),
        });
        sink.scope = new core.Scope(); sink.scope.setClient(client); sink.client = client;
      } catch { throw new Error('SDK initialization failed'); }
    }
    if (sink.abort.signal.aborted) return;
    sink.currentReport = report;
    try {
      sink.client!.captureEvent(sentryEvent(report), undefined, sink.scope);
      if (!await sink.client!.flush(5_000)) this.deliveryFailed(sink);
    } finally { sink.currentReport = undefined; sink.pending = undefined; }
  }
}
function sentryEvent(report: FailureReport): import('@sentry/node').ErrorEvent {
  const exceptions = report.failure.exceptions.map((exception, index) => ({ type: exception.type, value: exception.value,
    mechanism: { type: 'kx-owned-boundary', handled: true, exception_id: index, ...(index ? { parent_id: index - 1, source: 'cause' } : {}) },
    stacktrace: { frames: [...exception.frames].reverse().map(frame => ({ ...frame, in_app: true })) } }));
  return { type: undefined, event_id: report.eventId, timestamp: Date.parse(report.timestamp) / 1000,
    platform: 'node', level: 'error', release: `vscode-kdb@${report.environment.kxVersion ?? 'unknown'}`,
    exception: { values: exceptions.reverse() }, tags: { component: report.component, operation: report.operationName,
      ...(report.operation.surface ? { surface: String(report.operation.surface) } : {}),
      ...(report.operation.phase ? { phase: String(report.operation.phase) } : {}),
      ...(report.environment.buildId ? { build: String(report.environment.buildId) } : {}),
      category: report.failure.exceptions[0].category ?? 'implementation',
      ...(report.failure.exceptions[0].code ? { error_code: report.failure.exceptions[0].code } : {}),
      ...(report.environment.remoteKind ? { host_kind: String(report.environment.remoteKind) } : {}) },
    contexts: { runtime: { name: 'node', version: String(report.environment.nodeVersion ?? 'unknown') },
      os: { name: String(report.environment.platform ?? 'unknown'), version: String(report.environment.osRelease ?? 'unknown') },
      kx: { ...report.environment, failureDetails: report.failure.exceptions.map(({ frames: _frames, ...detail }) => detail), operation: report.operation, sessionId: report.sessionId, omissions: report.omissions } },
    breadcrumbs: report.breadcrumbs.map(item => ({ category: item.component, message: item.operation,
      timestamp: Date.parse(item.timestamp) / 1000, data: item.details })),
  };
}
function safeEnvironment(input: unknown): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  if (!input || typeof input !== 'object') return { unavailable: true };
  const source = input as Record<string, unknown>;
  for (const key of ['kxVersion', 'vscodeVersion', 'nodeVersion', 'electronVersion', 'chromeVersion',
    'platform', 'osRelease', 'arch', 'remoteKind', 'uiKind', 'extensionKind']) {
    const value = source[key];
    if (typeof value === 'string' && /^[A-Za-z0-9._ -]{1,100}$/.test(value)) output[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) output[key] = value;
  }
  for (const key of ['cpuCount', 'totalMemory', 'freeMemory', 'processUptimeSeconds', 'hostUptimeSeconds', 'rss', 'heapUsed', 'heapTotal', 'external', 'arrayBuffers']) {
    const value = source[key]; if (typeof value === 'number' && Number.isFinite(value) && value >= 0) output[key] = value;
  }
  const settings = source.settings;
  if (settings && typeof settings === 'object') {
    const values: Record<string, unknown> = {};
    for (const key of SAFE_BOOLEAN_SETTINGS) {
      const value = (settings as Record<string, unknown>)[key]; if (typeof value === 'boolean') values[key] = value;
    }
    for (const key of SAFE_NUMERIC_SETTINGS) {
      const value = (settings as Record<string, unknown>)[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= -1 && value <= Number.MAX_SAFE_INTEGER) values[key] = value;
    }
    for (const [key, allowed] of Object.entries(SAFE_ENUM_SETTINGS)) {
      const value = (settings as Record<string, unknown>)[key];
      if (typeof value === 'string' && allowed.includes(value)) values[key] = value;
    }
    output.settings = values;
  }
  for (const [section, keys] of [['resourceUsage', RESOURCE_KEYS], ['heapStatistics', HEAP_KEYS], ['cpuUsage', ['user', 'system']]] as const) {
    const input = source[section];
    if (!input || typeof input !== 'object') continue;
    const record: Record<string, number> = {};
    for (const key of keys) {
      const value = (input as Record<string, unknown>)[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER) record[key] = value;
    }
    output[section] = record;
  }
  const versions = source.versions;
  if (versions && typeof versions === 'object') output.versions = Object.fromEntries(VERSION_KEYS.flatMap(key => {
    const value = (versions as Record<string, unknown>)[key];
    return typeof value === 'string' && /^[A-Za-z0-9.+_-]{1,60}$/.test(value) ? [[key, value]] : [];
  }));
  if (source.libraries && typeof source.libraries === 'object') output.libraries = Object.fromEntries(LIBRARY_KEYS.flatMap(key => {
    const value = (source.libraries as Record<string, unknown>)[key];
    return typeof value === 'string' && /^[0-9][A-Za-z0-9.+_-]{0,59}$/.test(value) ? [[key, value]] : [];
  }));
  if (typeof source.buildId === 'string' && /^[a-f0-9]{64}$/.test(source.buildId)) output.buildId = source.buildId;
  if (Array.isArray(source.unavailableSections)) output.unavailableSections = source.unavailableSections.filter(key =>
    ['buildId', 'resourceUsage', 'heapStatistics', 'cpuUsage', 'versions', 'processUptimeSeconds', 'hostUptimeSeconds', 'cpuCount', 'totalMemory', 'freeMemory', 'memory'].includes(key));
  if (Array.isArray(source.extensions)) {
    output.extensions = source.extensions.slice(0, 200).flatMap(item => {
      if (!item || typeof item !== 'object') return [];
      const { id, version } = item;
      if (typeof id !== 'string' || typeof version !== 'string' ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(id) || id.length > 150 || !/^[A-Za-z0-9.+_-]{1,60}$/.test(version)) return [];
      return [{ id, version }];
    });
    output.omittedExtensions = Math.max(0, source.extensions.length - 200);
  }
  return output;
}
/** Preserve primary failure/frames; reduce optional sections in deterministic order for BOTH projections. */
export function reduceFailureReport(report: FailureReport): boolean {
  const fits = (): boolean => Math.max(Buffer.byteLength(JSON.stringify(report)), Buffer.byteLength(JSON.stringify(sentryEvent(report)))) <= MAX_BYTES;
  const omit = (key: string): void => { if (!report.omissions.includes(key)) report.omissions.push(key); };
  if (fits()) return true;
  for (const key of ['resourceUsage', 'heapStatistics', 'cpuUsage']) {
    if (report.environment[key] !== undefined) { delete report.environment[key]; omit(`${key}-size-omitted`); }
    if (fits()) return true;
  }
  const extensions = report.environment.extensions;
  if (Array.isArray(extensions)) while (extensions.length && !fits()) {
    extensions.pop(); report.environment.omittedExtensions = Number(report.environment.omittedExtensions ?? 0) + 1;
    omit('extensions-truncated');
  }
  while (report.breadcrumbs.length && !fits()) { report.breadcrumbs.shift(); omit('breadcrumbs-size-truncated'); }
  if (!fits() && report.environment.settings) { delete report.environment.settings; omit('settings-size-omitted'); }
  return fits();
}
export function postReport(url: string, body: string | Uint8Array, contentType: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const destination = new URL(url);
    const options: https.RequestOptions = {
      method: 'POST', signal, rejectUnauthorized: true,
      headers: { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) },
    };
    const request = (destination.protocol === 'https:' ? https : http).request(destination, options, response => {
      response.on('error', reject);
      response.on('end', () => {
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) resolve();
        else reject(new Error('Report rejected'));
      });
      response.resume();
    });
    const timeout = setTimeout(() => { request.destroy(new Error('Report timeout')); }, 5_000);
    request.on('close', () => clearTimeout(timeout));
    request.on('error', reject);
    request.end(body);
  });
}
