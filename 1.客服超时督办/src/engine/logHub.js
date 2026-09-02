const { EventEmitter } = require("events");

const logBus = new EventEmitter();

function broadcastLog(line) {
  // 这里统一广播当前进程日志，保证终端和网页控制台尽量消费同一套日志源。
  logBus.emit("line", line);
}

function subscribeLogs(listener) {
  // 这里统一提供日志订阅入口，避免控制台启动器直接依赖 EventEmitter 细节。
  logBus.on("line", listener);
  return () => {
    logBus.off("line", listener);
  };
}

module.exports = {
  broadcastLog,
  subscribeLogs
};
