const { 打印日志 } = require('../common/logger');
const { 是开票业务响应地址 } = require('./businessResponseUrl');

function 是响应体已不可读错误(错误) {
  // 解决：识别 DevTools 偶发拿不到响应体的已知噪声，避免把正常跳转误打成疑似故障。
  const 错误消息 = String(错误?.message || 错误 || '');
  return (
    错误消息.includes('Network.getResponseBody')
    && 错误消息.includes('No resource with given identifier found')
  );
}

function 创建网络响应记录器(page) {
  // 解决：在页面渲染失败或结构变化时，保留接口数据作为兜底提取来源。
  const 记录列表 = [];

  const 处理响应 = async (response) => {
    const 响应地址 = response.url();
    if (!是开票业务响应地址(响应地址)) {
      return;
    }

    const 响应头 = response.headers();
    const 内容类型 = 响应头['content-type'] ?? '';

    if (!内容类型.includes('application/json')) {
      return;
    }

    try {
      const 数据 = await response.json();
      记录列表.push({
        url: 响应地址,
        status: response.status(),
        data: 数据,
      });
    } catch (错误) {
      if (是响应体已不可读错误(错误)) {
        return;
      }
      打印日志('接口采集', '网络响应', `忽略无法解析的 JSON：${错误.message}`, { 缩进: 1 });
    }
  };

  page.on('response', 处理响应);

  return {
    获取记录() {
      // 解决：只对外暴露只读副本，避免主流程误改采集结果。
      return [...记录列表];
    },
    停止() {
      // 解决：页面关闭前移除监听，避免监听器跨轮次泄漏。
      page.off('response', 处理响应);
    },
  };
}

module.exports = {
  创建网络响应记录器,
  是响应体已不可读错误,
  是开票业务响应地址,
};
