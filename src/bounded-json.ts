export const DEFAULT_BOUNDED_JSON_DEPTH = 64;
export const DEFAULT_BOUNDED_JSON_NODES = 50_000;

/**
 * Deterministic JSON-like serialization with hard traversal and allocation
 * bounds. Notebook metadata is untrusted persisted input; callers must treat
 * `undefined` as "cannot safely compare or fingerprint".
 */
export function stableBoundedJson(
  value: unknown,
  maxBytes: number,
  maxDepth = DEFAULT_BOUNDED_JSON_DEPTH,
  maxNodes = DEFAULT_BOUNDED_JSON_NODES
): string | undefined {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 ||
    !Number.isSafeInteger(maxDepth) || maxDepth < 0 ||
    !Number.isSafeInteger(maxNodes) || maxNodes < 1) {
    return undefined;
  }
  const chunks: string[] = [];
  const seen = new Set<object>();
  let bytes = 0;
  let nodes = 0;

  const append = (part: string): boolean => {
    const remaining = maxBytes - bytes;
    // Every UTF-16 code unit occupies at least one UTF-8 byte. This rejects a
    // huge string before JSON.stringify can allocate its escaped form.
    if (part.length > remaining) {
      return false;
    }
    const partBytes = Buffer.byteLength(part, 'utf8');
    if (partBytes > remaining) {
      return false;
    }
    chunks.push(part);
    bytes += partBytes;
    return true;
  };

  const appendString = (part: string): boolean => {
    const remaining = maxBytes - bytes;
    if (jsonStringBytesWithin(part, remaining) === undefined) {
      return false;
    }
    return append(JSON.stringify(part));
  };

  const visit = (current: unknown, depth: number): boolean => {
    nodes += 1;
    if (nodes > maxNodes || depth > maxDepth) {
      return false;
    }
    if (current === null || typeof current === 'undefined') {
      return append('null');
    }
    if (typeof current === 'string') {
      return appendString(current);
    }
    if (typeof current === 'number' || typeof current === 'boolean') {
      return append(JSON.stringify(current) ?? 'null');
    }
    if (typeof current !== 'object') {
      return appendString(String(current));
    }
    if (seen.has(current)) {
      return false;
    }
    seen.add(current);
    try {
      if (Array.isArray(current)) {
        if (current.length > maxNodes - nodes || !append('[')) {
          return false;
        }
        for (let index = 0; index < current.length; index++) {
          if (index > 0 && !append(',')) {
            return false;
          }
          if (!visit(current[index], depth + 1)) {
            return false;
          }
        }
        return append(']');
      }

      const keys: string[] = [];
      for (const key in current as Record<string, unknown>) {
        if (!Object.prototype.hasOwnProperty.call(current, key)) {
          continue;
        }
        if (keys.length >= maxNodes - nodes || key.length > maxBytes) {
          return false;
        }
        keys.push(key);
      }
      keys.sort();
      if (!append('{')) {
        return false;
      }
      for (let index = 0; index < keys.length; index++) {
        if (index > 0 && !append(',')) {
          return false;
        }
        const key = keys[index];
        if (!appendString(key) || !append(':') ||
          !visit((current as Record<string, unknown>)[key], depth + 1)) {
          return false;
        }
      }
      return append('}');
    } catch {
      return false;
    } finally {
      seen.delete(current);
    }
  };

  return visit(value, 0) ? chunks.join('') : undefined;
}

function jsonStringBytesWithin(value: string, limit: number): number | undefined {
  let bytes = 2;
  if (bytes > limit) {
    return undefined;
  }
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c ||
      code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) {
      bytes += 2;
    } else if (code < 0x20 ||
      (code >= 0xd800 && code <= 0xdfff &&
        !(code <= 0xdbff && index + 1 < value.length &&
          value.charCodeAt(index + 1) >= 0xdc00 &&
          value.charCodeAt(index + 1) <= 0xdfff))) {
      bytes += 6;
    } else if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
    if (bytes > limit) {
      return undefined;
    }
  }
  return bytes;
}

export function cloneBoundedJson<T>(value: T, maxBytes: number): T | undefined {
  if (typeof value === 'undefined') {
    return value;
  }
  const serialized = stableBoundedJson(value, maxBytes);
  if (serialized === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(serialized) as T;
  } catch {
    return undefined;
  }
}
