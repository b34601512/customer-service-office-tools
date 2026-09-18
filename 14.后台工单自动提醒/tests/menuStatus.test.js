// 血条与状态行（src/cli/menuStatus.js）纯函数测试。
// 用户要求：10 分钟血条，每秒掉一点，流干就该重抓；抓到新数据立刻回满。
const test = require("node:test");
const assert = require("node:assert");

const { buildFreshnessBar, buildStatusLines, formatClock, formatDuration } = require("../src/cli/menuStatus");

const 间隔 = 10 * 60 * 1000;
const 剥色 = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const 取行 = (status, now) => buildStatusLines(status, now).map(剥色);

test("血条：刚抓到＝满格 100%，流一半＝50%，流干＝0%", () => {
  assert.match(剥色(buildFreshnessBar(0, 间隔)), /█{24} 100%/);
  assert.match(剥色(buildFreshnessBar(间隔 / 2, 间隔)), /█{12}░{12} 50%/);
  assert.match(剥色(buildFreshnessBar(间隔, 间隔)), /░{24} 0%/);
  assert.match(剥色(buildFreshnessBar(间隔 * 3, 间隔)), /░{24} 0%/, "流过头也不能出负格");
  assert.match(剥色(buildFreshnessBar(Number.NaN, 间隔)), /暂无/, "还没抓到过就显示暂无，不能假装满血");
});

test("血条颜色：新鲜绿、过半黄、见底红", () => {
  const 颜色 = (ageMs) => {
    const 文本 = buildFreshnessBar(ageMs, 间隔);
    if (文本.includes("\x1b[92m")) return "绿";
    if (文本.includes("\x1b[93m")) return "黄";
    if (文本.includes("\x1b[91m")) return "红";
    return "无";
  };
  assert.strictEqual(颜色(0), "绿");
  assert.strictEqual(颜色(间隔 * 0.6), "黄");
  assert.strictEqual(颜色(间隔 * 0.95), "红");
});

test("时钟与倒计时格式：HH:MM:SS / mm:ss", () => {
  const d = new Date(2026, 8, 18, 9, 5, 7);
  assert.strictEqual(formatClock(d.getTime()), "09:05:07");
  assert.strictEqual(formatClock(Number.NaN), "--:--:--");
  assert.strictEqual(formatDuration(9 * 60 * 1000 + 7000), "09:07");
  assert.strictEqual(formatDuration(-5), "00:00");
});

test("状态行：未启动时明确说没在跑，并指向按 1 启动", () => {
  const 行 = 取行({ running: false, intervalMs: 间隔 }, Date.now());
  assert.ok(行[0].includes("未启动"), `要说清没在跑：${行[0]}`);
  assert.ok(行[0].includes("每 10 分钟一轮"), "要写清间隔");
  assert.ok(行.join("\n").includes("按 1 启动"), "要给出下一步");
  assert.ok(行.join("\n").includes("暂无"), "没数据不能假装满血");
});

test("状态行：运行中要给出下一轮倒计时、上次抓取时间、本轮摘要与血条", () => {
  const now = 1700000000000;
  const 抓到时刻 = now - 2 * 60 * 1000;
  const 行 = 取行(
    {
      running: true,
      intervalMs: 间隔,
      warmupDone: true,
      lastRoundAt: 抓到时刻,
      nextRoundAt: 抓到时刻 + 间隔,
      lastSummary: { storeCount: 2, sourceCount: 9, eventCount: 1, sentOkCount: 1 }
    },
    now
  );
  const 全文 = 行.join("\n");
  assert.ok(行[0].includes("运行中"), "要一眼看出在跑");
  assert.ok(行[0].includes("08:00"), `下一轮倒计时应对应剩下 8 分钟：${行[0]}`);
  assert.ok(全文.includes(formatClock(抓到时刻)), "要显示上次抓取时刻");
  assert.ok(全文.includes("2 家店 · 9 个页签 · 事件 1 个 · 发送 1 条"), "要显示本轮摘要");
  assert.ok(全文.includes("数据新鲜度"), "要有血条");
  assert.ok(剥色(全文).includes("80%"), "刚过 2 分钟应该是 80% 血");
});

test("状态行：正在抓取时不显示倒计时（避免误导），出错要显眼报出来", () => {
  const now = 1700000000000;
  const 行 = 取行(
    { running: true, intervalMs: 间隔, warmupDone: true, roundInProgress: true, lastRoundAt: now - 间隔, nextRoundAt: now },
    now
  );
  const 全文 = 行.join("\n");
  assert.ok(全文.includes("正在抓取最新数据"), "抓取中要有明确提示");
  assert.ok(!全文.includes("下一轮还有"), "抓取中不该再显示倒计时");
  assert.ok(剥色(全文).includes("0%"), "血条到底");

  const 出错 = 取行({ running: true, intervalMs: 间隔, warmupDone: true, lastError: "页面加载超时" }, now).join("\n");
  assert.ok(出错.includes("页面加载超时"), "错误要显示在界面上（不能只进日志）");
});

test("状态行：预热阶段与最近一条操作消息", () => {
  const now = 1700000000000;
  const 行 = 取行({ running: true, intervalMs: 间隔, warmupDone: false, lastMessage: "已启动常驻监控" }, now).join("\n");
  assert.ok(行.includes("预热"), "预热要说明在干什么");
  assert.ok(行.includes("已启动常驻监控"), "最近一条操作消息要留着");
});
