"""Създава пакет само с код; локалните ключове и данни остават извън него."""
from pathlib import Path
import shutil
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0")
selected = []
for name in tracked:
    if not name:
        continue
    path = Path(name)
    if name in {"api/config.php", "api/config.local.php"}:
        continue
    if (name == "index.html" or name.startswith("assets/") and path.suffix in {".js", ".css"}
        or name.startswith("api/") and (path.suffix == ".php" or path.name == ".htaccess")
        or name in {"tools/check-gemini.php", "tools/.htaccess", "data/private/.htaccess", "docs/gemini-troubleshooting.md"}):
        selected.append(name)

assert "assets/js/boot.js" in selected and "assets/js/app.js" in selected
output = root / "downloads/TradePulse24-code-update.zip"
output.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
    for name in sorted(selected):
        info = zipfile.ZipInfo.from_file(root / name, name)
        info.external_attr = 0o100644 << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, (root / name).read_bytes())
    instructions = zipfile.ZipInfo("INSTALL-CODE-UPDATE.txt")
    instructions.external_attr = 0o100644 << 16
    instructions.compress_type = zipfile.ZIP_DEFLATED
    archive.writestr(instructions, """TradePulse24 — обновяване на кода

Направи резервно копие на стария код. Разархивирай съдържанието в папката, където е index.html, и замени съответните кодови файлове.

Архивът НЕ съдържа api/config.php, api/config.local.php, ценови JSON файлове, чернови или търговски дневник. Единственият файл под data/ е защитата data/private/.htaccess. Пази локалните си ключове и данни.

Презареди браузъра с Ctrl+F5. Ако PHP изпълнява стар код от OPcache, рестартирай локалния Apache/PHP процес.

За Gemini: Лаборатория → Пулс · проверка на Gemini → Провери Gemini. Ключът не се показва. Използвай текстов модел от достъпния списък; не избирай image/tts модел за тези обяснения.
""")
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    assert all((info.external_attr >> 16) & 0o777 == 0o644 for info in archive.infolist())
    assert not any(name.startswith("data/") and name != "data/private/.htaccess" for name in archive.namelist())
    assert "api/config.php" not in archive.namelist() and "api/config.local.php" not in archive.namelist()
shutil.copyfile(output, root / "downloads/TradePulse24-gemini-fix.zip")
print(f"Verified {len(selected)} code files, {output.stat().st_size} bytes: {output.name}")
