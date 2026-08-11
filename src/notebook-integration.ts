import * as vscode from 'vscode';
import { createColumnarPanelResult } from './kx-results';
import {
  jupyterNotebookDefaultLanguageId,
  NotebookCellLanguageProvider,
  NotebookLanguageResult,
  selectedNotebookCellIndexes,
} from './notebook-cell-language';
import {
  notebookQMarkerInsertion,
  preparedNotebookQCellMetadata,
} from './notebook-cell-preparation';
import {
  KX_NOTEBOOK_MIME,
  NotebookV2CreationResult,
  PortableKxResult,
  createPortableKxPreviewFromV2Full,
  createPortableKxResultV2,
  createPortableKxTextResultV2,
  portableCellValue,
  validatePortableKxResult,
} from './notebook-contract';
import {
  KxResultsPanel,
  SharedKxResultSettings,
  sharedKxResultSettings,
  updateSharedKxResultSetting,
} from './kx-results-panel';
import {
  LiveNotebookDisplayOptions,
  LiveNotebookResultStore,
} from './notebook-live-results';
import {
  NotebookLiveChartMessage,
  NotebookLiveCopyMessage,
  NotebookLiveMessageIdentity,
  NotebookLiveResultMessage,
  NotebookLiveSearchMessage,
  NotebookLiveSliceMessage,
  NotebookOutputPersistenceMessage,
  NotebookRendererMessage,
  MAX_NOTEBOOK_LIVE_COLUMNS,
  NOTEBOOK_LIVE_RESULT_METADATA_KEY,
  notebookRendererSettingsMessage,
  parseNotebookLiveResultReference,
  parseNotebookOutputReferenceFromMetadata,
  parseNotebookPortableOutputBinding,
  parseNotebookRendererMessage,
} from './notebook-message';
import {
  NotebookSettings,
  hasNotebookQMarker,
  safeNotebookByteLimit,
  safeNotebookPreserveFullResultByDefault,
  safeNotebookPresentation,
  safeNotebookRowLimit,
} from './notebook-settings';
import {
  NotebookQTargetProfile,
  NotebookQTargetResolution,
  resolveNotebookQTarget,
  safeConnectionName,
  withNotebookQTarget,
} from './notebook-q-target';
import {
  DirectQCellRunResult,
  notebookOutputItems,
} from './notebook-controller';

export const KX_NOTEBOOK_RENDERER_ID = 'vscode-kdb.kx-notebook-renderer';
export const SET_NOTEBOOK_CELL_LANGUAGE_Q_COMMAND = 'vscode-kdb.setNotebookCellLanguageQ';
export const RESTORE_NOTEBOOK_CELL_LANGUAGE_COMMAND = 'vscode-kdb.restoreNotebookCellLanguage';
export const TAG_NOTEBOOK_CELL_AS_Q_COMMAND = 'vscode-kdb.tagNotebookCellAsQ';
export const PREPARE_NOTEBOOK_CELL_FOR_PYTHON_COMMAND =
  'vscode-kdb.prepareNotebookCellForPythonKernel';
export const RUN_Q_NOTEBOOK_CELL_COMMAND = 'vscode-kdb.runQNotebookCell';
export const SELECT_NOTEBOOK_Q_TARGET_COMMAND = 'vscode-kdb.selectNotebookQTarget';

const NOTEBOOK_Q_CELL_RESOURCES_CONTEXT = 'vscode-kdb.qNotebookCellResources';
const NOTEBOOK_Q_CELL_NEEDS_PREPARATION_CONTEXT =
  'vscode-kdb.notebookQCellNeedsKernelPreparation';
const NOTEBOOK_DEFAULT_LANGUAGE_CONTEXT = 'vscode-kdb.notebookDefaultLanguageAvailable';
const NOTEBOOK_RESULT_CONTEXT = 'vscode-kdb.notebookResultAvailable';
const NOTEBOOK_DIRECT_CONTROLLER_CONTEXT =
  'vscode-kdb.notebookDirectQControllerSelected';

interface RendererOutputBindingEpoch {
  renderGeneration: number;
  liveId?: string;
  latestPersistenceRequestId: number;
  rejectedReason?: string;
}

export interface DirectQNotebookRunner {
  readonly onDidChangeState: vscode.Event<void>;
  isSelected(notebook: Pick<vscode.NotebookDocument, 'uri'>): boolean;
  connectionProfiles(): NotebookQTargetProfile[];
  runCell(cell: vscode.NotebookCell, connectionId: string): Promise<DirectQCellRunResult>;
}

/** @deprecated Use DirectQNotebookRunner. */
export type DirectQControllerSelection = DirectQNotebookRunner;

export interface NotebookIntegrationOptions {
  directRunner?: DirectQNotebookRunner;
  /** @deprecated Use directRunner. */
  directController?: DirectQNotebookRunner;
  liveResults?: LiveNotebookResultStore;
}

export class NotebookIntegration implements vscode.Disposable {
  private readonly context: vscode.ExtensionContext;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly messaging: vscode.NotebookRendererMessaging;
  private readonly rendererOutputBindings = new WeakMap<
    vscode.NotebookEditor,
    Map<string, RendererOutputBindingEpoch>
  >();
  private readonly directRunner: DirectQNotebookRunner | undefined;
  private readonly statusBarChanged = new vscode.EventEmitter<void>();
  private readonly cellLanguageProvider = new NotebookCellLanguageProvider<vscode.TextDocument>(
    (document, languageId) => vscode.languages.setTextDocumentLanguage(document, languageId)
  );

  public constructor(
    context: vscode.ExtensionContext,
    private readonly options: NotebookIntegrationOptions = {}
  ) {
    this.context = context;
    this.directRunner = options.directRunner ?? options.directController;
    this.messaging = vscode.notebooks.createRendererMessaging(KX_NOTEBOOK_RENDERER_ID);
    this.disposables.push(
      this.messaging.onDidReceiveMessage(event => {
        void this.onRendererMessage(event).catch(error => {
          const detail = error instanceof Error ? error.message : String(error);
          void vscode.window.showErrorMessage(`KX notebook action failed: ${detail}`);
        });
      }),
      vscode.commands.registerCommand(
        'vscode-kdb.setNotebookCellLanguageQ',
        (cell?: vscode.NotebookCell) => this.setSelectedCellsToQ(cell)
      ),
      vscode.commands.registerCommand(
        'vscode-kdb.restoreNotebookCellLanguage',
        (cell?: vscode.NotebookCell) => this.restoreSelectedCellLanguages(cell)
      ),
      vscode.commands.registerCommand(
        'vscode-kdb.tagNotebookCellAsQ',
        (cell?: vscode.NotebookCell) => this.tagSelectedCells(cell)
      ),
      vscode.commands.registerCommand(
        'vscode-kdb.prepareNotebookCellForPythonKernel',
        (cell?: vscode.NotebookCell) => this.prepareSelectedQCells(cell)
      ),
      vscode.commands.registerCommand(
        'vscode-kdb.runQNotebookCell',
        (cell?: vscode.NotebookCell) => this.runQCellWithKx(cell)
      ),
      vscode.commands.registerCommand(
        'vscode-kdb.selectNotebookQTarget',
        (cell?: vscode.NotebookCell) => this.selectNotebookQTarget(cell)
      ),
      vscode.commands.registerCommand('vscode-kdb.openNotebookPreviewInResults', () =>
        this.openSelectedNotebookPreview()),
      vscode.notebooks.registerNotebookCellStatusBarItemProvider(
        'jupyter-notebook',
        {
          onDidChangeCellStatusBarItems: this.statusBarChanged.event,
          provideCellStatusBarItems: cell => this.kxRouteStatusBarItems(cell),
        }
      ),
      vscode.window.onDidChangeActiveNotebookEditor(() => this.updateContexts()),
      vscode.window.onDidChangeNotebookEditorSelection(() => this.updateContexts()),
      vscode.workspace.onDidChangeNotebookDocument(event => {
        if (event.notebook === vscode.window.activeNotebookEditor?.notebook) {
          this.updateContexts();
        }
      }),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('vscode-kdb.notebook') ||
          event.affectsConfiguration('vscode-kdb.results')) {
          void this.messaging.postMessage(this.rendererSettingsMessage());
        }
      }),
      ...(this.directRunner
        ? [this.directRunner.onDidChangeState(() => {
          this.updateContexts();
        })]
        : []),
      ...(this.options.liveResults
        ? [this.options.liveResults.onDidInvalidate(event => {
          void this.messaging.postMessage({
            type: 'liveResultInvalidated',
            liveId: event.id,
            reason: event.reason,
            message: liveInvalidationMessage(event.reason),
          });
        })]
        : []),
      this.statusBarChanged
    );
    this.updateContexts();
  }

  public dispose(): void {
    this.disposables.splice(0).forEach(disposable => disposable.dispose());
    void vscode.commands.executeCommand('setContext', NOTEBOOK_Q_CELL_RESOURCES_CONTEXT, []);
    void vscode.commands.executeCommand(
      'setContext',
      NOTEBOOK_Q_CELL_NEEDS_PREPARATION_CONTEXT,
      false
    );
    void vscode.commands.executeCommand('setContext', NOTEBOOK_DEFAULT_LANGUAGE_CONTEXT, false);
    void vscode.commands.executeCommand('setContext', NOTEBOOK_RESULT_CONTEXT, false);
    void vscode.commands.executeCommand('setContext', NOTEBOOK_DIRECT_CONTROLLER_CONTEXT, false);
  }

  private async onRendererMessage(event: { editor: vscode.NotebookEditor; message: any }): Promise<void> {
    const message = parseNotebookRendererMessage(event.message);
    if (!message) {
      return;
    }
    if (message.type === 'ready') {
      this.rendererOutputBindings.delete(event.editor);
      await this.messaging.postMessage(this.rendererSettingsMessage(), event.editor);
      return;
    }
    if (message.type === 'bindOutput') {
      this.bindRendererOutput(event.editor, message);
      return;
    }
    if (message.type === 'unbindOutput') {
      const bindings = this.rendererOutputBindings.get(event.editor);
      const current = bindings?.get(message.outputId);
      if (current && current.renderGeneration === message.renderGeneration &&
        current.liveId === message.liveId) {
        bindings?.delete(message.outputId);
      }
      return;
    }
    if (message.type === 'openPreview') {
      if (message.payload.version === 2 &&
        !this.isCurrentRendererOutput(event.editor, message)) {
        return;
      }
      const payload = message.payload.version === 2
        ? uniquelyBoundNotebookOutput(
          event.editor.notebook,
          message.outputId
        )?.payload
        : matchingLegacyNotebookOutput(event.editor.notebook, message.payload);
      if (!payload) {
        throw new Error('The requested preview is not present in the current notebook.');
      }
      this.showPreview(payload);
      return;
    }
    if (message.type === 'updateResultSetting') {
      await updateSharedKxResultSetting(message.key, message.value);
      await this.messaging.postMessage(this.rendererSettingsMessage(), event.editor);
      return;
    }

    const liveResults = this.options.liveResults;
    const notebookUri = event.editor.notebook.uri.toString();
    const resultSettings = sharedKxResultSettings();
    const displayOptions = liveNotebookDisplayOptions(resultSettings);
    if (message.type === 'setOutputPersistence') {
      if (!this.claimRendererPersistenceRequest(event.editor, message)) {
        return;
      }
      const response = await this.setOutputPersistence(
        event.editor,
        message,
        liveResults,
        displayOptions,
        () => this.isCurrentRendererPersistenceRequest(event.editor, message)
      );
      await this.messaging.postMessage(response, event.editor);
      return;
    }
    if (!this.isCurrentRendererOutput(event.editor, message)) {
      return;
    }
    const rejectedReason = this.rendererOutputBindings
      .get(event.editor)?.get(message.outputId)?.rejectedReason;
    if (rejectedReason) {
      await this.postUnavailableLiveRequest(event.editor, message, rejectedReason);
      return;
    }
    let bound: BoundNotebookOutput | undefined;
    try {
      bound = uniquelyBoundNotebookOutput(event.editor.notebook, message.outputId);
    } catch (error) {
      await this.postUnavailableLiveRequest(event.editor, message, safeHostError(error));
      return;
    }
    if (!bound || bound.liveId !== message.liveId) {
      await this.postUnavailableLiveRequest(
        event.editor,
        message,
        'The live result is no longer bound to this notebook output.'
      );
      return;
    }
    const liveResultMatchesCell = !!liveResults?.hasForOutput(
      message.liveId,
      notebookUri,
      bound.cell.document.uri.toString(),
      message.outputId
    );
    if (message.type === 'requestLiveResult') {
      await this.messaging.postMessage(
        liveResultMessage(
          liveResultMatchesCell ? liveResults : undefined,
          notebookUri,
          message,
          displayOptions
        ),
        event.editor
      );
      return;
    }
    if (!liveResultMatchesCell) {
      await this.postUnavailableLiveRequest(
        event.editor,
        message,
        'The complete live result is no longer available. Use the saved notebook output or rerun the cell.'
      );
      return;
    }
    if (message.type === 'requestLiveSlice') {
      await this.messaging.postMessage(
        liveSliceMessage(
          liveResults,
          notebookUri,
          message,
          displayOptions
        ),
        event.editor
      );
      return;
    }
    if (message.type === 'searchLiveResult') {
      await this.messaging.postMessage(
        liveSearchMessage(
          liveResults,
          notebookUri,
          message,
          displayOptions
        ),
        event.editor
      );
      return;
    }
    if (message.type === 'requestLiveChart') {
      await this.messaging.postMessage(
        liveChartMessage(
          liveResults,
          notebookUri,
          message,
          displayOptions,
          resultSettings
        ),
        event.editor
      );
      return;
    }
    if (message.type === 'copyLiveRange') {
      let response: NotebookLiveCopyMessage;
      try {
        const text = liveResults?.copyText(
          message.liveId,
          notebookUri,
          {
            startRow: message.startRow,
            endRow: message.endRow,
            startColumn: message.startColumn,
            endColumn: message.endColumn,
            columnOrdinals: message.columnOrdinals,
            format: message.format,
            includeHeaders: message.includeHeaders,
            includeRowIndex: message.includeRowIndex,
            ...(message.sortOrdinal !== undefined && message.sortDirection
              ? {
                sortOrdinal: message.sortOrdinal,
                sortDirection: message.sortDirection,
              }
              : {}),
          },
          displayOptions
        );
        if (text === undefined) {
          throw new Error('Result unavailable.');
        }
        await vscode.env.clipboard.writeText(text);
        response = {
          type: 'liveCopy',
          ...liveMessageIdentity(message),
          ok: true,
        };
      } catch (error) {
        response = {
          type: 'liveCopy',
          ...liveMessageIdentity(message),
          ok: false,
          message: safeHostError(error),
        };
      }
      await this.messaging.postMessage(response, event.editor);
      return;
    }
    if (message.type === 'openLiveResult') {
      this.openLiveResult(liveResults, notebookUri, message.liveId, displayOptions);
    }
  }

  private async postUnavailableLiveRequest(
    editor: vscode.NotebookEditor,
    message: Exclude<NotebookRendererMessage, { type: 'ready' | 'bindOutput' | 'unbindOutput' |
      'openPreview' | 'updateResultSetting' | 'setOutputPersistence' }>,
    detail: string
  ): Promise<void> {
    const notebookUri = editor.notebook.uri.toString();
    const displayOptions = liveNotebookDisplayOptions(sharedKxResultSettings());
    if (message.type === 'requestLiveResult') {
      await this.messaging.postMessage({
        ...liveResultMessage(undefined, notebookUri, message, displayOptions),
        message: boundedHostText(detail, 4_096),
      }, editor);
    } else if (message.type === 'requestLiveSlice') {
      await this.messaging.postMessage(
        unavailableLiveSliceMessage(message, detail),
        editor
      );
    } else if (message.type === 'searchLiveResult') {
      await this.messaging.postMessage(
        unavailableLiveSearchMessage(message, detail),
        editor
      );
    } else if (message.type === 'requestLiveChart') {
      await this.messaging.postMessage({
        type: 'liveChart',
        ...liveMessageIdentity(message),
        error: detail,
      }, editor);
    } else if (message.type === 'copyLiveRange') {
      await this.messaging.postMessage({
        type: 'liveCopy',
        ...liveMessageIdentity(message),
        ok: false,
        message: detail,
      }, editor);
    } else if (message.type === 'openLiveResult') {
      void vscode.window.showWarningMessage(detail);
    }
  }

  private bindRendererOutput(
    editor: vscode.NotebookEditor,
    message: Extract<NotebookRendererMessage, { type: 'bindOutput' }>
  ): void {
    let bindings = this.rendererOutputBindings.get(editor);
    if (!bindings) {
      bindings = new Map<string, RendererOutputBindingEpoch>();
      this.rendererOutputBindings.set(editor, bindings);
    }
    const current = bindings.get(message.outputId);
    if (current && current.renderGeneration >= message.renderGeneration) {
      return;
    }
    const reject = (reason: string): void => {
      bindings!.set(message.outputId, {
        renderGeneration: message.renderGeneration,
        ...(message.liveId ? { liveId: message.liveId } : {}),
        latestPersistenceRequestId: 0,
        rejectedReason: reason,
      });
    };
    let located: BoundNotebookOutput | undefined;
    try {
      located = uniquelyBoundNotebookOutput(editor.notebook, message.outputId);
    } catch (error) {
      reject(safeHostError(error));
      return;
    }
    if (!located || located.payload.version !== 2 ||
      located.liveId !== message.liveId) {
      reject('The renderer output identity is no longer uniquely bound in this notebook.');
      return;
    }
    const notebookUri = editor.notebook.uri.toString();
    if (located.liveId && this.options.liveResults?.has(located.liveId, notebookUri) &&
      !this.options.liveResults.hasForOutput(
        located.liveId,
        notebookUri,
        located.cell.document.uri.toString(),
        message.outputId
      )) {
      reject('The live result belongs to a different notebook output.');
      return;
    }
    bindings.set(message.outputId, {
      renderGeneration: message.renderGeneration,
      ...(message.liveId ? { liveId: message.liveId } : {}),
      latestPersistenceRequestId: 0,
    });
  }

  private isCurrentRendererOutput(
    editor: vscode.NotebookEditor,
    identity: { outputId: string; renderGeneration: number; liveId?: string }
  ): boolean {
    const current = this.rendererOutputBindings.get(editor)?.get(identity.outputId);
    return !!current && current.renderGeneration === identity.renderGeneration &&
      (identity.liveId === undefined || current.liveId === identity.liveId);
  }

  private claimRendererPersistenceRequest(
    editor: vscode.NotebookEditor,
    identity: Extract<NotebookRendererMessage, { type: 'setOutputPersistence' }>
  ): boolean {
    const current = this.rendererOutputBindings.get(editor)?.get(identity.outputId);
    if (!current || current.renderGeneration !== identity.renderGeneration ||
      (identity.liveId !== undefined && current.liveId !== identity.liveId) ||
      identity.requestId <= current.latestPersistenceRequestId) {
      return false;
    }
    current.latestPersistenceRequestId = identity.requestId;
    return true;
  }

  private isCurrentRendererPersistenceRequest(
    editor: vscode.NotebookEditor,
    identity: Extract<NotebookRendererMessage, { type: 'setOutputPersistence' }>
  ): boolean {
    const current = this.rendererOutputBindings.get(editor)?.get(identity.outputId);
    return !!current && current.renderGeneration === identity.renderGeneration &&
      current.latestPersistenceRequestId === identity.requestId &&
      (identity.liveId === undefined || current.liveId === identity.liveId);
  }

  private async setOutputPersistence(
    editor: vscode.NotebookEditor,
    message: Extract<NotebookRendererMessage, { type: 'setOutputPersistence' }>,
    liveResults: LiveNotebookResultStore | undefined,
    displayOptions: LiveNotebookDisplayOptions,
    isCurrentRequest: () => boolean
  ): Promise<NotebookOutputPersistenceMessage> {
    const key = `${editor.notebook.uri.toString()}\0${message.outputId}`;
    return withNotebookOutputMutation(key, () => this.setOutputPersistenceUnlocked(
      editor,
      message,
      liveResults,
      displayOptions,
      isCurrentRequest
    ));
  }

  private async setOutputPersistenceUnlocked(
    editor: vscode.NotebookEditor,
    message: Extract<NotebookRendererMessage, { type: 'setOutputPersistence' }>,
    liveResults: LiveNotebookResultStore | undefined,
    displayOptions: LiveNotebookDisplayOptions,
    isCurrentRequest: () => boolean
  ): Promise<NotebookOutputPersistenceMessage> {
    const identity = {
      outputId: message.outputId,
      renderGeneration: message.renderGeneration,
      requestId: message.requestId,
    };
    const unavailable = (detail: string): NotebookOutputPersistenceMessage => ({
      type: 'outputPersistence',
      ...identity,
      mode: 'preview',
      enabled: false,
      checked: false,
      message: detail,
    });
    if (!isCurrentRequest()) {
      return unavailable('A newer renderer request replaced this persistence action.');
    }
    let located: BoundNotebookOutput;
    try {
      const candidate = uniquelyBoundNotebookOutput(editor.notebook, message.outputId);
      if (!candidate || candidate.payload.version !== 2 ||
        candidate.payload.outputId !== message.outputId) {
        return unavailable(
          'Full-result persistence is available only for a current first-party v2 output.'
        );
      }
      located = candidate;
    } catch (error) {
      return unavailable(safeHostError(error));
    }
    const currentPersistenceState = (detail: string): NotebookOutputPersistenceMessage => {
      try {
        const current = uniquelyBoundNotebookOutput(editor.notebook, message.outputId);
        if (!current || current.payload.version !== 2 ||
          current.payload.outputId !== message.outputId) {
          return unavailable(detail);
        }
        return {
          ...persistenceStateMessage(
            identity,
            current,
            liveResults,
            editor.notebook.uri.toString()
          ),
          message: detail,
        };
      } catch (error) {
        return unavailable(`${detail} ${safeHostError(error)}`);
      }
    };

    const settings = notebookSettings();
    if (message.mode === 'preview') {
      if (located.payload.persistence?.mode !== 'full') {
        return persistenceStateMessage(
          identity,
          located,
          liveResults,
          editor.notebook.uri.toString()
        );
      }
      const preview = createPortableKxPreviewFromV2Full(
        located.payload,
        settings.rowLimit,
        settings.byteLimit
      );
      if (!preview.ok) {
        return {
          ...persistenceStateMessage(
            identity,
            located,
            liveResults,
            editor.notebook.uri.toString()
          ),
          message: preview.error,
        };
      }
      if (!isCurrentRequest()) {
        return unavailable('A newer renderer request replaced this persistence action.');
      }
      const writeResult = await replaceBoundNotebookOutput(
        editor.notebook,
        located,
        preview.value,
        settings.byteLimit,
        liveResults
      );
      return writeResult === 'applied'
        ? {
          type: 'outputPersistence',
          ...identity,
          mode: 'preview',
          enabled: boundOutputHasLiveResult(
            editor.notebook,
            message.outputId,
            liveResults
          ),
          checked: false,
        }
        : currentPersistenceState(
          writeResult === 'conflict-unresolved'
            ? 'The notebook kept changing while the preview was saved. Final output ownership could not be proven; inspect the cell before retrying.'
            : 'The notebook changed before the preview could be saved. The newer notebook state was kept.'
        );
    }

    if (located.payload.persistence?.mode === 'full') {
      return persistenceStateMessage(
        identity,
        located,
        liveResults,
        editor.notebook.uri.toString()
      );
    }
    if (!message.liveId || located.liveId !== message.liveId ||
      !liveResults?.hasForOutput(
        message.liveId,
        editor.notebook.uri.toString(),
        located.cell.document.uri.toString(),
        message.outputId
      )) {
      return unavailable(
        'The complete live result is no longer available. Rerun the q cell to preserve it.'
      );
    }
    let full: NotebookV2CreationResult;
    try {
      const view = liveResults.view(
        message.liveId,
        editor.notebook.uri.toString(),
        displayOptions
      );
      if (!view) {
        return unavailable(
          'The complete live result is no longer available. Rerun the q cell to preserve it.'
        );
      }
      const portablePanel = liveResults.portablePanel(
        message.liveId,
        editor.notebook.uri.toString(),
        displayOptions
      );
      if (!portablePanel) {
        return {
          type: 'outputPersistence',
          ...identity,
          mode: 'preview',
          enabled: true,
          checked: false,
          message: 'Full persistence failed because the q result cannot be represented exactly.',
        };
      }
      full = portableFullResultFromLiveView(
        view,
        portablePanel,
        located.payload,
        message.outputId,
        settings
      );
    } catch {
      return {
        type: 'outputPersistence',
        ...identity,
        mode: 'preview',
        enabled: true,
        checked: false,
        message: 'Full persistence failed while converting the q result exactly.',
      };
    }
    if (!full.ok) {
      return {
        type: 'outputPersistence',
        ...identity,
        mode: 'preview',
        enabled: true,
        checked: false,
        message: full.error,
      };
    }
    if (!isCurrentRequest()) {
      return unavailable('A newer renderer request replaced this persistence action.');
    }

    let fresh: BoundNotebookOutput | undefined;
    try {
      fresh = uniquelyBoundNotebookOutput(editor.notebook, message.outputId);
    } catch (error) {
      return unavailable(safeHostError(error));
    }
    if (!fresh || fresh.payload.persistence?.mode !== 'preview' ||
      fresh.liveId !== message.liveId ||
      !liveResults.hasForOutput(
        message.liveId,
        editor.notebook.uri.toString(),
        fresh.cell.document.uri.toString(),
        message.outputId
      )) {
      return unavailable(
        'The notebook changed before the full result could be saved. The newer notebook state was kept.'
      );
    }
    if (!isCurrentRequest()) {
      return unavailable('A newer renderer request replaced this persistence action.');
    }
    const writeResult = await replaceBoundNotebookOutput(
      editor.notebook,
      fresh,
      full.value,
      settings.byteLimit,
      liveResults
    );
    return writeResult === 'applied'
      ? {
        type: 'outputPersistence',
        ...identity,
        mode: 'full',
        enabled: true,
        checked: true,
      }
      : currentPersistenceState(
        writeResult === 'conflict-unresolved'
          ? 'The notebook kept changing while the full result was saved. Final output ownership could not be proven; inspect the cell before retrying.'
          : 'The notebook changed before the full result could be saved. The newer notebook state was kept.'
      );
  }

  private async runQCellWithKx(commandCell?: vscode.NotebookCell): Promise<void> {
    const editor = activeJupyterNotebookEditor('running a q cell with KX');
    if (!editor) {
      return;
    }
    const runner = this.directRunner;
    if (!runner) {
      void vscode.window.showErrorMessage(
        'Run q Cell (KX) is unavailable because the KX direct IPC runner did not start.'
      );
      return;
    }
    if (this.directControllerSelected(editor.notebook)) {
      void vscode.window.showInformationMessage(
        'KX q (Direct IPC) is selected. Use the notebook’s normal Run Cell or Ctrl+Enter action.'
      );
      return;
    }
    const cell = commandCell
      ? currentNotebookCell(editor.notebook, commandCell)
      : activeTextNotebookCell(editor) ?? selectedCell(editor);
    if (commandCell && !cell) {
      void vscode.window.showWarningMessage(
        'The q cell that opened this KX action is no longer in the active notebook. Select the current cell and retry.'
      );
      return;
    }
    if (!cell || !isQCell(cell)) {
      void vscode.window.showWarningMessage(
        'Run q Cell (KX) applies only to a q-language code cell in the active Jupyter notebook.'
      );
      return;
    }
    const resolution = resolveNotebookQTarget(
      editor.notebook.metadata,
      runner.connectionProfiles()
    );
    const target = resolution.kind === 'resolved'
      ? resolution.profile
      : await this.selectNotebookQTarget(cell, resolution);
    if (!target) {
      return;
    }
    const result = await runner.runCell(cell, target.id);
    if (result === 'busy') {
      void vscode.window.showWarningMessage(
        'This notebook cell is already running. Wait for it to finish or cancel it before retrying.'
      );
    } else if (result === 'stale') {
      void vscode.window.showWarningMessage(
        'The q cell or its output changed while KX was running. Final output ownership could not be proven; inspect the cell before retrying.'
      );
    } else if (result === 'write-failed') {
      void vscode.window.showErrorMessage(
        'Run q Cell (KX) finished, but VS Code could not apply its inline output. Retry the cell.'
      );
    } else if (result === 'unavailable') {
      void vscode.window.showErrorMessage(
        'Run q Cell (KX) is unavailable because the notebook or KX direct IPC runner closed.'
      );
    } else if (result !== 'executed') {
      void vscode.window.showWarningMessage(
        'Run q Cell (KX) applies only to a q-language code cell in a Jupyter notebook.'
      );
    }
  }

  private async selectNotebookQTarget(
    commandCell?: vscode.NotebookCell,
    knownResolution?: NotebookQTargetResolution
  ): Promise<NotebookQTargetProfile | undefined> {
    const editor = activeJupyterNotebookEditor('choosing a KX target for q cells');
    if (!editor) {
      return undefined;
    }
    if (this.directControllerSelected(editor.notebook)) {
      void vscode.window.showInformationMessage(
        'KX q (Direct IPC) is selected. Its normal Run action uses the active profile from KX Connections.'
      );
      return undefined;
    }
    const cell = commandCell
      ? currentNotebookCell(editor.notebook, commandCell)
      : activeTextNotebookCell(editor) ?? selectedCell(editor);
    if (commandCell && !cell) {
      void vscode.window.showWarningMessage(
        'The q cell that opened this KX action is no longer in the active notebook. Select the current cell and retry.'
      );
      return undefined;
    }
    if (!cell || !isQCell(cell)) {
      void vscode.window.showWarningMessage(
        'Choose q Target applies only to a q-language code cell in the active Jupyter notebook.'
      );
      return undefined;
    }
    const runner = this.directRunner;
    if (!runner) {
      void vscode.window.showErrorMessage(
        'KX target selection is unavailable because the direct IPC runner did not start.'
      );
      return undefined;
    }

    let profiles = runner.connectionProfiles();
    if (profiles.length === 0) {
      const action = await vscode.window.showWarningMessage(
        'No saved KX connections are available for this notebook.',
        'Add Connection'
      );
      if (action !== 'Add Connection') {
        return undefined;
      }
      await vscode.commands.executeCommand('vscode-kdb.addConnection');
      profiles = runner.connectionProfiles();
      if (profiles.length === 0) {
        void vscode.window.showWarningMessage(
          'No KX connection was saved. Add a valid profile, then choose the notebook q target.'
        );
        return undefined;
      }
    }

    const resolution = knownResolution ??
      resolveNotebookQTarget(editor.notebook.metadata, profiles);
    const currentId = resolution.kind === 'resolved'
      ? resolution.profile.id
      : resolution.kind === 'missing'
        ? resolution.reference.id
        : undefined;
    const missingName = resolution.kind === 'missing'
      ? resolution.reference.name
      : undefined;
    const picks = [...profiles]
      .sort((left, right) =>
        Number(right.id === currentId) - Number(left.id === currentId) ||
        Number(right.active) - Number(left.active) ||
        left.name.localeCompare(right.name))
      .map(profile => ({
        label: profile.name,
        description: [
          profile.id === currentId ? 'Notebook q target' : undefined,
          profile.active ? 'Active KX profile' : undefined,
        ].filter(Boolean).join(' · '),
        detail: profile.connected
          ? 'Connected direct q session'
          : 'Direct q session connects on first run',
        profile,
      }));
    const picked = await vscode.window.showQuickPick(picks, {
      title: 'KX: Choose Notebook q Target',
      placeHolder: missingName
        ? `Saved target "${missingName}" is unavailable; choose a replacement`
        : 'Choose the saved profile used by Run q Cell (KX)',
      ignoreFocusOut: true,
    });
    if (!picked) {
      return undefined;
    }
    const updatedMetadata = withNotebookQTarget(
      editor.notebook.metadata,
      picked.profile
    );
    const edit = new vscode.WorkspaceEdit();
    edit.set(editor.notebook.uri, [
      vscode.NotebookEdit.updateNotebookMetadata(updatedMetadata),
    ]);
    let applied = false;
    try {
      applied = await vscode.workspace.applyEdit(edit);
    } catch {
      // The actionable error below is safe for closed/read-only notebooks.
    }
    if (!applied) {
      void vscode.window.showErrorMessage(
        `Could not save "${picked.profile.name}" as this notebook’s q target. ` +
        'Make the notebook writable and try again.'
      );
      return undefined;
    }
    this.updateContexts();
    void vscode.window.showInformationMessage(
      `Notebook q target: ${picked.profile.name}. Python remains the selected notebook kernel.`
    );
    return picked.profile;
  }

  private rendererSettingsMessage() {
    return notebookRendererSettingsMessage(notebookSettings(), sharedKxResultSettings());
  }

  private async setSelectedCellsToQ(commandCell?: vscode.NotebookCell): Promise<void> {
    const editor = activeJupyterNotebookEditor('setting a notebook cell language');
    if (!editor) {
      return;
    }
    const cells = selectedCells(editor, commandCell);
    const result = await this.cellLanguageProvider.setLanguage(
      cells.map(cell => ({
        index: cell.index,
        isCode: cell.kind === vscode.NotebookCellKind.Code,
        document: cell.document,
      })),
      'q'
    );
    this.finishLanguageChange(
      'q',
      result,
      ' The selected notebook kernel was not changed; use Run q Cell (KX) for this complete cell.'
    );
  }

  private async restoreSelectedCellLanguages(commandCell?: vscode.NotebookCell): Promise<void> {
    const editor = activeJupyterNotebookEditor('restoring a notebook cell language');
    if (!editor) {
      return;
    }
    const defaultLanguage = jupyterNotebookDefaultLanguageId(editor.notebook.metadata);
    if (!defaultLanguage) {
      void vscode.window.showWarningMessage(
        'This notebook has no language_info.name or kernelspec.language metadata, so KX cannot safely choose a language to restore.'
      );
      return;
    }
    const registeredLanguages = await vscode.languages.getLanguages();
    if (!registeredLanguages.includes(defaultLanguage)) {
      void vscode.window.showWarningMessage(
        `The notebook default '${defaultLanguage}' is not a registered VS Code language, so no cells were changed.`
      );
      return;
    }
    const cells = selectedCells(editor, commandCell);
    const result = await this.cellLanguageProvider.setLanguage(
      cells.map(cell => ({
        index: cell.index,
        isCode: cell.kind === vscode.NotebookCellKind.Code,
        document: cell.document,
      })),
      defaultLanguage
    );
    this.finishLanguageChange(defaultLanguage, result);
  }

  private async tagSelectedCells(commandCell?: vscode.NotebookCell): Promise<void> {
    const editor = activeJupyterNotebookEditor('tagging a q cell');
    if (!editor) {
      return;
    }
    if (this.directControllerSelected(editor.notebook)) {
      const cells = selectedCells(editor, commandCell);
      const result = await this.cellLanguageProvider.setLanguage(
        cells.map(cell => ({
          index: cell.index,
          isCode: cell.kind === vscode.NotebookCellKind.Code,
          document: cell.document,
        })),
        'q'
      );
      this.finishLanguageChange(
        'q',
        result,
        ' KX q (Direct IPC) executes the complete cell, so %%q was not added.'
      );
      return;
    }
    const cells = selectedCells(editor, commandCell);
    const languageResult = await this.cellLanguageProvider.setLanguage(
      cells.map(cell => ({
        index: cell.index,
        isCode: cell.kind === vscode.NotebookCellKind.Code,
        document: cell.document,
      })),
      'q'
    );
    const prepared = await this.ensurePythonKernelMarkers(
      editor,
      languageResult.successes.map(success => success.index)
    );
    this.updateContexts();

    if (languageResult.codeCells === 0) {
      void vscode.window.showWarningMessage('Select at least one notebook code cell to tag as q.');
      return;
    }
    if (!prepared.applied) {
      void vscode.window.showErrorMessage(
        'VS Code set the q language where possible, but could not add the %%q marker and KX metadata.'
      );
      return;
    }
    if (prepared.cells === 0) {
      void vscode.window.showWarningMessage(
        `No cells were tagged as q; ${languageResult.failures.length} language change${languageResult.failures.length === 1 ? '' : 's'} failed.`
      );
      return;
    }
    const tagged = prepared.cells;
    const markerSummary = prepared.insertedMarkers === 0
      ? 'Existing %%q marker(s) preserved.'
      : `Added ${prepared.insertedMarkers} durable %%q marker${prepared.insertedMarkers === 1 ? '' : 's'}.`;
    const failureSummary = languageResult.failures.length === 0
      ? ''
      : ` ${languageResult.failures.length} language change${languageResult.failures.length === 1 ? '' : 's'} failed.`;
    void vscode.window.showInformationMessage(
      `Tagged ${tagged} notebook code cell${tagged === 1 ? '' : 's'} as q. ` +
      `${markerSummary} q selects highlighting; %%q is the configured Python-kernel evaluator convention. ` +
      `The active controller must support q, or restore the notebook language before Run.${failureSummary}`
    );
  }

  private async prepareSelectedQCells(commandCell?: vscode.NotebookCell): Promise<void> {
    const editor = activeJupyterNotebookEditor('preparing a q cell for the Python kernel');
    if (!editor) {
      return;
    }
    if (this.directControllerSelected(editor.notebook)) {
      void vscode.window.showInformationMessage(
        'KX q (Direct IPC) is selected, so this cell runs directly and does not need %%q. ' +
        'Prepare for Python kernel is only for the separate kx_notebook route.'
      );
      return;
    }
    const cells = selectedCells(editor, commandCell).filter(cell =>
      cell.kind === vscode.NotebookCellKind.Code && cell.document.languageId === 'q'
    );
    if (cells.length === 0) {
      void vscode.window.showWarningMessage(
        'Select at least one q-language notebook code cell to prepare for the active Python kernel.'
      );
      return;
    }
    const prepared = await this.ensurePythonKernelMarkers(editor, cells.map(cell => cell.index));
    this.updateContexts();
    if (!prepared.applied) {
      void vscode.window.showErrorMessage(
        'VS Code could not add the %%q marker and KX metadata to the selected q cell(s).'
      );
      return;
    }
    void vscode.window.showInformationMessage(
      prepared.insertedMarkers === 0
        ? `The selected q cell${prepared.cells === 1 ? '' : 's'} already had a leading %%q marker. ` +
          'Restore the notebook language before Run if the active Python controller does not support q.'
        : `Added a leading %%q marker to ${prepared.cells} q cell${prepared.cells === 1 ? '' : 's'}. ` +
          'The current Python controller does not advertise q; restore the notebook language before Run while keeping the marker.'
    );
  }

  private async ensurePythonKernelMarkers(
    editor: vscode.NotebookEditor,
    indexes: readonly number[]
  ): Promise<{ applied: boolean; cells: number; insertedMarkers: number }> {
    const settings = notebookSettings();
    const edit = new vscode.WorkspaceEdit();
    const notebookEdits: vscode.NotebookEdit[] = [];
    let cells = 0;
    let insertedMarkers = 0;
    for (const index of [...new Set(indexes)].sort((left, right) => left - right)) {
      if (index < 0 || index >= editor.notebook.cellCount) {
        continue;
      }
      const cell = editor.notebook.cellAt(index);
      if (cell.kind !== vscode.NotebookCellKind.Code || cell.document.languageId !== 'q') {
        continue;
      }
      cells += 1;
      const insertion = notebookQMarkerInsertion(cell.document.getText(), settings);
      if (insertion) {
        edit.insert(
          cell.document.uri,
          new vscode.Position(0, insertion.character),
          insertion.text
        );
        insertedMarkers += 1;
      }
      notebookEdits.push(vscode.NotebookEdit.updateCellMetadata(
        index,
        preparedNotebookQCellMetadata(cell.metadata, settings)
      ));
    }
    if (cells === 0) {
      return { applied: true, cells: 0, insertedMarkers: 0 };
    }
    edit.set(editor.notebook.uri, notebookEdits);
    return {
      applied: await vscode.workspace.applyEdit(edit),
      cells,
      insertedMarkers,
    };
  }

  private finishLanguageChange(
    languageId: string,
    result: NotebookLanguageResult<vscode.TextDocument>,
    suffix = ''
  ): void {
    this.updateContexts();
    if (result.codeCells === 0) {
      void vscode.window.showWarningMessage(
        'No notebook code cells were selected. Markdown cells were not changed.'
      );
      return;
    }
    const succeeded = result.changed + result.unchanged;
    const skipped = result.skippedNonCode > 0
      ? ` Skipped ${result.skippedNonCode} Markdown cell${result.skippedNonCode === 1 ? '' : 's'}.`
      : '';
    if (result.failures.length > 0) {
      void vscode.window.showWarningMessage(
        `Set ${succeeded} of ${result.codeCells} selected code cells to ${languageId} ` +
        `(${result.changed} changed, ${result.unchanged} already ${languageId}); ` +
        `${result.failures.length} failed.${skipped}${suffix}`
      );
      return;
    }
    void vscode.window.showInformationMessage(
      `Set ${succeeded} notebook code cell${succeeded === 1 ? '' : 's'} to ${languageId} ` +
      `(${result.changed} changed, ${result.unchanged} already ${languageId}).${skipped}${suffix}`
    );
  }

  private async openSelectedNotebookPreview(): Promise<void> {
    const editor = vscode.window.activeNotebookEditor;
    const cell = selectedCell(editor);
    const payload = cell ? firstPortableOutput(cell) : undefined;
    if (!payload) {
      if (cell && isQCell(cell) && this.directControllerSelected(cell.notebook)) {
        void vscode.window.showWarningMessage(
          'The selected q cell has no valid saved KX output. Run it with KX q (Direct IPC) selected.'
        );
      } else if (cell && isQCell(cell) && !hasNotebookQMarker(cell.document.getText())) {
        const prepare = 'Prepare this q cell for the active Python kernel';
        const choice = await vscode.window.showInformationMessage(
          'This q-language cell has highlighting but no leading %%q marker for the configured Python-kernel evaluator.',
          prepare
        );
        if (choice === prepare) {
          await this.prepareSelectedQCells(cell);
        }
      } else {
        void vscode.window.showWarningMessage(
          'The selected cell has no valid saved KX preview. Run a prepared %%q cell through kx_notebook first.'
        );
      }
      return;
    }
    this.showPreview(payload);
  }

  private showPreview(payload: PortableKxResult): void {
    if (payload.kind === 'qText') {
      KxResultsPanel.showResult(this.context, {
        mode: 'text',
        text: payload.data.text,
        query: payload.provenance.qSource ?? (payload.provenance.marker === 'direct-ipc'
          ? 'Direct IPC'
          : '%%q'),
        connectionName: payload.provenance.label ?? 'Notebook result',
        elapsedMs: payload.provenance.elapsedMs ?? 0,
        messages: payload.result.truncated
          ? [`Output truncated at the notebook limit (${payload.result.byteLimit} bytes).`]
          : [],
      });
      return;
    }
    const columns = payload.schema.columns.map(column => column.name);
    const messages: string[] = [];
    if (payload.result.truncated) {
      messages.push(
        `Showing ${payload.result.previewRowCount.toLocaleString()} of ` +
        `${payload.result.rowCount.toLocaleString()} rows saved in this notebook.`
      );
    }
    KxResultsPanel.showResult(this.context, {
      table: createColumnarPanelResult(columns, payload.data.rows.length, (rowIndex, columnIndex) =>
        portableCellValue(payload.data.rows[rowIndex][columnIndex])),
      query: payload.provenance.qSource ?? (payload.provenance.marker === 'direct-ipc'
        ? 'Direct IPC'
        : '%%q'),
      connectionName: payload.provenance.label ?? 'Notebook result',
      elapsedMs: payload.provenance.elapsedMs ?? 0,
      messages,
    }, 'replace', { autoChart: payload.chart?.visible === true });
  }

  private openLiveResult(
    liveResults: LiveNotebookResultStore | undefined,
    notebookUri: string,
    liveId: string,
    displayOptions: LiveNotebookDisplayOptions
  ): void {
    let view: ReturnType<LiveNotebookResultStore['view']>;
    try {
      view = liveResults?.view(liveId, notebookUri, displayOptions);
    } catch {
      void vscode.window.showWarningMessage(
        'Result unavailable. The saved notebook output remains in the cell.'
      );
      return;
    }
    if (!view) {
      void vscode.window.showWarningMessage(
        'Result unavailable. The saved notebook output remains in the cell.'
      );
      return;
    }
    const messages: string[] = [];
    if (view.mode === 'text') {
      KxResultsPanel.showResult(this.context, {
        mode: 'text',
        text: view.text || '',
        query: view.query,
        connectionName: view.connectionName,
        elapsedMs: view.elapsedMs,
        messages,
      });
      return;
    }
    KxResultsPanel.showResult(this.context, {
      table: view.table!,
      query: view.query,
      connectionName: view.connectionName,
      elapsedMs: view.elapsedMs,
      messages,
    });
  }

  private updateContexts(): void {
    const editor = vscode.window.activeNotebookEditor;
    const cell = selectedCell(editor);
    const qCell = !!cell && isQCell(cell);
    const directSelected = !!editor && this.directControllerSelected(editor.notebook);
    void vscode.commands.executeCommand(
      'setContext',
      NOTEBOOK_Q_CELL_RESOURCES_CONTEXT,
      qCellResources(editor)
    );
    void vscode.commands.executeCommand(
      'setContext',
      NOTEBOOK_Q_CELL_NEEDS_PREPARATION_CONTEXT,
      qCell && !directSelected && !hasNotebookQMarker(cell!.document.getText())
    );
    void vscode.commands.executeCommand(
      'setContext',
      NOTEBOOK_DEFAULT_LANGUAGE_CONTEXT,
      !!editor && isJupyterNotebook(editor.notebook) &&
        jupyterNotebookDefaultLanguageId(editor.notebook.metadata) !== undefined
    );
    void vscode.commands.executeCommand(
      'setContext',
      NOTEBOOK_RESULT_CONTEXT,
      !!cell && firstPortableOutput(cell) !== undefined
    );
    void vscode.commands.executeCommand(
      'setContext',
      NOTEBOOK_DIRECT_CONTROLLER_CONTEXT,
      directSelected
    );
    this.statusBarChanged.fire();
  }

  private kxRouteStatusBarItems(
    cell: vscode.NotebookCell
  ): vscode.NotebookCellStatusBarItem[] | undefined {
    if (!isQCell(cell) || this.directControllerSelected(cell.notebook)) {
      return undefined;
    }
    const profiles = this.directRunner?.connectionProfiles() ?? [];
    const resolution = resolveNotebookQTarget(cell.notebook.metadata, profiles);
    const profile = resolution.kind === 'resolved' ? resolution.profile : undefined;
    const route = safeConnectionName(profile?.name) || 'Select connection';
    const shortcut = notebookRunShortcutLabel();
    const runItem = new vscode.NotebookCellStatusBarItem(
      `$(play) KX: ${route} · ${shortcut}`,
      vscode.NotebookCellStatusBarAlignment.Right
    );
    runItem.command = {
      command: RUN_Q_NOTEBOOK_CELL_COMMAND,
      title: 'Run q Cell (KX)',
      arguments: [cell],
    };
    runItem.tooltip = profile
      ? `Run the complete q cell through notebook q target "${route}". ` +
        'Normal notebook Run still follows the kernel selected at the top right.'
      : profiles.length === 0
        ? 'No saved KX profiles are available. Click to add or select a connection before running this complete q cell.'
      : resolution.kind === 'missing'
        ? `Saved notebook q target "${resolution.reference.name}" is unavailable. ` +
          'Click to choose a replacement before running this complete q cell.'
        : 'Click to choose a saved KX profile, then run the complete q cell. ' +
          'Normal notebook Run still follows the kernel selected at the top right.';
    runItem.accessibilityInformation = {
      label: profile
        ? `KX connection ${route}; Run q Cell with KX; ${shortcut}`
        : `Select KX connection; Run q Cell with KX; ${shortcut}`,
    };
    runItem.priority = 101;

    const targetItem = new vscode.NotebookCellStatusBarItem(
      `$(server-process) q default: ${route}`,
      vscode.NotebookCellStatusBarAlignment.Right
    );
    targetItem.command = {
      command: SELECT_NOTEBOOK_Q_TARGET_COMMAND,
      title: 'Choose Notebook q Target (KX)',
      arguments: [cell],
    };
    targetItem.tooltip = profile
      ? `Notebook q default: "${route}"${profile.active ? ' (active KX profile)' : ''}. ` +
        'Click to choose another saved profile without changing the Python kernel.'
      : profiles.length === 0
        ? 'No saved KX profiles are available. Click to add a connection, then choose the notebook q default.'
      : resolution.kind === 'missing'
        ? `Notebook q default "${resolution.reference.name}" no longer resolves. ` +
          'Choose another saved KX profile.'
        : 'Choose the notebook-level default KX profile for q cells. ' +
          'Only its safe profile ID and display name are saved in the notebook.';
    targetItem.accessibilityInformation = {
      label: profile
        ? `Notebook q default ${route}; choose another KX profile`
        : 'Select notebook q default KX profile',
    };
    targetItem.priority = 100;
    return [runItem, targetItem];
  }

  private directControllerSelected(
    notebook: Pick<vscode.NotebookDocument, 'uri'>
  ): boolean {
    return this.directRunner?.isSelected(notebook) === true;
  }
}

export function isQCell(cell: Pick<vscode.NotebookCell, 'kind' | 'metadata' | 'document'>): boolean {
  return cell.kind === vscode.NotebookCellKind.Code && cell.document.languageId === 'q';
}

export function notebookSettings(): NotebookSettings {
  const configuration = vscode.workspace.getConfiguration('vscode-kdb.notebook');
  return {
    presentation: safeNotebookPresentation(configuration.get('presentation')),
    rowLimit: safeNotebookRowLimit(configuration.get('maxOutputRows')),
    byteLimit: safeNotebookByteLimit(configuration.get('maxOutputBytes')),
    preserveFullResultByDefault: safeNotebookPreserveFullResultByDefault(
      configuration.get('preserveFullResultByDefault')
    ),
  };
}

function selectedCell(editor: vscode.NotebookEditor | undefined): vscode.NotebookCell | undefined {
  if (!editor || editor.notebook.cellCount === 0) {
    return undefined;
  }
  const index = editor.selections[0]?.start ?? 0;
  return index >= 0 && index < editor.notebook.cellCount ? editor.notebook.cellAt(index) : undefined;
}

function activeTextNotebookCell(editor: vscode.NotebookEditor): vscode.NotebookCell | undefined {
  const document = vscode.window.activeTextEditor?.document;
  if (!document || document.uri.scheme !== 'vscode-notebook-cell') {
    return undefined;
  }
  const targetUri = document.uri.toString();
  for (let index = 0; index < editor.notebook.cellCount; index++) {
    const cell = editor.notebook.cellAt(index);
    if (cell.document.uri.toString() === targetUri) {
      return cell;
    }
  }
  return undefined;
}

function currentNotebookCell(
  notebook: vscode.NotebookDocument,
  supplied: vscode.NotebookCell
): vscode.NotebookCell | undefined {
  if (supplied.notebook !== notebook || notebook.isClosed) {
    return undefined;
  }
  const cells = notebook.getCells();
  return cells.find(cell => cell === supplied) ?? cells.find(
    cell => cell.document.uri.toString() === supplied.document.uri.toString()
  );
}

function qCellResources(editor: vscode.NotebookEditor | undefined): string[] {
  if (!editor || !isJupyterNotebook(editor.notebook)) {
    return [];
  }
  const resources: string[] = [];
  for (let index = 0; index < editor.notebook.cellCount; index++) {
    const cell = editor.notebook.cellAt(index);
    if (isQCell(cell)) {
      resources.push(cell.document.uri.toString());
    }
  }
  return resources;
}

export function notebookRunShortcutLabel(
  platform: NodeJS.Platform = process.platform
): 'Cmd+Enter' | 'Ctrl+Enter' {
  return platform === 'darwin' ? 'Cmd+Enter' : 'Ctrl+Enter';
}

function selectedCells(
  editor: vscode.NotebookEditor,
  commandCell?: vscode.NotebookCell
): vscode.NotebookCell[] {
  let indexes = selectedNotebookCellIndexes(editor.notebook.cellCount, editor.selections);
  if (commandCell?.notebook === editor.notebook && !indexes.includes(commandCell.index)) {
    indexes = [commandCell.index];
  }
  return indexes.map(index => editor.notebook.cellAt(index));
}

function activeJupyterNotebookEditor(action: string): vscode.NotebookEditor | undefined {
  const editor = vscode.window.activeNotebookEditor;
  if (!editor || !isJupyterNotebook(editor.notebook)) {
    void vscode.window.showWarningMessage(
      `Open a Jupyter .ipynb notebook before ${action}.`
    );
    return undefined;
  }
  return editor;
}

function isJupyterNotebook(notebook: Pick<vscode.NotebookDocument, 'notebookType'>): boolean {
  return notebook.notebookType === 'jupyter-notebook';
}

function firstPortableOutput(cell: vscode.NotebookCell): PortableKxResult | undefined {
  return portableOutputs(cell)[0];
}

interface BoundNotebookOutput {
  cell: vscode.NotebookCell;
  cellIndex: number;
  cellDocumentVersion: number;
  notebookVersion: number;
  output: vscode.NotebookCellOutput;
  outputIndex: number;
  payload: PortableKxResult;
  liveId?: string;
}

type BoundNotebookOutputWriteResult = 'applied' | 'stale' | 'conflict-unresolved';

const notebookOutputMutationQueues = new Map<string, Promise<void>>();

async function withNotebookOutputMutation<T>(
  key: string,
  action: () => Promise<T>
): Promise<T> {
  const previous = notebookOutputMutationQueues.get(key) || Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const queued = previous.catch(() => undefined).then(() => gate);
  notebookOutputMutationQueues.set(key, queued);
  await previous.catch(() => undefined);
  try {
    return await action();
  } finally {
    release();
    if (notebookOutputMutationQueues.get(key) === queued) {
      notebookOutputMutationQueues.delete(key);
    }
  }
}

function portableOutputs(cell: vscode.NotebookCell): PortableKxResult[] {
  const payloads: PortableKxResult[] = [];
  for (const output of cell.outputs) {
    for (const item of output.items) {
      if (item.mime !== KX_NOTEBOOK_MIME) {
        continue;
      }
      try {
        const validation = validatePortableKxResult(JSON.parse(new TextDecoder().decode(item.data)));
        if (validation.ok) {
          payloads.push(validation.value);
        }
      } catch {
        // Untrusted or incomplete notebook output is ignored.
      }
    }
  }
  return payloads;
}

function matchingLegacyNotebookOutput(
  notebook: vscode.NotebookDocument,
  requested: PortableKxResult
): PortableKxResult | undefined {
  const canonical = JSON.stringify(requested);
  for (let index = 0; index < notebook.cellCount; index++) {
    for (const payload of portableOutputs(notebook.cellAt(index))) {
      if (JSON.stringify(payload) === canonical) {
        return payload;
      }
    }
  }
  return undefined;
}

function uniquelyBoundNotebookOutput(
  notebook: vscode.NotebookDocument,
  outputId: string
): BoundNotebookOutput | undefined {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(outputId)) {
    return undefined;
  }
  const matches: BoundNotebookOutput[] = [];
  for (let cellIndex = 0; cellIndex < notebook.cellCount; cellIndex++) {
    const cell = notebook.cellAt(cellIndex);
    for (let outputIndex = 0; outputIndex < cell.outputs.length; outputIndex++) {
      const output = cell.outputs[outputIndex];
      const outer = parseNotebookOutputReferenceFromMetadata(output.metadata);
      if (outer?.id !== outputId) {
        continue;
      }
      const items = output.items.filter(item => item.mime === KX_NOTEBOOK_MIME);
      if (items.length !== 1) {
        throw new Error('The requested KX output must contain exactly one portable result item.');
      }
      let payload: PortableKxResult | undefined;
      try {
        const validation = validatePortableKxResult(
          JSON.parse(new TextDecoder().decode(items[0].data))
        );
        if (validation.ok && validation.value.version === 2) {
          payload = validation.value;
        }
      } catch {
        // Report malformed matching output as unavailable below.
      }
      if (!payload) {
        continue;
      }
      if (payload.outputId !== outputId) {
        throw new Error('The requested KX output has inconsistent inner and outer identity.');
      }
      const live = parseNotebookLiveResultReference(
        output.metadata?.[NOTEBOOK_LIVE_RESULT_METADATA_KEY]
      );
      matches.push({
        cell,
        cellIndex,
        cellDocumentVersion: cell.document.version,
        notebookVersion: notebook.version,
        output,
        outputIndex,
        payload,
        ...(live ? { liveId: live.id } : {}),
      });
    }
  }
  if (matches.length > 1) {
    throw new Error('The requested KX output identity is duplicated in this notebook.');
  }
  return matches[0];
}

function portableFullResultFromLiveView(
  view: NonNullable<ReturnType<LiveNotebookResultStore['view']>>,
  portablePanel: NonNullable<ReturnType<LiveNotebookResultStore['portablePanel']>>,
  current: PortableKxResult,
  outputId: string,
  settings: NotebookSettings
): NotebookV2CreationResult {
  const persistedQSource = current.provenance.qSource;
  if (portablePanel.mode === 'text') {
    return createPortableKxTextResultV2({
      text: portablePanel.text,
      rowLimit: settings.rowLimit,
      byteLimit: settings.byteLimit,
      label: view.connectionName,
      elapsedMs: view.elapsedMs,
      ...(persistedQSource === undefined ? {} : { qSource: persistedQSource }),
      marker: 'direct-ipc',
    }, { outputId, persistenceMode: 'full' });
  }
  return createPortableKxResultV2({
    columns: portablePanel.result.columns.slice(),
    rows: [],
    cellValue: (rowIndex, columnIndex) => portablePanel.result.cellValue(rowIndex, columnIndex),
    rowCount: portablePanel.result.rowCount,
    rowLimit: settings.rowLimit,
    byteLimit: settings.byteLimit,
    label: view.connectionName,
    elapsedMs: view.elapsedMs,
    ...(persistedQSource === undefined ? {} : { qSource: persistedQSource }),
    marker: 'direct-ipc',
    ...(current.kind === 'table' && current.chart ? { chart: current.chart } : {}),
  }, { outputId, persistenceMode: 'full' });
}

function persistenceStateMessage(
  identity: { outputId: string; renderGeneration: number; requestId: number },
  located: BoundNotebookOutput,
  liveResults: LiveNotebookResultStore | undefined,
  notebookUri: string
): NotebookOutputPersistenceMessage {
  const checked = located.payload.persistence?.mode === 'full';
  return {
    type: 'outputPersistence',
    ...identity,
    mode: checked ? 'full' : 'preview',
    enabled: checked || !!(located.liveId && liveResults?.hasForOutput(
      located.liveId,
      notebookUri,
      located.cell.document.uri.toString(),
      identity.outputId
    )),
    checked,
  };
}

function boundOutputHasLiveResult(
  notebook: vscode.NotebookDocument,
  outputId: string,
  liveResults: LiveNotebookResultStore | undefined
): boolean {
  try {
    const current = uniquelyBoundNotebookOutput(notebook, outputId);
    return !!(current?.liveId && liveResults?.hasForOutput(
      current.liveId,
      notebook.uri.toString(),
      current.cell.document.uri.toString(),
      outputId
    ));
  } catch {
    return false;
  }
}

async function replaceBoundNotebookOutput(
  notebook: vscode.NotebookDocument,
  located: BoundNotebookOutput,
  portable: PortableKxResult,
  byteLimit: number,
  liveResults: LiveNotebookResultStore | undefined
): Promise<BoundNotebookOutputWriteResult> {
  let current: BoundNotebookOutput | undefined;
  try {
    current = uniquelyBoundNotebookOutput(notebook, located.payload.outputId || '');
  } catch {
    return 'stale';
  }
  if (!current || current.cellIndex !== located.cellIndex ||
    current.outputIndex !== located.outputIndex ||
    notebook.version !== located.notebookVersion ||
    current.cell.document.version !== located.cellDocumentVersion ||
    current.output !== located.output ||
    JSON.stringify(current.payload) !== JSON.stringify(located.payload)) {
    return 'stale';
  }
  const replacementOutput = new vscode.NotebookCellOutput(
    notebookOutputItems(portable, byteLimit),
    { ...current.output.metadata }
  );
  const replacement = new vscode.NotebookCellData(
    current.cell.kind,
    current.cell.document.getText(),
    current.cell.document.languageId
  );
  replacement.metadata = { ...current.cell.metadata };
  replacement.outputs = current.cell.outputs.map((output, index) =>
    index === current!.outputIndex ? replacementOutput : output
  );
  replacement.executionSummary = current.cell.executionSummary;

  const notebookUri = notebook.uri.toString();
  const previousCellUri = current.cell.document.uri.toString();
  const currentLiveRecord = current.liveId && liveResults?.has(current.liveId, notebookUri)
    ? current.liveId
    : undefined;
  if (currentLiveRecord && !liveResults?.hasForOutput(
    currentLiveRecord,
    notebookUri,
    previousCellUri,
    located.payload.outputId || ''
  )) {
    return 'stale';
  }
  const movingLiveId = currentLiveRecord
    ? liveResults?.beginCellMove(currentLiveRecord, notebookUri, previousCellUri)
      ? currentLiveRecord
      : undefined
    : undefined;
  if (currentLiveRecord && !movingLiveId) {
    return 'stale';
  }
  let moveCompleted = false;
  let competingCell: vscode.NotebookCellData | undefined;
  let competingRemoval = false;
  let structuralConflict = false;
  let competingSnapshotUnavailable = false;
  let expectedReconciliationCell: vscode.NotebookCellData | undefined;
  let expectedReconciliationRemoval = false;
  let reconciliationActive = false;
  const expectedPortableItem = replacementOutput.items.find(item =>
    item.mime === KX_NOTEBOOK_MIME
  );

  const resolveCommittedOutput = (): BoundNotebookOutput | undefined => {
    const candidateCell = current!.cellIndex < notebook.cellCount
      ? notebook.cellAt(current!.cellIndex)
      : undefined;
    const candidateOutput = candidateCell?.outputs[current!.outputIndex];
    const candidateBinding = candidateOutput
      ? parseNotebookPortableOutputBinding(candidateOutput.metadata, candidateOutput.items)
      : undefined;
    const candidatePortableItem = candidateOutput?.items.find(item =>
      item.mime === KX_NOTEBOOK_MIME
    );
    if (!candidateCell || !candidateOutput || !candidateBinding ||
      candidateBinding.id !== portable.outputId || !expectedPortableItem ||
      !candidatePortableItem ||
      !boundNotebookCellMatchesData(
        candidateCell,
        replacement,
        notebook,
        current!.cellIndex
      ) ||
      !sameNotebookOutputBytes(candidatePortableItem.data, expectedPortableItem.data)) {
      return undefined;
    }
    const candidateLive = parseNotebookLiveResultReference(
      candidateOutput.metadata?.[NOTEBOOK_LIVE_RESULT_METADATA_KEY]
    );
    return {
      cell: candidateCell,
      cellIndex: current!.cellIndex,
      cellDocumentVersion: candidateCell.document.version,
      notebookVersion: notebook.version,
      output: candidateOutput,
      outputIndex: current!.outputIndex,
      payload: portable,
      ...(candidateLive ? { liveId: candidateLive.id } : {}),
    };
  };

  const resolveUniquelyCommittedOutput = (): BoundNotebookOutput | undefined => {
    const local = resolveCommittedOutput();
    if (!local) {
      return undefined;
    }
    try {
      const unique = uniquelyBoundNotebookOutput(notebook, portable.outputId || '');
      return unique && unique.cell === local.cell && unique.output === local.output
        ? local
        : undefined;
    } catch {
      return undefined;
    }
  };

  let resolveChanged: (() => void) | undefined;
  const changed = new Promise<void>(resolve => { resolveChanged = resolve; });
  const subscription = vscode.workspace.onDidChangeNotebookDocument(event => {
    if (event.notebook !== notebook) {
      return;
    }
    const observe = (candidate: vscode.NotebookCell | undefined): boolean => {
      const committed = resolveCommittedOutput();
      if (committed && candidate === committed.cell) {
        resolveChanged?.();
        return true;
      }
      return false;
    };
    const captureStaleIndex = (): void => {
      structuralConflict = true;
      const candidate = current!.cellIndex < notebook.cellCount
        ? notebook.cellAt(current!.cellIndex)
        : undefined;
      const captured = candidate
        ? boundNotebookCellDataSnapshot(candidate) ??
          referencedBoundNotebookCellDataSnapshot(candidate)
        : undefined;
      competingCell = captured;
      competingRemoval = !candidate;
      if (candidate && !captured) {
        competingSnapshotUnavailable = true;
      }
    };
    for (const change of event.cellChanges) {
      if (change.cell.index === current!.cellIndex ||
        change.cell.document.uri.toString() === previousCellUri) {
        const expectedReconciliation = !!expectedReconciliationCell &&
          boundNotebookCellMatchesData(
            change.cell,
            expectedReconciliationCell,
            notebook,
            current!.cellIndex
          );
        const ownCommit = !reconciliationActive && !expectedReconciliation && observe(change.cell);
        if (!expectedReconciliation && !ownCommit &&
          (change.cell.index === current!.cellIndex || !structuralConflict)) {
          const captured = boundNotebookCellDataSnapshot(change.cell) ??
            referencedBoundNotebookCellDataSnapshot(change.cell);
          competingCell = captured;
          competingRemoval = false;
          if (!captured) {
            competingSnapshotUnavailable = true;
          }
        }
      }
    }
    for (const change of event.contentChanges) {
      const removedTarget = change.removedCells.some(cell =>
        cell.document.uri.toString() === previousCellUri
      );
      const relativeIndex = current!.cellIndex - change.range.start;
      const affectsStaleIndex = change.range.start <= current!.cellIndex &&
        (change.range.end > current!.cellIndex ||
          change.addedCells.length !== change.removedCells.length);
      const shiftsOrReplacesTarget = affectsStaleIndex ||
        (!structuralConflict && removedTarget);
      if (!shiftsOrReplacesTarget &&
        (relativeIndex < 0 || relativeIndex >= change.addedCells.length)) {
        continue;
      }
      const candidate = relativeIndex >= 0 && relativeIndex < change.addedCells.length
        ? change.addedCells[relativeIndex]
        : undefined;
      const currentAtTarget = current!.cellIndex < notebook.cellCount
        ? notebook.cellAt(current!.cellIndex)
        : undefined;
      const expectedReconciliation = expectedReconciliationRemoval
        ? !currentAtTarget
        : !!expectedReconciliationCell && !!currentAtTarget && boundNotebookCellMatchesData(
          currentAtTarget,
          expectedReconciliationCell,
          notebook,
          current!.cellIndex
        );
      const ownCommit = !reconciliationActive && !expectedReconciliation &&
        observe(currentAtTarget ?? candidate);
      if (!expectedReconciliation && !ownCommit && shiftsOrReplacesTarget) {
        // Preserve the cell currently at the stale index. This is the only
        // notebook state our index-based edit can overwrite after an
        // insertion/deletion shifts the originally bound output.
        captureStaleIndex();
      }
    }
  });
  try {
    const edit = new vscode.WorkspaceEdit();
    edit.set(notebook.uri, [
      vscode.NotebookEdit.replaceCells(
        new vscode.NotebookRange(current.cellIndex, current.cellIndex + 1),
        [replacement]
      ),
    ]);
    let applied = false;
    try {
      applied = await vscode.workspace.applyEdit(edit);
    } catch {
      return 'stale';
    }
    if (!applied || notebook.isClosed) {
      return 'stale';
    }
    let committed = resolveCommittedOutput();
    if (!committed) {
      await waitForNotebookChange(changed);
      committed = resolveCommittedOutput();
    }
    if (!committed) {
      return 'stale';
    }
    if (competingSnapshotUnavailable) {
      return 'conflict-unresolved';
    }
    if (competingCell || competingRemoval) {
      const desiredCell = competingCell;
      const desiredRemoval = competingRemoval;
      expectedReconciliationCell = desiredCell;
      expectedReconciliationRemoval = desiredRemoval;
      reconciliationActive = true;
      const restored = await reconcileBoundNotebookCell(
        notebook,
        current.cellIndex,
        desiredCell,
        desiredRemoval
      );
      expectedReconciliationCell = undefined;
      expectedReconciliationRemoval = false;
      reconciliationActive = false;
      const conflictUnresolved = !restored;
      if (conflictUnresolved && movingLiveId) {
        liveResults?.cancelCellMove(
          movingLiveId,
          notebookUri,
          previousCellUri,
          true
        );
      }
      return conflictUnresolved ? 'conflict-unresolved' : 'stale';
    }
    committed = resolveUniquelyCommittedOutput();
    if (!committed) {
      if (movingLiveId) {
        liveResults?.cancelCellMove(
          movingLiveId,
          notebookUri,
          previousCellUri,
          true
        );
      }
      return 'conflict-unresolved';
    }
    if (movingLiveId) {
      moveCompleted = !!liveResults?.completeCellMove(
        movingLiveId,
        notebookUri,
        previousCellUri,
        committed.cell.document.uri.toString()
      );
      if (!moveCompleted) {
        liveResults?.cancelCellMove(
          movingLiveId,
          notebookUri,
          previousCellUri,
          true
        );
        return 'conflict-unresolved';
      }
      // Complete only after the edit has been re-resolved, then prove that the
      // same exact binding still owns the current notebook state.
      const final = resolveUniquelyCommittedOutput();
      if (!final || final.output !== committed.output ||
        final.cell.document.uri.toString() !== committed.cell.document.uri.toString()) {
        liveResults?.remove(movingLiveId, notebookUri);
        return 'conflict-unresolved';
      }
    }
    return 'applied';
  } finally {
    subscription.dispose();
    if (movingLiveId && !moveCompleted) {
      const owners = boundNotebookBindingOwners(
        notebook,
        movingLiveId,
        current!.payload.outputId || ''
      );
      if (owners.length === 1 &&
        owners[0].document.uri.toString() !== previousCellUri) {
        moveCompleted = !!liveResults?.completeCellMove(
          movingLiveId,
          notebookUri,
          previousCellUri,
          owners[0].document.uri.toString()
        );
        if (!moveCompleted) {
          liveResults?.cancelCellMove(
            movingLiveId,
            notebookUri,
            previousCellUri,
            true
          );
        }
      } else {
        liveResults?.cancelCellMove(
          movingLiveId,
          notebookUri,
          previousCellUri,
          owners.length !== 1
        );
      }
    }
  }
}

function sameNotebookOutputBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function boundNotebookCellDataSnapshot(
  cell: vscode.NotebookCell
): vscode.NotebookCellData | undefined {
  return referencedBoundNotebookCellDataSnapshot(cell);
}

function referencedBoundNotebookCellDataSnapshot(
  cell: vscode.NotebookCell
): vscode.NotebookCellData | undefined {
  try {
    const data = new vscode.NotebookCellData(
      cell.kind,
      cell.document.getText(),
      cell.document.languageId
    );
    // Retain the immutable public-API snapshot for the one affected cell.
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

function boundNotebookBindingOwners(
  notebook: vscode.NotebookDocument,
  liveId: string,
  outputId: string
): vscode.NotebookCell[] {
  const owners: vscode.NotebookCell[] = [];
  for (const cell of notebook.getCells()) {
    for (const output of cell.outputs) {
      const live = parseNotebookLiveResultReference(
        output.metadata?.[NOTEBOOK_LIVE_RESULT_METADATA_KEY]
      );
      const outer = parseNotebookOutputReferenceFromMetadata(output.metadata);
      if (live?.id !== liveId || outer?.id !== outputId) {
        continue;
      }
      const portable = parseNotebookPortableOutputBinding(output.metadata, output.items);
      if (portable?.id === outputId) {
        owners.push(cell);
      }
    }
  }
  return owners;
}

function boundNotebookCellMatchesData(
  cell: vscode.NotebookCell,
  data: vscode.NotebookCellData,
  notebook: vscode.NotebookDocument,
  index: number
): boolean {
  const cellMetadata = integrationJsonKey(cell.metadata);
  const expectedMetadata = integrationJsonKey(data.metadata);
  const cellSummary = integrationJsonKey(cell.executionSummary);
  const expectedSummary = integrationJsonKey(data.executionSummary);
  if (cellMetadata === undefined || expectedMetadata === undefined ||
    cellSummary === undefined || expectedSummary === undefined ||
    cell.notebook !== notebook || cell.index !== index ||
    cell.kind !== data.kind || cell.document.languageId !== data.languageId ||
    cell.document.getText() !== data.value ||
    cellMetadata !== expectedMetadata || cellSummary !== expectedSummary) {
    return false;
  }
  const expectedOutputs = data.outputs || [];
  if (cell.outputs.length !== expectedOutputs.length) {
    return false;
  }
  return cell.outputs.every((output, outputIndex) => {
    const expected = expectedOutputs[outputIndex];
    const outputMetadata = integrationJsonKey(output.metadata);
    const expectedOutputMetadata = integrationJsonKey(expected.metadata);
    return outputMetadata !== undefined && expectedOutputMetadata !== undefined &&
      outputMetadata === expectedOutputMetadata &&
      output.items.length === expected.items.length &&
      output.items.every((item, itemIndex) => {
        const expectedItem = expected.items[itemIndex];
        return item.mime === expectedItem.mime &&
          sameNotebookOutputBytes(item.data, expectedItem.data);
      });
  });
}

function integrationJsonKey(value: unknown): string | undefined {
  try {
    return value === undefined ? 'undefined' : JSON.stringify(value);
  } catch {
    return undefined;
  }
}

async function reconcileBoundNotebookCell(
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
    // The mutation reports failure; never spin or overwrite another later edit.
    return false;
  }
}

async function waitForNotebookChange(event: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      event,
      new Promise<void>(resolve => { timer = setTimeout(resolve, 250); }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export function liveNotebookDisplayOptions(
  settings: SharedKxResultSettings
): LiveNotebookDisplayOptions {
  return {
    arrayDisplayFormat: settings.arrayDisplayFormat,
    functionDisplayStrategy: settings.functionDisplayStrategy,
    dictionaryDisplayStrategy: settings.dictionaryDisplayStrategy,
    listDisplayStrategy: settings.listDisplayStrategy,
    objectDisplayStrategy: settings.objectDisplayStrategy,
  };
}

export function liveResultMessage(
  liveResults: LiveNotebookResultStore | undefined,
  notebookUri: string,
  identity: NotebookLiveMessageIdentity,
  displayOptions: LiveNotebookDisplayOptions
): NotebookLiveResultMessage {
  const { liveId } = identity;
  let view: ReturnType<LiveNotebookResultStore['view']>;
  try {
    view = liveResults?.view(liveId, notebookUri, displayOptions);
  } catch {
    return {
      type: 'liveResult',
      ...liveMessageIdentity(identity),
      available: false,
      message: 'Result unavailable.',
    };
  }
  if (!view) {
    return {
      type: 'liveResult',
      ...liveMessageIdentity(identity),
      available: false,
      message: 'Result unavailable.',
    };
  }
  const rawColumns = view.columns.slice(0, MAX_NOTEBOOK_LIVE_COLUMNS);
  const columns = safeLiveColumnNames(rawColumns);
  const chartXNames = new Set(view.chartXColumns);
  const chartYNames = new Set(view.chartYColumns);
  const chartGroupNames = new Set(view.chartGroupColumns);
  const chartXColumns = columns.filter((_column, index) => chartXNames.has(rawColumns[index]));
  const chartYColumns = columns.filter((_column, index) => chartYNames.has(rawColumns[index]));
  const chartGroupColumns = columns.filter((_column, index) => chartGroupNames.has(rawColumns[index]));
  const messages: string[] = [];
  if (columns.length < view.columns.length) {
    messages.push(
      `Showing ${columns.length} of ${view.columns.length} columns. Open KX Results for all columns.`
    );
  }
  if (columns.some((column, index) => column !== rawColumns[index])) {
    messages.push(
      'Some column labels were shortened or normalized. Open KX Results for exact labels.'
    );
  }
  return {
    type: 'liveResult',
    ...liveMessageIdentity(identity),
    available: true,
    mode: view.mode,
    kind: boundedHostText(view.kind, 128),
    columns,
    rowCount: view.rowCount,
    chartXColumns,
    chartYColumns,
    chartGroupColumns,
    ...(view.mode === 'text'
      ? { text: boundedHostText(view.text || '', 1_048_576) }
      : {}),
    metadata: {
      connectionName: boundedHostText(view.connectionName, 512),
      elapsedMs: view.elapsedMs,
      messages,
    },
  };
}

export function liveSliceMessage(
  liveResults: LiveNotebookResultStore | undefined,
  notebookUri: string,
  message: Extract<NotebookRendererMessage, { type: 'requestLiveSlice' }>,
  displayOptions: LiveNotebookDisplayOptions
): NotebookLiveSliceMessage {
  try {
    const slice = liveResults?.slice(
      message.liveId,
      notebookUri,
      {
        startRow: message.startRow,
        endRow: message.endRow,
        startColumn: message.startColumn,
        endColumn: message.endColumn,
        columnOrdinals: message.columnOrdinals,
        ...(message.sortOrdinal !== undefined && message.sortDirection
          ? {
            sortOrdinal: message.sortOrdinal,
            sortDirection: message.sortDirection,
          }
          : {}),
      },
      displayOptions
    );
    if (!slice) {
      return unavailableLiveSlice(message);
    }
    return {
      type: 'liveSlice',
      ...liveMessageIdentity(message),
      ...slice,
    };
  } catch (error) {
    return unavailableLiveSlice(message, safeHostError(error));
  }
}

function unavailableLiveSlice(
  identity: NotebookLiveMessageIdentity,
  detail = 'Result unavailable.'
): NotebookLiveSliceMessage {
  return {
    type: 'liveSlice',
    ...liveMessageIdentity(identity),
    startRow: 0,
    endRow: -1,
    startColumn: 0,
    endColumn: -1,
    columnOrdinals: [],
    cells: [],
    error: detail,
  };
}

function unavailableLiveSliceMessage(
  identity: NotebookLiveMessageIdentity,
  detail: string
): NotebookLiveSliceMessage {
  return unavailableLiveSlice(identity, detail);
}

export function liveSearchMessage(
  liveResults: LiveNotebookResultStore | undefined,
  notebookUri: string,
  message: Extract<NotebookRendererMessage, { type: 'searchLiveResult' }>,
  displayOptions: LiveNotebookDisplayOptions
): NotebookLiveSearchMessage {
  try {
    const result = liveResults?.search(
      message.liveId,
      notebookUri,
      message.query,
      displayOptions,
      message.sortOrdinal !== undefined && message.sortDirection
        ? {
          sortOrdinal: message.sortOrdinal,
          sortDirection: message.sortDirection,
        }
        : undefined
    );
    if (!result) {
      return unavailableLiveSearch(message);
    }
    return {
      type: 'liveSearch',
      ...liveMessageIdentity(message),
      ...result,
    };
  } catch (error) {
    return unavailableLiveSearch(message, safeHostError(error));
  }
}

function unavailableLiveSearch(
  identity: NotebookLiveMessageIdentity,
  detail = 'Result unavailable.'
): NotebookLiveSearchMessage {
  return {
    type: 'liveSearch',
    ...liveMessageIdentity(identity),
    matches: [],
    totalScanned: 0,
    scannedCells: 0,
    capped: false,
    partial: false,
    error: detail,
  };
}

function unavailableLiveSearchMessage(
  identity: NotebookLiveMessageIdentity,
  detail: string
): NotebookLiveSearchMessage {
  return unavailableLiveSearch(identity, detail);
}

export function liveChartMessage(
  liveResults: LiveNotebookResultStore | undefined,
  notebookUri: string,
  message: Extract<NotebookRendererMessage, { type: 'requestLiveChart' }>,
  displayOptions: LiveNotebookDisplayOptions,
  resultSettings: SharedKxResultSettings
): NotebookLiveChartMessage {
  try {
    const columnMap = liveSourceColumnMap(
      liveResults,
      notebookUri,
      message.liveId,
      displayOptions
    );
    const sourceXColumn = columnMap.get(message.xColumn);
    const sourceYColumns = message.yColumns.map(column => columnMap.get(column));
    const sourceGroupByColumn = message.groupByColumn
      ? columnMap.get(message.groupByColumn)
      : undefined;
    const sourceOpenColumn = message.openColumn
      ? columnMap.get(message.openColumn)
      : undefined;
    const sourceHighColumn = message.highColumn
      ? columnMap.get(message.highColumn)
      : undefined;
    const sourceLowColumn = message.lowColumn
      ? columnMap.get(message.lowColumn)
      : undefined;
    const sourceCloseColumn = message.closeColumn
      ? columnMap.get(message.closeColumn)
      : undefined;
    if (!sourceXColumn || sourceYColumns.some(column => !column) ||
      (message.groupByColumn && !sourceGroupByColumn) ||
      (message.openColumn && !sourceOpenColumn) ||
      (message.highColumn && !sourceHighColumn) ||
      (message.lowColumn && !sourceLowColumn) ||
      (message.closeColumn && !sourceCloseColumn)) {
      throw new Error('Chart columns unavailable.');
    }
    const displayBySource = new Map<string, string>();
    for (const [display, source] of columnMap) {
      displayBySource.set(source, display);
    }
    const chart = liveResults?.chart(
      message.liveId,
      notebookUri,
      {
        requestId: message.requestId,
        chartType: message.chartType,
        xColumn: sourceXColumn,
        yColumns: sourceYColumns as string[],
        groupByColumn: sourceGroupByColumn,
        openColumn: sourceOpenColumn,
        highColumn: sourceHighColumn,
        lowColumn: sourceLowColumn,
        closeColumn: sourceCloseColumn,
        maxPoints: message.maxPoints,
        maxSourceRows: resultSettings.chartMaxSourceRows,
        ...(message.xMin !== undefined && message.xMax !== undefined
          ? { xMin: message.xMin, xMax: message.xMax }
          : {}),
      },
      displayOptions
    );
    if (!chart) {
      return {
        type: 'liveChart',
        ...liveMessageIdentity(message),
        error: 'Result unavailable.',
      };
    }
    return {
      type: 'liveChart',
      ...liveMessageIdentity(message),
      data: {
        chartType: message.chartType,
        xColumn: displayBySource.get(chart.xColumn) || message.xColumn,
        ...(chart.groupByColumn
          ? {
            groupByColumn: displayBySource.get(chart.groupByColumn) ||
              safeLiveChartLabel(chart.groupByColumn),
          }
          : {}),
        xKind: chart.xKind,
        x: chart.x,
        xText: chart.xText,
        xDomain: chart.xDomain,
        series: chart.series.map(series => ({
          columnName: displayBySource.get(series.columnName) ||
            safeLiveChartLabel(series.columnName),
          ...(series.sourceColumnName
            ? {
              sourceColumnName: displayBySource.get(series.sourceColumnName) ||
                safeLiveChartLabel(series.sourceColumnName),
            }
            : {}),
          ...(series.groupValue
            ? { groupValue: boundedHostText(series.groupValue, 512).replace(/[\r\n]/g, ' ') }
            : {}),
          values: series.values,
          ...(series.gapFlags ? { gapFlags: series.gapFlags } : {}),
        })),
        ...(chart.boxSeries
          ? {
            boxSeries: chart.boxSeries.map(series => ({
              columnName: displayBySource.get(series.columnName) ||
                safeLiveChartLabel(series.columnName),
              stats: series.stats,
            })),
          }
          : {}),
        ...(chart.ohlcColumns
          ? {
            ohlcColumns: {
              open: displayBySource.get(chart.ohlcColumns.open) ||
                safeLiveChartLabel(chart.ohlcColumns.open),
              high: displayBySource.get(chart.ohlcColumns.high) ||
                safeLiveChartLabel(chart.ohlcColumns.high),
              low: displayBySource.get(chart.ohlcColumns.low) ||
                safeLiveChartLabel(chart.ohlcColumns.low),
              close: displayBySource.get(chart.ohlcColumns.close) ||
                safeLiveChartLabel(chart.ohlcColumns.close),
            },
          }
          : {}),
        ...(chart.candlesticks
          ? {
            candlesticks: chart.candlesticks.map(candle => ({
              ...candle,
              xText: boundedHostText(candle.xText, 512),
            })),
          }
          : {}),
        sourceRowCount: chart.sourceRowCount,
        eligibleRowCount: chart.eligibleRowCount,
        sampledPointCount: chart.sampledPointCount,
        algorithm: boundedHostText(chart.algorithm, 256),
        warnings: chart.warnings.slice(0, 32).map(value => boundedHostText(value, 1_024)),
      },
    };
  } catch (error) {
    return {
      type: 'liveChart',
      ...liveMessageIdentity(message),
      error: safeHostError(error),
    };
  }
}

function safeLiveChartLabel(value: string): string {
  return boundedHostText(value, 256).replace(/[\r\n]/g, ' ') || 'series';
}

function boundedHostText(value: string, maxChars: number): string {
  return String(value || '').slice(0, maxChars).replace(/\0/g, '');
}

export function safeLiveColumnNames(values: readonly string[]): string[] {
  const used = new Set<string>();
  return values.map((value, index) => {
    const base = boundedHostText(value, 256).replace(/[\r\n]/g, '') ||
      `column${index + 1}`;
    let name = base;
    let suffix = 2;
    while (used.has(name)) {
      const ending = `_${suffix++}`;
      name = `${base.slice(0, 256 - ending.length)}${ending}`;
    }
    used.add(name);
    return name;
  });
}

function liveSourceColumnMap(
  liveResults: LiveNotebookResultStore | undefined,
  notebookUri: string,
  liveId: string,
  displayOptions: LiveNotebookDisplayOptions
): Map<string, string> {
  const rawColumns = liveResults?.tableColumns(liveId, notebookUri, displayOptions)
    ?.slice(0, MAX_NOTEBOOK_LIVE_COLUMNS) || [];
  const displayColumns = safeLiveColumnNames(rawColumns);
  return new Map(displayColumns.map((display, index) => [display, rawColumns[index]]));
}

function liveMessageIdentity(identity: NotebookLiveMessageIdentity): NotebookLiveMessageIdentity {
  return {
    outputId: identity.outputId,
    liveId: identity.liveId,
    renderGeneration: identity.renderGeneration,
    requestId: identity.requestId,
  };
}

function safeHostError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return boundedHostText(message || 'Live KX notebook operation failed.', 4_096);
}

function liveInvalidationMessage(reason: string): string {
  switch (reason) {
    case 'evicted':
      return 'The complete live result was evicted from the bounded session cache. The saved notebook output remains available.';
    case 'duplicate-output':
      return 'The live result identity appeared more than once, so the session binding was invalidated for safety.';
    case 'notebook-closed':
      return 'The notebook was closed, so its session-only complete result was released.';
    case 'replaced':
      return 'A newer result replaced this session-only complete result.';
    case 'output-unbound':
      return 'The notebook output changed or moved without this live binding. The saved output remains available.';
    default:
      return 'The session-only complete result is no longer available. The saved notebook output remains available.';
  }
}
