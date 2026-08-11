import * as vscode from 'vscode';
import {
  ConnectionTimeouts,
  connectionEndpoint,
  DEFAULT_CONNECTION_TIMEOUT_MS,
  DEFAULT_QUERY_TIMEOUT_MS,
  KxConnection,
  qScriptInNamespace,
  queryInNamespace,
  queryInNamespaceStrict,
  resolveConnectionTimeouts,
  safeTimeoutMs,
} from './connection';
import {
  CONNECTION_TEST_QUERY,
  ConnectionTestError,
  ConnectionTestPhase,
  connectionTestEndpoint,
  connectionTestNamespaceQuery,
  connectionTestNamespaceResultIsSafe,
} from './connection-test';
import { ConnectionStore } from './connection-store';
import type { KxDiagnostics } from './diagnostics';
import {
  KdbIpcClient,
  KdbIpcError,
  KdbQError,
  KdbQueryCanceledError,
  QValue,
} from './q-ipc';

export interface TemporaryConnectionTestOptions {
  password?: string;
  signal?: AbortSignal;
  onPhase?: (phase: Exclude<ConnectionTestPhase, 'validation' | 'cancel'>) => void;
}

export class ConnectionManager implements vscode.Disposable {
  private readonly clients = new Map<string, KdbIpcClient>();
  private readonly opening = new Map<string, Promise<KdbIpcClient>>();
  private readonly sessionSignatures = new Map<string, string>();
  private readonly stateEmitter = new vscode.EventEmitter<void>();

  public readonly onDidChangeState = this.stateEmitter.event;

  public constructor(
    private readonly store: ConnectionStore,
    private readonly diagnostics?: KxDiagnostics
  ) {}

  public isConnected(connectionId: string): boolean {
    return this.clients.has(connectionId) && !this.opening.has(connectionId);
  }

  public globalTimeouts(): ConnectionTimeouts {
    const configuration = vscode.workspace.getConfiguration('vscode-kdb');
    const connectTimeoutMs = safeTimeoutMs(
      configuration.get<unknown>('connectionTimeoutMs'),
      DEFAULT_CONNECTION_TIMEOUT_MS
    );
    const queryTimeoutMs = safeTimeoutMs(
      configuration.get<unknown>('queryTimeoutMs'),
      DEFAULT_QUERY_TIMEOUT_MS
    );
    return { connectTimeoutMs, queryTimeoutMs };
  }

  public timeoutsFor(connection: KxConnection): ConnectionTimeouts {
    return resolveConnectionTimeouts(connection, this.globalTimeouts());
  }

  public async disconnectIfConfigurationChanged(
    connectionId: string,
    connection?: KxConnection
  ): Promise<void> {
    if (!connection) {
      return this.disconnect(connectionId);
    }
    const current = this.sessionSignatures.get(connectionId);
    if (current && current !== connectionRuntimeSignature(connection, this.timeoutsFor(connection))) {
      await this.disconnect(connectionId);
    }
  }

  public async connect(connection: KxConnection, signal?: AbortSignal): Promise<KdbIpcClient> {
    throwIfQueryCanceled(signal);
    const timeouts = this.timeoutsFor(connection);
    const signature = connectionRuntimeSignature(connection, timeouts);
    let pending = this.opening.get(connection.id);
    let existing = this.clients.get(connection.id);
    if ((pending || existing) && this.sessionSignatures.get(connection.id) !== signature) {
      await this.disconnect(connection.id);
      throwIfQueryCanceled(signal);
      pending = this.opening.get(connection.id);
      existing = this.clients.get(connection.id);
    }
    if (pending) {
      return waitForQueryCancellation(pending, signal);
    }
    if (existing) {
      return existing;
    }

    let opening!: Promise<KdbIpcClient>;
    opening = (async () => {
      let client: KdbIpcClient | undefined;
      try {
        const password = await this.store.password(connection.id);
        if (this.opening.get(connection.id) !== opening) {
          throw new Error('KX connection canceled.');
        }
        client = new KdbIpcClient({
          host: connection.host,
          port: connection.port,
          username: connection.username,
          password,
          connectTimeoutMs: timeouts.connectTimeoutMs,
          queryTimeoutMs: timeouts.queryTimeoutMs,
          onDidClose: () => client && this.dropClient(connection.id, client),
          diagnostics: this.diagnostics,
        });
        this.clients.set(connection.id, client);
        await client.connect();
        return client;
      } catch (error) {
        if (!client) {
          this.writeConnectFailure(connection, error, this.opening.get(connection.id) !== opening);
        }
        if (client) {
          const shouldCancel = this.clients.get(connection.id) === client;
          this.dropClient(connection.id, client);
          if (shouldCancel) {
            client.cancel(toError(error));
          }
        }
        throw error;
      } finally {
        if (this.opening.get(connection.id) === opening) {
          this.opening.delete(connection.id);
          if (!this.clients.has(connection.id)) {
            this.sessionSignatures.delete(connection.id);
          }
          this.stateEmitter.fire();
        }
      }
    })();
    this.opening.set(connection.id, opening);
    this.sessionSignatures.set(connection.id, signature);
    return waitForQueryCancellation(opening, signal);
  }

  public async disconnect(connectionId: string): Promise<void> {
    const client = this.clients.get(connectionId);
    const opening = this.opening.get(connectionId);
    if (!client && !opening) {
      return;
    }

    this.clients.delete(connectionId);
    this.opening.delete(connectionId);
    this.sessionSignatures.delete(connectionId);
    this.stateEmitter.fire();

    if (opening) {
      client && client.cancel(new Error('KX connection canceled.'));
      await opening.catch(() => undefined);
      return;
    }
    await client!.close();
  }

  public async execute(
    connection: KxConnection,
    query: string,
    onIssued?: () => void,
    signal?: AbortSignal
  ): Promise<QValue> {
    return this.executePrepared(connection, queryInNamespace(query, connection.database), onIssued, signal);
  }

  public async executeScript(
    connection: KxConnection,
    script: string,
    onIssued?: () => void,
    signal?: AbortSignal
  ): Promise<QValue> {
    return this.executePrepared(connection, qScriptInNamespace(script, connection.database), onIssued, signal);
  }

  public async executeInConfiguredNamespace(
    connection: KxConnection,
    query: string,
    onIssued?: () => void,
    signal?: AbortSignal
  ): Promise<QValue> {
    return this.executePrepared(
      connection,
      queryInNamespaceStrict(query, connection.database),
      onIssued,
      signal
    );
  }

  private async executePrepared(
    connection: KxConnection,
    query: string,
    onIssued?: () => void,
    signal?: AbortSignal
  ): Promise<QValue> {
    const client = await this.connect(connection, signal);
    try {
      return await client.query(query, onIssued, signal);
    } catch (error) {
      if (!(error instanceof KdbQError) && !(error instanceof KdbQueryCanceledError)) {
        const shouldCancel = this.clients.get(connection.id) === client;
        this.dropClient(connection.id, client);
        if (shouldCancel) {
          client.cancel(toError(error));
        }
      }
      throw error;
    }
  }

  public async test(connection: KxConnection): Promise<void> {
    let password: string | undefined;
    try {
      password = await this.store.password(connection.id);
    } catch (error) {
      this.writeConnectFailure(connection, error, false);
      throw error;
    }
    await this.testTemporary(connection, { password });
  }

  public async testTemporary(
    connection: KxConnection,
    options: TemporaryConnectionTestOptions = {}
  ): Promise<ConnectionTimeouts> {
    const endpoint = connectionTestEndpoint(connection);
    const timeouts = this.timeoutsFor(connection);
    let currentPhase: Exclude<ConnectionTestPhase, 'validation' | 'cancel'> = 'connect';
    let operationFailed = true;
    const reportPhase = (phase: Exclude<ConnectionTestPhase, 'validation' | 'cancel'>): void => {
      currentPhase = phase;
      try {
        options.onPhase?.(phase);
      } catch {
        // UI progress observers must never disrupt a temporary IPC test.
      }
    };
    const client = new KdbIpcClient({
      host: connection.host,
      port: connection.port,
      username: connection.username,
      password: options.password,
      connectTimeoutMs: timeouts.connectTimeoutMs,
      queryTimeoutMs: timeouts.queryTimeoutMs,
      diagnostics: this.diagnostics,
      onDidPhase: (phase, status) => {
        if (status === 'start' && (phase === 'connect' || phase === 'handshake')) {
          reportPhase(phase);
        }
      },
    });
    const cancel = (): void => {
      client.cancel(new Error('KX connection test canceled.'));
    };
    options.signal?.addEventListener('abort', cancel, { once: true });
    try {
      if (options.signal?.aborted) {
        throw new ConnectionTestError('cancel', endpoint);
      }
      await client.connect();
      if (connection.database !== '.') {
        reportPhase('namespace');
        const namespaceResult = await client.query(connectionTestNamespaceQuery(connection.database));
        if (!connectionTestNamespaceResultIsSafe(namespaceResult)) {
          throw new ConnectionTestError('namespace', endpoint);
        }
      }
      reportPhase('query');
      const result = await client.query(CONNECTION_TEST_QUERY);
      if (result !== false) {
        throw new ConnectionTestError('query', endpoint);
      }
      operationFailed = false;
      return timeouts;
    } catch (error) {
      if (error instanceof ConnectionTestError) {
        throw error;
      }
      if (options.signal?.aborted) {
        throw new ConnectionTestError('cancel', endpoint);
      }
      const phase = (currentPhase === 'connect' || currentPhase === 'handshake') &&
        error instanceof KdbIpcError &&
        (error.phase === 'connect' || error.phase === 'handshake')
        ? error.phase
        : currentPhase;
      throw new ConnectionTestError(phase, endpoint, error);
    } finally {
      options.signal?.removeEventListener('abort', cancel);
      try {
        await client.close();
      } catch (error) {
        try {
          client.cancel(new Error('KX connection test cleanup canceled.'));
        } catch {
          // The temporary transport is already unusable.
        }
        if (!operationFailed) {
          throw new ConnectionTestError('cancel', endpoint, error);
        }
      }
    }
  }

  public async disconnectAll(): Promise<void> {
    const ids = Array.from(new Set([...this.clients.keys(), ...this.opening.keys()]));
    await Promise.all(ids.map(id => this.disconnect(id).catch(() => undefined)));
  }

  public dispose(): void {
    const clients = Array.from(this.clients.values());
    this.clients.clear();
    this.opening.clear();
    this.sessionSignatures.clear();
    clients.forEach(client => client.cancel(new Error('KX extension deactivated.')));
    this.stateEmitter.dispose();
  }

  private dropClient(connectionId: string, client: KdbIpcClient): void {
    if (this.clients.get(connectionId) !== client) {
      return;
    }
    this.clients.delete(connectionId);
    this.opening.delete(connectionId);
    this.sessionSignatures.delete(connectionId);
    this.stateEmitter.fire();
  }

  private writeConnectFailure(connection: KxConnection, error: unknown, canceled: boolean): void {
    try {
      this.diagnostics?.event({
        phase: 'connect',
        endpoint: connectionEndpoint(connection),
        status: canceled ? 'canceled' : 'failed',
        details: { stage: 'credentials' },
        error,
        includeErrorMessage: false,
      });
    } catch {
      // Diagnostics must never disrupt connection state cleanup.
    }
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function connectionRuntimeSignature(connection: KxConnection, timeouts: ConnectionTimeouts): string {
  return JSON.stringify({
    host: connection.host,
    port: connection.port,
    username: connection.username,
    connectTimeoutMs: timeouts.connectTimeoutMs,
    queryTimeoutMs: timeouts.queryTimeoutMs,
  });
}

function throwIfQueryCanceled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new KdbQueryCanceledError();
  }
}

function waitForQueryCancellation<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return operation;
  }
  if (signal.aborted) {
    void operation.catch(() => undefined);
    return Promise.reject(new KdbQueryCanceledError());
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      signal.removeEventListener('abort', onAbort);
    };
    const finish = (action: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      action();
    };
    const onAbort = (): void => {
      finish(() => reject(new KdbQueryCanceledError()));
    };

    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
    }
    operation.then(
      value => finish(() => resolve(value)),
      error => finish(() => reject(error))
    );
  });
}
