#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publishPathspecs = Object.freeze([
  "data/latest-snapshot.json",
  "data/snapshot-index.json",
  "data/snapshots",
  "static-site/data/latest-snapshot.json",
  "static-site/data/snapshot-index.json",
  "static-site/data/snapshots",
]);

export async function publishRadarSnapshotToGitHub(options = {}) {
  const root = await realpath(path.resolve(options.root || process.env.RADAR_WORKTREE_ROOT || scriptRoot));
  const remote = validateRemote(options.remote || process.env.RADAR_GIT_REMOTE || "origin");
  const branch = validateBranch(options.branch || process.env.RADAR_PUBLISH_BRANCH || "main");
  const authorName = validateAuthorValue(options.authorName || process.env.RADAR_GIT_AUTHOR_NAME || "onchain-radar-bot", "Git 作者名");
  const authorEmail = validateAuthorValue(
    options.authorEmail || process.env.RADAR_GIT_AUTHOR_EMAIL || "onchain-radar-bot@users.noreply.github.com",
    "Git 作者邮箱",
  );
  const log = options.log || console.log;

  await verifyPublishBase({ root, remote, branch });
  if (options.checkOnly) {
    log(JSON.stringify({ status: "ready", remote, branch }));
    return { status: "ready", remote, branch };
  }

  const snapshot = await syncPublicSnapshotTree(root);
  await git(root, ["add", "--", ...publishPathspecs]);
  const staged = splitNull((await git(root, ["diff", "--cached", "--name-only", "-z"])).stdout);
  for (const file of staged) {
    if (!isAllowedPublishPath(file)) throw new Error(`拒绝提交非公开快照文件：${file}`);
  }
  if (!staged.length) {
    log(JSON.stringify({ status: "unchanged", snapshotId: snapshot.snapshotId, remote, branch }));
    return { status: "unchanged", snapshotId: snapshot.snapshotId, remote, branch };
  }

  await git(root, [
    "-c", `user.name=${authorName}`,
    "-c", `user.email=${authorEmail}`,
    "commit", "--no-gpg-sign", "-m", `Update social radar snapshot ${snapshot.snapshotId}`,
  ]);
  const commit = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
  await git(root, ["push", remote, `HEAD:refs/heads/${branch}`]);
  log(JSON.stringify({ status: "pushed", snapshotId: snapshot.snapshotId, commit, remote, branch, files: staged.length }));
  return { status: "pushed", snapshotId: snapshot.snapshotId, commit, remote, branch, files: staged };
}

export async function verifyPublishBase({ root, remote, branch }) {
  const repositoryRoot = await realpath((await git(root, ["rev-parse", "--show-toplevel"])).stdout.trim());
  if (repositoryRoot !== root) throw new Error("RADAR_WORKTREE_ROOT 不是当前 Git 仓库根目录");
  const currentBranch = (await git(root, ["branch", "--show-current"])).stdout.trim();
  if (currentBranch !== branch) throw new Error(`当前分支是 ${currentBranch || "detached HEAD"}，发布要求分支 ${branch}`);
  const stagedCheck = await git(root, ["diff", "--cached", "--quiet"], { allowedExitCodes: [0, 1] });
  if (stagedCheck.code === 1) throw new Error("发布前已存在暂存内容，拒绝混入自动提交");

  await git(root, ["fetch", "--quiet", remote, `refs/heads/${branch}:refs/remotes/${remote}/${branch}`]);
  const head = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
  const remoteHead = (await git(root, ["rev-parse", `refs/remotes/${remote}/${branch}`])).stdout.trim();
  if (head !== remoteHead) {
    throw new Error(`本地 ${branch} 与 ${remote}/${branch} 不一致；请先停止定时器并人工更新服务器代码`);
  }
  return { head, remoteHead };
}

export async function syncPublicSnapshotTree(root) {
  const sourceData = path.join(root, "static-site/data");
  const targetData = path.join(root, "data");
  const index = await readJson(path.join(sourceData, "snapshot-index.json"));
  const latest = await readJson(path.join(sourceData, "latest-snapshot.json"));
  const entries = validateSnapshotIndex(index, latest);
  const retainedNames = new Set(entries.map((entry) => `${entry.id}.json`));

  const sourceSnapshots = path.join(sourceData, "snapshots");
  const targetSnapshots = path.join(targetData, "snapshots");
  await mkdir(targetSnapshots, { recursive: true });
  for (const entry of entries) {
    const source = path.join(sourceSnapshots, `${entry.id}.json`);
    const stat = await lstat(source);
    if (!stat.isFile()) throw new Error(`快照不是普通文件：${entry.file}`);
    await copyFileAtomic(source, path.join(targetSnapshots, `${entry.id}.json`));
  }
  await pruneUnreferencedSnapshots(sourceSnapshots, retainedNames);
  await pruneUnreferencedSnapshots(targetSnapshots, retainedNames);
  await copyFileAtomic(path.join(sourceData, "latest-snapshot.json"), path.join(targetData, "latest-snapshot.json"));
  await copyFileAtomic(path.join(sourceData, "snapshot-index.json"), path.join(targetData, "snapshot-index.json"));
  return latest;
}

export function isAllowedPublishPath(file) {
  const normalized = file.replaceAll(path.sep, "/");
  return /^(?:static-site\/)?data\/(?:latest-snapshot\.json|snapshot-index\.json|snapshots\/[A-Za-z0-9][A-Za-z0-9_-]*\.json)$/.test(normalized);
}

function validateSnapshotIndex(index, latest) {
  if (!index || typeof index !== "object" || !Array.isArray(index.snapshots) || !index.snapshots.length) {
    throw new Error("公开快照索引为空或格式错误");
  }
  if (!latest || typeof latest !== "object" || latest.status !== "published" || latest.snapshotId !== index.latest) {
    throw new Error("最新快照与索引 latest 不一致");
  }
  const seen = new Set();
  for (const entry of index.snapshots) {
    if (!entry || typeof entry !== "object" || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(entry.id || "")) {
      throw new Error("快照索引包含非法 id");
    }
    if (seen.has(entry.id)) throw new Error(`快照索引包含重复 id：${entry.id}`);
    seen.add(entry.id);
    if (entry.file !== `./data/snapshots/${entry.id}.json`) throw new Error(`快照路径不安全：${entry.file}`);
  }
  if (!seen.has(index.latest)) throw new Error("快照索引找不到 latest 条目");
  return index.snapshots;
}

async function copyFileAtomic(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await copyFile(source, temporary);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function pruneUnreferencedSnapshots(directory, retainedNames) {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    if (entry.isFile() && entry.name.endsWith(".json") && !retainedNames.has(entry.name)) {
      await rm(path.join(directory, entry.name));
    }
  }));
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function validateRemote(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) throw new Error("RADAR_GIT_REMOTE 格式非法");
  return value;
}

function validateBranch(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(value) || value.includes("..") || value.includes("//") || value.endsWith("/") || value.endsWith(".lock")) {
    throw new Error("RADAR_PUBLISH_BRANCH 格式非法");
  }
  return value;
}

function validateAuthorValue(value, label) {
  if (typeof value !== "string" || !value.trim() || /[\r\n\0]/.test(value)) throw new Error(`${label} 格式非法`);
  return value.trim();
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
      else reject(new Error(`git ${args[0]} 失败（${signal || code}）：${sanitizeGitOutput(stderr || stdout)}`));
    });
  });
}

function sanitizeGitOutput(value) {
  return value.replace(/https?:\/\/[^@\s/]+@/g, "https://***@").trim().slice(0, 2_000) || "无错误信息";
}

function parseArgs(values) {
  const result = { checkOnly: false };
  for (const value of values) {
    if (value === "--check-only") result.checkOnly = true;
    else throw new Error(`未知参数：${value}`);
  }
  return result;
}

const invokedAsCli = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedAsCli) {
  publishRadarSnapshotToGitHub(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(`GitHub 快照发布失败：${error.message}`);
    process.exitCode = 1;
  });
}
