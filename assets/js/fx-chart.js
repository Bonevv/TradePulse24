/* Данни за графиката с модела: кои индикатори ползва стратегията, линиите им, нивата и маркерите на сигнала.
   Само изчисления, без DOM. Ползва същите свещи и индикатори (Series.get), по които се смятат сигналите. */
(function (FX) {
  "use strict";
  const finite = (v) => typeof v === "number" && Number.isFinite(v);
  const pad = (h) => String(h).padStart(2, "0");

  /* Как се показва всеки индикатор. pane: "price" — върху свещите, "osc" — в отделен панел под тях.
     lines: имената на линиите, когато индикаторът връща няколко масива. levels: ориентировъчни нива в панела.
     precision: знаци след запетаята; без него се ползват знаците на инструмента (стойности в цена). */
  const PLOT = {
    ema: { pane: "price", label: (p) => `EMA ${p[0]}` },
    sma: { pane: "price", label: (p) => `SMA ${p[0]}` },
    kama: { pane: "price", label: (p) => `KAMA ${p.join("/")}` },
    ut: { pane: "price", label: (p) => `UT Bot ${p.join(", ")}` },
    bb: { pane: "price", label: (p) => `Bollinger ${p.join(", ")}`, lines: ["средна", "горна", "долна"] },
    keltner: { pane: "price", label: (p) => `Keltner ${p.join(", ")}`, lines: ["средна", "горна", "долна"] },
    donchian: { pane: "price", label: (p) => `Donchian ${p[0]}`, lines: ["горна", "долна"] },
    st: { pane: "price", label: (p) => `Supertrend ${p.join(", ")}`, lines: ["линия"], toneFrom: 1 },
    ichi: { pane: "price", label: () => "Ишимоку", lines: ["Span A", "Span B", "Tenkan", "Kijun"] },
    chandelier: { pane: "price", label: (p) => `Chandelier ${p.join(", ")}`, lines: ["за покупки", "за продажби"] },
    ssl: { pane: "price", label: (p) => `SSL ${p[0]}`, lines: ["върхове", "дъна"] },
    heikin: { pane: "price", label: () => "Хейкин Аши", lines: ["откриване", "затваряне"] },
    session_range: { pane: "price", label: (p) => `Диапазон ${pad(p[0])}:00–${pad(p[1])}:00`, lines: ["връх", "дъно"] },
    rsi: { pane: "osc", label: (p) => `RSI ${p[0]}`, levels: [30, 50, 70], precision: 1 },
    stoch: { pane: "osc", label: (p) => `Stochastic ${p.join(", ")}`, lines: ["%K", "%D"], levels: [20, 80], precision: 1 },
    cci: { pane: "osc", label: (p) => `CCI ${p[0]}`, levels: [-100, 0, 100], precision: 0 },
    wpr: { pane: "osc", label: (p) => `Williams %R ${p[0]}`, levels: [-80, -20], precision: 1 },
    demarker: { pane: "osc", label: (p) => `DeMarker ${p[0]}`, levels: [0.3, 0.7], precision: 2 },
    rvi: { pane: "osc", label: (p) => `RVI ${p[0]}`, lines: ["RVI", "сигнална"], levels: [0], precision: 3 },
    adx: { pane: "osc", label: (p) => `ADX ${p[0]}`, lines: ["ADX", "+DI", "−DI"], levels: [20, 25], precision: 1 },
    macd: { pane: "osc", label: (p) => `MACD ${p.join(", ")}`, lines: ["MACD", "сигнална", "хистограма"], hist: [2], levels: [0] },
    mom: { pane: "osc", label: (p) => `Momentum ${p[0]}`, levels: [0] },
    ao: { pane: "osc", label: () => "Awesome Oscillator", hist: [0], levels: [0] },
    atr: { pane: "osc", label: (p) => `ATR ${p[0]}`, hidden: true },
    psar: { pane: "osc", label: () => "Посока на Параболата (SAR)", hist: [0], toneFrom: 0, precision: 0 },
    sqz: { pane: "osc", label: () => "Squeeze импулс", lines: ["свиване", "импулс"], hist: [1], skip: [0], levels: [0] },
  };
  FX.CHART_PLOT = PLOT;

  // Готовите масиви в Series.base() са същите като Series.get(...) с подразбиращите се настройки.
  const BASE = { sma5: ["sma", [5]], sma20: ["sma", [20]], sma50: ["sma", [50]], ema20: ["ema", [20]], atr: ["atr", [14]],
    adx: ["adx", [14]], pdi: ["adx", [14]], mdi: ["adx", [14]], psar: ["psar", [0.02, 0.2]] };

  function note(used, tf, name, args) {
    if (!PLOT[name]) return;
    const key = `${tf}|${name}|${args.join(",")}`;
    if (!used.has(key)) used.set(key, { key, tf, name, args: args.slice() });
  }

  /** Обвивка на серията, която записва кои индикатори чете стратегията. Не променя серията. */
  function recorder(s, used) {
    const memo = {};
    return new Proxy(s, {
      get(target, prop) {
        if (prop === "memo") return memo;
        if (Object.prototype.hasOwnProperty.call(BASE, prop)) { note(used, target.tf, ...BASE[prop]); return target[prop]; }
        if (prop === "get") return (name, ...args) => { note(used, target.tf, name, args); return target.get(name, ...args); };
        if (prop === "peer") return (tf) => { const peer = target.peer(tf); return peer ? recorder(peer, used) : peer; };
        const value = target[prop];
        return typeof value === "function" ? value.bind(target) : value;
      },
      set() { return true; },
    });
  }

  /** Индикаторите, които стратегията действително чете в тази серия (при вход и при управление на сделката).
      Стратегията се пуска върху последните свещи само за да се види какво чете; резултатът ѝ не се ползва. */
  FX.chartIndicators = function (strat, s, bars = 1500) {
    const used = new Map();
    if (!strat || !s || typeof strat.fn !== "function") return [];
    const proxy = recorder(s, used);
    for (let i = Math.max(2, s.n - bars); i < s.n; i++) {
      try { strat.fn(proxy, i); } catch (_e) { /* непълни данни в началото: пропускаме свещта */ }
    }
    if (typeof strat.manage === "function") {
      for (let i = Math.max(6, s.n - 300); i < s.n; i++) {
        for (const dir of [1, -1]) {
          const risk = finite(s.atr[i]) && s.atr[i] > 0 ? s.atr[i] : Math.abs(s.h[i] - s.l[i]) || s.pip * 10;
          const state = { dir, status: "open", fill_price: s.c[i - 3], entry: s.c[i - 3], stop0: s.c[i - 3] - dir * risk, stop: s.c[i - 3] - dir * risk,
            fill_bar: i - 3, fill_time: s.t[i - 3], signal_time: s.t[i - 4] + s.sec, best: s.c[i], parts: [], half: false };
          try { strat.manage(state, proxy, i); } catch (_e) { /* както горе */ }
        }
      }
    }
    // tf: null — собствената графика; иначе индикаторът е от по-старша графика на същия инструмент.
    const list = [...used.values()].map((d) => { const tf = d.tf === s.tf ? null : d.tf; return { ...d, tf, key: `${tf || ""}|${d.name}|${d.args.join(",")}` }; });
    const order = (d) => (PLOT[d.name].pane === "price" ? 0 : 1);
    return list.sort((a, b) => order(a) - order(b) || (a.tf ? 1 : 0) - (b.tf ? 1 : 0));
  };

  /** Дневният диапазон като две стъпаловидни линии: показват се след края на прозореца до края на деня. */
  function sessionLines(src, days, args) {
    const top = new Array(src.n).fill(null), bottom = new Array(src.n).fill(null);
    for (let i = 0; i < src.n; i++) {
      const day = days.get(src.date[i]);
      if (day && src.hour[i] >= args[1]) { top[i] = day[0]; bottom[i] = day[1]; }
    }
    return [top, bottom];
  }

  /** Линиите на един индикатор, подравнени по свещите на графиката s.
      Индикатор от по-старша графика взима стойността на последната ЗАВЪРШЕНА нейна свещ (както в стратегиите). */
  FX.indicatorPlot = function (s, desc) {
    const def = PLOT[desc?.name];
    if (!def || !s) return null;
    const src = desc.tf ? s.peer(desc.tf) : s;
    if (!src) return null;
    let raw;
    try { raw = src.get(desc.name, ...desc.args); } catch (_e) { return null; }
    const arrays = desc.name === "session_range" ? sessionLines(src, raw, desc.args) : Array.isArray(raw[0]) ? raw : [raw];
    const align = src === s ? null : s.align(src.tf);
    const pick = (arr) => {
      const out = new Array(s.n);
      for (let i = 0; i < s.n; i++) {
        const k = align ? align[i] : i, v = k >= 0 ? arr[k] : null;
        out[i] = v === true ? 1 : v === false ? 0 : finite(v) ? v : null;
      }
      return out;
    };
    const names = def.lines || [def.label(desc.args)];
    // tone: посоката на всяка точка (1, −1 или 0) — за цвета на хистограма или на линия като Supertrend.
    const sign = (arr) => arr.map((v) => (v === null ? 0 : v > 0 ? 1 : v < 0 ? -1 : 0));
    const tone = def.toneFrom !== undefined ? pick(arrays[def.toneFrom]) : null;
    const lines = [];
    arrays.forEach((arr, k) => {
      if (k >= names.length || (def.skip || []).includes(k)) return;
      const values = pick(arr), hist = (def.hist || []).includes(k);
      lines.push({ name: names[k], values, hist, tone: hist ? sign(tone || values) : tone ? sign(tone) : null });
    });
    const tfName = desc.tf && FX.TIMEFRAMES[desc.tf] ? ` · ${FX.TIMEFRAMES[desc.tf].label}` : "";
    return { key: desc.key, name: desc.name, label: def.label(desc.args) + tfName, pane: def.pane, hidden: !!def.hidden,
      levels: def.levels || [], precision: def.precision, lines };
  };

  /** Индексът на свещта, в която попада моментът t (последната свещ с начало ≤ t).
      after: моментът е след края на последната завършена свещ (в текущата, още незатворена свещ). */
  FX.chartBarAt = function (s, t) {
    if (!s || !s.n || !finite(t) || t < s.t[0]) return null;
    let lo = 0, hi = s.n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s.t[mid] <= t) lo = mid; else hi = mid - 1; }
    return { index: lo, time: s.t[lo], after: t >= s.t[s.n - 1] + s.sec };
  };

  /** Маркерите на сигнала по свещите на графиката: сигнал, достигнат вход, Цел 1 и изход. */
  FX.chartMarkers = function (sig, s) {
    if (!sig || !s || !s.n) return [];
    const out = [], dirs = sig.status === "pending" || sig.status === "cancelled" ? [...new Set((sig.orders || []).map((o) => o.dir))] : [sig.dir];
    const dir = dirs.length === 1 ? dirs[0] : 0;
    const add = (kind, t, extra = {}) => {
      const at = FX.chartBarAt(s, t);
      if (at) out.push({ kind, time: at.time, index: at.index, after: at.after, dir, ...extra });
    };
    // Сигналът се появява при затварянето на свещта; самата свещ започва една графика по-рано.
    const modelSec = FX.TIMEFRAMES[sig.tf]?.seconds || s.sec;
    add("signal", sig.signal_time - Math.min(modelSec, s.sec));
    if (finite(sig.fill_time)) add("fill", sig.fill_time, { price: sig.fill_price });
    if (finite(sig.tp1_time)) add("tp1", sig.tp1_time);
    if (sig.status === "closed" && finite(sig.exit_time)) add("exit", sig.exit_time - 1, { r: sig.r, reason: sig.reason });
    if (sig.status === "cancelled" && finite(sig.exit_time)) add("cancel", sig.exit_time - 1, { reason: sig.reason });
    return out.sort((a, b) => a.time - b.time);
  };

  /** Хоризонталните нива на сигнала. orders: [{dir, type, entry, stop, targets: [[име, цена или null]]}],
      като targets са само действителните цели (null — изход по правило, не TP). 1R/2R са ориентири, не поръчки. */
  FX.chartLevels = function (sig, orders, digits = 5) {
    if (!sig || !Array.isArray(orders) || !orders.length) return [];
    const filled = sig.status !== "pending" && sig.status !== "cancelled", two = orders.length > 1;
    const tick = Math.pow(10, -digits), same = (a, b) => Math.abs(a - b) < tick / 2;
    const round = (v) => Number(Number(v).toFixed(digits));
    const lines = [];
    orders.forEach((o) => {
      const tag = two ? (o.dir === 1 ? " ▲" : " ▼") : "";
      const entry = filled && finite(sig.fill_price) ? sig.fill_price : o.entry;
      const stop0 = filled && finite(sig.stop0) ? sig.stop0 : o.stop;
      if (!finite(entry) || !finite(stop0)) return;
      const kind = FX.orderKind && FX.ORDER_KINDS ? FX.ORDER_KINDS[FX.orderKind(o.dir, o.type || "stop")]?.name : null;
      lines.push({ kind: "entry", price: entry, dir: o.dir, label: filled ? "Вход (модел)" : `Вход${tag}${kind ? ` · ${kind}` : ""}` });
      const moved = filled && finite(sig.stop) && !same(sig.stop, stop0);
      lines.push({ kind: "stop0", price: stop0, dir: o.dir, label: moved ? "Начален стоп" : `Стоп${tag}` });
      if (moved) lines.push({ kind: "stop", price: sig.stop, dir: o.dir, label: "Стоп сега" });
      const fixed = (o.targets || []).filter(([, v]) => finite(v));
      fixed.forEach(([name, v]) => lines.push({ kind: "target", price: v, dir: o.dir, label: `${name} (TP)${tag}${sig.half && name === "Цел 1" ? " ✓" : ""}` }));
      if ((entry - stop0) * o.dir > 0) {
        const risk = Math.abs(entry - stop0);
        for (const r of [1, 2]) {
          const price = round(entry + o.dir * r * risk);
          if (!fixed.some(([, v]) => same(v, price))) lines.push({ kind: "landmark", price, dir: o.dir, label: `+${r}R ориентир${tag}` });
        }
      }
    });
    // Две противоположни поръчки често споделят цени (входът на едната е стопът на другата): едно ниво, два надписа.
    const rank = { entry: 0, stop0: 1, stop: 2, target: 3, landmark: 4 }, merged = [];
    for (const line of lines.sort((a, b) => rank[a.kind] - rank[b.kind])) {
      const twin = merged.find((m) => same(m.price, line.price));
      if (twin) { if (!twin.label.split(" · ").includes(line.label)) twin.label += ` · ${line.label}`; }
      else merged.push({ ...line });
    }
    return merged.sort((a, b) => b.price - a.price);
  };

  /** Видимият участък по подразбиране: последните свещи, но така че сигналът и изходът му да се виждат. */
  FX.chartWindow = function (n, markers, span = 140) {
    if (!n) return null;
    const at = (kind) => markers.find((m) => m.kind === kind)?.index;
    const signal = at("signal"), end = at("exit") ?? at("cancel");
    if (!Number.isInteger(signal)) return { from: n - span, to: n + 4 };
    if (Number.isInteger(end)) {
      // Приключил сигнал: сигналът и изходът са в средата на прозореца.
      const mid = (signal + end) / 2, half = Math.max(span / 2, (end - signal) / 2 + 20);
      return { from: mid - half, to: Math.min(n + 4, mid + half) };
    }
    return { from: Math.min(n - span, signal - 20), to: n + 4 };
  };
})(self.FX = self.FX || {});
