#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
selftest.py —— 16 号项目自动化自检（依据 SoftTalk #2705「AI 无界面真实运行」原则）
- 直接调用业务真源 boss_cdp，不绕界面、不留测试旁路、不做假路径
- 导出：写真实临时文件并读回校验（CSV BOM/列/中文、JSON 结构）
- TUI：无头渲染全部页面帧 + 按键分发 + 表单编辑 + 任务线程（真实捕获 stdout）
- 乱码自检：帧与文件全部按 UTF-8 合法解码，无替换符/无乱码字节
- Chrome：--with-chrome 真实启动独立 Chrome 并探测 CDP 端口
- 真实抓取：--with-real-fetch 且已登录时，真实网络抓 1 页并校验结果文件
用法：
  python selftest.py                  # 默认：全部逻辑 + 真实文件校验
  python selftest.py --with-chrome    # 追加真实 Chrome/CDP 探测
  python selftest.py --with-real-fetch # 追加真实网络抓取（需已扫码登录）
"""

import argparse
import csv
import io
import json
import os
import sys
import tempfile
import time
import unittest

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

import boss_cdp as biz
import boss_tui as tui


class FakeTerminal(io.StringIO):
    """可注入的假终端：有 columns/rows，让 TUI 帧布局与真实终端一致。"""
    columns = 100
    rows = 24


def new_app():
    ctx = tui.Ctx()
    pages = [tui.OverviewPage(ctx), tui.FetchPage(ctx), tui.LogPage(ctx), tui.ResultsPage(ctx)]
    app = tui.TuiApp("BOSS直聘采集工具", pages, output=FakeTerminal(),
                     status_bar_provider=lambda a: tui.build_status_lines(ctx, a))
    return ctx, pages, app


# ---------------------------------------------------------------- 业务真源

class BusinessTests(unittest.TestCase):
    def test_parse_job(self):
        item = {
            "jobId": "J1", "encryptJobId": "eJ1", "jobName": "国内电商运营",
            "salaryDesc": "6-11K", "cityName": "深圳", "areaDistrict": "龙岗区",
            "businessDistrict": "南联", "brandName": "深圳市锦祥桄仓库贸易",
            "bossName": "张三", "bossTitle": "HR", "jobLabels": ["五险一金"], "skills": ["电商"],
        }
        row = biz.parse_job(item)
        self.assertEqual(row["company"], "深圳市锦祥桄仓库贸易")
        self.assertEqual(row["title"], "国内电商运营")
        self.assertEqual(row["salary"], "6-11K")
        self.assertEqual(row["location"], "深圳·龙岗区·南联")
        self.assertEqual(row["job_link"], "https://www.zhipin.com/job_detail/eJ1.html")

    def test_export_csv_real_file(self):
        """真实生成 CSV 文件并读回校验：UTF-8 BOM、表头、中文内容、全列对齐。"""
        row = biz.parse_job({"jobId": "J1", "encryptJobId": "eJ1", "jobName": "运营",
                             "salaryDesc": "6-11K", "cityName": "深圳", "brandName": "某公司"})
        with tempfile.TemporaryDirectory() as d:
            paths = biz.export_rows([row], "kw", "101280600", "csv", d)
            self.assertTrue(os.path.exists(paths["csv"]))
            raw = open(paths["csv"], "rb").read()
            self.assertTrue(raw.startswith(b"\xef\xbb\xbf"), "CSV 必须带 UTF-8 BOM（Excel 打开不乱码）")
            raw.decode("utf-8")  # 乱码自检：整文件可 UTF-8 解码
            with open(paths["csv"], "r", encoding="utf-8-sig", newline="") as f:
                rows = list(csv.DictReader(f))
            self.assertEqual(rows[0]["company"], "某公司")
            self.assertEqual(rows[0]["location"], "深圳")

    def test_export_json_real_file(self):
        with tempfile.TemporaryDirectory() as d:
            paths = biz.export_rows([{"company": "甲"}], "kw", "101280600", "json", d)
            data = json.load(open(paths["json"], encoding="utf-8"))
            self.assertEqual(data[0]["company"], "甲")

    def test_search_url_encoding(self):
        url = biz.search_url("国内电商", "101280600", 2)
        self.assertIn("query=%E5%9B%BD%E5%86%85%E7%94%B5%E5%95%86", url)
        self.assertIn("city=101280600", url)
        self.assertIn("page=2", url)

    def test_city_codes_known(self):
        for city in ("深圳", "北京", "上海", "广州", "杭州"):
            self.assertTrue(str(biz.CITY_CODES[city]).isdigit())


# ---------------------------------------------------------------- TUI（无头真实渲染）

class TuiTests(unittest.TestCase):
    def _frame(self, app):
        return app.build_frame()

    def test_frame_structure_and_no_mojibake(self):
        """四页全部渲染：行数=终端行数、版权两行、无乱码（U+FFFD/非法解码）、每行不超宽过多。"""
        for idx in range(4):
            with self.subTest(page=idx + 1):
                _, _, app = new_app()
                app.switch_page(idx)
                frame = self._frame(app)
                self.assertEqual(len(frame), 24, "帧行数必须等于终端行数")
                self.assertIn("作者：黎路遥", frame[20])
                self.assertIn("版权所有 © 黎路遥", frame[21])
                for line in frame:
                    line.encode("utf-8").decode("utf-8")  # 合法 UTF-8
                    self.assertNotIn("\ufffd", line, "出现替换符=乱码")
                    w = tui.display_width(line)
                    self.assertLessEqual(w, 102, f"行宽越界: {w}")
                # 菜单栏含四页
                self.assertTrue(all(t in frame[3] for t in ("1总览", "2抓取", "3日志", "4结果")))

    def test_dispatch_global_keys(self):
        ctx, pages, app = new_app()
        app.dispatch_key("right")
        self.assertEqual(app.current_page_index, 1)
        app.dispatch_key("3")
        self.assertEqual(app.current_page_index, 2)
        # Ctrl+C 与退出菜单：直接退出，不再要确认
        calls = []
        app.on_exit_request = lambda: calls.append("exit")
        app.dispatch_key("ctrl-c")
        self.assertEqual(calls, ["exit"])
        pages[0].handle_key("up", app)  # 回到退出项
        app.switch_page(0)
        pages[0].state["selection"] = 3
        pages[0].handle_key("enter", app)
        self.assertEqual(calls, ["exit", "exit"])
        app.dispatch_key("q")
        self.assertEqual(app.current_page_index, 0)

    def test_fetch_form_edit(self):
        _, pages, app = new_app()
        fp = pages[1]
        fp.handle_key("down", app)
        fp.handle_key("enter", app)
        self.assertIsNotNone(fp.state["editing"])
        for _ in fp.state["edit_buffer"]:
            fp.handle_key("backspace", app)
        for ch in "北京":
            fp.handle_key(ch, app)
        fp.handle_key("enter", app)
        self.assertEqual(fp.state["city"], "北京")
        # 左右改页数/格式
        fp.state["selection"] = 2
        fp.handle_key("right", app)
        self.assertEqual(fp.state["pages"], 2)
        fp.state["selection"] = 3
        fp.handle_key("right", app)
        self.assertEqual(fp.state["format"], "json")

    def test_task_runner_captures_real_stdout(self):
        ctx = tui.Ctx()
        runner = ctx.tasks

        def job():
            print("real-log-line-中文")
            time.sleep(0.05)
            return [1, 2, 3]

        self.assertTrue(runner.start("t", job))
        self.assertTrue(runner.running)
        self.assertFalse(runner.start("t2", lambda: None), "运行中不得重复启动")
        while runner.running:
            time.sleep(0.02)
        self.assertEqual(runner.task["result"], [1, 2, 3])
        self.assertIn("real-log-line-中文", runner.snapshot_lines())

    def test_task_runner_error_reported(self):
        ctx = tui.Ctx()
        runner = ctx.tasks

        def boom():
            raise RuntimeError("真实异常必须被捕获")

        runner.start("boom", boom)
        while runner.running:
            time.sleep(0.02)
        self.assertIsNotNone(runner.task["error"])

    def test_non_tty_start_renders_and_exits(self):
        """无头启动（自动化/AI 调用）不阻塞、不崩溃，输出一帧即返回。"""
        ctx, pages, app = new_app()
        try:
            app.start()
        finally:
            app.stop()
        output = app.output.getvalue()
        self.assertIn("总览", output)
        self.assertIn("黎路遥", output)


# ---------------------------------------------------------------- 真实 Chrome（可选）

@unittest.skipUnless("--with-chrome" in sys.argv, "需 --with-chrome 才启动真实 Chrome")
class ChromeTests(unittest.TestCase):
    def test_chrome_launch_and_cdp(self):
        self.assertTrue(biz.find_chrome(), "应能找到 Chrome")
        started = biz.ensure_chrome_running(biz.DEFAULT_PORT)
        self.assertTrue(started or biz.cdp_ready(biz.DEFAULT_PORT))
        self.assertTrue(biz.cdp_ready(biz.DEFAULT_PORT), "CDP 端口应可访问")
        info = biz.open_tab(biz.DEFAULT_PORT)
        self.assertTrue(info.startswith("ws://"), "应拿到 WebSocket 调试地址")
        # 连接一次再关闭，验证 websocket 通路
        sess = tui.CDPSession(info) if hasattr(tui, "CDPSession") else None
        if sess:
            sess.close()

    def test_login_state_detection(self):
        # 真实判断登录态（读专用 profile 目录）
        logged = tui.is_logged_in()
        print(f"\n[info] 登录态检测：{'已登录' if logged else '未登录（需先扫码一次）'}")


# ---------------------------------------------------------------- 真实抓取（可选，需已登录）

@unittest.skipUnless("--with-real-fetch" in sys.argv and os.path.exists(
    os.path.join(biz.PROFILE_DIR, "Default", "Cookies")), "需 --with-real-fetch 且已扫码登录")
class RealFetchTests(unittest.TestCase):
    def test_real_fetch_one_page(self):
        """真实浏览器 + 真实网络 + 真实导出文件，验证完整抓取链路。"""
        before = set(os.listdir(biz.RESULT_DIR)) if os.path.isdir(biz.RESULT_DIR) else set()
        rows = biz.run_fetch("国内电商", "深圳", 1, "both", delay=0, port=biz.DEFAULT_PORT)
        self.assertGreater(len(rows), 0, "应抓取到至少一条真实岗位数据")
        for key in ("company", "title", "salary", "job_link"):
            self.assertTrue(rows[0][key], f"字段 {key} 不应为空")
        after = set(os.listdir(biz.RESULT_DIR))
        new_files = after - before
        self.assertTrue(any(f.endswith(".csv") for f in new_files), "应生成真实 CSV 导出文件")
        # 读回校验
        for f in new_files:
            if f.endswith(".csv"):
                with open(os.path.join(biz.RESULT_DIR, f), encoding="utf-8-sig") as fh:
                    content = fh.read()
                self.assertIn(rows[0]["company"], content, "CSV 内容应含抓到的公司名")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="16号项目自动化自检")
    ap.add_argument("--with-chrome", action="store_true", help="追加：真实启动 Chrome 并探测 CDP")
    ap.add_argument("--with-real-fetch", action="store_true", help="追加：真实网络抓 1 页（需已登录）")
    args, rest = ap.parse_known_args()
    if args.with_chrome:
        sys.argv.append("--with-chrome")
    if args.with_real_fetch:
        sys.argv.append("--with-real-fetch")
    suite = unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__])
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    print("\n[summary] PASS/FAIL/SKIP:",
          result.testsRun - len(result.failures) - len(result.errors) - len(result.skipped),
          len(result.failures) + len(result.errors), result.skipped.__len__())
    sys.exit(0 if result.wasSuccessful() else 1)