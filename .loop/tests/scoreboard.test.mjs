// .loop/tests/scoreboard.test.mjs — weakest-axis scoreboard (D10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  defaultEntry, defaultBoard, ensureAxes, pickAxis, recordPick,
  scoreDelta, applyOutcome, recordScore, loadBoard, saveBoard,
} from '../scoreboard.mjs';
import { runLoop } from '../loop.mjs';

const CFG = {
  maxDurationMs: 8 * 60 * 60 * 1000,
  maxNoops: 5,
  retryK: 3,
  churnWindowMs: 30 * 60 * 1000,
  churnMax: 6,
  axes: ['a', 'b'],
};

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-')), 'scoreboard.json');
}

test('defaultEntry is a fresh zeroed entry', () => {
  assert.deepEqual(defaultEntry(), { score: 0, lastPicked: 0, samples: 0 });
});

test('defaultBoard seeds every axis at zero', () => {
  const b = defaultBoard(['render', 'hygiene']);
  assert.equal(b.seq, 0);
  assert.deepEqual(Object.keys(b.axes), ['render', 'hygiene']);
  assert.deepEqual(b.axes.render, { score: 0, lastPicked: 0, samples: 0 });
});

test('ensureAxes adds missing axes and preserves existing', () => {
  const b = defaultBoard(['a']);
  b.axes.a.score = 5;
  ensureAxes(b, ['a', 'b']);
  assert.equal(b.axes.a.score, 5, 'existing entry untouched');
  assert.deepEqual(b.axes.b, { score: 0, lastPicked: 0, samples: 0 });
});

test('ensureAxes repairs a board with no axes object', () => {
  const b = { seq: 0 };
  ensureAxes(b, ['a']);
  assert.deepEqual(b.axes.a, { score: 0, lastPicked: 0, samples: 0 });
});

test('scoreDelta rewards only verified improvement', () => {
  assert.equal(scoreDelta('green'), 1);
  assert.equal(scoreDelta('green-dry'), 1);
  assert.equal(scoreDelta('noop'), 0);
  assert.equal(scoreDelta('revert'), 0);
  assert.equal(scoreDelta('control-drift'), 0);
  assert.equal(scoreDelta('unknown'), 0);
});

test('applyOutcome moves score by delta and always counts a sample', () => {
  const b = defaultBoard(['a']);
  applyOutcome(b, 'a', 'green');
  assert.deepEqual(b.axes.a, { score: 1, lastPicked: 0, samples: 1 });
  applyOutcome(b, 'a', 'revert');
  assert.deepEqual(b.axes.a, { score: 1, lastPicked: 0, samples: 2 });
});

test('recordScore applies an arbitrary numeric delta (future scorers)', () => {
  const b = defaultBoard(['a']);
  recordScore(b, 'a', 4);
  recordScore(b, 'a', -1);
  assert.deepEqual(b.axes.a, { score: 3, lastPicked: 0, samples: 2 });
});

test('recordPick advances a monotonic seq and stamps lastPicked', () => {
  const b = defaultBoard(['a', 'b']);
  recordPick(b, 'a');
  assert.equal(b.seq, 1);
  assert.equal(b.axes.a.lastPicked, 1);
  recordPick(b, 'b');
  assert.equal(b.seq, 2);
  assert.equal(b.axes.b.lastPicked, 2);
});

test('pickAxis picks the lowest score', () => {
  const b = defaultBoard(['a', 'b']);
  b.axes.a.score = 2;
  b.axes.b.score = 1;
  assert.equal(pickAxis(b, ['a', 'b']), 'b');
});

test('pickAxis breaks score ties by least-recently-picked (round-robin)', () => {
  const b = defaultBoard(['a', 'b']);
  b.axes.a.lastPicked = 5; // a picked more recently
  b.axes.b.lastPicked = 2;
  assert.equal(pickAxis(b, ['a', 'b']), 'b');
});

test('pickAxis surfaces a brand-new axis (score 0) ahead of a healthy one', () => {
  const b = defaultBoard(['a']);
  b.axes.a.score = 3;
  // 'c' is configured but not yet on the board → starts at 0 → picked first.
  assert.equal(pickAxis(b, ['a', 'c']), 'c');
});

test('pickAxis ignores stale axes no longer configured', () => {
  const b = defaultBoard(['a', 'stale']);
  b.axes.a.score = 9;
  b.axes.stale.score = -100; // would win if considered
  assert.equal(pickAxis(b, ['a']), 'a');
});

test('loadBoard returns a default board when the file is missing', () => {
  const f = path.join(os.tmpdir(), 'does-not-exist-' + Date.now() + '.json');
  const b = loadBoard(f, ['a', 'b']);
  assert.deepEqual(Object.keys(b.axes), ['a', 'b']);
  assert.equal(b.seq, 0);
});

test('loadBoard recovers from corrupt JSON', () => {
  const f = tmpFile();
  fs.writeFileSync(f, '{ not json');
  const b = loadBoard(f, ['a']);
  assert.deepEqual(b.axes.a, { score: 0, lastPicked: 0, samples: 0 });
});

test('save/load roundtrips and back-fills newly configured axes', () => {
  const f = tmpFile();
  const b = defaultBoard(['a']);
  b.axes.a.score = 7;
  recordPick(b, 'a');
  saveBoard(f, b);
  const loaded = loadBoard(f, ['a', 'b']);
  assert.equal(loaded.axes.a.score, 7);
  assert.equal(loaded.axes.a.lastPicked, 1);
  assert.deepEqual(loaded.axes.b, { score: 0, lastPicked: 0, samples: 0 });
});

// --- Integration through the real orchestrator ------------------------------

test('runLoop visits the weakest axis and round-robins as scores equalize', async () => {
  // Every iteration is a committed green → the picked axis gets +1, so the next
  // pick must move to the other (now-weaker) axis, then alternate.
  const board = defaultBoard(['a', 'b']);
  const { history } = await runLoop({
    iteration: async () => ({ status: 'green', committed: true }),
    makerFor: () => () => {},
    loopCfg: CFG,
    now: () => 1000,
    startMs: 0,
    scoreboard: board,
    maxIterations: 4,
  });
  const axes = history.filter((h) => h.axis).map((h) => h.axis);
  assert.deepEqual(axes, ['a', 'b', 'a', 'b']);
  assert.equal(board.axes.a.score, 2);
  assert.equal(board.axes.b.score, 2);
});

test('runLoop keeps the same axis across a retry, then moves on', async () => {
  // 2 reverts (below retryK=3) → brain says retry → same axis sticks; then a
  // green frees it and the next pick moves to the other axis.
  const board = defaultBoard(['a', 'b']);
  const outcomes = [
    { status: 'red' }, { status: 'red' }, { status: 'green', committed: true },
    { status: 'green', committed: true },
  ];
  let i = 0;
  const { history } = await runLoop({
    iteration: async () => outcomes[i++],
    makerFor: () => () => {},
    loopCfg: CFG,
    now: () => 1000,
    startMs: 0,
    scoreboard: board,
    maxIterations: 4,
  });
  const axes = history.filter((h) => h.axis).map((h) => h.axis);
  assert.deepEqual(axes, ['a', 'a', 'a', 'b']);
});

test('runLoop persists the board after every iteration', async () => {
  const board = defaultBoard(['a', 'b']);
  let saves = 0;
  await runLoop({
    iteration: async () => ({ status: 'green', committed: true }),
    makerFor: () => () => {},
    loopCfg: CFG,
    now: () => 1000,
    startMs: 0,
    scoreboard: board,
    persist: () => { saves += 1; },
    maxIterations: 3,
  });
  assert.equal(saves, 3);
});
