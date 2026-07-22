import {
  connectionEndpoint,
  normalizeNamespace,
  validateNamespace,
  type KxConnection,
} from './connection';

export type ConnectionTestPhase =
  | 'validation'
  | 'connect'
  | 'handshake'
  | 'namespace'
  | 'query'
  | 'cancel';

export const CONNECTION_TEST_QUERY = '0b';

export class ConnectionTestError extends Error {
  public readonly code?: string;

  public constructor(
    public readonly phase: ConnectionTestPhase,
    public readonly endpoint: string | undefined,
    cause?: unknown
  ) {
    const code = safeErrorCode(cause);
    super(connectionTestFailureMessage(phase, endpoint, code));
    this.name = 'ConnectionTestError';
    this.code = code;
  }
}

/**
 * Build a read-only namespace probe from a namespace which has already passed
 * the connection model's strict identifier validation. The expression checks
 * that the namespace resolves to a q dictionary and that resolving it does not
 * change the temporary IPC session's current namespace.
 */
export function connectionTestNamespaceQuery(namespace: string): string {
  const normalized = normalizeNamespace(namespace);
  validateNamespace(normalized);
  if (normalized === '.') {
    throw new Error('The root namespace does not require a namespace probe.');
  }
  return `(string system"d";99h=type value \`${normalized};string system"d")`;
}

export function connectionTestNamespaceResultIsSafe(value: unknown): boolean {
  return Array.isArray(value) && value.length === 3 &&
    typeof value[0] === 'string' && value[1] === true && value[2] === value[0];
}

export function connectionTestEndpoint(
  connection: Pick<KxConnection, 'host' | 'port'>
): string {
  return connectionEndpoint(connection);
}

export function connectionTestFailureMessage(
  phase: ConnectionTestPhase,
  endpoint?: string,
  code?: string
): string {
  const target = endpoint ? ` for ${endpoint}` : '';
  const suffix = code ? ` (${code})` : '';
  switch (phase) {
    case 'validation':
      return `Validation phase failed${target}. Correct the highlighted form value or check VS Code SecretStorage access and try again.`;
    case 'connect':
      return `Connect phase failed${target}. The TCP endpoint could not be reached${suffix}.`;
    case 'handshake':
      return `Handshake phase failed${target}. Check the q IPC listener and credentials${suffix}.`;
    case 'namespace':
      return `Namespace phase failed${target}. The namespace is unavailable or the temporary session namespace was not preserved${suffix}.`;
    case 'query':
      return `Query phase failed${target}. The minimal read-only q IPC request returned an unexpected response${suffix}.`;
    case 'cancel':
      return `Cancel phase: connection test canceled${target}.`;
  }
}

function safeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === 'string' && /^[A-Z0-9_-]{1,64}$/i.test(code) ? code : undefined;
}
