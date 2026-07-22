import * as vscode from 'vscode';
import { createColumnarPanelResult } from './kx-results';
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
  notebookQMagicLine,
  safeNotebookByteLimit,
  safeNotebookPresentation,
  safeNotebookRowLimit,
} from './notebook-settings';

export const KX_NOTEBOOK_RENDERER_ID = 'vscode-kdb.kx-notebook-renderer';
export const KX_NOTEBOOK_METADATA_KEY = 'vscode-kdb';
export const KX_NOTEBOOK_METADATA_VERSION = 1;

const NOTEBOOK_Q_CELL_CONTEXT = 'vscode-kdb.notebookQCell';
const NOTEBOOK_RESULT_CONTEXT = 'vscode-kdb.notebookResultAvailable';
const MAX_NOTEBOOK_SCAN_CELLS = 10_000;
const MAX_NOTEBOOK_OUTPUT_ITEMS_PER_CELL = 2_000;

export class NotebookIntegration implements vscode.Disposable {
  private readonly context: vscode.ExtensionContext;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly messaging: vscode.NotebookRendererMessaging;

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
      vscode.commands.registerCommand('vscode-kdb.tagNotebookCellAsQ', () => this.tagSelectedCells()),
      vscode.commands.registerCommand('vscode-kdb.openNotebookPreviewInResults', () =>
        this.openSelectedNotebookPreview()),
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
      })
    );
    this.updateContexts();
  }

  public dispose(): void {
    this.disposables.splice(0).forEach(disposable => disposable.dispose());
    void vscode.commands.executeCommand('setContext', NOTEBOOK_Q_CELL_CONTEXT, false);
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

  private async tagSelectedCells(): Promise<void> {
    const editor = vscode.window.activeNotebookEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Open an IPython/Jupyter notebook before tagging a q cell.');
      return;
    }
    const indexes = selectedCellIndexes(editor).filter(index =>
      editor.notebook.cellAt(index).kind === vscode.NotebookCellKind.Code
    );
    if (indexes.length === 0) {
      vscode.window.showWarningMessage('Select at least one notebook code cell to tag as q.');
      return;
    }
    const settings = notebookSettings();
    const edit = new vscode.WorkspaceEdit();
    const notebookEdits: vscode.NotebookEdit[] = [];
    let insertedMarkers = 0;
    for (const index of indexes) {
      const cell = editor.notebook.cellAt(index);
      if (!hasNotebookQMarker(cell.document.getText())) {
        edit.insert(
          cell.document.uri,
          new vscode.Position(0, 0),
          `${notebookQMagicLine(settings)}\n`
        );
        insertedMarkers += 1;
      }
      notebookEdits.push(vscode.NotebookEdit.updateCellMetadata(index, {
        ...cell.metadata,
        [KX_NOTEBOOK_METADATA_KEY]: {
          version: KX_NOTEBOOK_METADATA_VERSION,
          language: 'q',
          marker: '%%q',
          rowLimit: settings.rowLimit,
          byteLimit: settings.byteLimit,
        },
      }));
    }
    edit.set(editor.notebook.uri, notebookEdits);
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      vscode.window.showErrorMessage('VS Code could not tag the selected notebook cell(s) as q.');
      return;
    }
    this.updateContexts();
    const markerSummary = insertedMarkers === 0 ? 'Metadata refreshed.' : 'Added a durable %%q marker.';
    vscode.window.showInformationMessage(
      `Tagged ${indexes.length} notebook code cell${indexes.length === 1 ? '' : 's'} as q. ${markerSummary}`
    );
  }

  private async openSelectedNotebookPreview(): Promise<void> {
    const editor = vscode.window.activeNotebookEditor;
    const cell = selectedCell(editor);
    const payload = cell ? firstPortableOutput(cell) : undefined;
    if (!payload) {
      vscode.window.showWarningMessage(
        'The selected cell has no valid saved KX preview. Run a %%q cell through kx_notebook first.'
      );
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
    const cell = selectedCell(vscode.window.activeNotebookEditor);
    void vscode.commands.executeCommand('setContext', NOTEBOOK_Q_CELL_CONTEXT, !!cell && isQCell(cell));
    void vscode.commands.executeCommand(
      'setContext',
      NOTEBOOK_RESULT_CONTEXT,
      !!cell && firstPortableOutput(cell) !== undefined
    );
  }
}

export function isQCell(cell: Pick<vscode.NotebookCell, 'kind' | 'metadata' | 'document'>): boolean {
  return cell.kind === vscode.NotebookCellKind.Code && hasNotebookQMarker(cell.document.getText());
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

function selectedCellIndexes(editor: vscode.NotebookEditor): number[] {
  const indexes = new Set<number>();
  editor.selections.forEach(range => {
    const end = range.end > range.start ? range.end : range.start + 1;
    for (let index = range.start; index < end && index < editor.notebook.cellCount; index++) {
      indexes.add(index);
    }
  });
  if (indexes.size === 0 && editor.notebook.cellCount > 0) {
    indexes.add(0);
  }
  return [...indexes].sort((left, right) => left - right);
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
