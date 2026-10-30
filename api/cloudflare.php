<?php
declare(strict_types=1);

// Само четене от общия кеш. Тук няма заявки към ценови доставчик.
function cloudflare_feed_url(?array $config = null): string
{
    $value = rtrim(trim((string) (($config ?? cfg())['cloudflare_feed_url'] ?? '')), '/');
    if ($value === '') return '';
    $url = parse_url($value);
    if (!$url || ($url['scheme'] ?? '') !== 'https' || empty($url['host']) || isset($url['user']) || isset($url['pass']) || isset($url['query']) || isset($url['fragment']) || !empty($url['path']))
        throw new RuntimeException('Невалиден адрес на общите данни.');
    return $value;
}

function validate_cloudflare_snapshot($data, int $now): array
{
    if (!is_array($data) || ($data['schema'] ?? '') !== 'tradepulse-feed-v1' || !is_array($data['meta'] ?? null)
        || !is_array($data['recent']['prices'] ?? null) || !is_array($data['news']['events'] ?? null)) throw new RuntimeException('Непълен пакет с данни.');
    $meta = $data['meta'];
    if (!is_array($meta['quotes'] ?? null)) throw new RuntimeException('Невалидни котировки.');
    foreach (['updated', 'prices_updated', 'price_attempt'] as $key)
        if (!is_numeric($meta[$key] ?? null) || $meta[$key] < 0 || $meta[$key] > $now + 60) throw new RuntimeException('Невалиден час на данните.');
    foreach ($meta['quotes'] as $pair => $quote) {
        if (!isset(PAIRS[$pair]) || !is_array($quote) || !is_numeric($quote['price'] ?? null) || $quote['price'] <= 0
            || !is_numeric($quote['time'] ?? null) || $quote['time'] <= 0 || $quote['time'] > $now + 60) throw new RuntimeException('Невалидна котировка.');
    }
    foreach (array_keys(PAIRS) as $pair)
        if (!isset($data['recent']['prices'][$pair])) throw new RuntimeException('Липсва история за инструмент.');
    foreach ($data['recent']['prices'] as $pair => $frames) {
        if (!isset(PAIRS[$pair]) || !is_array($frames)) throw new RuntimeException('Невалиден инструмент.');
        foreach (['M15' => 900, 'H1' => 3600, 'D1' => 86400] as $tf => $seconds) {
            if (!is_array($frames[$tf] ?? null) || count($frames[$tf]) < 1 || count($frames[$tf]) > 2000) throw new RuntimeException('Невалидни свещи.');
            $previous = 0;
            foreach ($frames[$tf] as $row) {
                if (!is_array($row) || count($row) !== 5 || count(array_filter($row, 'is_numeric')) !== 5 || $row[0] <= $previous || $row[0] != floor($row[0])
                    || $row[0] % $seconds !== 0 || $row[0] + $seconds > $now || min(array_slice($row, 1)) <= 0
                    || $row[2] < max($row[1], $row[3], $row[4]) || $row[3] > min($row[1], $row[2], $row[4])) throw new RuntimeException('Незавършена или невалидна свещ.');
                $previous = $row[0];
            }
        }
    }
    foreach ($data['news']['events'] as $event)
        if (!is_array($event) || !is_string($event['title'] ?? null) || !is_numeric($event['time'] ?? null)) throw new RuntimeException('Невалиден календар.');
    return $data;
}

function cloudflare_snapshot(?array $config = null, ?callable $transport = null, ?string $cachePath = null, ?int $now = null): array
{
    $url = cloudflare_feed_url($config); if ($url === '') throw new RuntimeException('Общите данни не са включени.');
    $now = $now ?? time(); $path = $cachePath ?? private_dir() . '/cloudflare-cache.json';
    $cached = read_json($path, []);
    if (($cached['url'] ?? '') === $url && (int) ($cached['checked'] ?? 0) > $now - 60 && (int) $cached['checked'] <= $now + 60 && isset($cached['snapshot']))
        return validate_cloudflare_snapshot($cached['snapshot'], $now);
    $lock = fopen($path . '.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('Кешът не е достъпен.');
    try {
        $cached = read_json($path, []);
        if (($cached['url'] ?? '') === $url && (int) ($cached['checked'] ?? 0) > $now - 60 && (int) $cached['checked'] <= $now + 60 && isset($cached['snapshot']))
            return validate_cloudflare_snapshot($cached['snapshot'], $now);
        try {
            $raw = $transport ? $transport($url . '/snapshot') : http_get($url . '/snapshot', [], 15);
            if (!is_string($raw) || strlen($raw) > 8 * 1024 * 1024) throw new RuntimeException('Невалиден размер на пакета.');
            $data = validate_cloudflare_snapshot(json_decode($raw, true), $now);
            write_json($path, ['url' => $url, 'checked' => $now, 'snapshot' => $data]);
            return $data;
        } catch (Throwable $error) {
            if (($cached['url'] ?? '') === $url && isset($cached['snapshot'])) {
                $data = validate_cloudflare_snapshot($cached['snapshot'], $now);
                write_json($path, ['url' => $url, 'checked' => $now, 'snapshot' => $data]);
                return $data;
            }
            throw new RuntimeException('Общите данни временно не са достъпни.');
        }
    } finally { flock($lock, LOCK_UN); fclose($lock); }
}

function sync_cloudflare_snapshot(array $snapshot): void
{
    $old = read_json(DATA_DIR . '/meta.json', []);
    $meta = $snapshot['meta']; $meta['launch'] = $old['launch'] ?? time();
    foreach ($snapshot['recent']['prices'] as $pair => $frames) foreach (['M15', 'H1', 'D1'] as $tf) merge_bars($pair, $tf, $frames[$tf]);
    write_json(DATA_DIR . '/recent.json', $snapshot['recent']);
    write_json(DATA_DIR . '/news.json', $snapshot['news']);
    write_json(DATA_DIR . '/meta.json', $meta);
}
