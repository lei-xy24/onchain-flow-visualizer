export function normalizeXHandle(value) {
  return String(value || "").trim().replace(/^@/, "").toLowerCase();
}

export function classifyXPost(post) {
  const references = Array.isArray(post.referenced_tweets) ? post.referenced_tweets : [];
  if (references.some((item) => item.type === "retweeted")) return "retweet";
  if (references.some((item) => item.type === "replied_to")) return "reply";
  if (references.some((item) => item.type === "quoted")) return "quote";
  return "original";
}

export function xPostToSource(post, username) {
  const kind = classifyXPost(post);
  const text = String(post.text || "").trim();
  return {
    id: `x-${post.id}`,
    externalId: String(post.id),
    type: "post",
    kind,
    weight: kind === "reply" ? 0.5 : 1,
    platform: "X",
    provider: "x-api",
    publishedAt: post.created_at,
    title: makeTitle(text),
    text,
    lang: post.lang || null,
    publicMetrics: post.public_metrics || null,
    url: `https://x.com/${username}/status/${post.id}`,
  };
}

export function mergeRecentPostSources(existingSources, freshSources, cutoff) {
  const cutoffTime = new Date(cutoff).getTime();
  const sourceMap = new Map();
  for (const source of [...existingSources, ...freshSources]) {
    if (source?.type !== "post" || classifySourceKind(source) === "retweet") continue;
    const time = new Date(source.publishedAt).getTime();
    if (!Number.isFinite(time) || time < cutoffTime) continue;
    sourceMap.set(source.id, { ...source, kind: classifySourceKind(source), weight: source.weight ?? (classifySourceKind(source) === "reply" ? 0.5 : 1) });
  }
  return [...sourceMap.values()].sort((left, right) => new Date(right.publishedAt) - new Date(left.publishedAt));
}

export function newestPostId(posts, fallback = null) {
  const ids = posts.map((post) => String(post.id || "")).filter((id) => /^\d+$/.test(id));
  if (fallback && /^\d+$/.test(String(fallback))) ids.push(String(fallback));
  if (!ids.length) return fallback;
  return ids.reduce((highest, id) => BigInt(id) > BigInt(highest) ? id : highest);
}

function classifySourceKind(source) {
  return ["original", "quote", "reply", "retweet"].includes(source.kind) ? source.kind : "original";
}

function makeTitle(text) {
  const compact = text.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  if (!compact) return "公开动态";
  return compact.length > 34 ? `${compact.slice(0, 34)}…` : compact;
}
