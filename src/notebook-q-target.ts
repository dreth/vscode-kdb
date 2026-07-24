export const KX_NOTEBOOK_TARGET_METADATA_KEY = 'vscode-kdb';
export const KX_NOTEBOOK_TARGET_METADATA_VERSION = 1;

const MAX_CONNECTION_ID_LENGTH = 128;
const MAX_CONNECTION_NAME_LENGTH = 100;

export interface NotebookQTargetProfile {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
  readonly connected: boolean;
}

export interface NotebookQTargetReference {
  readonly id: string;
  readonly name: string;
}

export type NotebookQTargetResolution =
  | {
    readonly kind: 'unselected';
  }
  | {
    readonly kind: 'missing';
    readonly reference: NotebookQTargetReference;
  }
  | {
    readonly kind: 'resolved';
    readonly reference: NotebookQTargetReference;
    readonly profile: NotebookQTargetProfile;
    readonly renamed: boolean;
  };

export function storedNotebookQTarget(metadata: unknown): NotebookQTargetReference | undefined {
  if (!isRecord(metadata)) {
    return undefined;
  }
  const persistedMetadata = isRecord(metadata.metadata) ? metadata.metadata : undefined;
  const kxMetadata = persistedMetadata &&
    isRecord(persistedMetadata[KX_NOTEBOOK_TARGET_METADATA_KEY])
    ? persistedMetadata[KX_NOTEBOOK_TARGET_METADATA_KEY]
    : undefined;
  const target = kxMetadata && isRecord(kxMetadata.qTarget)
    ? kxMetadata.qTarget
    : undefined;
  if (!target) {
    return undefined;
  }
  const id = safeConnectionId(target.id);
  const name = safeConnectionName(target.name);
  return id && name ? { id, name } : undefined;
}

export function resolveNotebookQTarget(
  metadata: unknown,
  profiles: readonly NotebookQTargetProfile[]
): NotebookQTargetResolution {
  const reference = storedNotebookQTarget(metadata);
  if (!reference) {
    return { kind: 'unselected' };
  }
  const profile = profiles.find(candidate => candidate.id === reference.id);
  if (!profile) {
    return { kind: 'missing', reference };
  }
  return {
    kind: 'resolved',
    reference,
    profile,
    renamed: profile.name !== reference.name,
  };
}

export function withNotebookQTarget(
  metadata: Readonly<Record<string, unknown>>,
  profile: Pick<NotebookQTargetProfile, 'id' | 'name'>
): Record<string, unknown> {
  const id = safeConnectionId(profile.id);
  const name = safeConnectionName(profile.name);
  if (!id || !name) {
    throw new Error('The selected KX notebook target has an invalid identity.');
  }
  const persistedMetadata = isRecord(metadata.metadata) ? metadata.metadata : {};
  const currentKxMetadata =
    isRecord(persistedMetadata[KX_NOTEBOOK_TARGET_METADATA_KEY])
      ? persistedMetadata[KX_NOTEBOOK_TARGET_METADATA_KEY]
      : {};
  return {
    ...metadata,
    metadata: {
      ...persistedMetadata,
      [KX_NOTEBOOK_TARGET_METADATA_KEY]: {
        ...currentKxMetadata,
        version: KX_NOTEBOOK_TARGET_METADATA_VERSION,
        qTarget: { id, name },
      },
    },
  };
}

export function safeConnectionName(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const safe = value
    .replace(/[\0-\x1f\x7f]/g, '')
    .slice(0, MAX_CONNECTION_NAME_LENGTH)
    .trim();
  return safe || undefined;
}

function safeConnectionId(value: unknown): string | undefined {
  if (typeof value !== 'string' ||
      value.length < 1 ||
      value.length > MAX_CONNECTION_ID_LENGTH ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    return undefined;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
