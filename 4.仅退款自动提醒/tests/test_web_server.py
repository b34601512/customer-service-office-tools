#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from pathlib import Path
import unittest

from refund_reminder.web_control.server import _is_expected_client_disconnect


WEB_DIR = Path(__file__).resolve().parents[1] / "refund_reminder" / "web_control" / "web"


class WebServerTest(unittest.TestCase):
    def test_expected_disconnect(self) -> None:
        self.assertTrue(_is_expected_client_disconnect(BrokenPipeError()))
        self.assertFalse(_is_expected_client_disconnect(RuntimeError("真实错误")))

    def test_order_search_has_clear_button_and_short_layout(self) -> None:
        html = (WEB_DIR / "index.html").read_text(encoding="utf-8")
        css = (WEB_DIR / "orders.css").read_text(encoding="utf-8")
        app_js = (WEB_DIR / "app.js").read_text(encoding="utf-8")
        board_js = (WEB_DIR / "order_board.js").read_text(encoding="utf-8")

        self.assertIn('class="order-search-tools"', html)
        self.assertIn('id="clearOrderSearchButton"', html)
        self.assertIn("清除搜索", html)
        self.assertIn("width: min(100%, 680px);", css)
        self.assertIn("clearOrderSearchButton: document.getElementById", app_js)
        self.assertIn("function resetOrderSearch()", board_js)
        self.assertIn("elements.clearOrderSearchButton.addEventListener", board_js)

    def test_order_board_split_scripts_are_served(self) -> None:
        html = (WEB_DIR / "index.html").read_text(encoding="utf-8")
        server_py = (WEB_DIR.parent / "server.py").read_text(encoding="utf-8")

        self.assertIn('/order_board_helpers.js"', html)
        self.assertIn('/order_toggle_feedback.js"', html)
        self.assertIn('"/order_board_helpers.js"', server_py)
        self.assertIn('"/order_toggle_feedback.js"', server_py)

    def test_handled_orders_open_in_dialog(self) -> None:
        html = (WEB_DIR / "index.html").read_text(encoding="utf-8")
        app_js = (WEB_DIR / "app.js").read_text(encoding="utf-8")
        board_js = (WEB_DIR / "order_board.js").read_text(encoding="utf-8")

        self.assertIn('id="toggleHandledButton"', html)
        self.assertIn('aria-controls="handledPanel"', html)
        self.assertIn('id="handledPanel" class="handled-modal hidden"', html)
        self.assertIn('role="dialog"', html)
        self.assertIn('id="closeHandledButton"', html)
        self.assertNotIn('data-view-target="handled"', html)
        self.assertNotIn('id="handledView"', html)
        self.assertIn('id="verifyingOrderList"', html)
        self.assertIn('id="processingOrderList"', html)
        self.assertIn('id="handledSearchInput"', html)
        self.assertIn("function setHandledDialogVisible", app_js)
        self.assertIn('toggleHandledButton.addEventListener("click", openHandledDialog)', app_js)
        self.assertIn("handledPanel.addEventListener", app_js)
        self.assertIn("handledBoard: document.getElementById", app_js)
        self.assertIn("const verifyingOrders = allOrders.filter((order) => !order.handled && order.verifying && !order.processing);", board_js)
        self.assertIn("const processingOrders = allOrders.filter((order) => !order.handled && order.processing);", board_js)
        self.assertIn("const handledOrders = allOrders.filter((order) => order.handled);", board_js)
        self.assertIn("state.handledSearchText", board_js)
        self.assertIn("dateRangeDays: 1", board_js)
        self.assertIn("function orderMatchesDateRange(order)", board_js)
        self.assertIn("function setConfiguredDateRangeDays(value)", board_js)
        self.assertIn("function handleDateFilterClick(button)", board_js)
        self.assertIn("elements.dateFilterButtons.forEach", board_js)
        self.assertIn("setConfiguredDateRangeDays(snapshot.form", app_js)
        self.assertIn('data-order-date-days="1"', html)
        self.assertIn('data-order-date-days="2"', html)
        self.assertIn('data-order-date-days="7"', html)
        self.assertIn("/api/orders/set-verifying", board_js)
        order_card_js = (WEB_DIR / "order_card.js").read_text(encoding="utf-8")
        self.assertIn("开始处理", order_card_js)
        self.assertIn("转处理中", order_card_js)
        self.assertIn("sellerRemarkText", order_card_js)
        self.assertIn("卖家备注", order_card_js)

    def test_monitor_status_uses_single_action_panel(self) -> None:
        html = (WEB_DIR / "index.html").read_text(encoding="utf-8")
        css = (WEB_DIR / "base.css").read_text(encoding="utf-8")
        app_js = (WEB_DIR / "app.js").read_text(encoding="utf-8")

        self.assertIn('class="action-workflow" id="workflowGrid"', html)
        self.assertIn('id="workflowActionPool"', html)
        self.assertIn('<button id="exitButton" class="danger">退出后台</button>', html)
        self.assertIn('id="workflowStatusText"', html)
        self.assertNotIn('topbar-actions', html)
        self.assertIn("stats: [openLogButton, exitButton]", app_js)
        self.assertNotIn('id="statusText"', html)
        self.assertNotIn("indicatorGrid", html)
        self.assertIn("function buildWorkflowSteps", app_js)
        self.assertIn("function renderWorkflowStep", app_js)
        self.assertIn("function buildWorkflowActions", app_js)
        self.assertIn("function parkDetachedWorkflowActions", app_js)
        self.assertIn("workflowActionTargets", app_js)
        self.assertIn("workflowSteps", app_js)
        self.assertIn("本轮处理时间", app_js)
        self.assertIn("runtime.statusText", app_js)
        self.assertIn("function setWorkflowStatusText", app_js)
        self.assertIn("formatFullDateTime", app_js)
        self.assertIn("runtime.lastScanAt", app_js)
        self.assertIn(".workflow-tree", css)
        self.assertIn(".workflow-step", css)
        self.assertIn(".workflow-actions", css)
        self.assertIn(".workflow-status-text", css)
        self.assertIn(".workflow-time", css)
        self.assertIn("workflow-pulse", css)
        self.assertNotIn("statusText.textContent", app_js)
        self.assertNotIn("status-card", app_js)
        self.assertNotIn("selectedIndicator", app_js)
        self.assertNotIn("action-step", app_js)

    def test_order_cards_wrap_inside_columns(self) -> None:
        css = (WEB_DIR / "orders.css").read_text(encoding="utf-8")

        self.assertRegex(css, r"\.order-title-row strong\s*\{[^}]*overflow-wrap: anywhere;")
        self.assertRegex(css, r"\.order-info-chip span\s*\{[^}]*overflow-wrap: anywhere;")
        self.assertIn("flex: 1 1 0;", css)
        self.assertIn("min-width: min(210px, 100%);", css)

    def test_order_columns_have_independent_boundaries(self) -> None:
        css = (WEB_DIR / "orders.css").read_text(encoding="utf-8")

        self.assertRegex(css, r"\.order-column\s*\{[^}]*border: 1px solid #d7e2ec;")
        self.assertRegex(css, r"\.order-column\s*\{[^}]*border-top: 4px solid #b3261e;")
        self.assertRegex(css, r"\.verifying-column\s*\{[^}]*border-top-color: #f29900;")
        self.assertRegex(css, r"\.processing-column\s*\{[^}]*border-top-color: #1a73e8;")
        self.assertIn("min-height: 210px;", css)

    def test_order_note_uses_option_dialog(self) -> None:
        html = (WEB_DIR / "index.html").read_text(encoding="utf-8")
        css = (WEB_DIR / "note_dialog.css").read_text(encoding="utf-8")
        style_css = (WEB_DIR / "style.css").read_text(encoding="utf-8")
        board_js = (WEB_DIR / "order_board.js").read_text(encoding="utf-8")
        note_js = (WEB_DIR / "note_dialog.js").read_text(encoding="utf-8")

        self.assertIn('/note_dialog.js"', html)
        self.assertIn('/note_dialog.css', style_css)
        self.assertIn("window.noteDialogModule.open", board_js)
        self.assertNotIn("window.prompt", board_js)
        self.assertIn('DEFAULT_PRESETS = ["已通知拦截"]', note_js)
        self.assertIn("保存时追加当前时间", note_js)
        self.assertIn("新增自定义备注选项", note_js)
        self.assertIn("保存修改", note_js)
        self.assertIn("取消编辑", note_js)
        self.assertIn("startEditCustomPreset", note_js)
        self.assertIn("refund_reminder_note_presets_v1", note_js)
        self.assertIn(".note-dialog-backdrop", css)
        self.assertIn(".note-preset-edit", css)

    def test_order_note_has_visible_marker(self) -> None:
        order_card_js = (WEB_DIR / "order_card.js").read_text(encoding="utf-8")
        css = (WEB_DIR / "orders.css").read_text(encoding="utf-8")

        self.assertIn("function appendNoteBadge", order_card_js)
        self.assertIn('badge.textContent = "有备注"', order_card_js)
        self.assertIn('article.className = `order-item ${statusClass}${noteText ? " has-note" : ""}`;', order_card_js)
        self.assertIn('button.className = `small-button note-button${noteText ? " has-note" : ""}`;', order_card_js)
        self.assertIn(".order-item.has-note", css)
        self.assertIn(".order-note-badge", css)
        self.assertIn(".note-button.has-note", css)

    def test_state_polling_errors_are_visible(self) -> None:
        app_js = (WEB_DIR / "app.js").read_text(encoding="utf-8")

        self.assertIn("async function pollState()", app_js)
        self.assertIn("后台状态刷新失败", app_js)
        self.assertIn("后台连接异常", app_js)
        self.assertIn('"state-poll"', app_js)
        self.assertNotIn("catch(() => {})", app_js)

    def test_recovered_state_polling_error_is_cleared(self) -> None:
        app_js = (WEB_DIR / "app.js").read_text(encoding="utf-8")

        self.assertIn('function setFeedback(message, state = "info", kind = "")', app_js)
        self.assertIn("feedback.dataset.kind = kind || \"\";", app_js)
        self.assertIn("function clearRecoveredStatePollFeedback()", app_js)
        self.assertIn('if (feedback.dataset.kind === "state-poll") setFeedback("");', app_js)
        self.assertIn("clearRecoveredStatePollFeedback();", app_js)
        self.assertIn('setFeedback(`后台状态刷新失败：${message}`, "error", "state-poll");', app_js)

    def test_exit_stops_state_polling(self) -> None:
        app_js = (WEB_DIR / "app.js").read_text(encoding="utf-8")

        self.assertIn("let statePollTimer = null;", app_js)
        self.assertIn("let backendExitRequested = false;", app_js)
        self.assertIn("function stopStatePolling()", app_js)
        self.assertIn("function markControlCenterExited(message)", app_js)
        self.assertIn("function requestControlExit()", app_js)
        self.assertIn('exitButton.addEventListener("click", exitControlCenter)', app_js)
        self.assertIn("statePollTimer = window.setInterval(pollState, 2000);", app_js)
        self.assertNotIn('runDirectAction(exitButton, "/api/control/exit"', app_js)

    def test_monitor_buttons_follow_runtime_state(self) -> None:
        app_js = (WEB_DIR / "app.js").read_text(encoding="utf-8")

        self.assertIn("function syncMonitorButtons(runtime)", app_js)
        self.assertIn("const monitoring = Boolean(runtime && runtime.monitoring);", app_js)
        self.assertIn("const stopRequested = Boolean(runtime && runtime.monitorStopRequested);", app_js)
        self.assertIn("function isErpReady(runtime)", app_js)
        self.assertIn("function isErpOpening(runtime)", app_js)
        self.assertIn('text: erpOpening ? "等待 ERP" : "先打开 ERP"', app_js)
        self.assertIn('text: "ERP已锁定"', app_js)
        self.assertIn('text: "重新开始"', app_js)
        self.assertIn('text: "监控中"', app_js)
        self.assertIn("syncMonitorButtons(runtime);", app_js)

    def test_realtime_logs_show_latest_first_and_dialog_shares_same_text(self) -> None:
        app_js = (WEB_DIR / "app.js").read_text(encoding="utf-8")
        html = (WEB_DIR / "index.html").read_text(encoding="utf-8")

        self.assertIn("function formatLatestFirstLogs(logLines)", app_js)
        self.assertIn("Array.from(lines).reverse().join", app_js)
        self.assertIn("function syncLogOutputs(runtime)", app_js)
        self.assertNotIn('data-view-target="logs"', html)
        self.assertNotIn('id="logsView"', html)
        self.assertIn('id="toggleLogButton"', html)
        self.assertIn('aria-controls="logDialog"', html)
        self.assertIn("logDialogOutput.textContent = text", app_js)

    def test_log_button_opens_page_dialog_not_external_file(self) -> None:
        html = (WEB_DIR / "index.html").read_text(encoding="utf-8")
        app_js = (WEB_DIR / "app.js").read_text(encoding="utf-8")
        server_py = (WEB_DIR.parent / "server.py").read_text(encoding="utf-8")

        self.assertIn('id="logDialog"', html)
        self.assertIn('id="toggleLogButton"', html)
        self.assertIn("查看日志", html)
        self.assertIn("实时日志", html)
        self.assertIn("function openLogDialog(triggerButton = openLogButton)", app_js)
        self.assertIn('openLogButton.addEventListener("click", () => openLogDialog(openLogButton))', app_js)
        self.assertIn('toggleLogButton.addEventListener("click", () => openLogDialog(toggleLogButton))', app_js)
        self.assertNotIn("/api/actions/open-startup-log", app_js)
        self.assertNotIn("/api/actions/open-startup-log", server_py)
        self.assertNotIn("本次日志文件", html)

    def test_config_button_opens_dialog_not_view_panel(self) -> None:
        html = (WEB_DIR / "index.html").read_text(encoding="utf-8")
        app_js = (WEB_DIR / "app.js").read_text(encoding="utf-8")
        css = (WEB_DIR / "layout_form.css").read_text(encoding="utf-8")

        self.assertIn('id="toggleConfigButton"', html)
        self.assertIn('aria-controls="configPanel"', html)
        self.assertIn('id="configPanel" class="config-modal hidden"', html)
        self.assertIn('role="dialog"', html)
        self.assertIn('id="closeConfigButton"', html)
        self.assertIn('id="configFeedback"', html)
        self.assertNotIn('data-view-target="config"', html)
        self.assertNotIn('id="configView"', html)
        self.assertIn("function setConfigDialogVisible", app_js)
        self.assertIn("function openConfigDialog", app_js)
        self.assertIn('toggleConfigButton.addEventListener("click", openConfigDialog)', app_js)
        self.assertIn("configPanel.addEventListener", app_js)
        self.assertIn("setConfigFeedback(payload.message, \"success\")", app_js)
        self.assertIn(".config-modal", css)
        self.assertIn(".config-dialog", css)
        self.assertIn(".config-actions", css)

    def test_config_form_hides_refund_void_column_fields(self) -> None:
        config_form_js = (WEB_DIR / "config_form.js").read_text(encoding="utf-8")

        self.assertNotIn("退款列名", config_form_js)
        self.assertNotIn("作废列名", config_form_js)
        self.assertNotIn("refund_column_names", config_form_js)
        self.assertNotIn("void_column_names", config_form_js)
        self.assertNotIn("操作日志备注列", config_form_js)
        self.assertNotIn("退款状态关键词", config_form_js)
        self.assertNotIn("operation_log_note_column_names", config_form_js)
        self.assertNotIn("refund_status_log_keywords", config_form_js)
        self.assertNotIn("refund_application_date", config_form_js)
        self.assertNotIn("支付日期", config_form_js)
        self.assertIn("通知付款范围", config_form_js)
        self.assertIn("payment_time_range_days", config_form_js)
        self.assertIn("今天", config_form_js)
        self.assertIn("2天内", config_form_js)
        self.assertNotIn("每次查询前点击查询", config_form_js)
        self.assertNotIn("表格稳定等待秒", config_form_js)
        self.assertNotIn("click_search_before_scan", config_form_js)
        self.assertNotIn("query_stable_timeout_sec", config_form_js)

    def test_config_help_uses_purchase_date_filter_copy(self) -> None:
        html = (WEB_DIR / "index.html").read_text(encoding="utf-8")

        self.assertIn("通知和订单处理区共用付款范围", html)
        self.assertIn("购买时间", html)
        self.assertIn('data-order-date-days="1"', html)
        self.assertIn('data-order-date-days="2"', html)
        self.assertIn('data-order-date-days="7"', html)
        self.assertNotIn("退款申请日期默认今天", html)
        self.assertNotIn("支付日期默认今天", html)


if __name__ == "__main__":
    unittest.main()
