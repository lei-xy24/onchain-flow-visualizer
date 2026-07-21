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
} from "./flow-demo-data.js?v=20260722-native-assets";

const elements = {
  form: document.getElementById("profile-form"),
  chain: document.getElementById("profile-chain"),
  address: document.getElementById("profile-address"),
  error: document.getElementById("profile-error"),
  output: document.getElementById("profile-output"),
};

initializeProfile();

function initializeProfile() {
  elements.chain.addEventListener("change", () => {
    elements.address.value = FLOW_CHAINS[elements.chain.value].sampleA;
    hideError();
    renderProfile();
  });
  elements.address.addEventListener("input", hideError);
  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    renderProfile();
  });
  renderProfile();
}

async function renderProfile() {
  const chain = elements.chain.value;
  const address = elements.address.value.trim();
  if (!isEvmAddress(address)) {
    showError("请输入有效的 EVM 地址。");
    return;
  }

  elements.output.innerHTML = `<div class="analysis-state">正在生成账户画像...</div>`;
  try {
    const records = await loadFlowRecords(chain);
    const profile = buildAddressProfile(records, address);
    elements.output.innerHTML = renderProfileHtml(chain, profile);
  } catch (error) {
    showError(error instanceof Error ? error.message : "读取示例数据失败。");
  }
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
          <span>账户属性</span>
          <strong>${escapeHtml(profile.role)}</strong>
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
