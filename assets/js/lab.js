"use strict";
// Черновите и тестовете са лични до изрично публикуване.

const LAB = {
  password: (() => { try { return sessionStorage.getItem("lab-pass") || ""; } catch (_e) { return ""; } })(),
  authed: false, checking: false, authError: "",
  worker: null, loaded: false, loading: null, loadError: "",
  running: false, progress: null, log: [],
  selected: new Set(), results: {}, published: new Set(), inited: false, dirty: false,
  custom: [], history: [], geminiCheck: null, geminiChecking: false,
  filter: "all", query: "", form: null, saving: false,
};
const GROUP_FILTERS = [["all", "Всички"], ["За тест", "Нови за тест"], ["Тренд", "Тренд"], ["Пробив", "Пробив"], ["Осцилатори", "Осцилатори"], ["Свещи", "Свещи"], ["Мои стратегии", "Мои"], ["tested", "Тествани"], ["published", "Публикувани"]];

function labInit() {
  if (LAB.inited || !S.catalog) return;
  const r = S.results || {};
  LAB.results = Object.assign({}, r.entries || {});
  LAB.published = new Set(r.published || []);
  LAB.inited = true;
}

function labCatalog() {
  const catalog = Object.fromEntries(FX.CODED.concat(FX.LIBRARY, FX.RESEARCH || []).map((s) => [s.key, s]));
  for (const spec of LAB.custom) {
    try { catalog[spec.key] = FX.build({ ...spec, origin: "custom", group: "Мои стратегии", source: "Собствена стратегия" }); } catch (_e) { /* Невалидната чернова остава за поправка. */ }
  }
  return catalog;
}
function labWorkspace(data) {
  LAB.custom = data.strategies || [];
  LAB.history = data.history || [];
  LAB.results = data.entries || {};
  LAB.inited = true;
}
const labBase = () => S.route.view === "workshop" ? "#/workshop" : "#/lab";

/** Всички варианти (стратегия × графика) от каталога. */
function labVariants() {
  const out = [];
  for (const strat of Object.values(labCatalog())) {
    for (const tf of strat.tfs.filter((tf) => styleOk(FX.TIMEFRAMES[tf].style))) out.push({ id: `${strat.key}-${tf}`, key: strat.key, tf, strat });
  }
  return out;
}

async function labPost(action, payload) {
  const r = await fetch("api/save.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: LAB.password, action, payload }) });
  let data = null;
  try { data = await r.json(); } catch (_e) { /* празен отговор */ }
  if (!r.ok || !data || !data.ok) throw new Error((data && data.error) || `Грешка ${r.status}`);
  return data;
}

/* ------------------------------------------------------------ изгледи */

function viewLab(id) {
  if (!S.catalog) return `<div class="loading"><div><div class="spinner"></div><h2>Зареждам…</h2></div></div>`;
  labInit();
  if (!LAB.authed) return labLogin();
  if (id && id.startsWith("edit/")) {
    const key = id.slice(5);
    if (!LAB.form || LAB.form.key !== key) {
      const spec = LAB.custom.find((x) => x.key === key);
      if (!spec) return `<div class="detail-back"><a class="back-btn" href="${labBase()}">← Лаборатория</a></div>` + emptyBox("◈", "Няма такава стратегия", "Може да е изтрита.");
      LAB.form = Object.assign(JSON.parse(JSON.stringify(spec)), { isNew: false });
    }
    return labBuilder();
  }
  if (id === "new") return labBuilder();
  LAB.form = null;
  return labMain(id === "mine" || S.route.view === "workshop");
}

function labLogin() {
  return `<div class="page-heading"><div><p class="kicker">САМО ЗА АДМИНИСТРАТОР</p><h1>${S.route.view === "workshop" ? "Мои стратегии" : "Лаборатория"}</h1>
      <p>Тук тестваш стратегиите върху цялата история и избираш кои да се показват на сайта.</p></div></div>
    <section class="panel" style="max-width:460px"><form id="lab-login" class="settings-form">
      <div class="form-field"><label for="lab-pass">Парола</label><input id="lab-pass" type="password" autocomplete="current-password" required value="${esc(LAB.password)}"></div>
      ${LAB.authError ? `<div class="risk-notice">${esc(LAB.authError)}</div>` : ""}
      <button class="btn btn-primary" type="submit" ${LAB.checking ? "disabled" : ""}>${LAB.checking ? "Проверявам…" : "Влез"}</button>
      <p class="what">Паролата е в api/config.php (admin_password).</p></form></section>`;
}

function labRowStats(e) {
  if (!e) return `<td colspan="6" class="muted">За тест</td>`;
  const s = e.stats;
  const validation = e.validation ? `<small class="validation-note">Отделен период: ${e.validation.holdout.trades} сделки · ${fmtR(e.validation.holdout.avg_r || 0)} средно${e.validation.passed ? " · потвърждава теста" : " · няма потвърждение"}</small>` : "";
  if (!s.trades) return `<td>${verdictBadge(s)}</td><td colspan="5" class="muted">няма сделки</td>`;
  return `<td>${verdictBadge(s)}${validation}</td><td class="num">${s.trades}</td><td class="num ${s.avg_r > 0 ? "pos" : "neg"}">${fmtR(s.avg_r)}</td>
    <td class="num">${s.profit_factor ?? "∞"}</td><td class="num">${fmtR(s.avg_first)} / ${fmtR(s.avg_second)}</td>
    <td class="num">${s.longs?.avg_r == null ? "—" : fmtR(s.longs.avg_r)} / ${s.shorts?.avg_r == null ? "—" : fmtR(s.shorts.avg_r)}</td>`;
}

function labFilterMatch(v) {
  const f = LAB.filter, q = LAB.query.trim().toLowerCase();
  if (q && !(`${v.strat.name} ${v.strat.source || ""} ${v.tf}`.toLowerCase().includes(q))) return false;
  if (f === "all") return true;
  if (f === "tested") return !!LAB.results[v.id];
  if (f === "published") return LAB.published.has(v.id);
  return v.strat.group === f;
}

function labMain(mine = false) {
  const all = labVariants().filter((v) => !mine || v.strat.origin === "custom");
  const list = all.filter(labFilterMatch);
  const order = { good: 0, weak: 1, few: 2, bad: 3 };
  list.sort((a, b) => {
    const ea = LAB.results[a.id], eb = LAB.results[b.id];
    if (!ea !== !eb) return ea ? -1 : 1;
    if (ea && eb) return (order[ea.stats.verdict] - order[eb.stats.verdict]) || ((eb.stats.avg_r ?? -9) - (ea.stats.avg_r ?? -9));
    return a.strat.name.localeCompare(b.strat.name, "bg");
  });
  const visibleIds = new Set(all.map((v) => v.id));
  const tested = Object.keys(LAB.results).filter((id) => visibleIds.has(id)).length;
  const good = Object.values(LAB.results).filter((e) => e && visibleIds.has(e.id) && e.stats.verdict === "good").length;
  const sel = LAB.selected.size;
  const p = LAB.progress;
  const loadBox = LAB.loaded
    ? `<p style="font-size:13px">✓ Историята е заредена: ${esc(LAB.loaded)}</p>`
    : LAB.loading
      ? `<p style="font-size:13px">${esc(LAB.loading)}</p><div class="bar-track" style="margin-top:8px"><span class="bar-green" style="width:${LAB.loadPct || 0}%"></span></div>`
      : `<p class="what" style="margin-bottom:10px">Цялата история е около 32 MB (по-малко с компресия). Сваля се само веднъж, докато е отворена страницата.</p>
         <button class="btn btn-primary" data-lab="load">Зареди историята</button>${LAB.loadError ? `<div class="risk-notice">${esc(LAB.loadError)}</div>` : ""}`;
  return `
    <div class="page-heading"><div><p class="kicker">САМО ЗА АДМИНИСТРАТОР</p><h1>${S.route.view === "workshop" ? "Мои стратегии" : "Лаборатория"}</h1>
      <p>${mine ? "Запази идея, провери правилата и я тествай. Черновите и резултатите им остават тук, докато изрично не ги публикуваш." : "Тествай дневните или суинг вариантите. Новите идеи първо минават през исторически тест и отделен период за проверка."}</p></div>
      <div class="chips-row"><a class="btn btn-outline" href="${labBase()}/new">+ Нова стратегия</a></div></div>
    <details class="panel" style="margin-bottom:14px" ${LAB.geminiChecking || LAB.geminiCheck ? "open" : ""}><summary>Пулс · проверка на Gemini</summary><p class="what">Проверява ключа и достъпните модели, без да заявява анализ. Стойността на ключа не се показва.</p>
      <button class="btn btn-outline" type="button" data-lab="gemini-check" ${LAB.geminiChecking ? "disabled" : ""}>${LAB.geminiChecking ? "Проверявам връзката…" : "Провери Gemini"}</button>
      ${LAB.geminiCheck ? `<p role="status">${esc(LAB.geminiCheck.message || LAB.geminiCheck.error)}</p>${LAB.geminiCheck.code ? `<p class="what">Код: ${esc(LAB.geminiCheck.code)}</p>` : ""}${LAB.geminiCheck.models?.length ? `<p class="what">Избран: ${esc(LAB.geminiCheck.configured_model)}. Достъпни: ${LAB.geminiCheck.models.map(esc).join(", ")}</p>` : ""}` : ""}</details>
    <div class="grid-2 even">
      <section class="panel"><p class="kicker">1. ИСТОРИЯ</p><h3 style="margin-bottom:8px">Цени за теста</h3>${loadBox}</section>
      <section class="panel"><p class="kicker">2. ТЕСТ И ПУБЛИКУВАНЕ</p><h3 style="margin-bottom:8px">${tested} тествани · ${good} „Силна“ · ${LAB.published.size} публикувани</h3>
        <div class="chips-row">
          <button class="btn btn-primary" data-lab="run" ${!LAB.loaded || !sel || LAB.running ? "disabled" : ""}>${LAB.running ? "Тествам…" : `Тествай избраните (${sel})`}</button>
          <button class="btn btn-outline" data-lab="save" ${LAB.saving ? "disabled" : ""}>${LAB.saving ? "Записвам…" : LAB.dirty ? "Запази тестовете ●" : "Запази тестовете"}</button>
          <button class="btn btn-outline" data-lab="publish" ${LAB.saving ? "disabled" : ""}>Публикувай избраното</button>
        </div>
        ${p ? `<div class="bar-track" style="margin-top:12px"><span class="bar-green" style="width:${(p.done / p.total) * 100}%"></span></div><p class="what">${p.done} от ${p.total} · ${esc(p.label || "")}</p>` : ""}
        <p class="what">Запазването на тестовете не променя сайта. Избери варианти в колона „На сайта“ и натисни „Публикувай избраното“, когато си готов. Добрата оценка сама по себе си не публикува стратегия.</p>
        ${LAB.log.length ? `<div class="warn-line">${LAB.log.slice(-4).map(esc).join("<br>")}</div>` : ""}</section>
    </div>
    <div class="warn-line info" style="margin:14px 0">Внимание: колкото повече стратегии тестваш, толкова повече ще изглеждат добре само от късмет. Вярвай на тези, които печелят в двете половини на периода, на няколко двойки и после и на живо.</div>
    ${mine && LAB.history.length ? `<details class="panel"><summary>Предишни версии (${LAB.history.length})</summary>${LAB.history.slice().reverse().map((h) => `<p>${esc(h.strategy.name)} · версия ${h.strategy.version || 1} · ${Object.keys(h.entries || {}).length} запазени теста</p>`).join("")}</details>` : ""}
    <div class="filter-bar"><div class="filter-group">${GROUP_FILTERS.map(([k, l]) => `<button class="chip ${LAB.filter === k ? "active" : ""}" data-lab-filter="${esc(k)}">${l}</button>`).join("")}</div>
      <label class="search-wrap"><span>⌕</span><input type="search" id="lab-search" value="${esc(LAB.query)}" placeholder="Търси стратегия" aria-label="Търси стратегия"></label></div>
    <div class="chips-row" style="margin-bottom:10px"><button class="chip" data-lab="select-visible">Избери показаните (${list.length})</button><button class="chip" data-lab="select-none">Изчисти избора</button>
      <button class="chip" data-lab="publish-none">Махни всички от сайта</button></div>
    <section class="panel"><div class="table-wrap"><table class="data lab-table">
      <thead><tr><th></th><th>Стратегия</th><th>Графика</th><th>Оценка</th><th class="num">Сделки</th><th class="num">Среден</th><th class="num">PF</th><th class="num">1-ва / 2-ра половина</th><th class="num">Покупки / Продажби</th><th>На сайта</th><th></th></tr></thead>
      <tbody>${list.map((v) => {
        const e = LAB.results[v.id];
        const canCopy = !!v.strat.spec;
        return `<tr class="${LAB.selected.has(v.id) ? "sel" : ""}">
          <td><input type="checkbox" data-lab-sel="${esc(v.id)}" ${LAB.selected.has(v.id) ? "checked" : ""} aria-label="Избери ${esc(v.strat.name)} ${esc(v.tf)}"></td>
          <td><strong>${esc(v.strat.name)}</strong>${v.strat.spec?.version ? ` <small>версия ${v.strat.spec.version}</small>` : ""} <span class="tag tag-${esc(v.strat.origin)}">${esc(v.strat.group)}</span>${v.strat.approx ? ' <span class="tag tag-approx">приблиз.</span>' : ""}<br><small class="muted">${esc(v.strat.source || "")}${v.strat.pairs ? ` · ${v.strat.pairs.join(", ")}` : ""}</small></td>
          <td>${esc(FX.TIMEFRAMES[v.tf].label)}</td>${labRowStats(e)}
          <td><label class="switch"><input type="checkbox" data-lab-pub="${esc(v.id)}" ${LAB.published.has(v.id) ? "checked" : ""} ${e ? "" : "disabled"}><span>${LAB.published.has(v.id) ? "да" : "не"}</span></label></td>
          <td>${canCopy ? `<button class="tiny-btn" data-lab-copy="${esc(v.key)}" title="Направи копие и промени правилата">Копие</button>` : ""}${v.strat.origin === "custom" ? ` <a class="tiny-btn" href="${labBase()}/edit/${esc(v.key)}">Промени</a>` : ""}</td></tr>`;
      }).join("")}</tbody></table></div></section>`;
}

/* ------------------------------------------------------------ зареждане и тест */

function labWorker() {
  if (!LAB.worker) {
    LAB.worker = new Worker("assets/js/fx-worker.js");
    LAB.worker.onmessage = labOnMessage;
    LAB.worker.onerror = (e) => { LAB.log.push("Грешка в теста: " + e.message); LAB.running = false; labRender(); };
  }
  return LAB.worker;
}

async function labLoadHistory() {
  LAB.loading = "Свалям историята…";
  LAB.loadPct = 0;
  LAB.loadError = "";
  labRender();
  try {
    const prices = {}, files = [];
    for (const p of FX.PAIR_KEYS) for (const tf of ["M15", "H1", "D1"]) files.push([p, tf]);
    let done = 0, bars = 0;
    await Promise.all(files.map(async ([p, tf]) => {
      const r = await fetch(`data/prices/${p}_${tf}.json?t=${Math.floor(Date.now() / 600000)}`);
      if (!r.ok) throw new Error(`${p} ${tf}: ${r.status}`);
      const data = await r.json();
      (prices[p] = prices[p] || {})[tf] = data.bars || [];
      bars += (data.bars || []).length;
      done++;
      LAB.loading = `Свалям историята: ${done} от ${files.length} файла…`;
      LAB.loadPct = (done / files.length) * 100;
      labRender();
    }));
    LAB.loading = "Подготвям графиките…";
    labRender();
    LAB.bars = bars;
    labWorker().postMessage({ cmd: "load", prices, quotes: (S.meta && S.meta.quotes) || {}, now: now(), launch: S.meta ? S.meta.launch : 0, custom: LAB.custom });
  } catch (e) {
    LAB.loading = null;
    LAB.loadError = "Историята не можа да се свали: " + e.message;
    labRender();
  }
}

function labRun() {
  const allowed = new Set(labVariants().map((v) => v.id));
  const items = [...LAB.selected].filter((id) => allowed.has(id)).map((id) => { const [key, tf] = splitId(id); return { key, tf }; });
  if (!items.length) return;
  LAB.running = true;
  LAB.progress = { done: 0, total: items.length, label: "започвам" };
  labRender();
  labWorker().postMessage({ cmd: "run", items });
}

function labOnMessage(ev) {
  const m = ev.data;
  if (m.type === "loaded") {
    LAB.loading = null;
    LAB.loaded = `${F.num(0).format(LAB.bars)} свещи за 8 инструмента (подготовка ${F.num(1).format(m.ms / 1000)} сек.)`;
    toast("Историята е заредена. Избери стратегии и натисни „Тествай“.");
  } else if (m.type === "result") {
    if (m.entry) {
      LAB.results[m.id] = m.entry;
      // Публикуването е отделен, изричен избор.
    } else LAB.log.push(`${m.id}: няма данни за тази графика`);
    LAB.dirty = true;
    LAB.progress = { done: m.done, total: m.total, label: `${m.id} (${F.num(1).format(m.ms / 1000)} сек.)` };
  } else if (m.type === "done") {
    LAB.running = false;
    toast("Тестът приключи. Запази резултатите, за да ги прегледаш по-късно.");
  } else if (m.type === "warn") LAB.log.push(m.text);
  else if (m.type === "error") { LAB.running = false; LAB.log.push("Грешка: " + m.text.split("\n")[0]); console.error(m.text); }
  labRender();
}

let labRenderTimer = null;
function labRender() {
  if (!["lab", "workshop"].includes(S.route.view)) return;
  clearTimeout(labRenderTimer);
  labRenderTimer = setTimeout(() => { if (!typing()) render(); }, 120);
}

async function labSave(publish = false) {
  LAB.saving = true;
  labRender();
  try {
    const entries = {};
    for (const [id, e] of Object.entries(LAB.results)) if (e) entries[id] = e;
    const published = [...LAB.published].filter((id) => entries[id]);
    await labPost(publish ? "results" : "draft-results", { entries, published });
    LAB.dirty = false;
    toast(publish ? `Публикувани са ${published.length} варианта.` : "Тестовете са запазени в Лабораторията.");
    if (publish) await load();
  } catch (e) {
    toast("Не можа да се запише: " + e.message);
  } finally {
    LAB.saving = false;
    labRender();
  }
}

async function labCheckGemini() {
  if (LAB.geminiChecking) return;
  LAB.geminiChecking = true; LAB.geminiCheck = null; render();
  try {
    const response = await fetch("api/gemini-check.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: LAB.password }) });
    LAB.geminiCheck = await response.json();
  } catch (_error) { LAB.geminiCheck = { error: "Не получихме отговор от PHP проверката. Провери дали всички файлове са обновени." }; }
  finally { LAB.geminiChecking = false; render(); }
}

/* ------------------------------------------------------------ конструктор */

const COND_OPS = [[">", "е над"], ["<", "е под"], ["cross_above", "пресича нагоре"], ["cross_below", "пресича надолу"], ["rising", "расте"], ["falling", "пада"]];
const PRICE_OPTS = [["close", "Цена (затваряне)"], ["open", "Откриване"], ["high", "Връх на свещта"], ["low", "Дъно на свещта"]];
const IND_NAMES = { ema: "EMA", sma: "SMA", rsi: "RSI", stoch: "Стохастик", cci: "CCI", wpr: "Williams %R", mom: "Momentum", ao: "Awesome Oscillator", macd: "MACD", adx: "ADX / DI", atr: "ATR", bb: "Bollinger", keltner: "Keltner", donchian: "Дончиан (най-високо/ниско)", st: "Supertrend", psar: "Парабола (SAR)", ichi: "Ишимоку", ut: "UT Bot", heikin: "Хейкин Аши", chandelier: "Chandelier", ssl: "SSL канал", sqz: "Squeeze" };

function newForm() {
  return {
    key: "my_" + Date.now().toString(36), name: "Моята стратегия", short: "", tfs: [S.settings.style === "swing" ? "H4" : "H1"], side: "both", isNew: true,
    when: [{ a: { ind: "ema", p: [20] }, op: "cross_above", b: { ind: "ema", p: [50] } }],
    entry: { type: "market" }, stop: { type: "atr", mult: 1.5, n: 14 }, exit: { parts: [[1, 2]] }, exit_when: [],
  };
}

function operandEditor(path, op, allowNumber) {
  const isNum = typeof op === "number";
  const src = isNum ? "num" : typeof op === "string" ? op : op.ind;
  const opts = (allowNumber ? [["num", "Число"]] : []).concat(PRICE_OPTS, Object.entries(IND_NAMES));
  let extra = "";
  if (isNum) extra = `<input type="number" step="any" data-f="${path}.num" value="${op}" class="f-num">`;
  else if (typeof op === "object") {
    const def = FX.BUILDER_IND[op.ind];
    const p = op.p || def.params.map((x) => x[1]);
    extra += def.params.map(([label], k) => `<label class="f-mini">${esc(label)}<input type="number" step="any" data-f="${path}.p.${k}" value="${p[k]}"></label>`).join("");
    if (def.lines) extra += `<select data-f="${path}.line">${def.lines.map((l) => `<option value="${l}" ${(op.line || def.lines[0]) === l ? "selected" : ""}>${esc(lineName(op.ind, l))}</option>`).join("")}</select>`;
    extra += `<select data-f="${path}.tf" title="Графика"><option value="">същата графика</option>${["H1", "H4", "D1"].map((tf) => `<option value="${tf}" ${op.tf === tf ? "selected" : ""}>от графика ${FX.TIMEFRAMES[tf].label}</option>`).join("")}</select>`;
  }
  return `<span class="f-operand"><select data-f="${path}.src">${opts.map(([v, l]) => `<option value="${v}" ${src === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>${extra}</span>`;
}

function lineName(ind, l) {
  const names = { k: "%K", d: "%D", line: "линия", signal: "сигнална", hist: "хистограма", adx: "ADX", pdi: "+DI", mdi: "−DI", mid: "средна", upper: "горна", lower: "долна", dir: "посока", top: "горе на облака", bottom: "долу на облака", tenkan: "Tenkan", kijun: "Kijun", open: "откриване", close: "затваряне", long: "долна (за покупки)", short: "горна (за продажби)", high: "на върховете", low: "на дъната", on: "свиване", val: "импулс" };
  return names[l] || l;
}

function cmpBody(path, c) {
  const needsB = !(c.op === "rising" || c.op === "falling");
  const known = COND_OPS.some(([v]) => v === c.op);
  if (!known) return `<span class="f-fixed">${esc(FX.condText(c))}</span>`;
  return `${operandEditor(path + ".a", c.a, false)}<select data-f="${path}.op">${COND_OPS.map(([v, l]) => `<option value="${v}" ${c.op === v ? "selected" : ""}>${l}</option>`).join("")}</select>${needsB ? operandEditor(path + ".b", c.b === undefined ? 0 : c.b, true) : ""}`;
}

function condEditor(listName, k, c) {
  const path = `${listName}.${k}`;
  const kind = c.pat ? "pat" : c.hours ? "hours" : c.within ? "within" : c.days ? "days" : "cmp";
  let body;
  if (kind === "pat") body = `<select data-f="${path}.pat">${Object.entries(FX.BUILDER_PATTERNS).map(([key, p]) => `<option value="${key}" ${c.pat === key ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select>`;
  else if (kind === "hours") body = `от <input type="number" min="0" max="23" data-f="${path}.hours.0" value="${c.hours[0]}" class="f-num"> до <input type="number" min="1" max="24" data-f="${path}.hours.1" value="${c.hours[1]}" class="f-num"> часа (българско време)`;
  else if (kind === "within") body = `<input type="number" min="1" max="50" data-f="${path}.within" value="${c.within}" class="f-num"> свещи назад: ${cmpBody(path + ".cond", c.cond)}`;
  else if (kind === "days") body = `<span class="f-fixed">${esc(FX.condText(c))}</span>`;
  else body = cmpBody(path, c);
  return `<div class="f-cond"><select data-f="${path}.kind" class="f-kind" aria-label="Вид условие">
      <option value="cmp" ${kind === "cmp" ? "selected" : ""}>Сравнение</option><option value="within" ${kind === "within" ? "selected" : ""}>Скоро е било</option>
      <option value="pat" ${kind === "pat" ? "selected" : ""}>Свещ</option><option value="hours" ${kind === "hours" ? "selected" : ""}>Час</option>${kind === "days" ? `<option value="days" selected>Дни</option>` : ""}</select>${body}
    <button type="button" class="tiny-btn danger" data-lab-delcond="${listName}.${k}" aria-label="Махни условието">✕</button></div>`;
}

function labBuilder() {
  const f = LAB.form || (LAB.form = newForm());
  if (!f.side) f.side = "both";
  if (!f.exit) f.exit = { parts: [[0.5, 1], [0.5, 2]], after_first: "entry" };
  if (!f.stop) f.stop = { type: "atr", mult: 1.5, n: 14 };
  if (!f.entry) f.entry = { type: "market" };
  let preview = "", error = "";
  try {
    const st = FX.build(f);
    preview = `<ol class="rules">${st.rules.map((r) => `<li>${esc(r)}</li>`).join("")}</ol><p class="kicker" style="margin-top:12px">ИЗХОД</p><ul class="rules common">${st.exit_rules.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`;
  } catch (e) { error = e.message; }
  const exitMode = f.exit.parts.length > 1 ? "split" : f.exit.parts[0][1] ? "one" : "none";
  return `
    <div class="detail-back"><a class="back-btn" href="${labBase()}">← Лаборатория</a></div>
    <div class="page-heading"><div><p class="kicker">КОНСТРУКТОР</p><h1>${f.isNew ? "Нова стратегия" : "Промяна на стратегия"}</h1>
      <p>Описваш условията за <strong>покупка</strong>. Продажбата се прави сама, огледално: „над“ става „под“, RSI 30 става 70 и т.н.</p></div></div>
    <div class="grid-2"><div class="stack">
      <section class="panel"><p class="kicker">ОСНОВНО · ${STYLE_NAMES[S.settings.style].toUpperCase()}</p>
        <div class="form-field"><span class="label">Инструменти</span><div class="choice">${FX.PAIR_KEYS.map((pair) => `<label><input type="checkbox" data-f-pair="${pair}" ${!f.pairs || f.pairs.includes(pair) ? "checked" : ""}><span>${FX.PAIRS[pair].name}</span></label>`).join("")}</div></div>
        <div class="form-field"><label>Име</label><input data-f="name" value="${esc(f.name)}"></div>
        <div class="form-field"><label>Кратко описание</label><input data-f="short" value="${esc(f.short || "")}" placeholder="по желание"></div>
        <div class="form-field"><span class="label">Графики</span><div class="choice">${FX.TF_KEYS.filter((tf) => styleOk(FX.TIMEFRAMES[tf].style)).map((tf) => `<label><input type="checkbox" data-f-tf="${tf}" ${f.tfs.includes(tf) ? "checked" : ""}><span>${FX.TIMEFRAMES[tf].label}</span></label>`).join("")}</div></div>
        <div class="form-field"><span class="label">Посока</span><div class="choice">${[["both", "Покупки и продажби"], ["long", "Само покупки"], ["short", "Само продажби"]].map(([v, l]) => `<label><input type="radio" name="f-side" data-f="side" value="${v}" ${(f.side || "both") === v ? "checked" : ""}><span>${l}</span></label>`).join("")}</div></div>
      </section>
      <section class="panel"><p class="kicker">ВХОД: ВСИЧКИ УСЛОВИЯ ТРЯБВА ДА СА ИЗПЪЛНЕНИ</p>
        ${f.when.map((c, k) => condEditor("when", k, c)).join("")}
        <button type="button" class="btn btn-quiet btn-sm" data-lab-addcond="when">+ Условие</button>
        <div class="form-field" style="margin-top:14px"><span class="label">Как се влиза</span><div class="choice">
          <label><input type="radio" name="f-entry" data-f="entry.type" value="market" ${f.entry.type === "market" ? "checked" : ""}><span>Веднага (пазарна поръчка)</span></label>
          <label><input type="radio" name="f-entry" data-f="entry.type" value="stop" ${f.entry.type === "stop" ? "checked" : ""}><span>При пробив на върха на свещта</span></label></div></div>
      </section>
      <section class="panel"><p class="kicker">СТОП И ИЗХОД</p>
        <div class="form-field"><span class="label">Стоп</span><div class="choice">
          <label><input type="radio" name="f-stop" data-f="stop.type" value="atr" ${f.stop.type === "atr" ? "checked" : ""}><span>× ATR</span></label>
          <label><input type="radio" name="f-stop" data-f="stop.type" value="bar" ${f.stop.type === "bar" ? "checked" : ""}><span>Под сигналната свещ</span></label>
          <label><input type="radio" name="f-stop" data-f="stop.type" value="swing" ${f.stop.type === "swing" ? "checked" : ""}><span>Под дъното от N свещи</span></label>
          <label><input type="radio" name="f-stop" data-f="stop.type" value="line" ${f.stop.type === "line" ? "checked" : ""}><span>На линия на индикатор</span></label></div>
          ${f.stop.type === "line" ? `<div class="f-cond">${operandEditor("stop.a", f.stop.a, false)}</div>` : ""}
          ${f.stop.type === "pips" ? `<label class="f-mini">Пипса <input type="number" min="1" data-f="stop.v" value="${f.stop.v}"></label>` : ""}
          ${f.stop.type === "atr" ? `<label class="f-mini">× ATR <input type="number" step="0.1" min="0.2" data-f="stop.mult" value="${f.stop.mult || 1.5}"></label>` : ""}
          ${f.stop.type === "swing" ? `<label class="f-mini">Свещи <input type="number" min="2" data-f="stop.n" value="${f.stop.n || 10}"></label>` : ""}</div>
        <div class="form-field"><span class="label">Цел</span><div class="choice">
          <label><input type="radio" name="f-exit" data-f="exitmode" value="one" ${exitMode === "one" ? "checked" : ""}><span>Една цел</span></label>
          <label><input type="radio" name="f-exit" data-f="exitmode" value="split" ${exitMode === "split" ? "checked" : ""}><span>Две цели (1R и 2R)</span></label>
          <label><input type="radio" name="f-exit" data-f="exitmode" value="none" ${exitMode === "none" ? "checked" : ""}><span>Без цел</span></label></div>
          ${exitMode === "one" ? `<label class="f-mini">× риска <input type="number" step="0.1" min="0.3" data-f="exit.r" value="${f.exit.parts[0][1]}"></label>` : ""}
          <label class="f-check"><input type="checkbox" data-f="exit.trail" ${f.exit.trail ? "checked" : ""}> Плаващ стоп (следва цената на разстоянието на първоначалния стоп)</label>
          <label class="f-check"><input type="checkbox" data-f="exit.be" ${f.exit.be ? "checked" : ""}> Стоп на входа, когато печалбата стигне 1 × риска</label>
          <label class="f-mini">Затвори след най-много <input type="number" min="0" data-f="max_bars" value="${f.max_bars || ""}" placeholder="авт."> свещи</label></div>
        <p class="kicker" style="margin-top:12px">ИЗХОД ПО ПРАВИЛО (ПО ЖЕЛАНИЕ)</p>
        ${(f.exit_when || []).map((c, k) => condEditor("exit_when", k, c)).join("")}
        <button type="button" class="btn btn-quiet btn-sm" data-lab-addcond="exit_when">+ Условие за изход</button>
      </section>
    </div><div class="stack">
      <section class="panel"><p class="kicker">ТАКА ЩЕ ИЗГЛЕЖДА НА САЙТА</p><h3 style="margin-bottom:6px" id="f-preview-name">${esc(f.name)}</h3>
        ${error ? `<div class="risk-notice">Грешка: ${esc(error)}</div>` : preview}</section>
      <section class="panel"><div class="chips-row">
        <button class="btn btn-primary" data-lab="form-save" ${error || !f.tfs.length || !f.when.length ? "disabled" : ""}>Запази стратегията</button>
        <a class="btn btn-outline" href="${labBase()}">Откажи</a>
        ${!f.isNew ? `<button class="btn btn-danger" data-lab="form-delete">Изтрий</button>` : ""}</div>
        <p class="what">След запазване стратегията се появява в Лабораторията (група „Мои“), готова за тест.</p></section>
    </div></div>`;
}

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for (let k = 0; k < keys.length - 1; k++) o = o[keys[k]];
  o[keys[keys.length - 1]] = value;
}
function getPath(obj, path) { return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj); }

/** Промяна на поле в конструктора. */
function formChange(path, raw, el) {
  const f = LAB.form;
  const parts = path.split(".");
  const last = parts[parts.length - 1];
  const parent = parts.slice(0, -1).join(".");
  if (path === "name" || path === "short") { f[path] = raw; return false; }
  if (path === "side") { f.side = raw; return true; }
  if (path === "exitmode") {
    f.exit = raw === "split" ? { parts: [[0.5, 1], [0.5, 2]], after_first: "entry", trail: f.exit.trail } : raw === "one" ? { parts: [[1, 2]], trail: f.exit.trail } : { parts: [[1, null]], trail: f.exit.trail };
    return true;
  }
  if (path === "exit.r") { f.exit.parts[0][1] = Math.max(0.3, Number(raw) || 2); return true; }
  if (path === "exit.trail") { f.exit.trail = el.checked; return true; }
  if (path === "stop.type") { f.stop = raw === "atr" ? { type: "atr", mult: 1.5, n: 14 } : raw === "swing" ? { type: "swing", n: 10 } : raw === "line" ? { type: "line", a: { ind: "st", p: [10, 3], line: "line" } } : { type: "bar" }; return true; }
  if (path === "stop.mult" || path === "stop.n" || path === "stop.v") { setPath(f, path, Number(raw)); return true; }
  if (path === "exit.be") { if (el.checked) f.exit.be = { r: 1 }; else delete f.exit.be; return true; }
  if (path === "max_bars") { const n = Math.round(Number(raw)); if (n > 0) f.max_bars = n; else delete f.max_bars; return true; }
  if (last === "within") { getPath(f, parent).within = Math.max(1, Math.round(Number(raw)) || 1); return true; }
  if (path === "entry.type") { f.entry = { type: raw }; return true; }
  if (last === "kind") {
    const cmp = { a: "close", op: ">", b: { ind: "ema", p: [200] } };
    const c = raw === "pat" ? { pat: "engulf" } : raw === "hours" ? { hours: [8, 18] } : raw === "within" ? { within: 3, cond: cmp } : cmp;
    setPath(f, parent, c);
    return true;
  }
  if (last === "src") {
    const v = raw === "num" ? 0 : FX.BUILDER_PRICE[raw] ? raw : { ind: raw, p: FX.BUILDER_IND[raw].params.map((x) => x[1]) };
    setPath(f, parent, v);
    return true;
  }
  if (last === "num") { setPath(f, parent, Number(raw)); return true; }
  if (parts[parts.length - 2] === "p") {
    const o = getPath(f, parts.slice(0, -2).join("."));
    if (!Array.isArray(o.p)) o.p = FX.BUILDER_IND[o.ind].params.map((x) => x[1]);
    o.p[Number(last)] = Number(raw);
    return true;
  }
  if (last === "line") { getPath(f, parent).line = raw; return true; }
  if (last === "tf") { const o = getPath(f, parent); if (raw) o.tf = raw; else delete o.tf; return true; }
  if (last === "op" || last === "pat") { setPath(f, path, raw); return true; }
  if (parts[parts.length - 2] === "hours") { getPath(f, parent)[Number(last)] = Number(raw); return true; }
  return false;
}

async function formSave(remove) {
  const f = LAB.form;
  const spec = JSON.parse(JSON.stringify(f));
  delete spec.isNew;
  spec.tfs = spec.tfs.filter((tf) => styleOk(FX.TIMEFRAMES[tf]?.style));
  if (!remove && (!spec.tfs.length || !spec.when.length || (spec.pairs && !spec.pairs.length))) { toast("Избери графика, инструмент и условие за вход."); return; }
  let list = LAB.custom.filter((x) => x.key !== spec.key);
  if (!remove) list.push(spec);
  try {
    const response = await labPost("custom", list);
    labWorkspace(response.workspace);
    if (LAB.worker) LAB.worker.postMessage({ cmd: "custom", custom: LAB.custom });
    if (remove) {
      for (const id of [...LAB.published]) if (id.startsWith(spec.key + "-")) LAB.published.delete(id);
      toast("Черновата е изтрита. Публикуваният вариант остава до следващото публикуване.");
    } else {
      for (const tf of spec.tfs) LAB.selected.add(`${spec.key}-${tf}`);
      toast("Черновата е запазена. След промяна на правилата е нужен нов тест.");
    }
    LAB.form = null;
    LAB.filter = remove ? "all" : "Мои стратегии";
    location.hash = labBase();
  } catch (e) {
    toast("Не можа да се запише: " + e.message);
  }
}

/* ------------------------------------------------------------ събития */

document.addEventListener("submit", async (ev) => {
  if (ev.target.id !== "lab-login") return;
  ev.preventDefault();
  LAB.password = document.getElementById("lab-pass").value;
  LAB.checking = true;
  LAB.authError = "";
  render();
  try {
    const response = await labPost("workspace");
    labWorkspace(response.workspace);
    LAB.authed = true;
    try { sessionStorage.setItem("lab-pass", LAB.password); } catch (_e) { /* няма значение */ }
  } catch (e) {
    LAB.authError = e.message;
  }
  LAB.checking = false;
  render();
});

document.addEventListener("click", (ev) => {
  const t = ev.target;
  const act = t.closest("[data-lab]");
  if (act) {
    const a = act.dataset.lab;
    if (a === "gemini-check") labCheckGemini();
    else if (a === "load") labLoadHistory();
    else if (a === "run") labRun();
    else if (a === "save") labSave();
    else if (a === "publish") labSave(true);
    else if (a === "select-visible") { labVariants().filter((v) => S.route.view !== "workshop" || v.strat.origin === "custom").filter(labFilterMatch).forEach((v) => LAB.selected.add(v.id)); render(); }
    else if (a === "select-none") { LAB.selected.clear(); render(); }
    else if (a === "publish-good") { for (const [id, e] of Object.entries(LAB.results)) if (e && e.stats.verdict === "good") LAB.published.add(id); LAB.dirty = true; render(); }
    else if (a === "publish-none") { LAB.published.clear(); LAB.dirty = true; render(); }
    else if (a === "form-save") formSave(false);
    else if (a === "form-delete") { if (confirm("Да изтрия ли стратегията?")) formSave(true); }
    return;
  }
  const fl = t.closest("[data-lab-filter]");
  if (fl) { LAB.filter = fl.dataset.labFilter; render(); return; }
  const cp = t.closest("[data-lab-copy]");
  if (cp) {
    const strat = labCatalog()[cp.dataset.labCopy];
    const spec = JSON.parse(JSON.stringify(strat.spec));
    for (const k of ["origin", "group", "source", "url", "approx"]) delete spec[k];
    delete spec.version; delete spec.updated;
    spec.tfs = spec.tfs.filter((tf) => styleOk(FX.TIMEFRAMES[tf].style));
    LAB.form = Object.assign(spec, { key: "my_" + Date.now().toString(36), name: strat.name + " (копие)", isNew: true });
    if (!LAB.form.exit) LAB.form.exit = { parts: [[0.5, 1], [0.5, 2]], after_first: "entry" };
    if (!LAB.form.stop) LAB.form.stop = { type: "atr", mult: 1.5, n: 14 };
    if (!LAB.form.entry) LAB.form.entry = { type: "market" };
    location.hash = labBase() + "/new";
    return;
  }
  const add = t.closest("[data-lab-addcond]");
  if (add) {
    const list = LAB.form[add.dataset.labAddcond] || (LAB.form[add.dataset.labAddcond] = []);
    list.push({ a: "close", op: ">", b: { ind: "ema", p: [200] } });
    render();
    return;
  }
  const del = t.closest("[data-lab-delcond]");
  if (del) {
    const [list, k] = del.dataset.labDelcond.split(".");
    LAB.form[list].splice(Number(k), 1);
    render();
  }
});

document.addEventListener("change", (ev) => {
  const t = ev.target;
  if (t.dataset.fPair && LAB.form) { const pairs = new Set(LAB.form.pairs || FX.PAIR_KEYS); if (t.checked) pairs.add(t.dataset.fPair); else pairs.delete(t.dataset.fPair); LAB.form.pairs = [...pairs]; return; }
  if (t.dataset.labSel) { if (t.checked) LAB.selected.add(t.dataset.labSel); else LAB.selected.delete(t.dataset.labSel); render(); return; }
  if (t.dataset.labPub) { if (t.checked) LAB.published.add(t.dataset.labPub); else LAB.published.delete(t.dataset.labPub); LAB.dirty = true; render(); return; }
  if (t.dataset.fTf) {
    const f = LAB.form;
    f.tfs = FX.TF_KEYS.filter((tf) => (tf === t.dataset.fTf ? t.checked : f.tfs.includes(tf)));
    render();
    return;
  }
  if (t.dataset.f && LAB.form) {
    const value = t.type === "checkbox" ? t.checked : t.value;
    const key = t.dataset.f;
    if (key === "name" || key === "short") return;
    formChange(key, value, t);
    render();
    const again = document.querySelector(`[data-f="${CSS.escape(key)}"]${t.type === "radio" ? `[value="${CSS.escape(t.value)}"]` : ""}`);
    if (again) again.focus();
  }
});

document.addEventListener("input", (ev) => {
  const t = ev.target;
  if (t.id === "lab-search") {
    LAB.query = t.value;
    const pos = t.selectionStart;
    render();
    const again = document.getElementById("lab-search");
    if (again) { again.focus(); again.setSelectionRange(pos, pos); }
  } else if (t.dataset.f && LAB.form && (t.dataset.f === "name" || t.dataset.f === "short")) {
    LAB.form[t.dataset.f] = t.value;
    const h = document.getElementById("f-preview-name");
    if (h && t.dataset.f === "name") h.textContent = t.value;
  }
});

// Ако паролата е запомнена в този раздел - влизаме директно.
if (LAB.password) {
  labPost("workspace").then((response) => { labWorkspace(response.workspace); LAB.authed = true; if (["lab", "workshop"].includes(S.route.view)) render(); }).catch(() => { LAB.password = ""; });
}
