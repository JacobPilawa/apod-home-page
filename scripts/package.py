"""Package extension assets and user documentation; excludes development files."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

root = Path(__file__).resolve().parent.parent
extension = root / "extension"
version = json.loads((extension / "manifest.json").read_text())["version"]
output = root / "dist" / f"apod-home-page-{version}.zip"
output.parent.mkdir(exist_ok=True)
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for path in sorted(extension.rglob("*")):
        if path.is_file() and not path.name.startswith("."):
            archive.write(path, path.relative_to(extension))
    for name in ("LICENSE", "PRIVACY.md", "README.md"):
        archive.write(root / name, name)
    screenshot = root / "docs" / "example.png"
    if screenshot.is_file():
        archive.write(screenshot, "docs/example.png")
print(output)
