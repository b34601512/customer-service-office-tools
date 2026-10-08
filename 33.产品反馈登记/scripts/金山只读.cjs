// 33号 共用「只读读表」薄壳：调 24号 的 read-kdocs.js（2026-09-30 收拢后的共享读表核心，匿名无头）。
//
// 为什么这样干：读表核心/命令行（tools/金山表）是唯一出处，33号 不重造；24号 的薄壳里已经装好 chromium，
// 直接当子进程调，避免 33号 再装一套 playwright。只读，不改任何文档。
// 失败不自动重试（用户铁律），失败就把错误抛给调用方。
//
// 用法：
//   const { 读工作表 } = require("./金山只读.cjs");
//   const { 矩阵, 落盘 } = 读工作表({ 表: "交接跟进表", 工作表: "产品问题" });
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const 项目根 = path.resolve(__dirname, "..");
const 仓库根 = path.resolve(项目根, "..");
const 读表CLI = path.join(仓库根, "24.平台退款复查", "src", "tools", "read-kdocs.js");

// 表链接放本机 project-config/links.local.json（不入库）。
function 读链接() {
  const 配置路径 = path.join(项目根, "project-config", "links.local.json");
  if (!fs.existsSync(配置路径)) {
    throw new Error(`缺少本机表链接配置 ${path.relative(仓库根, 配置路径)}` +
      `（形如 {"交接跟进表":"https://www.kdocs.cn/l/…"}，不入库）`);
  }
  return JSON.parse(fs.readFileSync(配置路径, "utf8"));
}

// 读一个工作表全量矩阵：{ 矩阵, 工作表, 落盘 }。落盘相对 33号 根目录；不给就落 runtime/读表-<表名>-<时间戳>.json。
function 读工作表({ 表, 工作表, 落盘 = "", 超时毫秒 = 240000 }) {
  const 链接 = 读链接()[表];
  if (!链接) throw new Error(`links.local.json 里没有「${表}」的表链接`);
  const 输出 = 落盘
    ? path.resolve(项目根, 落盘)
    : path.join(项目根, "runtime", `读表-${工作表}-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(输出), { recursive: true });
  const 参数 = [读表CLI, "--url", 链接, "--sheet", 工作表, "--out", 输出];
  const 进程 = spawnSync(process.execPath, 参数, {
    cwd: path.join(仓库根, "24.平台退款复查"),
    encoding: "utf8",
    timeout: 超时毫秒,
    maxBuffer: 128 * 1024 * 1024
  });
  const 输出文本 = `${进程.stdout || ""}\n${进程.stderr || ""}`.trim();
  if (进程.error) throw new Error(`读表进程启动/超时失败：${进程.error.message}`);
  if (进程.status) throw new Error(`读表失败（退出码 ${进程.status}）：${输出文本.slice(-800)}`);
  if (!fs.existsSync(输出)) throw new Error(`读表命令声称成功但没生成文件：${输出}`);
  const 结果 = JSON.parse(fs.readFileSync(输出, "utf8"));
  return { 链接, 矩阵: 结果.matrix || [], 工作表: 结果.sheetName, 落盘: 输出 };
}

module.exports = { 读链接, 读工作表, 项目根, 仓库根 };
