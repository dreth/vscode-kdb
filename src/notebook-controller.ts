import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { connectionEndpoint, KxConnection } from './connection';
import {
  KX_NOTEBOOK_MIME,
  NotebookPersistenceMode,
  NotebookV2CreationResult,
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
  safeNotebookPreserveFullResultByDefault,
  safeNotebookRowLimit,
} from './notebook-settings';
import {
  LiveNotebookResultRegistration,
  LiveNotebookResultStore,
} from './notebook-live-results';
import {
  NOTEBOOK_LIVE_RESULT_METADATA_KEY,
  NOTEBOOK_OUTPUT_METADATA_KEY,
  parseNotebookLiveResultReference,
  parseNotebookOutputReferenceFromMetadata,
  parseNotebookPortableOutputBinding,
} from './notebook-message';
import { NotebookQTargetProfile } from './notebook-q-target';
import {
  QResultDisplayOptions,
  QValue,
  qValueToColumnarPanel,
  qValueToLosslessPortablePanel,
} from './q-ipc';

export const KX_Q_NOTEBOOK_CONTROLLER_ID = 'vscode-kdb.q-notebook-controller';
export const KX_Q_NOTEBOOK_TYPE = 'jupyter-notebook';
export const KX_Q_NOTEBOOK_CONTROLLER_LABEL = 'KX q (Direct IPC)';
export const KX_NOTEBOOK_LIVE_METADATA_KEY = NOTEBOOK_LIVE_RESULT_METADATA_KEY;
export const KX_NOTEBOOK_OUTPUT_METADATA_KEY = NOTEBOOK_OUTPUT_METADATA_KEY;
export const ENABLE_DIRECT_NOTEBOOK_CONTROLLER_SETTING =
  'vscode-kdb.notebook.enableDirectController';

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
  outputId: string;
  registration: Omit<LiveNotebookResultRegistration, 'cellUri'>;
}

interface PreparedCellResult {
  success: boolean | undefined;
  output?: CellOutputReplacement;
  live?: PreparedLiveResult;
  canceled?: 'before-issue' | 'after-issue';
  stale?: boolean;
}

interface MixedCellSnapshot {
  notebook: vscode.NotebookDocument;
  cellUri: string;
  source: string;
  languageId: string;
  outputs: readonly MixedOutputSnapshot[];
  executionSummary: string;
}

interface MixedOutputSnapshot {
  readonly output: vscode.NotebookCellOutput;
  readonly metadata: unknown;
  readonly items: readonly {
    readonly item: vscode.NotebookCellOutputItem;
    readonly data: Uint8Array;
    readonly mime: string;
  }[];
}

interface MixedOutputWriteResult {
  status: 'executed' | 'canceled' | 'stale' | 'write-failed' | 'unavailable';
  cell?: vscode.NotebookCell;
}

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

  public isDirectControllerRegistered(): boolean {
    return this.controller !== undefined;
  }

  public async runCell(
    cell: vscode.NotebookCell,
    connectionId: string
  ): Promise<DirectQCellRunResult> {
    if (this.disposed) {
      return 'unavailable';
    }
    const currentCell = currentNotebookMember(cell);
    if (!currentCell) {
      return 'stale';
    }
    cell = currentCell;
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
      return await this.runMixedCell(cell, this.bridge.connectionById(connectionId));
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
    connection: KxConnection | undefined
  ): Promise<DirectQCellRunResult> {
    const snapshot = mixedCellSnapshot(cell);
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
        try {
          const prepared = await this.prepareCellResult(
            cell,
            cell.notebook,
            'Run q Cell (KX)',
            token,
            abortController.signal,
            connection,
            'notebook',
            snapshot.source,
            () => matchingMixedSourceCell(snapshot) !== undefined
          );
          if (prepared.stale) {
            return snapshot.notebook.isClosed ? 'unavailable' : 'stale';
          }
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
            materialized.liveResultId,
            materialized.outputId,
            materialized.liveRegistration,
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
    expectedLiveId: string | undefined,
    expectedOutputId: string | undefined,
    liveRegistration: LiveNotebookResultRegistration | undefined,
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

    const ownedPriorBindings = freshLiveBindings(current).filter(binding =>
      this.liveResults.hasForOutput(
        binding.liveId,
        snapshot.notebook.uri.toString(),
        current.document.uri.toString(),
        binding.outputId
      )
    );
    const priorBinding = ownedPriorBindings.length === 1
      ? ownedPriorBindings[0]
      : undefined;
    const protectedPriorLiveId = priorBinding?.liveId;
    if (protectedPriorLiveId && !this.liveResults.beginCellMove(
      protectedPriorLiveId,
      snapshot.notebook.uri.toString(),
      current.document.uri.toString()
    )) {
      return { status: 'stale' };
    }

    let eventCell: vscode.NotebookCell | undefined;
    let ownOutputObserved = false;
    let stagedCommitted = false;
    let stagedCommitFailed = false;
    let competingCell: vscode.NotebookCellData | undefined;
    let competingRemoval = false;
    let structuralConflict = false;
    let expectedReconciliationCell: vscode.NotebookCellData | undefined;
    let expectedReconciliationRemoval = false;
    let reconciliationActive = false;
    let reconciliationExhausted = false;
    let resolveReplacement: (() => void) | undefined;
    const replacementEvent = new Promise<void>(resolve => {
      resolveReplacement = resolve;
    });
    const eventSubscription = vscode.workspace.onDidChangeNotebookDocument(event => {
      if (event.notebook !== snapshot.notebook) {
        return;
      }
      const accept = (candidate: vscode.NotebookCell | undefined): boolean => {
        if (committedMixedCellMatches(
          candidate,
          snapshot,
          index,
          expectedLiveId,
          expectedOutputId,
          replacement
        )) {
          ownOutputObserved = true;
          eventCell = candidate;
          if (expectedLiveId && liveRegistration && !stagedCommitted &&
            !stagedCommitFailed && !competingCell && !competingRemoval &&
            cellHasLiveResult(candidate, expectedLiveId)) {
            try {
              // Commit in the notebook-change callback. Renderer messages may be
              // delivered before applyEdit resolves, so deferring this binding
              // would create a real, user-visible "Result unavailable" race.
              this.liveResults.commitStaged(expectedLiveId, {
                ...liveRegistration,
                cellUri: candidate.document.uri.toString(),
              }, snapshot.cellUri);
              stagedCommitted = true;
            } catch {
              stagedCommitFailed = true;
            }
          }
          resolveReplacement?.();
          return true;
        }
        return false;
      };
      for (const change of event.contentChanges) {
        const removedTarget = change.removedCells.some(removed =>
          removed.document.uri.toString() === snapshot.cellUri
        );
        const affectsStaleIndex = change.range.start <= index &&
          (change.range.end > index ||
            change.addedCells.length !== change.removedCells.length);
        const shiftsOrReplacesTarget = affectsStaleIndex ||
          (!structuralConflict && removedTarget);
        if (!shiftsOrReplacesTarget) {
          continue;
        }
        const relativeIndex = index - change.range.start;
        const added = relativeIndex >= 0
          ? change.addedCells[relativeIndex]
          : undefined;
        const currentAtTarget = notebookCellAt(snapshot.notebook, index);
        const expectedReconciliation = expectedReconciliationRemoval
          ? !currentAtTarget
          : !!expectedReconciliationCell && !!currentAtTarget && notebookCellMatchesData(
            currentAtTarget,
            expectedReconciliationCell,
            snapshot.notebook,
            index
          );
        const ownCommit = !reconciliationActive && !expectedReconciliation &&
          accept(currentAtTarget ?? added);
        if (!expectedReconciliation && !ownCommit && shiftsOrReplacesTarget) {
          // WorkspaceEdit has no public notebook-version CAS. If another
          // structural edit shifts the target, our already-created edit can
          // overwrite the cell now occupying the stale index. Preserve that
          // exact cell (or the absence of one) so it can be restored if our
          // edit is observed as the final writer.
          structuralConflict = true;
          const currentAtStaleIndex = notebookCellAt(snapshot.notebook, index);
          const captured = currentAtStaleIndex
            ? notebookCellDataSnapshot(currentAtStaleIndex) ??
              referencedNotebookCellDataSnapshot(currentAtStaleIndex)
            : undefined;
          competingCell = captured;
          competingRemoval = !currentAtStaleIndex;
          if (currentAtStaleIndex && !captured) {
            reconciliationExhausted = true;
          }
        }
      }
      for (const change of event.cellChanges) {
        if (change.cell.index !== index &&
          change.cell.document.uri.toString() !== snapshot.cellUri) {
          continue;
        }
        const expectedReconciliation = !!expectedReconciliationCell &&
          notebookCellMatchesData(
            change.cell,
            expectedReconciliationCell,
            snapshot.notebook,
            index
          );
        const ownCommit = !reconciliationActive && !expectedReconciliation && accept(change.cell);
        if (!expectedReconciliation && !ownCommit &&
          (change.cell.index === index ||
            (!structuralConflict &&
              change.cell.document.uri.toString() === snapshot.cellUri))) {
          const captured = notebookCellDataSnapshot(change.cell) ??
            referencedNotebookCellDataSnapshot(change.cell);
          competingCell = captured;
          competingRemoval = false;
          if (!captured) {
            reconciliationExhausted = true;
          }
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
      if (reconciliationExhausted) {
        return { status: 'stale' };
      }

      let written = notebookCellAt(snapshot.notebook, index) ?? eventCell;
      if (!ownOutputObserved) {
        acceptCommittedMixedCell(
          written,
          snapshot,
          index,
          expectedLiveId,
          expectedOutputId,
          replacement,
          candidate => {
            ownOutputObserved = true;
            eventCell = candidate;
            if (expectedLiveId && liveRegistration && !stagedCommitted &&
              !stagedCommitFailed && !competingCell && !competingRemoval &&
              cellHasLiveResult(candidate, expectedLiveId)) {
              try {
                this.liveResults.commitStaged(expectedLiveId, {
                  ...liveRegistration,
                  cellUri: candidate.document.uri.toString(),
                }, snapshot.cellUri);
                stagedCommitted = true;
              } catch {
                stagedCommitFailed = true;
              }
            }
          }
        );
      }
      if (!committedMixedCellMatches(
        written,
        snapshot,
        index,
        expectedLiveId,
        expectedOutputId,
        replacement
      )) {
        await waitForNotebookReplacement(replacementEvent);
        written = notebookCellAt(snapshot.notebook, index) ?? eventCell;
      }
      if ((competingCell || competingRemoval) && committedMixedCellMatches(
        written,
        snapshot,
        index,
        expectedLiveId,
        expectedOutputId,
        replacement
      )) {
        const desiredCell = competingCell;
        const desiredRemoval = competingRemoval;
        expectedReconciliationCell = desiredCell;
        expectedReconciliationRemoval = desiredRemoval;
        reconciliationActive = true;
        const applied = await reconcileCompetingMixedCell(
          snapshot.notebook,
          index,
          desiredCell,
          desiredRemoval
        );
        expectedReconciliationCell = undefined;
        expectedReconciliationRemoval = false;
        reconciliationActive = false;
        if (!applied) {
          reconciliationExhausted = true;
        }
        return { status: snapshot.notebook.isClosed ? 'unavailable' : 'stale' };
      }
      if (!committedMixedCellMatches(
        written,
        snapshot,
        index,
        expectedLiveId,
        expectedOutputId,
        replacement
      )) {
        return {
          status: snapshot.notebook.isClosed ? 'unavailable' : 'stale',
        };
      }
      if (expectedLiveId && liveRegistration) {
        if (!cellHasLiveResult(written, expectedLiveId)) {
          return { status: 'stale' };
        }
        if (stagedCommitFailed) {
          return { status: 'write-failed' };
        }
        if (!stagedCommitted) {
          try {
            this.liveResults.commitStaged(expectedLiveId, {
              ...liveRegistration,
              cellUri: written.document.uri.toString(),
            }, snapshot.cellUri);
            stagedCommitted = true;
          } catch {
            return { status: 'write-failed' };
          }
        }
      }
      return { status: 'executed', cell: written };
    } finally {
      eventSubscription.dispose();
      if (protectedPriorLiveId && priorBinding && this.liveResults.has(
        protectedPriorLiveId,
        snapshot.notebook.uri.toString()
      )) {
        if (reconciliationExhausted) {
          this.liveResults.cancelCellMove(
            protectedPriorLiveId,
            snapshot.notebook.uri.toString(),
            current.document.uri.toString(),
            true
          );
        } else {
          const owners = freshBindingOwners(
            snapshot.notebook,
            priorBinding.liveId,
            priorBinding.outputId
          );
          if (owners.length === 1 &&
            owners[0].document.uri.toString() !== current.document.uri.toString()) {
            if (!this.liveResults.completeCellMove(
              protectedPriorLiveId,
              snapshot.notebook.uri.toString(),
              current.document.uri.toString(),
              owners[0].document.uri.toString()
            )) {
              this.liveResults.cancelCellMove(
                protectedPriorLiveId,
                snapshot.notebook.uri.toString(),
                current.document.uri.toString(),
                true
              );
            }
          } else {
            this.liveResults.cancelCellMove(
              protectedPriorLiveId,
              snapshot.notebook.uri.toString(),
              current.document.uri.toString(),
              owners.length !== 1
            );
          }
        }
      }
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
    const cancellation = execution.token.onCancellationRequested(() => abortController.abort());
    const source = cell.document.getText();
    const cellUri = cell.document.uri.toString();
    const languageId = cell.document.languageId;
    const isStillCurrent = (): boolean => !notebook.isClosed &&
      notebook.getCells().some(current => current === cell &&
        current.notebook === notebook &&
        current.document.uri.toString() === cellUri &&
        current.document.languageId === languageId &&
        current.document.getText() === source);
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
      if (execution.token.isCancellationRequested || abortController.signal.aborted) {
        success = undefined;
        await execution.replaceOutput(
          prepared.live
            ? textOutput(`${KX_Q_NOTEBOOK_CONTROLLER_LABEL} ${CANCELED_AFTER_ISSUE_SUFFIX}`)
            : (prepared.output ?? [])
        );
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
              ? `${runLabel} has no available saved notebook q target. Choose a KX target for ` +
                'this notebook, then retry the cell.'
              : `${runLabel} has no active KX direct IPC connection. Add or select a KX connection ` +
                'in the KX Connections view, optionally test it, then retry the cell.'
          ),
        };
      }
      const source = sourceOverride ?? cell.document.getText();
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
      // This is deliberately adjacent to executeScript. withProgress and
      // connection resolution may yield, and a stale mixed-controller cell
      // must never dispatch its old q source merely because the write is later
      // rejected.
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
      const elapsedMs = Date.now() - startedAt;
      const settings = directNotebookSettings();
      const outputId = this.uniqueOutputId();
      return {
        success: true,
        live: {
          items: await this.directQResultOutputItems(
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
      ? this.liveResults.stage(registration)
      : this.liveResults.register(registration);
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
      if (/^[A-Za-z0-9_-]{32,128}$/.test(candidate)) {
        return candidate;
      }
    }
    throw new Error('Could not allocate a safe notebook output identifier.');
  }

  private async directQResultOutputItems(
    value: QValue,
    settings: NotebookSettings,
    displayOptions: QResultDisplayOptions,
    connection: KxConnection,
    elapsedMs: number,
    outputId: string
  ): Promise<vscode.NotebookCellOutputItem[]> {
    if (!settings.preserveFullResultByDefault) {
      return directQResultOutputItems(
        value,
        settings,
        displayOptions,
        connection,
        elapsedMs,
        outputId,
        'preview'
      );
    }
    const full = directQPortableResult(
      value,
      settings,
      displayOptions,
      connection,
      elapsedMs,
      outputId,
      'full'
    );
    if (!full.ok) {
      throw new Error(`Full notebook persistence failed: ${full.error}`);
    }
    return notebookOutputItems(full.value, settings.byteLimit);
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
    preserveFullResultByDefault: safeNotebookPreserveFullResultByDefault(
      configuration.get('preserveFullResultByDefault')
    ),
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
  outputId = crypto.randomBytes(24).toString('hex'),
  persistenceMode: NotebookPersistenceMode = 'preview'
): vscode.NotebookCellOutputItem[] {
  const created = directQPortableResult(
    value,
    settings,
    displayOptions,
    connection,
    elapsedMs,
    outputId,
    persistenceMode
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
  outputId: string,
  persistenceMode: NotebookPersistenceMode
): NotebookV2CreationResult {
  const panel = persistenceMode === 'full'
    ? qValueToLosslessPortablePanel(value, displayOptions)
    : qValueToColumnarPanel(value, displayOptions);
  if (!panel) {
    return {
      ok: false,
      error: 'The complete q result cannot be converted to portable output without losing values.',
      rowCount: 0,
      columnCount: 0,
    };
  }
  return panel.mode === 'text'
    ? createPortableKxTextResultV2({
      text: panel.text,
      rowLimit: settings.rowLimit,
      byteLimit: settings.byteLimit,
      label: `${connection.name} • Direct IPC • ${connection.database}`,
      elapsedMs,
      marker: 'direct-ipc',
    }, { outputId, persistenceMode })
    : createPortableKxResultV2({
      columns: panel.result.columns.slice(),
      rows: [],
      cellValue: (rowIndex, columnIndex) => panel.result.cellValue(rowIndex, columnIndex),
      rowCount: panel.result.rowCount,
      rowLimit: settings.rowLimit,
      byteLimit: settings.byteLimit,
      label: `${connection.name} • Direct IPC • ${connection.database}`,
      elapsedMs,
      marker: 'direct-ipc',
    }, { outputId, persistenceMode });
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
    functionDisplayStrategy: configuration.get<string>('functionDisplayStrategy'),
    dictionaryDisplayStrategy: configuration.get<string>('dictionaryDisplayStrategy'),
    listDisplayStrategy: configuration.get<string>('listDisplayStrategy'),
    objectDisplayStrategy: configuration.get<string>('objectDisplayStrategy'),
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
  return {
    [KX_NOTEBOOK_LIVE_METADATA_KEY]: {
      version: 1,
      id: liveId,
    },
    // The built-in ipynb serializer persists only this nested Jupyter output
    // metadata object. The session-only live identity deliberately stays
    // outside it and therefore disappears on save/reopen.
    metadata: {
      [KX_NOTEBOOK_OUTPUT_METADATA_KEY]: {
        version: 1,
        id: outputId,
      },
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

function currentNotebookMember(cell: vscode.NotebookCell): vscode.NotebookCell | undefined {
  const notebook = cell.notebook;
  if (!notebook || notebook.isClosed) {
    return undefined;
  }
  const cells = notebook.getCells();
  const exact = cells.find(candidate => candidate === cell);
  if (exact) {
    return exact;
  }
  const uri = cell.document.uri.toString();
  return cells.find(candidate => candidate.document.uri.toString() === uri);
}

function mixedCellSnapshot(cell: vscode.NotebookCell): MixedCellSnapshot {
  return {
    notebook: cell.notebook,
    cellUri: cell.document.uri.toString(),
    source: cell.document.getText(),
    languageId: cell.document.languageId,
    outputs: cell.outputs.map(output => ({
      output,
      metadata: output.metadata,
      items: output.items.map(item => ({ item, data: item.data, mime: item.mime })),
    })),
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
    cell.document.languageId === 'q' &&
    cell.document.getText() === snapshot.source;
}

function mixedCellMatchesSnapshot(
  cell: vscode.NotebookCell,
  snapshot: MixedCellSnapshot
): boolean {
  return mixedCellSourceMatchesSnapshot(cell, snapshot) &&
    mixedOutputsMatchSnapshot(cell.outputs, snapshot.outputs) &&
    executionSummaryKey(cell.executionSummary) === snapshot.executionSummary;
}

function mixedOutputsMatchSnapshot(
  outputs: readonly vscode.NotebookCellOutput[],
  snapshot: readonly MixedOutputSnapshot[]
): boolean {
  return outputs.length === snapshot.length && outputs.every((output, outputIndex) => {
    const expected = snapshot[outputIndex];
    return output === expected.output && output.metadata === expected.metadata &&
      output.items.length === expected.items.length &&
      output.items.every((item, itemIndex) => {
        const expectedItem = expected.items[itemIndex];
        return item === expectedItem.item && item.data === expectedItem.data &&
          item.mime === expectedItem.mime;
      });
  });
}

function notebookCellDataSnapshot(
  cell: vscode.NotebookCell
): vscode.NotebookCellData | undefined {
  return referencedNotebookCellDataSnapshot(cell);
}

function referencedNotebookCellDataSnapshot(
  cell: vscode.NotebookCell
): vscode.NotebookCellData | undefined {
  try {
    const data = new vscode.NotebookCellData(
      cell.kind,
      cell.document.getText(),
      cell.document.languageId
    );
    // Public NotebookCell values and outputs are immutable snapshots. Retain
    // their references so conflict compensation is limited to the affected cell.
    data.metadata = cell.metadata;
    data.outputs = cell.outputs as vscode.NotebookCellOutput[];
    data.executionSummary = cell.executionSummary
      ? {
        executionOrder: cell.executionSummary.executionOrder,
        success: cell.executionSummary.success,
        ...(cell.executionSummary.timing
          ? { timing: { ...cell.executionSummary.timing } }
          : {}),
      }
      : undefined;
    return data;
  } catch {
    return undefined;
  }
}

function acceptCommittedMixedCell(
  cell: vscode.NotebookCell | undefined,
  snapshot: MixedCellSnapshot,
  index: number,
  expectedLiveId: string | undefined,
  expectedOutputId: string | undefined,
  expectedCell: vscode.NotebookCellData,
  accept: (cell: vscode.NotebookCell) => void
): void {
  if (committedMixedCellMatches(
    cell,
    snapshot,
    index,
    expectedLiveId,
    expectedOutputId,
    expectedCell
  )) {
    accept(cell);
  }
}

async function reconcileCompetingMixedCell(
  notebook: vscode.NotebookDocument,
  index: number,
  competingCell: vscode.NotebookCellData | undefined,
  competingRemoval: boolean
): Promise<boolean> {
  if (notebook.isClosed || (!competingCell && !competingRemoval)) {
    return false;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.set(notebook.uri, [vscode.NotebookEdit.replaceCells(
    new vscode.NotebookRange(index, index + 1),
    competingCell ? [competingCell] : []
  )]);
  try {
    return await vscode.workspace.applyEdit(edit);
  } catch {
    return false;
  }
}

function notebookCellMatchesData(
  cell: vscode.NotebookCell,
  data: vscode.NotebookCellData,
  notebook: vscode.NotebookDocument,
  index: number
): boolean {
  const cellMetadata = jsonValueKey(cell.metadata);
  const dataMetadata = jsonValueKey(data.metadata);
  return cellMetadata !== undefined && dataMetadata !== undefined &&
    cell.notebook === notebook && cell.index === index &&
    cell.kind === data.kind &&
    cell.document.languageId === data.languageId &&
    cell.document.getText() === data.value &&
    cellMetadata === dataMetadata &&
    notebookOutputsEqual(cell.outputs, data.outputs || []) &&
    executionSummaryKey(cell.executionSummary) === executionSummaryKey(data.executionSummary);
}

function jsonValueKey(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function notebookOutputsEqual(
  left: readonly vscode.NotebookCellOutput[],
  right: readonly vscode.NotebookCellOutput[]
): boolean {
  return left.length === right.length && left.every((output, outputIndex) => {
    const expected = right[outputIndex];
    return !!expected && jsonValueKey(output.metadata) === jsonValueKey(expected.metadata) &&
      output.items.length === expected.items.length &&
      output.items.every((item, itemIndex) => {
        const expectedItem = expected.items[itemIndex];
        if (!expectedItem || item.mime !== expectedItem.mime ||
          item.data.byteLength !== expectedItem.data.byteLength) {
          return false;
        }
        for (let byte = 0; byte < item.data.byteLength; byte += 1) {
          if (item.data[byte] !== expectedItem.data[byte]) {
            return false;
          }
        }
        return true;
      });
  });
}

function executionSummaryKey(
  summary: vscode.NotebookCellExecutionSummary | undefined
): string {
  if (!summary) {
    return '';
  }
  const hasExecutionOrder = typeof summary.executionOrder === 'number';
  const hasSuccess = typeof summary.success === 'boolean';
  const hasTiming = !!summary.timing &&
    (typeof summary.timing.startTime === 'number' ||
      typeof summary.timing.endTime === 'number');
  // The built-in ipynb serializer exposes execution_count:null as an empty
  // execution summary object. Treat that as the same cleared state as the
  // public NotebookCellData `undefined` representation.
  if (!hasExecutionOrder && !hasSuccess && !hasTiming) {
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

function committedMixedCellMatches(
  cell: vscode.NotebookCell | undefined,
  snapshot: MixedCellSnapshot,
  index: number,
  expectedLiveId: string | undefined,
  expectedOutputId: string | undefined,
  expectedCell: vscode.NotebookCellData
): cell is vscode.NotebookCell {
  if (!cell || !notebookCellMatchesData(cell, expectedCell, snapshot.notebook, index)) {
    return false;
  }
  if (!expectedLiveId && !expectedOutputId) {
    return true;
  }
  if (!expectedLiveId || !expectedOutputId) {
    return false;
  }
  return cell.outputs.some(output => outputHasFreshBinding(
    output,
    expectedLiveId,
    expectedOutputId
  ));
}

function outputHasFreshBinding(
  output: vscode.NotebookCellOutput,
  liveId: string,
  outputId: string
): boolean {
  const live = parseNotebookLiveResultReference(
    output.metadata?.[KX_NOTEBOOK_LIVE_METADATA_KEY]
  );
  const portable = parseNotebookPortableOutputBinding(output.metadata, output.items);
  return live?.id === liveId && portable?.id === outputId;
}

function freshLiveBindings(
  cell: vscode.NotebookCell
): Array<{ liveId: string; outputId: string }> {
  const bindings: Array<{ liveId: string; outputId: string }> = [];
  for (const output of cell.outputs) {
    const live = parseNotebookLiveResultReference(
      output.metadata?.[KX_NOTEBOOK_LIVE_METADATA_KEY]
    );
    const portable = parseNotebookOutputReferenceFromMetadata(output.metadata);
    if (live && portable && outputHasFreshBinding(output, live.id, portable.id)) {
      bindings.push({ liveId: live.id, outputId: portable.id });
    }
  }
  return bindings;
}

function freshBindingOwners(
  notebook: vscode.NotebookDocument,
  liveId: string,
  outputId: string
): vscode.NotebookCell[] {
  const owners: vscode.NotebookCell[] = [];
  for (const cell of notebook.getCells()) {
    for (const output of cell.outputs) {
      const live = parseNotebookLiveResultReference(
        output.metadata?.[KX_NOTEBOOK_LIVE_METADATA_KEY]
      );
      const portable = parseNotebookOutputReferenceFromMetadata(output.metadata);
      if (live?.id === liveId && portable?.id === outputId &&
        outputHasFreshBinding(output, liveId, outputId)) {
        owners.push(cell);
      }
    }
  }
  return owners;
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
