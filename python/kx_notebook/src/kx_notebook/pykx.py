"""Opt-in adapter for a PyKX q object already installed in the Python kernel."""

from __future__ import annotations

import importlib
from typing import Any, Callable, Optional

from .contract import (
    DEFAULT_BYTE_LIMIT,
    DEFAULT_ROW_LIMIT,
    EvaluationResult,
    TableShapeError,
)
from .magic import configure_evaluator


def configure_pykx(
    q: Optional[Callable[[str], Any]] = None,
    *,
    label: str = "PyKX q in this Python kernel",
    row_limit: int = DEFAULT_ROW_LIMIT,
    byte_limit: int = DEFAULT_BYTE_LIMIT,
    include_q_source: bool = False,
) -> None:
    """Use an explicitly supplied/existing PyKX q object; never open direct IPC."""

    if q is None:
        try:
            pykx = importlib.import_module("pykx")
        except (ImportError, OSError) as error:
            raise RuntimeError(
                "PyKX is not installed or could not load in this kernel. Install/configure PyKX "
                "separately under its KX licensing requirements, or pass an existing evaluator "
                "to kx_notebook.configure_evaluator()."
            ) from error
        q = getattr(pykx, "q", None)
    if not callable(q):
        raise TypeError("q must be a callable PyKX q object")

    def evaluate(source: str) -> EvaluationResult:
        value = q(source)
        if not all(
            hasattr(value, member) for member in ("__len__", "__getitem__", "py")
        ):
            raise TableShapeError(
                "The optional PyKX adapter publishes table-like q results only. "
                "Convert this value to a bounded table or use a custom evaluator callback."
            )
        total_rows = len(value)
        bounded_value = value[: min(total_rows, row_limit)]
        converted = bounded_value.py()
        return EvaluationResult(converted, row_count=total_rows)

    configure_evaluator(
        evaluate,
        label=label,
        row_limit=row_limit,
        byte_limit=byte_limit,
        include_q_source=include_q_source,
    )
