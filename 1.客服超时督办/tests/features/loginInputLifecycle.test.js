const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { LOGIN_CONFIRM_PROMPT } = require("../../src/features/loginFlow");

for (const mode of ["success", "failure", "eof", "abort"]) {
  test(`真实 Node 输入管道：${mode} 自然退出，不依赖父进程关闭管道`, async () => {
    const script = `
      const { waitForEnter } = require(${JSON.stringify(require.resolve("../../src/features/loginFlow"))});
      (async () => {
        const controller = new AbortController();
        if (${JSON.stringify(mode)} === 'abort') setTimeout(() => controller.abort(), 50);
        await waitForEnter(undefined, { signal: controller.signal });
        if (${JSON.stringify(mode)} === 'success') await waitForEnter();
        if (${JSON.stringify(mode)} === 'failure') throw new Error('验证失败');
      })().catch(error => { console.error(error.message); process.exitCode = 1; });
    `;
    const child = spawn(process.execPath, ["-e", script], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let output = "";
    let pending = "";
    let prompts = 0;
    let timedOut = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
      pending += chunk;
      let index;
      while ((index = pending.indexOf(LOGIN_CONFIRM_PROMPT)) !== -1) {
        pending = pending.slice(index + LOGIN_CONFIRM_PROMPT.length);
        prompts += 1;
        if (mode === "eof") child.stdin.end();
        else if (mode !== "abort") child.stdin.write("\n");
      }
    });
    child.stdin.on("error", () => {});
    child.stderr.on("data", (chunk) => { output += chunk; });
    const deadline = setTimeout(() => { timedOut = true; child.kill(); }, 5000);
    try {
      const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
      assert.equal(timedOut, false, output);
      assert.equal(code, mode === "success" ? 0 : 1, output);
      assert.equal(prompts, mode === "success" ? 2 : 1);
    } finally { clearTimeout(deadline); }
  });
}
