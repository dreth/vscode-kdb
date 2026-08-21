import * as crypto from 'crypto';
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
  connectionTestQueryResultIsSafe,
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
  private readonly sessionRequestSignatures = new Map<string, string>();
  private readonly desiredRequestSignatures = new Map<string, string>();
  private readonly requestGenerations = new Map<string, number>();
  private nextRequestGeneration = 0;
  private readonly credentialSignatureKey = crypto.randomBytes(32);
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
    const timeouts = this.timeoutsFor(connection);
    const requestSignature = connectionRuntimeSignature(
      connection,
      timeouts,
      connection.password,
      this.credentialSignatureKey
    );
    const requestGeneration = this.observeRequest(connectionId, requestSignature);
    const pending = this.opening.get(connectionId);
    if (pending) {
      if (this.sessionRequestSignatures.get(connectionId) !== requestSignature) {
        await this.closeConnection(connectionId);
      }
      return;
    }

    const current = this.sessionSignatures.get(connectionId);
    if (!current) {
      return;
    }
    if (this.sessionRequestSignatures.get(connectionId) === requestSignature) {
      return;
    }
    const password = await this.store.password(connectionId);
    if (!this.requestIsCurrent(connectionId, requestSignature, requestGeneration) ||
        this.sessionSignatures.get(connectionId) !== current) {
      return;
    }
    if (current !== connectionRuntimeSignature(
      connection,
      timeouts,
      password,
      this.credentialSignatureKey
    )) {
      await this.closeConnection(connectionId);
      return;
    }
    this.sessionRequestSignatures.set(connectionId, requestSignature);
  }

  public async connect(connection: KxConnection, signal?: AbortSignal): Promise<KdbIpcClient> {
    throwIfQueryCanceled(signal);
    const timeouts = this.timeoutsFor(connection);
    const requestSignature = connectionRuntimeSignature(
      connection,
      timeouts,
      connection.password,
      this.credentialSignatureKey
    );
    const requestGeneration = this.observeRequest(connection.id, requestSignature);
    const pending = this.opening.get(connection.id);
    if (pending) {
      if (this.sessionRequestSignatures.get(connection.id) !== requestSignature) {
        await this.closeConnection(connection.id);
        throwIfQueryCanceled(signal);
        if (!this.requestIsCurrent(connection.id, requestSignature, requestGeneration)) {
          throw new Error('KX connection canceled.');
        }
        return this.openConnection(
          connection,
          timeouts,
          requestSignature,
          requestGeneration,
          signal
        );
      }
      return waitForQueryCancellation(pending, signal);
    }

    const existing = this.clients.get(connection.id);
    if (existing) {
      if (this.sessionRequestSignatures.get(connection.id) === requestSignature) {
        return existing;
      }
      let password: string | undefined;
      try {
        password = await waitForQueryCancellation(this.store.password(connection.id), signal);
      } catch (error) {
        if (!(error instanceof KdbQueryCanceledError)) {
          this.writeConnectFailure(connection, error, false);
        }
        throw error;
      }
      throwIfQueryCanceled(signal);
      if (!this.requestIsCurrent(connection.id, requestSignature, requestGeneration)) {
        throw new Error('KX connection canceled.');
      }
      const newerPending = this.opening.get(connection.id);
      if (newerPending) {
        if (this.sessionRequestSignatures.get(connection.id) !== requestSignature) {
          throw new Error('KX connection canceled.');
        }
        return waitForQueryCancellation(newerPending, signal);
      }
      if (this.clients.get(connection.id) !== existing) {
        throw new Error('KX connection canceled.');
      }
      const signature = connectionRuntimeSignature(
        connection,
        timeouts,
        password,
        this.credentialSignatureKey
      );
      if (this.sessionSignatures.get(connection.id) === signature) {
        this.sessionRequestSignatures.set(connection.id, requestSignature);
        return existing;
      }
      await this.closeConnection(connection.id);
      throwIfQueryCanceled(signal);
      if (!this.requestIsCurrent(connection.id, requestSignature, requestGeneration)) {
        throw new Error('KX connection canceled.');
      }
      return this.openConnection(
        connection,
        timeouts,
        requestSignature,
        requestGeneration,
        signal
      );
    }

    return this.openConnection(
      connection,
      timeouts,
      requestSignature,
      requestGeneration,
      signal
    );
  }

  private openConnection(
    connection: KxConnection,
    timeouts: ConnectionTimeouts,
    requestSignature: string,
    requestGeneration: number,
    signal?: AbortSignal
  ): Promise<KdbIpcClient> {
    let opening!: Promise<KdbIpcClient>;
    opening = Promise.resolve().then(async () => {
      let client: KdbIpcClient | undefined;
      try {
        const password = await this.store.password(connection.id);
        if (this.opening.get(connection.id) !== opening ||
            !this.requestIsCurrent(connection.id, requestSignature, requestGeneration)) {
          throw new Error('KX connection canceled.');
        }
        const signature = connectionRuntimeSignature(
          connection,
          timeouts,
          password,
          this.credentialSignatureKey
        );
        this.sessionSignatures.set(connection.id, signature);
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
        if (this.opening.get(connection.id) !== opening ||
            this.clients.get(connection.id) !== client ||
            !this.requestIsCurrent(connection.id, requestSignature, requestGeneration)) {
          throw new Error('KX connection canceled.');
        }
        return client;
      } catch (error) {
        if (!client) {
          this.writeConnectFailure(
            connection,
            error,
            this.opening.get(connection.id) !== opening ||
              !this.requestIsCurrent(connection.id, requestSignature, requestGeneration)
          );
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
            this.sessionRequestSignatures.delete(connection.id);
          }
          this.stateEmitter.fire();
        }
      }
    });
    this.opening.set(connection.id, opening);
    this.sessionRequestSignatures.set(connection.id, requestSignature);
    return waitForQueryCancellation(opening, signal);
  }

  public async disconnect(connectionId: string): Promise<void> {
    this.invalidateRequest(connectionId);
    await this.closeConnection(connectionId);
  }

  private async closeConnection(connectionId: string): Promise<void> {
    const client = this.clients.get(connectionId);
    const opening = this.opening.get(connectionId);
    if (!client && !opening) {
      return;
    }

    this.clients.delete(connectionId);
    this.opening.delete(connectionId);
    this.sessionSignatures.delete(connectionId);
    this.sessionRequestSignatures.delete(connectionId);
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
    signal?: AbortSignal,
    shouldIssue?: () => boolean
  ): Promise<QValue> {
    return this.executePrepared(
      connection,
      qScriptInNamespace(script, connection.database),
      onIssued,
      signal,
      shouldIssue
    );
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
    signal?: AbortSignal,
    shouldIssue?: () => boolean
  ): Promise<QValue> {
    const client = await this.connect(connection, signal);
    try {
      return await client.query(query, onIssued, signal, shouldIssue);
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
      if (!connectionTestQueryResultIsSafe(result)) {
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
    this.sessionRequestSignatures.clear();
    this.desiredRequestSignatures.clear();
    this.requestGenerations.clear();
    this.credentialSignatureKey.fill(0);
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
    this.sessionRequestSignatures.delete(connectionId);
    this.stateEmitter.fire();
  }

  private observeRequest(connectionId: string, requestSignature: string): number {
    if (this.desiredRequestSignatures.get(connectionId) === requestSignature) {
      return this.requestGenerations.get(connectionId)!;
    }
    const generation = ++this.nextRequestGeneration;
    this.desiredRequestSignatures.set(connectionId, requestSignature);
    this.requestGenerations.set(connectionId, generation);
    return generation;
  }

  private requestIsCurrent(
    connectionId: string,
    requestSignature: string,
    requestGeneration: number
  ): boolean {
    return this.desiredRequestSignatures.get(connectionId) === requestSignature &&
      this.requestGenerations.get(connectionId) === requestGeneration;
  }

  private invalidateRequest(connectionId: string): void {
    this.desiredRequestSignatures.delete(connectionId);
    this.requestGenerations.delete(connectionId);
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

function connectionRuntimeSignature(
  connection: KxConnection,
  timeouts: ConnectionTimeouts,
  password: string | undefined,
  credentialSignatureKey: Buffer
): string {
  return JSON.stringify({
    host: connection.host,
    port: connection.port,
    username: connection.username,
    connectTimeoutMs: timeouts.connectTimeoutMs,
    queryTimeoutMs: timeouts.queryTimeoutMs,
    credential: password === undefined
      ? 'absent'
      : `present:${crypto.createHmac('sha256', credentialSignatureKey)
        .update(password, 'utf8')
        .digest('hex')}`,
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
