/*
 * Copyright (c) 1998-2026 KX Systems Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy
 * at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Adapted for KX for VS Code from commit
 * 955292b68a53179cb1865608e917d4bcdc833ca1. The grammar shape and scope
 * mapping were rewritten for the independently specified q-only surface.
 */

import { writeFileSync } from 'fs';
import type { TokenType } from 'chevrotain';

import { Q_CATALOG } from '../catalog';
import {
  Q_TEXTMATE_CATALOG_ROLES,
  Q_TEXTMATE_LITERAL_ROLES,
  Q_TEXTMATE_PUNCTUATION_ROLES,
  Q_TEXTMATE_SCOPES,
  Q_TEXTMATE_WORD_ROLES,
} from '../highlighting';
import { CommentBegin, CommentEnd, ExitCommentBegin, StringBegin, StringEnd } from './ranges';
import {
  Command,
  Documentation,
  LineComment,
  StringEscape,
} from './tokens';

type Pattern = Record<string, unknown>;

const ranges: Pattern[] = [
  {
    name: Q_TEXTMATE_SCOPES.blockComment,
    begin: pattern(CommentBegin),
    beginCaptures: { 0: { name: Q_TEXTMATE_SCOPES.blockCommentBegin } },
    end: pattern(CommentEnd),
    endCaptures: { 0: { name: Q_TEXTMATE_SCOPES.blockCommentEnd } },
  },
  { name: Q_TEXTMATE_SCOPES.documentationComment, match: pattern(Documentation) },
  { name: Q_TEXTMATE_SCOPES.lineComment, match: pattern(LineComment) },
  { name: Q_TEXTMATE_SCOPES.preprocessor, match: pattern(Command) },
  { name: Q_TEXTMATE_SCOPES.preprocessor, match: pattern(ExitCommentBegin) },
  {
    name: Q_TEXTMATE_SCOPES.string,
    begin: pattern(StringBegin),
    beginCaptures: { 0: { name: Q_TEXTMATE_SCOPES.stringBegin } },
    end: pattern(StringEnd),
    endCaptures: { 0: { name: Q_TEXTMATE_SCOPES.stringEnd } },
    patterns: [{ name: Q_TEXTMATE_SCOPES.stringEscape, match: pattern(StringEscape) }],
  },
];

const literals: Pattern[] = Q_TEXTMATE_LITERAL_ROLES.map(({ token, scope }, index) => ({
  name: scope,
  match: index === 0 ? pattern(token) : bounded(token),
}));

const words: Pattern[] = [
  ...Q_TEXTMATE_CATALOG_ROLES.map(({ category, scope }) => ({
    name: scope,
    match: catalogPattern(category),
  })),
  ...Q_TEXTMATE_WORD_ROLES.map(({ token, scope }) => ({ name: scope, match: bounded(token) })),
];

const punctuation: Pattern[] = Q_TEXTMATE_PUNCTUATION_ROLES.map(({ token, scope }) => ({
  name: scope,
  match: pattern(token),
}));

export function qTextMateGrammar(): Record<string, unknown> {
  return {
    $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
    name: 'q',
    scopeName: 'source.q',
    patterns: [
      { include: '#notebookMagic' },
      { include: '#ranges' },
      { include: '#literals' },
      { include: '#words' },
      { include: '#punctuation' },
    ],
    repository: {
      notebookMagic: {
        patterns: [{
          name: Q_TEXTMATE_SCOPES.notebookMagic,
          match: '\\A[ \\t]*%%q(?:[ \\t].*)?$',
        }],
      },
      ranges: { patterns: ranges },
      literals: { patterns: literals },
      words: { patterns: words },
      punctuation: { patterns: punctuation },
    },
  };
}

export function generateTextMateGrammar(outputFile?: string): string {
  const value = `${JSON.stringify(qTextMateGrammar(), null, 2)}\n`;
  if (outputFile) writeFileSync(outputFile, value, 'utf8');
  return value;
}

function pattern(token: TokenType): string {
  const raw = String(token.PATTERN);
  const slash = raw.lastIndexOf('/');
  const flags = raw.slice(slash + 1);
  const body = raw.slice(1, slash);
  return flags ? `(?${flags})${body}` : body;
}

function bounded(token: TokenType): string {
  return `(?<![A-Za-z0-9_.])(?:${pattern(token)})(?![A-Za-z0-9_.])`;
}

function catalogPattern(category: typeof Q_CATALOG[number]['category']): string {
  const alternatives = Q_CATALOG
    .filter(entry => entry.category === category)
    .map(entry => entry.spelling)
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
    .map(value => value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'));
  return `(?<![A-Za-z0-9_.])(?:${alternatives.join('|')})(?![A-Za-z0-9_.])`;
}
