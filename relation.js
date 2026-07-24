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
} from "./flow-demo-data.js?v=20260724-native-usd";

const elements = {
  form: document.getElementById("relation-form"),
  chain: document.getElementById("relation-chain"),
  addressA: document.getElementById("relation-address-a"),
  addressB: document.getElementById("relation-address-b"),
  error: document.getElementById("relation-error"),
  output: document.getElementById("relation-output"),
};

initializeRelation();

function initializeRelation() {
  setSampleAddresses();
  elements.chain.addEventListener("change", () => {
    setSampleAddresses();
    hideError();
    renderRelation();
  });
  elements.addressA.addEventListener("input", hideError);
  elements.addressB.addEventListener("input", hideError);
  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    renderRelation();
  });
  renderRelation();
}

async function renderRelation() {
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

  elements.output.innerHTML = `<div class="analysis-state">正在查询关联交易...</div>`;
  try {
    const records = await loadFlowRecords(chain);
    const relations = findAddressRelations(records, addressA, addressB);
    elements.output.innerHTML = renderRelationHtml(chain, addressA, addressB, relations);
  } catch (error) {
    showError(error instanceof Error ? error.message : "读取示例数据失败。");
  }
}

function renderRelationHtml(chain, addressA, addressB, relations) {
  const hasRelations = relations.length > 0;
  return `
    <div class="relation-summary-panel">
      <div>
        <p class="section-kicker">Relation result</p>
        <h2>${hasRelations ? "发现直接关联交易" : "未发现直接关联交易"}</h2>
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
        : `<div class="analysis-empty">当前资金流追踪示例数据中，没有找到这两个地址之间的直接转账。</div>`
    }
  `;
}

function renderRelationRow(transfer) {
  return `
    <article>
      <div>
        <strong>${escapeHtml(formatTransferAmount(transfer))}</strong>
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
