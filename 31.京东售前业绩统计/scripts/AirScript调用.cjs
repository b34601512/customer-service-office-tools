// 31号 共用「AirScript 同步 webhook 调用器」。
//
// 调用两个追加脚本（append_guanjia / append_mofang）：
//   调脚本("append_guanjia", { probe: true })                    // 探针（只读）
//   调脚本("append_guanjia", { rows, allowWrite: true, expectedLastRow }) // 真写
// webhook / 令牌都不入库：webhook 存本机 project-config/kdocs-airscript.local.json；
// 令牌链同 30号/7号 惯例（本配置 → 7号 → 12号）。失败不自动重试。
const fs = require("node:fs");
const path = require("node:path");
const { 项目根 } = require("./金山只读.cjs");

const SCRIPT_KEYS = ["append_guanjia", "append_mofang"];

function 读配置() {
  const 配置路径 = path.join(项目根, "project-config", "kdocs-airscript.local.json");
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

function 取webhook(脚本键) {
  const 配置 = 读配置();
  const 条目 = (配置.scripts || {})[脚本键] || {};
  return String(条目.webhookUrl || "").trim();
}

// 调一次 AirScript：argv 是 { probe } / { rows, allowWrite, expectedLastRow }。
async function 调脚本(脚本键, argv) {
  if (!SCRIPT_KEYS.includes(脚本键)) throw new Error(`未知脚本键：${脚本键}（可用 ${SCRIPT_KEYS.join(" / ")}）`);
  const webhookUrl = 取webhook(脚本键);
  if (!webhookUrl) {
    throw new Error(`等黎路遥粘贴后补 webhook：把《AirScript 脚本大全》对应行粘到目标表、生成同步 webhook，` +
      `填进 31号 project-config/kdocs-airscript.local.json 的 scripts.${脚本键}.webhookUrl。`);
  }
  const 配置 = 读配置();
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
  if (载荷.error) throw new Error(`金山脚本报错：${String(载荷.error).slice(0, 300)}\n  原始响应：${文本.slice(0, 1200)}`);
  const 原始 = 载荷.data ? 载荷.data.result : 载荷.result;
  if (原始 === undefined || 原始 === null || 原始 === "[Undefined]") {
    throw new Error("金山脚本没有返回结果：确认脚本已保存，且最后一行是 return main()。");
  }
  return 原始;
}

module.exports = { 调脚本, 取webhook, 读配置, 取令牌, SCRIPT_KEYS };
