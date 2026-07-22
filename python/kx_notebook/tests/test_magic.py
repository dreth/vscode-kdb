from __future__ import annotations

import unittest
from unittest import mock

from IPython.core.error import UsageError
from IPython.core.interactiveshell import InteractiveShell
from IPython.utils.capture import capture_output

from kx_notebook import (
    FixtureEvaluator,
    MIME_TYPE,
    clear_evaluator,
    configure_evaluator,
    display_result,
)
from kx_notebook.magic import KxQMagics
from kx_notebook.magic import load_ipython_extension
from kx_notebook.pykx import configure_pykx


class MagicTests(unittest.TestCase):
    def tearDown(self) -> None:
        clear_evaluator()

    def test_magic_calls_exact_configured_source_and_publishes_raw_bundle(self) -> None:
        calls: list[str] = []

        def evaluator(source: str):
            calls.append(source)
            return [{"sym": "AAPL", "price": 224.1}]

        configure_evaluator(evaluator, label="test callback")
        magic = KxQMagics(shell=None)
        with mock.patch("IPython.display.display") as display:
            self.assertIsNone(magic.q("", "select from trades"))
        self.assertEqual(calls, ["select from trades"])
        display.assert_called_once()
        bundle = display.call_args.args[0]
        self.assertTrue(display.call_args.kwargs["raw"])
        self.assertEqual(bundle[MIME_TYPE]["provenance"]["label"], "test callback")
        self.assertIn("elapsedMs", bundle[MIME_TYPE]["provenance"])
        self.assertNotIn("qSource", bundle[MIME_TYPE]["provenance"])

    def test_display_result_emits_all_three_mime_bodies_through_ipython(self) -> None:
        InteractiveShell.instance()
        with capture_output() as captured:
            display_result([{"x": 1}])
        self.assertEqual(len(captured.outputs), 1)
        self.assertEqual(
            set(captured.outputs[0].data),
            {MIME_TYPE, "text/html", "text/plain"},
        )
        self.assertEqual(captured.outputs[0].data[MIME_TYPE]["version"], 1)

    def test_source_persistence_is_explicit_opt_in(self) -> None:
        configure_evaluator(lambda source: [{"ok": True}], include_q_source=True)
        with mock.patch("IPython.display.display") as display:
            KxQMagics(shell=None).q("", "show `secret")
        payload = display.call_args.args[0][MIME_TYPE]
        self.assertEqual(payload["provenance"]["qSource"], "show `secret")

    def test_durable_marker_options_override_limits_and_label(self) -> None:
        calls: list[str] = []

        def evaluator(source: str):
            calls.append(source)
            return [{"id": index} for index in range(5)]

        configure_evaluator(
            evaluator, label="configured", row_limit=10, byte_limit=100_000
        )
        with mock.patch("IPython.display.display") as display:
            KxQMagics(shell=None).q(
                '--max-rows 2 --max-bytes 20000 --label "cell preview"',
                "select from t",
            )
        payload = display.call_args.args[0][MIME_TYPE]
        self.assertEqual(calls, ["select from t"])
        self.assertEqual(payload["result"]["rowLimit"], 2)
        self.assertEqual(payload["result"]["byteLimit"], 20000)
        self.assertEqual(payload["result"]["previewRowCount"], 2)
        self.assertEqual(payload["provenance"]["label"], "cell preview")

    def test_invalid_marker_options_do_not_execute_q(self) -> None:
        evaluator = mock.Mock(return_value=[{"x": 1}])
        configure_evaluator(evaluator)
        magic = KxQMagics(shell=None)
        invalid_lines = [
            "--max-rows 0",
            "--max-rows 10001",
            "--max-bytes nope",
            "--max-bytes 10000001",
            "--max-rows 2 --max-rows 3",
            "--unknown 3",
            "--label",
        ]
        for line in invalid_lines:
            with self.subTest(line=line):
                with self.assertRaises(UsageError):
                    magic.q(line, "1+1")
        evaluator.assert_not_called()

    def test_magic_rejects_args_async_and_missing_evaluator(self) -> None:
        magic = KxQMagics(shell=None)
        with self.assertRaisesRegex(UsageError, "No q evaluator"):
            magic.q("", "1+1")
        configure_evaluator(lambda source: [{"x": 1}])
        with self.assertRaisesRegex(UsageError, "Unknown %%q option"):
            magic.q("--connection other", "1+1")

        async def async_evaluator(source: str):
            return [{"x": source}]

        configure_evaluator(async_evaluator)
        with self.assertRaisesRegex(UsageError, "awaitable"):
            magic.q("", "1+1")

    def test_fixture_evaluator_is_exact_and_does_not_claim_q_parsing(self) -> None:
        fixture = FixtureEvaluator({"demo": [{"x": 1}]})
        self.assertEqual(fixture("demo"), [{"x": 1}])
        with self.assertRaises(KeyError):
            fixture(" demo")

    def test_ipython_extension_hook_registers_the_magic_class(self) -> None:
        shell = mock.Mock()
        load_ipython_extension(shell)
        shell.register_magics.assert_called_once_with(KxQMagics)

    def test_pykx_missing_is_actionable_and_explicit_adapter_bounds_before_py(
        self,
    ) -> None:
        with mock.patch(
            "kx_notebook.pykx.importlib.import_module",
            side_effect=ImportError("missing"),
        ):
            with self.assertRaisesRegex(RuntimeError, "PyKX is not installed"):
                configure_pykx()

        class FakeKxTable:
            def __init__(self, rows, trace):
                self.rows = rows
                self.trace = trace

            def __len__(self):
                return len(self.rows)

            def __getitem__(self, item):
                self.trace.append(("slice", item.start, item.stop))
                return FakeKxTable(self.rows[item], self.trace)

            def py(self):
                self.trace.append(("py", len(self.rows)))
                return self.rows

        trace = []
        fake_q = mock.Mock(
            return_value=FakeKxTable([{"x": i} for i in range(20)], trace)
        )
        configure_pykx(fake_q, row_limit=3)
        with mock.patch("IPython.display.display") as display:
            KxQMagics(shell=None).q("", "select from t")
        fake_q.assert_called_once_with("select from t")
        self.assertEqual(trace, [("slice", None, 3), ("py", 3)])
        payload = display.call_args.args[0][MIME_TYPE]
        self.assertEqual(payload["result"]["rowCount"], 20)
        self.assertEqual(payload["result"]["previewRowCount"], 3)
        self.assertIn("rowLimit", payload["result"]["truncationReasons"])


if __name__ == "__main__":
    unittest.main()
