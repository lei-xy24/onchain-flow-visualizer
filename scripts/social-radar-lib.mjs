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
          topic.dataMode = "evidence";
          if (!Array.isArray(topic.story?.watch)) return topic;
          topic.story.watch = topic.story.watch.map((watch) => {
            if (!watch || typeof watch !== "object" || Array.isArray(watch)) return watch;
            const groundedWatch = { ...watch, focus: watch.focus || watch.title };
            delete groundedWatch.metricRef;
            delete groundedWatch.metric;
            return groundedWatch;
          });
          return topic;
        }
        const catalog = marketMetricCatalog(marketInput?.topics?.[topic.topicType]);
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

export function buildPublishedSnapshot({ config, socialInput, marketInput, modelOutput, previousSnapshot, slot, generatedAt, modelName, isDemo }) {
  const previousFigures = new Map((previousSnapshot?.figures || []).map((figure) => [figure.id, figure]));
  const figures = socialInput.figures.map((figure) => {
    const aiFigure = modelOutput.figures.find((item) => item.figureId === figure.id);
    if (!aiFigure) throw new Error(`模型结果缺少人物 ${figure.id}`);
    const scoredTopics = calculateTopicScores(figure, aiFigure.topics, new Date(socialInput.windowEnd), config.analysisWindowHours)
      .filter((topic) => topic.sourceIds.length >= config.minEvidencePerTopic)
      .slice(0, config.maxTopicsPerFigure);
    const previousTopics = new Map((previousFigures.get(figure.id)?.themes || []).map((theme) => [theme.topicType, theme]));
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
        ? "DeepSeek 定时快照 · Truth Social + X · 主题相关分析"
        : "DeepSeek 定时快照 · Truth Social + X · 主题证据分析",
    sourceMode: socialInput.mode,
    marketMode: marketInput.mode,
    isLive: !isDemo && ["x-posts-api", "mixed-social-api"].includes(socialInput.mode),
    title: isDemo ? "最近一份已发布的 DeepSeek 演示快照" : "最近一份已发布的 DeepSeek 分析快照",
    description: `${formatPublishCadence(config.publishIntervalHours)}；本页只读取最近一份校验通过并发布的结果。`,
    disclaimer: "兴趣主题只来自人物最近 7 天的公开动态，不代表人物立场、投资、合作或背书，也不会推断其钱包或链上地址。只有主题与区块链市场直接相关时才展示市场指标；其他主题只分析公开动态证据。",
    figures,
  };
  snapshot.digest = digestSnapshot(snapshot);
  return snapshot;
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
      if (theme.evidence.length < 2) errors.push(`${figure.id}/${theme.id} 证据不足`);
      if (theme.story.chapters.length !== 4 || theme.story.watch.length !== 3) errors.push(`${figure.id}/${theme.id} 故事结构不完整`);
      if (!["market", "evidence"].includes(theme.story.dataMode)) errors.push(`${figure.id}/${theme.id} 故事数据模式无效`);
      if (!theme.story.trend.points.length || !theme.story.ranking.items.length) errors.push(`${figure.id}/${theme.id} 缺少数据图表`);
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
