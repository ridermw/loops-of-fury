// .loop/driver.mjs — loop orchestration spine. Control plane (D28).
//
// Modes (flags):
//   --init           render decks, write slide baseline + control manifest. No commit.
//   --selftest       inject a safe deck edit, prove gate+manifest+check GREEN, revert. No push.
//   --selftest-gate  create a forbidden change, prove the diff-gate BLOCKS it. No push.
//   --dry            run one real iteration (maker), prove pipeline, then revert. No push.
//   --once           run one real iteration; commit (Refs:#N) + push if GREEN. (Real run only.)
//
// The driver owns every git/gate/commit decision. The maker only edits files.
// Building the loop never writes to main: only --once ever commits/pushes.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  REPO_ROOT, DECKS, SLIDES_BASELINE, BASELINE_DIR, RUN_FILE,
} from './config.mjs';
import { withBrowser, renderDeck } from './render.mjs';
import { runCheck } from './check.mjs';
import { evaluate as gateEvaluate } from './diff-gate.mjs';
import { writeBaseline as writeManifest, verify as verifyManifest } from './control-manifest.mjs';
import * as G from './lib/git.mjs';
import { noopMaker, copilotMaker } from './maker.mjs';

const DECK_INDEX = path.join(REPO_ROOT, 'index.html');

function log(...a) { console.log('[driver]', ...a); }
function err(...a) { console.error('[driver]', ...a); }

async function initBaselines() {
  fs.mkdirSync(BASELINE_DIR, { recursive: true });
  const counts = await withBrowser(async (browser) => {
    const out = {};
    for (const deck of DECKS) {
      const r = await renderDeck(browser, deck);
      out[deck] = r.totalSlides;
    }
    return out;
  });
  fs.writeFileSync(SLIDES_BASELINE, JSON.stringify(counts, null, 2) + '\n');
  log('slide baseline:', JSON.stringify(counts));
  writeManifest();
  log('control manifest written');
  return counts;
}

function readIssueNumber() {
  try {
    const run = JSON.parse(fs.readFileSync(RUN_FILE, 'utf8'));
    return run.issue || null;
  } catch {
    return null;
  }
}

// One real iteration. Returns a structured status; never throws on expected paths.
// Attributes only the delta the maker introduces (snapshot before / diff after),
// so a not-yet-committed control plane or gitignored runtime files are never
// mis-attributed to the maker.
export async function iteration({ commitAndPush, maker }) {
  const drift = verifyManifest();
  if (!drift.ok) return { status: 'control-drift', drift: drift.drift, reason: drift.reason };

  const before = new Set(G.changedFiles());
  maker();
  const files = G.changedFiles().filter((f) => !before.has(f));

  if (files.length === 0) return { status: 'noop' };

  const gate = gateEvaluate(files);
  if (!gate.ok) {
    G.revertPaths(files);
    return { status: 'gate-blocked', violations: gate.violations };
  }

  const postMaker = verifyManifest();
  if (!postMaker.ok) {
    G.revertPaths(files);
    return { status: 'control-drift', drift: postMaker.drift };
  }

  const check = await runCheck();
  if (!check.ok) {
    G.revertPaths(files);
    return { status: 'red', failures: check.failures };
  }

  if (commitAndPush) {
    const issue = readIssueNumber();
    const trailer = issue ? `\n\nRefs: #${issue}` : '';
    G.add(files);
    const c = G.commit(`loop: improve decks${trailer}`);
    if (!c.ok) return { status: 'commit-failed', stderr: c.stderr };
    const p = G.push();
    if (!p.ok) return { status: 'push-failed', stderr: p.stderr };
    return { status: 'green', committed: true, files };
  }

  G.revertPaths(files);
  return { status: 'green', committed: false, files };
}

async function selftest() {
  if (!verifyManifest().ok) { err('manifest not initialized — run --init first'); return 1; }
  const original = fs.readFileSync(DECK_INDEX, 'utf8');
  if (!original.includes('</body>')) { err('index.html missing </body>'); return 1; }

  const before = new Set(G.changedFiles());
  const edited = original.replace('</body>', '  <!-- loop-selftest marker -->\n</body>');
  fs.writeFileSync(DECK_INDEX, edited);
  log('injected safe edit into index.html');

  let rc = 0;
  try {
    const files = G.changedFiles().filter((f) => !before.has(f));
    log('maker-attributed files:', JSON.stringify(files));
    if (files.length !== 1 || files[0] !== 'index.html') {
      err('FAIL: expected exactly [index.html], got', JSON.stringify(files)); rc = 1;
    }
    const gate = gateEvaluate(files);
    if (!gate.ok) { err('FAIL: gate blocked an allowed deck edit:', gate.violations); rc = 1; }
    else log('gate: OK');

    if (!verifyManifest().ok) { err('FAIL: control drift after deck edit'); rc = 1; }
    else log('manifest: OK');

    const check = await runCheck();
    if (!check.ok) { err('FAIL: checker RED on a benign edit:', check.failures); rc = 1; }
    else log('check: GREEN');
  } finally {
    G.revertPaths(['index.html']);
    const restored = fs.readFileSync(DECK_INDEX, 'utf8') === original;
    log('revert restored index.html:', restored);
    if (!restored) { err('FAIL: revert did not restore index.html'); rc = 1; }
  }
  log(rc === 0 ? 'SELFTEST PASS' : 'SELFTEST FAIL');
  return rc;
}

function selftestGate() {
  const before = new Set(G.changedFiles());
  const tamper = path.join(REPO_ROOT, '.loop', '__tamper.tmp');
  fs.writeFileSync(tamper, 'maker should never be able to write here\n');
  let rc = 0;
  try {
    const files = G.changedFiles().filter((f) => !before.has(f));
    log('maker-attributed files:', JSON.stringify(files));
    const gate = gateEvaluate(files);
    if (gate.ok) { err('FAIL: gate did NOT block a .loop/ write'); rc = 1; }
    else log('gate correctly BLOCKED:', JSON.stringify(gate.violations));
  } finally {
    fs.rmSync(tamper, { force: true });
  }
  log(rc === 0 ? 'SELFTEST-GATE PASS' : 'SELFTEST-GATE FAIL');
  return rc;
}

async function main(argv) {
  const flag = argv[0];
  if (flag === '--init') {
    await initBaselines();
    return 0;
  }
  if (flag === '--selftest') return selftest();
  if (flag === '--selftest-gate') return selftestGate();

  if (flag === '--dry' || flag === '--once') {
    const useCopilot = process.env.LOOP_MAKER === 'copilot';
    const axis = process.env.LOOP_AXIS || 'render';
    const maker = useCopilot ? () => copilotMaker({ axis, deck: 'index.html' }) : noopMaker;
    const result = await iteration({ commitAndPush: flag === '--once', maker });
    log('iteration:', JSON.stringify(result));
    return result.status === 'green' || result.status === 'noop' ? 0 : 1;
  }

  err('usage: node .loop/driver.mjs [--init|--selftest|--selftest-gate|--dry|--once]');
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => { err('ERROR —', e && e.stack ? e.stack : e); process.exit(2); });
}
