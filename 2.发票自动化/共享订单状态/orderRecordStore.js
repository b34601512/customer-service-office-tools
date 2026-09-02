// 该文件用于解决各平台共用订单持久化、幂等迁移、同步去重、人工字段保留和归档防复活的问题。

const fs = require('node:fs');
const path = require('node:path');
const {
  工作流状态,
  工作流状态列表,
  从旧记录推断工作流状态,
  读取工作流状态,
  转换订单工作流状态,
  获取订单统计,
} = require('./orderWorkflow');

const 当前结构版本 = 2;
const 默认归档索引字段名 = 'archivedHandledOrders';
const 默认归档索引构建时间字段名 = 'handledArchiveIndexBuiltAt';
const 人工保留字段列表 = Object.freeze([
  'workflowStatus',
  'noteText',
  'contactName',
  'orderNoteText',
  'assigneeName',
  'processingAt',
  'invoiceRegisteredAt',
  'handledAt',
  'lastReturnAttempt',
  'invoiceReturned',
  'invoiceReturnedAt',
  'invoiceReturnFilePath',
  'invoiceReturnScreenshotPath',
  'invoiceReturnMessage',
]);
const 回传尝试状态列表 = Object.freeze([
  'queued',
  'downloading',
  'downloaded',
  'uploading',
  'success',
  'skipped',
  'error',
]);

function 确保父目录存在(filePath) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

function 读取JSON文件(filePath, defaultValue) {
  if (!fs.existsSync(filePath)) return defaultValue;
  const text = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`读取订单记录失败：${filePath} 不是有效 JSON，${error.message}`);
  }
}

function 写入JSON文件(filePath, value) {
  确保父目录存在(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return value;
}

function 校验根数据(raw, archiveIndexFieldName) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('读取订单记录失败：根节点必须是对象。');
  }
  if (!raw.orders || typeof raw.orders !== 'object' || Array.isArray(raw.orders)) {
    throw new Error('读取订单记录失败：orders 必须是对象。');
  }
  const archiveIndex = raw[archiveIndexFieldName] || {};
  if (!archiveIndex || typeof archiveIndex !== 'object' || Array.isArray(archiveIndex)) {
    throw new Error(`读取订单记录失败：${archiveIndexFieldName} 必须是对象。`);
  }
}

function 规范化订单键(key, record = {}) {
  const normalizedKey = String(key || record.key || record.orderKey || '').trim();
  if (!normalizedKey) throw new Error('保存订单记录失败：订单 key 不能为空。');
  return normalizedKey;
}

function 旧人工字段存在(record = {}) {
  return ['processing', 'invoiceRegistered', 'handled', 'followupStatus'].some((name) => Object.prototype.hasOwnProperty.call(record, name))
    || (Object.prototype.hasOwnProperty.call(record, 'status') && ['pending', 'processing', 'invoiceRegistered', 'invoice_registered', 'handled'].includes(String(record.status || '').trim()));
}

function 移除旧人工字段(record) {
  const next = { ...record };
  delete next.processing;
  delete next.invoiceRegistered;
  delete next.handled;
  delete next.followupStatus;
  if (['pending', 'processing', 'invoiceRegistered', 'invoice_registered', 'handled'].includes(String(next.status || '').trim())) {
    delete next.status;
  }
  return next;
}

function 规范化订单记录(key, record = {}, options = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(`读取订单记录失败：订单 ${key} 必须是对象。`);
  }
  const normalizedKey = 规范化订单键(key, record);
  const workflowStatus = options.migrateLegacy
    ? 从旧记录推断工作流状态(record)
    : 读取工作流状态(record);
  const next = 移除旧人工字段({
    ...record,
    key: normalizedKey,
    workflowStatus,
  });
  return next;
}

function 需要迁移订单数据(raw) {
  if (Number(raw.version || 0) !== 当前结构版本) return true;
  return Object.values(raw.orders || {}).some((record) => !工作流状态列表.includes(String(record?.workflowStatus || '').trim()) || 旧人工字段存在(record));
}

function 迁移订单数据(raw, options = {}) {
  const archiveIndexFieldName = options.archiveIndexFieldName || 默认归档索引字段名;
  const archiveBuiltAtFieldName = options.archiveBuiltAtFieldName || 默认归档索引构建时间字段名;
  校验根数据(raw, archiveIndexFieldName);
  const migrated = 需要迁移订单数据(raw);
  const orders = {};
  for (const [key, record] of Object.entries(raw.orders)) {
    const normalized = 规范化订单记录(key, record, { migrateLegacy: migrated });
    orders[normalized.key] = normalized;
  }
  return {
    migrated,
    data: {
      ...raw,
      version: 当前结构版本,
      orders,
      [archiveIndexFieldName]: { ...(raw[archiveIndexFieldName] || {}) },
      [archiveBuiltAtFieldName]: String(raw[archiveBuiltAtFieldName] || ''),
    },
  };
}

function 生成不冲突文件路径(filePath) {
  if (!fs.existsSync(filePath)) return filePath;
  const parsed = path.parse(filePath);
  for (let index = 1; index < 1000; index += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`生成迁移备份路径失败：${filePath}`);
}

function 复制迁移前文件(sourcePath, buildBackupPath, now) {
  if (!fs.existsSync(sourcePath)) return '';
  if (typeof buildBackupPath !== 'function') {
    throw new Error('迁移订单记录失败：缺少迁移备份路径规则。');
  }
  const backupPath = 生成不冲突文件路径(path.resolve(buildBackupPath(sourcePath, now)));
  确保父目录存在(backupPath);
  fs.copyFileSync(sourcePath, backupPath);
  return backupPath;
}

function 格式化时间批次(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function 创建订单记录仓库(options = {}) {
  const filePath = path.resolve(String(options.filePath || '').trim());
  if (!String(options.filePath || '').trim()) throw new Error('创建订单仓库失败：文件路径不能为空。');
  const archiveIndexFieldName = options.archiveIndexFieldName || 默认归档索引字段名;
  const archiveBuiltAtFieldName = options.archiveBuiltAtFieldName || 默认归档索引构建时间字段名;
  const buildMigrationBackupPath = options.buildMigrationBackupPath;
  const buildArchivePath = options.buildArchivePath;
  const archiveRoot = options.archiveRoot ? path.resolve(options.archiveRoot) : '';
  const importArchiveIndexBeforeSync = options.importArchiveIndexBeforeSync === true;
  const extraProtectedFields = Array.isArray(options.protectedFields) ? options.protectedFields : [];
  const protectedFields = [...new Set([...人工保留字段列表, ...extraProtectedFields])];
  const nowProvider = typeof options.nowProvider === 'function' ? options.nowProvider : () => new Date();

  function 创建空数据() {
    return {
      version: 当前结构版本,
      orders: {},
      [archiveIndexFieldName]: {},
      [archiveBuiltAtFieldName]: '',
    };
  }

  function 保存订单数据(data) {
    校验根数据(data, archiveIndexFieldName);
    const orders = {};
    for (const [key, record] of Object.entries(data.orders)) {
      const normalized = 规范化订单记录(key, record);
      orders[normalized.key] = normalized;
    }
    return 写入JSON文件(filePath, {
      ...data,
      version: 当前结构版本,
      orders,
      [archiveIndexFieldName]: { ...(data[archiveIndexFieldName] || {}) },
      [archiveBuiltAtFieldName]: String(data[archiveBuiltAtFieldName] || ''),
    });
  }

  function 读取订单数据() {
    if (!fs.existsSync(filePath)) return 创建空数据();
    const raw = 读取JSON文件(filePath, 创建空数据());
    const migration = 迁移订单数据(raw, { archiveIndexFieldName, archiveBuiltAtFieldName });
    if (!migration.migrated) return migration.data;
    const now = nowProvider();
    const backupPath = 复制迁移前文件(filePath, buildMigrationBackupPath, now);
    migration.data.workflowMigration = {
      ...(migration.data.workflowMigration || {}),
      migratedAt: now.toISOString(),
      backupPath,
      schemaVersion: 当前结构版本,
    };
    return 保存订单数据(migration.data);
  }

  function 记录转列表(data = 读取订单数据()) {
    const weight = {
      [工作流状态.待处理]: 0,
      [工作流状态.处理中]: 1,
      [工作流状态.发票已登记]: 2,
      [工作流状态.已处理]: 3,
    };
    return Object.values(data.orders || {}).sort((left, right) => {
      const statusDiff = weight[读取工作流状态(left)] - weight[读取工作流状态(right)];
      return statusDiff || String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
    });
  }

  function 统计订单记录(data = 读取订单数据()) {
    return 获取订单统计(记录转列表(data));
  }

  function 读取归档文件列表() {
    if (!archiveRoot || !fs.existsSync(archiveRoot)) return [];
    const pendingDirectories = [archiveRoot];
    const files = [];
    while (pendingDirectories.length) {
      const currentDirectory = pendingDirectories.pop();
      for (const entry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
        const entryPath = path.join(currentDirectory, entry.name);
        if (entry.isDirectory()) pendingDirectories.push(entryPath);
        else if (entry.isFile() && entry.name.endsWith('-handled.json')) files.push(entryPath);
      }
    }
    return files.sort();
  }

  function 导入归档索引到数据(data) {
    if (data[archiveBuiltAtFieldName]) return { importedCount: 0, archiveFileCount: 0, changed: false };
    const files = 读取归档文件列表();
    const archiveIndex = { ...(data[archiveIndexFieldName] || {}) };
    let importedCount = 0;
    for (const archiveFilePath of files) {
      const archive = 读取JSON文件(archiveFilePath, null);
      if (!archive?.orders || typeof archive.orders !== 'object' || Array.isArray(archive.orders)) {
        throw new Error(`导入已处理归档索引失败：${archiveFilePath} 缺少 orders 对象。`);
      }
      for (const [key, rawOrder] of Object.entries(archive.orders)) {
        const order = 规范化订单记录(key, rawOrder, { migrateLegacy: true });
        if (!archiveIndex[key]) importedCount += 1;
        archiveIndex[key] = {
          key,
          storeId: String(order.storeId || ''),
          storeName: String(order.storeName || ''),
          orderNumber: String(order.orderNumber || ''),
          handledAt: String(order.handledAt || ''),
          archivedAt: String(archive.archivedAt || ''),
          backupPath: archiveFilePath,
        };
        delete data.orders[key];
      }
    }
    data[archiveIndexFieldName] = archiveIndex;
    data[archiveBuiltAtFieldName] = nowProvider().toISOString();
    return { importedCount, archiveFileCount: files.length, changed: true };
  }

  function 导入已处理归档索引() {
    const data = 读取订单数据();
    const result = 导入归档索引到数据(data);
    if (result.changed) 保存订单数据(data);
    return result;
  }

  function 合并保留字段(existing, incoming) {
    const next = { ...existing, ...incoming };
    if (!existing) return next;
    for (const fieldName of protectedFields) {
      if (Object.prototype.hasOwnProperty.call(existing, fieldName)) next[fieldName] = existing[fieldName];
    }
    return next;
  }

  function 同步订单记录(incomingRecords = [], syncOptions = {}) {
    const data = 读取订单数据();
    if (importArchiveIndexBeforeSync) 导入归档索引到数据(data);
    const now = (syncOptions.now || nowProvider()).toISOString();
    const addedRecords = [];
    const updatedRecords = [];
    const skippedArchivedRecords = [];
    for (const incomingRecord of Array.isArray(incomingRecords) ? incomingRecords : []) {
      const key = 规范化订单键(incomingRecord?.key || incomingRecord?.orderKey, incomingRecord);
      const existing = data.orders[key] || null;
      const archived = data[archiveIndexFieldName]?.[key] || null;
      if (!existing && archived && syncOptions.allowArchivedRestore !== true) {
        data[archiveIndexFieldName][key] = {
          ...archived,
          lastSeenAfterArchiveAt: now,
          lastSeenSummary: String(incomingRecord?.summary || ''),
        };
        skippedArchivedRecords.push({ key, orderNumber: String(incomingRecord?.orderNumber || archived.orderNumber || '') });
        continue;
      }
      if (archived && syncOptions.allowArchivedRestore === true) delete data[archiveIndexFieldName][key];
      const merged = 合并保留字段(existing, incomingRecord);
      const workflowStatus = existing
        ? 读取工作流状态(existing)
        : (syncOptions.allowIncomingWorkflowStatus === true
          ? 从旧记录推断工作流状态(incomingRecord)
          : 工作流状态.待处理);
      const next = 规范化订单记录(key, {
        ...merged,
        key,
        workflowStatus,
        firstSeenAt: existing?.firstSeenAt || incomingRecord?.firstSeenAt || now,
        lastSeenAt: now,
        updatedAt: now,
      });
      data.orders[key] = next;
      if (existing) updatedRecords.push(next);
      else addedRecords.push(next);
    }
    const saved = 保存订单数据(data);
    return {
      addedRecords,
      updatedRecords,
      skippedArchivedRecords,
      records: 记录转列表(saved),
      stats: 统计订单记录(saved),
    };
  }

  function 更新订单记录(key, patchOrUpdater) {
    const normalizedKey = 规范化订单键(key);
    const data = 读取订单数据();
    const existing = data.orders[normalizedKey];
    if (!existing) throw new Error('更新订单失败：本地没有该订单，请先同步订单。');
    const patch = typeof patchOrUpdater === 'function' ? patchOrUpdater(existing) : patchOrUpdater;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('更新订单失败：更新内容必须是对象。');
    if (旧人工字段存在(patch)) throw new Error('更新订单失败：禁止写入旧人工状态字段，请只使用 workflowStatus。');
    const updated = 规范化订单记录(normalizedKey, {
      ...existing,
      ...patch,
      key: normalizedKey,
      workflowStatus: Object.prototype.hasOwnProperty.call(patch, 'workflowStatus')
        ? patch.workflowStatus
        : existing.workflowStatus,
      updatedAt: nowProvider().toISOString(),
    });
    data.orders[normalizedKey] = updated;
    保存订单数据(data);
    return updated;
  }

  function 转换订单状态(key, targetStatus) {
    return 更新订单记录(key, (existing) => 转换订单工作流状态(existing, targetStatus, nowProvider().toISOString()));
  }

  function 记录订单回传尝试(key, attempt = {}) {
    const status = String(attempt.status || '').trim();
    if (!回传尝试状态列表.includes(status)) throw new Error(`保存回传结果失败：回传状态无效 ${status || '空值'}。`);
    return 更新订单记录(key, (existing) => {
      const now = nowProvider().toISOString();
      let next = {
        ...existing,
        lastReturnAttempt: {
          status,
          message: String(attempt.message || ''),
          invoiceFilePath: String(attempt.invoiceFilePath || ''),
          screenshotPath: String(attempt.screenshotPath || ''),
          attemptedAt: String(attempt.attemptedAt || now),
        },
      };
      if (status === 'success' && 读取工作流状态(existing) !== 工作流状态.已处理) {
        next = 转换订单工作流状态(next, 工作流状态.已处理, now);
      }
      return next;
    });
  }

  function 归档已处理订单(archiveOptions = {}) {
    if (typeof buildArchivePath !== 'function') throw new Error('归档订单失败：缺少归档文件路径规则。');
    const data = 读取订单数据();
    导入归档索引到数据(data);
    const handledEntries = Object.entries(data.orders).filter(([, order]) => 读取工作流状态(order) === 工作流状态.已处理);
    if (!handledEntries.length) {
      保存订单数据(data);
      return { removedCount: 0, backupPath: '', records: 记录转列表(data), stats: 统计订单记录(data) };
    }
    const now = archiveOptions.now || nowProvider();
    const backupPath = 生成不冲突文件路径(path.resolve(buildArchivePath(filePath, now, 格式化时间批次(now))));
    写入JSON文件(backupPath, {
      version: 当前结构版本,
      archivedAt: now.toISOString(),
      sourceFilePath: filePath,
      removedCount: handledEntries.length,
      orders: Object.fromEntries(handledEntries),
    });
    const archiveIndex = { ...(data[archiveIndexFieldName] || {}) };
    for (const [key, order] of handledEntries) {
      archiveIndex[key] = {
        key,
        storeId: String(order.storeId || ''),
        storeName: String(order.storeName || ''),
        orderNumber: String(order.orderNumber || ''),
        handledAt: String(order.handledAt || ''),
        archivedAt: now.toISOString(),
        backupPath,
      };
      delete data.orders[key];
    }
    data[archiveIndexFieldName] = archiveIndex;
    const saved = 保存订单数据(data);
    return {
      removedCount: handledEntries.length,
      backupPath,
      records: 记录转列表(saved),
      stats: 统计订单记录(saved),
    };
  }

  return Object.freeze({
    filePath,
    archiveIndexFieldName,
    archiveBuiltAtFieldName,
    读取订单数据,
    保存订单数据,
    记录转列表,
    统计订单记录,
    同步订单记录,
    更新订单记录,
    转换订单状态,
    记录订单回传尝试,
    导入已处理归档索引,
    归档已处理订单,
  });
}

module.exports = {
  当前结构版本,
  默认归档索引字段名,
  默认归档索引构建时间字段名,
  人工保留字段列表,
  回传尝试状态列表,
  规范化订单记录,
  迁移订单数据,
  格式化时间批次,
  创建订单记录仓库,
};
