#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateSnapshot } from "./social-radar-lib.mjs";

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOT_COLLECTED_NOTICE = "当期未采集事件行情";
const TARGET_IDS = Object.freeze(["20260817T000000Z", "20260824T000000Z"]);

export function migrateHistoricalSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new Error("历史快照必须是对象");
  const migrated = structuredClone(snapshot);

  if (migrated.snapshotId === "20260817T000000Z") {
    migrated.eventMarketMode = "not-collected";
    migrated.eventMarketNotice = NOT_COLLECTED_NOTICE;
  } else if (migrated.snapshotId === "20260824T000000Z") {
    migrated.figures = (migrated.figures || []).map(migrateFigureLegacyMarketImpact);
    migrated.eventMarketNotice = "历史事件行情已由快照内缓存离线迁移，未重新请求外部数据";
  } else {
    throw new Error(`不支持迁移历史快照 ${migrated.snapshotId || "（无 id）"}`);
  }

  migrated.digest = digestSnapshot(migrated);
  const errors = validateSnapshot(migrated);
  if (errors.length) throw new Error(`${migrated.snapshotId} 迁移后校验失败：${errors.join("；")}`);
  return migrated;
}

export async function migratePublishedHistory({ root = scriptRoot, checkOnly = false } = {}) {
  const repositoryRoot = path.resolve(root);
  const publicData = path.join(repositoryRoot, "static-site/data");
  const indexFile = path.join(publicData, "snapshot-index.json");
  const index = await readJson(indexFile);
  const migratedById = new Map();

  for (const id of TARGET_IDS) {
    const file = path.join(publicData, "snapshots", `${id}.json`);
    const migrated = migrateHistoricalSnapshot(await readJson(file));
    migratedById.set(id, migrated);
  }

  const nextIndex = structuredClone(index);
  nextIndex.snapshots = (nextIndex.snapshots || []).map((entry) => {
    const snapshot = migratedById.get(entry.id);
    return snapshot ? { ...entry, digest: snapshot.digest } : entry;
  });
  for (const id of TARGET_IDS) {
    if (!nextIndex.snapshots.some((entry) => entry.id === id)) throw new Error(`快照索引缺少 ${id}`);
  }
  const latest = migratedById.get(nextIndex.latest);
  if (!latest) throw new Error(`本次迁移未包含索引 latest ${nextIndex.latest}`);

  const result = {
    status: checkOnly ? "validated" : "migrated",
    snapshots: [...migratedById.values()].map((snapshot) => ({ id: snapshot.snapshotId, digest: snapshot.digest })),
    latest: latest.snapshotId,
  };
  if (checkOnly) return result;

  for (const [id, snapshot] of migratedById) {
    const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
    await Promise.all([
      atomicWrite(path.join(repositoryRoot, "static-site/data/snapshots", `${id}.json`), serialized),
      atomicWrite(path.join(repositoryRoot, "data/snapshots", `${id}.json`), serialized),
    ]);
  }
  const latestSerialized = `${JSON.stringify(latest, null, 2)}\n`;
  const indexSerialized = `${JSON.stringify(nextIndex, null, 2)}\n`;
  await Promise.all([
    atomicWrite(path.join(repositoryRoot, "static-site/data/latest-snapshot.json"), latestSerialized),
    atomicWrite(path.join(repositoryRoot, "data/latest-snapshot.json"), latestSerialized),
    atomicWrite(path.join(repositoryRoot, "static-site/data/snapshot-index.json"), indexSerialized),
    atomicWrite(path.join(repositoryRoot, "data/snapshot-index.json"), indexSerialized),
  ]);
  return result;
}

function migrateFigureLegacyMarketImpact(figure) {
  const themes = Array.isArray(figure?.themes) ? figure.themes : [];
  const legacyThemes = themes.filter(isLegacyMarketTheme);
  const realThemes = themes.filter((theme) => !isLegacyMarketTheme(theme));
  if (!legacyThemes.length) return figure;
  if (!realThemes.length) throw new Error(`${figure.id} 只有旧版行情主题，无法归属`);

  const migratedThemes = realThemes.map((theme) => structuredClone(theme));
  const assignments = new Map(migratedThemes.map((_, index) => [index, []]));
  const metadataByReaction = new Map();

  for (const legacyTheme of legacyThemes) {
    const reactions = Array.isArray(legacyTheme.story?.marketReactions) ? legacyTheme.story.marketReactions : [];
    const legacySourceIds = themeSourceIds(legacyTheme);
    const unresolved = [];

    for (const reaction of reactions) {
      const exact = migratedThemes
        .map((theme, index) => (themeSourceIds(theme).has(reaction.sourceId) ? index : -1))
        .filter((index) => index >= 0);
      if (exact.length > 1) throw new Error(`${figure.id}/${reaction.id} 同时命中多个真实主题`);
      if (exact.length === 1) assignments.get(exact[0]).push(reaction);
      else unresolved.push(reaction);
      metadataByReaction.set(reaction.id, legacyTheme);
    }

    if (unresolved.length) {
      const ranked = migratedThemes.map((theme, index) => ({
        index,
        overlap: [...themeSourceIds(theme)].filter((sourceId) => legacySourceIds.has(sourceId)).length,
      })).sort((left, right) => right.overlap - left.overlap);
      const best = ranked[0];
      if (!best?.overlap || ranked[1]?.overlap === best.overlap) {
        throw new Error(`${figure.id}/${legacyTheme.id} 的 ${unresolved.length} 条行情无法唯一归属真实主题`);
      }
      assignments.get(best.index).push(...unresolved);
    }
  }

  return {
    ...figure,
    themes: migratedThemes.map((theme, index) => {
      const assigned = deduplicateReactions(assignments.get(index));
      if (!assigned.length) return theme;
      const sourceIds = [...new Set([...(theme.sourceIds || []), ...assigned.map((reaction) => reaction.sourceId)])];
      const reactions = assigned
        .map((reaction) => ({ ...reaction, isCurrentWindow: true }))
        .sort((left, right) => new Date(right.eventAt) - new Date(left.eventAt));
      const primaryFromLegacy = reactions.find((reaction) => metadataByReaction.get(reaction.id)?.story?.primaryReactionId === reaction.id);
      const metadata = metadataByReaction.get((primaryFromLegacy || reactions[0]).id);
      return {
        ...theme,
        sourceIds,
        marketImpact: {
          version: 1,
          status: marketImpactStatus(reactions),
          primaryReactionId: (primaryFromLegacy || reactions[0]).id,
          lastVerifiedAt: metadata?.lastVerifiedAt || metadata?.story?.lastVerifiedAt || null,
          historyDays: metadata?.historyDays || 90,
          reactions,
          unavailableEvents: [],
          derivedFromLegacyTheme: true,
        },
      };
    }),
  };
}

function isLegacyMarketTheme(theme) {
  return theme?.topicType === "market_impact_events" || theme?.story?.dataMode === "event-market";
}

function themeSourceIds(theme) {
  return new Set([...(theme?.sourceIds || []), ...(theme?.evidence || []).map((item) => item.id)].filter(Boolean));
}

function deduplicateReactions(reactions) {
  const unique = new Map();
  for (const reaction of reactions || []) {
    if (!reaction?.id) throw new Error("旧版行情包含无 id 记录");
    if (unique.has(reaction.id)) throw new Error(`旧版行情 id 重复：${reaction.id}`);
    unique.set(reaction.id, reaction);
  }
  return [...unique.values()];
}

function marketImpactStatus(reactions) {
  if (reactions.some((reaction) => reaction.significance?.level === "strong")) return "strong";
  if (reactions.some((reaction) => reaction.significance?.passed !== false)) return "notable";
  return "ordinary";
}

function digestSnapshot(snapshot) {
  const clone = structuredClone(snapshot);
  delete clone.digest;
  return createHash("sha256").update(JSON.stringify(clone)).digest("hex").slice(0, 16);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
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

function parseArgs(values) {
  const options = { checkOnly: false };
  for (const value of values) {
    if (value === "--check-only") options.checkOnly = true;
    else throw new Error(`未知参数：${value}`);
  }
  return options;
}

const invokedAsCli = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedAsCli) {
  migratePublishedHistory(parseArgs(process.argv.slice(2)))
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(`历史快照离线迁移失败：${error.message}`);
      process.exitCode = 1;
    });
}
