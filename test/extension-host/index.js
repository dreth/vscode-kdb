'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const EXTENSION_ID = 'DanielAlonso.vscode-kdb';
const CONNECTIONS_SETTING = 'connections';
const SET_Q_COMMAND = 'vscode-kdb.setNotebookCellLanguageQ';
const RESTORE_LANGUAGE_COMMAND = 'vscode-kdb.restoreNotebookCellLanguage';
const SET_ACTIVE_CONNECTION_COMMAND = 'vscode-kdb.setActiveConnection';
const SELECT_QUERY_CONNECTION_COMMAND = 'vscode-kdb.selectQueryConnection';
const DIRECT_CONTROLLER_SETTING = 'enableDirectController';

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
      port: 5005,
      database: '.research',
      username: '',
    },
  ];
}

async function waitFor(label, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (predicate()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(`timed out waiting for ${label}`);
}

async function closeNotebookTab(uri) {
  const uriText = uri.toString();
  const tab = vscode.window.tabGroups.all
    .flatMap(group => group.tabs)
    .find(candidate => candidate.input?.uri?.toString() === uriText);
  assert(tab, `open notebook tab ${uriText} was not found`);
  assert.strictEqual(
    await vscode.window.tabGroups.close(tab),
    true,
    `VS Code refused to close notebook tab ${uriText}`
  );
}

async function exerciseConnectionStore(testApi) {
  const configuration = vscode.workspace.getConfiguration('vscode-kdb');
  const previous = configuration.inspect(CONNECTIONS_SETTING)?.globalValue;
  const profiles = connectionProfiles();
  const passwords = {
    [profiles[0].id]: ['extension', 'host', 'secret', 'one'].join('-'),
    [profiles[1].id]: ['extension', 'host', 'secret', 'two'].join('-'),
  };
  try {
    await testApi.addConnection(profiles[0], passwords[profiles[0].id]);
    assert.deepStrictEqual(
      testApi.connections().map(profile => profile.id),
      [profiles[0].id],
      'the first resolved store add must be visible immediately'
    );
    assert.strictEqual(testApi.activeConnectionId(), profiles[0].id);

    await testApi.addConnection(profiles[1], passwords[profiles[1].id]);
    assert.deepStrictEqual(
      testApi.connections().map(profile => profile.id),
      profiles.map(profile => profile.id),
      'the second resolved store add must retain the first profile'
    );
    await waitFor('two effective application-scoped profiles', () => {
      const effective = vscode.workspace
        .getConfiguration('vscode-kdb')
        .get(CONNECTIONS_SETTING);
      return Array.isArray(effective) && effective.length === 2;
    });
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
    assert.strictEqual(await testApi.hasPassword(profiles[0].id), true);
    assert.strictEqual(await testApi.hasPassword(profiles[1].id), true);

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
    assert.strictEqual(testApi.activeConnectionId(), profiles[1].id);

    const expected = testApi.connection(profiles[1].id);
    assert.strictEqual(expected.port, 5005);
    const edited = { ...expected, port: 5000 };
    await testApi.updateConnection(edited, undefined, expected);
    assert.strictEqual(
      testApi.connection(profiles[1].id).port,
      5000,
      'editing the same stable profile ID must be visible immediately'
    );
    assert.strictEqual(
      testApi.connections().length,
      2,
      'editing one profile must retain both profiles'
    );
    await waitFor('edited profile port 5000 in global settings', () => {
      const effective = vscode.workspace
        .getConfiguration('vscode-kdb')
        .get(CONNECTIONS_SETTING);
      return Array.isArray(effective) &&
        effective.length === 2 &&
        effective.find(profile => profile.id === edited.id)?.port === 5000;
    });

    const targetMetadata = {
      metadata: {
        'vscode-kdb': {
          version: 1,
          qTarget: {
            id: edited.id,
            name: edited.name,
          },
        },
      },
    };
    assert.deepStrictEqual(
      Object.keys(targetMetadata.metadata['vscode-kdb'].qTarget).sort(),
      ['id', 'name'],
      'notebook target metadata must contain only stable safe identity fields'
    );
    const resolved = testApi.resolveNotebookTarget(targetMetadata);
    assert(resolved, 'the saved notebook target ID must resolve through the current store');
    assert.strictEqual(resolved.id, edited.id);
    assert.strictEqual(resolved.port, 5000);

    await vscode.commands.executeCommand(
      SET_ACTIVE_CONNECTION_COMMAND,
      profiles[0].id
    );
    assert.strictEqual(testApi.activeConnectionId(), profiles[0].id);
    assert.strictEqual(
      testApi.resolveNotebookTarget(targetMetadata).port,
      5000,
      'changing the global active profile must not override an explicit notebook target ID'
    );
    assert.strictEqual(testApi.resolveNotebookTarget({
      metadata: {
        'vscode-kdb': {
          version: 1,
          qTarget: { id: 'e2e-removed-profile', name: 'Removed profile' },
        },
      },
    }), undefined, 'a missing notebook target must not fall back to the active or first profile');

    assert.strictEqual(
      vscode.workspace.getConfiguration('vscode-kdb').get(CONNECTIONS_SETTING).length,
      2,
      'selecting an active profile must not discard another profile'
    );
  } finally {
    for (const profile of profiles) {
      await testApi.removeConnection(profile.id).catch(() => undefined);
    }
    await testApi.setActiveConnection(undefined);
    for (const profile of profiles) {
      assert.strictEqual(
        await testApi.hasPassword(profile.id),
        false,
        `Extension Host cleanup must delete the test secret for ${profile.id}`
      );
    }
    await configuration.update(
      CONNECTIONS_SETTING,
      previous,
      vscode.ConfigurationTarget.Global
    );
  }
}

async function exerciseDirectControllerLifecycle(testApi) {
  const configuration = vscode.workspace.getConfiguration('vscode-kdb.notebook');
  const previous = configuration.inspect(DIRECT_CONTROLLER_SETTING)?.globalValue;
  try {
    assert.strictEqual(
      configuration.get(DIRECT_CONTROLLER_SETTING),
      false,
      'the optional KX q-only controller setting must default to false'
    );
    assert.strictEqual(
      testApi.isDirectControllerRegistered(),
      false,
      'KX q Direct IPC must not register as a kernel candidate by default'
    );

    await configuration.update(
      DIRECT_CONTROLLER_SETTING,
      true,
      vscode.ConfigurationTarget.Global
    );
    await waitFor(
      'opt-in direct controller registration',
      () => testApi.isDirectControllerRegistered()
    );

    await configuration.update(
      DIRECT_CONTROLLER_SETTING,
      false,
      vscode.ConfigurationTarget.Global
    );
    await waitFor(
      'direct controller disposal',
      () => !testApi.isDirectControllerRegistered()
    );
  } finally {
    await configuration.update(
      DIRECT_CONTROLLER_SETTING,
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
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  await waitFor(
    'language-command notebook close',
    () => !vscode.workspace.notebookDocuments.includes(notebook)
  );
}

async function exerciseDurableMixedNotebook() {
  const fixturePath = path.join(
    path.resolve(__dirname, '..', '..'),
    '.vscode-test',
    'e2e',
    'durable-mixed.ipynb'
  );
  const reopenedPath = path.join(
    path.dirname(fixturePath),
    'durable-mixed-reopened.ipynb'
  );
  const fixture = {
    cells: [
      {
        cell_type: 'code',
        execution_count: null,
        metadata: {},
        outputs: [],
        source: ['answer:42\n', 'show answer'],
      },
      {
        cell_type: 'code',
        execution_count: null,
        metadata: {},
        outputs: [],
        source: ['python_answer = 6 * 7\n', 'print(python_answer)'],
      },
    ],
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
    nbformat: 4,
    nbformat_minor: 5,
  };
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
  fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  let uri = vscode.Uri.file(fixturePath);
  let notebook;
  try {
    notebook = await vscode.workspace.openNotebookDocument(uri);
    const editor = await vscode.window.showNotebookDocument(notebook, {
      preserveFocus: false,
      preview: false,
    });
    editor.selections = [new vscode.NotebookRange(0, 1)];
    await vscode.commands.executeCommand(SET_Q_COMMAND, notebook.cellAt(0));
    const targetMetadata = {
      ...notebook.metadata,
      metadata: {
        ...notebook.metadata.metadata,
        'vscode-kdb': {
          version: 1,
          qTarget: {
            id: 'durable-mixed-target',
            name: 'Durable mixed target',
          },
        },
      },
    };
    const metadataEdit = new vscode.WorkspaceEdit();
    metadataEdit.set(notebook.uri, [
      vscode.NotebookEdit.updateNotebookMetadata(targetMetadata),
    ]);
    assert.strictEqual(
      await vscode.workspace.applyEdit(metadataEdit),
      true,
      'saving the durable q target metadata failed'
    );

    assert.strictEqual(notebook.cellAt(0).document.languageId, 'q');
    assert.strictEqual(notebook.cellAt(0).document.getText(), 'answer:42\nshow answer');
    assert.deepStrictEqual(notebook.metadata.metadata['vscode-kdb'], {
      version: 1,
      qTarget: {
        id: 'durable-mixed-target',
        name: 'Durable mixed target',
      },
    });
    assert.strictEqual(notebook.cellAt(1).document.languageId, 'python');
    assert.strictEqual(
      notebook.cellAt(1).document.getText(),
      'python_answer = 6 * 7\nprint(python_answer)'
    );
    assert.strictEqual(notebook.metadata.metadata.kernelspec.language, 'python');
    assert.strictEqual(notebook.metadata.metadata.language_info.name, 'python');
    assert.deepStrictEqual(
      vscode.languages.getDiagnostics(notebook.cellAt(0).document.uri),
      [],
      'a durable q-language cell must not receive Python diagnostics'
    );

    assert.strictEqual(await notebook.save(), true, 'mixed notebook save failed');
    const firstNotebook = notebook;
    await closeNotebookTab(uri);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await waitFor(
      'mixed notebook editor close before reopen',
      () => !vscode.window.tabGroups.all
        .flatMap(group => group.tabs)
        .some(tab => tab.input?.uri?.toString() === uri.toString())
    );

    fs.renameSync(fixturePath, reopenedPath);
    uri = vscode.Uri.file(reopenedPath);
    notebook = await vscode.workspace.openNotebookDocument(uri);
    assert.notStrictEqual(
      notebook,
      firstNotebook,
      'reopened path must be deserialized as a new notebook document'
    );
    await vscode.window.showNotebookDocument(notebook, {
      preserveFocus: false,
      preview: false,
    });
    const qCell = notebook.cellAt(0);
    const pythonCell = notebook.cellAt(1);
    assert.strictEqual(qCell.document.languageId, 'q');
    assert.strictEqual(qCell.document.getText(), 'answer:42\nshow answer');
    assert.deepStrictEqual(qCell.metadata.metadata.vscode, {
      languageId: 'q',
    });
    assert.deepStrictEqual(notebook.metadata.metadata['vscode-kdb'], {
      version: 1,
      qTarget: {
        id: 'durable-mixed-target',
        name: 'Durable mixed target',
      },
    });
    assert.strictEqual(pythonCell.document.languageId, 'python');
    assert.strictEqual(
      pythonCell.document.getText(),
      'python_answer = 6 * 7\nprint(python_answer)'
    );
    assert.strictEqual(notebook.metadata.metadata.kernelspec.name, 'python3');
    assert.strictEqual(notebook.metadata.metadata.language_info.name, 'python');
    assert.deepStrictEqual(vscode.languages.getDiagnostics(qCell.document.uri), []);
  } finally {
    const openTab = vscode.window.tabGroups.all
      .flatMap(group => group.tabs)
      .find(tab => tab.input?.uri?.toString() === uri.toString());
    if (openTab) {
      await vscode.window.tabGroups.close(openTab);
    }
    fs.rmSync(fixturePath, { force: true });
    fs.rmSync(reopenedPath, { force: true });
  }
}

async function run() {
  const extension = kxExtension();
  assert(extension, `development extension ${EXTENSION_ID} was not loaded`);
  const extensionExports = await extension.activate();
  assert.strictEqual(extension.isActive, true, 'development extension must activate');
  const testApi = extensionExports?.extensionHostTest;
  assert(
    testApi,
    'the isolated Extension Host run must enable the narrow real-store test API'
  );

  const commands = new Set(await vscode.commands.getCommands(true));
  for (const command of [
    SET_Q_COMMAND,
    RESTORE_LANGUAGE_COMMAND,
    SET_ACTIVE_CONNECTION_COMMAND,
    SELECT_QUERY_CONNECTION_COMMAND,
  ]) {
    assert(commands.has(command), `activated extension must register ${command}`);
  }

  await exerciseConnectionStore(testApi);
  await exerciseDirectControllerLifecycle(testApi);
  await exerciseNotebookCellLanguageCommands();
  await exerciseDurableMixedNotebook();
  console.log(
    'KX Extension Host assertions passed: activation, real-store add/edit/remove, two-profile persistence, current notebook target resolution, active selection, default-off controller lifecycle, q conversion/restoration, and durable mixed-notebook reopen.'
  );
}

module.exports = { run };
