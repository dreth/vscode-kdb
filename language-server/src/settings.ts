export const Q_LINT_CODES = Object.freeze([
  'q.deprecated-datetime',
  'q.unused-parameter',
  'q.unused-local',
  'q.declared-after-use',
  'q.unindented-continuation',
] as const);

export type QLintCode = typeof Q_LINT_CODES[number];
export type QLintSeverity = 'error' | 'warning' | 'information' | 'hint' | 'off';

export interface QLanguageSettings {
  readonly enabled: boolean;
  readonly diagnostics: {
    readonly debounceMs: number;
    readonly maxProblems: number;
  };
  readonly maxFileSizeBytes: number;
  readonly workspace: {
    readonly include: readonly string[];
    readonly exclude: readonly string[];
    readonly maxFiles: number;
  };
  readonly lint: {
    readonly enabled: boolean;
    readonly rules: Readonly<Record<QLintCode, QLintSeverity>>;
  };
  readonly connectedIntelligence: boolean;
}

export const DEFAULT_Q_LANGUAGE_SETTINGS: QLanguageSettings = Object.freeze({
  enabled: true,
  diagnostics: Object.freeze({ debounceMs: 250, maxProblems: 200 }),
  maxFileSizeBytes: 2_097_152,
  workspace: Object.freeze({
    include: Object.freeze(['**/*.q']),
    exclude: Object.freeze([
      '**/.git/**',
      '**/node_modules/**',
      '**/out/**',
      '**/dist/**',
      '**/build/**',
    ]),
    maxFiles: 5_000,
  }),
  lint: Object.freeze({
    enabled: true,
    rules: Object.freeze({
      'q.deprecated-datetime': 'warning',
      'q.unused-parameter': 'hint',
      'q.unused-local': 'hint',
      'q.declared-after-use': 'warning',
      'q.unindented-continuation': 'warning',
    }),
  }),
  connectedIntelligence: false,
});

export interface NormalizedSettingsResult {
  readonly settings: QLanguageSettings;
  readonly warnings: readonly string[];
}

export function normalizeQLanguageSettings(value: unknown): NormalizedSettingsResult {
  const warnings: string[] = [];
  const input = record(value);
  const diagnostics = record(input.diagnostics);
  const workspace = record(input.workspace);
  const lint = record(input.lint);
  const configuredRules = record(lint.rules);
  const rules = { ...DEFAULT_Q_LANGUAGE_SETTINGS.lint.rules };
  for (const [code, severity] of Object.entries(configuredRules)) {
    if (!Q_LINT_CODES.includes(code as QLintCode)) {
      warnings.push(`Unknown q lint rule ${code}; using known rule defaults.`);
      continue;
    }
    if (!isSeverity(severity)) {
      warnings.push(`Invalid severity for ${code}; using its default.`);
      continue;
    }
    rules[code as QLintCode] = severity;
  }
  const settings: QLanguageSettings = Object.freeze({
    enabled: boolean(input.enabled, true),
    diagnostics: Object.freeze({
      debounceMs: integer(diagnostics.debounceMs, 250, 0, 5_000, warnings, 'diagnostics.debounceMs'),
      maxProblems: integer(diagnostics.maxProblems, 200, 1, 1_000, warnings, 'diagnostics.maxProblems'),
    }),
    maxFileSizeBytes: integer(
      input.maxFileSizeBytes,
      2_097_152,
      65_536,
      52_428_800,
      warnings,
      'maxFileSizeBytes'
    ),
    workspace: Object.freeze({
      include: stringArray(workspace.include, DEFAULT_Q_LANGUAGE_SETTINGS.workspace.include, warnings, 'workspace.include'),
      exclude: stringArray(workspace.exclude, DEFAULT_Q_LANGUAGE_SETTINGS.workspace.exclude, warnings, 'workspace.exclude'),
      maxFiles: integer(workspace.maxFiles, 5_000, 1, 20_000, warnings, 'workspace.maxFiles'),
    }),
    lint: Object.freeze({
      enabled: boolean(lint.enabled, true),
      rules: Object.freeze(rules),
    }),
    connectedIntelligence: boolean(input.connectedIntelligence, false),
  });
  return { settings, warnings: Object.freeze(warnings) };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function integer(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  warnings: string[],
  name: string,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    warnings.push(`Invalid ${name}; using ${fallback}.`);
    return fallback;
  }
  return value as number;
}

function stringArray(
  value: unknown,
  fallback: readonly string[],
  warnings: string[],
  name: string,
): readonly string[] {
  if (value === undefined) {
    return Object.freeze([...fallback]);
  }
  if (!Array.isArray(value) || value.length > 32 || value.some(item => typeof item !== 'string' || !item || item.length > 512)) {
    warnings.push(`Invalid ${name}; using defaults.`);
    return Object.freeze([...fallback]);
  }
  return Object.freeze([...new Set(value)]);
}

function isSeverity(value: unknown): value is QLintSeverity {
  return value === 'error' || value === 'warning' || value === 'information' ||
    value === 'hint' || value === 'off';
}
