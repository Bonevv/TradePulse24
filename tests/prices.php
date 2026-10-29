<?php
declare(strict_types=1);
require __DIR__ . '/../api/lib.php';
function confirm(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
$bar = fn(int $t, float $c = 1.1) => [$t, $c, $c + 0.001, $c - 0.001, $c];

// Часът се приема само с четирите си свещи, докато е последен; по-ранен час с липса при източника се приема.
$hour = strtotime('2026-10-28 10:00 UTC');
$three = [$bar($hour), $bar($hour + 900), $bar($hour + 1800)];
confirm(hours_from_m15($three, $hour + 7200) === [], 'The newest hour waits for its fourth candle');
$four = array_merge($three, [$bar($hour + 2700, 1.2)]);
$built = hours_from_m15($four, $hour + 3600);
confirm(count($built) === 1 && $built[0][0] === $hour && $built[0][4] === 1.2, 'A full hour closes with its last candle');
confirm(hours_from_m15($four, $hour + 3599) === [], 'An hour is not built before it ends');
$later = array_merge($three, [$bar($hour + 3600), $bar($hour + 4500), $bar($hour + 5400), $bar($hour + 6300)]);
confirm(count(hours_from_m15($later, $hour + 7200)) === 2, 'An earlier hour with a missing candle is kept once later data exists');
confirm(hours_from_m15([$bar($hour + 900), $bar($hour + 1800), $bar($hour + 2700)], $hour + 7200) === [], 'A window that starts inside an hour skips that hour');

// След прекъсване се тегли целият пропуск, а не само последните 30 часа.
$now = strtotime('2026-10-28 12:00 UTC');
confirm(fetch_size(null, $now, 900, 120) === 5000, 'A new pair downloads the full history');
confirm(fetch_size($now - 3600, $now, 900, 120) === 120, 'A normal run keeps the small request');
confirm(fetch_size($now - 3 * 86400, $now, 900, 120) > 3 * 96, 'A three-day outage is covered with overlap');
confirm(fetch_size($now - 200 * 86400, $now, 900, 120) === 5000, 'Requests stay within the provider limit');
confirm(fetch_size($now - 40 * 86400, $now, 86400, 15) === 48, 'Daily candles follow the outage too');

// Пазарни часове по Ню Йорк: зимата затваря в 22:00 UTC, лятото в 21:00 UTC.
confirm(!market_open_at(strtotime('2026-10-30 21:30 UTC')), 'Summer time: closed after 17:00 New York on Friday');
confirm(market_open_at(strtotime('2026-11-06 21:30 UTC')), 'Winter time: still open at 21:30 UTC on Friday');
confirm(!market_open_at(strtotime('2026-11-07 12:00 UTC')), 'Closed on Saturday');
confirm(market_open_at(strtotime('2026-11-08 22:30 UTC')) && !market_open_at(strtotime('2026-11-08 21:30 UTC')), 'Winter Sunday opens at 22:00 UTC');

// Уикендът не е дупка; три часа без свещи в работен ден са.
$friday = strtotime('2026-10-23 20:45 UTC');
confirm(find_gaps([$bar($friday), $bar(strtotime('2026-10-25 21:00 UTC'))]) === [], 'The weekend is not a gap');
$monday = strtotime('2026-10-26 08:00 UTC');
confirm(find_gaps([$bar($monday), $bar($monday + 2 * 3600)]) === [], 'Two hours are tolerated');
confirm(find_gaps([$bar($monday), $bar($monday + 5 * 3600)]) === [[$monday, $monday + 5 * 3600]], 'Five weekday hours without candles are a gap');
confirm(count(find_gaps([$bar($monday), $bar($monday + 2 * 86400)])) === 1, 'A two-day outage is a gap');

echo "OK: complete hours, outage-sized requests, New York market hours and history gaps\n";
