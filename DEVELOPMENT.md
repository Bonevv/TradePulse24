# Разработка

Сайтът използва Apache 2.4 и PHP 7.4+ с cURL; препоръчва се PHP 8.x.
Няма Composer/npm зависимости и не е нужна база данни.

След клониране създай локалната конфигурация, преди да стартираш Apache:

```sh
cp api/config.example.php api/config.php
```

Примерният файл чете `TWELVEDATA_API_KEY`, `TP24_ADMIN_PASSWORD` и
`TP24_CRON_TOKEN` от средата на PHP. Можеш да зададеш настройките и чрез
PHP масив в `api/config.local.php`. Двата локални файла са изключени от Git.
Не публикувай истински ключове или пароли.

Настрой Apache с `AllowOverride All`, за да се прилагат включените `.htaccess`
защити. Папката `data/` трябва да е достъпна за запис от PHP.
За хостинг и обновяване на данните следвай `README.md`.

Без ключ за Twelve Data каталогът и историческите тестове работят офлайн.
Архивът не включва текущи `meta.json`, `recent.json` и `news.json`.
Не приемай историческите данни за текущи котировки.

Проверки при разработка (нужен е Node.js):

```sh
node tests/smoke.js
node tests/engine-smoke.js
node tests/risk-guidance.js
```

GitHub съхранява кода. За работещ публичен сайт е нужен PHP хостинг;
GitHub Pages не изпълнява PHP.
