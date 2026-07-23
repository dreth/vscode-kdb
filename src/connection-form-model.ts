import {
  ConnectionValidationError,
  KxConnection,
  parseOptionalTimeout,
  validateConnection,
  validatePassword,
} from './connection';

export type ConnectionFormField =
  | 'name'
  | 'host'
  | 'port'
  | 'database'
  | 'username'
  | 'password'
  | 'connectTimeoutMs'
  | 'queryTimeoutMs';

export type ConnectionFormMode = 'add' | 'edit';

export interface ConnectionFormParseOptions {
  id: string;
  existingConnections: readonly KxConnection[];
  editing?: KxConnection;
  hasStoredPassword: boolean;
}

export interface ParsedConnectionForm {
  connection: KxConnection;
  passwordUpdate: string | null | undefined;
}

export class ConnectionFormValidationError extends Error {
  public constructor(
    message: string,
    public readonly field?: ConnectionFormField
  ) {
    super(message);
    this.name = 'ConnectionFormValidationError';
  }
}

const FORM_FIELDS = new Set([
  'name',
  'host',
  'port',
  'database',
  'username',
  'password',
  'clearPassword',
  'connectTimeoutMs',
  'queryTimeoutMs',
]);

export function parseConnectionFormPayload(
  payload: unknown,
  options: ConnectionFormParseOptions
): ParsedConnectionForm {
  if (!isRecord(payload)) {
    throw new ConnectionFormValidationError('The connection form submission is invalid.');
  }
  for (const key of Object.keys(payload)) {
    if (!FORM_FIELDS.has(key)) {
      throw new ConnectionFormValidationError('The connection form submission contains an unsupported field.');
    }
  }

  const name = requiredString(payload, 'name');
  const host = requiredString(payload, 'host');
  const portText = requiredString(payload, 'port');
  const database = requiredString(payload, 'database');
  const username = requiredString(payload, 'username');
  const password = requiredString(payload, 'password');
  const connectTimeoutText = requiredString(payload, 'connectTimeoutMs');
  const queryTimeoutText = requiredString(payload, 'queryTimeoutMs');
  if (!Object.prototype.hasOwnProperty.call(payload, 'clearPassword') ||
      typeof payload.clearPassword !== 'boolean') {
    throw new ConnectionFormValidationError('Clear saved password must be a true or false value.', 'password');
  }

  const normalizedPort = portText.trim();
  if (!/^\d+$/.test(normalizedPort)) {
    throw new ConnectionFormValidationError('Port must be an integer from 1 to 65535.', 'port');
  }

  let connectTimeoutMs: number | undefined;
  let queryTimeoutMs: number | undefined;
  try {
    connectTimeoutMs = parseOptionalTimeout(connectTimeoutText, 'Connect / handshake timeout');
  } catch (error) {
    throw formError(error, 'connectTimeoutMs');
  }
  try {
    queryTimeoutMs = parseOptionalTimeout(queryTimeoutText, 'Query timeout');
  } catch (error) {
    throw formError(error, 'queryTimeoutMs');
  }

  const candidate = {
    id: options.id,
    name,
    host,
    port: Number(normalizedPort),
    database,
    username,
    connectTimeoutMs,
    queryTimeoutMs,
  };
  let connection: KxConnection;
  try {
    connection = validateConnection(
      candidate,
      options.existingConnections,
      options.editing && options.editing.id
    );
  } catch (error) {
    throw formError(error, validationField(error));
  }

  return {
    connection,
    passwordUpdate: passwordUpdateForForm(
      options.editing ? 'edit' : 'add',
      password,
      payload.clearPassword,
      options.hasStoredPassword
    ),
  };
}

export function passwordUpdateForForm(
  mode: ConnectionFormMode,
  password: string,
  clearPassword: boolean,
  hasStoredPassword: boolean
): string | null | undefined {
  try {
    validatePassword(password);
  } catch (error) {
    throw formError(error, 'password');
  }
  if (password && clearPassword) {
    throw new ConnectionFormValidationError('Enter a new password or clear the saved password, not both.', 'password');
  }
  if (clearPassword) {
    if (mode !== 'edit' || !hasStoredPassword) {
      throw new ConnectionFormValidationError('There is no saved password to clear.', 'password');
    }
    return null;
  }
  if (password) {
    return password;
  }
  return undefined;
}

function requiredString(
  payload: Record<string, unknown>,
  field: ConnectionFormField
): string {
  const value = payload[field];
  if (!Object.prototype.hasOwnProperty.call(payload, field) || typeof value !== 'string') {
    throw new ConnectionFormValidationError(`The ${field} form value is invalid.`, field);
  }
  return value;
}

function validationField(error: unknown): ConnectionFormField | undefined {
  const message = error instanceof Error ? error.message : '';
  if (/connection name|connection named/i.test(message)) {
    return 'name';
  }
  if (/host/i.test(message)) {
    return 'host';
  }
  if (/port/i.test(message)) {
    return 'port';
  }
  if (/namespace/i.test(message)) {
    return 'database';
  }
  if (/username/i.test(message)) {
    return 'username';
  }
  if (/connect \/ handshake timeout/i.test(message)) {
    return 'connectTimeoutMs';
  }
  if (/query timeout/i.test(message)) {
    return 'queryTimeoutMs';
  }
  return undefined;
}

function formError(error: unknown, field?: ConnectionFormField): ConnectionFormValidationError {
  if (error instanceof ConnectionFormValidationError) {
    return error;
  }
  const message = error instanceof ConnectionValidationError || error instanceof Error
    ? error.message
    : String(error);
  return new ConnectionFormValidationError(message, field);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
