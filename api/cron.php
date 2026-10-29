<?php
/*
 * Обновяване на данните. Пуска се от cron на всеки 20 минути:
 *     php /път/до/сайта/api/cron.php
 * или, ако хостингът позволява само уеб адрес:
 *     https://твоят-сайт.bg/api/cron.php?token=ТАЙНИЯТ_КЛЮЧ
 *
 * Какво прави:
 * 1. Сваля последните 15-минутни свещи за 8-те инструмента (Twelve Data) и от тях сглобява часовите.
 * 2. На 3 часа сваля и дневните свещи.
 * 3. Веднъж на час сваля икономическия календар (ForexFactory).
 * 4. Подготвя data/recent.json - последните свещи, от които браузърът смята сигналите.
 */
declare(strict_types=1);
require __DIR__ . '/lib.php';

if (PHP_SAPI !== 'cli') {
    header('Content-Type: text/plain; charset=utf-8');
    $token = is_string($_GET['token'] ?? null) ? trim($_GET['token']) : '';
    if ($token === '' && count($_GET) === 1) {
        // Приемаме ключа и под друго име (напр. "token", написано с кирилски букви) или само като ?КЛЮЧА.
        // Сигурността е в самия ключ, не в името на параметъра.
        $value = reset($_GET);
        $name = (string) key($_GET);
        if (is_string($value)) $token = trim($value) !== '' ? trim($value) : trim($name);
    }
    $real = trim((string) cfg()['cron_token']);
    $why = null;
    if ($real === '' || $real === DEFAULT_CRON_TOKEN) {
        $why = "в api/config.php НА СЪРВЪРА cron_token още е '" . DEFAULT_CRON_TOKEN . "'. Смени го и качи файла отново.";
    } elseif ($token === '') {
        $qs = (string) ($_SERVER['QUERY_STRING'] ?? '');
        $why = $qs === ''
            ? "до сървъра не стигна нищо след „?“ в адреса.\n"
              . "Ако си го написал, хостингът вероятно пренасочва адреса (http → https или към www) и маха края.\n"
              . "Отвори сайта в браузъра, копирай точния адрес от лентата и добави към него /api/cron.php?token=ТВОЯТ_CRON_TOKEN"
            : 'в адреса няма token. Сървърът получи: ?' . substr($qs, 0, 120);
    } elseif (!hash_equals($real, $token)) {
        $why = 'token в адреса не съвпада с cron_token в api/config.php. Провери за липсваща или излишна буква.';
    }
    if ($why !== null) {
        http_response_code(403);
        exit("Забранено: $why\n");
    }
}
set_time_limit(0);
ignore_user_abort(true);

@mkdir(DATA_DIR . '/prices', 0775, true);
$lock = fopen(DATA_DIR . '/cron.lock', 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) exit("Вече работи друго обновяване.\n");

function say(string $msg): void
{
    echo date('H:i:s') . ' ' . $msg . "\n";
    @ob_flush();
    flush();
}

$meta = read_json(DATA_DIR . '/meta.json', []);
$now = time();
$meta['launch'] = $meta['launch'] ?? $now;
$meta['quotes'] = $meta['quotes'] ?? [];
$meta['d1_updated'] = $meta['d1_updated'] ?? [];
$errors = [];
$gap = 8; // безплатният план на Twelve Data: 8 заявки в минута
$key = (string) cfg()['twelvedata_key'];

/* ---------------------------------------------------------------- цени */
if ($key === '' || $key === 'ПОСТАВИ_КЛЮЧА_ТУК') {
    $errors[] = 'Липсва ключ за Twelve Data в api/config.php. Цените не се обновяват.';
} elseif (($meta['blocked_until'] ?? 0) > $now) {
    $errors[] = 'Източникът на цени временно ограничи заявките. Нов опит след ' . ceil(($meta['blocked_until'] - $now) / 60) . ' мин.';
} else {
    $okCount = 0;
    foreach (PAIRS as $pair => [$symbol]) {
        try {
            // След прекъсване теглим целия пропуск с припокриване, а не само последните 30 часа.
            $old = last_bars($pair, 'M15', 1);
            sleep($gap);
            [$bars, $price, $priceTime] = twelve($pair, '15min', fetch_size($old ? (int) $old[0][0] : null, $now, 900, 120));
            merge_bars($pair, 'M15', $bars);
            if ($price && $priceTime) $meta['quotes'][$pair] = ['price' => $price, 'time' => $priceTime, 'fetched_at' => $now];
            // Часовите свещи се сглобяват от 15-минутните: само завършени часове с всичките им свещи.
            merge_bars($pair, 'H1', hours_from_m15($bars, $now));
            if ($now - (int) ($meta['d1_updated'][$pair] ?? 0) >= 3 * 3600) {
                $oldDay = last_bars($pair, 'D1', 1);
                sleep($gap);
                [$days] = twelve($pair, '1day', fetch_size($oldDay ? (int) $oldDay[0][0] : null, $now, 86400, 15));
                merge_bars($pair, 'D1', $days);
                $meta['d1_updated'][$pair] = $now;
            }
            $okCount++;
            say("$symbol: " . count($bars) . ' нови 15-минутни свещи');
        } catch (RateLimited $e) {
            $meta['blocked_until'] = $now + 900;
            $errors[] = 'Източникът на цени временно ограничи заявките. Нов опит след 15 мин.';
            say("$symbol: лимит на заявките, спирам");
            break;
        } catch (Throwable $e) {
            $errors[] = "$symbol: " . $e->getMessage();
            say("$symbol: ГРЕШКА " . $e->getMessage());
        }
    }
    if ($okCount) $meta['prices_updated'] = $now;

    /* ------------------------------------------------------------ стари дупки */
    // Най-много една допълнителна заявка на час, за да се пази квотата. Всяка дупка се проверява веднъж:
    // ако източникът няма свещи за нея (празник, прекъсване при доставчика), тя остава отбелязана.
    if ($okCount === count(PAIRS) && $now - (int) ($meta['gap_repair_at'] ?? 0) >= 3600) {
        $checked = is_array($meta['gaps_checked'] ?? null) ? $meta['gaps_checked'] : [];
        $todo = null;
        foreach (PAIRS as $pair => [$symbol]) {
            foreach (array_reverse(find_gaps(read_json(prices_file($pair, 'M15'), ['bars' => []])['bars'])) as [$from, $to]) {
                $id = "$pair:$from-$to";
                if (in_array($id, $checked, true)) continue;
                if (!$todo || $to > $todo['to']) $todo = ['pair' => $pair, 'symbol' => $symbol, 'from' => $from, 'to' => $to, 'id' => $id];
                break;
            }
        }
        if ($todo) {
            $meta['gap_repair_at'] = $now;
            try {
                sleep($gap);
                [$bars] = twelve($todo['pair'], '15min', min(5000, intdiv($todo['to'] - $todo['from'], 900) + 8), gmdate('Y-m-d H:i:s', $todo['to']));
                $bars = array_values(array_filter($bars, fn($b) => $b[0] <= $todo['to']));
                $missing = count(array_filter($bars, fn($b) => $b[0] > $todo['from'] && $b[0] < $todo['to']));
                if ($missing) {
                    merge_bars($todo['pair'], 'M15', $bars);
                    merge_bars($todo['pair'], 'H1', hours_from_m15($bars, $now));
                }
                say($todo['symbol'] . ': дупка от ' . gmdate('Y-m-d H:i', $todo['from']) . ' UTC — ' . ($missing ? "допълнени $missing свещи" : 'източникът няма свещи за този период'));
                $checked[] = $todo['id'];
            } catch (RateLimited $e) {
                $meta['blocked_until'] = $now + 900;
                say($todo['symbol'] . ': лимит на заявките при допълване на дупка');
            } catch (Throwable $e) {
                $checked[] = $todo['id'];
                say($todo['symbol'] . ': дупката не е допълнена: ' . $e->getMessage());
            }
            $meta['gaps_checked'] = array_slice($checked, -400);
        }
    }
}

/* ---------------------------------------------------------------- новини */
if ($now - (int) ($meta['news_updated'] ?? 0) >= 3600) {
    try {
        $raw = json_decode(http_get('https://nfs.faireconomy.media/ff_calendar_thisweek.json'), true);
        if (!is_array($raw)) throw new RuntimeException('непонятен отговор');
        $impact = ['High' => 'high', 'Medium' => 'medium', 'Low' => 'low', 'Holiday' => 'holiday'];
        $fresh = [];
        foreach ($raw as $e) {
            $t = strtotime((string) ($e['date'] ?? ''));
            if (!$t) continue;
            $title = trim((string) ($e['title'] ?? ''));
            $cur = strtoupper(trim((string) ($e['country'] ?? '')));
            $id = substr(sha1("$title|$cur|$t"), 0, 12);
            $fresh[$id] = ['id' => $id, 'time' => $t, 'currency' => $cur, 'title' => $title,
                'actual' => $t <= $now && isset($e['actual']) && is_scalar($e['actual']) ? (string) $e['actual'] : null,
                'source' => 'ForexFactory — седмичен календар',
                'impact' => $impact[$e['impact'] ?? ''] ?? 'low', 'forecast' => (string) ($e['forecast'] ?? ''), 'previous' => (string) ($e['previous'] ?? '')];
        }
        // Пазим и събитията от последните 30 дни, които вече не са във фийда. По-старите могат да се изтеглят от „Новини“.
        $firstNew = $fresh ? min(array_column($fresh, 'time')) : $now;
        foreach (read_json(DATA_DIR . '/news.json', ['events' => []])['events'] as $e) {
            if (!isset($fresh[$e['id']]) && $e['time'] >= $now - NEWS_KEEP_DAYS * 86400 && $e['time'] < $firstNew) $fresh[$e['id']] = $e;
        }
        $events = array_values($fresh);
        usort($events, fn($a, $b) => $a['time'] <=> $b['time']);
        write_json(DATA_DIR . '/news.json', ['events' => $events, 'updated' => $now]);
        $meta['news_updated'] = $now;
        say('Новини: ' . count($events) . ' събития');
    } catch (Throwable $e) {
        $errors[] = 'Календарът с новини не можа да се обнови: ' . $e->getMessage();
        say('Новини: ГРЕШКА ' . $e->getMessage());
    }
}

/* ---------------------------------------------------------------- пакет за сайта */
// Последните свещи, от които браузърът на всеки посетител смята текущите сигнали.
$recent = ['generated' => $now, 'prices' => []];
foreach (PAIRS as $pair => $_) {
    $recent['prices'][$pair] = ['M15' => last_bars($pair, 'M15', 1300), 'H1' => last_bars($pair, 'H1', 1700), 'D1' => last_bars($pair, 'D1', 420)];
}
write_json(DATA_DIR . '/recent.json', $recent);

$meta['errors'] = $errors;
$meta['updated'] = $now;
$meta['refresh_minutes'] = (int) (cfg()['refresh_minutes'] ?? 20);
$meta['source_prices'] = 'Twelve Data';
$meta['source_news'] = 'ForexFactory – икономически календар за седмицата';
write_json(DATA_DIR . '/meta.json', $meta);
// Общият обзор се подготвя най-много три пъти дневно при променени данни.
// Провал на помощника не спира цените и календара.
if (!empty(cfg()['groq_key'])) {
    require_once __DIR__ . '/puls-lib.php';
    try {
        $calendar = read_json(DATA_DIR . '/news.json', ['events' => [], 'updated' => 0]);
        $cache = private_dir() . '/puls-cache.json';
        $status = puls_status(cfg(), $calendar, $meta, $cache, $now);
        if ($status['needs_refresh']) { puls_run('overview', [], cfg(), $calendar, $meta, $cache, $now, 'cron'); say('Пулс: дневният обзор е подготвен'); }
    } catch (PulsProblem $e) { say('Пулс: ' . $e->reason); }
    catch (Throwable $e) { say('Пулс: обзорът не е подготвен; провери PHP настройките'); }
}
say('Готово' . ($errors ? ' (с ' . count($errors) . ' грешки)' : ''));
flock($lock, LOCK_UN);
