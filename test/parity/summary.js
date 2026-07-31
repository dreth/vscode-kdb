'use strict';

const STATUS_ORDER = ['PASS', 'DIFFERENT_BY_DESIGN', 'GAP', 'NOT_TESTABLE_HERE'];
const MODE_ORDER = ['deterministic', 'live-q', 'boundary'];

function buildSummary(outcomes, assertionCount) {
  if (!Number.isInteger(assertionCount) || assertionCount < 0) {
    throw new Error('Parity assertionCount must be a non-negative integer.');
  }

  const byStatus = Object.fromEntries(STATUS_ORDER.map(status => [status, 0]));
  const byMode = Object.fromEntries(MODE_ORDER.map(mode => [mode, 0]));
  const ids = new Set();
  let unexpectedCount = 0;

  for (const outcome of outcomes) {
    if (!outcome.id || ids.has(outcome.id)) {
      throw new Error(`Parity case IDs must be non-empty and unique: ${outcome.id || '<empty>'}`);
    }
    ids.add(outcome.id);
    if (!Object.prototype.hasOwnProperty.call(byStatus, outcome.status)) {
      throw new Error(`Unknown parity status for ${outcome.id}: ${outcome.status}`);
    }
    if (!Object.prototype.hasOwnProperty.call(byMode, outcome.mode)) {
      throw new Error(`Unknown parity mode for ${outcome.id}: ${outcome.mode}`);
    }
    byStatus[outcome.status] += 1;
    byMode[outcome.mode] += 1;
    if (outcome.unexpected) {
      unexpectedCount += 1;
    }
  }

  return {
    caseCount: outcomes.length,
    assertionCount,
    byStatus,
    byMode,
    unexpectedCount,
    result: unexpectedCount > 0
      ? 'INVALID'
      : byStatus.GAP > 0
        ? 'VALID_WITH_KNOWN_GAPS'
        : 'VALID',
  };
}

function buildMachineSummary({ standaloneCommit, referenceCommit, summary }) {
  if (!standaloneCommit || !referenceCommit || !summary) {
    throw new Error('Parity machine summary requires both commits and a run summary.');
  }
  return {
    schemaVersion: 1,
    standaloneCommit,
    referenceCommit,
    caseCount: summary.caseCount,
    assertionCount: summary.assertionCount,
    unexpectedCount: summary.unexpectedCount,
    byStatus: summary.byStatus,
    result: summary.result,
  };
}

module.exports = {
  STATUS_ORDER,
  buildMachineSummary,
  buildSummary,
};
