#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publishPathspecs = Object.freeze([
  "data/cross-market/latest.json",
  "static-site/data/cross-market/latest.json",
]);

export async function publishCrossMarketSnapshot(options = {}) {
  const root = await realpath(path.resolve(options.root || process.env.CROSS_MARKET_WORKTREE_ROOT || scriptRoot));
  const remote = validateRemote(options.remote || process.env.CROSS_MARKET_GIT_REMOTE || "origin");
  const branch = validateBranch(options.branch || process.env.CROSS_MARKET_PUBLISH_BRANCH || "main");
  const log = options.log || console.log;
  await verifyPublishBase({ root, remote, branch });
  const snapshot = await validatePublicFiles(root);
  if (options.checkOnly) {
    log(JSON.stringify({ status: "ready", snapshotId: snapshot.snapshotId, remote, branch }));
    return { status: "ready", snapshotId: snapshot.snapshotId, remote, branch };
  }

  await git(root, ["add", "--", ...publishPathspecs]);
  const staged = splitNull((await git(root, ["diff", "--cached", "--name-only", "-z"])).stdout);
  for (const file of staged) if (!isAllowedCrossMarketPublishPath(file)) throw new Error(`拒绝提交非公开跨市场文件：${file}`);
  if (!staged.length) {
    log(JSON.stringify({ status: "unchanged", snapshotId: snapshot.snapshotId, remote, branch }));
    return { status: "unchanged", snapshotId: snapshot.snapshotId, remote, branch };
  }

  await git(root, [
    "-c", "user.name=global-market-bot",
    "-c", "user.email=global-market-bot@users.noreply.github.com",
    "commit", "--no-gpg-sign", "-m", `Update global market snapshot ${snapshot.snapshotId}`,
  ]);
  const commit = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
  await git(root, ["push", remote, `HEAD:refs/heads/${branch}`]);
  log(JSON.stringify({ status: "pushed", snapshotId: snapshot.snapshotId, commit, files: staged.length }));
  return { status: "pushed", snapshotId: snapshot.snapshotId, commit, files: staged };
}

export function isAllowedCrossMarketPublishPath(file) {
  return /^(?:static-site\/)?data\/cross-market\/latest\.json$/.test(String(file).replaceAll(path.sep, "/"));
}

async function validatePublicFiles(root) {
  const rootContent = await readFile(path.join(root, publishPathspecs[0]), "utf8");
  const staticContent = await readFile(path.join(root, publishPathspecs[1]), "utf8");
  if (rootContent !== staticContent) throw new Error("跨市场快照的根目录与 static-site 镜像不一致");
  const snapshot = JSON.parse(rootContent);
  if (snapshot?.schemaVersion !== 1 || snapshot?.status !== "published" || !/^\d{8}T\d{6}Z$/.test(snapshot?.snapshotId || "")) throw new Error("跨市场公开快照格式错误");
  if (!Array.isArray(snapshot.assets) || snapshot.assets.length !== 8) throw new Error("跨市场公开快照资产不完整");
  if (/api_token|api[_-]?key|authorization|bearer/i.test(rootContent)) throw new Error("跨市场公开快照疑似包含鉴权信息");
  if (/"(?:open|close)"\s*:/.test(rootContent)) throw new Error("跨市场公开快照不能发布供应商原始价字段");
  return snapshot;
}

async function verifyPublishBase({ root, remote, branch }) {
  const repositoryRoot = await realpath((await git(root, ["rev-parse", "--show-toplevel"])).stdout.trim());
  if (repositoryRoot !== root) throw new Error("CROSS_MARKET_WORKTREE_ROOT 不是当前 Git 仓库根目录");
  const currentBranch = (await git(root, ["branch", "--show-current"])).stdout.trim();
  if (currentBranch !== branch) throw new Error(`当前分支是 ${currentBranch || "detached HEAD"}，发布要求分支 ${branch}`);
  const staged = await git(root, ["diff", "--cached", "--quiet"], { allowedExitCodes: [0, 1] });
  if (staged.code === 1) throw new Error("发布前已存在暂存内容，拒绝混入自动提交");
  await git(root, ["fetch", "--quiet", remote, `refs/heads/${branch}:refs/remotes/${remote}/${branch}`]);
  const head = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
  const remoteHead = (await git(root, ["rev-parse", `refs/remotes/${remote}/${branch}`])).stdout.trim();
  if (head !== remoteHead) throw new Error(`本地 ${branch} 与 ${remote}/${branch} 不一致；请等待下一次定时任务或人工重试`);
}

function validateRemote(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) throw new Error("CROSS_MARKET_GIT_REMOTE 格式非法");
  return value;
}

function validateBranch(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(value) || value.includes("..") || value.includes("//") || value.endsWith("/") || value.endsWith(".lock")) throw new Error("CROSS_MARKET_PUBLISH_BRANCH 格式非法");
  return value;
}

function splitNull(value) {
  return value.split("\0").filter(Boolean);
}

function git(root, args, { allowedExitCodes = [0] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (allowedExitCodes.includes(code)) resolve({ code, stdout, stderr });
      else reject(new Error(`git ${args[0]} 失败（${signal || code}）：${sanitize(stderr || stdout)}`));
    });
  });
}

function sanitize(value) {
  return String(value || "").replace(/https?:\/\/[^@\s/]+@/g, "https://***@").replace(/api_token=[^&\s]+/gi, "api_token=***").trim().slice(0, 2_000) || "无错误信息";
}

const invokedAsCli = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedAsCli) {
  const checkOnly = process.argv.slice(2).includes("--check-only");
  publishCrossMarketSnapshot({ checkOnly }).catch((error) => {
    console.error(`全球市场快照发布失败：${error.message}`);
    process.exitCode = 1;
  });
}
