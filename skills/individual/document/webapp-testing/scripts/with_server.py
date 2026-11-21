#!/usr/bin/env python3
"""Run explicitly owned local servers, then a command, and clean up process trees.

Prefer --server-argv '["python", "server.py"]' (no shell).
Legacy --server "cd app && npm run dev" is a trusted shell command, not untrusted input.
Readiness checks TCP reachability, not application health or authenticated ownership.
"""
import argparse
import json
import os
import signal
import socket
import subprocess
import sys
import time


class Interrupted(Exception):
    def __init__(self, signum):
        self.signum = signum


class ProcessTree:
    """Windows kill-on-close job, or a POSIX process group. No PID-name matching."""
    def __init__(self):
        self.process = None
        self.job = None
        if os.name == 'nt':
            import ctypes
            from ctypes import wintypes
            self.ctypes = ctypes
            self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
            self.kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
            self.kernel.CreateJobObjectW.restype = wintypes.HANDLE
            self.kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
            self.kernel.SetInformationJobObject.restype = wintypes.BOOL
            self.kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
            self.kernel.AssignProcessToJobObject.restype = wintypes.BOOL
            self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
            self.kernel.CloseHandle.restype = wintypes.BOOL
            class Basic(ctypes.Structure):
                _fields_ = [('PerProcessUserTimeLimit', ctypes.c_longlong), ('PerJobUserTimeLimit', ctypes.c_longlong), ('LimitFlags', wintypes.DWORD), ('MinimumWorkingSetSize', ctypes.c_size_t), ('MaximumWorkingSetSize', ctypes.c_size_t), ('ActiveProcessLimit', wintypes.DWORD), ('Affinity', ctypes.c_size_t), ('PriorityClass', wintypes.DWORD), ('SchedulingClass', wintypes.DWORD)]
            class IO(ctypes.Structure):
                _fields_ = [(name, ctypes.c_ulonglong) for name in ['ReadOperationCount', 'WriteOperationCount', 'OtherOperationCount', 'ReadTransferCount', 'WriteTransferCount', 'OtherTransferCount']]
            class Extended(ctypes.Structure):
                _fields_ = [('BasicLimitInformation', Basic), ('IoInfo', IO), ('ProcessMemoryLimit', ctypes.c_size_t), ('JobMemoryLimit', ctypes.c_size_t), ('PeakProcessMemoryUsed', ctypes.c_size_t), ('PeakJobMemoryUsed', ctypes.c_size_t)]
            self.job = self.kernel.CreateJobObjectW(None, None)
            if not self.job:
                raise ctypes.WinError(ctypes.get_last_error())
            info = Extended()
            info.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if not self.kernel.SetInformationJobObject(self.job, 9, ctypes.byref(info), ctypes.sizeof(info)):
                error = ctypes.WinError(ctypes.get_last_error())
                self.kernel.CloseHandle(self.job)
                self.job = None
                raise error

    def start(self, command, *, shell=False, cwd=None):
        options = {'shell': shell, 'cwd': cwd, 'stdin': subprocess.DEVNULL}
        # Output inherits the caller: never create undrained PIPEs inside this helper.
        if os.name == 'nt':
            # Suspend until assigned to the job: children cannot escape before ownership.
            options['creationflags'] = subprocess.CREATE_NEW_PROCESS_GROUP | 0x00000004
        else:
            options['start_new_session'] = True
        self.process = subprocess.Popen(command, **options)
        if self.job and not self.kernel.AssignProcessToJobObject(self.job, int(self.process._handle)):
            error = self.ctypes.WinError(self.ctypes.get_last_error())
            # Do not proceed with a server lacking tree ownership.
            subprocess.run(['taskkill', '/PID', str(self.process.pid), '/T', '/F'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
            self.process.wait(timeout=5)
            raise error
        if self.job:
            ntdll = self.ctypes.WinDLL('ntdll')
            ntdll.NtResumeProcess.argtypes = [self.ctypes.c_void_p]
            ntdll.NtResumeProcess.restype = self.ctypes.c_long
            status = ntdll.NtResumeProcess(int(self.process._handle))
            if status != 0:
                raise RuntimeError(f'Cannot resume owned process: NTSTATUS {status:#x}')
        return self.process

    def stop(self):
        if self.job:
            job, self.job = self.job, None
            if not self.kernel.CloseHandle(job):
                raise self.ctypes.WinError(self.ctypes.get_last_error())
        elif self.process and os.name != 'nt':
            try:
                os.killpg(self.process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            time.sleep(0.1)
            try:
                os.killpg(self.process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        elif self.process and self.process.poll() is None:
            self.process.kill()
        if self.process:
            self.process.wait(timeout=5)


def port_open(port):
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=0.2):
            return True
    except OSError:
        return False


def check_free(port):
    if port_open(port):
        raise RuntimeError(f'Port {port} is already occupied; existing service preserved')
    with socket.socket() as probe:
        if os.name == 'nt' and hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        try:
            probe.bind(('127.0.0.1', port))
        except OSError as error:
            raise RuntimeError(f'Port {port} is unavailable; no servers started') from error


def wait_ready(process, port, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f'Server exited with {process.returncode} before readiness on port {port}')
        if port_open(port):
            time.sleep(0.15)
            if process.poll() is not None:
                raise RuntimeError(f'Server exited before stable readiness on port {port}')
            return
        time.sleep(0.05)
    raise RuntimeError(f'Server did not become reachable on port {port} within {timeout}s')


def main():
    parser = argparse.ArgumentParser(description='Run owned local server process trees and a bounded test command')
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--server', action='append', help='Trusted shell command; supports cd and &&')
    group.add_argument('--server-argv', action='append', help='JSON string array, executed without shell (repeatable)')
    parser.add_argument('--port', action='append', type=int, required=True, help='IPv4 loopback TCP port per server')
    parser.add_argument('--cwd', help='Working directory for all server and test commands (default current)')
    parser.add_argument('--timeout', type=float, default=30, help='Startup timeout per server, seconds')
    parser.add_argument('--command-timeout', type=float, default=300, help='Test command timeout, seconds')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command:
        parser.error('No test command specified')
    if args.timeout <= 0 or args.command_timeout <= 0 or not all(map(lambda n: n < float('inf'), [args.timeout, args.command_timeout])):
        parser.error('Timeouts must be finite positive numbers')
    if len(args.port) != len(args.server or args.server_argv):
        parser.error('Number of servers and ports must match')
    if len(set(args.port)) != len(args.port) or any(p < 1 or p > 65535 for p in args.port):
        parser.error('Ports must be unique integers 1..65535')
    if args.cwd and not os.path.isdir(args.cwd):
        parser.error('--cwd must be an existing directory')
    commands = args.server
    if args.server_argv:
        commands = []
        for text in args.server_argv:
            try:
                argv = json.loads(text)
            except ValueError:
                parser.error('--server-argv must be JSON')
            if not isinstance(argv, list) or not argv or any(not isinstance(a, str) or '\x00' in a for a in argv) or not argv[0]:
                parser.error('--server-argv requires a nonempty executable string array')
            commands.append(argv)
    elif any(not cmd.strip() for cmd in commands):
        parser.error('Server command must not be empty')

    trees = []
    previous = {}
    def interrupted(signum, frame):
        raise Interrupted(signum)
    signals = [signal.SIGINT, signal.SIGTERM]
    if hasattr(signal, 'SIGBREAK'):
        signals.append(signal.SIGBREAK)
    for sig in signals:
        previous[sig] = signal.signal(sig, interrupted)
    result = 1
    try:
        # Check all ports before any server starts. Bind cannot reserve a port across exec:
        # another process can still race us; TCP readiness is not authenticated ownership.
        for port in args.port:
            check_free(port)
        for argv, port in zip(commands, args.port):
            tree = ProcessTree()
            trees.append(tree)
            process = tree.start(argv, shell=bool(args.server), cwd=args.cwd)
            print(f'Started owned server pid={process.pid}; waiting on 127.0.0.1:{port}', flush=True)
            wait_ready(process, port, args.timeout)
        if any(tree.process.poll() is not None for tree in trees):
            raise RuntimeError('A server exited before the test command')
        task = ProcessTree()
        trees.append(task)
        process = task.start(command, cwd=args.cwd)
        deadline = time.monotonic() + args.command_timeout
        while process.poll() is None:
            if any(server.process.poll() is not None for server in trees[:-1]):
                raise RuntimeError('A server exited while the test command was running')
            if time.monotonic() >= deadline:
                raise TimeoutError('Test command timeout')
            time.sleep(0.05)
        result = process.returncode if process.returncode >= 0 else 128 - process.returncode
    except Interrupted as error:
        result = 128 + error.signum
        print(f'Interrupted by signal {error.signum}', file=sys.stderr)
    except TimeoutError as error:
        result = 124
        print(str(error), file=sys.stderr)
    except Exception as error:
        print(f'Error: {error}', file=sys.stderr)
    finally:
        # Cleanup must finish even after the first signal; do not abandon the remaining trees.
        for sig in previous:
            signal.signal(sig, signal.SIG_IGN)
        for tree in reversed(trees):
            try:
                tree.stop()
            except Exception as error:
                result = 1
                print(f'Process-tree cleanup failed: {error}', file=sys.stderr)
        for sig, handler in previous.items():
            signal.signal(sig, handler)
    return result


if __name__ == '__main__':
    sys.exit(main())
