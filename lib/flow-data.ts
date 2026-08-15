import exampleFlowData from "@/data/example-flow.json";

export type FlowDirection = "input" | "output";

export type FlowTransfer = {
  address: string;
  time: string;
  amount: number;
  asset: string;
  txHash: string;
  tag?: string;
};

export type FlowRecord = {
  address: string;
  label?: string;
  input: FlowTransfer[];
  output: FlowTransfer[];
};

type RawFlowRecord = Omit<FlowRecord, "address">;

export type ChainOption = {
  id: string;
  label: string;
};

export const supportedChains: ChainOption[] = [
  { id: "eth", label: "ETH" },
  { id: "bsc", label: "BSC" },
  { id: "polygon", label: "Polygon" },
];

const flowIndex = exampleFlowData as Record<string, Record<string, RawFlowRecord>>;

export function getKnownAddresses(chain = "eth"): string[] {
  return Object.keys(flowIndex[normalizeChain(chain)] ?? {});
}

export function getExamplesByChain(): Record<string, string[]> {
  return supportedChains.reduce<Record<string, string[]>>((acc, chain) => {
    acc[chain.id] = getKnownAddresses(chain.id);
    return acc;
  }, {});
}

export function getFlowByAddress(chain: string, address: string): FlowRecord {
  const chainKey = normalizeChain(chain);
  const normalizedAddress = normalizeAddress(address);
  const matchedKey = getKnownAddresses(chainKey).find(
    (candidate) => normalizeAddress(candidate) === normalizedAddress,
  );

  if (!matchedKey) {
    return {
      address,
      label: "No example data loaded",
      input: [],
      output: [],
    };
  }

  return {
    address: matchedKey,
    ...flowIndex[chainKey][matchedKey],
  };
}

export function normalizeChain(chain: string): string {
  const normalized = chain.trim().toLowerCase();
  return supportedChains.some((item) => item.id === normalized)
    ? normalized
    : "eth";
}

export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function isEvmAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address.trim());
}
