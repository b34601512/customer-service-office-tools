// 该文件用于解决 Chrome 缓存从源头限制体积的问题。
const DEFAULT_DISK_CACHE_SIZE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MEDIA_CACHE_SIZE_BYTES = 16 * 1024 * 1024;

function normalizeChromeCacheSizeBytes(value, fallbackValue) {
  // 这个函数只负责把缓存上限归一成正整数，避免启动参数出现无效数字。
  const normalizedValue = Number(value);
  if (Number.isInteger(normalizedValue) && normalizedValue > 0) {
    return normalizedValue;
  }

  return fallbackValue;
}

function buildChromeCacheLimitArgs(options = {}) {
  // 这个函数只生成 Chrome 缓存上限参数，避免各启动入口各自硬编码。
  const diskCacheSizeBytes = normalizeChromeCacheSizeBytes(
    options.diskCacheSizeBytes,
    DEFAULT_DISK_CACHE_SIZE_BYTES
  );
  const mediaCacheSizeBytes = normalizeChromeCacheSizeBytes(
    options.mediaCacheSizeBytes,
    DEFAULT_MEDIA_CACHE_SIZE_BYTES
  );

  return [
    `--disk-cache-size=${diskCacheSizeBytes}`,
    `--media-cache-size=${mediaCacheSizeBytes}`
  ];
}

module.exports = {
  buildChromeCacheLimitArgs
};
