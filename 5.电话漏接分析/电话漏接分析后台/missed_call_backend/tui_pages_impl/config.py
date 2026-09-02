"""TUI 配置页。"""
from __future__ import annotations

from pathlib import Path
import re
from typing import Any

from ..cli_display import build_table_lines, colorize
from ..state_store import (
    load_agent_mapping,
    load_complaint_config,
    load_download_config,
    save_agent_mapping,
    save_complaint_config,
    save_download_config,
)
from ..tui_app import Page


class ConfigPage(Page):
    key = "8"
    title = "配置"

    def __init__(self) -> None:
        super().__init__()
        self.state.update(
            section=None,
            selection=0,
            editing=None,
            edit_buffer="",
            message="",
            mapping=None,
            mapping_selection=0,
        )

    def _tui_input(self, label: str) -> str:
        """在 TUI 里用系统行输入获取文本：支持中文输入法，避免逐键截断卡死。

        input() 走系统标准输入路径，IME 组词正常；输入期间暂停重绘，
        结束后由主循环整帧重绘清掉回显。
        """
        import sys as _sys

        _sys.stdout.write("\x1b[0m\r\n\x1b[?25h")
        _sys.stdout.flush()
        try:
            return input(label)
        finally:
            _sys.stdout.write("\x1b[?25l")
            _sys.stdout.flush()

    def on_enter(self, app: Any) -> None:
        self.state["section"] = None
        self.state["editing"] = None
        self.state["message"] = ""

    def render(self, app: Any) -> list[str]:
        section = self.state.get("section")
        if section == "rules":
            return self._render_rules()
        if section == "log":
            return self._render_log(app)
        if section == "mapping":
            return self._render_mapping(app)
        if section == "download":
            return self._render_download(app)
        if section == "complaint":
            return self._render_complaint(app)
        return self._render_main(app)

    def _render_main(self, app: Any) -> list[str]:
        config = load_download_config()
        lines: list[str] = []
        lines += build_table_lines(
            ["配置", "当前值"],
            [
                ["系统地址", config.get("baseUrl", "")],
                ["下载天数", config.get("days", 30)],
                ["账号", config.get("account", "")],
                ["密码", "已保存" if config.get("password") else "未配置"],
            ],
        )
        lines.append("")
        actions = [
            ("1", "下载配置"),
            ("2", "座席号映射"),
            ("3", "投诉座席分机"),
            ("4", "判断口径"),
            ("5", "打开并登录原系统"),
            ("6", "查看最近日志"),
        ]
        for index, (key, label) in enumerate(actions):
            selected = index == int(self.state.get("selection", 0))
            prefix = colorize("▸ ", "brightYellow") if selected else "  "
            lines.append(f"{prefix}{colorize(key, 'cyan')}  {label}")
        if self.state.get("message"):
            lines.append("")
            lines.append(colorize(self.state["message"], "yellow"))
        return lines

    def _render_download(self, app: Any) -> list[str]:
        config = load_download_config()
        fields = [
            ("baseUrl", "系统地址", str(config.get("baseUrl", ""))),
            ("days", "下载天数", str(config.get("days", 30))),
            ("account", "账号", str(config.get("account", ""))),
            ("password", "密码", "已保存" if config.get("password") else "未配置"),
        ]
        lines: list[str] = []
        lines.append(colorize("下载配置（↑↓选择 回车编辑 s保存 Esc返回）", "brightBlue"))
        for index, (key, label, value) in enumerate(fields):
            selected = index == int(self.state.get("selection", 0))
            prefix = colorize("▸ ", "brightYellow") if selected else "  "
            if self.state.get("editing") == key:
                value = f"{self.state.get('edit_buffer', '')}_"
            lines.append(f"{prefix}{label:<12} {value}")
        if self.state.get("editing"):
            lines.append(colorize("输入内容，回车确认，Esc取消", "muted"))
        if self.state.get("message"):
            lines.append(colorize(self.state["message"], "yellow"))
        return lines

    def _render_mapping(self, app: Any) -> list[str]:
        mapping = self.state.get("mapping")
        if mapping is None:
            mapping = load_agent_mapping()
            self.state["mapping"] = mapping
        items = sorted(mapping.items())
        lines: list[str] = []
        lines.append(colorize("座席号映射（↑↓选择 a新增 e编辑 d删除 Esc返回，操作后自动保存）", "brightBlue"))
        if not items:
            lines.append(colorize("当前没有映射。", "muted"))
        for index, (extension, name) in enumerate(items):
            selected = index == int(self.state.get("mapping_selection", 0))
            prefix = colorize("▸ ", "brightYellow") if selected else "  "
            lines.append(f"{prefix}{extension} = {name}")
        lines.append("")
        lines.append(colorize("同一人多个手机号：按 a 后先输入多个分机（逗号分隔），再输入同一个姓名即可。", "muted"))
        if self.state.get("message"):
            lines.append(colorize(self.state["message"], "yellow"))
        return lines

    def _render_complaint(self, app: Any) -> list[str]:
        current = load_complaint_config()
        current_text = "、".join(current.get("receiverPhones") or [])
        lines: list[str] = []
        lines.append(colorize("投诉座席分机（逗号分隔，回车保存 Esc返回）", "brightBlue"))
        if self.state.get("editing") == "complaint":
            lines.append(colorize(f"输入：{self.state.get('edit_buffer', '')}_", "brightCyan"))
        else:
            lines.append(colorize(f"当前：{current_text or '未配置'}", "muted"))
            lines.append(colorize("按回车开始编辑", "gray"))
        if self.state.get("message"):
            lines.append(colorize(self.state["message"], "yellow"))
        return lines

    def _render_rules(self) -> list[str]:
        result = self.state.get("_result") or {}
        complaints = result.get("complaints") or {}
        receiver_text = "、".join(complaints.get("receiverPhones") or load_complaint_config().get("receiverPhones") or [])
        lines = [colorize("判断口径", "bold")]
        rules = [
            "同一号码在当前导入范围内发生1次及以上呼损，就进入待处理清单。",
            "成功呼入不再作为排除条件，只标记最终已呼入或曾成功呼入。",
            "呼损次数统计当前导入范围内该号码的全部呼损。",
            "优先级由呼损次数、累计等待、排队阶段次数、最近发生时间共同决定。",
            f"投诉电话只统计呼入明细里座席分机属于 {receiver_text or '未配置'} 的记录。",
        ]
        for index, rule in enumerate(rules, 1):
            lines.append(f"{index}. {rule}")
        lines.append("")
        lines.append(colorize("Esc 返回", "muted"))
        return lines

    def _render_log(self, app: Any) -> list[str]:
        log_file = Path(__file__).resolve().parent.parent.parent / "运行日志.log"
        lines: list[str] = []
        if not log_file.exists():
            lines.append(colorize("暂无运行日志。", "yellow"))
        else:
            text = log_file.read_text(encoding="utf-8", errors="replace")[-4000:]
            lines.extend(text.splitlines())
        lines.append("")
        lines.append(colorize("Esc 返回", "muted"))
        return lines

    def handle_key(self, key: str, app: Any) -> bool:
        section = self.state.get("section")
        if section == "rules" or section == "log":
            if key in ("esc", "q", "enter", "backspace"):
                self.state["section"] = None
                return True
            return False
        if section == "mapping":
            return self._handle_mapping_key(key, app)
        if section == "download":
            return self._handle_download_key(key, app)
        if section == "complaint":
            return self._handle_complaint_key(key, app)
        return self._handle_main_key(key, app)

    def _handle_main_key(self, key: str, app: Any) -> bool:
        actions = ["download", "mapping", "complaint", "rules", "open", "log"]
        selection = int(self.state.get("selection", 0))
        if key == "up":
            if selection > 0:
                self.state["selection"] = selection - 1
            else:
                self.state["selection"] = len(actions) - 1
                app.feedback("↻ 已跳到底部")
            return True
        if key == "down":
            if selection < len(actions) - 1:
                self.state["selection"] = selection + 1
            else:
                self.state["selection"] = 0
                app.feedback("↻ 已跳回顶部")
            return True
        if key == "enter":
            action = actions[selection]
            if action == "download":
                self.state["section"] = "download"
                self.state["selection"] = 0
                self.state["editing"] = None
            elif action == "mapping":
                self.state["section"] = "mapping"
                self.state["mapping"] = load_agent_mapping()
                self.state["mapping_selection"] = 0
                self.state["mapping_editing"] = False
            elif action == "complaint":
                self.state["section"] = "complaint"
                self.state["editing"] = "complaint"
                self.state["edit_buffer"] = "、".join(load_complaint_config().get("receiverPhones") or [])
            elif action == "rules":
                self.state["section"] = "rules"
                self.state["_result"] = app.application.latest_result or {}
            elif action == "open":
                try:
                    from ..download_tasks import open_original_system_login_browser

                    payload = open_original_system_login_browser()
                    self.state["message"] = str(payload.get("message") or "已打开原系统登录页")
                except Exception as error:
                    self.state["message"] = str(error)
            else:
                self.state["section"] = "log"
            return True
        if key in ("1", "2", "3", "4", "5", "6"):
            self.state["selection"] = int(key) - 1
            return self._handle_main_key("enter", app)
        return False

    def _handle_download_key(self, key: str, app: Any) -> bool:
        fields = ["baseUrl", "days", "account", "password"]
        if self.state.get("editing"):
            if key == "enter":
                self._save_download_field()
                return True
            if key == "esc":
                self.state["editing"] = None
                return True
            if key == "backspace":
                self.state["edit_buffer"] = str(self.state.get("edit_buffer", ""))[:-1]
                return True
            if len(key) == 1 and key.isprintable():
                self.state["edit_buffer"] = str(self.state.get("edit_buffer", "")) + key
                return True
            return True
        selection = int(self.state.get("selection", 0))
        if key == "up":
            if selection > 0:
                self.state["selection"] = selection - 1
            else:
                self.state["selection"] = len(fields) - 1
                app.feedback("↻ 已跳到底部")
            return True
        if key == "down":
            if selection < len(fields) - 1:
                self.state["selection"] = selection + 1
            else:
                self.state["selection"] = 0
                app.feedback("↻ 已跳回顶部")
            return True
        if key == "enter":
            config = load_download_config()
            current = {
                "baseUrl": str(config.get("baseUrl", "")),
                "days": str(config.get("days", 30)),
                "account": str(config.get("account", "")),
                "password": str(config.get("password", "")),
            }
            self.state["editing"] = fields[selection]
            self.state["edit_buffer"] = current.get(fields[selection], "")
            return True
        if key == "s":
            try:
                save_download_config(load_download_config())
                self.state["message"] = "下载配置已保存。"
            except Exception as error:
                self.state["message"] = str(error)
            return True
        if key in ("esc", "q", "backspace"):
            self.state["section"] = None
            return True
        return False

    def _save_download_field(self) -> None:
        field = self.state.get("editing")
        if not field:
            return
        config = load_download_config()
        value = str(self.state.get("edit_buffer", "")).strip()
        if field == "days":
            try:
                config["days"] = int(value)
            except ValueError:
                self.state["message"] = "下载天数必须是数字。"
                return
        elif field == "password":
            config["password"] = value
        elif field == "baseUrl":
            config["baseUrl"] = value
        elif field == "account":
            config["account"] = value
        save_download_config(config)
        self.state["editing"] = None
        self.state["message"] = "下载配置已保存。"

    def _handle_mapping_key(self, key: str, app: Any) -> bool:
        mapping = self.state.get("mapping")
        if mapping is None:
            mapping = load_agent_mapping()
            self.state["mapping"] = mapping
        items = sorted(mapping.items())
        selection = int(self.state.get("mapping_selection", 0))
        if key == "up":
            if not items:
                return True
            if selection > 0:
                self.state["mapping_selection"] = selection - 1
            else:
                self.state["mapping_selection"] = len(items) - 1
                app.feedback("↻ 已跳到底部")
            return True
        if key == "down":
            if not items:
                return True
            if selection < len(items) - 1:
                self.state["mapping_selection"] = selection + 1
            else:
                self.state["mapping_selection"] = 0
                app.feedback("↻ 已跳回顶部")
            return True
        if key == "a":
            extension_text = self._tui_input("新增：先输入座席分机/手机号（多个用逗号分隔，直接回车取消）：").strip()
            if not extension_text:
                return True
            extensions = [part.strip() for part in re.split(r"[,，、]", extension_text) if part.strip()]
            if not extensions:
                self.state["message"] = "分机不能为空，已取消。"
                return True
            name = self._tui_input(f"新增：{ '、'.join(extensions) } 的姓名（直接回车取消）：").strip()
            if not name:
                return True
            for extension in extensions:
                mapping[extension] = name
            try:
                save_agent_mapping(mapping)
                app.application.cached_call_records = None
                self.state["message"] = f"已保存：新增 {len(extensions)} 条（{name}）。"
            except Exception as error:
                self.state["message"] = str(error)
            return True
        if key == "e":
            if not items:
                return True
            extension = items[selection][0]
            name = self._tui_input(f"修改 {extension} 的姓名（直接回车取消）：").strip()
            if not name:
                return True
            mapping[extension] = name
            try:
                save_agent_mapping(mapping)
                app.application.cached_call_records = None
                self.state["message"] = f"已保存：{extension} = {name}。"
            except Exception as error:
                self.state["message"] = str(error)
            return True
        if key == "d":
            if not items:
                return True
            extension = items[selection][0]
            mapping.pop(extension, None)
            if self.state["mapping_selection"] >= len(items) - 1:
                self.state["mapping_selection"] = max(0, len(items) - 2)
            try:
                save_agent_mapping(mapping)
                app.application.cached_call_records = None
                self.state["message"] = f"已保存：删除 {extension}。"
            except Exception as error:
                self.state["message"] = str(error)
            return True
        if key == "s":
            try:
                save_agent_mapping(mapping)
                app.application.cached_call_records = None
                self.state["message"] = "座席映射已保存。"
            except Exception as error:
                self.state["message"] = str(error)
            return True
        if key in ("esc", "q", "backspace"):
            self.state["section"] = None
            return True
        return False

    def _handle_complaint_key(self, key: str, app: Any) -> bool:
        if key == "enter":
            try:
                value = str(self.state.get("edit_buffer", "")).strip()
                saved = save_complaint_config({"receiverPhones": value})
                self.state["message"] = f"已保存投诉座席分机：{'、'.join(saved['receiverPhones'])}"
                app.application.refresh_result()
            except Exception as error:
                self.state["message"] = str(error)
            return True
        if key == "esc" or key == "q":
            self.state["section"] = None
            return True
        if key == "backspace":
            self.state["edit_buffer"] = str(self.state.get("edit_buffer", ""))[:-1]
            return True
        if len(key) == 1 and key.isprintable():
            self.state["edit_buffer"] = str(self.state.get("edit_buffer", "")) + key
            return True
        return True

    def footer(self, app: Any) -> str:
        section = self.state.get("section")
        if section == "mapping":
            return "↑↓选择 a新增 e编辑 d删除 s保存 Esc返回"
        if section == "download":
            return "↑↓选择 回车编辑 s保存 Esc返回"
        if section == "complaint":
            return "输入分机逗号分隔，回车保存 Esc返回"
        if section in ("rules", "log"):
            return "Esc 返回"
        return "↑↓选择 回车进入 ←→切页 q返回首页"
