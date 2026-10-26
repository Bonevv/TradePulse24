<?php
declare(strict_types=1);
require_once __DIR__ . '/../api/lib.php';
require_once __DIR__ . '/../api/news-ai-lib.php';
function expect_gemini(string $reason, callable $action): void {
    try { $action(); } catch (GeminiFailure $error) {
        if ($error->reason !== $reason || strpos($error->getMessage(), 'private-test-value') !== false) throw new RuntimeException('Wrong or unsafe diagnostic');
        return;
    }
    throw new RuntimeException('Expected Gemini failure: ' . $reason);
}
$errorBody = fn($reason) => json_encode(['error' => ['message' => 'private-test-value', 'details' => [['reason' => $reason]]]]);
expect_gemini('invalid_key', fn() => gemini_check_response($errorBody('API_KEY_INVALID'), 400));
expect_gemini('key_restricted', fn() => gemini_check_response($errorBody('API_KEY_HTTP_REFERRER_BLOCKED'), 403));
expect_gemini('access_denied', fn() => gemini_check_response($errorBody('REGION_BLOCKED'), 403));
expect_gemini('model_not_found', fn() => gemini_check_response('{}', 404));
expect_gemini('provider_quota', fn() => gemini_check_response('{}', 429));
expect_gemini('request_rejected', fn() => gemini_check_response('{}', 400));
expect_gemini('provider_unavailable', fn() => gemini_check_response('{}', 503));
expect_gemini('invalid_provider_response', fn() => gemini_check_response('<html>private-test-value</html>', 200));
expect_gemini('timeout', fn() => gemini_check_response(false, 0, 28));
expect_gemini('tls_error', fn() => gemini_check_response(false, 0, 60));
expect_gemini('connection_failed', fn() => gemini_check_response(false, 0, 6));
expect_gemini('invalid_model', fn() => gemini_model_name(['gemini_model' => 'private-test-value']));
$catalog = gemini_model_catalog(['gemini_model' => ' models/gemini-2.5-flash '], fn() => ['models' => [
    ['name' => 'models/gemini-2.5-flash', 'supportedGenerationMethods' => ['generateContent']],
    ['name' => 'models/gemini-embedding-test', 'supportedGenerationMethods' => ['embedContent']],
]]);
if (!$catalog['model_available'] || count($catalog['models']) !== 1) throw new RuntimeException('Model availability check failed');
$now = time();
$context = ai_context(['id' => 'test', 'time' => $now + 3600, 'title' => 'Consumer Confidence', 'currency' => 'USD'], null, [], [], $now);
expect_gemini('response_truncated', fn() => gemini_generate($context, [], fn() => ['candidates' => [['finishReason' => 'MAX_TOKENS']]]));
expect_gemini('response_blocked', fn() => gemini_generate($context, [], fn() => ['promptFeedback' => ['blockReason' => 'SAFETY']]));
$incomplete = ['candidates' => [['content' => ['parts' => [['text' => '{unfinished']]]]]];
expect_gemini('invalid_analysis', fn() => gemini_generate($context, [], fn() => $incomplete));
$analysis = ['summary' => 'Примерен анализ', 'relevance' => 'Обяснение', 'status' => 'caution', 'scenarios' => ['1', '2', '3', '4', '5'], 'considerations' => [], 'limitations' => []];
$response = fn() => ['candidates' => [['content' => ['parts' => [['text' => "```json\n" . json_encode($analysis) . "\n```"]]]]]];
$result = gemini_generate($context, [], $response);
if (count($result['scenarios']) !== 4) throw new RuntimeException('Valid longer response should be normalized');
gemini_generate($context, ['gemini_model' => 'gemini-2.5-pro'], function ($request) use ($response) {
    if (isset($request['generationConfig']['thinkingConfig'])) throw new RuntimeException('Pro must not receive unsupported zero thinking budget');
    return $response();
});
echo "OK: safe diagnostics for keys, access, models, quotas, TLS, timeouts, truncated output, model compatibility and structured responses\n";
