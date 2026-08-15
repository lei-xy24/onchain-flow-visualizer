"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { isEvmAddress, type ChainOption } from "@/lib/flow-data";

type HomeSearchProps = {
  chains: ChainOption[];
  examplesByChain: Record<string, string[]>;
};

export function HomeSearch({ chains, examplesByChain }: HomeSearchProps) {
  const router = useRouter();
  const defaultChain = chains[0]?.id ?? "eth";
  const [chain, setChain] = useState(defaultChain);
  const [address, setAddress] = useState(examplesByChain[defaultChain]?.[0] ?? "");
  const [error, setError] = useState("");
  function openResult(nextAddress: string, nextChain = chain) {
    const cleaned = nextAddress.trim();
    if (!isEvmAddress(cleaned)) {
      setError("请输入有效的 EVM 地址（0x 加 40 位十六进制字符）。");
      return;
    }

    setError("");
    router.push(`/result/${nextChain}/${encodeURIComponent(cleaned)}`);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    openResult(address);
  }

  return (
    <main className="home-shell">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="brand-mark" aria-hidden="true">
          DF
        </div>
        <p className="eyebrow">区块链与数字金融服务安全测试平台</p>
        <h1 id="home-title">地址资金流追踪</h1>
        <p className="hero-copy">
          输入链上账户地址，查看示例 JSON 中的资金流入、流出关系和账户详情。
        </p>

        <form className="search-panel" onSubmit={handleSubmit}>
          <label className="field-label" htmlFor="address-search">
            搜索地址
          </label>
          <div className="search-row">
            <select
              aria-label="选择链"
              className="chain-select"
              value={chain}
              onChange={(event) => {
                const nextChain = event.target.value;
                setChain(nextChain);
                setAddress(examplesByChain[nextChain]?.[0] ?? "");
              }}
            >
              {chains.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <input
              id="address-search"
              autoComplete="off"
              spellCheck={false}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="0x..."
            />
            <button type="submit">搜索</button>
          </div>
          {error ? <p className="form-error">{error}</p> : null}
        </form>

        <div className="quick-examples" aria-label="示例地址">
          {chains.flatMap((item) =>
            (examplesByChain[item.id] ?? []).map((example) => (
              <button
                key={`${item.id}-${example}`}
                type="button"
                onClick={() => openResult(example, item.id)}
                title={example}
              >
                {item.label} {shortAddress(example)}
              </button>
            )),
          )}
        </div>
      </section>
    </main>
  );
}

function shortAddress(address: string) {
  if (address.length <= 14) return address;
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}
