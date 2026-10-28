/* Преработки с отделни имена и резултати. Оригиналите остават за сравнение.
   Допусканията са записани в docs/strategy-revisions.md преди измерването. */
(function (FX) {
  "use strict";
  const finite = Number.isFinite;
  const noTP = { parts: [[1, null]] };
  const parents = Object.fromEntries(FX.CODED.concat(FX.LIBRARY, FX.RESEARCH).map((s) => [s.key, s]));
  function slope(s, i, d, n = 50, lookback = 5) {
    const ma = s.get("ema", n);
    return i >= n + lookback && finite(ma[i]) && finite(ma[i - lookback]) && (s.c[i] - ma[i]) * d > 0 && (ma[i] - ma[i - lookback]) * d > 0;
  }
  function higher(s, i, d, n = 50) {
    const tf = s.tf === "M15" ? "H1" : s.tf === "H1" ? "H4" : "D1";
    const peer = s.peer(tf), k = peer ? s.align(tf)[i] : -1;
    return !!peer && slope(peer, k, d, n);
  }
  const strength = (s, i, minimum = 18, maximum = 60) => finite(s.adx[i]) && s.adx[i] >= minimum && s.adx[i] <= maximum;
  const aligned = (s, i, d) => {
    const fast = s.get("ema", 50), slow = s.get("ema", 200);
    return finite(slow[i]) && (fast[i] - slow[i]) * d > 0 && slope(s, i, d, 200);
  };
  const directionalBar = (s, i, d) => (s.c[i] - s.o[i]) * d > 0;
  const inRange = (s, i) => finite(s.adx[i]) && s.adx[i] < 20 && Math.abs(s.get("ema", 50)[i] - s.get("ema", 50)[i - 5]) <= .5 * s.atr[i];

  function fvg(s, i) {
    const hourly = s.peer("H1"), k = hourly ? s.align("H1")[i] : -1;
    if (!hourly || k < 205) return null;
    const e50 = hourly.get("ema", 50), e200 = hourly.get("ema", 200);
    const d = e50[k] > e200[k] ? 1 : -1;
    if (!slope(hourly, k, d, 50)) return null;
    const used = s.memo.revised_fvg || (s.memo.revised_fvg = new Set());
    for (let age = 2; age <= 20; age++) {
      const m = i - age, left = m - 1, right = m + 1;
      if (left < 0 || used.has(s.t[m])) continue;
      const top = d === 1 ? s.l[right] : s.l[left], bottom = d === 1 ? s.h[left] : s.h[right];
      const width = top - bottom, range = s.h[m] - s.l[m], a = s.atr[i];
      if (width < .25 * a || width > 2 * a || range < s.atr[m] || Math.abs(s.c[m] - s.o[m]) < .6 * range || !directionalBar(s, m, d)) continue;
      const entry = (top + bottom) / 2, stop = (d === 1 ? bottom : top) - d * .5 * a;
      if ((s.c[i] - entry) * d <= 0) continue;
      let touched = false;
      for (let j = right + 1; j <= i; j++) if (d === 1 ? s.l[j] <= entry : s.h[j] >= entry) { touched = true; break; }
      if (touched) continue;
      used.add(s.t[m]);
      return [[{ dir: d, type: "limit", entry, stop, anchor_stop: true }], "Чакаме ретест на средата на непокрита FVG по потвърдения H1 тренд. Входът е вътре в зоната, а стопът е отвъд нея с ATR запас."];
    }
    return null;
  }
  function elderMacro(s, i) {
    if (s.tf !== "D1") {
      const p = s.peer("D1"), k = p ? s.align("D1")[i] : -1, ma = p ? p.get("ema", 13) : [];
      return k > 0 && finite(ma[k - 1]) ? Math.sign(ma[k] - ma[k - 1]) : 0;
    }
    if (!s._cache.revision_weekly) {
      const weeks = [];
      for (let j = 0; j < s.n; j++) {
        const day = Math.floor(s.t[j] / 86400), weekday = (new Date(s.t[j] * 1000).getUTCDay() + 6) % 7, start = (day - weekday) * 86400;
        if (!weeks.length || weeks[weeks.length - 1].start !== start) weeks.push({ start, close: s.c[j] });
        else weeks[weeks.length - 1].close = s.c[j];
      }
      s._cache.revision_weekly = { weeks, ema: FX.ind.ema(weeks.map((w) => w.close), 13) };
    }
    const { weeks, ema } = s._cache.revision_weekly;
    let k = weeks.length - 1;
    while (k >= 0 && weeks[k].start + 5 * 86400 > s.t[i] + s.sec) k--;
    return k > 0 && finite(ema[k - 1]) ? Math.sign(ema[k] - ema[k - 1]) : 0;
  }
  function elderExit(st, s, i) {
    if (elderMacro(s, i) === -st.dir) return ["close", "По-високата графика смени посоката"];
    st.revision_peak = Math.max(st.revision_peak ?? st.fill_price * st.dir, s.c[i] * st.dir);
    const next = st.dir * st.revision_peak - st.dir * 2 * s.atr[i];
    if ((next - st.stop) * st.dir > 0 && (s.c[i] - next) * st.dir > 0) st.stop = next;
    return null;
  }

  const plans = [
    { parent: "fvg_gold", tfs: ["M15"], fn: fvg, short: "Зона с реален размер спрямо ATR и задължителна H1 посока.",
      hypothesis: "Точките позволяват контратрендови входове, фиксираните долари сменят значението си с волатилността, а ранният стоп на входа може да прекъсва ретеста.",
      changes: ["Задължителни H1 EMA 50/200 и наклон на EMA 50; импулсна свещ с тяло поне 60% от диапазона и диапазон поне 1 ATR.", "FVG между 0.25 и 2 ATR, вход в средата на зоната и стоп на 0.5 ATR отвъд нея. Предишен ретест на средата обезсилва зоната.", "Поръчката важи четири M15 свещи. Целта остава 1.5R; премахнато е ранното местене на стопа."],
      settings: { valid_bars: 4, exit: { parts: [[1, 1.5]] }, manage: null },
      exit_rules: ["Фиксиран TP: 1.5R. Стоп отвъд FVG с 0.5 ATR запас; без автоматичен стоп на входа.", "Затваряне до 22:00 Europe/Sofia."] },
    { parent: "st_kumo", tfs: ["H1"], test: (s, i, d) => higher(s, i, d) && strength(s, i, 18, 40),
      hypothesis: "Облакът и Supertrend на една графика могат да обръщат посоката заедно в шумен пазар.",
      changes: ["Посоката трябва да се потвърди от завършена H4 EMA 50 и петсвещния ѝ наклон.", "H1 ADX е между 18 и 40; дневният вариант вече приключва до 22:00."] },
    { parent: "lib_ema_9_21", tfs: ["H4"], test: (s, i, d) => slope(s, i, d, 200),
      hypothesis: "Пресичането 9/21 само по себе си не различава корекция от начало на тренд.", changes: ["Приема се само пресичане по цената и наклона на EMA 200 за пет свещи. Обратното пресичане остава изход."] },
    { parent: "lib_macd_zero", tfs: ["H4", "D1"], test: (s, i, d) => slope(s, i, d, 200), transform: (o, s, i) => ({ ...o, stop: o.entry - o.dir * 3 * s.atr[i] }),
      hypothesis: "Положението спрямо EMA 200 не гарантира наклон; стоп на 2 ATR може да прекъсва по-дълъг тренд.", changes: ["EMA 200 трябва да има същата посока за пет свещи.", "Първоначалният и плаващият стоп са 3 ATR вместо 2 ATR; няма фиксиран TP."],
      exit_rules: ["Първоначален стоп: 3 ATR(14). Следва най-добрата цена на същото разстояние и само се затяга.", "Без фиксиран TP; максимум 500 свещи."] },
    { parent: "lib_supertrend", tfs: ["H4"], test: (s, i, d) => slope(s, i, d) && strength(s, i, 20),
      hypothesis: "Смяната на Supertrend в диапазон води до поредица от обратни сигнали.", changes: ["H4 ADX поне 20 и цена/наклон по EMA 50. Линията на Supertrend и обратният му сигнал остават изход."] },
    { parent: "lib_supertrend_ema", tfs: ["H4"], test: (s, i, d) => higher(s, i, d) && strength(s, i),
      hypothesis: "H4 цена над EMA 200 може да противоречи на завършения дневен тренд.", changes: ["Завършената D1 цена и наклонът на D1 EMA 50 потвърждават посоката; H4 ADX поне 18."] },
    { parent: "lib_adx_di", tfs: ["D1"], test: (s, i, d) => s.adx[i] > s.adx[i - 1] && aligned(s, i, d),
      hypothesis: "ADX над 25 може вече да спада, а DI пресичането да е в края на движението.", changes: ["ADX трябва да расте; EMA 50/200, цената и наклонът на EMA 200 трябва да са в същата посока."] },
    { parent: "lib_squeeze_break", tfs: ["H4"], test: (s, i, d) => { const on = s.get("sqz")[0]; return !on[i] && on[i - 1] && slope(s, i, d) && Math.abs(s.c[i] - s.o[i]) >= .5 * (s.h[i] - s.l[i]) && directionalBar(s, i, d); },
      hypothesis: "Условие „имало е свиване скоро“ допуска закъснели сигнали след първия пробив.", changes: ["Само първата свещ след освобождаване на свиването; тя трябва да има тяло поне половината диапазон по посоката на EMA 50."] },
    { parent: "lib_ichi_tk", tfs: ["H4", "D1"], test: (s, i, d) => { const [a, b, , kijun] = s.get("ichi"); return finite(kijun[i - 5]) && (kijun[i] - kijun[i - 5]) * d > 0 && (a[i] - b[i]) * d > 0; },
      hypothesis: "Tenkan/Kijun може да се пресече до плосък Kijun и облак с обратна посока.", changes: ["Kijun трябва да има наклон по сделката за пет свещи; текущите, вече изместени линии на облака са подредени в същата посока."] },
    { parent: "lib_rsi2", tfs: ["H4"], test: (s, i, d) => slope(s, i, d, 200, 20) && strength(s, i, 0, 25),
      hypothesis: "Екстремен RSI(2) може да се задържи при силно движение срещу кратката сделка.", changes: ["EMA 200 има същата посока за 20 свещи, а ADX е до 25. Изходът на SMA 5 се запазва."] },
    { parent: "lib_bb_revert", tfs: ["H4"], test: inRange,
      hypothesis: "Връщането в Bollinger не означава край на силен тренд.", changes: ["Само ADX под 20 и промяна на EMA 50 за пет свещи до половин ATR. Изходът остава на средната лента."] },
    { parent: "lib_ao_zero", tfs: ["H4", "D1"], test: (s, i, d) => aligned(s, i, d) && strength(s, i) && s.adx[i] > s.adx[i - 1],
      hypothesis: "Пресичането на нулата на AO може да е кратък шум в по-широк диапазон.", changes: ["EMA 50/200 и наклонът на EMA 200 са подредени по сигнала; ADX поне 18 и расте."] },
    { parent: "book_atr_london_jpy", tfs: ["M15"], test: (s, i, d) => { const p = s.peer("D1"), k = p ? s.align("D1")[i] : -1; return !!p && slope(p, k, d); },
      hypothesis: "Двупосочният пробив приема и сделки срещу завършения дневен тренд.", changes: ["Остава само посоката на завършената D1 цена и EMA 50. Изчакването за публикация и отмяната при ранно докосване се запазват."] },
    { parent: "book_elder", tfs: ["H4", "D1"], transform: (o, s, i) => ({ ...o, stop: o.entry - o.dir * 2 * s.atr[i] }),
      rules: ["Посока: наклон на завършена D1 EMA 13 за H4 или завършена седмична EMA 13 за D1.", "За покупка Bear Power е отрицателен и расте; за продажба Bull Power е положителен и спада.", "Вход при пробив на сигналната свещ. Първоначален стоп на 2 ATR от входното ниво."],
      hypothesis: "Стопът на две свещи и последващото местене на входа могат да прекъсват нормална корекция.", changes: ["Първоначален стоп 2 ATR; после се пази разстояние 2 текущи ATR от най-доброто завършено затваряне.", "Без автоматично местене на входа при +1R и без правилото за половината печалба. Обратният макротренд и максимумът 30 свещи се запазват."],
      settings: { manage: elderExit, exit: noTP }, exit_rules: ["Стоп 2 ATR при сигнала; после 2 текущи ATR от най-доброто затваряне, само в посока на затягане и от следващата свещ.", "Без фиксиран TP. Изход при обратна по-висока EMA 13 посока или след 30 свещи."] },
    { parent: "book_role_reversal", tfs: ["H1", "H4"], test: (s, i, d) => higher(s, i, d),
      hypothesis: "Локален пробив и ретест може да е корекция срещу по-голямото движение.", changes: ["За H1 е нужна завършена H4 EMA 50, а за H4 — D1 EMA 50, с цена и петсвещен наклон по сделката."] },
    { parent: "book_contraction", tfs: ["H4"], test: (s, i, d) => strength(s, i, 20) && directionalBar(s, i, d) && (d === 1 ? s.c[i] >= s.l[i] + 2 * (s.h[i] - s.l[i]) / 3 : s.c[i] <= s.l[i] + (s.h[i] - s.l[i]) / 3),
      hypothesis: "Припокриващи се свещи могат да показват липса на посока, вместо продължение.", changes: ["ADX поне 20; последната свещ е по тренда и затваря в крайната третина. Поръчката важи две свещи."], settings: { valid_bars: 2 } },
    { parent: "book_outside_close", tfs: ["D1"], test: (s, i, d) => slope(s, i, d) && s.h[i] - s.l[i] <= 2 * s.atr[i],
      hypothesis: "Външният ден може да е изтощение след голям ход, а не начало на продължение.", changes: ["Цена и наклон на EMA 50 по сигнала; диапазонът на сигналната свещ е до 2 ATR."] },
    { parent: "book_pinball", tfs: ["H1"], test: (s, i, d) => { const p = s.peer("D1"), k = p ? s.align("D1")[i] : -1; return !!p && slope(p, k, d, 200) && s.h[i] - s.l[i] <= 1.5 * s.atr[i]; },
      hypothesis: "Кратък екстремум може да даде пробив срещу дългия тренд или след вече разширен първи час.", changes: ["Посоката се потвърждава от завършена D1 EMA 200 и наклона ѝ. Първият лондонски час е до 1.5 H1 ATR."] },
    { parent: "book_nofri", tfs: ["D1"], test: (s, i) => strength(s, i, 0, 20),
      hypothesis: "Потвърдената зона не гарантира, че пазарът продължава да е в диапазон.", changes: ["Вход само при D1 ADX до 20. Границите, паузите, защитният стоп и изходът в следващата сесия се запазват."] },
    { parent: "research_kama", tfs: ["H1", "H4", "D1"], test: (s, i, d) => {
      let noise = 0; for (let j = i - 9; j <= i; j++) noise += Math.abs(s.c[j] - s.c[j - 1]);
      return noise > 0 && Math.abs(s.c[i] - s.c[i - 10]) / noise >= .3 && slope(s, i, d, 200);
    }, hypothesis: "Честите пресичания на адаптивната средна не филтрират достатъчно движението без посока.", changes: ["Efficiency Ratio за 10 свещи поне 0.30 и петсвещен наклон на EMA 200 по сигнала."] },
    { parent: "research_demarker", tfs: ["M15", "H1"], test: (s, i, d) => aligned(s, i, d) && directionalBar(s, i, d),
      hypothesis: "Връщане от крайна зона без ценово потвърждение може да е пауза в движението срещу входа.", changes: ["EMA 50/200 и наклонът на EMA 200 са по сигнала; сигналната свещ затваря по сделката. Целта 1.5R се запазва."] },
    { parent: "research_rvi", tfs: ["H1", "H4"], test: (s, i, d) => higher(s, i, d) && strength(s, i),
      hypothesis: "Импулсното пресичане на RVI може да противоречи на по-високата графика.", changes: ["Завършената H4/D1 EMA 50 и петсвещният ѝ наклон потвърждават посоката; ADX поне 18."] },
  ];
  const common = ["Допълнително: първоначален риск между 0.5 и 3 ATR и поне пет моделни спреда. Невалиден стоп се пропуска, без скрито разширяване.",
    "Дневните варианти търсят нов сигнал между 08:00 и 18:00 Europe/Sofia, най-много един изпълнен модел дневно; чакащите поръчки са най-късно до 21:00, изход до 22:00. Непълните исторически сесии се отчитат отделно."];
  FX.REVISIONS = plans.map((plan) => {
    const parent = parents[plan.parent];
    if (!parent) throw new Error("Липсва оригинал за преработка: " + plan.parent);
    const strat = { ...parent, ...plan.settings, key: "rev_" + parent.key, name: parent.name + " · преработка", tfs: plan.tfs,
      version: 2, provisional: true, spec: null, origin: "research", group: "За тест", approx: true,
      parent_key: parent.key, hypothesis: plan.hypothesis, changes: plan.changes,
      short: plan.short || plan.changes[0], rules: [...(plan.rules || (plan.fn ? [] : parent.rules)), ...plan.changes, ...common],
      exit_rules: [...(plan.exit_rules || parent.exit_rules || []), "При дневна графика: затваряне до 22:00 Europe/Sofia; ориентирите +1R/+2R не добавят нов TP."],
      note: "Собствена преработка, версия 2. Всички резултати се сравняват с оригинала. Използваната история вече е разглеждана и не е независимо потвърждение.",
      session: "site", close_hour_day: 22, pending_close_hour_day: 21, max_per_day_day: 1, require_session_close: true, strict_expiry: true,
    };
    strat.fn = (s, i) => {
      if (i < 60 || !finite(s.atr[i]) || s.atr[i] <= 0) return null;
      if (s.tfc.style === "day" && (s.hour[i] < 8 || s.hour[i] >= 18)) return null;
      const found = (plan.fn || parent.fn)(s, i);
      if (!found) return null;
      const orders = found[0].filter((o) => !plan.test || plan.test(s, i, o.dir)).map((o) => plan.transform ? plan.transform({ ...o }, s, i) : { ...o }).filter((o) => {
        const risk = (o.entry - o.stop) * o.dir;
        return finite(risk) && risk + 1e-8 >= Math.max(.5 * s.atr[i], 5 * s.info.spread * s.pip) && risk <= 3 * s.atr[i] + 1e-8;
      });
      return orders.length ? [orders, found[1] + " Преработка: " + plan.changes.join(" ")] : null;
    };
    return strat;
  });
  FX.RESEARCH = FX.RESEARCH.concat(FX.REVISIONS);
})(self.FX = self.FX || {});
