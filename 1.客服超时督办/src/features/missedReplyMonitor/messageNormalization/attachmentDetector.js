const ATTACHMENT_CONTENT_TYPES = new Set([2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15]);
const MINI_PROGRAM_CONTENT_TYPES = new Set([9]);

function hasAttachmentList(message, content) {
  // 这里识别接口显式附件数组，比猜 content.type 更可靠。
  const payload = content?.payload && typeof content.payload === "object" ? content.payload : {};
  const attachmentList = message?.attachments || message?.files || content?.attachments || payload?.attachments;
  return Array.isArray(attachmentList) && attachmentList.length > 0;
}

function hasAttachmentTextSignal(text) {
  // 这里识别平台把附件折叠成文本占位或链接的情况。
  return /(\[图片]|【图片】|\[文件]|【文件】|\[语音]|【语音】|\[视频]|【视频】|\[小程序]|【小程序】|https?:\/\/|#小程序:\/\/)/.test(String(text || ""));
}

function hasMiniProgramTextSignal(text) {
  // 这里单独识别小程序卡片，后续策略要把纯小程序广告从待回复队列剔除。
  return /(\[小程序]|【小程序】|#小程序:\/\/)/.test(String(text || ""));
}

function hasAttachmentSignal(message, content, text) {
  // 这里只把明确附件信号算附件，不能再把 type=7 普通文字误判成附件。
  const contentType = Number(content?.type ?? message?.type);
  if (hasAttachmentList(message, content)) {
    return true;
  }

  if (ATTACHMENT_CONTENT_TYPES.has(contentType)) {
    return true;
  }

  return hasAttachmentTextSignal(text);
}

function hasMiniProgramAttachmentSignal(message, content, text) {
  // 这里只识别明确的小程序信号，不把普通链接误判成小程序。
  const contentType = Number(content?.type ?? message?.type);
  return MINI_PROGRAM_CONTENT_TYPES.has(contentType) || hasMiniProgramTextSignal(text);
}

module.exports = {
  hasAttachmentSignal,
  hasMiniProgramAttachmentSignal,
  hasMiniProgramTextSignal
};
