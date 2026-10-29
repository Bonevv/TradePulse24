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

/** Пауза след отказ от доставчика; не предсказва кога ще се поднови квотата му. */
function price_limit_message(int $seconds): string
{
    $minutes = max(1, (int) ceil($seconds / 60));
    return 'Twelve Data ограничи заявките. Следващ автоматичен опит най-рано след ' . $minutes
        . ' мин. Ако дневната квота е изчерпана, е нужно да изчакаш нейното подновяване.';
}

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
        foreach (['TWELVEDATA_API_KEY' => 'twelvedata_key', 'TP24_ADMIN_PASSWORD' => 'admin_password', 'TP24_CRON_TOKEN' => 'cron_token', 'GROQ_API_KEY' => 'groq_key', 'GROQ_MODEL' => 'groq_model'] as $variable => $key) {
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
    if ($code === 429) throw new RateLimited('Твърде много заявки (429)');
    if ($code >= 400) throw new RuntimeException("HTTP $code");
    return (string) $body;
}

/** Twelve Data: връща [завършени свещи, последна цена, време на котировката]. */
function twelve(string $pair, string $interval, int $size, ?string $endDate = null): array
{
    $params = ['symbol' => PAIRS[$pair][0], 'interval' => $interval, 'outputsize' => $size, 'timezone' => 'UTC'];
    if ($endDate) $params['end_date'] = $endDate;
    $url = 'https://api.twelvedata.com/time_series?' . http_build_query($params);
    $data = json_decode(http_get($url, ['Authorization: apikey ' . cfg()['twelvedata_key']]), true);
    if (!is_array($data)) throw new RuntimeException('Непонятен отговор от Twelve Data');
    if (($data['status'] ?? '') === 'error') {
        if ((int) ($data['code'] ?? 0) === 429) throw new RateLimited((string) ($data['message'] ?? 'лимит'));
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
