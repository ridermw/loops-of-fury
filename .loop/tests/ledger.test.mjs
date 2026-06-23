// .loop/tests/ledger.test.mjs — self-updating improvement ledger (C / D3, D16, D17, D24).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  emptyLedger, recordEntry, setStatus, summarize, formatDuration,
  renderInner, replaceRegion, applyLedger,
  loadLedger, saveLedger, recordEntryToDeck, finalizeLedgerToDeck,
  LEDGER_START, LEDGER_END,
} from '../ledger.mjs';

const AXES = ['render', 'hygiene', 'freshness', 'delight'];

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
}
function deckShell(inner) {
  return `<section id="ledger">\n        ${LEDGER_START}\n        ${inner}\n        ${LEDGER_END}\n      </section>`;
}

// ---- data layer -------------------------------------------------------------

test('emptyLedger seeds every configured axis at 0, no entries, null status', () => {
  const l = emptyLedger(AXES);
  assert.equal(l.status, null);
  assert.equal(l.startedMs, null);
  assert.equal(l.endedMs, null);
  assert.deepEqual(l.axes, { render: 0, hygiene: 0, freshness: 0, delight: 0 });
  assert.deepEqual(l.entries, []);
});

test('recordEntry appends, bumps the axis tally, and stamps run start + running', () => {
  const l = emptyLedger(AXES);
  recordEntry(l, { iter: 1, axis: 'render', sha: 'abc123', now: 5000 });
  assert.equal(l.entries.length, 1);
  assert.deepEqual(l.entries[0], { iter: 1, axis: 'render', sha: 'abc123', ts: new Date(5000).toISOString() });
  assert.equal(l.axes.render, 1);
  assert.equal(l.startedMs, 5000);
  assert.equal(l.status, 'running');
});

test('recordEntry preserves the original startedMs across later entries', () => {
  const l = emptyLedger(AXES);
  recordEntry(l, { iter: 1, axis: 'render', now: 5000 });
  recordEntry(l, { iter: 2, axis: 'hygiene', now: 9000 });
  assert.equal(l.startedMs, 5000);
  assert.equal(l.axes.render, 1);
  assert.equal(l.axes.hygiene, 1);
  assert.equal(l.entries.length, 2);
});

test('recordEntry tolerates an unknown axis (counts it, never throws)', () => {
  const l = emptyLedger(AXES);
  recordEntry(l, { iter: 1, axis: 'mystery', now: 1 });
  assert.equal(l.axes.mystery, 1);
});

test('recordEntry on an ended ledger flips status back to running (resume)', () => {
  const l = emptyLedger(AXES);
  setStatus(l, 'ended', { now: 10 });
  recordEntry(l, { iter: 1, axis: 'render', now: 20 });
  assert.equal(l.status, 'running');
});

test('setStatus ended stamps endedMs', () => {
  const l = emptyLedger(AXES);
  setStatus(l, 'ended', { now: 42 });
  assert.equal(l.status, 'ended');
  assert.equal(l.endedMs, 42);
});

test('setStatus escalated stamps endedMs', () => {
  const l = emptyLedger(AXES);
  setStatus(l, 'escalated', { now: 99 });
  assert.equal(l.status, 'escalated');
  assert.equal(l.endedMs, 99);
});

test('setStatus running does NOT stamp endedMs', () => {
  const l = emptyLedger(AXES);
  setStatus(l, 'running', { now: 7 });
  assert.equal(l.endedMs, null);
});

// ---- derivation -------------------------------------------------------------

test('summarize: fresh ledger derives the empty state', () => {
  const s = summarize(emptyLedger(AXES), { now: 0, axes: AXES });
  assert.equal(s.state, 'empty');
  assert.equal(s.total, 0);
});

test('summarize: entries with running status derive the partial state', () => {
  const l = emptyLedger(AXES);
  recordEntry(l, { iter: 1, axis: 'render', now: 1000 });
  const s = summarize(l, { now: 2000, axes: AXES });
  assert.equal(s.state, 'partial');
  assert.equal(s.total, 1);
  assert.equal(s.durationMs, 1000);
});

test('summarize: ended status derives the success state', () => {
  const l = emptyLedger(AXES);
  recordEntry(l, { iter: 1, axis: 'render', now: 1000 });
  setStatus(l, 'ended', { now: 4000 });
  const s = summarize(l, { now: 9000, axes: AXES });
  assert.equal(s.state, 'success');
  assert.equal(s.durationMs, 3000); // uses endedMs, not now
});

test('summarize: escalated status derives the escalated state', () => {
  const l = emptyLedger(AXES);
  recordEntry(l, { iter: 1, axis: 'render', now: 1000 });
  setStatus(l, 'escalated', { now: 2000 });
  const s = summarize(l, { now: 9000, axes: AXES });
  assert.equal(s.state, 'escalated');
});

test('summarize: perAxis is scoped to the configured axes (dropped axis hidden, new axis 0)', () => {
  const l = emptyLedger(['render', 'hygiene']);
  recordEntry(l, { iter: 1, axis: 'render', now: 1 });
  recordEntry(l, { iter: 2, axis: 'hygiene', now: 2 });
  // reconfigure: hygiene removed, delight added
  const s = summarize(l, { now: 3, axes: ['render', 'delight'] });
  assert.deepEqual(Object.keys(s.perAxis), ['render', 'delight']);
  assert.equal(s.perAxis.render, 1);
  assert.equal(s.perAxis.delight, 0);
  assert.equal('hygiene' in s.perAxis, false);
});

test('summarize: exposes the last sha + ts', () => {
  const l = emptyLedger(AXES);
  recordEntry(l, { iter: 1, axis: 'render', sha: 'aaa', now: 1 });
  recordEntry(l, { iter: 2, axis: 'delight', sha: 'bbb', now: 2 });
  const s = summarize(l, { now: 3, axes: AXES });
  assert.equal(s.lastSha, 'bbb');
});

test('formatDuration renders h/m sensibly', () => {
  assert.equal(formatDuration(0), '');
  assert.equal(formatDuration(30 * 1000), 'under a minute');
  assert.equal(formatDuration(5 * 60 * 1000), '5m');
  assert.equal(formatDuration(60 * 60 * 1000), '1h');
  assert.equal(formatDuration((2 * 60 + 12) * 60 * 1000), '2h 12m');
});

// ---- rendering --------------------------------------------------------------

test('renderInner empty: hero 0, waiting subtitle, NO chips', () => {
  const html = renderInner(summarize(emptyLedger(AXES), { now: 0, axes: AXES }));
  assert.match(html, /<p class="big-number">0<\/p>/);
  assert.match(html, /waiting for the first unattended run/);
  assert.equal(/class="pill"/.test(html), false);
});

test('renderInner partial: hero count, "still going", and per-axis chips', () => {
  const l = emptyLedger(AXES);
  recordEntry(l, { iter: 1, axis: 'render', now: 1 });
  recordEntry(l, { iter: 2, axis: 'render', now: 2 });
  recordEntry(l, { iter: 3, axis: 'hygiene', now: 3 });
  const html = renderInner(summarize(l, { now: 4, axes: AXES }));
  assert.match(html, /<p class="big-number">3<\/p>/);
  assert.match(html, /still going/);
  assert.match(html, /<span class="pill">render \+2<\/span>/);
  assert.match(html, /<span class="pill">hygiene \+1<\/span>/);
  assert.match(html, /<div class="flow">/);
});

test('renderInner success: "every axis stronger" with the duration', () => {
  const l = emptyLedger(AXES);
  recordEntry(l, { iter: 1, axis: 'render', now: 0 });
  setStatus(l, 'ended', { now: (5 * 60 + 12) * 60 * 1000 });
  const html = renderInner(summarize(l, { now: 0, axes: AXES }));
  assert.match(html, /every axis stronger/);
  assert.match(html, /5h 12m/);
});

test('renderInner escalated: "paused itself for review"', () => {
  const l = emptyLedger(AXES);
  recordEntry(l, { iter: 1, axis: 'render', now: 0 });
  setStatus(l, 'escalated', { now: 1000 });
  const html = renderInner(summarize(l, { now: 2000, axes: AXES }));
  assert.match(html, /paused itself for review/);
});

test('renderInner coerces a non-numeric total to 0 (no NaN leaks into the DOM)', () => {
  const html = renderInner({ total: undefined, perAxis: {}, state: 'partial', durationMs: 0 });
  assert.match(html, /<p class="big-number">0<\/p>/);
  assert.equal(/NaN/.test(html), false);
});

test('replaceRegion splices inner between markers and preserves marker indentation', () => {
  const deck = deckShell('<p class="big-number">0</p>');
  const { html, replaced } = replaceRegion(deck, 'X\nY');
  assert.equal(replaced, true);
  assert.match(html, /        <!-- LEDGER:START -->\n        X\n        Y\n        <!-- LEDGER:END -->/);
});

test('replaceRegion is idempotent (re-applying the same inner is a fixed point)', () => {
  const deck = deckShell('<p class="big-number">0</p>');
  const once = replaceRegion(deck, 'A\nB').html;
  const twice = replaceRegion(once, 'A\nB').html;
  assert.equal(once, twice);
});

test('replaceRegion reports replaced:false when the markers are absent', () => {
  const { html, replaced } = replaceRegion('<section>no markers</section>', 'X');
  assert.equal(replaced, false);
  assert.equal(html, '<section>no markers</section>');
});

test('applyLedger composes summarize -> renderInner -> replaceRegion', () => {
  const l = emptyLedger(AXES);
  recordEntry(l, { iter: 1, axis: 'delight', now: 1 });
  const { html, replaced, summary } = applyLedger(deckShell('<p class="big-number">0</p>'), l, { now: 2, axes: AXES });
  assert.equal(replaced, true);
  assert.equal(summary.total, 1);
  assert.match(html, /<span class="pill">delight \+1<\/span>/);
});

// ---- IO + driver-facing fs helpers ------------------------------------------

test('loadLedger returns an empty ledger for a missing file', () => {
  const l = loadLedger(path.join(tmpDir(), 'nope.json'), AXES);
  assert.equal(l.status, null);
  assert.deepEqual(l.entries, []);
});

test('loadLedger returns an empty ledger for a corrupt file', () => {
  const f = path.join(tmpDir(), 'corrupt.json');
  fs.writeFileSync(f, '{ this is not json');
  const l = loadLedger(f, AXES);
  assert.deepEqual(l.axes, { render: 0, hygiene: 0, freshness: 0, delight: 0 });
});

test('loadLedger backfills newly-configured axes onto an older file', () => {
  const f = path.join(tmpDir(), 'old.json');
  fs.writeFileSync(f, JSON.stringify({ status: null, axes: { render: 3 }, entries: [] }));
  const l = loadLedger(f, AXES);
  assert.equal(l.axes.render, 3);
  assert.equal(l.axes.delight, 0);
});

test('saveLedger / loadLedger roundtrip preserves entries + axes', () => {
  const f = path.join(tmpDir(), 'rt.json');
  const l = emptyLedger(AXES);
  recordEntry(l, { iter: 1, axis: 'render', sha: 'z', now: 100 });
  setStatus(l, 'ended', { now: 200 });
  saveLedger(f, l);
  const back = loadLedger(f, AXES);
  assert.equal(back.status, 'ended');
  assert.equal(back.endedMs, 200);
  assert.equal(back.entries[0].sha, 'z');
});

test('recordEntryToDeck updates ledger.json AND the deck region together', () => {
  const dir = tmpDir();
  const ledgerFile = path.join(dir, 'ledger.json');
  const deckFile = path.join(dir, 'deck.html');
  saveLedger(ledgerFile, emptyLedger(AXES));
  fs.writeFileSync(deckFile, deckShell('<p class="big-number">0</p>'));

  const { summary, replaced } = recordEntryToDeck({
    ledgerFile, deckFile, axes: AXES, now: 1000,
    entry: { iter: 1, axis: 'render', sha: 'sha1' },
  });
  assert.equal(replaced, true);
  assert.equal(summary.total, 1);

  const onDisk = loadLedger(ledgerFile, AXES);
  assert.equal(onDisk.axes.render, 1);
  assert.equal(onDisk.status, 'running');
  assert.match(fs.readFileSync(deckFile, 'utf8'), /<span class="pill">render \+1<\/span>/);
});

test('recordEntryToDeck twice keeps a single ledger region (idempotent splice, count grows)', () => {
  const dir = tmpDir();
  const ledgerFile = path.join(dir, 'ledger.json');
  const deckFile = path.join(dir, 'deck.html');
  saveLedger(ledgerFile, emptyLedger(AXES));
  fs.writeFileSync(deckFile, deckShell('<p class="big-number">0</p>'));

  recordEntryToDeck({ ledgerFile, deckFile, axes: AXES, now: 1, entry: { iter: 1, axis: 'render' } });
  recordEntryToDeck({ ledgerFile, deckFile, axes: AXES, now: 2, entry: { iter: 2, axis: 'render' } });

  const deck = fs.readFileSync(deckFile, 'utf8');
  assert.equal((deck.match(/LEDGER:START/g) || []).length, 1);
  assert.equal((deck.match(/LEDGER:END/g) || []).length, 1);
  assert.match(deck, /<span class="pill">render \+2<\/span>/);
});

test('finalizeLedgerToDeck stamps the terminal status and renders the success state', () => {
  const dir = tmpDir();
  const ledgerFile = path.join(dir, 'ledger.json');
  const deckFile = path.join(dir, 'deck.html');
  const l = emptyLedger(AXES);
  recordEntry(l, { iter: 1, axis: 'render', now: 0 });
  saveLedger(ledgerFile, l);
  fs.writeFileSync(deckFile, deckShell('<p class="big-number">1</p>'));

  const { summary } = finalizeLedgerToDeck({
    ledgerFile, deckFile, status: 'ended', axes: AXES, now: 60 * 60 * 1000,
  });
  assert.equal(summary.state, 'success');
  assert.equal(loadLedger(ledgerFile, AXES).status, 'ended');
  assert.match(fs.readFileSync(deckFile, 'utf8'), /every axis stronger/);
});

// ---- guard: the committed seed slide IS the empty-state render (idempotent) --

test('the committed index.html ledger seed equals applyLedger(emptyLedger) — no spurious first-run diff', () => {
  const deckPath = fileURLToPath(new URL('../../index.html', import.meta.url));
  const original = fs.readFileSync(deckPath, 'utf8');
  const { html, replaced } = applyLedger(original, emptyLedger(AXES), { now: 0, axes: AXES });
  assert.equal(replaced, true);
  assert.equal(html, original); // seed already in empty state → re-render is a no-op
});
