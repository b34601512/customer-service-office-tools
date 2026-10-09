#!/usr/bin/env node
// 生成「待登记清单」条目：消息文本 → ERP 查单 → 按规则算金额 → 落本机清单（只读+计算，不写金山表）。
//
// 用法示例：
//   node scripts/生成待登记清单.js --文本 "帮我登记这个订单的发票，店铺：拼多多2店；订单编号：260901-123456789012345；发票信息：电子普票，发票抬头：XXX，企业税号：XXX" --平台读取 pdd-store-1
//   node scripts/生成待登记清单.js --店铺 拼多多2店 --订单 260901-123456789012345 --发票类型 电子普票 --抬头 "XXX" --税号 "XXX" --平台金额 374.12
//
// --平台读取 <5号店铺id>：自动去拼多多发票中心搜这一单，拿平台应开金额/抬头/税号（只读）。
// 个人票（无税号，2026-10-09 口径：只有开公司抬头的才填税号栏）：--抬头类型 个人 或 --个人票；或 --发票类型 "增值税电子普通发票 - 个人"。
//   ERP「发票抬头类型」列=个人 也会被识别（不需要额外传参）。个人票税号允许为空，姓名写 AA、AB 税号栏留空。
// ERP 数据源：默认取 10号 管易ERP 最新下载的「订单商品明细统计」CSV（`10.自动报量/自动报量输出/数据源/*.csv`）。
// 产物：默认追加到本机 `project-config/待登记清单.jsonl`（已 gitignore，不入库）。
const fs = require("fs");
const path = require("path");
const { 解析登记请求 } = require("../src/解析登记请求");
const { 解析Csv文本, 解码Csv缓冲区 } = require("../src/解析Csv");
const { 生成待登记条目, 是否个人票 } = require("../src/发票规则");

const ERP数据源目录 = path.resolve(__dirname, "../../../10.自动报量/自动报量输出/数据源");
const 默认输出路径 = path.resolve(__dirname, "../project-config/待登记清单.jsonl");

function 读取参数(argv) {
  const 参数 = {};
  for (let i = 0; i < argv.length; i += 1) {
    const 项 = argv[i];
    if (!项.startsWith("--")) continue;
    const 键 = 项.slice(2);
    const 值 = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[i + 1] : "";
    参数[键] = 值;
    if (值 !== "") i += 1;
  }
  return 参数;
}

function 取文本(参数) {
  if (!参数["文本"]) return "";
  if (参数["文本"].startsWith("@")) return fs.readFileSync(参数["文本"].slice(1), "utf8");
  return 参数["文本"];
}

function 找最新ErpCsv(指定路径) {
  if (指定路径) return 指定路径;
  if (!fs.existsSync(ERP数据源目录)) return "";
  const 文件列表 = fs.readdirSync(ERP数据源目录).filter((名) => 名.toLowerCase().endsWith(".csv"));
  if (文件列表.length === 0) return "";
  const 带时间 = 文件列表
    .map((名) => ({ 名, 时间: fs.statSync(path.join(ERP数据源目录, 名)).mtimeMs }))
    .sort((a, b) => b.时间 - a.时间);
  return path.join(ERP数据源目录, 带时间[0].名);
}

async function main() {
  const 参数 = 读取参数(process.argv.slice(2));
  let 请求 = 解析登记请求(取文本(参数));
  // 手工字段覆盖（消息里缺项时用）
  if (参数["店铺"]) 请求.店铺名 = 参数["店铺"];
  if (参数["订单"]) 请求.订单号 = 参数["订单"];
  if (参数["发票类型"]) 请求.发票类型 = 参数["发票类型"];
  if (参数["抬头"]) 请求.抬头 = 参数["抬头"];
  if (参数["税号"]) 请求.税号 = 参数["税号"];
  // 个人票：抬头类型=个人 → 税号允许为空（黎路遥 2026-10-06 15:38）；--个人票 是它的简写。
  if (参数["抬头类型"]) 请求.抬头类型 = 参数["抬头类型"];
  if (参数["个人票"]) 请求.抬头类型 = "个人";
  // 开票金额覆盖的说明（写进清单的待人工确认，便于事后看清为什么不是 ERP 数）
  if (参数["覆盖说明"]) 请求.开票金额覆盖说明 = 参数["覆盖说明"];
  // 开票金额覆盖（用户 2026-09-30 口径：同一订单多次申请、有一笔已取消时，按**未取消那笔**算；
  // 此时 ERP「买家支付金额」可能是已取消那笔的旧数，必须显式传 --开票金额 覆盖，并在备注里写明）。
  if (参数["开票金额"]) 请求.开票金额覆盖 = 参数["开票金额"];
  // 买家提供的开票资料（用户 2026-09-30：信息要登记齐全）——传了就写，不传不写。
  if (参数["注册地址"]) 请求.注册地址 = 参数["注册地址"];
  if (参数["注册电话"]) 请求.注册电话 = 参数["注册电话"];
  if (参数["开户银行"]) 请求.开户银行 = 参数["开户银行"];
  if (参数["开户账号"]) 请求.开户账号 = 参数["开户账号"];
  if (参数["收件手机号"]) 请求.收件手机号 = 参数["收件手机号"];
  if (参数["收件邮箱"]) 请求.收件邮箱 = 参数["收件邮箱"];
  if (!请求.订单号) {
    console.error("没有订单号，无法处理。");
    process.exitCode = 2;
    return;
  }

  // 平台应开金额：优先用 --平台读取 自动去拼多多发票中心搜（只读）
  if (参数["平台读取"]) {
    try {
      const { 读取拼多多发票中心订单 } = require("../src/拼多多发票中心");
      const 平台结果 = await 读取拼多多发票中心订单({ 店铺Id: 参数["平台读取"], 订单号: 请求.订单号 });
      if (平台结果.解析结果) {
        参数["平台金额"] = String(平台结果.解析结果.金额);
        if (!请求.抬头 && 平台结果.解析结果.抬头) 请求.抬头 = 平台结果.解析结果.抬头;
        if (!请求.税号 && 平台结果.解析结果.税号) 请求.税号 = 平台结果.解析结果.税号;
        if (!请求.抬头类型 && 平台结果.解析结果.抬头类型) 请求.抬头类型 = 平台结果.解析结果.抬头类型;
        console.log(`平台发票中心：应开 ${平台结果.解析结果.金额} 元（${平台结果.解析结果.票种}/${平台结果.解析结果.发票颜色}）`);
      } else {
        console.error("⚠ 平台发票中心没搜到这一单，本次不判差额（只用 ERP 金额）。");
      }
    } catch (错误) {
      console.error("⚠ 读平台发票中心失败：" + (错误 && 错误.message ? 错误.message : 错误) + "，本次不判差额。");
    }
  }

  const erpCsv = 找最新ErpCsv(参数["erp"]);
  if (!erpCsv || !fs.existsSync(erpCsv)) {
    console.error("找不到 ERP 数据源 CSV。先跑 10号 的 ERP 导出（菜单1），或 --erp 指定文件。");
    process.exitCode = 2;
    return;
  }
  const 行列表 = 解析Csv文本(解码Csv缓冲区(fs.readFileSync(erpCsv)));
  const 命中 = 行列表.filter((行) => {
    const 平台单号 = String(行["平台单号"] || "").trim();
    const 单据编号 = String(行["单据编号"] || "").trim();
    return 平台单号 === 请求.订单号 || 单据编号 === 请求.订单号;
  });
  if (命中.length === 0) {
    console.error(`ERP 数据源里没有订单 ${请求.订单号}（数据源：${path.basename(erpCsv)}）。可能是月份范围不含该单，或订单号抄错。`);
    process.exitCode = 2;
    return;
  }

  // 个人票判定（黎路遥 2026-10-06 15:38 口径）：请求已带抬头类型（CLI/平台只读详情）则优先，否则看 ERP「发票抬头类型」列。
  if (!请求.抬头类型) {
    const erp抬头类型 = String((命中[0] || {})["发票抬头类型"] || "").trim();
    if (erp抬头类型) 请求.抬头类型 = erp抬头类型;
  }
  请求.缺项 = [];
  if (!请求.店铺名) 请求.缺项.push("店铺");
  if (!请求.订单号) 请求.缺项.push("订单号");
  if (!请求.抬头) 请求.缺项.push("发票抬头");
  if (!请求.税号 && !是否个人票(请求)) 请求.缺项.push("税号");
  请求.可处理 = 请求.缺项.length === 0;
  if (!请求.可处理) {
    console.error("请求缺项：" + 请求.缺项.join("、") + "（企业票用 --税号；个人票用 --抬头类型 个人/--个人票 或 --发票类型 \"…- 个人\"；其余用 --店铺/--订单/--抬头 补齐）");
    process.exitCode = 2;
    return;
  }

  const 条目 = 生成待登记条目({ 请求, erp行: 命中, 平台应开金额: 参数["平台金额"] });
  const 输出路径 = 参数["输出"] ? path.resolve(参数["输出"]) : 默认输出路径;
  fs.mkdirSync(path.dirname(输出路径), { recursive: true });

  // 硬规则：禁止重复登记——同一订单号已在清单里就不追加。
  const { 查找重复登记 } = require("../src/发票规则");
  let 已有条目 = [];
  if (fs.existsSync(输出路径)) {
    已有条目 = fs.readFileSync(输出路径, "utf8").split("\n").filter(Boolean).map((行) => {
      try { return JSON.parse(行); } catch { return null; }
    }).filter(Boolean);
  }
  const 重复 = 查找重复登记(已有条目, 请求.订单号);
  if (重复.length > 0) {
    console.log(`⚠ 订单 ${请求.订单号} 已在待登记清单里（${重复.length} 条），本次不重复追加。`);
    console.log("  如需冲红/重开，请人工按三行结构处理（不修改历史行）。");
    return;
  }
  fs.appendFileSync(输出路径, JSON.stringify(条目) + "\n", "utf8");

  console.log("=== 待登记条目 ===");
  console.log(`主体：${条目.主体 || "（判不出，待人工）"} | 店铺：${条目.店铺} | 订单号：${条目.订单号}（ERP 单据 ${条目.单据编号}）`);
  console.log(`开票金额：${条目.开票金额}（平台应开：${条目.平台应开金额 ?? "未提供"}，差额：${条目.金额差额 ?? "-"}）`);
  console.log(`发票：${条目.发票类型} | 抬头：${条目.抬头} | 税号：${条目.税号}`);
  console.log(`商品：${条目.商品明细.map((g) => `${g.商品名称}/${g.规格名称}×${g.订购数}${g.赠品 ? "(赠品)" : ""}`).join("；")}`);
  if (条目.待人工确认.length > 0) console.log("待人工确认：\n  - " + 条目.待人工确认.join("\n  - "));
  else console.log("待人工确认：无");
  console.log(`已追加到：${输出路径}`);
  console.log(JSON.stringify(条目, null, 2));
}

main().catch((错误) => {
  console.error("失败：" + (错误 && 错误.message ? 错误.message : 错误));
  process.exitCode = 1;
});
