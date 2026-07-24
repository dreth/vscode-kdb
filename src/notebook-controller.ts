import * as vscode from 'vscode';
import { connectionEndpoint, KxConnection } from './connection';
import {
  KX_NOTEBOOK_MIME,
  createPortableKxResult,
  createPortableKxTextResult,
  notebookResultPlainText,
  validatePortableKxResult,
} from './notebook-contract';
import {
  NotebookSettings,
  hasNotebookQMarker,
  safeNotebookByteLimit,
  safeNotebookRowLimit,
} from './notebook-settings';
import {
  LiveNotebookResultStore,
} from './notebook-live-results';
import { NOTEBOOK_LIVE_RESULT_METADATA_KEY } from './notebook-message';
import { QResultDisplayOptions, QValue, qValueToColumnarPanel } from './q-ipc';

export const KX_Q_NOTEBOOK_CONTROLLER_ID = 'vscode-kdb.q-notebook-controller';
export const KX_Q_NOTEBOOK_TYPE = 'jupyter-notebook';
export const KX_Q_NOTEBOOK_CONTROLLER_LABEL = 'KX q (Direct IPC)';
export const KX_NOTEBOOK_LIVE_METADATA_KEY = NOTEBOOK_LIVE_RESULT_METADATA_KEY;

const CANCELED_AFTER_ISSUE_MESSAGE =
  'KX q execution was canceled locally. Direct IPC server work already sent may continue.';

export interface DirectQNotebookBridge {
  activeConnection(): KxConnection | undefined;
  isConnected(connectionId: string): boolean;
  executeScript(
    connection: KxConnection,
    source: string,
    onIssued: () => void,
    signal: AbortSignal
  ): Promise<QValue>;
  errorMessage(error: unknown, connection?: KxConnection): Promise<string>;
  onDidChangeState(listener: () => void): vscode.Disposable;
}

export class KxQNotebookController implements vscode.Disposable {
  public readonly controller: vscode.NotebookController;
  public readonly onDidChangeSelection: vscode.Event<void>;

  private readonly stateSubscription: vscode.Disposable;
  private readonly selectionSubscription: vscode.Disposable;
  private readonly selectionChanged = new vscode.EventEmitter<void>();
  private readonly selectedNotebooks = new Set<string>();
  private executionOrder = 0;
  private disposed = false;

  public constructor(
    private readonly bridge: DirectQNotebookBridge,
    private readonly liveResults: LiveNotebookResultStore
  ) {
    this.controller = vscode.notebooks.createNotebookController(
      KX_Q_NOTEBOOK_CONTROLLER_ID,
      KX_Q_NOTEBOOK_TYPE,
      KX_Q_NOTEBOOK_CONTROLLER_LABEL,
      (cells, notebook) => this.executeCells(cells, notebook)
    );
    this.controller.supportedLanguages = ['q'];
    this.controller.supportsExecutionOrder = true;
    this.stateSubscription = this.bridge.onDidChangeState(() => this.refreshDetails());
    this.onDidChangeSelection = this.selectionChanged.event;
    this.selectionSubscription = this.controller.onDidChangeSelectedNotebooks(event => {
      const key = event.notebook.uri.toString();
      if (event.selected) {
        this.selectedNotebooks.add(key);
      } else {
        this.selectedNotebooks.delete(key);
      }
      this.selectionChanged.fire();
    });
    this.refreshDetails();
  }

  public refreshDetails(): void {
    if (this.disposed) {
      return;
    }
    const connection = this.bridge.activeConnection();
    this.controller.description = connection
      ? `Direct IPC • ${connection.name}`
      : 'Direct IPC';
    this.controller.detail = connection
      ? [
        'Direct IPC',
        connection.name,
        connectionEndpoint(connection),
        `namespace ${connection.database}`,
        this.bridge.isConnected(connection.id)
          ? 'connected'
          : 'disconnected; connects on Run while this controller is selected',
      ].join(' • ')
      : 'Direct IPC • No active KX connection • Add or select one in the KX Connections view';
    this.selectionChanged.fire();
  }

  public isSelected(notebook: Pick<vscode.NotebookDocument, 'uri'>): boolean {
    return this.selectedNotebooks.has(notebook.uri.toString());
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stateSubscription.dispose();
    this.selectionSubscription.dispose();
    this.selectionChanged.dispose();
    this.selectedNotebooks.clear();
    this.controller.dispose();
  }

  private async executeCells(
    cells: readonly vscode.NotebookCell[],
    notebook: vscode.NotebookDocument
  ): Promise<void> {
    const scheduled: Array<{
      cell: vscode.NotebookCell;
      execution: vscode.NotebookCellExecution;
    }> = [];
    for (const cell of cells.filter(value => value.kind === vscode.NotebookCellKind.Code)) {
      try {
        scheduled.push({
          cell,
          execution: this.controller.createNotebookCellExecution(cell),
        });
      } catch {
        // A duplicate or closed cell cannot participate in this controller run.
      }
    }
    for (const item of scheduled) {
      await this.executeCell(item.cell, notebook, item.execution);
    }
  }

  private async executeCell(
    cell: vscode.NotebookCell,
    notebook: vscode.NotebookDocument,
    execution: vscode.NotebookCellExecution
  ): Promise<void> {
    let ended = false;
    let started = false;
    let success: boolean | undefined = false;
    let issued = false;
    let targetConnection: KxConnection | undefined;
    const abortController = new AbortController();
    const cancellation = execution.token.onCancellationRequested(() => abortController.abort());
    const end = (): void => {
      if (ended) {
        return;
      }
      ended = true;
      if (started) {
        try {
          execution.end(success, Date.now());
        } catch {
          // A closed notebook must not leave another execution finalization attempt.
        }
      }
    };

    try {
      execution.executionOrder = ++this.executionOrder;
      started = true;
      execution.start(Date.now());
      this.liveResults.removeCell(notebook.uri.toString(), cell.document.uri.toString());
      await execution.clearOutput();
      if (execution.token.isCancellationRequested) {
        success = undefined;
        return;
      }
      if (cell.document.languageId !== 'q') {
        await execution.replaceOutput(errorOutput(
          `KX q (Direct IPC) supports q code cells only. ` +
          `This cell is '${safeLanguageId(cell.document.languageId)}'; change it to q or select a matching controller.`
        ));
        return;
      }
      if (!this.isSelected(notebook)) {
        await execution.replaceOutput(errorOutput(
          'Select KX q (Direct IPC) in the notebook kernel/controller picker before running q cells.'
        ));
        return;
      }

      const connection = this.bridge.activeConnection();
      targetConnection = connection;
      this.refreshDetails();
      if (!connection) {
        await execution.replaceOutput(errorOutput(
          'No active KX direct IPC connection. Add or select a KX connection in the ' +
          'KX Connections view, optionally test it, then retry the cell.'
        ));
        return;
      }

      const source = cell.document.getText();
      if (!source.trim()) {
        await execution.replaceOutput([]);
        success = true;
        return;
      }
      if (hasNotebookQMarker(source)) {
        await execution.replaceOutput(errorOutput(
          'KX q (Direct IPC) executes ordinary q source and does not use %%q. Remove the %%q line, ' +
          'or select the Python controller to use the separate kx_notebook route.'
        ));
        return;
      }

      const startedAt = Date.now();
      const value = await this.bridge.executeScript(
        connection,
        source,
        () => {
          issued = true;
        },
        abortController.signal
      );
      if (execution.token.isCancellationRequested) {
        if (issued) {
          await execution.replaceOutput(textOutput(CANCELED_AFTER_ISSUE_MESSAGE));
        }
        success = undefined;
        return;
      }

      const elapsedMs = Date.now() - startedAt;
      const items = directQResultOutputItems(
        value,
        directNotebookSettings(),
        directQResultDisplayOptions(),
        connection,
        elapsedMs
      );
      const liveResultId = this.liveResults.register({
        notebookUri: notebook.uri.toString(),
        cellUri: cell.document.uri.toString(),
        query: source,
        connectionName: `${connection.name} • Direct IPC • ${connection.database}`,
        elapsedMs,
        value,
      });
      const output = new vscode.NotebookCellOutput(
        items,
        liveResultOutputMetadata(liveResultId)
      );
      await execution.replaceOutput(output);
      success = true;
    } catch (error) {
      if (execution.token.isCancellationRequested || abortController.signal.aborted) {
        if (issued) {
          await replaceOutputSafely(execution, textOutput(CANCELED_AFTER_ISSUE_MESSAGE));
        }
        success = undefined;
        return;
      }
      this.liveResults.removeCell(notebook.uri.toString(), cell.document.uri.toString());
      const detail = await this.safeErrorMessage(error, targetConnection);
      const context = targetConnection ? ' for the selected active KX connection' : '';
      await replaceOutputSafely(execution, errorOutput(
        `KX q Direct IPC execution failed${context}: ${detail}. ` +
        'Use KX: Test Connection to verify the active profile.'
      ));
    } finally {
      cancellation.dispose();
      end();
      this.refreshDetails();
    }
  }

  private async safeErrorMessage(error: unknown, connection?: KxConnection): Promise<string> {
    try {
      const message = await this.bridge.errorMessage(error, connection);
      return boundedNotebookText(message || 'Unknown direct IPC error', 4096);
    } catch {
      return 'Direct IPC failed; diagnostic details were unavailable';
    }
  }
}

export function directNotebookSettings(): NotebookSettings {
  const configuration = vscode.workspace.getConfiguration('vscode-kdb.notebook');
  return {
    presentation: 'inline',
    rowLimit: safeNotebookRowLimit(configuration.get('maxOutputRows')),
    byteLimit: safeNotebookByteLimit(configuration.get('maxOutputBytes')),
  };
}

export function boundedNotebookText(value: string, maxBytes: number): string {
  const limit = Math.max(64, Math.floor(maxBytes));
  if (Buffer.byteLength(value, 'utf8') <= limit) {
    return value;
  }
  const suffix = '\n... [truncated to notebook output byte limit]';
  const budget = Math.max(0, limit - Buffer.byteLength(suffix, 'utf8'));
  const output: string[] = [];
  let used = 0;
  for (const character of value) {
    const bytes = Buffer.byteLength(character, 'utf8');
    if (used + bytes > budget) {
      break;
    }
    output.push(character);
    used += bytes;
  }
  return `${output.join('')}${suffix}`;
}

export function directQResultOutputItems(
  value: QValue,
  settings: NotebookSettings,
  displayOptions: QResultDisplayOptions,
  connection: KxConnection,
  elapsedMs: number
): vscode.NotebookCellOutputItem[] {
  const panel = qValueToColumnarPanel(value, displayOptions);
  const portable = panel.mode === 'text'
    ? createPortableKxTextResult({
      text: panel.text,
      byteLimit: settings.byteLimit,
      label: `${connection.name} • Direct IPC • ${connection.database}`,
      elapsedMs,
      marker: 'direct-ipc',
    })
    : createPortableKxResult({
      columns: panel.result.columns.slice(),
      rows: [],
      cellValue: (rowIndex, columnIndex) => panel.result.cellValue(rowIndex, columnIndex),
      rowCount: panel.result.rowCount,
      rowLimit: settings.rowLimit,
      byteLimit: settings.byteLimit,
      label: `${connection.name} • Direct IPC • ${connection.database}`,
      elapsedMs,
      marker: 'direct-ipc',
    });
  const validation = validatePortableKxResult(portable);
  if (!validation.ok) {
    throw new Error(`Portable KX notebook result validation failed: ${validation.error}`);
  }
  const payload = validation.value;
  const plainText = boundedNotebookText(notebookResultPlainText(payload), settings.byteLimit);
  return [
    vscode.NotebookCellOutputItem.json(payload, KX_NOTEBOOK_MIME),
    vscode.NotebookCellOutputItem.text(plainText, 'text/plain'),
  ];
}

export function directQResultDisplayOptions(): QResultDisplayOptions {
  const configuration = vscode.workspace.getConfiguration('vscode-kdb.results.viewer');
  return {
    functionDisplayStrategy: configuration.get<string>('functionDisplayStrategy'),
    dictionaryDisplayStrategy: configuration.get<string>('dictionaryDisplayStrategy'),
    listDisplayStrategy: configuration.get<string>('listDisplayStrategy'),
    objectDisplayStrategy: configuration.get<string>('objectDisplayStrategy'),
  };
}

export function liveResultOutputMetadata(id: string): { [key: string]: unknown } {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(id)) {
    throw new Error('Live KX notebook result identifier is invalid.');
  }
  return {
    [KX_NOTEBOOK_LIVE_METADATA_KEY]: {
      version: 1,
      id,
    },
  };
}

function textOutput(value: string): vscode.NotebookCellOutput {
  return new vscode.NotebookCellOutput([
    vscode.NotebookCellOutputItem.text(value, 'text/plain'),
  ]);
}

function errorOutput(message: string): vscode.NotebookCellOutput {
  const error = new Error(message);
  error.name = 'KX q notebook error';
  error.stack = `${error.name}: ${message}`;
  return new vscode.NotebookCellOutput([
    vscode.NotebookCellOutputItem.error(error),
  ]);
}

async function replaceOutputSafely(
  execution: vscode.NotebookCellExecution,
  output: vscode.NotebookCellOutput
): Promise<void> {
  try {
    await execution.replaceOutput(output);
  } catch {
    // Execution finalization must not throw when the notebook was closed or disposed.
  }
}

function safeLanguageId(value: string): string {
  return value.replace(/[\0\r\n]/g, '').slice(0, 100) || 'unknown';
}
