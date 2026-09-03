'use strict';

const LEXICAL_FIXTURE = [
  '/ whole-line comment',
  'a:1 / trailing comment',
  'sumOver:+/ 1 2 3',
  '\\l /data/q/lib.q',
  'escaped:"quote: \\" newline: \\n octal: \\141"',
  'symbols:`plain`.ns.member`"symbol with space"',
  'guid:0Ng; concreteGuid:01234567-89ab-cdef-0123-456789abcdef',
  'numbers:1b 0x0a0b 1h 2i 3j 4e 5f -6 0N 0Nj 0W -0W',
  'temporals:2026.08.25 2026.08m 2026.08.25D12:30:45.123456789 2026.08.25T12:30:45.123 0D12:30:45.1 12:30u 12:30:45v',
  'query:select avg price by sym from trade where size>100',
  'builtin:til 10; systemNamespace:.Q.en; callback:.z.pg',
  '.team.analytics.answer:42',
  'f:{[x;y] local:x+y; $[local>0;local;neg local]}',
  'projection:f[;2]; iterators:(+/;\':;/:;\\:)',
  '/',
  ' block comment with "string" and +/ tokens',
  '\\',
  'afterBlock:1',
  '\\',
].join('\n');

const HIGHLIGHTING_FIXTURE = [
  '///// Syntax coverage',
  '/ Verify stable roles for synthetic q names and qSQL columns.',
  '.demo.batch_sizes:2 4 8;',
  '.demo.running_sizes:sums .demo.batch_sizes;',
  '.demo.weights:1 2 3f;',
  '.demo.window:"2000.01.01 2000.01.02";',
  '.demo.item_id:7;',
  '.demo.rows:.service.fetch["select item, quantity, price from sample";`archive]; / synthetic records',
  '.demo.summary:select total:sum abs quantity, row_count:count i by item from .demo.rows;',
  '.demo.summary:update changes:{deltas x} each total from .demo.summary;',
  '.demo.summary:update score:{x wavg .demo.weights} each changes from .demo.summary;',
  '.demo.transform:{[arg] local:arg+1;local};',
  '.demo.answer:.demo.transform[2];',
  '.demo.system_fn:.Q.en;',
  'unresolvedThing',
].join('\n');

const SEMANTIC_SELECTOR_FIXTURE = [
  'future;',
  'future:1;',
  'future+:2;',
  'globalValue:1;',
  'globalValue::2;',
  '.ns.value:globalValue;',
  '.ns.value:.ns.value+1;',
  '(left;right):1 2;',
  'fn:{[arg]',
  '  localValue:arg;',
  '  localValue+:1;',
  '  localValue};',
  'fn[2];',
  'mixed:{x};mixed:42;mixed;',
  'summary:select alias:price by sym from trade where amount>0;',
  '.external.query["x"];',
  'inlineTarget:update hit:{deltas x} each count from trade;',
].join('\n');

const NEGATIVE_FIXTURES = Object.freeze([
  { name: 'invalid escape', source: 'x:"bad \\q"', code: 'q.invalid-escape' },
  { name: 'unterminated string', source: 'x:"bad', code: 'q.unterminated-string' },
  { name: 'unterminated block comment', source: '/\nnever closed', code: 'q.unterminated-block-comment' },
  { name: 'mismatched delimiter', source: 'x:(1;2]', code: 'q.unmatched-delimiter' },
  { name: 'unclosed delimiter', source: 'x:til[10', code: 'q.unmatched-delimiter' },
  { name: 'invalid character', source: 'x:1🙂', code: 'q.invalid-character' },
]);

const LEXICAL_BOUNDARY_CASES = Object.freeze([
  {
    name: 'slash operator and comments',
    source: 'ratio:2/3\nscan:+/1 2 3\n/ comment\nx:1 / trailing',
    images: [['Operator', '/'], ['LineComment', '/ comment'], ['LineComment', '/ trailing']],
  },
  {
    name: 'system command path',
    source: '\\l /srv/q/lib.q',
    images: [['Command', '\\l /srv/q/lib.q']],
  },
  {
    name: 'escaped strings and symbols',
    source: 'x:"a / `sym \\" \\141";s:`plain`.ns.member`"with space"',
    images: [['StringEscape', '\\"'], ['StringEscape', '\\141'], ['SymbolLiteral', '`plain']],
  },
  {
    name: 'numeric and temporal families',
    source: '0Ng 01234567-89ab-cdef-0123-456789abcdef 0x00ff 1b 2h 3i 4j 5e 6f 0N 0Nj 0W -0W 2026.08m 2026.08.25 2026.08.25D01:02:03.123456789 2026.08.25T01:02:03.123 0D01:02:03.4 01:02u 01:02:03v 01:02:03.004t',
    tokenTypes: ['GuidLiteral', 'ByteLiteral', 'BinaryLiteral', 'MonthLiteral', 'DateLiteral', 'TimeStampLiteral', 'DateTimeLiteral', 'TimeLiteral'],
  },
  {
    name: 'qsql namespaces and projections',
    source: 'select avg price by sym from trade where size>0; .Q.en[`a]!1; .z.pg; f[;2]; (+/;/:;\\:)',
    tokenTypes: ['LSql', 'RSql', 'Reserved', 'Iterator'],
  },
  {
    name: 'block comment and script exit',
    source: '/\ninside "comment" +/\n\\\nafter:1\n\\',
    tokenTypes: ['CommentBegin', 'CommentEnd', 'ExitCommentBegin'],
  },
]);

const FORMAT_FIXTURES = Object.freeze([
  {
    name: 'lambda indentation',
    source: 'f:{[x]\n    y:x+1   \n  y\n }',
    expected: 'f:{[x]\n  y:x+1\n  y\n  }',
  },
  {
    name: 'suppression',
    source: 'f:{\n // vscode-kdb-format-off\n       x:1   \n // vscode-kdb-format-on\n  x\n }',
    expected: 'f:{\n // vscode-kdb-format-off\n       x:1   \n // vscode-kdb-format-on\n  x\n  }',
  },
  {
    name: 'qsql and command',
    source: '\\l /data/trade.q\nq:{\n  select from trade\n }\n',
    expected: '\\l /data/trade.q\nq:{\n  select from trade\n  }\n',
  },
  {
    name: 'tabs nested projection and final newline',
    source: 'f:{[x]\n    r:(x;(+/x))   \n    r\n    }',
    options: { insertSpaces: false, tabSize: 4 },
    expected: 'f:{[x]\n\tr:(x;(+/x))\n\tr\n\t}',
  },
]);

module.exports = {
  FORMAT_FIXTURES,
  HIGHLIGHTING_FIXTURE,
  LEXICAL_BOUNDARY_CASES,
  LEXICAL_FIXTURE,
  NEGATIVE_FIXTURES,
  SEMANTIC_SELECTOR_FIXTURE,
};
