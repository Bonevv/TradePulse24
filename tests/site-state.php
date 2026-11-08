<?php
declare(strict_types=1);

$root = sys_get_temp_dir() . '/tp24-state-' . bin2hex(random_bytes(6));
mkdir($root . '/api', 0700, true); mkdir($root . '/data', 0700, true);
foreach (['lib.php', 'maintenance.php', 'cloudflare.php', 'state.php', 'config.example.php'] as $name) copy(__DIR__ . '/../api/' . $name, $root . '/api/' . $name);
function state_check(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
$run = function () use ($root): array {
    $code = 'foreach (["CLOUDFLARE_FEED_URL","TIINGO_API_KEY","TWELVEDATA_API_KEY","TP24_ADMIN_PASSWORD","TP24_CRON_TOKEN","GROQ_API_KEY","GROQ_MODEL"] as $name) putenv($name);'
        . 'ob_start(); register_shutdown_function(function(){ $body=ob_get_clean();echo json_encode(["http"=>http_response_code()?:200,"body"=>json_decode($body,true),"raw"=>$body]); });'
        . '$_SERVER["REQUEST_METHOD"]="GET"; require ' . var_export($root . '/api/state.php', true) . ';';
    exec(escapeshellarg(PHP_BINARY) . ' -d display_errors=0 -r ' . escapeshellarg($code), $lines, $status);
    state_check($status === 0, 'Endpoint process failed');
    $response = json_decode(implode("\n", $lines), true);
    state_check(is_array($response) && is_array($response['body'] ?? null), 'Response must remain valid JSON');
    state_check(strpos($response['raw'], 'private-test-secret') === false && strpos($response['raw'], $root) === false, 'No secrets, echoed config text or filesystem paths');
    return $response;
};
$local = $root . '/api/config.local.php';
try {
    // Само публичният архив плюс работещ config.local.php: в старата версия require config.php прекъсва.
    file_put_contents($local, '<?php return ["cloudflare_feed_url"=>"https://feed.example","admin_password"=>"private-test-secret"];');
    $r = $run(); state_check($r['http'] === 200 && $r['body']['feed_url'] === 'https://feed.example', 'Local config works without config.php');
    state_check($r['body']['costs']['pairs'] === [], 'Missing cost file keeps the explicit default profile');
    foreach (['/admin', '/snapshot', '/admin/'] as $suffix) {
        file_put_contents($local, '<?php return ["cloudflare_feed_url"=>' . var_export('https://feed.example' . $suffix, true) . '];');
        state_check($run()['body']['feed_url'] === 'https://feed.example', 'Known Worker page suffix is normalized');
    }
    file_put_contents($local, '<?php return ["cloudflare_feed_url"=>"https://feed.example?token=private-test-secret"];');
    $r = $run(); state_check($r['http'] === 500 && $r['body']['code'] === 'feed_url_invalid', 'Feed URL error is distinct from costs');
    file_put_contents($local, '<?php return ["cloudflare_feed_url"=>["private-test-secret"]];');
    state_check($run()['body']['code'] === 'feed_url_invalid', 'Invalid URL types do not print PHP warnings');
    file_put_contents($local, '<?php return ["cloudflare_feed_url"=>"https://feed.example"];');
    file_put_contents($root . '/data/costs.json', '{"pairs":{"EURUSD":{"spread":-1}}}');
    $before = hash_file('sha256', $root . '/data/costs.json');
    $r = $run(); state_check($r['body']['code'] === 'costs_invalid', 'Cost validation errors are identified');
    state_check(hash_file('sha256', $root . '/data/costs.json') === $before, 'Invalid owner costs are not overwritten');
    file_put_contents($root . '/data/costs.json', '{broken');
    state_check($run()['body']['code'] === 'costs_invalid', 'Broken JSON is not silently reset');
    unlink($root . '/data/costs.json');
    file_put_contents($local, "\xEF\xBB\xBF<?php echo 'private-test-secret'; return ['cloudflare_feed_url'=>'https://feed.example'];");
    state_check($run()['body']['feed_url'] === 'https://feed.example', 'BOM and accidental echo do not corrupt JSON');
    file_put_contents($local, '<?php return "private-test-secret";');
    state_check($run()['body']['code'] === 'configuration_invalid', 'Wrong config return type is identified');
    file_put_contents($local, '<?php return [broken syntax;');
    state_check($run()['body']['code'] === 'configuration_invalid', 'Parse errors remain safe JSON');
    echo "OK: local-only config, default merge, BOM, URL normalization, distinct configuration/cost errors, no secrets or owner-file replacement\n";
} finally {
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($it as $p) { if ($p->isDir()) rmdir($p->getPathname()); else unlink($p->getPathname()); } rmdir($root);
}
