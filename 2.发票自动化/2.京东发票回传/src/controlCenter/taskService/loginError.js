function 是需要自动拉起登录的错误(错误) {
  // 解决：统一识别登录态失效错误，避免自动补登录逻辑散落在任务主流程里。
  const 错误消息 = String(错误?.message || 错误 || '').trim();
  return (
    错误消息.includes('登录态失效')
    || 错误消息.includes('等待登录完成超时')
    || 错误消息.includes('请先完成登录')
  );
}

module.exports = {
  是需要自动拉起登录的错误,
};
