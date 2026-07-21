import * as vscode from 'vscode';
import { connectionEndpoint, KxConnection } from './connection';
import { ConnectionManager } from './connection-manager';
import { ConnectionStore } from './connection-store';

export type ConnectionTreeNode = ConnectionTreeItem | EmptyConnectionsTreeItem;

export class ConnectionTreeItem extends vscode.TreeItem {
  public constructor(
    public readonly connection: KxConnection,
    active: boolean,
    connected: boolean
  ) {
    super(connection.name, vscode.TreeItemCollapsibleState.None);
    const state = connected ? 'connected' : 'disconnected';
    const activity = active ? 'active' : 'inactive';
    this.contextValue = `vscode-kdb.connection.${state}.${activity}`;
    this.description = [
      active ? 'active' : undefined,
      connected ? 'connected' : 'disconnected',
      connectionEndpoint(connection),
      connection.database,
    ].filter(Boolean).join(' • ');
    this.iconPath = new vscode.ThemeIcon(
      active ? 'star-full' : 'database',
      connected ? new vscode.ThemeColor('testing.iconPassed') : undefined
    );
    this.tooltip = new vscode.MarkdownString([
      `**${escapeMarkdown(connection.name)}**`,
      '',
      `Endpoint: \`${escapeMarkdown(connectionEndpoint(connection))}\``,
      '',
      `Namespace: \`${escapeMarkdown(connection.database)}\``,
      '',
      `User: ${connection.username ? `\`${escapeMarkdown(connection.username)}\`` : '_anonymous_'}`,
      '',
      `State: ${connected ? 'connected' : 'disconnected'}${active ? ', active' : ''}`,
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
    if (!connections.length) {
      return [new EmptyConnectionsTreeItem()];
    }
    const activeId = this.store.activeConnectionId();
    return connections.map(connection => new ConnectionTreeItem(
      connection,
      connection.id === activeId,
      this.manager.isConnected(connection.id)
    ));
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
