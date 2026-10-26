#!/usr/bin/env node
"use strict";
/**
 * 一次性：12号「店铺指标数据」→ 企业微信智能表格（第一步：建表 + 灌本期 226 行 + 回读）
 *
 *   node 建表灌数.cjs --干跑        # 只读 xlsx + 打印要建的结构，不碰在线
 *   node 建表灌数.cjs --创建        # 建文档/子表/12 字段（docid 写到 12号 project-config/wecom-target.local.json）
 *   node 建表灌数.cjs --灌数        # 读已有 docid，写 226 行 → 回读逐字段比对
 *
 * 规矩：写前留本地快照；小步写（每批 ≤180 行）；写完回读逐字段比；不一致退出码 1，不自动重试。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const PROJECT = "D:/桌面/木婉清/12.店铺指标数据自动更新";
const EVIDENCE = "D:/桌面/木婉清/0.木婉清档案/任务证据/2026-10-26-12号迁企微";
const LOCAL_CONFIG = path.join(PROJECT, "project-config", "wecom-target.local.json");
const WORKBOOK = path.join(PROJECT, "outputs", "019fbb96-c39c-7ec1-899b-038594c1381a", "店铺指标数据源.xlsx");
const CLI = "C:/Users/b3460/AppData/Roaming/npm/node_modules/@wecom/cli/bin/wecom.js";
const DOC_NAME = "店铺指标数据";
const SHEET_TITLE = "数据源";
// Windows 单参数上限约 32767 字节，--json 整串传，必须按字节切块（9号 踩过 E2BIG/ENAMETOOLONG）
const ARG_BYTE_BUDGET = 24000;
const CHUNK_SIZE = 100;

const { readDataSourceWorkbook } = require(path.join(PROJECT, "src/kdocsSync/dataSourceWorkbookReader"));

const FIELDS = [
  { field_title: "采集日期", field_type: "date_time", property_date_time: { auto_fill: false, format: "yyyy-mm-dd" } },
  {
    field_title: "平台", field_type: "single_select",
    property_single_select: {
      is_quick_add: false,
      options: ["京东", "天猫", "抖音", "拼多多"].map((text, index) => ({ text, style: index + 1 }))
    }
  },
  { field_title: "店铺编号", field_type: "text" },
  { field_title: "店铺名称", field_type: "text" },
  { field_title: "指标名称", field_type: "text" },
  { field_title: "指标数值", field_type: "number", property_number: { decimal_places: 4, use_separate: false } },
  {
    field_title: "单位", field_type: "single_select",
    property_single_select: {
      is_quick_add: false,
      options: ["星", "%", "分", "单", "秒", "小时", "次", "分钟", "元", "天"].map((text, index) => ({ text, style: index + 1 }))
    }
  },
  { field_title: "原始统计窗口", field_type: "text" },
  { field_title: "来源页面", field_type: "text" },
  { field_title: "来源地址", field_type: "url" },
  { field_title: "平台原始指标名", field_type: "text" },
  { field_title: "记录键", field_type: "text" }
];

const DATE_TIME_FIELDS = new Set(["采集日期"]);
const NUMBER_FIELDS = new Set(["指标数值"]);

function pad2(value) {
  return String(value).padStart(2, "0");
}

/** Excel 序列号（1900 基准）→ YYYY-MM-DD 00:00:00；字符串原样规范化 */
function normalizeDateTimeValue(value) {
  if (value == null || String(value).trim() === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86400000));
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} 00:00:00`;
  }
  const text = String(value).trim();
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]} 00:00:00`;
  const withTime = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (withTime) return `${withTime[1]}-${withTime[2]}-${withTime[3]} ${withTime[4]}:${withTime[5]}:${withTime[6] || 0}`;
  return null;
}

function normalizeNumberValue(value) {
  if (value == null || String(value).trim() === "") return null;
  const numericValue = typeof value === "number" ? value : Number(String(value).trim().replace(/,/g, ""));
  return Number.isFinite(numericValue) ? numericValue : null;
}

function normalizeTextValue(value) {
  if (value == null) return null;
  const text = String(value);
  return text === "" ? null : text;
}

/** 本地 12 列 → 企微 records（key 用字段标题；数值不做 ×100 换算） */
function buildRecords(headerRow, dataRows) {
  if (headerRow.length !== FIELDS.length) {
    throw new Error(`本地表头列数应为 ${FIELDS.length}，实际 ${headerRow.length}`);
  }
  FIELDS.forEach((field, index) => {
    if (String(headerRow[index]).trim() !== field.field_title) {
      throw new Error(`本地第 ${index + 1} 列应为「${field.field_title}」，实际「${headerRow[index]}」`);
    }
  });
  return dataRows.map((rowValues, rowIndex) => {
    const values = {};
    FIELDS.forEach((field, index) => {
      const raw = rowValues[index];
      if (field.field_type === "url") {
        // 企微 url 字段只认 {link, text} 对象；传纯字符串会被静默丢掉（2026-10-26 实测）
        const link = normalizeTextValue(raw);
        values[field.field_title] = link ? { link, text: String(rowValues[8] ?? ""), overwrite: true } : null;
      } else if (DATE_TIME_FIELDS.has(field.field_title)) values[field.field_title] = normalizeDateTimeValue(raw);
      else if (NUMBER_FIELDS.has(field.field_title)) values[field.field_title] = normalizeNumberValue(raw);
      else values[field.field_title] = normalizeTextValue(raw);
    });
    if (!values["记录键"]) throw new Error(`第 ${rowIndex + 1} 条缺记录键，已中止`);
    return { values };
  });
}

function splitRecordsByArgBudget(records, baseByteLength) {
  const chunks = [];
  let current = [];
  let currentBytes = baseByteLength;
  for (const record of records) {
    const recordBytes = Buffer.byteLength(JSON.stringify(record), "utf8") + 2;
    if (current.length && (currentBytes + recordBytes > ARG_BYTE_BUDGET || current.length >= CHUNK_SIZE)) {
      chunks.push(current);
      current = [];
      currentBytes = baseByteLength;
    }
    current.push(record);
    currentBytes += recordBytes;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function runCli(args) {
  if (!fs.existsSync(CLI)) throw new Error(`找不到企业微信 CLI：${CLI}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wq12-"));
  const outputPath = path.join(dir, "response.json");
  const result = spawnSync(process.execPath, [CLI, ...args, "-o", outputPath], {
    encoding: "utf8",
    timeout: 180000,
    windowsHide: true
  });
  const tail = String(result.stderr || result.stdout || "").trim().slice(-500);
  if (result.error) throw new Error(`CLI 没跑起来：${result.error.code || ""} ${result.error.message}`);
  if (!fs.existsSync(outputPath)) throw new Error(`CLI 没有产出响应文件${tail ? `：${tail}` : ""}`);
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  } catch (error) {
    throw new Error(`响应不是合法 JSON：${error.message}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  if (payload && payload.errcode !== undefined && Number(payload.errcode) !== 0) {
    throw new Error(`企业微信接口报错 ${payload.errcode}：${payload.errmsg || "未知"}`);
  }
  return payload;
}

function listAllRecords(docid, sheetTitle) {
  const collected = [];
  let start = 0;
  for (let page = 0; page < 50; page += 1) {
    const payload = runCli([
      "smartsheet", "records", "list", "--docid", docid, "--sheet-title", sheetTitle,
      "--type", "records", "--limit", "1000", "--start", String(start)
    ]);
    const records = Array.isArray(payload.records) ? payload.records : [];
    collected.push(...records);
    const total = Number(payload.total ?? NaN);
    if (!records.length || records.length < 1000) break;
    if (Number.isFinite(total) && collected.length >= total) break;
    start += records.length;
  }
  return collected;
}

/** 回读标量：text 是字符串；single_select 是 [{text}]；url 可能是对象；number 是数字 */
function readBackScalar(fieldTitle, rawValue) {
  if (rawValue == null) return null;
  if (Array.isArray(rawValue)) {
    const texts = rawValue
      .map((item) => (typeof item === "string" ? item : (item?.link ?? item?.text)))
      .filter((text) => text != null && String(text) !== "");
    return texts.length ? texts.join("") : null;
  }
  if (typeof rawValue === "object") {
    // url 回读是 [{link, text, type}]，优先取 link（text 只是展示文字）
    if (rawValue.link != null) return String(rawValue.link);
    if (rawValue.url != null) return String(rawValue.url);
    if (rawValue.text != null) return String(rawValue.text);
    if (rawValue.value != null) return readBackScalar(fieldTitle, rawValue.value);
    return null;
  }
  if (DATE_TIME_FIELDS.has(fieldTitle)) return normalizeDateTimeValue(rawValue);
  if (NUMBER_FIELDS.has(fieldTitle)) return normalizeNumberValue(rawValue);
  return normalizeTextValue(rawValue);
}

function valuesEqual(fieldTitle, expected, actual) {
  const left = readBackScalar(fieldTitle, expected);
  const right = readBackScalar(fieldTitle, actual);
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  if (typeof left === "number" && typeof right === "number") return Math.abs(left - right) <= 1e-9;
  return String(left) === String(right);
}

function loadLocalConfig() {
  if (!fs.existsSync(LOCAL_CONFIG)) throw new Error(`没有本地配置：${LOCAL_CONFIG}（先跑 --创建）`);
  return JSON.parse(fs.readFileSync(LOCAL_CONFIG, "utf8"));
}

async function readSource() {
  const source = await readDataSourceWorkbook(WORKBOOK);
  const headerRow = source.dataSourceRows[0];
  const dataRows = source.dataSourceRows.slice(1);
  return { source, headerRow, dataRows, records: buildRecords(headerRow, dataRows) };
}

async function main() {
  const mode = process.argv[2] || "";
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const { headerRow, dataRows, records } = await readSource();
  console.log(`本地：${dataRows.length} 行 × ${headerRow.length} 列；记录键唯一 ${new Set(records.map((r) => r.values["记录键"])).size === records.length}`);

  if (mode === "--干跑") {
    fs.writeFileSync(path.join(EVIDENCE, "源数据226行.json"), JSON.stringify({ headerRow, dataRows }, null, 1));
    console.log(`快照已存：${path.join(EVIDENCE, "源数据226行.json")}`);
    console.log(JSON.stringify({ docName: DOC_NAME, sheetTitle: SHEET_TITLE, fields: FIELDS.map((f) => `${f.field_title}:${f.field_type}`), expectedWriteCount: records.length, sample: records[0] }, null, 1));
    return;
  }

  if (mode === "--创建") {
    const fs_ = fs;
    const snapshotPath = path.join(EVIDENCE, "源数据226行.json");
    if (!fs_.existsSync(snapshotPath)) {
      fs_.writeFileSync(snapshotPath, JSON.stringify({ headerRow, dataRows }, null, 1));
    }
    if (fs_.existsSync(LOCAL_CONFIG)) {
      throw new Error(`本地配置已存在，避免重复建表：${LOCAL_CONFIG}`);
    }
    const created = runCli([
      "smartsheet", "create", "--name", DOC_NAME, "--sheet-title", SHEET_TITLE, "--fields", JSON.stringify(FIELDS)
    ]);
    const docid = String(created.docid || created.doc_id || "").trim();
    if (!docid) throw new Error(`创建返回里没有 docid：${JSON.stringify(created).slice(0, 300)}`);
    fs_.mkdirSync(path.dirname(LOCAL_CONFIG), { recursive: true });
    fs_.writeFileSync(LOCAL_CONFIG, JSON.stringify({
      docid,
      sheetTitle: SHEET_TITLE,
      url: created.url || "",
      name: created.doc_name || DOC_NAME,
      说明: "12号 店铺指标数据（企业微信智能表格）——本机配置，不入库；12 字段，1:1 对应金山统一数据源。"
    }, null, 1));
    console.log(JSON.stringify({ docid, url: created.url, docName: created.doc_name, localConfig: LOCAL_CONFIG }, null, 1));
    return;
  }

  if (mode === "--灌数") {
    const target = loadLocalConfig();
    const docid = target.docid;
    const before = listAllRecords(docid, target.sheetTitle);
    if (before.length) throw new Error(`目标表已有 ${before.length} 行，本脚本只用于首次灌数，已停止`);
    const skeleton = { docid, sheet_title: target.sheetTitle, type: "add", key_type: "field_title", records: [] };
    const chunks = splitRecordsByArgBudget(records, Buffer.byteLength(JSON.stringify(skeleton), "utf8"));
    console.log(`  按参数字节预算切 ${chunks.length} 批：${chunks.map((chunk) => chunk.length).join("+")}`);
    let written = 0;
    for (const chunk of chunks) {
      runCli([
        "smartsheet", "records", "add", "--json", JSON.stringify({ ...skeleton, records: chunk })
      ]);
      written += chunk.length;
      console.log(`  已写 ${written}/${records.length}`);
    }
    const after = listAllRecords(docid, target.sheetTitle);
    const result = verifyRecords({ docid, records, after, writtenCount: written, evidenceName: "回读核对-首次灌数.json" });
    if (result.mismatchCount) process.exitCode = 1;
    return;
  }

  if (mode === "--补地址") {
    const target = loadLocalConfig();
    const docid = target.docid;
    const actual = listAllRecords(docid, target.sheetTitle);
    if (actual.length !== records.length) {
      throw new Error(`表里 ${actual.length} 行、本地 ${records.length} 行，先查清再补，已停止`);
    }
    const actualByKey = new Map(actual.map((record) => [readBackScalar("记录键", record.values?.["记录键"]), record]));
    const updates = [];
    for (const expected of records) {
      const record = actualByKey.get(expected.values["记录键"]);
      if (!record) throw new Error(`表里找不到记录键 ${expected.values["记录键"]}，已停止`);
      updates.push({ record_id: record.record_id, values: { 来源地址: expected.values["来源地址"] } });
    }
    const skeleton = { docid, sheet_title: target.sheetTitle, type: "update", key_type: "field_title", records: [] };
    const chunks = splitRecordsByArgBudget(updates, Buffer.byteLength(JSON.stringify(skeleton), "utf8"));
    console.log(`  按参数字节预算切 ${chunks.length} 批补来源地址：${chunks.map((chunk) => chunk.length).join("+")}`);
    let updated = 0;
    for (const chunk of chunks) {
      runCli(["smartsheet", "records", "update", "--json", JSON.stringify({ ...skeleton, records: chunk })]);
      updated += chunk.length;
      console.log(`  已补 ${updated}/${updates.length}`);
    }
    const after = listAllRecords(docid, target.sheetTitle);
    const result = verifyRecords({ docid, records, after, writtenCount: updated, evidenceName: "回读核对-补地址.json" });
    if (result.mismatchCount) process.exitCode = 1;
    return;
  }

  if (mode === "--核对") {
    const target = loadLocalConfig();
    const after = listAllRecords(target.docid, target.sheetTitle);
    const result = verifyRecords({ docid: target.docid, records, after, writtenCount: 0, evidenceName: "回读核对-最终.json" });
    if (result.mismatchCount) process.exitCode = 1;
    return;
  }

  console.log("用法：--干跑 | --创建 | --灌数 | --补地址 | --核对");
}

/** 回读逐行逐字段比对，结果写证据；返回结果对象 */
function verifyRecords({ docid, records, after, writtenCount, evidenceName }) {
  const byKey = new Map();
  const duplicates = new Set();
  for (const record of after) {
    const key = readBackScalar("记录键", record.values?.["记录键"]);
    if (byKey.has(key)) duplicates.add(key);
    byKey.set(key, record);
  }
  const mismatches = [];
  if (after.length !== records.length) mismatches.push({ kind: "count", expected: records.length, actual: after.length });
  let row = 0;
  for (const expected of records) {
    row += 1;
    const key = expected.values["记录键"];
    const actual = byKey.get(key);
    if (!actual) {
      mismatches.push({ kind: "missing", row, key });
      continue;
    }
    for (const field of FIELDS) {
      const title = field.field_title;
      if (!valuesEqual(title, expected.values[title], actual.values?.[title])) {
        mismatches.push({ kind: "field", row, key, field: title, expected: readBackScalar(title, expected.values[title]), actual: readBackScalar(title, actual.values?.[title]) });
      }
    }
  }
  for (const key of duplicates) mismatches.push({ kind: "duplicate", key });
  const result = {
    target: "wecom",
    targetConfig: "12.店铺指标数据自动更新/project-config/wecom-target.local.json",
    expectedWriteCount: records.length,
    writtenCount,
    readBackCount: after.length,
    comparedFieldCount: records.length * FIELDS.length,
    mismatchCount: mismatches.length,
    mismatches: mismatches.slice(0, 10)
  };
  fs.writeFileSync(path.join(EVIDENCE, evidenceName), JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result, null, 1));
  if (mismatches.length) console.error("回读不一致，已保留现场，不自动重试。");
  return result;
}

main().catch((error) => {
  console.error("失败：" + error.message);
  process.exit(1);
});
