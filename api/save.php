<?php
/*
 * Записва резултатите от Лабораторията. Само с паролата от api/config.php.
 * POST JSON: {"password": "...", "action": "check" | "results" | "custom", "payload": ...}
 */
declare(strict_types=1);
require __DIR__ . '/lib.php';

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') respond_json(['ok' => false, 'error' => 'Само POST'], 405);

$real = (string) cfg()['admin_password'];
if ($real === '' || $real === DEFAULT_ADMIN_PASSWORD) {
    respond_json(['ok' => false, 'error' => 'Първо смени паролата (admin_password) в api/config.php.'], 403);
}
$raw = file_get_contents('php://input');
if ($raw === false || strlen($raw) > 30 * 1024 * 1024) respond_json(['ok' => false, 'error' => 'Твърде голяма заявка'], 413);
$in = json_decode($raw, true);
if (!is_array($in) || !hash_equals($real, (string) ($in['password'] ?? ''))) {
    sleep(1);
    respond_json(['ok' => false, 'error' => 'Грешна парола'], 403);
}

$action = (string) ($in['action'] ?? '');
$payload = $in['payload'] ?? null;
try {
    switch ($action) {
        case 'check':
            $meta = read_json(DATA_DIR . '/meta.json', []);
            respond_json(['ok' => true, 'launch' => $meta['launch'] ?? null]);
        case 'results':
            if (!is_array($payload) || !isset($payload['entries']) || !is_array($payload['entries'])) throw new InvalidArgumentException('Липсват резултати');
            $payload['saved'] = time();
            write_json(DATA_DIR . '/results.json', $payload);
            respond_json(['ok' => true, 'saved' => $payload['saved'], 'count' => count($payload['entries'])]);
        case 'custom':
            if (!is_array($payload)) throw new InvalidArgumentException('Липсват стратегии');
            write_json(DATA_DIR . '/custom.json', ['strategies' => array_values($payload), 'saved' => time()]);
            respond_json(['ok' => true]);
        default:
            respond_json(['ok' => false, 'error' => 'Непознато действие'], 400);
    }
} catch (Throwable $e) {
    respond_json(['ok' => false, 'error' => $e->getMessage()], 500);
}
