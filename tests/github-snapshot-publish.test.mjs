import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isAllowedPublishPath, publishRadarSnapshotToGitHub } from "../scripts/publish-radar-to-github.mjs";

test("GitHub 发布只提交公开快照并保留原始社交输入在服务器", async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "radar-github-publish-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const remote = path.join(temporary, "remote.git");
  const worktree = path.join(temporary, "worktree");
  git(temporary, ["init", "--bare", "--initial-branch=main", remote]);
  git(temporary, ["init", "--initial-branch=main", worktree]);
  git(worktree, ["config", "user.name", "test"]);
  git(worktree, ["config", "user.email", "test@example.com"]);

  await writeSnapshotSet(worktree, "old-slot", ["old-slot"]);
  await mkdir(path.join(worktree, "data/social-input"), { recursive: true });
  await writeFile(path.join(worktree, "data/social-input/latest.json"), "{\"mode\":\"seed\"}\n");
  git(worktree, ["add", "-A"]);
  git(worktree, ["commit", "-m", "seed"]);
  git(worktree, ["remote", "add", "origin", remote]);
  git(worktree, ["push", "-u", "origin", "main"]);

  await writeSnapshotSet(worktree, "new-slot", ["new-slot"]);
  await writeFile(path.join(worktree, "data/social-input/latest.json"), "{\"mode\":\"real-runtime-input\"}\n");
  const result = await publishRadarSnapshotToGitHub({
    root: worktree,
    remote: "origin",
    branch: "main",
    authorName: "radar-test",
    authorEmail: "radar-test@users.noreply.github.com",
    log: () => {},
  });

  assert.equal(result.status, "pushed");
  assert.equal(result.snapshotId, "new-slot");
  assert.ok(result.files.every(isAllowedPublishPath));
  assert.equal(await readFile(path.join(worktree, "data/latest-snapshot.json"), "utf8"), await readFile(path.join(worktree, "static-site/data/latest-snapshot.json"), "utf8"));
  assert.equal(await readFile(path.join(worktree, "data/snapshot-index.json"), "utf8"), await readFile(path.join(worktree, "static-site/data/snapshot-index.json"), "utf8"));
  assert.equal(git(worktree, ["status", "--short"]).stdout.trim(), "M data/social-input/latest.json");

  const changed = git(remote, ["diff-tree", "--no-commit-id", "--name-only", "-r", "main"]).stdout.trim().split("\n");
  assert.ok(changed.length > 0);
  assert.ok(changed.every(isAllowedPublishPath));
  assert.ok(!changed.includes("data/social-input/latest.json"));
});

test("发布路径白名单拒绝状态、密钥和原始输入", () => {
  assert.equal(isAllowedPublishPath("data/latest-snapshot.json"), true);
  assert.equal(isAllowedPublishPath("static-site/data/snapshots/20260815T120000Z.json"), true);
  assert.equal(isAllowedPublishPath("data/social-input/latest.json"), false);
  assert.equal(isAllowedPublishPath("data/social-input/x-state.json"), false);
  assert.equal(isAllowedPublishPath(".env"), false);
  assert.equal(isAllowedPublishPath("static-site/data/snapshots/../secret.json"), false);
});

test("远程 main 有新提交时在复制快照前安全停止", async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "radar-github-stale-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const remote = path.join(temporary, "remote.git");
  const worktree = path.join(temporary, "worktree");
  const updater = path.join(temporary, "updater");
  git(temporary, ["init", "--bare", "--initial-branch=main", remote]);
  git(temporary, ["init", "--initial-branch=main", worktree]);
  git(worktree, ["config", "user.name", "test"]);
  git(worktree, ["config", "user.email", "test@example.com"]);
  await writeSnapshotSet(worktree, "old-slot", ["old-slot"]);
  git(worktree, ["add", "-A"]);
  git(worktree, ["commit", "-m", "seed"]);
  git(worktree, ["remote", "add", "origin", remote]);
  git(worktree, ["push", "-u", "origin", "main"]);

  git(temporary, ["clone", remote, updater]);
  git(updater, ["config", "user.name", "updater"]);
  git(updater, ["config", "user.email", "updater@example.com"]);
  await writeFile(path.join(updater, "README.md"), "remote update\n");
  git(updater, ["add", "README.md"]);
  git(updater, ["commit", "-m", "remote update"]);
  git(updater, ["push", "origin", "main"]);

  await writeSnapshotSet(worktree, "new-slot", ["new-slot"]);
  await assert.rejects(
    publishRadarSnapshotToGitHub({ root: worktree, remote: "origin", branch: "main", log: () => {} }),
    /本地 main 与 origin\/main 不一致/,
  );
  const published = JSON.parse(await readFile(path.join(worktree, "data/latest-snapshot.json"), "utf8"));
  assert.equal(published.snapshotId, "old-slot");
});

async function writeSnapshotSet(root, latestId, ids) {
  const staticData = path.join(root, "static-site/data");
  const rootData = path.join(root, "data");
  await mkdir(path.join(staticData, "snapshots"), { recursive: true });
  await mkdir(path.join(rootData, "snapshots"), { recursive: true });
  const latest = { status: "published", snapshotId: latestId, figures: [{ id: "figure" }] };
  const index = {
    schemaVersion: 1,
    latest: latestId,
    snapshots: ids.map((id) => ({ id, file: `./data/snapshots/${id}.json`, status: "published" })),
  };
  await writeJson(path.join(staticData, "latest-snapshot.json"), latest);
  await writeJson(path.join(staticData, "snapshot-index.json"), index);
  for (const id of ids) await writeJson(path.join(staticData, `snapshots/${id}.json`), { ...latest, snapshotId: id });
  if (latestId === "old-slot") {
    await writeJson(path.join(rootData, "latest-snapshot.json"), latest);
    await writeJson(path.join(rootData, "snapshot-index.json"), index);
    for (const id of ids) await writeJson(path.join(rootData, `snapshots/${id}.json`), { ...latest, snapshotId: id });
  }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function git(cwd, args) {
  const command = cwd.endsWith(".git") ? ["--git-dir", cwd, ...args] : ["-C", cwd, ...args];
  const result = spawnSync("git", command, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}
