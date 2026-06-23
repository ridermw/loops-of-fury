// .loop/diff-gate.mjs — standalone allowlist gate (D30). Control plane (D28).
// Pure logic + CLI. Imported by the driver AND by the pre-push hook (second,
// independent code path). Rejects any changed path outside the maker allowlist.
import { pathToFileURL } from 'node:url';
import { ALLOWED_WRITE, FORBIDDEN_WRITE } from './config.mjs';
import { changedFiles } from './lib/git.mjs';

export function evaluate(files) {
  const violations = [];
  for (const raw of files) {
    const f = String(raw).replace(/\\/g, '/');
    const forbidden = FORBIDDEN_WRITE.some((rx) => rx.test(f));
    const allowed = ALLOWED_WRITE.some((rx) => rx.test(f));
    if (forbidden || !allowed) violations.push(f);
  }
  return { ok: violations.length === 0, files: files.map((f) => String(f).replace(/\\/g, '/')), violations };
}

function main(argv) {
  const files = argv.length ? argv : changedFiles();
  const result = evaluate(files);
  if (result.ok) {
    console.log(`diff-gate: OK (${files.length} changed file(s) within allowlist)`);
    process.exit(0);
  }
  console.error('diff-gate: BLOCKED — out-of-allowlist changes:');
  for (const v of result.violations) console.error(`  - ${v}`);
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2));
}
