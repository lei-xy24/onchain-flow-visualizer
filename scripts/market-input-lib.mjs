const TOPIC_DEFINITIONS = Object.freeze({
  stablecoin: { apiCategory: "stablecoins", category: "支付基础设施", accent: "#42d6c7", label: "稳定币市场规模" },
  bitcoin: { ids: "bitcoin", category: "数字资产", accent: "#f0b45a", label: "比特币市场规模" },
  ai_crypto: { apiCategory: "artificial-intelligence", category: "技术叙事", accent: "#9b87e8", label: "AI × Crypto 市场规模" },
  payments: { apiCategory: "stablecoins", category: "支付技术", accent: "#58bde8", label: "数字支付资产规模" },
  layer2: { apiCategory: "layer-2", category: "区块链基础设施", accent: "#7e9eea", label: "Layer 2 市场规模" },
  privacy: { apiCategory: "privacy-coins", category: "密码学应用", accent: "#b487e8", label: "隐私资产市场规模" },
  chain_ecosystem: { apiCategory: "smart-contract-platform", category: "公链生态", accent: "#e4b943", label: "公链资产市场规模" },
  defi: { apiCategory: "decentralized-finance-defi", category: "金融协议", accent: "#55d69e", label: "DeFi 市场规模" },
});

export function marketRequests() {
  const unique = new Map();
  for (const definition of Object.values(TOPIC_DEFINITIONS)) {
    const key = definition.ids ? `ids:${definition.ids}` : `category:${definition.apiCategory}`;
    unique.set(key, { key, ...definition });
  }
  return [...unique.values()];
}

export function buildLiveMarketInput(responses, collectedAt = new Date().toISOString()) {
  const topics = {};
  for (const [topicType, definition] of Object.entries(TOPIC_DEFINITIONS)) {
    const key = definition.ids ? `ids:${definition.ids}` : `category:${definition.apiCategory}`;
    const rows = Array.isArray(responses.get(key)) ? responses.get(key).filter(validCoinRow) : [];
    if (!rows.length) throw new Error(`市场分类 ${key} 没有返回有效资产`);
    topics[topicType] = buildTopic(definition, rows);
  }
  return {
    schemaVersion: 1,
    collectedAt,
    mode: "live-api",
    provider: "CoinGecko Public API",
    methodology: "市值、成交量、价格与排名来自定时市场快照；趋势为依据当前市值与 24 小时变化率推导的近 24 小时等距估算。",
    topics,
  };
}

function buildTopic(definition, rawRows) {
  const rows = [...rawRows].sort((left, right) => number(right.market_cap) - number(left.market_cap)).slice(0, 25);
  const totalMarketCap = rows.reduce((sum, item) => sum + number(item.market_cap), 0);
  const totalVolume = rows.reduce((sum, item) => sum + number(item.total_volume), 0);
  const weightedChange = totalMarketCap > 0
    ? rows.reduce((sum, item) => sum + number(item.market_cap) * number(item.market_cap_change_percentage_24h), 0) / totalMarketCap
    : 0;
  const leader = rows[0];
  const trendValues = estimatedTrend(totalMarketCap, weightedChange, 6);
  return {
    category: definition.category,
    accent: definition.accent,
    source: "CoinGecko Public API",
    metrics: [
      { label: definition.label, value: money(totalMarketCap), change: signedPercent(weightedChange, "24h") },
      { label: "24 小时成交量", value: money(totalVolume), change: `${rows.length} 个样本资产` },
      { label: "最大资产", value: leader.name, change: `${String(leader.symbol || "").toUpperCase()} · ${money(number(leader.market_cap))}` },
    ],
    trend: {
      label: `${definition.label}近 24 小时估算`,
      unit: "$B",
      points: trendValues.map((value, index) => ({ label: index === trendValues.length - 1 ? "现在" : `-${(trendValues.length - 1 - index) * 4}h`, value: round(value / 1e9, 3) })),
    },
    ranking: {
      label: "按实时市值排名",
      items: rows.slice(0, 5).map((item) => ({ name: item.name, value: Math.max(0.000001, number(item.market_cap)), display: money(number(item.market_cap)) })),
    },
  };
}

function estimatedTrend(current, changePercent, count) {
  const change = Math.max(-90, Math.min(500, number(changePercent))) / 100;
  const start = current / Math.max(0.1, 1 + change);
  return Array.from({ length: count }, (_, index) => start + (current - start) * (index / (count - 1)));
}

function validCoinRow(item) {
  return item && typeof item.name === "string" && number(item.market_cap) > 0;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  const absolute = Math.abs(value);
  if (absolute >= 1e12) return `$${round(value / 1e12, 2)}T`;
  if (absolute >= 1e9) return `$${round(value / 1e9, 2)}B`;
  if (absolute >= 1e6) return `$${round(value / 1e6, 2)}M`;
  if (absolute >= 1e3) return `$${round(value / 1e3, 2)}K`;
  return `$${round(value, 2)}`;
}

function signedPercent(value, period) {
  const normalized = round(number(value), 2);
  return `${normalized > 0 ? "+" : ""}${normalized}% / ${period}`;
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
