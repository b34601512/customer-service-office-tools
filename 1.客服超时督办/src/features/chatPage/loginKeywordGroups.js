// 该文件用于维护登录页识别关键字组合。
const LOGIN_PAGE_KEYWORD_GROUPS = [
  ["账号登录", "验证码登录", "获取短信验证码"],
  ["中国+86", "获取短信验证码"],
  ["忘记密码免费注册", "获取短信验证码"],
  ["扫码登录", "确认授权"],
  ["授权应用信息", "redirectUrl", "授权失败"],
  ["欢迎使用", "忘记密码", "用户协议"]
];

module.exports = {
  LOGIN_PAGE_KEYWORD_GROUPS
};
