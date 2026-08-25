const HOUR_MS = 36e5;

export const EVENT_ASSETS = Object.freeze([
  asset("bitcoin", "BTC", "比特币", "bitcoin", [/比特币/i, /\bbitcoin\b/i, /(?:^|[^a-z0-9])\$?btc(?:[^a-z0-9]|$)/i]),
  asset("ethereum", "ETH", "以太坊", "ethereum", [/以太坊/i, /\bethereum\b/i, /(?:^|[^a-z0-9])\$?eth(?:[^a-z0-9]|$)/i]),
  asset("binancecoin", "BNB", "BNB", "binancecoin", [/\bbnb\s*chain\b/i, /(?:^|[^a-z0-9])\$?bnb(?:[^a-z0-9]|$)/i]),
  asset("solana", "SOL", "Solana", "solana", [/\bsolana\b/i, /(?:^|[^a-z0-9])\$sol(?:[^a-z0-9]|$)/i]),
  asset("dogecoin", "DOGE", "Dogecoin", "dogecoin", [/\bdogecoin\b/i, /狗狗币/i, /(?:^|[^a-z0-9])\$?doge(?:[^a-z0-9]|$)/i]),
  asset("ripple", "XRP", "XRP", "ripple", [/(?:^|[^a-z0-9])\$?xrp(?:[^a-z0-9]|$)/i]),
  asset("cardano", "ADA", "Cardano", "cardano", [/\bcardano\b/i, /(?:^|[^a-z0-9])\$ada(?:[^a-z0-9]|$)/i]),
  asset("arbitrum", "ARB", "Arbitrum", "arbitrum", [/\barbitrum\b/i, /(?:^|[^a-z0-9])\$arb(?:[^a-z0-9]|$)/i]),
  asset("optimism", "OP", "Optimism", "optimism", [/\boptimism\b/i, /(?:^|[^a-z0-9])\$op(?:[^a-z0-9]|$)/i]),
  asset("usd-coin", "USDC", "USDC", "usd-coin", [/(?:^|[^a-z0-9])\$?usdc(?:[^a-z0-9]|$)/i], "peg"),
  asset("tether", "USDT", "USDT", "tether", [/(?:^|[^a-z0-9])\$?usdt(?:[^a-z0-9]|$)/i], "peg"),
  asset("official-trump", "TRUMP", "Official Trump", "official-trump", [/\$trump\b/i, /\btrump\s+(?:coin|token|memecoin)\b/i], "price"),
]);

function asset(id, symbol, name, coinGeckoId, patterns, reactionMode = "price") {
  return Object.freeze({ id, symbol, name, coinGeckoId, patterns, reactionMode });
}

export function extractAssetEvents(socialInput, { maxEventsPerAsset = 8 } = {}) {
  const counts = new Map();
  const events = [];
  for (const figure of socialInput?.figures || []) {
    for (const source of figure.sources || []) {
      if (source?.type !== "post" || source.kind === "retweet") continue;
      const eventAt = new Date(source.publishedAt);
      if (!Number.isFinite(eventAt.getTime())) continue;
      const text = `${source.title || ""}\n${source.text || ""}`;
      for (const registryAsset of EVENT_ASSETS) {
        if (!registryAsset.patterns.some((pattern) => pattern.test(text))) continue;
        const countKey = `${figure.id}:${registryAsset.id}`;
        if ((counts.get(countKey) || 0) >= maxEventsPerAsset) continue;
        counts.set(countKey, (counts.get(countKey) || 0) + 1);
        events.push({
          id: `${source.id}-${registryAsset.symbol.toLowerCase()}`,
          figureId: figure.id,
          sourceId: source.id,
          eventAt: eventAt.toISOString(),
          eventTitle: source.title || `${registryAsset.symbol} 相关动态`,
          platform: source.platform || "公开动态",
          url: source.url || null,
          asset: publicAsset(registryAsset),
          matchReason: `动态正文或标题直接提到 ${registryAsset.symbol}`,
        });
      }
    }
  }
  return events.sort((left, right) => new Date(right.eventAt) - new Date(left.eventAt));
}

export function buildEventMarketInput({
  socialInput,
  seriesByCoin = {},
  collectedAt = new Date().toISOString(),
  beforeHours = 24,
  afterHours = 72,
  maxEventsPerAsset = 8,
  mode = "live-api",
} = {}) {
  const events = extractAssetEvents(socialInput, { maxEventsPerAsset });
  const normalizedSeries = new Map(Object.entries(seriesByCoin).map(([coinId, series]) => [coinId, normalizeSeries(series)]));
  const btcSeries = normalizedSeries.get("bitcoin") || [];
  const reactions = events.map((event) => buildReaction(event, normalizedSeries.get(event.asset.coinGeckoId) || [], btcSeries, beforeHours, afterHours)).filter(Boolean);
  return {
    schemaVersion: 1,
    mode,
    collectedAt,
    window: { beforeHours, afterHours },
    eventCount: events.length,
    reactions,
    unavailableEvents: events.filter((event) => !reactions.some((reaction) => reaction.id === event.id)).map((event) => ({
      id: event.id,
      figureId: event.figureId,
      sourceId: event.sourceId,
      asset: event.asset,
      reason: "历史小时行情不足，未生成价格反应",
    })),
  };
}

function buildReaction(event, series, btcSeries, beforeHours, afterHours) {
  if (series.length < 2) return null;
  const eventMs = new Date(event.eventAt).getTime();
  const base = nearestPoint(series, eventMs, 2 * HOUR_MS);
  if (!base || !Number.isFinite(base.price) || base.price <= 0) return null;
  const start = eventMs - beforeHours * HOUR_MS;
  const end = eventMs + afterHours * HOUR_MS;
  const points = downsampleRelativeHourly(series.filter((point) => point.time >= start && point.time <= end), eventMs)
    .map((point) => ({
      time: new Date(point.time).toISOString(),
      hours: round((point.time - eventMs) / HOUR_MS, 1),
      price: significant(point.price),
      change: round(percentChange(point.price, base.price), 2),
      volume: Number.isFinite(point.volume) ? significant(point.volume) : null,
    }));
  if (points.length < 2) return null;

  const returnAt = (hours) => {
    const point = nearestPoint(series, eventMs + hours * HOUR_MS, 2 * HOUR_MS);
    return point ? round(percentChange(point.price, base.price), 2) : null;
  };
  const afterPoints = points.filter((point) => point.hours >= 0);
  const return24h = returnAt(24);
  const btcBase = event.asset.id === "bitcoin" ? null : nearestPoint(btcSeries, eventMs, 2 * HOUR_MS);
  const btc24 = event.asset.id === "bitcoin" ? null : nearestPoint(btcSeries, eventMs + 24 * HOUR_MS, 2 * HOUR_MS);
  const btcReturn24h = btcBase && btc24 ? percentChange(btc24.price, btcBase.price) : null;
  return {
    ...event,
    basePrice: significant(base.price),
    coverage: {
      start: points[0].time,
      end: points.at(-1).time,
      beforeHours: Math.abs(Math.min(0, points[0].hours)),
      afterHours: Math.max(0, points.at(-1).hours),
    },
    metrics: {
      return1h: returnAt(1),
      return6h: returnAt(6),
      return24h,
      return72h: returnAt(72),
      maxRise: afterPoints.length ? round(Math.max(...afterPoints.map((point) => point.change)), 2) : null,
      maxDrawdown: afterPoints.length ? round(Math.min(...afterPoints.map((point) => point.change)), 2) : null,
      volumeRatio24h: volumeRatio(series, eventMs),
      btcReturn24h: Number.isFinite(btcReturn24h) ? round(btcReturn24h, 2) : null,
      btcAdjusted24h: Number.isFinite(return24h) && Number.isFinite(btcReturn24h) ? round(return24h - btcReturn24h, 2) : null,
    },
    points,
  };
}

export function validateEventMarketInput(input, socialInput) {
  const errors = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return ["事件行情输入必须是对象"];
  if (!Array.isArray(input.reactions)) return ["事件行情输入缺少 reactions 数组"];
  const sources = new Set((socialInput?.figures || []).flatMap((figure) => (figure.sources || []).map((source) => `${figure.id}:${source.id}`)));
  const ids = new Set();
  for (const reaction of input.reactions) {
    if (!reaction?.id || ids.has(reaction.id)) errors.push(`事件行情 id 无效或重复：${reaction?.id || "（空）"}`);
    ids.add(reaction?.id);
    if (!sources.has(`${reaction?.figureId}:${reaction?.sourceId}`)) errors.push(`${reaction?.id || "事件"} 引用了不存在的公开动态`);
    if (!reaction?.asset?.id || !reaction?.asset?.symbol || !reaction?.asset?.coinGeckoId) errors.push(`${reaction?.id || "事件"} 资产结构无效`);
    if (!Number.isFinite(new Date(reaction?.eventAt).getTime())) errors.push(`${reaction?.id || "事件"} 时间无效`);
    if (!Array.isArray(reaction?.points) || reaction.points.length < 2) errors.push(`${reaction?.id || "事件"} 历史行情点不足`);
    if ((reaction?.points || []).some((point) => !Number.isFinite(Number(point.hours)) || !Number.isFinite(Number(point.change)))) errors.push(`${reaction?.id || "事件"} 行情点无效`);
  }
  return errors;
}

export function queryRangeForEvents(events, { beforeHours = 24, afterHours = 72, now = Date.now() } = {}) {
  if (!events.length) return null;
  const timestamps = events.map((event) => new Date(event.eventAt).getTime()).filter(Number.isFinite);
  if (!timestamps.length) return null;
  return {
    from: Math.floor((Math.min(...timestamps) - beforeHours * HOUR_MS) / 1000),
    to: Math.ceil(Math.min(now, Math.max(...timestamps) + afterHours * HOUR_MS) / 1000),
  };
}

function normalizeSeries(series) {
  const prices = Array.isArray(series?.prices) ? series.prices : [];
  const volumes = Array.isArray(series?.total_volumes) ? series.total_volumes : [];
  return prices
    .map(([time, price]) => {
      const volume = nearestTuple(volumes, Number(time), 2 * HOUR_MS)?.[1];
      return { time: Number(time), price: Number(price), volume: Number(volume) };
    })
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.price) && point.price > 0)
    .sort((left, right) => left.time - right.time);
}

function nearestPoint(points, target, tolerance) {
  let selected = null;
  let distance = Infinity;
  for (const point of points) {
    const currentDistance = Math.abs(point.time - target);
    if (currentDistance < distance) { selected = point; distance = currentDistance; }
  }
  return distance <= tolerance ? selected : null;
}

function downsampleRelativeHourly(points, eventMs) {
  const buckets = new Map();
  for (const point of points) {
    const hour = Math.round((point.time - eventMs) / HOUR_MS);
    const distance = Math.abs(point.time - (eventMs + hour * HOUR_MS));
    if (!buckets.has(hour) || distance < buckets.get(hour).distance) buckets.set(hour, { point, distance });
  }
  return [...buckets.entries()].sort(([left], [right]) => left - right).map(([, value]) => value.point);
}

function nearestTuple(tuples, target, tolerance) {
  let selected = null;
  let distance = Infinity;
  for (const tuple of tuples) {
    const currentDistance = Math.abs(Number(tuple?.[0]) - target);
    if (currentDistance < distance) { selected = tuple; distance = currentDistance; }
  }
  return distance <= tolerance ? selected : null;
}

function volumeRatio(series, eventMs) {
  const before = series.filter((point) => point.time >= eventMs - 24 * HOUR_MS && point.time < eventMs && Number.isFinite(point.volume));
  const after = series.filter((point) => point.time >= eventMs && point.time <= eventMs + 24 * HOUR_MS && Number.isFinite(point.volume));
  if (!before.length || !after.length) return null;
  const beforeAverage = before.reduce((sum, point) => sum + point.volume, 0) / before.length;
  const afterAverage = after.reduce((sum, point) => sum + point.volume, 0) / after.length;
  return beforeAverage > 0 ? round(afterAverage / beforeAverage, 2) : null;
}

function percentChange(value, base) { return ((value - base) / base) * 100; }
function round(value, digits) { return Number(Number(value).toFixed(digits)); }
function significant(value) { return Number(Number(value).toPrecision(10)); }
function publicAsset(value) { return { id: value.id, symbol: value.symbol, name: value.name, coinGeckoId: value.coinGeckoId, reactionMode: value.reactionMode }; }
