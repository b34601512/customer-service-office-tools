#!/usr/bin/env node
/**
 * 冒烟测试 —— 离线跑，不联网、不烧额度。
 *
 * 用「假 CLI」探针（环境变量 CODEBUDDY_CLI 指过去）验证 派活.cjs 的关键行为，
 * 覆盖 2026-10-16 复核发现的 4 处问题（已修，此测试锁死防回退）：
 *   1) 带空格的任务原样作为「一个参数」传给 CLI（Windows 上尤其易踩：经 shell 拼串会拆词）
 *   2) 数组 / 单对象 两种 JSON 输出都能解析
 *   3) [message, result] 同现时 message 覆盖文本（README 约定优先级）
 *   4) 额度报错（is_error 的 result 文本里）归退出码 2
 *   5) 找 CLI：npm 全局布局里有诱饵可执行文件（cbc-prewarm 等）时也要选中真入口
 *   6) 参数边界：缺任务描述 → 退出码 5
 *
 * 用法：node 测试/冒烟测试.mjs        退出码 0＝全过，1＝有失败
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const 测试目录 = path.dirname(fileURLToPath(import.meta.url));
const 包目录 = path.resolve(测试目录, "..");
const 派活 = path.join(包目录, "工具", "派活.cjs");

// ---------- 搭「假 CLI」探针 ----------
const 临时 = fs.mkdtempSync(path.join(os.tmpdir(), "cb-pi-smoke-"));
const 假CLI = path.join(临时, "fake-codebuddy.js");
const argv记录 = path.join(临时, "argv.jsonl");
const 日志文件 = path.join(临时, "派活日志.jsonl");

fs.writeFileSync(假CLI, `"use strict";
const fs = require("fs");
const 模式 = process.env.FAKE_MODE || "数组成功";
fs.appendFileSync(${JSON.stringify(argv记录)}, JSON.stringify(process.argv) + "\\n");
if (模式 === "数组成功") {
  process.stdout.write(JSON.stringify([{ type: "result", result: "array-form-reply", is_error: false, usage: { credit: 0.1 } }]));
} else if (模式 === "单对象成功") {
  process.stdout.write(JSON.stringify({ type: "result", result: "object-form-reply", is_error: false }));
} else if (模式 === "额度is_error") {
  process.stdout.write(JSON.stringify([{ type: "result", result: "Insufficient credit, quota exceeded", is_error: true }]));
} else if (模式 === "消息后置result") {
  process.stdout.write(JSON.stringify([
    { type: "message", role: "assistant", content: [{ type: "text", text: "msg-text" }] },
    { type: "result", result: "res-text", is_error: false },
  ]));
}
process.exit(0);
`, "utf8");

// ---------- 断言工具 ----------
let 过 = 0, 总数 = 0;
function 断言(名, 条件, 备注 = "") {
  总数++;
  if (条件) { 过++; console.log("  ✓ " + 名 + (备注 ? "　（" + 备注 + "）" : "")); }
  else console.log("  ✗ " + 名 + (备注 ? "　（" + 备注 + "）" : ""));
}

function 跑派活(任务, 模式, 额外 = []) {
  return spawnSync(process.execPath, [派活, 任务, "--工作目录", 临时, ...额外], {
    env: { ...process.env, CODEBUDDY_CLI: 假CLI, CODEBUDDY_LOG: 日志文件, FAKE_MODE: 模式 },
    encoding: "utf8",
  });
}

function 取最后一条argv() {
  const 行 = fs.readFileSync(argv记录, "utf8").trim().split("\n");
  return JSON.parse(行[行.length - 1]);
}

try {
  console.log("冒烟测试：派活.cjs（离线·假 CLI 探针）");

  // 0) 参数边界：缺任务描述 → 5
  {
    const r = spawnSync(process.execPath, [派活], {
      env: { ...process.env, CODEBUDDY_CLI: 假CLI, CODEBUDDY_LOG: 日志文件 },
      encoding: "utf8",
    });
    断言("缺任务描述 → 退出码 5", r.status === 5, "实得 " + r.status);
  }

  // 1) 带空格的任务：不被拆词 ＋ 数组形态成功
  {
    fs.rmSync(argv记录, { force: true });
    const 任务 = "统计 当前 目录 md 文件的字数";
    const r = 跑派活(任务, "数组成功");
    const argv = 取最后一条argv();
    断言("带空格任务 → 退出码 0", r.status === 0, "实得 " + r.status);
    断言("带空格任务 → 原样单参数到达 CLI（不拆词）", argv[3] === 任务, "CLI 实收 " + JSON.stringify(argv[3]));
    断言("数组形态 → stdout＝结果文本", String(r.stdout || "").includes("array-form-reply"));
  }

  // 2) 单对象 JSON 也能解析（README/清单声称「两形态都能解」）
  {
    const r = 跑派活("测试单对象", "单对象成功");
    断言("单对象 JSON → 退出码 0＋文本", r.status === 0 && String(r.stdout || "").includes("object-form-reply"), "实得 exit " + r.status);
  }

  // 3) [message, result] 同现：message 覆盖文本（README 约定）
  {
    const r = 跑派活("测试优先级", "消息后置result");
    断言("[message,result] → message 覆盖文本", r.status === 0 && String(r.stdout || "").trim() === "msg-text", "实得 " + JSON.stringify(String(r.stdout || "").trim()));
  }

  // 4) 额度报错（is_error 的 result 文本）→ 2
  {
    const r = 跑派活("测试额度", "额度is_error");
    断言("额度 is_error → 退出码 2", r.status === 2, "实得 " + r.status);
  }

  // 5) 找 CLI：npm 全局布局（含诱饵可执行文件）→ 选真入口 ＋ 空格不拆
  {
    const 假应用 = path.join(临时, "apt");   // Windows：APPDATA 根
    const 假家 = path.join(临时, "home");    // 类 Unix：HOME 根
    const 造布局 = (根) => {
      const 包根 = path.join(根, "@tencent-ai", "codebuddy-code");
      const bin目录 = path.join(包根, "bin");
      fs.mkdirSync(bin目录, { recursive: true });
      // 诱饵：与 codebuddy 同样无扩展名、字母序在前（复现 2026-10-16 真连踩过的坑）
      fs.writeFileSync(path.join(bin目录, "cbc-prewarm"), "process.stderr.write('wrong entry\\n'); process.exit(3);\n", "utf8");
      fs.copyFileSync(假CLI, path.join(bin目录, "codebuddy"));
      fs.writeFileSync(path.join(包根, "package.json"), JSON.stringify({
        name: "@tencent-ai/codebuddy-code",
        bin: { "codebuddy": "./bin/codebuddy", "cbc": "./bin/codebuddy", "cbc-prewarm": "./bin/cbc-prewarm" },
      }), "utf8");
    };
    造布局(path.join(假应用, "npm", "node_modules"));
    造布局(path.join(假家, ".npm-global", "lib", "node_modules"));

    fs.rmSync(argv记录, { force: true });
    const 任务 = "空格 任务 也要 原样到达";
    const env = { ...process.env, CODEBUDDY_LOG: 日志文件, FAKE_MODE: "数组成功", APPDATA: 假应用, HOME: 假家 };
    delete env.CODEBUDDY_CLI;
    const r = spawnSync(process.execPath, [派活, 任务, "--工作目录", 临时], { env, encoding: "utf8" });
    const argv = 取最后一条argv();
    断言("npm 全局布局（带诱饵）→ 选中真入口 exit 0", r.status === 0, "实得 " + r.status + (r.stderr ? "｜" + String(r.stderr).slice(0, 80) : ""));
    断言("npm 全局布局 → 空格任务原样单参数", argv[3] === 任务, "CLI 实收 " + JSON.stringify(argv[3]));
  }

  console.log(`\n结果：${过}/${总数} 过`);
  process.exitCode = 过 === 总数 ? 0 : 1;
} finally {
  fs.rmSync(临时, { recursive: true, force: true });
}
