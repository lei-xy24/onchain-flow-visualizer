(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const DATA_URL = "./data/cross-market/latest.json";
  const DEFAULT_ASSETS = ["csi300", "stoxx50", "sp500", "bitcoin"];
  const state = {
    snapshot: null,
    rangeDays: 90,
    correlationWindow: 20,
    selectedAssets: new Set(DEFAULT_ASSETS),
    selectedPairId: null,
    focusRegion: null,
    activeStoryId: null,
    customRange: null,
  };

  const elements = Object.fromEntries([
    "header-status", "header-time", "market-title", "market-mode", "market-lead", "market-conclusions",
    "data-through", "asset-count", "market-regime", "source-label", "market-relay", "range-control",
    "asset-switches", "benchmark-chart", "chart-readout", "correlation-control", "correlation-matrix",
    "pair-title", "pair-sample", "pair-metrics", "pair-chart", "lag-profile", "pair-conclusion",
    "story-grid", "method-note", "market-loading", "loading-title", "loading-steps", "market-error",
    "market-error-copy", "market-retry",
  ].map((id) => [toCamel(id), document.getElementById(id)]));

  elements.rangeControl.addEventListener("click", handleRangeChange);
  elements.correlationControl.addEventListener("click", handleCorrelationChange);
  elements.marketRetry.addEventListener("click", loadSnapshot);
  loadSnapshot();

  async function loadSnapshot() {
    elements.marketError.hidden = true;
    elements.marketLoading.classList.remove("is-hidden");
    setLoadingStep(0, "正在读取已发布市场快照");
    try {
      const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`数据读取失败（HTTP ${response.status}）`);
      const snapshot = await response.json();
      validateSnapshot(snapshot);
      setLoadingStep(1, "正在校验共同交易日与市场时区");
      state.snapshot = snapshot;
      state.selectedPairId = snapshot.summary.strongestPairId || snapshot.pairs[0]?.id || null;
      setLoadingStep(2, "正在绘制跨市场联动关系");
      renderAll();
      requestAnimationFrame(() => elements.marketLoading.classList.add("is-hidden"));
    } catch (error) {
      elements.marketLoading.classList.add("is-hidden");
      elements.marketErrorCopy.textContent = error?.message || "未知错误，请稍后重试。";
      elements.marketError.hidden = false;
      elements.headerStatus.textContent = "加载失败";
      elements.headerTime.textContent = "请重试";
    }
  }

  function validateSnapshot(snapshot) {
    if (snapshot?.schemaVersion !== 1 || snapshot?.status !== "published") throw new Error("市场快照尚未发布或格式不兼容");
    if (!Array.isArray(snapshot.assets) || snapshot.assets.length < 4) throw new Error("市场快照缺少必要资产");
    if (!snapshot.correlations?.["20"]?.values || !snapshot.correlations?.["60"]?.values) throw new Error("市场快照缺少相关矩阵");
    for (const asset of snapshot.assets) {
      if (!asset.id || !Array.isArray(asset.series) || asset.series.length < 2) throw new Error("市场曲线数据不完整");
      if (asset.series.some((point) => !/^\d{4}-\d{2}-\d{2}$/.test(point.date || "") || !Number.isFinite(Number(point.value)))) throw new Error(`${asset.name || asset.id} 曲线数据无效`);
    }
  }

  function renderAll() {
    renderHero();
    renderRelay();
    renderAssetSwitches();
    renderBenchmark();
    renderCorrelationMatrix();
    renderPair();
    renderStories();
    renderMethod();
  }

  function renderHero() {
    const snapshot = state.snapshot;
    elements.marketTitle.textContent = snapshot.summary.headline;
    elements.marketLead.textContent = snapshot.summary.body;
    elements.marketMode.textContent = snapshot.modeLabel;
    elements.marketMode.classList.toggle("is-demo", !snapshot.isLive);
    elements.marketConclusions.replaceChildren(...snapshot.summary.conclusions.map((text) => create("li", null, text)));
    elements.dataThrough.textContent = formatDate(snapshot.dataThrough);
    elements.assetCount.textContent = `${snapshot.assets.length} 类资产`;
    elements.marketRegime.textContent = snapshot.summary.regime;
    elements.sourceLabel.textContent = snapshot.sourceLabel;
    const stale = Date.now() > Date.parse(snapshot.staleAfter);
    elements.headerStatus.textContent = stale ? "最近一次成功快照" : snapshot.isLive ? "每日行情快照" : "演示结构快照";
    elements.headerTime.textContent = formatDateTime(snapshot.generatedAt);
    elements.headerTime.dateTime = snapshot.generatedAt;
  }

  function renderRelay() {
    elements.marketRelay.replaceChildren();
    state.snapshot.regions.forEach((region, index) => {
      const button = create("button", "relay-card");
      button.type = "button";
      button.classList.toggle("is-active", state.focusRegion === region.id);
      button.setAttribute("aria-pressed", String(state.focusRegion === region.id));
      button.append(
        create("small", null, `0${index + 1} · ${region.session}`),
        create("strong", null, region.name),
        create("span", null, `${formatDate(region.latestDate)} · 20日 ${formatSigned(region.change20Pct)}`),
        create("b", classForChange(region.changePct), formatSigned(region.changePct)),
      );
      button.addEventListener("click", () => {
        state.focusRegion = state.focusRegion === region.id ? null : region.id;
        renderRelay();
        renderBenchmark();
      });
      elements.marketRelay.appendChild(button);
    });
  }

  function renderAssetSwitches() {
    elements.assetSwitches.replaceChildren();
    state.snapshot.assets.forEach((asset) => {
      const button = create("button", "asset-chip", asset.shortName);
      button.type = "button";
      button.style.setProperty("--asset-color", asset.color);
      button.setAttribute("aria-pressed", String(state.selectedAssets.has(asset.id)));
      button.addEventListener("click", () => {
        if (state.selectedAssets.has(asset.id) && state.selectedAssets.size > 1) state.selectedAssets.delete(asset.id);
        else state.selectedAssets.add(asset.id);
        renderAssetSwitches();
        renderBenchmark();
      });
      elements.assetSwitches.appendChild(button);
    });
  }

  function renderBenchmark() {
    const svg = elements.benchmarkChart;
    const assets = state.snapshot.assets.filter((asset) => state.selectedAssets.has(asset.id));
    const range = resolveRange(assets);
    svg.replaceChildren(svgTitle("跨市场归一化走势图"), svgDescription(`展示 ${range.from} 至 ${range.to} 的基准 100 走势。`));
    const plot = { left: 58, top: 28, right: 990, bottom: 375 };
    const normalized = assets.map((asset) => ({ asset, points: normalizeRange(asset.series, range.from, range.to) })).filter((item) => item.points.length > 1);
    const allValues = normalized.flatMap((item) => item.points.map((point) => point.value));
    if (!allValues.length) return renderEmptyChart(svg, "当前区间没有足够数据");
    let min = Math.min(...allValues);
    let max = Math.max(...allValues);
    const padding = Math.max((max - min) * 0.12, 2);
    min -= padding;
    max += padding;
    const x = (date) => plot.left + ((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / Math.max(1, Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`))) * (plot.right - plot.left);
    const y = (value) => plot.bottom - ((value - min) / Math.max(0.0001, max - min)) * (plot.bottom - plot.top);
    for (let index = 0; index <= 4; index += 1) {
      const value = min + ((max - min) * index) / 4;
      const lineY = y(value);
      svg.append(svgEl("line", { x1: plot.left, y1: lineY, x2: plot.right, y2: lineY, class: Math.abs(value - 100) < (max - min) / 10 ? "chart-grid chart-zero" : "chart-grid" }));
      svg.append(svgText(plot.left - 10, lineY + 3, value.toFixed(0), "chart-axis-label", "end"));
    }
    [range.from, midpointDate(range.from, range.to), range.to].forEach((date, index) => svg.append(svgText(index === 0 ? plot.left : index === 1 ? (plot.left + plot.right) / 2 : plot.right, 405, formatShortDate(date), "chart-axis-label", index === 0 ? "start" : index === 1 ? "middle" : "end")));
    normalized.forEach(({ asset, points }) => {
      const path = svgEl("path", { d: linePath(points, x, y), class: `chart-line${state.focusRegion && state.focusRegion !== asset.region ? " is-muted" : ""}`, stroke: asset.color });
      path.appendChild(svgEl("title", {}, `${asset.name}：区间 ${formatSigned(points.at(-1).value - 100)}`));
      svg.appendChild(path);
      const last = points.at(-1);
      svg.append(svgText(Math.min(plot.right + 7, 1_050), y(last.value) + 3, asset.shortName, "chart-end-label", "start", { fill: asset.color }));
    });
    const story = state.snapshot.stories.find((item) => item.id === state.activeStoryId);
    elements.chartReadout.textContent = story ? `正在查看“${story.label}”区间：${formatDate(story.from)} 至 ${formatDate(story.to)}。` : `${formatDate(range.from)} 至 ${formatDate(range.to)}；每条曲线均以区间第一个有效值为 100。`;
  }

  function renderCorrelationMatrix() {
    const windowData = state.snapshot.correlations[String(state.correlationWindow)];
    const table = create("table", "correlation-table");
    table.appendChild(create("caption", null, `${state.correlationWindow} 日收益率相关矩阵`));
    const head = create("thead");
    const headRow = create("tr");
    headRow.appendChild(create("th", null, `${state.correlationWindow}日`));
    state.snapshot.assets.forEach((asset) => headRow.appendChild(create("th", null, asset.shortName)));
    head.appendChild(headRow);
    const body = create("tbody");
    state.snapshot.assets.forEach((left) => {
      const row = create("tr");
      row.appendChild(create("th", null, left.shortName));
      state.snapshot.assets.forEach((right) => {
        const value = Number(windowData.values[left.id][right.id]);
        const cell = create("td");
        const button = create("button", `matrix-cell${left.id === right.id ? " is-diagonal" : ""}`, value.toFixed(2));
        button.type = "button";
        button.style.setProperty("--cell-color", correlationColor(value, left.id === right.id));
        if (left.id === right.id) {
          button.disabled = true;
          button.setAttribute("aria-label", `${left.name}自身相关系数 1`);
        } else {
          const pair = findPair(left.id, right.id);
          button.setAttribute("aria-label", `${left.name}与${right.name}的${state.correlationWindow}日相关系数 ${value.toFixed(2)}`);
          button.setAttribute("aria-pressed", String(pair?.id === state.selectedPairId));
          button.addEventListener("click", () => {
            if (!pair) return;
            state.selectedPairId = pair.id;
            renderCorrelationMatrix();
            renderPair();
          });
        }
        cell.appendChild(button);
        row.appendChild(cell);
      });
      body.appendChild(row);
    });
    table.append(head, body);
    elements.correlationMatrix.replaceChildren(table);
  }

  function renderPair() {
    const pair = state.snapshot.pairs.find((item) => item.id === state.selectedPairId) || state.snapshot.pairs[0];
    if (!pair) return;
    const left = assetById(pair.leftId);
    const right = assetById(pair.rightId);
    elements.pairTitle.textContent = `${left.shortName} × ${right.shortName}`;
    elements.pairSample.textContent = `${pair.sampleSize} 个共同收益样本`;
    elements.pairMetrics.replaceChildren(
      metric("20 日相关", pair.correlation20.toFixed(2)),
      metric("60 日相关", pair.correlation60.toFixed(2)),
      metric("同涨同跌", `${pair.agreement60Pct.toFixed(0)}%`),
    );
    renderPairChart(left, right);
    renderLagProfile(pair.leadLag);
    elements.pairConclusion.textContent = `${pair.leadLag.label}。该结果描述同期或领先滞后关系，不代表因果。`;
  }

  function renderPairChart(left, right) {
    const svg = elements.pairChart;
    const range = resolveRange([left, right]);
    const leftPoints = normalizeRange(left.series, range.from, range.to);
    const rightPoints = normalizeRange(right.series, range.from, range.to);
    svg.replaceChildren(svgTitle(`${left.name}与${right.name}归一化走势`), svgDescription(`展示 ${range.from} 至 ${range.to} 的两资产配对走势。`));
    const all = [...leftPoints, ...rightPoints];
    if (!all.length) return renderEmptyChart(svg, "当前配对没有足够数据");
    const plot = { left: 45, top: 20, right: 650, bottom: 210 };
    let min = Math.min(...all.map((point) => point.value));
    let max = Math.max(...all.map((point) => point.value));
    const padding = Math.max((max - min) * 0.12, 1.5);
    min -= padding; max += padding;
    const x = (date) => plot.left + ((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / Math.max(1, Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`))) * (plot.right - plot.left);
    const y = (value) => plot.bottom - ((value - min) / Math.max(0.0001, max - min)) * (plot.bottom - plot.top);
    [0, 0.5, 1].forEach((ratio) => svg.append(svgEl("line", { x1: plot.left, y1: plot.top + ratio * (plot.bottom - plot.top), x2: plot.right, y2: plot.top + ratio * (plot.bottom - plot.top), class: "chart-grid" })));
    [[left, leftPoints], [right, rightPoints]].forEach(([asset, points]) => {
      svg.append(svgEl("path", { d: linePath(points, x, y), class: "chart-line", stroke: asset.color }));
      svg.append(svgText(plot.right + 8, y(points.at(-1).value) + 3, asset.shortName, "chart-end-label", "start", { fill: asset.color }));
    });
  }

  function renderLagProfile(leadLag) {
    elements.lagProfile.replaceChildren();
    const profile = Array.isArray(leadLag.profile) ? leadLag.profile : [];
    profile.forEach((item) => {
      const wrapper = create("div", `lag-bar${leadLag.stable && item.sessions === leadLag.sessions ? " is-best" : ""}`);
      const bar = create("i");
      bar.style.height = `${Math.max(3, Math.abs(item.correlation) * 58)}px`;
      bar.title = `lag ${item.sessions >= 0 ? "+" : ""}${item.sessions}：${item.correlation.toFixed(2)}`;
      wrapper.append(bar, create("span", null, item.sessions > 0 ? `+${item.sessions}` : String(item.sessions)));
      elements.lagProfile.appendChild(wrapper);
    });
  }

  function renderStories() {
    elements.storyGrid.replaceChildren();
    state.snapshot.stories.forEach((story, index) => {
      const button = create("button", `story-card${story.id === state.activeStoryId ? " is-active" : ""}`);
      button.type = "button";
      button.setAttribute("aria-pressed", String(story.id === state.activeStoryId));
      const inner = create("span", "story-card-inner");
      const asset = assetById(story.metrics.leaderId);
      const laggard = assetById(story.metrics.laggardId);
      const metrics = create("dl");
      metrics.append(
        definition("阶段领先", `${asset.shortName} ${formatSigned(story.metrics.leaderReturnPct)}`),
        definition("阶段承压", `${laggard.shortName} ${formatSigned(story.metrics.laggardReturnPct)}`),
      );
      inner.append(
        create("small", null, `0${index + 1} · ${story.label}`),
        create("h3", null, story.title),
        create("p", null, story.summary),
        metrics,
      );
      button.appendChild(inner);
      button.addEventListener("click", () => {
        state.activeStoryId = state.activeStoryId === story.id ? null : story.id;
        state.customRange = state.activeStoryId ? { from: story.from, to: story.to } : null;
        updatePressed(elements.rangeControl, null, "range");
        renderStories();
        renderBenchmark();
        renderPair();
        document.querySelector(".benchmark-panel")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      });
      elements.storyGrid.appendChild(button);
    });
  }

  function renderMethod() {
    const method = state.snapshot.methodology;
    elements.methodNote.textContent = `走势图基准 ${method.normalizedBase}；相关窗口 ${method.correlationWindows.join("/")} 日；${method.correlationInput}。领先滞后只在样本和提升阈值同时达标时展示，不认定因果。`;
  }

  function handleRangeChange(event) {
    const button = event.target.closest("button[data-range]");
    if (!button) return;
    state.rangeDays = Number(button.dataset.range);
    state.customRange = null;
    state.activeStoryId = null;
    updatePressed(elements.rangeControl, button.dataset.range, "range");
    renderBenchmark();
    renderPair();
    renderStories();
  }

  function handleCorrelationChange(event) {
    const button = event.target.closest("button[data-window]");
    if (!button) return;
    state.correlationWindow = Number(button.dataset.window);
    updatePressed(elements.correlationControl, button.dataset.window, "window");
    renderCorrelationMatrix();
  }

  function resolveRange(assets) {
    if (state.customRange) return state.customRange;
    const to = assets.flatMap((asset) => asset.series.map((point) => point.date)).sort().at(-1);
    const fromDate = new Date(`${to}T00:00:00Z`);
    fromDate.setUTCDate(fromDate.getUTCDate() - state.rangeDays);
    return { from: fromDate.toISOString().slice(0, 10), to };
  }

  function normalizeRange(series, from, to) {
    const points = series.filter((point) => point.date >= from && point.date <= to);
    const base = Number(points[0]?.value);
    return base ? points.map((point) => ({ date: point.date, value: (Number(point.value) / base) * 100 })) : [];
  }

  function findPair(leftId, rightId) {
    return state.snapshot.pairs.find((pair) => (pair.leftId === leftId && pair.rightId === rightId) || (pair.leftId === rightId && pair.rightId === leftId));
  }

  function assetById(id) {
    return state.snapshot.assets.find((asset) => asset.id === id);
  }

  function linePath(points, x, y) {
    return points.map((point, index) => `${index ? "L" : "M"}${x(point.date).toFixed(2)},${y(point.value).toFixed(2)}`).join(" ");
  }

  function correlationColor(value, diagonal) {
    if (diagonal) return "rgba(82, 113, 116, 0.12)";
    const strength = Math.min(0.52, 0.08 + Math.abs(value) * 0.46);
    return value >= 0 ? `rgba(31, 166, 137, ${strength})` : `rgba(210, 83, 82, ${strength})`;
  }

  function setLoadingStep(index, text) {
    elements.loadingTitle.textContent = text;
    [...elements.loadingSteps.children].forEach((item, itemIndex) => {
      item.classList.toggle("is-active", itemIndex === index);
      item.classList.toggle("is-done", itemIndex < index);
    });
  }

  function updatePressed(container, value, dataKey) {
    container.querySelectorAll(`button[data-${dataKey}]`).forEach((button) => button.setAttribute("aria-pressed", String(button.dataset[dataKey] === String(value))));
  }

  function metric(label, value) {
    const article = create("article");
    article.append(create("small", null, label), create("strong", null, value));
    return article;
  }

  function definition(label, value) {
    const wrapper = create("div");
    wrapper.append(create("dt", null, label), create("dd", null, value));
    return wrapper;
  }

  function renderEmptyChart(svg, message) {
    svg.append(svgText(540, 215, message, "chart-axis-label", "middle"));
  }

  function svgEl(name, attributes = {}, text) {
    const element = document.createElementNS(SVG_NS, name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function svgTitle(text) { return svgEl("title", {}, text); }
  function svgDescription(text) { return svgEl("desc", {}, text); }
  function svgText(x, y, text, className, anchor = "start", extra = {}) { return svgEl("text", { x, y, class: className, "text-anchor": anchor, ...extra }, text); }

  function midpointDate(from, to) {
    return new Date((Date.parse(`${from}T00:00:00Z`) + Date.parse(`${to}T00:00:00Z`)) / 2).toISOString().slice(0, 10);
  }

  function formatDate(value) {
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" }).format(date);
  }

  function formatShortDate(value) { return String(value).slice(5).replace("-", "/"); }

  function formatDateTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).format(date);
  }

  function formatSigned(value) {
    const number = Number(value) || 0;
    return `${number >= 0 ? "+" : ""}${number.toFixed(1)}%`;
  }

  function classForChange(value) { return value > 0.05 ? "is-up" : value < -0.05 ? "is-down" : "is-flat"; }

  function create(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function toCamel(value) { return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); }
})();
