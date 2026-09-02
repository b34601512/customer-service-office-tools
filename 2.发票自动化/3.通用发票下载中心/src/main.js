const { 启动命令行菜单 } = require('./cli/commandLineMenu');

if (require.main === module) {
  process.env.INVOICE_DOWNLOAD_CENTER_SUPPRESS_CONSOLE_LOG = '1';
}

async function main() {
  // 这个函数解决项目默认入口直接进入命令行菜单的问题。
  await 启动命令行菜单();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[ERROR] ${error.message}`);
    console.error('[LOG] runtime\\latest-run.log');
    process.exitCode = 1;
  });
}

module.exports = {
  main,
};
