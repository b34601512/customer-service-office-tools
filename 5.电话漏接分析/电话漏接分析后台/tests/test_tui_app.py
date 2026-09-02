from __future__ import annotations

import io
import unittest
from unittest.mock import patch

from missed_call_backend.tui_app import Page, TuiApp


class _Page(Page):
    key = "1"
    title = "测试"

    def render(self, app: TuiApp) -> list[str]:
        return ["测试内容"]


class _Application:
    _console_close_requested = False


class _Output(io.StringIO):
    columns = 100
    rows = 30

    def isatty(self) -> bool:
        return True


class TuiLifecycleTest(unittest.TestCase):
    def build_app(self) -> TuiApp:
        return TuiApp("测试", [_Page()], _Application(), output=_Output())

    def test_stop_restores_terminal_after_running_was_already_false(self) -> None:
        app = self.build_app()
        with patch("missed_call_backend.tui_app.os.name", "posix"), patch.object(
            app, "_configure_windows_console_modes"
        ):
            app.start()
            app.running = False
            app.stop()

        output = app.output.getvalue()
        self.assertIn("\x1b[?1049h", output)
        self.assertIn("\x1b[?1049l", output)
        self.assertFalse(app._terminal_started)

    def test_windows_close_event_requests_fast_application_exit(self) -> None:
        application = _Application()
        app = TuiApp("测试", [_Page()], application, output=_Output())
        app.running = True

        self.assertEqual(app._handle_windows_console_control(2), 1)
        self.assertFalse(app.running)
        self.assertTrue(application._console_close_requested)

    def test_unknown_windows_control_event_is_not_consumed(self) -> None:
        app = self.build_app()
        app.running = True

        self.assertEqual(app._handle_windows_console_control(99), 0)
        self.assertTrue(app.running)


if __name__ == "__main__":
    unittest.main()
