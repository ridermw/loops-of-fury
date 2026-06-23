// .loop/tests/brain.test.mjs — exhaustive unit tests for the pure loop brain.
// Run: node --test .loop/tests/   (or npm run loop:test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  categorize, initState, shouldStartIteration, decide, selectAxis,
} from '../brain.mjs';

const base = (o = {}) => initState({
  startMs: 0, maxDurationMs: 1000, maxNoops: 3, retryK: 3,
  churnWindowMs: 1000, churnMax: 6, ...o,
});

test('categorize maps every known status', () => {
  assert.equal(categorize({ status: 'green', committed: true }), 'green');
  assert.equal(categorize({ status: 'green', committed: false }), 'green-dry');
  assert.equal(categorize({ status: 'noop' }), 'noop');
  assert.equal(categorize({ status: 'red' }), 'revert');
  assert.equal(categorize({ status: 'gate-blocked' }), 'revert');
  assert.equal(categorize({ status: 'live-broken' }), 'revert');
  assert.equal(categorize({ status: 'control-drift' }), 'control-drift');
  assert.equal(categorize({ status: 'push-failed' }), 'ship-failed');
  assert.equal(categorize({ status: 'commit-failed' }), 'ship-failed');
  assert.equal(categorize({ status: 'weird' }), 'unknown');
  assert.equal(categorize(null), 'unknown');
});

test('shouldStartIteration blocks when stopped or past time cap', () => {
  assert.deepEqual(shouldStartIteration(base(), 0), { start: true });
  assert.deepEqual(shouldStartIteration(base(), 999), { start: true });
  assert.deepEqual(shouldStartIteration(base(), 1000), { start: false, reason: 'time-cap' });
  const stopped = { ...base(), stop: { reason: 'no-progress' } };
  assert.deepEqual(shouldStartIteration(stopped, 0), { start: false, reason: 'no-progress' });
});

test('green resets counters and continues with a fresh axis', () => {
  const s0 = { ...base(), consecutiveNoops: 2, consecutiveFailures: 2 };
  const { state, decision } = decide(s0, { status: 'green', committed: true }, 10);
  assert.equal(decision.action, 'continue');
  assert.equal(decision.switchAxis, true);
  assert.equal(state.consecutiveNoops, 0);
  assert.equal(state.consecutiveFailures, 0);
  assert.equal(state.greenCount, 1);
  assert.equal(state.iter, 1);
});

test('green-dry continues but does not increment greenCount', () => {
  const { state, decision } = decide(base(), { status: 'green', committed: false }, 10);
  assert.equal(decision.action, 'continue');
  assert.equal(state.greenCount, 0);
});

test('noops accumulate and trip the no-progress stop at maxNoops', () => {
  let s = base({ maxNoops: 3 });
  ({ state: s } = decide(s, { status: 'noop' }, 1));
  assert.equal(s.consecutiveNoops, 1);
  ({ state: s } = decide(s, { status: 'noop' }, 2));
  assert.equal(s.consecutiveNoops, 2);
  const { state, decision } = decide(s, { status: 'noop' }, 3);
  assert.equal(decision.action, 'stop');
  assert.equal(decision.reason, 'no-progress');
  assert.deepEqual(state.stop, { reason: 'no-progress' });
});

test('a green between noops resets the no-progress counter', () => {
  let s = base({ maxNoops: 2 });
  ({ state: s } = decide(s, { status: 'noop' }, 1));
  ({ state: s } = decide(s, { status: 'green', committed: true }, 2));
  assert.equal(s.consecutiveNoops, 0);
  const { decision } = decide(s, { status: 'noop' }, 3);
  assert.equal(decision.action, 'continue'); // only 1 noop again, no stop
});

test('control-drift escalates and stops immediately (D28)', () => {
  const { state, decision } = decide(base(), { status: 'control-drift' }, 5);
  assert.equal(decision.action, 'escalate-stop');
  assert.equal(decision.reason, 'control-drift');
  assert.equal(state.escalated, true);
  assert.deepEqual(state.stop, { reason: 'control-drift' });
});

test('ship-failed (push/commit) escalates and stops', () => {
  for (const status of ['push-failed', 'commit-failed']) {
    const { state, decision } = decide(base(), { status }, 5);
    assert.equal(decision.action, 'escalate-stop');
    assert.equal(decision.reason, status);
    assert.equal(state.escalated, true);
  }
});

test('reverts retry up to retryK then switch axis', () => {
  let s = base({ retryK: 3, churnMax: 100 });
  let d;
  ({ state: s, decision: d } = decide(s, { status: 'red' }, 1));
  assert.equal(d.action, 'retry');
  assert.equal(s.consecutiveFailures, 1);
  ({ state: s, decision: d } = decide(s, { status: 'red' }, 2));
  assert.equal(d.action, 'retry');
  assert.equal(s.consecutiveFailures, 2);
  ({ state: s, decision: d } = decide(s, { status: 'gate-blocked' }, 3));
  assert.equal(d.action, 'continue');
  assert.equal(d.switchAxis, true);
  assert.equal(d.reason, 'retry-exhausted');
  assert.equal(s.consecutiveFailures, 0); // reset after switching axis
});

test('revert-churn over the window cap escalates (D38)', () => {
  let s = base({ retryK: 100, churnMax: 2, churnWindowMs: 1000 });
  let d;
  ({ state: s, decision: d } = decide(s, { status: 'red' }, 100));
  assert.equal(d.action, 'retry'); // 1 in window, <= 2
  ({ state: s, decision: d } = decide(s, { status: 'red' }, 200));
  assert.equal(d.action, 'retry'); // 2 in window, <= 2
  ({ state: s, decision: d } = decide(s, { status: 'red' }, 300));
  assert.equal(d.action, 'escalate-stop'); // 3 > 2
  assert.equal(d.reason, 'revert-churn');
  assert.equal(s.escalated, true);
});

test('revert-churn window prunes stale reverts', () => {
  let s = base({ retryK: 100, churnMax: 2, churnWindowMs: 1000, maxDurationMs: 1_000_000 });
  let d;
  ({ state: s } = decide(s, { status: 'red' }, 0));
  ({ state: s } = decide(s, { status: 'red' }, 100));
  // Far in the future: the first two reverts fall outside the 1000ms window.
  ({ state: s, decision: d } = decide(s, { status: 'red' }, 5000));
  assert.equal(s.revertTimes.length, 1);
  assert.equal(d.action, 'retry'); // only 1 in window now
});

test('time cap converts a would-be continue into a stop', () => {
  const s = base({ maxDurationMs: 1000 });
  const { decision } = decide(s, { status: 'green', committed: true }, 1000);
  assert.equal(decision.action, 'stop');
  assert.equal(decision.reason, 'time-cap');
});

test('time cap does NOT override an escalation', () => {
  const s = base({ maxDurationMs: 1000 });
  const { decision } = decide(s, { status: 'control-drift' }, 5000);
  assert.equal(decision.action, 'escalate-stop');
  assert.equal(decision.reason, 'control-drift');
});

test('decide does not mutate the input state', () => {
  const s = base();
  Object.freeze(s);
  Object.freeze(s.revertTimes);
  assert.doesNotThrow(() => decide(s, { status: 'red' }, 1));
  assert.equal(s.iter, 0);
  assert.equal(s.revertTimes.length, 0);
});

test('selectAxis picks the lowest score', () => {
  const sb = {
    render: { score: 8, lastPicked: 1 },
    hygiene: { score: 3, lastPicked: 1 },
    delight: { score: 5, lastPicked: 1 },
  };
  assert.equal(selectAxis(sb), 'hygiene');
});

test('selectAxis breaks ties by oldest lastPicked (round-robin)', () => {
  const sb = {
    render: { score: 5, lastPicked: 30 },
    hygiene: { score: 5, lastPicked: 10 },
    delight: { score: 5, lastPicked: 20 },
  };
  assert.equal(selectAxis(sb), 'hygiene');
});

test('selectAxis handles empty and single', () => {
  assert.equal(selectAxis({}), null);
  assert.equal(selectAxis(null), null);
  assert.equal(selectAxis({ only: { score: 9, lastPicked: 0 } }), 'only');
});
