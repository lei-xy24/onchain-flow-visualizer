#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEventImpactPrompt, enrichEventImpactCandidates, prepareEventImpactInput, validateEventImpactCandidates } from "./event-impact-lib.mjs";
import { readJson, requireHttpsBaseUrl, writeJsonAtomic } from "./social-radar-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = await readJson(path.join(root, "social-radar.config.json"));
const socialFile = resolveFile(process.env.SOCIAL_INPUT_FILE || config.sourceFile);
const outputFile = resolveFile(process.env.EVENT_CANDIDATE_FILE || config.eventCandidateFile);
const rawSocialInput = await readJson(socialFile);
const socialInput = prepareEventImpactInput(rawSocialInput, {
  maxSourcesPerFigure: Number(config.maxEventSourcesPerFigure || 40),
  analysisWindowHours: Number(config.analysisWindowHours || 168),
});
if (!socialInput.figures.length) throw new Error("没有可用于事件影响判断的公开动态");

let candidate = await generateCandidates(socialInput);
let errors = validateEventImpactCandidates(candidate, socialInput, { maxEventsPerFigure: Number(config.maxImpactEventsPerFigure || 5) });
if (errors.length) {
  console.warn(`DeepSeek 事件候选首次未通过校验，正在自动修复一次：${errors.join("；")}`);
  candidate = await generateCandidates(socialInput, errors);
  errors = validateEventImpactCandidates(candidate, socialInput, { maxEventsPerFigure: Number(config.maxImpactEventsPerFigure || 5) });
}
if (errors.length) throw new Error(`事件候选未发布：${errors.join("；")}`);

const output = enrichEventImpactCandidates(candidate, socialInput);
await writeJsonAtomic(outputFile, output);
console.log(`事件影响候选已写入 ${path.relative(root, outputFile)}：${output.events.length} 条；此阶段未读取任何行情数据`);

async function generateCandidates(input, validationErrors = []) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("缺少 DEEPSEEK_API_KEY");
  const baseUrl = requireHttpsBaseUrl(process.env.DEEPSEEK_BASE_URL || config.apiBaseUrl || "https://api.deepseek.com", "DeepSeek API 地址");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(120_000),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || config.model,
      messages: [
        { role: "system", content: "你是事件研究编辑。必须只返回一个 JSON 对象，不要 Markdown，不得虚构来源、资产或行情。" },
        { role: "user", content: JSON.stringify(buildEventImpactPrompt(input, validationErrors)) },
      ],
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      temperature: 0.1,
      max_tokens: 8_000,
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`DeepSeek API ${response.status}：${payload.error?.message || "请求失败"}`);
  if (payload.choices?.[0]?.finish_reason === "length") throw new Error("DeepSeek 事件候选达到长度上限");
  const text = payload.choices?.[0]?.message?.content;
  if (!text?.trim()) throw new Error("DeepSeek 返回了空事件候选");
  try { return JSON.parse(text); } catch (error) { throw new Error(`DeepSeek 事件候选 JSON 无法解析：${error.message}`); }
}

function resolveFile(value) { return path.isAbsolute(value) ? value : path.join(root, value); }
