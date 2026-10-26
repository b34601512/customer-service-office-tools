// 2026-10-26 任务：把 1号 采到的客服数据汇总成运营表一行一人
//
// 口径来源（不许自创）：
//   · 阈值：1号 project-config/stats-config.json（应答 15s／超时 15s／跨夜 3600s／响应上限 180s）
//   · 同会话去重：1号 scripts/归档dry旧片段.cjs「同会话 id 取消息更多的那行」
//   · 字段定义：运营表《小蟹平台客服数据》「数据公式」子表 + 本任务单第 1~12 条
//
// 读出 → 去重 → 按客服汇总 → 落 JSON（dry-run，不碰表格）
// 用法：node 汇总10月.cjs [--out 汇总.json]
const fs = require("node:fs");
const path = require("node:path");

const 源目录 =
  (() => { const i = process.argv.indexOf("--源"); return i > -1 ? process.argv[i + 1] : path.join(__dirname, "源数据快照"); })();
const 配置路径 = "D:/硅基公司/员工/巡检员·霍青桐/专项/1.客服超时督办/project-config/stats-config.json";
const 阈值 = JSON.parse(fs.readFileSync(配置路径, "utf8"));

const 抓天数 = (n) => Math.round(Number(n) * 10) / 10; // 1号 习惯：保留 1 位小数
const 抓比例 = (n) => Math.round(Number(n) * 10000) / 10000; // 应答率/占比：4 位
const 抓两位 = (n) => Math.round(Number(n) * 100) / 100; // 每个客户平均轮次/消息数：2 位

function 读全部() {
  const 文件 = [];
  for (const f of fs.readdirSync(path.join(源目录, "补录")).sort()) {
    if (/^2026-10-\d{2}\.jsonl$/.test(f)) 文件.push(path.join(源目录, "补录", f));
  }
  for (const d of ["2026-10-24", "2026-10-25", "2026-10-26"]) {
    const p = path.join(源目录, d + ".jsonl");
    if (fs.existsSync(p)) 文件.push(p);
  }
  const 行 = [];
  for (const f of 文件) {
    for (const l of fs.readFileSync(f, "utf8").split("\n")) {
      if (!l.trim()) continue;
      const o = JSON.parse(l);
      o.__文件 = path.basename(f);
      o.__在补录 = f.includes("补录");
      行.push(o);
    }
  }
  return { 文件, 行 };
}

const 消息数 = (r) => (Number(r.客户消息数) || 0) + (Number(r.客服消息数) || 0);

// 去重：同一会话 id 只留一份（消息最多的那份）；一样多时优先补录（补录是后补的更完整）
function 去重(行) {
  const 表 = new Map();
  for (const r of 行) {
    const 旧 = 表.get(r.会话id);
    if (!旧) { 表.set(r.会话id, r); continue; }
    if (消息数(r) > 消息数(旧)) 表.set(r.会话id, r);
    else if (消息数(r) === 消息数(旧) && r.__在补录 && !旧.__在补录) 表.set(r.会话id, r);
  }
  return [...表.values()];
}

function 单人汇总(行们) {
  const 客户集 = new Set();
  let 客户消息数 = 0, 客服消息数 = 0, 轮次 = 0;
  let 首响合计 = 0, 首响样本 = 0;
  const 全部响应 = [];
  const 日集 = new Set();
  for (const r of 行们) {
    if (Number(r.客户消息数) > 0) 客户集.add(String(r.客户id || r.会话id || ""));
    客户消息数 += Number(r.客户消息数) || 0;
    客服消息数 += Number(r.客服消息数) || 0;
    轮次 += Number(r.对话轮次) || 0;
    if (r.归属日) 日集.add(r.归属日);
    const 首 = r.首次响应秒 == null ? null : Number(r.首次响应秒);
    if (首 != null && 首 <= 阈值.跨夜秒) { 首响合计 += 首; 首响样本 += 1; }
    for (const v of Array.isArray(r.响应秒列表) ? r.响应秒列表 : []) if (v != null) 全部响应.push(Number(v));
  }
  const 有效 = 全部响应.filter((v) => v <= 阈值.跨夜秒); // 样本：剔除跨夜（>3600）
  const 进均值 = 全部响应.filter((v) => v <= 阈值.响应上限秒); // 均值：≤180
  const 超时条数 = 有效.filter((v) => v > 阈值.超时秒).length;
  const 超时条数_含跨夜 = 全部响应.filter((v) => v > 阈值.超时秒).length;
  const 客户数 = 客户集.size;
  return {
    服务客户数: 客户数 || null,
    对话轮次: 轮次,
    发送消息数: 客服消息数,
    每个客户平均对话轮次: 客户数 ? 抓两位(轮次 / 客户数) : null,
    每个客户平均发消息数: 客户数 ? 抓两位(客服消息数 / 客户数) : null,
    平均首次响应秒: 首响样本 ? 抓天数(首响合计 / 首响样本) : null,
    "15s应答率": 有效.length ? 抓比例((有效.length - 超时条数) / 有效.length) : null,
    平均响应秒: 进均值.length ? 抓天数(进均值.reduce((a, b) => a + b, 0) / 进均值.length) : null,
    最长回复秒: 全部响应.length ? Math.max(...全部响应) : null,
    "响应超时次数_15秒": 超时条数,
    "15秒超时占比": 有效.length ? 抓比例(超时条数 / 有效.length) : null,
    数据覆盖天数: 日集.size,
    // 核对用的中间量（不写进表）
    会话数: 行们.length,
    响应样本数_有效: 有效.length,
    响应样本数_进均值: 进均值.length,
    响应样本数_全部: 全部响应.length,
    跨夜条数: 全部响应.length - 有效.length,
    超时条数_含跨夜: 超时条数_含跨夜,
    客户消息数,
    日期们: [...日集].sort()
  };
}

function 主() {
  const { 文件, 行 } = 读全部();
  const 去重后 = 去重(行);
  const 按人 = new Map();
  for (const r of 去重后) {
    const 名 = String(r.客服名 || "");
    if (!按人.has(名)) 按人.set(名, []);
    按人.get(名).push(r);
  }
  const 人 = [];
  for (const [名, 行们] of 按人) 人.push({ 客服名: 名, ...单人汇总(行们) });
  // 排序：售后组在前（客服→组长→文员），售前组在后，组内按对话轮次从多到少
  const 岗位次序 = (名) => (/售后组长/.test(名) ? 1 : /售后客服/.test(名) ? 0 : /售后文员/.test(名) ? 2 : /售前/.test(名) ? 3 : 4);
  人.sort((a, b) => 岗位次序(a.客服名) - 岗位次序(b.客服名) || b.对话轮次 - a.对话轮次);

  const 结果 = {
    生成时间: new Date().toISOString(),
    阈值,
    源文件数: 文件.length,
    源文件: 文件.map((f) => path.relative(源目录, f)),
    原始行数: 行.length,
    去重后会话数: 去重后.length,
    重复会话数: 行.length - 去重后.length,
    覆盖日期: [...new Set(去重后.map((r) => r.归属日))].sort(),
    按客服: 人
  };
  const out = (() => { const i = process.argv.indexOf("--out"); return i > -1 ? process.argv[i + 1] : path.join(__dirname, "汇总结果.json"); })();
  fs.writeFileSync(out, JSON.stringify(结果, null, 2), "utf8");
  console.log(`源文件 ${结果.源文件数} 个｜原始 ${结果.原始行数} 行｜去重后 ${结果.去重后会话数} 条会话｜覆盖 ${结果.覆盖日期.length} 天`);
  console.log("客服名".padEnd(22) + ["客户数", "轮次", "消息数", "均轮次", "均消息", "均首响", "15s应答", "均响应", "最长", "超时", "超时占比", "天数"].join("\t"));
  for (const p of 人) {
    console.log(
      p.客服名.padEnd(22) +
        [p.服务客户数, p.对话轮次, p.发送消息数, p.每个客户平均对话轮次, p.每个客户平均发消息数, p.平均首次响应秒,
          p["15s应答率"], p.平均响应秒, p.最长回复秒, p["响应超时次数_15秒"], p["15秒超时占比"], p.数据覆盖天数].join("\t")
    );
  }
  console.log(`\n明细已写 ${out}`);
}

主();
