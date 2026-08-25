import { EVENT_ASSETS } from "./event-market-lib.mjs";

export const IMPACT_CHANNELS = Object.freeze([
  "macro_risk",
  "geopolitical",
  "regulation_policy",
  "election_policy",
  "financial_liquidity",
  "crypto_infrastructure",
  "exchange_platform",
  "protocol_technology",
  "corporate_adoption",
  "other",
]);

const LOW_INFORMATION = /^(?:@[\w.-]+\s*){1,4}(?:https?:\/\/\S+\s*)?$/i;

export function prepareEventImpactInput(socialInput, { maxSourcesPerFigure = 40, maxTextLength = 600, analysisWindowHours = 168 } = {}) {
  const windowEnd = new Date(socialInput?.windowEnd || new Date());
  const cutoff = windowEnd.getTime() - analysisWindowHours * 36e5;
  const figures = (socialInput?.figures || []).map((figure) => {
    const sources = (figure.sources || [])
      .filter((source) => source?.type === "post" && source.kind !== "retweet")
      .filter((source) => {
        const time = new Date(source.publishedAt).getTime();
        return Number.isFinite(time) && time >= cutoff && time <= windowEnd.getTime();
      })
      .filter((source) => !isLowInformationSource(source))
      .sort((left, right) => new Date(right.publishedAt) - new Date(left.publishedAt))
      .slice(0, maxSourcesPerFigure)
      .map((source) => ({
        id: source.id,
        kind: source.kind || "original",
        publishedAt: source.publishedAt,
        title: cleanText(source.title, maxTextLength),
        text: cleanText(source.text, maxTextLength),
      }));
    return { id: figure.id, name: figure.name, nameZh: figure.nameZh, sources };
  }).filter((figure) => figure.sources.length);
  return { windowStart: new Date(cutoff).toISOString(), windowEnd: windowEnd.toISOString(), figures };
}

export function validateEventImpactCandidates(candidate, socialInput, { maxEventsPerFigure = 5 } = {}) {
  const errors = [];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return ["事件候选必须是对象"];
  if (!Array.isArray(candidate.events)) return ["事件候选缺少 events 数组"];
  const assetIds = new Set(EVENT_ASSETS.map((item) => item.id));
  const sourceMap = new Map();
  for (const figure of socialInput?.figures || []) {
    for (const source of figure.sources || []) sourceMap.set(`${figure.id}:${source.id}`, source);
  }
  const eventIds = new Set();
  const counts = new Map();
  for (const [index, event] of candidate.events.entries()) {
    const label = `events[${index}]`;
    if (!event || typeof event !== "object" || Array.isArray(event)) { errors.push(`${label} 必须是对象`); continue; }
    const key = `${event.figureId}:${event.sourceId}`;
    if (!sourceMap.has(key)) errors.push(`${label} 引用了不存在的公开动态 ${key}`);
    if (eventIds.has(key)) errors.push(`${label} 重复引用公开动态 ${key}`);
    eventIds.add(key);
    counts.set(event.figureId, (counts.get(event.figureId) || 0) + 1);
    if (counts.get(event.figureId) > maxEventsPerFigure) errors.push(`${event.figureId} 的事件候选超过 ${maxEventsPerFigure} 条`);
    if (!IMPACT_CHANNELS.includes(event.impactChannel)) errors.push(`${label} 影响路径无效`);
    if (!['high', 'medium'].includes(event.relevance)) errors.push(`${label} 相关性必须为 high 或 medium`);
    if (!['high', 'medium'].includes(event.confidence)) errors.push(`${label} 置信度必须为 high 或 medium`);
    if (!isNonEmptyString(event.eventSummary) || !isNonEmptyString(event.rationale)) errors.push(`${label} 缺少事件摘要或影响理由`);
    if (!Array.isArray(event.candidateAssetIds) || !event.candidateAssetIds.length || event.candidateAssetIds.length > 4) errors.push(`${label} 候选资产数量必须为 1 至 4 个`);
    for (const assetId of event.candidateAssetIds || []) if (!assetIds.has(assetId)) errors.push(`${label} 使用了未知资产 ${assetId}`);
  }
  return errors;
}

export function enrichEventImpactCandidates(candidate, socialInput, generatedAt = new Date().toISOString()) {
  const figureMap = new Map((socialInput?.figures || []).map((figure) => [figure.id, figure]));
  return {
    schemaVersion: 1,
    generatedAt,
    events: (candidate?.events || []).map((event) => {
      const figure = figureMap.get(event.figureId);
      const source = figure?.sources.find((item) => item.id === event.sourceId);
      return {
        ...event,
        eventAt: source.publishedAt,
        eventTitle: event.eventSummary || source.title,
        platform: source.platform || "公开动态",
        url: source.url || null,
      };
    }),
  };
}

export function buildEventImpactPrompt(input, validationErrors = []) {
  return {
    task: validationErrors.length
      ? "上一次事件候选未通过校验。根据反馈从原始动态重新生成完整 events 数组。"
      : "从公开动态中识别可能通过明确路径影响加密市场的事件，并在查看任何价格数据之前指定候选资产。允许事件本身与区块链无关。",
    validationFeedback: validationErrors,
    rules: [
      "只选择有清晰市场传导路径的政策、宏观、地缘、监管、金融流动性、协议技术、交易平台、基础设施或企业采用事件。",
      "一般闲聊、回复用户名、网址、没有实质信息的产品宣传和单纯表达态度不得成为事件。",
      "用户名中的词不等于资产提及，例如 @cb_doge 不能据此判定 DOGE。",
      "candidateAssetIds 必须在看到价格前基于事件影响路径选择；不要为了覆盖而列出所有资产，每个事件最多 4 个。",
      "不能解释为加密市场影响的动态应完全省略；允许 events 为空数组。",
      "不要判断价格是否上涨或下跌，不要输出行情、收益率或成交量结论。",
    ],
    allowedImpactChannels: IMPACT_CHANNELS,
    allowedAssets: EVENT_ASSETS.map(({ id, symbol, name }) => ({ id, symbol, name })),
    outputShape: {
      events: [{ figureId: "人物 id", sourceId: "动态 id", relevance: "high|medium", impactChannel: "允许的影响路径", candidateAssetIds: ["允许的资产 id"], eventSummary: "简洁中文摘要", rationale: "为什么可能传导到这些资产", confidence: "high|medium" }],
    },
    figures: input.figures,
  };
}

function isLowInformationSource(source) {
  const combined = `${source.title || ""} ${source.text || ""}`.trim();
  const cleaned = combined.replace(/https?:\/\/\S+/gi, "").replace(/@[\w.-]+/g, "").trim();
  return !cleaned || LOW_INFORMATION.test(combined) || cleaned.length < 12;
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/https?:\/\/\S+/gi, "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function isNonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }
