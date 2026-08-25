import test from "node:test";
import assert from "node:assert/strict";
import { buildEventMarketInput, extractAssetEvents, queryRangeForEvents, validateEventMarketInput } from "../scripts/event-market-lib.mjs";

const eventAt = "2026-08-10T00:00:00.000Z";
const socialInput = {
  figures: [{
    id: "sample-person",
    sources: [
      { id: "person-only", type: "post", publishedAt: eventAt, title: "Donald Trump policy update", text: "No token is discussed here." },
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
});

test("按发帖时点计算多窗口收益、成交量和 BTC 相对收益", () => {
  const eventMs = new Date(eventAt).getTime();
  const ethereum = series(eventMs, 100, 1, 1000, 2000);
  const bitcoin = series(eventMs, 100, 0.5, 5000, 6000);
  const onlyEth = {
    figures: [{ id: "sample-person", sources: [socialInput.figures[0].sources[1]] }],
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
  assert.ok(metrics.volumeRatio24h > 1.9 && metrics.volumeRatio24h < 2.1);
  assert.equal(input.reactions[0].points.find((point) => point.hours === 0).change, 0);
});

test("行情查询范围覆盖事件前 24 小时与后 72 小时", () => {
  const events = extractAssetEvents({ figures: [{ id: "sample-person", sources: [socialInput.figures[0].sources[1]] }] });
  const range = queryRangeForEvents(events, { now: new Date("2026-08-20T00:00:00.000Z").getTime() });
  assert.equal(range.from, Math.floor((new Date(eventAt).getTime() - 24 * 36e5) / 1000));
  assert.equal(range.to, Math.ceil((new Date(eventAt).getTime() + 72 * 36e5) / 1000));
});

function series(eventMs, base, hourlyPercent, beforeVolume, afterVolume) {
  const prices = [];
  const total_volumes = [];
  for (let hours = -24; hours <= 72; hours += 1) {
    const time = eventMs + hours * 36e5;
    prices.push([time, base * (1 + (hours * hourlyPercent) / 100)]);
    total_volumes.push([time, hours < 0 ? beforeVolume : afterVolume]);
  }
  return { prices, total_volumes };
}
