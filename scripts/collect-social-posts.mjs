#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await run("scripts/collect-trump-posts.mjs");
await run("scripts/collect-x-posts.mjs");
console.log("混合社交动态采集完成：特朗普来自 trump.fm，其余人物来自 X API");

function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { cwd: root, env: process.env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`${script} failed (${signal || code})`)));
  });
}
