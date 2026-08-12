import { KxConnection } from './connection';

export interface QueryConnectionSelectionActions {
  chooseConnection(): Promise<KxConnection | undefined>;
}

export class QueryConnectionSelectionSession {
  private inFlightSelection: Promise<KxConnection | undefined> | undefined;

  public async resolve(
    activeConnection: KxConnection | undefined,
    connections: readonly KxConnection[],
    _hasRememberedTarget: boolean,
    actions: QueryConnectionSelectionActions
  ): Promise<KxConnection | undefined> {
    if (activeConnection) {
      return activeConnection;
    }
    if (!connections.length) {
      return undefined;
    }
    return this.select(actions);
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
