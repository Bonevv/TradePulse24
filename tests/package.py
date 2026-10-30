"""Пакет за обновяване на хостинга. Работните данни и личните настройки не влизат в него."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
manifest = json.loads((ROOT / "release.json").read_text())
files = set(manifest["files"]) | {"release.json", "README.md", "CHANGELOG.md", "AGENTS.md"}
files |= {str(p.relative_to(ROOT)) for p in (ROOT / "docs").glob("*.md")}
for name in files:
    if name.startswith("data/") and name not in {"data/catalog.json", "data/.htaccess", "data/private/.htaccess"}:
        raise SystemExit("Работен файл не може да влиза в пакета: " + name)
    if name in {"api/config.php", "api/config.local.php"} or ".." in Path(name).parts:
        raise SystemExit("Локална настройка не може да влиза в пакета: " + name)
for name, expected in manifest["files"].items():
    if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != expected:
        raise SystemExit("Първо обнови release.json: " + name)
args.output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(args.output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name in sorted(files):
        archive.write(ROOT / name, name)
    archive.writestr("UPGRADE.bg.md", f"""# Обновяване до {manifest['version']}

1. Направи сървърно копие от Лабораторията и копия на локалните журнали.
2. Разархивирай този пакет и качи съдържанието му в папката на съществуващия сайт, със замяна на едноименните кодови файлове.
3. Запази папките и файловете, които вече имаш на хостинга. Не изтривай сайта преди качването.
4. Презареди с Ctrl+F5 и провери файловете от Лабораторията.

Пакетът обновява кода и data/catalog.json. Не съдържа api/config.php, api/config.local.php, data/prices/, data/results.json, data/custom.json, data/costs.json, data/meta.json, data/recent.json, data/news.json или лични чернови и резервни копия.

Подредбата на панелите се пази само в браузъра. „Върни подредбата“ не изтрива дневници или настройки на сметката.
Подробните указания са в docs/updating.md. Общото обновяване през Cloudflare се настройва отделно по docs/cloudflare.md; Worker кодът е в GitHub, а не в този PHP пакет.
""")
digest = hashlib.sha256(args.output.read_bytes()).hexdigest()
args.output.with_suffix(".sha256").write_text(digest + "  " + args.output.name + "\n")
print(f"OK: {args.output.name}; {len(files) + 1} файла, {args.output.stat().st_size:,} bytes; без работни данни")
