import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { prepareBenchmark, buildBenchmarkInsights } from "../market-insights.js";

const range = { from: "2026-01-01", to: "2026-01-04" };
const asset = (name, values) => ({ id: name, shortName: name, series: values.map((value, i) => ({ date: `2026-01-0${i + 1}`, value })) });
const result = (assets, window = range) => buildBenchmarkInsights(prepareBenchmark(assets, window));
const text = (value) => JSON.stringify(value);

test("一涨一跌使用所选资产的实际收益和百分点差距", () => {
  const insights = result([asset("甲", [100, 130]), asset("乙", [100, 90])]);
  assert.match(text(insights), /甲 \+30\.0%/);
  assert.match(text(insights), /乙 -10\.0%/);
  assert.equal(insights.cards[1].title, "相差 40.0 个百分点");
  assert.doesNotMatch(text(insights), /带动|拖累|资金流入|因而/);
});

test("全涨全跌与并列不杜撰差异或把少跌写成上涨", () => {
  for (const last of [105, 95]) {
    const insights = result([asset("甲", [100, last]), asset("乙", [100, last])]);
    assert.match(insights.cards[0].title, last > 100 ? /全部收涨/ : /全部收跌/);
    assert.match(insights.cards[1].title, /表现接近/);
    assert.doesNotMatch(text(insights), /步伐不同|跌幅却不同/);
  }
  const down = result([asset("甲", [100, 90]), asset("乙", [100, 80])]);
  assert.match(down.cards[1].text, /跌得更少，不代表上涨/);
  const flat = result([asset("甲", [100, 100.01]), asset("乙", [100, 99.99])]);
  assert.match(flat.cards[0].title, /整体接近起点/);
  assert.doesNotMatch(text(flat), /-0\.0%/);
});

test("单资产收益与最大回撤分别计算，不把回撤当波动率", () => {
  const insights = result([asset("甲", [100, 150, 120])]);
  assert.match(insights.cards[0].text, /\+20\.0%/);
  assert.match(insights.cards[1].title, /最大回撤 20\.0%/);
  assert.doesNotMatch(text(insights), /波动率/);
});

test("股票与周末加密曲线使用共同首尾，不补造休市行情", () => {
  const stock = asset("股票", [100, 110]);
  const crypto = asset("加密", [100, 105, 500]);
  const prepared = prepareBenchmark([stock, crypto], range);
  assert.deepEqual(prepared.range, { from: "2026-01-01", to: "2026-01-02" });
  assert.equal(prepared.commonDates, 2);
  assert.equal(prepared.series[1].points.at(-1).value, 105);
  assert.match(text(buildBenchmarkInsights(prepared)), /股票 \+10\.0%/);
  assert.doesNotMatch(text(buildBenchmarkInsights(prepared)), /400\.0/);
});

test("空选、单点、无共同交易日都不给旧结论或伪排名", () => {
  assert.equal(result([]).cards.length, 0);
  assert.equal(result([asset("甲", [100])]).cards.length, 0);
  const partial = result([asset("有效", [100, 110]), asset("缺测", [100])]);
  assert.match(text(partial.notices), /1 项资产/);
  assert.doesNotMatch(text(partial.cards), /缺测/);
  const shifted = asset("乙", [100, 120]);
  shifted.series = shifted.series.map((point, i) => ({ ...point, date: `2026-01-0${i + 3}` }));
  const noOverlap = result([asset("甲", [100, 110]), shifted]);
  assert.equal(noOverlap.cards.length, 0);
  assert.match(text(noOverlap.notices), /暂不比较排名/);
});

test("历史窗口不受未来涨幅影响，排序去重并排除非法数据", () => {
  const source = asset("甲", [100, 110, 120, 9999]);
  source.series.reverse();
  source.series.push({ date: "2026-01-01", value: 100 }, { date: "2026-01-02", value: NaN });
  const prepared = prepareBenchmark([source], { from: "2026-01-01", to: "2026-01-03" });
  assert.equal(prepared.series[0].points.length, 3);
  assert.equal(prepared.series[0].points[0].value, 100);
  assert.match(text(buildBenchmarkInsights(prepared)), /\+20\.0%/);
  assert.doesNotMatch(text(buildBenchmarkInsights(prepared)), /NaN|Infinity|9999/);
});

test("已发布快照的全部非空资产组合及故事窗口与图线首尾一致", () => {
  const snapshot = JSON.parse(readFileSync(new URL("../data/cross-market/latest.json", import.meta.url), "utf8"));
  const windows = [30, 90, 180, 365].map((days) => {
    const to = snapshot.assets.flatMap((item) => item.series.map((point) => point.date)).sort().at(-1);
    return { from: new Date(Date.parse(`${to}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10), to };
  }).concat(snapshot.stories.map(({ from, to }) => ({ from, to })));
  for (let mask = 1; mask < 2 ** snapshot.assets.length; mask++) {
    const selected = snapshot.assets.filter((_, i) => mask & (1 << i));
    for (const window of windows) {
      const prepared = prepareBenchmark(selected, window);
      const insights = buildBenchmarkInsights(prepared);
      assert.doesNotMatch(text(insights), /NaN|Infinity|undefined/);
      for (const series of prepared.series) {
        assert.equal(series.points[0].value, 100);
        if (prepared.comparable) {
          assert.equal(series.points[0].date, prepared.range.from);
          assert.equal(series.points.at(-1).date, prepared.range.to);
        }
      }
    }
  }
});

test("页面加载新结论模块，交互重绘时先更新结论再判断空图", () => {
  const js = readFileSync(new URL("../global-markets.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../global-markets.html", import.meta.url), "utf8");
  assert.match(html, /global-markets\.js\?[^"']+" type="module"/);
  assert.match(js, /import \{ prepareBenchmark, buildBenchmarkInsights \}/);
  assert.ok(js.indexOf("renderBenchmarkReadout(prepared);") < js.indexOf('if (!allValues.length)'));
  assert.match(html, /id="chart-readout"[^>]*aria-live="polite"/);
  assert.doesNotMatch(html + js, /看谁走得更快|每条曲线均以区间第一个有效值为 100/);
});
