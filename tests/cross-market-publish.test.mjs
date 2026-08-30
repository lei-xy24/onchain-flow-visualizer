import assert from "node:assert/strict";
import test from "node:test";

import { isAllowedCrossMarketPublishPath } from "../scripts/publish-cross-market-to-github.mjs";

test("跨市场自动发布只允许两份 latest.json 镜像", () => {
  assert.equal(isAllowedCrossMarketPublishPath("data/cross-market/latest.json"), true);
  assert.equal(isAllowedCrossMarketPublishPath("static-site/data/cross-market/latest.json"), true);

  for (const candidate of [
    "data/cross-market/history.json",
    "data/cross-market/latest.json.bak",
    "data/cross-market/../social-input/latest.json",
    "static-site/data/cross-market/../../index.html",
    "work/data/cross-market/latest.json",
    "/data/cross-market/latest.json",
    "../data/cross-market/latest.json",
    "static-site\\data\\cross-market\\latest.json",
    ".env",
  ]) {
    assert.equal(isAllowedCrossMarketPublishPath(candidate), false, candidate);
  }
});
