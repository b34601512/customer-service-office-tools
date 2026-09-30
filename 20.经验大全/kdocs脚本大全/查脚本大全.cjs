// 《AirScript 脚本大全》只读查询（一个动作：读）。
// 用法：
//   node 查脚本大全.cjs                       → 列全部登记行（不含脚本正文）
//   node 查脚本大全.cjs --项目 "7号"           → 只看某项目
//   node 查脚本大全.cjs --动作 write_jituan --正文   → 打印某脚本正文全文
//   node 查脚本大全.cjs --动作 write_jituan --导出 ../x.md  → 正文写到本地文件
// 配置：2.发票自动化/7.自动登记发票/project-config/kdocs-airscript.json（含 apiToken 与 脚本大全_读取 的 webhook，不入库）
const path = require("path");
const fs = require("fs");
const { 跑脚本 } = require(path.resolve(__dirname, "../../2.发票自动化/7.自动登记发票/src/金山脚本客户端"));

async function main() {
  const argv = process.argv.slice(2);
  const 取 = (名) => { const i = argv.indexOf(名); return i > -1 ? argv[i + 1] : ""; };
  const 项目 = 取("--项目");
  const 动作 = 取("--动作");
  const 导出 = 取("--导出");
  const 要正文 = argv.includes("--正文") || Boolean(导出);

  const 结果 = await 跑脚本({ limit: 500 }, { 脚本: "脚本大全_读取" });
  let 行 = 结果.rows || [];
  if (项目) 行 = 行.filter((r) => String(r["项目"] || "").includes(项目));
  if (动作) 行 = 行.filter((r) => String(r["脚本动作"] || "") === 动作);
  console.log(`\n  《AirScript 脚本大全》：${结果.sheet}　共 ${行.length} 行（脚本版本 ${结果.scriptVersion}）`);
  for (const r of 行) {
    console.log(`  第${r.row}行｜${r["项目"]}｜${r["脚本动作"]}｜${r["用途"] || ""}｜${r["状态"] || ""}｜${r["更新时间"] || ""}`);
  }
  if (要正文) {
    const 目标 = 行[0];
    if (!目标) { console.log("  （没找到要打印的行）"); return; }
    if (导出) {
      fs.writeFileSync(path.resolve(导出), 目标["脚本内容"] || "", "utf8");
      console.log(`  正文已导出：${导出}（${(目标["脚本内容"] || "").length} 字）`);
    } else {
      console.log(`\n  ── ${目标["项目"]} / ${目标["脚本动作"]} 正文 ──\n`);
      console.log(目标["脚本内容"] || "(空)");
    }
  }
  console.log("");
}

main().catch((错误) => { console.error(`\n  查询失败：${错误.message}\n`); process.exit(1); });
