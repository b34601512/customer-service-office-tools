"use strict";
/**
 * 12号：企微《店铺指标数据》写入 —— 5 种情形单测
 *
 * 老板 2026-10-26 17:28 的六条要求，前五条在这里各有一条断言兜着：
 *   日期归一 / 幂等覆盖 / 新期间追加 / 回读两层（本批条数＋期间总行数）/ 失败绝不调金山。
 *
 * 跑：node tests/wecomDataSourceSync.test.js
 * ⚠ 全部走注入的假表实现，不碰真企微（client 里还有一道 assertRealCliAllowed 兜底）。
 */

const assert = require("assert");
const path = require("path");

const 项目根 = path.resolve(__dirname, "..");
const {
  FIELD_TITLES,
  toDateOnly,
  toWecomDateOnly,
  buildBatchKey,
  buildRowKey,
  splitRecordsByArgBudget
} = require(path.join(项目根, "src/tools/wecomDataSourceClient"));
const { syncDataSourceToWecom } = require(path.join(项目根, "scripts/写企微数据源.js"));

/** 本地行（12 列，跟 xlsx 表头同序） */
function 本地行({ 日期 = 46318, 店铺 = "jd1", 指标 = "京东-店铺星级", 数值 = 5, 记录键 = "k1" } = {}) {
  return [
    日期, "京东", 店铺, "京东1店", 指标, 数值, "星", "数据日期快照", "店铺星级",
    "https://example.com/x", "店铺星级", 记录键
  ];
}
function 表头行() {
  return FIELD_TITLES.slice();
}

/** 假企微表：records 里存的是 {record_id, values:{字段: 原样}} */
function 建假表({ 现有行们 = [] } = {}) {
  const 表 = {
    records: 现有行们.map((值, i) => ({ record_id: `r${i + 1}`, values: 值 })),
    写次数: 0,
    删次数: 0,
    下一个编号: 现有行们.length + 1
  };
  表.listFieldsImplementation = () => FIELD_TITLES.map((名) => ({
    field_title: 名,
    field_type: 名 === "采集日期" ? "date_time"
      : 名 === "指标数值" ? "number"
        : 名 === "来源地址" ? "url"
          : (名 === "平台" || 名 === "单位") ? "single_select" : "text"
  }));
  表.listAllRecordsImplementation = () => 表.records.map((r) => ({ record_id: r.record_id, values: r.values }));
  表.deleteRecordsImplementation = ({ recordIds }) => {
    表.删次数 += 1;
    const 要删 = new Set(recordIds);
    表.records = 表.records.filter((r) => !要删.has(r.record_id));
    return { 请求块数: 1, 已删条数: recordIds.length };
  };
  表.addRecordsImplementation = ({ records }) => {
    表.写次数 += 1;
    for (const 记录 of records) {
      表.records.push({ record_id: `r${表.下一个编号 += 1}`, values: 记录.values });
    }
    return { 请求块数: 1, 已写条数: records.length };
  };
  return 表;
}

/** 把本地记录转成"表里存的样子"（读回来是字符串/数字/数组，这里简化成写进去的值） */
function 造现有行({ 日期 = 46318, 店铺 = "jd1", 指标 = "京东-店铺星级", 数值 = 5, 记录键 = "k1" } = {}) {
  return {
    "采集日期": toWecomDateOnly(日期),
    "平台": "京东",
    "店铺编号": 店铺,
    "店铺名称": "京东1店",
    "指标名称": 指标,
    "指标数值": 数值,
    "单位": "星",
    "原始统计窗口": "数据日期快照",
    "来源页面": "店铺星级",
    "来源地址": { link: "https://example.com/x", text: "店铺星级" },
    "平台原始指标名": "店铺星级",
    "记录键": 记录键
  };
}

function 跑(表, 行们, 额外 = {}) {
  return syncDataSourceToWecom({
    submit: true,
    本地数据源行们: [表头行(), ...行们],
    目标: { docid: "s3_fake", sheetTitle: "数据源" },
    listFieldsImplementation: 表.listFieldsImplementation,
    listAllRecordsImplementation: 表.listAllRecordsImplementation,
    addRecordsImplementation: 表.addRecordsImplementation,
    deleteRecordsImplementation: 表.deleteRecordsImplementation,
    ...额外
  });
}

async function main() {
  // 1) 日期归一：Excel 序号 / 斜杠 / 带时间 / Date → 同一个 'YYYY-MM-DD'
  assert.equal(toDateOnly(46318), "2026-10-23", "Excel 序号 46318 应归一到 2026-10-23");
  assert.equal(toDateOnly("2026/10/23"), "2026-10-23");
  assert.equal(toDateOnly("2026-10-23 00:00:00"), "2026-10-23");
  assert.equal(toDateOnly(new Date(2026, 9, 23)), "2026-10-23");
  assert.equal(toWecomDateOnly(46318), "2026-10-23 00:00:00", "写进企微要和现有行一个形状");
  assert.equal(buildBatchKey({ 采集日期: 46318, 店铺编号: "jd1" }), "2026-10-23|jd1", "批次键＝采集日期+店铺编号");

  // 2) 幂等：同一期间连跑两遍，行数不翻倍（第二遍先删同批次再写）
  const 表2 = 建假表();
  const 第一遍 = await 跑(表2, [本地行({ 记录键: "a" }), 本地行({ 指标: "京东-评价数", 数值: 100, 记录键: "b" })]);
  assert.equal(表2.records.length, 2);
  assert.equal(第一遍.删除旧行数, 0, "第一遍表里没旧行");
  assert.equal(第一遍.回读本批条数, 2);
  assert.equal(第一遍.表内该期间总行数, 2);
  const 第二遍 = await 跑(表2, [本地行({ 记录键: "a" }), 本地行({ 指标: "京东-评价数", 数值: 100, 记录键: "b" })]);
  assert.equal(表2.records.length, 2, "同期间重跑必须覆盖，不能追加成 4 行");
  assert.equal(第二遍.删除旧行数, 2, "第二遍要先删掉同批次旧行");
  assert.equal(第二遍.差异数, 0);

  // 3) 新期间追加：换了采集日期就是新期间，旧的留着（老板「追加、保留历史」）
  const 第三遍 = await 跑(表2, [本地行({ 日期: 46319, 记录键: "c" })]);
  assert.equal(表2.records.length, 3, "新期间应追加，旧期间保留");
  assert.equal(第三遍.表内该期间总行数, 1, "该期间只有新写的那 1 行");
  assert.equal(第三遍.删除旧行数, 0, "新期间不该删旧期间的任何行");

  // 4) 回读两层：同期间、但表里有本地没有的店铺行（不该被删，也不该算正常）
  //    → 必须报「表内该期间总行数 应 1 实 2」，而且不重试。
  //    （注：同批次重复行会被"先删同批次"这一步清掉，那是最正常不过的修复路径，不算异常）
  const 表4 = 建假表({ 现有行们: [造现有行({ 记录键: "a", 店铺: "jd1" }), 造现有行({ 记录键: "b", 店铺: "jd2" })] });
  await assert.rejects(
    () => 跑(表4, [本地行({ 记录键: "a", 店铺: "jd1" })]),
    /表内该期间总行数 应 1 实 2/
  );

  // 5) 失败场景：写失败必须抛错（脚本里→退出码非 0），且**绝不调用金山**
  const 表5 = 建假表();
  const 调用记录 = [];
  await assert.rejects(
    () => 跑(表5, [本地行({ 记录键: "a" })], {
      addRecordsImplementation: ({ records }) => {
        调用记录.push("wecom:add");
        throw new Error("模拟企微 850003 授权失效");
      }
    }),
    /850003|写入失败/
  );
  const 已加载模块 = Object.keys(require.cache);
  assert.equal(
    已加载模块.filter((文件) => /kdocsAirScriptClient|syncDataSourceToKdocs|kdocsSyncSettings/.test(文件)).length,
    0,
    "金山写入模块一个都不该被加载（金山链已删，失败也不许回落）"
  );
  assert.deepEqual(调用记录, ["wecom:add"], "失败路径只调过企微，没调过任何金山接口");

  // 附：切块（Windows 命令行单参数上限，超了 spawn 直接 E2BIG 且无提示）
  const 很多 = Array.from({ length: 450 }, (_, i) => ({ values: { 记录键: `k${i}`, 说明: "x".repeat(120) } }));
  const 块们 = splitRecordsByArgBudget(很多, 8000, 200);
  assert.ok(块们.length >= 3, "应按字节预算切块");
  assert.ok(块们.every((块) => 块.length <= 200), "单请求不超过 200 条");
  assert.equal(块们.reduce((和, 块) => 和 + 块.length, 0), 450, "不能漏条");

  console.log("wecomDataSourceSync: 5 种情形全过（日期归一／幂等覆盖／新期间追加／回读两层／失败绝不调金山）");
}

main().catch((e) => { console.error(e); process.exit(1); });
