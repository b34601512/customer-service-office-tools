// 对比实验：不带 windowsHide vs 带 windowsHide —— 黑窗到底弹不弹
// 运行：node 复现\对比实验.js
// 建议在【普通终端】里跑：自动化/隐藏上下文里，Windows 可能根本不给弹窗，看不到对照。
// 跑的时候盯着屏幕：① 的那次应有一扇黑窗一闪；② 的那次不应有任何窗。
const { spawn, execFileSync } = require("node:child_process");
const path = require("node:path");

function 数可见窗() {
  const 出 = execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(__dirname, "..", "工具", "列可见窗.ps1"),
  ], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  const m = /Total visible top-level windows:\s*(\d+)/.exec(出);
  return m ? parseInt(m[1], 10) : -1;
}

function 起一个(带隐藏, 标题) {
  return new Promise((完成) => {
    const 子 = spawn("cmd", ["/c", `title ${标题} & ping -n 3 127.0.0.1 >nul`], {
      windowsHide: 带隐藏, // ★ 关键开关
      stdio: "ignore",
    });
    子.on("exit", 完成);
  });
}

(async () => {
  console.log("基线可见窗：" + 数可见窗());

  console.log("① 不带 windowsHide 起一个短命令（普通终端里：应有一扇黑窗一闪）");
  const a = 起一个(false, "PACK-DEMO-A");
  await new Promise((r) => setTimeout(r, 300));
  console.log("   运行中可见窗：" + 数可见窗());
  await a;

  await new Promise((r) => setTimeout(r, 400));
  console.log("② 带 windowsHide 起同样的命令（应无任何窗）");
  const b = 起一个(true, "PACK-DEMO-B");
  await new Promise((r) => setTimeout(r, 300));
  console.log("   运行中可见窗：" + 数可见窗());
  await b;

  console.log("结束。两次「运行中」数字若一样——多半是本环境不给弹窗，换普通终端再跑一次。");
})();
