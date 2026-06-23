// .loop/scoreboard.mjs — weakest-axis scoreboard (D10). Control plane (D28).
//
// Persistent record of how each improvement axis is faring so the loop always
// spends its next iteration on the WEAKEST axis (lowest score), ties broken
// round-robin (least-recently-picked first). The selection RULE lives in the
// pure brain (brain.selectAxis); this module owns the board's shape, the
// score-update policy, and load/save IO.
//
// Board shape (committed loop data, D5 — like ledger.json/run.json):
//   { seq: <monotonic pick counter>,
//     axes: { <axis>: { score, lastPicked, samples } } }
//
//   score      — higher = healthier / less weak; the LOWEST score is picked next.
//   lastPicked — value of `seq` when this axis was last selected (tiebreak only).
//   samples    — how many iterations have scored this axis (observability).
//
// scoreboard.json is mutated every iteration, so it is EXCLUDED from the control
// manifest (control-manifest.mjs EXCLUDE_FILES) — otherwise a legitimate score
// update would read as control-plane drift and abort the run.
import fs from 'node:fs';
import { selectAxis } from './brain.mjs';

export function defaultEntry() {
  return { score: 0, lastPicked: 0, samples: 0 };
}

export function defaultBoard(axes = []) {
  const board = { seq: 0, axes: {} };
  for (const a of axes) board.axes[a] = defaultEntry();
  return board;
}

// Guarantee every configured axis exists on the board. A newly-added axis starts
// at score 0, so it sorts to the front and gets attention first. Returns board.
export function ensureAxes(board, axes = []) {
  if (!board.axes || typeof board.axes !== 'object') board.axes = {};
  for (const a of axes) if (!board.axes[a]) board.axes[a] = defaultEntry();
  return board;
}

// Pick the weakest CONFIGURED axis. Only configured axes are considered, so a
// stale axis lingering on the board is never selected after it's removed.
export function pickAxis(board, axes = []) {
  ensureAxes(board, axes);
  const view = {};
  for (const a of axes) view[a] = board.axes[a];
  return selectAxis(view);
}

// Stamp an axis as just-picked. Uses a monotonic seq (not wall-clock) so the
// round-robin ordering is exact regardless of clock resolution.
export function recordPick(board, axis) {
  board.seq = (board.seq ?? 0) + 1;
  ensureAxes(board, [axis]);
  board.axes[axis].lastPicked = board.seq;
  return board;
}

// Interim score policy until the per-axis numeric scorers (visual-regression /
// hygiene / delight) land: a verified improvement on an axis raises its score
// (less weak now); a no-op or revert leaves it (still weak → keeps attention).
// The Tier-2 scorers feed real numeric deltas through `recordScore`.
export function scoreDelta(category) {
  switch (category) {
    case 'green':
    case 'green-dry':
      return 1;
    default:
      return 0;
  }
}

export function applyOutcome(board, axis, category) {
  ensureAxes(board, [axis]);
  const e = board.axes[axis];
  e.score += scoreDelta(category);
  e.samples += 1;
  return board;
}

// Direct numeric update hook for the future per-axis scorers.
export function recordScore(board, axis, delta) {
  ensureAxes(board, [axis]);
  board.axes[axis].score += delta;
  board.axes[axis].samples += 1;
  return board;
}

export function loadBoard(file, axes = []) {
  let board;
  try {
    board = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!board || typeof board !== 'object' || typeof board.axes !== 'object') {
      board = defaultBoard(axes);
    }
    if (typeof board.seq !== 'number') board.seq = 0;
  } catch {
    board = defaultBoard(axes);
  }
  return ensureAxes(board, axes);
}

export function saveBoard(file, board) {
  try { fs.writeFileSync(file, JSON.stringify(board, null, 2) + '\n'); }
  catch { /* board persistence is best-effort */ }
}
