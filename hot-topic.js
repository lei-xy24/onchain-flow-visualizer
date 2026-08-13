(function () {
  "use strict";

  const API_URL = "";
  const DEMO_URL = "./mock-social-radar.json?v=20260813-v2";
  const state = {
    data: null,
    activeFigureId: null,
    activeFollowId: null,
    filter: "recent",
    query: "",
    toastTimer: null,
  };

  const elements = {
    sourceSignal: document.getElementById("source-signal"),
    sourceTitle: document.getElementById("source-title"),
    sourceDescription: document.getElementById("source-description"),
    sourceMode: document.getElementById("source-mode"),
    sourceTime: document.getElementById("source-time"),
    sourceCadence: document.getElementById("source-cadence"),
    refresh: document.getElementById("refresh-data"),
    peopleSummary: document.getElementById("people-summary"),
    peopleList: document.getElementById("people-list"),
    selectedFigure: document.getElementById("selected-figure"),
    filterTabs: document.getElementById("filter-tabs"),
    followSearch: document.getElementById("follow-search"),
    followList: document.getElementById("follow-list"),
    evidencePanel: document.getElementById("evidence-panel"),
    countRecent: document.getElementById("count-recent"),
    countCrypto: document.getElementById("count-crypto"),
    countTrackable: document.getElementById("count-trackable"),
    countAll: document.getElementById("count-all"),
    syncOverlay: document.getElementById("sync-overlay"),
    syncTitle: document.getElementById("sync-title"),
    syncDetail: document.getElementById("sync-detail"),
    syncSteps: document.getElementById("sync-steps"),
    toast: document.getElementById("radar-toast"),
  };

  initialize();

  function initialize() {
    bindControls();
    loadRadarData({ showLoading: false });
  }

  function bindControls() {
    elements.refresh.addEventListener("click", () => loadRadarData({ showLoading: true }));
    elements.filterTabs.addEventListener("click", (event) => {
      const button = event.target.closest("[data-filter]");
      if (!button) return;
      state.filter = button.dataset.filter;
      elements.filterTabs.querySelectorAll("[data-filter]").forEach((item) => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", String(active));
      });
      state.activeFollowId = null;
      renderFollowList();
    });
    elements.followSearch.addEventListener("input", () => {
      state.query = elements.followSearch.value.trim().toLowerCase();
      state.activeFollowId = null;
      renderFollowList();
    });
  }

  async function loadRadarData({ showLoading }) {
    elements.refresh.disabled = true;
    if (showLoading) openSyncOverlay();
    try {
      const response = await fetch(API_URL || DEMO_URL, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (showLoading) await advanceSync(1, "正在比较最新快照与上一份有效记录");
      const payload = await response.json();
      validatePayload(payload);
      if (showLoading) await advanceSync(2, "正在核对社交账号与已审核链上实体");
      state.data = payload;
      if (!payload.figures.some((item) => item.id === state.activeFigureId)) {
        state.activeFigureId = payload.figures[0].id;
      }
      state.activeFollowId = null;
      renderAll();
      if (showLoading) {
        await wait(260);
        showToast(
          payload.meta.isLive
            ? "关注数据已更新。"
            : "已重新读取演示缓存；接入 X 官方 API 后才会获取最新关注数据。"
        );
      }
    } catch (error) {
      renderLoadError(error);
    } finally {
      elements.refresh.disabled = false;
      closeSyncOverlay();
    }
  }

  function validatePayload(payload) {
    if (!payload || !payload.meta || !Array.isArray(payload.figures) || !payload.figures.length) {
      throw new Error("人物关注数据结构不完整");
    }
  }

  function renderAll() {
    renderSourceStatus();
    renderPeople();
    renderSelectedFigure();
    renderCounts();
    renderFollowList();
  }

  function renderSourceStatus() {
    const meta = state.data.meta;
    elements.sourceTitle.textContent = meta.title;
    elements.sourceDescription.textContent = meta.description;
    elements.sourceMode.textContent = meta.modeLabel;
    elements.sourceMode.title = meta.source;
    elements.sourceTime.textContent = formatRelativeTime(meta.syncedAt);
    elements.sourceTime.title = formatFullTime(meta.syncedAt);
    elements.sourceCadence.textContent = meta.cadence;
    elements.sourceSignal.classList.toggle("is-demo", !meta.isLive);
  }

  function renderPeople() {
    const figures = state.data.figures;
    const monitoredAccounts = figures.reduce((total, figure) => total + figure.accounts.length, 0);
    elements.peopleSummary.textContent = `${figures.length} 位人物 · ${monitoredAccounts} 个已核验社交账号 · 数据由后端配置`;
    elements.peopleList.replaceChildren();
    figures.forEach((figure) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "person-card";
      button.classList.toggle("is-active", figure.id === state.activeFigureId);
      button.setAttribute("aria-pressed", String(figure.id === state.activeFigureId));
      button.style.setProperty("--avatar-a", figure.colors[0]);
      button.style.setProperty("--avatar-b", figure.colors[1]);

      button.append(
        createAvatar("person-avatar", figure.initials, figure.avatar, `${figure.nameZh}头像`),
        createPersonCardCopy(figure),
        createElement("strong", null, figure.newCount ? `+${figure.newCount}` : "—")
      );
      button.addEventListener("click", () => selectFigure(figure.id));
      elements.peopleList.appendChild(button);
    });
  }

  function createPersonCardCopy(figure) {
    const wrapper = document.createElement("div");
    const title = createElement("h3", null, figure.nameZh);
    title.title = figure.name;
    const role = createElement("p", null, `${figure.name} · ${figure.role}`);
    const meta = document.createElement("div");
    meta.className = "person-meta";
    meta.append(
      createElement("span", null, figure.accounts.map((item) => item.platform).join(" / ")),
      createElement("span", null, `可追踪 ${trackableCount(figure)} 项`)
    );
    wrapper.append(title, role, meta);
    return wrapper;
  }

  function selectFigure(figureId) {
    state.activeFigureId = figureId;
    state.activeFollowId = null;
    state.query = "";
    elements.followSearch.value = "";
    renderPeople();
    renderSelectedFigure();
    renderCounts();
    renderFollowList();
  }

  function renderSelectedFigure() {
    const figure = getActiveFigure();
    elements.selectedFigure.replaceChildren();
    elements.selectedFigure.style.setProperty("--avatar-a", figure.colors[0]);
    elements.selectedFigure.style.setProperty("--avatar-b", figure.colors[1]);

    const identity = document.createElement("div");
    const heading = createElement("h2", null, figure.nameZh);
    const role = createElement("p", null, `${figure.name} · ${figure.role} · 最近成功同步 ${formatRelativeTime(figure.lastSuccessAt)}`);
    const accounts = document.createElement("div");
    accounts.className = "verified-account";
    figure.accounts.forEach((account) => {
      const suffix = account.manual ? " · 人工来源" : "";
      accounts.appendChild(createElement("span", null, `${account.platform} ${account.handle}${suffix}`));
    });
    identity.append(heading, role, accounts);

    const metrics = document.createElement("dl");
    metrics.className = "figure-metrics";
    metrics.append(
      createMetric("公开关注", formatCompactNumber(figure.followingCount)),
      createMetric("近期变化", countRecent(figure)),
      createMetric("可追踪", trackableCount(figure))
    );
    elements.selectedFigure.append(
      createAvatar("selected-avatar", figure.initials, figure.avatar, `${figure.nameZh}头像`),
      identity,
      metrics
    );
  }

  function renderCounts() {
    const figure = getActiveFigure();
    elements.countRecent.textContent = countRecent(figure);
    elements.countCrypto.textContent = figure.follows.filter((item) => item.crypto).length;
    elements.countTrackable.textContent = trackableCount(figure);
    elements.countAll.textContent = figure.follows.length;
  }

  function renderFollowList() {
    const figure = getActiveFigure();
    if (!figure) return;
    const visible = figure.follows.filter(matchesCurrentView);
    elements.followList.replaceChildren();

    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "follow-empty";
      empty.textContent = state.query
        ? "没有找到匹配的关注对象。"
        : "当前筛选下没有记录；这不代表接口异常。";
      elements.followList.appendChild(empty);
      renderEmptyEvidence();
      return;
    }

    if (!visible.some((item) => item.id === state.activeFollowId)) {
      state.activeFollowId = visible[0].id;
    }

    visible.forEach((follow) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "follow-row";
      button.classList.toggle("is-active", follow.id === state.activeFollowId);
      button.setAttribute("aria-pressed", String(follow.id === state.activeFollowId));
      button.append(createAccountSummary(follow), createChangeStatus(follow), createMappingSummary(follow));
      button.addEventListener("click", () => {
        state.activeFollowId = follow.id;
        renderFollowList();
      });
      elements.followList.appendChild(button);
    });
    renderEvidence(visible.find((item) => item.id === state.activeFollowId));
  }

  function matchesCurrentView(follow) {
    const matchesFilter =
      state.filter === "all" ||
      (state.filter === "recent" && follow.status !== "baseline") ||
      (state.filter === "crypto" && follow.crypto) ||
      (state.filter === "trackable" && follow.targets.length > 0);
    if (!matchesFilter) return false;
    if (!state.query) return true;
    const searchable = [follow.name, follow.handle, follow.bio, follow.platform, ...follow.categories]
      .join(" ")
      .toLowerCase();
    return searchable.includes(state.query);
  }

  function createAccountSummary(follow) {
    const wrapper = document.createElement("div");
    wrapper.className = "account-summary";
    wrapper.style.setProperty("--avatar-a", follow.colors[0]);
    wrapper.style.setProperty("--avatar-b", follow.colors[1]);
    const copy = document.createElement("div");
    copy.className = "account-copy";
    const name = createElement("h3", null, `${follow.name}${follow.verified ? " ✓" : ""}`);
    const bio = createElement("p", null, `${follow.platform} ${follow.handle} · ${follow.bio}`);
    const tags = document.createElement("div");
    tags.className = "account-tags";
    follow.categories.slice(0, 2).forEach((tag) => tags.appendChild(createElement("span", null, tag)));
    copy.append(name, bio, tags);
    wrapper.append(createAvatar("account-avatar", follow.initials), copy);
    return wrapper;
  }

  function createChangeStatus(follow) {
    const wrapper = document.createElement("div");
    wrapper.className = "change-status";
    const labels = {
      new: ["新增关注", "new"],
      removed: ["检测到取消", "removed"],
      baseline: ["首次基线", "baseline"],
    };
    const [label, className] = labels[follow.status] || labels.baseline;
    wrapper.append(
      createElement("span", `status-chip ${className}`, label),
      createElement("small", null, `${follow.window} · ${formatRelativeTime(follow.detectedAt)}`)
    );
    return wrapper;
  }

  function createMappingSummary(follow) {
    const wrapper = document.createElement("div");
    wrapper.className = "mapping-summary";
    if (follow.targets.length) {
      wrapper.append(
        createElement("span", "mapping-chip trackable", `${follow.targets.length} 个已核验目标`),
        createElement("strong", null, follow.targets[0].type),
        createElement("small", null, `${follow.targets[0].network} · 可信度 ${follow.confidence}`)
      );
    } else {
      wrapper.append(
        createElement("span", "mapping-chip", follow.crypto ? "待核验映射" : "非区块链对象"),
        createElement("strong", null, follow.crypto ? "暂不开放追踪" : "无需链上追踪"),
        createElement("small", null, follow.crypto ? "未找到可靠地址证据" : "仅保留社交关系记录")
      );
    }
    return wrapper;
  }

  function renderEvidence(follow) {
    if (!follow) {
      renderEmptyEvidence();
      return;
    }
    elements.evidencePanel.replaceChildren();

    const header = document.createElement("header");
    header.className = "evidence-header";
    const top = document.createElement("div");
    top.className = "evidence-header-top";
    const account = document.createElement("div");
    account.className = "evidence-account";
    account.style.setProperty("--avatar-a", follow.colors[0]);
    account.style.setProperty("--avatar-b", follow.colors[1]);
    const copy = document.createElement("div");
    copy.append(createElement("h2", null, follow.name), createElement("p", null, `${follow.platform} ${follow.handle}`));
    account.append(createAvatar("account-avatar", follow.initials), copy);
    top.append(account);
    if (follow.confidence) top.appendChild(createElement("span", "confidence-badge", `核验等级 ${follow.confidence}`));
    header.append(top, createElement("p", "evidence-about", follow.bio));

    const body = document.createElement("div");
    body.className = "evidence-body";
    body.append(createSocialEvidenceSection(follow), createTargetsSection(follow));
    elements.evidencePanel.append(header, body);
  }

  function createSocialEvidenceSection(follow) {
    const section = document.createElement("section");
    section.className = "evidence-section";
    section.appendChild(createElement("h3", null, "社交关系证据"));
    const grid = document.createElement("div");
    grid.className = "social-proof";
    grid.append(
      createProof("数据平台", follow.platform),
      createProof("关系状态", statusLabel(follow.status)),
      createProof("检测窗口", follow.window),
      createProof("证据类型", follow.relationEvidence)
    );
    section.appendChild(grid);
    return section;
  }

  function createTargetsSection(follow) {
    const section = document.createElement("section");
    section.className = "evidence-section";
    section.appendChild(createElement("h3", null, "可追踪链上实体"));
    if (!follow.targets.length) {
      section.appendChild(
        createElement(
          "div",
          "unmapped-note",
          follow.crypto
            ? "已识别为区块链相关账号，但当前没有经过来源核验的链上地址，因此不提供一键追踪。"
            : "该账号目前未被识别为区块链相关对象，仅展示公开社交关注关系。"
        )
      );
      return section;
    }
    const list = document.createElement("div");
    list.className = "target-list";
    follow.targets.forEach((target) => list.appendChild(createTargetCard(target)));
    section.appendChild(list);
    return section;
  }

  function createTargetCard(target) {
    const card = document.createElement("article");
    card.className = "target-card";
    const top = document.createElement("div");
    top.className = "target-top";
    top.append(createElement("strong", null, target.name), createElement("span", null, target.type));
    const address = createElement("code", "target-address", target.address);
    const evidence = document.createElement("div");
    evidence.className = "target-evidence";
    evidence.append(
      createElement("span", null, target.evidence),
      createElement("span", null, `核验于 ${target.verifiedAt}`)
    );
    const action = createElement("a", "track-button", target.action);
    action.href = `./result.html?chain=${encodeURIComponent(target.chain)}&address=${encodeURIComponent(target.address)}`;
    action.appendChild(createElement("span", null, "→"));
    card.append(top, address, evidence, action);
    return card;
  }

  function renderEmptyEvidence() {
    elements.evidencePanel.innerHTML = `
      <div class="empty-detail">
        <span aria-hidden="true">⌖</span>
        <h2>没有可展示的对象</h2>
        <p>调整筛选条件或搜索内容后，可在这里查看链上映射与证据。</p>
      </div>`;
  }

  function renderLoadError(error) {
    const message = error instanceof Error ? error.message : "未知错误";
    elements.peopleSummary.textContent = "人物关注数据暂时不可用";
    elements.peopleList.innerHTML = `<div class="follow-empty">数据读取失败：${escapeHtml(message)}</div>`;
    elements.followList.innerHTML = `<div class="follow-empty">请检查后端或演示数据文件后重试。</div>`;
    elements.sourceTitle.textContent = "数据连接失败";
    elements.sourceDescription.textContent = "当前无法读取关注快照，页面不会使用猜测数据代替。";
    showToast("关注数据读取失败，请稍后重试。", 4200);
  }

  function openSyncOverlay() {
    elements.syncOverlay.hidden = false;
    elements.syncTitle.textContent = "正在同步关注列表";
    elements.syncDetail.textContent = "正在读取人物与社交账号配置";
    setSyncStep(0);
  }

  function closeSyncOverlay() {
    elements.syncOverlay.hidden = true;
  }

  async function advanceSync(step, detail) {
    await wait(320);
    setSyncStep(step);
    elements.syncDetail.textContent = detail;
  }

  function setSyncStep(activeIndex) {
    [...elements.syncSteps.children].forEach((item, index) => {
      item.classList.toggle("is-active", index === activeIndex);
      item.classList.toggle("is-done", index < activeIndex);
    });
  }

  function showToast(message, duration = 3200) {
    window.clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    state.toastTimer = window.setTimeout(() => {
      elements.toast.hidden = true;
    }, duration);
  }

  function getActiveFigure() {
    return state.data?.figures.find((item) => item.id === state.activeFigureId) || null;
  }

  function countRecent(figure) {
    return figure.follows.filter((item) => item.status !== "baseline").length;
  }

  function trackableCount(figure) {
    return figure.follows.filter((item) => item.targets.length > 0).length;
  }

  function createMetric(label, value) {
    const item = document.createElement("div");
    item.append(createElement("dt", null, label), createElement("dd", null, String(value)));
    return item;
  }

  function createProof(label, value) {
    const item = document.createElement("div");
    item.append(createElement("span", null, label), createElement("strong", null, value));
    return item;
  }

  function createAvatar(className, initials, imageUrl, alt) {
    const avatar = document.createElement("span");
    avatar.className = className;
    if (imageUrl) {
      const image = document.createElement("img");
      image.src = imageUrl;
      image.alt = alt || "";
      avatar.appendChild(image);
    } else {
      avatar.textContent = initials;
    }
    return avatar;
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = text;
    return element;
  }

  function statusLabel(status) {
    return ({ new: "系统检测到新增关注", removed: "系统检测到取消关注", baseline: "首次同步基线" })[status] || "未知";
  }

  function formatRelativeTime(dateValue) {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return "时间未知";
    const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
    if (minutes < 1) return "刚刚";
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function formatFullTime(dateValue) {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return "时间未知";
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(date);
  }

  function formatCompactNumber(value) {
    return new Intl.NumberFormat("zh-CN", { notation: value >= 1000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function wait(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }
})();
