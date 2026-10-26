/* Наблюдение на избрани сигнали в този браузър; никога не приема изпълнение при брокер. */
(function (root) {
  "use strict";
  const KEY = "forex-signals-watch-v2";
  const LIMIT = 100;
  const EVENTS_LIMIT = 80;
  const STATES = Object.freeze({
    pending: "Чака вход", open: "Входното ниво е достигнато", target1: "Цел 1 е достигната",
    cancelled: "Отмени неизпълнената поръчка", closed: "Сделката е приключила по модела",
  });
  const validId = (id) => typeof id === "string" && /^[a-zA-Z0-9_-]{5,160}$/.test(id);
  const time = (v) => Number.isFinite(Number(v)) && Number(v) > 0 ? Math.trunc(Number(v)) : null;
  const kind = (s) => s.status === "pending" ? "pending" : s.status === "cancelled" ? "cancelled"
    : s.status === "closed" ? "closed" : s.half ? "target1" : "open";
  function milestones(s) {
    const events = [{ key: "signal", at: time(s.signal_time), text: "Сигналът е генериран по исторически данни" }];
    if (s.fill_time) events.push({ key: "fill", at: time(s.fill_time), text: "Входното ниво е достигнато в ценовия модел" });
    if (s.tp1_time) events.push({ key: "target1", at: time(s.tp1_time), text: "Цел 1 е достигната по модела" });
    if (s.stop != null && s.stop0 != null && s.stop !== s.stop0)
      events.push({ key: `stop:${s.stop}`, at: null, text: `Текущ стоп по модела: ${s.stop}` });
    if (s.status === "cancelled") events.push({ key: "cancel", at: time(s.exit_time) || time(s.valid_until),
      text: s.reason === "void" ? "Входът е невалиден — отмени неизпълнената поръчка" : "Срокът изтече — отмени неизпълнената поръчка" });
    if (s.status === "closed") events.push({ key: "closed", at: time(s.exit_time), text: "Сделката е приключила по ценовия модел" });
    return events;
  }
  function load() {
    try {
      const value = JSON.parse(root.localStorage.getItem(KEY) || "{}");
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return Object.fromEntries(Object.entries(value).filter(([id, w]) =>
          validId(id) && w && typeof w === "object" && w.snapshot && Array.isArray(w.events)));
      }
    } catch (_) { /* Някои браузъри забраняват локалното съхранение. */ }
    return {};
  }
  class WatchStore {
    constructor() { this.items = load(); }
    save(next) {
      try { root.localStorage.setItem(KEY, JSON.stringify(next)); this.items = next; return true; }
      catch (_) { return false; }
    }
    has(id) { return Object.prototype.hasOwnProperty.call(this.items, id); }
    get(id) { return this.has(id) ? this.items[id] : null; }
    list() { return Object.values(this.items).sort((a, b) => b.watchedAt - a.watchedAt); }
    add(sig, observed = Math.floor(Date.now() / 1000)) {
      if (!sig || !validId(sig.id)) return false;
      if (this.has(sig.id)) return true;
      if (this.list().length >= LIMIT) return false;
      const w = { id: sig.id, watchedAt: observed, updatedAt: observed, snapshot: sig,
        state: kind(sig), entered: false, actualEntry: null, events: [
          { key: "watched", at: observed, observed, text: "Започна да следиш този сигнал" },
          ...milestones(sig).map((e) => ({ ...e, observed })),
        ] };
      return this.save({ ...this.items, [sig.id]: w });
    }
    remove(id) {
      if (!this.has(id)) return false;
      const next = { ...this.items }; delete next[id]; return this.save(next);
    }
    confirm(id, entered, actualPrice = null, observed = Math.floor(Date.now() / 1000)) {
      const old = this.get(id);
      if (!old) return false;
      const price = Number(actualPrice);
      const validPrice = actualPrice !== null && actualPrice !== "" && Number.isFinite(price) && price > 0 ? price : null;
      const entry = entered ? { price: validPrice, at: observed } : null;
      const w = { ...old, entered: !!entered, actualEntry: entry, events: [
        ...old.events, { key: `manual:${observed}:${entered}`, at: observed, observed,
          text: entered ? "Потвърди лично влизане при брокера" : "Премахна потвърждението за реална позиция" },
      ].slice(-EVENTS_LIMIT) };
      return this.save({ ...this.items, [id]: w });
    }
    ingest(signals, observed = Math.floor(Date.now() / 1000)) {
      if (!Array.isArray(signals)) return [];
      const byId = new Map(signals.map((s) => [s.id, s]));
      const next = { ...this.items }, changes = [];
      for (const w of this.list()) {
        const s = byId.get(w.id);
        if (!s) continue; // Липса в последните 14 дни не означава автоматично „отменен“.
        const state = kind(s), seen = new Set(w.events.map((e) => e.key));
        const add = milestones(s).filter((e) => !seen.has(e.key)).map((e) => ({ ...e, observed }));
        const updated = { ...w, snapshot: s, state, updatedAt: observed,
          events: [...w.events, ...add].slice(-EVENTS_LIMIT) };
        if (w.state !== state && w.state !== "closed" && w.state !== "cancelled")
          changes.push({ id: w.id, state, text: STATES[state], pair: s.pair });
        next[w.id] = updated;
      }
      if (!this.save(next)) return [];
      return changes;
    }
  }
  root.FXWatch = Object.freeze({ WatchStore, kind, label: STATES });
})(typeof window !== "undefined" ? window : globalThis);
