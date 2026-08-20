import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { connectionEndpoint, KxConnection } from './connection';
import {
  KX_NOTEBOOK_MIME,
  NotebookV2CreationResult,
  NotebookTextResultInput,
  NotebookResultInput,
  PortableKxResult,
  createPortableKxResultV2,
  createPortableKxTextResultV2,
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
import {
  NOTEBOOK_LIVE_RESULT_METADATA_KEY,
  NOTEBOOK_OUTPUT_BINDING_METADATA_KEY,
  inspectNotebookKxOutputIdentity,
} from './notebook-message';
import { NotebookQTargetProfile } from './notebook-q-target';
import {
  QResultDisplayOptions,
  QValue,
  qValueToLosslessPortablePanel,
} from './q-ipc';

export const KX_Q_NOTEBOOK_CONTROLLER_ID = 'vscode-kdb.q-notebook-controller';
export const KX_Q_NOTEBOOK_TYPE = 'jupyter-notebook';
export const KX_Q_NOTEBOOK_CONTROLLER_LABEL = 'KX q (Direct IPC)';
export const KX_NOTEBOOK_LIVE_METADATA_KEY = NOTEBOOK_LIVE_RESULT_METADATA_KEY;
export const KX_NOTEBOOK_OUTPUT_BINDING_METADATA_KEY =
  NOTEBOOK_OUTPUT_BINDING_METADATA_KEY;
export const ENABLE_DIRECT_NOTEBOOK_CONTROLLER_SETTING =
  'vscode-kdb.notebook.enableDirectController';

const CANCELED_AFTER_ISSUE_SUFFIX =
  'was canceled locally. Direct IPC server work already sent may continue.';

export type DirectQCellRunResult =
  | 'executed'
  | 'canceled'
  | 'busy'
  | 'not-q'
  | 'unsupported-notebook'
  | 'stale'
  | 'write-failed'
  | 'unavailable';

export interface DirectQCellRunFailureDetail {
  stage: 'applyEdit' | 'verify' | 'live-bind' | 'unexpected';
  detail: string;
  issued?: boolean;
}

export type DirectQCellRunOptions =
  | {
      source?: undefined;
      runLabel?: string;
    }
  | {
      source: string;
      sourceCellSnapshot: {
        source: string;
        languageId: string;
      };
      runLabel?: string;
    };

type CellOutputReplacement =
  | vscode.NotebookCellOutput
  | readonly vscode.NotebookCellOutput[];

interface PreparedLiveResult {
  items: vscode.NotebookCellOutputItem[];
  outputId: string;
  registration: Omit<LiveNotebookResultRegistration, 'cellUri'>;
}

interface PreparedCellResult {
  success: boolean | undefined;
  output?: CellOutputReplacement;
  live?: PreparedLiveResult;
  canceled?: 'before-issue' | 'after-issue';
  stale?: boolean;
  issued?: boolean;
}

interface MixedCellSnapshot {
  notebook: vscode.NotebookDocument;
  cellUri: string;
  source: string;
  languageId: string;
  sourceOverrideAuthorized: boolean;
  outputs: readonly vscode.NotebookCellOutput[];
  executionSummary: string;
}

interface MixedOutputWriteResult {
  status: 'executed' | 'canceled' | 'stale' | 'write-failed' | 'unavailable';
  cell?: vscode.NotebookCell;
  failure?: DirectQCellRunFailureDetail;
}

interface KxOutputIdentity {
  liveId: string;
  outputId: string;
  payload: PortableKxResult;
}

type ParsedKxOutputIdentity =
  | { status: 'none' }
  | { status: 'invalid' }
  | { status: 'valid'; identity: KxOutputIdentity };

type ExpectedKxOutputIdentity = KxOutputIdentity | 'invalid' | undefined;

type MixedOutputVerificationStatus = 'match' | 'pending' | 'foreign';

const MIXED_NOTEBOOK_OUTPUT_VERIFY_TIMEOUT_MS = 1000;

export interface DirectQNotebookBridge {
  activeConnection(): KxConnection | undefined;
  connections(): readonly KxConnection[];
  connectionById(connectionId: string): KxConnection | undefined;
  isConnected(connectionId: string): boolean;
  executeScript(
    connection: KxConnection,
    source: string,
    onIssued: () => void,
    signal: AbortSignal,
    shouldIssue?: () => boolean
  ): Promise<QValue>;
  errorMessage(error: unknown, connection?: KxConnection): Promise<string>;
  onDidChangeState(listener: () => void): vscode.Disposable;
}

export class KxQNotebookRunner implements vscode.Disposable {
  public readonly onDidChangeState: vscode.Event<void>;

  private readonly stateSubscription: vscode.Disposable;
  private readonly configurationSubscription: vscode.Disposable;
  private readonly stateChanged = new vscode.EventEmitter<void>();
  private readonly selectedNotebooks = new Set<string>();
  private readonly activeExecutions = new Set<string>();
  private readonly lastRunFailures = new Map<string, DirectQCellRunFailureDetail>();
  private readonly allocatedOutputIds = new Set<string>();
  private controller: vscode.NotebookController | undefined;
  private selectionSubscription: vscode.Disposable | undefined;
  private executionOrder = 0;
  private disposed = false;

  public constructor(
    private readonly bridge: DirectQNotebookBridge,
    private readonly liveResults: LiveNotebookResultStore,
    private readonly outputIdFactory: () => string = () => crypto.randomBytes(24).toString('hex')
  ) {
    this.stateSubscription = this.bridge.onDidChangeState(() => this.refreshDetails());
    this.configurationSubscription = vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration(ENABLE_DIRECT_NOTEBOOK_CONTROLLER_SETTING)) {
        this.syncControllerRegistration();
      }
    });
    this.onDidChangeState = this.stateChanged.event;
    this.syncControllerRegistration();
    this.refreshDetails();
  }

  public refreshDetails(): void {
    if (this.disposed) {
      return;
    }
    const connection = this.bridge.activeConnection();
    if (this.controller) {
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
            : 'disconnected; native Run connects this active profile while selected',
        ].join(' • ')
        : 'Direct IPC • No active KX connection • Add or select one in the KX Connections view';
    }
    this.stateChanged.fire();
  }

  public routeLabel(connection: KxConnection | undefined = this.bridge.activeConnection()): string {
    return connection
      ? `KX • ${safeStatusText(connection.name, 100)} • ${safeStatusText(connection.database, 512)}`
      : 'KX • No active connection';
  }

  public connectionProfiles(): NotebookQTargetProfile[] {
    const activeId = this.bridge.activeConnection()?.id;
    return this.bridge.connections().map(connection => ({
      id: connection.id,
      name: safeStatusText(connection.name, 100),
      active: connection.id === activeId,
      connected: this.bridge.isConnected(connection.id),
    }));
  }

  public isSelected(notebook: Pick<vscode.NotebookDocument, 'uri'>): boolean {
    return this.selectedNotebooks.has(notebook.uri.toString());
  }

  public lastRunFailure(
    cell: Pick<vscode.NotebookCell, 'notebook' | 'document'>
  ): DirectQCellRunFailureDetail | undefined {
    return this.lastRunFailures.get(cellExecutionKey(cell.notebook, cell));
  }

  public isDirectControllerRegistered(): boolean {
    return this.controller !== undefined;
  }

  public async runCell(
    cell: vscode.NotebookCell,
    connectionId: string,
    options: DirectQCellRunOptions = {}
  ): Promise<DirectQCellRunResult> {
    if (this.disposed) {
      return 'unavailable';
    }
    if (cell.notebook.notebookType !== KX_Q_NOTEBOOK_TYPE) {
      return 'unsupported-notebook';
    }
    if (options.source !== undefined &&
      (cell.document.getText() !== options.sourceCellSnapshot.source ||
        cell.document.languageId !== options.sourceCellSnapshot.languageId)) {
      return 'stale';
    }
    if (cell.kind !== vscode.NotebookCellKind.Code ||
      (cell.document.languageId !== 'q' && options.source === undefined)) {
      return 'not-q';
    }
    const executionKey = cellExecutionKey(cell.notebook, cell);
    this.lastRunFailures.delete(executionKey);
    if (this.activeExecutions.has(executionKey)) {
      return 'busy';
    }
    this.activeExecutions.add(executionKey);
    try {
      const activeConnection = this.bridge.activeConnection();
      const connection = activeConnection && activeConnection.id === connectionId
        ? activeConnection
        : undefined;
      return await this.runMixedCell(
        cell,
        connection,
        options
      );
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
    this.configurationSubscription.dispose();
    this.unregisterController();
    this.stateChanged.dispose();
    this.activeExecutions.clear();
    this.lastRunFailures.clear();
  }

  private syncControllerRegistration(): void {
    if (this.disposed) {
      return;
    }
    const enabled = vscode.workspace
      .getConfiguration('vscode-kdb.notebook')
      .get<unknown>('enableDirectController', false);
    if (enabled !== true) {
      this.unregisterController();
      this.stateChanged.fire();
      return;
    }
    if (this.controller) {
      return;
    }
    const controller = vscode.notebooks.createNotebookController(
      KX_Q_NOTEBOOK_CONTROLLER_ID,
      KX_Q_NOTEBOOK_TYPE,
      KX_Q_NOTEBOOK_CONTROLLER_LABEL,
      (cells, notebook) => this.executeCells(cells, notebook)
    );
    controller.supportedLanguages = ['q'];
    controller.supportsExecutionOrder = true;
    this.controller = controller;
    this.selectionSubscription = controller.onDidChangeSelectedNotebooks(event => {
      const key = event.notebook.uri.toString();
      if (event.selected) {
        this.selectedNotebooks.add(key);
      } else {
        this.selectedNotebooks.delete(key);
      }
      this.stateChanged.fire();
    });
    this.refreshDetails();
  }

  private unregisterController(): void {
    this.selectionSubscription?.dispose();
    this.selectionSubscription = undefined;
    this.selectedNotebooks.clear();
    this.controller?.dispose();
    this.controller = undefined;
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

  private async runMixedCell(
    cell: vscode.NotebookCell,
    connection: KxConnection | undefined,
    options: DirectQCellRunOptions = {}
  ): Promise<DirectQCellRunResult> {
    const snapshot = mixedCellSnapshot(cell, options.source !== undefined);
    const abortController = new AbortController();
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `${this.routeLabel(connection)} • Run q Cell (KX)`,
        cancellable: true,
      },
      async (_progress, token) => {
        const cancellation = token.onCancellationRequested(() => abortController.abort());
        let liveResultId: string | undefined;
        let issued = false;
        try {
          const prepared = await this.prepareCellResult(
            cell,
            cell.notebook,
            options.runLabel || 'Run q Cell (KX)',
            token,
            abortController.signal,
            connection,
            'notebook',
            options.source,
            () => matchingMixedSourceCell(snapshot) !== undefined
          );
          issued = prepared.issued === true;
          if (prepared.stale) {
            return snapshot.notebook.isClosed ? 'unavailable' : 'stale';
          }
          if (prepared.canceled === 'before-issue') {
            return 'canceled';
          }
          const cancellationPrepared = prepared.canceled === 'after-issue';
          if (!cancellationPrepared &&
            (token.isCancellationRequested || abortController.signal.aborted)) {
            return 'canceled';
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
              (token.isCancellationRequested || abortController.signal.aborted),
            cancellationPrepared ? undefined : abortController.signal
          );
          if (written.status === 'canceled') {
            if (liveResultId) {
              this.liveResults.remove(liveResultId, snapshot.notebook.uri.toString());
            }
            return 'canceled';
          }
          if (written.status !== 'executed' || !written.cell) {
            if (written.status === 'write-failed' && written.failure) {
              this.recordRunFailure(snapshot, { ...written.failure, issued });
            }
            if (liveResultId) {
              this.liveResults.remove(liveResultId, snapshot.notebook.uri.toString());
            }
            return written.status;
          }
          if (liveResultId && materialized.liveRegistration) {
            const expectedOutputs = Array.isArray(materialized.output)
              ? materialized.output
              : [materialized.output];
            if (!notebookCellHasExpectedKxIdentity(written.cell, expectedOutputs)) {
              this.recordRunFailure(snapshot, {
                stage: 'live-bind',
                detail: 'The replacement cell did not expose the expected live KX result identity.',
                issued,
              });
              this.liveResults.remove(liveResultId, snapshot.notebook.uri.toString());
              return 'write-failed';
            }
            try {
              const replacementCellUri = written.cell.document.uri.toString();
              if (replacementCellUri !== snapshot.cellUri) {
                this.liveResults.removeCell(
                  snapshot.notebook.uri.toString(),
                  snapshot.cellUri
                );
              }
              this.liveResults.rebind(liveResultId, {
                ...materialized.liveRegistration,
                cellUri: replacementCellUri,
              });
            } catch {
              this.recordRunFailure(snapshot, {
                stage: 'live-bind',
                detail: 'The staged live KX result could not be bound to the replacement cell.',
                issued,
              });
              this.liveResults.remove(liveResultId, snapshot.notebook.uri.toString());
              return 'write-failed';
            }
          }
          return cancellationPrepared ? 'canceled' : 'executed';
        } catch {
          this.recordRunFailure(snapshot, {
            stage: 'unexpected',
            detail: 'The local notebook output update failed before verification completed.',
            issued,
          });
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

  private recordRunFailure(
    snapshot: MixedCellSnapshot,
    failure: DirectQCellRunFailureDetail
  ): void {
    this.lastRunFailures.set(mixedCellExecutionKey(snapshot), failure);
  }

  private async applyMixedCellOutput(
    snapshot: MixedCellSnapshot,
    current: vscode.NotebookCell,
    output: CellOutputReplacement,
    isCanceled: () => boolean,
    cancellationSignal?: AbortSignal
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
    const expectedOutputs = Array.isArray(output) ? [...output] : [output];
    const expectedKxOutput = expectedKxOutputIdentity(expectedOutputs);
    const committedOutputStatus = (candidate: vscode.NotebookCell): MixedOutputVerificationStatus =>
      mixedCellCommittedOutputStatus(
        candidate,
        snapshot,
        index,
        expectedOutputs,
        expectedKxOutput
      );
    const replacement = new vscode.NotebookCellData(
      current.kind,
      current.document.getText(),
      current.document.languageId
    );
    replacement.metadata = { ...current.metadata };
    replacement.outputs = expectedOutputs;

    let resolveReplacement: (() => void) | undefined;
    const nextReplacementEvent = (): Promise<void> => new Promise(resolve => {
      resolveReplacement = resolve;
    });
    let replacementEvent = nextReplacementEvent();
    const signalReplacement = (): void => {
      const resolveCurrent = resolveReplacement;
      replacementEvent = nextReplacementEvent();
      resolveCurrent?.();
    };
    const eventSubscription = vscode.workspace.onDidChangeNotebookDocument(event => {
      if (event.notebook !== snapshot.notebook) {
        return;
      }
      if (event.contentChanges.some(change => change.range.start <= index) ||
        event.cellChanges.some(change =>
          change.outputs !== undefined &&
          change.cell.index === index
        )) {
        signalReplacement();
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
          failure: {
            stage: 'applyEdit',
            detail: 'VS Code threw while applying the notebook cell replacement.',
          },
        };
      }
      if (!applied) {
        return {
          status: snapshot.notebook.isClosed
            ? 'unavailable'
            : matchingMixedCell(snapshot)
              ? 'write-failed'
              : 'stale',
          failure: {
            stage: 'applyEdit',
            detail: 'VS Code rejected the notebook cell replacement.',
          },
        };
      }
      if (snapshot.notebook.isClosed) {
        return { status: 'unavailable' };
      }

      const verificationDeadline = Date.now() + MIXED_NOTEBOOK_OUTPUT_VERIFY_TIMEOUT_MS;
      let deadlineExpired = false;
      let cancellationObserved = false;
      while (true) {
        const nextEvent = replacementEvent;
        if (snapshot.notebook.isClosed) {
          return { status: 'unavailable' };
        }
        const written = notebookCellAt(snapshot.notebook, index);
        const verification = written
          ? committedOutputStatus(written)
          : 'pending';
        if (written && verification === 'match') {
          return { status: 'executed', cell: written };
        }
        if (cancellationObserved || isCanceled()) {
          return { status: 'canceled' };
        }
        if (!written || !mixedCellSourceAtIndexMatchesSnapshot(written, snapshot, index)) {
          return { status: 'stale' };
        }
        if (expectedKxOutput === 'invalid' ||
          deadlineExpired || Date.now() >= verificationDeadline) {
          return {
            status: 'write-failed',
            failure: {
              stage: 'verify',
              detail: verification === 'foreign'
                ? 'VS Code committed a replacement cell with a different or invalid KX output identity.'
                : `VS Code reported the notebook edit was applied, but the replacement cell did not expose the expected ${expectedKxOutput ? 'KX output identity' : 'output'} within ${MIXED_NOTEBOOK_OUTPUT_VERIFY_TIMEOUT_MS} ms.`,
            },
          };
        }
        const waitStatus = await waitForNotebookReplacement(
          nextEvent,
          verificationDeadline,
          cancellationSignal
        );
        cancellationObserved = waitStatus === 'canceled';
        deadlineExpired = waitStatus === 'deadline';
      }
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
    const controller = this.controller;
    if (!controller) {
      return undefined;
    }
    this.activeExecutions.add(executionKey);
    try {
      return {
        execution: controller.createNotebookCellExecution(cell),
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
    const source = cell.document.getText();
    const cellUri = cell.document.uri.toString();
    const languageId = cell.document.languageId;
    const isStillCurrent = (): boolean => !notebook.isClosed &&
      notebook.getCells().some(candidate =>
        candidate.document.uri.toString() === cellUri &&
        candidate.document.languageId === languageId &&
        candidate.document.getText() === source
      );
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
      if (!isStillCurrent()) {
        success = undefined;
        return;
      }
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
        abortController.signal,
        this.bridge.activeConnection(),
        'active',
        source,
        isStillCurrent
      );
      if (prepared.stale) {
        success = undefined;
        return;
      }
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
    signal: AbortSignal,
    connection: KxConnection | undefined,
    targetKind: 'active' | 'notebook',
    sourceOverride?: string,
    isStillCurrent?: () => boolean
  ): Promise<PreparedCellResult> {
    let issued = false;
    const canceledOutput = (): PreparedCellResult => ({
      success: undefined,
      issued,
      canceled: issued ? 'after-issue' : 'before-issue',
      output: issued
        ? textOutput(`${runLabel} ${CANCELED_AFTER_ISSUE_SUFFIX}`)
        : [],
    });
    try {
      if (token.isCancellationRequested || signal.aborted) {
        return canceledOutput();
      }
      if (isStillCurrent && !isStillCurrent()) {
        return { success: undefined, output: [], stale: true };
      }
      this.refreshDetails();
      if (!connection) {
        return {
          success: false,
          output: errorOutput(
            targetKind === 'notebook'
              ? `${runLabel} has no active KX direct IPC connection. Activate a KX connection, ` +
                'then retry the cell.'
              : `${runLabel} has no active KX direct IPC connection. Add or select a KX connection ` +
                'in the KX Connections view, optionally test it, then retry the cell.'
          ),
        };
      }
      const source = sourceOverride === undefined
        ? cell.document.getText()
        : sourceOverride;
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
      if (isStillCurrent && !isStillCurrent()) {
        return { success: undefined, output: [], stale: true };
      }
      const startedAt = Date.now();
      const value = await this.bridge.executeScript(
        connection,
        source,
        () => {
          issued = true;
        },
        signal,
        isStillCurrent
      );
      if (token.isCancellationRequested || signal.aborted) {
        return canceledOutput();
      }
      issued = true;
      const elapsedMs = Date.now() - startedAt;
      const settings = directNotebookSettings();
      const outputId = this.uniqueOutputId();
      return {
        success: true,
        issued,
        live: {
          items: this.directQResultOutputItems(
            value,
            settings,
            directQResultDisplayOptions(),
            connection,
            elapsedMs,
            outputId
          ),
          outputId,
          registration: {
            notebookUri: notebook.uri.toString(),
            outputId,
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
      if (!issued && isStillCurrent && !isStillCurrent()) {
        return { success: undefined, output: [], stale: true };
      }
      const detail = await this.safeErrorMessage(error, connection);
      const context = connection
        ? ` for KX connection "${safeStatusText(connection.name, 100)}"`
        : '';
      return {
        success: false,
        issued,
        output: errorOutput(
          `${runLabel} failed${context}: ${detail}. ` +
          'Use KX: Test Connection to verify that profile.'
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
      outputId?: string;
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
      ? this.liveResults.stage(registration, prepared.live.outputId)
      : this.liveResults.register(registration, prepared.live.outputId);
    return {
      output: new vscode.NotebookCellOutput(
        prepared.live.items,
        liveResultOutputMetadata(liveResultId, prepared.live.outputId)
      ),
      liveResultId,
      outputId: prepared.live.outputId,
      liveRegistration: registration,
    };
  }

  private uniqueOutputId(): string {
    for (let attempt = 0; attempt < 16; attempt++) {
      const candidate = String(this.outputIdFactory());
      if (/^[A-Za-z0-9_-]{32,128}$/.test(candidate) &&
        !this.allocatedOutputIds.has(candidate)) {
        this.allocatedOutputIds.add(candidate);
        return candidate;
      }
    }
    throw new Error('Could not allocate a safe notebook output identifier.');
  }

  private directQResultOutputItems(
    value: QValue,
    settings: NotebookSettings,
    displayOptions: QResultDisplayOptions,
    connection: KxConnection,
    elapsedMs: number,
    outputId: string
  ): vscode.NotebookCellOutputItem[] {
    return directQResultOutputItems(
      value,
      settings,
      displayOptions,
      connection,
      elapsedMs,
      outputId
    );
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

// Keep the 0.2.7 exported name for source compatibility while the always-on
// object is now truthfully a mixed-mode runner.
export { KxQNotebookRunner as KxQNotebookController };

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
  elapsedMs: number,
  outputId = crypto.randomBytes(24).toString('hex')
): vscode.NotebookCellOutputItem[] {
  const created = directQPortableResult(
    value,
    settings,
    displayOptions,
    connection,
    elapsedMs,
    outputId
  );
  if (!created.ok) {
    throw new Error(created.error);
  }
  return notebookOutputItems(created.value, settings.byteLimit);
}

export function directQPortableResult(
  value: QValue,
  settings: NotebookSettings,
  displayOptions: QResultDisplayOptions,
  connection: KxConnection,
  elapsedMs: number,
  outputId: string
): NotebookV2CreationResult {
  const panel = qValueToLosslessPortablePanel(value, displayOptions);
  if (!panel) {
    return {
      ok: false,
      error: 'The complete q result cannot be converted to portable output without losing values.',
      rowCount: 0,
      columnCount: 0,
    };
  }
  if (panel.exactPersistenceIssue) {
    return {
      ok: false,
      error: panel.exactPersistenceIssue,
      rowCount: panel.mode === 'grid' ? panel.result.rowCount : 0,
      columnCount: panel.mode === 'grid' ? panel.result.columns.length : 0,
    };
  }
  if (panel.mode === 'text') {
    const input: NotebookTextResultInput = {
      text: panel.text,
      rowLimit: settings.rowLimit,
      byteLimit: settings.byteLimit,
      label: `${connection.name} • Direct IPC • ${connection.database}`,
      elapsedMs,
      marker: 'direct-ipc',
    };
    return createPortableKxTextResultV2(input, { outputId, persistenceMode: 'full' });
  }
  const input: NotebookResultInput = {
    columns: panel.result.columns.map((name, index) => ({
      name,
      type: panel.result.columnTypes?.[index] || 'mixed',
    })),
    ...(panel.result.keyColumnOrdinals === undefined
      ? {}
      : { keyColumnOrdinals: panel.result.keyColumnOrdinals }),
    rows: [],
    cellValue: (rowIndex, columnIndex) => panel.result.cellValue(rowIndex, columnIndex),
    rowCount: panel.result.rowCount,
    rowLimit: settings.rowLimit,
    byteLimit: settings.byteLimit,
    label: `${connection.name} • Direct IPC • ${connection.database}`,
    elapsedMs,
    marker: 'direct-ipc',
  };
  return createPortableKxResultV2(input, { outputId, persistenceMode: 'full' });
}

export function notebookOutputItems(
  portable: PortableKxResult,
  byteLimit: number
): vscode.NotebookCellOutputItem[] {
  const validation = validatePortableKxResult(portable);
  if (!validation.ok) {
    throw new Error(`Portable KX notebook result validation failed: ${validation.error}`);
  }
  const payload = validation.value;
  const plainText = boundedNotebookText(notebookResultPlainText(payload), byteLimit);
  return [
    vscode.NotebookCellOutputItem.json(payload, KX_NOTEBOOK_MIME),
    vscode.NotebookCellOutputItem.text(plainText, 'text/plain'),
  ];
}

export function directQResultDisplayOptions(): QResultDisplayOptions {
  const configuration = vscode.workspace.getConfiguration('vscode-kdb.results.viewer');
  return {
    dictionaryDisplayStrategy: configuration.get<string>('dictionaryDisplayStrategy'),
    listDisplayStrategy: configuration.get<string>('listDisplayStrategy'),
  };
}

export function liveResultOutputMetadata(
  liveId: string,
  outputId: string
): { [key: string]: unknown } {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(liveId)) {
    throw new Error('Live KX notebook result identifier is invalid.');
  }
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(outputId)) {
    throw new Error('KX notebook output identifier is invalid.');
  }
  const outputReference = { version: 1, id: outputId };
  return {
    // Keep the current top-level binding architecture for active renderers and
    // mirror it into Jupyter output metadata so identity survives save/reopen.
    [KX_NOTEBOOK_OUTPUT_BINDING_METADATA_KEY]: outputReference,
    metadata: {
      [KX_NOTEBOOK_OUTPUT_BINDING_METADATA_KEY]: outputReference,
    },
    [KX_NOTEBOOK_LIVE_METADATA_KEY]: {
      version: 1,
      id: liveId,
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

function mixedCellSnapshot(
  cell: vscode.NotebookCell,
  sourceOverrideAuthorized: boolean
): MixedCellSnapshot {
  return {
    notebook: cell.notebook,
    cellUri: cell.document.uri.toString(),
    source: cell.document.getText(),
    languageId: cell.document.languageId,
    sourceOverrideAuthorized,
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

function matchingMixedSourceCell(snapshot: MixedCellSnapshot): vscode.NotebookCell | undefined {
  if (snapshot.notebook.isClosed) {
    return undefined;
  }
  const current = snapshot.notebook.getCells().find(
    candidate => candidate.document.uri.toString() === snapshot.cellUri
  );
  return current && mixedCellSourceMatchesSnapshot(current, snapshot) ? current : undefined;
}

function mixedCellSourceMatchesSnapshot(
  cell: vscode.NotebookCell,
  snapshot: MixedCellSnapshot
): boolean {
  return cell.notebook === snapshot.notebook &&
    cell.kind === vscode.NotebookCellKind.Code &&
    cell.document.uri.toString() === snapshot.cellUri &&
    cell.document.languageId === snapshot.languageId &&
    (cell.document.languageId === 'q' || snapshot.sourceOverrideAuthorized) &&
    cell.document.getText() === snapshot.source;
}

function mixedCellMatchesSnapshot(
  cell: vscode.NotebookCell,
  snapshot: MixedCellSnapshot
): boolean {
  return mixedCellSourceMatchesSnapshot(cell, snapshot) &&
    cell.outputs.length === snapshot.outputs.length &&
    cell.outputs.every((output, index) => output === snapshot.outputs[index]) &&
    executionSummaryKey(cell.executionSummary) === snapshot.executionSummary;
}

function mixedCellExecutionKey(snapshot: MixedCellSnapshot): string {
  return `${snapshot.notebook.uri.toString()}\0${snapshot.cellUri}`;
}

function mixedCellSourceAtIndexMatchesSnapshot(
  cell: vscode.NotebookCell,
  snapshot: MixedCellSnapshot,
  index: number
): boolean {
  return cell.notebook === snapshot.notebook &&
    cell.index === index &&
    cell.kind === vscode.NotebookCellKind.Code &&
    cell.document.languageId === snapshot.languageId &&
    cell.document.getText() === snapshot.source;
}

function mixedCellCommittedOutputStatus(
  cell: vscode.NotebookCell,
  snapshot: MixedCellSnapshot,
  index: number,
  expectedOutputs: readonly vscode.NotebookCellOutput[],
  expectedKxOutput: ExpectedKxOutputIdentity
): MixedOutputVerificationStatus {
  if (!mixedCellSourceAtIndexMatchesSnapshot(cell, snapshot, index)) {
    return 'pending';
  }
  if (mixedCellMatchesSnapshot(cell, snapshot)) {
    return 'pending';
  }
  if (expectedKxOutput) {
    return kxOutputsContainExpectedIdentity(
      cell.outputs,
      expectedOutputs.length,
      expectedKxOutput
    );
  }
  return notebookCellOutputsEqual(cell.outputs, expectedOutputs)
    ? 'match'
    : 'pending';
}

function expectedKxOutputIdentity(
  outputs: readonly vscode.NotebookCellOutput[]
): ExpectedKxOutputIdentity {
  let expected: KxOutputIdentity | undefined;
  for (const output of outputs) {
    const parsed = notebookOutputKxIdentity(output);
    if (parsed.status === 'invalid') {
      return 'invalid';
    }
    if (parsed.status !== 'valid') {
      continue;
    }
    if (expected) {
      return 'invalid';
    }
    expected = parsed.identity;
  }
  return expected;
}

function kxOutputsContainExpectedIdentity(
  outputs: readonly vscode.NotebookCellOutput[],
  expectedOutputCount: number,
  expected: ExpectedKxOutputIdentity
): MixedOutputVerificationStatus {
  if (expected === 'invalid') {
    return 'foreign';
  }
  if (!expected) {
    return 'pending';
  }
  if (outputs.length !== expectedOutputCount) {
    return 'pending';
  }
  let actual: KxOutputIdentity | undefined;
  for (const output of outputs) {
    const parsed = notebookOutputKxIdentity(output);
    if (parsed.status === 'invalid') {
      return 'foreign';
    }
    if (parsed.status !== 'valid') {
      continue;
    }
    if (actual) {
      return 'foreign';
    }
    actual = parsed.identity;
  }
  if (!actual) {
    return 'pending';
  }
  return actual.liveId === expected.liveId &&
    actual.outputId === expected.outputId &&
    notebookJsonEqual(actual.payload, expected.payload)
    ? 'match'
    : 'foreign';
}

function notebookOutputKxIdentity(
  output: vscode.NotebookCellOutput
): ParsedKxOutputIdentity {
  const inspected = inspectNotebookKxOutputIdentity(output.metadata, output.items);
  if (inspected.status === 'valid' && inspected.identity.live) {
    return {
      status: 'valid',
      identity: {
        liveId: inspected.identity.live.id,
        outputId: inspected.identity.binding.id,
        payload: inspected.identity.payload,
      },
    };
  }
  if (inspected.status === 'none') {
    return { status: 'none' };
  }
  return { status: 'invalid' };
}

function notebookCellOutputsEqual(
  actual: readonly vscode.NotebookCellOutput[],
  expected: readonly vscode.NotebookCellOutput[]
): boolean {
  return actual.length === expected.length && actual.every((output, index) => {
    const target = expected[index];
    if (output === target) {
      return true;
    }
    if (!notebookJsonEqual(output.metadata, target.metadata) ||
      output.items.length !== target.items.length) {
      return false;
    }
    return output.items.every((item, itemIndex) => {
      const targetItem = target.items[itemIndex];
      if (item.mime !== targetItem.mime) {
        return false;
      }
      if (item.data instanceof Uint8Array && targetItem.data instanceof Uint8Array) {
        return notebookBytesEqual(item.data, targetItem.data);
      }
      return notebookJsonEqual(item, targetItem);
    });
  });
}

function notebookBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function notebookJsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (typeof left !== 'object' || left === null ||
    typeof right !== 'object' || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => notebookJsonEqual(value, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return leftKeys.length === rightKeys.length && leftKeys.every(key =>
    Object.prototype.hasOwnProperty.call(rightRecord, key) &&
    notebookJsonEqual(leftRecord[key], rightRecord[key])
  );
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

async function waitForNotebookReplacement(
  event: Promise<void>,
  deadline: number,
  cancellationSignal?: AbortSignal
): Promise<'changed' | 'deadline' | 'canceled'> {
  if (cancellationSignal?.aborted) {
    return 'canceled';
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onCanceled: (() => void) | undefined;
  try {
    // VS Code/Jupyter can settle serializer-owned cell output after applyEdit
    // resolves, potentially through more than one intermediate state. Each
    // event prompts another strict identity check; the absolute deadline keeps
    // even a noisy stream of unrelated changes bounded.
    return await Promise.race([
      event.then(() => 'changed' as const),
      new Promise<'deadline'>(resolve => {
        timer = setTimeout(
          () => resolve('deadline'),
          Math.max(0, deadline - Date.now())
        );
      }),
      ...(cancellationSignal
        ? [new Promise<'canceled'>(resolve => {
          onCanceled = () => resolve('canceled');
          cancellationSignal.addEventListener('abort', onCanceled, { once: true });
          if (cancellationSignal.aborted) {
            onCanceled();
          }
        })]
        : []),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    if (onCanceled) {
      cancellationSignal?.removeEventListener('abort', onCanceled);
    }
  }
}

export function notebookCellHasExpectedKxIdentity(
  cell: Pick<vscode.NotebookCell, 'outputs'>,
  expectedOutputs: readonly vscode.NotebookCellOutput[]
): boolean {
  return kxOutputsContainExpectedIdentity(
    cell.outputs,
    expectedOutputs.length,
    expectedKxOutputIdentity(expectedOutputs)
  ) === 'match';
}
