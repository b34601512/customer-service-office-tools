const {
  读取发票系统配置,
  保存发票系统配置,
  构建安全发票系统配置视图,
  规范化发票查询最近天数,
} = require('../config/invoiceSystemConfig');
const { 导入旧京东发票系统配置 } = require('../config/legacyJdConfigImporter');
const { 验证诺诺登录, 关闭待人工登录会话 } = require('../nuonuo/loginVerifier');
const { 批量下载发票: 默认批量下载发票 } = require('../nuonuo/invoiceDownloader');
const { 查找本地发票, 列出本地发票 } = require('../invoices/invoiceFileStore');
const { 获取下载文件夹路径, 打开下载文件夹 } = require('../server/downloadsFolder');

function 创建命令行操作({
  readInvoiceSystemConfig = 读取发票系统配置,
  saveInvoiceSystemConfig = 保存发票系统配置,
  buildSafeInvoiceSystemConfigView = 构建安全发票系统配置视图,
  normalizeInvoiceSearchRangeDays = 规范化发票查询最近天数,
  importLegacyJdInvoiceConfig = 导入旧京东发票系统配置,
  verifyNuonuoLogin = 验证诺诺登录,
  closePendingLoginSession = 关闭待人工登录会话,
  batchDownloadInvoices = 默认批量下载发票,
  findLocalInvoice = 查找本地发票,
  listLocalInvoices = 列出本地发票,
  getDownloadsDirectory = 获取下载文件夹路径,
  openDownloadsDirectory = 打开下载文件夹,
  output = (...messages) => console.log(...messages),
  theme = null,
} = {}) {
  const 输出消息 = 创建主题输出(output, theme);
  return {
    查看当前状态: () => 查看当前状态({ readInvoiceSystemConfig, buildSafeInvoiceSystemConfigView, verifyNuonuoLogin, getDownloadsDirectory, output: 输出消息, theme }),
    配置发票系统: (命令行提问器) => 配置发票系统({ 命令行提问器, readInvoiceSystemConfig, saveInvoiceSystemConfig, buildSafeInvoiceSystemConfigView, normalizeInvoiceSearchRangeDays, output: 输出消息, theme }),
    检查诺诺登录: (命令行提问器) => 检查诺诺登录({ 命令行提问器, readInvoiceSystemConfig, verifyNuonuoLogin, closePendingLoginSession, output: 输出消息 }),
    批量下载发票: (命令行提问器) => 批量下载发票({ 命令行提问器, readInvoiceSystemConfig, batchDownloadInvoices, output: 输出消息 }),
    查看本地发票: (命令行提问器) => 查看本地发票({ 命令行提问器, findLocalInvoice, listLocalInvoices, output: 输出消息 }),
    打开下载目录: () => 打开下载目录({ getDownloadsDirectory, openDownloadsDirectory, output: 输出消息 }),
    导入旧京东配置: () => 导入旧京东配置({ importLegacyJdInvoiceConfig, output: 输出消息, theme }),
    关闭: () => closePendingLoginSession(),
  };
}

function 创建主题输出(output, theme) {
  if (!theme) return output;
  return (...messages) => output(...messages.map((message) => 给命令行消息着色(message, theme)));
}

function 给命令行消息着色(message, theme) {
  const 标准消息 = String(message ?? '');
  if (/^\[(成功|完成)\]/.test(标准消息)) return theme.成功(标准消息);
  if (/^\[(失败|错误)\]/.test(标准消息)) return theme.失败(标准消息);
  if (/^\[(等待|提示|取消|检查)\]/.test(标准消息)) return theme.提醒(标准消息);
  if (/^\[目录\]/.test(标准消息)) return theme.链接(标准消息);
  if (/^\[(配置|迁移|结果|状态|当前)\]/.test(标准消息)) return theme.强调(标准消息);
  return 标准消息;
}

async function 查看当前状态({ readInvoiceSystemConfig, buildSafeInvoiceSystemConfigView, verifyNuonuoLogin, getDownloadsDirectory, output, theme }) {
  // 这个函数解决命令行首页需要一次展示当前运行状态的问题。
  const config = readInvoiceSystemConfig();
  const safeConfig = buildSafeInvoiceSystemConfigView(config);
  output('');
  if (theme) {
    output(`${theme.弱化('[状态]')} ${theme.强调('命令行下载中心运行中')}`);
  } else {
    output('[状态] 命令行下载中心运行中');
  }
  输出安全配置摘要(safeConfig, output, theme);
  if (theme) {
    output(`${theme.弱化('[检查]')} ${theme.正文('正在实时检查诺诺登录状态……')}`);
  } else {
    output('[检查] 正在实时检查诺诺登录状态……');
  }
  const 登录状态 = await 读取当前登录状态({ config, verifyNuonuoLogin });
  输出诺诺登录状态(登录状态, output, theme);
  if (theme) {
    output(`${theme.弱化('[目录]')} ${theme.链接(`发票下载目录：${getDownloadsDirectory()}`)}`);
  } else {
    output(`[目录] 发票下载目录：${getDownloadsDirectory()}`);
  }
}

async function 读取当前登录状态({ config, verifyNuonuoLogin }) {
  if (!config?.username || !config?.password) {
    return { status: 'not_configured', message: '诺诺账号或密码未配置。' };
  }
  try {
    const loginResult = await verifyNuonuoLogin(config, {
      headless: true,
      keepBrowserOpenOnManualLogin: false,
      timeoutMs: 15_000,
    });
    if (loginResult?.ok) {
      return {
        status: 'logged_in',
        invoiceSubjectCount: loginResult.invoiceSubjectCount || 0,
      };
    }
    const message = String(loginResult?.message || '诺诺登录态未通过真实校验。');
    if (loginResult?.requiresManualLogin || /验证码|隐私|人工|不能判定/.test(message)) {
      return { status: 'manual_required', message };
    }
    return { status: 'not_logged_in', message };
  } catch (error) {
    return { status: 'unknown', message: error.message };
  }
}

function 输出诺诺登录状态(loginStatus, output, theme = null) {
  const 状态定义 = {
    logged_in: { label: '已登录', color: '成功' },
    not_logged_in: { label: '未登录或已失效', color: '失败' },
    manual_required: { label: '需要人工处理', color: '提醒' },
    not_configured: { label: '未配置账号', color: '失败' },
    unknown: { label: '暂时无法确认', color: '提醒' },
  };
  const 当前状态 = 状态定义[loginStatus?.status] || 状态定义.unknown;
  const 主体数量 = loginStatus?.status === 'logged_in'
    ? `（可用开票主体 ${loginStatus.invoiceSubjectCount || 0} 个）`
    : '';
  if (theme) {
    const 状态文字 = theme[当前状态.color](当前状态.label);
    output(`${theme.标签('[登录状态]')} ${状态文字}${theme.弱化(主体数量)}`);
    if (loginStatus?.message) {
      const 说明颜色 = loginStatus.status === 'unknown' ? theme.提醒 : theme.弱化;
      output(`${theme.弱化('[说明]')} ${说明颜色(loginStatus.message)}`);
    }
    return;
  }
  output(`[登录状态] ${当前状态.label}${主体数量}`);
  if (loginStatus?.message) output(`[说明] ${loginStatus.message}`);
}

function 输出安全配置摘要(safeConfig, output, theme = null) {
  // 这个函数解决账号、密码等敏感信息不能直接出现在终端的问题。
  if (theme) {
    输出彩色配置项(output, theme, '诺诺地址', safeConfig.targetUrl, theme.链接);
    输出彩色配置项(output, theme, '诺诺账号', safeConfig.hasUsername ? safeConfig.usernameMasked : '未配置', theme.强调);
    输出彩色配置项(
      output,
      theme,
      '诺诺密码',
      safeConfig.hasPassword ? '已配置' : '未配置',
      safeConfig.hasPassword ? theme.成功 : theme.失败,
    );
    输出彩色配置项(output, theme, '检索最近天数', `${safeConfig.invoiceSearchRangeDays} 天`, theme.强调);
    输出彩色配置项(
      output,
      theme,
      '查询全部开票主体',
      safeConfig.searchAllInvoiceSubjects ? '是' : '否',
      safeConfig.searchAllInvoiceSubjects ? theme.成功 : theme.提醒,
    );
    return;
  }
  output(`[配置] 诺诺地址：${safeConfig.targetUrl || '未配置'}`);
  output(`[配置] 诺诺账号：${safeConfig.hasUsername ? safeConfig.usernameMasked : '未配置'}`);
  output(`[配置] 诺诺密码：${safeConfig.hasPassword ? '已配置' : '未配置'}`);
  output(`[配置] 检索最近天数：${safeConfig.invoiceSearchRangeDays} 天`);
  output(`[配置] 查询全部开票主体：${safeConfig.searchAllInvoiceSubjects ? '是' : '否'}`);
}

function 输出彩色配置项(output, theme, 字段名称, 字段值, 值着色函数) {
  output(`${theme.弱化('[配置]')} ${theme.正文(`${字段名称}：`)} ${值着色函数(String(字段值 || '未配置'))}`);
}

async function 配置发票系统({ 命令行提问器, readInvoiceSystemConfig, saveInvoiceSystemConfig, buildSafeInvoiceSystemConfigView, normalizeInvoiceSearchRangeDays, output, theme }) {
  // 这个函数解决首次运行和日常修改账号、密码、检索范围都必须有命令行入口的问题。
  const 当前配置 = readInvoiceSystemConfig();
  const 当前安全配置 = buildSafeInvoiceSystemConfigView(当前配置);
  output(`[当前] 诺诺账号：${当前安全配置.hasUsername ? 当前安全配置.usernameMasked : '未配置'}`);
  const 输入账号 = await 命令行提问器.询问('诺诺账号（回车保留当前值）：');
  const 用户名 = 输入账号.trim() || 当前配置.username;
  if (!用户名) throw new Error('诺诺账号不能为空。');

  const 输入密码 = await 命令行提问器.询问密码('诺诺密码（回车保留当前值）：');
  const 密码 = 输入密码 || 当前配置.password;
  if (!密码) throw new Error('诺诺密码不能为空。');

  const 输入检索天数 = await 命令行提问器.询问(`检索最近天数（当前 ${当前配置.invoiceSearchRangeDays}，回车保留）：`);
  const 检索最近天数 = 读取检索天数(输入检索天数, 当前配置.invoiceSearchRangeDays, normalizeInvoiceSearchRangeDays);
  const 新配置 = saveInvoiceSystemConfig({
    ...当前配置,
    username: 用户名,
    password: 密码,
    invoiceSearchRangeDays: 检索最近天数,
  });
  output('[完成] 诺诺配置已保存。');
  输出安全配置摘要(buildSafeInvoiceSystemConfigView(新配置), output, theme);
}

function 读取检索天数(输入检索天数, 当前检索天数, normalizeInvoiceSearchRangeDays) {
  // 这个函数解决空输入沿用旧值、非空输入必须经过统一范围校验的问题。
  const 标准输入 = String(输入检索天数 || '').trim();
  return normalizeInvoiceSearchRangeDays(标准输入 || 当前检索天数);
}

async function 检查诺诺登录({ 命令行提问器, readInvoiceSystemConfig, verifyNuonuoLogin, closePendingLoginSession, output }) {
  // 这个函数解决命令行登录检查需要等待人工完成验证码而不能使用固定等待的问题。
  const config = readInvoiceSystemConfig();
  if (!config.username || !config.password) {
    output('[提示] 请先选择“配置诺诺账号”。');
    return false;
  }

  try {
    let loginResult = await verifyNuonuoLogin(config, { headless: false, keepBrowserOpenOnManualLogin: true });
    while (!loginResult.ok && loginResult.requiresManualLogin) {
      输出人工登录提示(loginResult, output);
      const 用户选择 = await 命令行提问器.询问('完成诺诺登录后按回车继续，输入 q 取消：');
      if (用户选择.trim().toLowerCase() === 'q') {
        await closePendingLoginSession();
        output('[取消] 已取消本次登录检查。');
        return false;
      }
      loginResult = await verifyNuonuoLogin(config, { headless: false, keepBrowserOpenOnManualLogin: true });
    }

    if (loginResult.ok) {
      output(`[成功] 诺诺登录检查通过，可用开票主体 ${loginResult.invoiceSubjectCount || 0} 个。`);
      return true;
    }
    await closePendingLoginSession();
    output(`[失败] ${loginResult.message || '诺诺登录检查未通过。'}`);
    return false;
  } catch (error) {
    await closePendingLoginSession();
    output(`[失败] 诺诺登录检查出错：${error.message}`);
    return false;
  }
}

function 输出人工登录提示(loginResult, output) {
  // 这个函数解决人工登录时必须明确告诉用户下一步动作和证据位置的问题。
  output(`[等待] ${loginResult.message || '请在诺诺窗口完成登录。'}`);
  if (loginResult.screenshotPath) output(`[证据] 登录截图：${loginResult.screenshotPath}`);
}

async function 批量下载发票({ 命令行提问器, readInvoiceSystemConfig, batchDownloadInvoices, output }) {
  // 这个函数解决命令行一次输入多张订单后复用现有批量下载链路的问题。
  const 订单号列表 = await 读取订单号列表(命令行提问器, output);
  if (!订单号列表.length) {
    output('[提示] 未输入有效订单号，本次不执行下载。');
    return false;
  }
  const 是否强制下载 = 读取是否确认(await 命令行提问器.询问('是否重新下载已有发票？输入 y 确认，回车跳过：'));
  const config = readInvoiceSystemConfig();
  try {
    output(`[开始] 准备下载 ${订单号列表.length} 张发票。`);
    const 下载结果列表 = await batchDownloadInvoices(
      { orderNumbers: 订单号列表, force: 是否强制下载 },
      { fileType: 'pdf', invoiceSystemConfig: config, invoiceSearchRangeDays: config.invoiceSearchRangeDays },
    );
    输出下载结果(下载结果列表, output);
    return true;
  } catch (error) {
    输出下载失败(error, output);
    return false;
  }
}

async function 读取订单号列表(命令行提问器, output) {
  // 这个函数解决用户可以逐行输入或一次粘贴多条订单号的问题。
  output('请输入订单号，每行一条；空行结束。');
  const 已读取订单号集合 = new Set();
  while (true) {
    const 输入内容 = await 命令行提问器.询问('订单号：');
    if (!输入内容.trim()) break;
    解析订单号文本(输入内容).forEach((订单号) => 已读取订单号集合.add(订单号));
  }
  return Array.from(已读取订单号集合);
}

function 解析订单号文本(输入内容) {
  // 这个函数解决订单号之间使用空格、逗号、分号或换行时都能统一识别的问题。
  return String(输入内容 || '')
    .split(/[\s,，;；]+/)
    .map((订单号) => 订单号.trim())
    .filter(Boolean);
}

function 读取是否确认(输入内容) {
  // 这个函数解决批量下载的强制重下载选项只接受明确确认的问题。
  return ['y', 'yes', '是', '确认'].includes(String(输入内容 || '').trim().toLowerCase());
}

function 输出下载结果(下载结果列表, output) {
  // 这个函数解决批量下载完成后必须逐单给出真实文件路径的问题。
  const 标准结果列表 = Array.isArray(下载结果列表) ? 下载结果列表 : [];
  output(`[完成] 成功取得 ${标准结果列表.length} 张发票。`);
  标准结果列表.forEach((发票记录) => {
    output(`  ${发票记录.orderNumber || '-'} -> ${发票记录.invoiceFilePath || '未返回文件路径'}`);
  });
}

function 输出下载失败(error, output) {
  // 这个函数解决下载部分成功时也必须把已找到和仍缺失订单分别告诉用户的问题。
  output(`[失败] ${error.message}`);
  if (Array.isArray(error.missingOrders) && error.missingOrders.length) {
    output(`[缺失] ${error.missingOrders.map((order) => order.orderNumber).join('、')}`);
  }
  if (Array.isArray(error.localFiles) && error.localFiles.length) {
    output('[已取得]');
    error.localFiles.forEach((发票记录) => {
      output(`  ${发票记录.orderNumber || '-'} -> ${发票记录.invoiceFilePath || '未返回文件路径'}`);
    });
  }
}

async function 查看本地发票({ 命令行提问器, findLocalInvoice, listLocalInvoices, output }) {
  // 这个函数解决用户既可以按订单号查一张，也可以直接查看全部本地发票的问题。
  const 输入订单号 = await 命令行提问器.询问('输入订单号查询，直接回车查看全部：');
  const 订单号 = 输入订单号.trim();
  if (订单号) {
    输出单张本地发票(findLocalInvoice(订单号), output);
    return;
  }
  const 发票列表 = listLocalInvoices();
  if (!发票列表.length) {
    output('[结果] 当前没有可用的本地发票。');
    return;
  }
  output(`[结果] 当前共有 ${发票列表.length} 张本地发票：`);
  发票列表.forEach((发票记录) => 输出本地发票记录(发票记录, output));
}

function 输出单张本地发票(发票记录, output) {
  // 这个函数解决按订单号查询不到结果时必须明确说明的问题。
  if (!发票记录) {
    output('[结果] 没有找到可用的本地发票。');
    return;
  }
  输出本地发票记录(发票记录, output);
}

function 输出本地发票记录(发票记录, output) {
  // 这个函数解决本地发票记录的关键字段需要稳定、易读地展示的问题。
  output(`  订单号：${发票记录.orderNumber || '-'}`);
  output(`  来源：${发票记录.source || '-'}`);
  output(`  开票主体：${发票记录.invoiceSubjectName || '-'}`);
  output(`  发票号码：${发票记录.invoiceNumber || '-'}`);
  output(`  文件路径：${发票记录.invoiceFilePath || '-'}`);
  output(`  更新时间：${发票记录.updatedAt || '-'}`);
}

async function 打开下载目录({ getDownloadsDirectory, openDownloadsDirectory, output }) {
  // 这个函数解决命令行用户既能看到目录路径，也能按需打开资源管理器的问题。
  const 下载目录路径 = getDownloadsDirectory();
  output(`[目录] ${下载目录路径}`);
  try {
    await openDownloadsDirectory();
    output('[完成] 已请求系统打开下载目录。');
  } catch (error) {
    output(`[失败] 打开下载目录失败：${error.message}`);
  }
}

function 导入旧京东配置({ importLegacyJdInvoiceConfig, output, theme }) {
  // 这个函数解决旧京东项目的账号和登录态迁移需要在命令行内可执行的问题。
  try {
    const 导入结果 = importLegacyJdInvoiceConfig();
    output('[完成] 旧京东配置导入成功。');
    输出安全配置摘要(导入结果.config || {}, output, theme);
    output(`[迁移] 登录态：${导入结果.copiedAuthState ? '已复制' : '未找到，需重新登录'}`);
    return 导入结果;
  } catch (error) {
    output(`[失败] ${error.message}`);
    return null;
  }
}

module.exports = {
  创建命令行操作,
  创建主题输出,
  给命令行消息着色,
  读取当前登录状态,
  输出诺诺登录状态,
  输出彩色配置项,
  输出安全配置摘要,
  解析订单号文本,
  读取是否确认,
  读取检索天数,
};
