import * as vscode from 'vscode';
import { connectionEndpoint, KxConnection } from './connection';
import { ConnectionCommands } from './connection-commands';
import { ConnectionManager } from './connection-manager';
import { ConnectionStore } from './connection-store';
import { ConnectionsTreeProvider } from './connection-tree';
import {
  KX_OUTPUT_CHANNEL_NAME,
  KxDiagnostics,
  redactDiagnosticText,
} from './diagnostics';
import { FeatureControls } from './feature-controls';
import { emptyColumnarPanelResult } from './kx-results';
import { KxPanelResult, KxResultsPanel, KxResultsPanelRunMode } from './kx-results-panel';
import {
  NotebookIntegration,
  PREPARE_NOTEBOOK_CELL_FOR_PYTHON_COMMAND,
} from './notebook-integration';
import {
  DirectQNotebookBridge,
  KxQNotebookController,
} from './notebook-controller';
import { LiveNotebookResultStore } from './notebook-live-results';
import { configurePerfOutput, configurePerfTrace, endPerfSpan, perfSpan } from './perf';
import { QResultDisplayOptions, QValue, qValueToColumnarPanel } from './q-ipc';
import {
  HistoryExecutionKind,
  historyRerunRequiresConfirmation,
  historyTransportKind,
  QueryHistoryEntry,
  QueryHistoryStatus,
} from './query-history-model';
import { qSelectionExecutionKind, selectedTextOrCurrentLine } from './q-text';

let activeConnectionManager: ConnectionManager | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel(KX_OUTPUT_CHANNEL_NAME);
  const diagnostics = new KxDiagnostics(output);
  configurePerfOutput(value => output.appendLine(value));
  const store = new ConnectionStore(context);
  const manager = new ConnectionManager(store, diagnostics);
  const tree = new ConnectionsTreeProvider(store, manager);
  const connectionCommands = new ConnectionCommands(store, manager, tree);
  const liveNotebookResults = new LiveNotebookResultStore();
  const notebookController = new KxQNotebookController(
    directQNotebookBridge(store, manager, tree),
    liveNotebookResults
  );
  const notebookIntegration = new NotebookIntegration(context, {
    directController: notebookController,
    liveResults: liveNotebookResults,
  });
  activeConnectionManager = manager;

  const treeView = vscode.window.createTreeView('vscode-kdb.connections', {
    treeDataProvider: tree,
    showCollapseAll: false,
  });
  connectionCommands.register(context);
  updatePerfTraceSetting();

  let features!: FeatureControls;
  features = new FeatureControls(
    context,
    store,
    manager,
    tree,
    diagnostics,
    (query, expectedConnectionId) => executeQText(
      context,
      store,
      manager,
      diagnostics,
      features,
      query,
      {
        mode: 'new',
        transport: 'query',
        expectedConnectionId,
        strictNamespace: true,
      }
    ),
    (entry: QueryHistoryEntry) => executeQText(
      context,
      store,
      manager,
      diagnostics,
      features,
      entry.queryText,
      {
        mode: 'replace',
        transport: historyTransportKind(entry),
        recordedHistoryConnection: {
          id: entry.connectionId,
          name: entry.connectionName,
        },
      }
    )
  );

  let connectionSnapshot = connectionMap(store.connections());
  context.subscriptions.push(
    manager,
    features,
    tree,
    treeView,
    output,
    notebookController,
    notebookIntegration,
    { dispose: () => liveNotebookResults.clear() },
    vscode.workspace.onDidCloseNotebookDocument(notebook =>
      liveNotebookResults.closeNotebook(notebook.uri.toString())),
    vscode.workspace.onDidChangeNotebookDocument(event => {
      const notebookUri = event.notebook.uri.toString();
      for (const change of event.contentChanges) {
        for (const cell of change.removedCells) {
          liveNotebookResults.removeCell(notebookUri, cell.document.uri.toString());
        }
      }
    }),
    { dispose: () => configurePerfOutput(undefined) },
    vscode.commands.registerCommand('vscode-kdb.runSelectionOrCurrentLine', () =>
      runSelectionOrCurrentLine(context, store, manager, diagnostics, features, 'replace')),
    vscode.commands.registerCommand('vscode-kdb.runScript', () =>
      runScript(context, store, manager, diagnostics, features, 'replace')),
    vscode.commands.registerCommand('vscode-kdb.runSelectionInNewResult', () =>
      runSelectionOrCurrentLine(context, store, manager, diagnostics, features, 'new')),
    vscode.commands.registerCommand('vscode-kdb.copyResultSelection', () =>
      KxResultsPanel.copySelectionFromActivePanel()),
    vscode.commands.registerCommand('vscode-kdb.openLocalDataServer', () =>
      KxResultsPanel.openLocalDataServerForActivePanel()),
    vscode.commands.registerCommand('vscode-kdb.stopLocalDataServer', () =>
      KxResultsPanel.stopLocalDataServerForActivePanel()),
    vscode.commands.registerCommand('vscode-kdb.copyLocalDataServerUrl', () =>
      KxResultsPanel.copyLocalDataServerUrlFromActivePanel()),
    vscode.languages.registerCodeLensProvider(
      [{ language: 'q' }, { pattern: '**/*.q' }],
      new QRunCodeLensProvider()
    ),
    vscode.workspace.onDidChangeConfiguration(event => {
      features.configurationChanged(event);
      KxResultsPanel.configurationChanged(event);
      if (event.affectsConfiguration('vscode-kdb.performance.trace')) {
        updatePerfTraceSetting();
      }
      const connectionsChanged = event.affectsConfiguration('vscode-kdb.connections');
      const timeoutDefaultsChanged = event.affectsConfiguration('vscode-kdb.connectionTimeoutMs') ||
        event.affectsConfiguration('vscode-kdb.queryTimeoutMs');
      if (!connectionsChanged && !timeoutDefaultsChanged) {
        return;
      }
      const nextSnapshot = connectionMap(store.connections());
      const connectionIds = new Set([...connectionSnapshot.keys(), ...nextSnapshot.keys()]);
      for (const id of connectionIds) {
        void manager.disconnectIfConfigurationChanged(id, nextSnapshot.get(id)).catch(() => undefined);
      }
      connectionSnapshot = nextSnapshot;
      tree.refresh();
    })
  );
}

export async function deactivate(): Promise<void> {
  configurePerfOutput(undefined);
  KxResultsPanel.stopAllLocalDataServers();
  const manager = activeConnectionManager;
  activeConnectionManager = undefined;
  if (manager) {
    await manager.disconnectAll();
  }
}

async function runScript(
  context: vscode.ExtensionContext,
  store: ConnectionStore,
  manager: ConnectionManager,
  diagnostics: KxDiagnostics,
  features: FeatureControls,
  mode: KxResultsPanelRunMode
): Promise<void> {
  const editor = qEditor();
  if (!editor) {
    return;
  }
  await executeQText(
    context,
    store,
    manager,
    diagnostics,
    features,
    editor.document.getText(),
    { mode, transport: 'script', historyKind: 'script' }
  );
}

async function runSelectionOrCurrentLine(
  context: vscode.ExtensionContext,
  store: ConnectionStore,
  manager: ConnectionManager,
  diagnostics: KxDiagnostics,
  features: FeatureControls,
  mode: KxResultsPanelRunMode
): Promise<void> {
  const editor = qEditor();
  if (!editor) {
    return;
  }
  const hasSelection = !editor.selection.isEmpty;
  const selection = hasSelection ? editor.document.getText(editor.selection) : '';
  const text = selectedTextOrCurrentLine(
    editor.document.getText(),
    selection,
    editor.selection.active.line
  );
  const transport = hasSelection ? qSelectionExecutionKind(selection) : 'query';
  await executeQText(
    context,
    store,
    manager,
    diagnostics,
    features,
    text,
    {
      mode,
      transport,
      historyKind: hasSelection ? 'selection' : 'line',
    }
  );
}

function qEditor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Open a q file before running q code.');
    return undefined;
  }
  if (editor.document.uri.scheme === 'vscode-notebook-cell') {
    const prepare = 'Prepare this q cell for the active Python kernel';
    void vscode.window.showInformationMessage(
      'KX editor commands do not execute notebook cells through a separate q IPC connection. Prepare adds %%q; restore the notebook default language before normal Run with the current Python controller.',
      prepare
    ).then(choice => choice === prepare
      ? vscode.commands.executeCommand(PREPARE_NOTEBOOK_CELL_FOR_PYTHON_COMMAND)
      : undefined
    ).then(undefined, error => {
      const detail = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`KX notebook preparation failed: ${detail}`);
    });
    return undefined;
  }
  const isQ = editor.document.languageId === 'q' || editor.document.uri.path.toLocaleLowerCase().endsWith('.q');
  if (!isQ) {
    vscode.window.showWarningMessage('The active editor is not a q file.');
    return undefined;
  }
  return editor;
}

interface QExecutionRequest {
  mode: KxResultsPanelRunMode;
  transport: 'query' | 'script';
  historyKind?: HistoryExecutionKind;
  expectedConnectionId?: string;
  strictNamespace?: boolean;
  recordedHistoryConnection?: {
    id: string;
    name: string;
  };
}

async function executeQText(
  context: vscode.ExtensionContext,
  store: ConnectionStore,
  manager: ConnectionManager,
  diagnostics: KxDiagnostics,
  features: FeatureControls,
  text: string,
  request: QExecutionRequest
): Promise<void> {
  if (!text) {
    vscode.window.showWarningMessage('No q code selected to run.');
    return;
  }
  let connection = request.expectedConnectionId
    ? activeConnectionForExpectedRun(store, manager, request.expectedConnectionId)
    : await activeConnectionForRun(store, manager);
  if (!connection) {
    return;
  }
  if (request.recordedHistoryConnection && historyRerunRequiresConfirmation(
    request.recordedHistoryConnection.id,
    connection.id
  )) {
    const decision = await vscode.window.showWarningMessage(
      `This query was recorded for "${request.recordedHistoryConnection.name}". ` +
        `The selected active connection is "${connection.name}" (${connection.database}). ` +
        'Rerun the exact query there?',
      { modal: true },
      'Rerun on Active Connection'
    );
    if (decision !== 'Rerun on Active Connection') {
      return;
    }
  }
  if (request.recordedHistoryConnection) {
    const latestTarget = store.activeConnection();
    if (!latestTarget || !sameExecutionTarget(connection, latestTarget)) {
      vscode.window.showWarningMessage(
        'The active KX connection or namespace changed while rerun confirmation was open. ' +
        'Choose the history entry again.'
      );
      return;
    }
    connection = latestTarget;
  }

  const panel = KxResultsPanel.showLoading(
    context,
    { query: text, connectionName: connection.name },
    request.mode
  );
  const version = panel.currentVersion();
  const started = Date.now();
  const historyCapture = request.historyKind ? features.captureHistory() : undefined;
  let issued = false;
  let issuedAt = started;
  let historyRecorded = false;
  let canceled = false;
  const recordHistory = async (status: QueryHistoryStatus): Promise<void> => {
    if (!issued || historyRecorded || !request.historyKind) {
      return;
    }
    historyRecorded = true;
    await features.recordHistory(historyCapture, {
      connectionId: connection.id,
      connectionName: connection.name,
      timestamp: issuedAt,
      kind: request.historyKind,
      status,
      durationMs: Date.now() - issuedAt,
      queryText: text,
    });
  };
  const onIssued = () => {
    issued = true;
    issuedAt = Date.now();
    if (canceled) {
      void recordHistory('canceled');
    }
  };
  const cancellationError = new Error('Result wait canceled locally.');
  cancellationError.name = 'KxQueryCanceled';
  let rejectCancellation!: (error: Error) => void;
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  void cancellation.catch(() => undefined);

  const showCanceledResult = () => {
    if (!panel.isLoadingVersion(version)) {
      return;
    }
    panel.showResult({
      table: emptyColumnarPanelResult(),
      query: text,
      connectionName: connection.name,
      elapsedMs: Date.now() - started,
      messages: ['Result wait canceled locally. q may still be running on the server.'],
      canceled: true,
    });
  };
  const cancel = () => {
    if (canceled) {
      return;
    }
    canceled = true;
    diagnostics.event({
      phase: 'cancellation',
      endpoint: connectionEndpoint(connection),
      status: 'canceled',
      details: { scope: 'local-result-wait' },
    });
    rejectCancellation(cancellationError);
    showCanceledResult();
  };
  const panelCancellation = panel.setLoadingCancelHandler(version, cancel);

  try {
    const span = perfSpan('extension.query', {
      endpoint: connectionEndpoint(connection),
      queryChars: text.length,
    });
    let value: QValue | undefined;
    try {
      value = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Running q on ${connection.name} (${connectionEndpoint(connection)})`,
        cancellable: true,
      }, async (_progress, token) => {
        const subscription = token.onCancellationRequested(cancel);
        try {
          if (canceled) {
            throw cancellationError;
          }
          const executionPromise = request.transport === 'script'
            ? manager.executeScript(connection, text, onIssued)
            : request.strictNamespace
              ? manager.executeInConfiguredNamespace(connection, text, onIssued)
              : manager.execute(connection, text, onIssued);
          return await Promise.race([executionPromise, cancellation]);
        } finally {
          subscription.dispose();
        }
      });
    } finally {
      endPerfSpan(span, { canceled, error: value === undefined && !canceled });
    }

    await recordHistory(canceled ? 'canceled' : 'succeeded');
    if (canceled || !panel.isLoadingVersion(version)) {
      return;
    }
    const panelResult = toPanelResult(value, text, connection.name, Date.now() - started);
    panel.showResult(panelResult);
  } catch (error) {
    if (canceled || error === cancellationError) {
      await recordHistory('canceled');
      showCanceledResult();
      return;
    }
    await recordHistory('failed');
    if (!panel.isLoadingVersion(version)) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const messages = [
      `q failed on ${connection.name} (${connectionEndpoint(connection)}).`,
      message,
    ];
    panel.showResult({
      table: emptyColumnarPanelResult(),
      query: text,
      connectionName: connection.name,
      elapsedMs: Date.now() - started,
      messages,
      error: true,
    });
    vscode.window.showErrorMessage(messages.join(' '));
  } finally {
    panelCancellation.dispose();
  }
}

function toPanelResult(
  value: QValue,
  query: string,
  connectionName: string,
  elapsedMs: number
): KxPanelResult {
  const converted = qValueToColumnarPanel(value, qResultDisplayOptions());
  if (converted.mode === 'text') {
    return {
      mode: 'text',
      text: converted.text,
      query,
      connectionName,
      elapsedMs,
      messages: [],
    };
  }
  return {
    table: converted.result,
    query,
    connectionName,
    elapsedMs,
    messages: [],
  };
}

function qResultDisplayOptions(): QResultDisplayOptions {
  const configuration = vscode.workspace.getConfiguration('vscode-kdb.results.viewer');
  return {
    functionDisplayStrategy: configuration.get<string>('functionDisplayStrategy'),
    dictionaryDisplayStrategy: configuration.get<string>('dictionaryDisplayStrategy'),
    listDisplayStrategy: configuration.get<string>('listDisplayStrategy'),
    objectDisplayStrategy: configuration.get<string>('objectDisplayStrategy'),
  };
}

function activeConnectionForExpectedRun(
  store: ConnectionStore,
  manager: ConnectionManager,
  expectedConnectionId: string
): KxConnection | undefined {
  const active = store.activeConnection();
  if (!active || active.id !== expectedConnectionId || !manager.isConnected(active.id)) {
    vscode.window.showWarningMessage(
      'The active KX connection changed or disconnected. Refresh Server Explorer before previewing.'
    );
    return undefined;
  }
  return active;
}

async function activeConnectionForRun(
  store: ConnectionStore,
  manager: ConnectionManager
): Promise<KxConnection | undefined> {
  const active = store.activeConnection();
  if (active) {
    return active;
  }
  let connections = store.connections();
  if (!connections.length) {
    const action = await vscode.window.showWarningMessage(
      'No KX connections are configured.',
      'Add Connection'
    );
    if (action !== 'Add Connection') {
      return undefined;
    }
    await vscode.commands.executeCommand('vscode-kdb.addConnection');
    connections = store.connections();
    if (!connections.length) {
      return undefined;
    }
  }
  let connection = connections[0];
  if (connections.length > 1) {
    const picked = await vscode.window.showQuickPick(connections.map(item => ({
      label: item.name,
      description: `${connectionEndpoint(item)} • ${item.database}`,
      detail: manager.isConnected(item.id) ? 'Connected' : 'Disconnected',
      connection: item,
    })), {
      title: 'KX: Select Active Connection',
      placeHolder: 'Choose the direct q IPC connection for this run',
      ignoreFocusOut: true,
    });
    if (!picked) {
      return undefined;
    }
    connection = picked.connection;
  }
  await store.setActiveConnection(connection.id);
  await vscode.commands.executeCommand('vscode-kdb.refreshConnections');
  return connection;
}

function updatePerfTraceSetting(): void {
  configurePerfTrace(vscode.workspace
    .getConfiguration('vscode-kdb.performance')
    .get<boolean>('trace', false));
}

function connectionMap(connections: readonly KxConnection[]): Map<string, KxConnection> {
  return new Map(connections.map(connection => [connection.id, connection]));
}

function sameExecutionTarget(left: KxConnection, right: KxConnection): boolean {
  return left.id === right.id && left.host === right.host && left.port === right.port &&
    left.database === right.database && left.username === right.username &&
    left.connectTimeoutMs === right.connectTimeoutMs && left.queryTimeoutMs === right.queryTimeoutMs;
}

function directQNotebookBridge(
  store: ConnectionStore,
  manager: ConnectionManager,
  tree: ConnectionsTreeProvider
): DirectQNotebookBridge {
  return {
    activeConnection: () => store.activeConnection(),
    isConnected: connectionId => manager.isConnected(connectionId),
    executeScript: (connection, source, onIssued, signal) =>
      manager.executeScript(connection, source, onIssued, signal),
    errorMessage: async (error, connection) => {
      const secrets: string[] = [];
      let secretLookupFailed = false;
      if (connection?.username) {
        secrets.push(connection.username);
      }
      if (connection) {
        try {
          const password = await store.password(connection.id);
          if (password) {
            secrets.push(password);
          }
        } catch {
          secretLookupFailed = true;
        }
      }
      if (secretLookupFailed) {
        return 'Direct IPC failed; details were withheld because SecretStorage was unavailable';
      }
      const message = error instanceof Error ? error.message : String(error);
      return redactDiagnosticText(message, secrets).replace(/\0/g, '');
    },
    onDidChangeState: listener => {
      const managerSubscription = manager.onDidChangeState(listener);
      const treeSubscription = tree.onDidChangeTreeData(listener);
      return new vscode.Disposable(() => {
        managerSubscription.dispose();
        treeSubscription.dispose();
      });
    },
  };
}

class QRunCodeLensProvider implements vscode.CodeLensProvider {
  public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.uri.scheme === 'vscode-notebook-cell') {
      return [];
    }
    const top = new vscode.Range(0, 0, 0, 0);
    return [new vscode.CodeLens(top, {
      title: '$(play) Run q Script',
      command: 'vscode-kdb.runScript',
    })];
  }
}
