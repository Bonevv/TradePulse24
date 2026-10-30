/* Версии и архив на вградените правила. Старите сигнали запазват своята стратегия. */
(function (FX) {
  "use strict";
  FX.RELEASE = "5.2.1";
  const retired = {"lib_golden_cross": ["D1"], "lib_macd_psar_ema": ["M15"], "lib_rsi_30_70": ["H1"], "lib_stoch": ["H1"], "lib_stoch_rsi_macd": ["M15", "H1"], "lib_cci": ["H1", "H4"], "lib_wpr": ["H1"], "lib_bb_revert": ["H1"], "lib_pinbar": ["D1"], "otskok_ma": ["H1"], "graal": ["H4"], "fake2b": ["H1", "H4", "D1"], "dmi": ["H4", "D1"], "bb_rsi": ["M15", "H1"], "ema_pullback": ["H1"], "lib_ema_htf": ["H1"]};
  const added = {"lib_ema_9_21": ["D1"], "lib_supertrend_ema": ["D1"], "lib_triple_supertrend": ["H4"], "lib_psar_ema": ["D1"], "lib_ssl": ["D1"], "lib_heikin_ema": ["H4"], "lib_turtle_55": ["H4"], "lib_bb_breakout": ["D1"], "lib_squeeze_break": ["D1"], "lib_momentum": ["D1"], "lib_donchian_trend": ["H4", "D1"], "lib_ema_pullback_trend": ["H4"], "lib_rsi_breakout": ["H4", "D1"], "lib_cci_trend": ["H4", "D1"], "lib_stoch_trend": ["H4", "D1"], "lib_psar_adx": ["D1"], "lib_macd_trend": ["H4", "D1"], "lib_triple_ema": ["H4", "D1"], "lib_kijun_trend": ["H4"], "lib_ema_htf": ["H1", "H4"], "lib_keltner_trend": ["H4", "D1"], "lib_adx_ema": ["D1"], "lib_ha_trend": ["H4"]};
  for (const strat of FX.CODED.concat(FX.LIBRARY)) {
    strat.retired_tfs = retired[strat.key] || [];
    strat.provisional_tfs = added[strat.key] || [];
  }
  FX.isRetired = (strat, tf) => !!strat && (strat.retired === true || (strat.retired_tfs || []).includes(tf));
  FX.isProvisional = (strat, tf) => !!strat && (!!strat.provisional || (strat.provisional_tfs || []).includes(tf));

  FX.DAY_REVISIONS = [];
  for (const previous of FX.REVISIONS || []) {
    const tfs = previous.tfs.filter((tf) => FX.TIMEFRAMES[tf].style === "day");
    if (!tfs.length) continue;
    previous.retired_tfs = [...new Set([...(previous.retired_tfs || []), ...tfs])];
    const correction = { ...previous, key: "day_v3_" + previous.key, name: previous.name + " · дневен лимит", tfs,
      version: 3, retired_tfs: [], strict_daily_fills: true, parent_key: previous.key,
      hypothesis: "Дневният лимит брои и вход, който е приключил в същата свещ.",
      changes: ["Най-много един изпълнен модел на ден, включително при стоп или цел в свещта на входа."],
      rules: [...previous.rules, "Входът се брои към дневния лимит и ако е затворен в същата свещ."],
      note: "Дневна поправка, версия 3. Версия 2 остава в архива със старите си изпълнения и резултати.",
    };
    FX.DAY_REVISIONS.push(correction);
  }
  FX.RESEARCH.push(...FX.DAY_REVISIONS);

  const parent = FX.LIBRARY.find((s) => s.key === "lib_ema_htf");
  if (parent) {
    const day = { ...parent, key: "rev_ema_htf_day", name: "EMA 9/21 с дневен филтър · дневен изход", tfs: ["H1"],
      version: 2, provisional: true, provisional_tfs: [], retired_tfs: [], parent_key: parent.key,
      origin: "research", group: "За тест", spec: null, session: "site", close_hour_day: 22,
      pending_close_hour_day: 21, max_per_day_day: 1, require_session_close: true, strict_expiry: true, strict_daily_fills: true,
      hypothesis: "H1 вариантът приключва в същия ден. H4 запазва суинг правилата си.",
      changes: ["Сигнали между 08:00 и 18:00 Europe/Sofia.", "Най-много един вход дневно; изход до 22:00."],
      short: "EMA 9/21 по дневната посока, с изход до края на деня.",
      rules: [...parent.rules, "Нов сигнал между 08:00 и 18:00 Europe/Sofia; най-много един вход дневно."],
      exit_rules: [...parent.exit_rules, "Останалата позиция се затваря до 22:00 Europe/Sofia."],
      note: "Дневна преработка на H1. Старият вариант остава в архива за вече следените сигнали.",
    };
    day.fn = (s, i) => s.hour[i] >= 8 && s.hour[i] < 18 ? parent.fn(s, i) : null;
    FX.RESEARCH.push(day);
  }

  FX.decorateEntry = function (entry, strat) {
    if (!entry || !strat) return entry;
    const provisional = FX.isProvisional(strat, entry.tf);
    return { ...entry, retired: FX.isRetired(strat, entry.tf), provisional,
      version: entry.version || 1,
      stats: { ...entry.stats, ...(provisional && entry.stats?.verdict === "good" ? { verdict: "weak", verdict_label: "Слаба" } : {}) },
      per_pair: (entry.per_pair || []).map((row) => provisional && row.verdict === "good"
        ? { ...row, historical_verdict: "good", verdict: "weak", verdict_label: "Слаба" } : row),
    };
  };
  /* Измерването за вход след сигнала идва с каталога. Записан по-рано резултат за същата версия
     го няма, затова се взема от каталога: правилата са същите, а то е по историята. */
  function withTiming(entry, base) {
    if (!base || (entry.version || 1) !== (base.version || 1) || !(entry.per_pair || []).some((row) => !row.timing)) return entry;
    return { ...entry, per_pair: entry.per_pair.map((row) => {
      if (row.timing) return row;
      const timing = (base.per_pair || []).find((p) => p.pair === row.pair)?.timing;
      return timing ? { ...row, timing } : row;
    }) };
  }
  FX.mergeResults = function (saved, bundled, catalog) {
    const entries = { ...(bundled?.entries || {}) };
    for (const [id, entry] of Object.entries(saved?.entries || {})) {
      const base = entries[id], savedEnd = entry.pair_review?.data_end || entry.stats?.end || 0;
      const baseEnd = base?.pair_review?.data_end || base?.stats?.end || 0;
      if (!base || entry.origin === "custom" || id.startsWith("my_") || savedEnd > baseEnd
        || savedEnd === baseEnd && ((entry.version || 1) > (base.version || 1) || entry.pair_review)) entries[id] = withTiming(entry, base);
    }
    for (const [id, entry] of Object.entries(entries)) if (catalog[entry.key]) entries[id] = FX.decorateEntry(entry, catalog[entry.key]);
    return { ...(saved || {}), entries, published: saved?.published || bundled?.recommended || [], release: bundled?.release || FX.RELEASE };
  };
})(self.FX = self.FX || {});
