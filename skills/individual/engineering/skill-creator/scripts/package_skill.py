#!/usr/bin/env python3
"""
Skill Packager - Creates a distributable .skill file of a skill folder

Usage:
    python scripts/package_skill.py <path/to/skill-folder> [output-directory]

Example:
    python scripts/package_skill.py skills/public/my-skill
    python scripts/package_skill.py skills/public/my-skill ./dist
"""

import fnmatch
import sys
import zipfile
from pathlib import Path
import argparse
import os
import tempfile
import hashlib

# Both `python /path/scripts/package_skill.py` and `python -m scripts.package_skill` work.
if __package__:
    from .quick_validate import validate_skill
else:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from quick_validate import validate_skill

# Patterns to exclude when packaging skills.
EXCLUDE_DIRS = {"__pycache__", "node_modules"}
EXCLUDE_GLOBS = {"*.pyc"}
EXCLUDE_FILES = {".DS_Store"}
# Directories excluded only at the skill root (not when nested deeper).
ROOT_EXCLUDE_DIRS = {"evals"}


def is_link(path: Path) -> bool:
    return path.is_symlink() or getattr(path, 'is_junction', lambda: False)()

def should_exclude(rel_path: Path) -> bool:
    """Check if a path should be excluded from packaging."""
    parts = rel_path.parts
    if any(part in EXCLUDE_DIRS for part in parts):
        return True
    # rel_path is relative to skill_path.parent, so parts[0] is the skill
    # folder name and parts[1] (if present) is the first subdir.
    if len(parts) > 1 and parts[1] in ROOT_EXCLUDE_DIRS:
        return True
    name = rel_path.name
    if name in EXCLUDE_FILES:
        return True
    return any(fnmatch.fnmatch(name, pat) for pat in EXCLUDE_GLOBS)


def package_skill(skill_path, output_dir=None):
    """
    Package a skill folder into a .skill file.

    Args:
        skill_path: Path to the skill folder
        output_dir: Optional output directory for the .skill file (defaults to current directory)

    Returns:
        Path to the created .skill file, or None if error
    """
    original = Path(skill_path).absolute()
    for ancestor in [original, *original.parents]:
        if is_link(ancestor):
            print('Error: linked Skill source path is refused')
            return None
    skill_path = original.resolve()

    # Validate skill folder exists
    if not skill_path.exists():
        print(f"❌ Error: Skill folder not found: {skill_path}")
        return None

    if not skill_path.is_dir():
        print(f"❌ Error: Path is not a directory: {skill_path}")
        return None

    # Validate SKILL.md exists
    skill_md = skill_path / "SKILL.md"
    if not skill_md.exists():
        print(f"❌ Error: SKILL.md not found in {skill_path}")
        return None

    if is_link(skill_md):
        print('Error: linked SKILL.md is refused')
        return None
    validated_frontmatter_hash = hashlib.sha256(skill_md.read_bytes()).hexdigest()
    # Run validation before packaging
    print("🔍 Validating skill...")
    valid, message = validate_skill(skill_path)
    if not valid:
        print(f"❌ Validation failed: {message}")
        print("   Please fix the validation errors before packaging.")
        return None
    print(f"✅ {message}\n")

    # Refuse declared restrictions; retaining source is not redistribution permission.
    license_file = skill_path / 'LICENSE.txt'
    if is_link(license_file):
        print('Error: linked license file is refused')
        return None
    reviewed_license_hash = None
    if license_file.exists():
        reviewed_license_hash = hashlib.sha256(license_file.read_bytes()).hexdigest()
        license_text = license_file.read_text(encoding='utf-8')
        if ('ADDITIONAL RESTRICTIONS' in license_text and 'users may not' in license_text
                and ('Distribute, sublicense, or transfer' in license_text or 'Reproduce or copy these materials' in license_text)):
            print('Error: declared license restrictions prohibit packaging this asset')
            return None

    # Determine output location
    skill_name = skill_path.name
    if output_dir:
        output_path = Path(output_dir).absolute()
        for ancestor in [output_path, *output_path.parents]:
            if is_link(ancestor):
                print('Error: linked output path is refused')
                return None
        output_path = output_path.resolve()
    else:
        output_path = Path.cwd()

    skill_filename = output_path / f"{skill_name}.skill"

    if output_path == skill_path or output_path.is_relative_to(skill_path):
        print('Error: package output must be outside the Skill source')
        return None
    if skill_filename.exists() or skill_filename.is_symlink():
        print('Error: existing package is preserved; select a new output directory')
        return None

    pending = None
    try:
        files = []
        for file_path in sorted(skill_path.rglob('*')):
            arcname = file_path.relative_to(skill_path.parent)
            if is_link(file_path):
                raise ValueError('Linked Skill content is not allowed: '+str(arcname))
            if not file_path.is_file() or should_exclude(arcname):
                continue
            lower = file_path.name.lower()
            if (lower == '.env' or lower.startswith('.env.') or lower in {'accounts.json', 'credentials.json'}
                    or '.git' in file_path.relative_to(skill_path).parts or '.asset-state' in file_path.relative_to(skill_path).parts):
                raise ValueError('Private state or credential-shaped content refused: '+str(arcname))
            files.append((file_path, arcname, hashlib.sha256(file_path.read_bytes()).hexdigest()))
        output_path.mkdir(parents=True, exist_ok=True)
        handle, temporary = tempfile.mkstemp(prefix='.skill-package-', suffix='.tmp', dir=output_path)
        os.close(handle)
        pending = Path(temporary)
        with zipfile.ZipFile(pending, 'w', zipfile.ZIP_DEFLATED) as archive:
            for file_path, arcname, digest in files:
                data = file_path.read_bytes()
                if hashlib.sha256(data).hexdigest() != digest:
                    raise ValueError('Skill source changed during packaging')
                archive.writestr(str(arcname).replace('\\', '/'), data)
        for file_path, arcname, digest in files:
            if hashlib.sha256(file_path.read_bytes()).hexdigest() != digest:
                raise ValueError('Skill source changed during packaging')
        if hashlib.sha256(skill_md.read_bytes()).hexdigest() != validated_frontmatter_hash:
            raise ValueError('SKILL.md changed after validation')
        current_license_hash = hashlib.sha256(license_file.read_bytes()).hexdigest() if license_file.exists() else None
        if current_license_hash != reviewed_license_hash:
            raise ValueError('License changed after restriction review')
        # Hard-link publication is exclusive: never truncate or replace a user artifact.
        os.link(pending, skill_filename)
        print(f'Successfully packaged skill to: {skill_filename}')
        return skill_filename
    except Exception as error:
        print(f'Error creating .skill file: {error}')
        return None
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)

def main():
    parser = argparse.ArgumentParser(description='Package a reviewed Skill without overwriting existing output')
    parser.add_argument('skill_path', help='Canonical Skill directory')
    parser.add_argument('output_dir', nargs='?', help='New output directory outside the Skill')
    args = parser.parse_args()
    result = package_skill(args.skill_path, args.output_dir)
    sys.exit(0 if result else 1)

if __name__ == "__main__":
    main()
