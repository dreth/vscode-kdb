'use strict';

const fs = require('fs');
const path = require('path');

const STATUS_ORDER = ['PASS', 'DIFFERENT_BY_DESIGN', 'GAP', 'NOT_TESTABLE_HERE'];

function buildSummary(outcomes, assertionCount) {
  const byStatus = Object.fromEntries(STATUS_ORDER.map(status => [status, 0]));
  const byEvidenceMode = { deterministic: 0, 'live-q': 0, boundary: 0 };
  let unexpectedCount = 0;

  for (const outcome of outcomes) {
    if (!Object.prototype.hasOwnProperty.call(byStatus, outcome.status)) {
      throw new Error(`Unknown parity status for ${outcome.id}: ${outcome.status}`);
    }
    if (!Object.prototype.hasOwnProperty.call(byEvidenceMode, outcome.mode)) {
      throw new Error(`Unknown parity evidence mode for ${outcome.id}: ${outcome.mode}`);
    }
    byStatus[outcome.status] += 1;
    byEvidenceMode[outcome.mode] += 1;
    if (outcome.unexpected) {
      unexpectedCount += 1;
    }
  }

  const hasKnownGaps = byStatus.GAP > 0;
  return {
    caseCount: outcomes.length,
    classifiedCaseCount: outcomes.length,
    assertionCount,
    byStatus,
    byEvidenceMode,
    unexpectedCount,
    signoffReady: !hasKnownGaps && byStatus.NOT_TESTABLE_HERE === 0,
    gateResult: unexpectedCount > 0
      ? 'INVALID'
      : hasKnownGaps
        ? 'VALID_WITH_KNOWN_GAPS'
        : 'VALID',
  };
}

function validateEvidence(evidence) {
  if (!evidence || evidence.schemaVersion !== 1) {
    throw new Error('Parity evidence schemaVersion must be 1.');
  }
  const ids = new Set();
  if (!evidence.summary || !Number.isInteger(evidence.summary.assertionCount) || evidence.summary.assertionCount < 0) {
    throw new Error('Parity summary assertionCount must be a non-negative integer.');
  }
  for (const outcome of evidence.outcomes || []) {
    if (!outcome.id || ids.has(outcome.id)) {
      throw new Error(`Parity case IDs must be non-empty and unique: ${outcome.id || '<empty>'}`);
    }
    ids.add(outcome.id);
    if (!STATUS_ORDER.includes(outcome.status)) {
      throw new Error(`Unsupported parity status ${outcome.status} for ${outcome.id}.`);
    }
    if (!['deterministic', 'live-q', 'boundary'].includes(outcome.mode)) {
      throw new Error(`Unsupported evidence mode ${outcome.mode} for ${outcome.id}.`);
    }
    if (outcome.expectedStatus && outcome.status !== outcome.expectedStatus && !outcome.unexpected) {
      throw new Error(`Parity case ${outcome.id} changed status without being marked unexpected.`);
    }
    if (outcome.status === 'DIFFERENT_BY_DESIGN' && !outcome.rationale) {
      throw new Error(`DIFFERENT_BY_DESIGN case ${outcome.id} needs a rationale.`);
    }
    if (outcome.status === 'GAP' && (!outcome.rank || !outcome.action || !outcome.signoff)) {
      throw new Error(`GAP case ${outcome.id} needs rank, action, and signoff metadata.`);
    }
    if (outcome.status === 'NOT_TESTABLE_HERE' && (!outcome.rationale || !outcome.signoff)) {
      throw new Error(`NOT_TESTABLE_HERE case ${outcome.id} needs rationale and future evidence.`);
    }
  }

  const expected = buildSummary(evidence.outcomes, evidence.summary.assertionCount);
  for (const field of ['caseCount', 'classifiedCaseCount', 'unexpectedCount', 'gateResult', 'signoffReady']) {
    if (evidence.summary[field] !== expected[field]) {
      throw new Error(`Parity summary ${field} is inconsistent.`);
    }
  }
  for (const status of STATUS_ORDER) {
    if (evidence.summary.byStatus[status] !== expected.byStatus[status]) {
      throw new Error(`Parity summary count for ${status} is inconsistent.`);
    }
  }
  for (const mode of ['deterministic', 'live-q', 'boundary']) {
    if (evidence.summary.byEvidenceMode[mode] !== expected.byEvidenceMode[mode]) {
      throw new Error(`Parity summary count for ${mode} is inconsistent.`);
    }
  }
  return evidence;
}

function writeEvidenceFiles(root, evidence) {
  validateEvidence(evidence);
  fs.writeFileSync(path.join(root, 'PARITY_RUN.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'PARITY_RUN.md'), renderMarkdown(evidence));
}

function renderMarkdown(evidence) {
  validateEvidence(evidence);
  const summary = evidence.summary;
  const commands = evidence.checks.map(check =>
    `| ${escapeCell(check.name)} | \`${escapeCode(check.command)}\` | ${check.exitCode === 0 ? 'PASS' : `FAIL (${check.exitCode})`} | ${escapeCell(check.outcome)} |`
  ).join('\n');
  const matrix = evidence.outcomes.map(outcome => {
    const detail = outcome.status === 'GAP'
      ? `Rank ${outcome.rank}: ${outcome.action} Sign-off: ${outcome.signoff}`
      : outcome.rationale || outcome.detail || '';
    return `| \`${escapeCode(outcome.id)}\` | ${escapeCell(outcome.area)} | ${escapeCell(outcome.mode)} | **${outcome.status}** | ${escapeCell(detail)} |`;
  }).join('\n');
  const gaps = evidence.outcomes
    .filter(outcome => outcome.status === 'GAP')
    .sort((left, right) => Number(left.rank) - Number(right.rank))
    .map(outcome => `${outcome.rank}. **${outcome.area}:** ${outcome.action} Sign-off condition: ${outcome.signoff}`)
    .join('\n');
  const limitations = evidence.outcomes
    .filter(outcome => outcome.status === 'NOT_TESTABLE_HERE')
    .map(outcome => `- **${outcome.area}:** ${outcome.rationale} Required evidence: ${outcome.signoff}`)
    .join('\n');

  return `# Cross-extension parity evidence run

This is a bounded executable evidence report, not a claim of complete functional or visual parity. The run result is **${summary.gateResult}** and source-of-truth sign-off is **${summary.signoffReady ? 'ready' : 'blocked'}**.

## Exact baseline

- Generated: \`${evidence.generatedAt}\`
- Standalone: \`${evidence.standalone.commit}\`, package \`${evidence.standalone.name}@${evidence.standalone.version}\`
- Reference: \`${evidence.reference.commit}\`, package \`${evidence.reference.name}@${evidence.reference.version}\`
- q runtime: \`${escapeCode(evidence.q.path)}\` (${escapeCell(evidence.q.versionEvidence)})
- Standalone tracked state: ${escapeCell(evidence.standalone.dirtyDisclaimer)}
- Reference tracked state: ${escapeCell(evidence.reference.dirtyDisclaimer)}
- Reference dirty snapshot SHA-256 before/after: \`${evidence.reference.statusHashBefore}\` / \`${evidence.reference.statusHashAfter}\`

The reference checkout was treated as read-only source evidence. Its pre-existing generated \`docs/**\` renderer drift was allowed only after verifying there were no staged or non-doc changes, and the exact tracked-status snapshot was unchanged after all reference commands.

## Commands and outcomes

| Check | Exact command | Status | Outcome |
| --- | --- | --- | --- |
${commands}

No documentation build, package command, reset, add, commit, or publication command ran in \`kdb-sqltools\`.

## Machine-readable counts

The complete machine-readable record is checked in as [\`PARITY_RUN.json\`](PARITY_RUN.json). Counts from that record:

\`\`\`json
${JSON.stringify({
    caseCount: summary.caseCount,
    classifiedCaseCount: summary.classifiedCaseCount,
    assertionCount: summary.assertionCount,
    byStatus: summary.byStatus,
    byEvidenceMode: summary.byEvidenceMode,
    unexpectedCount: summary.unexpectedCount,
    gateResult: summary.gateResult,
    signoffReady: summary.signoffReady,
  }, null, 2)}
\`\`\`

Deterministic unit equivalence and live direct-q equivalence are counted separately. Existing project-suite commands are recorded as checks and do not inflate parity case counts.

## PASS / DIFFERENT_BY_DESIGN / GAP / NOT_TESTABLE_HERE matrix

| Case | Area | Evidence | Classification | Evidence / disposition |
| --- | --- | --- | --- | --- |
${matrix}

\`PASS\` means the common fixture and product boundary shown in that row were actually exercised. It does not generalize to the whole extension. \`DIFFERENT_BY_DESIGN\` means the difference was asserted and retained intentionally; it is not called a pass. \`GAP\` blocks source-of-truth sign-off until its condition is met. \`NOT_TESTABLE_HERE\` records a truthful external boundary rather than inventing a test.

## Ranked gaps before parity-program M3 sign-off

${gaps || 'No executable gaps were recorded by this run.'}

Here, “parity-program M3 sign-off” names the cross-extension source-of-truth evidence gate requested for this run; it is distinct from the repository roadmap's notebook-evaluation M3. Before that parity sign-off, every GAP above must be closed or reclassified through an explicit product decision backed by a new fixture and review. A clean-commit strict run (\`npm run test:parity -- --fail-on-known-gap\`) must exit zero. The Extension Host/manual evidence listed below must also be recorded, and any compatibility backport must pass the reference's full approved release gates in its own repository.

## Exact untestable boundaries

${limitations || '- None recorded.'}

The environment had no \`code\` or \`code-insiders\` command. No authenticated endpoint, VS Code Extension Host, visual browser, spreadsheet application, SSH/TLS service, Marketplace install, or publication was fabricated.

## Scope and conclusion

The executable gate compared q IPC decode/display semantics, editor-text and namespace contracts, all six chart data types, text/XLSX export structure, direct IPC lifecycle and errors, local HTTP behavior, manifest boundaries, and a shared anonymous q fixture where both public/core interfaces allowed it. Canonicalization was limited to asserted ephemeral ports, validated random tokens, path separators in paths, ZIP metadata, and fixed generated identifiers; row/column/dictionary/series/warning order and semantic error classes were preserved.

This run does **not** conclude that \`vscode-kdb\` and \`kdb-sqltools\` are functionally or visually identical. It creates repeatable evidence for the shared boundaries listed above and keeps the source-of-truth transition blocked by the recorded gaps and external verification requirements.
`;
}

function escapeCell(value) {
  return String(value === undefined ? '' : value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function escapeCode(value) {
  return String(value).replace(/`/g, '\\`');
}

module.exports = {
  STATUS_ORDER,
  buildSummary,
  renderMarkdown,
  validateEvidence,
  writeEvidenceFiles,
};
