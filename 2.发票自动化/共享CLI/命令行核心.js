const readline = require('readline');
const { format: 格式化输出参数 } = require('node:util');
const { 格式化应用展示信息 } = require('./应用元信息');

const 命令行分隔线 = '─'.repeat(68);
const 默认运行日志上限 = 500;
const 默认日志每页条数 = 12;
const 跳过自动暂停结果 = Object.freeze({ 跳过自动暂停: true });
const ANSI代码 = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  cyan: '\u001b[36m',
  blue: '\u001b[34m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  red: '\u001b[31m',
  magenta: '\u001b[35m',
  white: '\u001b[37m',
  gray: '\u001b[90m',
  clear: '\u001b[2J',
  home: '\u001b[H',
};

function 创建命令行主题(outputStream = process.stdout) {
  const 启用颜色 = Boolean(outputStream?.isTTY) && !process.env.NO_COLOR;

  function 添加颜色(文本, ...颜色代码) {
    const 标准文本 = String(文本 ?? '');
    return 启用颜色
      ? `${颜色代码.join('')}${标准文本}${ANSI代码.reset}`
      : 标准文本;
  }

  return {
    启用颜色,
    标题: (文本) => 添加颜色(文本, ANSI代码.bold, ANSI代码.cyan),
    小标题: (文本) => 添加颜色(文本, ANSI代码.bold, ANSI代码.yellow),
    正文: (文本) => 添加颜色(文本, ANSI代码.white),
    成功: (文本) => 添加颜色(文本, ANSI代码.green),
    提醒: (文本) => 添加颜色(文本, ANSI代码.yellow),
    失败: (文本) => 添加颜色(文本, ANSI代码.red),
    弱化: (文本) => 添加颜色(文本, ANSI代码.gray),
    强调: (文本) => 添加颜色(文本, ANSI代码.cyan),
    标签: (文本) => 添加颜色(文本, ANSI代码.magenta),
    链接: (文本) => 添加颜色(文本, ANSI代码.blue),
  };
}

function 创建标准输出函数(outputStream = process.stdout) {
  // 业务界面必须直写专用输出流，不能复用 console；否则诊断日志无法与页面可靠分区。
  return (...messages) => {
    outputStream.write(`${格式化输出参数(...messages)}\n`);
  };
}

function 创建运行日志缓冲区(maximumLines = 默认运行日志上限) {
  const 最大行数 = Number.isInteger(maximumLines) && maximumLines > 0
    ? maximumLines
    : 默认运行日志上限;
  const 日志行列表 = [];

  function 记录(...messages) {
    const text = 格式化输出参数(...messages);
    const lines = String(text).split(/\r?\n/);
    日志行列表.push(...lines);
    if (日志行列表.length > 最大行数) {
      日志行列表.splice(0, 日志行列表.length - 最大行数);
    }
  }

  return Object.freeze({
    记录,
    读取: () => [...日志行列表],
    读取数量: () => 日志行列表.length,
  });
}

function 创建命令行终端({
  outputStream = process.stdout,
  output = null,
  clearScreen = null,
} = {}) {
  const 界面输出 = typeof output === 'function' ? output : 创建标准输出函数(outputStream);
  const 主题 = 创建命令行主题(outputStream);

  function 清屏() {
    if (typeof clearScreen === 'function') {
      clearScreen();
      return;
    }
    if (outputStream?.isTTY) outputStream.write(`${ANSI代码.clear}${ANSI代码.home}`);
  }

  function 输出标题(标题, 副标题 = '') {
    界面输出(主题.标题(标题));
    界面输出(主题.弱化(命令行分隔线));
    if (副标题) 界面输出(主题.弱化(副标题));
  }

  function 显示页面(标题, 副标题 = '') {
    清屏();
    输出标题(标题, 副标题);
  }

  async function 暂停(命令行提问器, 提示文字 = '按回车返回首页……') {
    await 命令行提问器.询问(`\n${主题.弱化(提示文字)}`);
  }

  return {
    outputStream,
    output: 界面输出,
    主题,
    分隔线: 命令行分隔线,
    清屏,
    输出标题,
    显示页面,
    暂停,
  };
}

function 创建命令行提问器({ input = process.stdin, output = process.stdout } = {}) {
  const 命令行读取器 = readline.createInterface({ input, output });
  const 输入行队列 = [];
  const 等待输入列表 = [];
  let 输入已结束 = false;

  const 处理输入行 = (输入内容) => {
    const 等待输入 = 等待输入列表.shift();
    if (等待输入) {
      等待输入.resolve(输入内容);
      return;
    }
    输入行队列.push(输入内容);
  };

  const 处理输入关闭 = () => {
    输入已结束 = true;
    while (等待输入列表.length) {
      等待输入列表.shift().reject(new Error('命令行输入已结束。'));
    }
  };

  命令行读取器.on('line', 处理输入行);
  命令行读取器.once('close', 处理输入关闭);

  return {
    询问: (提示文字) => 询问普通文本({
      输入行队列,
      等待输入列表,
      输入已结束: () => 输入已结束,
      输出流: output,
      提示文字,
    }),
    询问密码: (提示文字) => 询问密码文本({
      命令行读取器,
      输入流: input,
      输出流: output,
      提示文字,
      普通文本提问: (普通提示文字) => 询问普通文本({
        输入行队列,
        等待输入列表,
        输入已结束: () => 输入已结束,
        输出流: output,
        提示文字: 普通提示文字,
      }),
    }),
    关闭: () => 命令行读取器.close(),
  };
}

function 询问普通文本({ 输入行队列, 等待输入列表, 输入已结束, 输出流, 提示文字 }) {
  return new Promise((resolve, reject) => {
    输出流.write(String(提示文字 ?? ''));
    if (输入行队列.length) {
      resolve(输入行队列.shift());
      return;
    }
    if (输入已结束()) {
      reject(new Error('命令行输入已结束。'));
      return;
    }
    等待输入列表.push({ resolve, reject });
  });
}

async function 询问密码文本({ 命令行读取器, 输入流, 输出流, 提示文字, 普通文本提问 }) {
  if (!输入流.isTTY || typeof 输入流.setRawMode !== 'function') {
    return 普通文本提问(提示文字);
  }

  return 读取隐藏密码(命令行读取器, 输入流, 输出流, 提示文字);
}

function 读取隐藏密码(命令行读取器, 输入流, 输出流, 提示文字) {
  return new Promise((resolve, reject) => {
    let 密码内容 = '';
    let 已完成 = false;
    const 原始模式状态 = Boolean(输入流.isRaw);

    const 清理输入状态 = () => {
      输入流.off('keypress', 处理按键);
      输入流.setRawMode(原始模式状态);
      输入流.pause();
      命令行读取器.resume();
    };

    const 完成输入 = (处理结果, 是否成功) => {
      if (已完成) return;
      已完成 = true;
      清理输入状态();
      输出流.write('\n');
      if (是否成功) {
        resolve(处理结果);
        return;
      }
      reject(new Error(处理结果));
    };

    const 处理按键 = (按键字符, 按键信息 = {}) => {
      if (按键信息.ctrl && 按键信息.name === 'c') {
        完成输入('用户取消了密码输入。', false);
        return;
      }
      if (按键信息.name === 'return' || 按键信息.name === 'enter') {
        完成输入(密码内容, true);
        return;
      }
      if (按键信息.name === 'backspace') {
        if (!密码内容) return;
        密码内容 = 密码内容.slice(0, -1);
        输出流.write('\b \b');
        return;
      }
      if (!按键信息.ctrl && !按键信息.meta && 按键字符) {
        密码内容 += 按键字符;
        输出流.write('*');
      }
    };

    readline.emitKeypressEvents(输入流);
    命令行读取器.pause();
    输出流.write(String(提示文字 ?? ''));
    输入流.setRawMode(true);
    输入流.resume();
    输入流.on('keypress', 处理按键);
  });
}

async function 启动命令行菜单({
  标题,
  副标题 = '',
  菜单分组,
  菜单动作,
  页面标题 = {},
  首页输出 = null,
  应用展示信息 = null,
  输入流 = process.stdin,
  输出流 = process.stdout,
  输出 = null,
  清屏 = null,
  提问器 = null,
  终端 = null,
  退出前 = null,
  运行日志上限 = 默认运行日志上限,
} = {}) {
  const 界面输出 = typeof 输出 === 'function' ? 输出 : 创建标准输出函数(输出流);
  const 命令行终端 = 终端 || 创建命令行终端({ outputStream: 输出流, output: 界面输出, clearScreen: 清屏 });
  const 命令行提问器 = 提问器 || 创建命令行提问器({ input: 输入流, output: 输出流 });
  const 运行日志 = 创建运行日志缓冲区(运行日志上限);
  let 已请求退出 = false;

  const 处理退出信号 = () => {
    已请求退出 = true;
    命令行提问器.关闭();
  };
  process.once('SIGINT', 处理退出信号);
  process.once('SIGBREAK', 处理退出信号);
  process.once('SIGTERM', 处理退出信号);

  try {
    while (!已请求退出) {
      输出主菜单({
        标题,
        副标题,
        菜单分组,
        输出: 界面输出,
        终端: 命令行终端,
        首页输出,
        应用展示信息,
      });
      const 菜单选择 = (await 命令行提问器.询问(`${命令行终端.主题.强调('请选择')}：`)).trim();
      if (菜单选择 === '0') break;
      const 菜单动作函数 = 菜单动作?.[菜单选择];
      if (typeof 菜单动作函数 !== 'function') {
        命令行终端.显示页面(`${标题} · 输入提示`);
        界面输出(命令行终端.主题.提醒(`[提示] 无效选项：${菜单选择 || '空输入'}`));
        await 命令行终端.暂停(命令行提问器);
        continue;
      }
      命令行终端.显示页面(`${标题} · ${页面标题[菜单选择] || '功能'}`);
      let 动作结果 = null;
      try {
        动作结果 = await 菜单动作函数({
          提问器: 命令行提问器,
          终端: 命令行终端,
          输出: 界面输出,
          记录运行日志: 运行日志.记录,
        });
      } catch (错误) {
        运行日志.记录(错误?.stack || 错误);
        界面输出(命令行终端.主题.失败(`[失败] ${错误.message}`));
      }
      if (动作结果?.跳过自动暂停 !== true) await 命令行终端.暂停(命令行提问器);
    }
    命令行终端.清屏();
    界面输出(命令行终端.主题.成功(`[退出] ${标题} 已退出。`));
  } finally {
    process.off('SIGINT', 处理退出信号);
    process.off('SIGBREAK', 处理退出信号);
    process.off('SIGTERM', 处理退出信号);
    if (typeof 退出前 === 'function') await Promise.resolve(退出前()).catch(() => {});
    命令行提问器.关闭();
  }
}

function 输出主菜单({
  标题,
  副标题,
  菜单分组,
  输出,
  终端,
  首页输出 = null,
  应用展示信息 = null,
}) {
  终端.清屏();
  终端.输出标题(`${标题} · CLI`, 副标题);
  输出应用展示信息({ 输出, 终端, 应用展示信息 });
  if (typeof 首页输出 === 'function') {
    首页输出({ 输出, 终端 });
  }
  for (const 菜单组 of 菜单分组 || []) {
    if (菜单组.标题) 输出(终端.主题.小标题(菜单组.标题));
    for (const 菜单项 of 菜单组.项目 || []) {
      输出(`  ${终端.主题.强调(`[${菜单项.编号}]`)} ${终端.主题.正文(菜单项.名称)}`);
    }
    输出('');
  }
  输出(终端.主题.弱化(终端.分隔线));
  输出(终端.主题.弱化('每个功能使用独立页面；执行过程日志直接显示在页面；Ctrl+C 可安全退出。'));
}

async function 打开运行日志视图({ 标题, 提问器, 终端, 输出, 读取日志 }) {
  // 日志独立分页，避免用户处理订单时被高频浏览器与仓库诊断打断。
  let 当前页码 = Number.MAX_SAFE_INTEGER;
  while (true) {
    const 日志列表 = typeof 读取日志 === 'function' ? 读取日志() : [];
    const 总页数 = Math.max(1, Math.ceil(日志列表.length / 默认日志每页条数));
    当前页码 = Math.min(Math.max(1, 当前页码), 总页数);
    终端.显示页面(`${标题} · 运行日志`, '诊断记录与业务页面物理分区；这里只展示本次 CLI 会话。');
    if (!日志列表.length) {
      输出(终端.主题.弱化('本次会话暂时没有运行日志。'));
      await 提问器.询问('按回车返回首页……');
      return 跳过自动暂停结果;
    }
    const 起始索引 = (当前页码 - 1) * 默认日志每页条数;
    日志列表.slice(起始索引, 起始索引 + 默认日志每页条数).forEach((日志行) => 输出(日志行));
    输出('');
    输出(终端.主题.弱化(`第 ${当前页码}/${总页数} 页｜共 ${日志列表.length} 行`));
    const 选择 = (await 提问器.询问('n 下一页｜p 上一页｜r 刷新｜0 返回首页：')).trim().toLowerCase();
    if (!选择 || 选择 === '0') return 跳过自动暂停结果;
    if (选择 === 'n') 当前页码 = Math.min(总页数, 当前页码 + 1);
    if (选择 === 'p') 当前页码 = Math.max(1, 当前页码 - 1);
  }
}

function 输出应用展示信息({ 输出, 终端, 应用展示信息: 应用展示信息数据 }) {
  if (!应用展示信息数据) return;
  输出(终端.主题.弱化(格式化应用展示信息(应用展示信息数据)));
}

async function 编辑店铺配置({
  标题,
  提问器,
  终端,
  输出,
  读取配置,
  保存配置,
  字段定义,
  默认店铺 = {},
} = {}) {
  while (true) {
    终端.清屏();
    终端.输出标题(`${标题} · 店铺配置`);
    const 当前配置 = 读取配置();
    const 店铺列表 = Array.isArray(当前配置?.stores) ? 当前配置.stores : [];
    输出店铺列表({ 店铺列表, 输出, 终端 });
    输出('');
    输出('  [1] 新增店铺');
    输出('  [2] 修改店铺');
    输出('  [3] 启用/停用店铺');
    输出('  [4] 删除店铺');
    输出('  [0] 返回上一级');
    const 选择 = (await 提问器.询问('请选择：')).trim();
    if (选择 === '0') return 跳过自动暂停结果;
    if (选择 === '1') {
      const 新店铺 = await 询问店铺字段({ 提问器, 字段定义, 当前店铺: 默认店铺, 新增模式: true });
      const 保存后配置 = 保存配置({ ...当前配置, stores: [...店铺列表, 新店铺] });
      输出(终端.主题.成功(`[完成] 已新增店铺：${保存后配置.stores.at(-1).name}`));
      await 终端.暂停(提问器);
      continue;
    }
    const 店铺索引 = await 询问店铺索引(提问器, 店铺列表, 选择);
    if (店铺索引 < 0) continue;
    if (选择 === '2') {
      const 修改后店铺 = await 询问店铺字段({ 提问器, 字段定义, 当前店铺: 店铺列表[店铺索引], 新增模式: false });
      const 新店铺列表 = 店铺列表.slice();
      新店铺列表[店铺索引] = 修改后店铺;
      保存配置({ ...当前配置, stores: 新店铺列表 });
      输出(终端.主题.成功('[完成] 店铺配置已保存。'));
      await 终端.暂停(提问器);
      continue;
    }
    if (选择 === '3') {
      const 新店铺列表 = 店铺列表.slice();
      新店铺列表[店铺索引] = { ...新店铺列表[店铺索引], enabled: !新店铺列表[店铺索引].enabled };
      保存配置({ ...当前配置, stores: 新店铺列表 });
      输出(终端.主题.成功(`[完成] 已${新店铺列表[店铺索引].enabled ? '启用' : '停用'}：${新店铺列表[店铺索引].name}`));
      await 终端.暂停(提问器);
      continue;
    }
    if (选择 === '4') {
      const 确认 = (await 提问器.询问(`确认删除“${店铺列表[店铺索引].name}”？输入 y 确认：`)).trim().toLowerCase();
      if (['y', 'yes', '是', '确认'].includes(确认)) {
        店铺列表.splice(店铺索引, 1);
        保存配置({ ...当前配置, stores: 店铺列表 });
        输出(终端.主题.成功('[完成] 店铺已删除。'));
      } else {
        输出(终端.主题.提醒('[取消] 未删除店铺。'));
      }
      await 终端.暂停(提问器);
      continue;
    }
    输出(终端.主题.提醒('[提示] 无效选项。'));
    await 终端.暂停(提问器);
  }
}

async function 询问店铺字段({ 提问器, 字段定义, 当前店铺 = {}, 新增模式 = false }) {
  const 新店铺 = { ...当前店铺 };
  for (const 字段 of 字段定义 || []) {
    const 当前值 = typeof 字段.读取值 === 'function' ? 字段.读取值(当前店铺) : 当前店铺[字段.键];
    const 默认值 = typeof 字段.默认值 === 'function' ? 字段.默认值(当前店铺) : 字段.默认值;
    const 当前提示 = 新增模式 ? '' : `（回车保留${字段.密码 ? '当前密码' : '当前值'}）`;
    const 输入提示 = `${字段.名称}${当前提示}${默认值 && 新增模式 ? `（默认：${默认值}）` : ''}：`;
    const 输入内容 = 字段.密码
      ? await 提问器.询问密码(输入提示)
      : await 提问器.询问(输入提示);
    const 原始输入 = String(输入内容 ?? '');
    const 最终值 = 原始输入.trim() || (当前值 ?? 默认值 ?? '');
    if (字段.必填 && !String(最终值).trim()) {
      throw new Error(`${字段.名称}不能为空。`);
    }
    if (typeof 字段.转换值 === 'function') {
      新店铺[字段.键] = 字段.转换值(最终值, 当前店铺);
    } else {
      新店铺[字段.键] = 最终值;
    }
  }
  return 新店铺;
}

async function 询问店铺索引(提问器, 店铺列表, 操作名称) {
  if (!['2', '3', '4'].includes(操作名称)) return -1;
  const 输入序号 = Number.parseInt(await 提问器.询问('请输入店铺序号：'), 10);
  if (!Number.isInteger(输入序号) || 输入序号 < 1 || 输入序号 > 店铺列表.length) {
    throw new Error('店铺序号无效。');
  }
  return 输入序号 - 1;
}

function 输出店铺列表({ 店铺列表, 输出, 终端, 读取登录状态 = null, 读取结果 = null }) {
  if (!店铺列表.length) {
    输出(终端.主题.提醒('[状态] 当前没有店铺配置。'));
    return;
  }
  店铺列表.forEach((店铺, 索引) => {
    const 启用文字 = 店铺.enabled ? 终端.主题.成功('启用') : 终端.主题.弱化('停用');
    const 登录状态 = typeof 读取登录状态 === 'function' ? 读取登录状态(店铺) : null;
    const 结果 = typeof 读取结果 === 'function' ? 读取结果(店铺) : null;
    输出(`  [${索引 + 1}] ${终端.主题.强调(店铺.name || '未命名')} ${终端.主题.弱化(`(${店铺.id || '-'})`)}｜${启用文字}`);
    输出(`      账号：${脱敏账号(店铺.username || 店铺.phoneNumber || '')}｜登录资料：${输出登录状态(登录状态, 终端)}`);
    if (店铺.targetUrl) 输出(`      地址：${终端.主题.链接(店铺.targetUrl)}`);
    if (结果) 输出(`      最近结果：${结果}`);
  });
}

function 输出登录状态(登录状态, 终端) {
  if (!登录状态) return 终端.主题.弱化('未检查');
  const 状态文字 = String(登录状态.label || 登录状态.status || '未知');
  if (登录状态.status === 'logged_in' || 登录状态.status === 'ready') return 终端.主题.成功(状态文字);
  if (登录状态.status === 'not_logged_in' || 登录状态.status === 'missing') return 终端.主题.失败(状态文字);
  return 终端.主题.提醒(状态文字);
}

function 脱敏账号(账号) {
  const 标准账号 = String(账号 || '').trim();
  if (!标准账号) return '未配置';
  if (标准账号.length <= 3) return `${标准账号.slice(0, 1)}***`;
  return `${标准账号.slice(0, 3)}***${标准账号.slice(-2)}`;
}

async function 选择店铺({
  提问器,
  店铺列表,
  允许全部 = false,
  输出 = null,
  终端 = null,
}) {
  const 界面输出 = typeof 输出 === 'function' ? 输出 : 创建标准输出函数(process.stdout);
  if (!店铺列表.length) throw new Error('当前没有可用店铺，请先配置并启用店铺。');
  店铺列表.forEach((店铺, 索引) => {
    const 店铺序号文字 = 终端?.主题?.强调?.(`[${索引 + 1}]`) || `[${索引 + 1}]`;
    const 店铺名称文字 = 终端?.主题?.正文?.(店铺.name) || 店铺.name;
    const 店铺标识文字 = 终端?.主题?.弱化?.(`(${店铺.id})`) || `(${店铺.id})`;
    界面输出(`  ${店铺序号文字} ${店铺名称文字} ${店铺标识文字}`);
  });
  if (允许全部) 界面输出(`  ${终端?.主题?.强调?.('[A]') || '[A]'} 全部启用店铺`);
  const 输入 = (await 提问器.询问('请选择店铺：')).trim();
  if (允许全部 && ['a', 'all', '全部'].includes(输入.toLowerCase())) return 店铺列表;
  const 序号 = Number.parseInt(输入, 10);
  if (!Number.isInteger(序号) || 序号 < 1 || 序号 > 店铺列表.length) throw new Error('店铺选择无效。');
  return [店铺列表[序号 - 1]];
}

async function 等待任务完成(任务服务, 输出, 最长等待毫秒 = 86_400_000, 状态变化 = null) {
  if (typeof 最长等待毫秒 === 'function') {
    状态变化 = 最长等待毫秒;
    最长等待毫秒 = 86_400_000;
  }
  const 开始时间 = Date.now();
  let 最近状态签名 = '';

  async function 通知状态变化() {
    if (typeof 状态变化 !== 'function') return;
    const 当前状态 = 任务服务?.state?.currentTask || null;
    const 状态签名 = JSON.stringify([
      当前状态?.status || '',
      当前状态?.label || '',
      当前状态?.message || '',
    ]);
    if (状态签名 === 最近状态签名) return;
    最近状态签名 = 状态签名;
    await Promise.resolve(状态变化(当前状态));
  }

  while (任务服务?.running) {
    if (Date.now() - 开始时间 > 最长等待毫秒) throw new Error('任务等待超时。');
    await 通知状态变化();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const 任务状态 = 任务服务?.state?.currentTask;
  await 通知状态变化();
  if (任务状态?.message && typeof 输出 === 'function') 输出(`[结果] ${任务状态.message}`);
  return 任务状态;
}

module.exports = {
  ANSI代码,
  命令行分隔线,
  默认运行日志上限,
  默认日志每页条数,
  跳过自动暂停结果,
  创建命令行主题,
  创建标准输出函数,
  创建运行日志缓冲区,
  创建命令行终端,
  创建命令行提问器,
  启动命令行菜单,
  输出主菜单,
  打开运行日志视图,
  输出应用展示信息,
  编辑店铺配置,
  询问店铺字段,
  输出店铺列表,
  脱敏账号,
  选择店铺,
  等待任务完成,
};
