"use strict";

// Заявка към Gemini се изпраща само от бутона в този изглед.
const NEWS_AI = { results: new Map(), busy: false, error: "", errorCode: "", selected: new Map() };
const AI_LABELS = { normal: "Нормални условия", caution: "Внимание", pause: "Пауза за нови входове", insufficient_data: "Недостатъчно данни" };

function newsAIButton(event, signal = null) {
  return `<a class="tiny-btn ai-link" href="#/analysis/${encodeURIComponent(event.id)}${signal ? "/" + encodeURIComponent(signal.id) : ""}">Как влияе на моя сигнал?</a>`;
}

function analysisSignals(event) {
  const signals = new Map((S.data?.signals || []).map((s) => [s.id, s]));
  for (const item of S.watch.list()) if (!signals.has(item.id)) signals.set(item.id, item.snapshot);
  return [...signals.values()].flatMap((s) => { const orders = ordersOf(s); return orders.length > 1 ? orders.map((o) => ({ ...s, analysis_key: `${s.id}~${o.dir}`, analysis_dir: o.dir })) : [s]; }).filter((s) => isCurrent(s) && styleOk(s.style || FX.TIMEFRAMES[s.tf]?.style)
    && (pairCurrencies(s.pair).includes(event.currency) || (event.currency === "USD" && s.pair === "XAUUSD")));
}

function analysisSelection(id) {
  const [eventId, requested] = String(id || "").split("/");
  const event = (S.data?.news || []).find((e) => e.id === eventId);
  const chosen = NEWS_AI.selected.has(eventId) ? NEWS_AI.selected.get(eventId) : requested || "";
  const signal = event ? analysisSignals(event).find((s) => (s.analysis_key || s.id) === chosen) || null : null;
  return { eventId, event, signal, key: `${eventId}/${signal?.analysis_key || signal?.id || "general"}` };
}

function viewNewsAnalysis(id) {
  const { event, signal, key } = analysisSelection(id);
  if (!event) return emptyBox("◷", "Новината не е намерена", "Обнови календара и избери събитието отново.", '<a class="btn btn-outline" href="#/news">Към новините</a>');
  const saved = NEWS_AI.results.get(key);
  const result = saved && now() - saved.generated_at < 300 ? saved : null;
  const options = analysisSignals(event);
  const section = (title, items) => items?.length ? `<section class="analysis-section"><h3>${title}</h3><ul>${items.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></section>` : "";
  return `<div class="detail-back"><a class="back-btn" href="#/news">← Календар</a></div>
    <div class="page-heading"><div><p class="kicker">НОВИНАТА И ТВОЯТА СДЕЛКА</p><h1>${esc(event.title_bg || event.title)}</h1><p>${esc(event.currency)} · ${esc(when(event.time))} · ${esc(rel(event.time))}</p></div>${impactPill(event.impact)}</div>
    <div class="grid-2"><section class="panel"><h2>Какво означава събитието</h2><p>${esc(event.explain)}</p>
      <p class="what">${esc(FX.newsGuide(event.title).watch)}</p>
      <div class="form-field"><label for="analysis-signal">За кой сигнал?</label><select id="analysis-signal">
        <option value="">Общо за новината</option>${options.map((s) => `<option value="${esc(s.analysis_key || s.id)}" ${(signal?.analysis_key || signal?.id) === (s.analysis_key || s.id) ? "selected" : ""}>${esc(s.pair_name || s.pair)} · ${(s.analysis_dir || ordersOf(s)[0]?.dir) === 1 ? "Покупка" : "Продажба"} · ${esc(s.tf)} · ${esc(s.strategy_name || "Следен сигнал")}</option>`).join("")}</select></div>
      ${!options.length ? '<p class="what">Няма активен или чакащ сигнал за тази валута в избрания стил. Можеш да поискаш общо обяснение.</p>' : ""}
      <button type="button" class="btn btn-primary" data-ai-run ${NEWS_AI.busy ? "disabled" : ""}>${NEWS_AI.busy ? "Подготвям обяснението…" : "Попитай Пулс"}</button>
      <p class="what">Изпращат се новината и избраният ценови модел. Балансът, паролата и личното потвърждение за сделка остават при теб.</p>
      ${NEWS_AI.error ? `<p class="risk-notice" role="alert">${esc(NEWS_AI.error)}${NEWS_AI.errorCode ? `<small class="validation-note">Код: ${esc(NEWS_AI.errorCode)}</small>` : ""}</p>` : ""}</section>
    <section class="panel" aria-live="polite">${result ? `<span class="pill pill-neutral">${esc(AI_LABELS[result.analysis.status])}</span><h2>${esc(result.analysis.summary)}</h2><p>${esc(result.analysis.relevance)}</p>
      ${section("Възможни сценарии", result.analysis.scenarios)}${section("Какво да провериш", result.analysis.considerations)}${section("Какво още не знаем", result.analysis.limitations)}
      <p class="what">Оценка от ${esc(when(result.generated_at))}. Източник: ${esc(result.source)}. ${result.cached ? "Използвано е запазено обяснение." : ""}</p>
      <p class="what">Това е обяснение на възможните сценарии. Правилата за вход, стоп и изход на стратегията остават в сила.</p>`
      : '<h2>Пулс · обяснение при поискване</h2><p>Избери сигнал и натисни бутона. Ще разгледаме как новината се отнася към неговата посока и срок.</p><p class="what">Когато събитието предстои или данните липсват, обяснението ще посочва неизвестните.</p>'}</section></div>`;
}

document.addEventListener("change", (event) => {
  if (event.target.id !== "analysis-signal") return;
  NEWS_AI.selected.set(analysisSelection(S.route.id).eventId, event.target.value);
  NEWS_AI.error = ""; NEWS_AI.errorCode = "";
  render();
});

document.addEventListener("click", async (event) => {
  if (!event.target.closest("[data-ai-run]") || NEWS_AI.busy) return;
  const { event: news, signal, key } = analysisSelection(S.route.id);
  if (!news) return;
  NEWS_AI.busy = true;
  NEWS_AI.error = ""; NEWS_AI.errorCode = "";
  render();
  try {
    const order = signal ? ordersOf(signal).find((o) => !signal.analysis_dir || o.dir === signal.analysis_dir) : null;
    const context = signal ? { id: signal.id, strategy: signal.strategy, pair: signal.pair, tf: signal.tf, dir: order?.dir, status: signal.status, signal_time: signal.signal_time,
      entry: order?.entry, stop: order?.stop } : null;
    const response = await fetch("api/news-ai.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: news.id, signal: context }) });
    const data = await response.json();
    if (!response.ok || !data.ok) { NEWS_AI.errorCode = data.code || ""; throw new Error(data.error || "Анализът не завърши. Опитай отново."); }
    NEWS_AI.results.set(key, data);
  } catch (error) { NEWS_AI.error = error.message || "Няма връзка с услугата за анализ.";
  } finally { NEWS_AI.busy = false; render(); }
});
