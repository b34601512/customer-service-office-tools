// 该文件用于解决天猫店铺候选项评分和摘要问题。
const { normalizeTmallShopName } = require("./tmallStoreNameText");

function scoreTmallStoreOptionSnapshot(snapshot, expectedShopNames) {
  // 这里按“文本命中度 + 是否可见可点 + 元素面积”打分，优先挑真实店铺项，不再误点整块隐藏容器。
  if (!snapshot?.visible || snapshot?.disabled) {
    return Number.NEGATIVE_INFINITY;
  }

  const normalizedText = normalizeTmallShopName(snapshot.text);
  if (!normalizedText) {
    return Number.NEGATIVE_INFINITY;
  }

  let bestMatchScore = Number.NEGATIVE_INFINITY;
  for (const item of expectedShopNames) {
    const normalizedExpected = normalizeTmallShopName(item);
    if (!normalizedExpected) {
      continue;
    }

    let matchScore = Number.NEGATIVE_INFINITY;
    if (normalizedText === normalizedExpected) {
      matchScore = 1000;
    } else if (normalizedText.startsWith(normalizedExpected) || normalizedText.endsWith(normalizedExpected)) {
      matchScore = 920;
    } else if (normalizedText.includes(normalizedExpected) || normalizedExpected.includes(normalizedText)) {
      matchScore = 820;
    }

    if (!Number.isFinite(matchScore)) {
      continue;
    }

    matchScore -= Math.abs(normalizedText.length - normalizedExpected.length) * 5;
    bestMatchScore = Math.max(bestMatchScore, matchScore);
  }

  if (!Number.isFinite(bestMatchScore)) {
    return Number.NEGATIVE_INFINITY;
  }

  const preferredTagBonus = {
    LI: 60,
    A: 50,
    BUTTON: 50,
    DIV: 20,
    SPAN: 10
  };
  const area = Math.max(1, Number(snapshot.area) || 0);
  const areaPenalty = Math.min(400, Math.round(area / 50));
  return bestMatchScore + (preferredTagBonus[snapshot.tagName] || 0) - areaPenalty;
}

function selectBestTmallStoreOptionSnapshot(snapshots, expectedShopNames) {
  // 这里从所有候选里挑出最像真实店铺项的那个，避免“第一个匹配节点”刚好是隐藏壳子。
  let bestSnapshot = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const snapshot of snapshots) {
    const score = scoreTmallStoreOptionSnapshot(snapshot, expectedShopNames);
    if (score > bestScore) {
      bestScore = score;
      bestSnapshot = snapshot;
    }
  }

  return bestSnapshot;
}

function describeTmallStoreOptionSnapshots(snapshots, limit = 6) {
  // 这里把候选项压成一行摘要，超时或误点时能直接从日志里看出可见性和文本差异。
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return "无候选项";
  }

  return snapshots
    .slice(0, limit)
    .map((snapshot) => {
      const visibilityText = snapshot.visible ? "可见" : "隐藏";
      const disabledText = snapshot.disabled ? "禁用" : "可点";
      const sizeText = snapshot.area ? `面积=${snapshot.area}` : "面积=0";
      const text = snapshot.text || "空文本";
      return `#${snapshot.index + 1}${snapshot.tagName || "UNKNOWN"}(${visibilityText}/${disabledText}/${sizeText})=${text}`;
    })
    .join("；");
}

module.exports = {
  scoreTmallStoreOptionSnapshot,
  selectBestTmallStoreOptionSnapshot,
  describeTmallStoreOptionSnapshots
};
