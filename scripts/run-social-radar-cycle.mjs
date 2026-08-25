#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (!process.env.X_BEARER_TOKEN) {
  console.log(JSON.stringify({ status: "waiting", reason: "X_BEARER_TOKEN is not configured", at: new Date().toISOString() }));
  process.exit(0);
}
if (!process.env.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY is not configured");

const publishToGitHub = isEnabled(process.env.RADAR_GITHUB_PUBLISH);
if (publishToGitHub) await run("scripts/publish-radar-to-github.mjs", ["--check-only"]);
await run("scripts/collect-social-posts.mjs");
await run("scripts/refresh-market-input.mjs");
await run("scripts/generate-event-impact-candidates.mjs");
await run("scripts/refresh-event-market-input.mjs");
await run("scripts/generate-social-radar-snapshot.mjs");
if (publishToGitHub) await run("scripts/publish-radar-to-github.mjs");
console.log(JSON.stringify({ status: "published", delivery: publishToGitHub ? "github" : "local", at: new Date().toISOString() }));

function run(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: root, env: process.env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`${script} failed (${signal || code})`)));
  });
}

function isEnabled(value) {
  return /^(?:1|true|yes|on)$/i.test(String(value || "").trim());
}
