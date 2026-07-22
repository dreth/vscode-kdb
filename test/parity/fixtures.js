'use strict';

// Shared, deterministic inputs for the standalone/reference parity adapters.
// This module intentionally has no dependency on either extension's runtime.

const Q_TYPE = Object.freeze({
  boolean: 1,
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
  error: -128,
});

function qInt8(value) {
  const buffer = Buffer.alloc(1);
  buffer.writeInt8(Number(value), 0);
  return buffer;
}

function qCString(value) {
  return Buffer.from(`${String(value)}\0`, 'utf8');
}

function qVectorHeader(type, length, attribute = 0) {
  const buffer = Buffer.alloc(6);
  buffer.writeInt8(type, 0);
  buffer.writeUInt8(attribute, 1);
  buffer.writeInt32LE(length, 2);
  return buffer;
}

function qBooleanAtom(value) {
  return Buffer.from([-Q_TYPE.boolean & 0xff, value ? 1 : 0]);
}

function qByteAtom(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeInt8(-Q_TYPE.byte, 0);
  buffer.writeUInt8(value, 1);
  return buffer;
}

function qShortAtom(value) {
  const buffer = Buffer.alloc(3);
  buffer.writeInt8(-Q_TYPE.short, 0);
  buffer.writeInt16LE(value, 1);
  return buffer;
}

function qIntAtom(value) {
  const buffer = Buffer.alloc(5);
  buffer.writeInt8(-Q_TYPE.int, 0);
  buffer.writeInt32LE(value, 1);
  return buffer;
}

function qLongAtom(value) {
  const buffer = Buffer.alloc(9);
  buffer.writeInt8(-Q_TYPE.long, 0);
  buffer.writeBigInt64LE(BigInt(value), 1);
  return buffer;
}

function qRealAtom(value) {
  const buffer = Buffer.alloc(5);
  buffer.writeInt8(-Q_TYPE.real, 0);
  buffer.writeFloatLE(value, 1);
  return buffer;
}

function qFloatAtom(value) {
  const buffer = Buffer.alloc(9);
  buffer.writeInt8(-Q_TYPE.float, 0);
  buffer.writeDoubleLE(value, 1);
  return buffer;
}

function qCharAtom(value) {
  const encoded = Buffer.from(String(value), 'utf8');
  if (encoded.length !== 1) {
    throw new Error('qCharAtom requires exactly one UTF-8 byte.');
  }
  return Buffer.from([-Q_TYPE.char & 0xff, encoded[0]]);
}

function qSymbolAtom(value) {
  return Buffer.concat([qInt8(-Q_TYPE.symbol), qCString(value)]);
}

function qTemporalIntAtom(type, value) {
  if (![Q_TYPE.month, Q_TYPE.date, Q_TYPE.minute, Q_TYPE.second, Q_TYPE.time].includes(type)) {
    throw new Error(`qTemporalIntAtom does not support q type ${type}.`);
  }
  const buffer = Buffer.alloc(5);
  buffer.writeInt8(-type, 0);
  buffer.writeInt32LE(value, 1);
  return buffer;
}

function qTemporalLongAtom(type, value) {
  if (![Q_TYPE.timestamp, Q_TYPE.timespan].includes(type)) {
    throw new Error(`qTemporalLongAtom does not support q type ${type}.`);
  }
  const buffer = Buffer.alloc(9);
  buffer.writeInt8(-type, 0);
  buffer.writeBigInt64LE(BigInt(value), 1);
  return buffer;
}

function qBooleanVector(values) {
  const body = Buffer.from(values.map(value => value ? 1 : 0));
  return Buffer.concat([qVectorHeader(Q_TYPE.boolean, values.length), body]);
}

function qByteVector(values) {
  const body = Buffer.from(values.map(value => Number(value)));
  return Buffer.concat([qVectorHeader(Q_TYPE.byte, values.length), body]);
}

function qShortVector(values) {
  const body = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => body.writeInt16LE(value, index * 2));
  return Buffer.concat([qVectorHeader(Q_TYPE.short, values.length), body]);
}

function qIntVector(values) {
  const body = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => body.writeInt32LE(value, index * 4));
  return Buffer.concat([qVectorHeader(Q_TYPE.int, values.length), body]);
}

function qLongVector(values) {
  const body = Buffer.alloc(values.length * 8);
  values.forEach((value, index) => body.writeBigInt64LE(BigInt(value), index * 8));
  return Buffer.concat([qVectorHeader(Q_TYPE.long, values.length), body]);
}

function qRealVector(values) {
  const body = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => body.writeFloatLE(value, index * 4));
  return Buffer.concat([qVectorHeader(Q_TYPE.real, values.length), body]);
}

function qFloatVector(values) {
  const body = Buffer.alloc(values.length * 8);
  values.forEach((value, index) => body.writeDoubleLE(value, index * 8));
  return Buffer.concat([qVectorHeader(Q_TYPE.float, values.length), body]);
}

function qCharVector(value) {
  const body = Buffer.from(String(value), 'utf8');
  return Buffer.concat([qVectorHeader(Q_TYPE.char, body.length), body]);
}

function qSymbolVector(values) {
  return Buffer.concat([
    qVectorHeader(Q_TYPE.symbol, values.length),
    ...values.map(value => qCString(value)),
  ]);
}

function qGenericList(items) {
  return Buffer.concat([qVectorHeader(0, items.length), ...items]);
}

function qDictionary(keys, values) {
  return Buffer.concat([qInt8(Q_TYPE.dictionary), keys, values]);
}

function qTable(columns, vectors) {
  if (columns.length !== vectors.length) {
    throw new Error(`qTable received ${columns.length} columns and ${vectors.length} vectors.`);
  }
  return Buffer.concat([
    qInt8(Q_TYPE.table),
    Buffer.from([0]),
    qDictionary(qSymbolVector(columns), qGenericList(vectors)),
  ]);
}

function qKeyedTable(keyColumns, keyVectors, valueColumns, valueVectors) {
  return qDictionary(
    qTable(keyColumns, keyVectors),
    qTable(valueColumns, valueVectors)
  );
}

function qLambda(source) {
  return Buffer.concat([qInt8(100), qCString(''), qCharVector(source)]);
}

function qPrimitive(opcode = 1) {
  return Buffer.concat([qInt8(101), qInt8(opcode)]);
}

function qOperator(opcode = 1) {
  return Buffer.concat([qInt8(102), qInt8(opcode)]);
}

function qProjection(items) {
  const length = Buffer.alloc(4);
  length.writeInt32LE(items.length, 0);
  return Buffer.concat([qInt8(104), length, ...items]);
}

function qComposition(items) {
  const length = Buffer.alloc(4);
  length.writeInt32LE(items.length, 0);
  return Buffer.concat([qInt8(105), length, ...items]);
}

function qError(message) {
  return Buffer.concat([qInt8(Q_TYPE.error), qCString(message)]);
}

function qMessage(payload, options = {}) {
  const littleEndian = options.littleEndian !== false;
  const messageType = options.messageType === undefined ? 2 : options.messageType;
  const message = Buffer.alloc(8 + payload.length);
  message.writeUInt8(littleEndian ? 1 : 0, 0);
  message.writeUInt8(messageType, 1);
  message.writeUInt8(0, 2);
  message.writeUInt8(0, 3);
  if (littleEndian) {
    message.writeInt32LE(message.length, 4);
  } else {
    message.writeInt32BE(message.length, 4);
  }
  payload.copy(message, 8);
  return message;
}

function qResponse(payload, options) {
  return qMessage(payload, { ...(options || {}), messageType: 2 });
}

function createIpcFixtures() {
  return [
    {
      id: 'scalar-int',
      family: 'primitive',
      payload: qIntAtom(42),
      expectedCanonical: 42,
      displayCases: [{ options: {}, mode: 'grid', kind: 'scalar' }],
    },
    {
      id: 'vector-int',
      family: 'vector',
      payload: qIntVector([1, -2, 3]),
      expectedCanonical: [1, -2, 3],
      displayCases: [
        { options: {}, mode: 'grid', kind: 'list' },
        { options: { listDisplayStrategy: 'qText' }, mode: 'text', kind: 'list' },
      ],
    },
    {
      id: 'mixed-list',
      family: 'list',
      payload: qGenericList([qIntAtom(1), qCharVector('alpha'), qBooleanAtom(true)]),
      expectedCanonical: [1, 'alpha', true],
      displayCases: [
        { options: {}, mode: 'grid', kind: 'list' },
        { options: { listDisplayStrategy: 'qText' }, mode: 'text', kind: 'list' },
      ],
    },
    {
      id: 'dictionary',
      family: 'dictionary',
      payload: qDictionary(qSymbolVector(['alpha', 'beta']), qIntVector([10, 20])),
      expectedCanonical: {
        $q: 'dictionary',
        entries: [
          { key: 'alpha', value: 10 },
          { key: 'beta', value: 20 },
        ],
      },
      displayCases: [
        { options: {}, mode: 'grid', kind: 'dictionary' },
        { options: { dictionaryDisplayStrategy: 'qText' }, mode: 'text', kind: 'dictionary' },
      ],
    },
    {
      id: 'table',
      family: 'table',
      payload: qTable(
        ['sym', 'size', 'price'],
        [qSymbolVector(['AAPL', 'MSFT']), qIntVector([100, 250]), qFloatVector([123.45, 234.56])]
      ),
      expectedCanonical: {
        $q: 'table',
        columns: ['sym', 'size', 'price'],
        rowCount: 2,
        rows: [
          ['AAPL', 100, 123.45],
          ['MSFT', 250, 234.56],
        ],
      },
      displayCases: [
        { options: {}, mode: 'grid', kind: 'table' },
        { options: { objectDisplayStrategy: 'qText' }, mode: 'grid', kind: 'table' },
      ],
    },
    {
      id: 'keyed-table',
      family: 'keyed-table',
      payload: qKeyedTable(
        ['sym'],
        [qSymbolVector(['AAPL', 'MSFT'])],
        ['bid', 'ask'],
        [qFloatVector([123.4, 234.5]), qFloatVector([123.5, 234.6])]
      ),
      expectedCanonical: {
        $q: 'keyedTable',
        columns: ['sym', 'bid', 'ask'],
        rowCount: 2,
        rows: [
          ['AAPL', 123.4, 123.5],
          ['MSFT', 234.5, 234.6],
        ],
      },
      displayCases: [{ options: {}, mode: 'grid', kind: 'keyed table' }],
    },
    {
      id: 'lambda',
      family: 'function',
      payload: qLambda('{x+1}'),
      expectedCanonical: { $q: 'function', functionType: 'lambda', ipcType: 100, source: '{x+1}' },
      displayCases: [
        { options: {}, mode: 'text', kind: 'function' },
        { options: { functionDisplayStrategy: 'grid' }, mode: 'grid', kind: 'function' },
      ],
    },
    {
      id: 'primitive-function',
      family: 'function',
      payload: qPrimitive(1),
      expectedCanonical: { $q: 'function', functionType: 'primitive', ipcType: 101 },
      displayCases: [{ options: {}, mode: 'text', kind: 'function' }],
    },
    {
      id: 'q-error',
      family: 'error',
      payload: qError('crossParityBoom'),
      expectedError: { name: 'KdbQError', classification: 'q-error', message: 'crossParityBoom' },
    },
  ].map(fixture => ({ ...fixture, frame: qResponse(fixture.payload) }));
}

const SELECTION_FIXTURES = Object.freeze([
  {
    id: 'physical-current-line',
    documentText: 'first:1\n  second + 2  \nthird:3',
    selectionText: '',
    cursorLine: 1,
    expectedCurrentLine: '  second + 2  ',
    expectedExecutionKind: 'query',
  },
  {
    id: 'selection-wins-exactly',
    documentText: 'first:1\nsecond:2',
    selectionText: '  first:10\nsecond:20  ',
    cursorLine: 0,
    expectedCurrentLine: '  first:10\nsecond:20  ',
    expectedExecutionKind: 'script',
  },
  {
    id: 'whitespace-selection-is-not-empty',
    documentText: 'first:1',
    selectionText: '  ',
    cursorLine: 0,
    expectedCurrentLine: '  ',
    expectedExecutionKind: 'query',
  },
  {
    id: 'crlf-current-line',
    documentText: 'first:1\r\nsecond:2\r\nthird:3',
    selectionText: '',
    cursorLine: 1,
    expectedCurrentLine: 'second:2',
    expectedExecutionKind: 'query',
  },
  {
    id: 'cursor-clamps-low',
    documentText: 'first:1\nsecond:2',
    selectionText: '',
    cursorLine: -10,
    expectedCurrentLine: 'first:1',
    expectedExecutionKind: 'query',
  },
  {
    id: 'cursor-clamps-high',
    documentText: 'first:1\nsecond:2',
    selectionText: '',
    cursorLine: 99,
    expectedCurrentLine: 'second:2',
    expectedExecutionKind: 'query',
  },
]);

const BLOCK_FIXTURES = Object.freeze([
  {
    id: 'multiline-function-block',
    documentText: '.data.gateway:{[query;db]\n  neg[gatewayHandle](`.gw.asyncExec;query;db)\n}\n\nselect from trade',
    selectionText: '',
    cursorLine: 1,
    expectedBlock: '.data.gateway:{[query;db]\n  neg[gatewayHandle](`.gw.asyncExec;query;db)\n}',
  },
  {
    id: 'blank-line-has-empty-block',
    documentText: 'a:1\n\nb:2',
    selectionText: '',
    cursorLine: 1,
    expectedBlock: '',
  },
  {
    id: 'selected-block-wins',
    documentText: 'a:1\n\nb:2',
    selectionText: '  a:10\nb:20  ',
    cursorLine: 2,
    expectedBlock: '  a:10\nb:20  ',
  },
  {
    id: 'crlf-block-normalizes-joins',
    documentText: 'a:1\r\nb:2\r\n\r\nc:3',
    selectionText: '',
    cursorLine: 1,
    expectedBlock: 'a:1\nb:2',
  },
]);

const SCRIPT_GROUPING_FIXTURES = Object.freeze([
  {
    id: 'single-line-query',
    text: 'select from trade',
    expectedExecutionKind: 'query',
  },
  {
    id: 'lf-multiline-script',
    text: 'selectionA:10\nselectionB:20\nselectionA+selectionB',
    expectedExecutionKind: 'script',
    expectedLiveResult: 30,
  },
  {
    id: 'crlf-multiline-script',
    text: 'scriptFn:{[x]\r\n x+1\r\n }\r\nscriptFn 4',
    expectedExecutionKind: 'script',
    expectedLiveResult: 5,
  },
]);

function createChartFixtures() {
  const groupedRows = [
    { x: 1, value: 10, value2: 100, group: 'A' },
    { x: 1, value: 20, value2: 200, group: 'B' },
    { x: 2, value: 30, value2: 300, group: 'A' },
    { x: 2, value: 40, value2: 400, group: 'B' },
  ];
  const spikeRows = Array.from({ length: 100 }, (_unused, index) => ({
    x: index,
    value: index === 50 ? 999 : 0,
  }));

  return [
    {
      id: 'line-temporal-unsorted',
      rows: [
        { ts: '2024-01-03', price: 10, size: 100 },
        { ts: '2024-01-01', price: null, size: 200 },
        { ts: '2024-01-02', price: 5, size: 150 },
      ],
      columns: ['ts', 'price', 'size'],
      request: { chartType: 'line', version: 1, requestId: 1, xColumn: 'ts', yColumns: ['price'], width: 800 },
    },
    {
      id: 'scatter-multiple-series',
      rows: groupedRows,
      columns: ['x', 'value', 'value2', 'group'],
      request: { chartType: 'scatter', version: 1, requestId: 2, xColumn: 'x', yColumns: ['value', 'value2'], width: 800 },
    },
    {
      id: 'step-grouped',
      rows: groupedRows,
      columns: ['x', 'value', 'value2', 'group'],
      request: { chartType: 'step', version: 1, requestId: 3, xColumn: 'x', yColumns: ['value'], groupByColumn: 'group', width: 800 },
    },
    {
      id: 'bar-grouped',
      rows: groupedRows,
      columns: ['x', 'value', 'value2', 'group'],
      request: { chartType: 'bar', version: 1, requestId: 4, xColumn: 'x', yColumns: ['value'], groupByColumn: 'group', width: 800 },
    },
    {
      id: 'box-repeated-x',
      rows: [
        { bucket: 1, price: 1 },
        { bucket: 1, price: 3 },
        { bucket: 2, price: 10 },
        { bucket: 2, price: 20 },
        { bucket: 2, price: 30 },
      ],
      columns: ['bucket', 'price'],
      request: { chartType: 'box', version: 1, requestId: 5, xColumn: 'bucket', yColumns: ['price'], width: 800 },
    },
    {
      id: 'candlestick-ohlc-aggregation',
      rows: [
        { x: 1, open: 10, high: 12, low: 8, close: 11 },
        { x: 1, open: 11, high: 15, low: 9, close: 13 },
        { x: 2, open: 14, high: 18, low: 12, close: 17 },
        { x: 3, open: 20, high: 23, low: 19, close: 22 },
        { x: 4, open: 22, high: 26, low: 21, close: 25 },
      ],
      columns: ['x', 'open', 'high', 'low', 'close'],
      request: {
        chartType: 'candlestick',
        version: 1,
        requestId: 6,
        xColumn: 'x',
        openColumn: 'open',
        highColumn: 'high',
        lowColumn: 'low',
        closeColumn: 'close',
        width: 2,
        maxSampledPoints: 2,
      },
    },
    {
      id: 'line-minmax-sampling',
      rows: spikeRows,
      columns: ['x', 'value'],
      request: { chartType: 'line', version: 1, requestId: 7, xColumn: 'x', yColumns: ['value'], width: 10, maxSampledPoints: 10 },
    },
    {
      id: 'candlestick-invalid-high',
      rows: [{ x: 1, open: 10, high: 9, low: 7, close: 11 }],
      columns: ['x', 'open', 'high', 'low', 'close'],
      request: {
        chartType: 'candlestick',
        version: 1,
        requestId: 8,
        xColumn: 'x',
        openColumn: 'open',
        highColumn: 'high',
        lowColumn: 'low',
        closeColumn: 'close',
        width: 800,
      },
      expectedErrorPattern: /High 9 must be greater than or equal to Open and Close/,
    },
  ];
}

function createExportFixture() {
  return {
    rows: [
      { '#': 'user-1', sym: 'A|B', note: 'line\nbreak', size: 100, nums: [1, 2, 3], meta: { venue: 'lit' } },
      { '#': 'user-2', sym: 'MSFT', note: null, size: 200, nums: [4, 5], meta: { venue: 'dark', quote: 'a"b' } },
    ],
    columns: ['#', 'sym', 'note', 'size', 'nums', 'meta'],
    range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 5 },
    options: { includeHeaders: true, includeRowIndex: true, arrayDisplayFormat: 'commaSpace' },
    formats: ['tsv', 'csv', 'json', 'ndjson', 'html', 'markdown'],
  };
}

const XLSX_LIMIT_FIXTURES = Object.freeze([
  {
    id: 'at-excel-sheet-limits',
    range: { startRow: 0, endRow: 1048574, startColumn: 0, endColumn: 16382 },
    options: { includeHeaders: true, includeRowIndex: true },
    expectedValid: true,
  },
  {
    id: 'row-limit-exceeded-by-header',
    range: { startRow: 0, endRow: 1048575, startColumn: 0, endColumn: 0 },
    options: { includeHeaders: true, includeRowIndex: false },
    expectedValid: false,
    expectedMessagePattern: /rows/,
  },
  {
    id: 'column-limit-exceeded-by-index',
    range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 16383 },
    options: { includeHeaders: false, includeRowIndex: true },
    expectedValid: false,
    expectedMessagePattern: /columns/,
  },
]);

function createLocalServerFixture() {
  return {
    metadata: {
      version: 7,
      columns: ['time', 'price', 'sym'],
      query: 'select from trade',
      connectionName: 'parity-local-q',
    },
    rows: [
      { time: '2024-01-01', price: 1.5, sym: 'AAPL' },
      { time: '2024-01-02', price: 2.5, sym: 'MSFT' },
    ],
    columns: ['time', 'price', 'sym'],
    selectionRange: { startRow: 0, endRow: 0, startColumn: 1, endColumn: 2 },
    cellTextOptions: { arrayDisplayFormat: 'commaSpace' },
    requests: [
      { id: 'metadata-json', method: 'GET', endpoint: 'metadata.json', expectedStatus: 200, format: 'json' },
      { id: 'current-csv', method: 'GET', endpoint: 'current.csv', expectedStatus: 200, format: 'csv' },
      { id: 'current-json', method: 'GET', endpoint: 'current.json', expectedStatus: 200, format: 'json' },
      { id: 'current-ndjson', method: 'GET', endpoint: 'current.ndjson', expectedStatus: 200, format: 'ndjson' },
      { id: 'slice-csv', method: 'GET', endpoint: 'slice.csv?rowStart=1&rowCount=1&colStart=1&colCount=1', expectedStatus: 200, format: 'csv' },
      { id: 'slice-json', method: 'GET', endpoint: 'slice.json?rowStart=0&rowCount=1&colStart=0&colCount=2', expectedStatus: 200, format: 'json' },
      { id: 'selection-csv', method: 'GET', endpoint: 'selection.csv', expectedStatus: 200, format: 'csv' },
      { id: 'selection-json', method: 'GET', endpoint: 'selection.json', expectedStatus: 200, format: 'json' },
      { id: 'invalid-slice', method: 'GET', endpoint: 'slice.csv?rowStart=-1&rowCount=1&colStart=0&colCount=1', expectedStatus: 400, expectedErrorCode: 'invalid_slice' },
      { id: 'unknown-endpoint', method: 'GET', endpoint: 'unknown.json', expectedStatus: 404, expectedErrorCode: 'unknown_endpoint' },
      { id: 'method-not-allowed', method: 'POST', endpoint: 'current.csv', expectedStatus: 405, expectedErrorCode: 'method_not_allowed' },
    ],
  };
}

function createOversizedLocalServerFixture(fullExportCellLimit = 1000000) {
  const columnCount = 1001;
  return {
    metadata: { version: 8, columns: [] },
    columns: Array.from({ length: columnCount }, (_unused, index) => `c${index}`),
    rowCount: Math.ceil(fullExportCellLimit / columnCount) + 1,
    cellValue: () => 1,
    fullExportCellLimit,
    expectedStatus: 413,
    expectedErrorCode: 'full_export_too_large',
  };
}

const LIVE_QUERY_FIXTURES = Object.freeze([
  { id: 'scalar', family: 'primitive', query: '42', expectedCanonical: 42 },
  { id: 'vector', family: 'vector', query: '1 2 3', expectedCanonical: [1, 2, 3] },
  { id: 'mixed-list', family: 'list', query: '(1;"alpha";1b)', expectedCanonical: [1, 'alpha', true] },
  {
    id: 'dictionary',
    family: 'dictionary',
    query: '`alpha`beta!10 20',
    expectedCanonical: {
      $q: 'dictionary',
      entries: [{ key: 'alpha', value: 10 }, { key: 'beta', value: 20 }],
    },
  },
  {
    id: 'table',
    family: 'table',
    query: '([]sym:`AAPL`MSFT;size:100 250i;price:123.45 234.56)',
    expectedColumns: ['sym', 'size', 'price'],
  },
  {
    id: 'keyed-table',
    family: 'keyed-table',
    query: '([sym:`AAPL`MSFT]bid:123.4 234.5;ask:123.5 234.6)',
    expectedColumns: ['sym', 'bid', 'ask'],
  },
  { id: 'lambda', family: 'function', query: '{x+1}', expectedFunctionType: 'lambda' },
  { id: 'primitive-function', family: 'function', query: 'first', expectedFunctionType: 'primitive' },
  {
    id: 'temporal-values',
    family: 'temporal',
    query: '(2024.01.02;2024.01.02D09:30:00.123456789;0D00:00:00.123456789)',
  },
  {
    id: 'genuine-q-error',
    family: 'error',
    query: 'missingCrossParityLiveSymbol',
    expectedErrorName: 'KdbQError',
    expectedErrorPattern: /missingCrossParityLiveSymbol/,
  },
]);

const LIVE_NAMESPACE_FIXTURES = Object.freeze([
  { id: 'root-passthrough', namespace: '.', query: '1+1', expected: 2 },
  { id: 'analytics-query', namespace: '.analytics', query: 'answer', expected: 42 },
  { id: 'analytics-error', namespace: '.analytics', query: 'missingCrossParityNamespaceSymbol', expectedErrorPattern: /missingCrossParityNamespaceSymbol/ },
]);

module.exports = {
  Q_TYPE,
  SELECTION_FIXTURES,
  BLOCK_FIXTURES,
  SCRIPT_GROUPING_FIXTURES,
  XLSX_LIMIT_FIXTURES,
  LIVE_QUERY_FIXTURES,
  LIVE_NAMESPACE_FIXTURES,
  createIpcFixtures,
  createChartFixtures,
  createExportFixture,
  createLocalServerFixture,
  createOversizedLocalServerFixture,
  qInt8,
  qCString,
  qVectorHeader,
  qBooleanAtom,
  qByteAtom,
  qShortAtom,
  qIntAtom,
  qLongAtom,
  qRealAtom,
  qFloatAtom,
  qCharAtom,
  qSymbolAtom,
  qTemporalIntAtom,
  qTemporalLongAtom,
  qBooleanVector,
  qByteVector,
  qShortVector,
  qIntVector,
  qLongVector,
  qRealVector,
  qFloatVector,
  qCharVector,
  qSymbolVector,
  qGenericList,
  qDictionary,
  qTable,
  qKeyedTable,
  qLambda,
  qPrimitive,
  qOperator,
  qProjection,
  qComposition,
  qError,
  qMessage,
  qResponse,
};
