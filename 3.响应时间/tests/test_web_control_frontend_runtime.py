#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import unittest

from web_frontend_harness import run_frontend_assertions


class WebControlRuntimeFrontendTests(unittest.TestCase):
    def test_runtime_buttons_and_login_locks_follow_state(self) -> None:
        # 该测试只验证运行态按钮、流程树和登录按钮防连点。
        run_frontend_assertions(self, r"""

assert.equal(appMetaBar.children.length, 2);
assert.equal(appMetaBar.children[0].textContent, "版本：vtest");
assert.equal(appMetaBar.children[1].textContent, "上次使用：2026年05月13日");
assert.equal(appMetaBar.children[1].title, "本次打开：2026年05月14日");
const workflowGrid = elements.get("workflowGrid");
const workflowHeader = workflowGrid.children[0];
const workflowTree = workflowGrid.children[1];
assert.equal(workflowHeader.innerHTML.includes("workflow-status-text"), false);
assert.equal(workflowHeader.innerHTML.includes("总工作任务"), false);
assert.equal(workflowTree.children[5].innerHTML.includes("总工作任务 0/500"), true);
const startButton = elements.get("startButton");
const pauseButton = elements.get("pauseButton");
const stopButton = elements.get("stopButton");
assert.equal(startButton.disabled, true);
assert.equal(startButton.className.includes("primary"), false);
assert.equal(pauseButton.disabled, true);
assert.equal(stopButton.disabled, true);
fetchCalls.length = 0;
await startButton.click();
await pauseButton.click();
await stopButton.click();
assert.deepEqual(fetchCalls, []);
context.renderRuntime({ ...stateSnapshot.runtime, ready: true, indicators: { ...stateSnapshot.runtime.indicators, service: { title: "咚咚客服端", state: "ok", detail: "" }, web: { title: "买家客户端", state: "ok", detail: "" }, browser: { title: "浏览器控制", state: "ok", detail: "" } } });
assert.equal(startButton.disabled, false, "start enabled after both login targets are ok");
assert.equal(startButton.className.includes("primary"), true);
assert.equal(pauseButton.disabled, true);
assert.equal(stopButton.disabled, true);
const indicatorRow = elements.get("indicatorRow");
assert.equal(indicatorRow.children.length, 4);
assert.equal(indicatorRow.children[0].disabled, false, "service ok button stays clickable for reopening");
assert.equal(indicatorRow.children[1].disabled, false, "web ok button stays clickable for reopening");
context.renderRuntime({ ...stateSnapshot.runtime, statusPhase: "工作中" });
assert.equal(pauseButton.disabled, false, "pause enabled while main flow is working");
assert.equal(stopButton.disabled, false, "stop enabled while main flow is working");
context.renderRuntime(stateSnapshot.runtime);
const firstServiceButton = indicatorRow.children[0];
let releaseConfigSave = null;
context.fetch = async (url) => { fetchCalls.push(String(url)); if (url === "/api/config/save") { return new Promise((resolve) => { releaseConfigSave = () => resolve(makeResponse({ ok: true, message: "配置已保存" })); }); } return makeResponse({ ok: true, message: "成功" }); };
fetchCalls.length = 0;
const pendingClick = firstServiceButton.click();
firstServiceButton.click();
assert.deepEqual(fetchCalls, ["/api/config/save"]);
assert.equal(indicatorRow.children[0].disabled, true);
assert.equal(indicatorRow.children[0].dataset.locked, "true");
context.renderRuntime(stateSnapshot.runtime);
assert.equal(indicatorRow.children[0].disabled, true);
releaseConfigSave();
await pendingClick;
context.fetch = async (url) => { fetchCalls.push(String(url)); if (url === "/api/config/save") return makeResponse({ ok: true, message: "配置已保存" }); return makeResponse({ ok: false, message: "打开失败" }, false, 500); };
context.renderRuntime({ ...stateSnapshot.runtime, indicators: { ...stateSnapshot.runtime.indicators, service: { title: "咚咚客服端", state: "warning", detail: "" } } });
fetchCalls.length = 0;
await indicatorRow.children[0].click();
assert.deepEqual(fetchCalls, ["/api/config/save", "/api/login/open-target"]);
assert.equal(indicatorRow.children[0].disabled, false, "login button unlocks after open failure");
assert.equal(indicatorRow.children[0].dataset.locked, "false");
context.renderRuntime({ ...stateSnapshot.runtime, indicators: { ...stateSnapshot.runtime.indicators, service: { title: "咚咚客服端", state: "running", detail: "" }, web: { title: "买家客户端", state: "ok", detail: "" } } });
assert.equal(indicatorRow.children[0].disabled, true);
assert.equal(indicatorRow.children[1].disabled, false, "ok login button can be clicked again to reopen");
""")


if __name__ == "__main__":
    unittest.main()
