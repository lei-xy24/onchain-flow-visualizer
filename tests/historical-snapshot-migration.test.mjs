import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  migrateHistoricalSnapshot,
  migratePublishedHistory,
} from "../scripts/migrate-social-radar-history.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const EXPECTED_REACTION_HASHES = new Map([
  ["trump-fm-117134651908743307-eth", "d1fa84a02b39170f548eb83057a822b2604ceec8eaa3c6eb0b025507d2a0c5ff"],
  ["trump-fm-117134622109680955-eth", "f4ada55475e90b6d80cc562e5506c2bc20806e9f14dafd643bb8cbe547171af0"],
  ["trump-fm-117134600045602327-eth", "3c86cc5e251013de77057c79b6247a1032032009842665fee88b8a746fb81ca9"],
  ["trump-fm-117134598983433487-eth", "0528719a15d2c76173c1b75926e9261ad4e294a687adbf271559357cc5f6addc"],
  ["trump-fm-117134595889412013-eth", "3e1dff4dc906095147114772629d4edc307b7986c0de58fced377937701bc5fd"],
  ["x-2090590687657922579-eth", "2f0925bf5e0daa355f5b20acde5e43b11d670a202a36369fcfe6a4225ebd6d5e"],
  ["x-2090590687657922579-bnb", "3eced90a8c2acda3a36e9327ccf8d98cd8dbd7d5560ffd344c8f0dcbbe884395"],
  ["x-2090590687657922579-sol", "fd4162596cd247a92b1997d4df1d720d99e89e1b6e14978d76e5e969c0bb3265"],
]);

test("离线迁移器用唯一最大来源交集承接未直接命中的旧版行情", async () => {
  const raw = await readJson("data/snapshots/20260824T000000Z.json");
  const legacy = toLegacyFixture(raw);
  const original = structuredClone(legacy);
  const migrated = migrateHistoricalSnapshot(legacy);
  const trump = migrated.figures.find((figure) => figure.id === "donald-trump");
  const cz = migrated.figures.find((figure) => figure.id === "changpeng-zhao");

  assert.deepEqual(legacy, original, "迁移函数不得原地修改输入快照");
  assert.ok(migrated.figures.every((figure) => figure.themes.every((theme) => theme.topicType !== "market_impact_events")));
  assert.equal(trump.themes.find((theme) => theme.topicType === "iran_pressure_campaign").marketImpact.reactions.length, 5);
  assert.equal(cz.themes.find((theme) => theme.topicType === "tokenization_advocacy").marketImpact.reactions.length, 3);
});

test("旧版行情没有唯一可审计归属时迁移必须失败", async () => {
  const raw = await readJson("data/snapshots/20260824T000000Z.json");
  const zeroOverlap = toLegacyFixture(raw);
  const trump = zeroOverlap.figures.find((figure) => figure.id === "donald-trump");
  for (const theme of trump.themes.filter((theme) => theme.topicType !== "market_impact_events")) {
    theme.sourceIds = theme.sourceIds.filter((sourceId) => !sourceId.startsWith("trump-fm-117134"));
    theme.evidence = theme.evidence.filter((item) => !item.id.startsWith("trump-fm-117134"));
  }
  assert.throws(() => migrateHistoricalSnapshot(zeroOverlap), /无法唯一归属真实主题/);

  const tied = toLegacyFixture(raw);
  const tiedTrump = tied.figures.find((figure) => figure.id === "donald-trump");
  const legacyTheme = tiedTrump.themes.find((theme) => theme.topicType === "market_impact_events");
  const midterm = tiedTrump.themes.find((theme) => theme.topicType === "midterm_endorsements");
  midterm.sourceIds.push(legacyTheme.sourceIds[0], legacyTheme.sourceIds[3]);
  assert.throws(() => migrateHistoricalSnapshot(tied), /无法唯一归属真实主题/);
});

test("20260824 将八条真实行情完整迁回对应人物主题", async () => {
  const snapshot = await readJson("data/snapshots/20260824T000000Z.json");
  const trump = snapshot.figures.find((figure) => figure.id === "donald-trump");
  const cz = snapshot.figures.find((figure) => figure.id === "changpeng-zhao");

  assert.ok(snapshot.figures.every((figure) => figure.themes.every((theme) => (
    theme.topicType !== "market_impact_events" && theme.story?.dataMode !== "event-market"
  ))));

  const iran = trump.themes.find((theme) => theme.topicType === "iran_pressure_campaign");
  const tokenization = cz.themes.find((theme) => theme.topicType === "tokenization_advocacy");
  assert.equal(iran.marketImpact.reactions.length, 5, "特朗普五条地缘事件行情应一并归入对伊朗施压主题");
  assert.equal(tokenization.marketImpact.reactions.length, 3, "赵长鹏同一动态的三资产行情应归入代币化主题");
  assert.ok(iran.marketImpact.derivedFromLegacyTheme);
  assert.ok(tokenization.marketImpact.derivedFromLegacyTheme);

  const reactions = snapshot.figures.flatMap((figure) => (
    figure.themes.flatMap((theme) => theme.marketImpact?.reactions || [])
  ));
  assert.equal(reactions.length, 8);
  assert.equal(new Set(reactions.map((reaction) => reaction.id)).size, 8, "迁移不得复制同一行情");
  assert.deepEqual(new Set(reactions.map((reaction) => reaction.id)), new Set(EXPECTED_REACTION_HASHES.keys()));
  assert.equal(reactions.reduce((sum, reaction) => sum + reaction.points.length, 0), 768);

  for (const reaction of reactions) {
    assert.equal(reaction.points.length, 96, `${reaction.id} 应保留完整的 96 个小时点`);
    assert.equal(reactionHash(reaction), EXPECTED_REACTION_HASHES.get(reaction.id), `${reaction.id} 的原始行情内容被改写`);
  }
});

test("20260817 明确区分未采集事件行情与未发现行情异常", async () => {
  const snapshot = await readJson("data/snapshots/20260817T000000Z.json");
  assert.equal(snapshot.eventMarketMode, "not-collected");
  assert.equal(snapshot.eventMarketNotice, "当期未采集事件行情");
  assert.equal(
    snapshot.figures.flatMap((figure) => figure.themes).flatMap((theme) => theme.marketImpact?.reactions || []).length,
    0,
    "缺少历史小时行情时不得伪造 reaction",
  );
  assert.ok(snapshot.figures.every((figure) => figure.themes.every((theme) => theme.topicType !== "market_impact_events")));
});

test("历史快照、latest 和索引在两个发布目录保持一致且 digest 有效", async () => {
  for (const file of [
    "data/snapshots/20260817T000000Z.json",
    "data/snapshots/20260824T000000Z.json",
    "data/latest-snapshot.json",
    "data/snapshot-index.json",
  ]) {
    const rootContent = await readFile(path.join(root, file), "utf8");
    const staticContent = await readFile(path.join(root, "static-site", file), "utf8");
    assert.equal(staticContent, rootContent, `${file} 的 static-site 镜像未同步`);
  }

  const [index, latest, august17, august24] = await Promise.all([
    readJson("data/snapshot-index.json"),
    readJson("data/latest-snapshot.json"),
    readJson("data/snapshots/20260817T000000Z.json"),
    readJson("data/snapshots/20260824T000000Z.json"),
  ]);
  assert.deepEqual(latest, august24, "latest-snapshot 应与最新历史快照内容完全一致");
  for (const snapshot of [august17, august24]) {
    const entry = index.snapshots.find((item) => item.id === snapshot.snapshotId);
    const digest = snapshotDigest(snapshot);
    assert.ok(entry, `${snapshot.snapshotId} 缺少索引条目`);
    assert.equal(snapshot.digest, digest, `${snapshot.snapshotId} 内部 digest 未更新`);
    assert.equal(entry.digest, digest, `${snapshot.snapshotId} 索引 digest 未更新`);
  }
  assert.equal(index.latest, august24.snapshotId);
  assert.equal(index.generatedAt, august24.generatedAt);
});

test("check-only 只校验离线迁移且不写入任何历史文件", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "radar-history-check-"));
  const staticData = path.join(temporaryRoot, "static-site/data");
  await mkdir(path.join(staticData, "snapshots"), { recursive: true });
  for (const file of [
    "snapshot-index.json",
    "snapshots/20260817T000000Z.json",
    "snapshots/20260824T000000Z.json",
  ]) {
    const content = await readFile(path.join(root, "static-site/data", file), "utf8");
    await writeFile(path.join(staticData, file), content, "utf8");
  }
  const before = await readFile(path.join(staticData, "snapshots/20260824T000000Z.json"), "utf8");
  const result = await migratePublishedHistory({ root: temporaryRoot, checkOnly: true });
  const after = await readFile(path.join(staticData, "snapshots/20260824T000000Z.json"), "utf8");
  assert.equal(result.status, "validated");
  assert.equal(result.latest, "20260824T000000Z");
  assert.equal(after, before);
});

async function readJson(file) {
  return JSON.parse(await readFile(path.join(root, file), "utf8"));
}

function reactionHash(reaction) {
  return createHash("sha256").update(JSON.stringify(canonicalize(reaction, new Set(["isCurrentWindow"])))).digest("hex");
}

function snapshotDigest(snapshot) {
  const copy = structuredClone(snapshot);
  delete copy.digest;
  return createHash("sha256").update(JSON.stringify(copy)).digest("hex").slice(0, 16);
}

function canonicalize(value, ignoredKeys) {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, ignoredKeys));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => !ignoredKeys.has(key))
      .sort()
      .map((key) => [key, canonicalize(value[key], ignoredKeys)]),
  );
}

function toLegacyFixture(snapshot) {
  if (snapshot.figures.some((figure) => figure.themes.some((theme) => theme.topicType === "market_impact_events"))) {
    return structuredClone(snapshot);
  }
  const legacy = structuredClone(snapshot);
  const assignments = [
    {
      figureId: "donald-trump",
      topicType: "iran_pressure_campaign",
      directSourceIds: ["trump-fm-117134622109680955", "trump-fm-117134600045602327"],
    },
    {
      figureId: "changpeng-zhao",
      topicType: "tokenization_advocacy",
      directSourceIds: ["x-2090590687657922579"],
    },
  ];
  for (const assignment of assignments) {
    const figure = legacy.figures.find((item) => item.id === assignment.figureId);
    const target = figure.themes.find((theme) => theme.topicType === assignment.topicType);
    const impact = target.marketImpact;
    const reactionSources = new Set(impact.reactions.map((reaction) => reaction.sourceId));
    target.sourceIds = target.sourceIds.filter((sourceId) => !reactionSources.has(sourceId) || assignment.directSourceIds.includes(sourceId));
    target.evidence = target.evidence.filter((item) => !reactionSources.has(item.id) || assignment.directSourceIds.includes(item.id));
    delete target.marketImpact;
    figure.themes.push({
      id: "market-impact-events",
      topicType: "market_impact_events",
      sourceIds: [...reactionSources],
      evidence: impact.reactions.map((reaction) => ({ id: reaction.sourceId })),
      lastVerifiedAt: impact.lastVerifiedAt,
      historyDays: impact.historyDays,
      story: {
        dataMode: "event-market",
        primaryReactionId: impact.primaryReactionId,
        marketReactions: impact.reactions,
      },
    });
  }
  return legacy;
}
