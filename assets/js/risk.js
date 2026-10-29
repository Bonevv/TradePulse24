"use strict";

const JOURNAL_KEY = "tradepulse24-journal-v1";
const RISK_DEFAULTS = { daily: 1.5, weekly: 4, open: 2, instrument: 1, currency: 1.5 };
const RiskJournal = {
  validate(trade) {
    if (!trade || typeof trade.id !== "string" || trade.id.length > 100 || !FX.PAIR_KEYS.includes(trade.pair) || !["day", "swing"].includes(trade.style)
      || !["USD", "EUR"].includes(trade.currency) || !["open", "closed"].includes(trade.status) || ![-1, 1].includes(trade.dir)) throw new Error("В дневника има невалидна сделка.");
    for (const key of ["risk", "risk_pct", "opened"]) if (!Number.isFinite(trade[key]) || trade[key] <= 0) throw new Error("Провери риска и времето на входа.");
    if (trade.risk_pct > 100 || trade.risk > 1e9 || trade.opened > Date.now() / 1000 + 60) throw new Error("Провери риска и времето на входа.");
    if (trade.status === "closed" && (!Number.isFinite(trade.net) || Math.abs(trade.net) > 1e9 || !Number.isFinite(trade.closed) || trade.closed < trade.opened || trade.closed > Date.now() / 1000 + 60)) throw new Error("Провери резултата и часа на затваряне.");
    if (typeof trade.note !== "string" || trade.note.length > 1000 || !["plan", "early", "stop", "unplanned"].includes(trade.tag)) throw new Error("Провери бележката и самооценката.");
    const valid = { id: trade.id, pair: trade.pair, style: trade.style, currency: trade.currency, status: trade.status, dir: trade.dir,
      risk: trade.risk, risk_pct: trade.risk_pct, opened: trade.opened, net: trade.status === "closed" ? trade.net : null,
      closed: trade.status === "closed" ? trade.closed : null, tag: trade.tag, note: trade.note };
    for (const key of ["entry_price", "initial_stop", "current_stop", "lots", "exit_price", "pip_value"]) {
      if (trade[key] === undefined || trade[key] === null || trade[key] === "") continue;
      if (!Number.isFinite(trade[key]) || trade[key] <= 0 || trade[key] > 1e9) throw new Error("Провери цените и обема на сделката.");
      valid[key] = trade[key];
    }
    if (valid.entry_price && valid.initial_stop && (valid.entry_price - valid.initial_stop) * valid.dir <= 0) throw new Error("Първоначалният стоп е от грешната страна на входа.");
    if (trade.signal_id !== undefined) {
      if (typeof trade.signal_id !== "string" || !/^[a-zA-Z0-9_-]{5,160}$/.test(trade.signal_id)) throw new Error("Невалидна връзка към сигнал.");
      valid.signal_id = trade.signal_id;
    }
    if (trade.model_r !== undefined && trade.model_r !== null) {
      if (!Number.isFinite(trade.model_r) || Math.abs(trade.model_r) > 1e6) throw new Error("Невалиден резултат на модела.");
      valid.model_r = trade.model_r;
    }
    if (trade.model_version !== undefined) {
      if (!Number.isInteger(trade.model_version) || trade.model_version < 1) throw new Error("Невалидна версия на свързания сигнал.");
      valid.model_version = trade.model_version;
    }
    if (trade.model_cost_model !== undefined) {
      if (typeof trade.model_cost_model !== "string" || !/^(model-v1|costs-[a-f0-9]{8})$/.test(trade.model_cost_model)) throw new Error("Невалиден профил на свързания сигнал.");
      valid.model_cost_model = trade.model_cost_model;
    }
    if (trade.partials !== undefined) {
      if (!Array.isArray(trade.partials) || trade.partials.length > 100 || (trade.partials.length && !valid.lots)) throw new Error("За частичен изход е нужен първоначален обем.");
      valid.partials = trade.partials.map((part) => {
        if (!part || ![part.at, part.price, part.lots, part.net].every(Number.isFinite) || part.at < trade.opened
          || part.at > (valid.closed || Date.now() / 1000) + 60 || part.price <= 0 || part.lots <= 0 || Math.abs(part.net) > 1e9) throw new Error("Провери частичния изход и часа му.");
        return { at: part.at, price: part.price, lots: part.lots, net: part.net };
      }).sort((a, b) => a.at - b.at);
      const used = valid.partials.reduce((sum, part) => sum + part.lots, 0);
      if (valid.lots && (used > valid.lots + 1e-8 || valid.status === "open" && used >= valid.lots - 1e-8)) throw new Error("Частичните изходи надхвърлят отворения обем. При изцяло затворена позиция избери „Приключила“.");
    }
    return valid;
  },
  remaining(trade) {
    const closedLots = (trade.partials || []).reduce((sum, part) => sum + part.lots, 0);
    return trade.lots ? Math.max(0, 1 - closedLots / trade.lots) : 1;
  },
  openRisk(trade) {
    let factor = this.remaining(trade);
    if (trade.entry_price && trade.initial_stop && trade.current_stop)
      factor *= Math.max(0, (trade.entry_price - trade.current_stop) * trade.dir) / Math.abs(trade.entry_price - trade.initial_stop);
    return trade.risk_pct * factor;
  },
  estimate(trade) {
    if (!(trade.entry_price > 0 && trade.exit_price > 0 && trade.lots > 0 && trade.pip_value > 0)) return null;
    const partial = (trade.partials || []).reduce((sum, part) => sum + part.net, 0);
    return partial + trade.dir * (trade.exit_price - trade.entry_price) / FX.PAIRS[trade.pair].pip * trade.lots * this.remaining(trade) * trade.pip_value;
  },
  stats(trades, timestamp = Date.now() / 1000) {
    const closed = trades.filter((t) => t.status === "closed").sort((a, b) => a.closed - b.closed);
    let totalR = 0, peak = 0, drawdown = 0, streak = 0, worstStreak = 0;
    const day = (t) => FX.local(t).date;
    const today = FX.local(timestamp).date;
    const weekStart = new Date(Date.UTC(Math.floor(today / 10000), Math.floor(today / 100) % 100 - 1, today % 100));
    weekStart.setUTCDate(weekStart.getUTCDate() - FX.local(timestamp).weekday);
    const monday = weekStart.getUTCFullYear() * 10000 + (weekStart.getUTCMonth() + 1) * 100 + weekStart.getUTCDate();
    let daily = 0, weekly = 0;
    for (const trade of closed) {
      const r = trade.net / trade.risk;
      totalR += r; peak = Math.max(peak, totalR); drawdown = Math.max(drawdown, peak - totalR);
      streak = r < 0 ? streak + 1 : 0; worstStreak = Math.max(worstStreak, streak);
    }
    for (const trade of trades) {
      const events = (trade.partials || []).map((part) => ({ at: part.at, net: part.net }));
      if (trade.status === "closed") events.push({ at: trade.closed, net: trade.net - events.reduce((sum, event) => sum + event.net, 0) });
      for (const event of events) if (event.net < 0 && event.at <= timestamp) {
        const loss = -event.net / trade.risk * trade.risk_pct;
        if (day(event.at) === day(timestamp)) daily += loss;
        if (day(event.at) >= monday) weekly += loss;
      }
    }
    const open = trades.filter((t) => t.status === "open");
    const exposure = {}, byPair = {};
    for (const trade of open) byPair[trade.pair] = (byPair[trade.pair] || 0) + this.openRisk(trade);
    for (const trade of open) for (const currency of [trade.pair.slice(0, 3), trade.pair.slice(3, 6)]) exposure[currency] = (exposure[currency] || 0) + 1;
    // Нетен риск по валута: покупка на EUR/USD е покупка на EUR и продажба на USD.
    // Три покупки срещу долара са три пъти един залог; противоположните посоки се компенсират.
    const byCurrency = {};
    for (const trade of open) {
      const risk = this.openRisk(trade), base = trade.pair.slice(0, 3), quote = trade.pair.slice(3, 6);
      byCurrency[base] = (byCurrency[base] || 0) + trade.dir * risk;
      byCurrency[quote] = (byCurrency[quote] || 0) - trade.dir * risk;
    }
    return { closed, open, daily, weekly, byPair, byCurrency, openRisk: open.reduce((sum, t) => sum + this.openRisk(t), 0), totalR,
      averageR: closed.length ? totalR / closed.length : null, drawdown, streak, worstStreak,
      repeated: Object.entries(exposure).filter(([, count]) => count >= 2).map(([currency]) => currency) };
  },
};

function loadJournal() {
  try {
    const raw = JSON.parse(localStorage.getItem(JOURNAL_KEY) || "null");
    if (!raw) return { trades: [], plan: { ...RISK_DEFAULTS } };
    if (!Array.isArray(raw.trades) || raw.trades.length > 1000) throw new Error("Дневникът не може да се прочете.");
    return { trades: raw.trades.map(RiskJournal.validate), plan: riskPlan(raw.plan) };
  } catch (_error) { return { trades: [], plan: { ...RISK_DEFAULTS }, unreadable: true }; }
}
function riskPlan(plan = {}) {
  return Object.fromEntries(Object.entries(RISK_DEFAULTS).map(([key, value]) => [key, Number.isFinite(Number(plan[key])) && Number(plan[key]) > 0 && Number(plan[key]) <= 50 ? Number(plan[key]) : value]));
}
const JOURNAL = { ...loadJournal(), editing: null, draft: null };
function saveJournal(trades = JOURNAL.trades, plan = JOURNAL.plan) {
  const next = { trades: trades.map(RiskJournal.validate), plan: riskPlan(plan) };
  if (next.trades.length > 1000) throw new Error("Дневникът е пълен. Изтегли копие, преди да започнеш нов.");
  localStorage.setItem(JOURNAL_KEY, JSON.stringify(next));
  Object.assign(JOURNAL, next, { unreadable: false });
}
function journalTrades() { return JOURNAL.trades.filter((t) => t.currency === S.settings.currency); }
function journalInputDate(timestamp) {
  const d = new Date(timestamp * 1000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function journalDetails(trade) {
  const fields = [["entry_price", "Реална входна цена"], ["initial_stop", "Първоначален стоп"], ["current_stop", "Текущ стоп при брокера"], ["lots", "Първоначален обем (лота)"], ["exit_price", "Цена на крайния изход"], ["pip_value", `Стойност на пипс за 1 лот (${S.settings.currency})`]];
  return `<input type="hidden" name="signal_id" value="${esc(trade.signal_id || "")}"><input type="hidden" name="model_r" value="${Number.isFinite(trade.model_r) ? trade.model_r : ""}"><input type="hidden" name="model_version" value="${trade.model_version || ""}"><input type="hidden" name="model_cost_model" value="${esc(trade.model_cost_model || "")}">
    ${fields.map(([key, label]) => `<div class="form-field"><label>${esc(label)}<input name="${key}" type="number" min="0.000001" step="any" value="${trade[key] ?? ""}"></label></div>`).join("")}
    <div class="form-field journal-note"><details><summary>Частични изходи (${(trade.partials || []).length})</summary>
      <input name="partials" type="hidden" value="${esc(JSON.stringify(trade.partials || []))}">
      <div class="table-wrap"><table class="data"><thead><tr><th>Час</th><th>Лота</th><th>Цена</th><th>Нетно</th><th></th></tr></thead><tbody data-partials-body>${(trade.partials || []).map((part, i) => `<tr><td>${esc(when(part.at))}</td><td>${part.lots}</td><td>${part.price}</td><td>${money(part.net)}</td><td><button type="button" class="tiny-btn" data-partial-remove="${i}">Махни</button></td></tr>`).join("")}</tbody></table></div>
      <div class="partial-fields"><label>Час на нов изход<input name="partial_at" type="datetime-local"></label><label>Затворени лота<input name="partial_lots" type="number" min="0.000001" step="any"></label><label>Цена<input name="partial_price" type="number" min="0.000001" step="any"></label><label>Нетно от тази част (${esc(S.settings.currency)})<input name="partial_net" type="number" step="any"></label></div>
      <p class="what">Попълни четирите полета и запази сделката. При окончателно затваряне въведи общия нетен резултат на цялата позиция, включително тези части.</p></details></div>`;
}

function journalFromForm(form) {
  const optional = (key) => form.get(key) === "" || form.get(key) === null ? undefined : Number(form.get(key));
  const partials = JSON.parse(String(form.get("partials") || "[]"));
  if (["partial_at", "partial_lots", "partial_price", "partial_net"].some((key) => form.get(key) !== null && form.get(key) !== "")) {
    if (["partial_at", "partial_lots", "partial_price", "partial_net"].some((key) => form.get(key) === null || form.get(key) === "")) throw new Error("Попълни часа, обема, цената и резултата на частичния изход.");
    partials.push({ at: new Date(String(form.get("partial_at"))).getTime() / 1000, lots: Number(form.get("partial_lots")), price: Number(form.get("partial_price")), net: Number(form.get("partial_net")) });
  }
  const signalId = String(form.get("signal_id") || ""), signal = signalId ? resolveSignal(signalId) : null;
  const modelVersion = optional("model_version"), modelCosts = String(form.get("model_cost_model") || "");
  const comparable = !signal || (!modelVersion || modelVersion === (signal.version || 1)) && (!modelCosts || modelCosts === (signal.cost_model || FX.costs.fingerprint(S.costProfile)));
  return { id: String(form.get("trade_id") || "trade_" + Date.now().toString(36)), pair: String(form.get("pair")), dir: Number(form.get("dir")),
    style: String(form.get("style")), currency: S.settings.currency, status: String(form.get("status")), risk: Number(form.get("risk")), risk_pct: Number(form.get("risk_pct")),
    opened: new Date(String(form.get("opened"))).getTime() / 1000, closed: new Date(String(form.get("closed"))).getTime() / 1000,
    net: Number(form.get("net")), tag: String(form.get("tag")), note: String(form.get("note")), partials,
    ...(signalId ? { signal_id: signalId } : {}), model_r: comparable && signal?.status === "closed" ? signal.r : optional("model_r"),
    ...(modelVersion ? { model_version: modelVersion } : {}), ...(modelCosts ? { model_cost_model: modelCosts } : {}),
    ...Object.fromEntries(["entry_price", "initial_stop", "current_stop", "lots", "exit_price", "pip_value"].map((key) => [key, optional(key)])),
  };
}

const currencyName = (code) => code === "XAU" ? "злато" : code;
const currencySide = (risk) => risk > 0 ? "в покупка" : "в продажба";
/** Валутите, към които нетният отворен риск в една посока е над личния лимит. */
function currencyOverLimit(stats, limit = JOURNAL.plan.currency) {
  return Object.entries(stats.byCurrency || {}).filter(([, risk]) => Math.abs(risk) >= limit - 1e-9).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
}

/** Колко сделки едновременно позволяват личните лимити при текущия риск на сделка (по подразбиране 2% ÷ 0,5% = 4). */
function tradeCapacity(plan = JOURNAL.plan, risk = S.settings.risk) {
  const r = Number(risk) > 0 ? Number(risk) : 0.5, fit = (limit) => Math.floor(Number(limit) / r + 1e-9);
  return { total: fit(plan.open), currency: fit(plan.currency), pair: fit(plan.instrument), risk: r };
}
/** Съвет за най-много едновременни сделки и колко са отворени сега по дневника. */
function capacityAdvice(stats = RiskJournal.stats(journalTrades())) {
  const cap = tradeCapacity(), plan = JOURNAL.plan, open = stats.open.length, pct = (v) => F.num(2).format(v) + "%";
  if (cap.total < 1) return `<div class="risk-advice full"><strong>Рискът на една сделка (${pct(cap.risk)}) е над лимита за отворен риск (${pct(plan.open)}).</strong> Намали риска на сделка в „Настройки“ или вдигни лимита в „Риск и дневник“.</div>`;
  const full = open >= cap.total;
  return `<div class="risk-advice ${full ? "full" : ""}"><strong>${full ? `Достигнат е максимумът: ${open} от ${cap.total} отворени сделки.` : `Съвет: най-много ${cap.total} ${cap.total === 1 ? "сделка" : "сделки"} едновременно · сега ${open}.`}</strong>
    ${full ? "Новите сигнали само наблюдавай, докато не затвориш позиция. " : ""}При риск ${pct(cap.risk)} на сделка и лимит ${pct(plan.open)} общ отворен риск. От тях до ${Math.max(cap.currency, 0)} с една и съща валута и до ${Math.max(cap.pair, 0)} в един инструмент; почти всички двойки са с USD, затова на практика това е лимитът за долара. Броят е по позициите, записани в дневника.</div>`;
}

function portfolioRiskNotice() {
  const stats = RiskJournal.stats(journalTrades()), limit = JOURNAL.plan.instrument;
  const over = Object.entries(stats.byPair).filter(([, risk]) => risk >= limit), currencies = currencyOverLimit(stats);
  if (!over.length && !currencies.length && stats.openRisk < JOURNAL.plan.open) return "";
  return `<div class="risk-notice">Отчетен отворен риск: ${stats.openRisk.toFixed(2)}%. ${over.map(([pair, risk]) => `${FX.PAIRS[pair].name}: ${risk.toFixed(2)}% при лимит ${limit}%.`).join(" ")} ${currencies.map(([code, risk]) => `${esc(currencyName(code))}: нетно ${Math.abs(risk).toFixed(2)}% ${currencySide(risk)} при лимит ${JOURNAL.plan.currency}%.`).join(" ")} <a class="link" href="#/risk">Прегледай позициите</a></div>`;
}

/** Отворени лични позиции в същата двойка и посока: втори вход по сходен сигнал удвоява риска върху една идея. */
function similarOpenNotice(draft) {
  if (!draft || draft.status !== "open" || !FX.PAIRS[draft.pair]) return "";
  const same = journalTrades().filter((t) => t.status === "open" && t.pair === draft.pair && t.dir === draft.dir && t.id !== draft.id);
  if (!same.length) return "";
  const risk = same.reduce((sum, t) => sum + RiskJournal.openRisk(t), 0);
  return `<p class="risk-notice">Вече имаш ${same.length === 1 ? "отворена позиция" : `${same.length} отворени позиции`} ${draft.dir === 1 ? "в покупка" : "в продажба"} на ${esc(FX.PAIRS[draft.pair].name)} с риск ${risk.toFixed(2)}%. Сходните сигнали обикновено са една идея: нова позиция добавя още риск към същото движение.</p>`;
}

function journalComparison(trade) {
  if (!trade.signal_id) return "";
  const signal = resolveSignal(trade.signal_id);
  const comparable = !signal || (!trade.model_version || trade.model_version === (signal.version || 1)) && (!trade.model_cost_model || trade.model_cost_model === (signal.cost_model || FX.costs.fingerprint(S.costProfile)));
  if (!comparable && !Number.isFinite(trade.model_r)) return "<br><small>Моделът е с други правила или разходи. Няма съпоставим краен резултат.</small>";
  const modelR = comparable && signal?.status === "closed" ? signal.r : trade.model_r;
  if (!Number.isFinite(modelR)) return `<br><small>Свързан модел: ${signal ? "още няма краен резултат" : "няма нови данни"}.</small>`;
  return `<br><small>${comparable ? "Модел" : "Запазен модел"}: ${fmtR(modelR)}${trade.status === "closed" ? ` · разлика ${fmtR(trade.net / trade.risk - modelR)}` : ""}.</small>`;
}

function viewRisk() {
  const stats = RiskJournal.stats(journalTrades());
  const plan = JOURNAL.plan;
  const warnings = [];
  if (stats.daily >= plan.daily) warnings.push("Достигнат е дневният лимит на загубите. Прегледай деня, преди да поемаш нов риск.");
  if (stats.weekly >= plan.weekly) warnings.push("Достигнат е седмичният лимит. Направи пауза и провери размера и причините за загубите.");
  if (stats.openRisk >= plan.open) warnings.push("Отвореният риск е достигнал личния ти лимит.");
  for (const [pair, risk] of Object.entries(stats.byPair)) if (risk >= plan.instrument) warnings.push(`${FX.PAIRS[pair].name}: общ риск ${risk.toFixed(2)}% при лимит ${plan.instrument}%.`);
  for (const [code, risk] of currencyOverLimit(stats, plan.currency)) warnings.push(`${currencyName(code)}: нетен риск ${Math.abs(risk).toFixed(2)}% ${currencySide(risk)} при лимит ${plan.currency}%. Сделките в различни двойки може да са един и същ залог.`);
  if (stats.repeated.length) warnings.push(`Няколко отворени сделки споделят ${stats.repeated.join(", ")}. Провери дали не зависят от една и съща новина или посока.`);
  const visible = journalTrades().filter((t) => t.style === S.settings.style).slice().sort((a, b) => b.opened - a.opened);
  const editing = JOURNAL.trades.find((t) => t.id === JOURNAL.editing);
  const trade = editing || JOURNAL.draft || { pair: "EURUSD", style: S.settings.style, dir: 1, status: "closed", risk: riskMoney() || "", risk_pct: S.settings.risk, opened: now(), closed: now(), net: "", tag: "plan", note: "" };
  const tags = { plan: "Спазих плана", early: "Прибързан изход", stop: "Промених стопа извън плана", unplanned: "Влязох без потвърждение" };
  return `<div class="page-heading"><div><p class="kicker">РИСК И ДИСЦИПЛИНА</p><h1>Риск и дневник</h1><p>Планът и дневникът са твои. Тук сравняваш реално отчетените сделки с правилата, които си си поставил.</p></div><span class="page-flag">${esc(S.settings.currency)} · личен дневник</span></div>
    ${JOURNAL.unreadable ? '<p class="risk-notice">Запазеният дневник не може да се прочете. Не е изтрит. Направи резервно копие на данните на браузъра, преди да записваш нови сделки.</p>' : ""}
    ${warnings.length ? `<div class="risk-notice">${warnings.map(esc).join("<br>")}</div>` : ""}
    <section class="panel"><h2>Риск по инструменти</h2><p>${Object.entries(stats.byPair).map(([pair, risk]) => `${FX.PAIRS[pair].name}: <strong>${risk.toFixed(2)}%</strong>`).join(" · ") || "Няма отчетени отворени позиции."}</p><p class="what">Сборът включва само позициите в личния дневник. Частичните изходи намаляват оставащия обем. Текущият стоп се използва, когато си го въвел; иначе се запазва първоначалният риск. Противоположните сделки също имат риск и не се нетират.</p>
      <h2>Нетен риск по валута</h2><p>${Object.entries(stats.byCurrency).filter(([, risk]) => Math.abs(risk) > 1e-9).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([code, risk]) => `${esc(currencyName(code))}: <strong>${Math.abs(risk).toFixed(2)}%</strong> ${currencySide(risk)}`).join(" · ") || "Няма нетен риск към отделна валута."}</p><p class="what">Покупка на EUR/USD, GBP/USD и AUD/USD е три пъти продажба на долара: рискът към USD се събира. Тук противоположните посоки се компенсират, за да се види реалният залог към всяка валута.</p></section>
    ${capacityAdvice(stats)}
    <div class="risk-metrics">${[["Дневни загуби", stats.daily.toFixed(2) + "% / " + plan.daily + "%"], ["Седмични загуби", stats.weekly.toFixed(2) + "% / " + plan.weekly + "%"], ["Отворен риск", stats.openRisk.toFixed(2) + "% / " + plan.open + "%"], ["Среден резултат", stats.averageR === null ? "Още няма сделки" : fmtR(stats.averageR)]].map(([label, value]) => `<section class="panel"><p class="kicker">${label}</p><strong>${value}</strong></section>`).join("")}</div>
    <p class="what">Лимитите обхващат дневните и суинг сделките в ${esc(S.settings.currency)}. Процентите са сбор спрямо отчетения риск при всеки вход. Печалбите не увеличават дневния бюджет за загуби. Денят и седмицата се отчитат по софийско време.</p>
    <div class="grid-2"><section class="panel"><h2>Лични граници</h2><form id="risk-plan" class="settings-form">${[["daily", "Дневен лимит на загубите (%)"], ["weekly", "Седмичен лимит на загубите (%)"], ["open", "Общ отворен риск (%)"], ["instrument", "Отворен риск за един инструмент (%)"], ["currency", "Нетен риск към една валута (%)"]].map(([key, label]) => `<div class="form-field"><label for="risk-${key}">${label}</label><input id="risk-${key}" name="${key}" type="number" min="0.1" max="50" step="0.1" value="${plan[key]}" required></div>`).join("")}<button class="btn btn-outline">Запази границите</button></form>
      <p class="what">Началните стойности са ориентир. Лимитът предупреждава; не изпраща команди към брокера.</p></section>
    <section class="panel"><h2>Преди следващата сделка</h2><ul class="risk-tips"><li>Определи стопа преди обема. За начало 0.5% риск на сделка е разумна отправна точка; сайтът ограничава калкулатора до 1%.</li><li>Провери общия риск на всички позиции. Три сходни сделки могат да са един и същ залог.</li><li>Не увеличавай обема, за да върнеш загуба. След поредица от загуби прегледай дневника и условията на пазара.</li><li>Разграничавай лош резултат от неспазен план. Добре изпълнена сделка също може да загуби.</li><li>Провери свободния маржин, спреда и новините. Стопът не гарантира цената на изпълнение при гап.</li></ul></section></div>
    <section class="panel journal-panel"><h2>${editing ? "Промени записа" : "Добави сделка"}</h2><p class="what">Ръчно отчетена позиция, отделна от симулациите. Резултатът е след комисиони и суап, във валутата на дневника.</p>
      ${similarOpenNotice(editing || JOURNAL.draft)}
      <form id="journal-form" class="journal-form"><input type="hidden" name="trade_id" value="${esc(editing?.id || "")}">
      <div class="form-field"><label>Инструмент<select name="pair">${FX.PAIR_KEYS.map((pair) => `<option ${pair === trade.pair ? "selected" : ""}>${pair}</option>`).join("")}</select></label></div>
      <div class="form-field"><label>Посока<select name="dir"><option value="1" ${trade.dir === 1 ? "selected" : ""}>Покупка</option><option value="-1" ${trade.dir === -1 ? "selected" : ""}>Продажба</option></select></label></div>
      <div class="form-field"><label>Стил<select name="style"><option value="day" ${trade.style === "day" ? "selected" : ""}>Дневна</option><option value="swing" ${trade.style === "swing" ? "selected" : ""}>Суинг</option></select></label></div>
      <div class="form-field"><label>Състояние<select name="status"><option value="open" ${trade.status === "open" ? "selected" : ""}>Отворена</option><option value="closed" ${trade.status === "closed" ? "selected" : ""}>Приключила</option></select></label></div>
      <div class="form-field"><label>Вход<input name="opened" type="datetime-local" value="${journalInputDate(trade.opened)}" required></label></div>
      <div class="form-field"><label>Затваряне<input name="closed" type="datetime-local" value="${journalInputDate(trade.closed || now())}"></label></div>
      <div class="form-field"><label>Първоначален риск (${esc(S.settings.currency)})<input name="risk" type="number" min="0.01" step="any" value="${trade.risk}" required></label></div>
      <div class="form-field"><label>Риск при вход (%)<input name="risk_pct" type="number" min="0.001" max="100" step="any" value="${trade.risk_pct}" required></label></div>
      <div class="form-field"><label>Нетен резултат (${esc(S.settings.currency)})<input name="net" type="number" step="any" value="${trade.net ?? ""}"></label></div>
      ${journalDetails(trade)}
      <div class="form-field"><label>Самооценка<select name="tag">${Object.entries(tags).map(([key, label]) => `<option value="${key}" ${trade.tag === key ? "selected" : ""}>${label}</option>`).join("")}</select></label></div>
      <div class="form-field journal-note"><label>Бележка<textarea name="note" maxlength="1000" rows="2">${esc(trade.note)}</textarea></label></div>
      <div class="chips-row"><button class="btn btn-primary" ${JOURNAL.unreadable ? "disabled" : ""}>Запази сделката</button><button type="button" class="btn btn-outline" data-journal-estimate>Сметни по цените</button>${editing || JOURNAL.draft ? '<button type="button" class="btn btn-outline" data-journal-cancel>Откажи</button>' : ""}</div><p class="what">Сметката по цени е ориентир преди разходите за остатъка. Потвърди общия нетен резултат от отчета на брокера. Часовете във формата са по настройката на този браузър.</p></form></section>
    <section class="panel"><div class="panel-head"><div><h2>Твоите ${STYLE_NAMES[S.settings.style].toLowerCase()} сделки</h2><p class="what">${stats.closed.length} приключили общо · най-дълга серия загуби ${stats.worstStreak} · спад на сбора в R: ${fmtR(-stats.drawdown)}</p></div><div class="chips-row"><button class="tiny-btn" data-journal-export>Изтегли копие</button><label class="tiny-btn">Внеси копие<input type="file" id="journal-import" accept="application/json" hidden></label></div></div>
      ${visible.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Дата</th><th>Сделка</th><th>Риск</th><th>Резултат</th><th>Самооценка</th><th></th></tr></thead><tbody>${visible.map((t) => `<tr><td>${esc(when(t.opened))}</td><td>${t.pair} · ${t.dir === 1 ? "Купи" : "Продай"}</td><td>${t.risk_pct}%</td><td>${t.status === "open" ? `Отворена · остават ${(RiskJournal.remaining(t) * 100).toFixed(0)}%` : fmtR(t.net / t.risk)}${journalComparison(t)}</td><td>${esc(tags[t.tag])}</td><td><button class="tiny-btn" data-journal-edit="${esc(t.id)}">Промени</button> <button class="tiny-btn" data-journal-delete="${esc(t.id)}">Изтрий</button></td></tr>`).join("")}</tbody></table></div>` : '<p>Още няма записи за този стил.</p>'}
      <p class="what">Дневникът се пази само в този браузър. Изтегляй копие редовно; изчистването на данните на браузъра премахва записите.</p></section>`;
}

document.addEventListener("submit", (event) => {
  if (!["journal-form", "risk-plan"].includes(event.target.id)) return;
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    if (JOURNAL.unreadable) throw new Error("Съществуващият дневник не е прочетен. Записът е спрян, за да се запазят данните.");
    if (event.target.id === "risk-plan") saveJournal(JOURNAL.trades, Object.fromEntries(form));
    else {
      if (form.get("status") === "closed" && form.get("net") === "") throw new Error("Въведи нетен резултат за приключилата сделка.");
      const trade = RiskJournal.validate(journalFromForm(form));
      saveJournal(JOURNAL.trades.filter((t) => t.id !== trade.id).concat([trade]));
      JOURNAL.editing = null; JOURNAL.draft = null;
    }
    toast("Запазено."); render();
  } catch (error) { toast(error.message || "Браузърът не позволи записа."); }
});

document.addEventListener("click", (event) => {
  const target = event.target;
  const fromSignal = target.closest("[data-journal-signal]");
  if (fromSignal) {
    const signal = resolveSignal(fromSignal.dataset.journalSignal), dir = Number(fromSignal.dataset.journalDir);
    if (!signal) return;
    S.settings.style = signal.style; saveSettings();
    const existing = JOURNAL.trades.find((trade) => trade.signal_id === signal.id && trade.dir === dir && trade.currency === S.settings.currency);
    if (existing) { JOURNAL.editing = existing.id; JOURNAL.draft = null; }
    else {
      const order = ordersOf(signal).find((order) => order.dir === dir);
      if (!order) return;
      const size = sizing(signal.pair, order);
      JOURNAL.editing = null;
      JOURNAL.draft = { pair: signal.pair, style: signal.style, dir, status: "open", opened: now(), closed: now(),
        risk: riskMoney() || "", risk_pct: S.settings.risk, net: "", tag: "plan", note: "", signal_id: signal.id,
        entry_price: S.watch.get(signal.id)?.actualEntry?.price || order.entry, initial_stop: order.stop,
        lots: size && !size.tooSmall && !size.invalid ? size.lots : "", pip_value: pipValue(signal.pair) || "",
        model_version: signal.version || 1, model_cost_model: signal.cost_model || FX.costs.fingerprint(S.costProfile),
        ...(signal.status === "closed" ? { model_r: signal.r } : {}) };
    }
    location.hash = "#/risk"; return;
  }
  if (target.closest("[data-journal-estimate]")) {
    try {
      const form = document.getElementById("journal-form"), estimate = RiskJournal.estimate(journalFromForm(new FormData(form)));
      if (!Number.isFinite(estimate)) throw new Error("Попълни входна и изходна цена, обем и стойност на пипс за един лот.");
      form.elements.net.value = estimate.toFixed(2);
      toast("Сметнато по цените. Приспадни разходите за остатъка и сравни с отчета на брокера.");
    } catch (error) { toast(error.message); }
    return;
  }
  const removePart = target.closest("[data-partial-remove]");
  if (removePart) {
    const form = document.getElementById("journal-form"), input = form.elements.partials;
    const parts = JSON.parse(input.value); parts.splice(Number(removePart.dataset.partialRemove), 1); input.value = JSON.stringify(parts);
    removePart.closest("tr").remove();
    form.querySelectorAll("[data-partial-remove]").forEach((button, i) => { button.dataset.partialRemove = String(i); });
    return;
  }
  const edit = target.closest("[data-journal-edit]"), remove = target.closest("[data-journal-delete]");
  if (edit) { JOURNAL.editing = edit.dataset.journalEdit; render(); return; }
  if (target.closest("[data-journal-cancel]")) { JOURNAL.editing = null; JOURNAL.draft = null; render(); return; }
  if (remove) {
    if (!confirm("Да изтрия ли този запис от личния дневник?")) return;
    try { saveJournal(JOURNAL.trades.filter((t) => t.id !== remove.dataset.journalDelete)); render(); } catch (_error) { toast("Записът не е изтрит. Браузърът не позволи промяната."); }
    return;
  }
  if (target.closest("[data-journal-export]")) {
    const url = URL.createObjectURL(new Blob([JOURNAL.unreadable ? localStorage.getItem(JOURNAL_KEY) || "" : JSON.stringify({ version: 1, trades: JOURNAL.trades, plan: JOURNAL.plan }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "tradepulse24-dnevnik.json"; link.click(); URL.revokeObjectURL(url); return;
  }
});

document.addEventListener("change", async (event) => {
  if (event.target.id !== "journal-import" || !event.target.files[0]) return;
  try {
    if (JOURNAL.unreadable) throw new Error("Първо запази копие на нечетимия дневник. Внасянето е спряно, за да не го презапише.");
    const file = event.target.files[0];
    if (file.size > 2000000) throw new Error("Файлът е твърде голям.");
    const data = JSON.parse(await file.text());
    if (data.version !== 1 || !Array.isArray(data.trades)) throw new Error("Това не е копие на дневник от TradePulse24.");
    const merged = new Map(JOURNAL.trades.map((t) => [t.id, t]));
    for (const trade of data.trades) { const valid = RiskJournal.validate(trade); if (!merged.has(valid.id)) merged.set(valid.id, valid); }
    saveJournal([...merged.values()]); toast("Копието е внесено. Съществуващите записи са запазени."); render();
  } catch (error) { toast(error.message || "Копието не може да се прочете."); }
});
