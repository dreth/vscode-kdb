import * as vscode from 'vscode';
import { ConnectionManager } from './connection-manager';
import { ConnectionStore } from './connection-store';
import { ConnectionsTreeProvider } from './connection-tree';
import type { KxDiagnostics } from './diagnostics';
import {
  QueryHistoryCapture,
  QueryHistoryFeature,
  QueryHistoryRunner,
} from './query-history';
import { QueryHistoryRecordInput, QueryHistoryStore } from './query-history-model';
import {
  SERVER_EXPLORER_AVAILABLE_CONTEXT,
  ServerExplorerFeature,
  ServerPreviewRunner,
} from './server-explorer';

export class FeatureControls implements vscode.Disposable {
  private serverExplorer: ServerExplorerFeature | undefined;
  private queryHistory: QueryHistoryFeature | undefined;
  private readonly queryHistoryStore: QueryHistoryStore;
  private disposed = false;

  public constructor(
    context: vscode.ExtensionContext,
    private readonly store: ConnectionStore,
    private readonly manager: ConnectionManager,
    private readonly connectionTree: ConnectionsTreeProvider,
    private readonly diagnostics: KxDiagnostics,
    private readonly runPreview: ServerPreviewRunner,
    private readonly rerunHistory: QueryHistoryRunner
  ) {
    this.queryHistoryStore = new QueryHistoryStore(context.workspaceState, {
      maxEntries: () => vscode.workspace
        .getConfiguration('vscode-kdb.queryHistory')
        .get<unknown>('maxEntries'),
    });
    this.reconcile();
  }

  public configurationChanged(event: vscode.ConfigurationChangeEvent): void {
    if (event.affectsConfiguration('vscode-kdb.features.serverExplorer') ||
      event.affectsConfiguration('vscode-kdb.features.queryHistory')) {
      this.reconcile();
    }
    if (event.affectsConfiguration('vscode-kdb.queryHistory.maxEntries')) {
      void this.queryHistory?.prune().catch(error => {
        vscode.window.showWarningMessage(`KX Query History could not apply its new limit: ${errorMessage(error)}`);
      });
    }
  }

  public captureHistory(): QueryHistoryCapture | undefined {
    return this.queryHistory?.capture();
  }

  public async recordHistory(
    capture: QueryHistoryCapture | undefined,
    input: QueryHistoryRecordInput
  ): Promise<void> {
    if (!capture || capture.feature !== this.queryHistory) {
      return;
    }
    try {
      await this.queryHistory.record(capture, input);
    } catch (error) {
      vscode.window.showWarningMessage(`KX Query History could not save this local entry: ${errorMessage(error)}`);
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.serverExplorer?.dispose();
    this.queryHistory?.dispose();
    this.serverExplorer = undefined;
    this.queryHistory = undefined;
    void vscode.commands.executeCommand('setContext', SERVER_EXPLORER_AVAILABLE_CONTEXT, false);
  }

  private reconcile(): void {
    if (this.disposed) {
      return;
    }
    const settings = vscode.workspace.getConfiguration('vscode-kdb.features');
    const serverExplorerEnabled = settings.get<boolean>('serverExplorer', false);
    const queryHistoryEnabled = settings.get<boolean>('queryHistory', false);

    if (serverExplorerEnabled && !this.serverExplorer) {
      this.serverExplorer = new ServerExplorerFeature(
        this.store,
        this.manager,
        this.connectionTree,
        this.diagnostics,
        this.runPreview
      );
    } else if (!serverExplorerEnabled && this.serverExplorer) {
      this.serverExplorer.dispose();
      this.serverExplorer = undefined;
    } else if (!serverExplorerEnabled) {
      void vscode.commands.executeCommand('setContext', SERVER_EXPLORER_AVAILABLE_CONTEXT, false);
    }

    if (queryHistoryEnabled && !this.queryHistory) {
      this.queryHistory = new QueryHistoryFeature(
        this.queryHistoryStore,
        this.store,
        this.connectionTree,
        this.rerunHistory
      );
    } else if (!queryHistoryEnabled && this.queryHistory) {
      this.queryHistory.dispose();
      this.queryHistory = undefined;
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
