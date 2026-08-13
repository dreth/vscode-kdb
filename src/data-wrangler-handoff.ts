import { randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  CellTextOptions,
  ColumnarPanelResult,
  cellValueToBoundedCsvText,
} from './kx-results';

export const DATA_WRANGLER_EXTENSION_ID = 'ms-toolsai.datawrangler';
export const DATA_WRANGLER_OPEN_COMMAND = 'dataWrangler.openInDataWrangler';
export const DATA_WRANGLER_HANDOFF_DIRECTORY = 'data-wrangler-handoffs';
export const DATA_WRANGLER_HANDOFF_MAX_CELL_TEXT_CHARS = 16 * 1024 * 1024;

let diagnosticWriter: ((value: string) => void) | undefined;

export interface DataWranglerHandoffOptions {
  cellTextOptions?: CellTextOptions;
  csvHeaders?: readonly string[];
  sourceCsvHeaders?: readonly string[];
  sourceColumnPositions?: readonly number[];
  shouldCancel?: () => boolean;
}

export interface DataWranglerCsvHandoff {
  csvUri: vscode.Uri;
  csvPath: string;
  rowCount: number;
  columnCount: number;
  byteCount: number;
}

export interface DataWranglerOpenOutcome {
  created: boolean;
  launched: boolean;
  csvUri?: vscode.Uri;
  message: string;
  reason?: 'unsupported' | 'extensionAbsent' | 'commandFailed' | 'cancelled';
}

export class DataWranglerHandoffCancelledError extends Error {
  constructor() {
    super('Data Wrangler CSV export was canceled.');
    this.name = 'DataWranglerHandoffCancelledError';
  }
}

export class DataWranglerHandoffLimitError extends Error {
  constructor(rowIndex: number | undefined, columnIndex: number) {
    const location = rowIndex === undefined
      ? `header at column ${columnIndex + 1}`
      : `cell at row ${rowIndex + 1}, column ${columnIndex + 1}`;
    super(`Data Wrangler CSV export stopped because the ${location} was too large to render safely.`);
    this.name = 'DataWranglerHandoffLimitError';
  }
}

export function configureDataWranglerHandoffDiagnostics(
  writer: ((value: string) => void) | undefined
): void {
  diagnosticWriter = writer;
}

/** Write a temporary CSV and ask the separately installed Data Wrangler extension to open it. */
export async function openDataWranglerSnapshot(
  context: vscode.ExtensionContext,
  table: ColumnarPanelResult,
  options: DataWranglerHandoffOptions = {}
): Promise<DataWranglerOpenOutcome> {
  const unsupported = dataWranglerLocalHandoffUnsupportedReason(context);
  if (unsupported) {
    await vscode.window.showWarningMessage(unsupported);
    return { created: false, launched: false, message: unsupported, reason: 'unsupported' };
  }

  let handoff: DataWranglerCsvHandoff;
  try {
    handoff = await createDataWranglerCsvHandoff(context.globalStorageUri, table, options);
  } catch (error) {
    if (error instanceof DataWranglerHandoffCancelledError) {
      return { created: false, launched: false, message: error.message, reason: 'cancelled' };
    }
    diagnose('create-failed', error);
    throw error;
  }

  if (options.shouldCancel?.()) {
    return {
      created: true,
      launched: false,
      csvUri: handoff.csvUri,
      message: 'The temporary CSV was created but not opened because the operation was canceled.',
      reason: 'cancelled',
    };
  }

  const extension = vscode.extensions.getExtension(DATA_WRANGLER_EXTENSION_ID);
  if (!extension) {
    const message = 'Data Wrangler is not installed or enabled. The temporary CSV was opened in VS Code instead.';
    await openCsvFallback(handoff.csvUri, message);
    return { created: true, launched: false, csvUri: handoff.csvUri, message, reason: 'extensionAbsent' };
  }

  try {
    await extension.activate();
    await vscode.commands.executeCommand(DATA_WRANGLER_OPEN_COMMAND, handoff.csvUri);
    const message = 'Opened a temporary lossy CSV snapshot in Data Wrangler.';
    void vscode.window.showInformationMessage(message);
    return { created: true, launched: true, csvUri: handoff.csvUri, message };
  } catch (error) {
    diagnose('command-failed', error);
    const message = 'Data Wrangler could not open the temporary CSV. It was opened in VS Code instead.';
    await openCsvFallback(handoff.csvUri, message);
    return { created: true, launched: false, csvUri: handoff.csvUri, message, reason: 'commandFailed' };
  }
}

/** Create a complete RFC 4180-compatible UTF-8 CSV in a fresh temporary directory. */
export async function createDataWranglerCsvHandoff(
  _globalStorageUri: vscode.Uri,
  table: ColumnarPanelResult,
  options: DataWranglerHandoffOptions = {}
): Promise<DataWranglerCsvHandoff> {
  if (table.columns.length === 0) {
    throw new Error('Data Wrangler requires at least one displayed result column.');
  }
  assertNotCancelled(options);

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-kdb-data-wrangler-'));
  await bestEffortChmod(directory, 0o700);
  const csvPath = path.join(directory, `kx-result-${randomBytes(16).toString('hex')}.csv`);

  try {
    const headers = resolvedHeaders(table, options);
    const records: string[] = [headers.map(csvCell).join(',')];
    for (let rowIndex = 0; rowIndex < table.rowCount; rowIndex++) {
      assertNotCancelled(options);
      const cells: string[] = [];
      for (let columnIndex = 0; columnIndex < table.columns.length; columnIndex++) {
        const rendered = cellValueToBoundedCsvText(
          table.cellValue(rowIndex, columnIndex),
          DATA_WRANGLER_HANDOFF_MAX_CELL_TEXT_CHARS,
          options.cellTextOptions
        );
        if (rendered.truncated) {
          throw new DataWranglerHandoffLimitError(rowIndex, columnIndex);
        }
        cells.push(csvCell(rendered.text));
      }
      records.push(cells.join(','));
      if (rowIndex > 0 && rowIndex % 1000 === 0) {
        await new Promise<void>(resolve => setImmediate(resolve));
      }
    }
    assertNotCancelled(options);
    const csv = `${records.join('\r\n')}\r\n`;
    await fs.writeFile(csvPath, csv, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await bestEffortChmod(csvPath, 0o600);
    return {
      csvUri: vscode.Uri.file(csvPath),
      csvPath,
      rowCount: table.rowCount,
      columnCount: table.columns.length,
      byteCount: Buffer.byteLength(csv),
    };
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export function stableUniqueCsvHeaders(columns: readonly string[]): string[] {
  const used = new Set<string>();
  return columns.map(column => {
    const base = String(column) || 'column';
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${base}_${suffix++}`;
    }
    used.add(candidate);
    return candidate;
  });
}

export function dataWranglerLocalHandoffUnsupportedReason(
  context: vscode.ExtensionContext
): string | undefined {
  if (vscode.env.uiKind !== vscode.UIKind.Desktop) {
    return 'Open in Data Wrangler requires desktop VS Code.';
  }
  if (vscode.env.remoteName) {
    return 'Open in Data Wrangler is unavailable in a remote extension host.';
  }
  if (!context.globalStorageUri ||
      (context.globalStorageUri.scheme !== 'file' && context.globalStorageUri.scheme !== 'vscode-userdata')) {
    return 'Open in Data Wrangler requires local file-backed extension storage.';
  }
  return undefined;
}

function resolvedHeaders(
  table: ColumnarPanelResult,
  options: DataWranglerHandoffOptions
): string[] {
  if (options.sourceCsvHeaders && options.sourceColumnPositions &&
      options.sourceColumnPositions.length === table.columns.length) {
    return stableUniqueCsvHeaders(options.sourceColumnPositions.map(position =>
      String(options.sourceCsvHeaders?.[position] ?? table.columns[position] ?? 'column')));
  }
  const headers = options.csvHeaders?.length === table.columns.length
    ? options.csvHeaders
    : table.columns;
  return stableUniqueCsvHeaders(headers.map(String));
}

function assertNotCancelled(options: DataWranglerHandoffOptions): void {
  if (options.shouldCancel?.()) {
    throw new DataWranglerHandoffCancelledError();
  }
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

async function bestEffortChmod(target: string, mode: number): Promise<void> {
  if (process.platform === 'win32') {
    return;
  }
  await fs.chmod(target, mode).catch(error => diagnose('chmod-failed', error));
}

async function openCsvFallback(csvUri: vscode.Uri, message: string): Promise<void> {
  await vscode.window.showWarningMessage(message);
  try {
    await vscode.commands.executeCommand('vscode.open', csvUri);
  } catch (error) {
    diagnose('fallback-open-failed', error);
    await vscode.commands.executeCommand('revealFileInOS', csvUri).then(
      () => undefined,
      revealError => diagnose('fallback-reveal-failed', revealError)
    );
  }
}

function diagnose(event: string, error: unknown): void {
  if (!diagnosticWriter) {
    return;
  }
  const kind = error instanceof Error ? error.name : typeof error;
  diagnosticWriter(`[Data Wrangler] ${event} (${kind})`);
}
