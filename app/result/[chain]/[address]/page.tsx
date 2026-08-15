import type { Metadata } from "next";
import { FlowExplorer } from "@/app/components/FlowExplorer";
import { getFlowByAddress, getKnownAddresses, normalizeChain } from "@/lib/flow-data";

type ResultPageProps = {
  params: Promise<{
    chain: string;
    address: string;
  }>;
};

export async function generateMetadata({
  params,
}: ResultPageProps): Promise<Metadata> {
  const { address } = await params;
  return {
    title: `${shortAddress(address)} | 资金流分析`,
    description: "查看链上账户的示例资金流入、流出关系和账户详情。",
  };
}

export default async function ResultPage({ params }: ResultPageProps) {
  const { chain, address } = await params;
  const normalizedChain = normalizeChain(chain);
  const flow = getFlowByAddress(normalizedChain, address);

  return (
    <FlowExplorer
      chain={normalizedChain}
      flow={flow}
      knownAddresses={getKnownAddresses(normalizedChain)}
    />
  );
}

function shortAddress(address: string) {
  if (address.length <= 14) return address;
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}
