/* Технически индикатори. Всяка функция връща масив с дължината на входа (null, докато няма данни). */
(function (FX) {
  "use strict";
  const I = (FX.ind = {});
  const nulls = (n) => new Array(n).fill(null);

  I.sma = function (v, n) {
    const out = nulls(v.length);
    let s = 0;
    for (let i = 0; i < v.length; i++) {
      s += v[i];
      if (i >= n) s -= v[i - n];
      if (i >= n - 1) out[i] = s / n;
    }
    return out;
  };

  I.ema = function (v, n) {
    const out = nulls(v.length);
    if (v.length < n) return out;
    const k = 2 / (n + 1);
    let e = 0;
    for (let i = 0; i < n; i++) e += v[i];
    e /= n;
    out[n - 1] = e;
    for (let i = n; i < v.length; i++) {
      e = v[i] * k + e * (1 - k);
      out[i] = e;
    }
    return out;
  };

  /** EMA върху масив с null в началото. */
  I.emaOf = function (v, n) {
    const first = v.findIndex((x) => x !== null && x !== undefined);
    const out = nulls(v.length);
    if (first < 0) return out;
    const part = I.ema(v.slice(first), n);
    for (let i = 0; i < part.length; i++) out[first + i] = part[i];
    return out;
  };

  I.smaOf = function (v, n) {
    const first = v.findIndex((x) => x !== null && x !== undefined);
    const out = nulls(v.length);
    if (first < 0) return out;
    const part = I.sma(v.slice(first), n);
    for (let i = 0; i < part.length; i++) out[first + i] = part[i];
    return out;
  };

  I.wilder = function (v, n, start = 0) {
    const out = nulls(v.length);
    if (v.length - start < n) return out;
    let a = 0;
    for (let i = start; i < start + n; i++) a += v[i];
    a /= n;
    out[start + n - 1] = a;
    for (let i = start + n; i < v.length; i++) {
      a = (a * (n - 1) + v[i]) / n;
      out[i] = a;
    }
    return out;
  };

  I.trueRange = function (h, l, c) {
    const tr = [h[0] - l[0]];
    for (let i = 1; i < h.length; i++) tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
    return tr;
  };

  I.atr = (h, l, c, n = 14) => I.wilder(I.trueRange(h, l, c), n);

  /** Връща [ADX, +DI, −DI]. */
  I.dmi = function (h, l, c, n = 14) {
    const size = h.length;
    const pdm = new Array(size).fill(0), mdm = new Array(size).fill(0);
    for (let i = 1; i < size; i++) {
      const up = h[i] - h[i - 1], down = l[i - 1] - l[i];
      pdm[i] = up > down && up > 0 ? up : 0;
      mdm[i] = down > up && down > 0 ? down : 0;
    }
    const tr = I.trueRange(h, l, c);
    const sp = I.wilder(pdm, n, 1), sm = I.wilder(mdm, n, 1), st = I.wilder(tr, n, 1);
    const pdi = nulls(size), mdi = nulls(size), dx = new Array(size).fill(0);
    let first = null;
    for (let i = 0; i < size; i++) {
      if (st[i]) {
        pdi[i] = (100 * sp[i]) / st[i];
        mdi[i] = (100 * sm[i]) / st[i];
        const s = pdi[i] + mdi[i];
        dx[i] = s ? (100 * Math.abs(pdi[i] - mdi[i])) / s : 0;
        if (first === null) first = i;
      }
    }
    const adx = first !== null ? I.wilder(dx, n, first) : nulls(size);
    return [adx, pdi, mdi];
  };

  I.psarTrend = function (h, l, step = 0.02, maxStep = 0.2) {
    const size = h.length;
    const trend = new Array(size).fill(0);
    if (size < 3) return trend;
    let up = true, sar = l[0], ep = h[0], af = step;
    for (let i = 1; i < size; i++) {
      sar = sar + af * (ep - sar);
      if (up) {
        sar = Math.min(sar, l[i - 1], i >= 2 ? l[i - 2] : l[i - 1]);
        if (l[i] < sar) { up = false; sar = ep; ep = l[i]; af = step; }
        else if (h[i] > ep) { ep = h[i]; af = Math.min(af + step, maxStep); }
      } else {
        sar = Math.max(sar, h[i - 1], i >= 2 ? h[i - 2] : h[i - 1]);
        if (h[i] > sar) { up = true; sar = ep; ep = h[i]; af = step; }
        else if (l[i] < ep) { ep = l[i]; af = Math.min(af + step, maxStep); }
      }
      trend[i] = up ? 1 : -1;
    }
    return trend;
  };

  I.stdev = function (v, n) {
    const out = nulls(v.length);
    if (!v.length) return out;
    const ref = v[0];
    let s = 0, s2 = 0;
    for (let i = 0; i < v.length; i++) {
      const x = v[i] - ref;
      s += x; s2 += x * x;
      if (i >= n) { const y = v[i - n] - ref; s -= y; s2 -= y * y; }
      if (i >= n - 1) { const m = s / n; out[i] = Math.sqrt(Math.max(0, s2 / n - m * m)); }
    }
    return out;
  };

  /** Връща [средна, горна, долна]. */
  I.bollinger = function (c, n = 20, k = 2) {
    const mid = I.sma(c, n), sd = I.stdev(c, n);
    const up = mid.map((m, i) => (m === null ? null : m + k * sd[i]));
    const lo = mid.map((m, i) => (m === null ? null : m - k * sd[i]));
    return [mid, up, lo];
  };

  I.rsi = function (c, n = 14) {
    const size = c.length;
    const g = new Array(size).fill(0), ls = new Array(size).fill(0);
    for (let i = 1; i < size; i++) {
      const d = c[i] - c[i - 1];
      g[i] = Math.max(d, 0); ls[i] = Math.max(-d, 0);
    }
    const ag = I.wilder(g, n, 1), al = I.wilder(ls, n, 1);
    return ag.map((a, i) => (a === null ? null : al[i] === 0 ? 100 : 100 - 100 / (1 + a / al[i])));
  };

  I.rollingMax = function (v, n) {
    const out = nulls(v.length), q = [];
    let head = 0;
    for (let i = 0; i < v.length; i++) {
      while (q.length > head && v[q[q.length - 1]] <= v[i]) q.pop();
      q.push(i);
      if (q[head] <= i - n) head++;
      if (i >= n - 1) out[i] = v[q[head]];
    }
    return out;
  };

  I.rollingMin = function (v, n) {
    const out = nulls(v.length), q = [];
    let head = 0;
    for (let i = 0; i < v.length; i++) {
      while (q.length > head && v[q[q.length - 1]] >= v[i]) q.pop();
      q.push(i);
      if (q[head] <= i - n) head++;
      if (i >= n - 1) out[i] = v[q[head]];
    }
    return out;
  };

  /** Supertrend като в TradingView: [линия, посока 1/-1]. */
  I.supertrend = function (h, l, c, n = 10, mult = 3) {
    const size = c.length, a = I.atr(h, l, c, n);
    const line = nulls(size), dir = new Array(size).fill(0);
    let fu = null, fd = null, d = 1;
    for (let i = 0; i < size; i++) {
      if (a[i] === null) continue;
      const src = (h[i] + l[i]) / 2, bu = src - mult * a[i], bd = src + mult * a[i];
      if (fu === null) { fu = bu; fd = bd; }
      else {
        const pfu = fu, pfd = fd;
        fu = c[i - 1] > pfu ? Math.max(bu, pfu) : bu;
        fd = c[i - 1] < pfd ? Math.min(bd, pfd) : bd;
        if (d === -1 && c[i] > pfd) d = 1;
        else if (d === 1 && c[i] < pfu) d = -1;
      }
      dir[i] = d;
      line[i] = d === 1 ? fu : fd;
    }
    return [line, dir];
  };

  /** Линията на UT Bot (плаващ стоп по ATR върху затварянето). */
  I.utBot = function (c, atrVals, key = 1.5) {
    const out = nulls(c.length);
    let prev = null;
    for (let i = 0; i < c.length; i++) {
      if (atrVals[i] === null) continue;
      const nl = key * atrVals[i], s = c[i];
      if (prev === null || i === 0) { prev = s - nl; out[i] = prev; continue; }
      const s1 = c[i - 1];
      let cur;
      if (s > prev && s1 > prev) cur = Math.max(prev, s - nl);
      else if (s < prev && s1 < prev) cur = Math.min(prev, s + nl);
      else if (s > prev) cur = s - nl;
      else cur = s + nl;
      out[i] = cur;
      prev = cur;
    }
    return out;
  };

  /** Облакът на Ишимоку под текущата свещ: [span A, span B] (изместени 26 напред) + [tenkan, kijun]. */
  I.ichimoku = function (h, l, tenkan = 9, kijun = 26, senkou = 52, shift = 26) {
    const size = h.length;
    const th = I.rollingMax(h, tenkan), tl = I.rollingMin(l, tenkan);
    const kh = I.rollingMax(h, kijun), kl = I.rollingMin(l, kijun);
    const sh = I.rollingMax(h, senkou), sl = I.rollingMin(l, senkou);
    const a = nulls(size), b = nulls(size), tk = nulls(size), kj = nulls(size);
    for (let i = 0; i < size; i++) {
      if (th[i] !== null) tk[i] = (th[i] + tl[i]) / 2;
      if (kh[i] !== null) kj[i] = (kh[i] + kl[i]) / 2;
      if (i < shift) continue;
      const j = i - shift;
      if (th[j] !== null && kh[j] !== null) a[i] = ((th[j] + tl[j]) / 2 + (kh[j] + kl[j]) / 2) / 2;
      if (sh[j] !== null) b[i] = (sh[j] + sl[j]) / 2;
    }
    return [a, b, tk, kj];
  };

  I.linregLast = function (v, n) {
    const out = nulls(v.length);
    const mx = (n - 1) / 2;
    let sxx = 0;
    for (let x = 0; x < n; x++) sxx += (x - mx) * (x - mx);
    for (let i = n - 1; i < v.length; i++) {
      let ok = true, my = 0;
      for (let k = i - n + 1; k <= i; k++) { if (v[k] === null) { ok = false; break; } my += v[k]; }
      if (!ok) continue;
      my /= n;
      let sxy = 0;
      for (let x = 0; x < n; x++) sxy += (x - mx) * (v[i - n + 1 + x] - my);
      out[i] = my + (sxy / sxx) * (n - 1 - mx);
    }
    return out;
  };

  /** Squeeze Momentum (LazyBear): [свиване ли е, импулс]. */
  I.squeeze = function (h, l, c, n = 20, bbK = 2, kcK = 1.5) {
    const [mid, up, lo] = I.bollinger(c, n, bbK);
    const rng = I.sma(I.trueRange(h, l, c), n);
    const hh = I.rollingMax(h, n), ll = I.rollingMin(l, n);
    const size = c.length, on = new Array(size).fill(false), delta = nulls(size);
    for (let i = 0; i < size; i++) {
      if (mid[i] === null || rng[i] === null || hh[i] === null) continue;
      on[i] = lo[i] > mid[i] - kcK * rng[i] && up[i] < mid[i] + kcK * rng[i];
      delta[i] = c[i] - ((hh[i] + ll[i]) / 2 + mid[i]) / 2;
    }
    return [on, I.linregLast(delta, n)];
  };

  /* ---------- допълнителни (за конструктора) ---------- */

  /** [MACD линия, сигнална линия, хистограма]. */
  I.macd = function (c, fast = 12, slow = 26, sig = 9) {
    const f = I.ema(c, fast), s = I.ema(c, slow);
    const line = f.map((x, i) => (x === null || s[i] === null ? null : x - s[i]));
    const signal = I.emaOf(line, sig);
    const hist = line.map((x, i) => (x === null || signal[i] === null ? null : x - signal[i]));
    return [line, signal, hist];
  };

  /** Стохастик: [%K, %D]. */
  I.stoch = function (h, l, c, k = 14, d = 3, slow = 3) {
    const hh = I.rollingMax(h, k), ll = I.rollingMin(l, k);
    const raw = c.map((x, i) => (hh[i] === null ? null : hh[i] === ll[i] ? 50 : (100 * (x - ll[i])) / (hh[i] - ll[i])));
    const kk = I.smaOf(raw, slow);
    return [kk, I.smaOf(kk, d)];
  };

  I.cci = function (h, l, c, n = 20) {
    const tp = c.map((x, i) => (h[i] + l[i] + x) / 3);
    const m = I.sma(tp, n), out = nulls(c.length);
    for (let i = n - 1; i < c.length; i++) {
      let md = 0;
      for (let k = i - n + 1; k <= i; k++) md += Math.abs(tp[k] - m[i]);
      md /= n;
      out[i] = md ? (tp[i] - m[i]) / (0.015 * md) : 0;
    }
    return out;
  };

  I.wpr = function (h, l, c, n = 14) {
    const hh = I.rollingMax(h, n), ll = I.rollingMin(l, n);
    return c.map((x, i) => (hh[i] === null ? null : hh[i] === ll[i] ? -50 : (-100 * (hh[i] - x)) / (hh[i] - ll[i])));
  };

  I.momentum = (c, n = 10) => c.map((x, i) => (i >= n ? x - c[i - n] : null));

  /** Awesome Oscillator: SMA5 − SMA34 на средната цена. */
  I.awesome = function (h, l) {
    const mp = h.map((x, i) => (x + l[i]) / 2);
    const a = I.sma(mp, 5), b = I.sma(mp, 34);
    return a.map((x, i) => (x === null || b[i] === null ? null : x - b[i]));
  };

  /** Канал на Дончиан: [горна, долна] - най-високото и най-ниското за n свещи ПРЕДИ текущата. */
  I.donchian = function (h, l, n = 20) {
    const hh = I.rollingMax(h, n), ll = I.rollingMin(l, n);
    return [[null, ...hh.slice(0, -1)], [null, ...ll.slice(0, -1)]];
  };

  /** Канал на Келтнер: [средна EMA, горна, долна]. */
  I.keltner = function (h, l, c, n = 20, k = 2) {
    const m = I.ema(c, n), a = I.atr(h, l, c, n);
    return [m, m.map((x, i) => (x === null || a[i] === null ? null : x + k * a[i])), m.map((x, i) => (x === null || a[i] === null ? null : x - k * a[i]))];
  };

  /** Свещи Хейкин Аши: [open, close]. */
  I.heikin = function (o, h, l, c) {
    const ho = [], hc = [];
    for (let i = 0; i < c.length; i++) {
      hc.push((o[i] + h[i] + l[i] + c[i]) / 4);
      ho.push(i === 0 ? (o[0] + c[0]) / 2 : (ho[i - 1] + hc[i - 1]) / 2);
    }
    return [ho, hc];
  };

  /** Chandelier Exit: [стоп за покупки, стоп за продажби]. */
  I.chandelier = function (h, l, c, n = 22, k = 3) {
    const a = I.atr(h, l, c, n), hh = I.rollingMax(h, n), ll = I.rollingMin(l, n);
    return [hh.map((x, i) => (x === null || a[i] === null ? null : x - k * a[i])), ll.map((x, i) => (x === null || a[i] === null ? null : x + k * a[i]))];
  };

  /** SSL канал: [горна, долна] = SMA на върховете и дъната. */
  I.ssl = (h, l, n = 10) => [I.sma(h, n), I.sma(l, n)];
})(self.FX = self.FX || {});
