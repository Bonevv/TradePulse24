<?php
declare(strict_types=1);
require __DIR__ . '/../api/lib.php';
function ensure(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }

$path = tempnam(sys_get_temp_dir(), 'tp24-login-');
try {
    $config = ['admin_password' => 'correct-horse-battery'];
    $now = 1800000000;
    ensure(admin_login(['admin_password' => DEFAULT_ADMIN_PASSWORD], 'smeni-me', 'a', $now, $path)['status'] === 403, 'The default password never opens the Lab');
    ensure(admin_login($config, '', 'a', $now, $path)['status'] === 403, 'An empty password is rejected');
    ensure(admin_login($config, ['array'], 'a', $now, $path)['status'] === 403, 'A non-text password is rejected');
    ensure(admin_login($config, 'correct-horse-battery', 'a', $now, $path) === null, 'The correct password opens the Lab');

    for ($i = 0; $i < LOGIN_CLIENT_LIMIT; $i++) ensure(admin_login($config, 'guess-' . $i, 'a', $now + $i, $path)['status'] === 403, 'Wrong password');
    $blocked = admin_login($config, 'correct-horse-battery', 'a', $now + 10, $path);
    ensure($blocked['status'] === 429 && $blocked['retry'] >= 60, 'Too many wrong guesses block the address, even with the right password');
    ensure(admin_login($config, 'correct-horse-battery', 'b', $now + 10, $path) === null, 'Another address can still log in');
    ensure(admin_login($config, 'correct-horse-battery', 'a', $now + LOGIN_WINDOW + 10, $path) === null, 'The block ends after the window');

    $site = $now + 7200;
    for ($i = 0; $i < LOGIN_SITE_LIMIT; $i++) admin_login($config, 'guess', 'client-' . $i, $site + $i, $path);
    ensure(admin_login($config, 'correct-horse-battery', 'fresh', $site + 40, $path)['status'] === 429, 'Many wrong guesses from many addresses slow the whole site');
    ensure(admin_login($config, 'correct-horse-battery', 'fresh', $site + 3700, $path) === null, 'The site limit ends after an hour');
    ensure(strpos((string) file_get_contents($path), 'guess') === false && strpos((string) file_get_contents($path), 'client-') === false, 'Neither guesses nor raw addresses are stored');
    echo "OK: login limit per address and for the site, no stored guesses\n";
} finally {
    @unlink($path);
    @unlink($path . '.lock');
}
