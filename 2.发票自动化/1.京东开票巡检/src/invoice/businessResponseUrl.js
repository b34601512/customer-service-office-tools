function 是开票业务响应地址(url) {
  // 解决：采集层先判断响应是否属于开票治理业务，避免解析所有无关 JSON。
  return /invoice|createInvoice|governance|serviceAnalysis/i.test(String(url || ''));
}

module.exports = {
  是开票业务响应地址,
};
