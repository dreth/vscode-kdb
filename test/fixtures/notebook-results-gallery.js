'use strict';

// This fixture deliberately separates live-only cases from portable saved output.
// The visual Extension Host test executes liveQueries against its private loopback q
// process; savedCases are valid bounded v1 MIME bodies that remain truthful after
// reopen. A persisted fixture must never pretend its preview owns the live rows.
// This factory is the canonical complete gallery. The adjacent .ipynb intentionally
// keeps only representative table/truncation/chart outputs to contract-check a real
// persisted Jupyter shape without duplicating every payload in hand-maintained JSON.

const KX_NOTEBOOK_MIME = 'application/vnd.kx.result+json';
const BYTE_LIMIT = 1_000_000;

const liveQueries = Object.freeze([
  Object.freeze({
    id: 'table',
    title: 'Live table',
    source: '([] sym:`AAPL`MSFT`GOOG`IBM;price:189.25 414.60 174.10 302.80;size:100 250 150 300)',
  }),
  Object.freeze({
    id: 'keyed-table',
    title: 'Live keyed table',
    source: '([sym:`AAPL`MSFT`GOOG] venue:`XNAS`XNAS`XNYS;price:189.25 414.60 174.10;size:100 250 150)',
  }),
  Object.freeze({
    id: 'temporal-nulls',
    title: 'Live temporal and null values',
    source: '([] timestamp:(2026.07.27D09:30:00.000000000;0Np;2026.07.27D09:32:00.000000000);price:101.25 0n 103.75;quantity:100 0N 300;sym:`AAPL``MSFT)',
  }),
  Object.freeze({
    id: 'qtext',
    title: 'Live qText',
    source: '{[x;y] x+y}',
  }),
  Object.freeze({
    id: 'scalar',
    title: 'Live scalar',
    source: '42',
  }),
  Object.freeze({
    id: 'live-full-result',
    title: 'Live full result with bounded saved preview',
    source: '([] row:til 64;sym:64#`AAPL`MSFT`GOOG`IBM;price:100f+.25*til 64;size:100+til 64)',
  }),
  Object.freeze({
    id: 'native-error',
    title: 'Native q error',
    source: '\'"visual gallery error"',
    expectsError: true,
  }),
]);

const sharedChartColumns = Object.freeze([
  Object.freeze({ name: 'time', type: 'long' }),
  Object.freeze({ name: 'bid', type: 'float' }),
  Object.freeze({ name: 'ask', type: 'float' }),
  Object.freeze({ name: 'size', type: 'long' }),
  Object.freeze({ name: 'sym', type: 'symbol' }),
  Object.freeze({ name: 'open', type: 'float' }),
  Object.freeze({ name: 'high', type: 'float' }),
  Object.freeze({ name: 'low', type: 'float' }),
  Object.freeze({ name: 'close', type: 'float' }),
]);

const sharedChartRows = Object.freeze(Array.from({ length: 12 }, (_, index) => {
  const open = 100 + index * 0.75;
  const close = open + (index % 2 === 0 ? 0.5 : -0.25);
  return Object.freeze([
    numberCell(index + 1),
    numberCell(99.75 + index * 0.8),
    numberCell(100.25 + index * 0.8),
    numberCell(100 + index * 10),
    stringCell(index % 2 === 0 ? 'AAPL' : 'MSFT'),
    numberCell(open),
    numberCell(Math.max(open, close) + 0.65),
    numberCell(Math.min(open, close) - 0.55),
    numberCell(close),
  ]);
}));

const savedCases = Object.freeze([
  Object.freeze({
    id: 'saved-table',
    title: 'Saved table',
    source: 'savedTable',
    payload: tablePayload({
      columns: [
        { name: 'sym', type: 'symbol' },
        { name: 'timestamp', type: 'timestamp' },
        { name: 'price', type: 'float' },
        { name: 'quantity', type: 'long' },
        { name: 'note', type: 'string' },
      ],
      rows: [
        [stringCell('AAPL'), temporalCell('2026-07-27T09:30:00.000000000Z'), numberCell(189.25), numberCell(100), stringCell('opening auction')],
        [stringCell('MSFT'), nullCell(), nullCell(), numberCell(250), stringCell('temporal/null fixture')],
        [stringCell('GOOG'), temporalCell('2026-07-27T09:32:00.000000000Z'), numberCell(174.1), nullCell(), stringCell('bounded portable row')],
      ],
      label: 'Saved gallery preview',
    }),
  }),
  Object.freeze({
    id: 'saved-keyed-table',
    title: 'Saved keyed-table preview',
    source: 'savedKeyedTable',
    payload: tablePayload({
      columns: [
        { name: 'sym', type: 'symbol key' },
        { name: 'venue', type: 'symbol' },
        { name: 'price', type: 'float' },
      ],
      rows: [
        [stringCell('AAPL'), stringCell('XNAS'), numberCell(189.25)],
        [stringCell('MSFT'), stringCell('XNAS'), numberCell(414.6)],
        [stringCell('GOOG'), stringCell('XNYS'), numberCell(174.1)],
      ],
      label: 'Saved keyed-table preview',
    }),
  }),
  Object.freeze({
    id: 'saved-qtext',
    title: 'Saved qText',
    source: '{[x;y] select avg price by sym from trade where price>x}',
    payload: qTextPayload(
      '{[x;y] select avg price by sym from trade where price>x}',
      'Saved qText preview'
    ),
  }),
  Object.freeze({
    id: 'saved-scalar',
    title: 'Saved scalar',
    source: '42',
    payload: tablePayload({
      columns: [{ name: 'value', type: 'long' }],
      rows: [[numberCell(42)]],
      label: 'Saved scalar preview',
    }),
  }),
  Object.freeze({
    id: 'truncated-saved-preview',
    title: 'Truncated saved preview',
    source: 'select from largeTable',
    payload: tablePayload({
      columns: [
        { name: 'row', type: 'long' },
        { name: 'sym', type: 'symbol' },
        { name: 'price', type: 'float' },
      ],
      rows: Array.from({ length: 6 }, (_, index) => [
        numberCell(index),
        stringCell(index % 2 === 0 ? 'AAPL' : 'MSFT'),
        numberCell(100 + index * 0.25),
      ]),
      rowCount: 128,
      rowLimit: 6,
      truncationReasons: ['rowLimit'],
      label: 'Saved preview only — rerun for a current live result',
      marker: 'direct-ipc',
    }),
  }),
  ...['line', 'scatter', 'step', 'bar', 'box'].map(type => Object.freeze({
    id: `chart-${type}`,
    title: `${titleCase(type)} chart`,
    source: `gallery ${type} chart`,
    payload: tablePayload({
      columns: sharedChartColumns,
      rows: sharedChartRows,
      label: `${titleCase(type)} chart gallery`,
      chart: {
        version: 1,
        visible: true,
        type,
        xColumn: 'time',
        yColumns: type === 'box' ? ['bid', 'ask'] : ['bid', 'ask'],
        ...(type === 'line' ? { groupByColumn: 'sym' } : {}),
        title: `${titleCase(type)} gallery`,
      },
    }),
  })),
  Object.freeze({
    id: 'chart-candlestick',
    title: 'Candlestick chart',
    source: 'gallery candlestick chart',
    payload: tablePayload({
      columns: sharedChartColumns,
      rows: sharedChartRows,
      label: 'Candlestick chart gallery',
      chart: {
        version: 1,
        visible: true,
        type: 'candlestick',
        xColumn: 'time',
        yColumns: [],
        openColumn: 'open',
        highColumn: 'high',
        lowColumn: 'low',
        closeColumn: 'close',
        title: 'Candlestick gallery',
      },
    }),
  }),
  Object.freeze({
    id: 'chart-all-null',
    title: 'All-null chart guard',
    source: 'gallery all-null chart',
    payload: tablePayload({
      columns: [
        { name: 'time', type: 'long' },
        { name: 'empty', type: 'float' },
        { name: 'valid', type: 'float' },
      ],
      rows: Array.from({ length: 6 }, (_, index) => [
        numberCell(index + 1),
        nullCell(),
        numberCell(10 + index),
      ]),
      label: 'All-null chart gallery',
      chart: {
        version: 1,
        visible: true,
        type: 'line',
        xColumn: 'time',
        yColumns: ['empty'],
        title: 'All-null guard',
      },
    }),
  }),
]);

const expectedCaseIds = Object.freeze([
  'table',
  'keyed-table',
  'temporal-nulls',
  'qtext',
  'scalar',
  'native-error',
  'truncated-saved-preview',
  'live-full-result',
  'chart-line',
  'chart-scatter',
  'chart-step',
  'chart-bar',
  'chart-box',
  'chart-candlestick',
]);

function tablePayload({
  columns,
  rows,
  rowCount = rows.length,
  rowLimit = Math.max(20, rows.length),
  truncationReasons = [],
  label,
  marker = '%%q',
  chart,
}) {
  const previewRowCount = rows.length;
  const payload = {
    version: 1,
    kind: 'table',
    schema: { columns: columns.map(column => ({ ...column })) },
    data: { encoding: 'rows', rows: rows.map(row => row.map(cell => ({ ...cell }))) },
    result: {
      rowCount,
      previewRowCount,
      truncated: truncationReasons.length > 0,
      truncationReasons: truncationReasons.slice(),
      rowLimit,
      byteLimit: BYTE_LIMIT,
    },
    provenance: {
      marker,
      label,
      elapsedMs: 12.5,
    },
  };
  if (chart) {
    payload.chart = { ...chart, yColumns: chart.yColumns.slice() };
  }
  return deepFreeze(payload);
}

function qTextPayload(text, label) {
  return deepFreeze({
    version: 1,
    kind: 'qText',
    data: { text },
    result: {
      truncated: false,
      truncationReasons: [],
      byteLimit: BYTE_LIMIT,
    },
    provenance: {
      marker: '%%q',
      label,
      elapsedMs: 1.25,
    },
  });
}

function nullCell() {
  return Object.freeze({ kind: 'null' });
}

function numberCell(value) {
  return Object.freeze({ kind: 'number', value });
}

function stringCell(value) {
  return Object.freeze({ kind: 'string', value });
}

function temporalCell(value) {
  return Object.freeze({ kind: 'temporal', value });
}

function titleCase(value) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

module.exports = {
  BYTE_LIMIT,
  KX_NOTEBOOK_MIME,
  expectedCaseIds,
  liveQueries,
  savedCases,
};
