# -*- coding: utf-8 -*-
# 一次性只读探针5：在经典订单查询 frame 里搜单、双击打开详情（用完即删）。
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
ORDER = "240103-***********1794"

def main():
    from playwright.sync_api import sync_playwright
    exe = locate_installed_chromium_browser()
    captured = []
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(**build_erp_browser_launch_options(
            browser_profile_directory=paths.erp_browser_profile_directory,
            browser_executable_path=exe, download_directory=out_dir))
        page = next((p for p in ctx.pages if not p.is_closed()), None) or ctx.new_page()
        def on_response(resp):
            try:
                if "/tc/" in resp.url:
                    req = resp.request
                    e = {"method": req.method, "url": resp.url, "status": resp.status}
                    try:
                        if req.post_data and len(req.post_data) < 5000: e["post"] = req.post_data[:5000]
                    except Exception: pass
                    ct = (resp.headers or {}).get("content-type","")
                    if "json" in ct:
                        try: e["body"] = resp.text()[:6000]
                        except Exception as ex: e["bodyErr"] = str(ex)
                    captured.append(e)
            except Exception: pass
        page.on("response", on_response)
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
        frame = None
        for waited in range(60):
            for f in page.frames:
                if "trade_order_header" in f.url and "bodyguard" not in f.url:
                    frame = f; break
            if frame: break
            time.sleep(0.5)
        if frame is None:
            # 再点一次（可能首次点击落空），继续等
            item2 = _find_first_visible_text_locator(page, "订单查询")
            if item2: item2.click()
            for waited in range(60):
                for f in page.frames:
                    if "trade_order_header" in f.url and "bodyguard" not in f.url:
                        frame = f; break
                if frame: break
                time.sleep(0.5)
        (out_dir / "probe5-页面.txt").write_text(page.locator("body").inner_text(timeout=8000), encoding="utf-8")
        assert frame, "没找到订单查询 frame"
        print("[frame]", frame.url, flush=True)
        time.sleep(3)

        # dump inputs
        inputs = []
        loc = frame.locator("input")
        for i in range(min(loc.count(), 80)):
            el = loc.nth(i)
            try:
                if not el.is_visible(): continue
            except Exception: continue
            inputs.append({"i": i, "name": el.get_attribute("name"), "id": el.get_attribute("id"),
                           "placeholder": el.get_attribute("placeholder"), "type": el.get_attribute("type"),
                           "class": (el.get_attribute("class") or "")[:60]})
        print("[inputs]", json.dumps(inputs, ensure_ascii=False), flush=True)
        (out_dir / "frame-inputs.json").write_text(json.dumps(inputs, ensure_ascii=False, indent=1), encoding="utf-8")

        # 找平台单号输入框：优先 placeholder 含 平台；再按 name 猜
        target = None
        for info in inputs:
            if info["placeholder"] and "平台" in info["placeholder"]:
                target = info["i"]; break
        if target is None:
            for info in inputs:
                for key in (info["name"] or "", info["id"] or "", info["placeholder"] or ""):
                    if "platform" in key.lower() or "平台" in key:
                        target = info["i"]; break
                if target is not None: break
        print("[平台单号框 index]", target, flush=True)
        if target is not None:
            el = loc.nth(target)
            el.fill(ORDER)
            el.press("Enter")
            time.sleep(6)
        t = frame.locator("body").inner_text(timeout=20000)
        (out_dir / "frame-搜索后.txt").write_text(t, encoding="utf-8")
        print("[搜索后 frame 含单号]", ORDER in t, flush=True)
        print(t[:1200], flush=True)

        # 双击行
        try:
            row = frame.locator(f"text={ORDER}")
            print("[行元素数]", row.count(), flush=True)
            if row.count():
                row.first.dblclick(timeout=8000)
                time.sleep(8)
        except Exception as e:
            print("[双击失败]", e, flush=True)
        # dump pages
        for p in ctx.pages:
            try:
                t2 = p.locator("body").inner_text(timeout=8000)
            except Exception as e:
                t2 = f"<err {e}>"
            (out_dir / f"after-pages-{p.url.split('/')[-1][:30] or 'x'}.txt").write_text(t2, encoding="utf-8")
            print("== page", p.url[:120], "==", flush=True)
            print(t2[:1500], flush=True)
        (out_dir / "net5.json").write_text(json.dumps(captured, ensure_ascii=False, indent=2), encoding="utf-8")
        print("[net] 条数", len(captured), flush=True)
        for e in captured:
            print("  -", e["method"], e["url"][:130], e.get("status"), (e.get("post") or "")[:160], flush=True)
        ctx.close()

if __name__ == "__main__":
    main()
