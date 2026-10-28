/* Едни и същи проверки за оригиналите, преработките и отделните инструменти. */
(function (FX) {
  "use strict";
  const compact = (s) => Object.fromEntries(["trades", "avg_r", "profit_factor", "total_r", "max_dd_r", "win_rate"].filter((k) => s[k] !== undefined).map((k) => [k, s[k]]));
  FX.evaluate = function (trades, start, end) {
    const closed = trades.filter((t) => t.status === "closed"), cutoff = Math.floor(start + .7 * (end - start));
    const summary = (list, a = start, b = end) => compact(FX.bt.summarize(list, a, b));
    const stress = closed.map((t) => {
      const info = FX.PAIRS[t.pair], risk = Math.abs(t.fill_price - t.stop0);
      return { ...t, r: t.r - info.spread * info.pip / risk };
    });
    const lastYear = new Date((end - 1) * 1000).getUTCFullYear(), years = [];
    for (let year = lastYear - 2; year <= lastYear; year++) {
      const a = Date.UTC(year, 0, 1) / 1000, b = Date.UTC(year + 1, 0, 1) / 1000;
      years.push({ year, ...summary(closed.filter((t) => t.signal_time >= a && t.exit_time < b), Math.max(a, start), Math.min(b, end)) });
    }
    return { full: summary(closed), training: summary(closed.filter((t) => t.exit_time < cutoff), start, cutoff),
      holdout: summary(closed.filter((t) => t.signal_time >= cutoff), cutoff, end), stress: summary(stress), years, cutoff };
  };
  FX.assessPair = function (review, provisional) {
    const { full: f, training: a, holdout: b, stress, years } = review;
    if (f.trades < 30 || a.trades < 15 || b.trades < 10) return { status: "few", allowed: false, label: "Малко данни", reason: "Нужни са поне 30 сделки общо, 15 в първия и 10 в последния период." };
    if (!(f.avg_r > 0)) return { status: "bad", allowed: false, label: "Отрицателен резултат", reason: "Общият резултат след моделния спред е отрицателен или нулев." };
    const pf = f.profit_factor === null ? Infinity : f.profit_factor;
    if (!(a.avg_r > 0 && b.avg_r > 0 && stress.avg_r > 0 && f.avg_r >= .08 && pf >= 1.1)) return { status: "unstable", allowed: false, label: "Неустойчив резултат", reason: "Не покрива положителни два периода, поне 0.08R средно, PF 1.10 и положителен резултат при удвоен моделен разход." };
    const recent = years.filter((y) => y.trades >= 10);
    const suitable = !provisional && f.trades >= 60 && a.trades >= 30 && b.trades >= 20 && b.avg_r >= .08 && pf >= 1.2 && recent.length >= 2 && recent.every((y) => y.avg_r > 0);
    return suitable ? { status: "suitable", allowed: true, label: "Подходящ в теста", reason: "Покрива двата периода, разходите и поне две от последните три години с достатъчно сделки. Историческа оценка, без гаранция занапред." }
      : { status: "watch", allowed: true, label: "За наблюдение", reason: provisional ? "Положителни диагностични периоди и проверка на разходите; правилата са преработвани по вече разглеждана история." : "Покрива основната проверка, но извадката или отделните години още не дават по-силно потвърждение." };
  };
  FX.reviewEntry = function (entry, strat, res, testedAt) {
    entry.evaluation = FX.evaluate(res.trades, res.start, res.end);
    entry.pair_review = { schema: 1, version: strat.version || strat.spec?.version || 1, tested_at: testedAt, data_end: res.end };
    entry.per_pair = (strat.pairs || FX.PAIR_KEYS).map((pair) => {
      const report = FX.evaluate(res.trades.filter((t) => t.pair === pair), res.start, res.end);
      return { pair, name: FX.PAIRS[pair].name, ...report.full, review: report, assessment: FX.assessPair(report, !!strat.provisional) };
    });
    return entry;
  };
  FX.pairChoice = function (entry, pair, now) {
    const row = entry?.per_pair?.find((p) => p.pair === pair);
    if (!row) return { status: "few", allowed: false, label: "Няма тест за инструмента", reason: "Нужен е тест от Лабораторията върху цялата история." };
    const end = entry.pair_review?.data_end || entry.stats?.end;
    if (!end || now - end > 90 * 86400 || end > now + 60) return { status: "stale", allowed: false, label: "Нужен нов тест", reason: "Ценовата история на оценката е по-стара от 90 дни или има невалидно време." };
    if (entry.pair_review?.schema === 1 && row.assessment && entry.pair_review.version === (entry.version || 1)) return row.assessment;
    const allowed = row.trades >= 30 && row.avg_r >= .08;
    return { status: "unverified", allowed, label: "Непълна архивна проверка", reason: allowed ? "Положителен общ резултат и поне 30 сделки. Липсват отделните периоди и проверката на разходите; пусни нов тест." : "Архивът не покрива поне 30 сделки и 0.08R средно за този инструмент. Пусни нов тест за пълна оценка." };
  };
})(self.FX = self.FX || {});
