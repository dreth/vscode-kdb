export type QChartColumnKind = 'numeric' | 'temporal';

const Q_TYPE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  bool: 'boolean',
  boolean: 'boolean',
  byte: 'byte',
  short: 'short',
  int: 'int',
  integer: 'int',
  long: 'long',
  real: 'real',
  float: 'float',
  double: 'float',
  char: 'char',
  string: 'char',
  symbol: 'symbol',
  timestamp: 'timestamp',
  month: 'month',
  date: 'date',
  datetime: 'datetime',
  timespan: 'timespan',
  minute: 'minute',
  second: 'second',
  time: 'time',
  temporal: 'temporal',
});

const Q_NUMERIC_TYPES = new Set([
  'byte',
  'short',
  'int',
  'long',
  'real',
  'float',
]);

const Q_TEMPORAL_TYPES = new Set([
  'timestamp',
  'month',
  'date',
  'datetime',
  'timespan',
  'minute',
  'second',
  'time',
  'temporal',
]);

export function normalizeQTypeName(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLocaleLowerCase().replace(/\s+/g, '');
  return Q_TYPE_ALIASES[normalized] || undefined;
}

export function qTypeChartColumnKind(value: unknown): QChartColumnKind | undefined {
  const qType = normalizeQTypeName(value);
  if (!qType) {
    return undefined;
  }
  if (Q_NUMERIC_TYPES.has(qType)) {
    return 'numeric';
  }
  return Q_TEMPORAL_TYPES.has(qType) ? 'temporal' : undefined;
}

export function isQTemporalType(value: unknown): boolean {
  const qType = normalizeQTypeName(value);
  return !!qType && Q_TEMPORAL_TYPES.has(qType);
}

export function isKnownQType(value: unknown): boolean {
  return normalizeQTypeName(value) !== undefined;
}
