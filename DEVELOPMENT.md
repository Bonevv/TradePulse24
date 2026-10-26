# Работа по TradePulse24

PHP 7.4+ с cURL и Apache 2.4 са достатъчни за сайта. Препоръчва се PHP 8.x. Няма Composer или npm пакети. Node.js е нужен за автоматичните проверки на JavaScript.

## Настройки

Копирай `api/config.example.php` като `api/config.php`. Личните ключове и пароли могат да се подадат от средата на PHP или чрез `api/config.local.php`. Двата локални файла са изключени от Git. Не ги добавяй принудително с `git add -f`.

За облачната среда PHP и Apache са в `/workspace/.tradepulse24-env/bin`. Стартирането е:

```sh
bash /workspace/.tradepulse24-env/start.sh
```

Подготвената среда е изолирана. Работи в съществуващото копие на проекта; нов worktree не е нужен.

## Проверки

```sh
node tests/smoke.js
node tests/engine-smoke.js
node tests/risk-guidance.js
node tests/workflow.js
node tests/candidates.js
php tests/backend.php
```

Първите три проверки пазят поведението на наличните стратегии, следенето и ориентирите 1R/2R. `workflow.js` проверява двата стила, личните чернови, публикуването и дневника. `candidates.js` пуска седемте нови варианта върху цялата включена история и проверява, че новите индикатори не използват бъдещи свещи. `backend.php` използва примерни отговори от доставчика и проверява версиите, липсващите данни, кеша, лимитите и набора от данни за Пулс.

При налични Python Playwright, Chromium и подготвения Apache runtime:

```sh
python tests/browser.py
```

Тестът създава временно копие на сайта и отделен Apache на порт 8081. Не копира локалните ключове и конфигурация. Проверява входа в Лабораторията, създаване и тестване на чернова с истински Web Worker, версии, публикуване, дневника, работа без Gemini ключ и показване на примерен отговор. Временните файлове и процесът се почистват при приключване.

Истинско извикване към Gemini се проверява отделно с ключ и модел, достъпни за съответния акаунт. Примерните отговори в тестовете не доказват достъп до външната услуга.

## Къде е логиката

- `fx-core.js`, `fx-series.js`, `fx-indicators.js` — свещи, време и индикатори.
- `fx-backtest.js`, `fx-engine.js` — изпълнение, статистика и ценови сигнали.
- `fx-strategies.js`, `fx-library.js`, `fx-candidates.js` — правилата на стратегиите.
- `fx-builder.js`, `lab.js`, `fx-worker.js` — конструктор и тестове.
- `api/workspace.php`, `api/save.php` — лични чернови, версии и изрично публикуване.
- `fx-news.js`, `news-analysis.js`, `api/news-ai*.php` — обяснения и Пулс за новините.
- `risk.js`, `api/risk-ai.php` — личен дневник, риск и преглед на историята.

`data/private/` съдържа личните чернови и сървърния кеш. Достъпът през HTTP трябва да е забранен. Дневникът на посетителя е в неговия браузър.

## Ако използваш nginx

`.htaccess` не се изпълнява от nginx. Осигури еквивалентните ограничения в конфигурацията на сайта:

```nginx
location ^~ /data/private/ { deny all; }
location ^~ /tests/ { deny all; }
location ~ (^|/)\. { deny all; }
location ~ ^/api/(config(?:\.local|\.example)?|lib|workspace|news-ai-lib)\.php$ { deny all; }
location ~ ^/(README|AGENTS|DEVELOPMENT|CHANGELOG)\.md$ { deny all; }
location ~ ^/data/.*\.(php|phtml|phar|lock|tmp[0-9]*)$ { deny all; }
```

Провери реда на тези правила спрямо общия PHP location. Папката `data/` трябва да е достъпна за запис от PHP, но не и за изпълнение на качени скриптове.
