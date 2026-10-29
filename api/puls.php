<?php
declare(strict_types=1);
require __DIR__ . '/lib.php';
require __DIR__ . '/puls-lib.php';
header('Cache-Control: no-store');

try {
    $config = cfg(); $now = time();
    $news = read_json(DATA_DIR . '/news.json', ['events' => [], 'updated' => 0]);
    $meta = read_json(DATA_DIR . '/meta.json', []);
    $path = private_dir() . '/puls-cache.json';
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') respond_json(puls_status($config, $news, $meta, $path, $now));
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') respond_json(['ok' => false, 'error' => 'Само GET или POST', 'code' => 'method_not_allowed'], 405);
    $raw = file_get_contents('php://input');
    if ($raw === false || strlen($raw) > 18000) throw new PulsProblem('request_too_large', 'Въпросът е твърде дълъг.', 413);
    $input = json_decode($raw, true);
    if (!is_array($input)) throw new PulsProblem('invalid_json', 'Въпросът не може да се прочете.');
    $action = $input['action'] ?? 'chat';
    if (!is_string($action)) throw new PulsProblem('invalid_action', 'Непознато действие.');
    if ($action === 'check') {
        // Същото ограничение на грешните опити като при записа в Лабораторията.
        $denied = admin_login($config, $input['password'] ?? null, (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown'), $now);
        if ($denied !== null) {
            if ($denied['status'] === 429) throw new PulsProblem('login_limit', $denied['error'], 429, $denied['retry']);
            if ($denied['status'] === 503) throw new PulsProblem('storage_failed', $denied['error'], 503);
            throw new PulsProblem('admin_required', 'За проверката е нужен вход в Лабораторията.', 403);
        }
        // Проверяваме доставчика и при празен или стар календар, без да измисляме новини.
        $news = ['events' => [], 'updated' => $now]; $meta = [];
    }
    $response = puls_run($action, $input, $config, $news, $meta, $path, $now, (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
    respond_json($response);
} catch (PulsProblem $e) {
    if ($e->retry) header('Retry-After: ' . $e->retry);
    respond_json(['ok' => false, 'error' => $e->getMessage(), 'code' => $e->reason, 'retry_after' => $e->retry], $e->status);
} catch (Throwable $e) {
    respond_json(['ok' => false, 'error' => 'Пулс не успя да завърши. Провери PHP настройките и правата на data/private/.', 'code' => 'server_error'], 503);
}
