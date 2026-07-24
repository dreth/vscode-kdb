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
  LiveNotebookResultRegistration,
  LiveNotebookResultStore,
} from './notebook-live-results';
import { NOTEBOOK_LIVE_RESULT_METADATA_KEY } from './notebook-message';
import { QResultDisplayOptions, QValue, qValueToColumnarPanel } from './q-ipc';

export const KX_Q_NOTEBOOK_CONTROLLER_ID = 'vscode-kdb.q-notebook-controller';
export const KX_Q_NOTEBOOK_TYPE = 'jupyter-notebook';
export const KX_Q_NOTEBOOK_CONTROLLER_LABEL = 'KX q (Direct IPC)';
export const KX_NOTEBOOK_LIVE_METADATA_KEY = NOTEBOOK_LIVE_RESULT_METADATA_KEY;

const CANCELED_AFTER_ISSUE_SUFFIX =
  'was canceled locally. Direct IPC server work already sent may continue.';

export type DirectQCellRunResult =
  | 'executed'
  | 'busy'
  | 'not-q'
  | 'unsupported-notebook'
  | 'stale'
  | 'write-failed'
  | 'unavailable';

type CellOutputReplacement =
  | vscode.NotebookCellOutput
  | readonly vscode.NotebookCellOutput[];

interface PreparedLiveResult {
  items: vscode.NotebookCellOutputItem[];
  registration: Omit<LiveNotebookResultRegistration, 'cellUri'>;
}

interface PreparedCellResult {
  success: boolean | undefined;
  output?: CellOutputReplacement;
  live?: PreparedLiveResult;
  canceled?: 'before-issue' | 'after-issue';
}

interface MixedCellSnapshot {
  notebook: vscode.NotebookDocument;
  cellUri: string;
  source: string;
  languageId: string;
  outputs: readonly vscode.NotebookCellOutput[];
  executionSummary: string;
}

interface MixedOutputWriteResult {
  status: 'executed' | 'canceled' | 'stale' | 'write-failed' | 'unavailable';
  cell?: vscode.NotebookCell;
}

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
  private readonly activeExecutions = new Set<string>();
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
          : 'disconnected; connects on Run q Cell (KX) or native Run while selected',
      ].join(' • ')
      : 'Direct IPC • No active KX connection • Add or select one in the KX Connections view';
    this.selectionChanged.fire();
  }

  public routeLabel(): string {
    const connection = this.bridge.activeConnection();
    return connection
      ? `KX • ${safeStatusText(connection.name, 100)} • ${safeStatusText(connection.database, 512)}`
      : 'KX • No active connection';
  }

  public isSelected(notebook: Pick<vscode.NotebookDocument, 'uri'>): boolean {
    return this.selectedNotebooks.has(notebook.uri.toString());
  }

  public async runCell(cell: vscode.NotebookCell): Promise<DirectQCellRunResult> {
    if (this.disposed) {
      return 'unavailable';
    }
    if (cell.notebook.notebookType !== KX_Q_NOTEBOOK_TYPE) {
      return 'unsupported-notebook';
    }
    if (cell.kind !== vscode.NotebookCellKind.Code || cell.document.languageId !== 'q') {
      return 'not-q';
    }
    const executionKey = cellExecutionKey(cell.notebook, cell);
    if (this.activeExecutions.has(executionKey)) {
      return 'busy';
    }
    this.activeExecutions.add(executionKey);
    try {
      return await this.runMixedCell(cell);
    } finally {
      this.activeExecutions.delete(executionKey);
    }
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
    this.activeExecutions.clear();
    this.controller.dispose();
  }

  private async executeCells(
    cells: readonly vscode.NotebookCell[],
    notebook: vscode.NotebookDocument
  ): Promise<void> {
    const scheduled: Array<{
      cell: vscode.NotebookCell;
      execution: vscode.NotebookCellExecution;
      executionKey: string;
    }> = [];
    for (const cell of cells.filter(value => value.kind === vscode.NotebookCellKind.Code)) {
      const reserved = this.reserveCellExecution(cell, notebook);
      if (reserved) {
        scheduled.push({ cell, ...reserved });
      }
    }
    for (const item of scheduled) {
      try {
        await this.executeCell(item.cell, notebook, item.execution);
      } finally {
        this.activeExecutions.delete(item.executionKey);
      }
    }
  }

  private async runMixedCell(cell: vscode.NotebookCell): Promise<DirectQCellRunResult> {
    const snapshot = mixedCellSnapshot(cell);
    const abortController = new AbortController();
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `${this.routeLabel()} • Run q Cell (KX)`,
        cancellable: true,
      },
      async (_progress, token) => {
        const cancellation = token.onCancellationRequested(() => abortController.abort());
        let liveResultId: string | undefined;
        try {
          const prepared = await this.prepareCellResult(
            cell,
            cell.notebook,
            'Run q Cell (KX)',
            token,
            abortController.signal
          );
          if (prepared.canceled === 'before-issue') {
            return 'executed';
          }
          const cancellationPrepared = prepared.canceled === 'after-issue';
          if (!cancellationPrepared &&
            (token.isCancellationRequested || abortController.signal.aborted)) {
            return 'executed';
          }
          const current = matchingMixedCell(snapshot);
          if (!current) {
            return snapshot.notebook.isClosed ? 'unavailable' : 'stale';
          }
          const materialized = this.materializeCellResult(
            prepared,
            current.document.uri.toString(),
            true
          );
          liveResultId = materialized.liveResultId;
          const written = await this.applyMixedCellOutput(
            snapshot,
            current,
            materialized.output,
            () => !cancellationPrepared &&
              (token.isCancellationRequested || abortController.signal.aborted)
          );
          if (written.status === 'canceled') {
            if (liveResultId) {
              this.liveResults.remove(liveResultId, snapshot.notebook.uri.toString());
            }
            return 'executed';
          }
          if (written.status !== 'executed' || !written.cell) {
            if (liveResultId) {
              this.liveResults.remove(liveResultId, snapshot.notebook.uri.toString());
            }
            return written.status;
          }
          if (liveResultId && materialized.liveRegistration) {
            if (!cellHasLiveResult(written.cell, liveResultId)) {
              this.liveResults.remove(liveResultId, snapshot.notebook.uri.toString());
              return 'stale';
            }
            try {
              this.liveResults.removeCell(
                snapshot.notebook.uri.toString(),
                snapshot.cellUri
              );
              this.liveResults.rebind(liveResultId, {
                ...materialized.liveRegistration,
                cellUri: written.cell.document.uri.toString(),
              });
            } catch {
              this.liveResults.remove(liveResultId, snapshot.notebook.uri.toString());
              return 'write-failed';
            }
          }
          return 'executed';
        } catch {
          if (liveResultId) {
            this.liveResults.remove(liveResultId, snapshot.notebook.uri.toString());
          }
          return snapshot.notebook.isClosed ? 'unavailable' : 'write-failed';
        } finally {
          cancellation.dispose();
          this.refreshDetails();
        }
      }
    );
  }

  private async applyMixedCellOutput(
    snapshot: MixedCellSnapshot,
    current: vscode.NotebookCell,
    output: CellOutputReplacement,
    isCanceled: () => boolean
  ): Promise<MixedOutputWriteResult> {
    if (isCanceled()) {
      return { status: 'canceled' };
    }
    if (snapshot.notebook.isClosed) {
      return { status: 'unavailable' };
    }
    if (!mixedCellMatchesSnapshot(current, snapshot)) {
      return { status: 'stale' };
    }

    const index = current.index;
    const replacement = new vscode.NotebookCellData(
      current.kind,
      current.document.getText(),
      current.document.languageId
    );
    replacement.metadata = { ...current.metadata };
    replacement.outputs = Array.isArray(output) ? [...output] : [output];

    let eventCell: vscode.NotebookCell | undefined;
    let resolveReplacement: (() => void) | undefined;
    const replacementEvent = new Promise<void>(resolve => {
      resolveReplacement = resolve;
    });
    const eventSubscription = vscode.workspace.onDidChangeNotebookDocument(event => {
      if (event.notebook !== snapshot.notebook) {
        return;
      }
      for (const change of event.contentChanges) {
        if (change.range.start !== index ||
          !change.removedCells.some(removed =>
            removed.document.uri.toString() === snapshot.cellUri)) {
          continue;
        }
        const added = change.addedCells.find(candidate =>
          candidate.kind === vscode.NotebookCellKind.Code &&
          candidate.document.languageId === snapshot.languageId &&
          candidate.document.getText() === snapshot.source
        );
        if (added) {
          eventCell = added;
          resolveReplacement?.();
        }
      }
    });

    try {
      const edit = new vscode.WorkspaceEdit();
      edit.set(snapshot.notebook.uri, [
        vscode.NotebookEdit.replaceCells(
          new vscode.NotebookRange(index, index + 1),
          [replacement]
        ),
      ]);
      if (isCanceled()) {
        return { status: 'canceled' };
      }
      let applied: boolean;
      try {
        applied = await vscode.workspace.applyEdit(edit);
      } catch {
        return {
          status: snapshot.notebook.isClosed
            ? 'unavailable'
            : matchingMixedCell(snapshot)
              ? 'write-failed'
              : 'stale',
        };
      }
      if (!applied) {
        return {
          status: snapshot.notebook.isClosed
            ? 'unavailable'
            : matchingMixedCell(snapshot)
              ? 'write-failed'
              : 'stale',
        };
      }
      if (snapshot.notebook.isClosed) {
        return { status: 'unavailable' };
      }

      let written = eventCell ?? notebookCellAt(snapshot.notebook, index);
      if (!written || written.document.uri.toString() === snapshot.cellUri) {
        await waitForNotebookReplacement(replacementEvent);
        written = eventCell ?? notebookCellAt(snapshot.notebook, index);
      }
      if (!written ||
        written.document.uri.toString() === snapshot.cellUri ||
        written.notebook !== snapshot.notebook ||
        written.kind !== vscode.NotebookCellKind.Code ||
        written.document.languageId !== snapshot.languageId ||
        written.document.getText() !== snapshot.source) {
        return {
          status: snapshot.notebook.isClosed ? 'unavailable' : 'write-failed',
        };
      }
      return { status: 'executed', cell: written };
    } finally {
      eventSubscription.dispose();
    }
  }

  private reserveCellExecution(
    cell: vscode.NotebookCell,
    notebook: vscode.NotebookDocument
  ): {
      execution: vscode.NotebookCellExecution;
      executionKey: string;
    } | undefined {
    const executionKey = cellExecutionKey(notebook, cell);
    if (this.disposed) {
      return undefined;
    }
    if (this.activeExecutions.has(executionKey)) {
      return undefined;
    }
    this.activeExecutions.add(executionKey);
    try {
      return {
        execution: this.controller.createNotebookCellExecution(cell),
        executionKey,
      };
    } catch {
      this.activeExecutions.delete(executionKey);
      return undefined;
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
    let liveResultId: string | undefined;
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
          `${KX_Q_NOTEBOOK_CONTROLLER_LABEL} supports q code cells only. ` +
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
      const prepared = await this.prepareCellResult(
        cell,
        notebook,
        KX_Q_NOTEBOOK_CONTROLLER_LABEL,
        execution.token,
        abortController.signal
      );
      const materialized = this.materializeCellResult(
        prepared,
        cell.document.uri.toString()
      );
      liveResultId = materialized.liveResultId;
      await execution.replaceOutput(materialized.output);
      success = prepared.success;
    } catch (error) {
      if (liveResultId) {
        this.liveResults.removeCell(
          notebook.uri.toString(),
          cell.document.uri.toString()
        );
      }
      const detail = await this.safeErrorMessage(error);
      await replaceOutputSafely(execution, errorOutput(
        `${KX_Q_NOTEBOOK_CONTROLLER_LABEL} could not update the cell output: ${detail}.`
      ));
    } finally {
      cancellation.dispose();
      end();
      this.refreshDetails();
    }
  }

  private async prepareCellResult(
    cell: vscode.NotebookCell,
    notebook: vscode.NotebookDocument,
    runLabel: string,
    token: Pick<vscode.CancellationToken, 'isCancellationRequested'>,
    signal: AbortSignal
  ): Promise<PreparedCellResult> {
    let issued = false;
    let targetConnection: KxConnection | undefined;
    const canceledOutput = (): PreparedCellResult => ({
      success: undefined,
      canceled: issued ? 'after-issue' : 'before-issue',
      output: issued
        ? textOutput(`${runLabel} ${CANCELED_AFTER_ISSUE_SUFFIX}`)
        : [],
    });
    try {
      if (token.isCancellationRequested || signal.aborted) {
        return canceledOutput();
      }
      const connection = this.bridge.activeConnection();
      targetConnection = connection;
      this.refreshDetails();
      if (!connection) {
        return {
          success: false,
          output: errorOutput(
            `${runLabel} has no active KX direct IPC connection. Add or select a KX connection ` +
            'in the KX Connections view, optionally test it, then retry the cell.'
          ),
        };
      }
      const source = cell.document.getText();
      if (!source.trim()) {
        return { success: true, output: [] };
      }
      if (hasNotebookQMarker(source)) {
        return {
          success: false,
          output: errorOutput(
            `${runLabel} executes ordinary q source and does not use %%q. Remove the %%q line, ` +
            'or select the Python controller to use the separate kx_notebook route.'
          ),
        };
      }
      const startedAt = Date.now();
      const value = await this.bridge.executeScript(
        connection,
        source,
        () => {
          issued = true;
        },
        signal
      );
      if (token.isCancellationRequested || signal.aborted) {
        return canceledOutput();
      }
      const elapsedMs = Date.now() - startedAt;
      return {
        success: true,
        live: {
          items: directQResultOutputItems(
            value,
            directNotebookSettings(),
            directQResultDisplayOptions(),
            connection,
            elapsedMs
          ),
          registration: {
            notebookUri: notebook.uri.toString(),
            query: source,
            connectionName: `${connection.name} • Direct IPC • ${connection.database}`,
            elapsedMs,
            value,
          },
        },
      };
    } catch (error) {
      if (token.isCancellationRequested || signal.aborted) {
        return canceledOutput();
      }
      const detail = await this.safeErrorMessage(error, targetConnection);
      const context = targetConnection ? ' for the selected active KX connection' : '';
      return {
        success: false,
        output: errorOutput(
          `${runLabel} failed${context}: ${detail}. ` +
          'Use KX: Test Connection to verify the active profile.'
        ),
      };
    }
  }

  private materializeCellResult(
    prepared: PreparedCellResult,
    cellUri: string,
    stage = false
  ): {
      output: CellOutputReplacement;
      liveResultId?: string;
      liveRegistration?: LiveNotebookResultRegistration;
    } {
    if (!prepared.live) {
      return { output: prepared.output ?? [] };
    }
    const registration: LiveNotebookResultRegistration = {
      ...prepared.live.registration,
      cellUri,
    };
    const liveResultId = stage
      ? this.liveResults.stage(registration)
      : this.liveResults.register(registration);
    return {
      output: new vscode.NotebookCellOutput(
        prepared.live.items,
        liveResultOutputMetadata(liveResultId)
      ),
      liveResultId,
      liveRegistration: registration,
    };
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

function safeStatusText(value: string, maxLength: number): string {
  return value.replace(/[\0-\x1f\x7f]/g, '').slice(0, maxLength) || '?';
}

function cellExecutionKey(
  notebook: Pick<vscode.NotebookDocument, 'uri'>,
  cell: Pick<vscode.NotebookCell, 'document'>
): string {
  return `${notebook.uri.toString()}\0${cell.document.uri.toString()}`;
}

function mixedCellSnapshot(cell: vscode.NotebookCell): MixedCellSnapshot {
  return {
    notebook: cell.notebook,
    cellUri: cell.document.uri.toString(),
    source: cell.document.getText(),
    languageId: cell.document.languageId,
    outputs: [...cell.outputs],
    executionSummary: executionSummaryKey(cell.executionSummary),
  };
}

function matchingMixedCell(snapshot: MixedCellSnapshot): vscode.NotebookCell | undefined {
  if (snapshot.notebook.isClosed) {
    return undefined;
  }
  const current = snapshot.notebook.getCells().find(
    candidate => candidate.document.uri.toString() === snapshot.cellUri
  );
  return current && mixedCellMatchesSnapshot(current, snapshot) ? current : undefined;
}

function mixedCellMatchesSnapshot(
  cell: vscode.NotebookCell,
  snapshot: MixedCellSnapshot
): boolean {
  return cell.notebook === snapshot.notebook &&
    cell.kind === vscode.NotebookCellKind.Code &&
    cell.document.uri.toString() === snapshot.cellUri &&
    cell.document.languageId === snapshot.languageId &&
    cell.document.languageId === 'q' &&
    cell.document.getText() === snapshot.source &&
    cell.outputs.length === snapshot.outputs.length &&
    cell.outputs.every((output, index) => output === snapshot.outputs[index]) &&
    executionSummaryKey(cell.executionSummary) === snapshot.executionSummary;
}

function executionSummaryKey(
  summary: vscode.NotebookCellExecutionSummary | undefined
): string {
  if (!summary) {
    return '';
  }
  return JSON.stringify({
    executionOrder: summary.executionOrder,
    success: summary.success,
    timing: summary.timing
      ? {
        startTime: summary.timing.startTime,
        endTime: summary.timing.endTime,
      }
      : undefined,
  });
}

function notebookCellAt(
  notebook: vscode.NotebookDocument,
  index: number
): vscode.NotebookCell | undefined {
  return index >= 0 && index < notebook.cellCount ? notebook.cellAt(index) : undefined;
}

async function waitForNotebookReplacement(event: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      event,
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, 250);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function cellHasLiveResult(cell: vscode.NotebookCell, id: string): boolean {
  return cell.outputs.some(output => {
    const value = output.metadata?.[KX_NOTEBOOK_LIVE_METADATA_KEY];
    return !!value && typeof value === 'object' &&
      (value as { id?: unknown }).id === id;
  });
}
