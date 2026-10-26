<?php
declare(strict_types=1);

// Черновите се пазят отделно от версията, която посетителите виждат.
function workspace_read(): array
{
    $public = read_json(DATA_DIR . '/results.json', ['entries' => [], 'published' => []]);
    $local = read_json(private_dir() . '/workspace.json', []);
    return array_merge(['strategies' => read_json(DATA_DIR . '/custom.json', ['strategies' => []])['strategies'], 'entries' => $public['entries'], 'history' => []], $local);
}

function spec_signature(array $spec): string
{
    unset($spec['version'], $spec['updated'], $spec['isNew']);
    return hash('sha256', json_encode($spec, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}

function workspace_custom(array $list, array $ws): array
{
    if (count($list) > 100) throw new InvalidArgumentException('Можеш да запазиш до 100 собствени стратегии.');
    $old = array_column($ws['strategies'], null, 'key');
    $new = [];
    foreach ($list as $spec) {
        if (!is_array($spec) || !preg_match('/^my_[a-zA-Z0-9_]{1,64}$/', $spec['key'] ?? '')) throw new InvalidArgumentException('Невалидно име на стратегията.');
        $key = $spec['key'];
        if (isset($new[$key])) throw new InvalidArgumentException('Има повтаряща се стратегия.');
        if (!is_string($spec['name'] ?? null) || trim($spec['name']) === '' || strlen($spec['name']) > 240) throw new InvalidArgumentException('Въведи кратко име на стратегията.');
        $tfs = $spec['tfs'] ?? [];
        if (!is_array($tfs) || !$tfs || count(array_unique($tfs)) !== count($tfs) || array_diff($tfs, ['M15', 'H1', 'H4', 'D1'])) throw new InvalidArgumentException('Избери графика за дневна или суинг търговия.');
        if (array_intersect($tfs, ['M15', 'H1']) && array_intersect($tfs, ['H4', 'D1'])) throw new InvalidArgumentException('Запази дневния и суинг варианта като отделни стратегии.');
        if (!is_array($spec['when'] ?? null) || !count($spec['when']) || count($spec['when']) > 20) throw new InvalidArgumentException('Задай между 1 и 20 условия за вход.');
        if (isset($spec['pairs']) && (!is_array($spec['pairs']) || !$spec['pairs'] || array_diff($spec['pairs'], array_keys(PAIRS)))) throw new InvalidArgumentException('Непознат инструмент.');
        unset($spec['isNew'], $spec['origin'], $spec['group']);
        $changed = !isset($old[$key]) || spec_signature($spec) !== spec_signature($old[$key]);
        $spec['version'] = (int) ($old[$key]['version'] ?? 0) + ($changed ? 1 : 0);
        $spec['updated'] = $changed ? time() : ($old[$key]['updated'] ?? time());
        $new[$key] = $spec;
    }
    foreach ($old as $key => $previous) {
        if (!isset($new[$key]) || spec_signature($previous) !== spec_signature($new[$key])) {
            $archived = [];
            foreach ($ws['entries'] as $id => $entry) if (strpos($id, $key . '-') === 0) { $archived[$id] = $entry; unset($ws['entries'][$id]); }
            $ws['history'][] = ['strategy' => $previous, 'entries' => $archived, 'archived' => time()];
        }
    }
    $ws['strategies'] = array_values($new);
    $ws['history'] = array_slice($ws['history'], -100);
    return $ws;
}

function workspace_results(array $entries, array $ws): array
{
    if (count($entries) > 1000) throw new InvalidArgumentException('Твърде много резултати в една заявка.');
    $specs = array_column($ws['strategies'], null, 'key');
    foreach ($entries as $id => $entry) {
        if (!is_array($entry) || ($entry['id'] ?? null) !== $id || !in_array($entry['tf'] ?? '', ['M15', 'H1', 'H4', 'D1'], true) || !is_array($entry['stats'] ?? null)) throw new InvalidArgumentException('Невалиден резултат от тест.');
        $key = $entry['key'] ?? '';
        if (!is_string($key) || $id !== $key . '-' . $entry['tf']) throw new InvalidArgumentException('Резултатът не съответства на избраната графика.');
        if (isset($specs[$key]) && !in_array($entry['tf'], $specs[$key]['tfs'], true)) throw new InvalidArgumentException('Тази графика не е част от текущата версия.');
        if (strpos($key, 'my_') === 0 && (!isset($specs[$key]) || ($entry['version'] ?? 0) !== $specs[$key]['version'])) throw new InvalidArgumentException('Правилата са променени. Тествай текущата версия отново.');
    }
    $ws['entries'] = $entries;
    return $ws;
}

function workspace_publish(array $published, array $ws): void
{
    $public = read_json(DATA_DIR . '/results.json', ['entries' => []]);
    $custom = array_column($ws['strategies'], null, 'key');
    $entries = $public['entries'];
    // Собствените стратегии се публикуват със съответната тествана версия.
    foreach ($entries as $id => $entry) if (strpos($entry['key'] ?? '', 'my_') === 0) unset($entries[$id]);
    $specs = [];
    foreach ($published as $id) {
        $entry = $ws['entries'][$id] ?? null;
        if (!$entry) throw new InvalidArgumentException('Първо тествай всяка избрана за публикуване стратегия.');
        $key = $entry['key'];
        if (isset($custom[$key])) {
            if (($entry['version'] ?? 0) !== $custom[$key]['version']) throw new InvalidArgumentException('Има резултат от стара версия. Пусни нов тест.');
            $specs[$key] = $custom[$key];
        }
        $entries[$id] = $entry;
    }
    write_json(DATA_DIR . '/custom.json', ['strategies' => array_values($specs), 'saved' => time()]);
    write_json(DATA_DIR . '/results.json', array_merge($public, ['entries' => $entries, 'published' => array_values($published), 'saved' => time()]));
}
