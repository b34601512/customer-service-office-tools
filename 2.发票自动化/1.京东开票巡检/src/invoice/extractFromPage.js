const { 打印日志 } = require('../common/logger');
const { 规范化记录 } = require('./normalizeRecord');
const { 从页面正文解析明细记录 } = require('./invoiceDetailTextParser');
const { 从页面文本提取开票指标 } = require('./invoicePageMetrics');
const { 识别开票明细状态, 补充开票明细状态, 统计开票明细状态 } = require('./invoiceDetailStatus');

async function 从页面提取记录(page) {
  // 解决：直接从页面可见表格和关键词区域里提取待开票内容。
  打印日志('数据提取', '页面提取', '开始扫描页面可见内容');

  const 提取结果 = await page.evaluate(() => {
    const 结果 = [];
    const 已见摘要 = new Set();

    const 可见 = (元素) => {
      if (!元素) {
        return false;
      }
      const 样式 = window.getComputedStyle(元素);
      const 矩形 = 元素.getBoundingClientRect();
      return 样式.display !== 'none' && 样式.visibility !== 'hidden' && 矩形.width > 0 && 矩形.height > 0;
    };

    const 清洗文本 = (文本) => String(文本 ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r/g, '')
      .split('\n')
      .map((行) => 行.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' | ')
      .trim();

    const bodyText = 清洗文本(document.body?.innerText || '');

    const dataToLine = (数据) => Object.entries(数据)
      .map(([键, 值]) => {
        const 规范键 = 清洗文本(键);
        const 规范值 = 清洗文本(值);
        return 规范键 && 规范值 ? `${规范键}:${规范值}` : (规范键 || 规范值);
      })
      .filter(Boolean)
      .join('；');

    const 添加记录 = (来源, 数据) => {
      const 摘要 = 清洗文本(数据.摘要 || 数据.文本 || dataToLine(数据));
      if (!摘要 || 已见摘要.has(`${来源}:${摘要}`)) {
        return;
      }
      已见摘要.add(`${来源}:${摘要}`);
      结果.push({ source: 来源, ...数据 });
    };

    const 是空数据行 = (文本) => !文本 || 文本.includes('暂无数据') || 文本.includes('总共0条');
    const 像明细表头 = (表头列表) => /销售订单编号|发票上传|最晚上传|倒计时/.test(表头列表.join(' | '));
    const 像明细行 = (单元格列表, 表头列表 = []) => {
      if (单元格列表.length < 3) {
        return false;
      }

      const 合并文本 = 单元格列表.join(' | ');
      if (是空数据行(合并文本)) {
        return false;
      }

      if (/销售订单编号|发票上传/.test(合并文本) && !/\d{10,}/.test(合并文本)) {
        return false;
      }

      if (像明细表头(表头列表)) {
        return /\d{10,}/.test(合并文本) || /未逾期|还有\s*\d+\s*天逾期|已逾期|去开票/.test(合并文本);
      }

      return /订单|上传|倒计时|抬头|税号|时间|操作/.test(合并文本);
    };

    Array.from(document.querySelectorAll('table'))
      .filter(可见)
      .forEach((表格, 表格索引) => {
        const 表头 = Array.from(表格.querySelectorAll('thead th'))
          .map((元素) => 清洗文本(元素.innerText))
          .filter(Boolean);

        const 行集合 = Array.from(表格.querySelectorAll('tbody tr')).length > 0
          ? Array.from(表格.querySelectorAll('tbody tr'))
          : Array.from(表格.querySelectorAll('tr'));
        行集合.forEach((行元素, 行索引) => {
          if (!可见(行元素)) {
            return;
          }

          const 单元格 = Array.from(行元素.querySelectorAll('td'))
            .map((元素) => 清洗文本(元素.innerText))
            .filter(Boolean);

          if (!单元格.length) {
            return;
          }

          if (!像明细行(单元格, 表头)) {
            return;
          }

          const 记录 = {};
          单元格.forEach((值, 索引) => {
            const 键 = 表头[索引] || `列${索引 + 1}`;
            记录[键] = 值;
          });

          添加记录('页面表格', {
            表格序号: 表格索引 + 1,
            行序号: 行索引 + 1,
            ...记录,
          });
          });
      });

    Array.from(document.querySelectorAll('[role="row"], .ant-table-row, .el-table__row'))
      .filter(可见)
      .forEach((行元素, 行索引) => {
        const 单元格 = Array.from(行元素.querySelectorAll('[role="cell"], td, .ant-table-cell, .cell'))
          .map((元素) => 清洗文本(元素.innerText))
          .filter(Boolean);

        if (!像明细行(单元格)) {
          return;
        }

        const 记录 = Object.fromEntries(单元格.map((值, 索引) => [`列${索引 + 1}`, 值]));
        添加记录('组件表格', {
          行序号: 行索引 + 1,
          ...记录,
        });
      });

    return {
      title: document.title,
      url: location.href,
      bodyText,
      records: 结果,
    };
  });

  const 页面文本指标 = 从页面文本提取开票指标(提取结果.bodyText);
  let 原始记录列表 = 提取结果.records;
  if (原始记录列表.length === 0 && 页面文本指标.明细总数 > 0) {
    原始记录列表 = 从页面正文解析明细记录(提取结果.bodyText);
  }

  if (
    页面文本指标.待上传发票订单数 > 0
    && !原始记录列表.some((记录) => 识别开票明细状态(记录).需要登记)
  ) {
    原始记录列表 = [
      构建核心指标待登记记录(页面文本指标),
      ...原始记录列表,
    ];
  }

  if (
    原始记录列表.length === 0
    && !页面文本指标.上传指标已识别
    && 页面文本指标.页面警告订单数 > 0
  ) {
    原始记录列表 = [{
      source: '顶部警告',
      待处理订单数: String(页面文本指标.页面警告订单数),
      文本: `顶部提示：您有${页面文本指标.页面警告订单数}笔订单剩余处理时间不足5天（即将逾期）`,
    }];
  }

  if (原始记录列表.length === 0 && 页面文本指标.明细总数 > 0) {
    原始记录列表 = [{
      source: '待处理汇总',
      明细总数: String(页面文本指标.明细总数),
      文本: `当前明细表共有 ${页面文本指标.明细总数} 条待处理记录，但页面未成功解析出逐条内容`,
    }];
  }

  if (
    !页面文本指标.上传指标已识别
    && 页面文本指标.页面警告订单数 > 0
    && !原始记录列表.some((记录) => 识别开票明细状态(记录).需要预警)
  ) {
    原始记录列表 = [
      {
        source: '顶部警告',
        待处理订单数: String(页面文本指标.页面警告订单数),
        文本: `顶部提示：您有${页面文本指标.页面警告订单数}笔订单剩余处理时间不足5天（即将逾期）`,
      },
      ...原始记录列表,
    ];
  }

  const 带状态记录 = 原始记录列表.map((记录) => 补充开票明细状态(记录));
  const 页面记录 = 带状态记录.map((记录) => 规范化记录(记录, 记录.source));
  const 状态统计 = 统计开票明细状态(页面记录, 页面文本指标);
  const 页面指标 = {
    ...页面文本指标,
    页面警告订单数: 状态统计.页面警告订单数,
    警告订单数: 状态统计.有效警告订单数,
    及时上传发票订单数: 状态统计.及时上传发票订单数,
    应上传发票订单数: 状态统计.应上传发票订单数,
    上传指标已识别: 状态统计.上传指标已识别,
    待上传发票订单数: 状态统计.待上传发票订单数,
    待登记明细数: 状态统计.待登记明细数,
    已上传未逾期数: 状态统计.已上传未逾期数,
  };

  打印日志(
    '数据提取',
    '页面提取',
    `应上传=${页面指标.应上传发票订单数}，及时上传=${页面指标.及时上传发票订单数}，待登记=${页面指标.待登记明细数}，顶部5天预警=${页面指标.页面警告订单数}，提取到 ${页面记录.length} 条候选记录，已上传未逾期=${页面指标.已上传未逾期数}`,
  );
  return {
    页面标题: 提取结果.title,
    页面地址: 提取结果.url,
    页面预览: 提取结果.bodyText.slice(0, 3000),
    metrics: 页面指标,
    记录列表: 页面记录,
  };
}

function 构建核心指标待登记记录(指标 = {}) {
  // 解决：页面明细解析失败或明细和核心指标冲突时，仍按核心差额生成可提醒凭据。
  return {
    source: '核心指标差额',
    应上传发票订单数: String(指标.应上传发票订单数 ?? 0),
    及时上传发票订单数: String(指标.及时上传发票订单数 ?? 0),
    待处理订单数: String(指标.待上传发票订单数 ?? 0),
    文本: `核心指标显示应上传${指标.应上传发票订单数 ?? 0}单，及时上传${指标.及时上传发票订单数 ?? 0}单，待登记${指标.待上传发票订单数 ?? 0}单`,
  };
}

module.exports = {
  从页面提取记录,
};
