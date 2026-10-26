<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
require_once __DIR__ . '/../api/lib.php';
require_once __DIR__ . '/../api/news-ai-lib.php';

try {
    $config = cfg();
    echo 'PHP: ', PHP_VERSION, PHP_EOL;
    echo 'cURL: ', extension_loaded('curl') ? 'включено' : 'липсва', PHP_EOL;
    echo 'Gemini ключ: ', !empty($config['gemini_key']) ? 'зададен (стойността е скрита)' : 'липсва', PHP_EOL;
    $catalog = gemini_model_catalog($config);
    echo 'Избран модел: ', $catalog['configured_model'], PHP_EOL;
    echo 'Достъпен за този ключ: ', $catalog['model_available'] ? 'да' : 'не', PHP_EOL;
    echo 'Налични модели за generateContent:', PHP_EOL;
    foreach ($catalog['models'] as $model) echo '  ', $model, PHP_EOL;
    echo 'Това проверява достъпа до списъка, без заявка за генериране на анализ.', PHP_EOL;
} catch (GeminiFailure $error) {
    fwrite(STDERR, $error->reason . ': ' . $error->getMessage() . PHP_EOL);
    exit(1);
} catch (Throwable $error) {
    fwrite(STDERR, 'Проверката не завърши. Провери локалната конфигурация на PHP.' . PHP_EOL);
    exit(1);
}
