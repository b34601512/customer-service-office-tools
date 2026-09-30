// 店铺身份校验（抖音共享账号专用，2026-09-22 根因修复）。
//
// 事故：抖音两店共用一个 profile，`probe-page --store douyin5` 打开的窗口**停在上次那家店**，
// 于是 douyin5 的概览读到的全是 douyin3 的数字（两店计数完全相同、服务体验分同为 84 才露馅），
// 等于 douyin5 当天根本没查 → 典型假阴性。
//
// 规矩：**页面店名与目标店名不一致、或读不到页面店名 → 不许下“无漏/有漏”结论**，退出码非 0。
function 校验当前店(目标店名, 页面店名) {
  const 目标 = String(目标店名 || "").trim();
  const 当前 = String(页面店名 || "").trim();
  if (!当前) {
    return {
      ok: false, 需人工: true,
      理由: "读不到页面店名（class 含 headerShopName 的头部元素），无法确认当前窗口是哪家店——不许当目标店下结论"
    };
  }
  if (当前 !== 目标) {
    return {
      ok: false, 需人工: false,
      理由: `窗口当前是「${当前}」，不是目标店「${目标}」——抖音共享账号必须先切店（切店 5 步见 经验/抖音售后后台-采集.md 第五节）`
    };
  }
  return { ok: true, 需人工: false, 理由: "" };
}

// 取店名：头部元素的文本可能是多行（店名⏎旗舰店⏎正常营业），真正的店名在第一行。
function 取店名(文本) {
  return String(文本 || "").trim().split(/\r?\n/)[0].trim();
}

// 读页面店名（2026-09-30 根因修复）：抖店用 CSS modules，真实 class 形如 `index_headerShopName__2wP1V`
//   （哈希会随发版变，精确选择器 `.headerShopName` 会静默失配）→ 用「class 包含 headerShopName」匹配。
async function 读页面店名(page) {
  const 文本 = await page.evaluate(() => {
    const el = document.querySelector('[class*="headerShopName"]') || document.querySelector('[class*="ShopName"]');
    return el ? (el.innerText || el.textContent || "") : "";
  });
  return 取店名(文本);
}

module.exports = { 校验当前店, 取店名, 读页面店名 };
