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

// Density is based on token amount magnitude so the demo does not require a price API.
export const DENSITY_RULES = Object.freeze([
  {
    level: 1,
    minScore: Number.NEGATIVE_INFINITY,
    maxScore: 0,
    label: "微量",
    dotGap: 28,
    width: 2.4,
  },
  {
    level: 2,
    minScore: 0,
    maxScore: 2,
    label: "小额",
    dotGap: 22,
    width: 2.8,
  },
  {
    level: 3,
    minScore: 2,
    maxScore: 4,
    label: "中等",
    dotGap: 18,
    width: 3.2,
  },
  {
    level: 4,
    minScore: 4,
    maxScore: 6,
    label: "大额",
    dotGap: 13,
    width: 3.8,
  },
  {
    level: 5,
    minScore: 6,
    maxScore: Number.POSITIVE_INFINITY,
    label: "巨额",
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
      amountScore: getAmountScore(rawAmount, decimals),
      amountWeight: Math.max(0.1, getAmountScore(rawAmount, decimals) + 7),
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

export function getDensityRule(amountScore) {
  return (
    DENSITY_RULES.find(
      (rule) => amountScore >= rule.minScore && amountScore < rule.maxScore,
    ) || DENSITY_RULES[DENSITY_RULES.length - 1]
  );
}

export function buildGraphModel(
  response,
  width = 1100,
  height = 700,
  previousGraph = null,
) {
  const previousNodes = Array.isArray(previousGraph?.nodes)
    ? previousGraph.nodes
    : [];
  const nodeMap = new Map(
    previousNodes.map((node, index) => [
      node.key,
      {
        ...node,
        order: Number.isInteger(node.order) ? node.order : index,
        active: false,
        currentInAmountWeight: 0,
        currentOutAmountWeight: 0,
        currentTotalAmountWeight: 0,
        currentTransactionCount: 0,
      },
    ]),
  );
  const seenTransferIds = new Set(previousGraph?.seenTransferIds || []);
  let nextOrder = previousNodes.reduce(
    (highest, node, index) =>
      Math.max(highest, Number.isInteger(node.order) ? node.order : index),
    -1,
  ) + 1;

  for (const transfer of response.transfers) {
    const fromResult = getOrCreateNode(
      nodeMap,
      transfer.from,
      transfer.fromLabel,
      nextOrder,
      transfer.time,
    );
    if (fromResult.created) nextOrder += 1;
    const toResult = getOrCreateNode(
      nodeMap,
      transfer.to,
      transfer.toLabel,
      nextOrder,
      transfer.time,
    );
    if (toResult.created) nextOrder += 1;

    updateNodeMetrics(
      fromResult.node,
      toResult.node,
      transfer.amountWeight,
      "current",
    );
    fromResult.node.active = true;
    toResult.node.active = true;
    fromResult.node.lastSeenAt = latestTime(
      fromResult.node.lastSeenAt,
      transfer.time,
    );
    toResult.node.lastSeenAt = latestTime(toResult.node.lastSeenAt, transfer.time);

    if (!seenTransferIds.has(transfer.id)) {
      updateNodeMetrics(fromResult.node, toResult.node, transfer.amountWeight);
      seenTransferIds.add(transfer.id);
    }
  }

  const nodes = [...nodeMap.values()].sort(
    (left, right) => left.order - right.order || left.address.localeCompare(right.address),
  );
  const layoutScale = positionNodes(
    nodes,
    response.transfers,
    width,
    height,
    previousGraph,
  );
  const positioned = new Map(nodes.map((node) => [node.key, node]));

  const edges = response.transfers.map((transfer) => {
    const source = positioned.get(transfer.from.toLowerCase());
    const target = positioned.get(transfer.to.toLowerCase());
    const density = getDensityRule(transfer.amountScore);
    return {
      ...transfer,
      source,
      target,
      density,
      path: createEdgePath(source, target, transfer.id),
    };
  });

  return { nodes, edges, width, height, layoutScale, seenTransferIds };
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

export function formatTransferAmount(transfer) {
  return `${formatRawAmount(transfer.rawAmount, transfer.decimals)} ${transfer.asset}`;
}

export function formatTransferTotal(transfers) {
  if (!Array.isArray(transfers) || transfers.length === 0) return "0";
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

  const symbolCounts = new Map();
  for (const total of totals.values()) {
    symbolCounts.set(total.asset, (symbolCounts.get(total.asset) || 0) + 1);
  }

  return [...totals.values()]
    .map((total) => {
      const qualifier =
        (symbolCounts.get(total.asset) || 0) > 1 && total.assetAddress
          ? ` (${shortAddress(total.assetAddress)})`
          : "";
      return `${formatRawAmount(total.rawAmount, total.decimals)} ${total.asset}${qualifier}`;
    })
    .join(" + ");
}

function addRawAmounts(existing, transfer) {
  return {
    ...existing,
    rawAmount: (BigInt(existing.rawAmount) + BigInt(transfer.rawAmount)).toString(),
  };
}

function getAmountScore(rawAmount, decimals) {
  const normalized = rawAmount.replace(/^0+/, "");
  if (!normalized) return Number.NEGATIVE_INFINITY;

  const sampleLength = Math.min(15, normalized.length);
  const sample = Number(normalized.slice(0, sampleLength));
  if (!sample) return Number.NEGATIVE_INFINITY;

  return Math.log10(sample) + (normalized.length - sampleLength) - decimals;
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

function getOrCreateNode(nodeMap, address, label, order, firstSeenAt) {
  const key = address.toLowerCase();
  if (!nodeMap.has(key)) {
    nodeMap.set(key, {
      key,
      address,
      label: label || shortAddress(address),
      order,
      firstSeenAt,
      lastSeenAt: firstSeenAt,
      active: false,
      inAmountWeight: 0,
      outAmountWeight: 0,
      totalAmountWeight: 0,
      transactionCount: 0,
      currentInAmountWeight: 0,
      currentOutAmountWeight: 0,
      currentTotalAmountWeight: 0,
      currentTransactionCount: 0,
      radius: 30,
      x: 0,
      y: 0,
    });
    return { node: nodeMap.get(key), created: true };
  } else if (label && nodeMap.get(key).label === shortAddress(address)) {
    nodeMap.get(key).label = label;
  }
  return { node: nodeMap.get(key), created: false };
}

function updateNodeMetrics(fromNode, toNode, amountWeight, prefix = "") {
  const field = (name) =>
    prefix ? `${prefix}${name[0].toUpperCase()}${name.slice(1)}` : name;
  fromNode[field("outAmountWeight")] += amountWeight;
  toNode[field("inAmountWeight")] += amountWeight;

  if (fromNode.key === toNode.key) {
    fromNode[field("totalAmountWeight")] += amountWeight;
    fromNode[field("transactionCount")] += 1;
    return;
  }

  fromNode[field("totalAmountWeight")] += amountWeight;
  fromNode[field("transactionCount")] += 1;
  toNode[field("totalAmountWeight")] += amountWeight;
  toNode[field("transactionCount")] += 1;
}

function positionNodes(nodes, transfers, width, height, previousGraph) {
  if (nodes.length === 0) return 1;
  const centerX = width / 2;
  const centerY = height / 2;
  const crowdedScale = nodes.length > 24 ? 0.72 : nodes.length > 14 ? 0.84 : 1;
  const layoutScale = getLayoutScale(nodes.length);

  nodes.forEach((node) => {
    node.radius = Math.round(
      Math.max(
        22,
        Math.min(
          44,
          (25 + Math.log10(node.totalAmountWeight + 1) * 2.8) * crowdedScale,
        ),
      ),
    );
  });

  const previousByKey = new Map(
    (previousGraph?.nodes || []).map((node) => [node.key, node]),
  );
  if (previousByKey.size === 0) {
    positionInitialNodes(nodes, width, height, layoutScale);
    return layoutScale;
  }

  const previousWidth = previousGraph.width || width;
  const previousHeight = previousGraph.height || height;
  const previousCenterX = previousWidth / 2;
  const previousCenterY = previousHeight / 2;
  const previousLayoutScale =
    previousGraph.layoutScale || getLayoutScale(previousByKey.size);
  const compactRatio = layoutScale / previousLayoutScale;
  const geometryChanged =
    previousWidth !== width || previousHeight !== height || compactRatio !== 1;
  const positionedNodes = [];

  for (const node of nodes) {
    const previousNode = previousByKey.get(node.key);
    if (!previousNode) continue;
    if (!geometryChanged) {
      node.x = previousNode.x;
      node.y = previousNode.y;
      positionedNodes.push(node);
      continue;
    }
    node.x = clamp(
      centerX +
        (previousNode.x - previousCenterX) *
          (width / previousWidth) *
          compactRatio,
      node.radius + 54,
      width - node.radius - 54,
    );
    node.y = clamp(
      centerY +
        (previousNode.y - previousCenterY) *
          (height / previousHeight) *
          compactRatio,
      node.radius + 30,
      height - node.radius - 58,
    );
    positionedNodes.push(node);
  }

  for (const node of nodes) {
    if (previousByKey.has(node.key)) continue;
    const anchor = getNodeAnchor(
      node.key,
      transfers,
      new Map(positionedNodes.map((item) => [item.key, item])),
      centerX,
      centerY,
    );
    const position = findOpenPosition(
      node,
      positionedNodes,
      anchor,
      width,
      height,
    );
    node.x = position.x;
    node.y = position.y;
    positionedNodes.push(node);
  }

  return layoutScale;
}

function positionInitialNodes(nodes, width, height, layoutScale) {
  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.min(width * 0.39, height * 0.39) * layoutScale;
  const layoutOrder = [...nodes].sort(
    (left, right) =>
      right.currentTransactionCount - left.currentTransactionCount ||
      right.currentTotalAmountWeight - left.currentTotalAmountWeight ||
      left.order - right.order,
  );

  layoutOrder[0].x = centerX;
  layoutOrder[0].y = centerY;
  if (layoutOrder.length === 1) return;

  const remaining = layoutOrder.length - 1;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let index = 0; index < remaining; index += 1) {
    const normalized = remaining === 1 ? 1 : Math.sqrt((index + 1) / remaining);
    const radius = 110 + normalized * Math.max(0, maxRadius - 110);
    const angle = -Math.PI / 2 + index * goldenAngle;
    layoutOrder[index + 1].x = centerX + Math.cos(angle) * radius;
    layoutOrder[index + 1].y = centerY + Math.sin(angle) * radius;
  }
}

function getLayoutScale(nodeCount) {
  if (nodeCount <= 10) return 1;
  return Math.max(0.72, 1 - (nodeCount - 10) * 0.012);
}

function getNodeAnchor(nodeKey, transfers, positioned, centerX, centerY) {
  const related = [];
  for (const transfer of transfers) {
    const fromKey = transfer.from.toLowerCase();
    const toKey = transfer.to.toLowerCase();
    if (fromKey === nodeKey && positioned.has(toKey)) {
      related.push(positioned.get(toKey));
    } else if (toKey === nodeKey && positioned.has(fromKey)) {
      related.push(positioned.get(fromKey));
    }
  }

  if (related.length === 0) return { x: centerX, y: centerY };
  return {
    x: related.reduce((sum, node) => sum + node.x, 0) / related.length,
    y: related.reduce((sum, node) => sum + node.y, 0) / related.length,
  };
}

function findOpenPosition(node, positionedNodes, anchor, width, height) {
  if (positionedNodes.length === 0) {
    return { x: width / 2, y: height / 2 };
  }

  const horizontalMargin = node.radius + 54;
  const topMargin = node.radius + 30;
  const bottomMargin = node.radius + 58;
  const desiredGap = positionedNodes.length > 24
    ? 16
    : positionedNodes.length > 14
      ? 26
      : 40;
  const seedAngle = ((hashString(node.key) % 360) / 180) * Math.PI;
  let best = null;

  for (let ring = 1; ring <= 8; ring += 1) {
    const slots = 10 + ring * 4;
    const distance = 86 + ring * 42;
    for (let slot = 0; slot < slots; slot += 1) {
      const angle = seedAngle + (slot / slots) * Math.PI * 2;
      const candidate = {
        x: clamp(
          anchor.x + Math.cos(angle) * distance,
          horizontalMargin,
          width - horizontalMargin,
        ),
        y: clamp(
          anchor.y + Math.sin(angle) * distance,
          topMargin,
          height - bottomMargin,
        ),
      };
      const clearance = Math.min(
        ...positionedNodes.map(
          (positioned) =>
            Math.hypot(candidate.x - positioned.x, candidate.y - positioned.y) -
            node.radius -
            positioned.radius,
        ),
      );
      const anchorDistance = Math.hypot(
        candidate.x - anchor.x,
        candidate.y - anchor.y,
      );
      const score = clearance - anchorDistance * 0.025;
      if (!best || score > best.score) best = { ...candidate, score };
      if (clearance >= desiredGap) return candidate;
    }
  }

  return best || { x: width / 2, y: height / 2 };
}

function latestTime(current, candidate) {
  if (!current || Date.parse(candidate) > Date.parse(current)) return candidate;
  return current;
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

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
