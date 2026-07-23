import { NotebookSettings, hasNotebookQMarker, notebookQMagicLine } from './notebook-settings';

export const KX_NOTEBOOK_METADATA_KEY = 'vscode-kdb';
export const KX_NOTEBOOK_METADATA_VERSION = 1;

export interface NotebookQMarkerInsertion {
  readonly character: number;
  readonly text: string;
}

export function notebookQMarkerInsertion(
  source: string,
  settings: Pick<NotebookSettings, 'rowLimit' | 'byteLimit'>
): NotebookQMarkerInsertion | undefined {
  if (hasNotebookQMarker(source)) {
    return undefined;
  }
  return {
    character: source.startsWith('\uFEFF') ? 1 : 0,
    text: `${notebookQMagicLine(settings)}\n`,
  };
}

export function preparedNotebookQCellMetadata(
  metadata: Readonly<Record<string, unknown>>,
  settings: Pick<NotebookSettings, 'rowLimit' | 'byteLimit'>
): Record<string, unknown> {
  const persistedCellMetadata = isRecord(metadata.metadata) ? metadata.metadata : {};
  const currentKxMetadata = isRecord(persistedCellMetadata[KX_NOTEBOOK_METADATA_KEY])
    ? persistedCellMetadata[KX_NOTEBOOK_METADATA_KEY]
    : {};
  return {
    ...metadata,
    metadata: {
      ...persistedCellMetadata,
      [KX_NOTEBOOK_METADATA_KEY]: {
        ...currentKxMetadata,
        version: KX_NOTEBOOK_METADATA_VERSION,
        language: 'q',
        marker: '%%q',
        rowLimit: settings.rowLimit,
        byteLimit: settings.byteLimit,
      },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
