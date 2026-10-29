/* Вход след сигнала: къде е цената спрямо модела, коя поръчка влиза на дадено ниво
   и какво показва историята, ако влезеш по-късно (по-лоша цена) или когато цената
   е тръгнала към стопа (по-добра цена). Работи и в браузъра, и във Web Worker. */
(function (FX) {
  "use strict";

  // Прагове в R от входа на модела, докато историята на стратегията не е измерена.
  FX.ENTRY = { ok: 0.15, late: 0.5, against: 0.25, tooClose: 0.75, minTrades: 20, minutes: 60 };
  const LATE_STEPS = [0.1, 0.25, 0.5, 0.75], EARLY_STEPS = [0.25, 0.5, 0.75], BACK_STEPS = [0.25, 0.5], BACK_LEVELS = [0, 0.1], RECOVER_STEP = 0.5;

  /* ---------------------------------------------------------- видове поръчки */
  FX.ORDER_KINDS = {
    buy: { name: "Buy", type: "Пазарна (Market Execution)", short: "купи веднага по текущата цена", side: "по текущата цена (Ask)" },
    sell: { name: "Sell", type: "Пазарна (Market Execution)", short: "продай веднага по текущата цена", side: "по текущата цена (Bid)" },
    buy_stop: { name: "Buy Stop", type: "Отложена (Pending Order)", short: "купи, ако цената се качи до нивото", side: "над текущата цена" },
    sell_stop: { name: "Sell Stop", type: "Отложена (Pending Order)", short: "продай, ако цената падне до нивото", side: "под текущата цена" },
    buy_limit: { name: "Buy Limit", type: "Отложена (Pending Order)", short: "купи, ако цената се върне надолу до нивото", side: "под текущата цена" },
    sell_limit: { name: "Sell Limit", type: "Отложена (Pending Order)", short: "продай, ако цената се върне нагоре до нивото", side: "над текущата цена" },
  };
  /** Видът поръчка на модела: стоп (пробив), лимит (връщане) или пазарна. */
  FX.orderKind = (dir, type) => (type === "market" ? (dir === 1 ? "buy" : "sell") : (dir === 1 ? "buy_" : "sell_") + (type === "limit" ? "limit" : "stop"));
  /** Коя поръчка влиза на level при текуща цена price. Брокерът отказва Buy Stop под цената и Buy Limit над нея. */
  FX.orderFor = function (dir, level, price, tolerance = 0) {
    if (!Number.isFinite(price) || !Number.isFinite(level) || Math.abs(level - price) <= tolerance) return dir === 1 ? "buy" : "sell";
    if (dir === 1) return level > price ? "buy_stop" : "buy_limit";
    return level < price ? "sell_stop" : "sell_limit";
  };

  /* ---------------------------------------------------------- измерване по историята */
  function firstAtOrAfter(times, value) {
    let lo = 0, hi = times.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] < value) lo = mid + 1; else hi = mid; }
    return lo;
  }

  /**
   * Пътят на една приключила сделка по по-малките свещи след свещта на входа.
   * Връща кога цената за първи път е била на k R в посоката на сделката (късен вход)
   * и на m R към стопа (по-добра цена), дали после се е върнала до входа и т.н.
   * Вътре в свещта редът е неизвестен, затова изборът е предпазлив:
   * свещта на входа не се брои, а вход след първата цел не получава нейния изход.
   */
  function tradePath(trade, bars) {
    const d = trade.dir, fill = trade.fill_price, risk = Math.abs(fill - trade.stop0), step = bars.sec;
    if (!(risk > 0) || !Number.isFinite(trade.r) || !Number.isFinite(trade.fill_time) || !Number.isFinite(trade.exit_time) || !step) return null;
    // Сделки извън по-подробната история (например стари дневни) не се броят.
    if (!bars.n || bars.t[0] > trade.fill_time || bars.t[bars.n - 1] < trade.fill_time) return null;
    const x = (price) => ((price - fill) * d) / risk;
    const tp1 = Number.isFinite(trade.tp1_time) ? trade.tp1_time : Infinity;
    const movedStop = trade.reason === "be" || trade.reason === "trail";
    const first = firstAtOrAfter(bars.t, trade.fill_time + step), last = firstAtOrAfter(bars.t, trade.exit_time);
    const late = {}, early = {};
    for (let i = first; i < last; i++) {
      const t = bars.t[i], open = x(bars.o[i]);
      const fav = x(d === 1 ? bars.h[i] : bars.l[i]), adv = x(d === 1 ? bars.l[i] : bars.h[i]);
      const exitBar = i === last - 1 && t + step >= trade.exit_time;
      for (const k of LATE_STEPS) if (!(k in late) && fav >= k) late[k] = t <= tp1 ? { e: Math.max(k, open), i } : null;
      for (const m of EARLY_STEPS) if (!(m in early) && adv <= -m) {
        const e = Math.max(m, -open);
        early[m] = t < tp1 && e < 0.95 && !(exitBar && movedStop) ? { e, i } : null;
      }
    }
    const back = {};
    for (const k of BACK_STEPS) {
      if (!late[k]) continue;
      const res = {};
      for (let i = late[k].i + 1; i < last && bars.t[i] <= tp1; i++) {
        const adv = x(d === 1 ? bars.l[i] : bars.h[i]);
        for (const level of BACK_LEVELS) if (!res[level] && adv <= level) res[level] = true;
      }
      back[k] = res;
    }
    let recovered = false;
    if (early[RECOVER_STEP]) {
      for (let i = early[RECOVER_STEP].i + 1; i < last && !recovered; i++) if (x(d === 1 ? bars.h[i] : bars.l[i]) >= 0) recovered = true;
    }
    return { late, early, back, recovered };
  }

  const bucket = () => ({ n: 0, sum: 0, hits: 0, hitSum: 0, flag: 0 });
  const avg = (sum, n) => (n ? FX.round(sum / n, 3) : null);

  /**
   * Статистика по двойки. Ако влезеш на k R по-късно със същия стоп и същите изходи,
   * резултатът е (r − k) / (1 + k); ако влезеш на m R по-близо до стопа — (r + m) / (1 − m).
   * Разходите в r се пренасят пропорционално на новия риск.
   */
  FX.entryTiming = function (trades, barsFor) {
    const byPair = {};
    for (const trade of trades || []) {
      if (trade.status !== "closed") continue;
      const bars = barsFor(trade.pair);
      if (!bars || !bars.n) continue;
      const path = tradePath(trade, bars);
      if (!path) continue;
      const acc = byPair[trade.pair] || (byPair[trade.pair] = { res: bars.tf, n: 0, sum: 0, late: {}, early: {}, back: {}, recover: bucket() });
      acc.n++; acc.sum += trade.r;
      for (const k of LATE_STEPS) if (path.late[k]) {
        const b = acc.late[k] || (acc.late[k] = bucket()), e = path.late[k].e;
        b.n++; b.sum += (trade.r - e) / (1 + e);
      }
      for (const m of EARLY_STEPS) if (path.early[m]) {
        const b = acc.early[m] || (acc.early[m] = bucket()), e = path.early[m].e;
        b.n++; b.sum += (trade.r + e) / (1 - e); if (trade.r <= -0.9) b.flag++;
      }
      for (const k of BACK_STEPS) if (path.late[k]) for (const level of BACK_LEVELS) {
        const b = acc.back[k + "|" + level] || (acc.back[k + "|" + level] = bucket());
        b.n++;
        if (path.back[k]?.[level]) { b.hits++; b.hitSum += (trade.r - level) / (1 + level); }
      }
      if (path.early[RECOVER_STEP]) {
        acc.recover.n++;
        if (path.recovered) { acc.recover.hits++; acc.recover.hitSum += trade.r; }
      }
    }
    const out = {};
    for (const [pair, acc] of Object.entries(byPair)) {
      const share = (b) => (b.n ? FX.round(b.hits / b.n, 3) : null);
      out[pair] = {
        res: acc.res, n: acc.n, base: avg(acc.sum, acc.n),
        late: LATE_STEPS.map((k) => { const b = acc.late[k] || bucket(); return { k, n: b.n, r: avg(b.sum, b.n) }; }),
        early: EARLY_STEPS.map((m) => { const b = acc.early[m] || bucket(); return { m, n: b.n, r: avg(b.sum, b.n), sl: b.n ? FX.round(b.flag / b.n, 3) : null }; }),
        back: BACK_STEPS.flatMap((k) => BACK_LEVELS.map((j) => { const b = acc.back[k + "|" + j] || bucket(); return { k, j, n: b.n, p: share(b), r: avg(b.hitSum, b.hits) }; })),
        recover: [{ m: RECOVER_STEP, n: acc.recover.n, p: share(acc.recover), r: avg(acc.recover.hitSum, acc.recover.hits) }],
      };
    }
    return out;
  };
  /** Добавя измерването към всеки ред по двойки. Пуска се в Лабораторията върху цялата история. */
  FX.addEntryTiming = function (entry, trades, barsFor) {
    const timing = FX.entryTiming(trades, barsFor);
    for (const row of entry.per_pair || []) row.timing = timing[row.pair] || null;
    return entry;
  };

  /**
   * Праговете за конкретната двойка. „Може“ е най-голямото закъснение, при което
   * средният резултат остава положителен и поне половината от входа на модела;
   * „късно“ е първото закъснение със среден резултат нула или по-лош.
   */
  FX.entryLevels = function (timing) {
    const T = FX.ENTRY, out = { ok: T.ok, late: T.late, measured: false };
    if (!timing || !(timing.n >= T.minTrades)) return out;
    const rows = (timing.late || []).filter((row) => row.n >= T.minTrades && row.r !== null).sort((a, b) => a.k - b.k);
    if (!rows.length) return out;
    const base = timing.base;
    let ok = 0;
    for (const row of rows) { if (row.r > 0 && (!(base > 0) || row.r >= base / 2)) ok = row.k; else break; }
    const bad = rows.find((row) => !(row.r > 0));
    out.measured = true;
    out.ok = ok > 0 ? Math.min(ok, 0.5) : 0.05;
    out.late = Math.max(bad ? bad.k : 0.75, out.ok + 0.1);
    return out;
  };

  /* ---------------------------------------------------------- съвет за вход сега */
  function nearestTarget(dir, entry, targets) {
    const ahead = (targets || []).filter((v) => Number.isFinite(v) && (v - entry) * dir > 0);
    return ahead.length ? ahead.sort((a, b) => (a - b) * dir)[0] : null;
  }

  /**
   * Вход сега при цена price (за покупка — Ask, за продажба — Bid) за отворен модел.
   * model: { dir, entry (вход на модела), stop (текущ стоп), stop0 (първоначален), half, targets }.
   * advice: enter, wait, late, against, too_close, stopped.
   */
  FX.entryAdvice = function (model, price, levels = FX.entryLevels(null), opts = {}) {
    const T = FX.ENTRY, d = model.dir, fill = model.entry, stop0 = model.stop0 ?? model.stop, stopNow = model.stop ?? stop0;
    const risk = Math.abs(fill - stop0);
    if (![1, -1].includes(d) || !(risk > 0) || !Number.isFinite(price) || !Number.isFinite(fill)) return null;
    const e = ((price - fill) * d) / risk, at = (k) => fill + d * k * risk;
    const base = { e, risk, okLevel: at(levels.ok), lateLevel: at(levels.late), measured: !!levels.measured, levels };
    if ((price - stopNow) * d <= 0) return { ...base, advice: "stopped" };
    const target = nearestTarget(d, fill, model.targets);
    if (model.half) return { ...base, advice: "late", reason: "part", target };
    if (target !== null && (price - target) * d >= 0) return { ...base, advice: "late", reason: "target", target };
    if ((stopNow - fill) * d > 1e-12) return { ...base, advice: "late", reason: "stop_moved", target };
    if (opts.minutesLeft !== undefined && opts.minutesLeft !== null && opts.minutesLeft < T.minutes) return { ...base, advice: "late", reason: "time", target };
    if (e >= levels.late) return { ...base, advice: "late", reason: "distance", target };
    if (e > levels.ok) return { ...base, advice: "wait", target, level: at(levels.ok), kind: FX.orderFor(d, at(levels.ok), price) };
    if (e >= -T.against) return { ...base, advice: "enter", target, kind: d === 1 ? "buy" : "sell", level: price };
    if (-e >= T.tooClose) return { ...base, advice: "too_close", target, level: fill, kind: FX.orderFor(d, fill, price) };
    return { ...base, advice: "against", target, level: fill, kind: FX.orderFor(d, fill, price) };
  };

  /**
   * Чакащ модел. Ако цената още не е стигнала входа — постави поръчката на модела.
   * Ако при брокера входът вече е достигнат (данните на сайта закъсняват), съветът е като при отворен модел.
   */
  FX.pendingAdvice = function (order, price, levels = FX.entryLevels(null), opts = {}) {
    const d = order.dir, risk = Math.abs(order.entry - order.stop), type = order.type || "stop";
    if (![1, -1].includes(d) || !(risk > 0) || !Number.isFinite(price)) return null;
    const x = ((price - order.entry) * d) / risk;
    if ((price - order.stop) * d <= 0) return { advice: "void", e: x, risk };
    const reached = type === "market" || (type === "limit" ? x <= 0 : x >= 0);
    if (!reached) return { advice: "place", e: x, risk, kind: FX.orderKind(d, type), level: order.entry, near: Math.abs(x) <= 0.1 };
    const targets = (order.targets || []).map((t) => (Number.isFinite(t?.level) ? t.level : Number.isFinite(t) ? t : null));
    const advice = FX.entryAdvice({ dir: d, entry: order.entry, stop: order.stop, stop0: order.stop, half: false, targets: targets.length ? targets : [order.tp1, order.tp2] }, price, levels, opts);
    return advice && { ...advice, reachedHere: type !== "market" };
  };
})(self.FX = self.FX || {});
