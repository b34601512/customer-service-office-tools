# 该文件用于处理 ERP 打开、监控启停和退出动作。
from __future__ import annotations

import threading


class ThreadActionsMixin:
    def open_erp_async(self) -> None:
        # 该函数用于后台打开 ERP，避免 HTTP 请求一直卡住。
        if self.open_thread is not None and self.open_thread.is_alive():
            self._append_log("ERP 打开流程已经在运行。")
            return
        self.open_thread = threading.Thread(target=self._open_erp_worker, name="open-erp", daemon=True)
        self.open_thread.start()

    def start_monitor(self, source: str = "后台手动启动") -> None:
        # 该函数用于启动自动监控线程，重复调用不会启动第二份。
        if self.monitor_thread is not None and self.monitor_thread.is_alive():
            if self.monitor_stop_event.is_set():
                self._monitor_restart_requested = True
                self.next_scan_at = None
                self._set_phase("重启中")
                self._set_indicator("monitor", "running", "已收到重新开始请求，当前扫描收尾后会自动恢复监控。")
                self._append_log("已收到重新开始请求：当前监控线程正在停止，收尾后自动重新启动。")
                return
            self._append_log("自动监控已经在运行。")
            return
        if not self._erp_ready_for_monitor():
            message = "启动监控失败：请先点击「打开 ERP」并完成登录，等第1步「ERP浏览器」显示正常后再启动监控。"
            self._set_indicator("monitor", "warning", message)
            self._append_log(message)
            raise RuntimeError(message)
        start_source = str(source or "未知入口").strip() or "未知入口"
        self._monitor_restart_requested = False
        self._append_log("========== 启动自动监控 ==========")
        self._append_log(
            f"监控启动入口：{start_source}；查询间隔={self.config.monitor.interval_minutes} 分钟；"
            f"模式=每轮自动点击 ERP 查询，固定等待 5 秒后导出当前页；通知付款范围最近 {self.config.notification.payment_time_range_days} 天。"
        )
        self.monitor_stop_event.clear()
        self.monitor_thread = threading.Thread(target=self._monitor_worker, name="refund-monitor", daemon=True)
        self.monitor_thread.start()

    def _erp_ready_for_monitor(self) -> bool:
        # 该函数用第1步的真实状态做硬门禁，避免未登录时启动监控进入失败循环。
        return self.indicators.get("browser") is not None and self.indicators["browser"].state == "ok"

    def stop_monitor(self) -> None:
        # 该函数用于停止自动监控，但保留 ERP 浏览器方便继续人工查看。
        self.monitor_stop_event.set()
        self._monitor_restart_requested = False
        self.next_scan_at = None
        self._set_indicator("monitor", "idle", "已请求停止自动监控。")
        self._set_phase("停止中")
        self._append_log("已发送停止自动监控信号。")

    def exit_all(self) -> None:
        # 该函数用于退出后台并关闭本工具打开的浏览器。
        if self.exiting:
            return
        self.exiting = True
        self.monitor_stop_event.set()
        self._set_phase("退出中")
        self._append_log("正在退出：停止监控并关闭本工具打开的 ERP 浏览器。")
        threading.Thread(target=self._exit_worker, name="exit-all", daemon=True).start()


__all__ = ["ThreadActionsMixin"]
