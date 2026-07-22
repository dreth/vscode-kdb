export const KX_OUTPUT_CHANNEL_NAME = 'KX';
export const REDACTED_DIAGNOSTIC_VALUE = '[redacted]';

export type KxDiagnosticPhase = 'connect' | 'handshake' | 'query' | 'cancellation' | 'close';
export type KxDiagnosticStatus = 'start' | 'success' | 'failed' | 'canceled' | 'disconnected';
export type DiagnosticDetails = { [key: string]: unknown };

export interface DiagnosticOutput {
  appendLine(value: string): void;
}

export interface KxDiagnosticEvent {
  phase: KxDiagnosticPhase;
  endpoint: string;
  status: KxDiagnosticStatus;
  durationMs?: number;
  details?: DiagnosticDetails;
  error?: unknown;
  includeErrorMessage?: boolean;
  secrets?: readonly string[];
}

const SENSITIVE_DETAIL_KEY = /^(?:auth|authentication|authorization|credential|credentials|password|passwd|pwd|query|queryText|script|secret|source|statement|text|token|value)$/i;
const SENSITIVE_ASSIGNMENT = /(\b(?:auth(?:entication|orization)?|credentials?|passw(?:or)?d|pwd|secrets?|tokens?)\b\s*(?:=|:)\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]*@/gi;

export class KxDiagnostics {
  public constructor(
    private readonly output: DiagnosticOutput,
    private readonly now: () => Date = () => new Date()
  ) {}

  public event(event: KxDiagnosticEvent): void {
    const secrets = normalizedSecrets(event.secrets);
    const payload: DiagnosticDetails = {
      ...sanitizeDiagnosticDetails(event.details || {}, secrets),
      timestamp: this.now().toISOString(),
      phase: event.phase,
      // Endpoints are validated host/port values, not authentication material.
      endpoint: redactDiagnosticText(event.endpoint, secrets),
      status: event.status,
    };
    if (event.durationMs !== undefined && Number.isFinite(event.durationMs)) {
      payload.durationMs = roundMilliseconds(event.durationMs);
    }

    if (event.error !== undefined) {
      const error = toError(event.error);
      payload.errorName = error.name || 'Error';
      const code = (error as NodeJS.ErrnoException).code;
      if (code) {
        payload.errorCode = redactDiagnosticText(String(code), secrets);
      }
      if (event.includeErrorMessage) {
        payload.errorMessage = redactDiagnosticText(error.message, secrets);
      }
    }

    try {
      this.output.appendLine(JSON.stringify(payload));
    } catch {
      // Diagnostics must never disrupt extension operations.
    }
  }
}

export function sanitizeDiagnosticDetails(
  details: DiagnosticDetails,
  secrets: readonly string[] = []
): DiagnosticDetails {
  const normalized = normalizedSecrets(secrets);
  return sanitizeDiagnosticObject(details, normalized, new Set<unknown>([details]));
}

function sanitizeDiagnosticObject(
  details: DiagnosticDetails,
  secrets: readonly string[],
  seen: Set<unknown>
): DiagnosticDetails {
  const sanitized: DiagnosticDetails = {};
  for (const [key, value] of Object.entries(details)) {
    sanitized[key] = SENSITIVE_DETAIL_KEY.test(key)
      ? REDACTED_DIAGNOSTIC_VALUE
      : sanitizeDiagnosticValue(value, secrets, seen);
  }
  return sanitized;
}

export function redactDiagnosticText(value: unknown, secrets: readonly string[] = []): string {
  let text = String(value === undefined || value === null ? '' : value);
  for (const secret of normalizedSecrets(secrets)) {
    text = text.split(secret).join(REDACTED_DIAGNOSTIC_VALUE);
  }
  return text
    .replace(URL_CREDENTIALS, `$1${REDACTED_DIAGNOSTIC_VALUE}@`)
    .replace(SENSITIVE_ASSIGNMENT, `$1${REDACTED_DIAGNOSTIC_VALUE}`);
}

function sanitizeDiagnosticValue(
  value: unknown,
  secrets: readonly string[],
  seen: Set<unknown>
): unknown {
  if (typeof value === 'string') {
    return redactDiagnosticText(value, secrets);
  }
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return '[circular]';
    }
    seen.add(value);
    const sanitized = value.map(item => sanitizeDiagnosticValue(item, secrets, seen));
    seen.delete(value);
    return sanitized;
  }
  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[circular]';
    }
    seen.add(value);
    const sanitized = sanitizeDiagnosticObject(value as DiagnosticDetails, secrets, seen);
    seen.delete(value);
    return sanitized;
  }
  return String(value);
}

function normalizedSecrets(secrets: readonly string[] | undefined): string[] {
  return Array.from(new Set((secrets || [])
    .map(value => String(value || ''))
    .filter(Boolean)))
    .sort((left, right) => right.length - left.length);
}

function roundMilliseconds(value: number): number {
  return Math.round(Math.max(0, value) * 1000) / 1000;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
