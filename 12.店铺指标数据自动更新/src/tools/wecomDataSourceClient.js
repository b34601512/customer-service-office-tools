"use strict";
/**
 * 企微智能表格《店铺指标数据》子表「数据源」写入客户端（12号）
 *
 * 为什么单独一个 client（2026-10-26 老板 17:28 定的最终版）：
 *   12号 原来写金山（AirScript webhook），现在整个改企业微信智能表格：
 *   ① 默认写企微；② 金山链整个删掉（无 --target kdocs 逃生口、无失败回落写金山）；
 *   ③ 写失败＝报警＋退出码非 0，不许静默；④ 批次键只用「采集日期＋店铺编号」；
 *   ⑤ 回读两层：本批条数＋该期间表内总行数。
 *
 * 这个文件只干「传输＋归一」这一层，编排在 scripts/写企微数据源.js。
 *
 * 从 9号（客服数据）踩过的坑照搬过来，别改回去：
 *   · `-o` 输出文件必须事先不存在，否则 CLI 报 os error 80；
 *   · errcode 非 0 时 CLI 退出码可能仍是 0 → 必须同时校验「文件在＋JSON 能解＋errcode==0」；
 *   · `--json` 整串传，Windows 单参数上限约 32767 字节，超了 spawn 直接 E2BIG 且没有任何输出
 *     （9号 2026-10-26 因此把表写空过）→ 按字节切块，单请求 ≤200 条。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const DEFAULT_CLI_PATH = "C:/Users/b3460/AppData/Roaming/npm/node_modules/@wecom/cli/bin/wecom.js";

/** Windows 命令行单参数上限约 32767 字节；--json 是整串传的，留余量 */
const ARG_BYTE_BUDGET = 24000;
const MAX_RECORDS_PER_REQUEST = 200;

/** 12 个字段，顺序与本地 xlsx 表头一致（多一个少一个都要报错，别静默丢列） */
const FIELD_TITLES = [
  "采集日期", "平台", "店铺编号", "店铺名称", "指标名称", "指标数值",
  "单位", "原始统计窗口", "来源页面", "来源地址", "平台原始指标名", "记录键"
];

/** 期望字段类型：写之前先核表结构，结构不对就别写（写进去一半最难收拾） */
const EXPECTED_FIELD_TYPES = {
  采集日期: ["date_time"],
  平台: ["single_select"],
  店铺编号: ["text"],
  店铺名称: ["text"],
  指标名称: ["text"],
  指标数值: ["number"],
  单位: ["single_select"],
  原始统计窗口: ["text"],
  来源页面: ["text"],
  来源地址: ["url", "text"],
  平台原始指标名: ["text"],
  记录键: ["text"]
};

function 抛错(说明, 详情) {
  const err = new Error(详情 ? `${说明}：${详情}` : 说明);
  if (详情) err.detail = 详情;
  throw err;
}

/**
 * 测试护栏：`node --test` 里默认禁止真调企微 CLI（9号 2026-10-26 踩过：测试顺着默认目标写进生产表）。
 * 要真调就显式设 SOFTTALK_ALLOW_REAL_WECOM=1。
 */
function assertRealCliAllowed() {
  const 在测试里 = Boolean(process.env.NODE_TEST_CONTEXT) || process.argv.includes("--test");
  if (在测试里 && process.env.SOFTTALK_ALLOW_REAL_WECOM !== "1") {
    抛错(
      "node --test 下禁止真调企微 CLI",
      "请注入假实现（listAllRecordsImplementation 等），或显式设 SOFTTALK_ALLOW_REAL_WECOM=1"
    );
  }
}

function defaultRunner({ cliPath, args, timeoutMs }) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true
  });
}

function 取错误码(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.errcode != null) return Number(payload.errcode);
  if (payload.error && payload.error.errcode != null) return Number(payload.error.errcode);
  return null;
}

function 取错误信息(payload) {
  if (!payload || typeof payload !== "object") return "";
  return String(payload.errmsg || (payload.error && payload.error.errmsg) || "").trim();
}

/**
 * 跑一次企微智能表格子命令，返回解析后的 JSON。
 * 三道校验缺一不可：spawn 没报错 → 文件在 → JSON 能解且 errcode==0。
 */
function runWecomSmartsheet({
  args,
  cliPath = DEFAULT_CLI_PATH,
  runner = defaultRunner,
  timeoutMs = 180000
}) {
  assertRealCliAllowed();
  const outputPath = path.join(
    os.tmpdir(),
    `wecom-12-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`
  );
  if (fs.existsSync(outputPath)) 抛错("企微 CLI 输出文件已存在（CLI 会报 os error 80）", outputPath);

  const fullArgs = ["smartsheet", ...args, "-o", outputPath];
  const runResult = runner({ cliPath, args: fullArgs, timeoutMs });
  try {
    // spawn 层错误必须先抛：9号 踩过「error 被吞 → 表现成『没产出文件』」
    if (runResult && runResult.error) {
      抛错("企微 CLI 没跑起来", runResult.error.message || String(runResult.error));
    }
    const 从文本里抠错误 = (文本) => {
      const 字 = String(文本 || "").trim();
      if (!字) return "";
      const m = /"code"s*:s*(-?d+)[sS]{0,40}?"message"s*:s*"([^"]*)"/.exec(字)
        || /"errcode"s*:s*(-?d+)[sS]{0,40}?"errmsg"s*:s*"([^"]*)"/.exec(字);
      if (m) return `${m[1]}：${m[2]}`;
      return 字.slice(0, 300);
    };
    if (!fs.existsSync(outputPath)) {
      抛错(
        "企微 CLI 没有产出输出文件",
        `退出码=${runResult && runResult.status} ` +
        `stdout=${从文本里抠错误(runResult && runResult.stdout)} ` +
        `stderr=${从文本里抠错误(runResult && runResult.stderr)}`
      );
    }
    const 原文 = fs.readFileSync(outputPath, "utf8");
    if (!原文.trim()) {
      // 企微这套 CLI 出错时：**文件是空的，错误只在 stdout**（2026-10-26 实探 640027）
      抛错(
        "企微 CLI 输出文件是空的（错误只打在 stdout）",
        `退出码=${runResult && runResult.status} ` +
        `stdout=${从文本里抠错误(runResult && runResult.stdout)} ` +
        `stderr=${从文本里抠错误(runResult && runResult.stderr)}`
      );
    }
    let payload;
    try {
      payload = JSON.parse(原文);
    } catch (e) {
      抛错("企微 CLI 输出不是合法 JSON", 原文.slice(0, 300));
    }
    const 码 = 取错误码(payload);
    if (码 !== 0) {
      const err = new Error(`企微返回错误 ${码 == null ? "(无错误码)" : 码}：${取错误信息(payload) || "未知"}`);
      err.errorCode = 码;
      err.payload = payload;
      throw err;
    }
    return payload;
  } finally {
    try { fs.unlinkSync(outputPath); } catch { /* 清理失败不影响结果 */ }
  }
}

/** 读子表字段定义 */
function listFields({ docid, sheetTitle, sheetId, ...options }) {
  const args = ["fields", "list", "--docid", docid];
  if (sheetId) args.push("--sheet-id", sheetId);
  else args.push("--sheet-title", sheetTitle);
  const payload = runWecomSmartsheet({ args, ...options });
  return Array.isArray(payload.fields) ? payload.fields : [];
}

/** 核表结构：12 个字段都在、类型对得上；不对就抛（别写进去一半） */
function 校验字段(fields) {
  const 表 = new Map((fields || []).map((f) => [String(f.field_title || "").trim(), String(f.field_type || "")]));
  const 缺 = [];
  const 类型不对 = [];
  for (const 名 of FIELD_TITLES) {
    if (!表.has(名)) { 缺.push(名); continue; }
    const 允许 = EXPECTED_FIELD_TYPES[名] || [];
    const 实际 = 表.get(名);
    if (允许.length && !允许.includes(实际)) 类型不对.push(`${名}(期望 ${允许.join("/")}，实际 ${实际})`);
  }
  if (缺.length) 抛错("企微子表缺字段", 缺.join("、"));
  if (类型不对.length) 抛错("企微子表字段类型不对", 类型不对.join("；"));
  const 多 = [...表.keys()].filter((名) => 名 && !FIELD_TITLES.includes(名));
  return { 字段数: 表.size, 多余字段: 多 };
}

/** 分页读全部行（企微单页上限 500，这里按 200 稳着来） */
function listAllRecords({ docid, sheetTitle, sheetId, pageSize = 200, ...options }) {
  const 全部 = [];
  let start = 0;
  for (let 轮 = 0; 轮 < 1000; 轮 += 1) {
    const args = [
      "records", "list", "--docid", docid, "--type", "records",
      "--limit", String(pageSize), "--start", String(start)
    ];
    if (sheetId) args.push("--sheet-id", sheetId);
    else args.push("--sheet-title", sheetTitle);
    const payload = runWecomSmartsheet({ args, ...options });
    const records = Array.isArray(payload.records) ? payload.records : [];
    全部.push(...records);
    const 总数 = Number(payload.total);
    if (!records.length) break;
    if (Number.isFinite(总数) && 全部.length >= 总数) break;
    if (records.length < pageSize) break;
    start += records.length;
  }
  return 全部;
}

/** 按 --json 参数字节预算切块（单请求 ≤200 条） */
function splitRecordsByArgBudget(records, budget = ARG_BYTE_BUDGET, maxPerRequest = MAX_RECORDS_PER_REQUEST) {
  const 块们 = [];
  let 当前 = [];
  let 当前字节 = 0;
  for (const record of records) {
    const 字节 = Buffer.byteLength(JSON.stringify(record), "utf8") + 2;
    if (当前.length && (当前字节 + 字节 > budget || 当前.length >= maxPerRequest)) {
      块们.push(当前);
      当前 = [];
      当前字节 = 0;
    }
    if (字节 > budget) 抛错("单条记录就超出命令行上限，无法写入", String(字节) + " 字节");
    当前.push(record);
    当前字节 += 字节;
  }
  if (当前.length) 块们.push(当前);
  return 块们;
}

/** 批量新增（自动切块；任何一块失败立刻抛，不吞） */
function addRecords({ docid, sheetTitle, sheetId, records, ...options }) {
  const 块们 = splitRecordsByArgBudget(records);
  let 已写 = 0;
  for (const [序号, 块] of 块们.entries()) {
    const body = { docid, records: 块 };
    if (sheetId) body.sheet_id = sheetId;
    else body.sheet_title = sheetTitle;
    try {
      runWecomSmartsheet({ args: ["records", "add", "--json", JSON.stringify(body)], ...options });
    } catch (e) {
      e.message = `第 ${序号 + 1}/${块们.length} 块写入失败（已写 ${已写} 条）：${e.message}`;
      throw e;
    }
    已写 += 块.length;
  }
  return { 请求块数: 块们.length, 已写条数: 已写 };
}

/** 按 record_id 批量删除（自动切块） */
function deleteRecords({ docid, sheetTitle, sheetId, recordIds, ...options }) {
  const 编号们 = [...new Set((recordIds || []).filter(Boolean))];
  if (!编号们.length) return { 请求块数: 0, 已删条数: 0 };
  const 块们 = splitRecordsByArgBudget(编号们.map((record_id) => ({ record_id })));
  let 已删 = 0;
  for (const [序号, 块] of 块们.entries()) {
    // 2026-10-26 实探：delete 要 records:[{record_id}]；发 record_ids 会报
    // 「字段 'record_id' 期望为字符串，但收到数组」(640027)，而且**文件是空的、错误只在 stdout**
    // 2026-10-26 实探：要 `records:[{record_id}]}` + `type:"delete"` 两样都有；
    // 少了 type 会报「字段 'record_id' 期望为字符串，但收到对象」(640027)
    // 注意：块里的元素已经是 {record_id}（splitRecordsByArgBudget 之前就包装过），
    // 别再包一层，否则变成 {record_id:{record_id:...}}，企微报「期望字符串但收到对象」
    const body = { docid, records: 块, type: "delete" };
    if (sheetId) body.sheet_id = sheetId;
    else body.sheet_title = sheetTitle;
    try {
      runWecomSmartsheet({ args: ["records", "delete", "--json", JSON.stringify(body)], ...options });
    } catch (e) {
      e.message = `第 ${序号 + 1}/${块们.length} 块删除失败（已删 ${已删} 条）：${e.message}`;
      throw e;
    }
    已删 += 块.length;
  }
  return { 请求块数: 块们.length, 已删条数: 已删 };
}

/** 取字段的"纯值"：CLI 回来的是 [{text}]/{link,text}/数字/日期串，统一成可比较的标量 */
function readBackScalar(fieldTitle, raw) {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    if (!raw.length) return null;
    return readBackScalar(fieldTitle, raw[0]);
  }
  if (typeof raw === "object") {
    // url 字段读回来是 {link, text}：我们要的是链接本身（text 是显示名，可能是"店铺星级"）
    if (fieldTitle === "来源地址" && raw.link != null) return String(raw.link);
    if (raw.text != null) return String(raw.text);
    if (raw.link != null) return String(raw.link);
    if (raw.value != null) return raw.value;
    return null;
  }
  if (fieldTitle === "采集日期") return toDateOnly(raw);
  if (fieldTitle === "指标数值") {
    const 数 = Number(raw);
    return Number.isFinite(数) ? 数 : null;
  }
  return String(raw);
}

/** Excel 序号 / ISO / 'YYYY-MM-DD HH:mm:ss' / Date → 'YYYY-MM-DD' */
function toDateOnly(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel 序列号：1899-12-30 起算（Excel 有 1900 闰年 bug，用这个基准刚好对）
    const 毫秒 = Math.round((value - 25569) * 86400 * 1000);
    const d = new Date(毫秒);
    if (Number.isFinite(d.getTime())) {
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    }
    return "";
  }
  const 文本 = String(value).trim();
  const 直匹配 = /^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/.exec(文本);
  if (直匹配) {
    return `${直匹配[1]}-${String(Number(直匹配[2])).padStart(2, "0")}-${String(Number(直匹配[3])).padStart(2, "0")}`;
  }
  const 纯数字 = Number(文本);
  if (Number.isFinite(纯数字) && 纯数字 > 20000 && 纯数字 < 80000) return toDateOnly(纯数字);
  const 解析 = new Date(文本);
  if (Number.isFinite(解析.getTime())) return toDateOnly(解析);
  return "";
}

/** 写进企微的日期值：现有行是 'YYYY-MM-DD 00:00:00'，保持一致 */
function toWecomDateOnly(value) {
  const 日期 = toDateOnly(value);
  return 日期 ? `${日期} 00:00:00` : "";
}

/** 批次键：只用「采集日期＋店铺编号」（老板 17:28 定；同期间覆盖、新期间追加） */
function buildBatchKey(values) {
  const 日期 = toDateOnly(values && values["采集日期"]);
  const 店铺 = String((values && values["店铺编号"]) || "").trim();
  return `${日期}|${店铺}`;
}

/** 该行的"期间"＝采集日期（回读第二层要按它数表内总行数） */
function buildPeriodKey(values) {
  return toDateOnly(values && values["采集日期"]);
}

/** 回读比对用的行键：采集日期|店铺编号|指标名称|原始统计窗口（同店同指标同期不该有两条） */
function buildRowKey(values) {
  const 指标 = String((values && values["指标名称"]) || "").trim();
  const 窗口 = String((values && values["原始统计窗口"]) || "").trim();
  return `${buildBatchKey(values)}|${指标}|${窗口}`;
}

module.exports = {
  DEFAULT_CLI_PATH,
  ARG_BYTE_BUDGET,
  MAX_RECORDS_PER_REQUEST,
  FIELD_TITLES,
  EXPECTED_FIELD_TYPES,
  assertRealCliAllowed,
  runWecomSmartsheet,
  listFields,
  校验字段,
  listAllRecords,
  splitRecordsByArgBudget,
  addRecords,
  deleteRecords,
  readBackScalar,
  toDateOnly,
  toWecomDateOnly,
  buildBatchKey,
  buildPeriodKey,
  buildRowKey
};
