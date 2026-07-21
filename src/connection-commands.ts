import * as vscode from 'vscode';
import {
  ConnectionValidationError,
  DEFAULT_HOST,
  DEFAULT_NAMESPACE,
  DEFAULT_PORT,
  KxConnection,
  connectionEndpoint,
  normalizeHost,
  normalizeNamespace,
  validateConnection,
  validateHost,
  validateNamespace,
  validatePort,
} from './connection';
import { ConnectionManager } from './connection-manager';
import { ConnectionStore } from './connection-store';
import { ConnectionTreeItem, ConnectionsTreeProvider } from './connection-tree';

interface ConnectionPick extends vscode.QuickPickItem {
  connection: KxConnection;
}

type PasswordAction =
  | { kind: 'keep' }
  | { kind: 'set'; value: string }
  | { kind: 'remove' };

export class ConnectionCommands {
  public constructor(
    private readonly store: ConnectionStore,
    private readonly manager: ConnectionManager,
    private readonly tree: ConnectionsTreeProvider
  ) {}

  public register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand('vscode-kdb.addConnection', () => this.add()),
      vscode.commands.registerCommand('vscode-kdb.editConnection', argument => this.edit(argument)),
      vscode.commands.registerCommand('vscode-kdb.removeConnection', argument => this.remove(argument)),
      vscode.commands.registerCommand('vscode-kdb.setActiveConnection', argument => this.setActive(argument)),
      vscode.commands.registerCommand('vscode-kdb.connect', argument => this.connect(argument)),
      vscode.commands.registerCommand('vscode-kdb.disconnect', argument => this.disconnect(argument)),
      vscode.commands.registerCommand('vscode-kdb.testConnection', argument => this.test(argument)),
      vscode.commands.registerCommand('vscode-kdb.refreshConnections', () => this.tree.refresh())
    );
  }

  public async add(): Promise<void> {
    const values = await this.promptForConnection();
    if (!values) {
      return;
    }
    const password = await vscode.window.showInputBox({
      title: 'KX: Add Connection (6/6)',
      prompt: 'Authentication secret (optional; stored only in VS Code SecretStorage)',
      password: true,
      ignoreFocusOut: true,
      validateInput: value => value.includes('\0') ? 'Authentication secret cannot contain null characters.' : undefined,
    });
    if (password === undefined) {
      return;
    }

    try {
      const connection = validateConnection({
        ...values,
        id: this.store.newConnectionId(),
      }, this.store.connections());
      await this.store.add(connection, password || undefined);
      this.tree.refresh();
      vscode.window.showInformationMessage(
        `Added KX connection "${connection.name}" (${connectionEndpoint(connection)}).`
      );
    } catch (error) {
      this.showFailure('Add connection', error);
    }
  }

  public async edit(argument?: unknown): Promise<void> {
    const current = await this.pickConnection('Edit which KX connection?', argument);
    if (!current) {
      return;
    }
    const values = await this.promptForConnection(current);
    if (!values) {
      return;
    }
    const passwordAction = await this.promptForPasswordChange(current);
    if (!passwordAction) {
      return;
    }

    try {
      const connection = validateConnection({ ...values, id: current.id }, this.store.connections(), current.id);
      await this.manager.disconnect(current.id);
      const password = passwordAction.kind === 'set'
        ? passwordAction.value
        : passwordAction.kind === 'remove'
          ? null
          : undefined;
      await this.store.update(connection, password);
      this.tree.refresh();
      vscode.window.showInformationMessage(
        `Updated KX connection "${connection.name}" (${connectionEndpoint(connection)}).`
      );
    } catch (error) {
      this.showFailure(`Edit connection "${current.name}"`, error);
    }
  }

  public async remove(argument?: unknown): Promise<void> {
    const connection = await this.pickConnection('Remove which KX connection?', argument);
    if (!connection) {
      return;
    }
    const confirmation = await vscode.window.showWarningMessage(
      `Remove KX connection "${connection.name}"? Its stored authentication secret will also be deleted.`,
      { modal: true },
      'Remove'
    );
    if (confirmation !== 'Remove') {
      return;
    }

    try {
      await this.manager.disconnect(connection.id);
      await this.store.remove(connection.id);
      this.tree.refresh();
      vscode.window.showInformationMessage(`Removed KX connection "${connection.name}".`);
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

  private async promptForConnection(existing?: KxConnection): Promise<Omit<KxConnection, 'id'> | undefined> {
    const connections = this.store.connections();
    const name = await vscode.window.showInputBox({
      title: `KX: ${existing ? 'Edit' : 'Add'} Connection (1/6)`,
      prompt: 'Unique connection name',
      value: existing ? existing.name : '',
      ignoreFocusOut: true,
      validateInput: value => {
        const normalized = value.trim();
        if (!normalized) {
          return 'Connection name is required.';
        }
        return connections.some(item =>
          item.id !== (existing && existing.id) && item.name.toLocaleLowerCase() === normalized.toLocaleLowerCase()
        ) ? `A connection named "${normalized}" already exists.` : undefined;
      },
    });
    if (name === undefined) {
      return undefined;
    }

    const host = await vscode.window.showInputBox({
      title: `KX: ${existing ? 'Edit' : 'Add'} Connection (2/6)`,
      prompt: 'Direct q host name or IP address (no URL or SSH gateway)',
      value: existing ? existing.host : DEFAULT_HOST,
      ignoreFocusOut: true,
      validateInput: value => validationMessage(() => validateHost(normalizeHost(value))),
    });
    if (host === undefined) {
      return undefined;
    }

    const portText = await vscode.window.showInputBox({
      title: `KX: ${existing ? 'Edit' : 'Add'} Connection (3/6)`,
      prompt: 'q IPC port',
      value: String(existing ? existing.port : DEFAULT_PORT),
      ignoreFocusOut: true,
      validateInput: value => validationMessage(() => validatePort(Number(value))),
    });
    if (portText === undefined) {
      return undefined;
    }

    const database = await vscode.window.showInputBox({
      title: `KX: ${existing ? 'Edit' : 'Add'} Connection (4/6)`,
      prompt: 'q namespace/database (use . for root)',
      value: existing ? existing.database : DEFAULT_NAMESPACE,
      ignoreFocusOut: true,
      validateInput: value => validationMessage(() => validateNamespace(normalizeNamespace(value))),
    });
    if (database === undefined) {
      return undefined;
    }

    const username = await vscode.window.showInputBox({
      title: `KX: ${existing ? 'Edit' : 'Add'} Connection (5/6)`,
      prompt: 'Username (optional)',
      value: existing ? existing.username : '',
      ignoreFocusOut: true,
      validateInput: value => value.length > 256
        ? 'Username must be 256 characters or fewer.'
        : /[\r\n\0:]/.test(value)
          ? 'Username cannot contain colons, line breaks, or null characters.'
          : undefined,
    });
    if (username === undefined) {
      return undefined;
    }

    return {
      name: name.trim(),
      host: normalizeHost(host),
      port: Number(portText),
      database: normalizeNamespace(database),
      username: username.trim(),
    };
  }

  private async promptForPasswordChange(connection: KxConnection): Promise<PasswordAction | undefined> {
    const hasPassword = await this.store.hasPassword(connection.id);
    const choices: Array<vscode.QuickPickItem & { passwordAction: PasswordAction['kind'] }> = [
      {
        label: 'Keep stored authentication secret',
        description: hasPassword ? 'No change' : 'No secret is currently stored',
        passwordAction: 'keep',
      },
      {
        label: 'Replace authentication secret',
        description: 'Save a new value in VS Code SecretStorage',
        passwordAction: 'set',
      },
    ];
    if (hasPassword) {
      choices.push({
        label: 'Remove authentication secret',
        description: 'Delete it from VS Code SecretStorage',
        passwordAction: 'remove',
      });
    }
    const choice = await vscode.window.showQuickPick(choices, {
      title: 'KX: Edit Connection (6/6)',
      placeHolder: 'Choose how to handle the stored authentication secret',
      ignoreFocusOut: true,
    });
    if (!choice) {
      return undefined;
    }
    if (choice.passwordAction !== 'set') {
      return { kind: choice.passwordAction };
    }
    const value = await vscode.window.showInputBox({
      title: 'KX: Replace Authentication Secret',
      prompt: 'New value (stored only in VS Code SecretStorage)',
      password: true,
      ignoreFocusOut: true,
      validateInput: input => !input.length
        ? 'Enter a value or cancel and choose Remove.'
        : input.includes('\0')
          ? 'Authentication secret cannot contain null characters.'
          : undefined,
    });
    return value === undefined ? undefined : { kind: 'set', value };
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

function validationMessage(validate: () => void): string | undefined {
  try {
    validate();
    return undefined;
  } catch (error) {
    return error instanceof ConnectionValidationError ? error.message : String(error);
  }
}
