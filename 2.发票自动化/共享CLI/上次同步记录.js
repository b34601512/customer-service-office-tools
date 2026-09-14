// 上次同步记录：把每轮任务结束的时间与结果落一份小记录，供各平台 TUI 总览页一眼核对"程序跑过没有、读到几单"。
// 记录写在各项目自己的 runtime/state 下（不入库），读不到或解析失败一律当"暂无记录"，绝不打断 TUI。
const fs = require('node:fs');
const path = require('node:path');

const 读取单数正则 = /读取\s*(\d+)\s*单/g;

function 格式化本地时间(值) {
  const 时间 = 值 instanceof Date ? 值 : new Date(值);
  if (Number.isNaN(时间.getTime())) return '';
  const 补两位 = (数值) => String(数值).padStart(2, '0');
  return `${时间.getFullYear()}-${补两位(时间.getMonth() + 1)}-${补两位(时间.getDate())} `
    + `${补两位(时间.getHours())}:${补两位(时间.getMinutes())}`;
}

function 提取读取单数(文本) {
  // 多店汇总时把每店的"读取 N 单"累加；没有这种措辞就返回 null，由展示层改说"完成/失败"。
  const 内容 = String(文本 || '');
  let 合计 = 0;
  let 命中 = false;
  for (const 匹配 of 内容.matchAll(读取单数正则)) {
    合计 += Number(匹配[1]);
    命中 = true;
  }
  return 命中 ? 合计 : null;
}

function 写入上次同步记录(文件路径, 记录 = {}) {
  if (!文件路径) return null;
  // 调用方可以直接给出条数（如"识别 3 条"），也可以只在消息里写"读取 N 单"由这里提取。
  const 单数 = Number.isInteger(记录.读取单数) ? 记录.读取单数 : 提取读取单数(记录.消息);
  const 数据 = {
    at: String(记录.at || new Date().toISOString()),
    任务: String(记录.任务 || ''),
    状态: String(记录.状态 || ''),
    读取单数: 单数,
    计数标签: 单数 === null ? '' : String(记录.计数标签 || '').trim(),
    消息: String(记录.消息 || '').replace(/\s+/g, ' ').trim().slice(0, 300),
  };
  try {
    fs.mkdirSync(path.dirname(文件路径), { recursive: true });
    fs.writeFileSync(文件路径, JSON.stringify(数据, null, 2), 'utf8');
  } catch {
    // 记录失败不影响业务：下次任务会再写一次。
    return null;
  }
  return 数据;
}

function 读取上次同步记录(文件路径) {
  if (!文件路径) return null;
  try {
    const 数据 = JSON.parse(fs.readFileSync(文件路径, 'utf8'));
    return 数据 && typeof 数据 === 'object' ? 数据 : null;
  } catch {
    return null;
  }
}

function 构建上次同步文本(记录, 默认标签 = '同步') {
  if (!记录 || !记录.at) return '';
  const 时间文本 = 格式化本地时间(记录.at);
  if (!时间文本) return '';
  const 标签 = String(记录.任务 || 默认标签 || '同步').trim() || '同步';
  if (Number.isInteger(记录.读取单数)) {
    const 计数文本 = String(记录.计数标签 || '').trim() || `读取 ${记录.读取单数} 单`;
    return `上次${标签}：${时间文本}（${计数文本}）`;
  }
  const 状态文本 = 记录.状态 === 'error' ? '失败' : (记录.状态 === 'done' ? '完成' : String(记录.状态 || '').trim());
  return 状态文本 ? `上次${标签}：${时间文本}（${状态文本}）` : `上次${标签}：${时间文本}`;
}

module.exports = {
  格式化本地时间,
  提取读取单数,
  写入上次同步记录,
  读取上次同步记录,
  构建上次同步文本,
};
