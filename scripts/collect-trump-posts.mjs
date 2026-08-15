#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, requireHttpsBaseUrl, writeJsonAtomic } from "./social-radar-lib.mjs";
import { mergeRecentPostSources } from "./x-posts-lib.mjs";
import {
  buildTrumpFmPostsUrl,
  newestTrumpFmPostId,
  shouldStopTrumpFmPagination,
  trumpFmPostToSource,
} from "./trump-fm-posts-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = await readJson(path.join(root, "social-radar.config.json"));
const inputFile = resolveFile(process.env.SOCIAL_INPUT_FILE || config.sourceFile);
const stateFile = resolveFile(process.env.TRUMP_FM_STATE_FILE || config.trumpFmStateFile);
const baseUrl = requireHttpsBaseUrl(
  process.env.TRUMP_FM_BASE_URL || config.trumpFmBaseUrl || "https://trump.fm",
  "trump.fm API 地址",
);
const input = await readJson(inputFile);
const state = await readOptionalJson(stateFile, { schemaVersion: 1 });
const now = new Date();
const cutoff = new Date(now.getTime() - config.analysisWindowHours * 36e5);
const figureId = config.trumpFmFigureId || "donald-trump";
const figure = input.figures.find((item) => item.id === figureId);
if (!figure) throw new Error(`社交输入缺少 trump.fm 人物 ${figureId}`);
const account = figure.accounts?.find((item) => item.provider === "trump.fm" || item.platform === "Truth Social");
if (!account) throw new Error(`${figureId} 没有配置 trump.fm / Truth Social 账号`);

const posts = await fetchPosts(state.sinceId);
const freshSources = posts
  .map((post) => trumpFmPostToSource(post))
  .filter((source) => source && source.kind !== "retweet");
const existingSources = (figure.sources || []).filter((source) => source.provider === "trump.fm");
const sources = mergeRecentPostSources(existingSources, freshSources, cutoff)
  .slice(0, config.trumpFmMaxSources || 80);
if (sources.length < config.minEvidencePerTopic) {
  throw new Error(`trump.fm 最近 ${config.analysisWindowHours} 小时只有 ${sources.length} 条可用原创动态，保留上一份输入`);
}

const figures = input.figures.map((item) => item.id === figureId
  ? {
      ...item,
      accounts: item.accounts.map((candidate) => candidate === account
        ? { ...candidate, platform: "Truth Social", handle: "@realDonaldTrump", provider: "trump.fm", archiveUrl: "https://trump.fm/" }
        : candidate),
      followingCount: undefined,
      sources,
    }
  : item);

await writeJsonAtomic(inputFile, removeUndefined({
  ...input,
  collectedAt: now.toISOString(),
  windowStart: cutoff.toISOString(),
  windowEnd: now.toISOString(),
  mode: "mixed-social-api",
  figures,
}));
await writeJsonAtomic(stateFile, {
  schemaVersion: 1,
  provider: "trump.fm",
  sinceId: newestTrumpFmPostId(posts, state.sinceId),
  lastCheckedAt: now.toISOString(),
});
console.log(`trump.fm 动态采集完成：${posts.length} 条返回记录，保留 ${sources.length} 条近 7 天原创动态`);

async function fetchPosts(sinceId) {
  const allPosts = [];
  let cursor = null;
  const seenCursors = new Set();
  for (let page = 0; page < (config.trumpFmMaxPagesPerRun || 8); page += 1) {
    const url = buildTrumpFmPostsUrl(baseUrl, {
      limit: config.trumpFmMaxPostsPerRequest || 100,
      cursor,
    });
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json", "User-Agent": "onchain-social-radar/1.0" },
      signal: AbortSignal.timeout(60_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`trump.fm API ${response.status}：${payload.error || "请求失败"}`);
    if (!Array.isArray(payload.data)) throw new Error("trump.fm API 返回格式错误：缺少 data 数组");
    allPosts.push(...payload.data);
    if (shouldStopTrumpFmPagination(payload.data, { cutoff, sinceId }) || !payload.meta?.hasMore) break;
    const nextCursor = payload.meta?.cursor;
    if (!nextCursor || seenCursors.has(nextCursor)) break;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  return allPosts;
}

async function readOptionalJson(file, fallback) {
  try { return await readJson(file); } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function resolveFile(value) {
  return path.isAbsolute(value) ? value : path.join(root, value);
}

function removeUndefined(value) {
  return JSON.parse(JSON.stringify(value));
}
