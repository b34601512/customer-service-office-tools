/* 独立编排器：驱动「店铺指标数据自动更新」CLI 跑一次汇总（主菜单 1 → 等汇总 → 回车 → 0 退出）。
 *
 * 来源与状态：原先只在系统临时目录的一次性脚本；2026-09-13 搬回项目 scripts/ 并改成相对定位。
 *             搬回后未再实跑，跑之前先确认当期菜单文案（下面 waitSummaryDone 依赖「按回车键返回」与登录提示语）。
 *
 * 踩过的坑（别重犯）：
 *   1. CLI 的 readline 关闭会丢弃缓冲 → 逐行喂 stdin。
 *   2. 进度靠「按回车键返回」出现次数推进，不用固定 sleep。
 *   3. 检测到登录类提示就写 kefu12_login.flag 提醒人工登录，流程继续等待、自动续跑。
 *   4. 中止：写 %TEMP%\kefu12_abort.flag。
 *
 * 用法：node scripts/orchestrateSummaryRun.js
 * 运行痕迹：%TEMP%\kefu12_*.log / *.flag（日志、完成标记、登录标记）。
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const tmp = "C:\\Users\\b3460\\AppData\\Local\\Temp";
const CLI_DIR = path.resolve(__dirname, "..");     // 脚本放 scripts/ 下，项目根就是它的上一级
const outLog = path.join(tmp, "kefu12_run.log");
const feedLog = path.join(tmp, "kefu12_feed.log");
const doneFlag = path.join(tmp, "kefu12_done.flag");
const loginFlag = path.join(tmp, "kefu12_login.flag");
const abortFlag = path.join(tmp, "kefu12_abort.flag");
const PAUSE_TEXT = "按回车键返回";
const LOGIN_MARKERS = ["登录已过期", "等待人工登录", "请在已打开的抖音登录", "登录失效", "请在浏览器完成"];

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
writeFeed(`cli started pid=${child.pid} at ${now()}`);

let fullText = "";
let lineBuf = "";
function pump(chunk) {
  const text = chunk.toString("utf8");
  fullText += text;
  lineBuf += text;
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

async function waitSummaryDone(maxSec) {
  const start = Date.now();
  let marked = false;
  while (Date.now() - start < maxSec * 1000) {
    if (fs.existsSync(abortFlag)) throw new Error("收到中止标记");
    if (!marked && LOGIN_MARKERS.some((m) => textHas(m))) {
      marked = true;
      fs.writeFileSync(loginFlag, "需人工登录：请在桌面已打开的独立浏览器完成验证码/滑块/过期登录，程序会继续等待并自动续跑");
      writeFeed("!! 检测到需要人工登录，已写入 login 标记");
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

    await waitSummaryDone(2700);
    feed("");      // 汇总结束 pause 回车
    await pauseMs(3000);
    feed("0");     // 主菜单退出（FIFO 顺序保证被 pause 之后的主菜单消费）

    const endWait = Date.now();
    while (child.exitCode === null && Date.now() - endWait < 120000) await pauseMs(3000);
    writeFeed(`cli exitCode=${child.exitCode} at ${now()}`);
    try { child.stdin.end(); } catch (e) {}
  } catch (err) {
    writeFeed(`ORCH ERROR: ${err.message}`);
    try { child.kill(); } catch (e) {}
  }
  if (lineBuf) fs.appendFileSync(outLog, lineBuf + "\n");
  writeFeed(`DONE ${now()}`);
  fs.writeFileSync(doneFlag, new Date().toISOString());
  process.exit(0);
})();
