// 这里是全部控制台页面的接口请求单一真源：viewer/logs/app/settings 四组脚本都依赖本文件提供的全局 requestJson。
// 修改请求口径（超时、错误提示、头部）时只改这里；不要在页面脚本里再复制一份同名实现（历史 issue #551）。
async function requestJson(url, options = {}) {
  // 这里统一请求本地接口并收口异常，让各页面只处理最终结果。
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || "请求失败。");
  }

  return data;
}
