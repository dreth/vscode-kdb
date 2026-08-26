import {
  Diagnostic,
  DiagnosticRelatedInformation,
  DiagnosticSeverity,
  DiagnosticTag,
  Location,
  Range,
} from 'vscode-languageserver/node';

import { DateTimeLiteral } from './parser/literals';
import {
  Colon,
  Comparator,
  Cond,
  CutDrop,
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
  WhiteSpace,
} from './parser/tokens';
import { QSource, tokenRange } from './q-source';
import { QLanguageSettings, QLintCode, QLintSeverity, Q_LINT_CODES } from './settings';

export function diagnoseQSource(source: QSource, settings: QLanguageSettings): readonly Diagnostic[] {
  const syntax = source.issues.map(issue => {
    const diagnostic = Diagnostic.create(
      issue.range,
      issue.message,
      DiagnosticSeverity.Error,
      issueCode(issue.kind),
      'vscode-kdb'
    );
    if (issue.related) {
      diagnostic.relatedInformation = [DiagnosticRelatedInformation.create(
        Location.create(source.uri, issue.related),
        'Related delimiter starts here.'
      )];
    }
    return diagnostic;
  });
  if (!settings.lint.enabled) {
    return capDiagnostics(syntax, settings.diagnostics.maxProblems);
  }
  const directives = lintDirectives(source);
  const lint = [
    ...deprecatedDatetime(source),
    ...unusedBindings(source),
    ...declaredAfterUse(source),
    ...unindentedContinuations(source),
    ...directives.diagnostics,
  ].filter(diagnostic => {
    const code = String(diagnostic.code ?? '') as QLintCode;
    if (!Q_LINT_CODES.includes(code)) {
      return true;
    }
    const severity = settings.lint.rules[code];
    if (severity === 'off' || directives.suppressed(code, diagnostic.range.start.line)) {
      return false;
    }
    diagnostic.severity = severityValue(severity);
    return true;
  });
  return capDiagnostics([...syntax, ...lint].sort(compareDiagnostics), settings.diagnostics.maxProblems);
}

function deprecatedDatetime(source: QSource): Diagnostic[] {
  return source.tokens
    .filter(token => token.tokenType === DateTimeLiteral)
    .map(token => lintDiagnostic(
      tokenRange(token),
      'q.deprecated-datetime',
      'Datetime literals are deprecated; prefer timestamp or date/time values.',
      DiagnosticSeverity.Warning
    ));
}

function unusedBindings(source: QSource): Diagnostic[] {
  const result: Diagnostic[] = [];
  const referenced = new Set(source.bindings
    .filter(value => !value.declaration)
    .map(bindingKey));
  for (const declaration of source.bindings.filter(value => value.declaration && value.local)) {
    if (referenced.has(bindingKey(declaration))) {
      continue;
    }
    const code: QLintCode = declaration.parameter ? 'q.unused-parameter' : 'q.unused-local';
    const diagnostic = lintDiagnostic(
      declaration.range,
      code,
      `${declaration.parameter ? 'Parameter' : 'Local'} ${declaration.name} is not used in its lexical scope.`,
      DiagnosticSeverity.Hint
    );
    diagnostic.tags = [DiagnosticTag.Unnecessary];
    result.push(diagnostic);
  }
  return result;
}

function declaredAfterUse(source: QSource): Diagnostic[] {
  const result: Diagnostic[] = [];
  const earliestReferences = new Map<string, typeof source.bindings[number]>();
  for (const binding of source.bindings) {
    if (binding.declaration) continue;
    const key = bindingKey(binding);
    const current = earliestReferences.get(key);
    if (!current || binding.offset < current.offset) earliestReferences.set(key, binding);
  }
  for (const declaration of source.bindings.filter(value => value.declaration)) {
    const earlier = earliestReferences.get(bindingKey(declaration));
    if (earlier && earlier.offset < declaration.offset) {
      result.push(lintDiagnostic(
        earlier.range,
        'q.declared-after-use',
        `${declaration.name} is used before its declaration in this lexical scope.`,
        DiagnosticSeverity.Warning
      ));
    }
  }
  return result;
}

function bindingKey(binding: QSource['bindings'][number]): string {
  return `${binding.scopeOffset ?? 'global'}\u0000${binding.name}`;
}

function unindentedContinuations(source: QSource): Diagnostic[] {
  const result: Diagnostic[] = [];
  const stack: unknown[] = [];
  let previousSignificant: typeof source.tokens[number] | undefined;
  const lines = new Map<number, typeof source.tokens[number][]>();
  for (const token of source.tokens) {
    const line = Math.max(0, (token.startLine ?? 1) - 1);
    const values = lines.get(line) ?? [];
    values.push(token);
    lines.set(line, values);
  }
  for (let line = 0; line < source.lineStarts.length; line++) {
    const tokens = lines.get(line) ?? [];
    const first = tokens.find(token => token.tokenType !== WhiteSpace && token.image.trim().length > 0);
    const column = first ? Math.max(0, (first.startColumn ?? 1) - 1) : -1;
    if (line > 0 && first && column === 0 &&
      (stack.length > 0 || (previousSignificant && continuationAfter(previousSignificant)))) {
      result.push(lintDiagnostic(
        tokenRange(first),
        'q.unindented-continuation',
        'This continued q expression starts at column zero and may execute as a new expression.',
        DiagnosticSeverity.Warning
      ));
    }
    for (const token of tokens) {
      if (token.tokenType === LParen || token.tokenType === LBracket || token.tokenType === LCurly) {
        stack.push(token.tokenType);
      } else if (token.tokenType === RParen || token.tokenType === RBracket || token.tokenType === RCurly) {
        stack.pop();
      }
      if (token.tokenType !== WhiteSpace && token.image.trim().length > 0) previousSignificant = token;
    }
  }
  return result;
}

function continuationAfter(token: typeof QSource.prototype.tokens[number]): boolean {
  return token.tokenType === Operator || token.tokenType === Iterator ||
    token.tokenType === Comparator || token.tokenType === Cond ||
    token.tokenType === CutDrop || token.tokenType === Colon ||
    token.tokenType === DoubleColon;
}

interface LintDirectives {
  readonly diagnostics: readonly Diagnostic[];
  suppressed(code: QLintCode, line: number): boolean;
}

function lintDirectives(source: QSource): LintDirectives {
  const disabled = new Map<QLintCode, Array<{ start: number; end: number }>>();
  const open = new Map<QLintCode, number>();
  const next = new Map<number, Set<QLintCode>>();
  const diagnostics: Diagnostic[] = [];
  for (const token of source.tokens) {
    if (token.tokenType !== LineComment && token.tokenType !== Documentation) {
      continue;
    }
    const match = token.image.match(/\/\/\s*vscode-kdb-lint-(disable-next-line|disable|enable)\b(.*)$/);
    if (!match) {
      continue;
    }
    const line = Math.max(0, (token.startLine ?? 1) - 1);
    const rawCodes = match[2].trim().split(/[\s,]+/).filter(Boolean);
    const valid = rawCodes.filter(code => Q_LINT_CODES.includes(code as QLintCode)) as QLintCode[];
    if (rawCodes.length === 0 || valid.length !== rawCodes.length) {
      diagnostics.push(Diagnostic.create(
        tokenRange(token),
        'Lint suppression contains an unknown code or malformed code list.',
        DiagnosticSeverity.Information,
        'q.invalid-suppression',
        'vscode-kdb'
      ));
    }
    if (match[1] === 'disable-next-line') {
      const set = next.get(line + 1) ?? new Set<QLintCode>();
      valid.forEach(code => set.add(code));
      next.set(line + 1, set);
    } else if (match[1] === 'disable') {
      valid.forEach(code => {
        if (!open.has(code)) {
          open.set(code, line + 1);
        }
      });
    } else {
      valid.forEach(code => {
        const start = open.get(code);
        if (start !== undefined) {
          const values = disabled.get(code) ?? [];
          values.push({ start, end: Math.max(start, line - 1) });
          disabled.set(code, values);
          open.delete(code);
        }
      });
    }
  }
  for (const [code, start] of open) {
    const values = disabled.get(code) ?? [];
    values.push({ start, end: Number.MAX_SAFE_INTEGER });
    disabled.set(code, values);
  }
  return {
    diagnostics,
    suppressed: (code, line) => next.get(line)?.has(code) === true ||
      disabled.get(code)?.some(range => range.start <= line && range.end >= line) === true,
  };
}

function lintDiagnostic(
  range: Range,
  code: QLintCode,
  message: string,
  severity: DiagnosticSeverity,
): Diagnostic {
  return Diagnostic.create(range, message, severity, code, 'vscode-kdb');
}

function issueCode(kind: QSource['issues'][number]['kind']): string {
  switch (kind) {
    case 'invalid-escape': return 'q.invalid-escape';
    case 'unterminated-string': return 'q.unterminated-string';
    case 'unterminated-block-comment': return 'q.unterminated-block-comment';
    case 'unmatched-delimiter': return 'q.unmatched-delimiter';
    case 'invalid-character': return 'q.invalid-character';
  }
}

function severityValue(value: QLintSeverity): DiagnosticSeverity {
  switch (value) {
    case 'error': return DiagnosticSeverity.Error;
    case 'warning': return DiagnosticSeverity.Warning;
    case 'information': return DiagnosticSeverity.Information;
    case 'hint':
    case 'off': return DiagnosticSeverity.Hint;
  }
}

function capDiagnostics(values: readonly Diagnostic[], maximum: number): readonly Diagnostic[] {
  if (values.length <= maximum) {
    return values;
  }
  const retained = values.slice(0, maximum);
  const last = retained[retained.length - 1];
  return [...retained, Diagnostic.create(
    last?.range ?? Range.create(0, 0, 0, 1),
    `${values.length - maximum} additional q diagnostics were omitted by the configured cap.`,
    DiagnosticSeverity.Information,
    'q.too-many-diagnostics',
    'vscode-kdb'
  )];
}

function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return left.range.start.line - right.range.start.line ||
    left.range.start.character - right.range.start.character ||
    String(left.code ?? '').localeCompare(String(right.code ?? ''));
}
