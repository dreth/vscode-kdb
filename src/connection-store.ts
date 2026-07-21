import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { KxConnection, safeStoredConnections, validateConnection } from './connection';

const CONFIGURATION_SECTION = 'vscode-kdb';
const CONNECTIONS_SETTING = 'connections';
const ACTIVE_CONNECTION_KEY = 'vscode-kdb.activeConnectionId';
const PASSWORD_SECRET_PREFIX = 'vscode-kdb.connectionPassword.';

export class ConnectionStore {
  public constructor(private readonly context: vscode.ExtensionContext) {}

  public connections(): KxConnection[] {
    const configuration = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
    const inspection = configuration.inspect<unknown>(CONNECTIONS_SETTING);
    return safeStoredConnections(inspection && inspection.globalValue !== undefined
      ? inspection.globalValue
      : []);
  }

  public connection(id: string): KxConnection | undefined {
    return this.connections().find(connection => connection.id === id);
  }

  public activeConnectionId(): string | undefined {
    const id = this.context.globalState.get<string>(ACTIVE_CONNECTION_KEY);
    return id && this.connection(id) ? id : undefined;
  }

  public activeConnection(): KxConnection | undefined {
    const id = this.activeConnectionId();
    return id ? this.connection(id) : undefined;
  }

  public async setActiveConnection(id: string | undefined): Promise<void> {
    if (id && !this.connection(id)) {
      throw new Error(`Cannot activate unknown KX connection ${id}.`);
    }
    await this.context.globalState.update(ACTIVE_CONNECTION_KEY, id);
  }

  public newConnectionId(): string {
    return `kx-${crypto.randomBytes(12).toString('hex')}`;
  }

  public async add(connection: KxConnection, password?: string): Promise<void> {
    const connections = this.connections();
    const validated = validateConnection(connection, connections);
    const previousPassword = await this.password(validated.id);
    const previousActiveId = this.context.globalState.get<string>(ACTIVE_CONNECTION_KEY);
    const shouldActivate = !this.activeConnectionId();
    let secretAttempted = false;
    let activeAttempted = false;
    let connectionsAttempted = false;
    try {
      secretAttempted = true;
      await this.writePassword(validated.id, password);
      if (shouldActivate) {
        activeAttempted = true;
        await this.context.globalState.update(ACTIVE_CONNECTION_KEY, validated.id);
      }
      connectionsAttempted = true;
      await this.writeConnections([...connections, validated]);
    } catch (error) {
      let connectionsRestored = !connectionsAttempted;
      await this.rethrowAfterRollback(error, [
        connectionsAttempted ? async () => {
          await this.writeConnections(connections);
          connectionsRestored = true;
        } : undefined,
        activeAttempted ? () => this.context.globalState.update(ACTIVE_CONNECTION_KEY, previousActiveId) : undefined,
        secretAttempted ? () => this.writePassword(
          validated.id,
          connectionsRestored ? previousPassword : undefined
        ) : undefined,
      ]);
    }
  }

  public async update(connection: KxConnection, password?: string | null): Promise<void> {
    const connections = this.connections();
    const index = connections.findIndex(item => item.id === connection.id);
    if (index < 0) {
      throw new Error(`KX connection "${connection.name}" no longer exists.`);
    }
    const validated = validateConnection(connection, connections, connection.id);
    const updated = connections.slice();
    updated[index] = validated;
    const passwordChanges = password !== undefined;
    const previousPassword = passwordChanges ? await this.password(connection.id) : undefined;
    let secretAttempted = false;
    let connectionsAttempted = false;
    try {
      if (passwordChanges) {
        secretAttempted = true;
        await this.writePassword(connection.id, password === null ? undefined : password);
      }
      connectionsAttempted = true;
      await this.writeConnections(updated);
    } catch (error) {
      let connectionsRestored = !connectionsAttempted;
      await this.rethrowAfterRollback(error, [
        connectionsAttempted ? async () => {
          await this.writeConnections(connections);
          connectionsRestored = true;
        } : undefined,
        secretAttempted ? () => this.writePassword(
          connection.id,
          connectionsRestored ? previousPassword : undefined
        ) : undefined,
      ]);
    }
  }

  public async remove(id: string): Promise<void> {
    const connections = this.connections();
    const updated = connections.filter(connection => connection.id !== id);
    if (updated.length === connections.length) {
      return;
    }
    const removedActiveConnection = this.activeConnectionId() === id;
    const previousActiveId = this.context.globalState.get<string>(ACTIVE_CONNECTION_KEY);
    const previousPassword = await this.password(id);
    let secretAttempted = false;
    let activeAttempted = false;
    let connectionsAttempted = false;
    try {
      secretAttempted = true;
      await this.writePassword(id, undefined);
      if (removedActiveConnection) {
        activeAttempted = true;
        await this.context.globalState.update(ACTIVE_CONNECTION_KEY, updated.length ? updated[0].id : undefined);
      }
      connectionsAttempted = true;
      await this.writeConnections(updated);
    } catch (error) {
      let connectionsRestored = !connectionsAttempted;
      await this.rethrowAfterRollback(error, [
        connectionsAttempted ? async () => {
          await this.writeConnections(connections);
          connectionsRestored = true;
        } : undefined,
        activeAttempted ? () => this.context.globalState.update(ACTIVE_CONNECTION_KEY, previousActiveId) : undefined,
        secretAttempted ? () => this.writePassword(
          id,
          connectionsRestored ? previousPassword : undefined
        ) : undefined,
      ]);
    }
  }

  public async password(id: string): Promise<string | undefined> {
    return this.context.secrets.get(this.passwordKey(id));
  }

  public async hasPassword(id: string): Promise<boolean> {
    return (await this.password(id)) !== undefined;
  }

  private async writePassword(id: string, password: string | undefined): Promise<void> {
    if (password) {
      await this.context.secrets.store(this.passwordKey(id), password);
    } else {
      await this.context.secrets.delete(this.passwordKey(id));
    }
  }

  private async rethrowAfterRollback(
    error: unknown,
    rollbacks: Array<(() => PromiseLike<unknown>) | undefined>
  ): Promise<never> {
    let rollbackFailed = false;
    for (const rollback of rollbacks) {
      if (!rollback) {
        continue;
      }
      try {
        await rollback();
      } catch {
        rollbackFailed = true;
      }
    }
    const original = error instanceof Error ? error : new Error(String(error));
    if (rollbackFailed) {
      throw new Error(`${original.message} KX could not fully restore the previous connection state.`);
    }
    throw original;
  }

  private async writeConnections(connections: readonly KxConnection[]): Promise<void> {
    const safeConnections = connections.map(connection => ({
      id: connection.id,
      name: connection.name,
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
    }));
    await vscode.workspace
      .getConfiguration(CONFIGURATION_SECTION)
      .update(CONNECTIONS_SETTING, safeConnections, vscode.ConfigurationTarget.Global);
  }

  private passwordKey(id: string): string {
    return `${PASSWORD_SECRET_PREFIX}${id}`;
  }
}
