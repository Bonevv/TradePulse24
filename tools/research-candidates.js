"use strict";

// Правилата на тази група се замразяват преди измерването. Не търсим параметри в цикъл.
function researchCandidates(FX) {
  const source = "https://github.com/EA31337/EA31337-strategies";
  const catalog = Object.fromEntries([...FX.CODED, ...FX.LIBRARY].map((s) => [s.key, s]));
  const clone = (key, base, pair, tf, name, day = false) => {
    const original = catalog[base];
    const fn = original.fn;
    return { ...original, key, name, tfs: [tf], pairs: [pair], origin: "research", source: original.source, url: original.url || source,
      ...(day ? { session: "site", own_hours: true, close_hour: 20, valid_bars: 1, max_bars: 24 } : {}),
      fn: (s, i) => day && (s.hour[i] < 8 || s.hour[i] >= 18) ? null : fn(s, i) };
  };
  const london = (key, pair) => ({
    key, name: `${pair}: пробив на азиатския диапазон`, pairs: [pair], tfs: ["H1"], origin: "research", source: "Собствен вариант на пробив на сесия; семейство MA Breakout / ATR trend", url: source,
    session: "site", own_hours: true, close_hour: 20, valid_bars: 1, max_bars: 12, max_per_day: 1,
    exit: { parts: [[1, 2]] },
    fn(s, i) {
      if (s.hour[i] < 9 || s.hour[i] >= 16 || !s.atr[i]) return null;
      const range = s.get("session_range", 0, 8).get(s.date[i]);
      if (!range || range[2] < 6 || range[0] - range[1] < s.atr[i] || range[0] - range[1] > 5 * s.atr[i]) return null;
      const direction = s.c[i] > range[0] && s.c[i - 1] <= range[0] ? 1 : s.c[i] < range[1] && s.c[i - 1] >= range[1] ? -1 : 0;
      if (!direction) return null;
      return [[FX.ord.market(direction, s.c[i], 2 * s.atr[i])], "Първи потвърден пробив на диапазона 00–08 ч. Стоп 2 ATR и цел 2R; затваряне до 20 ч. по софийско време."];
    },
  });
  const pullback = (key, tf) => {
    const spec = {
      key, name: `Злато: връщане към EMA 20 (${tf})`, tfs: [tf], pairs: ["XAUUSD"], source: "Собствен вариант на EMA pullback с H1/D1 тренд", url: source,
      when: [{ a: "close", op: "cross_above", b: { ind: "ema", p: [20] } },
        { a: { ind: "ema", p: [50], tf: tf === "M15" ? "H1" : "D1" }, op: ">", b: { ind: "ema", p: [200], tf: tf === "M15" ? "H1" : "D1" } }],
      stop: { type: "atr", mult: 2, n: 14 }, exit: tf === "M15" ? { parts: [[1, 2]] } : { parts: [[1, null]], trail: true },
      ...(tf === "M15" ? { close_hour: 20 } : { max_bars: 100 }),
    };
    const built = FX.build(spec), fn = built.fn;
    return { ...built, origin: "research", ...(tf === "M15" ? { session: "site", own_hours: true, valid_bars: 1 } : {}),
      fn: (s, i) => tf === "M15" && (s.hour[i] < 8 || s.hour[i] >= 18) ? null : fn(s, i) };
  };
  const fvg = (key, requireOB) => ({
    key, name: requireOB ? "FVG Gold: тренд и Order Block" : "FVG Gold: задължителен H1 тренд", pairs: ["XAUUSD"], tfs: ["M15"], origin: "research",
    source: "Отделен дневен вариант по FvgGold; само завършени свещи, без тиково управление", url: "https://github.com/foeed/FvgGold-EA",
    session: "site", own_hours: true, close_hour: 20, keep_pending: true, valid_bars: 4, max_bars: 48,
    exit: { parts: [[1, 1.5]], be: { atr: 0.5, offset: 0.02 } },
    fn(s, i) {
      if (s.hour[i] < 8 || s.hour[i] >= 18 || !s.atr[i]) return null;
      const hour = FX.utc(s.t[i] + s.sec).hour;
      if (!((hour >= 7 && hour < 10) || (hour >= 12 && hour < 21))) return null;
      const h1 = s.peer("H1"), j = h1 ? s.align("H1")[i] : -1;
      if (j < 200) return null;
      const fast = h1.get("ema", 50)[j], slow = h1.get("ema", 200)[j];
      if (fast === null || slow === null || fast === slow) return null;
      const bias = fast > slow ? 1 : -1;
      const used = s.memo.fvg || (s.memo.fvg = new Set());
      for (let age = 2; age <= 20 && i - age - 1 >= 0; age++) {
        const middle = i - age, older = middle - 1, newer = middle + 1;
        if (used.has(s.t[middle])) continue;
        let dir = 0, top, bottom;
        if (s.l[newer] > s.h[older]) { dir = 1; top = s.l[newer]; bottom = s.h[older]; }
        else if (s.h[newer] < s.l[older]) { dir = -1; top = s.l[older]; bottom = s.h[newer]; }
        if (dir !== bias || top - bottom < 0.25) continue;
        let invalid = false;
        for (let x = newer + 1; x <= i; x++) if (dir === 1 ? s.l[x] < bottom : s.h[x] > top) { invalid = true; break; }
        if (invalid) continue;
        let ob = false;
        if (requireOB) for (let x = Math.max(1, i - 50); x < i; x++) {
          if (!s.atr[x] || Math.abs(s.c[x] - s.o[x]) < 1.5 * s.atr[x]) continue;
          if ((s.c[x] - s.o[x]) * dir <= 0 || (s.c[x - 1] - s.o[x - 1]) * dir >= 0) continue;
          const low = Math.min(s.o[x - 1], s.c[x - 1]), high = Math.max(s.o[x - 1], s.c[x - 1]);
          if (Math.max(0, low - top, bottom - high) > 2) continue;
          let broken = false;
          for (let k = x + 1; k <= i; k++) if (dir === 1 ? s.l[k] < low : s.h[k] > high) { broken = true; break; }
          if (!broken) { ob = true; break; }
        }
        if (requireOB && !ob) continue;
        const body = s.h[middle] > s.l[middle] ? Math.abs(s.c[middle] - s.o[middle]) / (s.h[middle] - s.l[middle]) : 0;
        const score = 30 * Math.min((top - bottom) / s.atr[i], 1) + 30 * body + 20 + 10 * (1 - age / 20)
          + ((s.c[i] - fast) * dir < 0 ? 10 : 0) + (ob ? 20 : 0);
        if (score < 50) continue;
        const entry = dir === 1 ? bottom + 1.5 : top - 1.5, stop = dir === 1 ? bottom - 3 : top + 3;
        if ((s.c[i] - entry) * dir <= 0) continue;
        used.add(s.t[middle]);
        return [[{ dir, type: "limit", entry, stop }], `FVG със задължителен H1 тренд${requireOB ? " и потвърден Order Block" : ""}; отделен дневен вариант, затваряне до 20 ч.`];
      }
      return null;
    },
  });
  return [
    fvg("audit_fvg_bias_day", false), fvg("audit_fvg_ob_day", true),
    pullback("audit_gold_pullback_day", "M15"),
    london("audit_gbp_london_day", "GBPUSD"), london("audit_eur_london_day", "EURUSD"),
    clone("audit_gold_supertrend_day", "lib_supertrend_ema", "XAUUSD", "H1", "Злато: дневен Supertrend + EMA 200", true),
    clone("audit_gold_supertrend_swing", "lib_supertrend_ema", "XAUUSD", "H4", "Злато: Supertrend + EMA 200"),
    clone("audit_jpy_supertrend_swing", "lib_supertrend_ema", "USDJPY", "H4", "USD/JPY: Supertrend + EMA 200"),
    clone("audit_gold_macd_swing", "lib_macd_zero", "XAUUSD", "H4", "Злато: MACD над нулата + EMA 200"),
    clone("audit_gold_donchian_swing", "lib_turtle_20", "XAUUSD", "H4", "Злато: Дончиан 20/10"),
    clone("audit_jpy_donchian_swing", "lib_turtle_20", "USDJPY", "H4", "USD/JPY: Дончиан 20/10"),
    pullback("audit_gold_pullback_swing", "H4"),
  ];
}
if (typeof module !== "undefined") module.exports = researchCandidates;
