/* Симулация на сделките върху историята и статистика.

   Поръчки: стоп (при пробив), лимитна (при връщане) или пазарна (при отварянето на следващата свещ).
   Изходи: една или две цели, стоп на входа след първата цел или след движение, плаващ стоп,
   изход по правило, затваряне в час, обратен сигнал.

   Какво е станало първо вътре в свещта:
   - сделките се следят по 15-минутните (или часовите) свещи, когато ги има;
   - ако стопът и целта са достижими в една свещ, приемаме стопа (по-лошото);
   - в свещта на входа дъното/върхът може да е бил след входа (по-лошото), а връщане до входа
     след първата цел се брои само ако свещта затваря обратно при входа;
   - стоп на входа след движение и плаващият стоп важат от следващата свещ. */
(function (FX) {
  "use strict";
  const R = FX.round;

  function addBars(t, count, tf) {
    const step = FX.TIMEFRAMES[tf].seconds;
    while (count > 0) {
      t += step;
      const u = FX.utc(t);
      if (u.weekday === 5 || (u.weekday === 6 && (tf === "D1" || u.hour < 21))) continue;
      count -= 1;
    }
    return t;
  }

  function prepare(s, i, order, strat) {
    const a = s.atr[i];
    if (a === null || a === undefined) return null;
    const od = Object.assign({}, order);
    const d = od.dir;
    od.type = od.type || "stop";
    let entry = od.entry, stop = od.stop, dist = Math.abs(entry - stop);
    if (strat.origin === "book") {
      const minDist = Math.max(3 * s.info.spread * s.pip, 0.25 * a);
      if (dist < minDist) { dist = minDist; stop = entry - d * dist; }
      if (dist > 3 * a) return null;
    }
    if (!(dist > 0)) return null;
    const dg = s.info.digits;
    od.entry = R(entry, dg);
    od.stop = R(stop, dg);
    if (od.type === "market") od.stop_dist = dist;
    od.targets = strat.exit.parts.map(([w, r]) => {
      const level = r ? entry + d * r * dist : od.tp_level;
      return { w, level: level === null || level === undefined ? null : R(level, dg) };
    });
    od.tp1 = od.targets[0].level;
    od.tp2 = od.targets.length > 1 ? od.targets[1].level : null;
    if (od.mid !== undefined && od.mid !== null && od.targets.length > 1) od.tp1 = R(od.mid, dg);
    od.atr = a;
    return od;
  }

  function open(st, od, price, t, ex) {
    const d = od.dir;
    let stop, ref, dist;
    if (od.type === "market") { dist = od.anchor_stop ? Math.abs(price - od.stop) : od.stop_dist; stop = od.anchor_stop ? od.stop : price - d * dist; ref = price; }
    else { stop = od.stop; ref = od.entry; dist = Math.abs(ref - stop); }
    const parts = ex.parts.map(([w, r], k) => ({ w, tp: r ? ref + d * r * dist : od.targets[k].level, px: null }));
    const be = ex.be;
    let beLevel = null, beTo = null;
    if (be && be.atr !== undefined) { beLevel = price + d * be.atr * od.atr; beTo = price + d * (be.offset || 0); }
    else if (be && be.frac_mid !== undefined && od.mid !== undefined && od.mid !== null) { beLevel = price + d * be.frac_mid * Math.abs(od.mid - price); beTo = price; }
    Object.assign(st, {
      status: "open", dir: d, entry: ref, fill_price: price, fill_time: Math.trunc(t), stop0: stop, stop,
      parts, best: price, trail_dist: ex.trail ? dist : null, be_level: beLevel, be_to: beTo, be_done: false,
      after_first: ex.after_first || null, half: false,
      tp1: od.mid !== undefined && od.mid !== null ? od.tp1 : parts[0].tp,
      tp2: parts.length > 1 ? parts[1].tp : null, order_type: od.type,
    });
  }

  const openParts = (st) => st.parts.map((p, k) => (p.px === null ? k : -1)).filter((k) => k >= 0);

  function take(st, k, price, t) {
    st.parts[k].px = price;
    st.parts[k].closed_at = Math.trunc(t);
    if (!st.half) {
      st.half = true;
      st.tp1_time = Math.trunc(t);
      if (st.after_first === "entry" && (st.fill_price - st.stop) * st.dir > 0) st.stop = st.fill_price;
    }
  }

  function finish(st, info, pip, t, reason) {
    const risk = Math.abs(st.fill_price - st.stop0), d = st.dir;
    let gross = 0;
    for (const p of st.parts) gross += (p.w * d * (p.px - st.fill_price)) / risk;
    const costs = FX.costs ? FX.costs.calculate(st, info, t) : { total: (info.spread * pip) / risk };
    Object.assign(st, { status: "closed", reason, exit_time: Math.trunc(t), r: R(gross - costs.total, 3) });
    if (info.costs) Object.assign(st, { gross_r: R(gross, 3), cost_r: R(costs.total, 3), cost_breakdown: costs });
  }

  function closeAll(st, info, pip, price, t, reason) {
    for (const p of st.parts) if (p.px === null) { p.px = price; p.closed_at = Math.trunc(t); }
    finish(st, info, pip, t, reason);
  }

  function stopReason(st) {
    const gain = (st.stop - st.fill_price) * st.dir;
    if (gain > 1e-9) return st.trail_dist || !st.half ? "trail" : "be";
    if (st.half || st.be_done || Math.abs(gain) <= 1e-9) return "be";
    return "sl";
  }

  /** Обработва една свещ (t, o, h, l, c с продължителност sec) за чакащ сигнал или отворена сделка. */
  function process(st, info, pip, t, o, h, l, c, sec, ex) {
    let first = false, gapFill = false;
    const end = t + sec;
    if (st.status === "pending") {
      if (st.strict_expiry && t >= st.valid_until) {
        Object.assign(st, { status: "cancelled", reason: "expired", exit_time: st.valid_until });
        return;
      }
      // Новите сесийни модели оставят време нивата да бъдат показани преди входа.
      // Ако през това време входът вече е докоснат, не го възстановяваме със задна дата.
      if (st.orders.some((od) => od.activate_after && t < od.activate_after)) {
        const early = st.orders.some((od) => od.dir === 1 ? h >= od.entry : l <= od.entry);
        if (early) Object.assign(st, { status: "cancelled", reason: "void", exit_time: Math.trunc(end) });
        return;
      }
      const hits = [];
      st.orders.forEach((od, k) => {
        const typ = od.type, e = od.entry, d = od.dir;
        if (typ === "market") hits.push([0, k, o]);
        else if (typ === "stop" && d === 1 && h >= e) hits.push([Math.max(0, e - o), k, o >= e ? o : e]);
        else if (typ === "stop" && d === -1 && l <= e) hits.push([Math.max(0, o - e), k, o <= e ? o : e]);
        else if (typ === "limit" && d === 1 && l <= e) hits.push([Math.max(0, o - e), k, o <= e ? o : e]);
        else if (typ === "limit" && d === -1 && h >= e) hits.push([Math.max(0, e - o), k, o >= e ? o : e]);
      });
      const cancels = [];
      for (const od of st.orders) {
        const cl = od.cancel;
        if (cl !== undefined && cl !== null && ((od.dir === -1 && h > cl) || (od.dir === 1 && l < cl))) {
          cancels.push(Math.max(0, (cl - o) * (od.dir === -1 ? 1 : -1)));
        }
      }
      hits.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
      if (cancels.length && (!hits.length || Math.min(...cancels) < hits[0][0])) {
        Object.assign(st, { status: "cancelled", reason: "void", exit_time: Math.trunc(end) });
        return;
      }
      if (!hits.length) return;
      const [, k, price] = hits[0];
      if (st.orders[k].anchor_stop && (price - st.orders[k].stop) * st.orders[k].dir <= 0) {
        Object.assign(st, { status: "cancelled", reason: "void", exit_time: Math.trunc(t) });
        return;
      }
      const selected = st.orders[k], actualRisk = (price - selected.stop) * selected.dir;
      if (selected.min_risk !== undefined && (actualRisk < selected.min_risk - 1e-10 || actualRisk > selected.max_risk + 1e-10)
        || selected.fixed_target && (selected.tp_level - price) * selected.dir + 1e-10 < actualRisk) {
        Object.assign(st, { status: "cancelled", reason: "void", exit_time: Math.trunc(t) });
        return;
      }
      open(st, st.orders[k], price, t, ex);
      first = true;
      gapFill = price === o;
    }
    if (st.status !== "open") return;

    const d = st.dir;
    const adverse = d === 1 ? l : h, favorable = d === 1 ? h : l;
    const past = d === 1 ? (lvl, x) => x <= lvl : (lvl, x) => x >= lvl;
    const reach = d === 1 ? (lvl, x) => x >= lvl : (lvl, x) => x <= lvl;
    const targets = () => openParts(st).filter((k) => st.parts[k].tp !== null)
      .sort((a, b) => Math.abs(st.parts[a].tp - st.fill_price) - Math.abs(st.parts[b].tp - st.fill_price));
    const done = () => openParts(st).length === 0;
    const tpReason = () => (st.parts.length > 1 ? "tp2" : "tp");

    if (!first) {
      if (past(st.stop, o)) { closeAll(st, info, pip, o, end, stopReason(st)); return; }
      for (const k of targets()) if (reach(st.parts[k].tp, o)) take(st, k, o, t);
      if (done()) { finish(st, info, pip, end, tpReason()); return; }
    }
    if (past(st.stop, adverse)) { closeAll(st, info, pip, st.stop, end, stopReason(st)); return; }
    let took = false;
    for (const k of targets()) {
      if (reach(st.parts[k].tp, favorable)) { take(st, k, st.parts[k].tp, t); took = true; }
    }
    if (took) {
      if (done()) { finish(st, info, pip, end, tpReason()); return; }
      const back = first && !gapFill ? past(st.stop, c) : past(st.stop, adverse);
      if (back) { closeAll(st, info, pip, st.stop, end, "be"); return; }
    }
    if (st.be_level !== null && !st.be_done && reach(st.be_level, favorable)) {
      if ((st.be_to - st.stop) * d > 0) st.stop = st.be_to;
      st.be_done = true;
    }
  }

  function subRanges(s, sub, subSec) {
    const sec = s.tfc.seconds, need = Math.max(1, Math.trunc((sec / subSec) * 0.5));
    const out = new Array(s.n);
    let j = 0;
    for (let i = 0; i < s.n; i++) {
      const start = s.t[i], stop = s.t[i] + sec;
      while (j < sub.n && sub.t[j] < start) j++;
      let k = j;
      while (k < sub.n && sub.t[k] < stop) k++;
      out[i] = k - j >= need ? [j, k] : null;
      j = k;
    }
    return out;
  }

  const INTERNAL = ["last_bar", "fill_bar", "then", "exit_next_open", "best", "trail_dist", "be_level", "be_to", "be_done", "after_first"];

  /** Минава по всички свещи на една двойка и връща списък със сделки/сигнали.
      subs = по-малки свещи на същата двойка [[свещи, секунди], ...] - от най-подробните. */
  function simulate(s, strat, now, subs = [], fromTime = 0, deferPendingExpiry = false) {
    const tfc = s.tfc, tf = s.tf, sec = tfc.seconds, info = s.info, pip = s.pip, ex = strat.exit;
    const siteDay = strat.session === "site" && tfc.style === "day";
    const ownHours = !!strat.own_hours;
    const validBars = strat.valid_bars !== undefined ? strat.valid_bars : tfc.valid_bars;
    const maxBars = strat.max_bars !== undefined ? strat.max_bars : tfc.max_bars;
    const closeHour = strat.close_hour || (tfc.style === "day" ? strat.close_hour_day : null);
    const maxPerDay = strat.max_per_day || (tfc.style === "day" ? strat.max_per_day_day : null);
    const manage = strat.manage;
    const layers = subs.filter(([sub, subSec]) => sub && subSec < sec).map(([sub, subSec]) => [sub, subSec, subRanges(s, sub, subSec)]);
    const incomplete = new Set();
    if (strat.require_session_close && tfc.style === "day") {
      const dates = new Map();
      for (let i = 60; i < s.n; i++) {
        if (s.weekday[i] > 4) continue;
        const closing = FX.localAt(s.t[i], closeHour || FX.DAY_CLOSE_HOUR);
        const found = dates.get(s.date[i]) || { closing, complete: false };
        if (s.t[i] < closing && s.t[i] + sec >= closing) found.complete = true;
        dates.set(s.date[i], found);
      }
      for (const [date, day] of dates) if (day.closing <= now && !day.complete) incomplete.add(date);
    }

    function runBar(st, i) {
      for (const [sub, subSec, ranges] of layers) {
        const rng = ranges[i];
        if (rng) {
          for (let x = rng[0]; x < rng[1]; x++) {
            if (st.exit_next_open && st.status === "open") { closeAll(st, info, pip, sub.o[x], sub.t[x], "reverse"); return; }
            process(st, info, pip, sub.t[x], sub.o[x], sub.h[x], sub.l[x], sub.c[x], subSec, ex);
            if (st.status !== "pending" && st.status !== "open") return;
          }
          return;
        }
      }
      if (st.exit_next_open && st.status === "open") { closeAll(st, info, pip, s.o[i], s.t[i], "reverse"); return; }
      process(st, info, pip, s.t[i], s.o[i], s.h[i], s.l[i], s.c[i], sec, ex);
    }

    function newPending(i, found) {
      if (strat.strict_daily_fills && maxPerDay && lastDay === s.date[i]) return null;
      const [rawOrders, why] = found;
      const orders = rawOrders.map((od) => prepare(s, i, od, strat));
      if (!orders.length || orders.some((od) => od === null)) return null;
      let validUntil = addBars(s.t[i], validBars + 1, tf);
      if (siteDay) validUntil = Math.min(validUntil, FX.localAt(s.t[i], strat.pending_close_hour_day || FX.DAY_CLOSE_HOUR - 1));
      return {
        id: `${strat.key}-${tf}-${s.pair}-${s.t[i]}`, pair: s.pair, tf, status: "pending", orders,
        signal_time: s.t[i] + sec, valid_until: validUntil, last_bar: i + validBars, why,
        ...(strat.strict_expiry ? { strict_expiry: true } : {}),
      };
    }

    const out = [];
    let st = null, lastDay = null;
    for (let i = 60; i < s.n; i++) {
      if (st !== null) {
        runBar(st, i);
        if (strat.strict_daily_fills && st.fill_time) lastDay = FX.local(st.fill_time).date;
        if (st.status === "closed" && st.reason === "reverse" && st.then) {
          out.push(st);
          const [j, found] = st.then;
          st = newPending(j, found);
          if (st !== null) runBar(st, i);
        }
        if (st !== null && st.status === "open") {
          if (st.fill_bar === undefined || st.fill_bar === null) {
            st.fill_bar = i;
            lastDay = FX.local(st.fill_time).date;
          }
          const d = st.dir;
          if (st.trail_dist) {
            st.best = d === 1 ? Math.max(st.best, s.h[i]) : Math.min(st.best, s.l[i]);
            const ns = st.best - d * st.trail_dist;
            if ((ns - st.stop) * d > 0) st.stop = ns;
          }
          const act = manage ? manage(st, s, i) : null;
          if (act && act[0] === "close") closeAll(st, info, pip, s.c[i], s.t[i] + sec, "signal");
          else if (act && act[0] === "part") {
            take(st, act[1], s.c[i], s.t[i]);
            if (!openParts(st).length) finish(st, info, pip, s.t[i] + sec, "signal");
          } else if (act && act[0] === "reverse") { st.exit_next_open = true; st.then = [i, act[1]]; }
          if (st.status === "open") {
            const held = i - st.fill_bar;
            const nextDay = i + 1 < s.n && s.date[i + 1] !== s.date[i];
            const endHour = closeHour ? FX.local(s.t[i] + sec).hour : 0;
            if (siteDay && (s.hour[i] >= FX.DAY_CLOSE_HOUR || nextDay)) closeAll(st, info, pip, s.c[i], s.t[i] + sec, "time");
            else if (closeHour && (endHour >= closeHour || nextDay)) closeAll(st, info, pip, s.c[i], s.t[i] + sec, "time");
            else if (held >= maxBars) closeAll(st, info, pip, s.c[i], s.t[i] + sec, "time");
          }
        } else if (st !== null && st.status === "pending") {
          const tooLate = siteDay && s.hour[i] >= FX.DAY_CLOSE_HOUR - 1;
          if (i >= st.last_bar || tooLate) Object.assign(st, { status: "cancelled", reason: "expired", exit_time: s.t[i] + sec });
        }
        if (st !== null && (st.status === "closed" || st.status === "cancelled")) { out.push(st); st = null; }
      }

      if (st !== null && (st.status === "open" || (st.status === "pending" && strat.keep_pending))) continue;
      if (s.t[i] < fromTime) continue;
      if (incomplete.has(s.date[i])) continue;
      if (siteDay && !ownHours) {
        if (s.weekday[i] > 4 || !(FX.DAY_FIRST_HOUR <= s.hour[i] && s.hour[i] <= FX.DAY_LAST_SETUP_HOUR)) continue;
      }
      if (maxPerDay && lastDay === s.date[i]) continue;
      const found = strat.fn(s, i);
      if (!found) continue;
      const fresh = newPending(i, found);
      if (fresh !== null) st = fresh;
    }

    if (st !== null) {
      if (!deferPendingExpiry && st.status === "pending" && st.valid_until <= now) Object.assign(st, { status: "cancelled", reason: "expired", exit_time: st.valid_until });
      out.push(st);
    }
    if (strat.require_session_close && tfc.style === "day") out.omitted_days = incomplete.size;
    return out;
  }

  function clean(tr) {
    for (const k of INTERNAL) delete tr[k];
    for (const od of tr.orders || []) delete od.atr;
    return tr;
  }

  /* ---------------------------------------------------------- статистика */

  function summarize(trades, start, end) {
    const closed = trades.filter((t) => t.status === "closed").sort((a, b) => a.exit_time - b.exit_time);
    const n = closed.length;
    const years = Math.max((end - start) / (365.25 * 86400), 1e-9);
    const base = { trades: n, start, end, years: R(years, 2) };
    if (!n) return Object.assign(base, { verdict: "few", verdict_label: "Недостатъчно сделки" });

    const rs = closed.map((t) => t.r);
    const wins = rs.filter((r) => r > 0.02), losses = rs.filter((r) => r < -0.02);
    let cum = 0, peak = 0, maxDd = 0, streak = 0, maxStreak = 0;
    const curve = [], yearly = new Map();
    for (const t of closed) {
      cum += t.r;
      peak = Math.max(peak, cum);
      maxDd = Math.max(maxDd, peak - cum);
      if (t.r < -0.02) { streak += 1; maxStreak = Math.max(maxStreak, streak); }
      else if (t.r > 0.02) streak = 0;
      curve.push([t.exit_time, cum]);
      const y = FX.local(t.exit_time).year;
      const e = yearly.get(y) || { year: y, trades: 0, r: 0 };
      e.trades += 1; e.r += t.r;
      yearly.set(y, e);
    }
    const mid = start + (end - start) / 2;
    const firstH = closed.filter((t) => t.exit_time < mid).map((t) => t.r);
    const secondH = closed.filter((t) => t.exit_time >= mid).map((t) => t.r);
    const longs = closed.filter((t) => t.dir === 1).map((t) => t.r);
    const shorts = closed.filter((t) => t.dir === -1).map((t) => t.r);
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    const avg = sum(rs) / n;
    const pf = losses.length ? sum(wins) / Math.abs(sum(losses)) : Infinity;
    const avgFirst = firstH.length ? sum(firstH) / firstH.length : 0;
    const avgSecond = secondH.length ? sum(secondH) / secondH.length : 0;
    const step = Math.max(1, Math.floor(curve.length / 150));
    const points = curve.filter((_, k) => k % step === 0);
    const last = curve[curve.length - 1];
    if (points[points.length - 1] !== last) points.push(last);

    const risk = FX.STATS_RISK_PCT;
    let verdict, label;
    if (n < 30) { verdict = "few"; label = "Недостатъчно сделки"; }
    else if (avg >= 0.08 && pf >= 1.15 && avgFirst > 0 && avgSecond > 0) { verdict = "good"; label = "Силна"; }
    else if (avg > 0) { verdict = "weak"; label = "Слаба"; }
    else { verdict = "bad"; label = "Не работи"; }

    return Object.assign(base, {
      win_rate: R((wins.length / n) * 100, 1),
      breakeven_rate: R(((n - wins.length - losses.length) / n) * 100, 1),
      avg_r: R(avg, 3),
      avg_win: wins.length ? R(sum(wins) / wins.length, 2) : 0,
      avg_loss: losses.length ? R(sum(losses) / losses.length, 2) : 0,
      profit_factor: pf === Infinity ? null : R(pf, 2),
      total_r: R(cum, 1),
      max_dd_r: R(maxDd, 1),
      max_dd_pct: R(maxDd * risk, 1),
      return_pct: R(cum * risk, 1),
      return_pct_year: R((cum * risk) / years, 1),
      max_losing_streak: maxStreak,
      per_month: R(n / (years * 12), 1),
      avg_first: R(avgFirst, 3),
      avg_second: R(avgSecond, 3),
      longs: { trades: longs.length, avg_r: longs.length ? R(sum(longs) / longs.length, 3) : null },
      shorts: { trades: shorts.length, avg_r: shorts.length ? R(sum(shorts) / shorts.length, 3) : null },
      curve: points.map(([t, v]) => [t, R(v, 2)]),
      yearly: [...yearly.values()].sort((a, b) => a.year - b.year).map((y) => Object.assign({}, y, { r: R(y.r, 1), pct: R(y.r * risk, 1) })),
      verdict, verdict_label: label,
    });
  }

  FX.bt = { addBars, prepare, process, simulate, summarize, clean, closeAll, take, finish };
})(self.FX = self.FX || {});
