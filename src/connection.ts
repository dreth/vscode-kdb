import { isIP } from 'net';

export const DEFAULT_HOST = 'localhost';
export const DEFAULT_PORT = 5000;
export const DEFAULT_NAMESPACE = '.';
export const DEFAULT_CONNECTION_TIMEOUT_MS = 30000;
export const DEFAULT_QUERY_TIMEOUT_MS = 1800000;
export const MAX_TIMEOUT_MS = 2147483647;
export const MAX_PASSWORD_LENGTH = 65535;

export interface KxConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  connectTimeoutMs?: number;
  queryTimeoutMs?: number;
}

export interface ConnectionCandidate {
  id?: unknown;
  name?: unknown;
  host?: unknown;
  port?: unknown;
  database?: unknown;
  username?: unknown;
  connectTimeoutMs?: unknown;
  queryTimeoutMs?: unknown;
}

export interface ConnectionTimeouts {
  connectTimeoutMs: number;
  queryTimeoutMs: number;
}

export class ConnectionValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ConnectionValidationError';
  }
}

export function normalizeHost(value: unknown): string {
  const host = String(value === undefined || value === null ? '' : value).trim();
  if (host.startsWith('[') && host.endsWith(']')) {
    const inner = host.slice(1, -1).trim();
    return isIP(inner) === 6 ? inner : host;
  }
  return host;
}

export function normalizeNamespace(value: unknown): string {
  const namespace = String(value === undefined || value === null ? '' : value).trim();
  if (!namespace || namespace === '.') {
    return DEFAULT_NAMESPACE;
  }
  return namespace.startsWith('.') ? namespace : `.${namespace}`;
}

export function normalizeConnection(candidate: ConnectionCandidate): KxConnection {
  const connection: KxConnection = {
    id: String(candidate.id === undefined || candidate.id === null ? '' : candidate.id).trim(),
    name: String(candidate.name === undefined || candidate.name === null ? '' : candidate.name).trim(),
    host: normalizeHost(candidate.host),
    port: Number(candidate.port),
    database: normalizeNamespace(candidate.database),
    username: String(candidate.username === undefined || candidate.username === null ? '' : candidate.username).trim(),
  };
  const connectTimeoutMs = normalizeOptionalTimeout(candidate.connectTimeoutMs);
  const queryTimeoutMs = normalizeOptionalTimeout(candidate.queryTimeoutMs);
  if (connectTimeoutMs !== undefined) {
    connection.connectTimeoutMs = connectTimeoutMs;
  }
  if (queryTimeoutMs !== undefined) {
    connection.queryTimeoutMs = queryTimeoutMs;
  }
  return connection;
}

export function validateConnection(
  candidate: ConnectionCandidate,
  existing: readonly KxConnection[] = [],
  editingId?: string
): KxConnection {
  const connection = normalizeConnection(candidate);

  if (!connection.id) {
    throw new ConnectionValidationError('Connection ID is required.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(connection.id)) {
    throw new ConnectionValidationError('Connection ID contains unsupported characters.');
  }
  if (!editingId && existing.some(item => item.id === connection.id)) {
    throw new ConnectionValidationError(`A connection with ID "${connection.id}" already exists.`);
  }
  if (!connection.name) {
    throw new ConnectionValidationError('Connection name is required.');
  }
  if (connection.name.length > 100) {
    throw new ConnectionValidationError('Connection name must be 100 characters or fewer.');
  }
  if (/[\0\r\n]/.test(connection.name)) {
    throw new ConnectionValidationError('Connection name cannot contain line breaks or null characters.');
  }
  if (existing.some(item => item.id !== editingId && item.name.toLocaleLowerCase() === connection.name.toLocaleLowerCase())) {
    throw new ConnectionValidationError(`A connection named "${connection.name}" already exists.`);
  }
  validateHost(connection.host);
  validatePort(connection.port);
  validateNamespace(connection.database);
  if (connection.username.length > 256) {
    throw new ConnectionValidationError('Username must be 256 characters or fewer.');
  }
  if (/[\0\r\n:]/.test(connection.username)) {
    throw new ConnectionValidationError('Username cannot contain colons, line breaks, or null characters.');
  }
  validateOptionalTimeout(connection.connectTimeoutMs, 'Connect / handshake timeout');
  validateOptionalTimeout(connection.queryTimeoutMs, 'Query response timeout');

  return connection;
}

export function parseOptionalTimeout(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
    return undefined;
  }
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) {
    throw new ConnectionValidationError(`${label} must be a whole number from 0 to ${MAX_TIMEOUT_MS}, or blank to inherit.`);
  }
  const timeout = typeof value === 'number' ? value : Number(value);
  validateOptionalTimeout(timeout, label);
  return timeout;
}

export function validateOptionalTimeout(timeout: number | undefined, label: string): void {
  if (timeout === undefined) {
    return;
  }
  if (!Number.isInteger(timeout) || timeout < 0 || timeout > MAX_TIMEOUT_MS) {
    throw new ConnectionValidationError(`${label} must be a whole number from 0 to ${MAX_TIMEOUT_MS}, or blank to inherit.`);
  }
}

export function validatePassword(password: string): void {
  if (password.includes('\0')) {
    throw new ConnectionValidationError('Password cannot contain null characters.');
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new ConnectionValidationError(
      `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer.`
    );
  }
}

export function safeTimeoutMs(value: unknown, fallback: number): number {
  const safeFallback = isValidTimeout(fallback) ? fallback : DEFAULT_CONNECTION_TIMEOUT_MS;
  return isValidTimeout(value)
    ? value
    : safeFallback;
}

export function resolveConnectionTimeouts(
  connection: Pick<KxConnection, 'connectTimeoutMs' | 'queryTimeoutMs'>,
  globalTimeouts: ConnectionTimeouts
): ConnectionTimeouts {
  const globalConnectTimeoutMs = safeTimeoutMs(
    globalTimeouts.connectTimeoutMs,
    DEFAULT_CONNECTION_TIMEOUT_MS
  );
  const globalQueryTimeoutMs = safeTimeoutMs(
    globalTimeouts.queryTimeoutMs,
    DEFAULT_QUERY_TIMEOUT_MS
  );
  return {
    connectTimeoutMs: safeTimeoutMs(connection.connectTimeoutMs, globalConnectTimeoutMs),
    queryTimeoutMs: safeTimeoutMs(connection.queryTimeoutMs, globalQueryTimeoutMs),
  };
}

export function connectionSessionChanged(
  previous: KxConnection,
  next: KxConnection,
  passwordChanged = false
): boolean {
  return passwordChanged || previous.host !== next.host || previous.port !== next.port ||
    previous.username !== next.username || previous.connectTimeoutMs !== next.connectTimeoutMs ||
    previous.queryTimeoutMs !== next.queryTimeoutMs;
}

export function validateHost(host: string): void {
  if (!host) {
    throw new ConnectionValidationError('Host is required.');
  }
  if (host.length > 253) {
    throw new ConnectionValidationError('Host must be 253 characters or fewer.');
  }
  if (/\s/.test(host)) {
    throw new ConnectionValidationError('Host cannot contain whitespace.');
  }
  if (isIP(host)) {
    return;
  }
  if (host.includes(':') || host.includes('/') || host.includes('\\') || host.includes('\0')) {
    throw new ConnectionValidationError('Enter a host name or IP address without a URL scheme or path.');
  }

  const dnsName = host.endsWith('.') ? host.slice(0, -1) : host;
  if (!dnsName || /^\d+(?:\.\d+){3}$/.test(dnsName)) {
    throw new ConnectionValidationError('Enter a valid host name, IPv4 address, or IPv6 address.');
  }
  const validDnsLabel = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
  if (!dnsName.split('.').every(label => validDnsLabel.test(label))) {
    throw new ConnectionValidationError('Host names may contain only letters, digits, dots, and non-edge hyphens.');
  }
}

export function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConnectionValidationError('Port must be an integer from 1 to 65535.');
  }
}

export function validateNamespace(namespace: string): void {
  if (namespace === '.') {
    return;
  }
  if (namespace.length > 512) {
    throw new ConnectionValidationError('Namespace must be 512 characters or fewer.');
  }
  if (!/^\.[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(namespace)) {
    throw new ConnectionValidationError('Namespace must be "." or dot-separated q identifiers such as .app or .app.data.');
  }
}

export function safeStoredConnections(value: unknown): KxConnection[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const connections: KxConnection[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }
    try {
      connections.push(validateConnection(candidate as ConnectionCandidate, connections));
    } catch {
      // Invalid user-edited settings are ignored. Commands surface validation before writing.
    }
  }
  return connections;
}

function normalizeOptionalTimeout(value: unknown): number | undefined {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
    return undefined;
  }
  return typeof value === 'number' ? value : Number(value);
}

function isValidTimeout(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_TIMEOUT_MS;
}

export function qString(value: unknown): string {
  const text = String(value === undefined || value === null ? '' : value);
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

export function queryInNamespace(query: string, namespace?: string): string {
  const normalized = normalizeNamespace(namespace);
  if (normalized === '.') {
    return query;
  }

  return queryInNamespaceStrict(query, normalized);
}

export function queryInNamespaceStrict(query: string, namespace?: string): string {
  const normalized = normalizeNamespace(namespace);

  return `{[ns;src]
  src:$[-10h=type src;enlist src;src];
  previous:string system "d";
  system "d ",ns;
  outcome:@[{(1b;value x)};src;{(0b;x)}];
  system "d ",previous;
  if[not first outcome;'last outcome];
  last outcome
}[${qString(normalized)};${qString(query)}]`;
}

// Mirror q's physical script-line grouping on the client so complete source can
// use ordinary `value` without requiring a newer runtime helper.
export function qScriptGroups(script: string): string[] {
  const lines = script
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');
  if (lines[0]?.startsWith('#!')) {
    lines.shift();
  }
  const groups: string[] = [];
  let current: string[] | undefined;
  let pending: string[] = [];
  let blockCommentDepth = 0;

  const flushCurrent = (): void => {
    if (current) {
      groups.push(current.join('\n'));
      current = undefined;
    }
  };
  const flushPending = (): void => {
    groups.push(...pending);
    pending = [];
  };

  for (const originalLine of lines) {
    const line = normalizeQScriptIndent(originalLine);

    if (blockCommentDepth > 0) {
      if (/^\/[ \t]*$/.test(line)) {
        groups.push('/');
        blockCommentDepth += 1;
        continue;
      }
      if (/^\\[ \t]*$/.test(line)) {
        groups.push('/');
        blockCommentDepth -= 1;
      } else {
        groups.push(/^[ \t]*$/.test(line) ? '/' : `/${line}`);
      }
      continue;
    }

    if (/^\/[ \t]*$/.test(line)) {
      flushCurrent();
      flushPending();
      groups.push('/');
      blockCommentDepth = 1;
      continue;
    }

    // A singleton backslash outside a block comment starts q's trailing
    // script comment, so the remaining physical lines are not executable.
    if (/^\\[ \t]*$/.test(line)) {
      flushCurrent();
      flushPending();
      break;
    }

    const blank = /^[ \t]*$/.test(line);
    const topLevelLineComment = line.startsWith('/');
    if (blank || topLevelLineComment) {
      pending.push(blank ? '' : line);
      continue;
    }

    if (/^[ \t]/.test(line)) {
      if (current) {
        current.push(...pending, line);
      }
      pending = [];
      continue;
    }

    flushCurrent();
    flushPending();
    current = [line];
  }

  flushCurrent();
  flushPending();
  return groups;
}

export function qScriptInNamespace(script: string, namespace?: string): string {
  const normalized = normalizeNamespace(namespace);
  const groups = qScriptGroups(script);
  return `{[ns;groups]
  previous:string system "d";
  system "d ",ns;
  outcome:@[{[groups]
    result:$[count groups;{[unused;expression]
      value $[-10h=type expression;enlist expression;expression]
    }/[::;groups];::];
    (1b;result)
  };groups;{(0b;x)}];
  system "d ",previous;
  if[not first outcome;'last outcome];
  last outcome
}[${qString(normalized)};${qStringList(groups)}]`;
}

export function connectionEndpoint(connection: Pick<KxConnection, 'host' | 'port'>): string {
  const host = connection.host.includes(':') ? `[${connection.host}]` : connection.host;
  return `${host}:${connection.port}`;
}

function normalizeQScriptIndent(line: string): string {
  const leading = /^[ \t]*/.exec(line)?.[0] ?? '';
  return leading.replace(/\t/g, ' ') + line.slice(leading.length);
}

function qStringList(values: readonly string[]): string {
  if (values.length === 0) {
    return '()';
  }
  if (values.length === 1) {
    return `enlist ${qString(values[0])}`;
  }
  return `(${values.map(qString).join(';')})`;
}
