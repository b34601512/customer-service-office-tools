"use strict";

/**
 * 窗口自愈执行层（2026-10-09 窗口心跳自愈三条）—— IO 都收在这里，便于单测注入假执行。
 *
 * 判定（要不要自愈、自愈成功/失败怎么算）在 src/窗口心跳判定.js（纯函数）；
 * 本文件只干三件事：
 *   ① `起写手`   —— 派生 `窗口心跳.cjs --后台` 补写手（不杀窗、不重开）；
 *   ② `起监听窗` —— 派生 `scripts/open-pi-window.cmd` 重开监听窗（本机计划任务运行身份
 *                  是 Interactive（b3460，会话 1），能从计划任务里起交互窗口；见回执实录）；
 *   ③ `执行自愈` —— 把判定给的 toHeal 动作真做掉，并把结果回灌进 判定.状态：
 *                  · 补写手：起完就等（成败由下一轮判定按心跳回灌）；
 *                  · 重开：先复核（再扫一次，唯一命中=进程还在就取消，防双开），起窗后等
 *                    reopenConfirmSec（默认 90s）看心跳；成功→记 重开记录、本地日志、不刷板；
 *                    失败/1 小时内重开满 flappingCount 次→推 [故障]。
 *
 * 幂等/防双开：起写手前查单实例锁（窗口心跳.cjs 的锁），起监听窗前复核进程；看门狗自身
 * 有全局单实例锁，5 分钟一轮不会并发。
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const 心跳 = require(path.join(ROOT, "scripts", "窗口心跳.cjs"));
const { 规整键, 解析毫秒, 监听进程在 } = require("./窗口心跳判定");

const 写手脚本 = path.join(ROOT, "scripts", "窗口心跳.cjs");
const 开窗脚本 = path.join(ROOT, "scripts", "open-pi-window.cmd");
const 项目根 = path.resolve(ROOT, "..");

function 默认执行(命令, 参数, 选项 = {}) {
  return spawnSync(命令, 参数, { encoding: "utf8", windowsHide: true, timeout: 60000, ...选项 });
}

// ---------------------------------------------------------------- 动作原语

/** 派生心跳写手（--后台 会立刻返回，真正写手是脱离的子进程）。 */
function 起写手({ 认窗 = [], 名 = "", 类型 = "task", 状态文件, 日志文件 }, { 执行 = 默认执行, 脚本 = 写手脚本 } = {}) {
  const 参 = [脚本, "--后台"];
  for (const x of 认窗) 参.push("--认窗", String(x));
  参.push("--名", String(名 || "未命名窗口"), "--类型", 类型 === "listener" ? "listener" : "task");
  if (状态文件) 参.push("--状态文件", 状态文件);
  if (日志文件) 参.push("--日志文件", 日志文件);
  const r = 执行(process.execPath, 参);
  if (r.status === 0) return { ok: true, 输出: String(r.stdout || "").trim() };
  return { ok: false, 错误: String((r.stderr || r.stdout || (r.error && r.error.message) || `exit ${r.status}`)).trim(), 退出码: r.status };
}

/**
 * 重开监听窗。跟 0.木婉清档案/开任务窗.cjs 同一套派生方式（PowerShell Start-Process，
 * 新控制台窗口），不隐藏窗口；返回 cmd 包装壳 pid（真正 pi pid 由写手扫进程认）。
 */
function 起监听窗({ 命令 = 开窗脚本, 工作目录 = 项目根 } = {}, { 执行 = 默认执行 } = {}) {
  if (!fs.existsSync(命令)) return { ok: false, 错误: `找不到开窗脚本：${命令}` };
  const ps = `$p = Start-Process -FilePath '${String(命令).replace(/'/g, "''")}' -WorkingDirectory '${String(工作目录).replace(/'/g, "''")}' -PassThru -ErrorAction Stop; $p.Id`;
  const r = 执行("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps]);
  const 输出 = String(r.stdout || "");
  const pid = Number((输出.match(/(\d+)/) || [])[1] || 0);
  if (r.status === 0 && pid > 0) return { ok: true, pid, 方式: "Start-Process open-pi-window.cmd" };
  return { ok: false, 错误: String((r.stderr || 输出 || (r.error && r.error.message) || `exit ${r.status}`)).trim(), 退出码: r.status };
}

/** 重开前复核：再扫一次进程，唯一命中监听窗才算“在”（防瞬时报错开出双窗）。 */
function 复核监听窗({ 匹配 = null, 扫描 = 心跳.扫pi进程 } = {}) {
  const 组 = Array.isArray(匹配) ? 匹配 : [];
  const r = 扫描();
  if (!r || r.ok !== true) return { 在: null, 原因: `进程扫描失败：${(r && r.错误) || "未知"}` };
  return 监听进程在(r.列表, 组);
}

function 默认睡(毫秒) {
  return new Promise((resolve) => setTimeout(resolve, 毫秒));
}

/** 等监听窗心跳重新出现（重开后确认）。返回 {ok, 最后心跳, pid}。 */
async function 等心跳出现({ 记录文件, 起点Ms, 超时秒 = 90, 轮询秒 = 10 }, { 读 = 心跳.读心跳, 现在 = () => Date.now(), 睡 = 默认睡 } = {}) {
  const 截止 = 现在() + Math.max(1, Number(超时秒) || 90) * 1000;
  for (;;) {
    let 记录 = null;
    try {
      const 映射 = 读(记录文件) || {};
      记录 = Object.values(映射).find((r) => String(r && r.类型) === "listener") || null;
    } catch {
      记录 = null;
    }
    const t = 记录 ? 解析毫秒(记录.最后心跳) : null;
    if (t != null && t >= 起点Ms - 5000) return { ok: true, 最后心跳: 记录.最后心跳, pid: 记录.pid || null };
    if (现在() >= 截止) return { ok: false, 最后心跳: (记录 && 记录.最后心跳) || null, pid: (记录 && 记录.pid) || null };
    await 睡(Math.min(轮询秒 * 1000, Math.max(0, 截止 - 现在())));
  }
}

// ---------------------------------------------------------------- 执行判定给的动作

function 造告警(判定, 动作, { 原因, 证据, 自愈, cfg = {} }) {
  const 项 = 判定.状态.windows[动作.键] || (判定.状态.windows[动作.键] = {});
  const nowMs = 解析毫秒(判定.状态.更新At) || Date.now();
  const 到点 = !项.告警中 || !项.lastAlertAt || nowMs - (解析毫秒(项.lastAlertAt) || 0) >= (cfg.dedupeMin || 60) * 60000;
  项.告警中 = true;
  if (到点) {
    项.lastAlertAt = new Date(nowMs).toISOString();
    if (!判定.toAlert.some((a) => a.键 === 动作.键 && a.原因 === 原因)) {
      判定.toAlert.push({ 键: 动作.键, 名: 动作.名, 类型: 动作.类型, 原因, 证据, 已试自愈: 自愈 });
    }
  } else {
    项.状态 = `告警中（不重报）：${原因}`;
  }
}

function 清重开记录(项, { 现在 = () => Date.now(), 保留小时 = 24 } = {}) {
  const 列表 = (项 && Array.isArray(项.重开记录) ? 项.重开记录 : []).filter((t) => {
    const ms = 解析毫秒(t);
    return ms != null && 现在() - ms < 保留小时 * 3600 * 1000;
  });
  if (项) 项.重开记录 = 列表.slice(-20);
  return 项 ? 项.重开记录 : [];
}

/**
 * 执行判定给的 toHeal。环境：
 *  记录文件（写手状态文件）、cfg、dryRun、log、记本地日志、保存状态（可空，重开前先落盘）
 *  依赖：起写手/起监听窗/复核监听窗/等心跳/现在（测试注入）
 */
async function 执行自愈(判定, 环境 = {}) {
  const {
    记录文件,
    cfg = {},
    dryRun = false,
    log = console.log,
    记本地日志 = () => {},
    保存状态 = null,
    依赖 = {}
  } = 环境;
  const 现在 = 依赖.现在 || (() => Date.now());
  const 起写手_ = 依赖.起写手 || 起写手;
  const 起监听窗_ = 依赖.起监听窗 || 起监听窗;
  const 复核_ = 依赖.复核监听窗 || 复核监听窗;
  const 等心跳_ = 依赖.等心跳 || 等心跳出现;
  const 动作列表 = Array.isArray(判定.toHeal) ? [...判定.toHeal] : [];

  for (const 动作 of 动作列表) {
    const 项 = 判定.状态.windows[动作.键] || (判定.状态.windows[动作.键] = {});
    if (dryRun) {
      log(`[dry-run] 本应自愈：${动作.动作}——${动作.名}（${动作.原因}）`);
      continue;
    }
    if (动作.动作 === "补写手") {
      const 锁文件 = 心跳.单例锁文件(记录文件, (动作.认窗 || [])[0]);
      if (心跳.单例锁活跃(锁文件)) {
        log(`补写手跳过：已有同窗写手在跑（${动作.名}）`);
        记本地日志(`自愈：${动作.名} 心跳停，但单实例锁显示写手在跑，跳过补写手`);
        项.状态 = "写手在跑，跳过补写手";
        continue;
      }
      const r = 起写手_({ 认窗: 动作.认窗 || [], 名: 动作.名, 类型: 动作.类型, 状态文件: 记录文件, 日志文件: path.join(path.dirname(记录文件), "窗口心跳.log") });
      if (r.ok) {
        log(`补写手：${动作.名}（${r.输出 || "已后台启动"}）`);
        记本地日志(`自愈：${动作.名} 心跳停（${动作.原因}）→ 已补写手 → 等 ${Math.round((cfg.healWaitSec || 300) / 60)} 分钟看心跳`);
      } else {
        log(`补写手失败：${动作.名}——${r.错误}`);
        记本地日志(`自愈失败：${动作.名} 补写手没起来——${r.错误}`);
        项.自愈 = null;
        造告警(判定, 动作, { 原因: `补写手失败（${r.错误}）`, 证据: 动作.证据, 自愈: "补写手（未起来）", cfg });
      }
    } else if (动作.动作 === "重开") {
      // 双确认之二（之一是一个巡检周期复判）：再扫一次，唯一命中就算进程在 → 取消重开
      const 复核 = 复核_({ 匹配: 动作.认窗 || cfg.listenerMatch || [] });
      if (复核.在 === true) {
        log(`重开取消：${动作.名} 复核发现进程在（pid ${复核.进程.pid}），防双开`);
        记本地日志(`自愈：${动作.名} 疑似死亡 → 重开前复核发现进程还在（pid ${复核.进程.pid}），取消重开`);
        项.复判 = null;
        项.状态 = "重开取消：复核发现进程在";
        continue;
      }
      if (复核.在 === null) {
        log(`重开取消：${动作.名} 进程扫描不可用（${复核.原因}）`);
        记本地日志(`自愈：${动作.名} 疑似死亡 → 进程扫描不可用（${复核.原因}），本轮不重开`);
        项.状态 = "重开取消：进程扫描不可用";
        continue;
      }
      const 起时刻 = 现在();
      const 起 = 起监听窗_();
      清重开记录(项, { 现在 });
      项.重开记录 = [...项.重开记录, new Date(起时刻).toISOString()];
      if (保存状态) 保存状态(); // 重开记录先落盘：节流/反复重启计数不因中途崩溃而丢
      if (!起.ok) {
        log(`重开失败：${动作.名}——${起.错误}`);
        记本地日志(`自愈失败：${动作.名} 重开没起来——${起.错误}`);
        项.自愈 = null;
        项.状态 = "重开失败：启动失败";
        造告警(判定, 动作, { 原因: `重开失败：${起.错误}`, 证据: `已尝试派生 open-pi-window.cmd；${起.错误}`, 自愈: "重开监听窗（未起来）", cfg });
        continue;
      }
      log(`重开监听窗：${动作.名} → ${起.方式}（pid ${起.pid}）`);
      记本地日志(`自愈：${动作.名} 死亡（${动作.原因}）→ 已重开（${起.方式}，pid ${起.pid}）→ 等 ${cfg.reopenConfirmSec || 90}s 看心跳`);
      const 等 = await 等心跳_({ 记录文件, 起点Ms: 起时刻, 超时秒: cfg.reopenConfirmSec || 90, 轮询秒: 10 });
      if (等.ok) {
        项.自愈 = null;
        项.复判 = null;
        项.状态 = "自愈成功：已重开";
        log(`自愈成功：${动作.名} 已重开并恢复心跳（pid ${等.pid}，最后心跳 ${等.最后心跳}）`);
        记本地日志(`自愈成功：${动作.名} 已重开并恢复心跳（pid ${等.pid}，最后心跳 ${等.最后心跳}）`);
        const 次数 = 清重开记录(项, { 现在 }).filter((t) => 现在() - (解析毫秒(t) || 0) < (cfg.flappingWindowSec || 3600) * 1000).length;
        if (次数 >= (cfg.flappingCount || 3)) {
          造告警(判定, 动作, {
            原因: `反复重启（1 小时内自愈重开 ${次数} 次）`,
            证据: `最近重开：${项.重开记录.slice(-3).join("，")}`,
            自愈: `1 小时内已自愈重开 ${次数} 次（节流不吞事件）`,
            cfg
          });
          记本地日志(`自愈告警：${动作.名} 1 小时内重开 ${次数} 次，按「反复重启」报警`);
        }
      } else {
        项.自愈 = null;
        项.状态 = "重开失败：等待心跳超时";
        log(`重开失败：${动作.名} 等了 ${cfg.reopenConfirmSec || 90}s 没看到心跳`);
        记本地日志(`自愈失败：${动作.名} 重开后 ${cfg.reopenConfirmSec || 90}s 内未见心跳（最后心跳 ${等.最后心跳 || "无"}）`);
        造告警(判定, 动作, { 原因: `重开失败（等 ${cfg.reopenConfirmSec || 90} 秒未见心跳）`, 证据: `已派生 open-pi-window.cmd（pid ${起.pid}）；最后心跳 ${等.最后心跳 || "无"}`, 自愈: "重开监听窗（未收到心跳）", cfg });
      }
    }
  }
  return 判定;
}

module.exports = {
  起写手,
  起监听窗,
  复核监听窗,
  等心跳出现,
  执行自愈,
  清重开记录,
  默认执行,
  写手脚本,
  开窗脚本
};
