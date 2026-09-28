// 7号：调用金山文档里已保存的 AirScript 脚本（只读查询登记总表用）。
// 协议与踩坑来源：22号 `src/engine/kdocsAirScript.js`（实战验证过），官方文档
//   https://developer.kdocs.cn/server/server-script/sync-script.html
//
// 要点（别随手改）：
// 1) 入口是脚本的「同步 webhook」：POST <webhookUrl>，头 `AirScript-Token: <token>`，
//    参数走 body 的 `Context.argv`（数组），结果在响应体 `data.result`。
// 2) AirScript-Token ≠ OAuth access_token，不能拿去调 KSheet OpenAPI。
// 3) 脚本必须在文档里已保存且只读；脚本最后一行必须是 `return main()`，否则拿不到返回值。
// 4) 同一金山账号的 AirScript-Token 可跨脚本用（22号 2026-09-18 实测），所以本地缺令牌时回退读 12号 那份。
const fs = require("fs");
const path = require("path");

const 项目根 = path.resolve(__dirname, "..");
const 配置路径 = path.join(项目根, "project-config", "kdocs-airscript.json");
const 令牌回退文件 = "../../12.店铺指标数据自动更新/project-config/platform-config.json";

function 读配置() {
  if (!fs.existsSync(配置路径)) {
    throw new Error(`缺少金山脚本配置：${path.relative(项目根, 配置路径)}（内容形如 {"scripts":{"query":{"webhookUrl":"..."}}}，不入库）`);
  }
  const 配置 = JSON.parse(fs.readFileSync(配置路径, "utf8"));
  if (!配置.apiToken) {
    const 回退路径 = path.resolve(项目根, 配置.tokenFallbackFile || 令牌回退文件);
    if (fs.existsSync(回退路径)) {
      const 回退配置 = JSON.parse(fs.readFileSync(回退路径, "utf8"));
      const 令牌 = (回退配置.kdocsDataSourceSync || {}).apiToken;
      if (令牌) 配置.apiToken = 令牌;
    }
  }
  if (!配置.apiToken) throw new Error("缺少 AirScript-Token：请把令牌填进 project-config/kdocs-airscript.json 的 apiToken。");
  return 配置;
}

function 取同步地址(脚本名, 配置) {
  const 条目 = (配置.scripts || {})[脚本名];
  if (条目 && 条目.webhookUrl) return 条目.webhookUrl;
  const 现有 = Object.keys(配置.scripts || {}).join(", ") || "(空)";
  const 线索 = 条目 ? `脚本「${脚本名}」的条目存在但 webhookUrl 是空的` : `配置里没有脚本「${脚本名}」`;
  throw new Error(`${线索}（现有条目：${现有}）——把该脚本的「同步 webhook」填进 project-config/kdocs-airscript.json 的 scripts.${脚本名}.webhookUrl`);
}

async function 跑脚本(参数数组, 选项 = {}) {
  const 配置 = 选项.配置 || 读配置();
  const 脚本名 = 选项.脚本 || "query";
  const 同步地址 = 选项.同步地址 || 取同步地址(脚本名, 配置);
  const 超时毫秒 = 选项.超时毫秒 || 180000;
  const 控制器 = new AbortController();
  const 定时器 = setTimeout(() => 控制器.abort(), 超时毫秒);
  let 响应 = null;
  let 文本 = "";
  try {
    响应 = await fetch(同步地址, {
      method: "POST",
      headers: { "Content-Type": "application/json", "AirScript-Token": 配置.apiToken },
      body: JSON.stringify({ Context: { argv: 参数数组 } }),
      signal: 控制器.signal
    });
    文本 = await 响应.text();
  } catch (错误) {
    if (错误 && 错误.name === "AbortError") throw new Error(`金山脚本执行超过 ${Math.round(超时毫秒 / 1000)} 秒未返回。`);
    throw new Error(`连接金山文档失败：${错误 && 错误.message ? 错误.message : 错误}`);
  } finally {
    clearTimeout(定时器);
  }
  if (!响应.ok) throw new Error(`金山接口返回 HTTP ${响应.status}（检查同步地址与脚本令牌是否有效）`);
  let 载荷 = null;
  try {
    载荷 = JSON.parse(文本);
  } catch (错误) {
    throw new Error("金山接口没有返回可解析的 JSON。");
  }
  if (载荷.error) {
    const 栈 = 载荷.error_details && Array.isArray(载荷.error_details.stack) ? 载荷.error_details.stack.join(" ").slice(0, 300) : "";
    throw new Error(`金山脚本报错：${String(载荷.error).slice(0, 200)}${栈 ? ` ← ${栈}` : ""}`);
  }
  const 原始 = 载荷.data ? 载荷.data.result : 载荷.result;
  if (原始 === undefined || 原始 === null || 原始 === "[Undefined]") {
    throw new Error("金山脚本没有返回结果：确认脚本已保存，且最后一行是 return main()。");
  }
  if (typeof 原始 === "object") return 原始;
  try {
    return JSON.parse(String(原始));
  } catch (错误) {
    throw new Error(`金山脚本返回值不是 JSON：${String(原始).slice(0, 200)}`);
  }
}

module.exports = { 跑脚本, 读配置, 取同步地址, 配置路径 };
