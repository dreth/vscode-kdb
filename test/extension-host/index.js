'use strict';

const assert = require('assert');
const vscode = require('vscode');

const EXTENSION_ID = 'DanielAlonso.vscode-kdb';
const CONNECTIONS_SETTING = 'connections';
const SET_Q_COMMAND = 'vscode-kdb.setNotebookCellLanguageQ';
const RESTORE_LANGUAGE_COMMAND = 'vscode-kdb.restoreNotebookCellLanguage';
const SET_ACTIVE_CONNECTION_COMMAND = 'vscode-kdb.setActiveConnection';

function kxExtension() {
  return vscode.extensions.getExtension(EXTENSION_ID) ||
    vscode.extensions.all.find(extension =>
      extension.packageJSON?.publisher === 'DanielAlonso' &&
      extension.packageJSON?.name === 'vscode-kdb'
    );
}

function connectionProfiles() {
  return [
    {
      id: 'e2e-profile-one',
      name: 'Extension Host One',
      host: '127.0.0.1',
      port: 5011,
      database: '.',
      username: '',
    },
    {
      id: 'e2e-profile-two',
      name: 'Extension Host Two',
      host: '127.0.0.1',
      port: 5012,
      database: '.research',
      username: '',
    },
  ];
}

async function exerciseConnectionSettings() {
  const configuration = vscode.workspace.getConfiguration('vscode-kdb');
  const previous = configuration.inspect(CONNECTIONS_SETTING)?.globalValue;
  const profiles = connectionProfiles();
  try {
    await configuration.update(
      CONNECTIONS_SETTING,
      profiles,
      vscode.ConfigurationTarget.Global
    );
    const persisted = vscode.workspace
      .getConfiguration('vscode-kdb')
      .inspect(CONNECTIONS_SETTING)?.globalValue;
    assert.deepStrictEqual(persisted, profiles, 'both profiles must persist in global settings');
    assert.strictEqual(persisted.length, 2, 'multiple profiles must remain visible to the store');
    for (const profile of persisted) {
      assert.strictEqual(
        Object.prototype.hasOwnProperty.call(profile, 'password'),
        false,
        'connection settings must not contain passwords'
      );
    }

    const selected = await vscode.commands.executeCommand(
      SET_ACTIVE_CONNECTION_COMMAND,
      profiles[1].id
    );
    assert(selected, 'selecting the second profile should return that profile');
    assert.strictEqual(
      selected.id,
      profiles[1].id,
      'active selection must honor the requested profile ID, not list order'
    );
    assert.strictEqual(
      vscode.workspace.getConfiguration('vscode-kdb').get(CONNECTIONS_SETTING).length,
      2,
      'selecting an active profile must not discard another profile'
    );
  } finally {
    await configuration.update(
      CONNECTIONS_SETTING,
      previous,
      vscode.ConfigurationTarget.Global
    );
  }
}

async function exerciseNotebookCellLanguageCommands() {
  const source = 'answer:42\nshow answer';
  const data = new vscode.NotebookData([
    new vscode.NotebookCellData(vscode.NotebookCellKind.Code, source, 'python'),
    new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'print("python")', 'python'),
  ]);
  data.metadata = {
    metadata: {
      kernelspec: {
        display_name: 'Python 3',
        language: 'python',
        name: 'python3',
      },
      language_info: {
        name: 'python',
      },
    },
  };

  const notebook = await vscode.workspace.openNotebookDocument('jupyter-notebook', data);
  const editor = await vscode.window.showNotebookDocument(notebook, {
    preserveFocus: false,
    preview: false,
  });
  editor.selections = [new vscode.NotebookRange(0, 1)];

  const originalCell = notebook.cellAt(0);
  assert.strictEqual(originalCell.document.languageId, 'python');
  assert.strictEqual(originalCell.document.getText(), source);
  assert.strictEqual(notebook.cellAt(1).document.languageId, 'python');

  await vscode.commands.executeCommand(SET_Q_COMMAND, originalCell);
  assert.strictEqual(
    notebook.cellAt(0).document.languageId,
    'q',
    'Make q Cell must use the public language API on the actual notebook cell'
  );
  assert.strictEqual(
    notebook.cellAt(0).document.getText(),
    source,
    'Make q Cell must preserve the complete cell source'
  );
  assert.strictEqual(
    notebook.cellAt(1).document.languageId,
    'python',
    'Make q Cell must not change another Python cell'
  );

  await vscode.commands.executeCommand(RESTORE_LANGUAGE_COMMAND, notebook.cellAt(0));
  assert.strictEqual(
    notebook.cellAt(0).document.languageId,
    'python',
    'Restore Cell Language must use the Jupyter notebook default language'
  );
  assert.strictEqual(notebook.cellAt(0).document.getText(), source);
}

async function run() {
  const extension = kxExtension();
  assert(extension, `development extension ${EXTENSION_ID} was not loaded`);
  await extension.activate();
  assert.strictEqual(extension.isActive, true, 'development extension must activate');

  const commands = new Set(await vscode.commands.getCommands(true));
  for (const command of [
    SET_Q_COMMAND,
    RESTORE_LANGUAGE_COMMAND,
    SET_ACTIVE_CONNECTION_COMMAND,
  ]) {
    assert(commands.has(command), `activated extension must register ${command}`);
  }

  await exerciseConnectionSettings();
  await exerciseNotebookCellLanguageCommands();
  console.log(
    'KX Extension Host assertions passed: activation, commands, two profiles, exact active selection, q conversion, and restoration.'
  );
}

module.exports = { run };
