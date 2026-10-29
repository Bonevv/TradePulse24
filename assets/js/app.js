"use strict";

// Каталог, сигнали и лични настройки. Цените и новините идват от JSON файловете.

const STORE_KEY = "logo-signals-settings-v1";
const DEFAULTS = { balance: null, currency: "USD", risk: 0.5, style: "day", followed: null, smartPairs: true, notifications: false };
const MY_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "AUD", "CHF", "CAD", "NZD"];
const CURRENCY_NAMES = { USD: "САЩ", EUR: "Еврозона", GBP: "Великобритания", JPY: "Япония", AUD: "Австралия", CHF: "Швейцария", CAD: "Канада", NZD: "Нова Зеландия", CNY: "Китай", ALL: "Всички" };
const STYLE_NAMES = { day: "Дневна", swing: "Суинг" };
const VERDICT_ORDER = { good: 0, weak: 1, few: 2, bad: 3 };
const VERDICT_TIP = {
  good: "Покрива критериите в историческия тест. Това не гарантира печалба занапред.",
  weak: "Печели малко или само в част от периода.",
  bad: "Губи след спреда.",
  few: "Няма достатъчно исторически сделки, за да се прецени.",
};
const REASONS = {
  sl: "Стоп", be: "Стоп на входа", tp2: "Цел 2", tp: "Цел", time: "Затворена по време",
  trail: "Плаващ стоп", signal: "Изход по правило", reverse: "Обратен сигнал",
};
const TF_SEC = { M15: 900, H1: 3600, H4: 14400, D1: 86400 };

const S = {
  data: null,
  error: null,
  settings: loadSettings(),
  route: { view: "dashboard", id: null },
  sigFilter: "now",
  showAll: false,
  pairQuery: "",
  stratFilter: "all",
  stratPair: "",
  newsMine: true,
  newsImpact: "hm",
  newsDay: "today",
  newsShowPast: false,
  charts: {},
  timer: null,
  watch: new FXWatch.WatchStore(),
  observed: new FXObserved.Store(),
};

/* ------------------------------------------------------------ настройки */

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (raw && typeof raw === "object") return clean({ ...DEFAULTS, ...raw });
  } catch (_e) { /* браузърът не позволява запис - работим с подразбиране */ }
  return { ...DEFAULTS };
}

function clean(s) {
  const b = Number(s.balance);
  s.balance = Number.isFinite(b) && b >= 50 && b <= 10000000 ? Math.round(b * 100) / 100 : null;
  const r = Number(s.risk);
  s.risk = Number.isFinite(r) && r >= 0.1 && r <= 1 ? Math.round(r * 100) / 100 : 0.5;
  s.currency = s.currency === "EUR" ? "EUR" : "USD";
  s.style = ["day", "swing"].includes(s.style) ? s.style : "day";
  s.followed = Array.isArray(s.followed) ? s.followed.filter((x) => typeof x === "string") : null;
  s.smartPairs = s.smartPairs !== false;
  s.notifications = s.notifications === true;
  return s;
}

function saveSettings() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S.settings)); }
  catch (_e) { toast("Този браузър не позволява да запазим настройките."); }
}

/* ------------------------------------------------------------ формати */

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const now = () => Date.now() / 1000;
const TZ = "Europe/Sofia";
const F = {
  dayTime: new Intl.DateTimeFormat("bg-BG", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
  time: new Intl.DateTimeFormat("bg-BG", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }),
  date: new Intl.DateTimeFormat("bg-BG", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }),
  dayLong: new Intl.DateTimeFormat("bg-BG", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }),
  monthYear: new Intl.DateTimeFormat("bg-BG", { timeZone: TZ, month: "short", year: "numeric" }),
  dayMonth: new Intl.DateTimeFormat("bg-BG", { timeZone: TZ, day: "numeric", month: "short" }),
  num: (d) => new Intl.NumberFormat("bg-BG", { minimumFractionDigits: d, maximumFractionDigits: d }),
};
const when = (ts) => F.dayTime.format(new Date(ts * 1000));
const dateOnly = (ts) => F.date.format(new Date(ts * 1000));

function rel(ts) {
  const diff = ts - now();
  const a = Math.abs(diff);
  let t;
  if (a < 60) t = "по-малко от минута";
  else if (a < 3600) t = `${Math.round(a / 60)} мин`;
  else if (a < 86400) { const h = Math.floor(a / 3600), m = Math.round((a % 3600) / 60); t = m ? `${h} ч ${m} мин` : `${h} ч`; }
  else { const d = Math.round(a / 86400); t = d === 1 ? "1 ден" : `${d} дни`; }
  return diff >= 0 ? `след ${t}` : `преди ${t}`;
}

function money(v, digits = 2) {
  if (v == null || !Number.isFinite(v)) return "—";
  const n = F.num(digits).format(Math.abs(v));
  const sign = v < 0 ? "−" : "";
  return S.settings.currency === "EUR" ? `${sign}${n} €` : `${sign}$${n}`;
}

const signed = (v, d = 2) => (v > 0 ? "+" : v < 0 ? "−" : "") + F.num(d).format(Math.abs(v));
const fmtR = (r) => `${signed(r, 2)}R`;
const pct = (v, d = 1) => `${signed(v, d)}%`;
const pairInfo = (pair) => S.data?.pairs?.[pair] || { digits: 5, pip: 0.0001, spread: 1, name: pair };
const px = (pair, v) => (v == null ? "—" : Number(v).toFixed(pairInfo(pair).digits));
const pips = (pair, a, b) => Math.abs(a - b) / pairInfo(pair).pip;
const riskMoney = () => (S.settings.balance ? (S.settings.balance * S.settings.risk) / 100 : null);

/** Резултат в R → пари при риска на потребителя (ако е въвел баланс). */
function rMoney(r) {
  const rm = riskMoney();
  return rm ? `${r >= 0 ? "+" : "−"}${money(Math.abs(r * rm)).replace("−", "")}` : fmtR(r);
}

/* ------------------------------------------------------------ данни */

const strategies = () => S.data?.strategies || [];
const stratById = (id) => strategies().find((s) => s.id === id);
const isCurrent = (sig) => sig.status === "pending" || sig.status === "open";
const watched = (id) => S.watch.has(id);
const resolveSignal = (id) => (S.data?.signals || []).find((s) => s.id === id) || S.watch.get(id)?.snapshot || S.observed.records[id]?.latest || null;
function quoteFresh(pair) {
  if (!S.data?.market?.open) return true;
  const quoteTime = Number(S.meta?.quotes?.[pair]?.time);
  const maxAge = Math.max(70 * 60, (S.data?.settings?.refresh_minutes || 20) * 3 * 60);
  return quoteTime > 0 && now() - quoteTime <= maxAge && quoteTime <= now() + 60;
}
function freshnessNotice(sig) {
  return !quoteFresh(sig.pair) ? `<div class="warn-line">⚠ Цените за ${esc(sig.pair)} са стари или липсват. Не използвай входното ниво, докато данните не се обновят.</div>` : "";
}
function watchButton(sig, extra = "") {
  const on = watched(sig.id);
  return `<button type="button" class="follow-btn watch-btn ${on ? "on" : ""} ${extra}" data-watch="${esc(sig.id)}" aria-pressed="${on}">${on ? "✓ Следиш сигнала" : "◎ Следи сигнала"}</button>`;
}

/* Оценка по двойка. Общата оценка смесва всички инструменти: стратегия може да е „Силна“ за
   златото и „Не работи“ за EUR/USD. Затова картите, сигналите и филтрите гледат конкретната двойка. */
const pairRow = (e, pair) => (e?.per_pair || []).find((p) => p.pair === pair) || null;
const pairVerdict = (e, pair) => FX.rowVerdict(pairRow(e, pair));
const strongPairs = (e) => (e?.per_pair || []).filter((p) => FX.rowVerdict(p) === "good");
/** Най-добрата оценка сред двойките; без данни по двойки - общата. */
function bestVerdict(e) {
  const rows = e.per_pair || [];
  if (!rows.length) return e.stats.verdict;
  return rows.map(FX.rowVerdict).sort((a, b) => VERDICT_ORDER[a] - VERDICT_ORDER[b])[0];
}
/** Редът на двойката, която стои зад най-добрата оценка. */
function bestPairRow(e) {
  const v = bestVerdict(e), rows = (e.per_pair || []).filter((p) => FX.rowVerdict(p) === v);
  return rows.sort((a, b) => (b.avg_r ?? -9) - (a.avg_r ?? -9))[0] || null;
}
const ratingOf = (e, pair = "") => (pair ? pairVerdict(e, pair) : bestVerdict(e));
const ratingAvg = (e, pair = "") => (pair ? pairRow(e, pair)?.avg_r : bestPairRow(e)?.avg_r ?? e.stats.avg_r) ?? -9;
const PAIR_PILL_TIP = (p, v) => `${p.name}: ${FX.VERDICT_LABELS[v]} · ${p.trades} сделки · средно ${p.avg_r == null ? "—" : fmtR(p.avg_r)} на сделка`;
function pairBadge(e, pair) {
  const v = pairVerdict(e, pair);
  return `<span class="verdict v-${esc(v)}" title="${esc(FX.PAIR_VERDICT_REASON[v])}">${FX.VERDICT_LABELS[v]} за ${esc(pairInfo(pair).name)}</span>`;
}
/** Главният етикет на картата: за кои двойки е „Силна“, иначе най-добрата оценка по двойки. */
function headlineBadge(e) {
  const strong = strongPairs(e);
  if (strong.length) return `<span class="verdict v-good" title="${esc(FX.PAIR_VERDICT_REASON.good)}">Силна за ${strong.length === 1 ? esc(strong[0].name) : `${strong.length} двойки`}</span>`;
  const v = bestVerdict(e);
  return `<span class="verdict v-${esc(v)}" title="Най-добрата оценка сред двойките. ${esc(FX.PAIR_VERDICT_REASON[v] || "")}">${FX.VERDICT_LABELS[v] || "Няма оценка"}</span>`;
}
function pairStrip(e) {
  const rows = e.per_pair || [];
  if (!rows.length) return "";
  return `<div class="pair-strip" role="list" aria-label="Оценка по двойки">${rows.map((p) => { const v = FX.rowVerdict(p); return `<span role="listitem" class="pair-pill v-${esc(v)}" title="${esc(PAIR_PILL_TIP(p, v))}">${esc(p.name)}</span>`; }).join("")}</div>`;
}

function sortedStrategies(pair = "") {
  return [...strategies()].sort((a, b) =>
    (VERDICT_ORDER[ratingOf(a, pair)] - VERDICT_ORDER[ratingOf(b, pair)]) || (ratingAvg(b, pair) - ratingAvg(a, pair)));
}

function defaultFollowed() {
  return defaultsForEntries(strategies());
}
const defaultsForEntries = (entries) => entries.filter((e) => !e.retired && (e.stats.verdict === "good" || (e.per_pair || []).some((p) => FX.pairChoice(e, p.pair, now()).allowed))).map((e) => e.id);
const followedIds = () => S.settings.followed ?? defaultFollowed();
const isFollowed = (id) => followedIds().includes(id);
const styleOk = (style) => S.settings.style === style;
const followedInStyle = () => followedIds().filter((id) => styleOk(stratById(id)?.style));

function mySignals({ all = false } = {}) {
  return (S.data?.signals || []).filter((s) => (all || isFollowed(s.strategy)) && styleOk(s.style) && pairSignalVisible(s));
}
const signalPairChoice = (sig) => FX.pairChoice(stratById(sig.strategy), sig.pair, now());
function pairSignalVisible(sig) {
  if (sig.retired && !watched(sig.id)) return false;
  return !S.settings.smartPairs || !isCurrent(sig) || watched(sig.id) || signalPairChoice(sig).allowed;
}
function pairChoiceText(entry) {
  const names = strongPairs(entry).map((p) => p.name);
  const overall = `Общо за всички двойки: ${FX.VERDICT_LABELS[entry.stats.verdict] || "няма оценка"}.`;
  return names.length ? `Силна за: ${names.join(", ")}. ${overall}` : `Няма двойка с оценка „Силна“. ${overall}`;
}
function pairTable(entry) {
  const r = (v) => Number.isFinite(v) ? fmtR(v) : "—";
  const rows = [...entry.per_pair].sort((a, b) => (VERDICT_ORDER[FX.rowVerdict(a)] - VERDICT_ORDER[FX.rowVerdict(b)]) || ((b.avg_r ?? -9) - (a.avg_r ?? -9)));
  return `<p class="what">${esc(pairChoiceText(entry))} Всяка двойка се оценява само по своите сделки. Процентът печеливши сам по себе си не решава оценката.</p>
    <div class="table-wrap"><table class="data pair-review-table"><thead><tr><th>Двойка</th><th>Оценка</th><th class="num">Сделки</th><th class="num">Печеливши</th><th class="num">Среден</th><th class="num">Печалба ÷ загуба</th><th class="num">Общо</th><th class="num">Последни 30%</th><th class="num">Двоен спред</th></tr></thead><tbody>
    ${rows.map((p) => {
      const v = FX.rowVerdict(p), ho = p.holdout || (p.review ? [p.review.holdout.trades, p.review.holdout.avg_r] : null), stress = p.stress_r ?? p.review?.stress.avg_r;
      const years = p.review?.years ? `<p class="what">${p.review.years.map((y) => `${y.year}: ${y.trades} / ${r(y.avg_r)}`).join(" · ")}</p>` : "";
      const pf = p.profit_factor == null ? (p.trades ? "∞" : "—") : F.num(2).format(p.profit_factor);
      return `<tr><td>${esc(p.name)}</td><td><details><summary><span class="verdict v-${esc(v)}">${FX.VERDICT_LABELS[v]}</span></summary><p class="what">${esc(FX.PAIR_VERDICT_REASON[v])}</p>${years}</details></td>
        <td class="num">${p.trades}</td><td class="num">${p.win_rate == null ? "—" : F.num(0).format(p.win_rate) + "%"}</td><td class="num ${p.avg_r >= 0 ? "pos" : "neg"}">${r(p.avg_r)}</td><td class="num">${pf}</td><td class="num">${r(p.total_r)}</td>
        <td class="num">${ho ? `${ho[0]} / ${r(ho[1])}` : "—"}</td><td class="num">${r(stress)}</td></tr>`;
    }).join("")}</tbody></table></div>`;
}

function pairCurrencies(pair) { return [pair.slice(0, 3), pair.slice(3, 6)]; }

function newsFor(currencies, from, to, levels = ["high", "medium"]) {
  return (S.data?.news || []).filter((e) => currencies.includes(e.currency) && levels.includes(e.impact) && e.time >= from && e.time <= to);
}

function horizonEnd(sig) {
  if (sig.style === "day") return Math.max(sig.valid_until + 2 * 3600, now() + 3600);
  return now() + (sig.tf === "D1" ? 7 : 3) * 86400;
}

function nextHighNews(sig, hours = 3) {
  if (!isCurrent(sig)) return null;
  const list = newsFor(pairCurrencies(sig.pair), now() - 15 * 60, now() + hours * 3600, ["high"]);
  return list[0] || null;
}

/** Поръчките на сигнала: при чакащ сигнал - всички (една или две), иначе - сделката. */
function ordersOf(sig) {
  if (sig.status === "pending" || sig.status === "cancelled") return sig.orders;
  const targets = (sig.parts || [{ w: 0.5 }, { w: 0.5 }]).map((p) => ({ w: p.w, level: p.tp }));
  return [{ dir: sig.dir, entry: sig.fill_price ?? sig.entry, stop: sig.stop0 ?? sig.stop, tp1: sig.tp1, tp2: sig.tp2, type: sig.order_type || "stop", targets }];
}

/** Колко части има сделката (1 = една поръчка, 2 = половината на Цел 1, другата на Цел 2). */
const partsOf = (o) => (o.targets ? o.targets.length : 2);
/** Единствено цел, която действително е поръчка в симулатора, може да бъде TP при брокера. */
function fixedTargets(_sig, o) {
  return targetCells(o, _sig).every(([, price]) => price != null);
}

/** 1R и 2R са геометрични ориентири от първоначалния риск, никога нови поръчки. */
function riskLandmarks(pair, order, sig = null) {
  const filled = sig && sig.status !== "pending" && sig.status !== "cancelled";
  const entry = Number(filled && sig.fill_price != null ? sig.fill_price : order.entry);
  const stop = Number(filled && sig.stop0 != null ? sig.stop0 : order.stop);
  const dir = Number(order.dir), digits = pairInfo(pair).digits;
  if (!Number.isFinite(entry) || !Number.isFinite(stop) || !Number.isInteger(digits)
    || digits < 0 || digits > 8 || entry <= 0 || stop <= 0
    || ![1, -1].includes(dir) || (entry - stop) * dir <= 0) return null;
  const dist = Math.abs(entry - stop);
  const at = (r) => Number((entry + dir * r * dist).toFixed(digits));
  return { entry, stop, one: at(1), two: at(2) };
}

function landmarkNote(pair, order, sig = null, compact = false) {
  const r = riskLandmarks(pair, order, sig);
  if (!r) return `<p class="what">Не може да се изчислят 1R/2R: провери входа и първоначалния стоп.</p>`;
  const one = px(pair, r.one), two = px(pair, r.two);
  if (compact) return `<div class="r-preview"><strong>+1R ${one}</strong><span>·</span><strong>+2R ${two}</strong><small>ориентири, не TP</small></div>`;
  return `<div class="r-guide"><div class="r-guide-head"><strong>Ориентири спрямо първоначалния риск</strong><span>Не са Take Profit поръчки</span></div>
    <div class="r-guide-levels"><div><span>+1R</span><strong>${one}</strong></div><div><span>+2R</span><strong>${two}</strong></div></div>
    <p>1R е разстоянието от ${px(pair, r.entry)} (вход) до ${px(pair, r.stop)} (начален стоп).
      Достигането на 1R или 2R <strong>само по себе си не означава</strong> да затваряш или да местиш стопа.
      Следвай правилото на стратегията по-долу. При реално изпълнение цените може да се различават.</p></div>`;
}
const ORDER_TYPES = {
  stop: ["Buy Stop", "Sell Stop", "купи, когато цената се качи до входа", "продай, когато цената слезе до входа"],
  limit: ["Buy Limit", "Sell Limit", "купи, когато цената се върне надолу до входа", "продай, когато цената се върне нагоре до входа"],
  market: ["Buy (пазарна)", "Sell (пазарна)", "купи веднага на пазарна цена", "продай веднага на пазарна цена"],
};
const orderType = (o) => ORDER_TYPES[o.type || "stop"][o.dir === 1 ? 0 : 1];
const orderHint = (o) => ORDER_TYPES[o.type || "stop"][o.dir === 1 ? 2 : 3];

/* ------------------------------------------------------------ калкулатор за лот */

function pipValue(pair) {
  const p = S.data?.pairs || {};
  const price = (k, fallback) => p[k]?.price || fallback;
  // EUR/USD, GBP/USD, AUD/USD, NZD/USD: $10 на пипс за 1 стандартен лот.
  // Злато: 1 лот = 100 унции, 1 пипс = 0.10$, значи също $10 на пипс.
  let usd = 10;
  if (pair === "USDJPY") usd = 1000 / price("USDJPY", 150);
  if (pair === "USDCHF") usd = 10 / price("USDCHF", 0.85);
  if (pair === "USDCAD") usd = 10 / price("USDCAD", 1.38);
  return S.settings.currency === "EUR" ? usd / price("EURUSD", 1.1) : usd;
}

function sizing(pair, order) {
  const bal = S.settings.balance;
  if (!bal || !order) return null;
  const info = pairInfo(pair);
  const rm = riskMoney();
  const stopPips = pips(pair, order.entry, order.stop);
  if (!Number.isFinite(stopPips) || stopPips <= 0 || !Number.isFinite(rm) || rm <= 0) return { invalid: true, tooSmall: true, stopPips: 0 };
  const tp1Pips = order.tp1 != null ? pips(pair, order.entry, order.tp1) : null;
  const tp2Pips = order.tp2 != null ? pips(pair, order.entry, order.tp2) : null;
  const pv = pipValue(pair);
  const spread = info.spread + (info.costs?.commission || 0) + (info.costs?.slippage || 0);
  if (!Number.isFinite(pv) || pv <= 0 || !Number.isFinite(spread) || spread < 0) return { invalid: true, tooSmall: true, stopPips };
  const lots = Math.floor((rm / ((stopPips + spread) * pv)) * 100 + 1e-9) / 100;
  const res = { rm, stopPips, tp1Pips, tp2Pips, pv, spread, lots, parts: partsOf(order) };
  if (lots < 0.01) {
    res.tooSmall = true;
    res.minBalance = Math.ceil((0.01 * (stopPips + spread) * pv) / (S.settings.risk / 100));
    return res;
  }
  if (res.parts > 1 && lots >= 0.02) {
    res.a = Math.floor(lots * 50 + 1e-9) / 100;
    res.b = Math.round((lots - res.a) * 100) / 100;
  } else {
    res.a = lots;
    res.b = 0;
  }
  res.loss = lots * (stopPips + spread) * pv;
  res.win1 = tp1Pips != null ? res.a * (tp1Pips - spread) * pv - res.b * spread * pv : null;
  res.win2 = res.b && tp1Pips != null && tp2Pips != null ? res.a * (tp1Pips - spread) * pv + res.b * (tp2Pips - spread) * pv : null;
  return res;
}

const lots = (v) => `${F.num(2).format(v)} лота`;

/* ------------------------------------------------------------ малки компоненти */

function dirBadge(sig) {
  if ((sig.status === "pending" || sig.status === "cancelled") && sig.orders.length > 1) return `<span class="dir dir-both">КУПИ или ПРОДАЙ</span>`;
  const d = sig.dir ?? sig.orders[0].dir;
  return d === 1 ? `<span class="dir dir-buy">КУПИ</span>` : `<span class="dir dir-sell">ПРОДАЙ</span>`;
}

function statusInfo(sig) {
  if (sig.status === "pending") return sig.valid_until <= now()
    ? { cls: "st-muted", label: "Срокът е минал", text: `Срокът за вход беше ${when(sig.valid_until)}. Ако няма потвърдено изпълнение при брокера, отмени поръчката и провери новите данни.` }
    : { cls: "st-pending", label: "Чака вход", text: `По модела входното ниво не е достигнато. Поръчката важи до ${when(sig.valid_until)}.` };
  if (sig.status === "open" && sig.half) return { cls: "st-open", label: "Цел 1 ✓", text: "Цел 1 е достигната по модела и част от позицията е затворена. Остава риск от спред, гап или неизпълнение на стопа." };
  if (sig.status === "open" && sig.stop != null && sig.fill_price != null && (sig.stop - sig.fill_price) * sig.dir >= 0) return { cls: "st-open", label: "Стоп при входа", text: `Моделът отчита вход ${px(sig.pair, sig.fill_price)} и стоп ${px(sig.pair, sig.stop)}. Реалният риск не е нула заради спред и възможен гап.` };
  if (sig.status === "open") return { cls: "st-open", label: "Активна по модела", text: `По ценовите данни входът е достигнат на ${px(sig.pair, sig.fill_price)} (${when(sig.fill_time)}). Изпълнението на твоята поръчка се потвърждава при брокера.` };
  if (sig.status === "cancelled") {
    return sig.reason === "void"
      ? { cls: "st-muted", label: "Отпадна", text: "Цената стигна стопа преди входа, затова сигналът отпадна без сделка." }
      : { cls: "st-muted", label: "Не се активира", text: "Цената не стигна входа навреме и поръчката е изтрита. Няма загуба." };
  }
  const label = `${REASONS[sig.reason] || "Приключена"} · ${fmtR(sig.r)}`;
  const cls = sig.r > 0.02 ? "st-win" : sig.r < -0.02 ? "st-loss" : "st-muted";
  return { cls, label, text: `Приключи ${when(sig.exit_time)} с резултат ${fmtR(sig.r)} (${rMoney(sig.r)}).` };
}

function verdictBadge(stats) {
  const names = { good: "Силна", weak: "Слаба", bad: "Не работи", few: "Недостатъчно сделки" };
  return `<span class="verdict v-${esc(stats.verdict)}" title="${esc(VERDICT_TIP[stats.verdict] || "")}">${names[stats.verdict] || "Няма оценка"}</span>`;
}

function impactPill(impact) {
  const names = { high: "Висока", medium: "Средна", low: "Ниска", holiday: "Почивен ден" };
  return `<span class="imp imp-${esc(impact)}">${names[impact] || esc(impact)}</span>`;
}

function emptyBox(icon, title, text, action = "") {
  return `<div class="empty"><div class="empty-icon">${icon}</div><h3>${title}</h3><p>${text}</p>${action}</div>`;
}

/** Индикаторно ниво в част от сделката не е автоматично поръчка за TP. */
function targetCells(o, sig = null) {
  const key = sig?.strategy ? sig.strategy.slice(0, sig.strategy.lastIndexOf("-")) : null;
  const planned = key && S.catalog?.[key]?.exit?.parts;
  const targets = o.targets;
  const prices = Array.isArray(targets) && targets.length
    ? targets.map((p) => (Number.isFinite(p.level) ? p.level : Number.isFinite(p.tp) ? p.tp : null))
    : [o.tp1 ?? null, o.tp2 ?? null];
  if (planned?.length === prices.length && !S.catalog?.[key]?.fixed_target) {
    for (let i = 0; i < prices.length; i++) {
      if (!(Number.isFinite(planned[i][1]) && planned[i][1] > 0)) prices[i] = null;
    }
  }
  if (prices.length === 1) return [["Цел", prices[0]]];
  return [["Цел 1", prices[0]], ["Цел 2", prices[1]]];
}

function levelsMini(pair, o, sig = null) {
  const cells = targetCells(o, sig);
  return `<div class="levels-mini" style="--target-cols:${2 + cells.length}">
    <div><span>Вход${o.type === "market" ? " ≈" : ""}</span><strong>${px(pair, o.entry)}</strong></div>
    <div class="loss"><span>Стоп</span><strong>${px(pair, o.stop)}</strong></div>
    ${cells.map(([name, v]) => `<div class="profit"><span>${name}</span><strong>${v == null ? "по правило" : px(pair, v)}</strong></div>`).join("")}</div>
    ${o.activate_after && sig?.status === "pending" ? `<p class="what">Активиране от ${esc(when(o.activate_after))}. По-ранно докосване отменя модела.</p>` : ""}${landmarkNote(pair, o, sig, true)}`;
}

function signalCard(sig) {
  const st = statusInfo(sig);
  const strat = stratById(sig.strategy);
  const orders = ordersOf(sig);
  const size = sizing(sig.pair, orders[0]);
  let sizeText = `<span>Въведи баланс, за да видиш лота</span>`;
  if (size?.tooSmall) sizeText = `<span>Не може да се определи безопасен обем за този стоп</span>`;
  else if (size) sizeText = `<span>Твоят обем: <strong>${lots(size.lots)}</strong>${size.b ? ` (${F.num(2).format(size.a)} + ${F.num(2).format(size.b)})` : ""} · риск ${money(size.loss)}</span>`;
  const news = nextHighNews(sig);
  const body = orders.length > 1
    ? `<div class="oco-label">▲ Покупка над ${px(sig.pair, orders[0].entry)} · ▼ Продажба под ${px(sig.pair, orders[1].entry)} — която се задейства първа</div>${levelsMini(sig.pair, orders[0], sig)}`
    : levelsMini(sig.pair, orders[0], sig);
  let foot = isCurrent(sig)
    ? (sig.status === "pending" ? `Важи до <strong>${when(sig.valid_until)}</strong>` : `Отворена ${when(sig.fill_time)}`)
    : `Сигнал от ${when(sig.signal_time)}`;
  if (!isCurrent(sig)) sizeText = `<span>Резултат: <strong class="${sig.r > 0 ? "pos" : sig.r < 0 ? "neg" : ""}">${sig.r != null ? `${fmtR(sig.r)} (${rMoney(sig.r)})` : "без сделка"}</strong></span>`;
  const choice = signalPairChoice(sig);
  const choiceNote = choice.allowed ? "" : choice.status === "stale" ? `Нужен нов тест за ${sig.pair_name}.` : `Провери оценката за ${sig.pair_name}.`;
  return `<article class="sig-card ${isCurrent(sig) ? "" : "closed"}">
    <a class="sig-card-main" href="#/signal/${encodeURIComponent(sig.id)}"><div class="sig-head"><div class="sig-title">${dirBadge(sig)}<h3>${esc(sig.pair_name)}</h3></div><span class="st ${st.cls}">${esc(st.label)}</span></div>
    <div class="sig-sub">${esc(sig.strategy_name)} · ${esc(sig.tf_label)} · ${STYLE_NAMES[sig.style]} ${strat ? pairBadge(strat, sig.pair) : ""}</div>
    ${choiceNote ? `<p class="what">${esc(choiceNote)}</p>` : ""}
    ${signalAvailability(sig)}
    ${body}
    ${news ? `<div class="warn-line">⚠ Силна новина за ${esc(news.currency)} ${rel(news.time)}: ${esc(news.title_bg)}</div>` : ""}
    ${freshnessNotice(sig)}
    <div class="sig-foot">${sizeText}<span>${foot} →</span></div></a>
    <div class="sig-watch-actions">${watchButton(sig)}<a href="#/signal/${encodeURIComponent(sig.id)}" class="btn btn-quiet btn-sm">Подробности</a></div>
  </article>`;
}

function sparkline(curve, h = 54) {
  if (!curve || curve.length < 2) return "";
  const w = 300;
  const vals = curve.map((p) => p[1]);
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals);
  const span = max - min || 1;
  const x = (i) => (i / (curve.length - 1)) * w;
  const y = (v) => 4 + (max - v) / span * (h - 8);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = vals[vals.length - 1];
  const color = last >= 0 ? "#c5f58c" : "#fc928e";
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <line x1="0" x2="${w}" y1="${y(0)}" y2="${y(0)}" stroke="#3a4855" stroke-dasharray="3 4"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}

/** Стратегиите от книгите следват общите правила (две цели, стоп на входа). Останалите имат свои правила за изход. */
const ownExit = (strat) => !!strat && strat.origin !== "book";
function approximationTag(e) {
  return `${e.provisional ? '<span class="tag tag-approx" title="Нужна е проверка с неизползвани данни или проследяване занапред.">За тест</span>' : ""} ${e.approx ? '<span class="tag tag-approx" title="Собствена адаптация по публични правила. Резултатите са за описаната тук реализация.">адаптация</span>' : ""}`;
}

function strategyFollowButton(entry, detail = false) {
  if (entry.retired) return '<span class="tag">Архив · запазени правила за проследяване</span>';
  const followed = isFollowed(entry.id);
  return `<button type="button" class="follow-btn ${followed ? "on" : ""}" data-follow="${esc(entry.id)}">${followed ? "✓ Следвам" : "+ Следвай"}${detail ? " тази стратегия" : ""}</button>`;
}

function pairsLabel(e) {
  const all = Object.keys(S.data?.pairs || {});
  if (!e.pairs || e.pairs.length >= all.length) return "всички двойки";
  return e.pairs.map((p) => pairInfo(p).name).join(", ");
}

function stratCard(e, chosen = "") {
  // Числата на картата са за избраната двойка, а без избор - за двойката с най-добра оценка.
  const s = e.stats, pair = chosen || bestPairRow(e)?.pair || "", row = pair ? pairRow(e, pair) : null;
  const followed = isFollowed(e.id);
  const rm = riskMoney();
  const shown = pair ? row || { trades: 0 } : s;
  const stats = shown.trades ? `<div class="stat-mini">
      <div><span>Печеливши</span><strong>${F.num(0).format(shown.win_rate)}%</strong></div>
      <div><span>Среден резултат</span><strong class="${shown.avg_r > 0 ? "pos" : "neg"}">${fmtR(shown.avg_r)}</strong></div>
      <div><span>Най-голям спад*</span><strong>${pct(-shown.max_dd_r * S.settings.risk)}</strong></div>
      ${pair ? `<div><span>Сделки</span><strong>${shown.trades}</strong></div>` : `<div><span>Загуби подред</span><strong>${s.max_losing_streak}</strong></div>`}</div>`
    : `<p class="muted" style="font-size:12px;margin-top:12px">${pair ? `Няма сделки на ${esc(pairInfo(pair).name)} в теста.` : "Още няма сделки в теста."}</p>`;
  const foot = pair
    ? `${shown.trades} сделки на ${esc(pairInfo(pair).name)} · общо ${s.trades} за всички двойки${rm && shown.trades ? ` · средно ${rMoney(shown.avg_r)} на сделка` : ""}`
    : `${s.trades} сделки · ~${F.num(1).format(s.per_month || 0)} на месец · ${s.trades ? `${F.monthYear.format(new Date(s.start * 1000))} – ${F.monthYear.format(new Date(s.end * 1000))}` : ""}${rm && s.trades ? ` · средно ${rMoney(s.avg_r)} на сделка` : ""}`;
  return `<article class="strat-card ${followed ? "followed" : ""}">
    <div class="strat-top"><div><h3><a class="link" style="color:inherit" href="#/strategy/${esc(e.id)}">${esc(e.name)}</a></h3>
      <div class="strat-meta">${esc(e.tf_label)} · ${STYLE_NAMES[e.style]} · ${pairsLabel(e)} ${approximationTag(e)}</div></div>${chosen ? pairBadge(e, chosen) : headlineBadge(e)}</div>
    <p class="strat-short">${esc(e.short)}</p>
    ${pairStrip(e)}
    <p class="what">${esc(pairChoiceText(e))}</p>
    ${pair ? `<p class="kicker" style="margin-top:10px">${chosen ? "" : "НАЙ-ДОБРА ДВОЙКА · "}${esc(pairInfo(pair).name)}</p>` : ""}
    ${sparkline(pair ? row?.curve : s.curve)}
    ${stats}
    <div class="strat-foot"><small>${foot}</small>
      <span class="chips-row"><a class="btn btn-quiet btn-sm" href="#/strategy/${esc(e.id)}">Подробно</a>
      ${strategyFollowButton(e)}</span></div>
  </article>`;
}


/* ------------------------------------------------------------ наблюдавани сигнали */
function toggleWatch(id) {
  const sig = resolveSignal(id);
  if (!sig) return toast("Сигналът не е наличен.");
  if (watched(id)) {
    if (!S.watch.remove(id)) return toast("Неуспешен запис в браузъра.");
    toast("Сигналът е премахнат от следените.");
  } else {
    if (!S.watch.add(sig)) return toast("Неуспешен запис или лимит от 100 сигнала.");
    toast("Следиш точно този сигнал в този браузър.");
  }
  render();
}
function removeWatch(id) {
  if (S.watch.remove(id)) { toast("Спря следенето на сигнала."); render(); }
  else toast("Неуспешно премахване.");
}
function watchDetail(sig) {
  const w = S.watch.get(sig.id);
  if (!w) return `<div class="watch-hint">За да запазиш историята на този сигнал, натисни „Следи сигнала“. Следенето работи в този браузър при отворен сайт.</div>`;
  const events = [...w.events].sort((a, b) => (a.at || a.observed || 0) - (b.at || b.observed || 0));
  const archived = !(S.data?.signals || []).some((s) => s.id === sig.id);
  const entry = w.actualEntry;
  return `<section class="panel watch-panel">
    <div class="panel-head"><div><p class="kicker">ЛИЧНО НАБЛЮДЕНИЕ</p><h3>История на сигнала</h3></div><a class="text-link" href="#/watch">Моите следени ↗</a></div>
    ${archived ? `<div class="warn-line">Това е последното запазено състояние, не текущо потвърждение от пазара.</div>` : ""}
    <form id="entry-confirm-form" class="entry-confirm-form">
      <input type="hidden" name="signal-id" value="${esc(sig.id)}">
      <label><input type="checkbox" name="entered" ${w.entered ? "checked" : ""}> Аз действително влязох при брокера</label>
      <label>Моята входна цена (по избор) <input type="number" name="actual-price" step="any" min="0" value="${entry?.price ?? ""}" placeholder="напр. 1.08350"></label>
      <button type="submit" class="btn btn-outline btn-sm">Запази</button>
    </form>
    <p class="what">Докоснат вход в моделните свещи ≠ изпълнена поръчка. Потвърждението е лично и не се изпраща на сървъра.</p>
    <ol class="watch-events">${events.map((e) => `<li><time>${e.at ? when(e.at) : `Забелязано ${when(e.observed)}`}</time><span>${esc(e.text)}</span></li>`).join("")}</ol>
  </section>`;
}
function viewWatch() {
  const list = S.watch.list().filter((w) => styleOk(w.snapshot.style || FX.TIMEFRAMES[w.snapshot.tf]?.style));
  const active = list.filter((w) => isCurrent(w.snapshot)).length;
  return `<div class="page-heading"><div><p class="kicker">МОИТЕ СЛЕДЕНИ</p><h1>Следени сигнали</h1>
    <p>Следи отделни сигнали, проверявай кога са достигнали вход, цел или стоп, и потвърждавай отделно позициите си при брокера.</p></div>
    <span class="page-flag">${active} активни · ${list.length} общо</span></div>
    <div class="warn-line info" style="margin-bottom:14px">Историята се пази само в този браузър. Промените се виждат при зареден сайт и успешно обновени данни; няма известия при затворен браузър. Това е ценови модел, не потвърждение от брокера.</div>
    ${list.length ? `<div class="sig-grid">${list.map((w) => `<div class="watch-item">${signalCard(resolveSignal(w.id) || w.snapshot)}
      <div class="watch-summary"><span>${w.entered ? "✓ Потвърдена лична позиция" : "Няма потвърдена лична позиция"}</span>
      <button class="tiny-btn danger" type="button" data-unwatch="${esc(w.id)}">Премахни от следените</button></div></div>`).join("")}</div>`
      : emptyBox("◎", "Още не следиш сигнали", "Отвори „Сигнали“, избери конкретен сигнал и натисни „Следи сигнала“.", `<a class="btn btn-primary" href="#/signals">Към сигналите ↗</a>`)}`;
}

/* ------------------------------------------------------------ графики */

function candleSVG(bars, sig, width) {
  const W = Math.max(300, Math.round(width || 760)), H = 290, L = 6, R = 104, T = 12, B = 24;
  const pair = sig.pair;
  const orders = ordersOf(sig);
  const lines = [];
  orders.forEach((o, k) => {
    const tag = orders.length > 1 ? (o.dir === 1 ? " ▲" : " ▼") : "";
    lines.push({ v: o.entry, label: `Вход${tag}`, color: "#e8eef0" });
    if (!(orders.length > 1 && k === 1 && o.stop === orders[0].stop)) lines.push({ v: o.stop, label: `Стоп${tag}`, color: "#fc928e" });
    if (orders.length === 1) {
      const fixed = targetCells(o, sig);
      fixed.forEach(([name, v], j) => {
        if (v != null) lines.push({ v, label: name, color: j ? "#c5f58c" : "#9fe4ac" });
      });
      const r = riskLandmarks(pair, o, sig);
      if (r) [r.one, r.two].forEach((v, j) => {
        if (!fixed.some(([, target]) => target != null && Math.abs(target - v) < Math.pow(10, -pairInfo(pair).digits) / 2))
          lines.push({ v, label: `${j + 1}R ор.`, color: "#7590a2", dash: true });
      });
    }
  });
  if (sig.status === "open" && sig.stop != null && sig.stop !== (sig.stop0 ?? sig.stop)) {
    lines.push({ v: sig.stop, label: "Стоп сега", color: "#f6cd8e" });
  }
  const vals = bars.flatMap((b) => [b[2], b[3]]).concat(lines.map((l) => l.v));
  let min = Math.min(...vals), max = Math.max(...vals);
  const pad = (max - min) * 0.06 || 0.001;
  min -= pad; max += pad;
  const n = bars.length;
  const step = (W - L - R) / Math.max(n, 1);
  const x = (i) => L + step * (i + 0.5);
  const y = (v) => T + ((max - v) / (max - min)) * (H - T - B);
  const cw = Math.max(1.5, step * 0.62);
  const grid = [0, 1, 2, 3].map((k) => { const yy = T + (k * (H - T - B)) / 3; return `<line x1="${L}" x2="${W - R + 4}" y1="${yy}" y2="${yy}" stroke="#22303c" stroke-dasharray="3 5"/>`; }).join("");
  const candles = bars.map((b, i) => {
    const up = b[4] >= b[1];
    const col = up ? "#9fe4ac" : "#fc928e";
    const top = y(Math.max(b[1], b[4])), bot = y(Math.min(b[1], b[4]));
    return `<line x1="${x(i)}" x2="${x(i)}" y1="${y(b[2])}" y2="${y(b[3])}" stroke="${col}" stroke-width="1"/>` +
      `<rect x="${x(i) - cw / 2}" y="${top}" width="${cw}" height="${Math.max(1, bot - top)}" fill="${col}" opacity="${up ? 0.85 : 0.75}"/>`;
  }).join("");
  const tfSec = TF_SEC[sig.tf] || 3600;
  const sigIdx = bars.findIndex((b) => b[0] === sig.signal_time - tfSec);
  const marker = sigIdx >= 0 ? `<line x1="${x(sigIdx)}" x2="${x(sigIdx)}" y1="${T}" y2="${H - B}" stroke="#f6cd8e" stroke-dasharray="2 4"/><text x="${x(sigIdx) + 4}" y="${T + 10}" font-size="10" fill="#f6cd8e">сигнал</text>` : "";
  // Надписите вдясно не трябва да се застъпват: подреждаме ги отгоре надолу с разстояние поне 19px.
  const gap = 19, top = T + 9, bottom = H - B - 9;
  const order = lines.map((l, k) => ({ k, y: y(l.v) })).sort((a, b) => a.y - b.y);
  order.forEach((p, i) => { p.y = Math.max(p.y, top, i ? order[i - 1].y + gap : top); });
  for (let i = order.length - 1; i >= 0; i--) {
    order[i].y = Math.min(order[i].y, i === order.length - 1 ? bottom : order[i + 1].y - gap);
  }
  const labelY = {};
  order.forEach((p) => { labelY[p.k] = p.y; });
  const lvl = lines.map((l, k) => {
    const ly = labelY[k];
    return `<line x1="${L}" x2="${W - R + 4}" y1="${y(l.v)}" y2="${y(l.v)}" stroke="${l.color}" stroke-dasharray="${l.dash ? "2 6" : "5 4"}" opacity="${l.dash ? ".75" : ".9"}"/>` +
      `<rect x="${W - R + 6}" y="${ly - 9}" width="${R - 8}" height="18" rx="4" fill="#111a22" stroke="${l.color}" stroke-opacity=".6"/>` +
      `<text x="${W - R + 11}" y="${ly + 4}" font-size="10" fill="${l.color}">${esc(l.label)} ${px(pair, l.v)}</text>`;
  }).join("");
  const labels = [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1].filter((v, i, a) => v >= 0 && a.indexOf(v) === i).map((i) => {
    const d = new Date(bars[i][0] * 1000);
    const t = sig.tf === "D1" ? F.dayMonth.format(d) : `${F.dayMonth.format(d)} ${F.time.format(d)}`;
    return `<text x="${x(i)}" y="${H - 6}" font-size="10" fill="#677c8a" text-anchor="middle">${t}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Графика на ${esc(sig.pair_name)} с нивата на сигнала">${grid}${candles}${marker}${lvl}${labels}</svg>`;
}

function equitySVG(curve, width) {
  if (!curve || curve.length < 2) return emptyBox("◇", "Няма достатъчно сделки", "Графиката ще се появи, когато стратегията има сделки в теста.");
  const W = Math.max(300, Math.round(width || 760)), H = 220, L = 8, R = 60, T = 12, B = 22;
  const risk = S.settings.risk;
  const vals = curve.map((p) => p[1] * risk);
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals);
  const span = max - min || 1;
  const x = (i) => L + (i / (curve.length - 1)) * (W - L - R);
  const y = (v) => T + ((max - v) / span) * (H - T - B);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `M${x(0)},${y(0)} L${pts.split(" ").join(" L")} L${x(vals.length - 1)},${y(0)} Z`;
  const last = vals[vals.length - 1];
  const color = last >= 0 ? "#c5f58c" : "#fc928e";
  const ticks = [max, (max + min) / 2, min].map((v) => `<text x="${W - R + 6}" y="${y(v) + 4}" font-size="10" fill="#7f909c">${pct(v, 0)}</text>`).join("");
  const labels = [0, Math.floor(curve.length / 2), curve.length - 1].map((i) => `<text x="${x(i)}" y="${H - 5}" font-size="10" fill="#677c8a" text-anchor="${i === 0 ? "start" : i === curve.length - 1 ? "end" : "middle"}">${F.monthYear.format(new Date(curve[i][0] * 1000))}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Развитие на сметката по време на теста">
    <defs><linearGradient id="eq" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="#3a4855" stroke-dasharray="3 4"/>
    <path d="${area}" fill="url(#eq)"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    ${ticks}${labels}</svg>`;
}

function loadChart(sig) {
  const host = document.getElementById("sig-chart");
  if (!host) return;
  const s = S.engine && S.engine.get(sig.pair, sig.tf);
  const bars = [];
  if (s) {
    const end = isCurrent(sig) ? Infinity : (sig.exit_time || sig.valid_until) + TF_SEC[sig.tf] * 8;
    let idx = s.n;
    while (idx > 0 && s.t[idx - 1] > end) idx--;
    for (let k = Math.max(0, idx - 80); k < idx; k++) bars.push([s.t[k], s.o[k], s.h[k], s.l[k], s.c[k]]);
  }
  host.innerHTML = bars.length ? candleSVG(bars, sig, host.clientWidth) : `<p class="muted">Няма данни за графиката.</p>`;
}

function drawEquity(e) {
  const host = document.getElementById("equity-box");
  if (host) host.innerHTML = equitySVG(e.stats.curve, host.clientWidth);
}

/* ------------------------------------------------------------ изгледи */

function viewLoading() {
  const msg = S.error || "Зареждам цените и смятам сигналите…";
  return `<div class="loading"><div><div class="spinner"></div><h2>Подготвям сайта</h2><p>${esc(msg)}</p>
    <p class="muted" style="font-size:12px">Първото зареждане може да отнеме няколко секунди. Ако остане този екран, презареди с Ctrl+F5 и провери дали кодовите файлове са от една версия.</p></div></div>`;
}

function onboardingCard() {
  return `<section class="panel onboard">
    <p class="kicker">ЗАПОЧНИ ТУК · ОТНЕМА 30 СЕКУНДИ</p>
    <h1>Въведи баланса, <span>за да пресмятаме ориентировъчен лот по риска.</span></h1>
    <p class="lead">Всеки сигнал показва вход, стоп и цели по исторически модел. Лотът е ориентировъчен според риска; реалният спред, гаповете и маржинът при брокера могат да променят резултата.</p>
    <form id="onboard-form">
      <div class="onboard-steps">
        <div class="onboard-step"><span class="num">СТЪПКА 1</span><strong>Колко пари има в сметката ти?</strong>
          <div class="inline-input"><input name="balance" type="number" inputmode="decimal" min="50" max="10000000" step="any" placeholder="напр. 2000" required aria-label="Баланс">
          <select name="currency" aria-label="Валута"><option value="USD">USD $</option><option value="EUR">EUR €</option></select></div>
          <small>Пази се само в този браузър.</small></div>
        <div class="onboard-step"><span class="num">СТЪПКА 2</span><strong>Колко рискуваш на сделка?</strong>
          <div class="choice">
            <label><input type="radio" name="risk" value="0.25"><span>0.25%</span></label>
            <label><input type="radio" name="risk" value="0.5" checked><span>0.5%<em>препоръчително</em></span></label>
            <label><input type="radio" name="risk" value="1"><span>1%<em>максимум</em></span></label></div>
          <small>При 0.5% и $2 000 планираният риск е $10 на сделка.</small></div>
        <div class="onboard-step"><span class="num">СТЪПКА 3</span><strong>Как търгуваш?</strong>
          <div class="choice">
            <label><input type="radio" name="style" value="day" ${S.settings.style === "day" ? "checked" : ""}><span>Дневна</span></label>
            <label><input type="radio" name="style" value="swing" ${S.settings.style === "swing" ? "checked" : ""}><span>Суинг</span></label>
</div>
          <small>Дневна: сделките се затварят до вечерта. Суинг: държат се няколко дни.</small></div>
      </div>
      <button type="submit" class="btn btn-primary">Запази и покажи сигналите ↗</button>
    </form></section>`;
}

function profileStrip() {
  const st = S.settings;
  return `<section class="profile-strip"><div class="facts">
      <div class="fact"><span>БАЛАНС</span><strong>${money(st.balance, 0)}</strong></div>
      <div class="fact"><span>РИСК НА СДЕЛКА</span><strong>${F.num(2).format(st.risk)}%</strong><small>= ${money(riskMoney())}</small></div>
      <div class="fact"><span>СТИЛ</span><strong>${STYLE_NAMES[st.style]}</strong></div>
      <div class="fact"><span>СЛЕДВАШ</span><strong>${followedInStyle().length} стратегии</strong></div></div>
    <a class="btn btn-outline btn-sm" href="#/settings">Промени</a></section>`;
}

function viewDashboard() {
  const d = S.data;
  const current = mySignals().filter(isCurrent);
  const pending = current.filter((s) => s.status === "pending").length;
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
  const highToday = newsFor(MY_CURRENCIES, now(), todayEnd.getTime() / 1000, ["high"]).length;
  const upcoming = newsFor(MY_CURRENCIES, now() - 30 * 60, now() + 48 * 3600, ["high"]).slice(0, 6);
  const best = sortedStrategies().filter((s) => styleOk(s.style)).filter((s) => bestVerdict(s) === "good" || bestVerdict(s) === "weak").slice(0, 3);
  const bestLine = (e) => {
    const p = bestPairRow(e), x = p || e.stats;
    return `${p ? `${esc(p.name)}: ` : ""}${F.num(0).format(x.win_rate || 0)}% печеливши · средно ${fmtR(x.avg_r || 0)} на сделка · ${x.trades} сделки`;
  };
  const followedCount = followedInStyle().length;
  let sigBody;
  if (!followedCount) sigBody = emptyBox("◈", "Не следваш нито една стратегия", "Избери поне една стратегия и тук ще виждаш нейните сигнали.", `<a class="btn btn-primary" href="#/strategies">Към стратегиите ↗</a>`);
  else if (!current.length) sigBody = emptyBox("⌁", "В момента няма сигнали", `Стратегиите, които следваш, нямат сигнал точно сега. Цените се проверяват на всеки ${d.settings?.refresh_minutes || 10} минути и новите сигнали се появяват тук.`, `<a class="btn btn-outline" href="#/signals">Виж последните приключили ↗</a>`);
  else sigBody = `<div class="sig-list">${current.slice(0, 6).map(signalCard).join("")}</div>`;
  return `
    ${S.settings.balance ? profileStrip() : onboardingCard()}
    <div class="metrics-grid">
      <div class="metric-card"><div class="metric-top">Сигнали сега <span class="metric-icon">⌁</span></div><div class="metric-value">${current.length} <span class="metric-sub">${pending} чакат вход</span></div><div class="metric-foot">от стратегиите, които следваш</div></div>
      <div class="metric-card"><div class="metric-top">Силни новини днес <span class="metric-icon">◷</span></div><div class="metric-value">${highToday}</div><div class="metric-foot">за USD, EUR, GBP, JPY, AUD, CHF, CAD, NZD</div></div>
      <div class="metric-card"><div class="metric-top">Пазарът <span class="metric-icon">◎</span></div><div class="metric-value status-text" style="color:${d.market?.open ? "var(--accent)" : "var(--amber)"}">${d.market?.open ? "Отворен" : "Затворен"}</div><div class="metric-foot">${d.market?.open ? "Форекс работи 24 ч от понеделник до петък" : "Отваря в неделя вечер (около 23:00–00:00)"}</div></div>
      <div class="metric-card"><div class="metric-top">Цените <span class="metric-icon">↻</span></div><div class="metric-value" style="font-size:20px">${d.prices_updated ? rel(d.prices_updated) : "—"}</div><div class="metric-foot">обновяват се на всеки ${d.settings?.refresh_minutes || 10} мин</div></div>
    </div>
    <div class="grid-2" style="margin-top:14px">
      <section class="panel"><div class="panel-head"><div><p class="kicker">СИГНАЛИ СЕГА</p><h3>Налични сигнали</h3></div><a class="text-link" href="#/signals">Всички <span>↗</span></a></div>${sigBody}</section>
      <div class="stack">
        <section class="panel"><div class="panel-head"><div><p class="kicker">ЦЕНИ</p><h3>Валутни двойки</h3></div><span class="muted-small">промяна за деня</span></div>${pricesList()}</section>
        <section class="panel"><div class="panel-head"><div><p class="kicker">НОВИНИ · СЛЕДВАЩИТЕ 48 Ч</p><h3>Силни новини</h3></div><a class="text-link" href="#/news">Календар <span>↗</span></a></div>
          ${upcoming.length ? upcoming.map(newsCompact).join("") : `<p class="muted" style="font-size:12px">Няма силни новини в следващите 48 часа.</p>`}</section>
        <section class="panel"><div class="panel-head"><div><p class="kicker">НАЙ-ДОБРИ В ТЕСТА</p><h3>Стратегии</h3></div><a class="text-link" href="#/strategies">Всички <span>↗</span></a></div>
          ${best.length ? best.map((e) => `<a class="news-compact" style="color:inherit;text-decoration:none" href="#/strategy/${esc(e.id)}"><span class="when">${headlineBadge(e)}</span><span><strong>${esc(e.name)} · ${esc(e.tf_label)}</strong><small>${bestLine(e)}</small></span></a>`).join("") : `<p class="muted" style="font-size:12px">Нито една стратегия не минава теста в момента.</p>`}</section>
      </div>
    </div>`;
}

function pricesList() {
  const pairs = S.data?.pairs || {};
  return Object.entries(pairs).map(([k, p]) => `<div class="price-row"><span><strong>${esc(p.name)}</strong><small class="quote-time">${p.price_time ? `${quoteFresh(k) ? "Последна" : "Стара котировка"}: ${esc(when(p.price_time))}` : "Няма текуща котировка"}</small></span><span>${px(k, p.price)}</span>
    <span class="chg ${p.change_pct > 0 ? "pos" : p.change_pct < 0 ? "neg" : ""}">${p.change_pct == null ? "—" : pct(p.change_pct, 2)}</span></div>`).join("");
}

function newsCompact(e) {
  return `<div class="news-compact"><span class="when">${esc(when(e.time))}<br><small>${rel(e.time)}</small></span>
    <span><strong><span class="cur">${esc(e.currency)}</span> ${esc(e.title_bg)}</strong>${e.explain ? `<small>${esc(e.explain)}</small>` : ""}${newsPulsButton(e)}</span></div>`;
}

function viewSignals() {
  const base = mySignals({ all: S.showAll });
  const hidden = (S.data?.signals || []).filter((sig) => isCurrent(sig) && styleOk(sig.style) && (S.showAll || isFollowed(sig.strategy)) && !pairSignalVisible(sig)).length;
  const q = S.pairQuery.trim().toLowerCase().replace("/", "");
  const match = (s) => !q || s.pair.toLowerCase().includes(q);
  const current = base.filter(isCurrent).filter(match);
  const done = base.filter((s) => !isCurrent(s)).filter(match).sort((a, b) => (b.exit_time || 0) - (a.exit_time || 0));
  const list = S.sigFilter === "now" ? current : done;
  const closedOnly = done.filter((s) => s.status === "closed");
  const sumR = closedOnly.reduce((a, s) => a + s.r, 0);
  let body;
  if (list.length) body = `<div class="sig-grid">${S.sigFilter === "now" ? signalGroups(list) : list.map(signalCard).join("")}</div>`;
  else if (S.sigFilter === "now") body = emptyBox("⌁", "Няма сигнали в момента", noSignalsReason(), `<a class="btn btn-outline" href="#/strategies">Стратегии ↗</a>`);
  else body = emptyBox("▤", "Няма приключени сигнали", "През последните 14 дни няма приключени сигнали от избраните стратегии.");
  return `
    <div class="page-heading"><div><p class="kicker">СИГНАЛИ</p><h1>Сигнали</h1>
      <p>Сигналите от стратегиите, които следваш${S.settings.style !== "all" ? ` (само ${STYLE_NAMES[S.settings.style].toLowerCase()} търговия)` : ""}. Натисни сигнал, за да видиш точно какво да направиш.</p></div>
      <span class="page-flag"><span class="status-dot"></span> ${current.length} активни сега</span></div>
    ${evaluationNotice()}${portfolioRiskNotice()}${FX.PAIR_KEYS.map(conflictNotice).join("")}
    <div class="filter-bar"><div class="filter-group">
        <button class="chip ${S.sigFilter === "now" ? "active" : ""}" data-sigfilter="now">Сега (${current.length})</button>
        <button class="chip ${S.sigFilter === "done" ? "active" : ""}" data-sigfilter="done">Приключили, 14 дни (${done.length})</button>
        <a class="chip" href="#/watch">◎ Следени (${S.watch.list().length})</a>
        <button class="chip ${S.showAll ? "active" : ""}" data-showall>${S.showAll ? "✓ " : ""}И от стратегии, които не следвам</button></div>
      <label class="search-wrap"><span>⌕</span><input type="search" id="pair-search" value="${esc(S.pairQuery)}" placeholder="Търси двойка, напр. EUR/USD" aria-label="Търси двойка"></label></div>
    ${S.sigFilter === "done" && closedOnly.length ? `<div class="warn-line info" style="margin:0 0 14px">Последни 14 дни: ${closedOnly.length} сделки, общо ${fmtR(sumR)} (${rMoney(sumR)} при твоя риск). Сделките, които не са се активирали, не носят загуба.</div>` : ""}
    <p class="what">${S.settings.smartPairs ? `Показват се сигнали само за двойките, на които стратегията е „Силна“. ${hidden} текущи модела са скрити заради оценката за съответната двойка. Следените сигнали остават достъпни.` : "Подборът по двойки е изключен: показват се сигнали за всички двойки."} <a href="#/settings">Настройки</a></p>
    ${body}`;
}

function sizeBlock(sig, o, idx, total) {
  const size = sizing(sig.pair, o);
  const title = total > 1 ? `<div class="order-title">${o.dir === 1 ? "▲ Ако пробие нагоре — покупка" : "▼ Ако пробие надолу — продажба"}</div>` : "";
  if (!S.settings.balance) {
    return `<div class="order-block">${title}<div class="risk-notice">Въведи баланса си горе, за да видиш ориентировъчен обем и риск. Провери ограниченията на брокера.</div></div>`;
  }
  if (size.invalid) return `<div class="order-block">${title}<div class="risk-notice">Липсват валидни нива или цени за безопасно изчисляване на лот. Не отваряй позиция по тази сметка.</div></div>`;
  if (size.tooSmall) {
    return `<div class="order-block">${title}<div class="risk-notice">При баланс ${money(S.settings.balance, 0)} и риск ${S.settings.risk}% обемът излиза под минималния (0.01 лота). Стопът е ${F.num(1).format(size.stopPips)} пипса. <strong>Пропусни този сигнал</strong> или го търгувай при баланс от поне ${money(size.minBalance, 0)}.</div></div>`;
  }
  const two = size.parts > 1;
  const fixed = fixedTargets(sig, o);
  const split = two && size.b
    ? `две части: ${F.num(2).format(size.a)} лота за Цел 1 и ${F.num(2).format(size.b)} лота за Цел 2`
    : two ? "една поръчка (обемът е твърде малък, за да се раздели)" : "една поръчка";
  const cells = [
    `<div class="size-cell big"><span>Общ обем (лот)</span><strong>${lots(size.lots)}</strong><span style="margin:6px 0 0">${split}</span></div>`,
    `<div class="size-cell"><span>Ако удари стопа</span><strong class="neg">−${money(size.loss).replace("−", "")}</strong></div>`,
  ];
  if (fixed && size.win1 != null) {
    cells.push(`<div class="size-cell"><span>${two && size.b ? "Ако стигне Цел 1, после се върне" : two ? "Ако стигне Цел 1" : "Ако стигне целта"}</span><strong class="pos">+${money(size.win1)}</strong></div>`);
    if (size.win2 != null) cells.push(`<div class="size-cell"><span>Ако стигне и Цел 2</span><strong class="pos">+${money(size.win2)}</strong></div>`);
  } else {
    cells.push(`<div class="size-cell"><span>Печалба</span><strong style="font-size:14px">зависи от изхода (виж „Как се управлява“)</strong></div>`);
  }
  const dists = [`стоп ${F.num(1).format(size.stopPips)}`];
  if (fixed && size.tp1Pips != null) dists.push(`${two ? "Цел 1" : "цел"} ${F.num(1).format(size.tp1Pips)}`);
  if (fixed && two && size.tp2Pips != null) dists.push(`Цел 2 ${F.num(1).format(size.tp2Pips)}`);
  cells.push(`<div class="size-cell"><span>Разстояния</span><strong style="font-size:15px">${dists.join(" · ")} пипса</strong></div>`);
  return `<div class="order-block">${title}<div class="size-grid">${cells.join("")}</div>
    <p class="what">Лотът е ориентировъчен. Провери брокерския маржин, ливъриджа, минималната стъпка на лота и действителната стойност на пипса. Няма автоматично ограничение по наличен маржин.</p>
    <p class="what">Тип поръчка: <strong>${orderType(o)}</strong> (${orderHint(o)}). В сумите е включен спред от около ${size.spread} пипса. Не са включени суапове (такси за нощувка) и комисиони на брокера.</p></div>`;
}

function stepsFor(sig) {
  if (!(S.data?.signals || []).some((s) => s.id === sig.id))
    return [["Не отваряй нова позиция по този запис", "Сигналът е запазен само в личната история. Няма актуално потвърждение от пазара."]];
  if (!quoteFresh(sig.pair))
    return [["Изчакай надеждни цени", "Преди да поставяш или променяш поръчка, изчакай нова котировка и потвърди състоянието при брокера."]];
  const strat = stratById(sig.strategy);
  const customExit = ownExit(strat);
  const exitText = (strat?.exit_rules || []).join(" ");
  const orders = ordersOf(sig);
  const p = sig.pair_name;
  if (sig.status === "open") {
    const stopNow = sig.stop ?? sig.stop0;
    const cells = targetCells(orders[0], sig);
    const next = cells.find(([n, v]) => v != null && !(sig.half && n === "Цел 1"));
    const stopChanged = sig.stop != null && sig.stop0 != null && Math.abs(sig.stop - sig.stop0) > 1e-9;
    const steps = [
      ["Входът е достигнат по модела", `Ценовите данни показват ниво ${px(sig.pair, sig.fill_price)} в ${when(sig.fill_time)}. Провери при брокера дали твоята поръчка действително е изпълнена.`],
      ["Сега наблюдавай изхода по стратегията", `Моделният стоп е ${px(sig.pair, stopNow)}.${next ? ` Следваща ценова цел: ${next[0]} ${px(sig.pair, next[1])}.` : " Няма фиксиран TP за въвеждане при брокера."} ${customExit ? exitText || "Следи условията за изход на стратегията." : "При Цел 1 се затваря половината и стопът на остатъка отива на входа; при Цел 2 се затваря остатъкът."}`],
    ];
    if (sig.half && cells.length > 1) steps.push(["Частичен изход по модела", "Първата част е отчетена като затворена. Провери изпълнението си при брокера и стопа на оставащата позиция."]);
    if (stopChanged) steps.push(["Провери новия стоп", `Стопът по модела е преместен от ${px(sig.pair, sig.stop0)} на ${px(sig.pair, sig.stop)} според правилото. Провери дали реалната ти позиция има същия стоп. Не го отдалечавай.`]);
    else if (customExit) steps.push(["Не мести стопа само заради 1R/2R", "1R и 2R са ориентири. Стопът се променя само когато условието на тази стратегия действително е изпълнено."]);
    steps.push(["Ако не си влязъл", "Не гони цената. Пропусни този сигнал и изчакай следващия."]);
    return steps;
  }
  if (sig.status !== "pending") return [];
  const market = orders[0].type === "market";
  const steps = [["Отвори " + p + " при брокера си", market ? "Стратегията предвижда пазарен вход; провери актуалната цена и спреда преди решение." : "Избери „Отложена поръчка“ (Pending order), а не пазарна поръчка."]];
  const activation = Math.max(...orders.map((o) => o.activate_after || 0));
  if (activation) steps.unshift(["Изчакай активирането", `Входовете са валидни най-рано от ${when(activation)}. Ако цената е докоснала ниво преди това, моделът се отменя. Не възстановявай пропуснат вход.`]);
  orders.forEach((o) => {
    const size = sizing(sig.pair, o);
    const ok = size && !size.tooSmall && !size.invalid;
    const vol = (v) => (ok ? `${F.num(2).format(v)} лота` : "твоя обем");
    const name = orders.length > 1 ? (o.dir === 1 ? "Покупка, поръчка" : "Продажба, поръчка") : "Поръчка";
    const price = market ? "Пазарна цена" : `Цена ${px(sig.pair, o.entry)}`;
    const stopTxt = market ? `Стоп ${px(sig.pair, o.stop)} (около ${F.num(1).format(pips(sig.pair, o.entry, o.stop))} пипса от входа)` : `Стоп ${px(sig.pair, o.stop)}`;
    const fixed = fixedTargets(sig, o);
    const targets = targetCells(o, sig);
    if (fixed && partsOf(o) > 1 && ok && size.b) {
      steps.push([`${name} 1 — ${orderType(o)}`, `${price} · Обем ${vol(size.a)} · ${stopTxt} · TP1 ${px(sig.pair, targets[0][1])}`]);
      steps.push([`${name} 2 — ${orderType(o)}`, `${price} · Обем ${vol(size.b)} · ${stopTxt} · TP2 ${px(sig.pair, targets[1][1])}`]);
    } else {
      const numerical = targets.filter(([, v]) => v != null);
      const tp = fixed && targets.length === 1
        ? ` · TP ${px(sig.pair, targets[0][1])}`
        : numerical.length
          ? ` · частични ценови цели: ${numerical.map(([name, v]) => `${name} ${px(sig.pair, v)}`).join(", ")}; другите части се затварят по правило, без TP за целия обем`
          : " · без фиксиран Take Profit";
      steps.push([`${name} — ${orderType(o)}`, `${price} · Обем ${ok ? vol(size.lots) : "твоя обем"} · ${stopTxt}${tp}`]);
    }
  });
  if (!market) steps.push(["Срок на поръчката", `Задай срок (Expiration) до ${when(sig.valid_until)}. Ако не се задейства дотогава, изтрий я.`]);
  if (orders.length > 1) steps.push(["Когато едната посока се задейства", "Изтрий веднага поръчките в другата посока."]);
  if (customExit) {
    steps.push(["Как се управлява сделката", exitText || "Условията за изход се определят от стратегията. Ориентирите 1R и 2R не са автоматични поръчки."]);
    steps.push(["Ориентири 1R и 2R", "Това не са задължителни TP. Не затваряй и не мести стопа само при достигането им. Следвай правилата по-горе."]);
  } else {
    steps.push(["Когато стигне Цел 1", `Затвори половината от позицията и премести стопа на останалата част на входа (${orders.map((o) => px(sig.pair, o.entry)).join(" или ")}), ако поръчките действително са изпълнени. Спред и приплъзване все още могат да доведат до загуба.`]);
    if (sig.style === "day") steps.push(["Дневна сделка", "Ако е още отворена в 23:00, затвори я според правилото."]);
  }
  return steps;
}

function tipsFor(sig, strat) {
  const tips = [];
  const pair = signalPairChoice(sig);
  tips.push([pair.allowed ? "info" : "warn", `${pair.label} за ${sig.pair_name}. ${pair.reason}`]);
  const hi = newsFor(pairCurrencies(sig.pair), now() - 15 * 60, now() + 3 * 3600, ["high"]);
  if (isCurrent(sig) && !quoteFresh(sig.pair)) tips.push(["warn", "Котировката е остаряла. Не изпълнявай вход или промяна на стоп, докато не провериш данните при брокера."]);
  if (isCurrent(sig) && hi.length) tips.push(["warn", `Силна новина за ${hi[0].currency} ${rel(hi[0].time)}: „${hi[0].title_bg}“. Около новини спредът се разширява и цената скача. По-безопасно е да изчакаш след новината или да пропуснеш.`]);
  const d = new Date();
  if (isCurrent(sig) && sig.style === "swing" && d.getDay() === 5) tips.push(["warn", "Петък е. Суинг сделката може да остане отворена през уикенда, а в понеделник цената може да отвори далеч от петъчната (гап)."]);
  if (strat && strat.stats.verdict !== "good") tips.push([pair.allowed ? "info" : "warn", `Общо за всички двойки стратегията е „${FX.VERDICT_LABELS[strat.stats.verdict]}“. За този сигнал по-важна е оценката за ${sig.pair_name}.`]);
  if (S.settings.risk > 0.5) tips.push(["warn", `Рискът ти е ${S.settings.risk}% на сделка. Препоръката е 0.5%. При серия от ${strat?.stats.max_losing_streak || 8} загуби подред ще загубиш около ${F.num(1).format((strat?.stats.max_losing_streak || 8) * S.settings.risk)}% от сметката.`]);
  if (strat?.stats.max_losing_streak) tips.push(["info", `В теста тази стратегия е имала до ${strat.stats.max_losing_streak} загуби подред. Следващата серия може да е по-дълга. Провери дали избраният риск е по силите на сметката ти.`]);
  tips.push(["info", "Не мести стопа по-далеч. При гапове, плъзгане или голям спред реалната загуба може да надхвърли планирания риск."]);
  return tips;
}

function viewSignal(id) {
  const sig = resolveSignal(id);
  if (!sig) return `<div class="detail-back"><a class="back-btn" href="#/signals">← Всички сигнали</a></div>${emptyBox("⌁", "Сигналът не е намерен", "В последните данни и локално запазените сигнали няма такъв идентификатор.", `<a class="btn btn-outline" href="#/signals">Към сигналите</a>`)}`;
  const strat = stratById(sig.strategy);
  const st = statusInfo(sig);
  const orders = ordersOf(sig);
  const steps = stepsFor(sig);
  const news = newsFor(pairCurrencies(sig.pair), Math.min(sig.signal_time, now()) - 3600, horizonEnd(sig), ["high", "medium"]);
  const boxCls = sig.status === "pending" ? "pending" : sig.status === "closed" && sig.r < 0 ? "loss" : "";
  return `
    <div class="detail-back"><a class="back-btn" href="#/signals">← Всички сигнали</a><span class="muted-small">Сигнал от ${when(sig.signal_time)}</span></div>
    <div class="detail-head"><div><p class="kicker">${esc(sig.strategy_name.toUpperCase())} · ${esc(sig.tf_label.toUpperCase())} · ${STYLE_NAMES[sig.style].toUpperCase()}</p>
      <h1>${dirBadge(sig)} ${esc(sig.pair_name)} <span class="st ${st.cls}">${esc(st.label)}</span></h1>
      <p>${strat ? `Стратегия: <a class="link" href="#/strategy/${esc(strat.id)}">${esc(strat.name)} · ${esc(strat.tf_label)}</a> ${pairBadge(strat, sig.pair)}` : ""}</p></div>
      <div class="chips-row">${watchButton(sig)}<button type="button" class="btn btn-quiet btn-sm" id="copy-plan">Копирай плана</button></div></div>
    ${freshnessNotice(sig)}
    ${watchDetail(sig)}
    <div class="panel signal-personal"><h3>Твоята сделка</h3><p class="what">Ако си влязъл при брокера, добави реалния вход и обем в личния дневник.</p><div class="chips-row">${ordersOf(sig).map((order) => `<button type="button" class="btn btn-outline" data-journal-signal="${esc(sig.id)}" data-journal-dir="${order.dir}">Запиши ${order.dir === 1 ? "покупка" : "продажба"}</button>`).join("")}</div></div>
    ${signalAvailability(sig)}${conflictNotice(sig.pair)}
    <div class="status-box ${boxCls}"><strong>${esc(st.label)}.</strong> ${esc(st.text)}</div>
    <div class="detail-grid"><div class="detail-column">
      <section class="panel trade-plan-panel"><div class="panel-head"><div><p class="kicker">НИВА</p><h3>${orders.length > 1 ? "Две възможни посоки" : "Вход, стоп и цели"}</h3></div><span class="pill pill-neutral">${esc(sig.tf_label)}</span></div>
        ${orders.map((o) => `${orders.length > 1 ? `<div class="order-title" style="margin-top:10px">${o.dir === 1 ? "▲ Покупка" : "▼ Продажба"}</div>` : ""}
        <div class="levels-row" style="--target-cols:${2 + targetCells(o, sig).length}">
          <div class="level-cell"><span>Вход${sig.status !== "pending" && sig.fill_price != null ? " (модел)" : o.type === "market" ? " ≈" : ""}</span><strong>${px(sig.pair, o.entry)}</strong><small>${o.type === "market" ? "пазарна цена" : o.type === "limit" ? (o.dir === 1 ? "купи при връщане" : "продай при връщане") : o.dir === 1 ? "купи над" : "продай под"}${o.activate_after && sig.status === "pending" ? `<br>Активиране: ${esc(when(o.activate_after))}` : ""}</small></div>
          <div class="level-cell loss"><span>Стоп</span><strong>${px(sig.pair, o.stop)}</strong><small>${F.num(1).format(pips(sig.pair, o.entry, o.stop))} пипса</small></div>
          ${targetCells(o, sig).map(([name, v], j) => `<div class="level-cell profit"><span>${name}${partsOf(o) > 1 ? (j ? " · останалото" : " · половината") : ""}</span><strong>${v == null ? "по правило" : px(sig.pair, v)}</strong><small>${v == null ? "изход при изпълнено условие" : `${F.num(1).format(pips(sig.pair, o.entry, v))} пипса`}</small></div>`).join("")}
        </div>
        ${landmarkNote(sig.pair, o, sig)}` ).join("")}
        <p class="what"><strong>Истински изход:</strong> ${ownExit(strat) ? esc((strat?.exit_rules || []).join(" ") || "По правило на стратегията. Проверявай условията за изход.") : "При 1R се затваря половината, стопът на остатъка отива на входа; при 2R се затваря останалото."}</p>
      </section>
      <section class="panel"><div class="panel-head"><div><p class="kicker">ГРАФИКА · ${esc(sig.tf_label.toUpperCase())}</p><h3>Цената и нивата</h3></div><span class="muted-small">текуща цена ${px(sig.pair, pairInfo(sig.pair).price)}</span></div>
        <div class="chart-box" id="sig-chart"><p class="muted">Зареждам графиката…</p></div>
        <div class="chart-legend"><span><i style="background:#e8eef0"></i>Вход</span><span><i style="background:#fc928e"></i>Стоп</span><span><i style="background:#9fe4ac"></i>Реални TP</span><span><i style="background:#7590a2"></i>1R / 2R ориентири</span><span><i style="background:#f6cd8e"></i>Свещта на сигнала</span></div></section>
      <section class="panel"><div class="panel-head"><div><p class="kicker">ЗАЩО</p><h3>Защо има сигнал</h3></div></div>
        <p class="why-text">${esc(sig.why)}</p>
        ${strat ? `<p class="what">Правилата на стратегията и как се е представила в теста: <a class="link" href="#/strategy/${esc(strat.id)}">${esc(strat.name)} →</a></p>` : ""}</section>
    </div><div class="detail-column">
      <section class="panel"><div class="panel-head"><div><p class="kicker">ТВОЯТ ОБЕМ</p><h3>Колко да купиш</h3></div><span class="pill pill-neutral">${S.settings.currency}</span></div>
        <div class="risk-form"><div class="field"><label for="size-balance">Баланс (${S.settings.currency})</label><input type="number" id="size-balance" min="50" step="any" inputmode="decimal" value="${S.settings.balance ?? ""}" placeholder="напр. 2000"></div>
          <div class="field"><label for="size-risk">Риск на сделка (%)</label><input type="number" id="size-risk" min="0.1" max="1" step="0.05" value="${S.settings.risk}"></div></div>
        <p class="risk-inline-hint">Препоръчително 0.5%, максимум 1%. Промените се запазват.</p>
        <div id="size-host">${orders.map((o, k) => sizeBlock(sig, o, k, orders.length)).join("")}</div></section>
      ${steps.length ? `<section class="panel"><div class="panel-head"><div><p class="kicker">СТЪПКА ПО СТЪПКА</p><h3>Какво да направиш</h3></div></div>
        <div class="steps-list" id="steps-host">${steps.map(([t, p], i) => `<div class="step"><span class="step-index">${String(i + 1).padStart(2, "0")}</span><div><strong>${esc(t)}</strong><p>${esc(p)}</p></div></div>`).join("")}</div></section>` : ""}
      <section class="panel"><div class="panel-head"><div><p class="kicker">СЪВЕТИ</p><h3>Преди да влезеш</h3></div></div>
        <div class="tips">${tipsFor(sig, strat).map(([k, t]) => `<div class="tip ${k}"><span class="tip-icon">${k === "warn" ? "!" : "i"}</span><span>${esc(t)}</span></div>`).join("")}</div></section>
      <section class="panel"><div class="panel-head"><div><p class="kicker">НОВИНИ ЗА ${pairCurrencies(sig.pair).join(" И ")}</p><h3>Какво да следиш</h3></div><a class="text-link" href="#/news">Календар ↗</a></div>
        ${news.length ? news.map((e) => newsCompactWithImpact(e, sig)).join("") : `<p class="muted" style="font-size:12px">Няма важни новини за ${pairCurrencies(sig.pair).join(" и ")} докато сигналът е активен.</p>`}
        <p class="what">Часовете са по твоето време (${esc(TZ)}).</p></section>
    </div></div>`;
}

function newsCompactWithImpact(e, signal = null) {
  return `<div class="news-compact ${e.time < now() ? "past" : ""}"><span class="when">${esc(when(e.time))}<br><small>${rel(e.time)}</small></span>
    <span><strong><span class="cur">${esc(e.currency)}</span> ${esc(e.title_bg)}</strong>${impactPill(e.impact)}${e.explain ? `<small>${esc(e.explain)}</small>` : ""}${newsPulsButton(e, signal)}</span></div>`;
}

function viewStrategies() {
  const f = S.stratFilter, pair = FX.PAIRS[S.stratPair] ? S.stratPair : "";
  const pairName = pair ? pairInfo(pair).name : "";
  const inView = strategies().filter((e) => styleOk(e.style) && (f === "archived" ? e.retired : !e.retired) && (!pair || (e.pairs || FX.PAIR_KEYS).includes(pair)));
  const list = sortedStrategies(pair).filter((e) => inView.includes(e)).filter((e) => f === "all" || f === "archived"
    || (f === "followed" && isFollowed(e.id))
    || ((f === "good" || f === "weak" || f === "bad" || f === "few") && ratingOf(e, pair) === f));
  const counts = { good: 0, weak: 0, bad: 0, few: 0 };
  inView.forEach((e) => counts[ratingOf(e, pair)]++);
  return `
    <div class="page-heading"><div><p class="kicker">СТРАТЕГИИ</p><h1>Стратегии</h1>
      <p>Разгледай тестваните варианти за ${STYLE_NAMES[S.settings.style].toLowerCase()} търговия. Всяка стратегия е оценена отделно за всяка валутна двойка: една и съща стратегия може да е „Силна“ за златото и да губи на EUR/USD. Избери двойка, за да видиш какво работи на нея. Оценката не е гаранция за печалба.</p></div>
      <span class="page-flag">${pair ? `${esc(pairName)}: ` : ""}${counts.good} силни · ${counts.weak} слаби · ${counts.bad} не работят · ${counts.few} с малко сделки</span></div>
    <div class="filter-bar"><div class="filter-group" role="group" aria-label="Валутна двойка">
      ${[["", "Всички двойки"], ...FX.PAIR_KEYS.map((k) => [k, FX.PAIRS[k].name])].map(([k, l]) => `<button class="chip ${pair === k ? "active" : ""}" data-stratpair="${k}" aria-pressed="${pair === k}">${l}</button>`).join("")}</div></div>
    <div class="filter-bar"><div class="filter-group" role="group" aria-label="Оценка">
      ${[["all", "Всички"], ["good", "Силни"], ["weak", "Слаби"], ["bad", "Не работят"], ["few", "Малко сделки"], ["followed", `Следвам (${followedInStyle().length})`], ["archived", "Архив"]].map(([k, l]) => `<button class="chip ${S.stratFilter === k ? "active" : ""}" data-stratfilter="${k}">${l}</button>`).join("")}</div>
      ${S.settings.followed ? `<button class="text-link" data-reset-follow>Върни избора по подразбиране</button>` : `<span class="muted-small">По подразбиране: варианти с инструмент, който покрива подбора.</span>`}</div>
    <p class="what" style="margin:-4px 0 12px">${pair ? `Оценките, графиките и числата на картите са само за ${esc(pairName)}.` : "Без избрана двойка картата показва най-добрата оценка по двойки. Цветните етикети под описанието показват всяка двойка поотделно."}</p>
    <details class="panel" style="margin-bottom:14px"><summary class="link" style="cursor:pointer">Как да чета картите?</summary>
      <div class="tips">
        <div class="tip"><span class="tip-icon">%</span><span><strong>Печеливши</strong>: от 100 сделки колко са завършили на печалба.</span></div>
        <div class="tip"><span class="tip-icon">R</span><span><strong>Среден резултат</strong>: колко средно носи една сделка, измерено в „R“. 1R = рискът ти на сделка. +0.10R при риск $10 означава средно +$1 на сделка.</span></div>
        <div class="tip"><span class="tip-icon">↓</span><span><strong>Най-голям спад*</strong>: колко най-много е падала сметката от върха си при твоя риск (${S.settings.risk}% на сделка).</span></div>
        <div class="tip"><span class="tip-icon">×</span><span><strong>Загуби подред</strong>: най-дългата серия загуби в теста. Бъди готов за нея.</span></div>
        <div class="tip"><span class="tip-icon">●</span><span><strong>Оценка</strong>: смята се отделно за всяка двойка. „Силна“ = поне 30 сделки на двойката, печели след спреда в двете половини на периода и в последните 30%, остава на печалба и при двоен спред. „Слаба“ = печели малко или нестабилно. „Не работи“ = губи.</span></div>
        <div class="tip"><span class="tip-icon">⌁</span><span><strong>Сигнали</strong>: при включен подбор (Настройки) сайтът показва сигнал за инструмент с положителна проверка. Кандидатите за наблюдение са обозначени отделно.</span></div>
      </div></details>
    <div class="strat-grid">${list.map((e) => stratCard(e, pair)).join("") || emptyBox("◈", "Няма стратегии", "Няма стратегии за този филтър.")}</div>`;
}

function viewStrategy(id) {
  const e = stratById(id);
  if (!e) return `<div class="detail-back"><a class="back-btn" href="#/strategies">← Всички стратегии</a></div>${emptyBox("◈", "Стратегията не е намерена", "")}`;
  const s = e.stats;
  const followed = isFollowed(e.id);
  const risk = S.settings.risk;
  const sigs = (S.data?.signals || []).filter((x) => x.strategy === e.id && isCurrent(x) && pairSignalVisible(x));
  const live = e.live || {};
  const tiles = s.trades ? `
    <div class="stat-tiles">
      <div class="stat-tile"><span>Сделки в теста</span><strong>${s.trades}</strong><span class="what">~${F.num(1).format(s.per_month)} на месец · ${esc(pairsLabel(e))}</span></div>
      <div class="stat-tile"><span>Печеливши</span><strong>${F.num(1).format(s.win_rate)}%</strong><span class="what">Средна печалба ${fmtR(s.avg_win)}, средна загуба ${fmtR(s.avg_loss)}</span></div>
      <div class="stat-tile"><span>Среден резултат на сделка</span><strong class="${s.avg_r > 0 ? "pos" : "neg"}">${fmtR(s.avg_r)}</strong><span class="what">${riskMoney() ? `≈ ${rMoney(s.avg_r)} при твоя риск` : "1R = рискът на една сделка"}</span></div>
      <div class="stat-tile"><span>Резултат за година*</span><strong class="${s.return_pct_year > 0 ? "pos" : "neg"}">${pct((s.total_r * risk) / s.years)}</strong><span class="what">общо ${fmtR(s.total_r)} за ${F.num(1).format(s.years)} г.</span></div>
      <div class="stat-tile"><span>Най-голям спад*</span><strong class="neg">${pct(-s.max_dd_r * risk)}</strong><span class="what">колко най-много е падала сметката от върха си</span></div>
      <div class="stat-tile"><span>Най-дълга серия загуби</span><strong>${s.max_losing_streak}</strong><span class="what">загуби една след друга</span></div>
      <div class="stat-tile"><span>Печалба ÷ загуба</span><strong>${s.profit_factor ?? "∞"}</strong><span class="what">над 1 = печели. Над 1.2 = добре</span></div>
      <div class="stat-tile"><span>Стабилност</span><strong style="font-size:16px">${s.avg_first > 0 && s.avg_second > 0 ? "Печели и в двете половини" : s.avg_first > 0 || s.avg_second > 0 ? "Печели само в едната половина" : "Губи и в двете половини"}</strong><span class="what">1-ва половина ${fmtR(s.avg_first)}, 2-ра ${fmtR(s.avg_second)} на сделка</span></div>
      ${s.longs ? `<div class="stat-tile"><span>Покупки</span><strong class="${(s.longs.avg_r ?? 0) > 0 ? "pos" : "neg"}">${s.longs.avg_r == null ? "—" : fmtR(s.longs.avg_r)}</strong><span class="what">${s.longs.trades} сделки, среден резултат</span></div>
      <div class="stat-tile"><span>Продажби</span><strong class="${(s.shorts.avg_r ?? 0) > 0 ? "pos" : "neg"}">${s.shorts.avg_r == null ? "—" : fmtR(s.shorts.avg_r)}</strong><span class="what">${s.shorts.trades} сделки, среден резултат</span></div>` : ""}
    </div>
    <p class="what">* При твоя риск ${risk}% на сделка, без сложна лихва. Тестван период: ${dateOnly(s.start)} – ${dateOnly(s.end)} (${F.num(1).format(s.years)} г.). Спредът е изваден от всяка сделка.</p>` : emptyBox("◈", "Няма сделки в теста", "Тази стратегия не е дала сигнал в тествания период.");
  return `
    <div class="detail-back"><a class="back-btn" href="#/strategies">← Всички стратегии</a></div>
    <div class="detail-head"><div><p class="kicker">${esc(e.tf_label.toUpperCase())} · ${STYLE_NAMES[e.style].toUpperCase()} · ${esc(pairsLabel(e).toUpperCase())}</p>
      <h1>${esc(e.name)} ${headlineBadge(e)}</h1><p>${esc(e.short)} ${approximationTag(e)}</p>${pairStrip(e)}</div>
      ${strategyFollowButton(e, true)}</div>
    <section class="panel" style="margin-bottom:14px"><div class="panel-head"><div><p class="kicker">ОЦЕНКА ПО ВАЛУТНИ ДВОЙКИ</p><h3>Къде работи и къде не</h3></div></div>
      ${e.per_pair?.length ? pairTable(e) : `<p class="muted">Няма данни.</p>`}${testCostsDetails(e)}
    </section>
    <p class="kicker" style="margin:4px 0 8px">ОБЩО ЗА ВСИЧКИ ДВОЙКИ ${verdictBadge(s)}</p>
    ${tiles}
    <div class="grid-2" style="margin-top:14px"><div class="stack">
      <section class="panel"><div class="panel-head"><div><p class="kicker">РАЗВИТИЕ НА СМЕТКАТА В ТЕСТА</p><h3>Как е вървяла</h3></div><span class="muted-small">при риск ${risk}% на сделка · всички двойки</span></div>
        <div class="equity-box" id="equity-box"></div></section>
      <section class="panel"><div class="panel-head"><div><p class="kicker">ПО ГОДИНИ</p><h3>Всяка година поотделно</h3></div></div>
        ${s.yearly?.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Година</th><th class="num">Сделки</th><th class="num">Резултат</th><th class="num">При риск ${risk}%</th></tr></thead><tbody>
          ${s.yearly.map((y) => `<tr><td>${y.year}</td><td class="num">${y.trades}</td><td class="num ${y.r >= 0 ? "pos" : "neg"}">${fmtR(y.r)}</td><td class="num ${y.r >= 0 ? "pos" : "neg"}">${pct(y.r * risk)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">Няма данни.</p>`}
      </section>
    </div><div class="stack">
      <section class="panel"><div class="panel-head"><div><p class="kicker">ПРАВИЛА</p><h3>Как работи</h3></div></div>
        <ol class="rules">${e.rules.map((r) => `<li>${esc(r)}</li>`).join("")}</ol>
        ${ownExit(e)
          ? `<p class="kicker" style="margin-top:16px">ИЗХОД ОТ СДЕЛКАТА</p><ul class="rules common">${(e.exit_rules || []).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`
          : `<p class="kicker" style="margin-top:16px">ОБЩИ ЗА СТРАТЕГИИТЕ ОТ КНИГИ</p>
        <ul class="rules common">${(S.data.common_rules || []).map((r) => `<li>${esc(r)}</li>`).join("")}${e.style === "day" ? "<li>Дневните сделки се затварят най-късно в 23:00. Нови сигнали има само между 08:00 и 18:00.</li>" : ""}</ul>`}
        ${e.note ? `<div class="warn-line" style="margin-top:12px">${esc(e.note)}</div>` : ""}
        <p class="what">Това са правила за исторически тест, а не гаранция за бъдеща доходност.</p></section>
      <section class="panel"><div class="panel-head"><div><p class="kicker">ИСТОРИЧЕСКИ МОДЕЛ</p><h3>Моделирани сделки след старта</h3></div></div>
        ${live.trades ? `<p style="font-size:13px">${live.trades} сделки · ${F.num(0).format(live.win_rate)}% печеливши · общо <strong class="${live.total_r >= 0 ? "pos" : "neg"}">${fmtR(live.total_r)}</strong></p>` : `<p class="muted" style="font-size:12px">Още няма приключени моделирани сделки след старта.</p>`}
        <p class="what">Това е ретроспективно изчисление след датата на стартиране, а не проверен журнал на публикувани сигнали или реални изпълнения. Стартирано на ${dateOnly(live.since || now())}.</p></section>
      <section class="panel"><div class="panel-head"><div><p class="kicker">СИГНАЛИ СЕГА</p><h3>Активни сигнали</h3></div></div>
        ${sigs.length ? `<div class="sig-list">${sigs.map(signalCard).join("")}</div>` : `<p class="muted" style="font-size:12px">В момента няма сигнал от тази стратегия.</p>`}</section>
      <section class="panel"><div class="panel-head"><div><p class="kicker">ПОСЛЕДНИ СДЕЛКИ В ТЕСТА</p><h3>Последните 12</h3></div></div>
        ${e.recent?.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Дата</th><th>Двойка</th><th>Посока</th><th>Изход</th><th class="num">Резултат</th></tr></thead><tbody>
          ${e.recent.map((t) => `<tr><td>${dateOnly(t.signal_time)}</td><td>${esc(pairInfo(t.pair).name)}</td><td>${t.dir === 1 ? "Купи" : "Продай"}</td><td>${esc(REASONS[t.reason] || t.reason)}</td><td class="num ${t.r >= 0 ? "pos" : "neg"}">${fmtR(t.r)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">Няма сделки.</p>`}
      </section>
    </div></div>`;
}

function viewNews() {
  const levels = S.newsImpact === "h" ? ["high"] : S.newsImpact === "hm" ? ["high", "medium"] : ["high", "medium", "low", "holiday"];
  const t = now(), cal = FX.calendar;
  const selected = cal.view(S.data?.news || [], { now: t, levels, currencies: S.newsMine ? MY_CURRENCIES : null, day: S.newsDay, showPast: S.newsShowPast });
  const { next, items, past, today } = selected, updated = S.data?.news_updated;
  const dayLabel = cal.label(selected.selected, today);
  return `
    <div class="page-heading"><div><p class="kicker">ИКОНОМИЧЕСКИ КАЛЕНДАР</p><h1>Новини</h1>
      <p>Избери дата и виж какво предстои. Миналите събития са скрити, докато не поискаш да провериш резултатите им.</p></div>
      ${next ? `<button class="chip" data-news-next="${esc(cal.dayKey(next.time))}">Към следващото: ${esc(next.currency)} · ${cal.time(next.time)} · ${esc(cal.label(cal.dayKey(next.time), today))}</button>` : '<span class="page-flag">Няма предстоящи в наличния календар</span>'}</div>
    ${pulsOverview()}
    <details class="panel news-help"><summary>Защо следим новините</summary>
      <p>Календарът помага да прецениш кога сигналът може да попадне в по-резки движения, по-широк спред или приплъзване. При дневна търговия е важен близкият час на входа, а при суинг — събитията през целия планиран период.</p>
      <p class="what">„Висока“ означава очаквано влияние, а не посока за покупка или продажба. Сравни прогнозата, предишната и обявената стойност, когато е налична. Докладите и изказванията изискват и преглед на самия текст. Миналите събития са полезни за проверка на резултатите и контекста; изминалият час не потвърждава публикуване.</p></details>
    <section class="panel news-calendar" id="news-calendar" aria-label="Календар по дати">
      ${!updated || t - updated > 6 * 3600 ? '<p class="warn-line">Календарът не е обновяван скоро. Показват се само записаните събития; липсата на предстояща новина тук не потвърждава, че няма други събития.</p>' : ""}
      <div class="news-date-picker" role="group" aria-label="Избери дата">${selected.days.map((d) => `<button type="button" class="news-date ${d.key === selected.selected ? "active" : ""}" aria-pressed="${d.key === selected.selected}" data-newsday="${d.key === today ? "today" : esc(d.key)}"><strong>${esc(d.label)}</strong><span>${esc(d.key.split("-").reverse().join("."))}</span><small>${d.count} събития${d.high ? ` · ${d.high} силни` : ""}</small></button>`).join("")}</div>
      <div class="panel-head news-date-heading"><div><h2>${esc(dayLabel)}</h2><p class="what">Часовете са по Europe/Sofia. ${items.length} ${S.newsShowPast ? "събития" : "предстоящи събития"} за тази дата.</p></div>
        <button type="button" class="chip ${S.newsShowPast ? "active" : ""}" data-newspast aria-pressed="${S.newsShowPast}">${S.newsShowPast ? "Скрий миналите" : `Покажи миналите (${past})`}</button></div>
      <div class="filter-group news-filters">
        <button class="chip ${S.newsImpact === "h" ? "active" : ""}" data-newsimpact="h">Само силни</button>
        <button class="chip ${S.newsImpact === "hm" ? "active" : ""}" data-newsimpact="hm">Силни и средни</button>
        <button class="chip ${S.newsImpact === "all" ? "active" : ""}" data-newsimpact="all">Всички</button>
        <button class="chip ${S.newsMine ? "active" : ""}" data-newsmine>${S.newsMine ? "✓ " : ""}Само за моите валути</button>
      </div>
      ${items.length ? items.map((e) => {
        const elapsed = e.time < t, actual = cal.resultKnown(e, t);
        const state = elapsed ? actual ? "Резултатът е наличен" : "Часът мина · няма резултат в източника" : "Предстои";
        return `<article class="news-row ${elapsed ? "past" : ""} ${next && e.id === next.id ? "next" : ""}" data-news-event="${esc(e.id)}">
          <div class="news-time">${cal.time(e.time)}<small>${elapsed ? "Часът мина" : rel(e.time)}</small></div>
          <div class="cur-col"><span class="cur" title="${esc(CURRENCY_NAMES[e.currency] || e.currency)}">${esc(e.currency)}</span></div>
          <div class="news-title"><strong>${esc(e.title_bg)}</strong>${impactPill(e.impact)}<span class="news-event-state">${esc(state)}</span>${e.title_bg !== e.title ? `<span class="orig">${esc(e.title)}</span>` : ""}
            <details class="news-explanation"><summary>Какво означава</summary><p>${esc(e.explain || FX.newsGuide(e.title).explain)}</p><p class="what">${esc(FX.newsGuide(e.title).watch)}</p></details>${newsPulsButton(e)}</div>
          <div class="news-nums">${actual ? `Обявено: <b>${esc(e.actual)}</b><br>` : ""}${e.forecast != null && e.forecast !== "" ? `Очаквано: <b>${esc(e.forecast)}</b><br>` : ""}${e.previous != null && e.previous !== "" ? `Предишно: <b>${esc(e.previous)}</b>` : ""}</div>
        </article>`;
      }).join("") : emptyBox("◷", past && !S.newsShowPast ? "Няма повече предстоящи събития за тази дата" : "Няма събития за тази дата и филтър", past && !S.newsShowPast ? `Скрити са ${past} минали събития. Можеш да ги покажеш за проверка или да избереш друга дата.` : "Избери друга дата или промени важността и валутите.", next && cal.dayKey(next.time) !== selected.selected ? `<button class="btn btn-outline" data-news-next="${esc(cal.dayKey(next.time))}">Виж следващото събитие →</button>` : "")}
      <p class="disclaimer">Източник: ${esc(S.data?.sources?.news || "ForexFactory")}. Календарът е обновен ${updated ? esc(cal.time(updated)) + " · " + esc(cal.dayKey(updated).split("-").reverse().join(".")) : "в неизвестен час"} · Europe/Sofia. Показва се наличната седмица; липсващият резултат остава неизвестен.</p>
    </section>`;
}

function viewSettings() {
  const st = S.settings;
  const rm = riskMoney();
  return `
    <div class="page-heading"><div><p class="kicker">ПРОФИЛ</p><h1>Настройки</h1><p>От тези числа зависи обемът във всеки сигнал. Пазят се само в този браузър.</p></div></div>
    <div class="settings-grid">
      <section class="panel settings-panel"><p class="kicker">СМЕТКА И РИСК</p><h3>Твоята сметка</h3>
        <form id="settings-form" class="settings-form">
          <div class="form-field"><label for="set-balance">Баланс на сметката</label>
            <div class="inline-input"><input id="set-balance" name="balance" type="number" min="50" max="10000000" step="any" inputmode="decimal" value="${st.balance ?? ""}" placeholder="напр. 2000" required>
            <select name="currency" aria-label="Валута на сметката"><option value="USD" ${st.currency === "USD" ? "selected" : ""}>USD $</option><option value="EUR" ${st.currency === "EUR" ? "selected" : ""}>EUR €</option></select></div>
            <span class="what">Колко пари има в сметката ти при брокера.</span></div>
          <div class="form-field"><label for="set-risk">Риск на една сделка</label>
            <div class="risk-line"><input id="set-risk" name="risk" type="range" min="0.1" max="1" step="0.05" value="${st.risk}"><output id="risk-out">${st.risk}%</output></div>
            <div class="risk-money" id="risk-money">${rm ? `= ${money(rm)} на сделка` : ""}</div>
            <span class="what">Планираната загуба при достигане на стопа. Препоръчително 0.5%, максимум 1%. При 10 загуби подред и 0.5% губиш около 5% от сметката.</span></div>
          <div class="form-field"><span class="label">Стил на търговия</span>
            <div class="choice">
              <label><input type="radio" name="style" value="day" ${st.style === "day" ? "checked" : ""}><span>Дневна</span></label>
              <label><input type="radio" name="style" value="swing" ${st.style === "swing" ? "checked" : ""}><span>Суинг</span></label>
</div>
            <span class="what"><strong>Дневна</strong>: M15/H1. Новите кандидати приключват до 22:00 Europe/Sofia; конкретният час е в правилата. <strong>Суинг</strong>: H4/D1, с държане през няколко сесии. Архивните варианти запазват старите си правила.</span></div>
          <div class="form-field"><label><input type="checkbox" name="smartPairs" ${st.smartPairs ? "checked" : ""}> Показвай сигнали само за подбраните инструменти</label>
            <span class="what">Използва оценката на конкретната двойка. Допуска исторически силните и кандидатите, които покриват проверката за наблюдение. Стари оценки и резултати с други разходи се пропускат. Следените сигнали остават видими.</span></div>
          <div class="chips-row"><button type="submit" class="btn btn-primary">Запази</button><a class="btn btn-outline" href="#/strategies">Избери стратегии (${followedInStyle().length}) ↗</a></div>
        </form></section>
      <section class="panel settings-aside"><div class="big-shield">◇</div><h3>Как се смята обемът</h3>
        <p>Първо стратегията казва къде е стопът. После сайтът смята колко лота да купиш, така че при стоп планираната загуба да съответства на избрания риск. При гап или приплъзване реалната загуба може да е по-голяма. Затова при широк стоп обемът е малък, а при тесен е по-голям.</p>
        <div class="settings-fact"><span>Пример</span><strong>$2 000 · 0.5% · стоп 20 пипса</strong></div>
        <div class="settings-fact"><span>Риск</span><strong>$10</strong></div>
        <div class="settings-fact"><span>Обем за EUR/USD</span><strong>10 ÷ (20 × $10) = 0.05 лота</strong></div>
        <div class="settings-fact"><span>Данни</span><strong>Само в този браузър</strong></div></section>
    </div>${noticesPanel()}`;
}

function viewHelp() {
  const d = S.data || {};
  return `
    <div class="page-heading"><div><p class="kicker">ПОМОЩ</p><h1>Как работи</h1><p>Откъде идват данните, как се смята сигналът и как да четеш резултатите.</p></div></div>
    <div class="how-steps">
      <div class="how-step"><span class="num">01</span><strong>Цените</strong><p>На всеки ${d.settings?.refresh_minutes || 10} минути сайтът сваля цените на 7 валутни двойки и златото (XAU/USD).</p></div>
      <div class="how-step"><span class="num">02</span><strong>Стратегиите</strong><p>Сравнява ${strategies().length} исторически тествани варианта. Сигнали се изчисляват за публикуваните и избраните от теб стратегии.</p></div>
      <div class="how-step"><span class="num">03</span><strong>Сигналът</strong><p>Когато правилата на стратегия са изпълнени, се появява сигнал с вход, стоп и конкретно правило за изход.</p></div>
      <div class="how-step"><span class="num">04</span><strong>Твоят обем</strong><p>Сайтът изчислява приблизителен лот според баланса, стопа и риска. Брокерският маржин и реалното изпълнение трябва да се проверят отделно.</p></div>
      <div class="how-step"><span class="num">05</span><strong>Новините</strong><p>Предупреждава, ако наближава силна новина за валутите в сигнала.</p></div>
    </div>
    <div class="grid-2 even" style="margin-top:14px">
      <section class="panel glossary"><p class="kicker">РЕЧНИК</p><h3 style="margin-bottom:6px">Какво значи…</h3>
        <details><summary>Пипс</summary><p>Най-малката обичайна стъпка на цената. При EUR/USD това е 0.0001 (от 1.1200 до 1.1201). При USD/JPY е 0.01.</p></details>
        <details><summary>Лот</summary><p>Размерът на сделката. 1 лот = 100 000 единици от валутата. 0.01 лот (микролот) е най-малкият при повечето брокери. При EUR/USD 1 лот = около $10 на пипс, 0.10 лота = $1 на пипс.</p></details>
        <details><summary>Стоп (Stop Loss)</summary><p>Цената, на която сделката се затваря автоматично на загуба. Задължителен е. Никога не го мести по-далеч.</p></details>
        <details><summary>Цел (Take Profit)</summary><p>Цената, на която сделката се затваря автоматично на печалба. Някои стратегии имат една или две цели, други излизат по индикатор или в определен час. Точното правило е към сигнала.</p></details>
        <details><summary>R (единица риск)</summary><p>R е рискът ти на една сделка. Ако рискуваш $10, +1R = +$10, −1R = −$10, +0.5R = +$5. Така стратегиите се сравняват независимо от размера на сметката.</p></details>
        <details><summary>Buy Stop / Sell Stop</summary><p>Отложена поръчка. Buy Stop купува, когато цената се качи до нивото. Sell Stop продава, когато цената слезе до нивото. Така влизаш само ако пазарът потвърди посоката.</p></details>
        <details><summary>Спред</summary><p>Разликата между цената за купуване и за продаване. Това е таксата на брокера. В тестовете е изваден от всяка сделка.</p></details>
        <details><summary>Дневна и суинг търговия</summary><p>Дневната търговия използва M15/H1. Новите дневни варианти приключват в същия ден, а часът е в правилата. Суинг търговията ползва графики 4 часа и 1 ден, а сделките се държат дни или седмици.</p></details>
        <details><summary>Спад (drawdown)</summary><p>Колко е паднала сметката от най-високата си точка до най-ниската след нея. Показва колко болезнен може да е лош период.</p></details>
      </section>
      <div class="stack">
        <section class="panel"><p class="kicker">КАК СЕ ТЕСТВА</p><h3 style="margin-bottom:8px">Откъде са числата</h3>
          <ul class="rules">
            <li>Всяка стратегия се проверява върху исторически свещи. Това не симулира напълно реалните условия за изпълнение при брокера.</li>
            <li>Графики 15 минути, 1 час и 4 часа: данни от около 3 години. Графика 1 ден: от около 2008 г.</li>
            <li>Сделките се следят по 15-минутните свещи, за по-точно проследяване на стопа и целта. Точният ред вътре в свещта остава неизвестен.</li>
            <li>Стратегиите с непълно описание се маркират „приблизителни правила“. Резултатите се отнасят само за кодираната версия.</li>
            <li>От всяка сделка се изваждат зададените моделни разходи. При началните настройки това е спредът от каталога.</li>
            <li>Ако в една свещ са ударени и стопът, и целта, тестът приема, че първо е ударен стопът.</li>
            <li>Статистиката „след старта“ е моделирана и не доказва, че сигналът е бил видим преди задействането.</li>
          </ul></section>
        <section class="panel"><p class="kicker">ОГРАНИЧЕНИЯ</p><h3 style="margin-bottom:8px">Данни и изпълнение</h3>
          <ul class="rules">
            <li>Миналите резултати не гарантират бъдещите. Стратегия, която е печелила, може да започне да губи.</li>
            <li>Цените са от ${esc(d.sources?.prices || "безплатен източник")}. Цената при твоя брокер може леко да се различава.</li>
            <li>Новините са от ${esc(d.sources?.news || "ForexFactory")}.</li>
            <li>Началният разход е моделен. Комисиона, приплъзване и суап могат да се зададат в Лабораторията; резултатът пази използваните стойности.</li>
            <li>Това не е инвестиционен съвет. Ти решаваш дали и как да търгуваш.</li>
          </ul></section>
      </div>
    </div>`;
}

/* ------------------------------------------------------------ рамка, маршрути */

const TITLES = { dashboard: "Начало", signals: "Сигнали", watch: "Следени сигнали", journal: "Журнал на сигналите", signal: "Сигнал", strategies: "Стратегии", strategy: "Стратегия", news: "Новини", analysis: "Попитай Пулс", workshop: "Мои стратегии", risk: "Риск и дневник", settings: "Настройки", help: "Как работи", lab: "Лаборатория" };

function parseRoute() {
  const parts = (location.hash || "#/").replace(/^#\/?/, "").split("/");
  const view = parts[0] || "dashboard";
  const id = parts[1] ? decodeURIComponent(parts.slice(1).join("/")) : null;
  return TITLES[view] ? { view, id } : { view: "dashboard", id: null };
}

function renderChrome() {
  const d = S.data;
  const route = S.route.view;
  document.querySelectorAll("[data-trading-style]").forEach((el) => { el.classList.toggle("active", el.dataset.tradingStyle === S.settings.style); el.setAttribute("aria-pressed", String(el.dataset.tradingStyle === S.settings.style)); });
  const navRoute = route === "analysis" ? "news" : route === "signal" ? (S.watch.has(S.route.id) ? "watch" : "signals") : route === "strategy" ? "strategies" : route;
  document.querySelectorAll("[data-route]").forEach((el) => {
    const on = el.dataset.route === navRoute;
    el.classList.toggle("active", on);
    if (on) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current");
  });
  document.getElementById("current-section").textContent = TITLES[route];
  const bal = S.settings.balance ? money(S.settings.balance, 0) : "Въведи баланс";
  document.getElementById("header-balance").textContent = bal;
  document.getElementById("side-balance").textContent = bal;
  document.getElementById("side-risk").textContent = `Риск ${F.num(2).format(S.settings.risk)}% на сделка${riskMoney() ? ` = ${money(riskMoney())}` : ""}`;
  const ms = document.getElementById("market-status");
  if (d?.ready) {
    ms.innerHTML = `<span class="status-dot ${d.market?.open ? "" : "off"}"></span> ${esc(d.market?.label || "")}`;
    document.getElementById("updated-label").textContent = d.prices_updated ? `Цени: ${rel(d.prices_updated)}` : "";
    document.getElementById("nav-signals").textContent = mySignals().filter(isCurrent).length;
    document.getElementById("nav-watches").textContent = S.watch.list().filter((w) => styleOk(w.snapshot.style || FX.TIMEFRAMES[w.snapshot.tf]?.style)).length;
    const hi = newsFor(MY_CURRENCIES, now(), now() + 24 * 3600, ["high"]).length;
    document.getElementById("nav-news").textContent = hi;
  }
  const bar = document.getElementById("alert-bar");
  const msgs = [];
  if (S.error && d?.ready) msgs.push(S.error);
  (d?.errors || []).forEach((m) => msgs.push(m));
  if (d?.ready && d.market?.open && Object.keys(d.pairs).some((p) => !quoteFresh(p))) msgs.push("Някои котировки са остарели. Не използвай непотвърдени входни нива.");
  bar.hidden = !msgs.length;
  bar.innerHTML = msgs.map(esc).join("<br>");
  document.title = `${TITLES[route]} · TradePulse24 — Сигнали за Forex`;
}

function render() {
  const main = document.getElementById("main");
  const d = S.data;
  S.route = parseRoute();
  renderChrome();
  const { view, id } = S.route;
  if (!d?.ready && view !== "lab") { main.innerHTML = viewLoading(); return; }
  recordObservedSignals();
  const views = {
    dashboard: viewDashboard, signals: viewSignals, watch: viewWatch, signal: () => viewSignal(id), strategies: viewStrategies,
    journal: viewObserved, strategy: () => viewStrategy(id), news: viewNews, risk: viewRisk, analysis: () => viewNewsAnalysis(id), workshop: () => viewLab(id || "mine"), settings: viewSettings, help: viewHelp, lab: () => viewLab(id),
  };
  main.innerHTML = views[view]();
  drawCharts();
  if (view === "news") pulsLoadOverview();
}

function drawCharts() {
  const { view, id } = S.route;
  if (view === "signal") {
    const sig = resolveSignal(id);
    if (sig) loadChart(sig);
  }
  if (view === "strategy") {
    const e = stratById(id);
    if (e) drawEquity(e);
  }
}

let resizeTimer;
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(drawCharts, 200); });

function typing() {
  const a = document.activeElement;
  return a && document.getElementById("main").contains(a) && ["INPUT", "SELECT", "TEXTAREA"].includes(a.tagName);
}

const JSON_CACHE = new Map();
async function getJSON(path, fallback) {
  const controller = typeof AbortController === "undefined" ? null : new AbortController();
  const timeout = controller ? setTimeout(() => controller.abort(), 15000) : null;
  try {
    const cached = JSON_CACHE.get(path), headers = {};
    if (cached?.etag) headers["If-None-Match"] = cached.etag;
    else if (cached?.modified) headers["If-Modified-Since"] = cached.modified;
    const r = await fetch(path, { cache: "no-cache", headers, ...(controller ? { signal: controller.signal } : {}) });
    if (r.status === 304 && cached) return cached.value;
    if (!r.ok) return fallback;
    const value = await r.json();
    JSON_CACHE.set(path, { value, etag: r.headers?.get("ETag"), modified: r.headers?.get("Last-Modified") });
    return value;
  } catch (_e) {
    return fallback;
  } finally { if (timeout !== null) clearTimeout(timeout); }
}

/** Всички стратегии: от кода, от библиотеката и твоите (от конструктора). */
function buildCatalog(customSpecs) {
  const cat = {};
  for (const s of FX.CODED.concat(FX.LIBRARY, FX.RESEARCH || [])) cat[s.key] = s;
  for (const spec of customSpecs || []) {
    try { cat[spec.key] = FX.build(Object.assign({ origin: "custom", group: "Мои стратегии", source: "Твоя стратегия" }, spec)); }
    catch (e) { console.warn("Грешка в стратегия", spec.name, e); }
  }
  S.catalog = cat;
  return cat;
}

function splitId(id) {
  const k = id.lastIndexOf("-");
  return [id.slice(0, k), id.slice(k + 1)];
}

function currentEntry(entry) {
  const strat = entry && S.catalog[entry.key];
  if (!entry?.stats || !strat || !strat.tfs.includes(entry.tf)) return false;
  const version = strat.version || strat.spec?.version;
  return !version || (entry.version || 1) === version;
}
function researchEntry(entry) {
  const decorated = FX.decorateEntry(entry, S.catalog[entry.key]);
  return { ...decorated, costs_outdated: (entry.cost_model || "model-v1") !== FX.costs.fingerprint(S.costProfile) };
}

async function recoverTracked(result, tracked, timestamp, meta) {
  const found = new Set(result.signals.map((signal) => signal.id));
  const missing = tracked.filter((signal) => isCurrent(signal) && !found.has(signal.id) && S.catalog[splitId(signal.strategy)[0]]);
  if (!missing.length) return;
  const prices = {};
  await Promise.all([...new Set(missing.map((signal) => signal.pair))].flatMap((pair) => ["M15", "H1", "D1"].map(async (tf) => {
    const data = await getJSON(`data/prices/${pair}_${tf}.json`, { bars: [] });
    (prices[pair] = prices[pair] || {})[tf] = Array.isArray(data?.bars) ? data.bars : [];
  })));
  const ids = new Set(missing.map((signal) => signal.id));
  const engine = new FX.Engine(prices, meta.quotes || {}, { launch: meta.launch, costs: S.costProfile, keepIds: [...ids] }).build(timestamp);
  const list = [...new Set(missing.map((signal) => signal.strategy))].map((id) => {
    const [key, tf] = splitId(id); return { strat: S.catalog[key], tf };
  }).filter(({ strat, tf }) => strat?.tfs.includes(tf));
  for (const signal of engine.run(list).signals) if (ids.has(signal.id)) { result.signals.push(signal); found.add(signal.id); }
  S.trackingMissing = missing.filter((signal) => !found.has(signal.id)).map((signal) => signal.id);
}

/** Зарежда данните; без работещ cron показва само историческия каталог. */
let loadSequence = 0;
async function load() {
  const seq = ++loadSequence;
  try {
  const [meta, rawNews, saved, recent, custom, bundled, costs] = await Promise.all([
    getJSON("data/meta.json", null), getJSON("data/news.json", { events: [] }), getJSON("data/results.json", null),
    getJSON("data/recent.json", null), getJSON("data/custom.json", { strategies: [] }),
    getJSON("data/catalog.json", null), getJSON("api/state.php", { costs: {} }),
  ]);
  if (seq !== loadSequence) return;
  const news = { ...(rawNews || {}), events: Array.isArray(rawNews) ? rawNews : Array.isArray(rawNews?.events) ? rawNews.events : [] };
  news.events = news.events.filter((e) => e && typeof e.title === "string" && Number.isFinite(e.time));
  clearTimeout(S.timer);
  S.meta = meta;
  S.costProfile = FX.costs.normalize(costs?.costs || {});
  S.customSpecs = Array.isArray(custom?.strategies) ? custom.strategies : [];
  buildCatalog(S.customSpecs);
  const results = FX.mergeResults(saved, bundled, S.catalog);
  S.results = results;
  const entriesMap = (results && results.entries) || {};
  const hasQuotes = Object.values(meta?.quotes || {}).some((q) => q && Number.isFinite(q.price) && q.price > 0 && Number.isFinite(q.time) && q.time > 0);
  if (!meta || !recent || !meta.prices_updated || !hasQuotes) {
    S.engine = null;
    S.error = "Липсват текущи цени от cron.php. Показваме само историята на стратегиите, без активни сигнали.";
    S.data = { ready: true,
      strategies: Object.values(entriesMap).filter(currentEntry).map(researchEntry),
      signals: [], pairs: Object.fromEntries(FX.PAIR_KEYS.map((key) => [key, { ...FX.PAIRS[key], price: null, change_pct: null }])),
      market: FX.marketStatus(now()), common_rules: FX.COMMON_RULES,
      news: (news.events || []).map((e) => { const [bg, ex] = FX.translateNews(e.title); return { ...e, title_bg: bg, explain: ex }; }),
      news_updated: news.updated || null, prices_updated: null, errors: [], settings: { refresh_minutes: 20 }, sources: { news: "ForexFactory — седмичен календар" },
    };
    if (typing()) renderChrome(); else render();
    S.timer = setTimeout(load, 30000);
    return;
  }
  const t = now();
  const tracked = [...S.watch.list().map((w) => w.snapshot), ...S.observed.list().filter((r) => ["pending", "open"].includes(r.latest.status)).map((r) => r.latest)]
    .filter((signal) => signal && typeof signal.id === "string" && typeof signal.strategy === "string" && FX.PAIRS[signal.pair] && FX.TIMEFRAMES[signal.tf]);
  const eng = new FX.Engine(recent.prices, meta.quotes || {}, { launch: meta.launch, costs: S.costProfile, keepIds: tracked.map((s) => s.id) }).build(t);
  const published = ((results && results.published) || []).filter((id) => entriesMap[id] && S.catalog[splitId(id)[0]]);
  // Показваме всички тествани варианти, но изчисляваме сигнали само за публикуваните и тези, които потребителят следва.
  const entries = Object.values(entriesMap).filter(currentEntry).map(researchEntry);
  const selected = S.settings.followed ?? defaultsForEntries(entries);
  const runIds = new Set([...published, ...selected, ...tracked.map((sig) => sig.strategy)]);
  const list = [];
  for (const id of runIds) {
    const [key, tf] = splitId(id);
    const strat = S.catalog[key];
    if (strat && strat.tfs.includes(tf) && (!FX.isRetired(strat, tf) || tracked.some((s) => s.strategy === id))) list.push({ strat, tf });
  }
  const res = eng.run(list);
  await recoverTracked(res, tracked, t, meta);
  if (seq !== loadSequence) return;
  S.engine = eng;
  S.data = {
    ready: true,
    strategies: entries,
    signals: res.signals, pairs: res.pairs, market: res.market, common_rules: FX.COMMON_RULES,
    news: (news.events || []).map((e) => { const [bg, ex] = FX.translateNews(e.title); return Object.assign({}, e, { title_bg: bg, explain: ex }); }),
    news_updated: meta.news_updated, prices_updated: meta.prices_updated, errors: meta.errors || [],
    sources: { prices: `Twelve Data (обновяване на ${meta.refresh_minutes || 20} минути)`, news: meta.source_news || "ForexFactory" },
    settings: { refresh_minutes: meta.refresh_minutes || 20 }, results_saved: results ? results.saved : null, live_started: meta.launch,
  };
  S.error = null;
  const readySignals = res.signals.filter((sig) => quoteFresh(sig.pair));
  const changes = S.watch.ingest(readySignals);
  recordObservedSignals();
  SignalNotices.ingest(readySignals);
  if (typing()) renderChrome(); else render();
  if (changes.length) toast(`${changes.length} следени сигнала имат ново състояние. Провери „Следени“. `);
  S.timer = setTimeout(load, 5 * 60000);
  } catch (error) {
    if (seq !== loadSequence) return;
    S.error = "Не успяхме да подготвим ценовия модел. Провери дали recent.json е създаден от текущия cron и дали всички JavaScript файлове са обновени.";
    if (window.TP24_BOOT) window.TP24_BOOT.fail("data_or_script_error", "app.js", 0, error.name);
    else { const main = document.getElementById("main"); if (main) main.innerHTML = `<section class="panel" role="alert"><h1>Зареждането прекъсна</h1><p>${esc(S.error)}</p></section>`; }
  }
}

/* ------------------------------------------------------------ действия */

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("visible"), 3200);
}

function toggleFollow(id) {
  const list = new Set(followedIds());
  if (list.has(id)) list.delete(id); else list.add(id);
  S.settings.followed = [...list];
  saveSettings();
  const e = stratById(id);
  toast(list.has(id) ? `Следваш „${e?.name} · ${e?.tf_label}“. Сигналите ѝ ще се показват в „Сигнали“.` : `Спря да следваш „${e?.name} · ${e?.tf_label}“.`);
  render();
  load();
}

function planText(sig) {
  const lines = [`${sig.pair_name} — ${sig.strategy_name} (${sig.tf_label})`, statusInfo(sig).label];
  ordersOf(sig).forEach((o) => {
    const size = sizing(sig.pair, o);
    const targets = targetCells(o, sig).map(([name, v]) => `${name} ${v == null ? "по правило" : px(sig.pair, v)}`).join(" | ");
    lines.push(`${o.dir === 1 ? "КУПИ" : "ПРОДАЙ"} (${orderType(o)}) ${o.type === "market" ? "≈" : "на"} ${px(sig.pair, o.entry)} | Стоп ${px(sig.pair, o.stop)} | ${targets}`);
    if (o.activate_after) lines.push(`Активиране от ${when(o.activate_after)}. По-ранно докосване отменя модела.`);
    const r = riskLandmarks(sig.pair, o, sig);
    if (r) lines.push(`Ориентири: +1R ${px(sig.pair, r.one)} | +2R ${px(sig.pair, r.two)} — НЕ са допълнителни Take Profit поръчки.`);
    if (size && !size.tooSmall && !size.invalid) lines.push(`Обем: ${lots(size.lots)}${size.b ? ` (${F.num(2).format(size.a)} с Цел 1 + ${F.num(2).format(size.b)} с Цел 2)` : ""} | Риск ${money(size.loss)}`);
  });
  const strat = stratById(sig.strategy);
  if (ownExit(strat) && strat.exit_rules?.length) lines.push(`Правило за изход: ${strat.exit_rules.join(" ")}`);
  if (sig.status === "pending" && ordersOf(sig)[0].type !== "market") lines.push(`Важи до: ${when(sig.valid_until)}`);
  lines.push("Не е инвестиционен съвет.");
  return lines.join("\n");
}

function copy(text) {
  const done = () => toast("Планът е копиран.");
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  else fallbackCopy(text, done);
}

function fallbackCopy(text, done) {
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try { if (document.execCommand("copy")) done(); else toast("Копирането не е достъпно в този браузър."); }
  catch (_e) { toast("Копирането не е достъпно в този браузър."); }
  finally { area.remove(); }
}

function readForm(form) {
  const f = new FormData(form);
  return {
    balance: Number(String(f.get("balance") || "").replace(",", ".")),
    currency: f.get("currency"),
    risk: Number(f.get("risk")),
    style: f.get("style"),
    ...(form.id === "settings-form" ? { smartPairs: f.has("smartPairs") } : {}),
  };
}

document.addEventListener("click", (ev) => {
  const t = ev.target;
  const style = t.closest("[data-trading-style]");
  if (style && ["day", "swing"].includes(style.dataset.tradingStyle)) {
    S.settings.style = style.dataset.tradingStyle;
    saveSettings();
    if (typeof LAB !== "undefined") { LAB.selected.clear(); LAB.form = null; }
    if (typeof JOURNAL !== "undefined") { JOURNAL.editing = null; }
    render(); return;
  }
  const watch = t.closest("[data-watch]");
  if (watch) { ev.preventDefault(); toggleWatch(watch.dataset.watch); return; }
  const unwatch = t.closest("[data-unwatch]");
  if (unwatch) { ev.preventDefault(); removeWatch(unwatch.dataset.unwatch); return; }
  const follow = t.closest("[data-follow]");
  if (follow) { ev.preventDefault(); toggleFollow(follow.dataset.follow); return; }
  const sf = t.closest("[data-sigfilter]");
  if (sf) { S.sigFilter = sf.dataset.sigfilter; render(); return; }
  if (t.closest("[data-showall]")) { S.showAll = !S.showAll; render(); return; }
  const stf = t.closest("[data-stratfilter]");
  if (stf) { S.stratFilter = stf.dataset.stratfilter; render(); return; }
  const stp = t.closest("[data-stratpair]");
  if (stp) { S.stratPair = stp.dataset.stratpair; render(); return; }
  if (t.closest("[data-reset-follow]")) { S.settings.followed = null; saveSettings(); toast("Възстановен е изборът по обща оценка и подходящи инструменти."); render(); load(); return; }
  const newsDay = t.closest("[data-newsday]"), newsNext = t.closest("[data-news-next]");
  if (newsDay || newsNext) {
    S.newsDay = newsDay ? newsDay.dataset.newsday : newsNext.dataset.newsNext;
    if (newsNext) S.newsShowPast = false;
    render();
    if (newsNext) document.getElementById("news-calendar")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    return;
  }
  if (t.closest("[data-newspast]")) { S.newsShowPast = !S.newsShowPast; render(); return; }
  const ni = t.closest("[data-newsimpact]");
  if (ni) { S.newsImpact = ni.dataset.newsimpact; render(); return; }
  if (t.closest("[data-newsmine]")) { S.newsMine = !S.newsMine; render(); return; }
  if (t.closest("#copy-plan")) {
    const sig = resolveSignal(S.route.id);
    if (sig) copy(planText(sig));
  }
});

document.addEventListener("submit", (ev) => {
  const form = ev.target;
  if (form.id === "entry-confirm-form") {
    ev.preventDefault();
    const id = String(new FormData(form).get("signal-id") || "");
    const entered = !!form.querySelector('[name="entered"]')?.checked;
    const price = form.querySelector('[name="actual-price"]')?.value || null;
    if (entered && price && (!Number.isFinite(Number(price)) || Number(price) <= 0)) { toast("Невалидна входна цена."); return; }
    if (S.watch.confirm(id, entered, price)) { toast("Личното потвърждение е запазено."); render(); }
    else toast("Неуспешен запис в браузъра.");
    return;
  }
  if (form.id !== "onboard-form" && form.id !== "settings-form") return;
  ev.preventDefault();
  const v = readForm(form);
  if (!Number.isFinite(v.balance) || v.balance < 50 || v.balance > 10000000) { toast("Въведи баланс между 50 и 10 000 000."); return; }
  S.settings = clean({ ...S.settings, ...v });
  if (typeof JOURNAL !== "undefined") { JOURNAL.editing = null; }
  saveSettings();
  toast("Запазено. Лотът във всеки сигнал вече е за твоя баланс.");
  if (form.id === "onboard-form") render(); else location.hash = "#/";
});

document.addEventListener("input", (ev) => {
  const t = ev.target;
  if (t.id === "pair-search") {
    S.pairQuery = t.value;
    const pos = t.selectionStart;
    render();
    const again = document.getElementById("pair-search");
    if (again) { again.focus(); again.setSelectionRange(pos, pos); }
    return;
  }
  if (t.id === "set-risk") {
    document.getElementById("risk-out").textContent = `${Number(t.value)}%`;
    const bal = Number(document.getElementById("set-balance").value);
    document.getElementById("risk-money").textContent = bal >= 50 ? `= ${money((bal * Number(t.value)) / 100)} на сделка` : "";
    return;
  }
  if (t.id === "size-balance" || t.id === "size-risk") {
    const bal = Number(document.getElementById("size-balance").value);
    const risk = Number(document.getElementById("size-risk").value);
    const next = clean({ ...S.settings, balance: bal, risk });
    if (bal >= 50 && risk >= 0.1 && risk <= 1) {
      S.settings = next;
      saveSettings();
      renderChrome();
      const sig = resolveSignal(S.route.id);
      if (sig) {
        const orders = ordersOf(sig);
        document.getElementById("size-host").innerHTML = orders.map((o, k) => sizeBlock(sig, o, k, orders.length)).join("");
        const steps = stepsFor(sig);
        const host = document.getElementById("steps-host");
        if (host) host.innerHTML = steps.map(([a, p], i) => `<div class="step"><span class="step-index">${String(i + 1).padStart(2, "0")}</span><div><strong>${esc(a)}</strong><p>${esc(p)}</p></div></div>`).join("");
      }
    }
  }
});

window.addEventListener("hashchange", () => { render(); window.scrollTo({ top: 0, behavior: "instant" }); document.getElementById("main").focus({ preventScroll: true }); });
render();
load();
