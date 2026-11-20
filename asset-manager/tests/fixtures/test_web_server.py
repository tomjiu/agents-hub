import json
import os
from pathlib import Path
import socket
import signal
import shlex
import subprocess
import sys
import tempfile
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parents[3]
HELPER = ROOT/'skills/individual/document/webapp-testing/scripts/with_server.py'

class WebServerTests(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory(prefix='hub-web-server-')
        self.root = Path(self.work.name)
        self.pid_files = []
        self.server_script = self.root/'fixture_server.py'
        self.server_script.write_text('import os,socket,sys,time\nfrom pathlib import Path\np=int(sys.argv[1]);Path(sys.argv[2]).write_text(str(os.getpid()))\nif len(sys.argv)>3: sys.stdout.write("x"*2000000);sys.stdout.flush()\ns=socket.socket();s.bind(("127.0.0.1",p));s.listen()\nwhile True:\n c,a=s.accept();c.sendall(b"HTTP/1.0 200 OK\\r\\nContent-Length: 7\\r\\n\\r\\nfixture");c.close()\n',encoding='utf-8')

    def tearDown(self):
        # Only kill fixture PIDs we recorded; never an arbitrary port's owner.
        for file in self.pid_files:
            if file.exists():
                pid = int(file.read_text())
                if os.name == 'nt':
                    subprocess.run(['taskkill','/PID',str(pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                else:
                    try: os.kill(pid,signal.SIGKILL)
                    except ProcessLookupError: pass
        self.work.cleanup()

    def port(self):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            return listener.getsockname()[1]

    def run_helper(self, server, port, command, timeout=2):
        return subprocess.run([sys.executable, '-X', 'utf8', str(HELPER), '--server', server, '--port', str(port), '--timeout', str(timeout), '--', *command], cwd=self.root, capture_output=True, text=True, encoding='utf-8', timeout=15)

    def test_existing_listener_is_not_mistaken_for_owned_server(self):
        listener = socket.socket()
        listener.bind(('127.0.0.1', 0))
        listener.listen()
        port = listener.getsockname()[1]
        stop = threading.Event()
        def accept():
            listener.settimeout(.1)
            while not stop.is_set():
                try:
                    connection, _ = listener.accept()
                    connection.close()
                except socket.timeout:
                    pass
        worker = threading.Thread(target=accept)
        worker.start()
        try:
            server_marker = self.root/'server-started'
            test_marker = self.root/'test-started'
            script = self.root/'wrong_server.py'
            script.write_text('from pathlib import Path; Path("server-started").write_text("bad")', encoding='utf-8')
            result = self.run_helper(subprocess.list2cmdline([sys.executable, str(script)]), port, [sys.executable, '-c', 'from pathlib import Path;Path("test-started").write_text("bad")'])
            self.assertNotEqual(result.returncode, 0, result.stdout+result.stderr)
            self.assertFalse(server_marker.exists(), 'Should reject all occupied ports before spawning')
            self.assertFalse(test_marker.exists(), 'Should not run tests against an unrelated listener')
            with socket.create_connection(('127.0.0.1', port), timeout=1):
                pass
        finally:
            stop.set()
            worker.join()
            listener.close()

    def server(self, port, noisy=False):
        marker = self.root/('pid-'+str(port))
        self.pid_files.append(marker)
        argv = [sys.executable, '-X', 'utf8', str(self.server_script), str(port), str(marker)]
        if noisy: argv.append('noisy')
        return argv

    def helper_args(self, servers, ports, command, timeout=2, command_timeout=3):
        args = [sys.executable, '-X', 'utf8', str(HELPER), '--timeout', str(timeout), '--command-timeout', str(command_timeout)]
        for server, port in zip(servers, ports):
            args.extend(['--server-argv', json.dumps(server), '--port', str(port)])
        return [*args, '--', *command]

    def closed(self, port):
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=.2): return False
        except OSError: return True

    def test_noisy_server_real_http_and_success_cleanup(self):
        port = self.port()
        command = [sys.executable, '-c', 'import urllib.request;assert urllib.request.urlopen("http://127.0.0.1:'+str(port)+'").read()==b"fixture"']
        result = subprocess.run(self.helper_args([self.server(port, True)],[port],command),cwd=self.root,capture_output=True,text=True,timeout=15)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertGreater(len(result.stdout),1000000,'Undrained helper PIPE would block a noisy startup')
        self.assertTrue(self.closed(port))

    def test_command_failure_preserves_exit_code_and_cleans_service(self):
        port=self.port()
        result=subprocess.run(self.helper_args([self.server(port)],[port],[sys.executable,'-c','import sys;sys.exit(7)']),cwd=self.root,capture_output=True,text=True,timeout=15)
        self.assertEqual(result.returncode,7,result.stderr)
        self.assertTrue(self.closed(port))

    def test_command_timeout_stops_command_and_service(self):
        port=self.port()
        result=subprocess.run(self.helper_args([self.server(port)],[port],[sys.executable,'-c','import time;time.sleep(60)'],command_timeout=.3),cwd=self.root,capture_output=True,text=True,timeout=15)
        self.assertEqual(result.returncode,124,result.stderr)
        self.assertTrue(self.closed(port))

    def test_startup_failure_prevents_test_execution(self):
        port=self.port();marker=self.root/'test-marker'
        result=subprocess.run(self.helper_args([[sys.executable,'-c','import sys;sys.exit(9)']],[port],[sys.executable,'-c','from pathlib import Path;Path("test-marker").touch()']),cwd=self.root,capture_output=True,text=True,timeout=15)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('exited',result.stderr)
        self.assertFalse(marker.exists())

    def test_startup_timeout_prevents_test_execution(self):
        port=self.port();marker=self.root/'test-marker'
        result=subprocess.run(self.helper_args([[sys.executable,'-c','import time;time.sleep(60)']],[port],[sys.executable,'-c','from pathlib import Path;Path("test-marker").touch()'],timeout=.3),cwd=self.root,capture_output=True,text=True,timeout=15)
        self.assertNotEqual(result.returncode,0)
        self.assertFalse(marker.exists())

    def test_second_server_failure_cleans_first(self):
        first,second=self.port(),self.port()
        result=subprocess.run(self.helper_args([self.server(first),[sys.executable,'-c','import sys;sys.exit(9)']],[first,second],[sys.executable,'-c','pass']),cwd=self.root,capture_output=True,text=True,timeout=15)
        self.assertNotEqual(result.returncode,0)
        self.assertTrue(self.closed(first))

    def test_legacy_shell_parent_and_grandchild_are_both_cleaned(self):
        port=self.port();parent=self.root/'parent.py';child=self.server(port)
        parent.write_text('import subprocess,time\nsubprocess.Popen('+repr(child)+')\ntime.sleep(60)',encoding='utf-8')
        argv=[sys.executable,'-X','utf8',str(parent)]
        shell_command=subprocess.list2cmdline(argv) if os.name=='nt' else shlex.join(argv)
        result=self.run_helper(shell_command,port,[sys.executable,'-c','pass'])
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertTrue(self.closed(port),'Child/grandchild listener must be stopped, not just its shell')

    def test_invalid_duplicate_ports_and_argv_fail_before_spawn(self):
        port=self.port();marker=self.root/'spawned'
        argv=[sys.executable,'-c','from pathlib import Path;Path("spawned").touch()']
        for args in [self.helper_args([argv,argv],[port,port],[sys.executable,'-c','pass']),[sys.executable,str(HELPER),'--server-argv','{}','--port',str(port),'--',sys.executable,'-c','pass']]:
            result=subprocess.run(args,cwd=self.root,capture_output=True,text=True,timeout=15)
            self.assertNotEqual(result.returncode,0)
            self.assertFalse(marker.exists())

    def running_helper(self, port):
        command=[sys.executable,'-c','from pathlib import Path;import time;Path("command-running").touch();time.sleep(60)']
        helper=subprocess.Popen(self.helper_args([self.server(port)],[port],command,command_timeout=30),cwd=self.root,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True,creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name=='nt' else 0)
        try:
            deadline=time.monotonic()+5
            while not (self.root/'command-running').exists():
                if helper.poll() is not None: self.fail('Helper exited before readiness: '+helper.stderr.read())
                if time.monotonic()>deadline: self.fail('Helper readiness timeout')
                time.sleep(.03)
            return helper
        except BaseException:
            helper.kill();helper.wait();helper.stderr.close();raise

    def test_interrupt_cleans_server_and_returns_nonzero(self):
        port=self.port();helper=self.running_helper(port)
        try:
            if os.name=='nt': helper.send_signal(signal.CTRL_BREAK_EVENT)
            else: helper.send_signal(signal.SIGTERM)
            code=helper.wait(timeout=8)
            self.assertEqual(code,128+(signal.SIGBREAK if os.name=='nt' else signal.SIGTERM))
            self.assertIn('Interrupted by signal',helper.stderr.read())
            deadline=time.monotonic()+3
            while not self.closed(port) and time.monotonic()<deadline: time.sleep(.03)
            self.assertTrue(self.closed(port),'Interrupted helper must not leave listener')
        finally:
            if helper.poll() is None: helper.kill();helper.wait()
            helper.stderr.close()

    @unittest.skipUnless(os.name=='nt','Windows kill-on-close acceptance')
    def test_forced_helper_exit_closes_job_and_listener(self):
        port=self.port();helper=self.running_helper(port)
        try:
            helper.kill();helper.wait(timeout=5)
            deadline=time.monotonic()+3
            while not self.closed(port) and time.monotonic()<deadline: time.sleep(.03)
            self.assertTrue(self.closed(port),'Closing helper job handles must stop listener')
        finally:
            if helper.poll() is None: helper.kill();helper.wait()
            helper.stderr.close()

    def test_two_live_servers_are_queried_and_cleaned(self):
        first,second=self.port(),self.port()
        command=[sys.executable,'-c','import urllib.request;assert all(urllib.request.urlopen("http://127.0.0.1:"+str(p)).read()==b"fixture" for p in '+repr([first,second])+')']
        result=subprocess.run(self.helper_args([self.server(first),self.server(second)],[first,second],command),cwd=self.root,capture_output=True,text=True,timeout=15)
        self.assertEqual(result.returncode,0,result.stderr);self.assertTrue(self.closed(first));self.assertTrue(self.closed(second))

    def test_server_exit_while_command_runs_cancels_command(self):
        port=self.port();server=self.root/'short_server.py'
        server.write_text('import socket,sys,time; s=socket.socket();s.bind(("127.0.0.1",int(sys.argv[1])));s.listen();time.sleep(.7)',encoding='utf-8')
        result=subprocess.run(self.helper_args([[sys.executable,str(server),str(port)]],[port],[sys.executable,'-c','import time;time.sleep(60)']),cwd=self.root,capture_output=True,text=True,timeout=15)
        self.assertNotEqual(result.returncode,0);self.assertIn('server exited',result.stderr.lower());self.assertTrue(self.closed(port))

    def test_explicit_cwd_and_literal_argument_do_not_invoke_shell(self):
        port=self.port();cwd=self.root/'space directory';cwd.mkdir()
        args=self.helper_args([self.server(port)],[port],[sys.executable,'-c','import os,sys;assert os.path.basename(os.getcwd())=="space directory";assert sys.argv[1]=="& echo UNTRUSTED"','& echo UNTRUSTED'])
        args[4:4]=['--cwd',str(cwd)]
        result=subprocess.run(args,cwd=self.root,capture_output=True,text=True,timeout=15)
        self.assertEqual(result.returncode,0,result.stderr);self.assertTrue(self.closed(port))

    def test_second_port_already_occupied_rejects_before_first_server_starts(self):
        listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen();port=listener.getsockname()[1];first=self.port()
        try:
            marker=self.root/'unexpected-start'
            argv=[sys.executable,'-c','from pathlib import Path;Path("unexpected-start").touch()']
            result=subprocess.run(self.helper_args([argv,argv],[first,port],[sys.executable,'-c','pass']),cwd=self.root,capture_output=True,text=True,timeout=15)
            self.assertNotEqual(result.returncode,0);self.assertFalse(marker.exists())
        finally: listener.close()

    def test_invalid_timeouts_and_missing_command_never_spawn(self):
        port=self.port();argv=[sys.executable,'-c','from pathlib import Path;Path("spawned").touch()']
        for value in ['0','-1','nan','inf']:
            result=subprocess.run(self.helper_args([argv],[port],[sys.executable,'-c','pass'],timeout=value),cwd=self.root,capture_output=True,text=True,timeout=15)
            self.assertNotEqual(result.returncode,0);self.assertFalse((self.root/'spawned').exists())
        result=subprocess.run([sys.executable,str(HELPER),'--server-argv',json.dumps(argv),'--port',str(port)],cwd=self.root,capture_output=True,text=True,timeout=15)
        self.assertNotEqual(result.returncode,0);self.assertFalse((self.root/'spawned').exists())

if __name__ == '__main__':
    unittest.main()
