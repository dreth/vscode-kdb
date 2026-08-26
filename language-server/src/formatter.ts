import { Range, TextEdit } from 'vscode-languageserver/node';

import { QSource } from './q-source';
import { CommentBegin, StringBegin } from './parser/ranges';
import { Command, Documentation, LBracket, LCurly, LineComment, LParen, RBracket, RCurly, RParen } from './parser/tokens';

export interface QFormatOptions {
  readonly insertSpaces: boolean;
  readonly tabSize: number;
}

export interface QFormatResult {
  readonly edits: readonly TextEdit[];
  readonly skipped?: string;
  readonly formattedText?: string;
}

export function formatQDocument(source: QSource, options: QFormatOptions): QFormatResult {
  return formatQRange(source, options, undefined);
}

export function formatQRange(
  source: QSource,
  options: QFormatOptions,
  requested: Range | undefined,
): QFormatResult {
  if (source.issues.length > 0) {
    return { edits: [], skipped: source.issues[0].message };
  }
  const tabSize = Number.isInteger(options.tabSize) && options.tabSize > 0
    ? Math.min(options.tabSize, 16)
    : 2;
  const unit = options.insertSpaces ? ' '.repeat(tabSize) : '\t';
  const lines = splitLines(source.text);
  const firstLine = requested ? Math.max(0, requested.start.line) : 0;
  const lastLine = requested
    ? Math.min(lines.length - 1, requested.end.character === 0 && requested.end.line > requested.start.line
      ? requested.end.line - 1
      : requested.end.line)
    : lines.length - 1;
  if (requested && rangeCrossesProtected(source, requested)) {
    return { edits: [], skipped: 'The requested range crosses a string, comment, or system command.' };
  }
  const suppressed = formatSuppressedLines(source, lines.length);
  const depths = lineDepths(source, lines.length);
  const output = lines.map(value => value.full);
  for (let line = firstLine; line <= lastLine; line++) {
    if (suppressed.has(line)) {
      continue;
    }
    const current = lines[line];
    const body = current.body;
    if (!body.trim()) {
      continue;
    }
    const leading = body.match(/^[ \t]*/)?.[0] ?? '';
    const continuation = leading.length > 0;
    const wantedDepth = continuation ? Math.max(1, depths[line]) : 0;
    let candidate = unit.repeat(wantedDepth) + body.slice(leading.length);
    if (trailingWhitespaceIsSafe(source, line, current.startOffset, candidate)) {
      candidate = candidate.replace(/[ \t]+$/, '');
    }
    output[line] = candidate + current.newline;
  }
  const formatted = output.join('');
  if (formatted === source.text) {
    return { edits: [], formattedText: formatted };
  }
  const safety = formattingIsSafe(source, formatted);
  if (safety !== undefined) {
    return { edits: [], skipped: safety };
  }
  const range = requested
    ? Range.create(firstLine, 0, lastLine, lines[lastLine].body.length)
    : Range.create(source.positionAt(0), source.positionAt(source.text.length));
  const replacement = requested
    ? output.slice(firstLine, lastLine + 1).map((value, index) =>
      index === output.slice(firstLine, lastLine + 1).length - 1
        ? value.replace(/(?:\r\n|\n|\r)$/, '')
        : value
    ).join('')
    : formatted;
  return { edits: [TextEdit.replace(range, replacement)], formattedText: formatted };
}

function formattingIsSafe(source: QSource, formatted: string): string | undefined {
  const candidate = QSource.create(source.uri, source.version, formatted);
  if (candidate.issues.length > 0) {
    return 'Formatting was skipped because the candidate did not parse safely.';
  }
  if (source.significantTokens().join('\0') !== candidate.significantTokens().join('\0')) {
    return 'Formatting was skipped because it would change q tokens.';
  }
  if (newlineCount(source.text) !== newlineCount(formatted)) {
    return 'Formatting was skipped because it would change line structure.';
  }
  for (let line = 0; line < source.lineStarts.length; line++) {
    if (source.lineIsContinuation(line) !== candidate.lineIsContinuation(line)) {
      return 'Formatting was skipped because it would change q continuation semantics.';
    }
  }
  return undefined;
}

function lineDepths(source: QSource, lineCount: number): number[] {
  const result = new Array<number>(lineCount).fill(0);
  let depth = 0;
  let line = 0;
  for (const token of source.tokens) {
    const tokenLine = Math.max(0, (token.startLine ?? 1) - 1);
    while (line <= tokenLine && line < result.length) {
      result[line] = depth;
      line++;
    }
    if (token.tokenType === RParen || token.tokenType === RBracket || token.tokenType === RCurly) {
      if (result[tokenLine] > 0 && firstNonWhitespaceTokenOnLine(source, tokenLine) === token) {
        result[tokenLine]--;
      }
      depth = Math.max(0, depth - 1);
    } else if (token.tokenType === LParen || token.tokenType === LBracket || token.tokenType === LCurly) {
      depth++;
    }
  }
  while (line < result.length) {
    result[line++] = depth;
  }
  return result;
}

function firstNonWhitespaceTokenOnLine(source: QSource, line: number) {
  return source.tokens.find(token => (token.startLine ?? 1) - 1 === line && token.image.trim().length > 0);
}

function formatSuppressedLines(source: QSource, lineCount: number): Set<number> {
  const suppressed = new Set<number>();
  let disabledFrom: number | undefined;
  for (const token of source.tokens) {
    if (token.tokenType !== LineComment && token.tokenType !== Documentation) {
      continue;
    }
    const line = Math.max(0, (token.startLine ?? 1) - 1);
    if (/\/\/\s*vscode-kdb-format-off\b/.test(token.image)) {
      disabledFrom ??= line;
    }
    if (/\/\/\s*vscode-kdb-format-on\b/.test(token.image) && disabledFrom !== undefined) {
      for (let value = disabledFrom; value <= line; value++) suppressed.add(value);
      disabledFrom = undefined;
    }
  }
  if (disabledFrom !== undefined) {
    for (let line = disabledFrom; line < lineCount; line++) suppressed.add(line);
  }
  return suppressed;
}

function trailingWhitespaceIsSafe(source: QSource, line: number, start: number, body: string): boolean {
  const trailing = body.match(/[ \t]+$/);
  if (!trailing) {
    return false;
  }
  const trailingStart = start + body.length - trailing[0].length;
  return !source.protectedRanges.some(range =>
    range.startOffset <= start + body.length && range.endOffset >= trailingStart
  ) && !source.tokens.some(token =>
    (token.startLine ?? 1) - 1 === line &&
    (token.tokenType === Command || token.tokenType === CommentBegin || token.tokenType === StringBegin)
  );
}

function rangeCrossesProtected(source: QSource, range: Range): boolean {
  const start = source.offsetAt(range.start);
  const end = source.offsetAt(range.end);
  return source.protectedRanges.some(value =>
    (value.startOffset < start && value.endOffset >= start) ||
    (value.startOffset < end && value.endOffset >= end)
  );
}

function splitLines(text: string): Array<{
  body: string;
  newline: string;
  full: string;
  startOffset: number;
}> {
  const result: Array<{ body: string; newline: string; full: string; startOffset: number }> = [];
  const pattern = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  let match: RegExpExecArray | null;
  let offset = 0;
  while ((match = pattern.exec(text)) && (match[0].length > 0 || result.length === 0)) {
    result.push({ body: match[1], newline: match[2], full: match[0], startOffset: offset });
    offset += match[0].length;
    if (!match[2]) {
      break;
    }
  }
  return result;
}

function newlineCount(text: string): number {
  return (text.match(/\n/g) ?? []).length + (text.match(/\r(?!\n)/g) ?? []).length;
}
