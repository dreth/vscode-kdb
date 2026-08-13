# Architecture

KX for VS Code connects directly to q over IPC. The extension owns connection profiles, query execution, result decoding, editor and notebook integration, and the KX user interface.

## Main components

- **Connection layer:** saved profile metadata lives in VS Code settings; passwords use SecretStorage. Each profile has an independent q IPC client and request queue.
- **Execution layer:** editor commands and direct notebook actions send q text through the selected profile. Namespace wrappers restore the previous q namespace after success or error.
- **Result layer:** IPC values are decoded once into shared result models used by the KX Results panel and notebook renderer. Large operations apply explicit limits or confirmation prompts.
- **Notebook layer:** the default mixed-notebook path leaves the Python controller selected and runs marked q cells through an explicit KX action. The optional pure-q controller uses the same direct IPC path.
- **Optional tools:** Server Explorer, Query History, performance tracing, and the loopback data server are off by default.

## State and persistence

Connection metadata and supported display preferences are durable. Query sockets, live direct-notebook values, panel state, local data-server tokens, and performance traces are process-local. New first-party Direct IPC output automatically saves the complete result when the portable v2 contract can reconstruct it exactly; unsupported identities fail explicitly rather than being persisted lossily. Historical output and the separate Python-helper route can contain bounded portable previews, whose omitted rows require rerunning the cell. The full contract stores supported q atoms and vectors in a versioned typed JSON form rather than relying on JavaScript/JSON type inference. Its optional keyed-table source ordinals preserve structural key-column identity; payloads without them remain unhighlighted. It rejects q container metadata the row-oriented schema cannot reconstruct exactly, such as a whole-table-column vector attribute or top-level dictionary identity.

The Python `kx_notebook` helper is separate from the extension-managed direct IPC session. It runs inside the selected Python kernel and requires an evaluator supplied by the user.

## Product boundaries

The extension has no SQLTools runtime dependency. Legacy SQLTools connection import is a one-time settings migration and creates no synchronization or shared session.

Direct q IPC is plaintext. TLS, SSH tunnels, gateways, remote administration, SQL translation, q language-server features, and server-side cancellation are outside the extension. Separately managed network controls can be used around direct IPC.

Host-neutral helpers such as IPC codecs, q source grouping, result transformations, export algorithms, and chart data preparation remain isolated from VS Code UI code where practical. Commands, webviews, SecretStorage, and extension lifecycle code remain extension-owned.
