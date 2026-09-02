// 该文件用于提供下班主流程可中断等待能力。
async function waitForStopOrTimeout(stopState, durationMs, chunkMs = 60000) {
  // 这里把长时间等待拆成可中断的小段，避免白天待命或夜里收工时卡住退出。
  let remainingMs = Math.max(0, Number(durationMs) || 0);
  while (!stopState.stopped && remainingMs > 0) {
    const currentChunkMs = Math.min(remainingMs, chunkMs);
    await new Promise((resolve) => setTimeout(resolve, currentChunkMs));
    remainingMs -= currentChunkMs;
  }
}

module.exports = {
  waitForStopOrTimeout
};
