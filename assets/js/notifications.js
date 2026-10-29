"use strict";

const SignalNotices = {
  seen: new Set(), ready: false,
  ingest(signals) {
    const fresh = signals.filter((sig) => sig.status === "pending" && quoteFresh(sig.pair) && isFollowed(sig.strategy) && pairSignalVisible(sig));
    const added = fresh.filter((sig) => !this.seen.has(sig.id));
    for (const sig of fresh) this.seen.add(sig.id);
    if (this.seen.size > 2000) this.seen = new Set([...this.seen].slice(-1000));
    const firstLoad = !this.ready; this.ready = true;
    if (firstLoad || !S.settings.notifications || typeof Notification === "undefined" || Notification.permission !== "granted" || !added.length) return;
    const groups = FX.signalTools.group(added.filter((sig) => styleOk(sig.style)));
    for (const group of groups.slice(0, 3)) {
      const first = group.signals[0], direction = group.directions.length > 1 ? "две посоки" : group.directions[0] === 1 ? "покупка" : "продажба";
      try {
        const notice = new Notification(`${FX.PAIRS[group.pair].name} · ${direction}`, { body: `${group.signals.length} нови варианта · ${STYLE_NAMES[group.style]}. Провери входа и общия риск.`, tag: "tp24-" + group.key });
        notice.onclick = () => { window.focus(); location.hash = "#/signal/" + encodeURIComponent(first.id); notice.close(); };
      } catch (_) { /* Някои браузъри разрешават само известия през service worker. */ }
    }
  },
};
function noticesPanel() {
  const available = typeof Notification !== "undefined";
  return `<section class="panel"><h2>Известия за сигнали</h2><p>Работят, докато сайтът е отворен. Първото зареждане не изпраща известия за вече наличните модели.</p>
    <button type="button" class="btn btn-outline" data-notices ${available ? "" : "disabled"}>${S.settings.notifications ? "Изключи известията" : "Включи известията"}</button><p class="what">${available ? `Разрешение от браузъра: ${Notification.permission === "granted" ? "дадено" : Notification.permission === "denied" ? "отказано — промени го от настройките на сайта в браузъра" : "още не е поискано"}.` : "Този браузър не поддържа известия от отворена страница."}</p></section>`;
}
document.addEventListener("click", async (event) => {
  if (!event.target.closest("[data-notices]")) return;
  if (S.settings.notifications) { S.settings.notifications = false; saveSettings(); render(); return; }
  if (typeof Notification === "undefined") return;
  try {
    const permission = await Notification.requestPermission();
    S.settings.notifications = permission === "granted"; saveSettings(); render();
    toast(permission === "granted" ? "Известията са включени за новите сигнали при отворен сайт." : "Известията не са разрешени от браузъра.");
  } catch (_) { toast("Браузърът не позволи включване на известията."); }
});
