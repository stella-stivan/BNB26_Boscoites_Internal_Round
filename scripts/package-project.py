from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[2]
archive = root / "Fair-Drop-project.zip"
excluded_dirs = {"node_modules", ".next", ".data", ".git", "output", "__pycache__"}
excluded_files = {".env", ".env.local", archive.name}

with ZipFile(archive, "w", compression=ZIP_DEFLATED, compresslevel=6) as bundle:
    for path in root.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        relative = path.relative_to(root)
        if any(part in excluded_dirs for part in relative.parts):
            continue
        if path.name in excluded_files or path.suffix == ".log":
            continue
        bundle.write(path, Path("Fair-Drop") / relative)

print(f"{archive} ({archive.stat().st_size:,} bytes)")
