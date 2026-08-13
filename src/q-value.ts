export const Q_TYPE_NAMES = Object.freeze([
  'boolean',
  'guid',
  'byte',
  'short',
  'int',
  'long',
  'real',
  'float',
  'char',
  'symbol',
  'timestamp',
  'month',
  'date',
  'datetime',
  'timespan',
  'minute',
  'second',
  'time',
] as const);

export type QTypeName = typeof Q_TYPE_NAMES[number];
export type QVectorTypeName = QTypeName | 'mixed';
export type QSpecialKind =
  | 'null'
  | 'positiveInfinity'
  | 'negativeInfinity'
  | 'negativeZero';

export interface QSpecialValue {
  readonly special: QSpecialKind;
}

export type QScalarValue = boolean | number | string | QSpecialValue;

export interface QAtom {
  readonly qtype: 'atom';
  readonly type: QTypeName;
  readonly value: QScalarValue;
}

export interface QGeneralNullValue {
  readonly qtype: 'generalNull';
}

export type QBoundedLiteralLimit = 'chars' | 'items' | 'depth' | 'cycle' | 'unsupported';

export interface QBoundedLiteralOptions {
  maxChars?: number;
  maxItems?: number;
  maxDepth?: number;
}

export interface QBoundedLiteralResult {
  text: string;
  truncated: boolean;
  limits: QBoundedLiteralLimit[];
}

export interface PortableQAtomNode {
  form: 'atom';
  type: QTypeName;
  value: QScalarValue;
}

export interface PortableQTypedVectorNode {
  form: 'vector';
  type: QTypeName;
  attribute: number;
  values: QScalarValue[];
}

export interface PortableQMixedVectorNode {
  form: 'vector';
  type: 'mixed';
  attribute: number;
  values: PortableQNode[];
}

export interface PortableQGeneralNullNode {
  form: 'generalNull';
}

export type PortableQNode =
  | PortableQAtomNode
  | PortableQTypedVectorNode
  | PortableQMixedVectorNode
  | PortableQGeneralNullNode;

// Use registry-backed symbols so tagged IPC vectors remain recognizable when
// the extension host/test harness loads more than one copy of this module in
// the same JavaScript realm. The properties remain non-enumerable and never
// cross the portable JSON boundary directly.
const Q_VECTOR_TYPE = Symbol.for('vscode-kdb.qVectorType');
const Q_VECTOR_ATTRIBUTE = Symbol.for('vscode-kdb.qVectorAttribute');

type QTaggedVector = unknown[] & {
  [Q_VECTOR_TYPE]?: QVectorTypeName;
  [Q_VECTOR_ATTRIBUTE]?: number;
};

const TYPE_NAMES = new Set<string>(Q_TYPE_NAMES);
const SPECIAL_KINDS = new Set<string>([
  'null',
  'positiveInfinity',
  'negativeInfinity',
  'negativeZero',
]);
const NULL_TYPES = new Set<QTypeName>(Q_TYPE_NAMES.filter(type =>
  type !== 'boolean' && type !== 'byte'));
const INFINITY_TYPES = new Set<QTypeName>([
  'short',
  'int',
  'long',
  'real',
  'float',
  'timestamp',
  'month',
  'date',
  'datetime',
  'timespan',
  'minute',
  'second',
  'time',
]);
const NEGATIVE_ZERO_TYPES = new Set<QTypeName>(['real', 'float', 'datetime']);
const TEMPORAL_TYPES = new Set<QTypeName>([
  'timestamp',
  'month',
  'date',
  'datetime',
  'timespan',
  'minute',
  'second',
  'time',
]);
const INTEGER_TYPES = new Set<QTypeName>([
  'byte',
  'short',
  'int',
  'month',
  'date',
  'minute',
  'second',
  'time',
]);
const INT64_TYPES = new Set<QTypeName>(['long', 'timestamp', 'timespan']);
const INT64_PATTERN = /^(?:0|-[1-9]\d*|[1-9]\d*)$/;
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INT64_MAX = (BigInt(1) << BigInt(63)) - BigInt(1);
const MAX_PORTABLE_Q_DEPTH = 512;
const Q_EPOCH_MS = Date.UTC(2000, 0, 1);
const MS_PER_DAY = 86_400_000;
const NS_PER_DAY = BigInt(86_400_000_000_000);
const Q_REAL_MIN_NORMAL = 1.1754943508222875e-38;

export function qSpecial(special: QSpecialKind): QSpecialValue {
  return Object.freeze({ special });
}

export function qAtom(type: QTypeName, value: QScalarValue): QAtom {
  if (!TYPE_NAMES.has(type) || !validScalar(type, value)) {
    throw new TypeError(`Invalid ${String(type)} q atom payload.`);
  }
  return Object.freeze({ qtype: 'atom', type, value: cloneScalar(value) });
}

export function qVector<T>(
  values: T[],
  type: QVectorTypeName,
  attribute = 0
): T[] {
  if ((type !== 'mixed' && !TYPE_NAMES.has(type)) || !validVectorAttribute(attribute)) {
    throw new TypeError(`Invalid q vector metadata ${String(type)}#${String(attribute)}.`);
  }
  if (type !== 'mixed' && values.some(value =>
    isQAtom(value)
      ? value.type !== type
      : !validScalar(type, value))) {
    throw new TypeError(`Invalid ${type} q vector payload.`);
  }
  Object.defineProperty(values, Q_VECTOR_TYPE, {
    enumerable: false,
    configurable: false,
    writable: false,
    value: type,
  });
  Object.defineProperty(values, Q_VECTOR_ATTRIBUTE, {
    enumerable: false,
    configurable: false,
    writable: false,
    value: attribute,
  });
  return values;
}

export function isQAtom(value: unknown): value is QAtom {
  return isRecord(value) && hasOnlyKeys(value, ['qtype', 'type', 'value']) &&
    value.qtype === 'atom' &&
    typeof value.type === 'string' && TYPE_NAMES.has(value.type) &&
    validScalar(value.type as QTypeName, value.value);
}

export function isQVector(value: unknown): value is unknown[] {
  return Array.isArray(value) && qVectorType(value) !== undefined;
}

export function qVectorType(value: unknown): QVectorTypeName | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const type = (value as QTaggedVector)[Q_VECTOR_TYPE];
  return type === 'mixed' || (typeof type === 'string' && TYPE_NAMES.has(type))
    ? type as QVectorTypeName
    : undefined;
}

export function qVectorAttribute(value: unknown): number | undefined {
  if (!isQVector(value)) {
    return undefined;
  }
  const attribute = (value as QTaggedVector)[Q_VECTOR_ATTRIBUTE];
  return validVectorAttribute(attribute) ? attribute : undefined;
}

export function qVectorAtomAt(value: unknown[], index: number): unknown {
  if (index < 0 || index >= value.length) {
    return undefined;
  }
  const type = qVectorType(value);
  if (!type || type === 'mixed') {
    return value[index];
  }
  const item = value[index];
  if (isQAtom(item)) {
    return item.type === type ? item : undefined;
  }
  return validScalar(type, item) ? qAtom(type, item) : undefined;
}

export function isQGeneralNull(value: unknown): value is QGeneralNullValue {
  return isRecord(value) && hasOnlyKeys(value, ['qtype']) && value.qtype === 'generalNull';
}

export function isQRuntimeValue(value: unknown): boolean {
  return isQAtom(value) || isQVector(value) || isQGeneralNull(value);
}

export function qValueToPortableNode(value: unknown): PortableQNode | undefined {
  return portableNodeFromRuntime(value, new Set<object>(), 0);
}

export function portableNodeToQValue(node: unknown): unknown {
  if (!validatePortableQNode(node)) {
    return undefined;
  }
  return runtimeFromPortableNode(node as PortableQNode);
}

export function validatePortableQNode(root: unknown): root is PortableQNode {
  const pending: Array<{ node: unknown; depth: number }> = [{ node: root, depth: 0 }];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const { node, depth } = pending.pop()!;
    if (depth > MAX_PORTABLE_Q_DEPTH || !isRecord(node) || seen.has(node)) {
      return false;
    }
    seen.add(node);
    if (node.form === 'generalNull') {
      if (!hasOnlyKeys(node, ['form'])) {
        return false;
      }
      continue;
    }
    if (node.form === 'atom') {
      if (!hasOnlyKeys(node, ['form', 'type', 'value']) ||
        typeof node.type !== 'string' || !TYPE_NAMES.has(node.type) ||
        !validScalar(node.type as QTypeName, node.value)) {
        return false;
      }
      continue;
    }
    if (node.form !== 'vector' ||
      !hasOnlyKeys(node, ['form', 'type', 'attribute', 'values']) ||
      (node.type !== 'mixed' && (typeof node.type !== 'string' || !TYPE_NAMES.has(node.type))) ||
      !validVectorAttribute(node.attribute) || !Array.isArray(node.values) ||
      !isDensePortableArray(node.values)) {
      return false;
    }
    if (node.type === 'mixed') {
      for (let index = node.values.length - 1; index >= 0; index--) {
        pending.push({ node: node.values[index], depth: depth + 1 });
      }
    } else {
      for (let index = 0; index < node.values.length; index++) {
        if (!validScalar(node.type as QTypeName, node.values[index])) {
          return false;
        }
      }
    }
  }
  return true;
}

export function qValueToLiteral(value: unknown): string {
  const issue = qRuntimeTreeIssue(value, new Set<object>());
  if (issue) {
    return isQVector(value)
      ? `[q ${qVectorType(value)} vector; ${value.length} items; ${issue}]`
      : `[${issue}]`;
  }
  return qRuntimeLiteral(value);
}

/**
 * Concise text for a grid cell. The runtime value remains fully typed; this
 * formatter deliberately omits routine scalar type casts/suffixes while
 * retaining syntax that communicates shape (symbols, char vectors, enlist,
 * empty typed vectors, attributes, and nested/mixed values).
 */
export function qValueToGridCellText(value: unknown): string {
  const issue = qRuntimeTreeIssue(value, new Set<object>());
  if (issue) {
    return isQVector(value)
      ? `[q ${qVectorType(value)} vector; ${value.length} items; ${issue}]`
      : `[${issue}]`;
  }
  return qRuntimeGridCellText(value);
}

/**
 * Formats a q runtime value while doing work proportional to the requested
 * prefix. Unlike qValueToLiteral, this path may return a display-only,
 * explicitly truncated representation and never walks the unneeded tail of a
 * large vector merely to enforce a character budget.
 */
export function qValueToBoundedLiteral(
  value: unknown,
  options: QBoundedLiteralOptions = {}
): QBoundedLiteralResult {
  const state = boundedQState(options, 'literal');
  appendBoundedQValue(state, value, 0);
  let limits = [...state.limits];
  let exact: string | undefined;
  if (limits.length === 0) {
    exact = qRuntimeLiteral(value);
    if (exact.length > state.maxChars) {
      state.limits.add('chars');
      limits = [...state.limits];
      exact = undefined;
    }
  }
  return {
    text: exact !== undefined
      ? exact
      : boundedQSummary(
        runtimeQSummary(value), limits, state.maxChars, state.unsupportedKind
      ),
    truncated: limits.length > 0,
    limits,
  };
}

/** Bounded counterpart of qValueToGridCellText for virtualized grid paths. */
export function qValueToBoundedGridCellText(
  value: unknown,
  options: QBoundedLiteralOptions = {}
): QBoundedLiteralResult {
  const state = boundedQState(options, 'grid');
  appendBoundedQValue(state, value, 0);
  let limits = [...state.limits];
  let exact: string | undefined;
  if (limits.length === 0) {
    exact = qRuntimeGridCellText(value);
    if (exact.length > state.maxChars) {
      state.limits.add('chars');
      limits = [...state.limits];
      exact = undefined;
    }
  }
  return {
    text: exact !== undefined
      ? exact
      : boundedQSummary(
        runtimeQSummary(value), limits, state.maxChars, state.unsupportedKind
      ),
    truncated: limits.length > 0,
    limits,
  };
}

/** Bounded display for a portable node without validating or rehydrating its full tree first. */
export function portableQNodeToBoundedLiteral(
  node: unknown,
  options: QBoundedLiteralOptions = {}
): QBoundedLiteralResult {
  const state = boundedQState(options, 'literal');
  appendBoundedPortableQNode(state, node, 0);
  let limits = [...state.limits];
  let exact: string | undefined;
  if (limits.length === 0) {
    exact = qRuntimeLiteral(runtimeFromPortableNode(node as PortableQNode));
    if (exact.length > state.maxChars) {
      state.limits.add('chars');
      limits = [...state.limits];
      exact = undefined;
    }
  }
  return {
    text: exact !== undefined
      ? exact
      : boundedQSummary(
        portableQSummary(node), limits, state.maxChars, state.unsupportedKind
      ),
    truncated: limits.length > 0,
    limits,
  };
}

/** Bounded concise grid display for an exact portable q node. */
export function portableQNodeToBoundedGridCellText(
  node: unknown,
  options: QBoundedLiteralOptions = {}
): QBoundedLiteralResult {
  const state = boundedQState(options, 'grid');
  appendBoundedPortableQNode(state, node, 0);
  let limits = [...state.limits];
  let exact: string | undefined;
  if (limits.length === 0) {
    exact = qRuntimeGridCellText(runtimeFromPortableNode(node as PortableQNode));
    if (exact.length > state.maxChars) {
      state.limits.add('chars');
      limits = [...state.limits];
      exact = undefined;
    }
  }
  return {
    text: exact !== undefined
      ? exact
      : boundedQSummary(
        portableQSummary(node), limits, state.maxChars, state.unsupportedKind
      ),
    truncated: limits.length > 0,
    limits,
  };
}

export function qValueDescription(value: unknown): string | undefined {
  if (isQAtom(value)) {
    return `q ${value.type} atom; value ${boundedLiteral(value)}`;
  }
  if (isQVector(value)) {
    const type = qVectorType(value)!;
    const attribute = qVectorAttribute(value) || 0;
    return `q ${type} vector${attribute ? ` attribute ${attribute}` : ''}; value ${boundedLiteral(value)}`;
  }
  if (isQGeneralNull(value)) {
    return 'q general null; value ::';
  }
  return undefined;
}

export function qValueToSemanticPrimitive(value: unknown): unknown {
  if (isQGeneralNull(value)) {
    return null;
  }
  if (isQAtom(value)) {
    return semanticAtomValue(value);
  }
  if (isQVector(value)) {
    const type = qVectorType(value)!;
    if (type === 'char') {
      return qCharVectorText(value);
    }
    if (type === 'mixed') {
      return value.map(item => isQRuntimeValue(item) ? qValueToSemanticPrimitive(item) : item);
    }
    return value.map((_item, index) => qValueToSemanticPrimitive(qVectorAtomAt(value, index)));
  }
  return undefined;
}

function portableNodeFromRuntime(
  value: unknown,
  seen: Set<object>,
  depth: number
): PortableQNode | undefined {
  if (depth > MAX_PORTABLE_Q_DEPTH) {
    return undefined;
  }
  if (isQGeneralNull(value)) {
    return { form: 'generalNull' };
  }
  if (isQAtom(value)) {
    return { form: 'atom', type: value.type, value: cloneScalar(value.value) };
  }
  if (!isQVector(value) || seen.has(value)) {
    return undefined;
  }
  const type = qVectorType(value)!;
  const attribute = qVectorAttribute(value);
  if (attribute === undefined) {
    return undefined;
  }
  seen.add(value);
  try {
    if (type === 'mixed') {
      const values: PortableQNode[] = [];
      for (const item of value) {
        const node = portableNodeFromRuntime(item, seen, depth + 1);
        if (!node) {
          return undefined;
        }
        values.push(node);
      }
      return { form: 'vector', type, attribute, values };
    }
    const values: QScalarValue[] = [];
    for (let index = 0; index < value.length; index++) {
      const atom = qVectorAtomAt(value, index);
      if (!isQAtom(atom) || atom.type !== type) {
        return undefined;
      }
      values.push(cloneScalar(atom.value));
    }
    return { form: 'vector', type, attribute, values };
  } finally {
    seen.delete(value);
  }
}

function runtimeFromPortableNode(node: PortableQNode): unknown {
  if (node.form === 'generalNull') {
    return Object.freeze({ qtype: 'generalNull' as const });
  }
  if (node.form === 'atom') {
    return qAtom(node.type, node.value);
  }
  if (node.type === 'mixed') {
    return qVector(node.values.map(runtimeFromPortableNode), 'mixed', node.attribute);
  }
  return qVector(node.values.map(cloneScalar), node.type, node.attribute);
}

interface QBoundedLiteralState {
  chunks: string[];
  length: number;
  maxChars: number;
  maxItems: number;
  maxDepth: number;
  renderMode: 'literal' | 'grid';
  limits: Set<QBoundedLiteralLimit>;
  seen: Set<object>;
  unsupportedKind?: string;
}

function boundedQState(
  options: QBoundedLiteralOptions,
  renderMode: QBoundedLiteralState['renderMode']
): QBoundedLiteralState {
  return {
    chunks: [],
    length: 0,
    maxChars: nonNegativeBoundedOption(options.maxChars, Number.MAX_SAFE_INTEGER),
    maxItems: nonNegativeBoundedOption(options.maxItems, Number.MAX_SAFE_INTEGER),
    maxDepth: nonNegativeBoundedOption(options.maxDepth, MAX_PORTABLE_Q_DEPTH),
    renderMode,
    limits: new Set<QBoundedLiteralLimit>(),
    seen: new Set<object>(),
  };
}

function appendBoundedQValue(
  state: QBoundedLiteralState,
  value: unknown,
  depth: number
): void {
  if (qBoundedCharsExhausted(state)) {
    return;
  }
  if (isQGeneralNull(value)) {
    appendBoundedQText(state, '::');
    return;
  }
  if (isQAtom(value)) {
    appendBoundedQAtom(state, value);
    return;
  }
  if (isQVector(value)) {
    appendBoundedQVector(state, value, depth);
    return;
  }
  state.limits.add('unsupported');
  state.unsupportedKind ||= qShallowValueKind(value);
}

function appendBoundedPortableQNode(
  state: QBoundedLiteralState,
  node: unknown,
  depth: number
): void {
  if (qBoundedCharsExhausted(state)) {
    return;
  }
  if (!isRecord(node)) {
    state.limits.add('unsupported');
    return;
  }
  if (node.form === 'generalNull') {
    if (!hasOnlyKeys(node, ['form'])) {
      state.limits.add('unsupported');
      return;
    }
    appendBoundedQText(state, '::');
    return;
  }
  if (node.form === 'atom') {
    if (!hasOnlyKeys(node, ['form', 'type', 'value']) ||
      typeof node.type !== 'string' || !TYPE_NAMES.has(node.type) ||
      !validScalar(node.type as QTypeName, node.value)) {
      state.limits.add('unsupported');
      return;
    }
    appendBoundedQAtom(state, {
      qtype: 'atom',
      type: node.type as QTypeName,
      value: node.value,
    });
    return;
  }
  if (node.form !== 'vector' ||
    !hasOnlyKeys(node, ['form', 'type', 'attribute', 'values']) ||
    (node.type !== 'mixed' && (typeof node.type !== 'string' || !TYPE_NAMES.has(node.type))) ||
    !validVectorAttribute(node.attribute) || !Array.isArray(node.values)) {
    state.limits.add('unsupported');
    return;
  }
  if (state.seen.has(node)) {
    state.limits.add('cycle');
    return;
  }
  const type = node.type as QVectorTypeName;
  if (type === 'mixed' && node.values.length > 0 && depth >= state.maxDepth) {
    state.limits.add('depth');
    return;
  }
  state.seen.add(node);
  try {
    if (node.attribute !== 0) {
      appendBoundedQText(state, `${qAttributeLiteral(node.attribute)}#(`);
    }
    appendBoundedPortableQVectorBody(state, type, node.values, depth);
    if (node.attribute !== 0) {
      appendBoundedQText(state, ')');
    }
  } finally {
    state.seen.delete(node);
  }
}

function appendBoundedPortableQVectorBody(
  state: QBoundedLiteralState,
  type: QVectorTypeName,
  values: unknown[],
  depth: number
): void {
  if (state.renderMode === 'grid') {
    appendBoundedPortableQGridVectorBody(state, type, values, depth);
    return;
  }
  if (values.length === 0) {
    appendBoundedQText(state, type === 'mixed' ? '()' : `"${qTypeCastCode(type)}"$()`);
    return;
  }
  const count = Math.min(values.length, state.maxItems);
  const omitted = values.length - count;
  if (values.length === 1 && count === 1) {
    appendBoundedQText(state, 'enlist ');
    if (type === 'mixed') {
      const item = values[0];
      const parenthesized = isRecord(item) &&
        (item.form === 'vector' || item.form === 'generalNull' ||
          (item.form === 'atom' && typeof item.type === 'string' &&
            (TEMPORAL_TYPES.has(item.type as QTypeName) || item.type === 'guid')));
      if (parenthesized) appendBoundedQText(state, '(');
      appendBoundedPortableQNode(state, item, depth + 1);
      if (parenthesized) appendBoundedQText(state, ')');
    } else {
      appendBoundedPortableQScalar(state, type, values[0], true);
    }
    return;
  }
  if (type === 'mixed') {
    appendBoundedQText(state, '(');
    for (let index = 0; index < count && !qBoundedCharsExhausted(state); index++) {
      if (index > 0) appendBoundedQText(state, ';');
      appendBoundedPortableQNode(state, values[index], depth + 1);
    }
    noteBoundedQOmission(state, omitted);
    appendBoundedQText(state, ')');
    return;
  }
  if (type === 'char') {
    appendBoundedQText(state, '"');
    for (let index = 0; index < count && !qBoundedCharsExhausted(state); index++) {
      if (!validScalar(type, values[index])) {
        state.limits.add('unsupported');
        break;
      }
      appendBoundedQCharCode(
        state,
        isSpecial(values[index]) ? 32 : Number(values[index])
      );
    }
    appendBoundedQText(state, '"');
    noteBoundedQOmission(state, omitted);
    return;
  }
  if (type === 'symbol') {
    appendBoundedQText(state, '`$(');
    for (let index = 0; index < count && !qBoundedCharsExhausted(state); index++) {
      if (index > 0) appendBoundedQText(state, ';');
      if (!validScalar(type, values[index])) {
        state.limits.add('unsupported');
        break;
      }
      appendBoundedQString(
        state,
        isSpecial(values[index]) ? '' : String(values[index])
      );
    }
    noteBoundedQOmission(state, omitted);
    appendBoundedQText(state, ')');
    return;
  }
  if (type === 'boolean') {
    for (let index = 0; index < count && !qBoundedCharsExhausted(state); index++) {
      if (!validScalar(type, values[index])) {
        state.limits.add('unsupported');
        break;
      }
      appendBoundedQText(state, values[index] ? '1' : '0');
    }
    appendBoundedQText(state, 'b');
    noteBoundedQOmission(state, omitted);
    return;
  }
  if (type === 'byte') {
    appendBoundedQText(state, '0x');
    for (let index = 0; index < count && !qBoundedCharsExhausted(state); index++) {
      if (!validScalar(type, values[index])) {
        state.limits.add('unsupported');
        break;
      }
      appendBoundedQText(state, byteHex(values[index]));
    }
    noteBoundedQOmission(state, omitted);
    return;
  }
  appendBoundedQText(state, `"${qTypeCastCode(type)}"$(`);
  for (let index = 0; index < count && !qBoundedCharsExhausted(state); index++) {
    if (index > 0) appendBoundedQText(state, ';');
    appendBoundedPortableQScalar(state, type, values[index], false);
  }
  noteBoundedQOmission(state, omitted);
  appendBoundedQText(state, ')');
}

function appendBoundedPortableQScalar(
  state: QBoundedLiteralState,
  type: QTypeName,
  value: unknown,
  enlistItem: boolean
): void {
  if (!validScalar(type, value)) {
    state.limits.add('unsupported');
    return;
  }
  const parenthesized = (enlistItem && TEMPORAL_TYPES.has(type)) ||
    (type === 'guid' && !isSpecial(value));
  if (parenthesized) appendBoundedQText(state, '(');
  appendBoundedQAtom(state, { qtype: 'atom', type, value });
  if (parenthesized) appendBoundedQText(state, ')');
}

function appendBoundedQVector(
  state: QBoundedLiteralState,
  value: unknown[],
  depth: number
): void {
  if (state.seen.has(value)) {
    state.limits.add('cycle');
    appendBoundedQText(state, '[cycle]');
    return;
  }

  const type = qVectorType(value)!;
  if (type === 'mixed' && value.length > 0 && depth >= state.maxDepth) {
    state.limits.add('depth');
    appendBoundedQText(state, `[mixed vector ${value.length} items; depth limit]`);
    return;
  }

  state.seen.add(value);
  try {
    const attribute = qVectorAttribute(value) || 0;
    if (attribute !== 0) {
      appendBoundedQText(state, `${qAttributeLiteral(attribute)}#(`);
    }
    appendBoundedQVectorBody(state, value, type, depth);
    if (attribute !== 0) {
      appendBoundedQText(state, ')');
    }
  } finally {
    state.seen.delete(value);
  }
}

function appendBoundedQVectorBody(
  state: QBoundedLiteralState,
  value: unknown[],
  type: QVectorTypeName,
  depth: number
): void {
  if (state.renderMode === 'grid') {
    appendBoundedQGridVectorBody(state, value, type, depth);
    return;
  }
  if (value.length === 0) {
    appendBoundedQText(state, type === 'mixed' ? '()' : `"${qTypeCastCode(type)}"$()`);
    return;
  }

  const count = Math.min(value.length, state.maxItems);
  const omitted = value.length - count;
  if (value.length === 1 && count === 1) {
    const item = type === 'mixed' ? value[0] : qVectorAtomAt(value, 0);
    appendBoundedQText(state, 'enlist ');
    const parenthesized = isQVector(item) || isQGeneralNull(item) ||
      (isQAtom(item) && (TEMPORAL_TYPES.has(item.type) ||
        (item.type === 'guid' && !isSpecial(item.value))));
    if (parenthesized) {
      appendBoundedQText(state, '(');
    }
    appendBoundedQValue(state, item, depth + 1);
    if (parenthesized) {
      appendBoundedQText(state, ')');
    }
    return;
  }

  if (type === 'mixed') {
    appendBoundedQText(state, '(');
    for (let index = 0; index < count && !qBoundedCharsExhausted(state); index++) {
      if (index > 0) {
        appendBoundedQText(state, ';');
      }
      appendBoundedQValue(state, value[index], depth + 1);
    }
    noteBoundedQOmission(state, omitted);
    appendBoundedQText(state, ')');
    return;
  }

  if (type === 'char') {
    appendBoundedQText(state, '"');
    for (let index = 0; index < count && !qBoundedCharsExhausted(state); index++) {
      const atom = qVectorAtomAt(value, index);
      appendBoundedQCharCode(
        state,
        isQAtom(atom) && !isSpecial(atom.value) ? Number(atom.value) : 32
      );
    }
    appendBoundedQText(state, '"');
    noteBoundedQOmission(state, omitted);
    return;
  }

  if (type === 'symbol') {
    appendBoundedQText(state, '`$(');
    for (let index = 0; index < count && !qBoundedCharsExhausted(state); index++) {
      if (index > 0) {
        appendBoundedQText(state, ';');
      }
      const atom = qVectorAtomAt(value, index);
      const symbol = isQAtom(atom) && !isSpecial(atom.value) ? String(atom.value) : '';
      appendBoundedQString(state, symbol);
    }
    noteBoundedQOmission(state, omitted);
    appendBoundedQText(state, ')');
    return;
  }

  if (type === 'boolean') {
    for (let index = 0; index < count && !qBoundedCharsExhausted(state); index++) {
      const atom = qVectorAtomAt(value, index);
      appendBoundedQText(state, isQAtom(atom) && atom.value ? '1' : '0');
    }
    appendBoundedQText(state, 'b');
    noteBoundedQOmission(state, omitted);
    return;
  }

  if (type === 'byte') {
    appendBoundedQText(state, '0x');
    for (let index = 0; index < count && !qBoundedCharsExhausted(state); index++) {
      const atom = qVectorAtomAt(value, index);
      appendBoundedQText(state, isQAtom(atom) ? byteHex(atom.value) : '00');
    }
    noteBoundedQOmission(state, omitted);
    return;
  }

  // A cast around a general list is conservative, valid q syntax for every
  // remaining typed-vector family, and can be emitted one atom at a time.
  appendBoundedQText(state, `"${qTypeCastCode(type)}"$(`);
  for (let index = 0; index < count && !qBoundedCharsExhausted(state); index++) {
    if (index > 0) {
      appendBoundedQText(state, ';');
    }
    const atom = qVectorAtomAt(value, index);
    const guidParentheses = type === 'guid' && isQAtom(atom) && !isSpecial(atom.value);
    if (guidParentheses) appendBoundedQText(state, '(');
    appendBoundedQValue(state, atom, depth + 1);
    if (guidParentheses) appendBoundedQText(state, ')');
  }
  noteBoundedQOmission(state, omitted);
  appendBoundedQText(state, ')');
}

function appendBoundedPortableQGridVectorBody(
  state: QBoundedLiteralState,
  type: QVectorTypeName,
  values: unknown[],
  depth: number
): void {
  if (values.length === 0) {
    appendBoundedQText(state, type === 'mixed' ? '()' : `"${qTypeCastCode(type)}"$()`);
    return;
  }
  const count = Math.min(values.length, state.maxItems);
  const omitted = values.length - count;
  if (values.length === 1 && count === 1) {
    appendBoundedQText(state, 'enlist ');
    const item = values[0];
    const parenthesized = type === 'mixed' && isRecord(item) &&
      (item.form === 'vector' || item.form === 'generalNull');
    if (parenthesized) appendBoundedQText(state, '(');
    if (type === 'mixed') {
      appendBoundedPortableQNode(state, item, depth + 1);
    } else if (validScalar(type, item)) {
      appendBoundedQAtom(state, { qtype: 'atom', type, value: item });
    } else {
      state.limits.add('unsupported');
    }
    if (parenthesized) appendBoundedQText(state, ')');
    return;
  }
  if (type === 'mixed') {
    appendBoundedQText(state, '(');
    for (let index = 0; index < count && !qBoundedCharsExhausted(state); index++) {
      if (index > 0) appendBoundedQText(state, ';');
      appendBoundedPortableQNode(state, values[index], depth + 1);
    }
    noteBoundedQOmission(state, omitted);
    appendBoundedQText(state, ')');
    return;
  }
  if (type === 'char') {
    appendBoundedQText(state, '"');
    for (let index = 0; index < count && !qBoundedCharsExhausted(state); index++) {
      if (!validScalar(type, values[index])) {
        state.limits.add('unsupported');
        break;
      }
      appendBoundedQCharCode(
        state,
        isSpecial(values[index]) ? 32 : Number(values[index])
      );
    }
    appendBoundedQText(state, '"');
    noteBoundedQOmission(state, omitted);
    return;
  }
  if (type === 'symbol') {
    // Use the general symbol-vector form while enforcing bounds. If the full
    // node fits, the final unbounded pass replaces this with the shortest
    // equivalent concise spelling.
    appendBoundedQText(state, '`$(');
    for (let index = 0; index < count && !qBoundedCharsExhausted(state); index++) {
      if (index > 0) appendBoundedQText(state, ';');
      const item = values[index];
      if (!validScalar(type, item)) {
        state.limits.add('unsupported');
        break;
      }
      appendBoundedQString(state, isSpecial(item) ? '' : String(item));
    }
    appendBoundedQText(state, ')');
    noteBoundedQOmission(state, omitted);
    return;
  }
  for (let index = 0; index < count && !qBoundedCharsExhausted(state); index++) {
    if (index > 0) appendBoundedQText(state, ' ');
    const item = values[index];
    if (!validScalar(type, item)) {
      state.limits.add('unsupported');
      break;
    }
    appendBoundedQAtom(state, { qtype: 'atom', type, value: item });
  }
  noteBoundedQOmission(state, omitted);
}

function appendBoundedQGridVectorBody(
  state: QBoundedLiteralState,
  value: unknown[],
  type: QVectorTypeName,
  depth: number
): void {
  if (value.length === 0) {
    appendBoundedQText(state, type === 'mixed' ? '()' : `"${qTypeCastCode(type)}"$()`);
    return;
  }
  const count = Math.min(value.length, state.maxItems);
  const omitted = value.length - count;
  if (value.length === 1 && count === 1) {
    const item = type === 'mixed' ? value[0] : qVectorAtomAt(value, 0);
    appendBoundedQText(state, 'enlist ');
    const parenthesized = isQVector(item) || isQGeneralNull(item);
    if (parenthesized) appendBoundedQText(state, '(');
    appendBoundedQValue(state, item, depth + 1);
    if (parenthesized) appendBoundedQText(state, ')');
    return;
  }
  if (type === 'mixed') {
    appendBoundedQText(state, '(');
    for (let index = 0; index < count && !qBoundedCharsExhausted(state); index++) {
      if (index > 0) appendBoundedQText(state, ';');
      appendBoundedQValue(state, value[index], depth + 1);
    }
    noteBoundedQOmission(state, omitted);
    appendBoundedQText(state, ')');
    return;
  }
  if (type === 'char') {
    appendBoundedQText(state, '"');
    for (let index = 0; index < count && !qBoundedCharsExhausted(state); index++) {
      const atom = qVectorAtomAt(value, index);
      appendBoundedQCharCode(
        state,
        isQAtom(atom) && !isSpecial(atom.value) ? Number(atom.value) : 32
      );
    }
    appendBoundedQText(state, '"');
    noteBoundedQOmission(state, omitted);
    return;
  }
  if (type === 'symbol') {
    appendBoundedQText(state, '`$(');
    for (let index = 0; index < count && !qBoundedCharsExhausted(state); index++) {
      if (index > 0) appendBoundedQText(state, ';');
      const atom = qVectorAtomAt(value, index);
      const symbol = isQAtom(atom) && !isSpecial(atom.value) ? String(atom.value) : '';
      appendBoundedQString(state, symbol);
    }
    appendBoundedQText(state, ')');
    noteBoundedQOmission(state, omitted);
    return;
  }
  for (let index = 0; index < count && !qBoundedCharsExhausted(state); index++) {
    if (index > 0) appendBoundedQText(state, ' ');
    const atom = qVectorAtomAt(value, index);
    appendBoundedQValue(state, atom, depth + 1);
  }
  noteBoundedQOmission(state, omitted);
}

function appendBoundedQAtom(state: QBoundedLiteralState, atom: QAtom): void {
  if (state.renderMode === 'grid') {
    appendBoundedQText(state, qGridAtomText(atom));
    return;
  }
  if (atom.type === 'symbol' && !isSpecial(atom.value)) {
    const symbol = String(atom.value);
    if (isSimpleQSymbol(symbol)) {
      appendBoundedQText(state, '`');
      appendBoundedQText(state, symbol);
    } else {
      appendBoundedQText(state, '`$');
      appendBoundedQString(state, symbol);
    }
    return;
  }
  if (atom.type === 'char' && !isSpecial(atom.value)) {
    appendBoundedQText(state, '"');
    appendBoundedQCharCode(state, Number(atom.value));
    appendBoundedQText(state, '"');
    return;
  }
  appendBoundedQText(state, qAtomLiteral(atom.type, atom.value));
}

function appendBoundedQString(state: QBoundedLiteralState, value: string): void {
  appendBoundedQText(state, '"');
  for (let index = 0; index < value.length && !qBoundedCharsExhausted(state); index++) {
    appendBoundedQCharCode(state, value.charCodeAt(index));
  }
  appendBoundedQText(state, '"');
}

function appendBoundedQCharCode(state: QBoundedLiteralState, code: number): void {
  if (code === 0x22 || code === 0x5c) {
    appendBoundedQText(state, `\\${String.fromCharCode(code)}`);
  } else if (code === 0x0a) {
    appendBoundedQText(state, '\\n');
  } else if (code === 0x0d) {
    appendBoundedQText(state, '\\r');
  } else if (code === 0x09) {
    appendBoundedQText(state, '\\t');
  } else if (code < 0x20 || code === 0x7f || code > 0x7e) {
    appendBoundedQText(state, `\\${code.toString(8).padStart(3, '0')}`);
  } else {
    appendBoundedQText(state, String.fromCharCode(code));
  }
}

function noteBoundedQOmission(state: QBoundedLiteralState, omitted: number): void {
  if (omitted > 0) {
    state.limits.add('items');
  }
}

function appendBoundedQText(state: QBoundedLiteralState, value: string): void {
  if (value.length === 0 || qBoundedCharsExhausted(state)) {
    return;
  }
  const remaining = state.maxChars - state.length;
  if (value.length <= remaining) {
    state.chunks.push(value);
    state.length += value.length;
    return;
  }
  if (remaining > 0) {
    state.chunks.push(value.slice(0, remaining));
    state.length += remaining;
  }
  state.limits.add('chars');
}

function qBoundedCharsExhausted(state: QBoundedLiteralState): boolean {
  return state.limits.has('chars') || state.limits.has('unsupported') ||
    state.limits.has('cycle') || state.limits.has('depth');
}

function nonNegativeBoundedOption(value: unknown, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(number)));
}

function runtimeQSummary(value: unknown): string {
  if (isQAtom(value)) {
    return `q ${value.type} atom`;
  }
  if (isQVector(value)) {
    return `q ${qVectorType(value)} vector; ${value.length} items`;
  }
  if (isQGeneralNull(value)) {
    return 'q general null';
  }
  return `unsupported ${qShallowValueKind(value)} value`;
}

function portableQSummary(node: unknown): string {
  if (!isRecord(node)) {
    return 'invalid portable q value';
  }
  if (node.form === 'atom' && typeof node.type === 'string') {
    return `q ${node.type} atom`;
  }
  if (node.form === 'vector' && typeof node.type === 'string' && Array.isArray(node.values)) {
    return `q ${node.type} vector; ${node.values.length} items`;
  }
  if (node.form === 'generalNull') {
    return 'q general null';
  }
  return 'invalid portable q value';
}

function boundedQSummary(
  description: string,
  limits: QBoundedLiteralLimit[],
  maxChars: number,
  unsupportedKind?: string
): string {
  if (maxChars <= 0) {
    return '';
  }
  const reason = limits.includes('unsupported')
    ? `contains unsupported ${unsupportedKind || 'nested'} value`
    : limits.includes('cycle')
      ? 'cycle'
      : limits.includes('depth')
        ? 'depth limit'
        : limits.includes('items')
          ? 'item limit'
          : 'character limit';
  const full = limits.includes('unsupported')
    ? `[${description}; ${reason}]`
    : `[${description}; truncated: ${reason}]`;
  if (full.length <= maxChars) {
    return full;
  }
  const marker = '[truncated]';
  return marker.length <= maxChars ? marker : '…'.slice(0, maxChars);
}

function qShallowValueKind(value: unknown): string {
  if (isRecord(value) && typeof value.qtype === 'string') {
    return `q ${value.qtype}`;
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
}

function qRuntimeTreeIssue(value: unknown, seen: Set<object>): string | undefined {
  if (isQGeneralNull(value) || isQAtom(value)) {
    return undefined;
  }
  if (!isQVector(value)) {
    return `contains unsupported ${qShallowValueKind(value)} value`;
  }
  if (seen.has(value)) {
    return 'contains a cycle';
  }
  if (qVectorType(value) !== 'mixed') {
    return undefined;
  }
  seen.add(value);
  try {
    for (const item of value) {
      const issue = qRuntimeTreeIssue(item, seen);
      if (issue) {
        return issue;
      }
    }
    return undefined;
  } finally {
    seen.delete(value);
  }
}

function qRuntimeLiteral(value: unknown): string {
  if (isQGeneralNull(value)) {
    return '::';
  }
  if (isQAtom(value)) {
    return qAtomLiteral(value.type, value.value);
  }
  if (isQVector(value)) {
    return qVectorLiteral(value);
  }
  throw new TypeError(`Unsupported ${qShallowValueKind(value)} value in q literal.`);
}

function qRuntimeGridCellText(value: unknown): string {
  if (isQGeneralNull(value)) {
    return '::';
  }
  if (isQAtom(value)) {
    return qGridAtomText(value);
  }
  if (isQVector(value)) {
    return qGridVectorText(value);
  }
  throw new TypeError(`Unsupported ${qShallowValueKind(value)} value in q grid cell.`);
}

function qGridVectorText(value: unknown[]): string {
  const type = qVectorType(value)!;
  const attribute = qVectorAttribute(value) || 0;
  let text: string;
  if (value.length === 0) {
    text = type === 'mixed' ? '()' : `"${qTypeCastCode(type)}"$()`;
  } else if (value.length === 1) {
    const item = type === 'mixed' ? value[0] : qVectorAtomAt(value, 0);
    const itemText = qRuntimeGridCellText(item);
    text = `enlist ${isQVector(item) || isQGeneralNull(item) ? `(${itemText})` : itemText}`;
  } else if (type === 'mixed') {
    text = `(${value.map(qRuntimeGridCellText).join(';')})`;
  } else if (type === 'char') {
    text = qStringLiteral(qCharVectorText(value));
  } else if (type === 'symbol') {
    text = qSymbolVectorLiteral(value);
  } else {
    text = value.map((_item, index) => {
      const atom = qVectorAtomAt(value, index);
      if (!isQAtom(atom)) {
        throw new TypeError(`Invalid ${type} q vector item ${index}.`);
      }
      return qGridAtomText(atom);
    }).join(' ');
  }
  return attribute === 0 ? text : `${qAttributeLiteral(attribute)}#(${text})`;
}

function qGridAtomText(atom: QAtom): string {
  if (isSpecial(atom.value)) {
    if (atom.type === 'symbol') {
      return '`';
    }
    if (atom.type === 'char') {
      return '" "';
    }
    if (atom.type === 'guid') {
      return '0Ng';
    }
    if (atom.value.special === 'negativeZero') {
      return qSpecialLiteral(atom.type, atom.value.special);
    }
    return atom.value.special === 'null'
      ? '0N'
      : atom.value.special === 'positiveInfinity' ? '0W' : '-0W';
  }
  if (atom.type === 'symbol') {
    return qSymbolLiteral(String(atom.value));
  }
  if (atom.type === 'char') {
    return qCharLiteral(Number(atom.value));
  }
  if (atom.type === 'byte') {
    return `0x${byteHex(atom.value)}`;
  }
  if (atom.type === 'boolean') {
    return atom.value ? 'true' : 'false';
  }
  if (atom.type === 'timestamp') {
    return timestampGridDisplay(String(atom.value));
  }
  if (atom.type === 'month') {
    return monthDisplay(Number(atom.value));
  }
  if (atom.type === 'date') {
    return dateGridDisplay(Number(atom.value));
  }
  if (atom.type === 'datetime') {
    return datetimeGridDisplay(Number(atom.value));
  }
  if (atom.type === 'timespan') {
    return timespanGridDisplay(String(atom.value));
  }
  if (atom.type === 'minute') {
    return clockDisplay(Number(atom.value) * 60_000, 'minute');
  }
  if (atom.type === 'second') {
    return clockDisplay(Number(atom.value) * 1_000, 'second');
  }
  if (atom.type === 'time') {
    return clockDisplay(Number(atom.value), 'millisecond');
  }
  return String(atom.value);
}

function qVectorLiteral(value: unknown[]): string {
  const type = qVectorType(value)!;
  const attribute = qVectorAttribute(value) || 0;
  if (type === 'real' && qRealVectorRequiresSerializedLiteral(value)) {
    return qSerializedRealVectorLiteral(value, attribute);
  }
  let literal: string;
  if (value.length === 0) {
    literal = type === 'mixed' ? '()' : `"${qTypeCastCode(type)}"$()`;
  } else if (value.length === 1) {
    const item = type === 'mixed' ? value[0] : qVectorAtomAt(value, 0);
    literal = `enlist ${enlistItemLiteral(item)}`;
  } else if (type === 'mixed') {
    literal = `(${value.map(item => qMixedItemLiteral(item)).join(';')})`;
  } else if (type === 'char') {
    literal = qStringLiteral(qCharVectorText(value));
  } else if (type === 'symbol') {
    literal = qSymbolVectorLiteral(value);
  } else {
    literal = qTypedVectorLiteral(type, value);
  }
  return attribute === 0 ? literal : `${qAttributeLiteral(attribute)}#(${literal})`;
}

function enlistItemLiteral(value: unknown): string {
  const text = qRuntimeLiteral(value);
  return isQVector(value) || isQGeneralNull(value) ||
    (isQAtom(value) && (TEMPORAL_TYPES.has(value.type) ||
      (value.type === 'guid' && !isSpecial(value.value))))
    ? `(${text})`
    : text;
}

function qMixedItemLiteral(value: unknown): string {
  return qRuntimeLiteral(value);
}

function qTypedVectorLiteral(type: QTypeName, value: unknown[]): string {
  const atoms = value.map((_item, index) => qVectorAtomAt(value, index)) as QAtom[];
  if (type === 'boolean') {
    return atoms.map(atom => atom.value ? '1' : '0').join('') + 'b';
  }
  if (type === 'byte') {
    return `0x${atoms.map(atom => byteHex(atom.value)).join('')}`;
  }
  if (type === 'guid') {
    return `"g"$(${atoms.map(atom => {
      const literal = qAtomLiteral(type, atom.value);
      return isSpecial(atom.value) ? literal : `(${literal})`;
    }).join(';')})`;
  }
  if (type === 'short') {
    if (atoms.every(atom => !isSpecial(atom.value))) {
      return `${atoms.map(atom => String(atom.value)).join(' ')}h`;
    }
    return `"h"$(${atoms.map(atom => qAtomLiteral(type, atom.value)).join(';')})`;
  }
  if (type === 'int') {
    if (atoms.every(atom => !isSpecial(atom.value))) {
      return `${atoms.map(atom => String(atom.value)).join(' ')}i`;
    }
    return `"i"$(${atoms.map(atom => qAtomLiteral(type, atom.value)).join(';')})`;
  }
  if (type === 'real') {
    if (atoms.every(atom => !isSpecial(atom.value))) {
      return `${atoms.map(atom => stripSuffix(qAtomLiteral(type, atom.value), 'e')).join(' ')}e`;
    }
    return `"e"$(${atoms.map(atom => {
      const literal = qAtomLiteral(type, atom.value);
      return isSpecial(atom.value) ? literal : stripSuffix(literal, 'e');
    }).join(';')})`;
  }
  if (type === 'float') {
    if (atoms.every(atom => !isSpecial(atom.value))) {
      return atoms.map(atom => stripSuffix(qAtomLiteral(type, atom.value), 'f')).join(' ');
    }
    return `"f"$(${atoms.map(atom => {
      const literal = qAtomLiteral(type, atom.value);
      return isSpecial(atom.value) ? literal : stripSuffix(literal, 'f');
    }).join(';')})`;
  }
  if (TEMPORAL_TYPES.has(type)) {
    return `"${qTypeCastCode(type)}"$(${atoms.map(temporalRawAtomLiteral).join(';')})`;
  }
  return atoms.map(atom => qAtomLiteral(type, atom.value)).join(' ');
}

function qAtomLiteral(type: QTypeName, value: QScalarValue): string {
  if (isSpecial(value)) {
    return qSpecialLiteral(type, value.special);
  }
  switch (type) {
    case 'boolean': return value ? '1b' : '0b';
    case 'guid': return `"G"$${qStringLiteral(String(value))}`;
    case 'byte': return `0x${byteHex(value)}`;
    case 'short': return `${String(value)}h`;
    case 'int': return `${String(value)}i`;
    case 'long': return String(value);
    case 'real': return qRealRequiresSerializedLiteral(value)
      ? qSerializedRealAtomLiteral(Number(value))
      : qFiniteFloatLiteral(Number(value), 'e');
    case 'float': return qFiniteFloatLiteral(Number(value), 'f');
    case 'char': return qCharLiteral(Number(value));
    case 'symbol': return qSymbolLiteral(String(value));
    case 'timestamp': return temporalLiteral(type, String(value));
    case 'month': return temporalLiteral(type, Number(value));
    case 'date': return temporalLiteral(type, Number(value));
    case 'datetime': return temporalLiteral(type, Number(value));
    case 'timespan': return temporalLiteral(type, String(value));
    case 'minute': return temporalLiteral(type, Number(value));
    case 'second': return temporalLiteral(type, Number(value));
    case 'time': return temporalLiteral(type, Number(value));
  }
}

function qSpecialLiteral(type: QTypeName, special: QSpecialKind): string {
  if (special === 'negativeZero') {
    return type === 'real' ? '-0e' : type === 'datetime' ? '"z"$-0f' : '-0f';
  }
  if (type === 'boolean') {
    return '0Nb';
  }
  if (type === 'guid') {
    return '0Ng';
  }
  if (type === 'byte') {
    return '0x00';
  }
  if (type === 'char') {
    return '" "';
  }
  if (type === 'symbol') {
    return '`';
  }
  const prefix = special === 'null'
    ? '0N'
    : special === 'positiveInfinity' ? '0W' : '-0W';
  const suffix: Partial<Record<QTypeName, string>> = {
    short: 'h',
    int: 'i',
    real: 'e',
    float: 'f',
    timestamp: 'p',
    month: 'm',
    date: 'd',
    datetime: 'z',
    timespan: 'n',
    minute: 'u',
    second: 'v',
    time: 't',
  };
  return `${prefix}${suffix[type] || ''}`;
}

function temporalLiteral(type: QTypeName, value: string | number): string {
  return `"${qTypeCastCode(type)}"$${String(value)}${typeof value === 'string' ? 'j' : type === 'datetime' ? 'f' : 'i'}`;
}

function temporalRawAtomLiteral(atom: QAtom): string {
  if (isSpecial(atom.value)) {
    if (atom.value.special === 'negativeZero') {
      return '-0f';
    }
    const base = atom.value.special === 'null'
      ? '0N'
      : atom.value.special === 'positiveInfinity' ? '0W' : '-0W';
    if (atom.type === 'datetime') {
      return base === '0N' ? '0n' : base.replace('W', 'w');
    }
    return atom.type === 'timestamp' || atom.type === 'timespan'
      ? base
      : `${base}i`;
  }
  if (atom.type === 'timestamp' || atom.type === 'timespan') {
    return `${String(atom.value)}j`;
  }
  if (atom.type === 'datetime') {
    return qFiniteFloatLiteral(Number(atom.value), 'f');
  }
  return `${String(atom.value)}i`;
}

function qTypeCastCode(type: QTypeName): string {
  const codes: Record<QTypeName, string> = {
    boolean: 'b',
    guid: 'g',
    byte: 'x',
    short: 'h',
    int: 'i',
    long: 'j',
    real: 'e',
    float: 'f',
    char: 'c',
    symbol: 's',
    timestamp: 'p',
    month: 'm',
    date: 'd',
    datetime: 'z',
    timespan: 'n',
    minute: 'u',
    second: 'v',
    time: 't',
  };
  return codes[type];
}

function qAttributeLiteral(attribute: number): string {
  return ['','`s','`u','`p','`g'][attribute];
}

function qSymbolVectorLiteral(value: unknown[]): string {
  const symbols = value.map((_item, index) => {
    const atom = qVectorAtomAt(value, index) as QAtom;
    return isSpecial(atom.value) ? '' : String(atom.value);
  });
  return symbols.every(isSimpleQSymbol)
    ? symbols.map(symbol => `\`${symbol}`).join('')
    : `\`$(${symbols.map(qStringLiteral).join(';')})`;
}

function qSymbolLiteral(value: string): string {
  return isSimpleQSymbol(value) ? `\`${value}` : `\`$${qStringLiteral(value)}`;
}

function isSimpleQSymbol(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function qCharLiteral(value: number): string {
  return qStringLiteral(String.fromCharCode(value));
}

function qCharVectorText(value: unknown[]): string {
  return value.map((_item, index) => {
    const atom = qVectorAtomAt(value, index);
    return isQAtom(atom)
      ? String.fromCharCode(isSpecial(atom.value) ? 32 : Number(atom.value))
      : '';
  }).join('');
}

function qStringLiteral(value: string): string {
  let text = '"';
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c) {
      text += `\\${value[index]}`;
    } else if (code === 0x0a) {
      text += '\\n';
    } else if (code === 0x0d) {
      text += '\\r';
    } else if (code === 0x09) {
      text += '\\t';
    } else if (code < 0x20 || code === 0x7f || code > 0x7e) {
      text += `\\${code.toString(8).padStart(3, '0')}`;
    } else {
      text += value[index];
    }
  }
  return `${text}"`;
}

function semanticAtomValue(atom: QAtom): unknown {
  if (isSpecial(atom.value)) {
    if (atom.value.special === 'null') {
      return null;
    }
    if (atom.value.special === 'negativeZero') {
      return atom.type === 'datetime' ? datetimeDisplay(-0) : -0;
    }
    return qAtomLiteral(atom.type, atom.value);
  }
  if (atom.type === 'char') {
    return String.fromCharCode(Number(atom.value));
  }
  if (atom.type === 'timestamp') {
    return timestampDisplay(String(atom.value));
  }
  if (atom.type === 'month') {
    return monthDisplay(Number(atom.value));
  }
  if (atom.type === 'date') {
    return dateDisplay(Number(atom.value));
  }
  if (atom.type === 'datetime') {
    return datetimeDisplay(Number(atom.value));
  }
  if (atom.type === 'timespan') {
    return timespanDisplay(String(atom.value));
  }
  if (atom.type === 'minute') {
    return clockDisplay(Number(atom.value) * 60_000, 'minute');
  }
  if (atom.type === 'second') {
    return clockDisplay(Number(atom.value) * 1_000, 'second');
  }
  if (atom.type === 'time') {
    return clockDisplay(Number(atom.value), 'millisecond');
  }
  if (atom.type === 'long') {
    const integer = BigInt(String(atom.value));
    return integer >= BigInt(Number.MIN_SAFE_INTEGER) && integer <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(integer)
      : integer.toString();
  }
  return atom.value;
}

function timestampDisplay(value: string): string {
  const nanoseconds = BigInt(value);
  const divisor = BigInt(1_000_000);
  let milliseconds = nanoseconds / divisor;
  // BigInt division truncates toward zero. Date milliseconds represent the
  // containing millisecond, so negative sub-millisecond timestamps must use
  // mathematical floor instead.
  if (nanoseconds < BigInt(0) && nanoseconds % divisor !== BigInt(0)) {
    milliseconds -= BigInt(1);
  }
  return new Date(Q_EPOCH_MS + Number(milliseconds)).toISOString();
}

function timestampGridDisplay(value: string): string {
  const nanoseconds = BigInt(value);
  const days = floorBigInt(nanoseconds, NS_PER_DAY);
  let remainder = nanoseconds - days * NS_PER_DAY;
  const hours = remainder / BigInt(3_600_000_000_000);
  remainder %= BigInt(3_600_000_000_000);
  const minutes = remainder / BigInt(60_000_000_000);
  remainder %= BigInt(60_000_000_000);
  const seconds = remainder / BigInt(1_000_000_000);
  const nanos = remainder % BigInt(1_000_000_000);
  const date = new Date(Q_EPOCH_MS + Number(days) * MS_PER_DAY);
  return `${qGridDate(date)}D${pad2(Number(hours))}:${pad2(Number(minutes))}:` +
    `${pad2(Number(seconds))}.${nanos.toString().padStart(9, '0')}`;
}

function monthDisplay(value: number): string {
  const year = 2000 + Math.floor(value / 12);
  const month = ((value % 12) + 12) % 12;
  return `${year.toString().padStart(4, '0')}.${(month + 1).toString().padStart(2, '0')}`;
}

function dateDisplay(value: number): string {
  const date = new Date(Q_EPOCH_MS + value * MS_PER_DAY);
  return Number.isFinite(date.getTime())
    ? date.toISOString().slice(0, 10)
    : temporalLiteral('date', value);
}

function dateGridDisplay(value: number): string {
  const date = new Date(Q_EPOCH_MS + value * MS_PER_DAY);
  return Number.isFinite(date.getTime())
    ? qGridDate(date)
    : temporalLiteral('date', value);
}

function datetimeDisplay(value: number): string {
  const date = new Date(Q_EPOCH_MS + value * MS_PER_DAY);
  return Number.isFinite(date.getTime())
    ? date.toISOString()
    : temporalLiteral('datetime', value);
}

function datetimeGridDisplay(value: number): string {
  const date = new Date(Q_EPOCH_MS + value * MS_PER_DAY);
  if (!Number.isFinite(date.getTime())) {
    return temporalLiteral('datetime', value);
  }
  return `${qGridDate(date)}T${pad2(date.getUTCHours())}:` +
    `${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}.` +
    date.getUTCMilliseconds().toString().padStart(3, '0');
}

function timespanDisplay(value: string): string {
  let nanoseconds = BigInt(value);
  const negative = nanoseconds < BigInt(0);
  if (negative) {
    nanoseconds = -nanoseconds;
  }
  const days = nanoseconds / NS_PER_DAY;
  nanoseconds %= NS_PER_DAY;
  const hours = nanoseconds / BigInt(3_600_000_000_000);
  nanoseconds %= BigInt(3_600_000_000_000);
  const minutes = nanoseconds / BigInt(60_000_000_000);
  nanoseconds %= BigInt(60_000_000_000);
  const seconds = nanoseconds / BigInt(1_000_000_000);
  const nanos = nanoseconds % BigInt(1_000_000_000);
  return `${negative ? '-' : ''}${days > BigInt(0) ? `${days}D ` : ''}` +
    `${pad2(Number(hours))}:${pad2(Number(minutes))}:${pad2(Number(seconds))}.` +
    nanos.toString().padStart(9, '0');
}

function timespanGridDisplay(value: string): string {
  let nanoseconds = BigInt(value);
  const negative = nanoseconds < BigInt(0);
  if (negative) {
    nanoseconds = -nanoseconds;
  }
  const days = nanoseconds / NS_PER_DAY;
  nanoseconds %= NS_PER_DAY;
  const hours = nanoseconds / BigInt(3_600_000_000_000);
  nanoseconds %= BigInt(3_600_000_000_000);
  const minutes = nanoseconds / BigInt(60_000_000_000);
  nanoseconds %= BigInt(60_000_000_000);
  const seconds = nanoseconds / BigInt(1_000_000_000);
  const nanos = nanoseconds % BigInt(1_000_000_000);
  return `${negative ? '-' : ''}${days}D${pad2(Number(hours))}:` +
    `${pad2(Number(minutes))}:${pad2(Number(seconds))}.` +
    nanos.toString().padStart(9, '0');
}

function qGridDate(value: Date): string {
  const year = value.getUTCFullYear();
  const yearText = year < 0
    ? `-${Math.abs(year).toString().padStart(4, '0')}`
    : year.toString().padStart(4, '0');
  return `${yearText}.${(value.getUTCMonth() + 1).toString().padStart(2, '0')}.` +
    value.getUTCDate().toString().padStart(2, '0');
}

function floorBigInt(value: bigint, divisor: bigint): bigint {
  const quotient = value / divisor;
  return value < BigInt(0) && value % divisor !== BigInt(0)
    ? quotient - BigInt(1)
    : quotient;
}

function clockDisplay(
  millisecondsValue: number,
  precision: 'minute' | 'second' | 'millisecond'
): string {
  const negative = millisecondsValue < 0;
  let milliseconds = Math.abs(millisecondsValue);
  const hours = Math.floor(milliseconds / 3_600_000);
  milliseconds -= hours * 3_600_000;
  const minutes = Math.floor(milliseconds / 60_000);
  milliseconds -= minutes * 60_000;
  const seconds = Math.floor(milliseconds / 1_000);
  milliseconds -= seconds * 1_000;
  const base = `${negative ? '-' : ''}${pad2(hours)}:${pad2(minutes)}`;
  if (precision === 'minute') return base;
  if (precision === 'second') return `${base}:${pad2(seconds)}`;
  return `${base}:${pad2(seconds)}.${Math.trunc(milliseconds).toString().padStart(3, '0')}`;
}

function pad2(value: number): string {
  return Math.trunc(value).toString().padStart(2, '0');
}

function validScalar(type: QTypeName, value: unknown): value is QScalarValue {
  if (isSpecial(value)) {
    if (value.special === 'null') {
      return NULL_TYPES.has(type);
    }
    if (value.special === 'negativeZero') {
      return NEGATIVE_ZERO_TYPES.has(type);
    }
    return INFINITY_TYPES.has(type);
  }
  if (type === 'boolean') {
    return typeof value === 'boolean';
  }
  if (type === 'guid') {
    return typeof value === 'string' && GUID_PATTERN.test(value) &&
      value !== '00000000-0000-0000-0000-000000000000';
  }
  if (type === 'symbol') {
    return typeof value === 'string' && value.length > 0 &&
      [...value].every(character => character.charCodeAt(0) <= 0xff);
  }
  if (INT64_TYPES.has(type)) {
    return validInt64String(value);
  }
  if (INTEGER_TYPES.has(type)) {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      return false;
    }
    if (type === 'byte') return value >= 0 && value <= 255;
    if (type === 'short') return value >= -32766 && value <= 32766;
    return value >= -2147483646 && value <= 2147483646;
  }
  if (type === 'char') {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255;
  }
  return typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0);
}

function validInt64String(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 20 || !INT64_PATTERN.test(value)) {
    return false;
  }
  try {
    const integer = BigInt(value);
    return integer > -INT64_MAX && integer < INT64_MAX;
  } catch {
    return false;
  }
}

function validVectorAttribute(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4;
}

function isDensePortableArray(value: unknown[]): boolean {
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 ||
      keys.some(key => key !== 'length' && (
        typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length
      ))) {
      return false;
    }
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function isSpecial(value: unknown): value is QSpecialValue {
  return isRecord(value) && hasOnlyKeys(value, ['special']) &&
    typeof value.special === 'string' && SPECIAL_KINDS.has(value.special);
}

function cloneScalar(value: QScalarValue): QScalarValue {
  return isSpecial(value) ? qSpecial(value.special) : value;
}

function qFiniteFloatLiteral(value: number, suffix: 'e' | 'f'): string {
  const source = String(value);
  const text = /e/i.test(source)
    ? source
    : Number.isInteger(value) ? `${source}.0` : source;
  return `${text}${suffix}`;
}

function qRealRequiresSerializedLiteral(value: unknown): boolean {
  return typeof value === 'number' && value !== 0 &&
    Math.abs(value) < Q_REAL_MIN_NORMAL;
}

function qRealVectorRequiresSerializedLiteral(value: unknown[]): boolean {
  for (let index = 0; index < value.length; index++) {
    const atom = qVectorAtomAt(value, index);
    if (isQAtom(atom) && qRealRequiresSerializedLiteral(atom.value)) {
      return true;
    }
  }
  return false;
}

/**
 * q's decimal parser flushes IEEE-754 real subnormals to zero. `-9!` is q's
 * IPC deserializer, so embedding the canonical little-endian object bytes is
 * the conservative valid-q fallback that preserves those bits exactly.
 */
function qSerializedRealAtomLiteral(value: number): string {
  const bytes = new Uint8Array(13);
  const view = new DataView(bytes.buffer);
  bytes[0] = 1;
  view.setUint32(4, bytes.length, true);
  bytes[8] = 0xf8;
  view.setFloat32(9, value, true);
  return `-9!0x${byteArrayHex(bytes)}`;
}

function qSerializedRealVectorLiteral(value: unknown[], attribute: number): string {
  const bytes = new Uint8Array(14 + value.length * 4);
  const view = new DataView(bytes.buffer);
  bytes[0] = 1;
  view.setUint32(4, bytes.length, true);
  bytes[8] = 8;
  bytes[9] = attribute;
  view.setInt32(10, value.length, true);
  for (let index = 0; index < value.length; index++) {
    const atom = qVectorAtomAt(value, index);
    if (!isQAtom(atom) || atom.type !== 'real') {
      throw new TypeError('Invalid q real vector item in serialized literal.');
    }
    writeQRealScalar(view, 14 + index * 4, atom.value);
  }
  const deserialized = `-9!0x${byteArrayHex(bytes)}`;
  // Keep the public singleton-vector rule explicit without extracting and
  // re-enlisting the real atom, which would flush a subnormal in q.
  return value.length === 1 ? `first enlist (${deserialized})` : deserialized;
}

function writeQRealScalar(view: DataView, offset: number, value: QScalarValue): void {
  if (!isSpecial(value)) {
    view.setFloat32(offset, Number(value), true);
    return;
  }
  const bits: Record<QSpecialKind, number> = {
    null: 0xffc00000,
    positiveInfinity: 0x7f800000,
    negativeInfinity: 0xff800000,
    negativeZero: 0x80000000,
  };
  view.setUint32(offset, bits[value.special], true);
}

function byteArrayHex(value: Uint8Array): string {
  let text = '';
  for (const byte of value) {
    text += byte.toString(16).padStart(2, '0');
  }
  return text;
}

function byteHex(value: unknown): string {
  return Number(value).toString(16).padStart(2, '0');
}

function stripSuffix(value: string, suffix: string): string {
  return value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
}

function boundedLiteral(value: unknown): string {
  return qValueToBoundedLiteral(value, {
    maxChars: 160,
    maxItems: 16,
    maxDepth: 8,
  }).text;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every(key => keys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
