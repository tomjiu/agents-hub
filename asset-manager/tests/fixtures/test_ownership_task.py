import csv
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / 'skills/individual/security/security-ownership-map/scripts'
GIT = os.environ.get('HUB_GIT_EXECUTABLE', 'git')
BOOTSTRAP = 'import os,sys,runpy;sys.path.insert(0,os.environ["HUB_PYTHON_DEPS"]);sys.argv=sys.argv[1:];runpy.run_path(sys.argv[0],run_name="__main__")'

class OwnershipTaskTests(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory(prefix='hub-ownership-task-')
        self.base = Path(self.work.name)
        self.repo = self.base / 'repo'
        self.repo.mkdir()
        self.git('init')
        self.git('config', 'user.name', 'Fixture Alice')
        self.git('config', 'user.email', 'alice@example.invalid')
        (self.repo/'src/auth').mkdir(parents=True)
        (self.repo/'src/auth/login.py').write_text('fixture = 1', encoding='utf-8')
        self.git('add', '.')
        self.git('commit', '-m', 'Add fixture auth')
        self.git('config', 'user.name', 'Fixture Bob')
        self.git('config', 'user.email', 'bob@example.invalid')
        (self.repo/'src/auth/login.py').write_text('fixture = 2', encoding='utf-8')
        self.git('add', '.')
        self.git('commit', '-m', 'Review fixture auth')
        self.out = self.base / 'result'

    def tearDown(self):
        self.work.cleanup()

    def git(self, *args):
        return subprocess.run([GIT, *args], cwd=self.repo, check=True, capture_output=True, text=True)

    def script(self, name, *args):
        env = dict(os.environ)
        env['PATH'] = str(Path(GIT).parent)+os.pathsep+env.get('PATH', '')
        return subprocess.run([sys.executable, '-X', 'utf8', '-c', BOOTSTRAP, str(SCRIPTS/name), *map(str,args)], cwd=self.base, env=env, capture_output=True, text=True, encoding='utf-8', timeout=20)

    def build(self):
        return self.script('build_ownership_map.py', '--repo', self.repo, '--out', self.out, '--no-communities', '--no-cochange')

    def test_git_history_to_artifacts_and_bounded_query(self):
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout+result.stderr)
        summary = json.loads((self.out/'summary.json').read_text(encoding='utf-8'))
        self.assertEqual(summary['stats']['commits'], 2)
        self.assertEqual(summary['stats']['people'], 2)
        self.assertEqual(summary['stats']['files'], 1)
        with (self.out/'files.csv').open(encoding='utf-8') as handle:
            rows = list(csv.DictReader(handle))
        self.assertEqual(rows[0]['path'], 'src/auth/login.py')
        query = self.script('query_ownership.py', '--data-dir', self.out, 'files', '--tag', 'auth', '--bus-factor-max', '2')
        self.assertEqual(query.returncode, 0, query.stderr)
        self.assertIn('src/auth/login.py', query.stdout)
        self.assertEqual(self.git('status', '--porcelain').stdout, '')

    def test_documented_runner_performs_offline_analysis(self):
        result = self.script('run_ownership_map.py', '--repo', self.repo, '--out', self.out, '--no-communities', '--no-cochange')
        self.assertEqual(result.returncode, 0, result.stdout+result.stderr)
        self.assertEqual(json.loads((self.out/'summary.json').read_text(encoding='utf-8'))['stats']['commits'], 2)

    def test_existing_output_is_preserved(self):
        self.out.mkdir()
        (self.out/'summary.json').write_bytes(b'USER ANALYSIS')
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.out/'summary.json').read_bytes(), b'USER ANALYSIS')

    def test_linked_output_ancestor_does_not_write_external_directory(self):
        external = self.base/'external'
        external.mkdir()
        linked = self.base/'linked'
        # Directory junctions are available in this Windows fixture without file-symlink privilege.
        if os.name == 'nt':
            result = subprocess.run(['cmd', '/c', 'mklink', '/J', str(linked), str(external)], capture_output=True)
            if result.returncode != 0:
                self.skipTest('Directory junction unavailable')
        else:
            linked.symlink_to(external, target_is_directory=True)
        self.out = linked/'report'
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(list(external.iterdir()), [])

if __name__ == '__main__':
    unittest.main()
