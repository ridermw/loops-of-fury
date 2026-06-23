// .loop/tests/anchors.test.mjs — proves the objective content-anchor floor (D32).
// The floor is STRUCTURAL + ATTRIBUTION, never lexical:
//   - heading COUNT must not regress (no section emptied/deleted)
//   - citation SET must stay a superset (no source silently dropped)
//   - heading WORDING may change freely (the loop's mandate) — reworded headings
//     at equal count must NOT gate, or the loop would thrash main (D38).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normHeading, headingKey, normCitation, diffAnchors, anchorFailures,
} from '../anchors.mjs';
import { assertDeck } from '../check.mjs';

const anchors = (headings = [], citations = []) => ({ headings, citations });

test('normHeading collapses whitespace and trims; null → empty', () => {
  assert.equal(normHeading('  The   shift\n  '), 'The shift');
  assert.equal(normHeading(null), '');
  assert.equal(normHeading(undefined), '');
});

test('headingKey lowercases the normalized heading', () => {
  assert.equal(headingKey('  The   Shift '), 'the shift');
});

test('normCitation trims, strips trailing slashes, lowercases', () => {
  assert.equal(normCitation(' https://Example.com/Path/ '), 'https://example.com/path');
  assert.equal(normCitation('https://example.com///'), 'https://example.com');
  assert.equal(normCitation(''), '');
  assert.equal(normCitation(null), '');
});

test('identical anchors → ok, nothing lost or missing', () => {
  const base = anchors(['Intro', 'Body'], ['https://a.example/1']);
  const d = diffAnchors(base, base);
  assert.equal(d.ok, true);
  assert.equal(d.headingCountDrop, 0);
  assert.deepEqual(d.missingCitations, []);
  assert.deepEqual(d.headingsLost, []);
});

test('NON-THRASH: reworded heading at equal count does NOT gate', () => {
  const base = anchors(['The shift', 'Body'], []);
  const cur = anchors(['The shift in practice', 'Body'], []);
  const d = diffAnchors(base, cur);
  assert.equal(d.ok, true, 'rewording must be allowed — it is the loop’s mandate');
  assert.equal(d.headingCountDrop, 0);
  // The old wording is reported as informational only — it must NOT affect ok.
  assert.deepEqual(d.headingsLost, ['The shift']);
});

test('heading deletion (count regress) gates', () => {
  const base = anchors(['Intro', 'Body', 'Outro'], []);
  const cur = anchors(['Intro', 'Body'], []);
  const d = diffAnchors(base, cur);
  assert.equal(d.ok, false);
  assert.equal(d.headingCountDrop, 1);
  assert.equal(d.baselineHeadingCount, 3);
  assert.equal(d.currentHeadingCount, 2);
});

test('emptying a heading (text removed) regresses count', () => {
  const base = anchors(['Intro', 'Body'], []);
  const cur = anchors(['Intro', '   '], []); // second heading emptied
  const d = diffAnchors(base, cur);
  assert.equal(d.ok, false);
  assert.equal(d.headingCountDrop, 1);
});

test('adding headings is allowed (count grows)', () => {
  const base = anchors(['Intro'], []);
  const cur = anchors(['Intro', 'New section'], []);
  const d = diffAnchors(base, cur);
  assert.equal(d.ok, true);
  assert.equal(d.headingCountDrop, 0);
});

test('dropping a citation gates and names the lost URL', () => {
  const base = anchors([], ['https://a.example/1', 'https://b.example/2']);
  const cur = anchors([], ['https://a.example/1']);
  const d = diffAnchors(base, cur);
  assert.equal(d.ok, false);
  assert.deepEqual(d.missingCitations, ['https://b.example/2']);
});

test('adding a citation is allowed (superset)', () => {
  const base = anchors([], ['https://a.example/1']);
  const cur = anchors([], ['https://a.example/1', 'https://c.example/3']);
  const d = diffAnchors(base, cur);
  assert.equal(d.ok, true);
  assert.deepEqual(d.missingCitations, []);
});

test('citation trailing-slash/case churn is treated as the same source', () => {
  const base = anchors([], ['https://Example.com/Path']);
  const cur = anchors([], ['https://example.com/path/']);
  const d = diffAnchors(base, cur);
  assert.equal(d.ok, true);
  assert.deepEqual(d.missingCitations, []);
});

test('distinct baseline headings are de-duplicated for the count floor', () => {
  const base = anchors(['Before', 'Now', 'Before'], []); // 2 distinct
  const cur = anchors(['Before', 'Now'], []);
  const d = diffAnchors(base, cur);
  assert.equal(d.baselineHeadingCount, 2);
  assert.equal(d.ok, true);
});

test('missing/empty baseline imposes no floor', () => {
  assert.equal(diffAnchors(null, anchors(['x'])).ok, true);
  assert.equal(diffAnchors(undefined, undefined).ok, true);
});

test('anchorFailures renders gating violations as checker strings', () => {
  const base = anchors(['A', 'B'], ['https://a.example/1']);
  const cur = anchors(['A'], []);
  const out = anchorFailures('index.html', base, cur);
  assert.equal(out.length, 2);
  assert.ok(out.some((s) => /heading count regressed 2 -> 1/.test(s)));
  assert.ok(out.some((s) => /citation dropped — https:\/\/a\.example\/1/.test(s)));
});

test('anchorFailures is empty when the floor holds', () => {
  const base = anchors(['A'], ['https://a.example/1']);
  assert.deepEqual(anchorFailures('index.html', base, base), []);
});

// Integration: the floor flows through the checker's pure assertDeck path (D2).
const clean = (o = {}) => ({
  deckFile: 'index.html', loadError: null, revealReady: true,
  consoleErrors: [], pageErrors: [], overflowX: false,
  totalSlides: 5, horizontalSlides: 5, ...o,
});

test('assertDeck enforces the anchor floor when a baseline is supplied', () => {
  const baselineAnchors = anchors(['A', 'B'], ['https://a.example/1']);
  const d = clean({ anchors: anchors(['A'], []) }); // lost a heading AND the citation
  const failures = assertDeck(d, 5, baselineAnchors);
  assert.ok(failures.some((s) => /heading count regressed/.test(s)));
  assert.ok(failures.some((s) => /citation dropped/.test(s)));
});

test('assertDeck: reworded heading + same citations stays green (no thrash)', () => {
  const baselineAnchors = anchors(['The shift', 'Body'], ['https://a.example/1']);
  const d = clean({ anchors: anchors(['The shift in practice', 'Body'], ['https://a.example/1']) });
  const failures = assertDeck(d, 5, baselineAnchors);
  assert.deepEqual(failures, []);
});

test('assertDeck skips the floor when no baseline anchors are provided', () => {
  const d = clean({ anchors: anchors([], []) });
  assert.deepEqual(assertDeck(d, 5), []);
});
