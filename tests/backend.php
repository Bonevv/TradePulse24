<?php
declare(strict_types=1);
require_once __DIR__ . '/../api/lib.php';
require_once __DIR__ . '/../api/workspace.php';
function check(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
function rejects(callable $fn, string $class): void {
    try { $fn(); } catch (Throwable $error) { check($error instanceof $class, 'Unexpected error type'); return; }
    throw new RuntimeException('Expected rejection');
}

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

echo "OK: private drafts, version history, stale-result rejection and day/swing validation\n";
