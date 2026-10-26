"use strict";
/**
 * 12号：把本地「店铺指标数据源」写进企业微信《店铺指标数据》子表「数据源」
 *
 * 老板 2026-10-26 17:28 定的最终版（照这个写，别改回去）：
 *   ① 默认写企微《店铺指标数据》子表「数据源」；
 *   ② 金山链整个删掉——没有 --target kdocs 逃生口，也没有"失败回落写金山"；
 *   ③ 写失败＝报警＋退出码非 0，不许静默；
 *   ④ 批次键只用「采集日期＋店铺编号」：同期间覆盖、新期间追加；
 *   ⑤ 回读两层：本批条数（逐行逐字段）＋ 该期间表内总行数；
 *   ⑥ 单测覆盖 5 种情形（见 tests/wecomDataSourceSync.test.js）。
 *
 * 用法：
 *   node scripts/写企微数据源.js               # 干跑：只说会删几行、会写几行，不动表
 *   node scripts/写企微数据源.js --提交         # 真写：删同批次旧行 → 写 → 回读比对
 *   node scripts/写企微数据源.js --提交 --表头   # 顺带打印前 2 行归一后的值（排查用）
 *
 * docid 在 project-config/wecom-target.local.json（本机文件，不入库、不贴对话）。
 */

const fs = require("fs");
const path = require("path");

const 项目根 = path.resolve(__dirname, "..");

const {
  FIELD_TITLES,
  listFields,
  校验字段,
  listAllRecords,
  addRecords,
  deleteRecords,
  readBackScalar,
  toWecomDateOnly,
  toDateOnly,
  buildBatchKey,
  buildPeriodKey,
  buildRowKey
} = require(path.join(项目根, "src/tools/wecomDataSourceClient"));
const { readDataSourceWorkbook } = require(path.join(项目根, "src/kdocsSync/dataSourceWorkbookReader"));

function 读目标配置() {
  const 配置路径 = path.join(项目根, "project-config", "wecom-target.local.json");
  if (!fs.existsSync(配置路径)) {
    throw new Error(`找不到企业微信目标配置：${配置路径}（本机文件，不入库；找木婉清要 docid）`);
  }
  const 配置 = JSON.parse(fs.readFileSync(配置路径, "utf8"));
  if (!配置.docid) throw new Error("企业微信目标配置里没有 docid");
  return {
    docid: 配置.docid,
    sheetTitle: 配置.sheetTitle || "数据源",
    sheetId: 配置.sheetId || undefined
  };
}

function 读本地工作簿路径() {
  const 配置路径 = path.join(项目根, "project-config", "platform-config.json");
  const 配置 = JSON.parse(fs.readFileSync(配置路径, "utf8"));
  const 路径 = 配置 && 配置.workbook && 配置.workbook.path;
  if (!路径) throw new Error("platform-config.json 里没有 workbook.path");
  return 路径;
}

/** 本地表头一行 + 数据行 → 记录数组（值已按企微要求归一） */
function 构造记录们(数据源行们) {
  const 表头 = (数据源行们[0] || []).map((x) => String(x ?? "").trim());
  const 缺 = FIELD_TITLES.filter((名) => !表头.includes(名));
  if (缺.length) throw new Error(`本地表头缺列：${缺.join("、")}`);
  const 记录们 = [];
  for (const 行 of 数据源行们.slice(1)) {
    const 值 = {};
    for (let i = 0; i < 表头.length; i += 1) {
      const 名 = 表头[i];
      if (!FIELD_TITLES.includes(名)) continue;
      值[名] = 行[i] == null ? "" : 行[i];
    }
    if (!String(值["记录键"] || "").trim()) continue; // 空行跳过（本地读取器已滤，双保险）
    const 归一 = {
      "采集日期": toWecomDateOnly(值["采集日期"]),
      "平台": String(值["平台"] || "").trim(),
      "店铺编号": String(值["店铺编号"] || "").trim(),
      "店铺名称": String(值["店铺名称"] || "").trim(),
      "指标名称": String(值["指标名称"] || "").trim(),
      "指标数值": 值["指标数值"] === "" ? null : Number(值["指标数值"]),
      "单位": String(值["单位"] || "").trim(),
      "原始统计窗口": String(值["原始统计窗口"] || "").trim(),
      "来源页面": String(值["来源页面"] || "").trim(),
      "来源地址": String(值["来源地址"] || "").trim(),
      "平台原始指标名": String(值["平台原始指标名"] || "").trim(),
      "记录键": String(值["记录键"] || "").trim()
    };
    if (!归一["采集日期"]) throw new Error(`有行的采集日期无法识别：${JSON.stringify(值["采集日期"])}`);
    if (!归一["店铺编号"]) throw new Error(`有行的店铺编号为空（记录键 ${归一["记录键"]}）`);
    if (归一["指标数值"] != null && !Number.isFinite(归一["指标数值"])) {
      throw new Error(`指标数值不是数字：${JSON.stringify(值["指标数值"])}（记录键 ${归一["记录键"]}）`);
    }
    if (归一["来源地址"]) {
      // url 字段：企微要 {link, text}；text 用「来源页面」，缺了就用链接本身
      归一["来源地址"] = { link: 归一["来源地址"], text: 归一["来源页面"] || 归一["来源地址"] };
    } else {
      归一["来源地址"] = null;
    }
    记录们.push({ values: 归一 });
  }
  return 记录们;
}

/** 企微行 → 可比较的值（读回来的是 [{text}]/数字/日期串，统一归一） */
function 归一读回(远程行) {
  const 原始 = (远程行 && 远程行.values) || {};
  const 归一 = {};
  for (const 名 of FIELD_TITLES) 归一[名] = readBackScalar(名, 原始[名]);
  归一["采集日期"] = toDateOnly(归一["采集日期"]);
  归一["指标数值"] = 归一["指标数值"] == null ? null : Number(归一["指标数值"]);
  return 归一;
}

function 建行键索引(行们) {
  const 索引 = new Map();
  for (const 行 of 行们) {
    const 键 = buildRowKey(行);
    if (!索引.has(键)) 索引.set(键, []);
    索引.get(键).push(行);
  }
  return 索引;
}

/** 逐行逐字段比对（无序；条数由调用方先比） */
function 比对(本地行们, 远程行们) {
  const 本地索引 = 建行键索引(本地行们);
  const 远程索引 = 建行键索引(远程行们);
  const 差异 = [];
  for (const [键, 本地组] of 本地索引) {
    const 远程组 = 远程索引.get(键) || [];
    if (远程组.length !== 本地组.length) {
      差异.push(`行键「${键}」条数 应 ${本地组.length} 实 ${远程组.length}`);
      continue;
    }
    本地组.forEach((本地, i) => {
      const 远程 = 远程组[i];
      for (const 名 of FIELD_TITLES) {
        const 期 = 本地[名];
        const 实 = 远程[名];
        if (名 === "指标数值") {
          const 甲 = 期 == null ? null : Number(期);
          const 乙 = 实 == null ? null : Number(实);
          if (甲 === null && 乙 === null) continue;
          if (甲 === null || 乙 === null || Math.abs(甲 - 乙) > 1e-9) {
            差异.push(`行键「${键}」字段「${名}」应 ${期} 实 ${实}`);
          }
          continue;
        }
        if (String(期 ?? "") !== String(实 ?? "")) {
          差异.push(`行键「${键}」字段「${名}」应「${期}」实「${实}」`);
        }
      }
    });
  }
  for (const 键 of 远程索引.keys()) {
    if (!本地索引.has(键)) 差异.push(`表内多出一批本地没有的行：「${键}」`);
  }
  return 差异;
}

/**
 * 同步主流程（测试直接调这个，注入假实现即可）
 * @param {object} options
 * @param {boolean} [options.submit]  干跑=false，真写=true
 * @param {string} [options.工作簿路径]
 * @param {object} [options.目标]      {docid, sheetTitle, sheetId}
 * @param {Function} [options.listFieldsImplementation]
 * @param {Function} [options.listAllRecordsImplementation]
 * @param {Function} [options.addRecordsImplementation]
 * @param {Function} [options.deleteRecordsImplementation]
 */
async function syncDataSourceToWecom(options = {}) {
  const 提交 = Boolean(options.submit);
  const 工作簿路径 = options.工作簿路径 || 读本地工作簿路径();
  const 目标 = options.目标 || 读目标配置();

  const 本地 = options.本地数据源行们
    ? { dataSourceRows: options.本地数据源行们 }
    : await readDataSourceWorkbook(工作簿路径);
  const 本地行们 = 构造记录们(本地.dataSourceRows).map((记录) => 记录.values).map((值) => {
    const 归一 = { ...值 };
    归一["采集日期"] = toDateOnly(值["采集日期"]);
    归一["来源地址"] = 值["来源地址"] && 值["来源地址"].link ? 值["来源地址"].link : 值["来源地址"];
    return 归一;
  });
  const 本地记录们 = 构造记录们(本地.dataSourceRows);

  const 表字段 = (options.listFieldsImplementation || listFields)(目标);
  校验字段(表字段);

  const 现有 = (options.listAllRecordsImplementation || listAllRecords)(目标);
  const 本地批次键 = new Set(本地行们.map((行) => buildBatchKey(行)));
  const 本地期间 = new Set(本地行们.map((行) => buildPeriodKey(行)).filter(Boolean));

  const 待删 = 现有.filter((记录) => 本地批次键.has(buildBatchKey(归一读回(记录))));
  const 计划 = {
    目标子表: 目标.sheetTitle,
    本地行数: 本地行们.length,
    本地期间: [...本地期间],
    本地店铺数: new Set(本地行们.map((行) => 行["店铺编号"])).size,
    表内现有行数: 现有.length,
    将删除同批次旧行: 待删.length,
    将写入行数: 本地记录们.length
  };

  if (!提交) return { ...计划, 已提交: false };

  const 删结果 = (options.deleteRecordsImplementation || deleteRecords)({
    ...目标,
    recordIds: 待删.map((记录) => 记录.record_id)
  });
  const 写结果 = (options.addRecordsImplementation || addRecords)({
    ...目标,
    records: 本地记录们
  });

  // 回读两层
  const 回读 = (options.listAllRecordsImplementation || listAllRecords)(目标);
  const 回读行们 = 回读.map(归一读回);
  const 本批回读 = 回读行们.filter((行) => 本地批次键.has(buildBatchKey(行)));
  const 差异 = [];
  if (本批回读.length !== 本地行们.length) {
    差异.push(`本批条数 应 ${本地行们.length} 实 ${本批回读.length}`);
  }
  差异.push(...比对(本地行们, 本批回读));
  const 期间行数 = 回读行们.filter((行) => 本地期间.has(buildPeriodKey(行))).length;
  if (期间行数 !== 本地行们.length) {
    差异.push(`表内该期间总行数 应 ${本地行们.length} 实 ${期间行数}（表里有旧份没清）`);
  }
  if (差异.length) {
    const err = new Error(
      `企业微信回读与本地不一致（${差异.length} 处）：${差异.slice(0, 8).join("；")}` +
      `${差异.length > 8 ? "；…" : ""}。已保留现场，未自动重试。`
    );
    err.差异 = 差异;
    throw err;
  }

  return {
    ...计划,
    已提交: true,
    删除旧行数: 删结果.已删条数,
    写入条数: 写结果.已写条数,
    写入请求块数: 写结果.请求块数,
    回读本批条数: 本批回读.length,
    比对字段数: 本批回读.length * FIELD_TITLES.length,
    差异数: 0,
    表内该期间总行数: 期间行数,
    期间应写行数: 本地行们.length
  };
}

async function main() {
  const 参数 = process.argv.slice(2);
  const 提交 = 参数.includes("--提交");
  const 打表头 = 参数.includes("--表头");
  try {
    const 结果 = await syncDataSourceToWecom({ submit: 提交 });
    if (打表头 && !提交) {
      const 本地 = await readDataSourceWorkbook(读本地工作簿路径());
      const 记录们 = 构造记录们(本地.dataSourceRows);
      console.log("--- 归一后前 2 行 ---");
      for (const 记录 of 记录们.slice(0, 2)) console.log(JSON.stringify(记录.values, null, 1));
    }
    console.log(提交 ? "==== 完成 ====" : "==== 干跑（未动表；要真写加 --提交）====");
    console.log(JSON.stringify(结果, null, 1));
    console.log(提交 ? "12号结果=SUCCESS" : "12号结果=DRY_RUN");
    return 0;
  } catch (error) {
    console.error("==== 企微写入失败（未回落金山；金山链已按老板 17:28 令删除）====");
    console.error(String((error && error.stack) || error));
    if (error && error.差异) console.error("差异明细：" + JSON.stringify(error.差异, null, 1));
    console.log("12号结果=FAILED");
    return 1;
  }
}

if (require.main === module) {
  main().then((码) => { process.exit(码); });
}

module.exports = { syncDataSourceToWecom, 构造记录们, 比对, 归一读回 };
