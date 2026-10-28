"use strict";

const PULS = { overview: { status: null, loading: false, generating: false, checked: 0 }, selection: new Map(), chats: new Map() };
const pulsTime = (t) => t ? new Intl.DateTimeFormat("bg-BG", { timeZone: "Europe/Sofia", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(t * 1000)) : "неизвестен час";
const pulsToday = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Sofia", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const pulsError = (error) => `${error.message || "Не получихме отговор. Опитай по-късно."}${error.code ? " · Код: " + error.code : ""}`;

async function pulsRequest(body = null) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 40000) : null;
  try {
    const response = await fetch("api/puls.php", { ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}), ...(controller ? { signal: controller.signal } : {}) });
    let data;
    try { data = await response.json(); } catch (_error) { throw Object.assign(new Error("PHP отговорът не може да се прочете. Провери дали файловете от обновяването са качени заедно."), { code: "invalid_server_reply" }); }
    if (!response.ok || !data.ok) throw Object.assign(new Error(data.error || "Пулс не завърши отговора."), { code: data.code || "request_failed" });
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw Object.assign(new Error("Изчакването приключи. Опитай по-късно; календарът остава достъпен."), { code: "timeout" });
    throw error;
  } finally { if (timer !== null) clearTimeout(timer); }
}

function pulsSources(response) {
  const sources = (response.sources || []).filter((source) => {
    try { const u = new URL(source.url); return u.protocol === "https:" && ["nfs.faireconomy.media", "twelvedata.com"].includes(u.hostname); } catch (_error) { return false; }
  });
  return `<p class="what puls-sources">${sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a> (${esc(pulsTime(s.updated))})`).join(" · ")}<br>Календар: ${esc(pulsTime(response.data_updated))} · Обяснение: ${esc(pulsTime(response.generated_at))} · Europe/Sofia${response.cached ? " · запазен отговор" : ""}</p>`;
}
const pulsList = (items) => `<ul class="puls-points">${(items || []).map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;

function pulsOverview() {
  const state = PULS.overview, status = state.status;
  const overview = status?.overview?.day === pulsToday() ? status.overview : null;
  const date = new Intl.DateTimeFormat("bg-BG", { timeZone: "Europe/Sofia", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  const content = overview?.content;
  return `<section class="panel puls-overview" aria-label="Дневен Forex обзор"><div class="panel-head"><div><p class="kicker">ПУЛС · ДНЕВЕН ОБЗОР</p><h2>Forex обзор — ${esc(date)}</h2></div>
    <button type="button" class="tiny-btn" data-puls-overview ${state.loading || state.generating ? "disabled" : ""}>${state.loading || state.generating ? "Подготвям…" : "Провери за обновяване"}</button></div>
    ${status?.error ? `<p class="risk-notice" role="status">${esc(status.error)}${status.code ? ` · Код: ${esc(status.code)}` : ""}</p>` : ""}
    ${status?.calendar_changed ? '<p class="warn-line">Календарът е променен след изготвянето на този обзор. Провери актуалните часове и резултати по-долу; за конкретното събитие можеш да попиташ Пулс.</p>' : ""}
    ${content ? `<p class="puls-answer">${esc(content.summary)}</p>${pulsList(content.focus)}<div class="puls-plans">
      <div class="${S.settings.style === "day" ? "selected" : ""}"><h3>При дневна търговия</h3>${pulsList(content.day)}</div>
      <div class="${S.settings.style === "swing" ? "selected" : ""}"><h3>При суинг търговия</h3>${pulsList(content.swing)}</div></div>
      <details class="puls-limits"><summary>Какво остава неизвестно</summary>${pulsList(content.unknowns)}</details>${pulsSources(overview)}`
      : `<p>${state.generating ? "Пулс подготвя общия обзор по наличния календар. Можеш да разглеждаш новините, докато чакаш." : status?.configured === false ? "Пулс още не е включен за този сайт. Обясненията под новините работят и без него." : status?.error ? "Календарът по-долу остава достъпен." : "Проверявам дали има подготвен обзор за днес…"}</p>`}
    <p class="what">Обзорът използва наличния календар и котировки. Достъпът до пълни доклади и изказвания се посочва изрично в обяснението.</p></section>`;
}

async function pulsLoadOverview(force = false) {
  const state = PULS.overview;
  if (state.loading || state.generating || (!force && state.checked && Date.now() - state.checked < 300000 && state.status?.day === pulsToday())) return;
  state.loading = true; state.checked = Date.now();
  try {
    state.status = await pulsRequest();
    state.loading = false;
    if (state.status.configured && state.status.needs_refresh) {
      state.generating = true;
      if (S.route.view === "news") render();
      try { state.status.overview = await pulsRequest({ action: "overview" }); state.status.needs_refresh = false; state.status.calendar_changed = false; }
      catch (error) { state.status.error = error.message; state.status.code = error.code; }
    }
  } catch (error) { state.status = { day: pulsToday(), error: error.message, code: error.code }; }
  finally { state.loading = false; state.generating = false; if (S.route.view === "news") render(); }
}

function newsPulsButton(event, signal = null) {
  const suffix = signal && signal.dir ? "/" + encodeURIComponent(signal.id + "~" + signal.dir) : "";
  return `<a class="puls-link" href="#/analysis/${encodeURIComponent(event.id)}${suffix}">Попитай Пулс ↗</a>`;
}

function pulsSignals(event) {
  const choices = [];
  for (const signal of S.data?.signals || []) {
    if (!["pending", "open"].includes(signal.status) || !styleOk(signal.style || FX.TIMEFRAMES[signal.tf]?.style)) continue;
    if (!pairCurrencies(signal.pair).includes(event.currency)) continue;
    const orders = signal.status === "open" && signal.dir ? [{ dir: signal.dir, entry: signal.fill_price || signal.entry, stop: signal.stop, initial_stop: signal.stop0 }] : signal.orders || [];
    for (const order of orders) if ([-1, 1].includes(order.dir) && order.entry > 0 && order.stop > 0) choices.push({ value: signal.id + "~" + order.dir, signal, order });
  }
  return choices;
}
function pulsPage(id) {
  const [eventId, initial] = String(id || "").split("/");
  const event = S.data?.news?.find((e) => e.id === eventId);
  if (!event) return { event: null };
  if (!PULS.selection.has(eventId)) PULS.selection.set(eventId, initial || "");
  const choices = pulsSignals(event);
  const selected = choices.find((choice) => choice.value === PULS.selection.get(eventId)) || null;
  const key = eventId + "/" + (selected?.value || "general");
  if (!PULS.chats.has(key)) PULS.chats.set(key, { messages: [], draft: "", busy: false, error: null });
  return { event, choices, selected, key, chat: PULS.chats.get(key) };
}

function viewNewsAnalysis(id) {
  const page = pulsPage(id);
  if (!page.event) return `<a class="back-btn" href="#/news">← Календар</a>` + emptyBox("◷", "Новината вече не е налична", "Върни се в календара и избери събитие.");
  const { event, choices, selected, chat } = page, guide = FX.newsGuide(event.title);
  return `<div class="detail-back"><a class="back-btn" href="#/news">← Календар</a></div><div class="page-heading"><div><p class="kicker">НОВИНАТА И ТВОЯТА СДЕЛКА</p>
    <h1>${esc(event.title_bg)}</h1><p>${esc(event.currency)} · ${esc(when(event.time))} · ${esc(rel(event.time))}</p></div>${impactPill(event.impact)}</div>
    <section class="panel"><h2>Какво означава събитието</h2><p>${esc(guide.explain)}</p><p class="what">${esc(guide.watch)}</p></section>
    <section class="panel puls-chat"><label for="puls-signal">За кой сигнал?</label><select id="puls-signal"><option value="">Общо за новината</option>
      ${choices.map((choice) => `<option value="${esc(choice.value)}" ${selected?.value === choice.value ? "selected" : ""}>${esc(pairInfo(choice.signal.pair).name)} · ${choice.order.dir === 1 ? "Покупка" : "Продажба"} · ${esc(choice.signal.tf)} · ${esc(choice.signal.strategy_name)}</option>`).join("")}</select>
      <p class="what">Показани са наличните ${S.settings.style === "day" ? "дневни" : "суинг"} модели за валутата. При двупосочен модел избери конкретната посока.</p>
      <div class="puls-conversation" aria-live="polite">${chat.messages.map((message) => message.role === "user" ? `<div class="puls-message user"><strong>Твоят въпрос</strong><p>${esc(message.text)}</p></div>`
        : `<div class="puls-message assistant"><strong>Пулс</strong><p class="puls-answer">${esc(message.response.content.answer)}</p>${pulsList(message.response.content.watch)}<details class="puls-limits"><summary>Неизвестни и ограничения</summary>${pulsList(message.response.content.unknowns)}</details>${pulsSources(message.response)}</div>`).join("")}</div>
      ${chat.error ? `<p class="risk-notice" role="alert">${esc(pulsError(chat.error))}</p>` : ""}
      <form id="puls-question-form"><label for="puls-question">Какво искаш да разбереш?</label><textarea id="puls-question" maxlength="500" rows="3" placeholder="Например: Какво да следя около тази новина?">${esc(chat.draft)}</textarea>
        <div class="chips-row"><button class="btn btn-primary" ${chat.busy ? "disabled" : ""}>${chat.busy ? "Подготвям отговора…" : "Попитай Пулс"}</button>${chat.messages.length ? '<button class="btn btn-outline" type="button" data-puls-clear>Нов разговор</button>' : ""}</div></form>
      <p class="what">До Groq се изпращат новината, въпросът, последните няколко съобщения и избраният ценови модел. Балансът, паролата, дневникът и личните потвърждения за изпълнение остават при теб.</p></section>`;
}

async function pulsAsk() {
  const page = pulsPage(S.route.id);
  if (!page.event || page.chat.busy) return;
  const { chat, selected, event, key } = page;
  const question = chat.draft.trim() || "Обясни тази новина и какво е важно да следя.";
  const history = chat.messages.slice(-6).map((message) => ({ role: message.role, content: message.role === "user" ? message.text : message.response.content.answer }));
  let signal = null;
  if (selected) {
    const strat = S.catalog[selected.signal.strategy?.replace(/-(M15|H1|H4|D1)$/, "")];
    signal = { pair: selected.signal.pair, tf: selected.signal.tf, dir: selected.order.dir, entry: selected.order.entry, stop: selected.order.stop, initial_stop: selected.order.initial_stop || selected.order.stop,
      status: selected.signal.status, strategy: selected.signal.strategy_name, exit_rules: strat?.exit_rules || [] };
  }
  chat.busy = true; chat.error = null; chat.draft = ""; chat.messages.push({ role: "user", text: question }); render();
  try { chat.messages.push({ role: "assistant", response: await pulsRequest({ action: "chat", event_id: event.id, signal, question, history }) }); }
  catch (error) { chat.messages.pop(); chat.draft = question; chat.error = error; }
  finally { chat.busy = false; if (S.route.view === "analysis" && pulsPage(S.route.id).key === key) render(); }
}

function pulsLabPanel() {
  const check = LAB.pulsCheck;
  return `<details class="panel puls-setup" ${LAB.pulsChecking || check ? "open" : ""}><summary>Пулс · проверка на Groq</summary><p>Проверката изпраща кратък реален въпрос. Успешният списък с модели сам по себе си не потвърждава генериране.</p>
    <button class="btn btn-outline" type="button" data-puls-check ${LAB.pulsChecking ? "disabled" : ""}>${LAB.pulsChecking ? "Проверявам…" : "Провери Groq с въпрос"}</button>
    ${check ? `<p role="status">${esc(check.message || check.error)}</p>${check.code ? `<p class="what">Код: ${esc(check.code)}</p>` : ""}` : ""}
    <p class="what">Собственият ключ се задава в средата на PHP като GROQ_API_KEY или в api/config.local.php като groq_key. groq_model може да остане празно за автоматичен избор. Ключът не се въвежда в браузъра.</p></details>`;
}
async function pulsCheckConnection() {
  if (!LAB.authed || LAB.pulsChecking) return;
  LAB.pulsChecking = true; LAB.pulsCheck = null; render();
  try { LAB.pulsCheck = await pulsRequest({ action: "check", password: LAB.password }); PULS.overview.checked = 0; }
  catch (error) { LAB.pulsCheck = { error: error.message, code: error.code }; }
  finally { LAB.pulsChecking = false; if (["lab", "workshop"].includes(S.route.view)) render(); }
}

document.addEventListener("input", (event) => { if (event.target.id === "puls-question") { const p = pulsPage(S.route.id); if (p.chat) p.chat.draft = event.target.value; } });
document.addEventListener("change", (event) => { if (event.target.id === "puls-signal") { const p = pulsPage(S.route.id); if (p.event) { PULS.selection.set(p.event.id, event.target.value); render(); } } });
document.addEventListener("submit", (event) => { if (event.target.id === "puls-question-form") { event.preventDefault(); pulsAsk(); } });
document.addEventListener("click", (event) => {
  if (event.target.closest("[data-puls-overview]")) pulsLoadOverview(true);
  if (event.target.closest("[data-puls-check]")) pulsCheckConnection();
  if (event.target.closest("[data-puls-clear]")) { const p = pulsPage(S.route.id); if (p.chat && !p.chat.busy) { p.chat.messages = []; p.chat.error = null; p.chat.draft = ""; render(); } }
});
