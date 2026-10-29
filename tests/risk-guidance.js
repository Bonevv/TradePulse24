"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const local = new Map();
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, { innerHTML: "", textContent: "", hidden: false,
    contains: () => false, querySelector: () => null, querySelectorAll: () => [], children: [], classList: { add() {}, remove() {}, toggle() {} }, focus() {}, setAttribute() {}, removeAttribute() {} });
  return elements.get(id);
}
const context = {
  console, Date, Intl, Math, Map, Set, Number, Object, String, Array, Boolean, JSON,
  setTimeout: () => 1, clearTimeout() {},
  localStorage: { getItem: (key) => local.get(key) || null, setItem: (key, value) => local.set(key, value) },
  location: { hash: "#/strategies" },
  document: { getElementById: element, querySelectorAll: () => [], addEventListener() {}, activeElement: null },
  addEventListener() {}, scrollTo() {},
  fetch: async (url) => {
    const p = path.resolve(root, String(url).split("?")[0]);
    if (!p.startsWith(root + path.sep) || !fs.existsSync(p)) return { ok: false };
    return { ok: true, json: async () => JSON.parse(fs.readFileSync(p, "utf8")) };
  },
};
context.self = context.window = context;
const sb = vm.createContext(context);
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
for (const [, name] of html.matchAll(/<script src="([^"]+)" defer><\/script>/g)) {
  const file = name.split("?")[0];
  if (file === "assets/js/lab.js") continue;
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), sb, { filename: file });
}
const evaluate = (expr) => vm.runInContext(expr, sb);
function fixture(key, dir, entry, stop, targets, options = {}) {
  const tf = key === "gold_sentinel" ? "H4" : "M15";
  const pair = key === "gold_sentinel" ? "XAUUSD" : "EURUSD";
  return {
    id: `${key}-${tf}-${pair}-1800000000`, strategy: `${key}-${tf}`, strategy_name: key,
    status: "pending", pair, pair_name: pair, dir, style: "day", tf, tf_label: tf,
    signal_time: 1799996400, valid_until: 2100000000, why: "Примерно условие",
    orders: [{ dir, type: "stop", entry, stop, targets,
      tp1: targets[0]?.level ?? null, tp2: targets[1]?.level ?? null }], ...options,
  };
}
(async () => {
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  assert.equal(evaluate("Object.keys(S.catalog).length") >= 40, true, "strategy config catalog loaded");
  const gold = fixture("gold_sentinel", 1, 4000, 3970, [{ w: 1, level: 4030 }]);
  sb.gold = gold;
  assert.equal(evaluate("targetCells(gold.orders[0],gold)[0][1]"), null, "gold trend has no fixed TP, even if the broker-model level exists");
  assert.equal(evaluate("fixedTargets(gold,gold.orders[0])"), false);
  assert.equal(evaluate("riskLandmarks(gold.pair,gold.orders[0],gold).one"), 4030);
  assert.equal(evaluate("riskLandmarks(gold.pair,gold.orders[0],gold).two"), 4060);

  const bb = fixture("bb_rsi", -1, 1.3, 1.303, [{ w: .5, level: 1.295 }, { w: .5, level: 1.290 }]);
  sb.bb = bb;
  assert.equal(evaluate("targetCells(bb.orders[0],bb)[0][1]"), null, "BB RSI candle exit is conditional");
  assert.equal(evaluate("targetCells(bb.orders[0],bb)[1][1]"), null, "BB RSI moving target is conditional");
  assert.equal(evaluate("riskLandmarks(bb.pair,bb.orders[0],bb).one"), 1.297);
  assert.equal(evaluate("riskLandmarks(bb.pair,bb.orders[0],bb).two"), 1.294);

  const fixed = fixture("adx_pullback", 1, 1.1, 1.098, [{ w: 1, level: 1.104 }]);
  sb.fixed = fixed;
  assert.equal(evaluate("fixedTargets(fixed,fixed.orders[0])"), true, "2R target still executable");
  assert.equal(evaluate("targetCells(fixed.orders[0],fixed)[0][1]"), 1.104);
  assert.equal(evaluate("riskLandmarks('EURUSD',{dir:1,entry:1.1,stop:1.101})"), null, "reject stop on wrong side");
  assert.equal(evaluate("riskLandmarks('EURUSD',{dir:-1,entry:1.1,stop:1.099})"), null, "reject stop on wrong side for sell");

  const open = { ...gold, status: "open", dir: 1, entry: 3998, stop0: 3972, stop: 4001,
    fill_price: 4002, fill_time: 1800000020, parts: [{ w: 1, tp: 4500 }] };
  sb.open = open;
  assert.equal(evaluate("riskLandmarks(open.pair,ordersOf(open)[0],open).one"), 4032, "actual model fill sets R levels");
  assert.equal(evaluate("targetCells(ordersOf(open)[0],open)[0][1]"), null, "floating target isn't broker TP");

  sb.testSignals = [gold, bb, fixed, open];
  evaluate("S.data.signals = testSignals; S.meta = { quotes: { EURUSD: { time: Date.now()/1000 }, XAUUSD: { time: Date.now()/1000 } } }");
  const goldHtml = evaluate("viewSignal(gold.id)");
  assert.ok(goldHtml.includes("по правило") && goldHtml.includes("+1R") && goldHtml.includes("+2R"));
  assert.ok(goldHtml.includes("Не са Take Profit поръчки"));
  assert.ok(goldHtml.includes("Плаващ") || goldHtml.includes("плаващ"));
  const bbHtml = evaluate("viewSignal(bb.id)");
  assert.ok(bbHtml.includes("по правило") && bbHtml.includes("Bollinger"));
  const fixedHtml = evaluate("viewSignal(fixed.id)");
  assert.ok(fixedHtml.includes("1.10400") && fixedHtml.includes("+1R"));
  const openSteps = evaluate("stepsFor(open)");
  assert.ok(JSON.stringify(openSteps).includes("Провери новия стоп"), "changed stop is called out");
  assert.ok(!JSON.stringify(openSteps).includes("Затвори половината"), "no invented half-close on trail follower");
  const plan = evaluate("planText(bb)");
  assert.ok(plan.includes("Ориентири: +1R") && plan.includes("НЕ са допълнителни Take Profit"));
  sb.delayed = { ...fixed, orders: fixed.orders.map((o) => ({ ...o, activate_after: Date.now() / 1000 + 1800 })) };
  assert.ok(evaluate("planText(delayed)").includes("Активиране от"));
  assert.ok(JSON.stringify(evaluate("stepsFor(delayed)")).includes("Изчакай активирането"));
  console.log("OK: buy/sell R levels, conditional targets, live rule, stop changes, copy plan, invalid stops");
})().catch((e) => { console.error(e); process.exitCode = 1; });
