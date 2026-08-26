import {
  CompletionItem,
  CompletionItemKind,
  Hover,
  MarkupKind,
  Position,
  Range,
  TextEdit,
} from 'vscode-languageserver/node';

import { QSource, tokenRange } from './q-source';

export const Q_METADATA_REQUEST_METHOD = 'vscode-kdb/qMetadata';
export const Q_METADATA_REFRESH_METHOD = 'vscode-kdb/qMetadataRefresh';
export const Q_METADATA_INVALIDATED_NOTIFICATION = 'vscode-kdb/qMetadataInvalidated';
export const Q_METADATA_TTL_MS = 30_000;
export const Q_METADATA_MAX_ROOT_ITEMS = 5_000;
export const Q_METADATA_MAX_COLUMNS = 2_000;
export const Q_METADATA_MAX_BYTES = 1_048_576;

export interface RuntimeMetadataSnapshot {
  readonly connectionId: string;
  readonly namespace: string;
  readonly generation: number;
}

export interface RuntimeVariable {
  readonly name: string;
  readonly kind: 'variable' | 'function';
  readonly qType?: number;
}

export interface RuntimeColumn {
  readonly name: string;
  readonly qTypeCode: string;
  readonly qTypeName: string;
  readonly foreignKey: string;
  readonly attribute: string;
}

export interface RuntimeRootMetadata {
  readonly version: 1;
  readonly kind: 'root';
  readonly snapshot: RuntimeMetadataSnapshot;
  readonly tables: readonly string[];
  readonly variables: readonly RuntimeVariable[];
}

export interface RuntimeTableMetadata {
  readonly version: 1;
  readonly kind: 'table';
  readonly snapshot: RuntimeMetadataSnapshot;
  readonly table: string;
  readonly columns: readonly RuntimeColumn[];
}

export function parseRuntimeRoot(value: unknown): RuntimeRootMetadata | undefined {
  if (!withinByteLimit(value) || !isRecord(value) || value.version !== 1 ||
    value.kind !== 'root' || !validSnapshot(value.snapshot) ||
    !Array.isArray(value.tables) || !Array.isArray(value.variables) ||
    value.tables.length + value.variables.length > Q_METADATA_MAX_ROOT_ITEMS) return undefined;
  const tables: string[] = [];
  for (const item of value.tables) {
    if (!validIdentifier(item)) return undefined;
    if (!tables.includes(item)) tables.push(item);
  }
  const variables: RuntimeVariable[] = [];
  for (const item of value.variables) {
    if (!isRecord(item) || !validIdentifier(item.name) ||
      (item.kind !== 'variable' && item.kind !== 'function') ||
      (item.qType !== undefined && (!Number.isInteger(item.qType) ||
        (item.qType as number) < -128 || (item.qType as number) > 127))) return undefined;
    if (!variables.some(value => value.name === item.name)) {
      variables.push(Object.freeze({
        name: item.name,
        kind: item.kind,
        ...(item.qType === undefined ? {} : { qType: item.qType as number }),
      }));
    }
  }
  return Object.freeze({
    version: 1,
    kind: 'root',
    snapshot: freezeSnapshot(value.snapshot),
    tables: Object.freeze(tables),
    variables: Object.freeze(variables),
  });
}

export function parseRuntimeTable(value: unknown): RuntimeTableMetadata | undefined {
  if (!withinByteLimit(value) || !isRecord(value) || value.version !== 1 ||
    value.kind !== 'table' || !validSnapshot(value.snapshot) ||
    !validIdentifier(value.table) || !Array.isArray(value.columns) ||
    value.columns.length > Q_METADATA_MAX_COLUMNS) return undefined;
  const columns: RuntimeColumn[] = [];
  for (const item of value.columns) {
    if (!isRecord(item) || !safeMetadataText(item.name, 512) ||
      !safeMetadataText(item.qTypeCode, 16, true) ||
      !safeMetadataText(item.qTypeName, 128) ||
      !safeMetadataText(item.foreignKey, 512, true) ||
      !safeMetadataText(item.attribute, 128, true)) return undefined;
    columns.push(Object.freeze({
      name: item.name as string,
      qTypeCode: item.qTypeCode as string,
      qTypeName: item.qTypeName as string,
      foreignKey: item.foreignKey as string,
      attribute: item.attribute as string,
    }));
  }
  return Object.freeze({
    version: 1,
    kind: 'table',
    snapshot: freezeSnapshot(value.snapshot),
    table: value.table,
    columns: Object.freeze(columns),
  });
}

export function sameRuntimeSnapshot(
  left: RuntimeMetadataSnapshot,
  right: RuntimeMetadataSnapshot,
): boolean {
  return left.connectionId === right.connectionId && left.namespace === right.namespace &&
    left.generation === right.generation;
}

export function runtimeCompletions(
  source: QSource,
  position: Position,
  root: RuntimeRootMetadata | undefined,
  table: RuntimeTableMetadata | undefined,
): readonly CompletionItem[] {
  if ((!root && !table) || source.protectedAt(position)) return [];
  const offset = source.offsetAt(position);
  const lineStart = source.lineStarts[position.line] ?? 0;
  const before = source.text.slice(lineStart, offset);
  const prefix = before.match(/[.A-Za-z][.A-Za-z0-9_]*$/)?.[0] ?? '';
  const editRange = Range.create(
    position.line,
    Math.max(0, position.character - prefix.length),
    position.line,
    position.character
  );
  const values = new Map<string, CompletionItem>();
  const add = (label: string, kind: CompletionItemKind, detail: string): void => {
    if (prefix && !label.toLowerCase().startsWith(prefix.toLowerCase())) return;
    values.set(label, {
      label,
      kind,
      detail,
      documentation: {
        kind: MarkupKind.Markdown,
        value: `Runtime metadata from active namespace \`${root?.snapshot.namespace ?? table?.snapshot.namespace}\`. No value query was performed.`,
      },
      textEdit: TextEdit.replace(editRange, label),
      sortText: `2-${label}`,
      data: { source: 'runtime-metadata' },
    });
  };
  if (root) {
    root.tables.forEach(name => add(name, CompletionItemKind.Struct, 'q table (runtime metadata)'));
    root.variables.forEach(item => add(
      item.name,
      item.kind === 'function' ? CompletionItemKind.Function : CompletionItemKind.Variable,
      `${item.kind === 'function' ? 'q function' : qTypeLabel(item.qType)} (runtime metadata)`
    ));
  }
  if (table && qSqlTableAt(source, position) === table.table) {
    table.columns.forEach(column => {
      if (validIdentifier(column.name)) {
        add(column.name, CompletionItemKind.Field, `${column.qTypeName} column of ${table.table} (runtime metadata)`);
      }
    });
  }
  return [...values.values()];
}

export function runtimeHover(
  source: QSource,
  position: Position,
  root: RuntimeRootMetadata | undefined,
): Hover | null {
  if (!root || source.protectedAt(position)) return null;
  const token = source.tokenAt(position);
  if (!token) return null;
  const table = root.tables.includes(token.image);
  const variable = root.variables.find(value => value.name === token.image);
  if (!table && !variable) return null;
  const description = table
    ? 'q table'
    : variable!.kind === 'function'
      ? 'q function'
      : qTypeLabel(variable!.qType);
  return {
    range: tokenRange(token),
    contents: {
      kind: MarkupKind.Markdown,
      value: `**${description}** — runtime metadata from active namespace \`${root.snapshot.namespace}\`.\n\nNo value or preview query was performed.`,
    },
  };
}

export function qSqlTableAt(source: QSource, position: Position): string | undefined {
  if (source.protectedAt(position)) return undefined;
  const offset = source.offsetAt(position);
  const start = Math.max(
    source.text.lastIndexOf('\n', Math.max(0, offset - 1)),
    source.text.lastIndexOf(';', Math.max(0, offset - 1))
  ) + 1;
  const nextLine = source.text.indexOf('\n', offset);
  const nextSemi = source.text.indexOf(';', offset);
  const ends = [nextLine, nextSemi].filter(value => value >= 0);
  const end = ends.length ? Math.min(...ends) : source.text.length;
  const statement = source.text.slice(start, end);
  if (!/\b(?:select|exec|update|delete)\b/.test(statement)) return undefined;
  return statement.match(/\bfrom\s+([A-Za-z][A-Za-z0-9_]*)\b/)?.[1];
}

function qTypeLabel(value: number | undefined): string {
  if (value === undefined) return 'q variable';
  const types: Record<number, string> = {
    0: 'q general list', 1: 'q boolean', 2: 'q guid', 4: 'q byte', 5: 'q short',
    6: 'q int', 7: 'q long', 8: 'q real', 9: 'q float', 10: 'q char',
    11: 'q symbol', 12: 'q timestamp', 13: 'q month', 14: 'q date',
    15: 'q datetime', 16: 'q timespan', 17: 'q minute', 18: 'q second',
    19: 'q time', 98: 'q table', 99: 'q dictionary', 100: 'q lambda',
  };
  return types[Math.abs(value)] ?? `q type ${value}`;
}

function validSnapshot(value: unknown): value is RuntimeMetadataSnapshot {
  return isRecord(value) && typeof value.connectionId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.connectionId) &&
    typeof value.namespace === 'string' && value.namespace.length > 0 &&
    value.namespace.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value.namespace) &&
    Number.isSafeInteger(value.generation) && (value.generation as number) >= 0;
}

function freezeSnapshot(value: RuntimeMetadataSnapshot): RuntimeMetadataSnapshot {
  return Object.freeze({
    connectionId: value.connectionId,
    namespace: value.namespace,
    generation: value.generation,
  });
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,254}$/.test(value);
}

function safeMetadataText(value: unknown, maximum: number, empty = false): value is string {
  return typeof value === 'string' && value.length <= maximum &&
    (empty || value.length > 0) && !/[\u0000-\u001f\u007f]/.test(value);
}

function withinByteLimit(value: unknown): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8') <= Q_METADATA_MAX_BYTES;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
