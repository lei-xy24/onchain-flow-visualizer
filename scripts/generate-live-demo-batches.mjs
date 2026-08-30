import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const ACCOUNTS = Object.freeze({
  bridge: {
    address: "0xA91c7F2b2f32E7d42A61A0C4A53e80B3d8D7C91A",
    label: "Bridge Vault",
  },
  market: {
    address: "0x7b3E86178f3c2C5D8b57a322A3f8aD5D7c3118Be",
    label: "Market Maker",
  },
  treasury: {
    address: "0x5E34cB1aef9E5B0E0E6C23d27D087F23E8bd3c70",
    label: "Treasury",
  },
  router: {
    address: "0x3DcA2a336a29C02E4c2d06b0940Bf338c5d07001",
    label: "DeFi Router",
  },
  fresh: {
    address: "0x44Fb3B9fF2fB3D0Fe4b3D837a9E0b2F07f5DA443",
    label: "Fresh Wallet",
  },
  custody: {
    address: "0x79165aAB3F8305cFC771B5Ea5986D9a6f958a5B0",
    label: "Custody Wallet",
  },
  whale: {
    address: "0x1111111111111111111111111111111111111111",
    label: "Whale Wallet",
  },
  lending: {
    address: "0x2222222222222222222222222222222222222222",
    label: "Lending Pool",
  },
  staking: {
    address: "0x3333333333333333333333333333333333333333",
    label: "Staking Vault",
  },
});

const CHAINS = Object.freeze({
  eth: {
    start: "2026-07-16T08:00:00Z",
    exchange: "0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97",
    nativeAsset: "ETH",
    nativePriceCents: 350_000,
    stableAsset: "USDC",
    stableAddress: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    stableDecimals: 6,
  },
  bsc: {
    start: "2026-07-16T08:01:00Z",
    exchange: "0xB5C0000000000000000000000000000000000001",
    nativeAsset: "BNB",
    nativePriceCents: 60_000,
    stableAsset: "USDT",
    stableAddress: "0x55d398326f99059fF775485246999027B3197955",
    stableDecimals: 18,
  },
  polygon: {
    start: "2026-07-16T08:02:00Z",
    exchange: "0x9000000000000000000000000000000000000001",
    nativeAsset: "POL",
    nativePriceCents: 50,
    stableAsset: "USDC",
    stableAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    stableDecimals: 6,
  },
});

const INITIAL_BATCHES = Object.freeze({
  eth: [
    {
      number: 1,
      transfers: [
        ["exchange", "bridge", "native", 17_500],
        ["fresh", "exchange", "native", 630],
        ["bridge", "market", "native", 147_000],
        ["treasury", "router", "native", 1_225_000],
        ["fresh", "treasury", "native", 5_250],
        ["custody", "exchange", "native", 1_400_000],
      ],
    },
    {
      number: 2,
      transfers: [
        ["bridge", "exchange", "native", 8_400],
        ["market", "treasury", "native", 262_500],
        ["router", "fresh", "native", 245],
        ["treasury", "bridge", "native", 10_500_000],
        ["custody", "market", "native", 2_100_000],
        ["exchange", "router", "native", 29_750],
      ],
    },
  ],
  bsc: [
    {
      number: 1,
      transfers: [
        ["exchange", "bridge", "native", 19_200],
        ["fresh", "exchange", "native", 480],
        ["bridge", "market", "native", 720_000],
        ["treasury", "router", "native", 4_800_000],
        ["custody", "exchange", "native", 1_500_000],
        ["exchange", "treasury", "native", 45_000],
      ],
    },
    {
      number: 2,
      transfers: [
        ["bridge", "exchange", "native", 5_400],
        ["market", "treasury", "native", 246_000],
        ["router", "fresh", "native", 300],
        ["treasury", "bridge", "native", 38_400_000],
        ["custody", "market", "native", 2_340_000],
        ["exchange", "router", "native", 15_000],
      ],
    },
  ],
  polygon: [
    {
      number: 1,
      transfers: [
        ["exchange", "bridge", "native", 9_000],
        ["fresh", "exchange", "native", 375],
        ["bridge", "market", "native", 150_000],
        ["treasury", "router", "native", 12_000],
        ["custody", "exchange", "native", 1_500_000],
        ["exchange", "treasury", "native", 55_000],
      ],
    },
    {
      number: 2,
      transfers: [
        ["bridge", "exchange", "native", 2_500],
        ["market", "treasury", "native", 480_000],
        ["router", "fresh", "native", 450],
        ["treasury", "bridge", "native", 39_000],
        ["custody", "market", "native", 2_200_000],
        ["exchange", "router", "native", 21_000],
      ],
    },
  ],
});

const SHARED_BATCHES = Object.freeze([
  {
    number: 3,
    transfers: [
      ["exchange", "whale", "native", 28_000],
      ["whale", "lending", "stable", 420_000],
      ["lending", "market", "native", 840],
      ["router", "fresh", "native", 7_000],
      ["treasury", "custody", "native", 1_750_000],
      ["bridge", "exchange", "stable", 85_000],
    ],
  },
  {
    number: 4,
    transfers: [
      ["custody", "staking", "native", 2_800_000],
      ["staking", "treasury", "native", 315_000],
      ["market", "whale", "stable", 95_000],
      ["fresh", "bridge", "native", 700],
      ["exchange", "router", "stable", 12_500],
      ["lending", "exchange", "native", 4_200],
    ],
  },
  {
    number: 5,
    transfers: [
      ["whale", "exchange", "native", 1_225_000],
      ["treasury", "lending", "stable", 260_000],
      ["router", "market", "native", 35_000],
      ["bridge", "fresh", "stable", 950],
      ["staking", "custody", "native", 8_750],
      ["exchange", "bridge", "native", 105_000],
    ],
  },
]);

const TRANSFER_SECOND_OFFSETS = Object.freeze([5, 15, 25, 35, 45, 55]);
const LIVE_WINDOW_MS = 60_000;
const WEI = 10n ** 18n;

for (const [chain, config] of Object.entries(CHAINS)) {
  const outputDirectories = [
    path.join(projectRoot, "mock-live", chain),
    path.join(projectRoot, "static-site", "mock-live", chain),
  ];
  await Promise.all(
    outputDirectories.map((directory) => mkdir(directory, { recursive: true })),
  );

  for (const batch of [...INITIAL_BATCHES[chain], ...SHARED_BATCHES]) {
    const windowStart = new Date(
      Date.parse(config.start) + (batch.number - 1) * LIVE_WINDOW_MS,
    );
    const response = {
      chain,
      window: {
        from: toIsoSeconds(windowStart),
        to: toIsoSeconds(new Date(windowStart.getTime() + LIVE_WINDOW_MS)),
      },
      transfers: batch.transfers.map((definition, index) =>
        buildTransfer(chain, config, batch.number, index, windowStart, definition),
      ),
    };

    await Promise.all(
      outputDirectories.map((directory) =>
        writeFile(
          path.join(directory, `batch-${batch.number}.json`),
          `${JSON.stringify(response, null, 2)}\n`,
          "utf8",
        ),
      ),
    );
  }
}

function buildTransfer(
  chain,
  config,
  batchNumber,
  index,
  windowStart,
  [fromKey, toKey, assetType, valueUsd],
) {
  const id = `${chain}-live-${batchNumber}-${index + 1}`;
  const from = getAccount(config, fromKey);
  const to = getAccount(config, toKey);
  const isNative = assetType === "native";
  const decimals = isNative ? 18 : config.stableDecimals;

  return {
    id,
    from: from.address,
    to: to.address,
    fromLabel: from.label,
    toLabel: to.label,
    time: toIsoSeconds(
      new Date(
        windowStart.getTime() + TRANSFER_SECOND_OFFSETS[index] * 1_000,
      ),
    ),
    rawAmount: isNative
      ? nativeRawAmount(valueUsd, config.nativePriceCents)
      : stableRawAmount(valueUsd, decimals),
    decimals,
    asset: isNative ? config.nativeAsset : config.stableAsset,
    assetAddress: isNative ? null : config.stableAddress,
    txHash: `0x${createHash("sha256").update(id).digest("hex")}`,
  };
}

function getAccount(config, key) {
  if (key === "exchange") {
    return { address: config.exchange, label: "Demo Exchange" };
  }
  return ACCOUNTS[key];
}

function nativeRawAmount(valueUsd, priceCents) {
  return ((BigInt(valueUsd) * 100n * WEI) / BigInt(priceCents)).toString();
}

function stableRawAmount(valueUsd, decimals) {
  return (BigInt(valueUsd) * 10n ** BigInt(decimals)).toString();
}

function toIsoSeconds(date) {
  return date.toISOString().replace(".000Z", "Z");
}
