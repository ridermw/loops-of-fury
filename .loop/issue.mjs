// .loop/issue.mjs — run-tracking GitHub issue lifecycle (D4 / D34). Control plane (D28).
//
// ONE open `loop-run` issue per run, used purely for observability (it NEVER gates):
//   - iteration 1 adopts the single open loop-run issue if one exists (crash re-entry,
//     D34) or creates a fresh one BEFORE commit #1 so every commit can carry a
//     non-closing `Refs: #N` trailer;
//   - a clean end posts a summary comment and closes the issue as completed;
//   - a failed/halted run adds the escalation label + a diagnostic comment and leaves
//     the issue OPEN.
//
// All GitHub I/O goes through an INJECTED `gh` runner (default: spawn `gh`). Every
// function is non-throwing and best-effort: observability must never crash the loop
// or block a push. The runner inherits process.env, so the live run authenticates as
// whatever GH_TOKEN the loop was launched with (the owner-gated `ridermw` token).
import { run as procRun } from './lib/proc.mjs';
import { REPO_SLUG, ISSUE } from './config.mjs';

const ghDefault = (args, opts = {}) => procRun('gh', args, { timeout: 20000, ...opts });

// Idempotently ensure the loop-run + escalation labels exist. `--force` updates an
// existing label in place and creates a missing one, so this is safe to call every run.
export function ensureLabels({ gh = ghDefault } = {}) {
  const labels = [
    [ISSUE.label, ISSUE.labelColor, 'Autonomous deck self-improvement run (heartbeat)'],
    [ISSUE.escalationLabel, ISSUE.escalationColor, 'Loop run halted / needs attention'],
  ];
  for (const [name, color, desc] of labels) {
    gh(['label', 'create', name, '--repo', REPO_SLUG, '--color', color,
      '--description', desc, '--force']);
  }
}

// The single open loop-run issue number, or null. Enforces the single-open invariant
// at adoption time: if more than one is open we take the most recent and move on
// (observability tolerates it; we never block on it).
export function findOpenRunIssue({ gh = ghDefault } = {}) {
  const r = gh(['issue', 'list', '--repo', REPO_SLUG, '--label', ISSUE.label,
    '--state', 'open', '--json', 'number', '--limit', '5']);
  if (!r.ok) return null;
  try {
    const arr = JSON.parse(r.stdout);
    if (!Array.isArray(arr) || !arr.length) return null;
    return arr.map((x) => x.number).sort((a, b) => b - a)[0];
  } catch { return null; }
}

export function issueTitle(startedAt) {
  const day = new Date(startedAt || Date.now()).toISOString().slice(0, 10);
  return `${ISSUE.titlePrefix} — ${day}`;
}

export function issueBody({ uuid, snapshotSha, startedAt } = {}) {
  return [
    'Autonomous loop run tracking issue (created by the driver, not a human).',
    '',
    `- run uuid: \`${uuid || 'unknown'}\``,
    `- pre-run snapshot: \`${snapshotSha || 'unknown'}\``,
    `- started: ${startedAt ? new Date(startedAt).toISOString() : 'unknown'}`,
    '',
    'Every commit from this run references this issue with a non-closing `Refs: #N`',
    'trailer. This issue is closed as completed on a clean end; a failed or halted',
    'run leaves it open with the `' + ISSUE.escalationLabel + '` label and a diagnosis.',
  ].join('\n');
}

// Parse an issue number out of `gh issue create` output (it prints the issue URL).
function parseIssueNumber(stdout) {
  const m = String(stdout || '').match(/\/issues\/(\d+)\b/);
  return m ? Number(m[1]) : null;
}

// Create a fresh loop-run issue; returns its number or null on failure.
export function createRunIssue({ uuid, snapshotSha, startedAt, gh = ghDefault } = {}) {
  ensureLabels({ gh });
  const r = gh(['issue', 'create', '--repo', REPO_SLUG, '--label', ISSUE.label,
    '--title', issueTitle(startedAt),
    '--body', issueBody({ uuid, snapshotSha, startedAt })]);
  if (!r.ok) return null;
  return parseIssueNumber(r.stdout);
}

// Adopt-or-create the run's issue and stamp it into the run record (mutates `run`).
// Returns the issue number (or null if GitHub was unreachable — the run still
// proceeds, just without a `Refs:` target). Never throws.
export function ensureRunIssue(run, { gh = ghDefault } = {}) {
  if (run && run.issue) return run.issue;            // resume / re-entry: keep the adopted issue
  const existing = findOpenRunIssue({ gh });
  if (existing) { if (run) run.issue = existing; return existing; }
  const num = createRunIssue({
    uuid: run && run.uuid, snapshotSha: run && run.snapshotSha,
    startedAt: run && (run.startedAt || run.startedMs), gh,
  });
  if (run) run.issue = num || null;
  return num;
}

export function commentIssue(issue, body, { gh = ghDefault } = {}) {
  if (!issue) return false;
  const r = gh(['issue', 'comment', String(issue), '--repo', REPO_SLUG, '--body', body]);
  return r.ok;
}

// Clean end: post a summary and close as completed.
export function closeRunIssueClean(issue, summary, { gh = ghDefault } = {}) {
  if (!issue) return false;
  if (summary) commentIssue(issue, summary, { gh });
  const r = gh(['issue', 'close', String(issue), '--repo', REPO_SLUG,
    '--reason', 'completed']);
  return r.ok;
}

// Failure / halt: add the escalation label + diagnosis and LEAVE THE ISSUE OPEN.
export function escalateRunIssue(issue, diagnosis, { gh = ghDefault } = {}) {
  if (!issue) return false;
  gh(['issue', 'edit', String(issue), '--repo', REPO_SLUG,
    '--add-label', ISSUE.escalationLabel]);
  if (diagnosis) commentIssue(issue, diagnosis, { gh });
  return true; // left open by design
}
