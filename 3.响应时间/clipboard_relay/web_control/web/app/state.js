const statusText = document.getElementById("statusText");
const appMetaBar = document.getElementById("appMetaBar");
const workflowGrid = document.getElementById("workflowGrid");
const workflowActionPool = document.getElementById("workflowActionPool");
const indicatorRow = document.getElementById("indicatorRow");
const configForm = document.getElementById("configForm");
const feedback = document.getElementById("feedback");
const logOutput = document.getElementById("logOutput");
const guideHint = document.getElementById("guideHint");
const configButton = document.getElementById("configButton");
const configPanel = document.getElementById("configPanel");
const configCloseButton = document.getElementById("configCloseButton");
const configCancelButton = document.getElementById("configCancelButton");
const configDialogFeedback = document.getElementById("configDialogFeedback");
const serviceLoginButton = document.getElementById("serviceLoginButton");
const webLoginButton = document.getElementById("webLoginButton");
const startButton = document.getElementById("startButton");
const pauseButton = document.getElementById("pauseButton");
const stopButton = document.getElementById("stopButton");
const logsLink = document.getElementById("logsLink");
const openLogButton = document.getElementById("openLogButton");
const exitButton = document.getElementById("exitButton");
const saveButton = document.getElementById("saveButton");
const buyerUrlOverlay = document.getElementById("buyerUrlOverlay");
const buyerUrlCloseButton = document.getElementById("buyerUrlCloseButton");
const buyerUrlCancelButton = document.getElementById("buyerUrlCancelButton");
const buyerUrlApplyButton = document.getElementById("buyerUrlApplyButton");
const buyerUrlAddButton = document.getElementById("buyerUrlAddButton");
const buyerUrlList = document.getElementById("buyerUrlList");
const buyerUrlDialogFeedback = document.getElementById("buyerUrlDialogFeedback");
const credentialOverlay = document.getElementById("credentialOverlay");
const credentialDialogTitle = document.getElementById("credentialDialogTitle");
const credentialDialogDescription = document.getElementById("credentialDialogDescription");
const credentialCloseButton = document.getElementById("credentialCloseButton");
const credentialCancelButton = document.getElementById("credentialCancelButton");
const credentialApplyButton = document.getElementById("credentialApplyButton");
const credentialAddButton = document.getElementById("credentialAddButton");
const credentialList = document.getElementById("credentialList");
const credentialDialogFeedback = document.getElementById("credentialDialogFeedback");
const indicatorTooltip = document.createElement("div");
const clickableIndicatorKeys = new Set(["service", "web"]);
const workflowActionTargets = {
  config: [configButton],
  service: [serviceLoginButton],
  web: [webLoginButton],
  main: [startButton, pauseButton, stopButton],
  logs: [logsLink, openLogButton, exitButton],
};
const indicatorStateLabels = {
  idle: "待命",
  ok: "正常",
  running: "进行中",
  warning: "需要关注",
  stopped: "已停止",
};
const lockedLoginTargets = new Set();
const pendingLoginTargets = new Set();
const buyerUrlState = {
  selectedUrl: "",
  entries: [],
};
let buyerUrlDraftRows = [];
let buyerUrlDraftSelectedIndex = 0;
let buyerUrlSummaryElement = null;
const credentialLabels = {
  service: "咚咚账号",
  web: "买家账号",
};
const credentialState = {
  service: { selected: { username: "", password: "" }, entries: [] },
  web: { selected: { username: "", password: "" }, entries: [] },
};
const credentialSummaryElements = {};
let credentialDialogTarget = "service";
let credentialDraftRows = [];
let credentialDraftSelectedIndex = 0;

indicatorTooltip.className = "indicator-tooltip hidden";
document.body.appendChild(indicatorTooltip);

const fieldDefs = [
  { key: "service_url", label: "咚咚客服网址" },
  { key: "buyer_url_manager", label: "买家咨询网址", type: "buyerUrls", wide: true },
  { key: "service_keywords", label: "咚咚关键字", hint: "例：咚咚工作站,聊天工作台" },
  { key: "web_keywords", label: "买家关键字", hint: "例：在线客服,jdcs" },
  { key: "service_ratio", label: "咚咚比例", hint: "例：0.5,0.86" },
  { key: "web_ratio", label: "买家比例", hint: "例：0.5,0.86" },
  { key: "service_delay", label: "咚咚固定延迟秒" },
  { key: "service_random_delay", label: "咚咚随机延迟", hint: "例：3,5" },
  { key: "web_delay", label: "买家固定延迟秒" },
  { key: "web_random_delay", label: "买家随机延迟", hint: "例：3,5" },
  { key: "rounds", label: "总轮数" },
  { key: "login_timeout", label: "登录状态等待", hint: "持续等到变绿" },
  { key: "service_credential_manager", label: "咚咚账号", type: "credentials", target: "service" },
  { key: "web_credential_manager", label: "买家账号", type: "credentials", target: "web" },
  { key: "work_rest", label: "工作/休息", hint: "例：60,60" },
  { key: "emoji_probability", label: "表情概率", hint: "0 到 1" },
  { key: "emoji_count_range", label: "表情数量", hint: "例：1,3" },
  { key: "browser_executable", label: "浏览器路径（可空）" },
];
