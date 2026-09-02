# 该文件用于验证当前可见订单行扫描脚本。
from __future__ import annotations

from .browser_case import ErpScriptBrowserCase


class VisibleOrderRowsScriptTest(ErpScriptBrowserCase):
    def test_visible_order_rows_scan_uses_current_visible_columns(self) -> None:
        html = """
        <!doctype html>
        <meta charset="utf-8">
        <style>
          .ag-root-wrapper, .ag-root, .ag-header, .ag-center-cols-container { display: block; width: 700px; }
          .ag-header-cell, .ag-cell { display: inline-block; width: 150px; height: 24px; border: 1px solid #ddd; }
          .ag-row { display: block; height: 26px; }
        </style>
        <div class="ag-root-wrapper">
          <div class="ag-root">
            <div class="ag-header">
              <div class="ag-header-row" role="row">
                <div class="ag-header-cell" role="columnheader" col-id="platformOrder"><span class="ag-header-cell-text">平台单号</span></div>
                <div class="ag-header-cell" role="columnheader" col-id="payDate"><span class="ag-header-cell-text">支付日期</span></div>
              </div>
            </div>
            <div class="ag-center-cols-container">
              <div class="ag-row" role="row" row-index="0">
                <div class="ag-cell" role="gridcell" col-id="platformOrder">6925796695684191964</div>
                <div class="ag-cell" role="gridcell" col-id="payDate">2026-05-13 08:30:16</div>
              </div>
            </div>
          </div>
        </div>
        """

        result = self._run_visible_order_rows_script(html)

        self.assertEqual(result["source"], "visible-ag-grid")
        self.assertEqual(result["headers"], ["平台单号", "支付日期"])
        self.assertEqual(result["rows"][0], ["6925796695684191964", "2026-05-13 08:30:16"])

    def test_visible_order_rows_scan_accepts_refund_void_view_without_identity_columns(self) -> None:
        html = """
        <!doctype html>
        <meta charset="utf-8">
        <style>
          .ag-root-wrapper, .ag-root, .ag-header, .ag-center-cols-container { display: block; width: 900px; }
          .ag-header-cell, .ag-cell { display: inline-block; width: 120px; height: 24px; border: 1px solid #ddd; }
          .ag-row { display: block; height: 26px; }
        </style>
        <div class="ag-root-wrapper">
          <div class="ag-root">
            <div class="ag-header">
              <div class="ag-header-row" role="row">
                <div class="ag-header-cell" role="columnheader" col-id="express"><span class="ag-header-cell-text">建议快递</span></div>
                <div class="ag-header-cell" role="columnheader" col-id="warehouse"><span class="ag-header-cell-text">建议仓库</span></div>
                <div class="ag-header-cell" role="columnheader" col-id="void"><span class="ag-header-cell-text">作废</span></div>
                <div class="ag-header-cell" role="columnheader" col-id="refund"><span class="ag-header-cell-text">退款</span></div>
                <div class="ag-header-cell" role="columnheader" col-id="remark"><span class="ag-header-cell-text">卖家备注</span></div>
                <div class="ag-header-cell" role="columnheader" col-id="delivery"><span class="ag-header-cell-text">配货状态</span></div>
              </div>
            </div>
            <div class="ag-center-cols-container">
              <div class="ag-row" role="row" row-index="0">
                <div class="ag-cell" role="gridcell" col-id="express">顺丰速运[自动匹配]</div>
                <div class="ag-cell" role="gridcell" col-id="warehouse">深圳家...</div>
                <div class="ag-cell" role="gridcell" col-id="void"></div>
                <div class="ag-cell" role="gridcell" col-id="refund">√</div>
                <div class="ag-cell" role="gridcell" col-id="remark">88</div>
                <div class="ag-cell" role="gridcell" col-id="delivery">全部配货</div>
              </div>
            </div>
          </div>
        </div>
        """

        result = self._run_visible_order_rows_script(html)

        self.assertEqual(result["source"], "visible-ag-grid")
        self.assertEqual(result["headers"], ["建议快递", "建议仓库", "作废", "退款", "卖家备注", "配货状态"])
        self.assertEqual(result["rows"][0][3], "√")

    def test_visible_order_rows_scan_reads_ext_grid_rows(self) -> None:
        html = """
        <!doctype html>
        <meta charset="utf-8">
        <style>
          .x-grid, .x-grid-header-ct, .x-grid-row { display: block; width: 900px; }
          .x-column-header, .x-grid-cell { display: inline-block; width: 150px; height: 24px; border: 1px solid #ddd; }
        </style>
        <div class="x-grid">
          <div class="x-grid-header-ct">
            <div class="x-column-header">平台单号</div>
            <div class="x-column-header">店铺名称</div>
            <div class="x-column-header">单据时间</div>
          </div>
          <div class="x-grid-row">
            <div class="x-grid-cell">1</div>
            <div class="x-grid-cell">6925796695684191964</div>
            <div class="x-grid-cell">测试店铺</div>
            <div class="x-grid-cell">2026-05-27 09:30:00</div>
          </div>
        </div>
        """

        result = self._run_visible_order_rows_script(html)

        self.assertEqual(result["source"], "visible-ext-grid")
        self.assertEqual(result["headers"], ["平台单号", "店铺名称", "单据时间"])
        self.assertEqual(result["rows"][0], ["6925796695684191964", "测试店铺", "2026-05-27 09:30:00"])

    def test_visible_order_rows_scan_reads_role_grid_rows(self) -> None:
        html = """
        <!doctype html>
        <meta charset="utf-8">
        <style>
          [role='grid'], [role='row'], [role='columnheader'], [role='gridcell'] { display: block; width: 700px; min-height: 20px; }
          [role='columnheader'], [role='gridcell'] { display: inline-block; width: 150px; }
        </style>
        <div role="grid">
          <div role="row">
            <div role="columnheader">平台单号</div>
            <div role="columnheader">会员名称</div>
          </div>
          <div role="row">
            <div role="gridcell">P-ROLE-001</div>
            <div role="gridcell">张三</div>
          </div>
        </div>
        """

        result = self._run_visible_order_rows_script(html)

        self.assertEqual(result["source"], "visible-role-grid")
        self.assertEqual(result["headers"], ["平台单号", "会员名称"])
        self.assertEqual(result["rows"][0], ["P-ROLE-001", "张三"])

    def test_visible_order_rows_not_found_reports_candidate_structure(self) -> None:
        html = """
        <!doctype html>
        <meta charset="utf-8">
        <style>
          .x-grid, .x-grid-header-ct, .x-grid-row { display: block; width: 700px; }
          .x-column-header, .x-grid-cell { display: inline-block; width: 120px; height: 24px; }
        </style>
        <div class="x-grid">
          <div class="x-grid-header-ct"><div class="x-column-header">商品名称</div></div>
          <div class="x-grid-row"><div class="x-grid-cell">测试商品</div></div>
        </div>
        """

        result = self._run_visible_order_rows_script(html)

        self.assertEqual(result["source"], "visible-order-not-found")
        self.assertTrue(any("x-grid" in item for item in result["candidate_sources"]))


