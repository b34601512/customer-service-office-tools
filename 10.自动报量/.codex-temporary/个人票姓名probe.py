# -*- coding: utf-8 -*-
# 一次性只读探针：查 ERP 订单详情里收货人是否给全名（用完即删）。
import json, sys
from pathlib import Path

CLI = Path(r"D:\桌面\办公软件\10.自动报量\自动报量CLI")
sys.path.insert(0, str(CLI))

from auto_report_erp import (  # noqa: E402
    build_erp_browser_launch_options,
    locate_installed_chromium_browser,
    ensure_erp_login,
)
from auto_report_credentials import load_erp_credentials  # noqa: E402
from auto_report_paths import AutoReportPaths  # noqa: E402

ROOT = Path(r"D:\桌面\办公软件\10.自动报量")
paths = AutoReportPaths.from_project_root(ROOT)
creds = load_erp_credentials(paths.erp_credentials_path)
assert creds, "没读到 ERP 账号"
out_dir = ROOT / ".codex-temporary"
out_dir.mkdir(exist_ok=True)

ORDER = "240103-***********1794"
ORDER2 = "SO689675869360"

def main():
    from playwright.sync_api import sync_playwright
    exe = locate_installed_chromium_browser()
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(
            **build_erp_browser_launch_options(
                browser_profile_directory=paths.erp_browser_profile_directory,
                browser_executable_path=exe,
                download_directory=out_dir,
            )
        )
        page = None
        for p in ctx.pages:
            if not p.is_closed():
                page = p
                break
        if page is None:
            page = ctx.new_page()
        def manual(msg):
            print("[需要人工]", msg, flush=True)
        ensure_erp_login(page, creds, manual)
        print("[登录] 页面：", page.url, flush=True)

        def fetch_list(date_type):
            payload = ("page=1&limit=200&start=0&dateType=%d"
                       "&platformCode=%s&separatorPlatform=3"
                       "&hasInvoice=&refund=&approve=&financeReject=&cancel=&hold=") % (date_type, ORDER)
            return page.evaluate("""async (body) => {
                const r = await fetch('/tc/trade/trade_order_header/data/list', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'},
                    body
                });
                const t = await r.text();
                try { return JSON.parse(t); } catch (e) { return { parseError: String(e), raw: t.slice(0, 300) }; }
            }""", payload)

        all_rows = []
        for dt in (0, 1, 2):
            res = fetch_list(dt)
            rows = res.get("rows") or []
            print(f"[列表] dateType={dt} total={res.get('total')} rows={len(rows)}", flush=True)
            all_rows.extend(rows)
        # 去重
        seen = {}
        for r in all_rows:
            key = r.get("code") or r.get("id")
            if key and key not in seen:
                seen[key] = r
        rows = list(seen.values())
        (out_dir / "erp-rows.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")

        # 列出收货人相关字段
        for r in rows:
            print("== ERP单:", r.get("code"), "platformCode:", r.get("platformCode"))
            for k, v in r.items():
                kl = k.lower()
                if any(x in kl for x in ("receiv", "receiver", "consign", "contact", "mobile", "tele", "phone", "address", "name", "encrypt", "desen", "crypt", "mask")):
                    print("   ", k, "=", repr(v)[:160])

if __name__ == "__main__":
    main()
