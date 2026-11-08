/* Проверки преди нов вход. Не променят модела и не управляват позиции при брокера. */
(function (FX) {
  "use strict";
  FX.READINESS = Object.freeze({ brokerSeconds: 60, modelSeconds: 30 * 60, calendarSeconds: 2 * 3600, newsSeconds: 30 * 60, costShare: .2 });
  FX.entryReadiness = function (input) {
    const { now, pair, dir, quote, choice, stats, plan } = input, policy = FX.READINESS;
    const blocks = [], warnings = [], add = (code, text) => blocks.push({ code, text });
    if (!input.marketOpen) add("market", "Пазарът е затворен. Изчакай отварянето и нови цени.");
    if (input.goldBreak && pair === "XAUUSD") add("break", "Златото е в дневната си почивка.");
    if (!input.modelFresh || !(input.modelTime > 0) || now - input.modelTime > policy.modelSeconds || input.modelTime > now + 60)
      add("model", "Състоянието на модела не е потвърдено с достатъчно скорошни данни. Само нова цена от брокера не е достатъчна.");
    if (input.expires && input.expires <= now) add("expired", "Срокът на поръчката е изтекъл.");
    if (input.activates > now) add("activation", "Още не е настъпил часът за активиране на поръчката.");
    if (!quote || quote.source !== "broker" || !(quote.bid > 0 && quote.ask >= quote.bid) || !Number.isFinite(quote.ask)
        || !(quote.time > 0) || quote.time > now + 5 || now - quote.time >= policy.brokerSeconds)
      add("quote", "Въведи текущите Bid и Ask от брокера. Проверката важи 60 секунди.");
    if (!choice?.allowed) add("strategy", "Стратегията не покрива подбора за този инструмент. Прегледай оценката и пусни нов тест.");
    if (!input.historyReady) add("history", "Историческата проверка за нов вход е непълна или неустойчива: нужни са поне 60 сделки общо, 30 в първия и 20 в последния период, положителен стрес тест и достатъчно положителни годишни извадки.");
    else if (choice.forward?.state !== "confirmed") warnings.push({ code: "experimental", text: "Има исторически резултат, но няма достатъчно потвърждение след теста. Това е кандидат за демо наблюдение." });
    if (!(input.newsTime > 0) || input.newsTime > now + 60 || now - input.newsTime > policy.calendarSeconds || input.newsFailed)
      add("calendar", "Календарът не е потвърден като актуален. Не можем да изключим близка важна новина.");
    const currencies = pair === "XAUUSD" ? ["USD"] : [pair.slice(0, 3), pair.slice(3, 6)];
    const nearby = (input.news || []).filter((e) => e.impact === "high" && currencies.includes(e.currency) && Number.isFinite(e.time) && Math.abs(e.time - now) <= policy.newsSeconds);
    if (nearby.length) add("news", "Има важна новина за инструмента в рамките на 30 минути преди или след обявяването. Изчакай.");
    if (!(Number.isFinite(input.costRatio) && input.costRatio >= 0)) add("costs", "Няма валидна сметка на разходите спрямо стопа.");
    else if (input.costRatio > policy.costShare) add("costs", "Спредът, комисионата и приплъзването са над 20% от риска до стопа.");
    const risk = input.riskPct;
    if (!(Number.isFinite(input.balance) && input.balance > 0 && Number.isFinite(risk) && risk > 0 && risk <= 1))
      add("risk", "Въведи баланс и риск до 1% за новата сделка.");
    if (stats && plan && risk > 0) {
      const over = (value, limit) => !Number.isFinite(value) || !Number.isFinite(limit) || value > limit + 1e-9;
      if (over(stats.daily + stats.openRisk + risk, plan.daily)) add("daily", "Загубите за деня плюс отворения и новия риск надхвърлят дневния лимит.");
      if (over(stats.weekly + stats.openRisk + risk, plan.weekly)) add("weekly", "Загубите за седмицата плюс отворения и новия риск надхвърлят седмичния лимит.");
      if (over(stats.openRisk + risk, plan.open)) add("portfolio", "Общият отворен риск с тази сделка надхвърля личния лимит.");
      if (over((stats.byPair[pair] || 0) + risk, plan.instrument)) add("instrument", "Рискът за този инструмент с новата сделка надхвърля личния лимит.");
      // Противоположните позиции не намаляват общия риск. Нетното показва само посоката по валута.
      for (const [currency, sign] of [[pair.slice(0, 3), dir], [pair.slice(3, 6), -dir]])
        if (over(Math.abs((stats.byCurrency[currency] || 0) + sign * risk), plan.currency)) add("currency", "Нетният риск към " + currency + " с новата сделка надхвърля личния лимит.");
      if (stats.open.some((t) => t.pair === pair)) add("duplicate", "В дневника вече има позиция в този инструмент. Новият сигнал може да е същият пазарен залог.");
    } else add("journal", "Липсва валидна проверка на личния дневник и рисковите лимити.");
    warnings.push({ code: "journal-scope", text: "Рискът е само по сделките, записани в този браузър. Провери и останалите позиции при брокера." });
    return { allowed: blocks.length === 0, blocks, warnings, nearby };
  };
})(self.FX = self.FX || {});
