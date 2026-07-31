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
    const records = await loadFlowRecords(chain, { signal: controller.signal });
    if (requestId !== profileRequestId) return;
    profileLoading.setStep(2);
    const profile = buildAddressProfile(records, address);
    profileLoading.setStep(3);
    elements.output.innerHTML = renderProfileHtml(chain, profile);
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
        <a class="analysis-link-button" href="./result.html?chain=${encodeURIComponent(chain)}&address=${encodeURIComponent(profile.address)}">查看资金流</a>
      </div>

      <dl class="profile-metrics">
        <div><dt>交易总量</dt><dd>${escapeHtml(profile.totalAmount)}</dd></div>
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
            : `<p class="analysis-empty">当前示例数据中没有发现该账户的资金流记录。</p>`
        }
      </section>
    </div>
  `;
}

function renderTransfer(transfer) {
  return `
    <article>
      <strong>${escapeHtml(formatTransferAmount(transfer))}</strong>
      <span>${escapeHtml(shortAddress(transfer.from))} → ${escapeHtml(shortAddress(transfer.to))}</span>
      <small>${escapeHtml(formatTime(transfer.time))} · ${escapeHtml(shortHash(transfer.txHash))}</small>
    </article>
  `;
}

function showError(message) {
  elements.error.textContent = message;
  elements.error.hidden = false;
}

function hideError() {
  elements.error.hidden = true;
}
