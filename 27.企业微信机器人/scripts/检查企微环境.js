#!/usr/bin/env node
/**
 * 27号 企业微信 × AI 环境体检（只读）
 *
 * 用法：
 *   node scripts/检查企微环境.js
 *
 * 检查项：Node 版本 / wecom-unified Skill / @wecom/cli 版本 / 授权状态 / 群机器人 webhook 配置。
 * 本脚本只读：不发消息、不发起授权、不改任何配置。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const MIN_NODE_MAJOR = 18;
const MIN_CLI_VERSION = "1.2.1";

function parseVersion(text) {
  const match = String(text || "").match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isVersionAtLeast(actual, required) {
  const left = parseVersion(actual);
  const right = parseVersion(required);
  if (!left || !right) return false;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] > right[i]) return true;
    if (left[i] < right[i]) return false;
  }
  return true;
}

function parseAuthStatus(text) {
  const value = String(text || "").trim().toLowerCase();
  if (!value) return "unknown";
  if (value.includes("unauthorized")) return "unauthorized";
  if (value.includes("authorized")) return "authorized";
  return "unknown";
}

function run(command) {
  const result = spawnSync(command, {
    shell: true,
    encoding: "utf8",
    timeout: 30000,
    windowsHide: true
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  return { ok: result.status === 0, output };
}

function collectSkillPaths(home) {
  return [
    path.join(home, ".agents", "skills", "wecom-unified", "SKILL.md"),
    path.join(home, ".claude", "skills", "wecom-unified", "SKILL.md"),
    path.join(home, ".pi", "agent", "skills", "wecom-unified", "SKILL.md")
  ];
}

function main() {
  const lines = [];
  let blocking = 0;

  const badge = { ok: "[OK]  ", warn: "[提醒]", bad: "[缺失]" };
  const report = (status, title, detail) => {
    lines.push(`${badge[status]} ${title}${detail ? ` —— ${detail}` : ""}`);
    if (status === "bad") blocking += 1;
  };

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor >= MIN_NODE_MAJOR) report("ok", `Node.js ${process.version}`, `>= v${MIN_NODE_MAJOR}，脚本可用`);
  else report("bad", `Node.js ${process.version}`, `需要 >= v${MIN_NODE_MAJOR}，请先升级 Node.js`);

  const home = os.homedir();
  const skillHit = collectSkillPaths(home).find((file) => fs.existsSync(file));
  if (skillHit) {
    report("ok", "Skill wecom-unified 已安装", skillHit);
  } else {
    report("bad", "Skill wecom-unified 未安装", "让 AI 执行：npx skills add WecomTeam/wecom-unified -y -g");
  }

  const cliVersion = run("wecom-cli --version");
  if (!cliVersion.ok) {
    report("bad", "@wecom/cli 未安装或不在 PATH", "执行：npm install -g @wecom/cli");
  } else if (!isVersionAtLeast(cliVersion.output, MIN_CLI_VERSION)) {
    report("bad", `@wecom/cli 版本过低（${cliVersion.output}）`, `需要 >= ${MIN_CLI_VERSION}，执行：npm install -g @wecom/cli`);
  } else {
    report("ok", `@wecom/cli 已安装`, cliVersion.output);
  }

  if (cliVersion.ok && isVersionAtLeast(cliVersion.output, MIN_CLI_VERSION)) {
    const auth = run("wecom-cli auth show --status");
    const status = parseAuthStatus(auth.output);
    if (status === "authorized") {
      report("ok", "机器人授权状态：authorized", "已可用；发消息前仍需人工确认内容");
    } else if (status === "unauthorized") {
      report("warn", "机器人授权状态：unauthorized", "需本人扫码：wecom-cli auth init（AI 不能替扫）");
    } else {
      report("bad", "机器人授权状态读取失败", `原始输出：${auth.output || "（空）"}`);
    }
  } else {
    report("warn", "机器人授权状态", "跳过（CLI 不可用）");
  }

  const webhook = String(process.env.WECOM_WEBHOOK_URL || "").trim();
  if (webhook) report("ok", "群机器人 webhook（环境变量 WECOM_WEBHOOK_URL）已配置", "注意：webhook 地址=密钥，勿外传/入库");
  else report("warn", "群机器人 webhook 未配置", "路线 A 才需要；可设环境变量 WECOM_WEBHOOK_URL 或用 --webhook 参数");

  console.log("企业微信 × AI 环境体检（只读）");
  console.log("=".repeat(48));
  for (const line of lines) console.log(line);
  console.log("=".repeat(48));
  if (blocking > 0) {
    console.log(`结论：有 ${blocking} 项缺失，按上面提示处理后重跑本脚本。`);
    process.exitCode = 1;
  } else {
    console.log("结论：基础环境就绪。若授权为 unauthorized，请本人扫码后重跑。");
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseVersion, isVersionAtLeast, parseAuthStatus, collectSkillPaths };
