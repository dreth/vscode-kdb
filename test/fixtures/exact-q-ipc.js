'use strict';

// Focused byte-level fixtures for q values whose identity cannot be inferred
// from ordinary JavaScript primitives after IPC decode.

const Q_TYPE = Object.freeze({
  boolean: 1,
  guid: 2,
  byte: 4,
  short: 5,
  int: 6,
  long: 7,
  real: 8,
  float: 9,
  char: 10,
  symbol: 11,
  timestamp: 12,
  month: 13,
  date: 14,
  datetime: 15,
  timespan: 16,
  minute: 17,
  second: 18,
  time: 19,
  table: 98,
  dictionary: 99,
});

function vectorHeader(type, length, attribute = 0) {
  const buffer = Buffer.alloc(6);
  buffer.writeInt8(type, 0);
  buffer.writeUInt8(attribute, 1);
  buffer.writeInt32LE(length, 2);
  return buffer;
}

function int8(value) {
  const buffer = Buffer.alloc(1);
  buffer.writeInt8(value, 0);
  return buffer;
}

function cString(value) {
  return Buffer.concat([Buffer.from(value, 'latin1'), Buffer.from([0])]);
}

function booleanAtomByte(value) {
  return Buffer.from([-Q_TYPE.boolean & 0xff, value]);
}

function charAtomByte(value) {
  return Buffer.from([-Q_TYPE.char & 0xff, value]);
}

function guidBytes(value) {
  return Buffer.from(value.replace(/-/g, ''), 'hex');
}

function guidAtom(value) {
  return Buffer.concat([int8(-Q_TYPE.guid), guidBytes(value)]);
}

function guidVector(values, attribute = 0) {
  return Buffer.concat([
    vectorHeader(Q_TYPE.guid, values.length, attribute),
    ...values.map(guidBytes),
  ]);
}

function intAtom(value, type = Q_TYPE.int) {
  const buffer = Buffer.alloc(5);
  buffer.writeInt8(-type, 0);
  buffer.writeInt32LE(value, 1);
  return buffer;
}

function doubleAtom(value, type = Q_TYPE.float) {
  const buffer = Buffer.alloc(9);
  buffer.writeInt8(-type, 0);
  buffer.writeDoubleLE(value, 1);
  return buffer;
}

function longAtom(value, type = Q_TYPE.long) {
  const buffer = Buffer.alloc(9);
  buffer.writeInt8(-type, 0);
  buffer.writeBigInt64LE(BigInt(value), 1);
  return buffer;
}

function symbolAtom(value) {
  return Buffer.concat([int8(-Q_TYPE.symbol), cString(value)]);
}

function charVector(value, attribute = 0) {
  const bytes = Buffer.from(value, 'latin1');
  return Buffer.concat([vectorHeader(Q_TYPE.char, bytes.length, attribute), bytes]);
}

function booleanVector(values, attribute = 0) {
  return Buffer.concat([
    vectorHeader(Q_TYPE.boolean, values.length, attribute),
    Buffer.from(values),
  ]);
}

function byteVector(values, attribute = 0) {
  return Buffer.concat([
    vectorHeader(Q_TYPE.byte, values.length, attribute),
    Buffer.from(values),
  ]);
}

function shortVector(values, attribute = 0) {
  const body = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => body.writeInt16LE(value, index * 2));
  return Buffer.concat([vectorHeader(Q_TYPE.short, values.length, attribute), body]);
}

function intVector(values, attribute = 0, type = Q_TYPE.int) {
  const body = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => body.writeInt32LE(value, index * 4));
  return Buffer.concat([vectorHeader(type, values.length, attribute), body]);
}

function longVector(values, attribute = 0, type = Q_TYPE.long) {
  const body = Buffer.alloc(values.length * 8);
  values.forEach((value, index) => body.writeBigInt64LE(BigInt(value), index * 8));
  return Buffer.concat([vectorHeader(type, values.length, attribute), body]);
}

function doubleVector(values, attribute = 0, type = Q_TYPE.float) {
  const body = Buffer.alloc(values.length * 8);
  values.forEach((value, index) => body.writeDoubleLE(value, index * 8));
  return Buffer.concat([vectorHeader(type, values.length, attribute), body]);
}

function realAtomBits(bits) {
  const buffer = Buffer.alloc(5);
  buffer.writeInt8(-Q_TYPE.real, 0);
  buffer.writeUInt32LE(bits >>> 0, 1);
  return buffer;
}

function realVectorBits(bits, attribute = 0) {
  const body = Buffer.alloc(bits.length * 4);
  bits.forEach((value, index) => body.writeUInt32LE(value >>> 0, index * 4));
  return Buffer.concat([vectorHeader(Q_TYPE.real, bits.length, attribute), body]);
}

function symbolVector(values, attribute = 0) {
  return Buffer.concat([
    vectorHeader(Q_TYPE.symbol, values.length, attribute),
    ...values.map(cString),
  ]);
}

function mixedVector(values, attribute = 0) {
  return Buffer.concat([vectorHeader(0, values.length, attribute), ...values]);
}

function lambda(source) {
  return Buffer.concat([int8(100), cString(''), charVector(source)]);
}

function dictionary(keys, values) {
  return Buffer.concat([int8(Q_TYPE.dictionary), keys, values]);
}

function table(columns, vectors) {
  return Buffer.concat([
    int8(Q_TYPE.table),
    Buffer.from([0]),
    dictionary(symbolVector(columns), mixedVector(vectors)),
  ]);
}

function exactRenderingFixtures() {
  const guid = '01234567-89ab-cdef-0123-456789abcdef';
  const secondGuid = 'fedcba98-7654-3210-fedc-ba9876543210';
  const nullGuid = '00000000-0000-0000-0000-000000000000';
  return Object.freeze({
    charVector: charVector('hello'),
    charNullAtom: charAtomByte(32),
    charNulAtom: charAtomByte(0),
    emptyChar: charVector(''),
    singletonCharNull: charVector(' '),
    singletonCharNul: charVector('\0'),
    symbolAtom: symbolAtom('hello'),
    symbolNullAtom: symbolAtom(''),
    emptySymbol: symbolVector([]),
    singletonSymbolNull: symbolVector(['']),
    symbolVector: symbolVector(['hello', 'world']),
    unsafeSymbolAtom: symbolAtom('hello world'),
    guidAtom: guidAtom(guid),
    guidNullAtom: guidAtom(nullGuid),
    emptyGuid: guidVector([]),
    singletonGuid: guidVector([guid]),
    singletonGuidNull: guidVector([nullGuid]),
    multiGuid: guidVector([guid, nullGuid, secondGuid]),
    uniqueGuid: guidVector([guid, secondGuid], 2),
    singletonBoolean: booleanVector([1]),
    singletonByte: byteVector([42]),
    singletonShort: shortVector([42]),
    singletonInt: intVector([42]),
    singletonLong: longVector([9007199254740993n]),
    singletonReal: realVectorBits([0x3fc00000]),
    singletonFloat: doubleVector([1e21]),
    realSubnormalAtom: realAtomBits(0x00000001),
    singletonRealSubnormal: realVectorBits([0x00000001]),
    multiRealSubnormal: realVectorBits([0x00000001, 0x80000001, 0x00800000]),
    specialRealSubnormal: realVectorBits([
      0x00000001,
      0xffc00000,
      0x7f800000,
      0xff800000,
      0x80000000,
    ]),
    sortedRealSubnormal: realVectorBits([0x00000001, 0x00000002], 1),
    singletonUniqueRealSubnormal: realVectorBits([0x00000001], 2),
    singletonTimestamp: longVector([1n], 0, Q_TYPE.timestamp),
    negativeSubMillisecondTimestamp: longAtom(-1n, Q_TYPE.timestamp),
    multiBoolean: booleanVector([1, 0, 1]),
    multiByte: byteVector([1, 2, 255]),
    multiShort: shortVector([1, -2]),
    invalidBooleanAtom: booleanAtomByte(2),
    multiInt: intVector([1, -2147483648, 2147483647]),
    multiLong: longVector([1n, 9007199254740993n]),
    multiReal: realVectorBits([0x3fc00000, 0xc0100000]),
    multiFloat: doubleVector([1.2e-7, 5e-324]),
    multiTimestamp: longVector([0n, -9223372036854775808n, 9223372036854775807n], 0, Q_TYPE.timestamp),
    nestedMixed: mixedVector([
      symbolAtom('hello'),
      charVector('hello'),
      intVector([42]),
      mixedVector([booleanAtomByte(1), longAtom(9007199254740993n)]),
    ]),
    sortedInt: intVector([1, 2], 1),
    monthAtom: intAtom(1, Q_TYPE.month),
    dateAtom: intAtom(1, Q_TYPE.date),
    datetimeAtom: doubleAtom(1.5, Q_TYPE.datetime),
    timespanAtom: longAtom(123n, Q_TYPE.timespan),
    minuteAtom: intAtom(61, Q_TYPE.minute),
    negativeMinuteAtom: intAtom(-1, Q_TYPE.minute),
    secondAtom: intAtom(61, Q_TYPE.second),
    negativeSecondAtom: intAtom(-1, Q_TYPE.second),
    timeAtom: intAtom(1234, Q_TYPE.time),
    negativeTimeAtom: intAtom(-1, Q_TYPE.time),
    farDateAtom: intAtom(2147483646, Q_TYPE.date),
    farDatetimeAtom: doubleAtom(1e308, Q_TYPE.datetime),
    singletonMonth: intVector([1], 0, Q_TYPE.month),
    singletonDate: intVector([1], 0, Q_TYPE.date),
    singletonDatetime: doubleVector([1.5], 0, Q_TYPE.datetime),
    singletonTimespan: longVector([123n], 0, Q_TYPE.timespan),
    singletonMinute: intVector([61], 0, Q_TYPE.minute),
    singletonSecond: intVector([61], 0, Q_TYPE.second),
    singletonTime: intVector([1234], 0, Q_TYPE.time),
    multiMonth: intVector([1, 2], 0, Q_TYPE.month),
    multiDate: intVector([1, 2], 0, Q_TYPE.date),
    multiDatetime: doubleVector([1.5, 2.5], 0, Q_TYPE.datetime),
    multiTimespan: longVector([123n, 456n], 0, Q_TYPE.timespan),
    multiMinute: intVector([61, 62], 0, Q_TYPE.minute),
    multiSecond: intVector([61, 62], 0, Q_TYPE.second),
    multiTime: intVector([1234, 2345], 0, Q_TYPE.time),
  });
}

function bigEndianLongFixtures() {
  const atom = (value, type = Q_TYPE.long) => {
    const buffer = Buffer.alloc(9);
    buffer.writeInt8(-type, 0);
    buffer.writeBigInt64BE(BigInt(value), 1);
    return buffer;
  };
  const vector = (values, type = Q_TYPE.long) => {
    const header = Buffer.alloc(6);
    header.writeInt8(type, 0);
    header.writeUInt8(0, 1);
    header.writeInt32BE(values.length, 2);
    const body = Buffer.alloc(values.length * 8);
    values.forEach((value, index) => body.writeBigInt64BE(BigInt(value), index * 8));
    return Buffer.concat([header, body]);
  };
  return Object.freeze({
    finiteLongAtom: atom(9007199254740993n),
    timestampAtom: atom(-1n, Q_TYPE.timestamp),
    sentinelLongVector: vector([
      -9223372036854775808n,
      -9223372036854775807n,
      9223372036854775807n,
      9007199254740993n,
    ]),
  });
}

function temporalPersistenceTable() {
  return table([
    'month', 'date', 'datetime', 'timespan', 'minute', 'second', 'time',
    'monthVector', 'dateVector', 'datetimeVector', 'timespanVector',
    'minuteVector', 'secondVector', 'timeVector',
  ], [
    intVector([1], 0, Q_TYPE.month),
    intVector([1], 0, Q_TYPE.date),
    doubleVector([1.5], 0, Q_TYPE.datetime),
    longVector([123n], 0, Q_TYPE.timespan),
    intVector([61], 0, Q_TYPE.minute),
    intVector([61], 0, Q_TYPE.second),
    intVector([1234], 0, Q_TYPE.time),
    mixedVector([intVector([1], 0, Q_TYPE.month)]),
    mixedVector([intVector([1], 0, Q_TYPE.date)]),
    mixedVector([doubleVector([1.5], 0, Q_TYPE.datetime)]),
    mixedVector([longVector([123n], 0, Q_TYPE.timespan)]),
    mixedVector([intVector([61], 0, Q_TYPE.minute)]),
    mixedVector([intVector([61], 0, Q_TYPE.second)]),
    mixedVector([intVector([1234], 0, Q_TYPE.time)]),
  ]);
}

function realisticPersistenceTable() {
  const columns = [
    'sym',
    'chars',
    'safeLong',
    'bigLong',
    'timestamp',
    'date',
    'intNull',
    'intNegInf',
    'intInf',
    'typed',
    'symbols',
    'nested',
  ];
  return table(columns, [
    symbolVector(['hello']),
    mixedVector([charVector('hello')]),
    longVector([42n]),
    longVector([9007199254740993n]),
    longVector([1n], 0, Q_TYPE.timestamp),
    intVector([1], 0, Q_TYPE.date),
    intVector([-2147483648]),
    intVector([-2147483647]),
    intVector([2147483647]),
    mixedVector([intVector([1, 2])]),
    mixedVector([symbolVector(['hello', 'world'])]),
    mixedVector([mixedVector([
      symbolAtom('hello'),
      charVector('hello'),
      longAtom(9007199254740993n),
      longAtom(9223372036854775807n, Q_TYPE.timestamp),
      intAtom(-2147483648),
    ])]),
  ]);
}

function realisticUnsupportedPersistenceTable() {
  return table([
    'sym',
    'chars',
    'safeLong',
    'bigLong',
    'timestamp',
    'date',
    'intNull',
    'intInf',
    'unsupported',
    'typed',
    'symbols',
    'nested',
  ], [
    symbolVector(['hello']),
    mixedVector([charVector('hello')]),
    longVector([42n]),
    longVector([9007199254740993n]),
    longVector([1n], 0, Q_TYPE.timestamp),
    intVector([1], 0, Q_TYPE.date),
    intVector([-2147483648]),
    intVector([2147483647]),
    mixedVector([lambda('{x+y}')]),
    mixedVector([intVector([1, 2])]),
    mixedVector([symbolVector(['hello', 'world'])]),
    mixedVector([mixedVector([symbolAtom('hello'), charVector('hello')])]),
  ]);
}

function nestedUnsupportedPersistenceTable() {
  return table(['nested'], [
    mixedVector([mixedVector([lambda('{x+y}')])]),
  ]);
}

function attributedPersistenceTable() {
  return table(['sorted'], [intVector([1, 2], 1)]);
}

function emptyAttributedPersistenceTable() {
  return table(['sorted'], [intVector([], 1)]);
}

function dictionaryIdentityValue() {
  return dictionary(symbolVector(['key']), intVector([1]));
}

function emptyDictionaryIdentityValue() {
  return dictionary(symbolVector([]), intVector([]));
}

function keyedTableIdentityValue() {
  return dictionary(
    table(['key'], [symbolVector(['a'])]),
    table(['value'], [intVector([1])])
  );
}

function multiKeyedTableIdentityValue() {
  return dictionary(
    table([
      'sym',
      'venue',
    ], [
      symbolVector(['AAPL', 'MSFT']),
      symbolVector(['XNAS', 'XNYS']),
    ]),
    table(['price'], [intVector([101, 202])])
  );
}

function ordinaryKeyNamedTableValue() {
  return table([
    'sym',
    'venue',
    'price',
  ], [
    symbolVector(['AAPL', 'MSFT']),
    symbolVector(['XNAS', 'XNYS']),
    intVector([101, 202]),
  ]);
}

function attributedKeyedTableIdentityValue() {
  return dictionary(
    table(['key'], [symbolVector(['a', 'b'], 1)]),
    table(['value'], [intVector([1, 2])])
  );
}

function emptyKeyedTableIdentityValue() {
  return dictionary(
    table(['key'], [symbolVector([])]),
    table(['value'], [intVector([])])
  );
}

module.exports = {
  Q_TYPE,
  attributedKeyedTableIdentityValue,
  attributedPersistenceTable,
  bigEndianLongFixtures,
  dictionaryIdentityValue,
  emptyAttributedPersistenceTable,
  emptyDictionaryIdentityValue,
  emptyKeyedTableIdentityValue,
  exactRenderingFixtures,
  keyedTableIdentityValue,
  multiKeyedTableIdentityValue,
  ordinaryKeyNamedTableValue,
  realisticPersistenceTable,
  realisticUnsupportedPersistenceTable,
  nestedUnsupportedPersistenceTable,
  temporalPersistenceTable,
};
