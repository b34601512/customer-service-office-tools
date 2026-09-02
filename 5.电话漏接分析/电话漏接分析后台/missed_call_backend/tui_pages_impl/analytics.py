"""TUI 数据统计页面：客服、趋势。"""
from __future__ import annotations

import threading
from datetime import timedelta
from typing import Any

from ..analysis import aggregate_monthly_summary
from ..cli_data import (
    build_daily_trend_rows,
    build_filtered_agent_summary,
    earliest_result_day,
    filter_agents_for_comparison,
    filter_cached_records,
    filter_trend_rows_by_dates,
    latest_result_day,
    range_label,
)
from ..cli_display import build_table_lines, colorize, highlight_queue_loss, render_bar, spinner_frame
from ..cli_input import format_rate
from ..normalizers import format_seconds
from ..state_store import load_download_config
from ..tui_app import Page
from .raw_tables import apply_highlight

AGENT_METRIC_CONFIG: dict[str, dict[str, str]] = {
    "1": {"key": "totalContactCount", "label": "综合"},
    "2": {"key": "inboundCount", "label": "呼入"},
    "3": {"key": "outboundCount", "label": "呼出"},
    "4": {"key": "outboundTalkSeconds", "label": "外呼质量"},
}


def _scroll_page(key: str, app: Any, state: dict[str, Any], total_lines: int, height: int | None = None) -> bool:
    """通用滚动：up/down/pgup/pgdn/home/end，返回是否消费了按键。

    height 传入时按指定高度分页（用于只滚动明细、表头固定的页面）。
    """
    page_height = height if height is not None else app.content_height
    page_height = max(1, page_height)
    max_offset = max(0, total_lines - page_height)
    offset = int(state.get("scroll_offset", 0))
    if key == "up":
        if offset > 0:
            state["scroll_offset"] = offset - 1
        elif max_offset > 0:
            # 顶部按↑：环绕到最底部
            state["scroll_offset"] = max_offset
            app.feedback("↻ 已跳到底部")
    elif key == "down":
        if offset < max_offset:
            state["scroll_offset"] = offset + 1
        elif max_offset > 0:
            # 底部按↓：环绕回最顶部
            state["scroll_offset"] = 0
            app.feedback("↻ 已跳回顶部")
    elif key == "pgup":
        state["scroll_offset"] = max(0, offset - (page_height - 1))
    elif key == "pgdn":
        state["scroll_offset"] = min(max_offset, offset + (page_height - 1))
    elif key == "home":
        state["scroll_offset"] = 0
    elif key == "end":
        state["scroll_offset"] = max_offset
    else:
        return False
    return True


def _slice_lines(lines: list[str], app: Any, state: dict[str, Any]) -> list[str]:
    """按滚动位置截取当前屏可见行，并记录总行数供页脚显示位置。"""
    state["_total_lines"] = len(lines)
    offset = int(state.get("scroll_offset", 0))
    max_offset = max(0, len(lines) - app.content_height)
    if offset > max_offset:
        offset = max_offset
        state["scroll_offset"] = offset
    return lines[offset : offset + app.content_height]


class AgentsPage(Page):
    key = "4"
    title = "客服"

    def __init__(self) -> None:
        super().__init__()
        self.state.update(
            scroll_offset=0,
            load_confirmed=False,
            loading=False,
            loaded_lines=None,
            loading_error="",
            loading_notice_pending=False,
        )

    @property
    def periodic_refresh(self) -> bool:
        """仅加载期间定时刷新以播放旋转动画；加载完成后停止重绘，不打扰鼠标选择。"""
        return bool(self.state.get("loading"))

    def on_enter(self, app: Any) -> None:
        self.state["scroll_offset"] = 0
        self.state["load_confirmed"] = False
        self.state["loading"] = False
        self.state["loaded_lines"] = None
        self.state["loading_error"] = ""
        self.state["loading_notice_pending"] = False

    def _result_key(self, app: Any) -> str:
        """当前分析结果的版本号：用于在重新下载分析后自动作废旧缓存。"""
        result = app.application.latest_result or {}
        cache = result.get("latestDownloadCache") or {}
        return str(cache.get("savedAt") or result.get("updatedAt") or "")

    def _start_loading(self, app: Any) -> None:
        """按回车后先显示“正在加载”，汇总在后台线程完成后再展示，避免界面假死。"""
        self.state["load_confirmed"] = True
        self.state["loading"] = True
        self.state["loading_error"] = ""
        self.state["loaded_lines"] = None
        self.state["loading_notice_pending"] = True
        result = app.application.latest_result
        latest_day = latest_result_day(result) if result else None
        if latest_day is None:
            self.state["loading"] = False
            return
        self.state["result_key"] = self._result_key(app)

        def _worker() -> None:
            try:
                lines = self._lines(app, latest_day)
            except Exception as error:
                lines = None
                self.state["loading_error"] = f"客服统计加载失败：{error}"
            self.state["loaded_lines"] = lines
            self.state["loading"] = False
            request_render = getattr(app, "request_render", None)
            if request_render:
                request_render()

        threading.Thread(target=_worker, daemon=True).start()

    def _prompt_lines(self, latest_day: Any, result: Any) -> list[str]:
        """未开始加载时的提示画面。"""
        return [
            colorize(f"客服统计：{range_label(0, latest_day, earliest_result_day(result))}", "bold"),
            "",
            colorize("读取并汇总呼入、呼出明细可能需要几秒。", "yellow"),
            "",
            colorize("▶ 按回车开始加载", "brightCyan"),
            colorize("←→切换菜单  q返回首页", "muted"),
        ]

    def render(self, app: Any) -> list[str]:
        result = app.application.latest_result
        if not result:
            return [colorize("暂无分析结果。", "yellow")]
        latest_day = latest_result_day(result)
        if not latest_day:
            return [colorize("暂无客服统计数据。", "yellow")]
        if not self.state.get("load_confirmed"):
            return self._prompt_lines(latest_day, result)
        if self.state.get("loading"):
            loading_lines = [
                colorize(f"正在加载客服统计：{range_label(0, latest_day, earliest_result_day(result))}", "bold"),
                "",
                colorize(f"{spinner_frame()} 正在汇总呼入、呼出明细，请稍候…", "brightCyan"),
            ]
            self.state.pop("loading_notice_pending", None)
            return loading_lines
        if self._result_key(app) != self.state.get("result_key"):
            # 结果已更新（重新下载/分析）：作废旧结果，回到待确认界面
            self.state["load_confirmed"] = False
            self.state["loading"] = False
            self.state["loaded_lines"] = None
            self.state["loading_notice_pending"] = False
            self.state["result_key"] = self._result_key(app)
            return self._prompt_lines(latest_day, result)
        if self.state.get("loading_error"):
            return [colorize(self.state["loading_error"], "yellow")]
        lines = self.state.get("loaded_lines")
        if lines is None:
            return [colorize("暂无客服统计数据。", "yellow")]
        return _slice_lines(lines, app, self.state)

    def _lines(self, app: Any, latest_day: Any) -> list[str]:
        filtered_records = filter_cached_records(app.application.ensure_cached_records(), 0, latest_day)
        agents = build_filtered_agent_summary(filtered_records)
        config = AGENT_METRIC_CONFIG["1"]
        comparison_agents = sorted(
            filter_agents_for_comparison(agents, "1"),
            key=lambda item: (float(item.get(config["key"]) or 0), float(item.get("totalTalkSeconds") or 0)),
            reverse=True,
        )
        sorted_agents = sorted(
            agents,
            key=lambda item: (float(item.get(config["key"]) or 0), float(item.get("totalTalkSeconds") or 0)),
            reverse=True,
        )

        lines: list[str] = []
        lines.append(colorize(f"客服统计：{range_label(0, latest_day, earliest_result_day(app.application.latest_result))}", "bold"))
        lines.append("")
        inbound_total = sum(float(agent.get("inboundCount") or 0) for agent in agents)
        outbound_total = sum(float(agent.get("outboundCount") or 0) for agent in agents)
        inbound_success = sum(float(agent.get("successfulInboundCount") or 0) for agent in agents)
        outbound_success = sum(float(agent.get("successfulOutboundCount") or 0) for agent in agents)
        total_talk = sum(float(agent.get("totalTalkSeconds") or 0) for agent in agents)
        lines += build_table_lines(
            ["项目", "数量"],
            [
                ["座席数", len(agents)],
                ["总通话", int(inbound_total + outbound_total)],
                ["总接通", int(inbound_success + outbound_success)],
                ["总通话时长", format_seconds(total_talk)],
            ],
        )
        lines.append("")
        lines.append(colorize("客服对比", "bold"))
        for label, key, suffix in [
            ("总通话最多", "totalContactCount", "次"),
            ("总接通最多", "successfulContactCount", "次"),
            ("总通话最长", "totalTalkSeconds", "秒"),
            ("综合成功率最高", "successRate", "%"),
        ]:
            if not comparison_agents:
                break
            champion = max(comparison_agents, key=lambda item: float(item.get(key) or 0))
            value = champion.get(key) or 0
            if suffix == "%":
                value_text = format_rate(value)
            elif suffix == "秒":
                value_text = format_seconds(value)
            else:
                value_text = f"{int(float(value))}{suffix}"
            lines.append(f"{label:<14} {str(champion.get('agentName') or '未填写')[:14]:<14} {colorize(value_text, 'blue')}")
        lines.append("")
        lines.append(colorize("综合通话量排行（柱状条=总通话次数，按综合维度排序）", "bold"))
        maximum = max([float(item.get(config["key"]) or 0) for item in comparison_agents] or [1])
        for agent in comparison_agents:
            value = float(agent.get(config["key"]) or 0)
            lines.append(
                f"{str(agent.get('agentName') or '未填写')[:14]:<14} "
                f"{colorize(render_bar(value, maximum), 'blue')} {int(value)}次"
            )
        lines.append("")
        lines += build_table_lines(
            ["分机", "客服", "呼入", "接通", "呼入率", "呼出", "接通", "呼出率", "外呼时长", "总时长"],
            [
                [
                    "、".join(agent.get("extensions") or []) or "未识别",
                    agent.get("agentName", ""),
                    agent.get("inboundCount", 0),
                    agent.get("successfulInboundCount", 0),
                    format_rate(agent.get("inboundSuccessRate", 0)),
                    agent.get("outboundCount", 0),
                    agent.get("successfulOutboundCount", 0),
                    format_rate(agent.get("outboundSuccessRate", 0)),
                    agent.get("outboundTalkText", "0秒"),
                    agent.get("totalTalkText", "0秒"),
                ]
                for agent in sorted_agents
            ],
        )
        return lines

    def handle_key(self, key: str, app: Any) -> bool:
        if key == "enter" and not self.state.get("load_confirmed"):
            self._start_loading(app)
            return True
        if not self.state.get("load_confirmed"):
            return False
        lines = self.state.get("loaded_lines")
        if self.state.get("loading") or lines is None:
            # 汇总尚未完成：不响应滚动按键
            return False
        return _scroll_page(key, app, self.state, len(lines))

    def footer(self, app: Any) -> str:
        if not self.state.get("load_confirmed"):
            return "回车开始加载  ←→切页 q返回首页"
        if self.state.get("loading"):
            return "←→切页 q返回首页"
        total = int(self.state.get("_total_lines", 0))
        if total <= app.content_height:
            return "内容已全部展示  ←→切页 q返回首页"
        offset = int(self.state.get("scroll_offset", 0))
        end = min(total, offset + app.content_height)
        return f"↑↓滚动 PgUp/PgDn翻页 Home/End到头尾（显示 {offset + 1}~{end}/{total} 行） ←→切页 q返回首页"


class TrendsPage(Page):
    key = "5"
    title = "趋势"

    def __init__(self) -> None:
        super().__init__()
        self.state.update(scroll_offset=0)

    def on_enter(self, app: Any) -> None:
        self.state["scroll_offset"] = 0

    def render(self, app: Any) -> list[str]:
        fixed, header, data = self._fixed_lines(app)
        if not header and not data:
            return fixed
        self.state["_fixed_count"] = len(fixed) + len(header)
        self.state["_total_lines"] = len(data)
        scroll_height = max(1, app.content_height - len(fixed) - len(header))
        offset = int(self.state.get("scroll_offset", 0))
        max_offset = max(0, len(data) - scroll_height)
        if offset > max_offset:
            offset = max_offset
            self.state["scroll_offset"] = offset
        return fixed + header + data[offset : offset + scroll_height]

    def _fixed_lines(self, app: Any) -> tuple[list[str], list[str], list[str]]:
        """返回 (顶部固定行, 明细表头行, 明细数据行)：只滚动数据行。"""
        result = app.application.latest_result
        if not result:
            return [colorize("暂无分析结果。", "yellow")], [], []
        latest_day = latest_result_day(result)
        if not latest_day:
            return [colorize("暂无趋势数据。", "yellow")], [], []
        days = int(load_download_config().get("days") or 90)
        start_day = latest_day - timedelta(days=max(0, days - 1))
        rows = filter_trend_rows_by_dates(result, start_day, latest_day)
        fixed: list[str] = []
        fixed.append(colorize(f"趋势分析（近{days}天） {start_day.isoformat()} 至 {latest_day.isoformat()}", "bold"))
        fixed += build_table_lines(
            ["指标", f"近{days}天合计"],
            [
                ["呼入", int(sum(float(row.get("inboundCount") or 0) for row in rows))],
                ["呼出", int(sum(float(row.get("outboundCount") or 0) for row in rows))],
                ["呼损", int(sum(float(row.get("lossCount") or 0) for row in rows))],
                ["IVR呼损", int(sum(float(row.get("ivrLossCount") or 0) for row in rows))],
                ["排队呼损", highlight_queue_loss(int(sum(float(row.get("queueLossCount") or 0) for row in rows)))],
            ],
        )
        fixed.append("")
        daily_rows = build_daily_trend_rows(
            rows,
            "lossCount",
            "lossRate",
            detail_value_keys=("ivrLossCount", "queueLossCount"),
        )
        # 与其他列表一致：最新日期显示在最上面（较前日仍按各自前一天计算）
        daily_rows = list(reversed(daily_rows))
        queue_maximum = max([float(r.get("queueLossCount") or 0) for r in daily_rows] or [1])
        daily_table = build_table_lines(
            ["日期", "呼损", "IVR呼损", "排队呼损", "趋势条", "较前日", "呼损率"],
            [
                [
                    row.get("date", ""),
                    row.get("value", 0),
                    row.get("ivrLossCount", 0),
                    highlight_queue_loss(row.get("queueLossCount", 0)),
                    colorize(render_bar(float(row.get("queueLossCount") or 0), queue_maximum), "red"),
                    row.get("change", "—"),
                    "—" if row.get("rate") is None else f"{float(row.get('rate')):.1f}%",
                ]
                for row in daily_rows
            ],
        )
        # 明细表头 + 分隔线固定，只滚动数据行
        return fixed, daily_table[:2], daily_table[2:]

    def handle_key(self, key: str, app: Any) -> bool:
        fixed, _header, data = self._fixed_lines(app)
        scroll_height = max(1, app.content_height - len(fixed) - 2)
        return _scroll_page(key, app, self.state, len(data), scroll_height)

    def footer(self, app: Any) -> str:
        total = int(self.state.get("_total_lines", 0))
        fixed = int(self.state.get("_fixed_count", 0))
        scroll_height = max(1, app.content_height - fixed)
        if total <= scroll_height:
            return "内容已全部展示  ←→切页 q返回首页"
        offset = int(self.state.get("scroll_offset", 0))
        end = min(total, offset + scroll_height)
        return f"↑↓滚动明细 PgUp/PgDn翻页 Home/End到头尾（显示 {offset + 1}~{end}/{total} 行） ←→切页 q返回首页"


class MonthlyPage(Page):
    """月总览：月份列表 → 当月每日明细，呼入不含呼损、呼损另计。"""

    key = "6"
    title = "月总览"

    def __init__(self) -> None:
        super().__init__()
        self.state.update(level=0, month_index=0, month_offset=0, detail_offset=0, detail_total=0)

    def on_enter(self, app: Any) -> None:
        self.state.update(level=0, month_index=0, month_offset=0, detail_offset=0, detail_total=0)

    def _months(self, app: Any) -> list[dict[str, Any]]:
        """从当前结果的每日趋势行聚合出月份列表；无结果时返回空。"""
        result = app.application.latest_result
        if not result:
            return []
        rows = (((result.get("charts") or {}).get("trendSummary") or {}).get("rows")) or []
        return aggregate_monthly_summary(rows)

    def _month_item(self, months: list[dict[str, Any]]) -> dict[str, Any]:
        index = max(0, min(int(self.state.get("month_index", 0)), len(months) - 1))
        self.state["month_index"] = index
        return months[index]

    # ---- 渲染 ----
    def render(self, app: Any) -> list[str]:
        months = self._months(app)
        if not months:
            return [colorize("暂无分析结果，请先到“下载”页执行下载并分析。", "yellow")]
        if self.state.get("level") == 1:
            return self._render_month(app, self._month_item(months))
        return self._render_months(app, months)

    def _render_months(self, app: Any, months: list[dict[str, Any]]) -> list[str]:
        content_height = app.content_height
        selected = int(self.state.get("month_index", 0))
        offset = int(self.state.get("month_offset", 0))
        if selected >= len(months):
            selected = len(months) - 1
            self.state["month_index"] = selected
        max_offset = max(0, len(months) - content_height + 2)
        if offset > max_offset:
            offset = max_offset
            self.state["month_offset"] = offset
        visible = months[offset : offset + content_height - 2]
        table = build_table_lines(
            ["月份", "呼入", "呼出", "合计", "呼损(另计)"],
            [
                [item["month"], item["inboundCount"], item["outboundCount"], item["totalCount"], item["lossCount"]]
                for item in visible
            ],
        )
        if visible:
            table = apply_highlight(table, selected - offset, app.columns)
        table.append(
            colorize(
                f"共 {len(months)} 个月，呼入=呼入明细条数（不含呼损）  ↑↓选择月份 回车查看当月明细  PgUp/PgDn翻页",
                "gray",
            )
        )
        return table

    def _render_month(self, app: Any, item: dict[str, Any]) -> list[str]:
        lines: list[str] = []
        lines.append(colorize(f"{item['month']} 月总览：呼入 + 呼出 = 合计（呼损另计，不属于呼入）", "bold"))
        lines.append("")
        lines += build_table_lines(
            ["指标", "数量"],
            [
                ["呼入总数", item["inboundCount"]],
                ["呼出总数", item["outboundCount"]],
                ["合计（呼入+呼出）", colorize(str(item["totalCount"]), "brightGreen")],
                ["呼损（另计）", highlight_queue_loss(int(item["lossCount"])) if item["lossCount"] else "0"],
            ],
        )
        lines.append("")
        lines.append(colorize("当月每日明细：", "brightCyan"))
        daily = list(reversed(item["days"]))
        lines += build_table_lines(
            ["日期", "呼入", "呼出", "呼损(另计)"],
            [[row.get("date", ""), row.get("inboundCount", 0), row.get("outboundCount", 0), row.get("lossCount", 0)] for row in daily],
        )
        lines.append("")
        lines.append(colorize("↑↓滚动 Esc返回月份列表", "muted"))
        self.state["detail_total"] = len(lines)
        offset = int(self.state.get("detail_offset", 0))
        max_offset = max(0, len(lines) - app.content_height)
        if offset > max_offset:
            offset = max_offset
            self.state["detail_offset"] = offset
        return lines[offset : offset + app.content_height]

    # ---- 按键 ----
    def _month_max_offset(self, app: Any, months: list[dict[str, Any]]) -> int:
        return max(0, len(months) - (app.content_height - 2))

    def handle_key(self, key: str, app: Any) -> bool:
        months = self._months(app)
        if not months:
            return False
        if self.state.get("level") == 1:
            return self._handle_month_key(key, app, self._month_item(months))
        return self._handle_months_key(key, app, months)

    def _handle_months_key(self, key: str, app: Any, months: list[dict[str, Any]]) -> bool:
        selected = int(self.state.get("month_index", 0))
        offset = int(self.state.get("month_offset", 0))
        max_offset = self._month_max_offset(app, months)
        visible_rows = max(1, app.content_height - 2)
        if key == "up":
            if selected > 0:
                selected -= 1
                if selected < offset:
                    offset = selected
            else:
                selected = len(months) - 1
                offset = max_offset
                app.feedback("↻ 已跳到底部")
        elif key == "down":
            if selected < len(months) - 1:
                selected += 1
                if selected >= offset + visible_rows:
                    offset = selected - visible_rows + 1
            else:
                selected = 0
                offset = 0
                app.feedback("↻ 已跳回顶部")
        elif key == "pgup":
            selected = max(0, selected - visible_rows)
            offset = max(0, offset - visible_rows)
        elif key == "pgdn":
            selected = min(len(months) - 1, selected + visible_rows)
            offset = min(max_offset, offset + visible_rows)
        elif key == "home":
            selected = 0
            offset = 0
        elif key == "end":
            selected = len(months) - 1
            offset = max_offset
        elif key == "enter":
            self.state["level"] = 1
            self.state["detail_offset"] = 0
            return True
        else:
            return False
        self.state["month_index"] = selected
        self.state["month_offset"] = offset
        return True

    def _handle_month_key(self, key: str, app: Any, item: dict[str, Any]) -> bool:
        if key in ("esc", "backspace", "enter"):
            self.state["level"] = 0
            self.state["detail_offset"] = 0
            return True
        if key == "up":
            offset = int(self.state.get("detail_offset", 0))
            if offset > 0:
                self.state["detail_offset"] = offset - 1
            else:
                self.state["detail_offset"] = max(0, int(self.state.get("detail_total", 0)) - app.content_height)
                app.feedback("↻ 已跳到底部")
            return True
        if key == "down":
            offset = int(self.state.get("detail_offset", 0))
            max_offset = max(0, int(self.state.get("detail_total", 0)) - app.content_height)
            if offset < max_offset:
                self.state["detail_offset"] = offset + 1
            else:
                self.state["detail_offset"] = 0
                app.feedback("↻ 已跳回顶部")
            return True
        return False

    def footer(self, app: Any) -> str:
        if self.state.get("level") == 1:
            return "↑↓滚动当月明细 Esc返回月份列表 ←→/数字键切页 q返回首页"
        months = self._months(app)
        total = len(months)
        scroll_height = max(1, app.content_height - 2)
        if total <= scroll_height:
            return "内容已全部展示  ↑↓选择 回车查看月份  ←→/数字键切页 q返回首页"
        offset = int(self.state.get("month_offset", 0))
        end = min(total, offset + scroll_height)
        return f"↑↓选择 PgUp/PgDn翻页 Home/End到头尾（显示 {offset + 1}~{end}/{total} 个） ←→切页 q返回首页"
