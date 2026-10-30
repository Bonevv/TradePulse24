<?php
declare(strict_types=1);
require __DIR__ . '/../api/lib.php';
require __DIR__ . '/../api/cloudflare.php';

function check_cf(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function rejects_cf(callable $call): void { try { $call(); } catch (Throwable $error) { return; } throw new RuntimeException('Expected rejection'); }

$folder = sys_get_temp_dir() . '/tp24-cf-' . bin2hex(random_bytes(6));
mkdir($folder, 0700, true);
$now = time(); $hour = intdiv($now, 3600) * 3600; $day = intdiv($now, 86400) * 86400;
$row = fn($t) => [$t, 1.1, 1.2, 1.0, 1.11];
$snapshot = ['schema' => 'tradepulse-feed-v1', 'meta' => ['quotes' => ['EURUSD' => ['price' => 1.11, 'time' => $now - 30]], 'updated' => $now, 'prices_updated' => $now - 30, 'price_attempt' => $now - 30, 'next_price_at' => $now + 870, 'errors' => []],
    'recent' => ['generated' => $now, 'prices' => ['EURUSD' => ['M15' => [$row($hour - 900)], 'H1' => [$row($hour - 3600)], 'D1' => [$row($day - 86400)]]]], 'news' => ['events' => [], 'updated' => $now]];
$config = ['cloudflare_feed_url' => 'https://feed.example'];
foreach (array_keys(PAIRS) as $pair) $snapshot['recent']['prices'][$pair] = $snapshot['recent']['prices']['EURUSD'];
try {
    check_cf(cloudflare_feed_url([]) === '', 'Legacy remains the default');
    foreach (['http://feed.example', 'https://user@feed.example', 'https://feed.example/path', 'https://feed.example/?token=secret'] as $url) rejects_cf(fn() => cloudflare_feed_url(['cloudflare_feed_url' => $url]));
    check_cf(validate_cloudflare_snapshot($snapshot, $now) === $snapshot, 'Valid snapshot');
    $bad = $snapshot; unset($bad['recent']['prices']['USDJPY']);
    rejects_cf(fn() => validate_cloudflare_snapshot($bad, $now));
    $bad = $snapshot; $bad['meta']['quotes']['EURUSD']['time'] = $now + 3600;
    rejects_cf(fn() => validate_cloudflare_snapshot($bad, $now));
    $bad = $snapshot; $bad['recent']['prices']['EURUSD']['M15'] = [$row($hour + 3600)];
    rejects_cf(fn() => validate_cloudflare_snapshot($bad, $now));
    $bad = $snapshot; $bad['recent']['prices']['EURUSD']['M15'][0][2] = .5;
    rejects_cf(fn() => validate_cloudflare_snapshot($bad, $now));
    $calls = 0; $path = $folder . '/cache.json';
    $transport = function ($url) use (&$calls, $snapshot) { $calls++; check_cf($url === 'https://feed.example/snapshot', 'Only the shared cache is read'); return json_encode($snapshot); };
    cloudflare_snapshot($config, $transport, $path, $now);
    cloudflare_snapshot($config, $transport, $path, $now + 30);
    check_cf($calls === 1, 'Repeated server requests share the cache');
    $failed = function () { throw new RuntimeException('private provider detail'); };
    $old = cloudflare_snapshot($config, $failed, $path, $now + 120);
    check_cf($old['meta']['prices_updated'] === $snapshot['meta']['prices_updated'] && $old['meta']['quotes'] === $snapshot['meta']['quotes'], 'Outage does not refresh old quote times');
    rejects_cf(fn() => cloudflare_snapshot(['cloudflare_feed_url' => 'https://other.example'], $failed, $path, $now + 240));

    // Изолиран cron: дори да има локални ключове, provider пътят е забранен в този тест.
    mkdir($folder . '/api'); mkdir($folder . '/data'); mkdir($folder . '/data/private'); mkdir($folder . '/data/prices');
    foreach (['cron.php', 'cloudflare.php'] as $file) copy(__DIR__ . '/../api/' . $file, $folder . '/api/' . $file);
    $lib = file_get_contents(__DIR__ . '/../api/lib.php');
    $lib = str_replace('function source_ready(', 'function not_used_source_ready(', $lib);
    $lib .= "\nfunction source_ready(string \$source): bool { throw new RuntimeException('Provider path must not run'); }\n";
    file_put_contents($folder . '/api/lib.php', $lib);
    file_put_contents($folder . '/api/config.php', '<?php return ' . var_export($config + ['tiingo_key' => 'test-not-used', 'twelvedata_key' => 'test-not-used'], true) . ';');
    file_put_contents($folder . '/data/private/cloudflare-cache.json', json_encode(['url' => $config['cloudflare_feed_url'], 'checked' => $now, 'snapshot' => $snapshot]));
    $oldRow = $row($hour - 7200);
    file_put_contents($folder . '/data/prices/EURUSD_M15.json', json_encode(['bars' => [$oldRow]]));
    file_put_contents($folder . '/data/meta.json', json_encode(['launch' => 123]));
    file_put_contents($folder . '/data/results.json', 'owner-results');
    exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($folder . '/api/cron.php') . ' 2>&1', $output, $status);
    check_cf($status === 0 && strpos(implode("\n", $output), 'Готово') !== false, 'Cloudflare cron only syncs the cache');
    check_cf(read_json($folder . '/data/meta.json', [])['launch'] === 123, 'Original site launch is preserved');
    check_cf(read_json($folder . '/data/prices/EURUSD_M15.json', [])['bars'][0] === json_decode(json_encode($oldRow), true), 'History is merged without losing original candles');
    check_cf(file_get_contents($folder . '/data/results.json') === 'owner-results', 'Owner tests are untouched');
    echo "OK: shared feed validation, server cache, unchanged quote times, isolated sync without provider access, preserved launch/history/results\n";
} finally {
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($folder, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($iterator as $file) { if ($file->isDir()) rmdir($file->getPathname()); else unlink($file->getPathname()); }
    rmdir($folder);
}
