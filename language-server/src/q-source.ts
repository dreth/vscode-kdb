import type { ILexingError, IToken } from 'chevrotain';
import { Position, Range } from 'vscode-languageserver/node';

import { parse } from './parser/parser';
import { QLexer } from './parser/lexer';
import {
  Identifier,
  LSql,
  RSql,
} from './parser/keywords';
import { SymbolLiteral } from './parser/literals';
import {
  CommentBegin,
  CommentEnd,
  ExitCommentBegin,
  StringBegin,
  StringEnd,
} from './parser/ranges';
import {
  Command,
  Documentation,
  LBracket,
  LCurly,
  LineComment,
  LParen,
  RBracket,
  RCurly,
  RParen,
  StringEscape,
  WhiteSpace,
} from './parser/tokens';
import { Source, Name, Param, Scope, Token as SourceToken, Type } from './parser/source';
import { SyntaxError, Token } from './parser/utils';

export type QIssueKind =
  | 'invalid-character'
  | 'invalid-escape'
  | 'unterminated-string'
  | 'unterminated-block-comment'
  | 'unmatched-delimiter';

export interface QIssue {
  readonly kind: QIssueKind;
  readonly range: Range;
  readonly message: string;
  readonly related?: Range;
}

export interface QProtectedRange {
  readonly kind: 'string' | 'comment' | 'command' | 'symbol';
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface QBinding {
  readonly name: string;
  readonly range: Range;
  readonly offset: number;
  readonly endOffset: number;
  readonly declaration: boolean;
  readonly parameter: boolean;
  readonly local: boolean;
  readonly callable: boolean;
  readonly qsql: boolean;
  readonly scopeOffset?: number;
  readonly bodyScopeOffset?: number;
}

export class QSource {
  public readonly tokens: readonly Token[];
  public readonly sourceModel: Source;
  public readonly issues: readonly QIssue[];
  public readonly protectedRanges: readonly QProtectedRange[];
  public readonly bindings: readonly QBinding[];
  public readonly imports: readonly { alias: string; module: string }[];
  public readonly loads: readonly string[];
  public readonly lineStarts: readonly number[];
  public readonly byteLength: number;
  private readonly tokensByStart: ReadonlyMap<number, Token>;
  private readonly delimiterClosers: ReadonlyMap<number, Token>;
  private readonly curlyScopes: readonly { opener: Token; endOffset: number }[];

  private constructor(
    public readonly uri: string,
    public readonly version: number,
    public readonly text: string,
    public readonly alias?: string,
  ) {
    const lexed = QLexer.tokenize(text);
    this.tokens = Object.freeze(parse(text).slice());
    this.tokensByStart = new Map(this.tokens.map(token => [tokenStart(token), token]));
    this.delimiterClosers = delimiterCloserMap(this.tokens);
    this.curlyScopes = Object.freeze(this.tokens
      .filter(token => token.tokenType === LCurly)
      .flatMap(opener => {
        const closer = this.delimiterClosers.get(tokenStart(opener));
        return closer ? [{ opener, endOffset: tokenEnd(closer) }] : [];
      }));
    this.sourceModel = Source.create(uri, text, alias);
    this.lineStarts = Object.freeze(computeLineStarts(text));
    this.byteLength = Buffer.byteLength(text, 'utf8');
    const protectedResult = protectedRanges(this.tokens, text.length);
    this.protectedRanges = Object.freeze(protectedResult.ranges);
    this.issues = Object.freeze([
      ...lexingIssues(lexed.errors, this.lineStarts),
      ...tokenIssues(this.tokens),
      ...protectedResult.issues,
      ...delimiterIssues(this.tokens),
    ].sort(compareIssues));
    this.bindings = Object.freeze(sourceBindings(this.sourceModel));
    this.imports = Object.freeze(this.sourceModel.imports.map(value => Object.freeze({ ...value })));
    this.loads = Object.freeze(this.tokens
      .filter(token => token.tokenType === Command)
      .flatMap(token => token.image.match(/^\\l[ \t]+([^\s]+)[ \t]*$/)?.[1] ?? [])
      .map(value => value.replace(/^['"]|['"]$/g, '')));
    Object.freeze(this);
  }

  public static create(uri: string, version: number, text: string): QSource {
    return new QSource(uri, version, text);
  }

  public static createAliased(source: QSource, alias: string): QSource {
    return new QSource(source.uri, source.version, source.text, alias);
  }

  public positionAt(offset: number): Position {
    const safe = Math.max(0, Math.min(offset, this.text.length));
    let low = 0;
    let high = this.lineStarts.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (this.lineStarts[mid] > safe) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }
    const line = Math.max(0, low - 1);
    return Position.create(line, safe - this.lineStarts[line]);
  }

  public offsetAt(position: Position): number {
    const line = Math.max(0, Math.min(position.line, this.lineStarts.length - 1));
    const start = this.lineStarts[line];
    const end = line + 1 < this.lineStarts.length
      ? this.lineStarts[line + 1]
      : this.text.length;
    return Math.max(start, Math.min(start + Math.max(0, position.character), end));
  }

  public tokenAt(position: Position): Token | undefined {
    const offset = this.offsetAt(position);
    let low = 0;
    let high = this.tokens.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const token = this.tokens[middle];
      if (tokenStart(token) > offset) {
        high = middle - 1;
      } else if (tokenEnd(token) < offset) {
        low = middle + 1;
      } else {
        return token;
      }
    }
    return undefined;
  }

  public tokenStartingAt(offset: number): Token | undefined {
    return this.tokensByStart.get(offset);
  }

  public matchingDelimiter(opener: Token): Token | undefined {
    return this.delimiterClosers.get(tokenStart(opener));
  }

  public enclosingCurly(offset: number): Token | undefined {
    let result: Token | undefined;
    for (const scope of this.curlyScopes) {
      const start = tokenStart(scope.opener);
      if (start > offset) break;
      if (scope.endOffset >= offset && (!result || start > tokenStart(result))) {
        result = scope.opener;
      }
    }
    return result;
  }

  public protectedAt(position: Position): QProtectedRange | undefined {
    const offset = this.offsetAt(position);
    return this.protectedRanges.find(range => range.startOffset <= offset && range.endOffset >= offset);
  }

  public rangeFromOffsets(start: number, end: number): Range {
    return Range.create(this.positionAt(start), this.positionAt(end));
  }

  public lineIsContinuation(line: number): boolean {
    if (line <= 0 || line >= this.lineStarts.length) {
      return false;
    }
    const start = this.lineStarts[line];
    const end = line + 1 < this.lineStarts.length ? this.lineStarts[line + 1] : this.text.length;
    const value = this.text.slice(start, end).replace(/[\r\n]+$/, '');
    return value.length > 0 && /^[ \t]/.test(value) && value.trim().length > 0;
  }

  public significantTokens(): readonly string[] {
    return this.tokens
      .filter(token => token.tokenType !== WhiteSpace)
      .map(token => `${token.tokenType.name}:${token.image}`);
  }
}

function sourceBindings(source: Source): QBinding[] {
  const declarations = new Set(source.definitions);
  const values = [...source.definitions, ...source.references];
  const seen = new Set<string>();
  const bindings: QBinding[] = [];
  for (const token of values) {
    if (Type(token) !== Identifier) {
      continue;
    }
    const start = tokenStart(token);
    const key = `${start}:${declarations.has(token) ? 'd' : 'r'}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const scope = Scope(token);
    bindings.push(Object.freeze({
      name: Name(token),
      range: tokenRange(token),
      offset: start,
      endOffset: tokenEnd(token) + 1,
      declaration: declarations.has(token),
      parameter: Param(token),
      local: scope !== undefined,
      callable: token.call !== undefined,
      qsql: qSqlIdentifier(token, source.tokens),
      scopeOffset: scope ? tokenStart(scope) : undefined,
      bodyScopeOffset: token.call ? tokenStart(token.call) : undefined,
    }));
  }
  return bindings.sort((a, b) => a.offset - b.offset);
}

function qSqlIdentifier(token: SourceToken, tokens: readonly SourceToken[]): boolean {
  if (Type(token.mode) === LSql) return true;
  const index = token.index ?? tokens.indexOf(token);
  let start = index - 1;
  while (start >= 0 && Type(tokens[start]) !== RSql &&
    Type(tokens[start]) !== LSql && tokens[start].image !== ';' && !tokens[start].image.includes('\n')) {
    start--;
  }
  if (start < 0 || Type(tokens[start]) !== RSql) return false;
  let queryStart = start - 1;
  while (queryStart >= 0 && Type(tokens[queryStart]) !== LSql &&
    tokens[queryStart].image !== ';' && !tokens[queryStart].image.includes('\n')) {
    queryStart--;
  }
  if (queryStart < 0 || Type(tokens[queryStart]) !== LSql) return false;
  for (let previous = index - 1; previous >= 0; previous--) {
    if (tokens[previous].image.trim().length === 0) continue;
    return Type(tokens[previous]) !== RSql;
  }
  return true;
}

function protectedRanges(tokens: readonly Token[], textLength: number): {
  ranges: QProtectedRange[];
  issues: QIssue[];
} {
  const ranges: QProtectedRange[] = [];
  const issues: QIssue[] = [];
  let stringStart: Token | undefined;
  let commentStart: Token | undefined;
  for (const token of tokens) {
    switch (token.tokenType) {
      case StringBegin:
        stringStart = token;
        break;
      case StringEnd:
        if (stringStart) {
          ranges.push({ kind: 'string', startOffset: tokenStart(stringStart), endOffset: tokenEnd(token) });
          stringStart = undefined;
        }
        break;
      case CommentBegin:
        commentStart = token;
        break;
      case CommentEnd:
        if (commentStart) {
          ranges.push({ kind: 'comment', startOffset: tokenStart(commentStart), endOffset: tokenEnd(token) });
          commentStart = undefined;
        }
        break;
      case LineComment:
      case Documentation:
        ranges.push({ kind: 'comment', startOffset: tokenStart(token), endOffset: tokenEnd(token) });
        break;
      case ExitCommentBegin:
        ranges.push({ kind: 'comment', startOffset: tokenStart(token), endOffset: Math.max(tokenEnd(token), textLength - 1) });
        break;
      case Command:
        ranges.push({ kind: 'command', startOffset: tokenStart(token), endOffset: tokenEnd(token) });
        break;
      case SymbolLiteral:
        ranges.push({ kind: 'symbol', startOffset: tokenStart(token), endOffset: tokenEnd(token) });
        break;
    }
  }
  if (stringStart) {
    ranges.push({ kind: 'string', startOffset: tokenStart(stringStart), endOffset: Math.max(tokenEnd(stringStart), textLength - 1) });
    issues.push({
      kind: 'unterminated-string',
      range: tokenRange(stringStart),
      message: 'String is not terminated before the end of the document.',
    });
  }
  if (commentStart) {
    ranges.push({ kind: 'comment', startOffset: tokenStart(commentStart), endOffset: Math.max(tokenEnd(commentStart), textLength - 1) });
    issues.push({
      kind: 'unterminated-block-comment',
      range: tokenRange(commentStart),
      message: 'Block comment is not terminated by a line containing only \\.',
    });
  }
  return { ranges, issues };
}

function delimiterIssues(tokens: readonly Token[]): QIssue[] {
  const stack: Token[] = [];
  const issues: QIssue[] = [];
  const pairs = new Map([
    [RParen, LParen],
    [RBracket, LBracket],
    [RCurly, LCurly],
  ]);
  for (const token of tokens) {
    if (token.tokenType === LParen || token.tokenType === LBracket || token.tokenType === LCurly || token.tokenType === LSql) {
      stack.push(token);
      continue;
    }
    if (token.tokenType === RSql) {
      const sqlIndex = stack.map(value => value.tokenType).lastIndexOf(LSql);
      if (sqlIndex >= 0) {
        stack.splice(sqlIndex, 1);
      }
      continue;
    }
    const expected = pairs.get(token.tokenType);
    if (!expected) {
      continue;
    }
    const opener = stack.pop();
    if (!opener || opener.tokenType !== expected) {
      issues.push({
        kind: 'unmatched-delimiter',
        range: tokenRange(token),
        message: `Closing delimiter ${token.image} has no matching opener.`,
        related: opener ? tokenRange(opener) : undefined,
      });
    }
  }
  for (const opener of stack.filter(token => token.tokenType !== LSql)) {
    issues.push({
      kind: 'unmatched-delimiter',
      range: tokenRange(opener),
      message: `Opening delimiter ${opener.image} is not closed.`,
    });
  }
  return issues;
}

function delimiterCloserMap(tokens: readonly Token[]): ReadonlyMap<number, Token> {
  const closers = new Map<number, Token>();
  for (const token of tokens) {
    if ((token.tokenType === RParen || token.tokenType === RBracket || token.tokenType === RCurly) && token.scope) {
      closers.set(tokenStart(token.scope), token);
    }
  }
  return closers;
}

function tokenIssues(tokens: readonly Token[]): QIssue[] {
  return tokens
    .filter(token => token.tokenType === StringEscape && token.error === SyntaxError.InvalidEscape)
    .map(token => ({
      kind: 'invalid-escape' as const,
      range: tokenRange(token),
      message: `Invalid q string escape ${JSON.stringify(token.image)}.`,
    }));
}

function lexingIssues(errors: readonly ILexingError[], lineStarts: readonly number[]): QIssue[] {
  return errors.map(error => {
    const offset = Math.max(0, error.offset);
    const start = positionAt(lineStarts, offset);
    return {
      kind: 'invalid-character' as const,
      range: Range.create(start, Position.create(start.line, start.character + Math.max(1, error.length))),
      message: 'Character is not valid in this q source context.',
    };
  });
}

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function positionAt(starts: readonly number[], offset: number): Position {
  let line = 0;
  while (line + 1 < starts.length && starts[line + 1] <= offset) {
    line++;
  }
  return Position.create(line, offset - starts[line]);
}

export function tokenStart(token: Pick<IToken, 'startOffset'>): number {
  return token.startOffset < 0 ? 0 : token.startOffset;
}

export function tokenEnd(token: Pick<IToken, 'endOffset' | 'startOffset'>): number {
  return token.endOffset === undefined || token.endOffset < 0
    ? tokenStart(token)
    : token.endOffset;
}

export function tokenRange(token: SourceToken | Token): Range {
  const startLine = safeLocation(token.startLine, 1) - 1;
  const startColumn = safeLocation(token.startColumn, 1) - 1;
  const endLine = safeLocation(token.endLine, startLine + 1) - 1;
  const endColumn = safeLocation(token.endColumn, startColumn + Math.max(1, token.image.length));
  return Range.create(startLine, startColumn, endLine, endColumn);
}

function safeLocation(value: number | undefined, fallback: number): number {
  return value === undefined || value < 1 ? fallback : value;
}

function compareIssues(left: QIssue, right: QIssue): number {
  return left.range.start.line - right.range.start.line ||
    left.range.start.character - right.range.start.character ||
    left.kind.localeCompare(right.kind);
}
