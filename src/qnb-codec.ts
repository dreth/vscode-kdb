export const QNB_MAX_BYTES = 16 * 1024 * 1024;
export const QNB_MAX_CELLS = 10_000;
export const QNB_MAX_OUTPUTS_PER_CELL = 2_000;
export const QNB_MAX_JSON_DEPTH = 64;

export type QnbJson = null | boolean | number | string | QnbJson[] | { [key: string]: QnbJson };

export interface QnbOutputModel {
  readonly mime: string;
  readonly value: QnbJson;
  readonly unknown: Readonly<Record<string, QnbJson>>;
}

export interface QnbCellModel {
  readonly kind: 'code' | 'markdown';
  readonly language: 'q' | 'markdown';
  readonly value: string;
  readonly outputs: readonly QnbOutputModel[];
  readonly unknown: Readonly<Record<string, QnbJson>>;
}

export interface QnbDocumentModel {
  readonly cells: readonly QnbCellModel[];
}

export class QnbCodecError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'QnbCodecError';
  }
}

export function decodeQnb(bytes: Uint8Array): QnbDocumentModel {
  if (bytes.byteLength > QNB_MAX_BYTES) {
    throw new QnbCodecError(`q notebook exceeds the ${QNB_MAX_BYTES}-byte safety limit.`);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    throw new QnbCodecError('q notebook is not valid UTF-8.');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new QnbCodecError('q notebook contains malformed JSON. The file was not modified.');
  }
  assertJson(value, '$', 0);
  if (!Array.isArray(value)) {
    throw new QnbCodecError('q notebook must contain a top-level JSON cell array.');
  }
  if (value.length > QNB_MAX_CELLS) {
    throw new QnbCodecError(`q notebook contains more than ${QNB_MAX_CELLS} cells.`);
  }
  return Object.freeze({ cells: Object.freeze(value.map((cell, index) => decodeCell(cell, index))) });
}

export function encodeQnb(document: QnbDocumentModel): Uint8Array {
  if (!Array.isArray(document.cells) || document.cells.length > QNB_MAX_CELLS) {
    throw new QnbCodecError(`q notebook cannot contain more than ${QNB_MAX_CELLS} cells.`);
  }
  const cells = document.cells.map((cell, index) => encodeCell(cell, index));
  const text = `${JSON.stringify(cells, null, 2)}\n`;
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > QNB_MAX_BYTES) {
    throw new QnbCodecError(`Saving would exceed the ${QNB_MAX_BYTES}-byte q notebook safety limit.`);
  }
  return bytes;
}

function decodeCell(value: QnbJson, index: number): QnbCellModel {
  const cell = object(value, `cell ${index}`);
  const kind = cell.kind;
  if (kind !== 1 && kind !== 2) {
    throw new QnbCodecError(`q notebook cell ${index} has unsupported kind ${String(kind)}.`);
  }
  if (typeof cell.value !== 'string') {
    throw new QnbCodecError(`q notebook cell ${index} source must be a string.`);
  }
  const outputsValue = cell.outputs ?? [];
  if (!Array.isArray(outputsValue)) {
    throw new QnbCodecError(`q notebook cell ${index} outputs must be an array.`);
  }
  if (outputsValue.length > QNB_MAX_OUTPUTS_PER_CELL) {
    throw new QnbCodecError(`q notebook cell ${index} has too many outputs.`);
  }
  const unknown = without(cell, ['kind', 'language', 'value', 'outputs']);
  return Object.freeze({
    kind: kind === 2 ? 'code' : 'markdown',
    language: kind === 2 ? 'q' : 'markdown',
    value: cell.value,
    outputs: Object.freeze(outputsValue.map((output, outputIndex) =>
      decodeOutput(output, index, outputIndex))),
    unknown: Object.freeze(unknown),
  });
}

function decodeOutput(value: QnbJson, cellIndex: number, outputIndex: number): QnbOutputModel {
  const output = object(value, `cell ${cellIndex} output ${outputIndex}`);
  if (typeof output.mime !== 'string' || !validMime(output.mime)) {
    throw new QnbCodecError(`q notebook cell ${cellIndex} output ${outputIndex} has an invalid MIME type.`);
  }
  if (!Object.prototype.hasOwnProperty.call(output, 'value')) {
    throw new QnbCodecError(`q notebook cell ${cellIndex} output ${outputIndex} has no value.`);
  }
  return Object.freeze({
    mime: output.mime,
    value: cloneJson(output.value as QnbJson),
    unknown: Object.freeze(without(output, ['mime', 'value'])),
  });
}

function encodeCell(cell: QnbCellModel, index: number): Record<string, QnbJson> {
  if (cell.kind !== 'code' && cell.kind !== 'markdown') {
    throw new QnbCodecError(`q notebook cell ${index} has an unsupported in-memory kind.`);
  }
  if (typeof cell.value !== 'string') {
    throw new QnbCodecError(`q notebook cell ${index} source must remain a string.`);
  }
  if (!Array.isArray(cell.outputs) || cell.outputs.length > QNB_MAX_OUTPUTS_PER_CELL) {
    throw new QnbCodecError(`q notebook cell ${index} has invalid outputs.`);
  }
  const safe = sanitizeUnknown(cell.unknown, 0);
  return {
    ...safe,
    kind: cell.kind === 'code' ? 2 : 1,
    language: cell.kind === 'code' ? 'q' : 'markdown',
    value: cell.value,
    outputs: cell.outputs.map((output, outputIndex) => encodeOutput(output, index, outputIndex)),
  };
}

function encodeOutput(output: QnbOutputModel, cellIndex: number, outputIndex: number): Record<string, QnbJson> {
  if (typeof output.mime !== 'string' || !validMime(output.mime)) {
    throw new QnbCodecError(`q notebook cell ${cellIndex} output ${outputIndex} has an invalid MIME type.`);
  }
  assertJson(output.value, `cell ${cellIndex} output ${outputIndex} value`, 0);
  return {
    ...sanitizeUnknown(output.unknown, 0),
    mime: output.mime,
    value: cloneJson(output.value),
  };
}

function sanitizeUnknown(value: Readonly<Record<string, QnbJson>>, depth: number): Record<string, QnbJson> {
  assertJson(value, 'unknown q notebook data', depth);
  const result: Record<string, QnbJson> = {};
  for (const [key, item] of Object.entries(value)) {
    if (transientKey(key)) continue;
    result[key] = sanitizeJson(item, depth + 1);
  }
  return result;
}

function sanitizeJson(value: QnbJson, depth: number): QnbJson {
  if (depth > QNB_MAX_JSON_DEPTH) throw new QnbCodecError('q notebook JSON nesting is too deep.');
  if (Array.isArray(value)) return value.map(item => sanitizeJson(item, depth + 1));
  if (value !== null && typeof value === 'object') return sanitizeUnknown(value, depth + 1);
  return value;
}

function transientKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return ['password', 'credentials', 'credential', 'liveid', 'requestid',
    'sessionid', 'ipchandle', 'connectionhandle', 'liveresult']
    .some(suffix => normalized === suffix || normalized.endsWith(suffix));
}

function without(value: Record<string, QnbJson>, keys: readonly string[]): Record<string, QnbJson> {
  const excluded = new Set(keys);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !excluded.has(key))
    .map(([key, item]) => [key, cloneJson(item)]));
}

function cloneJson(value: QnbJson): QnbJson {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item)]));
  }
  return value;
}

function object(value: QnbJson, label: string): Record<string, QnbJson> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new QnbCodecError(`${label} must be a JSON object.`);
  }
  return value;
}

function assertJson(value: unknown, path: string, depth: number): asserts value is QnbJson {
  if (depth > QNB_MAX_JSON_DEPTH) throw new QnbCodecError(`${path} is nested too deeply.`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new QnbCodecError(`${path} contains a non-finite number.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJson(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key.length > 512) throw new QnbCodecError(`${path} contains an overlong field name.`);
      assertJson(item, `${path}.${key}`, depth + 1);
    }
    return;
  }
  throw new QnbCodecError(`${path} contains a value that cannot be preserved as JSON.`);
}

function validMime(value: string): boolean {
  return value.length > 0 && value.length <= 256 && /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(value);
}
