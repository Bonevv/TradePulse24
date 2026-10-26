/* Нови варианти за Лабораторията. Появяват се на сайта само след тест и изрично публикуване. */
(function (FX) {
  "use strict";
  const I = (ind, p, line) => ({ ind, p, ...(line ? { line } : {}) });
  const source = "Собствен вариант по класически индикатор; семейството присъства в EA31337.";
  const url = "https://github.com/EA31337/EA31337-strategies";
  const specs = [
    { key: "research_kama", name: "Адаптивна средна по тренда", tfs: ["H1", "H4", "D1"],
      short: "Цената пресича адаптивната средна на Кауфман по посоката на EMA 200.",
      when: [{ a: "close", op: "cross_above", b: I("kama", [10, 2, 30]) }, { a: "close", op: ">", b: I("ema", [200]) }],
      stop: { type: "atr", mult: 2, n: 14 }, exit: { parts: [[1, null]] },
      exit_when: [{ a: "close", op: "cross_below", b: I("kama", [10, 2, 30]) }] },
    { key: "research_demarker", name: "DeMarker: връщане от крайна зона", tfs: ["M15", "H1"],
      short: "DeMarker се връща над 0.30, а цената е над EMA 200. Фиксиран изход при 1.5R.",
      when: [{ a: I("demarker", [14]), op: "cross_above", b: 0.3 }, { a: "close", op: ">", b: I("ema", [200]) }],
      stop: { type: "atr", mult: 1.5, n: 14 }, exit: { parts: [[1, 1.5]] } },
    { key: "research_rvi", name: "RVI: импулс по тренда", tfs: ["H1", "H4"],
      short: "RVI пресича сигналната си линия над нулата по посоката на EMA 200.",
      when: [{ a: I("rvi", [10], "line"), op: "cross_above", b: I("rvi", [10], "signal") },
        { a: I("rvi", [10], "line"), op: ">", b: 0 }, { a: "close", op: ">", b: I("ema", [200]) }],
      stop: { type: "atr", mult: 2, n: 14 }, exit: { parts: [[1, null]] },
      exit_when: [{ a: I("rvi", [10], "line"), op: "cross_below", b: I("rvi", [10], "signal") }] },
  ];
  FX.RESEARCH = specs.map((s) => FX.build({ ...s, source, url, approx: true, group: "За тест", origin: "research",
    note: "Това е отделен вариант с изрично описани правила, а не копие на оригинален робот. Нужни са проверка върху отделен период и наблюдение занапред." }));
  const base = FX.LIBRARY.find((s) => s.key === "lib_supertrend_ema").spec;
  for (const [key, pair, name] of [["research_gold_st_ema", "XAUUSD", "Злато: Supertrend + EMA 200"], ["research_jpy_st_ema", "USDJPY", "USD/JPY: Supertrend + EMA 200"]]) {
    FX.RESEARCH.push(FX.build({ ...base, key, pairs: [pair], tfs: ["H4"], name, origin: "research", group: "За тест", approx: true,
      short: "Специализация за един инструмент на H4. За наблюдение; отделните годишни извадки още са малки.",
      note: "В прегледа на 2024, 2025 и наличната 2026 г. всеки период е положителен. Сделките са недостатъчни за потвърждение. Това е вариант на същото семейство, а не нова независима стратегия." }));
  }
})(self.FX = self.FX || {});
