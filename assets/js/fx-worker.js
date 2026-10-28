/* Лабораторията тества стратегиите тук - в отделна нишка, за да не замръзва страницата. */
importScripts("fx-core.js", "fx-indicators.js", "fx-series.js", "fx-backtest.js", "fx-strategies.js", "fx-builder.js", "fx-library.js", "fx-candidates.js", "fx-book-candidates.js", "fx-revisions.js", "fx-evaluation.js", "fx-engine.js");

let engine = null;
let catalog = {};

function buildCatalog(custom) {
  catalog = {};
  for (const s of FX.CODED.concat(FX.LIBRARY, FX.RESEARCH || [])) catalog[s.key] = s;
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
        if (entry && (strat.origin === "custom" || strat.origin === "research")) {
          const cutoff = Math.floor(res.start + 0.7 * (res.end - res.start));
          const training = FX.bt.summarize(res.trades.filter((t) => t.status === "closed" && t.exit_time < cutoff), res.start, cutoff);
          const holdout = FX.bt.summarize(res.trades.filter((t) => t.status === "closed" && t.signal_time >= cutoff), cutoff, res.end);
          const chronological = training.trades >= 30 && holdout.trades >= 30 && training.avg_r > 0 && holdout.avg_r >= 0.08 && (holdout.profit_factor === null || holdout.profit_factor >= 1.15);
          const passed = chronological && !strat.provisional;
          entry.validation = { cutoff, training, holdout, passed, chronological };
          entry.version = strat.version || strat.spec?.version || 1;
          if (strat.provisional) entry.validation.note = "Историята вече е разглеждана. Това е диагностичен период; за потвърждение трябват неизползвани данни или наблюдение занапред.";
          if (entry.stats.verdict === "good" && !passed) { entry.stats.verdict = "weak"; entry.stats.verdict_label = "Слаба"; entry.validation.note = "Общият тест е положителен, но отделният период още не потвърждава оценка „Силна“."; }
        }
        if (entry) {
          FX.reviewEntry(entry, strat, res, engine.now);
          if (strat.parent_key) {
            const parent = catalog[strat.parent_key], original = engine.trades(parent, tf);
            entry.parent_key = strat.parent_key;
            entry.changes = strat.changes;
            entry.hypothesis = strat.hypothesis;
            entry.comparison = { id: `${parent.key}-${tf}`, name: parent.name, original: FX.evaluate(original.trades, original.start, original.end),
              per_pair: (parent.pairs || FX.PAIR_KEYS).map((pair) => ({ pair, review: FX.evaluate(original.trades.filter((t) => t.pair === pair), original.start, original.end) })) };
          }
        }
        postMessage({ type: "result", id: `${key}-${tf}`, entry, ms: Date.now() - t0, done: k, total: m.items.length });
      }
      postMessage({ type: "done" });
    }
  } catch (e) {
    postMessage({ type: "error", text: e && e.stack ? e.stack : String(e) });
  }
};
