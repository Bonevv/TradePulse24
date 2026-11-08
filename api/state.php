<?php
declare(strict_types=1);
require __DIR__ . '/lib.php';
require __DIR__ . '/maintenance.php';
require __DIR__ . '/cloudflare.php';

if (!in_array($_SERVER['REQUEST_METHOD'] ?? '', ['GET', 'HEAD'], true)) respond_json(['ok' => false, 'error' => 'Само GET'], 405);
try {
    $config = cfg();
} catch (Throwable $error) {
    respond_json(['ok' => false, 'code' => 'configuration_invalid', 'error' => 'Настройките на сайта не могат да се прочетат.'], 500);
}
try {
    $feed = cloudflare_feed_url($config);
} catch (Throwable $error) {
    respond_json(['ok' => false, 'code' => 'feed_url_invalid', 'error' => 'Адресът на общите данни е невалиден.'], 500);
}
try {
    $input = [];
    if (is_file(DATA_DIR . '/costs.json')) {
        $raw = @file_get_contents(DATA_DIR . '/costs.json');
        if ($raw === false) throw new RuntimeException('Разходите не са достъпни.');
        $input = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    }
    $costs = validate_costs($input);
} catch (Throwable $error) {
    respond_json(['ok' => false, 'code' => 'costs_invalid', 'error' => 'Запазените разходи са невалидни. Провери ги в Лабораторията.'], 500);
}
try {
    $data = ['release' => '5.4.1', 'costs' => $costs, 'feed_url' => $feed];
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $etag = '"' . hash('sha256', $json) . '"';
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-cache');
    header('ETag: ' . $etag);
    if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) { http_response_code(304); exit; }
    echo $json;
} catch (Throwable $error) {
    respond_json(['ok' => false, 'code' => 'state_unavailable', 'error' => 'Настройките на сайта временно не са достъпни.'], 500);
}
