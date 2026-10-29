/* Събира сродните сигнали и описва състоянието им, без да променя правилата за сделки. */
(function (FX) {
  "use strict";
  const directions = (signal) => signal.status === "pending" ? [...new Set((signal.orders || []).map((o) => o.dir))] : [signal.dir];
  function group(signals) {
    const groups = new Map();
    for (const signal of signals) {
      const side = directions(signal).slice().sort().join(","), state = signal.status === "pending" ? "pending" : signal.status === "open" ? "open" : signal.status;
      const key = [signal.pair, signal.style, side, state].join("|");
      if (!groups.has(key)) groups.set(key, { key, pair: signal.pair, style: signal.style, directions: directions(signal), state, signals: [] });
      groups.get(key).signals.push(signal);
    }
    return [...groups.values()];
  }
  function conflicts(signals, pair) {
    const current = signals.filter((s) => s.pair === pair && ["pending", "open"].includes(s.status));
    const day = new Set(), swing = new Set();
    for (const signal of current) {
      const sides = directions(signal);
      if (sides.length !== 1) continue;
      for (const side of sides) (signal.style === "day" ? day : swing).add(side);
    }
    return { opposed: day.has(1) && swing.has(-1) || day.has(-1) && swing.has(1), day: [...day], swing: [...swing] };
  }
  function entryState(signal, quote, timestamp, fresh, marketOpen = true) {
    if (!marketOpen && ["pending", "open"].includes(signal.status)) return { state: "closed-market", label: "Пазарът е затворен", text: "Нивата са от последните налични цени." };
    if (!fresh) return { state: "stale", label: "Изчаква актуални цени", text: "Последната котировка е стара или липсва." };
    if (signal.status === "pending") {
      if (signal.valid_until <= timestamp) return { state: "expired", label: "Срокът за вход е минал", text: "Нужни са нови данни за състоянието на поръчката." };
      const near = (signal.orders || []).some((o) => Number.isFinite(quote) && Math.abs(quote - o.entry) <= .1 * Math.abs(o.entry - o.stop));
      return { state: near ? "near" : "waiting", label: near ? "Около входа" : "Чака вход", text: "Първоначалните вход и стоп са показани по-долу." };
    }
    if (signal.status === "open") {
      const risk = Math.abs(signal.fill_price - signal.stop0), distance = risk > 0 && Number.isFinite(quote) ? Math.abs(quote - signal.fill_price) / risk : null;
      return { state: distance !== null && distance > .25 ? "passed" : "reached", label: distance !== null && distance > .25 ? "Входът е преминал" : "Входното ниво е достигнато",
        text: distance === null ? "Позицията вече е отворена по модела." : `Текущата цена е на ${distance.toFixed(2)}R от първоначалното изпълнение.`, distance };
    }
    return { state: signal.status, label: "Приключил модел", text: "Резултатът е по правилата на стратегията." };
  }
  FX.signalTools = { directions, group, conflicts, entryState };
})(self.FX = self.FX || {});
