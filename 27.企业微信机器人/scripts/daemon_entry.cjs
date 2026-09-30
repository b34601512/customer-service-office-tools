// ASCII 入口：给 静默启动.vbs 调用（WSH 不能碰非 ASCII，所以入口文件名必须是纯 ASCII）。
// 为什么单独一个文件：
//   ① 守护本体是 scripts/长连接守护.js（中文名），.vbs 里不能写中文路径；
//   ② 开机自启是**无窗口**跑的，控制台输出看不见 → 这里把 stdout/stderr 落进 .state/daemon.log；
//   ③ 同一机器人只允许一条长连接 → 已有守护在跑就直接跳过，绝不重复开（赵敏那边踩过的坑）。
const fs = require("fs");
const path = require("path");

const 根 = path.join(__dirname, "..");
const 状态 = path.join(根, ".state");
const 日志 = path.join(状态, "daemon.log");
const PID = path.join(状态, "daemon.pid");
const 日志上限 = 2 * 1024 * 1024;   // 2 MB，超了就清空（运行产物不需要继承）

try { fs.mkdirSync(状态, { recursive: true }); } catch {}

function 清日志() {
  try {
    if (fs.existsSync(日志) && fs.statSync(日志).size > 日志上限) fs.truncateSync(日志, 0);
  } catch {}
}

function 在跑的守护() {
  try {
    const pid = Number(String(fs.readFileSync(PID, "utf8")).trim());
    if (!pid) return 0;
    process.kill(pid, 0);   // 活着就不抛错
    return pid;
  } catch {
    return 0;
  }
}

清日志();
// 用同步写：异步流没 flush 就 process.exit() 会把"已有守护在跑"这类关键行丢掉（实测丢过）
function 落日志(s) {
  try { fs.appendFileSync(日志, s, "utf8"); } catch {}
}

const 旧 = 在跑的守护();
if (旧) {
  落日志(`[${new Date().toISOString()}] 已有守护在跑（pid ${旧}），不重复开\n`);
  process.exit(0);
}

// 无窗口运行时控制台输出会丢：把 console 也写一份进日志文件
for (const 名 of ["log", "info", "warn", "error"]) {
  const 原 = console[名].bind(console);
  console[名] = (...a) => {
    落日志(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ") + "\n");
    原(...a);
  };
}
落日志(`\n[${new Date().toISOString()}] —— 静默启动：拉起长连接守护 ——\n`);

require("./长连接守护.js");
