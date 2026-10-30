"use strict";

/* Графиката с модела: TradingView Lightweight Charts™ върху същите свещи, индикатори и сигнали, по които работи сайтът.
   Библиотеката само рисува. Цените са от вече заредените JSON файлове (recent.json, meta.json): графиката не тегли нищо от Twelve Data. */

const CHART_TFS = { day: ["M15", "H1"], swing: ["H4", "D1"] };
const MC = { chart: null, host: null, key: "", state: null, ranges: {}, timeRanges: {}, hidden: {}, sel: {}, signals: new WeakMap(), indicators: new WeakMap(), preset: "", history: new Map(), loading: new Map(), historyErrors: new Map() };
const MC_COLOR = { up: "#9fe4ac", down: "#fc928e", entry: "#e8eef0", stop0: "#fc928e", stop: "#f6cd8e", target: "#9fe4ac", landmark: "#7f97a8",
  quote: "#7cc7ff", mine: "#c3aaff", signal: "#f6cd8e", grid: "#1a2530", border: "#26313e", text: "#8f9ba9", panel: "#121a24", level: "#3a4855" };
const MC_PALETTE = ["#c3aaff", "#f6cd8e", "#7cc7ff", "#ff9fd2", "#9be8e0", "#d9e6a1", "#ffb38a", "#b4c6ff"];
// Файлът се зарежда преди app.js, затова часовата зона е записана тук (същата като TZ там).
const MC_TZ = "Europe/Sofia";
const MC_FMT = {
  year: new Intl.DateTimeFormat("bg-BG", { timeZone: MC_TZ, year: "numeric" }),
  month: new Intl.DateTimeFormat("bg-BG", { timeZone: MC_TZ, month: "long" }),
  day: new Intl.DateTimeFormat("bg-BG", { timeZone: MC_TZ, weekday: "short", day: "numeric", month: "short", year: "numeric" }),
};
const MC_NOTICE = "TradingView Lightweight Charts™ · Copyright (с) 2025 TradingView, Inc.";

/* ------------------------------------------------------------ вид на графиката */

// Под тази ширина „Автоматично“ показва опростената графика (телефон).
const CHART_PHONE_WIDTH = 760;
const CHART_LIBRARY = "assets/vendor/lightweight-charts/lightweight-charts.standalone.production.js?v=5.2.1";

/** "interactive" (TradingView) или "simple" (леко изображение) според настройката и ширината на екрана. */
function chartMode() {
  const mode = S.settings.chartMode || "auto";
  if (mode === "interactive" || mode === "simple") return mode;
  return (window.innerWidth || 1000) < CHART_PHONE_WIDTH ? "simple" : "interactive";
}

/** Библиотеката се тегли само когато е нужна интерактивна графика. Липсващ файл не спира сайта. */
function loadChartLibrary() {
  if (window.LightweightCharts?.createChart) { MC.lib = "ready"; return; }
  if (MC.lib === "loading" || MC.lib === "failed") return;
  MC.lib = "loading";
  const script = document.createElement("script");
  script.src = CHART_LIBRARY; script.async = true; script.setAttribute("data-optional", "");
  script.onload = () => { MC.lib = window.LightweightCharts?.createChart ? "ready" : "failed"; mountModelChart(); };
  script.onerror = () => { MC.lib = "failed"; mountModelChart(); };
  document.head.append(script);
}

function chartSettings() {
  const mode = S.settings.chartMode || "auto", now = chartMode() === "simple" ? "опростена" : "интерактивна";
  const option = (value, title, note) => `<label><input type="radio" name="chartMode" value="${value}" ${mode === value ? "checked" : ""}><span>${title}<em>${note}</em></span></label>`;
  return `<section class="panel chart-settings" id="chart-settings"><p class="kicker">ИЗГЛЕД</p><h3>Графики</h3>
    <div class="choice choice-stack" role="radiogroup" aria-label="Вид на графиките">
      ${option("auto", "Автоматично", "на телефон опростена, на компютър интерактивна")}
      ${option("interactive", "Винаги интерактивна", "TradingView: индикатори, местене, увеличаване")}
      ${option("simple", "Винаги опростена", "леко изображение с нивата, без индикатори")}
    </div>
    <p class="what">Сега на този екран: <strong>${now}</strong>. Промяната се запазва веднага и важи само за този браузър. Нивата и сигналите са едни и същи и в двата вида.</p></section>`;
}

/* ------------------------------------------------------------ избор */

/** Вариантите (стратегия + графика) за инструмента в избрания стил, подредени по оценката за него. */
function chartVariants(pair) {
  const tfs = CHART_TFS[S.settings.style] || CHART_TFS.day;
  return sortedStrategies(pair).filter((e) => !e.retired && e.style === S.settings.style && tfs.includes(e.tf)
    && (e.pairs || FX.PAIR_KEYS).includes(pair) && S.catalog?.[e.key]?.tfs?.includes(e.tf));
}

function chartEngine(pair) {
  const loaded = MC.history.get(pair);
  if (!loaded || loaded.source !== S.engine) return S.engine;
  return loaded.engine;
}

/** Зарежда вече записаната история само за избрания инструмент. Няма заявка към доставчика. */
async function loadChartHistory(pair) {
  if (!FX.PAIR_KEYS.includes(pair) || MC.loading.has(pair)) return;
  const source = S.engine;
  if (MC.state?.pair === pair && MC.state.sig) chartSel(MC.state.ctx).signal = MC.state.sig.id;
  const job = (async () => {
    try {
      const prices = {};
      await Promise.all(["M15", "H1", "D1"].map(async (tf) => {
        const file = await getJSON(`data/prices/${pair}_${tf}.json`, null);
        prices[tf] = Array.isArray(file?.bars) ? file.bars : [];
      }));
      if (!Object.values(prices).some((bars) => bars.length > 120)) throw new Error("Няма достатъчно записана история за този инструмент.");
      if (source !== S.engine) return;
      const keepIds = [...S.watch.list().map((watch) => watch.id), ...S.observed.list().map((record) => record.id)];
      const engine = new FX.Engine({ [pair]: prices }, S.meta?.quotes || {}, { costs: S.costProfile, keepIds }).build(now());
      MC.history.set(pair, { source, engine }); MC.historyErrors.delete(pair);
      if (MC.history.size > 3) MC.history.delete(MC.history.keys().next().value);
    } catch (error) { MC.historyErrors.set(pair, error.message || "Историята не можа да се прочете."); }
    finally { MC.loading.delete(pair); if (MC.state?.pair === pair) refreshModelChart(); }
  })();
  MC.loading.set(pair, job); refreshModelChart();
  await job;
}

function focusChartSignal(id) {
  const signal = resolveSignal(id), panel = document.getElementById("mc-panel");
  if (!signal) return;
  if (!panel || panel.dataset.mcSignalId || panel.dataset.mcFixed && panel.dataset.mcFixed !== signal.pair) {
    location.hash = `#/signal/${encodeURIComponent(id)}`; return;
  }
  const sel = chartSel(panel.dataset.mcCtx);
  Object.assign(sel, { pair: signal.pair, id: signal.strategy, tf: signal.tf, signal: signal.id, picked: true });
  refreshModelChart(); document.getElementById("mc-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function chartCache(store, engine = S.engine) {
  if (!engine) return null;
  let cache = store.get(engine);
  if (!cache) store.set(engine, (cache = new Map()));
  return cache;
}

/** Сигналите на варианта за инструмента. Ако сайтът не е пускал варианта (не е публикуван и не го следваш),
    се изчисляват сега със същия модел и същите свещи. Резултатът се пази до следващото зареждане на данните. */
function chartSignals(entry, pair) {
  if (!entry) return [];
  const listed = (S.data?.signals || []).filter((s) => s.strategy === entry.id && s.pair === pair);
  const engine = chartEngine(pair), strat = S.catalog?.[entry.key], cache = chartCache(MC.signals, engine), key = `${entry.id}|${pair}`;
  if (cache && strat && !cache.has(key)) {
    let list = [];
    try {
      const res = engine.trades(strat, entry.tf, [pair]);
      if (res.start) list = engine.signals(strat, entry.tf, res.trades);
    } catch (error) { console.warn("Графика: сигналите не се изчислиха", entry.id, error); }
    cache.set(key, list);
  }
  const byId = new Map(((cache && cache.get(key)) || []).map((s) => [s.id, s]));
  for (const s of listed) byId.set(s.id, s);
  return [...byId.values()].sort((a, b) => (isCurrent(b) - isCurrent(a)) || (b.signal_time - a.signal_time));
}

function chartIndicatorList(entry, series) {
  const cache = chartCache(MC.indicators, chartEngine(series.pair)), key = `${entry.id}|${series.pair}|${series.tf}`;
  if (cache?.has(key)) return cache.get(key);
  const list = FX.chartIndicators(S.catalog?.[entry.key], series);
  if (cache) cache.set(key, list);
  return list;
}

function chartSel(ctx) {
  return MC.sel[ctx] || (MC.sel[ctx] = { pair: null, tf: null, id: null, signal: null, picked: false });
}

/** Всичко за една графика: инструмент, вариант, сигнали, свещи, индикатори и нива. */
function chartState(ctx, fixedPair = null, fixedSignal = null) {
  const sel = chartSel(ctx), style = fixedSignal?.style || S.settings.style, tfs = FX.TF_KEYS;
  // Текущите сигнали от следваните стратегии (както в „Сигнали“). Трябват само за избора по подразбиране.
  let mine = null;
  const current = () => mine || (mine = (S.data?.signals || []).filter((s) => isCurrent(s) && s.style === style && isFollowed(s.strategy) && pairSignalVisible(s)));
  const pair = fixedPair || (FX.PAIRS[sel.pair] ? sel.pair : current()[0]?.pair || FX.PAIR_KEYS[0]);
  if (sel.pair !== pair) { sel.pair = pair; if (!sel.picked) sel.id = null; sel.signal = null; }
  const all = chartVariants(pair);
  let entry = fixedSignal ? stratById(fixedSignal.strategy) || { id: fixedSignal.strategy, key: splitId(fixedSignal.strategy)[0], name: fixedSignal.strategy_name, tf: fixedSignal.tf, tf_label: fixedSignal.tf_label, style, version: fixedSignal.version || 1, rules: [], stats: {}, per_pair: [] } : all.find((e) => e.id === sel.id) || null;
  if (!entry) {
    // По подразбиране: вариантът на текущ сигнал за инструмента, иначе най-добре оцененият за него.
    const own = current().find((s) => s.pair === pair && all.some((e) => e.id === s.strategy));
    entry = (own && all.find((e) => e.id === own.strategy)) || all[0] || null;
    if (sel.id !== (entry?.id || null)) sel.signal = null;
    sel.id = entry?.id || null;
  }
  const tf = tfs.includes(sel.tf) ? sel.tf : entry?.tf || tfs[0];
  sel.tf = tf;
  const engine = chartEngine(pair), series = engine?.get(pair, tf) || null;
  const signals = fixedSignal ? [fixedSignal] : chartSignals(entry, pair);
  // Сигнал, отворен от страницата си, но вече извън последните 14 дни: показваме запазения запис.
  if (sel.signal && entry && !signals.some((s) => s.id === sel.signal)) {
    const saved = resolveSignal(sel.signal) || (sel.snapshot?.id === sel.signal ? sel.snapshot : null);
    if (saved && saved.strategy === entry.id && saved.pair === pair) signals.push(saved);
  }
  let sig = fixedSignal || (sel.signal === "" ? null : signals.find((s) => s.id === sel.signal) || null);
  if (!sig && sel.signal !== "") sig = signals.find(isCurrent) || null;
  if (sig) sel.snapshot = sig;
  const modelSeries = entry && engine?.get(pair, entry.tf);
  const sameVersion = !sig || (sig.version || 1) === (entry?.version || 1);
  const st = { ctx, fixedPair, fixedSignal, pair, style, tfs, tf, entry, all, variants: all, signals, sig, series, sameVersion };
  st.indicators = entry && modelSeries && sameVersion ? chartIndicatorList(entry, modelSeries).map((desc) => ({ ...desc, tf: desc.tf || (tf === entry.tf ? null : entry.tf), key: desc.key + "|view:" + tf })) : [];
  st.plots = series ? chartPlots(st) : [];
  st.levels = sig ? FX.chartLevels(sig, ordersOf(sig).map((o) => ({ ...o, targets: targetCells(o, sig) })), pairInfo(pair).digits) : [];
  st.markers = sig && series ? FX.chartMarkers(sig, series) : [];
  st.mine = chartMine(st);
  return st;
}

/** Реалните ти сделки по сигнала: от дневника или потвърдени в „Следени“. Отделно от модела. */
function chartMine(st) {
  if (!st.sig) return [];
  const trades = typeof JOURNAL !== "undefined" ? (JOURNAL.trades || []).filter((t) => t.signal_id === st.sig.id) : [];
  const out = [];
  for (const t of trades) {
    if (t.entry_price) out.push({ kind: "entry", price: t.entry_price, time: t.opened, dir: t.dir, label: "Твоят реален вход" });
    if (t.status === "closed" && t.exit_price) out.push({ kind: "exit", price: t.exit_price, time: t.closed, dir: t.dir, label: "Твоят изход" });
  }
  const w = S.watch.get(st.sig.id);
  if (!out.length && w?.entered && w.actualEntry?.price) out.push({ kind: "entry", price: w.actualEntry.price, time: null, dir: st.sig.dir, label: "Твоят вход (потвърден)" });
  return out;
}

/* ------------------------------------------------------------ индикатори */

const CHART_FIXED_COLORS = {
  adx: ["#e8eef0", MC_COLOR.up, MC_COLOR.down],
  ichi: ["#9fe4ac", "#fc928e", "#7cc7ff", "#ff9fd2"],
};
const CHART_BANDS = ["bb", "keltner", "donchian", "chandelier", "ssl", "session_range", "heikin"];

function chartPlots(st) {
  let k = 0;
  return st.indicators.map((desc) => FX.indicatorPlot(st.series, desc)).filter((p) => p && p.lines.length).map((p) => ({ ...p, color: MC_PALETTE[k++ % MC_PALETTE.length] }));
}

function chartLineColor(p, k) {
  if (CHART_FIXED_COLORS[p.name]) return CHART_FIXED_COLORS[p.name][k] || p.color;
  if (CHART_BANDS.includes(p.name)) return k === 0 && ["bb", "keltner"].includes(p.name) ? p.color : p.color + "b3";
  return k === 0 ? p.color : MC_PALETTE[(MC_PALETTE.indexOf(p.color) + k) % MC_PALETTE.length];
}

/** Видим ли е индикаторът: изричният избор на човека, иначе ATR е скрит, а панелите под графиката са най-много два. */
function chartShown(st, p) {
  const choice = MC.hidden[`${st.entry?.id}|${p.key}`];
  if (choice !== undefined) return !choice;
  if (p.hidden) return false;
  if (p.pane !== "osc") return true;
  const osc = st.plots.filter((x) => x.pane === "osc" && !x.hidden);
  return osc.indexOf(p) < 2;
}

/* ------------------------------------------------------------ изглед */

/** Грешка в графиката не бива да спира страницата: показваме кратко съобщение на нейно място. */
function modelChartPanel(ctx, fixedPair = null, fixedSignal = null) {
  if (!S.data?.ready) return "";
  try { return chartPanelHtml(ctx, fixedPair, fixedSignal); }
  catch (error) {
    console.warn("Графиката не се подготви", error);
    MC.state = null;
    return `<section class="panel mc-panel" id="mc-panel" data-mc-ctx="${esc(ctx)}" data-mc-fixed="${esc(fixedPair || "")}" data-mc-signal-id="${esc(fixedSignal?.id || "")}"><p class="kicker">ГРАФИКА С МОДЕЛА</p><p class="what">Графиката не можа да се подготви с текущите данни. Останалата част от сайта работи нормално.</p></section>`;
  }
}

function chartPanelHtml(ctx, fixedPair, fixedSignal) {
  const st = chartState(ctx, fixedPair, fixedSignal);
  st.mode = chartMode();
  MC.state = st;
  const name = FX.PAIRS[st.pair].name;
  const title = st.entry ? `${esc(name)} · ${esc(st.entry.name)} · ${esc(st.entry.tf_label)}` : esc(name);
  return `<section class="panel mc-panel" id="mc-panel" data-mc-ctx="${esc(ctx)}" data-mc-fixed="${esc(fixedPair || "")}" data-mc-signal-id="${esc(fixedSignal?.id || "")}">
    <div class="panel-head"><div><p class="kicker">ГРАФИКА С МОДЕЛА</p><h3>${title}</h3></div>${ctx === "home" ? `<a class="text-link" href="#/pair/${st.pair}">Страница на ${esc(name)} <span>↗</span></a>` : ""}</div>
    ${chartControls(st)}
    ${chartNotices(st)}
    <div class="mc-body"><div class="mc-main">${chartCanvas(st)}</div><aside class="mc-side" data-panel-board="chart-info" aria-label="Правила, оценка и сигнал">${chartSide(st)}</aside></div>
  </section>`;
}

const chartDirText = (s) => {
  const dirs = s.status === "pending" || s.status === "cancelled" ? [...new Set((s.orders || []).map((o) => o.dir))] : [s.dir];
  return dirs.length > 1 ? "две посоки" : dirs[0] === 1 ? "покупка" : "продажба";
};

function chartControls(st) {
  const pairs = st.fixedPair ? "" : `<div class="mc-pairs" role="group" aria-label="Инструмент">${FX.PAIR_KEYS.map((key) => {
    const q = S.data?.pairs?.[key];
    return `<button type="button" class="chip ${key === st.pair ? "active" : ""}" data-mc-pair="${key}" aria-pressed="${key === st.pair}"><strong>${esc(key === "XAUUSD" ? "Злато" : FX.PAIRS[key].name)}</strong><small>${px(key, q?.price)}</small></button>`;
  }).join("")}</div>`;
  const tfs = `<div class="mc-tfs" role="group" aria-label="Период на преглед">${st.tfs.map((tf) => `<button type="button" class="chip ${tf === st.tf ? "active" : ""}" data-mc-tf="${tf}" aria-pressed="${tf === st.tf}">${tf}</button>`).join("")}</div>`;
  const variant = st.fixedSignal ? `<div class="mc-model-label"><span>Период на сигнала</span><strong>${esc(st.fixedSignal.tf)} · ${esc(STYLE_NAMES[st.fixedSignal.style])}</strong></div>` : st.variants.length ? `<label class="mc-field"><span>Стратегия за ${esc(FX.PAIRS[st.pair].name)} · ${esc(STYLE_NAMES[st.style])}</span><select data-mc-variant>${st.variants.map((e) => `<option value="${esc(e.id)}" ${e.id === st.entry?.id ? "selected" : ""}>${esc(e.name)} · ${e.tf} — ${esc(FX.VERDICT_LABELS[ratingOf(e, st.pair)] || "няма оценка")}</option>`).join("")}</select></label>` : "";
  const option = (sig) => `<option value="${esc(sig.id)}" ${sig.id === st.sig?.id ? "selected" : ""}>${esc(statusInfo(sig).label)} · ${chartDirText(sig)} · ${esc(when(sig.signal_time))}</option>`;
  const live = st.signals.filter(isCurrent), past = st.signals.filter((sig) => !isCurrent(sig));
  const signal = !st.fixedSignal && st.signals.length ? `<label class="mc-field"><span>Сигнал · ${live.length} текущи</span><select data-mc-signal><option value="" ${st.sig ? "" : "selected"}>Само цени и индикатори</option>${live.length ? `<optgroup label="Текущи">${live.map(option).join("")}</optgroup>` : ""}${past.length ? `<optgroup label="Приключили">${past.map(option).join("")}</optgroup>` : ""}</select></label>` : "";
  const loading = MC.loading.has(st.pair), loaded = MC.history.get(st.pair)?.source === S.engine;
  return `<div class="mc-controls">${pairs}<div class="mc-row mc-view-controls"><span class="muted-small">Преглед</span>${tfs}${st.mode === "simple" ? "" : `<button type="button" class="tiny-btn" data-mc-history ${loading || loaded ? "disabled" : ""}>${loading ? "Зареждам историята…" : loaded ? "Историята е заредена" : "По-стара история"}</button>`}</div><div class="mc-row mc-selects">${variant}${signal}</div>${st.entry && st.tf !== st.entry.tf ? `<p class="mc-context">Показана е ${st.tf}. ${st.sig ? "Сигналът" : "Стратегията"} остава на <strong>${esc(st.entry.tf)}</strong>; нивата и правилата са същите.</p>` : ""}</div>`;
}

/** Време на отворен пазар от последната свещ. */
function openSecondsSince(t) {
  let open = 0;
  for (let x = Math.max(t, now() - 5 * 86400); x < now(); x += 900) if (FX.marketOpenAt(x)) open += 900;
  return open;
}

function chartNotices(st) {
  const out = [], name = FX.PAIRS[st.pair].name, q = S.meta?.quotes?.[st.pair];
  if (!S.engine) out.push(["warn", st.series ? "Показана е записаната история. Липсват текущи цени за потвърждение на нов вход." : "Липсват текущи свещи. Можеш да отвориш наличните файлове с „По-стара история“."]);
  else if (!st.series) out.push(["warn", `Няма достатъчно завършени свещи за ${name} на графика ${FX.TIMEFRAMES[st.tf].label}.`]);
  if (S.engine && S.data.market?.open && !quoteFresh(st.pair))
    out.push(["warn", `Котировката за ${name} е стара${q?.time ? ` (последна: ${when(q.time)})` : ""}. Свещите и нивата са от последните налични данни. Не ги ползвай за вход, преди да провериш цената при брокера.`]);
  if (st.series && S.data.market?.open) {
    const end = st.series.t[st.series.n - 1] + st.series.sec;
    if (openSecondsSince(end) > Math.max(2 * st.series.sec, 2 * 3600)) out.push(["warn", `Последната завършена свещ ${FX.TIMEFRAMES[st.tf].label} е до ${when(end)}. Данните изостават от пазара.`]);
  }
  if (S.data.market && !S.data.market.open) out.push(["info", "Пазарът е затворен. Показани са последните налични свещи."]);
  if (!st.sameVersion) out.push(["warn", "Сигналът е от запазена версия. Неговите нива се пазят; индикаторите на друга версия не се наслагват."]);
  if (MC.historyErrors.has(st.pair)) out.push(["warn", MC.historyErrors.get(st.pair)]);
  return out.map(([kind, text]) => `<div class="warn-line ${kind === "info" ? "info" : ""}">${kind === "warn" ? "⚠ " : ""}${esc(text)}</div>`).join("");
}

function chartCanvas(st) {
  if (!st.entry) return emptyBox("▦", "Няма тестван вариант", `За ${esc(FX.PAIRS[st.pair].name)} няма вариант в ${STYLE_NAMES[S.settings.style].toLowerCase()} стил. Смени стила или инструмента.`);
  if (!st.series) return emptyBox("▦", "Няма графика", "Все още няма достатъчно ценови данни за този изглед. Опитай отново по-късно.");
  const s = st.series, q = S.meta?.quotes?.[st.pair], last = s.t[s.n - 1] + s.sec;
  const toggles = st.plots.length ? `<div class="mc-inds" role="group" aria-label="Индикатори на стратегията">${st.plots.map((p) => {
    const on = chartShown(st, p);
    return `<button type="button" class="mc-ind" data-mc-ind="${esc(p.key)}" aria-pressed="${on}" title="${p.pane === "osc" ? "В отделен панел под свещите" : "Върху свещите"}"><i style="background:${p.color}"></i>${esc(p.label)}</button>`;
  }).join("")}</div>` : `<p class="what">Стратегията не ползва индикатор, който може да се начертае (входът е по свещи, часове или нива).</p>`;
  const legend = [["entry", "Вход (модел)"], ["stop0", "Стоп"], ["stop", "Стоп сега"], ["target", "Цел (TP)"], ["landmark", "+1R / +2R ориентири"], ["quote", "Котировка"], ["mine", "Твоята реална сделка"]]
    .map(([k, label]) => `<span><i style="background:${MC_COLOR[k]}"></i>${label}</span>`).join("");
  if (st.mode === "simple") return `<div class="mc-legend" id="mc-legend"></div>
    <div class="mc-chart mc-simple" id="mc-chart" role="img" aria-label="Свещи ${esc(FX.PAIRS[st.pair].name)} ${esc(FX.TIMEFRAMES[st.tf].label)} с нивата на модела"></div>
    <p class="mc-model-note">Опростена графика: последните свещи с нивата на модела, без индикатори. <a class="text-link" href="#/settings">Смени вида в Настройки ↗</a></p>
    <details class="mc-help"><summary>Обозначения и източник</summary>
    <div class="chart-legend">${legend}<span>┆ сигнал · ▲▼ вход · ■ изход</span></div>
    <p class="mc-source">Свещи: пазарни котировки · последна завършена свещ до ${esc(when(last))}${q?.time ? ` · котировка ${px(st.pair, q.price)} в ${esc(when(q.time))}${quoteFresh(st.pair) ? "" : " (стара)"}` : " · няма котировка"}. Часовете са по ${esc(TZ)}.</p>
    <p class="mc-source"><strong>Нивата и маркерите са изчислен модел, не изпълнена сделка при брокер.</strong> Реалният ти вход е в лилаво.</p></details>`;
  return `<div class="mc-legend" id="mc-legend"></div>
    <div class="mc-chart" id="mc-chart" role="img" aria-label="Свещи ${esc(FX.PAIRS[st.pair].name)} ${esc(FX.TIMEFRAMES[st.tf].label)} с индикаторите и нивата на модела"></div>
    ${toggles}
    <p class="mc-model-note">Нивата са по изчислен модел. Периодът на преглед не променя сигнала.</p>
    <details class="mc-help"><summary>Обозначения, управление и източник</summary>
    <p class="mc-hint">Плъзни за разглеждане. Мащабът се сменя от скалите или с два пръста. „По-стара история“ зарежда наличните файлове на сайта.</p>
    <div class="chart-legend">${legend}<span>● сигнал · ▲▼ вход · ■ изход</span></div>
    <p class="mc-source">Свещи: пазарни котировки · последна завършена свещ до ${esc(when(last))}${q?.time ? ` · котировка ${px(st.pair, q.price)} в ${esc(when(q.time))}${quoteFresh(st.pair) ? "" : " (стара)"}` : " · няма котировка"}. Часовете са по ${esc(TZ)}. Графиката показва запазените данни, по които се смятат сигналите, и не тегли нови цени.</p>
    <p class="mc-source"><strong>Нивата и маркерите са изчислен модел, не изпълнена сделка при брокер.</strong> Реалният ти вход (от дневника или потвърден в „Следени“) е в лилаво.</p>
    </details><p class="mc-attrib">Графика: <a href="https://www.tradingview.com/" target="_blank" rel="noopener">${esc(MC_NOTICE)}</a> · Apache License 2.0</p>`;
}

function chartSide(st) {
  if (!st.entry) return "";
  return `${chartSignalBox(st)}${chartRatingBox(st)}${chartRulesBox(st)}`;
}

function chartSignalBox(st) {
  const { sig, pair, entry } = st, name = FX.PAIRS[pair].name;
  if (!sig) {
    const past = st.signals.filter((s) => !isCurrent(s)).length;
    return `<div class="mc-box" data-panel-key="selected" data-panel-label="Избран сигнал"><p class="kicker">ИЗБРАН СИГНАЛ</p><h4>${st.signals.some(isCurrent) ? "Не е избран сигнал" : "Няма текущ сигнал"}</h4>
      <p class="what">Графиката показва цените и индикаторите на стратегията без входни нива. Нивата се появяват само при сигнал по правилата.${past ? " Приключилите сигнали от последните 14 дни са в списъка „Сигнал“." : ""}</p></div>`;
  }
  const info = statusInfo(sig), listed = (S.data?.signals || []).some((s) => s.id === sig.id);
  let advice = "";
  if (isCurrent(sig)) {
    const quote = entryQuote(sig), fresh = quote?.source === "broker" || quoteFresh(pair);
    const state = FX.signalTools.entryState(sig, quote?.price, now(), fresh, S.data?.market?.open !== false, entryLevelsFor(sig));
    advice = `<div class="entry-state entry-${esc(state.state)}"><strong>${esc(state.label)}</strong><span>${esc(state.text)}</span></div>`;
  }
  const why = !isCurrent(sig) ? "" : !isFollowed(sig.strategy) ? "не следваш тази стратегия"
    : !pairSignalVisible(sig) ? (costHeavy(sig) ? "разходите са над 20% от риска до стопа" : `оценката за ${name} не минава подбора`) : "";
  const levels = st.levels.length ? `<ul class="mc-levels">${st.levels.map((l) => `<li><span><i style="background:${MC_COLOR[l.kind]}"></i>${esc(l.label)}</span><strong>${px(pair, l.price)}</strong></li>`).join("")}</ul>` : "";
  const mine = st.mine.length ? `<ul class="mc-levels">${st.mine.map((m) => `<li><span><i style="background:${MC_COLOR.mine}"></i>${esc(m.label)}</span><strong>${px(pair, m.price)}</strong></li>`).join("")}</ul>` : "";
  const action = listed ? `<a class="btn btn-outline btn-sm" href="#/signal/${encodeURIComponent(sig.id)}">План стъпка по стъпка ↗</a>`
    : isCurrent(sig) && !isFollowed(entry.id) ? `<button type="button" class="btn btn-outline btn-sm" data-follow="${esc(entry.id)}">Следвай стратегията за пълния план</button>` : "";
  return `<div class="mc-box" data-panel-key="selected" data-panel-label="Избран сигнал"><p class="kicker">ИЗБРАН СИГНАЛ · ИЗЧИСЛЕН МОДЕЛ</p><h4>${dirBadge(sig)} <span class="st ${info.cls}">${esc(info.label)}</span></h4>
    <p class="what">Сигнал от ${esc(when(sig.signal_time))}. ${esc(info.text)}</p>${advice}${levels}${mine}
    ${why ? `<p class="what">Не се показва в „Сигнали“: ${esc(why)}.</p>` : ""}${action ? `<div class="chips-row" style="margin-top:10px">${action}</div>` : ""}</div>`;
}

function chartRatingBox(st) {
  const e = st.entry, row = pairRow(e, st.pair), v = ratingOf(e, st.pair), name = FX.PAIRS[st.pair].name;
  const facts = row ? [["Сделки в теста", row.trades], ["Печеливши", row.win_rate == null ? "—" : `${F.num(0).format(row.win_rate)}%`],
    ["Среден резултат", row.avg_r == null ? "—" : fmtR(row.avg_r)], ["След теста", forwardText(row)]] : [];
  return `<div class="mc-box" data-panel-key="rating" data-panel-label="Оценка"><details><summary>Оценка за ${esc(name)}</summary><div class="chips-row">${pairBadge(e, st.pair)}</div>
    ${facts.length ? `<dl class="mc-facts">${facts.map(([k, x]) => `<div><dt>${esc(k)}</dt><dd>${esc(String(x))}</dd></div>`).join("")}</dl>` : `<p class="what">Няма сделки за ${esc(name)} в историческия тест.</p>`}
    <p class="what">${esc(FX.PAIR_VERDICT_REASON[v] || "")}</p>
    <div class="chips-row" style="margin-top:8px">${strategyFollowButton(e)}<a class="text-link" href="#/strategy/${encodeURIComponent(e.id)}">Пълна статистика <span>↗</span></a></div></details></div>`;
}

function chartRulesBox(st) {
  const e = st.entry, rules = e.rules || [];
  const exit = ownExit(e) ? (e.exit_rules || []).join(" ") || "По правило на стратегията." : "При 1R се затваря половината и стопът на остатъка отива на входа; при 2R се затваря останалото.";
  const list = (items) => `<ul class="mc-rules">${items.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`;
  return `<div class="mc-box" data-panel-key="rules" data-panel-label="Правила"><details><summary>Правила и изход</summary>${e.short ? `<p class="what">${esc(e.short)}</p>` : ""}
    ${rules.length ? list(rules.slice(0, 4)) : ""}${rules.length > 4 ? `<details class="mc-more"><summary>Още ${rules.length - 4} правила</summary>${list(rules.slice(4))}</details>` : ""}
    <p class="what"><strong>Изход:</strong> ${esc(exit)}</p>
    ${e.approx || e.provisional ? `<p class="what">${approximationTag(e)}</p>` : ""}</details></div>`;
}

/* ------------------------------------------------------------ страница на двойката */

function applyChartPreset(pair, strategyId, signalId, raw) {
  if (!strategyId || MC.preset === raw) return;
  MC.preset = raw;
  const entry = stratById(strategyId);
  if (!entry) return;
  if (entry.style !== S.settings.style && STYLE_NAMES[entry.style]) {
    S.settings.style = entry.style;
    saveSettings();
    renderChrome();
    toast(`Стилът е сменен на „${STYLE_NAMES[entry.style]}“, за да се види избраният сигнал.`);
  }
  Object.assign(chartSel(`pair:${pair}`), { pair, id: entry.id, tf: entry.tf, signal: signalId || null, picked: true });
}

function viewPair(id) {
  const [pair, strategyId, signalId] = String(id || "").split("/");
  if (!FX.PAIRS[pair]) return `<div class="detail-back"><a class="back-btn" href="#/">← Начало</a></div>${emptyBox("▦", "Няма такъв инструмент", "Избери някоя от осемте двойки на началната страница.", `<a class="btn btn-outline" href="#/">Към началото</a>`)}`;
  applyChartPreset(pair, strategyId, signalId, id);
  const info = pairInfo(pair), name = FX.PAIRS[pair].name, q = S.meta?.quotes?.[pair];
  const current = mySignals().filter(isCurrent).filter((s) => s.pair === pair);
  const currencies = pairCurrencies(pair).filter((c) => MY_CURRENCIES.includes(c));
  const news = newsFor(currencies, now() - 3600, now() + 48 * 3600, ["high", "medium"]).slice(0, 8);
  return `
    <div class="detail-back"><a class="back-btn" href="#/">← Начало</a><span class="muted-small">${q?.time ? `${quoteFresh(pair) ? "Котировка" : "Стара котировка"}: ${esc(when(q.time))}` : "Няма текуща котировка"}</span></div>
    <div class="page-heading"><div><p class="kicker">ИНСТРУМЕНТ · ${esc(STYLE_NAMES[S.settings.style].toUpperCase())}</p>
      <h1>${esc(name)} <span class="mc-price">${px(pair, info.price)}</span> <span class="chg mc-chg ${info.change_pct > 0 ? "pos" : info.change_pct < 0 ? "neg" : ""}">${info.change_pct == null ? "" : pct(info.change_pct, 2)}</span></h1>
      <p>Текущите сигнали за ${esc(name)}, графика с избрана стратегия и новините за двете валути на едно място.</p></div>
      <span class="page-flag">${current.length} ${current.length === 1 ? "текущ сигнал" : "текущи сигнала"}</span></div>
    ${conflictNotice(pair)}
    <section class="panel panel-full"><div class="panel-head"><div><p class="kicker">СИГНАЛИ СЕГА</p><h3>Сигнали за ${esc(name)}</h3></div><a class="text-link" href="#/signals">Всички <span>↗</span></a></div>
      ${current.length ? `<div class="sig-list">${signalGroups(current)}</div>` : `<p class="muted" style="font-size:12px">Стратегиите, които следваш, нямат текущ сигнал за ${esc(name)} в ${esc(STYLE_NAMES[S.settings.style].toLowerCase())} стил. Графиката по-долу показва избрана стратегия без входни нива.</p>`}</section>
    ${modelChartPanel(`pair:${pair}`, pair)}
    <div class="grid-2" style="margin-top:14px">
      <section class="panel"><div class="panel-head"><div><p class="kicker">НОВИНИ · СЛЕДВАЩИТЕ 48 Ч</p><h3>${esc(currencies.join(" и "))}</h3></div><a class="text-link" href="#/news">Календар <span>↗</span></a></div>
        ${news.length ? news.map((e) => newsCompactWithImpact(e)).join("") : `<p class="muted" style="font-size:12px">Няма важни новини за ${esc(currencies.join(" и "))} в следващите 48 часа.</p>`}
        <p class="what" style="margin-top:10px"><a class="link" href="#/strategies" data-mc-strategies="${pair}">Всички стратегии с оценка за ${esc(name)} →</a></p></section>
    </div>`;
}

/* ------------------------------------------------------------ рисуване */

function disposeModelChart() {
  MC.observer?.disconnect();
  MC.observer = null;
  if (MC.chart) { try { MC.chart.remove(); } catch (_e) { /* вече е премахната */ } }
  MC.chart = null; MC.host = null; MC.key = ""; MC.simple = false;
}

const chartHiddenKey = (st) => st.plots.map((p) => (chartShown(st, p) ? "1" : "0")).join("");

function mountModelChart() {
  try { drawModelChart(); }
  catch (error) {
    console.warn("Графиката не се начерта", error);
    disposeModelChart();
    const host = document.getElementById("mc-chart");
    try { if (host && MC.state?.series) chartFallback(host, MC.state); } catch (_e) { /* оставяме празното място */ }
  }
}

function drawModelChart() {
  const host = document.getElementById("mc-chart"), st = MC.state;
  if (!host || !st?.series) { disposeModelChart(); return; }
  if (st.mode !== chartMode()) { refreshModelChart(); return; }
  const s = st.series;
  const key = [st.mode, st.ctx, st.pair, st.tf, st.entry?.id || "", st.sig?.id || "", st.sig?.status || "", st.sig?.stop ?? "", s.n, s.t[0], s.t[s.n - 1], chartHiddenKey(st), S.meta?.quotes?.[st.pair]?.time || 0, st.mode === "simple" ? Math.round((host.clientWidth || 0) / 40) : 0].join("|");
  if ((MC.chart || MC.simple) && MC.host === host && MC.key === key) return;
  disposeModelChart();
  if (st.mode === "simple") { drawSimpleChart(host, st); MC.simple = true; MC.host = host; MC.key = key; return; }
  const LC = window.LightweightCharts;
  if (!LC?.createChart) {
    if (MC.lib !== "failed") { loadChartLibrary(); if (MC.lib === "loading") { host.innerHTML = '<p class="muted mc-loading">Зареждам графиката…</p>'; return; } }
    chartFallback(host, st); MC.simple = true; MC.host = host; MC.key = key; return;
  }
  // Ширината на самата графика (скрит раздел има ширина 0 — тогава приемаме обикновен екран).
  const digits = pairInfo(st.pair).digits, mobile = (host.clientWidth || window.innerWidth || 1000) < 640;
  const plots = st.plots.filter((p) => chartShown(st, p)), osc = plots.filter((p) => p.pane === "osc");
  host.style.height = `${(mobile ? 300 : 400) + osc.length * (mobile ? 96 : 120)}px`;
  const timeLabel = (t) => (st.tf === "D1" ? MC_FMT.day.format(new Date(t * 1000)) : when(t));
  const tick = (t, type) => {
    const d = new Date(t * 1000);
    return type === 0 ? MC_FMT.year.format(d) : type === 1 ? MC_FMT.month.format(d) : type === 2 ? F.dayMonth.format(d) : F.time.format(d);
  };
  const chart = LC.createChart(host, {
    autoSize: true,
    layout: { background: { type: "solid", color: MC_COLOR.panel }, textColor: MC_COLOR.text, fontSize: 11, attributionLogo: true,
      fontFamily: getComputedStyle(document.body).fontFamily, panes: { separatorColor: MC_COLOR.border, separatorHoverColor: MC_COLOR.level, enableResize: true } },
    grid: { vertLines: { color: MC_COLOR.grid }, horzLines: { color: MC_COLOR.grid } },
    rightPriceScale: { borderColor: MC_COLOR.border },
    timeScale: { borderColor: MC_COLOR.border, timeVisible: st.tf !== "D1", secondsVisible: false, rightOffset: 6, tickMarkFormatter: tick },
    localization: { locale: "bg-BG", timeFormatter: timeLabel },
    crosshair: { mode: LC.CrosshairMode?.Normal ?? 0 },
    // Колелцето и вертикалното плъзгане остават за страницата; графиката се мести с плъзгане, мащабът — от скалите или с два пръста.
    handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
  });
  const q = S.meta?.quotes?.[st.pair];
  // Нивата влизат в мащаба, за да не остане стопът или целта извън графиката.
  const extra = [...st.levels.map((l) => l.price), ...st.mine.map((m) => m.price), ...(Number.isFinite(q?.price) ? [q.price] : [])].filter(Number.isFinite);
  const candles = chart.addSeries(LC.CandlestickSeries, {
    upColor: MC_COLOR.up, downColor: MC_COLOR.down, borderUpColor: MC_COLOR.up, borderDownColor: MC_COLOR.down, wickUpColor: MC_COLOR.up, wickDownColor: MC_COLOR.down,
    priceFormat: { type: "price", precision: digits, minMove: Math.pow(10, -digits) }, lastValueVisible: false, priceLineVisible: false,
    autoscaleInfoProvider: (base) => {
      const r = base();
      if (!r?.priceRange || !extra.length) return r;
      return { ...r, priceRange: { minValue: Math.min(r.priceRange.minValue, ...extra), maxValue: Math.max(r.priceRange.maxValue, ...extra) } };
    },
  });
  candles.setData(Array.from({ length: s.n }, (_, i) => ({ time: s.t[i], open: s.o[i], high: s.h[i], low: s.l[i], close: s.c[i] })));

  let pane = 0;
  const tone = (v, alpha = "") => (v > 0 ? MC_COLOR.up : v < 0 ? MC_COLOR.down : "#6d7f8d") + alpha;
  const hover = [];
  for (const p of plots) {
    const paneIndex = p.pane === "price" ? 0 : ++pane, precision = p.precision ?? digits;
    let first = null;
    p.lines.forEach((line, k) => {
      const color = chartLineColor(p, k);
      const common = { priceFormat: { type: "price", precision, minMove: Math.pow(10, -precision) }, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };
      const series = line.hist
        ? chart.addSeries(LC.HistogramSeries, { ...common, color, base: 0 }, paneIndex)
        : chart.addSeries(LC.LineSeries, { ...common, color, lineWidth: p.pane === "price" && k === 0 && !CHART_BANDS.includes(p.name) ? 2 : 1 }, paneIndex);
      series.setData(line.values.map((v, i) => (v === null ? { time: s.t[i] }
        : line.hist ? { time: s.t[i], value: v, color: tone(line.tone[i], "aa") }
          : line.tone ? { time: s.t[i], value: v, color: tone(line.tone[i]) } : { time: s.t[i], value: v })));
      if (!first) first = series;
      if (k === 0) hover.push({ label: p.label, values: line.values, precision, color });
    });
    if (first) for (const lv of p.levels) first.createPriceLine({ price: lv, color: MC_COLOR.level, lineWidth: 1, lineStyle: LC.LineStyle.Dashed, axisLabelVisible: false, title: "" });
  }

  const style = { entry: [LC.LineStyle.Solid, 2], stop0: [LC.LineStyle.Solid, 2], stop: [LC.LineStyle.Dashed, 2], target: [LC.LineStyle.Solid, 1], landmark: [LC.LineStyle.Dotted, 1] };
  for (const l of st.levels) candles.createPriceLine({ price: l.price, color: MC_COLOR[l.kind], lineStyle: style[l.kind][0], lineWidth: style[l.kind][1], axisLabelVisible: true, title: l.label });
  if (Number.isFinite(q?.price)) candles.createPriceLine({ price: q.price, color: MC_COLOR.quote, lineStyle: LC.LineStyle.SparseDotted ?? LC.LineStyle.Dotted, lineWidth: 1, axisLabelVisible: true,
    title: quoteFresh(st.pair) ? `Котировка ${F.time.format(new Date(q.time * 1000))}` : "Стара котировка" });
  for (const m of st.mine) candles.createPriceLine({ price: m.price, color: MC_COLOR.mine, lineStyle: LC.LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: m.label });

  const marks = st.markers.map((m) => chartMarker(m)).concat(st.mine.filter((m) => Number.isFinite(m.time)).map((m) => {
    // Вход при покупка и изход при продажба са стрелка нагоре под свещта; другите два — надолу над нея.
    const at = FX.chartBarAt(s, m.time), up = (m.dir === 1) === (m.kind === "entry");
    return at && { time: at.time, position: up ? "belowBar" : "aboveBar", shape: up ? "arrowUp" : "arrowDown", color: MC_COLOR.mine, text: m.kind === "entry" ? "Твой вход" : "Твой изход" };
  })).filter(Boolean).sort((a, b) => a.time - b.time);
  if (marks.length && LC.createSeriesMarkers) LC.createSeriesMarkers(candles, marks);

  const panes = chart.panes?.() || [];
  if (panes.length > 1) { panes[0].setStretchFactor?.(mobile ? 2.6 : 3.2); panes.slice(1).forEach((p) => p.setStretchFactor?.(1)); }

  // Видимият участък се задава, когато графиката вече има ширина; после се помни до смяна на избора.
  const rangeKey = `${st.ctx}|${st.pair}|${st.tf}|${st.entry?.id}|${st.sig?.id || ""}`;
  const win = MC.ranges[rangeKey] || FX.chartWindow(s.n, st.markers, mobile ? 80 : 140);
  let settled = false;
  const settle = () => {
    if (settled || MC.chart !== chart || !host.clientWidth) return;
    settled = true;
    const saved = MC.timeRanges[rangeKey];
    const apply = () => {
      if (saved && saved.start !== s.t[0]) chart.timeScale().setVisibleRange({ from: saved.from, to: saved.to });
      else if (win) chart.timeScale().setVisibleLogicalRange(win);
    };
    apply(); requestAnimationFrame(() => { if (MC.chart === chart) apply(); });
  };
  if (typeof ResizeObserver !== "undefined") {
    MC.observer = new ResizeObserver(() => requestAnimationFrame(() => { settle(); if (settled) MC.observer?.disconnect(); }));
    MC.observer.observe(host);
  }
  requestAnimationFrame(settle);
  chart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
    if (!r || !settled || MC.chart !== chart) return;
    MC.ranges[rangeKey] = { from: r.from, to: r.to };
    const time = chart.timeScale().getVisibleRange();
    if (time && Number.isFinite(time.from) && Number.isFinite(time.to)) MC.timeRanges[rangeKey] = { ...time, start: s.t[0] };
  });

  const legend = document.getElementById("mc-legend"), fmt = (v) => Number(v).toFixed(digits);
  const show = (index) => {
    const i = index >= 0 && index < s.n ? index : s.n - 1;
    if (!legend) return;
    const ind = hover.filter((h) => h.values[i] !== null).slice(0, 4).map((h) => `<span style="color:${h.color}">${esc(h.label)} ${Number(h.values[i]).toFixed(h.precision)}</span>`).join("");
    legend.innerHTML = `<b>${esc(timeLabel(s.t[i]))}</b><span>Отв. ${fmt(s.o[i])}</span><span>Макс. ${fmt(s.h[i])}</span><span>Мин. ${fmt(s.l[i])}</span><span>Затв. ${fmt(s.c[i])}</span>${ind}`;
  };
  show(s.n - 1);
  chart.subscribeCrosshairMove((param) => show(Number.isInteger(param?.logical) && param.time !== undefined ? param.logical : s.n - 1));
  MC.chart = chart; MC.host = host; MC.key = key;
}

function chartMarker(m) {
  const buy = m.dir === 1, sell = m.dir === -1;
  switch (m.kind) {
    case "signal": return { time: m.time, position: buy ? "belowBar" : "aboveBar", shape: "circle", color: MC_COLOR.signal, text: "Сигнал" };
    case "fill": return { time: m.time, position: sell ? "aboveBar" : "belowBar", shape: sell ? "arrowDown" : "arrowUp", color: MC_COLOR.entry, text: m.after ? "Вход (модел) · текуща свещ" : "Вход (модел)" };
    case "tp1": return { time: m.time, position: sell ? "belowBar" : "aboveBar", shape: "circle", color: MC_COLOR.target, text: "Цел 1" };
    case "exit": return { time: m.time, position: sell ? "belowBar" : "aboveBar", shape: "square", color: m.r > 0.02 ? MC_COLOR.up : m.r < -0.02 ? MC_COLOR.down : "#9aa8b4", text: `Изход ${Number.isFinite(m.r) ? fmtR(m.r) : ""}`.trim() };
    case "cancel": return { time: m.time, position: "aboveBar", shape: "square", color: "#9aa8b4", text: m.reason === "void" ? "Отпадна" : "Изтече" };
    default: return null;
  }
}

/** Без библиотеката (липсващ файл) се показва опростената графика със същите нива. */
function chartFallback(host, st) {
  drawSimpleChart(host, st);
  host.insertAdjacentHTML("beforeend", '<p class="what">Интерактивната графика временно не е достъпна. Показана е опростената.</p>');
}

/* ------------------------------------------------------------ опростена графика */

/** Кратък надпис за тесния десен край: „Вход ▲/Стоп ▼“, „TP1“, „1R“. */
const simpleLabel = (label) => label.split(" · ").filter((part) => !/^(Buy|Sell)\b/.test(part))
  .map((part) => part.replace("Вход (модел)", "Вход").replace("Начален стоп", "Стоп").replace(/^\+(\d)R ориентир/, "$1R").replace(/^Цел (\d) \(TP\)/, "TP$1").replace("Цел (TP)", "TP"))
  .join("/");

function drawSimpleChart(host, st) {
  const s = st.series, width = host.clientWidth || Math.min(window.innerWidth || 700, 900), phone = width < 520;
  const span = phone ? 60 : 90, win = FX.chartWindow(s.n, st.markers, span) || { from: s.n - span, to: s.n };
  let to = Math.min(s.n - 1, Math.ceil(win.to)), from = Math.max(0, Math.floor(win.from));
  if (to - from > 220) from = to - 220;
  host.classList.add("mc-simple");
  host.style.height = "auto";
  host.innerHTML = simpleChartSVG(st, from, to, width);
  const legend = document.getElementById("mc-legend"), f = (v) => px(st.pair, v);
  if (legend) legend.innerHTML = `<b>${esc(st.tf === "D1" ? MC_FMT.day.format(new Date(s.t[to] * 1000)) : when(s.t[to]))}</b><span>Отв. ${f(s.o[to])}</span><span>Макс. ${f(s.h[to])}</span><span>Мин. ${f(s.l[to])}</span><span>Затв. ${f(s.c[to])}</span>`;
}

/** Свещите от from до to с нивата на модела, котировката и реалната сделка. Без индикатори и без библиотека. */
function simpleChartSVG(st, from, to, width) {
  const s = st.series, pair = st.pair, W = Math.max(300, Math.round(width)), phone = W < 520;
  const H = phone ? 250 : 300, L = 6, R = phone ? 106 : 132, T = 12, B = 24, font = phone ? 9 : 10;
  const lines = st.levels.map((l) => ({ v: l.price, label: simpleLabel(l.label), color: MC_COLOR[l.kind], dash: l.kind === "landmark" ? "2 6" : l.kind === "stop" ? "6 4" : "", width: ["entry", "stop0"].includes(l.kind) ? 1.6 : 1 }));
  const q = S.meta?.quotes?.[pair];
  if (Number.isFinite(q?.price)) lines.push({ v: q.price, label: quoteFresh(pair) ? "Цена" : "Стара цена", color: MC_COLOR.quote, dash: "1 4", width: 1 });
  for (const m of st.mine) lines.push({ v: m.price, label: m.kind === "entry" ? "Твой вход" : "Твой изход", color: MC_COLOR.mine, dash: "5 4", width: 1 });
  const n = to - from + 1;
  let min = Infinity, max = -Infinity;
  for (let i = from; i <= to; i++) { min = Math.min(min, s.l[i]); max = Math.max(max, s.h[i]); }
  for (const l of lines) { min = Math.min(min, l.v); max = Math.max(max, l.v); }
  const pad = (max - min) * 0.06 || Math.abs(max) * 0.001 || 0.001;
  min -= pad; max += pad;
  const step = (W - L - R) / Math.max(n, 1), x = (i) => L + step * (i - from + 0.5), y = (v) => T + ((max - v) / (max - min)) * (H - T - B);
  const cw = Math.max(1.5, step * 0.62);
  const grid = [0, 1, 2, 3].map((k) => { const yy = T + (k * (H - T - B)) / 3; return `<line x1="${L}" x2="${W - R + 4}" y1="${yy}" y2="${yy}" stroke="#22303c" stroke-dasharray="3 5"/>`; }).join("");
  let candles = "";
  for (let i = from; i <= to; i++) {
    const up = s.c[i] >= s.o[i], col = up ? MC_COLOR.up : MC_COLOR.down, top = y(Math.max(s.o[i], s.c[i])), bot = y(Math.min(s.o[i], s.c[i]));
    candles += `<line x1="${x(i)}" x2="${x(i)}" y1="${y(s.h[i])}" y2="${y(s.l[i])}" stroke="${col}" stroke-width="1"/><rect x="${x(i) - cw / 2}" y="${top}" width="${cw}" height="${Math.max(1, bot - top)}" fill="${col}" opacity="${up ? 0.85 : 0.75}"/>`;
  }
  // Маркерите: сигналът е вертикална линия, входът — триъгълник (покупка: нагоре под свещта), Цел 1 — кръгче, изходът — квадратче.
  const marks = st.markers.filter((m) => m.index >= from && m.index <= to).map((m) => {
    const cx = x(m.index), sell = m.dir === -1;
    if (m.kind === "signal") return `<line x1="${cx}" x2="${cx}" y1="${T}" y2="${H - B}" stroke="${MC_COLOR.signal}" stroke-dasharray="2 4"/><text x="${cx + 4}" y="${T + 10}" font-size="${font}" fill="${MC_COLOR.signal}">сигнал</text>`;
    if (m.kind === "fill") { const yy = sell ? y(s.h[m.index]) - 9 : y(s.l[m.index]) + 9, d = sell ? -5 : 5; return `<path d="M${cx - 5},${yy + d} L${cx + 5},${yy + d} L${cx},${yy - d} Z" fill="${MC_COLOR.entry}"/>`; }
    if (m.kind === "tp1") return `<circle cx="${cx}" cy="${sell ? y(s.l[m.index]) + 8 : y(s.h[m.index]) - 8}" r="3.5" fill="${MC_COLOR.target}"/>`;
    const col = m.kind === "exit" ? (m.r > 0.02 ? MC_COLOR.up : m.r < -0.02 ? MC_COLOR.down : "#9aa8b4") : "#9aa8b4";
    return `<rect x="${cx - 4}" y="${(sell ? y(s.l[m.index]) + 6 : y(s.h[m.index]) - 14)}" width="8" height="8" fill="${col}"/>`;
  }).join("");
  // Надписите вдясно не се застъпват: подреждат се отгоре надолу на поне 17–19 px.
  const gap = phone ? 17 : 19, lo = T + 9, hi = H - B - 9;
  const order = lines.map((l, k) => ({ k, y: y(l.v) })).sort((a, b) => a.y - b.y);
  order.forEach((p, i) => { p.y = Math.max(p.y, lo, i ? order[i - 1].y + gap : lo); });
  for (let i = order.length - 1; i >= 0; i--) order[i].y = Math.min(order[i].y, i === order.length - 1 ? hi : order[i + 1].y - gap);
  const labelY = Object.fromEntries(order.map((p) => [p.k, p.y]));
  const levels = lines.map((l, k) => `<line x1="${L}" x2="${W - R + 4}" y1="${y(l.v)}" y2="${y(l.v)}" stroke="${l.color}" stroke-width="${l.width}" ${l.dash ? `stroke-dasharray="${l.dash}"` : ""} opacity=".9"/>`
    + `<rect x="${W - R + 6}" y="${labelY[k] - 8.5}" width="${R - 8}" height="17" rx="4" fill="#111a22" stroke="${l.color}" stroke-opacity=".6"/>`
    + `<text x="${W - R + 10}" y="${labelY[k] + 3.5}" font-size="${font}" fill="${l.color}">${esc(l.label)} ${px(pair, l.v)}</text>`).join("");
  const ticks = [from, from + Math.floor(n / 3), from + Math.floor((2 * n) / 3), to].filter((v, i, a) => a.indexOf(v) === i).map((i) => {
    const d = new Date(s.t[i] * 1000), label = st.tf === "D1" ? F.dayMonth.format(d) : `${F.dayMonth.format(d)} ${F.time.format(d)}`;
    // Крайните дати се подравняват навътре, за да не се режат.
    return `<text x="${x(i)}" y="${H - 6}" font-size="${font}" fill="#677c8a" text-anchor="${i === from ? "start" : i === to ? "end" : "middle"}">${label}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Опростена графика на ${esc(FX.PAIRS[pair].name)} с нивата на модела">${grid}${candles}${levels}${marks}${ticks}</svg>`;
}

/* ------------------------------------------------------------ действия */

function refreshModelChart(focus = "") {
  const panel = document.getElementById("mc-panel");
  if (!panel) return;
  const holder = document.createElement("div");
  holder.innerHTML = modelChartPanel(panel.dataset.mcCtx, panel.dataset.mcFixed || null, panel.dataset.mcSignalId ? resolveSignal(panel.dataset.mcSignalId) : null);
  if (!holder.firstElementChild) return;
  panel.replaceWith(holder.firstElementChild);
  PanelLayout.mount(document.getElementById("main"), S.route.view);
  mountModelChart();
  if (focus) document.querySelector(`#mc-panel ${focus}`)?.focus({ preventScroll: true });
}

function currentChartSel() {
  const panel = document.getElementById("mc-panel");
  return panel ? chartSel(panel.dataset.mcCtx) : null;
}

window.addEventListener("hashchange", () => { MC.preset = ""; });

document.addEventListener("click", (event) => {
  const t = event.target;
  const focus = t.closest("[data-model-focus]");
  if (focus) { focusChartSignal(focus.dataset.modelFocus); return; }
  if (t.closest("[data-mc-history]") && MC.state) { loadChartHistory(MC.state.pair); return; }
  const pairBtn = t.closest("[data-mc-pair]");
  if (pairBtn) {
    const sel = currentChartSel(), pair = pairBtn.dataset.mcPair;
    if (sel && FX.PAIRS[pair]) { sel.pair = pair; if (!sel.picked) sel.id = null; sel.signal = null; refreshModelChart(`[data-mc-pair="${pair}"]`); }
    return;
  }
  const tfBtn = t.closest("[data-mc-tf]");
  if (tfBtn) {
    const sel = currentChartSel(), tf = tfBtn.dataset.mcTf;
    if (!sel || !FX.TIMEFRAMES[tf]) return;
    sel.tf = tf;
    refreshModelChart(`[data-mc-tf="${tf}"]`);
    return;
  }
  const ind = t.closest("[data-mc-ind]");
  if (ind && MC.state?.entry) {
    const plot = MC.state.plots.find((p) => p.key === ind.dataset.mcInd);
    if (plot) { MC.hidden[`${MC.state.entry.id}|${plot.key}`] = chartShown(MC.state, plot); refreshModelChart(`[data-mc-ind="${CSS.escape(plot.key)}"]`); }
    return;
  }
  const strategiesLink = t.closest("[data-mc-strategies]");
  if (strategiesLink && FX.PAIRS[strategiesLink.dataset.mcStrategies]) { S.stratPair = strategiesLink.dataset.mcStrategies; S.stratFilter = "all"; }
});

document.addEventListener("change", (event) => {
  const t = event.target;
  if (t.matches?.('input[name="chartMode"]')) {
    S.settings.chartMode = t.value; saveSettings(); render();
    toast(t.value === "auto" ? "Графики: автоматично според екрана." : t.value === "simple" ? "Графики: винаги опростени." : "Графики: винаги интерактивни.");
    return;
  }
  const sel = currentChartSel();
  if (!sel) return;
  if (t.matches?.("[data-mc-variant]")) { Object.assign(sel, { id: t.value, tf: stratById(t.value)?.tf || null, signal: null, picked: true }); refreshModelChart("[data-mc-variant]"); }
  else if (t.matches?.("[data-mc-signal]")) { sel.signal = t.value; refreshModelChart("[data-mc-signal]"); }
});
