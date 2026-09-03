'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');

const ROOT = path.resolve(__dirname, '..', '..');
const {
  CONFIDENTIALITY_POLICY,
  auditGitHistory,
  auditGitMetadata,
  auditStagedText,
  auditTextRecords,
  auditTrackedText,
  digestBytes,
  digestNormalized,
  formatAuditFailure,
  matchingPolicyCategories,
  verifyRefCoverage,
} = require(path.join(ROOT, 'scripts', 'audit-repository-confidentiality'));
const {
  auditGeneratedBytes,
  auditVsixBytes,
  isGeneratedBundle,
} = require(path.join(ROOT, 'scripts', 'audit-vsix-confidentiality'));
const { HIGHLIGHTING_FIXTURE } = require(path.join(ROOT, 'test', 'language', 'fixtures'));

const canary = 'reviewguardian';
const normalizedCanaryPolicy = Object.freeze([{
  category: 'canary',
  mode: 'normalized-sequence',
  length: canary.length,
  sha256: digestNormalized(canary),
}]);
for (const variant of [
  'reviewguardian',
  'Review Guardian',
  'REVIEW-GUARDIAN',
  'review_guardian',
  'review.guardian',
]) {
  assert.deepStrictEqual(
    matchingPolicyCategories(variant, normalizedCanaryPolicy),
    ['canary'],
    `normalization should reject harmless canary variant ${JSON.stringify(variant)}`
  );
}

const exactCanary = Buffer.from([0x01, 0x52, 0x47, 0x02]);
const exactCanaryPolicy = Object.freeze([{
  category: 'exact-canary',
  mode: 'exact-bytes',
  length: exactCanary.length,
  sha256: digestBytes(exactCanary),
}]);
assert.deepStrictEqual(
  matchingPolicyCategories(Buffer.concat([Buffer.from('safe'), exactCanary]), exactCanaryPolicy),
  ['exact-canary']
);
assert.deepStrictEqual(matchingPolicyCategories('ordinary repository text', normalizedCanaryPolicy), []);

for (const entry of CONFIDENTIALITY_POLICY) {
  assert.match(entry.category, /^[a-z][a-z-]*$/);
  assert(['normalized-substring', 'normalized-sequence', 'exact-bytes'].includes(entry.mode));
  assert(Number.isSafeInteger(entry.length) && entry.length > 0);
  assert.match(entry.sha256, /^[a-f0-9]{64}$/);
  assert.deepStrictEqual(
    Object.keys(entry).sort(),
    ['category', 'length', 'mode', 'sha256'],
    'production policy entries must contain opaque matching data only'
  );
}

const recordReport = auditTextRecords([
  { content: 'Review Guardian' },
  { content: Buffer.concat([Buffer.from('prefix'), exactCanary]) },
], [...normalizedCanaryPolicy, ...exactCanaryPolicy]);
assert.deepStrictEqual(recordReport, {
  categories: { canary: 1, 'exact-canary': 1 },
  records: 2,
  total: 2,
});
const safeFailure = formatAuditFailure('fixture', recordReport);
assert.match(safeFailure, /2 protected match\(es\).*2 categor/);
assert.doesNotMatch(safeFailure, /review|guardian|prefix|[a-f0-9]{64}/i);

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-kdb-hygiene-'));
try {
  execFileSync('git', ['init', '-q'], { cwd: temporary });
  execFileSync('git', ['config', 'user.name', 'Safe Test'], { cwd: temporary });
  execFileSync('git', ['config', 'user.email', 'safe@example.invalid'], { cwd: temporary });
  fs.writeFileSync(path.join(temporary, 'sample.txt'), 'Review-Guardian\n');
  execFileSync('git', ['add', 'sample.txt'], { cwd: temporary });
  assert.strictEqual(auditStagedText(temporary, normalizedCanaryPolicy).total, 1);

  const normalizedDate = '2000-01-01T12:00:00Z';
  execFileSync('git', ['commit', '-qm', 'review guardian'], {
    cwd: temporary,
    env: { ...process.env, GIT_AUTHOR_DATE: normalizedDate, GIT_COMMITTER_DATE: normalizedDate },
  });
  execFileSync('git', ['tag', '-a', 'v1', '-m', 'review_guardian'], {
    cwd: temporary,
    env: { ...process.env, GIT_COMMITTER_DATE: normalizedDate },
  });
  const historyReport = auditGitHistory(temporary, normalizedCanaryPolicy);
  assert(historyReport.total >= 3, 'history audit must inspect blob, commit, and tag objects');

  const approvedIdentity = digestBytes(Buffer.from('Safe Test\0safe@example.invalid'));
  assert.deepStrictEqual(auditGitMetadata(temporary, approvedIdentity, true), {
    categories: {},
    records: 2,
    total: 0,
  });
  assert(auditGitMetadata(
    temporary,
    digestBytes(Buffer.from('Different\0different@example.invalid')),
    true
  ).total > 0);

  assert.deepStrictEqual(
    verifyRefCoverage(
      new Map([['refs/heads/main', 'a'], ['refs/tags/v1', 'b']]),
      new Map([['refs/heads/main', 'a'], ['refs/tags/v1', 'c'], ['refs/tags/extra', 'd']])
    ),
    { mismatched: 1, missing: 0, unexpected: 1 }
  );
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

assert.strictEqual(
  auditTextRecords([{ content: HIGHLIGHTING_FIXTURE }], CONFIDENTIALITY_POLICY).total,
  0,
  'q highlighting fixtures must be independently authored and contain no protected operational vocabulary'
);

const trackedReport = auditTrackedText(ROOT);
assert.deepStrictEqual(
  trackedReport,
  { categories: {}, records: trackedReport.records, total: 0 },
  formatAuditFailure('working tree', trackedReport)
);

async function verifyPackagedArtifactAudit() {
  const packagedCanaryPolicy = Object.freeze([{
    category: 'private-identifier',
    mode: 'normalized-sequence',
    length: canary.length,
    sha256: digestNormalized(canary),
  }]);

  assert.strictEqual(isGeneratedBundle('extension/out/extension.js'), true);
  assert.strictEqual(isGeneratedBundle('extension/renderer/view.js'), true);
  assert.strictEqual(isGeneratedBundle('extension/readme.md'), false);
  assert.strictEqual(
    auditGeneratedBytes(Buffer.from('Review Guardian'), packagedCanaryPolicy).total,
    0
  );
  assert.strictEqual(
    auditGeneratedBytes(Buffer.from(canary), packagedCanaryPolicy).total,
    1
  );

  const generatedSeparated = new JSZip();
  generatedSeparated.file('extension/out/extension.js', 'Review Guardian');
  assert.strictEqual(
    (await auditVsixBytes(await generatedSeparated.generateAsync({ type: 'nodebuffer' }),
      packagedCanaryPolicy)).total,
    0,
    'generated bundles should avoid normalized numeric false positives across syntax boundaries'
  );

  const generatedExact = new JSZip();
  generatedExact.file('extension/out/extension.js', canary);
  assert.strictEqual(
    (await auditVsixBytes(await generatedExact.generateAsync({ type: 'nodebuffer' }),
      packagedCanaryPolicy)).total,
    1,
    'generated bundles must still reject exact protected values'
  );

  const packagedSource = new JSZip();
  packagedSource.file('extension/readme.md', 'Review Guardian');
  assert.strictEqual(
    (await auditVsixBytes(await packagedSource.generateAsync({ type: 'nodebuffer' }),
      packagedCanaryPolicy)).total,
    1,
    'non-generated package content must retain normalized matching'
  );
}

verifyPackagedArtifactAudit().then(() => {
  console.log('repository confidentiality hygiene passed');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
