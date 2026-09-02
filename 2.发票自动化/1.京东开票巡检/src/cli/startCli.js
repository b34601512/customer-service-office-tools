const fs = require('fs');
const path = require('path');
const { spawnSync } = require('node:child_process');
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
const 订单状态菜单模块路径 = [
  path.resolve(__dirname, '../../../共享CLI/订单状态菜单.js'),
  path.resolve(__dirname, '../../共享CLI/订单状态菜单.js'),
].find((模块路径) => fs.existsSync(模块路径));
if (!订单状态菜单模块路径) throw new Error('找不到共享订单状态菜单模块。');
const { 打开订单状态管理 } = require(订单状态菜单模块路径);
const {
  启动命令行菜单,
  编辑店铺配置,
  输出店铺列表,
  选择店铺,
} = require(共享CLI模块路径);
const { 执行巡检 } = require('../app/checkInvoices');
const {
  读取店铺配置,
  保存店铺配置,
  获取启用店铺列表,
  默认目标页面地址,
} = require('../store/storeConfigService');
const {
  读取店铺结果,
  更新店铺结果,
  更新最近巡检摘要,
} = require('../store/storeResultService');
const {
  获取店铺浏览器目录,
} = require('../common/paths');
const {
  构建成功店铺结果,
  构建失败店铺结果,
} = require('./inspectionResult');
const {
  构建命令行巡检摘要,
  输出巡检摘要,
  输出首页巡检总览,
} = require('./inspectionOverview');
const {
  读取订单列表,
  同步巡检店铺结果,
  同步最近巡检结果,
  更新订单工作流状态,
  设置订单备注,
  设置订单客户档案,
  获取订单统计,
} = require('../order/jdInspectionOrderStore');

const 菜单标题 = '京东开票巡检';
const 菜单副标题 = 'CLI 管理入口｜配置、登录、单店巡检与批量检查';
const 应用展示信息 = 读取应用展示信息({
  项目根目录: path.resolve(__dirname, '../..'),
  应用名称: 菜单标题,
});
const 店铺字段定义 = [
  { 键: 'id', 名称: '店铺标识' },
  { 键: 'name', 名称: '店铺名称', 必填: true },
  { 键: 'targetUrl', 名称: '目标地址', 默认值: 默认目标页面地址, 必填: true },
  { 键: 'username', 名称: '登录账号' },
  { 键: 'password', 名称: '登录密码', 密码: true },
];
let 最近巡检结果已同步 = false;

function 确保最近巡检订单已同步() {
  // 解决：CLI 首次打开时只同步一次旧网页最近结果，后续队列刷新只读持久订单。
  if (!最近巡检结果已同步) {
    同步最近巡检结果(读取店铺结果());
    最近巡检结果已同步 = true;
  }
  return 读取订单列表();
}

function 输出订单状态摘要(输出) {
  // 解决：首页明确展示四个人工队列，平台巡检指标保持独立。
  const stats = 获取订单统计(确保最近巡检订单已同步());
  输出(`[订单状态] 待处理 ${stats.pending}｜处理中 ${stats.processing}｜发票已登记 ${stats.invoiceRegistered}｜已处理 ${stats.handled}`);
}

async function 查看当前状态({ 输出, 终端 }) {
  const 配置 = 读取店铺配置();
  const 结果 = 读取店铺结果();
  输出(`[状态] CLI 管理入口运行中｜已配置 ${配置.stores.length} 个店铺`);
  输出首页巡检总览({ 输出, 终端, 配置, 结果对象: 结果 });
  输出订单状态摘要(输出);
  输出店铺列表({
    店铺列表: 配置.stores,
    输出,
    终端,
    读取登录状态: (店铺) => 读取本地登录状态(店铺),
    读取结果: (店铺) => 格式化最近结果(结果.stores?.[店铺.id], 终端),
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
    默认店铺: { targetUrl: 默认目标页面地址, enabled: true },
  });
}

async function 人工登录并巡检({ 提问器, 输出, 终端, 记录运行日志 }) {
  const 店铺列表 = 获取启用店铺列表();
  const 选中店铺列表 = await 选择店铺({ 提问器, 店铺列表, 允许全部: false, 输出, 终端 });
  const 店铺 = 选中店铺列表[0];
  const 开始时间 = new Date().toISOString();
  输出(`[开始] 正在打开 ${店铺.name} 的真实登录页面；验证码等环节请在浏览器完成。`);
  try {
    const 结果 = await 执行巡检({
      店铺配置: 店铺,
      headless: false,
      允许人工登录: true,
      巡检后保持页面打开: true,
      启用运行目录膨胀守卫: true,
    });
    const 店铺结果 = 构建成功店铺结果({ 店铺, 巡检结果: 结果 });
    更新店铺结果(店铺结果);
    同步巡检店铺结果(店铺结果);
    const 摘要 = 构建命令行巡检摘要({
      执行类型: 'single',
      开始时间,
      完成时间: 店铺结果.lastCheckedAt,
      店铺列表: [店铺],
      店铺结果列表: [店铺结果],
    });
    更新最近巡检摘要(摘要);
    终端.显示页面(`${菜单标题} · 人工巡检结果`, 店铺.name);
    输出巡检结果(店铺结果, 输出, 终端);
    输出巡检摘要({ 摘要, 输出, 终端 });
    记录运行日志?.(`[人工巡检] ${店铺.name}｜${店铺结果.lastMessage || 店铺结果.status}`);
  } catch (错误) {
    const 店铺结果 = 构建失败店铺结果({ 店铺, 错误 });
    更新店铺结果(店铺结果);
    更新最近巡检摘要(构建命令行巡检摘要({
      执行类型: 'single',
      开始时间,
      完成时间: 店铺结果.lastCheckedAt,
      店铺列表: [店铺],
      店铺结果列表: [店铺结果],
    }));
    throw 错误;
  }
}

async function 批量静默检查({ 输出, 终端, 记录运行日志 }) {
  const 店铺列表 = 获取启用店铺列表();
  if (!店铺列表.length) throw new Error('当前没有启用中的店铺，请先编辑店铺配置。');
  const 开始时间 = new Date().toISOString();
  const 本次店铺结果列表 = [];
  输出('静默检查中；若某店铺登录态失效，会自动弹出登录窗口并发送桌面通知，完成验证后自动继续。');
  for (const [索引, 店铺] of 店铺列表.entries()) {
    终端.显示页面(`${菜单标题} · 批量静默检查`, `正在处理第 ${索引 + 1}/${店铺列表.length} 家店铺`);
    输出(`当前店铺：${店铺.name}`);
    记录运行日志?.(`[批量巡检] 开始 ${索引 + 1}/${店铺列表.length}：${店铺.name}`);
    try {
      const 结果 = await 执行巡检({
        店铺配置: 店铺,
        headless: false,
        允许人工登录: false,
        登录失效自动转人工: true,
        页面保留模式: 'keep',
        启用运行目录膨胀守卫: true,
      });
      const 店铺结果 = 构建成功店铺结果({ 店铺, 巡检结果: 结果 });
      本次店铺结果列表.push(店铺结果);
      更新店铺结果(店铺结果);
      同步巡检店铺结果(店铺结果);
      记录运行日志?.(`[批量巡检] 完成 ${店铺.name}：${店铺结果.lastMessage || 店铺结果.status}`);
    } catch (错误) {
      const 店铺结果 = 构建失败店铺结果({ 店铺, 错误 });
      本次店铺结果列表.push(店铺结果);
      更新店铺结果(店铺结果);
      记录运行日志?.(`[批量巡检] 失败 ${店铺.name}：${错误.message}`);
    }
  }
  const 摘要 = 构建命令行巡检摘要({
    执行类型: 'batch',
    开始时间,
    完成时间: new Date().toISOString(),
    店铺列表,
    店铺结果列表: 本次店铺结果列表,
  });
  更新最近巡检摘要(摘要);
  终端.显示页面(`${菜单标题} · 批量巡检结果`, `已检查 ${本次店铺结果列表.length}/${店铺列表.length} 家店铺`);
  输出巡检摘要({ 摘要, 输出, 终端 });
  输出('');
  本次店铺结果列表.forEach((店铺结果) => 输出巡检结果(店铺结果, 输出, 终端));
}

function 复制订单号到剪贴板(orderNumber) {
  // 解决：CLI 复制订单号直接写 Windows 剪贴板，不依赖旧网页后台。
  const text = String(orderNumber || '').trim();
  if (!text) throw new Error('复制订单号失败：订单号不能为空。');
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    'Set-Clipboard -Value ([Console]::In.ReadToEnd())',
  ], { input: text, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`复制订单号失败：${result.error?.message || result.stderr || `退出码 ${result.status}`}`);
  return true;
}

function 读取订单倒计时(order = {}) {
  // 解决：CLI 继续展示旧网页已有的发票上传倒计时，不把它埋在原始字段对象里。
  const fields = order.fields && typeof order.fields === 'object' ? order.fields : {};
  const fieldName = Object.keys(fields).find((name) => /发票上传.*倒计时/.test(name) && !/开始时间/.test(name));
  return String(order.invoiceCountdownText || (fieldName ? fields[fieldName] : '') || '-').trim();
}

async function 编辑订单客户档案({ order, 提问器, 输出 }) {
  // 解决：旧网页已有的联系人和长期备注在 CLI 队列内继续可读可改。
  输出(`当前联系人：${order.contactName || '-'}｜长期备注：${order.orderNoteText || '-'}`);
  const contactName = await 提问器.询问('订单是谁（留空即清除）：');
  const orderNoteText = await 提问器.询问('长期备注（留空即清除）：');
  设置订单客户档案(order.key, { contactName, orderNoteText });
  输出('[完成] 客户档案已保存。');
}

async function 查看和处理订单状态({ 提问器, 输出, 终端 }) {
  // 解决：选择人工阶段后立即列出订单，并在原队列完成状态、备注与档案操作。
  return 打开订单状态管理({
    提问器,
    输出,
    终端,
    读取订单列表: 确保最近巡检订单已同步,
    更新订单状态: (key, targetStatus) => 更新订单工作流状态(key, targetStatus),
    更新订单备注: (key, noteText) => 设置订单备注(key, noteText),
    复制订单号: (orderNumber) => {
      复制订单号到剪贴板(orderNumber);
      输出('[完成] 订单号已复制。');
    },
    构建额外动作: (order) => [{
      label: '编辑客户档案',
      execute: () => 编辑订单客户档案({ order, 提问器, 输出 }),
    }],
    格式化队列附加信息: (order) => {
      const noteText = String(order.noteText || '').trim();
      const shortNote = noteText.length > 20 ? `${noteText.slice(0, 20)}…` : noteText;
      return `优先级：${order.detailStatus?.优先级 || '-'}｜倒计时：${读取订单倒计时(order)}｜联系人：${order.contactName || '-'}${shortNote ? `｜备注：${shortNote}` : ''}`;
    },
    格式化详情附加信息: (order) => `优先级：${order.detailStatus?.优先级 || '-'}｜倒计时：${读取订单倒计时(order)}｜联系人：${order.contactName || '-'}｜备注：${order.noteText || '-'}｜长期备注：${order.orderNoteText || '-'}`,
  });
}

function 输出巡检结果(结果, 输出, 终端) {
  const 指标 = 结果?.metrics || {};
  const 主题 = 终端?.主题;
  if (结果?.status === 'error') {
    const 失败文字 = `[失败] ${结果?.storeName || '店铺'}：${结果?.lastMessage || '巡检失败'}`;
    输出(主题?.失败?.(失败文字) || 失败文字);
    return;
  }
  const 完成文字 = `[完成] ${结果?.storeName || '店铺'}：识别 ${结果?.records?.length || 0} 条，新增 ${结果?.newRecords?.length || 0} 条，告警 ${指标.警告订单数 ?? 0} 条。`;
  输出(主题?.成功?.(完成文字) || 完成文字);
}

function 读取本地登录状态(店铺) {
  const 浏览器目录 = 获取店铺浏览器目录(店铺.id);
  return fs.existsSync(浏览器目录)
    ? { status: 'ready', label: '已有本地资料' }
    : { status: 'missing', label: '未发现本地资料' };
}

function 格式化最近结果(结果, 终端 = null) {
  if (!结果) return '暂无巡检记录';
  const 结果文字 = `${结果.lastCheckedAt || '时间未知'}｜${结果.lastMessage || 结果.status || '已执行'}`;
  if (结果.status === 'success') return 终端?.主题?.成功?.(结果文字) || 结果文字;
  if (结果.status === 'error') return 终端?.主题?.失败?.(结果文字) || 结果文字;
  return 终端?.主题?.提醒?.(结果文字) || 结果文字;
}

async function main() {
  await 启动命令行菜单({
    标题: 菜单标题,
    副标题: 菜单副标题,
    应用展示信息,
    菜单分组: [
      { 标题: '状态与配置', 项目: [
        { 编号: '1', 名称: '查看当前状态' },
        { 编号: '2', 名称: '配置店铺账号和目标地址' },
      ] },
      { 标题: '巡检操作', 项目: [
        { 编号: '3', 名称: '人工登录并巡检指定店铺' },
        { 编号: '4', 名称: '静默检查全部启用店铺' },
      ] },
      { 标题: '订单处理', 项目: [
        { 编号: '6', 名称: '查看和处理订单状态（四个直接队列）' },
      ] },
      { 标题: '系统', 项目: [{ 编号: '0', 名称: '退出' }] },
    ],
    页面标题: { '1': '当前状态', '2': '店铺配置', '3': '人工登录巡检', '4': '批量静默检查', '6': '订单状态' },
    菜单动作: { '1': 查看当前状态, '2': 编辑配置, '3': 人工登录并巡检, '4': 批量静默检查, '6': 查看和处理订单状态 },
    首页输出: ({ 输出, 终端 }) => {
      输出首页巡检总览({
        输出,
        终端,
        配置: 读取店铺配置(),
        结果对象: 读取店铺结果(),
      });
      输出订单状态摘要(输出);
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
  格式化最近结果,
  输出巡检结果,
  查看和处理订单状态,
  编辑订单客户档案,
  读取订单倒计时,
  复制订单号到剪贴板,
};
