import assert from "node:assert/strict";
import test from "node:test";

import {
  localGreeting,
  personalizedLocalGreeting,
} from "../lib/local-greeting.ts";

test("the greeting follows the viewer-local hour across day periods", () => {
  assert.equal(localGreeting("ko", 7), "좋은 아침이에요");
  assert.equal(localGreeting("ko", 14), "좋은 오후예요");
  assert.equal(localGreeting("ko", 20), "좋은 저녁이에요");
  assert.equal(localGreeting("ko", 1), "편안한 밤이에요");
});

test("server rendering uses a neutral greeting and personalization keeps locale honorifics", () => {
  assert.equal(localGreeting("en", null), "Hello");
  assert.equal(personalizedLocalGreeting("ko", 9, "보라"), "좋은 아침이에요, 보라님");
  assert.equal(personalizedLocalGreeting("ja", 19, "ボラ"), "こんばんは、ボラさん");
  assert.equal(personalizedLocalGreeting("zh", 15, "宝拉"), "下午好，宝拉");
});

test("invalid hours fail closed to the neutral greeting", () => {
  assert.equal(localGreeting("ko", -1), "안녕하세요");
  assert.equal(localGreeting("en", 24), "Hello");
  assert.equal(localGreeting("ja", Number.NaN), "こんにちは");
});
