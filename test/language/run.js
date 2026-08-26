'use strict';

const assert = require('assert');
const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  createMessageConnection,
  IPCMessageReader,
  IPCMessageWriter,
} = require('vscode-jsonrpc/node');

const ROOT = path.resolve(__dirname, '..', '..');
const q = require(path.join(ROOT, 'out', 'q-language-testing.js'));
const {
  FORMAT_FIXTURES,
  LEXICAL_BOUNDARY_CASES,
  LEXICAL_FIXTURE,
  NEGATIVE_FIXTURES,
} = require('./fixtures');

function languageCoreTests() {
  assert.deepStrictEqual(q.validateQCatalog(), []);
  assert(q.Q_CATALOG.length > 100, 'static q catalog should cover the common authoring surface');
  assert.deepStrictEqual(q.validateQCatalog([...q.Q_CATALOG, q.Q_CATALOG[0]]), [
    `Duplicate or empty q catalog spelling: ${q.Q_CATALOG[0].spelling}`,
  ]);
  assert(q.Q_CATALOG.every(entry => entry.retrieved === '2026-08-25'));
  const generatedGrammar = q.generateTextMateGrammar();
  assert.strictEqual(
    fs.readFileSync(path.join(ROOT, 'syntaxes', 'q.tmLanguage.json'), 'utf8'),
    generatedGrammar,
    'checked-in grammar should be generated from the shared declarations'
  );
  const grammar = JSON.parse(generatedGrammar);
  assert.strictEqual(grammar.scopeName, 'source.q');
  assert(!generatedGrammar.includes('foreground'), 'grammar must inherit theme colors');
  assert(!generatedGrammar.toLowerCase().includes('quke'), 'q-only grammar must exclude test dialects');
  for (const scope of [
    'comment.line.slash.q', 'string.quoted.double.q', 'constant.other.symbol.q',
    'constant.numeric.timestamp.q', 'keyword.other.query.q', 'support.function.q',
    'variable.other.q', 'keyword.operator.iterator.q',
  ]) {
    assert(generatedGrammar.includes(scope), `grammar should include ${scope}`);
  }
  const languageConfiguration = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'language-configuration.json'), 'utf8')
  );
  assert.strictEqual(languageConfiguration.comments.lineComment, '/');
  assert(new RegExp(languageConfiguration.wordPattern).test('.team.analytics.answer'));
  assert(!new RegExp(languageConfiguration.indentationRules.decreaseIndentPattern).test('}'));
  assert(new RegExp(languageConfiguration.indentationRules.decreaseIndentPattern).test('  }'));

  const source = q.QSource.create('file:///fixture.q', 1, LEXICAL_FIXTURE);
  assert.deepStrictEqual(source.issues, [], 'canonical lexical fixture should be valid');
  const tokenNames = new Set(source.tokens.map(token => token.tokenType.name));
  for (const expected of [
    'LineComment', 'Command', 'StringBegin', 'StringEscape', 'SymbolLiteral',
    'GuidLiteral', 'DateLiteral', 'TimeStampLiteral', 'DateTimeLiteral',
    'BinaryLiteral', 'ByteLiteral', 'NumberLiteral', 'LSql', 'Keyword',
    'Reserved', 'Iterator', 'Operator', 'CommentBegin', 'CommentEnd',
  ]) {
    assert(tokenNames.has(expected), `fixture should produce ${expected}`);
  }
  assert(source.tokens.some(token => token.tokenType.name === 'LineComment' && token.image.includes('trailing')));
  assert(source.tokens.some(token => token.tokenType.name === 'Operator' && token.image === '/'));
  assert(source.tokens.some(token => token.tokenType.name === 'Command' && token.image.includes('/data/q/lib.q')));

  lexicalBoundaryTests();

  for (const fixture of NEGATIVE_FIXTURES) {
    const invalid = q.QSource.create(`file:///${fixture.name}.q`, 1, fixture.source);
    const codes = q.diagnoseQSource(invalid, q.DEFAULT_Q_LANGUAGE_SETTINGS).map(value => value.code);
    assert(codes.includes(fixture.code), `${fixture.name} should produce ${fixture.code}`);
  }

  const providerSource = q.QSource.create('file:///providers.q', 1, 'f:{[arg] local:arg+1;local}; result:f[2]');
  assert(q.qCompletions(providerSource, { line: 0, character: 1 }).some(item => item.label === 'first'));
  assert.strictEqual(q.qCompletions(
    q.QSource.create('file:///string.q', 1, '"til"'),
    { line: 0, character: 2 }
  ).length, 0);
  const hover = q.qHover(q.QSource.create('file:///hover.q', 1, 'til 10'), { line: 0, character: 1 });
  assert(hover && hover.contents.value.includes('code.kx.com'));
  const signature = q.qSignatureHelp(
    q.QSource.create('file:///signature.q', 1, 'ssr["abc";"a";'),
    { line: 0, character: 15 }
  );
  assert(signature && signature.activeParameter === 2);
  providerTests();

  const invalidSettings = q.normalizeQLanguageSettings({
    diagnostics: { debounceMs: -1, maxProblems: 0 },
    workspace: { maxFiles: 1_000_000 },
    lint: { rules: { 'q.unknown': 'loud', 'q.unused-local': 'information' } },
  });
  assert.strictEqual(invalidSettings.settings.diagnostics.debounceMs, 250);
  assert.strictEqual(invalidSettings.settings.diagnostics.maxProblems, 200);
  assert.strictEqual(invalidSettings.settings.workspace.maxFiles, 5000);
  assert.strictEqual(invalidSettings.settings.lint.rules['q.unused-local'], 'information');
  assert(invalidSettings.warnings.length >= 4);
  settingsAndWorkspaceTests();

  for (const fixture of FORMAT_FIXTURES) {
    const original = q.QSource.create(`file:///format-${fixture.name}.q`, 1, fixture.source);
    const options = fixture.options ?? { insertSpaces: true, tabSize: 2 };
    const formatted = q.formatQDocument(original, options);
    assert.strictEqual(formatted.skipped, undefined, `${fixture.name} should format safely`);
    assert.strictEqual(formatted.formattedText, fixture.expected, `${fixture.name} golden output changed`);
    const candidate = q.QSource.create(original.uri, 2, formatted.formattedText);
    assert.deepStrictEqual(candidate.significantTokens(), original.significantTokens());
    assert.strictEqual(newlineCount(candidate.text), newlineCount(original.text));
    for (let line = 0; line < original.lineStarts.length; line++) {
      assert.strictEqual(candidate.lineIsContinuation(line), original.lineIsContinuation(line));
    }
    const second = q.formatQDocument(candidate, options);
    assert.strictEqual(second.edits.length, 0, `${fixture.name} should be idempotent`);
    if (fixture.name === 'suppression') {
      assert(formatted.formattedText.includes('       x:1   '), 'suppressed bytes must survive exactly');
    }
  }

  formatterNegativeTests();
  diagnosticTests();

  runtimeMetadataTests();
}

function lexicalBoundaryTests() {
  for (const fixture of LEXICAL_BOUNDARY_CASES) {
    const source = q.QSource.create(`file:///lexical-${fixture.name}.q`, 1, fixture.source);
    assert.deepStrictEqual(source.issues, [], `${fixture.name} should lex without errors`);
    const pairs = source.tokens.map(token => [token.tokenType.name, token.image]);
    for (const pair of fixture.images ?? []) {
      assert(pairs.some(value => value[0] === pair[0] && value[1] === pair[1]),
        `${fixture.name} should contain ${pair[0]} ${JSON.stringify(pair[1])}`);
    }
    const names = new Set(source.tokens.map(token => token.tokenType.name));
    for (const name of fixture.tokenTypes ?? []) {
      assert(names.has(name), `${fixture.name} should contain ${name}`);
    }
  }

  const protectedSource = q.QSource.create(
    'file:///protected.q',
    1,
    'value:`trade; text:"trade"; / trade\n\\l /tmp/trade.q'
  );
  for (const position of [
    { line: 0, character: 8 },
    { line: 0, character: 21 },
    { line: 0, character: 31 },
    { line: 1, character: 7 },
  ]) {
    assert(protectedSource.protectedAt(position), `protected q range missing at ${JSON.stringify(position)}`);
    assert.strictEqual(q.qCompletions(protectedSource, position).length, 0);
    assert.strictEqual(q.bindingAt(protectedSource, position), undefined);
  }
  const slash = q.QSource.create('file:///slash.q', 1, 'ratio:2/3\n\\l /tmp/a.q\n/ comment');
  assert.deepStrictEqual(slash.issues, [], 'valid slash forms must not create diagnostics');

  const recovered = q.QSource.create('file:///recovery.q', 1, 'x:(1;2]\nafter:til 3');
  assert(recovered.issues.some(issue => issue.kind === 'unmatched-delimiter'));
  assert(recovered.bindings.some(binding => binding.name === 'after' && binding.declaration),
    'analysis should recover after a mismatched delimiter');
  const unavailable = q.tokenRange({
    image: '', startOffset: -1, endOffset: -1, startLine: -1, endLine: -1,
    startColumn: -1, endColumn: -1, tokenTypeIdx: 0, tokenType: { name: 'EOF' },
  });
  assert.deepStrictEqual(unavailable.start, { line: 0, character: 0 });
  assert(unavailable.end.line >= 0 && unavailable.end.character >= 0);
}

function providerTests() {
  const source = q.QSource.create(
    'file:///providers-main.q',
    1,
    'globalFn:{[arg]\n  local:arg+1;\n  loc};\nanswer:globalFn[2]'
  );
  const workspace = q.QSource.create('file:///workspace-lib.q', 1, 'workspaceFn:{x*2}; workspaceValue:42');
  const localItems = q.qCompletions(source, { line: 2, character: 2 }, [source, workspace]);
  assert(localItems.some(item => item.label === 'local' && item.sortText.startsWith('0-')));
  assert(localItems.some(item => item.label === 'arg'));
  assert(localItems.some(item => item.label === 'workspaceFn' && /workspace/.test(item.detail)));
  const dotted = q.qCompletions(
    q.QSource.create('file:///namespace.q', 1, '.Q.'),
    { line: 0, character: 3 }
  );
  assert(dotted.some(item => item.label === '.Q.en' && item.textEdit.range.start.character === 0));

  const referencePosition = { line: 3, character: 10 };
  const definitions = q.qDefinition(source, referencePosition, [source, workspace]);
  assert.strictEqual(definitions.length, 1);
  assert.strictEqual(definitions[0].range.start.line, 0);
  assert.strictEqual(q.qReferences(source, referencePosition, [source], false).length, 1);
  assert.strictEqual(q.qReferences(source, referencePosition, [source], true).length, 2);
  assert.strictEqual(q.qHighlights(source, referencePosition).length, 2);

  const symbols = q.qDocumentSymbols(source);
  const functionSymbol = symbols.find(symbol => symbol.name === 'globalFn');
  assert(functionSymbol && functionSymbol.kind === 12);
  assert(functionSymbol.children.some(symbol => symbol.name === 'arg'));
  assert(functionSymbol.children.some(symbol => symbol.name === 'local'));
  assert(q.qWorkspaceSymbols([source, workspace], 'workspace').some(symbol => symbol.name === 'workspaceFn'));

  const prepared = q.qPrepareRename(source, referencePosition);
  assert(prepared);
  const rename = q.qRename(source, referencePosition, 'renamedFn', [source, workspace]);
  assert(rename && rename.changes[source.uri].length === 2);
  assert.strictEqual(q.qRename(source, referencePosition, 'select', [source]), null);
  const collisionSource = q.QSource.create('file:///collision.q', 1, 'left:1;right:left');
  assert.strictEqual(q.qRename(collisionSource, { line: 0, character: 15 }, 'right', [collisionSource]), null);
  const duplicate = q.QSource.create('file:///duplicate.q', 1, 'globalFn:{x}');
  assert.strictEqual(q.qDefinition(source, referencePosition, [source, duplicate]).length, 0,
    'ambiguous workspace definitions must fail closed');

  const qsql = q.QSource.create('file:///qsql.q', 1, 'trade:([]sym:`a;price:1f); select sym from trade where price>0');
  assert.strictEqual(q.qPrepareRename(qsql, { line: 0, character: 34 }), null,
    'qSQL columns must be excluded from rename');
  assert.strictEqual(q.qPrepareRename(qsql, { line: 0, character: 48 }), null,
    'qSQL predicate columns must be excluded from rename');

  const hover = q.qHover(source, { line: 0, character: 2 });
  assert(hover && hover.contents.value.includes('Statically resolved'));
  assert.strictEqual(q.qHover(q.QSource.create('file:///unknown.q', 1, 'runtimeThing'), { line: 0, character: 3 }), null);
  const nestedSignature = q.qSignatureHelp(
    q.QSource.create('file:///nested-signature.q', 1, 'ssr["a;b";first[1;2];'),
    { line: 0, character: 21 }
  );
  assert(nestedSignature && nestedSignature.activeParameter === 2);

  const semantic = q.qSemanticTokens(q.QSource.create('file:///semantic.q', 1, 'f:{[x] til x}'));
  assert(semantic.data.length >= 15, 'semantic tokens should include bindings and the read-only built-in');
  const structural = q.QSource.create('file:///structure.q', 1, 'f:{[x]\n  (x;\n   x+1)\n  }\nafter:1');
  const folds = q.qFoldingRanges(structural);
  assert(folds.some(range => range.startLine === 0 && range.endLine < 4));
  const selection = q.qSelectionRanges(structural, [{ line: 2, character: 3 }])[0];
  assert(selection.parent && selection.parent.range.start.line <= selection.range.start.line);
  assert(selection.parent.range.end.line >= selection.range.end.line);

  const calls = q.QSource.create(
    'file:///calls.q',
    1,
    'callee:{[x] x+1};\ncaller:{callee[1];callee[2]}'
  );
  const calleeItem = q.qPrepareCallHierarchy(calls, { line: 0, character: 2 })[0];
  const callerItem = q.qPrepareCallHierarchy(calls, { line: 1, character: 2 })[0];
  assert(calleeItem && callerItem);
  const incoming = q.qIncomingCalls(calleeItem, [calls]);
  assert.strictEqual(incoming.length, 1);
  assert.strictEqual(incoming[0].from.name, 'caller');
  assert.strictEqual(incoming[0].fromRanges.length, 2);
  const outgoing = q.qOutgoingCalls(callerItem, [calls]);
  assert.strictEqual(outgoing.length, 1);
  assert.strictEqual(outgoing[0].to.name, 'callee');
  assert.strictEqual(outgoing[0].fromRanges.length, 2);

  const moduleSource = q.QSource.create('file:///workspace/math.q', 1, 'double:{x*2}');
  const importerText = 'math:use `math; answer:math.double[2]';
  const importer = q.QSource.create('file:///workspace/main.q', 1, importerText);
  const related = q.qRelatedSources(importer, [importer, moduleSource]);
  assert(related.some(value => value.uri === moduleSource.uri && value.alias === 'math'));
  const importedDefinition = q.qDefinition(importer, { line: 0, character: 28 }, related);
  assert.strictEqual(importedDefinition.length, 1);
  assert.strictEqual(importedDefinition[0].uri, moduleSource.uri);
  const importedRename = q.qRename(importer, { line: 0, character: 28 }, 'math.twice', related);
  assert.strictEqual(importedRename.changes[importer.uri][0].newText, 'math.twice');
  assert.strictEqual(importedRename.changes[moduleSource.uri][0].newText, 'twice');
  const importPrefixText = 'math:use `math; math.d';
  const importPrefix = q.QSource.create('file:///workspace/import-prefix.q', 1, importPrefixText);
  const importCompletions = q.qCompletions(
    importPrefix,
    { line: 0, character: importPrefixText.length },
    q.qRelatedSources(importPrefix, [importPrefix, moduleSource])
  );
  assert(importCompletions.some(item => item.label === 'math.double'));
}

function settingsAndWorkspaceTests() {
  const custom = q.normalizeQLanguageSettings({
    enabled: false,
    diagnostics: { debounceMs: 0, maxProblems: 1_000 },
    maxFileSizeBytes: 65_536,
    workspace: {
      include: ['src/**/*.q', 'root.q'],
      exclude: ['**/generated/**'],
      maxFiles: 1,
    },
    lint: { enabled: false, rules: { 'q.unused-local': 'error' } },
    connectedIntelligence: true,
  });
  assert.deepStrictEqual(custom.warnings, []);
  assert.strictEqual(custom.settings.enabled, false);
  assert.strictEqual(custom.settings.diagnostics.debounceMs, 0);
  assert.strictEqual(custom.settings.connectedIntelligence, true);
  assert.strictEqual(custom.settings.lint.rules['q.unused-local'], 'error');
  assert(q.workspacePathIncluded('src/main.q', custom.settings.workspace.include, custom.settings.workspace.exclude));
  assert(q.workspacePathIncluded('src/nested/main.q', custom.settings.workspace.include, custom.settings.workspace.exclude));
  assert(q.workspacePathIncluded('root.q', custom.settings.workspace.include, custom.settings.workspace.exclude));
  assert(!q.workspacePathIncluded('src/generated/file.q', custom.settings.workspace.include, custom.settings.workspace.exclude));
  assert(!q.workspacePathIncluded('../outside.q', custom.settings.workspace.include, custom.settings.workspace.exclude));
  for (const directory of ['.git', 'node_modules', 'out', 'dist', 'build']) {
    assert(q.workspaceDirectoryExcluded(directory, q.DEFAULT_Q_LANGUAGE_SETTINGS.workspace.exclude));
  }
}

function formatterNegativeTests() {
  for (const sourceText of ['x:(1;2]', 'x:"unterminated', '/\nunterminated']) {
    const source = q.QSource.create('file:///invalid-format.q', 1, sourceText);
    const result = q.formatQDocument(source, { insertSpaces: true, tabSize: 2 });
    assert.strictEqual(result.edits.length, 0);
    assert(result.skipped);
  }
  const protectedRange = q.QSource.create('file:///protected-format.q', 1, 'x:"a b"\ny:1');
  const protectedResult = q.formatQRange(
    protectedRange,
    { insertSpaces: true, tabSize: 2 },
    { start: { line: 0, character: 4 }, end: { line: 1, character: 1 } }
  );
  assert.strictEqual(protectedResult.edits.length, 0);
  assert.match(protectedResult.skipped, /crosses a string/);

  const rangeSource = q.QSource.create('file:///range-format.q', 1, 'top:1\nf:{\n    x:1   \n  x\n }\nafter:2');
  const result = q.formatQRange(
    rangeSource,
    { insertSpaces: true, tabSize: 2 },
    { start: { line: 2, character: 0 }, end: { line: 4, character: 0 } }
  );
  assert.strictEqual(result.skipped, undefined);
  assert(result.edits.every(edit => edit.range.start.line >= 2 && edit.range.end.line <= 3));
  assert.strictEqual(newlineCount(result.formattedText), newlineCount(rangeSource.text));
}

function diagnosticTests() {
  const source = q.QSource.create(
    'file:///diagnostics.q',
    1,
    'later+1;later:2\nf:{[unused]\nlocal:1;\n2}\nold:2026.08.25T01:02:03.000'
  );
  const diagnostics = q.diagnoseQSource(source, q.DEFAULT_Q_LANGUAGE_SETTINGS);
  const codes = diagnostics.map(value => value.code);
  for (const code of [
    'q.declared-after-use', 'q.unused-parameter', 'q.unused-local',
    'q.unindented-continuation', 'q.deprecated-datetime',
  ]) {
    assert(codes.includes(code), `diagnostic fixture should contain ${code}`);
  }
  assert.strictEqual(diagnostics.find(value => value.code === 'q.unused-parameter').severity, 4);
  assert.strictEqual(diagnostics.find(value => value.code === 'q.deprecated-datetime').severity, 2);

  const disabled = q.diagnoseQSource(source, {
    ...q.DEFAULT_Q_LANGUAGE_SETTINGS,
    lint: { ...q.DEFAULT_Q_LANGUAGE_SETTINGS.lint, enabled: false },
  });
  assert(disabled.every(value => String(value.code).startsWith('q.unmatched') ||
    String(value.code).includes('string') || String(value.code).includes('escape') ||
    value.code === 'q.invalid-character'));

  const suppressed = q.QSource.create(
    'file:///suppressed.q',
    1,
    '// vscode-kdb-lint-disable-next-line q.unused-local\nf:{x:1;2}\n' +
      '// vscode-kdb-lint-disable q.deprecated-datetime\na:2026.08.25T01:02:03.000\n' +
      '// vscode-kdb-lint-enable q.deprecated-datetime\nb:2026.08.25T01:02:03.000'
  );
  const suppressedDiagnostics = q.diagnoseQSource(suppressed, q.DEFAULT_Q_LANGUAGE_SETTINGS);
  assert.strictEqual(suppressedDiagnostics.filter(value => value.code === 'q.unused-local').length, 0);
  assert.strictEqual(suppressedDiagnostics.filter(value => value.code === 'q.deprecated-datetime').length, 1);
  const malformedDirective = q.diagnoseQSource(
    q.QSource.create('file:///bad-directive.q', 1, '// vscode-kdb-lint-disable q.no-such-rule\nx:1'),
    q.DEFAULT_Q_LANGUAGE_SETTINGS
  );
  assert(malformedDirective.some(value => value.code === 'q.invalid-suppression'));
  const syntaxCannotSuppress = q.diagnoseQSource(
    q.QSource.create('file:///syntax-directive.q', 1, '// vscode-kdb-lint-disable q.unused-local\nx:(1]'),
    q.DEFAULT_Q_LANGUAGE_SETTINGS
  );
  assert(syntaxCannotSuppress.some(value => value.code === 'q.unmatched-delimiter'));

  const severity = q.diagnoseQSource(source, {
    ...q.DEFAULT_Q_LANGUAGE_SETTINGS,
    lint: {
      ...q.DEFAULT_Q_LANGUAGE_SETTINGS.lint,
      rules: { ...q.DEFAULT_Q_LANGUAGE_SETTINGS.lint.rules, 'q.unused-local': 'error' },
    },
  });
  assert.strictEqual(severity.find(value => value.code === 'q.unused-local').severity, 1);
  const cappedSource = q.QSource.create('file:///capped.q', 1, ')'.repeat(250));
  const capped = q.diagnoseQSource(cappedSource, {
    ...q.DEFAULT_Q_LANGUAGE_SETTINGS,
    diagnostics: { debounceMs: 250, maxProblems: 200 },
  });
  assert.strictEqual(capped.length, 201);
  assert.strictEqual(capped.at(-1).code, 'q.too-many-diagnostics');

  const mismatch = q.diagnoseQSource(
    q.QSource.create('file:///mismatch.q', 1, 'x:(1]'),
    q.DEFAULT_Q_LANGUAGE_SETTINGS
  ).find(value => value.code === 'q.unmatched-delimiter');
  assert(mismatch.relatedInformation?.length === 1);
  const qsql = q.diagnoseQSource(
    q.QSource.create('file:///dynamic-qsql.q', 1, 'select sym from trade where price>value `threshold'),
    q.DEFAULT_Q_LANGUAGE_SETTINGS
  );
  assert(!qsql.some(value => /undefined|unused-global|type/i.test(value.message)));
}

function newlineCount(text) {
  return (text.match(/\n/g) ?? []).length + (text.match(/\r(?!\n)/g) ?? []).length;
}

function runtimeMetadataTests() {
  const snapshot = { connectionId: 'kx-live', namespace: '.analytics', generation: 7 };
  const root = q.parseRuntimeRoot({
    version: 1,
    kind: 'root',
    snapshot,
    tables: ['trade', 'quote', 'trade'],
    variables: [
      { name: 'threshold', kind: 'variable', qType: 9 },
      { name: 'calculate', kind: 'function', qType: 100 },
    ],
  });
  assert(root, 'valid runtime root metadata should be accepted');
  assert.deepStrictEqual(root.tables, ['trade', 'quote']);
  assert(!JSON.stringify(root).includes('password'));
  assert.strictEqual(q.parseRuntimeRoot({ ...root, version: 2 }), undefined);
  assert.strictEqual(q.parseRuntimeRoot({ ...root, tables: ['trade;delete'] }), undefined);
  assert.strictEqual(q.parseRuntimeRoot({
    ...root,
    tables: Array.from({ length: q.Q_METADATA_MAX_ROOT_ITEMS + 1 }, (_, index) => `t${index}`),
    variables: [],
  }), undefined, 'runtime root metadata must enforce its item cap');

  const table = q.parseRuntimeTable({
    version: 1,
    kind: 'table',
    snapshot,
    table: 'trade',
    columns: [
      { name: 'sym', qTypeCode: 's', qTypeName: 'symbol', foreignKey: '', attribute: 'p' },
      { name: 'price', qTypeCode: 'f', qTypeName: 'float', foreignKey: '', attribute: '' },
    ],
  });
  assert(table, 'valid table metadata should be accepted');
  assert.strictEqual(q.parseRuntimeTable({ ...table, table: 'trade;delete' }), undefined);
  assert.strictEqual(q.sameRuntimeSnapshot(root.snapshot, table.snapshot), true);
  assert.strictEqual(q.sameRuntimeSnapshot(root.snapshot, { ...snapshot, generation: 8 }), false);

  const source = q.QSource.create('file:///runtime.q', 1, 'select pr from trade');
  assert.strictEqual(q.qSqlTableAt(source, { line: 0, character: 9 }), 'trade');
  const completions = q.runtimeCompletions(source, { line: 0, character: 9 }, root, table);
  assert(completions.some(item => item.label === 'price' && /float column/.test(item.detail)));
  assert(!completions.some(item => item.label === 'sym'), 'the typed prefix should filter columns');
  const rootCompletions = q.runtimeCompletions(
    q.QSource.create('file:///root-runtime.q', 1, 'cal'),
    { line: 0, character: 3 },
    root,
    undefined
  );
  assert(rootCompletions.some(item => item.label === 'calculate' && item.data.source === 'runtime-metadata'));
  assert.strictEqual(q.runtimeCompletions(
    q.QSource.create('file:///protected-runtime.q', 1, '"trade"'),
    { line: 0, character: 3 },
    root,
    undefined
  ).length, 0);
  const hover = q.runtimeHover(
    q.QSource.create('file:///runtime-hover.q', 1, 'threshold'),
    { line: 0, character: 2 },
    root
  );
  assert(hover && hover.contents.value.includes('No value or preview query was performed'));
}

async function minimalIpcServerStarts() {
  const child = fork(path.join(ROOT, 'out', 'q-language-server.js'), ['--node-ipc'], {
    cwd: ROOT,
    silent: true,
  });
  let stderr = '';
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8');
  });
  const connection = createMessageConnection(
    new IPCMessageReader(child),
    new IPCMessageWriter(child)
  );
  const diagnosticEvents = [];
  connection.onNotification('textDocument/publishDiagnostics', value => diagnosticEvents.push(value));
  connection.listen();
  try {
    const initialized = await connection.sendRequest('initialize', {
      processId: process.pid,
      rootUri: null,
      capabilities: {},
      workspaceFolders: null,
    });
    assert.strictEqual(initialized.serverInfo.name, 'KX q Language Server');
    assert.strictEqual(initialized.serverInfo.version, '0.2.25');
    assert.strictEqual(initialized.capabilities.textDocumentSync, 2);
    assert(initialized.capabilities.notebookDocumentSync);
    const uri = 'file:///ipc-language-smoke.q';
    const source = 'f:{[unused]\n  local:1;\n  til 2};\nanswer:f[2]';
    connection.sendNotification('textDocument/didOpen', {
      textDocument: { uri, languageId: 'q', version: 1, text: source },
    });
    const completion = await connection.sendRequest('textDocument/completion', {
      textDocument: { uri },
      position: { line: 2, character: 4 },
    });
    assert(completion.some(item => item.label === 'til'));
    const hover = await connection.sendRequest('textDocument/hover', {
      textDocument: { uri },
      position: { line: 2, character: 3 },
    });
    assert(hover.contents.value.includes('code.kx.com'));
    const signature = await connection.sendRequest('textDocument/signatureHelp', {
      textDocument: { uri },
      position: { line: 3, character: 10 },
    });
    assert(signature && signature.signatures[0].label === 'f[...]');
    const symbols = await connection.sendRequest('textDocument/documentSymbol', { textDocument: { uri } });
    assert(symbols.some(symbol => symbol.name === 'f'));
    const definition = await connection.sendRequest('textDocument/definition', {
      textDocument: { uri },
      position: { line: 3, character: 7 },
    });
    assert.strictEqual(definition.length, 1);
    const references = await connection.sendRequest('textDocument/references', {
      textDocument: { uri },
      position: { line: 3, character: 7 },
      context: { includeDeclaration: false },
    });
    assert.strictEqual(references.length, 1);
    const rename = await connection.sendRequest('textDocument/rename', {
      textDocument: { uri },
      position: { line: 3, character: 7 },
      newName: 'renamed',
    });
    assert.strictEqual(rename.changes[uri].length, 2);
    const semantic = await connection.sendRequest('textDocument/semanticTokens/full', {
      textDocument: { uri },
    });
    assert(semantic.data.length > 0);
    const folds = await connection.sendRequest('textDocument/foldingRange', { textDocument: { uri } });
    assert(Array.isArray(folds));
    const selections = await connection.sendRequest('textDocument/selectionRange', {
      textDocument: { uri },
      positions: [{ line: 2, character: 3 }],
    });
    assert.strictEqual(selections.length, 1);
    const formatting = await connection.sendRequest('textDocument/formatting', {
      textDocument: { uri },
      options: { insertSpaces: true, tabSize: 2 },
    });
    assert(Array.isArray(formatting));
    await waitUntil(() => diagnosticEvents.some(event =>
      event.uri === uri && event.diagnostics.some(value => value.code === 'q.unused-parameter')));
    connection.sendNotification('textDocument/didClose', { textDocument: { uri } });
    await waitUntil(() => diagnosticEvents.some(event => event.uri === uri && event.diagnostics.length === 0));
    for (const [notebookType, suffix] of [
      ['jupyter-notebook', 'ipynb'],
      ['vscode-kdb-q-notebook', 'qnb'],
    ]) {
      const notebookUri = `file:///ipc-language-smoke.${suffix}`;
      const cellUri = `vscode-notebook-cell:///ipc-language-smoke.${suffix}#cell-1`;
      connection.sendNotification('notebookDocument/didOpen', {
        notebookDocument: {
          uri: notebookUri,
          notebookType,
          version: 1,
          cells: [{ kind: 2, document: cellUri }],
        },
        cellTextDocuments: [{ uri: cellUri, languageId: 'q', version: 1, text: 'til 3' }],
      });
      const cellHover = await connection.sendRequest('textDocument/hover', {
        textDocument: { uri: cellUri },
        position: { line: 0, character: 1 },
      });
      assert(cellHover.contents.value.includes('code.kx.com'),
        `${notebookType} q cells should use the standalone q provider model`);
      const cellFormatting = await connection.sendRequest('textDocument/formatting', {
        textDocument: { uri: cellUri },
        options: { insertSpaces: true, tabSize: 2 },
      });
      assert(Array.isArray(cellFormatting));
      connection.sendNotification('notebookDocument/didClose', {
        notebookDocument: { uri: notebookUri },
        cellTextDocuments: [{ uri: cellUri }],
      });
      await waitUntil(() => diagnosticEvents.some(event =>
        event.uri === cellUri && event.diagnostics.length === 0));
    }
    await connection.sendRequest('shutdown');
    connection.sendNotification('exit');
  } finally {
    connection.dispose();
    if (!child.killed) {
      child.kill();
    }
  }
  assert.strictEqual(stderr, '', `language server wrote stderr: ${stderr}`);
}

async function waitUntil(predicate, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('timed out waiting for language-server event');
}

languageCoreTests();

minimalIpcServerStarts().then(
  () => console.log('language server IPC smoke passed'),
  error => {
    console.error(error);
    process.exitCode = 1;
  }
);
