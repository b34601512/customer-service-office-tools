#!/usr/bin/env node
// 拼多多后台「售后申诉」填表 / 提交（默认只填不交 = dry-run）。
//
// ⚠ 业务红线（用户 2026-09-28 拍板）：**真实提交必须用户先批准**，所以本工具默认 dry-run；
//   只有显式加 --submit 才会点「提交申诉」，点了会真实提交、不可修改。
//
// 入口：https://mms.pinduoduo.com/orders/appeals/aftersale/order → 搜订单 → 发起申诉
// 表单实测（2026-09-28）：
//   · 申诉项是复选框（货款申诉/运费申诉/纠纷退款率申诉），**默认全勾**；不勾的项不用填，勾了不填提交会校验失败
//   · **申诉原因选项随订单场景变化**（仅退款少件 vs 退货退款 是两套），并且**每个涉钱的申诉项各有一组「申诉原因+申诉金额」**
//     → 本工具只按标题在页面里动态读取选项，选不到就报错并列出实际可选项，不硬编码
//   · 申诉金额不得超过对应申诉项页面上的「最多可申诉 X 元」
//   · 必填凭证（证明商家无责）图片≤3、视频≤2；选填凭证同理
//   · 申诉描述 ≤300 字 —— 超了会提交失败：/mercury/appeal/apply 返回「描述不能超过300字」
//
// 用法：
//   node src/tools/pdd-appeal-submit.js --store pdd02 --order 260923-063795392132914 \
//     --reason "消费者反馈商品空包/少件/漏件，但实际未少发" --amount 150 \
//     --text-file runtime/appeal/260923-063795392132914/申诉文案.txt \
//     --required a.png b.png c.png --optional d.png e.png        # 只填不交，留页给人看
//   加 --submit 才真实提交；加 --close-after 干完关页（不留给人工核对）。
const fs = require("fs");
const path = require("path");
const { resolveStore, projectPath } = require("../config/stores");
const { openStoreBrowser } = require("../engine/browser");
const { log } = require("../engine/log");
const { validateDescription, validateAmount, validateEvidence, APPEAL_ITEMS } = require("../lib/appealRules");

function parseArgs(argv) {
  const args = { store: "pdd02", reason: "", amount: null, required: [], optional: [], items: [...APPEAL_ITEMS], submit: false, closeAfter: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--submit") { args.submit = true; continue; }
    if (token === "--close-after") { args.closeAfter = true; continue; }
    if (token === "--store") { args.store = argv[i + 1]; i += 1; continue; }
    if (token === "--order") { args.order = argv[i + 1]; i += 1; continue; }
    if (token === "--reason") { args.reason = argv[i + 1]; i += 1; continue; }
    if (token === "--amount") { args.amount = argv[i + 1]; i += 1; continue; }
    if (token === "--text-file") { args.textFile = argv[i + 1]; i += 1; continue; }
    if (token === "--out-dir") { args.outDir = argv[i + 1]; i += 1; continue; }
    if (token === "--items") { args.items = String(argv[i + 1] || "").split(",").map((s) => s.trim()).filter(Boolean); i += 1; continue; }
    if (token === "--required" || token === "--optional") {
      const bucket = token === "--required" ? args.required : args.optional;
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) { bucket.push(argv[i + 1]); i += 1; }
      continue;
    }
  }
  return args;
}

function stamp() {
  const d = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function clickByText(page, text) {
  return page.evaluate((t) => {
    const vis = (e) => e && e.offsetParent !== null;
    const el = [...document.querySelectorAll("button,div,span,a,li")].find((e) => vis(e) && (e.innerText || "").trim() === t);
    if (!el) return false;
    el.click();
    return true;
  }, text);
}

async function visibleTexts(page) {
  return page.evaluate(() => [...new Set([...document.querySelectorAll("div,span,li,label")].filter((e) => e.offsetParent !== null && (e.innerText || "").trim()).map((e) => (e.innerText || "").trim()))]);
}

// 勾/取消勾某个申诉项（复选框文案就是申诉项名称）
async function setItemChecked(page, label, want) {
  return page.evaluate(({ label, want }) => {
    const vis = (e) => e && e.offsetParent !== null;
    const lbl = [...document.querySelectorAll("label,div")].filter(vis).find((e) => (e.innerText || "").trim() === label && e.querySelector("input[type=checkbox]"));
    if (!lbl) return null;
    const box = lbl.querySelector("input[type=checkbox]");
    if (box.checked !== want) lbl.click();
    return { before: box.checked, after: box.checked };
  }, { label, want });
}

// 给「货款申诉」这一段的申诉原因/金额 input 打标记，返回该段上限
async function markMoneySection(page, title) {
  return page.evaluate((title) => {
    const vis = (e) => e && e.offsetParent !== null;
    const 有请选择 = (e) => [...e.querySelectorAll("input")].some((i) => vis(i) && i.placeholder === "请选择");
    const 有请输入 = (e) => [...e.querySelectorAll("input")].some((i) => vis(i) && i.placeholder === "请输入");
    // 取「最小、且真的带 请选择+请输入 两个 input」的那一段（复选框那一行也叫 outerWrapper，必须排掉）
    const heads = [...document.querySelectorAll("div")]
      .filter((e) => vis(e) && /outerWrapper/.test(String(e.className)) && (e.innerText || "").trim().startsWith(title))
      .filter((e) => 有请选择(e) && 有请输入(e))
      .sort((a, b) => (a.innerText || "").length - (b.innerText || "").length);
    // 兜底（2026-09-30 实测：有的单弹窗是平铺布局，没有"以申诉项名开头"的段，但一定有「最多可申诉」提示）
    const 兜底 = () => [...document.querySelectorAll("div")]
      .filter((e) => vis(e) && 有请选择(e) && 有请输入(e) && /最多可申诉/.test(e.innerText || ""))
      .sort((a, b) => (a.innerText || "").length - (b.innerText || "").length)[0] || null;
    const scope = heads[0] || 兜底();
    if (!scope) return null;
    const inputs = [...scope.querySelectorAll("input")].filter(vis);
    const reason = inputs.find((i) => i.placeholder === "请选择");
    const amount = inputs.find((i) => i.placeholder === "请输入");
    if (!reason || !amount) return { ok: false, text: (scope.innerText || "").replace(/\s+/g, " ").slice(0, 200) };
    reason.setAttribute("data-appeal-reason", "1");
    amount.setAttribute("data-appeal-amount", "1");
    const max = /最多可申诉\s*([\d.]+)/.exec(scope.innerText || "");
    return { ok: true, maxAmount: max ? Number(max[1]) : null, text: (scope.innerText || "").replace(/\s+/g, " ").slice(0, 200) };
  }, title);
}

// 打开申诉原因下拉，枚举可见选项并选中目标；返回实际选项（选不到也返回，交给调用方报错）
async function selectReason(page, reason) {
  const before = new Set(await visibleTexts(page));
  await page.locator('input[data-appeal-reason="1"]').click({ timeout: 8000 });
  await page.waitForTimeout(1500);
  const after = await visibleTexts(page);
  const fresh = after.filter((t) => !before.has(t) && t.length <= 60);
  const known = after.filter((t) => /^(消费者|非以上)/.test(t) && t.length <= 60);
  const options = [...new Set([...fresh, ...known])];
  const clicked = await clickByText(page, reason);
  await page.waitForTimeout(1200);
  const value = await page.locator('input[data-appeal-reason="1"]').inputValue().catch(() => "");
  return { clicked, options, value };
}

// 找可见的「上传图片」入口；能爬到隐藏 file input 就记下来，没有就靠点击+filechooser 兜底
async function visibleUploadTargets(page) {
  const handle = await page.evaluateHandle(() => {
    const vis = (e) => e && e.offsetParent !== null;
    const texts = [...document.querySelectorAll("div,span")].filter((e) => vis(e) && (e.innerText || "").trim() === "上传图片");
    const out = [];
    for (const t of texts) {
      let node = t;
      let input = null;
      let scope = "";
      for (let i = 0; i < 16 && node; i += 1) {
        if (!input && node.querySelector) input = node.querySelector("input[type=file]");
        const txt = node.innerText || "";
        if (!scope && /(必填凭证|选填凭证)/.test(txt)) scope = /必填凭证/.test(txt) ? "required" : "optional";
        if (input && scope) break;
        node = node.parentElement;
      }
      out.push({ scope, input, click: t });
    }
    // 兜底：有的表单把「必填凭证」标签放在祖先链外，就按可见顺序认（第 1 个=必填，第 2 个=选填）
    out.forEach((item, index) => {
      if (!item.scope) item.scope = index === 0 ? "required" : index === 1 ? "optional" : "";
    });
    return out;
  });
  const list = [];
  const length = await handle.evaluate((a) => a.length);
  for (let i = 0; i < length; i += 1) {
    const entry = await handle.getProperty(String(i));
    const scope = await (await entry.getProperty("scope")).jsonValue();
    const clickEl = (await entry.getProperty("click")).asElement();
    const inputHandle = await entry.getProperty("input");
    const inputEl = inputHandle.asElement();
    list.push({ scope, clickEl, inputEl });
  }
  return list;
}

// 传文件：优先走人类路径（点可见「上传图片」→ 弹「本地上传」→ filechooser），不行再直传隐藏 input
async function uploadFiles(page, target, files) {
  const clickVisible = async () => {
    try {
      await target.clickEl.click({ timeout: 5000 });
      return true;
    } catch (error) {
      return page.evaluate((el) => { el.click(); return true; }, target.clickEl).catch(() => false);
    }
  };
  let chooser = page.waitForEvent("filechooser", { timeout: 4000 }).catch(() => null);
  await clickVisible();
  let picked = await chooser;
  if (!picked) {
    // 弹出的可能是「本地上传 / 图片空间上传」菜单
    const next = page.waitForEvent("filechooser", { timeout: 8000 });
    const clicked = await page.evaluate(() => {
      const vis = (e) => e && e.offsetParent !== null;
      const el = [...document.querySelectorAll("div,span,li,button,a")].find((e) => vis(e) && /^本地上传$/.test((e.innerText || "").trim()));
      if (el) el.click();
      return Boolean(el);
    });
    if (clicked) picked = await next.catch(() => null);
  }
  if (picked) {
    await picked.setFiles(files);
    return "chooser";
  }
  if (target.inputEl) {
    await target.inputEl.setInputFiles(files);
    return "input";
  }
  throw new Error("点了「上传图片」但没有出现文件选择/本地上传入口");
}

async function readFormState(page) {
  return page.evaluate(() => {
    const vis = (e) => e && e.offsetParent !== null;
    const reasonInput = document.querySelector('input[data-appeal-reason="1"]');
    const amountInput = document.querySelector('input[data-appeal-amount="1"]');
    // 申诉项勾选状态：只认「可见 label 文案 = 申诉项名」的那一个 checkbox（避免读到隐藏副本）
    const ITEM_NAMES = ["货款申诉", "运费申诉", "纠纷退款率申诉"];
    const findItemLabel = (name) => [...document.querySelectorAll("label")].filter(vis).find((l) => (l.innerText || "").trim() === name) || null;
    const checkedLabels = ITEM_NAMES.filter((name) => {
      const label = findItemLabel(name);
      const box = label ? label.querySelector('input[type=checkbox]') : null;
      return box ? box.checked : false;
    });
    // 2026-09-30 实测：有的单弹窗根本没有「申诉项」勾选框（单单只有“货款申诉”一个标签）→ 这种题型跳过勾选核对
    const itemCheckboxes = ITEM_NAMES.some((name) => {
      const label = findItemLabel(name);
      return !!(label && label.querySelector('input[type=checkbox]'));
    });
    const textarea = [...document.querySelectorAll("textarea")].filter(vis).find((t) => (t.placeholder || "").includes("请描述所涉及订单的基本情况")) || null;
    // 凭证计数：图片上传区里的缩略图（beast-sortable-item）个数；视频区靠“含 VideoUpload”排除
    // 注意：上传后 (n/3) 文案会消失、只剩预览图，所以不能靠文案计数
    const imageAreas = [...document.querySelectorAll('div[class*="UPD_list"]')]
      .filter((e) => vis(e) && !e.querySelector('[class*="VideoUpload"]'));
    const countUploaded = (area) => area.querySelectorAll('[class*="sortable-item"]').length;
    return {
      reason: reasonInput ? reasonInput.value : null,
      amount: amountInput ? amountInput.value : null,
      checkedLabels,
      itemCheckboxes,
      descriptionLength: textarea ? [...textarea.value].length : -1,
      requiredImages: imageAreas[0] ? countUploaded(imageAreas[0]) : null,
      optionalImages: imageAreas[1] ? countUploaded(imageAreas[1]) : null
    };
  });
}

async function waitForUploads(page, scope, expected, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await readFormState(page);
    const got = scope === "required" ? state.requiredImages : state.optionalImages;
    if (got === expected) return got;
    await page.waitForTimeout(1500);
  }
  const state = await readFormState(page);
  const got = scope === "required" ? state.requiredImages : state.optionalImages;
  throw new Error(`${scope === "required" ? "必填" : "选填"}凭证图片上传数不是 ${expected}（当前 ${got ?? "读不到"}）——大概率是传给了隐藏副本的 input`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.order || !args.textFile || !args.reason || args.amount == null) {
    throw new Error('用法：--store pdd02 --order <单号> --reason "<原因>" --amount 150 --text-file <文案.txt> --required <图...> [--optional <图...>] [--submit]');
  }
  // 本地先校验，不合格不碰浏览器
  const textFile = path.resolve(args.textFile);
  if (!fs.existsSync(textFile)) throw new Error(`文案文件不存在：${textFile}`);
  const description = fs.readFileSync(textFile, "utf8").trim();
  const descCheck = validateDescription(description);
  if (!descCheck.ok) throw new Error(descCheck.message);
  const amountCheck = validateAmount(args.amount);
  if (!amountCheck.ok) throw new Error(amountCheck.message);
  const requiredFiles = args.required.map((f) => path.resolve(f));
  const optionalFiles = args.optional.map((f) => path.resolve(f));
  for (const file of [...requiredFiles, ...optionalFiles]) if (!fs.existsSync(file)) throw new Error(`凭证文件不存在：${file}`);
  const evidenceCheck = validateEvidence(requiredFiles, optionalFiles);
  if (!evidenceCheck.ok) throw new Error(evidenceCheck.issues.join("；"));

  const store = resolveStore({ platform: "pdd", store: args.store });
  const outDir = args.outDir ? projectPath(args.outDir) : projectPath("runtime", "appeal", args.order);
  fs.mkdirSync(outDir, { recursive: true });
  log("申诉提交", "开始", `${store.key}（${store.name}）`, `${args.order}｜${args.submit ? "真实提交" : "dry-run 只填不交"}｜申诉项 ${args.items.join("+")}`);
  log("申诉提交", "本地校验", "通过", `${descCheck.message}；${amountCheck.message}`);

  const session = await openStoreBrowser({ profileDir: store.profileDir, targetUrl: "https://mms.pinduoduo.com/home", debugPort: store.port });
  const page = await session.context.newPage();
  const runLog = { orderSn: args.order, store: args.store, mode: args.submit ? "submit" : "dry-run", startedAt: new Date().toISOString() };
  try {
    await page.goto("https://mms.pinduoduo.com/orders/appeals/aftersale/order", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(7000);
    if (page.url().includes("/login/")) throw new Error(`登录态失效，先跑 node src/tools/pdd-login.js --store ${args.store}`);

    const search = page.locator('input[placeholder="请输入"]').first();
    await search.fill(args.order);
    await search.press("Enter");
    await page.waitForTimeout(5000);
    const rowText = await page.evaluate((sn) => {
      const vis = (e) => e && e.offsetParent !== null;
      const row = [...document.querySelectorAll("tr,div")].filter((el) => vis(el) && (el.innerText || "").includes(sn) && (el.innerText || "").includes("发起申诉")).sort((a, b) => (a.innerText || "").length - (b.innerText || "").length)[0];
      return row ? row.innerText.replace(/\s+/g, " ").slice(0, 400) : "";
    }, args.order);
    if (!rowText) throw new Error(`该单不在「可申诉订单」里（可能已申诉/超期/不可申诉），页面搜不到：${args.order}`);
    log("申诉提交", "命中可申诉单", rowText.slice(0, 160));
    if (!(await clickByText(page, "发起申诉"))) throw new Error("没找到「发起申诉」按钮");
    await page.waitForTimeout(6000);

    // 申诉项：只保留要办的（默认货款+纠纷退款率），其余取消勾选（勾了不填提交会校验失败）
    const itemNames = ["货款申诉", "运费申诉", "纠纷退款率申诉"];
    for (const name of itemNames) {
      const want = args.items.includes(name);
      const result = await setItemChecked(page, name, want);
      if (result === null) continue; // 该单没有这一项
      log("申诉提交", "申诉项", `${name} ${want ? "勾选" : "取消"}`);
    }
    await page.waitForTimeout(1500);

    // 涉钱申诉项（默认货款申诉）的申诉原因 + 金额
    const title = args.items[0];
    const section = await markMoneySection(page, title);
    if (!section?.ok) throw new Error(`${title} 表单段没找到（页面结构可能变了）：${section?.text || "无"}`);
    log("申诉提交", "金额上限", `${title} 最多可申诉 ${section.maxAmount ?? "?"} 元`);
    const maxCheck = validateAmount(args.amount, section.maxAmount);
    runLog.maxAmount = section.maxAmount;
    if (!maxCheck.ok) throw new Error(maxCheck.message);

    const reasonResult = await selectReason(page, args.reason);
    runLog.reasonOptions = reasonResult.options;
    if (!reasonResult.clicked || reasonResult.value !== args.reason) {
      throw new Error(`申诉原因选不上：「${args.reason}」\n    本单页面实际可选项（随订单场景变化，别硬套）：\n    - ${reasonResult.options.join("\n    - ")}`);
    }
    log("申诉提交", "申诉原因", "已选", args.reason);

    await page.locator('input[data-appeal-amount="1"]').fill(String(args.amount));
    await page.waitForTimeout(600);

    const uploads = await visibleUploadTargets(page);
    const requiredTarget = uploads.find((u) => u.scope === "required");
    const optionalTarget = uploads.find((u) => u.scope === "optional");
    if (requiredFiles.length) {
      if (!requiredTarget) throw new Error("没找到必填凭证的「上传图片」入口");
      const via = await uploadFiles(page, requiredTarget, requiredFiles);
      log("申诉提交", "必填凭证", `传了 ${requiredFiles.length} 张（${via}）`);
      await waitForUploads(page, "required", requiredFiles.length);
    }
    if (optionalFiles.length) {
      if (!optionalTarget) throw new Error("没找到选填凭证的「上传图片」入口");
      const via = await uploadFiles(page, optionalTarget, optionalFiles);
      log("申诉提交", "选填凭证", `传了 ${optionalFiles.length} 张（${via}）`);
      await waitForUploads(page, "optional", optionalFiles.length);
    }

    const textarea = page.locator('textarea[placeholder^="请描述所涉及订单的基本情况"]').last();
    await textarea.fill(description);
    await page.waitForTimeout(1200);

    const state = await readFormState(page);
    runLog.formState = { ...state };
    const screenshot = path.join(outDir, `${args.submit ? "提交" : "待提交"}-${stamp()}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    runLog.screenshot = path.relative(projectPath(), screenshot);
    const problems = [];
    if (state.reason !== args.reason) problems.push(`申诉原因不是「${args.reason}」（读到「${state.reason}」）`);
    if (String(state.amount) !== String(args.amount)) problems.push(`金额不是 ${args.amount}（读到 ${state.amount}）`);
    if (state.descriptionLength !== descCheck.length) problems.push(`描述字数不是 ${descCheck.length}（读到 ${state.descriptionLength}）`);
    for (const name of args.items) if (state.itemCheckboxes && itemNames.includes(name) && !state.checkedLabels.includes(name)) problems.push(`申诉项没勾：${name}`);
    for (const name of itemNames) if (state.itemCheckboxes && !args.items.includes(name) && state.checkedLabels.includes(name)) problems.push(`申诉项没取消：${name}`);
    if (requiredFiles.length && state.requiredImages !== requiredFiles.length) problems.push(`必填凭证 ${state.requiredImages}/${requiredFiles.length}`);
    if (optionalFiles.length && state.optionalImages !== optionalFiles.length) problems.push(`选填凭证 ${state.optionalImages}/${optionalFiles.length}`);
    if (problems.length) {
      runLog.problems = problems;
      fs.writeFileSync(path.join(outDir, `运行记录-${stamp()}.json`), JSON.stringify(runLog, null, 2), "utf8");
      throw new Error(`表单核对不通过：\n    - ${problems.join("\n    - ")}`);
    }
    log("申诉提交", "表单核对", "通过", `原因/金额/凭证/描述(${state.descriptionLength}字) 全部一致`);

    if (!args.submit) {
      runLog.finishedAt = new Date().toISOString();
      fs.writeFileSync(path.join(outDir, `运行记录-${stamp()}.json`), JSON.stringify(runLog, null, 2), "utf8");
      console.log(`\n  ✅ dry-run：表单已填好**未提交**${args.closeAfter ? "，按要求已关页" : "，页面保持打开"} ${args.order}`);
      console.log(args.closeAfter ? `     人工核对看截图：${runLog.screenshot}` : `     人工核对后可加 --submit 重跑，或直接在页面上点「提交申诉」。`);
      console.log(`     截图：${runLog.screenshot}\n`);
      return;
    }

    // 真实提交（用户已批准才走到这里）
    const applyResult = { value: null };
    page.on("response", async (resp) => {
      if (/mercury\/appeal\/apply/.test(resp.url())) {
        try { applyResult.value = { status: resp.status(), body: await resp.json() }; } catch (error) { applyResult.value = { status: resp.status(), error: error.message }; }
      }
    });
    if (!(await clickByText(page, "提交申诉"))) throw new Error("没找到「提交申诉」按钮");
    await page.waitForTimeout(8000);
    const body = applyResult.value?.body;
    runLog.finishedAt = new Date().toISOString();
    runLog.applyResponse = body || applyResult.value;
    fs.writeFileSync(path.join(outDir, `提交结果-${stamp()}.json`), JSON.stringify(runLog, null, 2), "utf8");
    if (!body) throw new Error("点了提交但没抓到 /mercury/appeal/apply 响应，请人工打开页面确认");
    if (body.success !== true) throw new Error(`提交失败：${body.errorCode} ${body.errorMsg || ""}（截图/运行记录已存 ${path.relative(projectPath(), outDir)}）`);
    console.log(`\n  ✅ 提交成功：订单 ${body.result.orderSn}｜appealId ${body.result.appealId}`);
    for (const sub of body.result.subAppealApplyResponses || []) console.log(`     · 子申诉 ${sub.subAppealId}（类型码 ${sub.appealSubTypeCode}）`);
    console.log(`     运行记录/截图：${path.relative(projectPath(), outDir)}\n`);
  } catch (error) {
    try {
      const shot = path.join(outDir, `失败-${stamp()}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      console.error(`  （失败现场截图：${path.relative(projectPath(), shot)}）`);
    } catch (shotError) { /* 截图失败不掩盖原错误 */ }
    throw error;
  } finally {
    if (args.closeAfter) await page.close().catch(() => {});
  }
}

main().then(() => process.exit(0)).catch((error) => { console.error(`\n  失败：${error.message}\n`); process.exit(1); });
