function 规范化订单列表(orders) {
  // 这个函数解决不同平台传入订单字段不一致的问题，统一收敛成下载中心内部订单结构。
  const 已存在订单号 = new Set();
  return (Array.isArray(orders) ? orders : [])
    .map((item) => {
      const orderNumber = String(item?.orderNumber || item || '').trim();
      return {
        key: String(item?.key || orderNumber).trim(),
        platform: String(item?.platform || '').trim(),
        storeId: String(item?.storeId || '').trim(),
        storeName: String(item?.storeName || '').trim(),
        orderNumber,
      };
    })
    .filter((order) => {
      if (!order.orderNumber || 已存在订单号.has(order.orderNumber)) return false;
      已存在订单号.add(order.orderNumber);
      return true;
    });
}

function 获取批量订单列表(input = {}) {
  // 这个函数解决 HTTP 调用方有的传 orders、有的只传 orderNumbers 的兼容问题。
  if (Array.isArray(input)) return 规范化订单列表(input);
  if (Array.isArray(input.orders)) return 规范化订单列表(input.orders);
  return 规范化订单列表(input.orderNumbers || []);
}

module.exports = {
  规范化订单列表,
  获取批量订单列表,
};
