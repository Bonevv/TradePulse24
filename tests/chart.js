"use strict";
const assert = require("node:assert/strict");
const { loadFX, prices } = require("./helpers"), { FX } = loadFX();
const equal = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)), message);
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);

// Същите свещи и серии, по които се смятат сигналите.
const data = prices(["EURUSD", "XAUUSD"]);
const end = data.EURUSD.M15[data.EURUSD.M15.length - 1][0] + 900;
const engine = new FX.Engine(data, {}).build(end);
const strat = (key) => FX.CODED.concat(FX.LIBRARY, FX.RESEARCH || []).find((s) => s.key === key);

// Индикаторите, които стратегията действително чете: от конструктора и от кода, включително по-старши графики.
const h1 = engine.get("EURUSD", "H1"), memo = h1.memo;
const ema = FX.chartIndicators(strat("lib_ema_9_21"), h1).map((d) => d.key);
equal(ema.filter((k) => k.includes("ema")).sort(), ["|ema|21", "|ema|9"]);
assert.ok(ema.includes("|atr|14"), "the ATR stop is recorded too");
assert.equal(h1.memo, memo, "recording does not touch the series state");
const gold = FX.chartIndicators(strat("gold_scalper"), engine.get("XAUUSD", "M15")).map((d) => d.key);
for (const key of ["|session_range|0,8", "D1|ema|50", "H1|ema|200", "|rsi|14", "H1|adx|14"]) assert.ok(gold.includes(key), `gold scalper reads ${key}`);
assert.ok(gold.indexOf("|session_range|0,8") < gold.indexOf("|rsi|14"), "lines on the price come before panels");

// Линия от по-старша графика взима последната ЗАВЪРШЕНА свещ на тази графика.
const m15 = engine.get("XAUUSD", "M15"), d1 = m15.peer("D1"), align = m15.align("D1");
const plot = FX.indicatorPlot(m15, { key: "D1|ema|50", tf: "D1", name: "ema", args: [50] });
const i = m15.n - 1;
near(plot.lines[0].values[i], d1.get("ema", 50)[align[i]], "aligned higher timeframe value");
assert.equal(plot.pane, "price"); assert.match(plot.label, /EMA 50 · 1 ден/);
const st = FX.indicatorPlot(h1, { key: "|st|10,3", tf: null, name: "st", args: [10, 3] });
assert.equal(st.lines.length, 1, "Supertrend is one line coloured by its direction");
assert.ok(st.lines[0].tone.slice(-200).every((v) => v === 1 || v === -1), "every recent point has a direction");
const macd = FX.indicatorPlot(h1, { key: "|macd|12,26,9", tf: null, name: "macd", args: [12, 26, 9] });
equal(macd.lines.map((l) => l.hist), [false, false, true]);
assert.equal(macd.pane, "osc");

// Нивата: две противоположни чакащи поръчки делят цените си, а 1R/2R не дублират фиксирана цел.
const oco = { status: "pending", orders: [] };
const orders = [
  { dir: 1, type: "stop", entry: 1.105, stop: 1.1, targets: [["Цел 1", 1.11], ["Цел 2", 1.115]] },
  { dir: -1, type: "stop", entry: 1.1, stop: 1.105, targets: [["Цел 1", 1.095], ["Цел 2", 1.09]] },
];
const levels = FX.chartLevels(oco, orders, 5);
assert.equal(levels.filter((l) => l.kind === "entry").length, 2, "both directions are shown");
assert.ok(levels.some((l) => l.label === "Вход ▲ · Buy Stop · Стоп ▼"), "shared price is one line with both labels");
assert.equal(levels.filter((l) => l.kind === "landmark").length, 0, "1R/2R equal the fixed targets here");
assert.equal(levels.length, 6);
// Отворен модел без фиксирана цел: стопът е преместен, 1R/2R остават само ориентири.
const open = { status: "open", dir: 1, fill_price: 1.1, stop0: 1.099, stop: 1.1, half: false };
const openLevels = FX.chartLevels(open, [{ dir: 1, type: "market", entry: 1.1, stop: 1.099, targets: [["Цел", null]] }], 5);
equal(openLevels.map((l) => l.kind).sort(), ["entry", "landmark", "landmark", "stop0"].sort(), "the moved stop at the entry merges into the entry line");
assert.ok(openLevels.find((l) => l.kind === "entry").label.includes("Стоп сега"));
assert.ok(!openLevels.some((l) => l.kind === "target"), "a rule-based exit is not a TP");
near(openLevels.find((l) => l.label.startsWith("+2R")).price, 1.102, "+2R");
equal(FX.chartLevels(null, []), [], "no signal, no invented levels");

// Маркерите са по свещите на графиката.
const k = h1.n - 10, sig = { status: "closed", dir: 1, signal_time: h1.t[k] + h1.sec, fill_time: h1.t[k + 1] + 900, exit_time: h1.t[k + 4] + h1.sec, r: 1.2 };
const marks = FX.chartMarkers(sig, h1);
equal(marks.map((m) => [m.kind, m.index]), [["signal", k], ["fill", k + 1], ["exit", k + 4]]);
assert.equal(FX.chartBarAt(h1, h1.t[h1.n - 1] + h1.sec + 60).after, true, "a fill in the forming candle is flagged");
const win = FX.chartWindow(h1.n, marks, 140);
assert.ok(win.from <= k && win.to >= k + 4, "the window shows the signal and its exit");
console.log("OK: recorded indicators (incl. higher timeframes), aligned lines, OCO and rule-exit levels, markers and window");
