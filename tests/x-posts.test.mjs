import test from "node:test";
import assert from "node:assert/strict";
import { classifyXPost, mergeRecentPostSources, newestPostId, normalizeXHandle, xPostToSource } from "../scripts/x-posts-lib.mjs";

test("X 用户名标准化并识别动态类型", () => {
  assert.equal(normalizeXHandle(" @ElonMusk "), "elonmusk");
  assert.equal(classifyXPost({ referenced_tweets: [{ type: "quoted" }] }), "quote");
  assert.equal(classifyXPost({ referenced_tweets: [{ type: "replied_to" }] }), "reply");
  assert.equal(classifyXPost({ referenced_tweets: [{ type: "retweeted" }] }), "retweet");
});

test("回复降权、引用保持完整权重", () => {
  const reply = xPostToSource({ id: "20", text: "reply", created_at: "2026-08-13T10:00:00Z", referenced_tweets: [{ type: "replied_to" }] }, "tester");
  const quote = xPostToSource({ id: "21", text: "quote", created_at: "2026-08-13T11:00:00Z", referenced_tweets: [{ type: "quoted" }] }, "tester");
  assert.equal(reply.weight, 0.5);
  assert.equal(quote.weight, 1);
  assert.equal(quote.provider, "x-api");
});

test("滚动窗口去重、排除转发和过期动态", () => {
  const result = mergeRecentPostSources([
    { id: "x-1", type: "post", publishedAt: "2026-08-01T00:00:00Z" },
    { id: "x-2", type: "post", kind: "retweet", publishedAt: "2026-08-13T00:00:00Z" },
    { id: "x-3", type: "post", kind: "original", publishedAt: "2026-08-13T00:00:00Z" },
  ], [
    { id: "x-3", type: "post", kind: "quote", publishedAt: "2026-08-13T01:00:00Z" },
    { id: "x-4", type: "post", kind: "reply", publishedAt: "2026-08-13T02:00:00Z" },
  ], "2026-08-06T00:00:00Z");
  assert.deepEqual(result.map((item) => item.id), ["x-4", "x-3"]);
  assert.equal(result[0].weight, 0.5);
});

test("since_id 使用最大的数字 id", () => {
  assert.equal(newestPostId([{ id: "9" }, { id: "101" }, { id: "22" }], "80"), "101");
});
