import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import { originalScripts, withoutPalette, copyFingerprint } from "../scripts/import-security-demos.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");
const manifest = JSON.parse(await read("scripts/security-source-manifest.json"));

test("安全分析入口在所有一级导航首页之后，四类卡片链接有效且发布镜像一致", async () => {
  const pages = ["index.html", "track.html", "live.html", "profile.html", "relation.html", "security.html"];
  for (const page of pages) {
    const html = await read(page);
    assert.match(html, /<a href="\.\/index\.html"[^>]*>首页<\/a>\s*<a href="\.\/security\.html"[^>]*>安全分析<\/a>/);
    assert.equal(html, await read(`static-site/${page}`));
  }
  const hub = await read("security.html");
  assert.equal((hub.match(/class="attack-card"/g) || []).length, 4);
  for (const demo of manifest.demos) assert.ok(hub.includes(`href="./${demo.file}"`));
  for (const file of ["auth.css", "security.css", "security-demo.css", ...manifest.demos.map((d) => d.file)]) {
    assert.equal(await read(file), await read(`static-site/${file}`), file);
  }
});

test("四个旧版演示保留原文及除颜色外的全部模拟脚本，详情只提供返回上级", async () => {
  for (const demo of manifest.demos) {
    const html = await read(demo.file);
    const script = originalScripts(html).join("\n");
    const digest = createHash("sha256").update(withoutPalette(script)).digest("hex");
    assert.equal(digest, demo.simulationSha256, `${demo.id} 的模拟代码被改写`);
    assert.equal(copyFingerprint(html), demo.copySha256, `${demo.id} 的文字被改写`);
    assert.equal((html.match(/<canvas\b/g) || []).length, demo.canvasCount);
    assert.match(html, /data-auth-required="true" data-auth-show-logout="false"/);
    assert.ok(html.includes(`href="./security.html#${demo.id}"`));
    assert.doesNotMatch(html, /class="tool-nav"|<iframe\b|<script[^>]+src="https?:/);
    assert.match(html, /security-demo\.css\?v=/);
    for (const handler of ["startNormal", "launchAttack", "stepForward", "togglePause", "resetDemo", "updateSpeed"]) {
      assert.ok(html.includes(`${handler}(`), `${demo.id} 缺少 ${handler}`);
    }
  }
});

test("四个模拟初始化、正常运行、单步、暂停、速度与重置保持可执行", async () => {
  for (const demo of manifest.demos) {
    const html = await read(demo.file);
    const context = createSimulationContext(html);
    vm.runInContext(originalScripts(html).join("\n"), context, { filename: demo.file, timeout: 3000 });
    vm.runInContext("startNormal(); togglePause(); stepForward(); updateSpeed('600'); resetDemo();", context, { timeout: 3000 });
    assert.equal(vm.runInContext("STATE.mode", context), "idle", demo.id);
    assert.equal(vm.runInContext("STATE.paused", context), false, demo.id);
    assert.ok(context.drawOperations > 0, `${demo.id} 未绘制画布`);
  }
});

function createSimulationContext(html) {
  const noop = () => {};
  let context;
  const drawing = new Proxy({
    measureText: (text) => ({ width: String(text).length * 7 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    setLineDash: noop,
  }, { get: (target, key) => key in target ? target[key] : () => { context.drawOperations++; } });
  const elements = new Map();
  function element(id = "") {
    const children = [];
    return { id, style: {}, dataset: {}, children, textContent: "", innerHTML: "", value: "1200", disabled: false,
      classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
      getBoundingClientRect: () => ({ width: 1000, height: 360, left: 0, top: 0 }),
      getContext: () => drawing, addEventListener: noop, setAttribute: noop,
      appendChild: (child) => { children.push(child); return child; }, removeChild: (child) => children.splice(children.indexOf(child), 1),
      prepend: (child) => children.unshift(child), insertBefore: (child) => children.unshift(child),
      remove: noop, querySelectorAll: () => [], querySelector: () => null,
      get firstChild() { return children[0] || null; }, get lastChild() { return children.at(-1) || null; },
      scrollTop: 0, scrollHeight: 100, clientHeight: 360, clientWidth: 1000,
    };
  }
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) elements.set(match[1], element(match[1]));
  const styles = { "--accent": "#4263d5", "--purple": "#7556c8", "--red": "#c2463d", "--txt": "#142024", "--txt2": "#52666d", "--txt3": "#5c6e76", "--insight-canvas-h": "205px" };
  context = vm.createContext({
    console, Math, Date, Promise, drawOperations: 0,
    document: { getElementById: (id) => elements.get(id) || null, createElement: () => element(), querySelectorAll: () => [], documentElement: element() },
    window: { devicePixelRatio: 1, innerWidth: 1440, innerHeight: 1000, addEventListener: noop },
    getComputedStyle: () => ({ getPropertyValue: (key) => styles[key] || "#ffffff" }),
    performance: { now: () => 0 }, requestAnimationFrame: () => 1, cancelAnimationFrame: noop,
    setTimeout: () => 1, clearTimeout: noop, setInterval: () => 1, clearInterval: noop,
  });
  return context;
}
