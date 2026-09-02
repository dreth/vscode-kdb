import { readFile, readdir, stat } from 'fs/promises';
import { join, relative, resolve, sep } from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
import {
  CancellationToken,
  CompletionItem,
  Connection,
  Diagnostic,
  DiagnosticSeverity,
  DidChangeConfigurationNotification,
  InitializeParams,
  InitializeResult,
  NotebookDocuments,
  Position,
  ProposedFeatures,
  Range,
  TextDocumentSyncKind,
  TextDocuments,
  WorkspaceFolder,
  createConnection,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { diagnoseQSource } from './q-diagnostics';
import { formatQDocument, formatQRange } from './formatter';
import {
  Q_SEMANTIC_TOKEN_MODIFIERS,
  Q_SEMANTIC_TOKEN_TYPES,
  qCompletions,
  qDefinition,
  qDocumentSymbols,
  qFoldingRanges,
  qHighlights,
  qHover,
  qIncomingCalls,
  qOutgoingCalls,
  qPrepareCallHierarchy,
  qPrepareRename,
  qReferences,
  qRelatedSources,
  qRename,
  qSelectionRanges,
  qSemanticTokens,
  qSignatureHelp,
  qWorkspaceSymbols,
} from './providers';
import { QSource } from './q-source';
import {
  Q_METADATA_INVALIDATED_NOTIFICATION,
  Q_METADATA_REFRESH_METHOD,
  Q_METADATA_REQUEST_METHOD,
  Q_METADATA_TTL_MS,
  RuntimeRootMetadata,
  RuntimeTableMetadata,
  parseRuntimeRoot,
  parseRuntimeTable,
  qSqlTableAt,
  runtimeCompletions,
  runtimeHover,
  sameRuntimeSnapshot,
} from './runtime-metadata';
import { QLanguageSettings, normalizeQLanguageSettings } from './settings';
import { workspaceDirectoryExcluded, workspacePathIncluded } from './workspace';

class QLanguageServer {
  private readonly documents = new TextDocuments(TextDocument);
  private readonly notebooks = new NotebookDocuments(this.documents);
  private readonly sources = new Map<string, QSource>();
  private readonly diskSources = new Map<string, { stamp: string; source: QSource }>();
  private readonly diagnosticTimers = new Map<string, NodeJS.Timeout>();
  private readonly diagnosticGenerations = new Map<string, number>();
  private readonly settings = new Map<string, Promise<QLanguageSettings>>();
  private workspaceFolders: readonly WorkspaceFolder[] = [];
  private indexedSources: readonly QSource[] | undefined;
  private supportsConfiguration = false;
  private supportsWorkspaceFolders = false;
  private runtimeRootCache: { expiresAt: number; value: RuntimeRootMetadata } | undefined;
  private readonly runtimeTableCache = new Map<string, { expiresAt: number; value: RuntimeTableMetadata }>();
  private readonly runtimeFailureKinds = new Set<string>();

  public constructor(private readonly connection: Connection) {
    this.connection.onInitialize(params => this.initialize(params));
    this.connection.onInitialized(() => this.initialized());
    this.connection.onShutdown(() => this.shutdown());
    this.connection.onDidChangeConfiguration(() => this.configurationChanged());
    this.connection.onDidChangeWatchedFiles(event => {
      for (const change of event.changes) this.diskSources.delete(change.uri);
      this.indexedSources = undefined;
    });

    this.documents.onDidOpen(event => this.documentChanged(event.document));
    this.documents.onDidChangeContent(event => this.documentChanged(event.document));
    this.documents.onDidClose(event => this.documentClosed(event.document.uri));

    this.connection.onCompletion(async (params, token) => {
      const source = await this.currentSource(params.textDocument.uri);
      if (!source || token.isCancellationRequested || await this.oversized(source)) return [];
      const workspace = await this.workspaceSources(token.isCancellationRequested);
      if (token.isCancellationRequested || !(await this.sourceIsCurrent(source))) return [];
      const offline = qCompletions(
        source,
        params.position,
        qRelatedSources(source, workspace)
      ) as CompletionItem[];
      const root = await this.runtimeRoot(source, token);
      const tableName = qSqlTableAt(source, params.position);
      const table = tableName && root?.tables.includes(tableName)
        ? await this.runtimeTable(source, tableName, root, token)
        : undefined;
      return mergeCompletions(offline, runtimeCompletions(source, params.position, root, table));
    });
    this.connection.onHover(async (params, token) => {
      const source = await this.currentSource(params.textDocument.uri);
      if (!source || token.isCancellationRequested || await this.oversized(source)) return null;
      return qHover(
        source,
        params.position,
        await this.relatedSources(source, token.isCancellationRequested)
      ) ??
        runtimeHover(source, params.position, await this.runtimeRoot(source, token));
    });
    this.connection.onSignatureHelp(async (params, token) => {
      const source = await this.currentSource(params.textDocument.uri);
      if (!source || token.isCancellationRequested || await this.oversized(source)) return null;
      return qSignatureHelp(source, params.position);
    });
    this.connection.onDocumentSymbol(async (params, token) => {
      const source = await this.currentSource(params.textDocument.uri);
      if (!source || token.isCancellationRequested || await this.oversized(source)) return [];
      return [...qDocumentSymbols(source)];
    });
    this.connection.onWorkspaceSymbol(async (params, token) => {
      const sources = await this.workspaceSources(token.isCancellationRequested);
      return token.isCancellationRequested ? [] : [...qWorkspaceSymbols(sources, params.query)];
    });
    this.connection.onDefinition(async (params, token) => {
      const source = await this.currentSource(params.textDocument.uri);
      if (!source || token.isCancellationRequested || await this.oversized(source)) return [];
      return [...qDefinition(source, params.position, await this.relatedSources(source, token.isCancellationRequested))];
    });
    this.connection.onReferences(async (params, token) => {
      const source = await this.currentSource(params.textDocument.uri);
      if (!source || token.isCancellationRequested || await this.oversized(source)) return [];
      return [...qReferences(
        source,
        params.position,
        await this.relatedSources(source, token.isCancellationRequested),
        params.context.includeDeclaration
      )];
    });
    this.connection.onDocumentHighlight(async (params, token) => {
      const source = await this.currentSource(params.textDocument.uri);
      if (!source || token.isCancellationRequested || await this.oversized(source)) return [];
      return [...qHighlights(source, params.position)];
    });
    this.connection.onPrepareRename(async (params, token) => {
      const source = await this.currentSource(params.textDocument.uri);
      if (!source || token.isCancellationRequested || await this.oversized(source)) return null;
      return qPrepareRename(
        source,
        params.position,
        await this.relatedSources(source, token.isCancellationRequested)
      );
    });
    this.connection.onRenameRequest(async (params, token) => {
      const source = await this.currentSource(params.textDocument.uri);
      if (!source || token.isCancellationRequested || await this.oversized(source)) return null;
      return qRename(source, params.position, params.newName,
        await this.relatedSources(source, token.isCancellationRequested));
    });
    this.connection.languages.semanticTokens.on(async (params, token) => {
      const source = await this.currentSource(params.textDocument.uri);
      if (!source || token.isCancellationRequested || await this.oversized(source)) return { data: [] };
      return qSemanticTokens(source);
    });
    this.connection.onFoldingRanges(async (params, token) => {
      const source = await this.currentSource(params.textDocument.uri);
      if (!source || token.isCancellationRequested || await this.oversized(source)) return [];
      return [...qFoldingRanges(source)];
    });
    this.connection.onSelectionRanges(async (params, token) => {
      const source = await this.currentSource(params.textDocument.uri);
      if (!source || token.isCancellationRequested || await this.oversized(source)) return [];
      return [...qSelectionRanges(source, params.positions)];
    });
    this.connection.onDocumentFormatting(async (params, token) => {
      const source = await this.currentSource(params.textDocument.uri);
      if (!source || token.isCancellationRequested || await this.oversized(source)) return [];
      const result = formatQDocument(source, params.options);
      if (result.skipped) this.logSkip('document formatting', result.skipped);
      return [...result.edits];
    });
    this.connection.onDocumentRangeFormatting(async (params, token) => {
      const source = await this.currentSource(params.textDocument.uri);
      if (!source || token.isCancellationRequested || await this.oversized(source)) return [];
      const result = formatQRange(source, params.options, params.range);
      if (result.skipped) this.logSkip('range formatting', result.skipped);
      return [...result.edits];
    });
    this.connection.languages.callHierarchy.onPrepare(async (params, token) => {
      const source = await this.currentSource(params.textDocument.uri);
      if (!source || token.isCancellationRequested || await this.oversized(source)) return [];
      return [...qPrepareCallHierarchy(source, params.position)];
    });
    this.connection.languages.callHierarchy.onIncomingCalls(async (params, token) =>
      token.isCancellationRequested
        ? []
        : [...qIncomingCalls(params.item, await this.workspaceSources(token.isCancellationRequested))]);
    this.connection.languages.callHierarchy.onOutgoingCalls(async (params, token) =>
      token.isCancellationRequested
        ? []
        : [...qOutgoingCalls(params.item, await this.workspaceSources(token.isCancellationRequested))]);
    this.connection.onRequest('vscode-kdb/qLanguageReady', () => true);
    this.connection.onRequest(Q_METADATA_REFRESH_METHOD, () => {
      this.clearRuntimeMetadata();
      return true;
    });
    this.connection.onNotification(Q_METADATA_INVALIDATED_NOTIFICATION, () =>
      this.clearRuntimeMetadata());
  }

  public listen(): void {
    this.documents.listen(this.connection);
    this.notebooks.listen(this.connection);
    this.connection.listen();
  }

  private initialize(params: InitializeParams): InitializeResult {
    this.supportsConfiguration = params.capabilities.workspace?.configuration === true;
    this.supportsWorkspaceFolders = params.capabilities.workspace?.workspaceFolders === true;
    this.workspaceFolders = params.workspaceFolders ?? [];
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        completionProvider: { triggerCharacters: ['.', '\\'] },
        hoverProvider: true,
        signatureHelpProvider: { triggerCharacters: ['[', ';'], retriggerCharacters: [';'] },
        documentSymbolProvider: true,
        workspaceSymbolProvider: true,
        definitionProvider: true,
        referencesProvider: true,
        documentHighlightProvider: true,
        renameProvider: { prepareProvider: true },
        semanticTokensProvider: {
          legend: { tokenTypes: [...Q_SEMANTIC_TOKEN_TYPES], tokenModifiers: [...Q_SEMANTIC_TOKEN_MODIFIERS] },
          full: true,
        },
        foldingRangeProvider: true,
        selectionRangeProvider: true,
        documentFormattingProvider: true,
        documentRangeFormattingProvider: true,
        callHierarchyProvider: true,
        notebookDocumentSync: {
          notebookSelector: [
            { notebook: { notebookType: 'jupyter-notebook' }, cells: [{ language: 'q' }] },
            { notebook: { notebookType: 'vscode-kdb-q-notebook' }, cells: [{ language: 'q' }] },
          ],
          save: false,
        },
        workspace: this.supportsWorkspaceFolders
          ? { workspaceFolders: { supported: true, changeNotifications: true } }
          : undefined,
      },
      serverInfo: { name: 'KX q Language Server', version: '0.2.29' },
    };
  }

  private initialized(): void {
    if (this.supportsConfiguration) {
      void this.connection.client.register(DidChangeConfigurationNotification.type, undefined);
    }
    if (this.supportsWorkspaceFolders) {
      this.connection.workspace.onDidChangeWorkspaceFolders(event => {
        const removed = new Set(event.removed.map(folder => folder.uri));
        this.workspaceFolders = [
          ...this.workspaceFolders.filter(folder => !removed.has(folder.uri)),
          ...event.added,
        ];
        this.indexedSources = undefined;
      });
    }
  }

  private shutdown(): void {
    for (const timer of this.diagnosticTimers.values()) clearTimeout(timer);
    this.diagnosticTimers.clear();
    for (const uri of this.sources.keys()) this.connection.sendDiagnostics({ uri, diagnostics: [] });
  }

  private configurationChanged(): void {
    this.settings.clear();
    this.indexedSources = undefined;
    this.clearRuntimeMetadata();
    for (const document of this.documents.all()) this.documentChanged(document);
  }

  private documentChanged(document: TextDocument): void {
    const cached = this.sources.get(document.uri);
    if (cached?.version !== document.version) this.sources.delete(document.uri);
    this.queueDiagnostics(document.uri, document.version);
  }

  private documentClosed(uri: string): void {
    this.sources.delete(uri);
    this.settings.delete(uri);
    this.clearDiagnosticTimer(uri);
    this.connection.sendDiagnostics({ uri, diagnostics: [] });
  }

  private async currentSource(uri: string): Promise<QSource | undefined> {
    const document = this.documents.get(uri);
    if (document) {
      const cached = this.sources.get(uri);
      if (cached?.version === document.version) return cached;
      const source = QSource.create(uri, document.version, document.getText());
      this.sources.set(uri, source);
      return source;
    }
    if (!uri.startsWith('file:')) return undefined;
    return this.diskSource(uri);
  }

  private async diskSource(uri: string): Promise<QSource | undefined> {
    try {
      const path = fileURLToPath(uri);
      const details = await stat(path);
      const stamp = `${details.mtimeMs}:${details.size}`;
      const cached = this.diskSources.get(uri);
      if (cached?.stamp === stamp) return cached.source;
      const text = await readFile(path, 'utf8');
      const source = QSource.create(uri, -1, text);
      this.diskSources.set(uri, { stamp, source });
      return source;
    } catch (error) {
      this.logFailure('workspace source read', error);
      return undefined;
    }
  }

  private queueDiagnostics(uri: string, version: number): void {
    const generation = (this.diagnosticGenerations.get(uri) ?? 0) + 1;
    this.diagnosticGenerations.set(uri, generation);
    this.clearDiagnosticTimer(uri);
    void this.settingsFor(uri).then(settings => {
      const timer = setTimeout(() => {
        this.diagnosticTimers.delete(uri);
        void this.currentSource(uri).then(source => {
          if (source?.version === version) return this.publishDiagnostics(source, generation, settings);
          return undefined;
        });
      }, settings.diagnostics.debounceMs);
      this.diagnosticTimers.set(uri, timer);
    }).catch(error => this.logFailure('diagnostic settings', error));
  }

  private async publishDiagnostics(
    source: QSource,
    generation: number,
    settings: QLanguageSettings,
  ): Promise<void> {
    const current = this.sources.get(source.uri);
    if (!settings.enabled) {
      this.connection.sendDiagnostics({ uri: source.uri, version: source.version, diagnostics: [] });
      return;
    }
    if (current?.version !== source.version ||
      this.diagnosticGenerations.get(source.uri) !== generation) return;
    if (source.byteLength > settings.maxFileSizeBytes) {
      this.connection.sendDiagnostics({
        uri: source.uri,
        version: source.version,
        diagnostics: [largeDocumentDiagnostic(source, settings.maxFileSizeBytes)],
      });
      return;
    }
    try {
      this.connection.sendDiagnostics({
        uri: source.uri,
        version: source.version,
        diagnostics: [...diagnoseQSource(source, settings)],
      });
    } catch (error) {
      this.logFailure('diagnostic analysis', error);
      this.connection.sendDiagnostics({ uri: source.uri, version: source.version, diagnostics: [] });
    }
  }

  private clearDiagnosticTimer(uri: string): void {
    const timer = this.diagnosticTimers.get(uri);
    if (timer) clearTimeout(timer);
    this.diagnosticTimers.delete(uri);
  }

  private settingsFor(uri: string): Promise<QLanguageSettings> {
    let cached = this.settings.get(uri);
    if (!cached) {
      cached = this.loadSettings(uri);
      this.settings.set(uri, cached);
    }
    return cached;
  }

  private async loadSettings(uri: string): Promise<QLanguageSettings> {
    const value = this.supportsConfiguration
      ? await this.connection.workspace.getConfiguration({ scopeUri: uri, section: 'vscode-kdb.languageServer' })
      : undefined;
    const result = normalizeQLanguageSettings(value);
    for (const warning of result.warnings) this.connection.console.warn(`[q-language] ${warning}`);
    return result.settings;
  }

  private async oversized(source: QSource): Promise<boolean> {
    const settings = await this.settingsFor(source.uri);
    return !settings.enabled || source.byteLength > settings.maxFileSizeBytes;
  }

  private async sourceIsCurrent(source: QSource): Promise<boolean> {
    const document = this.documents.get(source.uri);
    return !document || document.version === source.version;
  }

  private async relatedSources(source: QSource, canceled: boolean): Promise<readonly QSource[]> {
    if (canceled || (source.bindings.every(value => value.local) && source.imports.length === 0 &&
      source.loads.length === 0)) return [source];
    const workspace = await this.workspaceSources(canceled);
    return qRelatedSources(source, workspace);
  }

  private async runtimeRoot(
    source: QSource,
    token: CancellationToken,
  ): Promise<RuntimeRootMetadata | undefined> {
    const settings = await this.settingsFor(source.uri);
    if (!settings.connectedIntelligence || token.isCancellationRequested) return undefined;
    const now = Date.now();
    if (this.runtimeRootCache && this.runtimeRootCache.expiresAt > now) {
      return this.runtimeRootCache.value;
    }
    try {
      const response = parseRuntimeRoot(await this.connection.sendRequest<unknown>(
        Q_METADATA_REQUEST_METHOD,
        { version: 1, kind: 'root' },
        token
      ));
      if (!response || token.isCancellationRequested) {
        this.logRuntimeFailureOnce('root-invalid');
        return undefined;
      }
      if (this.runtimeRootCache &&
        !sameRuntimeSnapshot(this.runtimeRootCache.value.snapshot, response.snapshot)) {
        this.runtimeTableCache.clear();
      }
      this.runtimeRootCache = { expiresAt: now + Q_METADATA_TTL_MS, value: response };
      this.runtimeFailureKinds.delete('root-invalid');
      this.runtimeFailureKinds.delete('root-request');
      return response;
    } catch (error) {
      if (!token.isCancellationRequested) this.logRuntimeFailureOnce('root-request', error);
      return undefined;
    }
  }

  private async runtimeTable(
    source: QSource,
    table: string,
    root: RuntimeRootMetadata,
    token: CancellationToken,
  ): Promise<RuntimeTableMetadata | undefined> {
    if (!(await this.settingsFor(source.uri)).connectedIntelligence || token.isCancellationRequested) {
      return undefined;
    }
    const key = `${root.snapshot.connectionId}\u0000${root.snapshot.namespace}\u0000${root.snapshot.generation}\u0000${table}`;
    const now = Date.now();
    const cached = this.runtimeTableCache.get(key);
    if (cached && cached.expiresAt > now) return cached.value;
    try {
      const response = parseRuntimeTable(await this.connection.sendRequest<unknown>(
        Q_METADATA_REQUEST_METHOD,
        { version: 1, kind: 'table', table },
        token
      ));
      if (!response || token.isCancellationRequested ||
        !sameRuntimeSnapshot(root.snapshot, response.snapshot) || response.table !== table) {
        this.logRuntimeFailureOnce('table-invalid');
        return undefined;
      }
      this.runtimeTableCache.set(key, { expiresAt: now + Q_METADATA_TTL_MS, value: response });
      this.runtimeFailureKinds.delete('table-invalid');
      this.runtimeFailureKinds.delete('table-request');
      return response;
    } catch (error) {
      if (!token.isCancellationRequested) this.logRuntimeFailureOnce('table-request', error);
      return undefined;
    }
  }

  private clearRuntimeMetadata(): void {
    this.runtimeRootCache = undefined;
    this.runtimeTableCache.clear();
    this.runtimeFailureKinds.clear();
  }

  private logRuntimeFailureOnce(kind: string, error?: unknown): void {
    if (this.runtimeFailureKinds.has(kind)) return;
    this.runtimeFailureKinds.add(kind);
    const detail = error instanceof Error ? error.name : error === undefined ? 'invalid response' : typeof error;
    this.connection.console.warn(
      `[q-language] connected metadata unavailable (${safeLog(detail)}); using offline results.`
    );
  }

  private async workspaceSources(canceled: boolean): Promise<readonly QSource[]> {
    if (canceled) return [];
    if (this.indexedSources) return this.mergeOpenSources(this.indexedSources);
    const settings = await this.settingsFor(this.documents.all()[0]?.uri ?? '');
    const uris: string[] = [];
    for (const folder of this.workspaceFolders) {
      if (!folder.uri.startsWith('file:')) continue;
      const root = resolve(fileURLToPath(folder.uri));
      await collectQFiles(
        root,
        root,
        settings.workspace.include,
        settings.workspace.exclude,
        settings.workspace.maxFiles,
        uris
      );
      if (uris.length >= settings.workspace.maxFiles) break;
    }
    const values: QSource[] = [];
    for (const uri of uris.slice(0, settings.workspace.maxFiles)) {
      if (canceled) break;
      const value = await this.diskSource(uri);
      if (value && value.byteLength <= settings.maxFileSizeBytes) values.push(value);
    }
    this.indexedSources = Object.freeze(values);
    return this.mergeOpenSources(this.indexedSources);
  }

  private mergeOpenSources(indexed: readonly QSource[]): readonly QSource[] {
    const merged = new Map(indexed.map(source => [source.uri, source]));
    for (const source of this.sources.values()) merged.set(source.uri, source);
    return [...merged.values()];
  }

  private logSkip(operation: string, reason: string): void {
    this.connection.console.info(`[q-language] ${operation} skipped: ${safeLog(reason)}`);
  }

  private logFailure(operation: string, error: unknown): void {
    const detail = error instanceof Error ? error.name : typeof error;
    this.connection.console.error(`[q-language] ${operation} failed (${safeLog(detail)}).`);
  }
}

async function collectQFiles(
  root: string,
  directory: string,
  include: readonly string[],
  exclude: readonly string[],
  maximum: number,
  output: string[],
): Promise<void> {
  if (output.length >= maximum || !inside(root, directory)) return;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (output.length >= maximum) return;
    if (entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const name = relative(root, path).replace(/\\/g, '/');
      if (!workspaceDirectoryExcluded(name, exclude)) {
        await collectQFiles(root, path, include, exclude, maximum, output);
      }
    } else if (entry.isFile() && workspacePathIncluded(
      relative(root, path).replace(/\\/g, '/'),
      include,
      exclude
    )) {
      output.push(pathToFileURL(path).href);
    }
  }
}

function inside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

function largeDocumentDiagnostic(source: QSource, maximum: number): Diagnostic {
  return Diagnostic.create(
    Range.create(Position.create(0, 0), Position.create(0, Math.min(1, source.text.length))),
    `q language analysis is limited to ${maximum} bytes. Increase vscode-kdb.languageServer.maxFileSizeBytes to analyze this document.`,
    DiagnosticSeverity.Information,
    'q.file-too-large',
    'vscode-kdb'
  );
}

function mergeCompletions(
  offline: readonly CompletionItem[],
  runtime: readonly CompletionItem[],
): CompletionItem[] {
  const labels = new Set(offline.map(item => item.label.toString()));
  return [...offline, ...runtime.filter(item => !labels.has(item.label.toString()))];
}

function safeLog(value: string): string {
  return value.replace(/[\r\n\t]/g, ' ').replace(/[^A-Za-z0-9 ._:-]/g, '?').slice(0, 240);
}

const connection = createConnection(ProposedFeatures.all);
const server = new QLanguageServer(connection);
server.listen();
