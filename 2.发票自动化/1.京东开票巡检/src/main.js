const { 打印日志 } = require('./common/logger');
const { 执行巡检 } = require('./app/checkInvoices');

function 解析启动模式() {
  // 解决：统一约束脚本启动模式，避免入口参数混乱。
  const 模式 = process.argv[2] || 'start';
  if (['start', 'check'].includes(模式)) {
    return 模式;
  }
  throw new Error('启动参数错误，请使用 start 或 check。');
}

async function main() {
  // 解决：让所有启动模式都走同一主程序调度，避免脚本入口分叉。
  const 模式 = 解析启动模式();
  打印日志('启动流程', '主程序', `当前模式=${模式}`);

  if (模式 === 'start') {
    await 执行巡检({
      headless: false,
      允许人工登录: true,
      巡检后保持页面打开: true,
      启用运行目录膨胀守卫: true,
    });
    return;
  }

  if (模式 === 'check') {
    await 执行巡检({
      headless: false,
      允许人工登录: false,
      登录失效自动转人工: true,
      巡检后保持页面打开: true,
      启用运行目录膨胀守卫: true,
    });
    return;
  }
}

main().catch((错误) => {
  打印日志('启动失败', '主程序', 错误.message);
  process.exitCode = 1;
});
