import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the search homepage", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>地址资金流追踪<\/title>/i);
  assert.match(html, /地址资金流追踪/);
  assert.match(html, /搜索地址/);
  assert.match(html, /0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97/);
  assert.match(html, /0xB5C0000000000000000000000000000000000001/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("server-renders an example result page", async () => {
  const response = await render(
    "/result/eth/0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97",
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /资金流分析结果/);
  assert.match(html, /Input \/ Output 关系图/);
  assert.match(html, /Exchange hot wallet/);
  assert.match(html, /交易明细/);
});

test("server-renders a BSC example result page", async () => {
  const response = await render(
    "/result/bsc/0xB5C0000000000000000000000000000000000001",
  );
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /链上分析 \/ <!-- -->BSC/);
  assert.match(html, /BSC sample account/);
  assert.match(html, /BNB/);
});
