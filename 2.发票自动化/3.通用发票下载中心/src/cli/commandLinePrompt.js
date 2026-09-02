const readline = require('readline');

function 创建命令行提问器({ input = process.stdin, output = process.stdout } = {}) {
  // 这个函数解决命令行菜单需要统一读取普通输入和密码输入的问题。
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

  const 询问 = (提示文字) => 询问普通文本({ 输入行队列, 等待输入列表, 输入已结束: () => 输入已结束, 输出流: output, 提示文字 });
  return {
    询问,
    询问密码: (提示文字) => 询问密码文本(命令行读取器, input, output, 提示文字, 询问),
    关闭: () => 命令行读取器.close(),
  };
}

function 询问普通文本({ 输入行队列, 等待输入列表, 输入已结束, 输出流, 提示文字 }) {
  return new Promise((resolve, reject) => {
    输出流.write(提示文字);
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

async function 询问密码文本(命令行读取器, 输入流, 输出流, 提示文字, 询问普通文本方法) {
  // 这个函数解决终端输入密码时不直接显示密码内容的问题。
  if (!输入流.isTTY || typeof 输入流.setRawMode !== 'function') {
    return 询问普通文本方法(提示文字);
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
    输出流.write(提示文字);
    输入流.setRawMode(true);
    输入流.resume();
    输入流.on('keypress', 处理按键);
  });
}

module.exports = {
  创建命令行提问器,
  询问普通文本,
  询问密码文本,
  读取隐藏密码,
};
