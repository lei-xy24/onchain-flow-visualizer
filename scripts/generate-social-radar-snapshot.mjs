#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPublishedSnapshot,
  floorToPublishSlot,
  groundModelOutput,
  marketMetricCatalog,
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
const socialFile = resolveFile(args.input || process.env.SOCIAL_INPUT_FILE || (args.demo ? "scripts/demo-social-radar-input.json" : config.sourceFile));
const marketFile = resolveFile(args.market || process.env.MARKET_INPUT_FILE || (args.demo ? "scripts/demo-market-input.json" : config.marketFile));
const outputDirectory = resolveFile(config.outputDirectory);
const latestFile = resolveFile(config.publicLatestFile);
const indexFile = resolveFile(config.publicIndexFile);
const slot = args.slot ? new Date(args.slot) : floorToPublishSlot(new Date(), config.schedule);

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

let modelOutput = groundModelOutput(
  args.demo
    ? await readJson(path.join(root, "scripts/demo-social-radar-output.json"))
    : await generateWithDeepSeek({ modelName, socialInput, marketInput, config }),
  marketInput,
);

let modelErrors = validateModelOutput(modelOutput, socialInput, marketInput, config);
if (modelErrors.length && !args.demo) {
  console.warn(`DeepSeek 首次候选未通过校验，正在自动修复一次：${modelErrors.join("；")}`);
  modelOutput = groundModelOutput(
    await generateWithDeepSeek({ modelName, socialInput, marketInput, config, validationErrors: modelErrors }),
    marketInput,
  );
  modelErrors = validateModelOutput(modelOutput, socialInput, marketInput, config);
}
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

async function generateWithDeepSeek({ modelName, socialInput, marketInput, config, validationErrors = [] }) {
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
              task: validationErrors.length
                ? "上一次候选没有通过事实校验。请根据校验反馈从原始输入重新生成完整结果，不要复述错误内容。"
                : "仅根据每位人物最近 7 天的公开动态，归纳其近期反复讨论的真实主题，并为每个主题组织四章故事。不要为了使用市场数据而把无关主题包装成区块链话题。",
              validationFeedback: validationErrors,
              allowedMarketTopicTypes: Object.keys(marketInput.topics),
              figures: socialInput.figures.map((figure) => ({ id: figure.id, name: figure.name, sources: figure.sources })),
              marketContext: Object.fromEntries(Object.entries(marketInput.topics).map(([topicType, market]) => [
                topicType,
                { ...market, watchMetricOptions: marketMetricCatalog(market) },
              ])),
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
    "你是公开动态主题分析产品的事实编辑。输出语言为简体中文。",
    "只允许使用输入里出现的 figure id、source id 和 marketContext 数值，不得补充外部事实或猜测人物立场。",
    `每位人物输出 1 至 ${config.maxTopicsPerFigure} 个宽泛主题，每个主题至少引用 ${config.minEvidencePerTopic} 条独立证据。`,
    "topicType 是稳定、唯一的英文 snake_case 主题标识。只有主题本身直接讨论对应区块链市场时，才能使用 allowedMarketTopicTypes 中的标识并把 dataMode 设为 market。",
    "关税、选举、宏观经济、航天、纯 AI、企业产品、一般网络安全等主题不得映射成支付、公链、AI × Crypto、隐私资产等市场模板；这些主题必须使用自己的 topicType，并把 dataMode 设为 evidence。",
    "sourceIds 与 evidenceSummaries 必须一一对应，摘要只能归纳所引用文本。",
    "故事四章必须依次为 signal、trend、ranking、watch，并且四章始终围绕同一个真实主题。",
    "dataMode=market 时，trend 和 ranking 可以解释该 topicType 的 marketContext，但不得自行生成数字。",
    "dataMode=evidence 时，trend 只分析公开动态在时间上的持续性与变化，ranking 只比较证据中的关键词或子议题优先级，严禁提及无关公链、代币、市值、市场排名或链上趋势。",
    "输入只包含公开动态。原创和引用动态权重较高，回复只能作为辅助证据；不得把发帖或引用表述成投资、合作、支持或背书。",
    "dataMode=market 时，每个 watch 返回 title、metricRef、detail、tone；metricRef 必须逐字选择对应 marketContext 的 watchMetricOptions.ref，禁止输出 metric 或 focus。",
    "dataMode=evidence 时，每个 watch 返回 title、focus、detail、tone；focus 是简短的后续观察维度，禁止输出 metricRef、metric 或任何输入中不存在的数字。",
    "如果人物关注的话题与区块链无关，也必须如实分析该话题，不得省略，更不得生搬硬套区块链数据。",
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
