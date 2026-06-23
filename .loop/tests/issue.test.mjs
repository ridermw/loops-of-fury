// .loop/tests/issue.test.mjs — run-tracking issue lifecycle (D4 / D34).
// The `gh` runner is an injected seam; every test mocks it deterministically and
// NEVER touches GitHub. Focus: adopt-vs-create, single-open invariant, label
// idempotency, URL number parsing, close-as-completed, escalate-leaves-open.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REPO_SLUG, ISSUE } from '../config.mjs';
import {
  ensureLabels, findOpenRunIssue, issueTitle, createRunIssue, ensureRunIssue,
  commentIssue, closeRunIssueClean, escalateRunIssue,
} from '../issue.mjs';

// Mock gh runner: records every argv and returns scripted results by matcher.
function mockGh(handler) {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    const r = handler ? handler(args, calls) : null;
    return r || { ok: true, stdout: '', stderr: '', code: 0 };
  };
  gh.calls = calls;
  return gh;
}
const is = (args, ...parts) => parts.every((p, i) => args[i] === p);

// ── ensureLabels ─────────────────────────────────────────────────────────────

test('ensureLabels: creates BOTH labels idempotently with --force', () => {
  const gh = mockGh();
  ensureLabels({ gh });
  const creates = gh.calls.filter((a) => is(a, 'label', 'create'));
  assert.equal(creates.length, 2);
  assert.equal(creates[0][2], ISSUE.label);
  assert.equal(creates[1][2], ISSUE.escalationLabel);
  for (const a of creates) {
    assert.ok(a.includes('--force'));
    assert.ok(a.includes('--repo') && a.includes(REPO_SLUG));
  }
});

// ── findOpenRunIssue ─────────────────────────────────────────────────────────

test('findOpenRunIssue: null when no open issues', () => {
  const gh = mockGh(() => ({ ok: true, stdout: '[]' }));
  assert.equal(findOpenRunIssue({ gh }), null);
});

test('findOpenRunIssue: single-open invariant — returns the highest number', () => {
  const gh = mockGh(() => ({ ok: true, stdout: JSON.stringify([{ number: 7 }, { number: 19 }, { number: 12 }]) }));
  assert.equal(findOpenRunIssue({ gh }), 19);
});

test('findOpenRunIssue: null on non-ok gh and on unparseable stdout', () => {
  assert.equal(findOpenRunIssue({ gh: mockGh(() => ({ ok: false, stdout: '' })) }), null);
  assert.equal(findOpenRunIssue({ gh: mockGh(() => ({ ok: true, stdout: 'not json' })) }), null);
});

test('findOpenRunIssue: filters by loop-run label and open state', () => {
  const gh = mockGh(() => ({ ok: true, stdout: '[]' }));
  findOpenRunIssue({ gh });
  const a = gh.calls[0];
  assert.ok(a.includes('--label') && a.includes(ISSUE.label));
  assert.ok(a.includes('--state') && a.includes('open'));
});

// ── issueTitle / createRunIssue ──────────────────────────────────────────────

test('issueTitle: carries the pinned prefix and an ISO day', () => {
  const t = issueTitle(Date.UTC(2026, 5, 23));
  assert.ok(t.startsWith(ISSUE.titlePrefix));
  assert.ok(/\d{4}-\d{2}-\d{2}$/.test(t));
});

test('createRunIssue: parses the issue number out of the printed URL', () => {
  const gh = mockGh((a) => {
    if (is(a, 'issue', 'create')) {
      return { ok: true, stdout: `https://github.com/${REPO_SLUG}/issues/123\n` };
    }
    return { ok: true, stdout: '' };
  });
  assert.equal(createRunIssue({ uuid: 'u1', gh }), 123);
});

test('createRunIssue: null when gh create fails', () => {
  const gh = mockGh((a) => (is(a, 'issue', 'create') ? { ok: false, stdout: '' } : { ok: true, stdout: '' }));
  assert.equal(createRunIssue({ gh }), null);
});

test('createRunIssue: ensures labels first', () => {
  const gh = mockGh((a) => (is(a, 'issue', 'create')
    ? { ok: true, stdout: `https://github.com/${REPO_SLUG}/issues/5` } : { ok: true, stdout: '' }));
  createRunIssue({ gh });
  assert.ok(gh.calls.some((a) => is(a, 'label', 'create')));
});

// ── ensureRunIssue (adopt-or-create) ─────────────────────────────────────────

test('ensureRunIssue: resume — keeps an already-adopted issue, no create', () => {
  const gh = mockGh();
  const run = { uuid: 'u', issue: 42 };
  assert.equal(ensureRunIssue(run, { gh }), 42);
  assert.equal(run.issue, 42);
  assert.ok(!gh.calls.some((a) => is(a, 'issue', 'create')));
});

test('ensureRunIssue: adopts the single open issue when one exists', () => {
  const gh = mockGh((a) => {
    if (is(a, 'issue', 'list')) return { ok: true, stdout: JSON.stringify([{ number: 88 }]) };
    return { ok: true, stdout: '' };
  });
  const run = { uuid: 'u', issue: null };
  assert.equal(ensureRunIssue(run, { gh }), 88);
  assert.equal(run.issue, 88);
  assert.ok(!gh.calls.some((a) => is(a, 'issue', 'create')));
});

test('ensureRunIssue: creates a fresh issue when none is open', () => {
  const gh = mockGh((a) => {
    if (is(a, 'issue', 'list')) return { ok: true, stdout: '[]' };
    if (is(a, 'issue', 'create')) return { ok: true, stdout: `https://github.com/${REPO_SLUG}/issues/200` };
    return { ok: true, stdout: '' };
  });
  const run = { uuid: 'u', issue: null };
  assert.equal(ensureRunIssue(run, { gh }), 200);
  assert.equal(run.issue, 200);
});

test('ensureRunIssue: GitHub unreachable — null, no throw, run.issue stays null', () => {
  const gh = mockGh(() => ({ ok: false, stdout: '' }));
  const run = { uuid: 'u', issue: null };
  assert.equal(ensureRunIssue(run, { gh }), null);
  assert.equal(run.issue, null);
});

// ── comment / close / escalate ───────────────────────────────────────────────

test('commentIssue: false (no gh call) when issue is null', () => {
  const gh = mockGh();
  assert.equal(commentIssue(null, 'hi', { gh }), false);
  assert.equal(gh.calls.length, 0);
});

test('commentIssue: posts the body to the issue', () => {
  const gh = mockGh(() => ({ ok: true, stdout: '' }));
  assert.equal(commentIssue(9, 'progress', { gh }), true);
  const a = gh.calls[0];
  assert.ok(is(a, 'issue', 'comment', '9'));
  assert.ok(a.includes('progress'));
});

test('closeRunIssueClean: comments then closes with --reason completed', () => {
  const gh = mockGh(() => ({ ok: true, stdout: '' }));
  assert.equal(closeRunIssueClean(11, 'all green', { gh }), true);
  assert.ok(gh.calls.some((a) => is(a, 'issue', 'comment', '11') && a.includes('all green')));
  const close = gh.calls.find((a) => is(a, 'issue', 'close', '11'));
  assert.ok(close);
  assert.ok(close.includes('--reason') && close.includes('completed'));
});

test('closeRunIssueClean: false when issue null', () => {
  const gh = mockGh();
  assert.equal(closeRunIssueClean(null, 's', { gh }), false);
  assert.equal(gh.calls.length, 0);
});

test('escalateRunIssue: adds the escalation label + comment and LEAVES IT OPEN', () => {
  const gh = mockGh(() => ({ ok: true, stdout: '' }));
  assert.equal(escalateRunIssue(7, 'halted: bad', { gh }), true);
  const edit = gh.calls.find((a) => is(a, 'issue', 'edit', '7'));
  assert.ok(edit);
  assert.ok(edit.includes('--add-label') && edit.includes(ISSUE.escalationLabel));
  assert.ok(gh.calls.some((a) => is(a, 'issue', 'comment', '7')));
  // never closes
  assert.ok(!gh.calls.some((a) => is(a, 'issue', 'close')));
});

test('escalateRunIssue: false when issue null', () => {
  const gh = mockGh();
  assert.equal(escalateRunIssue(null, 'x', { gh }), false);
  assert.equal(gh.calls.length, 0);
});
