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
const OPEN_NOTEBOOK_PREVIEW_IN_RESULTS_COMMAND =
  'vscode-kdb.openNotebookPreviewInResults';
const DIRECT_CONTROLLER_SETTING = 'enableDirectController';
const RUN_Q_NOTEBOOK_CELL_COMMAND = 'vscode-kdb.runQNotebookCell';
const KX_NOTEBOOK_MIME = 'application/vnd.kx.result+json';
const KX_OUTPUT_METADATA_KEY = 'vscode-kdb.outputBinding';
const KX_LIVE_METADATA_KEY = 'vscode-kdb.liveResult';

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

    await testApi.setActiveConnection(profiles[1].id);
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
    assert(resolved, 'the active profile must resolve through the current store');
    assert.strictEqual(resolved.id, edited.id);
    assert.strictEqual(resolved.port, 5000);

    await testApi.setActiveConnection(profiles[0].id);
    assert.strictEqual(testApi.activeConnectionId(), profiles[0].id);
    assert.strictEqual(
      testApi.resolveNotebookTarget(targetMetadata).id,
      profiles[0].id,
      'legacy notebook target metadata must not override the globally starred active profile'
    );
    assert.strictEqual(testApi.resolveNotebookTarget({
      metadata: {
        'vscode-kdb': {
          version: 1,
          qTarget: { id: 'e2e-removed-profile', name: 'Removed profile' },
        },
      },
    }).id, profiles[0].id, 'unknown legacy notebook target metadata must still route only to the active profile');

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
      'the optional pure-q KX controller setting must default to false'
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
  const controlDir = process.env.VSCODE_KDB_E2E_CONTROL_DIR;
  assert(controlDir, 'the Extension Host test requires its isolated control directory');
  const fixturePath = path.join(controlDir, 'durable-mixed.ipynb');
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

function portableOutputItem(cell) {
  const item = cell.outputs.flatMap(output => output.items)
    .find(candidate => candidate.mime === KX_NOTEBOOK_MIME);
  assert(item, `notebook cell must contain ${KX_NOTEBOOK_MIME}`);
  return item;
}

function portableOutput(cell) {
  const item = portableOutputItem(cell);
  return JSON.parse(new TextDecoder().decode(item.data));
}

function portableOutputByteLength(cell) {
  return portableOutputItem(cell).data.byteLength;
}

function outputIdentity(output) {
  return outputMetadataIdentity(output, KX_OUTPUT_METADATA_KEY, 'output');
}

function liveOutputIdentity(output) {
  return outputMetadataIdentity(output, KX_LIVE_METADATA_KEY, 'live-result');
}

function outputMetadataIdentity(output, key, label) {
  const direct = output.metadata?.[key];
  const nested = output.metadata?.metadata?.[key];
  if (direct && nested) {
    assert.deepStrictEqual(
      direct,
      nested,
      `duplicate notebook ${label} identities must agree completely`
    );
  }
  return direct || nested;
}

async function closeNotebookTabs(notebook) {
  if (!notebook || notebook.isClosed) {
    return;
  }
  await vscode.window.showNotebookDocument(notebook, { preserveFocus: false, preview: false });
  // Close the exact public workbench tab instead of relying on whichever nested
  // notebook-cell editor the command service considers active.
  const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab =>
    tab.input?.uri?.toString() === notebook.uri.toString()
  );
  assert(tabs.length > 0, `workbench tab for ${notebook.uri.toString()} must be open`);
  assert.strictEqual(
    await vscode.window.tabGroups.close(tabs, true),
    true,
    'the exact notebook workbench tab must close'
  );
  await waitFor('notebook tab removal', () =>
    !vscode.window.tabGroups.all.flatMap(group => group.tabs).some(tab =>
      tab.input?.uri?.toString() === notebook.uri.toString()
    ) && !vscode.window.visibleNotebookEditors.some(editor =>
      editor.notebook.uri.toString() === notebook.uri.toString()
    )
  );
}

async function discardNotebookChangesAndClose(notebook) {
  if (!notebook || notebook.isClosed) {
    return;
  }
  if (!notebook.isDirty) {
    await closeNotebookTabs(notebook);
    return;
  }
  await vscode.window.showNotebookDocument(notebook, { preserveFocus: false, preview: false });
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  await waitFor('dirty notebook cleanup without a close prompt', () =>
    !vscode.window.tabGroups.all.flatMap(group => group.tabs).some(tab =>
      tab.input?.uri?.toString() === notebook.uri.toString()
    ) && !vscode.window.visibleNotebookEditors.some(editor =>
      editor.notebook.uri.toString() === notebook.uri.toString()
    )
  );
}

function repeatedRows(tail) {
  return Array.from({ length: 30 }, (_value, index) => {
    const open = 100 + index;
    return [
      index,
      index === 29 ? tail : `stable-${index}`,
      index === 7 ? null : (index * 7) % 30,
      open,
      open + 5,
      open - 3,
      open + (index % 3) - 1,
    ];
  });
}

function largeNotebookRows() {
  return Array.from({ length: 60_000 }, (_value, index) => [
    index,
    ['AAPL', 'MSFT', 'IBM', 'KX'][index % 4],
    100 + (index % 10_000) / 100,
    100 + (index % 900),
    ['XNAS', 'XNYS', 'BATS'][index % 3],
  ]);
}

async function waitForJson(filePath, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() <= deadline) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(`timed out waiting for ${label}: ${lastError?.message || 'no result'}`);
}

async function exerciseRepeatedIdenticalMixedQ(testApi) {
  const controlDir = process.env.VSCODE_KDB_E2E_CONTROL_DIR;
  assert(controlDir, 'the two-host notebook acceptance requires its control directory');
  const profile = {
    id: 'e2e-repeated-notebook',
    name: 'Extension Host Repeated Notebook',
    host: '127.0.0.1',
    port: 5012,
    database: '.',
    username: '',
  };
  const notebookConfiguration = vscode.workspace.getConfiguration('vscode-kdb.notebook');
  const previousRows = notebookConfiguration.inspect('maxOutputRows')?.globalValue;
  const previousBytes = notebookConfiguration.inspect('maxOutputBytes')?.globalValue;
  const notebookUri = vscode.Uri.file(path.join(controlDir, 'roundtrip.ipynb'));
  const largeReopenedUri = vscode.Uri.file(
    path.join(controlDir, 'roundtrip-large-reopened.ipynb')
  );
  let notebook;
  let largeReopenedNotebook;
  let eventSubscription;
  let heldQuery;
  let heldQueryRun;
  let preservedForFreshHost = false;
  try {
    await testApi.addConnection(profile);
    await testApi.setActiveConnection(profile.id);
    assert.strictEqual(
      testApi.activeConnectionId(),
      profile.id,
      'mixed-q execution must explicitly star its sole routing target'
    );
    await notebookConfiguration.update(
      'maxOutputRows',
      30,
      vscode.ConfigurationTarget.Global
    );
    await notebookConfiguration.update(
      'maxOutputBytes',
      1_000_000,
      vscode.ConfigurationTarget.Global
    );

    const source = 'select from repeated_source';
    const pythonSource = 'print("leave me unchanged")';
    const ipynb = {
      cells: [
        {
          cell_type: 'code',
          execution_count: null,
          id: 'kx-q-cell',
          metadata: { vscode: { languageId: 'q' } },
          outputs: [],
          source: [source],
        },
        {
          cell_type: 'code',
          execution_count: null,
          id: 'python-cell',
          metadata: {},
          outputs: [],
          source: [pythonSource],
        },
      ],
      metadata: {
        kernelspec: {
          display_name: 'Python 3',
          language: 'python',
          name: 'python3',
        },
        language_info: { name: 'python' },
        'vscode-kdb': {
          version: 1,
          qTarget: { id: 'ignored-legacy-target', name: 'Ignored legacy target' },
        },
      },
      nbformat: 4,
      nbformat_minor: 5,
    };
    await vscode.workspace.fs.delete(notebookUri, { useTrash: false }).catch(() => undefined);
    await vscode.workspace.fs.delete(largeReopenedUri, { useTrash: false }).catch(() => undefined);
    await vscode.workspace.fs.writeFile(
      notebookUri,
      new TextEncoder().encode(`${JSON.stringify(ipynb, null, 2)}\n`)
    );
    notebook = await vscode.workspace.openNotebookDocument(notebookUri);
    const editor = await vscode.window.showNotebookDocument(notebook, {
      preserveFocus: false,
      preview: false,
    });
    editor.selections = [new vscode.NotebookRange(0, 1)];
    const originalQCell = notebook.cellAt(0);
    const originalPythonCellUri = notebook.cellAt(1).document.uri.toString();
    const notebookEvents = [];
    eventSubscription = vscode.workspace.onDidChangeNotebookDocument(event => {
      if (event.notebook !== notebook) {
        return;
      }
      notebookEvents.push({
        contentChanges: event.contentChanges.map(change => ({
          removedUris: change.removedCells.map(cell => cell.document.uri.toString()),
          addedUris: change.addedCells.map(cell => cell.document.uri.toString()),
        })),
        outputChangeUris: event.cellChanges
          .filter(change => change.outputs !== undefined)
          .map(change => change.cell.document.uri.toString()),
      });
    });

    testApi.queueNotebookTable(
      ['row', 'value', 'metric', 'open', 'high', 'low', 'close'],
      repeatedRows('stale-tail')
    );
    heldQuery = testApi.holdNextNotebookQuery();
    heldQueryRun = vscode.commands.executeCommand(
      RUN_Q_NOTEBOOK_CELL_COMMAND,
      originalQCell
    );
    await heldQuery.issued;

    const competingMarker = 'competing structural output must survive';
    const competingCell = new vscode.NotebookCellData(
      vscode.NotebookCellKind.Code,
      source,
      'q'
    );
    competingCell.metadata = JSON.parse(JSON.stringify(originalQCell.metadata));
    competingCell.outputs = [new vscode.NotebookCellOutput([
      vscode.NotebookCellOutputItem.text(competingMarker, 'text/plain'),
    ], { owner: 'competing-extension-host-edit' })];
    const competingEdit = new vscode.WorkspaceEdit();
    competingEdit.set(notebook.uri, [vscode.NotebookEdit.replaceCells(
      new vscode.NotebookRange(0, 1),
      [competingCell]
    )]);
    assert.strictEqual(
      await vscode.workspace.applyEdit(competingEdit),
      true,
      'the competing structural notebook edit must be accepted by the real Extension Host'
    );
    heldQuery.release();
    heldQuery = undefined;
    await heldQueryRun;
    heldQueryRun = undefined;

    const postRaceQCell = notebook.cellAt(0);
    assert.strictEqual(notebook.cellCount, 2);
    assert.strictEqual(postRaceQCell.document.getText(), source);
    assert.strictEqual(postRaceQCell.outputs.length, 1);
    assert.strictEqual(
      new TextDecoder().decode(postRaceQCell.outputs[0].items[0].data),
      competingMarker,
      'a delayed stale q result must not overwrite a competing structural output edit'
    );

    testApi.queueNotebookTable(
      ['row', 'value', 'metric', 'open', 'high', 'low', 'close'],
      repeatedRows('tail-1')
    );

    await vscode.commands.executeCommand(RUN_Q_NOTEBOOK_CELL_COMMAND, postRaceQCell);
    const afterFirst = notebook.cellAt(0);
    assert.strictEqual(notebook.cellCount, 2);
    assert.strictEqual(afterFirst.outputs.length, 1);
    assert.strictEqual(afterFirst.document.getText(), source);
    const firstPayload = portableOutput(afterFirst);
    const firstOutput = afterFirst.outputs[0];
    const firstOutputId = outputIdentity(firstOutput)?.id;
    const firstLiveId = firstOutput.metadata?.[KX_LIVE_METADATA_KEY]?.id;
    assert.match(firstLiveId, /^[A-Za-z0-9_-]{32,128}$/);
    assert.strictEqual(
      testApi.hasLiveNotebookResult(firstLiveId, notebook.uri.toString()),
      true,
      'the first committed mixed-q output must own a live result before replacement'
    );
    assert.strictEqual(firstPayload.outputId, firstOutputId);
    assert.strictEqual(firstPayload.version, 2);
    assert.strictEqual(firstPayload.persistence.mode, 'full');
    assert.strictEqual(firstPayload.data.rows.length, 30);
    assert.strictEqual(firstPayload.data.rows[29][1].value, 'tail-1');

    await notebookConfiguration.update(
      'maxOutputRows',
      20,
      vscode.ConfigurationTarget.Global
    );
    const largeRows = largeNotebookRows();
    testApi.queueNotebookTable(
      ['row', 'sym', 'price', 'size', 'venue'],
      largeRows
    );
    await vscode.commands.executeCommand(RUN_Q_NOTEBOOK_CELL_COMMAND, afterFirst);
    const afterLarge = notebook.cellAt(0);
    assert.strictEqual(afterLarge.outputs.length, 1);
    assert.strictEqual(afterLarge.document.getText(), source);
    const largePayload = portableOutput(afterLarge);
    const largeOutput = afterLarge.outputs[0];
    const largeOutputId = outputIdentity(largeOutput)?.id;
    const largeLiveId = largeOutput.metadata?.[KX_LIVE_METADATA_KEY]?.id;
    assert.strictEqual(largePayload.outputId, largeOutputId);
    assert.strictEqual(largePayload.version, 2);
    assert.strictEqual(largePayload.persistence.mode, 'full');
    assert.strictEqual(largePayload.result.rowCount, 60_000);
    assert.strictEqual(largePayload.result.previewRowCount, 60_000);
    assert.strictEqual(largePayload.data.rows.length, 60_000);
    assert.strictEqual(largePayload.result.truncated, false);
    assert.ok(
      portableOutputByteLength(afterLarge) > 1_000_000,
      `real Extension Host coverage must commit a genuinely large exact KX MIME item; measured ${portableOutputByteLength(afterLarge)} bytes`
    );
    assert.deepStrictEqual(testApi.notebookLiveSlice(
      largeLiveId,
      notebook.uri.toString(),
      {
        startRow: 59_999,
        endRow: 59_999,
        startColumn: 0,
        endColumn: 4,
        columnOrdinals: [0, 1, 2, 3, 4],
      }
    ).cells, [['59999', 'KX', '199.99', '699', 'BATS']]);

    assert.strictEqual(
      notebook.isDirty,
      true,
      'the complete 60,000-row output edit must mark the real .ipynb dirty'
    );
    assert.strictEqual(
      await notebook.save(),
      true,
      'the real .ipynb save must accept the complete 60,000-row output'
    );
    await waitFor('60,000-row .ipynb clean state', () => !notebook.isDirty);
    await vscode.workspace.fs.copy(notebookUri, largeReopenedUri, { overwrite: true });
    largeReopenedNotebook = await vscode.workspace.openNotebookDocument(largeReopenedUri);
    assert.notStrictEqual(
      largeReopenedNotebook.uri.toString(),
      notebook.uri.toString(),
      'the checkpoint must reopen saved bytes as a distinct notebook document'
    );
    assert.strictEqual(largeReopenedNotebook.isDirty, false);
    await vscode.window.showNotebookDocument(largeReopenedNotebook, {
      preserveFocus: false,
      preview: false,
    });
    assert.strictEqual(largeReopenedNotebook.cellCount, 2);
    const reopenedLargeCell = largeReopenedNotebook.cellAt(0);
    assert.strictEqual(reopenedLargeCell.outputs.length, 1);
    assert.strictEqual(
      reopenedLargeCell.outputs[0].items.filter(item => item.mime === KX_NOTEBOOK_MIME).length,
      1,
      'the reopened cell must contain exactly one owned KX MIME payload'
    );
    const reopenedLargePayload = portableOutput(reopenedLargeCell);
    const reopenedLargeOutput = reopenedLargeCell.outputs[0];
    assert.deepStrictEqual(
      reopenedLargePayload,
      largePayload,
      'the saved/reopened 60,000-row payload must remain semantically exact'
    );
    assert.strictEqual(reopenedLargePayload.outputId, largeOutputId);
    assert.deepStrictEqual(
      outputIdentity(reopenedLargeOutput),
      { version: 1, id: largeOutputId },
      'the reopened durable binding must retain the exact canonical reference shape'
    );
    assert.strictEqual(reopenedLargePayload.version, 2);
    assert.strictEqual(reopenedLargePayload.persistence.mode, 'full');
    assert.strictEqual(reopenedLargePayload.result.rowCount, 60_000);
    assert.strictEqual(reopenedLargePayload.result.previewRowCount, 60_000);
    assert.strictEqual(reopenedLargePayload.data.rows.length, 60_000);
    assert.strictEqual(reopenedLargePayload.result.truncated, false);
    assert.deepStrictEqual(
      reopenedLargePayload.data.rows[59_999].map(cell => cell.value),
      [59_999, 'KX', 199.99, 699, 'BATS'],
      'the reopened complete payload must retain its final typed row values'
    );
    assert.ok(
      portableOutputByteLength(reopenedLargeCell) > 1_000_000,
      'the reopened KX MIME item must remain genuinely large'
    );
    assert.strictEqual(
      JSON.stringify(reopenedLargeOutput.metadata).includes(KX_LIVE_METADATA_KEY),
      false,
      'session-only live ownership must not be serialized into the reopened output'
    );
    assert.strictEqual(
      testApi.hasLiveNotebookResult(largeLiveId, largeReopenedUri.toString()),
      false,
      'opening saved bytes under another URI must not resurrect a transient live owner'
    );
    assert.strictEqual(largeReopenedNotebook.cellAt(1).document.languageId, 'python');
    assert.strictEqual(largeReopenedNotebook.cellAt(1).document.getText(), pythonSource);
    assert.strictEqual(largeReopenedNotebook.cellAt(1).outputs.length, 0);

    await closeNotebookTabs(largeReopenedNotebook);
    largeReopenedNotebook = undefined;
    await vscode.workspace.fs.delete(largeReopenedUri, { useTrash: false });
    await vscode.window.showNotebookDocument(notebook, {
      preserveFocus: false,
      preview: false,
    });
    const currentLargeCell = notebook.cellAt(0);
    assert.strictEqual(currentLargeCell.outputs.length, 1);
    assert.strictEqual(
      currentLargeCell.outputs[0].items.filter(item => item.mime === KX_NOTEBOOK_MIME).length,
      1,
      'serializer reconciliation must retain exactly one owned KX MIME payload'
    );
    assert.deepStrictEqual(
      portableOutput(currentLargeCell),
      largePayload,
      'the original notebook must retain the complete result after serializer reconciliation'
    );
    assert.deepStrictEqual(
      outputIdentity(currentLargeCell.outputs[0]),
      { version: 1, id: largeOutputId },
      'serializer reconciliation must retain the exact durable binding reference'
    );
    assert.deepStrictEqual(
      liveOutputIdentity(currentLargeCell.outputs[0]),
      { version: 1, id: largeLiveId },
      'the active original output must still canonically reference its transient live owner'
    );
    assert.strictEqual(
      testApi.hasLiveNotebookResult(largeLiveId, notebook.uri.toString()),
      true,
      'saving the active original notebook must retain its transient live owner until replacement'
    );
    const largeCommittedCellUri = currentLargeCell.document.uri.toString();

    await notebookConfiguration.update(
      'maxOutputRows',
      30,
      vscode.ConfigurationTarget.Global
    );
    testApi.queueNotebookTable(
      ['row', 'value', 'metric', 'open', 'high', 'low', 'close'],
      repeatedRows('tail-2')
    );
    const secondRunEventStart = notebookEvents.length;
    await vscode.commands.executeCommand(RUN_Q_NOTEBOOK_CELL_COMMAND, currentLargeCell);
    const afterSecond = notebook.cellAt(0);
    assert.strictEqual(notebook.cellCount, 2);
    assert.strictEqual(afterSecond.outputs.length, 1);
    assert.strictEqual(afterSecond.document.getText(), source);
    const secondPayload = portableOutput(afterSecond);
    const secondOutput = afterSecond.outputs[0];
    const secondOutputId = outputIdentity(secondOutput)?.id;
    const secondLiveId = secondOutput.metadata?.[KX_LIVE_METADATA_KEY]?.id;

    assert.deepStrictEqual(
      testApi.notebookQueryCalls().slice(-2),
      [
        { connectionId: profile.id, source },
        { connectionId: profile.id, source },
      ],
      'two identical command invocations must issue q twice'
    );
    assert.strictEqual(secondPayload.outputId, secondOutputId);
    assert.strictEqual(secondPayload.version, 2);
    assert.strictEqual(secondPayload.persistence.mode, 'full');
    assert.strictEqual(secondPayload.data.rows.length, 30);
    assert.strictEqual(secondPayload.data.rows[29][1].value, 'tail-2');
    assert.deepStrictEqual(
      secondPayload.data.rows.slice(0, 29),
      firstPayload.data.rows.slice(0, 29),
      'identical persisted rows must not suppress a fresh execution'
    );
    assert.notStrictEqual(secondOutputId, firstOutputId);
    assert.notStrictEqual(secondLiveId, firstLiveId);
    assert.strictEqual(testApi.hasLiveNotebookResult(firstLiveId, notebook.uri.toString()), false);
    assert.strictEqual(testApi.hasLiveNotebookResult(largeLiveId, notebook.uri.toString()), false);
    assert.strictEqual(
      testApi.hasLiveNotebookResult(secondLiveId, notebook.uri.toString()),
      true,
      `second live result missing; cell state ${JSON.stringify({
        metadata: afterSecond.metadata,
        executionSummary: afterSecond.executionSummary,
        outputMetadata: secondOutput.metadata,
        itemMimes: secondOutput.items.map(item => item.mime),
      })}`
    );
    assert.deepStrictEqual(testApi.notebookLiveSlice(
      secondLiveId,
      notebook.uri.toString(),
      {
        startRow: 29,
        endRow: 29,
        startColumn: 0,
        endColumn: 1,
        columnOrdinals: [0, 1],
      }
    ).cells, [['29', 'tail-2']]);

    const secondRunEvents = notebookEvents.slice(secondRunEventStart);
    const secondCommittedCellUri = afterSecond.document.uri.toString();
    const sawSameUriCellChange = secondRunEvents.some(event =>
      event.outputChangeUris.includes(largeCommittedCellUri)
    );
    const sawStructuralReplacement = secondRunEvents.some(event =>
      event.contentChanges.some(change =>
        change.removedUris.includes(largeCommittedCellUri) &&
        change.addedUris.includes(secondCommittedCellUri)
      )
    );
    assert(
      sawSameUriCellChange || sawStructuralReplacement,
      'the second real-host run must commit through a supported in-place or structural notebook event'
    );
    assert.strictEqual(notebook.cellAt(1).document.uri.toString(), originalPythonCellUri);
    assert.strictEqual(notebook.cellAt(1).document.languageId, 'python');
    assert.strictEqual(notebook.cellAt(1).document.getText(), pythonSource);
    assert.strictEqual(notebook.cellAt(1).outputs.length, 0);

    assert.strictEqual(
      secondPayload.provenance.qSource,
      undefined,
      'Direct IPC output must not reintroduce omitted query text into persisted provenance'
    );
    assert.strictEqual(notebook.isDirty, true, 'the real notebook output edit must mark .ipynb dirty');
    assert.strictEqual(await notebook.save(), true, 'the real .ipynb save must succeed');
    await waitFor('saved .ipynb clean state', () => !notebook.isDirty);

    const savedText = new TextDecoder().decode(await vscode.workspace.fs.readFile(notebookUri));
    const savedIpynb = JSON.parse(savedText);
    assert.strictEqual(savedIpynb.cells.length, 2);
    assert.strictEqual(savedIpynb.cells[0].outputs.length, 1);
    assert.deepStrictEqual(savedIpynb.cells[1].source, [pythonSource]);
    assert.deepStrictEqual(savedIpynb.cells[1].outputs, []);
    const savedOutput = savedIpynb.cells[0].outputs.find(output =>
      output.data && output.data[KX_NOTEBOOK_MIME]
    );
    assert(savedOutput, 'saved .ipynb must contain the first-party KX output');
    assert.strictEqual(
      savedOutput.metadata?.[KX_OUTPUT_METADATA_KEY]?.id,
      secondOutputId,
      'the durable output identity must survive through Jupyter output metadata'
    );
    assert.strictEqual(
      savedText.includes(KX_LIVE_METADATA_KEY),
      false,
      'the session-only live identity must not be serialized into .ipynb'
    );
    const savedPayload = savedOutput.data[KX_NOTEBOOK_MIME];
    assert.strictEqual(savedPayload.version, 2);
    assert.strictEqual(savedPayload.persistence.mode, 'full');
    assert.strictEqual(savedPayload.data.rows.length, 30);
    assert.strictEqual(savedPayload.data.rows[29][1].value, 'tail-2');
    assert.strictEqual(
      savedPayload.provenance.qSource,
      undefined,
      'saved portable output must retain the deliberate qSource omission'
    );

    eventSubscription.dispose();
    eventSubscription = undefined;
    await closeNotebookTabs(notebook);
    assert.strictEqual(notebook.isDirty, false);
    fs.writeFileSync(
      path.join(controlDir, 'notebook-host-saved.json'),
      `${JSON.stringify({
        version: 1,
        notebookUri: notebookUri.toString(),
        outputId: secondOutputId,
        priorLiveId: secondLiveId,
        rowCount: 30,
        tail: 'tail-2',
      })}\n`,
      { flag: 'wx' }
    );
    preservedForFreshHost = true;
  } finally {
    heldQuery?.release();
    if (heldQueryRun) {
      await Promise.allSettled([heldQueryRun]);
      heldQueryRun = undefined;
    }
    eventSubscription?.dispose();
    await discardNotebookChangesAndClose(largeReopenedNotebook).catch(() => undefined);
    await vscode.workspace.fs.delete(largeReopenedUri, { useTrash: false }).catch(() => undefined);
    if (!preservedForFreshHost) {
      await discardNotebookChangesAndClose(notebook).catch(() => undefined);
      await vscode.workspace.fs.delete(notebookUri, { useTrash: false }).catch(() => undefined);
    }
    await testApi.removeConnection(profile.id).catch(() => undefined);
    await notebookConfiguration.update(
      'maxOutputRows',
      previousRows,
      vscode.ConfigurationTarget.Global
    );
    await notebookConfiguration.update(
      'maxOutputBytes',
      previousBytes,
      vscode.ConfigurationTarget.Global
    );
  }
}

function assertNotebookVisualResult(visual) {
  assert.strictEqual(visual.ok, true, visual.error || 'notebook renderer acceptance failed');
  assert.strictEqual(visual.nativeInput, true);
  assert.strictEqual(visual.search.noMatch, true);
  assert.strictEqual(visual.search.focusRetained, true);
  assert.strictEqual(visual.sort.sourceRestored, true);
  assert.strictEqual(visual.sort.ascending, true);
  assert.strictEqual(visual.sort.descending, true);
  assert.strictEqual(visual.sort.nullLast, true);
  assert.strictEqual(visual.sort.nullCount, 1);
  assert.strictEqual(visual.sort.exactRows, true);
  assert.strictEqual(visual.sort.associations, true);
  assert.strictEqual(visual.resize.dragged, true);
  assert.strictEqual(visual.resize.reset, true);
  assert.strictEqual(visual.resize.keyboard, true);
  assert.strictEqual(visual.chart.zoomed, true);
  assert.strictEqual(visual.chart.panned, true);
  assert.strictEqual(visual.chart.reset, true);
  assert.strictEqual(visual.chart.pendingReset, true);
  const navigatorEvidence = JSON.stringify(visual.chart.navigator);
  assert.strictEqual(
    visual.chart.navigator.aria,
    true,
    `saved-chart navigator ARIA/bounds evidence: ${navigatorEvidence}`
  );
  assert.strictEqual(
    visual.chart.navigator.controlsRemoved,
    true,
    `saved-chart obsolete-control evidence: ${navigatorEvidence}`
  );
  assert.strictEqual(
    visual.chart.navigator.trustedEdgeResize,
    true,
    `saved-chart navigator trusted edge-resize evidence: ${navigatorEvidence}`
  );
  assert.strictEqual(
    visual.chart.navigator.trustedWindowPan,
    true,
    `saved-chart navigator trusted window-pan evidence: ${navigatorEvidence}`
  );
  assert.strictEqual(
    visual.chart.navigator.keyboard,
    true,
    `saved-chart navigator keyboard evidence: ${navigatorEvidence}`
  );
  assert.strictEqual(
    visual.chart.navigator.home,
    true,
    `saved-chart navigator Home evidence: ${navigatorEvidence}`
  );
  assert.strictEqual(
    visual.chart.navigator.pendingHome,
    true,
    `saved-chart navigator pending-reset evidence: ${navigatorEvidence}`
  );
  assert.strictEqual(visual.chart.navigator.baseline.label, 'Chart X navigator');
  assert.deepStrictEqual(visual.chart.navigator.baseline.forbiddenControls, []);
  for (const part of ['window', 'start', 'end']) {
    assert.strictEqual(visual.chart.navigator.baseline[part].role, 'slider');
    assert.strictEqual(visual.chart.navigator.baseline[part].tabIndex, 0);
    assert.strictEqual(visual.chart.navigator.baseline[part].orientation, 'horizontal');
  }
  const legendEvidence = JSON.stringify(visual.chart.legendAccessibility);
  assert.strictEqual(
    visual.chart.legendAccessibility.chartRegion,
    true,
    `chart AX region evidence: ${legendEvidence}`
  );
  assert.strictEqual(
    visual.chart.legendAccessibility.pressedButton,
    true,
    `legend AX pressed-button evidence: ${legendEvidence}`
  );
  assert.strictEqual(visual.chart.legend, true, `native legend evidence: ${legendEvidence}`);
  assert.deepStrictEqual(
    Object.keys(visual.chart.families).sort(),
    ['bar']
  );
  const familyHashes = new Set();
  Object.values(visual.chart.families).forEach(family => {
    const range = family.range;
    assert(Number.isFinite(range.min) && Number.isFinite(range.max) && range.max > range.min);
    assert.match(family.sha256, /^[0-9a-f]{64}$/);
    assert.strictEqual(family.source, 'uplot-dom');
    familyHashes.add(family.sha256);
  });
  assert.strictEqual(familyHashes.size, 1, 'the real saved bar chart must have one stable proof');
  const tableAccessibilityEvidence = JSON.stringify(visual.accessibility);
  assert.strictEqual(
    visual.accessibility.grid,
    true,
    `saved-table AX evidence: ${tableAccessibilityEvidence}`
  );
  assert.strictEqual(visual.accessibility.columnheader, true);
  assert.strictEqual(visual.accessibility.gridcell, true);
  assert.strictEqual(visual.accessibility.namedGrid, true);
  assert.strictEqual(visual.accessibility.ownedRows, true);
  assert.strictEqual(
    visual.accessibility.singleNativeTable,
    true,
    `saved-table native-table AX evidence: ${tableAccessibilityEvidence}`
  );
  assert.strictEqual(visual.accessibility.multiselectable, true);
  assert.strictEqual(visual.accessibility.selection, true);
  assert.strictEqual(
    visual.accessibility.headerSelection,
    true,
    `saved-table header-selection AX evidence: ${JSON.stringify(
      visual.accessibility.headerSelectionEvidence
    )}`
  );
  assert.strictEqual(visual.accessibility.resizeControl, true);
  assert.strictEqual(visual.accessibility.focusedWithin, true);
  assert.strictEqual(visual.accessibility.domIndices, true);
  assert.strictEqual(
    visual.accessibility.ascendingSort,
    true,
    `saved-table sort AX evidence: ${JSON.stringify(visual.accessibility.ascendingSortEvidence)}`
  );
}

async function exerciseReopenedNotebook(testApi) {
  const controlDir = process.env.VSCODE_KDB_E2E_CONTROL_DIR;
  assert(controlDir, 'the fresh-host reopen phase requires its control directory');
  const saved = JSON.parse(fs.readFileSync(
    path.join(controlDir, 'notebook-host-saved.json'),
    'utf8'
  ));
  const notebookUri = vscode.Uri.parse(saved.notebookUri);
  assert.strictEqual(
    vscode.workspace.notebookDocuments.some(document =>
      document.uri.toString() === notebookUri.toString()),
    false,
    'the second Extension Host must begin without the saved notebook loaded'
  );
  assert.strictEqual(
    testApi.hasLiveNotebookResult(saved.priorLiveId, notebookUri.toString()),
    false,
    'a fresh Extension Host must not retain the prior process live handle'
  );
  let notebook;
  try {
    notebook = await vscode.workspace.openNotebookDocument(notebookUri);
    const editor = await vscode.window.showNotebookDocument(notebook, {
      preserveFocus: false,
      preview: false,
    });
    editor.selections = [new vscode.NotebookRange(0, 1)];
    assert.strictEqual(notebook.cellCount, 2);
    const cell = notebook.cellAt(0);
    assert.strictEqual(cell.outputs.length, 1);
    const payload = portableOutput(cell);
    const output = cell.outputs[0];
    assert.strictEqual(payload.outputId, saved.outputId);
    assert.strictEqual(outputIdentity(output)?.id, saved.outputId);
    assert.strictEqual(
      output.metadata?.[KX_LIVE_METADATA_KEY],
      undefined,
      'reopened output must use only saved rows and never recreate a live handle'
    );
    assert.strictEqual(payload.result.rowCount, saved.rowCount);
    assert.strictEqual(payload.result.previewRowCount, saved.rowCount);
    assert.strictEqual(payload.data.rows.length, saved.rowCount);
    assert.strictEqual(payload.data.rows[29][1].value, saved.tail);
    assert.strictEqual(payload.persistence.mode, 'full');
    assert.strictEqual(payload.provenance.qSource, undefined);
    const pythonCell = notebook.cellAt(1);
    assert.strictEqual(pythonCell.document.languageId, 'python');
    assert.strictEqual(pythonCell.document.getText(), 'print("leave me unchanged")');
    assert.strictEqual(pythonCell.outputs.length, 0);

    fs.writeFileSync(
      path.join(controlDir, 'notebook-reopened-ready.json'),
      `${JSON.stringify({
        version: 1,
        notebookUri: notebookUri.toString(),
        outputId: saved.outputId,
      })}\n`,
      { flag: 'wx' }
    );
    const visual = await waitForJson(
      path.join(controlDir, 'notebook-visual-result.json'),
      'native notebook renderer acceptance'
    );
    assertNotebookVisualResult(visual);

    const commandEditor = await vscode.window.showNotebookDocument(notebook, {
      preserveFocus: false,
      preview: false,
    });
    commandEditor.selections = [new vscode.NotebookRange(0, 1)];
    assert.strictEqual(
      vscode.window.activeNotebookEditor?.notebook,
      notebook,
      'the persisted-preview command requires the reopened notebook to be active'
    );
    assert.strictEqual(
      vscode.window.activeNotebookEditor?.selections[0]?.start,
      0,
      'the persisted-preview command requires the saved full-v2 cell to be selected'
    );
    const notebookCallsBeforeOpen = testApi.notebookQueryCalls().map(call => ({ ...call }));
    assert.strictEqual(
      await vscode.commands.executeCommand(OPEN_NOTEBOOK_PREVIEW_IN_RESULTS_COMMAND),
      true,
      'the persisted full-v2 output must route to KX Results'
    );
    await waitFor('persisted full-v2 KX Results panel', () => {
      const panel = testApi.resultsPanelSnapshot();
      return panel.panelCount >= 1 && panel.visible && panel.version > 0 &&
        panel.mode === 'table' && panel.rowCount === 30;
    });
    assert.deepStrictEqual(
      testApi.notebookQueryCalls(),
      notebookCallsBeforeOpen,
      'opening the persisted full-v2 result in KX Results must not rerun q'
    );
  } finally {
    await closeNotebookTabs(notebook).catch(() => undefined);
    await vscode.workspace.fs.delete(notebookUri, { useTrash: false }).catch(() => undefined);
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
    RUN_Q_NOTEBOOK_CELL_COMMAND,
  ]) {
    assert(commands.has(command), `activated extension must register ${command}`);
  }
  const contributedCommands = new Set(
    (extension.packageJSON?.contributes?.commands || []).map(command => command.command)
  );
  const retiredCommand = ['vscode-kdb.open', 'In', 'Data', 'Wrangler'].join('');
  assert.strictEqual(commands.has(retiredCommand), false, 'retired command must not be registered');
  assert.strictEqual(
    contributedCommands.has(retiredCommand),
    false,
    'retired command must not be contributed'
  );

  if (process.env.VSCODE_KDB_E2E_PHASE === 'reopen') {
    await exerciseReopenedNotebook(testApi);
    console.log(
      'KX Extension Host reopen assertions passed: fresh-process .ipynb load, persisted-only output identity, native Chromium input, sort/null order, resize, bar-chart navigator/viewport races, and owned AX grid semantics.'
    );
  } else {
    console.log('KX Extension Host phase: connection store');
    await exerciseConnectionStore(testApi);
    console.log('KX Extension Host phase: direct controller lifecycle');
    await exerciseDirectControllerLifecycle(testApi);
    console.log('KX Extension Host phase: notebook cell language');
    await exerciseNotebookCellLanguageCommands();
    console.log('KX Extension Host phase: durable mixed notebook');
    await exerciseDurableMixedNotebook();
    console.log('KX Extension Host phase: repeated mixed q');
    await exerciseRepeatedIdenticalMixedQ(testApi);
    console.log(
      'KX Extension Host save assertions passed: activation/store lifecycle, active query connection selection, q language commands, durable mixed-notebook reopen, stale-race protection, repeated mixed-q identities, and actual .ipynb save/tab close.'
    );
  }
}

module.exports = { run };
