"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), crypto = require("node:crypto");
const root = path.resolve(__dirname, ".."), folder = path.join(root, "docs/research/2026-10-26");
fs.mkdirSync(folder, { recursive: true });
const context = vm.createContext({ console, Date, Math, Number, Intl, Array, Set, Map });
context.self = context;
for (const name of ["fx-core", "fx-indicators", "fx-series", "fx-backtest", "fx-strategies", "fx-builder", "fx-library", "fx-engine"]) vm.runInContext(fs.readFileSync(path.join(root, `assets/js/${name}.js`), "utf8"), context, { filename: name });
const FX = context.FX;
const candidates = require("./research-candidates.js")(FX);
const epoch = (value) => Date.parse(value + "T00:00:00Z") / 1000;
const plan = { rules_sha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname, "research-candidates.js"))).digest("hex"),
  periods: [{ key: "development", start: epoch("2024-01-01"), end: epoch("2025-01-01") }, { key: "validation", start: epoch("2025-01-01"), end: epoch("2026-01-01") }, { key: "recent", start: epoch("2026-01-01"), end: epoch("2026-10-27") }],
  trials: candidates.map((s) => ({ key: s.key, name: s.name, tf: s.tfs[0], pair: s.pairs[0], source: s.url })),
  requirements: { min_trades_per_period: 30, positive_development_and_validation: true, recent_mean_r: 0.08, recent_profit_factor: 1.15, positive_recent_at_double_costs: true },
  limitations: ["Архивът вече е ползван за други тестове; това са хронологични проверки, не нови неизползвани пазарни данни.", "Без подбор на параметри след виждане на резултатите от тази група.", "Сценарият с удвоен разход използва същите OHLC изпълнения; не е тест с реални bid/ask тикове.", "Липсват реални суапове и календар за историческите новини."] };
fs.writeFileSync(path.join(folder, "plan.json"), JSON.stringify(plan, null, 2));
console.log("Frozen research plan:", plan.rules_sha256, candidates.length, "trials");
if (process.argv.includes("--plan")) process.exit(0);

const prices = {}, integrity = [];
for (const pair of new Set(candidates.map((s) => s.pairs[0]))) {
  prices[pair] = {};
  for (const tf of ["M15", "H1", "D1"]) {
    const file = path.join(root, `data/prices/${pair}_${tf}.json`);
    const bytes = fs.readFileSync(file), bars = JSON.parse(bytes).bars;
    for (let i = 0; i < bars.length; i++) {
      const [t, o, h, l, c] = bars[i];
      if (bars[i].length !== 5 || !bars[i].every(Number.isFinite) || Math.min(o, h, l, c) <= 0 || h < Math.max(o, l, c) || l > Math.min(o, h, c) || (i && t <= bars[i - 1][0])) throw new Error("Invalid OHLC data: " + file + " bar " + i);
    }
    prices[pair][tf] = bars;
    integrity.push({ pair, tf, bars: bars.length, first: bars[0][0], last: bars.at(-1)[0], sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
  }
}

function summary(trades, s, start, end) {
  const closed = trades.filter((t) => t.status === "closed");
  const stats = FX.bt.summarize(closed, start, end);
  const spreadR = (t) => FX.PAIRS[t.pair].spread * FX.PAIRS[t.pair].pip / Math.abs(t.fill_price - t.stop0);
  const extraCosts = closed.reduce((sum, t) => sum + spreadR(t), 0);
  let openR = 0;
  for (const t of trades.filter((t) => t.status === "open")) {
    const risk = Math.abs(t.fill_price - t.stop0);
    openR += t.parts.reduce((sum, part) => sum + part.w * t.dir * ((part.px ?? s.c.at(-1)) - t.fill_price) / risk, 0) - spreadR(t);
  }
  const overnightDays = closed.reduce((sum, t) => sum + Math.max(0, Math.floor((t.exit_time - t.fill_time) / 86400)), 0);
  const doubledMean = closed.length ? (closed.reduce((sum, t) => sum + t.r, 0) - extraCosts) / closed.length : null;
  const swapStressMean = closed.length ? (closed.reduce((sum, t) => sum + t.r, 0) - extraCosts - overnightDays * .01) / closed.length : null;
  const recentMonths = (end - start) / (365.25 * 86400 / 12);
  return { stats, double_cost_mean_r: doubledMean, double_cost_and_overnight_scenario_mean_r: swapStressMean,
    trades_per_month: closed.length / recentMonths, open_at_end: trades.filter((t) => t.status === "open").length, open_mark_to_market_r: openR,
    total_with_open_mark_r: (stats.total_r || 0) + openR };
}

const results = Object.fromEntries(candidates.map((s) => [s.key, { ...plan.trials.find((t) => t.key === s.key), periods: {} }]));
for (const period of plan.periods) {
  const engine = new FX.Engine(prices).build(period.end);
  for (const strategy of candidates) {
    const tf = strategy.tfs[0], pair = strategy.pairs[0], series = engine.get(pair, tf);
    series.memo = {};
    const trades = FX.bt.simulate(series, strategy, period.end, [[engine.get(pair, "M15"), 900], [engine.get(pair, "H1"), 3600]], period.start);
    for (const t of trades) if (t.fill_time && t.fill_time < period.start) throw new Error("Position leaked across period boundary");
    const end = Math.min(period.end, series.t.at(-1) + series.sec);
    results[strategy.key].periods[period.key] = summary(trades, series, Math.max(period.start, series.t[60]), end);
    const stats = results[strategy.key].periods[period.key].stats;
    console.log(period.key, strategy.key, stats.trades, stats.avg_r, stats.profit_factor);
  }
}
for (const result of Object.values(results)) {
  const { development: d, validation: v, recent: t } = result.periods;
  result.passed = [d, v, t].every((p) => p.stats.trades >= 30 && p.total_with_open_mark_r > 0) && d.stats.avg_r > 0 && v.stats.avg_r > 0 && t.stats.avg_r >= .08 && (t.stats.profit_factor === null || t.stats.profit_factor >= 1.15) && t.double_cost_mean_r > 0;
}
fs.writeFileSync(path.join(folder, "results.json"), JSON.stringify({ plan, integrity, results: Object.values(results) }, null, 2));
console.log("PASSING:", Object.values(results).filter((r) => r.passed).map((r) => r.key).join(", ") || "none");
