// 对比实验：默认 vs 收口——看子进程的 stderr 会不会「漏」到父进程的 stderr
// 跑法：node 复现\对比实验.cjs
const { execFileSync } = require("node:child_process");

function 跑(名字, 选项) {
  process.stdout.write(`\n== ${名字} ==\n`);
  try {
    execFileSync(
      process.execPath,
      ["-e", 'console.error("[子进程] 我故意失败！"); process.exit(3)'],
      { encoding: "utf8", ...选项 },
    );
    process.stdout.write("（咦，子进程居然成功了？）\n");
  } catch (e) {
    process.stdout.write(
      `catch 到了：status=${e.status}，子进程 stderr=${JSON.stringify(String(e.stderr || "").trim())}\n`,
    );
  }
}

process.stdout.write("下面开始跑：注意**本进程的 stderr**里有没有冒出「[子进程] 我故意失败！」\n");
跑("第 1 项：默认（没写 stdio）");
跑("第 2 项：收口 stdio: ['ignore','pipe','pipe']", { stdio: ["ignore", "pipe", "pipe"] });
process.stdout.write("\n完（对照本进程 stderr 上的行数即可）\n");
