import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCrossMarketSnapshot,
  buildDemoCrossMarketInput,
  CROSS_MARKET_ASSETS,
} from "../scripts/cross-market-lib.mjs";
import { generateCrossMarketSnapshot } from "../scripts/generate-cross-market-snapshot.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatedAt = "2026-08-30T08:30:00.000Z";

test("演示快照发布八类归一化资产且不泄露供应商原始价格字段", () => {
  const snapshot = buildCrossMarketSnapshot(buildDemoCrossMarketInput({ generatedAt }));
  assert.equal(snapshot.status, "published");
  assert.equal(snapshot.snapshotId, "20260830T083000Z");
  assert.equal(snapshot.assets.length, CROSS_MARKET_ASSETS.length);
  assert.equal(snapshot.assets.length, 8);
  assert.deepEqual(new Set(snapshot.assets.map((asset) => asset.region)), new Set(["china", "europe", "us", "crypto"]));

  for (const asset of snapshot.assets) {
    assert.equal(asset.series[0].value, 100, `${asset.id} 首个公开点必须归一为 100`);
    assert.ok(asset.series.length >= 80, `${asset.id} 公开曲线点不足`);
    assert.ok(asset.series.every((point) => Number.isFinite(point.value) && point.value > 0));
    const dates = asset.series.map((point) => point.date);
    assert.deepEqual(dates, [...dates].sort(), `${asset.id} 日期必须单调递增`);
  }

  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /"(?:open|close)"\s*:/);
  assert.doesNotMatch(serialized, /api_token|api[_-]?key|authorization|bearer/i);
});

test("20 日和 60 日相关矩阵保持对称、对角为一且系数有界", () => {
  const snapshot = buildCrossMarketSnapshot(buildDemoCrossMarketInput({ generatedAt }));
  const assetIds = snapshot.assets.map((asset) => asset.id);

  for (const window of ["20", "60"]) {
    const matrix = snapshot.correlations[window];
    assert.equal(matrix.window, Number(window));
    for (const left of assetIds) {
      assert.equal(matrix.values[left][left], 1);
      for (const right of assetIds) {
        const value = matrix.values[left][right];
        assert.ok(value >= -1 && value <= 1, `${window} 日 ${left}/${right} 超出相关系数范围`);
        assert.equal(value, matrix.values[right][left], `${window} 日矩阵必须对称`);
      }
    }
  }
});

test("每个资产配对都发布完整的 -5 到 +5 领先滞后剖面", () => {
  const snapshot = buildCrossMarketSnapshot(buildDemoCrossMarketInput({ generatedAt }));
  assert.equal(snapshot.pairs.length, 28);
  for (const pair of snapshot.pairs) {
    assert.deepEqual(pair.leadLag.profile.map((point) => point.sessions), [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]);
    assert.ok(pair.leadLag.profile.every((point) => point.samples >= 40));
    assert.ok(pair.leadLag.profile.every((point) => point.correlation >= -1 && point.correlation <= 1));
    if (!pair.leadLag.stable) {
      assert.equal(pair.leadLag.sessions, 0);
      assert.equal(pair.leadLag.label, "未发现稳定领先关系");
    }
  }
});

test("三个市场故事引用存在的资产和曲线日期", () => {
  const snapshot = buildCrossMarketSnapshot(buildDemoCrossMarketInput({ generatedAt }));
  assert.deepEqual(snapshot.stories.map((story) => story.id), ["synchronization", "divergence", "stress"]);
  const assetIds = new Set(snapshot.assets.map((asset) => asset.id));
  const datesByAsset = new Map(snapshot.assets.map((asset) => [asset.id, new Set(asset.series.map((point) => point.date))]));

  for (const story of snapshot.stories) {
    assert.ok(story.from < story.to, `${story.id} 的故事区间无效`);
    assert.ok(assetIds.has(story.metrics.leaderId));
    assert.ok(assetIds.has(story.metrics.laggardId));
    assert.deepEqual(new Set(Object.keys(story.performance)), assetIds);
    for (const assetId of assetIds) {
      assert.ok(datesByAsset.get(assetId).has(story.from), `${story.id}/${assetId} 缺少起点`);
      assert.ok(datesByAsset.get(assetId).has(story.to), `${story.id}/${assetId} 缺少终点`);
    }
  }
});

test("生成器写出完全一致的根目录和 static-site 镜像", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "cross-market-test-"));
  const result = await generateCrossMarketSnapshot({
    root: temporaryRoot,
    demo: true,
    generatedAt,
    log() {},
  });
  assert.equal(result.status, "published");
  const [rootSnapshot, staticSnapshot] = await Promise.all([
    readFile(path.join(temporaryRoot, "data/cross-market/latest.json"), "utf8"),
    readFile(path.join(temporaryRoot, "static-site/data/cross-market/latest.json"), "utf8"),
  ]);
  assert.equal(staticSnapshot, rootSnapshot);
  assert.deepEqual(JSON.parse(rootSnapshot), result.snapshot);
});

test("缺少行情密钥时安全等待且不覆盖现有快照", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "cross-market-waiting-"));
  const destination = path.join(temporaryRoot, "data/cross-market/latest.json");
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, "sentinel\n", "utf8");
  const messages = [];
  const result = await generateCrossMarketSnapshot({
    root: temporaryRoot,
    env: {},
    generatedAt,
    log(message) { messages.push(message); },
  });
  assert.equal(result.status, "waiting");
  assert.deepEqual(result.missing, ["EODHD_API_TOKEN", "COINGECKO_DEMO_KEY"]);
  assert.equal(await readFile(destination, "utf8"), "sentinel\n");
  assert.match(messages.join("\n"), /not configured/);
});

test("仓库中的公开跨市场快照两份镜像一致且包含完整滞后剖面", async () => {
  const [rootSnapshot, staticSnapshot] = await Promise.all([
    readFile(path.join(root, "data/cross-market/latest.json"), "utf8"),
    readFile(path.join(root, "static-site/data/cross-market/latest.json"), "utf8"),
  ]);
  assert.equal(staticSnapshot, rootSnapshot);
  const snapshot = JSON.parse(rootSnapshot);
  assert.ok(snapshot.pairs.every((pair) => pair.leadLag.profile?.length === 11));
});
