const path = require('path');
const { 初始化运行目录 } = require('../common/fs');
const { 项目根目录 } = require('../common/paths');
const { 清理登记残留进程 } = require('../common/processRegistry');
const { 创建命令行提问器 } = require('./commandLinePrompt');
const { 创建命令行操作 } = require('./commandLineOperations');
const { 创建命令行终端 } = require('./commandLineTerminal');

const 共享应用元信息模块路径 = [
  path.resolve(__dirname, '../../../共享CLI/应用元信息.js'),
  path.resolve(__dirname, '../../共享CLI/应用元信息.js'),
].find((模块路径) => require('fs').existsSync(模块路径));
if (!共享应用元信息模块路径) throw new Error('找不到共享应用元信息模块。');
const {
  读取应用展示信息,
  格式化应用展示信息,
} = require(共享应用元信息模块路径);

const 菜单标题 = '通用发票下载中心';
const 应用展示信息 = 读取应用展示信息({
  项目根目录,
  应用名称: 菜单标题,
});

async function 启动命令行菜单({
  input = process.stdin,
  output = (...messages) => console.log(...messages),
  outputStream = process.stdout,
  clearScreen = null,
  terminal = null,
  prompt = null,
  operations = null,
  cleanupResidualProcesses = 清理登记残留进程,
} = {}) {
  // 这个函数解决用户双击启动后直接进入命令行主菜单的问题。
  初始化运行目录();
  const 命令行终端 = terminal || 创建命令行终端({ outputStream, output, clearScreen });
  const 清理结果 = cleanupResidualProcesses({ excludePids: [process.pid] });
  const 命令行提问器 = prompt || 创建命令行提问器({ input, output: outputStream });
  const 命令行操作 = operations || 创建命令行操作({ output, theme: 命令行终端.主题 });
  let 已请求退出 = false;
  const 处理退出信号 = () => {
    已请求退出 = true;
    命令行提问器.关闭();
  };
  process.once('SIGINT', 处理退出信号);
  process.once('SIGBREAK', 处理退出信号);
  process.once('SIGTERM', 处理退出信号);

  try {
    if (清理结果?.cleanedPids?.length) {
      output(`[清理] 已清理残留进程：${清理结果.cleanedPids.join('、')}`);
    }
    while (!已请求退出) {
      输出主菜单(output, 命令行终端);
      const 菜单选择 = await 命令行提问器.询问(`${命令行终端.主题.强调('请选择')}：`);
      if (菜单选择.trim() === '0') break;
      await 执行菜单选择(菜单选择, 命令行操作, 命令行提问器, output, 命令行终端);
    }
    命令行终端.清屏();
    output('[退出] 下载中心已退出。');
  } catch (error) {
    if (!已请求退出) throw error;
  } finally {
    process.off('SIGINT', 处理退出信号);
    process.off('SIGBREAK', 处理退出信号);
    process.off('SIGTERM', 处理退出信号);
    await Promise.resolve(命令行操作.关闭()).catch((error) => output(`[清理失败] ${error.message}`));
    命令行提问器.关闭();
  }
}

function 输出主菜单(output, terminal = 创建命令行终端({ output })) {
  // 这个函数解决所有日常功能必须在一个稳定编号菜单中呈现的问题。
  terminal.清屏();
  terminal.输出标题(`${菜单标题} · CLI`, '日常管理入口｜发票下载、登录检查与本地缓存');
  output(terminal.主题.弱化(格式化应用展示信息(应用展示信息)));
  output(terminal.主题.小标题('账户与登录'));
  输出菜单项(output, terminal, '1', '查看当前状态');
  输出菜单项(output, terminal, '2', '配置诺诺账号和检索范围');
  输出菜单项(output, terminal, '3', '检查诺诺登录');
  output('');
  output(terminal.主题.小标题('发票处理'));
  输出菜单项(output, terminal, '4', '批量下载发票');
  输出菜单项(output, terminal, '5', '查看本地发票');
  输出菜单项(output, terminal, '6', '打开下载目录');
  output('');
  output(terminal.主题.小标题('数据维护'));
  输出菜单项(output, terminal, '7', '导入旧京东配置');
  输出菜单项(output, terminal, '0', '退出');
  output(terminal.主题.弱化(terminal.分隔线));
  output(terminal.主题.弱化('输入编号选择；任何页面均可按 Ctrl+C 安全退出。'));
}

function 输出菜单项(output, terminal, 菜单编号, 菜单名称) {
  output(`  ${terminal.主题.强调(`[${菜单编号}]`)} ${terminal.主题.正文(菜单名称)}`);
}

async function 执行菜单选择(菜单选择, 命令行操作, 命令行提问器, output, terminal = 创建命令行终端({ output })) {
  // 这个函数解决菜单编号到业务动作的映射集中管理问题。
  const 标准选择 = 菜单选择.trim();
  const 菜单动作 = {
    '1': () => 命令行操作.查看当前状态(),
    '2': () => 命令行操作.配置发票系统(命令行提问器),
    '3': () => 命令行操作.检查诺诺登录(命令行提问器),
    '4': () => 命令行操作.批量下载发票(命令行提问器),
    '5': () => 命令行操作.查看本地发票(命令行提问器),
    '6': () => 命令行操作.打开下载目录(),
    '7': () => 命令行操作.导入旧京东配置(),
  };
  const 菜单页面标题 = {
    '1': '当前状态',
    '2': '诺诺账号与检索范围',
    '3': '诺诺登录检查',
    '4': '批量下载发票',
    '5': '本地发票',
    '6': '下载目录',
    '7': '旧京东配置迁移',
  };
  const 选中动作 = 菜单动作[标准选择];
  if (!选中动作) {
    terminal.清屏();
    output(terminal.主题.提醒(`[提示] 无效选项：${标准选择 || '空输入'}`));
    await terminal.暂停(命令行提问器);
    return;
  }
  terminal.清屏();
  terminal.输出标题(`${菜单标题} · ${菜单页面标题[标准选择]}`);
  try {
    await 选中动作();
    await terminal.暂停(命令行提问器);
  } catch (error) {
    output(terminal.主题.失败(`[失败] ${error.message}`));
    await terminal.暂停(命令行提问器).catch(() => {});
  }
}

module.exports = {
  菜单标题,
  启动命令行菜单,
  输出主菜单,
  输出菜单项,
  执行菜单选择,
};
