"""Honest fixed-data adapter for examples and protocol tests (not a q parser)."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any


class FixtureEvaluator:
    """Map exact q source strings to fixed table-like values."""

    def __init__(self, fixtures: Mapping[str, Any]) -> None:
        self._fixtures = dict(fixtures)

    def __call__(self, source: str) -> Any:
        if source not in self._fixtures:
            raise KeyError(f"No fixture is registered for exact q source {source!r}")
        return self._fixtures[source]
