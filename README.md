# TradePulse24 5.4.1 — поправка след обновяване

[Малка поправка за вече качена 5.4](https://raw.githubusercontent.com/Bonevv/TradePulse24/downloads-v5.4.1/TradePulse24-5.4.1-repair.zip) · [Пълен пакет за обновяване](https://raw.githubusercontent.com/Bonevv/TradePulse24/downloads-v5.4.1/TradePulse24-5.4.1-update.zip)

Поправката позволява config.local.php без основен config.php, нормализира адреса на Worker и различава проблем с конфигурация от проблем със запазените разходи. При отказ на настройките интерфейсът спира новите сигнали и показва правилната причина.

Разархивирай избрания пакет и качи съдържанието в папката на съществуващия PHP сайт със замяна на кодовите файлове. Не изтривай сайта. Пакетите не съдържат лични конфигурации, ключове, работни резултати или ценова история. След качването презареди с Ctrl+F5. Не зареждай отначало историята в Cloudflare.

[Указания](https://github.com/Bonevv/TradePulse24/blob/4dbff654c243345fe5031d6952094d05877670d5/docs/updating.md) · [Код](https://github.com/Bonevv/TradePulse24/tree/4dbff654c243345fe5031d6952094d05877670d5)

При продължаващ проблем api/state.php връща безопасен код: configuration_invalid, feed_url_invalid или costs_invalid. Собствените данни не се заменят автоматично.
