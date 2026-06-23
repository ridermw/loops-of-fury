// .loop/tests/hygiene.test.mjs — pure-layer coverage for link hygiene & freshness
// (D33). The network HEAD seam (defaultFetchHead) is proven by a live smoke, not
// here; everything below is deterministic with injected results / temp dirs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  classifyHref,
  brokenInternalAnchors,
  missingAssets,
  hardLinkFailures,
  evaluateFreshness,
  loadLinkState,
  saveLinkState,
  checkFreshness,
} from '../hygiene.mjs';

// ── classifyHref ────────────────────────────────────────────────────────────

test('classifyHref: http(s) and protocol-relative are external', () => {
  assert.equal(classifyHref('https://ghuntley.com/ralph/'), 'external');
  assert.equal(classifyHref('http://example.com'), 'external');
  assert.equal(classifyHref('//cdn.jsdelivr.net/x.js'), 'external');
});

test('classifyHref: pure fragment is internal-anchor', () => {
  assert.equal(classifyHref('#contract'), 'internal-anchor');
  assert.equal(classifyHref('#'), 'internal-anchor');
});

test('classifyHref: relative + site-root paths are assets', () => {
  assert.equal(classifyHref('assets/logo.png'), 'asset');
  assert.equal(classifyHref('./style.css'), 'asset');
  assert.equal(classifyHref('../shared/x.svg'), 'asset');
  assert.equal(classifyHref('/img/hero.png'), 'asset');
});

test('classifyHref: mailto/tel/js/data/empty are other', () => {
  assert.equal(classifyHref('mailto:a@b.com'), 'other');
  assert.equal(classifyHref('tel:+15551234'), 'other');
  assert.equal(classifyHref('javascript:void(0)'), 'other');
  assert.equal(classifyHref('data:image/png;base64,AAAA'), 'other');
  assert.equal(classifyHref(''), 'other');
  assert.equal(classifyHref(null), 'other');
});

// ── brokenInternalAnchors ────────────────────────────────────────────────────

test('brokenInternalAnchors: present id resolves, missing id breaks', () => {
  const ids = new Set(['contract', 'ledger']);
  assert.deepEqual(brokenInternalAnchors(ids, ['#contract', '#ledger']), []);
  assert.deepEqual(brokenInternalAnchors(ids, ['#nope']), ['#nope']);
});

test('brokenInternalAnchors: SVG def id is NOT a false positive (key guard)', () => {
  // `url(#arrow-blue)` SVG marker refs resolve to a <marker id="arrow-blue"> def.
  const ids = new Set(['arrow-blue', 'arrow-green', 'arrow-red']);
  assert.deepEqual(brokenInternalAnchors(ids, ['#arrow-blue', '#arrow-red']), []);
});

test('brokenInternalAnchors: bare # is valid; non-anchors ignored; dedupes', () => {
  const ids = new Set(['x']);
  assert.deepEqual(
    brokenInternalAnchors(ids, ['#', 'https://a.com', 'assets/x.png', '#y', '#y']),
    ['#y'],
  );
});

test('brokenInternalAnchors: Reveal hash-routes are exempt (#/, #/3, #/slide)', () => {
  // `#/...` is Reveal.js navigation, not an element-id ref — the real decks ship a
  // home link `#/`. None of these must be flagged even with an empty id set.
  const ids = new Set([]);
  assert.deepEqual(
    brokenInternalAnchors(ids, ['#/', '#/3', '#/3/2', '#/named-slide']),
    [],
  );
  // A plain `#name` is still checked against ids (no slash → element-id ref).
  assert.deepEqual(brokenInternalAnchors(ids, ['#name']), ['#name']);
});

test('brokenInternalAnchors: accepts an array of ids too', () => {
  assert.deepEqual(brokenInternalAnchors(['a', 'b'], ['#a', '#c']), ['#c']);
});

// ── missingAssets ─────────────────────────────────────────────────────────────

test('missingAssets: existing resolves, missing flagged (injected existsFn)', () => {
  const present = new Set([path.resolve('deck', 'assets', 'a.png')]);
  const existsFn = (p) => present.has(p);
  const refs = ['assets/a.png', 'assets/b.png'];
  assert.deepEqual(missingAssets('deck/index.html', refs, existsFn), ['assets/b.png']);
});

test('missingAssets: external/internal refs skipped', () => {
  const refs = ['https://x.com/a.png', '#frag', 'mailto:a@b.com'];
  assert.deepEqual(missingAssets('deck/index.html', refs, () => false), []);
});

test('missingAssets: strips query/hash before resolving; site-root vs relative', () => {
  const baseDir = path.dirname(path.resolve('deck', 'index.html'));
  const present = new Set([
    path.resolve(baseDir, 'a.css'),
    path.join(baseDir, 'img', 'h.png'),
  ]);
  const existsFn = (p) => present.has(p);
  const refs = ['a.css?v=2', '/img/h.png#x'];
  assert.deepEqual(missingAssets('deck/index.html', refs, existsFn), []);
});

// ── hardLinkFailures (gate-facing aggregator) ─────────────────────────────────

test('hardLinkFailures: combines broken anchor + missing asset into strings', () => {
  const inv = {
    ids: new Set(['ok']),
    hrefs: ['#ok', '#bad'],
    assets: ['assets/missing.png'],
    deckPath: 'deck/index.html',
  };
  const out = hardLinkFailures('index.html', inv, { existsFn: () => false });
  assert.equal(out.length, 2);
  assert.ok(out.some((s) => s.includes('broken internal anchor — #bad')));
  assert.ok(out.some((s) => s.includes('missing asset — assets/missing.png')));
});

test('hardLinkFailures: clean inventory yields no failures', () => {
  const inv = {
    ids: new Set(['a']),
    hrefs: ['#a', 'https://x.com'],
    assets: ['assets/a.png'],
    deckPath: 'deck/index.html',
  };
  assert.deepEqual(hardLinkFailures('index.html', inv, { existsFn: () => true }), []);
});

// ── evaluateFreshness (D33 keystone) ──────────────────────────────────────────

const cites = ['https://a.com', 'https://b.com'];
const okRes = (urls) => urls.map((url) => ({ url, ok: true, status: 200 }));
const failRes = (urls, status = 404) => urls.map((url) => ({ url, ok: false, status }));

test('evaluateFreshness: all ok → no failures, empty nextState, ok true', () => {
  const v = evaluateFreshness(cites, {}, okRes(cites), { escalateK: 3 });
  assert.equal(v.ok, true);
  assert.deepEqual(v.failures, []);
  assert.deepEqual(v.escalations, []);
  assert.deepEqual(v.nextState, {});
  assert.deepEqual(v.checked.sort(), cites.slice().sort());
});

test('evaluateFreshness: single fail → miss=1, no escalation, ok STILL true', () => {
  const v = evaluateFreshness(cites, {}, [
    { url: 'https://a.com', ok: false, status: 404 },
    { url: 'https://b.com', ok: true, status: 200 },
  ], { escalateK: 3 });
  assert.equal(v.ok, true); // external NEVER hard-gates
  assert.equal(v.nextState['https://a.com'], 1);
  assert.equal(v.failures.length, 1);
  assert.deepEqual(v.escalations, []);
});

test('evaluateFreshness: K consecutive misses → escalation exactly at K', () => {
  // prev says a.com already missed twice; a third miss (K=3) escalates.
  const prev = { 'https://a.com': 2 };
  const v = evaluateFreshness(['https://a.com'], prev, failRes(['https://a.com']), { escalateK: 3 });
  assert.equal(v.nextState['https://a.com'], 3);
  assert.equal(v.escalations.length, 1);
  assert.equal(v.escalations[0].misses, 3);
  // One short of K must NOT escalate.
  const v2 = evaluateFreshness(['https://a.com'], { 'https://a.com': 1 }, failRes(['https://a.com']), { escalateK: 3 });
  assert.equal(v2.nextState['https://a.com'], 2);
  assert.deepEqual(v2.escalations, []);
});

test('evaluateFreshness: recovery resets the miss counter', () => {
  const prev = { 'https://a.com': 2 };
  const v = evaluateFreshness(['https://a.com'], prev, okRes(['https://a.com']), { escalateK: 3 });
  assert.equal(v.nextState['https://a.com'], undefined); // reset → omitted
  assert.deepEqual(v.failures, []);
});

test('evaluateFreshness: ignore-listed url is skipped entirely', () => {
  const v = evaluateFreshness(['https://flaky.com'], { 'https://flaky.com': 5 }, failRes(['https://flaky.com']), {
    escalateK: 3,
    ignore: ['flaky\\.com'],
  });
  assert.deepEqual(v.checked, []);
  assert.deepEqual(v.failures, []);
  assert.deepEqual(v.escalations, []);
  assert.deepEqual(v.nextState, {}); // not even carried
});

test('evaluateFreshness: url with no result carries prior miss unchanged', () => {
  const v = evaluateFreshness(['https://a.com'], { 'https://a.com': 2 }, [], { escalateK: 3 });
  assert.equal(v.nextState['https://a.com'], 2);
  assert.deepEqual(v.checked, []);
  assert.deepEqual(v.failures, []);
});

test('evaluateFreshness: non-external citations filtered; dupes collapsed', () => {
  const v = evaluateFreshness(
    ['#frag', 'assets/x.png', 'https://a.com', 'https://a.com'],
    {},
    okRes(['https://a.com']),
    { escalateK: 3 },
  );
  assert.deepEqual(v.checked, ['https://a.com']);
});

test('evaluateFreshness: ok stays true even when escalating (soft invariant)', () => {
  const v = evaluateFreshness(['https://a.com'], { 'https://a.com': 9 }, failRes(['https://a.com']), { escalateK: 3 });
  assert.equal(v.ok, true);
  assert.ok(v.escalations.length > 0);
});

// ── state IO ─────────────────────────────────────────────────────────────────

test('loadLinkState/saveLinkState: roundtrip; missing & corrupt → {}', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linkstate-'));
  const file = path.join(dir, 'sub', 'link-state.json');
  assert.deepEqual(loadLinkState(file), {}); // missing
  saveLinkState({ 'https://a.com': 3 }, file);
  assert.deepEqual(loadLinkState(file), { 'https://a.com': 3 });
  fs.writeFileSync(file, '{ not json');
  assert.deepEqual(loadLinkState(file), {}); // corrupt
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── checkFreshness (driver hook, fully mocked seam) ───────────────────────────

test('checkFreshness: mocked seam — checks only external, persists nextState', async () => {
  let saved = null;
  const fetchHead = async (url) => ({ url, ok: url !== 'https://dead.com', status: url !== 'https://dead.com' ? 200 : 404 });
  const verdict = await checkFreshness(
    ['#frag', 'https://a.com', 'https://dead.com', 'https://a.com'],
    {
      fetchHead,
      escalateK: 3,
      load: () => ({ 'https://dead.com': 2 }),
      save: (state) => { saved = state; },
    },
  );
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.checked.sort(), ['https://a.com', 'https://dead.com']);
  assert.equal(verdict.nextState['https://dead.com'], 3);
  assert.equal(verdict.escalations.length, 1); // hit K=3
  assert.deepEqual(saved, verdict.nextState); // persisted
});

test('checkFreshness: ignore list short-circuits a url before fetch', async () => {
  let fetched = [];
  const fetchHead = async (url) => { fetched.push(url); return { url, ok: false, status: 500 }; };
  const verdict = await checkFreshness(['https://skip.com', 'https://b.com'], {
    fetchHead,
    ignore: ['skip\\.com'],
    load: () => ({}),
    save: () => {},
  });
  assert.deepEqual(fetched, ['https://b.com']); // skip.com never fetched
  assert.deepEqual(verdict.checked, ['https://b.com']);
});
