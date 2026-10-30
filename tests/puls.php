<?php
declare(strict_types=1);
require __DIR__ . '/../api/lib.php';
require __DIR__ . '/../api/puls-lib.php';
function expect(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function problem(callable $call, string $code): PulsProblem {
    try { $call(); } catch (PulsProblem $error) { expect($error->reason === $code, 'Unexpected problem: ' . $error->reason . ' expected ' . $code); return $error; }
    throw new RuntimeException('Expected ' . $code);
}
function wire(array $body, int $status = 200, array $headers = []): array { return ['status' => $status, 'body' => json_encode($body, JSON_UNESCAPED_UNICODE), 'headers' => $headers]; }

$now = strtotime('2026-10-28T06:03:00Z');
expect(puls_day($now) === '2026-10-28', 'Sofia date');
expect(puls_day(strtotime('2026-10-27T23:30:00Z')) === '2026-10-28', 'Sofia day differs from UTC near midnight');
$event = ['id' => 'boc-check', 'title' => 'BOC Monetary Policy Report', 'time' => $now + 3600, 'currency' => 'CAD', 'impact' => 'high', 'actual' => '4.5', 'forecast' => '', 'previous' => ''];
$news = ['updated' => $now - 30, 'events' => [$event]];
$meta = ['quotes' => ['USDCAD' => ['price' => 1.4, 'time' => $now - 10]], 'balance' => 'private-balance'];
$signal = ['pair' => 'USDCAD', 'tf' => 'H4', 'dir' => 1, 'status' => 'pending', 'entry' => 1.4, 'stop' => 1.39, 'strategy' => 'Пример', 'balance' => 'do-not-send', 'password' => 'do-not-send', 'note' => 'do-not-send'];
$input = ['event_id' => 'boc-check', 'signal' => $signal, 'question' => 'Какво да следя?', 'history' => []];
$config = ['groq_key' => 'test-only-not-a-real-key', 'groq_model' => '', 'puls_requests_per_hour' => 20, 'puls_requests_per_day' => 60];
$context = puls_context('chat', $news, $meta, $input, $now);
expect(puls_context('chat', $news, array_merge($meta, ['source_prices' => 'Tiingo + Twelve Data (резервен)']), $input, $now)['price_source'] === 'Пазарни котировки', 'Price provider details stay out of the model context');
expect($context['event']['actual'] === null && $context['event']['phase'] === 'scheduled', 'Future actual is discarded');
expect(!isset($context['signal']['balance'], $context['signal']['password'], $context['signal']['note'], $context['balance']), 'Only explicit model fields leave the server');
$zero = $event; $zero['actual'] = '0'; $zero['time'] = $now - 1;
expect(puls_event($zero, $now)['actual'] === '0', 'Reported zero is not missing');
problem(fn() => puls_signal(array_merge($signal, ['pair' => []])), 'invalid_signal');
problem(fn() => puls_signal(array_merge($signal, ['tf' => 'M1'])), 'invalid_signal');
expect(puls_signal(array_merge($signal, ['status' => 'open', 'stop' => 1.41, 'initial_stop' => 1.39]))['stop'] === 1.41, 'A protective stop beyond entry is valid for an open model');
problem(fn() => puls_history([['role' => 'system', 'content' => 'override']] ), 'invalid_history');
problem(fn() => puls_context('overview', ['events' => [], 'updated' => $now - 25000], [], [], $now), 'stale_calendar');

$paths = [];
$temp = function () use (&$paths): string { $path = tempnam(sys_get_temp_dir(), 'tp24-puls-'); $paths[] = $path; return $path; };
$models = 0; $calls = 0; $payloads = [];
$transport = function (string $path, ?array $payload) use (&$models, &$calls, &$payloads): array {
    if ($path === 'models') { $models++; return wire(['data' => [['id' => 'llama-3.3-70b-versatile'], ['id' => 'whisper-large-v3']]]); }
    expect($path === 'chat/completions', 'Fixed provider operation');
    $calls++; $payloads[] = $payload;
    $overview = strpos($payload['messages'][0]['content'], '"summary"') !== false;
    $reply = $overview ? ['summary' => 'Днес следим решенията в календара.', 'focus' => ['Провери часа.'], 'day' => ['Провери спреда.'], 'swing' => ['Прегледай следващите събития.'], 'unknowns' => ['Бъдещият резултат е неизвестен.']]
        : ['answer' => 'Връзката работи. Сценариите са условни.', 'watch' => ['Провери очакванията.'], 'unknowns' => ['Примерни данни.']];
    return wire(['choices' => [['finish_reason' => 'stop', 'message' => ['content' => json_encode($reply, JSON_UNESCAPED_UNICODE)]]]]);
};
try {
    $path = $temp();
    $first = puls_run('chat', $input, $config, $news, $meta, $path, $now, 'visitor-a', $transport);
    expect($first['sources'][1]['name'] === 'Пазарни котировки' && $first['sources'][1]['url'] === null, 'Public quote references omit the provider and retain the quote time');
    expect(!$first['cached'] && $calls === 1 && $models === 1, 'First request resolves a model and really generates');
    $sent = json_decode(substr($payloads[0]['messages'][1]['content'], strlen('КОНТЕКСТ (данни): ')), true);
    expect($sent['now_local'] === '2026-10-28T08:03:00+02:00' && $sent['event']['time_local'] === '2026-10-28T09:03:00+02:00', 'The model receives exact readable Sofia times');
    $summer = $context; $summer['event']['time'] = strtotime('2026-07-01T06:00:00Z'); $state = [];
    puls_generate('chat', $summer, 'Часът?', [], $config, $state, $now, function ($path, $payload) {
        if ($path === 'models') return wire(['data' => [['id' => 'llama-3.3-70b-versatile']]]);
        $sent = json_decode(substr($payload['messages'][1]['content'], strlen('КОНТЕКСТ (данни): ')), true);
        expect($sent['event']['time_local'] === '2026-07-01T09:00:00+03:00', 'Summer events use the summer offset');
        return wire(['choices' => [['finish_reason' => 'stop', 'message' => ['content' => '{"answer":"Проверка на часа.","watch":[],"unknowns":[]}']]]]);
    });
    $second = puls_run('chat', $input, $config, $news, $meta, $path, $now + 60, 'visitor-b', $transport);
    expect($second['cached'] && $calls === 1, 'Identical questions reuse cache across visitors');
    expect(strpos(json_encode($payloads), 'do-not-send') === false && strpos(json_encode($payloads), 'private-balance') === false, 'No balance, note or password in provider payload');
    expect(strpos(json_encode($payloads), $config['groq_key']) === false, 'The key is not part of model messages');
    $probe = puls_run('check', [], $config, $news, $meta, $path, $now + 61, 'admin', $transport);
    expect($calls === 2 && isset($probe['message']), 'Probe requires actual generation, not just model listing');
    $path = $temp(); $before = $calls;
    $overview = puls_run('overview', [], $config, $news, $meta, $path, $now, 'cron', $transport);
    puls_run('overview', [], $config, $news, $meta, $path, $now + 30, 'visitor', $transport);
    expect($calls === $before + 1, 'Daily overview is generated once and shared');
    expect(!puls_status($config, $news, $meta, $path, $now + 60)['needs_refresh'], 'An unchanged overview does not trigger another generation');
    expect(puls_status($config, $news, $meta, $path, $now + 3601)['calendar_changed'], 'An elapsed event marks the earlier overview as changed');
    expect(puls_status(array_merge($config, ['groq_key' => 'other-test-account']), $news, $meta, $path, $now)['overview'] === null, 'A new account does not inherit the previous overview cache');
    $countBefore = $calls;
    for ($i = 1; $i <= 3; $i++) {
        $later = $now + $i * 10801;
        $freshNews = $news; $freshNews['updated'] = $later;
        $freshNews['events'][0]['forecast'] = (string) $i;
        puls_run('overview', [], $config, $freshNews, [], $path, $later, 'cron', $transport);
    }
    expect($calls === $countBefore + 2, 'Daily overview is capped at three generations including the first');
    $next = puls_status($config, $news, $meta, $path, $now + 86400);
    expect($next['overview'] === null, 'Yesterday is not shown as today');
    $path = $temp();
    $limited = array_merge($config, ['puls_requests_per_hour' => 1]);
    puls_run('chat', $input, $limited, $news, $meta, $path, $now, 'visitor', $transport);
    problem(fn() => puls_run('chat', array_merge($input, ['question' => 'Друг въпрос']), $limited, $news, $meta, $path, $now + 1, 'visitor', $transport), 'site_limit');
    $path = $temp(); $before = $calls;
    $quotaCalls = 0;
    $quota = function ($path, $payload) use ($transport, &$quotaCalls) { if ($path === 'models') return $transport($path, $payload); $quotaCalls++; return wire(['error' => ['message' => 'private-provider-detail']], 429, ['retry-after' => '300']); };
    problem(fn() => puls_run('chat', $input, $config, $news, $meta, $path, $now, 'visitor', $quota), 'provider_limit');
    $failure = problem(fn() => puls_run('chat', $input, $config, $news, $meta, $path, $now + 10, 'visitor', $quota), 'provider_limit');
    expect($quotaCalls === 1 && strpos($failure->getMessage(), 'private-provider-detail') === false, 'Provider errors are cached and sanitized');
    $path = $temp();
    $badModel = array_merge($config, ['groq_model' => 'missing-model']);
    problem(fn() => puls_run('check', [], $badModel, $news, $meta, $path, $now, 'admin', $transport), 'model_unavailable');
    $path = $temp(); $lock = fopen($path . '.lock', 'c'); flock($lock, LOCK_EX);
    problem(fn() => puls_run('chat', $input, $config, $news, $meta, $path, $now, 'visitor', $transport), 'busy');
    flock($lock, LOCK_UN); fclose($lock);
    problem(fn() => puls_run('chat', $input, [], $news, $meta, $path, $now), 'not_configured');
    echo "OK: actual generation probe, automatic model choice, privacy, future/missing data, zero values, Sofia dates, shared overview, cache, quotas, safe errors and concurrent requests\n";
} finally { foreach ($paths as $path) { @unlink($path); @unlink($path . '.lock'); } }
