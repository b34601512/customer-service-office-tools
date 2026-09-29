const test = require("node:test");
const assert = require("node:assert/strict");
const { buildRecord, extractText, extractNote, extractMedia, mixedItems, toLocalTime } = require("../src/inbox");

test("文本消息：拿到正文与来源、群聊带 chatid", () => {
  const record = buildRecord({
    headers: { req_id: "req-1" },
    body: {
      msgid: "m-1",
      chattype: "group",
      chatid: "chat-x",
      from: { userid: "user-x" },
      create_time: 1759000000,
      msgtype: "text",
      text: { content: "帮我登记发票 订单 123 店铺 天猫" }
    }
  });
  assert.equal(record.text, "帮我登记发票 订单 123 店铺 天猫");
  assert.equal(record.chattype, "group");
  assert.equal(record.chatid, "chat-x");
  assert.equal(record.fromUserId, "user-x");
  assert.equal(record.msgid, "m-1");
  assert.equal(record.msgtype, "text");
  assert.match(record.at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test("单聊消息：没有 chatid 时仍能记录下来", () => {
  const record = buildRecord({
    body: { msgid: "m-2", chattype: "single", from: { userid: "user-y" }, msgtype: "text", text: { content: "你好" } }
  });
  assert.equal(record.chatid, "");
  assert.equal(record.fromUserId, "user-y");
  assert.equal(record.text, "你好");
});

test("语音消息：有转写文本就用转写，没有就标备注", () => {
  const withText = buildRecord({ body: { msgtype: "voice", chattype: "single", from: { userid: "u" }, voice: { content: "转写内容" } } });
  assert.equal(withText.text, "转写内容");
  assert.equal(withText.note, "");
  const withoutText = buildRecord({ body: { msgtype: "voice", chattype: "single", from: { userid: "u" }, voice: {} } });
  assert.equal(withoutText.text, "");
  assert.match(withoutText.note, /语音/);
});

test("图片/文件/引用：只记备注不下载", () => {
  const image = buildRecord({ body: { msgtype: "image", chattype: "single", from: { userid: "u" }, image: { url: "https://x", aeskey: "k" } } });
  assert.match(image.note, /图片/);
  const file = buildRecord({ body: { msgtype: "file", chattype: "single", from: { userid: "u" }, file: { name: "发票.pdf" } } });
  assert.equal(file.note, "文件：发票.pdf");
  const quote = buildRecord({ body: { msgtype: "text", chattype: "single", from: { userid: "u" }, text: { content: "好的" }, quote: { text: { content: "原话" } } } });
  assert.equal(quote.note, "含引用消息");
});

test("图文混排：文本与图片标记拼接", () => {
  const mixed = buildRecord({
    body: {
      msgtype: "mixed",
      chattype: "group",
      from: { userid: "u" },
      mixed: { items: [{ text: { content: "看这个" } }, { image: { url: "x" } }] }
    }
  });
  assert.equal(mixed.text, "看这个 [图片]");
});

test("图文混排（线上字段 msg_item）：文本不丢、图片能另存", () => {
  // 2026-09-29 实例：企微 mixed 消息用的是 msg_item，旧代码只认 items → 正文和图片全丢
  const record = buildRecord({
    body: {
      msgid: "m1",
      msgtype: "mixed",
      chattype: "single",
      from: { userid: "u" },
      mixed: {
        msg_item: [
          { msgtype: "text", text: { content: "发现一个问题，9L流量可调不等于9升都是高浓度" } },
          { msgtype: "image", image: { url: "https://img/x", aeskey: "k" } }
        ]
      }
    }
  });
  assert.match(record.text, /9L流量可调/);
  assert.match(record.text, /\[图片\]/);
  assert.match(record.note, /图文混排/);
  assert.deepEqual(record.media, { kind: "image", url: "https://img/x", aeskey: "k", name: "" });
});

test("mixedItems：兼容 items / msg_item，异常输入给空数组", () => {
  assert.equal(mixedItems({ mixed: { msg_item: [1] } }).length, 1);
  assert.equal(mixedItems({ mixed: { items: [1, 2] } }).length, 2);
  assert.deepEqual(mixedItems({}), []);
  assert.deepEqual(mixedItems(null), []);
});

test("时间处理：秒级时间戳转本地时间；异常输入兜底", () => {
  assert.match(toLocalTime(1759000000), /^\d{4}-\d{2}-\d{2} /);
  assert.match(toLocalTime(1759000000000), /^\d{4}-\d{2}-\d{2} /);
  assert.match(toLocalTime(undefined), /^\d{4}-\d{2}-\d{2}T/); // ISO 兜底
  assert.match(toLocalTime("bad"), /^\d{4}-\d{2}-\d{2}T/);
});

test("空帧不崩：字段全部兜底", () => {
  const record = buildRecord({});
  assert.equal(record.text, "");
  assert.equal(record.note, "");
  assert.equal(record.msgtype, "unknown");
  assert.equal(record.msgid, "");
});

test("extractText / extractNote 直接调用也不抛错", () => {
  assert.equal(extractText(null), "");
  assert.equal(extractNote(undefined), "");
});

test("媒体消息：提取 url/aeskey，并落盘文件名可预测", () => {
  const { extractMedia, mediaFileName } = require("../src/inbox");
  const img = extractMedia({ image: { url: "https://x/a", aeskey: "k1" } });
  assert.deepEqual(img, { kind: "image", url: "https://x/a", aeskey: "k1", name: "" });
  assert.equal(extractMedia({ text: { content: "纯文本" } }), null);
  const record = buildRecord({
    body: { msgid: "m-9", chattype: "single", msgtype: "image", from: { userid: "u" }, image: { url: "https://x/a", aeskey: "k1" } }
  });
  assert.equal(record.media.url, "https://x/a");
  assert.equal(mediaFileName("m-9", record.media), "m-9.jpg");
  assert.equal(mediaFileName("m-9", { kind: "file", name: "发票.pdf" }), "发票.pdf");
  assert.equal(mediaFileName("m-9", { kind: "file", name: "../etc/passwd" }), "passwd-m-9.bin");
});
