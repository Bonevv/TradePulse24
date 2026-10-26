/* Основа на двигателя: инструменти, графики, време. Работи и в браузъра, и във Web Worker. */
(function (FX) {
  "use strict";

  // spread = типичен спред + комисиона в пипсове. buf_scale = по-голям отстъп при златото.
  // Злато: 1 пипс = 0.10$, 1 лот = 100 унции, значи 1 пипс на лот = 10$ (като EUR/USD).
  FX.PAIRS = {
    EURUSD: { name: "EUR/USD", pip: 0.0001, digits: 5, spread: 1.0 },
    GBPUSD: { name: "GBP/USD", pip: 0.0001, digits: 5, spread: 1.4 },
    USDJPY: { name: "USD/JPY", pip: 0.01, digits: 3, spread: 1.2 },
    AUDUSD: { name: "AUD/USD", pip: 0.0001, digits: 5, spread: 1.2 },
    USDCHF: { name: "USD/CHF", pip: 0.0001, digits: 5, spread: 1.5 },
    USDCAD: { name: "USD/CAD", pip: 0.0001, digits: 5, spread: 1.5 },
    NZDUSD: { name: "NZD/USD", pip: 0.0001, digits: 5, spread: 1.6 },
    XAUUSD: { name: "XAU/USD", pip: 0.1, digits: 2, spread: 3.0, buf_scale: 10 },
  };
  FX.PAIR_KEYS = Object.keys(FX.PAIRS);

  // buffer_pips: отстъп за поръчки; valid_bars: колко свещи чака поръчката; max_bars: най-дълго държане.
  FX.TIMEFRAMES = {
    M15: { label: "15 минути", seconds: 900, style: "day", buffer_pips: 1, valid_bars: 4, max_bars: 96 },
    H1: { label: "1 час", seconds: 3600, style: "day", buffer_pips: 2, valid_bars: 3, max_bars: 14 },
    H4: { label: "4 часа", seconds: 14400, style: "swing", buffer_pips: 4, valid_bars: 3, max_bars: 30 },
    D1: { label: "1 ден", seconds: 86400, style: "swing", buffer_pips: 5, valid_bars: 3, max_bars: 20 },
  };
  FX.TF_KEYS = Object.keys(FX.TIMEFRAMES);

  FX.DAY_FIRST_HOUR = 7;
  FX.DAY_LAST_SETUP_HOUR = 17;
  FX.DAY_CLOSE_HOUR = 22;
  FX.TP1_R = 1.0;
  FX.TP2_R = 2.0;
  FX.STATS_RISK_PCT = 0.5;
  FX.PUBLISH_DELAY = 25 * 60; // за „на живо“: сигналът трябва да е бил видим поне толкова преди входа

  /* ---------------------------------------------------------- време (българско) */
  // ЕС: лятно часово време от последната неделя на март 01:00 UTC до последната неделя на октомври 01:00 UTC.
  const dstCache = {};
  function lastSunday(year, month) {
    const d = new Date(Date.UTC(year, month + 1, 0, 1, 0, 0));
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d.getTime() / 1000;
  }
  FX.sofiaOffset = function (t) {
    const y = new Date(t * 1000).getUTCFullYear();
    let c = dstCache[y];
    if (!c) c = dstCache[y] = [lastSunday(y, 2), lastSunday(y, 9)];
    return t >= c[0] && t < c[1] ? 10800 : 7200;
  };
  /** Местно (българско) време: час, минута, ден от седмицата (пон = 0), дата като число ГГГГММДД. */
  FX.local = function (t) {
    const d = new Date((t + FX.sofiaOffset(t)) * 1000);
    return {
      hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: (d.getUTCDay() + 6) % 7,
      date: d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate(),
      year: d.getUTCFullYear(),
    };
  };
  FX.utc = function (t) {
    const d = new Date(t * 1000);
    return { hour: d.getUTCHours(), weekday: (d.getUTCDay() + 6) % 7 };
  };
  /** Секундите на определен местен час в същия местен ден като t. */
  FX.localAt = function (t, hour) {
    const off = FX.sofiaOffset(t);
    const day = Math.floor((t + off) / 86400) * 86400;
    return day + hour * 3600 - off;
  };

  /** Закръгляне като в Python (по точния десетичен запис на числото, без грешка от умножение). */
  FX.round = function (x, d) {
    return Number(x.toFixed(d));
  };

  /* ---------------------------------------------------------- подготовка на свещите */
  /** Маха уикенд свещите; неделната дневна свещ се слепва с понеделник (както в Python версията). */
  FX.cleanWeekend = function (tf, bars) {
    const out = [];
    let sunday = null;
    for (const b of bars) {
      const u = FX.utc(b[0]);
      if (tf === "H1" || tf === "M15") {
        if (u.weekday === 5 || (u.weekday === 6 && u.hour < 20)) continue;
        out.push(b);
      } else {
        if (u.weekday === 5) continue;
        if (u.weekday === 6) { sunday = b; continue; }
        let x = b;
        if (sunday && b[0] - sunday[0] > 0 && b[0] - sunday[0] <= 86400) {
          x = [b[0], sunday[1], Math.max(b[2], sunday[2]), Math.min(b[3], sunday[3]), b[4]];
        }
        sunday = null;
        out.push(x);
      }
    }
    return out;
  };

  FX.toH4 = function (h1) {
    const out = [];
    let cur = null;
    for (const [t, o, h, l, c] of h1) {
      const key = t - (t % 14400);
      if (cur && cur[0] === key) {
        cur[2] = Math.max(cur[2], h);
        cur[3] = Math.min(cur[3], l);
        cur[4] = c;
      } else {
        if (cur) out.push(cur);
        cur = [key, o, h, l, c];
      }
    }
    if (cur) out.push(cur);
    return out;
  };
})(self.FX = self.FX || {});
