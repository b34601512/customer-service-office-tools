const fs = require("fs");
const path = require("path");
const { movePathToBackup } = require("../engine/fileSystem");

const retryableFileRenameErrorCodes = new Set(["EPERM", "EBUSY", "EACCES"]);

function isRetryableFileRenameError(error) {
  return retryableFileRenameErrorCodes.has(String(error?.code || "").toUpperCase());
}

function waitForFileRenameRetry(delayMs) {
  if (delayMs <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}

function renameFileWithRetry(temporaryPath, targetPath, options = {}) {
  const maximumAttempts = Math.max(1, Number(options.maximumAttempts) || 4);
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs) || 250);
  const renameFn = options.renameFn || fs.renameSync;
  const waitFn = options.waitFn || waitForFileRenameRetry;

  for (let attemptNumber = 1; attemptNumber <= maximumAttempts; attemptNumber += 1) {
    try {
      renameFn(temporaryPath, targetPath);
      return;
    } catch (error) {
      if (!isRetryableFileRenameError(error) || attemptNumber === maximumAttempts) {
        throw error;
      }
      waitFn(retryDelayMs);
    }
  }
}

function ensureParentDir(filePath) {
  // 这里先补齐父目录，避免首次写配置时因为目录不存在直接失败。
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJsonFile(filePath, label) {
  // 这里统一读取 JSON 文件，出错时直接给出中文定位信息。
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} 读取失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

function createUniqueJsonTemporaryFile(filePath, payload) {
  const fileContents = JSON.stringify(payload, null, 2);
  const parsedPath = path.parse(filePath);
  for (let attemptNumber = 1; attemptNumber <= 10; attemptNumber += 1) {
    const temporaryPath = path.join(
      parsedPath.dir,
      `.${parsedPath.base}.write-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`
    );
    try {
      fs.writeFileSync(temporaryPath, fileContents, { encoding: "utf8", flag: "wx" });
      return temporaryPath;
    } catch (error) {
      if (String(error?.code || "").toUpperCase() !== "EEXIST" || attemptNumber === 10) {
        throw error;
      }
    }
  }
  throw new Error(`创建临时文件失败：${filePath}`);
}

function preserveFailedJsonTemporaryFile(temporaryPath) {
  const backupRootDir = path.join(path.parse(temporaryPath).root, "备份文件夹");
  return movePathToBackup(temporaryPath, backupRootDir, "JSON原子写入临时文件");
}

function writeJsonFileAtomic(filePath, payload, options = {}) {
  // 这里统一走“唯一临时文件 -> 原子替换”，避免半截 JSON 和多个进程共用同名临时文件。
  ensureParentDir(filePath);
  let temporaryPath = "";

  try {
    temporaryPath = createUniqueJsonTemporaryFile(filePath, payload);
    renameFileWithRetry(temporaryPath, filePath, options);
  } catch (error) {
    let preservedPath = temporaryPath;
    if (temporaryPath && fs.existsSync(temporaryPath)) {
      try {
        preservedPath = preserveFailedJsonTemporaryFile(temporaryPath);
      } catch (preserveError) {
        preservedPath = temporaryPath;
        error.pendingFilePreserveError = preserveError;
      }
    }
    const pendingPathText = preservedPath ? ` 临时文件已保留：${preservedPath}` : "";
    const atomicWriteError = new Error(`原子写入失败：${error.message || String(error)}。正式文件未改动。${pendingPathText}`);
    atomicWriteError.code = error.code;
    atomicWriteError.pendingFilePath = preservedPath;
    atomicWriteError.cause = error;
    throw atomicWriteError;
  }
}

module.exports = {
  readJsonFile,
  writeJsonFileAtomic,
  isRetryableFileRenameError,
  renameFileWithRetry
};
