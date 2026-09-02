"""TUI 原始报表页：呼入、呼出、呼损。

四级结构：
  第0层 日期汇总：每天多少条（日期 | 数量）
  第1层 号码汇总：同一天内同一号码只显示一行（号码 | 次数 | 最后一次时间 + 关键信息）
  第2层 号码明细：该号码当天的全部记录（精选列）
  第3层 单行全字段：回车看该行在原始 Excel 里的全部字段、完整值

呼入/呼出表有"座席分机/座席姓名"，列表和详情都追加"映射姓名"：
按座席映射表把分机换算成姓名，方便核对。
"""
from __future__ import annotations

from typing import Any

from ..cli_display import build_table_lines, colorize, highlight_number, pad_text, reverse_colorize
from ..normalizers import normalize_agent_extension
from ..state_store import load_agent_mapping, load_complaint_config, map_agent_name
from ..tui_app import Page
from .loss_inbound_match import enrich_loss_rows

# 每张表用于按天分组的日期列
DATE_COLUMN = {"inbound": "呼入时间", "outbound": "呼出时间", "loss": "来电时间"}


class RawTablePage(Page):
    """原始表页面基类：日期汇总 → 号码汇总 → 号码明细 → 单行全字段。"""

    key = ""
    title = ""
    raw_key = ""  # loss / inbound / outbound
    # 第2层明细展示的精简列：[(原表列名, 显示标题), ...]
    list_columns: tuple[tuple[str, str], ...] = ()
    # 第3层展示的原始表全部列（保持下载表的列名）
    all_columns: tuple[str, ...] = ()
    has_mapped_seat = False  # 是否追加"映射姓名"列
    # 第1层按号码分组：group_column 原表列名 / group_label 显示标题 / records_label 记录称呼
    group_column = ""
    group_label = ""
    records_label = ""  # 来电 / 呼损 / 呼出
    # 按 f 循环的筛选模式：(id, 显示名, 行过滤函数)；空元组表示该页不支持筛选
    filter_modes: tuple[tuple[str, str, Any], ...] = ()

    def __init__(self) -> None:
        super().__init__()
        self.state.update(
            level=0,  # 0 日期汇总 / 1 号码汇总 / 2 号码明细 / 3 单行全字段
            day_index=0,
            day_offset=0,
            number_index=0,
            number_offset=0,
            selected_index=0,
            scroll_offset=0,
            detail=None,
            detail_scroll=0,
            filter_index=0,
            load_error="",
            rows_cache=None,
        )
        self._complaint_receivers: set[str] = set()

    def _confirmed(self, app: Any) -> bool:
        """三张原表共用一个确认标记：任一页按过回车后，其余页直接显示。"""
        return bool(getattr(app.application, "_raw_tables_confirmed", False))

    # ---- 数据 ----
    def _result_key(self, app: Any) -> str:
        """当前分析结果的版本号：用于在重新下载分析后自动作废旧缓存。"""
        result = app.application.latest_result or {}
        cache = result.get("latestDownloadCache") or {}
        return str(cache.get("savedAt") or result.get("updatedAt") or "")

    def _read_rows(self, app: Any) -> list[dict[str, Any]] | None:
        """同步读取当前结果的原始表行；失败时把错误信息放进 state 并返回 None。"""
        try:
            rows = app.application.load_raw_table(self.raw_key)
        except Exception as error:
            self.state["load_error"] = f"读取原始表失败：{error}"
            return None
        if rows is None:
            self.state["load_error"] = "原始表文件不存在或读取失败，请重新下载。"
            return None
        return rows

    def _load_rows(self, app: Any) -> list[dict[str, Any]] | None:
        """从分析结果取原始行；同一结果只在本页面保存一个引用。"""
        result_key = self._result_key(app)
        if result_key != self.state.get("rows_key"):
            self.state["load_error"] = ""
            self.state["rows_cache"] = self._read_rows(app)
            self.state["rows_key"] = result_key
        cache = self.state.get("rows_cache")
        return cache if isinstance(cache, list) else None

    def _time_column(self) -> str:
        return DATE_COLUMN.get(self.raw_key, "")

    def _time_text(self, row: dict[str, Any]) -> str:
        return str(row.get(self._time_column()) or "").strip()

    def _date_of(self, row: dict[str, Any]) -> str:
        value = self._time_text(row)
        return value[:10] if value else "未知日期"

    def _daily_rows(self, rows: list[dict[str, Any]]) -> list[tuple[str, int]]:
        counts: dict[str, int] = {}
        for row in rows:
            day = self._date_of(row)
            counts[day] = counts.get(day, 0) + 1
        return sorted(counts.items(), key=lambda item: item[0], reverse=True)

    # ---- 筛选（按 f 循环） ----
    def _current_filter(self) -> tuple[str, str, Any] | None:
        if not self.filter_modes:
            return None
        index = int(self.state.get("filter_index", 0)) % len(self.filter_modes)
        return self.filter_modes[index]

    def _filtered_rows(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        mode = self._current_filter()
        if mode is None or mode[0] == "all":
            return rows
        return [row for row in rows if mode[2](row)]

    def _prepare_rows(self, app: Any, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """页面专属的展示数据准备；普通原表保持原样。"""
        return rows

    def _cycle_filter(self) -> bool:
        """按 f 切换到下一个筛选模式，并回到日期汇总层。"""
        if not self.filter_modes:
            return False
        self.state["filter_index"] = (int(self.state.get("filter_index", 0)) + 1) % len(self.filter_modes)
        self.state["level"] = 0
        self.state["day_index"] = 0
        self.state["day_offset"] = 0
        return True

    def _number_groups(self, rows: list[dict[str, Any]], day: str) -> list[tuple[str, list[dict[str, Any]]]]:
        """返回某天的号码分组：[(号码, 该号码记录列表), ...]，按最后一次时间倒序。"""
        groups: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            if self._date_of(row) != day:
                continue
            number = str(row.get(self.group_column) or "").strip() or "未知号码"
            groups.setdefault(number, []).append(row)
        result: list[tuple[str, list[dict[str, Any]]]] = []
        for number, records in groups.items():
            records.sort(key=lambda record: self._time_text(record), reverse=True)
            result.append((number, records))
        result.sort(key=lambda item: self._time_text(item[1][0]), reverse=True)
        return result

    def _mapped_seat(self, row: dict[str, Any]) -> str:
        extension = normalize_agent_extension(row.get("座席分机"))
        raw_name = str(row.get("座席姓名") or "").strip()
        return map_agent_name(extension, raw_name, load_agent_mapping())

    def _refresh_complaint_receivers(self) -> None:
        """读取投诉座席分机配置，用于把"被叫座席=投诉电话"的座席标红。"""
        try:
            config = load_complaint_config()
            receivers = config.get("receiverPhones") or [config.get("receiverPhone", "")]
            self._complaint_receivers = {normalize_agent_extension(str(item)) for item in receivers if str(item).strip()}
        except Exception:
            self._complaint_receivers = set()

    def _cell_value(self, key: str, row: dict[str, Any]) -> object:
        """格式化单元格：投诉座席分机标红；丢失位置为排队阶段时标红。"""
        value = row.get(key, "")
        if key == "座席分机" and normalize_agent_extension(str(value or "")) in self._complaint_receivers:
            return colorize(str(value), "red")
        if key == "丢失位置" and "排队" in str(value or ""):
            return colorize(str(value), "red")
        return value

    def _list_headers(self) -> list[str]:
        headers = [label for _key, label in self.list_columns]
        if self.has_mapped_seat:
            headers.append("映射姓名")
        return headers

    def _row_cells(self, row: dict[str, Any]) -> list[object]:
        cells = [self._cell_value(key, row) for key, _label in self.list_columns]
        if self.has_mapped_seat:
            cells.append(self._mapped_seat(row))
        return cells

    def _group_headers(self) -> list[str]:
        """第1层号码汇总的表头：号码 | 次数 | 最后时间 | 关键列（不含时间列和号码列）。"""
        headers = [self.group_label, f"{self.records_label}次数", f"最后{self.records_label}时间"]
        time_column = self._time_column()
        for key, label in self.list_columns:
            if key != time_column and key != self.group_column:
                headers.append(label)
        if self.has_mapped_seat:
            headers.append("映射姓名")
        return headers

    def _group_cells(self, records: list[dict[str, Any]]) -> list[object]:
        """第1层号码汇总的一行：号码 | 次数 | 最后时间 | 最后一次记录的其余列。"""
        last = records[0]
        time_column = self._time_column()
        cells: list[object] = [
            str(last.get(self.group_column) or "").strip() or "未知号码",
            highlight_number(len(records), 2),  # 次数大于 1（重复号码）标红
            self._time_text(last),
        ]
        for key, _label in self.list_columns:
            if key != time_column and key != self.group_column:
                cells.append(self._group_cell_value(key, records, last))
        if self.has_mapped_seat:
            cells.append(self._mapped_seat(last))
        return cells

    def _group_cell_value(self, key: str, records: list[dict[str, Any]], last: dict[str, Any]) -> object:
        """号码汇总单元格：丢失位置按整组是否含排队呼损判断，其余列取最后一条。"""
        if key == "丢失位置" and any("排队" in str(row.get(key) or "") for row in records):
            return colorize(str(last.get(key) or "").strip() or "未知", "red")
        return self._cell_value(key, last)

    # ---- 渲染 ----
    def on_enter(self, app: Any) -> None:
        self.state["level"] = 0
        self.state["day_index"] = 0
        self.state["day_offset"] = 0
        self.state["number_index"] = 0
        self.state["number_offset"] = 0
        self.state["selected_index"] = 0
        self.state["scroll_offset"] = 0
        self.state["detail"] = None

    def render(self, app: Any) -> list[str]:
        if self.state.get("level") == 3:
            return self._render_detail(app)
        if not self._confirmed(app):
            # 原始行已经随分析结果载入内存，确认后直接展示。
            return [
                colorize(f"{self.title}原始表", "bold"),
                "",
                colorize("原始表已随分析结果载入，按回车即可查看。", "yellow"),
                "",
                colorize("▶ 按回车开始查看", "brightCyan"),
                colorize("←→切换菜单  q返回首页", "muted"),
            ]
        rows = self._load_rows(app)
        if self.state.get("load_error"):
            return [colorize(self.state["load_error"], "yellow")]
        if rows is None:
            return [colorize("原始表数据不可用，请重新下载并分析。", "yellow")]
        if not rows:
            return [colorize("原始表没有数据。", "yellow")]
        rows = self._prepare_rows(app, rows)
        rows = self._filtered_rows(rows)
        if not rows:
            mode = self._current_filter()
            label = mode[1] if mode else ""
            return [colorize(f"当前筛选（{label}）下没有数据，按 f 切换筛选。", "yellow")]
        if self.state.get("level") == 0:
            return self._render_days(app, rows)
        if self.state.get("level") == 1:
            return self._render_numbers(app, rows)
        return self._render_number_records(app, rows)

    def _render_days(self, app: Any, rows: list[dict[str, Any]]) -> list[str]:
        daily = self._daily_rows(rows)
        content_height = app.content_height
        selected = int(self.state.get("day_index", 0))
        offset = int(self.state.get("day_offset", 0))
        if selected >= len(daily):
            selected = len(daily) - 1
            self.state["day_index"] = selected
        max_offset = max(0, len(daily) - content_height + 2)
        if offset > max_offset:
            offset = max_offset
            self.state["day_offset"] = offset
        visible = daily[offset : offset + content_height - 2]
        table = build_table_lines(
            ["日期", "数量"],
            [[day, count] for day, count in visible],
        )
        if visible:
            table = apply_highlight(table, selected - offset, app.columns)
        total = sum(count for _day, count in daily)
        filter_text = ""
        mode = self._current_filter()
        if mode is not None and mode[0] != "all":
            filter_text = f"（过滤:{mode[1]}）"
        table.append(
            colorize(
                f"{self.title}共 {total} 条｜{len(daily)} 天{filter_text}，↑↓选择日期 回车查看当天号码  PgUp/PgDn翻页  f筛选",
                "gray",
            )
        )
        return table

    def _render_numbers(self, app: Any, rows: list[dict[str, Any]]) -> list[str]:
        if self.has_mapped_seat:
            self._refresh_complaint_receivers()
        daily = self._daily_rows(rows)
        day = daily[int(self.state.get("day_index", 0))][0]
        groups = self._number_groups(rows, day)
        content_height = app.content_height
        selected = int(self.state.get("number_index", 0))
        offset = int(self.state.get("number_offset", 0))
        if selected >= len(groups):
            selected = len(groups) - 1
            self.state["number_index"] = selected
        max_offset = max(0, len(groups) - content_height + 2)
        if offset > max_offset:
            offset = max_offset
            self.state["number_offset"] = offset
        visible = groups[offset : offset + content_height - 2]
        table = build_table_lines(
            self._group_headers(),
            [self._group_cells(records) for _number, records in visible],
        )
        if visible:
            table = apply_highlight(table, selected - offset, app.columns)
        total_records = sum(len(records) for _number, records in groups)
        table.append(
            colorize(
                f"{day} 共 {len(groups)} 个号码｜{total_records} 条，↑↓选择号码 回车查看该号码全部{self.records_label}  PgUp/PgDn翻页",
                "gray",
            )
        )
        return table

    def _render_number_records(self, app: Any, rows: list[dict[str, Any]]) -> list[str]:
        if self.has_mapped_seat:
            self._refresh_complaint_receivers()
        daily = self._daily_rows(rows)
        day = daily[int(self.state.get("day_index", 0))][0]
        groups = self._number_groups(rows, day)
        _number, records = groups[int(self.state.get("number_index", 0))]
        content_height = app.content_height
        selected = int(self.state.get("selected_index", 0))
        offset = int(self.state.get("scroll_offset", 0))
        if selected >= len(records):
            selected = len(records) - 1
            self.state["selected_index"] = selected
        max_offset = max(0, len(records) - content_height + 2)
        if offset > max_offset:
            offset = max_offset
            self.state["scroll_offset"] = offset
        visible = records[offset : offset + content_height - 2]
        table = build_table_lines(
            self._list_headers(),
            [self._row_cells(row) for row in visible],
        )
        if visible:
            table = apply_highlight(table, selected - offset, app.columns)
        table.append(
            colorize(
                f"{day} {_number} 共 {len(records)} 条，↑↓选择 回车查看全字段  Esc返回号码  PgUp/PgDn翻页",
                "gray",
            )
        )
        return table

    def _render_detail(self, app: Any) -> list[str]:
        row = self.state["detail"]
        lines: list[str] = []
        lines.append(colorize(f"{self.title}明细（原始表全部字段）", "brightCyan"))
        lines.append("")
        for column in self.all_columns:
            lines.append(f"{column}：{row.get(column, '')}")
        if self.has_mapped_seat:
            lines.append(f"映射姓名：{self._mapped_seat(row)}")
        lines.append("")
        lines.append(colorize("↑↓滚动 Esc返回列表", "muted"))
        offset = int(self.state.get("detail_scroll", 0))
        max_offset = max(0, len(lines) - app.content_height)
        if offset > max_offset:
            offset = max_offset
            self.state["detail_scroll"] = offset
        return lines[offset : offset + app.content_height]

    # ---- 按键 ----
    def _detail_max_offset(self, app: Any) -> int:
        """明细全字段视图最多可滚动的行数（与 _render_detail 生成的 lines 数量一致）。"""
        total = len(self.all_columns) + 4 + (1 if self.has_mapped_seat else 0)
        return max(0, total - app.content_height)

    def _wrap_list(self, key: str, selected: int, total: int, offset: int, visible_rows: int) -> tuple[int, int, bool]:
        """环绕导航：顶部按↑跳末尾、末尾按↓回顶部。返回 (selected, offset, 是否发生环绕)。

        调用方需保证 total >= 1（空列表由各层 handler 提前拦截）。
        """
        if key == "up":
            if selected > 0:
                selected -= 1
                if selected < offset:
                    offset = selected
                return selected, offset, False
            return total - 1, max(0, total - visible_rows), True
        if selected < total - 1:
            selected += 1
            if selected >= offset + visible_rows:
                offset = selected - visible_rows + 1
            return selected, offset, False
        return 0, 0, True

    def handle_key(self, key: str, app: Any) -> bool:
        if self.state.get("level") == 3:
            if key == "up":
                if int(self.state.get("detail_scroll", 0)) > 0:
                    self.state["detail_scroll"] = int(self.state.get("detail_scroll", 0)) - 1
                else:
                    self.state["detail_scroll"] = self._detail_max_offset(app)
                    app.feedback("↻ 已跳到底部")
                return True
            if key == "down":
                if int(self.state.get("detail_scroll", 0)) < self._detail_max_offset(app):
                    self.state["detail_scroll"] = int(self.state.get("detail_scroll", 0)) + 1
                else:
                    self.state["detail_scroll"] = 0
                    app.feedback("↻ 已跳回顶部")
                return True
            if key in ("esc", "enter", "backspace"):
                self.state["detail"] = None
                self.state["level"] = 2
                return True
            return False

        if key == "enter" and not self._confirmed(app):
            # 首次进入：按回车确认，其余原表页也会直接显示
            app.application._raw_tables_confirmed = True
            self.state["load_error"] = ""
            return True

        if not self._confirmed(app):
            # 确认前不读取文件：其他按键（方向键等）不得触发加载
            return False

        if key == "f":
            return self._cycle_filter()

        rows = self._load_rows(app)
        if rows is None:
            return False
        if not rows:
            return False
        rows = self._prepare_rows(app, rows)
        rows = self._filtered_rows(rows)
        if not rows:
            return False
        if self.state.get("level") == 0:
            return self._handle_days_key(key, app, rows)
        if self.state.get("level") == 1:
            return self._handle_numbers_key(key, app, rows)
        return self._handle_records_key(key, app, rows)

    def _handle_days_key(self, key: str, app: Any, rows: list[dict[str, Any]]) -> bool:
        daily = self._daily_rows(rows)
        if not daily:
            return False
        selected = int(self.state.get("day_index", 0))
        offset = int(self.state.get("day_offset", 0))
        content_height = app.content_height
        if key == "up":
            selected, offset, wrapped = self._wrap_list("up", selected, len(daily), offset, content_height - 2)
            self.state["day_index"] = selected
            self.state["day_offset"] = offset
            if wrapped:
                app.feedback("↻ 已跳到底部")
            return True
        if key == "down":
            selected, offset, wrapped = self._wrap_list("down", selected, len(daily), offset, content_height - 2)
            self.state["day_index"] = selected
            self.state["day_offset"] = offset
            if wrapped:
                app.feedback("↻ 已跳回顶部")
            return True
        if key == "pgup":
            selected = max(0, selected - (content_height - 2))
            offset = max(0, offset - (content_height - 2))
            self.state["day_index"] = selected
            self.state["day_offset"] = offset
            return True
        if key == "pgdn":
            selected = min(len(daily) - 1, selected + (content_height - 2))
            offset = min(max(0, len(daily) - (content_height - 2)), offset + (content_height - 2))
            self.state["day_index"] = selected
            self.state["day_offset"] = offset
            return True
        if key == "home":
            self.state["day_index"] = 0
            self.state["day_offset"] = 0
            return True
        if key == "end":
            self.state["day_index"] = len(daily) - 1
            self.state["day_offset"] = max(0, len(daily) - (content_height - 2))
            return True
        if key == "enter":
            self.state["level"] = 1
            self.state["number_index"] = 0
            self.state["number_offset"] = 0
            return True
        return False

    def _handle_numbers_key(self, key: str, app: Any, rows: list[dict[str, Any]]) -> bool:
        daily = self._daily_rows(rows)
        day = daily[int(self.state.get("day_index", 0))][0]
        groups = self._number_groups(rows, day)
        if not groups:
            return False
        selected = int(self.state.get("number_index", 0))
        offset = int(self.state.get("number_offset", 0))
        content_height = app.content_height
        if key == "up":
            selected, offset, wrapped = self._wrap_list("up", selected, len(groups), offset, content_height - 2)
            self.state["number_index"] = selected
            self.state["number_offset"] = offset
            if wrapped:
                app.feedback("↻ 已跳到底部")
            return True
        if key == "down":
            selected, offset, wrapped = self._wrap_list("down", selected, len(groups), offset, content_height - 2)
            self.state["number_index"] = selected
            self.state["number_offset"] = offset
            if wrapped:
                app.feedback("↻ 已跳回顶部")
            return True
        if key == "pgup":
            selected = max(0, selected - (content_height - 2))
            offset = max(0, offset - (content_height - 2))
            self.state["number_index"] = selected
            self.state["number_offset"] = offset
            return True
        if key == "pgdn":
            selected = min(len(groups) - 1, selected + (content_height - 2))
            offset = min(max(0, len(groups) - (content_height - 2)), offset + (content_height - 2))
            self.state["number_index"] = selected
            self.state["number_offset"] = offset
            return True
        if key == "home":
            self.state["number_index"] = 0
            self.state["number_offset"] = 0
            return True
        if key == "end":
            self.state["number_index"] = len(groups) - 1
            self.state["number_offset"] = max(0, len(groups) - (content_height - 2))
            return True
        if key == "enter":
            self.state["level"] = 2
            self.state["selected_index"] = 0
            self.state["scroll_offset"] = 0
            return True
        if key in ("esc", "backspace"):
            self.state["level"] = 0
            return True
        return False

    def _handle_records_key(self, key: str, app: Any, rows: list[dict[str, Any]]) -> bool:
        daily = self._daily_rows(rows)
        day = daily[int(self.state.get("day_index", 0))][0]
        groups = self._number_groups(rows, day)
        _number, records = groups[int(self.state.get("number_index", 0))]
        if not records:
            return False
        selected = int(self.state.get("selected_index", 0))
        offset = int(self.state.get("scroll_offset", 0))
        content_height = app.content_height
        if key == "up":
            selected, offset, wrapped = self._wrap_list("up", selected, len(records), offset, content_height - 2)
            self.state["selected_index"] = selected
            self.state["scroll_offset"] = offset
            if wrapped:
                app.feedback("↻ 已跳到底部")
            return True
        if key == "down":
            selected, offset, wrapped = self._wrap_list("down", selected, len(records), offset, content_height - 2)
            self.state["selected_index"] = selected
            self.state["scroll_offset"] = offset
            if wrapped:
                app.feedback("↻ 已跳回顶部")
            return True
        if key == "pgup":
            selected = max(0, selected - (content_height - 2))
            offset = max(0, offset - (content_height - 2))
            self.state["selected_index"] = selected
            self.state["scroll_offset"] = offset
            return True
        if key == "pgdn":
            selected = min(len(records) - 1, selected + (content_height - 2))
            offset = min(max(0, len(records) - (content_height - 2)), offset + (content_height - 2))
            self.state["selected_index"] = selected
            self.state["scroll_offset"] = offset
            return True
        if key == "home":
            self.state["selected_index"] = 0
            self.state["scroll_offset"] = 0
            return True
        if key == "end":
            self.state["selected_index"] = len(records) - 1
            self.state["scroll_offset"] = max(0, len(records) - (content_height - 2))
            return True
        if key == "enter":
            self.state["detail"] = records[selected]
            self.state["detail_scroll"] = 0
            self.state["level"] = 3
            return True
        if key in ("esc", "backspace"):
            self.state["level"] = 1
            return True
        return False

    def footer(self, app: Any) -> str:
        if self.state.get("level") == 3:
            return "↑↓滚动 Esc返回列表"
        if not self._confirmed(app):
            return "回车查看  ←→切页 q返回首页"
        mode = self._current_filter()
        filter_part = f"f筛选[{mode[1]}] " if mode is not None and len(self.filter_modes) > 1 else ""
        if self.state.get("level") == 0:
            return f"{filter_part}↑↓选择日期 回车查看当天号码 PgUp/PgDn翻页 ←→切页 q返回首页"
        if self.state.get("level") == 1:
            return f"{filter_part}↑↓选择号码 回车查看该号码全部{self.records_label} Esc返回日期 PgUp/PgDn翻页 ←→切页 q返回首页"
        return f"{filter_part}↑↓选择 回车查看全字段 Esc返回号码 PgUp/PgDn翻页 ←→切页 q返回首页"


class InboundPage(RawTablePage):
    key = "1"
    title = "呼入"
    raw_key = "inbound"
    has_mapped_seat = True
    group_column = "主叫号码"
    group_label = "主叫号码"
    records_label = "来电"
    list_columns = (
        ("呼入时间", "呼入时间"),
        ("主叫号码", "主叫号码"),
        ("DID号码", "DID号码"),
        ("座席分机", "座席分机"),
        ("座席姓名", "座席姓名"),
        ("通话时长", "通话时长"),
        ("归属地", "归属地"),
    )
    all_columns = (
        "呼入时间",
        "挂断时间",
        "主叫号码",
        "DID号码",
        "组",
        "座席分机",
        "座席姓名",
        "呼入时长",
        "IVR时长",
        "排队时长",
        "通话时长",
        "归属地",
        "满意度调查",
    )


class OutboundPage(RawTablePage):
    key = "2"
    title = "呼出"
    raw_key = "outbound"
    has_mapped_seat = True
    group_column = "被叫号码"
    group_label = "被叫号码"
    records_label = "呼出"
    list_columns = (
        ("呼出时间", "呼出时间"),
        ("主叫叫号码", "主叫号码"),
        ("被叫号码", "被叫号码"),
        ("座席分机", "座席分机"),
        ("座席姓名", "座席姓名"),
        ("通话时长", "通话时长"),
        ("归属地", "归属地"),
    )
    all_columns = (
        "呼出时间",
        "挂断时间",
        "主叫叫号码",
        "被叫号码",
        "组",
        "座席分机",
        "座席姓名",
        "振铃时长",
        "通话时长",
        "归属地",
    )


class LossPage(RawTablePage):
    key = "3"
    title = "呼损"
    raw_key = "loss"
    has_mapped_seat = False
    group_column = "来电号码"
    group_label = "来电号码"
    records_label = "呼损"
    filter_modes = (
        ("all", "全部", lambda row: True),
        ("queue", "排队阶段", lambda row: "排队" in str(row.get("丢失位置") or "")),
        ("ivr", "IVR阶段", lambda row: "IVR" in str(row.get("丢失位置") or "")),
    )
    list_columns = (
        ("来电时间", "来电时间"),
        ("来电号码", "来电号码"),
        ("丢失位置", "丢失位置"),
        ("队列号", "队列号"),
        ("排队停留", "排队停留"),
        ("归属地", "归属地"),
        ("处理状态", "处理状态"),
        ("__inbound_success", "是否呼入成功"),
        ("__inbound_success_time", "呼入成功时间"),
    )
    all_columns = (
        "来电时间",
        "IVR停留",
        "排队停留",
        "队列号",
        "丢失位置",
        "归属地",
        "DID号码",
        "来电号码",
        "处理时间",
        "处理人",
        "处理状态",
        "__inbound_success",
        "__inbound_success_time",
    )

    def _prepare_rows(self, app: Any, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """呼损页独有：用同一结果中的呼入行补充后续接通状态。"""
        return enrich_loss_rows(
            app.application.load_raw_table("inbound"),
            rows,
            self._time_column(),
            self.group_column,
            self.state,
            self._result_key(app),
        )


def apply_highlight(table: list[str], selected_visible_index: int, width: int | None = None) -> list[str]:
    """把表格中的某一行套上反色，用于列表选择高亮。

    原表数据列表一律只做整行反色，不加 ▸ 光标；▸ 仅用于配置页菜单。
    """
    if selected_visible_index < 0:
        return table
    line_index = 2 + selected_visible_index
    if 0 <= line_index < len(table):
        line = table[line_index]
        if width:
            line = pad_text(line, width)
        table[line_index] = reverse_colorize(line)
    return table
