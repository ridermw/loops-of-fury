// .loop/tests/checker.test.mjs — proves THE GATE works (D2/D14).
// Two layers:
//   1. Pure assertDeck() unit tests over synthetic render results (no browser).
//   2. Real-pipeline integration: render good.html (GREEN) + broken.html (RED)
//      through the actual renderer. This is the pre-flight red-on-broken proof —
//      if the checker cannot fail a broken deck, the loop must never start.
// Layer 2 fetches Reveal from the CDN (same as the real decks) → needs network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertDeck } from '../check.mjs';
import { withBrowser, renderDeck } from '../render.mjs';

const clean = (o = {}) => ({
  deckFile: 'x.html', loadError: null, revealReady: true,
  consoleErrors: [], pageErrors: [], overflowX: false,
  totalSlides: 5, horizontalSlides: 5, ...o,
});

test('assertDeck passes a clean deck', () => {
  assert.deepEqual(assertDeck(clean(), 5), []);
});

test('assertDeck flags a load error', () => {
  const f = assertDeck(clean({ loadError: 'timeout' }), 5);
  assert.ok(f.some((m) => /load error/.test(m)));
});

test('assertDeck flags a deck that never became ready', () => {
  const f = assertDeck(clean({ revealReady: false }), 5);
  assert.ok(f.some((m) => /did not become ready/.test(m)));
});

test('assertDeck flags each console error', () => {
  const f = assertDeck(clean({ consoleErrors: ['boom', 'bang'] }), 5);
  assert.equal(f.filter((m) => /console error/.test(m)).length, 2);
});

test('assertDeck flags page errors', () => {
  const f = assertDeck(clean({ pageErrors: ['ReferenceError'] }), 5);
  assert.ok(f.some((m) => /page error/.test(m)));
});

test('assertDeck flags horizontal overflow', () => {
  const f = assertDeck(clean({ overflowX: true }), 5);
  assert.ok(f.some((m) => /overflow/.test(m)));
});

test('assertDeck flags an empty deck', () => {
  const f = assertDeck(clean({ totalSlides: 0 }), undefined);
  assert.ok(f.some((m) => /no slides/.test(m)));
});

test('assertDeck flags slide-count regression below baseline', () => {
  const f = assertDeck(clean({ totalSlides: 4 }), 5);
  assert.ok(f.some((m) => /regressed 5 -> 4/.test(m)));
});

test('assertDeck allows growth at or above baseline', () => {
  assert.deepEqual(assertDeck(clean({ totalSlides: 9 }), 5), []);
});

test('assertDeck ignores baseline when none is known', () => {
  assert.deepEqual(assertDeck(clean({ totalSlides: 1 }), undefined), []);
});

// --- Real-pipeline pre-flight gate (network + Chromium) -------------------
test('GATE: green on good.html, red on broken.html', { timeout: 120000 }, async () => {
  const { good, broken } = await withBrowser(async (browser) => ({
    good: await renderDeck(browser, '.loop/tests/fixtures/good.html'),
    broken: await renderDeck(browser, '.loop/tests/fixtures/broken.html'),
  }));

  // Known-good deck renders clean → zero failures.
  const goodFailures = assertDeck(good, 3);
  assert.equal(good.revealReady, true, 'good fixture should become ready');
  assert.ok(good.totalSlides >= 3, `good fixture slide count = ${good.totalSlides}`);
  assert.deepEqual(goodFailures, [], `good fixture unexpectedly RED: ${goodFailures.join('; ')}`);

  // Broken deck must produce at least one failure — the gate catches it.
  const brokenFailures = assertDeck(broken, 2);
  assert.ok(
    brokenFailures.length > 0,
    'CRITICAL: checker did NOT fail broken.html — loop must refuse to start',
  );
  assert.ok(
    broken.pageErrors.length > 0,
    `broken fixture should surface a page error; got ${JSON.stringify(broken.pageErrors)}`,
  );
});
