// .loop/push-gate.mjs — pre-push barrier policy (D30). Control plane (D28).
//
// SECOND, independent code path from the in-process driver diff-gate. The driver's
// diff-gate vets the MAKER's per-iteration working-tree delta (decks/assets only).
// THIS gate vets the COMMITTED push, which also legitimately carries the driver's
// own committed data files (manifest/ledger/run/LOOP_STATUS, D5). It therefore
// allows exactly the maker allowlist PLUS those data files, and blocks everything
// else — most importantly control-plane CODE, .github/.githooks, package.json, and
// git config. It additionally rejects any secret-like token in the pushed diff.
//
// Invoked by .githooks/pre-push as a separate process — a real second barrier on
// the loop's path to main, not a re-call of the same in-process check.
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { ALLOWED_WRITE, PUSH_ALLOWED_DATA } from './config.mjs';
import { scanDiff } from './secret-scan.mjs';

export function evaluatePush(files) {
  const violations = [];
  for (const raw of files) {
    const f = String(raw).replace(/\\/g, '/');
    const allowed =
      ALLOWED_WRITE.some((rx) => rx.test(f)) || PUSH_ALLOWED_DATA.some((rx) => rx.test(f));
    if (!allowed) violations.push(f);
  }
  return {
    ok: violations.length === 0,
    files: files.map((f) => String(f).replace(/\\/g, '/')),
    violations,
  };
}

function main(argv) {
  const useStdin = argv.includes('--stdin');
  const files = argv.filter((a) => !a.startsWith('--'));

  let status = 0;
  const pathResult = evaluatePush(files);
  if (!pathResult.ok) {
    status = 1;
    console.error('push-gate: BLOCKED — out-of-policy pushed paths:');
    for (const v of pathResult.violations) console.error(`  - ${v}`);
  }

  if (useStdin) {
    let diff = '';
    try { diff = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
    const findings = scanDiff(diff);
    if (findings.length) {
      status = 1;
      console.error('push-gate: BLOCKED — secret-like tokens in pushed diff:');
      for (const fnd of findings) console.error(`  - [${fnd.rule}] line ${fnd.line}: ${fnd.match}`);
    }
  }

  if (status === 0) console.log(`push-gate: OK (${files.length} pushed path(s) within policy)`);
  process.exit(status);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2));
}
