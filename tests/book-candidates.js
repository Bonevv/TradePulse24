"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const context = vm.createContext({ console, Date, Math, Number, Intl, Array, Set, Map });
context.self = context;
for (const file of ["fx-core", "fx-indicators", "fx-series", "fx-backtest", "fx-strategies", "fx-builder", "fx-library", "fx-candidates", "fx-book-candidates", "fx-engine"]) {
  vm.runInContext(fs.readFileSync(path.join(root, `assets/js/${file}.js`), "utf8"), context, { filename: file });
}
const FX = context.FX, ex = { parts: [[1, null]] };
const info = FX.PAIRS.EURUSD, pip = info.pip;
const market = (entry, stop) => ({ dir: 1, type: "market", entry, stop, anchor_stop: true, stop_dist: entry - stop, targets: [{ w: 1, level: null }], atr: .1 });
let state = { status: "pending", orders: [market(1.1, 1)] };
FX.bt.process(state, info, pip, 0, 1.2, 1.25, 1.15, 1.21, 60, ex);
assert.equal(state.stop0, 1, "opening gap preserves the signal's absolute stop");
state = { status: "pending", orders: [market(1.1, 1)] };
FX.bt.process(state, info, pip, 0, .95, 1.05, .94, 1, 60, ex);
assert.equal(state.status, "cancelled", "gap beyond an anchored stop cancels the entry");
const delayed = () => ({ status: "pending", orders: [{ ...market(1.2, .8), type: "stop", activate_after: 100 }] });
state = delayed();
FX.bt.process(state, info, pip, 0, 1, 1.3, .9, 1.2, 60, ex);
assert.equal(state.status, "cancelled", "a touched entry during the publication delay is never backfilled");
state = delayed();
FX.bt.process(state, info, pip, 0, 1, 1.1, .9, 1, 60, ex);
assert.equal(state.status, "pending");
FX.bt.process(state, info, pip, 120, 1.1, 1.3, 1.05, 1.25, 60, ex);
assert.equal(state.status, "open");
assert.equal(state.fill_time, 120);
assert.equal(FX.BOOK_CANDIDATES.length, 7);
assert.equal(FX.BOOK_CANDIDATES.reduce((n, s) => n + s.tfs.length, 0), 9);
assert.ok(FX.BOOK_CANDIDATES.every((s) => s.provisional && s.version === 1 && s.rules.length && s.exit_rules.length));

const prices = {};
for (const pair of ["EURUSD", "USDJPY"]) {
  prices[pair] = {};
  for (const tf of ["M15", "H1", "D1"]) prices[pair][tf] = JSON.parse(fs.readFileSync(path.join(root, `data/prices/${pair}_${tf}.json`), "utf8")).bars;
}
const end = Math.max(...Object.values(prices).flatMap((p) => p.M15.slice(-1).map((b) => b[0]))) + 86400;
const cutoff = Date.UTC(2025, 0, 1) / 1000;
const full = new FX.Engine(prices).build(end), short = new FX.Engine(prices).build(cutoff);
const stable = (trades) => trades.filter((t) => t.status === "closed" && t.exit_time < cutoff).map((t) => ({ id: t.id, entry: t.fill_price, stop: t.stop0, time: t.exit_time, r: t.r, reason: t.reason }));
for (const strat of FX.BOOK_CANDIDATES) {
  for (const tf of strat.tfs) {
    const a = full.trades(strat, tf), b = short.trades(strat, tf);
    assert.deepEqual(stable(a.trades), stable(b.trades), strat.key + " " + tf + " is unchanged by future bars");
    const entry = full.entry(strat, tf, a);
    assert.notEqual(entry.stats.verdict, "good", "seen history does not create a new confirmed strong rating");
    assert.equal(entry.version, 1);
    for (const t of a.trades.filter((t) => t.fill_time && FX.TIMEFRAMES[tf].style === "day")) {
      assert.ok(!t.exit_time || FX.local(t.fill_time).date === FX.local(t.exit_time - 1).date, strat.key + " has no overnight day trades");
    }
    console.log(`OK: ${strat.key} ${tf}: causal signals, provisional rating and version`);
  }
}
console.log("OK: seven book candidates, nine day/swing variants, anchored stops and publication delay");
