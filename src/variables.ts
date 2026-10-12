import * as vscode from 'vscode';
import { connectionEndpoint, KxConnection } from './connection';
import { ConnectionManager } from './connection-manager';
import { ConnectionStore } from './connection-store';
import { ConnectionsTreeProvider } from './connection-tree';
import type { KxDiagnostics } from './diagnostics';
import type { QValue } from './q-ipc';
import type { QMetadataService } from './q-metadata-service';
import {
  buildRuntimeBindingPreviewQuery,
  buildRuntimeContextQuery,
  parseRuntimeBindings,
  RUNTIME_PROCESS_ROOT_QUERY,
  RuntimeBindingKind,
  RuntimeBindingMetadata,
  runtimeBindingPreviewWarning,
  safeServerPreviewCellLimit,
  ServerExplorerSnapshot,
  serverExplorerSnapshotMatches,
} from './server-explorer-model';
import type { ServerPreviewRunner } from './server-explorer';

export const VARIABLES_VIEW_ID = 'vscode-kdb.variables';

type VariablesNode = VariableTreeItem | VariablesContextTreeItem | VariablesStatusTreeItem;
type VariablesState = 'idle' | 'loading' | 'ready' | 'error' | 'canceled';
type ContextState = 'unloaded' | 'loading' | 'ready' | 'error' | 'canceled';

interface ContextData {
  state: ContextState;
  bindings: RuntimeBindingMetadata[];
  omittedUnsafeNames: number;
  message?: string;
}

interface VariablesData {
  state: VariablesState;
  snapshot?: ServerExplorerSnapshot;
  rootBindings: RuntimeBindingMetadata[];
  namespaces: RuntimeBindingMetadata[];
  omittedUnsafeNames: number;
  message?: string;
}

interface LoadedBindings {
  bindings: RuntimeBindingMetadata[];
  omittedUnsafeNames: number;
}

export class VariablesFeature implements vscode.Disposable {
  private readonly provider: VariablesTreeProvider;
  private readonly disposables: vscode.Disposable[];
  private disposed = false;

  public constructor(
    store: ConnectionStore,
    manager: ConnectionManager,
    connectionTree: ConnectionsTreeProvider,
    diagnostics: KxDiagnostics,
    runPreview: ServerPreviewRunner,
    qMetadata?: QMetadataService
  ) {
    this.provider = new VariablesTreeProvider(store, manager, diagnostics, qMetadata);
    const treeView = vscode.window.createTreeView(VARIABLES_VIEW_ID, {
      treeDataProvider: this.provider,
      showCollapseAll: true,
    });
    this.disposables = [
      this.provider,
      treeView,
      connectionTree.onDidChangeTreeData(() => this.provider.connectionStateChanged()),
      vscode.commands.registerCommand('vscode-kdb.refreshVariables', () => this.provider.refresh()),
      vscode.commands.registerCommand(
        'vscode-kdb.openVariableInResults',
        argument => this.openVariable(argument, runPreview)
      ),
    ];
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposables.splice(0).reverse().forEach(disposable => disposable.dispose());
  }

  private async openVariable(argument: unknown, runPreview: ServerPreviewRunner): Promise<void> {
    const item = this.provider.resolveVariable(argument);
    if (!item) {
      vscode.window.showWarningMessage(
        'Choose a current data or table binding in KX Variables first, or refresh the view.'
      );
      return;
    }
    const connection = this.provider.currentConnectionFor(item.snapshot);
    if (!connection) {
      this.provider.connectionStateChanged();
      vscode.window.showWarningMessage(
        'The Variables connection or namespace changed. Reconnect and refresh before opening it.'
      );
      return;
    }
    const configuredLimit = vscode.workspace
      .getConfiguration('vscode-kdb.serverExplorer')
      .get<unknown>('previewCellLimit');
    const limit = safeServerPreviewCellLimit(configuredLimit);
    const decision = await vscode.window.showWarningMessage(
      runtimeBindingPreviewWarning(item.binding, limit),
      { modal: true },
      'Open in KX Results'
    );
    if (decision !== 'Open in KX Results') return;

    try {
      const current = await this.provider.revalidateVariable(item);
      if (!current) {
        vscode.window.showWarningMessage(
          'The binding, active KX connection, or namespace changed. Refresh KX Variables and try again.'
        );
        return;
      }
      await runPreview(
        buildRuntimeBindingPreviewQuery(
          item.binding.context,
          item.binding.name,
          item.binding.kind,
          limit
        ),
        current.id
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `KX could not revalidate binding "${item.binding.qualifiedName}": ${errorMessage(error)}`
      );
    }
  }
}

export class VariablesTreeProvider implements vscode.TreeDataProvider<VariablesNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<VariablesNode | undefined>();
  private readonly ownedVariables = new WeakSet<VariableTreeItem>();
  private readonly ownedContexts = new WeakSet<VariablesContextTreeItem>();
  private readonly contexts = new Map<string, ContextData>();
  private readonly contextLoads = new Map<string, Promise<void>>();
  private readonly pendingControllers = new Set<AbortController>();
  private generation = 0;
  private disposed = false;
  private data: VariablesData = emptyVariablesData('idle');
  private readonly metadataSubscription?: vscode.Disposable;

  public readonly onDidChangeTreeData = this.changeEmitter.event;

  public constructor(
    private readonly store: ConnectionStore,
    private readonly manager: ConnectionManager,
    private readonly diagnostics: KxDiagnostics,
    private readonly qMetadata?: QMetadataService
  ) {
    this.metadataSubscription = qMetadata?.onDidInvalidate(() => this.metadataInvalidated());
  }

  public getTreeItem(element: VariablesNode): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: VariablesNode): VariablesNode[] | Promise<VariablesNode[]> {
    if (!element) return this.rootChildren();
    if (!(element instanceof VariablesContextTreeItem)) return [];
    if (!this.resolveContext(element)) {
      return [new VariablesStatusTreeItem('Variables metadata changed. Select Refresh Variables.', 'info')];
    }
    return this.contextChildren(element);
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

  public resolveVariable(argument: unknown): VariableTreeItem | undefined {
    if (!(argument instanceof VariableTreeItem) || !this.ownedVariables.has(argument) ||
      argument.generation !== this.generation || this.data.state !== 'ready' ||
      !this.data.snapshot || !sameSnapshot(argument.snapshot, this.data.snapshot) ||
      !this.currentConnectionFor(argument.snapshot) ||
      (argument.binding.kind !== 'variable' && argument.binding.kind !== 'table')) {
      return undefined;
    }
    const context = this.contexts.get(argument.binding.context);
    const current = context?.state === 'ready' && context.bindings.some(binding =>
      sameBinding(binding, argument.binding));
    return current ? argument : undefined;
  }

  public connectionStateChanged(): void {
    const active = this.store.activeConnection();
    const snapshot = this.data.snapshot;
    if (active && this.manager.isConnected(active.id) && snapshot &&
      active.id === snapshot.connectionId && active.database === snapshot.namespace) {
      return;
    }
    this.invalidatePending();
    if (!active) {
      this.data = {
        ...emptyVariablesData('idle'),
        message: 'Activate a KX connection, then select Refresh Variables.',
      };
    } else if (!this.manager.isConnected(active.id)) {
      this.data = {
        ...emptyVariablesData('idle'),
        snapshot: { connectionId: active.id, namespace: active.database },
        message: 'The active KX profile is disconnected. Reconnect it, then select Refresh Variables.',
      };
    } else {
      this.data = {
        ...emptyVariablesData('idle'),
        snapshot: { connectionId: active.id, namespace: active.database },
        message: 'The active KX runtime changed. Select Refresh Variables.',
      };
    }
    if (!this.disposed) this.changeEmitter.fire(undefined);
  }

  public metadataInvalidated(): void {
    if (this.disposed) return;
    const active = this.store.activeConnection();
    this.invalidatePending();
    this.data = {
      ...emptyVariablesData('idle'),
      ...(active ? { snapshot: { connectionId: active.id, namespace: active.database } } : {}),
      message: active && this.manager.isConnected(active.id)
        ? 'The active KX runtime metadata changed. Select Refresh Variables.'
        : 'The active KX runtime changed. Reconnect it, then select Refresh Variables.',
    };
    this.changeEmitter.fire(undefined);
  }

  public async refresh(): Promise<void> {
    const connection = this.store.activeConnection();
    if (!connection || !this.manager.isConnected(connection.id)) {
      this.connectionStateChanged();
      vscode.window.showWarningMessage(
        'KX Variables requires an active connected direct q IPC profile.'
      );
      return;
    }
    this.invalidatePending();
    const snapshot = { connectionId: connection.id, namespace: connection.database };
    const generation = this.generation;
    const started = Date.now();
    this.data = {
      ...emptyVariablesData('loading'),
      snapshot,
      message: 'Loading q process bindings…',
    };
    this.changeEmitter.fire(undefined);
    this.writeDiagnostic(connection, 'start', 'refresh');
    try {
      const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Refreshing KX Variables for ${connection.name}`,
        cancellable: true,
      }, (_progress, token) => this.loadWithLocalCancellation('.', token));
      if (!result || !this.isCurrent(generation, snapshot)) {
        this.writeDiagnostic(connection, 'canceled', 'refresh', Date.now() - started);
        return;
      }
      const rootBindings = result.bindings.filter(binding => binding.kind !== 'namespace');
      const namespaces = result.bindings.filter(binding => binding.kind === 'namespace');
      this.contexts.set('.', {
        state: 'ready',
        bindings: rootBindings,
        omittedUnsafeNames: 0,
      });
      this.data = {
        state: 'ready',
        snapshot,
        rootBindings,
        namespaces,
        omittedUnsafeNames: result.omittedUnsafeNames,
      };
      this.writeDiagnostic(connection, 'success', 'refresh', Date.now() - started);
    } catch (error) {
      if (!this.isGenerationCurrent(generation, snapshot)) {
        this.writeDiagnostic(connection, 'canceled', 'refresh', Date.now() - started, error);
        return;
      }
      const canceled = error instanceof LocalVariablesCancellationError;
      const message = canceled
        ? 'Variables refresh wait canceled locally. q metadata may still finish on the server; select Refresh to retry.'
        : `Variables refresh failed: ${errorMessage(error)}`;
      this.data = {
        ...emptyVariablesData(canceled ? 'canceled' : 'error'),
        snapshot,
        message,
      };
      this.writeDiagnostic(
        connection,
        canceled ? 'canceled' : 'failed',
        'refresh',
        Date.now() - started,
        error
      );
      if (!canceled) vscode.window.showErrorMessage(`KX ${message}`);
    } finally {
      if (!this.disposed && this.generation === generation) this.changeEmitter.fire(undefined);
    }
  }

  public async revalidateVariable(item: VariableTreeItem): Promise<KxConnection | undefined> {
    if (!this.resolveVariable(item)) return undefined;
    const generation = this.generation;
    const result = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Checking KX binding ${item.binding.qualifiedName}`,
      cancellable: true,
    }, (_progress, token) => this.loadWithLocalCancellation(item.binding.context, token));
    if (!result || !this.isCurrent(generation, item.snapshot)) return undefined;
    const exists = result.bindings.some(binding => sameBinding(binding, item.binding));
    if (!exists) {
      this.invalidatePending();
      this.data = {
        ...emptyVariablesData('idle'),
        snapshot: item.snapshot,
        message: `Binding "${item.binding.qualifiedName}" changed. Select Refresh Variables.`,
      };
      this.changeEmitter.fire(undefined);
      return undefined;
    }
    return this.currentConnectionFor(item.snapshot);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.invalidatePending();
    this.metadataSubscription?.dispose();
    this.changeEmitter.dispose();
  }

  private rootChildren(): VariablesNode[] {
    if (this.data.state !== 'ready' || !this.data.snapshot) {
      return [new VariablesStatusTreeItem(this.statusMessage(), this.statusKind())];
    }
    const nodes: VariablesNode[] = [];
    if (!this.data.rootBindings.length && !this.data.namespaces.length) {
      nodes.push(new VariablesStatusTreeItem('No application bindings found in the q process.', 'info'));
    }
    if (this.data.rootBindings.length) nodes.push(this.makeContextItem('.', true));
    nodes.push(...this.data.namespaces.map(binding => this.makeContextItem(
      binding.qualifiedName,
      false,
      binding
    )));
    if (this.data.omittedUnsafeNames > 0) nodes.push(omittedNamesItem(this.data.omittedUnsafeNames));
    return nodes;
  }

  private async contextChildren(item: VariablesContextTreeItem): Promise<VariablesNode[]> {
    let data = this.contexts.get(item.context);
    if (!data) {
      data = { state: 'unloaded', bindings: [], omittedUnsafeNames: 0 };
      this.contexts.set(item.context, data);
    }
    if (data.state === 'unloaded' || data.state === 'error' || data.state === 'canceled') {
      await this.loadContext(item);
      data = this.contexts.get(item.context) ?? data;
    } else if (data.state === 'loading') {
      await this.contextLoads.get(item.context);
      data = this.contexts.get(item.context) ?? data;
    }
    if (!this.resolveContext(item)) {
      return [new VariablesStatusTreeItem('Variables metadata changed. Select Refresh Variables.', 'info')];
    }
    if (data.state !== 'ready') {
      return [new VariablesStatusTreeItem(
        data.message ?? `Could not load ${item.context}. Expand it to retry.`,
        data.state === 'loading' ? 'loading' : data.state === 'error' ? 'error' : 'info'
      )];
    }
    const nodes: VariablesNode[] = data.bindings.map(binding => binding.kind === 'namespace'
      ? this.makeContextItem(binding.qualifiedName, false, binding)
      : this.makeVariableItem(binding));
    if (!nodes.length) nodes.push(new VariablesStatusTreeItem(`No bindings found in ${item.context}.`, 'info'));
    if (data.omittedUnsafeNames > 0) nodes.push(omittedNamesItem(data.omittedUnsafeNames));
    return nodes;
  }

  private async loadContext(item: VariablesContextTreeItem): Promise<void> {
    const existing = this.contextLoads.get(item.context);
    if (existing) return existing;
    const generation = this.generation;
    const snapshot = item.snapshot;
    const connection = this.currentConnectionFor(snapshot);
    if (!connection) return;
    const controller = new AbortController();
    this.pendingControllers.add(controller);
    this.contexts.set(item.context, {
      state: 'loading',
      bindings: [],
      omittedUnsafeNames: 0,
      message: `Loading ${item.context}…`,
    });
    this.changeEmitter.fire(item);
    this.writeDiagnostic(connection, 'start', 'expand', undefined, undefined, item.context);
    const started = Date.now();
    const loading = (async () => {
      try {
        const result = await this.loadBindings(item.context, controller.signal);
        if (!result || !this.isCurrent(generation, snapshot) || controller.signal.aborted) return;
        this.contexts.set(item.context, {
          state: 'ready',
          bindings: result.bindings,
          omittedUnsafeNames: result.omittedUnsafeNames,
        });
        this.writeDiagnostic(connection, 'success', 'expand', Date.now() - started, undefined, item.context);
      } catch (error) {
        if (!this.isGenerationCurrent(generation, snapshot)) return;
        const canceled = controller.signal.aborted;
        this.contexts.set(item.context, {
          state: canceled ? 'canceled' : 'error',
          bindings: [],
          omittedUnsafeNames: 0,
          message: canceled
            ? `${item.context} metadata wait was canceled locally. Expand it to retry.`
            : `Could not load ${item.context}: ${errorMessage(error)}. Expand it to retry.`,
        });
        this.writeDiagnostic(
          connection,
          canceled ? 'canceled' : 'failed',
          'expand',
          Date.now() - started,
          error,
          item.context
        );
      } finally {
        this.pendingControllers.delete(controller);
        this.contextLoads.delete(item.context);
        if (!this.disposed && this.generation === generation) this.changeEmitter.fire(item);
      }
    })();
    this.contextLoads.set(item.context, loading);
    return loading;
  }

  private async loadWithLocalCancellation(
    context: string,
    token: vscode.CancellationToken
  ): Promise<LoadedBindings | undefined> {
    if (token.isCancellationRequested) throw new LocalVariablesCancellationError();
    const controller = new AbortController();
    this.pendingControllers.add(controller);
    let rejectCancellation!: (error: Error) => void;
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    void cancellation.catch(() => undefined);
    const subscription = token.onCancellationRequested(() => {
      controller.abort();
      rejectCancellation(new LocalVariablesCancellationError());
    });
    try {
      return await Promise.race([this.loadBindings(context, controller.signal), cancellation]);
    } finally {
      subscription.dispose();
      this.pendingControllers.delete(controller);
    }
  }

  private async loadBindings(context: string, signal: AbortSignal): Promise<LoadedBindings | undefined> {
    if (this.qMetadata) {
      const metadata = context === '.'
        ? await this.qMetadata.processRoot(signal)
        : await this.qMetadata.processContext(context, signal);
      return metadata ? {
        bindings: [...metadata.bindings],
        omittedUnsafeNames: metadata.omittedUnsafeNames,
      } : undefined;
    }
    const connection = this.store.activeConnection();
    if (!connection || !this.manager.isConnected(connection.id)) return undefined;
    const query = context === '.' ? RUNTIME_PROCESS_ROOT_QUERY : buildRuntimeContextQuery(context);
    const value = await this.manager.executeInConfiguredNamespace(
      connection,
      query,
      undefined,
      signal
    );
    return parseRuntimeBindings(value as QValue, context);
  }

  private resolveContext(item: VariablesContextTreeItem): boolean {
    return this.ownedContexts.has(item) && item.generation === this.generation &&
      this.data.state === 'ready' && !!this.data.snapshot &&
      sameSnapshot(item.snapshot, this.data.snapshot) && !!this.currentConnectionFor(item.snapshot);
  }

  private makeContextItem(
    context: string,
    root: boolean,
    binding?: RuntimeBindingMetadata
  ): VariablesContextTreeItem {
    const item = new VariablesContextTreeItem(
      context,
      root,
      this.data.snapshot!,
      this.generation,
      binding
    );
    this.ownedContexts.add(item);
    return item;
  }

  private makeVariableItem(binding: RuntimeBindingMetadata): VariableTreeItem {
    const item = new VariableTreeItem(binding, this.data.snapshot!, this.generation);
    this.ownedVariables.add(item);
    return item;
  }

  private invalidatePending(): void {
    this.generation++;
    for (const controller of this.pendingControllers) controller.abort();
    this.pendingControllers.clear();
    this.contextLoads.clear();
    this.contexts.clear();
  }

  private isCurrent(generation: number, snapshot: ServerExplorerSnapshot): boolean {
    return !this.disposed && this.generation === generation && !!this.currentConnectionFor(snapshot);
  }

  private isGenerationCurrent(generation: number, snapshot: ServerExplorerSnapshot): boolean {
    const active = this.store.activeConnection();
    return !this.disposed && this.generation === generation && !!active &&
      active.id === snapshot.connectionId && active.database === snapshot.namespace;
  }

  private statusMessage(): string {
    if (this.data.message) return this.data.message;
    const active = this.store.activeConnection();
    if (!active) return 'Activate a KX connection, then select Refresh Variables.';
    if (!this.manager.isConnected(active.id)) {
      return 'The active KX profile is disconnected. Reconnect it, then select Refresh Variables.';
    }
    return 'Select Refresh Variables to load current q process bindings.';
  }

  private statusKind(): 'info' | 'loading' | 'error' {
    return this.data.state === 'loading' ? 'loading' : this.data.state === 'error' ? 'error' : 'info';
  }

  private writeDiagnostic(
    connection: KxConnection,
    status: 'start' | 'success' | 'failed' | 'canceled',
    operation: 'refresh' | 'expand',
    durationMs?: number,
    error?: unknown,
    context?: string
  ): void {
    this.diagnostics.event({
      phase: 'query',
      endpoint: connectionEndpoint(connection),
      status,
      durationMs,
      details: {
        scope: 'variables',
        operation,
        namespace: connection.database,
        ...(context ? { context } : {}),
      },
      error,
      includeErrorMessage: false,
    });
  }
}

export class VariablesContextTreeItem extends vscode.TreeItem {
  public constructor(
    public readonly context: string,
    public readonly root: boolean,
    public readonly snapshot: ServerExplorerSnapshot,
    public readonly generation: number,
    public readonly binding?: RuntimeBindingMetadata
  ) {
    super(root ? 'Root (.)' : context, root
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed);
    this.description = root ? 'default namespace' : 'namespace';
    this.contextValue = root
      ? 'vscode-kdb.variables.context.root'
      : 'vscode-kdb.variables.context.namespace';
    this.iconPath = new vscode.ThemeIcon(root ? 'symbol-folder' : 'symbol-namespace');
    this.tooltip = root
      ? `Root bindings in ${snapshot.connectionId}`
      : `${context} • application namespace`;
  }
}

export class VariableTreeItem extends vscode.TreeItem {
  public readonly variable: RuntimeBindingMetadata;

  public constructor(
    public readonly binding: RuntimeBindingMetadata,
    public readonly snapshot: ServerExplorerSnapshot,
    public readonly generation: number
  ) {
    super(binding.context === '.' ? binding.name : binding.qualifiedName, vscode.TreeItemCollapsibleState.None);
    this.variable = binding;
    this.description = binding.qType === undefined
      ? bindingKindLabel(binding.kind)
      : `${bindingKindLabel(binding.kind)} • q type ${binding.qType}`;
    this.contextValue = `vscode-kdb.variables.${binding.kind}`;
    this.iconPath = new vscode.ThemeIcon(bindingIcon(binding.kind));
    this.tooltip = `${binding.qualifiedName} • ${bindingKindLabel(binding.kind)}${
      binding.qType === undefined ? '' : ` • q type ${binding.qType}`
    }`;
  }
}

export class VariablesStatusTreeItem extends vscode.TreeItem {
  public constructor(label: string, kind: 'info' | 'loading' | 'error') {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = `vscode-kdb.variables.status.${kind}`;
    this.iconPath = new vscode.ThemeIcon(
      kind === 'error' ? 'error' : kind === 'loading' ? 'loading~spin' : 'info'
    );
    this.tooltip = label;
  }
}

class LocalVariablesCancellationError extends Error {
  public constructor() {
    super('Local variables wait canceled.');
    this.name = 'KxVariablesCanceled';
  }
}

function emptyVariablesData(state: VariablesState): VariablesData {
  return {
    state,
    rootBindings: [],
    namespaces: [],
    omittedUnsafeNames: 0,
  };
}

function sameSnapshot(left: ServerExplorerSnapshot, right: ServerExplorerSnapshot): boolean {
  return left.connectionId === right.connectionId && left.namespace === right.namespace;
}

function sameBinding(left: RuntimeBindingMetadata, right: RuntimeBindingMetadata): boolean {
  return left.context === right.context && left.name === right.name &&
    left.qualifiedName === right.qualifiedName && left.kind === right.kind &&
    left.qType === right.qType;
}

function omittedNamesItem(count: number): VariablesStatusTreeItem {
  return new VariablesStatusTreeItem(
    `${count} non-standard object name${count === 1 ? ' was' : 's were'} omitted for safe execution.`,
    'info'
  );
}

function bindingKindLabel(kind: RuntimeBindingKind): string {
  return kind === 'variable' ? 'data' : kind;
}

function bindingIcon(kind: RuntimeBindingKind): string {
  switch (kind) {
    case 'table': return 'table';
    case 'function': return 'symbol-function';
    case 'projection': return 'symbol-method';
    case 'unknown': return 'question';
    case 'namespace': return 'symbol-namespace';
    default: return 'symbol-variable';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
