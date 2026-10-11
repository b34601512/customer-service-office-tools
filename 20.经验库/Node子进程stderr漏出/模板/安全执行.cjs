// 安全执行 —— 调外部命令的「收口」封装：子进程 stderr 不外漏，失败信息只进返回值
// 用法：复制进你的项目；或 require 后用 安全执行("命令", ["参数", …])
const { execFileSync } = require("node:child_process");

function 安全执行(命令, 参数 = [], { 超时毫秒 = 30000, 工作目录 } = {}) {
  try {
    const 输出 = execFileSync(命令, 参数, {
      encoding: "utf8",
      timeout: 超时毫秒,
      cwd: 工作目录,
      windowsHide: true,
      // ★ 收口这一行：子进程 stderr 收进异常对象（e.stderr），不往父进程漏
      //   用 ["pipe","pipe","pipe"]：带 input 也能正常喂进去；若确定不喂 input，["ignore",…] 也行
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { 成功: true, 状态码: 0, 输出: 输出.trim(), 错误: "" };
  } catch (e) {
    // 失败信息只放进返回值——由调用方决定写日志、告警，绝不「顺手」漏出去
    return {
      成功: false,
      状态码: typeof e.status === "number" ? e.status : null,
      输出: String(e.stdout || "").trim(),
      错误: String(e.stderr || e.message || "").trim(),
    };
  }
}

// 自测：成功 + 失败各一条；跑完本进程的 stderr 上不该出现子进程的报错
if (require.main === module) {
  console.log("成功例：", 安全执行(process.execPath, ["-e", "console.log('一切正常')"]));
  console.log("失败例：", 安全执行(process.execPath, ["-e", "console.error('出问题了'); process.exit(3)"]));
  console.log("（若上面没多出别的行，说明 stderr 已收口）");
}

module.exports = { 安全执行 };
