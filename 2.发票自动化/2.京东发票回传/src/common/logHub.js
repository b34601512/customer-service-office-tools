const { EventEmitter } = require('events');

const 日志总线 = new EventEmitter();

function 广播日志(日志行) {
  // 解决：把终端日志集中广播给运行状态订阅者，避免出现两套不一致的信息。
  日志总线.emit('line', 日志行);
}

function 订阅日志(监听器) {
  // 解决：提供统一日志订阅入口，简化日志接线逻辑。
  日志总线.on('line', 监听器);
  return () => {
    日志总线.off('line', 监听器);
  };
}

module.exports = {
  广播日志,
  订阅日志,
};
