#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""16号项目 TUI：页面与动作编排；终端、线程、采集业务分别在独立模块中。"""
import glob
import hashlib
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

import boss_cdp as biz
import edge_profile
from boss_terminal import (CODES, ESC, ANSI_PATTERN, ANSI_TOKEN_PATTERN, ANSI_PART_PATTERN,
                           WIDE_RANGES, TuiApp, is_wide_char, _is_zero_width, display_width,
                           colorize, pad_end, pad_start, truncate, fit, move_to, clear_line,
                           format_clock, spinner_frame, format_progress_bar, format_elapsed,
                           safe_log_text)
from boss_types import finite_seconds
from task_runtime import TaskRunner

# 京东等可选功能缺依赖时，不阻止用户启动 BOSS 采集或查看日志。
try:
    import jd_shops
except ImportError as exc:
    jd_shops = None
    _jd_import_error = str(exc)
try:
    import shop_subjects
except ImportError as exc:
    shop_subjects = None
    _shops_import_error = str(exc)

APP_VERSION = "v0.12-rc3"
BUILD_ID = "refactor-reliability-20260908-r3"


def print_diagnostics():
    print(f"[diagnostic] build={BUILD_ID}; previous=fix-none-20260908; Python={sys.version.split()[0]}", flush=True)
    print(f"[diagnostic] executable={sys.executable}", flush=True)
    files = [("boss_tui", __file__), ("boss_cdp", getattr(biz, "__file__", None))]
    for name in ("boss_transport", "boss_types", "boss_storage", "task_runtime", "boss_terminal", "edge_profile"):
        files.append((name, str(Path(__file__).with_name(name + ".py"))))
    if jd_shops is not None:
        for name in ("jd_shops", "jd_session", "jd_fields"):
            files.append((name, str(Path(__file__).with_name(name + ".py"))))
    for label, path in files:
        print(f"[diagnostic] {label}={path or '无法定位模块文件'}", flush=True)
        if path:
            try:
                digest = hashlib.sha256(Path(path).read_bytes()).hexdigest()
                print(f"[diagnostic] {label}.sha256={digest}", flush=True)
            except OSError as exc:
                print(f"[diagnostic] {label} 源码指纹不可读：{exc}", flush=True)


def run_boss_fetch(*args, **kwargs):
    print_diagnostics()
    # 只在参数里替换已经确认属于本项目 Profile 的现有端口，不在这里启动浏览器；
    # 因此无效关键词/城市/页数仍由业务层先校验，不会因为诊断逻辑提前拉起 Edge。
    call_args = list(args)
    call_kwargs = dict(kwargs)
    if "port" in call_kwargs:
        call_kwargs["port"] = edge_profile.resolve_profile_port(biz, call_kwargs["port"])
    elif len(call_args) >= 6:
        call_args[5] = edge_profile.resolve_profile_port(biz, call_args[5])
    try:
        rows = biz.run_fetch(*call_args, **call_kwargs)
    except SystemExit as exc:
        raise RuntimeError(f"抓取函数提前退出（SystemExit: {exc.code!r}），未返回岗位列表") from exc
    if rows is None:
        raise RuntimeError("抓取函数未返回结果（None），无法确认成功；请核对诊断中的代码路径和版本")
    if not isinstance(rows, list):
        raise TypeError(f"抓取函数返回 {type(rows).__name__}，预期岗位列表（list）")
    return rows


def has_saved_profile():
    paths = (os.path.join(biz.PROFILE_DIR, "Default", "Network", "Cookies"),
             os.path.join(biz.PROFILE_DIR, "Default", "Cookies"))
    return any(os.path.exists(path) for path in paths)


def default_config():
    jd_input = jd_shops.default_input_path() if jd_shops is not None else Path(__file__).with_name("京东店铺.txt")
    return {"keyword": "国内电商", "city": "深圳", "pages": 1, "format": "csv",
            "title_filter": "", "jd_input": str(jd_input), "verification_timeout": 300}


class OverviewPage:
    key, title = "1", "首页"

    def __init__(self, ctx):
        self.ctx = ctx
        self.state = {"selection": 0, "message": ""}

    @property
    def items(self):
        login = ("首次登录 / 检查登录态", "在专用浏览器中正常登录；以接口验证为准")
        items = [("采集BOSS招聘企业", "按配置页参数启动职位采集"),
                 ("配置采集参数", "编辑关键词、城市、页数和导出格式"),
                 ("采集京东店铺", "按样表15列输出Excel；遇验证由用户完成"),
                 ("采集供应商网店铺主体", "读取程序旁店铺清单"),
                 ("打开结果目录", "查看本次与历史导出文件"),
                 ("退出采集工具", "首页按0退出；运行中先停止并保存")]
        return [*items, login] if has_saved_profile() else [login, *items]

    def on_enter(self, app):
        self.state["selection"] = min(self.state["selection"], len(self.items) - 1)

    def render(self, app):
        lines = [colorize(fit("主操作（↑↓选择 回车执行 ←→切页 0退出）", app.columns), "brightBlue"), ""]
        # 小窗口滚动菜单，避免选中了窗口外的项目却看不到。
        available = max(1, app.content_height - 3)
        start = max(0, self.state["selection"] - available + 1)
        for index, (label, desc) in enumerate(self.items[start:start + available], start):
            selected = index == self.state["selection"]
            if label == "采集BOSS招聘企业":
                label = colorize(label, "brightGreen")
            elif label == "退出采集工具":
                label = colorize(label, "brightRed")
            line = fit(("▶ " if selected else "  ") + label + "　" + colorize(desc, "gray"), app.columns)
            lines.append(colorize(line, "reverse") if selected else line)
        if self.state["message"]:
            lines.append(colorize(fit("提示：" + self.state["message"], app.columns), "brightYellow"))
        return lines

    def handle_key(self, key, app):
        if key == "0":
            app.on_exit_request()
        elif key in ("up", "down"):
            self.state["selection"] = (self.state["selection"] + (1 if key == "down" else -1)) % len(self.items)
        elif key == "enter":
            label = self.items[self.state["selection"]][0]
            if label == "配置采集参数":
                app.switch_page(1)
            elif label == "打开结果目录":
                self.open_result_dir()
            elif label == "退出采集工具":
                app.on_exit_request()
            elif label == "采集BOSS招聘企业":
                if not self.ctx.start_fetch(app):
                    self.state["message"] = "已有任务在运行，请先等待完成"
            else:
                if label == "首次登录 / 检查登录态":
                    desc, fn, args = "启动专用浏览器并等待登录", self.ctx.action_login, ()
                elif label == "采集京东店铺":
                    if jd_shops is None:
                        self.state["message"] = "京东功能依赖未就绪：" + _jd_import_error
                        return True
                    timeout = self.ctx.config["verification_timeout"]
                    desc = "采集京东店铺（样表15列）"
                    fn = lambda input_path, progress=None, stop_event=None: jd_shops.run_shops(
                        input_path=input_path, progress=progress, stop_event=stop_event,
                        verification_timeout=timeout)
                    args = (self.ctx.config["jd_input"],)
                else:
                    if shop_subjects is None:
                        self.state["message"] = "供应商网功能依赖未就绪：" + _shops_import_error
                        return True
                    desc, fn, args = "采集供应商网B2B店铺主体", shop_subjects.run_shops, (self.ctx.config["format"],)
                if self.ctx.tasks.start(desc, fn, args, with_progress=True, cancellable=True):
                    app.switch_page(2)
                else:
                    self.state["message"] = "已有任务在运行，请先等待完成"
        else:
            return None
        return True

    @staticmethod
    def open_result_dir():
        os.makedirs(biz.RESULT_DIR, exist_ok=True)
        subprocess.Popen(["explorer", biz.RESULT_DIR])


class ConfigPage:
    key, title = "2", "配置"

    def __init__(self, ctx):
        self.ctx = ctx
        self.state = {"selection": 0, "editing": None, "edit_buffer": "", "message": ""}

    @property
    def fields(self):
        return [{"key": "keyword", "label": "搜索词", "type": "text"},
                {"key": "city", "label": "城市", "type": "text"},
                {"key": "pages", "label": "页数", "type": "number"},
                {"key": "format", "label": "格式", "type": "choice", "choices": ["csv", "json", "both"]},
                {"key": "title_filter", "label": "岗位包含词", "type": "text"},
                {"key": "jd_input", "label": "京东清单", "type": "text"},
                {"key": "verification_timeout", "label": "验证等待秒", "type": "seconds"}]

    def on_enter(self, app):
        self.state["editing"] = None
        self.state["message"] = ""

    def render(self, app):
        lines = [colorize(fit("采集配置（回车编辑/保存 Esc取消 r重置；验证等待0=立即停止）", app.columns), "brightBlue"), ""]
        available = max(1, app.content_height - (4 if self.state["editing"] else 3))
        start = max(0, self.state["selection"] - available + 1)
        for index, field in enumerate(self.fields[start:start + available], start):
            selected = index == self.state["selection"]
            editing = self.state["editing"] and self.state["editing"]["key"] == field["key"]
            value = self.state["edit_buffer"] if editing else self.ctx.config[field["key"]]
            if field["key"] == "title_filter" and not value and not editing:
                value = "不限（可填客服,仓管等）"
            if editing and field["type"] in ("number", "choice", "seconds"):
                value = f"{value} (←→调整)"
            line = fit(("▶ " if selected else "  ") + pad_end(field["label"], 12) + " " + str(value), app.columns)
            lines.append(colorize(line, "reverse") if selected else line)
        if self.state["editing"]:
            lines.append(colorize(fit(f"编辑【{self.state['editing']['label']}】：{self.state['edit_buffer']}_", app.columns), "brightCyan"))
            lines.append(colorize("回车确认 Esc取消", "gray"))
        elif self.state["message"]:
            lines.append(colorize(fit("提示：" + self.state["message"], app.columns), "brightYellow"))
        return lines

    def handle_key(self, key, app):
        if self.state["editing"]:
            return self._handle_editing(key, app)
        if key in ("up", "down"):
            self.state["selection"] = (self.state["selection"] + (1 if key == "down" else -1)) % len(self.fields)
        elif key == "enter":
            self._begin_edit(self.fields[self.state["selection"]])
        elif key == "r":
            self.ctx.config.update(default_config())
            self.state["message"] = "参数已恢复默认"
        else:
            return None
        return True

    def _handle_editing(self, key, app):
        field = self.state["editing"]
        if key == "enter":
            value = self.state["edit_buffer"].strip()
            try:
                if field["key"] == "city":
                    value = biz.normalize_city(value)
                elif field["type"] == "number":
                    value = biz.normalize_page_count(value)
                elif field["type"] == "seconds":
                    value = finite_seconds(value, "验证等待时间")
                elif field["type"] == "choice":
                    if value not in field["choices"]:
                        raise ValueError("格式只能是 csv、json 或 both")
                elif not value and field["key"] != "title_filter":
                    raise ValueError(field["label"] + "不能为空")
                self.ctx.config[field["key"]] = value
            except ValueError as exc:
                self.state["message"] = str(exc)
            self.state["editing"] = None
        elif key == "esc":
            self.state["editing"] = None
            self.state["edit_buffer"] = ""
        elif key in ("left", "right"):
            step = 1 if key == "right" else -1
            if field["type"] in ("number", "seconds"):
                try:
                    current = int(self.state["edit_buffer"])
                except ValueError:
                    current = int(self.ctx.config[field["key"]])
                minimum, maximum = (1, biz.MAX_PAGES) if field["type"] == "number" else (0, 3600)
                self.state["edit_buffer"] = str(max(minimum, min(maximum, current + step)))
            elif field["type"] == "choice":
                choices = field["choices"]
                current = self.state["edit_buffer"]
                if current not in choices:
                    current = self.ctx.config[field["key"]]
                self.state["edit_buffer"] = choices[(choices.index(current) + step) % len(choices)]
        elif key == "backspace":
            self.state["edit_buffer"] = self.state["edit_buffer"][:-1]
        elif field["type"] == "text" and len(key) == 1 and key.isprintable():
            self.state["edit_buffer"] += key
        elif field["type"] in ("number", "seconds") and len(key) == 1 and key.isascii() and key.isdigit():
            self.state["edit_buffer"] += key
        else:
            return None
        return True

    def _begin_edit(self, field):
        self.state.update(message="", editing=field, edit_buffer=str(self.ctx.config[field["key"]]))


def task_summary(task):
    result = task["result"]
    error = task["error"]
    if error is not None:
        outcome = getattr(error, "result", None)
        if getattr(outcome, "status", None) == "blocked":
            return f"⚠ 需要用户验证：{task['desc']} → {error}", "brightYellow"
        return f"✗ 任务失败：{task['desc']} → {type(error).__name__}: {error}", "brightRed"
    status = getattr(result, "status", None)
    if status == "blocked":
        return f"⚠ 需要用户验证：共 {len(result)} 条；{result.reason}", "brightYellow"
    if status == "failed":
        return f"✗ 任务失败：{result.reason}", "brightRed"
    if status == "cancelled" or (status is None and task["stop_event"].is_set()):
        count = len(result) if isinstance(result, list) else 0
        return f"⚠ 已停止：{task['desc']} → 共 {count} 条", "brightYellow"
    if isinstance(result, list):
        if status == "partial" or task.get("stage") == "部分完成":
            return f"⚠ 部分完成：{task['desc']} → 共 {len(result)} 条；{getattr(result, 'reason', task.get('detail', ''))}", "brightYellow"
        if not result:
            return f"⚠ 无匹配结果：{task['desc']} → 0 条，未导出文件", "brightYellow"
        pages = f"，实际完成 {result.completed_pages} 页" if hasattr(result, "completed_pages") else ""
        exported = "，已导出" if getattr(result, "paths", None) else ""
        return f"✓ 已完成：{task['desc']} → 共 {len(result)} 条{pages}{exported}", "brightGreen"
    if result is True:
        return f"✓ 已完成：{task['desc']} → 登录成功，登录态已保存", "brightGreen"
    if result is False:
        return f"⚠ 登录未完成：{task['desc']} → 请检查 Edge 页面", "brightYellow"
    if result is None:
        return f"✗ 任务失败：{task['desc']} → 未返回结果（None），不能确认成功", "brightRed"
    return f"✗ 任务失败：{task['desc']} → 未确认的结果类型 {type(result).__name__}", "brightRed"


class LogPage:
    key, title = "3", "日志"

    def __init__(self, ctx):
        self.ctx = ctx

    def render(self, app):
        tasks, columns = self.ctx.tasks, app.columns
        lines = [colorize(fit("运行日志（s停止并保存；o打开日志目录）", columns), "brightBlue")]
        if not tasks.task:
            return lines + [colorize("还没有运行过任务，请回首页选择采集功能。", "gray")]
        task = tasks.task
        if tasks.running:
            elapsed = format_elapsed(time.monotonic() - task["started_at"])
            line = f"{spinner_frame()} 运行中：{task['stage']} {format_progress_bar(task['current'], task['total'])} {elapsed}"
            lines.append(colorize(fit(line, columns), "brightYellow"))
            lines.append(colorize(fit("详情：" + safe_log_text(task.get("detail", "")), columns), "gray"))
        else:
            summary, color = task_summary(task)
            lines.append(colorize(fit(safe_log_text(summary), columns), color))
            if task.get("log_error"):
                lines.append(colorize(fit("日志保存失败：" + task["log_error"], columns), "brightRed"))
            elif task.get("log_path"):
                lines.append(colorize(fit("完整日志：" + task["log_path"], columns), "gray"))
        for line in tasks.snapshot_lines(max(0, app.content_height - len(lines))):
            lines.append(fit(safe_log_text(line), columns))
        return lines[:app.content_height]

    def handle_key(self, key, app):
        if key == "s":
            self.ctx.tasks.request_stop()
            return True
        if key == "o":
            task = self.ctx.tasks.task
            if task and task.get("log_path"):
                subprocess.Popen(["explorer", os.path.dirname(task["log_path"])])
            return True
        return None


class ResultsPage:
    key, title = "4", "结果"

    def __init__(self, ctx):
        self.ctx = ctx

    def list_files(self):
        os.makedirs(biz.RESULT_DIR, exist_ok=True)
        files = []
        for pattern in ("boss_jobs_*", "merchant_subjects_*", "jd_shops_*"):
            files.extend(path for path in glob.glob(os.path.join(biz.RESULT_DIR, pattern)) if os.path.isfile(path))
        def modified(path):
            try:
                return os.path.getmtime(path)
            except OSError:
                return 0
        return sorted(files, key=modified, reverse=True)[:20]

    def render(self, app):
        lines = [colorize(fit("最近结果（回车打开所在目录）", app.columns), "brightBlue"), ""]
        files = self.list_files()
        if not files:
            return lines + [colorize("结果目录还没有导出文件。", "gray")]
        for path in files:
            if len(lines) >= app.content_height - 1:
                break
            try:
                stat = os.stat(path)
            except OSError:
                continue
            lines.append(fit(f"  {os.path.basename(path)}  {stat.st_size}B  {time.strftime('%Y-%m-%d %H:%M', time.localtime(stat.st_mtime))}", app.columns))
        lines.append(colorize(fit("输出目录：" + biz.RESULT_DIR, app.columns), "gray"))
        return lines

    def handle_key(self, key, app):
        if key == "enter":
            OverviewPage.open_result_dir()
            return True
        return None


class Ctx:
    def __init__(self):
        self.tasks = TaskRunner(log_dir=os.path.join(biz.RESULT_DIR, "logs"))
        self.config = default_config()
        self._cleaned_up = False
        self.exiting = False

    @staticmethod
    def action_login(timeout=900, progress=None, stop_event=None):
        if stop_event is not None and stop_event.is_set():
            return False
        if callable(progress):
            progress(0, 0, "连接专用浏览器", "正在建立登录会话")
        port = edge_profile.ensure_profile_edge(biz, biz.DEFAULT_PORT)
        ok = biz.login_wait("国内电商", biz.CITY_CODES["深圳"], port, timeout, progress=progress, stop_event=stop_event)
        if callable(progress):
            progress(1 if ok else 0, 1, "登录完成" if ok else "登录未完成", "以真实接口响应为准")
        return bool(ok)

    def start_fetch(self, app):
        if self.tasks.running:
            return False
        config = dict(self.config)
        args = (config["keyword"], config["city"], config["pages"], config["format"], 3, biz.DEFAULT_PORT)
        ok = self.tasks.start(f"抓取 {config['keyword']} @ {config['city']}",
                              lambda *args, progress=None, stop_event=None: run_boss_fetch(
                                  *args, progress=progress, title_filter=config["title_filter"], stop_event=stop_event,
                                  verification_timeout=config["verification_timeout"]),
                              args, with_progress=True, total=config["pages"], cancellable=True)
        if ok:
            app.switch_page(2)
        return ok

    def request_exit(self, app):
        if self.tasks.running:
            self.exiting = app.exit_pending = True
            self.tasks.request_stop()
            app.switch_page(2)
        else:
            app.stop()
            self.cleanup()

    def finish_exit(self, app):
        if self.exiting and not self.tasks.running:
            self.exiting = app.exit_pending = False
            if self.tasks.task and self.tasks.task["error"] is not None:
                app.request_render()
                return
            app.stop()
            self.cleanup()

    def cleanup(self):
        if self._cleaned_up:
            return
        self.tasks.request_stop()
        self.tasks.wait()
        self._cleaned_up = True
        biz.close_owned_edge()


def build_status_lines(ctx, app):
    login = "已有Profile（以接口为准）" if has_saved_profile() else "未建立Profile（首次需登录）"
    task = ctx.tasks.task
    if task and not task["done"]:
        state = f"任务 [运行中] {task['desc']} {spinner_frame()} {format_progress_bar(task['current'], task['total'], 12)}"
    else:
        state = "任务 [空闲] 等待操作"
    hint = "正在停止并保存，请勿强关窗口。" if ctx.exiting else "登录可能过期；遇验证请在原Edge处理。降低频率不能保证免于限制。"
    return [fit(f" {state}  登录资料 [{login}]", app.columns), fit(" 提示：" + hint, app.columns)]


def ensure_console_utf8():
    try:
        import ctypes
        ctypes.windll.kernel32.SetConsoleOutputCP(65001)
        ctypes.windll.kernel32.SetConsoleCP(65001)
    except (AttributeError, OSError):
        pass
    # 重定向到日志/管道时 Python 的 TextIO 编码不会随控制台代码页自动变化；
    # 显式统一为 UTF-8，避免 Issue 中中文被二次解码成乱码。
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except (AttributeError, OSError, ValueError):
                pass


def main(argv=None):
    ensure_console_utf8()
    argv = sys.argv[1:] if argv is None else argv
    if argv == ["--diagnose"]:
        print_diagnostics()
        return
    if argv and argv[0] == "--auto":
        import argparse
        parser = argparse.ArgumentParser(description="无界面运行真实业务")
        parser.add_argument("--auto", choices=["login", "fetch", "jd", "shops"])
        parser.add_argument("--jd-file", default=None)
        parser.add_argument("--shops-file", default=None)
        parser.add_argument("--verification-timeout", type=float, default=None)
        parser.add_argument("--keyword", default="国内电商")
        parser.add_argument("--title-filter", default="")
        parser.add_argument("--city", default="深圳")
        parser.add_argument("--pages", type=int, default=1)
        parser.add_argument("--format", choices=["csv", "json", "both"], default="csv")
        parser.add_argument("--login-timeout", type=int, default=900)
        args = parser.parse_args(argv)
        try:
            if args.auto == "shops":
                if shop_subjects is None:
                    raise RuntimeError("供应商网功能依赖未就绪：" + _shops_import_error)
                shop_subjects.run_shops(args.format, input_path=args.shops_file)
                return
            if args.auto == "jd":
                if jd_shops is None:
                    raise RuntimeError("京东功能依赖未就绪：" + _jd_import_error)
                print_diagnostics()
                result = jd_shops.run_shops(
                    input_path=args.jd_file,
                    verification_timeout=900 if args.verification_timeout is None else args.verification_timeout)
                sys.exit(getattr(result, "exit_code", 0))
            if args.auto == "login":
                sys.exit(0 if Ctx.action_login(timeout=args.login_timeout) else 2)
            rows = run_boss_fetch(args.keyword, args.city, args.pages, args.format, delay=3, port=biz.DEFAULT_PORT,
                                  title_filter=args.title_filter,
                                  verification_timeout=0 if args.verification_timeout is None else args.verification_timeout)
            sys.exit(getattr(rows, "exit_code", 0))
        finally:
            biz.close_owned_edge()
    ctx = Ctx()
    pages = [OverviewPage(ctx), ConfigPage(ctx), LogPage(ctx), ResultsPage(ctx)]
    app = TuiApp(title=f"BOSS直聘采集工具 {APP_VERSION}", pages=pages,
                 on_exit_request=lambda: ctx.request_exit(app),
                 status_bar_provider=lambda a: build_status_lines(ctx, a), on_tick=ctx.finish_exit)
    try:
        app.start()
    finally:
        app.stop()
        ctx.cleanup()


if __name__ == "__main__":
    try:
        main()
    except biz.VerificationRequired as exc:
        print(f"[error] {exc}", file=sys.stderr)
        raise SystemExit(3)
    except KeyboardInterrupt:
        raise SystemExit(130)
