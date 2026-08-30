import assert from "node:assert/strict";
import test from "node:test";
import {
  formatTransferUsd,
  formatTransfersUsdTotal,
  loadUsdRates,
  resolvePriceId,
} from "../currency-rates.js";

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

test("行情请求批量读取价格并在 60 秒内复用缓存", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  const stored = new Map();
  let requestCount = 0;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key) {
        return stored.get(key) ?? null;
      },
      setItem(key, value) {
        stored.set(key, value);
      },
    },
  });
  globalThis.fetch = async (url) => {
    requestCount += 1;
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/api/v3/simple/price");
    assert.equal(parsed.searchParams.get("vs_currencies"), "usd");
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
    const first = await loadUsdRates({ force: true });
    const second = await loadUsdRates();
    assert.equal(first.rates.ethereum, 4_000);
    assert.equal(second.fetchedAt, first.fetchedAt);
    assert.equal(requestCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocalStorageDescriptor) {
      Object.defineProperty(
        globalThis,
        "localStorage",
        originalLocalStorageDescriptor,
      );
    } else {
      delete globalThis.localStorage;
    }
  }
});
