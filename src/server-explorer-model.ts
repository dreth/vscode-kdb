import type { QTable, QValue } from './q-ipc';
import { isQRuntimeValue, qValueToSemanticPrimitive } from './q-value';

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

export const RUNTIME_PROCESS_ROOT_QUERY = `{[]
  rootNames:key \`.;
  rootNames:rootNames where 0<count each string rootNames;
  namespaceNames:key \`;
  namespaceNames:namespaceNames where 0<count each string namespaceNames;
  rootTypes:{@[{type value x};x;{0Nh}]} each rootNames;
  names:(string rootNames),string namespaceNames;
  types:rootTypes,(count namespaceNames)#enlist 99h;
  namespaces:(count rootNames)#enlist 0b;
  namespaces:namespaces,(count namespaceNames)#enlist 1b;
  flip \`name\`type\`namespace!(names;types;namespaces)
}[]`;

export const MAX_RUNTIME_QUALIFIED_NAME_LENGTH = 4_096;

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

export type RuntimeBindingKind =
  | 'namespace'
  | 'table'
  | 'variable'
  | 'function'
  | 'projection'
  | 'unknown';

export interface RuntimeBindingMetadata {
  readonly context: string;
  readonly name: string;
  readonly qualifiedName: string;
  readonly kind: RuntimeBindingKind;
  readonly qType?: number;
}

export interface ParsedRuntimeBindings {
  readonly bindings: RuntimeBindingMetadata[];
  readonly omittedUnsafeNames: number;
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

export function validateRuntimeContext(value: unknown): string {
  const context = String(value === undefined || value === null ? '' : value);
  if (context === '.') return context;
  if (context.length > MAX_RUNTIME_QUALIFIED_NAME_LENGTH ||
    !/^\.[A-Za-z][A-Za-z0-9_]{0,254}(?:\.[A-Za-z][A-Za-z0-9_]{0,254})*$/.test(context)) {
    throw new Error('KX Variables supports qualified q namespaces with standard identifier segments.');
  }
  return context;
}

export function qualifyRuntimeBinding(contextValue: unknown, nameValue: unknown): string {
  const context = validateRuntimeContext(contextValue);
  const name = validateServerObjectIdentifier(nameValue);
  const qualified = context === '.' ? name : `${context}.${name}`;
  if (qualified.length > MAX_RUNTIME_QUALIFIED_NAME_LENGTH) {
    throw new Error('KX Variables qualified object name is too long.');
  }
  return qualified;
}

export function buildRuntimeContextQuery(contextValue: unknown): string {
  const context = validateRuntimeContext(contextValue);
  if (context === '.') return RUNTIME_PROCESS_ROOT_QUERY;
  return `{[context]
  names:key context;
  names:names where 0<count each string names;
  prefix:string context;
  full:\`$(prefix,"."),/:string names;
  describe:{@[{[symbol]
    object:value symbol;
    objectType:type object;
    isNamespace:$[99h<>objectType;0b;not \` in key object;0b;101h=type object \`];
    (objectType;isNamespace)
  };x;{(0Nh;0b)}]};
  metadata:describe each full;
  flip \`name\`type\`namespace!(string names;first each metadata;last each metadata)
}[\`${context}]`;
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

export function buildRuntimeBindingPreviewQuery(
  contextValue: unknown,
  nameValue: unknown,
  kind: RuntimeBindingKind,
  configuredLimit: unknown
): string {
  const context = validateRuntimeContext(contextValue);
  const name = validateServerObjectIdentifier(nameValue);
  const qualifiedName = qualifyRuntimeBinding(context, name);
  const limit = safeServerPreviewCellLimit(configuredLimit);
  if (kind !== 'table' && kind !== 'variable') {
    throw new Error('KX Variables previews are limited to tables and data bindings.');
  }
  const qSymbol = context === '.' ? name : qualifiedName;
  const rootBinding = context === '.' ? '1b' : '0b';
  return `{[objectName;rootBinding;limit]
  objectValue:$[rootBinding;(value \`.) objectName;value objectName];
  objectType:type objectValue;
  if[objectType>=100h;'"Function and projection previews are disabled."];
  $[98h=objectType;(limit div 1|count cols objectValue)#objectValue;
    99h=objectType;$[98h=type key objectValue;(limit div 1|count cols objectValue)#objectValue;limit#objectValue];
    objectType<0h;objectValue;
    objectType<98h;limit#objectValue;
    objectValue]
}[\`${qSymbol};${rootBinding};${limit}]`;
}

export function runtimeBindingPreviewWarning(
  binding: RuntimeBindingMetadata,
  configuredLimit: unknown
): string {
  validateRuntimeBinding(binding);
  const limit = safeServerPreviewCellLimit(configuredLimit).toLocaleString('en-US');
  if (binding.kind !== 'table' && binding.kind !== 'variable') {
    throw new Error('KX Variables previews are limited to tables and data bindings.');
  }
  if (binding.kind === 'table') {
    return `Preview table "${binding.qualifiedName}"? ` +
      `Table rows are capped server-side to approximately ${limit} cells; nested values can still be large.`;
  }
  return `Preview data binding "${binding.qualifiedName}"? ` +
    `Lists and dictionaries are capped to ${limit} outer items, but scalars and nested values may still be large. ` +
    'Functions and projections are metadata-only.';
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

export function parseRuntimeBindings(
  value: QValue,
  contextValue: unknown
): ParsedRuntimeBindings {
  const context = validateRuntimeContext(contextValue);
  const table = qTable(value);
  if (!table || !table.columns.includes('name') || !table.columns.includes('type') ||
    !table.columns.includes('namespace')) {
    throw new Error('q returned an unexpected runtime bindings metadata shape.');
  }
  const bindings: RuntimeBindingMetadata[] = [];
  const seen = new Set<string>();
  let omittedUnsafeNames = 0;
  for (const row of table.rows) {
    const rawName = semanticQValue(row.name);
    const rawType = semanticQValue(row.type);
    const rawNamespace = semanticQValue(row.namespace);
    if (typeof rawNamespace !== 'boolean') {
      throw new Error('q returned an unexpected runtime namespace flag.');
    }
    const candidate = typeof rawName === 'string' ? rawName : '';
    if (rawNamespace && context === '.' && candidate.length === 1) continue;
    try {
      const name = validateServerObjectIdentifier(candidate);
      if (seen.has(name)) {
        throw new Error('q returned duplicate runtime binding metadata.');
      }
      seen.add(name);
      const qType = typeof rawType === 'number' && Number.isInteger(rawType)
        ? rawType
        : undefined;
      if (rawNamespace && qType !== 99) {
        throw new Error('q returned inconsistent runtime namespace metadata.');
      }
      bindings.push(Object.freeze({
        context,
        name,
        qualifiedName: rawNamespace && context === '.'
          ? `.${name}`
          : qualifyRuntimeBinding(context, name),
        kind: runtimeBindingKind(qType, rawNamespace),
        ...(qType === undefined ? {} : { qType }),
      }));
    } catch (error) {
      if (error instanceof Error && /duplicate|inconsistent/.test(error.message)) throw error;
      omittedUnsafeNames++;
    }
  }
  bindings.sort((left, right) => {
    const namespaceOrder = Number(right.kind === 'namespace') - Number(left.kind === 'namespace');
    return namespaceOrder || left.name.localeCompare(right.name);
  });
  return { bindings, omittedUnsafeNames };
}

export function runtimeBindingKind(
  qType: number | undefined,
  namespace: boolean
): RuntimeBindingKind {
  if (namespace) return 'namespace';
  if (qType === 98) return 'table';
  if (qType === 104) return 'projection';
  if (qType !== undefined && qType >= 100 && qType <= 112) return 'function';
  if (qType !== undefined && qType >= -19 && qType <= 99) return 'variable';
  return 'unknown';
}

export function validateRuntimeBinding(binding: RuntimeBindingMetadata): RuntimeBindingMetadata {
  const qualifiedName = binding.kind === 'namespace' && binding.context === '.'
    ? `.${validateServerObjectIdentifier(binding.name)}`
    : qualifyRuntimeBinding(binding.context, binding.name);
  if (qualifiedName !== binding.qualifiedName ||
    runtimeBindingKind(binding.qType, binding.kind === 'namespace') !== binding.kind) {
    throw new Error('KX Variables received inconsistent binding metadata.');
  }
  return binding;
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
  const semantic = semanticQValue(value);
  if (typeof semantic === 'string') {
    return semantic ? [semantic] : [];
  }
  if (!Array.isArray(semantic)) {
    throw new Error('q returned an unexpected table-list shape.');
  }
  return semantic
    .map(semanticQValue)
    .filter((item): item is string => typeof item === 'string');
}

function qTable(value: QValue): QTable | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    'qtype' in value && value.qtype === 'table'
    ? value as QTable
    : undefined;
}

function safeMetadataText(value: unknown, fallback: string): string {
  const semantic = semanticQValue(value);
  const text = typeof semantic === 'string' ? semantic : fallback;
  const withoutControls = text.replace(/[\u0000-\u001f\u007f]/g, '');
  return (withoutControls || fallback).slice(0, 512);
}

function semanticQValue(value: unknown): unknown {
  return isQRuntimeValue(value) ? qValueToSemanticPrimitive(value) : value;
}
