"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const c = vm.createContext({ console, Date, Math, Number, Intl, Array, Set, Map }); c.self = c;
for (const name of ["fx-core", "fx-backtest", "fx-evaluation"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../assets/js/" + name + ".js"), "utf8"), c);
const FX = c.FX, start = Date.UTC(2023, 0, 1) / 1000, end = Date.UTC(2026, 9, 26) / 1000;
function trades(pair, values) { return values.map((r, i) => ({ pair, status: "closed", signal_time: start + 86400 + (end - start - 10 * 86400) * i / values.length, exit_time: start + 172800 + (end - start - 10 * 86400) * i / values.length, r, dir: 1, fill_price: 1.1, stop0: 1 })); }
const winners = Array.from({ length: 100 }, (_, i) => i % 3 === 0 ? -1 : 1), losers = winners.map((r) => -r);
const good = FX.evaluate(trades("USDJPY", winners), start, end), bad = FX.evaluate(trades("EURUSD", losers), start, end);
assert.equal(FX.assessPair(good, false).status, "suitable");
assert.equal(FX.assessPair(good, true).status, "watch", "Seen and revised history never creates confirmed suitability");
assert.equal(FX.assessPair(bad, false).allowed, false);
assert.equal(FX.assessPair(FX.evaluate(trades("USDJPY", winners.slice(0, 12)), start, end), false).status, "few");
const unstable = FX.evaluate(trades("USDJPY", Array.from({ length: 100 }, (_, i) => i < 70 ? 1 : -1)), start, end);
assert.equal(FX.assessPair(unstable, false).allowed, false, "A positive mean cannot hide a losing later period");
const fragile = JSON.parse(JSON.stringify(good)); fragile.stress.avg_r = -.01;
assert.equal(FX.assessPair(fragile, false).allowed, false, "Double cost must stay positive");
const rows = [
  { pair: "EURUSD", name: "EUR/USD", trades: 61, avg_r: -.4 },
  { pair: "USDJPY", name: "USD/JPY", trades: 52, avg_r: .55 },
  { pair: "XAUUSD", name: "XAU/USD", trades: 44, avg_r: 1.15 },
];
const entry = { version: 1, stats: { end }, per_pair: rows };
assert.equal(FX.pairChoice(entry, "EURUSD", end + 86400).allowed, false);
assert.equal(FX.pairChoice(entry, "USDJPY", end + 86400).status, "unverified");
assert.equal(FX.pairChoice(entry, "USDJPY", end + 86400).allowed, true);
assert.equal(FX.pairChoice(entry, "XAUUSD", end + 86400).allowed, true);
assert.equal(FX.pairChoice(entry, "USDJPY", end + 100 * 86400).allowed, false, "Old price history requires another test");
assert.equal(FX.pairChoice(entry, "AUDUSD", end + 86400).allowed, false);
const reviewed = { ...entry, pair_review: { schema: 1, version: 1, data_end: end }, per_pair: [{ pair: "EURUSD", review: bad, assessment: FX.assessPair(bad, false) }, { pair: "USDJPY", review: good, assessment: FX.assessPair(good, false) }] };
assert.equal(FX.pairChoice(reviewed, "USDJPY", end + 86400).status, "suitable");
assert.equal(FX.pairChoice(reviewed, "EURUSD", end + 86400).allowed, false);
const cross = trades("USDJPY", [100])[0]; cross.signal_time = good.cutoff - 86400; cross.exit_time = good.cutoff + 86400;
const report = FX.evaluate([cross], start, end);
assert.equal(report.training.trades, 0); assert.equal(report.holdout.trades, 0, "Trades crossing the split are excluded from both periods");

// „Силна“ иска и 30 сделки след замразяването на правилата.
const strongRow = { pair: "USDJPY", name: "USD/JPY", trades: 80, avg_r: .3, verdict: "good" };
const strongEntry = { version: 1, stats: { end }, per_pair: [strongRow] };
assert.equal(FX.rowVerdict(strongRow), "tested", "A historical strong rating waits for trades after the test");
assert.equal(FX.pairChoice(strongEntry, "USDJPY", end + 86400).allowed, true, "Waiting for confirmation does not hide the signals");
assert.equal(FX.pairChoice(strongEntry, "USDJPY", end + 86400).label, "Силна в теста");
const afterTest = (values) => values.map((r, i) => ({ pair: "USDJPY", status: "closed", signal_time: end + 3600 * (i + 1), exit_time: end + 3600 * (i + 2), r }));
FX.addForward(strongEntry, [...afterTest(Array(29).fill(.4)), { pair: "USDJPY", status: "closed", signal_time: end - 3600, r: 5 }], end);
assert.equal(strongRow.forward.trades, 29, "Only trades after the frozen point count");
assert.equal(FX.rowVerdict(strongRow), "tested");
FX.addForward(strongEntry, afterTest(Array(30).fill(.4)), end);
assert.equal(FX.rowVerdict(strongRow), "good", "Thirty positive trades after the test confirm the rating");
assert.equal(FX.pairChoice(strongEntry, "USDJPY", end + 86400).label, "Силна");
FX.addForward(strongEntry, afterTest(Array(30).fill(.1)), end);
assert.equal(FX.rowVerdict(strongRow), "weak", "Much weaker results after the test are not strong");
assert.equal(FX.pairChoice(strongEntry, "USDJPY", end + 86400).allowed, false);
FX.addForward(strongEntry, afterTest(Array(30).fill(-.2)), end);
assert.equal(FX.rowVerdict(strongRow), "bad");
assert.equal(FX.pairChoice(strongEntry, "USDJPY", end + 86400).label, "Не се потвърди");
assert.equal(FX.frozenAt({ frozen_at: 5, pair_review: { data_end: 9 } }), 5, "The first freeze point is kept on later tests");
console.log("OK: strategy/timeframe/pair selection, user's table, insufficient data, losing later period, higher costs, stale history, diagnostic-only revisions and confirmation after the test");
