"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.resolve(__dirname, ".."), output = [];
const context = vm.createContext({ console, Date, Math, Number, Intl, Array, Set, Map, postMessage: (m) => output.push(m) });
context.self = context;
context.importScripts = (...names) => names.forEach((name) => vm.runInContext(fs.readFileSync(path.join(root, "assets/js", name), "utf8"), context, { filename: name }));
vm.runInContext(fs.readFileSync(path.join(root, "assets/js/fx-worker.js"), "utf8"), context);
const FX = context.FX, variants = FX.REVISIONS.flatMap((s) => s.tfs.map((tf) => ({ key: s.key, tf })));
assert.equal(FX.REVISIONS.length, 22); assert.equal(variants.length, 31);
const archived = JSON.parse(fs.readFileSync(path.join(root, "data/results.json"), "utf8")).entries;
for (const e of Object.values(archived).filter((e) => e.stats.verdict === "weak")) assert.ok(variants.some((v) => v.key === "rev_" + e.key && v.tf === e.tf), "Every archived weak variant has a separate revision: " + e.id);
assert.ok(FX.REVISIONS.every((s) => s.version === 2 && s.provisional && !s.spec && s.changes.length && s.hypothesis));
const prices = {};
for (const pair of FX.PAIR_KEYS) {
  prices[pair] = {};
  for (const tf of ["M15", "H1", "D1"]) prices[pair][tf] = JSON.parse(fs.readFileSync(path.join(root, `data/prices/${pair}_${tf}.json`), "utf8")).bars;
}
const end = Math.max(...Object.values(prices).map((p) => p.M15.at(-1)[0] + 900));
const now = Math.max(Date.now() / 1000, end);
// Сравняваме приключилите сделки преди границата при налична и липсваща бъдеща история.
(function causal() {
  const chosen = Object.fromEntries(["XAUUSD", "USDJPY"].map((p) => [p, prices[p]]));
  const cutoff = Date.UTC(2025, 0, 1) / 1000;
  const full = new FX.Engine(chosen).build(now), prefix = new FX.Engine(chosen).build(cutoff);
  const stable = (rows) => JSON.stringify(rows.filter((t) => t.status === "closed" && t.exit_time < cutoff).map((t) => [t.id, t.fill_price, t.stop0, t.exit_time, t.r, t.reason]));
  const series = full.get("USDJPY", "H4"), a = FX.BUILDER_IND.ichi.calc(series), [up, low, tk, kj] = series.get("ichi");
  assert.strictEqual(a, FX.BUILDER_IND.ichi.calc(series), "Derived cloud arrays are reused");
  assert.deepEqual(a[0], up.map((x, i) => x == null || low[i] == null ? null : Math.max(x, low[i])));
  assert.deepEqual(a[1], up.map((x, i) => x == null || low[i] == null ? null : Math.min(x, low[i])));
  assert.strictEqual(a[2], tk); assert.strictEqual(a[3], kj);
  for (const item of variants) {
    const strat = FX.REVISIONS.find((s) => s.key === item.key), f = full.trades(strat, item.tf), p = prefix.trades(strat, item.tf);
    assert.equal(stable(f.trades), stable(p.trades), item.key + " " + item.tf + " does not use future bars");
    for (const t of f.trades) {
      if (t.fill_time) assert.ok(t.fill_time < t.valid_until, "Revision never enters an expired order");
      if (t.fill_time && FX.TIMEFRAMES[item.tf].style === "day") {
        assert.ok(!t.exit_time || FX.local(t.fill_time).date === FX.local(t.exit_time - 1).date, "Day trades do not stay overnight");
      }
    }
  }
})();
console.log("OK: all 31 revisions are causal; day trades, anchored limits, strict expiry and unchanged cached Ichimoku values");
const pending = { status: "pending", strict_expiry: true, valid_until: 100, orders: [{ type: "market", dir: 1, entry: 1.1, stop: 1, stop_dist: .1, targets: [{ level: null }] }] };
FX.bt.process(pending, FX.PAIRS.EURUSD, .0001, 120, 1.1, 1.2, 1.09, 1.15, 60, { parts: [[1, null]] });
assert.equal(pending.status, "cancelled"); assert.equal(pending.exit_time, 100);
context.onmessage({ data: { cmd: "load", prices, now, custom: [] } });
context.onmessage({ data: { cmd: "run", items: variants } });
assert.deepEqual(output.filter((m) => m.type === "error"), []);
const results = output.filter((m) => m.type === "result").map((m) => m.entry);
assert.equal(results.length, 31);
for (const e of results) {
  assert.ok(e.comparison && e.evaluation && e.pair_review && e.validation && !e.validation.passed);
  assert.notEqual(e.stats.verdict, "good"); assert.equal(e.version, 2);
  assert.equal(e.comparison.per_pair.length, e.per_pair.length);
  for (const p of e.per_pair) { assert.ok(p.assessment && p.review); if (p.assessment.allowed) assert.equal(p.assessment.status, "watch"); }
  console.log(`${e.id}: ${e.stats.trades} trades; mean ${e.stats.avg_r ?? "n/a"}R vs ${e.comparison.original.full.avg_r ?? "n/a"}; later ${e.evaluation.holdout.avg_r ?? "n/a"}R; double cost ${e.evaluation.stress.avg_r ?? "n/a"}R; pairs ${e.per_pair.filter((p) => p.assessment.allowed).map((p) => p.pair).join(",") || "none"}`);
}
if (process.argv[2] === "--report") { assert.ok(process.argv[3]); fs.writeFileSync(process.argv[3], JSON.stringify(results, null, 2)); }
console.log("OK: 15 archived weak variants, all nine book combinations and seven indicator candidates have measured, separately versioned revisions");
