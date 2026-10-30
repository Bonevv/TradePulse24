# Общият фийд на TradePulse24

Worker с Tiingo, Twelve Data като резерв, Cron Trigger, един SQLite Durable Object и KV архиви. PHP сайтът чете запазените данни.

[Настройване стъпка по стъпка](../docs/cloudflare.md) · [Проверки при разработка](../docs/development.md)

```sh
npm ci
npm test
npm run check
```

`check` прави локален пробен build, без публикуване. За реално публикуване задай `FEED_KV_ID` и използвай `npm run deploy`. API ключовете се добавят като Cloudflare Secrets. Не ги записвай във файловете на проекта.
