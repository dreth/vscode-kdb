'use strict';

const QNB_COMPATIBLE_CELLS = Object.freeze([
  Object.freeze({
    kind: 2,
    language: 'q',
    value: 'show 1 2 3\n',
    metadata: Object.freeze({ collapsed: false, custom: 'preserve me' }),
    executionSummary: Object.freeze({ executionOrder: 7, success: true }),
    outputs: Object.freeze([
      Object.freeze({ mime: 'text/plain', value: '1 2 3', stream: 'stdout' }),
      Object.freeze({ mime: 'text/html', value: '<pre>1 2 3</pre>' }),
      Object.freeze({
        mime: 'x-application/q-notebook',
        value: Object.freeze({ type: 'list', value: Object.freeze([1, 2, 3]) }),
      }),
      Object.freeze({
        mime: 'application/vnd.kx.result+json',
        value: Object.freeze({ version: 2, kind: 'text', text: '1 2 3' }),
        outputMetadata: Object.freeze({ durable: true }),
      }),
    ]),
  }),
  Object.freeze({
    kind: 1,
    language: 'markdown',
    value: '# q notebook\n\nNarrative text without a final newline.',
    attachments: Object.freeze({
      'pixel.png': Object.freeze({ 'image/png': 'iVBORw0KGgo=' }),
    }),
    unknownCellField: Object.freeze({ nested: Object.freeze([true, null, 4]) }),
    outputs: Object.freeze([]),
  }),
  Object.freeze({ kind: 2, language: 'python', value: '', outputs: Object.freeze([]) }),
]);

const QNB_MALFORMED_CASES = Object.freeze([
  '{',
  '{}',
  '[null]',
  '[{"kind":3,"language":"q","value":"","outputs":[]}]',
  '[{"kind":2,"language":"q","value":4,"outputs":[]}]',
  '[{"kind":2,"language":"q","value":"","outputs":{}}]',
  '[{"kind":2,"language":"q","value":"","outputs":[{"mime":"bad","value":1}]}]',
]);

module.exports = { QNB_COMPATIBLE_CELLS, QNB_MALFORMED_CASES };
