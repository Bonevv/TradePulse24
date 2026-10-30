# TradePulse24 5.3 — обновяване

[Изтегли пакета за съществуващ сайт](https://github.com/Bonevv/TradePulse24/raw/refs/heads/downloads-v5.3/TradePulse24-5.3-update.zip).

Версията добавя общи данни през Cloudflare, с Tiingo като основен източник и Twelve Data като резервен. Настройването в собствения Cloudflare профил е отделна стъпка. На PHP хостинга не е нужен Node.js.

Преди качването изтегли резервно копие и запази локалните журнали. Разархивирай пакета и качи съдържанието със замяна на едноименните кодови файлове. Не изтривай съществуващия сайт. Ключовете, историята, черновите и собствените резултати остават на място. След качването презареди с Ctrl+F5 и провери файловете в Лабораторията.

[Настройване на Cloudflare](https://github.com/Bonevv/TradePulse24/blob/0f7a8c8dc2175efa5b1b58c130db3ccfb446bcee/docs/cloudflare.md) · [Обновяване на сайта](https://github.com/Bonevv/TradePulse24/blob/0f7a8c8dc2175efa5b1b58c130db3ccfb446bcee/docs/updating.md) · [Код](https://github.com/Bonevv/TradePulse24/tree/0f7a8c8dc2175efa5b1b58c130db3ccfb446bcee)

Worker кодът е в папката cloudflare в основното хранилище. Той не се качва на PHP хостинга и не е включен в този ZIP. Досегашният PHP режим работи до попълване на cloudflare_feed_url.

Контролната сума е във файла .sha256. Този клон съдържа само пакета за изтегляне.
