#!/usr/bin/env node
/**
 * 子代理（后台跑、单独叫醒）
 *
 * 为什么要有这个：pi 自带的 subagent 工具是同步的——它跑的时候我这扇窗被占住，
 * 黎路遥发企微我就回不了。2026-11-26 11:2x 他要的是「子代理自己跑，我照常回消息」。
 * 所以这里改成：起一个独立的 pi 进程（--print 无窗口、无 TUI）在后台跑，
 * 跑完由 `--等` 挂到 Monitor 上叫醒我，我这扇窗全程不被占。
 *
 * 用法：
 *   起：node 工具/子代理.cjs --起 --任务 "…" [--任务文件 path] [--目录 dir] [--名 短名] [--工具 read,write,bash] [--模型 provider/id]
 *   列：node 工具/子代理.cjs --列
 *   等：node 工具/子代理.cjs --等 <id>        # 阻塞到进程结束，打印末尾输出（给 Monitor 用）
 *   收：node 工具/子代理.cjs --收 <id>        # 看已落地的输出末尾
 *
 * 边界：子代理不继承我的会话上下文；要它做什么必须在 `--任务` 里写清（含目录、规矩、要交什么）。
 */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const 根 = path.resolve(__dirname, "..");
const 状态目录 = path.join(__dirname, ".state", "子代理");
fs.mkdirSync(状态目录, { recursive: true });

function 参数表(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { o._.push(a); continue; }
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    o[k] = v;
  }
  return o;
}

function 找pi() {
  // Windows 上 pi.cmd 需要 shell 才能执行，而 shell:true 会把中文长参数拼坏（2026-11-26 实测：日志空、无输出）。
  // 直接跑 node + 包里的 cli 入口最稳，不经 shell。
  const 包 = path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js');
  if (fs.existsSync(包)) return { 命令: process.execPath, 参数头: [包] };
  return { 命令: 'pi', 参数头: [] };
}

function 活着(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function 读档案(id) {
  const p = path.join(状态目录, `${id}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function 列() {
  const 全部 = fs.readdirSync(状态目录).filter((f) => f.endsWith(".json"));
  const 行 = [];
  for (const f of 全部) {
    const m = JSON.parse(fs.readFileSync(path.join(状态目录, f), "utf8"));
    const 在跑 = 活着(m.pid);
    行.push({ ...m, 在跑 });
  }
  行.sort((a, b) => (a.起于 < b.起于 ? 1 : -1));
  if (!行.length) { console.log("没有子代理记录"); return; }
  for (const m of 行) {
    console.log(`${m.在跑 ? "▶ 在跑" : "· 已停"}　${m.id}　pid=${m.pid}　${m.名 || ""}　${m.起于}　${m.任务.slice(0, 40)}`);
  }
}

function 尾巴(文件, 行数 = 60) {
  if (!fs.existsSync(文件)) return "（还没有输出）";
  const s = fs.readFileSync(文件, "utf8").trimEnd().split(/\r?\n/);
  return s.slice(-行数).join("\n");
}

function 起(a) {
  let 任务 = a.任务 || "";
  if (a.任务文件) 任务 = fs.readFileSync(path.resolve(a.任务文件), "utf8");
  if (!任务.trim()) throw new Error("缺 --任务 或 --任务文件");

  const 工作目录 = path.resolve(a.目录 || 根);
  const id = `${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
  const 日志 = path.join(状态目录, `${id}.log`);
  const 输出 = fs.openSync(日志, "a");

  const 启动 = 找pi();
  const 参数 = [...启动.参数头, "--print", 任务, "--no-session"];
  if (a.工具) 参数.push("--tools", String(a.工具));
  if (a.模型) 参数.push("--model", String(a.模型));
  if (a.附加) 参数.push("--append-system-prompt", String(a.附加));

  const 子 = spawn(启动.命令, 参数, {
    cwd: 工作目录,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', 输出, 输出],
  });
  子.unref();

  const 档案 = {
    id, pid: 子.pid, 名: a.名 || "", 任务, 目录: 工作目录,
    起于: new Date().toLocaleString("sv-SE"), 日志, 参数: 参数.slice(0, 3),
  };
  fs.writeFileSync(path.join(状态目录, `${id}.json`), JSON.stringify(档案, null, 1), "utf8");
  console.log(`已起子代理 ${id}（pid=${子.pid}）`);
  console.log(`  目录：${工作目录}`);
  console.log(`  日志：${日志}`);
  console.log(`  叫醒：node 工具/子代理.cjs --等 ${id}`);
  return id;
}

async function 等(id) {
  const m = 读档案(id);
  if (!m) throw new Error(`没有这个子代理：${id}`);
  const 起时 = Date.now();
  while (活着(m.pid)) {
    await new Promise((r) => setTimeout(r, 3000));
    if (Date.now() - 起时 > 1000 * 60 * 90) { console.log("等了 90 分钟还没结束，先放弃等待（子代理可能还在跑）"); break; }
  }
  console.log(`子代理 ${id} 结束。任务：${m.任务.slice(0, 60)}`);
  console.log("—— 输出末尾 ——");
  console.log(尾巴(m.日志, 80));
}

function 收(id) {
  const m = 读档案(id);
  if (!m) throw new Error(`没有这个子代理：${id}`);
  console.log(`${活着(m.pid) ? "▶ 还在跑" : "· 已停"}　${m.id}　${m.任务.slice(0, 60)}`);
  console.log("—— 输出末尾 ——");
  console.log(尾巴(m.日志, 100));
}

(async () => {
  const a = 参数表(process.argv.slice(2));
  try {
    if (a.起) 起(a);
    else if (a.列) 列();
    else if (a.等) await 等(String(a.等));
    else if (a.收) 收(String(a.收));
    else console.log("用法：--起 --任务 … ｜--列 ｜--等 <id> ｜--收 <id>");
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
})();
