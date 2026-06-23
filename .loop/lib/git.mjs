// .loop/lib/git.mjs — narrow git operations for the driver. Control plane (D28).
import fs from 'node:fs';
import path from 'node:path';
import { git } from './proc.mjs';
import { REPO_ROOT } from '../config.mjs';

export function headSha() {
  return git(['rev-parse', 'HEAD']).stdout.trim();
}

export function shortSha() {
  return git(['rev-parse', '--short', 'HEAD']).stdout.trim();
}

export function currentBranch() {
  return git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
}

export function isClean() {
  return git(['status', '--porcelain']).stdout.trim() === '';
}

// Repo-relative changed paths (modified + staged + untracked), forward-slashed.
export function changedFiles() {
  const out = git(['status', '--porcelain=v1', '--untracked-files=all']).stdout;
  const files = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    let rest = line.slice(3);
    if (rest.includes(' -> ')) rest = rest.split(' -> ')[1];
    rest = rest.trim().replace(/^"|"$/g, '');
    if (rest) files.push(rest.replace(/\\/g, '/'));
  }
  return [...new Set(files)];
}

export function isTracked(relPath) {
  return git(['ls-files', '--error-unmatch', relPath]).ok;
}

// Surgical revert: restore tracked files to HEAD, delete untracked ones.
// Never touches files outside `paths`, so it is safe to run before the
// control plane itself is committed.
export function revertPaths(paths) {
  for (const rel of paths) {
    if (isTracked(rel)) {
      git(['checkout', '--', rel]);
    } else {
      const abs = path.join(REPO_ROOT, rel);
      try { fs.rmSync(abs, { force: true }); } catch { /* ignore */ }
    }
  }
}

export function add(paths) {
  if (paths.length) git(['add', '--', ...paths]);
}

export function commit(message) {
  return git(['commit', '-m', message]);
}

export function push(remote = 'origin', branch = currentBranch()) {
  // Signal the pre-push hook (D30) that this push originates from the loop, so the
  // barrier engages. Operator/human pushes (without this flag) are not constrained.
  return git(['push', remote, branch], { env: { ...process.env, LOOP_PUSH: '1' } });
}
