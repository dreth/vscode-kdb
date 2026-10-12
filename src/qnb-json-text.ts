/** Validate saved output JSON without allocating its entire object tree. */
export class QnbJsonTextError extends Error {
  public constructor(message: string, public readonly syntax: boolean) { super(message); }
}
export interface QnbJsonText { readonly text: string }
const validatedText = new WeakSet<QnbJsonText>();
export function isValidatedQnbJsonText(value: QnbJsonText): boolean { return validatedText.has(value); }

export function compactQnbJsonText(text: string, maxDepth: number): QnbJsonText {
  let offset = 0;
  let pendingLength = 0;
  let pending: string[] = [];
  const chunks: string[] = [];
  let validationError: QnbJsonTextError | undefined;
  const fail = (): never => { throw new QnbJsonTextError('Malformed output JSON.', true); };
  const append = (token: string): void => {
    pending.push(token);
    pendingLength += token.length;
    if (pendingLength >= 65536) {
      chunks.push(pending.join('')); pending = []; pendingLength = 0;
    }
  };
  const whitespace = (): void => {
    while (offset < text.length) {
      const c = text.charCodeAt(offset);
      if (c !== 32 && c !== 9 && c !== 10 && c !== 13) break;
      offset++;
    }
  };
  const string = (key: boolean): void => {
    const start = offset++;
    let escaped = false;
    while (offset < text.length) {
      const c = text.charCodeAt(offset++);
      if (c === 34) {
        const token = text.slice(start, offset);
        if (key && (escaped ? (JSON.parse(token) as string).length : token.length - 2) > 512) {
          validationError ??= new QnbJsonTextError('Output JSON contains an overlong field name.', false);
        }
        append(token); return;
      }
      if (c < 32) fail();
      if (c !== 92) continue;
      escaped = true;
      const escape = text.charAt(offset++);
      if (escape === 'u') {
        for (let n = 0; n < 4; n++) {
          const h = text.charCodeAt(offset++);
          if (!((h >= 48 && h <= 57) || (h >= 65 && h <= 70) || (h >= 97 && h <= 102))) fail();
        }
      } else if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escape)) fail();
    }
    fail();
  };
  const digit = (): boolean => text.charCodeAt(offset) >= 48 && text.charCodeAt(offset) <= 57;
  const value = (depth: number): void => {
    if (depth > maxDepth) throw new QnbJsonTextError('Output JSON is nested too deeply.', false);
    whitespace();
    const c = text.charAt(offset);
    if (c === '"') { string(false); return; }
    if (c === '[' || c === '{') {
      const object = c === '{';
      const close = object ? '}' : ']';
      offset++; append(c); whitespace();
      if (text.charAt(offset) !== close) {
        while (true) {
          if (object) {
            whitespace();
            if (text.charAt(offset) !== '"') fail();
            string(true); whitespace();
            if (text.charAt(offset++) !== ':') fail();
            append(':');
          }
          value(depth + 1); whitespace();
          if (text.charAt(offset) !== ',') break;
          offset++; append(',');
        }
      }
      if (text.charAt(offset++) !== close) fail();
      append(close); return;
    }
    for (const literal of ['null', 'true', 'false']) {
      if (text.startsWith(literal, offset)) { offset += literal.length; append(literal); return; }
    }
    const start = offset;
    if (c === '-') offset++;
    if (text.charAt(offset) === '0') offset++;
    else {
      if (!digit()) fail();
      while (digit()) offset++;
    }
    if (text.charAt(offset) === '.') {
      offset++; if (!digit()) fail();
      while (digit()) offset++;
    }
    if (text.charAt(offset) === 'e' || text.charAt(offset) === 'E') {
      offset++;
      if (text.charAt(offset) === '+' || text.charAt(offset) === '-') offset++;
      if (!digit()) fail();
      while (digit()) offset++;
    }
    const number = Number(text.slice(start, offset));
    if (!Number.isFinite(number)) validationError ??= new QnbJsonTextError('Output JSON contains a non-finite number.', false);
    append(JSON.stringify(number));
  };
  value(0); whitespace();
  if (offset !== text.length) fail();
  if (validationError) throw validationError;
  if (pending.length) chunks.push(pending.join(''));
  const result = Object.freeze({ text: chunks.join('') });
  validatedText.add(result);
  return result;
}
