<?php
declare(strict_types=1);
require __DIR__ . '/lib.php';
require __DIR__ . '/maintenance.php';

if (!in_array($_SERVER['REQUEST_METHOD'] ?? '', ['GET', 'HEAD'], true)) respond_json(['ok' => false, 'error' => 'Само GET'], 405);
try {
    $data = ['release' => '5.2.1', 'costs' => validate_costs(read_json(DATA_DIR . '/costs.json', []))];
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $etag = '"' . hash('sha256', $json) . '"';
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-cache');
    header('ETag: ' . $etag);
    if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) { http_response_code(304); exit; }
    echo $json;
} catch (Throwable $error) {
    respond_json(['ok' => false, 'error' => 'Разходите не могат да се прочетат. Провери ги в Лабораторията.'], 500);
}
