<?php
declare(strict_types=1);
define('TP24_LIBRARY_ONLY', true);
require_once __DIR__ . '/../api/risk-ai.php';
require_once __DIR__ . '/../api/workspace.php';
function check(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
function rejects(callable $fn, string $class): void {
    try { $fn(); } catch (Throwable $error) { check($error instanceof $class, 'Unexpected error type'); return; }
    throw new RuntimeException('Expected rejection');
}

$now = time();
$spec = ['key' => 'my_check', 'name' => 'Проверка', 'tfs' => ['H1'], 'when' => [['a' => 'close', 'op' => '>', 'b' => 1]], 'stop' => ['type' => 'atr', 'mult' => 1.5]];
$ws = workspace_custom([$spec], ['strategies' => [], 'entries' => [], 'history' => []]);
check($ws['strategies'][0]['version'] === 1, 'New draft version');
$ws = workspace_custom($ws['strategies'], $ws);
check($ws['strategies'][0]['version'] === 1, 'Unchanged save must not create revision');
$entry = ['id' => 'my_check-H1', 'key' => 'my_check', 'tf' => 'H1', 'version' => 1, 'stats' => ['verdict' => 'weak']];
$ws = workspace_results(['my_check-H1' => $entry], $ws);
$changed = $ws['strategies']; $changed[0]['stop']['mult'] = 2;
$ws = workspace_custom($changed, $ws);
check($ws['strategies'][0]['version'] === 2 && !$ws['entries'], 'Changed rules invalidate draft results');
check(count($ws['history'][0]['entries']) === 1, 'Old result is archived with old specification');
rejects(fn() => workspace_results(['my_check-H1' => $entry], $ws), InvalidArgumentException::class);
$mixed = $spec; $mixed['tfs'] = ['H1', 'H4'];
rejects(fn() => workspace_custom([$mixed], $ws), InvalidArgumentException::class);
$tiny = $spec; $tiny['tfs'] = ['M1'];
rejects(fn() => workspace_custom([$tiny], $ws), InvalidArgumentException::class);

$event = ['id' => 'calendar-event', 'title' => 'BOC Monetary Policy Report', 'time' => $now + 3600, 'currency' => 'CAD', 'impact' => 'high', 'forecast' => '', 'previous' => '', 'actual' => 'not published'];
$signal = ai_signal(['pair' => 'USDCAD', 'tf' => 'H1', 'dir' => -1, 'status' => 'pending', 'entry' => 1.4, 'stop' => 1.41, 'balance' => 9999, 'password' => 'not-to-be-sent']);
check(!isset($signal['balance'], $signal['password']) && $signal['style'] === 'day', 'Strip private and unrelated fields');
$context = ai_context($event, $signal, [], [], $now);
check($context['event']['actual'] === null && !$context['quote_fresh'], 'Future result must not be treated as published');
$config = ['gemini_model' => 'gemini-2.5-flash', 'ai_requests_per_hour' => 1];
$calls = 0;
$transport = function (array $request) use (&$calls): array {
    $calls++;
    check($request['generationConfig']['responseMimeType'] === 'application/json', 'Structured response requested');
    check(strpos(json_encode($request), 'not-to-be-sent') === false, 'No private credentials in provider payload');
    return ['candidates' => [['content' => ['parts' => [['text' => json_encode(['summary' => 'Примерно обяснение', 'relevance' => 'Условни сценарии за CAD.', 'status' => 'normal', 'scenarios' => ['При промяна на очакванията реакцията може да е различна.'], 'considerations' => ['Провери часа на събитието.'], 'limitations' => ['Примерен отговор за тест.']])]]]]]];
};
$path = tempnam(sys_get_temp_dir(), 'tp24-ai-');
try {
    $first = ai_cached($context, $config, $path, $transport);
    check($first['analysis']['status'] === 'insufficient_data', 'Stale prices override unjustified normal rating');
    $second = ai_cached($context, $config, $path, $transport);
    check($second['cached'] && $calls === 1, 'Identical request reuses cached response');
    $context['event']['forecast'] = 'changed';
    rejects(fn() => ai_cached($context, $config, $path, $transport), RateLimited::class);
} finally { @unlink($path); @unlink($path . '.lock'); }
$event['time'] = $now - 60; $event['actual'] = '0';
$zero = ai_context($event, null, [], [], $now);
check(gemini_generate($zero, $config, $transport)['status'] === 'caution', 'Zero is a reported result, not missing data');
rejects(fn() => ai_signal(['pair' => 'EURUSD', 'tf' => 'M5', 'dir' => 1, 'status' => 'open']), InvalidArgumentException::class);
$trades = array_fill(0, 10, ['pair' => 'EURUSD', 'style' => 'day', 'tag' => 'plan', 'risk_pct' => 0.5, 'r' => -1, 'date' => $now - 100, 'balance' => 9999, 'note' => 'private note']);
$review = risk_context($trades, $now);
check($review['statistics']['average_r'] === -1.0 && !isset($review['trades'][0]['balance'], $review['trades'][0]['note']), 'Review uses normalized journal data');
check(gemini_generate($review, $config, $transport)['status'] === 'insufficient_data', 'Small review sample stays provisional');
rejects(fn() => risk_context(array_slice($trades, 0, 9), $now), InvalidArgumentException::class);
echo "OK: draft versions, stale-result rejection, privacy, provider payload, future/missing data, caching, limits and journal review\n";
