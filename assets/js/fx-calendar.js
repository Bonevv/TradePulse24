/* Датите са граждански дни по Europe/Sofia, независимо от часовата зона на браузъра. */
(function (FX) {
  "use strict";
  const zone = "Europe/Sofia";
  const keyFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  const labelFormat = new Intl.DateTimeFormat("bg-BG", { timeZone: zone, weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const shortFormat = new Intl.DateTimeFormat("bg-BG", { timeZone: zone, weekday: "short", day: "2-digit", month: "2-digit" });
  const timeFormat = new Intl.DateTimeFormat("bg-BG", { timeZone: zone, hour: "2-digit", minute: "2-digit" });
  const dayKey = (t) => keyFormat.format(new Date(t * 1000));
  const date = (key) => new Date(key + "T12:00:00Z");
  const move = (key, offset) => new Date(Date.parse(key + "T12:00:00Z") + offset * 86400000).toISOString().slice(0, 10);
  const resultKnown = (event, now) => event.time <= now && event.actual != null && String(event.actual).trim() !== "";
  FX.calendar = {
    dayKey, move, resultKnown,
    time: (t) => timeFormat.format(new Date(t * 1000)),
    label: (key, today) => (key === today ? "Днес · " : key === move(today, 1) ? "Утре · " : "") + labelFormat.format(date(key)),
    view(events, options) {
      const { now, levels, currencies, showPast } = options, today = dayKey(now), selected = options.day === "today" ? today : options.day;
      const list = events.filter((e) => Number.isFinite(e.time) && e.time > 0 && levels.includes(e.impact) && (!currencies || currencies.includes(e.currency))).sort((a, b) => a.time - b.time);
      const weekday = (date(today).getUTCDay() + 6) % 7, monday = move(today, -weekday);
      const dates = new Set(Array.from({ length: 7 }, (_, i) => move(monday, i)));
      // При стар фийд или събитие през съседната седмица датата остава достижима.
      for (const event of list) dates.add(dayKey(event.time));
      dates.add(selected);
      const days = [...dates].sort().map((key) => {
        const items = list.filter((e) => dayKey(e.time) === key && (showPast || e.time >= now));
        return { key, label: key === today ? "Днес" : key === move(today, 1) ? "Утре" : shortFormat.format(date(key)), count: items.length, high: items.filter((e) => e.impact === "high").length };
      });
      const daily = list.filter((e) => dayKey(e.time) === selected);
      return { today, selected, days, items: daily.filter((e) => showPast || e.time >= now), past: daily.filter((e) => e.time < now).length,
        next: list.find((e) => e.time >= now), dayTotal: daily.length };
    },
  };
})(self.FX = self.FX || {});
