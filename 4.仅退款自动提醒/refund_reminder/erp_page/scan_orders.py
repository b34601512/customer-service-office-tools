# 该文件用于刷新 ERP 退款订单页、导出当前页并读取导出表。
from __future__ import annotations

import time
from pathlib import Path
from typing import Any, Callable

from ..config import AppConfig
from ..erp_navigation import click_search, ensure_custom_filter_panel
from ..exported_order_workbook import read_exported_order_workbook
from ..erp_grid.export_current_page import export_current_order_page
from ..logger import log
from ..order_detector import detect_problem_orders_from_exported_rows
from ..runtime_paths import get_app_root
from .constants import MODULE_NAME
from .types import ProblemOrderCallback, ScanSummary


QUERY_EXPORT_DELAY_SEC = 5.0


class ScanOrdersMixin:
    def _do_scan_orders(
        self,
        page: Any,
        user_data_dir: Path | None,
        config: AppConfig,
        status: Callable[[str], None] | None,
        on_problem_order: ProblemOrderCallback | None = None,
    ) -> ScanSummary:
        # 该函数用于每轮自动点击 ERP 查询，固定等待后导出当前页订单表。
        self._require_page(page, user_data_dir)
        self._emit(status, "扫描流程开始：先确认订单查询页，再自动点击查询；本轮不判断刷新是否成功，固定等待 5 秒后导出。")
        self._do_wait_order_page(page, user_data_dir, config, status)
        self._emit(status, "准备启用左侧「自定义」筛选区域，再点击查询按钮。")
        custom_filter_state = ensure_custom_filter_panel(page)
        log("Browser", "启用自定义筛选", MODULE_NAME, "_do_scan_orders.custom_filter", **custom_filter_state)
        if not custom_filter_state.get("fields_visible"):
            raise RuntimeError(f"扫描前未能启用左侧「自定义」筛选区域：{custom_filter_state}")
        self._emit(
            status,
            f"自定义筛选状态：{'已展开' if custom_filter_state.get('already_open') else '已点击展开'}，来源 {custom_filter_state.get('source') or '未知'}。",
        )
        self._emit(status, "准备点击订单查询按钮，让 ERP 重新加载当前筛选结果。")
        clicked = click_search(page)
        log("Browser", "点击查询", MODULE_NAME, "_do_scan_orders.click_search", clicked=clicked)
        self._emit(status, f"点击订单查询按钮：{'成功' if clicked else '未找到可点击按钮'}。")
        if not clicked:
            raise RuntimeError("扫描前点击订单查询失败：未找到可点击的「查询」按钮。")
        self._emit(status, f"已点击查询，固定等待 {QUERY_EXPORT_DELAY_SEC:g} 秒后开始导出；本轮不再判断 ERP 是否刷新成功。")
        time.sleep(QUERY_EXPORT_DELAY_SEC)
        grid_payload = _call_scan_visible_order_rows(page, config)
        self._emit(
            status,
            f"等待后当前页订单表快照：来源 {grid_payload.get('source') or '未知'}，"
            f"表头 {len(grid_payload.get('headers') or [])} 列，可见 {len(grid_payload.get('rows') or [])} 行。"
        )
        export_path = export_current_order_page(page, config, get_app_root() / "订单查询.xlsx", status=status)
        self._emit(status, f"正在读取导出的订单表：{export_path.name}。")
        payload = read_exported_order_workbook(export_path)
        self._emit(status, f"已读取导出表：来源 {payload.get('source') or '未知'}，共 {len(payload.get('rows') or [])} 行。")
        detection = detect_problem_orders_from_exported_rows(payload, config.detection)
        for order in detection.problem_orders:
            if on_problem_order is not None:
                on_problem_order(order)
        log("Browser", "订单扫描完成", MODULE_NAME, "_do_scan_orders.done", total=detection.total_rows, problems=len(detection.problem_orders), source=detection.source)
        self._emit(status, f"订单扫描完成：来源 {detection.source}，导出读取 {detection.total_rows} 行，采集退款订单 {len(detection.problem_orders)} 个。")
        return ScanSummary(page_state=self._page_state(page, user_data_dir), detection=detection)

def _call_scan_visible_order_rows(page: Any, config: AppConfig) -> dict[str, Any]:
    # 该函数只读取等待后的当前页快照用于反馈，不再参与是否允许导出的稳定判定。
    from ..erp_grid import scan_visible_order_rows_in_frames

    return scan_visible_order_rows_in_frames(page, config)

__all__ = ["ScanOrdersMixin"]
