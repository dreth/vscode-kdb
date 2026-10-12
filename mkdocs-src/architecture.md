# Architecture

KX for VS Code connects directly to q over IPC. The extension owns connection profiles, query execution, result decoding, editor and notebook integration, and the KX user interface.

## Main components

- **Connection layer:** saved profiles live in VS Code settings. Passwords entered through the connection form use SecretStorage; an optional plaintext password may be configured in settings as a lower-precedence fallback, including for portable workspace/devcontainer profiles. Each profile has an independent q IPC client and request queue.
- **Execution layer:** editor commands and direct notebook actions send q text through the selected profile. Namespace wrappers restore the previous q namespace after success or error.
- **Result layer:** IPC values are decoded once into shared result models used by the KX Results panel and notebook renderer. Large operations apply explicit limits or confirmation prompts.
- **Language layer:** a generated TextMate grammar provides activation-free lexical scopes. A lazy bundled language client/server owns immutable q source models, offline providers, bounded workspace indexing, conservative formatting/diagnostics, and an optional validated metadata request bridge. The server never opens q IPC.
- **Notebook layer:** the q-only `.qnb` serializer/controller preserves the compatible JSON cell-array contract and uses direct IPC. The default mixed-Jupyter path leaves Python selected and runs marked q cells through an explicit KX action. The optional Jupyter pure-q controller uses the same direct IPC core.
- **Feature controls:** Query History is on by default with explicit opt-out. Server Explorer, performance tracing, and the loopback data server are off by default.

## State and persistence

Connection metadata and supported display preferences are durable. Query sockets, live direct-notebook values, panel state, local data-server tokens, and performance traces are process-local. New first-party Direct IPC output automatically saves the complete result when the portable v2/v3/v4 contracts can reconstruct it exactly; unsupported identities fail explicitly rather than being persisted lossily. Historical output and the separate Python-helper route can contain bounded portable previews, whose omitted rows require rerunning the cell. The full contract stores supported q atoms and vectors in a versioned typed JSON form rather than relying on JavaScript/JSON type inference. Its optional keyed-table source ordinals preserve structural key-column identity; payloads without them remain unhighlighted. Sparse source-column metadata preserves q table vector attributes, including on keyed and empty columns. Top-level dictionary identity still cannot be reconstructed from the row-oriented schema and fails explicitly.

The Python `kx_notebook` helper is separate from the extension-managed direct IPC session. It runs inside the selected Python kernel and requires an evaluator supplied by the user.

## Product boundaries

The extension has no SQLTools runtime dependency. Legacy SQLTools connection import is a one-time settings migration and creates no synchronization or shared session.

Direct q IPC is plaintext. TLS, SSH tunnels, gateways, remote administration, SQL translation, speculative dynamic q analysis, and server-side cancellation are outside the extension. Separately managed network controls can be used around direct IPC.

Host-neutral helpers such as IPC codecs, q source grouping, result transformations, export algorithms, and chart data preparation remain isolated from VS Code UI code where practical. Commands, webviews, SecretStorage, and extension lifecycle code remain extension-owned.

## Opt-in failure reporting

The extension host owns destination configuration, environment snapshots and both reporting transports. A shared host-neutral allowlisted failure schema supplies conservative exception classification, bounded cause relationships, relative KX artifact frames and typed operation/breadcrumb state. Per-failure direct Node/OS/V8 API measurements and audited settings describe only the executing host. Build metadata hashes the exact packaged first-party bundles and records resolved dependency versions; it contains no timestamps, repository identity or absolute paths. Both wire projections are checked against the same size bound before delivery. KX operation handlers observe failures without altering their error/output lifecycle. Renderers and the bundled language service use gated, strictly validated safe messages; they never receive a DSN/receiver URL or send directly to a report server. Saved MIME bytes and metadata are independent of reporting. Without an enabled host bridge, saved-output rendering remains available without collecting reports.

Machine-scoped empty defaults preserve local-only diagnostics. Sink generations revoke obsolete initialization, queues and sends; one failing receiver cannot block the other receiver or q/rendering operations. Each delivery failure clears that sink's queue and starts an event-driven one-hour cooldown; expired cooldowns do nothing until a new eligible failure arrives. Reporting transport errors are excluded from capture, with no background probes or retained retries. The default `diagnostics.failSilently` policy suppresses reporter notices. No global process/browser/console/network error collector is installed. See [Settings](settings.md#automatic-failure-reporting) for the field and delivery limits.
