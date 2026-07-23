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
  MAX_NOTEBOOK_BYTE_LIMIT,
  PortableKxResult,
  portableCellValue,
  validatePortableKxResult,
} from './notebook-contract';
import { KxResultsPanel } from './kx-results-panel';
import { notebookRendererSettingsMessage, parseNotebookRendererMessage } from './notebook-message';
import {
  NotebookSettings,
  hasNotebookQMarker,
  safeNotebookByteLimit,
  safeNotebookPresentation,
  safeNotebookRowLimit,
} from './notebook-settings';

export const KX_NOTEBOOK_RENDERER_ID = 'vscode-kdb.kx-notebook-renderer';
export const SET_NOTEBOOK_CELL_LANGUAGE_Q_COMMAND = 'vscode-kdb.setNotebookCellLanguageQ';
export const RESTORE_NOTEBOOK_CELL_LANGUAGE_COMMAND = 'vscode-kdb.restoreNotebookCellLanguage';
export const TAG_NOTEBOOK_CELL_AS_Q_COMMAND = 'vscode-kdb.tagNotebookCellAsQ';
export const PREPARE_NOTEBOOK_CELL_FOR_PYTHON_COMMAND =
  'vscode-kdb.prepareNotebookCellForPythonKernel';

const NOTEBOOK_Q_CELL_CONTEXT = 'vscode-kdb.notebookQCell';
const NOTEBOOK_Q_CELL_NEEDS_PREPARATION_CONTEXT =
  'vscode-kdb.notebookQCellNeedsKernelPreparation';
const NOTEBOOK_DEFAULT_LANGUAGE_CONTEXT = 'vscode-kdb.notebookDefaultLanguageAvailable';
const NOTEBOOK_RESULT_CONTEXT = 'vscode-kdb.notebookResultAvailable';
const MAX_NOTEBOOK_SCAN_CELLS = 10_000;
const MAX_NOTEBOOK_OUTPUT_ITEMS_PER_CELL = 2_000;

export class NotebookIntegration implements vscode.Disposable {
  private readonly context: vscode.ExtensionContext;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly messaging: vscode.NotebookRendererMessaging;
  private readonly statusBarChanged = new vscode.EventEmitter<void>();
  private readonly cellLanguageProvider = new NotebookCellLanguageProvider<vscode.TextDocument>(
    (document, languageId) => vscode.languages.setTextDocumentLanguage(document, languageId)
  );

  public constructor(context: vscode.ExtensionContext) {
    this.context = context;
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
      vscode.commands.registerCommand('vscode-kdb.openNotebookPreviewInResults', () =>
        this.openSelectedNotebookPreview()),
      vscode.notebooks.registerNotebookCellStatusBarItemProvider(
        'jupyter-notebook',
        {
          onDidChangeCellStatusBarItems: this.statusBarChanged.event,
          provideCellStatusBarItems: cell => this.kernelPreparationStatusBarItem(cell),
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
        if (event.affectsConfiguration('vscode-kdb.notebook')) {
          void this.messaging.postMessage(notebookRendererSettingsMessage(notebookSettings()));
        }
      }),
      this.statusBarChanged
    );
    this.updateContexts();
  }

  public dispose(): void {
    this.disposables.splice(0).forEach(disposable => disposable.dispose());
    void vscode.commands.executeCommand('setContext', NOTEBOOK_Q_CELL_CONTEXT, false);
    void vscode.commands.executeCommand(
      'setContext',
      NOTEBOOK_Q_CELL_NEEDS_PREPARATION_CONTEXT,
      false
    );
    void vscode.commands.executeCommand('setContext', NOTEBOOK_DEFAULT_LANGUAGE_CONTEXT, false);
    void vscode.commands.executeCommand('setContext', NOTEBOOK_RESULT_CONTEXT, false);
  }

  private async onRendererMessage(event: { editor: vscode.NotebookEditor; message: any }): Promise<void> {
    const message = parseNotebookRendererMessage(event.message);
    if (!message) {
      return;
    }
    if (message.type === 'ready') {
      await this.messaging.postMessage(notebookRendererSettingsMessage(notebookSettings()), event.editor);
      return;
    }
    const payload = matchingNotebookOutput(event.editor.notebook, message.payload);
    if (!payload) {
      throw new Error('The requested preview is not present in the current notebook.');
    }
    this.showPreview(payload);
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
    this.finishLanguageChange('q', result);
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
    result: NotebookLanguageResult<vscode.TextDocument>
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
        `${result.failures.length} failed.${skipped}`
      );
      return;
    }
    void vscode.window.showInformationMessage(
      `Set ${succeeded} notebook code cell${succeeded === 1 ? '' : 's'} to ${languageId} ` +
      `(${result.changed} changed, ${result.unchanged} already ${languageId}).${skipped}`
    );
  }

  private async openSelectedNotebookPreview(): Promise<void> {
    const editor = vscode.window.activeNotebookEditor;
    const cell = selectedCell(editor);
    const payload = cell ? firstPortableOutput(cell) : undefined;
    if (!payload) {
      if (cell && isQCell(cell) && !hasNotebookQMarker(cell.document.getText())) {
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
    const columns = payload.schema.columns.map(column => column.name);
    const messages: string[] = [
      `Saved notebook preview: ${payload.result.previewRowCount} of ${payload.result.rowCount} rows.`,
    ];
    if (payload.result.truncated) {
      messages.push(
        'Preview only. Omitted rows are not stored in the notebook and cannot be recovered by this panel.'
      );
    }
    KxResultsPanel.showResult(this.context, {
      table: createColumnarPanelResult(columns, payload.data.rows.length, (rowIndex, columnIndex) =>
        portableCellValue(payload.data.rows[rowIndex][columnIndex])),
      query: payload.provenance.qSource ?? '%%q (saved notebook preview)',
      connectionName: payload.provenance.label ?? 'Notebook saved preview',
      elapsedMs: payload.provenance.elapsedMs ?? 0,
      messages,
    }, 'replace', { autoChart: payload.chart?.visible === true });
  }

  private updateContexts(): void {
    const editor = vscode.window.activeNotebookEditor;
    const cell = selectedCell(editor);
    const qCell = !!cell && isQCell(cell);
    void vscode.commands.executeCommand('setContext', NOTEBOOK_Q_CELL_CONTEXT, !!cell && isQCell(cell));
    void vscode.commands.executeCommand(
      'setContext',
      NOTEBOOK_Q_CELL_NEEDS_PREPARATION_CONTEXT,
      qCell && !hasNotebookQMarker(cell!.document.getText())
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
    this.statusBarChanged.fire();
  }

  private kernelPreparationStatusBarItem(
    cell: vscode.NotebookCell
  ): vscode.NotebookCellStatusBarItem | undefined {
    if (!isQCell(cell) || hasNotebookQMarker(cell.document.getText())) {
      return undefined;
    }
    const item = new vscode.NotebookCellStatusBarItem(
      '$(lightbulb) Prepare for Python kernel',
      vscode.NotebookCellStatusBarAlignment.Right
    );
    item.command = {
      command: PREPARE_NOTEBOOK_CELL_FOR_PYTHON_COMMAND,
      title: 'Prepare this q cell for the active Python kernel',
      arguments: [cell],
    };
    item.tooltip =
      'Add a leading %%q marker for the configured kx_notebook evaluator. The current Python controller may require restoring the notebook language before Run; no q controller or connection is created.';
    item.accessibilityInformation = {
      label: 'Prepare this q cell for the active Python kernel',
    };
    item.priority = 100;
    return item;
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
      if (item.mime !== KX_NOTEBOOK_MIME || item.data.byteLength > MAX_NOTEBOOK_BYTE_LIMIT) {
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
  requested: PortableKxResult
): PortableKxResult | undefined {
  const canonical = JSON.stringify(requested);
  const cellCount = Math.min(notebook.cellCount, MAX_NOTEBOOK_SCAN_CELLS);
  for (let index = 0; index < cellCount; index++) {
    for (const payload of portableOutputs(notebook.cellAt(index))) {
      if (JSON.stringify(payload) === canonical) {
        return payload;
      }
    }
  }
  return undefined;
}
