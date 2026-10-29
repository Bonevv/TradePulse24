"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { loadFX, prices, root } = require("./helpers"), { FX } = loadFX();
const engine = new FX.Engine(prices(FX.PAIR_KEYS)).build(Math.floor(Date.now() / 1000));
const filename = path.join(root, "data/catalog.json"), previous = JSON.parse(fs.readFileSync(filename, "utf8"));
const original = JSON.parse(fs.readFileSync(path.join(root, "data/results.json"), "utf8"));
const entries = {}, numeric = ["trades", "avg_r", "profit_factor", "total_r", "max_dd_r", "avg_first", "avg_second"];
const metric = (value) => value === 0 ? 0 : value; // JSON записва -0 като 0.
let legacy = 0;
for (const strat of [...FX.CODED, ...FX.LIBRARY, ...FX.RESEARCH]) for (const tf of strat.tfs) {
  const result = engine.trades(strat, tf), entry = engine.entry(strat, tf, result);
  FX.reviewEntry(entry, strat, result, engine.now);
  // Какво става при вход по-късно или по-близо до стопа — съветът „Мога ли да вляза сега?“.
  FX.addEntryTiming(entry, result.trades, (pair) => engine.get(pair, "M15") || engine.get(pair, "H1"));
  if (strat.parent_key) {
    const parent = [...FX.CODED, ...FX.LIBRARY, ...FX.RESEARCH].find((candidate) => candidate.key === strat.parent_key);
    const baseline = engine.trades(parent, tf);
    entry.parent_key = parent.key; entry.changes = strat.changes; entry.hypothesis = strat.hypothesis;
    entry.comparison = { id: parent.key + "-" + tf, name: parent.name, original: FX.evaluate(baseline.trades, baseline.start, baseline.end),
      per_pair: (parent.pairs || FX.PAIR_KEYS).map((pair) => ({ pair, review: FX.evaluate(baseline.trades.filter((trade) => trade.pair === pair), baseline.start, baseline.end) })) };
  }
  if (strat.strict_daily_fills) {
    const days = new Map();
    for (const trade of result.trades) if (trade.fill_time) {
      const key = trade.pair + "|" + FX.local(trade.fill_time).date;
      days.set(key, (days.get(key) || 0) + 1);
      if (trade.exit_time) assert.equal(FX.local(trade.fill_time).date, FX.local(trade.exit_time - 1).date, entry.id + " overnight");
    }
    assert.ok([...days.values()].every((count) => count === 1), entry.id + " daily fills");
  }
  if (original.entries[entry.id]) {
    for (const field of numeric) assert.equal(metric(entry.stats[field]), metric(original.entries[entry.id].stats[field]), entry.id + ": original " + field);
    legacy++;
  }
  if (!process.argv.includes("--write")) {
    assert.ok(previous.entries[entry.id], "Missing bundled result: " + entry.id);
    for (const field of numeric) assert.equal(metric(entry.stats[field]), metric(previous.entries[entry.id].stats[field]), entry.id + ": bundled " + field);
  }
  entries[entry.id] = entry;
}
assert.equal(legacy, Object.keys(original.entries).length);
if (process.argv.includes("--write")) fs.writeFileSync(filename, JSON.stringify({ release: FX.RELEASE, generated_at: engine.now, entries,
  recommended: (previous.recommended || []).filter((id) => entries[id] && !entries[id].retired) }) + "\n");
console.log(`OK: ${Object.keys(entries).length} versions measured; ${legacy} original numeric results preserved; strict day limits checked`);
