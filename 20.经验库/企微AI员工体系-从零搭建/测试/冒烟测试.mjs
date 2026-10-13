#!/usr/bin/env node
// 冒烟测试：跟读JSONL.mjs ＋ 读JSONL游标.mjs ＋ 守护/直连骨架离线件
//
// 覆盖：
//   跟读——初始内容不重播 / 追新行 / 半个行留住 / 补齐后打出 / 文件截断自动重跟 / --字段 抽取
//   游标——新行读取 / 半个行不算读掉 / 不重复读 / --mark 才推进 / --all 从头 / --tail 只显示尾部 / 截断重置
//   骨架——直连发送：名单归纳 / dry-run 不发 / --send 真发（假守护口）/ 拆条 ≤100 / 找不着目标报错
//
// 跑法：node 测试/冒烟测试.mjs   → 全部 ✓ 即通过；有任何 ✗ 退出码非 0。

import { spawn, spawnSync as 子进程同步 } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { 读新行, 读游标 } from "../工具/读JSONL游标.mjs";
import { 读新字节, 格式化 } from "../工具/跟读JSONL.mjs";

const 本目录 = path.dirname(fileURLToPath(import.meta.url));
const 工具 = path.join(本目录, "..", "工具");
const 临时 = fs.mkdtempSync(path.join(os.tmpdir(), "jsonl-冒烟-"));
let 过 = 0;
let 总 = 0;
function 查(名, 条件, 详情 = "") {
  总 += 1;
  if (条件) {
    过 += 1;
    console.log(`  ✓ ${名}`);
  } else {
    console.log(`  ✗ ${名}${详情 ? "　—— " + 详情 : ""}`);
  }
}
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));

/** 同步跑一个工具脚本（cwd 在临时目录）。 */
function 跑(脚本, 参数) {
  return 子进程同步(process.execPath, [path.join(工具, 脚本), ...参数], { encoding: "utf8", cwd: 临时 });
}

// ============ 一、单元：读新行 / 读新字节 ============
console.log("一、单元：半个行不撕、恰好吃完整行");
{
  const f = path.join(临时, "单元.jsonl");
  fs.writeFileSync(f, "1\n2\n3", "utf8"); // 3 没有换行 = 半个行
  const r = 读新行(f, 0);
  查("读新行：只读完整行", JSON.stringify(r.行) === JSON.stringify(["1", "2"]), JSON.stringify(r.行));
  查("读新行：偏移停在半个行前", r.到偏移 === 4, String(r.到偏移));
  fs.appendFileSync(f, "\n", "utf8");
  const r2 = 读新行(f, r.到偏移);
  查("读新行：补齐换行后能读到", JSON.stringify(r2.行) === JSON.stringify(["3"]), JSON.stringify(r2.行));
  const t = path.join(临时, "单元2.jsonl");
  fs.writeFileSync(t, "{}a\n{}b\n{}半", "utf8");
  const r3 = 读新字节(t, 0);
  查("读新字节：与读新行同款语义", r3.行.length === 2 && r3.偏移 === 8, JSON.stringify(r3));
  const r4 = 读新行(f, 9999);
  查("读新行：游标比文件长→从头", r4.行.length >= 3, JSON.stringify(r4.行));
  const fmt = 格式化('{"at":"10:00","text":"你好","id":"x"}', ["at", "text"]);
  查("格式化：只抽指定字段", fmt === "【新行】 at=10:00 text=你好", fmt);
}

// ============ 二、游标 CLI ============
console.log("二、游标 CLI：--mark 才推进、不重复读");
{
  const f = path.join(临时, "游标.jsonl");
  const 游标 = path.join(临时, "游标.位置.json");
  fs.writeFileSync(f, '{"n":1}\n{"n":2}\n', "utf8");
  let r = 跑("读JSONL游标.mjs", [f, "--游标", 游标]);
  查("游标：默认读到新行", r.stdout.includes('"n":1') && r.stdout.includes('"n":2'), r.stdout.trim());
  查("游标：不加 --mark 不推进", 读游标(游标) === 0, String(读游标(游标)));
  r = 跑("读JSONL游标.mjs", [f, "--游标", 游标, "--mark"]);
  查("游标：--mark 推进到行尾", 读游标(游标) === Buffer.byteLength('{"n":1}\n{"n":2}\n', "utf8"), String(读游标(游标)));
  r = 跑("读JSONL游标.mjs", [f, "--游标", 游标, "--mark"]);
  查("游标：没新行保持安静", r.stdout === "", JSON.stringify(r.stdout));
  fs.appendFileSync(f, '{"n":3}\n', "utf8");
  r = 跑("读JSONL游标.mjs", [f, "--游标", 游标, "--mark", "--字段", "n"]);
  查("游标：只读新行且能抽字段", r.stdout.trim() === "n=3", r.stdout.trim());
  r = 跑("读JSONL游标.mjs", [f, "--游标", 游标, "--all", "--字段", "n"]);
  查("游标：--all 从头看全部", r.stdout.split("\n").filter(Boolean).length === 3, r.stdout.trim());
  fs.appendFileSync(f, '{"n":4}\n{"n":5}\n', "utf8");
  r = 跑("读JSONL游标.mjs", [f, "--游标", 游标, "--mark", "--tail", "1", "--字段", "n"]);
  查("游标：--tail 只显示尾部", r.stdout.trim() === "n=5", r.stdout.trim());
  r = 跑("读JSONL游标.mjs", [f, "--游标", 游标, "--mark"]);
  查("游标：--tail 后标记已到末尾", r.stdout === "", JSON.stringify(r.stdout));
  fs.writeFileSync(f, '{"n":"X"}\n', "utf8"); // 截断重写
  r = 跑("读JSONL游标.mjs", [f, "--游标", 游标, "--mark", "--字段", "n"]);
  查("游标：文件截断自动重置重读", r.stdout.trim() === "n=X", r.stdout.trim());
}

// ============ 三、跟读 子进程 ============
console.log("三、跟读（真子进程）：安静看家、有新行才吭声");
await new Promise((完成) => {
  const f = path.join(临时, "跟读.jsonl");
  fs.writeFileSync(f, '{"n":"老1"}\n{"n":"老2"}\n', "utf8");
  const 子 = spawn(process.execPath, [path.join(工具, "跟读JSONL.mjs"), f, "--间隔", "200", "--字段", "n", "--前缀", "【新消息】"], { stdio: ["ignore", "pipe", "pipe"] });
  let 输出 = "";
  子.stdout.on("data", (c) => (输出 += c.toString("utf8")));
  子.stderr.on("data", (c) => (输出 += c.toString("utf8")));
  const 校验 = [];
  const 跑校验 = async () => {
    await 等(700);
    查("跟读：初始已有内容不重播", !输出.includes("老1") && !输出.includes("老2"), JSON.stringify(输出));
    fs.appendFileSync(f, '{"n":"新3"}\n', "utf8");
    await 等(700);
    查("跟读：追加新行立刻输出", 输出.includes("【新消息】 n=新3"), JSON.stringify(输出));
    const 前 = 输出;
    fs.appendFileSync(f, '{"n":"半4"', "utf8");
    await 等(700);
    查("跟读：半个行不输出", 输出 === 前, JSON.stringify(输出));
    fs.appendFileSync(f, '}\n', "utf8");
    await 等(700);
    查("跟读：补齐换行后输出", 输出.includes("n=半4"), JSON.stringify(输出));
    fs.writeFileSync(f, '{"n":"重5"}\n', "utf8"); // 截断重写（变短）
    await 等(700);
    查("跟读：文件截断自动重跟", 输出.includes("n=重5"), JSON.stringify(输出));
    子.kill();
    void 校验;
    完成();
  };
  跑校验();
});

// ============ 四、直连骨架：真实发到假守护发送口 ============
console.log("四、直连骨架（真跑）：dry-run 不发、--send 拆条发");
{
  const 盒 = path.join(临时, "骨架收件箱");
  fs.mkdirSync(盒, { recursive: true });
  fs.writeFileSync(
    path.join(盒, "inbox.jsonl"),
    [
      JSON.stringify({ at: "2026-10-13 11:00:00", chattype: "single", fromUserId: "u-1", fromName: "张三", text: "你好" }),
      JSON.stringify({ at: "2026-10-13 11:05:00", chattype: "group", chatid: "g-1", fromName: "工作群", text: "@机器人 在吗" }),
    ].join("\n") + "\n",
    "utf8",
  );
  const 收下 = [];
  const 令 = "test-token-123";
  const 假守护 = http.createServer((req, res) => {
    const 答 = (码, 体) => { res.writeHead(码, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(体)); };
    if (req.headers["x-token"] !== 令) return 答(403, { 错误: "令牌不对" });
    let 体 = "";
    req.on("data", (c) => (体 += c));
    req.on("end", () => {
      if (decodeURIComponent(req.url) !== "/发送") return 答(404, { 错误: "没这个口" });
      const j = JSON.parse(体 || "{}");
      收下.push(j);
      答(200, { 成功: 1 });
    });
  });
  await new Promise((r) => 假守护.listen(0, "127.0.0.1", r));
  fs.writeFileSync(path.join(盒, "守护.port"), String(假守护.address().port), "utf8");
  fs.writeFileSync(path.join(盒, "守护.token"), 令, "utf8");

  const 骨架 = path.join(本目录, "..", "骨架", "直连骨架.mjs");
  const 跑异 = (参数) =>
    new Promise((完成) => {
      const 子 = spawn(process.execPath, [骨架, "--收件箱", 盒, ...参数], { cwd: 临时 });
      let 出 = "", 误 = "";
      子.stdout.on("data", (c) => (出 += c));
      子.stderr.on("data", (c) => (误 += c));
      子.on("close", (码) => 完成({ 码, 出, 误 }));
    });

  let r = await 跑异(["--list"]);
  查("直连：名单归纳出人和群", r.出.includes("单聊「张三」") && r.出.includes("群聊「工作群」"), r.出.trim());
  查("直连：名单不打印内部 ID", !r.出.includes("u-1") && !r.出.includes("g-1"), r.出.trim());

  r = await 跑异(["--回复", "收到，我看下"]);
  查("直连：dry-run 预览回给最近的人", r.出.includes("群聊「工作群」") && r.出.includes("dry-run"), r.出.trim());
  查("直连：dry-run 真的没发", 收下.length === 0, JSON.stringify(收下));

  r = await 跑异(["--回复", "收到，我看下", "--send"]);
  查("直连：--send 真发一条", 收下.length === 1 && 收下[0].目标 === "g-1" && 收下[0].正文 === "收到，我看下", JSON.stringify(收下));

  const 长文 = "甲".repeat(250);
  await 跑异(["--to", "1", "--文本", 长文, "--send"]);
  const 新收 = 收下.slice(1);
  const 拼 = 新收.map((x) => x.正文).join("");
  查("直连：长文自动拆条（250 字→3 条）", 新收.length === 3, JSON.stringify(新收.map((x) => x.正文.length)));
  查("直连：每条 ≤100 字且拼回原文", 新收.every((x) => x.正文.length <= 100) && 拼 === 长文, 拼.length + "字");

  r = await 跑异(["--to", "9", "--文本", "x", "--send"]);
  查("直连：找不着目标 → 报错退出", r.码 !== 0 && (r.误 + r.出).includes("找不到目标"), JSON.stringify({ 码: r.码, 误: r.误.trim() }));

  假守护.close();
}

// ============ 汇总 ============
try { fs.rmSync(临时, { recursive: true, force: true }); } catch { /* ignore */ }
console.log(`\n${过}/${总} 项通过${过 === 总 ? " ✓ 全部通过" : " ✗ 有失败"}`);
process.exit(过 === 总 ? 0 : 1);
