export const LIVE_CHAINS = Object.freeze({
  eth: {
    id: "eth",
    label: "Ethereum",
    asset: "ETH",
    accent: "#4263d5",
    accentSoft: "#e7ebff",
  },
  bsc: {
    id: "bsc",
    label: "BNB Smart Chain",
    asset: "BNB",
    accent: "#b7790b",
    accentSoft: "#fff1ce",
  },
  polygon: {
    id: "polygon",
    label: "Polygon PoS",
    asset: "POL",
    accent: "#7556c8",
    accentSoft: "#eee8ff",
  },
});

// Density is based on USD value so every chain and asset follows one scale.
export const DENSITY_RULES = Object.freeze([
  { level: 1, minUsd: 0, maxUsd: 1_000, label: "< $1K", dotGap: 28, width: 2.4 },
  {
    level: 2,
    minUsd: 1_000,
    maxUsd: 10_000,
    label: "$1K - $10K",
    dotGap: 22,
    width: 2.8,
  },
  {
    level: 3,
    minUsd: 10_000,
    maxUsd: 100_000,
    label: "$10K - $100K",
    dotGap: 18,
    width: 3.2,
  },
  {
    level: 4,
    minUsd: 100_000,
    maxUsd: 1_000_000,
    label: "$100K - $1M",
    dotGap: 13,
    width: 3.8,
  },
  {
    level: 5,
    minUsd: 1_000_000,
    maxUsd: Number.POSITIVE_INFINITY,
    label: "≥ $1M",
    dotGap: 8,
    width: 4.4,
  },
]);

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const RAW_AMOUNT_PATTERN = /^\d+$/;

export class LiveDataValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "LiveDataValidationError";
  }
}

export function parseLiveResponse(value, expectedChain) {
  const root = requireObject(value, "live response");
  const chain = requireString(root.chain, "live response.chain").toLowerCase();
  if (!LIVE_CHAINS[chain]) {
    throw new LiveDataValidationError(`live response contains unsupported chain: ${chain}`);
  }
  if (expectedChain && chain !== expectedChain) {
    throw new LiveDataValidationError(
      `live response chain ${chain} does not match requested chain ${expectedChain}`,
    );
  }

  const windowValue = requireObject(root.window, "live response.window");
  const from = parseTime(windowValue.from, "live response.window.from");
  const to = parseTime(windowValue.to, "live response.window.to");
  if (Date.parse(from) >= Date.parse(to)) {
    throw new LiveDataValidationError("live response.window.from must be earlier than .to");
  }

  if (!Array.isArray(root.transfers)) {
    throw new LiveDataValidationError("live response.transfers must be an array");
  }

  const seenIds = new Set();
  const transfers = root.transfers.map((item, index) => {
    const path = `live response.transfers[${index}]`;
    const transfer = requireObject(item, path);
    const id = requireString(transfer.id, `${path}.id`);
    if (seenIds.has(id)) {
      throw new LiveDataValidationError(`${path}.id must be unique in one response`);
    }
    seenIds.add(id);

    const fromAddress = parseAddress(transfer.from, `${path}.from`);
    const toAddress = parseAddress(transfer.to, `${path}.to`);
    const time = parseTime(transfer.time, `${path}.time`);
    const rawAmount = requireString(transfer.rawAmount, `${path}.rawAmount`);
    if (!RAW_AMOUNT_PATTERN.test(rawAmount)) {
      throw new LiveDataValidationError(`${path}.rawAmount must contain digits only`);
    }

    const decimals = transfer.decimals;
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
      throw new LiveDataValidationError(`${path}.decimals must be an integer from 0 to 255`);
    }

    const asset = requireString(transfer.asset, `${path}.asset`);
    const assetAddress = transfer.assetAddress;
    if (assetAddress !== null && !isEvmAddress(assetAddress)) {
      throw new LiveDataValidationError(
        `${path}.assetAddress must be null or an EVM address`,
      );
    }

    const valueUsd = transfer.valueUsd;
    if (typeof valueUsd !== "number" || !Number.isFinite(valueUsd) || valueUsd < 0) {
      throw new LiveDataValidationError(`${path}.valueUsd must be a non-negative number`);
    }

    const txHash = requireString(transfer.txHash, `${path}.txHash`);
    if (!TX_HASH_PATTERN.test(txHash)) {
      throw new LiveDataValidationError(`${path}.txHash is invalid`);
    }

    return {
      id,
      from: fromAddress,
      to: toAddress,
      time,
      rawAmount,
      decimals,
      asset,
      assetAddress,
      valueUsd,
      txHash,
      ...optionalField(transfer.fromLabel, "fromLabel", `${path}.fromLabel`),
      ...optionalField(transfer.toLabel, "toLabel", `${path}.toLabel`),
    };
  });

  return {
    chain,
    window: { from, to },
    transfers,
  };
}

export function getDensityRule(valueUsd) {
  return (
    DENSITY_RULES.find(
      (rule) => valueUsd >= rule.minUsd && valueUsd < rule.maxUsd,
    ) || DENSITY_RULES[DENSITY_RULES.length - 1]
  );
}

export function buildGraphModel(response, width = 1100, height = 700) {
  const nodeMap = new Map();

  for (const transfer of response.transfers) {
    const fromNode = getOrCreateNode(nodeMap, transfer.from, transfer.fromLabel);
    const toNode = getOrCreateNode(nodeMap, transfer.to, transfer.toLabel);
    fromNode.outUsd += transfer.valueUsd;
    fromNode.totalUsd += transfer.valueUsd;
    fromNode.transactionCount += 1;
    toNode.inUsd += transfer.valueUsd;
    toNode.totalUsd += transfer.valueUsd;
    toNode.transactionCount += 1;
  }

  const nodes = [...nodeMap.values()].sort(
    (left, right) =>
      right.transactionCount - left.transactionCount ||
      right.totalUsd - left.totalUsd ||
      left.address.localeCompare(right.address),
  );
  positionNodes(nodes, width, height);
  const positioned = new Map(nodes.map((node) => [node.key, node]));

  const edges = response.transfers.map((transfer) => {
    const source = positioned.get(transfer.from.toLowerCase());
    const target = positioned.get(transfer.to.toLowerCase());
    const density = getDensityRule(transfer.valueUsd);
    return {
      ...transfer,
      source,
      target,
      density,
      path: createEdgePath(source, target, transfer.id),
    };
  });

  return { nodes, edges, width, height };
}

export function formatRawAmount(rawAmount, decimals, maxFractionDigits = 6) {
  if (!RAW_AMOUNT_PATTERN.test(rawAmount) || !Number.isInteger(decimals) || decimals < 0) {
    return "0";
  }
  const normalized = rawAmount.replace(/^0+(?=\d)/, "");
  if (decimals === 0) return groupDigits(normalized);

  const padded = normalized.padStart(decimals + 1, "0");
  const integer = padded.slice(0, -decimals);
  const fraction = padded
    .slice(-decimals)
    .slice(0, maxFractionDigits)
    .replace(/0+$/, "");
  return fraction ? `${groupDigits(integer)}.${fraction}` : groupDigits(integer);
}

export function formatUsd(value) {
  if (!Number.isFinite(value)) return "$0";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return `$${trimFixed(value / 1_000_000_000)}B`;
  if (absolute >= 1_000_000) return `$${trimFixed(value / 1_000_000)}M`;
  if (absolute >= 1_000) return `$${trimFixed(value / 1_000)}K`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: absolute < 10 ? 2 : 0,
  }).format(value);
}

export function shortAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function shortHash(hash) {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

export function isEvmAddress(value) {
  return typeof value === "string" && EVM_ADDRESS_PATTERN.test(value);
}

function getOrCreateNode(nodeMap, address, label) {
  const key = address.toLowerCase();
  if (!nodeMap.has(key)) {
    nodeMap.set(key, {
      key,
      address,
      label: label || shortAddress(address),
      inUsd: 0,
      outUsd: 0,
      totalUsd: 0,
      transactionCount: 0,
      radius: 30,
      x: 0,
      y: 0,
    });
  } else if (label && nodeMap.get(key).label === shortAddress(address)) {
    nodeMap.get(key).label = label;
  }
  return nodeMap.get(key);
}

function positionNodes(nodes, width, height) {
  if (nodes.length === 0) return;
  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.min(width * 0.39, height * 0.39);
  const crowdedScale = nodes.length > 24 ? 0.72 : nodes.length > 14 ? 0.84 : 1;

  nodes.forEach((node) => {
    node.radius = Math.round(
      Math.max(
        22,
        Math.min(44, (25 + Math.log10(node.totalUsd + 1) * 2.8) * crowdedScale),
      ),
    );
  });

  nodes[0].x = centerX;
  nodes[0].y = centerY;
  if (nodes.length === 1) return;

  const remaining = nodes.length - 1;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let index = 0; index < remaining; index += 1) {
    const normalized = remaining === 1 ? 1 : Math.sqrt((index + 1) / remaining);
    const radius = 120 + normalized * (maxRadius - 120);
    const angle = -Math.PI / 2 + index * goldenAngle;
    nodes[index + 1].x = centerX + Math.cos(angle) * radius;
    nodes[index + 1].y = centerY + Math.sin(angle) * radius;
  }
}

function createEdgePath(source, target, id) {
  if (source.key === target.key) {
    const r = source.radius;
    return [
      `M ${round(source.x + r * 0.55)} ${round(source.y - r * 0.55)}`,
      `C ${round(source.x + r + 72)} ${round(source.y - r - 94)}`,
      `${round(source.x - r - 72)} ${round(source.y - r - 94)}`,
      `${round(source.x - r * 0.55)} ${round(source.y - r * 0.55)}`,
    ].join(" ");
  }

  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const unitX = dx / distance;
  const unitY = dy / distance;
  const startX = source.x + unitX * (source.radius + 4);
  const startY = source.y + unitY * (source.radius + 4);
  const endX = target.x - unitX * (target.radius + 9);
  const endY = target.y - unitY * (target.radius + 9);
  const normalX = -unitY;
  const normalY = unitX;
  const curveSeed = (hashString(id) % 7) - 3;
  const curve = curveSeed === 0 ? 18 : curveSeed * 10;
  const controlX = (startX + endX) / 2 + normalX * curve;
  const controlY = (startY + endY) / 2 + normalY * curve;
  return `M ${round(startX)} ${round(startY)} Q ${round(controlX)} ${round(controlY)} ${round(endX)} ${round(endY)}`;
}

function requireObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LiveDataValidationError(`${path} must be an object`);
  }
  return value;
}

function requireString(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new LiveDataValidationError(`${path} must be a non-empty string`);
  }
  return value.trim();
}

function optionalField(value, key, path) {
  if (value === undefined) return {};
  return { [key]: requireString(value, path) };
}

function parseAddress(value, path) {
  const address = requireString(value, path);
  if (!isEvmAddress(address)) {
    throw new LiveDataValidationError(`${path} must be an EVM address`);
  }
  return address;
}

function parseTime(value, path) {
  const time = requireString(value, path);
  if (!Number.isFinite(Date.parse(time))) {
    throw new LiveDataValidationError(`${path} must be an ISO 8601 timestamp`);
  }
  return time;
}

function groupDigits(value) {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function trimFixed(value) {
  return value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2).replace(/\.0+$/, "");
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function round(value) {
  return Math.round(value * 10) / 10;
}
