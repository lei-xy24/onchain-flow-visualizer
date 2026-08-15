#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, requireHttpsBaseUrl, requireHttpsUrl, validateMarketInput, writeJsonAtomic } from "./social-radar-lib.mjs";
import { buildLiveMarketInput, marketRequests } from "./market-input-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = await readJson(path.join(root, "social-radar.config.json"));
const url = process.env.MARKET_INPUT_URL;
const payload = url ? await readCustomMarketInput(requireHttpsUrl(url, "自定义市场接口地址")) : await readCoinGeckoMarketInput();
const marketErrors = validateMarketInput(payload);
if (marketErrors.length) throw new Error(`主题市场数据结构校验失败：${marketErrors.join("；")}`);
const configuredDestination = process.env.MARKET_INPUT_FILE || config.marketFile;
const destination = path.isAbsolute(configuredDestination) ? configuredDestination : path.join(root, configuredDestination);
await writeJsonAtomic(destination, payload);
console.log(`主题市场数据已更新：${path.relative(root, destination)}`);

async function readCustomMarketInput(endpoint) {
  const headers = { Accept: "application/json" };
  if (process.env.MARKET_INPUT_BEARER_TOKEN) headers.Authorization = `Bearer ${process.env.MARKET_INPUT_BEARER_TOKEN}`;
  const response = await fetch(endpoint, { headers, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`主题市场数据读取失败：HTTP ${response.status}`);
  return response.json();
}

async function readCoinGeckoMarketInput() {
  const baseUrl = requireHttpsBaseUrl(
    process.env.COINGECKO_BASE_URL || "https://api.coingecko.com/api/v3",
    "CoinGecko API 地址",
  );
  const requestIntervalMs = Math.max(2_000, Number.parseInt(process.env.COINGECKO_REQUEST_INTERVAL_MS || "7000", 10) || 7_000);
  const responses = new Map();
  let previousRequestAt = 0;
  for (const request of marketRequests()) {
    const waitBeforeRequest = Math.max(0, requestIntervalMs - (Date.now() - previousRequestAt));
    if (waitBeforeRequest) await new Promise((resolve) => setTimeout(resolve, waitBeforeRequest));
    const endpoint = new URL(`${baseUrl}/coins/markets`);
    endpoint.searchParams.set("vs_currency", "usd");
    endpoint.searchParams.set("order", "market_cap_desc");
    endpoint.searchParams.set("per_page", "25");
    endpoint.searchParams.set("page", "1");
    endpoint.searchParams.set("sparkline", "false");
    endpoint.searchParams.set("price_change_percentage", "24h");
    if (request.ids) endpoint.searchParams.set("ids", request.ids);
    else endpoint.searchParams.set("category", request.apiCategory);
    const headers = { Accept: "application/json", "User-Agent": "onchain-radar/1.0" };
    if (process.env.COINGECKO_API_KEY) headers["x-cg-demo-api-key"] = process.env.COINGECKO_API_KEY;
    const payload = await fetchCoinGecko(endpoint, headers, request.key);
    previousRequestAt = Date.now();
    responses.set(request.key, payload);
  }
  return buildLiveMarketInput(responses);
}

async function fetchCoinGecko(endpoint, headers, key) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(endpoint, { headers, signal: AbortSignal.timeout(30_000) });
    if (response.ok) return response.json();
    if (response.status !== 429 || attempt === 3) throw new Error(`CoinGecko ${key} 返回 HTTP ${response.status}`);
    const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") || "60", 10);
    await new Promise((resolve) => setTimeout(resolve, Math.max(15, Math.min(120, retryAfterSeconds)) * 1_000));
  }
  throw new Error(`CoinGecko ${key} 请求失败`);
}
