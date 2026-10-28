/* Седем кандидата от Kaufman и Sadowski. Правилата са фиксирани преди теста.
   Това са наши формализации; непълните правила в източниците са описани в docs/book-candidates.md. */
(function (FX) {
  "use strict";
  const valid = Number.isFinite;
  const tick = (s) => 10 ** -s.info.digits;
  const noTP = { parts: [[1, null]] };
  const kaufman = "Perry Kaufman, Trading Systems and Methods, 5th ed.";
  const sadowski = "Roman Sadowski, 9 Advanced and Profitable Trading Strategies";
  const sourceURL = "https://dn790006.ca.archive.org/0/items/admin_pdfbooksfree_TSaM/TSaM.pdf";
  const pdfURL = "https://www.acledasecurities.com.kh/as/assets/pdf_zip/My%20Learnings%20-%20Profitable%20Trading%20Strategies.pdf";
  const protective = (d, entry, stop, type = "stop") => ({ dir: d, entry, stop, type, ...(type === "market" ? { anchor_stop: true } : {}) });
  const ready = (s, i, n = 60) => i >= n && valid(s.atr[i]) && s.atr[i] > 0;
  const trend = (s, i) => {
    const ma = s.get("ema", 50);
    if (!valid(ma[i - 5])) return 0;
    return s.c[i] > ma[i] && ma[i] > ma[i - 5] ? 1 : s.c[i] < ma[i] && ma[i] < ma[i - 5] ? -1 : 0;
  };

  function orb(s, i) {
    if (!ready(s, i) || s.weekday[i] > 4 || s.hour[i] !== 10 || s.minute[i] !== 0) return null;
    let sum = 0;
    for (let k = i - 20; k < i; k++) sum += Math.max(s.h[k] - s.l[k], Math.abs(s.h[k] - s.c[k - 1]), Math.abs(s.l[k] - s.c[k - 1]));
    const distance = sum / 20, high = FX.round(s.o[i] + distance, s.info.digits), low = FX.round(s.o[i] - distance, s.info.digits);
    if (!(high > low) || s.h[i] >= high || s.l[i] <= low) return null;
    const activate = s.t[i] + s.sec + FX.PUBLISH_DELAY;
    return [[{ ...protective(1, high, low), activate_after: activate }, { ...protective(-1, low, high), activate_after: activate }],
      "Нивата са от лондонското отваряне и средния True Range на предишните 20 свещи. Изчакваме поне 25 минути след сигнала. Докоснат преди активирането вход отменя модела. Една сделка за деня, изход до 22:00."];
  }

  // Седмичната стойност е достъпна едва след края на петъчната дневна свещ.
  function weeklyTrend(s, i) {
    if (!s._cache.book_weekly) {
      const groups = [];
      for (let j = 0; j < s.n; j++) {
        const day = Math.floor(s.t[j] / 86400), wd = (new Date(s.t[j] * 1000).getUTCDay() + 6) % 7;
        const start = (day - wd) * 86400;
        if (!groups.length || groups[groups.length - 1].start !== start) groups.push({ start, close: s.c[j] });
        else groups[groups.length - 1].close = s.c[j];
      }
      const ema = FX.ind.ema(groups.map((g) => g.close), 13);
      s._cache.book_weekly = { groups, ema };
    }
    const { groups, ema } = s._cache.book_weekly, end = s.t[i] + s.sec;
    let k = groups.length - 1;
    while (k >= 0 && groups[k].start + 5 * 86400 > end) k--;
    return k > 0 && valid(ema[k]) && valid(ema[k - 1]) ? Math.sign(ema[k] - ema[k - 1]) : 0;
  }
  function elderBias(s, i) {
    if (s.tf === "D1") return weeklyTrend(s, i);
    const daily = s.peer("D1");
    if (!daily) return 0;
    const k = s.align("D1")[i], ma = daily.get("ema", 13);
    return k > 0 && valid(ma[k]) && valid(ma[k - 1]) ? Math.sign(ma[k] - ma[k - 1]) : 0;
  }
  function elder(s, i) {
    if (!ready(s, i)) return null;
    const d = elderBias(s, i), ma = s.get("ema", 13);
    if (!d || !valid(ma[i - 1])) return null;
    const power = d === 1 ? s.l[i] - ma[i] : s.h[i] - ma[i];
    const prior = d === 1 ? s.l[i - 1] - ma[i - 1] : s.h[i - 1] - ma[i - 1];
    if (!(power * d < 0 && (power - prior) * d > 0)) return null;
    const entry = d === 1 ? s.h[i] + s.buf : s.l[i] - s.buf;
    const stop = d === 1 ? Math.min(s.l[i], s.l[i - 1]) - tick(s) : Math.max(s.h[i], s.h[i - 1]) + tick(s);
    return [[protective(d, entry, stop)], "По-високата графика задава посоката, Elder-Ray показва корекция, а входът чака пробив на завършената свещ. Стопът е зад последните две свещи."];
  }
  function elderManage(st, s, i) {
    if (elderBias(s, i) === -st.dir) return ["close", "По-високата графика смени посоката"];
    const gain = (s.c[i] - st.fill_price) * st.dir, risk = Math.abs(st.fill_price - st.stop0);
    if (!st.book_armed && gain >= risk) {
      st.book_armed = true; st.book_peak = gain; st.stop = st.fill_price;
    } else if (st.book_armed) {
      st.book_peak = Math.max(st.book_peak, gain);
      const keep = st.book_peak / 2;
      if (gain <= keep) return ["close", "Върната е половината от най-голямата печалба по затварянията"];
      const stop = st.fill_price + st.dir * keep;
      if ((stop - st.stop) * st.dir > 0) st.stop = stop;
    }
    return null;
  }

  function role(s, i) {
    if (!ready(s, i)) return null;
    const d = trend(s, i);
    let setup = s.memo.book_role;
    if (setup && (i - setup.bar > 8 || d !== setup.dir || (s.c[i] - setup.level) * setup.dir < -setup.atr / 2)) setup = s.memo.book_role = null;
    if (setup && i > setup.bar && !setup.used) {
      const { dir, level, atr } = setup;
      const touched = dir === 1 ? s.l[i] <= level + atr / 4 && s.l[i] >= level - atr / 2 : s.h[i] >= level - atr / 4 && s.h[i] <= level + atr / 2;
      if (touched && (s.c[i] - level) * dir > 0 && (s.c[i] - s.o[i]) * dir > 0) {
        setup.used = true;
        const entry = dir === 1 ? s.h[i] + s.buf : s.l[i] - s.buf;
        const stop = dir === 1 ? Math.min(s.l[i], level - atr / 4) - tick(s) : Math.max(s.h[i], level + atr / 4) + tick(s);
        return [[protective(dir, entry, stop)], "Пробита е границата на предишните 20 свещи. До осем свещи по-късно цената тества зоната и затваря отново по тренда. Вход при пробив на потвърждението."];
      }
    }
    if (!setup && d) {
      const high = Math.max(...s.h.slice(i - 20, i)), low = Math.min(...s.l.slice(i - 20, i));
      if ((d === 1 && s.c[i] > high) || (d === -1 && s.c[i] < low)) s.memo.book_role = { dir: d, level: d === 1 ? high : low, atr: s.atr[i], bar: i, used: false };
    }
    return null;
  }
  function trendExit(st, s, i) {
    const ma = s.ema20;
    return valid(ma[i]) && (s.c[i] - ma[i]) * st.dir < 0 ? ["close", "Затваряне от другата страна на EMA 20"] : null;
  }

  function contraction(s, i) {
    if (!ready(s, i)) return null;
    const d = trend(s, i), a = s.atr[i];
    if (!d || (s.c[i - 4] - s.c[i - 8]) * d <= s.atr[i - 4] || (s.c[i] - s.c[i - 3]) * d > 0) return null;
    const high = Math.max(...s.h.slice(i - 3, i + 1)), low = Math.min(...s.l.slice(i - 3, i + 1));
    if (high - low > 1.5 * a || high <= low || s.h[i] - s.l[i] > a) return null;
    for (let k = i - 2; k <= i; k++) {
      const overlap = Math.min(s.h[k], s.h[k - 1]) - Math.max(s.l[k], s.l[k - 1]);
      if (overlap < .5 * Math.min(s.h[k] - s.l[k], s.h[k - 1] - s.l[k - 1])) return null;
    }
    const old = Math.max(s.h[i - 3], s.h[i - 2]) - Math.min(s.l[i - 3], s.l[i - 2]);
    const recent = Math.max(s.h[i - 1], s.h[i]) - Math.min(s.l[i - 1], s.l[i]);
    if (recent >= old) return null;
    return [[protective(d, d === 1 ? high + s.buf : low - s.buf, d === 1 ? low - tick(s) : high + tick(s))], "След импулс по тренда четири H4 свещи се припокриват и свиват диапазона. Вход при пробив по тренда, стоп от другата страна на корекцията."];
  }

  function outside(s, i) {
    if (!ready(s, i) || s.h[i] <= s.h[i - 1] || s.l[i] >= s.l[i - 1]) return null;
    const d = s.c[i] > s.h[i - 1] ? 1 : s.c[i] < s.l[i - 1] ? -1 : 0;
    if (!d) return null;
    return [[protective(d, s.c[i], d === 1 ? s.l[i] - tick(s) : s.h[i] + tick(s), "market")], "Външен ден затвори извън предишния дневен диапазон. Вход на следващото отваряне със стоп зад сигнала. Изход след три последващи сесии."];
  }

  function pinball(s, i) {
    if (!ready(s, i) || s.weekday[i] > 4 || s.hour[i] !== 10) return null;
    const daily = s.peer("D1");
    if (!daily) return null;
    const k = s.align("D1")[i];
    if (!daily._cache.book_pinball) {
      const roc = daily.c.map((c, j) => j ? 100 * (c / daily.c[j - 1] - 1) : 0);
      daily._cache.book_pinball = FX.ind.rsi(roc, 3);
    }
    const r = daily._cache.book_pinball[k], d = valid(r) && r < 30 ? 1 : valid(r) && r > 70 ? -1 : 0;
    if (!d) return null;
    return [[protective(d, d === 1 ? s.h[i] + s.buf : s.l[i] - s.buf, d === 1 ? s.l[i] - tick(s) : s.h[i] + tick(s))], "Дневният RSI(3) върху еднодневната процентна промяна задава посоката. Чакаме пробив на първия лондонски час. Нашият дневен вариант затваря до 22:00 и не държи през нощта."];
  }

  function nofriZones(s) {
    if (s._cache.book_nofri) return s._cache.book_nofri;
    const out = [];
    let upper = null, lower = null, cooldown = -1, sum = 0, count = 0, broken = null;
    for (let i = 0; i < s.n; i++) {
      const move = i >= 10 ? Math.abs(s.c[i] - s.c[i - 10]) : null;
      if (valid(move) && count >= 20 && move > 2 * sum / count) cooldown = Math.max(cooldown, i + 10);
      if (valid(move)) { sum += move; count++; }
      if (valid(upper) && valid(lower) && (s.h[i] > upper || s.l[i] < lower)) {
        broken = { upper, lower, bar: i }; upper = null; lower = null;
      }
      if (broken && i > broken.bar && i - broken.bar <= 2 && s.c[i] < broken.upper && s.c[i] > broken.lower) { cooldown = Math.max(cooldown, i + 7); broken = null; }
      if (broken && i - broken.bar > 2) broken = null;
      if (i >= 4) {
        const j = i - 2;
        if (s.c[i] < s.c[i - 1] && s.c[i - 1] < s.c[j] && s.h[j] >= Math.max(...s.h.slice(i - 4, i + 1))) upper = s.h[j];
        if (s.c[i] > s.c[i - 1] && s.c[i - 1] > s.c[j] && s.l[j] <= Math.min(...s.l.slice(i - 4, i + 1))) lower = s.l[j];
      }
      if (valid(upper) && valid(lower) && (lower >= upper || s.h[i] > upper || s.l[i] < lower)) { upper = null; lower = null; }
      out.push({ upper, lower, cooldown });
    }
    s._cache.book_nofri = out;
    return out;
  }
  function nofri(s, i) {
    if (!ready(s, i)) return null;
    const { upper, lower, cooldown } = nofriZones(s)[i], small = 2 * tick(s);
    if (!valid(upper) || !valid(lower) || i < cooldown || s.c[i] <= lower || s.c[i] >= upper) return null;
    const d = s.c[i] < s.c[i - 1] - small && s.c[i - 1] < s.c[i - 2] - small ? 1 : s.c[i] > s.c[i - 1] + small && s.c[i - 1] > s.c[i - 2] + small ? -1 : 0;
    if (!d) return null;
    return [[protective(d, s.c[i], d === 1 ? lower - tick(s) : upper + tick(s), "market")], "Има потвърден диапазон и две дневни затваряния в една посока. Търсим връщане на следващата сесия със защитен стоп отвъд диапазона. Изход в края на тази сесия."];
  }

  const candidates = [
    { key: "book_atr_london_jpy", name: "Лондонски ATR пробив · USD/JPY", tfs: ["M15"], pairs: ["USDJPY"], fn: orb, valid_bars: 31, keep_pending: true, max_per_day: 1, close_hour: 22,
      source: kaufman + ", стр. 759–764", short: "Дневна адаптация с време за предварително показване на нивата.",
      rules: ["В 10:15 Europe/Sofia взимаме отварянето на първата лондонска M15 свещ и средния True Range на 20-те свещи преди нея.", "Покупка: отваряне + 1 × TR; продажба: отваряне − 1 × TR. Докоснати в първите 15 минути нива отменят деня.", "Поръчките се активират поне 25 минути след сигнала. Докосване преди активирането ги отменя. Входове до 18:00, максимум една сделка за деня.", "Стоп: противоположната граница. Без обръщане след стоп."],
      exit_rules: ["Без фиксиран TP. Затваряне до 22:00 Europe/Sofia.", "Това е различен вариант от първоначалния изследователски тест с незабавен вход."] },
    { key: "book_elder", name: "Троен екран на Elder", tfs: ["H4", "D1"], fn: elder, manage: elderManage, max_bars: 30,
      source: kaufman + ", стр. 835–838", short: "Посока от по-висока графика, корекция по Elder-Ray и пробив за вход.",
      rules: ["За H4 посоката е по наклона на D1 EMA(13); за D1 — по завършена седмична EMA(13).", "За покупка Bear Power = дъно − EMA(13) е отрицателен и расте. За продажба Bull Power е положителен и спада.", "Вход: над върха/под дъното на завършената свещ. Стоп: отвъд последните две свещи. Най-малките налични свещи уточняват изпълнението."],
      exit_rules: ["Без фиксиран TP. При затваряне на +1R местим стопа на входа от следващата свещ.", "След това пазим 50% от най-голямата печалба по затварянията. Изход и при обратна посока на по-високата графика или след 30 свещи."] },
    { key: "book_role_reversal", name: "Role Reversal · пробив и ретест", tfs: ["H1", "H4"], fn: role, manage: trendExit, valid_bars: 2, max_bars: 20,
      source: sadowski + ", PDF стр. 29–34", url: pdfURL, short: "Пробив на 20 свещи и потвърден ретест в посоката на EMA 50.",
      rules: ["Посока: цена над/под EMA(50), а средната се движи в същата посока за пет свещи.", "Затваряне отвъд върха/дъното на предишните 20 свещи създава зона. Чакаме ретест до осем свещи.", "Зона: 0.25 ATR около пробитото ниво, максимум 0.5 ATR проникване. Свещта затваря обратно по тренда и е в същата посока.", "Вход при пробив на потвърждението, валиден две свещи. Стоп зад ретеста и зоната."],
      exit_rules: ["Без фиксиран TP. Изход при затваряне от другата страна на EMA 20 или след 20 свещи.", "Дневният H1 вариант затваря до 22:00 и има максимум една сделка дневно."] },
    { key: "book_contraction", name: "Продължение след свиваща се корекция", tfs: ["H4"], fn: contraction, manage: trendExit, max_bars: 18,
      source: sadowski + ", PDF стр. 22–25", url: pdfURL, short: "H4 импулс, четири припокриващи се свещи и пробив по тренда.",
      rules: ["Посока по EMA(50) и наклона ѝ за пет свещи. Преди корекцията има четирисвещен импулс над 1 ATR.", "Четири коригиращи свещи се припокриват поне наполовина спрямо по-малкия съседен диапазон. Общият диапазон е до 1.5 ATR.", "Последните две свещи имат по-малък общ диапазон от първите две. Последната свещ е до 1 ATR.", "Вход: пробив на целия диапазон по тренда. Стоп: другата страна на диапазона."],
      exit_rules: ["Без фиксиран TP. Изход при затваряне отвъд EMA 20 или най-късно след 18 H4 свещи."] },
    { key: "book_outside_close", name: "Външен ден със затваряне извън диапазона", tfs: ["D1"], fn: outside, max_bars: 2, valid_bars: 1,
      source: kaufman + ", стр. 157", short: "Външен ден и силно затваряне; изход след три последващи сесии.",
      rules: ["Върхът е над предишния връх, а дъното е под предишното дъно.", "Покупка при затваряне над предишния връх, продажба при затваряне под предишното дъно.", "Вход на следващото отваряне. Стопът остава една минимална ценова стъпка зад сигнала. Гап отвъд стопа отменя входа."],
      exit_rules: ["Без фиксиран TP. Изход в края на третата последваща дневна сесия или на защитния стоп."] },
    { key: "book_pinball", name: "Momentum Pinball · дневен вариант", tfs: ["H1"], fn: pinball, valid_bars: 7, keep_pending: true, max_per_day: 1, close_hour: 22,
      source: kaufman + ", стр. 766–767", short: "Дневен RSI върху промяната филтрира пробива на първия лондонски час.",
      rules: ["Използваме RSI(3) на еднодневната процентна промяна от последната завършена D1.", "Под 30 чакаме покупка над диапазона 10:00–11:00; над 70 — продажба под него, по Europe/Sofia.", "Стоп: другата страна на първия час. Входове до 18:00, една сделка дневно, без повторен вход след стоп."],
      exit_rules: ["Без фиксиран TP. Защитен стоп или затваряне до 22:00.", "Оригиналът допуска нощуване. Тук то е премахнато и резултатът е за отделна дневна адаптация."] },
    { key: "book_nofri", name: "Nofri · търговия в диапазон", tfs: ["D1"], fn: nofri, manage: () => ["close", "Край на следващата дневна сесия"], valid_bars: 1, max_bars: 1,
      source: kaufman + ", стр. 155–156", short: "Противоположен вход след две движения в потвърден диапазон, със защитен стоп.",
      rules: ["Границите са локални върхове/дъна с две вече завършени потвърждаващи свещи и последователни затваряния обратно към диапазона.", "Нов връх или дъно обезсилва диапазона. Фалшив пробив, върнат до две сесии, налага пауза от седем свещи.", "Десетсвещен ход над два пъти средния предишен такъв ход налага пауза от десет свещи.", "Две по-ниски затваряния дават покупка; две по-високи — продажба. Промени до две минимални стъпки се пропускат.", "Вход на следващото отваряне. Стоп: отвъд противоположната граница на диапазона; гап отвъд стопа отменя входа."],
      exit_rules: ["Без фиксиран TP. Изход в края на следващата дневна сесия или на защитния стоп.", "Защитният стоп и точните потвърждения са част от нашата адаптация."] },
  ];
  FX.BOOK_CANDIDATES = candidates.map((s) => ({ origin: "research", group: "За тест", session: "free", exit: noTP, valid_bars: 3, max_bars: 30,
    url: sourceURL, approx: true, version: 1, provisional: true, require_session_close: true, ...s,
    note: "Версия 1 на собствена формализация. Вече разглежданата история не е ново независимо потвърждение. Нужни са отделен тест и наблюдение занапред." }));
  // Един и същ модел има дневна H1 и суинг H4 версия; часовото ограничение се решава по графиката.
  const roleCandidate = FX.BOOK_CANDIDATES.find((s) => s.key === "book_role_reversal");
  roleCandidate.session = "site";
  roleCandidate.close_hour_day = 22;
  roleCandidate.max_per_day_day = 1;
  FX.RESEARCH = (FX.RESEARCH || []).concat(FX.BOOK_CANDIDATES);
})(self.FX = self.FX || {});
