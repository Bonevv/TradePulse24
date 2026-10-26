"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const context = vm.createContext({ console, Date, Math, Number, Intl, Array, Set, Map });
context.self = context;
for (const file of ["fx-core", "fx-indicators", "fx-series", "fx-backtest", "fx-strategies", "fx-builder", "fx-library", "fx-engine"]) {
  vm.runInContext(fs.readFileSync(path.join(root, "assets/js", file + ".js"), "utf8"), context);
}
const FX = context.FX;
const catalog = [...FX.CODED, ...FX.LIBRARY];
const selected = [["gold_scalper", "M15"], ["gold_sentinel", "H4"], ["lib_golden_cross", "H4"]];
const folder = path.join(root, "docs/research/2026-10-26");
const periods = JSON.parse(fs.readFileSync(path.join(folder, "plan.json"), "utf8")).periods;
const prices = {};
for (const pair of FX.PAIR_KEYS) {
  prices[pair] = {};
  for (const tf of ["M15", "H1", "D1"]) prices[pair][tf] = JSON.parse(fs.readFileSync(path.join(root, "data/prices", `${pair}_${tf}.json`), "utf8")).bars;
}
const report = {
  note: "Baseline comparison only. Existing rules and historical saved ratings are unchanged.",
  results: selected.map(([key, tf]) => ({ key, tf, periods: {} })),
};
// Всяка година започва без отворена позиция; по-старата история загрява индикаторите.
for (const period of periods) {
  const engine = new FX.Engine(prices).build(period.end);
  for (const result of report.results) {
    const strategy = catalog.find((s) => s.key === result.key);
    const closed = [], open = [];
    for (const pair of strategy.pairs || FX.PAIR_KEYS) {
      const series = engine.get(pair, result.tf);
      series.memo = {};
      const trades = FX.bt.simulate(series, strategy, period.end,
        [[engine.get(pair, "M15"), 900], [engine.get(pair, "H1"), 3600]], period.start);
      closed.push(...trades.filter((t) => t.status === "closed"));
      open.push(...trades.filter((t) => t.status === "open"));
    }
    const stats = FX.bt.summarize(closed, period.start, period.end);
    const extraCosts = closed.reduce((sum, t) => sum + FX.PAIRS[t.pair].spread * FX.PAIRS[t.pair].pip / Math.abs(t.fill_price - t.stop0), 0);
    result.periods[period.key] = {
      stats,
      double_cost_mean_r: closed.length ? (closed.reduce((sum, t) => sum + t.r, 0) - extraCosts) / closed.length : null,
      open_at_end: open.length,
    };
    console.log(result.key, period.key, stats.trades, stats.avg_r, stats.profit_factor);
  }
}
fs.writeFileSync(path.join(folder, "baselines.json"), JSON.stringify(report, null, 2));
