"""Проверява, че upgrade ZIP запазва съществуващите ключове, история и работни данни."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import sys
import tempfile
import zipfile

archive = Path(sys.argv[1])
protected = ["api/config.php", "api/config.local.php", ".env", "data/results.json", "data/custom.json", "data/costs.json", "data/meta.json", "data/recent.json", "data/news.json", "data/private/workspace.json", "data/private/backups/owner-backup.json"]
protected += [f"data/prices/{pair}_{tf}.json" for pair in ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCHF", "USDCAD", "NZDUSD", "XAUUSD"] for tf in ["M15", "H1", "D1"]]
with tempfile.TemporaryDirectory(prefix="tp24-upgrade-") as folder, zipfile.ZipFile(archive) as bundle:
    root = Path(folder)
    originals = {}
    for name in protected:
        file = root / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text("existing-owner-data:" + name)
        originals[name] = hashlib.sha256(file.read_bytes()).hexdigest()
    for name in bundle.namelist():
        path = PurePosixPath(name)
        assert not path.is_absolute() and ".." not in path.parts and "\\" not in name, name
        assert name not in protected, name
        if name.startswith("data/"):
            assert name in {"data/catalog.json", "data/.htaccess", "data/private/.htaccess"}, name
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(bundle.read(name))
    for name, digest in originals.items():
        assert hashlib.sha256((root / name).read_bytes()).hexdigest() == digest, name
    manifest = json.loads((root / "release.json").read_text())
    for name, digest in manifest["files"].items():
        assert hashlib.sha256((root / name).read_bytes()).hexdigest() == digest, name
    assert (root / "assets/js/panel-layout.js").is_file()
    assert (root / "assets/vendor/lightweight-charts/lightweight-charts.standalone.production.js").is_file()
print("OK: upgrade preserves all 35 owner files and installs a complete, matching release")
