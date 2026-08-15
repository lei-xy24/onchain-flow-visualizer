#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, requireHttpsBaseUrl, writeJsonAtomic } from "./social-radar-lib.mjs";
import { mergeRecentPostSources, newestPostId, normalizeXHandle, xPostToSource } from "./x-posts-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = await readJson(path.join(root, "social-radar.config.json"));
const token = process.env.X_BEARER_TOKEN;
if (!token) throw new Error("缺少 X_BEARER_TOKEN，无法读取 X 公开动态");

const inputFile = resolveFile(process.env.SOCIAL_INPUT_FILE || config.sourceFile);
const stateFile = resolveFile(process.env.X_STATE_FILE || config.xStateFile);
const apiBaseUrl = requireHttpsBaseUrl(
  process.env.X_API_BASE_URL || config.xApiBaseUrl || "https://api.x.com",
  "X API 地址",
);
const input = await readJson(inputFile);
const state = await readOptionalJson(stateFile, { schemaVersion: 1, users: {} });
const now = new Date();
const cutoff = new Date(now.getTime() - config.analysisWindowHours * 36e5);

const figureHandles = input.figures.flatMap((figure) => {
  const account = figure.accounts?.find((item) => item.platform === "X");
  if (!account) return [];
  const username = normalizeXHandle(account?.handle);
  if (!username) throw new Error(`${figure.id} 没有配置 X 用户名`);
  return [{ figure, account, username }];
});
if (!figureHandles.length) throw new Error("社交输入没有需要通过 X API 采集的人物");
const usernamesToLookup = figureHandles
  .filter(({ figure, username }) => {
    const cached = state.users[figure.id];
    return !cached?.xUserId || normalizeXHandle(cached.username) !== username;
  })
  .map((item) => item.username);
const userProfiles = usernamesToLookup.length ? await lookupUsers(usernamesToLookup) : new Map();

const collectedFigures = await Promise.all(figureHandles.map(async ({ figure, account, username }) => {
  const cached = state.users[figure.id];
  const profile = userProfiles.get(username) || (cached?.xUserId ? { id: cached.xUserId, username: cached.username } : null);
  if (!profile) throw new Error(`X 没有返回 @${username} 的用户资料`);
  const previous = state.users[figure.id] || {};
  const posts = await fetchNewPosts(profile.id, previous.sinceId);
  const freshSources = posts.map((post) => xPostToSource(post, profile.username)).filter((source) => source.kind !== "retweet");
  const existingSources = (figure.sources || []).filter((source) => source.provider === "x-api" || /^x-\d+$/.test(source.id));
  const sources = mergeRecentPostSources(existingSources, freshSources, cutoff);
  state.users[figure.id] = {
    xUserId: profile.id,
    username: profile.username,
    sinceId: newestPostId(posts, previous.sinceId),
    lastCheckedAt: now.toISOString(),
  };
  return {
    ...figure,
    accounts: figure.accounts.map((item) => item === account ? { ...item, handle: `@${profile.username}`, userId: profile.id } : item),
    followingCount: undefined,
    sources,
  };
}));

const collectedById = new Map(collectedFigures.map((figure) => [figure.id, figure]));
await writeJsonAtomic(inputFile, {
  ...input,
  collectedAt: now.toISOString(),
  windowStart: cutoff.toISOString(),
  windowEnd: now.toISOString(),
  mode: input.figures.some((figure) => !figure.accounts?.some((account) => account.platform === "X"))
    ? "mixed-social-api"
    : "x-posts-api",
  figures: input.figures.map((figure) => removeUndefined(collectedById.get(figure.id) || figure)),
});
await writeJsonAtomic(stateFile, { ...state, schemaVersion: 1, updatedAt: now.toISOString() });
console.log(`X 动态采集完成：${collectedFigures.length} 位人物，${collectedFigures.reduce((sum, figure) => sum + figure.sources.length, 0)} 条近 7 天动态`);

async function lookupUsers(usernames) {
  const url = new URL(`${apiBaseUrl}/2/users/by`);
  url.searchParams.set("usernames", usernames.join(","));
  url.searchParams.set("user.fields", "id,name,username,profile_image_url,description,public_metrics,verified");
  const payload = await xRequest(url);
  return new Map((payload.data || []).map((user) => [normalizeXHandle(user.username), user]));
}

async function fetchNewPosts(userId, sinceId) {
  const allPosts = [];
  let paginationToken = null;
  for (let page = 0; page < (config.xMaxPagesPerRun || 3); page += 1) {
    const url = new URL(`${apiBaseUrl}/2/users/${userId}/tweets`);
    url.searchParams.set("max_results", String(config.xMaxPostsPerRequest || 100));
    url.searchParams.set("exclude", "retweets");
    url.searchParams.set("tweet.fields", "id,text,created_at,lang,public_metrics,entities,context_annotations,referenced_tweets");
    if (sinceId) url.searchParams.set("since_id", String(sinceId));
    else url.searchParams.set("start_time", cutoff.toISOString());
    if (paginationToken) url.searchParams.set("pagination_token", paginationToken);
    const payload = await xRequest(url);
    allPosts.push(...(payload.data || []));
    paginationToken = payload.meta?.next_token;
    if (!paginationToken) break;
  }
  return allPosts;
}

async function xRequest(url) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`X API ${response.status}：${payload.detail || payload.title || "请求失败"}`);
  return payload;
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
