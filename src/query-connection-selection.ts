import { KxConnection } from './connection';

export interface QueryConnectionSelectionActions {
  chooseConnection(): Promise<KxConnection | undefined>;
  activateConnection(connection: KxConnection): Promise<void>;
}

export class QueryConnectionSelectionSession {
  private inFlightSelection: Promise<KxConnection | undefined> | undefined;

  public async resolve(
    activeConnection: KxConnection | undefined,
    connections: readonly KxConnection[],
    hasRememberedTarget: boolean,
    actions: QueryConnectionSelectionActions
  ): Promise<KxConnection | undefined> {
    if (activeConnection) {
      return activeConnection;
    }
    if (!connections.length) {
      return undefined;
    }
    if (connections.length > 1 || hasRememberedTarget) {
      return this.select(actions);
    }
    const connection = connections[0];
    await actions.activateConnection(connection);
    return connection;
  }

  private async select(
    actions: QueryConnectionSelectionActions
  ): Promise<KxConnection | undefined> {
    if (this.inFlightSelection) {
      return this.inFlightSelection;
    }
    const selection = actions.chooseConnection();
    this.inFlightSelection = selection;
    try {
      return await selection;
    } finally {
      if (this.inFlightSelection === selection) {
        this.inFlightSelection = undefined;
      }
    }
  }
}
