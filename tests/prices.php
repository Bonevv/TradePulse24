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

// Tiingo: свещите са по началото си, незавършената последна дава само цената.
$ten = strtotime('2026-10-30 10:00 UTC');
$body = json_encode([
    ['date' => '2026-10-30T10:00:00.000Z', 'ticker' => 'eurusd', 'open' => 1.1, 'high' => 1.102, 'low' => 1.099, 'close' => 1.101],
    ['date' => '2026-10-30T10:15:00.000Z', 'ticker' => 'eurusd', 'open' => 1.101, 'high' => 1.103, 'low' => 1.1, 'close' => 1.102],
    ['date' => '2026-10-30T10:30:00.000Z', 'ticker' => 'eurusd', 'open' => 1.102, 'high' => 1.104, 'low' => 1.101, 'close' => 1.103],
]);
[$tiBars, $tiPrice, $tiTime] = tiingo_parse($body, $ten + 2400);
confirm(count($tiBars) === 2 && $tiBars[0][0] === $ten && $tiBars[1][4] === 1.102, 'Tiingo bars are stamped by their start and the forming one is skipped');
confirm($tiPrice === 1.103 && $tiTime === $ten + 1800, 'The forming bar still gives the latest price');
$limited = false;
try { tiingo_parse('{"detail":"Error: You have run over your hourly request allocation."}', $ten); } catch (RateLimited $e) { $limited = true; }
confirm($limited, 'Tiingo allocation errors are rate limits');
$other = '';
try { tiingo_parse('{"detail":"Invalid token."}', $ten); } catch (RateLimited $e) { $other = 'limit'; } catch (RuntimeException $e) { $other = $e->getMessage(); }
confirm(strpos($other, 'Invalid token') !== false, 'Other Tiingo errors are reported as errors');

// Отказите: минутният лимит е около минута, дневният — до полунощ UTC, часовият — до следващия час.
$noon = strtotime('2026-10-30 12:20 UTC');
confirm(limit_until('twelve', 'You have run out of API credits for the current minute. 9 API credits were used', $noon) === $noon + 70, 'A minute limit waits about a minute');
confirm(limit_until('twelve', 'You have run out of API credits for the day.', $noon) === strtotime('2026-10-31 00:01 UTC'), 'A daily limit waits until UTC midnight');
confirm(limit_until('tiingo', 'Твърде много заявки (429): run over your hourly request allocation', $noon) === strtotime('2026-10-30 13:00:30 UTC'), 'An hourly limit waits for the next hour');
confirm(limit_until('twelve', 'Твърде много заявки (429)', $noon) === $noon + 900, 'An unknown refusal waits 15 minutes');
confirm(key_print('new-key') !== key_print('old-key') && key_print('') === '', 'A new key is not covered by the old block');

// График: делнично 07–22 ч. софийско време на 15 мин, нощем на 3 часа, през уикенда само веднъж след затварянето.
$plan = ['refresh_minutes' => 15, 'night_refresh_minutes' => 180];
$day = strtotime('2026-10-28 08:00 UTC'); // 10:00 в София (зимно време)
confirm(price_due($day, $day - 16 * 60, $plan) === [true, 15], 'Daytime: due after 15 minutes');
confirm(price_due($day, $day - 10 * 60, $plan)[0] === false, 'Daytime: not before');
confirm(price_due($day, $day - 14 * 60, $plan)[0] === true, 'A cron that runs a little early still fetches');
$night = strtotime('2026-10-28 01:00 UTC'); // 03:00 в София
confirm(price_due($night, $night - 3600, $plan) === [false, 180] && price_due($night, $night - 3 * 3600, $plan)[0], 'Night: every three hours');
$closed = strtotime('2026-10-24 10:00 UTC'); // събота
confirm(price_due($closed, strtotime('2026-10-23 20:50 UTC'), $plan)[0], 'One last fetch after the Friday close');
confirm(!price_due($closed, strtotime('2026-10-23 21:10 UTC'), $plan)[0], 'Nothing more on the weekend');
confirm(next_price_at($closed, $plan) === strtotime('2026-10-25 21:00 UTC'), 'The next prices come when the market opens on Sunday');
confirm(price_due($day, 0, ['refresh_minutes' => 1])[1] === 10, 'The daytime interval is at least 10 minutes');

// Без Twelve Data дневните свещи се сглобяват от часовите по UTC ден, само за завършени дни.
$d0 = strtotime('2026-10-27 00:00 UTC');
$hoursList = [[$d0, 1.1, 1.12, 1.09, 1.11], [$d0 + 3600, 1.11, 1.13, 1.1, 1.12], [$d0 + 86400, 1.12, 1.125, 1.115, 1.12], [$d0 + 2 * 86400, 1.12, 1.2, 1.0, 1.1]];
$builtDays = days_from_h1($hoursList, $d0 + 2 * 86400 + 7200, $d0 - 86400);
confirm(count($builtDays) === 2 && $builtDays[0] === [$d0, 1.1, 1.13, 1.09, 1.12], 'A finished UTC day takes the open, extremes and last close of its hours');
confirm(days_from_h1($hoursList, $d0 + 2 * 86400 + 7200, $d0) === [[$d0 + 86400, 1.12, 1.125, 1.115, 1.12]], 'Days already in the file are not rebuilt');

echo "OK: complete hours, outage-sized requests, New York market hours, history gaps, Tiingo parsing, limit types, price schedule and daily candles\n";
