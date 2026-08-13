import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { KX_COLUMN_AUTO_TEXT_CHAR_LIMIT } from './column-sizing';
import {
  CellRange,
  ColumnarPanelResult,
  ExportFormat,
  TextExportFormat,
  createColumnarPanelResult,
} from './kx-results';
import {
  chartPngBytesFromDataUrl,
  columnarToXlsx,
  estimateCopyExport,
  kxResultExportFileExtension,
  kxResultExportSaveFilters,
  largeCopyExportConfirmationMessage,
} from './kx-results-export';
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
  PortableKxResult,
  PortableKxTableResult,
  isPortableKxFullResult,
  notebookSavedPreviewNotice,
  portableCellValue,
  validatePortableKxResult,
} from './notebook-contract';
import {
  KxResultsPanel,
  SharedKxResultSettings,
  resetPositionalKxResultColumnWidths,
  sharedKxResultSettings,
  updatePositionalKxResultColumnWidth,
  updateSharedKxResultSetting,
} from './kx-results-panel';
import {
  LiveNotebookDisplayOptions,
  LiveNotebookResultStore,
  MAX_LIVE_NOTEBOOK_COPY_TEXT_CHARS,
} from './notebook-live-results';
import {
  NOTEBOOK_LIVE_RESULT_METADATA_KEY,
  NotebookActionResultMessage,
  NotebookLiveChartMessage,
  NotebookLiveColumnTextLengthsMessage,
  NotebookLiveCopyMessage,
  NotebookLiveResultMessage,
  NotebookLiveSearchMessage,
  NotebookLiveSliceMessage,
  NotebookRendererMessage,
  MAX_NOTEBOOK_LIVE_COLUMNS,
  notebookRendererSettingsMessage,
  parseNotebookLiveResultReference,
  parseNotebookOutputBindingFromMetadata,
  parseNotebookRendererMessage,
} from './notebook-message';
import {
  normalizeLargeSortWarningRowThreshold,
  shouldWarnForLargeSort,
} from './result-sort-warning';
import {
  NotebookSettings,
  hasNotebookQMarker,
  notebookQSourceFromMagic,
  safeNotebookByteLimit,
  safeNotebookPresentation,
  safeNotebookRowLimit,
} from './notebook-settings';
import {
  NotebookQTargetProfile,
  safeConnectionName,
} from './notebook-q-target';
import type {
  DirectQCellRunOptions,
  DirectQCellRunResult,
} from './notebook-controller';

export const KX_NOTEBOOK_RENDERER_ID = 'vscode-kdb.kx-notebook-renderer';
export const SET_NOTEBOOK_CELL_LANGUAGE_Q_COMMAND = 'vscode-kdb.setNotebookCellLanguageQ';
export const RESTORE_NOTEBOOK_CELL_LANGUAGE_COMMAND = 'vscode-kdb.restoreNotebookCellLanguage';
export const TAG_NOTEBOOK_CELL_AS_Q_COMMAND = 'vscode-kdb.tagNotebookCellAsQ';
export const PREPARE_NOTEBOOK_CELL_FOR_PYTHON_COMMAND =
  'vscode-kdb.prepareNotebookCellForPythonKernel';
export const RUN_Q_NOTEBOOK_CELL_COMMAND = 'vscode-kdb.runQNotebookCell';
export const RUN_Q_NOTEBOOK_CELL_AND_SELECT_BELOW_COMMAND =
  'vscode-kdb.runQNotebookCellAndSelectBelow';
export const RUN_Q_NOTEBOOK_CELL_AND_INSERT_BELOW_COMMAND =
  'vscode-kdb.runQNotebookCellAndInsertBelow';
export const SELECT_NOTEBOOK_Q_TARGET_COMMAND = 'vscode-kdb.selectNotebookQTarget';
export const RUN_NOTEBOOK_PREVIEW_LIVE_COMMAND =
  'vscode-kdb.runNotebookPreviewLive';

const NOTEBOOK_Q_CELL_RESOURCES_CONTEXT = 'vscode-kdb.qNotebookCellResources';
const NOTEBOOK_Q_CELL_NEEDS_PREPARATION_CONTEXT =
  'vscode-kdb.notebookQCellNeedsKernelPreparation';
const NOTEBOOK_DEFAULT_LANGUAGE_CONTEXT = 'vscode-kdb.notebookDefaultLanguageAvailable';
const NOTEBOOK_RESULT_CONTEXT = 'vscode-kdb.notebookResultAvailable';
const NOTEBOOK_DIRECT_CONTROLLER_CONTEXT =
  'vscode-kdb.notebookDirectQControllerSelected';
const MAX_NOTEBOOK_SCAN_CELLS = 10_000;
const MAX_NOTEBOOK_OUTPUT_ITEMS_PER_CELL = 2_000;
const MAX_NOTEBOOK_SCAN_OUTPUTS = 2_000;

export interface DirectQNotebookRunner {
  readonly onDidChangeState: vscode.Event<void>;
  isSelected(notebook: Pick<vscode.NotebookDocument, 'uri'>): boolean;
  connectionProfiles(): NotebookQTargetProfile[];
  runCell(
    cell: vscode.NotebookCell,
    connectionId: string,
    options?: DirectQCellRunOptions
  ): Promise<DirectQCellRunResult>;
}

/** @deprecated Use DirectQNotebookRunner. */
export type DirectQControllerSelection = DirectQNotebookRunner;

export interface NotebookIntegrationOptions {
  directRunner?: DirectQNotebookRunner;
  /** @deprecated Use directRunner. */
  directController?: DirectQNotebookRunner;
  liveResults?: LiveNotebookResultStore;
}

type LiveScopedRendererMessage = Extract<
  NotebookRendererMessage,
  { liveId: string; outputId: string; requestId: number }
>;

type NotebookQCellRunOutcome = DirectQCellRunResult | 'canceled' | 'controller-selected';

export class NotebookIntegration implements vscode.Disposable {
  private readonly context: vscode.ExtensionContext;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly messaging: vscode.NotebookRendererMessaging;
  private readonly directRunner: DirectQNotebookRunner | undefined;
  private readonly statusBarChanged = new vscode.EventEmitter<void>();
  private readonly pendingLiveSortConfirmations = new Map<string, Promise<boolean>>();
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
        'vscode-kdb.runQNotebookCellAndSelectBelow',
        (cell?: vscode.NotebookCell) => this.runQCellWithKxAndThen(cell, 'select-below')
      ),
      vscode.commands.registerCommand(
        'vscode-kdb.runQNotebookCellAndInsertBelow',
        (cell?: vscode.NotebookCell) => this.runQCellWithKxAndThen(cell, 'insert-below')
      ),
      vscode.commands.registerCommand(
        'vscode-kdb.selectNotebookQTarget',
        (cell?: vscode.NotebookCell) => this.selectNotebookQTarget(cell)
      ),
      vscode.commands.registerCommand(
        'vscode-kdb.runNotebookPreviewLive',
        (cell?: vscode.NotebookCell) => this.runNotebookPreviewLive(cell)
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
          if (event.affectsConfiguration('vscode-kdb.results.viewer.autoFitColumns') ||
            event.affectsConfiguration('vscode-kdb.results.viewer.autoFitMode') ||
            event.affectsConfiguration('vscode-kdb.results.viewer.arrayDisplayFormat') ||
            event.affectsConfiguration('vscode-kdb.results.viewer.functionDisplayStrategy') ||
            event.affectsConfiguration('vscode-kdb.results.viewer.dictionaryDisplayStrategy') ||
            event.affectsConfiguration('vscode-kdb.results.viewer.listDisplayStrategy') ||
            event.affectsConfiguration('vscode-kdb.results.viewer.objectDisplayStrategy')) {
            this.options.liveResults?.cancelColumnTextLengthScans();
          }
          void this.messaging.postMessage(this.rendererSettingsMessage());
        }
      }),
      ...(this.directRunner
        ? [this.directRunner.onDidChangeState(() => {
          this.updateContexts();
        })]
        : []),
      this.statusBarChanged
    );
    this.updateContexts();
  }

  public dispose(): void {
    this.pendingLiveSortConfirmations.clear();
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
      await this.messaging.postMessage(this.rendererSettingsMessage(), event.editor);
      return;
    }
    if (message.type === 'openPreview') {
      const response = await notebookActionResult(message.requestId, 'openPreview', async () => {
        const payload = matchingNotebookOutput(
          event.editor.notebook,
          message.outputId,
          message.payload
        );
        if (!payload) {
          throw new Error('The requested saved result is not present in the current notebook.');
        }
        this.showPreview(payload);
        return 'Opened saved result in KX Results.';
      });
      await this.messaging.postMessage(response, event.editor);
      return;
    }
    if (message.type === 'updateResultSetting') {
      await updateSharedKxResultSetting(message.key, message.value);
      await this.messaging.postMessage(this.rendererSettingsMessage(), event.editor);
      return;
    }
    if (message.type === 'setResultColumnWidth') {
      await updatePositionalKxResultColumnWidth(message.position, message.width);
      await this.messaging.postMessage(this.rendererSettingsMessage(), event.editor);
      return;
    }
    if (message.type === 'resetResultColumnWidths') {
      await resetPositionalKxResultColumnWidths();
      await this.messaging.postMessage(this.rendererSettingsMessage(), event.editor);
      return;
    }

    const liveResults = this.options.liveResults;
    const notebookUri = event.editor.notebook.uri.toString();
    const resultSettings = sharedKxResultSettings();
    const displayOptions = liveNotebookDisplayOptions(resultSettings);
    let authorizedCellUri: string | undefined;
    if (isLiveScopedRendererMessage(message)) {
      const binding = matchingLiveNotebookOutput(
        event.editor.notebook,
        message.outputId,
        message.liveId
      );
      const cellUri = binding?.cell.document.uri.toString();
      const available = !!binding && !!cellUri && (
        liveResults?.hasForOutput(
          message.liveId,
          notebookUri,
          cellUri,
          message.outputId
        ) ||
        liveResults?.bindStagedOutput(
          message.liveId,
          notebookUri,
          cellUri,
          message.outputId
        )
      );
      if (!available || !cellUri) {
        await this.rejectUnavailableLiveMessage(message, event.editor);
        return;
      }
      authorizedCellUri = cellUri;
    }
    if (message.type === 'requestLiveResult') {
      const result = liveResultMessage(
        liveResults,
        notebookUri,
        message.liveId,
        message.requestId,
        displayOptions,
        authorizedCellUri
      );
      await this.messaging.postMessage(
        result,
        event.editor
      );
      if (result.available &&
        result.mode === 'table' &&
        resultSettings.autoFitColumns &&
        resultSettings.autoFitMode === 'wholeResult') {
        const sizing = await liveColumnTextLengthsMessage(
          liveResults,
          notebookUri,
          message.liveId,
          message.requestId,
          displayOptions,
          authorizedCellUri
        );
        if (sizing) {
          await this.messaging.postMessage(sizing, event.editor);
        }
      }
      return;
    }
    if (message.type === 'requestLiveColumnTextLengths') {
      if (!resultSettings.autoFitColumns ||
        resultSettings.autoFitMode !== 'wholeResult') {
        return;
      }
      const sizing = await liveColumnTextLengthsMessage(
        liveResults,
        notebookUri,
        message.liveId,
        message.requestId,
        displayOptions,
        authorizedCellUri
      );
      if (sizing) {
        await this.messaging.postMessage(sizing, event.editor);
      }
      return;
    }
    if (message.type === 'requestLiveSlice') {
      if (!(await this.confirmLiveSortIfNeeded(
        liveResults,
        notebookUri,
        message,
        displayOptions,
        authorizedCellUri
      ))) {
        await this.messaging.postMessage({
          type: 'liveSlice',
          liveId: message.liveId,
          requestId: message.requestId,
          startRow: 0,
          endRow: -1,
          startColumn: 0,
          endColumn: -1,
          columnOrdinals: [],
          cells: [],
          error: 'Large sort canceled.',
        }, event.editor);
        return;
      }
      await this.messaging.postMessage(
        liveSliceMessage(
          liveResults,
          notebookUri,
          message,
          displayOptions,
          authorizedCellUri
        ),
        event.editor
      );
      return;
    }
    if (message.type === 'searchLiveResult') {
      if (!(await this.confirmLiveSortIfNeeded(
        liveResults,
        notebookUri,
        message,
        displayOptions,
        authorizedCellUri
      ))) {
        await this.messaging.postMessage({
          type: 'liveSearch',
          liveId: message.liveId,
          requestId: message.requestId,
          matches: [],
          totalScanned: 0,
          scannedCells: 0,
          capped: false,
          partial: false,
          error: 'Large sort canceled.',
        }, event.editor);
        return;
      }
      await this.messaging.postMessage(
        liveSearchMessage(
          liveResults,
          notebookUri,
          message,
          displayOptions,
          authorizedCellUri
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
          resultSettings,
          authorizedCellUri
        ),
        event.editor
      );
      return;
    }
    if (message.type === 'copyLiveRange') {
      let response: NotebookLiveCopyMessage;
      try {
        if (!(await this.confirmLiveSortIfNeeded(
          liveResults,
          notebookUri,
          message,
          displayOptions,
          authorizedCellUri
        ))) {
          response = {
            type: 'liveCopy',
            liveId: message.liveId,
            requestId: message.requestId,
            ok: false,
            message: 'Large sort canceled.',
          };
          await this.messaging.postMessage(response, event.editor);
          return;
        }
        const rangeRequest = {
          startRow: message.startRow,
          endRow: message.endRow,
          startColumn: message.startColumn,
          endColumn: message.endColumn,
          ...(message.columnIndexes ? { columnIndexes: message.columnIndexes } : {}),
          ...liveSortRequest(
            liveResults,
            notebookUri,
            message,
            displayOptions,
            authorizedCellUri
          ),
        };
        const selected = liveResults?.resultRange(
          message.liveId,
          notebookUri,
          rangeRequest,
          displayOptions,
          authorizedCellUri
        );
        if (!selected) {
          throw new Error('Result unavailable.');
        }
        if (!(await confirmNotebookCopyExport(
          'copy',
          selected.table,
          selected.range,
          message.format,
          message.includeHeaders,
          message.includeRowIndex,
          resultSettings
        ))) {
          response = {
            type: 'liveCopy',
            liveId: message.liveId,
            requestId: message.requestId,
            ok: false,
            message: 'Copy canceled.',
          };
          await this.messaging.postMessage(response, event.editor);
          return;
        }
        const text = liveResults?.copyText(
          message.liveId,
          notebookUri,
          {
            ...rangeRequest,
            format: message.format,
            includeHeaders: message.includeHeaders,
            includeRowIndex: message.includeRowIndex,
          },
          displayOptions,
          authorizedCellUri
        );
        if (text === undefined) {
          throw new Error('Result unavailable.');
        }
        await vscode.env.clipboard.writeText(text);
        response = {
          type: 'liveCopy',
          liveId: message.liveId,
          requestId: message.requestId,
          ok: true,
        };
      } catch (error) {
        response = {
          type: 'liveCopy',
          liveId: message.liveId,
          requestId: message.requestId,
          ok: false,
          message: safeHostError(error),
        };
      }
      await this.messaging.postMessage(response, event.editor);
      return;
    }
    if (message.type === 'exportLiveRange') {
      const response = await notebookActionResult(message.requestId, 'export', async () => {
        if (!(await this.confirmLiveSortIfNeeded(
          liveResults,
          notebookUri,
          message,
          displayOptions,
          authorizedCellUri
        ))) {
          return { canceled: true, message: 'Large sort canceled.' };
        }
        const selected = liveResults?.resultRange(
          message.liveId,
          notebookUri,
          {
            startRow: message.startRow,
            endRow: message.endRow,
            startColumn: message.startColumn,
            endColumn: message.endColumn,
            ...(message.columnIndexes ? { columnIndexes: message.columnIndexes } : {}),
            ...liveSortRequest(
              liveResults,
              notebookUri,
              message,
              displayOptions,
              authorizedCellUri
            ),
          },
          displayOptions,
          authorizedCellUri
        );
        if (!selected) {
          throw new Error('Result unavailable.');
        }
        return saveNotebookTableExport(
          selected.table,
          selected.range,
          message.format,
          message.includeHeaders,
          message.includeRowIndex,
          resultSettings
        );
      });
      await this.messaging.postMessage(response, event.editor);
      return;
    }
    if (message.type === 'exportPreviewRange') {
      const response = await notebookActionResult(message.requestId, 'export', async () => {
        const payload = matchingNotebookOutput(
          event.editor.notebook,
          message.outputId,
          message.payload
        );
        if (!payload || payload.kind !== 'table') {
          throw new Error('The requested saved result is not present in the current notebook.');
        }
        const selected = portablePreviewRange(payload, {
          startRow: message.startRow,
          endRow: message.endRow,
          startColumn: message.startColumn,
          endColumn: message.endColumn,
          columnIndexes: message.columnIndexes,
          rowIndexes: message.rowIndexes,
        });
        return saveNotebookTableExport(
          selected.table,
          selected.range,
          message.format,
          message.includeHeaders,
          message.includeRowIndex,
          resultSettings
        );
      });
      await this.messaging.postMessage(response, event.editor);
      return;
    }
    if (message.type === 'copyPreviewRange') {
      const response = await notebookActionResult(message.requestId, 'copy', async () => {
        const payload = matchingNotebookOutput(
          event.editor.notebook,
          message.outputId,
          message.payload
        );
        if (!payload || payload.kind !== 'table') {
          throw new Error('The requested saved result is not present in the current notebook.');
        }
        const selected = portablePreviewRange(payload, {
          startRow: message.startRow,
          endRow: message.endRow,
          startColumn: message.startColumn,
          endColumn: message.endColumn,
          columnIndexes: message.columnIndexes,
          rowIndexes: message.rowIndexes,
        });
        return copyNotebookTableRange(
          selected.table,
          selected.range,
          message.format,
          message.includeHeaders,
          message.includeRowIndex,
          resultSettings
        );
      });
      await this.messaging.postMessage(response, event.editor);
      return;
    }
    if (message.type === 'copyLiveText') {
      const response = await notebookActionResult(message.requestId, 'copy', async () => {
        const text = liveResults?.fullText(
          message.liveId,
          notebookUri,
          displayOptions,
          authorizedCellUri
        );
        if (text === undefined) {
          throw new Error('Result unavailable.');
        }
        await vscode.env.clipboard.writeText(text);
        return 'Copied.';
      });
      await this.messaging.postMessage(response, event.editor);
      return;
    }
    if (message.type === 'exportLiveText') {
      const response = await notebookActionResult(message.requestId, 'exportText', async () => {
        const text = liveResults?.fullText(
          message.liveId,
          notebookUri,
          displayOptions,
          authorizedCellUri
        );
        if (text === undefined) {
          throw new Error('Result unavailable.');
        }
        return saveNotebookTextExport(text);
      });
      await this.messaging.postMessage(response, event.editor);
      return;
    }
    if (message.type === 'exportPreviewText') {
      const response = await notebookActionResult(message.requestId, 'exportText', async () => {
        const payload = matchingNotebookOutput(
          event.editor.notebook,
          message.outputId,
          message.payload
        );
        if (!payload || payload.kind !== 'qText') {
          throw new Error('The requested saved result is not present in the current notebook.');
        }
        return saveNotebookTextExport(payload.data.text);
      });
      await this.messaging.postMessage(response, event.editor);
      return;
    }
    if (message.type === 'exportChartPng') {
      const response = await notebookActionResult(message.requestId, 'exportChartPng', () => {
        const payload = matchingNotebookOutput(
          event.editor.notebook,
          message.outputId,
          message.payload
        );
        if (!payload || payload.kind !== 'table') {
          throw new Error('The requested chart output is not present in the current notebook.');
        }
        return saveNotebookChartPng(message.dataUrl);
      });
      await this.messaging.postMessage(response, event.editor);
      return;
    }
    if (message.type === 'rerunPreview') {
      const response = await notebookActionResult(message.requestId, 'rerun', async () => {
        const match = matchingNotebookCellOutput(
          event.editor.notebook,
          message.outputId,
          message.payload
        );
        if (!match) {
          throw new Error('The requested saved result is not present in the current notebook.');
        }
        if (match.payload.provenance.marker === 'direct-ipc') {
          if (this.directControllerSelected(event.editor.notebook)) {
            await vscode.commands.executeCommand(
              'notebook.cell.execute',
              { start: match.cell.index, end: match.cell.index + 1 },
              event.editor.notebook.uri
            );
            return 'Rerun requested through the selected KX q controller.';
          }
          const outcome = await this.runQCellWithKx(match.cell, event.editor);
          return notebookRerunOutcome(outcome);
        }
        const outcome = await this.runNotebookPreviewLive(
          match.cell,
          event.editor
        );
        return notebookLiveRerunOutcome(outcome);
      });
      await this.messaging.postMessage(response, event.editor);
      return;
    }
    if (message.type === 'openLiveResult') {
      if (!this.openLiveResult(
        liveResults,
        notebookUri,
        message.liveId,
        displayOptions,
        authorizedCellUri
      )) {
        await this.rejectUnavailableLiveMessage(message, event.editor);
      }
    }
  }

  private async confirmLiveSortIfNeeded(
    liveResults: LiveNotebookResultStore | undefined,
    notebookUri: string,
    message: {
      liveId: string;
      sortOrdinal?: number;
      sortColumn?: string;
      sortDirection?: 'asc' | 'desc';
    },
    displayOptions: LiveNotebookDisplayOptions,
    cellUri?: string
  ): Promise<boolean> {
    if (!message.sortDirection) {
      return true;
    }
    const state = liveResults?.sortWarningState(
      message.liveId,
      notebookUri,
      displayOptions,
      cellUri
    );
    if (!state) {
      return false;
    }
    const config = vscode.workspace.getConfiguration('vscode-kdb.results');
    if (!shouldWarnForLargeSort(state.rowCount, {
      rowThreshold: normalizeLargeSortWarningRowThreshold(
        config.get<number>('largeSortWarningRowThreshold')
      ),
      hideWarnings: config.get<boolean>('hideLargeSortWarnings') === true,
      approved: state.approved,
    })) {
      return true;
    }

    const key = `${message.liveId}\0${state.generation}`;
    const pending = this.pendingLiveSortConfirmations.get(key);
    if (pending) {
      return pending;
    }
    const confirmation = this.confirmLiveSort(
      liveResults!,
      notebookUri,
      message,
      displayOptions,
      state.generation,
      state.rowCount,
      cellUri
    );
    this.pendingLiveSortConfirmations.set(key, confirmation);
    try {
      return await confirmation;
    } finally {
      if (this.pendingLiveSortConfirmations.get(key) === confirmation) {
        this.pendingLiveSortConfirmations.delete(key);
      }
    }
  }

  private async confirmLiveSort(
    liveResults: LiveNotebookResultStore,
    notebookUri: string,
    message: {
      liveId: string;
      sortOrdinal?: number;
      sortColumn?: string;
      sortDirection?: 'asc' | 'desc';
    },
    displayOptions: LiveNotebookDisplayOptions,
    generation: number,
    rowCount: number,
    cellUri?: string
  ): Promise<boolean> {
    const columns = liveResults.tableColumns(
      message.liveId,
      notebookUri,
      displayOptions,
      cellUri
    ) || [];
    const column = Number.isSafeInteger(message.sortOrdinal) && message.sortOrdinal! >= 0
      ? columns[message.sortOrdinal!]
      : message.sortColumn;
    const choice = await vscode.window.showWarningMessage(
      `Sort ${rowCount.toLocaleString('en-US')} rows` +
        `${column ? ` by ${column}` : ''}? This may take a moment.`,
      'Sort',
      "Sort and Don't Warn Again",
      'Cancel'
    );
    const current = liveResults.sortWarningState(
      message.liveId,
      notebookUri,
      displayOptions,
      cellUri
    );
    if (!current || current.generation !== generation ||
      (choice !== 'Sort' && choice !== "Sort and Don't Warn Again")) {
      return false;
    }
    if (choice === "Sort and Don't Warn Again") {
      await vscode.workspace.getConfiguration('vscode-kdb.results').update(
        'hideLargeSortWarnings',
        true,
        vscode.ConfigurationTarget.Global
      );
      const afterUpdate = liveResults.sortWarningState(
        message.liveId,
        notebookUri,
        displayOptions,
        cellUri
      );
      if (!afterUpdate || afterUpdate.generation !== generation) {
        return false;
      }
    }
    return liveResults.approveSortWarning(
      message.liveId,
      notebookUri,
      generation,
      cellUri
    );
  }

  private async rejectUnavailableLiveMessage(
    message: LiveScopedRendererMessage,
    editor: vscode.NotebookEditor
  ): Promise<void> {
    const detail = 'Live result unavailable. Use the saved notebook output or rerun the cell.';
    if (message.type === 'copyLiveRange') {
      await this.messaging.postMessage({
        type: 'liveCopy',
        liveId: message.liveId,
        requestId: message.requestId,
        ok: false,
        message: detail,
      }, editor);
    } else if (message.type === 'copyLiveText' ||
      message.type === 'exportLiveRange' || message.type === 'exportLiveText') {
      await this.messaging.postMessage({
        type: 'actionResult',
        requestId: message.requestId,
        action: message.type === 'copyLiveText'
          ? 'copy'
          : message.type === 'exportLiveRange'
            ? 'export'
            : 'exportText',
        ok: false,
        canceled: false,
        message: detail,
      }, editor);
    }
    await this.messaging.postMessage(
      unavailableLiveResultMessage(message.liveId, message.requestId, detail),
      editor
    );
  }

  private async runQCellWithKx(
    commandCell?: vscode.NotebookCell,
    commandEditor?: vscode.NotebookEditor
  ): Promise<NotebookQCellRunOutcome> {
    const editor = commandEditor ?? activeJupyterNotebookEditor('running a q cell with KX');
    if (!editor) {
      return 'unsupported-notebook';
    }
    const runner = this.directRunner;
    if (!runner) {
      void vscode.window.showErrorMessage(
        'Run q Cell (KX) is unavailable because the KX direct IPC runner did not start.'
      );
      return 'unavailable';
    }
    if (this.directControllerSelected(editor.notebook)) {
      void vscode.window.showInformationMessage(
        'KX q (Direct IPC) is selected. Use the notebook’s normal Run Cell or Ctrl+Enter action.'
      );
      return 'controller-selected';
    }
    const cell = commandCell?.notebook === editor.notebook
      ? commandCell
      : activeTextNotebookCell(editor) ?? selectedCell(editor);
    if (!cell || !isQCell(cell)) {
      void vscode.window.showWarningMessage(
        'Run q Cell (KX) applies only to a q-language code cell in the active Jupyter notebook.'
      );
      return 'not-q';
    }
    const target = activeNotebookQProfile(runner.connectionProfiles()) ??
      await this.selectNotebookQTarget(cell, editor);
    if (!target) {
      return 'canceled';
    }
    const result = await runner.runCell(cell, target.id);
    if (result === 'busy') {
      void vscode.window.showWarningMessage(
        'This notebook cell is already running. Wait for it to finish or cancel it before retrying.'
      );
    } else if (result === 'stale') {
      void vscode.window.showWarningMessage(
        'The q cell or its output changed while KX was running, so Run q Cell (KX) did not overwrite it.'
      );
    } else if (result === 'write-failed') {
      void vscode.window.showErrorMessage(
        'Run q Cell (KX) finished, but VS Code could not apply its inline output. Retry the cell.'
      );
    } else if (result === 'unavailable') {
      void vscode.window.showErrorMessage(
        'Run q Cell (KX) is unavailable because the notebook or KX direct IPC runner closed.'
      );
    } else if (result === 'not-q' || result === 'unsupported-notebook') {
      void vscode.window.showWarningMessage(
        'Run q Cell (KX) applies only to a q-language code cell in a Jupyter notebook.'
      );
    }
    return result;
  }

  private async runNotebookPreviewLive(
    commandCell?: vscode.NotebookCell,
    commandEditor?: vscode.NotebookEditor
  ): Promise<NotebookQCellRunOutcome> {
    const editor = commandEditor ??
      activeJupyterNotebookEditor('running a saved %%q preview live with KX');
    if (!editor) {
      return 'unsupported-notebook';
    }
    if (this.directControllerSelected(editor.notebook)) {
      void vscode.window.showInformationMessage(
        'Select the Python/Jupyter controller before using Run %%q Live with KX. The action does not switch notebook kernels.'
      );
      return 'controller-selected';
    }
    const cell = commandCell?.notebook === editor.notebook
      ? commandCell
      : activeTextNotebookCell(editor) ?? selectedCell(editor);
    const sourceCellSnapshot = cell
      ? {
          source: cell.document.getText(),
          languageId: cell.document.languageId,
        }
      : undefined;
    const source = sourceCellSnapshot
      ? notebookQSourceFromMagic(sourceCellSnapshot.source)
      : undefined;
    if (!cell || source === undefined) {
      void vscode.window.showWarningMessage(
        'Run %%q Live with KX applies only to a code cell whose first line is %%q.'
      );
      return 'not-q';
    }
    if (!source.trim()) {
      void vscode.window.showWarningMessage(
        'Run %%q Live with KX requires q source below the %%q line.'
      );
      return 'not-q';
    }
    const runner = this.directRunner;
    if (!runner) {
      void vscode.window.showErrorMessage(
        'Run %%q Live with KX is unavailable because the KX direct IPC runner did not start.'
      );
      return 'unavailable';
    }
    const target = activeNotebookQProfile(runner.connectionProfiles()) ??
      await this.selectNotebookQTarget(cell, editor, true);
    if (!target) {
      return 'canceled';
    }
    const confirmation = await vscode.window.showWarningMessage(
      `Run this %%q body again as a new KX Direct IPC execution on active connection "${target.name}"? ` +
      'This does not reuse the Python kx_notebook evaluator or its session, and the selected notebook kernel will not change.',
      { modal: true },
      'Run via Direct IPC'
    );
    if (confirmation !== 'Run via Direct IPC') {
      return 'canceled';
    }
    const result = await runner.runCell(cell, target.id, {
      source,
      sourceCellSnapshot: sourceCellSnapshot!,
      runLabel: 'Run %%q Live with KX (new Direct IPC execution)',
    });
    if (result === 'executed') {
      void vscode.window.showInformationMessage(
        `New KX Direct IPC execution finished on active connection "${target.name}". ` +
        'A successful result is live while its extension-host record exists; the selected notebook kernel was not changed.'
      );
    }
    return result;
  }

  private async runQCellWithKxAndThen(
    commandCell: vscode.NotebookCell | undefined,
    action: 'select-below' | 'insert-below'
  ): Promise<NotebookQCellRunOutcome> {
    const editor = activeJupyterNotebookEditor('running a q cell with KX');
    if (!editor) {
      return 'unsupported-notebook';
    }
    const cell = commandCell?.notebook === editor.notebook
      ? commandCell
      : activeTextNotebookCell(editor) ?? selectedCell(editor);
    const cellIndex = cell?.index ?? -1;
    const result = await this.runQCellWithKx(cell, editor);
    if (result !== 'executed' ||
      vscode.window.activeNotebookEditor !== editor ||
      cellIndex < 0 ||
      editor.selections[0]?.start !== cellIndex) {
      return result;
    }
    await vscode.commands.executeCommand(
      action === 'select-below'
        ? 'notebook.focusNextEditor'
        : 'notebook.cell.insertCodeCellBelow'
    );
    return result;
  }

  private async selectNotebookQTarget(
    commandCell?: vscode.NotebookCell,
    commandEditor?: vscode.NotebookEditor,
    allowMagicCell = false
  ): Promise<NotebookQTargetProfile | undefined> {
    const editor = commandEditor ??
      activeJupyterNotebookEditor('activating a KX connection for q cells');
    if (!editor) {
      return undefined;
    }
    if (this.directControllerSelected(editor.notebook)) {
      void vscode.window.showInformationMessage(
        'KX q (Direct IPC) is selected. Its normal Run action already uses the active profile from KX Connections.'
      );
      return undefined;
    }
    const cell = commandCell?.notebook === editor.notebook
      ? commandCell
      : activeTextNotebookCell(editor) ?? selectedCell(editor);
    if (!cell || (!isQCell(cell) &&
      !(allowMagicCell && notebookQSourceFromMagic(cell.document.getText()) !== undefined))) {
      void vscode.window.showWarningMessage(
        'Activate q Connection applies only to a q-language code cell in the active Jupyter notebook.'
      );
      return undefined;
    }
    const runner = this.directRunner;
    if (!runner) {
      void vscode.window.showErrorMessage(
        'KX connection activation is unavailable because the direct IPC runner did not start.'
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
          'No KX connection was saved. Add a valid profile, then activate it for q execution.'
        );
        return undefined;
      }
    }

    const picks = [...profiles]
      .sort((left, right) =>
        Number(right.active) - Number(left.active) ||
        left.name.localeCompare(right.name))
      .map(profile => ({
        label: profile.name,
        description: [
          profile.active ? 'Active KX connection' : undefined,
        ].filter(Boolean).join(' · ') || undefined,
        detail: profile.connected
          ? 'Transport open'
          : 'Transport opens during activation or first run',
        profile,
      }));
    const picked = await vscode.window.showQuickPick(picks, {
      title: 'KX: Activate q Connection',
      placeHolder: 'Activate the profile used by editor, notebook, explorer, and preview routes',
      ignoreFocusOut: true,
    });
    if (!picked) {
      return undefined;
    }
    const activated = await vscode.commands.executeCommand<unknown>(
      'vscode-kdb.connect',
      picked.profile.id
    );
    profiles = runner.connectionProfiles();
    const active = activeNotebookQProfile(profiles);
    if (!active || active.id !== picked.profile.id) {
      if (!activated) {
        void vscode.window.showWarningMessage(
          `KX connection "${picked.profile.name}" was not activated.`
        );
      }
      return undefined;
    }
    this.updateContexts();
    void vscode.window.showInformationMessage(
      `Active KX connection: ${active.name}. Python remains the selected notebook kernel.`
    );
    return active;
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
          'The selected cell has no valid saved KX result. Run a prepared %%q cell through kx_notebook first.'
        );
      }
      return;
    }
    this.showPreview(payload);
  }

  private showPreview(payload: PortableKxResult): void {
    const complete = isPortableKxFullResult(payload);
    if (payload.kind === 'qText') {
      KxResultsPanel.showResult(this.context, {
        mode: 'text',
        text: payload.data.text,
        query: payload.provenance.qSource ?? (payload.provenance.marker === 'direct-ipc'
          ? 'Direct IPC'
          : '%%q'),
        connectionName: payload.provenance.label ?? 'Notebook result',
        elapsedMs: payload.provenance.elapsedMs ?? 0,
        messages: complete ? [] : [notebookSavedPreviewNotice(payload)],
      });
      return;
    }
    const columns = payload.schema.columns.map(column => column.name);
    const messages: string[] = [];
    if (!complete) {
      messages.push(notebookSavedPreviewNotice(payload));
    }
    KxResultsPanel.showResult(this.context, {
      table: createColumnarPanelResult(
        columns,
        payload.data.rows.length,
        (rowIndex, columnIndex) =>
          portableCellValue(payload.data.rows[rowIndex][columnIndex]),
        payload.schema.columns.map(column => column.type),
        payload.schema.keyColumnOrdinals
      ),
      query: payload.provenance.qSource ?? (payload.provenance.marker === 'direct-ipc'
        ? 'Direct IPC'
        : '%%q'),
      connectionName: payload.provenance.label ?? 'Notebook result',
      elapsedMs: payload.provenance.elapsedMs ?? 0,
      messages,
      snapshotScope: complete
        ? {
          kind: 'complete',
          savedRowCount: payload.data.rows.length,
          totalRowCount: payload.result.rowCount,
        }
        : {
          kind: 'truncatedSavedPreview',
          savedRowCount: payload.data.rows.length,
          totalRowCount: payload.result.rowCount,
        },
    }, 'replace', { autoChart: payload.chart?.visible === true });
  }

  private openLiveResult(
    liveResults: LiveNotebookResultStore | undefined,
    notebookUri: string,
    liveId: string,
    displayOptions: LiveNotebookDisplayOptions,
    cellUri?: string
  ): boolean {
    let view: ReturnType<LiveNotebookResultStore['view']>;
    try {
      view = liveResults?.view(liveId, notebookUri, displayOptions, cellUri);
    } catch {
      return false;
    }
    if (!view) {
      return false;
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
      return true;
    }
    KxResultsPanel.showResult(this.context, {
      table: view.table!,
      query: view.query,
      connectionName: view.connectionName,
      elapsedMs: view.elapsedMs,
      messages,
    });
    return true;
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
    const profile = activeNotebookQProfile(profiles);
    const route = safeConnectionName(profile?.name) || 'Activate connection';
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
      ? `Run the complete q cell through active KX connection "${route}". ` +
        'Normal notebook Run still follows the kernel selected at the top right.'
      : profiles.length === 0
        ? 'No saved KX profiles are available. Click to add or activate a connection before running this complete q cell.'
      : 'Click to activate a KX profile, then run the complete q cell. ' +
          'Normal notebook Run still follows the kernel selected at the top right.';
    runItem.accessibilityInformation = {
      label: profile
        ? `Active KX connection ${route}; Run q Cell with KX; ${shortcut}`
        : `Activate KX connection; Run q Cell with KX; ${shortcut}`,
    };
    runItem.priority = 101;

    const targetItem = new vscode.NotebookCellStatusBarItem(
      profile
        ? `$(star-full) Active: ${route}`
        : '$(star-empty) Activate q connection',
      vscode.NotebookCellStatusBarAlignment.Right
    );
    targetItem.command = {
      command: SELECT_NOTEBOOK_Q_TARGET_COMMAND,
      title: 'Activate q Connection (KX)',
      arguments: [cell],
    };
    targetItem.tooltip = profile
      ? `Active KX connection "${route}" is the routing source for editor, notebook, Server Explorer, and preview routes. ` +
        `${profile.connected ? 'Transport is open.' : 'Transport opens on activation or first run.'} ` +
        'Click to activate another profile without changing the Python kernel.'
      : profiles.length === 0
        ? 'No saved KX profiles are available. Click to add a connection, then activate it.'
      : 'No KX connection is active. Click to activate the profile used by all KX q routes.';
    targetItem.accessibilityInformation = {
      label: profile
        ? `Active KX connection ${route}; activate another KX profile`
        : 'Activate KX profile for q execution',
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

function activeNotebookQProfile(
  profiles: readonly NotebookQTargetProfile[]
): NotebookQTargetProfile | undefined {
  return profiles.find(profile => profile.active);
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

function portableOutputs(cell: vscode.NotebookCell): PortableKxResult[] {
  const payloads: PortableKxResult[] = [];
  let scannedItems = 0;
  for (const output of cell.outputs) {
    for (const item of output.items) {
      scannedItems += 1;
      if (scannedItems > MAX_NOTEBOOK_OUTPUT_ITEMS_PER_CELL) {
        return payloads;
      }
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

function matchingNotebookOutput(
  notebook: vscode.NotebookDocument,
  outputId: string | undefined,
  requested: PortableKxResult
): PortableKxResult | undefined {
  return matchingNotebookCellOutput(notebook, outputId, requested)?.payload;
}

function matchingNotebookCellOutput(
  notebook: vscode.NotebookDocument,
  outputId: string | undefined,
  requested: PortableKxResult
): {
    cell: vscode.NotebookCell;
    output: vscode.NotebookCellOutput;
    payload: PortableKxResult;
  } | undefined {
  const canonical = JSON.stringify(requested);
  if (outputId) {
    const match = exactNotebookOutput(notebook, outputId);
    if (!match) {
      return undefined;
    }
    for (const payload of portableOutputPayloads(match.output)) {
      if (payload.version === 2 && payload.outputId !== outputId) {
        continue;
      }
      if (JSON.stringify(payload) === canonical) {
        return { ...match, payload };
      }
    }
    return undefined;
  }

  let unique: {
    cell: vscode.NotebookCell;
    output: vscode.NotebookCellOutput;
    payload: PortableKxResult;
  } | undefined;
  const scan = boundedNotebookOutputs(notebook);
  for (const match of scan.outputs) {
    if (hasNotebookOutputBindingMetadata(match.output)) {
      continue;
    }
    for (const payload of portableOutputPayloads(match.output)) {
      if (JSON.stringify(payload) !== canonical) {
        continue;
      }
      if (unique) {
        return undefined;
      }
      unique = { ...match, payload };
    }
  }
  return scan.complete ? unique : undefined;
}

function matchingLiveNotebookOutput(
  notebook: vscode.NotebookDocument,
  outputId: string,
  liveId: string
): { cell: vscode.NotebookCell; output: vscode.NotebookCellOutput } | undefined {
  const match = exactNotebookOutput(notebook, outputId);
  const metadata = match?.output.metadata;
  const reference = metadata && parseNotebookLiveResultReference(
    metadata[NOTEBOOK_LIVE_RESULT_METADATA_KEY]
  );
  if (!match || reference?.id !== liveId) {
    return undefined;
  }
  const ownedPayloads = portableOutputPayloads(match.output).filter(payload =>
    payload.version === 2 && payload.outputId === outputId
  );
  return ownedPayloads.length === 1 ? match : undefined;
}

function exactNotebookOutput(
  notebook: vscode.NotebookDocument,
  outputId: string
): { cell: vscode.NotebookCell; output: vscode.NotebookCellOutput } | undefined {
  let match: { cell: vscode.NotebookCell; output: vscode.NotebookCellOutput } | undefined;
  const scan = boundedNotebookOutputs(notebook);
  for (const candidate of scan.outputs) {
    const reference = parseNotebookOutputBindingFromMetadata(candidate.output.metadata);
    if (reference?.id === outputId) {
      if (match) {
        return undefined;
      }
      match = candidate;
    }
  }
  return scan.complete ? match : undefined;
}

function boundedNotebookOutputs(
  notebook: vscode.NotebookDocument
): {
  outputs: Array<{ cell: vscode.NotebookCell; output: vscode.NotebookCellOutput }>;
  complete: boolean;
} {
  const outputs: Array<{ cell: vscode.NotebookCell; output: vscode.NotebookCellOutput }> = [];
  const cellCount = Math.min(notebook.cellCount, MAX_NOTEBOOK_SCAN_CELLS);
  let remainingOutputs = MAX_NOTEBOOK_SCAN_OUTPUTS;
  for (let index = 0; index < cellCount && remainingOutputs > 0; index++) {
    const cell = notebook.cellAt(index);
    for (const output of cell.outputs) {
      outputs.push({ cell, output });
      remainingOutputs -= 1;
      if (remainingOutputs <= 0) {
        return { outputs, complete: false };
      }
    }
  }
  return {
    outputs,
    complete: notebook.cellCount <= MAX_NOTEBOOK_SCAN_CELLS,
  };
}

function hasNotebookOutputBindingMetadata(output: vscode.NotebookCellOutput): boolean {
  const metadata = output.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(metadata, 'vscode-kdb.outputBinding')) {
    return true;
  }
  const nested = (metadata as { metadata?: unknown }).metadata;
  return !!nested && typeof nested === 'object' && !Array.isArray(nested) &&
    Object.prototype.hasOwnProperty.call(nested, 'vscode-kdb.outputBinding');
}

function portableOutputPayloads(output: vscode.NotebookCellOutput): PortableKxResult[] {
  const payloads: PortableKxResult[] = [];
  for (const item of output.items.slice(0, MAX_NOTEBOOK_OUTPUT_ITEMS_PER_CELL)) {
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
  return payloads;
}

function isLiveScopedRendererMessage(
  message: NotebookRendererMessage
): message is LiveScopedRendererMessage {
  return 'liveId' in message && 'outputId' in message && 'requestId' in message;
}

interface NotebookActionOutcome {
  message: string;
  canceled?: boolean;
}

function notebookRerunOutcome(
  outcome: NotebookQCellRunOutcome
): string | NotebookActionOutcome {
  switch (outcome) {
    case 'executed':
      return 'Cell rerun completed.';
    case 'canceled':
      return { canceled: true, message: 'Rerun canceled.' };
    case 'busy':
      throw new Error('The cell is already running.');
    case 'stale':
      throw new Error('The cell or its output changed before the rerun could be applied.');
    case 'write-failed':
      throw new Error('The rerun finished, but VS Code could not apply its output.');
    case 'unavailable':
    case 'controller-selected':
      throw new Error('The KX notebook runner is unavailable for this cell.');
    case 'not-q':
    case 'unsupported-notebook':
      throw new Error('Rerun applies only to a q-language code cell in a Jupyter notebook.');
  }
}

function notebookLiveRerunOutcome(
  outcome: NotebookQCellRunOutcome
): string | NotebookActionOutcome {
  switch (outcome) {
    case 'executed':
      return 'The new KX Direct IPC execution finished; see its replacement output for success or error details.';
    case 'canceled':
      return { canceled: true, message: 'Live Direct IPC execution canceled.' };
    case 'busy':
      throw new Error('The cell is already running through KX.');
    case 'stale':
      throw new Error('The cell changed before the live Direct IPC output could be applied.');
    case 'write-failed':
      throw new Error('Direct IPC completed, but the live output could not be applied.');
    case 'unavailable':
      throw new Error('The KX Direct IPC runner is unavailable for this cell.');
    case 'controller-selected':
      throw new Error('Select the Python/Jupyter controller before running this %%q body through KX Direct IPC.');
    case 'not-q':
    case 'unsupported-notebook':
      throw new Error('Run %%q Live with KX requires a %%q code cell in a Jupyter notebook.');
  }
}

async function notebookActionResult(
  requestId: number,
  action: NotebookActionResultMessage['action'],
  operation: () => Promise<string | NotebookActionOutcome>
): Promise<NotebookActionResultMessage> {
  try {
    const raw = await operation();
    const outcome = typeof raw === 'string' ? { message: raw } : raw;
    return {
      type: 'actionResult',
      requestId,
      action,
      ok: outcome.canceled !== true,
      canceled: outcome.canceled === true,
      message: outcome.message,
    };
  } catch (error) {
    return {
      type: 'actionResult',
      requestId,
      action,
      ok: false,
      canceled: false,
      message: safeHostError(error),
    };
  }
}

async function copyNotebookTableRange(
  table: ColumnarPanelResult,
  range: CellRange,
  format: TextExportFormat,
  includeHeaders: boolean,
  includeRowIndex: boolean,
  settings: SharedKxResultSettings
): Promise<NotebookActionOutcome> {
  if (range.endRow < range.startRow || range.endColumn < range.startColumn) {
    throw new Error('There are no result cells to copy.');
  }
  if (!(await confirmNotebookCopyExport(
    'copy',
    table,
    range,
    format,
    includeHeaders,
    includeRowIndex,
    settings
  ))) {
    return { canceled: true, message: 'Copy canceled.' };
  }
  const text = table.toText(format, range, {
    includeHeaders,
    includeRowIndex,
    arrayDisplayFormat: settings.arrayDisplayFormat,
  });
  if (text.length > MAX_LIVE_NOTEBOOK_COPY_TEXT_CHARS) {
    throw new Error(
      `Inline copy exceeds the ` +
      `${MAX_LIVE_NOTEBOOK_COPY_TEXT_CHARS.toLocaleString()} character limit.`
    );
  }
  await vscode.env.clipboard.writeText(text);
  return { message: 'Copied.' };
}

async function saveNotebookTableExport(
  table: ColumnarPanelResult,
  range: CellRange,
  format: ExportFormat,
  includeHeaders: boolean,
  includeRowIndex: boolean,
  settings: SharedKxResultSettings
): Promise<NotebookActionOutcome> {
  if (range.endRow < range.startRow || range.endColumn < range.startColumn) {
    throw new Error('There are no result cells to export.');
  }
  if (!(await confirmNotebookCopyExport(
    'export',
    table,
    range,
    format,
    includeHeaders,
    includeRowIndex,
    settings
  ))) {
    return { canceled: true, message: 'Export canceled.' };
  }
  const uri = await vscode.window.showSaveDialog({
    defaultUri: defaultNotebookExportUri(`kx-results.${kxResultExportFileExtension(format)}`),
    filters: kxResultExportSaveFilters(format),
    saveLabel: 'Export',
  });
  if (!uri) {
    return { canceled: true, message: 'Export canceled.' };
  }
  const content = format === 'xlsx'
    ? await columnarToXlsx(
      table,
      range,
      includeHeaders,
      includeRowIndex,
      { arrayDisplayFormat: settings.arrayDisplayFormat }
    )
    : new TextEncoder().encode(table.toText(format, range, {
      includeHeaders,
      includeRowIndex,
      arrayDisplayFormat: settings.arrayDisplayFormat,
    }));
  await vscode.workspace.fs.writeFile(uri, content);
  return { message: `${format.toUpperCase()} exported / saved.` };
}

async function confirmNotebookCopyExport(
  action: 'copy' | 'export',
  table: ColumnarPanelResult,
  range: CellRange,
  format: ExportFormat,
  includeHeaders: boolean,
  includeRowIndex: boolean,
  settings: SharedKxResultSettings
): Promise<boolean> {
  const estimate = estimateCopyExport(
    table,
    range,
    format,
    includeHeaders,
    includeRowIndex,
    { arrayDisplayFormat: settings.arrayDisplayFormat }
  );
  const message = largeCopyExportConfirmationMessage(
    action,
    format,
    estimate,
    settings.copyExportConfirmCellThreshold
  );
  if (!message) {
    return true;
  }
  const decision = await vscode.window.showWarningMessage(message, 'Continue', 'Cancel');
  return decision === 'Continue';
}

async function saveNotebookTextExport(text: string): Promise<NotebookActionOutcome> {
  const uri = await vscode.window.showSaveDialog({
    defaultUri: defaultNotebookExportUri('kx-results.txt'),
    filters: { Text: ['txt'] },
    saveLabel: 'Export',
  });
  if (!uri) {
    return { canceled: true, message: 'Text export canceled.' };
  }
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
  return { message: 'Text exported / saved.' };
}

async function saveNotebookChartPng(dataUrl: string): Promise<NotebookActionOutcome> {
  const content = chartPngBytesFromDataUrl(dataUrl);
  const uri = await vscode.window.showSaveDialog({
    defaultUri: defaultNotebookExportUri('kx-chart.png'),
    filters: { PNG: ['png'] },
    saveLabel: 'Export',
  });
  if (!uri) {
    return { canceled: true, message: 'Chart export canceled.' };
  }
  await vscode.workspace.fs.writeFile(uri, content);
  return { message: 'Chart exported / saved.' };
}

function defaultNotebookExportUri(fileName: string): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
  return vscode.Uri.file(path.join(folder, fileName));
}

function portablePreviewRange(
  payload: PortableKxTableResult,
  request: {
    startRow: number;
    endRow: number;
    startColumn: number;
    endColumn: number;
    columnIndexes?: number[];
    rowIndexes?: number[];
  }
): { table: ColumnarPanelResult; range: CellRange } {
  const indexes = request.columnIndexes || Array.from(
    { length: request.endColumn - request.startColumn + 1 },
    (_value, index) => request.startColumn + index
  );
  const rowIndexes = request.rowIndexes || payload.data.rows.map((_row, index) => index);
  const projectedRows = request.rowIndexes ? request.endRow + 1 : rowIndexes.length;
  const table = createColumnarPanelResult(
    indexes.map(index => payload.schema.columns[index].name),
    projectedRows,
    (rowIndex, columnIndex) => {
      const rowOffset = request.rowIndexes ? rowIndex - request.startRow : rowIndex;
      const sourceRow = rowIndexes[rowOffset];
      return sourceRow === undefined
        ? null
        : portableCellValue(payload.data.rows[sourceRow][indexes[columnIndex]]);
    },
    indexes.map(index => payload.schema.columns[index].type),
    payload.schema.keyColumnOrdinals === undefined
      ? undefined
      : indexes.reduce<number[]>((ordinals, sourceOrdinal, projectedOrdinal) => {
        if (payload.schema.keyColumnOrdinals!.includes(sourceOrdinal)) {
          ordinals.push(projectedOrdinal);
        }
        return ordinals;
      }, [])
  );
  return {
    table,
    range: {
      startRow: request.startRow,
      endRow: request.endRow,
      startColumn: 0,
      endColumn: indexes.length - 1,
    },
  };
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
  liveId: string,
  requestId: number,
  displayOptions: LiveNotebookDisplayOptions,
  cellUri?: string
): NotebookLiveResultMessage {
  let view: ReturnType<LiveNotebookResultStore['view']>;
  try {
    view = liveResults?.view(liveId, notebookUri, displayOptions, cellUri);
  } catch {
    return unavailableLiveResultMessage(liveId, requestId);
  }
  if (!view) {
    return unavailableLiveResultMessage(liveId, requestId);
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
    liveId,
    requestId,
    available: true,
    mode: view.mode,
    kind: boundedHostText(view.kind, 128),
    columns,
    ...(view.keyColumnOrdinals === undefined
      ? {}
      : {
        keyColumnOrdinals: view.keyColumnOrdinals.filter(
          ordinal => ordinal < columns.length
        ),
      }),
    totalColumnCount: view.columns.length,
    rowCount: view.rowCount,
    chartXColumns,
    chartYColumns,
    chartGroupColumns,
    ...(view.mode === 'text'
      ? { text: boundedHostText(view.text || '', 1_048_576) }
      : {}),
    metadata: {
      query: boundedHostText(view.query, 16_384),
      connectionName: boundedHostText(view.connectionName, 512),
      elapsedMs: view.elapsedMs,
      messages,
    },
  };
}

export async function liveColumnTextLengthsMessage(
  liveResults: LiveNotebookResultStore | undefined,
  notebookUri: string,
  liveId: string,
  requestId: number,
  displayOptions: LiveNotebookDisplayOptions,
  cellUri?: string
): Promise<NotebookLiveColumnTextLengthsMessage | undefined> {
  let view: ReturnType<LiveNotebookResultStore['view']>;
  try {
    view = liveResults?.view(liveId, notebookUri, displayOptions, cellUri);
  } catch {
    return undefined;
  }
  if (!view || view.mode !== 'table') {
    return undefined;
  }
  const lengths = await liveResults?.columnTextLengths(
    liveId,
    notebookUri,
    displayOptions,
    cellUri,
    MAX_NOTEBOOK_LIVE_COLUMNS
  );
  if (!lengths) {
    return undefined;
  }
  const rawColumns = view.columns.slice(0, MAX_NOTEBOOK_LIVE_COLUMNS);
  const columns = safeLiveColumnNames(rawColumns);
  return {
    type: 'liveColumnTextLengths',
    liveId,
    requestId,
    lengths: lengths
      .slice(0, columns.length)
      .map((length, index) => Math.min(
        KX_COLUMN_AUTO_TEXT_CHAR_LIMIT,
        Math.max(length, columns[index].length)
      )),
  };
}

export function unavailableLiveResultMessage(
  liveId: string,
  requestId: number,
  message = 'Result unavailable.'
): NotebookLiveResultMessage {
  return {
    type: 'liveResult',
    liveId,
    requestId,
    available: false,
    message,
  };
}

export function liveSliceMessage(
  liveResults: LiveNotebookResultStore | undefined,
  notebookUri: string,
  message: Extract<NotebookRendererMessage, { type: 'requestLiveSlice' }>,
  displayOptions: LiveNotebookDisplayOptions,
  cellUri?: string
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
        ...(message.columnIndexes ? { columnIndexes: message.columnIndexes } : {}),
        ...liveSortRequest(
          liveResults,
          notebookUri,
          message,
          displayOptions,
          cellUri
        ),
      },
      displayOptions,
      cellUri
    );
    if (!slice) {
      return unavailableLiveSlice(message.liveId, message.requestId);
    }
    return {
      type: 'liveSlice',
      liveId: message.liveId,
      requestId: message.requestId,
      ...slice,
    };
  } catch (error) {
    return unavailableLiveSlice(message.liveId, message.requestId, safeHostError(error));
  }
}

function unavailableLiveSlice(
  liveId: string,
  requestId: number,
  detail = 'Result unavailable.'
): NotebookLiveSliceMessage {
  return {
    type: 'liveSlice',
    liveId,
    requestId,
    startRow: 0,
    endRow: -1,
    startColumn: 0,
    endColumn: -1,
    columnOrdinals: [],
    cells: [],
    error: detail,
  };
}

export function liveSearchMessage(
  liveResults: LiveNotebookResultStore | undefined,
  notebookUri: string,
  message: Extract<NotebookRendererMessage, { type: 'searchLiveResult' }>,
  displayOptions: LiveNotebookDisplayOptions,
  cellUri?: string
): NotebookLiveSearchMessage {
  try {
    const result = liveResults?.search(
      message.liveId,
      notebookUri,
      message.query,
      displayOptions,
      {
        ...(message.columnIndexes ? { columnIndexes: message.columnIndexes } : {}),
        ...liveSortRequest(
          liveResults,
          notebookUri,
          message,
          displayOptions,
          cellUri
        ),
      },
      cellUri
    );
    if (!result) {
      return unavailableLiveSearch(message.liveId, message.requestId);
    }
    return {
      type: 'liveSearch',
      liveId: message.liveId,
      requestId: message.requestId,
      ...result,
    };
  } catch (error) {
    return unavailableLiveSearch(message.liveId, message.requestId, safeHostError(error));
  }
}

function unavailableLiveSearch(
  liveId: string,
  requestId: number,
  detail = 'Result unavailable.'
): NotebookLiveSearchMessage {
  return {
    type: 'liveSearch',
    liveId,
    requestId,
    matches: [],
    totalScanned: 0,
    scannedCells: 0,
    capped: false,
    partial: false,
    error: detail,
  };
}

export function liveChartMessage(
  liveResults: LiveNotebookResultStore | undefined,
  notebookUri: string,
  message: Extract<NotebookRendererMessage, { type: 'requestLiveChart' }>,
  displayOptions: LiveNotebookDisplayOptions,
  resultSettings: SharedKxResultSettings,
  cellUri?: string
): NotebookLiveChartMessage {
  try {
    const columnMap = liveSourceColumnMap(
      liveResults,
      notebookUri,
      message.liveId,
      displayOptions,
      cellUri
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
        xMin: message.xMin,
        xMax: message.xMax,
      },
      displayOptions,
      cellUri
    );
    if (!chart) {
      return {
        type: 'liveChart',
        liveId: message.liveId,
        requestId: message.requestId,
        error: 'Result unavailable.',
      };
    }
    return {
      type: 'liveChart',
      liveId: message.liveId,
      requestId: message.requestId,
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
          ...(series.gapBefore ? { gapBefore: series.gapBefore } : {}),
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
      liveId: message.liveId,
      requestId: message.requestId,
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
  displayOptions: LiveNotebookDisplayOptions,
  cellUri?: string
): Map<string, string> {
  const rawColumns = liveResults?.tableColumns(liveId, notebookUri, displayOptions, cellUri)
    ?.slice(0, MAX_NOTEBOOK_LIVE_COLUMNS) || [];
  const displayColumns = safeLiveColumnNames(rawColumns);
  return new Map(displayColumns.map((display, index) => [display, rawColumns[index]]));
}

function liveSortRequest(
  liveResults: LiveNotebookResultStore | undefined,
  notebookUri: string,
  message: {
    liveId: string;
    sortOrdinal?: number;
    sortColumn?: string;
    sortDirection?: 'asc' | 'desc';
  },
  displayOptions: LiveNotebookDisplayOptions,
  cellUri?: string
): {
  sortOrdinal?: number;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
} {
  if (!message.sortDirection) {
    return {};
  }
  if (Number.isSafeInteger(message.sortOrdinal) && message.sortOrdinal! >= 0) {
    return {
      sortOrdinal: message.sortOrdinal,
      sortDirection: message.sortDirection,
    };
  }
  const sortColumn = message.sortColumn
    ? liveSourceColumnMap(
      liveResults,
      notebookUri,
      message.liveId,
      displayOptions,
      cellUri
    ).get(message.sortColumn)
    : undefined;
  return sortColumn
    ? { sortColumn, sortDirection: message.sortDirection }
    : {};
}

function safeHostError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return boundedHostText(message || 'Live KX notebook operation failed.', 4_096);
}
