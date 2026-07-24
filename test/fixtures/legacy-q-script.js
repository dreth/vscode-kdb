'use strict';

const SCRIPT_GROUPING_CASES = Object.freeze([
  Object.freeze({
    id: 'ordinary-lf-script',
    source: 'a:1\nb:2\na+b',
    expected: Object.freeze(['a:1', 'b:2', 'a+b']),
  }),
  Object.freeze({
    id: 'first-line-shebang',
    source: '#!/usr/bin/env q\nlegacyShebang:1\nlegacyShebang',
    expected: Object.freeze(['legacyShebang:1', 'legacyShebang']),
  }),
  Object.freeze({
    id: 'crlf-function-and-readback',
    source: 'legacyFn:{[x]\r\n x+1\r\n }\r\nlegacyFn 4',
    expected: Object.freeze(['legacyFn:{[x]\n x+1\n }', 'legacyFn 4']),
  }),
  Object.freeze({
    id: 'multiline-query',
    source: 'legacyTrade:([]sym:`A`B;size:10 20)\nselect from legacyTrade where\n size>10',
    expected: Object.freeze([
      'legacyTrade:([]sym:`A`B;size:10 20)',
      'select from legacyTrade where\n size>10',
    ]),
  }),
  Object.freeze({
    id: 'function-control-blocks',
    source: 'legacyCtl:0\nif[1b;\n legacyCtl:7;\n legacyCtl+:1]\nlegacyCtl',
    expected: Object.freeze([
      'legacyCtl:0',
      'if[1b;\n legacyCtl:7;\n legacyCtl+:1]',
      'legacyCtl',
    ]),
  }),
  Object.freeze({
    id: 'tabs-normalize-in-continuation-indent',
    source: 'legacyTabFn:{[x]\n\tvalue:x+1;\n\tvalue*2\n\t}\nlegacyTabFn 4',
    expected: Object.freeze([
      'legacyTabFn:{[x]\n value:x+1;\n value*2\n }',
      'legacyTabFn 4',
    ]),
  }),
  Object.freeze({
    id: 'quotes-backslashes-and-q-newline',
    source: 'legacyText:"a\\"b\\\\c\\nline"\nlegacyText',
    expected: Object.freeze(['legacyText:"a\\"b\\\\c\\nline"', 'legacyText']),
  }),
  Object.freeze({
    id: 'comments-blanks-and-trailing-newline',
    source: '/ heading\na:1\n\n/ between\nb:2\n',
    expected: Object.freeze(['/ heading', 'a:1', '', '/ between', 'b:2', '']),
  }),
  Object.freeze({
    id: 'multiline-comment',
    source: '/\nnot executable\n2+2\n\\\na:1',
    expected: Object.freeze(['/', '/not executable', '/2+2', '/', 'a:1']),
  }),
  Object.freeze({
    id: 'nested-multiline-comment',
    source: 'a:1\n/\n/\nnot executable\n\\\nstill not executable\n\\\na+:1\na',
    expected: Object.freeze([
      'a:1',
      '/',
      '/',
      '/not executable',
      '/',
      '/still not executable',
      '/',
      'a+:1',
      'a',
    ]),
  }),
  Object.freeze({
    id: 'multiline-comment-whitespace',
    source: '/\n   \n\\\na:1',
    expected: Object.freeze(['/', '/', '/', 'a:1']),
  }),
  Object.freeze({
    id: 'script-terminator',
    source: 'beforeStop:1\n\\   \nafterStop:2',
    expected: Object.freeze(['beforeStop:1']),
  }),
  Object.freeze({
    id: 'pending-comment-before-script-terminator',
    source: '1+1\n/ trailing result-changing comment\n\\',
    expected: Object.freeze(['1+1', '/ trailing result-changing comment']),
  }),
  Object.freeze({
    id: 'leading-continuation-without-expression',
    source: '  ignored:1\nactual:2',
    expected: Object.freeze(['actual:2']),
  }),
  Object.freeze({
    id: 'single-character-expression',
    source: '1',
    expected: Object.freeze(['1']),
  }),
  Object.freeze({
    id: 'multiple-single-character-expressions',
    source: '1\n2',
    expected: Object.freeze(['1', '2']),
  }),
  Object.freeze({
    id: 'no-top-level-expression',
    source: '  ignored:1',
    expected: Object.freeze([]),
  }),
]);

const LEGACY_NOTEBOOK_FIXTURE = Object.freeze({
  namespace: '.legacy.compat',
  username: 'legacy-notebook-user-sensitive',
  password: 'legacy-notebook-password-sensitive',
  cells: Object.freeze([
    Object.freeze({
      source: 'legacyValue:40\n/ complete first cell\nlegacyValue+:1\nlegacyValue',
      expectedGroups: Object.freeze([
        'legacyValue:40',
        '/ complete first cell',
        'legacyValue+:1',
        'legacyValue',
      ]),
      result: 41,
    }),
    Object.freeze({
      source: 'legacyValue+:1\nlegacyValue',
      expectedGroups: Object.freeze(['legacyValue+:1', 'legacyValue']),
      result: 42,
    }),
  ]),
});

module.exports = {
  LEGACY_NOTEBOOK_FIXTURE,
  SCRIPT_GROUPING_CASES,
};
