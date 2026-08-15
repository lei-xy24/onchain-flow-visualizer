import { HomeSearch } from "@/app/components/HomeSearch";
import { getExamplesByChain, supportedChains } from "@/lib/flow-data";

export default function Home() {
  return (
    <HomeSearch
      chains={supportedChains}
      examplesByChain={getExamplesByChain()}
    />
  );
}
