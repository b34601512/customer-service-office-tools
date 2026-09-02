// 该文件用于跨 frame 扫描左侧全部菜单候选元素。
const { log } = require("../../engine/logger");

async function findAllCandidates(page) {
  // 这里扫描所有 frame，避免页面把真实内容包在 iframe 里导致主页面定位失效。
  const frames = page.frames();
  const result = [];

  for (const [frameIndex, frame] of frames.entries()) {
    const candidates = frame.getByText(/^全部$/, { exact: true });
    const count = await candidates.count();
    log("主线:执行", "会话页面", "扫描Frame", `Frame[${frameIndex}] 检测到 ${count} 个「全部」候选元素`);

    for (let index = 0; index < count; index += 1) {
      result.push({
        frameIndex,
        locator: candidates.nth(index)
      });
    }
  }

  return result;
}

module.exports = {
  findAllCandidates
};
