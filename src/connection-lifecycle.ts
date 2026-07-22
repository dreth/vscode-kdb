import { connectionSessionChanged, KxConnection } from './connection';

export interface ConnectionLifecycleManager {
  isConnected(connectionId: string): boolean;
  connect(connection: KxConnection): Promise<unknown>;
  disconnect(connectionId: string): Promise<void>;
}

export type ConnectionUpdateSessionState =
  | 'unchanged'
  | 'disconnected'
  | 'reconnected'
  | 'reconnect-failed';

export interface ConnectionUpdateOutcome {
  sessionState: ConnectionUpdateSessionState;
  error?: Error;
}

export async function persistConnectionUpdate(
  manager: ConnectionLifecycleManager,
  previous: KxConnection,
  next: KxConnection,
  passwordChanged: boolean,
  persist: () => Promise<void>
): Promise<ConnectionUpdateOutcome> {
  const wasConnected = manager.isConnected(previous.id);
  await persist();

  if (!connectionSessionChanged(previous, next, passwordChanged)) {
    return { sessionState: 'unchanged' };
  }

  try {
    await manager.disconnect(previous.id);
    if (!wasConnected) {
      return { sessionState: 'disconnected' };
    }
    await manager.connect(next);
    return { sessionState: 'reconnected' };
  } catch (error) {
    return {
      sessionState: 'reconnect-failed',
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
