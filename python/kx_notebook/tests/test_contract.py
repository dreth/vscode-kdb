from __future__ import annotations

import datetime as dt
import math
import unittest

from kx_notebook import (
    MIME_TYPE,
    Chart,
    KxNotebookError,
    TableShapeError,
    build_mime_bundle,
)
from kx_notebook.contract import MAX_STRING_CHARS, canonical_payload_bytes


class ContractTests(unittest.TestCase):
    def test_exact_v1_shape_and_typed_cells(self) -> None:
        output = build_mime_bundle(
            [
                {
                    "null": None,
                    "flag": True,
                    "number": 2.5,
                    "big": 2**63 - 1,
                    "text": "AAPL",
                    "when": dt.datetime(2026, 7, 22, 9, 0, tzinfo=dt.timezone.utc),
                    "nested": {"items": [1, "x"]},
                }
            ]
        )
        self.assertEqual(set(output.bundle), {MIME_TYPE, "text/html", "text/plain"})
        payload = output.bundle[MIME_TYPE]
        self.assertEqual(payload["version"], 1)
        self.assertEqual(payload["kind"], "table")
        self.assertEqual(payload["data"]["encoding"], "rows")
        self.assertEqual(
            [cell["kind"] for cell in payload["data"]["rows"][0]],
            ["null", "boolean", "number", "bigint", "string", "temporal", "json"],
        )
        self.assertEqual(payload["data"]["rows"][0][3]["value"], str(2**63 - 1))
        self.assertEqual(payload["provenance"], {"marker": "%%q"})
        self.assertEqual(payload["result"]["rowCount"], 1)
        self.assertEqual(payload["result"]["previewRowCount"], 1)
        self.assertFalse(payload["result"]["truncated"])
        self.assertEqual(payload["result"]["truncationReasons"], [])
        canonical_payload_bytes(payload)

    def test_row_limit_does_not_consume_past_preview(self) -> None:
        consumed: list[int] = []

        def rows():
            for index in range(1_000_000):
                consumed.append(index)
                yield [index]

        output = build_mime_bundle(
            rows(), columns=["id"], row_count=1_000_000, row_limit=3
        )
        result = output.bundle[MIME_TYPE]["result"]
        self.assertEqual(consumed, [0, 1, 2])
        self.assertEqual(result["previewRowCount"], 3)
        self.assertTrue(result["truncated"])
        self.assertIn("rowLimit", result["truncationReasons"])
        self.assertIn("full result is not embedded", output.bundle["text/html"])

    def test_total_mime_body_byte_limit_reduces_rows(self) -> None:
        rows = [{"id": index, "note": "x" * 500} for index in range(100)]
        output = build_mime_bundle(rows, row_limit=100, byte_limit=16_384)
        payload = output.bundle[MIME_TYPE]
        self.assertLessEqual(output.body_bytes, 16_384)
        self.assertLess(payload["result"]["previewRowCount"], 100)
        self.assertIn("byteLimit", payload["result"]["truncationReasons"])
        self.assertIn("portable output limit", output.bundle["text/plain"])

    def test_byte_limited_zero_row_preview_retains_inferred_schema(self) -> None:
        output = build_mime_bundle(
            [{"large": "x" * 20_000, "count": 7}],
            row_limit=1,
            byte_limit=16_384,
        )
        payload = output.bundle[MIME_TYPE]
        self.assertEqual(payload["result"]["previewRowCount"], 0)
        self.assertEqual(
            payload["schema"]["columns"],
            [
                {"name": "large", "type": "string"},
                {"name": "count", "type": "number"},
            ],
        )
        self.assertIn("byteLimit", payload["result"]["truncationReasons"])

    def test_supplied_bounded_prefix_preserves_total_count(self) -> None:
        output = build_mime_bundle([{"id": 1}, {"id": 2}], row_count=20, row_limit=10)
        payload = output.bundle[MIME_TYPE]
        self.assertEqual(payload["result"]["rowCount"], 20)
        self.assertEqual(payload["result"]["previewRowCount"], 2)
        self.assertIn("sourcePreview", payload["result"]["truncationReasons"])
        self.assertIn("bounded source preview", output.bundle["text/html"])

    def test_strings_are_bounded_and_notice_is_persisted(self) -> None:
        output = build_mime_bundle(
            [{"text": "x" * (MAX_STRING_CHARS + 10)}], byte_limit=200_000
        )
        payload = output.bundle[MIME_TYPE]
        value = payload["data"]["rows"][0][0]["value"]
        self.assertEqual(len(value), MAX_STRING_CHARS)
        self.assertTrue(value.endswith("…"))
        self.assertIn("cellValueLimit", payload["result"]["truncationReasons"])

    def test_html_escapes_all_untrusted_source_and_has_no_network_script(self) -> None:
        hostile = (
            '<script src="https://evil.test/x.js">alert(1)</script><img onerror="x">'
        )
        output = build_mime_bundle(
            [{hostile: hostile}],
            label=hostile,
            q_source=hostile,
        )
        fallback = output.bundle["text/html"]
        self.assertNotIn(hostile, fallback)
        self.assertNotIn("<script", fallback.lower())
        self.assertNotIn('src="https://', fallback.lower())
        self.assertNotIn('onerror="', fallback.lower())
        self.assertIn("&lt;script", fallback)
        payload = output.bundle[MIME_TYPE]
        self.assertEqual(payload["provenance"]["qSource"], hostile)
        self.assertIn("<summary>q source</summary>", fallback)

    def test_static_chart_spec_and_svg_are_persisted_without_external_assets(
        self,
    ) -> None:
        output = build_mime_bundle(
            [
                {"time": "2026-07-22T09:00:00Z", "price": 10.0},
                {"time": "2026-07-22T09:01:00Z", "price": 11.5},
            ],
            chart=Chart("line", "time", ("price",), title="Price <safe>"),
        )
        payload = output.bundle[MIME_TYPE]
        self.assertEqual(
            payload["chart"],
            {
                "version": 1,
                "visible": True,
                "type": "line",
                "xColumn": "time",
                "yColumns": ["price"],
                "title": "Price <safe>",
            },
        )
        fallback = output.bundle["text/html"]
        self.assertIn("<svg", fallback)
        self.assertIn("<polyline", fallback)
        self.assertIn("Price &lt;safe&gt;", fallback)
        self.assertNotIn(
            "http://", fallback.replace('xmlns="http://www.w3.org/2000/svg"', "")
        )
        self.assertNotIn("https://", fallback)
        self.assertIn("see the HTML/SVG fallback", output.bundle["text/plain"])

    def test_nonfinite_numbers_and_invalid_shapes_are_rejected(self) -> None:
        for value in (math.nan, math.inf, -math.inf):
            with self.subTest(value=value):
                with self.assertRaisesRegex(KxNotebookError, "non-finite"):
                    build_mime_bundle([{"value": value}])
        with self.assertRaisesRegex(TableShapeError, "one-shot iterables require"):
            build_mime_bundle(iter([[1]]))
        with self.assertRaisesRegex(TableShapeError, "unique"):
            build_mime_bundle([[1, 2]], columns=["x", "x"])
        with self.assertRaisesRegex(KxNotebookError, "cannot also be a y column"):
            build_mime_bundle(
                [{"x": 1, "y": 2}],
                chart=Chart("line", "x", ("x",)),
            )


if __name__ == "__main__":
    unittest.main()
