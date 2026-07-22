import * as vscode from 'vscode';
import { connectionEndpoint, KxConnection } from './connection';
import { ConnectionManager } from './connection-manager';
import { ConnectionStore } from './connection-store';
import { ConnectionsTreeProvider } from './connection-tree';
import type { KxDiagnostics } from './diagnostics';
import type { QValue } from './q-ipc';
import {
  buildServerPreviewQuery,
  buildServerTableMetaQuery,
  parseServerColumns,
  parseServerTableNames,
  parseServerVariables,
  safeServerPreviewCellLimit,
  SERVER_TABLES_QUERY,
  SERVER_VARIABLES_QUERY,
  ServerColumnMetadata,
  ServerExplorerSnapshot,
  serverExplorerSnapshotMatches,
  ServerObjectKind,
  ServerVariableMetadata,
  serverPreviewWarning,
} from './server-explorer-model';

export const SERVER_EXPLORER_VIEW_ID = 'vscode-kdb.serverExplorer';
export const SERVER_EXPLORER_AVAILABLE_CONTEXT = 'vscode-kdb.serverExplorer.available';
const DISCONNECTED_RETRY_SUFFIX = ' The active KX profile is disconnected; reconnect it before retrying.';
const CONNECTED_RETRY_SUFFIX = ' Connected. Select Refresh Server Explorer to retry.';

type ServerExplorerNode = ServerCategoryTreeItem | ServerObjectTreeItem |
  ServerColumnTreeItem | ServerStatusTreeItem;

type ServerExplorerState = 'idle' | 'loading' | 'ready' | 'error' | 'canceled';

interface ServerExplorerData {
  state: ServerExplorerState;
  snapshot?: ServerExplorerSnapshot;
  tables: string[];
  variables: ServerVariableMetadata[];
  omittedUnsafeNames: number;
  message?: string;
}

export type ServerPreviewRunner = (
  query: string,
  expectedConnectionId: string
) => Promise<void>;

export class ServerExplorerFeature implements vscode.Disposable {
  private readonly provider: ServerExplorerTreeProvider;
  private readonly disposables: vscode.Disposable[];
  private disposed = false;

  public constructor(
    store: ConnectionStore,
    manager: ConnectionManager,
    connectionTree: ConnectionsTreeProvider,
    diagnostics: KxDiagnostics,
    runPreview: ServerPreviewRunner
  ) {
    this.provider = new ServerExplorerTreeProvider(store, manager, diagnostics);
    const treeView = vscode.window.createTreeView(SERVER_EXPLORER_VIEW_ID, {
      treeDataProvider: this.provider,
      showCollapseAll: true,
    });
    this.disposables = [
      this.provider,
      treeView,
      connectionTree.onDidChangeTreeData(() => this.connectionStateChanged()),
      vscode.commands.registerCommand('vscode-kdb.refreshServerExplorer', () => this.provider.refresh()),
      vscode.commands.registerCommand('vscode-kdb.previewServerObject', argument => this.preview(argument, runPreview)),
    ];
    this.syncAvailability();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.disposables.splice(0).reverse().forEach(disposable => disposable.dispose());
    void vscode.commands.executeCommand('setContext', SERVER_EXPLORER_AVAILABLE_CONTEXT, false);
  }

  private connectionStateChanged(): void {
    this.provider.connectionStateChanged();
    this.syncAvailability();
  }

  private syncAvailability(): void {
    if (this.disposed) {
      return;
    }
    void vscode.commands.executeCommand(
      'setContext',
      SERVER_EXPLORER_AVAILABLE_CONTEXT,
      this.provider.hasAvailableConnection()
    );
  }

  private async preview(argument: unknown, runPreview: ServerPreviewRunner): Promise<void> {
    const item = this.provider.resolveObject(argument);
    if (!item) {
      const message = argument instanceof ServerObjectTreeItem
        ? argument.kind === 'function'
          ? 'Functions and projections are metadata-only because their captured values cannot be safely preview-limited.'
          : 'That Server Explorer item is stale. Refresh Server Explorer and choose the current table or variable.'
        : 'Choose a table or variable in KX Server Explorer first.';
      vscode.window.showWarningMessage(message);
      return;
    }
    const connection = this.provider.currentConnectionFor(item.snapshot);
    if (!connection) {
      this.provider.connectionStateChanged();
      this.syncAvailability();
      vscode.window.showWarningMessage(
        'The Server Explorer connection or namespace changed. Reconnect and refresh before previewing.'
      );
      return;
    }
    const configuredLimit = vscode.workspace
      .getConfiguration('vscode-kdb.serverExplorer')
      .get<unknown>('previewCellLimit');
    const limit = safeServerPreviewCellLimit(configuredLimit);
    const decision = await vscode.window.showWarningMessage(
      serverPreviewWarning(item.objectName, item.kind, connection.database, limit),
      { modal: true },
      'Preview'
    );
    if (decision !== 'Preview') {
      return;
    }
    const confirmedItem = this.provider.resolveObject(item);
    const stillCurrent = confirmedItem && this.provider.currentConnectionFor(confirmedItem.snapshot);
    if (!confirmedItem || !stillCurrent) {
      vscode.window.showWarningMessage(
        'The active KX connection, namespace, or explorer metadata changed before preview started. ' +
        'Refresh Server Explorer and try again.'
      );
      return;
    }
    await runPreview(
      buildServerPreviewQuery(confirmedItem.objectName, confirmedItem.kind, limit),
      stillCurrent.id
    );
  }
}

export class ServerExplorerTreeProvider implements vscode.TreeDataProvider<ServerExplorerNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<ServerExplorerNode | undefined>();
  private readonly ownedObjects = new WeakSet<ServerObjectTreeItem>();
  private readonly columnCache = new Map<string, ServerColumnMetadata[]>();
  private generation = 0;
  private disposed = false;
  private data: ServerExplorerData = emptyServerData('idle');

  public readonly onDidChangeTreeData = this.changeEmitter.event;

  public constructor(
    private readonly store: ConnectionStore,
    private readonly manager: ConnectionManager,
    private readonly diagnostics: KxDiagnostics
  ) {}

  public getTreeItem(element: ServerExplorerNode): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: ServerExplorerNode): Promise<ServerExplorerNode[]> {
    if (!element) {
      return this.rootChildren();
    }
    if (element instanceof ServerCategoryTreeItem) {
      if (!this.categoryIsCurrent(element)) {
        return [new ServerStatusTreeItem('Server Explorer metadata changed. Refresh or reopen this node.', 'info')];
      }
      if (element.category === 'tables') {
        return this.data.tables.map(name => this.ownObject(new ServerObjectTreeItem(
          name,
          'table',
          element.snapshot,
          true,
          element.generation
        )));
      }
      return this.data.variables.map(variable => this.ownObject(new ServerObjectTreeItem(
        variable.name,
        variable.kind,
        element.snapshot,
        false,
        element.generation
      )));
    }
    if (element instanceof ServerObjectTreeItem && element.kind === 'table') {
      return this.tableColumns(element);
    }
    return [];
  }

  public hasAvailableConnection(): boolean {
    return !!this.store.activeConnection();
  }

  public currentConnectionFor(snapshot: ServerExplorerSnapshot): KxConnection | undefined {
    const active = this.store.activeConnection();
    return active && serverExplorerSnapshotMatches(
      snapshot,
      active.id,
      active.database,
      this.manager.isConnected(active.id)
    ) ? active : undefined;
  }

  public resolveObject(argument: unknown): ServerObjectTreeItem | undefined {
    if (!(argument instanceof ServerObjectTreeItem) || !this.ownedObjects.has(argument) ||
      argument.kind === 'function' || argument.generation !== this.generation ||
      this.data.state !== 'ready' || !this.data.snapshot ||
      !sameSnapshot(argument.snapshot, this.data.snapshot) || !this.currentConnectionFor(argument.snapshot)) {
      return undefined;
    }
    const stillListed = argument.kind === 'table'
      ? this.data.tables.includes(argument.objectName)
      : this.data.variables.some(variable =>
        variable.name === argument.objectName && variable.kind === argument.kind);
    return stillListed ? argument : undefined;
  }

  public connectionStateChanged(): void {
    const snapshot = this.data.snapshot;
    const active = this.store.activeConnection();
    if (!active) {
      this.invalidate('Select Refresh Server Explorer to load current-namespace metadata.');
      return;
    }
    if (!this.manager.isConnected(active.id)) {
      const activeSnapshot = { connectionId: active.id, namespace: active.database };
      if (this.data.state === 'error' && snapshot && sameSnapshot(snapshot, activeSnapshot)) {
        if (this.data.message?.includes(CONNECTED_RETRY_SUFFIX)) {
          this.data = {
            ...this.data,
            message: this.data.message.replace(CONNECTED_RETRY_SUFFIX, DISCONNECTED_RETRY_SUFFIX),
          };
        } else if (this.data.message && !this.data.message.includes(DISCONNECTED_RETRY_SUFFIX)) {
          this.data = {
            ...this.data,
            message: `${this.data.message}${DISCONNECTED_RETRY_SUFFIX}`,
          };
        }
        if (!this.disposed) {
          this.changeEmitter.fire(undefined);
        }
        return;
      }
      if (!snapshot || !sameSnapshot(snapshot, activeSnapshot)) {
        this.generation++;
      }
      this.columnCache.clear();
      this.data = {
        ...emptyServerData('idle'),
        snapshot: activeSnapshot,
        message: 'The active KX profile is disconnected. Reconnect it, then select Refresh Server Explorer.',
      };
      if (!this.disposed) {
        this.changeEmitter.fire(undefined);
      }
      return;
    }
    if (!snapshot || active.id !== snapshot.connectionId || active.database !== snapshot.namespace) {
      this.invalidate('Select Refresh Server Explorer to load current-namespace metadata.');
      return;
    }
    if (this.data.state === 'error' && this.data.message?.includes(DISCONNECTED_RETRY_SUFFIX)) {
      this.data = {
        ...this.data,
        message: this.data.message.replace(
          DISCONNECTED_RETRY_SUFFIX,
          CONNECTED_RETRY_SUFFIX
        ),
      };
      if (!this.disposed) {
        this.changeEmitter.fire(undefined);
      }
    } else if (this.data.state === 'idle' && this.data.message?.startsWith('The active KX profile is disconnected.')) {
      this.data = {
        ...emptyServerData('idle'),
        snapshot,
        message: 'Connected. Select Refresh Server Explorer to load current-namespace metadata.',
      };
      if (!this.disposed) {
        this.changeEmitter.fire(undefined);
      }
    }
  }

  public async refresh(): Promise<void> {
    const connection = this.store.activeConnection();
    if (!connection || !this.manager.isConnected(connection.id)) {
      this.invalidate('Connect the active KX connection before refreshing Server Explorer.');
      vscode.window.showWarningMessage('KX Server Explorer requires an active connected direct q IPC profile.');
      return;
    }

    const snapshot: ServerExplorerSnapshot = {
      connectionId: connection.id,
      namespace: connection.database,
    };
    const generation = ++this.generation;
    const started = Date.now();
    this.columnCache.clear();
    this.data = { ...emptyServerData('loading'), snapshot, message: 'Loading q metadata…' };
    this.changeEmitter.fire(undefined);
    this.writeDiagnostic(connection, 'start', 'refresh');

    try {
      const [tablesValue, variablesValue] = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Refreshing KX Server Explorer for ${connection.name} (${connection.database})`,
        cancellable: true,
      }, async (_progress, token) => {
        const tables = await waitWithLocalCancellation(
          () => this.manager.executeInConfiguredNamespace(connection, SERVER_TABLES_QUERY),
          token
        );
        if (!this.isCurrent(generation, snapshot)) {
          throw new StaleMetadataResultError();
        }
        const variables = await waitWithLocalCancellation(
          () => this.manager.executeInConfiguredNamespace(connection, SERVER_VARIABLES_QUERY),
          token
        );
        return [tables, variables] as [QValue, QValue];
      });
      if (!this.isCurrent(generation, snapshot)) {
        this.writeDiagnostic(connection, 'canceled', 'refresh', Date.now() - started);
        return;
      }
      const parsedTables = parseServerTableNames(tablesValue);
      const parsedVariables = parseServerVariables(variablesValue);
      this.data = {
        state: 'ready',
        snapshot,
        tables: parsedTables.names,
        variables: parsedVariables.variables,
        omittedUnsafeNames: parsedTables.omittedUnsafeNames + parsedVariables.omittedUnsafeNames,
      };
      this.writeDiagnostic(connection, 'success', 'refresh', Date.now() - started);
    } catch (error) {
      if (!this.isGenerationCurrent(generation, snapshot)) {
        this.writeDiagnostic(
          connection,
          'canceled',
          'refresh',
          Date.now() - started,
          error
        );
        return;
      }
      const canceled = error instanceof LocalMetadataCancellationError;
      const baseMessage = canceled
        ? 'Server Explorer refresh wait canceled locally. q metadata may still finish on the server; select Refresh to retry.'
        : `Server Explorer refresh failed: ${errorMessage(error)}`;
      const message = !canceled && !this.manager.isConnected(connection.id)
        ? `${baseMessage}${DISCONNECTED_RETRY_SUFFIX}`
        : baseMessage;
      this.data = { ...emptyServerData(canceled ? 'canceled' : 'error'), snapshot, message };
      this.writeDiagnostic(
        connection,
        canceled ? 'canceled' : 'failed',
        'refresh',
        Date.now() - started,
        error
      );
      if (!canceled) {
        vscode.window.showErrorMessage(`KX ${message}`);
      }
    } finally {
      if (this.generation === generation) {
        this.changeEmitter.fire(undefined);
      }
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.generation++;
    this.columnCache.clear();
    this.changeEmitter.dispose();
  }

  private rootChildren(): ServerExplorerNode[] {
    if (this.data.state !== 'ready' || !this.data.snapshot) {
      const active = this.store.activeConnection();
      const message = this.data.state === 'error' && this.data.message
        ? this.data.message
        : active && !this.manager.isConnected(active.id)
          ? 'The active KX profile is disconnected. Reconnect it, then select Refresh Server Explorer.'
          : this.data.message || 'Select Refresh Server Explorer to load current-namespace metadata.';
      return [new ServerStatusTreeItem(
        message,
        this.data.state === 'error' ? 'error' : this.data.state === 'loading' ? 'loading' : 'info'
      )];
    }
    const nodes: ServerExplorerNode[] = [
      new ServerCategoryTreeItem(
        'Tables',
        'tables',
        this.data.tables.length,
        this.data.snapshot,
        this.generation
      ),
      new ServerCategoryTreeItem(
        'Variables & Functions',
        'variables',
        this.data.variables.length,
        this.data.snapshot,
        this.generation
      ),
    ];
    if (this.data.omittedUnsafeNames > 0) {
      nodes.push(new ServerStatusTreeItem(
        `${this.data.omittedUnsafeNames} non-standard object name${this.data.omittedUnsafeNames === 1 ? ' was' : 's were'} omitted for safe execution.`,
        'info'
      ));
    }
    return nodes;
  }

  private async tableColumns(table: ServerObjectTreeItem): Promise<ServerExplorerNode[]> {
    if (!this.ownedObjects.has(table) || table.generation !== this.generation ||
      this.data.state !== 'ready' || !this.data.tables.includes(table.objectName)) {
      return [new ServerStatusTreeItem('Server Explorer metadata changed. Refresh or reopen this table.', 'info')];
    }
    const connection = this.currentConnectionFor(table.snapshot);
    if (!connection) {
      return [new ServerStatusTreeItem('Connection or namespace changed. Refresh Server Explorer.', 'error')];
    }
    const key = `${table.snapshot.connectionId}\u0000${table.snapshot.namespace}\u0000${table.objectName}`;
    const cached = this.columnCache.get(key);
    if (cached) {
      return cached.length
        ? cached.map(column => new ServerColumnTreeItem(column))
        : [new ServerStatusTreeItem('No columns returned by q meta.', 'info')];
    }

    const generation = this.generation;
    const started = Date.now();
    this.writeDiagnostic(connection, 'start', 'meta');
    try {
      const value = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Loading q meta for ${table.objectName}`,
        cancellable: true,
      }, (_progress, token) => waitWithLocalCancellation(
        () => this.manager.executeInConfiguredNamespace(
          connection,
          buildServerTableMetaQuery(table.objectName)
        ),
        token
      ));
      if (!this.isCurrent(generation, table.snapshot)) {
        this.writeDiagnostic(connection, 'canceled', 'meta', Date.now() - started);
        return [new ServerStatusTreeItem('Connection or namespace changed. Refresh Server Explorer.', 'error')];
      }
      const columns = parseServerColumns(value);
      this.columnCache.set(key, columns);
      this.writeDiagnostic(connection, 'success', 'meta', Date.now() - started);
      return columns.length
        ? columns.map(column => new ServerColumnTreeItem(column))
        : [new ServerStatusTreeItem('No columns returned by q meta.', 'info')];
    } catch (error) {
      if (!this.isGenerationCurrent(generation, table.snapshot)) {
        this.writeDiagnostic(connection, 'canceled', 'meta', Date.now() - started, error);
        return [new ServerStatusTreeItem('Connection or namespace changed. Refresh Server Explorer.', 'error')];
      }
      const canceled = error instanceof LocalMetadataCancellationError;
      const failure = new Error(canceled
        ? 'Column metadata wait canceled locally. Collapse and expand the table to retry.'
        : errorMessage(error));
      this.writeDiagnostic(
        connection,
        canceled ? 'canceled' : 'failed',
        'meta',
        Date.now() - started,
        error
      );
      if (!canceled && !this.manager.isConnected(connection.id)) {
        this.data = {
          ...emptyServerData('error'),
          snapshot: table.snapshot,
          message: `Server Explorer column metadata failed: ${failure.message}.${DISCONNECTED_RETRY_SUFFIX}`,
        };
        this.changeEmitter.fire(undefined);
      }
      return [new ServerStatusTreeItem(`Could not load columns: ${failure.message}`, canceled ? 'info' : 'error')];
    }
  }

  private ownObject(item: ServerObjectTreeItem): ServerObjectTreeItem {
    this.ownedObjects.add(item);
    return item;
  }

  private isCurrent(generation: number, snapshot: ServerExplorerSnapshot): boolean {
    return !this.disposed && this.generation === generation && !!this.currentConnectionFor(snapshot);
  }

  private isGenerationCurrent(generation: number, snapshot: ServerExplorerSnapshot): boolean {
    const active = this.store.activeConnection();
    return !this.disposed && this.generation === generation && !!active &&
      active.id === snapshot.connectionId && active.database === snapshot.namespace;
  }

  private categoryIsCurrent(category: ServerCategoryTreeItem): boolean {
    return category.generation === this.generation && this.data.state === 'ready' &&
      !!this.data.snapshot && sameSnapshot(category.snapshot, this.data.snapshot) &&
      !!this.currentConnectionFor(category.snapshot);
  }

  private invalidate(message: string): void {
    this.generation++;
    this.columnCache.clear();
    this.data = { ...emptyServerData('idle'), message };
    if (!this.disposed) {
      this.changeEmitter.fire(undefined);
    }
  }

  private writeDiagnostic(
    connection: KxConnection,
    status: 'start' | 'success' | 'failed' | 'canceled',
    operation: 'refresh' | 'meta',
    durationMs?: number,
    error?: unknown
  ): void {
    this.diagnostics.event({
      phase: 'query',
      endpoint: connectionEndpoint(connection),
      status,
      durationMs,
      details: { scope: 'server-explorer', operation, namespace: connection.database },
      error,
      includeErrorMessage: false,
    });
  }
}

export class ServerCategoryTreeItem extends vscode.TreeItem {
  public constructor(
    label: string,
    public readonly category: 'tables' | 'variables',
    count: number,
    public readonly snapshot: ServerExplorerSnapshot,
    public readonly generation: number
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.description = String(count);
    this.contextValue = `vscode-kdb.serverExplorer.category.${category}`;
    this.iconPath = new vscode.ThemeIcon(category === 'tables' ? 'table' : 'symbol-variable');
  }
}

export class ServerObjectTreeItem extends vscode.TreeItem {
  public constructor(
    public readonly objectName: string,
    public readonly kind: ServerObjectKind,
    public readonly snapshot: ServerExplorerSnapshot,
    expandable: boolean,
    public readonly generation: number
  ) {
    super(objectName, expandable
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None);
    this.description = kind;
    this.contextValue = `vscode-kdb.serverExplorer.object.${kind}`;
    this.iconPath = new vscode.ThemeIcon(
      kind === 'table' ? 'table' : kind === 'function' ? 'symbol-function' : 'symbol-variable'
    );
    this.tooltip = kind === 'function'
      ? `function ${objectName} in ${snapshot.namespace} • metadata-only preview safety`
      : `${kind} ${objectName} in ${snapshot.namespace}`;
  }
}

export class ServerColumnTreeItem extends vscode.TreeItem {
  public constructor(public readonly column: ServerColumnMetadata) {
    super(column.name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'vscode-kdb.serverExplorer.column';
    const details = [
      column.qTypeName,
      column.qTypeCode ? `(${column.qTypeCode})` : undefined,
      column.foreignKey ? `foreign key ${column.foreignKey}` : undefined,
      column.attribute ? `attribute ${column.attribute}` : undefined,
    ].filter(Boolean);
    this.description = details.join(' • ');
    this.iconPath = new vscode.ThemeIcon('symbol-field');
  }
}

export class ServerStatusTreeItem extends vscode.TreeItem {
  public constructor(label: string, kind: 'info' | 'loading' | 'error') {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = `vscode-kdb.serverExplorer.status.${kind}`;
    this.iconPath = new vscode.ThemeIcon(
      kind === 'error' ? 'error' : kind === 'loading' ? 'loading~spin' : 'info'
    );
    this.tooltip = label;
  }
}

class LocalMetadataCancellationError extends Error {
  public constructor() {
    super('Local metadata wait canceled.');
    this.name = 'KxMetadataCanceled';
  }
}

class StaleMetadataResultError extends Error {
  public constructor() {
    super('Server Explorer metadata became stale before it was displayed.');
    this.name = 'KxMetadataStale';
  }
}

function emptyServerData(state: ServerExplorerState): ServerExplorerData {
  return { state, tables: [], variables: [], omittedUnsafeNames: 0 };
}

async function waitWithLocalCancellation<T>(
  operation: () => Promise<T>,
  token: vscode.CancellationToken
): Promise<T> {
  if (token.isCancellationRequested) {
    throw new LocalMetadataCancellationError();
  }
  let rejectCancellation!: (error: Error) => void;
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  void cancellation.catch(() => undefined);
  const subscription = token.onCancellationRequested(() => {
    rejectCancellation(new LocalMetadataCancellationError());
  });
  try {
    if (token.isCancellationRequested) {
      throw new LocalMetadataCancellationError();
    }
    return await Promise.race([operation(), cancellation]);
  } finally {
    subscription.dispose();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameSnapshot(left: ServerExplorerSnapshot, right: ServerExplorerSnapshot): boolean {
  return left.connectionId === right.connectionId && left.namespace === right.namespace;
}
