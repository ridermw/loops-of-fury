// .loop/tests/pages.test.mjs — post-push live-Pages verification (D29 / Eng-Q3).
// All seams (gh build API, clock, sleep, browser render, baselines) are injected;
// NO network, NO browser, NO credits. Focus: SHA polling (success/timeout),
// live gate reuse (assertDeck), and the 3-way liveCheckAfterPush decision.
import test from 'node:test';
import assert from 'node:assert/strict';
import { latestBuild, waitForSha, verifyLive, liveCheckAfterPush } from '../pages.mjs';

const NOBASE = { slidesBaselineFile: '/no/such/slides.json', anchorsBaselineFile: '/no/such/anchors.json' };

// Synthetic rendered decks for the objective gate (assertDeck).
function goodDeck(deckFile) {
  return {
    deckFile, loadError: null, revealReady: true, consoleErrors: [], pageErrors: [],
    overflowX: false, totalSlides: 12, horizontalSlides: 12,
  };
}
function brokenDeck(deckFile) {
  return { ...goodDeck(deckFile), revealReady: false, consoleErrors: ['boom'] };
}

// Inject withBrowser (calls cb with a dummy browser) + renderDeckAt (returns a deck).
function renderSeam(deckFn, urlSink) {
  return {
    render: async (cb) => cb({}),
    renderAt: async (_browser, url, deckFile) => { if (urlSink) urlSink.push(url); return deckFn(deckFile); },
  };
}

// ── latestBuild ──────────────────────────────────────────────────────────────

test('latestBuild: parses { status, commit }', () => {
  const gh = () => ({ ok: true, stdout: JSON.stringify({ status: 'built', commit: 'abc' }) });
  assert.deepEqual(latestBuild({ gh }), { status: 'built', commit: 'abc' });
});

test('latestBuild: null on non-ok and on bad json', () => {
  assert.equal(latestBuild({ gh: () => ({ ok: false, stdout: '' }) }), null);
  assert.equal(latestBuild({ gh: () => ({ ok: true, stdout: '<<' }) }), null);
});

// ── waitForSha ───────────────────────────────────────────────────────────────

test('waitForSha: ok when the deployed commit matches and status is built', async () => {
  const getBuild = () => ({ status: 'built', commit: 'sha1' });
  const r = await waitForSha('sha1', { getBuild, now: () => 0, sleep: async () => {} });
  assert.equal(r.ok, true);
  assert.deepEqual(r.observed, { status: 'built', commit: 'sha1' });
});

test('waitForSha: polls until the SHA appears (status built + match)', async () => {
  const seq = [
    { status: 'building', commit: null },
    { status: 'built', commit: 'old' },
    { status: 'built', commit: 'sha9' },
  ];
  let i = 0;
  let slept = 0;
  const r = await waitForSha('sha9', {
    getBuild: () => seq[i++],
    now: () => 0, // never times out
    sleep: async () => { slept += 1; },
    maxWaitMs: 9_999_999,
  });
  assert.equal(r.ok, true);
  assert.equal(i, 3);
  assert.equal(slept, 2);
});

test('waitForSha: times out when the SHA never becomes observable', async () => {
  let t = 0;
  const r = await waitForSha('never', {
    getBuild: () => ({ status: 'built', commit: 'other' }),
    now: () => { const v = t; t += 60_000; return v; },
    sleep: async () => {},
    maxWaitMs: 1000,
  });
  assert.equal(r.ok, false);
  assert.equal(r.timedOut, true);
  assert.deepEqual(r.last, { status: 'built', commit: 'other' });
});

// ── verifyLive ───────────────────────────────────────────────────────────────

test('verifyLive: ok when every live deck passes the objective gate', async () => {
  const urls = [];
  const { render, renderAt } = renderSeam(goodDeck, urls);
  const r = await verifyLive({
    decks: ['index.html', 'workshop.html'], render, renderAt,
    baseUrl: 'https://ridermw.github.io/loops-of-fury/', ...NOBASE,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.failures, []);
  // index.html → base, others → base + file (pagesDeckUrl)
  assert.equal(urls[0], 'https://ridermw.github.io/loops-of-fury/');
  assert.equal(urls[1], 'https://ridermw.github.io/loops-of-fury/workshop.html');
});

test('verifyLive: not ok when a live deck is broken', async () => {
  const { render, renderAt } = renderSeam((d) => (d === 'index.html' ? brokenDeck(d) : goodDeck(d)));
  const r = await verifyLive({ decks: ['index.html', 'workshop.html'], render, renderAt, ...NOBASE });
  assert.equal(r.ok, false);
  assert.ok(r.failures.length >= 1);
  assert.ok(r.failures.some((f) => f.includes('index.html')));
});

test('verifyLive: a render error is reported as a live failure (non-throwing)', async () => {
  const render = async () => { throw new Error('chromium gone'); };
  const r = await verifyLive({ decks: ['index.html'], render, renderAt: async () => goodDeck('index.html'), ...NOBASE });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'live-render-error');
});

// ── liveCheckAfterPush (the 3-way decision) ──────────────────────────────────

function okBuild(sha) { return () => ({ status: 'built', commit: sha }); }

test('liveCheckAfterPush: ok — deployed and live-verified green', async () => {
  const { render, renderAt } = renderSeam(goodDeck);
  const r = await liveCheckAfterPush('sha1', {
    getBuild: okBuild('sha1'), now: () => 0, sleep: async () => {},
    render, renderAt, ...NOBASE,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.observed, { status: 'built', commit: 'sha1' });
});

test('liveCheckAfterPush: revert — deployed but the live site is broken', async () => {
  const { render, renderAt } = renderSeam(brokenDeck);
  const r = await liveCheckAfterPush('sha2', {
    getBuild: okBuild('sha2'), now: () => 0, sleep: async () => {},
    decks: ['index.html'], render, renderAt, ...NOBASE,
  });
  assert.equal(r.ok, false);
  assert.equal(r.action, 'revert');
  assert.ok(r.failures.length >= 1);
});

test('liveCheckAfterPush: pause — the pushed SHA never became observable', async () => {
  let t = 0;
  const { render, renderAt } = renderSeam(goodDeck);
  const r = await liveCheckAfterPush('sha3', {
    getBuild: () => ({ status: 'built', commit: 'different' }),
    now: () => { const v = t; t += 60_000; return v; },
    sleep: async () => {}, maxWaitMs: 1000,
    render, renderAt, ...NOBASE,
  });
  assert.equal(r.ok, false);
  assert.equal(r.action, 'pause');
  assert.equal(r.reason, 'sha-not-observable');
});
