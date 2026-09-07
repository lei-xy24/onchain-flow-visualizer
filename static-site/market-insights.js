// Local, deterministic observations from the same points used by the chart.
// No model, price-provider request, forward filling, or causal attribution.
const FLAT = 0.05;

export function prepareBenchmark(assets, range) {
  const usable = assets.map((asset) => {
    const byDate = new Map();
    for (const point of asset.series || []) {
      const value = Number(point.value);
      if (/^\d{4}-\d{2}-\d{2}$/.test(point.date || "") && point.date >= range.from && point.date <= range.to && Number.isFinite(value) && value > 0) {
        byDate.set(point.date, { date: point.date, value });
      }
    }
    return { asset, points: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) };
  }).filter((item) => item.points.length >= 2);
  const excluded = assets.length - usable.length;
  if (!usable.length) return { series: [], range, comparable: false, excluded, commonDates: 0 };
  const dateSets = usable.map((item) => new Set(item.points.map((point) => point.date)));
  const common = usable[0].points.map((point) => point.date).filter((date) => dateSets.every((set) => set.has(date)));
  const comparable = common.length >= 2;
  const alignedRange = comparable ? { from: common[0], to: common.at(-1) } : range;
  const series = usable.map(({ asset, points }) => {
    const selected = points.filter((point) => point.date >= alignedRange.from && point.date <= alignedRange.to);
    const base = selected[0].value;
    return { asset, points: selected.map((point) => ({ date: point.date, value: point.value / base * 100 })) };
  });
  return { series, range: alignedRange, comparable, excluded, commonDates: common.length };
}

function statistics({ asset, points }) {
  let peak = points[0].value;
  let drawdown = 0;
  for (const point of points) {
    peak = Math.max(peak, point.value);
    drawdown = Math.max(drawdown, (peak - point.value) / peak * 100);
  }
  return { name: asset.shortName || asset.name || asset.id, change: (points.at(-1).value / points[0].value - 1) * 100, drawdown };
}

function signed(value) {
  const rounded = Math.abs(value) < FLAT ? 0 : value;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`;
}

export function buildBenchmarkInsights(prepared) {
  const { series, comparable, excluded } = prepared;
  const notices = excluded ? [`${excluded} 项资产在这个区间的数据不足，未纳入比较。`] : [];
  if (!series.length) return { cards: [], notices: ["当前区间没有足够行情，请换一个时间范围或选择其他资产。"] };
  if (!comparable) return { cards: [], notices: [...notices, "所选资产没有至少两个共同交易日期，暂不比较排名与涨跌差距。"] };
  const stats = series.map(statistics).sort((a, b) => b.change - a.change);
  const best = stats[0];
  const last = stats.at(-1);
  const worstPath = [...stats].sort((a, b) => b.drawdown - a.drawdown)[0];
  const up = stats.filter((item) => item.change >= FLAT).length;
  const down = stats.filter((item) => item.change <= -FLAT).length;
  const spread = best.change - last.change;
  const cards = [];
  if (stats.length === 1) {
    cards.push({ label: "区间表现", title: `${best.name}${up ? "收涨" : down ? "收跌" : "基本走平"}`, text: `从本段起点到终点，累计变化 ${signed(best.change)}。` });
  } else {
    const title = !up && !down ? "这段时间，整体接近起点" : up && down ? "同一段时间，涨跌分成两边" : up === stats.length ? "所选资产全部收涨" : down === stats.length ? "所选资产全部收跌" : up ? "部分上涨，其余接近持平" : "部分回落，其余接近持平";
    const text = !up && !down ? `${stats.length} 项资产的区间变化均小于 0.05%。` : `${best.name} ${signed(best.change)}，${last.name} ${signed(last.change)}；所选 ${stats.length} 项资产中，${up} 项上涨、${down} 项下跌。`;
    cards.push({ label: "整体表现", title, text });
    cards.push({ label: "首尾差距", title: spread < 0.1 ? "表现接近，暂未拉开差距" : `相差 ${spread.toFixed(1)} 个百分点`, text: spread < 0.1 ? "最高与最低区间收益的差距不足 0.1 个百分点，不强行划分赢家。" : `${best.name}的区间收益高于${last.name}。${down === stats.length ? "这里的领先是跌得更少，不代表上涨。" : "这比较的是累计表现，不代表每日同步涨跌。"}` });
  }
  cards.push({ label: "过程回撤", title: worstPath.drawdown < FLAT ? "可见收盘点基本没有回撤" : `${worstPath.name}最大回撤 ${worstPath.drawdown.toFixed(1)}%`, text: worstPath.drawdown < FLAT ? "这段收盘曲线没有明显从高点回落；盘中波动不在此统计内。" : `从本段此前高点一度回落 ${worstPath.drawdown.toFixed(1)}%，最终累计变化 ${signed(worstPath.change)}。回撤按可见收盘点计算。` });
  return { cards, notices };
}
