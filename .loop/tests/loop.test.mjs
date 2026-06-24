// .loop/tests/loop.test.mjs — orchestration wiring (brain ↔ driver) with a
// scripted iteration() and a fake clock. No browser, no git, no credits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLoop, liveDecision } from '../loop.mjs';

const cfg = (o = {}) => ({
  maxDurationMs: 1_000_000_000, maxNoops: 3, retryK: 3,
  churnWindowMs: 1_000_000, churnMax: 100, axes: ['a', 'b', 'c'], ...o,
});

// Scripted iteration: returns queued outcomes in order; repeats the last forever.
function scripted(seq) {
  let i = 0;
  const calls = [];
  return async (args) => {
    calls.push(args);
    const out = seq[Math.min(i, seq.length - 1)];
    i += 1;
    return out;
  };
}

test('stops with no-progress after maxNoops consecutive no-ops', async () => {
  const { state, history } = await runLoop({
    iteration: scripted([{ status: 'noop' }]),
    makerFor: () => () => {},
    loopCfg: cfg({ maxNoops: 3 }),
    now: () => 1,
    maxIterations: 50,
  });
  assert.equal(state.stop.reason, 'no-progress');
  assert.equal(state.iter, 3);
  assert.equal(history.at(-1).action, 'stop');
});

test('escalates on control-drift and fires onEscalate exactly once', async () => {
  let escalations = 0;
  const { state } = await runLoop({
    iteration: scripted([{ status: 'green', committed: true }, { status: 'control-drift' }]),
    makerFor: () => () => {},
    loopCfg: cfg(),
    now: () => 1,
    onEscalate: () => { escalations += 1; },
  });
  assert.equal(state.escalated, true);
  assert.equal(state.stop.reason, 'control-drift');
  assert.equal(escalations, 1);
});

test('retries reverts then switches axis after retryK', async () => {
  const axesSeen = [];
  await runLoop({
    iteration: scripted([
      { status: 'red' }, { status: 'red' }, { status: 'red' },
      { status: 'green', committed: true },
    ]),
    makerFor: () => () => {},
    loopCfg: cfg({ retryK: 3, maxNoops: 99 }),
    now: () => 1,
    maxIterations: 4,
    onIteration: (rec) => axesSeen.push(rec.axis),
  });
  // First three reverts stay on axis 'a'; the 3rd exhausts retries → switch to 'b'.
  assert.deepEqual(axesSeen, ['a', 'a', 'a', 'b']);
});

test('green rotates through axes each iteration', async () => {
  const axesSeen = [];
  await runLoop({
    iteration: scripted([{ status: 'green', committed: true }]),
    makerFor: () => () => {},
    loopCfg: cfg({ axes: ['a', 'b', 'c'] }),
    now: () => 1,
    maxIterations: 3,
    onIteration: (rec) => axesSeen.push(rec.axis),
  });
  assert.deepEqual(axesSeen, ['a', 'b', 'c']);
});

test('time cap prevents any iteration from starting', async () => {
  let called = 0;
  const { history } = await runLoop({
    iteration: async () => { called += 1; return { status: 'noop' }; },
    makerFor: () => () => {},
    loopCfg: cfg({ maxDurationMs: 100 }),
    startMs: 0,
    now: () => 100,
  });
  assert.equal(called, 0);
  assert.deepEqual(history, [{ event: 'stop-before', reason: 'time-cap' }]);
});

test('maxIterations guard halts an otherwise-green loop', async () => {
  let called = 0;
  const { history } = await runLoop({
    iteration: async () => { called += 1; return { status: 'green', committed: true }; },
    makerFor: () => () => {},
    loopCfg: cfg(),
    now: () => 1,
    maxIterations: 2,
  });
  assert.equal(called, 2);
  assert.equal(history.at(-1).event, 'max-iterations');
});

test('commitAndPush flag is threaded through to iteration()', async () => {
  let seen = null;
  await runLoop({
    iteration: async (args) => { seen = args.commitAndPush; return { status: 'noop' }; },
    makerFor: () => () => {},
    loopCfg: cfg({ maxNoops: 1 }),
    commitAndPush: true,
    now: () => 1,
  });
  assert.equal(seen, true);
});

// D29 (revised): live verify NEVER halts the run. These lock the pure decision so a
// regression can't re-introduce the iter-3 self-halt where Pages deploy latency reverted
// a good commit AND killed the run.
const G = { status: 'green', committed: true, sha: 'deadbeefcafe' };

test('liveDecision: live OK → pass (trust the green commit, no halt)', () => {
  const d = liveDecision(G, { ok: true });
  assert.equal(d.kind, 'pass');
  assert.equal('halt' in d, false);
});

test('liveDecision: SHA not observable (pause) → soft-pass, never revert, never halt', () => {
  const d = liveDecision(G, { ok: false, action: 'pause', reason: 'sha-not-observable' });
  assert.equal(d.kind, 'soft-pass');
  assert.equal(d.reason, 'sha-not-observable');
  assert.equal('halt' in d, false);
});

test('liveDecision: live-check error (thrown poll) → soft-pass, never halt', () => {
  const d = liveDecision(G, { ok: false, action: 'pause', reason: 'live-check-error' });
  assert.equal(d.kind, 'soft-pass');
  assert.equal(d.reason, 'live-check-error');
  assert.equal('halt' in d, false);
});

test('liveDecision: missing/undefined live result → soft-pass (fail safe, keep looping)', () => {
  const d = liveDecision(G, undefined);
  assert.equal(d.kind, 'soft-pass');
  assert.equal(d.reason, 'sha-not-observable');
  assert.equal('halt' in d, false);
});

test('liveDecision: live deck genuinely broken (revert) → revert, still no halt', () => {
  const d = liveDecision(G, { ok: false, action: 'revert', reason: 'live-broken' });
  assert.equal(d.kind, 'revert');
  assert.equal(d.reason, 'live-broken');
  assert.equal('halt' in d, false);
});
