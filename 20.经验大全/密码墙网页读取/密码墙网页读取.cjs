#!/usr/bin/env node
/**
 * 密码墙网页读取.cjs —— 只读脚本
 *
 * 用途：用本机 Edge（playwright-core, channel: msedge）+ 独立持久画像，打开 JS 渲染/带密码门的网页，
 *      输密码、点「确定」、读正文并截图。适用于飞书 wiki 分享页、探域后台页面等。
 *
 * 用法（先设 NODE_PATH 借用已有项目依赖，见同目录《密码墙网页读取经验.md》）：
 *   $env:NODE_PATH = "D:\桌面\办公软件\1.客服超时督办\node_modules"
 *   $env:PAGE_PASSWORD = "<密码>"
 *   node "密码墙网页读取.cjs" --url "https://my.feishu.cn/wiki/分享ID" --password-env PAGE_PASSWORD --out "C:/Users/b3460/.pi-edge-work"
 *
 * 安全边界：
 *   - 不打印、不落盘密码与 Cookie；密码通过 --password-env（推荐）/ --password-file / --password 传入；
 *   - 只读：不点「确定」以外的按钮，不提交任何表单数据；
 *   - 出现滑块/验证码/短信/扫码等人工验证：脚本会提示，请人工接管，不要乱点。
 *
 * 退出码：0 成功；1 参数错误；2 检测到密码墙但未提供密码；3 输密码后仍被拦；4 其他执行错误。
 */
'use strict';

const fs = require('fs');
const path = require('path');

let chromium;
try {
  ({ chromium } = require('playwright-core'));
} catch (e) {
  console.error('[错误] 找不到 playwright-core。请先设置 NODE_PATH 指向已有项目依赖，例如：');
  console.error('  $env:NODE_PATH = "D:\\桌面\\办公软件\\1.客服超时督办\\node_modules"');
  process.exit(4);
}

const DEFAULTS = {
  profile: 'C:/Users/b3460/.pi-edge-auto',
  out: '.',
  'wait-before': 6000,
  'wait-after': 8000,
  timeout: 60000,
  'text-limit': 4000,
  'input-selector': 'input[type="password"], input[type="text"]',
  'button-name': '确定|确认|提交',
  'scroll-step': 0.6,
  'scroll-settle': 400,
  'scroll-max': 400,
};

// 滚动采集时过滤的界面噪声（不是文档正文）；已实测的飞书界面文案
const SCROLL_NOISE = new Set([
  '帮助中心', '快捷键', '跳转至首条评论', '复制', 'Plain Text',
  '评论（0）', '评论（1）', '评论（2）', '评论（3）', '评论（4）', '评论（5）',
]);
const ZERO_WIDTH_RE = /[\u200b\u200c\u200d\ufeff]/g;

const USAGE = `
密码墙网页读取（只读）

必填：
  --url <URL>                 要打开的页面地址

密码（三选一，按推荐顺序；不提供则只打开页面不提交）：
  --password-env <变量名>      从环境变量取密码（推荐）
  --password-file <路径>       从本地文件取密码（首尾空白会被去掉，文件勿入库）
  --password <值>              直接给密码（会进命令行历史，仅临时用）

可选：
  --out <目录>                 输出目录（默认当前目录），生成 页面正文.txt / 页面截图.png
  --profile <目录>             浏览器画像目录（默认 C:/Users/b3460/.pi-edge-auto）
  --wait-before <毫秒>         打开后等渲染（默认 6000）
  --wait-after <毫秒>          提交密码后等渲染（默认 8000）
  --timeout <毫秒>             单步超时（默认 60000）
  --text-limit <字符数>        控制台打印正文上限（默认 4000；全文总会写入 页面正文.txt）
  --input-selector <选择器>    密码框选择器（默认 input[type="password"], input[type="text"]）
  --button-name <正则>         提交按钮文字（默认 确定|确认|提交）
  --no-submit                  只打开页面并截图，不输密码、不点按钮
  --headless                   无头运行（默认可见窗口；排障时不要加）
  --keep-open                  读完不关浏览器，留给人肉眼核对（Ctrl+C 结束）

长文档滚动采集（虚拟滚动页面，如飞书长文档：正文只渲染可视区，直接读 body 会缺内容）：
  --scroll-collect             逐步滚动并合并全文；结果写入 页面正文.txt
  --scroll-selector <选择器>   指定滚动容器；默认自动选“可滚动幅度最大”的元素
  --scroll-step <0~1>          每步滚动视口比例（默认 0.6）
  --scroll-settle <毫秒>       每步后等待渲染（默认 400）
  --scroll-max <步数>          最大步数（默认 400，防止死循环）
  --dump-links                 滚动扫描全文并导出超链接到 页面链接.txt（读取引用文档用；只读）
  --help                       显示本说明
`;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      out._.push(token);
      continue;
    }
    const key = token.slice(2);
    if (key === 'help' || key === 'headless' || key === 'keep-open' || key === 'no-submit' || key === 'scroll-collect' || key === 'dump-links') {
      out[key] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`参数 --${key} 缺少值`);
    out[key] = value;
    i++;
  }
  return out;
}

function num(args, key) {
  const raw = args[key];
  if (raw === undefined) return DEFAULTS[key];
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`参数 --${key} 需要非负数字，收到：${raw}`);
  return n;
}

// ---------- 长文档滚动采集 ----------

function normalizeLines(text) {
  return String(text == null ? '' : text)
    .split('\n')
    .map((l) => l.replace(ZERO_WIDTH_RE, '').trim())
    .filter((l) => l && !SCROLL_NOISE.has(l));
}

// 行级 LCS：返回 acc、cur 的匹配行对（i, j）
function lcsPairs(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i];
    const nxt = dp[i + 1];
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? nxt[j + 1] + 1 : Math.max(nxt[j], row[j + 1]);
    }
  }
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

// 按行对齐合并：把 cur 里 acc 没有的行按文档顺序插入；acc 已有的行不重复
function unionLines(acc, cur) {
  const pairs = lcsPairs(acc, cur);
  const out = [];
  let ai = 0;
  let bi = 0;
  for (const [i, j] of pairs) {
    for (; ai < i; ai++) out.push(acc[ai]);
    for (; bi < j; bi++) out.push(cur[bi]);
    out.push(acc[i]);
    ai = i + 1;
    bi = j + 1;
  }
  for (; ai < acc.length; ai++) out.push(acc[ai]);
  for (; bi < cur.length; bi++) out.push(cur[bi]);
  return out;
}

async function scrollCollect(page, opts) {
  const step = opts.step;
  const settle = opts.settle;
  const maxSteps = opts.max;
  const found = await page.evaluate((sel) => {
    let el = sel ? document.querySelector(sel) : null;
    if (!el) {
      let bestSize = 0;
      for (const node of document.querySelectorAll('*')) {
        const st = getComputedStyle(node);
        if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 100) {
          const size = node.scrollHeight - node.clientHeight;
          if (size > bestSize) { bestSize = size; el = node; }
        }
      }
    }
    if (!el) el = document.scrollingElement || document.documentElement;
    el.setAttribute('data-pi-scroll-target', '1');
    el.scrollTop = 0;
    return { sh: el.scrollHeight, ch: el.clientHeight };
  }, opts.selector || null);
  await page.waitForTimeout(settle);

  let lines = null;
  let prev = null;
  let stable = 0;
  const snapshots = [];
  const linkMap = new Map();
  for (let i = 0; i < maxSteps; i++) {
    const snap = await page.evaluate(() => {
      const el = document.querySelector('[data-pi-scroll-target="1"]');
      return el ? el.innerText : '';
    });
    if (opts.collectText !== false) {
      const cur = normalizeLines(snap);
      snapshots.push(cur);
      if (lines === null) lines = cur;
      else if (cur.length) lines = unionLines(lines, cur);
    }
    if (opts.collectLinks) {
      const links = await page.evaluate(() => {
        const el = document.querySelector('[data-pi-scroll-target="1"]');
        if (!el) return [];
        return [...el.querySelectorAll('a[href]')].map((a) => ({
          text: (a.innerText || a.textContent || '').replace(/\s+/g, ' ').trim(),
          href: a.href,
        })).filter((l) => l.href && !/^javascript:/i.test(l.href));
      }).catch(() => []);
      for (const l of links) if (!linkMap.has(l.href)) linkMap.set(l.href, l);
    }

    const st = await page.evaluate(() => {
      const el = document.querySelector('[data-pi-scroll-target="1"]');
      return el ? { top: el.scrollTop, sh: el.scrollHeight, ch: el.clientHeight } : { top: 0, sh: 0, ch: 0 };
    });
    const atBottom = st.top + st.ch >= st.sh - 2;
    if (atBottom && snap === prev) { stable++; if (stable >= 2) break; } else stable = 0;
    prev = snap;

    await page.evaluate((s) => {
      const el = document.querySelector('[data-pi-scroll-target="1"]');
      if (el) el.scrollTop = Math.min(el.scrollTop + el.clientHeight * s, el.scrollHeight);
    }, step);
    await page.waitForTimeout(settle);
  }

  await page.evaluate(() => {
    const el = document.querySelector('[data-pi-scroll-target="1"]');
    if (el) {
      el.scrollTop = 0;
      el.removeAttribute('data-pi-scroll-target');
    }
  });
  await page.waitForTimeout(300);

  // 自检：每张滚动快照都应是合并全文的子序列；否则说明有行没合并进去（漏采）
  if (opts.collectText !== false && lines && lines.length) {
    let badSnaps = 0;
    let missingTotal = 0;
    for (let i = 0; i < snapshots.length; i++) {
      let cursor = 0;
      let missing = 0;
      for (const line of snapshots[i]) {
        let k = cursor;
        while (k < lines.length && lines[k] !== line) k++;
        if (k < lines.length) cursor = k + 1;
        else missing++;
      }
      if (missing > 0) {
        badSnaps++;
        missingTotal += missing;
        console.log(`[滚动采集][警告] 第 ${i + 1} 张快照有 ${missing} 行未出现在全文（疑似漏采）`);
      }
    }
    if (badSnaps === 0) {
      console.log(`[滚动采集] 自检通过：${snapshots.length} 张快照均为合并全文的子序列`);
    } else {
      console.log(`[滚动采集] 自检警告：${badSnaps}/${snapshots.length} 张快照有未合并行（共 ${missingTotal} 行），必须人工核对`);
    }
  }

  console.log(`[滚动采集] 容器高度 ${found.sh}px / 视口 ${found.ch}px，合并 ${lines ? lines.length : 0} 行`);
  return { text: (lines || []).join('\n'), links: [...linkMap.values()] };
}

function resolvePassword(args) {
  if (args.password !== undefined) return { value: args.password, from: '命令行 --password（会进历史，建议改用 --password-env）' };
  if (args['password-env'] !== undefined) {
    const name = args['password-env'];
    const value = process.env[name];
    if (!value) throw new Error(`环境变量 ${name} 为空或不存在；请先在当前终端设置密码后再运行`);
    return { value, from: `环境变量 ${name}` };
  }
  if (args['password-file'] !== undefined) {
    const file = args['password-file'];
    if (!fs.existsSync(file)) throw new Error(`密码文件不存在：${file}`);
    const value = fs.readFileSync(file, 'utf8').trim();
    if (!value) throw new Error(`密码文件为空：${file}`);
    return { value, from: `本地文件 ${file}（该文件勿入库）` };
  }
  return null;
}

const WALL_TITLE = /没有权限访问|无权限|访问受限|请输入密码|permission|password/i;
const WALL_HINT = /请输入密码|输入访问密码|请输入访问密码|enter password/i;
const HUMAN_CHECK = /滑块|验证码|安全验证|扫码|短信验证|请完成验证/;

async function readPage(page) {
  const title = await page.title().catch(() => '');
  const url = page.url();
  const text = await page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
  return { title, url, text };
}

(async () => {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`[参数错误] ${e.message}`);
    console.error(USAGE);
    process.exit(1);
  }
  if (args.help) {
    console.log(USAGE);
    process.exit(0);
  }
  if (!args.url) {
    console.error('[参数错误] 缺少 --url');
    console.error(USAGE);
    process.exit(1);
  }

  let password = null;
  try {
    password = resolvePassword(args);
  } catch (e) {
    console.error(`[参数错误] ${e.message}`);
    process.exit(1);
  }

  const outDir = path.resolve(args.out ?? DEFAULTS.out);
  const textLimit = num(args, 'text-limit');
  const waitBefore = num(args, 'wait-before');
  const waitAfter = num(args, 'wait-after');
  const timeout = num(args, 'timeout');
  const buttonName = new RegExp(args['button-name'] ?? DEFAULTS['button-name']);
  const inputSelector = args['input-selector'] ?? DEFAULTS['input-selector'];

  fs.mkdirSync(outDir, { recursive: true });
  const textFile = path.join(outDir, '页面正文.txt');
  const shotFile = path.join(outDir, '页面截图.png');
  const shotBefore = path.join(outDir, '页面截图-输密码前.png');

  const ctx = await chromium.launchPersistentContext(args.profile ?? DEFAULTS.profile, {
    channel: 'msedge',
    headless: Boolean(args.headless),
    args: args.headless ? [] : ['--start-maximized'],
    viewport: null,
  }).catch((e) => {
    console.error(`[执行错误] 拉不起浏览器画像（常见原因：同一画像目录已被另一个 Edge 进程占用，需串行执行）：${e.message}`);
    process.exit(4);
  });

  let exitCode = 0;
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    console.log(`[打开] ${args.url}（画像：${args.profile ?? DEFAULTS.profile}）`);
    if (/pinduoduo\.com|taobao\.com|tmall\.com|douyin\.com|jinritemai\.com|jd\.com|kuaishou\.com|xiaohongshu\.com|youzan\.com/i.test(String(args.url || ''))) {
      console.log('[警告] 这是风控平台：本工具用自动化内核浏览器，人工登录/验证码很可能被风控拦住。');
      console.log('        人工登录请改用：node "20.经验大全/风控平台人工登录/打开原生Chrome.cjs" --url <页面> --profile <画像目录>');
    }
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout }).catch((e) => console.error(`[警告] 页面加载警告：${e.message}`));
    await page.waitForTimeout(waitBefore);

    const before = await readPage(page);
    const wallBefore = WALL_TITLE.test(before.title) || WALL_HINT.test(before.text) || (await page.locator('input[type="password"]').count().catch(() => 0)) > 0;
    console.log(`[初判] TITLE=${before.title || '(空)'} / URL=${before.url} / 密码墙=${wallBefore ? '是' : '否'}`);

    if (wallBefore) {
      await page.screenshot({ path: shotBefore }).catch(() => {});
      console.log(`[证据] 输密码前截图：${shotBefore}`);
    }

    if (wallBefore && !args['no-submit']) {
      if (!password) {
        console.error('[需要密码] 页面有密码墙，但未提供密码。用 --password-env / --password-file 传入后重试（不要把密码写进笔记或提交）。');
        exitCode = 2;
      } else {
        console.log(`[输密码] 来源：${password.from}（内容不打印）`);
        const input = page.locator(inputSelector).first();
        await input.fill(password.value, { timeout }).catch((e) => {
          console.error(`[执行错误] 填密码失败（选择器 ${inputSelector}）：${e.message}`);
          exitCode = 4;
        });

        if (exitCode === 0) {
          let submitted = false;
          try {
            const button = page.getByRole('button', { name: buttonName }).first();
            await button.click({ timeout: 10000 });
            submitted = true;
            console.log('[提交] 已点击按钮');
          } catch (e) {
            console.error(`[警告] 未找到匹配 /${buttonName.source}/ 的按钮，改为在密码框回车：${e.message}`);
            await input.press('Enter', { timeout: 10000 }).catch(() => {});
            console.log('[提交] 已尝试回车提交');
          }
          if (!submitted) console.log('[提示] 若页面没反应，请肉眼查看窗口，或用 --button-name 指定按钮文字');
          await page.waitForTimeout(waitAfter);
        }
      }
    } else if (wallBefore) {
      console.log('[跳过] --no-submit：只打开页面，不输密码。');
    }

    const after = await readPage(page);
    const needScroll = args['scroll-collect'] || args['dump-links'];
    if (needScroll) {
      console.log('[滚动采集] 开始（虚拟滚动长文档，逐步滚动并合并全文）……');
      const collected = await scrollCollect(page, {
        selector: args['scroll-selector'],
        step: num(args, 'scroll-step'),
        settle: num(args, 'scroll-settle'),
        max: num(args, 'scroll-max'),
        collectText: Boolean(args['scroll-collect']),
        collectLinks: Boolean(args['dump-links']),
      });
      if (args['scroll-collect']) {
        after.text = collected.text;
        console.log(`[滚动采集] 合并后正文 ${after.text.length} 字`);
      }
      if (args['dump-links']) {
        const linkFile = path.join(outDir, '页面链接.txt');
        fs.writeFileSync(linkFile, collected.links.map((l) => `${l.text || '(无文字)'}\t${l.href}`).join('\n'), 'utf8');
        console.log(`[链接] 共 ${collected.links.length} 条，已写入 ${linkFile}`);
      }
    }
    await page.screenshot({ path: shotFile }).catch(() => {});
    fs.writeFileSync(textFile, after.text, 'utf8');

    console.log(`TITLE ${after.title}`);
    console.log(`URL ${after.url}`);
    console.log(`字数 ${after.text.length}（全文已写入 ${textFile}）`);
    console.log(`TEXT ${JSON.stringify(after.text.slice(0, textLimit))}`);

    const stillBlocked = WALL_TITLE.test(after.title) || WALL_HINT.test(after.text);
    if (stillBlocked && !args['no-submit']) {
      console.error('[失败] 提交密码后仍在权限页：可能密码错误，或页面出现人工验证。请肉眼查看窗口后重试/叫人。');
      console.error(`[证据] 截图：${shotFile}，正文：${textFile}`);
      exitCode = 3;
    } else if (stillBlocked) {
      console.log('[结论] 页面为密码墙（--no-submit 未提交，属预期）。');
    } else {
      console.log(`[成功] 验收四件套齐全：TITLE / URL / 正文（${textFile}）/ 截图（${shotFile}）`);
    }

    if (HUMAN_CHECK.test(after.text)) {
      console.log('[人工验证] 页面上疑似出现滑块/验证码/扫码，请人工接管，窗口保持可见，不要乱点。');
    }
  } catch (e) {
    console.error(`[执行错误] ${e.message}`);
    exitCode = 4;
  } finally {
    if (args['keep-open']) {
      console.log('[保留窗口] --keep-open：浏览器保持打开，核对完自行关闭或 Ctrl+C。');
      await new Promise(() => {});
    } else {
      await ctx.close().catch(() => {});
    }
  }

  process.exit(exitCode);
})();
