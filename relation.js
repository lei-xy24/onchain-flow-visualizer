import {
  FLOW_CHAINS,
  escapeHtml,
  findAddressRelations,
  formatTime,
  formatTransferAmount,
  isEvmAddress,
  loadFlowRecords,
  shortAddress,
  shortHash,
} from "./flow-demo-data.js?v=20260731-unified-search";
import {
  createAddressHistory,
  rememberAddressSearch,
} from "./address-history.js?v=20260731-history-boundary";
import { createAnalysisLoading } from "./analysis-loading.js?v=20260731";
import {
  formatRateStatus,
  formatTransferUsd as formatRealtimeTransferUsd,
  loadUsdRates,
} from "./currency-rates.js?v=20260830-rates-fallback";

const elements = {
  form: document.getElementById("relation-form"),
  chain: document.getElementById("relation-chain"),
  addressA: document.getElementById("relation-address-a"),
  addressB: document.getElementById("relation-address-b"),
  error: document.getElementById("relation-error"),
  output: document.getElementById("relation-output"),
  submit: document.querySelector("#relation-form .analysis-submit"),
};

const REQUEST_TIMEOUT_MS = 12_000;
let activeRelationController = null;
let relationRequestId = 0;
let activeRelationResult = null;
let amountDisplayMode = "native";
let usdRateSnapshot = null;
let unitRateError = "";
let unitRateLoading = false;

const relationLoading = createAnalysisLoading({
  title: "正在查询地址关联",
  description: "正在读取资金流，并核对两个地址之间的直接转账路径。",
  onCancel: cancelRelationLoading,
  steps: [
    { title: "连接资金流数据", detail: "读取当前网络的账户与转账记录" },
    { title: "筛选双向转账", detail: "匹配地址 A 与地址 B 的直接路径" },
    { title: "生成关联结果", detail: "整理关联次数、方向和交易明细" },
  ],
});

const addressAHistory = createAddressHistory({
  input: elements.addressA,
  chainSelect: elements.chain,
  panel: document.getElementById("relation-search-history-a"),
  onSelect: hideError,
});

const addressBHistory = createAddressHistory({
  input: elements.addressB,
  chainSelect: elements.chain,
  panel: document.getElementById("relation-search-history-b"),
  onSelect: hideError,
});

initializeRelation();

function cancelRelationLoading() {
  relationRequestId += 1;
  activeRelationController?.abort();
  activeRelationController = null;
  elements.submit.disabled = false;
  relationLoading.hide();
}

function initializeRelation() {
  setSampleAddresses();
  applyInitialQuery();
  elements.chain.addEventListener("change", () => {
    setSampleAddresses();
    addressAHistory.resetInputState();
    addressBHistory.resetInputState();
    hideError();
    renderRelation({ rememberSearch: false });
  });
  elements.addressA.addEventListener("input", hideError);
  elements.addressB.addEventListener("input", hideError);
  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    renderRelation({ rememberSearch: true });
  });
  renderRelation({ rememberSearch: false });
}

function applyInitialQuery() {
  const params = new URLSearchParams(window.location.search);
  const chain = params.get("chain");
  const addressA = params.get("addressA");
  const addressB = params.get("addressB");
  if (
    !FLOW_CHAINS[chain] ||
    !isEvmAddress(addressA) ||
    !isEvmAddress(addressB) ||
    addressA.toLowerCase() === addressB.toLowerCase()
  ) {
    return;
  }
  elements.chain.value = chain;
  elements.addressA.value = addressA;
  elements.addressB.value = addressB;
}

async function renderRelation({ rememberSearch = false } = {}) {
  const chain = elements.chain.value;
  const addressA = elements.addressA.value.trim();
  const addressB = elements.addressB.value.trim();
  if (!isEvmAddress(addressA) || !isEvmAddress(addressB)) {
    showError("请输入两个有效的 EVM 地址。");
    return;
  }
  if (addressA.toLowerCase() === addressB.toLowerCase()) {
    showError("两个地址不能相同。");
    return;
  }

  hideError();
  addressAHistory.close();
  addressBHistory.close();
  if (rememberSearch) {
    rememberAddressSearch(chain, addressB);
    rememberAddressSearch(chain, addressA);
    addressAHistory.refresh();
    addressBHistory.refresh();
  }

  activeRelationController?.abort();
  const requestId = ++relationRequestId;
  const controller = new AbortController();
  activeRelationController = controller;
  let timedOut = false;
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  elements.submit.disabled = true;
  relationLoading.show([
    { label: "网络", value: FLOW_CHAINS[chain].label },
    { label: "地址 A", value: addressA },
    { label: "地址 B", value: addressB },
  ]);

  try {
    const records = await loadFlowRecords(chain, { signal: controller.signal, addresses: [addressA, addressB] });
    if (requestId !== relationRequestId) return;
    relationLoading.setStep(2);
    const relations = findAddressRelations(records, addressA, addressB);
    relationLoading.setStep(3);
    if (amountDisplayMode === "usd") {
      try {
        usdRateSnapshot = await loadUsdRates();
      } catch (error) {
        amountDisplayMode = "native";
        unitRateError =
          error instanceof Error ? error.message : "实时汇率获取失败，请重试";
      }
    }
    if (requestId !== relationRequestId) return;
    activeRelationResult = { chain, addressA, addressB, relations };
    renderActiveRelation();
  } catch (error) {
    if (requestId !== relationRequestId) return;
    const message = timedOut
      ? "数据请求超时，请检查后端连接后重试。"
      : error instanceof Error
        ? error.message
        : "读取数据失败，请稍后重试。";
    showError(message);
    renderRelationRequestError(message);
  } finally {
    window.clearTimeout(timeoutId);
    if (requestId === relationRequestId) {
      activeRelationController = null;
      elements.submit.disabled = false;
      relationLoading.hide();
    }
  }
}

function renderRelationRequestError(message) {
  activeRelationResult = null;
  elements.output.innerHTML = `
    <div class="analysis-request-error">
      <h2>地址关联查询失败</h2>
      <p>${escapeHtml(message)}</p>
      <button id="retry-relation" type="button">重新查询</button>
    </div>`;
  document.getElementById("retry-relation").addEventListener("click", () => {
    renderRelation({ rememberSearch: false });
  });
}

function renderRelationHtml(chain, addressA, addressB, relations) {
  const hasRelations = relations.length > 0;
  return `
    <div class="relation-summary-panel">
      <div class="analysis-panel-heading">
        <div>
          <p class="section-kicker">Relation result</p>
          <h2>${hasRelations ? "发现直接关联交易" : "未发现直接关联交易"}</h2>
        </div>
        <div class="analysis-panel-controls">
          <div class="analysis-panel-actions">
            <button
              class="analysis-unit-toggle"
              id="relation-unit-toggle"
              type="button"
              ${unitRateLoading || !hasRelations ? "disabled" : ""}
              aria-pressed="${amountDisplayMode === "usd" ? "true" : "false"}"
            >${renderUnitButtonLabel()}</button>
          </div>
          ${renderUnitRateStatus()}
        </div>
      </div>
      <dl class="relation-summary">
        <div><dt>网络</dt><dd>${escapeHtml(FLOW_CHAINS[chain].label)}</dd></div>
        <div><dt>地址 A</dt><dd><code>${escapeHtml(shortAddress(addressA))}</code></dd></div>
        <div><dt>地址 B</dt><dd><code>${escapeHtml(shortAddress(addressB))}</code></dd></div>
        <div><dt>关联交易</dt><dd>${relations.length}</dd></div>
      </dl>
    </div>

    ${
      hasRelations
        ? `<div class="relation-table">
            ${relations.map(renderRelationRow).join("")}
          </div>`
        : `<div class="analysis-empty">当前查询范围内，没有找到这两个地址之间的直接转账。</div>`
    }
  `;
}

function renderRelationRow(transfer) {
  return `
    <article>
      <div>
        <strong>${escapeHtml(formatRelationTransfer(transfer))}</strong>
        <span>${escapeHtml(formatTime(transfer.time))}</span>
      </div>
      <p>
        <code>${escapeHtml(shortAddress(transfer.from))}</code>
        <span aria-hidden="true">→</span>
        <code>${escapeHtml(shortAddress(transfer.to))}</code>
      </p>
      <small>
        ${escapeHtml(transfer.centerLabel)} · ${escapeHtml(shortHash(transfer.txHash))}
      </small>
    </article>
  `;
}

function renderActiveRelation() {
  if (!activeRelationResult) return;
  const { chain, addressA, addressB, relations } = activeRelationResult;
  elements.output.innerHTML = renderRelationHtml(
    chain,
    addressA,
    addressB,
    relations,
  );
  document
    .getElementById("relation-unit-toggle")
    ?.addEventListener("click", toggleAmountDisplayMode);
}

async function toggleAmountDisplayMode() {
  if (!activeRelationResult || unitRateLoading) return;
  if (amountDisplayMode === "usd") {
    amountDisplayMode = "native";
    unitRateError = "";
    renderActiveRelation();
    return;
  }

  unitRateLoading = true;
  unitRateError = "";
  renderActiveRelation();
  try {
    usdRateSnapshot = await loadUsdRates();
    amountDisplayMode = "usd";
  } catch (error) {
    amountDisplayMode = "native";
    unitRateError =
      error instanceof Error ? error.message : "实时汇率获取失败，请重试";
  } finally {
    unitRateLoading = false;
    renderActiveRelation();
  }
}

function formatRelationTransfer(transfer) {
  if (amountDisplayMode !== "usd") return formatTransferAmount(transfer);
  return (
    formatRealtimeTransferUsd(
      transfer,
      activeRelationResult?.chain,
      usdRateSnapshot,
    ) || `${formatTransferAmount(transfer)}（暂无实时汇率）`
  );
}

function renderUnitButtonLabel() {
  if (unitRateLoading) return "正在获取实时汇率…";
  return amountDisplayMode === "usd" ? "显示原币种" : "单位转换：美元";
}

function renderUnitRateStatus() {
  if (unitRateError) {
    return `<span class="analysis-unit-status is-error" role="status">${escapeHtml(unitRateError)}</span>`;
  }
  const rateStatus =
    amountDisplayMode === "usd" ? formatRateStatus(usdRateSnapshot) : "";
  return rateStatus
    ? `<span class="analysis-unit-status">${escapeHtml(rateStatus)}</span>`
    : "";
}

function setSampleAddresses() {
  const chain = FLOW_CHAINS[elements.chain.value];
  elements.addressA.value = chain.sampleA;
  elements.addressB.value = chain.sampleB;
}

function showError(message) {
  elements.error.textContent = message;
  elements.error.hidden = false;
}

function hideError() {
  elements.error.hidden = true;
}
