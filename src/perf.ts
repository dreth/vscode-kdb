import { sanitizeDiagnosticDetails } from './diagnostics';

export const PERF_PREFIX = '[vscode-kdb:perf]';

export type PerfDetails = { [key: string]: unknown };

export interface PerfSpan {
  readonly event: string;
  readonly startMs: number;
  readonly details?: PerfDetails;
}

interface VscodeLike {
  workspace?: {
    getConfiguration(section?: string): {
      get<T>(key: string, defaultValue: T): T;
    };
  };
}

let configuredTraceEnabled: boolean | undefined;
let configuredOutput: ((value: string) => void) | undefined;
let cachedConfigTraceEnabled = false;
let cachedConfigCheckedMs = 0;

export function configurePerfTrace(enabled: boolean | undefined): void {
  configuredTraceEnabled = enabled;
}

export function configurePerfOutput(output: ((value: string) => void) | undefined): void {
  configuredOutput = output;
}

export function isPerfTraceEnabled(): boolean {
  if (process.env.VSCODE_KDB_PERF === '1') {
    return true;
  }
  if (configuredTraceEnabled !== undefined) {
    return configuredTraceEnabled;
  }
  return vscodeTraceEnabled();
}

export function perfMark(event: string, details?: PerfDetails): void {
  if (!isPerfTraceEnabled()) {
    return;
  }
  writePerfEvent(event, details);
}

export function perfSpan(event: string, details?: PerfDetails): PerfSpan | null {
  if (!isPerfTraceEnabled()) {
    return null;
  }
  return {
    event,
    startMs: nowMs(),
    details,
  };
}

export function endPerfSpan(span: PerfSpan | null | undefined, details?: PerfDetails): void {
  if (!span) {
    return;
  }
  writePerfEvent(
    span.event,
    {
      ...(span.details || {}),
      ...(details || {}),
    },
    nowMs() - span.startMs
  );
}

function writePerfEvent(event: string, details?: PerfDetails, durationMs?: number): void {
  const payload: {
    event: string;
    timestamp: string;
    durationMs?: number;
    memory: NodeJS.MemoryUsage;
    details: PerfDetails;
  } = {
    event,
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
    details: sanitizeDiagnosticDetails(details || {}),
  };
  if (durationMs !== undefined) {
    payload.durationMs = Math.round(durationMs * 1000) / 1000;
  }
  const serialized = JSON.stringify(payload);
  console.log(PERF_PREFIX, serialized);
  if (configuredOutput) {
    try {
      configuredOutput(`${PERF_PREFIX} ${serialized}`);
    } catch {
      // Diagnostics must never disrupt extension operations.
    }
  }
}

function vscodeTraceEnabled(): boolean {
  const currentMs = Date.now();
  if (currentMs - cachedConfigCheckedMs < 1000) {
    return cachedConfigTraceEnabled;
  }

  cachedConfigCheckedMs = currentMs;
  cachedConfigTraceEnabled = false;
  try {
    const vscode = require('vscode') as VscodeLike;
    const config = vscode.workspace && vscode.workspace.getConfiguration('vscode-kdb.performance');
    cachedConfigTraceEnabled = !!(config && config.get<boolean>('trace', false));
  } catch {
    cachedConfigTraceEnabled = false;
  }
  return cachedConfigTraceEnabled;
}

function nowMs(): number {
  const time = process.hrtime();
  return time[0] * 1000 + time[1] / 1000000;
}
