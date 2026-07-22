import { randomUUID } from 'crypto';

export const QUERY_HISTORY_STORAGE_KEY = 'vscode-kdb.queryHistory.v1';
export const DEFAULT_QUERY_HISTORY_MAX_ENTRIES = 100;
export const MIN_QUERY_HISTORY_MAX_ENTRIES = 1;
export const MAX_QUERY_HISTORY_MAX_ENTRIES = 1000;

export type HistoryExecutionKind = 'line' | 'selection' | 'script';
export type QueryHistoryStatus = 'succeeded' | 'failed' | 'canceled';
export type HistoryTransportKind = 'query' | 'script';

export interface QueryHistoryEntry {
  id: string;
  connectionId: string;
  connectionName: string;
  timestamp: number;
  kind: HistoryExecutionKind;
  status: QueryHistoryStatus;
  durationMs: number;
  queryText: string;
}

export type QueryHistoryRecordInput = Omit<QueryHistoryEntry, 'id' | 'timestamp'> & {
  timestamp?: number;
};

export interface MementoLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

export interface QueryHistoryStoreOptions {
  maxEntries?: unknown | (() => unknown);
  now?: () => number;
  createId?: () => string;
}

const HISTORY_EXECUTION_KINDS = new Set<HistoryExecutionKind>(['line', 'selection', 'script']);
const QUERY_HISTORY_STATUSES = new Set<QueryHistoryStatus>(['succeeded', 'failed', 'canceled']);
const MAX_DATE_TIMESTAMP_MS = 8_640_000_000_000_000;

export function safeHistoryLimit(
  value: unknown,
  fallback: number = DEFAULT_QUERY_HISTORY_MAX_ENTRIES
): number {
  const safeFallback = isValidHistoryLimit(fallback)
    ? fallback
    : DEFAULT_QUERY_HISTORY_MAX_ENTRIES;
  return isValidHistoryLimit(value) ? value : safeFallback;
}

export function normalizeQueryHistoryEntry(value: unknown): QueryHistoryEntry | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = nonemptyString(value.id);
  const connectionId = nonemptyString(value.connectionId);
  const connectionName = nonemptyString(value.connectionName);
  const timestamp = value.timestamp;
  const kind = value.kind;
  const status = value.status;
  const durationMs = value.durationMs;
  const queryText = value.queryText;

  if (
    id === undefined ||
    connectionId === undefined ||
    connectionName === undefined ||
    !Number.isSafeInteger(timestamp) ||
    (timestamp as number) < 0 ||
    (timestamp as number) > MAX_DATE_TIMESTAMP_MS ||
    typeof kind !== 'string' ||
    !HISTORY_EXECUTION_KINDS.has(kind as HistoryExecutionKind) ||
    typeof status !== 'string' ||
    !QUERY_HISTORY_STATUSES.has(status as QueryHistoryStatus) ||
    typeof durationMs !== 'number' ||
    !Number.isFinite(durationMs) ||
    durationMs < 0 ||
    typeof queryText !== 'string' ||
    queryText.length === 0
  ) {
    return undefined;
  }

  return {
    id,
    connectionId,
    connectionName,
    timestamp: timestamp as number,
    kind: kind as HistoryExecutionKind,
    status: status as QueryHistoryStatus,
    durationMs,
    queryText,
  };
}

export function sortHistoryNewestFirst(
  entries: readonly QueryHistoryEntry[]
): QueryHistoryEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => right.entry.timestamp - left.entry.timestamp || left.index - right.index)
    .map(({ entry }) => ({ ...entry }));
}

export function normalizeQueryHistoryEntries(
  value: unknown,
  limit: unknown = DEFAULT_QUERY_HISTORY_MAX_ENTRIES
): QueryHistoryEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .map(normalizeQueryHistoryEntry)
    .filter((entry): entry is QueryHistoryEntry => entry !== undefined);
  const sorted = sortHistoryNewestFirst(normalized);
  const unique: QueryHistoryEntry[] = [];
  const ids = new Set<string>();
  for (const entry of sorted) {
    if (ids.has(entry.id)) {
      continue;
    }
    ids.add(entry.id);
    unique.push(entry);
  }
  return unique.slice(0, safeHistoryLimit(limit));
}

export function historyTransportKind(
  entry: Pick<QueryHistoryEntry, 'kind' | 'queryText'>
): HistoryTransportKind;
export function historyTransportKind(
  kind: HistoryExecutionKind,
  queryText?: string
): HistoryTransportKind;
export function historyTransportKind(
  entryOrKind: Pick<QueryHistoryEntry, 'kind' | 'queryText'> | HistoryExecutionKind,
  queryText = ''
): HistoryTransportKind {
  const kind = typeof entryOrKind === 'string' ? entryOrKind : entryOrKind.kind;
  const text = typeof entryOrKind === 'string' ? queryText : entryOrKind.queryText;
  return kind === 'script' || (kind === 'selection' && /[\r\n]/.test(text))
    ? 'script'
    : 'query';
}

export function historyRerunRequiresConfirmation(
  recordedConnectionId: string,
  targetConnectionId: string
): boolean {
  return recordedConnectionId !== targetConnectionId;
}

export class QueryHistoryStore {
  private readonly now: () => number;
  private readonly createId: () => string;
  private generation = 0;
  private mutationQueue: Promise<void> = Promise.resolve();

  public constructor(
    private readonly memento: MementoLike,
    private readonly options: QueryHistoryStoreOptions = {}
  ) {
    this.now = options.now || Date.now;
    this.createId = options.createId || randomUUID;
  }

  public entries(): QueryHistoryEntry[] {
    return normalizeQueryHistoryEntries(
      this.memento.get<unknown>(QUERY_HISTORY_STORAGE_KEY),
      this.maxEntries()
    );
  }

  public captureGeneration(): number {
    return this.generation;
  }

  public async record(
    input: QueryHistoryRecordInput,
    generation: number
  ): Promise<QueryHistoryEntry | undefined> {
    if (generation !== this.generation) {
      return undefined;
    }

    const entry = normalizeQueryHistoryEntry({
      id: this.createId(),
      timestamp: input.timestamp === undefined ? this.now() : input.timestamp,
      connectionId: input.connectionId,
      connectionName: input.connectionName,
      kind: input.kind,
      status: input.status,
      durationMs: input.durationMs,
      queryText: input.queryText,
    });
    if (!entry) {
      throw new Error('Cannot record an invalid KX query history entry.');
    }

    return this.mutate(async () => {
      if (generation !== this.generation) {
        return undefined;
      }
      const previousEntries = this.entries();
      const entries = normalizeQueryHistoryEntries(
        [entry, ...previousEntries],
        this.maxEntries()
      );
      await this.write(entries);
      if (generation !== this.generation) {
        await this.write(previousEntries);
        return undefined;
      }
      return { ...entry };
    });
  }

  public async delete(id: string): Promise<boolean> {
    if (!id) {
      return false;
    }
    return this.mutate(async () => {
      const entries = this.entries();
      const retained = entries.filter(entry => entry.id !== id);
      if (retained.length === entries.length) {
        return false;
      }
      await this.write(retained);
      return true;
    });
  }

  public clear(): Promise<void> {
    this.invalidatePending();
    return this.mutate(() => this.write([]));
  }

  public invalidatePending(): number {
    this.generation += 1;
    return this.generation;
  }

  public prune(limit?: unknown): Promise<QueryHistoryEntry[]> {
    return this.mutate(async () => {
      const entries = normalizeQueryHistoryEntries(
        this.memento.get<unknown>(QUERY_HISTORY_STORAGE_KEY),
        limit === undefined ? this.maxEntries() : safeHistoryLimit(limit, this.maxEntries())
      );
      await this.write(entries);
      return entries.map(entry => ({ ...entry }));
    });
  }

  private maxEntries(): number {
    const configured = typeof this.options.maxEntries === 'function'
      ? this.options.maxEntries()
      : this.options.maxEntries;
    return safeHistoryLimit(configured);
  }

  private async write(entries: readonly QueryHistoryEntry[]): Promise<void> {
    await this.memento.update(
      QUERY_HISTORY_STORAGE_KEY,
      entries.length ? entries.map(entry => ({ ...entry })) : undefined
    );
  }

  private mutate<T>(action: () => Promise<T>): Promise<T> {
    const mutation = this.mutationQueue.then(action, action);
    this.mutationQueue = mutation.then(() => undefined, () => undefined);
    return mutation;
  }
}

function isValidHistoryLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) &&
    value >= MIN_QUERY_HISTORY_MAX_ENTRIES && value <= MAX_QUERY_HISTORY_MAX_ENTRIES;
}

function nonemptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is { [key: string]: unknown } {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
