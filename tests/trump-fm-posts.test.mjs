import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTrumpFmPostsUrl,
  newestTrumpFmPostId,
  shouldStopTrumpFmPagination,
  trumpFmPostToSource,
} from "../scripts/trump-fm-posts-lib.mjs";

test("trump.fm Truth 动态转换为统一公开动态格式", () => {
  const source = trumpFmPostToSource({
    id: "ts_117097120864035725",
    platform: "truth",
    platformId: "117097120864035725",
    content: "A public post about stablecoin payments.",
    createdAt: "2026-08-15T02:17:47.090Z",
    isRepost: false,
    replyToId: null,
    mediaUrls: ["https://example.com/image.png"],
    externalMetrics: { likes: 12, reposts: 3, replies: 2, views: null },
  });
  assert.equal(source.id, "trump-fm-117097120864035725");
  assert.equal(source.platform, "Truth Social");
  assert.equal(source.provider, "trump.fm");
  assert.equal(source.kind, "original");
  assert.equal(source.publicMetrics.likeCount, 12);
  assert.equal(source.url, "https://trump.fm/post/ts_117097120864035725");
});

test("trump.fm 转发会被标记，回复会降权", () => {
  const repost = trumpFmPostToSource({ id: "ts_20", platform: "truth", platformId: "20", content: "repost", createdAt: "2026-08-15T02:00:00Z", isRepost: true });
  const reply = trumpFmPostToSource({ id: "ts_21", platform: "truth", platformId: "21", content: "reply", createdAt: "2026-08-15T03:00:00Z", isRepost: false, replyToId: "19" });
  assert.equal(repost.kind, "retweet");
  assert.equal(reply.kind, "reply");
  assert.equal(reply.weight, 0.5);
  assert.equal(trumpFmPostToSource({ id: "ts_22", platform: "truth", platformId: "22", content: "", createdAt: "2026-08-15T04:00:00Z", isRepost: false }), null);
});

test("trump.fm 分页使用 Truth 过滤并在游标或时间窗口处停止", () => {
  const url = buildTrumpFmPostsUrl("https://trump.fm/", { limit: 100, cursor: "2026-08-15T02:00:00Z" });
  assert.equal(url.origin, "https://trump.fm");
  assert.equal(url.pathname, "/api/posts");
  assert.equal(url.searchParams.get("platform"), "truth");
  assert.equal(url.searchParams.get("includeDeleted"), "false");
  assert.equal(url.searchParams.get("cursor"), "2026-08-15T02:00:00Z");
  assert.equal(shouldStopTrumpFmPagination([
    { platformId: "30", createdAt: "2026-08-15T02:00:00Z" },
    { platformId: "20", createdAt: "2026-08-10T02:00:00Z" },
  ], { cutoff: "2026-08-12T00:00:00Z", sinceId: "10" }), true);
  assert.equal(newestTrumpFmPostId([{ platformId: "9" }, { platformId: "101" }], "80"), "101");
});
