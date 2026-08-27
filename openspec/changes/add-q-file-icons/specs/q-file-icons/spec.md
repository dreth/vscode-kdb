## Purpose

Defines stable q-specific file artwork for standalone q source and q-only notebook files without changing their language, notebook, execution, or result ownership.

## ADDED Requirements

### Requirement: q source files contribute q artwork
The extension SHALL associate its supplied q source artwork with the existing `q` language contribution for both light and dark VS Code themes, while retaining `.q` as the language's file extension.

#### Scenario: Standalone q file
- **WHEN** VS Code resolves a `.q` file through this extension's language contribution and the active file-icon theme permits contributed language icons
- **THEN** the file is eligible to display the supplied q source PNG in Explorer and editor file-label surfaces for both light and dark themes

#### Scenario: File-icon theme takes precedence
- **WHEN** the user selects a VS Code file-icon theme that supplies or suppresses its own `.q` icon
- **THEN** the extension does not override that theme or register a competing complete file-icon theme

### Requirement: qnb files contribute q notebook artwork
The extension SHALL associate its supplied q notebook PNG with the existing `vscode-kdb-q-notebook` contribution and `*.qnb` selector instead of the prior generic notebook SVG.

#### Scenario: q-only notebook file
- **WHEN** VS Code resolves a `*.qnb` file through the extension's notebook contribution
- **THEN** the notebook is eligible to display the supplied q notebook PNG without changing which serializer or controller owns it

### Requirement: icon assets are packaged and distinct
The q source and q notebook icons SHALL be distinct transparent PNG assets copied from the user-supplied artwork and included in the installable VSIX at the manifest paths that reference them.

#### Scenario: Packaged extension inventory
- **WHEN** the release VSIX is built and audited
- **THEN** both referenced PNG files are present, valid, non-empty, and distinct, and the obsolete q notebook SVG is not required by either icon contribution

### Requirement: q tooling and notebook behavior remain unchanged
Adding file artwork SHALL NOT alter the q language identifier, `.q` association, grammar, syntax highlighting, formatting, diagnostics, language intelligence, `.qnb` serialization, controller selection, execution, MIME output, Results, or saved notebook contracts, and SHALL NOT associate `.k` files with q.

#### Scenario: Existing q source tooling
- **WHEN** a `.q` document is opened after the icons are installed
- **THEN** it continues to use language identifier `q` and the existing highlighting, formatting, diagnostics, and language-intelligence providers

#### Scenario: Existing qnb behavior
- **WHEN** a `.qnb` file is opened, executed, saved, and reopened after the icon changes
- **THEN** its existing q-only serializer/controller and direct-q result behavior are unchanged

#### Scenario: Non-q files
- **WHEN** a `.k`, `.ipynb`, Python, Markdown, or unrelated file is resolved
- **THEN** this icon contribution does not change that file's language or notebook association
