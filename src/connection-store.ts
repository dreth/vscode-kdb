import * as crypto from 'crypto';
import * as vscode from 'vscode';
import {
  KxConnection,
  safeStoredConnections,
  validateConnection,
  validatePassword,
} from './connection';

const CONFIGURATION_SECTION = 'vscode-kdb';
const CONNECTIONS_SETTING = 'connections';
const ACTIVE_CONNECTION_KEY = 'vscode-kdb.activeConnectionId';
const PASSWORD_SECRET_PREFIX = 'vscode-kdb.connectionPassword.';
const OPTIMISTIC_CONNECTIONS_TTL_MS = 5000;

export type ConnectionConfigurationScopeKind =
  | 'global'
  | 'workspace'
  | 'workspaceFolder';

export interface ConnectionConfigurationScope {
  kind: ConnectionConfigurationScopeKind;
  folderUri?: string;
}

export interface ConnectionFolderConfigurationSource {
  folderUri: string;
  value: unknown;
}

export interface ConnectionConfigurationSources {
  global: unknown;
  workspace: unknown;
  workspaceFolders: readonly ConnectionFolderConfigurationSource[];
}

export interface ConnectionScopeConflict {
  id: string;
  scopes: ConnectionConfigurationScope[];
}

export interface MergedConnectionConfiguration {
  connections: KxConnection[];
  owners: Map<string, ConnectionConfigurationScope>;
  conflicts: ConnectionScopeConflict[];
}

export type ConnectionPasswordSource = 'secretStorage' | 'configuration' | 'none';

export interface ResolvedConnectionPassword {
  password: string | undefined;
  source: ConnectionPasswordSource;
}

interface OptimisticConnections {
  readonly value: readonly KxConnection[];
  readonly owners: ReadonlyMap<string, ConnectionConfigurationScope>;
  readonly scopeValues: ReadonlyMap<string, readonly KxConnection[]>;
  readonly knownScopeValueFingerprints: ReadonlyMap<string, readonly string[]>;
  readonly pendingWriteFingerprints: readonly string[];
  readonly observedConfigurationFingerprint: string;
  readonly expiresAt?: number;
  readonly yieldToConfigured?: boolean;
}

interface InFlightConnectionWrite {
  readonly targetFingerprint: string;
  readonly targetWasAlreadyObservable: boolean;
  readonly knownBeforeWriteFingerprints: readonly string[];
  sawConfigurationEvent: boolean;
  targetObserved: boolean;
  supersededAfterTarget: boolean;
}

export class ConnectionStore {
  private mutationQueue: Promise<void> = Promise.resolve();
  private optimisticConnections: OptimisticConnections | undefined;
  private activeConnectionIdSnapshot: string | undefined;
  private hasRememberedActiveConnectionSnapshot: boolean;
  private configurationRevision = 0;
  private lastEffectiveConfigurationFingerprint: string;
  private configurationMutationBlockedUntilFingerprint: string | undefined;
  private inFlightConnectionWrite: InFlightConnectionWrite | undefined;

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.activeConnectionIdSnapshot = context.globalState.get<string>(ACTIVE_CONNECTION_KEY);
    this.hasRememberedActiveConnectionSnapshot =
      this.activeConnectionIdSnapshot !== undefined;
    this.lastEffectiveConfigurationFingerprint =
      mergedConnectionFingerprint(this.configuredState());
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration(`${CONFIGURATION_SECTION}.${CONNECTIONS_SETTING}`)) {
        this.reconcileConfigurationChange();
      }
    }));
  }

  public connections(): KxConnection[] {
    const configuredSources = this.configurationSources();
    const configuredState = mergeConnectionConfigurations(configuredSources);
    const configured = configuredState.connections;
    const configuredFingerprint = mergedConnectionFingerprint(configuredState);
    const optimistic = this.optimisticConnections;
    if (!optimistic) {
      if (configuredFingerprint !== this.lastEffectiveConfigurationFingerprint) {
        this.lastEffectiveConfigurationFingerprint = configuredFingerprint;
        if (configuredFingerprint === this.configurationMutationBlockedUntilFingerprint) {
          this.configurationMutationBlockedUntilFingerprint = undefined;
        }
        this.configurationRevision++;
      }
      return configured;
    }
    const configuredKnown = configuredFingerprint ===
      optimistic.observedConfigurationFingerprint ||
      optimistic.pendingWriteFingerprints.includes(configuredFingerprint) ||
      optimisticConfigurationIsKnown(optimistic, configuredSources);
    if (optimistic.yieldToConfigured) {
      if (!configuredKnown) {
        this.optimisticConnections = undefined;
        this.configurationMutationBlockedUntilFingerprint = undefined;
      } else {
        this.configurationMutationBlockedUntilFingerprint =
          sameConnectionLists(configured, optimistic.value)
            ? undefined
            : connectionListFingerprint(optimistic.value);
      }
      if (configuredFingerprint !== this.lastEffectiveConfigurationFingerprint) {
        this.lastEffectiveConfigurationFingerprint = configuredFingerprint;
        this.configurationRevision++;
      }
      return configured;
    }
    const optimismExpired = optimistic.expiresAt !== undefined &&
      Date.now() > optimistic.expiresAt;
    if (optimismExpired) {
      this.optimisticConnections = {
        ...optimistic,
        yieldToConfigured: true,
      };
      this.configurationMutationBlockedUntilFingerprint =
        sameConnectionLists(configured, optimistic.value)
          ? undefined
          : connectionListFingerprint(optimistic.value);
      this.lastEffectiveConfigurationFingerprint = configuredFingerprint;
      if (!sameConnectionLists(configured, optimistic.value)) {
        this.configurationRevision++;
      }
      return configured;
    }
    if (!configuredKnown) {
      this.optimisticConnections = undefined;
      this.lastEffectiveConfigurationFingerprint = configuredFingerprint;
      this.configurationMutationBlockedUntilFingerprint = undefined;
      if (!sameConnectionLists(configured, optimistic.value)) {
        this.configurationRevision++;
      }
      return configured;
    }
    return cloneConnections(optimistic.value);
  }

  public connection(id: string): KxConnection | undefined {
    return this.connections().find(connection => connection.id === id);
  }

  public connectionScope(id: string): ConnectionConfigurationScope | undefined {
    this.connections();
    const scope = this.optimisticConnections?.owners.get(id) ??
      this.configuredState().owners.get(id);
    return scope ? { ...scope } : undefined;
  }

  public connectionScopeConflicts(): ConnectionScopeConflict[] {
    this.connections();
    const conflicts = this.optimisticConnections
      ? this.optimisticState().conflicts
      : this.configuredState().conflicts;
    return conflicts.map(conflict => ({
      id: conflict.id,
      scopes: conflict.scopes.map(scope => ({ ...scope })),
    }));
  }

  public availableConnectionScopes(): ConnectionConfigurationScope[] {
    const scopes: ConnectionConfigurationScope[] = [{ kind: 'global' }];
    const folders = [...(vscode.workspace.workspaceFolders || [])]
      .sort((left, right) => left.uri.toString().localeCompare(right.uri.toString()));
    if (folders.length > 0 || vscode.workspace.workspaceFile) {
      scopes.push({ kind: 'workspace' });
    }
    if (folders.length > 1) {
      folders.forEach(folder => scopes.push({
        kind: 'workspaceFolder',
        folderUri: folder.uri.toString(),
      }));
    }
    return scopes;
  }

  public defaultNewConnectionScope(): ConnectionConfigurationScope {
    return this.availableConnectionScopes().find(scope => scope.kind === 'workspace') ??
      { kind: 'global' };
  }

  public activeConnectionId(): string | undefined {
    const id = this.activeConnectionIdSnapshot;
    return id && this.connection(id) ? id : undefined;
  }

  public activeConnection(): KxConnection | undefined {
    const id = this.activeConnectionId();
    return id ? this.connection(id) : undefined;
  }

  public hasRememberedActiveConnection(): boolean {
    return this.hasRememberedActiveConnectionSnapshot;
  }

  public async setActiveConnection(id: string | undefined): Promise<void> {
    return this.mutate(async () => {
      if (id && !this.connection(id)) {
        throw new Error(`Cannot activate unknown KX connection ${id}.`);
      }
      const previousActiveId = this.activeConnectionIdSnapshot;
      try {
        await this.writeActiveConnectionId(id);
      } catch (error) {
        await this.rethrowAfterRollback(error, [
          () => this.writeActiveConnectionId(previousActiveId),
        ]);
      }
      if (id !== undefined) {
        this.hasRememberedActiveConnectionSnapshot = true;
      }
    });
  }

  public newConnectionId(): string {
    return `kx-${crypto.randomBytes(12).toString('hex')}`;
  }

  public async add(
    connection: KxConnection,
    password?: string,
    requestedScope?: ConnectionConfigurationScope
  ): Promise<void> {
    return this.mutate(async () => {
      const connections = this.connections();
      this.assertConfigurationWritable();
      const configurationRevision = this.configurationRevision;
      const validated = validateConnection(connection, connections);
      const scope = this.validateWritableScope(requestedScope || { kind: 'global' });
      const previousScopeConnections = this.scopeConnections(scope);
      if (this.allConfiguredConnections().some(item => item.id === validated.id)) {
        throw new Error(`A connection with ID "${validated.id}" already exists in KX settings.`);
      }
      const updatedScopeConnections = [...previousScopeConnections, validated];
      const updatedState = this.stateAfterScopeUpdate(scope, updatedScopeConnections);
      if (password !== undefined) {
        validatePassword(password);
      }
      const passwordChanges = password !== undefined;
      const previousPassword = passwordChanges
        ? await this.context.secrets.get(this.passwordKey(validated.id))
        : undefined;
      const previousActiveId = this.activeConnectionIdSnapshot;
      const shouldActivate = !this.activeConnectionId() &&
        !this.hasRememberedActiveConnection();
      let secretAttempted = false;
      let activeAttempted = false;
      let connectionsAttempted = false;
      let connectionsWriteRevision: number | undefined;
      try {
        this.assertConnectionsUnchanged(connections, configurationRevision);
        if (passwordChanges) {
          secretAttempted = true;
          await this.writePassword(validated.id, password);
          this.assertConnectionsUnchanged(connections, configurationRevision);
        }
        if (shouldActivate) {
          activeAttempted = true;
          await this.writeActiveConnectionId(validated.id);
          this.assertConnectionsUnchanged(connections, configurationRevision);
        }
        this.assertConnectionsUnchanged(connections, configurationRevision);
        connectionsWriteRevision = this.configurationRevision;
        connectionsAttempted = true;
        await this.writeConnections(
          updatedState,
          updatedScopeConnections,
          scope
        );
      } catch (error) {
        let connectionsRestored = !connectionsAttempted;
        const canRestoreConnections = connectionsAttempted &&
          connectionsWriteRevision !== undefined &&
          this.connectionSnapshotIsCurrent(connections, connectionsWriteRevision);
        await this.rethrowAfterRollback(error, [
          canRestoreConnections ? async () => {
            await this.writeConnections(
              this.stateAfterScopeUpdate(scope, previousScopeConnections),
              previousScopeConnections,
              scope
            );
            connectionsRestored = true;
          } : undefined,
          activeAttempted ? () => this.writeActiveConnectionId(previousActiveId) : undefined,
          secretAttempted ? () => this.writePassword(
            validated.id,
            connectionsRestored ? previousPassword : undefined
          ) : undefined,
        ]);
      }
      if (shouldActivate) {
        this.hasRememberedActiveConnectionSnapshot = true;
      }
    });
  }

  public async update(
    connection: KxConnection,
    password?: string | null,
    expected?: KxConnection,
    requestedScope?: ConnectionConfigurationScope
  ): Promise<void> {
    return this.mutate(async () => {
      const connections = this.connections();
      this.assertConfigurationWritable();
      const configurationRevision = this.configurationRevision;
      this.assertUnambiguousOwner(connection.id, connection.name, 'edit or move');
      const index = connections.findIndex(item => item.id === connection.id);
      if (index < 0) {
        throw new Error(`KX connection "${connection.name}" no longer exists.`);
      }
      if (expected && !sameConnection(connections[index], expected)) {
        throw new Error(`KX connection "${connection.name}" changed after this form was opened. Reopen it and try again.`);
      }
      const candidate = connection.password === undefined &&
        connections[index].password !== undefined
        ? { ...connection, password: connections[index].password }
        : connection;
      const validated = validateConnection(candidate, connections, connection.id);
      const owner = this.connectionScope(connection.id);
      if (!owner) {
        throw new Error(`KX connection "${connection.name}" has no writable owning settings scope.`);
      }
      const targetScope = this.validateWritableScope(requestedScope || owner);
      const ownerConnections = this.scopeConnections(owner);
      const ownerIndex = ownerConnections.findIndex(item => item.id === connection.id);
      if (ownerIndex < 0) {
        throw new Error(`KX connection "${connection.name}" changed ownership. Reopen it and try again.`);
      }
      if (typeof password === 'string') {
        validatePassword(password);
      }
      const moving = !sameConnectionScope(owner, targetScope);
      const targetConnections = moving
        ? this.scopeConnections(targetScope)
        : ownerConnections;
      const targetIndex = targetConnections.findIndex(item => item.id === connection.id);
      if (moving && targetIndex >= 0) {
        throw new Error(
          `Cannot move KX connection "${connection.name}" to ${connectionScopeLabel(targetScope)} ` +
          `settings because that scope already defines stable ID "${connection.id}". ` +
          'Remove or rename the destination definition first; no settings were changed.'
        );
      }
      const updatedTargetConnections = targetConnections.slice();
      if (targetIndex >= 0) {
        updatedTargetConnections[targetIndex] = validated;
      } else {
        updatedTargetConnections.push(validated);
      }
      const updatedOwnerConnections = moving
        ? ownerConnections.filter(item => item.id !== connection.id)
        : updatedTargetConnections;
      const updatedState = this.stateAfterScopeUpdates([
        { scope: targetScope, connections: updatedTargetConnections },
        ...(moving
          ? [{ scope: owner, connections: updatedOwnerConnections }]
          : []),
      ]);
      const intermediateState = moving
        ? this.stateAfterScopeUpdate(targetScope, updatedTargetConnections)
        : updatedState;
      const passwordChanges = password !== undefined;
      const previousPassword = passwordChanges
        ? await this.context.secrets.get(this.passwordKey(connection.id))
        : undefined;
      let secretAttempted = false;
      let connectionsAttempted = false;
      let connectionsWriteRevision: number | undefined;
      try {
        this.assertConnectionsUnchanged(connections, configurationRevision);
        if (passwordChanges) {
          secretAttempted = true;
          await this.writePassword(connection.id, password === null ? undefined : password);
          this.assertConnectionsUnchanged(connections, configurationRevision);
        }
        this.assertConnectionsUnchanged(connections, configurationRevision);
        connectionsWriteRevision = this.configurationRevision;
        connectionsAttempted = true;
        await this.writeConnections(
          intermediateState,
          updatedTargetConnections,
          targetScope
        );
        if (moving) {
          connectionsWriteRevision = this.configurationRevision;
          await this.writeConnections(
            updatedState,
            updatedOwnerConnections,
            owner
          );
        }
      } catch (error) {
        let connectionsRestored = !connectionsAttempted;
        const canRestoreConnections = connectionsAttempted &&
          connectionsWriteRevision !== undefined &&
          (
            this.connectionSnapshotIsCurrent(connections, connectionsWriteRevision) ||
            (moving && this.connectionSnapshotIsCurrent(
              intermediateState.connections,
              connectionsWriteRevision
            )) ||
            (moving && this.connectionSnapshotIsCurrent(
              updatedState.connections,
              connectionsWriteRevision
            ))
          );
        await this.rethrowAfterRollback(error, [
          canRestoreConnections ? async () => {
            if (moving) {
              await this.writeConnections(
                this.stateAfterScopeUpdate(owner, ownerConnections),
                ownerConnections,
                owner
              );
            }
            await this.writeConnections(
              this.stateAfterScopeUpdate(targetScope, targetConnections),
              targetConnections,
              targetScope
            );
            connectionsRestored = true;
          } : undefined,
          secretAttempted ? () => this.writePassword(
            connection.id,
            connectionsRestored ? previousPassword : undefined
          ) : undefined,
        ]);
      }
    });
  }

  public async remove(id: string, expected?: KxConnection): Promise<void> {
    return this.mutate(async () => {
      const connections = this.connections();
      this.assertConfigurationWritable();
      const configurationRevision = this.configurationRevision;
      this.assertUnambiguousOwner(id, expected?.name, 'remove');
      const existing = connections.find(connection => connection.id === id);
      if (!existing) {
        return;
      }
      if (expected && !sameConnection(existing, expected)) {
        throw new Error(`KX connection "${existing.name}" changed before deletion. Reopen it and try again.`);
      }
      const owner = this.connectionScope(id);
      if (!owner) {
        throw new Error(`KX connection "${existing.name}" has no writable owning settings scope.`);
      }
      const ownerConnections = this.scopeConnections(owner);
      const updatedOwnerConnections = ownerConnections.filter(connection => connection.id !== id);
      const updatedState = this.stateAfterScopeUpdate(owner, updatedOwnerConnections);
      const removeSecret = !updatedState.connections.some(connection => connection.id === id);
      const removedActiveConnection = this.activeConnectionId() === id;
      const previousActiveId = this.activeConnectionIdSnapshot;
      const previousPassword = removeSecret
        ? await this.context.secrets.get(this.passwordKey(id))
        : undefined;
      let secretAttempted = false;
      let activeAttempted = false;
      let connectionsAttempted = false;
      let connectionsWriteRevision: number | undefined;
      try {
        this.assertConnectionsUnchanged(connections, configurationRevision);
        if (removeSecret) {
          secretAttempted = true;
          await this.writePassword(id, undefined);
          this.assertConnectionsUnchanged(connections, configurationRevision);
        }
        if (removedActiveConnection) {
          activeAttempted = true;
          await this.writeActiveConnectionId(undefined);
          this.assertConnectionsUnchanged(connections, configurationRevision);
        }
        this.assertConnectionsUnchanged(connections, configurationRevision);
        connectionsWriteRevision = this.configurationRevision;
        connectionsAttempted = true;
        await this.writeConnections(
          updatedState,
          updatedOwnerConnections,
          owner
        );
      } catch (error) {
        let connectionsRestored = !connectionsAttempted;
        const canRestoreConnections = connectionsAttempted &&
          connectionsWriteRevision !== undefined &&
          this.connectionSnapshotIsCurrent(connections, connectionsWriteRevision);
        await this.rethrowAfterRollback(error, [
          canRestoreConnections ? async () => {
            await this.writeConnections(
              this.stateAfterScopeUpdate(owner, ownerConnections),
              ownerConnections,
              owner
            );
            connectionsRestored = true;
          } : undefined,
          activeAttempted ? () => this.writeActiveConnectionId(previousActiveId) : undefined,
          secretAttempted ? () => this.writePassword(
            id,
            connectionsRestored ? previousPassword : undefined
          ) : undefined,
        ]);
      }
    });
  }

  public async password(id: string): Promise<string | undefined> {
    return (await this.resolvePassword(id)).password;
  }

  public async resolvePassword(id: string): Promise<ResolvedConnectionPassword> {
    const secret = await this.context.secrets.get(this.passwordKey(id));
    if (secret !== undefined) {
      return { password: secret, source: 'secretStorage' };
    }
    const configured = this.connection(id)?.password;
    return configured === undefined
      ? { password: undefined, source: 'none' }
      : { password: configured, source: 'configuration' };
  }

  public async hasPassword(id: string): Promise<boolean> {
    return (await this.password(id)) !== undefined;
  }

  public async hasStoredPassword(id: string): Promise<boolean> {
    return (await this.resolvePassword(id)).source === 'secretStorage';
  }

  private async mutate<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue;
    let release!: () => void;
    this.mutationQueue = new Promise(resolve => {
      release = resolve;
    });
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  }

  private async writePassword(id: string, password: string | undefined): Promise<void> {
    if (password !== undefined) {
      await this.context.secrets.store(this.passwordKey(id), password);
    } else {
      await this.context.secrets.delete(this.passwordKey(id));
    }
  }

  private async writeActiveConnectionId(id: string | undefined): Promise<void> {
    await this.context.globalState.update(ACTIVE_CONNECTION_KEY, id);
    this.activeConnectionIdSnapshot = id;
  }

  private assertConnectionsUnchanged(
    expected: readonly KxConnection[],
    expectedRevision: number
  ): void {
    if (!this.connectionSnapshotIsCurrent(expected, expectedRevision)) {
      throw new Error(
        'KX connection settings changed while this operation was in progress. Reopen it and try again.'
      );
    }
  }

  private assertConfigurationWritable(): void {
    if (this.configurationMutationBlockedUntilFingerprint !== undefined) {
      throw new Error(
        'KX connection settings are still reconciling after a delayed configuration event. Wait for the last saved value to appear; if it does not, run Developer: Reload Window before changing profiles.'
      );
    }
  }

  private connectionSnapshotIsCurrent(
    expected: readonly KxConnection[],
    expectedRevision: number
  ): boolean {
    const current = this.connections();
    return this.configurationMutationBlockedUntilFingerprint === undefined &&
      this.configurationRevision === expectedRevision &&
      sameConnectionLists(current, expected);
  }

  private async rethrowAfterRollback(
    error: unknown,
    rollbacks: Array<(() => PromiseLike<unknown>) | undefined>
  ): Promise<never> {
    let rollbackFailed = false;
    for (const rollback of rollbacks) {
      if (!rollback) {
        continue;
      }
      try {
        await rollback();
      } catch {
        rollbackFailed = true;
      }
    }
    const original = error instanceof Error ? error : new Error(String(error));
    if (rollbackFailed) {
      throw new Error(`${original.message} KX could not fully restore the previous connection state.`);
    }
    throw original;
  }

  private async writeConnections(
    logicalState: MergedConnectionConfiguration,
    scopeConnections: readonly KxConnection[],
    scope: ConnectionConfigurationScope
  ): Promise<void> {
    const safeConnections: KxConnection[] = scopeConnections.map(connection => ({
      id: connection.id,
      name: connection.name,
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      ...(connection.password === undefined
        ? {}
        : { password: connection.password }),
      ...(connection.connectTimeoutMs === undefined
        ? {}
        : { connectTimeoutMs: connection.connectTimeoutMs }),
      ...(connection.queryTimeoutMs === undefined
        ? {}
        : { queryTimeoutMs: connection.queryTimeoutMs }),
    }));
    const safeLogicalState: MergedConnectionConfiguration = {
      connections: cloneConnections(logicalState.connections),
      owners: cloneOwners(logicalState.owners),
      conflicts: logicalState.conflicts.map(conflict => ({
        id: conflict.id,
        scopes: conflict.scopes.map(value => ({ ...value })),
      })),
    };
    const safeFingerprint = mergedConnectionFingerprint(safeLogicalState);
    const configuredSourcesBeforeWrite = this.configurationSources();
    const configuredBeforeWrite = mergedConnectionFingerprint(
      mergeConnectionConfigurations(configuredSourcesBeforeWrite)
    );
    const configuredScopeBeforeWrite = scopeConnectionsFromSources(
      configuredSourcesBeforeWrite,
      scope
    );
    const optimisticBeforeWrite = this.optimisticConnections;
    const knownBeforeWriteFingerprints = [
      configuredBeforeWrite,
      ...(optimisticBeforeWrite
        ? [
            optimisticBeforeWrite.observedConfigurationFingerprint,
            ...optimisticBeforeWrite.pendingWriteFingerprints,
          ]
        : []),
    ];
    const inFlight: InFlightConnectionWrite = {
      targetFingerprint: safeFingerprint,
      targetWasAlreadyObservable:
        knownBeforeWriteFingerprints.includes(safeFingerprint),
      knownBeforeWriteFingerprints,
      sawConfigurationEvent: false,
      targetObserved: false,
      supersededAfterTarget: false,
    };
    this.inFlightConnectionWrite = inFlight;
    try {
      await this.configurationForScope(scope).update(
        CONNECTIONS_SETTING,
        safeConnections,
        configurationTarget(scope)
      );
      // A resolved update is the persistence acknowledgement. Keep the latest logical
      // value while VS Code's effective configuration snapshot catches up. If VS Code
      // already exposed our target and then a different value before resolving, that
      // later configuration event is authoritative.
      const configuredAfterState = this.configuredState();
      const configuredAfterFingerprint =
        mergedConnectionFingerprint(configuredAfterState);
      if (inFlight.supersededAfterTarget &&
          configuredAfterFingerprint !== safeFingerprint) {
        this.optimisticConnections = undefined;
        this.lastEffectiveConfigurationFingerprint = configuredAfterFingerprint;
        this.configurationMutationBlockedUntilFingerprint = undefined;
        throw new Error(
          'KX connection settings changed after this save was written. Reopen it and try again.'
        );
      }
      const optimisticAfterWrite = this.optimisticConnections;
      const optimismToCompose = optimisticAfterWrite ?? optimisticBeforeWrite;
      const ambiguousDuringWrite = inFlight.sawConfigurationEvent &&
        configuredAfterFingerprint !== safeFingerprint;
      this.optimisticConnections = {
        value: cloneConnections(safeLogicalState.connections),
        owners: cloneOwners(safeLogicalState.owners),
        scopeValues: withScopeValue(
          optimismToCompose?.scopeValues,
          scope,
          safeConnections
        ),
        knownScopeValueFingerprints: withKnownScopeValueFingerprints(
          optimismToCompose?.knownScopeValueFingerprints,
          scope,
          configuredScopeBeforeWrite,
          safeConnections
        ),
        pendingWriteFingerprints: [
          ...(optimismToCompose?.pendingWriteFingerprints ?? []),
          safeFingerprint,
        ],
        observedConfigurationFingerprint:
          optimisticAfterWrite?.observedConfigurationFingerprint ??
          configuredAfterFingerprint,
        ...(ambiguousDuringWrite
          ? { expiresAt: Date.now() + OPTIMISTIC_CONNECTIONS_TTL_MS }
          : {}),
      };
      this.configurationMutationBlockedUntilFingerprint = undefined;
    } finally {
      if (this.inFlightConnectionWrite === inFlight) {
        this.inFlightConnectionWrite = undefined;
      }
    }
  }

  private reconcileConfigurationChange(): void {
    const configuredSources = this.configurationSources();
    const configuredState = mergeConnectionConfigurations(configuredSources);
    const configured = configuredState.connections;
    const configuredFingerprint = mergedConnectionFingerprint(configuredState);
    const inFlight = this.inFlightConnectionWrite;
    if (inFlight) {
      inFlight.sawConfigurationEvent = true;
      if (!inFlight.targetWasAlreadyObservable) {
        if (configuredFingerprint === inFlight.targetFingerprint) {
          inFlight.targetObserved = true;
          inFlight.supersededAfterTarget = false;
        } else if (inFlight.targetObserved &&
            !inFlight.knownBeforeWriteFingerprints.includes(configuredFingerprint)) {
          inFlight.supersededAfterTarget = true;
        }
      }
    }
    const optimistic = this.optimisticConnections;
    if (!optimistic) {
      if (configuredFingerprint !== this.lastEffectiveConfigurationFingerprint) {
        this.lastEffectiveConfigurationFingerprint = configuredFingerprint;
        if (configuredFingerprint === this.configurationMutationBlockedUntilFingerprint) {
          this.configurationMutationBlockedUntilFingerprint = undefined;
        }
        this.configurationRevision++;
      }
      return;
    }
    this.lastEffectiveConfigurationFingerprint = configuredFingerprint;
    if (optimistic.yieldToConfigured) {
      this.configurationMutationBlockedUntilFingerprint =
        sameConnectionLists(configured, optimistic.value)
          ? undefined
          : connectionListFingerprint(optimistic.value);
    }
    if (configuredFingerprint === optimistic.observedConfigurationFingerprint) {
      this.optimisticConnections = {
        ...optimistic,
        ...(optimistic.yieldToConfigured
          ? {}
          : { expiresAt: Date.now() + OPTIMISTIC_CONNECTIONS_TTL_MS }),
      };
      return;
    }
    const pendingIndex = optimistic.pendingWriteFingerprints.indexOf(configuredFingerprint);
    if (pendingIndex >= 0) {
      const remaining = optimistic.pendingWriteFingerprints.slice(pendingIndex + 1);
      if (remaining.length === 0 &&
          sameConnectionLists(configured, optimistic.value)) {
        this.optimisticConnections = undefined;
        this.configurationMutationBlockedUntilFingerprint = undefined;
        return;
      }
      this.optimisticConnections = {
        ...optimistic,
        pendingWriteFingerprints: remaining,
        observedConfigurationFingerprint: configuredFingerprint,
        ...(optimistic.yieldToConfigured
          ? {}
          : { expiresAt: Date.now() + OPTIMISTIC_CONNECTIONS_TTL_MS }),
      };
      return;
    }
    if (optimisticConfigurationIsKnown(optimistic, configuredSources)) {
      this.optimisticConnections = {
        ...optimistic,
        ...(optimistic.yieldToConfigured
          ? {}
          : { expiresAt: Date.now() + OPTIMISTIC_CONNECTIONS_TTL_MS }),
      };
      return;
    }
    // A configuration event that does not expose one of our resolved intermediate writes
    // is an external/current setting and must supersede the optimistic value immediately.
    this.optimisticConnections = undefined;
    this.configurationMutationBlockedUntilFingerprint = undefined;
    if (!sameConnectionLists(configured, optimistic.value)) {
      this.configurationRevision++;
    }
  }

  private passwordKey(id: string): string {
    return `${PASSWORD_SECRET_PREFIX}${id}`;
  }

  private configurationSources(): ConnectionConfigurationSources {
    const base = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
    const inspected = base.inspect<unknown>(CONNECTIONS_SETTING);
    const folders = [...(vscode.workspace.workspaceFolders || [])]
      .sort((left, right) => left.uri.toString().localeCompare(right.uri.toString()));
    return {
      global: inspected
        ? inspected.globalValue
        : base.get<unknown>(CONNECTIONS_SETTING),
      workspace: inspected?.workspaceValue,
      workspaceFolders: folders.map(folder => ({
        folderUri: folder.uri.toString(),
        value: vscode.workspace
          .getConfiguration(CONFIGURATION_SECTION, folder.uri)
          .inspect<unknown>(CONNECTIONS_SETTING)
          ?.workspaceFolderValue,
      })),
    };
  }

  private scopeConnections(scope: ConnectionConfigurationScope): KxConnection[] {
    const optimistic = this.optimisticConnections?.scopeValues.get(
      connectionScopeKey(scope)
    );
    if (optimistic) {
      return cloneConnections(optimistic);
    }
    const sources = this.configurationSources();
    if (scope.kind === 'global') {
      return safeStoredConnections(sources.global);
    }
    if (scope.kind === 'workspace') {
      return safeStoredConnections(sources.workspace);
    }
    return safeStoredConnections(
      sources.workspaceFolders.find(folder => folder.folderUri === scope.folderUri)?.value
    );
  }

  private allConfiguredConnections(): KxConnection[] {
    const sources = this.logicalConfigurationSources();
    return [
      ...safeStoredConnections(sources.global),
      ...safeStoredConnections(sources.workspace),
      ...sources.workspaceFolders.flatMap(folder => safeStoredConnections(folder.value)),
    ];
  }

  private stateAfterScopeUpdate(
    scope: ConnectionConfigurationScope,
    connections: readonly KxConnection[]
  ): MergedConnectionConfiguration {
    return this.stateAfterScopeUpdates([{ scope, connections }]);
  }

  private stateAfterScopeUpdates(
    updates: readonly {
      scope: ConnectionConfigurationScope;
      connections: readonly KxConnection[];
    }[]
  ): MergedConnectionConfiguration {
    const sources = this.logicalConfigurationSources();
    const next: ConnectionConfigurationSources = {
      global: safeStoredConnections(sources.global),
      workspace: safeStoredConnections(sources.workspace),
      workspaceFolders: sources.workspaceFolders.map(folder => ({
        folderUri: folder.folderUri,
        value: safeStoredConnections(folder.value),
      })),
    };
    for (const update of updates) {
      const value = cloneConnections(update.connections);
      if (update.scope.kind === 'global') {
        next.global = value;
      } else if (update.scope.kind === 'workspace') {
        next.workspace = value;
      } else {
        const folder = next.workspaceFolders.find(
          candidate => candidate.folderUri === update.scope.folderUri
        );
        if (folder) {
          folder.value = value;
        }
      }
    }
    return mergeConnectionConfigurations(next);
  }

  private validateWritableScope(
    scope: ConnectionConfigurationScope
  ): ConnectionConfigurationScope {
    const match = this.availableConnectionScopes().find(candidate =>
      sameConnectionScope(candidate, scope)
    );
    if (!match) {
      throw new Error(
        scope.kind === 'workspaceFolder'
          ? 'The selected workspace folder is no longer open.'
          : 'The selected KX connection settings scope is unavailable in this window.'
      );
    }
    return { ...match };
  }

  private configurationForScope(
    scope: ConnectionConfigurationScope
  ): vscode.WorkspaceConfiguration {
    if (scope.kind !== 'workspaceFolder') {
      return vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
    }
    const folder = (vscode.workspace.workspaceFolders || []).find(
      candidate => candidate.uri.toString() === scope.folderUri
    );
    if (!folder) {
      throw new Error('The selected workspace folder is no longer open.');
    }
    return vscode.workspace.getConfiguration(CONFIGURATION_SECTION, folder.uri);
  }

  private configuredState(): MergedConnectionConfiguration {
    return mergeConnectionConfigurations(this.configurationSources());
  }

  private optimisticState(): MergedConnectionConfiguration {
    const optimistic = this.optimisticConnections;
    return optimistic
      ? {
          connections: cloneConnections(optimistic.value),
          owners: cloneOwners(optimistic.owners),
          conflicts: mergeConnectionConfigurations(
            this.logicalConfigurationSources()
          ).conflicts,
        }
      : this.configuredState();
  }

  private logicalConfigurationSources(): ConnectionConfigurationSources {
    const sources = this.configurationSources();
    const optimistic = this.optimisticConnections;
    if (!optimistic) {
      return sources;
    }
    return overlayScopeValues(sources, optimistic.scopeValues);
  }

  private assertUnambiguousOwner(
    id: string,
    name: string | undefined,
    action: string
  ): void {
    const conflict = this.connectionScopeConflicts().find(candidate => candidate.id === id);
    if (!conflict) {
      return;
    }
    const profile = name ? `"${name}"` : `with stable ID "${id}"`;
    throw new Error(
      `Cannot ${action} KX connection ${profile} because multiple workspace folders define ` +
      `stable ID "${id}" (${conflict.scopes.map(connectionScopeLabel).join(', ')}). ` +
      'Remove the duplicate ID from all but one workspace-folder setting, then try again.'
    );
  }
}

function cloneConnections(connections: readonly KxConnection[]): KxConnection[] {
  return connections.map(connection => ({ ...connection }));
}

function cloneOwners(
  owners: ReadonlyMap<string, ConnectionConfigurationScope>
): Map<string, ConnectionConfigurationScope> {
  return new Map(
    [...owners].map(([id, scope]) => [id, { ...scope }])
  );
}

function withScopeValue(
  previous: ReadonlyMap<string, readonly KxConnection[]> | undefined,
  scope: ConnectionConfigurationScope,
  connections: readonly KxConnection[]
): Map<string, readonly KxConnection[]> {
  const values = new Map(previous || []);
  values.set(connectionScopeKey(scope), cloneConnections(connections));
  return values;
}

function withKnownScopeValueFingerprints(
  previous: ReadonlyMap<string, readonly string[]> | undefined,
  scope: ConnectionConfigurationScope,
  configuredBeforeWrite: readonly KxConnection[],
  writtenConnections: readonly KxConnection[]
): Map<string, readonly string[]> {
  const values = new Map(previous || []);
  const key = connectionScopeKey(scope);
  const known = [
    ...(values.get(key) || []),
    connectionListFingerprint(configuredBeforeWrite),
    connectionListFingerprint(writtenConnections),
  ];
  values.set(key, [...new Set(known)]);
  return values;
}

function overlayScopeValues(
  sources: ConnectionConfigurationSources,
  scopeValues: ReadonlyMap<string, readonly KxConnection[]>
): ConnectionConfigurationSources {
  const next: ConnectionConfigurationSources = {
    global: safeStoredConnections(sources.global),
    workspace: safeStoredConnections(sources.workspace),
    workspaceFolders: sources.workspaceFolders.map(folder => ({
      folderUri: folder.folderUri,
      value: safeStoredConnections(folder.value),
    })),
  };
  for (const [key, connections] of scopeValues) {
    const value = cloneConnections(connections);
    if (key === 'global') {
      next.global = value;
    } else if (key === 'workspace') {
      next.workspace = value;
    } else if (key.startsWith('workspaceFolder:')) {
      const folderUri = key.slice('workspaceFolder:'.length);
      const folder = next.workspaceFolders.find(candidate => candidate.folderUri === folderUri);
      if (folder) {
        folder.value = value;
      }
    }
  }
  return next;
}

function scopeConnectionsFromSources(
  sources: ConnectionConfigurationSources,
  scope: ConnectionConfigurationScope
): KxConnection[] {
  if (scope.kind === 'global') {
    return safeStoredConnections(sources.global);
  }
  if (scope.kind === 'workspace') {
    return safeStoredConnections(sources.workspace);
  }
  return safeStoredConnections(
    sources.workspaceFolders.find(folder => folder.folderUri === scope.folderUri)?.value
  );
}

function optimisticConfigurationIsKnown(
  optimistic: OptimisticConnections,
  configuredSources: ConnectionConfigurationSources
): boolean {
  for (const [key, knownFingerprints] of optimistic.knownScopeValueFingerprints) {
    const scope = connectionScopeFromKey(key);
    if (!scope || !knownFingerprints.includes(
      connectionListFingerprint(scopeConnectionsFromSources(configuredSources, scope))
    )) {
      return false;
    }
  }
  const overlaidFingerprint = mergedConnectionFingerprint(
    mergeConnectionConfigurations(
      overlayScopeValues(configuredSources, optimistic.scopeValues)
    )
  );
  return overlaidFingerprint === optimistic.observedConfigurationFingerprint ||
    optimistic.pendingWriteFingerprints.includes(overlaidFingerprint);
}

function connectionScopeFromKey(key: string): ConnectionConfigurationScope | undefined {
  if (key === 'global' || key === 'workspace') {
    return { kind: key };
  }
  if (key.startsWith('workspaceFolder:')) {
    return {
      kind: 'workspaceFolder',
      folderUri: key.slice('workspaceFolder:'.length),
    };
  }
  return undefined;
}

export function mergeConnectionConfigurations(
  sources: ConnectionConfigurationSources
): MergedConnectionConfiguration {
  const connectionsById = new Map<string, KxConnection>();
  const owners = new Map<string, ConnectionConfigurationScope>();
  const conflicts: ConnectionScopeConflict[] = [];
  const apply = (
    values: readonly KxConnection[],
    scope: ConnectionConfigurationScope
  ): void => {
    values.forEach(connection => {
      connectionsById.set(connection.id, { ...connection });
      owners.set(connection.id, { ...scope });
    });
  };

  apply(safeStoredConnections(sources.global), { kind: 'global' });
  apply(safeStoredConnections(sources.workspace), { kind: 'workspace' });

  const folderCandidates = new Map<
    string,
    Array<{ connection: KxConnection; scope: ConnectionConfigurationScope }>
  >();
  [...sources.workspaceFolders]
    .sort((left, right) => left.folderUri.localeCompare(right.folderUri))
    .forEach(folder => {
      safeStoredConnections(folder.value).forEach(connection => {
        const candidates = folderCandidates.get(connection.id) || [];
        candidates.push({
          connection,
          scope: { kind: 'workspaceFolder', folderUri: folder.folderUri },
        });
        folderCandidates.set(connection.id, candidates);
      });
    });
  for (const [id, candidates] of folderCandidates) {
    if (candidates.length > 1) {
      connectionsById.delete(id);
      owners.delete(id);
      conflicts.push({
        id,
        scopes: candidates.map(candidate => ({ ...candidate.scope })),
      });
      continue;
    }
    const first = candidates[0];
    connectionsById.set(id, { ...first.connection });
    owners.set(id, { ...first.scope });
  }

  return {
    connections: [...connectionsById.values()],
    owners,
    conflicts,
  };
}

export function connectionScopeLabel(scope: ConnectionConfigurationScope): string {
  if (scope.kind === 'global') {
    return 'User';
  }
  if (scope.kind === 'workspace') {
    return 'Workspace / project';
  }
  const folder = scope.folderUri ? decodeFolderLabel(scope.folderUri) : 'folder';
  return `Workspace folder: ${folder}`;
}

function decodeFolderLabel(folderUri: string): string {
  try {
    const parsed = vscode.Uri.parse(folderUri);
    const path = parsed.path.replace(/\/+$/, '');
    return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1)) || folderUri;
  } catch {
    return folderUri;
  }
}

function configurationTarget(
  scope: ConnectionConfigurationScope
): vscode.ConfigurationTarget {
  if (scope.kind === 'workspace') {
    return vscode.ConfigurationTarget.Workspace;
  }
  if (scope.kind === 'workspaceFolder') {
    return vscode.ConfigurationTarget.WorkspaceFolder;
  }
  return vscode.ConfigurationTarget.Global;
}

function connectionScopeKey(scope: ConnectionConfigurationScope): string {
  return scope.kind === 'workspaceFolder'
    ? `${scope.kind}:${scope.folderUri || ''}`
    : scope.kind;
}

function sameConnectionScope(
  left: ConnectionConfigurationScope,
  right: ConnectionConfigurationScope
): boolean {
  return left.kind === right.kind &&
    (left.kind !== 'workspaceFolder' || left.folderUri === right.folderUri);
}

function mergedConnectionFingerprint(state: MergedConnectionConfiguration): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      connections: state.connections,
      owners: [...state.owners].map(([id, scope]) => [id, scope]),
      conflicts: state.conflicts,
    }))
    .digest('hex');
}

function connectionListFingerprint(connections: readonly KxConnection[]): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(connections))
    .digest('hex');
}

function sameConnection(left: KxConnection, right: KxConnection): boolean {
  return left.id === right.id && left.name === right.name && left.host === right.host &&
    left.port === right.port && left.database === right.database && left.username === right.username &&
    left.password === right.password &&
    left.connectTimeoutMs === right.connectTimeoutMs && left.queryTimeoutMs === right.queryTimeoutMs;
}

function sameConnectionLists(
  left: readonly KxConnection[],
  right: readonly KxConnection[]
): boolean {
  return left.length === right.length && left.every((connection, index) =>
    sameConnection(connection, right[index]));
}
