/* Правилата на версия 1 са описани в docs/new-candidates.md преди първия тест. */
(function (FX) {
  "use strict";
  const finite = Number.isFinite;
  const twoR = { parts: [[1, 2]] }, byRule = { parts: [[1, null]] };
  const ready = (s, i) => i >= 60 && finite(s.atr[i]) && s.atr[i] > 0;
  const inDay = (s, i) => { const h = FX.local(s.t[i] + s.sec).hour; return h >= 8 && h < 18 && s.weekday[i] < 5; };
  function order(s, i, dir, entry, stop, type = "stop", target = null) {
    const risk = (entry - stop) * dir;
    if (!finite(risk) || risk < Math.max(.5 * s.atr[i], 5 * s.info.spread * s.pip) || risk > 3 * s.atr[i]) return null;
    if (target !== null && (!finite(target) || (target - entry) * dir + 1e-10 < risk)) return null;
    return { dir, entry, stop, type, anchor_stop: true,
      min_risk: Math.max(.5 * s.atr[i], 5 * s.info.spread * s.pip), max_risk: 3 * s.atr[i],
      ...(target !== null ? { tp_level: target, fixed_target: true } : {}) };
  }
  const found = (od, text) => od ? [[od], text] : null;
  function previousDay(s, i) {
    const daily = s.peer("D1");
    if (!daily) return null;
    const k = s.align("D1")[i];
    return k >= 0 ? { daily, k, high: daily.h[k], low: daily.l[k], close: daily.c[k] } : null;
  }
  function yesterday(s, i) {
    const p = previousDay(s, i);
    if (!p) return null;
    const a = s.atr[i], up = s.h[i] > p.high, down = s.l[i] < p.low;
    if (up === down) return null;
    if (down && p.low - s.l[i] <= .5 * a && s.c[i] > p.low && s.c[i] > s.o[i])
      return found(order(s, i, 1, s.h[i] + s.buf, s.l[i] - .1 * a), "Свещта проби предишното дневно дъно и затвори обратно над него.");
    if (up && s.h[i] - p.high <= .5 * a && s.c[i] < p.high && s.c[i] < s.o[i])
      return found(order(s, i, -1, s.l[i] - s.buf, s.h[i] + .1 * a), "Свещта проби предишния дневен връх и затвори обратно под него.");
    return null;
  }
  function londonRanges(s) {
    if (s._cache.new_london) return s._cache.new_london;
    const days = new Map();
    for (let i = 0; i < s.n; i++) if (s.hour[i] === 10) {
      const day = days.get(s.date[i]) || { high: -Infinity, low: Infinity, times: new Set(), end: FX.localAt(s.t[i], 11) };
      day.high = Math.max(day.high, s.h[i]); day.low = Math.min(day.low, s.l[i]); day.times.add(s.minute[i]);
      days.set(s.date[i], day);
    }
    s._cache.new_london = days;
    return days;
  }
  function london(s, i) {
    const range = londonRanges(s).get(s.date[i]), a = s.atr[i];
    if (!range || range.times.size !== 4 || s.t[i] < range.end || s.hour[i] >= 16 || range.high - range.low < a || range.high - range.low > 4 * a) return null;
    let setup = s.memo.london_retest;
    if (setup && (setup.date !== s.date[i] || i - setup.bar > 8)) setup = s.memo.london_retest = null;
    if (setup && !setup.used && i > setup.bar) {
      const d = setup.dir, level = d === 1 ? range.high : range.low;
      const touched = d === 1 ? s.l[i] <= level + .25 * a && s.l[i] >= level - .5 * a : s.h[i] >= level - .25 * a && s.h[i] <= level + .5 * a;
      if (touched && (s.c[i] - level) * d > 0 && (s.c[i] - s.o[i]) * d > 0) {
        setup.used = true;
        const entry = d === 1 ? s.h[i] + s.buf : s.l[i] - s.buf;
        const stop = d === 1 ? Math.min(s.l[i], level - .25 * a) - s.buf : Math.max(s.h[i], level + .25 * a) + s.buf;
        return found(order(s, i, d, entry, stop), "Пробивът на лондонския диапазон е последван от ретест и затваряне по посоката на пробива.");
      }
      if ((s.c[i] - level) * d < -.5 * a) setup.used = true;
    }
    if (!setup) {
      const dir = s.c[i] > range.high && s.c[i - 1] <= range.high ? 1 : s.c[i] < range.low && s.c[i - 1] >= range.low ? -1 : 0;
      if (dir) s.memo.london_retest = { date: s.date[i], bar: i, dir, used: false };
    }
    return null;
  }
  function rangeFade(s, i) {
    const a = s.atr[i], ema = s.get("ema", 50);
    if (!(s.adx[i] < 20) || !finite(ema[i - 5]) || Math.abs(ema[i] - ema[i - 5]) > .25 * a) return null;
    const high = Math.max(...s.h.slice(i - 24, i)), low = Math.min(...s.l.slice(i - 24, i)), mid = (high + low) / 2;
    if (high - low < 2 * a || high - low > 5 * a) return null;
    if (s.l[i] <= low + .2 * a && s.c[i] > low + .2 * a && s.c[i] < mid && s.c[i] > s.o[i])
      return found(order(s, i, 1, s.c[i], Math.min(low, s.l[i]) - .25 * a, "market", mid), "Страничен пазар: цената се връща от долната граница към средата на диапазона.");
    if (s.h[i] >= high - .2 * a && s.c[i] < high - .2 * a && s.c[i] > mid && s.c[i] < s.o[i])
      return found(order(s, i, -1, s.c[i], Math.max(high, s.h[i]) + .25 * a, "market", mid), "Страничен пазар: цената се връща от горната граница към средата на диапазона.");
    return null;
  }
  function dualThrust(s, i) {
    if (s.hour[i] !== 10 || s.minute[i] !== 0) return null;
    const p = previousDay(s, i);
    if (!p || p.k < 4) return null;
    const { daily: d, k } = p, high = Math.max(...d.h.slice(k - 4, k + 1)), low = Math.min(...d.l.slice(k - 4, k + 1));
    const distance = .5 * Math.max(high - Math.min(...d.c.slice(k - 4, k + 1)), Math.max(...d.c.slice(k - 4, k + 1)) - low);
    const upper = s.o[i] + distance, lower = s.o[i] - distance, a = s.atr[i];
    if (!(distance > 0) || s.h[i] >= upper || s.l[i] <= lower) return null;
    const buy = order(s, i, 1, upper, upper - 1.5 * a), sell = order(s, i, -1, lower, lower + 1.5 * a);
    if (!buy || !sell) return null;
    for (const od of [buy, sell]) od.activate_after = s.t[i] + s.sec + FX.PUBLISH_DELAY;
    return [[buy, sell], "Границите са от началната цена и пет приключили дневни свещи. Изчакваме поне 25 минути след сигнала; ранно докосване го отменя."];
  }
  function camarillaModel(s, i, limit) {
    const p = previousDay(s, i);
    if (!p || !(s.adx[i] < 20)) return null;
    const range = 1.1 * (p.high - p.low), lower = p.close - range / 4, upper = p.close + range / 4;
    if (s.l[i] < lower && s.c[i] > lower && s.c[i] < p.close && s.c[i] > s.o[i])
      return found(order(s, i, 1, limit ? lower : s.c[i], p.close - range / 2, limit ? "limit" : "market", p.close), "Цената се върна над Camarilla S3 при слаб тренд. Чакаме повторно достигане на S3; целта е предишното дневно затваряне.");
    if (s.h[i] > upper && s.c[i] < upper && s.c[i] > p.close && s.c[i] < s.o[i])
      return found(order(s, i, -1, limit ? upper : s.c[i], p.close + range / 2, limit ? "limit" : "market", p.close), "Цената се върна под Camarilla R3 при слаб тренд. Чакаме повторно достигане на R3; целта е предишното дневно затваряне.");
    return null;
  }
  const camarilla = (s, i) => camarillaModel(s, i, true);
  function nr4(s, i) {
    const width = s.h[i] - s.l[i];
    if (!(width > 0) || [1, 2, 3].some((k) => width >= s.h[i - k] - s.l[i - k])) return null;
    const buy = order(s, i, 1, s.h[i] + s.buf, s.l[i] - s.buf), sell = order(s, i, -1, s.l[i] - s.buf, s.h[i] + s.buf);
    return buy && sell ? [[buy, sell], "Това е най-тясната от последните четири дневни свещи. Чакаме пробив; активирането на едната поръчка отменя другата."] : null;
  }
  function pivots(s) {
    if (s._cache.new_pivots) return s._cache.new_pivots;
    const high = [], low = [];
    for (let k = 2; k < s.n - 2; k++) {
      if ([k - 2, k - 1, k + 1, k + 2].every((j) => s.h[k] > s.h[j])) high.push({ bar: k, confirmed: k + 2, price: s.h[k] });
      if ([k - 2, k - 1, k + 1, k + 2].every((j) => s.l[k] < s.l[j])) low.push({ bar: k, confirmed: k + 2, price: s.l[k] });
    }
    return s._cache.new_pivots = { high, low };
  }
  function latest(list, i) {
    let lo = 0, hi = list.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (list[mid].confirmed <= i) lo = mid + 1; else hi = mid; }
    return lo ? [list[lo - 2], list[lo - 1]] : [];
  }
  function alligatorLines(s) {
    if (!s._cache.new_alligator) {
      const median = s.h.map((h, i) => (h + s.l[i]) / 2);
      s._cache.new_alligator = [FX.ind.wilder(median, 13), FX.ind.wilder(median, 8), FX.ind.wilder(median, 5)];
    }
    return s._cache.new_alligator;
  }
  function fractal(s, i) {
    const [jaw, teeth, lips] = alligatorLines(s), j = jaw[i - 8], t = teeth[i - 5], l = lips[i - 3];
    if (![j, t, l].every(finite)) return null;
    const p = pivots(s);
    for (const dir of [1, -1]) {
      if (!((l - t) * dir > 0 && (t - j) * dir > 0 && (s.c[i] - l) * dir > 0)) continue;
      const point = latest(dir === 1 ? p.high : p.low, i)[1];
      if (!point || i - point.bar > 30 || (s.c[i] - point.price) * dir <= 0 || (s.c[i - 1] - point.price) * dir > 0) continue;
      return found(order(s, i, dir, s.c[i], s.c[i] - dir * 2 * s.atr[i], "market"), "Цената затвори отвъд потвърден фрактал, а трите линии на Alligator са подредени по посоката на входа.");
    }
    return null;
  }
  function alligatorExit(st, s, i) {
    const teeth = alligatorLines(s)[1][i - 5];
    return finite(teeth) && (s.c[i] - teeth) * st.dir < 0 ? ["close", "Затваряне отвъд средната линия на Alligator"] : null;
  }
  function reversal(s, i, mode) {
    const p = pivots(s), rsi = mode === "rsi" ? s.get("rsi", 14) : null, bands = mode === "bb" ? s.get("bb", 20, 2) : null;
    for (const dir of [1, -1]) {
      const [first, second] = latest(dir === 1 ? p.low : p.high, i);
      if (!first || !second || second.bar - first.bar < 5 || second.bar - first.bar > 40 || i - second.confirmed > 12) continue;
      if (mode === "rsi") {
        if (!finite(rsi[first.bar]) || !finite(rsi[second.bar]) || !((second.price - first.price) * dir < 0 && (rsi[second.bar] - rsi[first.bar]) * dir >= 3)) continue;
      } else {
        const band = dir === 1 ? bands[2] : bands[1];
        if (!finite(band[first.bar]) || !finite(band[second.bar]) || (first.price - band[first.bar]) * dir >= 0 || (second.price - band[second.bar]) * dir <= 0
          || (second.price - first.price) * dir > .25 * s.atr[second.bar]) continue;
      }
      const between = dir === 1 ? s.h.slice(first.bar + 1, second.bar) : s.l.slice(first.bar + 1, second.bar);
      const neck = dir === 1 ? Math.max(...between) : Math.min(...between);
      if ((s.c[i] - neck) * dir <= 0 || (s.c[i - 1] - neck) * dir > 0) continue;
      const edge = mode === "rsi" ? second.price : dir === 1 ? Math.min(first.price, second.price) : Math.max(first.price, second.price);
      return found(order(s, i, dir, s.c[i], edge - dir * .25 * s.atr[i], "market"), mode === "rsi"
        ? "Дивергенцията между цената и RSI е потвърдена с пробив на междинното ниво."
        : "Двата екстремума образуват W/M спрямо Bollinger. Цената потвърди модела с пробив на междинното ниво.");
    }
    return null;
  }
  function turtle(s, i) {
    const high = Math.max(...s.h.slice(i - 20, i)), low = Math.min(...s.l.slice(i - 20, i));
    const brokeHigh = s.h[i] > high, brokeLow = s.l[i] < low;
    if (brokeHigh === brokeLow) return null;
    if (brokeLow && s.c[i] > low && i - (i - 20 + s.l.slice(i - 20, i).lastIndexOf(low)) >= 4)
      return found(order(s, i, 1, s.c[i], s.l[i] - .25 * s.atr[i], "market"), "Новото 20-дневно дъно не се задържа. Дневната свещ затвори обратно над старото ниво.");
    if (brokeHigh && s.c[i] < high && i - (i - 20 + s.h.slice(i - 20, i).lastIndexOf(high)) >= 4)
      return found(order(s, i, -1, s.c[i], s.h[i] + .25 * s.atr[i], "market"), "Новият 20-дневен връх не се задържа. Дневната свещ затвори обратно под старото ниво.");
    return null;
  }
  const definitions = [
    { key: "test_previous_day", name: "Връщане след вчерашен пробив", tf: "M15", fn: yesterday, family: "false-break", valid_bars: 2,
      short: "Потвърдено връщане след пробив на предишната дневна граница.", rules: ["Пробив само на едната дневна граница, до 0.5 ATR.", "Свещта затваря обратно в диапазона с тяло по посоката на връщането.", "Вход при пробив на сигнала, стоп на 0.1 ATR зад екстремума."], url: "https://github.com/Heavy91/TradingView_Indicators" },
    { key: "test_london_retest", name: "Лондонски диапазон · пробив и ретест", tf: "M15", fn: london, family: "session-break", valid_bars: 2,
      short: "Пробив на първия лондонски час, последван от потвърден ретест.", rules: ["Пълен диапазон 10:00–11:00 Europe/Sofia с ширина 1–4 ATR.", "Пробив до 16:00 и ретест до осем свещи в зона 0.25 ATR.", "Вход над/под потвърждението; стоп зад ретеста и границата."], url: "https://github.com/je-suis-tm/quant-trading#4-london-breakout" },
    { key: "test_range_fade", name: "Отскок в потвърден диапазон", tf: "H1", fn: rangeFade, family: "range", exit: byRule, fixed_target: true,
      short: "От границата към средата само при слаб тренд и равна средна.", rules: ["Диапазонът е от предишните 24 H1: ширина 2–5 ATR.", "ADX под 20, EMA(50) се променя до 0.25 ATR за пет свещи.", "Вход на следващото отваряне след отскока, стоп на 0.25 ATR отвън."], exit_rules: ["Фиксирана цел: средата на диапазона, ако е поне на 1R."] },
    { key: "test_dual_thrust", name: "Dual Thrust · дневен пробив", tf: "M15", fn: dualThrust, family: "session-break", valid_bars: 100, keep_pending: true, pending_close_hour_day: 18,
      short: "Две граници от пет приключили дни и началната цена в 10:00.", rules: ["R = max(HH−LC, HC−LL) за пет приключили D1.", "Входове: начална цена ±0.5R; първата M15 не трябва да ги е докосвала.", "Активиране поне 25 минути след сигнала; стоп 1.5 ATR; срок до 18:00."], url: "https://github.com/vnpy/vnpy_ctastrategy/blob/main/vnpy_ctastrategy/strategies/dual_thrust_strategy.py" },
    { key: "test_camarilla", name: "Camarilla · потвърден отскок", tf: "M15", fn: camarilla, family: "range", exit: byRule, fixed_target: true, valid_bars: 2, version: 2,
      parent_key: "test_camarilla_v1", changes: ["След потвърждението се чака лимитен вход на S3/R3 вместо пазарен вход."], hypothesis: "Пазарният вход вътре в зоната противоречи на изискването за цел поне 1R. Лимитният вход премахва това противоречие.",
      short: "Връщане от S3/R3 към предишното дневно затваряне.", rules: ["Нивата са от предишната приключила D1: C±1.1(H−L)/4 и /2.", "ADX под 20 и свещ, която се връща отвъд S3/R3 с тяло към C.", "След потвърждението: лимитен вход на S3/R3, валиден две свещи; стоп S4/R4."], exit_rules: ["Фиксирана цел: предишното D1 затваряне, ако е поне на 1R."], url: "https://github.com/ForexTradingTools/fxtt-mt5-pivot-points" },
    { key: "test_nr4", name: "NR4 · пробив на тесен ден", tf: "D1", fn: nr4, family: "compression", valid_bars: 1, keep_pending: true, max_bars: 5,
      short: "Пробив след най-тясната от четири дневни свещи.", rules: ["Размахът е строго по-малък от всеки от предишните три.", "Противоположни поръчки отвъд сигнала, стоп зад другата страна."], source: "По NR4 на Toby Crabel; Sadowski, стр. 36–38" },
    { key: "test_fractal_alligator", name: "Фрактален пробив с Alligator", tf: "H4", fn: fractal, family: "structure-trend", manage: alligatorExit, exit: byRule, max_bars: 30,
      short: "Потвърден фрактал и подредени линии на Alligator.", rules: ["Фракталът изисква две затворени свещи от всяка страна.", "SMMA(13,8,5) върху средната цена, изместени с 8/5/3 свещи.", "Затваряне през фрактал до 30 свещи назад по посоката на линиите; вход на следващото отваряне."], exit_rules: ["Стоп 2 ATR. Изход при затваряне отвъд средната линия или след 30 H4 свещи. Няма фиксиран TP."], url: "https://github.com/EA31337/Strategy-Alligator" },
    { key: "test_rsi_divergence", name: "RSI дивергенция · потвърден пробив", tf: "H4", fn: (s, i) => reversal(s, i, "rsi"), family: "divergence", max_bars: 20,
      short: "Два потвърдени екстремума и ценови пробив след дивергенцията.", rules: ["Пивоти с две потвърждаващи свещи, разделени от 5–40 свещи.", "Цената прави нов екстремум, RSI(14) се разминава с поне три пункта.", "До 12 свещи след потвърждението: затваряне през междинното ниво. Стоп на 0.25 ATR зад втория екстремум."], url: "https://github.com/EA31337/Strategy-Oscillator_Divergence" },
    { key: "test_turtle_soup", name: "Turtle Soup · дневно потвърждение", tf: "D1", fn: turtle, family: "false-break", max_bars: 5,
      short: "Неуспешен 20-дневен пробив, потвърден със затваряне.", rules: ["Нов 20-дневен екстремум; старият е поне четири свещи назад.", "Затваряне обратно отвъд старото ниво, без пробив на двата края.", "Вход на следващото отваряне, стоп на 0.25 ATR зад новия екстремум."], url: "https://github.com/nerdyckc/turtle_soup_bitmex" },
    { key: "test_bollinger_wm", name: "W/M с Bollinger", tf: "H4", fn: (s, i) => reversal(s, i, "bb"), family: "pattern-reversal", max_bars: 20,
      short: "Два екстремума спрямо Bollinger и пробив на междинното ниво.", rules: ["Два потвърдени пивота на 5–40 свещи; първият е извън лентата, вторият вътре.", "Вторият екстремум е до 0.25 ATR по-близо до средата спрямо първия.", "Пробив на междинното ниво до 12 свещи след потвърждението; стоп на 0.25 ATR зад по-далечния екстремум."], url: "https://github.com/je-suis-tm/quant-trading/blob/master/Bollinger%20Bands%20Pattern%20Recognition%20backtest.py" },
  ];
  FX.NEW_CANDIDATES = definitions.map((def) => {
    const day = FX.TIMEFRAMES[def.tf].style === "day";
    const strat = { ...def, tfs: [def.tf], version: def.version || 1, provisional: true, origin: "research", group: "За тест", approx: true,
      session: day ? "site" : "free", exit: def.exit || twoR, valid_bars: def.valid_bars ?? 1,
      max_bars: def.max_bars || 20, strict_expiry: true,
      ...(day ? { close_hour_day: 22, pending_close_hour_day: def.pending_close_hour_day || 21, max_per_day_day: 1, require_session_close: true, strict_daily_fills: true } : {}),
      source: def.source || "Собствена адаптация по публични правила", spec: null,
      note: `Версия ${def.version || 1}. Точните допускания са в docs/new-candidates.md. Историческите резултати са за проверка на идеята.`,
      exit_rules: [...(def.exit_rules || ["Стопът запазва първоначалното си място. Фиксиран TP 2R."]), day ? "Останалата позиция се затваря до 22:00 Europe/Sofia." : "Изход и при достигане на максималния брой свещи."],
    };
    strat.fn = (s, i) => ready(s, i) && (!day || inDay(s, i)) ? def.fn(s, i) : null;
    return strat;
  });
  const cam = FX.NEW_CANDIDATES.find((s) => s.key === "test_camarilla");
  const camOriginal = { ...cam, key: "test_camarilla_v1", name: "Camarilla · пазарен вход, версия 1", version: 1,
    retired: true, parent_key: null, changes: null, hypothesis: null, valid_bars: 1,
    fn: (s, i) => ready(s, i) && inDay(s, i) ? camarillaModel(s, i, false) : null,
    rules: ["Първоначален вариант с пазарен вход след връщане отвъд S3/R3, стоп S4/R4 и цел C.", "Цел поне 1R е математически недостижима при този вход. Запазен за сравнение."],
    note: "Архив на първоначалната формализация; нулевите сделки са запазени в сравнението." };
  FX.RESEARCH = (FX.RESEARCH || []).concat([camOriginal], FX.NEW_CANDIDATES);
})(self.FX = self.FX || {});
