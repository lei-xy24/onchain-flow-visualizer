import {
  FLOW_CHAINS,
  buildAddressProfile,
  escapeHtml,
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
  formatRateTime,
  formatTransferUsd as formatRealtimeTransferUsd,
  formatTransfersUsdTotal as formatRealtimeTransfersUsdTotal,
  loadUsdRates,
} from "./currency-rates.js?v=20260830";

const elements = {
  form: document.getElementById("profile-form"),
  chain: document.getElementById("profile-chain"),
  address: document.getElementById("profile-address"),
  error: document.getElementById("profile-error"),
  output: document.getElementById("profile-output"),
  submit: document.querySelector("#profile-form .analysis-submit"),
};

const REQUEST_TIMEOUT_MS = 12_000;
let activeProfileController = null;
let profileRequestId = 0;
let activeProfileResult = null;
let amountDisplayMode = "native";
let usdRateSnapshot = null;
let unitRateError = "";
let unitRateLoading = false;

const profileLoading = createAnalysisLoading({
  title: "正在生成账户画像",
  description: "正在读取资金流并归纳账户身份、交易行为和风险线索。",
  onCancel: cancelProfileLoading,
  steps: [
    { title: "连接资金流数据", detail: "读取当前网络的账户与转账记录" },
    { title: "汇总账户行为", detail: "统计流入、流出和关联账户" },
    { title: "生成画像结果", detail: "整理身份标签与风险线索" },
  ],
});

const profileHistory = createAddressHistory({
  input: elements.address,
  chainSelect: elements.chain,
  panel: document.getElementById("profile-search-history"),
  onSelect: () => {
    hideError();
    renderProfile({ rememberSearch: false });
  },
});

initializeProfile();

function cancelProfileLoading() {
  profileRequestId += 1;
  activeProfileController?.abort();
  activeProfileController = null;
  elements.submit.disabled = false;
  profileLoading.hide();
}

function initializeProfile() {
  applyInitialQuery();
  elements.chain.addEventListener("change", () => {
    elements.address.value = FLOW_CHAINS[elements.chain.value].sampleA;
    profileHistory.resetInputState();
    hideError();
    renderProfile({ rememberSearch: false });
  });
  elements.address.addEventListener("input", hideError);
  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    renderProfile({ rememberSearch: true });
  });
  renderProfile({ rememberSearch: false });
}

function applyInitialQuery() {
  const params = new URLSearchParams(window.location.search);
  const chain = params.get("chain");
  const address = params.get("address");
  if (!FLOW_CHAINS[chain] || !isEvmAddress(address)) return;
  elements.chain.value = chain;
  elements.address.value = address;
}

async function renderProfile({ rememberSearch = false } = {}) {
  const chain = elements.chain.value;
  const address = elements.address.value.trim();
  if (!isEvmAddress(address)) {
    showError("请输入有效的 EVM 地址。");
    return;
  }

  hideError();
  profileHistory.close();
  if (rememberSearch) {
    rememberAddressSearch(chain, address);
    profileHistory.refresh();
  }

  activeProfileController?.abort();
  const requestId = ++profileRequestId;
  const controller = new AbortController();
  activeProfileController = controller;
  let timedOut = false;
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  elements.submit.disabled = true;
  profileLoading.show([
    { label: "网络", value: FLOW_CHAINS[chain].label },
    { label: "地址", value: address },
  ]);

  try {
    const records = await loadFlowRecords(chain, { signal: controller.signal, addresses: [address] });
    if (requestId !== profileRequestId) return;
    profileLoading.setStep(2);
    const profile = buildAddressProfile(records, address);
    profileLoading.setStep(3);
    if (amountDisplayMode === "usd") {
      try {
        usdRateSnapshot = await loadUsdRates();
      } catch (error) {
        amountDisplayMode = "native";
        unitRateError =
          error instanceof Error ? error.message : "实时汇率获取失败，请重试";
      }
    }
    if (requestId !== profileRequestId) return;
    activeProfileResult = { chain, profile };
    renderActiveProfile();
  } catch (error) {
    if (requestId !== profileRequestId) return;
    const message = timedOut
      ? "数据请求超时，请检查后端连接后重试。"
      : error instanceof Error
        ? error.message
        : "读取数据失败，请稍后重试。";
    showError(message);
    renderProfileRequestError(message);
  } finally {
    window.clearTimeout(timeoutId);
    if (requestId === profileRequestId) {
      activeProfileController = null;
      elements.submit.disabled = false;
      profileLoading.hide();
    }
  }
}

function renderProfileRequestError(message) {
  activeProfileResult = null;
  elements.output.innerHTML = `
    <div class="analysis-request-error">
      <h2>账户画像生成失败</h2>
      <p>${escapeHtml(message)}</p>
      <button id="retry-profile" type="button">重新生成</button>
    </div>`;
  document.getElementById("retry-profile").addEventListener("click", () => {
    renderProfile({ rememberSearch: false });
  });
}

function renderProfileHtml(chain, profile) {
  const hasData = profile.transfers.length > 0;
  const latestTransfers = [...profile.transfers]
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
    .slice(0, 5);
  return `
    <div class="profile-wheel-panel">
      <div class="profile-wheel">
        <div class="profile-center">
          <strong>${escapeHtml(shortAddress(profile.address))}</strong>
          <span>${escapeHtml(FLOW_CHAINS[chain].label)}</span>
        </div>
        <article>
          <span>所属身份</span>
          <strong>${escapeHtml(profile.identity)}</strong>
        </article>
        <article>
          <span>交易行为</span>
          <strong>${profile.transfers.length} 笔交易</strong>
        </article>
        <article>
          <span>风险线索</span>
          <strong>${profile.riskTags.length} 项标签</strong>
        </article>
        <article>
          <span>关联网络</span>
          <strong>${profile.counterparties.length} 个账户</strong>
        </article>
      </div>
    </div>

    <div class="profile-detail-panel">
      <div class="analysis-panel-heading">
        <div>
          <p class="section-kicker">Profile result</p>
          <h2>${hasData ? "画像结果" : "暂无画像数据"}</h2>
        </div>
        <div class="analysis-panel-controls">
          <div class="analysis-panel-actions">
            <button
              class="analysis-unit-toggle"
              id="profile-unit-toggle"
              type="button"
              ${unitRateLoading ? "disabled" : ""}
              aria-pressed="${amountDisplayMode === "usd" ? "true" : "false"}"
            >${renderUnitButtonLabel()}</button>
            <a class="analysis-link-button" href="./result.html?chain=${encodeURIComponent(chain)}&address=${encodeURIComponent(profile.address)}">查看资金流</a>
          </div>
          ${renderUnitRateStatus()}
        </div>
      </div>

      <dl class="profile-metrics">
        <div><dt>交易总量</dt><dd>${escapeHtml(formatProfileTotal(chain, profile))}</dd></div>
        <div><dt>流入交易</dt><dd>${profile.inbound.length}</dd></div>
        <div><dt>流出交易</dt><dd>${profile.outbound.length}</dd></div>
        <div><dt>关联账户</dt><dd>${profile.counterparties.length}</dd></div>
      </dl>

      <div class="profile-tags" aria-label="画像标签">
        ${profile.labels
          .slice(0, 8)
          .map((label) => `<span>${escapeHtml(label)}</span>`)
          .join("") || "<span>未标注</span>"}
      </div>

      <section class="analysis-subsection">
        <h3>风险线索</h3>
        <ul class="analysis-list">
          ${profile.riskTags.map((tag) => `<li>${escapeHtml(tag)}</li>`).join("")}
        </ul>
      </section>

      <section class="analysis-subsection">
        <h3>最近关联交易</h3>
        ${
          latestTransfers.length
            ? `<div class="relation-table compact">
                ${latestTransfers.map(renderTransfer).join("")}
              </div>`
            : `<p class="analysis-empty">当前查询范围内没有发现该账户的资金流记录。</p>`
        }
      </section>
    </div>
  `;
}

function renderTransfer(transfer) {
  return `
    <article>
      <strong>${escapeHtml(formatProfileTransfer(transfer))}</strong>
      <span>${escapeHtml(shortAddress(transfer.from))} → ${escapeHtml(shortAddress(transfer.to))}</span>
      <small>${escapeHtml(formatTime(transfer.time))} · ${escapeHtml(shortHash(transfer.txHash))}</small>
    </article>
  `;
}

function renderActiveProfile() {
  if (!activeProfileResult) return;
  elements.output.innerHTML = renderProfileHtml(
    activeProfileResult.chain,
    activeProfileResult.profile,
  );
  document
    .getElementById("profile-unit-toggle")
    ?.addEventListener("click", toggleAmountDisplayMode);
}

async function toggleAmountDisplayMode() {
  if (!activeProfileResult || unitRateLoading) return;
  if (amountDisplayMode === "usd") {
    amountDisplayMode = "native";
    unitRateError = "";
    renderActiveProfile();
    return;
  }

  unitRateLoading = true;
  unitRateError = "";
  renderActiveProfile();
  try {
    usdRateSnapshot = await loadUsdRates();
    amountDisplayMode = "usd";
  } catch (error) {
    amountDisplayMode = "native";
    unitRateError =
      error instanceof Error ? error.message : "实时汇率获取失败，请重试";
  } finally {
    unitRateLoading = false;
    renderActiveProfile();
  }
}

function formatProfileTransfer(transfer) {
  if (amountDisplayMode !== "usd") return formatTransferAmount(transfer);
  return (
    formatRealtimeTransferUsd(
      transfer,
      activeProfileResult?.chain,
      usdRateSnapshot,
    ) || `${formatTransferAmount(transfer)}（暂无实时汇率）`
  );
}

function formatProfileTotal(chain, profile) {
  if (amountDisplayMode !== "usd") return profile.totalAmount;
  return (
    formatRealtimeTransfersUsdTotal(profile.transfers, chain, usdRateSnapshot) ||
    "暂无实时汇率"
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
  const rateTime =
    amountDisplayMode === "usd" ? formatRateTime(usdRateSnapshot) : "";
  return rateTime
    ? `<span class="analysis-unit-status">实时汇率 · ${escapeHtml(rateTime)}</span>`
    : "";
}

function showError(message) {
  elements.error.textContent = message;
  elements.error.hidden = false;
}

function hideError() {
  elements.error.hidden = true;
}
