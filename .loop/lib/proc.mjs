// .loop/lib/proc.mjs — child_process helpers (explicit args, no shell). Control plane (D28).
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from '../config.mjs';

export function run(cmd, args = [], opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd || REPO_ROOT,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
  return {
    code: res.status,
    signal: res.signal,
    stdout: (res.stdout || '').replace(/\r\n/g, '\n'),
    stderr: (res.stderr || '').replace(/\r\n/g, '\n'),
    ok: res.status === 0,
    error: res.error || null,
  };
}

export function git(args, opts = {}) {
  return run('git', args, opts);
}
