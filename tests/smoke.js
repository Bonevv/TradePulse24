"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const local = new Map();
const localStorage = { getItem: (k) => local.get(k) || null, setItem: (k, v) => local.set(k, v), removeItem: (k) => local.delete(k) };
const elems = new Map();
function el(id) {
  if (!elems.has(id)) elems.set(id, { innerHTML: "", textContent: "", hidden: false, value: "", clientWidth: 700,
    contains: () => false, classList: { add() {}, remove() {}, toggle() {} }, focus() {}, setAttribute() {}, removeAttribute() {} });
  return elems.get(id);
}
const ctx = {
  console, Date, Intl, Math, URL, Map, Set, Number, Object, String, Array, Boolean, JSON,
  setTimeout: () => 1, clearTimeout() {}, setInterval() {}, clearInterval() {},
  localStorage,
  location: { hash: "#/strategies" },
  document: { activeElement: null, getElementById: el, querySelectorAll: () => [], addEventListener() {} },
  addEventListener() {}, scrollTo() {},
  fetch: async (url) => {
    const name = String(url).split("?")[0];
    const file = path.join(root, name);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return { ok: false };
    return { ok: true, json: async () => JSON.parse(fs.readFileSync(file, "utf8")) };
  },
};
ctx.window = ctx;
ctx.self = ctx;
const sandbox = vm.createContext(ctx);
function run(file) { vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), sandbox, { filename: file }); }
const scripts = fs.readFileSync(path.join(root, "index.html"), "utf8")
  .matchAll(/<script src="([^"]+)" defer><\/script>/g);
for (const s of scripts) {
  const file = s[1].split("?")[0];
  if (file !== "assets/js/lab.js") run(file);
}
(async () => {
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  assert.equal(vm.runInContext("S.data.ready", sandbox), true, "catalog works without cron metadata");
  assert.equal(vm.runInContext("strategies().length", sandbox), 93, "all 93 tested variants available");
  const html = el("main").innerHTML;
  assert.ok(html.includes("Силна") && html.includes("Не работи"), "rankings shown");
  assert.ok(!html.includes("От сайтове") && !html.includes("От книги"), "no provenance filters");
  assert.ok(html.includes("data-follow="), "strategy select buttons available");

  const id = "demo-H1-EURUSD-1730000000";
  const sig = { id, strategy: "example-H1", strategy_name: "Пример", style: "day", pair: "EURUSD", pair_name: "EUR/USD", tf: "H1", tf_label: "1 час", status: "pending", signal_time: 1730000000,
    valid_until: 2030000000, orders: [{ dir: 1, entry: 1.10, stop: 1.098, tp1: 1.102, tp2: 1.104, type: "stop", targets: [{ w: .5, tp: 1.102 }, { w: .5, tp: 1.104 }] }], why: "Тест" };
  // The browser has one runtime. Inject the fixture into its existing context.
  sandbox.globalTestSignal = sig;
  vm.runInContext("S.data.signals = [globalTestSignal]; S.meta = { quotes: { EURUSD: { time: Date.now()/1000 } } };", sandbox);
  const detail = vm.runInContext("viewSignal('demo-H1-EURUSD-1730000000')", sandbox);
  assert.ok(detail.includes("Следи сигнала"), "single-signal watch button");
  assert.ok(vm.runInContext("S.watch.add(globalTestSignal)", sandbox));
  assert.equal(vm.runInContext("S.watch.list().length", sandbox), 1);
  vm.runInContext("location.hash = '#/watch'; render()", sandbox);
  assert.ok(el("main").innerHTML.includes("Следени сигнали"));
  assert.ok(el("main").innerHTML.includes("Премахни от следените"));

  const open = { ...sig, status: "open", dir: 1, entry: 1.10, stop: 1.098, stop0: 1.098, fill_price: 1.10, fill_time: 1730005000 };
  sandbox.globalOpen = open;
  assert.equal(vm.runInContext("S.watch.ingest([globalOpen]).length", sandbox), 1);
  assert.equal(vm.runInContext("S.watch.get(globalOpen.id).state", sandbox), "open");
  const target1 = { ...open, half: true, tp1_time: 1730006000, stop: 1.10 };
  sandbox.globalTarget = target1;
  assert.equal(vm.runInContext("S.watch.ingest([globalTarget]).length", sandbox), 1);
  const closed = { ...target1, status: "closed", r: 1.2, reason: "tp2", exit_time: 1730009000 };
  sandbox.globalClosed = closed;
  assert.equal(vm.runInContext("S.watch.ingest([globalClosed]).length", sandbox), 1);
  assert.equal(vm.runInContext("S.watch.get(globalClosed.id).state", sandbox), "closed");
  assert.ok(vm.runInContext("S.watch.confirm(globalClosed.id, true, 1.1002)", sandbox));
  assert.equal(vm.runInContext("S.watch.get(globalClosed.id).actualEntry.price", sandbox), 1.1002);
  assert.equal(vm.runInContext("S.watch.ingest([]).length", sandbox), 0);
  assert.equal(vm.runInContext("S.watch.get(globalClosed.id).state", sandbox), "closed", "not silently deleted when missing");
  const originalSave = localStorage.setItem;
  localStorage.setItem = () => { throw Error("storage unavailable"); };
  assert.equal(vm.runInContext("S.watch.remove(globalClosed.id)", sandbox), false, "storage failure reported");
  assert.equal(vm.runInContext("S.watch.list().length", sandbox), 1, "storage failure does not mutate state");
  localStorage.setItem = originalSave;
  assert.ok(vm.runInContext("S.watch.remove(globalClosed.id)", sandbox));
  assert.equal(vm.runInContext("S.watch.list().length", sandbox), 0);
  console.log("OK: offline catalog (93), rating filters, single-signal tracking, transitions, confirmation, archive, removal");
})().catch((e) => { console.error(e); process.exitCode = 1; });
