import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { DEFAULT_NAMESPACE, KxConnection, MAX_TIMEOUT_MS } from './connection';
import {
  ConnectionFormMode,
  ConnectionFormValidationError,
} from './connection-form-model';

export interface ConnectionFormInitialValues {
  mode: ConnectionFormMode;
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  connectTimeoutMs?: number;
  queryTimeoutMs?: number;
  globalConnectTimeoutMs: number;
  globalQueryTimeoutMs: number;
  hasStoredPassword: boolean;
  reservedNames: string[];
}

export interface ConnectionFormCallbacks {
  onSave(payload: unknown): Promise<void>;
  onDelete?(): Promise<boolean>;
}

export type ConnectionFormResult = 'saved' | 'deleted' | 'cancelled';

interface FormMessage {
  type?: unknown;
  session?: unknown;
  payload?: unknown;
}

export class ConnectionFormPanel {
  private readonly panel: vscode.WebviewPanel;
  private readonly session = crypto.randomBytes(24).toString('hex');
  private readonly disposables: vscode.Disposable[] = [];
  private readonly completion: Promise<ConnectionFormResult>;
  private resolveCompletion!: (result: ConnectionFormResult) => void;
  private completed = false;
  private disposed = false;
  private busy = false;

  public constructor(
    private readonly initial: ConnectionFormInitialValues,
    private readonly callbacks: ConnectionFormCallbacks
  ) {
    this.completion = new Promise(resolve => {
      this.resolveCompletion = resolve;
    });
    this.panel = vscode.window.createWebviewPanel(
      'vscodeKdbConnection',
      'KX Connection',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      }
    );
    this.panel.webview.html = connectionFormHtml(
      this.panel.webview.cspSource,
      crypto.randomBytes(24).toString('base64'),
      this.session
    );
    this.disposables.push(
      this.panel.onDidDispose(() => this.didDispose()),
      this.panel.webview.onDidReceiveMessage(message => {
        void this.onMessage(message);
      })
    );
  }

  public waitForCompletion(): Promise<ConnectionFormResult> {
    return this.completion;
  }

  public reveal(): void {
    if (!this.disposed) {
      this.panel.reveal(vscode.ViewColumn.Active);
    }
  }

  private async onMessage(value: unknown): Promise<void> {
    if (this.disposed || !isRecord(value)) {
      return;
    }
    const message = value as FormMessage;
    if (message.session !== this.session || typeof message.type !== 'string') {
      return;
    }

    if (message.type === 'ready') {
      await this.post({
        type: 'initialize',
        values: this.initial,
        maxTimeoutMs: MAX_TIMEOUT_MS,
      });
      await this.post({ type: 'busy', busy: this.busy });
      return;
    }
    if (this.busy) {
      return;
    }
    if (message.type === 'cancel') {
      this.finish('cancelled');
      this.panel.dispose();
      return;
    }
    if (message.type === 'save') {
      await this.runBusy(async () => {
        await this.callbacks.onSave(message.payload);
        this.finish('saved');
        if (!this.disposed) {
          this.panel.dispose();
        }
      });
      return;
    }
    if (message.type === 'delete' && this.initial.mode === 'edit' && this.callbacks.onDelete) {
      await this.runBusy(async () => {
        const removed = await this.callbacks.onDelete!();
        if (removed) {
          this.finish('deleted');
          if (!this.disposed) {
            this.panel.dispose();
          }
        }
      });
    }
  }

  private async runBusy(action: () => Promise<void>): Promise<void> {
    this.busy = true;
    await this.post({ type: 'busy', busy: true });
    let failure: unknown;
    let failed = false;
    try {
      await action();
    } catch (error) {
      failure = error;
      failed = true;
    } finally {
      this.busy = false;
      await this.post({ type: 'busy', busy: false });
    }
    if (failed) {
      const field = failure instanceof ConnectionFormValidationError ? failure.field : undefined;
      const message = failure instanceof Error ? failure.message : String(failure);
      await this.post({ type: 'error', field, message });
    }
    if (this.disposed && !this.completed) {
      this.finish('cancelled');
    }
  }

  private async post(message: unknown): Promise<void> {
    if (this.disposed) {
      return;
    }
    try {
      await this.panel.webview.postMessage(message);
    } catch {
      // A disposed/reloaded webview can reject an otherwise stale response.
    }
  }

  private didDispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.disposables.splice(0).forEach(disposable => disposable.dispose());
    if (!this.busy) {
      this.finish('cancelled');
    }
  }

  private finish(result: ConnectionFormResult): void {
    if (this.completed) {
      return;
    }
    this.completed = true;
    this.resolveCompletion(result);
  }
}

export function connectionFormHtml(cspSource: string, nonce: string, session: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src ${cspSource} 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>KX Connection</title>
  <style nonce="${nonce}">
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    main {
      width: min(860px, 100%);
      margin: 0 auto;
      padding: 28px 28px 0;
    }
    h1 { margin: 0 0 8px; font-size: 24px; font-weight: 600; }
    .lead { margin: 0 0 24px; color: var(--vscode-descriptionForeground); line-height: 1.5; }
    fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px 20px;
    }
    .field { min-width: 0; }
    .field.full { grid-column: 1 / -1; }
    label { display: block; margin-bottom: 6px; font-weight: 600; }
    .required { color: var(--vscode-errorForeground); }
    input[type="text"], input[type="number"], input[type="password"] {
      width: 100%;
      min-height: 30px;
      padding: 5px 8px;
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px;
      outline: none;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font: inherit;
    }
    input:focus {
      border-color: var(--vscode-focusBorder);
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }
    input:invalid:not(:focus) { border-color: var(--vscode-inputValidation-errorBorder); }
    input::placeholder { color: var(--vscode-input-placeholderForeground); }
    .help { margin: 6px 0 0; color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.45; }
    details {
      margin-top: 24px;
      border: 1px solid var(--vscode-widget-border, var(--vscode-input-border));
      border-radius: 4px;
      background: var(--vscode-sideBar-background);
    }
    summary {
      padding: 12px 14px;
      cursor: pointer;
      font-weight: 600;
      user-select: none;
    }
    details[open] summary { border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-input-border)); }
    .advanced-body { padding: 16px 14px; }
    .advanced-intro { margin: 0 0 16px; color: var(--vscode-descriptionForeground); line-height: 1.45; }
    .check-row { display: flex; align-items: flex-start; gap: 8px; margin-top: 10px; }
    .check-row input { margin-top: 2px; }
    .check-row label { margin: 0; font-weight: 400; }
    .error-summary {
      margin: 20px 0 0;
      padding: 10px 12px;
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
      line-height: 1.4;
    }
    .footer {
      position: sticky;
      bottom: 0;
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 28px;
      padding: 16px 0 20px;
      border-top: 1px solid var(--vscode-widget-border, var(--vscode-input-border));
      background: var(--vscode-editor-background);
    }
    button {
      min-height: 30px;
      padding: 5px 14px;
      border: 1px solid transparent;
      border-radius: 2px;
      font: inherit;
      cursor: pointer;
    }
    button:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
    button:disabled { cursor: default; opacity: 0.55; }
    .primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
    .secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
    .danger {
      margin-left: auto;
      border-color: var(--vscode-inputValidation-errorBorder);
      background: transparent;
      color: var(--vscode-errorForeground);
    }
    .danger:hover:not(:disabled) { background: var(--vscode-inputValidation-errorBackground); }
    [hidden] { display: none !important; }
    @media (max-width: 640px) {
      main { padding: 20px 16px 0; }
      .grid { grid-template-columns: 1fr; }
      .field.full { grid-column: auto; }
      .footer { flex-wrap: wrap; }
      .danger { width: 100%; margin: 8px 0 0; order: 3; }
    }
  </style>
</head>
<body>
  <main>
    <h1 id="formTitle">KX Connection</h1>
    <p class="lead">Configure a direct q IPC endpoint. This form does not create SSH tunnels, TLS, gateways, or brokers.</p>
    <form id="connectionForm" aria-labelledby="formTitle">
      <fieldset id="formFields">
        <div class="grid">
          <div class="field full">
            <label for="name">Connection name <span class="required" aria-hidden="true">*</span></label>
            <input id="name" name="name" type="text" required maxlength="100" autocomplete="off" aria-describedby="nameHelp">
            <p id="nameHelp" class="help">A unique name shown in KX Connections.</p>
          </div>
          <div class="field">
            <label for="host">Host <span class="required" aria-hidden="true">*</span></label>
            <input id="host" name="host" type="text" required maxlength="253" autocomplete="off" aria-describedby="hostHelp" title="Direct q IPC host name or IP address; no URL, SSH, TLS, or gateway configuration.">
            <p id="hostHelp" class="help">Direct q IPC host name or IP address. Do not enter a URL, path, or tunnel configuration.</p>
          </div>
          <div class="field">
            <label for="port">Port <span class="required" aria-hidden="true">*</span></label>
            <input id="port" name="port" type="number" required min="1" max="65535" step="1" inputmode="numeric" aria-describedby="portHelp">
            <p id="portHelp" class="help">The direct q IPC listener port, from 1 to 65535.</p>
          </div>
          <div class="field">
            <label for="database">Namespace / database</label>
            <input id="database" name="database" type="text" maxlength="512" autocomplete="off" aria-describedby="databaseHelp" title="The q namespace used for editor runs; use . for root.">
            <p id="databaseHelp" class="help">The q namespace used for editor runs. Use <code>.</code> for root; a missing leading dot is added on Save.</p>
          </div>
          <div class="field">
            <label for="username">Username</label>
            <input id="username" name="username" type="text" maxlength="256" autocomplete="username" aria-describedby="usernameHelp">
            <p id="usernameHelp" class="help">Optional q IPC handshake username.</p>
          </div>
          <div class="field full">
            <label for="password">Password</label>
            <input id="password" name="password" type="password" maxlength="65535" autocomplete="new-password" aria-describedby="passwordHelp">
            <p id="passwordHelp" class="help">Optional. Stored only in VS Code SecretStorage and never in settings or logs.</p>
            <div id="clearPasswordRow" class="check-row" hidden>
              <input id="clearPassword" name="clearPassword" type="checkbox" aria-describedby="passwordHelp">
              <label for="clearPassword">Clear saved password</label>
            </div>
          </div>
        </div>

        <details id="advanced">
          <summary>Advanced direct q IPC</summary>
          <div class="advanced-body">
            <p class="advanced-intro">Leave either value blank to use its global default. Use <code>0</code> to disable that phase timeout. Queue time before a query starts is not included.</p>
            <div class="grid">
              <div class="field">
                <label for="connectTimeoutMs">Connect / handshake timeout (ms)</label>
                <input id="connectTimeoutMs" name="connectTimeoutMs" type="number" min="0" max="2147483647" step="1" inputmode="numeric" aria-describedby="connectTimeoutHelp">
                <p id="connectTimeoutHelp" class="help">Use global default. A full timeout budget applies separately to TCP connect and q IPC handshake.</p>
              </div>
              <div class="field">
                <label for="queryTimeoutMs">Query timeout (ms)</label>
                <input id="queryTimeoutMs" name="queryTimeoutMs" type="number" min="0" max="2147483647" step="1" inputmode="numeric" aria-describedby="queryTimeoutHelp">
                <p id="queryTimeoutHelp" class="help">Use global default. The timer starts when this connection sends the query and waits for its response.</p>
              </div>
            </div>
          </div>
        </details>
      </fieldset>

      <div id="formError" class="error-summary" role="alert" aria-live="assertive" tabindex="-1" hidden></div>
      <footer class="footer">
        <button id="save" class="primary" type="submit" disabled>Save Connection</button>
        <button id="cancel" class="secondary" type="button">Cancel</button>
        <button id="delete" class="danger" type="button" hidden>Delete Connection</button>
      </footer>
    </form>
  </main>

  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      const session = '${session}';
      const form = document.getElementById('connectionForm');
      const fields = document.getElementById('formFields');
      const title = document.getElementById('formTitle');
      const error = document.getElementById('formError');
      const advanced = document.getElementById('advanced');
      const save = document.getElementById('save');
      const cancel = document.getElementById('cancel');
      const deleteButton = document.getElementById('delete');
      const clearPasswordRow = document.getElementById('clearPasswordRow');
      const clearPassword = document.getElementById('clearPassword');
      const controls = {
        name: document.getElementById('name'),
        host: document.getElementById('host'),
        port: document.getElementById('port'),
        database: document.getElementById('database'),
        username: document.getElementById('username'),
        password: document.getElementById('password'),
        connectTimeoutMs: document.getElementById('connectTimeoutMs'),
        queryTimeoutMs: document.getElementById('queryTimeoutMs')
      };
      let reservedNames = [];
      let busy = false;
      let serverErrorField;
      let serverErrorMessage = '';

      function post(type, payload) {
        vscode.postMessage({ type, session, payload });
      }

      function setError(message, field) {
        if (serverErrorField && controls[serverErrorField]) {
          controls[serverErrorField].setCustomValidity('');
        }
        serverErrorField = message && field && controls[field] ? field : undefined;
        serverErrorMessage = serverErrorField ? message : '';
        if (serverErrorField) {
          controls[serverErrorField].setCustomValidity(serverErrorMessage);
        }
        error.textContent = message || '';
        error.hidden = !message;
        save.disabled = busy || !form.checkValidity();
        if (!message) {
          return;
        }
        const control = field && controls[field];
        if (field === 'connectTimeoutMs' || field === 'queryTimeoutMs') {
          advanced.open = true;
        }
        if (control) {
          control.focus();
        } else {
          error.focus();
        }
      }

      function setBusy(value) {
        busy = !!value;
        fields.disabled = busy;
        cancel.disabled = busy;
        deleteButton.disabled = busy;
        save.disabled = busy || !form.checkValidity();
        form.setAttribute('aria-busy', String(busy));
      }

      function validate(showErrors) {
        controls.name.setCustomValidity('');
        controls.host.setCustomValidity('');
        controls.database.setCustomValidity('');
        controls.username.setCustomValidity('');
        controls.password.setCustomValidity('');

        const normalizedName = controls.name.value.trim().toLocaleLowerCase();
        if (normalizedName && reservedNames.includes(normalizedName)) {
          controls.name.setCustomValidity('Connection name must be unique.');
        }
        const host = controls.host.value.trim();
        if (/\\s/.test(host) || host.includes('/') || host.includes('\\\\')) {
          controls.host.setCustomValidity('Enter a host name or IP address without a URL scheme or path.');
        }
        const namespace = controls.database.value.trim();
        if (namespace && namespace !== '.' && !/^\\.?[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(namespace)) {
          controls.database.setCustomValidity('Use . or dot-separated q identifiers such as .app.data.');
        }
        if (/[:\\r\\n\\0]/.test(controls.username.value)) {
          controls.username.setCustomValidity('Username cannot contain colons or line breaks.');
        }
        if (clearPassword.checked && controls.password.value) {
          controls.password.setCustomValidity('Enter a new password or clear the saved password, not both.');
        }
        if (serverErrorField && controls[serverErrorField]) {
          controls[serverErrorField].setCustomValidity(serverErrorMessage);
        }
        const valid = form.checkValidity();
        save.disabled = busy || !valid;
        if (!valid && showErrors) {
          form.reportValidity();
          const firstInvalid = form.querySelector(':invalid');
          if (firstInvalid) {
            firstInvalid.focus();
          }
        }
        return valid;
      }

      function initialize(values, maxTimeoutMs) {
        title.textContent = values.mode === 'edit' ? 'Edit KX Connection' : 'Add KX Connection';
        controls.name.value = values.name || '';
        controls.host.value = values.host || '';
        controls.port.value = String(values.port || '');
        controls.database.value = values.database || '${DEFAULT_NAMESPACE}';
        controls.username.value = values.username || '';
        controls.password.value = '';
        controls.connectTimeoutMs.value = values.connectTimeoutMs === undefined ? '' : String(values.connectTimeoutMs);
        controls.queryTimeoutMs.value = values.queryTimeoutMs === undefined ? '' : String(values.queryTimeoutMs);
        controls.connectTimeoutMs.max = String(maxTimeoutMs);
        controls.queryTimeoutMs.max = String(maxTimeoutMs);
        controls.connectTimeoutMs.placeholder = 'Use global default (' + values.globalConnectTimeoutMs + ' ms)';
        controls.queryTimeoutMs.placeholder = 'Use global default (' + values.globalQueryTimeoutMs + ' ms)';
        document.getElementById('connectTimeoutHelp').textContent = 'Use global default (' + values.globalConnectTimeoutMs + ' ms). A full timeout budget applies separately to TCP connect and q IPC handshake; 0 disables both deadlines.';
        document.getElementById('queryTimeoutHelp').textContent = 'Use global default (' + values.globalQueryTimeoutMs + ' ms). The timer starts when the query is sent and waits for its response; 0 disables it.';
        reservedNames = Array.isArray(values.reservedNames)
          ? values.reservedNames.filter(value => typeof value === 'string').map(value => value.toLocaleLowerCase())
          : [];
        deleteButton.hidden = values.mode !== 'edit';
        clearPasswordRow.hidden = values.mode !== 'edit' || !values.hasStoredPassword;
        clearPassword.checked = false;
        document.getElementById('passwordHelp').textContent = values.mode === 'edit'
          ? (values.hasStoredPassword
            ? 'Leave blank to keep the saved password. It remains in VS Code SecretStorage; select Clear saved password to remove it.'
            : 'No password is saved. Enter one to store it only in VS Code SecretStorage.')
          : 'Optional. Stored only in VS Code SecretStorage and never in settings or logs.';
        setError('', undefined);
        validate(false);
        window.setTimeout(() => controls.name.focus(), 0);
      }

      form.addEventListener('input', event => {
        const changesServerField = serverErrorField && (
          event.target === controls[serverErrorField] ||
          (serverErrorField === 'password' && event.target === clearPassword)
        );
        if (changesServerField || !serverErrorField) {
          setError('', undefined);
        }
        if (event.target === controls.password && controls.password.value) {
          clearPassword.checked = false;
        }
        if (event.target === clearPassword && clearPassword.checked) {
          controls.password.value = '';
        }
        validate(false);
      });
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (busy || !validate(true)) {
          return;
        }
        post('save', {
          name: controls.name.value,
          host: controls.host.value,
          port: controls.port.value,
          database: controls.database.value,
          username: controls.username.value,
          password: controls.password.value,
          clearPassword: clearPassword.checked,
          connectTimeoutMs: controls.connectTimeoutMs.value,
          queryTimeoutMs: controls.queryTimeoutMs.value
        });
      });
      cancel.addEventListener('click', () => !busy && post('cancel'));
      deleteButton.addEventListener('click', () => !busy && post('delete'));
      window.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !busy) {
          event.preventDefault();
          post('cancel');
        }
      });
      window.addEventListener('message', event => {
        const message = event.data;
        if (!message || typeof message !== 'object') {
          return;
        }
        if (message.type === 'initialize' && message.values) {
          initialize(message.values, message.maxTimeoutMs);
        } else if (message.type === 'busy') {
          setBusy(message.busy);
        } else if (message.type === 'error') {
          setError(typeof message.message === 'string' ? message.message : 'The connection could not be saved.', message.field);
        }
      });
      post('ready');
    }());
  </script>
</body>
</html>`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function initialConnectionFormValues(
  mode: ConnectionFormMode,
  connection: KxConnection,
  globalConnectTimeoutMs: number,
  globalQueryTimeoutMs: number,
  hasStoredPassword: boolean,
  reservedNames: string[]
): ConnectionFormInitialValues {
  return {
    mode,
    name: connection.name,
    host: connection.host,
    port: connection.port,
    database: connection.database,
    username: connection.username,
    connectTimeoutMs: connection.connectTimeoutMs,
    queryTimeoutMs: connection.queryTimeoutMs,
    globalConnectTimeoutMs,
    globalQueryTimeoutMs,
    hasStoredPassword,
    reservedNames,
  };
}
