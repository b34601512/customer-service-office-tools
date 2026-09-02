# 该文件用于执行 ERP 打开、监控循环、单次扫描和退出清理等后台线程动作。
from __future__ import annotations

import time

from ..control_form import format_exception as _format_exception


class WorkersMixin:
    def _open_erp_worker(self) -> None:
        # 该函数用于在线程里打开 ERP 并等待订单页就绪。
        try:
            self._set_phase("登录中")
            self._set_indicator("browser", "running", "正在打开 ERP，请在受控浏览器里完成登录。")
            state = self.browser.open_erp(self.config)
            self._append_log(f"ERP 已打开：{state.url}")
            self.browser.wait_order_page(self.config, status=self._append_log)
            self._set_phase("就绪")
            self._set_indicator("browser", "ok", "已检测到订单查询页，登录状态会保存在本工具独立浏览器目录。")
        except Exception as exc:
            reason = _format_exception(exc)
            self._set_phase("登录异常")
            self._set_indicator("browser", "warning", f"打开 ERP 或等待订单页失败：{reason}")
            self._append_log(f"打开 ERP 或等待订单页失败：{reason}")

    def _monitor_worker(self) -> None:
        # 该函数用于在线程里按配置间隔循环扫描订单。
        try:
            while True:
                self._set_phase("监控中")
                self._set_indicator("monitor", "running", f"自动监控已启动，间隔 {self.config.monitor.interval_minutes} 分钟；通知付款范围最近 {self.config.notification.payment_time_range_days} 天。")
                self._append_log("自动监控线程已进入循环：每轮自动点击 ERP 查询，固定等待 5 秒后导出当前页，导出表内退款订单全部采集。")
                while not self.monitor_stop_event.is_set():
                    scan_failed = False
                    try:
                        self._scan_once_worker(True)
                    except Exception as exc:
                        scan_failed = True
                        reason = _format_exception(exc)
                        self._set_phase("监控中")
                        self._append_log(f"本轮扫描失败，已跳过本轮，监控线程继续等待下一次自动查询：{reason}")
                    interval_sec = max(5, int(self.config.monitor.interval_minutes) * 60)
                    self.next_scan_at = time.time() + interval_sec
                    if scan_failed:
                        self._set_indicator("monitor", "warning", "本轮扫描失败，等待下一次自动重试。")
                    else:
                        self._set_indicator("monitor", "running", "等待下一次自动查询。")
                    if self.monitor_stop_event.wait(timeout=interval_sec):
                        break
                if not self._consume_monitor_restart_request():
                    break
                self._append_log("自动监控已按重新开始请求恢复。")
            self._set_phase("已停止")
            self._set_indicator("monitor", "idle", "自动监控已停止。")
        except Exception as exc:
            reason = _format_exception(exc)
            self._set_phase("监控异常")
            self._set_indicator("monitor", "warning", f"自动监控异常：{reason}")
            self._append_log(f"自动监控异常：{reason}")

    def _consume_monitor_restart_request(self) -> bool:
        # 该函数用于把“停止中又点击启动”的请求转成同一线程内的重新开始，避免停一次后无法恢复。
        if not self._monitor_restart_requested or self.shutdown_event.is_set():
            return False
        self._monitor_restart_requested = False
        self.monitor_stop_event.clear()
        self.next_scan_at = None
        return True

    def _scan_once_worker(self, notify: bool) -> None:
        # 该函数用于执行一轮订单扫描、判定、提醒和统计更新。
        try:
            self.last_scan_at = time.time()
            self._append_log("开始执行本轮扫描：先点击 ERP 查询，固定等待 5 秒，再导出订单查询.xlsx。")
            self._set_indicator("scan", "running", "正在点击 ERP 查询，固定等待 5 秒后导出，并采集导出表内全部退款订单。")
            existing_pending_keys = self._pending_record_keys()
            summary = self.browser.scan_orders(self.config, status=self._append_scan_progress, on_problem_order=self._record_incremental_scanned_problem_order)
            self._remember_scanned_problem_orders(summary.detection.problem_orders)
            active_orders, handled_count = self._filter_unhandled_orders(summary.detection.problem_orders)
            alert_orders = self._filter_new_unhandled_orders(active_orders, existing_pending_keys)
            notification_orders = self._filter_notification_payment_time_orders(alert_orders)
            self.last_problem_orders = summary.detection.problem_orders
            count = len(active_orders)
            detail = f"本次导出读取 {summary.detection.total_rows} 行，采集退款订单 {len(summary.detection.problem_orders)} 个，当前未处理 {count} 个，新增 {len(alert_orders)} 个"
            if handled_count:
                detail += f"，另有 {handled_count} 个已人工处理订单保留在绿色列表"
            detail += "。"
            self._set_indicator("scan", "ok", detail)
            self._append_log(detail)
            self._append_detection_summary(summary.detection)
            if count <= 0:
                self._set_indicator("alert", "ok", "本次没有需要提醒的订单。")
                self._mark_scan_success(summary.detection.total_rows)
                return
            row_labels = "、".join(f"第{item.row_index + 1}行" for item in active_orders[:8])
            self._append_log(f"待处理订单位置：{row_labels}")
            self._set_new_order_alert_indicator(count, alert_orders, notification_orders)
            if notify and notification_orders:
                self.notification_sender(self.config, notification_orders)
                labels = "、".join(item.summary for item in notification_orders[:8])
                extra = f"，另有 {len(notification_orders) - 8} 个未展开" if len(notification_orders) > 8 else ""
                self._append_log(f"已触发新增订单系统通知：{labels}{extra}。")
            self._mark_scan_success(summary.detection.total_rows)
        except Exception as exc:
            reason = _format_exception(exc)
            self._set_indicator("scan", "warning", f"扫描失败：{reason}")
            self._append_log(f"扫描失败：{reason}")
            raise

    def _mark_scan_success(self, total_rows: int) -> None:
        # 该函数用于把一轮完整成功的监控结果写入累计统计。
        stats = self.monitor_stats.mark_success()
        self._set_indicator("stats", "ok", self._format_monitor_stats_detail(stats))
        self._append_log(f"累计成功监控次数已更新：第 {stats.successful_scan_count} 次，本次读取 {int(total_rows)} 行。")

    def _exit_worker(self) -> None:
        # 该函数用于在线程里关闭本工具打开的浏览器并通知主服务退出。
        try:
            self.browser.force_kill_managed_browsers()
            self._set_indicator("browser", "idle", "本工具打开的 ERP 浏览器已关闭。")
            self._append_log("已关闭本工具打开的受控浏览器，后台服务即将退出。")
        finally:
            self.shutdown_event.set()


__all__ = ["WorkersMixin"]
