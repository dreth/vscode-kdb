import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectRuntimeFacts, SAFE_SETTING_KEYS } from './failure-context';
import * as os from 'node:os';
import * as vscode from 'vscode';
import { FailureReporter, machineSetting, machineBooleanSetting } from './failure-reporting';
import { configureFailureObserver } from './failure-record';

/** All destination access and environment snapshots stay in the extension host. */
export function initializeFailureReporting(context: vscode.ExtensionContext,
  output: Pick<vscode.OutputChannel, 'appendLine'>): FailureReporter {
  const reporter = new FailureReporter({
    artifactRoots: [context.extensionUri.fsPath.replace(/\\/g, '/') + '/'],
    status: value => output.appendLine(value),
    environment: () => {
      const settings = vscode.workspace.getConfiguration('vscode-kdb');
      const runtime = collectRuntimeFacts();
      const memory = runtime.memory as ReturnType<typeof process.memoryUsage> | undefined;
      let buildId: unknown;
      let libraries: unknown;
      try {
        const build = JSON.parse(readFileSync(join(context.extensionUri.fsPath, 'out/failure-build.json'), 'utf8'));
        if (build.schemaVersion === 1 && build.release === context.extension.packageJSON.version) {
          buildId = build.buildId; libraries = build.libraries;
        } else (runtime.unavailableSections as string[]).push('buildId');
      }
      catch { (runtime.unavailableSections as string[]).push('buildId'); }
      return {
        kxVersion: context.extension.packageJSON.version, vscodeVersion: vscode.version,
        nodeVersion: process.versions.node, electronVersion: process.versions.electron,
        chromeVersion: process.versions.chrome, platform: os.platform(), osRelease: os.release(), arch: os.arch(),
        uiKind: vscode.env.uiKind, extensionKind: context.extension.extensionKind,
        remoteKind: ['ssh-remote', 'dev-container', 'wsl', 'codespaces', 'tunnel'].includes(vscode.env.remoteName ?? '')
          ? vscode.env.remoteName : vscode.env.remoteName ? 'remote' : 'local',
        ...runtime, buildId, libraries,
        rss: memory?.rss, heapUsed: memory?.heapUsed, heapTotal: memory?.heapTotal, external: memory?.external, arrayBuffers: memory?.arrayBuffers,
        settings: Object.fromEntries(SAFE_SETTING_KEYS.map(key => [key, settings.get(key)])),
        extensions: vscode.extensions.all.map(extension => ({ id: extension.id, version: extension.packageJSON.version }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      };
    },
  });
  const configure = (): void => {
    try {
      const settings = vscode.workspace.getConfiguration('vscode-kdb.diagnostics');
      reporter.configure({ reportServerUrl: machineSetting(settings.inspect('reportServerUrl')),
        sentryDsn: machineSetting(settings.inspect('sentryDsn')),
        failSilently: machineBooleanSetting(settings.inspect('failSilently')) });
      configureFailureObserver(reporter.state.enabled
        ? (component, operation, error, details) => reporter.capture(component, operation, error, details)
        : undefined, reporter.state, reporter.state.enabled
          ? (component, operation, failure, details) => reporter.captureSafe(component, operation, failure, details) : undefined,
        reporter.state.enabled ? (component, operation, details) => reporter.breadcrumb(component, operation, details) : undefined);
    } catch { /* Settings/reporting cannot prevent extension activation. */ }
  };
  configure();
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('vscode-kdb.diagnostics')) configure();
  }), { dispose: () => { reporter.dispose(); configureFailureObserver(undefined, reporter.state); } });
  return reporter;
}
