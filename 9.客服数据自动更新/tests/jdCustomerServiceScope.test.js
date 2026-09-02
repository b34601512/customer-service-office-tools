const assert = require("assert");
const {
  normalizeScope,
  assertJdCustomerServiceScope
} = require("../src/platforms/jd/jdCustomerServiceScope");

assert.deepStrictEqual(
  normalizeScope({ mode: "客服岗位", values: ["售前", "售前", ""] }),
  { mode: "客服岗位", values: ["售前"] }
);

assert.doesNotThrow(() =>
  assertJdCustomerServiceScope(
    { mode: "客服岗位", valuesText: "客服范围 客服岗位 售前" },
    { mode: "客服岗位", values: ["售前"] }
  )
);

assert.doesNotThrow(
  () =>
    assertJdCustomerServiceScope(
      { mode: "客服组", valuesText: "客服范围 客服组 [未购买]-售前咨询组" },
      { mode: "客服岗位", values: ["售前"] }
    ),
  "页面仅提供客服组时，售前岗位应允许映射到包含售前的客服组"
);

assert.throws(
  () =>
    assertJdCustomerServiceScope(
      { mode: "客服组", valuesText: "客服范围 客服组 售后组" },
      { mode: "客服岗位", values: ["售前"] }
    ),
  /客服筛选未命中/
);

assert.throws(
  () =>
    assertJdCustomerServiceScope(
      { mode: "客服岗位", valuesText: "客服范围 客服岗位 售后" },
      { mode: "客服岗位", values: ["售前"] }
    ),
  /客服筛选未命中/
);

assert.throws(() => normalizeScope({ mode: "客服岗位", values: [] }), /没有配置目标岗位/);
console.log("PASS 京东客服岗位筛选规范化和导出前校验");
