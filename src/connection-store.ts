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

interface OptimisticConnections {
  readonly value: readonly KxConnection[];
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
  private configurationRevision = 0;
  private lastEffectiveConfigurationFingerprint: string;
  private configurationMutationBlockedUntilFingerprint: string | undefined;
  private inFlightConnectionWrite: InFlightConnectionWrite | undefined;

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.activeConnectionIdSnapshot = context.globalState.get<string>(ACTIVE_CONNECTION_KEY);
    this.lastEffectiveConfigurationFingerprint =
      connectionListFingerprint(this.configuredConnections());
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration(`${CONFIGURATION_SECTION}.${CONNECTIONS_SETTING}`)) {
        this.reconcileConfigurationChange();
      }
    }));
  }

  public connections(): KxConnection[] {
    const configured = this.configuredConnections();
    const configuredFingerprint = connectionListFingerprint(configured);
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
      optimistic.pendingWriteFingerprints.includes(configuredFingerprint);
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

  public activeConnectionId(): string | undefined {
    const id = this.activeConnectionIdSnapshot;
    return id && this.connection(id) ? id : undefined;
  }

  public activeConnection(): KxConnection | undefined {
    const id = this.activeConnectionId();
    return id ? this.connection(id) : undefined;
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
    });
  }

  public newConnectionId(): string {
    return `kx-${crypto.randomBytes(12).toString('hex')}`;
  }

  public async add(connection: KxConnection, password?: string): Promise<void> {
    return this.mutate(async () => {
      const connections = this.connections();
      this.assertConfigurationWritable();
      const configurationRevision = this.configurationRevision;
      const validated = validateConnection(connection, connections);
      if (password !== undefined) {
        validatePassword(password);
      }
      const passwordChanges = password !== undefined;
      const previousPassword = passwordChanges ? await this.password(validated.id) : undefined;
      const previousActiveId = this.activeConnectionIdSnapshot;
      const shouldActivate = !this.activeConnectionId();
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
        await this.writeConnections([...connections, validated]);
      } catch (error) {
        let connectionsRestored = !connectionsAttempted;
        const canRestoreConnections = connectionsAttempted &&
          connectionsWriteRevision !== undefined &&
          this.connectionSnapshotIsCurrent(connections, connectionsWriteRevision);
        await this.rethrowAfterRollback(error, [
          canRestoreConnections ? async () => {
            await this.writeConnections(connections);
            connectionsRestored = true;
          } : undefined,
          activeAttempted ? () => this.writeActiveConnectionId(previousActiveId) : undefined,
          secretAttempted ? () => this.writePassword(
            validated.id,
            connectionsRestored ? previousPassword : undefined
          ) : undefined,
        ]);
      }
    });
  }

  public async update(
    connection: KxConnection,
    password?: string | null,
    expected?: KxConnection
  ): Promise<void> {
    return this.mutate(async () => {
      const connections = this.connections();
      this.assertConfigurationWritable();
      const configurationRevision = this.configurationRevision;
      const index = connections.findIndex(item => item.id === connection.id);
      if (index < 0) {
        throw new Error(`KX connection "${connection.name}" no longer exists.`);
      }
      if (expected && !sameConnection(connections[index], expected)) {
        throw new Error(`KX connection "${connection.name}" changed after this form was opened. Reopen it and try again.`);
      }
      const validated = validateConnection(connection, connections, connection.id);
      if (typeof password === 'string') {
        validatePassword(password);
      }
      const updated = connections.slice();
      updated[index] = validated;
      const passwordChanges = password !== undefined;
      const previousPassword = passwordChanges ? await this.password(connection.id) : undefined;
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
        await this.writeConnections(updated);
      } catch (error) {
        let connectionsRestored = !connectionsAttempted;
        const canRestoreConnections = connectionsAttempted &&
          connectionsWriteRevision !== undefined &&
          this.connectionSnapshotIsCurrent(connections, connectionsWriteRevision);
        await this.rethrowAfterRollback(error, [
          canRestoreConnections ? async () => {
            await this.writeConnections(connections);
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
      const existing = connections.find(connection => connection.id === id);
      if (!existing) {
        return;
      }
      if (expected && !sameConnection(existing, expected)) {
        throw new Error(`KX connection "${existing.name}" changed before deletion. Reopen it and try again.`);
      }
      const updated = connections.filter(connection => connection.id !== id);
      const removedActiveConnection = this.activeConnectionId() === id;
      const previousActiveId = this.activeConnectionIdSnapshot;
      const previousPassword = await this.password(id);
      let secretAttempted = false;
      let activeAttempted = false;
      let connectionsAttempted = false;
      let connectionsWriteRevision: number | undefined;
      try {
        this.assertConnectionsUnchanged(connections, configurationRevision);
        secretAttempted = true;
        await this.writePassword(id, undefined);
        this.assertConnectionsUnchanged(connections, configurationRevision);
        if (removedActiveConnection) {
          activeAttempted = true;
          await this.writeActiveConnectionId(undefined);
          this.assertConnectionsUnchanged(connections, configurationRevision);
        }
        this.assertConnectionsUnchanged(connections, configurationRevision);
        connectionsWriteRevision = this.configurationRevision;
        connectionsAttempted = true;
        await this.writeConnections(updated);
      } catch (error) {
        let connectionsRestored = !connectionsAttempted;
        const canRestoreConnections = connectionsAttempted &&
          connectionsWriteRevision !== undefined &&
          this.connectionSnapshotIsCurrent(connections, connectionsWriteRevision);
        await this.rethrowAfterRollback(error, [
          canRestoreConnections ? async () => {
            await this.writeConnections(connections);
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
    return this.context.secrets.get(this.passwordKey(id));
  }

  public async hasPassword(id: string): Promise<boolean> {
    return (await this.password(id)) !== undefined;
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
    if (password) {
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

  private async writeConnections(connections: readonly KxConnection[]): Promise<void> {
    const safeConnections: KxConnection[] = connections.map(connection => ({
      id: connection.id,
      name: connection.name,
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      ...(connection.connectTimeoutMs === undefined
        ? {}
        : { connectTimeoutMs: connection.connectTimeoutMs }),
      ...(connection.queryTimeoutMs === undefined
        ? {}
        : { queryTimeoutMs: connection.queryTimeoutMs }),
    }));
    const safeFingerprint = connectionListFingerprint(safeConnections);
    const configuredBeforeWrite =
      connectionListFingerprint(this.configuredConnections());
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
      await vscode.workspace.getConfiguration(CONFIGURATION_SECTION).update(
        CONNECTIONS_SETTING,
        safeConnections,
        vscode.ConfigurationTarget.Global
      );
      // A resolved update is the persistence acknowledgement. Keep the latest logical
      // value while VS Code's effective configuration snapshot catches up. If VS Code
      // already exposed our target and then a different value before resolving, that
      // later configuration event is authoritative.
      const configuredAfterWrite = this.configuredConnections();
      const configuredAfterFingerprint =
        connectionListFingerprint(configuredAfterWrite);
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
      const ambiguousDuringWrite = inFlight.sawConfigurationEvent &&
        configuredAfterFingerprint !== safeFingerprint;
      this.optimisticConnections = {
        value: cloneConnections(safeConnections),
        pendingWriteFingerprints: [
          ...(optimisticAfterWrite?.pendingWriteFingerprints ?? []),
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
    const configured = this.configuredConnections();
    const configuredFingerprint = connectionListFingerprint(configured);
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

  private configuredConnections(): KxConnection[] {
    return safeStoredConnections(
      vscode.workspace
        .getConfiguration(CONFIGURATION_SECTION)
        .get<unknown>(CONNECTIONS_SETTING)
    );
  }
}

function cloneConnections(connections: readonly KxConnection[]): KxConnection[] {
  return connections.map(connection => ({ ...connection }));
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
    left.connectTimeoutMs === right.connectTimeoutMs && left.queryTimeoutMs === right.queryTimeoutMs;
}

function sameConnectionLists(
  left: readonly KxConnection[],
  right: readonly KxConnection[]
): boolean {
  return left.length === right.length && left.every((connection, index) =>
    sameConnection(connection, right[index]));
}
