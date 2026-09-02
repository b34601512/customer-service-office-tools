const { 打印日志 } = require('../common/logger');
const { 规范化记录 } = require('./normalizeRecord');
const { 是开票业务响应地址 } = require('./businessResponseUrl');

function 是对象数组(值) {
  // 解决：快速过滤出最可能承载表格数据的 JSON 数组。
  return Array.isArray(值) && 值.length > 0 && 值.every((项目) => 项目 && typeof 项目 === 'object' && !Array.isArray(项目));
}

function 收集对象数组(节点, 路径 = 'root', 深度 = 0, 结果 = []) {
  // 解决：递归扫描 JSON，找出所有可能是列表数据的对象数组。
  if (深度 > 6 || 节点 === null || 节点 === undefined) {
    return 结果;
  }

  if (是对象数组(节点)) {
    结果.push({ path: 路径, items: 节点 });
  }

  if (Array.isArray(节点)) {
    节点.slice(0, 30).forEach((项目, 索引) => {
      收集对象数组(项目, `${路径}[${索引}]`, 深度 + 1, 结果);
    });
    return 结果;
  }

  if (typeof 节点 !== 'object') {
    return 结果;
  }

  Object.entries(节点).slice(0, 50).forEach(([键, 值]) => {
    收集对象数组(值, `${路径}.${键}`, 深度 + 1, 结果);
  });

  return 结果;
}

function 是否像业务记录(对象) {
  // 解决：排除纯配置项和无意义对象，尽量只保留像一行业务数据的结构。
  const 条目 = Object.entries(对象).filter(([, 值]) => 值 !== null && 值 !== undefined && 值 !== '');
  const 原子字段数 = 条目.filter(([, 值]) => ['string', 'number', 'boolean'].includes(typeof 值)).length;
  return 条目.length >= 3 && 原子字段数 >= 2;
}

function 从接口提取记录(响应列表) {
  // 解决：当页面 DOM 无法稳定提取时，从接口 JSON 中恢复待开票记录。
  const 去重集合 = new Set();
  const 记录列表 = [];

  响应列表.forEach((响应) => {
    if (!是开票业务响应地址(响应.url)) {
      return;
    }

    const 候选数组 = 收集对象数组(响应.data);
    候选数组.forEach(({ path, items }) => {
      items.slice(0, 100).forEach((项目) => {
        if (!是否像业务记录(项目)) {
          return;
        }

        const 记录 = 规范化记录({
          接口路径: 响应.url,
          数据路径: path,
          ...项目,
        }, '接口数据');

        if (去重集合.has(记录.id)) {
          return;
        }

        去重集合.add(记录.id);
        记录列表.push(记录);
      });
    });
  });

  打印日志('数据提取', '接口提取', `提取到 ${记录列表.length} 条候选记录`);
  return 记录列表;
}

module.exports = {
  从接口提取记录,
};
