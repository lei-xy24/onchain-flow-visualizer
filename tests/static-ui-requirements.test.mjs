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
  "global-markets.html",
];
const mirroredFiles = [
  ...protectedPages,
  "auth.css",
  "auth.js",
  "currency-rates.js",
  "event-explorer.css",
  "event-explorer.js",
  "global-markets.css",
  "global-markets.js",
  "hot-topic.css",
  "hot-topic.js",
  "login.html",
  "live.css",
  "live-result.js",
  "live-search.js",
  "profile.js",
  "relation.js",
  "runtime-config.js",
  "snapshot-store.js",
];

function readAnchors(html) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((match) => {
    const attributes = match[1];
    const readAttribute = (name) => {
      const value = attributes.match(new RegExp(`\\b${name}=(['\"])(.*?)\\1`, "i"));
      return value?.[2] ?? "";
    };
    return {
      className: readAttribute("class").replace(/\s+/g, " ").trim(),
      href: readAttribute("href"),
      text: match[2].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim(),
    };
  });
}

test("所有业务页先执行登录门禁并提供根目录静态镜像", async () => {
  for (const file of protectedPages) {
    const html = await readFile(path.join(root, file), "utf8");
    assert.match(html, /<html[^>]+data-auth-required="true"/i, file);
    assert.match(html, /\.\/auth\.css\?v=[^"']+/, file);
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

test("全球市场联动入口紧跟人物兴趣雷达并复用同尺寸卡片骨架", async () => {
  const index = await readFile(path.join(root, "index.html"), "utf8");
  const radarIndex = index.indexOf('aria-labelledby="hot-topic-title"');
  const marketIndex = index.indexOf('aria-labelledby="cross-market-title"');
  const chainIndex = index.indexOf('aria-labelledby="chain-title"');

  assert.ok(radarIndex >= 0, "首页缺少人物兴趣雷达卡片");
  assert.ok(marketIndex > radarIndex, "全球市场联动应排在人物兴趣雷达之后");
  assert.ok(chainIndex > marketIndex, "全球市场联动应位于后续链上概览模块之前");
  assert.match(
    index.slice(radarIndex - 120, marketIndex),
    /<section class="hot-topic-card section-gap"/,
    "人物兴趣雷达应使用 hot-topic-card 骨架",
  );
  assert.match(
    index.slice(marketIndex - 120, chainIndex),
    /<section class="hot-topic-card cross-market-card section-gap"/,
    "全球市场联动应复用 hot-topic-card 骨架",
  );
  assert.match(index, /\.hot-topic-card\s*\{[^}]*min-height:\s*205px/s);
  assert.match(index, /href="\.\/global-markets\.html"/);
});

test("全球市场联动页只保留返回上级入口且提供可访问的数据探索控件", async () => {
  const [html, script] = await Promise.all([
    readFile(path.join(root, "global-markets.html"), "utf8"),
    readFile(path.join(root, "global-markets.js"), "utf8"),
  ]);
  const anchors = readAnchors(html);

  assert.match(html, /data-auth-required="true"/);
  assert.match(html, /data-auth-show-logout="false"/);
  assert.equal(anchors.length, 1, "全球市场联动页不应提供跨一级页面导航");
  assert.deepEqual(anchors[0], {
    className: "page-back-link",
    href: "./index.html",
    text: "返回",
  });
  assert.doesNotMatch(html, /<nav\b|data-auth-logout|>退出</i);
  assert.match(html, /<svg[^>]+id="benchmark-chart"[^>]+role="img"[^>]+aria-labelledby="benchmark-chart-title benchmark-chart-desc"/);
  assert.match(html, /<title id="benchmark-chart-title">/);
  assert.match(html, /<desc id="benchmark-chart-desc">/);
  assert.match(html, /id="correlation-control"[^>]+aria-label="选择相关窗口"/);
  assert.match(html, /data-window="20" aria-pressed="true"/);
  assert.match(script, /create\("caption", null, `\$\{state\.correlationWindow\} 日收益率相关矩阵`\)/);
  assert.match(script, /button\.setAttribute\("aria-pressed", String\(pair\?\.id === state\.selectedPairId\)\)/);
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
  assert.match(login, /<h1><span>看清链上资金<\/span><span>流向与风险信号<\/span><\/h1>/);
  assert.doesNotMatch(login, /<h1>[^<]*<br\s*\/?>/i);
  assert.match(authCss, /\.login-brand-copy h1\s*\{[^}]*font-size:\s*clamp\(2\.4rem,\s*3\.8vw,\s*3\.25rem\)[^}]*word-break:\s*keep-all/s);
  assert.match(authCss, /\.login-brand-copy h1 span\s*\{[^}]*display:\s*block[^}]*white-space:\s*nowrap/s);
  assert.match(authCss, /@media\s*\(max-width:\s*960px\)[\s\S]*?\.login-card\s*\{[^}]*grid-template-columns:\s*1fr/s);
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

test("实时交易单位转换状态不会再挤乱三个操作按钮", async () => {
  const [liveResult, liveCss] = await Promise.all([
    readFile(path.join(root, "live-result.html"), "utf8"),
    readFile(path.join(root, "live.css"), "utf8"),
  ]);
  assert.doesNotMatch(liveResult, /monitor-unit-control/);
  assert.match(
    liveResult,
    /<div class="monitor-actions">\s*<div class="monitor-action-row">[\s\S]*?id="live-unit-toggle"[\s\S]*?id="pause-button"[\s\S]*?id="refresh-button"[\s\S]*?<\/div>\s*<span class="monitor-rate-status" id="live-unit-status"/,
  );
  assert.match(
    liveCss,
    /\.monitor-action-row\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(156px,\s*auto\)\s+72px\s+108px/s,
  );
  assert.match(liveCss, /\.monitor-rate-status\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(liveCss, /\.monitor-rate-status\s*\{[^}]*text-overflow:\s*ellipsis/s);
  assert.match(liveCss, /@media\s*\(max-width:\s*440px\)[\s\S]*?#live-unit-toggle\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
});

test("人物雷达和主题故事不再展示分析边界或结论边界模块", async () => {
  const [hotTopic, hotTopicScript, hotTopicCss, story, storyScript, storyCss] = await Promise.all([
    readFile(path.join(root, "hot-topic.html"), "utf8"),
    readFile(path.join(root, "hot-topic.js"), "utf8"),
    readFile(path.join(root, "hot-topic.css"), "utf8"),
    readFile(path.join(root, "event-explorer.html"), "utf8"),
    readFile(path.join(root, "event-explorer.js"), "utf8"),
    readFile(path.join(root, "event-explorer.css"), "utf8"),
  ]);
  for (const source of [hotTopic, hotTopicScript, hotTopicCss]) {
    assert.doesNotMatch(source, /boundary-note|boundaryCopy|结论边界/);
  }
  for (const source of [story, storyScript, storyCss]) {
    assert.doesNotMatch(source, /boundary-banner|boundaryLabel|boundaryCopy|分析边界|演示边界/);
  }
});

test("四个下级页只保留同款返回入口并回到直接上级", async () => {
  const [result, liveResult, hotTopic, storyResult, auth, authCss] = await Promise.all([
    readFile(path.join(root, "result.html"), "utf8"),
    readFile(path.join(root, "live-result.html"), "utf8"),
    readFile(path.join(root, "hot-topic.html"), "utf8"),
    readFile(path.join(root, "event-explorer.html"), "utf8"),
    readFile(path.join(root, "auth.js"), "utf8"),
    readFile(path.join(root, "auth.css"), "utf8"),
  ]);

  const cases = [
    ["result.html", result, "./track.html", false],
    ["live-result.html", liveResult, "./live.html", true],
    ["hot-topic.html", hotTopic, "./index.html", true],
    ["event-explorer.html", storyResult, "./hot-topic.html", true],
  ];
  for (const [file, html, expectedHref, exactlyOne] of cases) {
    assert.match(html, /data-auth-show-logout="false"/, `${file} 不应显示退出按钮`);
    const returnAnchors = readAnchors(html).filter((anchor) => anchor.text.includes("返回"));
    assert.ok(returnAnchors.length > 0, `${file} 缺少返回入口`);
    if (exactlyOne) {
      assert.equal(returnAnchors.length, 1, `${file} 只能保留一个返回入口`);
    }
    for (const anchor of returnAnchors) {
      assert.equal(anchor.className, "page-back-link", `${file} 返回入口样式不统一`);
      assert.equal(anchor.text, "返回", `${file} 返回文案必须精确为“返回”`);
      assert.equal(anchor.href, expectedHref, `${file} 应返回直接上级`);
    }
  }

  assert.match(auth, /dataset\.authShowLogout === "false"/);
  assert.match(
    authCss,
    /\.page-back-link\s*\{[^}]*border:\s*1px\s+solid/s,
    "四个下级页的返回入口应共用有边框的 page-back-link",
  );

  assert.doesNotMatch(hotTopic, /class="radar-(?:brand|nav)"/);
  assert.doesNotMatch(storyResult, /class="story-(?:brand|nav)"|class="breadcrumb"/);
  assert.doesNotMatch(storyResult, /返回查看其他人物或主题/);

  for (const page of ["index.html", "track.html", "live.html", "profile.html", "relation.html"]) {
    const html = await readFile(path.join(root, page), "utf8");
    assert.doesNotMatch(html, /data-auth-show-logout="false"/, page);
  }
});

test("人物雷达二三级页头只用返回导航并补充居中上下文和快照状态", async () => {
  const [hotTopic, story, hotTopicCss, storyCss, hotTopicScript, storyScript] = await Promise.all([
    readFile(path.join(root, "hot-topic.html"), "utf8"),
    readFile(path.join(root, "event-explorer.html"), "utf8"),
    readFile(path.join(root, "hot-topic.css"), "utf8"),
    readFile(path.join(root, "event-explorer.css"), "utf8"),
    readFile(path.join(root, "hot-topic.js"), "utf8"),
    readFile(path.join(root, "event-explorer.js"), "utf8"),
  ]);
  const radarHeader = hotTopic.match(/<header class="radar-header">([\s\S]*?)<\/header>/)?.[1] || "";
  const storyHeader = story.match(/<header class="story-header">([\s\S]*?)<\/header>/)?.[1] || "";
  for (const [name, header] of [["雷达二级页", radarHeader], ["故事三级页", storyHeader]]) {
    assert.equal((header.match(/<a\b/g) || []).length, 1, `${name}页头只能有返回链接`);
    assert.doesNotMatch(header, /<(?:button|select)\b/, `${name}页头中间和右侧不能成为跨级导航`);
    assert.match(header, /header-context/);
    assert.match(header, /header-status/);
  }
  assert.match(hotTopicCss, /\.radar-header\s*\{[^}]*grid-template-columns:\s*minmax\(120px,\s*1fr\)\s+minmax\(0,\s*auto\)\s+minmax\(120px,\s*1fr\)/s);
  assert.match(storyCss, /\.story-header\s*\{[^}]*grid-template-columns:minmax\(120px,1fr\) minmax\(0,auto\) minmax\(120px,1fr\)/s);
  assert.match(hotTopicScript, /当前人物 · \$\{figure\.nameZh\}/);
  assert.match(storyScript, /\$\{state\.figure\.nameZh\} · \$\{state\.theme\.name\}/);
  assert.match(hotTopicScript, /headerStatus\.textContent = "加载失败"/);
  assert.match(storyScript, /storyHeaderStatus\.textContent = "加载失败"/);
});

test("人物兴趣主题内展示事件行情且证据区移动到下方横向浏览", async () => {
  const [hotTopicScript, hotTopicCss, store, generator] = await Promise.all([
    readFile(path.join(root, "hot-topic.js"), "utf8"),
    readFile(path.join(root, "hot-topic.css"), "utf8"),
    readFile(path.join(root, "snapshot-store.js"), "utf8"),
    readFile(path.join(root, "scripts/social-radar-lib.mjs"), "utf8"),
  ]);
  assert.match(hotTopicScript, /theme\.marketImpact/);
  assert.match(hotTopicScript, /createMarketPreview/);
  assert.match(hotTopicCss, /\.interest-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(hotTopicCss, /\.proof-list\s*\{[^}]*grid-auto-flow:\s*column[^}]*overflow-x:\s*auto/s);
  assert.match(store, /normalizeSnapshot/);
  assert.match(store, /theme\.topicType === "market_impact_events"/);
  assert.match(generator, /marketImpact:/);
  assert.doesNotMatch(generator, /topicType:\s*"market_impact_events"/);
});

test("故事页返回人物兴趣雷达时保留上下文，雷达页可恢复人物和主题", async () => {
  const [hotTopicScript, storyScript] = await Promise.all([
    readFile(path.join(root, "hot-topic.js"), "utf8"),
    readFile(path.join(root, "event-explorer.js"), "utf8"),
  ]);

  const returnUrlIndex = storyScript.indexOf("./hot-topic.html");
  assert.ok(returnUrlIndex >= 0, "故事页脚本应构造人物兴趣雷达的返回 URL");
  const returnUrlBuilder = storyScript.slice(
    Math.max(0, returnUrlIndex - 400),
    returnUrlIndex + 1_600,
  );
  for (const parameter of ["figureId", "theme", "snapshot"]) {
    assert.match(
      returnUrlBuilder,
      new RegExp(`(?:searchParams\\.set\\(\\s*['\"]${parameter}['\"]|\\b${parameter}\\s*:)`),
      `故事页返回 URL 缺少 ${parameter}`,
    );
  }
  assert.match(
    storyScript,
    /(?:\.href\s*=|setAttribute\(\s*["']href["'])/,
    "故事页应把带上下文的 URL 设置到返回入口",
  );

  for (const parameter of ["figureId", "theme", "snapshot"]) {
    assert.match(
      hotTopicScript,
      new RegExp(`\\.get\\(\\s*['\"]${parameter}['\"]\\s*\\)`),
      `人物兴趣雷达应读取 ${parameter}`,
    );
  }
  assert.match(hotTopicScript, /activeFigureId\s*=/);
  assert.match(hotTopicScript, /activeThemeId\s*=/);
  assert.match(hotTopicScript, /storyId/);
});

test("地址关联页使用不会在桌面端断成两行的短标题", async () => {
  const relation = await readFile(path.join(root, "relation.html"), "utf8");
  assert.match(relation, /<title>地址关联查询<\/title>/);
  assert.match(relation, /<h1>地址关联查询<\/h1>/);
  assert.doesNotMatch(relation, />地址关联交易查询</);
});
