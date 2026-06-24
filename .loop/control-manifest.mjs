// .loop/control-manifest.mjs — SHA-256 manifest of the control plane (D28).
// The maker writes decks/assets only; this verifies that NO control-plane file
// changed during a run. Drift => revert + escalate.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { LOOP_DIR, MANIFEST_FILE } from './config.mjs';

// Mutable runtime/data files that are intentionally NOT part of the immutable plane.
const EXCLUDE_FILES = new Set([
  'control-manifest.json',
  'ledger.json',
  'run.json',
  'scoreboard.json',
  'LOOP_STATUS',
  'status.json',
  'failures.jsonl',
  '.env',
]);
const EXCLUDE_DIRS = new Set(['baseline', 'judge', 'node_modules', '.cache']);

function controlFiles(dir) {
  const out = [];
  (function walk(d, rel) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (EXCLUDE_DIRS.has(ent.name)) continue;
        walk(path.join(d, ent.name), childRel);
      } else {
        if (EXCLUDE_FILES.has(ent.name)) continue;
        if (ent.name.endsWith('.log')) continue;
        out.push(childRel);
      }
    }
  })(dir, '');
  return out.sort();
}

function hashFile(rel, dir) {
  // Normalize CRLF -> LF so the manifest is line-ending-agnostic (D28): a
  // checkout that flips EOLs (core.autocrlf) must never be mistaken for
  // control-plane tampering. All control files are text (.mjs/.json).
  const raw = fs.readFileSync(path.join(dir, rel), 'utf8');
  return crypto.createHash('sha256').update(raw.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

// dir/manifestFile are injectable for isolated testing; the driver always uses the
// real control plane via the defaults, so production behavior is unchanged (D28).
export function compute(dir = LOOP_DIR) {
  const m = {};
  for (const rel of controlFiles(dir)) m[rel] = hashFile(rel, dir);
  return m;
}

export function writeBaseline(dir = LOOP_DIR, manifestFile = MANIFEST_FILE) {
  const m = compute(dir);
  fs.writeFileSync(manifestFile, JSON.stringify(m, null, 2) + '\n');
  return m;
}

export function verify(dir = LOOP_DIR, manifestFile = MANIFEST_FILE) {
  if (!fs.existsSync(manifestFile)) return { ok: false, reason: 'no-manifest', drift: [] };
  const base = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const now = compute(dir);
  const drift = [];
  for (const f of new Set([...Object.keys(base), ...Object.keys(now)])) {
    if (base[f] !== now[f]) drift.push(f);
  }
  return { ok: drift.length === 0, drift };
}

function main(argv) {
  if (argv.includes('--write')) {
    const m = writeBaseline();
    console.log(`control-manifest: wrote baseline for ${Object.keys(m).length} file(s)`);
    process.exit(0);
  }
  const r = verify();
  if (r.ok) {
    console.log('control-manifest: OK (no control-plane drift)');
    process.exit(0);
  }
  console.error(`control-manifest: DRIFT${r.reason ? ' (' + r.reason + ')' : ''}:`);
  for (const f of r.drift) console.error(`  - ${f}`);
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2));
}
