import * as vscode from 'vscode';
import { connectionEndpoint, KxConnection } from './connection';
import { ConnectionManager } from './connection-manager';
import {
  ConnectionScopeConflict,
  ConnectionStore,
  connectionScopeLabel,
} from './connection-store';

export type ConnectionTreeNode =
  | ConnectionTreeItem
  | ConnectionConflictTreeItem
  | EmptyConnectionsTreeItem;

export class ConnectionConflictTreeItem extends vscode.TreeItem {
  public constructor(conflict: ConnectionScopeConflict) {
    super(`Conflicting profile ID: ${conflict.id}`, vscode.TreeItemCollapsibleState.None);
    this.id = `vscode-kdb.connection-conflict.${conflict.id}`;
    this.contextValue = 'vscode-kdb.connection.conflict';
    this.description = 'not loaded • fix workspace-folder settings';
    this.iconPath = new vscode.ThemeIcon(
      'warning',
      new vscode.ThemeColor('list.warningForeground')
    );
    const scopes = conflict.scopes.map(connectionScopeLabel).join(', ');
    this.tooltip = new vscode.MarkdownString(
      `KX did not load stable ID \`${escapeMarkdown(conflict.id)}\` because ` +
      `multiple workspace folders define it (${escapeMarkdown(scopes)}). ` +
      'Even identical definitions have ambiguous write ownership. Remove the duplicate ID ' +
      'from all but one workspace-folder setting.'
    );
    this.accessibilityInformation = {
      label: `Conflicting KX profile ID ${conflict.id}; profile not loaded`,
    };
  }
}

export class ConnectionTreeItem extends vscode.TreeItem {
  public constructor(
    public readonly connection: KxConnection,
    active: boolean,
    connected: boolean,
    scopeLabel?: string
  ) {
    super(connection.name, vscode.TreeItemCollapsibleState.None);
    this.id = connection.id;
    const state = connected ? 'connected' : 'disconnected';
    const activity = active ? 'active' : 'inactive';
    this.contextValue = `vscode-kdb.connection.${state}.${activity}`;
    this.description = [
      active ? 'ACTIVE' : undefined,
      connected ? 'connected' : 'disconnected',
      connectionEndpoint(connection),
      connection.database,
      scopeLabel,
    ].filter(Boolean).join(' • ');
    this.iconPath = new vscode.ThemeIcon(
      active ? 'star-full' : 'database',
      connected ? new vscode.ThemeColor('testing.iconPassed') : undefined
    );
    this.accessibilityInformation = {
      label: `${connection.name}, ${active ? 'active, ' : ''}${connected ? 'connected' : 'disconnected'}`,
    };
    this.tooltip = new vscode.MarkdownString([
      `**${escapeMarkdown(connection.name)}**`,
      '',
      `Endpoint: \`${escapeMarkdown(connectionEndpoint(connection))}\``,
      '',
      `Namespace: \`${escapeMarkdown(connection.database)}\``,
      '',
      `User: ${connection.username ? `\`${escapeMarkdown(connection.username)}\`` : '_anonymous_'}`,
      '',
      ...(scopeLabel ? [`Settings: ${escapeMarkdown(scopeLabel)}`, ''] : []),
      `State: ${active ? '**ACTIVE**; ' : ''}${connected ? 'connected' : 'disconnected'}`,
    ].join('\n'));
    this.command = {
      command: 'vscode-kdb.setActiveConnection',
      title: 'Set Active Connection',
      arguments: [this],
    };
  }
}

export class EmptyConnectionsTreeItem extends vscode.TreeItem {
  public constructor() {
    super('Add your first KX connection', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'vscode-kdb.connections.empty';
    this.iconPath = new vscode.ThemeIcon('add');
    this.command = {
      command: 'vscode-kdb.addConnection',
      title: 'Add Connection',
    };
    this.tooltip = 'Configure a direct q IPC connection.';
  }
}

export class ConnectionsTreeProvider implements vscode.TreeDataProvider<ConnectionTreeNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<ConnectionTreeNode | undefined>();
  private readonly stateSubscription: vscode.Disposable;

  public readonly onDidChangeTreeData = this.changeEmitter.event;

  public constructor(
    private readonly store: ConnectionStore,
    private readonly manager: ConnectionManager
  ) {
    this.stateSubscription = this.manager.onDidChangeState(() => this.refresh());
  }

  public getTreeItem(element: ConnectionTreeNode): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: ConnectionTreeNode): ConnectionTreeNode[] {
    if (element) {
      return [];
    }
    const connections = this.store.connections();
    const conflicts = typeof this.store.connectionScopeConflicts === 'function'
      ? this.store.connectionScopeConflicts()
      : [];
    if (!connections.length && !conflicts.length) {
      return [new EmptyConnectionsTreeItem()];
    }
    const activeId = this.store.activeConnectionId();
    return [
      ...conflicts.map(conflict => new ConnectionConflictTreeItem(conflict)),
      ...connections.map(connection => new ConnectionTreeItem(
      connection,
      connection.id === activeId,
      this.manager.isConnected(connection.id),
      typeof this.store.connectionScope === 'function'
        ? connectionScopeLabel(this.store.connectionScope(connection.id) || { kind: 'global' })
        : undefined
      )),
    ];
  }

  public refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  public dispose(): void {
    this.stateSubscription.dispose();
    this.changeEmitter.dispose();
  }
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}\[\]()#+\-.!]/g, '\\$&');
}
