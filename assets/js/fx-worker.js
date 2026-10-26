/* Лабораторията тества стратегиите тук - в отделна нишка, за да не замръзва страницата. */
importScripts("fx-core.js", "fx-indicators.js", "fx-series.js", "fx-backtest.js", "fx-strategies.js", "fx-builder.js", "fx-library.js", "fx-engine.js");

let engine = null;
let catalog = {};

function buildCatalog(custom) {
  catalog = {};
  for (const s of FX.CODED.concat(FX.LIBRARY)) catalog[s.key] = s;
  for (const spec of custom || []) {
    try {
      catalog[spec.key] = FX.build(Object.assign({ origin: "custom", group: "Мои стратегии", source: "Твоя стратегия" }, spec));
    } catch (e) {
      postMessage({ type: "warn", text: `Стратегията „${spec.name}“ има грешка: ${e.message}` });
    }
  }
}

onmessage = (ev) => {
  const m = ev.data;
  try {
    if (m.cmd === "load") {
      const t0 = Date.now();
      engine = new FX.Engine(m.prices, m.quotes || {}, { launch: m.launch || 0 }).build(m.now);
      buildCatalog(m.custom);
      postMessage({ type: "loaded", ms: Date.now() - t0 });
    } else if (m.cmd === "custom") {
      buildCatalog(m.custom);
      postMessage({ type: "custom_ok" });
    } else if (m.cmd === "run") {
      let k = 0;
      for (const { key, tf } of m.items) {
        k++;
        const strat = catalog[key];
        if (!strat) { postMessage({ type: "warn", text: `Няма стратегия ${key}` }); continue; }
        const t0 = Date.now();
        const res = engine.trades(strat, tf);
        const entry = res.start ? engine.entry(strat, tf, res) : null;
        postMessage({ type: "result", id: `${key}-${tf}`, entry, ms: Date.now() - t0, done: k, total: m.items.length });
      }
      postMessage({ type: "done" });
    }
  } catch (e) {
    postMessage({ type: "error", text: e && e.stack ? e.stack : String(e) });
  }
};
