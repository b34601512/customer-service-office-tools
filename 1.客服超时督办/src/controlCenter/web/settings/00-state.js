// 该文件用于集中保存配置中心 DOM 引用、常量和页面元信息。
const modeChip = document.getElementById("modeChip");
const configFeedbackStack = document.getElementById("feedbackStack");
const addNotificationGroupButton = document.getElementById("addNotificationGroupButton");
const addStaffButton = document.getElementById("addStaffButton");
const configForm = document.getElementById("configForm");
const wecomConfigForm = document.getElementById("wecomConfigForm");
const configFeedback = document.getElementById("configFeedback");
const sharedConfigFeedbackItems = Array.from(
  document.querySelectorAll("[data-shared-config-feedback], [data-missed-reply-config-feedback]")
);
const privateConfigFeedback = document.getElementById("privateConfigFeedback");
const configModal = document.getElementById("configModal");
const configModalTitle = document.getElementById("configModalTitle");
const configModalSubtitle = document.getElementById("configModalSubtitle");
const openConfigModalButton = document.getElementById("openConfigModalButton");
const closeConfigModalButton = document.getElementById("closeConfigModalButton");
const keywordAddModal = document.getElementById("keywordAddModal");
const keywordAddForm = document.getElementById("keywordAddForm");
const keywordAddModalTitle = document.getElementById("keywordAddModalTitle");
const keywordAddModalSubtitle = document.getElementById("keywordAddModalSubtitle");
const keywordAddTextInput = document.getElementById("keywordAddText");
const keywordAddCloseButton = document.getElementById("keywordAddCloseButton");
const keywordAddCancelButton = document.getElementById("keywordAddCancelButton");


const CONFIG_FEEDBACK_TYPE_META = {
  info: {
    title: "等待操作",
    className: "is-info"
  },
  pending: {
    title: "正在处理",
    className: "is-pending"
  },
  success: {
    title: "操作成功",
    className: "is-success"
  },
  error: {
    title: "操作失败",
    className: "is-error"
  }
};

const KEYWORD_MATCH_MODE_LABELS = {
  exact: "完全匹配",
  startsWith: "开头匹配",
  includes: "包含匹配"
};

const KEYWORD_MATCH_MODE_OPTIONS = [
  { value: "exact", label: "完全匹配" },
  { value: "startsWith", label: "开头匹配" },
  { value: "includes", label: "包含匹配" }
];

const KEYWORD_MATCH_MODE_BY_LABEL = {
  完全匹配: "exact",
  开头匹配: "startsWith",
  前缀匹配: "startsWith",
  包含匹配: "includes"
};

const KEYWORD_EDITOR_CONFIGS = [
  {
    fieldId: "missedReplyTemporaryReplyKeywords",
    defaultMatchMode: "startsWith"
  },
  {
    fieldId: "missedReplyCustomerResolutionKeywords",
    defaultMatchMode: "exact"
  },
  {
    fieldId: "missedReplyCustomerClosingKeywords",
    defaultMatchMode: "exact"
  },
  {
    fieldId: "missedReplyInvalidAgentReplyKeywords",
    defaultMatchMode: "exact"
  },
  {
    fieldId: "missedReplyPlatformNoticeKeywords",
    defaultMatchMode: "exact"
  }
];

const CONFIG_PAGE_META = {
  hub: {
    title: "配置中心",
    subtitle: "先选择要维护的配置页，关闭后回到督办流程。"
  },
  params: {
    title: "参数设置",
    subtitle: "维护客服工作台地址。"
  },
  timeoutReminder: {
    title: "超时提醒配置",
    subtitle: "维护未实质回复多久触发超时提醒。"
  },
  missedReply: {
    title: "漏回复设置",
    subtitle: "先选择漏回复配置类别，每次只维护一类内容。"
  },
  onlinePresence: {
    title: "上班监控",
    subtitle: "维护当前应值班客服无人开启自动分配时的提醒。"
  },
  missedReplyRuntime: {
    title: "运行参数",
    subtitle: "维护漏回复开关、扫描间隔、扫描数量和提醒阈值。"
  },
  missedReplyTemporaryKeywords: {
    title: "稍等类关键词",
    subtitle: "维护客服临时接住客户时使用的关键词。"
  },
  missedReplyResolutionKeywords: {
    title: "客户主动结案",
    subtitle: "维护客户明确表示问题已经解决的关键词。"
  },
  missedReplyClosingKeywords: {
    title: "客户弱收尾",
    subtitle: "维护客户简单收尾内容，不单独算漏回复。"
  },
  missedReplyInvalidKeywords: {
    title: "无效人工回复",
    subtitle: "维护不算人工正式回复的关键词。"
  },
  missedReplyPlatformNoticeKeywords: {
    title: "平台提示过滤",
    subtitle: "维护不算客户真实发言的平台固定提示。"
  },
  groupChatFilterKeywords: {
    title: "群聊识别",
    subtitle: "群聊会话由平台官方字段自动识别，这里只需决定是否启用排除。"
  },
  offDuty: {
    title: "下班监控配置",
    subtitle: "维护下班监控、关店时间和明天班次提醒。"
  },
  wecom: {
    title: "企微提醒",
    subtitle: "维护通知群和成员清单。"
  }
};

let notificationGroupSerial = 0;
let staffDirectorySerial = 0;
let configFeedbackToastSerial = 0;
let configModalHasLoaded = false;
let configModalTriggerButton = null;
let keywordAddFieldId = "";
let keywordAddTriggerButton = null;
