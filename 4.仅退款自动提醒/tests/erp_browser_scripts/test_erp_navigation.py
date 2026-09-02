# 该文件用于验证 ERP 订单页导航前置动作。
from __future__ import annotations

from refund_reminder.erp_navigation import ensure_custom_filter_panel

from .browser_case import ErpScriptBrowserCase


class ErpNavigationScriptTest(ErpScriptBrowserCase):
    def test_ensure_custom_filter_panel_uses_page_when_frames_are_empty(self) -> None:
        class FakePage:
            frames = []

            def evaluate(self, _script: str) -> dict:
                return {"found": True, "already_open": True, "clicked": False, "fields_visible": True, "source": "fake-page"}

        result = ensure_custom_filter_panel(FakePage())

        self.assertTrue(result["fields_visible"], result)
        self.assertEqual(result["source"], "frame0:fake-page")

    def test_ensure_custom_filter_panel_clicks_closed_custom_section(self) -> None:
        html = """
        <!doctype html>
        <meta charset="utf-8">
        <style>
          .left-filter { position: absolute; left: 0; top: 220px; width: 220px; }
          .filter-head, .custom-head, .custom-body label { display: block; width: 180px; height: 30px; }
          .custom-body { display: none; }
        </style>
        <div class="left-filter">
          <div class="filter-head">默认筛选</div>
          <button class="custom-head" onclick="
            window.customFilterClicked = true;
            document.querySelector('.custom-body').style.display = 'block';
          ">自定义</button>
          <div class="custom-body">
            <label>自定义条件</label>
            <label>单据时间</label>
            <label>平台单号</label>
          </div>
        </div>
        """
        page = self._browser.new_page()
        try:
            page.set_content(html)

            result = ensure_custom_filter_panel(page)

            self.assertTrue(result["found"], result)
            self.assertTrue(result["clicked"], result)
            self.assertTrue(result["fields_visible"], result)
            self.assertTrue(page.evaluate("() => window.customFilterClicked === true"))
        finally:
            page.close()

    def test_ensure_custom_filter_panel_keeps_open_custom_section(self) -> None:
        html = """
        <!doctype html>
        <meta charset="utf-8">
        <style>
          .left-filter { position: absolute; left: 0; top: 220px; width: 220px; }
          .filter-head, .custom-head, .custom-body label { display: block; width: 180px; height: 30px; }
        </style>
        <div class="left-filter">
          <div class="filter-head">默认筛选</div>
          <button class="custom-head" onclick="window.customFilterClicked = true">自定义</button>
          <div class="custom-body">
            <label>自定义条件</label>
            <label>单据时间</label>
            <label>平台单号</label>
          </div>
        </div>
        """
        page = self._browser.new_page()
        try:
            page.set_content(html)

            result = ensure_custom_filter_panel(page)

            self.assertTrue(result["found"], result)
            self.assertTrue(result["already_open"], result)
            self.assertFalse(result["clicked"], result)
            self.assertTrue(result["fields_visible"], result)
            self.assertFalse(page.evaluate("() => window.customFilterClicked === true"))
        finally:
            page.close()
