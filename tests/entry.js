"use strict";
const assert = require("node:assert/strict");
const { loadFX } = require("./helpers"), { FX } = loadFX();
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-3, `${message}: ${actual} != ${expected}`);

// Коя поръчка влиза на дадено ниво спрямо текущата цена.
assert.equal(FX.orderFor(1, 1.085, 1.084), "buy_stop");
assert.equal(FX.orderFor(1, 1.085, 1.086), "buy_limit");
assert.equal(FX.orderFor(-1, 1.085, 1.086), "sell_stop");
assert.equal(FX.orderFor(-1, 1.085, 1.084), "sell_limit");
assert.equal(FX.orderFor(1, 1.085, 1.085), "buy", "at the price it is a market order");
assert.equal(FX.orderKind(-1, "limit"), "sell_limit");
assert.equal(FX.orderKind(1, "market"), "buy");

// Отворен модел: покупка 1.0850, стоп 1.0835 (1R = 15 пипса), цел 1.0880.
const buy = { dir: 1, entry: 1.085, stop: 1.0835, stop0: 1.0835, half: false, targets: [1.088] };
const advice = (price, opts) => FX.entryAdvice(buy, price, FX.entryLevels(null), opts);
assert.equal(advice(1.0851).advice, "enter");
assert.equal(advice(1.0856).advice, "wait", "+0.4R waits for a pullback");
assert.equal(advice(1.0856).kind, "buy_limit", "a pullback entry for a buy is a Buy Limit");
near(advice(1.0856).level, 1.085225, "wait level is +0.15R");
assert.equal(advice(1.08575).advice, "late", "+0.5R is late");
assert.equal(advice(1.0881).reason, "target", "past the target is late");
assert.equal(advice(1.0843).advice, "against");
assert.equal(advice(1.0843).kind, "buy_stop", "re-entry after a drawdown is a Buy Stop at the model entry");
assert.equal(advice(1.0838).advice, "too_close");
assert.equal(advice(1.0835).advice, "stopped");
assert.equal(advice(1.0851, { minutesLeft: 30 }).reason, "time", "little time before the day close");
assert.equal(FX.entryAdvice({ ...buy, half: true }, 1.0851).reason, "part");
assert.equal(FX.entryAdvice({ ...buy, stop: 1.0852 }, 1.0858).reason, "stop_moved");
const sell = { dir: -1, entry: 1.085, stop: 1.0865, stop0: 1.0865, half: false, targets: [1.082] };
assert.equal(FX.entryAdvice(sell, 1.0844).kind, "sell_limit");
assert.equal(FX.entryAdvice(sell, 1.0857).kind, "sell_stop");

// Чакащ модел.
const pending = { dir: 1, type: "stop", entry: 1.085, stop: 1.0835, targets: [{ w: 1, level: 1.088 }] };
assert.equal(FX.pendingAdvice(pending, 1.084).advice, "place");
assert.equal(FX.pendingAdvice(pending, 1.084).kind, "buy_stop");
assert.equal(FX.pendingAdvice(pending, 1.0849).near, true);
assert.equal(FX.pendingAdvice(pending, 1.0856).advice, "wait", "the broker can be ahead of the site data");
assert.equal(FX.pendingAdvice(pending, 1.083).advice, "void");
assert.equal(FX.pendingAdvice({ ...pending, type: "limit" }, 1.086).kind, "buy_limit");

// Праговете от историята.
assert.deepEqual(FX.entryLevels(null), { ok: .15, late: .5, measured: false });
const measured = FX.entryLevels({ n: 100, base: .3, late: [{ k: .1, n: 90, r: .25 }, { k: .25, n: 80, r: .16 }, { k: .5, n: 60, r: .05 }, { k: .75, n: 40, r: -.1 }] });
assert.equal(measured.ok, .25); assert.equal(measured.late, .75); assert.equal(measured.measured, true);
assert.equal(FX.entryLevels({ n: 100, base: .3, late: [{ k: .1, n: 90, r: -.05 }] }).ok, .05, "if even a small delay loses, only the entry itself is fine");

// Измерване по пътя на сделките: резултатите са сметнати на ръка.
const t0 = 1800000000, t1 = t0 + 86400;
const rows = [
  [t0, 1.0998, 1.1001, 1.0997, 1.1], [t0 + 900, 1.1001, 1.1004, 1.1001, 1.1003], [t0 + 1800, 1.1003, 1.1006, 1.1002, 1.1004],
  [t0 + 2700, 1.1003, 1.1004, 1.0999, 1.1001], [t0 + 3600, 1.1001, 1.102, 1.1001, 1.1019], [t0 + 4500, 1.1019, 1.102, 1.1018, 1.1019],
  [t1, 1.0998, 1.1001, 1.0997, 1.1], [t1 + 900, 1.0999, 1.1, 1.0996, 1.0996], [t1 + 1800, 1.0995, 1.0996, 1.0989, 1.099], [t1 + 2700, 1.099, 1.0992, 1.0988, 1.099],
];
const bars = { tf: "M15", sec: 900, n: rows.length, t: rows.map((b) => b[0]), o: rows.map((b) => b[1]), h: rows.map((b) => b[2]), l: rows.map((b) => b[3]), c: rows.map((b) => b[4]) };
const trades = [
  { pair: "EURUSD", status: "closed", dir: 1, fill_price: 1.1, stop0: 1.099, fill_time: t0, exit_time: t0 + 4500, r: 2, reason: "tp" },
  { pair: "EURUSD", status: "closed", dir: 1, fill_price: 1.1, stop0: 1.099, fill_time: t1, exit_time: t1 + 2700, r: -1, reason: "sl" },
  { pair: "EURUSD", status: "closed", dir: 1, fill_price: 1.1, stop0: 1.099, fill_time: t0 - 864000, exit_time: t0 - 860000, r: 5, reason: "tp" },
];
const timing = FX.entryTiming(trades, () => bars).EURUSD;
assert.equal(timing.n, 2, "a trade outside the detailed history is not counted");
near(timing.base, .5, "average at the model entry");
near(timing.late[0].r, 1.9 / 1.1, "+0.1R later: (r − k) / (1 + k)");
near(timing.late[1].r, 1.75 / 1.25, "+0.25R later");
near(timing.late[2].r, 1, "+0.5R later");
near(timing.late[3].r, 1.25 / 1.75, "+0.75R later");
assert.ok(timing.late.every((row) => row.n === 1), "the losing trade never went in favour");
assert.ok(timing.early.every((row) => row.n === 1 && row.r === -1 && row.sl === 1), "entering nearer the stop of a stopped trade still loses 1R");
assert.deepEqual(timing.back.map((row) => [row.k, row.j, row.p]), [[.25, 0, 1], [.25, .1, 1], [.5, 0, 1], [.5, .1, 1]], "the winner returned to the entry");
near(timing.back[0].r, 2, "a limit at the model entry gets the model result");
assert.equal(timing.recover[0].p, 0, "the stopped trade never came back");

// Записан резултат за същата версия получава измерването от каталога.
const bundled = { entries: { "x-H1": { id: "x-H1", key: "x", tf: "H1", version: 1, stats: { end: 10 }, per_pair: [{ pair: "EURUSD", timing }] } } };
const saved = { entries: { "x-H1": { id: "x-H1", key: "x", tf: "H1", version: 1, stats: { end: 20 }, per_pair: [{ pair: "EURUSD" }] } } };
assert.ok(FX.mergeResults(saved, bundled, {}).entries["x-H1"].per_pair[0].timing, "same rules keep the measurement");
saved.entries["x-H1"].version = 2;
assert.equal(FX.mergeResults(saved, bundled, {}).entries["x-H1"].per_pair[0].timing, undefined, "new rules need a new measurement");

// Картата на сигнала.
const card = FX.signalTools.entryState({ pair: "EURUSD", status: "open", dir: 1, fill_price: 1.1, stop0: 1.09 }, 1.1035, 100, true);
assert.equal(card.state, "passed"); assert.equal(card.advice, "wait"); assert.equal(card.label, "Изчакай връщане до 1.10150");
assert.equal(FX.signalTools.entryState({ pair: "EURUSD", status: "open", dir: 1, fill_price: 1.1, stop0: 1.09 }, 1.096, 100, true).state, "against");
console.log("OK: order types by price, enter/wait/late/against advice, pending orders, measured thresholds, late-entry history and catalog merge");
