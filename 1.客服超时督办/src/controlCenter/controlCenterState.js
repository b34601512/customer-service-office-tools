const { EventEmitter } = require("events");
const { resolveLogChannels } = require("./logChannelFilters");
class ControlCenterState {
  constructor() {
    this.eventBus = new EventEmitter();
    this.logLines = [];
    this.logLinesByChannel = {
      timeout: [],
      missed_reply: [],
      online_presence: [],
      off_duty: []
    };
    this.currentTask = null;
    this.maxLogLines = 200;
  }

  appendChannelLine(channel, line) {
    // 这里按通道缓存日志，首页切换标签时直接读缓存，不再让前端重复分类。
    if (!this.logLinesByChannel[channel]) {
      this.logLinesByChannel[channel] = [];
    }

    this.logLinesByChannel[channel].push(line);
    if (this.logLinesByChannel[channel].length > this.maxLogLines) {
      this.logLinesByChannel[channel].shift();
    }
  }

  appendLog(line) {
    // 这里统一缓存并广播后台日志，让网页控制台和终端尽量消费同一套运行信息。
    const channels = resolveLogChannels(line);
    this.logLines.push(line);
    if (this.logLines.length > this.maxLogLines) {
      this.logLines.shift();
    }

    channels.forEach((channel) => {
      this.appendChannelLine(channel, line);
    });

    this.eventBus.emit("log", {
      line,
      channels
    });
    this.eventBus.emit("state", this.getSnapshot());
  }

  setTask(task) {
    // 这里统一维护当前任务状态，避免前端拼凑多份来源不一致的状态。
    this.currentTask = task;
    this.eventBus.emit("state", this.getSnapshot());
  }

  getSnapshot() {
    // 这里返回网页控制台渲染所需的最小状态，避免把运行期对象直接暴露给外层。
    return {
      currentTask: this.currentTask,
      logLines: this.logLines.slice(),
      logLinesByChannel: Object.fromEntries(
        Object.entries(this.logLinesByChannel).map(([channel, lines]) => [channel, lines.slice()])
      )
    };
  }
}

module.exports = {
  ControlCenterState
};
