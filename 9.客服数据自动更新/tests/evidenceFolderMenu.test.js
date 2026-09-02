const assert = require("assert");
const {
  resolveSourceDownloadRoot,
  showEvidenceFolderMenu
} = require("../src/cli/cliEvidenceMenu");

function createMenuTerminal(menuAnswer) {
  const outputLines = [];
  return {
    outputLines,
    clear() {},
    writeLine(value = "") {
      outputLines.push(String(value));
    },
    theme: {
      title: String,
      muted: String
    },
    async prompt() {
      return menuAnswer;
    }
  };
}

async function testOpenEvidenceFolderAction() {
  const terminal = createMenuTerminal("1");
  let evidenceFolderOpenCount = 0;
  let sourceFolderOpenCount = 0;
  await showEvidenceFolderMenu(terminal, { globalDefaults: { downloadRootDir: "D:\\下载源文件" } }, {
    async openSummaryEvidenceFolderImplementation() {
      evidenceFolderOpenCount += 1;
    },
    async openSourceDownloadFolderImplementation() {
      sourceFolderOpenCount += 1;
    }
  });
  assert.strictEqual(evidenceFolderOpenCount, 1);
  assert.strictEqual(sourceFolderOpenCount, 0);
  assert.match(terminal.outputLines.join("\n"), /\[1\] 打开凭证文件夹/);
}

async function testOpenSourceFolderAction() {
  const projectConfig = { globalDefaults: { downloadRootDir: "D:\\下载源文件" } };
  const terminal = createMenuTerminal("2");
  let receivedProjectConfig = null;
  await showEvidenceFolderMenu(terminal, projectConfig, {
    async openSummaryEvidenceFolderImplementation() {
      throw new Error("不应打开凭证文件夹");
    },
    async openSourceDownloadFolderImplementation(options) {
      receivedProjectConfig = options.projectConfig;
    }
  });
  assert.strictEqual(receivedProjectConfig, projectConfig);
  assert.strictEqual(resolveSourceDownloadRoot(projectConfig), "D:\\下载源文件");
  assert.match(terminal.outputLines.join("\n"), /\[2\] 打开源文件夹/);
}

async function main() {
  await testOpenEvidenceFolderAction();
  await testOpenSourceFolderAction();
  console.log("PASS 首页凭证和源文件改为两个文件夹入口");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
