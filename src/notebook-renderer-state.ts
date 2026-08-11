export interface NotebookRendererStateIdentity {
  readonly outputId: string;
  readonly renderGeneration: number;
}

export interface DetachedNotebookRendererState<T> {
  readonly key: string;
  readonly state: T;
}

export interface NotebookRendererColumnOrderSnapshot {
  readonly outputId: string;
  readonly savedSchema: readonly string[];
  readonly savedOrdinals: readonly number[];
  readonly savedWidths?: readonly (readonly [number, number])[];
  readonly liveId?: string;
  readonly liveSchema: readonly string[];
  readonly liveOrdinals: readonly number[];
  readonly liveWidths?: readonly (readonly [number, number])[];
}

/**
 * Re-key source-ordinal widths by logical column identity. Duplicate names are
 * matched by occurrence so a schema insertion or reorder cannot attach a width
 * to an unrelated source ordinal.
 */
export function reconciledNotebookColumnWidths(
  previousSchema: readonly string[],
  previousWidths: readonly (readonly [number, number])[],
  nextSchema: readonly string[]
): Map<number, number> {
  const widthsByPreviousOrdinal = new Map<number, number>();
  for (const [ordinalValue, widthValue] of previousWidths) {
    const ordinal = Number(ordinalValue);
    const width = Number(widthValue);
    if (Number.isSafeInteger(ordinal) && ordinal >= 0 && ordinal < previousSchema.length &&
      Number.isFinite(width)) {
      widthsByPreviousOrdinal.set(ordinal, width);
    }
  }

  const occurrences = new Map<string, number>();
  const widthsByIdentity = new Map<string, number>();
  previousSchema.forEach((column, ordinal) => {
    const occurrence = occurrences.get(column) || 0;
    occurrences.set(column, occurrence + 1);
    const width = widthsByPreviousOrdinal.get(ordinal);
    if (width !== undefined) {
      widthsByIdentity.set(`${column}\0${occurrence}`, width);
    }
  });

  occurrences.clear();
  const reconciled = new Map<number, number>();
  nextSchema.forEach((column, ordinal) => {
    const occurrence = occurrences.get(column) || 0;
    occurrences.set(column, occurrence + 1);
    const width = widthsByIdentity.get(`${column}\0${occurrence}`);
    if (width !== undefined) {
      reconciled.set(ordinal, width);
    }
  });
  return reconciled;
}

export function notebookChartViewportInteractionBlocked(
  source: 'live' | 'saved' | undefined,
  liveChartDirty: boolean
): boolean {
  return source === 'live' && liveChartDirty;
}

export function notebookRendererStateKey(identity: NotebookRendererStateIdentity): string {
  return `${identity.outputId}:${identity.renderGeneration}`;
}

export class NotebookRendererStateRegistry<T> {
  private readonly states = new Map<string, T>();
  private readonly outputItemKeys = new Map<string, string>();

  public bind(outputItemId: string, identity: NotebookRendererStateIdentity, state: T): void {
    const key = notebookRendererStateKey(identity);
    if (this.outputItemKeys.has(outputItemId) || this.states.has(key)) {
      throw new Error('Notebook renderer state must be detached before rebinding an identity.');
    }
    this.states.set(key, state);
    this.outputItemKeys.set(outputItemId, key);
  }

  public get(identity: NotebookRendererStateIdentity): T | undefined {
    return this.states.get(notebookRendererStateKey(identity));
  }

  public takeOutputItem(outputItemId: string): DetachedNotebookRendererState<T> | undefined {
    const key = this.outputItemKeys.get(outputItemId);
    return key ? this.takeKey(key) : undefined;
  }

  public takeKey(key: string): DetachedNotebookRendererState<T> | undefined {
    const state = this.states.get(key);
    if (!state) {
      return undefined;
    }
    this.states.delete(key);
    for (const [outputItemId, candidate] of this.outputItemKeys) {
      if (candidate === key) {
        this.outputItemKeys.delete(outputItemId);
        break;
      }
    }
    return { key, state };
  }

  public keys(): string[] {
    return [...this.states.keys()];
  }

  public forEach(callback: (state: T) => void): void {
    this.states.forEach(callback);
  }
}

export class NotebookRendererColumnOrderCache {
  private readonly snapshots = new Map<string, NotebookRendererColumnOrderSnapshot>();

  public constructor(private readonly maxEntries = 512) {}

  public remember(snapshot: NotebookRendererColumnOrderSnapshot): void {
    const copy = cloneColumnOrderSnapshot(snapshot);
    this.snapshots.delete(copy.outputId);
    this.snapshots.set(copy.outputId, copy);
    const limit = Math.max(1, Math.floor(this.maxEntries));
    while (this.snapshots.size > limit) {
      const oldest = this.snapshots.keys().next().value as string | undefined;
      if (oldest === undefined) {
        break;
      }
      this.snapshots.delete(oldest);
    }
  }

  public get(outputId: string): NotebookRendererColumnOrderSnapshot | undefined {
    const snapshot = this.snapshots.get(outputId);
    if (!snapshot) {
      return undefined;
    }
    this.snapshots.delete(outputId);
    this.snapshots.set(outputId, snapshot);
    return cloneColumnOrderSnapshot(snapshot);
  }

  public clear(): void {
    this.snapshots.clear();
  }

  public keys(): string[] {
    return [...this.snapshots.keys()];
  }
}

function cloneColumnOrderSnapshot(
  snapshot: NotebookRendererColumnOrderSnapshot
): NotebookRendererColumnOrderSnapshot {
  return {
    outputId: snapshot.outputId,
    savedSchema: snapshot.savedSchema.slice(),
    savedOrdinals: snapshot.savedOrdinals.slice(),
    savedWidths: (snapshot.savedWidths || []).map(([ordinal, width]) => [ordinal, width]),
    ...(snapshot.liveId ? { liveId: snapshot.liveId } : {}),
    liveSchema: snapshot.liveSchema.slice(),
    liveOrdinals: snapshot.liveOrdinals.slice(),
    liveWidths: (snapshot.liveWidths || []).map(([ordinal, width]) => [ordinal, width]),
  };
}
