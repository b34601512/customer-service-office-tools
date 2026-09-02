const { 初始化运行目录 } = require('../common/fs');
const { 打印日志 } = require('../common/logger');
const { createServer } = require('./createServer');
const { 关闭待人工登录会话 } = require('../nuonuo/loginVerifier');
const { 关闭共享诺诺浏览器会话 } = require('../nuonuo/nuonuoBrowserSession');
const { 登记项目进程, 取消登记项目进程, 清理登记残留进程 } = require('../common/processRegistry');

const 默认端口 = 39410;
const 默认主机 = '127.0.0.1';
const 服务名称 = '通用发票下载中心';

function 构建服务地址(port = 默认端口, host = 默认主机) {
  // 这个函数解决启动提示和健康检查共用同一个服务地址的问题。
  return `http://${host}:${port}`;
}

function 监听服务(server, port = 默认端口, host = 默认主机) {
  // 这个函数解决 server.listen 的异步错误无法被 main 捕获的问题。
  return new Promise((resolve, reject) => {
    const 处理启动失败 = (error) => {
      server.off('listening', 处理启动成功);
      reject(error);
    };
    const 处理启动成功 = () => {
      server.off('error', 处理启动失败);
      resolve();
    };
    server.once('error', 处理启动失败);
    server.once('listening', 处理启动成功);
    server.listen(port, host);
  });
}

async function 检查下载中心服务已运行(port = 默认端口, host = 默认主机) {
  // 这个函数解决端口被占用时确认占用者是不是下载中心本身的问题。
  const healthUrl = `${构建服务地址(port, host)}/api/health`;
  const response = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) return false;
  const data = await response.json();
  return data?.ok === true && data?.service === 服务名称;
}

async function 安全检查下载中心服务已运行(port = 默认端口, host = 默认主机) {
  // 这个函数只把健康检查失败转成 false，因为失败本身就是“不是本服务”的证据。
  try {
    return await 检查下载中心服务已运行(port, host);
  } catch {
    return false;
  }
}

function 关闭HTTP服务(server) {
  // 这个函数解决退出时 HTTP 端口必须释放的问题。
  return new Promise((resolve) => {
    if (!server?.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

async function 启动下载中心服务({ port = 默认端口, host = 默认主机 } = {}) {
  // 这个函数解决下载中心服务启动和重复启动识别的问题。
  const serviceStartedAt = new Date().toISOString();
  let 已开始退出 = false;
  let server;
  const 统一退出 = async (reason = '未说明原因') => {
    // 这个函数解决接口请求、终端信号和异常收尾都走同一套退出流程。
    if (已开始退出) return;
    已开始退出 = true;
    let exitCode = 0;
    打印日志('后台退出', '服务生命周期', `准备退出：${reason}`);
    try {
      await 关闭待人工登录会话();
      await 关闭共享诺诺浏览器会话();
    } catch (error) {
      exitCode = 1;
      打印日志('后台退出', '登录会话清理失败', error.message);
    }
    await 关闭HTTP服务(server).catch((error) => {
      exitCode = 1;
      打印日志('后台退出', 'HTTP服务关闭失败', error.message);
    });
    取消登记项目进程(process.pid);
    打印日志('后台退出', '服务生命周期', '已执行登录会话和 HTTP 服务退出流程');
    process.exit(exitCode);
  };

  server = createServer({
    serviceStartedAt,
    requestShutdown: 统一退出,
  });
  try {
    await 监听服务(server, port, host);
  } catch (error) {
    if (error.code === 'EADDRINUSE' && await 安全检查下载中心服务已运行(port, host)) {
      打印日志('下载中心启动', 'HTTP服务', `服务已在运行：${构建服务地址(port, host)}`);
      打印日志('下载中心启动', '健康检查', `通过：${构建服务地址(port, host)}/api/health`);
      return { alreadyRunning: true, server: null };
    }
    if (error.code === 'EADDRINUSE') {
      const conflictError = new Error(`端口 ${port} 已被其他程序占用，下载中心无法启动。`);
      conflictError.cause = error;
      throw conflictError;
    }
    throw error;
  }

  打印日志('下载中心启动', 'HTTP服务', `已启动：${构建服务地址(port, host)}`);
  打印日志('下载中心启动', '健康检查', `可访问：${构建服务地址(port, host)}/api/health`);
  登记项目进程({ pid: process.pid, role: 'service', label: `HTTP服务 ${构建服务地址(port, host)}` });

  process.once('SIGINT', () => {
    统一退出('收到 SIGINT').catch((error) => {
      打印日志('后台退出', '退出失败', error.message);
      process.exit(1);
    });
  });
  process.once('SIGTERM', () => {
    统一退出('收到 SIGTERM').catch((error) => {
      打印日志('后台退出', '退出失败', error.message);
      process.exit(1);
    });
  });
  process.once('SIGBREAK', () => {
    统一退出('收到 SIGBREAK').catch((error) => {
      打印日志('后台退出', '退出失败', error.message);
      process.exit(1);
    });
  });

  return { alreadyRunning: false, server };
}

async function main() {
  // 这个函数解决启动本地发票下载中心服务的问题。
  初始化运行目录();
  if (process.env.INVOICE_DOWNLOAD_CENTER_STARTUP_CLEANED !== '1') {
    清理登记残留进程({ excludePids: [process.pid] });
  }
  await 启动下载中心服务();
}

if (require.main === module) {
  main().catch((error) => {
    打印日志('下载中心启动', '启动失败', error.message);
    if (error.cause) {
      打印日志('下载中心启动', '原始错误', error.cause.message);
    }
    process.exit(1);
  });
}

module.exports = {
  默认端口,
  默认主机,
  构建服务地址,
  监听服务,
  检查下载中心服务已运行,
  启动下载中心服务,
  关闭HTTP服务,
};
