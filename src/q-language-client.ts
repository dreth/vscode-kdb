import * as path from 'path';
import * as vscode from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';
import {
  Q_METADATA_REFRESH_METHOD,
  Q_METADATA_REQUEST_METHOD,
  QMetadataService,
} from './q-metadata-service';

export const Q_LANGUAGE_SERVER_ENABLED_SETTING = 'vscode-kdb.languageServer.enabled';

export class QLanguageClientController implements vscode.Disposable {
  private readonly subscriptions: vscode.Disposable[] = [];
  private client: LanguageClient | undefined;
  private startPromise: Promise<void> | undefined;
  private disposed = false;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
    private readonly metadata?: QMetadataService,
  ) {
    this.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument(document => this.documentOpened(document)),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (!event.affectsConfiguration('vscode-kdb.languageServer')) return;
        if (!this.enabled()) {
          void this.stop();
        } else {
          const document = vscode.workspace.textDocuments.find(isQDocument);
          if (document) void this.start(document.uri);
        }
      }),
      vscode.commands.registerCommand('vscode-kdb.refreshQLanguageMetadata', () =>
        this.refreshMetadata()),
      ...(this.metadata ? [this.metadata.onDidInvalidate(() => {
        void this.client?.sendNotification('vscode-kdb/qMetadataInvalidated');
      })] : [])
    );
    const open = vscode.workspace.textDocuments.find(isQDocument);
    if (open) void this.start(open.uri);
  }

  public isRunning(): boolean {
    return this.client !== undefined;
  }

  public async ready(): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.startPromise;
      return await this.client.sendRequest<boolean>('vscode-kdb/qLanguageReady');
    } catch (error) {
      this.logFailure('readiness request', error);
      return false;
    }
  }

  public async refreshMetadata(): Promise<void> {
    this.metadata?.refresh();
    const client = this.client;
    if (!client) {
      void vscode.window.showInformationMessage(
        'q language metadata cache was cleared. Open a q document to load it on demand.'
      );
      return;
    }
    try {
      await client.sendRequest(Q_METADATA_REFRESH_METHOD);
      void vscode.window.showInformationMessage(
        'q language metadata cache was cleared and will refresh on the next completion or hover request.'
      );
    } catch (error) {
      this.logFailure('metadata refresh', error);
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const subscription of this.subscriptions.splice(0)) subscription.dispose();
    void this.stop();
  }

  private documentOpened(document: vscode.TextDocument): void {
    if (isQDocument(document)) void this.start(document.uri);
  }

  private enabled(resource?: vscode.Uri): boolean {
    return vscode.workspace
      .getConfiguration('vscode-kdb.languageServer', resource)
      .get<unknown>('enabled', true) !== false;
  }

  private async start(resource?: vscode.Uri): Promise<void> {
    if (this.disposed || !this.enabled(resource) || this.client) return;
    if (this.startPromise) return this.startPromise;
    const serverModule = this.context.asAbsolutePath(path.join('out', 'q-language-server.js'));
    const serverOptions: ServerOptions = {
      run: { module: serverModule, transport: TransportKind.ipc },
      debug: { module: serverModule, transport: TransportKind.ipc },
    };
    const clientOptions: LanguageClientOptions = {
      documentSelector: [
        { language: 'q', scheme: 'file' },
        { language: 'q', scheme: 'untitled' },
        { language: 'q', scheme: 'vscode-notebook-cell' },
      ],
      synchronize: {
        configurationSection: 'vscode-kdb.languageServer',
        fileEvents: vscode.workspace.createFileSystemWatcher('**/*.q'),
      },
      outputChannel: this.output,
      revealOutputChannelOn: 4,
    };
    const client = new LanguageClient(
      'vscode-kdb-q-language-server',
      'KX q Language Server',
      serverOptions,
      clientOptions
    );
    if (this.metadata) {
      client.onRequest(Q_METADATA_REQUEST_METHOD, async (request, token) => {
        if (!this.connectedIntelligenceEnabled(resource)) return undefined;
        const abort = new AbortController();
        const cancellation = token.onCancellationRequested(() => abort.abort());
        try {
          return await this.metadata?.request(request, abort.signal);
        } catch (error) {
          this.logFailure('metadata request', error);
          return undefined;
        } finally {
          cancellation.dispose();
        }
      });
    }
    this.client = client;
    this.startPromise = client.start().catch(error => {
      if (this.client === client) this.client = undefined;
      this.logFailure('start', error);
    }).finally(() => {
      this.startPromise = undefined;
    });
    return this.startPromise;
  }

  private async stop(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    if (!client) return;
    try {
      await client.stop();
    } catch (error) {
      this.logFailure('stop', error);
    }
  }

  private connectedIntelligenceEnabled(resource?: vscode.Uri): boolean {
    return vscode.workspace
      .getConfiguration('vscode-kdb.languageServer', resource)
      .get<unknown>('connectedIntelligence', false) === true;
  }

  private logFailure(operation: string, error: unknown): void {
    const kind = error instanceof Error ? error.name : typeof error;
    this.output.appendLine(`[q-language] ${operation} failed (${safeLog(kind)}). Existing q execution remains available.`);
  }
}

function isQDocument(document: vscode.TextDocument): boolean {
  return document.languageId === 'q';
}

function safeLog(value: string): string {
  return value.replace(/[^A-Za-z0-9 ._:-]/g, '?').slice(0, 120);
}
