const DEFAULT_PRICE_API =
  "https://data-api.binance.vision/api/v3/ticker/price";
const SECONDARY_PRICE_API = "https://api.gateio.ws/api/v4/spot/tickers";
const FALLBACK_PRICE_API = "https://api.coingecko.com/api/v3/simple/price";
const CACHE_KEY = "onchain-usd-rates-v2";
const CACHE_TTL_MS = 60_000;
const PRIMARY_TIMEOUT_MS = 2_500;
const FALLBACK_TIMEOUT_MS = 3_500;
const BINANCE_SYMBOLS = Object.freeze([
  "ETHUSDT",
  "BNBUSDT",
  "POLUSDT",
  "USDCUSDT",
]);
const PRICE_ID_BY_BINANCE_SYMBOL = Object.freeze({
  ETHUSDT: "ethereum",
  BNBUSDT: "binancecoin",
  POLUSDT: "polygon-ecosystem-token",
  USDCUSDT: "usd-coin",
});
const GATE_PAIRS = Object.freeze([
  "ETH_USDT",
  "BNB_USDT",
  "POL_USDT",
  "USDC_USDT",
]);
const PRICE_ID_BY_GATE_PAIR = Object.freeze({
  ETH_USDT: "ethereum",
  BNB_USDT: "binancecoin",
  POL_USDT: "polygon-ecosystem-token",
  USDC_USDT: "usd-coin",
});

const PRICE_IDS_BY_ASSET = Object.freeze({
  "eth:native": "ethereum",
  "bsc:native": "binancecoin",
  "polygon:native": "polygon-ecosystem-token",
  "eth:0xdac17f958d2ee523a2206206994597c13d831ec7": "tether",
  "eth:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "usd-coin",
  "bsc:0x55d398326f99059ff775485246999027b3197955": "tether",
  "polygon:0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": "usd-coin",
  "polygon:0xc2132d05d31c914a87c6611c10748aeb04b58e8f": "tether",
});

const REQUESTED_PRICE_IDS = Object.freeze([
  ...new Set(Object.values(PRICE_IDS_BY_ASSET)),
]);
const NATIVE_SYMBOL_BY_CHAIN = Object.freeze({
  eth: "ETH",
  bsc: "BNB",
  polygon: "POL",
});

let memorySnapshot = null;
let activeRequest = null;

export function resolvePriceId(chain, transfer) {
  const normalizedChain = String(chain || transfer?.chain || "")
    .trim()
    .toLowerCase();
  const assetAddress = transfer?.assetAddress;
  if (
    assetAddress === null &&
    String(transfer?.asset || "").trim().toUpperCase() !==
      NATIVE_SYMBOL_BY_CHAIN[normalizedChain]
  ) {
    return null;
  }
  const assetKey = assetAddress
    ? String(assetAddress).trim().toLowerCase()
    : "native";
  return PRICE_IDS_BY_ASSET[`${normalizedChain}:${assetKey}`] || null;
}

export async function loadUsdRates({ force = false } = {}) {
  const now = Date.now();
  const cached = memorySnapshot || readStoredSnapshot();
  if (!force && isFreshSnapshot(cached, now)) {
    memorySnapshot = cached;
    return cached;
  }

  if (activeRequest) return activeRequest;
  activeRequest = requestUsdRates()
    .then((snapshot) => {
      memorySnapshot = snapshot;
      writeStoredSnapshot(snapshot);
      return snapshot;
    })
    .finally(() => {
      activeRequest = null;
    });
  return activeRequest;
}

export function transferUsdValue(transfer, chain, snapshot) {
  const priceId = resolvePriceId(chain, transfer);
  const rate = priceId ? snapshot?.rates?.[priceId] : null;
  if (!Number.isFinite(rate) || rate <= 0) return null;

  const amount = rawAmountToNumber(transfer?.rawAmount, transfer?.decimals);
  return Number.isFinite(amount) ? amount * rate : null;
}

export function formatTransferUsd(transfer, chain, snapshot) {
  const value = transferUsdValue(transfer, chain, snapshot);
  return value === null ? null : formatUsd(value);
}

export function formatTransfersUsdTotal(transfers, chain, snapshot) {
  if (!Array.isArray(transfers) || transfers.length === 0) return "$0";
  const values = transfers.map((transfer) =>
    transferUsdValue(transfer, chain, snapshot),
  );
  if (values.some((value) => value === null)) return null;
  return formatUsd(values.reduce((sum, value) => sum + value, 0));
}

export function formatUsd(value) {
  if (!Number.isFinite(value) || value < 0) return null;
  if (value === 0) return "$0";
  if (value >= 1_000_000_000) {
    return `$${trimFixed(value / 1_000_000_000)}B`;
  }
  if (value >= 1_000_000) return `$${trimFixed(value / 1_000_000)}M`;
  if (value >= 1_000) return `$${trimFixed(value / 1_000)}K`;
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value < 10 ? 2 : 0,
    style: "currency",
  }).format(value);
}

export function formatRateTime(snapshot) {
  if (!Number.isFinite(snapshot?.updatedAt)) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(snapshot.updatedAt));
}

export function formatRateStatus(snapshot) {
  const time = formatRateTime(snapshot);
  if (!time) return "";
  const source = String(snapshot?.source || "实时行情");
  return snapshot?.approximate
    ? `${source} 实时行情 · USDT 近似美元 · ${time}`
    : `${source} 实时汇率 · ${time}`;
}

async function requestUsdRates() {
  try {
    return await runProvider(requestBinanceRates, PRIMARY_TIMEOUT_MS);
  } catch {
    // 主行情源不可用时，继续尝试两个独立备用源。
  }

  try {
    return await runFallbackProviders();
  } catch {
    throw new Error("实时汇率服务暂时不可用，请稍后重试");
  }
}

async function runProvider(provider, timeoutMs) {
  const controller = new AbortController();
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      controller.abort();
      reject(new Error("行情源请求超时"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([provider(controller.signal), timeout]);
  } finally {
    globalThis.clearTimeout(timeoutId);
    controller.abort();
  }
}

async function runFallbackProviders() {
  const controller = new AbortController();
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      controller.abort();
      reject(new Error("备用行情源请求超时"));
    }, FALLBACK_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      Promise.any([
        requestGateRates(controller.signal),
        requestCoinGeckoRates(controller.signal),
      ]),
      timeout,
    ]);
  } finally {
    globalThis.clearTimeout(timeoutId);
    controller.abort();
  }
}

async function requestBinanceRates(signal) {
  const value = await fetchJson(buildBinancePriceRequestUrl(), signal);
  if (!Array.isArray(value)) throw new Error("Binance 行情格式无效");

  const rates = { tether: 1 };
  for (const item of value) {
    const priceId = PRICE_ID_BY_BINANCE_SYMBOL[item?.symbol];
    const price = Number(item?.price);
    if (priceId && Number.isFinite(price) && price > 0) {
      rates[priceId] = price;
    }
  }
  requireCompleteRates(rates);
  return {
    fetchedAt: Date.now(),
    rates,
    source: "Binance",
    approximate: true,
    quote: "USDT",
    updatedAt: Date.now(),
  };
}

async function requestGateRates(signal) {
  const values = await Promise.all(
    GATE_PAIRS.map((pair) =>
      fetchJson(buildGatePriceRequestUrl(pair), signal),
    ),
  );
  const rates = { tether: 1 };
  for (const value of values) {
    for (const item of Array.isArray(value) ? value : []) {
      const priceId = PRICE_ID_BY_GATE_PAIR[item?.currency_pair];
      const price = Number(item?.last);
      if (priceId && Number.isFinite(price) && price > 0) {
        rates[priceId] = price;
      }
    }
  }
  requireCompleteRates(rates);
  return {
    fetchedAt: Date.now(),
    rates,
    source: "Gate.io",
    approximate: true,
    quote: "USDT",
    updatedAt: Date.now(),
  };
}

async function requestCoinGeckoRates(signal) {
  const value = await fetchJson(buildCoinGeckoPriceRequestUrl(), signal);
  const rates = {};
  let latestProviderTime = 0;
  for (const priceId of REQUESTED_PRICE_IDS) {
    const item = value?.[priceId];
    if (!Number.isFinite(item?.usd) || item.usd <= 0) continue;
    rates[priceId] = item.usd;
    if (Number.isFinite(item.last_updated_at)) {
      latestProviderTime = Math.max(
        latestProviderTime,
        item.last_updated_at * 1_000,
      );
    }
  }
  requireCompleteRates(rates);
  return {
    fetchedAt: Date.now(),
    rates,
    source: "CoinGecko",
    approximate: false,
    quote: "USD",
    updatedAt: latestProviderTime || Date.now(),
  };
}

async function fetchJson(url, signal) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error(`行情接口返回 HTTP ${response.status}`);
  return response.json();
}

function requireCompleteRates(rates) {
  if (
    !REQUESTED_PRICE_IDS.every(
      (priceId) => Number.isFinite(rates[priceId]) && rates[priceId] > 0,
    )
  ) {
    throw new Error("行情接口没有返回完整价格");
  }
}

function buildBinancePriceRequestUrl() {
  const configuredUrl =
    globalThis.ONCHAIN_API_CONFIG?.marketPrices || DEFAULT_PRICE_API;
  const url = new URL(configuredUrl, globalThis.location?.href || DEFAULT_PRICE_API);
  url.searchParams.set("symbols", JSON.stringify(BINANCE_SYMBOLS));
  return url.href;
}

function buildCoinGeckoPriceRequestUrl() {
  const configuredUrl =
    globalThis.ONCHAIN_API_CONFIG?.marketPricesFallback || FALLBACK_PRICE_API;
  const url = new URL(
    configuredUrl,
    globalThis.location?.href || FALLBACK_PRICE_API,
  );
  url.searchParams.set("ids", REQUESTED_PRICE_IDS.join(","));
  url.searchParams.set("vs_currencies", "usd");
  url.searchParams.set("include_last_updated_at", "true");
  return url.href;
}

function buildGatePriceRequestUrl(pair) {
  const configuredUrl =
    globalThis.ONCHAIN_API_CONFIG?.marketPricesSecondary || SECONDARY_PRICE_API;
  const url = new URL(
    configuredUrl,
    globalThis.location?.href || SECONDARY_PRICE_API,
  );
  url.searchParams.set("currency_pair", pair);
  return url.href;
}

function rawAmountToNumber(rawAmount, decimals) {
  if (!/^\d+$/.test(String(rawAmount || "")) || !Number.isInteger(decimals)) {
    return Number.NaN;
  }
  const normalized = String(rawAmount).replace(/^0+(?=\d)/, "");
  if (decimals === 0) return Number(normalized);
  const padded = normalized.padStart(decimals + 1, "0");
  const integer = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).slice(0, 12);
  return Number(`${integer}.${fraction}`);
}

function isFreshSnapshot(snapshot, now) {
  if (!snapshot || !Number.isFinite(snapshot.fetchedAt)) return false;
  if (now - snapshot.fetchedAt >= CACHE_TTL_MS) return false;
  return REQUESTED_PRICE_IDS.every((priceId) =>
    Number.isFinite(snapshot.rates?.[priceId]) && snapshot.rates[priceId] > 0,
  );
}

function readStoredSnapshot() {
  try {
    const value = globalThis.localStorage?.getItem(CACHE_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function writeStoredSnapshot(snapshot) {
  try {
    globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // 浏览器禁用存储时仍可使用当前页面内存缓存。
  }
}

function trimFixed(value) {
  return value.toFixed(2).replace(/\.?0+$/, "");
}
