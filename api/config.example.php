<?php
// Копирай като api/config.php. Локалните настройки не се качват в Git.
// Ключовете и паролите се задават в средата на PHP или в api/config.local.php.
return [
    // По желание: публичният HTTPS адрес на общия Cloudflare Worker. PHP не тегли цени от доставчици при зададен адрес.
    'cloudflare_feed_url' => getenv('CLOUDFLARE_FEED_URL') ?: '',
    // Цени: Tiingo е основният източник (безплатен ключ от tiingo.com), Twelve Data — резервен. Стига и един от двата.
    'tiingo_key' => getenv('TIINGO_API_KEY') ?: '',
    'twelvedata_key' => getenv('TWELVEDATA_API_KEY') ?: '',
    'admin_password' => getenv('TP24_ADMIN_PASSWORD') ?: 'smeni-me',
    'cron_token' => getenv('TP24_CRON_TOKEN') ?: 'smeni-me-sashto',
    // По желание. Всеки собственик използва свой GroqCloud акаунт и ключ.
    'groq_key' => getenv('GROQ_API_KEY') ?: '',
    'groq_model' => getenv('GROQ_MODEL') ?: '', // Празно: автоматичен избор от наличните модели.
    'puls_requests_per_hour' => 20,
    'puls_requests_per_day' => 60,
    // График за цените: делнично 07–22 ч. (софийско време) на refresh_minutes, нощем на night_refresh_minutes, през уикенда не.
    // Cron в хостинга може да е на 5–15 минути: когато още не е време, cron.php не тегли цени.
    'refresh_minutes' => 15,
    'night_refresh_minutes' => 180,
];
