import * as vscode from 'vscode';
import { connectionEndpoint, KxConnection } from './connection';
import { ConnectionCommands } from './connection-commands';
import { ConnectionManager } from './connection-manager';
import { ConnectionStore } from './connection-store';
import { ConnectionsTreeProvider } from './connection-tree';
import { KX_OUTPUT_CHANNEL_NAME, KxDiagnostics } from './diagnostics';
import { emptyColumnarPanelResult } from './kx-results';
import { KxPanelResult, KxResultsPanel, KxResultsPanelRunMode } from './kx-results-panel';
import { configurePerfOutput, configurePerfTrace, endPerfSpan, perfSpan } from './perf';
import { QResultDisplayOptions, QValue, qValueToColumnarPanel } from './q-ipc';
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
  activeConnectionManager = manager;

  const treeView = vscode.window.createTreeView('vscode-kdb.connections', {
    treeDataProvider: tree,
    showCollapseAll: false,
  });
  connectionCommands.register(context);
  updatePerfTraceSetting();

  let connectionSnapshot = connectionSignatures(store.connections());
  context.subscriptions.push(
    manager,
    tree,
    treeView,
    output,
    { dispose: () => configurePerfOutput(undefined) },
    vscode.commands.registerCommand('vscode-kdb.runSelectionOrCurrentLine', () =>
      runSelectionOrCurrentLine(context, store, manager, diagnostics, 'replace')),
    vscode.commands.registerCommand('vscode-kdb.runScript', () =>
      runScript(context, store, manager, diagnostics, 'replace')),
    vscode.commands.registerCommand('vscode-kdb.runSelectionInNewResult', () =>
      runSelectionOrCurrentLine(context, store, manager, diagnostics, 'new')),
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
      if (event.affectsConfiguration('vscode-kdb.performance.trace')) {
        updatePerfTraceSetting();
      }
      if (!event.affectsConfiguration('vscode-kdb.connections')) {
        return;
      }
      const nextSnapshot = connectionSignatures(store.connections());
      for (const [id, signature] of connectionSnapshot) {
        if (nextSnapshot.get(id) !== signature) {
          manager.disconnect(id).catch(() => undefined);
        }
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
  mode: KxResultsPanelRunMode
): Promise<void> {
  const editor = qEditor();
  if (!editor) {
    return;
  }
  await executeQText(context, store, manager, diagnostics, editor.document.getText(), mode, 'script');
}

async function runSelectionOrCurrentLine(
  context: vscode.ExtensionContext,
  store: ConnectionStore,
  manager: ConnectionManager,
  diagnostics: KxDiagnostics,
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
  const execution = hasSelection ? qSelectionExecutionKind(selection) : 'query';
  await executeQText(context, store, manager, diagnostics, text, mode, execution);
}

function qEditor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Open a q file before running q code.');
    return undefined;
  }
  const isQ = editor.document.languageId === 'q' || editor.document.uri.path.toLocaleLowerCase().endsWith('.q');
  if (!isQ) {
    vscode.window.showWarningMessage('The active editor is not a q file.');
    return undefined;
  }
  return editor;
}

async function executeQText(
  context: vscode.ExtensionContext,
  store: ConnectionStore,
  manager: ConnectionManager,
  diagnostics: KxDiagnostics,
  text: string,
  mode: KxResultsPanelRunMode,
  execution: 'query' | 'script'
): Promise<void> {
  if (!text) {
    vscode.window.showWarningMessage('No q code selected to run.');
    return;
  }
  const connection = await activeConnectionForRun(store, manager);
  if (!connection) {
    return;
  }

  const panel = KxResultsPanel.showLoading(
    context,
    { query: text, connectionName: connection.name },
    mode
  );
  const version = panel.currentVersion();
  const started = Date.now();
  const cancellationError = new Error('Result wait canceled locally.');
  cancellationError.name = 'KxQueryCanceled';
  let rejectCancellation!: (error: Error) => void;
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  void cancellation.catch(() => undefined);
  let canceled = false;

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
          const executionPromise = execution === 'script'
            ? manager.executeScript(connection, text)
            : manager.execute(connection, text);
          return await Promise.race([executionPromise, cancellation]);
        } finally {
          subscription.dispose();
        }
      });
    } finally {
      endPerfSpan(span, { canceled, error: value === undefined && !canceled });
    }

    if (canceled || !panel.isLoadingVersion(version)) {
      return;
    }
    const panelResult = toPanelResult(value, text, connection.name, Date.now() - started);
    panel.showResult(panelResult);
  } catch (error) {
    if (canceled || error === cancellationError) {
      showCanceledResult();
      return;
    }
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
      messages: [`q returned ${converted.kind} as text in ${elapsedMs} ms.`],
    };
  }
  return {
    table: converted.result,
    query,
    connectionName,
    elapsedMs,
    messages: [
      `q returned ${converted.kind} with ${converted.result.rowCount} row${converted.result.rowCount === 1 ? '' : 's'} in ${elapsedMs} ms.`,
    ],
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

function connectionSignatures(connections: readonly KxConnection[]): Map<string, string> {
  return new Map(connections.map(connection => [connection.id, JSON.stringify(connection)]));
}

class QRunCodeLensProvider implements vscode.CodeLensProvider {
  public provideCodeLenses(): vscode.CodeLens[] {
    const top = new vscode.Range(0, 0, 0, 0);
    return [new vscode.CodeLens(top, {
      title: '$(play) Run q Script',
      command: 'vscode-kdb.runScript',
    })];
  }
}
