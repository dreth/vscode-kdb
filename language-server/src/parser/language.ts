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
import { Control, Identifier, Keyword, LSql, Module, Reserved, RSql, System } from './keywords';
import {
  BinaryLiteral,
  ByteLiteral,
  DateLiteral,
  DateTimeLiteral,
  GuidLiteral,
  InfinityLiteral,
  MonthLiteral,
  NumberLiteral,
  SymbolLiteral,
  TimeLiteral,
  TimeStampLiteral,
} from './literals';
import { CommentBegin, CommentEnd, ExitCommentBegin, StringBegin, StringEnd } from './ranges';
import {
  Colon,
  Command,
  Comparator,
  Cond,
  CutDrop,
  Dict,
  Documentation,
  DoubleColon,
  Iterator,
  LBracket,
  LCurly,
  LineComment,
  LParen,
  Operator,
  RBracket,
  RCurly,
  RParen,
  SemiColon,
  StringEscape,
} from './tokens';

type Pattern = Record<string, unknown>;

const ranges: Pattern[] = [
  {
    name: 'comment.block.q',
    begin: pattern(CommentBegin),
    beginCaptures: { 0: { name: 'punctuation.definition.comment.begin.q' } },
    end: pattern(CommentEnd),
    endCaptures: { 0: { name: 'punctuation.definition.comment.end.q' } },
  },
  { name: 'comment.line.documentation.q', match: pattern(Documentation) },
  { name: 'comment.line.slash.q', match: pattern(LineComment) },
  { name: 'meta.preprocessor.q', match: pattern(Command) },
  { name: 'meta.preprocessor.q', match: pattern(ExitCommentBegin) },
  {
    name: 'string.quoted.double.q',
    begin: pattern(StringBegin),
    beginCaptures: { 0: { name: 'punctuation.definition.string.begin.q' } },
    end: pattern(StringEnd),
    endCaptures: { 0: { name: 'punctuation.definition.string.end.q' } },
    patterns: [{ name: 'constant.character.escape.q', match: pattern(StringEscape) }],
  },
];

const literals: Pattern[] = [
  { name: 'constant.other.symbol.q', match: pattern(SymbolLiteral) },
  { name: 'constant.other.guid.q', match: bounded(GuidLiteral) },
  { name: 'constant.numeric.datetime.q', match: bounded(DateTimeLiteral) },
  { name: 'constant.numeric.timestamp.q', match: bounded(TimeStampLiteral) },
  { name: 'constant.numeric.date.q', match: bounded(DateLiteral) },
  { name: 'constant.numeric.month.q', match: bounded(MonthLiteral) },
  { name: 'constant.numeric.time.q', match: bounded(TimeLiteral) },
  { name: 'constant.language.null.q', match: bounded(InfinityLiteral) },
  { name: 'constant.language.boolean.q', match: bounded(BinaryLiteral) },
  { name: 'constant.numeric.hex.q', match: bounded(ByteLiteral) },
  { name: 'constant.numeric.q', match: bounded(NumberLiteral) },
];

const words: Pattern[] = [
  {
    name: 'support.function.builtin.q',
    match: catalogPattern('builtin'),
  },
  {
    name: 'support.function.system.q',
    match: catalogPattern('system-namespace'),
  },
  { name: 'keyword.control.q', match: bounded(Control) },
  { name: 'keyword.other.query.q', match: bounded(LSql) },
  { name: 'keyword.other.query.q', match: bounded(RSql) },
  { name: 'keyword.control.module.q', match: bounded(Module) },
  { name: 'support.function.system.q', match: bounded(Reserved) },
  { name: 'support.function.q', match: bounded(Keyword) },
  { name: 'support.function.q', match: bounded(System) },
  { name: 'variable.other.q', match: bounded(Identifier) },
];

const punctuation: Pattern[] = [
  { name: 'keyword.operator.iterator.q', match: pattern(Iterator) },
  { name: 'keyword.operator.comparison.q', match: pattern(Comparator) },
  { name: 'keyword.operator.q', match: pattern(CutDrop) },
  { name: 'keyword.operator.q', match: pattern(Dict) },
  { name: 'keyword.operator.q', match: pattern(Operator) },
  { name: 'keyword.operator.conditional.q', match: pattern(Cond) },
  { name: 'keyword.operator.assignment.q', match: pattern(DoubleColon) },
  { name: 'keyword.operator.assignment.q', match: pattern(Colon) },
  { name: 'punctuation.separator.semicolon.q', match: pattern(SemiColon) },
  { name: 'punctuation.section.parens.begin.q', match: pattern(LParen) },
  { name: 'punctuation.section.parens.end.q', match: pattern(RParen) },
  { name: 'punctuation.section.brackets.begin.q', match: pattern(LBracket) },
  { name: 'punctuation.section.brackets.end.q', match: pattern(RBracket) },
  { name: 'punctuation.section.block.begin.q', match: pattern(LCurly) },
  { name: 'punctuation.section.block.end.q', match: pattern(RCurly) },
];

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
          name: 'meta.preprocessor.notebook.magic.q',
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
