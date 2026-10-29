/* Записва какво е било наблюдавано в този браузър. Не възстановява пропуснати сигнали. */
(function (root) {
  "use strict";
  const KEY = "tradepulse24-observed-v1", LIMIT = 1500;
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const validId = (id) => typeof id === "string" && id.includes("-") && /^[a-zA-Z0-9_-]{5,160}$/.test(id);
  function validSignal(signal) {
    return signal && validId(signal.id) && typeof signal.strategy === "string" && root.FX.PAIR_KEYS.includes(signal.pair)
      && root.FX.TF_KEYS.includes(signal.tf) && ["day", "swing"].includes(signal.style) && ["pending", "open", "closed", "cancelled"].includes(signal.status)
      && Number.isFinite(signal.signal_time) && signal.signal_time > 0 && Number.isFinite(signal.valid_until) && signal.valid_until > 0
      && Array.isArray(signal.orders) && signal.orders.length > 0 && signal.orders.length <= 2
      && signal.orders.every((order) => [-1, 1].includes(order.dir) && Number.isFinite(order.entry) && order.entry > 0 && Number.isFinite(order.stop) && order.stop > 0)
      && (signal.status !== "closed" || Number.isFinite(signal.r) && Number.isFinite(signal.fill_time) && Number.isFinite(signal.exit_time));
  }
  function snapshot(signal) {
    const keys = ["id", "strategy", "strategy_name", "version", "cost_model", "pair", "pair_name", "tf", "tf_label", "style", "status", "signal_time", "valid_until", "dir", "entry", "stop", "stop0", "fill_price", "fill_time", "exit_time", "reason", "r", "half", "cost_r", "why", "parts", "tp1", "tp2", "tp1_time", "order_type"];
    const out = Object.fromEntries(keys.filter((key) => signal[key] !== undefined).map((key) => [key, signal[key]]));
    out.strategy_name = signal.strategy_name || signal.strategy;
    out.tf_label = signal.tf_label || root.FX.TIMEFRAMES[signal.tf].label;
    out.pair_name = signal.pair_name || root.FX.PAIRS[signal.pair].name;
    out.orders = (signal.orders || []).map((order) => Object.fromEntries(["dir", "type", "entry", "stop", "tp1", "tp2", "targets", "activate_after", "fixed_target"].filter((key) => order[key] !== undefined).map((key) => [key, order[key]])));
    return copy(out);
  }
  function validate(record) {
    if (!record || !validId(record.id) || !validSignal(record.initial) || !validSignal(record.latest) || record.initial.id !== record.id || record.latest.id !== record.id
      || !Number.isFinite(record.first_seen) || !Number.isFinite(record.last_seen) || record.last_seen < record.first_seen
      || !root.FX.PAIRS[record.initial.pair] || !["M15", "H1", "H4", "D1"].includes(record.initial.tf)
      || !Array.isArray(record.events) || record.events.length > 40) throw new Error("В копието има невалиден запис на сигнал.");
    return copy(record);
  }
  const stateKey = (sig) => [sig.status, sig.half ? 1 : 0, sig.stop, sig.fill_time, sig.exit_time].join("|");
  class Store {
    constructor() {
      this.records = {}; this.error = ""; this.unreadable = false;
      try {
        const saved = JSON.parse(root.localStorage.getItem(KEY) || '{"version":1,"records":[]}');
        if (saved.version !== 1 || !Array.isArray(saved.records) || saved.records.length > LIMIT) throw new Error();
        this.records = Object.fromEntries(saved.records.map((record) => { const valid = validate(record); return [valid.id, valid]; }));
      } catch (_) { this.unreadable = true; this.error = "Запазеният журнал не може да се прочете. Изтегли копие, преди да го нулираш."; }
    }
    list() { return Object.values(this.records).sort((a, b) => b.first_seen - a.first_seen); }
    save(next) {
      if (this.unreadable) return false;
      try { root.localStorage.setItem(KEY, JSON.stringify({ version: 1, records: Object.values(next) })); this.records = next; return true; }
      catch (_) { this.error = "Браузърът не позволи записа. Изтегли копие на журнала и провери свободното място."; return false; }
    }
    ingest(signals, observed, eligible) {
      if (this.unreadable || !Array.isArray(signals)) return [];
      const next = { ...this.records }, added = [];
      let count = Object.keys(next).length;
      for (const signal of signals) {
        if (!validSignal(signal)) continue;
        const old = next[signal.id];
        if (!old) {
          if (!eligible(signal) || !["pending", "open"].includes(signal.status)) continue;
          if (count >= LIMIT) { this.error = "Журналът е пълен. Изтегли копие; старите записи са запазени."; continue; }
          const initial = snapshot(signal);
          const forward = signal.status === "pending" && !signal.fill_time && signal.signal_time <= observed
            && observed < signal.valid_until && (signal.orders || []).every((order) => order.type !== "market");
          next[signal.id] = { id: signal.id, first_seen: observed, last_seen: observed, initial,
            latest: copy(initial), forward, comparable: true, events: [{ observed, state: stateKey(initial), status: initial.status }] };
          added.push(next[signal.id]); count++;
        } else {
          const latest = snapshot(signal);
          const levels = (snapshot) => JSON.stringify(snapshot.orders.map((order) => [order.dir, order.type, order.entry, order.stop]));
          const comparable = old.comparable !== false && (old.initial.version || 1) === (latest.version || 1) && (old.initial.cost_model || "model-v1") === (latest.cost_model || "model-v1") && levels(old.initial) === levels(latest);
          const event = stateKey(latest) !== stateKey(old.latest) ? [{ observed, state: stateKey(latest), status: latest.status }] : [];
          next[signal.id] = { ...old, latest, comparable, last_seen: observed, events: [...old.events, ...event].slice(-40) };
        }
      }
      return this.save(next) ? added : [];
    }
    export() {
      if (this.unreadable) return root.localStorage.getItem(KEY) || "";
      return JSON.stringify({ version: 1, records: this.list() }, null, 2);
    }
    import(text) {
      if (this.unreadable) throw new Error("Първо изтегли копие на нечетимия журнал.");
      const data = JSON.parse(text);
      if (data.version !== 1 || !Array.isArray(data.records) || data.records.length > LIMIT) throw new Error("Това не е копие на журнала на сигналите.");
      const next = { ...this.records };
      for (const row of data.records) { const record = validate(row); if (!next[record.id]) next[record.id] = record; }
      if (Object.keys(next).length > LIMIT) throw new Error("Обединеният журнал надхвърля 1500 записа.");
      if (!this.save(next)) throw new Error(this.error);
    }
    summary(style) {
      const all = this.list().filter((record) => !style || record.initial.style === style);
      const closed = all.filter((record) => record.forward && record.comparable && record.latest.status === "closed"
        && record.latest.fill_time >= record.first_seen && Number.isFinite(record.latest.r));
      return { total: all.length, forward: all.filter((record) => record.forward).length, closed: closed.length,
        average: closed.length ? closed.reduce((sum, record) => sum + record.latest.r, 0) / closed.length : null,
        wins: closed.filter((record) => record.latest.r > .02).length, late: all.filter((record) => !record.forward).length };
    }
  }
  root.FXObserved = { Store, snapshot, key: KEY };
})(typeof window !== "undefined" ? window : globalThis);
