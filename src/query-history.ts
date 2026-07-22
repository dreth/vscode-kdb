import * as vscode from 'vscode';
import { ConnectionStore } from './connection-store';
import { ConnectionsTreeProvider } from './connection-tree';
import {
  QueryHistoryEntry,
  QueryHistoryRecordInput,
  QueryHistoryStore,
} from './query-history-model';

export const QUERY_HISTORY_VIEW_ID = 'vscode-kdb.queryHistory';

type QueryHistoryNode = QueryHistoryTreeItem | EmptyQueryHistoryTreeItem;

export type QueryHistoryRunner = (entry: QueryHistoryEntry) => Promise<void>;

export interface QueryHistoryCapture {
  feature: QueryHistoryFeature;
  generation: number;
}

export class QueryHistoryFeature implements vscode.Disposable {
  private readonly provider: QueryHistoryTreeProvider;
  private readonly disposables: vscode.Disposable[];
  private disposed = false;

  public constructor(
    private readonly history: QueryHistoryStore,
    connections: ConnectionStore,
    connectionTree: ConnectionsTreeProvider,
    runQuery: QueryHistoryRunner
  ) {
    this.provider = new QueryHistoryTreeProvider(this.history, connections);
    const treeView = vscode.window.createTreeView(QUERY_HISTORY_VIEW_ID, {
      treeDataProvider: this.provider,
      showCollapseAll: false,
    });
    this.disposables = [
      this.provider,
      treeView,
      connectionTree.onDidChangeTreeData(() => this.provider.refresh()),
      vscode.commands.registerCommand('vscode-kdb.rerunQueryHistoryEntry', argument => this.rerun(argument, runQuery)),
      vscode.commands.registerCommand('vscode-kdb.copyQueryHistoryEntry', argument => this.copy(argument)),
      vscode.commands.registerCommand('vscode-kdb.insertQueryHistoryEntry', argument => this.insert(argument)),
      vscode.commands.registerCommand('vscode-kdb.deleteQueryHistoryEntry', argument => this.delete(argument)),
      vscode.commands.registerCommand('vscode-kdb.clearQueryHistory', () => this.clear()),
    ];
    void this.prune().catch(error => {
      if (!this.disposed) {
        vscode.window.showWarningMessage(`KX Query History could not apply its local retention limit: ${errorMessage(error)}`);
      }
    });
  }

  public capture(): QueryHistoryCapture | undefined {
    return this.disposed
      ? undefined
      : { feature: this, generation: this.history.captureGeneration() };
  }

  public async record(capture: QueryHistoryCapture, input: QueryHistoryRecordInput): Promise<void> {
    if (this.disposed || capture.feature !== this) {
      return;
    }
    const entry = await this.history.record(input, capture.generation);
    if (!this.disposed && entry) {
      this.provider.refresh();
    }
  }

  public async prune(): Promise<void> {
    if (this.disposed) {
      return;
    }
    await this.history.prune();
    if (!this.disposed) {
      this.provider.refresh();
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.history.invalidatePending();
    this.disposables.splice(0).reverse().forEach(disposable => disposable.dispose());
  }

  private async rerun(argument: unknown, runQuery: QueryHistoryRunner): Promise<void> {
    const entry = this.provider.resolveEntry(argument);
    if (!entry) {
      vscode.window.showWarningMessage('Choose an entry in KX Query History first.');
      return;
    }
    await runQuery(entry);
  }

  private async copy(argument: unknown): Promise<void> {
    const entry = this.provider.resolveEntry(argument);
    if (!entry) {
      vscode.window.showWarningMessage('Choose an entry in KX Query History first.');
      return;
    }
    await vscode.env.clipboard.writeText(entry.queryText);
    vscode.window.showInformationMessage('Copied the query text from KX Query History.');
  }

  private async insert(argument: unknown): Promise<void> {
    const entry = this.provider.resolveEntry(argument);
    if (!entry) {
      vscode.window.showWarningMessage('Choose an entry in KX Query History first.');
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Open an editor before inserting query history text.');
      return;
    }
    const inserted = await editor.edit(builder => builder.replace(editor.selection, entry.queryText));
    if (!inserted) {
      vscode.window.showErrorMessage('VS Code could not insert the query history text into the active editor.');
    }
  }

  private async delete(argument: unknown): Promise<void> {
    const entry = this.provider.resolveEntry(argument);
    if (!entry) {
      vscode.window.showWarningMessage('Choose an entry in KX Query History first.');
      return;
    }
    try {
      await this.history.delete(entry.id);
      this.provider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`Could not delete KX Query History entry: ${errorMessage(error)}`);
    }
  }

  private async clear(): Promise<void> {
    const count = this.history.entries().length;
    if (!count) {
      vscode.window.showInformationMessage('KX Query History is already empty.');
      return;
    }
    const decision = await vscode.window.showWarningMessage(
      `Clear all ${count} local KX Query History entr${count === 1 ? 'y' : 'ies'}? Query text can be sensitive.`,
      { modal: true },
      'Clear Query History'
    );
    if (decision !== 'Clear Query History') {
      return;
    }
    try {
      await this.history.clear();
      this.provider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`Could not clear KX Query History: ${errorMessage(error)}`);
    }
  }
}

export class QueryHistoryTreeProvider implements vscode.TreeDataProvider<QueryHistoryNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<QueryHistoryNode | undefined>();
  private readonly ownedItems = new WeakSet<QueryHistoryTreeItem>();

  public readonly onDidChangeTreeData = this.changeEmitter.event;

  public constructor(
    private readonly history: QueryHistoryStore,
    private readonly connections: ConnectionStore
  ) {}

  public getTreeItem(element: QueryHistoryNode): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: QueryHistoryNode): QueryHistoryNode[] {
    if (element) {
      return [];
    }
    const entries = this.history.entries();
    if (!entries.length) {
      return [new EmptyQueryHistoryTreeItem()];
    }
    return entries.map(entry => {
      const item = new QueryHistoryTreeItem(entry, this.connectionLabel(entry));
      this.ownedItems.add(item);
      return item;
    });
  }

  public resolveEntry(argument: unknown): QueryHistoryEntry | undefined {
    if (!(argument instanceof QueryHistoryTreeItem) || !this.ownedItems.has(argument)) {
      return undefined;
    }
    return this.history.entries().find(entry => entry.id === argument.entry.id);
  }

  public refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  public dispose(): void {
    this.changeEmitter.dispose();
  }

  private connectionLabel(entry: QueryHistoryEntry): string {
    const current = this.connections.connection(entry.connectionId);
    if (!current) {
      return `${entry.connectionName} (profile removed)`;
    }
    return current.name === entry.connectionName
      ? current.name
      : `${current.name} (recorded as ${entry.connectionName})`;
  }
}

export class QueryHistoryTreeItem extends vscode.TreeItem {
  public constructor(
    public readonly entry: QueryHistoryEntry,
    connectionLabel: string
  ) {
    super(queryLabel(entry.queryText), vscode.TreeItemCollapsibleState.None);
    this.contextValue = `vscode-kdb.queryHistory.entry.${entry.status}`;
    this.description = [
      entry.status,
      entry.kind,
      durationText(entry.durationMs),
      timestampText(entry.timestamp),
      connectionLabel,
    ].join(' • ');
    this.iconPath = new vscode.ThemeIcon(
      entry.status === 'succeeded' ? 'check' : entry.status === 'failed' ? 'error' : 'circle-slash'
    );
    this.tooltip = [
      `${entry.status} ${entry.kind} execution`,
      `Connection: ${connectionLabel}`,
      `Timestamp: ${new Date(entry.timestamp).toISOString()}`,
      `Duration: ${durationText(entry.durationMs)}`,
      '',
      entry.queryText,
    ].join('\n');
  }
}

export class EmptyQueryHistoryTreeItem extends vscode.TreeItem {
  public constructor() {
    super('No issued editor queries recorded', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'vscode-kdb.queryHistory.empty';
    this.iconPath = new vscode.ThemeIcon('history');
    this.tooltip = 'Only editor executions issued while Query History is enabled are stored locally.';
  }
}

function queryLabel(queryText: string): string {
  const firstLine = queryText.split(/\r?\n/).find(line => line.trim()) || queryText;
  const compact = firstLine.replace(/\s+/g, ' ').trim() || '(blank query)';
  return compact.length > 100 ? `${compact.slice(0, 99)}…` : compact;
}

function durationText(durationMs: number): string {
  return `${Math.round(Math.max(0, durationMs))} ms`;
}

function timestampText(timestamp: number): string {
  return new Date(timestamp).toISOString().replace('T', ' ').replace('.000Z', 'Z');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
