// 该文件解决 Chrome 偶发不把 .crdownload 收尾改名的真实缺陷：
// 下载内容其实已经完整落盘，但浏览器一直等待服务端关闭连接，文件永远停在 .crdownload。
// 这里只做“结构完整性”判定后把完整临时文件恢复成正式文件，绝不接受截断/损坏文件。
const fs = require("fs");
const path = require("path");

const 临时后缀正则 = /\.(crdownload|tmp)$/i;
const ZIP签名 = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const OLE2签名 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

function 是完整Zip文件(fullPath) {
  // ZIP 结尾必须有 EOCD，且中央目录偏移/长度与真实文件大小自洽，截断文件一定不满足。
  let size = 0;
  try {
    size = fs.statSync(fullPath).size;
  } catch {
    return false;
  }
  if (size < 22) return false;
  const readLength = Math.min(size, 65557);
  const buffer = Buffer.alloc(readLength);
  const fd = fs.openSync(fullPath, "r");
  try {
    fs.readSync(fd, buffer, 0, readLength, size - readLength);
  } catch {
    return false;
  } finally {
    fs.closeSync(fd);
  }
  const eocdIndex = buffer.lastIndexOf(ZIP签名);
  if (eocdIndex < 0 || eocdIndex + 22 > readLength) return false;
  const centralDirSize = buffer.readUInt32LE(eocdIndex + 12);
  const centralDirOffset = buffer.readUInt32LE(eocdIndex + 16);
  const commentLength = buffer.readUInt16LE(eocdIndex + 20);
  const eocdAbsoluteOffset = size - readLength + eocdIndex;
  return centralDirOffset + centralDirSize === eocdAbsoluteOffset && eocdAbsoluteOffset + 22 + commentLength === size;
}

function 是完整Ole2文件(fullPath) {
  // OLE2/CFB（.xls）：头 512 字节签名 + 文件大小必须是扇区整数倍 + 真实解析必须成功；
  // 三段都满足才认完整，截断文件在最后一步一定解析失败。
  let size = 0;
  try {
    size = fs.statSync(fullPath).size;
  } catch {
    return false;
  }
  if (size < 512) return false;
  const header = Buffer.alloc(512);
  const fd = fs.openSync(fullPath, "r");
  try {
    fs.readSync(fd, header, 0, 512, 0);
  } catch {
    return false;
  } finally {
    fs.closeSync(fd);
  }
  if (!header.subarray(0, 8).equals(OLE2签名)) return false;
  const sectorShift = header.readUInt16LE(0x1e);
  if (sectorShift < 7 || sectorShift > 20) return false;
  const sectorSize = 2 ** sectorShift;
  if (size % sectorSize !== 0) return false;
  const fatSectorCount = header.readUInt32LE(0x2c);
  if (fatSectorCount < 1 || (1 + fatSectorCount) * sectorSize > size) return false;
  try {
    const XLSX = require("xlsx");
    const workbook = XLSX.readFile(fullPath);
    return Boolean(workbook && Array.isArray(workbook.SheetNames) && workbook.SheetNames.length > 0);
  } catch {
    return false;
  }
}

function 按扩展名校验完整性(fullPath, baseName) {
  const extension = path.extname(String(baseName || "")).toLowerCase();
  if ([".xlsx", ".xlsm", ".zip"].includes(extension)) return 是完整Zip文件(fullPath);
  if ([".xls", ".xlsb"].includes(extension)) return 是完整Ole2文件(fullPath);
  return false;
}

function 查找完整临时下载产物(downloadDir, beforeFiles, options = {}) {
  // 只在目录里找“本轮新增、大小稳定、结构完整”的临时下载文件，恢复成正式文件名后返回。
  const stableMs = Math.max(0, Number(options.stableMs ?? 2000));
  const now = Date.now();
  if (!downloadDir || !fs.existsSync(downloadDir)) return null;
  const candidates = fs
    .readdirSync(downloadDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && 临时后缀正则.test(entry.name) && !(beforeFiles instanceof Set ? beforeFiles.has(entry.name) : false))
    .map((entry) => {
      const fullPath = path.join(downloadDir, entry.name);
      const stat = fs.statSync(fullPath);
      return { name: entry.name, fullPath, size: stat.size, modifiedAt: stat.mtimeMs };
    })
    .filter((item) => item.size > 0 && now - item.modifiedAt >= stableMs)
    .sort((left, right) => right.modifiedAt - left.modifiedAt);

  for (const item of candidates) {
    const baseName = item.name.replace(临时后缀正则, "");
    if (!按扩展名校验完整性(item.fullPath, baseName)) continue;
    const targetPath = path.join(downloadDir, baseName);
    try {
      if (!fs.existsSync(targetPath)) {
        fs.renameSync(item.fullPath, targetPath);
      } else {
        fs.copyFileSync(item.fullPath, targetPath);
        fs.unlinkSync(item.fullPath);
      }
    } catch {
      continue;
    }
    const stat = fs.statSync(targetPath);
    return { name: baseName, fullPath: targetPath, size: stat.size, modifiedAt: stat.mtimeMs, recoveredFromTemporary: true };
  }
  return null;
}

module.exports = {
  是完整Zip文件,
  是完整Ole2文件,
  按扩展名校验完整性,
  查找完整临时下载产物
};
