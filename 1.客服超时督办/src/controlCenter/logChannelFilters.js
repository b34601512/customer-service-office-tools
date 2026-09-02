const timeoutFragments = [
  "[主线:启动][主程序]",
  "[主线:完成][主程序][后台督办]",
  "[主线:失败][主程序]",
  "[主线:准备][浏览器引擎]",
  "[主线:启动][浏览器引擎]",
  "[主线:执行][浏览器引擎]",
  "[主线:完成][浏览器引擎]",
  "[过程记录]",
  "[转接监控]",
  "[转接提醒]"
];

const offDutyFragments = [
  "[下班监控]",
  "[下班排班]",
  "[下班页面]",
  "[下班通知]",
  "[排班读取]"
];

const missedReplyFragments = [
  "[未实质回复监控]"
];

const onlinePresenceFragments = [
  "[上班监控]",
  "[上班监控排班]"
];

function matchesAny(line, fragments) {
  // 这里统一做片段匹配，避免日志通道各自手写一堆 includes 判断。
  return fragments.some((fragment) => line.includes(fragment));
}

function isOffDutyWecomLine(line) {
  // 这里单独识别下班相关企微发送，避免共享模块把两类日志串到一起。
  return line.includes("[企微机器人]") && line.includes("场景=下班");
}

function isMissedReplyWecomLine(line) {
  // 这里单独识别漏回复企微发送，避免共享机器人日志被归到原超时通道。
  return line.includes("[企微机器人]") && line.includes("场景=漏回复提醒");
}

function isTimeoutWecomLine(line) {
  // 这里单独识别统一未回复引擎发出的短阈值超时提醒，让它继续进入超时日志。
  return line.includes("[企微机器人]") && line.includes("场景=超时提醒");
}

function isOnlinePresenceWecomLine(line) {
  // 这里单独识别上班监控企微发送，避免它被归入通用超时日志。
  return line.includes("[企微机器人]") && line.includes("场景=上班监控");
}

function isTimeoutLine(line) {
  // 这里收口主管端真正关心的日志，只保留新超时提醒、转接和企微发送链路。
  return (
    matchesAny(line, timeoutFragments) ||
    isTimeoutWecomLine(line) ||
    (
      line.includes("[企微机器人]") &&
      !isOffDutyWecomLine(line) &&
      !isMissedReplyWecomLine(line) &&
      !isOnlinePresenceWecomLine(line)
    )
  );
}

function isOffDutyLine(line) {
  // 这里单独收口下班监控链路，保证首页可以把交接日志和超时日志拆开显示。
  return matchesAny(line, offDutyFragments) || isOffDutyWecomLine(line);
}

function isMissedReplyLine(line) {
  // 这里单独收口漏回复链路，保证稍等后的长期漏回复可以独立排查。
  return matchesAny(line, missedReplyFragments) || isMissedReplyWecomLine(line);
}

function isOnlinePresenceLine(line) {
  // 这里单独收口无人在线链路，保证在线状态提醒不再混入下班监控。
  return matchesAny(line, onlinePresenceFragments) || isOnlinePresenceWecomLine(line);
}

function resolveLogChannels(line) {
  // 这里统一决定一行日志应该进入哪些网页控制台通道。
  const normalizedLine = String(line || "");
  const channels = [];

  if (isTimeoutLine(normalizedLine)) {
    channels.push("timeout");
  }

  if (isOffDutyLine(normalizedLine)) {
    channels.push("off_duty");
  }

  if (isMissedReplyLine(normalizedLine)) {
    channels.push("missed_reply");
  }

  if (isOnlinePresenceLine(normalizedLine)) {
    channels.push("online_presence");
  }

  return channels;
}

module.exports = {
  resolveLogChannels
};
