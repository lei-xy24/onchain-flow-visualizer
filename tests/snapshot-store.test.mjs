import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadStore() {
  const source = await readFile(path.join(root, "snapshot-store.js"), "utf8");
  const context = { window: {}, structuredClone, URL, Date, Intl, Set };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.SocialRadarSnapshots;
}

test("离线迁移后的历史快照不再依赖运行时修复", async () => {
  const [store, raw] = await Promise.all([
    loadStore(),
    readFile(path.join(root, "data/snapshots/20260824T000000Z.json"), "utf8").then(JSON.parse),
  ]);
  const snapshot = store.normalizeSnapshot(raw);
  const trump = snapshot.figures.find((figure) => figure.id === "donald-trump");
  const cz = snapshot.figures.find((figure) => figure.id === "changpeng-zhao");
  assert.ok(trump.themes.every((theme) => theme.topicType !== "market_impact_events"));
  assert.ok(cz.themes.every((theme) => theme.topicType !== "market_impact_events"));
  assert.equal(trump.themes.find((theme) => theme.topicType === "iran_pressure_campaign").marketImpact.reactions.length, 5);
  assert.equal(cz.themes.find((theme) => theme.topicType === "tokenization_advocacy").marketImpact.reactions.length, 3);
  assert.equal(trump.themes.find((theme) => theme.topicType === "midterm_endorsements").marketImpact, undefined);
  assert.ok(raw.figures.every((figure) => figure.themes.every((theme) => theme.topicType !== "market_impact_events")));
  assert.deepEqual(snapshot, raw, "已迁移快照再次归一化必须保持幂等");
});

test("新版主题行情结构归一化时保持幂等", async () => {
  const store = await loadStore();
  const snapshot = {
    status: "published",
    figures: [{ id: "figure", themes: [{ topicType: "topic", sourceIds: ["source"], marketImpact: { reactions: [{ id: "reaction", sourceId: "source" }] } }] }],
  };
  assert.deepEqual(store.normalizeSnapshot(store.normalizeSnapshot(snapshot)), snapshot);
});
