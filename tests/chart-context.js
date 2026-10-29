"use strict";
const assert = require("node:assert/strict");
const { loadFX, prices } = require("./helpers"), { FX } = loadFX();
const base = Date.UTC(2026, 9, 26, 8) / 1000;
const fine = { n: 12, sec: 900, t: Array.from({ length: 12 }, (_, i) => base + i * 900) };
const coarse = { n: 3, sec: 14400, t: [base, base + 14400, base + 28800] };
const signal = { id: "context-H1-test", pair: "EURUSD", tf: "H1", style: "day", status: "open", dir: 1,
  signal_time: base + 3600, fill_time: base + 3900, fill_price: 1.1, stop0: 1.09, stop: 1.09 };
const original = JSON.stringify(signal);
assert.equal(FX.chartMarkers(signal, fine).find((m) => m.kind === "signal").time, base + 2700, "An H1 decision is marked on the final M15 candle, not an earlier unfinished signal");
assert.equal(FX.chartMarkers({ ...signal, signal_time: base + 18000 }, coarse).find((m) => m.kind === "signal").time, base + 14400, "A wider view keeps the signal in its original time bucket");
assert.equal(JSON.stringify(signal), original, "Changing view resolution does not rewrite the signal");
const group = FX.signalTools.group([signal, { ...signal, id: "opposite", dir: -1 }, { ...signal, id: "pending", status: "pending", orders: [{ dir: 1 }] }]);
assert.equal(group.length, 1, "One instrument has one group across directions and states");
assert.equal(group[0].signals.length, 3); assert.equal(group[0].state, "mixed");

// При изостанала D1 по-малките свещи вече съдържат завършен модел преди крайния срок.
const data = prices(["USDJPY"]), strategy = FX.CODED.find((s) => s.key === "fake2b");
for (const date of ["2026-10-28T18:39:42Z", "2026-11-03T12:00:00Z"]) {
  const engine = new FX.Engine(data).build(Date.parse(date) / 1000);
  const trade = engine.trades(strategy, "D1").trades.find((t) => t.id === "fake2b-D1-USDJPY-1792713600");
  assert.equal(trade.status, "closed"); assert.equal(trade.r, -.032);
}
console.log("OK: model/view timeframe separation, one group per instrument and stable recorded fills after expiry");
