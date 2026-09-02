function isStructuredChildLogLine(line) {
  // 这里识别子进程已经写入本地日志的结构化行，避免父进程重复写日志文件。
  return /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}]\[[^\]]+:\d+]\[主线:[^\]]+]/.test(
    String(line || "")
  );
}

module.exports = {
  isStructuredChildLogLine
};
