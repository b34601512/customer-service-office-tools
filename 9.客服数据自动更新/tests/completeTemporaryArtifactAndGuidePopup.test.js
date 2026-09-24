// 2026-09-24 根因修复回归测试：
// 1) Chrome 偶发不把已完整的 .crdownload 收尾改名——只允许“结构完整”的临时文件被恢复；
// 2) 抖音体验分引导层遮挡切店点击——必须注册为可治理弹窗，并允许“关一次再重试同一点击”。
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const XLSX = require("xlsx");
const {
  是完整Zip文件,
  是完整Ole2文件,
  查找完整临时下载产物
} = require("../src/shared/completeTemporaryArtifact");
const { DOUYIN_AD_POPUP_SELECTORS } = require("../src/platforms/douyin/downloadTaskParts/douyinAdPopupDismiss");
const { clickDouyinSwitchStoreEntry } = require("../src/platforms/douyin/downloadTaskParts/douyinStoreMenu");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "artifact-test-"));
}

function writeCompleteXlsx(targetPath) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["姓名", "业绩"], ["小黛", 123]]), "整体数据");
  XLSX.writeFile(workbook, targetPath, { bookType: "xlsx" });
}

function writeCompleteXls(targetPath) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["姓名", "业绩"], ["小黛", 123]]), "Sheet0");
  XLSX.writeFile(workbook, targetPath, { bookType: "biff8" });
}

function testCompleteZipTemporaryIsRecovered() {
  const dir = makeTempDir();
  const complete = path.join(dir, "京麦接待数据_1.xlsx");
  writeCompleteXlsx(complete);
  const temporary = `${complete}.crdownload`;
  fs.renameSync(complete, temporary);
  assert.strictEqual(是完整Zip文件(temporary), true);
  const artifact = 查找完整临时下载产物(dir, new Set(), { stableMs: 0 });
  assert.ok(artifact, "完整 zip 临时文件必须被恢复");
  assert.strictEqual(artifact.name, "京麦接待数据_1.xlsx");
  assert.strictEqual(artifact.recoveredFromTemporary, true);
  assert.strictEqual(fs.existsSync(temporary), false, "恢复后不得残留 .crdownload");
  assert.strictEqual(fs.existsSync(artifact.fullPath), true);
}

function testTruncatedZipTemporaryIsRejected() {
  const dir = makeTempDir();
  const complete = path.join(dir, "京麦接待数据_2.xlsx");
  writeCompleteXlsx(complete);
  const buffer = fs.readFileSync(complete);
  const temporary = path.join(dir, "京麦接待数据_2.xlsx.crdownload");
  fs.writeFileSync(temporary, buffer.subarray(0, Math.floor(buffer.length * 0.6)));
  assert.strictEqual(是完整Zip文件(temporary), false);
  const artifact = 查找完整临时下载产物(dir, new Set(), { stableMs: 0 });
  assert.strictEqual(artifact, null, "截断 zip 绝不能被当成完整文件");
  assert.strictEqual(fs.existsSync(temporary), true, "被拒绝的临时文件必须原样保留");
}

function testCompleteOleTemporaryIsRecovered() {
  const dir = makeTempDir();
  const complete = path.join(dir, "客服统计.xls");
  writeCompleteXls(complete);
  const temporary = `${complete}.crdownload`;
  fs.renameSync(complete, temporary);
  assert.strictEqual(是完整Ole2文件(temporary), true);
  const artifact = 查找完整临时下载产物(dir, new Set(), { stableMs: 0 });
  assert.ok(artifact, "完整 xls 临时文件必须被恢复");
  assert.strictEqual(artifact.name, "客服统计.xls");
  assert.strictEqual(fs.existsSync(temporary), false);
}

function testTruncatedOleTemporaryIsRejected() {
  const dir = makeTempDir();
  const complete = path.join(dir, "客服统计2.xls");
  writeCompleteXls(complete);
  const buffer = fs.readFileSync(complete);
  const temporary = path.join(dir, "客服统计2.xls.crdownload");
  fs.writeFileSync(temporary, buffer.subarray(0, Math.floor(buffer.length * 0.7)));
  assert.strictEqual(是完整Ole2文件(temporary), false);
  assert.strictEqual(查找完整临时下载产物(dir, new Set(), { stableMs: 0 }), null);
}

function testRecentlyModifiedTemporaryIsNotRecovered() {
  const dir = makeTempDir();
  const complete = path.join(dir, "刚下载.xlsx");
  writeCompleteXlsx(complete);
  const temporary = `${complete}.crdownload`;
  fs.renameSync(complete, temporary);
  assert.strictEqual(查找完整临时下载产物(dir, new Set(), { stableMs: 60_000 }), null, "未稳定前不得抢跑");
}

function testBeforeFilesAreIgnored() {
  const dir = makeTempDir();
  const complete = path.join(dir, "旧文件.xlsx");
  writeCompleteXlsx(complete);
  const temporary = `${complete}.crdownload`;
  fs.renameSync(complete, temporary);
  const beforeFiles = new Set([path.basename(temporary)]);
  assert.strictEqual(查找完整临时下载产物(dir, beforeFiles, { stableMs: 0 }), null, "下载前就存在的临时文件不算本轮产物");
}

function testDouyinGuideOverlaySelectorIsRegistered() {
  const selectors = DOUYIN_AD_POPUP_SELECTORS.join(" ");
  assert.ok(selectors.includes("[data-guide='expr-score-guide']"), "体验分引导层必须注册为可治理弹窗");
  assert.ok(selectors.includes("[class*='exprScoreContainer']"), "体验分引导层类名必须注册为可治理弹窗");
}

class FakeGuideOverlayPage {
  constructor() {
    this.menuOpen = false;
    this.switchEntryClickCount = 0;
    this.escapeCount = 0;
    this.shopHeader = {
      waitFor: async () => {},
      click: async () => {
        this.menuOpen = true;
      }
    };
    this.switchEntry = {
      isVisible: async () => this.menuOpen,
      click: async () => {
        this.switchEntryClickCount += 1;
        if (this.switchEntryClickCount === 1) {
          throw new Error("<div data-guide=\"expr-score-guide\">…</div> from <div id=\"app-main\"> subtree intercepts pointer events");
        }
        this.menuOpen = false;
      }
    };
  }

  locator(selector) {
    if (selector === '[class*="headerShopName"]') return { first: () => this.shopHeader };
    if (selector === "body") return { innerText: async () => (this.menuOpen ? "店铺ID 29502951 切换组织/店铺" : "抖店首页") };
    // 共享弹窗引擎与抖音弹窗识别在本用例里都应认为“没有可治理弹窗”。
    return {
      count: async () => 0,
      first() {
        return this;
      },
      nth() {
        return this;
      },
      isVisible: async () => false
    };
  }

  getByText(text, options) {
    assert.strictEqual(text, "切换组织/店铺");
    assert.deepStrictEqual(options, { exact: true });
    return {
      count: async () => 1,
      nth: () => this.switchEntry
    };
  }

  get keyboard() {
    return { press: async () => { this.escapeCount += 1; } };
  }

  async waitForTimeout() {}
}

async function testDouyinSwitchClickRetriesOnceAfterPointerInterception() {
  const page = new FakeGuideOverlayPage();
  await clickDouyinSwitchStoreEntry(page);
  assert.strictEqual(page.switchEntryClickCount, 2, "被引导层遮挡后必须再关一次弹窗并重试同一点击");
}

async function run() {
  testCompleteZipTemporaryIsRecovered();
  console.log("PASS 完整的 .crdownload(xlsx) 应恢复为正式文件");
  testTruncatedZipTemporaryIsRejected();
  console.log("PASS 截断的 .crdownload(xlsx) 必须拒绝且不删除");
  testCompleteOleTemporaryIsRecovered();
  console.log("PASS 完整的 .crdownload(xls) 应恢复为正式文件");
  testTruncatedOleTemporaryIsRejected();
  console.log("PASS 截断的 .crdownload(xls) 必须拒绝");
  testRecentlyModifiedTemporaryIsNotRecovered();
  console.log("PASS 仍在写入的临时文件不得抢跑恢复");
  testBeforeFilesAreIgnored();
  console.log("PASS 下载前已存在的临时文件不算本轮产物");
  testDouyinGuideOverlaySelectorIsRegistered();
  console.log("PASS 抖音体验分引导层必须注册为可治理弹窗");
  await testDouyinSwitchClickRetriesOnceAfterPointerInterception();
  console.log("PASS 抖音切店被遮挡时只重试一次同一点击");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
