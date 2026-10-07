#!/usr/bin/env node
"use strict";

/**
 * 同步「木婉清档案 + 各项目 project-config」到私有仓库 c34601512-cpu/muwanqing-archive
 * —— **加密包模式**（2026-10-06 起，对齐赵敏方案；任务书 0.木婉清档案/任务/2026-10-06-备份改加密包.md）。
 *
 * 流程：收集（打包前先按「文件名 + 内容」剔除在线凭据）→ 明文内容哈希 → tar
 *       → openssl AES-256-CBC（pbkdf2 + salt）加密 → 提交/推送**密文包**。
 * 仓库树里只有：`packages/archive-<日期>-<时刻>-<短哈希>.tar.enc`（只留最近 3 个）+ 明文 `README.md`（恢复说明，不含密码/明文数据）。
 * 幂等：明文内容哈希没变（已有同短哈希的包）就不打新包、不提交；推送失败不自动重试，只报告。
 *
 * 密码：本机非 git 文件 `C:\Users\b3460\.config\muwanqing-archive\备份密码.txt`（首次自动生成随机强密码，不打印、不入 git）；
 *       黎路遥手机另存一份（电脑坏了才有钥匙开门）。恢复命令见仓库 README.md。
 *
 * 用法（在仓库根目录跑）：
 *   node "0.木婉清档案/备份/同步到私有仓库.cjs"              # 真实同步（幂等：无变化不提交）
 *   node "0.木婉清档案/备份/同步到私有仓库.cjs" --dry-run     # 预览（刷新 staging，不提交、不推送）
 *   node "0.木婉清档案/备份/同步到私有仓库.cjs" --install-task # 装 Windows 计划任务（每天 12:30）
 *   node "0.木婉清档案/备份/同步到私有仓库.cjs" --remove-task  # 卸载计划任务
 *
 * 备份范围（照任务书，不扩大）：
 *   - 0.木婉清档案 全部文件（任务证据 png/jpg/xlsx/txt/json、assets、任务、回执、经验…）；
 *   - 各项目的 project-config 目录（链接/ID 类配置，含嵌套项目如 2.发票自动化/7.自动登记发票）。
 * 排除（安全；加密前先剔除，密文里也不该有）：
 *   - 文件名含 credential/secret/token/password/.local.json 的在线凭据文件，一律不进包；
 *   - 内容含真凭据的文件（即使文件名没写这些词）——实测 wecom-robot.json / kdocs-airscript.json /
 *     platform-config.json / stores.json 里藏着真 webhook/apiToken/门店密码，同样不进包；
 *   - node_modules/.git/runtime/.pi/.venv/__pycache__/dist/build、*.log、临时文件。
 *
 * 认证：staging 仓库级 credential.helper 指向新号（gh-bots）配置目录；token 由 gh 读取，
 * 不落任何 git 文件；git 子进程同时注入 GH_CONFIG_DIR=新号配置目录。
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
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
const PASSWORD_FILE = path.join(CONF_DIR, "备份密码.txt");
const PASSWORD_FILE_POSIX = PASSWORD_FILE.replace(/\\/g, "/");
const NODE_EXE = process.execPath;

// 计划任务环境没有 Git 的 PATH（openssl/tar 在 Git\usr\bin，不在系统 PATH）——用绝对路径兜底，避免 ENOENT
function resolveBin(name, candidates) {
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* 忽略 */
    }
  }
  return name; // 回退到 PATH 查找
}
const GIT_ROOT = "C:\\Program Files\\Git";
const TAR_BIN = resolveBin("tar", [
  path.join(GIT_ROOT, "usr", "bin", "tar.exe"),
  path.join(GIT_ROOT, "mingw64", "bin", "tar.exe")
]);
const OPENSSL_BIN = resolveBin("openssl", [
  path.join(GIT_ROOT, "usr", "bin", "openssl.exe"),
  path.join(GIT_ROOT, "mingw64", "bin", "openssl.exe")
]);

const PACKAGES_DIR = "packages";
const KEEP_PACKAGES = 3;
const PACKAGE_RE = /^packages\/archive-(\d{8})-(\d{6})-([0-9a-f]{16})\.tar\.enc$/;

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

function formatStamp(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function formatStampCompact(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// 明文内容哈希：按相对路径排序后逐文件喂 (路径 \0 内容 \0)；与 tar/加密的字节无关，跨次运行稳定。
function contentHash(relFiles) {
  const h = crypto.createHash("sha256");
  for (const rel of [...relFiles].sort()) {
    h.update(rel.split(path.sep).join("/"), "utf8");
    h.update("\0");
    h.update(fs.readFileSync(path.join(ROOT, rel)));
    h.update("\0");
  }
  return h.digest("hex");
}

// ---------------------------------------------------------------------------
// 密码（本机非 git 文件；缺失才自动生成，绝不覆盖已有文件）
// ---------------------------------------------------------------------------

function ensurePassword() {
  if (fs.existsSync(PASSWORD_FILE)) {
    const pw = fs.readFileSync(PASSWORD_FILE, "utf8").split(/\r?\n/)[0].trim();
    if (pw.length >= 32) return pw;
    throw new Error(
      `密码文件存在但内容异常（长度 ${pw.length}）：${PASSWORD_FILE}\n` +
        "先人工处理（旧备份要用它解密，脚本绝不自动覆盖）。"
    );
  }
  const pw = crypto.randomBytes(32).toString("base64"); // 44 字符随机串
  fs.mkdirSync(path.dirname(PASSWORD_FILE), { recursive: true });
  fs.writeFileSync(PASSWORD_FILE, pw + "\n", { encoding: "utf8", mode: 0o600 });
  console.log(`[密码] 首次生成 → ${PASSWORD_FILE}（内容不打印；请另存到黎路遥手机一份）`);
  return pw;
}

// ---------------------------------------------------------------------------
// 加密包
// ---------------------------------------------------------------------------

function listPackages() {
  const dir = path.join(STAGING, PACKAGES_DIR);
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => PACKAGE_RE.test(`${PACKAGES_DIR}/${n}`))
    .sort()
    .map((n) => {
      const m = PACKAGE_RE.exec(`${PACKAGES_DIR}/${n}`);
      return { name: `${PACKAGES_DIR}/${n}`, base: n, date: m[1], time: m[2], hash: m[3] };
    });
}

// 只留最近 KEEP_PACKAGES 个（文件名按 日期-时刻 可字典序排序）
function prunePackages() {
  const all = listPackages();
  const drop = all.slice(0, Math.max(0, all.length - KEEP_PACKAGES));
  const dropped = [];
  for (const p of drop) {
    try {
      fs.unlinkSync(path.join(STAGING, p.name));
      dropped.push(p.name);
    } catch {}
  }
  return { kept: all.slice(-KEEP_PACKAGES).map((p) => p.name), dropped };
}

function buildPackage(relFiles, shortHash) {
  const stamp = formatStampCompact(new Date());
  const base = `archive-${stamp}-${shortHash}.tar.enc`;
  const destDir = path.join(STAGING, PACKAGES_DIR);
  fs.mkdirSync(destDir, { recursive: true });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mwq-archive-"));
  try {
    const payload = path.join(tmp, "payload");
    for (const rel of relFiles) {
      const dst = path.join(payload, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(ROOT, rel), dst);
    }

    let r = spawnSync(TAR_BIN, ["-cf", "archive.tar", "-C", "payload", "."], {
      cwd: tmp,
      encoding: "utf8",
      windowsHide: true,
      timeout: 10 * 60 * 1000
    });
    if (r.error || r.status !== 0) {
      throw new Error(`tar 打包失败（exit ${r.status}）：${r.error ? r.error.message : (r.stderr || r.stdout || "").trim()}`);
    }

    r = spawnSync(
      OPENSSL_BIN,
      ["enc", "-aes-256-cbc", "-pbkdf2", "-salt", "-in", "archive.tar", "-out", "archive.tar.enc", "-pass", `file:${PASSWORD_FILE_POSIX}`],
      { cwd: tmp, encoding: "utf8", windowsHide: true, timeout: 10 * 60 * 1000 }
    );
    if (r.error || r.status !== 0) {
      throw new Error(`openssl 加密失败（exit ${r.status}）：${r.error ? r.error.message : (r.stderr || r.stdout || "").trim()}`);
    }

    fs.copyFileSync(path.join(tmp, "archive.tar.enc"), path.join(destDir, base));
    const sizeMB = (fs.statSync(path.join(destDir, base)).size / 1024 / 1024).toFixed(2);
    console.log(`已打加密包：${PACKAGES_DIR}/${base}（源文件 ${relFiles.length} 个，${sizeMB} MB）`);
    return `${PACKAGES_DIR}/${base}`;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 仓库 README（明文，只写恢复方法；不含密码/明文数据）
// ---------------------------------------------------------------------------

function readmeText() {
  return [
    "# muwanqing-archive · 木婉清档案（加密备份）",
    "",
    "> 本仓库 **private**，只存放**整包 AES-256 加密的 tar 备份**（敏感记录全在密文里，仓库页面看不到明文）：",
    "> `0.木婉清档案/**`（任务书/回执/经验/证据）与各项目 `project-config/**`（链接/ID 类配置）。",
    "> 公开仓库 `b34601512/customer-service-office-tools` 仍只备份 `*.md` 与源码。",
    ">",
    "> 由 `0.木婉清档案/备份/同步到私有仓库.cjs` 自动同步（Windows 计划任务 `muwanqing-archive-sync`，每天 12:30）。",
    "> 明文内容哈希没变就不打新包；`packages/` 里只保留**最近 3 个**包。**不要手改这里的内容**。",
    "",
    "## 怎么恢复",
    "",
    "1. 本机装好 `openssl` 与 `tar`（Windows 装了 Git 就有，在 `C:\\Program Files\\Git\\usr\\bin`）。",
    "2. 拿到密码：黎路遥**手机**里有一份；本机（这台电脑）在",
    "   `C:\\Users\\b3460\\.config\\muwanqing-archive\\备份密码.txt`（**不在任何 git 里**）。",
    "3. 解密 + 解包（在 clone 出来的仓库目录里跑；`<包名>` = `packages/` 下的文件名）：",
    "",
    "```bash",
    "openssl enc -d -aes-256-cbc -pbkdf2 -in \"packages/<包名>.tar.enc\" -out archive.tar -pass file:<密码文件路径>",
    "tar -xf archive.tar",
    "```",
    "",
    "解出来就是当时的完整目录树（相对仓库根：`0.木婉清档案/...`、`<项目>/project-config/...`）。",
    "",
    "## 说明",
    "",
    "- 加密：`openssl enc -aes-256-cbc -pbkdf2 -salt`（每次随机 salt）；密码是 44 位随机串，只存手机与本机非 git 文件。",
    "- 不含在线凭据：企微 webhook、AirScript 同步 webhook、apiToken、门店密码等在打包前按「文件名 + 内容」双重规则剔除，不进密文。",
    "- 2026-10-06 之前本仓库曾以明文推送过（含一次误推后修正）；历史已重置为单一根提交，但 GitHub 侧旧对象可能残留（仅本仓库账号可读），彻底清理需删库重建。",
    "- 维护：木婉清（AI 助手）；重建说明见主仓库 `0.木婉清档案/敏感与配置清单-不备份与重建.md`。",
    ""
  ].join("\n");
}

function writeReadme() {
  const readmePath = path.join(STAGING, "README.md");
  const text = readmeText();
  if (!fs.existsSync(readmePath) || fs.readFileSync(readmePath, "utf8") !== text) {
    fs.writeFileSync(readmePath, text, "utf8");
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 收集（同上一版：文件名 + 内容双重排除）
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
    else if (ent.isFile()) cb(path.relative(STAGING, abs).split(path.sep).join("/"), abs);
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
  // 仓库级 credential helper 指向新号（gh-bots）；token 由 gh 读取，不落任何 git 文件。
  // 注意：全局 helper 可能是 wincred 且会先被问（旧版曾因此推错账号）；这里先清空本地 helper 列表
  //（值 "" 会重置 helper 链），再加 gh-bots 的函数式 helper（$@ 必须消费，否则 gh 拿不到 get/store 参数）。
  git(["config", "--local", "--unset-all", "credential.helper"], { allowFail: true });
  git(["config", "--local", "--add", "credential.helper", ""]);
  git([
    "config",
    "--local",
    "--add",
    "credential.helper",
    `!f() { GH_CONFIG_DIR="${GH_CONFIG_DIR.replace(/\\/g, "/")}" gh auth git-credential "$@"; }; f`
  ]);
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

function aheadCount() {
  const hasRemote = git(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${BRANCH}`], { allowFail: true }).status === 0;
  if (!hasRemote) return 1;
  const r = git(["rev-list", "--count", `origin/${BRANCH}..HEAD`], { allowFail: true });
  return r.status === 0 ? parseInt(r.stdout.trim(), 10) || 0 : 0;
}

function pushNow() {
  const push = git(["push", "-u", "origin", BRANCH], { allowFail: true });
  if (push.status === 0) {
    console.log(`push：成功  ${(push.stderr || "").split(/\r?\n/).filter(Boolean).slice(-1)[0] || "Everything up-to-date"}`);
    return true;
  }
  console.error(`push：失败（exit ${push.status}），本地已提交、未丢，下次同步会再推一次；本次到此为止（不自动重试）。`);
  console.error((push.stderr || push.stdout || "").trim());
  process.exitCode = 1;
  return false;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function main() {
  if (!fs.existsSync(ARCHIVE_DIR)) throw new Error(`找不到档案目录：${ARCHIVE_DIR}`);

  ensurePassword(); // 缺则生成；内容永不打印
  acquireLock();
  ensureStaging();

  console.log(`=== 木婉清档案 → ${REPO_SLUG}（加密包） ===`);
  console.log(`staging：${STAGING}${DRY_RUN ? "（dry-run）" : ""}`);

  // ① 收集源文件（文件名 + 内容双重排除，加密前先剔除在线凭据）
  const stats = { excluded: 0, contentExcluded: 0, contentHits: [] };
  const archiveFiles = [];
  collectFiles(ARCHIVE_DIR, archiveFiles, stats);
  const cfgDirs = [];
  findConfigDirs(ROOT, 0, cfgDirs);
  const cfgFiles = [];
  for (const d of cfgDirs) collectFiles(d, cfgFiles, stats);
  const desired = [...new Set([...archiveFiles, ...cfgFiles])].sort();

  console.log(
    `源文件：${desired.length} 个（档案 ${archiveFiles.length} + project-config ${cfgFiles.length}，${cfgDirs.length} 个项目配置目录）；` +
      `按规则跳过 ${stats.excluded} 个（文件名敏感/运行态），内容级剔除 ${stats.contentExcluded} 个（真凭据）`
  );
  if (stats.contentHits.length) {
    console.log("内容级剔除清单（含真 webhook/apiToken/密码，不进密文）：");
    for (const h of stats.contentHits) console.log("  - " + h);
  }

  // ② 明文内容哈希 → 没变就不打新包
  const fullHash = contentHash(desired);
  const shortHash = fullHash.slice(0, 16);
  const existing = listPackages();
  const already = existing.find((p) => p.hash === shortHash);
  let newPkg = null;
  if (already) {
    console.log(`内容哈希未变（${shortHash}）：已有 ${already.name}，跳过打包。`);
  } else {
    newPkg = buildPackage(desired, shortHash);
  }

  // ③ README + 只留最近 3 个包
  const readmeChanged = writeReadme();
  const prune = prunePackages();
  if (prune.dropped.length) console.log(`滚动删除旧包（只留 ${KEEP_PACKAGES} 个）：${prune.dropped.join("、")}`);

  // ④ 清理 staging：除 README 与密文包外一律删（含旧版明文文件）
  let removed = 0;
  walkStaged(STAGING, (rel, abs) => {
    if (rel === "README.md") return;
    if (PACKAGE_RE.test(rel)) return;
    fs.unlinkSync(abs);
    removed++;
  });

  // ⑤ 暂存 + 安全断言（此刻暂存区只允许 README + 密文包）
  git(["add", "-A", "--", "."]);
  const indexList = git(["ls-files", "--cached"]).stdout.split(/\r?\n/).filter(Boolean);
  const leaked = [];
  for (const rel of indexList) {
    if (rel === "README.md") {
      if (isExcluded(rel)) leaked.push(`${rel}（按文件名）`);
      const hit = contentSecret(path.join(STAGING, rel));
      if (hit) leaked.push(`${rel}（${hit}）`);
      continue;
    }
    if (!PACKAGE_RE.test(rel)) leaked.push(`${rel}（不是 README/密文包）`);
  }
  if (leaked.length) {
    console.error("拒绝提交：暂存区出现非 README/密文包的文件，先排查再跑：");
    for (const f of leaked) console.error("  - " + f);
    process.exit(2);
  }

  const statusLines = git(["status", "--porcelain"]).stdout.split(/\r?\n/).filter(Boolean);
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
    `staging：清理旧文件 ${removed} 个${readmeChanged ? "，README 更新" : ""}；` +
      `暂存变化：新增 ${count.A} / 修改 ${count.M} / 删除 ${count.D}${count.R ? ` / 重命名 ${count.R}` : ""}`
  );

  // ⑥ 提交 / 推送
  if (DRY_RUN) {
    console.log("dry-run：不提交、不推送（staging 已刷新：密文包 + README）。");
    console.log(`仓库：${REPO_URL}（private）`);
    return;
  }

  const hasHead = git(["rev-parse", "--verify", "--quiet", "HEAD"], { allowFail: true }).status === 0;
  if (statusLines.length === 0) {
    console.log("无变化：不提交。");
  } else {
    const stamp = formatStamp(new Date());
    const msg = hasHead
      ? `加密备份 ${stamp}（源文件 ${desired.length} 个，${newPkg ? `新包 ${path.basename(newPkg)}` : "复用现有包"}）`
      : `加密备份首次快照：木婉清档案 + 项目配置 ${stamp}`;
    git(["commit", "-m", msg]);
    console.log(`已提交：${msg}`);
  }

  const ahead = aheadCount();
  if (ahead > 0 || statusLines.length > 0) {
    pushNow();
  } else {
    console.log("push：无待推送提交（已是最新）。");
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
    "Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description '木婉清档案+项目配置 每日 12:30 加密打包（AES-256）同步到私有仓库 c34601512-cpu/muwanqing-archive' -Force | Out-Null",
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
