#!/usr/bin/env node

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildCrossMarketSnapshot,
  buildDemoCrossMarketInput,
  CROSS_MARKET_ASSETS,
} from "./cross-market-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_EODHD_BASE_URL = "https://eodhd.com/api/eod";
const DEFAULT_COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3";

export async function generateCrossMarketSnapshot(options = {}) {
  const env = options.env || process.env;
  const log = options.log || console.log;
  const generatedAt = options.generatedAt || new Date().toISOString();
  let input;

  if (options.demo) {
    input = buildDemoCrossMarketInput({ generatedAt });
  } else {
    const eodhdToken = String(env.EODHD_API_TOKEN || "").trim();
    const coinGeckoKey = String(env.COINGECKO_DEMO_KEY || env.COINGECKO_API_KEY || "").trim();
    if (!eodhdToken || !coinGeckoKey) {
      const missing = [!eodhdToken && "EODHD_API_TOKEN", !coinGeckoKey && "COINGECKO_DEMO_KEY"].filter(Boolean);
      log(JSON.stringify({ status: "waiting", reason: `${missing.join(" and ")} not configured`, at: generatedAt }));
      return { status: "waiting", missing };
    }
    input = await collectLiveInput({
      generatedAt,
      eodhdToken,
      coinGeckoKey,
      eodhdBaseUrl: env.EODHD_BASE_URL || DEFAULT_EODHD_BASE_URL,
      coinGeckoBaseUrl: env.COINGECKO_BASE_URL || DEFAULT_COINGECKO_BASE_URL,
      fetchImpl: options.fetchImpl || fetch,
    });
  }

  const snapshot = buildCrossMarketSnapshot(input);
  if (options.checkOnly) {
    log(JSON.stringify({ status: "validated", snapshotId: snapshot.snapshotId, mode: snapshot.mode, assets: snapshot.assets.length }));
    return { status: "validated", snapshot };
  }

  const outputRoot = path.resolve(options.root || root);
  const destinations = [
    path.join(outputRoot, "data/cross-market/latest.json"),
    path.join(outputRoot, "static-site/data/cross-market/latest.json"),
  ];
  const existing = await readExisting(destinations[0]);
  if (existing?.status === "published" && Date.parse(existing.generatedAt) >= Date.parse(snapshot.generatedAt) && existing.mode === "live-api" && snapshot.mode !== "live-api") {
    log(JSON.stringify({ status: "preserved", reason: "demo snapshot cannot replace an equal or newer live snapshot", snapshotId: existing.snapshotId }));
    return { status: "preserved", snapshot: existing };
  }
  const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
  await Promise.all(destinations.map((destination) => atomicWrite(destination, serialized)));
  log(JSON.stringify({ status: "published", snapshotId: snapshot.snapshotId, mode: snapshot.mode, files: destinations.length }));
  return { status: "published", snapshot, files: destinations };
}

async function collectLiveInput({ generatedAt, eodhdToken, coinGeckoKey, eodhdBaseUrl, coinGeckoBaseUrl, fetchImpl }) {
  const eodBase = validateBaseUrl(eodhdBaseUrl, ["eodhd.com", "eodhistoricaldata.com"], "EODHD_BASE_URL");
  const coinBase = validateBaseUrl(coinGeckoBaseUrl, ["api.coingecko.com", "pro-api.coingecko.com"], "COINGECKO_BASE_URL");
  const to = new Date(generatedAt);
  const from = new Date(to.getTime() - 365 * 86_400_000);
  const fromDate = from.toISOString().slice(0, 10);
  const toDate = to.toISOString().slice(0, 10);

  const assets = [];
  for (const config of CROSS_MARKET_ASSETS) {
    if (config.kind === "equity") {
      const url = new URL(`${eodBase.href.replace(/\/$/, "")}/${encodeURIComponent(config.symbol)}`);
      url.searchParams.set("api_token", eodhdToken);
      url.searchParams.set("fmt", "json");
      url.searchParams.set("period", "d");
      url.searchParams.set("from", fromDate);
      url.searchParams.set("to", toDate);
      const rows = await fetchJson(url, fetchImpl, config.id);
      if (!Array.isArray(rows)) throw new Error(`${config.id} EODHD 响应不是行情数组`);
      assets.push({
        ...config,
        series: rows.map((row) => ({ date: row.date, open: Number(row.open), close: Number(row.adjusted_close || row.close) })),
      });
    } else {
      const url = new URL(`${coinBase.href.replace(/\/$/, "")}/coins/${encodeURIComponent(config.symbol)}/market_chart`);
      url.searchParams.set("vs_currency", "usd");
      url.searchParams.set("days", "365");
      const payload = await fetchJson(url, fetchImpl, config.id, { "x-cg-demo-api-key": coinGeckoKey });
      const byDate = new Map();
      for (const point of payload?.prices || []) {
        const date = new Date(Number(point?.[0])).toISOString().slice(0, 10);
        const close = Number(point?.[1]);
        if (Number.isFinite(close) && close > 0) byDate.set(date, { date, open: close, close });
      }
      assets.push({ ...config, series: [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date)) });
    }
  }
  return { generatedAt, mode: "live-api", sourceLabel: "EODHD 日线 · CoinGecko 日线", assets };
}

async function fetchJson(url, fetchImpl, assetId, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetchImpl(url, { headers: { Accept: "application/json", ...headers }, signal: controller.signal });
    if (!response.ok) throw new Error(`${assetId} 行情请求失败（HTTP ${response.status}）`);
    return response.json();
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`${assetId} 行情请求超时`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function validateBaseUrl(value, allowedHosts, label) {
  const url = new URL(value);
  const allowed = allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  if (url.protocol !== "https:" || !allowed || url.username || url.password || url.search || url.hash) throw new Error(`${label} 必须是允许的无账号 HTTPS 地址`);
  return url;
}

async function atomicWrite(destination, content) {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function readExisting(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
}

function parseArgs(values) {
  const options = { demo: false, checkOnly: false };
  for (const value of values) {
    if (value === "--demo") options.demo = true;
    else if (value === "--check-only") options.checkOnly = true;
    else throw new Error(`未知参数：${value}`);
  }
  return options;
}

const invokedAsCli = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedAsCli) {
  generateCrossMarketSnapshot(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(`全球市场快照生成失败：${error.message}`);
    process.exitCode = 1;
  });
}
