<?php
declare(strict_types=1);

$folder = sys_get_temp_dir() . '/tp24-maintenance-' . bin2hex(random_bytes(6));
mkdir($folder . '/api', 0700, true);
mkdir($folder . '/data/private', 0700, true);
foreach (['lib.php', 'maintenance.php', 'workspace.php'] as $name) copy(__DIR__ . '/../api/' . $name, $folder . '/api/' . $name);
require $folder . '/api/lib.php';
require $folder . '/api/workspace.php';
function verify(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
function rejected(callable $fn): void {
    try { $fn(); } catch (InvalidArgumentException $error) { return; }
    throw new RuntimeException('Expected validation rejection');
}
try {
    file_put_contents($folder . '/api/config.php', '<?php return ["key" => "private-key-not-for-backup"];');
    write_json(DATA_DIR . '/results.json', ['entries' => [], 'published' => []]);
    write_json(DATA_DIR . '/custom.json', ['strategies' => []]);
    $original = maintenance_snapshot();
    verify(strpos(json_encode($original), 'private-key-not-for-backup') === false, 'Secrets must never enter a backup');
    verify(!isset($original['files']['private/workspace.json']), 'Absent drafts remain absent');
    $costs = validate_costs(['pairs' => ['EURUSD' => ['spread' => 1.2, 'swap_long' => -2]]]);
    verify($costs['pairs']['EURUSD']['swap_long'] === -2.0, 'Swap credits are allowed');
    rejected(fn() => validate_costs(['pairs' => 'invalid']));
    rejected(fn() => validate_costs(['pairs' => ['EURUSD' => ['commission' => -1]]]));
    rejected(fn() => validate_costs(['pairs' => ['UNKNOWN' => ['spread' => 1]]]));
    $bad = $original; $bad['files']['../api/config.php'] = '{}';
    rejected(fn() => maintenance_restore($bad));
    verify(!is_dir(DATA_DIR . '/private/backups'), 'Invalid restore must not write anything');
    write_json(DATA_DIR . '/costs.json', $costs);
    verify(!costs_match_current([]), 'Legacy costs cannot be published under a changed profile');
    verify(costs_match_current(['cost_profile' => $costs]), 'The tested profile matches current costs');
    write_json(DATA_DIR . '/private/workspace.json', ['strategies' => [], 'entries' => [], 'history' => []]);
    maintenance_restore($original);
    verify(!is_file(DATA_DIR . '/costs.json') && !is_file(DATA_DIR . '/private/workspace.json'), 'Restoring an older copy clears later optional files');
    for ($i = 0; $i < 7; $i++) maintenance_backup('test');
    verify(count(glob(DATA_DIR . '/private/backups/*.json')) === 5, 'Keep the last five server copies');
    file_put_contents($folder . '/index.html', 'version-a');
    write_json($folder . '/release.json', ['version' => '4.5', 'files' => ['index.html' => hash('sha256', 'version-a')]]);
    verify(maintenance_installation()['ok'], 'Matching installation');
    file_put_contents($folder . '/index.html', 'version-b');
    verify(!maintenance_installation()['ok'], 'Detect mixed versions');
    write_json($folder . '/release.json', ['version' => '4.5', 'files' => ['docs/.htaccess' => hash('sha256', 'deny')]]);
    $check = maintenance_installation();
    verify(count($check['files']) === 1 && $check['files'][0]['state'] === 'missing' && !$check['ok'], 'Check access rules in documentation and test folders');
    echo "OK: isolated backup/restore, no secrets, cost validation, retained copies and release check\n";
} finally {
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($folder, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($iterator as $item) $item->isDir() ? rmdir($item->getPathname()) : unlink($item->getPathname());
    rmdir($folder);
}
