#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import unittest

from web_frontend_harness import run_frontend_assertions


class WebControlBuyerUrlFrontendTests(unittest.TestCase):
    def test_buyer_url_dialog_saves_selected_and_note_only_entries(self) -> None:
        # 该测试只验证买家咨询链接弹窗的新增、选择和草稿保存。
        run_frontend_assertions(self, r"""

context.renderForm({ ...stateSnapshot.form, jd_url: "https://shop-b.example", jd_urls: "https://shop-a.example\nhttps://shop-b.example", jd_url_options: ["https://shop-a.example", "https://shop-b.example"], jd_url_entries: [{ url: "https://shop-a.example", note: "A店" }, { url: "https://shop-b.example", note: "B店" }] });
const configForm = elements.get("configForm");
const managerButton = configForm.children[1].children[1].children[1];
managerButton.click();
elements.get("buyerUrlAddButton").click();
const buyerUrlList = elements.get("buyerUrlList");
buyerUrlList.children[2].children[1].input("C店");
buyerUrlList.children[2].children[2].input("https://shop-c.example");
let savedPayload = null;
let savedBuyerPayload = null;
context.fetch = async (url, options = {}) => { fetchCalls.push(String(url)); if (url === "/api/config/save-buyer-urls") { savedBuyerPayload = JSON.parse(options.body); return makeResponse({ ok: true, message: "买家咨询店铺信息已保存", form: { ...stateSnapshot.form, ...savedBuyerPayload, jd_url_options: savedBuyerPayload.jd_urls ? savedBuyerPayload.jd_urls.split("\n") : [], jd_url_entries: savedBuyerPayload.jd_url_entries } }); } if (url === "/api/config/save") { savedPayload = JSON.parse(options.body); return makeResponse({ ok: true, message: "配置已保存", form: { ...stateSnapshot.form, ...savedPayload, jd_url_options: savedPayload.jd_urls.split("\n"), jd_url_entries: savedPayload.jd_url_entries } }); } return makeResponse({ ok: true, message: "成功" }); };
fetchCalls.length = 0;
await elements.get("buyerUrlCloseButton").click();
assert.deepEqual(fetchCalls, ["/api/config/save-buyer-urls"]);
assert.equal(savedBuyerPayload.jd_url, "https://shop-c.example");
assert.equal(savedBuyerPayload.jd_url_entries[2].note, "C店");
fetchCalls.length = 0;
await elements.get("saveButton").click();
assert.deepEqual(fetchCalls, ["/api/config/save"]);
assert.equal(savedPayload.jd_url, "https://shop-c.example");
assert.equal(savedPayload.jd_url_entries[2].note, "C店");
assert.equal(savedPayload.jd_urls, "https://shop-a.example\nhttps://shop-b.example\nhttps://shop-c.example");
context.renderForm({ ...stateSnapshot.form, ...savedPayload, jd_url_options: savedPayload.jd_urls.split("\n"), jd_url_entries: savedPayload.jd_url_entries });
const configFormAfterSave = elements.get("configForm");
const managerButtonAfterSave = configFormAfterSave.children[1].children[1].children[1];
managerButtonAfterSave.click();
elements.get("buyerUrlAddButton").click();
const buyerUrlListAfterSave = elements.get("buyerUrlList");
buyerUrlListAfterSave.children[3].children[1].input("待补网址店");
savedBuyerPayload = null;
fetchCalls.length = 0;
await elements.get("buyerUrlCloseButton").click();
assert.deepEqual(fetchCalls, ["/api/config/save-buyer-urls"]);
assert.equal(savedBuyerPayload.jd_url, "https://shop-c.example");
assert.equal(savedBuyerPayload.jd_url_entries[3].note, "待补网址店");
assert.equal(savedBuyerPayload.jd_url_entries[3].url, "");
context.renderForm({ ...stateSnapshot.form, ...savedBuyerPayload, jd_url_options: savedBuyerPayload.jd_urls.split("\n"), jd_url_entries: savedBuyerPayload.jd_url_entries });
savedPayload = null;
fetchCalls.length = 0;
await elements.get("saveButton").click();
assert.deepEqual(fetchCalls, ["/api/config/save"]);
assert.equal(savedPayload.jd_url, "https://shop-c.example");
assert.equal(savedPayload.jd_url_entries[3].note, "待补网址店");
assert.equal(savedPayload.jd_url_entries[3].url, "");
assert.equal(savedPayload.jd_urls, "https://shop-a.example\nhttps://shop-b.example\nhttps://shop-c.example");
""")


if __name__ == "__main__":
    unittest.main()
