import {
  CallHierarchyIncomingCall,
  CallHierarchyItem,
  CallHierarchyOutgoingCall,
  CompletionItem,
  CompletionItemKind,
  DocumentHighlight,
  DocumentHighlightKind,
  DocumentSymbol,
  FoldingRange,
  FoldingRangeKind,
  Hover,
  Location,
  MarkupKind,
  Position,
  Range,
  SelectionRange,
  SemanticTokens,
  SignatureHelp,
  SymbolInformation,
  SymbolKind,
  TextEdit,
  WorkspaceEdit,
} from 'vscode-languageserver/node';

import { Q_CATALOG, qCatalogEntry } from './catalog';
import { LBracket, LCurly, LParen, RBracket, RCurly, RParen } from './parser/tokens';
import { CommentBegin, CommentEnd } from './parser/ranges';
import { QBinding, QSource, tokenRange } from './q-source';

export const Q_SEMANTIC_TOKEN_TYPES = Object.freeze([
  'variable', 'function', 'parameter', 'keyword',
]);
export const Q_SEMANTIC_TOKEN_MODIFIERS = Object.freeze(['declaration', 'readonly']);

export function qCompletions(
  source: QSource,
  position: Position,
  workspaceSources: readonly QSource[] = [],
): readonly CompletionItem[] {
  if (source.protectedAt(position)) {
    return [];
  }
  const offset = source.offsetAt(position);
  const before = source.text.slice(source.lineStarts[position.line] ?? 0, offset);
  const prefix = before.match(/[.A-Za-z][.A-Za-z0-9_]*$|\\[A-Za-z0-9_\\]*$/)?.[0] ?? '';
  const editRange = Range.create(position.line, position.character - prefix.length, position.line, position.character);
  const items = new Map<string, CompletionItem>();
  for (const entry of Q_CATALOG) {
    if (prefix && !entry.spelling.toLowerCase().startsWith(prefix.toLowerCase())) {
      continue;
    }
    items.set(entry.spelling, {
      label: entry.spelling,
      kind: completionKind(entry.category),
      detail: entry.signature ?? `q ${entry.category}`,
      documentation: {
        kind: MarkupKind.Markdown,
        value: `${entry.summary}\n\n[Official q documentation](${entry.url})`,
      },
      textEdit: TextEdit.replace(editRange, entry.spelling),
      sortText: `1-${entry.spelling}`,
    });
  }
  for (const binding of visibleBindings(source, offset)) {
    const label = binding.name;
    if (prefix && !label.toLowerCase().startsWith(prefix.toLowerCase())) {
      continue;
    }
    items.set(label, {
      label,
      kind: binding.callable ? CompletionItemKind.Function : CompletionItemKind.Variable,
      detail: binding.local ? 'q lexical binding' : 'q source binding',
      textEdit: TextEdit.replace(editRange, label),
      sortText: `0-${label}`,
    });
  }
  for (const workspaceSource of workspaceSources) {
    if (workspaceSource.uri === source.uri) continue;
    for (const binding of workspaceSource.bindings) {
      if (!binding.declaration || binding.local || binding.qsql || items.has(binding.name)) continue;
      const label = binding.name;
      if (prefix && !label.toLowerCase().startsWith(prefix.toLowerCase())) continue;
      items.set(label, {
        label,
        kind: binding.callable ? CompletionItemKind.Function : CompletionItemKind.Variable,
        detail: 'q workspace binding',
        textEdit: TextEdit.replace(editRange, label),
        sortText: `2-${label}`,
      });
    }
  }
  return [...items.values()];
}

export function qRelatedSources(
  source: QSource,
  workspaceSources: readonly QSource[],
): readonly QSource[] {
  const values: QSource[] = [source];
  for (const candidate of workspaceSources) {
    if (candidate.uri !== source.uri) values.push(candidate);
  }
  for (const imported of source.imports) {
    const candidate = workspaceSources.find(value => moduleKey(value.uri) === moduleKey(imported.module));
    if (candidate) values.push(QSource.createAliased(candidate, imported.alias));
  }
  return values;
}

export function qHover(
  source: QSource,
  position: Position,
  sources: readonly QSource[] = [source],
): Hover | null {
  if (source.protectedAt(position)) {
    return null;
  }
  const token = source.tokenAt(position);
  if (!token) {
    return null;
  }
  const catalog = qCatalogEntry(token.image);
  if (catalog) {
    const signature = catalog.signature ? `\`\`\`q\n${catalog.signature}\n\`\`\`\n\n` : '';
    return {
      range: tokenRange(token),
      contents: {
        kind: MarkupKind.Markdown,
        value: `${signature}${catalog.summary}\n\n[Official q documentation](${catalog.url})`,
      },
    };
  }
  const binding = bindingAt(source, position);
  if (!binding) {
    return null;
  }
  const declarationSources = binding.local ? [source] : sources;
  const declarations = declarationSources.flatMap(candidate => candidate.bindings.filter(value =>
    value.declaration && !value.qsql && sameBinding(binding, value)));
  if (declarations.length !== 1) return null;
  const declaration = declarations[0];
  return {
    range: binding.range,
    contents: {
      kind: MarkupKind.Markdown,
      value: `\`\`\`q\n${binding.name}${declaration.callable ? '[...]' : ''}\n\`\`\`\n\n${binding.local ? 'Lexically resolved q binding.' : 'Statically resolved q source binding.'}`,
    },
  };
}

export function qSignatureHelp(source: QSource, position: Position): SignatureHelp | null {
  if (source.protectedAt(position)) {
    return null;
  }
  const offset = source.offsetAt(position);
  const before = source.text.slice(0, offset);
  let depth = 0;
  let bracket = -1;
  for (let index = before.length - 1; index >= 0; index--) {
    const character = before[index];
    if (character === ']') depth++;
    if (character === '[') {
      if (depth === 0) {
        bracket = index;
        break;
      }
      depth--;
    }
  }
  if (bracket < 0) {
    return null;
  }
  const name = before.slice(0, bracket).match(/[.A-Za-z][.A-Za-z0-9_]*\s*$/)?.[0].trim();
  if (!name) {
    return null;
  }
  const catalog = qCatalogEntry(name);
  const declaration = source.bindings.find(value => value.name === name && value.declaration && value.callable);
  if ((!catalog?.signature) && !declaration) {
    return null;
  }
  const argumentText = before.slice(bracket + 1);
  const activeParameter = topLevelSemicolons(argumentText);
  const label = catalog?.signature ?? `${name}[...]`;
  return {
    activeSignature: 0,
    activeParameter,
    signatures: [{
      label,
      documentation: catalog
        ? { kind: MarkupKind.Markdown, value: `${catalog.summary}\n\n[Official q documentation](${catalog.url})` }
        : 'Statically resolved q lambda.',
      activeParameter,
    }],
  };
}

export function qDocumentSymbols(source: QSource): readonly DocumentSymbol[] {
  return source.bindings
    .filter(value => value.declaration && !value.local)
    .map(value => {
      const symbol = DocumentSymbol.create(
        value.name,
        value.callable ? 'q function' : 'q global',
        value.callable ? SymbolKind.Function : SymbolKind.Variable,
        value.bodyScopeOffset === undefined ? value.range : scopeRange(source, value.bodyScopeOffset) ?? value.range,
        value.range
      );
      if (value.bodyScopeOffset !== undefined) {
        symbol.children = source.bindings
          .filter(child => child.declaration && child.local && child.scopeOffset === value.bodyScopeOffset)
          .map(child => DocumentSymbol.create(
            child.name,
            child.parameter ? 'q parameter' : child.callable ? 'q local function' : 'q local',
            child.callable ? SymbolKind.Function : child.parameter ? SymbolKind.Variable : SymbolKind.Variable,
            child.range,
            child.range
          ));
      }
      return symbol;
    });
}

export function qWorkspaceSymbols(sources: readonly QSource[], query: string): readonly SymbolInformation[] {
  const needle = query.toLowerCase();
  return sources.flatMap(source => source.bindings
    .filter(value => value.declaration && !value.local && (!needle || value.name.toLowerCase().includes(needle)))
    .map(value => SymbolInformation.create(
      value.name,
      value.callable ? SymbolKind.Function : SymbolKind.Variable,
      value.range,
      source.uri
    )));
}

export function qDefinition(source: QSource, position: Position, sources: readonly QSource[]): readonly Location[] {
  const binding = bindingAt(source, position);
  if (!binding) {
    return [];
  }
  const locations = bindingLocations(source, binding, sources, true);
  return locations.length === 1 ? locations : [];
}

export function qReferences(
  source: QSource,
  position: Position,
  sources: readonly QSource[],
  includeDeclaration = true,
): readonly Location[] {
  const binding = bindingAt(source, position);
  if (!binding) {
    return [];
  }
  if (bindingLocations(source, binding, sources, true).length !== 1) return [];
  return bindingLocations(source, binding, sources, false)
    .filter(location => includeDeclaration || !sources.some(candidate => candidate.uri === location.uri &&
      candidate.bindings.some(value => value.declaration && sameBinding(binding, value) &&
        rangesEqual(value.range, location.range))));
}

export function qHighlights(source: QSource, position: Position): readonly DocumentHighlight[] {
  const binding = bindingAt(source, position);
  if (!binding) {
    return [];
  }
  return resolvedBindings(source, binding).map(value => DocumentHighlight.create(
    value.range,
    value.declaration ? DocumentHighlightKind.Write : DocumentHighlightKind.Read
  ));
}

export function qPrepareRename(source: QSource, position: Position): Range | null {
  const binding = bindingAt(source, position);
  return binding && !binding.qsql ? binding.range : null;
}

export function qRename(
  source: QSource,
  position: Position,
  newName: string,
  sources: readonly QSource[],
): WorkspaceEdit | null {
  const binding = bindingAt(source, position);
  if (!binding || binding.qsql || !validRename(binding.name, newName)) {
    return null;
  }
  const declarations = sources.flatMap(target => target.bindings.filter(candidate =>
    candidate.declaration && !candidate.qsql && sameBinding(binding, candidate)));
  if (declarations.length !== 1) return null;
  const collision = sources.some(target => target.bindings.some(candidate =>
    candidate.declaration && !candidate.qsql && candidate.name === newName &&
    (binding.local ? candidate.scopeOffset === binding.scopeOffset : !candidate.local) &&
    !sameBinding(binding, candidate)));
  if (collision) return null;
  const changes: Record<string, TextEdit[]> = {};
  for (const targetSource of sources) {
    const candidates = binding.local && targetSource.uri !== source.uri
      ? []
      : targetSource.bindings.filter(value => !value.qsql && sameBinding(binding, value));
    if (candidates.length > 0) {
      changes[targetSource.uri] = candidates.map(value => TextEdit.replace(
        value.range,
        targetSource.alias && newName.startsWith(`${targetSource.alias}.`)
          ? newName.slice(targetSource.alias.length + 1)
          : newName
      ));
    }
  }
  return { changes };
}

export function qSemanticTokens(source: QSource): SemanticTokens {
  const data: number[] = [];
  let previousLine = 0;
  let previousCharacter = 0;
  const entries = [
    ...source.bindings.filter(binding => !binding.qsql).map(binding => ({
      range: binding.range,
      type: binding.parameter ? 2 : binding.callable ? 1 : 0,
      modifiers: binding.declaration ? 1 : 0,
    })),
    ...source.tokens.filter(token => qCatalogEntry(token.image) !== undefined).map(token => ({
      range: tokenRange(token),
      type: 3,
      modifiers: 2,
    })),
  ].sort((left, right) => left.range.start.line - right.range.start.line ||
    left.range.start.character - right.range.start.character);
  for (const entry of entries) {
    const line = entry.range.start.line;
    const character = entry.range.start.character;
    const deltaLine = line - previousLine;
    data.push(
      deltaLine,
      deltaLine === 0 ? character - previousCharacter : character,
      Math.max(1, entry.range.end.character - character),
      entry.type,
      entry.modifiers
    );
    previousLine = line;
    previousCharacter = character;
  }
  return { data };
}

export function qFoldingRanges(source: QSource): readonly FoldingRange[] {
  const stack: Array<{ tokenType: unknown; line: number }> = [];
  const ranges: FoldingRange[] = [];
  for (const token of source.tokens) {
    const line = Math.max(0, (token.startLine ?? 1) - 1);
    if (token.tokenType === LParen || token.tokenType === LBracket || token.tokenType === LCurly) {
      stack.push({ tokenType: token.tokenType, line });
    } else if (token.tokenType === RParen || token.tokenType === RBracket || token.tokenType === RCurly) {
      const expected = token.tokenType === RParen ? LParen : token.tokenType === RBracket ? LBracket : LCurly;
      const opener = stack.pop();
      if (opener?.tokenType === expected && line > opener.line) {
        ranges.push({ startLine: opener.line, endLine: line - 1 });
      }
    }
  }
  let commentLine: number | undefined;
  for (const token of source.tokens) {
    const line = Math.max(0, (token.startLine ?? 1) - 1);
    if (token.tokenType === CommentBegin) {
      commentLine = line;
    } else if (token.tokenType === CommentEnd && commentLine !== undefined && line > commentLine) {
      ranges.push({ startLine: commentLine, endLine: line, kind: FoldingRangeKind.Comment });
      commentLine = undefined;
    }
  }
  return ranges.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
}

export function qSelectionRanges(source: QSource, positions: readonly Position[]): readonly SelectionRange[] {
  const documentRange = Range.create(source.positionAt(0), source.positionAt(source.text.length));
  return positions.map(position => {
    const token = source.tokenAt(position);
    if (!token) {
      return SelectionRange.create(documentRange);
    }
    const tokenSelection = SelectionRange.create(tokenRange(token), SelectionRange.create(documentRange));
    if (!token.scope) {
      return tokenSelection;
    }
    const opener = token.scope;
    const closer = matchingCloser(source, opener);
    if (!closer) {
      return tokenSelection;
    }
    tokenSelection.parent = SelectionRange.create(
      Range.create(tokenRange(opener).start, tokenRange(closer).end),
      SelectionRange.create(documentRange)
    );
    return tokenSelection;
  });
}

export function qPrepareCallHierarchy(source: QSource, position: Position): readonly CallHierarchyItem[] {
  const binding = bindingAt(source, position);
  if (!binding || !binding.declaration || !binding.callable || binding.qsql) return [];
  return [callHierarchyItem(source, binding)];
}

export function qIncomingCalls(
  item: CallHierarchyItem,
  sources: readonly QSource[],
): readonly CallHierarchyIncomingCall[] {
  const targetSource = sources.find(source => source.uri === item.uri);
  const target = targetSource?.bindings.find(binding => binding.declaration && binding.callable &&
    binding.name === item.name && rangesEqual(binding.range, item.selectionRange));
  if (!target || !targetSource) return [];
  const grouped = new Map<string, CallHierarchyIncomingCall>();
  const candidates = target.local ? [targetSource] : sources;
  for (const source of candidates) {
    for (const reference of source.bindings) {
      if (reference.declaration || reference.qsql || !sameBinding(target, reference) ||
        !bindingIsBracketCall(source, reference)) continue;
      const caller = callableContainingOffset(source, reference.offset);
      if (!caller) continue;
      const key = `${source.uri}\u0000${caller.offset}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.fromRanges.push(reference.range);
      } else {
        grouped.set(key, { from: callHierarchyItem(source, caller), fromRanges: [reference.range] });
      }
    }
  }
  return [...grouped.values()];
}

export function qOutgoingCalls(
  item: CallHierarchyItem,
  sources: readonly QSource[],
): readonly CallHierarchyOutgoingCall[] {
  const source = sources.find(candidate => candidate.uri === item.uri);
  const caller = source?.bindings.find(binding => binding.declaration && binding.callable &&
    binding.name === item.name && rangesEqual(binding.range, item.selectionRange));
  if (!source || !caller || caller.bodyScopeOffset === undefined) return [];
  const grouped = new Map<string, CallHierarchyOutgoingCall>();
  for (const reference of source.bindings) {
    if (reference.declaration || reference.qsql || callableContainingOffset(source, reference.offset) !== caller ||
      !bindingIsBracketCall(source, reference)) continue;
    const targetSources = reference.local ? [source] : sources;
    const targets = targetSources.flatMap(candidate => candidate.bindings.map(binding => ({ source: candidate, binding })))
      .filter(value => value.binding.declaration && value.binding.callable &&
        sameBinding(reference, value.binding));
    if (targets.length !== 1) continue;
    const target = targets[0];
    const key = `${target.source.uri}\u0000${target.binding.offset}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.fromRanges.push(reference.range);
    } else {
      grouped.set(key, {
        to: callHierarchyItem(target.source, target.binding),
        fromRanges: [reference.range],
      });
    }
  }
  return [...grouped.values()];
}

export function bindingAt(source: QSource, position: Position): QBinding | undefined {
  const offset = source.offsetAt(position);
  return source.bindings.find(value => !value.qsql && value.offset <= offset && value.endOffset > offset);
}

function visibleBindings(source: QSource, offset: number): readonly QBinding[] {
  const cursor = source.bindings.find(value => value.offset <= offset && value.endOffset > offset);
  const containing = source.enclosingCurly(offset);
  const scope = cursor?.scopeOffset ?? containing?.startOffset;
  const seen = new Set<string>();
  return source.bindings.filter(value => {
    if (!value.declaration || value.qsql || value.offset > offset) {
      return false;
    }
    if (value.local && value.scopeOffset !== scope) {
      return false;
    }
    if (seen.has(value.name)) {
      return false;
    }
    seen.add(value.name);
    return true;
  });
}

function resolvedBindings(source: QSource, binding: QBinding): readonly QBinding[] {
  return source.bindings.filter(value => sameBinding(binding, value));
}

function sameBinding(left: QBinding, right: QBinding): boolean {
  if (left.name !== right.name) {
    return false;
  }
  return left.local || right.local
    ? left.scopeOffset === right.scopeOffset
    : !left.local && !right.local;
}

function bindingLocations(
  source: QSource,
  binding: QBinding,
  sources: readonly QSource[],
  declarationsOnly: boolean,
): Location[] {
  const targets = binding.local ? [source] : sources;
  return targets.flatMap(value => value.bindings
    .filter(candidate => sameBinding(binding, candidate) && (!declarationsOnly || candidate.declaration))
    .map(candidate => Location.create(value.uri, candidate.range)));
}

function validRename(oldName: string, newName: string): boolean {
  const valid = /^\.?[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*$/.test(newName);
  return valid && qCatalogEntry(newName) === undefined && oldName.startsWith('.') === newName.startsWith('.');
}

function rangesEqual(left: Range, right: Range): boolean {
  return left.start.line === right.start.line && left.start.character === right.start.character &&
    left.end.line === right.end.line && left.end.character === right.end.character;
}

function matchingCloser(source: QSource, opener: typeof source.tokens[number]) {
  const open = opener.tokenType;
  const close = open === LParen ? RParen : open === LBracket ? RBracket : open === LCurly ? RCurly : undefined;
  if (!close) {
    return undefined;
  }
  const closer = source.matchingDelimiter(opener);
  return closer?.tokenType === close ? closer : undefined;
}

function bindingIsBracketCall(source: QSource, binding: QBinding): boolean {
  return source.tokens.some(token => token.tokenType === LBracket && token.startOffset === binding.endOffset);
}

function callHierarchyItem(source: QSource, binding: QBinding): CallHierarchyItem {
  return {
    name: binding.name,
    kind: SymbolKind.Function,
    uri: source.uri,
    range: binding.bodyScopeOffset === undefined
      ? binding.range
      : scopeRange(source, binding.bodyScopeOffset) ?? binding.range,
    selectionRange: binding.range,
  };
}

function callableContainingOffset(source: QSource, offset: number): QBinding | undefined {
  return source.bindings
    .filter(binding => binding.declaration && binding.callable && binding.bodyScopeOffset !== undefined)
    .map(binding => ({ binding, offsets: scopeOffsets(source, binding.bodyScopeOffset!) }))
    .filter(value => value.offsets && value.offsets.start < offset && value.offsets.end >= offset)
    .sort((left, right) => (left.offsets!.end - left.offsets!.start) -
      (right.offsets!.end - right.offsets!.start))[0]?.binding;
}

function scopeOffsets(
  source: QSource,
  scopeOffset: number,
): { start: number; end: number } | undefined {
  const opener = source.tokenStartingAt(scopeOffset);
  if (opener?.tokenType !== LCurly) return undefined;
  const closer = opener ? matchingCloser(source, opener) : undefined;
  return opener && closer
    ? { start: opener.startOffset, end: closer.endOffset ?? closer.startOffset }
    : undefined;
}

function scopeRange(source: QSource, scopeOffset: number): Range | undefined {
  const opener = source.tokenStartingAt(scopeOffset);
  if (opener?.tokenType !== LCurly) return undefined;
  const closer = opener ? matchingCloser(source, opener) : undefined;
  return opener && closer ? Range.create(tokenRange(opener).start, tokenRange(closer).end) : undefined;
}

function topLevelSemicolons(value: string): number {
  let depth = 0;
  let count = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === '"' && value[index - 1] !== '\\') quoted = !quoted;
    if (quoted) continue;
    if (character === '[' || character === '(' || character === '{') depth++;
    if (character === ']' || character === ')' || character === '}') depth--;
    if (character === ';' && depth === 0) count++;
  }
  return count;
}

function completionKind(category: QCatalogCategoryLike): CompletionItemKind {
  switch (category) {
    case 'builtin': return CompletionItemKind.Function;
    case 'system-namespace': return CompletionItemKind.Module;
    case 'system-command': return CompletionItemKind.Keyword;
    case 'control':
    case 'qsql': return CompletionItemKind.Keyword;
  }
}

function moduleKey(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // An invalid URI escape simply cannot match a statically imported module.
  }
  const last = decoded.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? decoded;
  return last.replace(/\.q$/i, '');
}

type QCatalogCategoryLike = typeof Q_CATALOG[number]['category'];
