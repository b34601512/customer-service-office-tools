const 默认接口每页条数 = 10;
const 最小接口每页条数 = 10;
const 最大接口每页条数 = 50;

function 规范化接口每页条数(value) {
  // 解决：京东大页请求容易返回 501，所有分页请求必须先收敛到店铺配置里的稳定页大小。
  const numberValue = Number.parseInt(value, 10);
  if (!Number.isFinite(numberValue)) {
    return 默认接口每页条数;
  }
  if (numberValue < 最小接口每页条数 || numberValue > 最大接口每页条数) {
    throw new Error(`接口每页条数必须在 ${最小接口每页条数} 到 ${最大接口每页条数} 之间。`);
  }
  return numberValue;
}

module.exports = {
  默认接口每页条数,
  最小接口每页条数,
  最大接口每页条数,
  规范化接口每页条数,
};
