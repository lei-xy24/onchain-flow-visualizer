#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEventMarketInput, extractAssetEvents, queryRangeForEvents, validateEventMarketInput } from "./event-market-lib.mjs";
import { readJson, requireHttpsBaseUrl, writeJsonAtomic } from "./social-radar-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = await readJson(path.join(root, "social-radar.config.json"));
const socialFile = resolveFile(process.env.SOCIAL_INPUT_FILE || config.sourceFile);
const candidateFile = resolveFile(process.env.EVENT_CANDIDATE_FILE || config.eventCandidateFile);
const outputFile = resolveFile(process.env.EVENT_MARKET_INPUT_FILE || config.eventMarketFile);
const [socialInput, eventCandidates] = await Promise.all([readJson(socialFile), readJson(candidateFile)]);
const beforeHours = Number(config.eventWindowBeforeHours || 24);
const afterHours = Number(config.eventWindowAfterHours || 72);
const baselineHours = Number(config.eventBaselineHours || 168);
const events = extractAssetEvents(socialInput, { eventCandidates, maxEventsPerAsset: Number(config.maxEventsPerAsset || 8) });
const range = queryRangeForEvents(events, { beforeHours, afterHours, baselineHours });
const coinIds = [...new Set(events.map((event) => event.asset.coinGeckoId))];
if (coinIds.some((id) => id !== "bitcoin") && !coinIds.includes("bitcoin")) coinIds.push("bitcoin");

const seriesByCoin = {};
if (range) {
  for (const [index, coinId] of coinIds.entries()) {
    try {
      seriesByCoin[coinId] = await fetchCoinHistory(coinId, range);
      console.log(`已读取 ${coinId} 的历史小时行情`);
    } catch (error) {
      console.warn(`跳过 ${coinId}：${error.message}`);
    }
    if (index < coinIds.length - 1) await wait(Number(process.env.COINGECKO_REQUEST_INTERVAL_MS || (process.env.COINGECKO_API_KEY ? 250 : 7000)));
  }
}

const result = buildEventMarketInput({
  socialInput,
  eventCandidates,
  seriesByCoin,
  collectedAt: new Date().toISOString(),
  beforeHours,
  afterHours,
  maxEventsPerAsset: Number(config.maxEventsPerAsset || 8),
  baselineHours,
  mode: Object.keys(seriesByCoin).length ? "live-api" : "no-verified-event-data",
});
const errors = validateEventMarketInput(result, socialInput);
if (errors.length) throw new Error(`事件行情输入校验失败：${errors.join("；")}`);
await writeJsonAtomic(outputFile, result);
const passed = result.reactions.filter((reaction) => reaction.significance?.passed).length;
console.log(`事件行情已写入 ${path.relative(root, outputFile)}：${eventCandidates.events.length} 个事件候选、${events.length} 组预选资产，${passed} 组通过异常波动验证`);

async function fetchCoinHistory(coinId, range) {
  const baseUrl = requireHttpsBaseUrl(process.env.COINGECKO_BASE_URL || "https://api.coingecko.com/api/v3", "CoinGecko API 地址");
  const url = new URL(`${baseUrl}/coins/${encodeURIComponent(coinId)}/market_chart/range`);
  url.searchParams.set("vs_currency", "usd");
  url.searchParams.set("from", String(range.from));
  url.searchParams.set("to", String(range.to));
  const headers = { Accept: "application/json" };
  if (process.env.COINGECKO_API_KEY) headers["x-cg-demo-api-key"] = process.env.COINGECKO_API_KEY;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(45_000) });
    if (response.ok) return response.json();
    const detail = (await response.text()).slice(0, 240);
    lastError = new Error(`CoinGecko API ${response.status}：${detail || "请求失败"}`);
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) break;
    await wait(attempt * 1500);
  }
  throw lastError;
}

function resolveFile(value) { return path.isAbsolute(value) ? value : path.join(root, value); }
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
