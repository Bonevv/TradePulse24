"""Създава или проверява списъка с файловете на версията; не включва работни данни."""
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
VERSION = re.search(r'FX\.RELEASE = "([^"]+)"', (ROOT / "assets/js/fx-catalog.js").read_text()).group(1)
files = [ROOT / "index.html", ROOT / ".htaccess", ROOT / "data/catalog.json"]
files += [path for path in (ROOT / "assets").rglob("*") if path.is_file()]
files += [path for path in (ROOT / "api").glob("*.php") if path.name not in {"config.php", "config.local.php"}]
files += [ROOT / name for name in ["api/.htaccess", "data/.htaccess", "data/private/.htaccess", "docs/.htaccess", "tests/.htaccess"] if (ROOT / name).is_file()]
manifest = {"version": VERSION, "files": {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(set(files))}}
target = ROOT / "release.json"
if "--write" in sys.argv:
    target.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
else:
    if not target.is_file() or json.loads(target.read_text()) != manifest:
        raise SystemExit("Списъкът на версията е остарял. Пусни python tests/release.py --write след проверките на кода.")
print(f"OK: версия {VERSION}, {len(manifest['files'])} файла; ключовете, работните JSON и цените са изключени")
