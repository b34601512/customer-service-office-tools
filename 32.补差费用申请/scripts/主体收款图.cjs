#!/usr/bin/env node
// 32号 补差费用申请：主体子表收款码图（集团/器械 的 B 列「收款方式」）本地客户端。
//
// 配套在线脚本：kdocs-scripts/AirScript-补差-主体收款图.md ——
//   在目标文档《好评返现，返差价、运费汇总表【打印版】》里新建的 AirScript 2.0 脚本「补差-主体收款图」；
//   webhook 填进 project-config/kdocs-airscript.local.json 的 scripts.write_bucha_subject（别动 scripts.write_bucha）。
// 为什么单独一条通道：v6「补差-写入」的 插图/写公式 动作服务端硬编码 = 汇总表 + C 列，够不着主体表 B 列
//   （只读判定见 runtime/证据/2026-10-08T16-48-01-主体表映射/判定-AB与建议.md §4）。
//
// 用法：
//   node scripts/主体收款图.cjs --模式 探针
//   node scripts/主体收款图.cjs --模式 插图 --批次 runtime/待写数据/2026-09.json --图目录 runtime/收款码图/2026-10-08-缩略图 [--表 集团|器械|全部] [--行 5,6,…] [--每批 N] [--预演]
//   node scripts/主体收款图.cjs --模式 插图 --映射 runtime/证据/主体表映射-2026-10-08T16-48-01.json --图目录 runtime/收款码图/2026-10-08-缩略图 [--预演]
//   node scripts/主体收款图.cjs --模式 写图引用 --映射 <映射.json> [--汇总读 <24号回读.json>] [--预演]
//     写图引用 = 验证「同文档汇总表现役图 ID 能不能跨表引用」：把汇总 C 的 ID 写成 =DISPIMG(…,1) 到主体 B。
//     汇总现役 ID 默认用 24号 read-kdocs.js 现场只读回读（--汇总读 可直接给一份回读 JSON，只读、不写）。
//   --行 5,6,… ：只写列出的主体行（粘完 webhook 先 --行 5 做「1 格验证」，通过了再写剩余）。
//
// 数据来源（二选一）：
//   ① --批次 runtime/待写数据/<月>.json → 主体行按批次数组序号（第 4 行起）、汇总行按订单编号对齐；
//   ② --映射 <主体表映射-*.json>（对照[] 的 集团行/汇总行）；
//   图片：--图目录/dataURL.json（`行`/`目标行` = 汇总表行号），每张缩略图按汇总行取。
//
// 客户端守卫（在线脚本里还有一套，两边都要过）：
//   表名白名单（只认 集团/器械，绝不接受 汇总）；行域 [4, 该表数据末行]；请求条目只有 表/行/图片（只 B 列，不带列号）；
//   图片必须是 data:image/ 且非占位（≥1KB、宽/高 ≥24px）；单张 ≤60KB、整批 ≤1MB、正文 ≤2M；一批 ≤20 条。
//   失败不重试；服务端回执没有 written:true + writtenColumns 含 B 一律判失败（反向断言，防旧版只回「已写入」）。
// 退出码：0 成功 / 1 失败 / 2 参数或前置条件不对 / 3 还没配 webhook（月度流程可据此优雅跳过）。
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { 默认缩略参数, 算批组, 估字节, 缩略体积守门 } = require("./缩略图规格.cjs");
const { 解析DISPIMG } = require("./收款码图清单.cjs");

const 项目根 = path.resolve(__dirname, "..");
const 脚本键 = "write_bucha_subject";
const 在线脚本路径 = "kdocs-scripts/AirScript-补差-主体收款图.md";
const 表键名单 = ["集团", "器械"];
const 表键全名 = { "集团": "深圳市德达医疗科技集团有限公司", "器械": "深圳市德达医疗器械有限公司" };
const 单批上限 = 20;
const 正文上限字符 = 2000000;
const 图片最小字节 = 1024;
const 图片最小边 = 24;

// ———————— 配置 / 调脚本 ————————

function 读配置() {
  const 配置路径 = path.join(项目根, "project-config", "kdocs-airscript.local.json");
  if (!fs.existsSync(配置路径)) return { scripts: {} };
  return JSON.parse(fs.readFileSync(配置路径, "utf8"));
}

function 是否已配置(配置) {
  return Boolean(String((((配置 || {}).scripts || {})[脚本键] || {}).webhookUrl || "").trim());
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

async function 调脚本(argv) {
  const 配置 = 读配置();
  const webhookUrl = String(((配置.scripts || {})[脚本键] || {}).webhookUrl || "").trim();
  if (!webhookUrl) {
    const 错 = new Error(`还没配 webhook：等黎路遥在目标文档新建 AirScript 2.0 脚本「补差-主体收款图」、` +
      `粘 ${在线脚本路径}、生成同步 webhook 后，填进 32号 project-config/kdocs-airscript.local.json 的 scripts.${脚本键}.webhookUrl。`);
    错.未配置 = true;
    throw 错;
  }
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

// ———————— 纯函数（可测） ————————

function 解析参数(argv) {
  const 参数 = { 模式: "探针", 批次: "", 映射: "", 图目录: "", 表: "全部", 行: "", 每批: 0, 汇总读: "", 预演: false };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === "--预演") { 参数.预演 = true; continue; }
    if (k === "--模式") 参数.模式 = String(argv[++i] || "");
    else if (k === "--批次") 参数.批次 = String(argv[++i] || "");
    else if (k === "--映射") 参数.映射 = String(argv[++i] || "");
    else if (k === "--图目录") 参数.图目录 = String(argv[++i] || "");
    else if (k === "--表") 参数.表 = String(argv[++i] || "");
    else if (k === "--行") 参数.行 = String(argv[++i] || "");
    else if (k === "--每批") 参数.每批 = Number(argv[++i] || 0);
    else if (k === "--汇总读") 参数.汇总读 = String(argv[++i] || "");
  }
  return 参数;
}

// 只写指定主体行（--行 5,6,…）；空/未给 = 全都要
function 筛行(项, 行参数) {
  const 文 = String(行参数 == null ? "" : 行参数).trim();
  if (!文) return 项;
  const 集 = new Set(文.split(/[,，\s]+/).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0));
  if (!集.size) {
    const 错 = new Error(`--行 没解析出有效行号：「${文}」（示例：--行 5 或 --行 5,6）`);
    错.前置 = true;
    throw 错;
  }
  return 项.filter((x) => 集.has(Number(x.行)));
}

function 选表键(值) {
  const v = String(值 == null ? "" : 值).trim();
  if (!v || v === "全部") return [...表键名单];
  if (!表键名单.includes(v)) {
    const 错 = new Error(`--表 只认 集团/器械/全部（收到「${v}」；汇总绝不接受）`);
    错.前置 = true;
    throw 错;
  }
  return [v];
}

function 读JSON(路径, 说明) {
  const 全 = path.resolve(项目根, String(路径 || ""));
  if (!fs.existsSync(全)) throw new Error(`${说明}不存在：${全}`);
  return JSON.parse(fs.readFileSync(全, "utf8"));
}

function 读图目录(目录) {
  if (!目录) throw new Error("插图要 --图目录 <runtime/收款码图/…>（里面要有 dataURL.json）");
  const 文件 = path.resolve(项目根, String(目录), "dataURL.json");
  if (!fs.existsSync(文件)) throw new Error(`图目录里没有 dataURL.json：${文件}`);
  const 载荷 = JSON.parse(fs.readFileSync(文件, "utf8"));
  const 项 = Array.isArray(载荷) ? 载荷 : 载荷 && 载荷.项;
  if (!Array.isArray(项) || !项.length) throw new Error(`${文件} 里没有图条目`);
  return 项;
}

// 图片条目索引：汇总行/目标行/行（当前文件里这三个都=汇总表行号）→ 图条目
function 图项索引(图片项) {
  const m = new Map();
  for (const x of 图片项 || []) {
    if (!x || !x.dataURL) continue;
    for (const k of [x.汇总行, x.目标行, x.行]) {
      const n = Number(k);
      if (Number.isFinite(n) && !m.has(n)) m.set(n, x);
    }
  }
  return m;
}

// 图片合格：真的图片、不是占位（≥1KB、宽/高 ≥24px，字段缺失时只看字节）
function 图片合格(图) {
  if (!图 || typeof 图.dataURL !== "string") return { 合格: false, 原因: "没有 dataURL" };
  if (图.dataURL.slice(0, 11) !== "data:image/") return { 合格: false, 原因: "dataURL 不是 data:image/ 开头（不是图片）" };
  const 字节 = Number.isFinite(Number(图.字节)) && Number(图.字节) > 0 ? Number(图.字节) : 估字节(图.dataURL);
  if (字节 < 图片最小字节) return { 合格: false, 原因: `图片只有 ${字节} 字节（< 1KB），疑似占位图` };
  const 宽 = Number(图.宽), 高 = Number(图.高);
  if (Number.isFinite(宽) && 宽 > 0 && 宽 < 图片最小边) return { 合格: false, 原因: `图片宽 ${宽}px < ${图片最小边}px，疑似占位图` };
  if (Number.isFinite(高) && 高 > 0 && 高 < 图片最小边) return { 合格: false, 原因: `图片高 ${高}px < ${图片最小边}px，疑似占位图` };
  return { 合格: true, 字节 };
}

// 批次 → 主体行映射：主体行 = 4+序号（批次数组与主体表 4 行起一一对应）；
// 只收 B 列是 DISPIMG 的行（账号/邮箱进「跳过」）；汇总行按订单编号跟批次明细对齐（不猜行号）。
function 从批次建映射(批次, 表键们) {
  const 明细 = Array.isArray(批次 && 批次.明细) ? 批次.明细 : [];
  const 汇总首行 = Number(批次 && 批次.预期末行 && 批次.预期末行.汇总) + 1;
  const 订单到汇总行 = new Map();
  for (let j = 0; j < 明细.length; j += 1) {
    const 行 = Array.isArray(明细[j] && 明细[j].汇总行) ? 明细[j].汇总行 : [];
    const 订单 = String(行[4] == null ? "" : 行[4]).trim();
    if (订单) 订单到汇总行.set(订单, 汇总首行 + j);
  }
  const 项 = [], 跳过 = [], 拒绝 = [], 末行表 = {};
  for (const 键 of 表键们) {
    const 组 = (批次 && 批次.主体 && 批次.主体[表键全名[键]]) || {};
    const 行数组 = Array.isArray(组.行) ? 组.行 : [];
    末行表[键] = 4 + 行数组.length - 1;
    for (let i = 0; i < 行数组.length; i += 1) {
      const 行 = 4 + i;
      const 数据 = Array.isArray(行数组[i]) ? 行数组[i] : [];
      const 源ID = 解析DISPIMG(数据[1]);
      if (!源ID) {
        跳过.push({ 表: 键, 行, 姓名: String(数据[0] == null ? "" : 数据[0]).trim(), 当前值: String(数据[1] == null ? "" : 数据[1]).slice(0, 40), 说明: "B 列不是 DISPIMG（账号/邮箱类，无图，不动）" });
        continue;
      }
      const 订单 = String(数据[3] == null ? "" : 数据[3]).trim();
      const 汇总行 = 订单到汇总行.get(订单);
      if (!Number.isFinite(汇总行)) {
        拒绝.push({ 表: 键, 行, 姓名: String(数据[0] == null ? "" : 数据[0]).trim(), 原因: `订单编号 ${订单 || "(空)"} 在批次明细里找不到汇总行` });
        continue;
      }
      项.push({ 表: 键, 行, 汇总行, 源ID, 姓名: String(数据[0] == null ? "" : 数据[0]).trim(), 订单编号: 订单 });
    }
  }
  return { 项, 跳过, 拒绝, 末行表, 来源: "批次" };
}

// 只读映射文件（主体表映射-*.json）→ 主体行映射：对照[] 的 集团行/汇总行；
// 数据末行优先用 口径.集团数据止行（现场的），没有就取对照里最大行。
function 从映射建映射(映射, 表键们) {
  const 项 = [], 跳过 = [], 拒绝 = [], 末行表 = {};
  const 止 = Number(映射 && 映射.口径 && 映射.口径.集团数据止行);
  if (Number.isFinite(止)) 末行表["集团"] = 止;
  if (表键们.includes("集团")) {
    for (const x of (映射 && Array.isArray(映射.对照) ? 映射.对照 : [])) {
      const 行 = Number(x && x.集团行), 汇总行 = Number(x && x.汇总行);
      if (!Number.isFinite(行) || !Number.isFinite(汇总行)) continue;
      项.push({ 表: "集团", 行, 汇总行, 源ID: String((x && x.集团B_ID) || ""), 姓名: String((x && x.姓名) || ""), 订单编号: String((x && x.订单编号) || "") });
      if (!Number.isFinite(末行表["集团"]) || 行 > 末行表["集团"]) 末行表["集团"] = 行;
    }
  }
  for (const 键 of 表键们) {
    if (键 === "集团") continue;
    跳过.push({ 表: 键, 说明: `映射文件里没有「${键}」的行（只读映射只做了集团表）` });
  }
  return { 项, 跳过, 拒绝, 末行表, 来源: "映射" };
}

// 给映射项补图：按 汇总行 从图目录取 dataURL；取不到就进拒绝（不兜底）
function 附图片(项, 图索引) {
  const 出 = [], 拒绝 = [];
  for (const x of 项) {
    const 图 = 图索引.get(Number(x.汇总行));
    if (!图) { 拒绝.push({ ...x, 原因: `图目录里没有汇总行 ${x.汇总行} 的图（dataURL）` }); continue; }
    出.push({
      ...x,
      dataURL: String(图.dataURL),
      字节: Number.isFinite(Number(图.字节)) && Number(图.字节) > 0 ? Number(图.字节) : 估字节(图.dataURL),
      宽: Number(图.宽),
      高: Number(图.高),
      文件: String(图.文件 || "")
    });
  }
  return { 项: 出, 拒绝 };
}

// 客户端守卫 → 待写条目（只保留 表/行/图片 三个字段，绝不带列号）
function 校验插图项(项, 末行表) {
  const 合格 = [], 拒绝 = [];
  for (const x of 项) {
    const 错 = [];
    if (!表键名单.includes(x.表)) 错.push(`表名「${x.表 || "空"}」不在白名单（只认 集团/器械；汇总绝不接受）`);
    const 行 = Number(x.行);
    if (!Number.isInteger(行) || 行 < 4) 错.push(`行号 ${x.行} 不是 ≥4 的整数`);
    const 末 = 末行表[x.表];
    if (Number.isFinite(末) && 行 > 末) 错.push(`行号 ${行} 超出「${x.表}」数据末行 ${末}`);
    if (x.列 !== undefined || x.列号 !== undefined) {
      const c = String(x.列 !== undefined ? x.列 : x.列号).trim().toUpperCase();
      if (c !== "B" && c !== "2") 错.push(`只允许 B 列（收款方式），收到列 ${c}`);
    }
    const 检 = 图片合格(x);
    if (!检.合格) 错.push(检.原因);
    if (错.length) { 拒绝.push({ 表: x.表, 行: x.行, 汇总行: x.汇总行, 姓名: x.姓名, 原因: 错.join("；") }); continue; }
    合格.push({ 表: x.表, 行, 图片: x.dataURL, 字节: 检.字节, 汇总行: x.汇总行, 姓名: x.姓名, 源ID: x.源ID });
  }
  return { 项: 合格, 拒绝 };
}

// 写图引用：客户端守卫（白名单/行域/ID 形态）；条目只有 表/行/图片ID
function 校验引用项(项, 末行表) {
  const 合格 = [], 拒绝 = [];
  for (const x of 项) {
    const 错 = [];
    if (!表键名单.includes(x.表)) 错.push(`表名「${x.表 || "空"}」不在白名单（只认 集团/器械）`);
    const 行 = Number(x.行);
    if (!Number.isInteger(行) || 行 < 4) 错.push(`行号 ${x.行} 不是 ≥4 的整数`);
    const 末 = 末行表[x.表];
    if (Number.isFinite(末) && 行 > 末) 错.push(`行号 ${行} 超出「${x.表}」数据末行 ${末}`);
    const id = String(x.图片ID == null ? "" : x.图片ID).trim();
    if (!id || id.slice(0, 3) !== "ID_" || /\s|"|\(|\)|=/.test(id)) 错.push(`图片ID 形态不对：${id.slice(0, 40) || "(空)"}`);
    if (错.length) { 拒绝.push({ 表: x.表, 行: x.行, 汇总行: x.汇总行, 姓名: x.姓名, 原因: 错.join("；") }); continue; }
    合格.push({ 表: x.表, 行, 图片ID: id, 汇总行: x.汇总行, 姓名: x.姓名 });
  }
  return { 项: 合格, 拒绝 };
}

// 体积/条数守门：单张 ≤60KB、整批 ≤1MB、正文 ≤2M 字符、一批 ≤20 条
function 校体积(项) {
  const 守 = 缩略体积守门(
    (项 || []).map((x) => ({ 行: x.行, 字节: Number.isFinite(Number(x.字节)) && Number(x.字节) > 0 ? Number(x.字节) : 估字节(x.图片 || x.dataURL || "") })),
    { 单张上限字节: 默认缩略参数.单张上限字节, 整批上限字节: 默认缩略参数.整批上限字节 }
  );
  const 正文长 = (项 || []).reduce((s, x) => s + String(x.图片 || x.dataURL || "").length, 0);
  const 失败 = [...守.失败];
  if ((项 || []).length > 单批上限) 失败.push({ 行: 0, 字节: 0, 原因: `一批 ${项.length} 条 > 上限 ${单批上限} 条` });
  if (正文长 > 正文上限字符) 失败.push({ 行: 0, 字节: 正文长, 原因: `正文合计 ${正文长} 字符 > 上限 ${正文上限字符}（2M）` });
  return { 通过: 失败.length === 0, 总字节: 守.总字节, 正文长, 失败 };
}

// 请求体：只有 表/行/图片（B 列，不带列号）；allowWrite:true 是服务端写动作的开关
function 构造插图请求(项, 预期) {
  return {
    action: "插图",
    图: JSON.stringify(项.map((x) => ({ 表: x.表, 行: x.行, 图片: x.图片 }))),
    预期: 预期 && Object.keys(预期).length ? 预期 : undefined,
    allowWrite: true
  };
}

function 构造引用请求(项, 预期) {
  return {
    action: "写图引用",
    引用: JSON.stringify(项.map((x) => ({ 表: x.表, 行: x.行, 图片ID: x.图片ID }))),
    预期: 预期 && Object.keys(预期).length ? 预期 : undefined,
    allowWrite: true
  };
}

// 反向断言：服务端必须回 written:true 且 writtenColumns 含 B；只回「已写入」不认（防旧版服务端）
function 服务端写入成功(回执) {
  if (!回执 || 回执.written !== true) return false;
  return Array.isArray(回执.writtenColumns) && 回执.writtenColumns.includes("B");
}

// 汇总回读矩阵 → 引用项（现役图 ID 只能是 DISPIMG 公式）
function 构造引用项(映射项, 矩阵) {
  if (!Array.isArray(矩阵)) throw new Error("汇总回读不是矩阵（要 24号 read-kdocs.js 的 matrix）");
  const 项 = [], 拒绝 = [];
  for (const x of 映射项) {
    const 行 = 矩阵[Number(x.汇总行) - 1];
    if (!Array.isArray(行)) { 拒绝.push({ ...x, 原因: `回读矩阵里没有汇总行 ${x.汇总行}（只有 ${矩阵.length} 行）` }); continue; }
    const 现役ID = 解析DISPIMG(行[2]);
    if (!现役ID) { 拒绝.push({ ...x, 原因: `汇总行 ${x.汇总行} C 列不是 DISPIMG：${String(行[2]).slice(0, 50) || "(空)"}` }); continue; }
    项.push({ 表: x.表, 行: x.行, 汇总行: x.汇总行, 姓名: x.姓名, 图片ID: 现役ID });
  }
  return { 项, 拒绝 };
}

// ———————— 写序列（失败停手、不重试） ————————

function 落盘证据(目录, 名称, 数据) {
  if (!目录) return null;
  fs.mkdirSync(目录, { recursive: true });
  const 文件 = path.join(目录, `${名称}.json`);
  fs.writeFileSync(文件, JSON.stringify({ 时间: new Date().toISOString(), ...数据 }, null, 2), "utf8");
  return 文件;
}

function 精简(项) {
  const { 图片, dataURL, 源ID, ...其余 } = 项;
  return 其余;
}

// 执行写动作（插图 / 写图引用通用）：按 --每批 分组，整批失败或回执不合格 → 停手；
// 行结果用「表:行」对齐服务端逐行/跳过；证据按批落盘。
async function 执行写序列(选项) {
  const 项 = 选项.项 || [];
  const 动作 = 选项.动作 || "插图";
  const 证据名 = 选项.证据名 || 动作;
  const 每批 = Number(选项.每批 || 0);
  const 证据目录 = 选项.证据目录 || null;
  const 预期 = 选项.预期 || {};
  const 调 = 选项.调脚本 || 调脚本;
  const 组 = 算批组(项.length, 每批);
  const 批次 = [], 行结果 = [];
  let 成功 = 0, 游标 = 0, 停手 = "";
  for (let i = 0; i < 组.length; i += 1) {
    const 本组 = 项.slice(游标, 游标 + 组[i]);
    游标 += 组[i];
    const 请求 = 动作 === "插图" ? 构造插图请求(本组, 预期) : 构造引用请求(本组, 预期);
    const 载荷文本 = String(动作 === "插图" ? 请求.图 : 请求.引用);
    let 回执 = null, 错误 = "";
    try { 回执 = await 调(请求); } catch (错误调) { 错误 = String((错误调 && 错误调.message) || 错误调).slice(0, 500); }
    if (!错误 && !服务端写入成功(回执)) {
      错误 = `服务端回执没有 written:true + writtenColumns 含 B（反向断言判失败）：${JSON.stringify(回执).slice(0, 300)}`;
    }
    const 单批名 = `${证据名}-${i + 1}`;
    落盘证据(证据目录, 单批名, {
      批次: i + 1, 条数: 本组.length, 行键: 本组.map((x) => `${x.表}${x.行}`),
      正文长度: 载荷文本.length, 预期, 回执, 错误
    });
    if (错误) {
      for (const x of 本组) 行结果.push({ ...精简(x), 合格: false, 错误 });
      批次.push({ 序号: i + 1, 条数: 本组.length, 成功数: 0, 回读不符数: 0, 跳过数: 0, 错误, 证据: `${单批名}.json` });
      停手 = `第 ${i + 1} 批失败：${错误}`;
      break;
    }
    const 逐行 = new Map((回执.逐行 || []).map((x) => [`${x.表}:${Number(x.行)}`, x]));
    const 跳过 = new Map((回执.跳过 || []).map((x) => [`${x.表}:${Number(x.行)}`, x]));
    let 本批成功 = 0;
    for (const x of 本组) {
      const k = `${x.表}:${x.行}`;
      const 条 = 逐行.get(k) || {};
      const 跳 = 跳过.get(k);
      const 合格 = !跳 && (条.插入 === "成功" || 条.写入 === "成功");
      if (合格) 本批成功 += 1;
      行结果.push({
        ...精简(x), 合格,
        插入: 条.插入 || "", 写入: 条.写入 || "", 新公式: 条.新公式 || "",
        跳过原因: 跳 ? 跳.跳过原因 : "", 插入报错: 条.插入报错 || 条.写错误 || ""
      });
    }
    成功 += 本批成功;
    批次.push({
      序号: i + 1, 条数: 本组.length, 成功数: 本批成功,
      回读不符数: 回执.回读不符数 || 0, 跳过数: (回执.跳过 || []).length,
      错误: "", 证据: `${单批名}.json`
    });
    if (本批成功 !== 本组.length) {
      停手 = `第 ${i + 1} 批只有 ${本批成功}/${本组.length} 成功（跳过/失败见回执），停手不重试`;
      break;
    }
  }
  if (游标 < 项.length) {
    for (const x of 项.slice(游标)) 行结果.push({ ...精简(x), 合格: false, 错误: 停手 || "上一批失败后停手，未发起" });
  }
  return { 动作, 成功, 总数: 项.length, 批次, 行结果, 全合格: 成功 === 项.length, 停手 };
}

// ———————— 运行器 ————————

function 读链接(key) {
  const 配置 = JSON.parse(fs.readFileSync(path.join(项目根, "project-config", "links.local.json"), "utf8"));
  const url = String(配置[key] || "").trim();
  if (!url) throw new Error(`project-config/links.local.json 里没有「${key}」`);
  return url;
}

// 24号 只读回读《汇总》（写图引用取「汇总表现役图 ID」用）
function 回读汇总(输出文件) {
  fs.mkdirSync(path.dirname(输出文件), { recursive: true });
  const r = spawnSync(process.execPath, [
    "src/tools/read-kdocs.js", "--url", 读链接("好评返现汇总表"), "--sheet", "汇总", "--out", 输出文件
  ], { cwd: path.resolve(项目根, "..", "24.平台退款复查"), stdio: "inherit" });
  if (r.status !== 0) throw new Error(`24号 只读回读失败（退出码 ${r.status}），停手`);
  const 载荷 = JSON.parse(fs.readFileSync(输出文件, "utf8"));
  if (!Array.isArray(载荷.matrix)) throw new Error("24号 回读结果里没有 matrix");
  return 载荷.matrix;
}

function 提取矩阵(载荷) {
  const 矩阵 = Array.isArray(载荷) ? 载荷 : 载荷 && 载荷.matrix;
  if (!Array.isArray(矩阵)) throw new Error("汇总回读文件里没有 matrix");
  return 矩阵;
}

function 读来源(参数) {
  if (参数.批次) {
    const r = 从批次建映射(读JSON(参数.批次, "批次文件"), 选表键(参数.表));
    return { ...r, 说明: `批次 ${参数.批次}` };
  }
  if (参数.映射) {
    const r = 从映射建映射(读JSON(参数.映射, "映射文件"), 选表键(参数.表));
    return { ...r, 说明: `映射 ${参数.映射}` };
  }
  const 错 = new Error("插图要 --批次 <待写数据.json> 或 --映射 <主体表映射.json> 之一（不给就不知道主体行/汇总行怎么对）");
  错.前置 = true;
  throw 错;
}

function 打印计划(计划, 体积, 参数) {
  const 标 = (x) => `${x.表}${x.行 ? x.行 : ""}${x.姓名 ? "(" + x.姓名 + ")" : ""}`;
  console.log(`\n  32号 主体表收款码图（${参数.预演 ? "预演，不写" : "插图"}）：来源 ${计划.来源}`);
  console.log(`  待写 ${计划.待写.length} 格（只 B 列）：${计划.待写.map(标).join("、")}`);
  console.log(`  预期末行（服务端守卫）：${JSON.stringify(计划.预期)}`);
  const 最大KB = Math.round(Math.max(0, ...计划.待写.map((x) => Number(x.字节) || 0)) / 1024);
  console.log(`  体积：单张最大 ${最大KB}KB，合计 ${Math.round(体积.总字节 / 1024)}KB，正文 ${体积.正文长} 字符`);
  if (计划.跳过.length) console.log(`  无图跳过（不动）：${计划.跳过.map(标).join("、")}`);
  for (const f of 体积.失败) console.log(`  ✗ 体积/条数守卫：${f.原因}`);
  for (const r of 计划.拒绝) console.log(`  ✗ 拒绝：${r.表 ? r.表 + r.行 + "：" : ""}${r.原因 || JSON.stringify(r).slice(0, 160)}`);
}

async function 插图模式(参数, 证据目录) {
  const 来源 = 读来源(参数);
  const 筛选后 = 筛行(来源.项, 参数.行);
  if (!筛选后.length) { console.error(`\n  没有带图的行可写（来源 ${来源.说明}${参数.行 ? `；--行 ${参数.行} 筛选后为空` : ""}）\n`); process.exitCode = 2; return; }
  const 图索引 = 图项索引(读图目录(参数.图目录));
  const 附 = 附图片(筛选后, 图索引);
  const 校验 = 校验插图项(附.项, 来源.末行表);
  const 体积 = 校体积(校验.项);
  const 预期 = {};
  for (const x of 校验.项) if (Number.isFinite(来源.末行表[x.表])) 预期[x.表] = 来源.末行表[x.表];
  const 计划 = {
    来源: 来源.说明, 批次: 参数.批次 || "", 映射: 参数.映射 || "", 图目录: 参数.图目录 || "",
    口径: "只写 B 列（收款方式）；行域 [4, 数据末行]；目标格须是 DISPIMG 公式（服务端再守一遍）",
    预期,
    待写: 校验.项.map((x) => ({ 表: x.表, 行: x.行, 汇总行: x.汇总行, 姓名: x.姓名, 源ID: x.源ID, 字节: x.字节 })),
    跳过: 来源.跳过,
    拒绝: [...来源.拒绝, ...附.拒绝, ...校验.拒绝],
    体积
  };
  落盘证据(证据目录, "1-计划", 计划);
  打印计划(计划, 体积, 参数);
  if (!校验.项.length || !体积.通过) {
    console.error(`\n  守卫没过（拒 ${计划.拒绝.length} 条、体积问题 ${体积.失败.length} 条），没有发写请求。证据：${path.relative(项目根, 证据目录)}\n`);
    process.exitCode = 2;
    return;
  }
  if (参数.预演) { console.log(`\n  预演结束（没有发任何写请求）。证据：${path.relative(项目根, 证据目录)}\n`); return; }
  const 序列 = await 执行写序列({ 项: 校验.项, 每批: 参数.每批, 预期, 动作: "插图", 证据名: "插图", 证据目录 });
  落盘证据(证据目录, "插图-结果", { 计划, 序列 });
  console.log(`\n  插图完成：${序列.成功}/${序列.总数}；证据：${path.relative(项目根, 证据目录)}`);
  if (!序列.全合格) { console.error(`  未全成功：${序列.停手 || "有行未合格"}（不重试）\n`); process.exitCode = 1; return; }
  console.log("  下一步：用 24号 只读回读主体表 B 列逐格核对 + 网页人工看。\n");
}

async function 写图引用模式(参数, 证据目录) {
  const 表键们 = 选表键(参数.表 === "全部" || !参数.表 ? "集团" : 参数.表);
  if (!参数.映射) { console.error("写图引用要 --映射 <主体表映射.json>（对照里有 集团行/汇总行）"); process.exitCode = 2; return; }
  const 建 = 从映射建映射(读JSON(参数.映射, "映射文件"), 表键们);
  const 筛后 = 筛行(建.项, 参数.行);
  if (!筛后.length) { console.error(`\n  映射里没有可写的主体行${参数.行 ? `（--行 ${参数.行} 筛选后为空）` : ""}\n`); process.exitCode = 2; return; }
  const 矩阵 = 参数.汇总读 ? 提取矩阵(读JSON(参数.汇总读, "汇总回读")) : 回读汇总(path.join(证据目录, "汇总-回读-现役.json"));
  const 引 = 构造引用项(筛后, 矩阵);
  const 校验 = 校验引用项(引.项, 建.末行表);
  const 预期 = {};
  for (const x of 校验.项) if (Number.isFinite(建.末行表[x.表])) 预期[x.表] = 建.末行表[x.表];
  const 计划 = {
    来源: `映射 ${参数.映射}（现役 ID 来自 ${参数.汇总读 ? "汇总读 " + 参数.汇总读 : "24号 现场只读"}）`,
    口径: "把汇总 C 的现役图 ID 写成 =DISPIMG(…,1) 到主体 B；只 B 列；只改当前是 DISPIMG 的格",
    预期,
    待写: 校验.项.map((x) => ({ 表: x.表, 行: x.行, 汇总行: x.汇总行, 姓名: x.姓名, 图片ID: x.图片ID })),
    拒绝: [...引.拒绝, ...校验.拒绝]
  };
  落盘证据(证据目录, "1-引用计划", 计划);
  console.log(`\n  32号 主体表写图引用（${参数.预演 ? "预演，不写" : "写"}）：${计划.来源}`);
  console.log(`  待写 ${计划.待写.length} 格：${计划.待写.map((x) => `${x.表}${x.行}${x.姓名 ? "(" + x.姓名 + ")" : ""}←${x.图片ID.slice(0, 14)}…`).join("、")}`);
  console.log(`  预期末行（服务端守卫）：${JSON.stringify(预期)}`);
  for (const r of 计划.拒绝) console.log(`  ✗ 拒绝：${r.表 ? r.表 + r.行 + "：" : ""}${r.原因 || JSON.stringify(r).slice(0, 160)}`);
  if (!校验.项.length) { console.error(`\n  没有可写的格，没有发写请求。证据：${path.relative(项目根, 证据目录)}\n`); process.exitCode = 2; return; }
  if (参数.预演) { console.log(`\n  预演结束（没有发任何写请求）。证据：${path.relative(项目根, 证据目录)}\n`); return; }
  const 序列 = await 执行写序列({ 项: 校验.项, 每批: 参数.每批, 预期, 动作: "写图引用", 证据名: "写图引用", 证据目录 });
  落盘证据(证据目录, "写图引用-结果", { 计划, 序列 });
  console.log(`\n  写图引用完成：${序列.成功}/${序列.总数}；证据：${path.relative(项目根, 证据目录)}`);
  if (!序列.全合格) { console.error(`  未全成功：${序列.停手 || "有行未合格"}（不重试）\n`); process.exitCode = 1; return; }
  console.log("  下一步：网页人工看主体 B 格有没有渲染出来（这就是「跨表引用」的验证）。\n");
}

async function 主(参数) {
  const 时间戳 = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const 证据目录 = path.join(项目根, "runtime", "证据", `${时间戳}-主体收款图`);
  const 本地预演 = 参数.预演 && (参数.模式 === "插图" || 参数.模式 === "写图引用");
  if (!本地预演 && !是否已配置(读配置())) {
    console.error(`\n  主体表收款图：还没配 webhook（scripts.${脚本键}.webhookUrl），本步跳过（退出码 3，月度流程可据此优雅跳过）。`);
    console.error(`  配法：目标文档《好评返现，返差价、运费汇总表【打印版】》里新建 AirScript 2.0 脚本「补差-主体收款图」，`);
    console.error(`  粘 ${在线脚本路径}，把「同步 webhook」填进 project-config/kdocs-airscript.local.json。\n`);
    process.exitCode = 3;
    return;
  }
  if (参数.模式 === "探针") {
    const 回执 = await 调脚本({ action: "探针" });
    落盘证据(证据目录, "探针", 回执);
    console.log(JSON.stringify(回执, null, 2).slice(0, 12000));
    return;
  }
  if (参数.模式 === "插图") { await 插图模式(参数, 证据目录); return; }
  if (参数.模式 === "写图引用") { await 写图引用模式(参数, 证据目录); return; }
  const 错 = new Error(`不认识的 --模式 ${参数.模式}（探针 | 插图 | 写图引用）`);
  错.前置 = true;
  throw 错;
}

if (require.main === module) {
  主(解析参数(process.argv.slice(2))).catch((错误) => {
    console.error(`\n  失败：${错误.message}\n`);
    process.exitCode = 错误.未配置 ? 3 : (错误.前置 ? 2 : 1);
  });
}

module.exports = {
  解析参数, 选表键, 筛行, 读JSON, 读图目录, 图项索引, 图片合格,
  从批次建映射, 从映射建映射, 附图片, 校验插图项, 校验引用项, 校体积,
  构造插图请求, 构造引用请求, 构造引用项, 服务端写入成功, 执行写序列,
  落盘证据, 是否已配置, 脚本键, 项目根
};
