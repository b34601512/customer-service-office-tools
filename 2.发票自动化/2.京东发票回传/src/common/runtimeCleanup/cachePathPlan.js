const 店铺垃圾相对路径列表 = [
  ['Default', 'Cache'],
  ['Default', 'Code Cache'],
  ['Default', 'GPUCache'],
  ['Default', 'DawnGraphiteCache'],
  ['Default', 'DawnWebGPUCache'],
  ['Default', 'Shared Dictionary'],
  ['Default', 'Service Worker', 'CacheStorage'],
  ['Default', 'EdgeCoupons'],
  ['Default', 'Asset Store'],
  ['Default', 'EntityExtraction'],
  ['Default', 'Workspaces'],
  ['Default', 'Sessions'],
  ['Default', 'EdgeSessions'],
  ['Default', 'Session Storage'],
  ['GrShaderCache'],
  ['ShaderCache'],
  ['GraphiteDawnCache'],
  ['GPUCache'],
  ['BrowserMetrics'],
  ['BrowserMetrics-spare.pma'],
  ['CrashpadMetrics-active.pma'],
  ['SmartScreen'],
  ['Ad Blocking'],
  ['component_crx_cache'],
  ['extensions_crx_cache'],
  ['GPUPersistentCache'],
];

function 读取店铺垃圾相对路径列表() {
  // 解决：集中定义可清理垃圾目录，明确排除 Cookies、Local Storage 和 IndexedDB 登录态。
  return 店铺垃圾相对路径列表.map((路径片段列表) => 路径片段列表.slice());
}

module.exports = {
  店铺垃圾相对路径列表,
  读取店铺垃圾相对路径列表,
};
