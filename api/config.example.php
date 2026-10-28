<?php
// Копирай като api/config.php. Локалните настройки не се качват в Git.
// Ключовете и паролите се задават в средата на PHP или в api/config.local.php.
return [
    'twelvedata_key' => getenv('TWELVEDATA_API_KEY') ?: '',
    'admin_password' => getenv('TP24_ADMIN_PASSWORD') ?: 'smeni-me',
    'cron_token' => getenv('TP24_CRON_TOKEN') ?: 'smeni-me-sashto',
    // По желание. Всеки собственик използва свой GroqCloud акаунт и ключ.
    'groq_key' => getenv('GROQ_API_KEY') ?: '',
    'groq_model' => getenv('GROQ_MODEL') ?: '', // Празно: автоматичен избор от наличните модели.
    'puls_requests_per_hour' => 20,
    'puls_requests_per_day' => 60,
    'refresh_minutes' => 20,
];
