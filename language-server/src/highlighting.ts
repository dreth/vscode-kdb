import type { TokenType } from 'chevrotain';

import type { QCatalogCategory } from './catalog';
import { Control, Identifier, Keyword, LSql, Module, Reserved, RSql, System } from './parser/keywords';
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
} from './parser/literals';
import {
  Colon,
  Comparator,
  Cond,
  CutDrop,
  Dict,
  DoubleColon,
  Iterator,
  LBracket,
  LCurly,
  LParen,
  Operator,
  RBracket,
  RCurly,
  RParen,
  SemiColon,
} from './parser/tokens';

export interface QTextMateTokenRole {
  readonly token: TokenType;
  readonly scope: string;
}

export interface QTextMateCatalogRole {
  readonly category: QCatalogCategory;
  readonly scope: string;
}

export const Q_TEXTMATE_SCOPES = Object.freeze({
  blockComment: 'comment.block.q',
  blockCommentBegin: 'punctuation.definition.comment.begin.q',
  blockCommentEnd: 'punctuation.definition.comment.end.q',
  documentationComment: 'comment.line.documentation.q',
  lineComment: 'comment.line.slash.q',
  preprocessor: 'meta.preprocessor.q',
  string: 'string.quoted.double.q',
  stringBegin: 'punctuation.definition.string.begin.q',
  stringEnd: 'punctuation.definition.string.end.q',
  stringEscape: 'constant.character.escape.q',
  notebookMagic: 'meta.preprocessor.notebook.magic.q',
});

export const Q_TEXTMATE_LITERAL_ROLES: readonly QTextMateTokenRole[] = Object.freeze([
  { token: SymbolLiteral, scope: 'constant.other.symbol.q' },
  { token: GuidLiteral, scope: 'constant.other.guid.q' },
  { token: DateTimeLiteral, scope: 'constant.numeric.datetime.q' },
  { token: TimeStampLiteral, scope: 'constant.numeric.timestamp.q' },
  { token: DateLiteral, scope: 'constant.numeric.date.q' },
  { token: MonthLiteral, scope: 'constant.numeric.month.q' },
  { token: TimeLiteral, scope: 'constant.numeric.time.q' },
  { token: InfinityLiteral, scope: 'constant.language.null.q' },
  { token: BinaryLiteral, scope: 'constant.language.boolean.q' },
  { token: ByteLiteral, scope: 'constant.numeric.hex.q' },
  { token: NumberLiteral, scope: 'constant.numeric.q' },
]);

export const Q_TEXTMATE_CATALOG_ROLES: readonly QTextMateCatalogRole[] = Object.freeze([
  { category: 'builtin', scope: 'support.function.builtin.q' },
  { category: 'system-namespace', scope: 'support.function.system.q' },
]);

export const Q_TEXTMATE_WORD_ROLES: readonly QTextMateTokenRole[] = Object.freeze([
  { token: Control, scope: 'keyword.control.q' },
  { token: LSql, scope: 'keyword.other.query.q' },
  { token: RSql, scope: 'keyword.other.query.q' },
  { token: Module, scope: 'keyword.control.module.q' },
  { token: Reserved, scope: 'support.function.system.q' },
  { token: Keyword, scope: 'support.function.q' },
  { token: System, scope: 'support.function.q' },
  { token: Identifier, scope: 'variable.other.q' },
]);

export const Q_TEXTMATE_PUNCTUATION_ROLES: readonly QTextMateTokenRole[] = Object.freeze([
  { token: Iterator, scope: 'keyword.operator.iterator.q' },
  { token: Comparator, scope: 'keyword.operator.comparison.q' },
  { token: CutDrop, scope: 'keyword.operator.q' },
  { token: Dict, scope: 'keyword.operator.q' },
  { token: Operator, scope: 'keyword.operator.q' },
  { token: Cond, scope: 'keyword.operator.conditional.q' },
  { token: DoubleColon, scope: 'keyword.operator.assignment.q' },
  { token: Colon, scope: 'keyword.operator.assignment.q' },
  { token: SemiColon, scope: 'punctuation.separator.semicolon.q' },
  { token: LParen, scope: 'punctuation.section.parens.begin.q' },
  { token: RParen, scope: 'punctuation.section.parens.end.q' },
  { token: LBracket, scope: 'punctuation.section.brackets.begin.q' },
  { token: RBracket, scope: 'punctuation.section.brackets.end.q' },
  { token: LCurly, scope: 'punctuation.section.block.begin.q' },
  { token: RCurly, scope: 'punctuation.section.block.end.q' },
]);

export const Q_SEMANTIC_TOKEN_TYPES = Object.freeze([
  'variable', 'function', 'parameter', 'property', 'keyword',
] as const);

export const Q_SEMANTIC_TOKEN_MODIFIERS = Object.freeze([
  'declaration', 'readonly', 'defaultLibrary', 'local', 'global',
] as const);

export type QSemanticTokenType = typeof Q_SEMANTIC_TOKEN_TYPES[number];
export type QSemanticTokenModifier = typeof Q_SEMANTIC_TOKEN_MODIFIERS[number];

export interface QSemanticRole {
  readonly type: QSemanticTokenType;
  readonly modifiers: readonly QSemanticTokenModifier[];
}

const DEFAULT_LIBRARY_READONLY = Object.freeze(['readonly', 'defaultLibrary'] as const);
const DEFAULT_LIBRARY = Object.freeze(['defaultLibrary'] as const);

export function qCatalogSemanticRole(
  category: QCatalogCategory,
  spelling: string,
  qsql: boolean,
): QSemanticRole | undefined {
  switch (category) {
    case 'builtin':
      return { type: 'function', modifiers: DEFAULT_LIBRARY_READONLY };
    case 'control':
      return { type: 'keyword', modifiers: DEFAULT_LIBRARY_READONLY };
    case 'qsql':
      if (qsql || spelling === 'by') {
        return { type: 'keyword', modifiers: DEFAULT_LIBRARY_READONLY };
      }
      return { type: 'function', modifiers: DEFAULT_LIBRARY_READONLY };
    case 'system-namespace':
      return { type: 'function', modifiers: DEFAULT_LIBRARY };
    case 'system-command':
      return undefined;
  }
}
