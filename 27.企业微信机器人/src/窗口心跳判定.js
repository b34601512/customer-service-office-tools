"use strict";

/**
 * 窗口心跳判定 —— 纯函数（无 IO、无副作用，便于单测）。
 *
 * 背景（2026-10-09，黎路遥拍板；赵敏/程灵素/木婉清对齐）：
 * - pi 窗口挂了要能在机器人留言板发 [故障]，死窗口自己报不了自己 → 心跳写手随窗口停写，
 *   由独立 5 分钟看门狗（scripts/企微看门狗.js）判定并写板。
 * - 报警时机（2026-10-09 窗口心跳自愈三条）：
 *   ① 监听窗进程没了 → 先自愈重开（本机计划任务派生 open-pi-window.cmd）；
 *   ② 自愈成功只留本地记录、不刷板；自愈失败才 [故障]；
 *   ③ 进程在、只缺心跳 → 先补写手（不杀窗、不重开），补上不刷板、补不上才 [故障]。
 * - 附加（赵敏补充、已对齐）：同一监听窗 1 小时内自愈满 3 次（崩溃循环）→ 仍发 [故障]「反复重启」；
 *   任务窗没有“重开”一说（死了没法续上下文，真挂了照旧直接报）——进程还在只缺写手的补写手
 *   对任务窗同样适用（写手是无状态的书童，不涉及续上下文）。
 *
 * 判定口径：
 * - 应活窗口 = 监听窗 + 任务窗.json 里登记且**回执未落**的任务窗；
 *   另外，有心跳记录但登记被摘（窗口异常死亡时守卫会摘登记）的，只要回执没落也照样算应活。
 * - 异常 = 心跳 > staleMin（默认 10）分钟没更新 **或** 认窗进程不在（进程扫描双保险；扫描失败不算“不在”）。
 * - 自愈（本文件只做决定，动作由看门狗执行；执行结果通过“上次状态”回灌）：
 *   · 写手停（进程明确在 + 心跳停/缺）→ toHeal 补写手；等 healWaitSec（默认 2 拍≈5 分钟）仍无心跳
 *     → [故障]「进程在、心跳补不上」（沿用 60 分钟去重）；补上 → 自愈结果=成功（只记本地日志）。
 *   · 监听窗死（监听进程扫描明确“不在”）→ 先记 复判，下一轮仍死且距上次重开 ≥ reopenThrottleSec
 *     → toHeal 重开；重开成败由看门狗回灌状态。重开前看门狗还会**再扫一次**复核（唯一命中才算在）。
 *   · 任务窗死 → 直接 [故障]（无自愈）。
 *   · 1 小时窗口内重开记录 ≥ flappingCount（默认 3）→ 即使心跳正常也 [故障]「反复重启」。
 * - 开机 30 分钟内不报也不自愈（写手/窗口可能还没起来）；心跳早于本次开机的旧记录按关机残留忽略
 *   （监听窗例外：过了宽限还没新心跳，说明开机后监听窗没起来，要走自愈/报警）。
 * - 回执已落的任务窗不告警（工收完了，等守卫收窗）。
 * - 同一窗口告警后 dedupeMin（默认 60）分钟内不重报；恢复正常则出一条 [已解决]。
 */

const path = require("path");

const MINUTE = 60 * 1000;

const DEFAULT_HEARTBEAT_CONFIG = Object.freeze({
  staleMin: 10,        // 心跳超时（分钟）
  bootGraceMin: 30,    // 开机宽限（分钟）
  dedupeMin: 60,       // 同窗重报冷却（分钟）
  missingGraceMin: 10, // 无心跳记录的宽限：任务窗按开窗时间起算
  listenerName: "监听窗",
  listenerMatch: ["27.企业微信机器人", "boot-prompt.md"], // 监听窗进程认窗串（无记录时用来判在不在）
  healWaitSec: 300,        // 补写手后等心跳的时间（2 拍 × 150s）
  healRetrySec: 600,       // 补写手失败后，距上次尝试多久才允许再补（防连发写手）
  recheckSec: 240,         // 监听窗死亡“复判”等待（一个巡检周期≈5 分钟，留 4 分钟容差）
  reopenThrottleSec: 300,  // 两次重开至少隔一个巡检周期
  reopenConfirmSec: 90,    // 重开后等心跳出现的确认时间（看门狗用）
  flappingWindowSec: 3600, // “反复重启”统计窗
  flappingCount: 3         // 1 小时内重开达到几次算崩溃循环
});

/** 统一键：反斜杠、去尾斜杠、小写（Windows 路径不区分大小写）。 */
function 规整键(s) {
  return String(s || "").replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

function 解析毫秒(v) {
  if (v == null || v === "") return null;
  const t = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function 取认窗(记录) {
  const v = (记录 && 记录.认窗) || [];
  return (Array.isArray(v) ? v : [v]).map((x) => String(x || "")).filter(Boolean);
}

/** 纯进程命中判定：进程列表不可用（非数组）→ 返回 null（未知，不许当“不在”）。 */
function 进程命中(进程列表, pid, 认窗组) {
  if (!Array.isArray(进程列表)) return null;
  const 组 = Array.isArray(认窗组) ? 认窗组 : [认窗组];
  return 进程列表.some(
    (p) => Number(p && p.pid) === Number(pid) && 组.every((s) => String((p && p.命令行) || "").includes(s))
  );
}

/** 监听窗进程在不在：唯一命中=在；0 个=不在；>1 个或扫描失败=说不清（null）。 */
function 监听进程在(进程列表, 匹配组) {
  if (!Array.isArray(进程列表)) return { 在: null, 原因: "进程扫描不可用" };
  const 组 = Array.isArray(匹配组) ? 匹配组 : [匹配组];
  const 命中 = (进程列表 || []).filter((p) => 组.every((s) => String((p && p.命令行) || "").includes(String(s))));
  if (命中.length === 1) return { 在: true, 进程: 命中[0] };
  if (命中.length === 0) return { 在: false, 原因: "没找到监听窗进程" };
  return { 在: null, 原因: `匹配到 ${命中.length} 个监听窗进程（说不清）` };
}

function 最近时刻(列表) {
  const 时刻 = (Array.isArray(列表) ? 列表 : []).map(解析毫秒).filter((t) => t != null);
  return 时刻.length ? Math.max(...时刻) : null;
}

/**
 * 判定一轮。输入均为快照（由调用方负责读文件/扫进程）：
 *  - 记录: 窗口心跳.json 里的 { 窗口 } 映射转成数组；每条 {名,类型,pid,认窗,启动时间,最后心跳,已交回执?}
 *  - 任务窗: 任务窗.json 的窗口数组；每条需带 回执已落:boolean（调用方算好）
 *  - 进程列表: [{pid, 命令行}]；null = 扫描失败（本轮不判 pid 不在）
 *  - 写手锁: { [规整键(认窗[0])]: {活跃:boolean} }；看门狗从单实例锁文件读出
 *  - 上线时间Ms: 心跳功能首次运行的时刻（历史窗口不追着要心跳）；null = 第一次跑
 *  - 上次状态: { windows: {键: {...}} }（上次落盘）
 * 输出：
 *  - toHeal: 本轮要做自愈动作 [{键,名,类型,动作:"补写手"|"重开",认窗,原因,证据}]（看门狗执行）
 *  - 自愈结果: 本地记录用 [{键,名,类型,动作,结果:"成功"|"失败",说明}]（不发板）
 *  - toAlert / toResolve / 状态 / 目标 / 摘要：同既往
 */
function 判定心跳({
  nowMs,
  bootTimeMs = null,
  记录: 记录入 = [],
  任务窗: 任务窗入 = [],
  进程列表: 进程列表入 = null,
  写手锁: 写手锁入 = null,
  上线时间Ms = null,
  上次状态 = {},
  config = {}
} = {}) {
  const 记录 = Array.isArray(记录入) ? 记录入 : [];
  const 任务窗 = Array.isArray(任务窗入) ? 任务窗入 : [];
  const 进程列表 = Array.isArray(进程列表入) ? 进程列表入 : null;
  const 写手锁 = 写手锁入 && typeof 写手锁入 === "object" ? 写手锁入 : {};
  const 上次窗口 = 上次状态 && typeof 上次状态 === "object" && 上次状态.windows && typeof 上次状态.windows === "object" ? 上次状态.windows : {};
  const cfg = { ...DEFAULT_HEARTBEAT_CONFIG, ...(config || {}) };
  const 有开机时刻 = Number.isFinite(bootTimeMs);
  const 开机宽限 = 有开机时刻 && nowMs - bootTimeMs < cfg.bootGraceMin * MINUTE;
  const 时间到 = (t) => new Date(t).toISOString();

  // ---------------- 组建应活窗口目标 ----------------
  const 目标 = [];
  const 已加 = new Set();
  const 加目标 = (t) => {
    if (!已加.has(t.键)) {
      已加.add(t.键);
      目标.push(t);
    }
  };

  // 1) 监听窗（先挑最后心跳最新的一条监听记录）
  const 监听记录 =
    [...记录]
      .filter((r) => String(r && r.类型) === "listener")
      .sort((a, b) => (解析毫秒(b && b.最后心跳) || 0) - (解析毫秒(a && a.最后心跳) || 0))[0] || null;
  加目标({ 键: "listener", 名: cfg.listenerName, 类型: "listener", 记录: 监听记录, 开窗时间Ms: null, 来源: "监听窗" });

  // 2) 登记且回执未落的任务窗
  for (const t of 任务窗) {
    if (!t || !t.任务) continue;
    if (t.回执已落) continue;
    const 键 = 规整键("@" + t.任务);
    const 命中记录 = 记录.find((r) => String(r && r.类型) !== "listener" && 取认窗(r).some((x) => 规整键(x) === 键)) || null;
    加目标({
      键,
      名: "任务窗·" + path.basename(String(t.任务)),
      类型: "task",
      记录: 命中记录,
      开窗时间Ms: 解析毫秒(t.开窗时间),
      来源: "登记"
    });
  }

  // 3) 有记录、但登记里没有（异常死亡时守卫摘了登记；正常收窗的记录会被清掉）
  for (const r of 记录) {
    if (String(r && r.类型) === "listener") continue;
    const 组 = 取认窗(r);
    if (!组.length) continue;
    const 键 = 规整键(组[0]);
    if (已加.has(键)) continue;
    if (r.已交回执) continue; // 回执已落 = 已收工，不告警
    加目标({ 键, 名: (r && r.名) || "任务窗·" + 组[0], 类型: "task", 记录: r, 开窗时间Ms: null, 来源: "记录" });
  }

  // ---------------- 逐个判定 ----------------
  const toAlert = [];
  const toResolve = [];
  const toHeal = [];
  const 自愈结果 = [];
  const 窗口状态 = {};
  let 正常数 = 0;
  let 忽略数 = 0;

  for (const 目标项 of 目标) {
    const 上 = (上次窗口[目标项.键] || {});
    const 状态 = {
      名: 目标项.名,
      类型: 目标项.类型,
      pid: null,
      最后心跳: null,
      状态: "",
      告警中: !!上.告警中,
      lastAlertAt: 上.lastAlertAt || null,
      lastResolveAt: 上.lastResolveAt || null,
      复判: 上.复判 || null,
      自愈: 上.自愈 || null,
      补写手At: 上.补写手At || null,
      重开记录: (Array.isArray(上.重开记录) ? 上.重开记录 : []).map(String).filter((t) => 解析毫秒(t) != null)
    };
    const 认窗组 = 目标项.记录 ? 取认窗(目标项.记录) : (目标项.类型 === "listener" ? cfg.listenerMatch.map(String) : []);
    const 写手在 = !!((写手锁[规整键(认窗组[0])] || (目标项.类型 === "listener" ? 写手锁[规整键(cfg.listenerMatch[0])] : null) || {}).活跃);
    let 异常 = null; // {原因, 证据, 类?}
    let 死亡 = false; // 监听窗/任务窗“进程明确不在”

    if (!目标项.记录) {
      if (上线时间Ms == null) {
        // 心跳功能第一次跑：老窗口（含监听窗）都还没挂写手，给一个周期等首拍——避免“上线即误报”。
        状态.状态 = "心跳首次上线（等首拍）";
      } else if (目标项.类型 === "listener") {
        const 在 = 监听进程在(进程列表, cfg.listenerMatch);
        if (在.在 === true) {
          异常 = { 原因: "没有心跳记录（写手没起来？）", 证据: `监听窗进程在（pid ${在.进程.pid}），但本机没有监听窗心跳`, 类: "写手停" };
        } else if (在.在 === false) {
          死亡 = true;
          异常 = { 原因: "监听窗进程不在（也没有心跳记录）", 证据: "本机没有任何监听窗心跳，进程扫描里也没有监听窗", 类: "死亡" };
        } else {
          异常 = { 原因: "没有心跳记录（监听窗写手没起来？）", 证据: "本机没有任何监听窗心跳；" + 在.原因, 类: "说不清" };
        }
      } else if (目标项.开窗时间Ms != null && nowMs - 目标项.开窗时间Ms < cfg.missingGraceMin * MINUTE) {
        状态.状态 = "等待首次心跳";
      } else if (目标项.开窗时间Ms != null && 目标项.开窗时间Ms < 上线时间Ms) {
        状态.状态 = "心跳上线前开的窗（不告警）";
      } else {
        异常 = {
          原因: "没有心跳记录（写手没起来？）",
          证据: 目标项.开窗时间Ms != null ? `登记开窗 ${时间到(目标项.开窗时间Ms)}，从未收到心跳` : "登记里没有开窗时间，也从未收到心跳"
        };
      }
    } else {
      const 心跳Ms = 解析毫秒(目标项.记录 && 目标项.记录.最后心跳);
      const 组 = 取认窗(目标项.记录);
      状态.pid = (目标项.记录 && 目标项.记录.pid) || null;
      状态.最后心跳 = (目标项.记录 && 目标项.记录.最后心跳) || null;

      if (心跳Ms == null) {
        异常 = { 原因: "心跳记录坏了（最后心跳读不出来）", 证据: `记录键 ${目标项.键}；pid=${状态.pid}` };
      } else if (有开机时刻 && 心跳Ms < bootTimeMs) {
        if (目标项.类型 === "listener") {
          if (!开机宽限) {
            死亡 = true;
            异常 = { 原因: "心跳早于本次开机（监听窗写手没起来？）", 证据: `最后心跳 ${时间到(心跳Ms)}，本次开机 ${时间到(bootTimeMs)}`, 类: "死亡" };
          } else {
            状态.状态 = "开机宽限（旧记录）";
          }
        } else {
          状态.状态 = "旧记录（早于本次开机，按关机残留忽略）";
        }
      } else {
        const 分钟前 = Math.max(0, Math.round((nowMs - 心跳Ms) / MINUTE));
        const 过期 = nowMs - 心跳Ms > cfg.staleMin * MINUTE;
        const 监听在 = 目标项.类型 === "listener" ? 监听进程在(进程列表, cfg.listenerMatch) : null;
        const pid命中 = 目标项.类型 === "listener"
          ? (监听在.在 === null ? null : 监听在.在)
          : 进程命中(进程列表, 状态.pid, 组);
        const 扫描述 = 进程列表 == null
          ? "不可用"
          : pid命中 === false
            ? "里不在"
            : 目标项.类型 === "listener" && 监听在.在 === null
              ? "：" + 监听在.原因
              : "里在";
        if (过期) {
          if (pid命中 === true) {
            异常 = {
              原因: `超过 ${cfg.staleMin} 分钟没有心跳`,
              证据: `pid=${状态.pid}，最后心跳 ${分钟前} 分钟前（${时间到(心跳Ms)}），进程扫描里在`,
              类: "写手停"
            };
          } else if (目标项.类型 === "listener" && 监听在.在 === false) {
            死亡 = true;
            异常 = {
              原因: "监听窗认窗进程不在（心跳也停了）",
              证据: `pid=${状态.pid} 不在进程扫描里，最后心跳 ${分钟前} 分钟前（${时间到(心跳Ms)}）`,
              类: "死亡"
            };
          } else {
            异常 = {
              原因: `超过 ${cfg.staleMin} 分钟没有心跳`,
              证据: `pid=${状态.pid}，最后心跳 ${分钟前} 分钟前（${时间到(心跳Ms)}），进程扫描${扫描述}`
            };
          }
        } else if (pid命中 === false) {
          死亡 = 目标项.类型 === "listener";
          异常 = {
            原因: 目标项.类型 === "listener" ? "监听窗认窗进程不在" : "认窗进程不在",
            证据: `pid=${状态.pid} 不在进程扫描里，最后心跳 ${分钟前} 分钟前（${时间到(心跳Ms)}）`,
            类: 死亡 ? "死亡" : undefined
          };
        } else {
          状态.状态 = "正常";
        }
      }
    }

    // ---------------- 自愈状态机（只动“进程在只缺心跳”和“监听窗死”；任务窗死直接报） ----------------
    let 自愈动作 = null;
    if (异常 && 开机宽限) {
      状态.状态 = `开机宽限（宽限内不报：${异常.原因}）`;
      // 保持 复判/自愈 原样，等宽限过去再处理
    } else if (异常 && !死亡 && 异常.类 === "写手停") {
      const 现在Iso = 时间到(nowMs);
      const 自愈等待够 = 状态.自愈 && 状态.自愈.动作 === "补写手" && nowMs - (解析毫秒(状态.自愈.开始At) || 0) >= cfg.healWaitSec * 1000;
      const 再补早于 = 解析毫秒(状态.补写手At);
      if (自愈等待够) {
        // 补了写手、等够 2 拍还是没心跳 → 走 [故障]“进程在、心跳补不上”
        const 补写时刻 = (状态.自愈 && 解析毫秒(状态.自愈.开始At)) || nowMs;
        状态.自愈 = null;
        异常 = {
          原因: "进程在、心跳补不上（补写手后仍无心跳）",
          证据: `${异常.证据}；补写手于 ${时间到(补写时刻)}，等 ${Math.round(cfg.healWaitSec / 60)} 分钟仍无心跳`,
          类: "写手停",
          已试自愈: "补写手（未恢复）"
        };
        状态.状态 = "告警：" + 异常.原因;
        自愈结果.push({ 键: 目标项.键, 名: 目标项.名, 类型: 目标项.类型, 动作: "补写手", 结果: "失败", 说明: 异常.原因 });
      } else if (状态.自愈 && 状态.自愈.动作 === "补写手") {
        // 已补、等心跳
        状态.状态 = 写手在 ? "自愈中：写手在跑，等心跳恢复" : "自愈中：已补写手，等心跳恢复";
        异常 = null;
      } else if (写手在) {
        // 写手在跑但心跳没恢复：从现在开始计时，超时按“补不上”报
        状态.自愈 = { 动作: "补写手", 开始At: 现在Iso };
        状态.补写手At = 状态.补写手At || 现在Iso;
        状态.状态 = "自愈中：写手在跑，等心跳恢复";
        异常 = null;
      } else if (再补早于 == null || nowMs - 再补早于 >= cfg.healRetrySec * 1000) {
        // 补写手（不杀窗、不重开）
        自愈动作 = { 键: 目标项.键, 名: 目标项.名, 类型: 目标项.类型, 动作: "补写手", 认窗: 认窗组, 原因: 异常.原因, 证据: 异常.证据 };
        状态.自愈 = { 动作: "补写手", 开始At: 现在Iso };
        状态.补写手At = 现在Iso;
        状态.状态 = "自愈中：补写手";
        异常 = null;
      } else {
        // 上次补写手还在等待窗口内：先等，别再连发
        状态.状态 = "自愈中：等待写手补挂";
        异常 = null;
      }
    } else if (异常 && 死亡 && 目标项.类型 === "listener") {
      const 现在Iso = 时间到(nowMs);
      状态.自愈 = null; // 都死了，不再挂着“补写手”（重开是另一条路）
      if (!状态.复判) {
        状态.复判 = { 发现At: 现在Iso, 原因: 异常.原因, 证据: 异常.证据 };
        状态.状态 = "监听窗疑似死亡（等下一轮复判，防瞬时报错开双窗）";
        异常 = null; // 先复判，不报警也不动作
      } else {
        const 复判够 = nowMs - (解析毫秒(状态.复判.发现At) || 0) >= cfg.recheckSec * 1000;
        const 最近重开 = 最近时刻(状态.重开记录);
        if (!复判够) {
          状态.状态 = "监听窗疑似死亡（复判等待中）";
          异常 = null;
        } else if (最近重开 != null && nowMs - 最近重开 < cfg.reopenThrottleSec * 1000) {
          状态.状态 = "监听窗死亡（重开节流中，等一个巡检周期）";
          异常 = null;
        } else {
          自愈动作 = {
            键: 目标项.键,
            名: 目标项.名,
            类型: "listener",
            动作: "重开",
            认窗: cfg.listenerMatch.map(String),
            原因: (状态.复判 && 状态.复判.原因) || 异常.原因,
            证据: (状态.复判 && 状态.复判.证据) || 异常.证据
          };
          状态.自愈 = { 动作: "重开", 开始At: 现在Iso };
          状态.复判 = null;
          状态.状态 = "自愈中：重开监听窗";
          异常 = null;
        }
      }
    } else if (!异常 && 状态.自愈 && 状态.自愈.动作 === "补写手") {
      // 心跳恢复 → 自愈成功（只记本地日志，不发板）
      自愈结果.push({ 键: 目标项.键, 名: 目标项.名, 类型: 目标项.类型, 动作: "补写手", 结果: "成功", 说明: `心跳已恢复（${状态.最后心跳 || ""}）` });
      状态.自愈 = null;
      状态.复判 = null; // 活过来了，旧的死亡“复判”不留到下一次死亡
      状态.状态 = "自愈成功：补写手后心跳恢复";
    }

    // ---------------- “反复重启”：1 小时内重开满 N 次 → 即使心跳正常也 [故障] ----------------
    const 窗口内重开 = 状态.重开记录.filter((t) => nowMs - (解析毫秒(t) || 0) < cfg.flappingWindowSec * 1000).length;
    if (目标项.类型 === "listener" && 窗口内重开 >= cfg.flappingCount && !异常) {
      异常 = {
        原因: `反复重启（1 小时内自愈重开 ${窗口内重开} 次）`,
        证据: `最近重开：${状态.重开记录.slice(-3).join("，")}`,
        类: "反复重启",
        已试自愈: `1 小时内已自愈重开 ${窗口内重开} 次（节流不吞事件）`
      };
    }

    // ---------------- 报警 / 恢复 ----------------
    if (异常 && 开机宽限) {
      状态.状态 = `开机宽限（宽限内不报：${异常.原因}）`;
      // 告警中保持原样，等宽限过去再报
    } else if (异常) {
      const 到点 = !状态.告警中 || !状态.lastAlertAt || nowMs - (解析毫秒(状态.lastAlertAt) || 0) >= cfg.dedupeMin * MINUTE;
      if (到点) {
        toAlert.push({ 键: 目标项.键, 名: 目标项.名, 类型: 目标项.类型, 原因: 异常.原因, 证据: 异常.证据, pid: 状态.pid, 最后心跳: 状态.最后心跳, 已试自愈: 异常.已试自愈 || (异常.类 === "写手停" ? "补写手（未恢复）" : undefined) });
        状态.告警中 = true;
        状态.lastAlertAt = 时间到(nowMs);
        状态.状态 = "告警：" + 异常.原因;
      } else {
        状态.告警中 = true;
        状态.状态 = `告警中（${cfg.dedupeMin} 分钟内不重报）：${异常.原因}`;
      }
    } else if (状态.状态 === "正常" || 状态.状态 === "自愈成功：补写手后心跳恢复") {
      正常数++;
      状态.复判 = null; // 活得好，旧的死亡“复判”不留到下一次
      if (状态.告警中) {
        toResolve.push({ 键: 目标项.键, 名: 目标项.名, 类型: 目标项.类型, 原因: "心跳恢复", pid: 状态.pid, 最后心跳: 状态.最后心跳 });
        状态.告警中 = false;
        状态.lastAlertAt = null;
        状态.lastResolveAt = 时间到(nowMs);
      }
    } else {
      // 旧记录忽略 / 等待首拍 / 开机宽限 / 复判等待 / 自愈等待：不报也不销旧告警
      忽略数++;
    }

    if (自愈动作) toHeal.push(自愈动作);
    窗口状态[目标项.键] = 状态;
  }

  // 上一次告警中、这次目标整个消失（记录被清 = 正常收窗）→ 补一条 [已解决]
  for (const [键, 上] of Object.entries(上次窗口)) {
    if (!上 || !上.告警中) continue;
    if (已加.has(键)) continue;
    toResolve.push({ 键, 名: 上.名 || 键, 类型: 上.类型 || "task", 原因: "记录已清（窗口正常收窗）", pid: null, 最后心跳: null });
  }

  const 上线At = 上线时间Ms != null ? 上线时间Ms : nowMs;
  return {
    toAlert,
    toResolve,
    toHeal,
    自愈结果,
    目标: 目标.map((t) => ({ 键: t.键, 名: t.名, 类型: t.类型, 来源: t.来源 })),
    状态: {
      更新At: 时间到(nowMs),
      开机时刻: 有开机时刻 ? 时间到(bootTimeMs) : null,
      上线At: 时间到(上线At),
      windows: 窗口状态
    },
    摘要: { 目标数: 目标.length, 正常: 正常数, 忽略: 忽略数, 告警: toAlert.length, 恢复: toResolve.length, 自愈: toHeal.length }
  };
}

module.exports = {
  DEFAULT_HEARTBEAT_CONFIG,
  判定心跳,
  进程命中,
  监听进程在,
  规整键,
  解析毫秒
};
