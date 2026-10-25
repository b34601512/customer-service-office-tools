// 拆 判据库-实测记录.md → 判据库/ 下按原编号段分文件（只搬不改，带逐字节回拼校验）
// 用法：node 0.木婉清档案/工具/拆判据库.cjs [--写]
const fs = require("fs");
const path = require("path");

const 档案 = path.resolve(__dirname, "..");
const 主文件 = path.join(档案, "判据库-实测记录.md");
const 目录 = path.join(档案, "判据库");
const 写 = process.argv.includes("--写");

const L = fs.readFileSync(主文件, "utf8").split(/\r?\n/);
const i85 = L.findIndex(s => s.startsWith("## 八·五"));
const i86 = L.findIndex(s => s.startsWith("## 八·六"));
const i87 = L.findIndex(s => s.startsWith("## 八·七"));
if (i85 < 0 || i86 < 0 || i87 < 0) throw new Error("找不到八·五/八·六/八·七 标题");

const re条 = /^\*\*([一二三四五六七八九十百零]{1,6})条?、/;
const 八七条 = [];
for (let i = i87; i < L.length; i++) if (re条.test(L[i])) 八七条.push(i);

const 段界 = [0, 70, 140, 210, 280, 350, 420, 480, 八七条.length];
const 段名 = (a, b) => `判据-${String(3 + 段界.indexOf(a)).padStart(2, "0")}-逐条实测${String(a + 1).padStart(3, "0")}-${String(b).padStart(3, "0")}.md`;

const 文件们 = [];
const 加 = (名, 说明, 行) => 文件们.push({ 名, 说明, 行 });

加("判据-01-写发类（八·五）.md", "", L.slice(i85, i86));
加("判据-02-对账报数字段（八·六）.md", "", L.slice(i86, i87));

for (let k = 0; k < 段界.length - 1; k++) {
  const a = 段界[k], b = 段界[k + 1];
  const s = a === 0 ? i87 : 八七条[a]; // 第一段连 `## 八·七、…` 标题与导语一起搬
  const e = b < 八七条.length ? 八七条[b] : L.length;
  加(段名(a, b), 段名(a, b), L.slice(s, e));
}

// —— 每个文件加头（只加不改；头用固定标记行，回拼时剥掉） ——
const 头标记 = "<!-- 拆库头 -->";
const 做法 = 行 => {
  const 正文 = 行.slice();
  // 八·七 第 1 段自带 `## 八·七、…` 标题，其余段补一行指回
  return 正文;
};

const 结果 = 文件们.map((f, i) => {
  const 段号 = f.名.match(/逐条实测(\d+)-(\d+)/);
  const 范围 = 段号 ? `第 ${Number(段号[1])}–${Number(段号[2])} 条` : "";
  const 标题 = f.名.replace(/\.md$/, "");
  const 头 = [
    头标记,
    `# ${标题}`,
    "",
    `> 从 [\`判据库-实测记录.md\`](../判据库-实测记录.md) 拆出（2026-10-25，**只搬不改**：原条目、标题、日期、证据路径一字未动）。`,
    `> 索引与常用搜法见主文件；本文件内容按原顺序排列${范围 ? "，" + 范围 : ""}。`,
    头标记,
    ""
  ];
  return { ...f, 头行数: 头.length, 文本: [...头, ...f.行].join("\n"), 内容行数: f.行.length };
});

// —— 硬校验：把所有文件的「内容部分」按原顺序拼回，必须与原文从 i85 起到结尾逐字节相同 ——
const 原文尾段 = L.slice(i85).join("\n");
// 从「实际写出的文本」剥掉头，再按顺序拼——验的是真会落盘的东西
const 拼回 = 结果
  .map(r => r.文本.split("\n").slice(r.头行数).join("\n"))
  .join("\n");
if (拼回 !== 原文尾段) {
  const a = 拼回.split("\n"), b = 原文尾段.split("\n");
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  throw new Error(`回拼不一致：第 ${i + 1} 行\n我: ${JSON.stringify(a[i])}\n原: ${JSON.stringify(b[i])}`);
}
// 条目计数校验
const 统计 = 结果.map(r => ({ 名: r.名, 条数: r.内容行数, 字节: Buffer.byteLength(r.文本, "utf8"), 编号条: r.行.filter(x => re条.test(x)).length, 小节: r.行.filter(x => x.startsWith("### ")).length }));
const 总条 = 统计.reduce((a, b) => a + b.编号条 + b.小节, 0);
const 原条 = 八七条.length + L.slice(i85, i87).filter(x => re条.test(x) || x.startsWith("### ")).length;
console.log(`对账：分文件条目 ${总条} ／ 原文条目 ${原条} → ${总条 === 原条 ? "✓ 一致" : "✗ 不一致"}`);
if (总条 !== 原条) process.exit(2);

if (写) {
  fs.mkdirSync(目录, { recursive: true });
  结果.forEach(r => fs.writeFileSync(path.join(目录, r.名), r.文本, "utf8"));
  fs.writeFileSync(path.join(目录, ".拆库对账.json"), JSON.stringify(统计, null, 2), "utf8");
  console.log("已写入", 目录);
}
统计.forEach(s => console.log(`${s.名}  行${s.条数}  字节${s.字节}  编号条${s.编号条} 小节${s.小节}`));
