import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("前端统一从运行时配置读取外部后端地址", async () => {
  const [runtimeConfig, index, result, live, flowData, packageJson] = await Promise.all([
    readFile(path.join(root, "static-site/runtime-config.js"), "utf8"),
    readFile(path.join(root, "static-site/index.html"), "utf8"),
    readFile(path.join(root, "static-site/result.html"), "utf8"),
    readFile(path.join(root, "static-site/live-result.js"), "utf8"),
    readFile(path.join(root, "static-site/flow-demo-data.js"), "utf8"),
    readFile(path.join(root, "package.json"), "utf8"),
  ]);
  assert.match(runtimeConfig, /overview:\s*""/);
  assert.match(runtimeConfig, /flow:\s*""/);
  assert.match(runtimeConfig, /liveTransfers:\s*""/);
  assert.match(index, /ONCHAIN_API_CONFIG\?\.overview/);
  assert.match(result, /ONCHAIN_API_CONFIG\?\.flow/);
  assert.match(live, /ONCHAIN_API_CONFIG\?\.liveTransfers/);
  assert.match(flowData, /ONCHAIN_API_CONFIG\?\.flow/);
  assert.doesNotMatch([index, result, live, flowData].join("\n"), /(?:BACKEND|FLOW)_API_URL\s*=\s*"\/api\//);
  assert.equal(Object.hasOwn(JSON.parse(packageJson).scripts, "api:start"), false);
});

test("静态站点不包含常见密钥或服务器密码格式", async () => {
  const files = await listFiles(path.join(root, "static-site"));
  for (const file of files.filter((item) => /\.(?:html|js|json|css)$/i.test(item))) {
    const content = await readFile(file, "utf8");
    assert.doesNotMatch(content, /(?:DEEPSEEK|ETHERSCAN|X_BEARER)_API_KEY\s*=/i, path.relative(root, file));
    assert.doesNotMatch(content, /\bsk-[a-z0-9]{20,}\b/i, path.relative(root, file));
  }
});

test("GitHub 上传候选文件不包含真实凭证且本地状态被忽略", async () => {
  const listed = spawnSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(listed.status, 0, listed.stderr);
  const files = listed.stdout.split("\0").filter(Boolean);
  const secretPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
    /\bsk-[a-z0-9_-]{20,}\b/i,
    /\b(?:ghp|gho|ghu|ghs|ghr)_[a-z0-9]{20,}\b/i,
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
    /\bBearer\s+[a-z0-9._~+/=-]{20,}\b/i,
    /\b(?:root|ubuntu|ec2-user)@[a-z0-9.-]+\b/i,
  ];
  for (const relativeFile of files) {
    let content;
    try { content = await readFile(path.join(root, relativeFile), "utf8"); } catch { continue; }
    for (const pattern of secretPatterns) assert.doesNotMatch(content, pattern, relativeFile);
  }

  for (const relativeFile of [
    ".env",
    "data/social-input/x-state.json",
    "data/social-input/trump-fm-state.json",
    "sample.pem",
    "sample.key",
    "credentials.json",
    "server.log",
  ]) {
    const ignored = spawnSync("git", ["check-ignore", "-q", relativeFile], { cwd: root });
    assert.equal(ignored.status, 0, `${relativeFile} 应被 .gitignore 排除`);
  }
});

test("GitHub Actions 每周一生成快照且只通过 Secrets 注入密钥", async () => {
  const workflow = await readFile(path.join(root, ".github/workflows/social-radar-snapshot.yml"), "utf8");
  const config = JSON.parse(await readFile(path.join(root, "social-radar.config.json"), "utf8"));
  assert.match(workflow, /cron:\s*["']0 0 \* \* 1["']/);
  assert.match(workflow, /DEEPSEEK_API_KEY:\s*\$\{\{\s*secrets\.DEEPSEEK_API_KEY\s*\}\}/);
  assert.match(workflow, /X_BEARER_TOKEN:\s*\$\{\{\s*secrets\.X_BEARER_TOKEN\s*\}\}/);
  assert.match(workflow, /run:\s*node scripts\/publish-radar-to-github\.mjs/);
  assert.doesNotMatch(workflow, /git add data\/market-input\/latest\.json/);
  assert.doesNotMatch(workflow, /SERVER_(?:HOST|USER|PASSWORD)|SSH_PRIVATE_KEY/);
  assert.equal(config.schedule, "0 0 * * 1");
  assert.equal(config.publishIntervalHours, 168);
  assert.equal(config.model, "deepseek-v4-pro");
});

test("静态页面引用的本地文件都存在", async () => {
  const htmlFiles = (await readdir(path.join(root, "static-site"))).filter((file) => file.endsWith(".html"));
  for (const htmlFile of htmlFiles) {
    const content = await readFile(path.join(root, "static-site", htmlFile), "utf8");
    const references = [...content.matchAll(/(?:src|href)=["'](\.\/[^"'#?]+)/g)].map((match) => match[1]);
    for (const reference of references) {
      await assert.doesNotReject(
        access(path.resolve(root, "static-site", reference)),
        `${htmlFile} 引用了不存在的 ${reference}`,
      );
    }
  }
});

test("人物采集边界是特朗普走 trump.fm、另外三人走 X", async () => {
  const input = JSON.parse(await readFile(path.join(root, "data/social-input/latest.json"), "utf8"));
  const trump = input.figures.find((figure) => figure.id === "donald-trump");
  const others = input.figures.filter((figure) => figure.id !== "donald-trump");
  assert.deepEqual(trump.accounts.map((account) => [account.platform, account.provider]), [["Truth Social", "trump.fm"]]);
  assert.ok(trump.sources.every((source) => source.platform === "Truth Social"));
  assert.ok(others.every((figure) => figure.accounts.some((account) => account.platform === "X")));
});

test("没有 X Token 时每周任务安全跳过且不覆盖快照", () => {
  const result = spawnSync(process.execPath, ["scripts/run-social-radar-cycle.mjs"], {
    cwd: root,
    env: { PATH: process.env.PATH || "" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /X_BEARER_TOKEN is not configured/);
});

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(target) : [target];
  }));
  return nested.flat();
}
