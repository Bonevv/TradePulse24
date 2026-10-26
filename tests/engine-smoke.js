"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const ctx = vm.createContext({ console, Date, Math, Number, Intl, Array, Set, Map });
ctx.self = ctx;
for (const file of ["fx-core", "fx-indicators", "fx-series", "fx-backtest", "fx-strategies", "fx-builder", "fx-library", "fx-engine"]) {
  vm.runInContext(fs.readFileSync(path.join(root, `assets/js/${file}.js`), "utf8"), ctx, { filename: file });
}
const FX = ctx.FX;
const prices = {};
for (const pair of FX.PAIR_KEYS) {
  prices[pair] = {};
  for (const [tf, n] of [["M15", 1300], ["H1", 1700], ["D1", 420]]) {
    const file = path.join(root, `data/prices/${pair}_${tf}.json`);
    const bars = JSON.parse(fs.readFileSync(file, "utf8")).bars;
    prices[pair][tf] = bars.slice(-n);
  }
}
const saved = JSON.parse(fs.readFileSync(path.join(root, "data/results.json"), "utf8"));
const good = Object.values(saved.entries).filter((e) => e.stats.verdict === "good");
const catalog = [...FX.CODED, ...FX.LIBRARY];
const selected = good.map((e) => ({ strat: catalog.find((s) => s.key === e.key), tf: e.tf }));
assert.equal(selected.length, 3);
assert.ok(selected.every((x) => x.strat));
const latest = Math.floor(Date.now() / 1000);
const engine = new FX.Engine(prices).build(latest);
const res = engine.run(selected);
assert.equal(res.strategies.length, 3);
assert.ok(res.strategies.every((e) => e.stats.trades >= 0 && e.stats.verdict));
assert.ok(Array.isArray(res.signals));
console.log("OK: 3 strong variants execute on bundled M15/H1/D1 data; engine returns strategies, stats and signals");
