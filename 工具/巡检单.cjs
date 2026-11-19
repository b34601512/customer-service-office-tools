// 每日巡检单：把老板口述的巡检流程固化成一张单子，按棒走、不靠记。
//
// 为什么有它（老板 2026-11-19 17:5x 原话）：「你看下以后这些流程是否可以工具号，免得每次文档容易漏」。
// 起因：当天漏了单子第 12 条（发票巡检要交棒给 05 号李沅芷），因为单子只存在于企微消息的引用里。
//
// 用法：
//   node 工具/巡检单.cjs                  # 今天走到哪：每项状态 + 当前该谁
//   node 工具/巡检单.cjs --勾 6 --备注 "未退回 5 行"   # 打勾（可写备注）
//   node 工具/巡检单.cjs --交 2           # 打第 2 棒：交接给李沅芷（打印私信正文，不代发）
//   node 工具/巡检单.cjs --交 3           # 第 3 棒是老板自己派，这里只提示
//   node 工具/巡检单.cjs --重置           # 清掉今天的记录（重跑当天用）
//   node 工具/巡检单.cjs --单子           # 只打印单子定义（不看状态）
//
// 状态存 `记录/巡检/<YYYY-MM-DD>.json`。单子定义在 `工具/巡检单.json`（唯一真源）。
const fs = require("fs");
const path = require("path");

const 家 = path.join(__dirname, "..");
const 单子路径 = path.join(__dirname, "巡检单.json");
const 记录目录 = path.join(家, "记录", "巡检");

function 本地日(d = new Date()) {
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function 读单子() {
  return JSON.parse(fs.readFileSync(单子路径, "utf8"));
}

function 状态路径(日) {
  return path.join(记录目录, `${日}.json`);
}

function 读状态(日) {
  const p = 状态路径(日);
  if (!fs.existsSync(p)) return { 日, 项: {}, 棒: {} };
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function 写状态(s) {
  fs.mkdirSync(记录目录, { recursive: true });
  fs.writeFileSync(状态路径(s.日), JSON.stringify(s, null, 2), "utf8");
}

function 全部项(单子) {
  return 单子.棒.flatMap((b) => b.项.map((x) => ({ ...x, 棒: b.棒, 负责人: b.负责人, 岗: b.岗 })));
}

function 打印(单子, 状态) {
  const 项 = 全部项(单子);
  const 完 = 项.filter((x) => 状态.项[x.编号]?.完).length;
  console.log(`\n巡检单 ${状态.日}　${完}/${项.length} 项已勾\n`);
  for (const b of 单子.棒) {
    const 本棒完 = b.项.every((x) => 状态.项[x.编号]?.完);
    const 标 = 本棒完 ? "✓" : 状态.棒[b.棒]?.交 ? "…" : " ";
    console.log(`${标} 第 ${b.棒} 棒　${b.负责人}（${b.岗}）`);
    for (const x of b.项) {
      const st = 状态.项[x.编号];
      const 勾 = st?.完 ? "☑" : "☐";
      console.log(`   ${勾} ${String(x.编号).padStart(2)} ${x.名}${st?.备注 ? `　— ${st.备注}` : ""}`);
      if (!st?.完) console.log(`        验收：${x.验收}`);
    }
    console.log("");
  }
  const 当前 = 单子.棒.find((b) => !b.项.every((x) => 状态.项[x.编号]?.完));
  if (!当前) {
    console.log("今天全跑完了。别忘了每周一句话小结（没异常不打扰）。");
  } else {
    console.log(`当前该：第 ${当前.棒} 棒 ${当前.负责人}（${当前.岗}）`);
    if (!状态.棒[当前.棒]?.交) console.log(`交接还没发 → node 工具/巡检单.cjs --交 ${当前.棒}`);
  }
  console.log("");
}

function 打勾(状态, 编号, 备注) {
  const 日 = 状态.日;
  const 时 = new Date().toTimeString().slice(0, 5);
  状态.项[编号] = { 完: true, 时, ...(备注 ? { 备注 } : {}) };
  写状态(状态);
  console.log(`☑ ${编号} 已勾（${日} ${时}）${备注 ? `　${备注}` : ""}`);
}

const 交接正文 = {
  2: () => `李沅芷，今天巡检跑完了（8 项全收口），按老板定的串行顺序轮到你接力：请你跑一次发票巡检。

今天跟发票有关的异常数：
（这里填：ERP 未审核几条、天猫待同意几条、其它发票类异常——没数就写「今天没有发票类异常报到我这儿」）

要你做三件：
1）跑一次发票巡检，回我一份回执（跑了什么、几条、结论）。
2）跑完留一扇 TUI 界面给老板亲自验收——入口用发票自动化那个 bat，窗口别自己关。
3）天猫「待同意」照旧不自动点。

规矩不变：平台后台只读、要验证码滑块就停、失败不自动重试、数字只认真实产物。`,
  3: () => `第 3 棒是 06 号骆冰接 22 号（天猫/拼多多/京东/抖音/有赞后台漏处理复查）。
老板原话：这一段他自己派、自己盯，我只留位置——不代发、不替他催。
交棒前只需把「今天巡检＋发票巡检」的结果各一句备好，他问就答。`,
};

function 交棒(状态, 棒) {
  const 正 = 交接正文[棒];
  if (!正) {
    console.log(`第 ${棒} 棒没有交接模板（只有 2、3 有）。`);
    return;
  }
  状态.棒[棒] = { 交: true, 时: new Date().toTimeString().slice(0, 5) };
  写状态(状态);
  console.log(`\n── 第 ${棒} 棒交接（已记账；正文自己过一遍再发，工具不代发）──\n`);
  console.log(正());
  console.log("");
}

const 参数 = process.argv.slice(2);
const 取值 = (名) => {
  const i = 参数.indexOf(名);
  return i >= 0 ? 参数[i + 1] : undefined;
};

const 单子 = 读单子();
const 日 = 本地日();

if (参数.includes("--单子")) {
  for (const b of 单子.棒) {
    console.log(`\n第 ${b.棒} 棒　${b.负责人}（${b.岗}）`);
    for (const x of b.项) console.log(`  ${String(x.编号).padStart(2)} ${x.名}　— ${x.验收}`);
  }
  console.log("\n平时盯梢：");
  for (const x of 单子.平时盯梢) console.log(`  · ${x}`);
  console.log("\n红线：");
  for (const x of 单子.红线) console.log(`  · ${x}`);
  console.log("");
  process.exit(0);
}

if (参数.includes("--重置")) {
  const p = 状态路径(日);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  console.log(`已清掉 ${日} 的记录。`);
  process.exit(0);
}

const 状态 = 读状态(日);

if (参数.includes("--勾")) {
  const 编号 = Number(取值("--勾"));
  if (!编号) {
    console.error("用法：--勾 <编号> [--备注 \"…\"]");
    process.exit(2);
  }
  打勾(状态, 编号, 取值("--备注"));
  process.exit(0);
}

if (参数.includes("--交")) {
  const 棒 = Number(取值("--交"));
  if (!棒) {
    console.error("用法：--交 <棒号>（2=李沅芷、3=骆冰）");
    process.exit(2);
  }
  交棒(状态, 棒);
  process.exit(0);
}

打印(单子, 状态);
