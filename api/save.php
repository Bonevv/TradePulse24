<?php
/*
 * Записва резултатите от Лабораторията. Само с паролата от api/config.php.
 * POST JSON: {"password": "...", "action": "check" | "results" | "custom", "payload": ...}
 */
declare(strict_types=1);
require __DIR__ . '/lib.php';
require __DIR__ . '/workspace.php';

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
    $lock = fopen(private_dir() . '/workspace.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('Лабораторията е заета. Опитай отново.');
    $ws = workspace_read();
    switch ($action) {
        case 'check':
            respond_json(['ok' => true]);
        case 'workspace':
            respond_json(['ok' => true, 'workspace' => $ws]);
        case 'installation':
            respond_json(['ok' => true, 'installation' => maintenance_installation()]);
        case 'backup':
            respond_json(['ok' => true, 'backup' => maintenance_backup('download')]);
        case 'costs':
            if (!is_array($payload)) throw new InvalidArgumentException('Липсват разходи.');
            $costs = validate_costs($payload);
            maintenance_backup('costs');
            write_json(DATA_DIR . '/costs.json', $costs);
            respond_json(['ok' => true, 'costs' => $costs]);
        case 'restore':
            if (!is_array($payload)) throw new InvalidArgumentException('Липсва резервно копие.');
            maintenance_restore($payload);
            respond_json(['ok' => true, 'workspace' => workspace_read()]);
        case 'custom':
            if (!is_array($payload)) throw new InvalidArgumentException('Липсват стратегии.');
            $ws = workspace_custom($payload, $ws);
            maintenance_backup('drafts');
            write_json(private_dir() . '/workspace.json', $ws);
            respond_json(['ok' => true, 'workspace' => $ws]);
        case 'draft-results':
        case 'results':
            if (!is_array($payload) || !is_array($payload['entries'] ?? null)) throw new InvalidArgumentException('Липсват резултати.');
            $ws = workspace_results($payload['entries'], $ws);
            maintenance_backup($action);
            if ($action === 'results') {
                if (!is_array($payload['published'] ?? null)) throw new InvalidArgumentException('Липсва избор за публикуване.');
                workspace_publish($payload['published'], $ws);
            }
            write_json(private_dir() . '/workspace.json', $ws);
            respond_json(['ok' => true, 'saved' => time(), 'workspace' => $ws]);
        default:
            respond_json(['ok' => false, 'error' => 'Непознато действие.'], 400);
    }
} catch (InvalidArgumentException $e) {
    respond_json(['ok' => false, 'error' => $e->getMessage()], 400);
} catch (Throwable $e) {
    respond_json(['ok' => false, 'error' => 'Записът не завърши. Провери правата на папката с данни.'], 500);
}
