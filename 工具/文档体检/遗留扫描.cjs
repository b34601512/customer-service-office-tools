// 遗留扫描：只报不删（老板 2026-10-25 六条第 6 条：垃圾文件只能人工删，禁止程序化清理）。
// 扫的是「活文档」里该被真删的东西：~~删除线~~、（作废）/【作废】/已作废 标记。
// 用法：node 遗留扫描.cjs [--根 <目录>] [--行数 N]
//   默认根 = D:\硅基公司\员工；跳过 node_modules、.pi、.state、回执/、历史档案/、归档/（历史留存不是活文档）、工作日志.md（流水账）
// 输出：按员工汇总命中数 + 每处「文件:行:内容」，给木婉清人工判断删还是留。
const fs = require('node:fs');
const path = require('node:path');

const 参数 = process.argv.slice(2);
const 取参 = (名, 默认) => {
  const i = 参数.indexOf(名);
  return i >= 0 && 参数[i + 1] ? 参数[i + 1] : 默认;
};
const 根 = 取参('--根', 'D:/硅基公司/员工');
const 每处上限 = Number(取参('--行数', '5'));
// 白名单：各家判定过「保留」的处，记下文件＋类型＋行内特征，下一轮不再报。
// 为什么不用关键词过滤指令句：指令句长得不固定，扩关键词会把真遗留一起盖掉；白名单只盖判过的那几处。
const 白名单路径 = 取参('--白名单', path.join(__dirname, '../../.state/文档体检/保留白名单.json'));
let 白名单 = [];
try { 白名单 = JSON.parse(fs.readFileSync(白名单路径, 'utf8')); } catch { 白名单 = []; }
const 规整 = (s) => String(s).replace(/\\/g, '/');
// 全量跑时相对路径带员工目录；单家跑（--根 指到某人）时只到子目录——两头都对得上才算命中。
const 白名单命中 = (白, 相对) => {
  const p = 规整(白.文件);
  return p === 相对 || 相对.endsWith('/' + p) || p.endsWith('/' + 相对);
};
let 白名单跳过 = 0;

const 跳过目录 = new Set(['node_modules', '.pi', '.state', '.git', '回执', '历史档案', '归档', '备份']);
const 命中规则 = [
  { 名: '删除线', 正则: /~~[^~\n]+~~/ },
  { 名: '作废标记', 正则: /【作废】|（作废）|\(作废\)|已作废|标记作废/ }
];

function 遍历(dir, out = []) {
  let items = [];
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const it of items) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) {
      if (跳过目录.has(it.name)) continue;
      遍历(p, out);
    } else if (it.isFile() && it.name.toLowerCase().endsWith('.md')) {
      // 工作日志与回执同理：是流水账，里面写「某某已作废」是在描述经过。不排掉的话，
      // 各家回一次帖就给下一轮添一处新命中（2026-11-07 纪晓芙实案：她自己记了一行判定，又被扫成新命中）。
      if (it.name === '工作日志.md') continue;
      out.push(p);
    }
  }
  return out;
}

const 各家 = new Map();
for (const 文件 of 遍历(根)) {
  let 文本 = '';
  try { 文本 = fs.readFileSync(文件, 'utf8'); } catch { continue; }
  const 行们 = 文本.split(/\r?\n/);
  行们.forEach((行, i) => {
    for (const 规 of 命中规则) {
      if (!规.正则.test(行)) continue;
      // 规则本身就在讲「不许留 ~~删除线~~」，这类句子不算遗留（否则每家 boot-prompt 都会被误报）
      if (/不留|六条之第 2 条|查自己家|删除线清理/.test(行)) continue;
      const 相对 = 规整(path.relative(根, 文件));
      if (白名单.some((w) => 白名单命中(w, 相对) && w.类型 === 规.名 && (!w.含 || 行.includes(w.含)))) { 白名单跳过++; break; }
      const 家 = path.relative(根, 文件).split(path.sep)[0];
      if (!各家.has(家)) 各家.set(家, []);
      各家.get(家).push({ 文件: path.relative(根, 文件), 行号: i + 1, 类型: 规.名, 内容: 行.trim().slice(0, 110) });
      break; // 一行只记一次
    }
  });
}

const 排序 = [...各家.entries()].sort((a, b) => b[1].length - a[1].length);
if (!排序.length) {
  console.log(`✓ 遗留扫描：活文档里没有删除线/作废标记${白名单跳过 ? `（有 ${白名单跳过} 处按白名单保留，不重复报）` : ''}`);
  process.exit(0);
}
let 总 = 0;
for (const [家, 处们] of 排序) {
  总 += 处们.length;
  console.log(`\n${家}：${处们.length} 处`);
  for (const 处 of 处们.slice(0, 每处上限)) console.log(`  - ${处.文件}:${处.行号} [${处.类型}] ${处.内容}`);
  if (处们.length > 每处上限) console.log(`  …还有 ${处们.length - 每处上限} 处`);
}
console.log(`\n合计 ${总} 处，涉及 ${排序.length} 位员工。**删由本人一个一个删**（删前备份）；「被否的方案/错→对」那种留着，因为它说明规则为什么被否。`);
if (白名单跳过) console.log(`（另有 ${白名单跳过} 处按白名单保留——各家判过「错→对」案例或规则句误报，不重复报；增删白名单：${规整(白名单路径)}）`);
