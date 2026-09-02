const { 打印日志 } = require('../common/logger');

const 活动浏览器上下文集合 = new Set();

function 注册浏览器上下文(context, 元数据 = {}) {
  // 解决：集中登记所有由本项目打开的浏览器上下文，方便后台退出时统一回收。
  const 条目 = {
    context,
    店铺名称: String(元数据.店铺名称 || '').trim(),
    店铺标识: String(元数据.店铺标识 || '').trim(),
  };

  活动浏览器上下文集合.add(条目);
  context.once('close', () => {
    活动浏览器上下文集合.delete(条目);
  });
  return 条目;
}

async function 关闭店铺浏览器上下文(店铺标识) {
  // 解决：同一店铺重新排查前先收掉旧窗口，避免旧实例继续占用资源。
  const 标准店铺标识 = String(店铺标识 || '').trim();
  if (!标准店铺标识) {
    return;
  }

  const 条目列表 = Array.from(活动浏览器上下文集合).filter((条目) => 条目.店铺标识 === 标准店铺标识);
  const 错误列表 = [];
  for (const 条目 of 条目列表) {
    const 店铺标签 = 条目.店铺名称 || 条目.店铺标识 || '未命名店铺';
    打印日志('浏览器上下文', '店铺窗口', `准备关闭旧窗口：${店铺标签}`);
    try {
      await 条目.context.close();
    } catch (错误) {
      错误列表.push(`店铺「${店铺标签}」旧窗口关闭失败：${错误.message}`);
    }
  }

  if (错误列表.length > 0) {
    throw new Error(错误列表.join('；'));
  }
}

async function 关闭全部浏览器上下文() {
  // 解决：后台退出时统一关闭当前项目打开的所有浏览器窗口，避免人工巡检页残留。
  const 条目列表 = Array.from(活动浏览器上下文集合);
  const 错误列表 = [];
  for (const 条目 of 条目列表) {
    const 店铺标签 = 条目.店铺名称 || 条目.店铺标识 || '未命名店铺';
    打印日志('后台退出', '浏览器上下文', `准备关闭店铺窗口：${店铺标签}`);
    try {
      await 条目.context.close();
    } catch (错误) {
      错误列表.push(`店铺「${店铺标签}」关闭失败：${错误.message}`);
    }
  }

  if (错误列表.length > 0) {
    throw new Error(错误列表.join('；'));
  }
}

function 获取活动浏览器上下文数量() {
  // 解决：暴露当前活动上下文数量，便于自动测试验证回收逻辑。
  return 活动浏览器上下文集合.size;
}

module.exports = {
  注册浏览器上下文,
  关闭店铺浏览器上下文,
  关闭全部浏览器上下文,
  获取活动浏览器上下文数量,
};
