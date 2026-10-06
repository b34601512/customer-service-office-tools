#!/usr/bin/env node
"use strict";

/**
 * 同步「木婉清档案 + 各项目 project-config」到私有仓库 c34601512-cpu/muwanqing-archive
 * （任务书：0.木婉清档案/任务/2026-10-06-木婉清私有备份仓库.md）。
 *
 * 为什么用 staging：主仓库 b34601512/customer-service-office-tools 是 PUBLIC，只备份 md/源码；
 * 这里把私有材料复制到 %USERPROFILE%\.cache\muwanqing-archive 的独立 git 仓库里推送，
 * 既不污染主仓库、也不会在主仓库里误 git add。
 *
 * 用法（在仓库根目录跑）：
 *   node "0.木婉清档案/备份/同步到私有仓库.cjs"              # 真实同步（幂等：无变化不提交）
 *   node "0.木婉清档案/备份/同步到私有仓库.cjs" --dry-run     # 预览（不提交、不推送）
 *   node "0.木婉清档案/备份/同步到私有仓库.cjs" --install-task # 装 Windows 计划任务（每天 12:30）
 *   node "0.木婉清档案/备份/同步到私有仓库.cjs" --remove-task  # 卸载计划任务
 *
 * 备份范围（照任务书，不扩大）：
 *   - 0.木婉清档案 全部文件（任务证据 png/jpg/xlsx/txt/json、assets、任务、回执、经验…）；
 *   - 各项目的 project-config 目录（链接/ID 类配置，含嵌套项目如 2.发票自动化/7.自动登记发票）。
 * 排除（安全）：
 *   - 文件名含 credential/secret/token/password/.local.json 的在线凭据文件，一律不进 git；
 *   - 内容含真凭据的文件（即使文件名没写这些词）——实测 wecom-robot.json / kdocs-airscript.json /
 *     platform-config.json / stores.json 里藏着真 webhook/apiToken/门店密码，同样不进 git；
 *   - node_modules/.git/runtime/.pi/.venv/__pycache__/dist/build、*.log、临时文件。
 *
 * 认证：git 用的全局 credential helper 是 `gh auth git-credential`；
 * 本脚本给所有 git 子进程注入 GH_CONFIG_DIR=新号配置目录（~/.config/gh-bots），
 * 所以 push 用 c34601512-cpu 的身份，与默认账号无关；无需额外 `gh auth setup-git`。
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const STAGING = path.join(os.homedir(), ".cache", "muwanqing-archive");
const GH_CONFIG_DIR = path.join(os.homedir(), ".config", "gh-bots");
const REPO_SLUG = "c34601512-cpu/muwanqing-archive";
const REPO_URL = `https://github.com/${REPO_SLUG}`;
const REMOTE = `${REPO_URL}.git`;
const BRANCH = "main";
const ARCHIVE_DIR = path.join(ROOT, "0.木婉清档案");
const LOCK = path.join(os.homedir(), ".cache", "muwanqing-archive-sync.lock");

const TASK_NAME = "muwanqing-archive-sync";
const CONF_DIR = path.join(os.homedir(), ".config", "muwanqing-archive");
const WRAPPER = path.join(CONF_DIR, "sync.ps1");
const NODE_EXE = process.execPath;

const DRY_RUN = process.argv.includes("--dry-run");

const SKIP_DIRS = new Set([
  "node_modules", ".git", "runtime", ".pi", ".venv", "venv", "__pycache__", "dist", "build", ".cache"
]);
const EXCLUDE_NAME_RES = [
  /credential/i, /secret/i, /token/i, /password/i, /\.local\.json$/i,
  /\.log$/i, /\.tmp$/i, /\.temp$/i, /^\.DS_Store$/, /^Thumbs\.db$/, /^~\$/
];

// 内容级凭据规则：文件名没写 credential 也可能藏真凭据（实测：企微机器人 webhook、
// AirScript 同步 webhook、apiToken、门店密码）。只认「看起来是真的」的值，占位符不算。
const SECRET_CONTENT_RES = [
  ["企微机器人webhook", /qyapi\.weixin\.qq\.com\/cgi-bin\/webhook[^\s"']*key=[A-Za-z0-9-]{16,}/i],
  ["AirScript同步webhook", /kdocs\.cn\/api\/v3\/ide\/file\/[A-Za-z0-9]{8,}\/script\/[A-Za-z0-9]{8,}\/sync_task/i],
  ["URL里的key/token", /https?:\/\/[^\s"']*[?&](key|token|access_token|secret)=[A-Za-z0-9_.-]{12,}/i],
  ["token前缀", /\b(gh[opsu]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})/]
];
const SECRET_FIELD_RE = /"(apiToken|appSecret|secret|password|accessToken|refreshToken|webhookUrl|webhook_url)"\s*:\s*"([^"]{6,})"/gi;
const PLACEHOLDER_RE = /填写|在此|占位|placeholder|example|你的|<[^>]*>/i;
const TEXT_EXT = new Set([".json", ".js", ".cjs", ".mjs", ".md", ".txt", ".jsonl", ".yml", ".yaml", ".csv"]);

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

function isExcluded(rel) {
  const parts = rel.split(/[\\/]/);
  if (parts.some((p) => SKIP_DIRS.has(p))) return true;
  const base = parts[parts.length - 1];
  return EXCLUDE_NAME_RES.some((re) => re.test(base));
}

// 返回命中的凭据类型名（没命中返回 null）；只扫文本类文件
function contentSecret(absPath) {
  if (!TEXT_EXT.has(path.extname(absPath).toLowerCase())) return null;
  let text;
  try {
    text = fs.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
  for (const [name, re] of SECRET_CONTENT_RES) if (re.test(text)) return name;
  SECRET_FIELD_RE.lastIndex = 0;
  let m;
  while ((m = SECRET_FIELD_RE.exec(text))) {
    if (!PLACEHOLDER_RE.test(m[2])) return `字段 ${m[1]}`;
  }
  return null;
}

function git(args, opts = {}) {
  const res = spawnSync("git", args, {
    cwd: STAGING,
    encoding: "utf8",
    env: { ...process.env, GH_CONFIG_DIR, GIT_TERMINAL_PROMPT: "0" },
    windowsHide: true,
    timeout: 10 * 60 * 1000
  });
  if (res.error) throw new Error(`git ${args.join(" ")} 无法执行：${res.error.message}`);
  if (!opts.allowFail && res.status !== 0) {
    throw new Error(`git ${args.join(" ")} 失败（exit ${res.status}）：\n${(res.stderr || res.stdout || "").trim()}`);
  }
  return res;
}

function sameContent(a, b) {
  const sa = fs.statSync(a);
  const sb = fs.statSync(b);
  if (sa.size !== sb.size) return false;
  return Buffer.compare(fs.readFileSync(a), fs.readFileSync(b)) === 0;
}

function formatStamp(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function readmeText() {
  return [
    "# muwanqing-archive · 木婉清档案私有备份",
    "",
    "> 本仓库 **private**，只放公开仓库不方便放的档案材料：任务证据（截图/表格/日志文字）、",
    "> 各项目 `project-config/` 链接与 ID 配置。公开仓库 `b34601512/customer-service-office-tools`",
    "> 仍只备份 `*.md` 与源码。",
    ">",
    "> 由 `0.木婉清档案/备份/同步到私有仓库.cjs` 自动同步（Windows 计划任务 `muwanqing-archive-sync`，每天 12:30）。",
    "> **不要手改这里的内容**：改动会在下次同步被覆盖/还原。最后同步时间见最近一次提交。",
    "",
    "## 包含",
    "",
    "- `0.木婉清档案/**`：任务书、任务回执、经验、文字档案、`任务证据/`（png/jpg/xlsx/txt/json）、`assets/` 等；",
    "- 各项目 `*/project-config/**`：链接 / ID 类配置。",
    "",
    "## 明确不备份（安全）",
    "",
    "- 文件名含 `credential` / `secret` / `token` / `password` / `.local.json` 的在线凭据文件",
    "  （如 `27.企业微信机器人/project-config/aibot-credentials.local.json`）；",
    "- **内容含真凭据**的文件（即使文件名没写这些词）：实测有企微机器人 webhook（`wecom-robot.json`/`wecom-notify.json`）、",
    "  AirScript 同步 webhook（`kdocs-airscript.json`）、apiToken（`platform-config.json`）、门店密码（`stores.json`）；",
    "- `node_modules/`、`.git/`、`runtime/`、`.pi/`、`*.log`、临时文件。",
    "",
    "以上凭据**不落任何 git**（能重新生成/重新取）；重建方法见 `0.木婉清档案/敏感与配置清单-不备份与重建.md`。",
    "",
    "## 手动同步",
    "",
    "```bash",
    'node "0.木婉清档案/备份/同步到私有仓库.cjs"           # 同步（无变化则不提交）',
    'node "0.木婉清档案/备份/同步到私有仓库.cjs" --dry-run  # 预览',
    "```",
    ""
  ].join("\n");
}

// ---------------------------------------------------------------------------
// 同步
// ---------------------------------------------------------------------------

function collectFiles(absDir, out, stats) {
  for (const ent of fs.readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, ent.name);
    const rel = path.relative(ROOT, abs);
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      collectFiles(abs, out, stats);
    } else if (ent.isFile()) {
      if (isExcluded(rel)) {
        stats.excluded++;
      } else {
        const hit = contentSecret(abs);
        if (hit) {
          stats.contentExcluded++;
          stats.contentHits.push(`${rel}（${hit}）`);
        } else {
          out.push(rel);
        }
      }
    }
  }
}

function findConfigDirs(absDir, depth, out) {
  if (depth > 6) return;
  let ents;
  try {
    ents = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of ents) {
    if (!ent.isDirectory() || SKIP_DIRS.has(ent.name)) continue;
    const abs = path.join(absDir, ent.name);
    if (ent.name === "project-config") {
      out.push(abs);
      continue;
    }
    findConfigDirs(abs, depth + 1, out);
  }
}

function walkStaged(absDir, cb) {
  for (const ent of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (ent.name === ".git") continue;
    const abs = path.join(absDir, ent.name);
    if (ent.isDirectory()) walkStaged(abs, cb);
    else if (ent.isFile()) cb(path.relative(STAGING, abs), abs);
  }
}

function ensureStaging() {
  fs.mkdirSync(STAGING, { recursive: true });
  if (!fs.existsSync(path.join(STAGING, ".git"))) {
    console.log(`[init] 首次建立 staging 仓库：${STAGING}`);
    git(["init", "-b", BRANCH]);
  }
  git(["config", "core.quotepath", "false"]);
  git(["config", "core.autocrlf", "false"]);
  git(["config", "user.name", "木婉清"]);
  git(["config", "user.email", "c34601512-cpu@users.noreply.github.com"]);
  const cur = git(["remote", "get-url", "origin"], { allowFail: true });
  if (cur.status !== 0) git(["remote", "add", "origin", REMOTE]);
  else if (cur.stdout.trim() !== REMOTE) git(["remote", "set-url", "origin", REMOTE]);
}

function acquireLock() {
  try {
    fs.mkdirSync(path.dirname(LOCK), { recursive: true });
    if (fs.existsSync(LOCK)) {
      const ageMin = (Date.now() - fs.statSync(LOCK).mtimeMs) / 60000;
      if (ageMin < 30) {
        console.error(`已有同步在跑（锁 ${LOCK}，${ageMin.toFixed(1)} 分钟前）→ 退出，不重复跑。`);
        process.exit(3);
      }
      console.error(`发现陈旧锁（${ageMin.toFixed(1)} 分钟）→ 覆盖后继续。`);
    }
    fs.writeFileSync(LOCK, `${process.pid} ${new Date().toISOString()}\n`);
  } catch {
    /* 锁写不了就不锁，别挡住备份 */
  }
  process.on("exit", () => {
    try {
      fs.unlinkSync(LOCK);
    } catch {}
  });
}

function main() {
  if (!fs.existsSync(ARCHIVE_DIR)) throw new Error(`找不到档案目录：${ARCHIVE_DIR}`);
  acquireLock();
  ensureStaging();

  console.log(`=== 木婉清档案 → ${REPO_SLUG} ===`);
  console.log(`staging：${STAGING}${DRY_RUN ? "（dry-run）" : ""}`);

  // ① 收集源文件
  const stats = { excluded: 0, contentExcluded: 0, contentHits: [] };
  const archiveFiles = [];
  collectFiles(ARCHIVE_DIR, archiveFiles, stats);
  const cfgDirs = [];
  findConfigDirs(ROOT, 0, cfgDirs);
  const cfgFiles = [];
  for (const d of cfgDirs) collectFiles(d, cfgFiles, stats);
  const desired = new Set([...archiveFiles, ...cfgFiles]);

  // ② 复制到 staging（内容没变就不动，保证幂等）
  let copied = 0;
  for (const rel of desired) {
    const src = path.join(ROOT, rel);
    const dst = path.join(STAGING, rel);
    if (fs.existsSync(dst) && sameContent(src, dst)) continue;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    copied++;
  }

  // ③ README（仓库说明，自动覆盖）
  const readmePath = path.join(STAGING, "README.md");
  const readme = readmeText();
  let readmeChanged = false;
  if (!fs.existsSync(readmePath) || fs.readFileSync(readmePath, "utf8") !== readme) {
    fs.writeFileSync(readmePath, readme, "utf8");
    readmeChanged = true;
  }

  // ④ 删除 staging 里源已不存在的文件
  let removed = 0;
  walkStaged(STAGING, (rel, abs) => {
    if (rel !== "README.md" && !desired.has(rel)) {
      fs.unlinkSync(abs);
      removed++;
    }
  });

  // ⑤ 暂存 + 安全断言（文件名 + 内容双重检查）
  git(["add", "-A", "--", "."]);
  const indexList = git(["ls-files", "--cached"]).stdout.split(/\r?\n/).filter(Boolean);
  const leaked = [];
  for (const rel of indexList) {
    if (isExcluded(rel)) leaked.push(`${rel}（按文件名）`);
    else {
      const hit = contentSecret(path.join(STAGING, rel));
      if (hit) leaked.push(`${rel}（${hit}）`);
    }
  }
  if (leaked.length) {
    console.error("拒绝提交：暂存区出现被排除的敏感文件，先排查再跑：");
    for (const f of leaked) console.error("  - " + f);
    process.exit(2);
  }

  const statusOut = git(["status", "--porcelain"]).stdout;
  const statusLines = statusOut.split(/\r?\n/).filter(Boolean);
  const count = { A: 0, M: 0, D: 0, R: 0, other: 0 };
  for (const line of statusLines) {
    const x = line[0];
    if (x === "A" || x === "?") count.A++;
    else if (x === "M") count.M++;
    else if (x === "D") count.D++;
    else if (x === "R" || x === "C") count.R++;
    else count.other++;
  }

  console.log(
    `源文件：${desired.size} 个（档案 ${archiveFiles.length} + project-config ${cfgFiles.length}，${cfgDirs.length} 个项目配置目录）；` +
      `按规则跳过 ${stats.excluded} 个（文件名敏感/运行态），内容级剔除 ${stats.contentExcluded} 个（真凭据）`
  );
  if (stats.contentHits.length) {
    console.log("内容级剔除清单（含真 webhook/apiToken/密码，不进 git）：");
    for (const h of stats.contentHits) console.log("  - " + h);
  }
  console.log(
    `staging：复制/更新 ${copied} 个文件${readmeChanged ? " + README" : ""}，删除 ${removed} 个；` +
      `暂存变化：新增 ${count.A} / 修改 ${count.M} / 删除 ${count.D}${count.R ? ` / 重命名 ${count.R}` : ""}`
  );

  // ⑥ 提交 / 推送
  if (DRY_RUN) {
    console.log("dry-run：不提交、不推送（staging 文件已刷新，下次真实跑继续）。");
    console.log(`仓库：${REPO_URL}（private）`);
    return;
  }

  const headProbe = git(["rev-parse", "--verify", "--quiet", "HEAD"], { allowFail: true });
  const hasHead = headProbe.status === 0;

  if (statusLines.length === 0) {
    console.log("无变化：不提交。");
  } else {
    const stamp = formatStamp(new Date());
    const msg = hasHead
      ? `同步快照 ${stamp}（新增${count.A} 修改${count.M} 删除${count.D}${count.R ? ` 重命名${count.R}` : ""}）`
      : `首次快照：木婉清档案 + 项目配置 ${stamp}`;
    git(["commit", "-m", msg]);
    console.log(`已提交：${msg}`);
  }

  // 往上推（无变化也推一次：自愈上一次 push 失败；push 失败不自动重试，只报告）
  const push = git(["push", "-u", "origin", BRANCH], { allowFail: true });
  if (push.status === 0) {
    console.log(`push：成功  ${(push.stderr || "").split(/\r?\n/).filter(Boolean).slice(-1)[0] || "Everything up-to-date"}`);
  } else {
    console.error(`push：失败（exit ${push.status}），本地已提交、未丢，下次同步会再推一次；本次到此为止（不自动重试）。`);
    console.error((push.stderr || push.stdout || "").trim());
    process.exitCode = 1;
  }

  const head = git(["rev-parse", "--short", "HEAD"]).stdout.trim();
  console.log(`仓库：${REPO_URL}（private）  当前提交：${head}`);
}

// ---------------------------------------------------------------------------
// Windows 计划任务（每天 12:30；参照 27号 装企微看门狗.cjs 的写法）
// ---------------------------------------------------------------------------

function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function writeUtf8Bom(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "\uFEFF" + text, "utf8"); // PS 5.1 无 BOM 会按 ANSI 读 → 中文路径乱码
}

function runPowerShellFile(file) {
  return spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 120000
  });
}

function runPowerShellCommand(cmd) {
  return spawnSync("powershell.exe", ["-NoProfile", "-Command", cmd], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 120000
  });
}

function installTask() {
  const wrapper = [
    "# Generated by 0.木婉清档案/备份/同步到私有仓库.cjs — thin launcher, do not edit by hand.",
    "$ErrorActionPreference = 'Continue'",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "$OutputEncoding = [System.Text.Encoding]::UTF8",
    `$node = ${psQuote(NODE_EXE)}`,
    `$script = ${psQuote(__filename)}`,
    "$outLog = Join-Path $PSScriptRoot 'sync.out.log'",
    "try {",
    "  if ((Test-Path $outLog) -and ((Get-Item $outLog).Length -gt 1MB)) { Move-Item -Force $outLog ($outLog + '.1') }",
    "} catch {}",
    "& $node $script *>&1 | Out-File -FilePath $outLog -Append -Encoding utf8",
    "exit $LASTEXITCODE",
    ""
  ].join("\r\n");
  writeUtf8Bom(WRAPPER, wrapper);

  const register = [
    "$ErrorActionPreference = 'Stop'",
    `$taskName = ${psQuote(TASK_NAME)}`,
    `$ps = ${psQuote(WRAPPER)}`,
    "$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"' + $ps + '\"')",
    "$trigger = New-ScheduledTaskTrigger -Daily -At 12:30",
    "$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)",
    "Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description '木婉清档案+项目配置 每日 12:30 同步到私有仓库 c34601512-cpu/muwanqing-archive' -Force | Out-Null",
    "Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State | Format-List",
    "Get-ScheduledTaskInfo -TaskName $taskName | Select-Object LastRunTime, LastTaskResult, NextRunTime | Format-List",
    ""
  ].join("\r\n");
  const tmp = path.join(CONF_DIR, "register.ps1");
  writeUtf8Bom(tmp, register);
  try {
    const r = runPowerShellFile(tmp);
    if (r.status !== 0) throw new Error(`注册计划任务失败：${(r.stderr || r.stdout || "").trim()}`);
    console.log((r.stdout || "").trim());
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {}
  }
  console.log(`已安装：任务 ${TASK_NAME}（每天 12:30）→ ${__filename}`);
  console.log(`启动器：${WRAPPER}；日志：${path.join(CONF_DIR, "sync.out.log")}`);
  console.log(`卸载：node "${__filename}" --remove-task`);
}

function removeTask() {
  const r = runPowerShellCommand(
    `Unregister-ScheduledTask -TaskName ${psQuote(TASK_NAME)} -Confirm:$false -ErrorAction SilentlyContinue`
  );
  console.log((r.stdout || r.stderr || "").trim() || `已卸载：任务 ${TASK_NAME}（可能本来就不存在）`);
  try {
    fs.unlinkSync(WRAPPER);
    console.log(`已删除启动器：${WRAPPER}`);
  } catch {}
}

// ---------------------------------------------------------------------------

try {
  if (process.argv.includes("--install-task")) installTask();
  else if (process.argv.includes("--remove-task")) removeTask();
  else main();
} catch (err) {
  console.error((err && err.stack) || err);
  process.exitCode = 1;
}
