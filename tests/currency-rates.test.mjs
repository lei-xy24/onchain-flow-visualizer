import assert from "node:assert/strict";
import test from "node:test";
import {
  formatRateStatus,
  formatTransferUsd,
  formatTransfersUsdTotal,
  loadUsdRates,
  resolvePriceId,
} from "../currency-rates.js";

const storedRates = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem(key) {
      return storedRates.get(key) ?? null;
    },
    setItem(key, value) {
      storedRates.set(key, value);
    },
  },
});

const nativeTransfer = {
  asset: "ETH",
  assetAddress: null,
  decimals: 18,
  rawAmount: "2500000000000000000",
};

test("实时汇率按链和资产地址识别，不只相信资产符号", () => {
  assert.equal(resolvePriceId("eth", nativeTransfer), "ethereum");
  assert.equal(
    resolvePriceId("eth", {
      ...nativeTransfer,
      asset: "USDC",
      assetAddress: "0xA0b86991c6218b36c1d19D4A2e9Eb0cE3606eB48",
    }),
    "usd-coin",
  );
  assert.equal(
    resolvePriceId("eth", {
      ...nativeTransfer,
      asset: "USDC",
      assetAddress: "0x1111111111111111111111111111111111111111",
    }),
    null,
  );
  assert.equal(
    resolvePriceId("eth", {
      ...nativeTransfer,
      asset: "USDT",
      assetAddress: null,
      decimals: 6,
      rawAmount: "1000000",
    }),
    null,
    "缺少合约地址的代币不能被误当作链上原生币",
  );
});

test("美元格式化与合计使用实时快照，未知资产返回空值", () => {
  const snapshot = { rates: { ethereum: 4_000 } };
  assert.equal(formatTransferUsd(nativeTransfer, "eth", snapshot), "$10K");
  assert.equal(
    formatTransfersUsdTotal([nativeTransfer, nativeTransfer], "eth", snapshot),
    "$20K",
  );
  assert.equal(
    formatTransferUsd(
      { ...nativeTransfer, assetAddress: "0x1111111111111111111111111111111111111111" },
      "eth",
      snapshot,
    ),
    null,
  );
});

test("行情请求优先使用可跨域访问的 Binance 数据并在 60 秒内复用缓存", async () => {
  const originalFetch = globalThis.fetch;
  storedRates.clear();
  let requestCount = 0;
  globalThis.fetch = async (url, options = {}) => {
    requestCount += 1;
    const parsed = new URL(url);
    if (parsed.hostname === "data-api.binance.vision") {
      assert.equal(parsed.pathname, "/api/v3/ticker/price");
      assert.deepEqual(JSON.parse(parsed.searchParams.get("symbols")), [
        "ETHUSDT",
        "BNBUSDT",
        "POLUSDT",
        "USDCUSDT",
      ]);
      return new Response(
        JSON.stringify([
          { symbol: "ETHUSDT", price: "4000" },
          { symbol: "BNBUSDT", price: "800" },
          { symbol: "POLUSDT", price: "0.4" },
          { symbol: "USDCUSDT", price: "0.9999" },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    return new Promise((resolve, reject) => {
      const abort = () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      };
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener("abort", abort, { once: true });
    });
  };

  try {
    const first = await loadUsdRates({ force: true });
    const second = await loadUsdRates();
    assert.equal(first.rates.ethereum, 4_000);
    assert.equal(first.source, "Binance");
    assert.equal(first.approximate, true);
    assert.match(formatRateStatus(first), /Binance 实时行情 · USDT 近似美元/);
    assert.equal(second.fetchedAt, first.fetchedAt);
    assert.equal(requestCount, 1, "主行情源成功时不额外请求备用源");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Binance 不可用时自动切换到可跨域访问的 Gate.io 行情", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.hostname === "data-api.binance.vision") {
      throw new TypeError("Failed to fetch");
    }
    if (parsed.hostname === "api.gateio.ws") {
      const pair = parsed.searchParams.get("currency_pair");
      const prices = {
        ETH_USDT: "4000",
        BNB_USDT: "800",
        POL_USDT: "0.4",
        USDC_USDT: "0.9998",
      };
      return new Response(
        JSON.stringify([{ currency_pair: pair, last: prices[pair] }]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Promise((resolve, reject) => {
      const abort = () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      };
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener("abort", abort, { once: true });
    });
  };

  try {
    const snapshot = await loadUsdRates({ force: true });
    assert.equal(snapshot.source, "Gate.io");
    assert.equal(snapshot.rates.ethereum, 4_000);
    assert.match(formatRateStatus(snapshot), /USDT 近似美元/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("主行情源失败时自动采用 CoinGecko 备用数据", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "data-api.binance.vision") {
      throw new TypeError("Failed to fetch");
    }
    return new Response(
      JSON.stringify({
        ethereum: { usd: 4_000, last_updated_at: 1_787_987_200 },
        binancecoin: { usd: 800, last_updated_at: 1_787_987_200 },
        "polygon-ecosystem-token": { usd: 0.4, last_updated_at: 1_787_987_200 },
        tether: { usd: 1, last_updated_at: 1_787_987_200 },
        "usd-coin": { usd: 1, last_updated_at: 1_787_987_200 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const snapshot = await loadUsdRates({ force: true });
    assert.equal(snapshot.source, "CoinGecko");
    assert.equal(snapshot.rates.binancecoin, 800);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("全部行情源失败时不向页面泄露 Failed to fetch", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };

  try {
    await assert.rejects(
      loadUsdRates({ force: true }),
      (error) =>
        error.message === "实时汇率服务暂时不可用，请稍后重试" &&
        !error.message.includes("Failed to fetch"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
