import { createHash } from 'crypto';
import type * as vscode from 'vscode';
import {
  ConnectionValidationError,
  KxConnection,
  MAX_TIMEOUT_MS,
  connectionEndpoint,
  normalizeHost,
  normalizeNamespace,
  validateConnection,
  validateHost,
  validateNamespace,
  validatePassword,
} from './connection';

export const LEGACY_KDB_DRIVER_ALIASES = Object.freeze([
  'KDB',
  'kdb+',
  'kdb',
  'kdb-sqltools',
  'DanielAlonso.kdb-sqltools',
] as const);

export const SQLTOOLS_SSH_UNSUPPORTED_REASON =
  'Not importable: requires SQLTools SSH tunnelling';
export const LEGACY_CONNECTION_TIMEOUT_SECONDS = 30;

const SQLTOOLS_CONFIGURATION_SECTION = 'sqltools';
const SQLTOOLS_CONNECTIONS_SETTING = 'connections';
const NORMALIZED_LEGACY_ALIASES = new Set(
  LEGACY_KDB_DRIVER_ALIASES.map(alias => alias.trim().toLowerCase())
);
const IMPORT_REVIEW_ACTION = 'Review Imported Connection';
const COPY_PASSWORDS_ACTION = 'Copy Passwords and Import';
const WITHOUT_PASSWORDS_ACTION = 'Import Without Passwords';

export type SqlToolsConfigurationScopeKind =
  | 'global'
  | 'workspace'
  | 'workspaceFolder'
  | 'effective';

export interface SqlToolsConfigurationScope {
  key: string;
  kind: SqlToolsConfigurationScopeKind;
  label: string;
  priority: number;
  value: unknown;
}

export interface SqlToolsCandidateSource {
  kind: SqlToolsConfigurationScopeKind;
  label: string;
}

export type SqlToolsPasswordState = 'present' | 'absent' | 'unavailable';

interface SqlToolsCandidateBase {
  identity: string;
  name: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  passwordState: SqlToolsPasswordState;
  connectTimeoutMs?: number;
  connectionTimeoutSeconds?: number;
  timeoutUsesSchemaDefault: boolean;
  sources: SqlToolsCandidateSource[];
  preferredSourceKey: string;
  preferredSourcePriority: number;
  preferredEntryIndex: number;
}

export interface ImportableSqlToolsCandidate extends SqlToolsCandidateBase {
  status: 'importable';
  host: string;
  port: number;
  database: string;
  username: string;
  connectTimeoutMs: number;
  connectionTimeoutSeconds: number;
}

export interface UnsupportedSqlToolsCandidate extends SqlToolsCandidateBase {
  status: 'unsupported';
  reason: string;
}

export type SqlToolsConnectionCandidate =
  | ImportableSqlToolsCandidate
  | UnsupportedSqlToolsCandidate;

export interface SqlToolsDiscoveryIssue {
  source: SqlToolsCandidateSource;
  reason: string;
}

export interface SqlToolsDiscoveryResult {
  candidates: SqlToolsConnectionCandidate[];
  issues: SqlToolsDiscoveryIssue[];
}

export type ParsedSqlToolsCandidate =
  | Omit<
    ImportableSqlToolsCandidate,
    'sources' | 'preferredSourceKey' | 'preferredSourcePriority' | 'preferredEntryIndex'
  >
  | Omit<
    UnsupportedSqlToolsCandidate,
    'sources' | 'preferredSourceKey' | 'preferredSourcePriority' | 'preferredEntryIndex'
  >;

export type SqlToolsParseResult =
  | { status: 'ignored' }
  | { status: 'candidate'; candidate: ParsedSqlToolsCandidate };

export interface ConfirmedPasswordResolution {
  status: 'available' | 'not-present' | 'changed';
  password?: string;
}

export interface ConnectionMigrationStore {
  connections(): KxConnection[];
  newConnectionId(): string;
  add(connection: KxConnection, password?: string): Promise<void>;
}

export interface ConnectionMigrationTree {
  refresh(): void;
}

interface MigrationQuickPickItem extends vscode.QuickPickItem {
  candidate: SqlToolsConnectionCandidate;
  selectable: boolean;
}

interface ConflictQuickPickItem extends vscode.QuickPickItem {
  action: 'skip' | 'rename';
}

interface PlannedMigration {
  candidate: ImportableSqlToolsCandidate;
  name: string;
  allowEndpointDuplicate: boolean;
}

interface ImportCounts {
  imported: number;
  skipped: number;
  unsupported: number;
  failed: number;
}

interface FieldRead {
  ok: boolean;
  present: boolean;
  value?: unknown;
}

interface CandidateDisplayFields {
  name: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  passwordState: SqlToolsPasswordState;
}

interface TimeoutMapping {
  ok: boolean;
  milliseconds?: number;
  seconds?: number;
  usesSchemaDefault: boolean;
}

interface CandidateGroup {
  candidate: SqlToolsConnectionCandidate;
  sourceKeys: Set<string>;
}

interface CandidateCredentialCapture {
  credential?: string;
}

export function normalizeLegacyDriverAlias(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return NORMALIZED_LEGACY_ALIASES.has(normalized) ? normalized : undefined;
}

export function sanitizeConnectionLabel(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\$\(/g, '$ (')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(normalized).slice(0, 100).join('');
}

export function sqlToolsCandidateIdentity(
  name: string,
  host: string | undefined,
  port: number | undefined,
  database: string | undefined,
  username: string | undefined
): string {
  return JSON.stringify([
    name.toLocaleLowerCase(),
    host ? host.toLocaleLowerCase() : '',
    port === undefined ? null : port,
    database || '',
    username || '',
  ]);
}

export function parseSqlToolsConnection(value: unknown): SqlToolsParseResult {
  try {
    return parseSqlToolsConnectionValue(value);
  } catch {
    return { status: 'ignored' };
  }
}

function parseSqlToolsConnectionWithCredential(
  value: unknown
): { parsed: SqlToolsParseResult; credential?: string } {
  const capture: CandidateCredentialCapture = {};
  try {
    const parsed = parseSqlToolsConnectionValue(value, capture);
    if (parsed.status !== 'candidate' || parsed.candidate.status !== 'importable') {
      capture.credential = undefined;
    }
    return { parsed, credential: capture.credential };
  } catch {
    capture.credential = undefined;
    return {
      parsed: { status: 'ignored' },
      credential: capture.credential,
    };
  }
}

function parseSqlToolsConnectionValue(
  value: unknown,
  credentialCapture?: CandidateCredentialCapture
): SqlToolsParseResult {
  if (!isRecord(value)) {
    return { status: 'ignored' };
  }

  const driver = readField(value, 'driver');
  if (!driver.ok || !driver.present || !normalizeLegacyDriverAlias(driver.value)) {
    return { status: 'ignored' };
  }

  const nameRead = readField(value, 'name');
  const safeName = nameRead.ok ? sanitizeConnectionLabel(nameRead.value) : '';
  const name = safeName || 'Unnamed KDB connection';
  const sshRead = readField(value, 'ssh');

  if (sshRead.ok && sshRead.value === 'Enabled') {
    const display = readCandidateDisplayFields(value, name);
    return {
      status: 'candidate',
      candidate: unsupportedCandidate(display, SQLTOOLS_SSH_UNSUPPORTED_REASON),
    };
  }

  if (!nameRead.ok) {
    return {
      status: 'candidate',
      candidate: unsupportedCandidate(
        emptyDisplay(name),
        'Not importable: connection name could not be read safely'
      ),
    };
  }
  if (!safeName) {
    return {
      status: 'candidate',
      candidate: unsupportedCandidate(
        emptyDisplay(name),
        'Not importable: missing connection name'
      ),
    };
  }
  if (!sshRead.ok) {
    return {
      status: 'candidate',
      candidate: unsupportedCandidate(
        emptyDisplay(name),
        'Not importable: SSH mode could not be read safely'
      ),
    };
  }
  if (sshRead.present && sshRead.value !== undefined && sshRead.value !== 'Disabled') {
    const display = readCandidateDisplayFields(value, name);
    return {
      status: 'candidate',
      candidate: unsupportedCandidate(display, 'Not importable: unsupported SSH mode'),
    };
  }

  const serverRead = readField(value, 'server');
  const portRead = readField(value, 'port');
  const databaseRead = readField(value, 'database');
  const usernameRead = readField(value, 'username');
  const passwordRead = readField(value, 'password');
  const timeoutRead = readField(value, 'connectionTimeout');
  const passwordState = passwordStateFromField(passwordRead);
  if (credentialCapture) {
    credentialCapture.credential = credentialFromField(passwordRead);
  }
  const display = normalizedDisplayFields(
    name,
    serverRead,
    portRead,
    databaseRead,
    usernameRead,
    passwordState
  );

  if (!serverRead.ok || !portRead.ok || !databaseRead.ok || !usernameRead.ok ||
      !passwordRead.ok || !timeoutRead.ok) {
    return {
      status: 'candidate',
      candidate: unsupportedCandidate(
        display,
        'Not importable: profile fields could not be read safely'
      ),
    };
  }
  if (typeof serverRead.value !== 'string' || !serverRead.value.trim()) {
    return {
      status: 'candidate',
      candidate: unsupportedCandidate(display, 'Not importable: missing server'),
    };
  }
  if (typeof portRead.value !== 'number' || !Number.isInteger(portRead.value) ||
      portRead.value < 1 || portRead.value > 65535) {
    return {
      status: 'candidate',
      candidate: unsupportedCandidate(
        display,
        'Not importable: port must be an integer from 1 to 65535'
      ),
    };
  }
  if (databaseRead.present && databaseRead.value !== undefined &&
      typeof databaseRead.value !== 'string') {
    return {
      status: 'candidate',
      candidate: unsupportedCandidate(display, 'Not importable: namespace must be text'),
    };
  }
  if (usernameRead.present && usernameRead.value !== undefined &&
      typeof usernameRead.value !== 'string') {
    return {
      status: 'candidate',
      candidate: unsupportedCandidate(display, 'Not importable: username must be text'),
    };
  }
  if (passwordRead.present && passwordRead.value !== undefined &&
      typeof passwordRead.value !== 'string') {
    return {
      status: 'candidate',
      candidate: unsupportedCandidate(display, 'Not importable: password must be text'),
    };
  }
  if (typeof passwordRead.value === 'string') {
    try {
      validatePassword(passwordRead.value);
    } catch (error) {
      const reason = error instanceof ConnectionValidationError
        ? safeValidationReason(error.message)
        : 'password failed standalone validation';
      return {
        status: 'candidate',
        candidate: unsupportedCandidate(display, `Not importable: ${reason}`),
      };
    }
  }

  const timeout = mapConnectionTimeout(timeoutRead);
  if (!timeout.ok || timeout.milliseconds === undefined || timeout.seconds === undefined) {
    return {
      status: 'candidate',
      candidate: unsupportedCandidate(
        display,
        `Not importable: connection timeout must convert to a whole number from 0 to ${MAX_TIMEOUT_MS} ms`
      ),
    };
  }

  try {
    const connection = validateConnection({
      id: 'migration-candidate',
      name,
      host: serverRead.value,
      port: portRead.value,
      database: typeof databaseRead.value === 'string' ? databaseRead.value : '.',
      username: typeof usernameRead.value === 'string' ? usernameRead.value : '',
      connectTimeoutMs: timeout.milliseconds,
    });
    return {
      status: 'candidate',
      candidate: {
        status: 'importable',
        identity: sqlToolsCandidateIdentity(
          connection.name,
          connection.host,
          connection.port,
          connection.database,
          connection.username
        ),
        name: connection.name,
        host: connection.host,
        port: connection.port,
        database: connection.database,
        username: connection.username,
        passwordState,
        connectTimeoutMs: timeout.milliseconds,
        connectionTimeoutSeconds: timeout.seconds,
        timeoutUsesSchemaDefault: timeout.usesSchemaDefault,
      },
    };
  } catch (error) {
    const reason = error instanceof ConnectionValidationError
      ? safeValidationReason(error.message)
      : 'profile failed standalone validation';
    return {
      status: 'candidate',
      candidate: unsupportedCandidate(display, `Not importable: ${reason}`),
    };
  }
}

export function discoverSqlToolsConnections(
  scopes: readonly SqlToolsConfigurationScope[]
): SqlToolsDiscoveryResult {
  const groups: CandidateGroup[] = [];
  const issues: SqlToolsDiscoveryIssue[] = [];

  try {
    for (const scope of scopes) {
      try {
        discoverConfigurationScope(scope, groups, issues);
      } catch {
        issues.push({
          source: { kind: 'effective', label: 'Unreadable settings scope' },
          reason: 'Not importable: SQLTools connections setting could not be read safely',
        });
      }
    }
  } catch {
    issues.push({
      source: { kind: 'effective', label: 'Unreadable settings scope' },
      reason: 'Not importable: SQLTools connections setting could not be read safely',
    });
  }

  const candidates = groups.map(group => group.candidate);
  return {
    candidates: candidates.sort((left, right) =>
      left.name.localeCompare(right.name) ||
      left.identity.localeCompare(right.identity) ||
      left.preferredSourceKey.localeCompare(right.preferredSourceKey) ||
      left.preferredEntryIndex - right.preferredEntryIndex),
    issues: deduplicateIssues(issues),
  };
}

function discoverConfigurationScope(
  scope: SqlToolsConfigurationScope,
  groups: CandidateGroup[],
  issues: SqlToolsDiscoveryIssue[]
): void {
  const source: SqlToolsCandidateSource = {
    kind: scope.kind,
    label: sanitizeSourceLabel(scope.label),
  };
  if (!Array.isArray(scope.value)) {
    issues.push({
      source,
      reason: 'Not importable: SQLTools connections setting is not an array',
    });
    return;
  }

  for (let entryIndex = 0; entryIndex < scope.value.length; entryIndex++) {
    const value = scope.value[entryIndex];
    const parsed = parseSqlToolsConnection(value);
    if (parsed.status === 'ignored') {
      continue;
    }
    const candidate: SqlToolsConnectionCandidate = {
      ...parsed.candidate,
      sources: [source],
      preferredSourceKey: scope.key,
      preferredSourcePriority: scope.priority,
      preferredEntryIndex: entryIndex,
    };
    const existing = groups.find(group =>
      !group.sourceKeys.has(scope.key) &&
      sameCandidateDefinition(group.candidate, candidate)
    );
    if (!existing) {
      groups.push({ candidate, sourceKeys: new Set([scope.key]) });
      continue;
    }

    existing.sourceKeys.add(scope.key);
    const sources = mergeCandidateSources(existing.candidate.sources, candidate.sources);
    if (candidate.preferredSourcePriority > existing.candidate.preferredSourcePriority) {
      existing.candidate = { ...candidate, sources };
    } else {
      existing.candidate = { ...existing.candidate, sources };
    }
  }
}

export function mapSqlToolsCandidate(
  candidate: ImportableSqlToolsCandidate,
  id: string,
  name = candidate.name,
  existing: readonly KxConnection[] = []
): KxConnection {
  return validateConnection({
    id,
    name: sanitizeConnectionLabel(name),
    host: candidate.host,
    port: candidate.port,
    database: candidate.database,
    username: candidate.username,
    connectTimeoutMs: candidate.connectTimeoutMs,
  }, existing);
}

export function readConfirmedCandidatePassword(
  scopes: readonly SqlToolsConfigurationScope[],
  selected: ImportableSqlToolsCandidate
): ConfirmedPasswordResolution {
  try {
    return readConfirmedCandidatePasswordValue(scopes, selected);
  } catch {
    return { status: 'changed' };
  }
}

function readConfirmedCandidatePasswordValue(
  scopes: readonly SqlToolsConfigurationScope[],
  selected: ImportableSqlToolsCandidate
): ConfirmedPasswordResolution {
  if (selected.passwordState !== 'present') {
    return { status: 'not-present' };
  }
  const preferred = scopes.find(scope => scope.key === selected.preferredSourceKey);
  if (!preferred || !Array.isArray(preferred.value)) {
    return { status: 'changed' };
  }
  const value = preferred.value[selected.preferredEntryIndex];
  const { parsed, credential } = parseSqlToolsConnectionWithCredential(value);
  if (parsed.status !== 'candidate' || parsed.candidate.status !== 'importable' ||
      !sameMigrationCandidate(parsed.candidate, selected)) {
    return { status: 'changed' };
  }
  if (typeof credential !== 'string' || !credential) {
    return { status: 'changed' };
  }
  return { status: 'available', password: credential };
}

export function readSqlToolsConfigurationScopes(
  api: Pick<typeof vscode, 'workspace'>
): SqlToolsConfigurationScope[] {
  const scopes: SqlToolsConfigurationScope[] = [];
  let sawExplicitValue = false;
  let rootConfiguration: vscode.WorkspaceConfiguration | undefined;

  try {
    rootConfiguration = api.workspace.getConfiguration(SQLTOOLS_CONFIGURATION_SECTION);
    const inspection = rootConfiguration.inspect<unknown>(SQLTOOLS_CONNECTIONS_SETTING);
    if (inspection) {
      if (inspection.globalValue !== undefined) {
        sawExplicitValue = true;
        scopes.push(configurationScope('global', 'global', 'User settings', 10, inspection.globalValue));
      }
      if (inspection.workspaceValue !== undefined) {
        sawExplicitValue = true;
        scopes.push(configurationScope('workspace', 'workspace', 'Workspace settings', 20, inspection.workspaceValue));
      }
    }
  } catch {
    rootConfiguration = undefined;
  }

  let folders: vscode.WorkspaceFolder[] = [];
  try {
    folders = Array.from(api.workspace.workspaceFolders || []);
  } catch {
    return scopes;
  }
  folders.forEach(folder => {
    try {
      const scopeKey = workspaceFolderScopeKey('workspace-folder', folder);
      const configuration = api.workspace.getConfiguration(SQLTOOLS_CONFIGURATION_SECTION, folder.uri);
      const inspection = configuration.inspect<unknown>(SQLTOOLS_CONNECTIONS_SETTING);
      if (inspection && inspection.workspaceFolderValue !== undefined) {
        sawExplicitValue = true;
        scopes.push(configurationScope(
          scopeKey,
          'workspaceFolder',
          `Workspace folder: ${sanitizeSourceLabel(folder.name)}`,
          30,
          inspection.workspaceFolderValue
        ));
      }
    } catch {
      // A broken resource-scoped configuration must not prevent other scopes from being reviewed.
    }
  });

  if (sawExplicitValue) {
    return scopes;
  }

  if (folders.length) {
    folders.forEach(folder => {
      try {
        const scopeKey = workspaceFolderScopeKey('effective-workspace-folder', folder);
        const effective = api.workspace
          .getConfiguration(SQLTOOLS_CONFIGURATION_SECTION, folder.uri)
          .get<unknown>(SQLTOOLS_CONNECTIONS_SETTING);
        if (effective !== undefined) {
          scopes.push(configurationScope(
            scopeKey,
            'effective',
            `Effective settings for workspace folder: ${sanitizeSourceLabel(folder.name)}`,
            30,
            effective
          ));
        }
      } catch {
        // Configuration failures become a quiet no-candidate result.
      }
    });
    return scopes;
  }

  try {
    const effective = rootConfiguration?.get<unknown>(SQLTOOLS_CONNECTIONS_SETTING);
    if (effective !== undefined) {
      scopes.push(configurationScope('effective', 'effective', 'Effective settings', 10, effective));
    }
  } catch {
    // Configuration failures become a quiet no-candidate result.
  }
  return scopes;
}

export function migrationCandidateReviewDetail(candidate: SqlToolsConnectionCandidate): string {
  const scope = candidate.sources.map(source => source.label).join(', ');
  const password = candidate.passwordState === 'present'
    ? 'present (value hidden)'
    : candidate.passwordState === 'absent'
      ? 'not present'
      : 'not inspected';
  const timeout = candidate.connectTimeoutMs === undefined
    ? 'unavailable'
    : `${candidate.connectionTimeoutSeconds}s${candidate.timeoutUsesSchemaDefault ? ' schema default' : ''} → ` +
      `${candidate.connectTimeoutMs} ms connect only`;
  return [
    `Scope: ${scope || 'Unknown settings scope'}`,
    `Selected source entry: ${candidate.preferredEntryIndex + 1}`,
    `Password: ${password}`,
    `Connect timeout: ${timeout}`,
    'Query timeout: inherits the KX default (not migrated)',
    candidate.status === 'unsupported' ? candidate.reason : undefined,
  ].filter((part): part is string => !!part).join(' • ');
}

export function findImportConflicts(
  candidate: ImportableSqlToolsCandidate,
  name: string,
  existing: readonly KxConnection[]
): KxConnection[] {
  const normalizedName = sanitizeConnectionLabel(name).toLocaleLowerCase();
  const endpointIdentity = standaloneEndpointIdentity(candidate);
  return existing.filter(connection =>
    connection.name.toLocaleLowerCase() === normalizedName ||
    standaloneEndpointIdentity(connection) === endpointIdentity
  );
}

export function suggestImportedConnectionName(
  baseName: string,
  existing: readonly KxConnection[]
): string {
  const names = new Set(existing.map(connection => connection.name.toLocaleLowerCase()));
  for (let index = 1; index < 10000; index++) {
    const suffix = index === 1 ? ' (imported)' : ` (imported ${index})`;
    const room = Math.max(1, 100 - Array.from(suffix).length);
    const stem = Array.from(sanitizeConnectionLabel(baseName)).slice(0, room).join('').trim();
    const candidate = `${stem || 'KDB'}${suffix}`;
    if (!names.has(candidate.toLocaleLowerCase())) {
      return candidate;
    }
  }
  return 'Imported KDB connection';
}

export class ConnectionMigrationCommand {
  public constructor(
    private readonly api: typeof vscode,
    private readonly store: ConnectionMigrationStore,
    private readonly tree: ConnectionMigrationTree
  ) {}

  public async run(): Promise<void> {
    let scopes = readSqlToolsConfigurationScopes(this.api);
    const discovery = discoverSqlToolsConnections(scopes);
    scopes = [];
    const importable = discovery.candidates.filter(
      (candidate): candidate is ImportableSqlToolsCandidate => candidate.status === 'importable'
    );
    const unsupported = discovery.candidates.length - importable.length + discovery.issues.length;

    if (!discovery.candidates.length && !discovery.issues.length) {
      await this.api.window.showInformationMessage(
        'No legacy SQLTools KDB connection candidates were found in VS Code settings. ' +
        'SQLTools does not need to be installed.'
      );
      scopes = [];
      return;
    }

    const selected = await this.showReview(discovery);
    if (!selected) {
      scopes = [];
      return;
    }

    const counts: ImportCounts = {
      imported: 0,
      skipped: importable.length - selected.length,
      unsupported,
      failed: 0,
    };
    const plans = await this.planImports(selected, counts);
    if (!plans.length) {
      scopes = [];
      await this.showSummary(counts, []);
      return;
    }

    const passwordCandidates = plans.filter(plan => plan.candidate.passwordState === 'present');
    let copyPasswords = false;
    if (passwordCandidates.length) {
      const decision = await this.api.window.showWarningMessage(
        `${passwordCandidates.length} selected SQLTools KDB profile(s) contain a plaintext password in VS Code settings. ` +
        'Copy each selected password one time into VS Code SecretStorage? The existing SQLTools setting will remain ' +
        'unchanged, and KX will not keep it synchronized.',
        { modal: true },
        COPY_PASSWORDS_ACTION,
        WITHOUT_PASSWORDS_ACTION
      );
      if (decision !== COPY_PASSWORDS_ACTION && decision !== WITHOUT_PASSWORDS_ACTION) {
        await this.api.window.showInformationMessage(
          'SQLTools KDB connection import canceled. No KX profiles or passwords were changed.'
        );
        scopes = [];
        return;
      }
      copyPasswords = decision === COPY_PASSWORDS_ACTION;
    }

    const importedIds: string[] = [];
    for (const plan of plans) {
      const current = this.store.connections();
      const conflicts = findImportConflicts(plan.candidate, plan.name, current);
      const nameConflict = conflicts.some(connection =>
        connection.name.toLocaleLowerCase() === plan.name.toLocaleLowerCase());
      if (nameConflict || (!plan.allowEndpointDuplicate && conflicts.length)) {
        counts.skipped++;
        continue;
      }

      let password: string | undefined;
      try {
        if (copyPasswords && plan.candidate.passwordState === 'present') {
          let confirmedScopes = readSqlToolsConfigurationScopes(this.api);
          let resolved: ConfirmedPasswordResolution;
          try {
            resolved = readConfirmedCandidatePassword(confirmedScopes, plan.candidate);
          } finally {
            confirmedScopes = [];
          }
          if (resolved.status !== 'available' || resolved.password === undefined) {
            counts.failed++;
            continue;
          }
          password = resolved.password;
          resolved.password = undefined;
        }
        const connection = mapSqlToolsCandidate(
          plan.candidate,
          this.store.newConnectionId(),
          plan.name,
          current
        );
        await this.store.add(connection, password);
        importedIds.push(connection.id);
        counts.imported++;
      } catch {
        counts.failed++;
      } finally {
        password = undefined;
      }
    }

    if (counts.imported) {
      this.tree.refresh();
    }
    await this.showSummary(counts, importedIds);
  }

  private async showReview(
    discovery: SqlToolsDiscoveryResult
  ): Promise<ImportableSqlToolsCandidate[] | undefined> {
    const quickPick = this.api.window.createQuickPick<MigrationQuickPickItem>();
    quickPick.title = 'Import SQLTools KDB Connections';
    quickPick.placeholder =
      'Select importable profiles. Unavailable profiles remain visible but cannot be selected.';
    quickPick.canSelectMany = true;
    quickPick.ignoreFocusOut = true;
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    quickPick.items = [
      ...discovery.candidates.map(candidate => ({
        label: candidate.status === 'importable'
          ? `$(database) ${candidate.name}`
          : `$(circle-slash) ${candidate.name}`,
        description: candidate.host !== undefined && candidate.port !== undefined
          ? `${connectionEndpoint({ host: candidate.host, port: candidate.port })} • ${candidate.database || '.'}`
          : 'Endpoint unavailable',
        detail: migrationCandidateReviewDetail(candidate),
        alwaysShow: true,
        candidate,
        selectable: candidate.status === 'importable',
      })),
      ...discovery.issues.map((issue, index) => ({
        label: `$(circle-slash) SQLTools settings issue ${index + 1}`,
        description: issue.source.label,
        detail: issue.reason,
        alwaysShow: true,
        candidate: issueCandidate(issue, index),
        selectable: false,
      })),
    ];

    return new Promise(resolve => {
      let accepted: ImportableSqlToolsCandidate[] | undefined;
      let correctingSelection = false;
      const subscriptions = [
        quickPick.onDidChangeSelection(items => {
          if (correctingSelection) {
            return;
          }
          const allowed = items.filter(item => item.selectable);
          if (allowed.length !== items.length) {
            correctingSelection = true;
            quickPick.selectedItems = allowed;
            correctingSelection = false;
          }
        }),
        quickPick.onDidAccept(() => {
          accepted = quickPick.selectedItems
            .filter(item => item.candidate.status === 'importable')
            .map(item => item.candidate as ImportableSqlToolsCandidate);
          quickPick.hide();
        }),
        quickPick.onDidHide(() => {
          subscriptions.forEach(subscription => subscription.dispose());
          quickPick.dispose();
          resolve(accepted);
        }),
      ];
      quickPick.show();
    });
  }

  private async planImports(
    selected: readonly ImportableSqlToolsCandidate[],
    counts: ImportCounts
  ): Promise<PlannedMigration[]> {
    const plans: PlannedMigration[] = [];
    const reserved: KxConnection[] = [];

    for (const candidate of selected) {
      const existing = [...this.store.connections(), ...reserved];
      const conflicts = findImportConflicts(candidate, candidate.name, existing);
      if (!conflicts.length) {
        const reservedConnection = mapSqlToolsCandidate(
          candidate,
          `migration-reserved-${reserved.length + 1}`,
          candidate.name,
          existing
        );
        reserved.push(reservedConnection);
        plans.push({ candidate, name: candidate.name, allowEndpointDuplicate: false });
        continue;
      }

      const decision = await this.api.window.showQuickPick<ConflictQuickPickItem>([
        {
          label: 'Skip (recommended)',
          description: 'Keep the saved KX profile unchanged.',
          action: 'skip',
        },
        {
          label: 'Import as new name',
          description: 'Create a separate KX profile; no existing profile is overwritten.',
          action: 'rename',
        },
      ], {
        title: `Duplicate KX connection: ${candidate.name}`,
        placeHolder: 'A saved KX profile already uses this name or direct endpoint.',
        ignoreFocusOut: true,
      });
      if (!decision || decision.action === 'skip') {
        counts.skipped++;
        continue;
      }

      const renamed = await this.api.window.showInputBox({
        title: `Import "${candidate.name}" as a new KX profile`,
        prompt: 'Choose a unique KX connection name. The saved profile will not be replaced.',
        value: suggestImportedConnectionName(candidate.name, existing),
        ignoreFocusOut: true,
        validateInput: value => validateImportName(value, candidate, existing),
      });
      if (renamed === undefined) {
        counts.skipped++;
        continue;
      }
      const safeName = sanitizeConnectionLabel(renamed);
      const validation = validateImportName(safeName, candidate, existing);
      if (validation) {
        counts.skipped++;
        continue;
      }
      const reservedConnection = mapSqlToolsCandidate(
        candidate,
        `migration-reserved-${reserved.length + 1}`,
        safeName,
        existing
      );
      reserved.push(reservedConnection);
      plans.push({ candidate, name: safeName, allowEndpointDuplicate: true });
    }
    return plans;
  }

  private async showSummary(counts: ImportCounts, importedIds: readonly string[]): Promise<void> {
    const message =
      `SQLTools KDB import: ${counts.imported} imported, ${counts.skipped} skipped, ` +
      `${counts.unsupported} unsupported, ${counts.failed} failed. ` +
      'Existing SQLTools settings were unchanged; there is no automatic ongoing sync.';
    const action = importedIds.length
      ? await this.api.window.showInformationMessage(message, IMPORT_REVIEW_ACTION)
      : await this.api.window.showInformationMessage(message);
    if (action === IMPORT_REVIEW_ACTION) {
      try {
        await this.api.commands.executeCommand(
          'vscode-kdb.editConnection',
          importedIds.length === 1 ? importedIds[0] : undefined
        );
      } catch {
        await this.api.window.showWarningMessage(
          'The imported KX profile is saved, but its editor could not be opened automatically.'
        );
      }
    }
  }
}

function validateImportName(
  value: string,
  candidate: ImportableSqlToolsCandidate,
  existing: readonly KxConnection[]
): string | undefined {
  try {
    mapSqlToolsCandidate(candidate, 'migration-name-validation', value, existing);
    return undefined;
  } catch (error) {
    return error instanceof ConnectionValidationError
      ? error.message
      : 'Enter a valid unique KX connection name.';
  }
}

function standaloneEndpointIdentity(
  connection: Pick<KxConnection, 'host' | 'port' | 'database' | 'username'>
): string {
  return JSON.stringify([
    connection.host.toLocaleLowerCase(),
    connection.port,
    connection.database,
    connection.username,
  ]);
}

function readCandidateDisplayFields(value: object, name: string): CandidateDisplayFields {
  const server = readField(value, 'server');
  const port = readField(value, 'port');
  const database = readField(value, 'database');
  const username = readField(value, 'username');
  const password = readField(value, 'password');
  return normalizedDisplayFields(
    name,
    server,
    port,
    database,
    username,
    passwordStateFromField(password)
  );
}

function normalizedDisplayFields(
  name: string,
  server: FieldRead,
  port: FieldRead,
  database: FieldRead,
  username: FieldRead,
  passwordState: SqlToolsPasswordState
): CandidateDisplayFields {
  let host: string | undefined;
  if (server.ok && typeof server.value === 'string' && server.value.trim()) {
    try {
      const normalizedHost = normalizeHost(server.value);
      validateHost(normalizedHost);
      host = normalizedHost;
    } catch {
      host = undefined;
    }
  }
  const safePort = port.ok && typeof port.value === 'number' && Number.isInteger(port.value) &&
    port.value >= 1 && port.value <= 65535
    ? port.value
    : undefined;
  let namespace: string | undefined;
  if (database.ok && (database.value === undefined || typeof database.value === 'string')) {
    try {
      const normalizedNamespace = normalizeNamespace(database.value);
      validateNamespace(normalizedNamespace);
      namespace = normalizedNamespace;
    } catch {
      namespace = undefined;
    }
  }
  const safeUsername = username.ok && typeof username.value === 'string' &&
    username.value.trim().length <= 256 && !/[\0\r\n:]/.test(username.value.trim())
    ? username.value.trim()
    : undefined;
  return {
    name,
    host,
    port: safePort,
    database: namespace,
    username: safeUsername,
    passwordState,
  };
}

function emptyDisplay(name: string): CandidateDisplayFields {
  return {
    name,
    passwordState: 'unavailable',
  };
}

function unsupportedCandidate(
  display: CandidateDisplayFields,
  reason: string
): Omit<
  UnsupportedSqlToolsCandidate,
  'sources' | 'preferredSourceKey' | 'preferredSourcePriority' | 'preferredEntryIndex'
> {
  return {
    status: 'unsupported',
    identity: sqlToolsCandidateIdentity(
      display.name,
      display.host,
      display.port,
      display.database,
      display.username
    ),
    name: display.name,
    ...(display.host === undefined ? {} : { host: display.host }),
    ...(display.port === undefined ? {} : { port: display.port }),
    ...(display.database === undefined ? {} : { database: display.database }),
    ...(display.username === undefined ? {} : { username: display.username }),
    passwordState: display.passwordState,
    timeoutUsesSchemaDefault: false,
    reason,
  };
}

function passwordStateFromField(field: FieldRead): SqlToolsPasswordState {
  if (!field.ok) {
    return 'unavailable';
  }
  if (!field.present || field.value === undefined || field.value === '') {
    return 'absent';
  }
  return typeof field.value === 'string' ? 'present' : 'unavailable';
}

function credentialFromField(password: FieldRead): string | undefined {
  return password.ok && typeof password.value === 'string' && password.value
    ? password.value
    : undefined;
}

function sameCandidateDefinition(
  left: SqlToolsConnectionCandidate,
  right: SqlToolsConnectionCandidate
): boolean {
  return left.status === right.status &&
    left.identity === right.identity &&
    left.name === right.name &&
    left.host === right.host &&
    left.port === right.port &&
    left.database === right.database &&
    left.username === right.username &&
    left.passwordState === right.passwordState &&
    left.connectTimeoutMs === right.connectTimeoutMs &&
    left.connectionTimeoutSeconds === right.connectionTimeoutSeconds &&
    left.timeoutUsesSchemaDefault === right.timeoutUsesSchemaDefault &&
    (left.status !== 'unsupported' || right.status !== 'unsupported' ||
      left.reason === right.reason);
}

function mapConnectionTimeout(field: FieldRead): TimeoutMapping {
  const usesSchemaDefault = !field.present || field.value === undefined;
  const seconds = usesSchemaDefault ? LEGACY_CONNECTION_TIMEOUT_SECONDS : field.value;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return { ok: false, usesSchemaDefault };
  }
  const milliseconds = seconds * 1000;
  if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > MAX_TIMEOUT_MS) {
    return { ok: false, usesSchemaDefault };
  }
  return { ok: true, milliseconds, seconds, usesSchemaDefault };
}

function sameMigrationCandidate(
  left: Omit<
    ImportableSqlToolsCandidate,
    'sources' | 'preferredSourceKey' | 'preferredSourcePriority' | 'preferredEntryIndex'
  >,
  right: ImportableSqlToolsCandidate
): boolean {
  return left.identity === right.identity &&
    left.host === right.host &&
    left.port === right.port &&
    left.database === right.database &&
    left.username === right.username &&
    left.connectTimeoutMs === right.connectTimeoutMs &&
    left.connectionTimeoutSeconds === right.connectionTimeoutSeconds &&
    left.timeoutUsesSchemaDefault === right.timeoutUsesSchemaDefault &&
    left.passwordState === right.passwordState;
}

function configurationScope(
  key: string,
  kind: SqlToolsConfigurationScopeKind,
  label: string,
  priority: number,
  value: unknown
): SqlToolsConfigurationScope {
  return {
    key,
    kind,
    label: sanitizeSourceLabel(label),
    priority,
    value,
  };
}

function workspaceFolderScopeKey(
  prefix: 'workspace-folder' | 'effective-workspace-folder',
  folder: vscode.WorkspaceFolder
): string {
  const uri = folder.uri.toString();
  if (!uri || uri === '[object Object]') {
    throw new Error('Workspace folder URI is unavailable.');
  }
  return `${prefix}-${createHash('sha256').update(uri, 'utf8').digest('hex')}`;
}

function sanitizeSourceLabel(value: unknown): string {
  const safe = sanitizeConnectionLabel(value);
  return safe || 'Unknown settings scope';
}

function mergeCandidateSources(
  left: readonly SqlToolsCandidateSource[],
  right: readonly SqlToolsCandidateSource[]
): SqlToolsCandidateSource[] {
  const merged: SqlToolsCandidateSource[] = [];
  const seen = new Set<string>();
  for (const source of [...left, ...right]) {
    const key = `${source.kind}\0${source.label}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(source);
    }
  }
  return merged;
}

function deduplicateIssues(issues: readonly SqlToolsDiscoveryIssue[]): SqlToolsDiscoveryIssue[] {
  const result: SqlToolsDiscoveryIssue[] = [];
  const seen = new Set<string>();
  for (const issue of issues) {
    const key = `${issue.source.kind}\0${issue.source.label}\0${issue.reason}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(issue);
    }
  }
  return result;
}

function issueCandidate(
  issue: SqlToolsDiscoveryIssue,
  index: number
): UnsupportedSqlToolsCandidate {
  const name = `SQLTools settings issue ${index + 1}`;
  return {
    status: 'unsupported',
    identity: sqlToolsCandidateIdentity(name, undefined, undefined, undefined, undefined),
    name,
    passwordState: 'unavailable',
    timeoutUsesSchemaDefault: false,
    sources: [issue.source],
    preferredSourceKey: `issue-${index}`,
    preferredSourcePriority: 0,
    preferredEntryIndex: 0,
    reason: issue.reason,
  };
}

function safeValidationReason(message: string): string {
  const allowed = [
    'Connection name is required.',
    'Connection name must be 100 characters or fewer.',
    'Connection name cannot contain line breaks or null characters.',
    'Host is required.',
    'Host must be 253 characters or fewer.',
    'Host cannot contain whitespace.',
    'Enter a host name or IP address without a URL scheme or path.',
    'Enter a valid host name, IPv4 address, or IPv6 address.',
    'Host names may contain only letters, digits, dots, and non-edge hyphens.',
    'Port must be an integer from 1 to 65535.',
    'Namespace must be 512 characters or fewer.',
    'Namespace must be "." or dot-separated q identifiers such as .app or .app.data.',
    'Username must be 256 characters or fewer.',
    'Username cannot contain colons, line breaks, or null characters.',
    'Password cannot contain null characters.',
    'Password must be 65535 characters or fewer.',
  ];
  return allowed.includes(message) ? message.replace(/\.$/, '').toLocaleLowerCase() :
    'profile failed standalone validation';
}

function readField(value: object, key: string): FieldRead {
  try {
    const present = Object.prototype.hasOwnProperty.call(value, key);
    return {
      ok: true,
      present,
      value: present ? (value as Record<string, unknown>)[key] : undefined,
    };
  } catch {
    return { ok: false, present: false };
  }
}

function isRecord(value: unknown): value is object {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
