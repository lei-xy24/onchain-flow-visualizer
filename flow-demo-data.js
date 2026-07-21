export const FLOW_CHAINS = Object.freeze({
  eth: {
    id: "eth",
    label: "Ethereum",
    sampleA: "0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97",
    sampleB: "0xA91c7F2b2f32E7d42A61A0C4A53e80B3d8D7C91A",
  },
  bsc: {
    id: "bsc",
    label: "BNB Smart Chain",
    sampleA: "0xB5C0000000000000000000000000000000000001",
    sampleB: "0xB5C3000000000000000000000000000000000003",
  },
  polygon: {
    id: "polygon",
    label: "Polygon PoS",
    sampleA: "0x9000000000000000000000000000000000000001",
    sampleB: "0x9001000000000000000000000000000000000001",
  },
});

export const FLOW_MOCK_FILES = Object.freeze({
  eth: [
    "mock-api/eth/0x4838b106fce9647bdf1e7877bf73ce8b0bad5f97.json",
    "mock-api/eth/0xa91c7f2b2f32e7d42a61a0c4a53e80b3d8d7c91a.json",
    "mock-api/eth/0x5e34cb1aef9e5b0e0e6c23d27d087f23e8bd3c70.json",
  ],
  bsc: [
    "mock-api/bsc/0xb5c0000000000000000000000000000000000001.json",
    "mock-api/bsc/0xb5c1000000000000000000000000000000000001.json",
    "mock-api/bsc/0xb5c3000000000000000000000000000000000003.json",
  ],
  polygon: [
    "mock-api/polygon/0x9000000000000000000000000000000000000001.json",
    "mock-api/polygon/0x9001000000000000000000000000000000000001.json",
    "mock-api/polygon/0x9003000000000000000000000000000000000003.json",
  ],
});

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const RAW_AMOUNT_PATTERN = /^\d+$/;

export function normalizeAddress(address) {
  return String(address || "").trim().toLowerCase();
}

export function isEvmAddress(address) {
  return EVM_ADDRESS_PATTERN.test(String(address || "").trim());
}

export async function loadFlowRecords(chain) {
  const files = FLOW_MOCK_FILES[chain] || [];
  const records = await Promise.all(
    files.map(async (file) => {
      const response = await fetch(`./${file}`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${file}`);
      return response.json();
    }),
  );
  return records.filter((record) => record.chain === chain);
}

export function flattenFlowTransfers(records) {
  return records.flatMap((record) => [
    ...record.input.map((transfer) =>
      normalizeTransfer(record, transfer, "input"),
    ),
    ...record.output.map((transfer) =>
      normalizeTransfer(record, transfer, "output"),
    ),
  ]);
}

export function findAddressRelations(records, leftAddress, rightAddress) {
  const left = normalizeAddress(leftAddress);
  const right = normalizeAddress(rightAddress);
  return flattenFlowTransfers(records)
    .filter((transfer) => {
      const from = normalizeAddress(transfer.from);
      const to = normalizeAddress(transfer.to);
      return (
        (from === left && to === right) ||
        (from === right && to === left)
      );
    })
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
}

export function buildAddressProfile(records, address) {
  const target = normalizeAddress(address);
  const transfers = flattenFlowTransfers(records).filter(
    (transfer) =>
      normalizeAddress(transfer.from) === target ||
      normalizeAddress(transfer.to) === target,
  );
  const inbound = transfers.filter(
    (transfer) => normalizeAddress(transfer.to) === target,
  );
  const outbound = transfers.filter(
    (transfer) => normalizeAddress(transfer.from) === target,
  );
  const counterparties = new Map();
  const labels = new Set();
  for (const record of records) {
    if (normalizeAddress(record.address) === target && record.label) {
      labels.add(record.label);
    }
  }
  for (const transfer of transfers) {
    const counterparty =
      normalizeAddress(transfer.from) === target ? transfer.to : transfer.from;
    counterparties.set(normalizeAddress(counterparty), counterparty);
    if (transfer.counterpartyLabel) labels.add(transfer.counterpartyLabel);
    if (transfer.tag) labels.add(transfer.tag);
  }

  const riskTags = inferRiskTags(transfers, counterparties.size);
  return {
    address,
    labels: [...labels],
    transfers,
    inbound,
    outbound,
    counterparties: [...counterparties.values()],
    totalAmount: formatTransferTotal(transfers),
    riskTags,
    role: inferRole(inbound.length, outbound.length),
  };
}

export function formatTransferAmount(transfer) {
  return `${formatRawAmount(transfer.rawAmount, transfer.decimals)} ${transfer.asset}`;
}

export function formatTransferTotal(transfers) {
  if (!transfers.length) return "0";
  const totals = new Map();
  for (const transfer of transfers) {
    const key = [
      transfer.asset.toLowerCase(),
      transfer.assetAddress?.toLowerCase() || "native",
      transfer.decimals,
    ].join(":");
    const existing = totals.get(key);
    totals.set(key, existing ? addRawAmounts(existing, transfer) : { ...transfer });
  }
  return [...totals.values()]
    .map((transfer) => formatTransferAmount(transfer))
    .join(" + ");
}

export function formatTime(time) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(time));
}

export function shortAddress(address) {
  const value = String(address || "");
  return value.length <= 14 ? value : `${value.slice(0, 8)}...${value.slice(-6)}`;
}

export function shortHash(hash) {
  const value = String(hash || "");
  return value.length <= 16 ? value : `${value.slice(0, 10)}...${value.slice(-8)}`;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeTransfer(record, transfer, direction) {
  const isInput = direction === "input";
  return {
    ...transfer,
    chain: record.chain,
    centerAddress: record.address,
    centerLabel: record.label || shortAddress(record.address),
    counterparty: transfer.address,
    counterpartyLabel: transfer.tag || shortAddress(transfer.address),
    direction,
    from: isInput ? transfer.address : record.address,
    fromLabel: isInput ? transfer.tag : record.label,
    to: isInput ? record.address : transfer.address,
    toLabel: isInput ? record.label : transfer.tag,
  };
}

function formatRawAmount(rawAmount, decimals) {
  if (!RAW_AMOUNT_PATTERN.test(rawAmount) || !Number.isInteger(decimals)) {
    return "0";
  }
  const normalized = rawAmount.replace(/^0+(?=\d)/, "");
  if (decimals === 0) return groupDigits(normalized);
  const padded = normalized.padStart(decimals + 1, "0");
  const integer = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).slice(0, 6).replace(/0+$/, "");
  return fraction ? `${groupDigits(integer)}.${fraction}` : groupDigits(integer);
}

function addRawAmounts(existing, transfer) {
  return {
    ...existing,
    rawAmount: (BigInt(existing.rawAmount) + BigInt(transfer.rawAmount)).toString(),
  };
}

function groupDigits(value) {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function inferRole(inboundCount, outboundCount) {
  if (inboundCount && outboundCount) return "双向资金中转账户";
  if (inboundCount) return "资金接收账户";
  if (outboundCount) return "资金发送账户";
  return "暂无交易画像";
}

function inferRiskTags(transfers, counterpartyCount) {
  const tags = new Set();
  if (transfers.some((transfer) => /mixer|unknown/i.test(transfer.tag || ""))) {
    tags.add("存在匿名化或未知标签交互");
  }
  if (counterpartyCount >= 5) tags.add("关联账户数量较多");
  if (transfers.some((transfer) => /fresh/i.test(transfer.tag || ""))) {
    tags.add("存在新钱包交互");
  }
  if (transfers.length >= 6) tags.add("短期交易活跃");
  if (tags.size === 0) tags.add("暂无明显风险线索");
  return [...tags];
}
