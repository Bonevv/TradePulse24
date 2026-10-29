"use strict";

function recordObservedSignals() {
  if (!S.data?.ready) return;
  const signals = S.data.signals || [], marker = [S.settings.style, S.settings.smartPairs, followedIds().join(",")].join("|");
  if (S.observedSource === signals && S.observedView === marker) return;
  S.observedSource = signals; S.observedView = marker;
  S.observed.ingest(signals.filter((sig) => quoteFresh(sig.pair)), now(), (sig) => styleOk(sig.style) && isFollowed(sig.strategy) && pairSignalVisible(sig));
}

function signalGroups(signals) {
  return FX.signalTools.group(signals).map((group) => {
    if (group.signals.length === 1) return signalCard(group.signals[0]);
    const direction = group.directions.length > 1 ? "Покупка или продажба" : group.directions[0] === 1 ? "Покупка" : "Продажба";
    return `<details class="signal-group"><summary><strong>${esc(FX.PAIRS[group.pair].name)} · ${direction}</strong><span>${group.signals.length} варианта · ${STYLE_NAMES[group.style]}</span><small>${group.state === "pending" ? "Чакат вход" : "Нивото вече е достигнато"} · сходните сигнали могат да зависят от едно движение</small></summary>
      <p class="what">Входовете, стоповете и изходите на всеки вариант са отделни. Разгъни картата, която искаш да разгледаш.</p><div class="sig-grid">${group.signals.map(signalCard).join("")}</div></details>`;
  }).join("");
}

function conflictNotice(pair) {
  const visible = (S.data?.signals || []).filter((sig) => !sig.retired && isFollowed(sig.strategy) && pairSignalVisible(sig));
  const conflict = FX.signalTools.conflicts(visible, pair);
  if (!conflict.opposed) return "";
  const label = (dirs) => dirs.length > 1 ? "две посоки" : dirs[0] === 1 ? "покупка" : "продажба";
  return `<p class="warn-line">${esc(FX.PAIRS[pair].name)}: дневни сигнали за ${label(conflict.day)}, суинг за ${label(conflict.swing)}. Посоките се разминават при различни срокове.</p>`;
}

function signalAvailability(sig) {
  if (["pending", "open"].includes(sig.status) && !(S.data?.signals || []).some((current) => current.id === sig.id))
    return '<div class="entry-state entry-stale"><strong>Няма актуално изчисление</strong><span>Показан е последният запазен запис. Провери данните, преди да използваш нивата.</span></div>';
  const state = FX.signalTools.entryState(sig, S.data?.pairs?.[sig.pair]?.price, now(), quoteFresh(sig.pair) && (S.data?.signals || []).some((current) => current.id === sig.id), S.data?.market?.open !== false);
  if (!["pending", "open"].includes(sig.status)) return "";
  return `<div class="entry-state entry-${state.state}"><strong>${esc(state.label)}</strong><span>${esc(state.text)}</span></div>`;
}

function noSignalsReason() {
  if (!S.data?.prices_updated) return "Липсват текущи цени. Виж състоянието на обновяването в Лабораторията.";
  if (!S.data.market?.open) return "Пазарът е затворен. Последните нива остават достъпни в следените сигнали и журнала.";
  if (!FX.PAIR_KEYS.some(quoteFresh)) return "Котировките са остарели. Изчакваме обновяване от източника.";
  const selected = strategies().filter((entry) => styleOk(entry.style) && isFollowed(entry.id) && !entry.retired);
  if (!selected.length) return "Не следваш активна стратегия за този стил. Избери варианти от „Стратегии“.";
  if (S.settings.smartPairs && selected.every((entry) => entry.costs_outdated)) return "Разходите са променени. Нужен е нов тест с текущите стойности, преди подборът да допуска нови сигнали.";
  if (S.settings.smartPairs && !selected.some((entry) => entry.per_pair?.some((row) => FX.pairChoice(entry, row.pair, now()).allowed)))
    return "Избраните варианти нямат инструмент, който да покрива текущия подбор. Провери датата на историята и оценките по двойки.";
  const hour = FX.local(now()).hour;
  if (S.settings.style === "day" && (hour < 8 || hour >= 18)) return "Извън часовете за нови входове на дневните кандидати. Вече отворените модели продължават да се проследяват.";
  return "При текущите цени няма модел, който да изпълнява условията и избрания филтър. Следващото обновяване ще провери отново.";
}

function testCostsDetails(entry) {
  const profile = FX.costs.normalize(entry.cost_profile || {});
  return `<details class="test-costs"><summary>Разходи в този резултат${entry.costs_outdated ? " · различни от текущите" : ""}</summary><p class="what">История до ${esc(dateOnly(entry.pair_review?.data_end || entry.stats.end))}. Спредът, комисионата и приплъзването са общо за вход и изход, в пипсове. Суапът е за ден.</p>
    <div class="table-wrap"><table class="data"><thead><tr><th>Инструмент</th><th>Спред</th><th>Комисиона</th><th>Приплъзване</th><th>Суап покупка</th><th>Суап продажба</th></tr></thead><tbody>${(entry.pairs || FX.PAIR_KEYS).map((pair) => `<tr><td>${FX.PAIRS[pair].name}</td>${FX.costs.fields.map((field) => `<td>${profile.pairs[pair][field]}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <p class="what">Суап: 17:00 America/New_York, тройна сряда. За началните архивни резултати допълнителните разходи са нула. Промяната на профила изисква нов тест.</p></details>`;
}

function evaluationNotice() {
  const entries = strategies().filter((entry) => !entry.retired && styleOk(entry.style) && isFollowed(entry.id));
  const ends = entries.map((entry) => entry.pair_review?.data_end || entry.stats?.end).filter((end) => end > 0);
  if (!ends.length) return "";
  const earliest = Math.min(...ends), left = Math.ceil((earliest + 90 * 86400 - now()) / 86400);
  const oldestTest = Math.min(...entries.map((entry) => entry.pair_review?.tested_at || entry.stats?.end || now()));
  const monthly = now() - oldestTest >= 30 * 86400;
  if (left > 30 && !monthly) return "";
  return `<div class="warn-line">${monthly ? "Изминал е месец от някои от избраните тестове. " : ""}${left <= 0 ? "Някои оценки са остарели." : `Най-старата избрана оценка изтича след ${left} дни.`} Историята ѝ завършва на ${esc(dateOnly(earliest))}. Пусни нов тест с обновени цени от Лабораторията. Следените сигнали продължават да се обновяват.</div>`;
}

function viewObserved() {
  const records = S.observed.list().filter((record) => record.initial.style === S.settings.style), stats = S.observed.summary(S.settings.style);
  return `<div class="page-heading"><div><p class="kicker">ЗАПИСАНИ ПРИ НАБЛЮДЕНИЕ</p><h1>Журнал на сигналите</h1><p>Записва показаните текущи сигнали, докато сайтът е отворен в този браузър. Първоначалните нива остават в записа.</p></div><a class="btn btn-outline" href="#/signals">Към сигналите</a></div>
    ${S.observed.error ? `<p class="risk-notice">${esc(S.observed.error)}</p>` : ""}
    <div class="risk-metrics">${[["Наблюдавани", stats.total], ["Записани преди входа", stats.forward], ["Приключили след наблюдението", stats.closed], ["Средно след наблюдението", stats.average === null ? "Още няма извадка" : fmtR(stats.average)]].map(([label, value]) => `<section class="panel"><p class="kicker">${label}</p><strong>${value}</strong></section>`).join("")}</div>
    <p class="what">${stats.late} сигнала са видени след възможния вход или без предварително наблюдение. Те остават в журнала, но не участват в резултата „след наблюдението“. При промяна на правилата или разходите сравнението се отбелязва като непълно. Пропуснатото време при затворен сайт не се попълва със задна дата.</p>
    <section class="panel"><div class="panel-head"><h2>Записи · ${STYLE_NAMES[S.settings.style]}</h2><div class="chips-row"><button class="tiny-btn" data-observed-export>Изтегли копие</button><label class="tiny-btn">Внеси копие<input id="observed-import" type="file" accept="application/json" hidden></label></div></div>
    ${records.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Първо наблюдение</th><th>Сигнал</th><th>Първоначални нива</th><th>Проследяване</th><th>Резултат</th></tr></thead><tbody>${records.slice(0, 200).map((record) => {
      const first = record.initial, latest = record.latest;
      return `<tr><td>${esc(when(record.first_seen))}<br><small>${record.forward ? "Преди входа" : "Закъсняло наблюдение"}</small></td><td><a class="link" href="#/signal/${encodeURIComponent(record.id)}">${esc(FX.PAIRS[first.pair].name)} · ${esc(first.strategy_name || first.strategy)}</a><br><small>${first.tf} · версия ${first.version || 1}</small></td>
        <td>${(first.orders || []).map((order) => `${order.dir === 1 ? "Купи" : "Продай"} ${px(first.pair, order.entry)} · стоп ${px(first.pair, order.stop)}`).join("<br>")}</td><td>${esc(statusInfo({ ...latest, orders: latest.orders || [] }).label)}<br><small>${record.comparable ? "Същите правила и разходи" : "Променени правила, нива или разходи"} · проверен ${esc(when(record.last_seen))}</small></td><td>${Number.isFinite(latest.r) ? fmtR(latest.r) : "—"}</td></tr>`;
    }).join("")}</tbody></table></div>${records.length > 200 ? '<p class="what">Показани са последните 200 записа. Изтегленото копие съдържа всички.</p>' : ""}` : '<p>Още няма наблюдавани сигнали за този стил.</p>'}
    <p class="what">Това е журнал на ценовите модели. Реалните си сделки записваш отделно в „Риск и дневник“. И двата журнала се пазят само в този браузър.</p></section>`;
}

function downloadJSON(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-observed-export]")) downloadJSON(S.observed.export(), "tradepulse24-signali.json");
});
document.addEventListener("change", async (event) => {
  if (event.target.id !== "observed-import" || !event.target.files[0]) return;
  try {
    if (event.target.files[0].size > 5 * 1024 * 1024) throw new Error("Копието е твърде голямо.");
    S.observed.import(await event.target.files[0].text()); toast("Копието е внесено. Съществуващите записи са запазени."); render();
  } catch (error) { toast(error.message || "Копието не можа да се прочете."); }
});
