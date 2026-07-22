import {
  DEFAULT_NOTEBOOK_BYTE_LIMIT,
  DEFAULT_NOTEBOOK_ROW_LIMIT,
  MAX_NOTEBOOK_BYTE_LIMIT,
  MAX_NOTEBOOK_ROW_LIMIT,
  MIN_NOTEBOOK_BYTE_LIMIT,
  MIN_NOTEBOOK_ROW_LIMIT,
} from './notebook-contract';

export type NotebookPresentation = 'inline' | 'panel' | 'both';

export interface NotebookSettings {
  presentation: NotebookPresentation;
  rowLimit: number;
  byteLimit: number;
}

export function safeNotebookPresentation(value: unknown): NotebookPresentation {
  return value === 'panel' || value === 'both' ? value : 'inline';
}

export function safeNotebookRowLimit(value: unknown): number {
  return safeInteger(
    value,
    DEFAULT_NOTEBOOK_ROW_LIMIT,
    MIN_NOTEBOOK_ROW_LIMIT,
    MAX_NOTEBOOK_ROW_LIMIT
  );
}

export function safeNotebookByteLimit(value: unknown): number {
  return safeInteger(
    value,
    DEFAULT_NOTEBOOK_BYTE_LIMIT,
    MIN_NOTEBOOK_BYTE_LIMIT,
    MAX_NOTEBOOK_BYTE_LIMIT
  );
}

export function hasNotebookQMarker(source: string): boolean {
  return /^\uFEFF?%%q(?:\s|$)/.test(source);
}

export function notebookQMagicLine(settings: Pick<NotebookSettings, 'rowLimit' | 'byteLimit'>): string {
  return `%%q --max-rows ${settings.rowLimit} --max-bytes ${settings.byteLimit}`;
}

function safeInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}
