import * as vscode from 'vscode';

import {
  QnbCellModel,
  QnbDocumentModel,
  QnbJson,
  QnbOutputModel,
  decodeQnb,
  encodeQnb,
} from './qnb-codec';

export const QNB_NOTEBOOK_TYPE = 'vscode-kdb-q-notebook';
export const NEW_Q_NOTEBOOK_COMMAND = 'vscode-kdb.newQNotebook';
export const QNB_LEGACY_OUTPUT_MIME = 'x-application/q-notebook';
const CELL_SIDECAR = 'vscode-kdb.qnb.cellSidecar';
const OUTPUT_SIDECAR = 'vscode-kdb.qnb.outputSidecar';

interface CellSidecar {
  readonly unknown: Readonly<Record<string, QnbJson>>;
}

interface OutputSidecar {
  readonly unknown: Readonly<Record<string, QnbJson>>;
  readonly valueKind: 'string' | 'json';
  readonly fallbackItemIndex?: number;
}

export class QnbNotebookSupport implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[];

  public constructor() {
    this.disposables = [
      vscode.workspace.registerNotebookSerializer(
        QNB_NOTEBOOK_TYPE,
        new QnbNotebookSerializer(),
        { transientOutputs: false }
      ),
      vscode.commands.registerCommand('vscode-kdb.newQNotebook', () => this.createNotebook()),
    ];
  }

  public dispose(): void {
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
  }

  private async createNotebook(): Promise<void> {
    const cell = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, '', 'q');
    cell.outputs = [];
    const document = await vscode.workspace.openNotebookDocument(
      QNB_NOTEBOOK_TYPE,
      new vscode.NotebookData([cell])
    );
    await vscode.window.showNotebookDocument(document);
  }
}

export class QnbNotebookSerializer implements vscode.NotebookSerializer {
  public async deserializeNotebook(
    content: Uint8Array,
    _token: vscode.CancellationToken,
  ): Promise<vscode.NotebookData> {
    const decoded = decodeQnb(content);
    return new vscode.NotebookData(decoded.cells.map(cellData));
  }

  public async serializeNotebook(
    data: vscode.NotebookData,
    _token: vscode.CancellationToken,
  ): Promise<Uint8Array> {
    const document: QnbDocumentModel = {
      cells: data.cells.map((cell, index) => cellModel(cell, index)),
    };
    return encodeQnb(document);
  }
}

function cellData(cell: QnbCellModel): vscode.NotebookCellData {
  const kind = cell.kind === 'code'
    ? vscode.NotebookCellKind.Code
    : vscode.NotebookCellKind.Markup;
  const value = new vscode.NotebookCellData(kind, cell.value, cell.kind === 'code' ? 'q' : 'markdown');
  const metadata = object(cell.unknown.metadata);
  value.metadata = {
    ...metadata,
    [CELL_SIDECAR]: { unknown: cell.unknown } satisfies CellSidecar,
  };
  const executionSummary = object(cell.unknown.executionSummary);
  if (typeof executionSummary.executionOrder === 'number' || typeof executionSummary.success === 'boolean') {
    value.executionSummary = {
      executionOrder: typeof executionSummary.executionOrder === 'number'
        ? executionSummary.executionOrder
        : undefined,
      success: typeof executionSummary.success === 'boolean' ? executionSummary.success : undefined,
      timing: executionTiming(executionSummary.timing),
    };
  }
  value.outputs = cell.outputs.map(outputData);
  return value;
}

function outputData(output: QnbOutputModel): vscode.NotebookCellOutput {
  const valueKind: OutputSidecar['valueKind'] = typeof output.value === 'string' ? 'string' : 'json';
  const text = valueKind === 'string' ? output.value as string : JSON.stringify(output.value);
  const fallback = output.mime === QNB_LEGACY_OUTPUT_MIME
    ? vscode.NotebookCellOutputItem.text(legacyOutputFallback(output.value))
    : undefined;
  return new vscode.NotebookCellOutput(
    [
      new vscode.NotebookCellOutputItem(new TextEncoder().encode(text), output.mime),
      ...(fallback ? [fallback] : []),
    ],
    {
      ...object(output.unknown.metadata),
      [OUTPUT_SIDECAR]: {
        unknown: output.unknown,
        valueKind,
        ...(fallback ? { fallbackItemIndex: 1 } : {}),
      } satisfies OutputSidecar,
    }
  );
}

function cellModel(cell: vscode.NotebookCellData, index: number): QnbCellModel {
  const kind = cell.kind === vscode.NotebookCellKind.Code ? 'code' : 'markdown';
  const sidecar = cellSidecar(cell.metadata?.[CELL_SIDECAR]);
  const metadata = withoutOwned(cell.metadata, CELL_SIDECAR);
  const unknown: Record<string, QnbJson> = {
    ...sidecar?.unknown,
  };
  if (Object.keys(metadata).length > 0) unknown.metadata = metadata;
  if (cell.executionSummary) {
    unknown.executionSummary = executionSummary(cell.executionSummary);
  }
  return {
    kind,
    language: kind === 'code' ? 'q' : 'markdown',
    value: cell.value,
    outputs: (cell.outputs ?? []).flatMap((output, outputIndex) => {
      const sidecar = outputSidecar(output.metadata?.[OUTPUT_SIDECAR]);
      return output.items.flatMap((item, itemIndex) =>
        sidecar?.fallbackItemIndex === itemIndex
          ? []
          : [outputModel(output, item, index, outputIndex, itemIndex)]);
    }),
    unknown,
  };
}

function outputModel(
  output: vscode.NotebookCellOutput,
  item: vscode.NotebookCellOutputItem,
  cellIndex: number,
  outputIndex: number,
  itemIndex: number,
): QnbOutputModel {
  const sidecar = itemIndex === 0 ? outputSidecar(output.metadata?.[OUTPUT_SIDECAR]) : undefined;
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(item.data);
  let value: QnbJson = decoded;
  const expectsJson = sidecar?.valueKind === 'json' || jsonMime(item.mime);
  if (expectsJson) {
    try {
      value = JSON.parse(decoded) as QnbJson;
    } catch {
      if (sidecar?.valueKind === 'json') {
        throw new Error(
          `q notebook cell ${cellIndex} output ${outputIndex}:${itemIndex} can no longer be preserved as JSON.`
        );
      }
    }
  }
  const metadata = withoutOwned(output.metadata, OUTPUT_SIDECAR);
  const unknown: Record<string, QnbJson> = { ...sidecar?.unknown };
  if (Object.keys(metadata).length > 0) unknown.metadata = metadata;
  return { mime: item.mime, value, unknown };
}

function cellSidecar(value: unknown): CellSidecar | undefined {
  if (!isRecord(value) || !isRecord(value.unknown)) return undefined;
  return { unknown: value.unknown as Record<string, QnbJson> };
}

function outputSidecar(value: unknown): OutputSidecar | undefined {
  if (!isRecord(value) || !isRecord(value.unknown) ||
    (value.valueKind !== 'string' && value.valueKind !== 'json') ||
    (value.fallbackItemIndex !== undefined && (!Number.isInteger(value.fallbackItemIndex) ||
      (value.fallbackItemIndex as number) < 1 || (value.fallbackItemIndex as number) > 16))) return undefined;
  return {
    unknown: value.unknown as Record<string, QnbJson>,
    valueKind: value.valueKind,
    ...(value.fallbackItemIndex === undefined
      ? {}
      : { fallbackItemIndex: value.fallbackItemIndex as number }),
  };
}

function withoutOwned(value: unknown, key: string): Record<string, QnbJson> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([name]) => name !== key)
    .filter(([, item]) => jsonCompatible(item))
  ) as Record<string, QnbJson>;
}

function executionSummary(value: vscode.NotebookCellExecutionSummary): QnbJson {
  const result: Record<string, QnbJson> = {};
  if (typeof value.executionOrder === 'number') result.executionOrder = value.executionOrder;
  if (typeof value.success === 'boolean') result.success = value.success;
  if (value.timing) {
    result.timing = { startTime: value.timing.startTime, endTime: value.timing.endTime };
  }
  return result;
}

function executionTiming(value: unknown): vscode.NotebookCellExecutionSummary['timing'] {
  const timing = object(value);
  return typeof timing.startTime === 'number' && typeof timing.endTime === 'number'
    ? { startTime: timing.startTime, endTime: timing.endTime }
    : undefined;
}

function object(value: unknown): Record<string, QnbJson> {
  return isRecord(value) && jsonCompatible(value) ? value as Record<string, QnbJson> : {};
}

function jsonCompatible(value: unknown, depth = 0): value is QnbJson {
  if (depth > 64) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(item => jsonCompatible(item, depth + 1));
  return isRecord(value) && Object.values(value).every(item => jsonCompatible(item, depth + 1));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function jsonMime(mime: string): boolean {
  return mime === 'application/json' || mime.endsWith('+json') ||
    mime === 'application/vnd.code.notebook.error' || mime === 'x-application/q-notebook';
}

function legacyOutputFallback(value: QnbJson): string {
  if (isRecord(value) && value.type === 'list' && Array.isArray(value.value) &&
    value.value.every(item => item === null || typeof item === 'string' ||
      typeof item === 'number' || typeof item === 'boolean')) {
    if (value.value.length === 1) {
      return `Legacy q list (one element)\n${legacyScalar(value.value[0])}`;
    }
    return [
      'Legacy q list (index and element)',
      'index\telement',
      ...value.value.map((item, index) => `${index}\t${legacyScalar(item)}`),
    ].join('\n');
  }
  return [
    'Legacy q Professional output (preserved without type conversion)',
    JSON.stringify(value, null, 2),
  ].join('\n');
}

function legacyScalar(value: null | string | number | boolean): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}
