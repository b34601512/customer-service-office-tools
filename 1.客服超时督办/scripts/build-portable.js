const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

// 只复制发布白名单；绝不打包整个工作目录或运行资料。
function buildPortable(outputParent, { includeNode = true, nodeLicensePath } = {}) {
  const projectRoot = path.resolve(__dirname, "..");
  const parent = path.resolve(outputParent);
  fs.mkdirSync(parent, { recursive: true });
  const releaseRoot = fs.mkdtempSync(path.join(parent, "客服督办-Edge-"));
  const copy = (relative) => fs.cpSync(path.join(projectRoot, relative), path.join(releaseRoot, relative), { recursive: true });
  for (const relative of ["src", "package.json", "package-lock.json", "README.md", "启动中心.bat"]) copy(relative);
  // 业务策略仅含已审核的阈值/关键词，不包含账号、排班链接或群机器人配置。
  copy("project-config/reply-config.js");
  const writeJson = (name, value) => fs.writeFileSync(path.join(releaseRoot, "project-config", name), JSON.stringify(value, null, 2) + "\n");
  writeJson("app-config.json", { targetUrl: "https://zan-mh.xiaoshunai.com/", scheduleUrl: "", managerStaffName: "" });
  writeJson("wecom-robot.json", { notification_groups: [], member_directory: [] });
  const dependencyRoot = path.join(projectRoot, "node_modules", "playwright-core");
  const dependency = JSON.parse(fs.readFileSync(path.join(dependencyRoot, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(projectRoot, "package-lock.json"), "utf8"));
  if (dependency.version !== lock.packages["node_modules/playwright-core"].version) throw new Error("依赖版本与锁文件不一致，请先 npm ci 后打包。");
  fs.cpSync(dependencyRoot, path.join(releaseRoot, "node_modules", "playwright-core"), { recursive: true });
  if (includeNode) {
    if (process.platform !== "win32" || process.arch !== "x64") throw new Error("当前分享包仅制作 Windows x64 版本。");
    if (!nodeLicensePath || !fs.existsSync(nodeLicensePath)) throw new Error("打包 Node 必须提供对应版本的官方 LICENSE 文件。");
    fs.mkdirSync(path.join(releaseRoot, "tools"));
    fs.copyFileSync(process.execPath, path.join(releaseRoot, "tools", "node.exe"));
    fs.copyFileSync(nodeLicensePath, path.join(releaseRoot, "tools", "NODE-LICENSE.txt"));
  }
  fs.writeFileSync(path.join(releaseRoot, "发布说明.txt"), [
    "解压后双击启动中心.bat，不需要安装 Chrome 或 Node.js。",
    "修订版 r2：修复登录保存假运行、新标签页识别、取消操作及配置编辑问题。",
    "登录后请先进入聊天工作台，再回1总览选择完成登录并继续；等任务结束且登录态有效后再后台启动。",
    "首次登录后，在配置中填写自己的主管姓名、排班链接，在企微页配置通知群和同名主管及客服成员。",
    "后台监控使用无头 Edge，首次登录使用可见 Edge。登录失效请重新首次登录。",
    "支持目标为 Windows 11 x64 + 现代 Edge；Windows 10 尚待实际验证，不能保证所有版本可用。",
    "请勿直接分享使用后的整个文件夹，它会包含你的登录态和群密钥。",
    `构建运行时：Node ${process.version}，Playwright ${dependency.version}`
  ].join("\r\n"));
  return releaseRoot;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const licenseIndex = args.indexOf("--node-license");
  const output = buildPortable(args[0] || path.join(os.tmpdir(), "supervisor-releases"), {
    nodeLicensePath: licenseIndex >= 0 ? args[licenseIndex + 1] : undefined
  });
  console.log(output);
}

module.exports = { buildPortable };
