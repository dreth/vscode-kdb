import * as vscode from 'vscode';
import { connectionEndpoint, KxConnection, qScriptInNamespace, queryInNamespace } from './connection';
import { ConnectionStore } from './connection-store';
import type { KxDiagnostics } from './diagnostics';
import { KdbIpcClient, KdbQError, QValue } from './q-ipc';

const DEFAULT_CONNECTION_TIMEOUT_MS = 30000;

export class ConnectionManager implements vscode.Disposable {
  private readonly clients = new Map<string, KdbIpcClient>();
  private readonly opening = new Map<string, Promise<KdbIpcClient>>();
  private readonly stateEmitter = new vscode.EventEmitter<void>();

  public readonly onDidChangeState = this.stateEmitter.event;

  public constructor(
    private readonly store: ConnectionStore,
    private readonly diagnostics?: KxDiagnostics
  ) {}

  public isConnected(connectionId: string): boolean {
    return this.clients.has(connectionId) && !this.opening.has(connectionId);
  }

  public async connect(connection: KxConnection): Promise<KdbIpcClient> {
    const pending = this.opening.get(connection.id);
    if (pending) {
      return pending;
    }
    const existing = this.clients.get(connection.id);
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
          timeoutMs: this.connectionTimeoutMs(),
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
          this.stateEmitter.fire();
        }
      }
    })();
    this.opening.set(connection.id, opening);
    return opening;
  }

  public async disconnect(connectionId: string): Promise<void> {
    const client = this.clients.get(connectionId);
    const opening = this.opening.get(connectionId);
    if (!client && !opening) {
      return;
    }

    this.clients.delete(connectionId);
    this.opening.delete(connectionId);
    this.stateEmitter.fire();

    if (opening) {
      client && client.cancel(new Error('KX connection canceled.'));
      await opening.catch(() => undefined);
      return;
    }
    await client!.close();
  }

  public async execute(connection: KxConnection, query: string): Promise<QValue> {
    return this.executePrepared(connection, queryInNamespace(query, connection.database));
  }

  public async executeScript(connection: KxConnection, script: string): Promise<QValue> {
    return this.executePrepared(connection, qScriptInNamespace(script, connection.database));
  }

  private async executePrepared(connection: KxConnection, query: string): Promise<QValue> {
    const client = await this.connect(connection);
    try {
      return await client.query(query);
    } catch (error) {
      if (!(error instanceof KdbQError)) {
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
    const client = new KdbIpcClient({
      host: connection.host,
      port: connection.port,
      username: connection.username,
      password,
      timeoutMs: this.connectionTimeoutMs(),
      diagnostics: this.diagnostics,
    });
    try {
      await client.connect();
      const result = await client.query('1+1');
      if (result !== 2) {
        throw new Error('q IPC test returned an unexpected result for 1+1.');
      }
    } finally {
      await client.close();
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
    clients.forEach(client => client.cancel(new Error('KX extension deactivated.')));
    this.stateEmitter.dispose();
  }

  private dropClient(connectionId: string, client: KdbIpcClient): void {
    if (this.clients.get(connectionId) !== client) {
      return;
    }
    this.clients.delete(connectionId);
    this.opening.delete(connectionId);
    this.stateEmitter.fire();
  }

  private connectionTimeoutMs(): number {
    const configured = vscode.workspace
      .getConfiguration('vscode-kdb')
      .get<number>('connectionTimeoutMs', DEFAULT_CONNECTION_TIMEOUT_MS);
    return Number.isFinite(configured) && configured >= 0
      ? Math.floor(configured)
      : DEFAULT_CONNECTION_TIMEOUT_MS;
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
