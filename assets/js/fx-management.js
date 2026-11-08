/* Нивата и действията се четат от изпълнения модел, без нови TP или местене по предположение. */
(function (FX) {
  "use strict";
  FX.managementPlan = function (sig, opts = {}) {
    const unfilled = ["pending", "cancelled"].includes(sig.status);
    const actions = [], directions = unfilled ? sig.orders || [] : [{ dir: sig.dir, entry: sig.fill_price ?? sig.entry, stop: sig.stop0 ?? sig.stop }];
    const initial = directions.map((o) => ({ dir: o.dir, entry: o.entry, stop: o.stop,
      targets: unfilled ? (o.targets || []).map((p, i) => ({ weight: p.w, level: p.level ?? null, order: opts.tpModes?.[i] === true }))
        : (sig.parts || []).map((p, i) => ({ weight: p.w, order: opts.tpModes?.[i] === true, level: i === 0 ? sig.tp1 ?? null : i === 1 ? sig.tp2 ?? null : null })) }));
    const current = (sig.parts || []).map((p, i) => ({ index: i, order: opts.tpModes?.[i] === true, weight: p.w, level: p.tp ?? null, closed: p.px !== null && p.px !== undefined, filled: p.px, at: p.closed_at }));
    if (!opts.current || !opts.fresh) return { initial, current, stop: sig.stop, actions, stale: true };
    if (sig.status === "cancelled") actions.push({ code: "cancel" });
    if (sig.status === "closed") actions.push({ code: "close", at: sig.exit_time, reason: sig.reason });
    if (sig.status === "open") {
      const d = sig.dir, reference = Number.isFinite(opts.actualStop) ? opts.actualStop : sig.stop0;
      if (Number.isFinite(sig.stop) && Number.isFinite(reference) && (sig.stop - reference) * d > 1e-9)
        actions.push({ code: "stop", from: reference, to: sig.stop });
      else if (Number.isFinite(sig.stop) && (sig.stop - reference) * d < -1e-9)
        actions.push({ code: "keep-stop", level: reference });
      for (const p of current) {
        if (p.closed && current.some((other) => !other.closed)) actions.push({ code: "partial", index: p.index, weight: p.weight, at: p.at, filled: p.filled });
        const start = initial[0]?.targets[p.index]?.level;
        if (!p.closed && Number.isFinite(p.level) && Number.isFinite(start) && Math.abs(start - p.level) > 1e-9)
          actions.push({ code: p.order ? "target" : "rule-target", index: p.index, from: start, to: p.level });
      }
    }
    return { initial, current, stop: sig.stop ?? sig.stop0, actions, stale: false };
  };
})(self.FX = self.FX || {});
