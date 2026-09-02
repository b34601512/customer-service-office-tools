// TUI 交互原语（唯一允许接触 readline/console 的地方）
// 不含任何业务逻辑：只负责读输入、打印输出、调 ui。业务全部在 src/services。
const readline = require('readline/promises');

const todayDate = () => new Date().toLocaleDateString('sv-SE');

function makeUi({ input = process.stdin, output = process.stdout } = {}) {
  function write(text = '') { output.write(String(text)); }
  function line(text = '') { output.write(`${String(text)}\n`); }
  function clear() { output.write('\u001b[2J\u001b[H\u001b[3J'); }
  function hr() { line('━'.repeat(44)); }
  function header(text) {
    clear();
    hr();
    line(`  ${text}`);
    hr();
  }

  async function askText(question, { allowEmpty = false } = {}) {
    const rl = readline.createInterface({ input, output });
    try {
      const answer = String(await rl.question(`${question}`)).trim();
      if (!answer && !allowEmpty) throw new Error('不能为空，请重新输入。');
      return answer;
    } finally {
      rl.close();
    }
  }

  /** 多行粘贴：粘贴完成后在新的一行输入 end 回车结束。返回拼接后的文本。 */
  async function readMultiline(hint) {
    const rl = readline.createInterface({ input, output });
    try {
      line(hint);
      const chunks = [];
      for await (const raw of rl) {
        const t = String(raw).trimEnd();
        if (t.trim() === 'end') break;
        chunks.push(raw);
      }
      return chunks.join('\n');
    } finally {
      rl.close();
    }
  }

  /** 菜单：items 为字符串数组，自动编号；返回选中下标，选 0 返回 -1（取消）。 */
  async function askChoice(question, items, { cancelLabel = '返回' } = {}) {
    line('');
    items.forEach((label, i) => line(`  ${i + 1}. ${label}`));
    line(`  0. ${cancelLabel}`);
    for (;;) {
      const ans = String(await askText(`\n${question}（输入数字）> `, { allowEmpty: false })).trim();
      if (ans === '0') return -1;
      const n = Number(ans);
      if (Number.isInteger(n) && n >= 1 && n <= items.length) return n - 1;
      line(`请输入 0-${items.length}。`);
    }
  }

  async function pause(message = '按回车返回……') {
    await askText(`\n${message}`, { allowEmpty: true });
  }

  function showCheckReport(items) {
    line('');
    for (const it of items) {
      const tag = it.status === 'ok' ? '[通过]' : it.status === 'warn' ? '[警告]' : '[失败]';
      line(`  ${tag} ${it.text}`);
    }
    const fail = items.filter((x) => x.status === 'fail').length;
    const warn = items.filter((x) => x.status === 'warn').length;
    line('');
    line(fail === 0 ? (warn === 0 ? '  ✔ 自检全部通过' : `  ✔ 自检通过（${warn} 项警告，可人工复核）`) : `  ✗ 自检有 ${fail} 项失败，请修正后重新生成`);
  }

  return { write, line, clear, hr, header, askText, readMultiline, askChoice, pause, showCheckReport, todayDate };
}

module.exports = { makeUi, todayDate };
