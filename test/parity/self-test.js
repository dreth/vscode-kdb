'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');

const fixtures = require('./fixtures');
const { buildSummary, renderMarkdown, validateEvidence } = require('./report');
const {
  assertStrictStandaloneState,
  referenceStatusSnapshot,
  runCheckedCommand,
  runReferenceCommand,
} = require('../../scripts/run-cross-parity');
const {
  assertExpectedRevision,
  assertReferenceStatus,
  canonicalChart,
  canonicalError,
  canonicalLocalHttp,
  canonicalPanel,
  canonicalQValue,
  canonicalXlsxStructure,
  classifyError,
  normalizeRuntimeText,
  parseGitPorcelain,
  summarizeStatuses,
} = require('./canonical');

const tests = [
  ['IPC and product fixtures are deterministic', testFixtures],
  ['q values preserve semantic distinctions', testCanonicalQValues],
  ['grid and qText panels stay distinct', testCanonicalPanels],
  ['IPC errors normalize only runtime details', testCanonicalErrors],
  ['chart canonicalization preserves data contracts', testCanonicalCharts],
  ['local HTTP canonicalization preserves formats', testCanonicalHttp],
  ['XLSX canonicalization ignores ZIP metadata', testCanonicalXlsx],
  ['status summaries classify every outcome', testStatusSummary],
  ['revision and reference dirty-state checks fail closed', testReferenceGuards],
  ['runner preflight failures are transparent', testRunnerPreflightFailures],
  ['failed commands retain reference-state and timeout failures', testGuardedCommandFailures],
  ['evidence schema and Markdown counts fail closed', testEvidenceReport],
];

async function run() {
  for (const [name, test] of tests) {
    await test();
    process.stdout.write(`ok - ${name}\n`);
  }
  process.stdout.write(`\n${tests.length} parity support test groups passed.\n`);
}

function testFixtures() {
  assert.strictEqual(fixtures.qIntAtom(42).toString('hex'), 'fa2a000000');
  assert.strictEqual(fixtures.qBooleanAtom(true).toString('hex'), 'ff01');
  assert.strictEqual(fixtures.qCharVector('abc').toString('hex'), '0a0003000000616263');
  assert.strictEqual(fixtures.qIntVector([1, -2]).toString('hex'), '06000200000001000000feffffff');

  const response = fixtures.qResponse(fixtures.qIntAtom(42));
  assert.strictEqual(response.readUInt8(0), 1);
  assert.strictEqual(response.readUInt8(1), 2);
  assert.strictEqual(response.readInt32LE(4), response.length);

  const first = fixtures.createIpcFixtures();
  const second = fixtures.createIpcFixtures();
  assert.notStrictEqual(first[0].payload, second[0].payload, 'fixture buffers must be fresh per call');
  assert.deepStrictEqual(
    [...new Set(first.map(fixture => fixture.family))].sort(),
    ['dictionary', 'error', 'function', 'keyed-table', 'list', 'primitive', 'table', 'vector']
  );
  assert.strictEqual(first.every(fixture => Buffer.isBuffer(fixture.frame)), true);

  assert.deepStrictEqual(
    fixtures.createChartFixtures().map(fixture => fixture.request.chartType),
    ['line', 'scatter', 'step', 'bar', 'box', 'candlestick', 'line', 'candlestick']
  );
  assert.deepStrictEqual(fixtures.createExportFixture().formats, ['tsv', 'csv', 'json', 'ndjson', 'html', 'markdown']);
  assert.ok(fixtures.createLocalServerFixture().requests.some(request => request.id === 'invalid-slice'));
  assert.ok(fixtures.LIVE_QUERY_FIXTURES.some(fixture => fixture.family === 'error'));
}

function testCanonicalQValues() {
  assert.deepStrictEqual(canonicalQValue([NaN, Infinity, -Infinity, -0, 42n]), [
    { $number: 'NaN' },
    { $number: 'Infinity' },
    { $number: '-Infinity' },
    { $number: '-0' },
    { $bigint: '42' },
  ]);
  assert.deepStrictEqual(canonicalQValue({ z: 1, a: 2 }), { a: 2, z: 1 });

  const table = {
    qtype: 'table',
    columns: ['sym', 'size'],
    rowCount: 2,
    rows: [{ sym: 'AAPL', size: 100 }, { sym: 'MSFT', size: 250 }],
    columnData: [['AAPL', 'MSFT'], [100, 250]],
  };
  assert.deepStrictEqual(canonicalQValue(table), {
    $q: 'table',
    columns: ['sym', 'size'],
    rowCount: 2,
    rows: [['AAPL', 100], ['MSFT', 250]],
  });

  assert.deepStrictEqual(canonicalQValue({
    qtype: 'dict',
    keys: ['a', 'b'],
    values: [1, 2],
    entries: [{ key: 'a', value: 1 }, { key: 'b', value: 2 }],
  }), {
    $q: 'dictionary',
    entries: [{ key: 'a', value: 1 }, { key: 'b', value: 2 }],
  });

  assert.deepStrictEqual(canonicalQValue({
    qtype: 'function',
    functionType: 'lambda',
    ipcType: 100,
    source: '{x+1}\r\n',
  }), {
    $q: 'function',
    functionType: 'lambda',
    ipcType: 100,
    source: '{x+1}\n',
  });

  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalQValue(cyclic), /cyclic value/);
  assert.throws(() => canonicalQValue({ callback() {} }), /Cannot canonicalize function/);
}

function testCanonicalPanels() {
  const values = [
    ['AAPL', 100],
    ['MSFT', 250],
  ];
  const panel = {
    mode: 'grid',
    kind: 'table',
    cols: ['sym', 'size'],
    rowsMaterialized: false,
    result: {
      columns: ['sym', 'size'],
      rowCount: 2,
      cellValue: (row, column) => values[row][column],
      cellText: (row, column) => String(values[row][column]),
    },
  };
  assert.deepStrictEqual(canonicalPanel(panel), {
    mode: 'grid',
    kind: 'table',
    columns: ['sym', 'size'],
    rowCount: 2,
    values,
    text: [['AAPL', '100'], ['MSFT', '250']],
    rowsMaterialized: false,
  });
  assert.deepStrictEqual(canonicalPanel({
    mode: 'text',
    kind: 'function',
    text: '{x+1}\r\n',
    rowsMaterialized: true,
  }), {
    mode: 'text',
    kind: 'function',
    text: '{x+1}\n',
    rowsMaterialized: true,
  });
  assert.throws(
    () => canonicalPanel({ ...panel, result: { ...panel.result, rowCount: 1000 } }, { maxCells: 10 }),
    /limited to 10 cells/
  );
}

function testCanonicalErrors() {
  const qError = Object.assign(new Error('missingParitySymbol'), { name: 'KdbQError' });
  assert.strictEqual(classifyError(qError), 'q-error');
  assert.deepStrictEqual(canonicalError(qError), {
    name: 'KdbQError',
    classification: 'q-error',
    phase: null,
    message: 'missingParitySymbol',
  });

  const timeout = Object.assign(
    new Error('kdb+ query failed for 127.0.0.1:54321: timed out after 25 ms'),
    { name: 'KdbIpcError', code: 'ETIMEDOUT' }
  );
  assert.deepStrictEqual(canonicalError(timeout, { ports: [54321] }), {
    name: 'KdbIpcError',
    classification: 'query-timeout',
    phase: 'query',
    message: 'kdb+ query failed for <LOOPBACK>:<PORT>: timed out after 25 ms',
    code: 'ETIMEDOUT',
  });
  assert.strictEqual(
    normalizeRuntimeText(
      'http://127.0.0.1:7742/0123456789abcdef0123456789abcdef0123456789abcdef/current.csv',
      { ports: [7742], tokens: ['0123456789abcdef0123456789abcdef0123456789abcdef'] }
    ),
    'http://<LOOPBACK>:<PORT>/<TOKEN>/current.csv'
  );
  assert.strictEqual(
    normalizeRuntimeText('query secret-value stays', { redactions: ['secret-value'] }),
    'query <REDACTED> stays'
  );
  assert.strictEqual(normalizeRuntimeText('127.0.0.1:7743', { ports: [7742] }), '127.0.0.1:7743');
  assert.throws(() => normalizeRuntimeText('localhost:0', { ports: [0] }), /integer from 1 to 65535/);
  assert.throws(() => normalizeRuntimeText('/short-token', { tokens: ['abc'] }), /48 hexadecimal/);
}

function testCanonicalCharts() {
  const chart = {
    version: 9,
    requestId: 17,
    chartType: 'line',
    xColumn: 'x',
    x: [1, 2],
    series: [
      { columnName: 'b', values: [20, 30] },
      { columnName: 'a', values: [10, 15] },
    ],
    warnings: ['first warning', 'second warning'],
  };
  const canonical = canonicalChart(chart);
  assert.strictEqual(canonical.version, 9);
  assert.strictEqual(canonical.requestId, 17);
  assert.deepStrictEqual(canonical.series.map(series => series.columnName), ['b', 'a']);
  assert.deepStrictEqual(canonical.warnings, ['first warning', 'second warning']);
  const withoutTransport = canonicalChart(chart, { ignoreRequestMetadata: true });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(withoutTransport, 'version'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(withoutTransport, 'requestId'), false);
}

function testCanonicalHttp() {
  const token = '0123456789abcdef0123456789abcdef0123456789abcdef';
  const canonicalJson = canonicalLocalHttp({
    status: 200,
    url: `http://127.0.0.1:7742/${token}/current.json`,
    headers: {
      Date: 'Wed, 22 Jul 2026 00:00:00 GMT',
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: '[{"z":1,"a":2}]',
  }, { ports: [7742], tokens: [token] });
  assert.deepStrictEqual(canonicalJson, {
    status: 200,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
    body: [{ a: 2, z: 1 }],
    url: 'http://<LOOPBACK>:<PORT>/<TOKEN>/current.json',
  });

  assert.deepStrictEqual(canonicalLocalHttp({
    statusCode: 200,
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
    body: '{"sym":"AAPL"}\r\n{"sym":"MSFT"}',
  }).body, [{ sym: 'AAPL' }, { sym: 'MSFT' }]);

  assert.strictEqual(canonicalLocalHttp({
    status: 200,
    headers: { 'content-type': 'text/csv; charset=utf-8' },
    body: 'sym,size\r\nAAPL,100',
  }).body, 'sym,size\nAAPL,100');
}

async function testCanonicalXlsx() {
  const contentTypes = '<?xml version="1.0"?><Types><Default Extension="xml"/></Types>';
  const sheet = '<?xml version="1.0"?><worksheet><dimension ref="A1:B2"/></worksheet>';

  const firstZip = new JSZip();
  firstZip.file('xl/worksheets/sheet1.xml', sheet, { date: new Date('2020-01-01T00:00:00Z') });
  firstZip.file('[Content_Types].xml', contentTypes, { date: new Date('2020-01-01T00:00:00Z') });
  const first = await firstZip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });

  const secondZip = new JSZip();
  secondZip.file('[Content_Types].xml', contentTypes, { date: new Date('2030-01-01T00:00:00Z') });
  secondZip.file('xl/worksheets/sheet1.xml', sheet, { date: new Date('2030-01-01T00:00:00Z') });
  const second = await secondZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  assert.notDeepStrictEqual(first, second);
  assert.deepStrictEqual(await canonicalXlsxStructure(first), await canonicalXlsxStructure(second));
  assert.deepStrictEqual(
    (await canonicalXlsxStructure(first)).entries.map(entry => entry.path),
    ['[Content_Types].xml', 'xl/worksheets/sheet1.xml']
  );
}

function testStatusSummary() {
  const summary = summarizeStatuses([
    { id: 'a', scope: 'deterministic', status: 'PASS' },
    { id: 'b', scope: 'deterministic', status: 'DIFFERENT_BY_DESIGN' },
    { id: 'c', scope: 'live-q', status: 'GAP' },
    { id: 'd', scope: 'extension-host', status: 'NOT_TESTABLE_HERE' },
  ]);
  assert.deepStrictEqual(summary.counts, {
    PASS: 1,
    DIFFERENT_BY_DESIGN: 1,
    GAP: 1,
    NOT_TESTABLE_HERE: 1,
  });
  assert.strictEqual(summary.total, 4);
  assert.strictEqual(summary.gatePassed, false);
  assert.strictEqual(summary.byScope.deterministic.total, 2);
  assert.throws(() => summarizeStatuses([{ status: 'SKIPPED' }]), /invalid status/);
}

function testReferenceGuards() {
  const revision = 'af2c7c920932274f156e31832859fa262068effe';
  assert.strictEqual(assertExpectedRevision(`${revision}\n`, revision, 'reference'), revision);
  assert.throws(
    () => assertExpectedRevision('0000000000000000000000000000000000000000', revision, 'reference'),
    /reference revision mismatch: expected af2c7c9.*found 0000000/
  );

  const dirtyDocs = ' M docs/index.html\n M docs/assets/main.css\n';
  assert.deepStrictEqual(parseGitPorcelain(dirtyDocs), [
    { xy: ' M', x: ' ', y: 'M', path: 'docs/index.html' },
    { xy: ' M', x: ' ', y: 'M', path: 'docs/assets/main.css' },
  ]);
  const accepted = assertReferenceStatus(dirtyDocs, { requireDirty: true });
  assert.strictEqual(accepted.dirty, true);
  assert.strictEqual(accepted.entryCount, 2);
  assert.match(accepted.disclaimer, /excluded from source evidence/);
  assert.doesNotThrow(() => assertReferenceStatus(dirtyDocs, {
    expectedEntries: [' M docs/index.html', ' M docs/assets/main.css'],
  }));

  assert.throws(() => assertReferenceStatus(' M src/q-ipc.ts\n'), /disallowed changes:  M src\/q-ipc\.ts/);
  assert.throws(() => assertReferenceStatus('M  docs/index.html\n'), /disallowed changes: M  docs\/index\.html/);
  assert.throws(() => assertReferenceStatus('?? docs/new.html\n'), /disallowed changes: \?\? docs\/new\.html/);
  assert.throws(() => assertReferenceStatus('', { requireDirty: true }), /expected to contain.*docs drift/);
  assert.throws(() => assertReferenceStatus(dirtyDocs, {
    expectedEntries: [' M docs/index.html'],
  }), /dirty-state mismatch/);
}

function testRunnerPreflightFailures() {
  assert.doesNotThrow(() => assertStrictStandaloneState(' M package.json\n', false));
  assert.doesNotThrow(() => assertStrictStandaloneState('', true));
  assert.throws(
    () => assertStrictStandaloneState(' M package.json\n', true),
    /requires a clean standalone/
  );

  const root = path.resolve(__dirname, '../..');
  const runner = path.join(root, 'scripts', 'run-cross-parity.js');
  const wrongRevision = childProcess.spawnSync(process.execPath, [runner], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      KDB_SQLTOOLS_PARITY_REVISION: '0'.repeat(40),
    },
  });
  assert.strictEqual(wrongRevision.status, 1);
  assert.match(wrongRevision.stderr, /Wrong reference revision: expected 0{40}, found [0-9a-f]{40}/);

  const missingQ = childProcess.spawnSync(process.execPath, [runner], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      VSCODE_KDB_Q_BIN: path.join(root, `.missing-parity-q-${process.pid}`),
    },
  });
  assert.strictEqual(missingQ.status, 1);
  assert.match(missingQ.stderr, /required q runtime is unavailable or not executable/);
}

async function testGuardedCommandFailures() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-kdb-parity-guard-'));
  try {
    fs.mkdirSync(path.join(fixtureRoot, 'docs'));
    const trackedFile = path.join(fixtureRoot, 'docs', 'fixture.txt');
    fs.writeFileSync(trackedFile, 'before\n');
    runFixtureCommand('git', ['init', '--quiet'], fixtureRoot);
    runFixtureCommand('git', ['add', 'docs/fixture.txt'], fixtureRoot);
    runFixtureCommand('git', [
      '-c', 'user.name=Parity Fixture',
      '-c', 'user.email=parity-fixture@example.invalid',
      'commit', '--quiet', '-m', 'fixture',
    ], fixtureRoot);

    const baseline = referenceStatusSnapshot(fixtureRoot);
    let guardedError;
    try {
      await runReferenceCommand({
        name: 'failing reference fixture',
        command: process.execPath,
        args: ['-e', `require('fs').appendFileSync(${JSON.stringify(trackedFile)}, 'after\\n'); process.exit(7);`],
        cwd: fixtureRoot,
        display: 'node failing-reference-fixture',
        silent: true,
        timeoutMs: 1000,
      }, baseline);
    } catch (error) {
      guardedError = error;
    }
    assert.ok(guardedError instanceof AggregateError);
    assert.match(guardedError.message, /failed and the reference repository state changed/);
    assert.match(guardedError.commandError.message, /failed with exit 7/);
    assert.match(guardedError.statusError.message, /state changed/);

    let timeoutError;
    try {
      await runCheckedCommand({
        name: 'timeout fixture',
        command: process.execPath,
        args: ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
        cwd: fixtureRoot,
        display: 'node timeout-fixture',
        silent: true,
        timeoutMs: 50,
        killGraceMs: 50,
      });
    } catch (error) {
      timeoutError = error;
    }
    assert.ok(timeoutError instanceof Error);
    assert.match(timeoutError.message, /timed out after 50 ms/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function runFixtureCommand(command, args, cwd) {
  const result = childProcess.spawnSync(command, args, { cwd, encoding: 'utf8' });
  assert.strictEqual(
    result.status,
    0,
    `${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`
  );
}

function testEvidenceReport() {
  const outcomes = [
    { id: 'pass', area: 'codec', mode: 'deterministic', status: 'PASS', expectedStatus: 'PASS' },
    {
      id: 'design',
      area: 'product UI',
      mode: 'boundary',
      status: 'DIFFERENT_BY_DESIGN',
      expectedStatus: 'DIFFERENT_BY_DESIGN',
      rationale: 'The products own different connection surfaces.',
    },
    {
      id: 'gap',
      area: 'host coverage',
      mode: 'boundary',
      status: 'GAP',
      expectedStatus: 'GAP',
      rank: 1,
      action: 'Add the missing host fixture.',
      signoff: 'The fixture passes from a clean commit.',
    },
    {
      id: 'manual',
      area: 'visual UX',
      mode: 'boundary',
      status: 'NOT_TESTABLE_HERE',
      expectedStatus: 'NOT_TESTABLE_HERE',
      rationale: 'No Extension Host is available.',
      signoff: 'Record a supported manual run.',
    },
  ];
  const summary = buildSummary(outcomes, 4);
  const evidence = {
    schemaVersion: 1,
    generatedAt: '2026-07-22T00:00:00.000Z',
    standalone: { commit: 'standalone', name: 'vscode-kdb', version: '0.2.0', dirtyDisclaimer: 'clean' },
    reference: {
      commit: 'reference',
      name: 'kdb-sqltools',
      version: '0.3.17',
      dirtyDisclaimer: 'docs only',
      statusHashBefore: 'same',
      statusHashAfter: 'same',
    },
    q: { path: '/q', versionEvidence: 'q test' },
    checks: [{ name: 'fixture', command: 'node fixture', exitCode: 0, outcome: 'passed' }],
    summary,
    outcomes,
  };
  assert.strictEqual(validateEvidence(evidence), evidence);
  const markdown = renderMarkdown(evidence);
  assert.match(markdown, /VALID_WITH_KNOWN_GAPS/);
  assert.match(markdown, /"PASS": 1/);
  assert.match(markdown, /does \*\*not\*\* conclude/);
  assert.throws(
    () => validateEvidence({ ...evidence, outcomes: [...outcomes, { ...outcomes[0] }] }),
    /unique/
  );
  assert.throws(
    () => validateEvidence({ ...evidence, summary: { ...summary, caseCount: 99 } }),
    /caseCount is inconsistent/
  );
}

if (require.main === module) {
  run().catch(error => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = { run, tests };
