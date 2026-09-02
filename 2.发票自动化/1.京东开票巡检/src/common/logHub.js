const { EventEmitter } = require('events');

const 日志总线 = new EventEmitter();

function 广播日志(日志行) {
  // 解决：把终端日志同步广播给后台控制台，避免页面和控制台看到两套不一致的信息。
  日志总线.emit('line', 日志行);
}

function 订阅日志(监听器) {
  // 解决：为后台控制台提供统一订阅入口，简化日志接线逻辑。
  日志总线.on('line', 监听器);
  return () => {
    日志总线.off('line', 监听器);
  };
}

module.exports = {
  广播日志,
  订阅日志,
};
