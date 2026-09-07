#!/usr/bin/env node
// Import the four pinned legacy demonstrations. Only presentation and navigation
// are adapted; the original simulation code and scientific copy are preserved.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const demos = [
  { id: "eth-liveness", name: "以太坊共识活性攻击", network: "Ethereum", canvasCount: 3 },
  { id: "eth-staircase", name: "以太坊激励机制攻击", network: "Ethereum", canvasCount: 2 },
  { id: "bsc-finality", name: "币安链共识活性攻击", network: "BNB Smart Chain", canvasCount: 1 },
  { id: "polkadot-selfish", name: "波卡链自私挖矿攻击", network: "Polkadot", canvasCount: 2 },
];
const sourceCommit = "aa7e9850a0c733b7c37b0281e5978e7bbb8e9549";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hex = {
  "#0a0e17": "#f3f6f7", "#111827": "#edf2f3", "#141c2b": "#ffffff", "#1a2338": "#f0f5f5",
  "#e2e8f0": "#142024", "#94a3b8": "#52666d", "#64748b": "#5c6e76",
  "#60a5fa": "#4263d5", "#93c5fd": "#3556b0", "#bfdbfe": "#075d5b",
  "#34d399": "#25845e", "#86efac": "#278548", "#f87171": "#c2463d",
  "#fca5a5": "#b74646", "#fecaca": "#a53232", "#fbbf24": "#ae730e",
  "#a78bfa": "#7556c8", "#f472b6": "#b33f78",
};
const rgb = {
  "10,14,23": "255,255,255", "96,165,250": "66,99,213", "147,197,253": "53,86,176",
  "99,179,237": "100,125,140", "148,163,184": "82,102,109", "100,116,139": "92,110,118",
  "248,113,113": "194,70,61", "252,165,165": "183,70,70", "52,211,153": "37,132,94",
  "134,239,172": "39,133,72", "251,191,36": "174,115,14", "252,211,77": "155,101,12",
  "167,139,250": "117,86,200", "226,232,240": "20,32,36", "209,250,229": "25,100,66",
  "254,202,202": "165,50,50",
};

export function lightPalette(source) {
  // Replace RGB prefixes only: dynamic animation alpha expressions stay intact.
  return source.replace(/#[0-9a-f]{3,8}\b/gi, (value) => hex[value.toLowerCase()] || value)
    .replace(/(rgba?\()\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(\s*[,\)])/g,
      (value, prefix, r, g, b, suffix) => rgb[`${r},${g},${b}`] ? `${prefix}${rgb[`${r},${g},${b}`]}${suffix}` : value);
}

export function originalScripts(html) {
  return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1]).filter((script) => script.trim());
}

export function withoutPalette(source) {
  return source.replace(/#[0-9a-f]{3,8}\b/gi, "#COLOR")
    .replace(/(rgba?\()\s*\d+\s*,\s*\d+\s*,\s*\d+(\s*[,\)])/g, "$1COLOR$2");
}

export function copyFingerprint(html) {
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || "";
  const originalBody = body.replace(/<!-- security-shell-start -->[\s\S]*?<!-- security-shell-end -->/, "");
  return sha(originalBody.replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

export function adaptDemo(source, demo) {
  const isBsc = demo.id === "bsc-finality";
  const styleVersion = isBsc ? "20260907-bsc-layout" : "20260907-security";
  const header = `<!-- security-shell-start -->
<header class="security-demo-header">
  <a class="page-back-link" href="./security.html#${demo.id}" aria-label="返回安全分析">返回</a>
  <div class="security-demo-context"><strong>${demo.name}</strong><span>区块链安全分析</span></div>
  <span class="security-demo-network">${demo.network}<span class="security-demo-dot" aria-hidden="true"></span></span>
</header>
<!-- security-shell-end -->`;
  const output = lightPalette(source).replace(/^\uFEFF/, "")
    .replace('<html lang="zh-CN">', '<html lang="zh-CN" data-auth-required="true" data-auth-show-logout="false">')
    .replace(/<link[^>]+href="https:\/\/fonts\.googleapis\.com[^>]+>\s*/g, "")
    .replace("</head>", `<link rel="stylesheet" href="./auth.css?v=20260907-security">\n<link rel="stylesheet" href="./security-demo.css?v=${styleVersion}">\n<script src="./auth.js?v=20260830-ui-fix"></script>\n</head>`)
    .replace("<body>", `<body class="security-demo-page${isBsc ? " security-demo-bsc" : ""}">\n${header}`)
    .replace(/^[\t ]+$/gm, "");
  if (sha(withoutPalette(originalScripts(source).join("\n"))) !== sha(withoutPalette(originalScripts(output).join("\n")))) {
    throw new Error(`${demo.id}: simulation changed beyond its color palette`);
  }
  if (copyFingerprint(source) !== copyFingerprint(output)) throw new Error(`${demo.id}: original content changed`);
  return output;
}

function sha(value) { return createHash("sha256").update(value).digest("hex"); }

async function main() {
  const sourceDirectory = process.argv[2];
  if (!sourceDirectory) throw new Error("Usage: node scripts/import-security-demos.mjs <legacy-source-directory>");
  const revision = execFileSync("git", ["-C", sourceDirectory, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (revision !== sourceCommit) throw new Error(`Expected pinned source commit ${sourceCommit}`);
  execFileSync("git", ["-C", sourceDirectory, "diff", "--exit-code", "HEAD", "--", ...demos.map((demo) => `${demo.id}.html`)], { stdio: "pipe" });
  const manifest = { repository: "https://github.com/tsinghua-cel/platform", commit: sourceCommit, demos: [] };
  for (const demo of demos) {
    const source = await readFile(path.join(sourceDirectory, `${demo.id}.html`), "utf8");
    const output = adaptDemo(source, demo);
    const file = `security-${demo.id}.html`;
    await writeFile(path.join(root, file), output);
    await writeFile(path.join(root, "static-site", file), output);
    manifest.demos.push({ ...demo, file, sourceSha256: sha(source), copySha256: copyFingerprint(source), simulationSha256: sha(withoutPalette(originalScripts(source).join("\n"))) });
  }
  await writeFile(path.join(root, "scripts/security-source-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Imported ${manifest.demos.length} demonstrations; original copy and simulation verified.`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
