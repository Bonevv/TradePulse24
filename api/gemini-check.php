<?php
declare(strict_types=1);
require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/news-ai-lib.php';

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') respond_json(['ok' => false, 'error' => 'Само POST.'], 405);
$raw = file_get_contents('php://input', false, null, 0, 8193);
if ($raw === false || strlen($raw) > 8192) respond_json(['ok' => false, 'error' => 'Заявката е твърде голяма.'], 413);
$in = json_decode($raw, true);
$config = cfg();
$password = (string) ($config['admin_password'] ?? '');
if ($password === '' || $password === DEFAULT_ADMIN_PASSWORD || !is_array($in) || !is_string($in['password'] ?? null) || !hash_equals($password, $in['password'])) respond_json(['ok' => false, 'error' => 'Влез в Лабораторията, за да провериш настройките.'], 403);
try {
    $catalog = gemini_model_catalog($config);
    respond_json(array_merge(['ok' => true, 'message' => $catalog['model_available'] ? 'Ключът има достъп до списъка и избраният модел е наличен. Тази проверка не изпълнява анализ и не потвърждава свободна квота за генериране.' : 'Списъкът е достъпен, но избраният модел липсва. Задай наличен модел в GEMINI_MODEL или gemini_model.'], $catalog));
} catch (GeminiFailure $error) { ai_failure($error);
} catch (Throwable $error) { respond_json(['ok' => false, 'error' => 'Проверката на Gemini не завърши.', 'code' => 'check_failed'], 502); }
