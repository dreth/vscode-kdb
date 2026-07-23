import * as vscode from 'vscode';
import {
  connectionEndpoint,
  DEFAULT_HOST,
  DEFAULT_NAMESPACE,
  DEFAULT_PORT,
  KxConnection,
} from './connection';
import { ConnectionManager } from './connection-manager';
import { ConnectionMigrationCommand } from './connection-migration';
import { ConnectionStore } from './connection-store';
import { ConnectionTreeItem, ConnectionsTreeProvider } from './connection-tree';
import { parseConnectionFormPayload } from './connection-form-model';
import {
  ConnectionFormPanel,
  ConnectionFormTestProgress,
  ConnectionFormTestResult,
  initialConnectionFormValues,
} from './connection-form-panel';
import { persistConnectionUpdate } from './connection-lifecycle';
import { ConnectionTestError, connectionTestEndpoint } from './connection-test';

interface ConnectionPick extends vscode.QuickPickItem {
  connection: KxConnection;
}

export class ConnectionCommands {
  private activeForm: ConnectionFormPanel | undefined;
  private formSession: Promise<void> | undefined;
  private readonly migration: ConnectionMigrationCommand;

  public constructor(
    private readonly store: ConnectionStore,
    private readonly manager: ConnectionManager,
    private readonly tree: ConnectionsTreeProvider
  ) {
    this.migration = new ConnectionMigrationCommand(vscode, store, tree);
  }

  public register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand('vscode-kdb.addConnection', () => this.add()),
      vscode.commands.registerCommand('vscode-kdb.editConnection', argument => this.edit(argument)),
      vscode.commands.registerCommand('vscode-kdb.removeConnection', argument => this.remove(argument)),
      vscode.commands.registerCommand('vscode-kdb.setActiveConnection', argument => this.setActive(argument)),
      vscode.commands.registerCommand('vscode-kdb.connect', argument => this.connect(argument)),
      vscode.commands.registerCommand('vscode-kdb.disconnect', argument => this.disconnect(argument)),
      vscode.commands.registerCommand('vscode-kdb.testConnection', argument => this.test(argument)),
      vscode.commands.registerCommand(
        'vscode-kdb.importSqlToolsConnections',
        () => this.migration.run()
      ),
      vscode.commands.registerCommand('vscode-kdb.refreshConnections', () => this.tree.refresh())
    );
  }

  public async add(): Promise<void> {
    await this.openConnectionForm();
  }

  public async edit(argument?: unknown): Promise<void> {
    const connection = await this.pickConnection('Edit which KX connection?', argument);
    if (connection) {
      await this.openConnectionForm(connection);
    }
  }

  public async remove(argument?: unknown): Promise<void> {
    const connection = await this.pickConnection('Remove which KX connection?', argument);
    if (!connection) {
      return;
    }
    try {
      await this.confirmAndRemove(connection);
    } catch (error) {
      this.showFailure(`Remove connection "${connection.name}"`, error);
    }
  }

  public async setActive(argument?: unknown): Promise<KxConnection | undefined> {
    const connection = await this.pickConnection('Set which KX connection active?', argument);
    if (!connection) {
      return undefined;
    }
    try {
      await this.store.setActiveConnection(connection.id);
      this.tree.refresh();
      vscode.window.showInformationMessage(`Active KX connection: ${connection.name}.`);
      return connection;
    } catch (error) {
      this.showFailure(`Set active connection "${connection.name}"`, error);
      return undefined;
    }
  }

  public async connect(argument?: unknown): Promise<void> {
    const connection = await this.pickConnection('Connect which KX connection?', argument);
    if (!connection) {
      return;
    }
    try {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Connecting to ${connection.name} (${connectionEndpoint(connection)})`,
        cancellable: false,
      }, () => this.manager.connect(connection));
      if (!this.store.activeConnectionId()) {
        await this.store.setActiveConnection(connection.id);
      }
      this.tree.refresh();
      vscode.window.showInformationMessage(
        `Connected to "${connection.name}" at ${connectionEndpoint(connection)}.`
      );
    } catch (error) {
      this.showFailure(`Connect to "${connection.name}" at ${connectionEndpoint(connection)}`, error);
    }
  }

  public async disconnect(argument?: unknown): Promise<void> {
    const connection = await this.pickConnection('Disconnect which KX connection?', argument);
    if (!connection) {
      return;
    }
    try {
      await this.manager.disconnect(connection.id);
      this.tree.refresh();
      vscode.window.showInformationMessage(`Disconnected "${connection.name}".`);
    } catch (error) {
      this.showFailure(`Disconnect "${connection.name}" at ${connectionEndpoint(connection)}`, error);
    }
  }

  public async test(argument?: unknown): Promise<void> {
    const connection = await this.pickConnection('Test which KX connection?', argument);
    if (!connection) {
      return;
    }
    try {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Testing ${connection.name} (${connectionEndpoint(connection)})`,
        cancellable: false,
      }, () => this.manager.test(connection));
      vscode.window.showInformationMessage(
        `KX connection "${connection.name}" succeeded at ${connectionEndpoint(connection)}.`
      );
    } catch (error) {
      this.showFailure(`Test "${connection.name}" at ${connectionEndpoint(connection)}`, error);
    }
  }

  private async openConnectionForm(editing?: KxConnection): Promise<void> {
    if (this.activeForm) {
      this.activeForm.reveal();
      await this.activeForm.waitForCompletion();
      return;
    }
    if (this.formSession) {
      await this.formSession;
      return;
    }
    const session = this.createConnectionForm(editing);
    this.formSession = session;
    try {
      await session;
    } finally {
      if (this.formSession === session) {
        this.formSession = undefined;
      }
    }
  }

  private async createConnectionForm(editing?: KxConnection): Promise<void> {
    const connections = this.store.connections();
    const draft: KxConnection = editing || {
      id: this.store.newConnectionId(),
      name: '',
      host: DEFAULT_HOST,
      port: DEFAULT_PORT,
      database: DEFAULT_NAMESPACE,
      username: '',
    };
    let hasStoredPassword = false;
    if (editing) {
      try {
        hasStoredPassword = await this.store.hasPassword(editing.id);
      } catch (error) {
        this.showFailure(`Open connection "${editing.name}"`, error);
        return;
      }
    }
    const globalTimeouts = this.manager.globalTimeouts();
    const initial = initialConnectionFormValues(
      editing ? 'edit' : 'add',
      draft,
      globalTimeouts.connectTimeoutMs,
      globalTimeouts.queryTimeoutMs,
      hasStoredPassword,
      connections.filter(connection => connection.id !== editing?.id).map(connection => connection.name)
    );

    const panel = new ConnectionFormPanel(initial, {
      onSave: payload => this.saveConnectionForm(payload, draft.id, editing),
      onTest: (payload, signal, onProgress) => this.testConnectionForm(
        payload,
        draft.id,
        editing,
        hasStoredPassword,
        signal,
        onProgress
      ),
      onDelete: editing ? () => this.confirmAndRemove(editing) : undefined,
    });
    this.activeForm = panel;
    try {
      await panel.waitForCompletion();
    } finally {
      if (this.activeForm === panel) {
        this.activeForm = undefined;
      }
    }
  }

  private async testConnectionForm(
    payload: unknown,
    id: string,
    editing: KxConnection | undefined,
    hasStoredPassword: boolean,
    signal: AbortSignal,
    onProgress: (progress: ConnectionFormTestProgress) => void
  ): Promise<ConnectionFormTestResult> {
    const parsed = parseConnectionFormPayload(payload, {
      id,
      existingConnections: this.store.connections(),
      editing,
      hasStoredPassword,
    });
    const endpoint = connectionTestEndpoint(parsed.connection);
    if (signal.aborted) {
      throw new ConnectionTestError('cancel', endpoint);
    }

    let password: string | undefined;
    let usedSavedPassword = false;
    if (typeof parsed.passwordUpdate === 'string') {
      password = parsed.passwordUpdate;
    } else if (parsed.passwordUpdate === undefined && editing) {
      try {
        password = await this.store.password(editing.id);
        usedSavedPassword = password !== undefined;
      } catch (error) {
        throw new ConnectionTestError('validation', endpoint, error);
      }
    }
    if (signal.aborted) {
      throw new ConnectionTestError('cancel', endpoint);
    }

    const timeouts = await this.manager.testTemporary(parsed.connection, {
      password,
      signal,
      onPhase: phase => onProgress({ phase, endpoint, usedSavedPassword }),
    });
    return {
      endpoint,
      connectTimeoutMs: timeouts.connectTimeoutMs,
      queryTimeoutMs: timeouts.queryTimeoutMs,
      namespaceTested: parsed.connection.database !== '.',
      usedSavedPassword,
    };
  }

  private async saveConnectionForm(
    payload: unknown,
    id: string,
    editing?: KxConnection
  ): Promise<void> {
    const current = editing ? this.store.connection(editing.id) : undefined;
    if (editing && !current) {
      throw new Error(`KX connection "${editing.name}" no longer exists.`);
    }
    const hasStoredPassword = current ? await this.store.hasPassword(current.id) : false;
    const parsed = parseConnectionFormPayload(payload, {
      id,
      existingConnections: this.store.connections(),
      editing: current,
      hasStoredPassword,
    });

    if (!current) {
      await this.store.add(
        parsed.connection,
        typeof parsed.passwordUpdate === 'string' ? parsed.passwordUpdate : undefined
      );
      this.tree.refresh();
      vscode.window.showInformationMessage(
        `Added KX connection "${parsed.connection.name}" (${connectionEndpoint(parsed.connection)}).`
      );
      return;
    }

    const outcome = await persistConnectionUpdate(
      this.manager,
      current,
      parsed.connection,
      parsed.passwordUpdate !== undefined,
      () => this.store.update(parsed.connection, parsed.passwordUpdate, editing)
    );
    this.tree.refresh();
    if (outcome.sessionState === 'reconnect-failed') {
      const detail = outcome.error ? ` ${outcome.error.message}` : '';
      vscode.window.showWarningMessage(
        `Updated KX connection "${parsed.connection.name}", but reconnect failed. ` +
        `The connection is saved and disconnected.${detail}`
      );
      return;
    }
    const lifecycle = outcome.sessionState === 'reconnected' ? ' Reconnected with the saved settings.' : '';
    vscode.window.showInformationMessage(
      `Updated KX connection "${parsed.connection.name}" (${connectionEndpoint(parsed.connection)}).${lifecycle}`
    );
  }

  private async confirmAndRemove(connection: KxConnection): Promise<boolean> {
    const current = this.store.connection(connection.id);
    if (!current) {
      return true;
    }
    const confirmation = await vscode.window.showWarningMessage(
      `Delete KX connection "${current.name}"? Its saved password will also be deleted.`,
      { modal: true },
      'Delete Connection'
    );
    if (confirmation !== 'Delete Connection') {
      return false;
    }

    await this.store.remove(current.id, connection);
    let disconnectError: Error | undefined;
    try {
      await this.manager.disconnect(current.id);
    } catch (error) {
      disconnectError = error instanceof Error ? error : new Error(String(error));
    }
    this.tree.refresh();
    if (disconnectError) {
      vscode.window.showWarningMessage(
        `Deleted KX connection "${current.name}", but transport cleanup reported: ${disconnectError.message}`
      );
    } else {
      vscode.window.showInformationMessage(`Deleted KX connection "${current.name}".`);
    }
    return true;
  }

  private async pickConnection(title: string, argument?: unknown): Promise<KxConnection | undefined> {
    const fromArgument = this.connectionFromArgument(argument);
    if (fromArgument) {
      return fromArgument;
    }
    const connections = this.store.connections();
    if (!connections.length) {
      const action = await vscode.window.showWarningMessage(
        'No KX connections are configured.',
        'Add Connection'
      );
      if (action === 'Add Connection') {
        await this.add();
      }
      return undefined;
    }
    const activeId = this.store.activeConnectionId();
    const picks: ConnectionPick[] = connections.map(connection => ({
      label: connection.name,
      description: `${connectionEndpoint(connection)} • ${connection.database}`,
      detail: [
        connection.id === activeId ? 'Active' : undefined,
        this.manager.isConnected(connection.id) ? 'Connected' : 'Disconnected',
      ].filter(Boolean).join(' • '),
      connection,
    }));
    const picked = await vscode.window.showQuickPick(picks, {
      title,
      placeHolder: 'Select a direct q IPC connection',
      ignoreFocusOut: true,
    });
    return picked && picked.connection;
  }

  private connectionFromArgument(argument: unknown): KxConnection | undefined {
    let id: string | undefined;
    if (argument instanceof ConnectionTreeItem) {
      id = argument.connection.id;
    } else if (typeof argument === 'string') {
      id = argument;
    } else if (argument && typeof argument === 'object') {
      const value = argument as { id?: unknown; connection?: { id?: unknown } };
      const candidate = value.connection && value.connection.id !== undefined ? value.connection.id : value.id;
      id = typeof candidate === 'string' ? candidate : undefined;
    }
    return id ? this.store.connection(id) : undefined;
  }

  private showFailure(action: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`${action} failed: ${message}`);
  }
}
