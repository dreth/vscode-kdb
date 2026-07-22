# Installation

## Requirements

KX for VS Code requires VS Code `1.96.0` or newer and a kdb+/q process reachable over q IPC. The extension does not bundle q or a kdb+ license.

SQLTools is neither installed nor activated by this extension.

## Install the extension

Use a project-approved distribution of **KX for VS Code**. When installing a locally supplied VSIX, use VS Code's **Extensions: Install from VSIX...** command and confirm the extension name, publisher, and version before installation.

This documentation build does not publish a Marketplace package and does not establish that an unverified development VSIX is ready for Marketplace publication.

For repository development:

```sh
npm ci
npm run compile
```

Open the repository in VS Code and start the extension development host with **Run Extension** / `F5`.

## Start a local q process

Prefer loopback for an unauthenticated development process:

```sh
q -p 127.0.0.1:5000
```

The common `q -p 5000` form can listen beyond loopback. Use it only on a trusted, firewalled machine.

## First connection and run

1. Open the **KX** activity-bar view.
2. Choose **Add Connection** in **KX Connections**.
3. Enter a unique name, `localhost`, port `5000`, namespace `.`, and optional q IPC username and authentication secret.
4. Choose **Test Connection**, then **Set Active Connection** and **Connect**.
5. Open a `.q` file containing:

   ```q
   til 5
   ```

6. Press `Ctrl+Enter` on Windows/Linux or `Cmd+Enter` on macOS.

The result should open in a KX-owned result panel. If it does not, see [Troubleshooting](troubleshooting.md) and inspect **View > Output > KX**.

## Verify a source checkout

The maintained non-visual checks are:

```sh
npm ci
npm run compile
node test/run.js
npm test
```

When a local q executable is available:

```sh
VSCODE_KDB_LIVE_REQUIRED=1 npm run test:live-q
```

These commands do not claim visual VS Code Extension Host end-to-end coverage.
