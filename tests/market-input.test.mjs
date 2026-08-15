import test from "node:test";
import assert from "node:assert/strict";
import { buildLiveMarketInput, marketRequests } from "../scripts/market-input-lib.mjs";
import { validateMarketInput } from "../scripts/social-radar-lib.mjs";

test("实时市场输入覆盖所有允许主题并生成指标、趋势和排名", () => {
  const responses = new Map();
  for (const request of marketRequests()) {
    responses.set(request.key, [
      { id: `${request.key}-a`, name: "Asset A", symbol: "aaa", market_cap: 2_000_000_000, total_volume: 100_000_000, market_cap_change_percentage_24h: 5 },
      { id: `${request.key}-b`, name: "Asset B", symbol: "bbb", market_cap: 1_000_000_000, total_volume: 50_000_000, market_cap_change_percentage_24h: -2 },
    ]);
  }
  const input = buildLiveMarketInput(responses, "2026-08-14T15:00:00.000Z");
  assert.equal(input.mode, "live-api");
  assert.deepEqual(Object.keys(input.topics).sort(), ["ai_crypto", "bitcoin", "chain_ecosystem", "defi", "layer2", "payments", "privacy", "stablecoin"]);
  assert.equal(input.topics.stablecoin.metrics.length, 3);
  assert.equal(input.topics.stablecoin.trend.points.length, 6);
  assert.equal(input.topics.stablecoin.ranking.items[0].name, "Asset A");
  assert.deepEqual(validateMarketInput(input), []);
});

test("缺少趋势点或包含无效排名时拒绝市场输入", () => {
  const invalid = { topics: Object.fromEntries([
    "stablecoin", "bitcoin", "ai_crypto", "payments", "layer2", "privacy", "chain_ecosystem", "defi",
  ].map((topicType) => [topicType, {
    category: "测试",
    accent: "#123456",
    metrics: [{ label: "指标", value: "$1B", change: "0%" }],
    trend: { label: "趋势", unit: "$B", points: [{ label: "现在", value: 1 }] },
    ranking: { label: "排名", items: [{ name: "样例", value: 0, display: "$0" }] },
  }])) };
  const errors = validateMarketInput(invalid);
  assert.ok(errors.some((error) => error.includes("trend")));
  assert.ok(errors.some((error) => error.includes("ranking.items")));
});
