// 常驻界面的状态行与"新鲜度血条"：纯函数、零依赖，风格与 1 号控制台一致（█/░ + 百分比 + 三色）。
// 语义（14号）：血条 = **数据新鲜度**。刚抓到新数据时满格，每过一秒掉一点，流干＝到点该抓下一轮；
// 抓到新数据立刻回满。这样"界面有没有在跑"一眼就能看出来。

const ansi = {
  green: "\x1b[92m",
  yellow: "\x1b[93m",
  red: "\x1b[91m",
  gray: "\x1b[90m",
  reset: "\x1b[0m"
};

function 补零(value) {
  return String(value).padStart(2, "0");
}

function formatClock(ms) {
  if (!Number.isFinite(ms)) return "--:--:--";
  const d = new Date(ms);
  return `${补零(d.getHours())}:${补零(d.getMinutes())}:${补零(d.getSeconds())}`;
}

function formatDuration(ms) {
  const 总秒 = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  return `${补零(Math.floor(总秒 / 60))}:${补零(总秒 % 60)}`;
}

function formatAge(ms) {
  const 秒 = Math.floor((Number(ms) || 0) / 1000);
  if (!Number.isFinite(秒) || 秒 < 0) return "暂无";
  if (秒 < 60) return `${秒} 秒前`;
  return `${Math.floor(秒 / 60)} 分钟前`;
}

// 血条：满格＝刚抓到新数据；空格＝到点该抓下一轮了。ageMs 非法（还没抓到过）时显示空条 + "暂无"。
function buildFreshnessBar(ageMs, intervalMs, width = 24) {
  const 宽 = Math.max(1, Number(width) || 1);
  const 间隔 = Number(intervalMs) > 0 ? Number(intervalMs) : 1;
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return `${ansi.gray}${"░".repeat(宽)}${ansi.reset} 暂无`;
  }
  const ratio = Math.max(0, Math.min(1, 1 - ageMs / 间隔));
  const 实格 = Math.round(ratio * 宽);
  const 颜色 = ratio < 0.2 ? ansi.red : ratio < 0.5 ? ansi.yellow : ansi.green;
  return `${颜色}${"█".repeat(实格)}${ansi.gray}${"░".repeat(宽 - 实格)}${ansi.reset} ${Math.round(ratio * 100)}%`;
}

// status 结构见 startMonitorLoop 的 getStatus()：
// { running, intervalMs, warmupDone, roundInProgress, lastRoundAt, nextRoundAt, lastSummary, lastError, lastMessage }
function buildStatusLines(status, now, options = {}) {
  const s = status || {};
  const 间隔 = Number(s.intervalMs) > 0 ? Number(s.intervalMs) : 0;
  const 分钟 = 间隔 > 0 ? Math.round(间隔 / 60000) : 0;
  const 条宽 = options.barWidth || 24;
  const 每隔 = 分钟 > 0 ? `每 ${分钟} 分钟一轮` : "间隔未知";

  if (!s.running) {
    return [
      `常驻监控：${ansi.yellow}未启动${ansi.reset}（按 1 启动；${每隔}）`,
      `数据新鲜度 ${buildFreshnessBar(Number.NaN, 间隔, 条宽)}`,
      `${ansi.gray}界面看不出在跑的时候，就看这行血条：满格＝刚抓到数据，流干＝自动重抓。${ansi.reset}`
    ];
  }

  const 行 = [];
  if (s.roundInProgress) {
    行.push(`常驻监控：${ansi.green}运行中${ansi.reset}　${ansi.gray}正在抓取最新数据…（${每隔}）${ansi.reset}`);
  } else if (Number.isFinite(s.nextRoundAt)) {
    行.push(`常驻监控：${ansi.green}运行中${ansi.reset}　下一轮还有 ${formatDuration(s.nextRoundAt - now)}（${每隔}）`);
  } else {
    行.push(`常驻监控：${ansi.green}运行中${ansi.reset}（${每隔}）`);
  }

  if (Number.isFinite(s.lastRoundAt)) {
    const 摘要 = s.lastSummary
      ? `　本轮：${s.lastSummary.storeCount} 家店 · ${s.lastSummary.sourceCount} 个页签 · 事件 ${s.lastSummary.eventCount} 个 · 发送 ${s.lastSummary.sentOkCount} 条`
      : "";
    行.push(`上次抓到新数据 ${formatClock(s.lastRoundAt)}（${formatAge(now - s.lastRoundAt)}）${摘要}`);
    行.push(`数据新鲜度 ${buildFreshnessBar(now - s.lastRoundAt, 间隔, 条宽)}`);
  } else if (!s.warmupDone) {
    行.push("正在拉起各店铺窗口（预热）…");
    行.push(`数据新鲜度 ${buildFreshnessBar(Number.NaN, 间隔, 条宽)}`);
  } else {
    行.push("还没抓到过数据（第一轮进行中或失败）");
    行.push(`数据新鲜度 ${buildFreshnessBar(Number.NaN, 间隔, 条宽)}`);
  }

  if (s.lastError) 行.push(`${ansi.red}⚠ 上一轮出错：${s.lastError}${ansi.reset}`);
  if (s.lastMessage) 行.push(`${ansi.gray}${s.lastMessage}${ansi.reset}`);
  return 行;
}

module.exports = { buildFreshnessBar, buildStatusLines, formatClock, formatDuration, formatAge };
