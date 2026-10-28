"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const output = [];
const context = vm.createContext({ console, Date, Math, Number, Intl, Array, Set, Map, postMessage: (message) => output.push(message) });
context.self = context;
context.importScripts = (...names) => names.forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, "assets/js", file), "utf8"), context, { filename: file }));
vm.runInContext(fs.readFileSync(path.join(root, "assets/js/fx-worker.js"), "utf8"), context);
const { FX } = context;
const prices = {};
for (const pair of FX.PAIR_KEYS) {
  prices[pair] = {};
  for (const tf of ["M15", "H1", "D1"]) prices[pair][tf] = JSON.parse(fs.readFileSync(path.join(root, `data/prices/${pair}_${tf}.json`), "utf8")).bars;
}
const sample = prices.EURUSD.H1.slice(-400), prefix = sample.slice(0, 300);
for (const [name, calc] of Object.entries({ kama: (b) => FX.ind.kama(b.map((x) => x[4]), 10, 2, 30), demarker: (b) => FX.ind.demarker(b.map((x) => x[2]), b.map((x) => x[3]), 14), rvi: (b) => FX.ind.rvi(b.map((x) => x[1]), b.map((x) => x[2]), b.map((x) => x[3]), b.map((x) => x[4]), 10) })) {
  const full = calc(sample), short = calc(prefix);
  if (name === "rvi") { for (let i = 0; i < 2; i++) assert.deepEqual(full[i].slice(0, 300), short[i], name + " does not read future bars"); }
  else assert.deepEqual(full.slice(0, 300), short, name + " does not read future bars");
}
context.onmessage({ data: { cmd: "load", prices, now: Date.now() / 1000, custom: [] } });
const items = FX.RESEARCH.filter((s) => !s.parent_key).flatMap((s) => s.tfs.map((tf) => ({ key: s.key, tf })));
context.onmessage({ data: { cmd: "run", items } });
assert.ok(!output.some((m) => m.type === "error"), JSON.stringify(output.filter((m) => m.type === "error")));
const results = output.filter((m) => m.type === "result");
assert.equal(results.length, 18);
for (const { entry } of results) {
  assert.ok(entry && entry.validation && Number.isFinite(entry.stats.total_r));
  assert.ok(entry.validation.cutoff > entry.stats.start);
  if (entry.stats.verdict === "good") assert.equal(entry.validation.passed, true);
  console.log(`${entry.id}: ${entry.stats.trades} trades; ${entry.stats.verdict}; mean ${entry.stats.avg_r}R; PF ${entry.stats.profit_factor}; holdout ${entry.validation.holdout.trades} trades, ${entry.validation.holdout.avg_r}R/trade`);
}
console.log("OK: 9 existing research variants and 9 variants from seven book candidates; full history and chronological diagnostics; causal indicator values");
