(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const initialContext = readContext();
  const state = {
    index: null,
    data: null,
    activeFigureId: initialContext.figureId,
    activeThemeId: null,
    requestedThemeKey: initialContext.theme,
    toastTimer: null,
  };
  const elements = {
    sourceSignal: document.getElementById("source-signal"), sourceTitle: document.getElementById("source-title"),
    sourceDescription: document.getElementById("source-description"), sourceMode: document.getElementById("source-mode"),
    sourceTime: document.getElementById("source-time"), sourceCadence: document.getElementById("source-cadence"),
    snapshotVersion: document.getElementById("snapshot-version"),
    refresh: document.getElementById("refresh-data"), peopleSummary: document.getElementById("people-summary"),
    peopleList: document.getElementById("people-list"), selectedFigure: document.getElementById("selected-figure"),
    themePanel: document.getElementById("theme-panel"), themeList: document.getElementById("theme-list"), evidencePanel: document.getElementById("evidence-panel"),
    headerContext: document.getElementById("radar-header-context"), headerStatus: document.getElementById("radar-header-status"), headerTime: document.getElementById("radar-header-time"),
    boundaryCopy: document.getElementById("boundary-copy"), syncOverlay: document.getElementById("sync-overlay"),
    syncDetail: document.getElementById("sync-detail"), syncSteps: document.getElementById("sync-steps"),
    toast: document.getElementById("radar-toast"),
  };

  elements.refresh.addEventListener("click", () => loadData(true, "latest"));
  elements.snapshotVersion.addEventListener("change", () => loadData(true, elements.snapshotVersion.value));
  loadData(false, initialContext.snapshot);

  async function loadData(showLoading, requestedId) {
    elements.refresh.disabled = true;
    if (showLoading) openLoading();
    try {
      state.index = await window.SocialRadarSnapshots.loadIndex();
      if (showLoading) await advanceLoading(1, "正在确认最近一份校验通过的每周快照");
      const payload = await window.SocialRadarSnapshots.loadSnapshot(state.index, requestedId === "latest" ? state.index.latest : requestedId);
      if (!Array.isArray(payload.figures) || !payload.figures.length) throw new Error("人物兴趣快照结构不完整");
      if (showLoading) await advanceLoading(2, "正在装载主题、证据与数据故事");
      state.data = payload;
      if (!payload.figures.some((item) => item.id === state.activeFigureId)) state.activeFigureId = payload.figures[0].id;
      const figure = activeFigure();
      const preservedTheme = figure.themes.find((item) => item.id === state.activeThemeId);
      const requestedTheme = figure.themes.find(
        (item) => item.id === state.requestedThemeKey || item.storyId === state.requestedThemeKey,
      );
      state.activeThemeId = (preservedTheme || requestedTheme || figure.themes[0])?.id || null;
      state.requestedThemeKey = null;
      window.SocialRadarSnapshots.populateVersionSelect(elements.snapshotVersion, state.index, payload.snapshotId);
      renderAll();
      syncSelectionUrl();
      if (showLoading) showToast(payload.snapshotId === state.index.latest ? "已读取最近一份成功快照。" : "已切换到历史分析版本。");
    } catch (error) {
      renderError(error);
    } finally {
      elements.refresh.disabled = false;
      closeLoading();
    }
  }

  function renderAll() {
    renderSource(); renderPeople(); renderFigure(); renderThemes();
    elements.boundaryCopy.textContent = state.data.disclaimer;
  }

  function renderSource() {
    const snapshot = state.data;
    elements.sourceTitle.textContent = snapshot.title; elements.sourceDescription.textContent = "每周一北京时间 08:00 自动更新；本页只读取最近一份校验通过并发布的结果。";
    elements.sourceMode.textContent = snapshot.modeLabel; elements.sourceTime.textContent = formatTime(snapshot.generatedAt);
    elements.sourceCadence.textContent = "每周一 08:00"; elements.sourceSignal.classList.toggle("is-demo", !snapshot.isLive);
    elements.headerStatus.textContent = "已发布快照";
    elements.headerTime.textContent = formatTime(snapshot.generatedAt);
    elements.headerTime.dateTime = snapshot.generatedAt;
  }

  function renderPeople() {
    const figures = state.data.figures;
    const signals = figures.reduce((total, figure) => total + figure.sourceCount, 0);
    elements.peopleSummary.textContent = `${figures.length} 位人物 · ${signals.toLocaleString("zh-CN")} 条近 7 天公开动态 · ${figures.reduce((t, f) => t + f.themes.length, 0)} 个讨论主题`;
    elements.peopleList.replaceChildren();
    figures.forEach((figure) => {
      const button = document.createElement("button"); button.type = "button"; button.className = "person-card";
      button.classList.toggle("is-active", figure.id === state.activeFigureId); button.setAttribute("aria-pressed", String(figure.id === state.activeFigureId));
      button.append(createAvatar("person-avatar", figure), createPersonCopy(figure), createElement("strong", "person-score", `${figure.themes[0].score}`));
      button.addEventListener("click", () => selectFigure(figure.id)); elements.peopleList.appendChild(button);
    });
  }

  function createPersonCopy(figure) {
    const copy = document.createElement("div");
    copy.append(createElement("h3", null, figure.nameZh), createElement("p", null, `${figure.name} · ${figure.role}`));
    const meta = createElement("div", "person-meta");
    meta.append(createElement("span", null, `Top：${figure.themes[0].name}`), createElement("span", null, `${figure.postsAnalyzed} 条动态`)); copy.appendChild(meta);
    return copy;
  }

  function selectFigure(id) {
    state.activeFigureId = id; state.activeThemeId = activeFigure().themes[0]?.id || null;
    renderPeople(); renderFigure(); renderThemes(); syncSelectionUrl();
  }

  function renderFigure() {
    const figure = activeFigure(); elements.selectedFigure.replaceChildren();
    elements.headerContext.textContent = `当前人物 · ${figure.nameZh}`;
    const identity = document.createElement("div");
    const accounts = createElement("div", "verified-account");
    figure.accounts.forEach((account) => {
      const provider = account.provider && account.provider !== account.platform ? ` · ${account.provider} 归档` : "";
      accounts.appendChild(createElement("span", null, `${account.platform} ${account.handle}${provider}${account.manual ? " · 人工采集" : ""}`));
    });
    identity.append(createElement("h2", null, figure.nameZh), createElement("p", null, `${figure.name} · ${figure.role} · ${figure.analysisWindow}兴趣分析`), accounts);
    const metrics = createElement("dl", "figure-metrics");
    metrics.append(createMetric("分析动态", figure.postsAnalyzed), createMetric("覆盖天数", activePostDays(figure)), createMetric("讨论主题", figure.themes.length));
    elements.selectedFigure.append(createAvatar("selected-avatar", figure), identity, metrics);
  }

  function renderThemes() {
    const figure = activeFigure(); elements.themeList.replaceChildren();
    figure.themes.forEach((theme, index) => {
      const card = document.createElement("article"); card.className = "theme-card";
      card.classList.toggle("is-active", theme.id === state.activeThemeId);
      const button = document.createElement("button"); button.type = "button"; button.className = "theme-select";
      button.setAttribute("aria-pressed", String(theme.id === state.activeThemeId));
      const rank = createElement("span", "theme-rank", String(index + 1).padStart(2, "0"));
      const copy = createElement("div", "theme-copy");
      const change = theme.change > 0 ? `+${theme.change}` : String(theme.change);
      const top = createElement("div", "theme-title-row"); top.append(createElement("h3", null, theme.name), createElement("span", `trend ${theme.change >= 10 ? "hot" : ""}`, `${theme.trend} ${change}`));
      const keywords = createElement("div", "keyword-row"); theme.keywords.slice(0, 4).forEach((word) => keywords.appendChild(createElement("span", null, word)));
      copy.append(top, createElement("p", null, theme.summary), keywords);
      const score = createElement("div", "theme-score"); score.append(createElement("strong", null, String(theme.score)), createElement("small", null, "关注度"));
      const bar = createElement("i", "score-bar"); bar.style.setProperty("--score", `${theme.score}%`); score.appendChild(bar);
      button.append(rank, copy, score); button.addEventListener("click", () => { state.activeThemeId = theme.id; renderThemes(); syncSelectionUrl(); });
      card.append(button, createMarketPreview(theme));
      elements.themeList.appendChild(card);
    });
    renderEvidence(activeTheme());
  }

  function createMarketPreview(theme) {
    const panel = createElement("section", "theme-market-preview");
    panel.setAttribute("aria-label", `${theme.name}相关事件行情`);
    const impact = theme.marketImpact;
    const heading = createElement("div", "market-preview-heading");
    heading.append(createElement("strong", null, "事件 × 市场反应"));
    if (!impact) {
      heading.append(createElement("span", "market-status neutral", "未建立可信映射"));
      panel.append(heading, createElement("p", "market-preview-empty", "本期动态没有可精确归属到该主题的币价事件，不补画无关行情。"));
      return panel;
    }

    const reactions = [...(impact.reactions || [])].sort((left, right) => {
      const currentDelta = Number(right.isCurrentWindow !== false) - Number(left.isCurrentWindow !== false);
      return currentDelta || new Date(right.eventAt) - new Date(left.eventAt);
    });
    const groups = groupBy(reactions, (reaction) => reaction.sourceId);
    const unavailable = impact.unavailableEvents || [];
    heading.append(createElement("span", `market-status ${impact.status || "neutral"}`, marketImpactLabel(impact.status)));
    panel.appendChild(heading);

    if (!groups.length && unavailable.length) {
      const symbols = [...new Set(unavailable.map((event) => event.asset?.symbol).filter(Boolean))].join(" · ");
      panel.append(createElement("p", "market-preview-empty insufficient", `${symbols || "候选资产"} 历史小时行情覆盖不足，暂不判断事件影响。`));
      return panel;
    }
    if (!groups.length) {
      panel.append(createElement("p", "market-preview-empty", "当前快照没有可绘制的事件行情。"));
      return panel;
    }

    const eventList = createElement("div", "market-event-list");
    groups.slice(0, 2).forEach((group) => eventList.appendChild(createMarketEvent(group)));
    panel.appendChild(eventList);
    if (groups.length > 2) panel.appendChild(createElement("small", "market-more", `进入数据故事查看另外 ${groups.length - 2} 个事件`));
    return panel;
  }

  function createMarketEvent(reactions) {
    const reaction = reactions.find((item) => item.isCurrentWindow !== false) || reactions[0];
    const card = createElement("article", `market-event ${reaction.significance?.passed === false ? "ordinary" : ""}`);
    const top = createElement("div", "market-event-top");
    const title = createElement("div");
    title.append(createElement("strong", null, reaction.eventTitle || "相关公开动态"), createElement("time", null, formatDateTime(reaction.eventAt)));
    const symbols = [...new Set(reactions.map((item) => item.asset?.symbol).filter(Boolean))].join(" · ");
    top.append(title, createElement("span", null, symbols || "资产"));
    const chart = createSparkline(reaction);
    const metrics = createElement("div", "market-event-metrics");
    metrics.append(
      createElement("span", null, `+1h ${formatSigned(reaction.metrics?.return1h)}`),
      createElement("span", null, `+6h ${formatSigned(reaction.metrics?.return6h)}`),
      createElement("span", null, `+24h ${formatSigned(reaction.metrics?.return24h)}`),
    );
    card.append(top, chart, metrics);
    return card;
  }

  function createSparkline(reaction) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "market-sparkline"); svg.setAttribute("viewBox", "0 0 280 76"); svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `${reaction.asset?.symbol || "资产"} 在事件前后价格变化曲线`);
    const points = (reaction.points || []).map((point) => ({ hours: Number(point.hours), value: Number(point.change) })).filter((point) => Number.isFinite(point.hours) && Number.isFinite(point.value));
    if (points.length < 2) return svg;
    const minHour = Math.min(...points.map((point) => point.hours)); const maxHour = Math.max(...points.map((point) => point.hours));
    const values = [...points.map((point) => point.value), 0]; const min = Math.min(...values); const max = Math.max(...values); const range = Math.max(1, max - min);
    const x = (hours) => 8 + ((hours - minHour) / Math.max(1, maxHour - minHour)) * 264;
    const y = (value) => 66 - ((value - min) / range) * 54;
    const baseline = document.createElementNS(SVG_NS, "line"); baseline.setAttribute("class", "spark-baseline"); baseline.setAttribute("x1", "8"); baseline.setAttribute("x2", "272"); baseline.setAttribute("y1", String(y(0))); baseline.setAttribute("y2", String(y(0)));
    const eventLine = document.createElementNS(SVG_NS, "line"); eventLine.setAttribute("class", "spark-event-line"); eventLine.setAttribute("x1", String(x(0))); eventLine.setAttribute("x2", String(x(0))); eventLine.setAttribute("y1", "7"); eventLine.setAttribute("y2", "69");
    const path = document.createElementNS(SVG_NS, "path"); path.setAttribute("class", "spark-path"); path.setAttribute("d", points.map((point, index) => `${index ? "L" : "M"}${x(point.hours).toFixed(1)} ${y(point.value).toFixed(1)}`).join(" "));
    const label = document.createElementNS(SVG_NS, "text"); label.setAttribute("class", "spark-label"); label.setAttribute("x", String(x(0) + 4)); label.setAttribute("y", "13"); label.textContent = "T=0";
    svg.append(baseline, eventLine, path, label); return svg;
  }

  function renderEvidence(theme) {
    if (!theme) return;
    elements.evidencePanel.replaceChildren();
    const header = createElement("header", "evidence-header");
    const headerTop = createElement("div", "evidence-header-top");
    const title = createElement("div"); title.append(createElement("p", "eyebrow", theme.category), createElement("h2", null, theme.name));
    const actions = createElement("div", "evidence-actions");
    actions.append(createElement("span", "confidence-badge", `${theme.confidence}置信度`));
    const action = createElement("a", "story-button", "进入主题数据故事"); action.href = buildStoryUrl(theme); action.appendChild(createElement("span", null, "→")); actions.appendChild(action);
    headerTop.append(title, actions);
    header.append(headerTop, createElement("p", "evidence-about", theme.why));

    const body = createElement("div", "evidence-body");
    const scores = createElement("section", "evidence-section"); scores.appendChild(createElement("h3", null, "主题评分依据"));
    const scoreGrid = createElement("div", "score-grid");
    const scoreLabels = theme.scoreLabels || ["出现频率", "时间新鲜度", "跨日连续性"];
    scoreGrid.append(createScore(scoreLabels[0], theme.scoreBreakdown.frequency), createScore(scoreLabels[1], theme.scoreBreakdown.freshness), createScore(scoreLabels[2], theme.scoreBreakdown.continuity)); scores.appendChild(scoreGrid);
    const keywords = createElement("section", "evidence-section"); keywords.appendChild(createElement("h3", null, "提取关键词"));
    const keywordCloud = createElement("div", "keyword-cloud"); theme.keywords.forEach((word, index) => keywordCloud.appendChild(createElement("span", index < 2 ? "is-strong" : null, word))); keywords.appendChild(keywordCloud);
    const proofs = createElement("section", "evidence-section proof-section");
    const proofTitle = createElement("div", "proof-title"); proofTitle.append(createElement("h3", null, "公开动态证据"), createElement("span", null, evidenceLabel(theme.evidenceBreakdown))); proofs.appendChild(proofTitle);
    const list = createElement("div", "proof-list"); theme.evidence.forEach((item) => list.appendChild(createProof(item))); proofs.appendChild(list);
    body.append(scores, keywords, proofs); elements.evidencePanel.append(header, body);
  }

  function createScore(label, value) {
    const item = createElement("div", "score-item"); item.append(createElement("span", null, label), createElement("strong", null, String(value)));
    const track = createElement("i"); track.style.setProperty("--value", `${value}%`); item.appendChild(track); return item;
  }

  function createProof(item) {
    const article = createElement("article", "proof-card");
    const kindLabel = ({ original: "原创动态", quote: "引用动态", reply: "回复动态" })[item.kind] || "公开动态";
    const top = createElement("div", "proof-top"); top.append(createElement("span", `source-type ${item.kind || "original"}`, kindLabel), createElement("time", null, formatDateTime(item.time)));
    const words = createElement("div", "proof-keywords"); item.keywords.forEach((word) => words.appendChild(createElement("span", null, word)));
    article.append(top, createElement("h4", null, item.title), createElement("p", null, item.summary), words); return article;
  }

  function buildStoryUrl(theme) {
    const figure = activeFigure();
    return `./event-explorer.html?${new URLSearchParams({ figureId: figure.id, theme: theme.storyId, snapshot: state.data.snapshotId }).toString()}`;
  }

  function syncSelectionUrl() {
    const figure = activeFigure();
    const theme = activeTheme();
    if (!figure || !theme || !state.data?.snapshotId) return;
    const nextUrl = new URL(location.href);
    nextUrl.searchParams.set("snapshot", state.data.snapshotId);
    nextUrl.searchParams.set("figureId", figure.id);
    nextUrl.searchParams.set("theme", theme.storyId || theme.id);
    history.replaceState(null, "", nextUrl);
  }

  function activeFigure() { return state.data?.figures.find((item) => item.id === state.activeFigureId) || null; }
  function activeTheme() { return activeFigure()?.themes.find((item) => item.id === state.activeThemeId) || null; }
  function activePostDays(figure) { return new Set(figure.themes.flatMap((theme) => theme.evidence.map((item) => String(item.time).slice(0, 10)))).size; }
  function groupBy(items, keyFor) { const groups = new Map(); items.forEach((item) => { const key = keyFor(item); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item); }); return [...groups.values()]; }
  function marketImpactLabel(status) { return ({ strong: "强异常", notable: "显著波动", ordinary: "普通波动", insufficient: "数据不足", historical: "历史验证", unmapped: "未映射" })[status] || "已匹配行情"; }
  function formatSigned(value) { const number = Number(value); return Number.isFinite(number) ? `${number > 0 ? "+" : ""}${number.toFixed(2)}%` : "待观察"; }
  function evidenceLabel(breakdown) { return `${breakdown.originals || 0} 条原创 · ${breakdown.quotes || 0} 条引用 · ${breakdown.replies || 0} 条回复`; }
  function createMetric(label, value) { const div = document.createElement("div"); div.append(createElement("dt", null, label), createElement("dd", null, String(value))); return div; }
  function createAvatar(className, figure) { const wrapper = createElement("span", className); if (figure.avatar) { const image = document.createElement("img"); image.src = figure.avatar; image.alt = `${figure.nameZh}头像`; wrapper.appendChild(image); } else wrapper.textContent = figure.initials; return wrapper; }
  function createElement(tag, className, text) { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; }
  function formatTime(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date); }
  function formatDateTime(value) { return formatTime(value); }
  function readContext() {
    const params = new URLSearchParams(location.search);
    return { snapshot: params.get("snapshot"), figureId: params.get("figureId"), theme: params.get("theme") };
  }
  function openLoading() { elements.syncOverlay.hidden = false; elements.syncDetail.textContent = "正在读取已发布快照索引"; setLoadingStep(0); }
  function closeLoading() { elements.syncOverlay.hidden = true; }
  async function advanceLoading(step, detail) { await new Promise((resolve) => window.setTimeout(resolve, 320)); setLoadingStep(step); elements.syncDetail.textContent = detail; }
  function setLoadingStep(step) { [...elements.syncSteps.children].forEach((item, index) => { item.classList.toggle("is-active", index === step); item.classList.toggle("is-done", index < step); }); }
  function showToast(message) { window.clearTimeout(state.toastTimer); elements.toast.textContent = message; elements.toast.hidden = false; state.toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 3400); }
  function renderError(error) { elements.peopleSummary.textContent = "兴趣数据暂时不可用"; elements.peopleList.innerHTML = `<div class="load-error">读取失败：${escapeHtml(error.message || "未知错误")}</div>`; elements.sourceTitle.textContent = "数据连接失败"; elements.sourceDescription.textContent = "页面不会使用临时猜测结果替代。"; elements.headerStatus.textContent = "加载失败"; elements.headerTime.textContent = "请返回后重试"; }
  function escapeHtml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
})();
