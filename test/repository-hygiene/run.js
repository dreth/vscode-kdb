'use strict';

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const {
  auditTrackedText,
  digestNormalized,
  matchingDigests,
} = require(path.join(ROOT, 'scripts', 'audit-repository-identity'));

const canary = 'reviewguardian';
const canaryDigest = digestNormalized(canary);
for (const variant of [
  'reviewguardian',
  'Review Guardian',
  'REVIEW-GUARDIAN',
  'review_guardian',
  'review.guardian',
]) {
  assert.deepStrictEqual(
    matchingDigests(variant, [{ length: canary.length, sha256: canaryDigest }]),
    [canaryDigest],
    `normalization should reject harmless canary variant ${JSON.stringify(variant)}`
  );
}
assert.strictEqual(
  canaryDigest,
  crypto.createHash('sha256').update(canary).digest('hex'),
  'the scanner must use SHA-256 over normalized text'
);
assert.deepStrictEqual(matchingDigests('ordinary repository text', [
  { length: canary.length, sha256: canaryDigest },
]), []);

const failures = auditTrackedText(ROOT);
assert.deepStrictEqual(
  failures,
  [],
  `tracked repository text contains ${failures.length} prohibited identity digest match(es): ${failures.join(', ')}`
);

console.log('repository identity hygiene passed');
