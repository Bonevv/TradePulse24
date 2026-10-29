/* Събира сродните сигнали и описва състоянието им, без да променя правилата за сделки. */
(function (FX) {
  "use strict";
  const directions = (signal) => signal.status === "pending" ? [...new Set((signal.orders || []).map((o) => o.dir))] : [signal.dir];
  function group(signals) {
    const groups = new Map();
    for (const signal of signals) {
      const key = [signal.pair, signal.style].join("|");
      if (!groups.has(key)) groups.set(key, { key, pair: signal.pair, style: signal.style, directions: [], state: signal.status, signals: [] });
      const group = groups.get(key);
      group.signals.push(signal);
      group.directions = [...new Set([...group.directions, ...directions(signal)])];
      if (group.state !== signal.status) group.state = "mixed";
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
  const signedR = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(2).replace(".", ",") + "R";
  /** Кратък етикет за картата: какво да прави човек, който още не е влязъл. */
  FX.ADVICE_LABELS = {
    enter: "Може да се влезе",
    wait: "Изчакай връщане",
    late: "Късно — не влизай",
    against: "Цената е към стопа",
    too_close: "Твърде близо до стопа",
    stopped: "Цената е на стопа",
  };
  function adviceText(advice, digits) {
    const lvl = (v) => (Number.isFinite(v) ? v.toFixed(digits) : "—");
    const where = `Цената е на ${signedR(advice.e)} от входа на модела.`;
    if (advice.advice === "enter") return `${where} Ако още не си влязъл, може да влезеш сега.`;
    if (advice.advice === "wait") return `${where} Не гони цената: изчакай връщане до ${lvl(advice.level)}.`;
    if (advice.advice === "late") {
      const why = { part: "Моделът вече е взел първата цел.", target: "Цената е стигнала целта.", stop_moved: "Моделът вече е преместил стопа в печалба.", time: "До затварянето на дневната сделка остава малко време.", distance: "Цената е далеч от входа." }[advice.reason] || "";
      return `${where} ${why} Не отваряй нова позиция по този сигнал.`;
    }
    if (advice.advice === "against") return `${where} Цената върви към стопа; прочети вариантите в сигнала, преди да влизаш.`;
    if (advice.advice === "too_close") return `${where} До стопа остава твърде малко. Не влизай.`;
    if (advice.advice === "stopped") return "Цената е на стопа или отвъд него. Моделът приключва на загуба. Не влизай.";
    return where;
  }

  function entryState(signal, quote, timestamp, fresh, marketOpen = true, levels = null) {
    if (!marketOpen && ["pending", "open"].includes(signal.status)) return { state: "closed-market", label: "Пазарът е затворен", text: "Нивата са от последните налични цени." };
    if (!fresh) return { state: "stale", label: "Изчаква актуални цени", text: "Последната котировка е стара или липсва." };
    if (signal.status === "pending") {
      if (signal.valid_until <= timestamp) return { state: "expired", label: "Срокът за вход е минал", text: "Нужни са нови данни за състоянието на поръчката." };
      const near = (signal.orders || []).some((o) => Number.isFinite(quote) && Math.abs(quote - o.entry) <= .1 * Math.abs(o.entry - o.stop));
      return { state: near ? "near" : "waiting", label: near ? "Около входа" : "Чака вход", text: "Първоначалните вход и стоп са показани по-долу." };
    }
    if (signal.status === "open") {
      const stop0 = signal.stop0 ?? signal.stop, risk = Math.abs(signal.fill_price - stop0);
      const distance = risk > 0 && Number.isFinite(quote) ? Math.abs(quote - signal.fill_price) / risk : null;
      if (distance === null || !FX.entryAdvice) return { state: "reached", label: "Входното ниво е достигнато", text: "Позицията вече е отворена по модела.", distance };
      const dir = signal.dir || (signal.fill_price > stop0 ? 1 : -1);
      const advice = FX.entryAdvice({ dir, entry: signal.fill_price, stop: signal.stop ?? stop0, stop0, half: !!signal.half, targets: [signal.tp1, signal.tp2] }, quote, levels || FX.entryLevels(null));
      if (!advice) return { state: "reached", label: "Входното ниво е достигнато", text: "Позицията вече е отворена по модела.", distance };
      // state остава съвместимо: reached — около входа, passed — цената е отминала входа, against — към стопа.
      const state = advice.advice === "enter" ? "reached" : advice.e < 0 || advice.advice === "stopped" ? "against" : "passed";
      const digits = FX.PAIRS?.[signal.pair]?.digits ?? 5;
      const label = advice.advice === "wait" && Number.isFinite(advice.level) ? `Изчакай връщане до ${advice.level.toFixed(digits)}` : FX.ADVICE_LABELS[advice.advice];
      return { state, advice: advice.advice, label, text: adviceText(advice, digits), distance, moved: advice.e };
    }
    return { state: signal.status, label: "Приключил модел", text: "Резултатът е по правилата на стратегията." };
  }
  FX.signalTools = { directions, group, conflicts, entryState };
})(self.FX = self.FX || {});
