/* Сглобява всичко: графики от данните, пускане на стратегиите, статистика и сигнали. */
(function (FX) {
  "use strict";
  const RECENT_DAYS = 14;

  // Часовете следват Ню Йорк, затова зимата и лятото се сменят сами.
  FX.marketStatus = function (now) {
    const open = FX.marketOpenAt(now), goldBreak = open && FX.goldBreakAt(now);
    return { open, gold_break: goldBreak, label: !open ? "Пазарът е затворен (уикенд)" : goldBreak ? "Пазарът е отворен · златото е в дневна почивка" : "Пазарът е отворен" };
  };

  class Engine {
    /** prices: {EURUSD: {M15: [[t,o,h,l,c],...], H1: [...], D1: [...]}, ...}; quotes: {EURUSD: {price, time}} */
    constructor(prices, quotes = {}, opts = {}) {
      this.prices = prices;
      this.quotes = quotes;
      this.launch = opts.launch || 0;
      this.costs = FX.costs ? FX.costs.normalize(opts.costs) : null;
      this.keepIds = new Set(opts.keepIds || []);
      this.series = {};
    }

    build(now) {
      this.now = now;
      const S = (this.series = {});
      for (const pair of FX.PAIR_KEYS) {
        const raw = this.prices[pair];
        if (!raw) continue;
        const cleaned = { M15: FX.cleanWeekend("M15", raw.M15 || []), H1: FX.cleanWeekend("H1", raw.H1 || []), D1: FX.cleanWeekend("D1", raw.D1 || []) };
        cleaned.H4 = FX.dropOpenH4(FX.toH4(cleaned.H1), cleaned.H1);
        const mine = {};
        for (const tf of FX.TF_KEYS) {
          const sec = FX.TIMEFRAMES[tf].seconds;
          const bars = cleaned[tf].filter((b) => b[0] + sec <= now);
          if (bars.length > 120) {
            const series = new FX.Series(pair, tf, bars);
            if (this.costs) series.info = FX.costs.info(pair, this.costs);
            mine[tf] = S[pair + "|" + tf] = series;
          }
        }
        for (const s of Object.values(mine)) s.peers = mine;
      }
      return this;
    }

    get(pair, tf) { return this.series[pair + "|" + tf]; }

    /** Всички сделки на една стратегия в една графика (за всички нейни инструменти). */
    trades(strat, tf, pairs) {
      const out = [], starts = [], ends = [], omitted = {};
      for (const pair of pairs || strat.pairs || FX.PAIR_KEYS) {
        const s = this.get(pair, tf);
        if (!s) continue;
        starts.push(s.t[60]);
        ends.push(s.t[s.n - 1] + s.sec);
        s.memo = {};
        const subs = [[this.get(pair, "M15"), 900], [this.get(pair, "H1"), 3600]];
        const simulated = FX.bt.simulate(s, strat, this.now, subs);
        if (simulated.omitted_days !== undefined) omitted[pair] = simulated.omitted_days;
        for (const tr of simulated) {
          this.catchUp(tr, s, strat);
          tr.strategy = `${strat.key}-${tf}`;
          tr.live = this.isLive(tr);
          out.push(FX.bt.clean(tr));
        }
      }
      return { trades: out, start: starts.length ? Math.min(...starts) : 0, end: ends.length ? Math.max(...ends) : 0, ...(Object.keys(omitted).length ? { data_quality: { omitted_days: omitted } } : {}) };
    }

    isLive(tr) {
      if (!this.launch || tr.signal_time < this.launch) return false;
      const market = tr.order_type === "market" || (tr.orders && tr.orders[0] && tr.orders[0].type === "market");
      return market || !tr.fill_time || tr.fill_time - tr.signal_time >= FX.PUBLISH_DELAY;
    }

    /** Довежда текущите сигнали до последната цена (по най-подробните свещи и текущата котировка). */
    catchUp(tr, s, strat) {
      if (tr.status !== "pending" && tr.status !== "open") return;
      let fine = this.get(s.pair, "M15"), step = 900;
      if (!fine) { fine = this.get(s.pair, "H1"); step = 3600; }
      if (!fine) return;
      const info = s.info, pip = s.pip, ex = strat.exit, start = s.t[s.n - 1] + s.sec;
      for (let j = 0; j < fine.n; j++) {
        if (fine.t[j] < start) continue;
        if (tr.exit_next_open && tr.status === "open") { FX.bt.closeAll(tr, info, pip, fine.o[j], fine.t[j], "reverse"); return; }
        FX.bt.process(tr, info, pip, fine.t[j], fine.o[j], fine.h[j], fine.l[j], fine.c[j], step, ex);
        if (tr.status !== "pending" && tr.status !== "open") return;
      }
      const q = this.quotes[s.pair];
      const lastEnd = fine.t[fine.n - 1] + step;
      if (q && q.price && q.time > lastEnd && !tr.exit_next_open) {
        const last = fine.c[fine.n - 1];
        FX.bt.process(tr, info, pip, lastEnd, last, Math.max(last, q.price), Math.min(last, q.price), q.price, Math.max(0, this.now - lastEnd), ex);
      }
      if (tr.status === "pending" && tr.valid_until <= this.now) Object.assign(tr, { status: "cancelled", reason: "expired", exit_time: tr.valid_until });
    }

    /** Карта на стратегията за сайта: статистика, по двойки, последни сделки, на живо. */
    entry(strat, tf, res) {
      const { trades, start, end } = res;
      const provisional = FX.isProvisional ? FX.isProvisional(strat, tf) : !!strat.provisional;
      const stats = FX.bt.summarize(trades, start, end);
      if (provisional && stats.verdict === "good") { stats.verdict = "weak"; stats.verdict_label = "Слаба"; }
      // Отделна оценка за всеки инструмент: стратегия може да е „Силна“ за златото и да губи на EUR/USD.
      const perPair = [];
      for (const pair of FX.PAIR_KEYS) {
        const own = trades.filter((t) => t.pair === pair && t.status === "closed");
        if (own.length) perPair.push(FX.pairRow(own, pair, start, end, provisional));
      }
      const closed = trades.filter((t) => t.status === "closed").sort((a, b) => a.exit_time - b.exit_time);
      const recent = closed.slice(-12).reverse().map((t) => ({ pair: t.pair, dir: t.dir, signal_time: t.signal_time, exit_time: t.exit_time, r: t.r, reason: t.reason, id: t.id }));
      const liveRs = closed.filter((t) => t.live).map((t) => t.r);
      const tfc = FX.TIMEFRAMES[tf];
      return {
        id: `${strat.key}-${tf}`, key: strat.key, tf, tf_label: tfc.label, style: strat.style || tfc.style,
        name: strat.name, short: strat.short, rules: strat.rules, source: strat.source, origin: strat.origin,
        approx: !!strat.approx, url: strat.url || null, note: strat.note || null, exit_rules: strat.exit_rules || null,
        version: strat.version || strat.spec?.version || 1, provisional,
        retired: FX.isRetired ? FX.isRetired(strat, tf) : false,
        ...(this.costs ? { cost_model: FX.costs.fingerprint(this.costs), cost_profile: this.costs } : {}),
        ...(res.data_quality ? { data_quality: res.data_quality } : {}),
        session: strat.session, group: strat.group || "", pairs: strat.pairs || FX.PAIR_KEYS,
        stats, per_pair: perPair, recent,
        live: { trades: liveRs.length, win_rate: liveRs.length ? FX.round((liveRs.filter((r) => r > 0.02).length / liveRs.length) * 100, 1) : null, total_r: FX.round(liveRs.reduce((a, b) => a + b, 0), 2), since: this.launch },
      };
    }

    /** Сигнали за сайта: текущите + приключилите в последните 14 дни. */
    signals(strat, tf, trades) {
      const keep = ["id", "pair", "tf", "status", "orders", "signal_time", "valid_until", "why", "reason", "exit_time", "dir", "entry", "stop", "stop0", "tp1", "tp2", "fill_price", "fill_time", "half", "tp1_time", "r", "parts", "order_type", "live", "cost_r", "cost_breakdown", "gross_r"];
      const out = [];
      for (const tr of trades) {
        const tracked = this.keepIds.has(tr.id);
        if (FX.isRetired?.(strat, tf) && !tracked) continue;
        const current = tr.status === "pending" || tr.status === "open";
        if (!tracked && !current && !((tr.exit_time || 0) >= this.now - RECENT_DAYS * 86400)) continue;
        const x = {};
        for (const k of keep) if (k in tr) x[k] = tr[k];
        Object.assign(x, { strategy: `${strat.key}-${tf}`, strategy_name: strat.name, version: strat.version || strat.spec?.version || 1,
          retired: FX.isRetired?.(strat, tf) || false, cost_model: this.costs ? FX.costs.fingerprint(this.costs) : "model-v1",
          tf_label: FX.TIMEFRAMES[tf].label, style: strat.style || FX.TIMEFRAMES[tf].style, pair_name: FX.PAIRS[tr.pair].name });
        out.push(x);
      }
      return out;
    }

    pairsInfo() {
      const out = {};
      for (const pair of FX.PAIR_KEYS) {
        const info = this.costs ? FX.costs.info(pair, this.costs) : FX.PAIRS[pair], d1 = this.get(pair, "D1"), q = this.quotes[pair] || {};
        const prev = d1 ? d1.c[d1.n - 1] : null, price = q.price || prev;
        out[pair] = {
          name: info.name, pip: info.pip, digits: info.digits, spread: info.spread, costs: info.costs || null, price, price_time: q.time || null,
          change_pct: price && prev ? FX.round(((price - prev) / prev) * 100, 2) : null,
        };
      }
      return out;
    }

    /** Пуска списък от стратегии [{strat, tf}] и връща карти + сигнали. onProgress(готови, общо). */
    run(list, onProgress) {
      const entries = [], signals = [];
      list.forEach(({ strat, tf }, k) => {
        const res = this.trades(strat, tf);
        if (res.start) {
          entries.push(this.entry(strat, tf, res));
          signals.push(...this.signals(strat, tf, res.trades));
        }
        if (onProgress) onProgress(k + 1, list.length);
      });
      signals.sort((a, b) => ((a.status === "pending" || a.status === "open") ? 0 : 1) - ((b.status === "pending" || b.status === "open") ? 0 : 1) || b.signal_time - a.signal_time);
      return { strategies: entries, signals, pairs: this.pairsInfo(), market: FX.marketStatus(this.now), common_rules: FX.COMMON_RULES };
    }
  }

  FX.Engine = Engine;
})(self.FX = self.FX || {});
