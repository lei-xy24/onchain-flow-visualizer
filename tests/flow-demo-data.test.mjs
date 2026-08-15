import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateFlowRecord } from "../static-site/flow-demo-data.js";

test("用户画像与地址关联会校验后端资金流结构", async () => {
  const sample = JSON.parse(await readFile(
    new URL("../static-site/mock-api/eth/0x4838b106fce9647bdf1e7877bf73ce8b0bad5f97.json", import.meta.url),
    "utf8",
  ));
  assert.equal(validateFlowRecord(sample, "eth", sample.address), sample);

  const invalid = structuredClone(sample);
  invalid.input[0].tag = "<img src=x onerror=alert(1)>";
  invalid.input[0].txHash = "not-a-transaction-hash";
  assert.throws(() => validateFlowRecord(invalid, "eth", invalid.address), /txHash/);
  assert.throws(() => validateFlowRecord(sample, "bsc", sample.address), /网络/);
});
