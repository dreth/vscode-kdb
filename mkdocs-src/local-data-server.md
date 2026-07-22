# Local Data Server

A grid result panel can start an opt-in HTTP server for its current visible result. This supports local Python, pandas, Plotly, and similar tools without sending another q query.

The server is standalone extension behavior. It does not depend on SQLTools.

## Start and stop

From an active KX result panel:

1. Open **Settings**.
2. Expand **Data server**.
3. Choose **Start server**.
4. Copy the `current.csv` or `metadata.json` URL.

Command Palette alternatives are:

| Command | Behavior |
| --- | --- |
| **KX Results: Start Local Data Server** | Start the active result panel's server. |
| **KX Results: Stop Local Data Server** | Stop the active panel's server. |
| **KX Results: Copy Local Data Server URL** | Copy its `current.csv` URL. |

The server never starts automatically. It binds only to `127.0.0.1`, prefers port `7742`, and tries subsequent ports when unavailable. Each panel server receives a random token in its URL. The token changes after a stop/restart and is not stored in settings.

It stops when requested, when that result panel closes, or when the extension deactivates. A new grid result in the same panel becomes the current served snapshot through the provider. q-text output is not served as a table; requests return no-current-result status until a grid result is available again.

## Endpoints

All endpoints require the random token path:

```text
http://127.0.0.1:<port>/<token>/metadata.json
```

Only `GET` is supported.

| Endpoint | Output |
| --- | --- |
| `/<token>/metadata.json` | Panel/result metadata, visible columns, row count, endpoint names, and limits. |
| `/<token>/current.csv` | Complete visible result as CSV with headers. |
| `/<token>/current.json` | Complete visible result as JSON rows. |
| `/<token>/current.ndjson` | Complete visible result as newline-delimited JSON rows. |
| `/<token>/slice.csv?rowStart=0&rowCount=1000&colStart=0&colCount=20` | Bounded row/column slice as CSV. |
| `/<token>/slice.json?rowStart=0&rowCount=1000&colStart=0&colCount=20` | Bounded row/column slice as JSON rows. |
| `/<token>/selection.csv` | Current panel selection as CSV. |
| `/<token>/selection.json` | Current panel selection as JSON rows. |

Hidden and reordered columns are honored. Sorted results use the current sorted row order. The visual row-number column is excluded. Selection endpoints return a structured `400` response until the webview has sent a valid selection.

Responses use `Cache-Control: no-store`. Errors are JSON objects containing `error.code` and `error.message`.

## Limits

Full `current.*` endpoints reject results over `vscode-kdb.results.localDataServerFullExportCellLimit`, which defaults to 1,000,000 visible cells:

```json
{
  "vscode-kdb.results.localDataServerFullExportCellLimit": 1000000
}
```

The panel copy/export prompt threshold is separate and does not raise this hard endpoint limit. Slice and selection requests use a fixed 1,000,000-cell ceiling. Prefer slices to raising a limit for a very large result.

## Security boundary

Treat the tokenized URL as a temporary bearer secret. Any local process that obtains it can read the exposed result while the server is running. `metadata.json` includes panel metadata such as the connection name and query text, so do not share it without review.

The loopback binding prevents remote network listening, but it is not process isolation or user authentication. Stop the server when it is no longer needed. Diagnostic output omits the token.

## Python example

```python
import pandas as pd

url = "http://127.0.0.1:7742/<token>/current.csv"
frame = pd.read_csv(url)
```

For a bounded request:

```python
import pandas as pd

url = (
    "http://127.0.0.1:7742/<token>/slice.csv"
    "?rowStart=0&rowCount=100000&colStart=0&colCount=10"
)
frame = pd.read_csv(url)
```
