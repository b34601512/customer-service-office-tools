const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  子项目定义列表,
  构建子项目路径,
  构建子项目窗口启动命令,
  构建子项目窗口启动选项,
  查找子项目定义,
  检查子项目入口,
  启动子项目,
  输出主菜单,
  总入口应用展示信息,
} = require('./总入口');

test('总入口首页顶部展示作者、微信、官网和版本', () => {
  const 输出记录 = [];
  输出主菜单((文本) => 输出记录.push(文本), { isTTY: false });
  const 首页文本 = 输出记录.join('\n');
  assert.match(首页文本, /作者：黎路遥｜微信：luyao2089｜官网：luyao2089\.cc｜版本：v0\.01/);
  assert.equal(总入口应用展示信息.version, '0.01');
});

test('总入口登记五个业务子项目及启动文件（下载中心已内置到各平台）', () => {
  assert.equal(子项目定义列表.length, 5);
  const 菜单编号集合 = new Set(子项目定义列表.map((子项目定义) => 子项目定义.菜单编号));
  const 启动文件集合 = new Set(子项目定义列表.map((子项目定义) => 子项目定义.启动文件名称));
  assert.equal(菜单编号集合.size, 5);
  assert.equal(启动文件集合.size, 5);
  子项目定义列表.forEach((子项目定义) => {
    const 子项目路径 = 构建子项目路径(子项目定义);
    assert.equal(path.basename(子项目路径.项目目录路径), 子项目定义.项目目录名称);
    assert.equal(path.basename(子项目路径.启动文件路径), 子项目定义.启动文件名称);
    assert.equal(子项目路径.子项目窗口标题, `发票自动化-${子项目定义.项目名称}`);
    assert.equal(检查子项目入口(子项目定义).ok, true);
  });
});

test('总入口按编号找到对应子项目', () => {
  assert.equal(查找子项目定义('1').项目名称, '京东开票巡检');
  assert.equal(查找子项目定义('3').项目名称, '天猫发票回传');
  assert.equal(查找子项目定义('5').项目名称, '抖音发票回传');
  assert.equal(查找子项目定义('0'), null);
  assert.equal(查找子项目定义('99'), null);
});

test('子项目窗口启动命令会正确引用标题和路径', () => {
  const 子项目路径 = 构建子项目路径(子项目定义列表[0]);
  const 启动命令 = 构建子项目窗口启动命令(子项目路径);
  assert.equal(
    启动命令,
    `start "发票自动化-京东开票巡检" /max /d "${子项目路径.项目目录路径}" cmd.exe /d /c call "${子项目路径.启动文件路径}" --launcher-maximized`,
  );
});

test('Windows 启动子项目时必须原样传递命令引号', () => {
  const 启动选项 = 构建子项目窗口启动选项();
  assert.equal(启动选项.windowsVerbatimArguments, true);
  assert.equal(启动选项.detached, true);
  assert.equal(启动选项.windowsHide, false);
});

test('入口文件缺失时给出明确错误', () => {
  const 结果 = 检查子项目入口(子项目定义列表[0], {
    总目录: 'D:\\不存在的发票自动化目录',
    fileExists: () => false,
  });
  assert.equal(结果.ok, false);
  assert.match(结果.message, /没有找到子项目目录/);
});

test('启动子项目只调用现有入口，不执行子项目业务', () => {
  let 启动参数 = null;
  const 结果 = 启动子项目(子项目定义列表[2], {
    launchProjectWindow: (参数) => { 启动参数 = 参数; },
  });
  assert.equal(结果.ok, true);
  assert.equal(启动参数.启动文件路径, path.join(__dirname, '4.天猫发票回传', '启动天猫登录.bat'));
  assert.equal(启动参数.项目目录路径, path.join(__dirname, '4.天猫发票回传'));
  assert.equal(启动参数.子项目窗口标题, '发票自动化-天猫发票回传');
});
