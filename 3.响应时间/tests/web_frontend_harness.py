#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import shutil
import subprocess
import textwrap
import unittest
from pathlib import Path

_BASE_SCRIPT = r'''
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const indexHtml = fs.readFileSync("clipboard_relay/web_control/web/index.html", "utf8");
const scriptSources = Array.from(indexHtml.matchAll(/<script src="([^"]+)"/g)).map((match) => match[1]);
const appSources = scriptSources.map((src) => {
  const relativePath = src === "/app.js" ? "app.js" : src.replace(/^\//, "");
  return { src, source: fs.readFileSync(`clipboard_relay/web_control/web/${relativePath}`, "utf8") };
});

class FakeElement {
  constructor(tagName = "div", id = "") {
    this.tagName = tagName;
    this.id = id;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.listeners = {};
    this.disabled = false;
    this.type = "";
    this.name = "";
    this.value = "";
    this.checked = false;
    this.textContent = "";
    this._innerHTML = "";
    this.className = "";
    this.classList = {
      add: (...names) => {
        const current = new Set(String(this.className || "").split(/\s+/).filter(Boolean));
        names.forEach((name) => current.add(name));
        this.className = Array.from(current).join(" ");
      },
      remove: (...names) => {
        const removeSet = new Set(names);
        this.className = String(this.className || "")
          .split(/\s+/)
          .filter((name) => name && !removeSet.has(name))
          .join(" ");
      },
      toggle: (name, enabled) => {
        if (enabled) this.classList.add(name);
        else this.classList.remove(name);
      },
    };
  }

  set innerHTML(value) {
    this._innerHTML = String(value || "");
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  click() {
    if (this.disabled) return undefined;
    return this.listeners.click?.({ currentTarget: this });
  }

  input(value) {
    this.value = value;
    return this.listeners.input?.({ currentTarget: this });
  }

  getBoundingClientRect() {
    return { left: 0, right: 100, bottom: 40, width: 100, height: 40 };
  }

  querySelector(selector) {
    const match = selector.match(/\[name="([^"]+)"\]/);
    if (!match) return null;
    return findByName(this, match[1]);
  }
}

function findByName(element, name) {
  if (element.name === name) return element;
  for (const child of element.children) {
    const found = findByName(child, name);
    if (found) return found;
  }
  return null;
}

function makeResponse(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => payload,
  };
}

const elements = new Map();
const appMetaBar = new FakeElement("div", "appMetaBar");
appMetaBar.dataset.showUsageHistory = "true";
elements.set("appMetaBar", appMetaBar);
const document = {
  title: "",
  body: new FakeElement("body", "body"),
  getElementById: (id) => {
    if (!elements.has(id)) elements.set(id, new FakeElement("div", id));
    return elements.get(id);
  },
  createElement: (tagName) => new FakeElement(tagName),
};

const stateSnapshot = {
  appMetadata: {
    appName: "响应时间",
    version: "test",
    usageHistory: { previousUsedDateText: "2026年05月13日", currentUsedDateText: "2026年05月14日" },
  },
  form: {
    service_url: "", jd_url: "", jd_urls: "", jd_url_options: [], jd_url_entries: [], service_keywords: "", web_keywords: "",
    service_ratio: "", web_ratio: "", service_delay: "", service_random_delay: "",
    web_delay: "", web_random_delay: "", rounds: "1", login_timeout: "1",
    service_username: "", service_password: "", web_username: "", web_password: "",
    service_credential_entries: [], web_credential_entries: [],
    work_rest: "", emoji_probability: "", emoji_count_range: "", browser_executable: "",
  },
  runtime: {
    statusText: "待命｜总工作任务 0/500",
    statusPhase: "待命",
    ready: false,
    loginRunning: false,
    indicators: {
      service: { title: "咚咚客服端", state: "idle", detail: "" },
      web: { title: "买家客户端", state: "idle", detail: "" },
      browser: { title: "浏览器控制", state: "idle", detail: "" },
      main: { title: "主流程", state: "idle", detail: "" },
    },
    logLines: [],
  },
};

const fetchCalls = [];
const context = {
  console,
  document,
  window: {},
  setTimeout,
  fetch: async (url) => {
    fetchCalls.push(String(url));
    if (url === "/api/state") return makeResponse(stateSnapshot);
    return makeResponse({ ok: true, message: "成功" });
  },
  EventSource: class {
    addEventListener() {}
  },
};
context.window.close = () => {};
context.window.latestRuntime = {};
vm.createContext(context);
for (const item of appSources) {
  vm.runInContext(item.source, context, { filename: item.src });
}
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
'''


def run_frontend_assertions(test_case: unittest.TestCase, assertion_script: str) -> None:
    # 该函数用于在 Node 里加载真实前端脚本，并执行单个场景断言。
    node = shutil.which("node")
    if node is None:
        test_case.skipTest("当前环境未安装 Node.js，跳过前端行为测试。")
    script = textwrap.dedent(_BASE_SCRIPT + "\n" + assertion_script)
    result = subprocess.run(
        [node, "--input-type=module"],
        input=script,
        text=True,
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        timeout=20,
        encoding="utf-8",
        check=False,
    )
    test_case.assertEqual(result.returncode, 0, result.stderr)
