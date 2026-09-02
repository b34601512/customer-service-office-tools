const subscribers = new Set();

function 订阅日志(handler) {
  // 解决：网页控制台需要实时收到终端日志，但 logger 不应该依赖网页模块。
  subscribers.add(handler);
  return () => subscribers.delete(handler);
}

function 广播日志(line) {
  // 解决：日志广播失败不能影响主流程执行。
  for (const handler of subscribers) {
    try {
      handler(line);
    } catch {
      // 广播失败不影响业务日志本身。
    }
  }
}

module.exports = {
  订阅日志,
  广播日志,
};
