// 回传“下载中心（诺诺）已确认有发票文件”的待回传订单。
// 数据来源：先跑 .codex-temporary/检查诺诺发票.js 生成 .codex-temporary/诺诺发票检查结果.json。
// 用法：
//   node scripts/回传已开发票.js                    # 回传全部平台
//   node scripts/回传已开发票.js --平台=tmall,douyin
// 说明：正式回传会真实提交发票（用户已授权口令 161323）；本脚本只把诺诺已有发票的订单送进平台流程，
//       没有发票的订单不会被上传，天猫「待同意」单也不会被点同意（回传只找“录入发票”入口）。
const fs = require('fs');
const path = require('path');

const 项目根 = path.resolve(__dirname, '..');
const 检查结果路径 = path.join(项目根, '.codex-temporary', '诺诺发票检查结果.json');

const 参数 = process.argv.slice(2);
const 平台参数项 = 参数.find((项) => 项.startsWith('--平台='));
const 只跑平台 = 平台参数项 ? 平台参数项.slice('--平台='.length) : (参数.includes('--平台') ? String(参数[参数.indexOf('--平台') + 1] || '') : '');

function 读取已有订单号() {
  if (!fs.existsSync(检查结果路径)) {
    throw new Error(`缺少诺诺检查结果：${检查结果路径}（先跑 .codex-temporary/检查诺诺发票.js）`);
  }
  const 报告 = JSON.parse(fs.readFileSync(检查结果路径, 'utf8'));
  const 明细 = Array.isArray(报告.已有明细) ? 报告.已有明细 : [];
  return new Set(明细.map((项) => String(项.单号 || 项.orderNumber || '').trim()).filter(Boolean));
}

const 回传平台配置 = {
  tmall: {
    名称: '天猫',
    目录: '4.天猫发票回传',
    回传模块: 'src/app/returnInvoiceToTmall',
    回传函数: '执行天猫发票正式回传',
    订单模块: 'src/order/tmallOrderRecordStore',
    要求已登记: false,
  },
  pdd: {
    名称: '拼多多',
    目录: '5.拼多多发票回传',
    回传模块: 'src/app/returnInvoiceToPdd',
    回传函数: '执行拼多多发票正式回传',
    订单模块: 'src/order/pddOrderRecordStore',
    要求已登记: false,
  },
  douyin: {
    名称: '抖音',
    目录: '6.抖音发票回传',
    回传模块: 'src/app/returnInvoiceToDouyin',
    回传函数: '执行抖音发票正式回传',
    订单模块: 'src/order/douyinOrderRecordStore',
    要求已登记: false,
  },
};

function 打印进度(前缀, 进度 = {}) {
  const 文本 = String(进度.message || 进度.status || '').trim();
  if (!文本) return;
  console.log(`   [进度]${前缀}${进度.orderNumber ? ' ' + 进度.orderNumber : ''} ${文本}`);
}

async function 回传一个平台(key, 已有订单号) {
  const 配置 = 回传平台配置[key];
  const 目录 = path.join(项目根, 配置.目录);
  const 店铺服务 = require(path.join(目录, 'src/store/storeConfigService'));
  const 订单服务 = require(path.join(目录, 配置.订单模块));
  const 回传服务 = require(path.join(目录, 配置.回传模块));
  const 订单列表 = 订单服务.读取订单列表().filter((订单) => 已有订单号.has(String(订单.orderNumber || '').trim()));
  if (!订单列表.length) {
    console.log(`[${配置.名称}] 没有已开发票的待回传订单，跳过。`);
    return [];
  }
  const 店铺列表 = 店铺服务.获取启用店铺列表();
  const 结果 = [];
  for (const 店铺 of 店铺列表) {
    const 本店订单 = 订单列表.filter((订单) => String(订单.storeId || '') === String(店铺.id || ''));
    if (!本店订单.length) continue;
    console.log(`\n[${配置.名称}] ${店铺.name}：已开发票 ${本店订单.length} 单，开始正式回传`);
    本店订单.forEach((订单) => console.log(`   - ${订单.orderNumber}｜${订单.invoiceTitle || '(无抬头)'}｜${订单.invoiceAmount || ''}`));
    try {
      const 回传结果 = await 回传服务[配置.回传函数]({
        店铺配置: 店铺,
        orders: 本店订单,
        headless: false,
        要求已登记: 配置.要求已登记,
        onProgress: (进度) => 打印进度(`[${配置.名称}]`, 进度),
      });
      结果.push({ 平台: 配置.名称, 店铺: 店铺.name, 状态: '完成', 汇总: 回传结果?.message || '' });
    } catch (错误) {
      console.error(`[${配置.名称}] ${店铺.name} 回传失败：${错误 && 错误.message}`);
      结果.push({ 平台: 配置.名称, 店铺: 店铺.name, 状态: '失败：' + (错误 && 错误.message) });
    }
  }
  return 结果;
}

async function 回传京东(已有订单号) {
  const 目录 = path.join(项目根, '2.京东发票回传');
  const 店铺服务 = require(path.join(目录, 'src/store/storeConfigService'));
  const { 读取订单记录, 记录转列表 } = require(path.join(目录, 'src/order/jdOrderRecordStore'));
  const { 执行批量发票回传 } = require(path.join(目录, 'src/app/returnInvoiceToJd'));
  const 订单列表 = 记录转列表(读取订单记录()).filter((订单) => 已有订单号.has(String(订单.orderNumber || '').trim()));
  if (!订单列表.length) {
    console.log('[京东] 没有已开发票的待回传订单，跳过。');
    return [];
  }
  const 店铺列表 = 店铺服务.获取启用店铺列表();
  console.log(`\n[京东] 已开发票 ${订单列表.length} 单，开始正式回传`);
  订单列表.forEach((订单) => console.log(`   - ${订单.orderNumber}｜${订单.storeName || order_storeName(订单)}｜${订单.invoiceAmount || ''}`));
  try {
    const 回传结果 = await 执行批量发票回传({
      orders: 订单列表,
      stores: 店铺列表,
      headless: false,
      onProgress: (进度) => 打印进度('[京东]', 进度),
    });
    return [{ 平台: '京东', 店铺: '（按订单所属店铺）', 状态: '完成', 汇总: 回传结果?.message || '' }];
  } catch (错误) {
    console.error(`[京东] 回传失败：${错误 && 错误.message}`);
    return [{ 平台: '京东', 店铺: '（按订单所属店铺）', 状态: '失败：' + (错误 && 错误.message) }];
  }
}

function order_storeName(订单) {
  return 订单.storeName || '';
}

async function main() {
  const 已有订单号 = 读取已有订单号();
  console.log(`诺诺已有发票订单 ${已有订单号.size} 个：${[...已有订单号].join('、') || '（无）'}`);
  if (!已有订单号.size) {
    console.log('没有已开发票的订单，无需回传。');
    return;
  }
  const 平台键列表 = (只跑平台 ? 只跑平台.split(',') : Object.keys(回传平台配置)).map((项) => 项.trim()).filter(Boolean);
  const 汇总 = [];
  for (const key of 平台键列表) {
    if (!回传平台配置[key]) throw new Error(`未知平台：${key}`);
    汇总.push(...await 回传一个平台(key, 已有订单号));
  }
  if (!只跑平台 || 只跑平台.split(',').map((项) => 项.trim()).includes('jd')) {
    汇总.push(...await 回传京东(已有订单号));
  }
  console.log('\n===== 回传汇总 =====');
  汇总.forEach((项) => console.log(`${项.平台}｜${项.店铺}｜${项.状态}${项.汇总 ? '｜' + 项.汇总 : ''}`));
  const 失败 = 汇总.filter((项) => 项.状态 !== '完成');
  console.log(`回传店铺 ${汇总.length} 家，失败 ${失败.length} 家`);
  process.exit(失败.length ? 1 : 0);
}

if (require.main === module) {
  main().catch((错误) => {
    console.error('回传脚本异常终止：', (错误 && 错误.stack) || 错误);
    process.exit(1);
  });
}

module.exports = { 读取已有订单号, 回传平台配置 };
