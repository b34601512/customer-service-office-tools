const { 打印日志 } = require('../common/logger');
const {
  等待直到,
  读取页面诊断信息,
  格式化页面诊断信息,
} = require('../browser/dynamicWait');
const { 是登录页面 } = require('../browser/ensureAuthenticatedPage');

function 规范化页面文本(文本) {
  // 解决：把京东页面里零散换行和空格压成稳定文本，方便判断业务区是否加载完成。
  return String(文本 || '').replace(/\s+/g, ' ').trim();
}

function 是开票治理业务数据就绪(页面文本) {
  // 解决：京东新版页面会先出现导航外壳，必须等业务数据区出现后才能开始提取。
  return 获取开票治理业务数据状态(页面文本).候选就绪;
}

function 获取开票治理业务数据状态(页面文本) {
  // 解决：区分真实分页结果和京东表格初始渲染时短暂出现的空态占位。
  const 文本 = 规范化页面文本(页面文本);
  if (!文本) {
    return {
      候选就绪: false,
      状态标识: '页面正文为空',
      需要稳定: true,
    };
  }

  if (!文本.includes('政企发票考核')) {
    return {
      候选就绪: false,
      状态标识: '未进入开票治理页',
      需要稳定: true,
    };
  }

  const 明细总数匹配 = 文本.match(/总共\s*(\d+)\s*条/);
  if (明细总数匹配) {
    const 明细总数 = Number(明细总数匹配[1]);
    return {
      候选就绪: true,
      状态标识: `明细总数=${明细总数}`,
      需要稳定: 明细总数 === 0,
    };
  }

  if (文本.includes('明细数据重要提示') && 文本.includes('暂无数据')) {
    return {
      候选就绪: true,
      状态标识: '空态占位',
      需要稳定: true,
    };
  }

  return {
    候选就绪: false,
    状态标识: '业务区未完成',
    需要稳定: true,
  };
}

async function 读取页面正文(page) {
  // 解决：集中读取 body 文本，调用方只关心业务状态，不关心 Playwright 细节。
  return page.locator('body').innerText().catch(() => '');
}

async function 等待开票治理业务数据就绪(page, 选项 = {}) {
  // 解决：等京东异步接口把核心指标和明细区渲染出来，避免巡检过早误判为 0。
  const {
    timeoutMs = 180_000,
    intervalMs = 500,
    空态稳定次数 = 4,
    诊断日志间隔Ms = 15_000,
  } = 选项;
  let 已打印等待日志 = false;
  let 上次状态标识 = '';
  let 连续状态次数 = 0;
  let 上次诊断日志时间 = 0;
  let 上次诊断状态标识 = '';

  try {
    await 等待直到(page, async () => {
      const 页面文本 = await 读取页面正文(page);
      const 当前地址 = String(page.url() || '').trim();
      if (当前地址 && 是登录页面(当前地址, 页面文本)) {
        throw new Error('登录态失效，页面已跳转到京东登录页。');
      }
      const 数据状态 = 获取开票治理业务数据状态(页面文本);

      if (数据状态.状态标识 === 上次状态标识) {
        连续状态次数 += 1;
      } else {
        上次状态标识 = 数据状态.状态标识;
        连续状态次数 = 1;
      }

      if (数据状态.候选就绪 && (!数据状态.需要稳定 || 连续状态次数 >= 空态稳定次数)) {
        打印日志('数据提取', '页面就绪', `开票治理业务数据已加载完成：${数据状态.状态标识}`);
        return true;
      }

      const 当前时间 = Date.now();
      const 状态已变化 = 数据状态.状态标识 !== 上次诊断状态标识;
      const 到达诊断间隔 = 当前时间 - 上次诊断日志时间 >= 诊断日志间隔Ms;
      if (状态已变化 || 到达诊断间隔 || !已打印等待日志) {
        const 诊断信息 = await 读取页面诊断信息(page);
        已打印等待日志 = true;
        上次诊断日志时间 = 当前时间;
        上次诊断状态标识 = 数据状态.状态标识;
        打印日志(
          '数据提取',
          '页面就绪',
          `继续等待开票治理业务状态：${数据状态.状态标识}｜${格式化页面诊断信息(诊断信息)}`,
        );
      }

      return false;
    }, {
      timeoutMs,
      intervalMs,
      超时消息: '等待开票治理业务数据加载超时，页面未出现核心指标或明细数据。',
    });
  } catch (错误) {
    const 诊断信息 = await 读取页面诊断信息(page);
    const 诊断文本 = 格式化页面诊断信息(诊断信息);
    打印日志('数据提取', '页面就绪', `等待开票治理业务状态失败：${错误.message}｜${诊断文本}`);
    throw new Error(`${错误.message}｜${诊断文本}`);
  }
}

module.exports = {
  等待开票治理业务数据就绪,
  是开票治理业务数据就绪,
};
