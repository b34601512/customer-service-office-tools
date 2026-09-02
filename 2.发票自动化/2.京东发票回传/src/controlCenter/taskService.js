const { 批量单店最大尝试次数, 批量店铺页面保留模式, 批量回传页面保留模式 } = require('./taskService/taskConstants');
const { ControlCenterTaskService } = require('./taskService/taskServiceCore');
const { 是需要自动拉起登录的错误 } = require('./taskService/loginError');

module.exports = {
  批量单店最大尝试次数,
  批量店铺页面保留模式,
  批量回传页面保留模式,
  ControlCenterTaskService,
  是需要自动拉起登录的错误,
};
