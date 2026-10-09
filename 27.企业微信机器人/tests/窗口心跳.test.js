"use strict";

// 窗口心跳测试（2026-10-09）：写手脚本 + 纯判定 + 与开/关任务窗的接线。
// 跑：cd 27.企业微信机器人 && node --test tests/窗口心跳.test.js
// 红线：只许用假进程/假状态目录，不许 kill/打扰任何真实窗口。

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { 判定心跳, 规整键 } = require("../src/窗口心跳判定");
const 心跳 = require("../scripts/窗口心跳.cjs");
const 关窗 = require(path.join(__dirname, "..", "..", "0.木婉清档案", "关任务窗.cjs"));

const MIN = 60 * 1000;
const NOW = new Date(2026, 9, 9, 18, 0, 0).getTime(); // 2026-10-09 18:00 本地
const BOOT = new Date(2026, 9, 9, 8, 0, 0).getTime(); // 开机 10 小时前（不在 30 分钟宽限里）

const 任务A = "D:\\任务\\a.md";
const 任务B = "D:\\任务\\b.md";
const 认窗A = "@" + 任务A;
const 键A = 规整键(认窗A);

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
    认窗: ["27.企业微信机器人", "boot-prompt.md"],
    启动时间: new Date(NOW - 30 * MIN).toISOString(),
    最后心跳: new Date(NOW - 2 * MIN).toISOString(),
    ...over
  };
}

function 进程(pid, 命令行) {
  return { pid, 命令行: 命令行 != null ? 命令行 : `node pi-coding-agent ${认窗A}` };
}

function 基准(over = {}) {
  return {
    nowMs: NOW,
    bootTimeMs: BOOT,
    记录: [记录(), 监听记录()],
    任务窗: [{ 任务: 任务A, 开窗时间: new Date(NOW - 30 * MIN).toISOString(), 回执已落: false }],
    进程列表: [进程(40828), 进程(34016, "node pi-coding-agent 27.企业微信机器人 boot-prompt.md")],
    上线时间Ms: NOW - 24 * 60 * MIN,
    上次状态: {},
    ...over
  };
}

function 找任务键(r) {
  return Object.keys(r.状态.windows).find((k) => k !== "listener");
}

function 临时目录() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "窗口心跳测试-"));
}

// ================= 判定用例 =================

test("新鲜心跳 + 进程在 → 正常，无告警", () => {
  const r = 判定心跳(基准());
  assert.equal(r.toAlert.length, 0);
  assert.equal(r.toResolve.length, 0);
  assert.equal(r.状态.windows[找任务键(r)].状态, "正常");
});

test("心跳超时（>10 分钟）：进程在 → 先补写手（自愈，不发板）", () => {
  const r = 判定心跳(基准({ 记录: [记录({ 最后心跳: new Date(NOW - 20 * MIN).toISOString() }), 监听记录()] }));
  assert.equal(r.toAlert.length, 0, "进程在、只缺心跳 → 先自愈补写手，不发板");
  assert.equal(r.toHeal.length, 1);
  assert.equal(r.toHeal[0].动作, "补写手");
  assert.equal(r.toHeal[0].键, 键A);
  assert.match(r.toHeal[0].原因, /没有心跳/);
});

test("认窗 pid 不在 → 告警（心跳还新也没用）", () => {
  const r = 判定心跳(基准({ 进程列表: [进程(34016, "node pi-coding-agent 27.企业微信机器人 boot-prompt.md")] }));
  assert.equal(r.toAlert.length, 1);
  assert.match(r.toAlert[0].原因, /认窗进程不在/);
  assert.equal(r.toAlert[0].键, 键A);
});

test("心跳早于本次开机 → 任务窗按关机残留忽略，不告警", () => {
  const r = 判定心跳(基准({ 记录: [记录({ 最后心跳: new Date(BOOT - 60 * MIN).toISOString() }), 监听记录()] }));
  assert.equal(r.toAlert.length, 0);
  assert.match(r.状态.windows[找任务键(r)].状态, /旧记录/);
});

test("开机 30 分钟内不报（写手可能还没来得及起来）", () => {
  const 刚开机 = new Date(NOW - 5 * MIN);
  const 旧心跳 = new Date(刚开机 - 15 * MIN).toISOString();
  const r = 判定心跳(
    基准({
      bootTimeMs: 刚开机.getTime(),
      记录: [记录({ 最后心跳: 旧心跳 }), 监听记录({ 最后心跳: 旧心跳 })],
      任务窗: []
    })
  );
  assert.equal(r.toAlert.length, 0, "开机宽限内不报（监听窗旧记录也不报）");
  assert.match(r.状态.windows.listener.状态, /开机宽限/);
});

test("同一窗口 60 分钟内不重报；超过 60 分钟再报", () => {
  const 旧记录 = [记录({ 最后心跳: new Date(NOW - 20 * MIN).toISOString() }), 监听记录()];
  const 刚报过 = {
    windows: { [键A]: { 名: "任务窗·a.md", 告警中: true, lastAlertAt: new Date(NOW - 30 * MIN).toISOString() } }
  };
  // 进程扫描不可用 + 心跳超时 → 直接告警（不判 pid、不自愈），用来验去重
  const r1 = 判定心跳(基准({ 记录: 旧记录, 进程列表: null, 上次状态: 刚报过 }));
  assert.equal(r1.toAlert.length, 0, "30 分钟前报过，60 分钟内不重报");
  assert.equal(r1.状态.windows[键A].告警中, true);

  const 很久前 = {
    windows: { [键A]: { 名: "任务窗·a.md", 告警中: true, lastAlertAt: new Date(NOW - 70 * MIN).toISOString() } }
  };
  const r2 = 判定心跳(基准({ 记录: 旧记录, 进程列表: null, 上次状态: 很久前 }));
  assert.equal(r2.toAlert.length, 1, "超过 60 分钟要再报一次");
});

test("恢复 → 一条 [已解决]，告警状态收掉", () => {
  const 上次状态 = {
    windows: { [键A]: { 名: "任务窗·a.md", 告警中: true, lastAlertAt: new Date(NOW - 30 * MIN).toISOString() } }
  };
  const r = 判定心跳(基准({ 上次状态 }));
  assert.equal(r.toAlert.length, 0);
  assert.equal(r.toResolve.length, 1);
  assert.equal(r.toResolve[0].键, 键A);
  assert.equal(r.状态.windows[键A].告警中, false);
});

test("回执已落的任务窗不告警（工收完了，等收窗）", () => {
  const r1 = 判定心跳(基准({ 记录: [监听记录()], 任务窗: [{ 任务: 任务A, 开窗时间: new Date(NOW - 30 * MIN).toISOString(), 回执已落: true }] }));
  assert.equal(r1.toAlert.length, 0);
  // 有记录但标了已交回执（登记已摘的残留）也不告警
  const r2 = 判定心跳(基准({ 记录: [记录({ 已交回执: true }), 监听记录()], 任务窗: [] }));
  assert.equal(r2.toAlert.length, 0);
});

test("无心跳记录：超过 10 分钟宽限才报；宽限内等首拍", () => {
  const 超时 = 判定心跳(基准({ 记录: [监听记录()], 任务窗: [{ 任务: 任务B, 开窗时间: new Date(NOW - 20 * MIN).toISOString(), 回执已落: false }] }));
  assert.equal(超时.toAlert.length, 1);
  assert.match(超时.toAlert[0].原因, /没有心跳记录/);

  const 宽限内 = 判定心跳(基准({ 记录: [监听记录()], 任务窗: [{ 任务: 任务B, 开窗时间: new Date(NOW - 5 * MIN).toISOString(), 回执已落: false }] }));
  assert.equal(宽限内.toAlert.length, 0);
  const 键B = 规整键("@" + 任务B);
  assert.match(宽限内.状态.windows[键B].状态, /等待首次心跳/);
});

test("心跳功能上线前开的历史窗口：无记录也不追着告警", () => {
  const r = 判定心跳(
    基准({
      记录: [监听记录()],
      任务窗: [{ 任务: 任务B, 开窗时间: new Date(NOW - 3 * 60 * MIN).toISOString(), 回执已落: false }],
      上线时间Ms: NOW - 60 * MIN
    })
  );
  assert.equal(r.toAlert.length, 0);
});

test("监听窗无记录：进程在→补写手；进程不在→先复判再重开；扫描不可用→直接报", () => {
  // 监听窗进程在、只是没记录（写手没挂上）→ 补写手，不报
  const 写手停 = 判定心跳(基准({ 记录: [], 任务窗: [] }));
  assert.equal(写手停.toAlert.length, 0);
  assert.equal(写手停.toHeal.length, 1);
  assert.equal(写手停.toHeal[0].动作, "补写手");
  assert.equal(写手停.toHeal[0].类型, "listener");

  // 监听窗进程不在 → 先复判（不立刻报、不立刻重开）
  const 进程没监听 = [进程(40828, "node pi-coding-agent @D:\\任务\\a.md")];
  const 首轮 = 判定心跳(基准({ 记录: [], 任务窗: [], 进程列表: 进程没监听 }));
  assert.equal(首轮.toAlert.length, 0, "死亡先复判，不瞬时报/重开");
  assert.equal(首轮.toHeal.length, 0);
  assert.ok(首轮.状态.windows.listener.复判, "要记下复判等待");

  // 下一轮仍不在 → 重开（自愈动作，不发板）
  const 次轮 = 判定心跳(基准({
    记录: [],
    任务窗: [],
    进程列表: 进程没监听,
    上次状态: { windows: { listener: { 名: "监听窗", 复判: { 发现At: new Date(NOW - 30 * MIN).toISOString(), 原因: "监听窗进程不在" } } } }
  }));
  assert.equal(次轮.toAlert.length, 0);
  assert.equal(次轮.toHeal.length, 1);
  assert.equal(次轮.toHeal[0].动作, "重开");

  // 扫描失败不算“不在”：直接报（没有活写手），不重开
  const 扫描挂 = 判定心跳(基准({ 记录: [], 任务窗: [], 进程列表: null }));
  assert.equal(扫描挂.toAlert.length, 1);
  assert.equal(扫描挂.toHeal.length, 0);
  assert.equal(扫描挂.状态.windows.listener.复判, null);

  // 开机宽限内不报（写手可能还没来得及起来）
  const 宽限内 = 判定心跳(基准({ bootTimeMs: NOW - 5 * MIN, 记录: [], 任务窗: [] }));
  assert.equal(宽限内.toAlert.length, 0);

  // 旧记录过了宽限 → 死亡路径（第一轮复判，不直接报）
  const 旧记录 = 判定心跳(基准({ 记录: [记录({ 类型: "listener", 认窗: ["27.企业微信机器人", "boot-prompt.md"], 最后心跳: new Date(BOOT - MIN).toISOString() })], 任务窗: [] }));
  assert.equal(旧记录.toAlert.length, 0);
  assert.ok(旧记录.状态.windows.listener.复判);
  assert.match(旧记录.状态.windows.listener.复判.原因, /早于本次开机/);
});

test("进程扫描失败（null）不许当成“进程不在”", () => {
  const 新鲜 = 判定心跳(基准({ 进程列表: null }));
  assert.equal(新鲜.toAlert.length, 0, "扫描不可用时只看心跳新旧");
  const 超时 = 判定心跳(基准({ 进程列表: null, 记录: [记录({ 最后心跳: new Date(NOW - 20 * MIN).toISOString() }), 监听记录()] }));
  assert.equal(超时.toAlert.length, 1, "心跳超时照样报");
  assert.match(超时.toAlert[0].原因, /没有心跳/);
});

test("心跳功能第一次跑（上线时间未落）：无记录先不报，等一个周期首拍", () => {
  const r = 判定心跳(基准({ 记录: [], 任务窗: [{ 任务: 任务A, 开窗时间: new Date(NOW - 40 * MIN).toISOString(), 回执已落: false }], 上线时间Ms: null }));
  assert.equal(r.toAlert.length, 0, "首次上线不因无记录误报（监听窗/任务窗都不报）");
  assert.ok(r.状态.上线At, "首次跑要落上线时间，供下次判定");
});

test("上次告警中的窗口整个消失（记录被正常收窗清掉）→ 补 [已解决]", () => {
  const 上次状态 = {
    windows: { [键A]: { 名: "任务窗·a.md", 告警中: true, lastAlertAt: new Date(NOW - 30 * MIN).toISOString() } }
  };
  const r = 判定心跳(基准({ 记录: [监听记录()], 任务窗: [], 上次状态 }));
  assert.equal(r.toAlert.length, 0);
  assert.equal(r.toResolve.length, 1);
  assert.match(r.toResolve[0].原因, /记录已清/);
});

// ================= 写手用例 =================

test("解析进程行 / 认窗匹配：认真实 pi 进程、全部匹配串都要命中", () => {
  const 文本 = [
    '111|2026-10-09 17:00:00|"C:\\Program Files\\nodejs\\node.exe" cli.js pi-coding-agent @D:\\任务\\a.md',
    '222|2026-10-09 17:01:00|"C:\\nodejs\\node.exe" cli.js pi-coding-agent @D:\\任务\\b.md',
    "垃圾行",
    ""
  ].join("\r\n");
  const 列表 = 心跳.解析进程行(文本);
  assert.equal(列表.length, 2);
  assert.equal(列表[0].pid, 111);
  assert.match(列表[0].命令行, /pi-coding-agent/);
  assert.equal(心跳.认窗匹配(列表, ["pi-coding-agent", "@D:\\任务\\a.md"]).length, 1);
  assert.equal(心跳.认窗匹配(列表, ["pi-coding-agent", "@D:\\任务\\a.md"])[0].pid, 111);
  assert.equal(心跳.认窗匹配(列表, ["pi-coding-agent", "boot-prompt.md"]).length, 0, "要全部匹配串都命中");
});

test("心跳台账：多窗并发写都能保留；清只清命中的、没命中不改文件", () => {
  const 临时 = 临时目录();
  const 文件 = path.join(临时, "窗口心跳.json");
  try {
    assert.equal(心跳.写心跳条目(文件, 记录()), true);
    assert.equal(
      心跳.写心跳条目(文件, 记录({ 名: "监听窗", 类型: "listener", pid: 1, 认窗: ["27.企业微信机器人", "boot-prompt.md"] })),
      true
    );
    assert.equal(Object.keys(心跳.读心跳(文件)).length, 2, "两个窗口的记录都在");
    assert.equal(心跳.清心跳(文件, (r) => (Array.isArray(r.认窗) ? r.认窗[0] : r.认窗) === 认窗A), 1);
    assert.equal(Object.keys(心跳.读心跳(文件)).length, 1);
    const 前 = fs.readFileSync(文件, "utf8");
    assert.equal(心跳.清心跳(文件, () => false), 0);
    assert.equal(fs.readFileSync(文件, "utf8"), 前, "没命中就不改写文件");
    assert.ok(JSON.parse(前).更新At, "台账带更新时间");
  } finally {
    fs.rmSync(临时, { recursive: true, force: true });
  }
});

test("心跳台账有锁：占用中的锁不硬闯；陈旧锁（死 pid）能接管", () => {
  const 临时 = 临时目录();
  const 文件 = path.join(临时, "窗口心跳.json");
  const 锁 = 文件 + ".lock";
  try {
    fs.writeFileSync(锁, JSON.stringify({ pid: process.pid, at: Date.now() }));
    assert.equal(心跳.带锁(锁, () => "不给", { 等待毫秒: 120 }), null, "锁在活进程手里，拿不到就跳过这一拍");
    fs.writeFileSync(锁, JSON.stringify({ pid: 99999999, at: Date.now() - 60 * 1000 }));
    assert.equal(心跳.带锁(锁, () => "拿到", { 等待毫秒: 500 }), "拿到");
    assert.equal(fs.existsSync(锁), false);
  } finally {
    fs.rmSync(临时, { recursive: true, force: true });
  }
});

test("写手：认不到窗口 → 重试超时退出，不写心跳", async () => {
  const 临时 = 临时目录();
  const 文件 = path.join(临时, "窗口心跳.json");
  try {
    const r = await 心跳.主循环({
      认窗组: ["pi-coding-agent", "@D:\\没有这个窗.md"],
      名: "测试窗",
      状态文件: 文件,
      日志文件: path.join(临时, "心跳.log"),
      扫描: () => ({ ok: true, 列表: [] }),
      认窗超时秒: 0,
      拍数: 2
    });
    assert.match(r.退出, /认不到窗口/);
    assert.equal(r.写拍数, 0);
    assert.deepEqual(心跳.读心跳(文件), {});
  } finally {
    fs.rmSync(临时, { recursive: true, force: true });
  }
});

test("写手：认到的假窗口进程消失 → 停写退出，记录留为过期（不是抹掉）", async () => {
  const 临时 = 临时目录();
  const 文件 = path.join(临时, "窗口心跳.json");
  const 标记 = "@F:\\fake\\task-heartbeat-test.md";
  const 子 = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 60000)", "--", "pi-coding-agent", 标记], { stdio: "ignore" });
  let 第几次 = 0;
  try {
    const r = await 心跳.主循环({
      认窗组: ["pi-coding-agent", 标记],
      名: "假窗口",
      状态文件: 文件,
      日志文件: path.join(临时, "心跳.log"),
      扫描: () => 心跳.扫pi进程(), // 真扫，验证认窗链路端到端
      睡眠: async () => {
        第几次++;
        if (第几次 === 1) 子.kill();
        await new Promise((res) => setTimeout(res, 300));
      },
      拍数: 8
    });
    assert.match(r.退出, /没找到匹配|认窗 pid 变了/, `退出=${r.退出}`);
    const 条目 = Object.values(心跳.读心跳(文件))[0];
    assert.ok(条目, "记录要留给看门狗报警，不许悄悄抹掉");
    assert.ok(Date.parse(条目.最后心跳) <= Date.now(), "最后心跳是停写前的旧时间");
  } finally {
    try { 子.kill(); } catch { /* 测试假进程 */ }
    fs.rmSync(临时, { recursive: true, force: true });
  }
});

// ================= 接线 / 反向断言 =================

test("反向断言：认窗必须敲真实 pi 进程，不许用包装壳 pid", () => {
  const 写手源 = fs.readFileSync(path.join(__dirname, "..", "scripts", "窗口心跳.cjs"), "utf8");
  assert.match(写手源, /pi-coding-agent/, "认窗必须扫 pi-coding-agent 进程");
  assert.match(写手源, /--认窗/, "必须用命令行匹配串认窗");
  assert.match(写手源, /命中\.length > 1/, "多个命中必须拒绝，不许猜一个");
  assert.doesNotMatch(写手源, /--pid/, "不许支持外部传 pid（登记里是包装壳 pid，会认错）");
});

test("反向断言：开任务窗顺手挂心跳；关任务窗正常收窗清心跳、死窗留证", () => {
  const 开源 = fs.readFileSync(path.join(__dirname, "..", "..", "0.木婉清档案", "开任务窗.cjs"), "utf8");
  assert.match(开源, /窗口心跳\.cjs/);
  assert.match(开源, /--认窗/);
  assert.match(开源, /'@' \+ 任务文件/, "任务窗认窗要用 @<任务文件>");

  const 关源 = fs.readFileSync(path.join(__dirname, "..", "..", "0.木婉清档案", "关任务窗.cjs"), "utf8");
  assert.match(关源, /清心跳记录/);
  assert.match(关源, /死窗留证给看门狗/, "死窗不许静默清心跳（否则压掉告警）");
});

test("关任务窗：正常收窗（回执落地、窗口还活着）→ 关窗并清心跳", async () => {
  const 临时 = 临时目录();
  const 任务 = path.join(临时, "任务", "假任务.md");
  fs.mkdirSync(path.dirname(任务), { recursive: true });
  const 登记文件 = path.join(临时, "任务窗.json");
  const 心跳文件 = path.join(临时, "窗口心跳.json");
  const 回执文件 = path.join(临时, "回执.md");
  const 子 = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 30000)"], { stdio: "ignore" });
  try {
    心跳.写心跳条目(心跳文件, {
      名: "任务窗·假任务.md",
      类型: "task",
      pid: 子.pid,
      认窗: ["@" + 任务],
      启动时间: new Date().toISOString(),
      最后心跳: new Date().toISOString()
    });
    关窗.写登记([{ 任务, pid: 子.pid, 开窗时间: new Date(Date.now() - 60000).toISOString() }], 登记文件);
    fs.writeFileSync(回执文件, "测试回执");
    关窗.守卫({
      任务,
      pid: 子.pid,
      最久: 5000,
      间隔: 100,
      宽限: 50,
      台账文件: 登记文件,
      心跳文件,
      回执文件,
      开窗时间: new Date(Date.now() - 60000).toISOString()
    });
    await new Promise((r) => setTimeout(r, 1000));
    assert.equal(关窗.读登记(登记文件).length, 0, "正常收窗摘登记");
    assert.equal(Object.keys(心跳.读心跳(心跳文件)).length, 0, "正常收窗清心跳");
  } finally {
    try { 子.kill(); } catch { /* 测试假进程 */ }
    fs.rmSync(临时, { recursive: true, force: true });
  }
});

test("关任务窗：窗口异常死亡（没回执）→ 摘登记但心跳记录留着", async () => {
  const 临时 = 临时目录();
  const 任务 = path.join(临时, "任务", "假任务.md");
  fs.mkdirSync(path.dirname(任务), { recursive: true });
  const 登记文件 = path.join(临时, "任务窗.json");
  const 心跳文件 = path.join(临时, "窗口心跳.json");
  const 子 = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 30000)"], { stdio: "ignore" });
  try {
    心跳.写心跳条目(心跳文件, {
      名: "任务窗·假任务.md",
      类型: "task",
      pid: 子.pid,
      认窗: ["@" + 任务],
      启动时间: new Date().toISOString(),
      最后心跳: new Date().toISOString()
    });
    关窗.写登记([{ 任务, pid: 子.pid, 开窗时间: new Date(Date.now() - 60000).toISOString() }], 登记文件);
    子.kill();
    await new Promise((r) => setTimeout(r, 300));
    关窗.守卫({
      任务,
      pid: 子.pid,
      最久: 5000,
      间隔: 100,
      宽限: 50,
      台账文件: 登记文件,
      心跳文件,
      回执文件: path.join(临时, "不存在的回执.md"),
      开窗时间: new Date(Date.now() - 60000).toISOString()
    });
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(关窗.读登记(登记文件).length, 0, "死窗守卫要摘登记");
    assert.equal(Object.keys(心跳.读心跳(心跳文件)).length, 1, "死窗心跳不许清（留着给看门狗报警）");
  } finally {
    try { 子.kill(); } catch { /* 测试假进程 */ }
    fs.rmSync(临时, { recursive: true, force: true });
  }
});
