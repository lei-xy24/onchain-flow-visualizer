import test from "node:test";
import assert from "node:assert/strict";
import { enrichEventImpactCandidates, prepareEventImpactInput, validateEventImpactCandidates } from "../scripts/event-impact-lib.mjs";

const socialInput = {
  windowEnd: "2026-08-24T00:00:00.000Z",
  figures: [{
    id: "vitalik-buterin", name: "Vitalik Buterin", nameZh: "维塔利克·布特林",
    sources: [
      { id: "original-event", type: "post", kind: "original", publishedAt: "2026-08-21T10:00:00.000Z", title: "Protocol update", text: "A protocol state-management change is proposed for Ethereum nodes.", platform: "X", url: "https://x.com/example/status/1" },
      { id: "handle-reply", type: "post", kind: "reply", publishedAt: "2026-08-22T10:00:00.000Z", title: "Reply", text: "@cb_doge https://t.co/example", platform: "X" },
      { id: "old-post", type: "post", kind: "original", publishedAt: "2026-07-01T10:00:00.000Z", title: "Old", text: "This post is outside the analysis window.", platform: "X" },
    ],
  }],
};

test("事件候选输入排除无信息回复和分析窗口外动态", () => {
  const prepared = prepareEventImpactInput(socialInput, { analysisWindowHours: 168 });
  assert.deepEqual(prepared.figures[0].sources.map((source) => source.id), ["original-event"]);
  assert.equal(prepared.figures[0].sources[0].text.includes("http"), false);
});

test("事件候选只能引用真实来源、允许的影响路径和资产", () => {
  const prepared = prepareEventImpactInput(socialInput, { analysisWindowHours: 168 });
  const candidate = { events: [{
    figureId: "vitalik-buterin", sourceId: "original-event", relevance: "high", confidence: "medium",
    impactChannel: "protocol_technology", candidateAssetIds: ["ethereum"],
    eventSummary: "以太坊协议状态管理方案更新", rationale: "节点负担变化可能影响以太坊基础设施预期。",
  }] };
  assert.deepEqual(validateEventImpactCandidates(candidate, prepared), []);
  const output = enrichEventImpactCandidates(candidate, prepared, "2026-08-24T01:00:00.000Z");
  assert.equal(output.events[0].eventAt, "2026-08-21T10:00:00.000Z");
  assert.equal(output.events[0].url, null);

  const invalid = structuredClone(candidate);
  invalid.events[0].sourceId = "fabricated";
  invalid.events[0].candidateAssetIds = ["fabricated-coin"];
  invalid.events[0].impactChannel = "price_went_up";
  const errors = validateEventImpactCandidates(invalid, prepared);
  assert.ok(errors.some((error) => error.includes("不存在的公开动态")));
  assert.ok(errors.some((error) => error.includes("未知资产")));
  assert.ok(errors.some((error) => error.includes("影响路径无效")));
});
