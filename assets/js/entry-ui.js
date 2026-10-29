"use strict";

/* „Мога ли да вляза сега?“ на страницата на сигнала: съвет по текущата цена, точните полета
   на поръчката при брокера и какво показва историята на стратегията за тази двойка.
   Помощните функции (px, sizing, targetCells…) са в app.js и се извикват при рендериране. */

const BROKER_PRICES = new Map(); // id на сигнала → { price, at }
const BROKER_PRICE_TTL = 15 * 60; // въведената цена важи 15 минути

function brokerPrice(sig) {
  const saved = BROKER_PRICES.get(sig.id);
  return saved && now() - saved.at <= BROKER_PRICE_TTL ? saved : null;
}

/** Цената за съвета: въведената от брокера, иначе последната котировка на сайта. */
function entryQuote(sig) {
  const broker = brokerPrice(sig);
  if (broker) return { price: broker.price, time: broker.at, source: "broker" };
  const price = S.data?.pairs?.[sig.pair]?.price, time = Number(S.meta?.quotes?.[sig.pair]?.time) || null;
  return Number.isFinite(price) ? { price, time, source: "site" } : null;
}

const entryTimingFor = (sig) => pairRow(stratById(sig.strategy), sig.pair)?.timing || null;
const entryLevelsFor = (sig) => FX.entryLevels(entryTimingFor(sig));
const entryStrategy = (sig) => S.catalog?.[sig.strategy.slice(0, sig.strategy.lastIndexOf("-"))] || null;

/** Минути до принудителното затваряне на дневната сделка, ако стратегията има такъв час. */
function minutesToDayClose(sig) {
  if (sig.style !== "day") return null;
  const strat = entryStrategy(sig), hour = strat?.close_hour || strat?.close_hour_day;
  if (!hour) return null;
  return Math.max(0, (FX.localAt(now(), hour) - now()) / 60);
}

/** Моделът на една поръчка: входът и стопът на модела, текущият стоп и ценовите цели. */
function entryModel(sig, order) {
  const targets = targetCells(order, sig).map(([, v]) => v);
  if (sig.status === "open") return { dir: sig.dir, entry: sig.fill_price, stop: sig.stop ?? sig.stop0, stop0: sig.stop0 ?? sig.stop, half: !!sig.half, targets };
  return { dir: order.dir, entry: order.entry, stop: order.stop, stop0: order.stop, half: false, targets };
}

/** Съвет за всяка поръчка на текущ сигнал. null, ако няма надеждна цена. */
function entryAdviceFor(sig) {
  if (!isCurrent(sig) || !(S.data?.signals || []).some((s) => s.id === sig.id)) return null;
  const quote = entryQuote(sig);
  if (!quote) return null;
  const reliable = quote.source === "broker" || quoteFresh(sig.pair);
  const levels = entryLevelsFor(sig), opts = { minutesLeft: minutesToDayClose(sig) };
  const list = ordersOf(sig).map((order) => {
    const model = entryModel(sig, order);
    const advice = sig.status === "open"
      ? FX.entryAdvice(model, quote.price, levels, opts)
      : FX.pendingAdvice({ ...order, targets: model.targets }, quote.price, levels, opts);
    return { order, model, advice };
  }).filter((item) => item.advice);
  return { quote, reliable, levels, list };
}

/* ------------------------------------------------------------ бланка на поръчката */

const isMarketKind = (kind) => kind === "buy" || kind === "sell";
const kindDir = (kind) => (kind.startsWith("buy") ? 1 : -1);
const kindType = (kind) => (isMarketKind(kind) ? "market" : kind.endsWith("limit") ? "limit" : "stop");

/** Кога да изтече поръчка за изчакване: след две свещи от графиката на сигнала, най-късно при дневното затваряне. */
function waitExpiry(sig) {
  let until = now() + 2 * (TF_SEC[sig.tf] || 3600);
  const left = minutesToDayClose(sig);
  if (left !== null) until = Math.min(until, now() + left * 60);
  return until;
}

/** Прозорецът „Нова поръчка“ в MetaTrader: какво точно да попълниш. */
function orderTicket(sig, base, { kind, level, stop, expires = null, note = "" }) {
  const info = FX.ORDER_KINDS[kind], dir = kindDir(kind), market = isMarketKind(kind);
  const order = { ...base, dir, entry: level, stop, type: kindType(kind) };
  const size = sizing(sig.pair, order);
  const cells = targetCells(order, sig), fixed = cells.filter(([, v]) => v != null);
  const two = cells.length > 1 && fixed.length === cells.length && size && !size.tooSmall && !size.invalid && size.b;
  let volume = "въведи баланса си горе, за да се сметне обемът";
  if (size?.invalid) volume = "липсват валидни нива — не отваряй позиция";
  else if (size?.tooSmall) volume = `под 0,01 лота при твоя риск — пропусни (стопът е ${F.num(1).format(size.stopPips)} пипса)`;
  else if (size) volume = two ? `${lots(size.lots)} общо: две поръчки по ${F.num(2).format(size.a)} и ${F.num(2).format(size.b)} лота` : lots(size.lots);
  const tp = !fixed.length
    ? "0 (празно) — без фиксирана цел, изходът е по правилото на стратегията"
    : two ? `поръчка 1: ${px(sig.pair, cells[0][1])} (Цел 1) · поръчка 2: ${px(sig.pair, cells[1][1])} (Цел 2)`
      : fixed.length < cells.length ? `${px(sig.pair, fixed[0][1])} само за частта с ${esc(fixed[0][0])}; останалото — по правило`
        : px(sig.pair, fixed[0][1]);
  const rows = [
    ["Символ", `${esc(sig.pair)} <small>(при някои брокери с добавка, напр. ${esc(sig.pair)}.m; златото може да е GOLD)</small>`],
    ["Тип", market ? `Пазарно изпълнение (Market Execution) → бутон <strong>${info.name}</strong>` : `Отложена поръчка (Pending Order) → <strong>${info.name}</strong>`],
    ["Обем", volume],
    ...(market ? [] : [["Цена", `<strong>${px(sig.pair, level)}</strong> <small>(${esc(info.side)})</small>`]]),
    ["Stop Loss", `${px(sig.pair, stop)} <small>(${F.num(1).format(pips(sig.pair, level, stop))} пипса)</small>`],
    ["Take Profit", tp],
    ...(market ? [] : [["Изтичане", expires ? `Определено (Specified): <strong>${esc(when(expires))}</strong> по софийско време` : "Без изтичане — изтрий поръчката ръчно, когато сигналът отпадне"]]),
  ];
  const trigger = dir === 1
    ? "Покупката се изпълнява по Ask, а стопът и целта ѝ — по Bid (графиката показва Bid)."
    : "Продажбата се изпълнява по Bid, а стопът и целта ѝ — по Ask: те се задействат, когато графиката (Bid) е с един спред преди линията.";
  return `<div class="order-ticket"><div class="ticket-head"><strong>${info.name}</strong><span>${esc(info.short)}</span></div>
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
    <p class="what">${trigger} ${market ? "Провери спреда точно преди да натиснеш." : "Ако брокерът откаже с „Invalid price“, нивото е твърде близо до цената или от грешната страна."}${note ? " " + esc(note) : ""}</p></div>`;
}

/* ------------------------------------------------------------ какво казва историята */

const share = (v) => `${Math.round(v * 100)}%`;
function timingNote(sig, advice) {
  const t = entryTimingFor(sig), lv = advice.levels || FX.entryLevels(null);
  if (!t || !lv.measured) {
    return `Праговете са по подразбиране: до ${fmtR(lv.ok)} след входа — може, до ${fmtR(lv.late)} — изчакай връщане, след това — късно; към стопа над ${F.num(2).format(FX.ENTRY.tooClose)}R — не. Пусни нов тест в Лабораторията, за да се изчислят по историята на тази стратегия за ${sig.pair_name}.`;
  }
  const res = t.res === "M15" ? "15-минутни" : "часови", out = [`По историята за ${sig.pair_name} (${t.n} сделки, по ${res} свещи): вход на нивото на модела — средно ${fmtR(t.base)}.`];
  const late = t.late.filter((row) => row.n >= FX.ENTRY.minTrades && row.r !== null);
  if (["enter", "wait", "late"].includes(advice.advice) && late.length) {
    out.push(`Вход по-късно: ${late.map((row) => `при ${fmtR(row.k)} — ${fmtR(row.r)}`).join("; ")}.`);
  }
  if (["wait", "late"].includes(advice.advice)) {
    const reach = t.back.filter((row) => row.n >= FX.ENTRY.minTrades && row.k <= Math.max(advice.e, .25) + 0.01).pop();
    const zero = reach && t.back.find((row) => row.k === reach.k && row.j === 0);
    if (reach && zero) out.push(`След като цената стигне ${fmtR(reach.k)}, се е връщала до входа на модела в ${share(zero.p)} от случаите${reach.j ? `, а до ${fmtR(reach.j)} — в ${share(reach.p)}` : ""}.`);
  }
  if (["against", "too_close"].includes(advice.advice)) {
    const early = t.early.filter((row) => row.n >= FX.ENTRY.minTrades && row.m <= -advice.e + 0.01).pop();
    if (early) out.push(`Когато цената е стигала ${fmtR(-early.m)}, моделът е завършвал на стоп в ${share(early.sl)} от случаите; вход там е давал средно ${fmtR(early.r)}.`);
    const rec = t.recover.find((row) => row.n >= FX.ENTRY.minTrades);
    if (rec) out.push(`След ${fmtR(-rec.m)} цената се е връщала до входа в ${share(rec.p)} от случаите.`);
  }
  out.push("Това е вероятност от миналото, не гаранция. Вътре в една свещ редът на движенията е неизвестен.");
  return out.join(" ");
}

/* ------------------------------------------------------------ стъпките за всяко състояние */

const sideWord = (dir) => (dir === 1 ? "покупка" : "продажба");
function entryFacts(sig, item, price) {
  const { model, advice } = item, d = model.dir, stopNow = model.stop;
  const risk = Math.abs(price - stopNow), facts = [];
  facts.push(`Вход на модела ${px(sig.pair, model.entry)} · цената сега ${px(sig.pair, price)} (${fmtR(advice.e)}, ${F.num(1).format(pips(sig.pair, price, model.entry))} пипса)`);
  if ((price - stopNow) * d > 0) facts.push(`Ако влезеш на тази цена: стоп ${px(sig.pair, stopNow)} на ${F.num(1).format(pips(sig.pair, price, stopNow))} пипса (${F.num(2).format(risk / advice.risk)} пъти рискът на модела)`);
  const target = advice.target;
  if (Number.isFinite(target) && (target - price) * d > 0 && risk > 0) facts.push(`До целта ${px(sig.pair, target)}: ${F.num(1).format(pips(sig.pair, price, target))} пипса · печалба : риск ${F.num(2).format(Math.abs(target - price) / risk)} : 1`);
  return facts;
}

function entrySteps(sig, item, price) {
  const { order, model, advice } = item, d = model.dir, name = sideWord(d), steps = [];
  const ticket = (opts) => orderTicket(sig, order, { stop: model.stop, ...opts });
  const late = px(sig.pair, advice.lateLevel), ok = px(sig.pair, advice.okLevel);
  switch (advice.advice) {
    case "place":
      if (order.activate_after && order.activate_after > now()) steps.push(["Не поставяй поръчката преди активирането", `Входът е валиден от ${when(order.activate_after)}. Ако цената докосне входа преди това, моделът се отменя.`]);
      steps.push(["Постави отложената поръчка на модела", `Цената още не е стигнала входа${advice.near ? " и е съвсем близо — постави поръчката веднага" : ""}. Видът е ${FX.ORDER_KINDS[advice.kind].name}: ${FX.ORDER_KINDS[advice.kind].short}.`,
        ticket({ kind: advice.kind, level: order.entry, stop: order.stop, expires: sig.valid_until })]);
      if (order.type !== "limit") steps.push(["Ако не искаш по-лоша цена (само MT5)", `Вместо ${FX.ORDER_KINDS[advice.kind].name} може ${d === 1 ? "Buy" : "Sell"} Stop Limit: Stop цена ${px(sig.pair, order.entry)} и Limit цена ${px(sig.pair, order.entry)}. Влиза само на входа или по-добре; при рязък скок може да не влезе изобщо. В MT4 няма такъв вид.`]);
      break;
    case "enter":
      steps.push(["Провери цената при брокера", `За ${name} гледай ${d === 1 ? "Ask" : "Bid"}. Ако е отминала ${ok} (${fmtR(advice.levels.ok)} след входа), не влизай пазарно — тогава важи „Изчакай връщане“.`]);
      steps.push([`Влез пазарно (${FX.ORDER_KINDS[advice.kind].name})`, "Стопът е същият като на модела, а обемът е сметнат за текущата цена, за да рискуваш същата сума.", ticket({ kind: advice.kind, level: price })]);
      // Алтернатива има смисъл само ако сегашната цена е по-лоша от тази на модела.
      if (advice.e > 0) steps.push(["Или изчакай цената на модела", `${FX.ORDER_KINDS[FX.orderFor(d, model.entry, price)].name} на ${px(sig.pair, model.entry)}: по-добра цена, но може да не се изпълни.`]);
      break;
    case "wait":
      steps.push(["Не влизай пазарно на тази цена", `Цената е отминала входа с ${fmtR(advice.e)}. Ако влезеш сега, стопът е по-далеч, а пътят до целта — по-къс.`]);
      steps.push([`Постави ${FX.ORDER_KINDS[advice.kind].name} на ${px(sig.pair, advice.level)}`, `Влизаш само ако цената се върне до ${ok} (${fmtR(advice.levels.ok)} след входа на модела).`,
        ticket({ kind: advice.kind, level: advice.level, expires: waitExpiry(sig) })]);
      steps.push(["Кога да изтриеш поръчката", `Изтрий я, ако цената стигне ${late} (${fmtR(advice.levels.late)} след входа)${Number.isFinite(advice.target) ? ` или целта ${px(sig.pair, advice.target)}` : ""}, преди да се върне — тогава е късно. Изтрий я и ако моделът приключи.`]);
      break;
    case "late": {
      const why = {
        part: "Моделът вече е взел първата цел — сделката е в последната си част.",
        target: "Цената вече е стигнала целта.",
        stop_moved: "Моделът вече е преместил стопа в печалба.",
        time: `До затварянето на дневната сделка остават ${F.num(0).format(minutesToDayClose(sig) || 0)} минути.`,
        distance: `Цената е на ${fmtR(advice.e)} от входа — над прага ${fmtR(advice.levels.late)}.`,
      }[advice.reason] || "";
      steps.push(["Не влизай по този сигнал", `${why} Ако влезеш сега, рискът е по-голям от този в теста, а печалбата до целта — по-малка.`]);
      steps.push(["Изчакай следващия сигнал", "Включи известията в „Настройки“, за да виждаш сигналите навреме."]);
      if (advice.reason === "distance") steps.push(["Ако цената се върне", `При връщане под ${late} съветът се сменя на „Изчакай връщане“, а около ${ok} — на „Може да се влезе“. Провери отново тогава.`]);
      break;
    }
    case "against": {
      const kind = advice.kind;
      steps.push(["Цената върви към стопа", `Моделът е в ${name}, но цената е на ${fmtR(advice.e)}. Има два варианта; и двата са със стопа на модела.`]);
      steps.push([`Вариант А: пазарна ${name} сега`, "По-добра цена и по-малък стоп в пипсове, затова обемът е по-голям за същата сума риск. Сигналът по-често стига стопа, когато цената вече е тръгнала натам.", ticket({ kind: d === 1 ? "buy" : "sell", level: price })]);
      steps.push([`Вариант Б: ${FX.ORDER_KINDS[kind].name} на входа ${px(sig.pair, model.entry)}`, "Влизаш само ако цената се върне до входа на модела — потвърждение, че посоката се възстановява.", ticket({ kind, level: model.entry, expires: waitExpiry(sig) })]);
      steps.push(["Не увеличавай риска", "Обемите по-горе вече са сметнати за същата сума риск. Не добавяй втора позиция, ако вече си влязъл."]);
      break;
    }
    case "too_close":
      steps.push(["Не влизай сега", `До стопа остават ${F.num(1).format(pips(sig.pair, price, model.stop))} пипса. Спредът и обичайните колебания могат да го задействат веднага.`]);
      steps.push([`Само ако се върне: ${FX.ORDER_KINDS[advice.kind].name} на ${px(sig.pair, model.entry)}`, "Влизаш, ако цената се върне до входа на модела.", orderTicket(sig, order, { kind: advice.kind, level: model.entry, stop: model.stop, expires: waitExpiry(sig) })]);
      break;
    case "stopped":
    case "void":
      steps.push(["Не влизай", advice.advice === "void" ? "Цената е стигнала стопа преди входа. По модела сигналът отпада." : "Цената е на стопа или отвъд него. Моделът приключва на загуба при следващото обновяване."]);
      break;
    default:
  }
  return steps;
}

const ADVICE_CLASS = { place: "wait", enter: "go", wait: "wait", late: "stop", against: "warn", too_close: "stop", stopped: "stop", void: "stop" };
function adviceHeading(sig, item) {
  const a = item.advice;
  if (a.advice === "place") return a.near ? "Около входа — постави поръчката" : "Чака вход — постави поръчката";
  if (a.advice === "void") return "Сигналът отпада";
  if (a.advice === "wait") return `Изчакай връщане до ${px(sig.pair, a.level)}`;
  return FX.ADVICE_LABELS[a.advice] || "";
}

/** Панелът на страницата на сигнала. */
function entryNowPanel(sig) {
  if (!isCurrent(sig) || !(S.data?.signals || []).some((s) => s.id === sig.id)) return "";
  const orders = ordersOf(sig), dir = orders.length === 1 ? orders[0].dir : 0;
  const broker = brokerPrice(sig), data = entryAdviceFor(sig);
  const priceLabel = dir === 1 ? "Ask (цената за покупка)" : dir === -1 ? "Bid (цената за продажба)" : "Bid";
  const form = `<form class="entry-price-form" data-entry-form="${esc(sig.id)}">
      <label for="entry-price">Цена при брокера сега · ${priceLabel}</label>
      <div class="entry-price-row"><input id="entry-price" name="price" type="text" inputmode="decimal" autocomplete="off" placeholder="напр. ${esc(px(sig.pair, pairInfo(sig.pair).price))}" value="${broker ? esc(px(sig.pair, broker.price)) : ""}">
        <button class="btn btn-primary btn-sm">Сметни</button>${broker ? `<button type="button" class="btn btn-quiet btn-sm" data-entry-clear="${esc(sig.id)}">Изчисти</button>` : ""}</div></form>`;
  let source = "";
  if (data?.quote) {
    source = data.quote.source === "broker"
      ? `Сметнато по въведената цена ${px(sig.pair, data.quote.price)} (${esc(F.time.format(new Date(data.quote.time * 1000)))}). Важи 15 минути.`
      : `Сметнато по котировката на сайта ${px(sig.pair, data.quote.price)}${data.quote.time ? ` от ${esc(when(data.quote.time))}` : ""}. Тя може да закъснява до около ${S.data?.settings?.refresh_minutes || 20} минути — за точна сметка въведи цената от брокера.`;
  }
  let body;
  if (!data || !data.list.length) body = `<p class="what">Няма цена за изчисление. Въведи текущата цена от брокера.</p>`;
  else if (!data.reliable) body = `<div class="entry-verdict entry-warn"><strong>Цената на сайта е стара</strong><span>Не преценявай входа по нея. Въведи текущата цена от брокера отгоре.</span></div>`;
  else {
    const closed = S.data?.market?.open === false ? `<p class="warn-line">Пазарът е затворен. Отложените поръчки ще се изпълнят чак при отварянето, възможно с гап.</p>` : "";
    body = closed + data.list.map((item) => {
      const head = orders.length > 1 ? `<div class="order-title">${item.order.dir === 1 ? "▲ Покупка" : "▼ Продажба"}</div>` : "";
      const facts = item.advice.advice === "place" || item.advice.advice === "void" ? [] : entryFacts(sig, item, data.quote.price);
      const reached = item.advice.reachedHere ? `<p class="what">При тази цена входът вече е достигнат, въпреки че данните на сайта още го показват като чакащ.</p>` : "";
      const steps = entrySteps(sig, item, data.quote.price);
      const heading = adviceHeading(sig, item);
      return `${head}<div class="entry-verdict entry-${ADVICE_CLASS[item.advice.advice] || "wait"}"><strong>${esc(heading)}</strong><span>${item.advice.advice === "place" ? `Цената е на ${F.num(1).format(pips(sig.pair, data.quote.price, item.order.entry))} пипса от входа.` : `Цената е на ${fmtR(item.advice.e)} от входа на модела.`}</span></div>${reached}
        ${facts.length ? `<ul class="entry-facts">${facts.map((f) => `<li>${f}</li>`).join("")}</ul>` : ""}
        <div class="steps-list">${steps.map(([title, text, extra], i) => `<div class="step"><span class="step-index">${String(i + 1).padStart(2, "0")}</span><div><strong>${esc(title)}</strong><p>${esc(text)}</p>${extra || ""}</div></div>`).join("")}</div>
        ${item.advice.advice === "place" ? "" : `<p class="what">${esc(timingNote(sig, item.advice))}</p>`}`;
    }).join("");
    if (orders.length > 1 && sig.status === "pending") body += `<p class="what"><strong>Две посоки:</strong> когато едната поръчка се изпълни, изтрий веднага другата. MetaTrader не го прави сам.</p>`;
  }
  return `<section class="panel entry-now" id="entry-now"><div class="panel-head"><div><p class="kicker">ВХОД СЕГА</p><h3>Мога ли да вляза сега?</h3></div><a class="text-link" href="#/help">Видове поръчки ↗</a></div>
    ${form}<p class="what">${source}</p>${body}</section>`;
}

/** Ред за копирания план. */
function entryPlanLine(sig) {
  const data = entryAdviceFor(sig), item = data?.list?.[0];
  if (!item || !data.reliable) return null;
  const a = item.advice, where = data.quote.source === "broker" ? "по цената от брокера" : "по котировката на сайта";
  const head = a.advice === "wait" ? `Изчакай връщане до ${px(sig.pair, a.level)} (${FX.ORDER_KINDS[a.kind].name})` : a.advice === "place" ? `Постави ${FX.ORDER_KINDS[a.kind].name} на ${px(sig.pair, a.level)}` : FX.ADVICE_LABELS[a.advice] || "";
  return `Вход сега (${where} ${px(sig.pair, data.quote.price)}): ${head}.`;
}

document.addEventListener("submit", (event) => {
  const form = event.target.closest?.("[data-entry-form]");
  if (!form) return;
  event.preventDefault();
  const sig = resolveSignal(form.dataset.entryForm);
  const value = Number(String(new FormData(form).get("price") || "").replace(/\s/g, "").replace(",", "."));
  const reference = sig ? (sig.status === "open" ? sig.fill_price : ordersOf(sig)[0].entry) : null;
  if (!sig || !Number.isFinite(value) || value <= 0 || !(reference > 0) || Math.abs(value / reference - 1) > 0.2) {
    toast("Въведи текущата цена от брокера, например " + (sig ? px(sig.pair, reference) : "1.08500") + ".");
    return;
  }
  BROKER_PRICES.set(sig.id, { price: value, at: now() });
  document.activeElement?.blur?.();
  render();
  document.getElementById("entry-now")?.scrollIntoView?.({ block: "start" });
});

document.addEventListener("click", (event) => {
  const clear = event.target.closest?.("[data-entry-clear]");
  if (!clear) return;
  BROKER_PRICES.delete(clear.dataset.entryClear);
  render();
});

/* ------------------------------------------------------------ видове поръчки (помощ) */

/** Раздел „Видове поръчки“ в „Как работи“: къде стои всяка поръчка и как се попълва. */
function orderGuide() {
  const item = (title, body, open = false) => `<details${open ? " open" : ""}><summary>${title}</summary>${body}</details>`;
  return `<section class="panel order-guide" id="order-guide"><p class="kicker">ПОРЪЧКИ</p><h3>Видове поръчки и как се попълват</h3>
    <p class="what">Названията са като в MetaTrader 4 и 5. Другите платформи (cTrader, уеб платформите на брокерите) ползват същите думи.</p>
    <div class="order-map" role="img" aria-label="Над текущата цена стоят Buy Stop и Sell Limit, под нея — Buy Limit и Sell Stop">
      <div class="om-cell om-buy"><strong>Buy Stop</strong><small>купи, ако цената се качи до нивото</small></div>
      <div class="om-cell om-sell"><strong>Sell Limit</strong><small>продай, ако цената се върне нагоре до нивото</small></div>
      <div class="om-price">↑ над цената · <strong>текуща цена</strong> · под цената ↓</div>
      <div class="om-cell om-buy"><strong>Buy Limit</strong><small>купи, ако цената се върне надолу до нивото</small></div>
      <div class="om-cell om-sell"><strong>Sell Stop</strong><small>продай, ако цената падне до нивото</small></div>
    </div>
    <p class="what">„Stop“ влиза в посоката на движението (пробив). „Limit“ влиза срещу движението, на по-добра цена (връщане). Брокерът отказва поръчка от грешната страна на цената.</p>
    ${item("Пазарна поръчка (Buy / Sell)", "<p>Купува или продава веднага по текущата цена. Покупката е по Ask, продажбата по Bid. При бързо движение изпълнението може да е малко по-различно от цената на екрана (приплъзване). Ползва се, когато сигналът казва „пазарен вход“ или когато съветът е „Може да се влезе“.</p>", true)}
    ${item("Buy Stop", "<p>Стои <strong>над</strong> текущата цена. Купува, когато Ask стигне нивото. Пример: цената е 1.0840, сигналът е за покупка при пробив на 1.0850 → Buy Stop 1.0850. Ако цената отвори с гап над нивото, изпълнението е на първата налична цена, което може да е по-лошо.</p>")}
    ${item("Sell Stop", "<p>Стои <strong>под</strong> текущата цена. Продава, когато Bid падне до нивото. Пример: цената е 1.0860, сигналът е за продажба при пробив на 1.0850 → Sell Stop 1.0850.</p>")}
    ${item("Buy Limit", "<p>Стои <strong>под</strong> текущата цена. Купува, когато Ask се върне надолу до нивото или по-ниско. Ползва се за вход при връщане и когато входът на сигнала е отминат и чакаш по-добра цена („Изчакай връщане“).</p>")}
    ${item("Sell Limit", "<p>Стои <strong>над</strong> текущата цена. Продава, когато Bid се върне нагоре до нивото или по-високо. Това е огледалото на Buy Limit за продажби.</p>")}
    ${item("Buy Stop Limit и Sell Stop Limit (само MT5)", "<p>Имат две цени: Stop цена (кога да се активира) и Limit цена (каква е най-лошата приемлива цена). Когато Ask стигне Stop цената, се поставя Buy Limit на Limit цената. Ако зададеш една и съща цена за двете, никога не влизаш на по-лоша цена от сигнала, но при рязък скок може да не влезеш изобщо. В MT4 няма такъв вид поръчка.</p>")}
    ${item("Как се попълва прозорецът „Нова поръчка“", `<ol class="rules">
        <li>В Market Watch натисни с десния бутон върху двойката → „Нова поръчка“ (или F9).</li>
        <li><strong>Символ:</strong> провери, че е точната двойка. При някои брокери името има добавка (EURUSD.m, EURUSDpro), а златото може да е XAUUSD или GOLD.</li>
        <li><strong>Обем:</strong> лотовете от сигнала. Те са сметнати така, че при стоп да загубиш избрания процент от баланса.</li>
        <li><strong>Stop Loss:</strong> цената на стопа от сигнала. Задължителен е.</li>
        <li><strong>Take Profit:</strong> цената на целта. Ако стратегията излиза по правило, остави 0.</li>
        <li><strong>Тип:</strong> „Пазарно изпълнение“ → бутон Buy или Sell. За отложена: „Отложена поръчка“, после вида (Buy Stop, Sell Limit…) и <strong>Цена</strong>.</li>
        <li><strong>Изтичане:</strong> за отложената избери „Определено“ (Specified) с дата и час — до кога важи сигналът.</li>
        <li>Натисни „Постави“ (Place) и провери в раздела „Търговия“ (Trade), че поръчката е там с правилните нива.</li></ol>`)}
    ${item("Bid и Ask — защо стопът понякога се задейства „преди линията“", "<p>Bid е цената, на която продаваш, Ask — на която купуваш. Разликата е спредът. Графиката в MetaTrader по подразбиране показва Bid. Покупките (Buy, Buy Stop, Buy Limit) влизат по Ask, а стопът и целта им се задействат по Bid. Продажбите влизат по Bid, а стопът и целта им — по Ask. Затова продажба се затваря на стоп, когато графиката е още един спред под линията на стопа.</p>")}
    ${item("Изтичане и часът на брокера", "<p>Часовете в сайта са по софийско време. Часът на сървъра на брокера може да е различен — виж го горе в Market Watch и го пресметни. Ако платформата не позволява изтичане, изтрий поръчката ръчно в часа от сигнала.</p>")}
    ${item("„Invalid price“ и „Invalid stops“ — защо брокерът отказва", "<p>Брокерът изисква минимално разстояние между текущата цена и нивото на поръчката, стопа и целта (Stops Level). „Invalid price“ означава, че нивото е от грешната страна (например Buy Stop под цената) или твърде близо. „Invalid stops“ или „Invalid S/L or T/P“ означава, че стопът или целта са твърде близо или от грешната страна. Провери вида поръчка по картинката горе.</p>")}
    ${item("Две посоки (OCO)", "<p>Някои сигнали имат покупка над и продажба под. Поставяш и двете отложени поръчки. Когато едната се изпълни, изтрий веднага другата — MetaTrader не го прави сам.</p>")}
    ${item("Две части с две цели", "<p>Ако сигналът има Цел 1 и Цел 2, поставяш две поръчки с половината обем: първата с Take Profit = Цел 1, втората с Take Profit = Цел 2. След Цел 1 премести стопа на втората на входа само ако стратегията го казва.</p>")}
    ${item("Плаващ стоп (Trailing Stop)", "<p>Вграденият Trailing Stop в MetaTrader следва цената на фиксиран брой точки. Това не е същото като плаващ стоп по ATR или по индикатор от стратегията. Ползвай го само ако правилото го описва така; иначе местиш стопа ръчно по правилото.</p>")}
    ${item("Гап и приплъзване", "<p>При отваряне в понеделник или след силна новина цената може да прескочи нивото. Стоп поръчките, включително Stop Loss, се изпълняват на първата налична цена, която може да е по-лоша. Лимитните се изпълняват на нивото или по-добре. Затова реалната загуба може да е по-голяма от сметнатата.</p>")}
    ${item("Влизане след сигнала: може, изчакай, късно", `<p>На страницата на всеки текущ сигнал има „Мога ли да вляза сега?“. Въведи цената от брокера и ще видиш едно от следните:</p><ul class="rules">
        <li><strong>Може да се влезе</strong> — цената е близо до входа на модела. Влизаш пазарно със стопа на модела и обем, сметнат за текущата цена.</li>
        <li><strong>Изчакай връщане до X</strong> — цената е отминала входа. Поставяш Buy Limit или Sell Limit на X и я изтриваш, ако цената стигне нивото „късно“ или целта.</li>
        <li><strong>Късно — не влизай</strong> — цената е твърде далеч, целта или първата част вече са взети, или до затварянето на дневната сделка остава малко.</li>
        <li><strong>Цената е към стопа</strong> — два варианта: пазарно на по-добра цена (по-често стига стопа) или Buy Stop/Sell Stop на входа, за да влезеш само ако цената се върне.</li>
        <li><strong>Твърде близо до стопа</strong> — не влизай; спредът може да задейства стопа веднага.</li></ul>
        <p>Праговете са по историята на стратегията за конкретната двойка, ако е тествана в Лабораторията. Иначе са по подразбиране: до ${fmtR(FX.ENTRY.ok)} — може, до ${fmtR(FX.ENTRY.late)} — изчакай, след това — късно.</p>`)}
  </section>`;
}
