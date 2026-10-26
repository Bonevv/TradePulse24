<?php
declare(strict_types=1);
require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/news-ai-lib.php';

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') respond_json(['ok' => false, 'error' => 'Само POST.'], 405);
if (isset($_SERVER['HTTP_ORIGIN']) && parse_url($_SERVER['HTTP_ORIGIN'], PHP_URL_HOST) !== parse_url('http://' . ($_SERVER['HTTP_HOST'] ?? ''), PHP_URL_HOST)) respond_json(['ok' => false, 'error' => 'Заявката трябва да е от този сайт.'], 403);
if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) respond_json(['ok' => false, 'error' => 'Изпрати JSON заявка.'], 415);
$raw = file_get_contents('php://input', false, null, 0, 24577);
if ($raw === false || strlen($raw) > 24576) respond_json(['ok' => false, 'error' => 'Заявката е твърде голяма.'], 413);
$in = json_decode($raw, true);
if (!is_array($in) || !is_string($in['event_id'] ?? null)) respond_json(['ok' => false, 'error' => 'Избери новина.'], 400);
$config = cfg();
if (empty($config['gemini_key'])) respond_json(['ok' => false, 'error' => 'Gemini още не е настроен за този сайт. Основните обяснения на новините са достъпни без ключ.', 'code' => 'not_configured'], 503);
$events = read_json(DATA_DIR . '/news.json', ['events' => []])['events'];
$event = null;
foreach ($events as $candidate) if (($candidate['id'] ?? '') === $in['event_id']) { $event = $candidate; break; }
if (!$event) respond_json(['ok' => false, 'error' => 'Новината вече не е в календара. Обнови страницата.'], 404);
try {
    $signal = ai_signal($in['signal'] ?? null);
    $context = ai_context($event, $signal, read_json(DATA_DIR . '/meta.json', []), read_json(DATA_DIR . '/results.json', []), time());
    $result = ai_cached($context, $config, private_dir() . '/ai-cache.json');
    respond_json(array_merge(['ok' => true], $result));
} catch (InvalidArgumentException $e) { respond_json(['ok' => false, 'error' => $e->getMessage()], 400);
} catch (RateLimited $e) { respond_json(['ok' => false, 'error' => $e->getMessage()], 429);
} catch (Throwable $e) { respond_json(['ok' => false, 'error' => 'Анализът не завърши. Провери настройките на Gemini или опитай по-късно.'], 502); }
