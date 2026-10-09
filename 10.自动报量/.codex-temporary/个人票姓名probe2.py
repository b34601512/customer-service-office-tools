# -*- coding: utf-8 -*-
# 一次性只读探针2：试 desentizationDataView / 详情接口（用完即删）。
import json, sys
from pathlib import Path

CLI = Path(r"D:\桌面\办公软件\10.自动报量\自动报量CLI")
sys.path.insert(0, str(CLI))
from auto_report_erp import (  # noqa: E402
    build_erp_browser_launch_options, locate_installed_chromium_browser, ensure_erp_login,
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
    rows = json.loads((out_dir / "erp-rows.json").read_text(encoding="utf-8"))
    target = [r for r in rows if r.get("receiverNameEncrypt")][0]
    enc_name = target["receiverNameEncrypt"]
    enc_mobile = target["receiverMobileEncrypt"]
    enc_addr = target["receiverAddressEncrypt"]

    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(
            **build_erp_browser_launch_options(
                browser_profile_directory=paths.erp_browser_profile_directory,
                browser_executable_path=exe,
                download_directory=out_dir,
            )
        )
        page = next((p for p in ctx.pages if not p.is_closed()), None) or ctx.new_page()
        ensure_erp_login(page, creds, lambda m: print("[需要人工]", m, flush=True))
        print("[登录] ", page.url, flush=True)

        def call(method, url, body=None, json_body=None):
            return page.evaluate("""async ([method, url, body, jsonBody]) => {
                try {
                    const opt = { method, headers: {} };
                    if (jsonBody !== null) { opt.headers['Content-Type'] = 'application/json'; opt.body = jsonBody; }
                    else if (body !== null) { opt.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'; opt.body = body; }
                    const r = await fetch(url, opt);
                    const t = await r.text();
                    return { status: r.status, ctype: r.headers.get('content-type'), body: t.slice(0, 2000) };
                } catch (e) { return { error: String(e) }; }
            }""", [method, url, body, json_body])

        variants = [
            ("POST", "/tc/trade/trade_order_header/desentizationDataView",
             "pageCode=trade_order_header&data=" + json.dumps({"receiverNameEncrypt": enc_name}, ensure_ascii=False)),
            ("POST", "/tc/trade/trade_order_header/desentizationDataView",
             "pageCode=tradeOrderHeader&data=" + json.dumps({"receiverNameEncrypt": enc_name}, ensure_ascii=False)),
            ("POST", "/tc/trade/trade_order_header/desentizationDataView",
             "data=" + json.dumps({"receiverNameEncrypt": enc_name, "receiverMobileEncrypt": enc_mobile, "receiverAddressEncrypt": enc_addr}, ensure_ascii=False)),
            ("POST", "/tc/trade/trade_order_header/desentizationDataView",
             json.dumps({"pageCode": "trade_order_header", "data": {"receiverNameEncrypt": enc_name}}, ensure_ascii=False)),
            ("POST", "/tc/trade/trade_order_header/desentizationDataView", "pageCode=trade_order_header"),
            ("POST", "/tc/trade/trade_order_header/detail", "code=SO689675869360"),
            ("GET", "/tc/trade/trade_order_header/view?id=" + str(target.get("id") or ""), None),
            ("GET", "/tc/trade/trade_order_header/detail?id=" + str(target.get("id") or ""), None),
            ("POST", "/tc/trade/trade_order_header/data/view", "id=" + str(target.get("id") or "")),
        ]
        for i, (m, u, b) in enumerate(variants):
            if isinstance(b, str) and b.startswith("{"):
                r = call(m, u, None, b)
            else:
                r = call(m, u, b)
            print(f"--- [{i}] {m} {u}", flush=True)
            print("    body:", (b or "")[:160], flush=True)
            print("    =>", json.dumps(r, ensure_ascii=False)[:800], flush=True)
        ctx.close()

if __name__ == "__main__":
    main()
