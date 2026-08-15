import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPublishedSnapshot, floorToThreeHourSlot, groundModelOutput, requireHttpsBaseUrl, requireHttpsUrl, snapshotIdFor, readJson, validateModelOutput, validateSnapshot } from "../scripts/social-radar-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [config, socialInput, marketInput, modelOutput] = await Promise.all([
  readJson(path.join(root, "social-radar.config.json")),
  readJson(path.join(root, "data/social-input/latest.json")),
  readJson(path.join(root, "data/market-input/latest.json")),
  readJson(path.join(root, "scripts/demo-social-radar-output.json")),
]);

test("三小时区间使用 UTC 整点并生成稳定 id", () => {
  const slot = floorToThreeHourSlot(new Date("2026-08-13T14:47:12Z"));
  assert.equal(slot.toISOString(), "2026-08-13T12:00:00.000Z");
  assert.equal(snapshotIdFor(slot), "20260813T120000Z");
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

test("不支持主题会被忽略且模型自造数字会替换为市场指标引用", () => {
  const candidate = structuredClone(modelOutput);
  candidate.figures[0].topics.push({ ...structuredClone(candidate.figures[0].topics[0]), topicType: "other", name: "美国优先政策与选举动员" });
  const watch = candidate.figures[1].topics[0].story.watch[0];
  delete watch.metricRef;
  watch.metric = "3–4 周";

  const grounded = groundModelOutput(candidate, marketInput);
  assert.equal(grounded.figures[0].topics.some((topic) => topic.topicType === "other"), false);
  assert.equal(grounded.figures[1].topics[0].story.watch[0].metricRef, "metric-0-value");
  assert.deepEqual(validateModelOutput(grounded, socialInput, marketInput, config), []);

  const snapshot = buildPublishedSnapshot({
    config, socialInput, marketInput, modelOutput: grounded, previousSnapshot: null,
    slot: new Date("2026-08-13T12:00:00Z"), generatedAt: "2026-08-13T12:06:00.000Z",
    modelName: config.model, isDemo: false,
  });
  assert.equal(snapshot.figures[1].themes[0].story.watch[0].metric, marketInput.topics.ai_crypto.metrics[0].value);
  assert.notEqual(snapshot.figures[1].themes[0].story.watch[0].metric, "3–4 周");
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
  assert.equal("followingCount" in snapshot.figures[0], false);
  assert.ok(snapshot.figures.flatMap((figure) => figure.themes).flatMap((theme) => theme.evidence).every((item) => item.type === "post"));
});
