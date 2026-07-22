"""IPython display entry point for portable KX result bundles."""

from __future__ import annotations

from typing import Any, Optional, Sequence

from .contract import (
    DEFAULT_BYTE_LIMIT,
    DEFAULT_ROW_LIMIT,
    Chart,
    PortableOutput,
    build_mime_bundle,
)


def display_result(
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
    """Publish one raw IPython MIME bundle and return it for inspection/tests."""

    from IPython.display import display

    output = build_mime_bundle(
        value,
        columns=columns,
        row_count=row_count,
        label=label,
        elapsed_ms=elapsed_ms,
        q_source=q_source,
        row_limit=row_limit,
        byte_limit=byte_limit,
        chart=chart,
    )
    display(output.bundle, raw=True)
    return output
