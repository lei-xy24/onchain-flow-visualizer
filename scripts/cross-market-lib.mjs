const DAY_MS = 86_400_000;

export const CROSS_MARKET_ASSETS = Object.freeze([
  { id: "csi300", name: "沪深 300", shortName: "沪深300", region: "china", kind: "equity", symbol: "000300.SHG", currency: "CNY", color: "#ef6a67", demoStart: 3_850 },
  { id: "sse", name: "上证综指", shortName: "上证综指", region: "china", kind: "equity", symbol: "000001.SHG", currency: "CNY", color: "#d94452", demoStart: 3_420 },
  { id: "stoxx50", name: "EURO STOXX 50", shortName: "欧股50", region: "europe", kind: "equity", symbol: "STOXX50E.INDX", currency: "EUR", color: "#5f82e6", demoStart: 5_250 },
  { id: "dax", name: "德国 DAX", shortName: "DAX", region: "europe", kind: "equity", symbol: "GDAXI.INDX", currency: "EUR", color: "#3d62c8", demoStart: 18_500 },
  { id: "sp500", name: "S&P 500", shortName: "标普500", region: "us", kind: "equity", symbol: "GSPC.INDX", currency: "USD", color: "#27a77a", demoStart: 5_350 },
  { id: "nasdaq100", name: "Nasdaq 100", shortName: "纳指100", region: "us", kind: "equity", symbol: "NDX.INDX", currency: "USD", color: "#0f8f6d", demoStart: 19_100 },
  { id: "bitcoin", name: "Bitcoin", shortName: "BTC", region: "crypto", kind: "crypto", symbol: "bitcoin", currency: "USD", color: "#f2a23a", demoStart: 68_000 },
  { id: "ethereum", name: "Ethereum", shortName: "ETH", region: "crypto", kind: "crypto", symbol: "ethereum", currency: "USD", color: "#9c79e4", demoStart: 3_650 },
]);

export const CROSS_MARKET_REGIONS = Object.freeze([
  { id: "china", name: "A 股", session: "亚洲交易时段", order: 1 },
  { id: "europe", name: "欧洲股市", session: "欧洲交易时段", order: 2 },
  { id: "us", name: "美股", session: "北美交易时段", order: 3 },
  { id: "crypto", name: "加密货币", session: "24 小时连续交易", order: 4 },
]);

export function buildDemoCrossMarketInput(options = {}) {
  const generatedAt = normalizeIso(options.generatedAt || new Date().toISOString());
  const end = new Date(generatedAt);
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end.getTime() - 365 * DAY_MS);
  const states = new Map(CROSS_MARKET_ASSETS.map((asset) => [asset.id, asset.demoStart]));
  const series = new Map(CROSS_MARKET_ASSETS.map((asset) => [asset.id, []]));

  for (let offset = 0, cursor = new Date(start); cursor <= end; offset += 1, cursor = new Date(cursor.getTime() + DAY_MS)) {
    const date = cursor.toISOString().slice(0, 10);
    const weekday = cursor.getUTCDay();
    const isWeekend = weekday === 0 || weekday === 6;
    const common = 0.00045 + Math.sin(offset / 15) * 0.0017 + demoShock(offset);
    const chinaFactor = Math.sin((offset + 5) / 11) * 0.0018 + (offset > 248 && offset < 278 ? -0.003 : 0);
    const europeFactor = Math.cos((offset + 2) / 18) * 0.0014;
    const usFactor = Math.sin((offset + 8) / 20) * 0.0013 + (offset > 300 && offset < 324 ? 0.0023 : 0);
    const cryptoFactor = Math.cos(offset / 8) * 0.0042 + (offset > 300 && offset < 324 ? -0.006 : 0);

    CROSS_MARKET_ASSETS.forEach((asset, assetIndex) => {
      if (asset.kind === "equity" && isWeekend) return;
      const regionFactor = asset.region === "china" ? chinaFactor : asset.region === "europe" ? europeFactor : asset.region === "us" ? usFactor : cryptoFactor;
      const beta = asset.kind === "crypto" ? (asset.id === "bitcoin" ? 1.75 : 2.15) : asset.id === "nasdaq100" ? 1.22 : 0.9 + assetIndex * 0.025;
      const noiseScale = asset.kind === "crypto" ? 0.0105 : 0.0036;
      const noise = deterministicNoise(offset, assetIndex + 1) * noiseScale;
      const dailyReturn = clamp(common * beta + regionFactor + noise, -0.12, 0.12);
      const previous = states.get(asset.id);
      const overnight = dailyReturn * 0.32 + deterministicNoise(offset + 37, assetIndex + 11) * noiseScale * 0.18;
      const open = previous * (1 + overnight);
      const close = previous * (1 + dailyReturn);
      states.set(asset.id, close);
      series.get(asset.id).push({ date, open: round(open, 6), close: round(close, 6) });
    });
  }

  return {
    generatedAt,
    mode: "demo",
    sourceLabel: "演示结构 · 等待配置每日收盘行情密钥",
    assets: CROSS_MARKET_ASSETS.map((asset) => ({ ...asset, series: series.get(asset.id) })),
  };
}

export function buildCrossMarketSnapshot(input) {
  if (!input || typeof input !== "object") throw new Error("跨市场输入不能为空");
  const generatedAt = normalizeIso(input.generatedAt);
  const mode = input.mode === "live-api" ? "live-api" : "demo";
  const assets = validateAssets(input.assets);
  const pairSummaries = buildPairSummaries(assets);
  const correlations = Object.fromEntries([20, 60].map((window) => [String(window), buildCorrelationMatrix(assets, window)]));
  const regions = CROSS_MARKET_REGIONS.map((region) => buildRegionSummary(region, assets));
  const stories = buildEpisodes(assets);
  const summary = buildCurrentSummary(assets, pairSummaries, correlations["20"]);
  const compactTime = generatedAt.replace(/\D/g, "").slice(0, 14);
  const snapshotId = `${compactTime.slice(0, 8)}T${compactTime.slice(8)}Z`;
  const staleAfter = new Date(new Date(generatedAt).getTime() + 96 * 60 * 60 * 1_000).toISOString();
  const dataThrough = assets.map((asset) => asset.series.at(-1).date).sort()[0];

  return {
    schemaVersion: 1,
    status: "published",
    snapshotId,
    generatedAt,
    staleAfter,
    dataThrough,
    title: "全球市场联动",
    mode,
    isLive: mode === "live-api",
    modeLabel: mode === "live-api" ? "每日收盘行情" : "演示行情结构",
    sourceLabel: cleanText(input.sourceLabel || (mode === "live-api" ? "EODHD · CoinGecko" : "演示结构"), 120),
    assets: assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      shortName: asset.shortName,
      region: asset.region,
      kind: asset.kind,
      symbol: asset.symbol,
      currency: asset.currency,
      color: asset.color,
      series: normalizePublicSeries(asset.series),
      latest: buildLatestSummary(asset),
    })),
    regions,
    correlations,
    pairs: pairSummaries,
    stories,
    summary,
    methodology: {
      normalizedBase: 100,
      correlationWindows: [20, 60],
      correlationInput: "共同交易日期间的日对数收益率",
      leadLagRange: [-5, 5],
      leadLagMinimumSamples: 40,
      leadLagImprovementThreshold: 0.15,
      updateCadence: "每日北京时间 08:30",
    },
  };
}

export function alignedReturns(left, right) {
  const leftMap = new Map(left.series.map((point) => [point.date, point.close]));
  const rightMap = new Map(right.series.map((point) => [point.date, point.close]));
  const dates = [...leftMap.keys()].filter((date) => rightMap.has(date)).sort();
  const values = [];
  for (let index = 1; index < dates.length; index += 1) {
    const previous = dates[index - 1];
    const current = dates[index];
    values.push({
      date: current,
      left: Math.log(leftMap.get(current) / leftMap.get(previous)),
      right: Math.log(rightMap.get(current) / rightMap.get(previous)),
    });
  }
  return values;
}

export function pearson(left, right) {
  const length = Math.min(left.length, right.length);
  if (length < 3) return 0;
  const xs = left.slice(0, length);
  const ys = right.slice(0, length);
  const xMean = average(xs);
  const yMean = average(ys);
  let numerator = 0;
  let xVariance = 0;
  let yVariance = 0;
  for (let index = 0; index < length; index += 1) {
    const xDelta = xs[index] - xMean;
    const yDelta = ys[index] - yMean;
    numerator += xDelta * yDelta;
    xVariance += xDelta ** 2;
    yVariance += yDelta ** 2;
  }
  if (!xVariance || !yVariance) return 0;
  return clamp(numerator / Math.sqrt(xVariance * yVariance), -1, 1);
}

function validateAssets(values) {
  if (!Array.isArray(values) || values.length !== CROSS_MARKET_ASSETS.length) throw new Error("跨市场输入必须包含 8 个配置资产");
  const byId = new Map(values.map((asset) => [asset?.id, asset]));
  return CROSS_MARKET_ASSETS.map((config) => {
    const input = byId.get(config.id);
    if (!input || !Array.isArray(input.series) || input.series.length < 80) throw new Error(`${config.name} 行情不足 80 个有效点`);
    const seen = new Set();
    const series = input.series.map((point) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(point?.date || "") || seen.has(point.date)) throw new Error(`${config.name} 包含非法或重复日期`);
      seen.add(point.date);
      const close = Number(point.close);
      const open = Number(point.open ?? close);
      if (!Number.isFinite(open) || !Number.isFinite(close) || open <= 0 || close <= 0) throw new Error(`${config.name} 包含非法价格`);
      return { date: point.date, open: round(open, 8), close: round(close, 8) };
    }).sort((left, right) => left.date.localeCompare(right.date));
    return { ...config, series };
  });
}

function buildLatestSummary(asset) {
  const latest = asset.series.at(-1);
  const previous = asset.series.at(-2);
  return {
    date: latest.date,
    changePct: round(((latest.close / previous.close) - 1) * 100, 2),
    change20Pct: round(performance(asset, 20) * 100, 2),
    volatility20Pct: round(annualizedVolatility(asset.series.slice(-21)) * 100, 2),
  };
}

function normalizePublicSeries(series) {
  const base = series[0].close;
  return series.map((point) => ({ date: point.date, value: round((point.close / base) * 100, 4) }));
}

function buildRegionSummary(region, assets) {
  const members = assets.filter((asset) => asset.region === region.id);
  const latest = members.map(buildLatestSummary);
  const changePct = round(average(latest.map((item) => item.changePct)), 2);
  const change20Pct = round(average(latest.map((item) => item.change20Pct)), 2);
  return {
    ...region,
    latestDate: latest.map((item) => item.date).sort().at(-1),
    changePct,
    change20Pct,
    state: changePct > 0.35 ? "up" : changePct < -0.35 ? "down" : "flat",
    assetIds: members.map((asset) => asset.id),
  };
}

function buildCorrelationMatrix(assets, window) {
  const values = {};
  assets.forEach((left) => {
    values[left.id] = {};
    assets.forEach((right) => {
      if (left.id === right.id) values[left.id][right.id] = 1;
      else {
        const observations = alignedReturns(left, right).slice(-window);
        values[left.id][right.id] = round(pearson(observations.map((item) => item.left), observations.map((item) => item.right)), 3);
      }
    });
  });
  return { window, values };
}

function buildPairSummaries(assets) {
  const pairs = [];
  for (let leftIndex = 0; leftIndex < assets.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < assets.length; rightIndex += 1) {
      const left = assets[leftIndex];
      const right = assets[rightIndex];
      const observations = alignedReturns(left, right);
      const latest60 = observations.slice(-60);
      const correlation20 = correlationFromObservations(observations.slice(-20));
      const correlation60 = correlationFromObservations(latest60);
      const agreement60 = latest60.length ? latest60.filter((item) => Math.sign(item.left) === Math.sign(item.right)).length / latest60.length : 0;
      pairs.push({
        id: `${left.id}--${right.id}`,
        leftId: left.id,
        rightId: right.id,
        correlation20: round(correlation20, 3),
        correlation60: round(correlation60, 3),
        agreement60Pct: round(agreement60 * 100, 1),
        sampleSize: observations.length,
        leadLag: findLeadLag(observations, left, right),
      });
    }
  }
  return pairs;
}

function findLeadLag(observations, left, right) {
  const sample = observations.slice(-120);
  const zero = correlationFromObservations(sample);
  let best = { sessions: 0, correlation: zero };
  const profile = [];
  for (let lag = -5; lag <= 5; lag += 1) {
    const xs = [];
    const ys = [];
    for (let index = 0; index < sample.length; index += 1) {
      const shifted = index + lag;
      if (shifted < 0 || shifted >= sample.length) continue;
      xs.push(sample[index].left);
      ys.push(sample[shifted].right);
    }
    const correlation = pearson(xs, ys);
    profile.push({ sessions: lag, correlation: round(correlation, 3), samples: xs.length });
    if (lag !== 0 && Math.abs(correlation) > Math.abs(best.correlation)) best = { sessions: lag, correlation };
  }
  const stable = sample.length >= 40 && Math.abs(best.correlation) >= 0.35 && Math.abs(best.correlation) - Math.abs(zero) >= 0.15 && best.sessions !== 0;
  let label = "未发现稳定领先关系";
  if (stable && best.sessions > 0) label = `${right.shortName}通常晚于${left.shortName}约 ${best.sessions} 个共同交易日响应`;
  if (stable && best.sessions < 0) label = `${left.shortName}通常晚于${right.shortName}约 ${Math.abs(best.sessions)} 个共同交易日响应`;
  return { stable, sessions: stable ? best.sessions : 0, correlation: round(stable ? best.correlation : zero, 3), zeroCorrelation: round(zero, 3), label, profile };
}

function buildCurrentSummary(assets, pairs, correlation20) {
  const equity = assets.filter((asset) => asset.kind === "equity");
  const crypto = assets.filter((asset) => asset.kind === "crypto");
  const equityReturn = average(equity.map((asset) => performance(asset, 20)));
  const cryptoReturn = average(crypto.map((asset) => performance(asset, 20)));
  const matrixValues = [];
  for (let left = 0; left < assets.length; left += 1) {
    for (let right = left + 1; right < assets.length; right += 1) matrixValues.push(correlation20.values[assets[left].id][assets[right].id]);
  }
  const averageCorrelation = average(matrixValues);
  let regime = "震荡整理";
  let headline = "全球风险资产暂未形成单一方向";
  if (equityReturn > 0.025 && cryptoReturn > 0.04) { regime = "风险偏好共振"; headline = "股市与加密资产正在形成风险偏好共振"; }
  else if (equityReturn < -0.025 && cryptoReturn < -0.04) { regime = "风险规避共振"; headline = "全球风险资产同步承压，风险规避占上风"; }
  else if (Math.sign(equityReturn) !== Math.sign(cryptoReturn) && Math.abs(equityReturn - cryptoReturn) > 0.04) { regime = "股币分化"; headline = "股市与加密资产出现明显分化"; }
  const strongest = [...pairs].sort((a, b) => b.correlation60 - a.correlation60)[0];
  const weakest = [...pairs].sort((a, b) => Math.abs(a.correlation60) - Math.abs(b.correlation60))[0];
  const name = (id) => assets.find((asset) => asset.id === id)?.shortName || id;
  return {
    regime,
    headline,
    body: `最近 20 个共同交易日，股票市场平均变动 ${formatSigned(equityReturn * 100)}，加密资产平均变动 ${formatSigned(cryptoReturn * 100)}；跨市场平均相关系数为 ${averageCorrelation.toFixed(2)}。`,
    averageCorrelation20: round(averageCorrelation, 3),
    equityReturn20Pct: round(equityReturn * 100, 2),
    cryptoReturn20Pct: round(cryptoReturn * 100, 2),
    strongestPairId: strongest.id,
    weakestPairId: weakest.id,
    conclusions: [
      `${name(strongest.leftId)}与${name(strongest.rightId)}是当前 60 日联动最强组合，相关系数 ${strongest.correlation60.toFixed(2)}。`,
      `${name(weakest.leftId)}与${name(weakest.rightId)}的同步性最弱，适合作为脱钩观察组合。`,
      strongest.leadLag.stable ? strongest.leadLag.label : "主要组合暂未出现足够稳定的领先滞后证据。",
    ],
  };
}

function buildEpisodes(assets) {
  const commonDates = intersectDates(assets);
  if (commonDates.length < 61) throw new Error("共同交易日不足，无法生成跨市场故事");
  const windows = [];
  for (let endIndex = 20; endIndex < commonDates.length; endIndex += 1) {
    const startDate = commonDates[endIndex - 20];
    const endDate = commonDates[endIndex];
    const performances = assets.map((asset) => ({ asset, value: rangePerformance(asset, startDate, endDate) }));
    const correlations = [];
    for (let left = 0; left < assets.length; left += 1) {
      for (let right = left + 1; right < assets.length; right += 1) {
        const observations = alignedReturns(assets[left], assets[right]).filter((item) => item.date > startDate && item.date <= endDate);
        correlations.push(correlationFromObservations(observations));
      }
    }
    const averageCorrelation = average(correlations);
    const sorted = [...performances].sort((a, b) => b.value - a.value);
    const dispersion = sorted[0].value - sorted.at(-1).value;
    const averageReturn = average(performances.map((item) => item.value));
    const stress = average(assets.map((asset) => annualizedVolatility(asset.series.filter((point) => point.date >= startDate && point.date <= endDate)))) - averageReturn;
    windows.push({ startDate, endDate, performances, averageCorrelation, dispersion, stress, movement: average(performances.map((item) => Math.abs(item.value))) });
  }
  const sync = [...windows].sort((a, b) => (b.averageCorrelation + b.movement * 2) - (a.averageCorrelation + a.movement * 2))[0];
  const divergence = [...windows].sort((a, b) => b.dispersion - a.dispersion)[0];
  const stress = [...windows].sort((a, b) => b.stress - a.stress)[0];
  return [
    episodeFromWindow("synchronization", "同步最强", sync, assets),
    episodeFromWindow("divergence", "分化最大", divergence, assets),
    episodeFromWindow("stress", "波动压力", stress, assets),
  ];
}

function episodeFromWindow(type, label, window, assets) {
  const ranked = [...window.performances].sort((a, b) => b.value - a.value);
  const leader = ranked[0];
  const laggard = ranked.at(-1);
  let title;
  let summary;
  if (type === "synchronization") {
    title = `${formatMonthDay(window.startDate)}—${formatMonthDay(window.endDate)}：全球资产同步程度达到阶段高位`;
    summary = `窗口内平均相关系数 ${window.averageCorrelation.toFixed(2)}，${leader.asset.shortName}累计 ${formatSigned(leader.value * 100)}。这段行情适合观察共同风险因子，而不是判断某一市场导致另一市场波动。`;
  } else if (type === "divergence") {
    title = `${formatMonthDay(window.startDate)}—${formatMonthDay(window.endDate)}：${leader.asset.shortName}与${laggard.asset.shortName}明显分化`;
    summary = `${leader.asset.shortName}累计 ${formatSigned(leader.value * 100)}，${laggard.asset.shortName}累计 ${formatSigned(laggard.value * 100)}，相差 ${(window.dispersion * 100).toFixed(1)} 个百分点。`;
  } else {
    title = `${formatMonthDay(window.startDate)}—${formatMonthDay(window.endDate)}：跨市场波动压力集中释放`;
    summary = `这一窗口的综合波动压力为全年高位，领涨资产是${leader.asset.shortName}，承压最明显的是${laggard.asset.shortName}。`;
  }
  return {
    id: type,
    type,
    label,
    title,
    summary,
    from: window.startDate,
    to: window.endDate,
    metrics: {
      averageCorrelation: round(window.averageCorrelation, 3),
      dispersionPct: round(window.dispersion * 100, 2),
      leaderId: leader.asset.id,
      leaderReturnPct: round(leader.value * 100, 2),
      laggardId: laggard.asset.id,
      laggardReturnPct: round(laggard.value * 100, 2),
    },
    performance: Object.fromEntries(assets.map((asset) => [asset.id, round(window.performances.find((item) => item.asset.id === asset.id).value * 100, 2)])),
  };
}

function correlationFromObservations(observations) {
  return pearson(observations.map((item) => item.left), observations.map((item) => item.right));
}

function intersectDates(assets) {
  let dates = new Set(assets[0].series.map((point) => point.date));
  for (const asset of assets.slice(1)) {
    const available = new Set(asset.series.map((point) => point.date));
    dates = new Set([...dates].filter((date) => available.has(date)));
  }
  return [...dates].sort();
}

function rangePerformance(asset, from, to) {
  const start = asset.series.find((point) => point.date >= from);
  const end = [...asset.series].reverse().find((point) => point.date <= to);
  return start && end ? end.close / start.close - 1 : 0;
}

function performance(asset, points) {
  const end = asset.series.at(-1)?.close;
  const start = asset.series.at(-(Math.min(points, asset.series.length - 1) + 1))?.close;
  return end && start ? end / start - 1 : 0;
}

function annualizedVolatility(series) {
  const returns = [];
  for (let index = 1; index < series.length; index += 1) returns.push(Math.log(series[index].close / series[index - 1].close));
  if (returns.length < 2) return 0;
  const mean = average(returns);
  const variance = average(returns.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance) * Math.sqrt(252);
}

function demoShock(offset) {
  if (offset >= 78 && offset <= 94) return -0.0075;
  if (offset >= 168 && offset <= 184) return 0.0062;
  if (offset >= 334 && offset <= 344) return -0.0053;
  return 0;
}

function deterministicNoise(index, salt) {
  const value = Math.sin((index + 1) * (12.9898 + salt * 1.731)) * 43_758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

function formatSigned(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatMonthDay(value) {
  return value.slice(5).replace("-", "/");
}

function normalizeIso(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("generatedAt 不是有效时间");
  return date.toISOString();
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
