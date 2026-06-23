// .loop/tests/crash-safety.test.mjs — run identity + heartbeat + finalizer (D34).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  newRun, beat, isStale, classifyExistingRun, finalizeStale, endRun,
  loadRun, saveRun,
} from '../crash-safety.mjs';
import { acquireRun } from '../loop.mjs';

const TTL = 15 * 60 * 1000;

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'run-')), 'run.json');
}

test('newRun is a running record heartbeating at start', () => {
  const r = newRun({ uuid: 'u1', now: 1000, issue: 42 });
  assert.equal(r.uuid, 'u1');
  assert.equal(r.status, 'running');
  assert.equal(r.startedMs, 1000);
  assert.equal(r.heartbeatMs, 1000);
  assert.equal(r.iters, 0);
  assert.equal(r.issue, 42);
});

test('newRun defaults issue to null (field preserved for readIssueNumber)', () => {
  const r = newRun({ uuid: 'u1', now: 0 });
  assert.equal(r.issue, null);
});

test('beat refreshes heartbeat and can bump the iter counter', () => {
  const r = newRun({ uuid: 'u1', now: 1000 });
  beat(r, 2000);
  assert.equal(r.heartbeatMs, 2000);
  assert.equal(r.iters, 0, 'no iter bump unless requested');
  beat(r, 3000, { iter: true });
  assert.equal(r.heartbeatMs, 3000);
  assert.equal(r.iters, 1);
});

test('isStale: running + heartbeat older than TTL is stale', () => {
  const r = newRun({ uuid: 'u1', now: 0 });
  assert.equal(isStale(r, TTL + 1, TTL), true);
  assert.equal(isStale(r, TTL, TTL), false, 'exactly TTL is not yet stale');
});

test('isStale: a fresh heartbeat is never stale', () => {
  const r = newRun({ uuid: 'u1', now: 1000 });
  beat(r, 1_000_000);
  assert.equal(isStale(r, 1_000_500, TTL), false);
});

test('isStale: terminal records are never stale', () => {
  const r = endRun(newRun({ uuid: 'u1', now: 0 }), 0);
  assert.equal(isStale(r, 10 * TTL, TTL), false);
});

test('isStale: a record with no heartbeat cannot prove it is alive', () => {
  assert.equal(isStale({ status: 'running', uuid: 'u1' }, 0, TTL), true);
});

test('classify: no prior record → start-fresh', () => {
  assert.equal(classifyExistingRun(null, { now: 0, ttlMs: TTL }).action, 'start-fresh');
  assert.equal(classifyExistingRun({}, { now: 0, ttlMs: TTL }).action, 'start-fresh');
});

test('classify: a cleanly ended prior run → start-fresh', () => {
  const ended = endRun(newRun({ uuid: 'old', now: 0 }), 1000);
  const d = classifyExistingRun(ended, { now: 2000, ttlMs: TTL, myUuid: 'me' });
  assert.equal(d.action, 'start-fresh');
  assert.equal(d.priorStatus, 'ended');
});

test('classify: our own uuid → resume', () => {
  const mine = newRun({ uuid: 'me', now: 0 });
  const d = classifyExistingRun(mine, { now: 1000, ttlMs: TTL, myUuid: 'me' });
  assert.equal(d.action, 'resume');
  assert.equal(d.uuid, 'me');
});

test('classify: a DIFFERENT running run with a dead heartbeat → finalize-stale (never adopt)', () => {
  const dead = newRun({ uuid: 'old', now: 0, issue: 7 });
  const d = classifyExistingRun(dead, { now: TTL + 1, ttlMs: TTL, myUuid: 'me' });
  assert.equal(d.action, 'finalize-stale');
  assert.equal(d.staleUuid, 'old');
  assert.equal(d.staleIssue, 7, 'carries the dead issue so the caller can close it');
});

test('classify: a DIFFERENT running run still heartbeating → conflict (refuse)', () => {
  const alive = newRun({ uuid: 'other', now: 0, issue: 9 });
  beat(alive, TTL); // fresh enough at now=TTL
  const d = classifyExistingRun(alive, { now: TTL + 1, ttlMs: TTL, myUuid: 'me' });
  assert.equal(d.action, 'conflict');
  assert.equal(d.aliveUuid, 'other');
  assert.equal(d.aliveIssue, 9);
});

test('finalizeStale and endRun stamp terminal status', () => {
  const a = finalizeStale(newRun({ uuid: 'u', now: 0 }), 5);
  assert.equal(a.status, 'stale-finalized');
  assert.equal(a.finalizedMs, 5);
  const b = endRun(newRun({ uuid: 'u', now: 0 }), 5, { status: 'escalated' });
  assert.equal(b.status, 'escalated');
  assert.equal(b.endedMs, 5);
});

test('loadRun returns null when missing or corrupt; save/load roundtrips', () => {
  const f = tmpFile();
  assert.equal(loadRun(path.join(os.tmpdir(), 'nope-' + Date.now() + '.json')), null);
  fs.writeFileSync(f, '{ broken');
  assert.equal(loadRun(f), null);
  const r = newRun({ uuid: 'u', now: 1234, issue: 3 });
  saveRun(f, r);
  assert.deepEqual(loadRun(f), r);
});

// --- acquireRun integration (injected load/save/now/uuid — no real fs) -------

test('acquireRun with no prior run claims a fresh identity and persists it', () => {
  let saved = null;
  const res = acquireRun({
    ttlMs: TTL, now: () => 1000, uuid: 'me',
    load: () => null, save: (r) => { saved = r; },
  });
  assert.equal(res.ok, true);
  assert.equal(res.run.uuid, 'me');
  assert.equal(res.run.status, 'running');
  assert.equal(saved.uuid, 'me');
});

test('acquireRun finalizes a crashed prior run, never inheriting its issue', () => {
  const dead = newRun({ uuid: 'old', now: 0, issue: 7 });
  const saves = [];
  const res = acquireRun({
    ttlMs: TTL, now: () => TTL + 1, uuid: 'me',
    load: () => dead, save: (r) => saves.push(JSON.parse(JSON.stringify(r))),
  });
  assert.equal(res.ok, true);
  assert.equal(res.finalizedStale, true);
  assert.equal(saves.length, 2, 'finalized stale record + fresh run both persisted');
  assert.equal(saves[0].uuid, 'old');
  assert.equal(saves[0].status, 'stale-finalized');
  assert.equal(res.run.uuid, 'me');
  assert.equal(res.run.issue, null, 'fresh run never adopts the dead run issue (7)');
});

test('acquireRun refuses to start when another run is still alive', () => {
  const alive = beat(newRun({ uuid: 'other', now: 0, issue: 9 }), TTL);
  let saved = false;
  const res = acquireRun({
    ttlMs: TTL, now: () => TTL + 1, uuid: 'me',
    load: () => alive, save: () => { saved = true; },
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'run-conflict');
  assert.equal(res.decision.aliveUuid, 'other');
  assert.equal(saved, false, 'must not overwrite a live run record');
});

test('acquireRun resumes its own record and bumps the heartbeat', () => {
  const mine = newRun({ uuid: 'me', now: 0 });
  let saved = null;
  const res = acquireRun({
    ttlMs: TTL, now: () => 5000, uuid: 'me',
    load: () => mine, save: (r) => { saved = r; },
  });
  assert.equal(res.ok, true);
  assert.equal(res.resumed, true);
  assert.equal(res.run.heartbeatMs, 5000);
  assert.equal(saved.uuid, 'me');
});
