import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

export const MARKET_TOPIC_TYPES = ["stablecoin", "bitcoin", "ai_crypto", "payments", "layer2", "privacy", "chain_ecosystem", "defi"];
export const VIEWS = ["signal", "trend", "ranking", "watch"];
export const TONES = ["teal", "amber", "violet"];
export const WATCH_METRIC_REFS = [
  ...Array.from({ length: 3 }, (_, index) => [`metric-${index}-value`, `metric-${index}-change`]).flat(),
  ...Array.from({ length: 5 }, (_, index) => `ranking-${index}-display`),
];
const MARKET_TOPIC_PATTERNS = Object.freeze({
  stablecoin: /稳定币|数字美元|法币锚定|stablecoin|\busdc\b|\busdt\b/i,
  bitcoin: /比特币|bitcoin|\bbtc\b/i,
  ai_crypto: /ai\s*[×x+&]\s*(?:crypto|加密)|(?:人工智能|\bai\b).*(?:区块链|加密|链上)|(?:区块链|加密|链上).*(?:人工智能|\bai\b)/i,
  payments: /链上支付|加密支付|稳定币支付|数字资产支付|机器支付|区块链结算|crypto[_ -]?payments?/i,
  layer2: /layer\s*2|layer[_ -]?two|\bl2\b|rollup|zk[- ]?evm|blob|二层网络|二层扩容/i,
  privacy: /零知识|\bzk\b|隐私池|选择性披露|链上隐私|隐私增强技术|隐私币|privacy[_ -]?(?:tech|crypto|chain)/i,
  chain_ecosystem: /公链|区块链生态|链上生态|bnb\s*chain|solana|ethereum\s+ecosystem|以太坊生态|chain[_ -]?ecosystem/i,
  defi: /\bdefi\b|去中心化金融|去中心化交易|\bdex\b|链上借贷|流动性质押|\btvl\b/i,
});

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export function requireHttpsUrl(value, label = "接口地址") {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error(`${label} 不是有效 URL`);
  }
  if (url.protocol !== "https:") throw new Error(`${label} 必须使用 HTTPS`);
  if (url.username || url.password) throw new Error(`${label} 不能包含用户名或密码`);
  return url;
}

export function requireHttpsBaseUrl(value, label = "接口地址") {
  return requireHttpsUrl(value, label).toString().replace(/\/$/, "");
}

export function validateMarketInput(input) {
  const errors = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return ["市场输入必须是对象"];
  if (!input.topics || typeof input.topics !== "object" || Array.isArray(input.topics)) return ["市场输入缺少 topics 对象"];
  for (const topicType of MARKET_TOPIC_TYPES) {
    const market = input.topics[topicType];
    if (!market || typeof market !== "object" || Array.isArray(market)) {
      errors.push(`市场输入缺少 ${topicType}`);
      continue;
    }
    if (!isNonEmptyString(market.category)) errors.push(`${topicType}.category 无效`);
    if (!/^#[0-9a-f]{6}$/i.test(String(market.accent || ""))) errors.push(`${topicType}.accent 必须是六位十六进制颜色`);
    if (!Array.isArray(market.metrics) || market.metrics.length < 3) errors.push(`${topicType}.metrics 至少需要三个指标`);
    for (const [index, metric] of (Array.isArray(market.metrics) ? market.metrics : []).entries()) {
      if (!isNonEmptyString(metric?.label) || !isNonEmptyString(metric?.value) || !isNonEmptyString(metric?.change)) {
        errors.push(`${topicType}.metrics[${index}] 结构无效`);
      }
    }
    const points = market.trend?.points;
    if (!isNonEmptyString(market.trend?.label) || !isNonEmptyString(market.trend?.unit) || !Array.isArray(points) || points.length < 2) {
      errors.push(`${topicType}.trend 结构无效`);
    }
    for (const [index, point] of (Array.isArray(points) ? points : []).entries()) {
      if (!isNonEmptyString(point?.label) || !Number.isFinite(Number(point?.value))) errors.push(`${topicType}.trend.points[${index}] 无效`);
    }
    const rankingItems = market.ranking?.items;
    if (!isNonEmptyString(market.ranking?.label) || !Array.isArray(rankingItems) || !rankingItems.length) {
      errors.push(`${topicType}.ranking 结构无效`);
    }
    for (const [index, item] of (Array.isArray(rankingItems) ? rankingItems : []).entries()) {
      if (!isNonEmptyString(item?.name) || !isNonEmptyString(item?.display) || !Number.isFinite(Number(item?.value)) || Number(item.value) <= 0) {
        errors.push(`${topicType}.ranking.items[${index}] 无效`);
      }
    }
  }
  return errors;
}

export async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

export function floorToPublishSlot(date = new Date(), schedule = "0 */3 * * *") {
  const slot = new Date(date);
  if (schedule === "0 0 * * 1") {
    const daysSinceMonday = (slot.getUTCDay() + 6) % 7;
    slot.setUTCDate(slot.getUTCDate() - daysSinceMonday);
    slot.setUTCHours(0, 0, 0, 0);
    return slot;
  }
  slot.setUTCMinutes(0, 0, 0);
  slot.setUTCHours(Math.floor(slot.getUTCHours() / 3) * 3);
  return slot;
}

export function snapshotIdFor(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(".000Z", "Z").replace("T", "T");
}

export function calculateTopicScores(figure, topics, windowEnd, analysisWindowHours) {
  const sourceMap = new Map(figure.sources.map((source) => [source.id, source]));
  const scored = topics.map((topic) => {
    const sources = [...new Set(topic.sourceIds)].map((id) => sourceMap.get(id)).filter(Boolean);
    const originals = sources.filter((source) => (source.kind || "original") === "original").length;
    const quotes = sources.filter((source) => source.kind === "quote").length;
    const replies = sources.filter((source) => source.kind === "reply").length;
    const weightedCount = sources.reduce((sum, source) => sum + (source.weight ?? (source.kind === "reply" ? 0.5 : 1)), 0);
    const frequency = clamp(Math.round(30 + weightedCount * 16 + Math.min(topic.keywords.length, 6) * 3), 0, 100);
    const freshnessValues = sources.map((source) => {
      const ageHours = Math.max(0, (windowEnd.getTime() - new Date(source.publishedAt).getTime()) / 36e5);
      return { value: Math.max(0, 1 - ageHours / analysisWindowHours), weight: source.weight ?? (source.kind === "reply" ? 0.5 : 1) };
    });
    const freshnessWeight = freshnessValues.reduce((sum, item) => sum + item.weight, 0);
    const freshness = clamp(Math.round((freshnessValues.reduce((sum, item) => sum + item.value * item.weight, 0) / Math.max(1, freshnessWeight)) * 100), 0, 100);
    const activeDays = new Set(sources.map((source) => new Date(source.publishedAt).toISOString().slice(0, 10))).size;
    const postKinds = new Set(sources.map((source) => source.kind || "original")).size;
    const continuity = clamp(Math.round(28 + Math.min(activeDays, 4) * 16 + Math.min(postKinds, 3) * 6), 0, 100);
    const score = clamp(Math.round(frequency * 0.42 + freshness * 0.35 + continuity * 0.23), 0, 100);
    return {
      ...topic,
      sourceIds: sources.map((source) => source.id),
      score,
      scoreBreakdown: { frequency, freshness, continuity },
      evidenceBreakdown: { posts: sources.length, originals, quotes, replies, weightedCount },
    };
  });
  return scored.sort((left, right) => right.score - left.score);
}

export function deriveTrend(score, previousScore) {
  if (!Number.isFinite(previousScore)) return { change: 0, trend: "新出现" };
  const change = score - previousScore;
  if (change >= 12) return { change, trend: "快速升温" };
  if (change >= 4) return { change, trend: "升温" };
  if (change <= -12) return { change, trend: "明显降温" };
  if (change <= -4) return { change, trend: "降温" };
  return { change, trend: "平稳" };
}

export function marketMetricCatalog(market) {
  if (!market || typeof market !== "object") return [];
  const metrics = (market.metrics || []).slice(0, 3).flatMap((metric, index) => [
    { ref: `metric-${index}-value`, label: metric?.label, value: metric?.value },
    { ref: `metric-${index}-change`, label: `${metric?.label || "指标"}变化`, value: metric?.change },
  ]);
  const ranking = (market.ranking?.items || []).slice(0, 5).map((item, index) => ({
    ref: `ranking-${index}-display`,
    label: `${market.ranking?.label || "排名"} · ${item?.name || index + 1}`,
    value: item?.display,
  }));
  return [...metrics, ...ranking].filter((item) => WATCH_METRIC_REFS.includes(item.ref) && isNonEmptyString(item.label) && isNonEmptyString(item.value));
}

export function groundModelOutput(modelOutput, marketInput) {
  if (!modelOutput || !Array.isArray(modelOutput.figures)) return modelOutput;
  const grounded = structuredClone(modelOutput);
  for (const figure of grounded.figures) {
    if (!Array.isArray(figure?.topics)) continue;
    figure.topics = figure.topics
      .filter((topic) => topic && typeof topic === "object" && !Array.isArray(topic))
      .map((topic) => {
        if (topic.dataMode !== "market") {
          return groundEvidenceTopic(topic, marketInput, false);
        }

        const marketTopicType = inferDirectMarketTopicType(topic, marketInput);
        if (!marketTopicType) return groundEvidenceTopic(topic, marketInput, true);
        topic.topicType = marketTopicType;
        const catalog = marketMetricCatalog(marketInput?.topics?.[marketTopicType]);
        if (!Array.isArray(topic.story?.watch) || !catalog.length) return topic;
        topic.story.watch = topic.story.watch.map((watch, index) => {
          if (!watch || typeof watch !== "object" || Array.isArray(watch)) return watch;
          const selected = catalog.find((item) => item.ref === watch.metricRef)
            || catalog.find((item) => item.value === watch.metric)
            || catalog[index % catalog.length];
          const groundedWatch = { ...watch, metricRef: selected.ref };
          delete groundedWatch.metric;
          return groundedWatch;
        });
        return topic;
      });
  }
  return grounded;
}

function inferDirectMarketTopicType(topic, marketInput) {
  const availableTypes = new Set(Object.keys(marketInput?.topics || {}));
  const text = [
    topic.topicType,
    topic.name,
    topic.category,
    topic.summary,
    topic.why,
    ...(Array.isArray(topic.keywords) ? topic.keywords : []),
  ].filter(Boolean).join(" ");
  const exactType = availableTypes.has(topic.topicType) ? topic.topicType : null;
  if (exactType && MARKET_TOPIC_PATTERNS[exactType]?.test(text)) return exactType;

  const typeHint = String(topic.topicType || "").replaceAll("_", " ");
  const hintMatches = MARKET_TOPIC_TYPES.filter((topicType) => availableTypes.has(topicType) && MARKET_TOPIC_PATTERNS[topicType]?.test(typeHint));
  if (hintMatches.length === 1 && MARKET_TOPIC_PATTERNS[hintMatches[0]].test(text)) return hintMatches[0];

  const textMatches = MARKET_TOPIC_TYPES.filter((topicType) => availableTypes.has(topicType) && MARKET_TOPIC_PATTERNS[topicType]?.test(text));
  return textMatches.length === 1 ? textMatches[0] : null;
}

function groundEvidenceTopic(topic, marketInput, downgradedFromMarket) {
  topic.dataMode = "evidence";
  if (marketInput?.topics?.[topic.topicType]) topic.topicType = evidenceTopicType(topic.topicType);
  if (Array.isArray(topic.story?.watch)) {
    topic.story.watch = topic.story.watch.map((watch) => {
      if (!watch || typeof watch !== "object" || Array.isArray(watch)) return watch;
      const groundedWatch = { ...watch, focus: watch.focus || watch.title || "后续变化" };
      delete groundedWatch.metricRef;
      delete groundedWatch.metric;
      return groundedWatch;
    });
  }
  if (downgradedFromMarket && Array.isArray(topic.story?.chapters)) {
    const keywords = (Array.isArray(topic.keywords) ? topic.keywords : []).slice(0, 3).join("、") || topic.name;
    topic.story.chapters = topic.story.chapters.map((chapter) => {
      if (chapter?.view === "signal") return chapter;
      if (chapter?.view === "trend") return { ...chapter, kicker: "趋势", title: "讨论持续性与时间分布", body: `根据所引用的公开动态，观察“${topic.name}”在分析窗口内是否持续出现，不引入无关市场走势。` };
      if (chapter?.view === "ranking") return { ...chapter, kicker: "重点", title: "公开动态中的重点排序", body: `围绕${keywords}比较主题内部的证据覆盖，这是公开动态重点排序，不是公链、资产或市值排名。` };
      if (chapter?.view === "watch") return { ...chapter, kicker: "观察", title: "接下来关注什么", body: `继续观察“${topic.name}”是否持续、是否出现更具体信息，以及重点是否发生变化。` };
      return chapter;
    });
  }
  return topic;
}

function evidenceTopicType(topicType) {
  const normalized = String(topicType || "topic")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "") || "topic";
  return `evidence_${normalized}`.slice(0, 48).replace(/_+$/g, "");
}

export function buildPublishedSnapshot({ config, socialInput, eventSocialInput = socialInput, marketInput, eventMarketInput = { reactions: [] }, modelOutput, previousSnapshot, slot, generatedAt, modelName, isDemo }) {
  const previousFigures = new Map((previousSnapshot?.figures || []).map((figure) => [figure.id, figure]));
  const figures = socialInput.figures.map((figure) => {
    const aiFigure = modelOutput.figures.find((item) => item.figureId === figure.id);
    if (!aiFigure) throw new Error(`模型结果缺少人物 ${figure.id}`);
    const scoredTopics = calculateTopicScores(figure, aiFigure.topics, new Date(socialInput.windowEnd), config.analysisWindowHours)
      .filter((topic) => topic.sourceIds.length >= config.minEvidencePerTopic)
      .slice(0, config.maxTopicsPerFigure);
    const previousFigure = previousFigures.get(figure.id);
    const previousTopics = new Map((previousFigure?.themes || []).map((theme) => [theme.topicType, theme]));
    const themes = scoredTopics.map((topic) => {
      const usesMarketData = topic.dataMode === "market";
      const market = usesMarketData ? marketInput.topics[topic.topicType] : null;
      if (usesMarketData && !market) throw new Error(`主题 ${topic.topicType} 缺少直接相关的市场数据`);
      const evidenceData = usesMarketData ? null : buildEvidenceStoryData(topic, figure, socialInput.windowEnd, config.analysisWindowHours);
      const trend = deriveTrend(topic.score, previousTopics.get(topic.topicType)?.score);
      return {
        id: slugify(`${topic.topicType}-${topic.name}`),
        topicType: topic.topicType,
        storyId: topic.topicType,
        name: topic.name,
        category: market?.category || topic.category,
        score: topic.score,
        change: trend.change,
        trend: trend.trend,
        confidence: topic.confidence,
        summary: topic.summary,
        why: topic.why,
        keywords: topic.keywords,
        sourceIds: topic.sourceIds,
        evidenceBreakdown: topic.evidenceBreakdown,
        scoreBreakdown: topic.scoreBreakdown,
        evidence: topic.sourceIds.map((sourceId) => {
          const source = figure.sources.find((item) => item.id === sourceId);
          return {
            id: source.id,
            type: source.type,
            kind: source.kind || "original",
            weight: source.weight ?? 1,
            platform: source.platform,
            provider: source.provider || null,
            time: source.publishedAt,
            title: source.title,
            summary: topic.evidenceSummaries.find((item) => item.sourceId === sourceId)?.summary || source.text,
            keywords: topic.evidenceSummaries.find((item) => item.sourceId === sourceId)?.keywords || [],
            url: source.url,
          };
        }),
        story: {
          dataMode: usesMarketData ? "market" : "evidence",
          name: topic.name,
          category: market?.category || topic.category,
          headline: topic.story.headline,
          lead: topic.story.lead,
          accent: market?.accent || figure.colors?.[1] || figure.colors?.[0] || "#42d6c7",
          snapshot: market?.metrics || evidenceData.snapshot,
          trend: market?.trend || evidenceData.trend,
          ranking: market?.ranking || evidenceData.ranking,
          watch: topic.story.watch.map((item) => {
            if (!usesMarketData) return { ...item, metric: item.focus, metricLabel: "观察维度" };
            const metric = marketMetricCatalog(market).find((candidate) => candidate.ref === item.metricRef);
            return { ...item, metric: metric.value, metricLabel: metric.label };
          }),
          chapters: topic.story.chapters,
        },
      };
    });
    return {
      id: figure.id,
      name: figure.name,
      nameZh: figure.nameZh,
      initials: figure.initials,
      role: figure.role,
      avatar: figure.avatar,
      colors: figure.colors,
      accounts: figure.accounts,
      postsAnalyzed: figure.sources.length,
      sourceCount: figure.sources.length,
      analysisWindow: `近 ${Math.round(config.analysisWindowHours / 24)} 天`,
      lastSuccessAt: generatedAt,
      themes,
    };
  });

  const figureResults = new Map(figures.map((figure) => [figure.id, figure]));
  for (const eventFigure of eventSocialInput.figures || []) {
    const previousFigure = previousFigures.get(eventFigure.id);
    const previousTheme = (previousFigure?.themes || []).find((theme) => theme.story?.dataMode === "event-market" || theme.topicType === "market_impact_events");
    const currentReactions = (eventMarketInput.reactions || []).filter((reaction) => reaction.figureId === eventFigure.id && reaction.significance?.passed !== false);
    const marketReactions = mergeMarketReactions(currentReactions, previousTheme?.story?.marketReactions || [], generatedAt, config.eventHistoryDays || 90);
    if (!marketReactions.length) continue;
    const result = figureResults.get(eventFigure.id) || buildFigureShell(eventFigure, config, generatedAt);
    const eventTheme = buildEventImpactTheme({ figure: eventFigure, previousTheme, marketReactions, currentReactions, generatedAt, config });
    result.themes = [...result.themes.filter((theme) => theme.topicType !== "market_impact_events"), eventTheme];
    figureResults.set(eventFigure.id, result);
  }

  const snapshot = {
    schemaVersion: 1,
    snapshotId: snapshotIdFor(slot),
    status: "published",
    slotStart: slot.toISOString(),
    windowStart: socialInput.windowStart,
    windowEnd: socialInput.windowEnd,
    generatedAt,
    nextScheduledAt: calculateNextScheduledAt(slot, config),
    model: modelName,
    modelProvider: config.provider || "deepseek",
    promptVersion: config.promptVersion,
    mode: isDemo ? "demo-ai-snapshot" : "ai-snapshot",
    modeLabel: isDemo
      ? "DeepSeek 演示快照"
      : marketInput.mode === "live-api"
        ? "DeepSeek 定时快照 · 社交信号 + 相关资产事件行情"
        : "DeepSeek 定时快照 · Truth Social + X · 主题证据分析",
    sourceMode: socialInput.mode,
    marketMode: marketInput.mode,
    eventMarketMode: eventMarketInput.mode,
    isLive: !isDemo && ["x-posts-api", "mixed-social-api"].includes(socialInput.mode),
    title: isDemo ? "最近一份已发布的 DeepSeek 演示快照" : "最近一份已发布的 DeepSeek 分析快照",
    description: `${formatPublishCadence(config.publishIntervalHours)}；本页只读取最近一份校验通过并发布的结果。`,
    disclaimer: "兴趣主题只来自人物最近 7 天的公开动态，不代表人物立场、投资、合作或背书，也不会推断其钱包或链上地址。事件行情会先依据动态内容提出影响路径与候选资产，再独立读取历史行情；只有价格、成交量或相对市场表现达到预设异常阈值才展示。时间重合只表示相关性，不能据此认定人物导致了价格变化。",
    figures: [...figureResults.values()],
  };
  snapshot.digest = digestSnapshot(snapshot);
  return snapshot;
}

function buildFigureShell(figure, config, generatedAt) {
  return {
    id: figure.id,
    name: figure.name,
    nameZh: figure.nameZh,
    initials: figure.initials,
    role: figure.role,
    avatar: figure.avatar,
    colors: figure.colors,
    accounts: figure.accounts,
    postsAnalyzed: figure.sources.length,
    sourceCount: figure.sources.length,
    analysisWindow: `近 ${Math.round(config.analysisWindowHours / 24)} 天`,
    lastSuccessAt: generatedAt,
    themes: [],
  };
}

function buildEventImpactTheme({ figure, previousTheme, marketReactions, currentReactions, generatedAt, config }) {
  const sourceMap = new Map((figure.sources || []).map((source) => [source.id, source]));
  const previousEvidence = new Map((previousTheme?.evidence || []).map((item) => [item.id, item]));
  const evidence = [];
  const seenSources = new Set();
  for (const reaction of marketReactions) {
    if (seenSources.has(reaction.sourceId)) continue;
    const source = sourceMap.get(reaction.sourceId);
    const old = previousEvidence.get(reaction.sourceId);
    if (!source && !old) continue;
    seenSources.add(reaction.sourceId);
    evidence.push(source ? {
      id: source.id,
      type: source.type,
      kind: source.kind || "original",
      weight: source.weight ?? 1,
      platform: source.platform,
      provider: source.provider || null,
      time: source.publishedAt,
      title: source.title,
      summary: reaction.impactHypothesis?.rationale || source.text,
      keywords: [impactChannelLabel(reaction.impactHypothesis?.channel), reaction.asset?.symbol].filter(Boolean),
      url: source.url,
    } : old);
  }
  const assets = [...new Set(marketReactions.map((reaction) => reaction.asset?.symbol).filter(Boolean))];
  const channels = [...new Set(marketReactions.map((reaction) => impactChannelLabel(reaction.impactHypothesis?.channel)).filter(Boolean))];
  const currentSourceIds = new Set(currentReactions.map((reaction) => reaction.sourceId));
  const originals = evidence.filter((item) => item.kind === "original").length;
  const quotes = evidence.filter((item) => item.kind === "quote").length;
  const replies = evidence.filter((item) => item.kind === "reply").length;
  const strongestZ = Math.max(0, ...marketReactions.map((reaction) => Number(reaction.significance?.zScore) || 0));
  const strongCount = marketReactions.filter((reaction) => reaction.significance?.level === "strong").length;
  const highRelevance = marketReactions.filter((reaction) => reaction.impactHypothesis?.relevance === "high").length;
  const score = clamp(Math.round(58 + Math.min(16, strongestZ * 5) + Math.min(10, strongCount * 4) + Math.min(8, highRelevance * 3) + Math.min(8, marketReactions.length * 2)), 0, 96);
  const trend = deriveTrend(score, previousTheme?.score);
  const topic = {
    name: "事件与加密市场反应",
    category: "跨市场事件",
    score,
  };
  return {
    id: "market-impact-events",
    topicType: "market_impact_events",
    storyId: "market_impact_events",
    name: topic.name,
    category: topic.category,
    score,
    change: trend.change,
    trend: trend.trend,
    confidence: marketReactions.some((reaction) => reaction.impactHypothesis?.confidence === "high") ? "高" : "中",
    summary: `公开动态中的事件先形成影响假设，再用真实小时行情验证；当前保留 ${marketReactions.length} 组达到异常阈值的反应。`,
    why: "事件候选资产在读取价格前确定，只有后续行情相对自身历史波动、成交量或 BTC 基准出现异常时才进入故事。",
    keywords: [...channels, ...assets].filter(Boolean).slice(0, 8),
    sourceIds: evidence.map((item) => item.id),
    evidenceBreakdown: { posts: evidence.length, originals, quotes, replies, weightedCount: evidence.reduce((sum, item) => sum + (item.weight ?? 1), 0) },
    scoreBreakdown: {
      frequency: clamp(50 + marketReactions.length * 8, 0, 100),
      freshness: clamp(55 + currentSourceIds.size * 12, 0, 100),
      continuity: clamp(Math.round(50 + strongestZ * 12), 0, 100),
    },
    scoreLabels: ["验证事件", "本期事件", "异常强度"],
    evidence,
    story: buildEventMarketStory(topic, figure, marketReactions, currentReactions, figure.colors?.[1] || figure.colors?.[0] || "#42d6c7"),
    lastVerifiedAt: generatedAt,
    historyDays: config.eventHistoryDays || 90,
  };
}

function mergeMarketReactions(current, previous, generatedAt, historyDays) {
  const cutoff = new Date(generatedAt).getTime() - historyDays * 24 * 36e5;
  const merged = new Map();
  for (const reaction of [...current.map((item) => ({ ...item, isCurrentWindow: true })), ...previous.map((item) => ({ ...item, isCurrentWindow: false }))]) {
    const eventTime = new Date(reaction?.eventAt).getTime();
    if (!reaction?.id || !Number.isFinite(eventTime) || eventTime < cutoff) continue;
    if (!merged.has(reaction.id)) merged.set(reaction.id, reaction);
  }
  return [...merged.values()].sort((left, right) => new Date(right.eventAt) - new Date(left.eventAt)).slice(0, 24);
}

function buildEventMarketStory(topic, figure, marketReactions, currentReactions, accent) {
  const primary = marketReactions[0];
  const assets = [...new Set(marketReactions.map((reaction) => reaction.asset?.symbol).filter(Boolean))];
  const comparable = marketReactions.map((reaction) => ({ reaction, ...reactionComparableMove(reaction) }));
  const strongest = [...comparable].filter((item) => Number.isFinite(item.value)).sort((left, right) => Math.abs(right.value) - Math.abs(left.value))[0];
  const trendPoints = (primary.points || []).map((point) => ({ label: relativeHourLabel(point.hours), value: Number(point.change), time: point.time, hours: point.hours }));
  const rankingItems = comparable
    .filter((item) => Number.isFinite(item.value))
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value))
    .slice(0, 8)
    .map(({ reaction, value, horizon }) => ({
      name: `${formatShortDate(reaction.eventAt)} · ${reaction.asset.symbol}`,
      value: Math.max(Math.abs(value), 0.01),
      display: `${formatSignedPercent(value)} / ${horizon}`,
      reactionId: reaction.id,
      eventTitle: reaction.eventTitle,
      eventAt: reaction.eventAt,
    }));
  const primaryMove = reactionComparableMove(primary);
  const volumeRatio = primary.metrics?.volumeRatio24h;
  const relativeMetric = Number.isFinite(primary.metrics?.btcAdjusted24h)
    ? { label: "相对 BTC（24h）", value: formatSignedPercent(primary.metrics.btcAdjusted24h), detail: "已扣除同期 BTC 涨跌，仅用于观察相对强弱。" }
    : { label: "最大回撤（72h窗）", value: formatSignedPercent(primary.metrics?.maxDrawdown), detail: "从发帖时点起，在当前可用观察窗口内的最低变动。" };

  return {
    dataMode: "event-market",
    name: topic.name,
    category: `${topic.category} · 异常行情验证`,
    headline: `${figure.nameZh}发布相关事件后，加密市场出现了什么反应？`,
    lead: `先根据动态内容确定“事件如何可能传导到市场”以及候选资产，再把发布时间设为 T=0，对照前 24 小时至后 72 小时的真实行情。只有达到预设异常阈值的反应才展示。`,
    accent,
    snapshot: [
      { label: "通过验证的事件反应", value: `${marketReactions.length} 组`, change: `${currentReactions.length} 组来自本期 · ${assets.join(" · ")}` },
      { label: `最近事件${primaryMove.horizon}反应`, value: formatSignedPercent(primaryMove.value), change: `${formatShortDate(primary.eventAt)} · ${primary.asset.symbol} · ${significanceLabel(primary)}` },
      { label: "最强异常波动", value: strongest ? formatSignedPercent(strongest.value) : "待观察", change: strongest ? `${formatShortDate(strongest.reaction.eventAt)} · ${strongest.reaction.asset.symbol} · ${strongest.horizon}` : "观察窗口尚未完整" },
    ],
    trend: { label: `${primary.asset.symbol} 事件时点归一化价格`, unit: "%", points: trendPoints },
    ranking: { label: "已验证事件按可比窗口的绝对波动排序", items: rankingItems },
    watch: [
      { title: "短线价格反应", metric: formatSignedPercent(primary.metrics?.return1h), metricLabel: "+1h", detail: `事件发布后 1 小时，候选资产 ${primary.asset.symbol} 的价格变化。`, tone: "teal" },
      { title: "成交量是否放大", metric: Number.isFinite(volumeRatio) ? `${volumeRatio.toFixed(2)}×` : "待观察", metricLabel: "后24h / 前24h", detail: "比较事件前后各 24 小时的平均小时成交量；数据不完整时不估算。", tone: "amber" },
      { title: relativeMetric.label, metric: relativeMetric.value, metricLabel: "相关性观察", detail: relativeMetric.detail, tone: "violet" },
    ],
    chapters: [
      { view: "signal", kicker: "信号", title: "为什么这个事件可能传导到加密市场？", body: primary.impactHypothesis?.rationale || `系统在读取行情前，将这条公开动态判断为可能影响 ${primary.asset.symbol} 的事件，并固定了候选资产。` },
      { view: "trend", kicker: "价格反应", title: "事件前后价格路径", body: `以“${primary.eventTitle}”为 T=0，观察候选资产 ${primary.asset.symbol} 从 T-24h 到当前可用的 T+72h 路径。该反应通过了历史波动、成交量或相对 BTC 表现的预设阈值。` },
      { view: "ranking", kicker: "历史对比", title: "已验证事件的波动排序", body: `把最近 ${marketReactions.length} 组通过阈值的事件反应按可比窗口绝对波动排序，同时保留上涨和下跌；未达到阈值的普通波动不会进入这张表。` },
      { view: "watch", kicker: "观察", title: "异常相关不等于因果", body: "事件可能与币价波动存在时间关联，但相关性不等于因果关系；同期宏观消息、市场结构、流动性和其他新闻也会影响价格。页面展示的是可复核的异常反应，不把它表述成人物直接带动行情。" },
    ],
    marketReactions,
    primaryReactionId: primary.id,
  };
}

function impactChannelLabel(value) {
  return ({
    macro_risk: "宏观风险",
    geopolitical: "地缘事件",
    regulation_policy: "监管政策",
    election_policy: "选举政策",
    financial_liquidity: "金融流动性",
    crypto_infrastructure: "加密基础设施",
    exchange_platform: "交易平台",
    protocol_technology: "协议技术",
    corporate_adoption: "企业采用",
    other: "其他影响路径",
  })[value] || null;
}

function significanceLabel(reaction) {
  if (reaction.significance?.level === "strong") return "强异常";
  if (reaction.significance?.passed) return "显著异常";
  return "已验证";
}

function reactionComparableMove(reaction) {
  for (const [key, horizon] of [["return24h", "+24h"], ["return6h", "+6h"], ["return1h", "+1h"]]) {
    const value = reaction.metrics?.[key];
    if (Number.isFinite(value)) return { value, horizon };
  }
  return { value: null, horizon: "待观察" };
}

function formatSignedPercent(value) {
  if (!Number.isFinite(value)) return "待观察";
  return `${value > 0 ? "+" : ""}${Number(value).toFixed(2)}%`;
}

function formatShortDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}` : "—";
}

function relativeHourLabel(value) {
  const hours = Number(value);
  if (!Number.isFinite(hours)) return "—";
  if (Math.abs(hours) < 0.1) return "T=0";
  return `T${hours > 0 ? "+" : ""}${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

function buildEvidenceStoryData(topic, figure, windowEndValue, analysisWindowHours) {
  const sources = topic.sourceIds.map((sourceId) => figure.sources.find((source) => source.id === sourceId)).filter(Boolean);
  const activeDays = new Set(sources.map((source) => new Date(source.publishedAt).toISOString().slice(0, 10))).size;
  const topKeywords = topic.keywords.slice(0, 3);
  const snapshot = [
    { label: "关联公开动态", value: `${sources.length} 条`, change: `${topic.evidenceBreakdown.originals || 0} 原创 · ${topic.evidenceBreakdown.quotes || 0} 引用` },
    { label: "讨论活跃日", value: `${activeDays} 天`, change: `近 ${Math.round(analysisWindowHours / 24)} 天` },
    { label: "核心关键词", value: `${topic.keywords.length} 个`, change: topKeywords.join(" · ") },
  ];

  const windowEnd = new Date(windowEndValue);
  const dayCount = Math.max(2, Math.round(analysisWindowHours / 24));
  const counts = new Map();
  for (const source of sources) {
    const day = new Date(source.publishedAt).toISOString().slice(0, 10);
    counts.set(day, (counts.get(day) || 0) + 1);
  }
  const trendPoints = Array.from({ length: dayCount }, (_, index) => {
    const day = new Date(windowEnd);
    day.setUTCDate(day.getUTCDate() - (dayCount - index - 1));
    const key = day.toISOString().slice(0, 10);
    return { label: `${String(day.getUTCMonth() + 1).padStart(2, "0")}/${String(day.getUTCDate()).padStart(2, "0")}`, value: counts.get(key) || 0 };
  });

  const normalizedSummaries = topic.evidenceSummaries.map((item) => `${item.summary} ${(item.keywords || []).join(" ")}`.toLocaleLowerCase("zh-CN"));
  const rankingItems = topic.keywords.slice(0, 5).map((keyword) => {
    const normalized = keyword.toLocaleLowerCase("zh-CN");
    const count = normalizedSummaries.filter((text) => text.includes(normalized)).length || 1;
    return { name: keyword, value: count, display: `${count} 条证据` };
  }).sort((left, right) => right.value - left.value);

  return {
    snapshot,
    trend: { label: `${topic.name}公开动态分布`, unit: "条", points: trendPoints },
    ranking: { label: "按公开动态证据覆盖排序", items: rankingItems },
  };
}

function formatPublishCadence(intervalHours) {
  if (intervalHours === 168) return "每周一北京时间 08:00 生成一次";
  if (intervalHours === 24) return "每天生成一次";
  return `每 ${intervalHours} 小时生成一次`;
}

function calculateNextScheduledAt(slot, config) {
  if (config.schedule === "0 0 * * 1") {
    const next = new Date(slot);
    const daysUntilMonday = ((1 - next.getUTCDay() + 7) % 7) || 7;
    next.setUTCDate(next.getUTCDate() + daysUntilMonday);
    next.setUTCHours(0, 0, 0, 0);
    return next.toISOString();
  }
  return new Date(slot.getTime() + config.publishIntervalHours * 36e5).toISOString();
}

export function validateModelOutput(modelOutput, socialInput, marketInput, config) {
  const errors = [];
  if (!modelOutput || !Array.isArray(modelOutput.figures)) return ["模型输出缺少 figures"];
  const expectedTopicProperties = ["topicType", "dataMode", "name", "category", "confidence", "summary", "why", "keywords", "sourceIds", "evidenceSummaries", "story"];
  const figureIds = new Set(socialInput.figures.map((figure) => figure.id));
  for (const inputFigure of socialInput.figures) {
    for (const source of inputFigure.sources || []) {
      if (source.type !== "post") errors.push(`${inputFigure.id} 包含非动态来源 ${source.id}`);
      if (source.kind === "retweet") errors.push(`${inputFigure.id} 包含已排除的转发 ${source.id}`);
    }
  }
  const seenFigures = new Set();
  for (const figure of modelOutput.figures) {
    if (!figure || typeof figure !== "object") {
      errors.push("人物结果必须是对象");
      continue;
    }
    if (!figureIds.has(figure.figureId)) errors.push(`未知人物 ${figure.figureId}`);
    if (seenFigures.has(figure.figureId)) errors.push(`重复人物 ${figure.figureId}`);
    seenFigures.add(figure.figureId);
    const sourceIds = new Set(socialInput.figures.find((item) => item.id === figure.figureId)?.sources.map((source) => source.id) || []);
    if (!Array.isArray(figure.topics) || !figure.topics.length) errors.push(`${figure.figureId} 没有主题`);
    if (Array.isArray(figure.topics) && figure.topics.length > config.maxTopicsPerFigure) errors.push(`${figure.figureId} 主题数量超过上限`);
    const seenTopicTypes = new Set();
    for (const topic of figure.topics || []) {
      if (!topic || typeof topic !== "object") {
        errors.push(`${figure.figureId} 的主题必须是对象`);
        continue;
      }
      for (const property of expectedTopicProperties) if (topic[property] === undefined) errors.push(`${figure.figureId} 的主题缺少 ${property}`);
      if (!/^[a-z][a-z0-9_]{1,48}$/.test(String(topic.topicType || ""))) errors.push(`${figure.figureId} 使用无效主题标识 ${topic.topicType}`);
      if (seenTopicTypes.has(topic.topicType)) errors.push(`${figure.figureId} 重复主题标识 ${topic.topicType}`);
      seenTopicTypes.add(topic.topicType);
      if (!["market", "evidence"].includes(topic.dataMode)) errors.push(`${figure.figureId}/${topic.name} 数据模式无效`);
      if (topic.dataMode === "market" && !marketInput.topics[topic.topicType]) errors.push(`${figure.figureId}/${topic.name} 没有直接相关的市场数据模板`);
      if (topic.dataMode === "evidence" && marketInput.topics[topic.topicType]) errors.push(`${figure.figureId}/${topic.name} 证据主题不能冒用市场主题标识 ${topic.topicType}`);
      if (!isNonEmptyString(topic.name) || !isNonEmptyString(topic.category) || !isNonEmptyString(topic.summary) || !isNonEmptyString(topic.why)) errors.push(`${figure.figureId} 的主题文案不完整`);
      if (!["高", "中", "低"].includes(topic.confidence)) errors.push(`${figure.figureId}/${topic.name} 置信度无效`);
      if (!Array.isArray(topic.keywords) || topic.keywords.length < 3 || topic.keywords.length > 8 || topic.keywords.some((item) => !isNonEmptyString(item))) errors.push(`${figure.figureId}/${topic.name} 关键词无效`);
      const topicSourceIds = Array.isArray(topic.sourceIds) ? topic.sourceIds : [];
      if (new Set(topicSourceIds).size < config.minEvidencePerTopic) errors.push(`${figure.figureId}/${topic.name} 独立证据不足`);
      if (topicSourceIds.length > 8 || topicSourceIds.some((item) => !isNonEmptyString(item))) errors.push(`${figure.figureId}/${topic.name} 证据 id 无效`);
      for (const id of topicSourceIds) if (!sourceIds.has(id)) errors.push(`${figure.figureId}/${topic.name} 引用了不存在的证据 ${id}`);
      const summaryIds = new Set();
      if (!Array.isArray(topic.evidenceSummaries)) errors.push(`${figure.figureId}/${topic.name} 证据摘要必须是数组`);
      for (const evidence of Array.isArray(topic.evidenceSummaries) ? topic.evidenceSummaries : []) {
        if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
          errors.push(`${figure.figureId}/${topic.name} 证据摘要必须是对象`);
          continue;
        }
        if (!sourceIds.has(evidence.sourceId)) errors.push(`${figure.figureId}/${topic.name} 摘要引用不存在的证据 ${evidence.sourceId}`);
        if (!topicSourceIds.includes(evidence.sourceId)) errors.push(`${figure.figureId}/${topic.name} 摘要 ${evidence.sourceId} 不在主题证据中`);
        if (summaryIds.has(evidence.sourceId)) errors.push(`${figure.figureId}/${topic.name} 重复摘要 ${evidence.sourceId}`);
        if (!isNonEmptyString(evidence.summary) || !Array.isArray(evidence.keywords) || !evidence.keywords.length || evidence.keywords.length > 5 || evidence.keywords.some((item) => !isNonEmptyString(item))) errors.push(`${figure.figureId}/${topic.name} 摘要 ${evidence.sourceId} 内容无效`);
        summaryIds.add(evidence.sourceId);
      }
      for (const id of topicSourceIds) if (!summaryIds.has(id)) errors.push(`${figure.figureId}/${topic.name} 缺少证据摘要 ${id}`);
      const chapters = Array.isArray(topic.story?.chapters) ? topic.story.chapters : [];
      const watchItems = Array.isArray(topic.story?.watch) ? topic.story.watch : [];
      if (!isNonEmptyString(topic.story?.headline) || !isNonEmptyString(topic.story?.lead)) errors.push(`${figure.figureId}/${topic.name} 故事标题或导语无效`);
      if (chapters.length !== 4) errors.push(`${figure.figureId}/${topic.name} 必须返回四章故事`);
      const views = chapters.map((chapter) => chapter?.view);
      if (views.join(",") !== VIEWS.join(",")) errors.push(`${figure.figureId}/${topic.name} 章节顺序必须为 ${VIEWS.join(" → ")}`);
      if (chapters.some((chapter) => !isNonEmptyString(chapter?.title) || !isNonEmptyString(chapter?.kicker) || !isNonEmptyString(chapter?.body))) errors.push(`${figure.figureId}/${topic.name} 章节文案不完整`);
      if (watchItems.length !== 3) errors.push(`${figure.figureId}/${topic.name} 必须返回三个观察点`);
      for (const watch of watchItems) {
        if (!isNonEmptyString(watch?.title) || !isNonEmptyString(watch?.detail) || !TONES.includes(watch?.tone)) errors.push(`${figure.figureId}/${topic.name} 观察点结构无效`);
        if (topic.dataMode === "market" && !marketMetricCatalog(marketInput.topics[topic.topicType]).some((item) => item.ref === watch?.metricRef)) errors.push(`${figure.figureId}/${topic.name} 使用了市场输入中不存在的指标引用 ${watch?.metricRef || "（空）"}`);
        if (topic.dataMode === "evidence" && !isNonEmptyString(watch?.focus)) errors.push(`${figure.figureId}/${topic.name} 证据观察点缺少关注维度`);
        if (topic.dataMode === "evidence" && watch?.metricRef !== undefined) errors.push(`${figure.figureId}/${topic.name} 非市场主题不应引用市场指标`);
      }
    }
  }
  for (const id of figureIds) if (!seenFigures.has(id)) errors.push(`模型输出遗漏人物 ${id}`);
  return errors;
}

export function validateSnapshot(snapshot) {
  const errors = [];
  if (snapshot.status !== "published") errors.push("快照状态必须为 published");
  if (!snapshot.snapshotId || !snapshot.generatedAt || !snapshot.slotStart) errors.push("快照元数据不完整");
  if (!Array.isArray(snapshot.figures) || !snapshot.figures.length) errors.push("快照没有人物");
  for (const figure of snapshot.figures || []) {
    if (!figure.themes?.length) errors.push(`${figure.id} 没有可发布主题`);
    for (const theme of figure.themes || []) {
      const minimumEvidence = theme.story?.dataMode === "event-market" ? 1 : 2;
      if (theme.evidence.length < minimumEvidence) errors.push(`${figure.id}/${theme.id} 证据不足`);
      if (theme.story.chapters.length !== 4 || theme.story.watch.length !== 3) errors.push(`${figure.id}/${theme.id} 故事结构不完整`);
      if (!["market", "evidence", "event-market"].includes(theme.story.dataMode)) errors.push(`${figure.id}/${theme.id} 故事数据模式无效`);
      if (!theme.story.trend.points.length || !theme.story.ranking.items.length) errors.push(`${figure.id}/${theme.id} 缺少数据图表`);
      if (theme.story.dataMode === "event-market" && (!Array.isArray(theme.story.marketReactions) || !theme.story.marketReactions.length)) errors.push(`${figure.id}/${theme.id} 缺少资产事件行情`);
    }
  }
  return errors;
}

export async function publishSnapshot({ snapshot, outputDirectory, publicLatestFile, publicIndexFile, keep = 40 }) {
  const snapshotFile = path.join(outputDirectory, `${snapshot.snapshotId}.json`);
  await writeJsonAtomic(snapshotFile, snapshot);
  let index = { schemaVersion: 1, latest: null, snapshots: [] };
  try { index = await readJson(publicIndexFile); } catch {}
  const entry = {
    id: snapshot.snapshotId,
    file: `./data/snapshots/${snapshot.snapshotId}.json`,
    generatedAt: snapshot.generatedAt,
    slotStart: snapshot.slotStart,
    windowStart: snapshot.windowStart,
    windowEnd: snapshot.windowEnd,
    status: snapshot.status,
    modeLabel: snapshot.modeLabel,
    digest: snapshot.digest,
  };
  const snapshots = [entry, ...(index.snapshots || []).filter((item) => item.id !== entry.id)]
    .sort((left, right) => new Date(right.slotStart) - new Date(left.slotStart))
    .slice(0, keep);
  await writeJsonAtomic(publicLatestFile, snapshot);
  await writeJsonAtomic(publicIndexFile, { schemaVersion: 1, latest: entry.id, generatedAt: snapshot.generatedAt, snapshots });
  return { snapshotFile, indexCount: snapshots.length };
}

export async function removeFileIfExists(filePath) {
  await rm(filePath, { force: true });
}

function digestSnapshot(snapshot) {
  const clone = structuredClone(snapshot);
  delete clone.digest;
  return createHash("sha256").update(JSON.stringify(clone)).digest("hex").slice(0, 16);
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "").slice(0, 72);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
