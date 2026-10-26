"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const store = new Map(), elements = new Map();
const element = (id) => {
  if (!elements.has(id)) elements.set(id, { innerHTML: "", textContent: "", hidden: false, classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, removeAttribute() {}, contains() { return false; } });
  return elements.get(id);
};
const context = { console, Date, Math, Intl, Map, Set, JSON, Number, Array, Object, String, Boolean, URL,
  setTimeout: () => 1, clearTimeout() {}, setInterval() {}, clearInterval() {},
  localStorage: { getItem: (key) => store.get(key) || null, setItem: (key, value) => store.set(key, value) }, sessionStorage: { getItem: () => null },
  document: { getElementById: element, querySelectorAll: () => [], addEventListener() {}, activeElement: null }, location: { hash: "#/strategies" }, addEventListener() {},
  fetch: async (url) => { const file = path.join(root, String(url).split("?")[0]); return { ok: fs.existsSync(file), json: async () => JSON.parse(fs.readFileSync(file, "utf8")) }; } };
context.self = context; context.window = context;
const sandbox = vm.createContext(context);
for (const [, file] of fs.readFileSync(path.join(root, "index.html"), "utf8").matchAll(/<script src="([^"]+)" defer><\/script>/g)) {
  vm.runInContext(fs.readFileSync(path.join(root, file.split("?")[0]), "utf8"), sandbox, { filename: file });
}
const run = (code) => vm.runInContext(code, sandbox);
(async () => {
  await new Promise(setImmediate); await new Promise(setImmediate);
  const originalFetch = context.fetch;
  context.fetch = async (url) => String(url).startsWith("data/meta.json") ? { ok: true, json: async () => ({ quotes: [], updated: Date.now()/1000 }) }
    : String(url).startsWith("data/recent.json") ? { ok: true, json: async () => ({ prices: {} }) } : originalFetch(url);
  await run("load()");
  assert.ok(run("S.error").includes("Липсват текущи цени"), "cron output without successful quotes remains offline");
  assert.equal(run("S.data.signals.length"), 0);
  context.fetch = originalFetch;
  assert.equal(run('clean({ ...DEFAULTS, style: "all" }).style'), "day", "old combined selection migrates to day");
  assert.equal(run('styleOk("swing")'), false);
  assert.ok(run('viewStrategies()').includes("дневна търговия"));
  assert.ok(!run('viewStrategies()').includes('data-stratfilter="swing"'));
  const dashboard = run('viewDashboard()');
  for (const [, id] of dashboard.matchAll(/href="#\/strategy\/([^"]+)"/g)) assert.equal(run(`stratById(${JSON.stringify(id)}).style`), "day", "dashboard respects selected trading style");
  assert.doesNotThrow(() => run('newsCompact({id:"test",time:Date.now()/1000+3600,currency:"CAD",title_bg:"Новина",explain:"Пример"})'));
  run('S.settings.style = "swing"');
  assert.ok(run('labVariants().every((v) => ["H4", "D1"].includes(v.tf))'));
  assert.equal(run('newForm().tfs[0]'), "H4");
  assert.throws(() => run('FX.build({...newForm(), when:[{a:{ind:"ema",p:[20],shift:-1},op:">",b:0}]})'));
  assert.throws(() => run('FX.build({...newForm(), when:[{a:{ind:"ema",p:[0]},op:">",b:0}]})'));
  assert.throws(() => run('FX.build({...newForm(), exit:{parts:[[.5,2]]}})'));
  const count = run('Object.keys(S.catalog).length');
  run('LAB.custom = [{...newForm(), key: "my_private", name: "Лична чернова", version: 1}]; LAB.authed = true');
  assert.equal(run('labCatalog().my_private.name'), "Лична чернова");
  assert.equal(run('Object.keys(S.catalog).length'), count, "draft rules do not enter live catalog");
  run('labOnMessage({data:{type:"result",id:"my_private-H4",entry:{stats:{verdict:"good"}},done:1,total:1}})');
  assert.equal(run('LAB.published.has("my_private-H4")'), false, "good test never auto-publishes");
  assert.ok(run('viewLab("mine")').includes("Мои стратегии"));
  const guide = run('FX.translateNews("BOC Monetary Policy Report")[1]');
  assert.ok(guide.includes("Канада") && guide.includes("очакванията"));
  assert.ok(run('FX.newsGuide("Core CPI m/m").watch').includes("автоматично"));
  assert.ok(run('FX.newsGuide("Unemployment Rate").explain').includes("пазара на труда"));
  assert.ok(run('FX.RESEARCH.every((s) => s.tfs.every((tf) => ["M15","H1","H4","D1"].includes(tf)))'));

  assert.ok(run('viewNews()').includes("Защо следим новините"));
  const timestamp = Date.now() / 1000;
  sandbox.fixture = Array.from({ length: 3 }, (_, i) => ({ id: "t" + i, pair: "EURUSD", style: i === 2 ? "swing" : "day", currency: "USD", dir: 1,
    status: i === 2 ? "open" : "closed", risk: 10, risk_pct: 0.5, net: i === 0 ? -10 : 20, opened: timestamp - 3000, closed: timestamp - 100, tag: "plan", note: "" }));
  const stats = run('RiskJournal.stats(fixture)');
  assert.equal(stats.daily, 0.5, "a win does not replenish loss budget");
  assert.equal(stats.openRisk, 0.5); assert.equal(stats.averageR, 0.5); assert.equal(stats.worstStreak, 1);
  assert.throws(() => run('RiskJournal.validate({...fixture[0], risk: 0})'));
  assert.throws(() => run('RiskJournal.validate({...fixture[0], closed: fixture[0].opened - 1})'));
  run('saveJournal(fixture)');
  const previous = store.get("tradepulse24-journal-v1");
  const setter = context.localStorage.setItem;
  context.localStorage.setItem = () => { throw new Error("quota"); };
  assert.throws(() => run('saveJournal([])'));
  assert.equal(run('JOURNAL.trades.length'), 3, "failed storage write preserves in-memory history");
  context.localStorage.setItem = setter;
  assert.equal(store.get("tradepulse24-journal-v1"), previous);
  console.log("OK: two trading styles, private drafts, explicit publishing, news explanations, risk budgets and journal integrity");
})().catch((error) => { console.error(error); process.exitCode = 1; });
