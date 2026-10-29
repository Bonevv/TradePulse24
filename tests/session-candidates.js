"use strict";
const assert = require("node:assert/strict");
const { loadFX, prices } = require("./helpers");
const { FX } = loadFX(), data = prices(["EURUSD", "XAUUSD"]);
const now = Date.now() / 1000, cutoff = Date.UTC(2025, 0, 1) / 1000;
const full = new FX.Engine(data).build(now), past = new FX.Engine(data).build(cutoff);
const expected = { test_previous_day: "M15", test_london_retest: "M15", test_range_fade: "H1", test_dual_thrust: "M15", test_camarilla: "M15", test_nr4: "D1", test_fractal_alligator: "H4", test_rsi_divergence: "H4", test_turtle_soup: "D1", test_bollinger_wm: "H4" };
assert.equal(FX.NEW_CANDIDATES.length, 10);
const stable = (trades) => JSON.stringify(trades.filter((trade) => trade.status === "closed" && trade.exit_time < cutoff)
  .map((trade) => ({ id: trade.id, entry: trade.fill_price, stop: trade.stop0, time: trade.exit_time, r: trade.r })).sort((a, b) => a.id.localeCompare(b.id)));
for (const strat of FX.NEW_CANDIDATES) {
  const tf = expected[strat.key]; assert.ok(tf, strat.key); assert.equal(strat.tfs.join(), tf);
  assert.ok(strat.provisional && strat.version >= 1 && strat.rules.length && strat.exit_rules.length);
  const result = full.trades(strat, tf), short = past.trades(strat, tf);
  assert.equal(stable(result.trades), stable(short.trades), strat.key + " cannot use future bars");
  const entry = full.entry(strat, tf, result); FX.reviewEntry(entry, strat, result, now);
  assert.notEqual(entry.stats.verdict, "good", strat.key + " is still a candidate");
  assert.ok(entry.per_pair.every((row) => row.verdict !== "good"));
  const fills = new Map();
  for (const trade of result.trades) if (trade.fill_time) {
    const original = trade.orders.find((order) => order.dir === trade.dir), risk = Math.abs(trade.fill_price - trade.stop0);
    assert.ok(risk + 1e-9 >= original.min_risk && risk <= original.max_risk + 1e-9, "risk guard also applies to opening gaps");
    if (FX.TIMEFRAMES[tf].style === "day") {
      const key = trade.pair + "|" + FX.local(trade.fill_time).date;
      fills.set(key, (fills.get(key) || 0) + 1);
      if (trade.exit_time) assert.equal(FX.local(trade.fill_time).date, FX.local(trade.exit_time - 1).date, strat.key + " day exit");
    }
  }
  assert.ok([...fills.values()].every((count) => count <= 1), strat.key + " includes same-bar stops in its daily limit");
  if (strat.key === "test_camarilla") assert.ok(entry.stats.trades > 0, "the corrected limit entry has executable conditions");
  console.log("OK:", strat.key, "causality, initial risk and", entry.stats.trades, "closed models");
}
const catalog = Object.fromEntries([...FX.CODED, ...FX.LIBRARY, ...FX.RESEARCH].map((strat) => [strat.key, strat]));
assert.ok(FX.isRetired(catalog.fake2b, "H4") && FX.isRetired(catalog.graal, "H4"));
assert.ok(FX.isRetired(catalog.lib_ema_htf, "H1") && !FX.isRetired(catalog.lib_ema_htf, "H4"));
const old = full.trades(catalog.fake2b, "H4").trades.find((trade) => trade.status === "closed" && trade.exit_time < now - 30 * 86400);
assert.ok(old);
assert.equal(full.signals(catalog.fake2b, "H4", [old]).length, 0, "retired models cannot create new discoveries");
full.keepIds.add(old.id);
assert.equal(full.signals(catalog.fake2b, "H4", [old]).length, 1, "tracked retired results remain available beyond fourteen days");
const fix = catalog.rev_ema_htf_day, fixed = full.trades(fix, "H1");
assert.equal(fix.version, 2); assert.equal(stable(fixed.trades), stable(past.trades(fix, "H1").trades));
for (const trade of fixed.trades) if (trade.fill_time && trade.exit_time) assert.equal(FX.local(trade.fill_time).date, FX.local(trade.exit_time - 1).date);
for (const strat of FX.DAY_REVISIONS) for (const tf of strat.tfs) {
  assert.equal(strat.version, 3); assert.ok(FX.isRetired(catalog[strat.parent_key], tf));
  const result = full.trades(strat, tf), counts = new Map();
  assert.equal(stable(result.trades), stable(past.trades(strat, tf).trades), strat.key + " causality");
  for (const trade of result.trades) if (trade.fill_time) {
    const key = trade.pair + "|" + FX.local(trade.fill_time).date; counts.set(key, (counts.get(key) || 0) + 1);
    if (trade.exit_time) assert.equal(FX.local(trade.fill_time).date, FX.local(trade.exit_time - 1).date);
  }
  assert.ok([...counts.values()].every((count) => count === 1), strat.key + " counts every filled position");
}
assert.equal(full.trades(catalog.test_camarilla_v1, "M15").trades.filter((trade) => trade.status === "closed").length, 0, "the impossible original is kept for comparison");
console.log("OK: archive tracking, day correction and unchanged Camarilla v1 record");
