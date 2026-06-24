// .loop/tests/intake.test.mjs — user-directed task intake (loop-task queue).
// Pure selection + bounded drain. No gh/git/browser: GitHub I/O is injected, the gated
// iteration is scripted, and the clock is faked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  labelNames, hasLabel, parsePriority, selectTask, drainTaskQueue,
} from '../intake.mjs';
import { buildTaskPrompt } from '../maker.mjs';

// --- labelNames / hasLabel ------------------------------------------------------

test('labelNames normalizes gh objects and bare strings, trims', () => {
  assert.deepEqual(labelNames([{ name: 'loop-task' }, 'priority:high', { name: ' x ' }]),
    ['loop-task', 'priority:high', 'x']);
  assert.deepEqual(labelNames(), []);
  assert.deepEqual(labelNames(null), []);
});

test('hasLabel is case-insensitive and shape-agnostic', () => {
  const t = { labels: [{ name: 'Loop-Task' }, 'Priority:High'] };
  assert.equal(hasLabel(t, 'loop-task'), true);
  assert.equal(hasLabel(t, 'priority:high'), true);
  assert.equal(hasLabel(t, 'loop-done'), false);
  assert.equal(hasLabel({}, 'x'), false);
});

// --- parsePriority --------------------------------------------------------------

test('parsePriority: high floats (0), low sinks (2), default normal (1)', () => {
  assert.equal(parsePriority(['priority:high']), 0);
  assert.equal(parsePriority(['high-priority']), 0);
  assert.equal(parsePriority(['p0']), 0);
  assert.equal(parsePriority([{ name: 'priority:low' }]), 2);
  assert.equal(parsePriority(['p2']), 2);
  assert.equal(parsePriority(['loop-task']), 1);
  assert.equal(parsePriority([]), 1);
});

test('parsePriority: high wins over low when both present', () => {
  assert.equal(parsePriority(['priority:low', 'priority:high']), 0);
});

// --- selectTask -----------------------------------------------------------------

test('selectTask: empty or all-ineligible → null', () => {
  assert.equal(selectTask([]), null);
  assert.equal(selectTask(), null);
  assert.equal(selectTask([{ number: 1, labels: ['loop-needs-review'] }]), null);
  assert.equal(selectTask([{ labels: [] }]), null); // no number → ineligible
});

test('selectTask: excludes needs-review-labeled tasks', () => {
  const tasks = [
    { number: 5, labels: ['loop-task', 'loop-needs-review'], createdAt: '2026-01-01T00:00:00Z' },
    { number: 9, labels: ['loop-task'], createdAt: '2026-02-01T00:00:00Z' },
  ];
  assert.equal(selectTask(tasks).number, 9);
});

test('selectTask: priority asc, then createdAt FIFO, then number', () => {
  const tasks = [
    { number: 30, labels: ['loop-task'], createdAt: '2026-01-03T00:00:00Z' },
    { number: 10, labels: ['loop-task', 'priority:high'], createdAt: '2026-01-05T00:00:00Z' },
    { number: 20, labels: ['loop-task'], createdAt: '2026-01-01T00:00:00Z' },
  ];
  // priority:high (#10) wins despite being newest
  assert.equal(selectTask(tasks).number, 10);
  // without the high one, oldest createdAt wins (#20 @ 01-01 over #30 @ 01-03)
  assert.equal(selectTask(tasks.filter((t) => t.number !== 10)).number, 20);
});

test('selectTask: equal priority + equal createdAt → lowest number breaks tie', () => {
  const tasks = [
    { number: 8, labels: ['loop-task'], createdAt: '2026-01-01T00:00:00Z' },
    { number: 3, labels: ['loop-task'], createdAt: '2026-01-01T00:00:00Z' },
  ];
  assert.equal(selectTask(tasks).number, 3);
});

// --- buildTaskPrompt ------------------------------------------------------------

test('buildTaskPrompt embeds title/body/deck and the hard rules', () => {
  const p = buildTaskPrompt({ title: 'Tighten the intro', body: 'Make slide 1 punchier.\nLess text.' }, 'index.html');
  assert.match(p, /index\.html/);
  assert.match(p, /Tighten the intro/);
  assert.match(p, /> Make slide 1 punchier\./); // body is quoted line-by-line
  assert.match(p, /> Less text\./);
  assert.match(p, /Edit ONLY index\.html/);
  assert.match(p, /Do not add or remove whole slides/);
  assert.match(p, /:root design-token block/);
  assert.match(p, /make NO change at all/);
});

test('buildTaskPrompt handles an empty body gracefully', () => {
  const p = buildTaskPrompt({ title: 'Just a title' }, 'workshop.html');
  assert.match(p, /Just a title/);
  assert.match(p, /no further detail provided/);
  assert.match(p, /workshop\.html/);
});

// --- drainTaskQueue: harness ----------------------------------------------------

// Build a scripted gated-iteration + a mutable queue. The test's onTaskResult mirrors
// production: a satisfied task is "closed" (removed) and a failed task is "needs-review"
// (also removed from the open list), so the queue terminates exactly as it would live.
function harness({ outcomes, queue, clock = { t: 0 }, removeOnResult = true }) {
  const calls = [];
  const beats = [];
  const seenMakers = [];
  let i = 0;
  const iteration = async ({ commitAndPush, maker }) => {
    calls.push({ commitAndPush, maker });
    seenMakers.push(maker);
    const o = typeof outcomes === 'function' ? outcomes(i, clock) : outcomes[Math.min(i, outcomes.length - 1)];
    i += 1;
    return o;
  };
  const q = [...queue];
  const listTasks = () => [...q];
  const removed = [];
  const onTaskResult = (res) => {
    removed.push(res);
    if (removeOnResult) {
      const idx = q.findIndex((t) => t.number === res.task.number);
      if (idx >= 0) q.splice(idx, 1);
    }
  };
  return {
    iteration,
    listTasks,
    onTaskResult,
    beat: () => beats.push(clock.t),
    now: () => clock.t,
    makerForTask: (task) => `maker-for-${task.number}`,
    calls,
    beats,
    removed,
    seenMakers,
    q,
  };
}

const A = { number: 1, title: 'A', labels: ['loop-task'], createdAt: '2026-01-01T00:00:00Z' };
const B = { number: 2, title: 'B', labels: ['loop-task'], createdAt: '2026-01-02T00:00:00Z' };

// --- drainTaskQueue: behavior ---------------------------------------------------

test('drain: green → satisfied in 1 attempt, maker threaded, beat once', async () => {
  const h = harness({ outcomes: [{ status: 'green', committed: true, sha: 'deadbeef0' }], queue: [A] });
  const r = await drainTaskQueue({
    iteration: h.iteration, makerForTask: h.makerForTask, listTasks: h.listTasks,
    onTaskResult: h.onTaskResult, beat: h.beat, now: h.now, maxDurationMs: Infinity,
    retryK: 3, maxTasks: 20,
  });
  assert.equal(r.worked, 1);
  assert.equal(r.results[0].satisfied, true);
  assert.equal(r.results[0].attempts, 1);
  assert.equal(r.results[0].outcome.sha, 'deadbeef0');
  assert.equal(h.calls[0].commitAndPush, true);            // task runs the committing spine
  assert.equal(h.seenMakers[0], 'maker-for-1');            // makerForTask(task) threaded in
  assert.equal(h.beats.length, 1);
});

test('drain: red every attempt → not satisfied, attempts == retryK, iteration called retryK times', async () => {
  const h = harness({ outcomes: [{ status: 'red' }], queue: [A] });
  const r = await drainTaskQueue({
    iteration: h.iteration, makerForTask: h.makerForTask, listTasks: h.listTasks,
    onTaskResult: h.onTaskResult, beat: h.beat, now: h.now, maxDurationMs: Infinity,
    retryK: 3, maxTasks: 20,
  });
  assert.equal(r.results[0].satisfied, false);
  assert.equal(r.results[0].attempts, 3);
  assert.equal(h.calls.length, 3);
  assert.equal(h.beats.length, 3);
});

test('drain: noop → early break at attempt 1 (maker correctly made no change)', async () => {
  const h = harness({ outcomes: [{ status: 'noop' }], queue: [A] });
  const r = await drainTaskQueue({
    iteration: h.iteration, makerForTask: h.makerForTask, listTasks: h.listTasks,
    onTaskResult: h.onTaskResult, beat: h.beat, now: h.now, maxDurationMs: Infinity,
    retryK: 3, maxTasks: 20,
  });
  assert.equal(r.results[0].satisfied, false);
  assert.equal(r.results[0].attempts, 1);
  assert.equal(h.calls.length, 1); // did not retry a deliberate noop
});

test('drain: gate-blocked (structural ask) → not satisfied → onTaskResult sees failing outcome', async () => {
  const h = harness({ outcomes: [{ status: 'gate-blocked', violations: ['slide-count'] }], queue: [A] });
  const r = await drainTaskQueue({
    iteration: h.iteration, makerForTask: h.makerForTask, listTasks: h.listTasks,
    onTaskResult: h.onTaskResult, beat: h.beat, now: h.now, maxDurationMs: Infinity,
    retryK: 2, maxTasks: 20,
  });
  assert.equal(r.results[0].satisfied, false);
  assert.equal(r.results[0].attempts, 2);
  assert.equal(h.removed[0].outcome.status, 'gate-blocked');
});

test('drain: processes multiple tasks FIFO until queue empties', async () => {
  // Both tasks land green; default selectTask FIFO → A then B.
  const h = harness({ outcomes: [{ status: 'green', committed: true, sha: 'abc' }], queue: [A, B] });
  const r = await drainTaskQueue({
    iteration: h.iteration, makerForTask: h.makerForTask, listTasks: h.listTasks,
    onTaskResult: h.onTaskResult, beat: h.beat, now: h.now, maxDurationMs: Infinity,
    retryK: 3, maxTasks: 20,
  });
  assert.equal(r.worked, 2);
  assert.deepEqual(r.results.map((x) => x.task.number), [1, 2]);
  assert.equal(h.q.length, 0);
});

test('drain: maxTasks caps an otherwise-infinite queue (boundedness)', async () => {
  // onTaskResult does NOT remove → selectTask would return A forever; cap must stop it.
  const h = harness({
    outcomes: [{ status: 'green', committed: true, sha: 'abc' }], queue: [A], removeOnResult: false,
  });
  const r = await drainTaskQueue({
    iteration: h.iteration, makerForTask: h.makerForTask, listTasks: h.listTasks,
    onTaskResult: h.onTaskResult, beat: h.beat, now: h.now, maxDurationMs: Infinity,
    retryK: 3, maxTasks: 3,
  });
  assert.equal(r.worked, 3);
});

test('drain: time budget halts the drain between tasks', async () => {
  const clock = { t: 0 };
  // First task lands green and pushes the clock past the budget.
  const h = harness({
    outcomes: () => { clock.t = 500; return { status: 'green', committed: true, sha: 'abc' }; },
    queue: [A, B], clock,
  });
  const r = await drainTaskQueue({
    iteration: h.iteration, makerForTask: h.makerForTask, listTasks: h.listTasks,
    onTaskResult: h.onTaskResult, beat: h.beat, now: h.now,
    startMs: 0, maxDurationMs: 100, retryK: 3, maxTasks: 20,
  });
  assert.equal(r.worked, 1); // second task never started — budget exhausted
});

test('drain: empty queue → worked 0, no iteration', async () => {
  const h = harness({ outcomes: [{ status: 'noop' }], queue: [] });
  const r = await drainTaskQueue({
    iteration: h.iteration, makerForTask: h.makerForTask, listTasks: h.listTasks,
    onTaskResult: h.onTaskResult, beat: h.beat, now: h.now, maxDurationMs: Infinity,
  });
  assert.equal(r.worked, 0);
  assert.equal(r.results.length, 0);
  assert.equal(h.calls.length, 0);
});

test('drain: selectNext returning null short-circuits even with a non-empty list', async () => {
  const h = harness({ outcomes: [{ status: 'green', committed: true, sha: 'abc' }], queue: [A, B] });
  const r = await drainTaskQueue({
    iteration: h.iteration, makerForTask: h.makerForTask, listTasks: h.listTasks,
    selectNext: () => null, onTaskResult: h.onTaskResult, beat: h.beat, now: h.now,
    maxDurationMs: Infinity,
  });
  assert.equal(r.worked, 0);
  assert.equal(h.calls.length, 0);
});

test('drain: an onTaskResult that throws does not abort the drain (stays bounded)', async () => {
  const h = harness({ outcomes: [{ status: 'green', committed: true, sha: 'abc' }], queue: [A] });
  const r = await drainTaskQueue({
    iteration: h.iteration, makerForTask: h.makerForTask, listTasks: h.listTasks,
    onTaskResult: () => { throw new Error('gh down'); },
    beat: h.beat, now: h.now, maxDurationMs: Infinity, retryK: 3, maxTasks: 3,
  });
  // A throwing result-handler (e.g. transient gh outage) must not reject the drain; the
  // task stays open and is simply re-attempted next pass, bounded by the maxTasks cap.
  assert.equal(r.worked, 3);
  assert.equal(r.results[0].satisfied, true);
});
