<?php
// Копирай като api/config.php. Локалните настройки не се качват в Git.
// Ключовете и паролите се задават в средата на PHP или в api/config.local.php.
return [
    'twelvedata_key' => getenv('TWELVEDATA_API_KEY') ?: '',
    'admin_password' => getenv('TP24_ADMIN_PASSWORD') ?: 'smeni-me',
    'cron_token' => getenv('TP24_CRON_TOKEN') ?: 'smeni-me-sashto',
    'refresh_minutes' => 20,
];
