// 本文件只是命令行入口：解析参数 → 调用业务真源 → 打印结果。零业务判断（#624 边界）。
const readline = require("readline");
const { monitorOnce, startMonitorLoop, loadMonitorState } = require("../features/workOrderMonitor/service");
const { loginAssist } = require("../features/workOrderMonitor/loginAssist");
const { resolveDuty, buildMentionPlan } = require("../features/dutySchedule/dutyService");
const { loadConfig } = require("../config/projectConfigService");
const { log, setConsoleEnabled } = require("../engine/logger");
const { formatOnceResult } = require("./formatOnceResult");
const { runLiveMenu } = require("./tuiSelect");
const { buildStatusLines } = require("./menuStatus");

function printHelp() {
  console.log(`
14号后台工单自动提醒 —— 命令用法
  node src/cli/startCli.js once                立即巡检一轮（发现新工单就发提醒）
  node src/cli/startCli.js run                 启动常驻监控（窗口保持打开）
  node src/cli/startCli.js login <店铺key>     拉起该店铺的可见浏览器，人工登录后保持登录态
  node src/cli/startCli.js status              查看各提醒源最近一次计数与登录状态
  node src/cli/startCli.js duty                查看今日值班/当前在班与底色（验证金山排班读取）
  node src/cli/startCli.js menu                进入交互菜单
不带参数且有终端时默认进入菜单。`);
}

function buildStatusText() {
  const state = loadMonitorState();
  const rows = Object.entries(state.sources || {});
  if (rows.length === 0) {
    return "还没有巡检记录，先按 3 巡检一轮。";
  }
  const 行 = [];
  for (const [id, src] of rows) {
    const counts = src.counts ? JSON.stringify(src.counts) : "无数据";
    行.push(`${id}  状态=${src.status}  计数=${counts}`);
  }
  行.push(`最近一轮巡检时间：${state.lastRoundAt ? new Date(state.lastRoundAt).toLocaleString() : "无"}`);
  return 行.join("\n");
}

async function buildDutyText() {
  const config = loadConfig();
  const now = new Date();
  const result = await resolveDuty(config, now);
  if (!result.ok) {
    return `排班读取失败：${result.error}`;
  }
  const 行 = [`今日（${now.getMonth() + 1}月${now.getDate()}日）${config.duty.group}值班：`];
  for (const item of result.todayStaff) {
    行.push(`  ${item.name}  ${item.shift}  底色：${item.colorName || "无"}${item.colorRgb ? `（${item.colorRgb}）` : ""}`);
  }
  行.push("按规则应@（组长在班就@组长；其他人看底色标记）：");
  for (const item of result.atStaff) {
    行.push(`  ${item.name}（${item.reason}）`);
  }
  const plan = buildMentionPlan(config, result);
  行.push(`最终@名单（含主管）：${plan.atNames.join("、") || "无"}`);
  行.push(`手机号：${plan.mobiles.join("、") || "无"}`);
  return 行.join("\n");
}

// 常驻监控句柄 + 界面要读的状态（running/是否在抓/上次抓到时间/下一轮时刻/本轮摘要/错误）。
// 只做状态与启停，业务判定全在 service。
function createMenuController(note) {
  let loop = null;
  let 最近消息 = "";
  return {
    setMessage(文本) {
      最近消息 = 文本;
    },
    getStatus() {
      const 基础 = {
        running: false,
        intervalMs: (Number(loadConfig().monitor.intervalMinutes) || 10) * 60000,
        warmupDone: true,
        roundInProgress: false,
        lastRoundAt: null,
        nextRoundAt: null,
        lastSummary: null,
        lastError: null,
        lastMessage: 最近消息
      };
      if (!loop) return 基础;
      return { ...基础, ...loop.getStatus(), lastMessage: 最近消息 };
    },
    start() {
      if (loop) return "常驻监控已在运行。";
      loop = startMonitorLoop((err, result) => {
        note(
          err
            ? `本轮异常：${err.message}`
            : `本轮完成：事件 ${result.events.length} 个，发送 ${result.sent.filter((item) => item.ok).length} 条。`
        );
      }, { keepBrowsersOpen: true });
      return "已启动常驻监控（窗口保持打开，发现新工单会发提醒）。";
    },
    stop() {
      if (!loop) return "当前没有运行中的常驻监控。";
      loop.stop();
      loop = null;
      return "已停止常驻监控（浏览器窗口留着）。";
    },
    dispose() {
      if (loop) loop.stop();
      loop = null;
    }
  };
}

// 菜单动作 → 业务调用。界面层（TUI/输入式）只提供 io.ask / io.showText / io.note，逻辑只有这一份。
async function handleMenuAction(action, ctl, io) {
  if (action === "quit") return "quit";
  if (action === "run") {
    io.note(ctl.start());
    return;
  }
  if (action === "stop") {
    io.note(ctl.stop());
    return;
  }
  if (action === "once") {
    const r = await monitorOnce().catch((error) => (log("菜单", "巡检", "失败", error.message), null));
    if (r) io.note(`完成：事件 ${r.events.length} 个，发送成功 ${r.sent.filter((item) => item.ok).length} 条。`);
    return;
  }
  if (action === "status") {
    await io.showText(buildStatusText());
    return;
  }
  if (action === "duty") {
    await io.showText(await buildDutyText());
    return;
  }
  if (action === "login") {
    const key = (await io.ask("店铺key（如 jingxi2）: ")).trim();
    try {
      const assist = await loginAssist(key);
      io.note(`已为「${assist.store.displayName}」打开浏览器（账号：${assist.store.username}），请在窗口里完成登录。`);
      await io.ask("登录完成后按回车关闭浏览器（登录态已保存在店铺 profile）……");
      await assist.close();
    } catch (error) {
      io.note(`登录辅助失败：${error.message}`);
    }
  }
}

// 菜单：方向键常驻界面（1 号那种风格）——↑↓选择、数字键直达、回车执行，界面每秒原地重绘。
// 非交互环境（管道/被脚本调用）自动回退到输入式菜单，保证自动化仍能跑。
const 菜单项 = [
  { key: "1", label: "启动常驻监控", action: "run" },
  { key: "2", label: "停止常驻监控", action: "stop" },
  { key: "3", label: "立即巡检一轮", action: "once" },
  { key: "4", label: "查看状态", action: "status" },
  { key: "5", label: "登录辅助（输入店铺key）", action: "login" },
  { key: "6", label: "今日值班 / 在班@名单", action: "duty" },
  { key: "0", label: "退出", action: "quit" }
];

async function runMenu() {
  const 可交互 = Boolean(process.stdin.isTTY);
  let ctl = null;
  const note = (文本) => {
    ctl.setMessage(文本);
    log("菜单", "操作", 文本);
  };
  ctl = createMenuController(note);

  if (可交互) {
    // 界面占屏期间把控制台日志静音（日志照旧写 run.log），退出界面后恢复。
    setConsoleEnabled(false);
    await runLiveMenu({
      title: "14号 后台工单自动提醒",
      items: 菜单项,
      statusLines: () => buildStatusLines(ctl.getStatus(), Date.now()),
      footerNotes: [
        "血条＝数据新鲜度：满格＝刚抓到新数据；流干＝到点自动重抓并回满",
        "详细日志：runtime/logs/run.log"
      ],
      dispatch: (action, frameIo) =>
        handleMenuAction(action, ctl, { note, ask: frameIo.ask, showText: frameIo.showText })
    });
    setConsoleEnabled(true);
    ctl.dispose();
    // 常驻窗口的 CDP 连接（保持窗口用的）会让事件循环继续挂着，必须显式退出，否则窗口卡住不退。
    process.exit(0);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
  const io = { note, ask, showText: async (文本) => console.log(文本) };
  try {
    while (true) {
      const answer = (await ask("\n[1]启动常驻监控 [2]停止 [3]立即巡检一轮 [4]状态 [5]登录 [6]今日值班 [0]退出\n请选择: ")).trim();
      const 命中 = 菜单项.find((item) => item.key === answer);
      if (!命中) continue;
      if ((await handleMenuAction(命中.action, ctl, io)) === "quit") break;
    }
  } finally {
    rl.close();
    ctl.dispose();
  }
}

async function main() {
  const [, , command, ...rest] = process.argv;
  if (command === "once") {
    const r = await monitorOnce();
    // 输出格式在纯函数里（src/cli/formatOnceResult.js）：文案字段是 messages（数组，一单一消息）。
    for (const line of formatOnceResult(r)) {
      console.log(line);
    }
    return;
  }
  if (command === "run") {
    const loop = startMonitorLoop((err) => err && console.log(`本轮异常：${err.message}`), {
      keepBrowsersOpen: true
    });
    console.log("已进入常驻监控（窗口保持打开，发现新工单会发提醒）。Ctrl+C 只停程序、不关窗口。");
    process.on("SIGINT", () => { loop.stop(); process.exit(0); });
    return;
  }
  if (command === "login") {
    const assist = await loginAssist(rest[0] || "");
    console.log(`已为「${assist.store.displayName}」打开浏览器（账号：${assist.store.username}），登录完成后按回车关闭。`);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise((resolve) => rl.question("", resolve));
    rl.close();
    await assist.close();
    return;
  }
  if (command === "menu") { runMenu(); return; }
  if (command === "status") { console.log(buildStatusText()); return; }
  if (command === "duty") { console.log(await buildDutyText()); return; }
  if (command === "help" || command === "--help") { printHelp(); return; }
  if (!command && process.stdin.isTTY) { runMenu(); return; }
  printHelp();
}

main().catch((error) => {
  console.error(`执行失败：${error.message}`);
  process.exitCode = 1;
});
