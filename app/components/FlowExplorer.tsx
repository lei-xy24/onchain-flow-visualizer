"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { FlowDirection, FlowRecord, FlowTransfer } from "@/lib/flow-data";

type FlowExplorerProps = {
  chain: string;
  flow: FlowRecord;
  knownAddresses: string[];
};

type AccountSummary = {
  address: string;
  role: "center" | FlowDirection;
  tag?: string;
  transfers: Array<FlowTransfer & { direction: FlowDirection }>;
};

export function FlowExplorer({
  chain,
  flow,
  knownAddresses,
}: FlowExplorerProps) {
  const [selectedAddress, setSelectedAddress] = useState(flow.address);
  const summaries = useMemo(() => buildAccountSummaries(flow), [flow]);
  const selectedSummary =
    summaries.find(
      (summary) =>
        summary.address.toLowerCase() === selectedAddress.toLowerCase(),
    ) ?? summaries[0];
  const hasData = flow.input.length > 0 || flow.output.length > 0;

  return (
    <main className="result-shell">
      <header className="result-header">
        <Link className="back-link" href="/">
          返回搜索
        </Link>
        <div>
          <p className="eyebrow">链上分析 / {chain.toUpperCase()}</p>
          <h1>资金流分析结果</h1>
        </div>
        <div className="header-actions" aria-label="示例地址快捷入口">
          {knownAddresses.map((address) => (
            <Link key={address} href={`/result/${chain}/${address}`}>
              {shortAddress(address)}
            </Link>
          ))}
        </div>
      </header>

      <section className="summary-strip" aria-label="账户概览">
        <div>
          <span>搜索地址</span>
          <strong title={flow.address}>{shortAddress(flow.address)}</strong>
        </div>
        <div>
          <span>流入合计</span>
          <strong>{formatTransferTotal(flow.input)}</strong>
        </div>
        <div>
          <span>流出合计</span>
          <strong>{formatTransferTotal(flow.output)}</strong>
        </div>
        <div>
          <span>关联账户</span>
          <strong>{Math.max(summaries.length - 1, 0)}</strong>
        </div>
      </section>

      <section className="workspace-grid">
        <div className="graph-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Flow graph</p>
              <h2>Input / Output 关系图</h2>
            </div>
            <span className={hasData ? "status-pill ready" : "status-pill"}>
              {hasData ? "example JSON loaded" : "waiting for backend data"}
            </span>
          </div>

          <div className="flow-graph" aria-label="资金流向图">
            <FlowColumn
              title="资金流入"
              direction="input"
              transfers={flow.input}
              selectedAddress={selectedAddress}
              onSelect={setSelectedAddress}
            />

            <div className="center-column">
              <div className="edge-line left" aria-hidden="true" />
              <button
                type="button"
                className={`account-node center ${
                  selectedAddress.toLowerCase() === flow.address.toLowerCase()
                    ? "selected"
                    : ""
                }`}
                onClick={() => setSelectedAddress(flow.address)}
              >
                <span>中心账户</span>
                <strong title={flow.address}>{shortAddress(flow.address)}</strong>
                <small>{flow.label}</small>
              </button>
              <div className="edge-line right" aria-hidden="true" />
            </div>

            <FlowColumn
              title="资金流出"
              direction="output"
              transfers={flow.output}
              selectedAddress={selectedAddress}
              onSelect={setSelectedAddress}
            />
          </div>

          {!hasData ? (
            <div className="empty-state">
              当前地址还没有示例 JSON 数据。后端接口接入后，这里会显示真实资金流。
            </div>
          ) : null}
        </div>

        <aside className="details-panel" aria-label="账户详情">
          <p className="eyebrow">Account detail</p>
          <h2>{roleLabel(selectedSummary.role)}</h2>
          <p className="detail-address" title={selectedSummary.address}>
            {selectedSummary.address}
          </p>
          <dl className="detail-metrics">
            <div>
              <dt>交易数</dt>
              <dd>{selectedSummary.transfers.length}</dd>
            </div>
            <div>
              <dt>合计金额</dt>
              <dd>{formatTransferTotal(selectedSummary.transfers)}</dd>
            </div>
            <div>
              <dt>标签</dt>
              <dd>{selectedSummary.tag ?? "未标注"}</dd>
            </div>
          </dl>

          <div className="detail-list">
            {selectedSummary.transfers.length ? (
              selectedSummary.transfers.map((transfer) => (
                <article key={`${transfer.txHash}-${transfer.direction}`}>
                  <span>{transfer.direction === "input" ? "流入" : "流出"}</span>
                  <strong>{formatAmount(transfer)}</strong>
                  <small>{formatTime(transfer.time)}</small>
                  <code title={transfer.txHash}>{shortHash(transfer.txHash)}</code>
                </article>
              ))
            ) : (
              <p className="muted">暂无关联交易。</p>
            )}
          </div>
        </aside>
      </section>

      <section className="table-section" aria-labelledby="transaction-table">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Transaction list</p>
            <h2 id="transaction-table">交易明细</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>方向</th>
                <th>账户</th>
                <th>时间</th>
                <th>金额</th>
                <th>交易哈希</th>
              </tr>
            </thead>
            <tbody>
              {[...flow.input, ...flow.output].map((transfer) => {
                const direction = flow.input.includes(transfer)
                  ? "input"
                  : "output";
                return (
                  <tr key={`${direction}-${transfer.txHash}`}>
                    <td>{direction === "input" ? "流入" : "流出"}</td>
                    <td>
                      <button
                        type="button"
                        className="table-address"
                        onClick={() => setSelectedAddress(transfer.address)}
                        title={transfer.address}
                      >
                        {shortAddress(transfer.address)}
                      </button>
                    </td>
                    <td>{formatTime(transfer.time)}</td>
                    <td>{formatAmount(transfer)}</td>
                    <td>
                      <code title={transfer.txHash}>
                        {shortHash(transfer.txHash)}
                      </code>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function FlowColumn({
  title,
  direction,
  transfers,
  selectedAddress,
  onSelect,
}: {
  title: string;
  direction: FlowDirection;
  transfers: FlowTransfer[];
  selectedAddress: string;
  onSelect: (address: string) => void;
}) {
  return (
    <div className={`flow-column ${direction}`}>
      <h3>{title}</h3>
      <div className="account-stack">
        {transfers.map((transfer) => (
          <button
            key={`${direction}-${transfer.txHash}`}
            type="button"
            className={`account-node ${
              selectedAddress.toLowerCase() === transfer.address.toLowerCase()
                ? "selected"
                : ""
            }`}
            onClick={() => onSelect(transfer.address)}
          >
            <span>{transfer.tag ?? "Unknown"}</span>
            <strong title={transfer.address}>
              {shortAddress(transfer.address)}
            </strong>
            <small>{formatAmount(transfer)}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function buildAccountSummaries(flow: FlowRecord): AccountSummary[] {
  const centerTransfers = [
    ...flow.input.map((transfer) => ({ ...transfer, direction: "input" as const })),
    ...flow.output.map((transfer) => ({
      ...transfer,
      direction: "output" as const,
    })),
  ];
  const summaries: AccountSummary[] = [
    {
      address: flow.address,
      role: "center",
      tag: flow.label,
      transfers: centerTransfers,
    },
  ];

  for (const direction of ["input", "output"] as const) {
    for (const transfer of flow[direction]) {
      const existing = summaries.find(
        (summary) =>
          summary.address.toLowerCase() === transfer.address.toLowerCase(),
      );
      if (existing) {
        existing.transfers.push({ ...transfer, direction });
      } else {
        summaries.push({
          address: transfer.address,
          role: direction,
          tag: transfer.tag,
          transfers: [{ ...transfer, direction }],
        });
      }
    }
  }

  return summaries;
}

function roleLabel(role: AccountSummary["role"]) {
  if (role === "center") return "中心账户";
  return role === "input" ? "流入账户" : "流出账户";
}

function formatAmount(transfer: FlowTransfer) {
  return `${transfer.amount.toLocaleString("en-US", {
    maximumFractionDigits: 6,
  })} ${transfer.asset}`;
}

function formatTransferTotal(
  transfers: Array<Pick<FlowTransfer, "amount" | "asset">>,
) {
  if (!transfers.length) return "0";

  const totals = transfers.reduce<Record<string, number>>((acc, transfer) => {
    acc[transfer.asset] = (acc[transfer.asset] ?? 0) + transfer.amount;
    return acc;
  }, {});

  return Object.entries(totals)
    .map(
      ([asset, total]) =>
        `${total.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${asset}`,
    )
    .join(" + ");
}

function formatTime(time: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(time));
}

function shortAddress(address: string) {
  if (address.length <= 14) return address;
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function shortHash(hash: string) {
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}
