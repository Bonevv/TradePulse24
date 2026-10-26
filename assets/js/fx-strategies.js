/* Стратегиите, написани като код: 10 от книгите (Минев) и 8 от сайтове.
   Всяка функция fn(s, i) гледа затворената свещ i и връща [поръчки, обяснение] или null. */
(function (FX) {
  "use strict";
  const ok = (x) => x !== null && x !== undefined;
  const buy = (entry, stop) => ({ dir: 1, entry, stop });
  const sell = (entry, stop) => ({ dir: -1, entry, stop });
  const market = (d, ref, dist, extra = {}) => Object.assign({ dir: d, type: "market", entry: ref, stop: ref - d * dist, stop_dist: dist }, extra);
  const limit = (d, entry, stop, extra = {}) => Object.assign({ dir: d, type: "limit", entry, stop }, extra);
  const word = (d) => (d === 1 ? "купуваме" : "продаваме");
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  const f0 = (x) => x.toFixed(0);
  FX.ord = { buy, sell, market, limit };

  function ready(s, i, ...series) {
    return i >= 60 && series.every((x) => ok(x[i]) && ok(x[i - 5]));
  }

  function trend(s, i) {
    if (!ready(s, i, s.sma20, s.sma50)) return 0;
    const s20 = s.sma20[i], s50 = s.sma50[i];
    if (s20 > s50 && s20 > s.sma20[i - 5] && s.c[i] > s50) return 1;
    if (s20 < s50 && s20 < s.sma20[i - 5] && s.c[i] < s50) return -1;
    return 0;
  }

  /* ---------------------------------------------------------- от книгите */

  function korekcia3(s, i) {
    const d = trend(s, i), h = s.h, l = s.l;
    if (d === 1 && [i - 2, i - 1, i].every((k) => h[k] < h[k - 1] && l[k] < l[k - 1])) {
      return [[buy(h[i] + s.buf, l[i] - s.buf)],
        "Тренд нагоре: 20-периодната средна е над 50-периодната. Последните 3 свещи правят " +
        `по-ниски върхове и дъна, тоест има корекция. Купуваме, ако цената пробие върха на последната свещ (${s.fmt(h[i])}).`];
    }
    if (d === -1 && [i - 2, i - 1, i].every((k) => h[k] > h[k - 1] && l[k] > l[k - 1])) {
      return [[sell(l[i] - s.buf, h[i] + s.buf)],
        "Тренд надолу: 20-периодната средна е под 50-периодната. Последните 3 свещи правят " +
        `по-високи върхове и дъна, тоест има корекция. Продаваме, ако цената пробие дъното на последната свещ (${s.fmt(l[i])}).`];
    }
    return null;
  }

  function obrashtane(s, i) {
    const d = trend(s, i);
    if (!d) return null;
    const h = s.h, l = s.l, c = s.c;
    const r1 = h[i - 1] - l[i - 1], r0 = h[i] - l[i];
    if (r1 <= 0 || r0 <= 0) return null;
    if (d === 1 && l[i - 1] <= Math.min(l[i - 4], l[i - 3], l[i - 2]) && (c[i - 1] - l[i - 1]) / r1 <= 0.25 && (c[i] - l[i]) / r0 >= 0.75) {
      return [[buy(h[i] + s.buf, Math.min(l[i - 1], l[i]) - s.buf)],
        "Тренд нагоре с корекция. Предпоследната свещ затвори близо до дъното си, а последната " +
        "затвори близо до върха си. Купувачите се връщат. Купуваме при пробив на върха."];
    }
    if (d === -1 && h[i - 1] >= Math.max(h[i - 4], h[i - 3], h[i - 2]) && (h[i - 1] - c[i - 1]) / r1 <= 0.25 && (h[i] - c[i]) / r0 >= 0.75) {
      return [[sell(l[i] - s.buf, Math.max(h[i - 1], h[i]) + s.buf)],
        "Тренд надолу с корекция. Предпоследната свещ затвори близо до върха си, а последната " +
        "затвори близо до дъното си. Продавачите се връщат. Продаваме при пробив на дъното."];
    }
    return null;
  }

  function otskokMa(s, i) {
    if (!ready(s, i, s.sma20, s.sma50)) return null;
    const m = s.sma20, h = s.h, l = s.l, c = s.c;
    if (m[i] > s.sma50[i] && m[i] > m[i - 3] && l[i] < m[i] && c[i - 3] > m[i - 3]) {
      return [[buy(h[i] + s.buf, l[i] - s.buf)],
        `20-периодната средна сочи нагоре. Цената се върна до нея (${s.fmt(m[i])}) и слезе под нея. ` +
        "Купуваме, ако цената пробие върха на тази свещ, тоест отскочи от средната."];
    }
    if (m[i] < s.sma50[i] && m[i] < m[i - 3] && h[i] > m[i] && c[i - 3] < m[i - 3]) {
      return [[sell(l[i] - s.buf, h[i] + s.buf)],
        `20-периодната средна сочи надолу. Цената се върна до нея (${s.fmt(m[i])}) и се качи над нея. ` +
        "Продаваме, ако цената пробие дъното на тази свещ, тоест отскочи надолу от средната."];
    }
    return null;
  }

  function graal(s, i) {
    if (!ready(s, i, s.adx, s.ema20) || s.adx[i] < 30) return null;
    const e = s.ema20, h = s.h, l = s.l;
    if (s.pdi[i] > s.mdi[i] && l[i] <= e[i] && l[i - 1] > e[i - 1]) {
      return [[buy(h[i] + s.buf, l[i] - s.buf)],
        `Силен тренд нагоре (ADX = ${f0(s.adx[i])}, над 30). Цената се върна за първи път до 20 EMA ` +
        `(${s.fmt(e[i])}). Купуваме, ако пробие върха на тази свещ и трендът продължи.`];
    }
    if (s.mdi[i] > s.pdi[i] && h[i] >= e[i] && h[i - 1] < e[i - 1]) {
      return [[sell(l[i] - s.buf, h[i] + s.buf)],
        `Силен тренд надолу (ADX = ${f0(s.adx[i])}, над 30). Цената се върна за първи път до 20 EMA ` +
        `(${s.fmt(e[i])}). Продаваме, ако пробие дъното на тази свещ и трендът продължи.`];
    }
    return null;
  }

  function nr7(s, i) {
    if (i < 60) return null;
    const h = s.h, l = s.l, rng = h[i] - l[i];
    let minPrev = Infinity;
    for (let k = i - 6; k < i; k++) minPrev = Math.min(minPrev, h[k] - l[k]);
    if (rng <= 0 || rng >= minPrev) return null;
    return [[buy(h[i] + s.buf, l[i] - s.buf), sell(l[i] - s.buf, h[i] + s.buf)],
      `Последната свещ е най-тясната от 7 свещи (${f0(rng / s.pip)} пипа). След затишие обикновено идва ` +
      "силно движение. Слагаме две поръчки: купи над върха и продай под дъното. Която се задейства първа, " +
      "тя е сделката. Другата се изтрива."];
  }

  function fake2b(s, i) {
    if (!ready(s, i, s.atr)) return null;
    const h = s.h, l = s.l, n = 20;
    const lows = l.slice(i - n, i), highs = h.slice(i - n, i);
    const lowPrev = Math.min(...lows), highPrev = Math.max(...highs);
    const jLow = i - n + lows.lastIndexOf(lowPrev), jHigh = i - n + highs.lastIndexOf(highPrev);
    const newLow = l[i] < lowPrev, newHigh = h[i] > highPrev;
    if (newLow && !newHigh && i - jLow >= 5 && lowPrev - l[i] <= 0.5 * s.atr[i]) {
      return [[buy(lowPrev + s.buf, l[i] - s.buf)],
        `Цената пробива дъното от последните 20 свещи (${s.fmt(lowPrev)}), но само с ` +
        `${f0((lowPrev - l[i]) / s.pip)} пипа. Ако се върне над старото дъно, пробивът е фалшив ` +
        "и купуваме. Там се задействат стоповете на продавачите."];
    }
    if (newHigh && !newLow && i - jHigh >= 5 && h[i] - highPrev <= 0.5 * s.atr[i]) {
      return [[sell(highPrev - s.buf, h[i] + s.buf)],
        `Цената пробива върха от последните 20 свещи (${s.fmt(highPrev)}), но само с ` +
        `${f0((h[i] - highPrev) / s.pip)} пипа. Ако се върне под стария връх, пробивът е фалшив ` +
        "и продаваме. Там се задействат стоповете на купувачите."];
    }
    return null;
  }

  function cross520(s, i) {
    if (!ready(s, i, s.sma5, s.sma20)) return null;
    const f = s.sma5, m = s.sma20, h = s.h, l = s.l;
    if (f[i - 1] <= m[i - 1] && f[i] > m[i] && f[i] > f[i - 1] && m[i] > m[i - 1]) {
      return [[buy(h[i] + s.buf, l[i] - s.buf)], "5-периодната средна пресече 20-периодната нагоре и двете сочат нагоре. Купуваме при пробив на върха на свещта с пресичането."];
    }
    if (f[i - 1] >= m[i - 1] && f[i] < m[i] && f[i] < f[i - 1] && m[i] < m[i - 1]) {
      return [[sell(l[i] - s.buf, h[i] + s.buf)], "5-периодната средна пресече 20-периодната надолу и двете сочат надолу. Продаваме при пробив на дъното на свещта с пресичането."];
    }
    return null;
  }

  function psar(s, i) {
    if (!ready(s, i, s.pdi)) return null;
    const p = s.psar, h = s.h, l = s.l;
    if (p[i] === 1 && p[i - 1] === -1 && s.pdi[i] > s.mdi[i]) {
      return [[buy(h[i] + s.buf, l[i] - s.buf)], "Параболата премина под цената, а +DI е над −DI, значи купувачите са по-силни. Купуваме при пробив на върха на тази свещ."];
    }
    if (p[i] === -1 && p[i - 1] === 1 && s.mdi[i] > s.pdi[i]) {
      return [[sell(l[i] - s.buf, h[i] + s.buf)], "Параболата премина над цената, а −DI е над +DI, значи продавачите са по-силни. Продаваме при пробив на дъното на тази свещ."];
    }
    return null;
  }

  function dmiCross(s, i) {
    if (!ready(s, i, s.adx) || s.adx[i] <= 25 || s.adx[i] <= s.adx[i - 1]) return null;
    const pd = s.pdi, md = s.mdi, h = s.h, l = s.l;
    if (pd[i - 1] <= md[i - 1] && pd[i] > md[i]) {
      return [[buy(h[i] + s.buf, l[i] - s.buf)], `ADX е ${f0(s.adx[i])} и расте, тоест има тренд. +DI пресече −DI нагоре. Купуваме при пробив на върха на свещта.`];
    }
    if (md[i - 1] <= pd[i - 1] && md[i] > pd[i]) {
      return [[sell(l[i] - s.buf, h[i] + s.buf)], `ADX е ${f0(s.adx[i])} и расте, тоест има тренд. −DI пресече +DI нагоре. Продаваме при пробив на дъното на свещта.`];
    }
    return null;
  }

  function asia(s, i) {
    if (s.hour[i] !== 8 || s.weekday[i] > 4 || !ready(s, i, s.atr)) return null;
    let k = i;
    while (k > 0 && s.date[k - 1] === s.date[i]) k--;
    if (i - k + 1 < 6) return null;
    let hi = -Infinity, lo = Infinity;
    for (let x = k; x <= i; x++) { hi = Math.max(hi, s.h[x]); lo = Math.min(lo, s.l[x]); }
    const width = hi - lo;
    if (width < 2 * s.atr[i] || width > 6 * s.atr[i]) return null;
    const mid = (hi + lo) / 2;
    return [[buy(hi + s.buf, mid), sell(lo - s.buf, mid)],
      `Азиатската сесия (00:00–09:00) е между ${s.fmt(lo)} и ${s.fmt(hi)} (${f0(width / s.pip)} пипа). ` +
      "Европа отваря и чакаме пробив: купи над върха или продай под дъното. Стопът е в средата на диапазона. " +
      "Поръчките важат до 12:00."];
  }

  /* ---------------------------------------------------------- от сайтове */

  function goldScalper(s, i) {
    const hr = s.hour[i];
    if (hr < 8 || hr >= 18 || s.weekday[i] > 4) return null;
    const day = s.get("session_range", 0, 8).get(s.date[i]);
    if (!day || day[2] < 16) return null;
    const hi = day[0], lo = day[1], c = s.c;
    let d;
    if (c[i] > hi && c[i - 1] <= hi) d = 1;
    else if (c[i] < lo && c[i - 1] >= lo) d = -1;
    else return null;
    const d1 = s.peer("D1"), h1 = s.peer("H1");
    if (!d1 || !h1) return null;
    const j = s.align("D1")[i], k = s.align("H1")[i];
    if (j < 60 || k < 210 || !ok(s.atr[i])) return null;
    if ((d1.atr[j] / d1.c[j]) * 100 < 1.6) return null;
    let score = 0;
    const e50 = d1.get("ema", 50)[j];
    if (ok(e50) && (c[i] - e50) * d > 0) score++;
    const e200 = h1.get("ema", 200)[k];
    if (ok(e200) && (c[i] - e200) * d > 0) score++;
    if (ok(h1.adx[k]) && h1.adx[k] >= 20 && h1.adx[k] < 30) score++;
    const r = s.get("rsi", 14)[i];
    if (ok(r) && ((d === 1 && r >= 70) || (d === -1 && r <= 30))) score++;
    if (score < 1) return null;
    return [[market(d, c[i], 4 * s.atr[i])],
      `Азиатският диапазон (00:00–08:00) е ${s.fmt(lo)} – ${s.fmt(hi)}. 15-минутна свещ затвори ` +
      `${d === 1 ? "над върха" : "под дъното"} му, затова ${word(d)} на пазарна цена. ` +
      `Потвърждения: ${score} от 4. Стоп 4 × ATR, без цел, затваряне в 20:00.`];
  }

  function fvgGold(s, i) {
    const u = FX.utc(s.t[i] + s.sec);
    if (!((u.hour >= 7 && u.hour < 10) || (u.hour >= 12 && u.hour < 21)) || u.weekday > 4) return null;
    const h1 = s.peer("H1");
    if (!h1) return null;
    const k = s.align("H1")[i];
    if (k < 210 || !ok(s.atr[i])) return null;
    const e50 = h1.get("ema", 50)[k], e200 = h1.get("ema", 200)[k];
    if (!ok(e50) || !ok(e200) || e50 === e200) return null;
    const bias = e50 > e200 ? 1 : -1;
    const used = s.memo.fvg_used || (s.memo.fvg_used = new Set());
    const price = s.c[i], a = s.atr[i], o = s.o, h = s.h, l = s.l, c = s.c;
    for (let age = 2; age <= 20; age++) {
      const m = i - age, a_ = m - 1, b_ = m + 1;
      if (a_ < 0 || used.has(s.t[m])) continue;
      let typ, top, bot;
      if (l[b_] > h[a_]) { typ = 1; top = l[b_]; bot = h[a_]; }
      else if (h[b_] < l[a_]) { typ = -1; top = l[a_]; bot = h[b_]; }
      else continue;
      const gap = top - bot;
      if (gap < 0.25) continue;
      const mid = (top + bot) / 2;
      let covered = false;
      for (let x = b_ + 1; x <= i; x++) if ((typ === 1 && l[x] < mid) || (typ === -1 && h[x] > mid)) { covered = true; break; }
      if (covered) continue;
      const body = h[m] > l[m] ? Math.abs(c[m] - o[m]) / (h[m] - l[m]) : 0;
      let score = Math.min(gap / a, 1) * 30 + body * 30 + (typ === bias ? 20 : 0) + (1 - age / 20) * 10;
      score += (typ === 1 && price < e50) || (typ === -1 && price > e50) ? 10 : 0;
      if (score < 50) continue;
      const entry = typ === 1 ? bot + 1.5 : top - 1.5, stop = typ === 1 ? bot - 3.0 : top + 3.0;
      if ((typ === 1 && entry >= price) || (typ === -1 && entry <= price)) continue;
      used.add(s.t[m]);
      return [[limit(typ, entry, stop)],
        `Непокрита ценова празнина (FVG) ${s.fmt(bot)} – ${s.fmt(top)}, оценка ${f0(score)} от 100. ` +
        `Чакаме цената да се върне в нея и ${word(typ)} с лимитна поръчка. Цел 1.5 × риска.`];
    }
    return null;
  }

  function bbRsi(s, i) {
    const [mid, up, lo] = s.get("bb", 20, 2);
    const r = s.get("rsi", 14)[i];
    if (!ok(up[i]) || !ok(r)) return null;
    const o = s.o[i], c = s.c[i], h = s.h[i], l = s.l[i], body = Math.abs(c - o), pip = s.pip;
    if (body <= 0) return null;
    if (c > up[i] && r >= 60) {
      const beyond = Math.max(o, c) - Math.max(up[i], Math.min(o, c));
      if (beyond / body >= 0.5) {
        const entry = c - pip;
        return [[{ dir: -1, type: "stop", entry, stop: h + 5 * pip, cancel: entry + 2 * pip, mid: mid[i], tp_level: lo[i] }],
          `Свещта затвори над горната лента на Bollinger, с поне половината тяло извън нея, а RSI е ${f0(r)}. ` +
          "Очакваме връщане към средата. Продаваме 1 пипс под затварянето."];
      }
    }
    if (c < lo[i] && r <= 40) {
      const beyond = Math.min(lo[i], Math.max(o, c)) - Math.min(o, c);
      if (beyond / body >= 0.5) {
        const entry = c + pip;
        return [[{ dir: 1, type: "stop", entry, stop: l - 5 * pip, cancel: entry - 2 * pip, mid: mid[i], tp_level: up[i] }],
          `Свещта затвори под долната лента на Bollinger, с поне половината тяло извън нея, а RSI е ${f0(r)}. ` +
          "Очакваме връщане към средата. Купуваме 1 пипс над затварянето."];
      }
    }
    return null;
  }

  function bbRsiManage(st, s, i) {
    const [mid, up, lo] = s.get("bb", 20, 2);
    const d = st.dir;
    if (!ok(up[i])) return null;
    const band = d === 1 ? up[i] : lo[i];
    for (const p of st.parts) if (p.px === null) p.tp = band;
    const first = st.parts[0];
    if (first.px === null && ((d === 1 && s.c[i] >= mid[i]) || (d === -1 && s.c[i] <= mid[i]))) return ["part", 0, "Свещта затвори при средната лента"];
    return null;
  }

  function adxPullback(s, i) {
    const adx = s.adx, e = s.ema20, a = s.atr, c = s.c;
    if (!ok(adx[i]) || !ok(adx[i - 1]) || !ok(e[i - 1]) || !a[i] || !a[i - 1]) return null;
    if (!(adx[i] > 25 && adx[i] > adx[i - 1])) return null;
    if (!(Math.abs(c[i - 1] - e[i - 1]) / a[i - 1] >= 0.5 && Math.abs(c[i] - e[i]) / a[i] < 0.5)) return null;
    const d = s.pdi[i] > s.mdi[i] ? 1 : s.mdi[i] > s.pdi[i] ? -1 : 0;
    if (!d) return null;
    return [[market(d, c[i], 1.5 * a[i])],
      `Силен тренд (ADX = ${f0(adx[i])} и расте). Цената се върна близо до 20 EMA (по-малко от половин ATR). ` +
      `${cap(word(d))} на пазарна цена. Стоп 1.5 × ATR, цел 2 × риска.`];
  }

  function goldSentinel(s, i) {
    const ut = s.get("ut", 1.5, 10), sdir = s.get("st", 10, 3)[1], c = s.c;
    if (!ok(ut[i]) || !ok(ut[i - 1]) || !ok(s.atr[i])) return null;
    const up = c[i] > ut[i] && c[i - 1] <= ut[i - 1], dn = c[i] < ut[i] && c[i - 1] >= ut[i - 1];
    if (!up && !dn) return null;
    const d1 = s.peer("D1");
    if (!d1) return null;
    const j = s.align("D1")[i];
    const e200 = j >= 0 ? d1.get("ema", 200)[j] : null;
    if (!ok(e200)) return null;
    const dd = d1.c[j] > e200 ? 1 : d1.c[j] < e200 ? -1 : 0;
    let d;
    if (up && sdir[i] > 0 && dd > 0) d = 1;
    else if (dn && sdir[i] < 0 && dd < 0) d = -1;
    else return null;
    return [[market(d, c[i], 3 * s.atr[i])],
      `UT Bot даде сигнал ${d === 1 ? "нагоре" : "надолу"}, Supertrend е в същата посока, ` +
      `а дневното затваряне е ${d === 1 ? "над" : "под"} 200 EMA. ${cap(word(d))} на пазарна цена. ` +
      "Плаващ стоп 3 × ATR, без цел."];
  }

  function goldSentinelManage(st, s, i) {
    const found = goldSentinel(s, i);
    if (found && found[0][0].dir !== st.dir) return ["reverse", found];
    return null;
  }

  function stKumo(s, i) {
    const [line, sdir] = s.get("st", 10, 3);
    const [a, b] = s.get("ichi");
    if (!ok(line[i]) || !ok(a[i]) || !ok(b[i]) || sdir[i - 1] === sdir[i]) return null;
    const d = sdir[i], top = Math.max(a[i], b[i]), bot = Math.min(a[i], b[i]), c = s.c[i];
    if ((d === 1 && c <= top) || (d === -1 && c >= bot)) return null;
    const dist = Math.abs(c - line[i]);
    if (dist <= 0) return null;
    return [[market(d, c, dist)],
      `Supertrend обърна ${d === 1 ? "нагоре" : "надолу"}, а цената е ${d === 1 ? "над" : "под"} облака на Ишимоку. ` +
      `${cap(word(d))}. Стопът следва линията на Supertrend.`];
  }

  function stKumoManage(st, s, i) {
    const [line, sdir] = s.get("st", 10, 3);
    const d = st.dir;
    if (sdir[i] !== d) return ["close", "Supertrend обърна посоката"];
    if (ok(line[i]) && (line[i] - st.stop) * d > 0) st.stop = line[i];
    return null;
  }

  function squeezeMom(s, i) {
    const [on, val] = s.get("sqz");
    const sma200 = s.get("sma", 200)[i];
    if (!ok(sma200) || !ok(val[i]) || !ok(val[i - 1]) || !ok(s.atr[i])) return null;
    if (on[i]) return null;
    for (let k = 1; k <= 6; k++) if (!on[i - k]) return null;
    const c = s.c[i];
    let d;
    if (val[i] > 0 && val[i] > val[i - 1] && c > sma200) d = 1;
    else if (val[i] < 0 && val[i] < val[i - 1] && c < sma200) d = -1;
    else return null;
    return [[market(d, c, 2 * s.atr[i])],
      `Дълго затишие (свиване на Bollinger в Keltner) току-що свърши с импулс ${d === 1 ? "нагоре" : "надолу"}, ` +
      `а цената е ${d === 1 ? "над" : "под"} 200 SMA. ${cap(word(d))}. Изход, когато импулсът отслабне.`];
  }

  function squeezeManage(st, s, i) {
    const val = s.get("sqz")[1], d = st.dir;
    if (ok(val[i]) && ok(val[i - 1]) && (val[i] - val[i - 1]) * d < 0) return ["close", "Импулсът отслабна"];
    return null;
  }

  function emaPullback(s, i) {
    const f = s.get("ema", 20), m = s.get("ema", 50);
    if (!ok(f[i]) || i < 60 || !ok(m[i - 60])) return null;
    const d = f[i] > m[i] ? 1 : -1;
    let k = null;
    for (let x = i; x > i - 60; x--) {
      if ((f[x] - m[x]) * (f[x - 1] - m[x - 1]) <= 0) { k = x; break; }
    }
    if (k === null || k === i) return null;
    const touch = d === 1 ? (x) => s.l[x] <= f[x] : (x) => s.h[x] >= f[x];
    if (!touch(i)) return null;
    for (let x = k + 1; x < i; x++) if (touch(x)) return null;
    if (d === 1) return [[buy(s.h[i] + s.buf, s.l[i] - s.buf)], "20 EMA пресече 50 EMA нагоре и това е първото връщане до 20 EMA. Купуваме при пробив на върха на свещта."];
    return [[sell(s.l[i] - s.buf, s.h[i] + s.buf)], "20 EMA пресече 50 EMA надолу и това е първото връщане до 20 EMA. Продаваме при пробив на дъното на свещта."];
  }

  /* ---------------------------------------------------------- каталог */

  FX.COMMON_RULES = [
    "Цел 1 = толкова пипа, колкото е рискът. Там се затваря половината сделка, а стопът на другата половина отива на входа (остава риск от спред, гап и приплъзване).",
    "Цел 2 = два пъти риска. Там се затваря втората половина.",
    "Ако цената не стигне входа до 3 свещи, поръчката се изтрива.",
  ];
  const SPLIT = (FX.SPLIT = { parts: [[0.5, 1.0], [0.5, 2.0]], after_first: "entry" });
  const GOLD = ["XAUUSD"];
  const MINEV = "Светлин Минев, „Стратегии за търгуване…“";

  const BOOK = [
    { key: "korekcia3", fn: korekcia3, tfs: ["H4", "D1"], name: "Корекция от 3 свещи",
      short: "Влиза в посоката на тренда, след като цената направи кратка корекция от 3 свещи.",
      rules: ["Има тренд: 20-периодната средна е над 50-периодната и сочи нагоре (за продажба е обратното).", "Последните 3 свещи правят все по-ниски върхове и дъна. Цената се връща назад.", "Вход: няколко пипа над върха на последната свещ. Ако цената стигне дотам, корекцията е свършила.", "Стоп: няколко пипа под дъното на последната свещ."],
      source: `${MINEV}, стр. 196–201` },
    { key: "obrashtane", fn: obrashtane, tfs: ["H4", "D1"], name: "Ключово обръщане",
      short: "Корекция в тренд, която завършва със силна свещ в посоката на тренда.",
      rules: ["Има тренд (20-периодната средна над 50-периодната, сочи нагоре).", "Предпоследната свещ е новото дъно на корекцията и затваря в долната четвърт от размаха си.", "Последната свещ затваря в горната четвърт от размаха си. Купувачите се връщат.", "Вход: над върха на последната свещ. Стоп: под по-ниското от двете дъна."],
      source: `${MINEV}, стр. 202–206` },
    { key: "otskok_ma", fn: otskokMa, tfs: ["H1", "H4"], name: "Отскок от 20 средна",
      short: "В тренд цената се връща до 20-периодната средна и отскача от нея.",
      rules: ["20-периодната средна сочи нагоре и е над 50-периодната.", "Цената е била над средната, после свещ слиза под нея. Това е сигналната свещ.", "Вход: над върха на сигналната свещ. Стоп: под дъното ѝ."],
      source: `${MINEV}, стр. 27–29` },
    { key: "graal", fn: graal, tfs: ["H1", "H4", "D1"], name: "Светия Граал",
      short: "Силен тренд (ADX над 30) и първо връщане до 20 EMA.",
      rules: ["ADX(14) е над 30, тоест трендът е силен. За покупка +DI е над −DI.", "Цената докосва 20-периодната експоненциална средна (EMA) за първи път.", "Вход: над върха на свещта, която докосна средната. Стоп: под дъното ѝ."],
      source: "Светлин Минев, стр. 30–31 (стратегия на Линда Рашке и Лари Конърс)" },
    { key: "nr7", fn: nr7, tfs: ["H4", "D1"], name: "Затишие преди буря (NR7)",
      short: "След най-тясната свещ от последните 7 чакаме силен пробив в едната посока.",
      rules: ["Последната свещ има най-малкия размах от последните 7 свещи.", "Слагат се две поръчки: купи над върха ѝ и продай под дъното ѝ.", "Когато едната се задейства, другата се изтрива.", "Стоп: другата страна на свещта."],
      source: "Светлин Минев, стр. 168–177 (идея на Тоби Крабел)" },
    { key: "fake2b", fn: fake2b, tfs: ["H1", "H4", "D1"], name: "Фалшив пробив (2Б)",
      short: "Цената пробива старо дъно или връх, пробивът се проваля и влизаме обратно.",
      rules: ["Цената прави ново дъно за последните 20 свещи, но само малко под старото (до половин среден размах на свещ).", "Старото дъно е поне 5 свещи по-рано.", "Вход: когато цената се върне над старото дъно.", "Стоп: под новото дъно."],
      source: "Светлин Минев, стр. 178–188 („Супа от костенурки“ на Линда Рашке)" },
    { key: "cross520", fn: cross520, tfs: ["H1"], name: "Пресичане на 5 и 20 средна",
      short: "Бързата средна пресича бавната и двете сочат в една посока.",
      rules: ["5-периодната средна пресича 20-периодната нагоре и двете сочат нагоре.", "Вход: над върха на свещта с пресичането. Стоп: под дъното ѝ."],
      source: "Светлин Минев, стр. 31–34" },
    { key: "psar", fn: psar, tfs: ["H1"], name: "Парабола с DMI",
      short: "Параболата сменя страната, а DMI потвърждава посоката.",
      rules: ["Параболата (Parabolic SAR) минава под цената.", "+DI е над −DI, тоест купувачите са по-силни.", "Вход: над върха на сигналната свещ. Стоп: под дъното ѝ."],
      source: "Светлин Минев, стр. 58–67. Авторът сам я е тествал и 4 от 8 варианта губят." },
    { key: "dmi", fn: dmiCross, tfs: ["H4", "D1"], name: "DMI пресичане",
      short: "ADX показва тренд, а +DI и −DI се пресичат.",
      rules: ["ADX(14) е над 25 и расте.", "+DI пресича −DI нагоре (за продажба −DI пресича +DI).", "Вход: над върха на свещта. Стоп: под дъното ѝ."],
      source: "Светлин Минев, стр. 54–57" },
    { key: "asia", fn: asia, tfs: ["H1"], name: "Пробив на азиатската сесия", own_hours: true,
      short: "Цената е в тесен диапазон през нощта и пробива при отварянето на Европа.",
      rules: ["Отбелязваме най-високата и най-ниската цена от 00:00 до 09:00 българско време.", "В 9:00 слагаме две поръчки: купи над върха и продай под дъното на диапазона.", "Поръчките важат до 12:00. Когато едната се задейства, другата се изтрива.", "Стоп: средата на диапазона."],
      source: "Светлин Минев, стр. 165–167" },
  ].map((x) => Object.assign({ origin: "book", session: "site", exit: SPLIT, approx: false, group: "Книги" }, x));

  const WEB = [
    { key: "gold_scalper", fn: goldScalper, tfs: ["M15"], pairs: GOLD, name: "Gold Scalper M15", session: "own",
      short: "Пробив на азиатския диапазон при златото, само в дни с голямо движение.",
      rules: ["Диапазон: най-високата и най-ниската цена от 00:00 до 08:00 (време на брокера ≈ българско).", "Само в дни, когато дневният ATR(14) е поне 1.6% от цената.", "Вход: първата 15-минутна свещ между 08:00 и 18:00, която затвори над върха (покупка) или под дъното (продажба). Пазарна поръчка.", "Нужно е поне 1 от 4 потвърждения: дневна 50 EMA, часова 200 EMA, часов ADX между 20 и 30, RSI над 70 в посоката.", "Най-много една сделка на ден."],
      exit: { parts: [[1.0, null]] }, close_hour: 20, max_per_day: 1,
      exit_rules: ["Стоп: 4 × ATR(14) на 15-минутната графика.", "Няма цел. Сделката се затваря в 20:00."],
      source: "github.com/Kla1524/GoldScalperM15", url: "https://github.com/Kla1524/GoldScalperM15",
      note: "Филтърът за новини (±15 мин около силни новини за USD) не е включен в теста, защото няма история на новините." },
    { key: "fvg_gold", fn: fvgGold, tfs: ["M15"], pairs: GOLD, name: "FVG Gold", session: "own", keep_pending: true, valid_bars: 96,
      short: "Лимитна поръчка в непокрита ценова празнина (fair value gap) по посока на часовия тренд.",
      rules: ["Празнина (FVG): между свещ 1 и свещ 3 има място, което свещ 2 е прескочила (поне 0.25$).", "Оценка от 0 до 100: размер спрямо ATR, сила на свещ 2, посока на часовите 50/200 EMA, колко е прясна, отстъпка спрямо 50 EMA. Нужни са поне 50.", "Вход: лимитна поръчка 1.5$ навътре от края на празнината. Само в часовете 07–10 и 12–21 по Гринуич.", "Една поръчка наведнъж. Всяка празнина дава най-много една поръчка."],
      exit: { parts: [[1.0, 1.5]], be: { atr: 0.5, offset: 0.02 } },
      exit_rules: ["Стоп: 3$ зад празнината.", "Цел: 1.5 × риска.", "Когато печалбата стигне 0.5 × ATR, стопът отива на входа."],
      source: "github.com/foeed/FvgGold-EA", url: "https://github.com/foeed/FvgGold-EA",
      note: "Бонусът за „order block“ не е включен. Отложените поръчки се изтриват след 1 ден (в оригинала висят безкрайно)." },
    { key: "bb_rsi", fn: bbRsi, manage: bbRsiManage, tfs: ["M15", "H1"], name: "Bollinger + RSI обръщане", session: "free", valid_bars: 20,
      short: "Свещ затваря извън Bollinger, RSI е преминал 60/40 и влизаме обратно към средата.",
      rules: ["Bollinger(20, 2) и RSI(14).", "Продажба: свещта затваря над горната лента, поне половината от тялото ѝ е над лентата, RSI е поне 60. Покупката е огледална (под долната лента, RSI до 40).", "Вход: 1 пипс под затварянето (при покупка над него). Ако цената мине 1 пипс над затварянето преди входа, сигналът отпада."],
      exit: { parts: [[0.5, null], [0.5, null]], after_first: "entry", be: { frac_mid: 0.3 } },
      exit_rules: ["Стоп: 5 пипса над върха на сигналната свещ (при покупка под дъното ѝ).", "Цел 1: половината се затваря, когато свещ затвори на средната лента. Стопът отива на входа.", "Цел 2: останалото се затваря, когато цената стигне противоположната лента.", "Когато цената измине 30% от пътя до средната лента, стопът отива на входа."],
      source: "github.com/denytat/BB-and-RSI-trading-bot-MT5", url: "https://github.com/denytat/BB-and-RSI-trading-bot-MT5",
      note: "Тестваме правилата от описанието (RSI 60/40). В кода филтърът с RSI е обърнат, вероятно по грешка." },
    { key: "adx_pullback", fn: adxPullback, tfs: ["H1"], name: "ADX Trend Pullback", session: "free", valid_bars: 1,
      short: "Силен тренд по ADX и връщане близо до 20 EMA. Влиза в посоката на тренда.",
      rules: ["ADX(14) е над 25 и расте.", "Цената е била на поне половин ATR от 20 EMA и сега е по-близо от половин ATR (връщане).", "Посока: +DI над −DI = покупка, обратното = продажба. Пазарна поръчка."],
      exit: { parts: [[1.0, 2.0]] }, exit_rules: ["Стоп: 1.5 × ATR(14).", "Цел: 2 × риска."],
      source: "MQL5 CodeBase, код 73958", url: "https://www.mql5.com/en/code/73958" },
    { key: "gold_sentinel", fn: goldSentinel, manage: goldSentinelManage, tfs: ["H4"], pairs: GOLD, name: "Gold Trend Sentinel", session: "free", valid_bars: 1, max_bars: 10000,
      short: "UT Bot + Supertrend + дневна 200 EMA при златото. Държи с плаващ стоп, без цел.",
      rules: ["Сигнал: 4-часовата свещ затваря от другата страна на линията на UT Bot (1.5, ATR 10).", "Филтри: Supertrend(10, 3) е в същата посока и последното дневно затваряне е от същата страна на 200 EMA.", "Вход: пазарна поръчка при отварянето на следващата свещ."],
      exit: { parts: [[1.0, null]], trail: true },
      exit_rules: ["Стоп: 3 × ATR(14). Става плаващ: следва най-добрата цена на същото разстояние и само се затяга.", "Обратен сигнал: сделката се затваря и се отваря обратната."],
      source: "github.com/allanninal/gold-trend-sentinel", url: "https://github.com/allanninal/gold-trend-sentinel",
      note: "Авторът е избрал настройките от около 105 000 опита. Това крие голям риск резултатът да е случаен." },
    { key: "st_kumo", fn: stKumo, manage: stKumoManage, tfs: ["H1"], name: "Supertrend + облак", session: "free", valid_bars: 1, max_bars: 500, approx: true,
      short: "Supertrend обръща посоката и цената е от правилната страна на облака на Ишимоку.",
      rules: ["Supertrend(10, 3) сменя посоката си.", "Покупка само над облака на Ишимоку, продажба само под него.", "Вход: пазарна поръчка."],
      exit: { parts: [[1.0, null]] }, exit_rules: ["Стоп: линията на Supertrend, която следва цената.", "Изход, когато Supertrend обърне посоката."],
      source: "kestutisbalciunas.com (видео 7)", url: "https://kestutisbalciunas.com/trading-strategies/",
      note: "Точните правила са във видеото. Тук са по описанието, с типичните настройки на индикаторите." },
    { key: "squeeze", fn: squeezeMom, manage: squeezeManage, tfs: ["H1"], name: "Squeeze Momentum + 200 SMA", session: "free", valid_bars: 1, max_bars: 200, approx: true,
      short: "След дълго затишие пазарът тръгва и влизаме в посоката на импулса, по тренда на 200 SMA.",
      rules: ["Свиване: лентите на Bollinger са вътре в канала на Keltner поне 6 свещи.", "Свиването свършва, импулсът (LazyBear) расте в една посока.", "Покупка само над 200 SMA, продажба само под нея. Пазарна поръчка."],
      exit: { parts: [[1.0, null]] }, exit_rules: ["Стоп: 2 × ATR(14).", "Изход, когато импулсът започне да отслабва."],
      source: "kestutisbalciunas.com (видео 10, правило C)", url: "https://kestutisbalciunas.com/trading-strategies/",
      note: "Точните правила са във видеото. Тук са по описанието. „Дълго свиване“ = поне 6 свещи е наше предположение." },
    { key: "ema_pullback", fn: emaPullback, tfs: ["H1"], name: "20/50 EMA първо връщане", session: "free", approx: true,
      short: "След пресичане на 20 и 50 EMA влиза при първото връщане до 20 EMA.",
      rules: ["20 EMA пресича 50 EMA (нагоре за покупка).", "Първата свещ след пресичането, която докосне 20 EMA, е сигналната.", "Вход: над върха на сигналната свещ. Стоп: под дъното ѝ."],
      exit: SPLIT, exit_rules: ["Целите не са дадени на сайта. Ползваме общите: Цел 1 = риска (половината), Цел 2 = 2 × риска."],
      source: "kestutisbalciunas.com (видео 3)", url: "https://kestutisbalciunas.com/trading-strategies/",
      note: "Точните правила са във видеото. Тук са по описанието." },
  ].map((x) => Object.assign({ origin: "web", approx: false, group: "Сайтове" }, x));

  FX.CODED = BOOK.concat(WEB);
})(self.FX = self.FX || {});
