import { promises as fs } from 'fs';
import * as path from 'path';
import { KxConnection, validateConnection } from './connection';

export interface CredentialContext {
  folder?: string;
  trusted: boolean;
  environment?: NodeJS.ProcessEnv;
  readFile?: (file: string) => Promise<string>;
}

/** Single-line dotenv data; quoted escapes follow Python dotenv, without expansion. */
export function parseCredentialEnv(text: string): Record<string, string> {
  const values: Record<string, string> = Object.create(null);
  for (const [index, line] of text.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    const assignment = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    const invalid = (): never => { throw new Error(`Invalid credential env file at line ${index + 1}.`); };
    if (!assignment) invalid();
    const [, key, raw] = assignment!;
    if (Object.hasOwn(values, key)) invalid();
    let value: string;
    if (raw.startsWith('"') || raw.startsWith("'")) {
      const quote = raw[0];
      let end = 1;
      for (; end < raw.length; end++) {
        if (raw[end] === '\\') { end++; continue; }
        if (raw[end] === quote) break;
      }
      if (end >= raw.length || !/^\s*(?:#.*)?$/.test(raw.slice(end + 1))) invalid();
      const escapes: Record<string, string> = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', '"': '"', "'": "'" };
      value = raw.slice(1, end).replace(quote === '"' ? /\\([abfnrtv\\'"])/g : /\\([\\'])/g,
        (_match, escaped: string) => escapes[escaped]);
    } else {
      value = raw.replace(/\s+#.*$/, '').trim();
    }
    if (value.includes('\0')) invalid();
    values[key] = value;
  }
  return values;
}

export function credentialFile(file: string, folder?: string): string {
  if (file.includes('${workspaceFolder}')) {
    if (!folder) throw new Error('Credential envFile needs an unambiguous workspace folder.');
    file = file.replace(/\$\{workspaceFolder\}/g, folder);
  }
  if (file.includes('${')) throw new Error('Unsupported credential envFile variable.');
  if (!path.isAbsolute(file)) {
    if (!folder) throw new Error('Relative credential envFile needs an unambiguous workspace folder.');
    file = path.resolve(folder, file);
  }
  return file;
}

export async function resolveEnvironmentCredentials(
  connection: KxConnection,
  legacyPassword: string | undefined,
  context: CredentialContext
): Promise<{ username: string; password: string | undefined }> {
  const referenced = connection.usernameEnv || connection.passwordEnv;
  if (!referenced) return { username: connection.username, password: legacyPassword };
  if (!context.trusted) throw new Error('Trust this workspace before resolving credential references.');
  let values: Record<string, string> = Object.create(null);
  if (connection.envFile) {
    const file = credentialFile(connection.envFile, context.folder);
    let text: string;
    try { text = await (context.readFile || (file => fs.readFile(file, 'utf8')))(file); }
    catch (error) {
      if (connection.credentialTransport === 'request' && (error as NodeJS.ErrnoException).code === 'ENOENT') text = '';
      else throw new Error(`Cannot read credential envFile: ${file}`);
    }
    values = parseCredentialEnv(text);
  }
  const environment = context.environment || process.env;
  const resolve = (key: string): string => {
    const value = Object.hasOwn(values, key) ? values[key] : environment[key];
    if (value === undefined || value.trim() === '') {
      if (connection.credentialTransport === 'request') return '';
      throw new Error(`Missing credential variable: ${key}`);
    }
    return value;
  };
  const username = connection.usernameEnv ? resolve(connection.usernameEnv) : connection.username;
  const password = connection.passwordEnv ? resolve(connection.passwordEnv) : legacyPassword;
  if (connection.credentialTransport === 'request' && (!username.trim() || !password?.trim())) {
    return { username: '', password: undefined };
  }
  // Validate effective values without storing them in the connection metadata.
  validateConnection({ ...connection, username, password });
  return { username, password };
}
