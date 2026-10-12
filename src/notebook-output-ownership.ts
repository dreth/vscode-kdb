import { KX_NOTEBOOK_MIME } from './notebook-contract';
import {
  MAX_NOTEBOOK_KX_OUTPUT_ITEMS,
  NOTEBOOK_LIVE_RESULT_METADATA_KEY,
  NotebookKxOutputIdentityInspection,
  NotebookLiveResultReference,
  NotebookOutputBindingReference,
  inspectNotebookKxOutputIdentity,
  parseNotebookLiveResultFromMetadata,
  parseNotebookOutputBindingFromMetadata,
} from './notebook-message';

type OutputItem = { mime: string; data?: Uint8Array; value?: unknown };
export type NotebookOutputOwnershipInspection =
  | { status: 'none' | 'legacy' }
  | { status: 'invalid'; bindingIds: string[] }
  | { status: 'valid'; identity: {
    binding: NotebookOutputBindingReference;
    live?: NotebookLiveResultReference;
  } };

/** Host-only proof cache. Never retains the parsed portable result. Borrowed
 * bytes are checked against an owned snapshot on every hit, including Buffers
 * (whose slice() aliases storage). Metadata and live-store scope remain fresh. */
export class NotebookOutputOwnershipCache {
  private readonly proofs = new Map<Uint8Array, { bytes: Buffer; outputId: string }>();
  private snapshotBytes = 0;

  constructor(
    private readonly byteBudget = 128 * 1024 * 1024,
    private readonly maxEntries = 32
  ) {}

  inspect(metadata: unknown, items: readonly OutputItem[]): NotebookOutputOwnershipInspection {
    const binding = parseNotebookOutputBindingFromMetadata(metadata);
    const live = parseNotebookLiveResultFromMetadata(metadata);
    // Value-backed items are mutable object trees: use canonical validation.
    const kxItems = Array.isArray(items) && items.length <= MAX_NOTEBOOK_KX_OUTPUT_ITEMS
      ? items.filter(item => item?.mime === KX_NOTEBOOK_MIME)
      : [];
    const item = kxItems.length === 1 ? kxItems[0] : undefined;
    const data = item?.value === undefined && item?.data instanceof Uint8Array
      ? item.data : undefined;
    if (!binding || (declaresLive(metadata) && !live) || !data) {
      return ownershipOnly(inspectNotebookKxOutputIdentity(metadata, items));
    }

    const proof = this.proofs.get(data);
    if (proof && proof.outputId === binding.id && proof.bytes.equals(
      Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    )) {
      this.proofs.delete(data);
      this.proofs.set(data, proof);
      return { status: 'valid', identity: { binding, ...(live ? { live } : {}) } };
    }
    this.remove(data);
    // Validate the owned bytes so the retained proof is tied to its snapshot.
    const bytes = Buffer.from(data);
    const inspected = inspectNotebookKxOutputIdentity(
      metadata,
      items.map(candidate => candidate === item ? { mime: candidate.mime, data: bytes } : candidate)
    );
    if (inspected.status === 'valid') {
      // A single large output is allowed: the budget is eviction policy, not
      // another notebook/output size limit.
      while (this.proofs.size && (
        this.snapshotBytes + bytes.byteLength > this.byteBudget ||
        this.proofs.size >= Math.max(1, this.maxEntries)
      )) {
        this.remove(this.proofs.keys().next().value!);
      }
      this.proofs.set(data, { bytes, outputId: inspected.identity.binding.id });
      this.snapshotBytes += bytes.byteLength;
    }
    return ownershipOnly(inspected);
  }

  clear(): void {
    this.proofs.clear();
    this.snapshotBytes = 0;
  }

  private remove(data: Uint8Array): void {
    const old = this.proofs.get(data);
    if (old) {
      this.snapshotBytes -= old.bytes.byteLength;
      this.proofs.delete(data);
    }
  }
}

function ownershipOnly(inspected: NotebookKxOutputIdentityInspection): NotebookOutputOwnershipInspection {
  if (inspected.status === 'valid') {
    const { binding, live } = inspected.identity;
    return { status: 'valid', identity: { binding, ...(live ? { live } : {}) } };
  }
  return inspected.status === 'legacy' ? { status: 'legacy' } : inspected;
}

function declaresLive(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false;
  }
  const raw = metadata as Record<string, unknown>;
  const nested = raw.metadata;
  return Object.prototype.hasOwnProperty.call(raw, NOTEBOOK_LIVE_RESULT_METADATA_KEY) ||
    (!!nested && typeof nested === 'object' && !Array.isArray(nested) &&
      Object.prototype.hasOwnProperty.call(nested, NOTEBOOK_LIVE_RESULT_METADATA_KEY));
}

export const notebookOutputOwnershipCache = new NotebookOutputOwnershipCache();
