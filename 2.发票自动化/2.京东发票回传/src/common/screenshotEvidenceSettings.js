// 该文件用于集中控制催票流程里的「截图凭证」开关。
//
// 2026-09-16 用户决定：停止保存页面截图凭证（改为自行查看平台后台与最终统计数据）。
// 原因：截图只是事后留痕，不参与业务判定；一旦截图失败，代码会抛「截图凭证未生成」，
//       把一次已经完成的数据识别判成失败。
// 需要临时恢复时：设置环境变量 PI_EVIDENCE_SCREENSHOTS=1 即可，不必改代码。
const 默认保存截图凭证 = false;

function 是否保存截图凭证() {
  const 环境值 = String(process.env.PI_EVIDENCE_SCREENSHOTS || '').trim();
  if (!环境值) {
    return 默认保存截图凭证;
  }
  return !/^(0|false|no|off)$/i.test(环境值);
}

module.exports = {
  默认保存截图凭证,
  是否保存截图凭证,
};
