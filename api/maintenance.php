<?php
declare(strict_types=1);

// Вграденият каталог се обновява отделно от резултатите и черновите на собственика.
function merge_builtin_results(array $saved): array
{
    $bundle = read_json(DATA_DIR . '/catalog.json', ['entries' => []]);
    $entries = is_array($bundle['entries'] ?? null) ? $bundle['entries'] : [];
    foreach ($saved['entries'] ?? [] as $id => $entry) {
        $base = $entries[$id] ?? null;
        $end = $entry['pair_review']['data_end'] ?? $entry['stats']['end'] ?? 0;
        $baseEnd = $base['pair_review']['data_end'] ?? $base['stats']['end'] ?? 0;
        if (!$base || strpos((string) $id, 'my_') === 0 || $end > $baseEnd
            || ($end === $baseEnd && (($entry['version'] ?? 1) > ($base['version'] ?? 1) || isset($entry['pair_review'])))) $entries[$id] = $entry;
    }
    $saved['entries'] = $entries;
    return $saved;
}

function validate_costs(array $input): array
{
    if (isset($input['pairs']) && !is_array($input['pairs'])) throw new InvalidArgumentException('Невалиден списък с разходи.');
    $out = ['schema' => 1, 'pairs' => []];
    foreach ($input['pairs'] ?? [] as $pair => $row) {
        if (!isset(PAIRS[$pair]) || !is_array($row)) throw new InvalidArgumentException('Непознат инструмент в разходите.');
        foreach (['spread', 'commission', 'slippage', 'swap_long', 'swap_short'] as $field) {
            if (!array_key_exists($field, $row)) continue;
            $value = $row[$field];
            if (!is_numeric($value) || !is_finite((float) $value) || abs((float) $value) > 10000 || (strpos($field, 'swap_') !== 0 && $value < 0))
                throw new InvalidArgumentException('Провери разходите за ' . PAIRS[$pair][0] . '.');
            $out['pairs'][$pair][$field] = (float) $value;
        }
    }
    return $out;
}

function costs_match_current(array $entry): bool
{
    $defaults = ['EURUSD' => 1.0, 'GBPUSD' => 1.4, 'USDJPY' => 1.2, 'AUDUSD' => 1.2, 'USDCHF' => 1.5, 'USDCAD' => 1.5, 'NZDUSD' => 1.6, 'XAUUSD' => 3.0];
    $current = validate_costs(read_json(DATA_DIR . '/costs.json', []));
    $tested = isset($entry['cost_profile']) && is_array($entry['cost_profile']) ? validate_costs($entry['cost_profile']) : ['pairs' => []];
    foreach ($defaults as $pair => $spread) foreach (['spread', 'commission', 'slippage', 'swap_long', 'swap_short'] as $field) {
        $fallback = $field === 'spread' ? $spread : 0;
        if ((float) ($current['pairs'][$pair][$field] ?? $fallback) !== (float) ($tested['pairs'][$pair][$field] ?? $fallback)) return false;
    }
    return true;
}

function maintenance_snapshot(): array
{
    $files = [];
    foreach (['results.json', 'custom.json', 'costs.json', 'private/workspace.json'] as $name) {
        $file = DATA_DIR . '/' . $name;
        if (!is_file($file)) continue;
        $text = file_get_contents($file);
        if ($text === false || strlen($text) > 25 * 1024 * 1024) throw new RuntimeException('Копието не можа да се прочете.');
        $files[$name] = $text;
    }
    return ['format' => 'tradepulse24-server-backup', 'version' => 1, 'created' => time(), 'files' => $files];
}

const BACKUP_RECENT = 10; // последните копия
const BACKUP_DAYS = 14;   // по едно копие на ден за толкова дни
const BACKUP_WEEKS = 8;   // по едно копие на седмица за толкова седмици

function maintenance_backup(string $reason): array
{
    $snapshot = maintenance_snapshot();
    $dir = private_dir() . '/backups';
    if (!is_dir($dir) && !mkdir($dir, 0700) && !is_dir($dir)) throw new RuntimeException('Няма права за резервно копие.');
    $snapshot['reason'] = $reason;
    $snapshot['hash'] = hash('sha256', json_encode($snapshot['files'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    $files = glob($dir . '/backup-*.json') ?: [];
    rsort($files, SORT_STRING);
    // Еднакво съдържание не създава ново копие, за да не изтласква по-старите.
    $latest = $files ? read_json($files[0], []) : [];
    if (($latest['hash'] ?? '') === $snapshot['hash']) return $snapshot;
    $microtime = microtime(true);
    $name = 'backup-' . gmdate('Ymd-His') . '-' . sprintf('%06d', (int) (($microtime - floor($microtime)) * 1000000)) . '-' . bin2hex(random_bytes(4)) . '.json';
    write_json($dir . '/' . $name, $snapshot);
    array_unshift($files, $dir . '/' . $name);
    foreach (maintenance_backups_to_remove($files, time()) as $file) @unlink($file);
    return $snapshot;
}

/**
 * Пазят се последните копия, най-новото за всеки от последните 14 дни и за всяка от последните 8 седмици.
 * $files са подредени от най-новото; времето се чете от името backup-ГГГГММДД-ЧЧММСС-...
 */
function maintenance_backups_to_remove(array $files, int $now): array
{
    $keep = [];
    $days = [];
    $weeks = [];
    foreach ($files as $i => $file) {
        if (!preg_match('~backup-(\d{8})-(\d{6})~', basename($file), $m)) continue;
        $time = strtotime($m[1] . 'T' . $m[2] . 'Z');
        if ($time === false) continue;
        if ($i < BACKUP_RECENT) $keep[$file] = true;
        $day = gmdate('Y-m-d', $time);
        $week = gmdate('o-W', $time);
        if ($time >= $now - BACKUP_DAYS * 86400 && !isset($days[$day])) { $days[$day] = true; $keep[$file] = true; }
        if ($time >= $now - BACKUP_WEEKS * 7 * 86400 && !isset($weeks[$week])) { $weeks[$week] = true; $keep[$file] = true; }
    }
    return array_values(array_filter($files, fn($file) => !isset($keep[$file])));
}

function maintenance_validate_backup(array $backup): array
{
    if (($backup['format'] ?? '') !== 'tradepulse24-server-backup' || ($backup['version'] ?? 0) !== 1 || !is_array($backup['files'] ?? null))
        throw new InvalidArgumentException('Това не е сървърно копие на TradePulse24.');
    $allowed = ['results.json', 'custom.json', 'costs.json', 'private/workspace.json'];
    $decoded = [];
    foreach ($backup['files'] as $name => $text) {
        if (!in_array($name, $allowed, true) || !is_string($text) || strlen($text) > 25 * 1024 * 1024) throw new InvalidArgumentException('Копието съдържа непознат файл.');
        $value = json_decode($text, true);
        if (!is_array($value)) throw new InvalidArgumentException('В копието има повреден JSON файл.');
        $decoded[$name] = $value;
    }
    if (!isset($decoded['results.json'], $decoded['custom.json'])) throw new InvalidArgumentException('В копието липсват резултати или стратегии.');
    if (!is_array($decoded['results.json']['entries'] ?? null) || !is_array($decoded['results.json']['published'] ?? null)
        || !is_array($decoded['custom.json']['strategies'] ?? null)) throw new InvalidArgumentException('Копието има непълен каталог.');
    if (isset($decoded['costs.json'])) $decoded['costs.json'] = validate_costs($decoded['costs.json']);
    return $decoded;
}

function maintenance_restore(array $backup): void
{
    $files = maintenance_validate_backup($backup);
    $custom = $files['custom.json']['strategies'];
    $restored = $files['private/workspace.json'] ?? ['strategies' => $custom, 'entries' => $files['results.json']['entries'], 'history' => []];
    if (!is_array($restored['strategies'] ?? null) || !is_array($restored['entries'] ?? null) || !is_array($restored['history'] ?? null) || count($restored['history']) > 100)
        throw new InvalidArgumentException('Невалидни чернови в копието.');
    foreach ([$custom, $restored['strategies']] as $list) {
        foreach ($list as $spec) if (!is_array($spec) || !is_int($spec['version'] ?? 1) || ($spec['version'] ?? 1) < 1) throw new InvalidArgumentException('Невалидна версия на стратегия в копието.');
        workspace_custom($list, ['strategies' => $list, 'entries' => [], 'history' => []]);
    }
    workspace_results($files['results.json']['entries'], ['strategies' => $custom, 'entries' => []]);
    workspace_results($restored['entries'], $restored);
    foreach ($files['results.json']['published'] as $id) if (!is_string($id) || !isset($files['results.json']['entries'][$id])) throw new InvalidArgumentException('Публикуван вариант липсва в копието.');
    $before = maintenance_backup('before-restore');
    try {
        foreach ($files as $name => $value) write_json(DATA_DIR . '/' . $name, $value);
        foreach (['costs.json', 'private/workspace.json'] as $name) if (!isset($files[$name]) && is_file(DATA_DIR . '/' . $name) && !unlink(DATA_DIR . '/' . $name))
            throw new RuntimeException('Няма права за възстановяване на липсващ файл.');
    } catch (Throwable $error) {
        // Копието остава достъпно, дори ако хостингът прекъсне записването.
        foreach ($before['files'] as $name => $text) {
            $value = json_decode($text, true);
            if (is_array($value)) try { write_json(DATA_DIR . '/' . $name, $value); } catch (Throwable $ignored) {}
        }
        throw new RuntimeException('Възстановяването прекъсна. Състоянието преди него е в сървърните копия.');
    }
}

function maintenance_installation(): array
{
    $manifest = read_json(__DIR__ . '/../release.json', []);
    $files = [];
    foreach ($manifest['files'] ?? [] as $name => $hash) {
        if (!is_string($name) || strpos($name, '..') !== false || !preg_match('~^(?:index\.html|\.htaccess|(?:assets|api|data)/[a-zA-Z0-9_./-]+|(?:docs|tests)/\.htaccess)$~', $name)) continue;
        if (in_array($name, ['api/config.php', 'api/config.local.php'], true)) continue;
        $path = __DIR__ . '/../' . $name;
        $state = !is_file($path) ? 'missing' : (hash_file('sha256', $path) === $hash ? 'ok' : 'different');
        $files[] = ['file' => $name, 'state' => $state];
    }
    return ['release' => $manifest['version'] ?? null, 'ok' => count($files) > 0 && !array_filter($files, fn($row) => $row['state'] !== 'ok'), 'files' => $files];
}
