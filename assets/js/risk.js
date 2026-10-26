"use strict";

const JOURNAL_KEY = "tradepulse24-journal-v1";
const RISK_DEFAULTS = { daily: 1.5, weekly: 4, open: 2 };
const RiskJournal = {
  validate(trade) {
    if (!trade || typeof trade.id !== "string" || trade.id.length > 100 || !FX.PAIRS[trade.pair] || !["day", "swing"].includes(trade.style)
      || !["USD", "EUR"].includes(trade.currency) || !["open", "closed"].includes(trade.status) || ![-1, 1].includes(trade.dir)) throw new Error("В дневника има невалидна сделка.");
    for (const key of ["risk", "risk_pct", "opened"]) if (!Number.isFinite(trade[key]) || trade[key] <= 0) throw new Error("Провери риска и времето на входа.");
    if (trade.risk_pct > 100 || trade.risk > 1e9 || trade.opened > Date.now() / 1000 + 60) throw new Error("Провери риска и времето на входа.");
    if (trade.status === "closed" && (!Number.isFinite(trade.net) || Math.abs(trade.net) > 1e9 || !Number.isFinite(trade.closed) || trade.closed < trade.opened || trade.closed > Date.now() / 1000 + 60)) throw new Error("Провери резултата и часа на затваряне.");
    if (typeof trade.note !== "string" || trade.note.length > 1000 || !["plan", "early", "stop", "unplanned"].includes(trade.tag)) throw new Error("Провери бележката и самооценката.");
    return { id: trade.id, pair: trade.pair, style: trade.style, currency: trade.currency, status: trade.status, dir: trade.dir,
      risk: trade.risk, risk_pct: trade.risk_pct, opened: trade.opened, net: trade.status === "closed" ? trade.net : null,
      closed: trade.status === "closed" ? trade.closed : null, tag: trade.tag, note: trade.note };
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
      if (r < 0 && trade.closed <= timestamp && day(trade.closed) === day(timestamp)) daily += -r * trade.risk_pct;
      if (r < 0 && day(trade.closed) >= monday && trade.closed <= timestamp) weekly += -r * trade.risk_pct;
    }
    const open = trades.filter((t) => t.status === "open");
    const exposure = {};
    for (const trade of open) for (const currency of [trade.pair.slice(0, 3), trade.pair.slice(3, 6)]) exposure[currency] = (exposure[currency] || 0) + 1;
    return { closed, open, daily, weekly, openRisk: open.reduce((sum, t) => sum + t.risk_pct, 0), totalR,
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
const JOURNAL = { ...loadJournal(), editing: null, review: null, busy: false, error: "" };
function saveJournal(trades = JOURNAL.trades, plan = JOURNAL.plan) {
  const next = { trades: trades.map(RiskJournal.validate), plan: riskPlan(plan) };
  if (next.trades.length > 1000) throw new Error("Дневникът е пълен. Изтегли копие, преди да започнеш нов.");
  localStorage.setItem(JOURNAL_KEY, JSON.stringify(next));
  Object.assign(JOURNAL, next, { unreadable: false, review: null });
}
function journalTrades() { return JOURNAL.trades.filter((t) => t.currency === S.settings.currency); }
function journalInputDate(timestamp) {
  const d = new Date(timestamp * 1000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function viewRisk() {
  const stats = RiskJournal.stats(journalTrades());
  const plan = JOURNAL.plan;
  const warnings = [];
  if (stats.daily >= plan.daily) warnings.push("Достигнат е дневният лимит на загубите. Прегледай деня, преди да поемаш нов риск.");
  if (stats.weekly >= plan.weekly) warnings.push("Достигнат е седмичният лимит. Направи пауза и провери размера и причините за загубите.");
  if (stats.openRisk >= plan.open) warnings.push("Отвореният риск е достигнал личния ти лимит.");
  if (stats.repeated.length) warnings.push(`Няколко отворени сделки споделят ${stats.repeated.join(", ")}. Провери дали не зависят от една и съща новина или посока.`);
  const visible = journalTrades().filter((t) => t.style === S.settings.style).slice().sort((a, b) => b.opened - a.opened);
  const editing = JOURNAL.trades.find((t) => t.id === JOURNAL.editing);
  const trade = editing || { pair: "EURUSD", style: S.settings.style, dir: 1, status: "closed", risk: riskMoney() || "", risk_pct: S.settings.risk, opened: now(), closed: now(), net: "", tag: "plan", note: "" };
  const tags = { plan: "Спазих плана", early: "Прибързан изход", stop: "Промених стопа извън плана", unplanned: "Влязох без потвърждение" };
  const review = JOURNAL.review;
  return `<div class="page-heading"><div><p class="kicker">РИСК И ДИСЦИПЛИНА</p><h1>Първо пази сметката</h1><p>Планът и дневникът са твои. Тук сравняваш реално отчетените сделки с правилата, които си си поставил.</p></div><span class="page-flag">${esc(S.settings.currency)} · личен дневник</span></div>
    ${JOURNAL.unreadable ? '<p class="risk-notice">Запазеният дневник не може да се прочете. Не е изтрит. Направи резервно копие на данните на браузъра, преди да записваш нови сделки.</p>' : ""}
    ${warnings.length ? `<div class="risk-notice">${warnings.map(esc).join("<br>")}</div>` : ""}
    <div class="risk-metrics">${[["Дневни загуби", stats.daily.toFixed(2) + "% / " + plan.daily + "%"], ["Седмични загуби", stats.weekly.toFixed(2) + "% / " + plan.weekly + "%"], ["Отворен риск", stats.openRisk.toFixed(2) + "% / " + plan.open + "%"], ["Среден резултат", stats.averageR === null ? "Още няма сделки" : fmtR(stats.averageR)]].map(([label, value]) => `<section class="panel"><p class="kicker">${label}</p><strong>${value}</strong></section>`).join("")}</div>
    <p class="what">Лимитите обхващат дневните и суинг сделките в ${esc(S.settings.currency)}. Процентите са сбор спрямо отчетения риск при всеки вход. Печалбите не увеличават дневния бюджет за загуби. Денят и седмицата се отчитат по софийско време.</p>
    <div class="grid-2"><section class="panel"><h2>Лични граници</h2><form id="risk-plan" class="settings-form">${[["daily", "Дневен лимит на загубите (%)"], ["weekly", "Седмичен лимит на загубите (%)"], ["open", "Общ отворен риск (%)"]].map(([key, label]) => `<div class="form-field"><label for="risk-${key}">${label}</label><input id="risk-${key}" name="${key}" type="number" min="0.1" max="50" step="0.1" value="${plan[key]}" required></div>`).join("")}<button class="btn btn-outline">Запази границите</button></form>
      <p class="what">Началните стойности са ориентир. Лимитът предупреждава; не изпраща команди към брокера.</p></section>
    <section class="panel"><h2>Няколко навика, които си струват</h2><ul class="risk-tips"><li>Определи стопа преди обема. За начало 0.5% риск на сделка е разумна отправна точка; сайтът ограничава калкулатора до 1%.</li><li>Провери общия риск на всички позиции. Три сходни сделки могат да са един и същ залог.</li><li>Не увеличавай обема, за да върнеш загуба. След поредица от загуби прегледай дневника и условията на пазара.</li><li>Разграничавай лош резултат от неспазен план. Добре изпълнена сделка също може да загуби.</li><li>Провери свободния маржин, спреда и новините. Стопът не гарантира цената на изпълнение при гап.</li></ul></section></div>
    <section class="panel journal-panel"><h2>${editing ? "Промени записа" : "Добави сделка"}</h2><p class="what">Ръчно отчетена позиция, отделна от симулациите. Резултатът е след комисиони и суап, във валутата на дневника.</p>
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
      <div class="form-field"><label>Самооценка<select name="tag">${Object.entries(tags).map(([key, label]) => `<option value="${key}" ${trade.tag === key ? "selected" : ""}>${label}</option>`).join("")}</select></label></div>
      <div class="form-field journal-note"><label>Бележка<textarea name="note" maxlength="1000" rows="2">${esc(trade.note)}</textarea></label></div>
      <div class="chips-row"><button class="btn btn-primary" ${JOURNAL.unreadable ? "disabled" : ""}>Запази сделката</button>${editing ? '<button type="button" class="btn btn-outline" data-journal-cancel>Откажи</button>' : ""}</div></form></section>
    <section class="panel"><div class="panel-head"><div><h2>Твоите ${STYLE_NAMES[S.settings.style].toLowerCase()} сделки</h2><p class="what">${stats.closed.length} приключили общо · най-дълга серия загуби ${stats.worstStreak} · спад на сбора в R: ${fmtR(-stats.drawdown)}</p></div><div class="chips-row"><button class="tiny-btn" data-journal-export>Изтегли копие</button><label class="tiny-btn">Внеси копие<input type="file" id="journal-import" accept="application/json" hidden></label></div></div>
      ${visible.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Дата</th><th>Сделка</th><th>Риск</th><th>Резултат</th><th>Самооценка</th><th></th></tr></thead><tbody>${visible.map((t) => `<tr><td>${esc(when(t.opened))}</td><td>${t.pair} · ${t.dir === 1 ? "Купи" : "Продай"}</td><td>${t.risk_pct}%</td><td>${t.status === "open" ? "Отворена" : fmtR(t.net / t.risk)}</td><td>${esc(tags[t.tag])}</td><td><button class="tiny-btn" data-journal-edit="${esc(t.id)}">Промени</button> <button class="tiny-btn" data-journal-delete="${esc(t.id)}">Изтрий</button></td></tr>`).join("")}</tbody></table></div>` : '<p>Още няма записи за този стил.</p>'}
      <p class="what">Дневникът се пази само в този браузър. Изтегляй копие редовно; изчистването на данните на браузъра премахва записите.</p></section>
    <section class="panel"><p class="kicker">ПУЛС · ПРЕГЛЕД С GEMINI</p><h2>Какво се повтаря в сделките ти?</h2><p>Пулс разглежда размера на риска, резултатите в R и самооценката ти. Търси навици за преглед, а не виновник за всяка загуба.</p>
      <button class="btn btn-primary" data-risk-ai ${stats.closed.length < 10 || JOURNAL.busy ? "disabled" : ""}>${JOURNAL.busy ? "Преглеждам историята…" : "Поискай преглед от Пулс"}</button>
      <p class="what">Нужни са поне 10 приключили сделки. Изпращат се до 50 последни записа: инструмент, стил, дата, риск в проценти, резултат в R и самооценка. Сумите, балансът и личните бележки остават в браузъра.</p>
      ${JOURNAL.error ? `<p class="risk-notice" role="alert">${esc(JOURNAL.error)}</p>` : ""}
      ${review ? `<div class="analysis-section" aria-live="polite"><h3>${esc(review.analysis.summary)}</h3><p>${esc(review.analysis.relevance)}</p>${[["Какво се откроява", review.analysis.scenarios], ["Какво да опиташ", review.analysis.considerations], ["Граници на оценката", review.analysis.limitations]].map(([title, items]) => `<h3>${title}</h3><ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`).join("")}<p class="what">Преглед от ${esc(when(review.generated_at))}. Ръчно въведена история; няма връзка с брокер.</p></div>` : ""}</section>`;
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
      const trade = RiskJournal.validate({ id: String(form.get("trade_id") || "trade_" + Date.now().toString(36)), pair: String(form.get("pair")), dir: Number(form.get("dir")),
        style: String(form.get("style")), currency: S.settings.currency, status: String(form.get("status")), risk: Number(form.get("risk")), risk_pct: Number(form.get("risk_pct")),
        opened: new Date(String(form.get("opened"))).getTime() / 1000, closed: new Date(String(form.get("closed"))).getTime() / 1000,
        net: Number(form.get("net")), tag: String(form.get("tag")), note: String(form.get("note")) });
      saveJournal(JOURNAL.trades.filter((t) => t.id !== trade.id).concat([trade]));
      JOURNAL.editing = null;
    }
    toast("Запазено."); render();
  } catch (error) { toast(error.message || "Браузърът не позволи записа."); }
});

document.addEventListener("click", async (event) => {
  const target = event.target;
  const edit = target.closest("[data-journal-edit]"), remove = target.closest("[data-journal-delete]");
  if (edit) { JOURNAL.editing = edit.dataset.journalEdit; render(); return; }
  if (target.closest("[data-journal-cancel]")) { JOURNAL.editing = null; render(); return; }
  if (remove) {
    if (!confirm("Да изтрия ли този запис от личния дневник?")) return;
    try { saveJournal(JOURNAL.trades.filter((t) => t.id !== remove.dataset.journalDelete)); render(); } catch (_error) { toast("Записът не е изтрит. Браузърът не позволи промяната."); }
    return;
  }
  if (target.closest("[data-journal-export]")) {
    const url = URL.createObjectURL(new Blob([JOURNAL.unreadable ? localStorage.getItem(JOURNAL_KEY) || "" : JSON.stringify({ version: 1, trades: JOURNAL.trades, plan: JOURNAL.plan }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "tradepulse24-dnevnik.json"; link.click(); URL.revokeObjectURL(url); return;
  }
  if (!target.closest("[data-risk-ai]") || JOURNAL.busy) return;
  const trades = RiskJournal.stats(journalTrades()).closed.slice(-50);
  if (trades.length < 10) return;
  JOURNAL.busy = true; JOURNAL.error = ""; render();
  try {
    const response = await fetch("api/risk-ai.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trades: trades.map((t) => ({ pair: t.pair, style: t.style, risk_pct: t.risk_pct, r: t.net / t.risk, date: t.closed, tag: t.tag })) }) });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Прегледът не завърши.");
    JOURNAL.review = data;
  } catch (error) { JOURNAL.error = error.message; } finally { JOURNAL.busy = false; render(); }
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
