export function trumpFmPostToSource(post) {
  const platformId = normalizePlatformId(post);
  if (!platformId) throw new Error("trump.fm 动态缺少 platformId");
  if (post.platform !== "truth") throw new Error(`trump.fm 返回了非 Truth Social 平台：${post.platform}`);
  const text = String(post.content || "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const kind = post.isRepost ? "retweet" : post.replyToId ? "reply" : "original";
  return {
    id: `trump-fm-${platformId}`,
    externalId: platformId,
    type: "post",
    kind,
    weight: kind === "reply" ? 0.5 : 1,
    platform: "Truth Social",
    provider: "trump.fm",
    publishedAt: post.createdAt,
    title: makeTitle(text),
    text,
    publicMetrics: normalizeMetrics(post.externalMetrics),
    mediaUrls: Array.isArray(post.mediaUrls) ? post.mediaUrls : [],
    url: `https://trump.fm/post/${encodeURIComponent(String(post.id || `ts_${platformId}`))}`,
    originalUrl: `https://truthsocial.com/@realDonaldTrump/posts/${platformId}`,
  };
}

export function newestTrumpFmPostId(posts, fallback = null) {
  const ids = posts.map(normalizePlatformId).filter((id) => /^\d+$/.test(id));
  if (fallback && /^\d+$/.test(String(fallback))) ids.push(String(fallback));
  if (!ids.length) return fallback;
  return ids.reduce((highest, id) => BigInt(id) > BigInt(highest) ? id : highest);
}

export function shouldStopTrumpFmPagination(posts, { cutoff, sinceId } = {}) {
  const cutoffTime = new Date(cutoff).getTime();
  return posts.some((post) => {
    const platformId = normalizePlatformId(post);
    if (sinceId && platformId === String(sinceId)) return true;
    const publishedAt = new Date(post.createdAt).getTime();
    return Number.isFinite(cutoffTime) && Number.isFinite(publishedAt) && publishedAt < cutoffTime;
  });
}

export function buildTrumpFmPostsUrl(baseUrl, { limit = 100, cursor } = {}) {
  const url = new URL("/api/posts", `${String(baseUrl || "https://trump.fm").replace(/\/$/, "")}/`);
  url.searchParams.set("platform", "truth");
  url.searchParams.set("includeDeleted", "false");
  url.searchParams.set("limit", String(limit));
  if (cursor) url.searchParams.set("cursor", cursor);
  return url;
}

function normalizePlatformId(post) {
  const value = post?.platformId || String(post?.id || "").replace(/^ts_/, "");
  return String(value || "").trim();
}

function normalizeMetrics(metrics) {
  if (!metrics || typeof metrics !== "object") return null;
  return {
    likeCount: Number(metrics.likes) || 0,
    repostCount: Number(metrics.reposts) || 0,
    replyCount: Number(metrics.replies) || 0,
    viewCount: Number(metrics.views) || 0,
  };
}

function makeTitle(text) {
  const compact = text.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  if (!compact) return "Truth Social 公开动态";
  return compact.length > 34 ? `${compact.slice(0, 34)}…` : compact;
}
