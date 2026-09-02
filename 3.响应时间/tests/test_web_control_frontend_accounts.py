#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import unittest

from web_frontend_harness import run_frontend_assertions


class WebControlCredentialFrontendTests(unittest.TestCase):
    def test_credential_dialog_updates_selected_account_and_exit_saves_form(self) -> None:
        # 该测试只验证账号弹窗保存和退出前配置保存。
        run_frontend_assertions(self, r"""

const buyerPayload = { jd_url: "https://shop-c.example", jd_urls: "https://shop-a.example\nhttps://shop-b.example\nhttps://shop-c.example", jd_url_options: ["https://shop-a.example", "https://shop-b.example", "https://shop-c.example"], jd_url_entries: [{ url: "https://shop-a.example", note: "A店" }, { url: "https://shop-b.example", note: "B店" }, { url: "https://shop-c.example", note: "C店" }, { url: "", note: "待补网址店" }] };
context.renderForm({ ...stateSnapshot.form, ...buyerPayload, service_username: "service-a", service_password: "pwd-a", service_credential_entries: [{ username: "service-a", password: "pwd-a", note: "A店" }] });
const credentialForm = elements.get("configForm");
const credentialManagerButton = credentialForm.children[12].children[1].children[1];
credentialManagerButton.click();
elements.get("credentialAddButton").click();
const credentialList = elements.get("credentialList");
credentialList.children[1].children[1].input("B店");
credentialList.children[1].children[2].input("service-b");
credentialList.children[1].children[3].input("pwd-b");
let savedPayload = null;
let savedCredentialPayload = null;
context.fetch = async (url, options = {}) => { fetchCalls.push(String(url)); if (url === "/api/config/save-credentials") { savedCredentialPayload = JSON.parse(options.body); return makeResponse({ ok: true, message: "网页登录账号信息已保存", form: { ...stateSnapshot.form, ...buyerPayload, ...savedCredentialPayload } }); } if (url === "/api/config/save") { savedPayload = JSON.parse(options.body); return makeResponse({ ok: true, message: "配置已保存", form: { ...stateSnapshot.form, ...savedPayload } }); } if (url === "/api/control/exit") return makeResponse({ ok: true, message: "后台正在退出" }); return makeResponse({ ok: true, message: "成功" }); };
fetchCalls.length = 0;
await elements.get("credentialCloseButton").click();
assert.deepEqual(fetchCalls, ["/api/config/save-credentials"]);
assert.equal(savedCredentialPayload.service_username, "service-b");
assert.equal(savedCredentialPayload.service_credential_entries[1].note, "B店");
savedPayload = null;
fetchCalls.length = 0;
await elements.get("saveButton").click();
assert.deepEqual(fetchCalls, ["/api/config/save"]);
assert.equal(savedPayload.service_username, "service-b");
assert.equal(savedPayload.service_credential_entries[1].password, "pwd-b");
assert.equal(savedPayload.jd_url_entries[3].note, "待补网址店");
savedPayload = null;
fetchCalls.length = 0;
await elements.get("exitButton").click();
assert.deepEqual(fetchCalls, ["/api/config/save", "/api/control/exit"]);
assert.equal(savedPayload.jd_url_entries[3].note, "待补网址店");
""")


if __name__ == "__main__":
    unittest.main()
