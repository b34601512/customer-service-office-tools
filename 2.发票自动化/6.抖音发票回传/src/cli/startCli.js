const fs = require('fs');
const path = require('path');
const 共享CLI模块路径 = [
  path.resolve(__dirname, '../../../共享CLI/命令行核心.js'),
  path.resolve(__dirname, '../../共享CLI/命令行核心.js'),
].find((模块路径) => fs.existsSync(模块路径));
if (!共享CLI模块路径) throw new Error('找不到共享 CLI 核心模块。');
const 共享应用元信息模块路径 = [
  path.resolve(__dirname, '../../../共享CLI/应用元信息.js'),
  path.resolve(__dirname, '../../共享CLI/应用元信息.js'),
].find((模块路径) => fs.existsSync(模块路径));
if (!共享应用元信息模块路径) throw new Error('找不到共享应用元信息模块。');
const { 读取应用展示信息 } = require(共享应用元信息模块路径);
const 共享回传工作台模块路径 = [
  path.resolve(__dirname, '../../../共享CLI/platformReturnWorkbench.js'),
  path.resolve(__dirname, '../../共享CLI/platformReturnWorkbench.js'),
].find((模块路径) => fs.existsSync(模块路径));
if (!共享回传工作台模块路径) throw new Error('找不到共享平台回传工作台模块。');
const { 创建平台回传CLI动作 } = require(共享回传工作台模块路径);
const {
  启动命令行菜单,
  编辑店铺配置,
  输出店铺列表,
  选择店铺,
} = require(共享CLI模块路径);
const {
  读取店铺配置,
  保存店铺配置,
  获取启用店铺列表,
  抖音默认登录地址,
} = require('../store/storeConfigService');
const { 登录单个抖音店铺, 登录全部启用抖音店铺 } = require('../app/loginStores');
const { 采集单个抖音店铺元素 } = require('../app/collectDouyinElements');
const { 同步抖音待处理订单 } = require('../app/syncPendingOrders');
const { 执行抖音发票正式回传 } = require('../app/returnInvoiceToDouyin');
const {
  读取订单列表,
  读取店铺发票已登记订单,
  更新订单工作流状态,
  设置订单备注,
  设置订单回传尝试,
} = require('../order/douyinOrderRecordStore');
const { 获取店铺账号浏览器资料目录 } = require('../browser/storeProfilePaths');
const { 打开凭证目录 } = require('./evidenceViewer');

const 菜单标题 = '抖音发票回传';
const 菜单副标题 = 'CLI 管理入口｜配置、登录、页面采集与发票回传';
const 应用展示信息 = 读取应用展示信息({
  项目根目录: path.resolve(__dirname, '../..'),
  应用名称: 菜单标题,
});
const 店铺字段定义 = [
  { 键: 'id', 名称: '店铺标识' },
  { 键: 'name', 名称: '店铺名称', 必填: true },
  { 键: 'targetUrl', 名称: '登录地址', 默认值: 抖音默认登录地址, 必填: true },
  { 键: 'phoneNumber', 名称: '登录手机号' },
  { 键: 'password', 名称: '登录密码', 密码: true },
];
const 回传工作台 = 创建平台回传CLI动作({
  platformName: '抖音',
  获取启用店铺列表,
  同步单个店铺: 同步抖音待处理订单,
  读取订单列表,
  读取店铺发票已登记订单,
  更新订单工作流状态,
  设置订单备注,
  执行正式回传: 执行抖音发票正式回传,
  设置订单回传尝试,
  回传要求已登记: false,
});

async function 查看当前状态({ 输出, 终端 }) {
  const 配置 = 读取店铺配置();
  输出(`[状态] CLI 管理入口运行中｜已配置 ${配置.stores.length} 个店铺`);
  输出(`[订单状态] ${回传工作台.读取状态统计文字()}`);
  输出店铺列表({
    店铺列表: 配置.stores,
    输出,
    终端,
    读取登录状态: (店铺) => 读取本地登录状态(店铺),
  });
}

async function 编辑配置({ 提问器, 终端, 输出 }) {
  return 编辑店铺配置({
    标题: 菜单标题,
    提问器,
    终端,
    输出,
    读取配置: 读取店铺配置,
    保存配置: 保存店铺配置,
    字段定义: 店铺字段定义,
    默认店铺: { targetUrl: 抖音默认登录地址, enabled: true },
  });
}

async function 登录指定店铺({ 提问器, 输出, 终端 }) {
  const 店铺 = (await 选择店铺({ 提问器, 店铺列表: 获取启用店铺列表(), 允许全部: false, 输出, 终端 }))[0];
  输出(`[开始] 正在打开抖音登录页面：${店铺.name}`);
  const 结果 = await 登录单个抖音店铺(店铺, { headless: false });
  终端.显示页面(`${菜单标题} · 登录结果`, 店铺.name);
  输出(`[完成] ${结果.storeName} 登录资料已保存：${结果.profilePath}`);
}

async function 登录全部店铺({ 输出, 终端 }) {
  const 结果列表 = await 登录全部启用抖音店铺({ headless: false });
  终端.显示页面(`${菜单标题} · 登录结果`, '全部启用店铺');
  输出(`[完成] 已完成 ${结果列表.length} 个启用店铺的登录检查。`);
}

async function 采集指定店铺({ 提问器, 输出, 终端 }) {
  const 店铺 = (await 选择店铺({ 提问器, 店铺列表: 获取启用店铺列表(), 允许全部: false, 输出, 终端 }))[0];
  const 结果 = await 采集单个抖音店铺元素(店铺, { headless: false });
  终端.显示页面(`${菜单标题} · 页面元素采集结果`, 店铺.name);
  输出(`[完成] 页面元素采集报告：${结果.filePath || '已写入运行目录'}`);
}

async function 发票回传({ 提问器, 输出, 终端, 记录运行日志 }) {
  return 回传工作台.一键发票回传({ 提问器, 输出, 终端, 记录运行日志 });
}

async function 打开凭证文件夹({ 输出, 终端 }) {
  const 凭证目录路径 = await 打开凭证目录();
  输出(终端.主题.成功(`  已打开凭证文件夹：${凭证目录路径}`));
}

function 读取本地登录状态(店铺) {
  const 资料目录 = 获取店铺账号浏览器资料目录({
    storeId: 店铺.id,
    username: 店铺.phoneNumber || 店铺.username,
  });
  return fs.existsSync(资料目录)
    ? { status: 'ready', label: '已有本地资料' }
    : { status: 'missing', label: '未发现本地资料' };
}

async function main() {
  await 启动命令行菜单({
    标题: 菜单标题,
    副标题: 菜单副标题,
    应用展示信息,
    菜单分组: [
      { 标题: '状态与配置', 项目: [
        { 编号: '1', 名称: '查看当前状态' },
        { 编号: '2', 名称: '配置店铺手机号和地址' },
      ] },
      { 标题: '登录与采集', 项目: [
        { 编号: '3', 名称: '登录指定店铺' },
        { 编号: '4', 名称: '登录全部启用店铺' },
        { 编号: '5', 名称: '采集指定店铺页面元素' },
      ] },
      { 标题: '发票处理', 项目: [
        { 编号: '6', 名称: '发票回传（自动同步并回传）' },
      ] },
      { 标题: '凭证查看', 项目: [
        { 编号: '7', 名称: '打开凭证文件夹' },
      ] },
      { 标题: '系统', 项目: [{ 编号: '0', 名称: '退出' }] },
    ],
    页面标题: {
      '1': '当前状态', '2': '店铺配置', '3': '登录指定店铺', '4': '登录全部店铺',
      '5': '页面元素采集', '6': '发票回传', '7': '打开凭证文件夹',
    },
    菜单动作: {
      '1': 查看当前状态,
      '2': 编辑配置,
      '3': 登录指定店铺,
      '4': 登录全部店铺,
      '5': 采集指定店铺,
      '6': 发票回传,
      '7': 打开凭证文件夹,
    },
  });
}

if (require.main === module) {
  main().catch((错误) => {
    console.error(`[失败] ${错误.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  读取本地登录状态,
  发票回传,
  打开凭证文件夹,
};
