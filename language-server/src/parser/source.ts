/*
 * Copyright (c) 1998-2026 KX Systems Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the
 * License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations under the License.
 */

import { IToken } from "chevrotain";
import { Diagnostic, Position, Range } from "vscode-languageserver";

import { Identifier, LSql, Module, RSql } from "./keywords";
import { QLexer } from "./lexer";
import { SymbolLiteral } from "./literals";
import { ExitCommentBegin } from "./ranges";
import {
  Colon,
  Command,
  Comparator,
  Cond,
  CutDrop,
  DoubleColon,
  EndOfLine,
  Iterator,
  LBracket,
  LCurly,
  LParen,
  Operator,
  RBracket,
  RCurly,
  RParen,
  SemiColon,
  WhiteSpace,
} from "./tokens";

export interface Token extends IToken {
  index?: number;
  namespace?: string;
  call?: Token;
  mode?: Token;
  feat?: Token;
  scope?: Token;
  rank?: number;
  error?: Diagnostic;
}

export class Source {
  declare readonly tokens: Token[];
  readonly errors: Token[] = [];
  readonly references: Token[] = [];
  readonly definitions: Token[] = [];
  readonly imports: { alias: string; module: string }[] = [];

  private constructor(
    readonly uri: string,
    text: string,
  ) {
    this.tokens = QLexer.tokenize(text).tokens as Token[];
  }

  private handleRCurly(scope: Token) {
    const tokens = this.definitions.filter((token) => token.scope === scope);
    const rank = scope.rank ?? 0;

    this.references.forEach((reference) => {
      if (reference.scope !== scope) {
        return;
      }
      if (reference.image.startsWith(".")) {
        reference.scope = undefined;
      } else {
        const name = Name(reference);
        const found = tokens.find((token) => name === Name(token));
        if (!found) {
          if (rank === 0 && (name === "x" || name === "y" || name === "z")) {
            return;
          }
          reference.scope = undefined;
        }
      }
    });
  }

  private parse() {
    const modes: Token[] = [];
    const feats: Token[] = [];
    const scope: Token[] = [];
    const stack: Token[] = [];

    let index = 0;
    let namespace = ".";
    let command: string;
    let token: Token | undefined;
    let current: Token;

    const Assign = (pattern = true) => {
      const assigned: Token[] = [];
      while ((token = stack.pop())) {
        if (Type(token) === Identifier) {
          this.definitions.push(token);
          assigned.push(token);
          if (!pattern) {
            stack.length = 0;
            break;
          }
        }
      }
      return assigned;
    };

    for (let i = 0; i < this.tokens.length; i++) {
      current = this.tokens[i];
      current.mode = Peek(modes);
      current.feat = Peek(feats);
      current.scope = Peek(scope);
      current.index = index;
      current.namespace = namespace;

      switch (Type(current)) {
        case LParen:
          modes.push(current);
          stack.push(current);
          break;
        case RParen:
          if (Type(current.feat) === LParen) {
            feats.pop();
          }
          modes.pop();
          stack.push(current);
          break;
        case LCurly:
          scope.push(current);
          modes.push(current);
          stack.length = 0;
          this.definitions.push(current);
          break;
        case RCurly:
          token = Peek(scope);
          if (token && Type(token) === LCurly) this.handleRCurly(token);
          scope.pop();
          modes.pop();
          stack.length = 0;
          break;
        case LBracket:
          token = Seek(this.tokens, i, -1);
          if (token && (Type(token) === LCurly || Type(token) === LParen)) {
            feats.push(token);
          }
          modes.push(current);
          stack.length = 0;
          break;
        case RBracket:
          if (Type(current.feat) === LCurly) {
            current.feat!.rank = Assign().length;
            feats.pop();
          } else if (Type(current.feat) !== LParen) {
            stack.length = 0;
          }
          modes.pop();
          break;
        case LSql:
          modes.push(current);
          stack.length = 0;
          break;
        case RSql:
          modes.pop();
          stack.length = 0;
          break;
        case Identifier:
          stack.push(current);
          this.references.push(current);
          break;
        case Colon:
          if (Type(current.feat) === LParen || Type(current.mode) === LSql) {
            stack.forEach((token) =>
              this.references.splice(this.references.indexOf(token), 1),
            );
            stack.length = 0;
          } else if (Type(current.feat) !== LCurly) {
            const assigned = Assign(Type(Peek(stack)) === RParen && Type(stack[0]) === LParen);
            const lambda = assignedLambda(this.tokens, i);
            if (assigned.length === 1 && lambda) {
              assigned[0].call = lambda;
            }
          }
          break;
        case SemiColon:
          if (
            Type(current.feat) !== LCurly &&
            Type(current.feat) !== LParen &&
            Type(current.mode) !== LParen
          ) {
            stack.length = 0;
          }
          if (!current.mode) {
            index++;
          }
          break;
        case EndOfLine:
          if (Type(this.tokens[i + 1]) !== WhiteSpace) {
            stack.length = 0;
            index++;
          }
          break;
        case Command:
          command = current.image.split(/^\\d[ \t]+/s)[1];
          if (command !== undefined) {
            namespace = command || ".";
          }
          stack.length = 0;
          break;
        case Iterator:
        case DoubleColon:
        case Comparator:
        case CutDrop:
        case Operator:
        case Cond:
          stack.length = 0;
          break;
        case ExitCommentBegin:
          return;
      }
    }
  }

  private process() {
    const definitions = new Map<string, Map<Token | undefined, Token[]>>();
    for (const definition of this.definitions) {
      if (Type(definition) !== Identifier) continue;
      const scopes = definitions.get(Name(definition)) ?? new Map<Token | undefined, Token[]>();
      const values = scopes.get(Scope(definition)) ?? [];
      values.push(definition);
      scopes.set(Scope(definition), values);
      definitions.set(Name(definition), scopes);
    }
    for (const reference of this.references) {
      const matches = definitions.get(Name(reference))?.get(Scope(reference)) ?? [];
      if (matches.length > 0 && matches.every(definition => definition.call !== undefined)) {
        reference.call = matches[0].call;
      } else {
        reference.call = undefined;
      }
    }
  }

  private resolveImports() {
    const sig = this.tokens.filter(
      (token) => Type(token) !== WhiteSpace && Type(token) !== EndOfLine,
    );
    for (let i = 0; i < sig.length; i++) {
      if (Type(sig[i]) !== Module || sig[i].image !== "use") {
        continue;
      }
      const symbol = sig[i + 1];
      const colon = sig[i - 1];
      const target = sig[i - 2];
      if (
        !symbol ||
        Type(symbol) !== SymbolLiteral ||
        !colon ||
        Type(colon) !== Colon ||
        !target
      ) {
        continue;
      }
      const module = symbol.image.slice(1);
      if (!module) {
        continue;
      }
      if (Type(target) === Identifier) {
        // `alias: use `module` — members are surfaced under the alias namespace
        this.imports.push({ alias: target.image, module });
      } else if (Type(target) === RParen || Type(target) === RBracket) {
        // `([a;b]): use `module` — destructured members are bound bare, so
        // import with no alias and let them resolve in the default namespace
        this.imports.push({ alias: "", module });
      }
    }
  }

  // Surfaces an imported module's top-level identifiers under the importing
  // alias (e.g. `f` -> `bar.f`), so the qualified references that access them
  // (`bar.f`) match natively through Name() across every language service.
  private applyAlias(alias: string) {
    const reprefix = (token: Token) => {
      if (
        token.scope === undefined &&
        token.namespace === "." &&
        Type(token) === Identifier &&
        !token.image.startsWith(".")
      ) {
        token.namespace = alias;
      }
    };
    this.definitions.forEach(reprefix);
    this.references.forEach(reprefix);
  }

  get symbols() {
    return this.definitions.filter((token) => token.scope === undefined);
  }

  tokenAt(position: Position) {
    return this.tokens.find((token) => {
      const { start, end } = RangeFrom(token);
      return (
        start.line <= position.line &&
        end.line >= position.line &&
        start.character <= position.character &&
        end.character >= position.character
      );
    });
  }

  static create(uri: string, text: string, alias?: string) {
    const source = new Source(uri, text);
    source.parse();
    source.process();
    source.resolveImports();
    if (alias) {
      source.applyAlias(alias);
    }
    return source;
  }
}

function Seek(tokens: Token[], index: number, step = 1): Token | undefined {
  index += step;
  while (
    tokens[index] &&
    (Type(tokens[index]) === WhiteSpace || Type(tokens[index]) === EndOfLine)
  ) {
    index += step;
  }
  return tokens[index];
}

export function Peek(tokens: Token[]): Token | undefined {
  return tokens[tokens.length - 1];
}

export function Scope(token?: Token) {
  return token?.scope;
}

export function Name(token?: Token) {
  return token
    ? token.namespace === "." || token.image.startsWith(".")
      ? token.image
      : token.namespace + "." + token.image
    : "";
}

export function Type(token?: Token) {
  return token?.tokenType;
}

export function Param(token?: Token) {
  return token !== undefined && (Type(token.feat) === LCurly || (
    Type(token.scope) === LCurly && token.scope?.rank === undefined &&
    (token.image === "x" || token.image === "y" || token.image === "z")
  ));
}

function assignedLambda(tokens: readonly Token[], colonIndex: number): Token | undefined {
  let cursor = nextNonWhitespace(tokens, colonIndex + 1);
  let parens = 0;
  while (cursor < tokens.length && Type(tokens[cursor]) === LParen) {
    parens++;
    cursor = nextNonWhitespace(tokens, cursor + 1);
  }
  const lambda = tokens[cursor];
  if (Type(lambda) !== LCurly) return undefined;

  let depth = 0;
  for (; cursor < tokens.length; cursor++) {
    if (Type(tokens[cursor]) === LCurly) depth++;
    if (Type(tokens[cursor]) === RCurly) {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) return undefined;

  cursor = nextNonWhitespace(tokens, cursor + 1);
  while (parens > 0 && Type(tokens[cursor]) === RParen) {
    parens--;
    cursor = nextNonWhitespace(tokens, cursor + 1);
  }
  if (parens !== 0) return undefined;

  const next = tokens[cursor];
  if (next && Type(next) !== SemiColon && Type(next) !== EndOfLine &&
    Type(next) !== RCurly && Type(next) !== RParen) {
    return undefined;
  }
  return lambda;
}

function nextNonWhitespace(tokens: readonly Token[], start: number): number {
  let cursor = start;
  while (cursor < tokens.length && Type(tokens[cursor]) === WhiteSpace) cursor++;
  return cursor;
}

export function Callable(token?: Token) {
  return !!token?.call;
}

export function Token(token: Partial<Token>) {
  return token as Token;
}

export function RangeFrom(token: Token): Range {
  // Chevrotain 13 uses -1 for unavailable locations. Never leak that sentinel
  // into LSP ranges; recovery/EOF tokens receive the smallest valid range.
  const startLine = location(token.startLine, 1) - 1;
  const startColumn = location(token.startColumn, 1) - 1;
  const endLine = location(token.endLine, startLine + 1) - 1;
  const endColumn = location(token.endColumn, startColumn + 1);
  return Range.create(
    startLine,
    startColumn,
    endLine,
    endColumn,
  );
}

function location(value: number | undefined, fallback: number): number {
  return value === undefined || value < 1 ? fallback : value;
}

// TODO
export function Namespace(token: Token) {
  const name = Name(token);
  return (name.startsWith(".") && name.split(".", 3)[1]) || "";
}

// TODO
export function Relative(token: Token, source: Token | undefined) {
  return source?.namespace
    ? Name(token).replace(new RegExp(`^\\${source.namespace}\\.`), "")
    : Name(token);
}
