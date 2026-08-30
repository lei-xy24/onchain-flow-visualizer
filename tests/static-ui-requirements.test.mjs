import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const protectedPages = [
  "index.html",
  "track.html",
  "result.html",
  "live.html",
  "live-result.html",
  "profile.html",
  "relation.html",
  "hot-topic.html",
  "event-explorer.html",
];
const mirroredFiles = [
  ...protectedPages,
  "auth.css",
  "auth.js",
  "currency-rates.js",
  "login.html",
  "live.css",
  "live-result.js",
  "profile.js",
  "relation.js",
  "runtime-config.js",
];

test("所有业务页先执行登录门禁并提供根目录静态镜像", async () => {
  for (const file of protectedPages) {
    const html = await readFile(path.join(root, file), "utf8");
    assert.match(html, /<html[^>]+data-auth-required="true"/i, file);
    assert.match(html, /\.\/auth\.css\?v=20260830-ui-fix/, file);
    assert.match(html, /\.\/auth\.js\?v=20260830-ui-fix/, file);
  }

  for (const file of mirroredFiles) {
    const [rootContent, staticContent] = await Promise.all([
      readFile(path.join(root, file), "utf8"),
      readFile(path.join(root, "static-site", file), "utf8"),
    ]);
    assert.equal(staticContent, rootContent, `${file} 的两份发布镜像不一致`);
  }
});

test("登录页不预填凭据且门禁使用短期会话和安全返回路径", async () => {
  const [login, auth, authCss] = await Promise.all([
    readFile(path.join(root, "login.html"), "utf8"),
    readFile(path.join(root, "auth.js"), "utf8"),
    readFile(path.join(root, "auth.css"), "utf8"),
  ]);
  assert.doesNotMatch(login, /value=["'][^"']+["']/i);
  assert.match(auth, /SESSION_DURATION_MS\s*=\s*8\s*\*\s*60\s*\*\s*60/);
  assert.match(auth, /target\.origin !== global\.location\.origin/);
  assert.match(auth, /target\.pathname\.startsWith\(siteDirectory\)/);
  assert.match(auth, /crypto\?\.subtle|crypto\.subtle/);
  assert.match(auth, /sessionStorage/);
  assert.doesNotMatch(
    auth,
    /observer\.disconnect\(\)/,
    "结果页重绘后仍需继续观察并恢复退出按钮",
  );
  assert.match(auth, /button\.parentElement === resultActions/);
  assert.match(authCss, /\.login-page \*[^}]+box-sizing:\s*border-box/s);
});

test("实时交易界面、轮询和演示窗口统一为 60 秒", async () => {
  const [live, liveResult, liveScript, liveCss, generator] = await Promise.all([
    readFile(path.join(root, "live.html"), "utf8"),
    readFile(path.join(root, "live-result.html"), "utf8"),
    readFile(path.join(root, "live-result.js"), "utf8"),
    readFile(path.join(root, "live.css"), "utf8"),
    readFile(path.join(root, "scripts/generate-live-demo-batches.mjs"), "utf8"),
  ]);
  assert.match(live, /选择网络，查看实时交易图谱/);
  assert.match(live, /每 60 秒请求一次最近 60 秒/);
  assert.match(liveResult, /当前 60 秒交易/);
  assert.match(liveScript, /POLL_INTERVAL_MS\s*=\s*60_000/);
  assert.doesNotMatch([live, liveResult, liveScript].join("\n"), /10\s*秒/);
  assert.match(generator, /LIVE_WINDOW_MS\s*=\s*60_000/);
  assert.match(
    liveCss,
    /\.live-home-copy h1\s*\{[^}]*font-size:\s*clamp\(2\.45rem,\s*5\.5vw,\s*4rem\)[^}]*max-width:\s*none/s,
  );
  assert.doesNotMatch(
    liveCss,
    /@media\s*\(max-width:\s*880px\)[\s\S]*?\.live-home-copy h1\s*\{\s*font-size:\s*3rem/,
  );

  for (const chain of ["eth", "bsc", "polygon"]) {
    for (let batch = 1; batch <= 5; batch += 1) {
      const file = path.join(root, "mock-live", chain, `batch-${batch}.json`);
      const data = JSON.parse(await readFile(file, "utf8"));
      const from = Date.parse(data.window.from);
      const to = Date.parse(data.window.to);
      assert.equal(to - from, 60_000, file);
      for (const transfer of data.transfers) {
        const time = Date.parse(transfer.time);
        assert.ok(time >= from && time < to, `${file}: ${transfer.id} 超出窗口`);
      }
      const mirrored = JSON.parse(
        await readFile(
          path.join(root, "static-site", "mock-live", chain, `batch-${batch}.json`),
          "utf8",
        ),
      );
      assert.deepEqual(mirrored, data, `${file} 的两份演示数据不一致`);
    }
  }
});

test("四类分析页使用实时单位转换且结果页不再显示地址快捷框", async () => {
  const [result, profile, relation, liveResult, runtimeConfig] = await Promise.all([
    readFile(path.join(root, "result.html"), "utf8"),
    readFile(path.join(root, "profile.js"), "utf8"),
    readFile(path.join(root, "relation.js"), "utf8"),
    readFile(path.join(root, "live-result.js"), "utf8"),
    readFile(path.join(root, "runtime-config.js"), "utf8"),
  ]);
  assert.doesNotMatch(result, /getKnownAddresses|按固定演示汇率估算|demoUsdRates/);
  assert.match(result, /loadUsdRates/);
  assert.match(profile, /profile-unit-toggle/);
  assert.match(relation, /relation-unit-toggle/);
  assert.match(liveResult, /live-unit-toggle/);
  assert.match(runtimeConfig, /marketPrices:\s*"https:\/\/data-api\.binance\.vision\/api\/v3\/ticker\/price"/);
  assert.match(runtimeConfig, /marketPricesSecondary:\s*"https:\/\/api\.gateio\.ws\/api\/v4\/spot\/tickers"/);
  assert.match(runtimeConfig, /marketPricesFallback:\s*"https:\/\/api\.coingecko\.com\/api\/v3\/simple\/price"/);
});

test("退出只在一级页显示，实时交易二级页只保留返回入口", async () => {
  const [result, liveResult, storyResult, auth] = await Promise.all([
    readFile(path.join(root, "result.html"), "utf8"),
    readFile(path.join(root, "live-result.html"), "utf8"),
    readFile(path.join(root, "event-explorer.html"), "utf8"),
    readFile(path.join(root, "auth.js"), "utf8"),
  ]);
  assert.match(result, /data-auth-show-logout="false"/);
  assert.match(liveResult, /data-auth-show-logout="false"/);
  assert.match(storyResult, /data-auth-show-logout="false"/);
  assert.match(auth, /dataset\.authShowLogout === "false"/);

  const navigation = liveResult.match(
    /<nav class="tool-nav monitor-nav"[\s\S]*?<\/nav>/,
  )?.[0];
  assert.ok(navigation, "实时交易二级页应保留返回导航");
  assert.deepEqual([...navigation.matchAll(/href="([^"]+)"/g)].map((item) => item[1]), [
    "./live.html",
  ]);
  assert.match(navigation, /← 返回实时交易/);
  assert.doesNotMatch(navigation, /index\.html|track\.html|profile\.html|relation\.html/);

  for (const page of ["index.html", "track.html", "live.html", "profile.html", "relation.html", "hot-topic.html"]) {
    const html = await readFile(path.join(root, page), "utf8");
    assert.doesNotMatch(html, /data-auth-show-logout="false"/, page);
  }
});

test("地址关联页使用不会在桌面端断成两行的短标题", async () => {
  const relation = await readFile(path.join(root, "relation.html"), "utf8");
  assert.match(relation, /<title>地址关联查询<\/title>/);
  assert.match(relation, /<h1>地址关联查询<\/h1>/);
  assert.doesNotMatch(relation, />地址关联交易查询</);
});
