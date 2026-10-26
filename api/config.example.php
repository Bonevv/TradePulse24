<?php
// Копирай като api/config.php. Локалните настройки не се качват в Git.
// Ключовете и паролите се задават в средата на PHP или в api/config.local.php.
return [
    'twelvedata_key' => getenv('TWELVEDATA_API_KEY') ?: '',
    'admin_password' => getenv('TP24_ADMIN_PASSWORD') ?: 'smeni-me',
    'cron_token' => getenv('TP24_CRON_TOKEN') ?: 'smeni-me-sashto',
    // По желание: обяснения на новините при натискане на бутона.
    'gemini_key' => getenv('GEMINI_API_KEY') ?: '',
    'gemini_model' => getenv('GEMINI_MODEL') ?: 'gemini-2.5-flash',
    'ai_requests_per_hour' => 20,
    'ai_requests_per_day' => 100,
    'refresh_minutes' => 20,
];
