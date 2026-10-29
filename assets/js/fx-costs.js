/* Разходите са в пипсове за един пълен вход и изход. Суaпът се начислява по дни. */
(function (FX) {
  "use strict";
  const fields = ["spread", "commission", "slippage", "swap_long", "swap_short"];
  function normalize(input = {}) {
    const pairs = {};
    for (const pair of FX.PAIR_KEYS) {
      const row = input.pairs?.[pair] || {};
      pairs[pair] = {};
      for (const field of fields) {
        const fallback = field === "spread" ? FX.PAIRS[pair].spread : 0;
        const value = row[field] === undefined ? fallback : Number(row[field]);
        if (!Number.isFinite(value) || Math.abs(value) > 10000 || (!field.startsWith("swap_") && value < 0))
          throw new Error("Провери разходите за " + FX.PAIRS[pair].name + ".");
        pairs[pair][field] = value;
      }
    }
    return { schema: 1, pairs };
  }
  const defaultProfile = normalize();
  function fingerprint(input) {
    const text = JSON.stringify(normalize(input));
    if (text === JSON.stringify(defaultProfile)) return "model-v1";
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return "costs-" + (hash >>> 0).toString(16).padStart(8, "0");
  }
  function info(pair, input) {
    const profile = normalize(input), base = FX.PAIRS[pair];
    return { ...base, spread: profile.pairs[pair].spread, costs: profile.pairs[pair], cost_model: fingerprint(profile) };
  }
  const dst = new Map();
  function newYorkOffset(t) {
    const year = new Date(t * 1000).getUTCFullYear();
    if (!dst.has(year)) {
      const firstSunday = (month) => {
        const first = new Date(Date.UTC(year, month, 1));
        return 1 + (7 - first.getUTCDay()) % 7;
      };
      dst.set(year, [Date.UTC(year, 2, firstSunday(2) + 7, 7) / 1000, Date.UTC(year, 10, firstSunday(10), 6) / 1000]);
    }
    const [start, end] = dst.get(year);
    return t >= start && t < end ? -4 : -5;
  }
  function swapDays(start, end) {
    let count = 0;
    for (let day = Math.floor(start / 86400); day <= Math.floor(end / 86400); day++) {
      const midday = day * 86400 + 12 * 3600;
      const weekday = new Date(midday * 1000).getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      const rollover = day * 86400 + (17 - newYorkOffset(midday)) * 3600;
      if (start < rollover && end >= rollover) count += weekday === 3 ? 3 : 1;
    }
    return count;
  }
  function calculate(trade, pairInfo, end) {
    const risk = Math.abs(trade.fill_price - trade.stop0), row = pairInfo.costs;
    const spread = pairInfo.spread * pairInfo.pip / risk;
    if (!row) return { spread, commission: 0, slippage: 0, swap: 0, total: spread };
    const commission = row.commission * pairInfo.pip / risk;
    const slippage = row.slippage * pairInfo.pip / risk;
    const rate = trade.dir === 1 ? row.swap_long : row.swap_short;
    let swap = 0;
    if (rate) for (const part of trade.parts) swap += part.w * rate * swapDays(trade.fill_time, part.closed_at || end) * pairInfo.pip / risk;
    return { spread, commission, slippage, swap, total: spread + commission + slippage + swap };
  }
  FX.costs = { fields, normalize, fingerprint, info, calculate, swapDays, defaultProfile };
})(self.FX = self.FX || {});
