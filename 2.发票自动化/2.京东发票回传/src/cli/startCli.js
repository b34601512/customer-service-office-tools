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
  等待任务完成,
  打开运行日志视图,
} = require(共享CLI模块路径);
const {
  读取店铺配置,
  保存店铺配置,
  获取启用店铺列表,
  默认目标页面地址,
  默认申请时间最近天数,
  默认接口每页条数,
} = require('../store/storeConfigService');
const { 读取店铺结果 } = require('../store/storeResultService');
const { 获取店铺登录态文件路径 } = require('../common/paths');
const {
  打开凭证目录,
  读取最近凭证状态,
} = require('./evidenceViewer');
const { 输出首页总览 } = require('./inspectionOverview');
const {
  读取本地处理阶段,
} = require('../order/jdOrderRecordStore');
const {
  导出跟进表,
  复制到系统剪贴板,
} = require('./followUpExporter');
const {
  输出性能摘要,
  归档清理已处理记录,
  读取最近日志行,
  打开项目目录: 打开项目目录动作,
} = require('./maintenanceConsole');
const { ControlCenterState } = require('../controlCenter/controlCenterState');
const { ControlCenterTaskService } = require('../controlCenter/taskService');
const { 关闭全部浏览器上下文 } = require('../browser/browserContextHub');
const {
  读取订单记录,
  记录转列表,
  统计订单记录,
  手动新增待处理订单,
  更新订单工作流状态,
  设置订单跟进客服,
  设置订单备注,
  批量标记开票成功已登记订单为已处理,
  是平台待开票待回传订单,
} = require('../order/jdOrderRecordStore');

const 菜单标题 = '京东发票回传';
const 菜单副标题 = 'CLI 管理入口｜登录、催票识别、订单状态与发票回传';
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
  { 键: 'applicationDateRangeDays', 名称: '检索最近天数', 默认值: 默认申请时间最近天数 },
  { 键: 'pageSize', 名称: '接口每页条数', 默认值: 默认接口每页条数 },
];

let 当前任务服务 = null;

async function 查看当前状态({ 输出, 终端 }) {
  const 配置 = 读取店铺配置();
  const 订单数据 = 读取订单记录();
  const 订单统计 = 统计订单记录(订单数据);
  输出(`[状态] CLI 管理入口运行中｜店铺 ${配置.stores.length} 个｜订单 ${订单统计.total} 条`);
  输出首页总览({
    输出,
    终端,
    配置,
    结果对象: 读取店铺结果(),
    订单列表: 记录转列表(订单数据),
  });
  输出店铺列表({
    店铺列表: 配置.stores,
    输出,
    终端,
    读取登录状态: (店铺) => 读取本地登录状态(店铺),
    读取结果: (店铺) => 格式化最近结果(读取店铺结果().stores?.[店铺.id]),
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
    默认店铺: {
      targetUrl: 默认目标页面地址,
      applicationDateRangeDays: 默认申请时间最近天数,
      pageSize: 默认接口每页条数,
      enabled: true,
    },
  });
}

async function 编辑客服名单({ 提问器, 输出 }) {
  const 当前配置 = 读取店铺配置();
  输出(`当前客服：${当前配置.customerServiceNames.join('、') || '未配置'}`);
  const 输入内容 = await 提问器.询问('输入客服姓名，使用逗号分隔；回车保留当前：');
  if (!输入内容.trim()) return;
  const 客服姓名列表 = 输入内容.split(/[,，;；\s]+/).map((姓名) => 姓名.trim()).filter(Boolean);
  保存店铺配置({ ...当前配置, customerServiceNames: 客服姓名列表 });
  输出('[完成] 客服名单已保存。');
}

function 创建任务进度展示({ 页面标题, 副标题 = '', 输出, 终端, 记录运行日志, 操作提示 = '' }) {
  // 任务状态变化时重绘同一页；底层逐步诊断由共享日志通道承接，不在业务页向下堆叠。
  return (任务状态) => {
    const 进度文字 = String(任务状态?.message || '任务正在运行，请稍候。');
    终端.显示页面(`${菜单标题} · ${页面标题}`, 副标题);
    输出(`[进度] ${进度文字}`);
    if (操作提示) 输出(操作提示);
    输出('详细过程将直接显示在页面。');
    记录运行日志?.(`[任务进度] ${页面标题}｜${进度文字}`);
  };
}

async function 人工登录并识别({ 提问器, 输出, 终端, 记录运行日志 }) {
  const 店铺列表 = 获取启用店铺列表();
  const 选中店铺 = (await 选择店铺({ 提问器, 店铺列表, 允许全部: false, 输出, 终端 }))[0];
  输出(`[开始] 正在打开 ${选中店铺.name} 的真实登录页面；验证码等环节请在浏览器完成。`);
  当前任务服务 = 创建任务服务();
  try {
    当前任务服务.启动单店排查(选中店铺.id);
    const 任务状态 = await 等待任务完成(当前任务服务, () => {}, 创建任务进度展示({
      页面标题: '单店识别',
      副标题: 选中店铺.name,
      输出,
      终端,
      记录运行日志,
      操作提示: '如出现验证码或身份验证，请在浏览器中完成。',
    }));
    终端.显示页面(`${菜单标题} · 单店识别结果`, 选中店铺.name);
    输出(`[结果] ${任务状态?.message || '识别任务已结束。'}`);
  } finally {
    await 当前任务服务.shutdownAllRunningTasks('CLI 单店识别完成');
    当前任务服务 = null;
  }
}

async function 自动识别全部({ 输出, 终端, 记录运行日志 }) {
  当前任务服务 = 创建任务服务();
  try {
    当前任务服务.启动全部排查();
    const 任务状态 = await 等待任务完成(当前任务服务, () => {}, 创建任务进度展示({
      页面标题: '批量识别',
      输出,
      终端,
      记录运行日志,
    }));
    终端.显示页面(`${菜单标题} · 批量识别结果`);
    输出(`[结果] ${任务状态?.message || '批量识别任务已结束。'}`);
  } finally {
    await 当前任务服务.shutdownAllRunningTasks('CLI 批量识别完成');
    当前任务服务 = null;
  }
}

async function 批量回传待开票({ 输出, 终端, 记录运行日志 }) {
  const 待回传订单 = 记录转列表(读取订单记录()).filter(是平台待开票待回传订单);
  终端.显示页面(`${菜单标题} · 发票回传`, `正在处理 ${待回传订单.length} 张发票`);
  输出(`[待回传] 共 ${待回传订单.length} 张真实发票。`);
  if (!待回传订单.length) {
    输出('[跳过] 当前没有可回传订单，未启动浏览器。');
    return null;
  }
  当前任务服务 = 创建任务服务();
  try {
    输出('详细过程将直接显示在页面。');
    当前任务服务.启动待开票发票批量回传();
    await 等待任务完成(当前任务服务, () => {}, 创建任务进度展示({
      页面标题: '发票回传',
      副标题: `共 ${待回传订单.length} 张发票`,
      输出,
      终端,
      记录运行日志,
    }));
    输出发票回传结果({ 输出, 终端, 记录运行日志, 报告: 当前任务服务.state.invoiceReturnReport });
  } finally {
    // 保留回传完成的京东页面供人工核对，退出 CLI 时由退出前统一关闭。
    当前任务服务 = null;
  }
}

async function 查看订单({ 提问器, 输出, 终端 }) {
  return 打开订单状态管理({
    提问器,
    输出,
    终端,
    读取订单列表: () => 记录转列表(读取订单记录()),
    更新订单状态: (key, targetStatus) => 更新订单工作流状态(key, targetStatus),
    更新订单备注: (key, noteText) => 设置订单备注(key, noteText),
    复制订单号: (orderNumber) => {
      const copied = 复制到系统剪贴板(orderNumber);
      输出(copied ? '[完成] 订单号已复制。' : '[提示] 当前系统未能写入剪贴板，请手动复制。');
    },
    构建额外动作: (订单) => [{
      label: '安排跟进客服',
      execute: () => 安排订单客服({ 提问器, 输出, 订单 }),
    }],
    格式化队列附加信息: (订单) => {
      const noteText = String(订单.noteText || '').trim();
      const shortNote = noteText.length > 20 ? `${noteText.slice(0, 20)}…` : noteText;
      return `客服：${订单.assigneeName || '-'}${shortNote ? `｜备注：${shortNote}` : ''}`;
    },
    格式化详情附加信息: (订单) => `客服：${订单.assigneeName || '-'}｜备注：${订单.noteText || '-'}`,
  });
}

function 输出发票回传结果({ 输出, 终端 = null, 记录运行日志 = null, 报告 }) {
  if (!报告 || !Array.isArray(报告.items)) return;
  终端?.显示页面?.(`${菜单标题} · 发票回传结果`, '逐单文件、截图和完整动作明细已随执行过程直接显示在页面。');
  输出(`[回传] ${报告.summaryMessage || '暂无回传结果'}｜共 ${报告.items.length} 条`);
  const 成功数量 = 报告.items.filter((项目) => ['success', 'succeeded'].includes(String(项目.status || '').toLowerCase())).length;
  const 跳过数量 = 报告.items.filter((项目) => ['skip', 'skipped'].includes(String(项目.status || '').toLowerCase())).length;
  输出(`成功 ${成功数量}｜跳过 ${跳过数量}｜失败 ${报告.items.length - 成功数量 - 跳过数量}`);
  报告.items.forEach((项目) => {
    const 详情 = `[订单] ${项目.storeName || '-'}｜${项目.orderNumber || '-'}｜${项目.statusLabel || 项目.status || '-'}｜${项目.message || '-'}｜凭证：${项目.screenshotPath || '无'}`;
    if (typeof 记录运行日志 === 'function') 记录运行日志(详情);
  });
  const 需关注项目 = 报告.items.filter((项目) => !['success', 'succeeded'].includes(String(项目.status || '').toLowerCase()));
  if (需关注项目.length) {
    输出('');
    输出('[需关注]');
    需关注项目.slice(0, 8).forEach((项目) => 输出(`  ${项目.storeName || '-'}｜${项目.orderNumber || '-'}｜${项目.message || 项目.statusLabel || 项目.status || '-'}`));
    if (需关注项目.length > 8) 输出(`  另有 ${需关注项目.length - 8} 条，请到运行日志查看。`);
  }
}

async function 安排订单客服({ 提问器, 输出, 订单 }) {
  const 客服名单 = 读取店铺配置().customerServiceNames;
  输出(`当前客服名单：${客服名单.join('、') || '未配置'}；直接回车清空负责人。`);
  const 客服姓名 = (await 提问器.询问('客服姓名：')).trim();
  if (客服姓名 && !客服名单.includes(客服姓名)) {
    throw new Error(`客服 ${客服姓名} 不在当前名单中，请先配置客服名单。`);
  }
  设置订单跟进客服(订单.key, 客服姓名);
  输出(客服姓名 ? `[完成] 已安排 ${客服姓名} 跟进。` : '[完成] 已清空跟进客服。');
}

async function 手动新增订单({ 提问器, 输出, 终端 }) {
  const 店铺列表 = 读取店铺配置().stores;
  const 店铺 = (await 选择店铺({ 提问器, 店铺列表, 允许全部: false, 输出, 终端 }))[0];
  const 订单号 = await 提问器.询问('订单号：');
  const 备注 = await 提问器.询问('备注（可留空）：');
  const 结果 = 手动新增待处理订单({ store: 店铺, orderNumber: 订单号, noteText: 备注 });
  if (结果.archived) {
    输出(`[提示] 订单 ${String(订单号 || '').trim()} 已归档为已处理，未重新加入待处理。`);
    return;
  }
  输出(`[完成] ${结果.created ? '已新增' : '已更新'}订单：${结果.order.orderNumber}`);
}

async function 批量归档成功订单({ 输出 }) {
  const 结果 = 批量标记开票成功已登记订单为已处理();
  输出(`[完成] 已标记 ${结果.updatedCount} 条开票成功订单为已处理。`);
}

async function 批量启用或停用店铺({ 提问器, 输出 }) {
  const 配置 = 读取店铺配置();
  if (!配置.stores.length) {
    输出('[结果] 当前没有店铺配置。');
    return;
  }
  输出('[1] 全部启用  [2] 全部停用');
  const 操作 = (await 提问器.询问('请选择：')).trim();
  if (!['1', '2'].includes(操作)) throw new Error('店铺启用操作无效。');
  const enabled = 操作 === '1';
  保存店铺配置({
    ...配置,
    stores: 配置.stores.map((店铺) => ({ ...店铺, enabled })),
  });
  输出(`[完成] 已将 ${配置.stores.length} 家店铺全部${enabled ? '启用' : '停用'}。`);
}

async function 导出客服跟进表({ 输出 }) {
  const 结果 = 导出跟进表(记录转列表(读取订单记录()));
  输出(`[完成] 已导出 ${结果.count} 条跟进订单：${结果.filePath}`);
  输出(结果.copiedToClipboard ? '[完成] 跟进表已复制到剪贴板，可直接粘贴到表格。' : '[提示] 文件已生成，但当前系统未能写入剪贴板。');
}

async function 查看性能和清理({ 提问器, 输出 }) {
  const 性能摘要 = require('../controlCenter/performanceService').读取性能面板摘要();
  输出性能摘要({ 输出, 摘要: 性能摘要 });
  const 已处理数量 = Number(性能摘要.history?.handled || 0);
  if (已处理数量 <= 0) return;
  const 操作 = (await 提问器.询问(`是否归档清理 ${已处理数量} 条已处理记录？输入 y 确认：`)).trim().toLowerCase();
  if (!['y', 'yes', '是', '确认'].includes(操作)) {
    输出('[取消] 未清理已处理记录。');
    return;
  }
  const 结果 = 归档清理已处理记录();
  输出(`[完成] 已归档 ${结果.removedCount || 0} 条已处理记录。`);
  if (结果.backupPath) 输出(`备份位置：${结果.backupPath}`);
}

async function 查看运行日志({ 提问器, 输出, 终端, 读取日志 = 读取最近日志行 }) {
  return 打开运行日志视图({
    标题: `${菜单标题} · 历史文件`,
    提问器,
    终端,
    输出,
    读取日志,
  });
}

async function 打开项目目录({ 输出, 终端 }) {
  const 目录路径 = await 打开项目目录动作();
  输出(终端.主题.成功(`  已打开项目目录：${目录路径}`));
}

async function 打开凭证文件夹({ 输出, 终端 }) {
  const 凭证状态 = 读取最近凭证状态();
  const 凭证目录路径 = await 打开凭证目录();
  输出(终端.主题.成功(`  已打开凭证文件夹：${凭证目录路径}`));
  输出(凭证状态.fileCount > 0
    ? `  最近一轮凭证：${凭证状态.fileCount} 个文件。`
    : '  [提醒] 最近一轮没有可读取的截图文件，请查看识别失败信息。');
}

function 创建任务服务() {
  const state = new ControlCenterState(读取店铺结果(), 记录转列表(读取订单记录()));
  return new ControlCenterTaskService(state);
}

function 读取本地登录状态(店铺) {
  return fs.existsSync(获取店铺登录态文件路径(店铺.id))
    ? { status: 'ready', label: '已有登录态文件' }
    : { status: 'missing', label: '未发现登录态文件' };
}

function 格式化最近结果(结果) {
  if (!结果) return '暂无识别记录';
  const 凭证状态 = 结果.screenshotPath
    ? (fs.existsSync(结果.screenshotPath) ? '凭证可用' : '凭证缺失')
    : '无凭证';
  return `${结果.lastCheckedAt || '时间未知'}｜${结果.lastMessage || 结果.status || '已执行'}｜${凭证状态}`;
}

async function main() {
  await 启动命令行菜单({
    标题: 菜单标题,
    副标题: 菜单副标题,
    应用展示信息,
    菜单分组: [
      { 标题: '状态与配置', 项目: [
        { 编号: '1', 名称: '查看当前状态' },
        { 编号: '2', 名称: '配置店铺账号和检索范围' },
        { 编号: '3', 名称: '配置跟进客服名单' },
        { 编号: '16', 名称: '批量启用或停用店铺' },
      ] },
      { 标题: '催票与订单', 项目: [
        { 编号: '4', 名称: '单店人工登录并识别指定店铺' },
        { 编号: '5', 名称: '自动识别全部启用店铺' },
        { 编号: '6', 名称: '查看和处理订单状态（四个直接队列）' },
        { 编号: '7', 名称: '手动新增待处理订单' },
        { 编号: '8', 名称: '批量标记开票成功订单' },
        { 编号: '12', 名称: '导出客服跟进表' },
      ] },
      { 标题: '发票处理', 项目: [{ 编号: '9', 名称: '批量回传待开票发票' }] },
      { 标题: '凭证查看', 项目: [
        { 编号: '10', 名称: '打开凭证文件夹' },
      ] },
      { 标题: '维护与诊断', 项目: [
        { 编号: '13', 名称: '查看性能并归档已处理记录' },
        { 编号: '14', 名称: '分页查看最近运行日志' },
        { 编号: '15', 名称: '打开项目目录' },
      ] },
      { 标题: '系统', 项目: [{ 编号: '0', 名称: '退出' }] },
    ],
    页面标题: {
      '1': '当前状态', '2': '店铺配置', '3': '客服名单', '4': '单店识别', '5': '批量识别',
      '6': '订单处理', '7': '手动新增订单', '8': '批量归档', '9': '发票回传',
      '10': '打开凭证文件夹', '12': '客服跟进表',
      '13': '性能与归档', '14': '运行日志', '15': '项目目录', '16': '批量启停店铺',
    },
    菜单动作: {
      '1': 查看当前状态,
      '2': 编辑配置,
      '3': 编辑客服名单,
      '4': 人工登录并识别,
      '5': 自动识别全部,
      '6': 查看订单,
      '7': 手动新增订单,
      '8': 批量归档成功订单,
      '9': 批量回传待开票,
      '10': 打开凭证文件夹,
      '12': 导出客服跟进表,
      '13': 查看性能和清理,
      '14': 查看运行日志,
      '15': 打开项目目录,
      '16': 批量启用或停用店铺,
    },
    首页输出: ({ 输出, 终端 }) => {
      const 配置 = 读取店铺配置();
      const 订单数据 = 读取订单记录();
      输出首页总览({
        输出,
        终端,
        配置,
        结果对象: 读取店铺结果(),
        订单列表: 记录转列表(订单数据),
      });
    },
    退出前: async () => {
      if (当前任务服务) await 当前任务服务.shutdownAllRunningTasks('CLI 退出');
      await 关闭全部浏览器上下文().catch(() => {});
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
  创建任务进度展示,
  输出发票回传结果,
  查看运行日志,
  打开凭证文件夹,
};
