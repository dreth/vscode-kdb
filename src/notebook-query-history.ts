import type { DirectQNotebookBridge } from './notebook-controller';
import type { QueryHistoryCapture } from './query-history';
import type { QueryHistoryRecordInput, QueryHistoryStatus } from './query-history-model';

export interface NotebookHistoryAdapter {
  capture(): QueryHistoryCapture | undefined;
  record(
    capture: QueryHistoryCapture | undefined,
    input: QueryHistoryRecordInput
  ): Promise<void>;
}

export async function executeNotebookScriptWithHistory(
  executeScript: DirectQNotebookBridge['executeScript'],
  history: NotebookHistoryAdapter | undefined,
  ...args: Parameters<DirectQNotebookBridge['executeScript']>
): ReturnType<DirectQNotebookBridge['executeScript']> {
  const [connection, source, onIssued, signal, shouldIssue] = args;
  const capture = history?.capture();
  let issued = false;
  let issuedAt = 0;
  const markIssued = () => {
    if (!issued) {
      issued = true;
      issuedAt = Date.now();
    }
    onIssued();
  };
  const record = async (status: QueryHistoryStatus): Promise<void> => {
    if (!issued || !capture || !history) return;
    try {
      await history.record(capture, {
        connectionId: connection.id,
        connectionName: connection.name,
        timestamp: issuedAt,
        kind: 'notebook',
        status,
        durationMs: Date.now() - issuedAt,
        queryText: source,
      });
    } catch {
      // Query History is observational and must never alter notebook execution.
    }
  };
  try {
    const value = await executeScript(connection, source, markIssued, signal, shouldIssue);
    await record(signal.aborted ? 'canceled' : 'succeeded');
    return value;
  } catch (error) {
    await record(signal.aborted ? 'canceled' : 'failed');
    throw error;
  }
}
