'use strict';

const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const TEST_OUT_ROOT = process.env.VSCODE_KDB_TEST_OUT_ROOT
  ? path.resolve(process.env.VSCODE_KDB_TEST_OUT_ROOT)
  : path.join(ROOT, 'out');
const FIXTURE = path.join(__dirname, 'fixture.q');
const {
  KdbIpcClient,
  qValueToColumnarPanel,
  qValueToLosslessPortablePanel,
  qValueToQText,
} = requireOut('q-ipc');
const {
  qValueToLiteral,
  qValueToPortableNode,
  qValueToSemanticPrimitive,
} = requireOut('q-value');
const {
  MIN_NOTEBOOK_BYTE_LIMIT,
  createPortableKxResultV2,
  portableCellText,
  portableCellValue,
  validatePortableKxResult,
} = requireOut('notebook-contract');
const { createColumnarPanelResult } = requireOut('kx-results');
const { qScriptInNamespace, queryInNamespace, queryInNamespaceStrict } = requireOut('connection');
const {
  CONNECTION_TEST_QUERY,
  connectionTestNamespaceQuery,
  connectionTestNamespaceResultIsSafe,
} = requireOut('connection-test');
const {
  SERVER_TABLES_QUERY,
  SERVER_VARIABLES_QUERY,
  buildServerPreviewQuery,
  buildServerTableMetaQuery,
  parseServerColumns,
  parseServerTableNames,
  parseServerVariables,
} = requireOut('server-explorer-model');

(async () => {
  const qPath = resolveQPath();
  if (!qPath) {
    const message = 'No q binary found. Set VSCODE_KDB_Q_BIN=/path/to/q to run the optional live test.';
    if (process.env.VSCODE_KDB_LIVE_REQUIRED === '1') {
      throw new Error(message);
    }
    console.log(`Skipping live q IPC test: ${message}`);
    return;
  }

  const port = await getFreePort();
  const processState = startQ(qPath, port);
  try {
    await waitForPort(port, processState, 15000);
    const evidence = await runAssertions(port);
    console.log(
      `Live direct q IPC test passed using ${qPath} (.z.K ${evidence.qVersion}); ` +
      'complete-source cases ran with .Q.ld poisoned, but this is not an old-q runtime.'
    );
  } finally {
    await stopQ(processState.child);
  }
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

async function runAssertions(port) {
  const client = new KdbIpcClient({ host: '127.0.0.1', port, timeoutMs: 2000 });
  try {
    await client.connect();
    const qVersion = semanticQValue(await client.query('.z.K'));
    assert.ok(client.getProtocolVersion() >= 1);
    assert.strictEqual(semanticQValue(await client.query('1+1')), 2);
    const assignment = await client.query('rootVector:rootVector');
    assert.deepStrictEqual(assignment, { qtype: 'generalNull' });
    assert.deepStrictEqual(qValueToColumnarPanel(assignment), {
      mode: 'text',
      text: '::',
      kind: 'no value',
      rowsMaterialized: true,
    });
    assert.strictEqual(qValueToColumnarPanel(await client.query('()')).mode, 'text');
    const zeroRowTable = qValueToColumnarPanel(await client.query('([]a:`int$())'));
    assert.strictEqual(zeroRowTable.mode, 'grid');
    assert.deepStrictEqual(zeroRowTable.cols, ['a']);
    assert.strictEqual(zeroRowTable.result.rowCount, 0);
    await runExactQAssertions(client);

    const temporaryTestClient = new KdbIpcClient({
      host: '127.0.0.1',
      port,
      connectTimeoutMs: 2000,
      queryTimeoutMs: 2000,
    });
    try {
      await temporaryTestClient.connect();
      const namespaceResult = await temporaryTestClient.query(connectionTestNamespaceQuery('.analytics'));
      assert.strictEqual(connectionTestNamespaceResultIsSafe(namespaceResult), true);
      assert.strictEqual(
        semanticQValue(await temporaryTestClient.query(CONNECTION_TEST_QUERY)),
        false
      );
      assert.strictEqual(
        semanticQValue(await temporaryTestClient.query('string system"d"')),
        '.',
        'the read-only namespace test must leave the temporary session at its original namespace'
      );
    } finally {
      await temporaryTestClient.close();
    }
    assert.strictEqual(
      semanticQValue(await client.query('1+1')),
      2,
      'temporary testing must not disrupt the active saved session'
    );

    const table = qValueToColumnarPanel(await client.query('select sym,size from trade'));
    assert.strictEqual(table.mode, 'grid');
    assert.deepStrictEqual(table.cols, ['sym', 'size']);
    assert.deepStrictEqual(
      table.result.cellWindow({ start: 0, end: 1 }, { start: 0, end: 1 }).cells,
      [['`AAPL', '100'], ['`MSFT', '250']]
    );

    const keyedValue = await client.query(
      '`sym`venue xkey ([]sym:`AAPL`MSFT;venue:`XNAS`XNYS;price:101 202i)'
    );
    assert.strictEqual(keyedValue.qtype, 'keyedTable');
    assert.deepStrictEqual(keyedValue.keyTable.columns, ['sym', 'venue']);
    const keyedPanel = qValueToColumnarPanel(keyedValue);
    assert.strictEqual(keyedPanel.mode, 'grid');
    assert.deepStrictEqual(keyedPanel.result.keyColumnOrdinals, [0, 1]);
    assert.deepStrictEqual(
      keyedPanel.result.cellWindow({ start: 0, end: 1 }, { start: 0, end: 2 }).cells,
      [['`AAPL', '`XNAS', '101'], ['`MSFT', '`XNYS', '202']]
    );
    const keyedPortablePanel = qValueToLosslessPortablePanel(keyedValue);
    assert.strictEqual(keyedPortablePanel.mode, 'grid');
    assert.strictEqual(keyedPortablePanel.exactPersistenceIssue, undefined);
    const keyedPortable = createPortableKxResultV2({
      columns: keyedPortablePanel.cols.map((name, index) => ({
        name,
        type: keyedPortablePanel.result.columnTypes[index],
      })),
      keyColumnOrdinals: keyedPortablePanel.result.keyColumnOrdinals,
      rows: [],
      cellValue: (rowIndex, columnIndex) =>
        keyedPortablePanel.result.cellValue(rowIndex, columnIndex),
      rowCount: keyedPortablePanel.result.rowCount,
      marker: 'direct-ipc',
    }, {
      outputId: `live-keyed-${'k'.repeat(32)}`,
      persistenceMode: 'full',
    });
    assert.strictEqual(keyedPortable.ok, true, keyedPortable.ok ? undefined : keyedPortable.error);
    const reopenedKeyed = validatePortableKxResult(
      JSON.parse(JSON.stringify(keyedPortable.value))
    );
    assert.strictEqual(reopenedKeyed.ok, true);
    assert.deepStrictEqual(reopenedKeyed.value.schema.keyColumnOrdinals, [0, 1]);

    const ordinarySameColumns = qValueToColumnarPanel(await client.query(
      '0!(`sym`venue xkey ([]sym:`AAPL`MSFT;venue:`XNAS`XNYS;price:101 202i))'
    ));
    assert.strictEqual(ordinarySameColumns.mode, 'grid');
    assert.deepStrictEqual(ordinarySameColumns.cols, ['sym', 'venue', 'price']);
    assert.strictEqual(
      ordinarySameColumns.result.keyColumnOrdinals,
      undefined,
      'an ordinary live q table with identical names must remain unhighlighted'
    );

    assert.deepStrictEqual(
      parseServerTableNames(await client.query(queryInNamespaceStrict(SERVER_TABLES_QUERY, '.'))),
      { names: ['trade'], omittedUnsafeNames: 0 }
    );
    assert.deepStrictEqual(
      parseServerTableNames(await client.query(queryInNamespaceStrict(SERVER_TABLES_QUERY, '.analytics'))),
      { names: ['quote'], omittedUnsafeNames: 0 },
      'table listing must use only the configured active namespace'
    );

    const rootVariables = parseServerVariables(
      await client.query(queryInNamespaceStrict(SERVER_VARIABLES_QUERY, '.'))
    ).variables;
    assert.deepStrictEqual(
      rootVariables.map(item => [item.name, item.kind]),
      [['rootFunction', 'function'], ['rootVector', 'variable']]
    );
    const analyticsVariables = parseServerVariables(
      await client.query(queryInNamespaceStrict(SERVER_VARIABLES_QUERY, '.analytics'))
    ).variables;
    assert.deepStrictEqual(
      analyticsVariables.map(item => [item.name, item.kind]),
      [['analyticsFunction', 'function'], ['analyticsVector', 'variable'], ['answer', 'variable']]
    );

    const quoteColumns = parseServerColumns(await client.query(queryInNamespaceStrict(
      buildServerTableMetaQuery('quote'),
      '.analytics'
    )));
    assert.deepStrictEqual(quoteColumns.map(column => [column.name, column.qTypeCode]), [
      ['sym', 's'],
      ['size', 'j'],
    ]);

    const quotePreview = qValueToColumnarPanel(await client.query(queryInNamespaceStrict(
      buildServerPreviewQuery('quote', 'table', 3),
      '.analytics'
    )));
    assert.strictEqual(quotePreview.mode, 'grid');
    assert.strictEqual(quotePreview.result.rowCount, 1, 'three cells over two columns must cap preview to one row');
    assert.deepStrictEqual(
      quotePreview.result.cellWindow({ start: 0, end: 0 }, { start: 0, end: 1 }).cells,
      [['`AAPL', '100']]
    );
    assert.deepStrictEqual(
      semanticQValue(await client.query(queryInNamespaceStrict(
        buildServerPreviewQuery('analyticsVector', 'variable', 3),
        '.analytics'
      ))),
      [0, 1, 2],
      'variable previews must be capped server-side without retrieving the full vector'
    );
    assert.throws(
      () => buildServerPreviewQuery('analyticsFunction', 'function', 3),
      /limited to tables and variables/,
      'known functions must never receive a Preview query'
    );
    await assert.rejects(
      () => client.query(queryInNamespaceStrict(
        buildServerPreviewQuery('analyticsFunction', 'variable', 3),
        '.analytics'
      )),
      error => error && error.name === 'KdbQError' && /Function and projection previews are disabled/.test(error.message),
      'the runtime q type check must reject a function even when a stale/malformed item claims it is a variable'
    );
    assert.strictEqual(
      semanticQValue(await client.query('string system "d"')),
      '.',
      'rejected previews must restore the root namespace'
    );
    await assert.rejects(
      () => client.query(queryInNamespaceStrict(buildServerTableMetaQuery('missingTable'), '.analytics')),
      error => error && error.name === 'KdbQError' && /missingTable/.test(error.message)
    );
    assert.strictEqual(
      semanticQValue(await client.query('string system "d"')),
      '.',
      'missing meta must restore the root namespace'
    );

    assert.strictEqual(
      semanticQValue(await client.query(queryInNamespaceStrict('string system "d"', '.'))),
      '.',
      'strict root execution must explicitly enter the configured root namespace'
    );
    assert.strictEqual(
      semanticQValue(await client.query(queryInNamespaceStrict('string system "d"', '.analytics'))),
      '.analytics'
    );
    assert.strictEqual(semanticQValue(await client.query('string system "d"')), '.');
    assert.strictEqual(
      semanticQValue(await client.query(queryInNamespaceStrict('system "d .analytics";answer', '.'))),
      42
    );
    assert.strictEqual(
      semanticQValue(await client.query('string system "d"')),
      '.',
      'strict root success must restore root'
    );
    await assert.rejects(
      () => client.query(queryInNamespaceStrict('system "d .analytics";missingStrictRoot', '.')),
      error => error && error.name === 'KdbQError' && /missingStrictRoot/.test(error.message)
    );
    assert.strictEqual(
      semanticQValue(await client.query('string system "d"')),
      '.',
      'strict root errors must restore root'
    );
    await assert.rejects(
      () => client.query(queryInNamespaceStrict('system "d .";missingStrictAnalytics', '.analytics')),
      error => error && error.name === 'KdbQError' && /missingStrictAnalytics/.test(error.message)
    );
    assert.strictEqual(
      semanticQValue(await client.query('string system "d"')),
      '.',
      'strict non-root errors must restore root'
    );

    assert.strictEqual(semanticQValue(await client.query(queryInNamespace('answer', '.analytics'))), 42);
    assert.strictEqual(semanticQValue(await client.query(queryInNamespace('1', '.analytics'))), 1);
    await client.query('.Q.ld:{\'"live compatibility test: .Q.ld must not be called"}');
    const completeSourceRequest = qScriptInNamespace(
      'scriptA:1\nscriptB:2\nscriptA+scriptB',
      '.analytics'
    );
    assert.strictEqual(
      completeSourceRequest.includes('.Q.ld'),
      false,
      'the complete-source request must not depend on the poisoned modern helper'
    );
    assert.strictEqual(
      semanticQValue(await client.query(completeSourceRequest)),
      3
    );
    assert.strictEqual(
      semanticQValue(await client.query(qScriptInNamespace('scriptA', '.analytics'))),
      1,
      'later complete-source requests must retain state in the same q process/namespace'
    );
    assert.strictEqual(semanticQValue(await client.query('`scriptA in key `.analytics')), true);
    assert.strictEqual(semanticQValue(await client.query('`scriptA in key `.')), false);
    assert.strictEqual(
      semanticQValue(await client.query(qScriptInNamespace(
        'selectionA:10\nselectionB:20\nselectionA+selectionB',
        '.analytics'
      ))),
      30,
      'compatibility grouping used for multiline selections must evaluate every selected line'
    );
    const multilineQuery = await client.query(qScriptInNamespace(
      'select\n sym,size\n from quote',
      '.analytics'
    ));
    assert.strictEqual(multilineQuery.qtype, 'table');
    assert.deepStrictEqual(multilineQuery.columns, ['sym', 'size']);
    assert.strictEqual(multilineQuery.rowCount, 3);
    assert.strictEqual(
      semanticQValue(await client.query(qScriptInNamespace(
        'scriptFn:{[x]\r\n x+1\r\n }\r\nscriptFn 4',
        '.analytics'
      ))),
      5
    );
    assert.strictEqual(
      semanticQValue(await client.query(qScriptInNamespace(
        'controlValue:0\nif[1b;\n controlValue:41;\n controlValue+:1]\ncontrolValue',
        '.analytics'
      ))),
      42
    );
    assert.strictEqual(
      semanticQValue(await client.query(qScriptInNamespace('1\n2', '.analytics'))),
      2,
      'one-character groups must remain distinct q expressions'
    );
    assert.strictEqual(
      semanticQValue(await client.query(qScriptInNamespace(
        'quotedText:"line one\\nline two \\"quoted\\""\nquotedText',
        '.analytics'
      ))),
      'line one\nline two "quoted"'
    );
    assert.strictEqual(
      semanticQValue(await client.query(qScriptInNamespace(
        'blockCommentValue:1\n/\nblockCommentValue:99\n\\\nblockCommentValue+:1\nblockCommentValue',
        '.analytics'
      ))),
      2,
      'q block-comment source must remain non-executable under client-side grouping'
    );
    assert.strictEqual(
      semanticQValue(await client.query(qScriptInNamespace(
        'nestedBlockValue:1\n/\n/\nnestedBlockValue:99\n\\\nnestedBlockValue:98\n\\\n' +
          'nestedBlockValue+:1\nnestedBlockValue',
        '.analytics'
      ))),
      2,
      'nested q block comments must retain loader-compatible depth'
    );
    assert.deepStrictEqual(
      await client.query(qScriptInNamespace('1+1\n/ trailing result-changing comment\n\\', '.analytics')),
      { qtype: 'generalNull' },
      'a pending line comment before the script terminator must remain the final group'
    );
    assert.deepStrictEqual(
      await client.query(qScriptInNamespace('stoppedBefore:1\n\\\nstoppedAfter:1', '.analytics')),
      { qtype: 'generalNull' }
    );
    assert.strictEqual(
      semanticQValue(await client.query('`stoppedBefore in key `.analytics')),
      true
    );
    assert.strictEqual(
      semanticQValue(await client.query('`stoppedAfter in key `.analytics')),
      false
    );
    assert.strictEqual(
      semanticQValue(await client.query(qScriptInNamespace(
        '\\d .scriptCommandTarget\nsystemCommandValue:40\nsystemCommandValue+:2\nsystemCommandValue',
        '.analytics'
      ))),
      42,
      'a source system command must affect later groups in the same script'
    );
    assert.strictEqual(semanticQValue(await client.query('string system "d"')), '.');
    assert.strictEqual(
      semanticQValue(await client.query('`systemCommandValue in key `.scriptCommandTarget')),
      true
    );
    assert.strictEqual(
      semanticQValue(await client.query('`systemCommandValue in key `.analytics')),
      false
    );
    await assert.rejects(
      () => client.query(qScriptInNamespace(
        '\\d .scriptCommandError\nsystemCommandBeforeError:1\nmissingAfterSystemCommand',
        '.analytics'
      )),
      error => error && error.name === 'KdbQError' && /missingAfterSystemCommand/.test(error.message)
    );
    assert.strictEqual(
      semanticQValue(await client.query('string system "d"')),
      '.',
      'a q error after a source system command must restore the pre-run namespace'
    );
    assert.strictEqual(
      semanticQValue(await client.query('`systemCommandBeforeError in key `.scriptCommandError')),
      true
    );
    assert.strictEqual(semanticQValue(await client.query('string system "d"')), '.');
    await assert.rejects(
      () => client.query(qScriptInNamespace('beforeFailure:1\nmissingScriptName', '.analytics')),
      error => error && error.name === 'KdbQError' && /missingScriptName/.test(error.message)
    );
    assert.strictEqual(
      semanticQValue(await client.query('string system "d"')),
      '.',
      'script errors must restore the prior namespace'
    );
    assert.strictEqual(
      semanticQValue(await client.query(qScriptInNamespace('beforeFailure', '.analytics'))),
      1,
      'q side effects before a later expression error must remain in the configured namespace'
    );
    await assert.rejects(
      () => client.query('missingSymbolForVscodeKdbLiveTest'),
      error => error && error.name === 'KdbQError' && /missingSymbolForVscodeKdbLiveTest/.test(error.message)
    );
    return { qVersion };
  } finally {
    await client.close();
  }
}

async function runExactQAssertions(client) {
  const literalCases = [
    ['"hello"', '"hello"'],
    ['" "', '" "'],
    ['"\\000"', '"\\000"'],
    ['"c"$()', '"c"$()'],
    ['enlist " "', 'enlist " "'],
    ['enlist "\\000"', 'enlist "\\000"'],
    ['`hello', '`hello'],
    ['`', '`'],
    ['"s"$()', '"s"$()'],
    ['enlist `', 'enlist `'],
    ['`$"hello world"', '`$"hello world"'],
    ['enlist `hello', 'enlist `hello'],
    ['`hello`world', '`hello`world'],
    ['enlist 0x2a', 'enlist 0x2a'],
    ['0x0102ff', '0x0102ff'],
    ['enlist 42h', 'enlist 42h'],
    ['1 -2h', '1 -2h'],
    ['enlist 42i', 'enlist 42i'],
    ['1 2i', '1 2i'],
    ['enlist 9007199254740993', 'enlist 9007199254740993'],
    ['1 9007199254740993', '1 9007199254740993'],
    ['enlist 1.5e', 'enlist 1.5e'],
    ['1.5 -2.25e', '1.5 -2.25e'],
    ['enlist 1e+21f', 'enlist 1e+21f'],
    ['1.2e-7 5e-324', '1.2e-7 5e-324'],
    [
      '-9!0x010000000d000000f801000000',
      '-9!0x010000000d000000f801000000',
    ],
    [
      '-9!0x010000001200000008000100000001000000',
      'first enlist (-9!0x010000001200000008000100000001000000)',
    ],
    [
      '-9!0x010000001a000000080003000000010000000100008000008000',
      '-9!0x010000001a000000080003000000010000000100008000008000',
    ],
    [
      '-9!0x0100000022000000080005000000010000000000c0ff0000807f000080ff00000080',
      '-9!0x0100000022000000080005000000010000000000c0ff0000807f000080ff00000080',
    ],
    [
      '-9!0x01000000160000000801020000000100000002000000',
      '-9!0x01000000160000000801020000000100000002000000',
    ],
    [
      '-9!0x010000001200000008020100000001000000',
      'first enlist (-9!0x010000001200000008020100000001000000)',
    ],
    ['`s#1 2i', '`s#(1 2i)'],
    ['"G"$"01234567-89ab-cdef-0123-456789abcdef"', '"G"$"01234567-89ab-cdef-0123-456789abcdef"'],
    ['0Ng', '0Ng'],
    ['"g"$()', '"g"$()'],
    ['enlist ("G"$"01234567-89ab-cdef-0123-456789abcdef")', 'enlist ("G"$"01234567-89ab-cdef-0123-456789abcdef")'],
    ['enlist 0Ng', 'enlist 0Ng'],
    [
      '"g"$(("G"$"01234567-89ab-cdef-0123-456789abcdef");0Ng)',
      '"g"$(("G"$"01234567-89ab-cdef-0123-456789abcdef");0Ng)',
    ],
    ['enlist 1b', 'enlist 1b'],
    ['101b', '101b'],
    ['enlist ("p"$123j)', 'enlist ("p"$123j)'],
    ['"p"$(0j;123j)', '"p"$(0j;123j)'],
    ['"m"$1i', '"m"$1i'],
    ['"d"$1i', '"d"$1i'],
    ['"z"$1.5f', '"z"$1.5f'],
    ['"n"$123j', '"n"$123j'],
    ['"u"$61i', '"u"$61i'],
    ['"u"$-1i', '"u"$-1i'],
    ['"v"$61i', '"v"$61i'],
    ['"v"$-1i', '"v"$-1i'],
    ['"t"$1234i', '"t"$1234i'],
    ['"t"$-1i', '"t"$-1i'],
    ['enlist ("m"$1i)', 'enlist ("m"$1i)'],
    ['enlist ("d"$1i)', 'enlist ("d"$1i)'],
    ['enlist ("z"$1.5f)', 'enlist ("z"$1.5f)'],
    ['enlist ("n"$123j)', 'enlist ("n"$123j)'],
    ['enlist ("u"$61i)', 'enlist ("u"$61i)'],
    ['enlist ("v"$61i)', 'enlist ("v"$61i)'],
    ['enlist ("t"$1234i)', 'enlist ("t"$1234i)'],
    ['"m"$(1i;2i)', '"m"$(1i;2i)'],
    ['"d"$(1i;2i)', '"d"$(1i;2i)'],
    ['"z"$(1.5f;2.5f)', '"z"$(1.5f;2.5f)'],
    ['"n"$(123j;456j)', '"n"$(123j;456j)'],
    ['"u"$(61i;62i)', '"u"$(61i;62i)'],
    ['"v"$(61i;62i)', '"v"$(61i;62i)'],
    ['"t"$(1234i;2345i)', '"t"$(1234i;2345i)'],
    ['"p"$(0j;0N;0W)', '"p"$(0j;0N;0W)'],
    ['(`hello;"hello";enlist 42i;1 2i)', '(`hello;"hello";enlist 42i;1 2i)'],
    ['9007199254740993', '9007199254740993'],
    ['0Ni', '0Ni'],
    ['0Wi', '0Wi'],
    ['-0Wi', '-0Wi'],
    ['"p"$123j', '"p"$123j'],
  ];
  for (const [source, expected] of literalCases) {
    const value = await client.query(source);
    assert.strictEqual(
      qValueToLiteral(value),
      expected,
      `live q literal rendering must preserve q identity for ${source}`
    );
    assert.strictEqual(
      qValueToQText(value),
      expected,
      `live qText rendering must preserve q identity for ${source}`
    );
    assert.deepStrictEqual(
      qValueToPortableNode(await client.query(expected)),
      qValueToPortableNode(value),
      `rendered q syntax must evaluate back to the same typed q value for ${source}`
    );
  }

  const exactTable = await client.query(
    '([]sym:enlist `hello;' +
      'chars:enlist "hello";' +
      'symbolVector:enlist `hello`world;' +
      'singletonInt:enlist enlist 42i;' +
      'multiInt:enlist 1 2i;' +
      'singletonBoolean:enlist enlist 1b;' +
      'multiBoolean:enlist 101b;' +
      'singletonTimestamp:enlist enlist ("p"$123j);' +
      'multiTimestamp:enlist "p"$(0j;123j);' +
      'nested:enlist (`hello;"hello";enlist 42i);' +
      'bigLong:enlist 9007199254740993;' +
      'intNull:enlist 0Ni;' +
      'intPosInf:enlist 0Wi;' +
      'intNegInf:enlist -0Wi;' +
      'timestamp:enlist "p"$123j)'
  );
  assert.strictEqual(exactTable.qtype, 'table');
  const exactTexts = [
    '`hello',
    '"hello"',
    '`hello`world',
    'enlist 42i',
    '1 2i',
    'enlist 1b',
    '101b',
    'enlist ("p"$123j)',
    '"p"$(0j;123j)',
    '(`hello;"hello";enlist 42i)',
    '9007199254740993',
    '0Ni',
    '0Wi',
    '-0Wi',
    '"p"$123j',
  ];
  const displayTexts = [
    '`hello',
    '"hello"',
    '`hello`world',
    'enlist 42',
    '1 2',
    'enlist true',
    'true false true',
    'enlist 2000.01.01D00:00:00.000000123',
    '2000.01.01D00:00:00.000000000 2000.01.01D00:00:00.000000123',
    '(`hello;"hello";enlist 42)',
    '9007199254740993',
    '0N',
    '0W',
    '-0W',
    '2000.01.01D00:00:00.000000123',
  ];
  const displayPanel = qValueToColumnarPanel(exactTable);
  assert.strictEqual(displayPanel.mode, 'grid');
  assert.deepStrictEqual(
    displayPanel.result.cellWindow(
      { start: 0, end: 0 },
      { start: 0, end: displayTexts.length - 1 }
    ).cells,
    [displayTexts],
    'the live KX Results panel must use selective concise q cell text'
  );

  const portablePanel = qValueToLosslessPortablePanel(exactTable);
  assert.ok(portablePanel && portablePanel.mode === 'grid');
  const full = createPortableKxResultV2({
    columns: portablePanel.cols.map((name, index) => ({
      name,
      type: portablePanel.result.columnTypes[index] || 'mixed',
    })),
    rows: [],
    cellValue: (rowIndex, columnIndex) =>
      portablePanel.result.cellValue(rowIndex, columnIndex),
    rowCount: portablePanel.result.rowCount,
    rowLimit: 1,
    byteLimit: MIN_NOTEBOOK_BYTE_LIMIT,
    marker: 'direct-ipc',
  }, {
    outputId: 'live-exact-q-result-0000000000000001',
    persistenceMode: 'full',
  });
  if (!full.ok) {
    assert.fail(full.error);
  }
  assert.strictEqual(
    full.value.data.rows[0].every(cell => cell.kind === 'q' && cell.version === 1),
    true,
    'live full persistence must use exact versioned q cells'
  );
  const reopenedValidation = validatePortableKxResult(
    JSON.parse(JSON.stringify(full.value))
  );
  if (!reopenedValidation.ok) {
    assert.fail(reopenedValidation.error);
  }
  const reopened = reopenedValidation.value;
  assert.deepStrictEqual(
    reopened.data.rows[0].map(cell => portableCellText(cell)),
    displayTexts,
    'saved and reopened live output must preserve selective q grid display semantics'
  );

  const reopenedPanel = createColumnarPanelResult(
    reopened.schema.columns.map(column => column.name),
    reopened.data.rows.length,
    (rowIndex, columnIndex) => portableCellValue(reopened.data.rows[rowIndex][columnIndex])
  );
  const range = {
    startRow: 0,
    endRow: 0,
    startColumn: 0,
    endColumn: reopened.schema.columns.length - 1,
  };
  assert.strictEqual(
    reopenedPanel.toText('tsv', range, false),
    exactTexts.join('\t'),
    'reopened copy text must retain exact q literals'
  );
  assert.deepStrictEqual(
    JSON.parse(reopenedPanel.toText('json', range, false)),
    [Object.fromEntries(reopened.schema.columns.map((column, index) => [
      column.name,
      exactTexts[index],
    ]))],
    'reopened JSON export must retain exact q literals'
  );
}

function semanticQValue(value) {
  const semantic = qValueToSemanticPrimitive(value);
  return semantic === undefined ? value : semantic;
}

function requireOut(moduleName) {
  for (const candidate of [path.join(TEST_OUT_ROOT, moduleName), path.join(TEST_OUT_ROOT, 'src', moduleName)]) {
    try {
      return require(candidate);
    } catch (error) {
      if (error && error.code !== 'MODULE_NOT_FOUND') {
        throw error;
      }
    }
  }
  throw new Error(`Compiled module out/${moduleName}.js is missing. Run npm run compile first.`);
}

function resolveQPath() {
  if (process.env.VSCODE_KDB_Q_BIN) {
    const override = path.resolve(process.env.VSCODE_KDB_Q_BIN);
    if (!fs.existsSync(override)) {
      throw new Error(`VSCODE_KDB_Q_BIN does not exist: ${override}`);
    }
    return override;
  }

  const candidates = [
    path.join(process.env.HOME || '', '.kx', 'bin', qExecutableName()),
    path.join('/opt/data/home/.kx/bin', qExecutableName()),
    ...String(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(entry => path.join(entry, qExecutableName())),
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function qExecutableName() {
  return process.platform === 'win32' ? 'q.exe' : 'q';
}

function startQ(qPath, port) {
  const child = cp.spawn(qPath, [FIXTURE, '-p', `127.0.0.1:${port}`], {
    cwd: ROOT,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const state = { child, output: '', spawnError: null };
  const capture = chunk => {
    state.output = `${state.output}${chunk}`.slice(-8000);
    if (process.env.VSCODE_KDB_LIVE_VERBOSE === '1') {
      process.stderr.write(chunk);
    }
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.once('error', error => {
    state.spawnError = error;
  });
  return state;
}

async function stopQ(child) {
  if (!child || child.exitCode !== null || child.signalCode) {
    return;
  }
  child.stdin.write('\\\\\n');
  child.stdin.end();
  const exited = await Promise.race([
    new Promise(resolve => child.once('exit', () => resolve(true))),
    delay(2000).then(() => false),
  ]);
  if (!exited) {
    child.kill('SIGTERM');
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForPort(port, state, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (state.spawnError) {
      throw new Error(`Could not start q: ${state.spawnError.message}`);
    }
    if (state.child.exitCode !== null) {
      throw new Error(`q exited before opening port ${port}.\n${state.output}`);
    }
    if (await canConnect(port)) {
      return;
    }
    await delay(75);
  }
  throw new Error(`Timed out waiting for q on 127.0.0.1:${port}.\n${state.output}`);
}

function canConnect(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const done = value => {
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(300, () => done(false));
  });
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
