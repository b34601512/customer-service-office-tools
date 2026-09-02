const readline = require("readline");
const { createInterface } = require("readline/promises");
const { createCliTheme } = require("./cliTheme");

function normalizeMenuAnswer(value) {
  return String(value || "").trim().toLowerCase();
}

function createCliTerminal({ input = process.stdin, output = process.stdout } = {}) {
  const theme = createCliTheme(output);
  const write = (text = "") => output.write(String(text));
  const writeLine = (text = "") => output.write(`${String(text)}\n`);
  const clear = () => { output.write("\u001b[2J\u001b[H\u001b[3J"); };
  async function readAnswer(question, normalize) {
    const promptInterface = createInterface({ input, output, terminal: Boolean(input.isTTY) });
    try { return normalize(await promptInterface.question(question)); } finally { promptInterface.close(); }
  }
  const prompt = (question) => readAnswer(question, normalizeMenuAnswer);
  const promptText = (question) => readAnswer(question, (value) => String(value).trim());
  async function promptSecret(question) {
    if (!input.isTTY || typeof input.setRawMode !== "function") return promptText(question);
    return new Promise((resolve, reject) => {
      let secretValue = "";
      const previousRawMode = Boolean(input.isRaw);
      function restoreInput() {
        input.removeListener("keypress", handleKeypress);
        input.setRawMode(previousRawMode);
        input.pause();
      }
      function handleKeypress(character, key = {}) {
        if (key.ctrl && key.name === "c") {
          restoreInput(); writeLine(); reject(Object.assign(new Error("用户取消输入。"), { code: "CLI_INPUT_CANCELLED" })); return;
        }
        if (key.name === "return" || key.name === "enter") { restoreInput(); writeLine(); resolve(secretValue); return; }
        if (key.name === "backspace") {
          if (secretValue.length) { secretValue = secretValue.slice(0, -1); write("\b \b"); }
          return;
        }
        if (!key.ctrl && !key.meta && character) { secretValue += character; write("*"); }
      }
      write(question); readline.emitKeypressEvents(input); input.setRawMode(true); input.resume(); input.on("keypress", handleKeypress);
    });
  }
  const pause = (message = "按回车键返回……") => promptText(`\n${message}`);
  return { input, output, theme, write, writeLine, clear, prompt, promptText, promptSecret, pause };
}

module.exports = { normalizeMenuAnswer, createCliTerminal };
