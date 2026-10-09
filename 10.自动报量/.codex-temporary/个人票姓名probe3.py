# -*- coding: utf-8 -*-
# 一次性只读探针3：打开 ERP 订单查询 UI，搜索订单并打开详情，拦截网络（用完即删）。
import json, sys, time
from pathlib import Path

CLI = Path(r"D:\桌面\办公软件\10.自动报量\自动报量CLI")
sys.path.insert(0, str(CLI))
from auto_report_erp import (  # noqa: E402
    build_erp_browser_launch_options, locate_installed_chromium_browser, ensure_erp_login,
    _find_menu_search_input, _find_first_visible_text_locator, _wait_for_condition,
)
from auto_report_credentials import load_erp_credentials  # noqa: E402
from auto_report_paths import AutoReportPaths  # noqa: E402

ROOT = Path(r"D:\桌面\办公软件\10.自动报量")
paths = AutoReportPaths.from_project_root(ROOT)
creds = load_erp_credentials(paths.erp_credentials_path)
out_dir = ROOT / ".codex-temporary"
ORDER = "240103-***********1794"

def main():
    from playwright.sync_api import sync_playwright
    exe = locate_installed_chromium_browser()
    captured = []
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(
            **build_erp_browser_launch_options(
                browser_profile_directory=paths.erp_browser_profile_directory,
                browser_executable_path=exe,
                download_directory=out_dir,
            )
        )
        page = next((p for p in ctx.pages if not p.is_closed()), None) or ctx.new_page()

        def on_response(resp):
            try:
                u = resp.url
                if "/tc/" in u:
                    req = resp.request
                    entry = {"method": req.method, "url": u, "status": resp.status}
                    try:
                        if req.post_data and len(req.post_data) < 3000:
                            entry["post"] = req.post_data[:3000]
                    except Exception:
                        pass
                    ct = (resp.headers or {}).get("content-type", "")
                    if "json" in ct:
                        try:
                            body = resp.text()
                            entry["body"] = body[:4000]
                        except Exception as e:
                            entry["bodyErr"] = str(e)
                    captured.append(entry)
            except Exception:
                pass

        page.on("response", on_response)
        ensure_erp_login(page, creds, lambda m: print("[需要人工]", m, flush=True))
        print("[登录]", page.url, flush=True)
        # 等首页就绪
        time.sleep(2)

        # 打开订单查询：先找可见文本，再菜单搜索
        item = _find_first_visible_text_locator(page, "订单查询")
        if item is None:
            menu_button = _find_first_visible_text_locator(page, "菜单")
            if menu_button is not None:
                menu_button.click()
                time.sleep(1)
            search_input = _find_menu_search_input(page)
            if search_input is not None:
                search_input.fill("订单查询")
                time.sleep(1.5)
                item = _find_first_visible_text_locator(page, "订单查询")
        print("[菜单] 订单查询 命中:", item is not None, flush=True)
        if item is not None:
            item.click()
        time.sleep(6)
        body = page.locator("body").inner_text(timeout=20000)
        (out_dir / "ui-1-打开后.txt").write_text(body, encoding="utf-8")
        print("[页面] 前600字:\n", body[:600], flush=True)

        # 找搜索输入框
        inputs = page.locator("input:visible")
        info = []
        for i in range(min(inputs.count(), 40)):
            el = inputs.nth(i)
            info.append({
                "i": i,
                "placeholder": el.get_attribute("placeholder"),
                "name": el.get_attribute("name"),
                "id": el.get_attribute("id"),
                "class": (el.get_attribute("class") or "")[:60],
            })
        print("[输入框]", json.dumps(info, ensure_ascii=False, indent=1), flush=True)
        (out_dir / "ui-2-输入框.json").write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")

        # 尝试给含 单号 的输入框填空
        filled = False
        for i in range(min(inputs.count(), 40)):
            el = inputs.nth(i)
            ph = el.get_attribute("placeholder") or ""
            if "单号" in ph or "订单" in ph:
                el.fill(ORDER)
                el.press("Enter")
                filled = True
                print(f"[搜索] 已填 index={i} placeholder={ph!r}", flush=True)
                break
        if not filled:
            # 兜底：第一个可见输入框（可能是全局搜索）
            print("[搜索] 没找到单号框", flush=True)
        time.sleep(8)
        body2 = page.locator("body").inner_text(timeout=20000)
        (out_dir / "ui-3-搜索后.txt").write_text(body2, encoding="utf-8")
        print("[搜索后] 页面含单号:", ORDER in body2, flush=True)

        # 找含订单号的行元素，双击
        row_hit = False
        try:
            loc = page.locator(f"text={ORDER}")
            n = loc.count()
            print("[行] 含单号元素数:", n, flush=True)
            if n:
                loc.first.dblclick(timeout=8000)
                row_hit = True
        except Exception as e:
            print("[行] 双击失败:", e, flush=True)
        time.sleep(8)
        body3 = page.locator("body").inner_text(timeout=20000)
        (out_dir / "ui-4-详情后.txt").write_text(body3, encoding="utf-8")
        print("[详情后] 前1000字:\n", body3[:1000], flush=True)

        (out_dir / "ui-网络.json").write_text(json.dumps(captured, ensure_ascii=False, indent=2), encoding="utf-8")
        print("[网络] 捕获 /tc/ 请求数:", len(captured), flush=True)
        for e in captured:
            print("  -", e["method"], e["url"][:160], e.get("status"), ("POST:" + e.get("post", "")[:200]) if e.get("post") else "", flush=True)
        ctx.close()

if __name__ == "__main__":
    main()
