"use strict";

function labMaintenancePanel() {
  const profile = FX.costs.normalize(S.costProfile), labels = { spread: "Спред", commission: "Комисиона", slippage: "Приплъзване", swap_long: "Суап покупка", swap_short: "Суап продажба" };
  const check = LAB.installation;
  return `<details class="panel maintenance-panel" ${LAB.maintenanceOpen ? "open" : ""}><summary>Разходи, резервно копие и версия</summary>
    <h3>Разходи за историческия тест</h3><p class="what">Всички стойности са в пипсове за един лот. При EUR/USD пипсът е 0.0001, при USD/JPY — 0.01, при XAU/USD — 0.10. Комисионата и приплъзването са общо за входа и изхода. Началният спред запазва стария общ моделен разход; при собствена настройка попълни спреда и комисионата отделно.</p>
    <form id="lab-costs"><div class="table-wrap"><table class="data costs-table"><thead><tr><th>Инструмент</th>${FX.costs.fields.map((field) => `<th>${labels[field]}</th>`).join("")}</tr></thead><tbody>${FX.PAIR_KEYS.map((pair) => `<tr><td>${FX.PAIRS[pair].name}</td>${FX.costs.fields.map((field) => `<td><input name="${pair}.${field}" type="number" ${field.startsWith("swap_") ? 'min="-10000"' : 'min="0"'} max="10000" step="any" value="${esc(LAB.costDraft?.[pair]?.[field] ?? profile.pairs[pair][field])}" aria-label="${labels[field]} ${FX.PAIRS[pair].name}" ${LAB.maintenanceBusy ? "disabled" : ""} required></td>`).join("")}</tr>`).join("")}</tbody></table></div>
      <p class="what">Суапът е за един ден: положителното число е разход, отрицателното — начислена сума. Моделът използва 17:00 America/New_York, тройна сряда и без отделно начисляване през събота и неделя. При частичен изход се отчита държането на всяка част. Провери условията на своя брокер.</p>
      <button class="btn btn-outline" ${LAB.maintenanceBusy || LAB.running || LAB.saving ? "disabled" : ""}>Запази разходите</button><p class="what">Промяната изисква нов тест. Старите резултати остават видими със забележка за различните разходи.</p></form>
    <h3>Сървърно копие</h3><p class="what">Съдържа публикуваните резултати, собствените стратегии, черновите и разходите. Ключовете, паролите и ценовата история не се включват. Личните журнали имат отделни бутони за копие в своите раздели.</p>
    <div class="chips-row"><button class="btn btn-outline" data-maintenance="backup" ${LAB.maintenanceBusy ? "disabled" : ""}>Изтегли сървърно копие</button><label class="btn btn-outline">Възстанови копие<input id="server-backup-import" type="file" accept="application/json" hidden></label><button class="btn btn-outline" data-maintenance="installation" ${LAB.maintenanceBusy ? "disabled" : ""}>Провери файловете</button></div>
    ${check ? `<p class="${check.ok ? "pos" : "warn-line"}">${check.ok ? "Файловете съвпадат с пакета" : "Има липсващи или различни файлове"} · версия ${esc(check.release || "неизвестна")}</p>${check.files.filter((row) => row.state !== "ok").map((row) => `<p class="what">${esc(row.file)}: ${row.state === "missing" ? "липсва" : "различно съдържание"}</p>`).join("")}` : ""}
    <p class="what">Преди запис на разходи, чернови и тестове се прави сървърно копие. Еднакво съдържание не прави ново копие. Пазят се последните 10, по едно на ден за 14 дни и по едно на седмица за 8 седмици. Преди качване на нова версия изтегли копие и запази отделно api/config.php и api/config.local.php.</p></details>`;
}

function maintenanceRender() { if (["lab", "workshop"].includes(S.route.view)) render(); }
document.addEventListener("toggle", (event) => {
  if (event.target.classList?.contains("maintenance-panel") && typeof LAB !== "undefined") LAB.maintenanceOpen = event.target.open;
}, true);
document.addEventListener("input", (event) => {
  if (!event.target.closest("#lab-costs")) return;
  const [pair, field] = event.target.name.split(".");
  if (!FX.PAIR_KEYS.includes(pair) || !FX.costs.fields.includes(field)) return;
  LAB.costDraft = LAB.costDraft || {}; LAB.costDraft[pair] = LAB.costDraft[pair] || {}; LAB.costDraft[pair][field] = event.target.value;
});

document.addEventListener("submit", async (event) => {
  if (event.target.id !== "lab-costs") return;
  event.preventDefault();
  if (!LAB.authed || LAB.maintenanceBusy) return;
  if (LAB.running || LAB.saving) { toast("Изчакай текущия тест или запис, преди да променяш разходите."); return; }
  const form = new FormData(event.target), pairs = {};
  try {
    for (const pair of FX.PAIR_KEYS) pairs[pair] = Object.fromEntries(FX.costs.fields.map((field) => [field, Number(form.get(pair + "." + field))]));
    const profile = FX.costs.normalize({ pairs });
    LAB.maintenanceBusy = true;
    LAB.maintenanceOpen = true; maintenanceRender();
    const data = await labPost("costs", profile);
    S.costProfile = FX.costs.normalize(data.costs);
    LAB.costDraft = null;
    JSON_CACHE.delete("api/state.php");
    if (LAB.worker) { LAB.worker.terminate(); LAB.worker = null; }
    LAB.loaded = false; LAB.loading = null;
    toast("Разходите са запазени. Зареди историята и пусни нов тест.");
    await load();
  } catch (error) { toast(error.message || "Разходите не са записани."); }
  finally { LAB.maintenanceBusy = false; maintenanceRender(); }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-maintenance]");
  if (!button || !LAB.authed || LAB.maintenanceBusy) return;
  LAB.maintenanceBusy = true;
  try {
    const action = button.dataset.maintenance, data = await labPost(action);
    if (action === "backup") downloadJSON(JSON.stringify(data.backup, null, 2), "tradepulse24-server-backup.json");
    if (action === "installation") LAB.installation = data.installation;
  } catch (error) { toast(error.message || "Проверката не завърши."); }
  finally { LAB.maintenanceBusy = false; maintenanceRender(); }
});

document.addEventListener("change", async (event) => {
  if (event.target.id !== "server-backup-import" || !event.target.files[0] || !LAB.authed) return;
  if (LAB.maintenanceBusy || LAB.running || LAB.saving) { toast("Изчакай текущия тест или запис, преди да възстановяваш копие."); return; }
  try {
    const file = event.target.files[0];
    if (file.size > 25 * 1024 * 1024) throw new Error("Копието е твърде голямо.");
    const backup = JSON.parse(await file.text());
    if (backup.format !== "tradepulse24-server-backup" || backup.version !== 1) throw new Error("Това не е сървърно копие на TradePulse24.");
    if (!confirm("Да възстановя ли резултатите, стратегиите, черновите и разходите от това копие? Преди промяната ще се запази текущото състояние.")) return;
    LAB.maintenanceBusy = true;
    const data = await labPost("restore", backup);
    labWorkspace(data.workspace); LAB.costDraft = null; JSON_CACHE.clear();
    if (LAB.worker) { LAB.worker.terminate(); LAB.worker = null; }
    LAB.loaded = false; LAB.loading = null;
    await load(); toast("Копието е възстановено. Цените и локалните ключове са запазени.");
  } catch (error) { toast(error.message || "Копието не можа да се възстанови."); }
  finally { LAB.maintenanceBusy = false; event.target.value = ""; maintenanceRender(); }
});
