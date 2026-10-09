"use strict";

// 窗口心跳自愈测试（2026-10-09 三条 + 赵敏补充两条）：
//   ① 监听窗进程没了 → 复判 + 复核 + 重开（自愈）；自愈成功不刷板，失败/反复才 [故障]；
//   ② 进程在只缺心跳 → 补写手（单实例锁防双写手）；补上不刷板、补不上 [故障]「进程在、心跳补不上」；
//   ③ 任务窗死 → 直接报（不许走重开自愈）。
// 红线：只用假进程/假状态/临时目录；不许 kill/重开任何真实窗口。
// 跑：cd 27.企业微信机器人 && node --test tests/窗口心跳自愈.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { 判定心跳, 规整键 } = require("../src/窗口心跳判定");
const 自愈 = require("../src/窗口自愈");
const 心跳 = require("../scripts/窗口心跳.cjs");

const MIN = 60 * 1000;
const NOW = new Date(2026, 9, 9, 18, 0, 0).getTime(); // 2026-10-09 18:00 本地
const BOOT = new Date(2026, 9, 9, 8, 0, 0).getTime(); // 开机 10 小时前（不在 30 分钟宽限里）

const 任务A = "D:\\任务\\a.md";
const 任务B = "D:\\任务\\b.md";
const 认窗A = "@" + 任务A;
const 键A = 规整键(认窗A);
const 键B = 规整键("@" + 任务B);
const 监听匹配 = ["27.企业微信机器人", "boot-prompt.md"];

function 记录(over = {}) {
  return {
    名: "任务窗·a.md",
    类型: "task",
    pid: 40828,
    认窗: [认窗A],
    启动时间: new Date(NOW - 30 * MIN).toISOString(),
    最后心跳: new Date(NOW - 2 * MIN).toISOString(),
    ...over
  };
}

function 监听记录(over = {}) {
  return {
    名: "监听窗",
    类型: "listener",
    pid: 34016,
    认窗: [...监听匹配],
    启动时间: new Date(NOW - 30 * MIN).toISOString(),
    最后心跳: new Date(NOW - 2 * MIN).toISOString(),
    ...over
  };
}

function 进程(pid, 命令行) {
  return { pid, 命令行: 命令行 != null ? 命令行 : `node pi-coding-agent ${认窗A}` };
}

function 监听进程(pid = 34016) {
  return 进程(pid, `node pi-coding-agent 27.企业微信机器人 boot-prompt.md`);
}

function 基准(over = {}) {
  return {
    nowMs: NOW,
    bootTimeMs: BOOT,
    记录: [记录(), 监听记录()],
    任务窗: [{ 任务: 任务A, 开窗时间: new Date(NOW - 30 * MIN).toISOString(), 回执已落: false }],
    进程列表: [进程(40828), 监听进程()],
    写手锁: {},
    上线时间Ms: NOW - 24 * 60 * MIN,
    上次状态: {},
    ...over
  };
}

/** 上一次状态里带一个“复判等待”的监听窗（死亡路径第二轮用）。 */
function 监听复判上次(over = {}) {
  return {
    windows: {
      listener: {
        名: "监听窗",
        复判: { 发现At: new Date(NOW - 30 * MIN).toISOString(), 原因: "监听窗进程不在" },
        ...over
      }
    }
  };
}

function 临时目录() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "窗口自愈测试-"));
}

// ================= 一、补写手（进程在、只缺心跳） =================

test("补写手条件：任务窗心跳超时 + pid 在 → toHeal 补写手，不发板", () => {
  const r = 判定心跳(基准({ 记录: [记录({ 最后心跳: new Date(NOW - 20 * MIN).toISOString() }), 监听记录()] }));
  assert.equal(r.toAlert.length, 0, "先自愈，不发板");
  assert.equal(r.toHeal.length, 1);
  const a = r.toHeal[0];
  assert.equal(a.动作, "补写手");
  assert.equal(a.类型, "task");
  assert.equal(a.键, 键A);
  assert.equal(a.认窗[0], 认窗A);
  assert.match(a.原因, /没有心跳/);
  assert.match(a.证据, /进程扫描里在/);
  assert.equal(r.状态.windows[a.键].自愈.动作, "补写手");
});

test("补写手条件：任务窗心跳超时 + pid 不在 → 直接报，不补写手（任务窗死不自愈）", () => {
  const r = 判定心跳(基准({
    记录: [记录({ 最后心跳: new Date(NOW - 20 * MIN).toISOString() }), 监听记录()],
    进程列表: [监听进程()]
  }));
  assert.equal(r.toHeal.length, 0, "任务窗死不走自愈");
  assert.equal(r.toAlert.length, 1);
  assert.match(r.toAlert[0].原因, /认窗进程不在|没有心跳/);
  assert.equal(r.状态.windows[键A].复判, null, "任务窗不用复判");
});

test("补写手条件：进程在 + 心跳超时 + 已有活写手锁 → 先等，不再补", () => {
  const r = 判定心跳(基准({
    记录: [记录({ 最后心跳: new Date(NOW - 20 * MIN).toISOString() }), 监听记录()],
    写手锁: { [键A]: { 活跃: true } }
  }));
  assert.equal(r.toHeal.length, 0, "锁在别人手里，绝不并发起第二个写手");
  assert.equal(r.toAlert.length, 0, "写手在跑，还没到判失败的时候");
  assert.equal(r.状态.windows[键A].自愈.动作, "补写手");
  assert.match(r.状态.windows[键A].状态, /写手在跑|等心跳/);
});

test("补写手失败才报：等够 2 拍仍无心跳 → [故障]「进程在、心跳补不上」", () => {
  const 上次状态 = {
    windows: {
      [键A]: { 名: "任务窗·a.md", 自愈: { 动作: "补写手", 开始At: new Date(NOW - 10 * MIN).toISOString() } }
    }
  };
  const r = 判定心跳(基准({
    记录: [记录({ 最后心跳: new Date(NOW - 20 * MIN).toISOString() }), 监听记录()],
    上次状态
  }));
  assert.equal(r.toAlert.length, 1);
  assert.match(r.toAlert[0].原因, /进程在、心跳补不上/);
  assert.match(r.toAlert[0].已试自愈, /补写手/);
  assert.equal(r.状态.windows[键A].自愈, null, "失败后清自愈，回落 60 分钟去重告警");
  assert.equal(r.自愈结果.length, 1);
  assert.equal(r.自愈结果[0].结果, "失败");
});

test("补写手成功不刷板：心跳恢复 → 只记自愈结果，不出告警/恢复帖", () => {
  const 上次状态 = {
    windows: {
      listener: { 名: "监听窗", 自愈: { 动作: "补写手", 开始At: new Date(NOW - 10 * MIN).toISOString() } }
    }
  };
  const r = 判定心跳(基准({ 上次状态 }));
  assert.equal(r.toAlert.length, 0, "自愈成功不发板");
  assert.equal(r.toResolve.length, 0, "之前没发过 [故障]，不用发 [已解决]");
  assert.equal(r.状态.windows.listener.自愈, null);
  assert.equal(r.自愈结果.length, 1);
  assert.equal(r.自愈结果[0].结果, "成功");
  assert.match(r.状态.windows.listener.状态, /自愈成功/);
});

test("补写手失败后再等重试窗口：不再连发写手（补写手At 拦住）", () => {
  const 上次状态 = {
    windows: {
      [键A]: {
        名: "任务窗·a.md",
        自愈: { 动作: "补写手", 开始At: new Date(NOW - 10 * MIN).toISOString() },
        补写手At: new Date(NOW - 3 * MIN).toISOString()
      }
    }
  };
  const r = 判定心跳(基准({
    记录: [记录({ 最后心跳: new Date(NOW - 20 * MIN).toISOString() }), 监听记录()],
    上次状态
  }));
  const 补 = r.toHeal.filter((x) => x.动作 === "补写手");
  assert.equal(补.length, 0, "距上次补写手不到重试间隔，不许连发");
});

// ================= 二、监听窗重开（自愈 + 节流 + 反复重启） =================

test("监听窗死：第一轮只记复判，不发板、不重开（防瞬时报错开双窗）", () => {
  const r = 判定心跳(基准({ 记录: [], 任务窗: [], 进程列表: [进程(40828)] }));
  assert.equal(r.toAlert.length, 0);
  assert.equal(r.toHeal.length, 0);
  assert.ok(r.状态.windows.listener.复判, "要记下复判等待");
  assert.match(r.状态.windows.listener.状态, /疑似死亡/);
});

test("监听窗死：复判够且没节流 → toHeal 重开（不发板，成败由看门狗回灌）", () => {
  const r = 判定心跳(基准({ 记录: [], 任务窗: [], 进程列表: [进程(40828)], 上次状态: 监听复判上次() }));
  assert.equal(r.toAlert.length, 0, "自愈动作阶段不先发板");
  assert.equal(r.toHeal.length, 1);
  assert.equal(r.toHeal[0].动作, "重开");
  assert.deepEqual(r.toHeal[0].认窗, 监听匹配);
  assert.equal(r.状态.windows.listener.自愈.动作, "重开");
  assert.equal(r.状态.windows.listener.复判, null);
});

test("重开节流：距上次重开不足一个巡检周期 → 不重开；超过才重开（事件照记）", () => {
  const 近 = 判定心跳(基准({
    记录: [], 任务窗: [], 进程列表: [进程(40828)], 上次状态: 监听复判上次({ 重开记录: [new Date(NOW - 60 * 1000).toISOString()] })
  }));
  assert.equal(近.toHeal.length, 0, "60 秒前刚重开过，等一个周期");
  assert.match(近.状态.windows.listener.状态, /节流/);

  const 远 = 判定心跳(基准({
    记录: [], 任务窗: [], 进程列表: [进程(40828)], 上次状态: 监听复判上次({ 重开记录: [new Date(NOW - 400 * 1000).toISOString()] })
  }));
  assert.equal(远.toHeal.length, 1, "超过节流窗就该再试");
});

test("反复重启：1 小时内重开满 3 次 → 即使心跳正常也 [故障]「反复重启」", () => {
  const 三次 = 判定心跳(基准({
    上次状态: { windows: { listener: { 名: "监听窗", 重开记录: [NOW - 10 * MIN, NOW - 20 * MIN, NOW - 30 * MIN].map((t) => new Date(t).toISOString()) } } }
  }));
  assert.equal(三次.toAlert.length, 1);
  assert.match(三次.toAlert[0].原因, /反复重启/);
  assert.match(三次.toAlert[0].已试自愈, /3 次/);

  const 两次 = 判定心跳(基准({
    上次状态: { windows: { listener: { 名: "监听窗", 重开记录: [NOW - 10 * MIN, NOW - 20 * MIN].map((t) => new Date(t).toISOString()) } } }
  }));
  assert.equal(两次.toAlert.length, 0, "没到 3 次不报");

  const 过期 = 判定心跳(基准({
    上次状态: { windows: { listener: { 名: "监听窗", 重开记录: [NOW - 2 * 3600 * 1000, NOW - 3 * 3600 * 1000, NOW - 4 * 3600 * 1000].map((t) => new Date(t).toISOString()) } } }
  }));
  assert.equal(过期.toAlert.length, 0, "1 小时外的不算（不是持续崩溃）");
});

test("反复重启后恢复：重开记录落下 1 小时后，正常心跳收 [已解决]", () => {
  const 上次状态 = {
    windows: { listener: { 名: "监听窗", 告警中: true, lastAlertAt: new Date(NOW - 90 * MIN).toISOString(), 重开记录: [new Date(NOW - 70 * MIN).toISOString()] } }
  };
  const r = 判定心跳(基准({ 上次状态 }));
  assert.equal(r.toAlert.length, 0);
  assert.equal(r.toResolve.length, 1);
  assert.equal(r.状态.windows.listener.告警中, false);
});

test("扫描失败不判不在：监听窗心跳超时 + 扫描不可用 → 直接报，不重开不复判", () => {
  const r = 判定心跳(基准({
    记录: [记录(), 监听记录({ 最后心跳: new Date(NOW - 20 * MIN).toISOString() })],
    进程列表: null
  }));
  assert.equal(r.toAlert.length, 1);
  assert.match(r.toAlert[0].原因, /没有心跳/);
  assert.equal(r.toHeal.length, 0);
  assert.equal(r.状态.windows.listener.复判, null, "扫描失败不算“不在”");
});

test("反向断言：任务窗死了也不许走重开自愈（无 toHeal、直接 [故障]）", () => {
  const r = 判定心跳(基准({
    记录: [记录(), 监听记录({ 最后心跳: new Date(NOW - 20 * MIN).toISOString() })],
    进程列表: [监听进程()], // 任务 pid 40828 消失、监听在
    上次状态: { windows: { [键A]: { 名: "任务窗·a.md", 复判: { 发现At: new Date(NOW - 30 * MIN).toISOString() } } } }
  }));
  assert.equal(r.toHeal.filter((a) => a.动作 === "重开").length, 0, "任务窗不许重开");
  assert.equal(r.toAlert.length, 1);
  assert.match(r.toAlert[0].原因, /认窗进程不在/);
});

// ================= 三、执行层（假依赖，不动真实窗口） =================

function 监听死判定() {
  return 判定心跳(基准({ 记录: [], 任务窗: [], 进程列表: [进程(40828)], 上次状态: 监听复判上次() }));
}

function 补写手判定() {
  return 判定心跳(基准({ 记录: [记录({ 最后心跳: new Date(NOW - 20 * MIN).toISOString() }), 监听记录()] }));
}

test("执行自愈·重开成功：复核不在 → 起窗 → 等到心跳 → 只记本地日志，不发板", async () => {
  const 判定 = 监听死判定();
  const 本地 = [];
  const 起窗调用 = [];
  await 自愈.执行自愈(判定, {
    cfg: { dedupeMin: 60, reopenConfirmSec: 90, flappingWindowSec: 3600, flappingCount: 3 },
    log: () => {},
    记本地日志: (t) => 本地.push(t),
    依赖: {
      现在: () => NOW,
      复核监听窗: () => ({ 在: false, 原因: "没找到监听窗进程" }),
      起监听窗: () => { 起窗调用.push(1); return { ok: true, pid: 111, 方式: "测试" }; },
      等心跳: async () => ({ ok: true, pid: 222, 最后心跳: new Date(NOW).toISOString() })
    }
  });
  assert.equal(起窗调用.length, 1, "复核不在 → 要起窗");
  assert.equal(判定.toAlert.length, 0, "自愈成功不发板");
  assert.equal(判定.状态.windows.listener.自愈, null);
  assert.equal(判定.状态.windows.listener.重开记录.length, 1);
  assert.ok(本地.some((t) => t.includes("自愈成功")), "本地日志要写明白结果");
});

test("执行自愈·重开失败：等到超时没心跳 → [故障]「重开失败」", async () => {
  const 判定 = 监听死判定();
  await 自愈.执行自愈(判定, {
    cfg: { dedupeMin: 60, reopenConfirmSec: 90 },
    log: () => {},
    记本地日志: () => {},
    依赖: {
      现在: () => NOW,
      复核监听窗: () => ({ 在: false }),
      起监听窗: () => ({ ok: true, pid: 111, 方式: "测试" }),
      等心跳: async () => ({ ok: false, 最后心跳: null })
    }
  });
  assert.equal(判定.toAlert.length, 1);
  assert.match(判定.toAlert[0].原因, /重开失败/);
  assert.equal(判定.状态.windows.listener.告警中, true);
});

test("执行自愈·重开前复核到进程还在 → 取消，不双开", async () => {
  const 判定 = 监听死判定();
  let 起窗次数 = 0;
  await 自愈.执行自愈(判定, {
    cfg: { dedupeMin: 60, reopenConfirmSec: 90 },
    log: () => {},
    记本地日志: () => {},
    依赖: {
      现在: () => NOW,
      复核监听窗: () => ({ 在: true, 进程: { pid: 34016 } }),
      起监听窗: () => { 起窗次数++; return { ok: true, pid: 111 }; },
      等心跳: async () => ({ ok: true })
    }
  });
  assert.equal(起窗次数, 0, "复核发现进程还在，绝不许再开一个窗");
  assert.equal(判定.toAlert.length, 0);
  assert.equal(判定.状态.windows.listener.复判, null);
});

test("执行自愈·重开三次成功 → 同轮直接 [故障]「反复重启」", async () => {
  const 判定 = 判定心跳(基准({
    记录: [],
    任务窗: [],
    进程列表: [进程(40828)],
    上次状态: 监听复判上次({ 重开记录: [new Date(NOW - 10 * MIN).toISOString(), new Date(NOW - 20 * MIN).toISOString()] })
  }));
  await 自愈.执行自愈(判定, {
    cfg: { dedupeMin: 60, reopenConfirmSec: 90, flappingWindowSec: 3600, flappingCount: 3 },
    log: () => {},
    记本地日志: () => {},
    依赖: {
      现在: () => NOW,
      复核监听窗: () => ({ 在: false }),
      起监听窗: () => ({ ok: true, pid: 111, 方式: "测试" }),
      等心跳: async () => ({ ok: true, pid: 222, 最后心跳: new Date(NOW).toISOString() })
    }
  });
  assert.equal(判定.toAlert.length, 1);
  assert.match(判定.toAlert[0].原因, /反复重启/);
});

test("执行自愈·补写手启动失败 → [故障]「补写手失败」", async () => {
  const 临时 = 临时目录();
  try {
    const 判定 = 补写手判定();
    await 自愈.执行自愈(判定, {
      记录文件: path.join(临时, "窗口心跳.json"),
      cfg: { dedupeMin: 60 },
      log: () => {},
      记本地日志: () => {},
      依赖: { 起写手: () => ({ ok: false, 错误: "测试：起不来" }) }
    });
    assert.equal(判定.toAlert.length, 1);
    assert.match(判定.toAlert[0].原因, /补写手失败/);
    assert.equal(判定.状态.windows[键A].自愈, null);
  } finally {
    fs.rmSync(临时, { recursive: true, force: true });
  }
});

test("执行自愈·dry-run：只标记不做（不起写手、不起窗）", async () => {
  const 判定 = 监听死判定();
  let 起窗次数 = 0;
  await 自愈.执行自愈(判定, {
    cfg: { reopenConfirmSec: 90, dedupeMin: 60 },
    dryRun: true,
    log: () => {},
    记本地日志: () => {},
    依赖: { 起监听窗: () => { 起窗次数++; return { ok: true }; } }
  });
  assert.equal(起窗次数, 0, "dry-run 不许动生产");
  assert.equal(判定.toAlert.length, 0);
});

test("执行自愈·补写手前先查单实例锁：有活锁就跳过", async () => {
  const 临时 = 临时目录();
  try {
    const 判定 = 补写手判定();
    const 锁 = 心跳.单例锁文件(path.join(临时, "窗口心跳.json"), 认窗A);
    fs.mkdirSync(path.dirname(锁), { recursive: true });
    fs.writeFileSync(锁, JSON.stringify({ 名: "别人的写手", 键: 认窗A, pid: process.pid, 更新At: Date.now() }));
    let 起写手次数 = 0;
    await 自愈.执行自愈(判定, {
      记录文件: path.join(临时, "窗口心跳.json"),
      cfg: { dedupeMin: 60 },
      log: () => {},
      记本地日志: () => {},
      依赖: { 起写手: () => { 起写手次数++; return { ok: true }; } }
    });
    assert.equal(起写手次数, 0, "锁在别人手里，绝不并发起第二个写手");
    assert.match(判定.状态.windows[键A].状态, /跳过补写手|写手在跑/);
  } finally {
    fs.rmSync(临时, { recursive: true, force: true });
  }
});

// ================= 四、动作原语（敢派生、能验信号） =================

test("起写手：参数带 --后台/认窗/状态文件，不真起进程（注入执行）", () => {
  const 调用 = [];
  const r = 自愈.起写手(
    { 认窗: ["a", "b"], 名: "测试窗", 类型: "task", 状态文件: "X:\\状态.json", 日志文件: "X:\\日志.log" },
    { 执行: (命令, 参数) => { 调用.push({ 命令, 参数 }); return { status: 0, stdout: "ok" }; } }
  );
  assert.equal(r.ok, true);
  const 参 = 调用[0].参数;
  assert.ok(参.includes("--后台"));
  assert.ok(参.includes("--认窗"));
  assert.ok(参.includes("测试窗"));
  assert.ok(参.includes("X:\\状态.json"));
});

test("起监听窗：派生 open-pi-window.cmd（注入执行验证命令形状）", () => {
  const 临时 = 临时目录();
  try {
    const 假命令 = path.join(临时, "open-pi-window.cmd");
    fs.writeFileSync(假命令, "@echo off\r\n", "utf8");
    const 调用 = [];
    const r = 自愈.起监听窗({ 命令: 假命令, 工作目录: 临时 }, {
      执行: (命令, 参数) => {
        调用.push({ 命令, 参数 });
        return { status: 0, stdout: "12345" };
      }
    });
    assert.equal(r.ok, true);
    assert.equal(r.pid, 12345);
    assert.equal(调用[0].命令, "powershell");
    assert.match(调用[0].参数.join(" "), /Start-Process/);
    assert.match(调用[0].参数.join(" "), /open-pi-window\.cmd/);
  } finally {
    fs.rmSync(临时, { recursive: true, force: true });
  }
});

test("起监听窗（真派生一次假命令）：能起进程 + 能等到信号，用完即删", async () => {
  const 临时 = 临时目录();
  try {
    const 标记 = path.join(临时, "signal.txt");
    const 假命令 = path.join(临时, "fake-open.cmd");
    // 内容保持 ASCII（cmd 按 OEM 代码页读 .cmd，中文路径靠 %~dp0 在 cmd 内部展开，才不乱码）
    fs.writeFileSync(假命令, `@echo off\r\necho ok> "%~dp0signal.txt"\r\n`, "utf8");
    const r = 自愈.起监听窗({ 命令: 假命令, 工作目录: 临时 });
    assert.equal(r.ok, true, `起进程失败：${r.错误 || ""}`);
    // 等信号（假命令写完标记就退）
    let 有 = false;
    for (let i = 0; i < 40 && !有; i++) {
      await new Promise((res) => setTimeout(res, 250));
      有 = fs.existsSync(标记);
    }
    assert.ok(有, "假命令要被真的派生起来并写出信号文件");
  } finally {
    fs.rmSync(临时, { recursive: true, force: true });
  }
});

test("等心跳出现：轮询到新心跳算成功；超时算失败（不睡真 90 秒）", async () => {
  const 假睡 = async () => {};
  let 拍 = 0;
  const 成功 = await 自愈.等心跳出现(
    { 记录文件: "假", 起点Ms: NOW, 超时秒: 90 },
    {
      读: () => { 拍++; return { x: 拍 < 3 ? { 类型: "listener", 最后心跳: new Date(NOW - 60 * MIN).toISOString() } : { 类型: "listener", 最后心跳: new Date(NOW + 1000).toISOString() } }; },
      现在: () => NOW,
      睡: 假睡
    }
  );
  assert.equal(成功.ok, true);

  const 失败 = await 自愈.等心跳出现(
    { 记录文件: "假", 起点Ms: NOW, 超时秒: 1 },
    { 读: () => ({}), 现在: (() => { let t = NOW; return () => (t += 60000); })(), 睡: 假睡 }
  );
  assert.equal(失败.ok, false);
});

// ================= 五、写手单实例锁（真起假进程，防双写手） =================

test("写手身份核验（真查 Win32 进程）：认得出真写手命令行，不认别人", async () => {
  const 行 = 心跳.查进程行(process.pid);
  assert.ok(行 && /node\.exe/i.test(行), `要能查到 pid ${process.pid} 的命令行：${行}`);
  assert.equal(心跳.是写手进程(process.pid), false, "测试进程不是写手，不许误认");
  const 假写手 = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 8000)", "--", "X:\\某目录\\窗口心跳.cjs"], { stdio: "ignore" });
  try {
    let 判 = null;
    for (let i = 0; i < 20 && 判 !== true; i++) {
      await new Promise((r) => setTimeout(r, 300));
      判 = 心跳.是写手进程(假写手.pid);
    }
    assert.equal(判, true, "命令行含 窗口心跳.cjs 的 node 进程要认出来（防旧锁被误当死锁）");
  } finally {
    try { 假写手.kill(); } catch { /* 测试假进程 */ }
  }
});

test("单实例锁：新鲜锁挡人；死 pid 旧锁可接管；pid 在但非写手可接管；查不清保守算活跃", () => {
  const 临时 = 临时目录();
  const 锁 = path.join(临时, "x.json");
  try {
    fs.writeFileSync(锁, JSON.stringify({ 名: "甲", 键: "k", pid: process.pid, 更新At: Date.now() }));
    assert.equal(心跳.单例锁活跃(锁), true, "活 pid + 新鲜锁 = 活跃");
    assert.equal(心跳.认领单例锁(锁, { 名: "乙", 键: "k", 等待毫秒: 300 }), false, "活锁拿不到 → 退出");
    assert.equal(JSON.parse(fs.readFileSync(锁, "utf8")).名, "甲", "拿不到锁不许动别人的锁");

    fs.writeFileSync(锁, JSON.stringify({ 名: "甲", 键: "k", pid: 99999999, 更新At: Date.now() - 3600 * 1000 }));
    assert.equal(心跳.单例锁活跃(锁), false, "pid 不在 = 锁死了");
    assert.equal(心跳.认领单例锁(锁, { 名: "丙", 键: "k" }), true, "死锁要能接管");
    assert.equal(JSON.parse(fs.readFileSync(锁, "utf8")).名, "丙");

    fs.writeFileSync(锁, JSON.stringify({ 名: "丁", 键: "k", pid: process.pid, 更新At: Date.now() - 3600 * 1000 }));
    assert.equal(心跳.单例锁活跃(锁, { 核验: () => false }), false, "pid 在但核验不是写手 → 可接管");
    assert.equal(心跳.单例锁活跃(锁, { 核验: () => true }), true, "真是写手（可能卡死）→ 算活跃，不双开");
    assert.equal(心跳.单例锁活跃(锁, { 核验: () => null }), true, "查不清 → 保守算活跃");
  } finally {
    fs.rmSync(临时, { recursive: true, force: true });
  }
});

test("写手锁（真跨进程）：先起的写手持锁，后到的退出；退出自动释放（真跑假窗）", async () => {
  const 临时 = 临时目录();
  const 文件 = path.join(临时, "窗口心跳.json");
  const 日志 = path.join(临时, "日志.log");
  const 标记 = "@F:\\fake\\心跳锁真跑.md";
  const 假窗 = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 60000)", "--", "pi-coding-agent", 标记], { stdio: "ignore" });
  const 起写手进程 = () =>
    spawn(process.execPath, [
      path.join(__dirname, "..", "scripts", "窗口心跳.cjs"),
      // 只拿标记当认窗串（假进程命令行含 pi-coding-agent，写手自己命令行不含它，才不会被当成窗口）
      "--认窗", 标记,
      "--名", "锁真跑写手", "--类型", "task",
      "--状态文件", 文件, "--日志文件", 日志,
      "--间隔", "0.5", "--拍数", "3"
    ], { stdio: ["ignore", "pipe", "pipe"] });
  const 收 = (子) => new Promise((resolve) => {
    let 出 = "";
    子.stdout.on("data", (d) => (出 += d));
    子.stderr.on("data", (d) => (出 += d));
    子.on("close", () => resolve(出));
  });
  try {
    const 甲 = 起写手进程();
    const 锁 = 心跳.单例锁文件(文件, 标记);
    for (let i = 0; i < 50 && !fs.existsSync(锁); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(fs.existsSync(锁), "先起的写手要认领单实例锁");
    const 乙 = 起写手进程();
    const [甲出, 乙酰] = await Promise.all([收(甲), 收(乙)]);
    assert.match(甲出, /心跳启动/, `第一个写手要正常干活：${甲出}`);
    assert.match(乙酰, /已有同窗心跳写手在跑|已有写手/, `第二个写手必须被锁挡住：${乙酰}`);
    assert.equal(fs.existsSync(锁), false, "写手正常退出要释放锁");
    const 条目 = Object.values(心跳.读心跳(文件))[0];
    assert.ok(条目 && 条目.名 === "锁真跑写手", "心跳要落在台账里");
  } finally {
    try { 假窗.kill(); } catch { /* 测试假进程 */ }
    fs.rmSync(临时, { recursive: true, force: true });
  }
});

test("写手：已有同窗活锁（外面起的）→ 直接退出，不写心跳；锁不是自己不动", async () => {
  const 临时 = 临时目录();
  const 文件 = path.join(临时, "窗口心跳.json");
  const 标记 = "@F:\\fake\\锁挡路.md";
  try {
    const 锁 = 心跳.单例锁文件(文件, 标记);
    fs.mkdirSync(path.dirname(锁), { recursive: true });
    fs.writeFileSync(锁, JSON.stringify({ 名: "别人的写手", 键: 标记, pid: process.pid, 更新At: Date.now() }));
    const r = await 心跳.主循环({
      认窗组: [标记, "pi-coding-agent"],
      名: "第二个写手",
      状态文件: 文件,
      日志文件: path.join(临时, "日志.log"),
      扫描: () => ({ ok: true, 列表: [{ pid: 1, 命令行: "pi-coding-agent " + 标记 }] }),
      认窗超时秒: 0,
      拍数: 2,
      间隔秒: 0.2
    });
    assert.equal(r.退出, "已有写手");
    assert.equal(r.写拍数, 0);
    assert.deepEqual(心跳.读心跳(文件), {}, "被挡的写手不许落心跳");
    assert.equal(JSON.parse(fs.readFileSync(锁, "utf8")).名, "别人的写手", "不许动别人的锁");
  } finally {
    fs.rmSync(临时, { recursive: true, force: true });
  }
});

// ================= 六、源码反向断言（删了会红） =================

test("反向断言：写手必须先认领单例锁；判定/执行层不许给任务窗走重开", () => {
  const 写手源 = fs.readFileSync(path.join(__dirname, "..", "scripts", "窗口心跳.cjs"), "utf8");
  assert.match(写手源, /认领单例锁/, "写手要认领单实例锁");
  assert.match(写手源, /已有同窗心跳写手在跑/, "同窗已有写手要退出");
  assert.match(写手源, /单例锁文件/, "锁按窗口分文件");
  assert.match(写手源, /释放单例锁/, "退出要释放锁");

  const 判定源 = fs.readFileSync(path.join(__dirname, "..", "src", "窗口心跳判定.js"), "utf8");
  assert.match(判定源, /死亡 && 目标项\.类型 === "listener"/, "重开自愈只对监听窗开");

  const 自愈源 = fs.readFileSync(path.join(__dirname, "..", "src", "窗口自愈.js"), "utf8");
  assert.match(自愈源, /单例锁活跃/, "补写手前必须查单实例锁");
  assert.match(自愈源, /复核监听窗/, "重开前必须复核进程");
});
