#!/usr/bin/env node
// 32号 补差费用申请：拆分后两个客户端（补差-写数据 / 补差-刷新与税金）共用的小模块。
// 只干四件事：配置与令牌、取 webhook、发 webhook、落盘证据/成功判定。
// 请求/守卫写法照现役 scripts/写入在线表.cjs 复用；webhook / 令牌都不入库
// （project-config/kdocs-airscript.local.json；令牌回退链：本配置 → 7号 → 12号）。
// 失败不自动重试（用户铁律）。
const fs = require("node:fs");
const path = require("node:path");

const 项目根 = path.resolve(__dirname, "..");
const 配置路径 = path.join(项目根, "project-config", "kdocs-airscript.local.json");

function 读配置() {
  if (!fs.existsSync(配置路径)) return { scripts: {} };
  return JSON.parse(fs.readFileSync(配置路径, "utf8"));
}

function 解析令牌配置(文件路径) {
  const 配置 = JSON.parse(fs.readFileSync(文件路径, "utf8"));
  if (配置.apiToken) return 配置.apiToken;
  const 相对 = 配置.tokenFallbackFile || 配置.apiTokenFallbackFile || "../12.店铺指标数据自动更新/project-config/platform-config.json";
  const 二级路径 = path.resolve(path.dirname(path.dirname(文件路径)), 相对);
  if (fs.existsSync(二级路径)) {
    const 二级配置 = JSON.parse(fs.readFileSync(二级路径, "utf8"));
    const 令牌 = (二级配置.kdocsDataSourceSync || {}).apiToken;
    if (令牌) return 令牌;
  }
  return "";
}

function 取令牌(配置) {
  if (配置.apiToken) return 配置.apiToken;
  const 回退 = path.resolve(项目根, 配置.apiTokenFallbackFile || "../2.发票自动化/7.自动登记发票/project-config/kdocs-airscript.json");
  if (fs.existsSync(回退)) return 解析令牌配置(回退);
  return "";
}

// 按顺序尝试多个键，读 webhook：支持 scripts.<键>.webhookUrl / 顶层 <键>.webhookUrl / 字面 "键.webhookUrl" / 字符串值。
// 键们 = 如 ["写数据", "补差-写数据"]；都取不到返回空串。
function 取Webhook(配置, 键们) {
  const 脚本们 = 配置.scripts || {};
  for (const 键 of 键们) {
    const 候选 = [
      脚本们[键] && 脚本们[键].webhookUrl,
      脚本们[键 + ".webhookUrl"],
      typeof 脚本们[键] === "string" ? 脚本们[键] : "",
      配置[键] && 配置[键].webhookUrl,
      配置[键 + ".webhookUrl"],
      typeof 配置[键] === "string" ? 配置[键] : ""
    ];
    for (const 值 of 候选) {
      const s = String(值 || "").trim();
      if (s) return s;
    }
  }
  return "";
}

async function 调脚本(argv, 选项 = {}) {
  const 配置 = 读配置();
  const webhookUrl = 取Webhook(配置, 选项.键们 || []);
  if (!webhookUrl) throw new Error(选项.缺配置提示 || "还没配 webhook（project-config/kdocs-airscript.local.json）。");
  const 令牌 = 取令牌(配置);
  if (!令牌) throw new Error("缺少 AirScript-Token（本机配置或回退链里都没有）。");
  const 响应 = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "AirScript-Token": 令牌 },
    body: JSON.stringify({ Context: { argv } }),
    signal: AbortSignal.timeout(300000)
  });
  const 文本 = await 响应.text();
  if (!响应.ok) throw new Error(`金山接口返回 HTTP ${响应.status}：${文本.slice(0, 300)}`);
  let 载荷 = null;
  try { 载荷 = JSON.parse(文本); } catch { throw new Error(`金山接口没有返回可解析的 JSON：${文本.slice(0, 300)}`); }
  if (载荷.error) throw new Error(`金山脚本报错：${String(载荷.error).slice(0, 500)}\n  原始响应：${文本.slice(0, 1500)}`);
  const 原始 = 载荷.data ? 载荷.data.result : 载荷.result;
  if (原始 === undefined || 原始 === null || 原始 === "[Undefined]") {
    throw new Error("金山脚本没有返回结果：确认脚本已保存，且最后一行是 return main()。");
  }
  return 原始;
}

function 落盘证据(目录, 名称, 数据) {
  fs.mkdirSync(目录, { recursive: true });
  const 文件 = path.join(目录, 名称 + ".json");
  fs.writeFileSync(文件, JSON.stringify({ 时间: new Date().toISOString(), ...数据 }, null, 2), "utf8");
  return 文件;
}

// 写结果成功判定（反向断言）：必须 written 是真布尔 true，且 回读差异数为 0。
// 只回 status:'已写入' 之类、没有 written:true 的，一律判失败。
function 校验写结果(结果, 名称) {
  if (!结果 || 结果.written !== true) {
    throw new Error(`${名称}没回 written:true（拒绝把 status 之类当成功）：${JSON.stringify(结果).slice(0, 300)}`);
  }
  if (Number(结果.回读差异数) !== 0) {
    throw new Error(`${名称}回读有 ${结果.回读差异数} 格不一致：${JSON.stringify(结果.差异样例 || []).slice(0, 400)}`);
  }
  return 结果;
}

module.exports = { 项目根, 配置路径, 读配置, 取令牌, 取Webhook, 调脚本, 落盘证据, 校验写结果 };
