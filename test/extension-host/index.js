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
const DIRECT_CONTROLLER_SETTING = 'enableDirectController';
const RUN_Q_NOTEBOOK_CELL_COMMAND = 'vscode-kdb.runQNotebookCell';
const KX_NOTEBOOK_MIME = 'application/vnd.kx.result+json';
const KX_OUTPUT_METADATA_KEY = 'vscode-kdb.output';
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

  await vscode.window.showNotebookDocument(notebook, { preserveFocus: false, preview: false });
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  await waitFor('untitled language notebook close', () => notebook.isClosed);
}

function portableOutput(cell) {
  const item = cell.outputs.flatMap(output => output.items)
    .find(candidate => candidate.mime === KX_NOTEBOOK_MIME);
  assert(item, `notebook cell must contain ${KX_NOTEBOOK_MIME}`);
  return JSON.parse(new TextDecoder().decode(item.data));
}

function outputIdentity(output) {
  const direct = output.metadata?.[KX_OUTPUT_METADATA_KEY];
  const nested = output.metadata?.metadata?.[KX_OUTPUT_METADATA_KEY];
  if (direct && nested) {
    assert.strictEqual(direct.id, nested.id, 'duplicate notebook output identities must agree');
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
  const previousPreserve = notebookConfiguration
    .inspect('preserveFullResultByDefault')?.globalValue;
  const notebookUri = vscode.Uri.file(path.join(controlDir, 'roundtrip.ipynb'));
  let notebook;
  let eventSubscription;
  let heldQuery;
  let heldQueryRun;
  let preservedForFreshHost = false;
  try {
    await testApi.addConnection(profile);
    await notebookConfiguration.update(
      'maxOutputRows',
      20,
      vscode.ConfigurationTarget.Global
    );
    await notebookConfiguration.update(
      'preserveFullResultByDefault',
      false,
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
          qTarget: { id: profile.id, name: profile.name },
        },
      },
      nbformat: 4,
      nbformat_minor: 5,
    };
    await vscode.workspace.fs.delete(notebookUri, { useTrash: false }).catch(() => undefined);
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
    testApi.queueNotebookTable(
      ['row', 'value', 'metric', 'open', 'high', 'low', 'close'],
      repeatedRows('tail-2')
    );

    await vscode.commands.executeCommand(RUN_Q_NOTEBOOK_CELL_COMMAND, postRaceQCell);
    const afterFirst = notebook.cellAt(0);
    assert.strictEqual(notebook.cellCount, 2);
    assert.strictEqual(afterFirst.outputs.length, 1);
    const firstCommittedCellUri = afterFirst.document.uri.toString();
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
    assert.strictEqual(firstPayload.persistence.mode, 'preview');
    assert.strictEqual(firstPayload.data.rows.length, 20);

    const secondRunEventStart = notebookEvents.length;
    await vscode.commands.executeCommand(RUN_Q_NOTEBOOK_CELL_COMMAND, afterFirst);
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
    assert.strictEqual(secondPayload.persistence.mode, 'preview');
    assert.strictEqual(secondPayload.data.rows.length, 20);
    assert.deepStrictEqual(
      secondPayload.data.rows,
      firstPayload.data.rows,
      'identical persisted preview rows must not suppress a fresh execution'
    );
    assert.notStrictEqual(secondOutputId, firstOutputId);
    assert.notStrictEqual(secondLiveId, firstLiveId);
    assert.strictEqual(testApi.hasLiveNotebookResult(firstLiveId, notebook.uri.toString()), false);
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
      event.outputChangeUris.includes(firstCommittedCellUri)
    );
    const sawStructuralReplacement = secondRunEvents.some(event =>
      event.contentChanges.some(change =>
        change.removedUris.includes(firstCommittedCellUri) &&
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
    await notebookConfiguration.update(
      'preserveFullResultByDefault',
      true,
      vscode.ConfigurationTarget.Global
    );
    testApi.queueNotebookTable(
      ['row', 'value', 'metric', 'open', 'high', 'low', 'close'],
      repeatedRows('tail-3')
    );
    await vscode.commands.executeCommand(RUN_Q_NOTEBOOK_CELL_COMMAND, afterSecond);
    const durableCell = notebook.cellAt(0);
    assert.strictEqual(notebook.cellCount, 2);
    assert.strictEqual(durableCell.outputs.length, 1);
    const durablePayload = portableOutput(durableCell);
    const durableOutput = durableCell.outputs[0];
    const durableOutputId = outputIdentity(durableOutput)?.id;
    const durableLiveId = durableOutput.metadata?.[KX_LIVE_METADATA_KEY]?.id;
    assert.strictEqual(durablePayload.outputId, durableOutputId);
    assert.strictEqual(durablePayload.persistence.mode, 'full');
    assert.strictEqual(durablePayload.data.rows.length, 30);
    assert.strictEqual(durablePayload.data.rows[29][1].value, 'tail-3');
    assert.strictEqual(durablePayload.provenance.qSource, undefined);
    assert.notStrictEqual(durableOutputId, secondOutputId);
    assert.notStrictEqual(durableLiveId, secondLiveId);
    assert.strictEqual(testApi.hasLiveNotebookResult(secondLiveId, notebook.uri.toString()), false);
    assert.strictEqual(testApi.hasLiveNotebookResult(durableLiveId, notebook.uri.toString()), true);
    assert.strictEqual(notebook.cellAt(1).document.uri.toString(), originalPythonCellUri);
    assert.strictEqual(notebook.cellAt(1).document.getText(), pythonSource);
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
      durableOutputId,
      'the durable output identity must survive through Jupyter output metadata'
    );
    assert.strictEqual(
      savedText.includes(KX_LIVE_METADATA_KEY),
      false,
      'the session-only live identity must not be serialized into .ipynb'
    );
    assert.strictEqual(
      savedOutput.data[KX_NOTEBOOK_MIME].provenance.qSource,
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
        outputId: durableOutputId,
        priorLiveId: durableLiveId,
        rowCount: 30,
        tail: 'tail-3',
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
      'preserveFullResultByDefault',
      previousPreserve,
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
  assert.strictEqual(visual.accessibility.noNestedTable, true);
  assert.strictEqual(visual.accessibility.multiselectable, true);
  assert.strictEqual(visual.accessibility.selection, true);
  assert.strictEqual(visual.accessibility.headerSelection, true);
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
  ]) {
    assert(commands.has(command), `activated extension must register ${command}`);
  }

  if (process.env.VSCODE_KDB_E2E_PHASE === 'reopen') {
    await exerciseReopenedNotebook(testApi);
    console.log(
      'KX Extension Host reopen assertions passed: fresh-process .ipynb load, persisted-only output identity, native Chromium input, sort/null order, resize, bar-chart viewport races, and owned AX grid semantics.'
    );
  } else {
    await exerciseConnectionStore(testApi);
    await exerciseDirectControllerLifecycle(testApi);
    await exerciseNotebookCellLanguageCommands();
    await exerciseRepeatedIdenticalMixedQ(testApi);
    console.log(
      'KX Extension Host save assertions passed: activation/store lifecycle, q language commands, stale-race protection, repeated mixed-q identities, and actual .ipynb save/tab close.'
    );
  }
}

module.exports = { run };
