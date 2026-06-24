// .loop/intake.mjs — user-directed task intake (loop-task issue queue). Control plane (D28).
//
// A capability layered ON TOP of the autonomous weakest-axis polish: the loop also works
// GitHub issues a maintainer explicitly labels `loop-task`, oldest-first (with a
// `priority:high|low` label boost). The issue title+body becomes the maker instruction.
//
// CRUCIAL SAFETY POSTURE: a task iteration runs through the EXACT SAME gated spine as a
// polish iteration (diff-gate + control-manifest + secret-scan + anchors + visual +
// headless render + live-Pages verify). Intake adds NO new path to `main`; it only
// chooses WHAT the maker is asked to do. The loop can therefore only LAND deck-content
// asks that fit the objective floor (no new/removed slides, headings & citations
// preserved, :root tokens frozen). An ask needing a structural/visual change is
// gate-blocked → the issue is left OPEN with a `loop-needs-review` note for a human.
//
// All decision logic is PURE (parsePriority/selectTask); all GitHub I/O goes through an
// INJECTED `gh` runner (default: spawn `gh`), is non-throwing, and is best-effort —
// queue management must never crash the loop or block a push.
import { run as procRun } from './lib/proc.mjs';
import { REPO_SLUG, INTAKE } from './config.mjs';
import { commentIssue } from './issue.mjs';

const ghDefault = (args, opts = {}) => procRun('gh', args, { timeout: 20000, ...opts });

// --- pure: label helpers + priority + selection ---------------------------------

// Normalize a labels array (gh returns objects `{name,...}`; tests may pass strings)
// to a flat array of lowercase-trimmed name strings.
export function labelNames(labels = []) {
  return (labels || []).map((l) => String(typeof l === 'string' ? l : (l && l.name) || '').trim());
}

export function hasLabel(task, label) {
  return labelNames(task && task.labels).some((n) => n.toLowerCase() === String(label).toLowerCase());
}

// Lower number = sooner. A `priority:high` (or `p0`/`high-priority`) label floats a task
// to the front; `low`/`p2` sinks it; anything else is normal priority. Pure.
export function parsePriority(labels = []) {
  const names = labelNames(labels).map((n) => n.toLowerCase());
  if (names.some((n) => n === 'priority:high' || n === 'high-priority' || n === 'p0')) return 0;
  if (names.some((n) => n === 'priority:low' || n === 'low-priority' || n === 'p2')) return 2;
  return 1;
}

// Choose the next task: skip anything already flagged `needs-review` (the loop tried and a
// human owns it now), then order by (priority asc, createdAt asc, number asc) — FIFO
// within a priority. Pure: takes the open-task list, returns one task or null.
export function selectTask(issues = [], { needsReviewLabel = INTAKE.needsReviewLabel } = {}) {
  const eligible = (issues || []).filter((t) => t && typeof t.number === 'number'
    && !hasLabel(t, needsReviewLabel));
  if (!eligible.length) return null;
  const keyed = eligible.map((t) => ({
    t,
    prio: parsePriority(t.labels),
    created: Date.parse(t.createdAt || t.created_at || '') || 0,
    number: t.number,
  }));
  keyed.sort((a, b) => (a.prio - b.prio) || (a.created - b.created) || (a.number - b.number));
  return keyed[0].t;
}

// --- io: label + queue management (injected, non-throwing) ----------------------

// Idempotently ensure the intake labels exist (safe to call every run via --force).
export function ensureTaskLabels({ gh = ghDefault } = {}) {
  const labels = [
    [INTAKE.taskLabel, INTAKE.taskColor, 'User-directed deck task for the autonomous loop'],
    [INTAKE.doneLabel, INTAKE.doneColor, 'Loop landed this task on main'],
    [INTAKE.needsReviewLabel, INTAKE.needsReviewColor,
      'Loop could not satisfy this within its safety gates'],
  ];
  for (const [name, color, desc] of labels) {
    gh(['label', 'create', name, '--repo', REPO_SLUG, '--color', color,
      '--description', desc, '--force']);
  }
}

// List open loop-task issues (labels normalized to name strings). Returns [] on any error.
export function listOpenTasks({ gh = ghDefault } = {}) {
  const r = gh(['issue', 'list', '--repo', REPO_SLUG, '--label', INTAKE.taskLabel,
    '--state', 'open', '--json', 'number,title,body,labels,createdAt,url', '--limit', '50']);
  if (!r.ok) return [];
  try {
    const arr = JSON.parse(r.stdout);
    if (!Array.isArray(arr)) return [];
    return arr.map((t) => ({
      number: t.number,
      title: t.title || '',
      body: t.body || '',
      url: t.url || '',
      createdAt: t.createdAt || '',
      labels: labelNames(t.labels),
    }));
  } catch { return []; }
}

// A task landed: comment the deploying SHA, label it done, close as completed.
export function closeTaskDone(number, sha, summary, { gh = ghDefault } = {}) {
  if (!number) return false;
  if (summary) commentIssue(number, summary, { gh });
  gh(['issue', 'edit', String(number), '--repo', REPO_SLUG, '--add-label', INTAKE.doneLabel]);
  const r = gh(['issue', 'close', String(number), '--repo', REPO_SLUG, '--reason', 'completed']);
  return r.ok;
}

// The loop tried but the gates won't accept it: label needs-review, comment why, leave OPEN.
export function markTaskNeedsReview(number, reason, { gh = ghDefault } = {}) {
  if (!number) return false;
  gh(['issue', 'edit', String(number), '--repo', REPO_SLUG,
    '--add-label', INTAKE.needsReviewLabel]);
  if (reason) commentIssue(number, reason, { gh });
  return true; // left open by design
}

// --- orchestration: drain the queue using an INJECTED gated iteration ------------

// Work the open loop-task queue oldest-first, reusing the caller's gated iteration (the
// live-verified spine). Fully dependency-injected → unit-testable with a scripted
// iteration + fake clock, no gh/git/browser. Bounded three ways so it can never spin:
//   - `maxTasks` hard cap on issues worked per run;
//   - the overall run time budget (startMs + maxDurationMs);
//   - needs-review exclusion in selectTask (a task the loop can't satisfy is flagged and
//     skipped on the next listTasks), plus retryK attempts per task.
// Returns { results, worked }. Each result: { task, satisfied, outcome, attempts }.
export async function drainTaskQueue({
  iteration,                  // async ({commitAndPush, maker}) => outcome  (verifiedIteration)
  makerForTask,               // (task) => maker
  listTasks,                  // () => task[]
  selectNext = (tasks) => selectTask(tasks),
  onTaskResult = () => {},    // ({task, satisfied, outcome, attempts}) => void
  beat = () => {},
  log = () => {},
  now = () => Date.now(),
  startMs = now(),
  maxDurationMs = Infinity,
  retryK = INTAKE.retryK,
  maxTasks = INTAKE.maxTasksPerRun,
} = {}) {
  const results = [];
  let worked = 0;
  while (worked < maxTasks) {
    if (now() - startMs >= maxDurationMs) { log('time budget reached — stopping queue drain'); break; }
    const task = selectNext(listTasks());
    if (!task) break;
    log(`working task #${task.number}: ${task.title}`);
    const maker = makerForTask(task);
    let satisfied = false;
    let outcome = null;
    let attempts = 0;
    for (let attempt = 1; attempt <= retryK; attempt += 1) {
      if (now() - startMs >= maxDurationMs) break;
      attempts = attempt;
      // eslint-disable-next-line no-await-in-loop
      outcome = await iteration({ commitAndPush: true, maker });
      beat();
      if (outcome && outcome.status === 'green' && outcome.committed) { satisfied = true; break; }
      if (outcome && outcome.status === 'noop') break; // maker produced nothing → stop retrying
    }
    const res = { task, satisfied, outcome, attempts };
    results.push(res);
    try { onTaskResult(res); } catch (e) {
      log(`onTaskResult failed for #${task.number}: ${e && e.message ? e.message : e}`);
    }
    worked += 1;
  }
  return { results, worked };
}
