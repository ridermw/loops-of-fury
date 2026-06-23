// .loop/tests/visual.test.mjs — pure-layer coverage for the visual-regression
// gate (D8/D23). The Chromium capture seam is proven by a live smoke (driver
// --selftest-style), not here; everything below is deterministic with synthetic
// PNGs and injected temp dirs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import {
  diffPng,
  compareCapture,
  loadBaseline,
  writeBaseline,
  baselineDirFor,
} from '../visual.mjs';

const OPTS = { driftRatio: 0.02, pixelThreshold: 0.1 };

function solidPng(w, h, [r, g, b, a = 255]) {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    png.data[i * 4] = r;
    png.data[i * 4 + 1] = g;
    png.data[i * 4 + 2] = b;
    png.data[i * 4 + 3] = a;
  }
  return PNG.sync.write(png);
}

// A wxh image that is `n` pixels different from solid red (rest red).
function redWithChangedPixels(w, h, n) {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    const changed = i < n;
    png.data[i * 4] = changed ? 0 : 255;
    png.data[i * 4 + 1] = 0;
    png.data[i * 4 + 2] = changed ? 255 : 0;
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

function captureOf(slides) {
  return { deckFile: 'index.html', slideCount: slides.length, slides, consoleErrors: [] };
}

const RED = [255, 0, 0];
const BLUE = [0, 0, 255];

// ---- diffPng ---------------------------------------------------------------
test('diffPng: identical buffers → ratio 0, no mismatch', () => {
  const a = solidPng(10, 10, RED);
  const b = solidPng(10, 10, RED);
  const d = diffPng(a, b, OPTS);
  assert.equal(d.sizeMismatch, false);
  assert.equal(d.mismatched, 0);
  assert.equal(d.ratio, 0);
});

test('diffPng: one changed pixel → mismatched >= 1, ratio > 0', () => {
  const a = solidPng(10, 10, RED);
  const b = redWithChangedPixels(10, 10, 1);
  const d = diffPng(a, b, OPTS);
  assert.ok(d.mismatched >= 1);
  assert.ok(d.ratio > 0);
  assert.equal(d.sizeMismatch, false);
});

test('diffPng: dimension mismatch → sizeMismatch, ratio 1, mismatched -1', () => {
  const a = solidPng(10, 10, RED);
  const b = solidPng(12, 10, RED);
  const d = diffPng(a, b, OPTS);
  assert.equal(d.sizeMismatch, true);
  assert.equal(d.ratio, 1);
  assert.equal(d.mismatched, -1);
});

// ---- compareCapture: hard invariants ---------------------------------------
test('compareCapture: all match, same count, no overflow → ok, no drift', () => {
  const base = solidPng(8, 8, RED);
  const baseline = { slideCount: 2, pngs: new Map([[0, base], [1, base]]) };
  const capture = captureOf([
    { index: 0, overflowX: false, png: solidPng(8, 8, RED) },
    { index: 1, overflowX: false, png: solidPng(8, 8, RED) },
  ]);
  const r = compareCapture(baseline, capture, OPTS);
  assert.equal(r.ok, true);
  assert.equal(r.drift.length, 0);
  assert.equal(r.newSlides.length, 0);
  assert.equal(r.slideCountDelta, 0);
});

test('compareCapture: slide-count DROP → hard fail', () => {
  const base = solidPng(8, 8, RED);
  const baseline = { slideCount: 3, pngs: new Map([[0, base], [1, base], [2, base]]) };
  const capture = captureOf([
    { index: 0, overflowX: false, png: solidPng(8, 8, RED) },
    { index: 1, overflowX: false, png: solidPng(8, 8, RED) },
  ]);
  const r = compareCapture(baseline, capture, OPTS);
  assert.equal(r.ok, false);
  assert.ok(r.hardFailures.some((f) => f.kind === 'slide-count'));
  assert.equal(r.slideCountDelta, -1);
});

test('compareCapture: a slide overflows → hard fail', () => {
  const base = solidPng(8, 8, RED);
  const baseline = { slideCount: 1, pngs: new Map([[0, base]]) };
  const capture = captureOf([{ index: 0, overflowX: true, png: solidPng(8, 8, RED) }]);
  const r = compareCapture(baseline, capture, OPTS);
  assert.equal(r.ok, false);
  assert.ok(r.hardFailures.some((f) => f.kind === 'overflow' && f.index === 0));
});

// ---- compareCapture: soft drift (the keystone policy) ----------------------
test('compareCapture: pixel drift over threshold, same count, no overflow → ok TRUE + drift recorded', () => {
  const baseline = { slideCount: 1, pngs: new Map([[0, solidPng(8, 8, RED)]]) };
  const capture = captureOf([{ index: 0, overflowX: false, png: solidPng(8, 8, BLUE) }]);
  const r = compareCapture(baseline, capture, OPTS);
  assert.equal(r.ok, true, 'pixel drift must NOT fail the gate (D8/Premise 3)');
  assert.equal(r.drift.length, 1);
  assert.equal(r.drift[0].index, 0);
  assert.ok(r.drift[0].ratio > OPTS.driftRatio);
});

test('compareCapture: drift UNDER threshold is not flagged', () => {
  // 1 changed pixel out of 100 = ratio 0.01 < driftRatio 0.02 → no flag.
  const baseline = { slideCount: 1, pngs: new Map([[0, solidPng(100, 1, RED)]]) };
  const capture = captureOf([{ index: 0, overflowX: false, png: redWithChangedPixels(100, 1, 1) }]);
  const r = compareCapture(baseline, capture, OPTS);
  assert.equal(r.ok, true);
  assert.equal(r.drift.length, 0);
});

test('compareCapture: drift JUST over threshold is flagged', () => {
  // 5 changed pixels out of 100 = ratio 0.05 > driftRatio 0.02 → flag.
  const baseline = { slideCount: 1, pngs: new Map([[0, solidPng(100, 1, RED)]]) };
  const capture = captureOf([{ index: 0, overflowX: false, png: redWithChangedPixels(100, 1, 5) }]);
  const r = compareCapture(baseline, capture, OPTS);
  assert.equal(r.ok, true);
  assert.equal(r.drift.length, 1);
});

// ---- compareCapture: new / no baseline -------------------------------------
test('compareCapture: no baseline → ok, every slide is new', () => {
  const capture = captureOf([
    { index: 0, overflowX: false, png: solidPng(8, 8, RED) },
    { index: 1, overflowX: false, png: solidPng(8, 8, RED) },
  ]);
  const r = compareCapture(null, capture, OPTS);
  assert.equal(r.ok, true);
  assert.equal(r.hasBaseline, false);
  assert.equal(r.newSlides.length, 2);
});

test('compareCapture: slide ADDED (count up) → ok, extra slide is new, delta +1', () => {
  const base = solidPng(8, 8, RED);
  const baseline = { slideCount: 2, pngs: new Map([[0, base], [1, base]]) };
  const capture = captureOf([
    { index: 0, overflowX: false, png: solidPng(8, 8, RED) },
    { index: 1, overflowX: false, png: solidPng(8, 8, RED) },
    { index: 2, overflowX: false, png: solidPng(8, 8, RED) },
  ]);
  const r = compareCapture(baseline, capture, OPTS);
  assert.equal(r.ok, true);
  assert.equal(r.slideCountDelta, 1);
  assert.deepEqual(r.newSlides, [{ index: 2 }]);
});

test('compareCapture: size mismatch on a slide is recorded as drift (not a crash)', () => {
  const baseline = { slideCount: 1, pngs: new Map([[0, solidPng(8, 8, RED)]]) };
  const capture = captureOf([{ index: 0, overflowX: false, png: solidPng(9, 8, RED) }]);
  const r = compareCapture(baseline, capture, OPTS);
  assert.equal(r.ok, true);
  assert.equal(r.drift.length, 1);
  assert.equal(r.drift[0].sizeMismatch, true);
});

// ---- baseline IO -----------------------------------------------------------
test('writeBaseline + loadBaseline: round-trips count and PNG bytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vis-bl-'));
  try {
    const p0 = solidPng(8, 8, RED);
    const p1 = solidPng(8, 8, BLUE);
    const capture = captureOf([
      { index: 0, overflowX: false, png: p0 },
      { index: 1, overflowX: false, png: p1 },
    ]);
    const w = writeBaseline('index.html', capture, dir);
    assert.equal(w.slideCount, 2);

    const bl = loadBaseline('index.html', dir);
    assert.equal(bl.slideCount, 2);
    assert.ok(bl.pngs.get(0).equals(p0));
    assert.ok(bl.pngs.get(1).equals(p1));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadBaseline: missing baseline → null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vis-bl-'));
  try {
    assert.equal(loadBaseline('index.html', dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeBaseline: refresh with FEWER slides clears stale PNGs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vis-bl-'));
  try {
    const red = solidPng(8, 8, RED);
    writeBaseline('index.html', captureOf([
      { index: 0, overflowX: false, png: red },
      { index: 1, overflowX: false, png: red },
      { index: 2, overflowX: false, png: red },
    ]), dir);
    // refresh-on-accept with a shorter deck
    writeBaseline('index.html', captureOf([
      { index: 0, overflowX: false, png: red },
      { index: 1, overflowX: false, png: red },
    ]), dir);
    const bl = loadBaseline('index.html', dir);
    assert.equal(bl.slideCount, 2);
    assert.equal(bl.pngs.has(2), false, 'stale index 2 PNG must be gone');
    const bdir = baselineDirFor('index.html', dir);
    assert.equal(fs.existsSync(path.join(bdir, '02.png')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('baselineDirFor: sanitizes the deck filename into a slug', () => {
  const d = baselineDirFor('index.html', '/tmp/base');
  assert.ok(d.endsWith('index.html') || d.endsWith('index.html'.replace(/[^\w.-]+/g, '_')));
  const weird = baselineDirFor('a/b deck.html', '/tmp/base');
  assert.ok(!/[ /]/.test(path.basename(weird)));
});
