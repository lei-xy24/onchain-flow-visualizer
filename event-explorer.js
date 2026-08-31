(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const state = { context: readContext(), index: null, snapshot: null, story: null, figure: null, theme: null, chapter: 0, selectedReactionId: null };
  const elements = Object.fromEntries([
    "figure-avatar","story-category","story-title","story-lead","data-mode","interest-score","origin-copy","origin-theme","snapshot-grid",
    "chapter-list","chapter-kicker","chapter-title","chapter-number","chapter-body",
    "signal-view","signal-count","signal-keywords","signal-evidence","trend-view","trend-kicker","trend-title","trend-mode-label","event-market-panel","event-timeline","event-summary","trend-chart","ranking-view","ranking-kicker","ranking-title","ranking-list","ranking-detail",
    "watch-view","watch-grid","note-figure","note-theme","note-score","note-confidence","snapshot-version","story-back-link","story-header-context","story-header-status","story-header-time","loading-overlay","loading-title","loading-detail","loading-steps"
  ].map((id) => [toCamel(id), document.getElementById(id)]));

  elements.snapshotVersion.addEventListener("change", () => {
    const nextUrl = new URL(location.href); nextUrl.searchParams.set("snapshot", elements.snapshotVersion.value); location.href = nextUrl;
  });
  loadData();

  async function loadData() {
    try {
      state.index = await window.SocialRadarSnapshots.loadIndex();
      advanceLoading(1, "正在判断主题应使用市场数据还是公开动态证据");
      state.snapshot = await window.SocialRadarSnapshots.loadSnapshot(state.index, state.context.snapshot);
      state.figure = state.snapshot.figures.find((item) => item.id === state.context.figureId) || state.snapshot.figures[0];
      state.theme = state.figure.themes.find((item) => item.storyId === state.context.theme) || state.figure.themes[0];
      state.context.figureId = state.figure.id;
      state.context.theme = state.theme.storyId;
      state.context.snapshot = state.snapshot.snapshotId;
      state.story = prepareStory(state.theme, state.figure, state.snapshot);
      elements.storyHeaderContext.textContent = `${state.figure.nameZh} · ${state.theme.name}`;
      elements.storyHeaderStatus.textContent = state.snapshot.eventMarketMode === "not-collected" ? "当期未采集事件行情" : "已发布快照";
      elements.storyHeaderTime.textContent = formatTime(state.snapshot.generatedAt);
      elements.storyHeaderTime.dateTime = state.snapshot.generatedAt;
      window.SocialRadarSnapshots.populateVersionSelect(elements.snapshotVersion, state.index, state.snapshot.snapshotId);
      syncContextLinks();
      await wait(320); advanceLoading(2, "正在组合兴趣证据与四个故事章节"); await wait(320);
      renderAll(); elements.loadingOverlay.classList.add("is-hidden");
    } catch (error) {
      elements.loadingTitle.textContent = "主题故事加载失败"; elements.loadingDetail.textContent = `${error.message || "未知错误"}，请返回人物兴趣雷达重试。`;
      elements.storyHeaderStatus.textContent = "加载失败"; elements.storyHeaderTime.textContent = "请返回后重试";
    }
  }

  function renderAll() {
    renderHero(); renderSnapshots(); renderChapters(); renderSignal(); renderEventTimeline(); renderTrend(); renderRanking(); renderWatch(); selectChapter(0);
  }

  function renderHero() {
    const avatar = state.figure.avatar; elements.figureAvatar.replaceChildren();
    if (avatar) { const image = document.createElement("img"); image.src = avatar; image.alt = `${state.figure.nameZh}头像`; elements.figureAvatar.appendChild(image); } else elements.figureAvatar.textContent = state.figure.initials;
    document.documentElement.style.setProperty("--story-accent", state.story.accent);
    const usesEventMarket = state.story.dataMode === "event-market";
    const hasRelatedMarket = hasMarketReactions();
    elements.storyCategory.textContent = usesEventMarket ? `${state.story.category} · ${state.figure.nameZh}事件验证` : `${state.story.category} · ${state.figure.nameZh}兴趣主题`;
    elements.storyTitle.textContent = state.story.headline; elements.storyLead.textContent = state.story.lead;
    elements.interestScore.textContent = `${state.theme.score} 关注度`;
    const usesMarketData = state.story.dataMode === "market";
    const dataMode = hasRelatedMarket ? "主题证据 × 相关事件小时行情" : usesMarketData ? state.snapshot.modeLabel : "DeepSeek 定时快照 · 公开动态证据分析";
    elements.dataMode.textContent = state.snapshot.eventMarketMode === "not-collected" ? `${dataMode} · 当期未采集事件行情` : dataMode;
    elements.trendKicker.textContent = hasRelatedMarket ? "Event price reaction" : usesMarketData ? "Market trend" : "Discussion trend";
    elements.rankingKicker.textContent = usesEventMarket ? "Historical event comparison" : usesMarketData ? "Market landscape" : "Topic priorities";
    elements.trendModeLabel.textContent = hasRelatedMarket ? "T-24h → T+72h" : usesMarketData ? (state.snapshot.marketMode === "live-api" ? "直接相关市场数据" : "主题市场快照") : "公开动态时间分布";
    elements.originCopy.textContent = hasRelatedMarket ? `${state.figure.nameZh}围绕“${state.theme.name}”的动态形成主题，页面再按动态来源精确匹配候选资产行情。` : `${state.figure.nameZh}最近 7 天的多条公开动态中，“${state.theme.name}”相关关键词形成稳定主题簇。`;
    elements.originTheme.textContent = state.theme.name;
    elements.noteFigure.textContent = state.figure.nameZh; elements.noteTheme.textContent = state.theme.name;
    elements.noteScore.textContent = `${state.theme.score} / 100 · ${state.theme.trend}`; elements.noteConfidence.textContent = state.theme.confidence;
  }

  function renderSnapshots() {
    elements.snapshotGrid.replaceChildren(); state.story.snapshot.forEach((item) => {
      const card = create("article"); card.append(create("span", null, item.label), create("strong", null, item.value), create("small", null, item.change)); elements.snapshotGrid.appendChild(card);
    });
  }

  function renderChapters() {
    elements.chapterList.replaceChildren(); state.story.chapters.forEach((chapter, index) => {
      const button = create("button", "chapter-button"); button.type = "button"; button.dataset.index = String(index);
      button.append(create("span", null, String(index + 1).padStart(2, "0")), create("div", null, ""));
      button.lastChild.append(create("small", null, chapter.kicker), create("strong", null, chapter.title));
      button.addEventListener("click", () => selectChapter(index)); elements.chapterList.appendChild(button);
    });
  }

  function selectChapter(index) {
    state.chapter = index; const chapter = state.story.chapters[index];
    elements.chapterList.querySelectorAll("[data-index]").forEach((button) => button.classList.toggle("is-active", Number(button.dataset.index) === index));
    elements.chapterKicker.textContent = chapter.kicker; elements.chapterTitle.textContent = chapter.title; elements.chapterNumber.textContent = String(index + 1).padStart(2, "0"); elements.chapterBody.textContent = chapter.body;
    ["signal","trend","ranking","watch"].forEach((view) => { elements[`${view}View`].hidden = view !== chapter.view; });
  }

  function renderSignal() {
    const breakdown = state.theme.evidenceBreakdown; elements.signalCount.textContent = `${breakdown.originals || 0} 条原创 · ${breakdown.quotes || 0} 条引用 · ${breakdown.replies || 0} 条回复`;
    elements.signalKeywords.replaceChildren(); state.theme.keywords.forEach((word, index) => elements.signalKeywords.appendChild(create("span", index < 2 ? "is-strong" : null, word)));
    elements.signalEvidence.replaceChildren(); state.theme.evidence.forEach((item) => {
      const kindLabel = ({ original: "原创动态", quote: "引用动态", reply: "回复动态" })[item.kind] || "公开动态";
      const card = create("article"); const top = create("div", "signal-top"); top.append(create("span", item.kind || "original", kindLabel), create("time", null, formatTime(item.time)));
      card.append(top, create("h3", null, item.title), create("p", null, item.summary)); elements.signalEvidence.appendChild(card);
    });
  }

  function renderEventTimeline() {
    const isEventMarket = hasMarketReactions();
    elements.eventMarketPanel.hidden = !isEventMarket;
    if (!isEventMarket) return;
    if (!state.selectedReactionId || !state.story.marketReactions.some((item) => item.id === state.selectedReactionId)) state.selectedReactionId = state.story.primaryReactionId || state.story.marketReactions[0].id;
    elements.eventTimeline.replaceChildren();
    state.story.marketReactions.forEach((reaction) => {
      const move = comparableMove(reaction); const button = create("button", `event-chip${reaction.id === state.selectedReactionId ? " is-active" : ""}`); button.type = "button";
      const level = reaction.significance?.level === "strong" ? "强异常" : reaction.significance?.passed === false ? "普通波动" : reaction.significance?.passed ? "显著波动" : "已匹配行情";
      button.append(create("span", null, reaction.asset.symbol), create("strong", null, formatEventDate(reaction.eventAt)), create("small", null, `${move.horizon} ${formatSigned(move.value)} · ${level}`));
      button.title = reaction.eventTitle; button.addEventListener("click", () => { state.selectedReactionId = reaction.id; renderEventTimeline(); renderTrend(); }); elements.eventTimeline.appendChild(button);
    });
    const reaction = selectedReaction(); const metrics = reaction.metrics || {}; elements.eventSummary.replaceChildren();
    [
      ["+1 小时", formatSigned(metrics.return1h)], ["+6 小时", formatSigned(metrics.return6h)], ["+24 小时", formatSigned(metrics.return24h)],
      ["成交量比", Number.isFinite(metrics.volumeRatio24h) ? `${metrics.volumeRatio24h.toFixed(2)}×` : "待观察"],
      ["相对 BTC", Number.isFinite(metrics.btcAdjusted24h) ? formatSigned(metrics.btcAdjusted24h) : "不适用/待观察"],
      ["异常倍数", Number.isFinite(reaction.significance?.zScore) ? `${reaction.significance.zScore.toFixed(2)}σ` : "成交量/相对强弱验证"],
      ["当前价格", formatUsd(metrics.currentPrice)],
    ].forEach(([label, value]) => { const item = create("div"); item.append(create("span", null, label), create("strong", null, value)); elements.eventSummary.appendChild(item); });
  }

  function renderTrend() {
    const reaction = hasMarketReactions() ? selectedReaction() : null;
    const trend = reaction ? { label: `${reaction.asset.symbol} · ${reaction.eventTitle}`, unit: "%", points: reaction.points.map((point) => ({ ...point, label: relativeHour(point.hours), value: point.change })) } : state.story.trend;
    elements.trendTitle.textContent = trend.label; const svg = elements.trendChart; svg.replaceChildren();
    const points = trend.points.map((point) => ({ ...point, value: Number(point.value), hours: Number(point.hours) })).filter((point) => Number.isFinite(point.value));
    if (points.length < 2) { const message = svgEl("text", { class: "point-label", x: 450, y: 170, "text-anchor": "middle" }); message.textContent = "当前快照缺少可绘制的趋势数据"; svg.appendChild(message); return; }
    const values = points.map((p) => p.value); const rawMin = Math.min(...values, reaction ? 0 : Infinity); const rawMax = Math.max(...values, reaction ? 0 : -Infinity); const padding = Math.max((rawMax - rawMin) * 0.12, Math.abs(rawMax) * 0.04, 1); const min = rawMin - padding; const max = rawMax + padding;
    const hourValues = points.map((point) => point.hours).filter(Number.isFinite); const minHour = hourValues.length ? Math.min(...hourValues) : 0; const maxHour = hourValues.length ? Math.max(...hourValues) : points.length - 1;
    const x = (point, index) => reaction ? 70 + ((point.hours - minHour) / Math.max(1, maxHour - minHour)) * 750 : 70 + index * (750 / (points.length - 1)); const y = (value) => 275 - ((value - min) / (max - min)) * 220;
    [0, 1, 2, 3, 4].forEach((index) => { const yy = 55 + index * 55; svg.appendChild(svgEl("line", { class: "chart-grid", x1: 55, x2: 840, y1: yy, y2: yy })); });
    const coords = points.map((point, index) => ({ ...point, x: x(point, index), y: y(point.value) })); const path = coords.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
    if (reaction && minHour <= 0 && maxHour >= 0) { const eventX = 70 + ((0 - minHour) / Math.max(1, maxHour - minHour)) * 750; const marker = svgEl("line", { class: "event-marker", x1: eventX, x2: eventX, y1: 42, y2: 282 }); const markerLabel = svgEl("text", { class: "event-marker-label", x: eventX, y: 31, "text-anchor": "middle" }); markerLabel.textContent = "T=0 · 事件发布"; svg.append(marker, markerLabel); }
    svg.appendChild(svgEl("path", { class: "trend-area", d: `${path} L ${coords.at(-1).x} 275 L ${coords[0].x} 275 Z` })); svg.appendChild(svgEl("path", { class: "trend-line", d: path }));
    coords.forEach((point, index) => { const showLabel = !reaction || points.length <= 9 || shouldLabelEventPoint(point.hours, index, points.length); if (!showLabel) return; const circle = svgEl("circle", { class: "trend-point", cx: point.x, cy: point.y, r: 6, tabindex: 0 }); const value = svgEl("text", { class: "point-value", x: point.x, y: point.y - 15, "text-anchor": "middle" }); value.textContent = `${point.value > 0 && reaction ? "+" : ""}${point.value}${["%", "条"].includes(trend.unit) ? trend.unit : ""}`; const label = svgEl("text", { class: "point-label", x: point.x, y: 304, "text-anchor": "middle" }); label.textContent = point.label; circle.addEventListener("click", () => value.classList.toggle("is-active")); svg.append(circle, value, label); });
  }

  function renderRanking() {
    elements.rankingTitle.textContent = state.story.ranking.label; elements.rankingList.replaceChildren(); const items = state.story.ranking.items.map((item) => ({ ...item, value: Number(item.value) })).filter((item) => Number.isFinite(item.value) && item.value > 0); const max = Math.max(...items.map((item) => item.value), 1);
    if (!items.length) { elements.rankingList.appendChild(create("p", "ranking-empty", "当前快照缺少可展示的排名数据")); return; }
    items.forEach((item, index) => { const button = create("button", "ranking-row"); button.type = "button"; const bar = create("i"); bar.style.setProperty("--bar", `${(item.value / max) * 100}%`); button.append(create("span", "rank-number", String(index + 1).padStart(2, "0")), create("strong", null, item.name), bar, create("b", null, item.display)); button.addEventListener("click", () => { elements.rankingList.querySelectorAll("button").forEach((node) => node.classList.toggle("is-active", node === button)); if (state.story.dataMode === "event-market") { state.selectedReactionId = item.reactionId || state.selectedReactionId; elements.rankingDetail.textContent = `${item.eventTitle || item.name}：事件后可比窗口波动为 ${item.display}。候选资产事先确定，排序仅包含达到异常阈值的结果；这仍不是价格因果证明。`; } else elements.rankingDetail.textContent = state.story.dataMode === "market" ? `${item.name} 位列第 ${index + 1}；当前口径：${state.story.ranking.label}，快照时间 ${formatTime(state.snapshot.generatedAt)}。` : `${item.name} 在所引用公开动态中的证据覆盖位列第 ${index + 1}；这不是外部市场或公链排名。`; }); elements.rankingList.appendChild(button); });
  }

  function renderWatch() {
    elements.watchGrid.replaceChildren(); state.story.watch.forEach((item, index) => { const card = create("article", `watch-card ${item.tone}`); card.append(create("span", null, `0${index + 1}`), create("strong", null, item.metric || item.focus || "观察"), create("h3", null, item.title), create("p", null, item.detail)); elements.watchGrid.appendChild(card); });
  }

  function prepareStory(theme, figure, snapshot) {
    const story = structuredClone(theme.story);
    const explicitMode = story.dataMode;
    if (explicitMode === "event-market") return attachMarketContext(story, theme);
    if (explicitMode === "market" || (!explicitMode && isMarketAligned(theme))) {
      story.dataMode = "market";
      return attachMarketContext(story, theme);
    }
    if (explicitMode === "evidence") return attachMarketContext(story, theme);

    const evidence = theme.evidence || [];
    const activeDays = new Set(evidence.map((item) => String(item.time).slice(0, 10))).size;
    const keywordItems = evidenceKeywordRanking(theme);
    story.dataMode = "evidence";
    story.category = "公开动态议题";
    story.snapshot = [
      { label: "关联公开动态", value: `${evidence.length} 条`, change: `${theme.evidenceBreakdown.originals || 0} 原创 · ${theme.evidenceBreakdown.quotes || 0} 引用` },
      { label: "讨论活跃日", value: `${activeDays} 天`, change: figure.analysisWindow || "近 7 天" },
      { label: "核心关键词", value: `${theme.keywords.length} 个`, change: theme.keywords.slice(0, 3).join(" · ") },
    ];
    story.trend = { label: `${theme.name}公开动态分布`, unit: "条", points: evidenceTrend(evidence, snapshot.windowEnd) };
    story.ranking = { label: "按公开动态证据覆盖排序", items: keywordItems };
    story.watch = [
      { title: "话题是否持续", focus: "持续性", metric: "持续性", detail: `观察${figure.nameZh}后续是否继续讨论“${theme.name}”，以及是否跨多个日期反复出现。`, tone: "teal" },
      { title: "内容是否具体化", focus: "具体化", metric: "具体化", detail: "关注后续公开动态是否出现更明确的政策、技术、产品或时间节点，而不是补充无关市场数据。", tone: "amber" },
      { title: "重点是否发生变化", focus: "议题变化", metric: "议题变化", detail: `比较后续关键词是否仍集中在${theme.keywords.slice(0, 3).join("、")}，或转向新的子议题。`, tone: "violet" },
    ];
    story.chapters = story.chapters.map((chapter) => {
      if (chapter.view === "signal") return chapter;
      if (chapter.view === "trend") return { ...chapter, kicker: "趋势", title: "讨论持续性与时间分布", body: `近 7 天内，与“${theme.name}”直接相关的公开动态分布在 ${activeDays} 个活跃日。这里分析的是讨论频次和持续性，不引用无关市场走势。` };
      if (chapter.view === "ranking") return { ...chapter, kicker: "重点", title: "公开动态中的重点排序", body: `按所引用动态的证据覆盖看，当前重点依次集中在${keywordItems.slice(0, 3).map((item) => item.name).join("、")}。这是话题内部的证据排序，不是公链或资产排名。` };
      return { ...chapter, kicker: "观察", title: "接下来关注什么", body: `后续只跟踪“${theme.name}”本身是否持续、是否出现更具体信息，以及关键词重点如何变化，不为凑数据引入无关区块链指标。` };
    });
    return attachMarketContext(story, theme);
  }

  function attachMarketContext(story, theme) {
    const impact = theme.marketImpact;
    if (!impact) return story;
    const reactions = Array.isArray(impact.reactions) ? impact.reactions : [];
    story.marketImpactStatus = impact.status;
    story.marketUnavailable = impact.unavailableEvents || [];
    if (!reactions.length) return story;
    story.marketReactions = reactions;
    story.primaryReactionId = impact.primaryReactionId || reactions[0].id;
    if (story.dataMode !== "event-market") {
      const primary = reactions.find((reaction) => reaction.id === story.primaryReactionId) || reactions[0];
      story.chapters = story.chapters.map((chapter) => chapter.view === "trend" ? {
        ...chapter,
        kicker: "价格反应",
        title: "相关动态前后价格路径",
        body: `以“${primary.eventTitle}”发布时刻为 T=0，观察 ${primary.asset?.symbol || "候选资产"} 前 24 小时至后 72 小时的价格路径。行情与本主题通过同一条公开动态精确关联，但时间重合不等于因果。`,
      } : chapter);
    }
    return story;
  }

  function isMarketAligned(theme) {
    const text = `${theme.name} ${theme.summary || ""} ${(theme.keywords || []).join(" ")}`;
    const patterns = {
      stablecoin: /稳定币|数字美元|usdc|usdt|法币锚定/i,
      bitcoin: /比特币|\bbtc\b/i,
      ai_crypto: /ai\s*[×x+&]\s*(?:crypto|加密)|(?:人工智能|\bai\b).*(?:区块链|加密|链上)|(?:区块链|加密|链上).*(?:人工智能|\bai\b)/i,
      payments: /链上支付|加密支付|稳定币支付|数字资产支付|机器支付|区块链结算/i,
      layer2: /layer\s*2|\bl2\b|rollup|zk[- ]?evm|以太坊.*扩容|blob/i,
      privacy: /零知识|\bzk\b|隐私池|选择性披露|链上隐私|隐私增强技术|隐私币/i,
      chain_ecosystem: /公链|区块链生态|链上生态|bnb\s*chain|solana|ethereum|以太坊生态/i,
      defi: /\bdefi\b|去中心化金融|去中心化交易|\bdex\b|链上借贷|流动性质押|\btvl\b/i,
    };
    return patterns[theme.topicType]?.test(text) || false;
  }

  function evidenceTrend(evidence, windowEndValue) {
    const end = new Date(windowEndValue || Date.now());
    const counts = new Map();
    evidence.forEach((item) => { const day = String(item.time).slice(0, 10); counts.set(day, (counts.get(day) || 0) + 1); });
    return Array.from({ length: 7 }, (_, index) => { const day = new Date(end); day.setUTCDate(day.getUTCDate() - (6 - index)); const key = day.toISOString().slice(0, 10); return { label: `${String(day.getUTCMonth() + 1).padStart(2, "0")}/${String(day.getUTCDate()).padStart(2, "0")}`, value: counts.get(key) || 0 }; });
  }

  function evidenceKeywordRanking(theme) {
    const evidenceText = (theme.evidence || []).map((item) => `${item.summary || ""} ${(item.keywords || []).join(" ")}`.toLocaleLowerCase("zh-CN"));
    return (theme.keywords || []).slice(0, 5).map((keyword) => { const normalized = keyword.toLocaleLowerCase("zh-CN"); const count = evidenceText.filter((text) => text.includes(normalized)).length || 1; return { name: keyword, value: count, display: `${count} 条证据` }; }).sort((left, right) => right.value - left.value);
  }
  function selectedReaction() { return state.story.marketReactions?.find((item) => item.id === state.selectedReactionId) || state.story.marketReactions?.[0] || null; }
  function hasMarketReactions() { return Array.isArray(state.story?.marketReactions) && state.story.marketReactions.length > 0; }
  function comparableMove(reaction) { for (const [key, horizon] of [["return24h", "+24h"], ["return6h", "+6h"], ["return1h", "+1h"]]) if (Number.isFinite(reaction.metrics?.[key])) return { value: reaction.metrics[key], horizon }; return { value: null, horizon: "待观察" }; }
  function formatSigned(value) { return Number.isFinite(value) ? `${value > 0 ? "+" : ""}${Number(value).toFixed(2)}%` : "待观察"; }
  function formatUsd(value) { if (!Number.isFinite(value)) return "待观察"; if (value >= 1000) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`; if (value >= 1) return `$${value.toFixed(2)}`; return `$${value.toPrecision(4)}`; }
  function formatEventDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date); }
  function relativeHour(value) { const hours = Number(value); if (!Number.isFinite(hours)) return "—"; if (Math.abs(hours) < .1) return "T=0"; return `T${hours > 0 ? "+" : ""}${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`; }
  function shouldLabelEventPoint(hours, index, length) { return index === 0 || index === length - 1 || Math.abs(hours) < 1 || [24, 48, 72].some((target) => Math.abs(hours - target) < .6); }
  function readContext() { const params = new URLSearchParams(location.search); return { figureId: params.get("figureId") || "donald-trump", theme: params.get("theme") || "stablecoin", snapshot: params.get("snapshot") }; }
  function syncContextLinks() {
    const currentUrl = new URL(location.href);
    currentUrl.searchParams.set("figureId", state.context.figureId);
    currentUrl.searchParams.set("theme", state.context.theme);
    currentUrl.searchParams.set("snapshot", state.context.snapshot);
    history.replaceState(null, "", currentUrl);
    elements.storyBackLink.href = `./hot-topic.html?${new URLSearchParams({
      figureId: state.context.figureId,
      theme: state.context.theme,
      snapshot: state.context.snapshot,
    }).toString()}`;
  }
  function advanceLoading(step, detail) { [...elements.loadingSteps.children].forEach((item, index) => { item.classList.toggle("is-active", index === step); item.classList.toggle("is-done", index < step); }); elements.loadingDetail.textContent = detail; }
  function formatTime(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date); }
  function create(tag, className, text) { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; }
  function svgEl(tag, attributes) { const element = document.createElementNS(SVG_NS, tag); Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value)); return element; }
  function toCamel(value) { return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); }
  function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
})();
