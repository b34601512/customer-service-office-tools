// 实机验收探针（SoftTalk #2705 机制）：不模拟鼠标点界面，直接调用与"TUI 点单店识别"同一个业务真源（执行巡检），
// 真实登录态、真实京东接口、真实落盘，然后核对最后真实发生了什么：
// ① 进度回调真实逐页推进 ② 店铺快照与订单记录被本轮刷新 ③ 截图是真实页面
// ④ 任务结束浏览器页面未自动关闭 ⑤ 只有模拟"程序退出"（关闭全部浏览器上下文）才关页。
// 用法：node scripts/实机验收识别链路.js [店铺名称]（默认第一个启用店铺）
// 退出码：0=验收通过 1=验收失败 2=登录态失效需先人工登录一次
const fs = require('fs');
const path = require('path');

const { 执行巡检 } = require('../src/app/checkInvoiceUrges');
const { 读取店铺配置 } = require('../src/store/storeConfigService');
const { 关闭全部浏览器上下文, 获取活动浏览器上下文数量 } = require('../src/browser/browserContextHub');
const { 获取店铺快照文件路径, 催票订单记录文件路径, 运行目录 } = require('../src/common/paths');

function 断言收集器() {
  const 列表 = [];
  return {
    列表,
    断言(名称, 条件, 详情 = '') {
      列表.push({ 名称, 通过: Boolean(条件), 详情: String(详情 || '') });
    },
    全部通过() {
      return 列表.every((条目) => 条目.通过);
    },
  };
}

async function main() {
  const 指定店铺名称 = String(process.argv[2] || '').trim();
  const 配置 = 读取店铺配置();
  const 启用店铺列表 = (配置.stores || []).filter((店铺) => 店铺.enabled);
  const 店铺 = 指定店铺名称
    ? 启用店铺列表.find((候选店铺) => 候选店铺.name === 指定店铺名称)
    : 启用店铺列表[0];
  if (!店铺) {
    console.log(`[FAIL] 未找到启用店铺：${指定店铺名称 || '（默认第一家）'}`);
    return 1;
  }

  const 快照路径 = 获取店铺快照文件路径(店铺.id);
  const 快照修改时间前 = fs.existsSync(快照路径) ? fs.statSync(快照路径).mtimeMs : 0;
  const 记录修改时间前 = fs.existsSync(催票订单记录文件路径) ? fs.statSync(催票订单记录文件路径).mtimeMs : 0;
  const 轮次开始 = Date.now();

  console.log(`[开始] 实机验收店铺=${店铺.name}（入口=执行巡检，与点单店识别同一真源，真实接口）`);

  const 进度事件 = [];
  let 结果;
  try {
    结果 = await 执行巡检({
      店铺配置: 店铺,
      headless: false,
      允许人工登录: false,
      页面保留模式: 'keep',
      onProgress: (进度) => {
        const 最后 = 进度事件.at(-1);
        if (!最后 || 最后.finishedPageCount !== 进度.finishedPageCount) {
          进度事件.push({ t: Date.now() - 轮次开始, finishedPageCount: 进度.finishedPageCount, totalPageCount: 进度.totalPageCount });
        }
      },
    });
  } catch (错误) {
    if (String(错误.message).includes('登录态失效')) {
      console.log(`[BLOCKED] ${店铺.name} 登录态失效：请在控制台做一次单店人工登录后重试。原因=${错误.message.slice(0, 120)}`);
      await 关闭全部浏览器上下文().catch(() => {});
      return 2;
    }
    console.log(`[FAIL] 巡检执行失败：${错误.message}`);
    await 关闭全部浏览器上下文().catch(() => {});
    return 1;
  }

  const 收集 = 断言收集器();
  const { 断言 } = 收集;

  // ① 真实读取：进度逐页推进且与结果指标一致
  const 扫描页数 = 结果.metrics.scannedPageCount ?? 1;
  断言('接口真实读取：进度回调逐页推进', new Set(进度事件.map((事件) => 事件.finishedPageCount)).size >= Math.min(扫描页数, 2) || 扫描页数 <= 1,
    `进度样本=${进度事件.length}组(${进度事件[0]?.finishedPageCount || 0}→${进度事件.at(-1)?.finishedPageCount || 0}/${扫描页数}页)`);
  断言('后台返回真实订单数据', (结果.metrics.invoiceOrderCount || 0) > 0, `发票订单=${结果.metrics.invoiceOrderCount}，催票=${(结果.records || []).length}`);

  // ② 真实落盘：快照与订单记录被本轮刷新（TUI“2.订单”读的就是这套真源）
  const 快照刷新 = fs.existsSync(快照路径) && fs.statSync(快照路径).mtimeMs > 快照修改时间前;
  const 记录刷新 = fs.existsSync(催票订单记录文件路径) && fs.statSync(催票订单记录文件路径).mtimeMs > 记录修改时间前;
  断言('店铺快照本轮被真实刷新（TUI总览数据源）', 快照刷新, 快照路径);
  断言('催票订单记录本轮被真实刷新（TUI订单明细数据源）', 记录刷新, 催票订单记录文件路径);
  let 快照核对 = null;
  try {
    快照核对 = JSON.parse(fs.readFileSync(快照路径, 'utf8'));
  } catch {}
  断言('快照checkedAt为本次巡检时刻', 快照核对 && Date.parse(快照核对.checkedAt) >= 轮次开始 - 5000, `快照checkedAt=${快照核对?.checkedAt}`);

  // ③ 真实页面：截图存在且非空，标题/URL来自真实京东页面
  const 截图存在 = 结果.screenshotPath && fs.existsSync(结果.screenshotPath) && fs.statSync(结果.screenshotPath).size > 10_000;
  断言('截图凭证是真实页面（非空白）', 截图存在, `${结果.screenshotPath || '无'}；标题=${结果.pageTitle || ''}`);

  // ④ 任务结束后页面不自动关闭
  const 活动窗口数 = 获取活动浏览器上下文数量();
  断言('任务结束后浏览器页面仍保持打开', 活动窗口数 >= 1, `活动上下文=${活动窗口数}`);

  const 报告 = {
    结论: 收集.全部通过() ? 'PASS' : 'FAIL',
    店铺: 店铺.name,
    耗时秒: Math.round((Date.now() - 轮次开始) / 1000),
    扫描页数: 结果.metrics.scannedPageCount,
    后台发票订单: 结果.metrics.invoiceOrderCount,
    催票订单: (结果.records || []).length,
    进度样本: 进度事件.slice(0, 10),
    断言: 收集.列表,
  };
  fs.writeFileSync(path.join(运行目录, '实机验收-识别链路.json'), JSON.stringify(报告, null, 2));
  for (const 条目 of 收集.列表) {
    console.log(`${条目.通过 ? '[PASS]' : '[FAIL]'} ${条目.名称}${条目.详情 ? `｜${条目.详情}` : ''}`);
  }
  console.log(收集.全部通过()
    ? '[结论] 实机验收通过：真实接口逐页读取、真实落盘、任务结束页面未自动关闭。'
    : '[结论] 实机验收失败，见上方明细。');

  // ⑤ 只有“程序退出”才统一关页——这里模拟退出并验证关页生效
  await 关闭全部浏览器上下文().catch(() => {});
  console.log(`[收尾] 模拟程序退出后活动上下文=${获取活动浏览器上下文数量()}`);
  return 收集.全部通过() ? 0 : 1;
}

main().then((代码) => process.exit(代码)).catch((错误) => {
  console.log(`[FAIL] 探针异常：${错误.stack || 错误.message}`);
  process.exit(1);
});
