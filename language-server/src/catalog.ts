export type QCatalogCategory = 'builtin' | 'control' | 'qsql' | 'system-command' | 'system-namespace';

export interface QCatalogEntry {
  readonly spelling: string;
  readonly category: QCatalogCategory;
  readonly signature?: string;
  readonly rank?: number;
  readonly summary: string;
  readonly url: string;
  readonly retrieved: '2026-08-25';
}

const BUILTINS = [
  'abs', 'acos', 'aj', 'aj0', 'all', 'and', 'any', 'asc', 'asin', 'asof', 'atan',
  'attr', 'avg', 'avgs', 'bin', 'binr', 'ceiling', 'cols', 'cor', 'cos', 'count',
  'cov', 'cross', 'csv', 'cut', 'deltas', 'desc', 'dev', 'differ', 'distinct', 'div',
  'dsave', 'each', 'ej', 'enlist', 'eval', 'except', 'exit', 'exp', 'fills', 'first',
  'fkeys', 'flip', 'floor', 'get', 'group', 'gtime', 'hclose', 'hcount', 'hdel',
  'hopen', 'hsym', 'iasc', 'idesc', 'ij', 'ijf', 'in', 'insert', 'inter', 'inv',
  'key', 'keys', 'last', 'like', 'lj', 'ljf', 'load', 'log', 'lower', 'lsq', 'ltrim',
  'mavg', 'max', 'maxs', 'mcount', 'md5', 'mdev', 'med', 'meta', 'min', 'mins',
  'msum', 'neg', 'next', 'not', 'null', 'or', 'over', 'parse', 'peach', 'pj', 'prd',
  'prds', 'prev', 'prior', 'rand', 'rank', 'ratios', 'raze', 'read0', 'read1',
  'reciprocal', 'reval', 'reverse', 'rload', 'rotate', 'rsave', 'save', 'scan', 'set',
  'show', 'signum', 'sin', 'sqrt', 'ss', 'ssr', 'string', 'sublist', 'sum', 'sums',
  'sv', 'system', 'tables', 'tan', 'til', 'trim', 'type', 'uj', 'ujf', 'union',
  'upper', 'upsert', 'value', 'var', 'views', 'vs', 'wavg', 'within', 'wsum',
  'xasc', 'xbar', 'xcol', 'xcols', 'xdesc', 'xexp', 'xgroup', 'xkey', 'xlog',
  'xprev', 'xrank',
] as const;

const CONTROLS = ['do', 'if', 'while'] as const;
const QSQL = ['select', 'exec', 'update', 'delete', 'from', 'by', 'where', 'fby'] as const;
const SYSTEM_NAMESPACES = [
  '.Q.en', '.Q.fc', '.Q.ff', '.Q.fk', '.Q.fs', '.Q.fu', '.Q.gc', '.Q.hg', '.Q.host',
  '.Q.id', '.Q.j10', '.Q.j12', '.Q.k', '.Q.opt', '.Q.par', '.Q.pd', '.Q.pf', '.Q.pn',
  '.Q.pt', '.Q.qt', '.Q.s', '.Q.sha1', '.Q.ts', '.Q.ty', '.Q.view', '.Q.vp',
  '.z.a', '.z.ac', '.z.b', '.z.c', '.z.D', '.z.d', '.z.exit', '.z.f', '.z.h', '.z.i',
  '.z.K', '.z.k', '.z.l', '.z.N', '.z.n', '.z.p', '.z.pc', '.z.pd', '.z.pg', '.z.ph',
  '.z.pi', '.z.pm', '.z.po', '.z.pp', '.z.pq', '.z.ps', '.z.pw', '.z.q', '.z.s', '.z.T',
  '.z.t', '.z.ts', '.z.u', '.z.W', '.z.w', '.z.ws', '.z.X', '.z.x', '.z.Z', '.z.z',
] as const;

const SYSTEM_COMMANDS = [
  '\\a', '\\b', '\\B', '\\c', '\\C', '\\cd', '\\d', '\\e', '\\f', '\\g',
  '\\l', '\\o', '\\p', '\\P', '\\r', '\\s', '\\S', '\\t', '\\T', '\\ts',
  '\\u', '\\v', '\\w', '\\W', '\\x', '\\z', '\\1', '\\2', '\\_', '\\\\',
] as const;

function entry(
  spelling: string,
  category: QCatalogCategory,
  url: string,
  details: { summary?: string; signature?: string; rank?: number } = {},
): QCatalogEntry {
  return Object.freeze({
    spelling,
    category,
    signature: details.signature,
    rank: details.rank,
    summary: details.summary ?? defaultSummary(spelling, category),
    url,
    retrieved: '2026-08-25' as const,
  });
}

const BUILTIN_DETAILS: Readonly<Record<string, { summary: string; signature?: string; rank?: number }>> = Object.freeze({
  abs: { summary: 'Returns the absolute value of numeric data.', signature: 'abs[x]', rank: 1 },
  all: { summary: 'Tests whether every boolean item is true.', signature: 'all[x]', rank: 1 },
  any: { summary: 'Tests whether at least one boolean item is true.', signature: 'any[x]', rank: 1 },
  asc: { summary: 'Sorts a list or table into ascending order.', signature: 'asc[x]', rank: 1 },
  avg: { summary: 'Returns the arithmetic mean of numeric data.', signature: 'avg[x]', rank: 1 },
  avgs: { summary: 'Returns the running arithmetic means of numeric data.', signature: 'avgs[x]', rank: 1 },
  ceiling: { summary: 'Rounds numeric values upward to integral values.', signature: 'ceiling[x]', rank: 1 },
  cols: { summary: 'Returns the column names of a table.', signature: 'cols[x]', rank: 1 },
  count: { summary: 'Returns the number of items in a value.', signature: 'count[x]', rank: 1 },
  cut: { summary: 'Splits a list at supplied offsets or into fixed-size pieces.', signature: 'x cut y', rank: 2 },
  deltas: { summary: 'Returns differences between consecutive items.', signature: 'deltas[x]', rank: 1 },
  desc: { summary: 'Sorts a list or table into descending order.', signature: 'desc[x]', rank: 1 },
  distinct: { summary: 'Returns the unique items in first-occurrence order.', signature: 'distinct[x]', rank: 1 },
  enlist: { summary: 'Wraps a value in a one-item list.', signature: 'enlist[x]', rank: 1 },
  eval: { summary: 'Evaluates a parsed q expression.', signature: 'eval[x]', rank: 1 },
  except: { summary: 'Returns items from the left argument not present on the right.', signature: 'x except y', rank: 2 },
  first: { summary: 'Returns the first item of a value.', signature: 'first[x]', rank: 1 },
  flip: { summary: 'Transposes a rectangular list or converts a column dictionary to a table.', signature: 'flip[x]', rank: 1 },
  floor: { summary: 'Rounds numeric values downward to integral values.', signature: 'floor[x]', rank: 1 },
  get: { summary: 'Reads or evaluates the value identified by its argument.', signature: 'get[x]', rank: 1 },
  group: { summary: 'Groups equal items and returns their positions.', signature: 'group[x]', rank: 1 },
  in: { summary: 'Tests membership of left-side items in the right-side value.', signature: 'x in y', rank: 2 },
  inter: { summary: 'Returns the distinct intersection of two values.', signature: 'x inter y', rank: 2 },
  key: { summary: 'Returns dictionary keys, table key columns, or an object handle key.', signature: 'key[x]', rank: 1 },
  keys: { summary: 'Returns the names visible in a q namespace.', signature: 'keys[x]', rank: 1 },
  last: { summary: 'Returns the last item of a value.', signature: 'last[x]', rank: 1 },
  lower: { summary: 'Converts character data to lower case.', signature: 'lower[x]', rank: 1 },
  max: { summary: 'Returns the greatest non-null item.', signature: 'max[x]', rank: 1 },
  meta: { summary: 'Returns column names, q types, foreign keys, and attributes for a table.', signature: 'meta[x]', rank: 1 },
  min: { summary: 'Returns the least non-null item.', signature: 'min[x]', rank: 1 },
  neg: { summary: 'Negates numeric values.', signature: 'neg[x]', rank: 1 },
  not: { summary: 'Returns the boolean negation of zero/nonzero values.', signature: 'not[x]', rank: 1 },
  null: { summary: 'Tests whether values are q nulls.', signature: 'null[x]', rank: 1 },
  parse: { summary: 'Parses q source text into its expression representation.', signature: 'parse[x]', rank: 1 },
  rand: { summary: 'Generates pseudo-random values or samples from a domain.', signature: 'x rand y', rank: 2 },
  raze: { summary: 'Joins the items of a list by one level.', signature: 'raze[x]', rank: 1 },
  reverse: { summary: 'Reverses item order.', signature: 'reverse[x]', rank: 1 },
  rotate: { summary: 'Rotates a list by the supplied offset.', signature: 'x rotate y', rank: 2 },
  show: { summary: 'Writes a q value to standard output and returns it.', signature: 'show[x]', rank: 1 },
  ssr: { summary: 'Replaces string matches using a replacement string or function.', signature: 'ssr[source;pattern;replacement]', rank: 3 },
  string: { summary: 'Converts values to character representations.', signature: 'string[x]', rank: 1 },
  sublist: { summary: 'Selects a bounded portion of a list.', signature: 'x sublist y', rank: 2 },
  sum: { summary: 'Returns the sum of numeric data.', signature: 'sum[x]', rank: 1 },
  sums: { summary: 'Returns running sums of numeric data.', signature: 'sums[x]', rank: 1 },
  tables: { summary: 'Returns table names in a namespace.', signature: 'tables[x]', rank: 1 },
  til: { summary: 'Returns consecutive integers from zero up to, but excluding, the argument.', signature: 'til[x]', rank: 1 },
  trim: { summary: 'Removes leading and trailing whitespace from character data.', signature: 'trim[x]', rank: 1 },
  type: { summary: 'Returns the q type number of a value.', signature: 'type[x]', rank: 1 },
  union: { summary: 'Returns the distinct union of two values.', signature: 'x union y', rank: 2 },
  upper: { summary: 'Converts character data to upper case.', signature: 'upper[x]', rank: 1 },
  value: { summary: 'Resolves a symbol or evaluates a parsed q expression.', signature: 'value[x]', rank: 1 },
  where: { summary: 'Returns positions of true booleans or expands integer counts.', signature: 'where[x]', rank: 1 },
  within: { summary: 'Tests whether values lie within inclusive bounds.', signature: 'x within y', rank: 2 },
});

const QSQL_DETAILS: Readonly<Record<string, string>> = Object.freeze({
  select: 'Selects rows and columns from a q table expression.',
  exec: 'Evaluates a qSQL query and returns values or dictionaries rather than a table.',
  update: 'Updates columns in a q table expression.',
  delete: 'Deletes rows or columns from a q table expression.',
  from: 'Introduces the source table expression of a qSQL query.',
  by: 'Defines qSQL grouping keys.',
  where: 'Introduces qSQL row-filter predicates.',
  fby: 'Applies an aggregate by grouping values inside a qSQL predicate.',
});

function defaultSummary(spelling: string, category: QCatalogCategory): string {
  switch (category) {
    case 'builtin': return `${spelling} is a built-in q primitive; follow the official reference for its supported valences and type behavior.`;
    case 'control': return `${spelling} controls conditional or repeated evaluation in q.`;
    case 'qsql': return QSQL_DETAILS[spelling] ?? `${spelling} is part of qSQL query syntax.`;
    case 'system-command': return `${spelling} is a q system command interpreted by the q process.`;
    case 'system-namespace': return `${spelling} is a reserved q runtime name in a system namespace.`;
  }
}

export const Q_CATALOG: readonly QCatalogEntry[] = Object.freeze([
  ...BUILTINS.map(name => entry(name, 'builtin', `https://code.kx.com/q/ref/${name}/`, BUILTIN_DETAILS[name])),
  ...CONTROLS.map(name => entry(name, 'control', `https://code.kx.com/q/ref/${name}/`, {
    summary: `${name} controls conditional or repeated evaluation in q.`,
  })),
  ...QSQL.map(name => entry(name, 'qsql', 'https://code.kx.com/q/basics/qsql/', {
    summary: QSQL_DETAILS[name],
  })),
  ...SYSTEM_NAMESPACES.map(name => entry(name, 'system-namespace', 'https://code.kx.com/q/ref/dotz/')),
  ...SYSTEM_COMMANDS.map(name => entry(name, 'system-command', 'https://code.kx.com/q/basics/syscmds/')),
]);

export function validateQCatalog(entries: readonly QCatalogEntry[] = Q_CATALOG): readonly string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const categories: readonly QCatalogCategory[] = [
    'builtin', 'control', 'qsql', 'system-command', 'system-namespace',
  ];
  for (const value of entries) {
    if (!value.spelling || seen.has(value.spelling)) {
      errors.push(`Duplicate or empty q catalog spelling: ${value.spelling}`);
    }
    seen.add(value.spelling);
    if (!categories.includes(value.category)) {
      errors.push(`Invalid category for ${value.spelling}.`);
    }
    try {
      const url = new URL(value.url);
      if (url.protocol !== 'https:' || url.hostname !== 'code.kx.com') {
        errors.push(`Non-official URL for ${value.spelling}.`);
      }
    } catch {
      errors.push(`Invalid URL for ${value.spelling}.`);
    }
    if (!value.summary || value.summary.length > 240) {
      errors.push(`Invalid summary for ${value.spelling}.`);
    }
    if (value.retrieved !== '2026-08-25') {
      errors.push(`Invalid retrieval metadata for ${value.spelling}.`);
    }
    if (value.signature !== undefined &&
      (!value.signature.trim() || value.signature.length > 160 || /[\r\n]/.test(value.signature))) {
      errors.push(`Invalid signature for ${value.spelling}.`);
    }
    if (value.rank !== undefined && (!Number.isInteger(value.rank) || value.rank < 0)) {
      errors.push(`Invalid rank for ${value.spelling}.`);
    }
  }
  return errors;
}

export function qCatalogEntry(spelling: string): QCatalogEntry | undefined {
  return Q_CATALOG.find(value => value.spelling === spelling);
}
