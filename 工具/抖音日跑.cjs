#!/usr/bin/env node
"use strict";
/**
 * 抖音日跑（一条命令干完一天的抖音只读同步，2026-11-13 木婉清做）
 *
 * 为什么有它（黎路遥 2026-11-13 10:5x + 11:4x 两次）：
 *   「流程要做成工具，别每次用文档，搞着搞着就忘了」「抖音是每日工作，已经做过几百次」。
 *   以前掉登录＝停下来报人要人登，一天就废掉；现在把「开窗→发码→填码→两店串行同步」做成一条命令。
 *
 * 一条命令：
 *   node 工具/抖音日跑.cjs
 *   node 工具/抖音日跑.cjs --只查登录        # 只探登录态，不跑同步
 *   node 工具/抖音日跑.cjs --店 douyin-store-2   # 从哪家店开窗（默认店3）
 *   node 工具/抖音日跑.cjs --无窗            # 无头，仅跑同步（登录态已确认好的时候）
 *
 * 它做的事（顺序固定）：
 *   1) 用店铺配置的账号资料目录开可见窗，进发票列表页
 *   2) 若在登录页 → 自动填手机号 → 点「发送验证码」→ 打印「码已发」→ 等 10 分钟
 *      听两种信号：① 人在窗口里自己填完（URL 离开 /login）② 答案文件出现 6 位数字（我填）
 *   3) 登录确认后关掉探窗（释放资料目录锁），再调李沅芷的只读同步：`scripts/只读同步补跑.js douyin`
 *      —— 两家店由她那支脚本串行切店跑，店3 → 店5
 *   4) 打印摘要与退出码：0=全程正常；2=登录没成；3=同步失败
 *
 * 红线：只读同步 + 登录，不下载发票、不回传、不改店铺设置；同一失败不重试（掉登录当天停手记一条）。
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const 她项目 = "D:/硅基公司/员工/05.发票专员·李沅芷/专项/2.发票自动化";
const 抖音项目 = path.join(她项目, "6.抖音发票回传");
const { 创建抖音账号浏览器上下文 } = require(path.join(抖音项目, "src/browser/douyinBrowserContext"));
const { 读取店铺配置 } = require(path.join(抖音项目, "src/store/storeConfigService"));
const { 获取账号浏览器资料目录 } = require(path.join(抖音项目, "src/browser/accountProfilePaths"));

const 参数 = process.argv.slice(2);
const 取值 = (名, 默认) => {
  const i = 参数.indexOf(名);
  return i > -1 && 参数[i + 1] ? 参数[i + 1] : 默认;
};
const 店铺Id = 取值("--店", "douyin-store-1");
const 只查登录 = 参数.includes("--只查登录");
const 无窗 = 参数.includes("--无窗");

const 答案文件 = path.join(__dirname, ".state", "抖音验证码-答案.txt");
const 登录页路径 = "/login";
const 目标页 = "https://fxg.jinritemai.com/ffa/morder/receipt/list";
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
const 是登录页 = (u) => {
  try {
    const x = new URL(String(u || ""));
    return x.hostname === "fxg.jinritemai.com" && x.pathname.startsWith(登录页路径);
  } catch {
    return true;
  }
};
const 说 = (...a) => console.log(...a);

async function 探登录(店铺) {
  const 上下文 = await 创建抖音账号浏览器上下文(店铺, { headless: 无窗 });
  const 页 = 上下文.pages().find((p) => !p.isClosed()) || (await 上下文.newPage());
  await 页.goto(目标页, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await 等(2500);
  return { 上下文, 页, 已登录: !是登录页(页.url()) };
}

async function 点文本(页, 文案组) {
  for (const 文案 of 文案组) {
    const 定位 = 页.getByText(文案, { exact: false }).first();
    try {
      if ((await 定位.count()) && (await 定位.isVisible())) {
        await 定位.click({ timeout: 5000 });
        return true;
      }
    } catch (e) {
      /* 换下一个文案 */
    }
  }
  return false;
}

async function 发码登录(店铺, 页) {
  await 页.goto("https://fxg.jinritemai.com/login/common", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await 等(2500);
  await 页.bringToFront().catch(() => {});
  await 点文本(页, ["验证码登录", "手机号登录", "短信登录"]);
  await 等(1200);

  const 电话框 = 页.locator('input[placeholder*="手机"], input[type="tel"], input[placeholder*="电话"]').first();
  if (await 电话框.count()) {
    const 现值 = await 电话框.inputValue().catch(() => "");
    if (!现值 && 店铺.phoneNumber) await 电话框.fill(String(店铺.phoneNumber)).catch(() => {});
  }
  for (const 选择器 of ['input[type="checkbox"]', "text=我已阅读", "text=同意"]) {
    try {
      const 框 = 页.locator(选择器).first();
      if ((await 框.count()) && (await 框.isVisible())) {
        if (!(await 框.isChecked().catch(() => true))) await 框.check({ timeout: 3000 }).catch(() => {});
      }
    } catch (e) {
      /* 有就勾，没有就算了 */
    }
  }

  if (!(await 点文本(页, ["获取验证码", "发送验证码", "获取短信验证码"]))) {
    说("✗ 没点到「发送验证码」——页面可能改版了。窗口留着，人可以自己在里面登。");
    return false;
  }
  说(`码已发（发到 ${店铺.phoneNumber || "店铺绑定手机"}）：你报 6 位码，或直接在窗口里填。等 10 分钟。`);

  fs.mkdirSync(path.dirname(答案文件), { recursive: true });
  const 截止 = Date.now() + 10 * 60 * 1000;
  while (Date.now() < 截止) {
    await 等(2500);
    if (!是登录页(页.url())) {
      说(`✓ 登录成功（人填的）：${页.url()}`);
      return true;
    }
    if (fs.existsSync(答案文件)) {
      const 码 = fs.readFileSync(答案文件, "utf8").trim();
      if (/^\d{4,8}$/.test(码)) {
        fs.unlinkSync(答案文件);
        const 码框 = 页.locator('input[placeholder*="验证码"], input[placeholder*="短信"]').first();
        if (await 码框.count()) {
          await 码框.fill(码).catch(() => {});
          await 点文本(页, ["登录", "立即登录", "登 录"]);
          for (let i = 0; i < 30; i += 1) {
            await 等(2000);
            if (!是登录页(页.url())) {
              说(`✓ 登录成功（脚本填码）：${页.url()}`);
              return true;
            }
          }
          说("✗ 填码后仍回登录页——停手，不连续猜码（会撞风控）。");
          return false;
        }
        说("✗ 没找到验证码输入框。");
        return false;
      }
    }
  }
  说("等码超时（10 分钟），没提交。窗口留着，人可以自己登。");
  return false;
}

(async () => {
  const 店铺 = (读取店铺配置().stores || []).find((s) => s.id === 店铺Id);
  if (!店铺) {
    说(`✗ 没找到店铺配置：${店铺Id}`);
    process.exit(1);
  }

  说(`抖音日跑｜开窗店=${店铺.name}｜手机=${店铺.phoneNumber || "-"}｜无窗=${无窗}`);
  const 第一次 = await 探登录(店铺);
  let 已登录 = 第一次.已登录;

  if (!已登录 && !无窗) {
    已登录 = await 发码登录(店铺, 第一次.页);
  }
  await 第一次.上下文.close().catch(() => {});
  await 等(1000);

  if (!已登录) {
    说("✗ 登录没成。今天别硬跑：记一条，明天再来；不连续重试。");
    process.exit(2);
  }
  说("✓ 登录态正常。");
  if (只查登录) process.exit(0);

  // 2026-11-13 改成一店一份资料目录：哪家目录还没建（没登过），就先只跑已登录的那家，
  // 免得两店串行时卡在「等待扫码」白占时间。
  const 全部店铺 = 读取店铺配置().stores || [];
  const 已备好 = 全部店铺.filter((s) => fs.existsSync(获取账号浏览器资料目录(s)));
  const 待登录 = 全部店铺.filter((s) => !fs.existsSync(获取账号浏览器资料目录(s)));
  if (待登录.length) {
    说(`⚠ 这些店还没登录过（目录没建）：${待登录.map((s) => s.id).join("、")} —— 今天只跑已备好的。`);
  }
  if (!已备好.length) {
    说("✗ 没有任何一家店的资料目录，先跑：node 工具/抖音日跑.cjs --店 douyin-store-1（会上窗发码）");
    process.exit(2);
  }
  const 同步参数 = 待登录.length
    ? ["douyin", 已备好[0].id]
    : ["douyin"];
  说(`→ 调李沅芷的只读同步：scripts/只读同步补跑.js ${同步参数.join(" ")}`);
  const 同步 = spawnSync(process.execPath, [path.join(她项目, "scripts/只读同步补跑.js"), ...同步参数], {
    cwd: 她项目,
    stdio: "inherit",
    timeout: 30 * 60 * 1000,
  });
  const 码 = 同步.status;
  说(码 === 0 ? "✓ 只读同步完成。" : `✗ 只读同步失败，退出码=${码}（保留现场，不自动重试）`);
  process.exit(码 === 0 ? 0 : 3);
})();
