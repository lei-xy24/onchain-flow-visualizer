(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const state = { context: readContext(), index: null, snapshot: null, story: null, figure: null, theme: null, chapter: 0, timer: null };
  const elements = Object.fromEntries([
    "figure-avatar","story-category","story-title","story-lead","data-mode","interest-score","origin-copy","origin-theme","boundary-label","boundary-copy","snapshot-grid",
    "previous-chapter","play-story","next-chapter","story-progress","chapter-list","chapter-kicker","chapter-title","chapter-number","chapter-body",
    "signal-view","signal-count","signal-keywords","signal-evidence","trend-view","trend-title","trend-mode-label","trend-chart","ranking-view","ranking-title","ranking-list","ranking-detail",
    "watch-view","watch-grid","narrator-quote","note-figure","note-theme","note-score","note-confidence","snapshot-version","loading-overlay","loading-title","loading-detail","loading-steps"
  ].map((id) => [toCamel(id), document.getElementById(id)]));

  elements.previousChapter.addEventListener("click", () => { stopStory(); selectChapter((state.chapter - 1 + 4) % 4); });
  elements.nextChapter.addEventListener("click", () => { stopStory(); selectChapter((state.chapter + 1) % 4); });
  elements.playStory.addEventListener("click", toggleStory);
  elements.snapshotVersion.addEventListener("change", () => {
    const nextUrl = new URL(location.href); nextUrl.searchParams.set("snapshot", elements.snapshotVersion.value); location.href = nextUrl;
  });
  window.addEventListener("pagehide", stopStory);
  loadData();

  async function loadData() {
    try {
      state.index = await window.SocialRadarSnapshots.loadIndex();
      advanceLoading(1, "正在加载所选版本的主题指标、趋势和排名");
      state.snapshot = await window.SocialRadarSnapshots.loadSnapshot(state.index, state.context.snapshot);
      state.figure = state.snapshot.figures.find((item) => item.id === state.context.figureId) || state.snapshot.figures[0];
      state.theme = state.figure.themes.find((item) => item.storyId === state.context.theme) || state.figure.themes[0];
      state.context.theme = state.theme.storyId;
      state.context.snapshot = state.snapshot.snapshotId;
      state.story = state.theme.story;
      window.SocialRadarSnapshots.populateVersionSelect(elements.snapshotVersion, state.index, state.snapshot.snapshotId);
      const currentUrl = new URL(location.href); currentUrl.searchParams.set("snapshot", state.snapshot.snapshotId); history.replaceState(null, "", currentUrl);
      await wait(320); advanceLoading(2, "正在组合兴趣证据与四个故事章节"); await wait(320);
      renderAll(); elements.loadingOverlay.classList.add("is-hidden");
    } catch (error) {
      elements.loadingTitle.textContent = "主题故事加载失败"; elements.loadingDetail.textContent = `${error.message || "未知错误"}，请返回人物兴趣雷达重试。`;
    }
  }

  function renderAll() {
    renderHero(); renderSnapshots(); renderChapters(); renderSignal(); renderTrend(); renderRanking(); renderWatch(); selectChapter(0);
  }

  function renderHero() {
    const avatar = state.figure.avatar; elements.figureAvatar.replaceChildren();
    if (avatar) { const image = document.createElement("img"); image.src = avatar; image.alt = `${state.figure.nameZh}头像`; elements.figureAvatar.appendChild(image); } else elements.figureAvatar.textContent = state.figure.initials;
    document.documentElement.style.setProperty("--story-accent", state.story.accent);
    elements.storyCategory.textContent = `${state.story.category} · ${state.figure.nameZh}兴趣主题`;
    elements.storyTitle.textContent = state.story.headline; elements.storyLead.textContent = state.story.lead;
    elements.dataMode.textContent = state.snapshot.modeLabel; elements.interestScore.textContent = `${state.theme.score} 关注度`;
    elements.boundaryLabel.textContent = state.snapshot.isLive ? "分析边界" : "演示边界";
    elements.trendModeLabel.textContent = state.snapshot.marketMode === "live-api" ? "实时市场快照" : "演示指标";
    elements.originCopy.textContent = `${state.figure.nameZh}最近 7 天的多条公开动态中，“${state.theme.name}”相关关键词形成稳定主题簇。`;
    elements.originTheme.textContent = state.theme.name; elements.boundaryCopy.textContent = state.snapshot.disclaimer;
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
      button.addEventListener("click", () => { stopStory(); selectChapter(index); }); elements.chapterList.appendChild(button);
    });
  }

  function selectChapter(index) {
    state.chapter = index; const chapter = state.story.chapters[index];
    elements.chapterList.querySelectorAll("[data-index]").forEach((button) => button.classList.toggle("is-active", Number(button.dataset.index) === index));
    elements.chapterKicker.textContent = chapter.kicker; elements.chapterTitle.textContent = chapter.title; elements.chapterNumber.textContent = String(index + 1).padStart(2, "0"); elements.chapterBody.textContent = chapter.body;
    ["signal","trend","ranking","watch"].forEach((view) => { elements[`${view}View`].hidden = view !== chapter.view; });
    elements.storyProgress.textContent = `${index + 1} / ${state.story.chapters.length}`;
    elements.narratorQuote.textContent = narratorText(chapter.view);
    if (state.timer && index === state.story.chapters.length - 1) stopStory();
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

  function renderTrend() {
    elements.trendTitle.textContent = state.story.trend.label; const svg = elements.trendChart; svg.replaceChildren();
    const points = state.story.trend.points; const values = points.map((p) => p.value); const min = Math.min(...values) * 0.86; const max = Math.max(...values) * 1.08;
    const x = (index) => 70 + index * (750 / (points.length - 1)); const y = (value) => 275 - ((value - min) / (max - min)) * 220;
    [0, 1, 2, 3, 4].forEach((index) => { const yy = 55 + index * 55; svg.appendChild(svgEl("line", { class: "chart-grid", x1: 55, x2: 840, y1: yy, y2: yy })); });
    const coords = points.map((point, index) => ({ ...point, x: x(index), y: y(point.value) })); const path = coords.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
    svg.appendChild(svgEl("path", { class: "trend-area", d: `${path} L ${coords.at(-1).x} 275 L ${coords[0].x} 275 Z` })); svg.appendChild(svgEl("path", { class: "trend-line", d: path }));
    coords.forEach((point) => { const circle = svgEl("circle", { class: "trend-point", cx: point.x, cy: point.y, r: 6, tabindex: 0 }); const value = svgEl("text", { class: "point-value", x: point.x, y: point.y - 15, "text-anchor": "middle" }); value.textContent = `${point.value}${state.story.trend.unit === "%" ? "%" : ""}`; const label = svgEl("text", { class: "point-label", x: point.x, y: 304, "text-anchor": "middle" }); label.textContent = point.label; circle.addEventListener("click", () => value.classList.toggle("is-active")); svg.append(circle, value, label); });
  }

  function renderRanking() {
    elements.rankingTitle.textContent = state.story.ranking.label; elements.rankingList.replaceChildren(); const max = Math.max(...state.story.ranking.items.map((item) => item.value));
    state.story.ranking.items.forEach((item, index) => { const button = create("button", "ranking-row"); button.type = "button"; const bar = create("i"); bar.style.setProperty("--bar", `${(item.value / max) * 100}%`); button.append(create("span", "rank-number", String(index + 1).padStart(2, "0")), create("strong", null, item.name), bar, create("b", null, item.display)); button.addEventListener("click", () => { elements.rankingList.querySelectorAll("button").forEach((node) => node.classList.toggle("is-active", node === button)); elements.rankingDetail.textContent = `${item.name} 位列第 ${index + 1}；当前口径：${state.story.ranking.label}，快照时间 ${formatTime(state.snapshot.generatedAt)}。`; }); elements.rankingList.appendChild(button); });
  }

  function renderWatch() {
    elements.watchGrid.replaceChildren(); state.story.watch.forEach((item, index) => { const card = create("article", `watch-card ${item.tone}`); card.append(create("span", null, `0${index + 1}`), create("strong", null, item.metric), create("h3", null, item.title), create("p", null, item.detail)); elements.watchGrid.appendChild(card); });
  }

  function toggleStory() {
    if (state.timer) { stopStory(); return; }
    if (state.chapter === state.story.chapters.length - 1) selectChapter(0); setPlayState(true);
    state.timer = window.setInterval(() => { if (state.chapter >= state.story.chapters.length - 1) { stopStory(); return; } selectChapter(state.chapter + 1); }, 3000);
  }
  function stopStory() { if (state.timer) window.clearInterval(state.timer); state.timer = null; setPlayState(false); }
  function setPlayState(playing) { elements.playStory.classList.toggle("is-playing", playing); elements.playStory.children[1].textContent = playing ? "暂停数据故事" : "播放数据故事"; }
  function narratorText(view) { return ({ signal: `先用“${state.theme.name}”的多条公开动态说明主题怎么得出，强调不是从单条内容下结论。`, trend: "这一章只讲长期变化，不用单日涨跌抢走叙事重点。", ranking: "排名用于解释结构和竞争格局，点击条目可以补充口径说明。", watch: "最后收束成三条可持续观察的问题，为后续真实数据接入留下空间。" })[view]; }
  function readContext() { const params = new URLSearchParams(location.search); return { figureId: params.get("figureId") || "donald-trump", theme: params.get("theme") || "stablecoin", snapshot: params.get("snapshot") }; }
  function advanceLoading(step, detail) { [...elements.loadingSteps.children].forEach((item, index) => { item.classList.toggle("is-active", index === step); item.classList.toggle("is-done", index < step); }); elements.loadingDetail.textContent = detail; }
  function formatTime(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date); }
  function create(tag, className, text) { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; }
  function svgEl(tag, attributes) { const element = document.createElementNS(SVG_NS, tag); Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value)); return element; }
  function toCamel(value) { return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); }
  function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
})();
