# -*- coding: utf-8 -*-
# 一次性只读探针4：看清 ERP 订单查询页的 frame / iframe 结构（用完即删）。
import json, sys, time
from pathlib import Path
CLI = Path(r"D:\桌面\办公软件\10.自动报量\自动报量CLI")
sys.path.insert(0, str(CLI))
from auto_report_erp import (  # noqa: E402
    build_erp_browser_launch_options, locate_installed_chromium_browser, ensure_erp_login,
    _find_menu_search_input, _find_first_visible_text_locator,
)
from auto_report_credentials import load_erp_credentials  # noqa: E402
from auto_report_paths import AutoReportPaths  # noqa: E402
ROOT = Path(r"D:\桌面\办公软件\10.自动报量")
paths = AutoReportPaths.from_project_root(ROOT)
creds = load_erp_credentials(paths.erp_credentials_path)
out_dir = ROOT / ".codex-temporary"

def main():
    from playwright.sync_api import sync_playwright
    exe = locate_installed_chromium_browser()
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(**build_erp_browser_launch_options(
            browser_profile_directory=paths.erp_browser_profile_directory,
            browser_executable_path=exe, download_directory=out_dir))
        page = next((p for p in ctx.pages if not p.is_closed()), None) or ctx.new_page()
        ensure_erp_login(page, creds, lambda m: print("[需要人工]", m, flush=True))
        time.sleep(2)
        item = _find_first_visible_text_locator(page, "订单查询")
        if item is None:
            mb = _find_first_visible_text_locator(page, "菜单")
            if mb: mb.click(); time.sleep(1)
            si = _find_menu_search_input(page)
            if si:
                si.fill("订单查询"); time.sleep(1.5)
                item = _find_first_visible_text_locator(page, "订单查询")
        if item: item.click()
        time.sleep(8)
        print("== 顶层 pages ==", flush=True)
        for p in ctx.pages:
            print("  page:", p.url, flush=True)
        print("== frames ==", flush=True)
        for f in page.frames:
            print("  frame:", f.url[:160], flush=True)
        iframes = page.locator("iframe")
        print("== iframes ==", iframes.count(), flush=True)
        for i in range(min(iframes.count(), 10)):
            el = iframes.nth(i)
            print("  iframe", i, el.get_attribute("src"), "visible=", el.is_visible(), flush=True)
        # dump 每个 frame 的文本前 300 字
        for f in page.frames:
            try:
                t = f.locator("body").inner_text(timeout=5000)
            except Exception as e:
                t = f"<无法读取: {e}>"
            print("---- frame", f.url[:120], "\n", t[:300].replace("\n", " | "), flush=True)
        ctx.close()

if __name__ == "__main__":
    main()
