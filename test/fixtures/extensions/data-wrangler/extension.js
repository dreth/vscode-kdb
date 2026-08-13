'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const vscode = require('vscode');

const COMMAND = 'dataWrangler.openInDataWrangler';
const EVIDENCE_FILE = 'data-wrangler-handoff.json';

function activate(context) {
  context.subscriptions.push(vscode.commands.registerCommand(COMMAND, async (...args) => {
    if (args.length !== 1 || !(args[0] instanceof vscode.Uri) || args[0].scheme !== 'file') {
      throw new Error(`${COMMAND} requires exactly one vscode.Uri with the file scheme.`);
    }

    const csvUri = args[0];
    const csvPath = path.resolve(csvUri.fsPath);
    if (path.extname(csvPath).toLowerCase() !== '.csv') {
      throw new Error(`${COMMAND} requires a local .csv handoff.`);
    }

    const handle = await fs.open(csvPath, 'r');
    let bytes;
    let openedStat;
    try {
      openedStat = await handle.stat();
      if (!openedStat.isFile()) {
        throw new Error(`${COMMAND} requires a regular CSV file.`);
      }
      bytes = await handle.readFile();
    } finally {
      await handle.close();
    }
    const closedStat = await fs.stat(csvPath);
    if (openedStat.size !== bytes.length || closedStat.size !== bytes.length ||
        openedStat.mtimeMs !== closedStat.mtimeMs) {
      throw new Error(`${COMMAND} observed an incomplete or changing CSV handoff.`);
    }

    const configuredControlDir = process.env.VSCODE_KDB_E2E_CONTROL_DIR;
    if (!configuredControlDir || !path.isAbsolute(configuredControlDir)) {
      throw new Error('The Data Wrangler test fake requires an absolute E2E control directory.');
    }
    const controlDir = path.resolve(configuredControlDir);
    const evidencePath = path.join(controlDir, EVIDENCE_FILE);
    if (path.dirname(evidencePath) !== controlDir) {
      throw new Error('Refusing to write Data Wrangler evidence outside the E2E control directory.');
    }
    const evidence = {
      version: 1,
      extensionId: 'ms-toolsai.datawrangler',
      command: COMMAND,
      argumentCount: args.length,
      csvUri: csvUri.toString(),
      csvPath,
      byteLength: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      stableCompleteRead: true,
    };
    await fs.writeFile(
      evidencePath,
      `${JSON.stringify(evidence, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 }
    );
    return evidence;
  }));
}

function deactivate() {}

module.exports = { activate, deactivate };
