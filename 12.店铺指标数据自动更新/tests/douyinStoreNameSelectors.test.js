const test = require("node:test");
const assert = require("node:assert/strict");
const { readDouyinStoreName } = require("../src/platforms/douyin/douyinStoreIdentity");

// 造一个「按选择器返回不同节点」的假 shopHeader。
function makeHeader({ bySelector }) {
  return {
    locator(selector) {
      const nodes = bySelector[selector] || [];
      return {
        async count() {
          return nodes.length;
        },
        nth(index) {
          return nodes[index];
        }
      };
    }
  };
}
function node(text, visible = true) {
  return {
    async isVisible() {
      return visible;
    },
    async innerText() {
      return text;
    }
  };
}

test("抖音改版：旧版 data-bytereplay-mask 节点仍在时照旧读取", async () => {
  const header = makeHeader({
    bySelector: { ':scope [data-bytereplay-mask="true"]': [node("德达医疗康养器械旗舰店")] }
  });
  assert.equal(await readDouyinStoreName(header), "德达医疗康养器械旗舰店");
});

test("抖音改版：店名节点嵌在 headerShopName 里面（非直接子节点）也能读取", async () => {
  const header = makeHeader({
    bySelector: {
      ':scope [data-bytereplay-mask="true"]': [node("德达医疗康养器械旗舰店")]
    }
  });
  assert.equal(await readDouyinStoreName(header), "德达医疗康养器械旗舰店");
});

test("抖音改版：只有旧版直接子节点时仍能读取（向后兼容）", async () => {
  const header = makeHeader({
    bySelector: {
      ':scope > [data-bytereplay-mask="true"]': [node("德达医疗康养器械旗舰店")]
    }
  });
  assert.equal(await readDouyinStoreName(header), "德达医疗康养器械旗舰店");
});

test("抖音改版：两种选择器都读不到时给出可定位的报错", async () => {
  const header = makeHeader({ bySelector: {} });
  await assert.rejects(() => readDouyinStoreName(header), /顶部未识别到唯一的可见店名节点/);
});
