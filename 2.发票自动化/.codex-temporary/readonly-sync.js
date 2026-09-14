// 只读同步各平台待回传订单（不下载发票、不上传、不提交）。
// 用法：node .codex-temporary/readonly-sync.js [tmall|pdd|douyin|all] [storeId]
const path = require('path');
const projectRoot = path.resolve(__dirname, '..');

const 平台配置 = {
  tmall: {
    label: '天猫',
    目录: '4.天猫发票回传',
    店铺模块: './src/store/storeConfigService',
    同步模块: './src/app/syncPendingOrders',
    同步函数: '同步天猫待处理订单',
  },
  pdd: {
    label: '拼多多',
    目录: '5.拼多多发票回传',
    店铺模块: './src/store/storeConfigService',
    同步模块: './src/app/syncPendingOrders',
    同步函数: '同步拼多多待处理订单',
  },
  douyin: {
    label: '抖音',
    目录: '6.抖音发票回传',
    店铺模块: './src/store/storeConfigService',
    同步模块: './src/app/syncPendingOrders',
    同步函数: '同步抖音待处理订单',
  },
};

function 加载平台(key) {
  const 配置 = 平台配置[key];
  const base = path.join(projectRoot, 配置.目录);
  const 店铺服务 = require(path.join(base, 配置.店铺模块));
  const 同步服务 = require(path.join(base, 配置.同步模块));
  return { 配置, 店铺服务, 同步服务, base };
}

async function 同步一个平台(key, 只跑店铺) {
  const { 配置, 店铺服务, 同步服务, base } = 加载平台(key);
  const 原始配置 = 店铺服务.读取店铺配置();
  const 全部店铺 = (Array.isArray(原始配置) ? 原始配置 : (原始配置.stores || [])).filter((s) => s.enabled !== false);
  const 店铺列表 = 只跑店铺 ? 全部店铺.filter((s) => s.id === 只跑店铺) : 全部店铺;
  console.log(`\n===== ${配置.label}：只读同步 ${店铺列表.length} 家店铺 =====`);
  const 结果汇总 = [];
  for (const 店铺 of 店铺列表) {
    console.log(`\n--- [${配置.label}] ${店铺.name}（${店铺.id}）开始只读同步 ---`);
    try {
      // headless:false —— 用户要求可见执行，能看到浏览器窗口。
      const 结果 = await 同步服务[配置.同步函数]({ 店铺配置: 店铺, headless: false });
      console.log(`[${配置.label}] ${店铺.name} 读取 ${结果.orderCount} 单（新增 ${结果.addedCount}，更新 ${结果.updatedCount}）`);
      if (结果.warning) console.log(`[${配置.label}] ${店铺.name} 警告：${结果.warning}`);
      结果汇总.push({ 平台: 配置.label, 店铺: 店铺.name, 读取: 结果.orderCount, 新增: 结果.addedCount, 更新: 结果.updatedCount, 状态: '成功' });
    } catch (错误) {
      console.log(`[${配置.label}] ${店铺.name} 只读同步失败：${错误 && 错误.message}`);
      结果汇总.push({ 平台: 配置.label, 店铺: 店铺.name, 读取: 0, 新增: 0, 更新: 0, 状态: '失败：' + (错误 && 错误.message) });
    }
  }
  return 结果汇总;
}

async function main() {
  const 参数 = process.argv.slice(2);
  const 目标 = 参数[0] || 'all';
  const 只跑店铺 = 参数[1] || '';
  const 平台键 = 目标 === 'all' ? Object.keys(平台配置) : [目标];
  const 汇总 = [];
  for (const key of 平台键) {
    if (!平台配置[key]) throw new Error('未知平台：' + key);
    汇总.push(...await 同步一个平台(key, 只跑店铺));
  }
  console.log('\n===== 只读同步汇总 =====');
  for (const 行 of 汇总) {
    console.log(`${行.平台}｜${行.店铺}｜读取 ${行.读取} 单（新增 ${行.新增}，更新 ${行.更新}）｜${行.状态}`);
  }
  process.exit(0);
}

main().catch((错误) => {
  console.error('只读同步异常终止：', 错误 && 错误.stack || 错误);
  process.exit(1);
});
