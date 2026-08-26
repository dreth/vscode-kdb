const globCache = new Map<string, RegExp>();

export function workspacePathIncluded(
  relativePath: string,
  include: readonly string[],
  exclude: readonly string[],
): boolean {
  const candidate = normalizeWorkspacePath(relativePath);
  return include.some(pattern => workspaceGlobMatches(candidate, pattern)) &&
    !exclude.some(pattern => workspaceGlobMatches(candidate, pattern));
}

export function workspaceDirectoryExcluded(
  relativePath: string,
  exclude: readonly string[],
): boolean {
  const candidate = `${normalizeWorkspacePath(relativePath).replace(/\/$/, '')}/`;
  return exclude.some(pattern => workspaceGlobMatches(candidate, pattern));
}

export function workspaceGlobMatches(relativePath: string, pattern: string): boolean {
  const candidate = normalizeWorkspacePath(relativePath);
  const normalizedPattern = normalizeWorkspacePath(pattern).replace(/^\.\//, '');
  let expression = globCache.get(normalizedPattern);
  if (!expression) {
    expression = new RegExp(globPattern(normalizedPattern));
    globCache.set(normalizedPattern, expression);
  }
  return expression.test(candidate);
}

function normalizeWorkspacePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '');
}

function globPattern(value: string): string {
  let result = '^';
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === '*') {
      if (value[index + 1] === '*') {
        index++;
        if (value[index + 1] === '/') {
          index++;
          result += '(?:.*/)?';
        } else {
          result += '.*';
        }
      } else {
        result += '[^/]*';
      }
    } else if (character === '?') {
      result += '[^/]';
    } else {
      result += /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
    }
  }
  return `${result}$`;
}
