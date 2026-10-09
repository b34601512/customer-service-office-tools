# -*- coding: utf-8 -*-
# 一次性只读探针6：定位平台单号输入框 → 搜索 → 双击行开详情（用完即删）。
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

def open_order_query(page):
    item = _find_first_visible_text_locator(page, "订单查询")
    if item is None:
        mb = _find_first_visible_text_locator(page, "菜单")
        if mb: mb.click(); time.sleep(1)
        si = _find_menu_search_input(page)
        if si:
            si.fill("订单查询"); time.sleep(1.5)
            item = _find_first_visible_text_locator(page, "订单查询")
    if item: item.click()

def find_frame(page, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        for f in page.frames:
            if "trade_order_header" in f.url and "bodyguard" not in f.url:
                return f
        time.sleep(0.5)
    return None

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
                        if req.post_data and len(req.post_data) < 6000: e["post"] = req.post_data[:6000]
                    except Exception: pass
                    ct = (resp.headers or {}).get("content-type","")
                    if "json" in ct:
                        try: e["body"] = resp.text()[:8000]
                        except Exception as ex: e["bodyErr"] = str(ex)
                    captured.append(e)
            except Exception: pass
        page.on("response", on_response)
        ensure_erp_login(page, creds, lambda m: print("[需要人工]", m, flush=True))
        time.sleep(2)
        open_order_query(page)
        frame = find_frame(page)
        if frame is None:
            open_order_query(page)
            frame = find_frame(page)
        assert frame, "没找到订单查询 frame"
        time.sleep(3)

        # 映射标签 → 输入框
        mapping = frame.evaluate("""() => {
            const out = [];
            const inputs = Array.from(document.querySelectorAll('input'));
            inputs.forEach((el, i) => {
                if (!el.offsetParent) return;
                if (el.type !== 'text' && el.type !== 'search') return;
                let label = '';
                let node = el;
                for (let depth = 0; depth < 6 && node; depth += 1) {
                    node = node.parentElement;
                    if (!node) break;
                    const t = (node.innerText || '').trim();
                    if (t && t.length <= 20 && t.indexOf(String.fromCharCode(10)) < 0) { label = t; break; }
                }
                out.push({ i, type: el.type, placeholder: el.placeholder || '', label });
            });
            return out;
        }""")
        print("[标签映射]", json.dumps(mapping, ensure_ascii=False), flush=True)
        (out_dir / "frame-labels.json").write_text(json.dumps(mapping, ensure_ascii=False, indent=1), encoding="utf-8")

        # 找「平台单号」输入框（按可见文本排序：订单编号 / 平台单号 / 物流单号 / 主播名称）
        texts = frame.locator("input.ant-input-sm")
        n = texts.count()
        platform_idx = None
        # 用文档顺序：第 2 个空 label 的文本输入通常是 平台单号（按页面列序）
        cand = [m for m in mapping if m["type"] in ("text", "search") and not m["label"]]
        print("[候选空标签输入]", json.dumps(cand, ensure_ascii=False), flush=True)
        # 按标签匹配「平台单号」
        for m in mapping:
            if m["label"] == "平台单号":
                platform_idx = m["i"]
                break
        print("[平台单号 index]", platform_idx, flush=True)

        if platform_idx is not None:
            el = frame.locator("input").nth(platform_idx)
            el.fill(ORDER)
            el.press("Enter")
            print("[已填] ", ORDER, flush=True)
            time.sleep(7)
        t = frame.locator("body").inner_text(timeout=20000)
        (out_dir / "frame6-搜索后.txt").write_text(t, encoding="utf-8")
        print("[搜索后含单号]", ORDER in t, flush=True)

        # 找行双击：ag-grid row 含单号
        row = frame.locator(f".ag-row:has-text('{ORDER}')")
        print("[ag-row 命中]", row.count(), flush=True)
        if row.count():
            row.first.dblclick(timeout=8000)
        else:
            cell = frame.locator(f"text={ORDER}")
            print("[text 命中]", cell.count(), flush=True)
            if cell.count():
                cell.first.dblclick(timeout=8000)
        time.sleep(8)

        pages = [p for p in ctx.pages]
        print("[页面数]", len(pages), flush=True)
        for p in pages:
            try: t2 = p.locator("body").inner_text(timeout=8000)
            except Exception as e: t2 = f"<err {e}>"
            name = "page-" + (p.url.split("/")[-1][:40] or "root").replace("?", "_")
            (out_dir / f"{name}.txt").write_text(t2, encoding="utf-8")
            print("== page:", p.url[:150], flush=True)
            print(t2[:800], flush=True)
        for f in page.frames:
            if "trade_order_header" in f.url:
                try: tf = f.locator("body").inner_text(timeout=8000)
                except Exception: tf = ""
                (out_dir / "frame6-详情后.txt").write_text(tf, encoding="utf-8")
                print("== frame 详情后前600", tf[:600], flush=True)
        (out_dir / "net6.json").write_text(json.dumps(captured, ensure_ascii=False, indent=2), encoding="utf-8")
        print("[net]", len(captured), flush=True)
        for e in captured[-10:]:
            print("  -", e["method"], e["url"][:130], e.get("status"), (e.get("post") or "")[:200], flush=True)
        ctx.close()

if __name__ == "__main__":
    main()
