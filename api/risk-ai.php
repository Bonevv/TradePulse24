<?php
declare(strict_types=1);
require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/news-ai-lib.php';

function risk_context(array $input, int $now): array
{
    if (count($input) < 10 || count($input) > 50) throw new InvalidArgumentException('За преглед са нужни между 10 и 50 приключили сделки.');
    $trades = [];
    foreach ($input as $item) {
        if (!is_array($item) || !isset(PAIRS[$item['pair'] ?? '']) || !in_array($item['style'] ?? '', ['day', 'swing'], true)
            || !in_array($item['tag'] ?? '', ['plan', 'early', 'stop', 'unplanned'], true)) throw new InvalidArgumentException('В дневника има непълен запис.');
        foreach (['risk_pct', 'r', 'date'] as $field) if (!isset($item[$field]) || !is_numeric($item[$field]) || !is_finite((float) $item[$field])) throw new InvalidArgumentException('Провери числата в дневника.');
        if ($item['risk_pct'] <= 0 || $item['risk_pct'] > 100 || abs($item['r']) > 1000 || $item['date'] <= 0 || $item['date'] > $now + 60) throw new InvalidArgumentException('Провери риска, резултата и датата.');
        $trades[] = ['pair' => $item['pair'], 'style' => $item['style'], 'tag' => $item['tag'], 'risk_pct' => (float) $item['risk_pct'], 'r' => (float) $item['r'], 'date' => (int) $item['date']];
    }
    usort($trades, fn($a, $b) => $a['date'] <=> $b['date']);
    $r = array_column($trades, 'r');
    $risks = array_column($trades, 'risk_pct');
    return ['purpose' => 'risk_review', 'as_of' => $now, 'trades' => $trades,
        'self_assessment_labels' => ['plan' => 'Спазих плана', 'early' => 'Прибързан изход', 'stop' => 'Промених стопа извън плана', 'unplanned' => 'Влязох без потвърждение'],
        'statistics' => ['count' => count($trades), 'average_r' => array_sum($r) / count($r), 'total_r' => array_sum($r),
            'min_risk_pct' => min($risks), 'max_risk_pct' => max($risks), 'self_assessment' => array_count_values(array_column($trades, 'tag'))],
        'missing_data' => ['Историята е въведена ръчно и не е сверена с брокер.', count($trades) < 30 ? 'Малка извадка: наблюденията са предварителни.' : 'Извадката обхваща до 50 последни сделки и не доказва причината за резултатите.'],
        'data_source' => 'Личен дневник — ръчно отчетени сделки', 'event' => ['id' => 'risk-review', 'time' => $now + 1, 'impact' => 'low'], 'signal' => null, 'quote_fresh' => false];
}

if (defined('TP24_LIBRARY_ONLY')) return;
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') respond_json(['ok' => false, 'error' => 'Само POST.'], 405);
if (isset($_SERVER['HTTP_ORIGIN']) && parse_url($_SERVER['HTTP_ORIGIN'], PHP_URL_HOST) !== parse_url('http://' . ($_SERVER['HTTP_HOST'] ?? ''), PHP_URL_HOST)) respond_json(['ok' => false, 'error' => 'Заявката трябва да е от този сайт.'], 403);
if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) respond_json(['ok' => false, 'error' => 'Изпрати JSON заявка.'], 415);
$raw = file_get_contents('php://input', false, null, 0, 24577);
if ($raw === false || strlen($raw) > 24576) respond_json(['ok' => false, 'error' => 'Заявката е твърде голяма.'], 413);
$in = json_decode($raw, true);
if (!is_array($in) || !is_array($in['trades'] ?? null)) respond_json(['ok' => false, 'error' => 'Липсва историята за преглед.'], 400);
$config = cfg();
if (empty($config['gemini_key'])) respond_json(['ok' => false, 'error' => 'Пулс още не е настроен за този сайт. Дневникът и управлението на риска работят без Gemini ключ.', 'code' => 'not_configured'], 503);
try {
    $context = risk_context($in['trades'], time());
    respond_json(array_merge(['ok' => true], ai_cached($context, $config, ai_cache_path())));
} catch (GeminiFailure $e) { ai_failure($e);
} catch (InvalidArgumentException $e) { respond_json(['ok' => false, 'error' => $e->getMessage()], 400);
} catch (RateLimited $e) { respond_json(['ok' => false, 'error' => $e->getMessage(), 'code' => 'site_quota'], 429);
} catch (Throwable $e) { respond_json(['ok' => false, 'error' => 'Прегледът не завърши. Провери настройките на Gemini или опитай по-късно.'], 502); }
