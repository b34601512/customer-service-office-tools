const notifier = require('node-notifier');
const { 打印日志 } = require('../common/logger');

function 发送桌面通知(标题, 消息) {
  // 解决：用 Windows 桌面通知把新增待开票信息第一时间弹出来。
  打印日志('消息提醒', '桌面通知', 标题);

  return new Promise((resolve, reject) => {
    notifier.notify({
      title: 标题,
      message: 消息,
      wait: false,
      timeout: 8,
      appName: '京东开票巡检',
    }, (错误) => {
      if (错误) {
        reject(new Error(`发送桌面通知失败：${错误.message}`));
        return;
      }
      resolve();
    });
  });
}

module.exports = {
  发送桌面通知,
};
