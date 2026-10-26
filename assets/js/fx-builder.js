/* Конструктор на стратегии: стратегия = описание (условия за вход, стоп, изход), без код.
   Условията се пишат за ПОКУПКА. Продажбата е огледална: „над“ става „под“, „нагоре“ - „надолу“,
   RSI 30 става 70 (около средата 50), горната лента става долна и т.н.

   Пример:
   { key: "rsi_ema", name: "...", tfs: ["H1"],
     when: [ {a: {ind: "rsi", p: [14]}, op: "cross_above", b: 30},
             {a: "close", op: ">", b: {ind: "ema", p: [200]}} ],
     entry: {type: "market"}, stop: {type: "atr", mult: 1.5}, exit: {parts: [[1, 2]]},
     exit_when: [ {a: {ind: "rsi", p: [14]}, op: "cross_above", b: 70} ] } */
(function (FX) {
  "use strict";
  const ok = (x) => x !== null && x !== undefined;

  /* ---------------------------------------------------------- индикатори за конструктора */
  // calc(s, p) -> масив или масив от масиви; lines: имена на линиите; center: средата за огледален образ;
  // mirror: коя линия става коя при продажба; label: как се казва на български.
  const IND = (FX.BUILDER_IND = {
    kama: { label: (p) => `KAMA(${p.join(", ")})`, calc: (s, p) => s.get("kama", ...p), params: [["Период", 10], ["Бърза", 2], ["Бавна", 30]] },
    demarker: { label: (p) => `DeMarker(${p[0]})`, calc: (s, p) => s.get("demarker", ...p), center: 0.5, params: [["Период", 14]] },
    rvi: { label: (p, l) => `${l === "signal" ? "Сигналната линия на " : ""}RVI(${p[0]})`, calc: (s, p) => s.get("rvi", ...p), center: 0, lines: ["line", "signal"], params: [["Период", 10]] },
    ema: { label: (p) => `EMA(${p[0]})`, calc: (s, p) => s.get("ema", p[0]), params: [["Период", 20]] },
    sma: { label: (p) => `SMA(${p[0]})`, calc: (s, p) => s.get("sma", p[0]), params: [["Период", 20]] },
    rsi: { label: (p) => `RSI(${p[0]})`, calc: (s, p) => s.get("rsi", p[0]), center: 50, params: [["Период", 14]] },
    stoch: { label: (p, l) => `Stoch ${l === "d" ? "%D" : "%K"}(${p.join(", ")})`, calc: (s, p) => s.get("stoch", p[0], p[1], p[2]), lines: ["k", "d"], center: 50, params: [["%K", 14], ["%D", 3], ["Забавяне", 3]] },
    cci: { label: (p) => `CCI(${p[0]})`, calc: (s, p) => s.get("cci", p[0]), center: 0, params: [["Период", 20]] },
    wpr: { label: (p) => `Williams %R(${p[0]})`, calc: (s, p) => s.get("wpr", p[0]), center: -50, params: [["Период", 14]] },
    mom: { label: (p) => `Momentum(${p[0]})`, calc: (s, p) => s.get("mom", p[0]), center: 0, params: [["Период", 10]] },
    ao: { label: () => "Awesome Oscillator", calc: (s) => s.get("ao"), center: 0, params: [] },
    macd: { label: (p, l) => ({ line: "MACD", signal: "сигналната линия на MACD", hist: "хистограмата на MACD" })[l || "line"] + `(${p.join(", ")})`, calc: (s, p) => s.get("macd", p[0], p[1], p[2]), lines: ["line", "signal", "hist"], center: 0, params: [["Бърза", 12], ["Бавна", 26], ["Сигнал", 9]] },
    adx: { label: (p, l) => ({ adx: "ADX", pdi: "+DI", mdi: "−DI" })[l || "adx"] + `(${p[0]})`, calc: (s, p) => s.get("adx", p[0]), lines: ["adx", "pdi", "mdi"], mirror: { pdi: "mdi", mdi: "pdi" }, params: [["Период", 14]] },
    atr: { label: (p) => `ATR(${p[0]})`, calc: (s, p) => s.get("atr", p[0]), params: [["Период", 14]] },
    bb: { label: (p, l) => ({ mid: "средната лента", upper: "горната лента", lower: "долната лента" })[l || "mid"] + ` на Bollinger(${p.join(", ")})`, calc: (s, p) => s.get("bb", p[0], p[1]), lines: ["mid", "upper", "lower"], mirror: { upper: "lower", lower: "upper" }, params: [["Период", 20], ["Отклонения", 2]] },
    keltner: { label: (p, l) => ({ mid: "средата", upper: "горната граница", lower: "долната граница" })[l || "mid"] + ` на Keltner(${p.join(", ")})`, calc: (s, p) => s.get("keltner", p[0], p[1]), lines: ["mid", "upper", "lower"], mirror: { upper: "lower", lower: "upper" }, params: [["Период", 20], ["× ATR", 2]] },
    donchian: { label: (p, l) => (l === "lower" ? "най-ниското" : "най-високото") + ` от последните ${p[0]} свещи`, calc: (s, p) => s.get("donchian", p[0]), lines: ["upper", "lower"], mirror: { upper: "lower", lower: "upper" }, params: [["Свещи", 20]] },
    st: { label: (p, l) => (l === "dir" ? "посоката на Supertrend" : "линията на Supertrend") + `(${p.join(", ")})`, calc: (s, p) => s.get("st", p[0], p[1]), lines: ["line", "dir"], center: { dir: 0 }, params: [["Период", 10], ["× ATR", 3]] },
    psar: { label: () => "посоката на Параболата (SAR)", calc: (s) => s.get("psar", 0.02, 0.2), center: 0, params: [] },
    ichi: { label: (p, l) => ({ top: "горния край на облака", bottom: "долния край на облака", tenkan: "Tenkan", kijun: "Kijun" })[l || "top"] + " (Ишимоку)", calc: (s) => { const [a, b, tk, kj] = s.get("ichi"); return [a.map((x, i) => (ok(x) && ok(b[i]) ? Math.max(x, b[i]) : null)), a.map((x, i) => (ok(x) && ok(b[i]) ? Math.min(x, b[i]) : null)), tk, kj]; }, lines: ["top", "bottom", "tenkan", "kijun"], mirror: { top: "bottom", bottom: "top" }, params: [] },
    ut: { label: (p) => `линията на UT Bot(${p.join(", ")})`, calc: (s, p) => s.get("ut", p[0], p[1]), params: [["Ключ", 1], ["ATR", 10]] },
    heikin: { label: (p, l) => (l === "open" ? "откриването" : "затварянето") + " на Хейкин Аши", calc: (s) => s.get("heikin"), lines: ["open", "close"], params: [] },
    chandelier: { label: (p, l) => (l === "short" ? "горната" : "долната") + ` линия на Chandelier(${p.join(", ")})`, calc: (s, p) => s.get("chandelier", p[0], p[1]), lines: ["long", "short"], mirror: { long: "short", short: "long" }, params: [["Период", 22], ["× ATR", 3]] },
    ssl: { label: (p, l) => (l === "low" ? "SMA на дъната" : "SMA на върховете") + `(${p[0]})`, calc: (s, p) => s.get("ssl", p[0]), lines: ["high", "low"], mirror: { high: "low", low: "high" }, params: [["Период", 10]] },
    sqz: { label: (p, l) => (l === "on" ? "свиването (Squeeze)" : "импулсът на Squeeze"), calc: (s) => s.get("sqz"), lines: ["on", "val"], center: { val: 0 }, params: [] },
  });
  const PRICE = { close: "цената (затваряне)", open: "откриването", high: "върхът на свещта", low: "дъното на свещта" };
  const PRICE_MIRROR = { high: "low", low: "high" };
  FX.BUILDER_PRICE = PRICE;

  function centerOf(op) {
    if (!op || typeof op !== "object" || !op.ind) return null;
    const def = IND[op.ind];
    if (!def || def.center === undefined) return null;
    if (typeof def.center === "number") return def.center;
    return def.center[op.line] !== undefined ? def.center[op.line] : null;
  }

  /** Огледален образ на операнд за продажба. */
  function mirrorOperand(op, other) {
    if (typeof op === "number") {
      const c = centerOf(other);
      return c === null ? op : 2 * c - op;
    }
    if (typeof op === "string") return PRICE_MIRROR[op] || op;
    if (op && op.ind) {
      const def = IND[op.ind];
      if (def && def.mirror && op.line && def.mirror[op.line]) return Object.assign({}, op, { line: def.mirror[op.line] });
    }
    return op;
  }
  const OP_MIRROR = { ">": "<", "<": ">", ">=": "<=", "<=": ">=", cross_above: "cross_below", cross_below: "cross_above", rising: "falling", falling: "rising" };

  /** Индикатори без посока (сила на тренда, волатилност, свиване) - не се обръщат при продажба. */
  function nonDir(op) {
    if (!op || typeof op !== "object" || !op.ind) return false;
    return op.ind === "atr" || (op.ind === "adx" && (op.line || "adx") === "adx") || (op.ind === "sqz" && op.line === "on");
  }

  function mirrorCond(c) {
    if (c.pat || c.hours || c.days || c.same) return c;
    if (nonDir(c.a) && (typeof c.b === "number" || nonDir(c.b))) return c;
    if (c.within) return Object.assign({}, c, { cond: mirrorCond(c.cond) });
    return Object.assign({}, c, { a: mirrorOperand(c.a, c.b), op: OP_MIRROR[c.op] || c.op, b: c.b === undefined ? undefined : mirrorOperand(c.b, c.a) });
  }
  FX.mirrorCond = mirrorCond;

  /* ---------------------------------------------------------- стойности */

  /** Масивът със стойности на операнда в серията (за по-старша графика - в нейната серия). */
  function arrayOf(op, s) {
    if (typeof op === "string") return { arr: s[op === "close" ? "c" : op === "open" ? "o" : op === "high" ? "h" : "l"], ser: s };
    const ser = op.tf && op.tf !== s.tf ? s.peer(op.tf) : s;
    if (!ser) return null;
    const def = IND[op.ind];
    if (!def) throw new Error("Непознат индикатор: " + op.ind);
    const v = def.calc(ser, op.p || def.params.map((x) => x[1]));
    if (def.lines) return { arr: v[Math.max(0, def.lines.indexOf(op.line || def.lines[0]))], ser };
    return { arr: v, ser };
  }

  function valueAt(op, s, i) {
    if (typeof op === "number") return op;
    const r = arrayOf(op, s);
    if (!r) return null;
    let k = i - (op.shift || 0);
    if (r.ser !== s) k = s.align(r.ser.tf)[k];
    if (k < 0) return null;
    const v = r.arr[k];
    return v === undefined ? null : v === true ? 1 : v === false ? 0 : v;
  }

  /* ---------------------------------------------------------- фигури от свещи (за покупка) */
  const PATTERNS = {
    inside: { label: "вътрешна свещ (в рамките на предходната)", test: (s, i) => s.h[i] < s.h[i - 1] && s.l[i] > s.l[i - 1], both: true },
    engulf: { label: "поглъщаща свещ", test: (s, i, d) => {
      const o = s.o, c = s.c;
      if (d === 1) return c[i] > o[i] && c[i - 1] < o[i - 1] && c[i] >= o[i - 1] && o[i] <= c[i - 1];
      return c[i] < o[i] && c[i - 1] > o[i - 1] && c[i] <= o[i - 1] && o[i] >= c[i - 1];
    } },
    pinbar: { label: "пин бар (дълга опашка срещу посоката)", test: (s, i, d) => {
      const rng = s.h[i] - s.l[i];
      if (rng <= 0) return false;
      const top = Math.max(s.o[i], s.c[i]), bot = Math.min(s.o[i], s.c[i]);
      return d === 1 ? (bot - s.l[i]) / rng >= 0.6 && (s.c[i] - s.l[i]) / rng >= 0.66 : (s.h[i] - top) / rng >= 0.6 && (s.h[i] - s.c[i]) / rng >= 0.66;
    } },
    ha_turn: { label: "свещта на Хейкин Аши смени цвета", test: (s, i, d) => {
      const [ho, hc] = s.get("heikin");
      return d === 1 ? hc[i] > ho[i] && hc[i - 1] <= ho[i - 1] : hc[i] < ho[i] && hc[i - 1] >= ho[i - 1];
    } },
    nr7: { label: "най-тясната свещ от последните 7", test: (s, i) => {
      const r = s.h[i] - s.l[i];
      for (let k = i - 6; k < i; k++) if (s.h[k] - s.l[k] <= r) return false;
      return true;
    }, both: true },
    bull_bar: { label: "свещта е в посоката на сделката", test: (s, i, d) => (s.c[i] - s.o[i]) * d > 0 },
  };
  FX.BUILDER_PATTERNS = PATTERNS;

  /* ---------------------------------------------------------- проверка на условие */

  function test(c, s, i, d) {
    if (c.pat) return PATTERNS[c.pat].test(s, i, d);
    if (c.hours) return s.hour[i] >= c.hours[0] && s.hour[i] < c.hours[1];
    if (c.days) return c.days.includes(s.weekday[i]);
    if (c.within) {
      for (let k = 0; k < c.within; k++) if (i - k > 1 && test(c.cond, s, i - k, d)) return true;
      return false;
    }
    const a = valueAt(c.a, s, i);
    if (a === null) return false;
    if (c.op === "rising" || c.op === "falling") {
      const prev = valueAt(c.a, s, i - (c.n || 1));
      if (prev === null) return false;
      return c.op === "rising" ? a > prev : a < prev;
    }
    if (c.op === "between") return a >= c.lo && a <= c.hi;
    const b = valueAt(c.b, s, i);
    if (b === null) return false;
    switch (c.op) {
      case ">": return a > b;
      case "<": return a < b;
      case ">=": return a >= b;
      case "<=": return a <= b;
      case "cross_above": case "cross_below": {
        const a1 = valueAt(c.a, s, i - 1), b1 = valueAt(c.b, s, i - 1);
        if (a1 === null || b1 === null) return false;
        return c.op === "cross_above" ? a1 <= b1 && a > b : a1 >= b1 && a < b;
      }
      default: throw new Error("Непозната проверка: " + c.op);
    }
  }

  /* ---------------------------------------------------------- описание на български */

  function opText(op) {
    if (typeof op === "number") return String(op);
    if (typeof op === "string") return PRICE[op] || op;
    const def = IND[op.ind];
    let t = def.label(op.p || def.params.map((x) => x[1]), op.line);
    if (op.tf) t += ` на графика ${FX.TIMEFRAMES[op.tf].label}`;
    if (op.shift) t += ` (преди ${op.shift} свещи)`;
    return t;
  }
  const VERB = { ">": "е над", "<": "е под", ">=": "е поне", "<=": "е най-много", cross_above: "пресича нагоре", cross_below: "пресича надолу" };

  function condText(c) {
    if (c.pat) return PATTERNS[c.pat].label;
    if (c.hours) return `часът е между ${c.hours[0]}:00 и ${c.hours[1]}:00 (българско време)`;
    if (c.days) return "само в избраните дни";
    if (c.within) return `в последните ${c.within} свещи: ${condText(c.cond)}`;
    if (c.op === "rising") return `${opText(c.a)} расте`;
    if (c.op === "falling") return `${opText(c.a)} пада`;
    if (c.op === "between") return `${opText(c.a)} е между ${c.lo} и ${c.hi}`;
    return `${opText(c.a)} ${VERB[c.op]} ${opText(c.b)}`;
  }
  FX.condText = condText;

  function stopText(st) {
    if (!st || st.type === "atr") return `Стоп: ${(st && st.mult) || 1.5} × ATR(${(st && st.n) || 14}) от входа.`;
    if (st.type === "bar") return "Стоп: няколко пипса под дъното на сигналната свещ (при продажба над върха ѝ).";
    if (st.type === "swing") return `Стоп: под най-ниското от последните ${st.n} свещи (при продажба над най-високото).`;
    if (st.type === "line") return `Стоп: ${opText(st.a)}.`;
    if (st.type === "pips") return `Стоп: ${st.v} пипса от входа.`;
    return "";
  }

  function exitTexts(spec) {
    const ex = spec.exit || FX.SPLIT, out = [stopText(spec.stop)];
    const parts = ex.parts;
    if (parts.length > 1) out.push(`Цел 1 = ${parts[0][1]} × риска (половината), Цел 2 = ${parts[1][1]} × риска. След Цел 1 стопът отива на входа.`);
    else if (parts[0][1]) out.push(`Цел: ${parts[0][1]} × риска.`);
    else out.push("Без фиксирана цел.");
    if (ex.trail) out.push("Стопът е плаващ: следва най-добрата цена на същото разстояние.");
    if (spec.trail_line) out.push(`Стопът следва ${opText(spec.trail_line)}.`);
    if (ex.be && ex.be.r) out.push(`Когато печалбата стигне ${ex.be.r} × риска, стопът отива на входа.`);
    for (const c of spec.exit_when || []) out.push(`Изход, когато ${condText(c)}.`);
    if (spec.close_hour) out.push(`Затваряне най-късно в ${spec.close_hour}:00.`);
    if (spec.max_bars) out.push(`Затваряне най-късно след ${spec.max_bars} свещи.`);
    return out;
  }

  /* ---------------------------------------------------------- сглобяване */

  function validateOperand(value) {
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value === "string" && Object.hasOwn(PRICE, value)) return;
    if (!value || typeof value !== "object" || !IND[value.ind]) throw new Error("Избери познат индикатор или цена.");
    const def = IND[value.ind], params = value.p || def.params.map((p) => p[1]);
    if (!Array.isArray(params) || params.length !== def.params.length || params.some((p) => !Number.isFinite(p) || p <= 0 || p > 5000)) throw new Error("Параметрите на индикатора трябва да са положителни числа до 5000.");
    if (params.some((p, i) => !/×|Отклонения|Ключ/.test(def.params[i][0]) && !Number.isInteger(p))) throw new Error("Периодите на индикаторите трябва да са цели числа.");
    if (value.tf && !FX.TIMEFRAMES[value.tf]) throw new Error("Непозната графика в условието.");
    if (value.shift !== undefined && (!Number.isInteger(value.shift) || value.shift < 0 || value.shift > 1000)) throw new Error("Условието може да гледа само настоящи и минали свещи.");
    if (value.line && (!def.lines || !def.lines.includes(value.line))) throw new Error("Непозната линия на индикатора.");
  }
  function validateCondition(condition, depth = 0) {
    if (!condition || typeof condition !== "object" || depth > 3) throw new Error("Провери вложените условия.");
    if (condition.pat) { if (!PATTERNS[condition.pat]) throw new Error("Непозната фигура от свещи."); return; }
    if (condition.hours) { if (condition.hours.length !== 2 || !condition.hours.every(Number.isInteger) || condition.hours[0] < 0 || condition.hours[1] > 24 || condition.hours[0] >= condition.hours[1]) throw new Error("Провери часовете за вход."); return; }
    if (condition.days) { if (!Array.isArray(condition.days) || !condition.days.length || condition.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error("Провери дните за вход."); return; }
    if (condition.within !== undefined) { if (!Number.isInteger(condition.within) || condition.within < 1 || condition.within > 100) throw new Error("Избери между 1 и 100 минали свещи."); validateCondition(condition.cond, depth + 1); return; }
    validateOperand(condition.a);
    if (["rising", "falling"].includes(condition.op)) { if (condition.n !== undefined && (!Number.isInteger(condition.n) || condition.n < 1 || condition.n > 1000)) throw new Error("Провери периода на сравнението."); return; }
    if (condition.op === "between") { if (![condition.lo, condition.hi].every(Number.isFinite) || condition.lo > condition.hi) throw new Error("Провери границите на условието."); return; }
    if (!Object.hasOwn(OP_MIRROR, condition.op)) throw new Error("Непознато сравнение.");
    validateOperand(condition.b);
  }
  FX.validateSpec = function (spec) {
    if (!spec || !Array.isArray(spec.tfs) || !spec.tfs.length || spec.tfs.some((tf) => !FX.TIMEFRAMES[tf])) throw new Error("Избери дневна или суинг графика.");
    if (!Array.isArray(spec.when) || !spec.when.length || spec.when.length > 20) throw new Error("Задай между 1 и 20 условия за вход.");
    spec.when.forEach((c) => validateCondition(c));
    if (spec.exit_when) { if (!Array.isArray(spec.exit_when) || spec.exit_when.length > 20) throw new Error("Провери условията за изход."); spec.exit_when.forEach((c) => validateCondition(c)); }
    if (spec.pairs && (!Array.isArray(spec.pairs) || !spec.pairs.length || spec.pairs.some((pair) => !FX.PAIRS[pair]))) throw new Error("Избери валиден инструмент.");
    const stop = spec.stop || { type: "atr", mult: 1.5 };
    if (!["atr", "bar", "swing", "line", "pips"].includes(stop.type)) throw new Error("Избери вид стоп.");
    if (stop.type === "line") validateOperand(stop.a);
    for (const key of ["mult", "n", "v"]) if (stop[key] !== undefined && (!Number.isFinite(stop[key]) || stop[key] <= 0 || stop[key] > 5000)) throw new Error("Провери разстоянието и периода на стопа.");
    if (stop.n !== undefined && !Number.isInteger(stop.n)) throw new Error("Периодът за стопа трябва да е цяло число.");
    const exit = spec.exit || FX.SPLIT;
    if (!Array.isArray(exit.parts) || !exit.parts.length || exit.parts.length > 4 || exit.parts.some((p) => !Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || p[0] <= 0 || (p[1] !== null && (!Number.isFinite(p[1]) || p[1] <= 0))) || Math.abs(exit.parts.reduce((sum, p) => sum + p[0], 0) - 1) > 1e-6) throw new Error("Частите на изхода трябва да покриват цялата позиция.");
    if (spec.trail_line) validateOperand(spec.trail_line);
    return true;
  };

  /** Прави стратегия (същия вид като тези в кода) от описание. */
  FX.build = function (spec) {
    FX.validateSpec(spec);
    const sides = spec.side === "long" ? [1] : spec.side === "short" ? [-1] : [1, -1];
    const whenFor = { 1: spec.when, "-1": spec.when.map(mirrorCond) };
    const exitWhen = spec.exit_when ? { 1: spec.exit_when, "-1": spec.exit_when.map(mirrorCond) } : null;
    const entry = spec.entry || { type: "market" }, stop = spec.stop || { type: "atr", mult: 1.5 };
    const ex = Object.assign({}, spec.exit || FX.SPLIT);
    if (ex.be && ex.be.r) ex.be = undefined; // поддържа се чрез manage (по-долу)

    function stopPrice(s, i, d, ref) {
      const atrN = stop.n || 14;
      switch (stop.type) {
        case "bar": return d === 1 ? s.l[i] - s.buf : s.h[i] + s.buf;
        case "swing": {
          let x = d === 1 ? Infinity : -Infinity;
          for (let k = i - stop.n + 1; k <= i; k++) x = d === 1 ? Math.min(x, s.l[k]) : Math.max(x, s.h[k]);
          return x - d * s.buf;
        }
        case "line": { const v = valueAt(d === 1 ? stop.a : mirrorOperand(stop.a), s, i); return v === null ? null : v; }
        case "pips": return ref - d * stop.v * s.pip;
        default: { const a = s.get("atr", atrN)[i]; return a === null ? null : ref - d * (stop.mult || 1.5) * a; }
      }
    }

    const fn = (s, i) => {
      if (i < 2) return null;
      for (const d of sides) {
        if (!whenFor[d].every((c) => test(c, s, i, d))) continue;
        let order;
        if (entry.type === "stop") {
          const e = d === 1 ? s.h[i] + s.buf : s.l[i] - s.buf;
          const sp = stopPrice(s, i, d, e);
          if (sp === null || (e - sp) * d <= 0) continue;
          order = { dir: d, type: "stop", entry: e, stop: sp };
        } else {
          const ref = s.c[i], sp = stopPrice(s, i, d, ref);
          if (sp === null || (ref - sp) * d <= 0) continue;
          order = FX.ord.market(d, ref, Math.abs(ref - sp));
        }
        const why = `${d === 1 ? "Покупка" : "Продажба"}: ` + whenFor[d].map(condText).join("; ") + ".";
        return [[order], why];
      }
      return null;
    };

    const needManage = exitWhen || spec.trail_line || (spec.exit && spec.exit.be && spec.exit.be.r);
    const manage = needManage ? (st, s, i) => {
      const d = st.dir;
      if (spec.trail_line) {
        const v = valueAt(d === 1 ? spec.trail_line : mirrorOperand(spec.trail_line), s, i);
        if (v !== null && (v - st.stop) * d > 0 && (s.c[i] - v) * d > 0) st.stop = v;
      }
      if (spec.exit && spec.exit.be && spec.exit.be.r) {
        const risk = Math.abs(st.fill_price - st.stop0);
        if ((s.c[i] - st.fill_price) * d >= spec.exit.be.r * risk && (st.fill_price - st.stop) * d > 0) st.stop = st.fill_price;
      }
      if (exitWhen && exitWhen[d].every((c) => test(c, s, i, d))) return ["close", "Изход по правило"];
      return null;
    } : null;

    const rules = spec.when.map((c) => condText(c).replace(/^./, (x) => x.toUpperCase()) + ".");
    rules.push(entry.type === "stop" ? "Вход: стоп поръчка няколко пипса над върха на сигналната свещ (при продажба под дъното ѝ)." : "Вход: пазарна поръчка при отварянето на следващата свещ.");
    if (sides.length === 2) rules.push("Продажбата е огледална на покупката.");

    return {
      key: spec.key, name: spec.name, short: spec.short || "", tfs: spec.tfs, pairs: spec.pairs || null,
      fn, manage, exit: ex, origin: spec.origin || "lib", session: "free", approx: !!spec.approx, group: spec.group || "Библиотека",
      valid_bars: spec.valid_bars !== undefined ? spec.valid_bars : entry.type === "stop" ? undefined : 1,
      max_bars: spec.max_bars || 200, close_hour: spec.close_hour, rules: spec.rules || rules,
      exit_rules: spec.exit_rules || exitTexts(spec), source: spec.source || "Класическа стратегия", url: spec.url || null,
      note: spec.note || null, spec,
    };
  };
})(self.FX = self.FX || {});
