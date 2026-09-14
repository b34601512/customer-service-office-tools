// 京东催票只读巡检（只识别催票记录并落库，不回传发票、不提交）。
// 用法：node .codex-temporary/jd-readonly-check.js [storeId]
const path = require('path');
const projectRoot = path.resolve(__dirname, '..');
const base = path.join(projectRoot, '2.京东发票回传');

const 店铺服务 = require(path.join(base, 'src/store/storeConfigService'));
const { 执行巡检 } = require(path.join(base, 'src/app/checkInvoiceUrges'));

async function main() {
  const 只跑店铺 = process.argv[2] || '';
  const 原始 = 店铺服务.读取店铺配置();
  const 全部 = (Array.isArray(原始) ? 原始 : (原始.stores || [])).filter((s) => s.enabled !== false);
  const 店铺列表 = 只跑店铺 ? 全部.filter((s) => s.id === 只跑店铺) : 全部;
  console.log(`===== 京东催票只读巡检：${店铺列表.length} 家店铺 =====`);
  for (const 店铺 of 店铺列表) {
    console.log(`\n--- [京东] ${店铺.name} 开始只读巡检 ---`);
    try {
      // headless:false —— 京东按设计固定可见窗口。
      const 结果 = await 执行巡检({
        店铺配置: 店铺,
        headless: false,
        允许人工登录: false,
        巡检后保持页面打开: false,
      });
      console.log(`[京东] ${店铺.name} 巡检完成：` + JSON.stringify(结果 && (结果.摘要 || 结果.summary || 结果)).slice(0, 400));
    } catch (错误) {
      console.log(`[京东] ${店铺.name} 巡检失败：${错误 && 错误.message}`);
    }
  }
  process.exit(0);
}

main().catch((e) => { console.error('京东只读巡检异常：', e && e.stack || e); process.exit(1); });
