'use strict';

const JSZip = require('jszip');

const PARITY_STATUSES = Object.freeze([
  'PASS',
  'DIFFERENT_BY_DESIGN',
  'GAP',
  'NOT_TESTABLE_HERE',
]);

const VOLATILE_HTTP_HEADERS = new Set([
  'connection',
  'date',
  'keep-alive',
  'server',
  'transfer-encoding',
]);

function canonicalQValue(value, options = {}) {
  const state = {
    sortObjectKeys: options.sortObjectKeys !== false,
    seen: new WeakSet(),
  };
  return canonicalValue(value, state, '$');
}

function canonicalValue(value, state, path) {
  if (value === null) {
    return null;
  }
  if (value === undefined) {
    return { $type: 'undefined' };
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) {
      return { $number: 'NaN' };
    }
    if (value === Infinity) {
      return { $number: 'Infinity' };
    }
    if (value === -Infinity) {
      return { $number: '-Infinity' };
    }
    if (Object.is(value, -0)) {
      return { $number: '-0' };
    }
    return value;
  }
  if (typeof value === 'bigint') {
    return { $bigint: value.toString() };
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'symbol') {
    return { $symbol: String(value.description || '') };
  }
  if (typeof value === 'function') {
    throw new TypeError(`Cannot canonicalize function at ${path}.`);
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { $bytes: Buffer.from(value).toString('hex') };
  }
  if (value instanceof Date) {
    return { $date: value.toISOString() };
  }
  if (value instanceof Error) {
    return canonicalError(value);
  }

  enterObject(value, state, path);
  try {
    if (Array.isArray(value)) {
      return value.map((item, index) => canonicalValue(item, state, `${path}[${index}]`));
    }

    if (value.qtype === 'table') {
      return canonicalQTable(value, state, path, 'table');
    }
    if (value.qtype === 'keyedTable') {
      return canonicalQTable(value, state, path, 'keyedTable');
    }
    if (value.qtype === 'dict') {
      return canonicalQDictionary(value, state, path);
    }
    if (value.qtype === 'function') {
      const result = {
        $q: 'function',
        functionType: String(value.functionType || 'function'),
        ipcType: Number(value.ipcType),
      };
      if (typeof value.source === 'string') {
        result.source = normalizeLineEndings(value.source);
      }
      return result;
    }

    const keys = Object.keys(value);
    if (state.sortObjectKeys) {
      keys.sort();
    }
    const result = {};
    for (const key of keys) {
      result[key] = canonicalValue(value[key], state, `${path}.${key}`);
    }
    return result;
  } finally {
    state.seen.delete(value);
  }
}

function enterObject(value, state, path) {
  if (state.seen.has(value)) {
    throw new TypeError(`Cannot canonicalize cyclic value at ${path}.`);
  }
  state.seen.add(value);
}

function canonicalQTable(value, state, path, qtype) {
  const columns = Array.isArray(value.columns) ? value.columns.map(String) : [];
  const rows = Array.isArray(value.rows) ? value.rows : [];
  const rowCount = Number.isFinite(Number(value.rowCount)) ? Number(value.rowCount) : rows.length;
  return {
    $q: qtype,
    columns,
    rowCount,
    rows: rows.map((row, rowIndex) => columns.map((column, columnIndex) => {
      const cell = row && typeof row === 'object' ? row[column] : undefined;
      return canonicalValue(cell, state, `${path}.rows[${rowIndex}][${columnIndex}]`);
    })),
  };
}

function canonicalQDictionary(value, state, path) {
  let entries;
  if (Array.isArray(value.entries)) {
    entries = value.entries.map((entry, index) => ({
      key: canonicalValue(entry && entry.key, state, `${path}.entries[${index}].key`),
      value: canonicalValue(entry && entry.value, state, `${path}.entries[${index}].value`),
    }));
  } else {
    const keys = Array.isArray(value.keys) ? value.keys : [value.keys];
    const values = Array.isArray(value.values) ? value.values : [value.values];
    const length = Math.max(keys.length, values.length);
    entries = Array.from({ length }, (_unused, index) => ({
      key: canonicalValue(keys[index], state, `${path}.keys[${index}]`),
      value: canonicalValue(values[index], state, `${path}.values[${index}]`),
    }));
  }
  return { $q: 'dictionary', entries };
}

function canonicalPanel(panel, options = {}) {
  if (!panel || typeof panel !== 'object') {
    throw new TypeError('Panel result must be an object.');
  }

  if (panel.mode === 'text') {
    return {
      mode: 'text',
      kind: String(panel.kind || ''),
      text: normalizeLineEndings(String(panel.text === undefined ? '' : panel.text)),
      rowsMaterialized: panel.rowsMaterialized === true,
    };
  }

  if (panel.mode !== 'grid' || !panel.result) {
    throw new TypeError(`Unsupported panel mode: ${String(panel.mode)}.`);
  }

  const result = panel.result;
  const columns = Array.isArray(panel.cols)
    ? panel.cols.map(String)
    : Array.isArray(result.columns) ? result.columns.map(String) : [];
  const rowCount = nonNegativeInteger(result.rowCount, 0);
  const maxCells = positiveInteger(options.maxCells, 100000);
  if (rowCount * columns.length > maxCells) {
    throw new RangeError(`Panel canonicalization is limited to ${maxCells} cells; received ${rowCount * columns.length}.`);
  }

  const values = [];
  const text = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const valueRow = [];
    const textRow = [];
    for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
      const cellValue = typeof result.cellValue === 'function'
        ? result.cellValue(rowIndex, columnIndex)
        : valueFromRows(result.rows, columns[columnIndex], rowIndex);
      valueRow.push(canonicalQValue(cellValue));
      const cellText = typeof result.cellText === 'function'
        ? result.cellText(rowIndex, columnIndex, options.cellTextOptions)
        : defaultCellText(cellValue);
      textRow.push(normalizeLineEndings(String(cellText)));
    }
    values.push(valueRow);
    text.push(textRow);
  }

  return {
    mode: 'grid',
    kind: String(panel.kind || ''),
    columns,
    rowCount,
    values,
    text,
    rowsMaterialized: panel.rowsMaterialized === true,
  };
}

function canonicalTabular(tabular) {
  if (!tabular || typeof tabular !== 'object') {
    throw new TypeError('Tabular result must be an object.');
  }
  const columns = Array.isArray(tabular.cols) ? tabular.cols.map(String) : [];
  const rows = Array.isArray(tabular.rows) ? tabular.rows : [];
  return {
    kind: String(tabular.kind || ''),
    columns,
    rowCount: rows.length,
    rows: rows.map(row => columns.map(column => canonicalQValue(row && row[column]))),
  };
}

function valueFromRows(rows, column, rowIndex) {
  if (!Array.isArray(rows) || !rows[rowIndex] || typeof rows[rowIndex] !== 'object') {
    return undefined;
  }
  return rows[rowIndex][column];
}

function defaultCellText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return typeof value === 'string' ? value : String(value);
}

function classifyError(error) {
  const name = String(error && error.name || 'Error');
  const message = String(error && error.message || error || '');
  const normalized = message.toLowerCase();
  if (name === 'KdbQError') {
    return 'q-error';
  }
  if (/auth|credential|password/.test(normalized)) {
    return 'authentication';
  }
  if (/cancel(?:ed|led)?/.test(normalized)) {
    return 'canceled';
  }
  if (/timed out|timeout/.test(normalized)) {
    const phase = errorPhase(error);
    return phase ? `${phase}-timeout` : 'timeout';
  }
  if (/econnrefused|connection refused/.test(normalized)) {
    return 'connection-refused';
  }
  if (/econnreset|socket hang up|connection reset/.test(normalized)) {
    return 'connection-reset';
  }
  if (/not open/.test(normalized)) {
    return 'not-open';
  }
  if (/closed|close before/.test(normalized)) {
    return 'closed';
  }
  if (/invalid q ipc|unsupported q ipc|unexpected end of buffer|trailing byte/.test(normalized)) {
    return 'ipc-protocol';
  }
  const phase = errorPhase(error);
  if (phase) {
    return `${phase}-error`;
  }
  return name === 'KdbIpcError' ? 'ipc-error' : 'error';
}

function errorPhase(error) {
  const explicit = error && typeof error.phase === 'string' ? error.phase.toLowerCase() : '';
  if (['connect', 'handshake', 'query'].includes(explicit)) {
    return explicit;
  }
  const message = String(error && error.message || error || '').toLowerCase();
  for (const phase of ['handshake', 'connect', 'query']) {
    if (new RegExp(`(?:kdb\\+|q ipc)?\\s*${phase}\\s+(?:failed|timed out)`).test(message)) {
      return phase;
    }
  }
  return null;
}

function canonicalError(error, options = {}) {
  const normalizedError = error instanceof Error
    ? error
    : Object.assign(new Error(String(error && error.message || error || '')), error || {});
  const result = {
    name: String(normalizedError.name || 'Error'),
    classification: classifyError(normalizedError),
    phase: errorPhase(normalizedError),
    message: normalizeRuntimeText(normalizedError.message, options),
  };
  if (normalizedError.code !== undefined) {
    result.code = String(normalizedError.code);
  }
  if (normalizedError.status !== undefined && Number.isFinite(Number(normalizedError.status))) {
    result.status = Number(normalizedError.status);
  }
  return result;
}

function normalizeRuntimeText(value, options = {}) {
  let text = normalizeLineEndings(String(value === undefined ? '' : value));

  for (const port of options.ports || []) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Canonicalized port must be an integer from 1 to 65535: ${String(port)}`);
    }
    text = text.replace(
      new RegExp(`\\b(?:127\\.0\\.0\\.1|localhost):${port}\\b`, 'gi'),
      '<LOOPBACK>:<PORT>'
    );
  }

  for (const token of options.tokens || []) {
    if (!/^[0-9a-f]{48}$/i.test(String(token))) {
      throw new Error('Canonicalized local-server token must contain exactly 48 hexadecimal characters.');
    }
    text = replaceLiteral(text, token, '<TOKEN>');
  }
  for (const redaction of options.redactions || []) {
    text = replaceLiteral(text, redaction, '<REDACTED>');
  }
  for (const generatedId of options.generatedIds || []) {
    text = replaceLiteral(text, generatedId, '<GENERATED_ID>');
  }
  for (const rootPath of options.rootPaths || []) {
    const replacement = options.rootPathReplacement || '<ROOT>';
    text = replaceLiteral(text, rootPath, replacement);
    text = replaceLiteral(text, String(rootPath).replace(/\\/g, '/'), replacement);
  }
  return text;
}

function replaceLiteral(text, value, replacement) {
  const needle = String(value || '');
  return needle ? text.split(needle).join(replacement) : text;
}

function canonicalChart(chart, options = {}) {
  if (!chart || typeof chart !== 'object') {
    throw new TypeError('Chart result must be an object.');
  }
  const copy = { ...chart };
  if (options.ignoreRequestMetadata === true) {
    delete copy.version;
    delete copy.requestId;
  }
  return canonicalQValue(copy);
}

function canonicalLocalHttp(response, options = {}) {
  if (!response || typeof response !== 'object') {
    throw new TypeError('HTTP response must be an object.');
  }
  const status = Number(response.status === undefined ? response.statusCode : response.status);
  const headers = canonicalHttpHeaders(response.headers || {});
  const contentType = String(headers['content-type'] || '').toLowerCase();
  const bodyText = normalizeLineEndings(Buffer.isBuffer(response.body)
    ? response.body.toString('utf8')
    : String(response.body === undefined ? '' : response.body));
  let body;

  if (/ndjson/.test(contentType)) {
    body = bodyText === '' ? [] : bodyText.split('\n').filter(Boolean).map((line, index) => {
      try {
        return canonicalQValue(JSON.parse(line));
      } catch (error) {
        throw new Error(`Invalid NDJSON line ${index + 1}: ${error.message}`);
      }
    });
  } else if (/application\/json/.test(contentType) || looksLikeJson(bodyText)) {
    body = canonicalJsonBody(bodyText);
  } else {
    body = bodyText;
  }

  const result = { status, headers, body };
  const url = response.url || response.requestUrl;
  if (url) {
    result.url = normalizeRuntimeText(url, options);
  }
  return result;
}

function canonicalHttpHeaders(headers) {
  const entries = [];
  if (typeof headers.entries === 'function') {
    for (const entry of headers.entries()) {
      entries.push(entry);
    }
  } else {
    for (const key of Object.keys(headers)) {
      entries.push([key, headers[key]]);
    }
  }
  const result = {};
  entries
    .map(([name, value]) => [String(name).toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value)])
    .filter(([name]) => !VOLATILE_HTTP_HEADERS.has(name))
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([name, value]) => {
      result[name] = value;
    });
  return result;
}

function looksLikeJson(body) {
  const trimmed = body.trim();
  return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'));
}

function canonicalJsonBody(body) {
  if (body === '') {
    return null;
  }
  try {
    return canonicalQValue(JSON.parse(body));
  } catch (error) {
    throw new Error(`Invalid JSON response body: ${error.message}`);
  }
}

async function canonicalXlsxStructure(bytes) {
  const zip = await JSZip.loadAsync(Buffer.from(bytes));
  const paths = Object.keys(zip.files).filter(path => !zip.files[path].dir).sort();
  const entries = [];
  for (const path of paths) {
    const content = await zip.files[path].async('nodebuffer');
    if (isXlsxTextEntry(path)) {
      entries.push({ path, type: 'text', content: normalizeLineEndings(content.toString('utf8')) });
    } else {
      entries.push({ path, type: 'binary', content: content.toString('base64') });
    }
  }
  return { entries };
}

function isXlsxTextEntry(path) {
  return path === '[Content_Types].xml' || /(?:\.xml|\.rels)$/.test(path);
}

function summarizeStatuses(outcomes) {
  if (!Array.isArray(outcomes)) {
    throw new TypeError('Parity outcomes must be an array.');
  }
  const counts = Object.fromEntries(PARITY_STATUSES.map(status => [status, 0]));
  const scopes = new Map();
  for (const [index, outcome] of outcomes.entries()) {
    const status = outcome && outcome.status;
    if (!PARITY_STATUSES.includes(status)) {
      throw new Error(`Parity outcome ${index + 1} has invalid status ${String(status)}.`);
    }
    counts[status] += 1;
    const scope = String(outcome.scope || 'unspecified');
    if (!scopes.has(scope)) {
      scopes.set(scope, Object.fromEntries(PARITY_STATUSES.map(value => [value, 0])));
    }
    scopes.get(scope)[status] += 1;
  }
  const byScope = {};
  for (const scope of [...scopes.keys()].sort()) {
    const scopeCounts = scopes.get(scope);
    byScope[scope] = {
      total: PARITY_STATUSES.reduce((total, status) => total + scopeCounts[status], 0),
      counts: scopeCounts,
    };
  }
  return {
    schemaVersion: 1,
    total: outcomes.length,
    counts,
    byScope,
    gatePassed: counts.GAP === 0,
  };
}

function assertExpectedRevision(actual, expected, label = 'repository') {
  const actualRevision = String(actual || '').trim();
  const expectedRevision = String(expected || '').trim();
  if (!expectedRevision) {
    throw new Error(`Expected ${label} revision is empty.`);
  }
  if (actualRevision !== expectedRevision) {
    throw new Error(`${label} revision mismatch: expected ${expectedRevision}, found ${actualRevision || '<empty>'}.`);
  }
  return actualRevision;
}

function parseGitPorcelain(statusText) {
  const text = Buffer.isBuffer(statusText) ? statusText.toString('utf8') : String(statusText || '');
  if (!text) {
    return [];
  }
  if (text.includes('\0')) {
    return parseNulPorcelain(text);
  }
  return text.split(/\r?\n/).filter(Boolean).map(parsePorcelainEntry);
}

function parseNulPorcelain(text) {
  const parts = text.split('\0');
  const entries = [];
  for (let index = 0; index < parts.length; index += 1) {
    if (!parts[index]) {
      continue;
    }
    const entry = parsePorcelainEntry(parts[index]);
    if (entry.x === 'R' || entry.x === 'C' || entry.y === 'R' || entry.y === 'C') {
      entry.originalPath = parts[index + 1] || '';
      index += 1;
    }
    entries.push(entry);
  }
  return entries;
}

function parsePorcelainEntry(line) {
  if (line.length < 3 || line[2] !== ' ') {
    throw new Error(`Invalid git porcelain entry: ${JSON.stringify(line)}.`);
  }
  return {
    xy: line.slice(0, 2),
    x: line[0],
    y: line[1],
    path: line.slice(3),
  };
}

function assertReferenceStatus(statusText, options = {}) {
  const entries = parseGitPorcelain(statusText);
  const allowedPathPrefixes = options.allowedPathPrefixes || ['docs/'];
  const allowedStatuses = options.allowedStatuses || [' M'];
  const violations = entries.filter(entry => {
    return !allowedStatuses.includes(entry.xy) ||
      !allowedPathPrefixes.some(prefix => entry.path.startsWith(prefix));
  });
  if (violations.length > 0) {
    const details = violations.map(entry => `${entry.xy} ${entry.path}`).join(', ');
    throw new Error(`Reference worktree contains disallowed changes: ${details}.`);
  }
  if (options.requireDirty === true && entries.length === 0) {
    throw new Error('Reference worktree was expected to contain the documented generated docs drift, but it is clean.');
  }

  if (options.expectedEntries) {
    const actual = entries.map(entry => `${entry.xy} ${entry.path}`).sort();
    const expected = options.expectedEntries.map(String).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Reference dirty-state mismatch: expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}.`);
    }
  }

  const dirty = entries.length > 0;
  return {
    dirty,
    entryCount: entries.length,
    entries: entries.map(entry => ({ xy: entry.xy, path: entry.path })),
    disclaimer: dirty
      ? `Reference worktree is not clean: ${entries.length} allowed generated docs change${entries.length === 1 ? '' : 's'} were excluded from source evidence.`
      : 'Reference tracked worktree is clean.',
  };
}

function normalizeLineEndings(value) {
  return String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.floor(number) : fallback;
}

module.exports = {
  PARITY_STATUSES,
  canonicalQValue,
  canonicalPanel,
  canonicalTabular,
  classifyError,
  errorPhase,
  canonicalError,
  normalizeRuntimeText,
  canonicalChart,
  canonicalLocalHttp,
  canonicalXlsxStructure,
  summarizeStatuses,
  assertExpectedRevision,
  parseGitPorcelain,
  assertReferenceStatus,
  normalizeLineEndings,
};
