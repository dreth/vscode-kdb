import type { QTable, QValue } from './q-ipc';

export const DEFAULT_SERVER_PREVIEW_CELL_LIMIT = 10_000;
export const MIN_SERVER_PREVIEW_CELL_LIMIT = 1;
export const MAX_SERVER_PREVIEW_CELL_LIMIT = 1_000_000;

export const SERVER_TABLES_QUERY = 'string tables[]';
export const SERVER_VARIABLES_QUERY = `{[]
  names:key \`$string system "d";
  names:names where 0<count each string names;
  names:names except tables[];
  types:{@[{type value x};x;{0Nh}]} each names;
  flip \`name\`type!(string names;types)
}[]`;

export type ServerObjectKind = 'table' | 'variable' | 'function';

export interface ServerVariableMetadata {
  name: string;
  kind: 'variable' | 'function';
  qType?: number;
}

export interface ServerColumnMetadata {
  name: string;
  qTypeCode: string;
  qTypeName: string;
  foreignKey: string;
  attribute: string;
}

export interface ParsedServerNames {
  names: string[];
  omittedUnsafeNames: number;
}

export interface ParsedServerVariables {
  variables: ServerVariableMetadata[];
  omittedUnsafeNames: number;
}

export interface ServerExplorerSnapshot {
  connectionId: string;
  namespace: string;
}

export function safeServerPreviewCellLimit(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) &&
    value >= MIN_SERVER_PREVIEW_CELL_LIMIT && value <= MAX_SERVER_PREVIEW_CELL_LIMIT
    ? value
    : DEFAULT_SERVER_PREVIEW_CELL_LIMIT;
}

export function validateServerObjectIdentifier(value: unknown): string {
  const identifier = String(value === undefined || value === null ? '' : value);
  if (!/^[A-Za-z][A-Za-z0-9_]{0,254}$/.test(identifier)) {
    throw new Error('Server Explorer supports standard q identifiers up to 255 characters.');
  }
  return identifier;
}

export function buildServerTableMetaQuery(name: unknown): string {
  return `0!meta \`${validateServerObjectIdentifier(name)}`;
}

export function buildServerPreviewQuery(
  name: unknown,
  kind: ServerObjectKind,
  configuredLimit: unknown
): string {
  const identifier = validateServerObjectIdentifier(name);
  const limit = safeServerPreviewCellLimit(configuredLimit);
  if (kind !== 'table' && kind !== 'variable') {
    throw new Error('Server Explorer previews are limited to tables and variables.');
  }
  if (kind === 'table') {
    return `{[objectName;limit]
  objectValue:value objectName;
  (limit div 1|count cols objectName)#objectValue
}[\`${identifier};${limit}]`;
  }
  return `{[objectName;limit]
  objectValue:value objectName;
  objectType:type objectValue;
  if[objectType>=100h;'"Function and projection previews are disabled."];
  $[98h=objectType;(limit div 1|count cols objectName)#objectValue;
    99h=objectType;$[98h=type key objectValue;(limit div 1|count cols objectName)#objectValue;limit#objectValue];
    objectType<0h;objectValue;
    objectType<98h;limit#objectValue;
    objectValue]
}[\`${identifier};${limit}]`;
}

export function serverPreviewWarning(
  name: string,
  kind: ServerObjectKind,
  namespace: string,
  configuredLimit: unknown
): string {
  const identifier = validateServerObjectIdentifier(name);
  const limit = safeServerPreviewCellLimit(configuredLimit).toLocaleString('en-US');
  if (kind !== 'table' && kind !== 'variable') {
    throw new Error('Server Explorer previews are limited to tables and variables.');
  }
  if (kind === 'table') {
    return `Preview table "${identifier}" from namespace ${namespace}? ` +
      `Table rows are capped server-side to approximately ${limit} cells; nested values can still be large.`;
  }
  return `Preview ${kind} "${identifier}" from namespace ${namespace}? ` +
    `Lists and dictionaries are capped to ${limit} outer items, but scalars and nested values may still be large. ` +
    'Functions and projections are metadata-only.';
}

export function parseServerTableNames(value: QValue): ParsedServerNames {
  const candidates = stringCandidates(value);
  const names: string[] = [];
  let omittedUnsafeNames = 0;
  for (const candidate of candidates) {
    try {
      const name = validateServerObjectIdentifier(candidate);
      if (!names.includes(name)) {
        names.push(name);
      }
    } catch {
      omittedUnsafeNames++;
    }
  }
  names.sort((left, right) => left.localeCompare(right));
  return { names, omittedUnsafeNames };
}

export function parseServerVariables(value: QValue): ParsedServerVariables {
  const table = qTable(value);
  if (!table || !table.columns.includes('name') || !table.columns.includes('type')) {
    throw new Error('q returned an unexpected variables metadata shape.');
  }
  const variables: ServerVariableMetadata[] = [];
  let omittedUnsafeNames = 0;
  for (const row of table.rows) {
    try {
      const name = validateServerObjectIdentifier(row.name);
      const qType = typeof row.type === 'number' && Number.isInteger(row.type)
        ? row.type
        : undefined;
      const kind = qType !== undefined && qType >= 100 && qType <= 112
        ? 'function'
        : 'variable';
      if (!variables.some(item => item.name === name)) {
        variables.push({ name, kind, ...(qType === undefined ? {} : { qType }) });
      }
    } catch {
      omittedUnsafeNames++;
    }
  }
  variables.sort((left, right) => left.name.localeCompare(right.name));
  return { variables, omittedUnsafeNames };
}

export function parseServerColumns(value: QValue): ServerColumnMetadata[] {
  const table = qTable(value);
  if (!table || !table.columns.includes('c') || !table.columns.includes('t')) {
    throw new Error('q returned an unexpected meta shape.');
  }
  return table.rows.map((row, index) => {
    const name = safeMetadataText(row.c, `column ${index + 1}`);
    const qTypeCode = safeMetadataText(row.t, '');
    return {
      name,
      qTypeCode,
      qTypeName: qMetaTypeName(qTypeCode),
      foreignKey: safeMetadataText(row.f, ''),
      attribute: safeMetadataText(row.a, ''),
    };
  });
}

export function serverExplorerSnapshotMatches(
  snapshot: ServerExplorerSnapshot,
  activeConnectionId: string | undefined,
  activeNamespace: string | undefined,
  connected: boolean
): boolean {
  return connected && snapshot.connectionId === activeConnectionId &&
    snapshot.namespace === activeNamespace;
}

export function qMetaTypeName(code: string): string {
  const names: Record<string, string> = {
    b: 'boolean',
    g: 'guid',
    x: 'byte',
    h: 'short',
    i: 'int',
    j: 'long',
    e: 'real',
    f: 'float',
    c: 'char',
    s: 'symbol',
    p: 'timestamp',
    m: 'month',
    d: 'date',
    z: 'datetime',
    n: 'timespan',
    u: 'minute',
    v: 'second',
    t: 'time',
    ' ': 'untyped',
  };
  return names[code] || (code ? `q type ${code}` : 'unknown');
}

function stringCandidates(value: QValue): string[] {
  if (typeof value === 'string') {
    return value ? [value] : [];
  }
  if (!Array.isArray(value)) {
    throw new Error('q returned an unexpected table-list shape.');
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function qTable(value: QValue): QTable | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    'qtype' in value && value.qtype === 'table'
    ? value as QTable
    : undefined;
}

function safeMetadataText(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value : fallback;
  const withoutControls = text.replace(/[\u0000-\u001f\u007f]/g, '');
  return (withoutControls || fallback).slice(0, 512);
}
