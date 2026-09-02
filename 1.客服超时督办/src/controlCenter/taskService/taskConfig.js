const path = require("path");

function buildTaskConfig(taskName, projectRoot) {
  // 这里统一控制网页按钮能启动的脚本，避免任意任务名被透传执行。
  const nodeExecutable = process.execPath;
  if (taskName === "login") {
    return {
      command: nodeExecutable,
      args: [path.join(projectRoot, "src/main.js"), "login"],
      windowLabel: "首次登录",
      successMessage: "首次登录已启动，请在浏览器中完成登录。"
    };
  }

  if (taskName === "start") {
    return {
      command: nodeExecutable,
      args: [path.join(projectRoot, "src/main.js"), "run"],
      windowLabel: "后台督办",
      successMessage: "后台督办已启动。"
    };
  }

  throw new Error("未知任务类型：" + taskName);
}

module.exports = {
  buildTaskConfig
};
