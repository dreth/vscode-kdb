import { PortableKxResult, validatePortableKxResult } from './notebook-contract';
import { NotebookSettings } from './notebook-settings';

export type NotebookRendererMessage =
  | { type: 'ready' }
  | { type: 'openPreview'; payload: PortableKxResult };

export interface NotebookRendererSettingsMessage extends NotebookSettings {
  type: 'settings';
}

export function parseNotebookRendererMessage(raw: unknown): NotebookRendererMessage | undefined {
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    return undefined;
  }
  if (raw.type === 'ready') {
    return Object.keys(raw).length === 1 ? { type: 'ready' } : undefined;
  }
  if (raw.type !== 'openPreview' || !hasOnlyKeys(raw, ['type', 'payload'])) {
    return undefined;
  }
  const validation = validatePortableKxResult(raw.payload);
  return validation.ok ? { type: 'openPreview', payload: validation.value } : undefined;
}

export function notebookRendererSettingsMessage(settings: NotebookSettings): NotebookRendererSettingsMessage {
  return { type: 'settings', ...settings };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every(key => allowedKeys.has(key));
}
