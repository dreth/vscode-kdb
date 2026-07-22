"""Strict, bounded version-1 KX notebook result serialization."""

from __future__ import annotations

import base64
import dataclasses
import datetime as dt
import decimal
import json
import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Optional


MIME_TYPE = "application/vnd.kx.result+json"
CONTRACT_VERSION = 1
DEFAULT_ROW_LIMIT = 1_000
DEFAULT_BYTE_LIMIT = 1_000_000
MIN_BYTE_LIMIT = 16_384
MAX_ROW_LIMIT = 10_000
MAX_BYTE_LIMIT = 10_000_000
MAX_STRING_CHARS = 32_768
MAX_LABEL_CHARS = 200
MAX_Q_SOURCE_CHARS = 4_000
MAX_COLUMNS = 256
MAX_JSON_DEPTH = 12
MAX_JSON_ITEMS = 2_000
JS_SAFE_INTEGER = (1 << 53) - 1


class KxNotebookError(ValueError):
    """Base error for invalid or unsafe portable notebook output."""


class TableShapeError(KxNotebookError):
    """A supplied value is not a supported, bounded table shape."""


class OutputLimitError(KxNotebookError):
    """Even a zero-row portable result cannot fit within its byte limit."""


@dataclass(frozen=True)
class Chart:
    """Persisted chart selection supported by the static fallback and renderer."""

    type: str
    x_column: str
    y_columns: tuple[str, ...]
    title: Optional[str] = None


@dataclass(frozen=True)
class EvaluationResult:
    """Optional evaluator wrapper for table metadata and chart selection."""

    value: Any
    columns: Optional[Sequence[str]] = None
    row_count: Optional[int] = None
    label: Optional[str] = None
    chart: Optional[Chart] = None


@dataclass(frozen=True)
class PortableOutput:
    """The exact MIME bundle and its measured UTF-8 body size."""

    bundle: dict[str, Any]
    body_bytes: int


@dataclass
class _StringState:
    truncated: bool = False


class _Rows:
    def __init__(
        self,
        columns: list[str],
        row_count: int,
        available_count: int,
        iterator: Iterable[Sequence[Any]],
    ) -> None:
        self.columns = columns
        self.row_count = row_count
        self.available_count = available_count
        self.iterator = iter(iterator)


def build_mime_bundle(
    value: Any,
    *,
    columns: Optional[Sequence[str]] = None,
    row_count: Optional[int] = None,
    label: Optional[str] = None,
    elapsed_ms: Optional[float] = None,
    q_source: Optional[str] = None,
    row_limit: int = DEFAULT_ROW_LIMIT,
    byte_limit: int = DEFAULT_BYTE_LIMIT,
    chart: Optional[Chart] = None,
) -> PortableOutput:
    """Build a bounded rich MIME bundle without consuming unbounded iterables."""

    row_limit = _bounded_integer("row_limit", row_limit, 1, MAX_ROW_LIMIT)
    byte_limit = _bounded_integer(
        "byte_limit", byte_limit, MIN_BYTE_LIMIT, MAX_BYTE_LIMIT
    )
    rows = _table_rows(value, columns=columns, row_count=row_count)
    normalized_label = _optional_bounded_string("label", label, MAX_LABEL_CHARS)
    normalized_source = _optional_bounded_string(
        "q_source", q_source, MAX_Q_SOURCE_CHARS
    )
    normalized_elapsed = _elapsed_ms(elapsed_ms)
    normalized_chart = _normalize_chart(chart, rows.columns)

    candidate_count = min(rows.row_count, rows.available_count, row_limit)
    typed_rows: list[list[dict[str, Any]]] = []
    truncated_prefix: list[bool] = []
    string_state = _StringState()
    for row_index in range(candidate_count):
        try:
            row = next(rows.iterator)
        except StopIteration as error:
            raise TableShapeError(
                f"row_count={rows.row_count} but the table ended at row {row_index}"
            ) from error
        if len(row) != len(rows.columns):
            raise TableShapeError(
                f"row {row_index} has {len(row)} cells; expected {len(rows.columns)}"
            )
        typed_rows.append(
            [
                _typed_cell(
                    cell,
                    string_state=string_state,
                    path=f"row {row_index}, column {column_index}",
                )
                for column_index, cell in enumerate(row)
            ]
        )
        truncated_prefix.append(string_state.truncated)

    base_reasons: list[str] = []
    if rows.row_count > row_limit:
        base_reasons.append("rowLimit")
    if rows.available_count < min(rows.row_count, row_limit):
        base_reasons.append("sourcePreview")
    schema_columns = [
        {"name": name, "type": _column_type(typed_rows, index)}
        for index, name in enumerate(rows.columns)
    ]

    def candidate_output(preview_count: int, *, byte_truncated: bool) -> PortableOutput:
        reasons = list(base_reasons)
        if preview_count > 0 and truncated_prefix[preview_count - 1]:
            reasons.append("cellValueLimit")
        if byte_truncated:
            reasons.append("byteLimit")
        return _assemble_output(
            schema_columns=schema_columns,
            typed_rows=typed_rows[:preview_count],
            row_count=rows.row_count,
            row_limit=row_limit,
            byte_limit=byte_limit,
            truncation_reasons=reasons,
            label=normalized_label,
            elapsed_ms=normalized_elapsed,
            q_source=normalized_source,
            chart=normalized_chart,
        )

    # The full candidate can be smaller than a shorter candidate because it does
    # not need the byte-truncation notice. Check it before binary searching the
    # strictly monotonic, byte-truncated prefixes.
    full_candidate = candidate_output(candidate_count, byte_truncated=False)
    if full_candidate.body_bytes <= byte_limit:
        return full_candidate

    # Binary-search the largest exact prefix whose three MIME bodies fit together.
    low = 0
    high = len(typed_rows) - 1
    accepted: Optional[PortableOutput] = None
    while low <= high:
        preview_count = (low + high) // 2
        candidate = candidate_output(preview_count, byte_truncated=True)
        if candidate.body_bytes <= byte_limit:
            accepted = candidate
            low = preview_count + 1
        else:
            high = preview_count - 1

    if accepted is None:
        raise OutputLimitError(
            "byte_limit is too small for the result schema and zero-row fallbacks; "
            "use fewer/shorter columns or a larger byte_limit"
        )
    return accepted


def canonical_payload_bytes(payload: Mapping[str, Any]) -> bytes:
    """Use the deterministic JSON form used by byte-limit accounting and tests."""

    return json.dumps(
        payload,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _assemble_output(
    *,
    schema_columns: list[dict[str, str]],
    typed_rows: list[list[dict[str, Any]]],
    row_count: int,
    row_limit: int,
    byte_limit: int,
    truncation_reasons: list[str],
    label: Optional[str],
    elapsed_ms: Optional[float],
    q_source: Optional[str],
    chart: Optional[dict[str, Any]],
) -> PortableOutput:
    from .fallback import static_html, static_text

    reasons = list(dict.fromkeys(truncation_reasons))
    preview_count = len(typed_rows)
    result = {
        "rowCount": row_count,
        "previewRowCount": preview_count,
        "truncated": bool(reasons) or preview_count < row_count,
        "truncationReasons": reasons,
        "rowLimit": row_limit,
        "byteLimit": byte_limit,
    }
    provenance: dict[str, Any] = {"marker": "%%q"}
    if label is not None:
        provenance["label"] = label
    if elapsed_ms is not None:
        provenance["elapsedMs"] = elapsed_ms
    if q_source is not None:
        provenance["qSource"] = q_source
    payload: dict[str, Any] = {
        "version": CONTRACT_VERSION,
        "kind": "table",
        "schema": {"columns": schema_columns},
        "data": {"encoding": "rows", "rows": typed_rows},
        "result": result,
        "provenance": provenance,
    }
    if chart is not None:
        payload["chart"] = chart

    html = static_html(payload)
    text = static_text(payload)
    bundle = {MIME_TYPE: payload, "text/html": html, "text/plain": text}
    body_bytes = (
        len(canonical_payload_bytes(payload))
        + len(html.encode("utf-8"))
        + len(text.encode("utf-8"))
    )
    return PortableOutput(bundle=bundle, body_bytes=body_bytes)


def _table_rows(
    value: Any,
    *,
    columns: Optional[Sequence[str]],
    row_count: Optional[int],
) -> _Rows:
    explicit_columns = _column_names(columns) if columns is not None else None
    explicit_count = _optional_row_count(row_count)

    if isinstance(value, Mapping):
        names = explicit_columns or _column_names(list(value.keys()))
        vectors: list[Sequence[Any]] = []
        lengths: list[int] = []
        for name in names:
            if name not in value:
                raise TableShapeError(
                    f"column {name!r} is missing from the column mapping"
                )
            vector = value[name]
            if isinstance(vector, (str, bytes, bytearray)) or not hasattr(
                vector, "__len__"
            ):
                raise TableShapeError(f"column {name!r} must be a sized sequence")
            vectors.append(vector)  # type: ignore[arg-type]
            lengths.append(len(vector))  # type: ignore[arg-type]
        inferred_count = lengths[0] if lengths else 0
        if any(length != inferred_count for length in lengths):
            raise TableShapeError("column mapping contains unequal column lengths")
        count = _total_row_count(explicit_count, inferred_count)
        return _Rows(
            names,
            count,
            inferred_count,
            ([vector[index] for vector in vectors] for index in range(inferred_count)),
        )

    # pandas-like values are accepted without importing pandas. itertuples is bounded below.
    if (
        hasattr(value, "columns")
        and hasattr(value, "itertuples")
        and hasattr(value, "shape")
    ):
        names = explicit_columns or _column_names(list(value.columns))
        inferred_count = int(value.shape[0])
        count = _total_row_count(explicit_count, inferred_count)
        return _Rows(
            names, count, inferred_count, value.itertuples(index=False, name=None)
        )

    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        available_count = len(value)
        count = _total_row_count(explicit_count, available_count)
        if available_count == 0:
            if explicit_columns is None:
                raise TableShapeError("columns are required for an empty row sequence")
            return _Rows(explicit_columns, count, 0, ())
        first = value[0]
        if isinstance(first, Mapping):
            names = explicit_columns or _column_names(list(first.keys()))

            def mapping_rows() -> Iterable[list[Any]]:
                for index in range(available_count):
                    row = value[index]
                    if not isinstance(row, Mapping):
                        raise TableShapeError(f"row {index} is not a mapping")
                    yield [row.get(name) for name in names]

            return _Rows(names, count, available_count, mapping_rows())
        if explicit_columns is None:
            raise TableShapeError("columns are required for sequence rows")

        def sequence_rows() -> Iterable[list[Any]]:
            for index in range(available_count):
                row = value[index]
                if isinstance(row, (str, bytes, bytearray)) or not isinstance(
                    row, Sequence
                ):
                    raise TableShapeError(f"row {index} is not a sequence")
                yield list(row)

        return _Rows(explicit_columns, count, available_count, sequence_rows())

    if isinstance(value, Iterable):
        if explicit_columns is None or explicit_count is None:
            raise TableShapeError(
                "one-shot iterables require explicit columns and row_count"
            )
        return _Rows(explicit_columns, explicit_count, explicit_count, value)

    raise TableShapeError(
        "expected a mapping of columns, a sized sequence of rows, a pandas-like table, "
        "or an iterable with explicit columns and row_count"
    )


def _column_names(values: Sequence[str]) -> list[str]:
    names: list[str] = []
    if len(values) > MAX_COLUMNS:
        raise TableShapeError(
            f"table has {len(values)} columns; maximum is {MAX_COLUMNS}"
        )
    for index, value in enumerate(values):
        if not isinstance(value, str) or not value:
            raise TableShapeError(f"column {index} must have a non-empty string name")
        if len(value) > MAX_LABEL_CHARS:
            raise TableShapeError(
                f"column {index} name exceeds {MAX_LABEL_CHARS} characters"
            )
        names.append(value)
    if len(set(names)) != len(names):
        raise TableShapeError("column names must be unique")
    return names


def _typed_cell(value: Any, *, string_state: _StringState, path: str) -> dict[str, Any]:
    if value is None:
        return {"kind": "null"}
    if isinstance(value, bool):
        return {"kind": "boolean", "value": value}
    if isinstance(value, int):
        if abs(value) <= JS_SAFE_INTEGER:
            return {"kind": "number", "value": value}
        return {"kind": "bigint", "value": str(value)}
    if isinstance(value, float):
        if not math.isfinite(value):
            raise KxNotebookError(f"{path} contains a non-finite number")
        return {"kind": "number", "value": value}
    if isinstance(value, decimal.Decimal):
        if not value.is_finite():
            raise KxNotebookError(f"{path} contains a non-finite decimal")
        return {
            "kind": "string",
            "value": _bounded_cell_string(str(value), string_state),
        }
    if isinstance(value, str):
        return {"kind": "string", "value": _bounded_cell_string(value, string_state)}
    if isinstance(value, (dt.datetime, dt.date, dt.time)):
        return {"kind": "temporal", "value": value.isoformat()}
    if isinstance(value, dt.timedelta):
        return {"kind": "temporal", "value": _timedelta_text(value)}
    if isinstance(value, (bytes, bytearray, memoryview)):
        encoded = base64.b64encode(bytes(value)).decode("ascii")
        return {
            "kind": "string",
            "value": _bounded_cell_string(f"base64:{encoded}", string_state),
        }
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        value = dataclasses.asdict(value)
    if isinstance(value, (Mapping, Sequence)) and not isinstance(
        value, (str, bytes, bytearray)
    ):
        normalized = _json_value(
            value,
            string_state=string_state,
            path=path,
            depth=0,
            item_budget=[MAX_JSON_ITEMS],
        )
        text = json.dumps(
            normalized,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        return {
            "kind": "json",
            "value": _bounded_cell_string(text, string_state),
        }
    return {"kind": "string", "value": _bounded_cell_string(str(value), string_state)}


def _json_value(
    value: Any,
    *,
    string_state: _StringState,
    path: str,
    depth: int,
    item_budget: list[int],
) -> Any:
    if depth > MAX_JSON_DEPTH:
        raise KxNotebookError(f"{path} exceeds JSON nesting depth {MAX_JSON_DEPTH}")
    item_budget[0] -= 1
    if item_budget[0] < 0:
        raise KxNotebookError(f"{path} exceeds JSON item limit {MAX_JSON_ITEMS}")
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value if abs(value) <= JS_SAFE_INTEGER else str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise KxNotebookError(f"{path} contains a non-finite JSON number")
        return value
    if isinstance(value, str):
        return _bounded_cell_string(value, string_state)
    if isinstance(value, Mapping):
        output: dict[str, Any] = {}
        for key, item in value.items():
            string_key = _bounded_cell_string(str(key), string_state)
            output[string_key] = _json_value(
                item,
                string_state=string_state,
                path=path,
                depth=depth + 1,
                item_budget=item_budget,
            )
        return output
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [
            _json_value(
                item,
                string_state=string_state,
                path=path,
                depth=depth + 1,
                item_budget=item_budget,
            )
            for item in value
        ]
    return _bounded_cell_string(str(value), string_state)


def _normalize_chart(
    chart: Optional[Chart], columns: Sequence[str]
) -> Optional[dict[str, Any]]:
    if chart is None:
        return None
    if not isinstance(chart, Chart):
        raise KxNotebookError("chart must be a kx_notebook.Chart")
    chart_type = str(chart.type).lower()
    if chart_type not in {"line", "scatter", "step", "bar"}:
        raise KxNotebookError("chart type must be line, scatter, step, or bar")
    if chart.x_column not in columns:
        raise KxNotebookError(f"chart x column {chart.x_column!r} is not in the table")
    y_columns = list(chart.y_columns)
    if not y_columns or len(y_columns) > 16:
        raise KxNotebookError("chart requires between 1 and 16 y columns")
    if len(set(y_columns)) != len(y_columns):
        raise KxNotebookError("chart y columns must be unique")
    if chart.x_column in y_columns:
        raise KxNotebookError("chart x column cannot also be a y column")
    missing = [name for name in y_columns if name not in columns]
    if missing:
        raise KxNotebookError(f"chart y column {missing[0]!r} is not in the table")
    output: dict[str, Any] = {
        "version": 1,
        "visible": True,
        "type": chart_type,
        "xColumn": chart.x_column,
        "yColumns": y_columns,
    }
    if chart.title is not None:
        output["title"] = _required_bounded_string(
            "chart title", chart.title, MAX_LABEL_CHARS
        )
    return output


def _column_type(rows: Sequence[Sequence[Mapping[str, Any]]], column_index: int) -> str:
    kinds = {
        str(row[column_index]["kind"])
        for row in rows
        if row[column_index].get("kind") != "null"
    }
    if not kinds:
        return "null"
    if len(kinds) == 1:
        return next(iter(kinds))
    return "mixed"


def _bounded_cell_string(value: str, state: _StringState) -> str:
    if len(value) <= MAX_STRING_CHARS:
        return value
    state.truncated = True
    return value[: MAX_STRING_CHARS - 1] + "…"


def _bounded_integer(name: str, value: Any, minimum: int, maximum: int) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not minimum <= value <= maximum
    ):
        raise KxNotebookError(
            f"{name} must be an integer from {minimum} through {maximum}"
        )
    return value


def _optional_row_count(value: Optional[int]) -> Optional[int]:
    if value is None:
        return None
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < 0
        or value > JS_SAFE_INTEGER
    ):
        raise TableShapeError(
            f"row_count must be a non-negative integer through {JS_SAFE_INTEGER}"
        )
    return value


def _total_row_count(explicit: Optional[int], available: int) -> int:
    if explicit is not None and explicit < available:
        raise TableShapeError(
            f"row_count={explicit} is smaller than the supplied bounded table length {available}"
        )
    return explicit if explicit is not None else available


def _elapsed_ms(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    number = float(value)
    if not math.isfinite(number) or number < 0:
        raise KxNotebookError("elapsed_ms must be a finite non-negative number")
    return round(number, 3)


def _required_bounded_string(name: str, value: Any, maximum: int) -> str:
    if not isinstance(value, str) or not value:
        raise KxNotebookError(f"{name} must be a non-empty string")
    if len(value) > maximum:
        raise KxNotebookError(f"{name} exceeds {maximum} characters")
    return value


def _optional_bounded_string(
    name: str, value: Optional[str], maximum: int
) -> Optional[str]:
    if value is None:
        return None
    return _required_bounded_string(name, value, maximum)


def _timedelta_text(value: dt.timedelta) -> str:
    total_micros = (
        value.days * 86_400_000_000 + value.seconds * 1_000_000 + value.microseconds
    )
    sign = "-" if total_micros < 0 else ""
    total_micros = abs(total_micros)
    hours, remainder = divmod(total_micros, 3_600_000_000)
    minutes, remainder = divmod(remainder, 60_000_000)
    seconds, micros = divmod(remainder, 1_000_000)
    suffix = f".{micros:06d}".rstrip("0") if micros else ""
    return f"{sign}PT{hours}H{minutes}M{seconds}{suffix}S"
