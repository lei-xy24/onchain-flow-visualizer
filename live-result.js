import {
  DENSITY_RULES,
  LIVE_CHAINS,
  buildGraphModel,
  formatRawAmount,
  formatUsd,
  parseLiveResponse,
  shortAddress,
  shortHash,
} from "./live-core.js?v=20260717-persistent-nodes";

// Set this to the real HTTPS endpoint after the backend is available.
const BACKEND_API_URL = "";
const POLL_INTERVAL_MS = 10_000;
const MOCK_BATCH_COUNTS = Object.freeze({ eth: 5, bsc: 5, polygon: 5 });

const elements = {
  chainSelect: document.getElementById("live-chain-select"),
  statusDot: document.getElementById("status-dot"),
  statusLabel: document.getElementById("status-label"),
  countdownLabel: document.getElementById("countdown-label"),
  pauseButton: document.getElementById("pause-button"),
  refreshButton: document.getElementById("refresh-button"),
  windowLabel: document.getElementById("window-label"),
  transactionCount: document.getElementById("transaction-count"),
  accountCount: document.getElementById("account-count"),
  totalValue: document.getElementById("total-value"),
  graphCanvas: document.getElementById("graph-canvas"),
  flowGraph: document.getElementById("flow-graph"),
  edgeLayer: document.getElementById("edge-layer"),
  nodeLayer: document.getElementById("node-layer"),
  graphMessage: document.getElementById("graph-message"),
  graphTooltip: document.getElementById("graph-tooltip"),
  densityLegend: document.getElementById("density-legend"),
  transactionList: document.getElementById("transaction-list"),
  inspector: document.getElementById("account-inspector"),
  inspectorLabel: document.getElementById("inspector-label"),
  inspectorAddress: document.getElementById("inspector-address"),
  inspectorIn: document.getElementById("inspector-in"),
  inspectorOut: document.getElementById("inspector-out"),
  inspectorCount: document.getElementById("inspector-count"),
  closeInspector: document.getElementById("close-inspector"),
};

const state = {
  chain: null,
  response: null,
  graph: null,
  fetching: false,
  paused: false,
  nextPollAt: 0,
  mockBatchIndex: 0,
  selectedAddress: null,
  selectedTransferId: null,
  resizeTimer: null,
};

initialize();

function initialize() {
  renderDensityLegend();
  const requestedChain = new URLSearchParams(location.search).get("chain")?.toLowerCase();
  if (!requestedChain || !LIVE_CHAINS[requestedChain]) {
    showFatalState("不支持的币种", "请返回搜索页选择 ETH、BNB 或 POL。");
    return;
  }

  state.chain = requestedChain;
  elements.chainSelect.value = state.chain;
  document.title = `${LIVE_CHAINS[state.chain].label} · 实时交易图谱`;
  bindEvents();
  refreshData({ manual: false });
  window.setInterval(updateCountdown, 250);
}

function bindEvents() {
  elements.chainSelect.addEventListener("change", () => {
    const resultUrl = new URL("./live-result.html", location.href);
    resultUrl.searchParams.set("chain", elements.chainSelect.value);
    location.assign(resultUrl.href);
  });

  elements.pauseButton.addEventListener("click", () => {
    state.paused = !state.paused;
    elements.pauseButton.textContent = state.paused ? "继续" : "暂停";
    if (state.paused) {
      setStatus("已暂停", "自动查询已停止", "paused");
    } else {
      state.nextPollAt = Date.now();
      updateCountdown();
    }
  });

  elements.refreshButton.addEventListener("click", () => {
    refreshData({ manual: true });
  });

  elements.closeInspector.addEventListener("click", () => {
    state.selectedAddress = null;
    state.selectedTransferId = null;
    applySelection();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !state.paused && Date.now() >= state.nextPollAt) {
      refreshData({ manual: false });
    }
  });

  window.addEventListener("resize", () => {
    window.clearTimeout(state.resizeTimer);
    state.resizeTimer = window.setTimeout(() => {
      if (!state.response) return;
      const size = getGraphSize();
      if (state.graph.width === size.width && state.graph.height === size.height) return;
      state.graph = buildGraphModel(
        state.response,
        size.width,
        size.height,
        state.graph,
      );
      renderResponse();
    }, 160);
  });
}

async function refreshData({ manual }) {
  if (state.fetching || !state.chain) return;
  state.fetching = true;
  setStatus("正在查询", manual ? "手动刷新" : "请求最近 10 秒", "loading");

  try {
    const mockBatchNumber = BACKEND_API_URL.trim()
      ? null
      : state.mockBatchIndex + 1;
    const requestUrl = buildRequestUrl();
    const response = await fetch(requestUrl, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const parsed = parseLiveResponse(await response.json(), state.chain);
    state.response = parsed;
    const graphSize = getGraphSize();
    state.graph = buildGraphModel(
      parsed,
      graphSize.width,
      graphSize.height,
      state.graph,
    );
    state.nextPollAt = Date.now() + POLL_INTERVAL_MS;
    if (!BACKEND_API_URL.trim()) {
      state.mockBatchIndex =
        (state.mockBatchIndex + 1) % MOCK_BATCH_COUNTS[state.chain];
    }

    if (
      state.selectedAddress &&
      !state.graph.nodes.some((node) => node.key === state.selectedAddress)
    ) {
      state.selectedAddress = null;
    }
    if (
      state.selectedTransferId &&
      !state.graph.edges.some((edge) => edge.id === state.selectedTransferId)
    ) {
      state.selectedTransferId = null;
    }

    renderResponse();
    if (state.paused) {
      setStatus("已暂停", "手动刷新完成", "paused");
    } else {
      setStatus(
        BACKEND_API_URL.trim()
          ? "实时连接"
          : `演示数据 ${mockBatchNumber}/${MOCK_BATCH_COUNTS[state.chain]}`,
        "10 秒后更新",
        "ready",
      );
    }
  } catch (error) {
    console.error(error);
    state.nextPollAt = Date.now() + POLL_INTERVAL_MS;
    setStatus("查询失败", "10 秒后重试", "error");
    if (!state.response) {
      showGraphMessage(
        "error",
        "暂时无法读取交易数据",
        error instanceof Error ? error.message : "请检查后端响应格式。",
      );
    }
  } finally {
    state.fetching = false;
  }
}

function buildRequestUrl() {
  if (BACKEND_API_URL.trim()) {
    const requestUrl = new URL(BACKEND_API_URL, location.href);
    const to = new Date();
    const from = new Date(to.getTime() - POLL_INTERVAL_MS);
    requestUrl.searchParams.set("chain", state.chain);
    requestUrl.searchParams.set("from", from.toISOString());
    requestUrl.searchParams.set("to", to.toISOString());
    return requestUrl.href;
  }

  return `./mock-live/${state.chain}/batch-${state.mockBatchIndex + 1}.json`;
}

function renderResponse() {
  const chain = LIVE_CHAINS[state.chain];
  const totalUsd = state.response.transfers.reduce(
    (sum, transfer) => sum + transfer.valueUsd,
    0,
  );
  elements.windowLabel.textContent = `${formatWindow(state.response.window)} · ${chain.label}`;
  elements.transactionCount.textContent = String(state.response.transfers.length);
  elements.accountCount.textContent = String(state.graph.nodes.length);
  elements.totalValue.textContent = formatUsd(totalUsd);

  if (state.graph.nodes.length === 0) {
    elements.edgeLayer.replaceChildren();
    elements.nodeLayer.replaceChildren();
    elements.transactionList.innerHTML =
      '<p class="transaction-empty">这个 10 秒窗口没有收到转账记录。</p>';
    showGraphMessage("empty", "当前无交易", "图谱会在下一次查询时自动更新。");
    renderInspector();
    return;
  }

  hideGraphMessage();
  renderGraph(chain);
  if (state.response.transfers.length === 0) {
    elements.transactionList.innerHTML =
      '<p class="transaction-empty">这个 10 秒窗口没有收到转账记录，历史账户节点继续保留。</p>';
  } else {
    renderTransactionList();
  }
  bindGraphEvents();
  applySelection();
}

function renderGraph(chain) {
  elements.flowGraph.setAttribute(
    "viewBox",
    `0 0 ${state.graph.width} ${state.graph.height}`,
  );
  elements.edgeLayer.innerHTML = state.graph.edges
    .map((edge) => {
      const amount = `${formatRawAmount(edge.rawAmount, edge.decimals)} ${edge.asset}`;
      const description = `${edge.fromLabel || shortAddress(edge.from)} 到 ${edge.toLabel || shortAddress(edge.to)}，${amount}，${formatUsd(edge.valueUsd)}`;
      return `<g
        class="flow-edge-group"
        data-transfer-id="${escapeHtml(edge.id)}"
        data-from="${escapeHtml(edge.from.toLowerCase())}"
        data-to="${escapeHtml(edge.to.toLowerCase())}"
      >
        <title>${escapeHtml(description)}</title>
        <path class="flow-edge-base" d="${edge.path}"></path>
        <path
          class="flow-edge-motion"
          d="${edge.path}"
          stroke="${chain.accent}"
          style="--dot-gap: ${edge.density.dotGap}; --edge-width: ${edge.density.width}"
        ></path>
        <path class="flow-edge-hit" d="${edge.path}" data-edge-hit="${escapeHtml(edge.id)}"></path>
      </g>`;
    })
    .join("");

  const showLabels = state.graph.nodes.length <= 18;
  elements.nodeLayer.innerHTML = state.graph.nodes
    .map((node) => {
      const palette = getNodePalette(node.address);
      const label = truncateLabel(node.label, 18);
      const activityClass = node.active ? "is-active" : "is-inactive";
      const ariaLabel = `${node.label}，本窗口 ${node.currentTransactionCount} 笔，累计 ${node.transactionCount} 笔交易，总额 ${formatUsd(node.totalUsd)}`;
      return `<g
        class="account-node ${activityClass}"
        data-node-address="${escapeHtml(node.key)}"
        transform="translate(${node.x} ${node.y})"
        role="button"
        tabindex="0"
        aria-label="${escapeHtml(ariaLabel)}"
        style="--node-fill: ${palette.fill}; --node-stroke: ${palette.stroke}"
      >
        <circle class="node-halo" r="${node.radius + 10}"></circle>
        <circle class="node-core" r="${node.radius}"></circle>
        <text class="node-initials" y="5">${escapeHtml(getInitials(node.label, node.address))}</text>
        ${
          showLabels
            ? `<text class="node-label" y="${node.radius + 24}">${escapeHtml(label)}</text>
               <text class="node-address" y="${node.radius + 39}">${escapeHtml(shortAddress(node.address))}</text>`
            : `<text class="node-address" y="${node.radius + 24}">${escapeHtml(shortAddress(node.address))}</text>`
        }
      </g>`;
    })
    .join("");
}

function renderTransactionList() {
  const transfers = [...state.graph.edges].sort(
    (left, right) => Date.parse(right.time) - Date.parse(left.time),
  );
  elements.transactionList.innerHTML = transfers
    .map((transfer) => {
      const amount = `${formatRawAmount(transfer.rawAmount, transfer.decimals)} ${transfer.asset}`;
      const from = transfer.fromLabel || shortAddress(transfer.from);
      const to = transfer.toLabel || shortAddress(transfer.to);
      return `<button
        class="transaction-row"
        type="button"
        data-transaction-row="${escapeHtml(transfer.id)}"
        aria-label="${escapeHtml(`${from} 向 ${to} 转账 ${amount}`)}"
      >
        <span class="transaction-row-top">
          <span class="transaction-asset">${escapeHtml(amount)}</span>
          <span class="transaction-value">${escapeHtml(formatUsd(transfer.valueUsd))}</span>
        </span>
        <span class="transaction-route">
          <code>${escapeHtml(from)}</code><span aria-hidden="true">→</span><code>${escapeHtml(to)}</code>
        </span>
        <span class="transaction-row-bottom">
          <span>${escapeHtml(formatClock(transfer.time))}</span>
          <span>${escapeHtml(shortHash(transfer.txHash))}</span>
        </span>
      </button>`;
    })
    .join("");
}

function bindGraphEvents() {
  elements.nodeLayer.querySelectorAll("[data-node-address]").forEach((nodeElement) => {
    const address = nodeElement.dataset.nodeAddress;
    nodeElement.addEventListener("click", () => selectAddress(address));
    nodeElement.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectAddress(address);
      }
    });
    nodeElement.addEventListener("pointerenter", (event) => {
      const node = state.graph.nodes.find((item) => item.key === address);
      const activity = node.active ? "本窗口活跃" : "历史账户 · 本窗口无交易";
      showTooltip(
        event,
        `<strong>${escapeHtml(node.label)}</strong><span>${escapeHtml(shortAddress(node.address))}</span><span>${escapeHtml(activity)}</span><span>本窗口 ${node.currentTransactionCount} 笔 · 累计 ${node.transactionCount} 笔</span>`,
      );
    });
    nodeElement.addEventListener("pointermove", moveTooltip);
    nodeElement.addEventListener("pointerleave", hideTooltip);
  });

  elements.edgeLayer.querySelectorAll("[data-edge-hit]").forEach((edgeElement) => {
    const id = edgeElement.dataset.edgeHit;
    edgeElement.addEventListener("click", () => selectTransfer(id));
    edgeElement.addEventListener("pointerenter", (event) => {
      const transfer = state.graph.edges.find((edge) => edge.id === id);
      const amount = `${formatRawAmount(transfer.rawAmount, transfer.decimals)} ${transfer.asset}`;
      showTooltip(
        event,
        `<strong>${escapeHtml(amount)} · ${escapeHtml(formatUsd(transfer.valueUsd))}</strong><span>${escapeHtml(shortAddress(transfer.from))} → ${escapeHtml(shortAddress(transfer.to))}</span><span>密度 ${transfer.density.level}/5</span>`,
      );
    });
    edgeElement.addEventListener("pointermove", moveTooltip);
    edgeElement.addEventListener("pointerleave", hideTooltip);
  });

  elements.transactionList.querySelectorAll("[data-transaction-row]").forEach((row) => {
    row.addEventListener("click", () => selectTransfer(row.dataset.transactionRow));
  });
}

function selectAddress(address) {
  state.selectedAddress = state.selectedAddress === address ? null : address;
  state.selectedTransferId = null;
  applySelection();
}

function selectTransfer(id) {
  state.selectedTransferId = state.selectedTransferId === id ? null : id;
  state.selectedAddress = null;
  applySelection();
}

function applySelection() {
  const selectedTransfer = state.graph?.edges.find(
    (edge) => edge.id === state.selectedTransferId,
  );
  const activeAddresses = new Set();
  if (selectedTransfer) {
    activeAddresses.add(selectedTransfer.from.toLowerCase());
    activeAddresses.add(selectedTransfer.to.toLowerCase());
  }

  elements.edgeLayer.querySelectorAll(".flow-edge-group").forEach((edgeElement) => {
    const isSelectedTransfer = edgeElement.dataset.transferId === state.selectedTransferId;
    const isConnectedAddress =
      state.selectedAddress &&
      (edgeElement.dataset.from === state.selectedAddress ||
        edgeElement.dataset.to === state.selectedAddress);
    const hasSelection = Boolean(state.selectedTransferId || state.selectedAddress);
    const isActive = isSelectedTransfer || isConnectedAddress;
    edgeElement.classList.toggle("is-selected", Boolean(isActive));
    edgeElement.classList.toggle("is-dimmed", hasSelection && !isActive);
  });

  elements.nodeLayer.querySelectorAll(".account-node").forEach((nodeElement) => {
    const address = nodeElement.dataset.nodeAddress;
    const isSelected = address === state.selectedAddress || activeAddresses.has(address);
    const hasSelection = Boolean(state.selectedTransferId || state.selectedAddress);
    const connectedToSelectedAddress =
      state.selectedAddress &&
      state.graph.edges.some(
        (edge) =>
          (edge.from.toLowerCase() === state.selectedAddress &&
            edge.to.toLowerCase() === address) ||
          (edge.to.toLowerCase() === state.selectedAddress &&
            edge.from.toLowerCase() === address),
      );
    nodeElement.classList.toggle("is-selected", Boolean(isSelected));
    nodeElement.classList.toggle(
      "is-dimmed",
      hasSelection && !isSelected && !connectedToSelectedAddress,
    );
  });

  elements.transactionList.querySelectorAll("[data-transaction-row]").forEach((row) => {
    row.classList.toggle("is-selected", row.dataset.transactionRow === state.selectedTransferId);
  });
  renderInspector();
}

function renderInspector() {
  if (!state.selectedAddress || !state.graph) {
    elements.inspector.hidden = true;
    return;
  }
  const node = state.graph.nodes.find((item) => item.key === state.selectedAddress);
  if (!node) {
    elements.inspector.hidden = true;
    return;
  }
  elements.inspector.hidden = false;
  elements.inspectorLabel.textContent = node.label;
  elements.inspectorAddress.textContent = node.address;
  elements.inspectorIn.textContent = formatUsd(node.inUsd);
  elements.inspectorOut.textContent = formatUsd(node.outUsd);
  elements.inspectorCount.textContent = String(node.transactionCount);
}

function renderDensityLegend() {
  elements.densityLegend.innerHTML = [
    "<strong>点密度（按 USD）</strong>",
    ...DENSITY_RULES.map((rule) => {
      const dotCount = rule.level + 1;
      const dots = Array.from({ length: dotCount }, () => "<i></i>").join("");
      return `<span class="density-item"><span class="density-dots" style="--legend-gap: ${Math.max(2, 8 - rule.level)}px">${dots}</span>${escapeHtml(rule.label)}</span>`;
    }),
  ].join("");
}

function updateCountdown() {
  if (!state.chain || state.fetching) return;
  if (state.paused) {
    elements.countdownLabel.textContent = "自动更新已暂停";
    return;
  }
  const remainingMs = Math.max(0, state.nextPollAt - Date.now());
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  elements.countdownLabel.textContent = `${remainingSeconds} 秒后更新`;
  if (remainingMs === 0) {
    refreshData({ manual: false });
  }
}

function setStatus(label, detail, type) {
  elements.statusLabel.textContent = label;
  elements.countdownLabel.textContent = detail;
  elements.statusDot.className = "status-dot";
  if (type === "loading") elements.statusDot.classList.add("is-loading");
  if (type === "error") elements.statusDot.classList.add("is-error");
  if (type === "paused") elements.statusDot.classList.add("is-paused");
}

function showFatalState(title, message) {
  elements.chainSelect.disabled = true;
  elements.pauseButton.disabled = true;
  elements.refreshButton.disabled = true;
  setStatus("无法启动", "请重新选择币种", "error");
  showGraphMessage("error", title, message);
  elements.transactionList.innerHTML = `<p class="transaction-empty">${escapeHtml(message)}</p>`;
}

function showGraphMessage(type, title, message) {
  elements.graphMessage.className = `graph-${type}`;
  elements.graphMessage.innerHTML = `<strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p>`;
  elements.graphMessage.hidden = false;
}

function hideGraphMessage() {
  elements.graphMessage.hidden = true;
}

function showTooltip(event, html) {
  elements.graphTooltip.innerHTML = html;
  elements.graphTooltip.hidden = false;
  moveTooltip(event);
}

function moveTooltip(event) {
  if (elements.graphTooltip.hidden) return;
  const bounds = elements.graphCanvas.getBoundingClientRect();
  const maxLeft = Math.max(8, bounds.width - 270);
  const maxTop = Math.max(8, bounds.height - 100);
  elements.graphTooltip.style.left = `${Math.max(8, Math.min(maxLeft, event.clientX - bounds.left))}px`;
  elements.graphTooltip.style.top = `${Math.max(8, Math.min(maxTop, event.clientY - bounds.top))}px`;
}

function hideTooltip() {
  elements.graphTooltip.hidden = true;
}

function formatWindow(windowValue) {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return `${formatter.format(new Date(windowValue.from))} - ${formatter.format(new Date(windowValue.to))}`;
}

function getGraphSize() {
  return window.innerWidth <= 680
    ? { width: 700, height: 900 }
    : { width: 1100, height: 700 };
}

function formatClock(time) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(time));
}

function getInitials(label, address) {
  if (label && !label.startsWith("0x")) {
    const words = label.split(/\s+/).filter(Boolean);
    if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase();
    return label.slice(0, 2).toUpperCase();
  }
  return address.slice(2, 4).toUpperCase();
}

function truncateLabel(value, maxLength) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function getNodePalette(address) {
  const palettes = [
    { fill: "#dff4f1", stroke: "#2d8b83" },
    { fill: "#e8edff", stroke: "#5870c9" },
    { fill: "#fff0d8", stroke: "#b37a1c" },
    { fill: "#f7e6eb", stroke: "#b75c74" },
    { fill: "#e7f2df", stroke: "#618f46" },
    { fill: "#eee8fa", stroke: "#7a61b4" },
  ];
  let hash = 0;
  for (let index = 0; index < address.length; index += 1) {
    hash = (hash * 31 + address.charCodeAt(index)) >>> 0;
  }
  return palettes[hash % palettes.length];
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
