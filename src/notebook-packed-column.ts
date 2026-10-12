import { deflate, Inflate } from 'pako';
import {
  PortableQNode, PortableQTypedVectorNode, QScalarValue, QSpecialKind,
  QTypeName, QVectorTypeName, Q_TYPE_NAMES, isQAtom, isQVector,
  isPortableQScalar, qVectorAttribute, qVectorType, validatePortableQNode,
} from './q-value';

export interface PackedQColumn {
  form: 'packed-vector';
  version: 1;
  type: QVectorTypeName;
  attribute: number;
  shape: 'scalar' | 'ragged';
  valueType: QTypeName;
  length: number;
  elementCount: number;
  encoding: 'constant' | 'delta' | 'float-predict' | 'float64';
  scale: number;
  constant?: QScalarValue;
  compression?: 'deflate';
  decodedBytes?: number;
  data?: string;
}
export type ColumnCompressor = (bytes: Uint8Array) => Uint8Array;
const types = new Set<string>(Q_TYPE_NAMES);
const int64 = new Set<string>(['long', 'timestamp', 'timespan']);
const floating = new Set<string>(['float', 'real', 'datetime']);
const specials: QSpecialKind[] = ['null', 'positiveInfinity', 'negativeInfinity', 'negativeZero'];
const scalarLimit = Math.floor(Number.MAX_SAFE_INTEGER / 4);
const maxInt64 = (1n << 63n) - 1n;
const cacheKeys = ['form', 'version', 'type', 'attribute', 'shape', 'valueType', 'length', 'elementCount', 'encoding', 'scale', 'constant', 'compression', 'decodedBytes', 'data'] as const;
const decodedCache = new WeakMap<object, { snapshot: PackedQColumn; constantSpecial: unknown; value: DecodedColumn }>();

interface VectorSource {
  type: QVectorTypeName;
  attribute: number;
  length: number;
  values: readonly unknown[];
  portable: boolean;
}
interface DecodedColumn {
  offsets?: Uint32Array;
  attributes?: Uint8Array;
  values?: Float64Array | BigInt64Array;
  specialCodes?: Uint8Array;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function safe(value: unknown, maximum = 0xffffffff): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}
function source(value: unknown, portable: boolean): VectorSource | undefined {
  if (portable) {
    if (!record(value) || value.form !== 'vector' || !Array.isArray(value.values) ||
      (value.type !== 'mixed' && !types.has(String(value.type))) || !safe(value.attribute, 4)) return;
    return { type: value.type as QVectorTypeName, attribute: value.attribute, length: value.values.length,
      values: value.values, portable: true };
  }
  if (!isQVector(value)) return;
  const attribute = qVectorAttribute(value);
  if (attribute === undefined) return;
  return { type: qVectorType(value)!, attribute, length: value.length, values: value, portable: false };
}
function scalar(value: unknown, type: QTypeName, portable: boolean): QScalarValue | undefined {
  if (!portable && isQAtom(value)) return value.type === type ? value.value : undefined;
  return isPortableQScalar(type, value) ? value : undefined;
}
function specialCode(value: QScalarValue): number {
  return record(value) ? specials.indexOf(value.special as QSpecialKind) + 1 : 0;
}
function sameScalar(a: QScalarValue, b: QScalarValue): boolean {
  return Object.is(a, b) || (record(a) && record(b) && a.special === b.special);
}

class Writer {
  private bytes = new Uint8Array(65536);
  public size = 0;
  private room(count: number): void {
    if (this.size + count <= this.bytes.length) return;
    const replacement = new Uint8Array(Math.max(this.size + count, this.bytes.length * 2));
    replacement.set(this.bytes); this.bytes = replacement;
  }
  public byte(value: number): void { this.room(1); this.bytes[this.size++] = value; }
  public uint(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid packed integer.');
    while (value >= 128) { this.byte(value % 128 + 128); value = Math.floor(value / 128); }
    this.byte(value);
  }
  public big(value: bigint): void {
    while (value >= 128n) { this.byte(Number(value & 127n) | 128); value >>= 7n; }
    this.byte(Number(value));
  }
  public word(value: number): void {
    this.room(4); new DataView(this.bytes.buffer).setUint32(this.size, value, true); this.size += 4;
  }
  public result(): Uint8Array { return this.bytes.subarray(0, this.size); }
}
class Reader {
  public offset = 0;
  private view: DataView;
  public constructor(public readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  public byte(): number {
    if (this.offset >= this.bytes.length) throw new Error('Truncated packed column.');
    return this.bytes[this.offset++];
  }
  public uint(): number {
    let value = 0, factor = 1;
    for (let count = 0; count < 8; count++) {
      const byte = this.byte(); value += (byte & 127) * factor;
      if (!Number.isSafeInteger(value)) break;
      if (byte < 128) {
        if (count && byte === 0) break;
        return value;
      }
      factor *= 128;
    }
    throw new Error('Invalid packed varint.');
  }
  public big(): bigint {
    let value = 0n;
    for (let count = 0; count < 10; count++) {
      const byte = this.byte(); value |= BigInt(byte & 127) << BigInt(count * 7);
      if (byte < 128) {
        if ((count && byte === 0) || value > ((1n << 65n) - 2n)) break;
        return value;
      }
    }
    throw new Error('Invalid packed int64 delta.');
  }
  public word(): number {
    if (this.offset + 4 > this.bytes.length) throw new Error('Truncated packed float.');
    const value = this.view.getUint32(this.offset, true); this.offset += 4; return value;
  }
}
function base64(bytes: Uint8Array): string {
  const pieces: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    pieces.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
  }
  return btoa(pieces.join(''));
}
function unbase64(text: string): Uint8Array {
  if (!text.length || text.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) {
    throw new Error('Invalid packed base64.');
  }
  const binary = atob(text);
  if (btoa(binary) !== text) throw new Error('Noncanonical packed base64.');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < bytes.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
function inflateExact(data: string, expected: number): Uint8Array {
  const input = unbase64(data);
  // DEFLATE's longest length/distance expansion is bounded by its bit coding.
  // This is an encoding consistency check, not a notebook size ceiling.
  if (expected > input.length * 1032 + 32768) throw new Error('Impossible packed expansion size.');
  const inflater = new Inflate({ chunkSize: 65536 });
  let length = 0;
  const chunks: Uint8Array[] = [];
  inflater.onData = chunk => {
    length += chunk.length;
    if (length > expected) throw new Error('Packed expansion exceeds declared size.');
    chunks.push(chunk);
  };
  inflater.push(input, true);
  if (inflater.err || !inflater.ended || inflater.strm.avail_in ||
    inflater.strm.next_in !== input.length || length !== expected) {
    throw new Error('Invalid packed compression or decoded size.');
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

/** Input may be decoded IPC vectors or already validated portable v3 vectors. */
export function packQColumn(
  input: unknown,
  compressor: ColumnCompressor = bytes => deflate(bytes, { level: 6 }),
  portable = false
): PackedQColumn | undefined {
  if (portable && !validatePortableQNode(input)) return;
  const top = source(input, portable);
  if (!top || !safe(top.length)) return;
  const ragged = top.type === 'mixed';
  let valueType: QTypeName;
  const rows: VectorSource[] = [];
  let elementCount = ragged ? 0 : top.length;
  if (ragged) {
    for (const item of top.values) {
      const row = source(item, portable);
      if (!row || row.type === 'mixed' || (rows.length && row.type !== rows[0].type)) return;
      elementCount += row.length;
      if (!safe(elementCount)) return;
      rows.push(row);
    }
    if (!rows.length) return;
    valueType = rows[0].type as QTypeName;
  } else valueType = top.type as QTypeName;
  function* values(): IterableIterator<QScalarValue> {
    for (const row of ragged ? rows : [top!]) {
      for (let index = 0; index < row.length; index++) {
        const value = scalar(row.values[index], valueType, row.portable);
        if (value === undefined) throw new Error('Unsupported exact packed q scalar.');
        yield value;
      }
    }
  }
  let constant: QScalarValue | undefined;
  let constantMatches = elementCount > 0;
  for (const value of values()) {
    if (constant === undefined) constant = value;
    else if (!sameScalar(constant, value)) constantMatches = false;
  }
  const numeric = valueType !== 'symbol' && valueType !== 'guid';
  if (!constantMatches && !numeric) return;
  let encoding: PackedQColumn['encoding'] = constantMatches ? 'constant' : 'delta';
  let scale = 0;
  if (!constantMatches && floating.has(valueType)) {
    const sample: number[] = [];
    for (const value of values()) {
      if (!specialCode(value)) sample.push(Number(value));
      if (sample.length >= 2048) break;
    }
    let best = Number.POSITIVE_INFINITY;
    for (let candidate = 0; candidate <= 12; candidate++) {
      const factor = 10 ** candidate;
      let cost = 0, previous = 0, possible = true;
      const bits = new DataView(new ArrayBuffer(8));
      for (const value of sample) {
        const integer = Math.round(value * factor) || 0;
        if (!Number.isSafeInteger(integer) || Math.abs(integer) > scalarLimit) { possible = false; break; }
        const delta = integer - previous;
        cost += Math.max(1, Math.ceil(Math.log2(Math.abs(delta) * 2 + 1) / 7)); previous = integer;
        const prediction = integer / factor;
        if (prediction !== value) {
          bits.setFloat64(0, prediction, true); const low = bits.getUint32(0, true), high = bits.getUint32(4, true);
          bits.setFloat64(0, value, true);
          const xorLow = (low ^ bits.getUint32(0, true)) >>> 0, xorHigh = (high ^ bits.getUint32(4, true)) >>> 0;
          cost += Math.max(1, Math.ceil((xorHigh ? 32 + Math.log2(xorHigh + 1) : Math.log2(xorLow + 1)) / 7));
        } else cost += 1;
      }
      if (possible && cost < best) { best = cost; scale = candidate; }
    }
    if (!Number.isFinite(best)) { encoding = 'float64'; scale = 0; }
    else {
      let allExact = true, safePredictions = true;
      const factor = 10 ** scale;
      for (const value of values()) {
        if (specialCode(value)) continue;
        const integer = Math.round(Number(value) * factor) || 0;
        if (!Number.isSafeInteger(integer) || Math.abs(integer) > scalarLimit) { safePredictions = false; break; }
        if (integer / factor !== value) allExact = false;
      }
      if (!safePredictions) { encoding = 'float64'; scale = 0; }
      else if (!allExact) encoding = 'float-predict';
    }
  }
  const packed: PackedQColumn = {
    form: 'packed-vector', version: 1, type: top.type, attribute: top.attribute,
    shape: ragged ? 'ragged' : 'scalar', valueType, length: top.length, elementCount, encoding, scale,
    ...(constantMatches ? { constant: record(constant) ? { special: constant.special as QSpecialKind } : constant } : {}),
  };
  if (constantMatches && !ragged) return packed;
  const writer = new Writer();
  if (ragged) for (const row of rows) { writer.uint(row.length); writer.byte(row.attribute); }
  if (!constantMatches) {
    for (const value of values()) writer.byte(specialCode(value));
    let previous = 0, previousBig = 0n, low = 0, high = 0;
    const scratch = new DataView(new ArrayBuffer(8));
    for (const value of values()) {
      if (specialCode(value)) continue;
      if (encoding === 'float64') {
        scratch.setFloat64(0, Number(value), true);
        const nextLow = scratch.getUint32(0, true), nextHigh = scratch.getUint32(4, true);
        writer.word(nextLow ^ low); writer.word(nextHigh ^ high); low = nextLow; high = nextHigh;
      } else if (int64.has(valueType)) {
        const next = BigInt(String(value)), delta = next - previousBig;
        writer.big(delta < 0n ? -delta * 2n - 1n : delta * 2n); previousBig = next;
      } else {
        const next = Math.round(Number(value) * 10 ** scale) || 0, delta = next - previous;
        writer.uint(delta < 0 ? -delta * 2 - 1 : delta * 2); previous = next;
        if (encoding === 'float-predict') {
          const prediction = next / 10 ** scale;
          if (prediction === value) writer.uint(0);
          else {
            scratch.setFloat64(0, prediction, true); const baseLow = scratch.getUint32(0, true), baseHigh = scratch.getUint32(4, true);
            scratch.setFloat64(0, Number(value), true);
            const xorLow = (baseLow ^ scratch.getUint32(0, true)) >>> 0, xorHigh = (baseHigh ^ scratch.getUint32(4, true)) >>> 0;
            writer.big(BigInt(xorLow) | BigInt(xorHigh) << 32n);
          }
        }
      }
    }
  }
  const raw = writer.result();
  return { ...packed, compression: 'deflate', decodedBytes: raw.length, data: base64(compressor(raw)) };
}

function descriptor(value: unknown): value is PackedQColumn {
  if (!record(value)) return false;
  const binary = value.encoding !== 'constant' || value.shape === 'ragged';
  const keys = ['form', 'version', 'type', 'attribute', 'shape', 'valueType', 'length', 'elementCount', 'encoding', 'scale',
    ...(value.encoding === 'constant' ? ['constant'] : []), ...(binary ? ['compression', 'decodedBytes', 'data'] : [])];
  if (Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key)) ||
    value.form !== 'packed-vector' || value.version !== 1 || !safe(value.attribute, 4) ||
    !types.has(String(value.valueType)) || !safe(value.length) || !safe(value.elementCount) ||
    (value.shape !== 'scalar' && value.shape !== 'ragged') ||
    (value.shape === 'scalar' ? value.type !== value.valueType || value.length !== value.elementCount : value.type !== 'mixed') ||
    !['constant', 'delta', 'float-predict', 'float64'].includes(String(value.encoding)) || !safe(value.scale, 12) ||
    (value.scale !== 0 && ((value.encoding !== 'delta' && value.encoding !== 'float-predict') || !floating.has(String(value.valueType)))) ||
    ((value.encoding === 'float64' || value.encoding === 'float-predict') && !floating.has(String(value.valueType))) ||
    (value.encoding !== 'constant' && (value.valueType === 'symbol' || value.valueType === 'guid')) ||
    (value.encoding === 'constant' && (value.elementCount === 0 || value.scale !== 0 ||
      !isPortableQScalar(value.valueType as QTypeName, value.constant))) ||
    (binary && (value.compression !== 'deflate' || !safe(value.decodedBytes) || typeof value.data !== 'string'))) return false;
  return true;
}
function decode(column: PackedQColumn): DecodedColumn {
  const previousCache = decodedCache.get(column);
  const constantSpecial = record(column.constant) ? column.constant.special : undefined;
  if (previousCache && previousCache.constantSpecial === constantSpecial &&
    cacheKeys.every(key => previousCache.snapshot[key] === column[key])) return previousCache.value;
  if (!descriptor(column)) throw new Error('Invalid packed q descriptor.');
  const remember = (value: DecodedColumn): DecodedColumn => {
    decodedCache.set(column, { snapshot: { ...column }, constantSpecial, value }); return value;
  };
  if (column.encoding === 'constant' && column.shape === 'scalar') return remember({});
  const reader = new Reader(inflateExact(column.data!, column.decodedBytes!));
  const result: DecodedColumn = {};
  if (column.shape === 'ragged') {
    if (column.length * 2 > reader.bytes.length) throw new Error('Truncated packed vector layout.');
    result.offsets = new Uint32Array(column.length + 1);
    result.attributes = new Uint8Array(column.length);
    let count = 0;
    for (let row = 0; row < column.length; row++) {
      count += reader.uint(); const attribute = reader.byte();
      if (count > column.elementCount || attribute > 4) throw new Error('Invalid packed vector boundary or attribute.');
      result.offsets[row + 1] = count; result.attributes[row] = attribute;
    }
    if (count !== column.elementCount) throw new Error('Invalid packed element count.');
  }
  if (column.encoding !== 'constant') {
    if (reader.offset + column.elementCount > reader.bytes.length) throw new Error('Truncated packed special codes.');
    const mask = reader.bytes.subarray(reader.offset, reader.offset + column.elementCount);
    reader.offset += column.elementCount;
    result.specialCodes = mask;
    const is64 = int64.has(column.valueType);
    result.values = is64 ? new BigInt64Array(column.elementCount) : new Float64Array(column.elementCount);
    let previous = 0, previousBig = 0n, low = 0, high = 0;
    const scratch = new DataView(new ArrayBuffer(8));
    for (let index = 0; index < column.elementCount; index++) {
      const code = mask[index];
      if (code) {
        if (code > 4 || !isPortableQScalar(column.valueType, { special: specials[code - 1] })) {
          throw new Error('Invalid packed q special.');
        }
        continue;
      }
      if (is64) {
        const unsigned = reader.big(), delta = unsigned & 1n ? -(unsigned + 1n) / 2n : unsigned / 2n;
        previousBig += delta;
        if (previousBig <= -maxInt64 || previousBig >= maxInt64) throw new Error('Invalid packed int64 value.');
        (result.values as BigInt64Array)[index] = previousBig;
      } else {
        let value: QScalarValue;
        if (column.encoding === 'float64') {
          low = (low ^ reader.word()) >>> 0; high = (high ^ reader.word()) >>> 0;
          scratch.setUint32(0, low, true); scratch.setUint32(4, high, true); value = scratch.getFloat64(0, true);
        } else {
          const unsigned = reader.uint(), delta = unsigned % 2 ? -(unsigned + 1) / 2 : unsigned / 2;
          previous += delta;
          if (!Number.isSafeInteger(previous) || (floating.has(column.valueType) && Math.abs(previous) > scalarLimit)) {
            throw new Error('Invalid packed numeric delta.');
          }
          value = previous / 10 ** column.scale;
          if (column.encoding === 'float-predict') {
            const residual = reader.big();
            if (residual > ((1n << 64n) - 1n)) throw new Error('Invalid packed floating residual.');
            if (residual) {
              scratch.setFloat64(0, value, true);
              scratch.setUint32(0, scratch.getUint32(0, true) ^ Number(residual & 0xffffffffn), true);
              scratch.setUint32(4, scratch.getUint32(4, true) ^ Number(residual >> 32n), true);
              value = scratch.getFloat64(0, true);
            }
          }
          if (column.valueType === 'boolean') {
            if (value !== 0 && value !== 1) throw new Error('Invalid packed boolean.');
            value = value === 1;
          }
        }
        if (!isPortableQScalar(column.valueType, value)) throw new Error('Invalid packed q scalar.');
        (result.values as Float64Array)[index] = Number(value);
      }
    }
  }
  if (reader.offset !== reader.bytes.length) throw new Error('Extra packed bytes.');
  return remember(result);
}
export function validatePackedQColumn(value: unknown): value is PackedQColumn {
  try { if (!descriptor(value)) return false; decode(value); return true; } catch { return false; }
}
function valueAt(column: PackedQColumn, decoded: DecodedColumn, index: number): QScalarValue {
  if (column.encoding === 'constant') return record(column.constant)
    ? { special: column.constant.special as QSpecialKind } : column.constant!;
  const code = decoded.specialCodes![index];
  if (code) return { special: specials[code - 1] };
  const value = decoded.values![index];
  if (typeof value === 'bigint') return value.toString();
  return column.valueType === 'boolean' ? value === 1 : value;
}
export function packedQColumnCell(column: PackedQColumn, row: number): PortableQNode {
  if (!safe(row) || row >= column.length) throw new Error('Packed row is out of bounds.');
  const decoded = decode(column);
  if (column.shape === 'scalar') return { form: 'atom', type: column.valueType, value: valueAt(column, decoded, row) };
  const start = decoded.offsets![row], end = decoded.offsets![row + 1];
  const values: QScalarValue[] = [];
  for (let index = start; index < end; index++) values.push(valueAt(column, decoded, index));
  return { form: 'vector', type: column.valueType, attribute: decoded.attributes![row], values } as PortableQTypedVectorNode;
}
