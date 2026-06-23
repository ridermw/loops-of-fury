// .loop/loop.mjs — multi-iteration orchestrator (safety-net). Control plane (D28).
//
// Wires the pure brain (brain.mjs) to the real iteration spine (driver.mjs):
//   preflight gate (D14) → repeated iteration() → brain.decide() → side effects.
//
// The brain owns every continue/retry/switch/stop/escalate decision; this file
// owns only the I/O around it: rendering the pre-flight fixtures, picking the
// next axis, and the escalation side effects (failures.jsonl + LOOP_STATUS +
// best-effort issue comment — all non-gating, D4).
//
// Modes:
//   --preflight   prove the gate fails broken.html; exit 0/1. No iterations.
//   --run         pre-flight, then loop until the brain says stop/escalate.
//
// Env (real run only):
//   LOOP_MAKER=copilot   use the real copilot maker (default: no-op maker).
//   LOOP_COMMIT=1        commit+push GREEN iterations (default: off — build/verify).
//   LOOP_MAX_ITERS=N     hard local cap on iterations (default: unlimited).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  LOOP, LOOP_DIR, LOOP_STATUS_FILE, RUN_FILE, SCOREBOARD_FILE,
} from './config.mjs';
import { iteration as realIteration } from './driver.mjs';
import { verify as verifyManifest } from './control-manifest.mjs';
import { withBrowser, renderDeck } from './render.mjs';
import { assertDeck } from './check.mjs';
import { noopMaker, copilotMaker } from './maker.mjs';
import { initState, shouldStartIteration, decide, categorize } from './brain.mjs';
import {
  defaultBoard, ensureAxes, pickAxis, recordPick, applyOutcome,
  loadBoard, saveBoard,
} from './scoreboard.mjs';
import {
  newRun, newUuid, beat, classifyExistingRun, finalizeStale, endRun,
  loadRun, saveRun,
} from './crash-safety.mjs';

const FAILURES_LOG = path.join(LOOP_DIR, 'failures.jsonl');
const LOOP_LOG = path.join(LOOP_DIR, 'loop.log');

const GOOD_FIXTURE = '.loop/tests/fixtures/good.html';
const BROKEN_FIXTURE = '.loop/tests/fixtures/broken.html';

function log(...a) { console.log('[loop]', ...a); }
function err(...a) { console.error('[loop]', ...a); }
function nowMs() { return Date.now(); }
function iso(ms) { return new Date(ms).toISOString(); }

function writeStatus(obj) {
  try { fs.writeFileSync(LOOP_STATUS_FILE, JSON.stringify(obj, null, 2) + '\n'); }
  catch { /* status is best-effort */ }
}
function appendJsonl(file, obj) {
  try { fs.appendFileSync(file, JSON.stringify(obj) + '\n'); }
  catch { /* logs are best-effort */ }
}

// Pre-flight (D14): the loop refuses to start unless the gate can actually FAIL
// a known-broken deck (and pass a known-good one). A blind checker is worse than
// no checker — it would wave broken decks straight onto main.
export async function preflight({ render = withBrowser } = {}) {
  if (!verifyManifest().ok) return { ok: false, reason: 'manifest-not-initialized' };
  let rendered;
  try {
    rendered = await render(async (browser) => ({
      good: await renderDeck(browser, GOOD_FIXTURE),
      broken: await renderDeck(browser, BROKEN_FIXTURE),
    }));
  } catch (e) {
    return { ok: false, reason: 'render-error', error: String(e && e.message ? e.message : e) };
  }
  const goodFail = assertDeck(rendered.good, 3);
  const brokenFail = assertDeck(rendered.broken, 2);
  if (goodFail.length) return { ok: false, reason: 'good-fixture-red', failures: goodFail };
  if (!brokenFail.length) return { ok: false, reason: 'gate-blind-to-broken' };
  return { ok: true, brokenFailures: brokenFail };
}

// Best-effort run-issue comment (D4 observability). Never gates, never throws.
function bestEffortIssueComment(body) {
  let issue = null;
  try { issue = JSON.parse(fs.readFileSync(RUN_FILE, 'utf8')).issue || null; } catch { /* none */ }
  if (!issue) return;
  try {
    spawnSync('gh', ['issue', 'comment', String(issue), '--body', body], {
      stdio: 'ignore', timeout: 15000,
    });
  } catch { /* observability is fire-and-forget */ }
}

// Core orchestration. Fully injectable so it is unit-testable with a scripted
// iteration() and a fake clock — no browser, no git, no credits.
export async function runLoop({
  iteration,
  makerFor,
  commitAndPush = false,
  loopCfg = LOOP,
  now = nowMs,
  startMs,
  scoreboard,
  persist = () => {},
  onIteration = () => {},
  onEscalate = () => {},
  maxIterations = Infinity,
} = {}) {
  const start = typeof startMs === 'number' ? startMs : now();
  let state = initState({
    startMs: start,
    maxDurationMs: loopCfg.maxDurationMs,
    maxNoops: loopCfg.maxNoops,
    retryK: loopCfg.retryK,
    churnWindowMs: loopCfg.churnWindowMs,
    churnMax: loopCfg.churnMax,
  });
  const axes = (loopCfg.axes && loopCfg.axes.length) ? loopCfg.axes : ['render'];
  // D10: pick the weakest axis each iteration from the persistent scoreboard,
  // instead of a blind round-robin. `forcedAxis` honors the brain's `retry`
  // decision — a retry stays on the SAME axis rather than re-selecting.
  const board = scoreboard || defaultBoard(axes);
  ensureAxes(board, axes);
  let forcedAxis = null;
  let ran = 0;
  const history = [];

  for (;;) {
    const gate = shouldStartIteration(state, now());
    if (!gate.start) { history.push({ event: 'stop-before', reason: gate.reason }); break; }
    if (ran >= maxIterations) { history.push({ event: 'max-iterations' }); break; }

    const axis = forcedAxis || pickAxis(board, axes) || axes[0];
    if (!forcedAxis) recordPick(board, axis);
    let outcome;
    try {
      outcome = await iteration({ commitAndPush, maker: makerFor(axis) });
    } catch (e) {
      outcome = { status: 'red', threw: true, failures: [String(e && e.message ? e.message : e)] };
    }
    ran += 1;

    const stepNow = now();
    const { state: next, decision } = decide(state, outcome, stepNow);
    state = next;

    applyOutcome(board, axis, categorize(outcome));
    persist(board);
    forcedAxis = decision.action === 'retry' ? axis : null;

    const record = {
      iter: state.iter, axis, status: outcome.status,
      action: decision.action, reason: decision.reason ?? null, ts: iso(stepNow),
    };
    history.push(record);
    onIteration(record, outcome, state);

    if (decision.action === 'escalate-stop') { onEscalate(record, outcome, state); break; }
    if (decision.action === 'stop') break;
  }

  return { state, history, board };
}

// Crash-safe run acquisition (D34). Reads the on-disk run record, classifies it,
// and either refuses to start (another live run) or claims a fresh identity —
// finalizing a crashed prior run so its issue is never silently inherited. Pure
// of side effects beyond the injected load/save; the GitHub issue close/open that
// 'finalize-stale' implies is performed by the (separate) issue-tracking step.
export function acquireRun({
  ttlMs = LOOP.heartbeatTtlMs,
  now = nowMs,
  uuid = newUuid(),
  load = () => loadRun(RUN_FILE),
  save = (r) => saveRun(RUN_FILE, r),
} = {}) {
  const at = now();
  const existing = load();
  const decision = classifyExistingRun(existing, { now: at, ttlMs, myUuid: uuid });

  if (decision.action === 'conflict') {
    return { ok: false, reason: 'run-conflict', decision, existing };
  }
  if (decision.action === 'resume') {
    beat(existing, at);
    save(existing);
    return { ok: true, run: existing, decision, resumed: true };
  }
  if (decision.action === 'finalize-stale') {
    // Stamp the dead run terminal so it is never re-adopted, then start fresh.
    finalizeStale(existing, at);
    save(existing);
  }
  const run = newRun({ uuid, now: at });
  save(run);
  return { ok: true, run, decision, finalizedStale: decision.action === 'finalize-stale' };
}

async function mainRun() {
  const pf = await preflight();
  if (!pf.ok) {
    err('PREFLIGHT FAILED:', pf.reason, pf.failures ? JSON.stringify(pf.failures) : '');
    writeStatus({ phase: 'preflight-failed', reason: pf.reason, ts: iso(nowMs()) });
    return 1;
  }
  log('preflight OK — gate fails broken.html');

  // D34: claim a crash-safe run identity. Refuse to start if another run is
  // still heartbeating; finalize a crashed prior run before taking over.
  const acq = acquireRun();
  if (!acq.ok) {
    err('RUN CONFLICT: another run is still alive —', JSON.stringify(acq.decision));
    writeStatus({ phase: 'run-conflict', decision: acq.decision, ts: iso(nowMs()) });
    return 1;
  }
  const run = acq.run;
  if (acq.finalizedStale) log('finalized crashed prior run:', acq.decision.staleUuid);
  log('run uuid:', run.uuid);

  const useCopilot = process.env.LOOP_MAKER === 'copilot';
  const commitAndPush = process.env.LOOP_COMMIT === '1';
  const maxIterations = Number(process.env.LOOP_MAX_ITERS) || Infinity;
  const makerFor = (axis) => (useCopilot
    ? () => copilotMaker({ axis, deck: 'index.html' })
    : noopMaker);

  log(`starting loop — maker=${useCopilot ? 'copilot' : 'noop'} commit=${commitAndPush} maxIters=${maxIterations}`);
  writeStatus({ phase: 'running', uuid: run.uuid, ts: iso(nowMs()) });

  const board = loadBoard(SCOREBOARD_FILE, LOOP.axes);

  const { state, history } = await runLoop({
    iteration: realIteration,
    makerFor,
    commitAndPush,
    maxIterations,
    scoreboard: board,
    persist: (b) => saveBoard(SCOREBOARD_FILE, b),
    onIteration: (rec) => {
      beat(run, nowMs(), { iter: true });
      saveRun(RUN_FILE, run);
      log('iter', JSON.stringify(rec));
      appendJsonl(LOOP_LOG, rec);
      writeStatus({ phase: 'running', uuid: run.uuid, last: rec, ts: iso(nowMs()) });
    },
    onEscalate: (rec, outcome) => {
      appendJsonl(FAILURES_LOG, { ...rec, outcome });
      writeStatus({ phase: 'escalated', uuid: run.uuid, reason: rec.reason, last: rec, ts: iso(nowMs()) });
      bestEffortIssueComment(`loop escalated: ${rec.reason} at iter ${rec.iter}`);
    },
  });

  const reason = state.stop ? state.stop.reason : 'ended';
  endRun(run, nowMs(), { status: state.escalated ? 'escalated' : 'ended' });
  saveRun(RUN_FILE, run);
  writeStatus({
    phase: state.escalated ? 'escalated' : 'done',
    reason, uuid: run.uuid, iters: state.iter, ts: iso(nowMs()),
  });
  log('loop end:', reason, 'iters=', state.iter, 'escalated=', Boolean(state.escalated));
  return state.escalated ? 1 : 0;
}

async function main(argv) {
  const flag = argv[0];
  if (flag === '--preflight') {
    const pf = await preflight();
    log('preflight:', JSON.stringify(pf));
    return pf.ok ? 0 : 1;
  }
  if (flag === '--run') return mainRun();
  err('usage: node .loop/loop.mjs [--preflight|--run]');
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => { err('ERROR —', e && e.stack ? e.stack : e); process.exit(2); });
}
