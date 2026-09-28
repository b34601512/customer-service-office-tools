// 申诉提交前的纯规则校验（不碰浏览器，方便测试锁死）。
// 这些限制都是从平台真实报错/页面文案里量出来的，别凭印象改：
//   · 描述 ≤300 字 —— 实测超长时 POST /mercury/appeal/apply 返回 errorCode 120「描述不能超过300字」；
//   · 必填/选填图片各 ≤3 张、视频各 ≤2 条 —— 表单文案「上传图片(0/3)」「上传视频(0/2)」；
//   · 金额不得超过页面「最多可申诉 X 元」。
const DESCRIPTION_LIMIT = 300;
const IMAGE_MAX = 3;
const VIDEO_MAX = 2;

// 拼多多「维权申诉」申诉原因下拉的真实选项（2026-09-28 实测）。
const APPEAL_REASONS = [
  "消费者反馈未收到商品，但实际已签收",
  "消费者反馈商品空包/少件/漏件，但实际未少发",
  "消费者反馈商品错发，但实际未错发",
  "消费者反馈商品存在质量问题，但凭证不足",
  "消费者提供凭证为网图",
  "消费者提供凭证与其他售后订单相同",
  "非以上申诉原因"
];

// 表单里「申诉项」的勾选项（默认两个都勾）：
//   货款申诉 = 追回被退的钱；纠纷退款率申诉 = 本单不计入纠纷退款率（不涉及钱款）。
const APPEAL_ITEMS = ["货款申诉", "纠纷退款率申诉"];

function textLength(text) {
  // 用码点计数：平台按「字」算，emoji/生僻字按 1 个算最接近。
  return [...String(text == null ? "" : text)].length;
}

function validateDescription(text) {
  const length = textLength(text);
  if (!length) return { ok: false, length, limit: DESCRIPTION_LIMIT, message: "申诉描述不能为空" };
  if (length > DESCRIPTION_LIMIT) {
    return {
      ok: false, length, limit: DESCRIPTION_LIMIT,
      message: `申诉描述 ${length} 字，超过平台上限 ${DESCRIPTION_LIMIT} 字（提交会报「描述不能超过300字」），请压缩后重试`
    };
  }
  return { ok: true, length, limit: DESCRIPTION_LIMIT, message: `申诉描述 ${length}/${DESCRIPTION_LIMIT} 字` };
}

function validateAmount(value, maxYuan) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, amount, max: maxYuan ?? null, message: `申诉金额必须是正数（收到：${value}）` };
  }
  if (maxYuan != null && Number.isFinite(Number(maxYuan)) && amount > Number(maxYuan) + 1e-9) {
    return { ok: false, amount, max: Number(maxYuan), message: `申诉金额 ${amount} 元超过本单上限 ${maxYuan} 元` };
  }
  return { ok: true, amount, max: maxYuan ?? null, message: `申诉金额 ${amount} 元${maxYuan != null ? `（本单上限 ${maxYuan} 元）` : ""}` };
}

function validateEvidence(requiredImages = [], optionalImages = []) {
  const issues = [];
  if (!requiredImages.length) issues.push("必填凭证至少有 1 张「证明商家无责」的图片");
  if (requiredImages.length > IMAGE_MAX) issues.push(`必填凭证最多 ${IMAGE_MAX} 张，当前 ${requiredImages.length} 张`);
  if (optionalImages.length > IMAGE_MAX) issues.push(`选填凭证最多 ${IMAGE_MAX} 张，当前 ${optionalImages.length} 张`);
  return { ok: issues.length === 0, issues, imageMax: IMAGE_MAX, videoMax: VIDEO_MAX };
}

function pickReason(reason, options = APPEAL_REASONS) {
  const hit = options.find((item) => item === String(reason || "").trim());
  return hit || null;
}

function summarizeItems(items = APPEAL_ITEMS) {
  const chosen = APPEAL_ITEMS.filter((item) => items.includes(item));
  return { ok: chosen.length > 0, items: chosen, message: chosen.length ? `申诉项：${chosen.join(" + ")}` : "申诉项至少要选一项（货款申诉 / 纠纷退款率申诉）" };
}

module.exports = {
  DESCRIPTION_LIMIT, IMAGE_MAX, VIDEO_MAX, APPEAL_REASONS, APPEAL_ITEMS,
  textLength, validateDescription, validateAmount, validateEvidence, pickReason, summarizeItems
};
