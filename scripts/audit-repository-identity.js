'use strict';

const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROHIBITED_DIGESTS = Object.freeze([
  Object.freeze({
    length: 10,
    sha256: '038d89e80ffcb8f03fc6bab35e7e53717ebf6f83c10b094dcc6d2786ad5d3803',
  }),
  Object.freeze({
    length: 11,
    sha256: '8e4ecaacfeea4e202813b0935c83a85fbc7250625ade41f417cb28f82156888c',
  }),
]);

function digestNormalized(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizedWords(value) {
  return value.normalize('NFKC').toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function matchingDigests(value, prohibitedDigests = PROHIBITED_DIGESTS) {
  const lengths = [...new Set(prohibitedDigests.map(entry => entry.length))].sort((a, b) => a - b);
  const digestSet = new Set(prohibitedDigests.map(entry => entry.sha256));
  const matches = new Set();
  for (const line of value.split(/\r?\n/)) {
    const words = normalizedWords(line);
    for (let start = 0; start < words.length; start++) {
      const word = words[start];
      for (const length of lengths) {
        for (let offset = 0; offset + length <= word.length; offset++) {
          const digest = digestNormalized(word.slice(offset, offset + length));
          if (digestSet.has(digest)) matches.add(digest);
        }
      }
      let joined = '';
      for (let end = start; end < words.length && joined.length <= lengths.at(-1); end++) {
        joined += words[end];
        if (!lengths.includes(joined.length)) continue;
        const digest = digestNormalized(joined);
        if (digestSet.has(digest)) matches.add(digest);
      }
    }
  }
  return [...matches].sort();
}

function trackedFiles(root) {
  return execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root }
  ).toString('utf8').split('\0').filter(Boolean);
}

function auditTrackedText(root) {
  const failures = [];
  for (const relative of trackedFiles(root)) {
    const target = path.join(root, relative);
    let bytes;
    try {
      bytes = fs.readFileSync(target);
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw error;
    }
    if (bytes.includes(0)) continue;
    if (matchingDigests(bytes.toString('utf8')).length > 0) failures.push(relative);
  }
  return failures.sort();
}

function main() {
  const root = path.resolve(__dirname, '..');
  const failures = auditTrackedText(root);
  if (failures.length > 0) {
    process.stderr.write(
      `repository identity audit failed in ${failures.length} tracked text file(s):\n` +
      `${failures.map(file => `- ${file}`).join('\n')}\n`
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write('repository identity hygiene passed\n');
}

module.exports = {
  PROHIBITED_DIGESTS,
  auditTrackedText,
  digestNormalized,
  matchingDigests,
  normalizedWords,
  trackedFiles,
};

if (require.main === module) main();
