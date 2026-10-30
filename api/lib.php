<?php
// Общи помощни функции за cron.php и save.php.
declare(strict_types=1);

const DATA_DIR = __DIR__ . '/../data';
const PAIRS = [
    'EURUSD' => ['EUR/USD', 5], 'GBPUSD' => ['GBP/USD', 5], 'USDJPY' => ['USD/JPY', 3], 'AUDUSD' => ['AUD/USD', 5],
    'USDCHF' => ['USD/CHF', 5], 'USDCAD' => ['USD/CAD', 5], 'NZDUSD' => ['NZD/USD', 5], 'XAUUSD' => ['XAU/USD', 2],
];
const DEFAULT_ADMIN_PASSWORD = 'smeni-me';
const DEFAULT_CRON_TOKEN = 'smeni-me-sashto';
const UA = 'Mozilla/5.0 (compatible; ForexSignalsSite/1.0)';
const NEWS_KEEP_DAYS = 30; // толкова дни минали събития остават в календара

final class RateLimited extends RuntimeException {}

const LOGIN_WINDOW = 900;      // грешните опити от един адрес се помнят 15 минути
const LOGIN_CLIENT_LIMIT = 5;  // толкова грешни опити от един адрес за 15 минути
const LOGIN_SITE_LIMIT = 30;   // толкова грешни опити общо за сайта за един час

/**
 * Проверява паролата за Лабораторията и брои грешните опити по адрес и общо за сайта,
 * за да не може паролата да се отгатва с много заявки. Връща null при успех.
 */
function admin_login(array $config, $given, string $client, int $now, ?string $path = null): ?array
{
    $real = (string) ($config['admin_password'] ?? '');
    if ($real === '' || $real === DEFAULT_ADMIN_PASSWORD) return ['status' => 403, 'error' => 'Първо смени паролата (admin_password) в api/config.php.', 'retry' => 0];
    if (!is_string($given) || $given === '') return ['status' => 403, 'error' => 'Грешна парола', 'retry' => 0];
    $storage = ['status' => 503, 'error' => 'Входът не може да се провери. Провери правата на data/private/.', 'retry' => 0];
    try {
        $path = $path ?? private_dir() . '/login-guard.json';
        $lock = @fopen($path . '.lock', 'c');
        if (!$lock) return $storage;
    } catch (Throwable $error) { return $storage; }
    if (!flock($lock, LOCK_EX)) { fclose($lock); return $storage; }
    try {
        $state = read_json($path, []);
        $id = hash('sha256', $client);
        $clients = [];
        foreach (is_array($state['clients'] ?? null) ? $state['clients'] : [] as $key => $times) {
            $kept = array_values(array_filter(is_array($times) ? $times : [], fn($t) => is_int($t) && $t > $now - LOGIN_WINDOW && $t <= $now));
            if ($kept) $clients[$key] = $kept;
        }
        $site = array_values(array_filter(is_array($state['site'] ?? null) ? $state['site'] : [], fn($t) => is_int($t) && $t > $now - 3600 && $t <= $now));
        $mine = $clients[$id] ?? [];
        // При блокиране не проверяваме паролата, за да не се отгатва и тогава.
        if (count($mine) >= LOGIN_CLIENT_LIMIT || count($site) >= LOGIN_SITE_LIMIT) {
            $retry = count($mine) >= LOGIN_CLIENT_LIMIT ? min($mine) + LOGIN_WINDOW - $now : min($site) + 3600 - $now;
            $retry = max(60, $retry);
            return ['status' => 429, 'error' => 'Твърде много грешни опити за вход. Опитай отново след ' . (int) ceil($retry / 60) . ' мин.', 'retry' => $retry];
        }
        if (hash_equals($real, $given)) {
            if ($mine) { unset($clients[$id]); write_json($path, ['clients' => $clients, 'site' => $site]); }
            return null;
        }
        $clients[$id] = array_merge($mine, [$now]);
        $site[] = $now;
        if (count($clients) > 1000) $clients = array_slice($clients, -1000, null, true);
        write_json($path, ['clients' => $clients, 'site' => $site]);
        return ['status' => 403, 'error' => 'Грешна парола', 'retry' => 0];
    } catch (Throwable $error) {
        return $storage;
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function cfg(): array
{
    static $c = null;
    if ($c === null) {
        // Някои хостинги пазят старо копие на PHP файловете (OPcache) - взимаме винаги последната версия на настройките.
        if (function_exists('opcache_invalidate')) {
            @opcache_invalidate(__DIR__ . '/config.php', true);
            @opcache_invalidate(__DIR__ . '/config.local.php', true);
        }
        $c = require __DIR__ . '/config.php';
        if (is_file(__DIR__ . '/config.local.php')) $c = array_merge($c, require __DIR__ . '/config.local.php');
        foreach (['TIINGO_API_KEY' => 'tiingo_key', 'TWELVEDATA_API_KEY' => 'twelvedata_key', 'TP24_ADMIN_PASSWORD' => 'admin_password', 'TP24_CRON_TOKEN' => 'cron_token', 'GROQ_API_KEY' => 'groq_key', 'GROQ_MODEL' => 'groq_model'] as $variable => $key) {
            $value = getenv($variable);
            if ($value !== false && $value !== '') $c[$key] = $value;
        }
    }
    return $c;
}

function read_json(string $path, $default)
{
    $s = @file_get_contents($path);
    if ($s === false) return $default;
    $d = json_decode($s, true);
    return $d === null ? $default : $d;
}

function write_json(string $path, $data): void
{
    $tmp = $path . '.tmp' . getmypid();
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) throw new RuntimeException('JSON грешка: ' . json_last_error_msg());
    if (file_put_contents($tmp, $json, LOCK_EX) === false) throw new RuntimeException("Не мога да запиша $path (провери правата на папка data)");
    if (!rename($tmp, $path)) { @unlink($tmp); throw new RuntimeException('Записът не завърши. Провери правата на папката с данни.'); }
}

function private_dir(): string
{
    $dir = DATA_DIR . '/private';
    if (!is_dir($dir) && !mkdir($dir, 0700, true) && !is_dir($dir)) throw new RuntimeException('Няма права за запис на личните настройки.');
    return $dir;
}

function http_get(string $url, array $headers = [], int $timeout = 90): string
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => $timeout,
        CURLOPT_CONNECTTIMEOUT => 20, CURLOPT_USERAGENT => UA, CURLOPT_HTTPHEADER => $headers,
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($body === false) throw new RuntimeException("Мрежова грешка: $err");
    // Краткият текст на отговора казва дали лимитът е минутен, часов или дневен. Ключът не е в отговора.
    $detail = trim(mb_substr(preg_replace('/\s+/', ' ', strip_tags((string) $body)), 0, 200));
    if ($code === 429) throw new RateLimited('Твърде много заявки (429)' . ($detail !== '' ? ": $detail" : ''));
    if ($code >= 400) throw new RuntimeException("HTTP $code" . ($detail !== '' ? ": $detail" : ''));
    return (string) $body;
}

/** Twelve Data: връща [завършени свещи, последна цена, време на котировката]. */
function twelve(string $pair, string $interval, int $size, ?string $endDate = null): array
{
    $params = ['symbol' => PAIRS[$pair][0], 'interval' => $interval, 'outputsize' => $size, 'timezone' => 'UTC'];
    if ($endDate) $params['end_date'] = $endDate;
    $url = 'https://api.twelvedata.com/time_series?' . http_build_query($params);
    $data = json_decode(http_get($url, ['Authorization: apikey ' . source_key('twelve')]), true);
    if (!is_array($data)) throw new RuntimeException('Непонятен отговор от Twelve Data');
    if (($data['status'] ?? '') === 'error') {
        $code = (int) ($data['code'] ?? 0);
        if ($code === 429) throw new RateLimited((string) ($data['message'] ?? 'лимит'));
        // Грешен ключ се съобщава като HTTP 401/403, за да не се пита за всеки инструмент поотделно.
        if (in_array($code, [401, 403], true)) throw new RuntimeException("HTTP $code: \"detail\": \"" . str_replace('"', "'", (string) ($data['message'] ?? 'грешен ключ')) . '"');
        throw new RuntimeException('Twelve Data: ' . ($data['message'] ?? 'грешка'));
    }
    $step = ['15min' => 900, '1h' => 3600][$interval] ?? 86400;
    $now = time();
    $bars = [];
    $last = null;
    foreach ($data['values'] ?? [] as $v) {
        $t = strtotime($v['datetime'] . (strlen($v['datetime']) === 10 ? ' 00:00:00' : '') . ' UTC');
        $o = (float) $v['open']; $h = (float) $v['high']; $l = (float) $v['low']; $c = (float) $v['close'];
        if ($last === null || $t >= $last[0]) $last = [$t, $c];
        if ($t + $step > $now) continue; // текущата, незавършена свещ
        $bars[] = [$t, $o, max($h, $o, $c), min($l, $o, $c), $c];
    }
    usort($bars, fn($a, $b) => $a[0] <=> $b[0]);
    return [$bars, $last ? $last[1] : null, $last ? $last[0] : null];
}

/* ---------------------------------------------------------------- източници на цени */

const SOURCE_NAMES = ['tiingo' => 'Tiingo', 'twelve' => 'Twelve Data'];
const TWELVE_GAP = 10;          // секунди между заявките към Twelve Data: 6 в минута при лимит 8, с резерв
// Как Tiingo отбелязва 15-минутната свещ: 'start' — с началото ѝ (10:00 е свещта 10:00–10:15), 'end' — с края ѝ.
const TIINGO_BAR_STAMP = 'start';

function source_key(string $source): string
{
    $key = trim((string) (cfg()[$source === 'tiingo' ? 'tiingo_key' : 'twelvedata_key'] ?? ''));
    return $key === 'ПОСТАВИ_КЛЮЧА_ТУК' ? '' : $key;
}
function source_ready(string $source): bool { return source_key($source) !== ''; }
/** Отпечатък на ключа: блокировката важи за ключа, с който е получена, и изчезва при смяна на ключа. */
function key_print(string $key): string { return $key === '' ? '' : substr(sha1($key), 0, 12); }

/** До кога да не се пита източникът след отказ. Дневният лимит е до полунощ UTC, часовият — до следващия час,
    минутният на Twelve Data — около минута. Непознат отказ — 15 минути. */
function limit_until(string $source, string $message, int $now): int
{
    $m = strtolower($message);
    if (strpos($m, 'for the day') !== false || strpos($m, 'daily') !== false) return intdiv($now, 86400) * 86400 + 86400 + 60;
    if (strpos($m, 'hour') !== false) return intdiv($now, 3600) * 3600 + 3600 + 30;
    if (strpos($m, 'minute') !== false) return $now + 70;
    return $source === 'tiingo' ? intdiv($now, 3600) * 3600 + 3600 + 30 : $now + 900;
}

/**
 * Графикът за цените. Делнично от 07:00 до 22:00 софийско време — на refresh_minutes (по подразбиране 15),
 * нощем — на night_refresh_minutes (180). При затворен пазар — още веднъж след затварянето, после нищо до отварянето.
 * Връща [време ли е, интервал в минути].
 */
function price_due(int $now, int $last, array $config): array
{
    $day = max(10, min(60, (int) ($config['refresh_minutes'] ?? 15)));
    $night = max($day, min(360, (int) ($config['night_refresh_minutes'] ?? 180)));
    if (!market_open_at($now)) return [$last === 0 || market_open_at($last), $night];
    $hour = (int) (new DateTimeImmutable('@' . $now))->setTimezone(new DateTimeZone('Europe/Sofia'))->format('G');
    $interval = $hour >= 7 && $hour < 22 ? $day : $night;
    return [$now - $last >= $interval * 60 - 90, $interval];
}

/** Кога най-рано ще дойдат нови цени при този график (стъпки по 5 минути, до 4 дни напред). */
function next_price_at(int $last, array $config): int
{
    for ($t = $last + 300; $t <= $last + 4 * 86400; $t += 300) if (price_due($t, $last, $config)[0]) return $t;
    return $last + 4 * 86400;
}

/** Tiingo: 15-минутните свещи от датата на from (включително) до to. Връща [завършени свещи, последна цена, време]. */
function tiingo(string $pair, int $from, ?int $to = null): array
{
    $ticker = strtolower(str_replace('/', '', PAIRS[$pair][0]));
    $params = ['startDate' => gmdate('Y-m-d', $from), 'resampleFreq' => '15min'];
    if ($to !== null) $params['endDate'] = gmdate('Y-m-d', $to + 86400);
    $url = "https://api.tiingo.com/tiingo/fx/$ticker/prices?" . http_build_query($params);
    return tiingo_parse(http_get($url, ['Authorization: Token ' . source_key('tiingo'), 'Content-Type: application/json']), time());
}

/** Отговорът на Tiingo като свещи [t, o, h, l, c] по началото на свещта. Незавършената последна свещ дава само цената. */
function tiingo_parse(string $body, int $now): array
{
    $data = json_decode($body, true);
    if (!is_array($data)) throw new RuntimeException('Непонятен отговор от Tiingo');
    if (isset($data['detail'])) {
        $message = (string) $data['detail'];
        if (preg_match('/allocation|limit|too many/i', $message)) throw new RateLimited($message);
        throw new RuntimeException('Tiingo: ' . $message);
    }
    $bars = [];
    $last = null;
    foreach ($data as $row) {
        if (!is_array($row) || !isset($row['date'], $row['open'], $row['high'], $row['low'], $row['close'])) continue;
        $t = strtotime((string) $row['date']);
        if ($t === false) continue;
        if (TIINGO_BAR_STAMP === 'end') $t -= 900;
        $o = (float) $row['open']; $h = (float) $row['high']; $l = (float) $row['low']; $c = (float) $row['close'];
        if ($last === null || $t >= $last[0]) $last = [$t, $c];
        if ($t + 900 > $now) continue; // текущата, незавършена свещ
        $bars[] = [$t, $o, max($h, $o, $c), min($l, $o, $c), $c];
    }
    usort($bars, fn($a, $b) => $a[0] <=> $b[0]);
    return [$bars, $last ? $last[1] : null, $last ? $last[0] : null];
}

/** Дневни свещи по UTC ден от часовите — когато няма Twelve Data. Само завършени дни след последната записана дневна. */
function days_from_h1(array $hours, int $now, int $after): array
{
    $days = [];
    foreach ($hours as [$t, $o, $h, $l, $c]) {
        $d = intdiv((int) $t, 86400) * 86400;
        if ($d <= $after || $d + 86400 > $now) continue;
        if (!isset($days[$d])) $days[$d] = [$d, $o, $h, $l, $c];
        else { $days[$d][2] = max($days[$d][2], $h); $days[$d][3] = min($days[$d][3], $l); $days[$d][4] = $c; }
    }
    ksort($days);
    return array_values($days);
}

/** Час по софийско време за съобщенията: „15:00“ днес, иначе „пт 15:00“. */
function sofia_time(int $t, int $now): string
{
    $zone = new DateTimeZone('Europe/Sofia');
    $at = (new DateTimeImmutable('@' . $t))->setTimezone($zone);
    $today = (new DateTimeImmutable('@' . $now))->setTimezone($zone)->format('Y-m-d');
    $days = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'];
    return ($at->format('Y-m-d') === $today ? '' : $days[(int) $at->format('N')] . ' ') . $at->format('H:i');
}

function prices_file(string $pair, string $tf): string
{
    return DATA_DIR . "/prices/{$pair}_{$tf}.json";
}

/** Слива нови свещи с файла. Дневните се изравняват към полунощ на търговския ден. */
function merge_bars(string $pair, string $tf, array $bars): array
{
    $file = prices_file($pair, $tf);
    $digits = PAIRS[$pair][1] + 1;
    $map = [];
    foreach (read_json($file, ['bars' => []])['bars'] as $b) $map[$b[0]] = $b;
    foreach ($bars as [$t, $o, $h, $l, $c]) {
        if ($tf === 'D1') $t = intdiv($t + 7200, 86400) * 86400;
        $map[$t] = [$t, round($o, $digits), round($h, $digits), round($l, $digits), round($c, $digits)];
    }
    ksort($map);
    $out = array_values($map);
    write_json($file, ['bars' => $out]);
    return $out;
}

/**
 * Часовите свещи от 15-минутните. Пропуска час, който не започва от :00 (началото на прозореца),
 * и последния час, докато не дойдат и четирите му свещи. По-ранен час с липсваща свещ
 * се приема, защото след него вече има нови данни и липсата е при източника.
 */
function hours_from_m15(array $bars, int $now): array
{
    $hours = [];
    $count = [];
    foreach ($bars as [$t, $o, $h, $l, $c]) {
        $k = $t - $t % 3600;
        if (!isset($hours[$k])) {
            if ($t !== $k) continue;
            $hours[$k] = [$k, $o, $h, $l, $c];
            $count[$k] = 1;
        } else {
            $hours[$k][2] = max($hours[$k][2], $h);
            $hours[$k][3] = min($hours[$k][3], $l);
            $hours[$k][4] = $c;
            $count[$k]++;
        }
    }
    $last = $hours ? max(array_keys($hours)) : null;
    $out = [];
    foreach ($hours as $k => $bar) {
        if ($k + 3600 > $now || ($k === $last && $count[$k] < 4)) continue;
        $out[] = $bar;
    }
    return $out;
}

/** Колко свещи да поискаме, за да покрием целия пропуск от последната записана свещ, с припокриване. */
function fetch_size(?int $last, int $now, int $step, int $minimum): int
{
    if ($last === null) return 5000;
    return max($minimum, min(5000, intdiv(max(0, $now - $last), $step) + 8));
}

/** Пазарът е отворен от неделя 17:00 до петък 17:00 нюйоркско време (лятното часово време се отчита само). */
function market_open_at(int $t): bool
{
    static $zone = null;
    $zone = $zone ?? new DateTimeZone('America/New_York');
    $local = (new DateTimeImmutable('@' . $t))->setTimezone($zone);
    $day = (int) $local->format('N');
    $hour = (int) $local->format('G');
    return !($day === 6 || ($day === 5 && $hour >= 17) || ($day === 7 && $hour < 17));
}

/**
 * Дупки в 15-минутната история: поне три часа без свещи, докато пазарът е отворен.
 * Уикендите не са дупки. Празници и прекъсвания при източника се проверяват веднъж от cron.
 */
function find_gaps(array $bars): array
{
    $gaps = [];
    for ($i = 1, $n = count($bars); $i < $n; $i++) {
        $from = (int) $bars[$i - 1][0];
        $to = (int) $bars[$i][0];
        if ($to - $from <= 3 * 3600) continue;
        $open = 0;
        for ($t = $from + 900; $t < $to && $open < 3; $t += 3600) if (market_open_at($t)) $open++;
        if ($open >= 3) $gaps[] = [$from, $to];
    }
    return $gaps;
}

function last_bars(string $pair, string $tf, int $n): array
{
    $bars = read_json(prices_file($pair, $tf), ['bars' => []])['bars'];
    return array_slice($bars, -$n);
}

function respond_json($data, int $code = 200): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
