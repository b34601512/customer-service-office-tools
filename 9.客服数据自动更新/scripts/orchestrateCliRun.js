/* 独立编排器：把「客服数据自动更新」CLI 从主菜单一路驱动到退出，全程不用人手点。
 *
 * 来源与状态：2026-08-16 实跑通过的一次性脚本，原先只在系统临时目录；2026-09-13 搬回项目 scripts/
 *             并改成 path 相对定位（可在任意目录启动）。搬回后未再实跑，跑之前先看一眼流程是否符合当期菜单。
 *
 * 踩过的坑（别重犯）：
 *   1. CLI 的 readline 接口在关闭时会丢弃缓冲 → 必须**逐行**喂 stdin，不能一次写多行。
 *   2. 交互靠「按回车键返回」这类文本推进：用累计输出里该文本的**出现次数**判断进度，别用固定 sleep。
 *   3. 登录态过期时 CLI 会等人：检测到「登录已过期 / 等待人工登录」就写 login 标记提醒人去浏览器登录，
 *      流程继续等待并自动续跑，不要杀掉重来。
 *   4. 进程用 detached + unref 起，跑完写 done 标记；中止靠 abort 标记。
 *
 * 用法：node scripts/orchestrateCliRun.js [--date 2026-08-16]
 * 运行痕迹（日志与标记）都在 %TEMP%\kefu_*.log / *.flag，只读代码不改项目数据。
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const tmp = "C:\\Users\\b3460\\AppData\\Local\\Temp";
const CLI_DIR = path.resolve(__dirname, "..");     // 脚本放 scripts/ 下，项目根就是它的上一级
const outLog = path.join(tmp, "kefu_run2.log");
const feedLog = path.join(tmp, "kefu_feed.log");
const doneFlag = path.join(tmp, "kefu_done.flag");
const loginFlag = path.join(tmp, "kefu_login.flag");
const abortFlag = path.join(tmp, "kefu_abort.flag");
const PAUSE_TEXT = "按回车键返回";

const dateArg = (() => {
  const i = process.argv.indexOf("--date");
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  const d = new Date(Date.now() - 86400000);       // 默认昨天
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();

function writeFeed(msg) { fs.appendFileSync(feedLog, `${new Date().toLocaleTimeString("zh-CN", { hour12: false })} ${msg}\n`); }
function now() { return new Date().toLocaleTimeString("zh-CN", { hour12: false }); }

for (const f of [outLog, feedLog, doneFlag, loginFlag]) { try { fs.unlinkSync(f); } catch (e) {} }

const child = spawn("node.exe", ["src/cli/startCli.js"], {
  cwd: CLI_DIR,
  stdio: ["pipe", "pipe", "pipe"],
  detached: true,
  windowsHide: true
});
child.unref();
writeFeed(`cli started pid=${child.pid} at ${now()} 统计日期=${dateArg}`);

let fullText = "";
let lineBuf = "";
function pump(chunk) {
  fullText += chunk.toString("utf8");
  lineBuf += chunk.toString("utf8");
  const lines = lineBuf.split(/\r?\n/);
  lineBuf = lines.pop();
  for (const line of lines) fs.appendFileSync(outLog, line + "\n");
}
child.stdout.on("data", pump);
child.stderr.on("data", pump);

function pauseMs(ms) { return new Promise((r) => setTimeout(r, ms)); }
function textHas(marker) { return fullText.includes(marker); }
function countPause() {
  const escaped = PAUSE_TEXT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (fullText.match(new RegExp(escaped, "g")) || []).length;
}

async function waitPause(previousCount, maxSec) {
  const start = Date.now();
  while (Date.now() - start < maxSec * 1000) {
    if (fs.existsSync(abortFlag)) throw new Error("收到中止标记");
    if (countPause() > previousCount) return;
    await pauseMs(3000);
  }
  throw new Error(`等待“${PAUSE_TEXT}”超时 ${maxSec}s`);
}

async function waitSummaryDone(maxSec) {
  const start = Date.now();
  let marked = false;
  while (Date.now() - start < maxSec * 1000) {
    if (fs.existsSync(abortFlag)) throw new Error("收到中止标记");
    if (textHas("登录已过期") || textHas("等待人工登录")) {
      if (!marked) {
        marked = true;
        fs.writeFileSync(loginFlag, "需人工登录：请在桌面已打开的浏览器完成验证码/滑块登录，程序会继续等待并自动续跑");
        writeFeed("!! 检测到需要人工登录，已写入 login 标记");
      }
    }
    if (countPause() > 0) return;
    if (child.exitCode !== null) throw new Error(`CLI 提前退出:${child.exitCode}`);
    await pauseMs(3000);
  }
  throw new Error("等待汇总完成超时");
}

function feed(line) {
  child.stdin.write(line + "\n");
  writeFeed(`fed [${line || "(回车)"}] at ${now()}`);
}

(async () => {
  try {
    const s0 = Date.now();
    while (!textHas("请选择：")) {
      if (Date.now() - s0 > 90000) throw new Error("主菜单未在 90s 内出现");
      if (child.exitCode !== null) throw new Error(`CLI 提前退出:${child.exitCode}`);
      await pauseMs(2000);
    }
    feed("1");

    await waitSummaryDone(1800);
    feed("");

    await pauseMs(2000); feed("a");
    await pauseMs(2000); feed("1");
    await waitPause(countPause(), 1200);
    feed("");

    await pauseMs(2000); feed("2");
    await pauseMs(2000); feed(dateArg);
    await waitPause(countPause(), 600);
    feed("");

    await pauseMs(2000); feed("3");
    await waitPause(countPause(), 600);
    feed("");

    await pauseMs(2000); feed("0");
    await pauseMs(2000); feed("0");

    const endWait = Date.now();
    while (child.exitCode === null && Date.now() - endWait < 120000) await pauseMs(3000);
    writeFeed(`cli exitCode=${child.exitCode} at ${now()}`);
    try { child.stdin.end(); } catch (e) {}
  } catch (err) {
    writeFeed(`ORCH ERROR: ${err.message}`);
    try { child.kill(); } catch (e) {}
  }
  // 收尾：把未换行的残留输出写到文件
  if (lineBuf) fs.appendFileSync(outLog, lineBuf + "\n");
  writeFeed(`DONE ${now()}`);
  fs.writeFileSync(doneFlag, new Date().toISOString());
  process.exit(0);
})();
