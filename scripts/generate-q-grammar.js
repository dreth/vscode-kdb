'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'syntaxes', 'q.tmLanguage.json');
const { generateTextMateGrammar } = require(path.join(ROOT, 'out', 'q-language-testing.js'));
const generated = generateTextMateGrammar();

if (process.argv.includes('--check')) {
  const current = fs.readFileSync(TARGET, 'utf8');
  if (current !== generated) {
    console.error('syntaxes/q.tmLanguage.json differs from the shared q lexical model.');
    process.exitCode = 1;
  } else {
    console.log('q TextMate grammar is current');
  }
} else {
  fs.writeFileSync(TARGET, generated, 'utf8');
  console.log('generated syntaxes/q.tmLanguage.json');
}
