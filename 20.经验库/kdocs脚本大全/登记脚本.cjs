// 《AirScript 脚本大全》登记/更新一行（一个动作：写）。
// 主键 = 项目 + 脚本动作：已存在就更新给出的列，不存在就新增。
// 用法：
//   node 登记脚本.cjs --项目 "7号 自动登记发票" --动作 write_jituan --文件 <脚本正文路径> [--用途 "…"] [--webhook <url>] [--目标文档 "科技--唐雪梅"] [--状态 生效] --已确认
//   （--文件 给了就整篇写进「脚本内容」；不给则只更新其它列）
// 没有 --已确认 只做预览，不写表。
const path = require("path");
const fs = require("fs");
const { 跑脚本 } = require(path.resolve(__dirname, "../../2.发票自动化/7.自动登记发票/src/金山脚本客户端"));

function 现在() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function main() {
  const argv = process.argv.slice(2);
  const 取 = (名) => { const i = argv.indexOf(名); return i > -1 ? argv[i + 1] : ""; };
  const 项目 = 取("--项目");
  const 动作 = 取("--动作");
  const 文件 = 取("--文件");
  if (!项目 || !动作) { console.error('用法：node 登记脚本.cjs --项目 "…" --动作 <键> [--文件 <正文路径>] [--用途 "…"] [--webhook <url>] [--目标文档 "…"] [--状态 生效] --已确认'); process.exit(2); }

  const 行 = { "项目": 项目, "脚本动作": 动作, "更新时间": 现在() };
  if (取("--用途")) 行["用途"] = 取("--用途");
  if (取("--webhook")) 行["webhook"] = 取("--webhook");
  if (取("--目标文档")) 行["目标文档"] = 取("--目标文档");
  if (取("--状态")) 行["状态"] = 取("--状态");
  if (文件) {
    const 正文路径 = path.resolve(文件);
    if (!fs.existsSync(正文路径)) { console.error(`找不到正文文件：${正文路径}`); process.exit(2); }
    行["脚本内容"] = fs.readFileSync(正文路径, "utf8");
  }

  const 已确认 = argv.includes("--已确认");
  const 结果 = await 跑脚本({ allowWrite: 已确认, row: 行 }, { 脚本: "脚本大全_写入" });
  console.log(`\n  登记脚本大全：${结果.written ? "已写入" : "未写入"}（${结果.action || ""}）`);
  if (结果.row) console.log(`  行号：第 ${结果.row} 行`);
  if (结果.message) console.log(`  说明：${结果.message}`);
  if (结果.columns) console.log(`  写入列：${结果.columns.join("、")}`);
  if (结果.readBack) console.log(`  回读：${结果.readBack.join(" | ").slice(0, 300)}`);
  if (!已确认) console.log("  （加 --已确认 才会真写）");
  console.log("");
  if (!结果.written && 已确认) process.exitCode = 1;
}

main().catch((错误) => { console.error(`\n  登记失败：${错误.message}\n`); process.exit(1); });
