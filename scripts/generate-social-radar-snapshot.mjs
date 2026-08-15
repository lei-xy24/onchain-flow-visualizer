#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPublishedSnapshot,
  floorToThreeHourSlot,
  publishSnapshot,
  readJson,
  requireHttpsBaseUrl,
  snapshotIdFor,
  validateMarketInput,
  validateModelOutput,
  validateSnapshot,
  writeJsonAtomic,
} from "./social-radar-lib.mjs";
import { radarOutputSchema } from "./social-radar-schema.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const config = await readJson(path.join(root, "social-radar.config.json"));
const socialFile = resolveFile(args.input || process.env.SOCIAL_INPUT_FILE || config.sourceFile);
const marketFile = resolveFile(args.market || process.env.MARKET_INPUT_FILE || config.marketFile);
const outputDirectory = resolveFile(config.outputDirectory);
const latestFile = resolveFile(config.publicLatestFile);
const indexFile = resolveFile(config.publicIndexFile);
const slot = args.slot ? new Date(args.slot) : floorToThreeHourSlot(new Date());

if (Number.isNaN(slot.getTime())) throw new Error(`无效的 --slot：${args.slot}`);

const [rawSocialInput, marketInput] = await Promise.all([readJson(socialFile), readJson(marketFile)]);
const socialInput = normalizeSocialInput(rawSocialInput, config.analysisWindowHours);
const marketErrors = validateMarketInput(marketInput);
if (marketErrors.length) throw new Error(`市场输入校验失败：${marketErrors.join("；")}`);
const previousSnapshot = await readOptionalJson(latestFile);
const generatedAt = args.generatedAt
  ? new Date(args.generatedAt).toISOString()
  : args.demo
    ? new Date(slot.getTime() + 6 * 60_000).toISOString()
    : new Date().toISOString();
const modelName = process.env.DEEPSEEK_MODEL || config.model;

const modelOutput = args.demo
  ? await readJson(path.join(root, "scripts/demo-social-radar-output.json"))
  : await generateWithDeepSeek({ modelName, socialInput, marketInput, config });

const modelErrors = validateModelOutput(modelOutput, socialInput, marketInput, config);
if (modelErrors.length) await rejectCandidate("model-output", modelOutput, modelErrors);

const snapshot = buildPublishedSnapshot({
  config,
  socialInput,
  marketInput,
  modelOutput,
  previousSnapshot,
  slot,
  generatedAt,
  modelName,
  isDemo: Boolean(args.demo),
});
const snapshotErrors = validateSnapshot(snapshot);
if (snapshotErrors.length) await rejectCandidate("snapshot", snapshot, snapshotErrors);

if (args.noPublish) {
  const candidateFile = path.join(root, "work/social-radar", `${snapshot.snapshotId}.candidate.json`);
  await writeJsonAtomic(candidateFile, snapshot);
  console.log(`候选快照已通过校验：${path.relative(root, candidateFile)}`);
} else {
  const result = await publishSnapshot({ snapshot, outputDirectory, publicLatestFile: latestFile, publicIndexFile: indexFile });
  console.log(`已发布快照 ${snapshot.snapshotId}（${snapshot.figures.length} 位人物，历史版本 ${result.indexCount} 份）`);
}

async function generateWithDeepSeek({ modelName, socialInput, marketInput, config }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("缺少 DEEPSEEK_API_KEY；本地演示请使用 --demo");
  const baseUrl = requireHttpsBaseUrl(
    process.env.DEEPSEEK_BASE_URL || config.apiBaseUrl || "https://api.deepseek.com",
    "DeepSeek API 地址",
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelName,
        messages: [
          {
            role: "system",
            content: `${buildInstructions(config)}\n必须只返回 JSON 对象，不要 Markdown。输出必须符合下面的 JSON Schema：\n${JSON.stringify(radarOutputSchema)}`,
          },
          {
            role: "user",
            content: JSON.stringify({
              task: "仅根据每位人物最近 7 天的公开动态，归纳其近期反复讨论的宽泛技术或市场概念，并为每个概念组织四章数据故事，以 JSON 格式返回。",
              allowedTopicTypes: Object.keys(marketInput.topics),
              figures: socialInput.figures.map((figure) => ({ id: figure.id, name: figure.name, sources: figure.sources })),
              marketContext: marketInput.topics,
            }),
          },
        ],
        response_format: { type: "json_object" },
        thinking: { type: "disabled" },
        temperature: 0.2,
        max_tokens: 20_000,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`DeepSeek API ${response.status}：${payload.error?.message || "请求失败"}`);
    const choice = payload.choices?.[0];
    if (choice?.finish_reason === "length") throw new Error("DeepSeek 输出达到长度上限，候选快照不发布");
    const outputText = choice?.message?.content;
    if (!outputText?.trim()) throw new Error("DeepSeek 返回了空内容，候选快照不发布");
    try {
      return JSON.parse(outputText);
    } catch (error) {
      throw new Error(`DeepSeek 返回的 JSON 无法解析：${error.message}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function buildInstructions(config) {
  return [
    "你是链上数据产品的事实编辑。输出语言为简体中文。",
    "只允许使用输入里出现的 figure id、source id 和 marketContext 数值，不得补充外部事实或猜测人物立场。",
    `每位人物输出 1 至 ${config.maxTopicsPerFigure} 个宽泛主题，每个主题至少引用 ${config.minEvidencePerTopic} 条独立证据。`,
    "主题必须映射到 allowedTopicTypes；无法映射时使用 other，但 other 会被发布程序拒绝。",
    "sourceIds 与 evidenceSummaries 必须一一对应，摘要只能归纳所引用文本。",
    "故事四章必须依次为 signal、trend、ranking、watch；指标、趋势和排名只解释 marketContext，不得自行生成数字。",
    "输入只包含公开动态。原创和引用动态权重较高，回复只能作为辅助证据；不得把发帖或引用表述成投资、合作、支持或背书。",
    "watch 的 metric 可以使用 marketContext 已有数值，或使用不含虚构数字的状态词。",
  ].join("\n");
}

function normalizeSocialInput(input, analysisWindowHours) {
  if (!Array.isArray(input.figures) || !input.figures.length) throw new Error("社交输入缺少 figures");
  const windowEnd = new Date(input.windowEnd || new Date());
  const cutoff = windowEnd.getTime() - analysisWindowHours * 36e5;
  const figures = input.figures.map((figure) => {
    const ids = new Set();
    const sources = (figure.sources || [])
      .filter((source) => source && typeof source === "object" && !Array.isArray(source))
      .filter((source) => {
        const time = new Date(source.publishedAt).getTime();
        return Number.isFinite(time) && time >= cutoff && time <= windowEnd.getTime();
      })
      .filter((source) => {
        if (!source.id || ids.has(source.id)) return false;
        ids.add(source.id);
        return source.type === "post" && source.kind !== "retweet";
      })
      .sort((left, right) => new Date(right.publishedAt) - new Date(left.publishedAt));
    return { ...figure, sources: sources.map((source) => ({ ...source, kind: source.kind || "original", weight: source.weight ?? (source.kind === "reply" ? 0.5 : 1) })) };
  }).filter((figure) => figure.sources.length >= config.minEvidencePerTopic);
  if (!figures.length) throw new Error(`最近 ${analysisWindowHours} 小时没有人物达到 ${config.minEvidencePerTopic} 条公开动态，保留上一份快照`);
  return {
    ...input,
    windowStart: new Date(cutoff).toISOString(),
    windowEnd: windowEnd.toISOString(),
    figures,
  };
}

async function rejectCandidate(stage, value, errors) {
  const rejectedDirectory = path.join(root, "work/social-radar/rejected");
  await mkdir(rejectedDirectory, { recursive: true });
  const file = path.join(rejectedDirectory, `${snapshotIdFor(slot)}-${stage}.json`);
  await writeJsonAtomic(file, { stage, errors, value });
  throw new Error(`候选快照未发布：${errors.join("；")}（详情：${path.relative(root, file)}）`);
}

async function readOptionalJson(file) {
  try { return await readJson(file); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function resolveFile(value) {
  return path.isAbsolute(value) ? value : path.join(root, value);
}

function parseArgs(values) {
  return values.reduce((result, value) => {
    if (value === "--demo") result.demo = true;
    else if (value === "--no-publish") result.noPublish = true;
    else if (value.startsWith("--slot=")) result.slot = value.slice(7);
    else if (value.startsWith("--generated-at=")) result.generatedAt = value.slice(15);
    else if (value.startsWith("--input=")) result.input = value.slice(8);
    else if (value.startsWith("--market=")) result.market = value.slice(9);
    else throw new Error(`未知参数：${value}`);
    return result;
  }, {});
}
