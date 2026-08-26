import * as vscode from 'vscode';

import { ConnectionManager } from './connection-manager';
import { ConnectionStore } from './connection-store';
import type { KxDiagnostics } from './diagnostics';
import {
  buildServerTableMetaQuery,
  parseServerColumns,
  parseServerTableNames,
  parseServerVariables,
  SERVER_TABLES_QUERY,
  SERVER_VARIABLES_QUERY,
  ServerColumnMetadata,
  ServerVariableMetadata,
  validateServerObjectIdentifier,
} from './server-explorer-model';

export const Q_METADATA_REQUEST_METHOD = 'vscode-kdb/qMetadata';
export const Q_METADATA_REFRESH_METHOD = 'vscode-kdb/qMetadataRefresh';
export const Q_METADATA_TTL_MS = 30_000;
export const Q_METADATA_TIMEOUT_MS = 5_000;
export const Q_METADATA_MAX_ROOT_ITEMS = 5_000;
export const Q_METADATA_MAX_COLUMNS = 2_000;
export const Q_METADATA_MAX_BYTES = 1_048_576;

export interface QMetadataSnapshot {
  readonly connectionId: string;
  readonly namespace: string;
  readonly generation: number;
}

export interface QMetadataRootResponse {
  readonly version: 1;
  readonly kind: 'root';
  readonly snapshot: QMetadataSnapshot;
  readonly tables: readonly string[];
  readonly variables: readonly ServerVariableMetadata[];
}

export interface QMetadataTableResponse {
  readonly version: 1;
  readonly kind: 'table';
  readonly snapshot: QMetadataSnapshot;
  readonly table: string;
  readonly columns: readonly ServerColumnMetadata[];
}

export type QMetadataResponse = QMetadataRootResponse | QMetadataTableResponse;

export type QMetadataRequest =
  | { readonly version: 1; readonly kind: 'root' }
  | { readonly version: 1; readonly kind: 'table'; readonly table: string };

interface TimedCache<T> {
  readonly expiresAt: number;
  readonly value: Promise<T | undefined>;
}

export class QMetadataService implements vscode.Disposable {
  private readonly subscriptions: vscode.Disposable[];
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly tableCache = new Map<string, TimedCache<QMetadataTableResponse>>();
  private rootCache: TimedCache<QMetadataRootResponse> | undefined;
  private lastSignature = '';
  private generation = 0;
  private disposed = false;

  public readonly onDidInvalidate = this.changed.event;

  public constructor(
    private readonly store: ConnectionStore,
    private readonly manager: ConnectionManager,
    connectionChanges?: vscode.Event<unknown>,
    private readonly diagnostics?: KxDiagnostics,
  ) {
    this.subscriptions = [
      this.manager.onDidChangeState(() => this.observeState()),
      ...(connectionChanges ? [connectionChanges(() => this.observeState())] : []),
    ];
    this.observeState();
  }

  public snapshot(): QMetadataSnapshot | undefined {
    this.observeState();
    const connection = this.store.activeConnection();
    if (!connection || !this.manager.isConnected(connection.id)) return undefined;
    return Object.freeze({
      connectionId: connection.id,
      namespace: connection.database,
      generation: this.generation,
    });
  }

  public async request(
    value: unknown,
    signal?: AbortSignal,
  ): Promise<QMetadataResponse | undefined> {
    const request = parseQMetadataRequest(value);
    return request.kind === 'root'
      ? this.root(false, signal)
      : this.table(request.table, false, signal);
  }

  public root(
    force = false,
    signal?: AbortSignal,
  ): Promise<QMetadataRootResponse | undefined> {
    if (this.disposed) return Promise.resolve(undefined);
    const snapshot = this.snapshot();
    if (!snapshot) return Promise.resolve(undefined);
    const now = Date.now();
    if (!force && this.rootCache && this.rootCache.expiresAt > now) {
      return this.rootCache.value;
    }
    if (force) this.invalidate(false);
    const current = this.snapshot();
    if (!current) return Promise.resolve(undefined);
    const value = this.loadRoot(current, signal);
    this.rootCache = { expiresAt: now + Q_METADATA_TTL_MS, value };
    void value.catch(() => {
      if (this.rootCache?.value === value) this.rootCache = undefined;
    });
    return value;
  }

  public table(
    table: unknown,
    force = false,
    signal?: AbortSignal,
  ): Promise<QMetadataTableResponse | undefined> {
    if (this.disposed) return Promise.resolve(undefined);
    const name = validateServerObjectIdentifier(table);
    if (force) this.tableCache.delete(name);
    const snapshot = this.snapshot();
    if (!snapshot) return Promise.resolve(undefined);
    const key = metadataCacheKey(snapshot, name);
    const now = Date.now();
    const cached = this.tableCache.get(key);
    if (cached && cached.expiresAt > now) return cached.value;
    const value = this.loadTable(snapshot, name, signal);
    this.tableCache.set(key, { expiresAt: now + Q_METADATA_TTL_MS, value });
    void value.catch(() => {
      if (this.tableCache.get(key)?.value === value) this.tableCache.delete(key);
    });
    return value;
  }

  public refresh(): void {
    this.invalidate(true);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.subscriptions.splice(0).forEach(value => value.dispose());
    this.invalidate(false);
    this.changed.dispose();
  }

  private async loadRoot(
    snapshot: QMetadataSnapshot,
    signal?: AbortSignal,
  ): Promise<QMetadataRootResponse | undefined> {
    const connection = this.connectionFor(snapshot);
    if (!connection) return undefined;
    const started = Date.now();
    this.writeDiagnostic(connection.id, connection.database, 'start', 'root');
    try {
      const tablesValue = await boundedMetadataWait(
        requestSignal => this.manager.executeInConfiguredNamespace(
          connection,
          SERVER_TABLES_QUERY,
          undefined,
          requestSignal
        ),
        signal
      );
      if (!this.matches(snapshot)) return undefined;
      const variablesValue = await boundedMetadataWait(
        requestSignal => this.manager.executeInConfiguredNamespace(
          connection,
          SERVER_VARIABLES_QUERY,
          undefined,
          requestSignal
        ),
        signal
      );
      if (!this.matches(snapshot)) return undefined;
      const tables = parseServerTableNames(tablesValue).names;
      const variables = parseServerVariables(variablesValue).variables;
      if (tables.length + variables.length > Q_METADATA_MAX_ROOT_ITEMS) {
        throw new Error('q metadata exceeded the root item cap.');
      }
      const response: QMetadataRootResponse = Object.freeze({
        version: 1,
        kind: 'root',
        snapshot,
        tables: Object.freeze(tables.slice()),
        variables: Object.freeze(variables.map(value => Object.freeze({ ...value }))),
      });
      assertMetadataByteLimit(response);
      this.writeDiagnostic(connection.id, connection.database, 'success', 'root', Date.now() - started);
      return response;
    } catch (error) {
      this.writeDiagnostic(connection.id, connection.database, signal?.aborted ? 'canceled' : 'failed', 'root', Date.now() - started, error);
      throw error;
    }
  }

  private async loadTable(
    snapshot: QMetadataSnapshot,
    table: string,
    signal?: AbortSignal,
  ): Promise<QMetadataTableResponse | undefined> {
    const connection = this.connectionFor(snapshot);
    if (!connection) return undefined;
    const started = Date.now();
    this.writeDiagnostic(connection.id, connection.database, 'start', 'table');
    try {
      const value = await boundedMetadataWait(
        requestSignal => this.manager.executeInConfiguredNamespace(
          connection,
          buildServerTableMetaQuery(table),
          undefined,
          requestSignal
        ),
        signal
      );
      if (!this.matches(snapshot)) return undefined;
      const columns = parseServerColumns(value);
      if (columns.length > Q_METADATA_MAX_COLUMNS) {
        throw new Error('q table metadata exceeded the column cap.');
      }
      const response: QMetadataTableResponse = Object.freeze({
        version: 1,
        kind: 'table',
        snapshot,
        table,
        columns: Object.freeze(columns.map(column => Object.freeze({ ...column }))),
      });
      assertMetadataByteLimit(response);
      this.writeDiagnostic(connection.id, connection.database, 'success', 'table', Date.now() - started);
      return response;
    } catch (error) {
      this.writeDiagnostic(connection.id, connection.database, signal?.aborted ? 'canceled' : 'failed', 'table', Date.now() - started, error);
      throw error;
    }
  }

  private connectionFor(snapshot: QMetadataSnapshot) {
    const connection = this.store.activeConnection();
    return connection && this.matches(snapshot) ? connection : undefined;
  }

  private matches(snapshot: QMetadataSnapshot): boolean {
    const current = this.snapshot();
    return !!current && current.connectionId === snapshot.connectionId &&
      current.namespace === snapshot.namespace && current.generation === snapshot.generation;
  }

  private observeState(): void {
    if (this.disposed) return;
    const connection = this.store.activeConnection();
    const signature = connection
      ? [
        connection.id,
        connection.database,
        connection.host,
        connection.port,
        connection.username,
        this.manager.isConnected(connection.id) ? 'connected' : 'disconnected',
      ].join('\u0000')
      : 'none';
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.invalidate(true);
  }

  private invalidate(notify: boolean): void {
    this.generation++;
    this.rootCache = undefined;
    this.tableCache.clear();
    if (notify && !this.disposed) this.changed.fire();
  }

  private writeDiagnostic(
    connectionId: string,
    namespace: string,
    status: 'start' | 'success' | 'failed' | 'canceled',
    operation: 'root' | 'table',
    durationMs?: number,
    error?: unknown,
  ): void {
    try {
      this.diagnostics?.event({
        phase: 'query',
        endpoint: `profile:${connectionId}`,
        status,
        durationMs,
        details: { scope: 'q-language-metadata', operation, namespace },
        error,
        includeErrorMessage: false,
      });
    } catch {
      // Metadata diagnostics are observational and must never disrupt editing.
    }
  }
}

export function parseQMetadataRequest(value: unknown): QMetadataRequest {
  if (!isRecord(value) || value.version !== 1 ||
    (value.kind !== 'root' && value.kind !== 'table')) {
    throw new Error('Invalid q metadata request.');
  }
  const keys = Object.keys(value).sort();
  if (value.kind === 'root') {
    if (keys.join(',') !== 'kind,version') throw new Error('Invalid q metadata root request.');
    return { version: 1, kind: 'root' };
  }
  if (keys.join(',') !== 'kind,table,version') throw new Error('Invalid q metadata table request.');
  return { version: 1, kind: 'table', table: validateServerObjectIdentifier(value.table) };
}

async function boundedMetadataWait<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  outer?: AbortSignal,
): Promise<T> {
  if (outer?.aborted) throw new Error('q metadata request canceled.');
  const controller = new AbortController();
  let rejectBoundary: ((reason: Error) => void) | undefined;
  const boundary = new Promise<never>((_resolve, reject) => {
    rejectBoundary = reject;
  });
  const cancel = () => {
    controller.abort();
    rejectBoundary?.(new Error('q metadata request canceled.'));
  };
  outer?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => {
    controller.abort();
    rejectBoundary?.(new Error(`q metadata request exceeded ${Q_METADATA_TIMEOUT_MS} ms.`));
  }, Q_METADATA_TIMEOUT_MS);
  try {
    return await Promise.race([operation(controller.signal), boundary]);
  } finally {
    rejectBoundary = undefined;
    clearTimeout(timer);
    outer?.removeEventListener('abort', cancel);
  }
}

function assertMetadataByteLimit(value: QMetadataResponse): void {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > Q_METADATA_MAX_BYTES) {
    throw new Error('q metadata exceeded the response byte cap.');
  }
}

function metadataCacheKey(snapshot: QMetadataSnapshot, table: string): string {
  return `${snapshot.connectionId}\u0000${snapshot.namespace}\u0000${snapshot.generation}\u0000${table}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
