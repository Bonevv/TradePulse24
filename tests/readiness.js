"use strict";
const assert = require("node:assert/strict");
const { loadFX } = require("./helpers"), { FX } = loadFX();
const now = Date.UTC(2026, 10, 9, 10) / 1000;
const base = { now, pair: "EURUSD", dir: 1, marketOpen: true, modelFresh: true, modelTime: now - 900,
  quote: { source: "broker", bid: 1.1, ask: 1.1001, time: now }, choice: { allowed: true, forward: { state: "pending" } },
  newsTime: now - 3600, news: [], historyReady: true, balance: 2000, riskPct: .25, costRatio: .05,
  plan: { daily: 1, weekly: 3, open: 1, instrument: .5, currency: 1 },
  stats: { daily: 0, weekly: 0, openRisk: 0, byPair: {}, byCurrency: {}, open: [] } };
const run = (extra = {}) => FX.entryReadiness({ ...base, ...extra });
const blocked = (code, extra) => assert.ok(run(extra).blocks.some((b) => b.code === code), code);
assert.equal(run().allowed, true);
assert.ok(run().warnings.some((w) => w.code === "experimental"));
blocked("quote", { quote: { ...base.quote, source: "site" } });
blocked("quote", { quote: { ...base.quote, time: now - 60 } });
blocked("quote", { quote: { ...base.quote, time: now + 10 } });
blocked("quote", { quote: { ...base.quote, ask: 1.09 } });
blocked("model", { modelTime: now - 1801 });
blocked("model", { modelFresh: false });
blocked("market", { marketOpen: false });
blocked("break", { pair: "XAUUSD", goldBreak: true });
blocked("activation", { activates: now + 1 });
blocked("expired", { expires: now });
blocked("strategy", { choice: { allowed: false } });
blocked("history", { historyReady: false });
blocked("calendar", { newsTime: now - 7201 });
blocked("calendar", { newsFailed: true });
blocked("news", { news: [{ impact: "high", currency: "USD", time: now + 1800 }] });
blocked("news", { pair: "XAUUSD", news: [{ impact: "high", currency: "USD", time: now - 1800 }] });
assert.equal(run({ news: [{ impact: "high", currency: "JPY", time: now }] }).allowed, true);
assert.equal(run({ news: [{ impact: "medium", currency: "USD", time: now }] }).allowed, true);
blocked("costs", { costRatio: Infinity });
blocked("costs", { costRatio: .201 });
assert.equal(run({ costRatio: .2 }).allowed, true);
blocked("risk", { balance: null });
blocked("risk", { riskPct: 1.01 });
blocked("daily", { stats: { ...base.stats, daily: .6, openRisk: .2 } });
blocked("weekly", { stats: { ...base.stats, weekly: 2.7, openRisk: .1 } });
blocked("portfolio", { stats: { ...base.stats, openRisk: .8 } });
blocked("instrument", { stats: { ...base.stats, byPair: { EURUSD: .3 } } });
blocked("currency", { stats: { ...base.stats, byCurrency: { USD: -.8 } } });
blocked("duplicate", { stats: { ...base.stats, open: [{ pair: "EURUSD" }] } });
assert.ok(!run({ stats: { ...base.stats, byCurrency: { USD: .9 } } }).blocks.some((b) => b.code === "currency"), "Opposite currency direction reduces net exposure only");
blocked("journal", { stats: null });

for (const dir of [1, -1]) {
  const entry = 100, stop0 = 100 - dir * 10, stop = 100 + dir * 2;
  const sig = { status: "open", dir, fill_price: entry, stop0, stop, tp1: 100 + dir * 10, tp2: 100 + dir * 20,
    parts: [{ w: .5, tp: 100 + dir * 10, px: 100 + dir * 10 }, { w: .5, tp: 100 + dir * 25, px: null }] };
  const check = (opts = {}) => FX.managementPlan(sig, { current: true, fresh: true, tpModes: [true, true], ...opts });
  assert.ok(check().actions.some((a) => a.code === "stop" && a.to === stop));
  assert.ok(check().actions.some((a) => a.code === "partial" && a.weight === .5));
  assert.ok(check().actions.some((a) => a.code === "target" && a.to === 100 + dir * 25));
  assert.ok(!check({ actualStop: 100 + dir * 3 }).actions.some((a) => a.code === "stop"), "Never loosen an actual stop");
  assert.equal(check({ fresh: false }).actions.length, 0);
  assert.equal(check({ current: false }).actions.length, 0);
  assert.ok(!check({ tpModes: [false, false] }).actions.some((a) => a.code === "target"), "Indicator exits are not TP orders");
  const trail = { ...sig, tp1: null, tp2: null, parts: [{ w: 1, tp: null, px: null }] };
  assert.equal(FX.managementPlan(trail, { fresh: true, current: true }).initial[0].targets[0].level, null);
  assert.ok(!FX.managementPlan(trail, { fresh: true, current: true }).actions.some((a) => a.code === "target"));
}
console.log("OK: broker Bid/Ask expiry, stale models/calendar, news windows, projected portfolio/currency risk and buy/sell management without invented TP or repeated partial orders");
