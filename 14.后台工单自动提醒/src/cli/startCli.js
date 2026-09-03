// 本文件只是命令行入口：解析参数 → 调用业务真源 → 打印结果。零业务判断（#624 边界）。
const readline = require("readline");
const { monitorOnce, startMonitorLoop, loadMonitorState } = require("../features/workOrderMonitor/service");
const { loginAssist } = require("../features/workOrderMonitor/loginAssist");
const { resolveDuty, buildMentionPlan } = require("../features/dutySchedule/dutyService");
const { loadConfig } = require("../config/projectConfigService");
const { sendWecomText } = require("../integrations/wecomRobot");
const { log } = require("../engine/logger");

function printHelp() {
  console.log(`
14号后台工单自动提醒 —— 命令用法
  node src/cli/startCli.js once                立即巡检一轮（发真实提醒）
  node src/cli/startCli.js once --dry-run      巡检一轮但只演练不发送
  node src/cli/startCli.js run                 启动常驻监控（按配置间隔轮询）
  node src/cli/startCli.js login <店铺key>     拉起该店铺的可见浏览器，人工登录后保持登录态
  node src/cli/startCli.js test-notify         向企微群发送一条测试提醒
  node src/cli/startCli.js status              查看各提醒源最近一次计数与登录状态
  node src/cli/startCli.js duty                查看今日值班/当前在班与底色（验证金山排班读取）
  node src/cli/startCli.js menu                进入交互菜单
不带参数且有终端时默认进入菜单。`);
}

function renderStatus() {
  const state = loadMonitorState();
  const rows = Object.entries(state.sources || {});
  if (rows.length === 0) {
    console.log("还没有巡检记录，先运行 once。");
    return;
  }
  for (const [id, src] of rows) {
    const counts = src.counts ? JSON.stringify(src.counts) : "无数据";
    console.log(`${id}  状态=${src.status}  计数=${counts}`);
  }
  console.log(`最近一轮巡检时间：${state.lastRoundAt ? new Date(state.lastRoundAt).toLocaleString() : "无"}`);
}

async function renderDuty() {
  const config = loadConfig();
  const now = new Date();
  const result = await resolveDuty(config, now);
  if (!result.ok) {
    console.log(`排班读取失败：${result.error}`);
    return;
  }
  console.log(`今日（${now.getMonth() + 1}月${now.getDate()}日）${config.duty.group}值班：`);
  for (const item of result.todayStaff) {
    console.log(`  ${item.name}  ${item.shift}  底色：${item.colorName || "无"}${item.colorRgb ? `（${item.colorRgb}）` : ""}`);
  }
  const plan = buildMentionPlan(config, result);
  console.log(`当前时段在班：${result.onDutyNow.join("、") || "无人"}`);
  console.log(`将被@（含主管）：${plan.atNames.join("、") || "无"}`);
  console.log(`手机号：${plan.mobiles.join("、") || "无"}`);
}

async function runMenu() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
  console.log("=== 14号后台工单自动提醒 ===");
  let loop = null;
  while (true) {
    const answer = (await ask(`
[1] 立即巡检一轮  [2] 启动常驻监控  [3] 停止常驻监控
[4] 登录辅助(输入店铺key)  [5] 状态  [6] 发送测试提醒  [7] 今日值班  [0] 退出
请选择: `)).trim();
    if (answer === "1") {
      const r = await monitorOnce().catch((e) => (log("菜单", "巡检", "失败", e.message), null));
      if (r) console.log(`完成：事件 ${r.events.length} 个，发送成功 ${r.sent.filter((s) => s.ok).length} 条。`);
    } else if (answer === "2") {
      if (loop) { console.log("常驻监控已在运行。"); continue; }
      loop = startMonitorLoop((err, result) => {
        if (err) console.log(`本轮异常：${err.message}`);
        else console.log(`本轮完成：事件 ${result.events.length} 个。`);
      });
    } else if (answer === "3") {
      if (loop) { loop.stop(); loop = null; } else console.log("当前没有运行中的常驻监控。");
    } else if (answer === "4") {
      const key = (await ask("店铺key（如 jingxi1）: ")).trim();
      try {
        const assist = await loginAssist(key);
        console.log(`已为「${assist.store.displayName}」打开浏览器，请在窗口中完成登录（账号：${assist.store.username}）。`);
        console.log("登录完成后回到本窗口按回车关闭浏览器（登录态已保存在店铺 profile）。");
        await ask("");
        await assist.close();
      } catch (error) {
        console.log(`登录辅助失败：${error.message}`);
      }
    } else if (answer === "5") {
      renderStatus();
    } else if (answer === "6") {
      const config = loadConfig();
      await sendWecomText(config.wecom.webhookUrl, config.wecom.webhookName, "【测试】14号工单提醒链路正常，收到请忽略。");
      console.log("测试消息已发送。");
    } else if (answer === "7") {
      await renderDuty();
    } else if (answer === "0") {
      if (loop) loop.stop();
      rl.close();
      return;
    }
  }
}

async function main() {
  const [, , command, ...rest] = process.argv;
  if (command === "once") {
    const r = await monitorOnce({ dryRun: rest.includes("--dry-run") });
    for (const item of r.sent) {
      console.log(`--- ${item.event.sourceId} [${item.event.type}] ${item.ok ? (item.dryRun ? "演练" : "已发送") : "发送失败：" + item.error}`);
      console.log(item.content);
    }
    if (r.sent.length === 0) console.log("本轮没有需要提醒的变化。");
    return;
  }
  if (command === "run") {
    const loop = startMonitorLoop((err) => err && console.log(`本轮异常：${err.message}`));
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
  if (command === "test-notify") {
    const config = loadConfig();
    await sendWecomText(config.wecom.webhookUrl, config.wecom.webhookName, "【测试】14号工单提醒链路正常，收到请忽略。");
    console.log("测试消息已发送。");
    return;
  }
  if (command === "menu") { runMenu(); return; }
  if (command === "status") { renderStatus(); return; }
  if (command === "duty") { await renderDuty(); return; }
  if (command === "help" || command === "--help") { printHelp(); return; }
  if (!command && process.stdin.isTTY) { runMenu(); return; }
  printHelp();
}

main().catch((error) => {
  console.error(`执行失败：${error.message}`);
  process.exitCode = 1;
});
