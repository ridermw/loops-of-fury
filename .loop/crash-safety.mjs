// .loop/crash-safety.mjs — run identity + heartbeat + stale-run finalizer (D34).
// Control plane (D28).
//
// An unattended 8-hour run can crash (power, OOM, killed shell). Without crash
// safety that leaves the run-issue (D4) open forever, and a NEW run could either
// (a) silently adopt the dead run's open issue — mis-attributing someone else's
// history to itself, or (b) start a SECOND concurrent loop that double-drives
// `main`. This module makes both impossible with three pure primitives:
//
//   run identity  — every run stamps a unique `uuid` into run.json.
//   heartbeat     — each iteration refreshes `heartbeatMs`; a run whose heartbeat
//                   is older than `ttlMs` is presumed dead.
//   classifier    — at startup, `classifyExistingRun()` decides start-fresh /
//                   resume / finalize-stale / conflict from the on-disk record.
//
// All decisions are PURE (injected clock + uuid); the side effects they imply
// (closing a stale issue, opening a fresh one) live in the push-dependent
// driver/loop wiring. Refusing to adopt a stale-uuid issue (D34) is encoded as
// the `finalize-stale` action: the caller finalizes the dead run's issue and
// opens its own — it never inherits an issue it didn't create.
//
// run.json is committed loop data (D5) but mutates every iteration, so it stays
// EXCLUDED from the control manifest (control-manifest.mjs).
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

export function newUuid() {
  return randomUUID();
}

// Fresh run record for THIS process. `issue` stays null until the (separate)
// issue-tracking step opens one; preserving the field keeps readIssueNumber()
// and bestEffortIssueComment() working unchanged.
export function newRun({ uuid = newUuid(), now = Date.now(), issue = null } = {}) {
  const iso = new Date(now).toISOString();
  return {
    uuid,
    status: 'running',
    startedMs: now,
    startedAt: iso,
    heartbeatMs: now,
    heartbeatAt: iso,
    iters: 0,
    issue,
  };
}

// Refresh the heartbeat (and optionally bump the iteration counter). Mutates and
// returns the record so the caller can persist it.
export function beat(run, now = Date.now(), { iter = false } = {}) {
  run.heartbeatMs = now;
  run.heartbeatAt = new Date(now).toISOString();
  if (iter) run.iters = (run.iters ?? 0) + 1;
  return run;
}

// A running record is stale once its heartbeat is older than the TTL. Ended /
// finalized records are never "stale" (they're already terminal).
export function isStale(run, now = Date.now(), ttlMs = 0) {
  if (!run || run.status !== 'running') return false;
  const hb = typeof run.heartbeatMs === 'number' ? run.heartbeatMs : run.startedMs;
  if (typeof hb !== 'number') return true; // no heartbeat → cannot prove alive
  return now - hb > ttlMs;
}

// Decide what to do about whatever run.json was found at startup.
//   start-fresh    — no/corrupt record, or the prior run ended cleanly.
//   resume         — the record is OURS (same uuid) — re-entrancy, adopt it.
//   finalize-stale — a DIFFERENT run was 'running' but its heartbeat is dead:
//                    finalize its issue, then start fresh (never adopt it).
//   conflict       — a DIFFERENT run is 'running' AND still heartbeating: another
//                    loop is alive; refuse to start a second driver of `main`.
export function classifyExistingRun(existing, { now = Date.now(), ttlMs = 0, myUuid = null } = {}) {
  if (!existing || typeof existing !== 'object' || !existing.uuid) {
    return { action: 'start-fresh', reason: 'no-prior-run' };
  }
  if (existing.status !== 'running') {
    return { action: 'start-fresh', reason: 'prior-ended', priorStatus: existing.status };
  }
  if (myUuid && existing.uuid === myUuid) {
    return { action: 'resume', uuid: existing.uuid, issue: existing.issue ?? null };
  }
  if (isStale(existing, now, ttlMs)) {
    return {
      action: 'finalize-stale',
      staleUuid: existing.uuid,
      staleIssue: existing.issue ?? null,
      lastBeatMs: existing.heartbeatMs ?? existing.startedMs ?? null,
    };
  }
  return {
    action: 'conflict',
    aliveUuid: existing.uuid,
    aliveIssue: existing.issue ?? null,
    lastBeatMs: existing.heartbeatMs ?? existing.startedMs ?? null,
  };
}

// Mark a crashed prior run terminal so it is never re-classified as stale again.
export function finalizeStale(run, now = Date.now()) {
  run.status = 'stale-finalized';
  run.finalizedMs = now;
  run.finalizedAt = new Date(now).toISOString();
  return run;
}

// Clean end of OUR run.
export function endRun(run, now = Date.now(), { status = 'ended' } = {}) {
  run.status = status;
  run.endedMs = now;
  run.endedAt = new Date(now).toISOString();
  return run;
}

export function loadRun(file) {
  try {
    const r = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (r && typeof r === 'object') ? r : null;
  } catch {
    return null;
  }
}

export function saveRun(file, run) {
  try { fs.writeFileSync(file, JSON.stringify(run, null, 2) + '\n'); }
  catch { /* run heartbeat is best-effort on disk */ }
}
