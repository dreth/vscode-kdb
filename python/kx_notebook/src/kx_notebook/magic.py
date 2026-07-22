"""Explicit callback-backed IPython ``%%q`` cell magic."""

from __future__ import annotations

import inspect
import shlex
import time
from dataclasses import dataclass
from typing import Any, Callable, Optional

from IPython.core.error import UsageError
from IPython.core.magic import Magics, cell_magic, magics_class

from . import display as display_module
from .contract import (
    DEFAULT_BYTE_LIMIT,
    DEFAULT_ROW_LIMIT,
    EvaluationResult,
    build_mime_bundle,
)


Evaluator = Callable[[str], Any]


@dataclass(frozen=True)
class _EvaluatorConfiguration:
    evaluator: Evaluator
    label: Optional[str]
    row_limit: int
    byte_limit: int
    include_q_source: bool


@dataclass(frozen=True)
class _MagicOptions:
    row_limit: int
    byte_limit: int
    label: Optional[str]


_configuration: Optional[_EvaluatorConfiguration] = None


def configure_evaluator(
    evaluator: Evaluator,
    *,
    label: Optional[str] = None,
    row_limit: int = DEFAULT_ROW_LIMIT,
    byte_limit: int = DEFAULT_BYTE_LIMIT,
    include_q_source: bool = False,
) -> None:
    """Configure the only evaluator used by ``%%q`` in this Python process."""

    if not callable(evaluator):
        raise TypeError("evaluator must be callable")
    # Validate limits and labels through the same portable builder path without
    # invoking the evaluator or publishing anything.
    build_mime_bundle(
        [],
        columns=["_validation"],
        label=label,
        row_limit=row_limit,
        byte_limit=byte_limit,
    )
    global _configuration
    _configuration = _EvaluatorConfiguration(
        evaluator=evaluator,
        label=label,
        row_limit=row_limit,
        byte_limit=byte_limit,
        include_q_source=bool(include_q_source),
    )


def clear_evaluator() -> None:
    """Remove the configured evaluator, primarily for tests/kernel teardown."""

    global _configuration
    _configuration = None


@magics_class
class KxQMagics(Magics):
    @cell_magic
    def q(self, line: str, cell: str) -> None:
        """Evaluate a durable ``%%q`` cell through the configured callback."""

        configuration = _configuration
        if configuration is None:
            raise UsageError(
                "No q evaluator is configured. Call kx_notebook.configure_evaluator(callback) "
                "or explicitly configure the optional PyKX adapter first."
            )
        options = _parse_magic_line(line, configuration)
        started = time.perf_counter()
        evaluated = configuration.evaluator(cell)
        if inspect.isawaitable(evaluated):
            if inspect.iscoroutine(evaluated):
                evaluated.close()
            raise UsageError(
                "The configured q evaluator returned an awaitable; %%q requires a synchronous callback"
            )
        elapsed_ms = (time.perf_counter() - started) * 1000
        result = (
            evaluated
            if isinstance(evaluated, EvaluationResult)
            else EvaluationResult(evaluated)
        )
        label = result.label if result.label is not None else options.label
        display_module.display_result(
            result.value,
            columns=result.columns,
            row_count=result.row_count,
            label=label,
            elapsed_ms=elapsed_ms,
            q_source=cell if configuration.include_q_source else None,
            row_limit=options.row_limit,
            byte_limit=options.byte_limit,
            chart=result.chart,
        )


def load_ipython_extension(ipython: Any) -> None:
    ipython.register_magics(KxQMagics)


def _parse_magic_line(
    line: str, configuration: _EvaluatorConfiguration
) -> _MagicOptions:
    try:
        tokens = shlex.split(line, posix=True)
    except ValueError as error:
        raise UsageError(f"Invalid %%q marker options: {error}") from error
    row_limit = configuration.row_limit
    byte_limit = configuration.byte_limit
    label = configuration.label
    seen: set[str] = set()
    index = 0
    while index < len(tokens):
        option = tokens[index]
        if option not in {"--max-rows", "--max-bytes", "--label"}:
            raise UsageError(
                f"Unknown %%q option {option!r}; supported options are --max-rows, --max-bytes, and --label"
            )
        if option in seen:
            raise UsageError(f"Duplicate %%q option {option}")
        seen.add(option)
        index += 1
        if index >= len(tokens):
            raise UsageError(f"%%q option {option} requires a value")
        value = tokens[index]
        index += 1
        if option == "--label":
            label = value
            continue
        try:
            number = int(value, 10)
        except ValueError as error:
            raise UsageError(
                f"%%q option {option} requires a base-10 integer"
            ) from error
        if str(number) != value and not (
            value.startswith("+") and str(number) == value[1:]
        ):
            raise UsageError(f"%%q option {option} requires a base-10 integer")
        if option == "--max-rows":
            row_limit = number
        else:
            byte_limit = number

    # This validates label and row/byte ranges before executing arbitrary q.
    try:
        build_mime_bundle(
            [],
            columns=["_validation"],
            label=label,
            row_limit=row_limit,
            byte_limit=byte_limit,
        )
    except ValueError as error:
        raise UsageError(f"Invalid %%q marker options: {error}") from error
    return _MagicOptions(row_limit=row_limit, byte_limit=byte_limit, label=label)
