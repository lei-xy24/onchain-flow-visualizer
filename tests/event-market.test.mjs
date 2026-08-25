import test from "node:test";
import assert from "node:assert/strict";
import { buildEventMarketInput, extractAssetEvents, queryRangeForEvents, validateEventMarketInput } from "../scripts/event-market-lib.mjs";

const eventAt = "2026-08-10T00:00:00.000Z";
const socialInput = {
  figures: [{
    id: "sample-person",
    sources: [
      { id: "person-only", type: "post", publishedAt: eventAt, title: "Donald Trump policy update", text: "No token is discussed here." },
      { id: "handle-only", type: "post", kind: "reply", publishedAt: eventAt, title: "Reply", text: "@cb_doge https://t.co/example" },
      { id: "eth-event", type: "post", publishedAt: eventAt, title: "Ethereum scaling", text: "Ethereum rollups and ETH settlement are improving." },
      { id: "stable-event", type: "post", publishedAt: "2026-08-09T12:00:00.000Z", title: "Stablecoin reserves", text: "USDC reserve transparency matters." },
    ],
  }],
};

test("只把动态中直接点名的资产识别为事件", () => {
  const events = extractAssetEvents(socialInput);
  assert.deepEqual(events.map((event) => event.sourceId).sort(), ["eth-event", "stable-event"]);
  assert.deepEqual(events.map((event) => event.asset.symbol).sort(), ["ETH", "USDC"]);
  assert.equal(events.some((event) => event.sourceId === "person-only"), false);
  assert.equal(events.some((event) => event.sourceId === "handle-only"), false);
});

test("非币圈事件可以在读取行情前指定候选资产", () => {
  const candidates = { events: [{
    figureId: "sample-person", sourceId: "person-only", impactChannel: "regulation_policy",
    relevance: "high", confidence: "high", candidateAssetIds: ["bitcoin", "ethereum"],
    eventSummary: "数字资产监管政策更新", rationale: "监管预期可能改变整体加密市场风险偏好。",
  }] };
  const events = extractAssetEvents(socialInput, { eventCandidates: candidates });
  assert.deepEqual(events.map((event) => event.asset.symbol).sort(), ["BTC", "ETH"]);
  assert.ok(events.every((event) => event.sourceId === "person-only"));
  assert.ok(events.every((event) => event.impactHypothesis.channel === "regulation_policy"));
});

test("按发帖时点计算多窗口收益、成交量和 BTC 相对收益", () => {
  const eventMs = new Date(eventAt).getTime();
  const ethereum = series(eventMs, 100, 1, 1000, 2000);
  const bitcoin = series(eventMs, 100, 0.5, 5000, 6000);
  const onlyEth = {
    figures: [{ id: "sample-person", sources: [socialInput.figures[0].sources.find((source) => source.id === "eth-event")] }],
  };
  const input = buildEventMarketInput({ socialInput: onlyEth, seriesByCoin: { ethereum, bitcoin }, collectedAt: "2026-08-13T00:00:00.000Z" });
  assert.deepEqual(validateEventMarketInput(input, onlyEth), []);
  assert.equal(input.reactions.length, 1);
  const metrics = input.reactions[0].metrics;
  assert.equal(metrics.return1h, 1);
  assert.equal(metrics.return6h, 6);
  assert.equal(metrics.return24h, 24);
  assert.equal(metrics.return72h, 72);
  assert.equal(metrics.btcReturn24h, 12);
  assert.equal(metrics.btcAdjusted24h, 12);
  assert.equal(metrics.currentPrice, 172);
  assert.equal(metrics.returnToCurrent, 72);
  assert.ok(metrics.volumeRatio24h > 1.9 && metrics.volumeRatio24h < 2.1);
  assert.equal(input.reactions[0].points.find((point) => point.hours === 0).change, 0);
  assert.equal(input.reactions[0].significance.passed, true);
});

test("行情查询范围额外覆盖事件前 168 小时历史波动基线", () => {
  const events = extractAssetEvents({ figures: [{ id: "sample-person", sources: [socialInput.figures[0].sources.find((source) => source.id === "eth-event")] }] });
  const range = queryRangeForEvents(events, { now: new Date("2026-08-20T00:00:00.000Z").getTime() });
  assert.equal(range.from, Math.floor((new Date(eventAt).getTime() - 168 * 36e5) / 1000));
  assert.equal(range.to, Math.ceil(new Date("2026-08-20T00:00:00.000Z").getTime() / 1000));
});

test("普通波动不会通过事件异常阈值", () => {
  const eventMs = new Date(eventAt).getTime();
  const flat = series(eventMs, 100, 0.01, 1000, 1050);
  const onlyEth = { figures: [{ id: "sample-person", sources: [socialInput.figures[0].sources.find((source) => source.id === "eth-event")] }] };
  const input = buildEventMarketInput({ socialInput: onlyEth, seriesByCoin: { ethereum: flat, bitcoin: flat } });
  assert.equal(input.reactions[0].significance.passed, false);
  assert.ok(input.reactions[0].significance.reasons.some((reason) => reason.includes("未达到")));
});

function series(eventMs, base, hourlyPercent, beforeVolume, afterVolume) {
  const prices = [];
  const total_volumes = [];
  for (let hours = -168; hours <= 72; hours += 1) {
    const time = eventMs + hours * 36e5;
    const beforeNoise = hours < 0 ? ((Math.abs(hours) % 5) - 2) * 0.0008 : null;
    prices.push([time, hours < 0 ? base * (1 + beforeNoise) : base * (1 + (hours * hourlyPercent) / 100)]);
    total_volumes.push([time, hours < 0 ? beforeVolume : afterVolume]);
  }
  return { prices, total_volumes };
}
