// 一次性只读检查：给定订单号列表，问诺诺要发票文件。
// 只下载发票到本地下载中心索引；不打开任何平台后台，不上传、不提交、不改订单状态。
// 用法：node .codex-temporary/检查诺诺发票.js <订单号...>
const fs = require('fs');
const path = require('path');
const { 批量下载发票 } = require(path.resolve(__dirname, '..', '3.通用发票下载中心/src/index'));

const 订单号列表 = process.argv.slice(2).map((s) => String(s).trim()).filter(Boolean);
if (!订单号列表.length) {
  console.error('用法：node .codex-temporary/检查诺诺发票.js <订单号...>');
  process.exit(2);
}

(async () => {
  const 开始 = Date.now();
  const 已有 = [];
  const 没有 = [];
  const 错误 = [];
  console.log(`共 ${订单号列表.length} 个订单号，开始向诺诺查询……`);
  try {
    const 结果 = await 批量下载发票({ orderNumbers: 订单号列表 }, { headless: true });
    const 映射 = new Map((Array.isArray(结果) ? 结果 : []).map((x) => [String(x.orderNumber), x]));
    for (const 单号 of 订单号列表) {
      const 项 = 映射.get(单号);
      if (项 && 项.invoiceFilePath) {
        已有.push({ 单号, 文件: 项.invoiceFilePath, 发票号: 项.invoiceNumber || '' });
        console.log(`[已有] ${单号} -> ${项.invoiceFilePath}`);
      } else {
        没有.push(单号);
        console.log(`[没有] ${单号}`);
      }
    }
  } catch (错误对象) {
    if (错误对象 && 错误对象.code === 'INVOICE_NOT_FOUND_IN_NUONUO') {
      const 缺失 = new Set((错误对象.missingOrders || []).map((x) => String(x.orderNumber || x)));
      const 已找 = new Map((错误对象.localFiles || []).map((x) => [String(x.orderNumber), x]));
      for (const 单号 of 订单号列表) {
        if (已找.has(单号)) {
          已有.push({ 单号, 文件: 已找.get(单号).invoiceFilePath });
          console.log(`[已有] ${单号} -> ${已找.get(单号).invoiceFilePath}`);
        } else if (缺失.has(单号)) {
          没有.push(单号);
          console.log(`[没有] ${单号}`);
        } else {
          错误.push({ 单号, 错误: '未在结果中出现' });
          console.log(`[未知] ${单号}`);
        }
      }
    } else {
      for (const 单号 of 订单号列表) 错误.push({ 单号, 错误: String(错误对象 && 错误对象.message || 错误对象) });
      console.log(`[整体失败] ${String(错误对象 && 错误对象.message || 错误对象)}`);
    }
  }
  const 报告 = {
    时间: new Date().toLocaleString('zh-CN', { hour12: false }),
    耗时秒: Math.round((Date.now() - 开始) / 1000),
    总数: 订单号列表.length,
    已有: 已有.length,
    没有: 没有.length,
    错误: 错误.length,
    已有明细: 已有,
    没有明细: 没有,
    错误明细: 错误,
  };
  const 输出路径 = path.join(__dirname, '诺诺发票检查结果.json');
  fs.writeFileSync(输出路径, JSON.stringify(报告, null, 2), 'utf8');
  console.log(`\n汇总：已有 ${已有.length}｜没有 ${没有.length}｜错误 ${错误.length}｜耗时 ${报告.耗时秒}s`);
  console.log(`结果已写入 ${输出路径}`);
  process.exit(错误.length ? 1 : 0);
})();
