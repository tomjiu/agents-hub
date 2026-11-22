import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / 'skills/individual/engineering/skill-creator/scripts/package_skill.py'
VALIDATOR = SCRIPT.parent / 'quick_validate.py'
spec = importlib.util.spec_from_file_location('quick_validate', VALIDATOR)
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)
sys.modules['quick_validate'] = validator
package_spec = importlib.util.spec_from_file_location('package_skill', SCRIPT)
packager = importlib.util.module_from_spec(package_spec)
package_spec.loader.exec_module(packager)

class SkillPackagerTests(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory(prefix='hub-package-test-')
        self.base = Path(self.work.name)
        self.skill = self.base / 'sample-skill'
        self.skill.mkdir()
        self.out = self.base / 'output'
        self.out.mkdir()
        self.write_skill()

    def tearDown(self):
        self.work.cleanup()

    def write_skill(self, name='sample-skill', description='中文任务 fixture'):
        (self.skill / 'SKILL.md').write_text('---\nname: '+json.dumps(name)+'\ndescription: '+json.dumps(description, ensure_ascii=False)+'\n---\n完整正文\n', encoding='utf-8')

    def run_cli(self, *args):
        env = dict(os.environ, PYTHONUTF8='1', PYTHONDONTWRITEBYTECODE='1', PYTHONIOENCODING='utf-8')
        bootstrap = 'import os,sys,runpy;sys.path.insert(0,os.environ["HUB_PYTHON_DEPS"]);sys.argv=sys.argv[1:];runpy.run_path(sys.argv[0],run_name="__main__")'
        return subprocess.run([sys.executable, '-X', 'utf8', '-c', bootstrap, str(SCRIPT), *map(str,args)], cwd=self.base, env=env, capture_output=True, text=True, encoding='utf-8', timeout=15)

    def test_direct_help_and_successful_archive_are_real_cli(self):
        self.assertEqual(self.run_cli('--help').returncode, 0)
        (self.skill / 'scripts').mkdir()
        (self.skill / 'scripts/demo.py').write_text('print("fixture")', encoding='utf-8')
        result = self.run_cli(self.skill, self.out)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        with zipfile.ZipFile(self.out / 'sample-skill.skill') as archive:
            self.assertEqual(archive.read('sample-skill/SKILL.md'), (self.skill/'SKILL.md').read_bytes())
            self.assertIn('sample-skill/scripts/demo.py', archive.namelist())

    def test_existing_artifact_is_never_overwritten(self):
        target = self.out / 'sample-skill.skill'
        target.write_bytes(b'USER OWNED ARCHIVE')
        self.assertNotEqual(self.run_cli(self.skill, self.out).returncode, 0)
        self.assertEqual(target.read_bytes(), b'USER OWNED ARCHIVE')

    def test_output_inside_source_is_rejected(self):
        self.assertNotEqual(self.run_cli(self.skill, self.skill).returncode, 0)
        self.assertFalse((self.skill/'sample-skill.skill').exists())

    def test_empty_metadata_is_not_valid(self):
        for name, description in [('', 'description'), ('sample-skill', '')]:
            self.write_skill(name, description)
            self.assertFalse(validator.validate_skill(self.skill)[0])
            self.assertNotEqual(self.run_cli(self.skill, self.out).returncode, 0)

    def test_secret_and_restricted_license_files_fail_before_publication(self):
        (self.skill/'accounts.json').write_text('{"private":"fixture"}', encoding='utf-8')
        self.assertNotEqual(self.run_cli(self.skill, self.out).returncode, 0)
        self.assertFalse((self.out/'sample-skill.skill').exists())
        (self.skill/'accounts.json').unlink()
        (self.skill/'LICENSE.txt').write_text('ADDITIONAL RESTRICTIONS users may not Distribute, sublicense, or transfer', encoding='utf-8')
        self.assertNotEqual(self.run_cli(self.skill, self.out).returncode, 0)
        self.assertFalse((self.out/'sample-skill.skill').exists())

    def test_duplicate_frontmatter_keys_are_rejected(self):
        (self.skill/'SKILL.md').write_text('---\nname: bad\nname: sample-skill\ndescription: fixture\n---\nbody', encoding='utf-8')
        self.assertFalse(validator.validate_skill(self.skill)[0])

    def test_write_failure_cleans_only_owned_temporary_archive(self):
        with patch.object(packager.zipfile.ZipFile, 'writestr', side_effect=OSError('injected write failure')):
            self.assertIsNone(packager.package_skill(self.skill, self.out))
        self.assertEqual(list(self.out.iterdir()), [])
        self.assertTrue((self.skill/'SKILL.md').exists())

    def test_racing_output_writer_is_never_overwritten(self):
        target = self.out/'sample-skill.skill'
        def conflict(*args):
            target.write_bytes(b'CONCURRENT USER')
            raise FileExistsError('concurrent writer')
        with patch.object(packager.os, 'link', side_effect=conflict):
            self.assertIsNone(packager.package_skill(self.skill, self.out))
        self.assertEqual(target.read_bytes(), b'CONCURRENT USER')
        self.assertEqual(list(self.out.iterdir()), [target])

    def test_source_changed_after_validation_is_not_published(self):
        original = packager.zipfile.ZipFile.writestr
        def change(archive, *args, **kwargs):
            result = original(archive, *args, **kwargs)
            (self.skill/'SKILL.md').write_text('changed by another writer', encoding='utf-8')
            return result
        with patch.object(packager.zipfile.ZipFile, 'writestr', change):
            self.assertIsNone(packager.package_skill(self.skill, self.out))
        self.assertEqual(list(self.out.iterdir()), [])

    def test_license_created_during_packaging_is_refused(self):
        original = packager.zipfile.ZipFile.writestr
        def change(archive, *args, **kwargs):
            result = original(archive, *args, **kwargs)
            (self.skill/'LICENSE.txt').write_text('new restriction after review', encoding='utf-8')
            return result
        with patch.object(packager.zipfile.ZipFile, 'writestr', change):
            self.assertIsNone(packager.package_skill(self.skill, self.out))
        self.assertEqual(list(self.out.iterdir()), [])

    def test_non_string_yaml_mapping_key_is_rejected(self):
        (self.skill/'SKILL.md').write_text('---\n? [complex, key]\n: value\nname: sample-skill\ndescription: fixture\n---\nbody', encoding='utf-8')
        self.assertFalse(validator.validate_skill(self.skill)[0])

if __name__ == '__main__':
    unittest.main()
