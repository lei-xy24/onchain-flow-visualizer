import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPublishedSnapshot, floorToPublishSlot, groundModelOutput, requireHttpsBaseUrl, requireHttpsUrl, snapshotIdFor, readJson, validateModelOutput, validateSnapshot } from "../scripts/social-radar-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [config, socialInput, marketInput, eventMarketInput, modelOutput] = await Promise.all([
  readJson(path.join(root, "social-radar.config.json")),
  readJson(path.join(root, "scripts/demo-social-radar-input.json")),
  readJson(path.join(root, "scripts/demo-market-input.json")),
  readJson(path.join(root, "scripts/demo-event-market-input.json")),
  readJson(path.join(root, "scripts/demo-social-radar-output.json")),
]);

test("每周发布区间使用周一 UTC 整点并生成稳定 id", () => {
  const slot = floorToPublishSlot(new Date("2026-08-13T14:47:12Z"), config.schedule);
  assert.equal(slot.toISOString(), "2026-08-10T00:00:00.000Z");
  assert.equal(snapshotIdFor(slot), "20260810T000000Z");
});

test("携带密钥的外部接口只允许无账号信息的 HTTPS 地址", () => {
  assert.equal(requireHttpsBaseUrl("https://api.example.com/v1/", "测试接口"), "https://api.example.com/v1");
  assert.throws(() => requireHttpsUrl("http://api.example.com", "测试接口"), /HTTPS/);
  assert.throws(() => requireHttpsUrl("https://user:pass@example.com", "测试接口"), /用户名或密码/);
});

test("演示模型输出能通过证据和市场数据校验", () => {
  assert.deepEqual(validateModelOutput(modelOutput, socialInput, marketInput, config), []);
});

test("不存在的来源和市场指标会阻止发布", () => {
  const invalid = structuredClone(modelOutput);
  invalid.figures[0].topics[0].sourceIds[0] = "fabricated-source";
  invalid.figures[0].topics[0].story.watch[0].metricRef = "metric-99-value";
  const errors = validateModelOutput(invalid, socialInput, marketInput, config);
  assert.ok(errors.some((error) => error.includes("不存在的证据")));
  assert.ok(errors.some((error) => error.includes("不存在的指标引用")));
});

test("普通主题保留证据分析且市场主题只使用真实指标", () => {
  const candidate = structuredClone(modelOutput);
  const generalTopic = structuredClone(candidate.figures[0].topics[0]);
  generalTopic.topicType = "trade_policy";
  generalTopic.dataMode = "evidence";
  generalTopic.name = "关税与贸易执法";
  generalTopic.category = "公共政策";
  generalTopic.story.watch = [
    { title: "执法是否持续", focus: "持续性", detail: "关注后续公开动态是否继续讨论关税执法。", tone: "teal" },
    { title: "政策是否具体", focus: "具体化", detail: "关注是否出现更具体的政策范围和时间节点。", tone: "amber" },
    { title: "议题是否转向", focus: "议题变化", detail: "比较后续关键词是否转向新的贸易子议题。", tone: "violet" },
  ];
  candidate.figures[0].topics = [generalTopic];
  const watch = candidate.figures[1].topics[0].story.watch[0];
  delete watch.metricRef;
  watch.metric = "3–4 周";

  const grounded = groundModelOutput(candidate, marketInput);
  assert.equal(grounded.figures[0].topics[0].topicType, "trade_policy");
  assert.equal(grounded.figures[0].topics[0].dataMode, "evidence");
  assert.equal("metricRef" in grounded.figures[0].topics[0].story.watch[0], false);
  assert.equal(grounded.figures[1].topics[0].story.watch[0].metricRef, "metric-0-value");
  assert.deepEqual(validateModelOutput(grounded, socialInput, marketInput, config), []);

  const snapshot = buildPublishedSnapshot({
    config, socialInput, marketInput, modelOutput: grounded, previousSnapshot: null,
    slot: new Date("2026-08-13T12:00:00Z"), generatedAt: "2026-08-13T12:06:00.000Z",
    modelName: config.model, isDemo: false,
  });
  const generalStory = snapshot.figures[0].themes[0].story;
  assert.equal(generalStory.dataMode, "evidence");
  assert.equal(generalStory.snapshot[0].label, "关联公开动态");
  assert.equal(generalStory.ranking.label, "按公开动态证据覆盖排序");
  assert.equal(generalStory.watch[0].metric, "持续性");
  assert.equal(JSON.stringify(generalStory).includes("公链资产市场规模"), false);
  assert.equal(snapshot.figures[1].themes[0].story.watch[0].metric, marketInput.topics.ai_crypto.metrics[0].value);
  assert.notEqual(snapshot.figures[1].themes[0].story.watch[0].metric, "3–4 周");
});

test("普通主题引用市场指标时拒绝发布", () => {
  const invalid = structuredClone(modelOutput);
  invalid.figures[0].topics[0].topicType = "trade_policy";
  invalid.figures[0].topics[0].dataMode = "evidence";
  invalid.figures[0].topics[0].story.watch[0].focus = "持续性";
  const errors = validateModelOutput(invalid, socialInput, marketInput, config);
  assert.ok(errors.some((error) => error.includes("非市场主题不应引用市场指标")));
});

test("自定义市场标识会归一化为直接相关模板", () => {
  const candidate = structuredClone(modelOutput);
  const bitcoinTopic = candidate.figures[0].topics.find((topic) => topic.topicType === "bitcoin");
  bitcoinTopic.topicType = "bitcoin_supply_scarcity";
  bitcoinTopic.name = "比特币供应稀缺性";

  const grounded = groundModelOutput(candidate, marketInput);
  const normalized = grounded.figures[0].topics.find((topic) => topic.name === "比特币供应稀缺性");
  assert.equal(normalized.dataMode, "market");
  assert.equal(normalized.topicType, "bitcoin");
  assert.ok(normalized.story.watch.every((watch) => /^metric-|^ranking-/.test(watch.metricRef)));
  assert.deepEqual(validateModelOutput(grounded, socialInput, marketInput, config), []);
});

test("找不到直接市场模板的候选会自动降级为证据分析", () => {
  const candidate = structuredClone(modelOutput);
  const topic = candidate.figures[2].topics.find((item) => item.topicType === "layer2");
  topic.topicType = "ethereum_scaling_state_management";
  topic.name = "以太坊扩容与状态管理";
  topic.category = "协议研发";
  topic.summary = "近期动态集中讨论以太坊状态增长、节点负担与协议实现。";
  topic.why = "多条公开动态持续讨论状态管理问题。";
  topic.keywords = ["以太坊", "扩容", "状态管理"];

  const grounded = groundModelOutput(candidate, marketInput);
  const downgraded = grounded.figures[2].topics.find((item) => item.name === "以太坊扩容与状态管理");
  assert.equal(downgraded.dataMode, "evidence");
  assert.equal(downgraded.topicType, "ethereum_scaling_state_management");
  assert.ok(downgraded.story.watch.every((watch) => watch.focus && !("metricRef" in watch)));
  assert.match(downgraded.story.chapters[2].body, /不是公链、资产或市值排名/);
  assert.deepEqual(validateModelOutput(grounded, socialInput, marketInput, config), []);
});

test("DeepSeek 返回合法但缺字段的 JSON 时安全拒绝", () => {
  const invalid = structuredClone(modelOutput);
  invalid.figures[0].topics[0] = { topicType: "stablecoin", name: "不完整主题" };
  const errors = validateModelOutput(invalid, socialInput, marketInput, config);
  assert.ok(errors.some((error) => error.includes("缺少 sourceIds")));
  assert.ok(errors.some((error) => error.includes("四章故事")));
});

test("关注来源和转发动态不能进入模型输入", () => {
  const invalidSocial = structuredClone(socialInput);
  invalidSocial.figures[0].sources.push({ id: "legacy-follow", type: "follow", publishedAt: invalidSocial.windowEnd });
  invalidSocial.figures[1].sources.push({ id: "x-retweet", type: "post", kind: "retweet", publishedAt: invalidSocial.windowEnd });
  const errors = validateModelOutput(modelOutput, invalidSocial, marketInput, config);
  assert.ok(errors.some((error) => error.includes("非动态来源")));
  assert.ok(errors.some((error) => error.includes("已排除的转发")));
});

test("发布快照包含人物、故事和完整四章", () => {
  const slot = new Date("2026-08-13T12:00:00Z");
  const snapshot = buildPublishedSnapshot({
    config, socialInput, marketInput, modelOutput, previousSnapshot: null, slot,
    generatedAt: "2026-08-13T12:06:00.000Z", modelName: config.model, isDemo: true,
  });
  assert.deepEqual(validateSnapshot(snapshot), []);
  assert.equal(snapshot.figures.length, 4);
  assert.equal(snapshot.figures[0].themes[0].story.chapters.length, 4);
  assert.equal(snapshot.status, "published");
  assert.equal(snapshot.modelProvider, "deepseek");
  assert.equal(snapshot.nextScheduledAt, "2026-08-17T00:00:00.000Z");
  assert.match(snapshot.description, /每周一北京时间 08:00/);
  assert.equal("followingCount" in snapshot.figures[0], false);
  assert.ok(snapshot.figures.flatMap((figure) => figure.themes).flatMap((theme) => theme.evidence).every((item) => item.type === "post"));
});

test("事件行情按动态来源归入真实主题，不再生成并列波动主题", () => {
  const snapshot = buildPublishedSnapshot({
    config, socialInput, marketInput, eventMarketInput, modelOutput, previousSnapshot: null,
    slot: new Date("2026-08-10T00:00:00.000Z"), generatedAt: "2026-08-13T10:06:00.000Z",
    modelName: config.model, isDemo: true,
  });
  assert.deepEqual(validateSnapshot(snapshot), []);
  const trump = snapshot.figures.find((figure) => figure.id === "donald-trump");
  const bitcoin = trump.themes.find((theme) => theme.topicType === "bitcoin");
  const stablecoin = trump.themes.find((theme) => theme.topicType === "stablecoin");
  assert.ok(trump.themes.every((theme) => theme.topicType !== "market_impact_events"));
  assert.equal(bitcoin.story.dataMode, "market");
  assert.equal(stablecoin.story.dataMode, "market");
  assert.equal(bitcoin.marketImpact.reactions.length, 2);
  assert.equal(stablecoin.marketImpact.reactions.length, 1);
  assert.ok(bitcoin.marketImpact.reactions.every((reaction) => bitcoin.sourceIds.includes(reaction.sourceId)));
  assert.equal("marketReactions" in bitcoin.story, false);
});

test("单条关键动态只挂到引用它的已有主题", () => {
  const oneReaction = structuredClone(eventMarketInput);
  oneReaction.reactions = oneReaction.reactions.filter((reaction) => reaction.sourceId === "vitalik-post-zkevm");
  const snapshot = buildPublishedSnapshot({
    config, socialInput, marketInput, eventMarketInput: oneReaction, modelOutput, previousSnapshot: null,
    slot: new Date("2026-08-10T00:00:00.000Z"), generatedAt: "2026-08-13T10:06:00.000Z",
    modelName: config.model, isDemo: true,
  });
  const vitalik = snapshot.figures.find((figure) => figure.id === "vitalik-buterin");
  assert.equal(vitalik.themes.length, 2);
  assert.ok(vitalik.themes.every((theme) => theme.marketImpact?.reactions.length === 1));
  assert.ok(vitalik.themes.every((theme) => theme.topicType !== "market_impact_events"));
  assert.deepEqual(validateSnapshot(snapshot), []);
});

test("未达到异常阈值的行情仍如实标为普通波动", () => {
  const ordinary = structuredClone(eventMarketInput);
  ordinary.reactions.forEach((reaction) => { reaction.significance = { passed: false, level: "ordinary", reasons: ["未达到预设阈值"] }; });
  const snapshot = buildPublishedSnapshot({
    config, socialInput, marketInput, eventMarketInput: ordinary, modelOutput, previousSnapshot: null,
    slot: new Date("2026-08-10T00:00:00.000Z"), generatedAt: "2026-08-13T10:06:00.000Z",
    modelName: config.model, isDemo: false,
  });
  const bitcoin = snapshot.figures.find((figure) => figure.id === "donald-trump").themes.find((theme) => theme.topicType === "bitcoin");
  assert.equal(bitcoin.marketImpact.status, "ordinary");
  assert.equal(bitcoin.marketImpact.reactions.length, 2);
  assert.ok(bitcoin.marketImpact.reactions.every((reaction) => reaction.significance.passed === false));
  assert.deepEqual(validateSnapshot(snapshot), []);
});

test("同一真实主题会保留九十天内的历史事件行情", () => {
  const first = buildPublishedSnapshot({
    config, socialInput, marketInput, eventMarketInput, modelOutput, previousSnapshot: null,
    slot: new Date("2026-08-10T00:00:00.000Z"), generatedAt: "2026-08-13T10:06:00.000Z",
    modelName: config.model, isDemo: true,
  });
  const previousTheme = first.figures.find((figure) => figure.id === "donald-trump").themes.find((theme) => theme.topicType === "bitcoin");
  const olderReaction = structuredClone(previousTheme.marketImpact.reactions[0]);
  olderReaction.id = "older-bitcoin-event-btc";
  olderReaction.sourceId = "older-bitcoin-event";
  olderReaction.eventAt = "2026-07-20T12:00:00.000Z";
  olderReaction.eventTitle = "历史比特币相关动态";
  previousTheme.marketImpact.reactions.push(olderReaction);

  const next = buildPublishedSnapshot({
    config, socialInput, marketInput, eventMarketInput, modelOutput, previousSnapshot: first,
    slot: new Date("2026-08-17T00:00:00.000Z"), generatedAt: "2026-08-20T10:06:00.000Z",
    modelName: config.model, isDemo: false,
  });
  const nextTheme = next.figures.find((figure) => figure.id === "donald-trump").themes.find((theme) => theme.topicType === "bitcoin");
  assert.ok(nextTheme.marketImpact.reactions.some((reaction) => reaction.id === olderReaction.id && reaction.isCurrentWindow === false));
  assert.ok(next.figures.every((figure) => figure.themes.every((theme) => theme.topicType !== "market_impact_events")));
  assert.deepEqual(validateSnapshot(next), []);
});
