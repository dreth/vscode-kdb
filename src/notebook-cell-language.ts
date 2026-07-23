export interface NotebookSelectionRange {
  start: number;
  end: number;
}

export interface NotebookLanguageDocument {
  readonly languageId: string;
}

export interface NotebookLanguageCell<TDocument extends NotebookLanguageDocument> {
  readonly index: number;
  readonly isCode: boolean;
  readonly document: TDocument;
}

export interface NotebookLanguageSuccess<TDocument extends NotebookLanguageDocument> {
  readonly index: number;
  readonly changed: boolean;
  readonly document: TDocument;
}

export interface NotebookLanguageFailure {
  readonly index: number;
  readonly message: string;
}

export interface NotebookLanguageResult<TDocument extends NotebookLanguageDocument> {
  readonly selected: number;
  readonly codeCells: number;
  readonly skippedNonCode: number;
  readonly changed: number;
  readonly unchanged: number;
  readonly successes: readonly NotebookLanguageSuccess<TDocument>[];
  readonly failures: readonly NotebookLanguageFailure[];
}

export type NotebookDocumentLanguageSetter<TDocument extends NotebookLanguageDocument> = (
  document: TDocument,
  languageId: string
) => PromiseLike<TDocument>;

export class NotebookCellLanguageProvider<TDocument extends NotebookLanguageDocument> {
  public constructor(private readonly setDocumentLanguage: NotebookDocumentLanguageSetter<TDocument>) {}

  public async setLanguage(
    selectedCells: readonly NotebookLanguageCell<TDocument>[],
    languageId: string
  ): Promise<NotebookLanguageResult<TDocument>> {
    const uniqueCells = new Map<number, NotebookLanguageCell<TDocument>>();
    for (const cell of selectedCells) {
      if (!uniqueCells.has(cell.index)) {
        uniqueCells.set(cell.index, cell);
      }
    }

    const successes: NotebookLanguageSuccess<TDocument>[] = [];
    const failures: NotebookLanguageFailure[] = [];
    let codeCells = 0;
    let skippedNonCode = 0;
    let changed = 0;
    let unchanged = 0;

    for (const cell of [...uniqueCells.values()].sort((left, right) => left.index - right.index)) {
      if (!cell.isCode) {
        skippedNonCode += 1;
        continue;
      }
      codeCells += 1;
      if (cell.document.languageId === languageId) {
        unchanged += 1;
        successes.push({ index: cell.index, changed: false, document: cell.document });
        continue;
      }
      try {
        const updatedDocument = await this.setDocumentLanguage(cell.document, languageId);
        if (updatedDocument.languageId !== languageId) {
          throw new Error(`VS Code returned language '${updatedDocument.languageId}' instead of '${languageId}'.`);
        }
        changed += 1;
        successes.push({ index: cell.index, changed: true, document: updatedDocument });
      } catch (error) {
        failures.push({
          index: cell.index,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      selected: uniqueCells.size,
      codeCells,
      skippedNonCode,
      changed,
      unchanged,
      successes,
      failures,
    };
  }
}

export function selectedNotebookCellIndexes(
  cellCount: number,
  selections: readonly NotebookSelectionRange[]
): number[] {
  const indexes = new Set<number>();
  for (const range of selections) {
    const start = Math.max(0, Math.min(cellCount, Math.trunc(range.start)));
    const rawEnd = range.end > range.start ? range.end : range.start + 1;
    const end = Math.max(start, Math.min(cellCount, Math.trunc(rawEnd)));
    for (let index = start; index < end; index += 1) {
      indexes.add(index);
    }
  }
  return [...indexes].sort((left, right) => left - right);
}

export function jupyterNotebookDefaultLanguageId(metadata: unknown): string | undefined {
  if (!isRecord(metadata)) {
    return undefined;
  }
  const notebookMetadata = isRecord(metadata.metadata) ? metadata.metadata : undefined;
  if (!notebookMetadata) {
    return undefined;
  }
  const languageInfo = isRecord(notebookMetadata.language_info)
    ? notebookMetadata.language_info
    : undefined;
  const kernelspec = isRecord(notebookMetadata.kernelspec)
    ? notebookMetadata.kernelspec
    : undefined;
  return normalizeJupyterLanguage(languageInfo?.name) ??
    normalizeJupyterLanguage(kernelspec?.language);
}

function normalizeJupyterLanguage(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  const aliases: Readonly<Record<string, string>> = {
    bash: 'shellscript',
    'c#': 'csharp',
    'f#': 'fsharp',
    ipython: 'python',
    python3: 'python',
    'q#': 'qsharp',
  };
  return aliases[normalized] ?? normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
