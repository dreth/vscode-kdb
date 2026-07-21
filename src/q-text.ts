export function selectedTextOrCurrentLine(documentText: string, selectionText: string, cursorLine: number): string {
  if (selectionText.length > 0) {
    return selectionText;
  }

  const lines = documentText.split(/\r?\n/);
  if (lines.length === 0) {
    return '';
  }

  const clampedLine = Math.min(Math.max(cursorLine, 0), lines.length - 1);
  return lines[clampedLine] || '';
}

export function qSelectionExecutionKind(selectionText: string): 'query' | 'script' {
  return /[\r\n]/.test(selectionText) ? 'script' : 'query';
}
