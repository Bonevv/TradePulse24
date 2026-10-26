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

final class RateLimited extends RuntimeException {}

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
        foreach (['TWELVEDATA_API_KEY' => 'twelvedata_key', 'TP24_ADMIN_PASSWORD' => 'admin_password', 'TP24_CRON_TOKEN' => 'cron_token'] as $variable => $key) {
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
