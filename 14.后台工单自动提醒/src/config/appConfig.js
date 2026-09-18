// 本文件只负责集中定义路径与少量常量，不含业务判断。
const path = require("path");

const projectRoot = path.resolve(__dirname, "..", "..");
// 测试/AI 可用 WORK_ORDER_HOME 指向隔离运行目录，跑同一条真实链路而不污染正式 runtime（#2705）。
const runtimeDir = process.env.WORK_ORDER_HOME || path.join(projectRoot, "runtime");

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
];

module.exports = {
  projectRoot,
  runtimeDir,
  logDir: path.join(runtimeDir, "logs"),
  stateDir: path.join(runtimeDir, "state"),
  monitorStatePath: path.join(runtimeDir, "state", "monitor-state.json"),
  alertLedgerPath: path.join(runtimeDir, "state", "alert-ledger.jsonl"),
  browserProfilesRoot: path.join(runtimeDir, "state", "browser-profiles"),
  // 常驻监控的「店铺 → 调试端口」登记表：重启后据此附着回同一个窗口，不重复开窗。
  browserPortsPath: path.join(runtimeDir, "state", "browser-ports.json"),
  projectConfigPath: process.env.WORK_ORDER_CONFIG || path.join(projectRoot, "project-config", "platform-config.json"),
  exampleConfigPath: path.join(projectRoot, "project-config", "platform-config.example.json"),
  chromeCandidates: CHROME_CANDIDATES,
  baseDebugPort: 9411
};
