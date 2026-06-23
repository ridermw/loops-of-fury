// .loop/visual.mjs — visual-regression gate (D8/D23). Control plane (D28).
//
// Screenshots every slide at the canonical presentation VIEWPORT and pixel-diffs
// each against a stored baseline. Two objective HARD invariants (D23): the deck
// must never LOSE a slide and no slide may overflow horizontally. Pixel drift is
// a SOFT flag only — the baseline REFRESHES on accept (D8) so legitimate visual
// edits never self-poison later iterations (honors Premise 3: visual change is
// non-gating beyond the objective floor).
//
// Layering mirrors scoreboard.mjs / ledger.mjs:
//   - a thin Chromium CAPTURE seam (captureSlides) — the only browser-touching code,
//     reusing render.withBrowser's single launch (D9) + render.gotoReady (DRY);
//   - a PURE diff layer (diffPng) — PNG buffers in, pixel stats out;
//   - a PURE compare/policy layer (compareCapture) — baseline + capture → gate verdict;
//   - thin baseline IO (loadBaseline/writeBaseline) over the gitignored baseline dir;
//   - a driver-facing seam (captureAndCompare/refreshBaseline) — the live-run hook,
//     NOT yet wired into the push-blocked --once path (same staging posture as ledger).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { REPO_ROOT, VIEWPORT, CONSOLE_ALLOW, VISUAL } from './config.mjs';
import { gotoReady } from './render.mjs';

// ---------------------------------------------------------------------------
// Capture seam (the ONLY browser-touching code).
// ---------------------------------------------------------------------------
// `browser` is supplied by the caller (render.withBrowser) so metrics + screenshots
// share ONE Chromium per iteration (D9). Walks the deck through Reveal's own API so
// positioned slides render one at a time exactly as a presenter sees them, with
// transitions disabled for deterministic pixels.
export async function captureSlides(browser, deckFile, opts = {}) {
  const viewport = opts.viewport || VIEWPORT;
  const settleMs = opts.settleMs ?? VISUAL.settleMs;
  const url = pathToFileURL(path.join(REPO_ROOT, deckFile)).href;
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (!CONSOLE_ALLOW.some((rx) => rx.test(text))) consoleErrors.push(text);
  });

  await gotoReady(page, url);

  const hasReveal = await page.evaluate(
    () => Boolean(window.Reveal && typeof window.Reveal.slide === 'function'),
  );
  if (hasReveal) {
    await page.evaluate(() => {
      if (window.Reveal.configure) {
        window.Reveal.configure({ transition: 'none', backgroundTransition: 'none' });
      }
    });
  }

  const coords = await page.evaluate(() => {
    if (!(window.Reveal && typeof window.Reveal.getHorizontalSlides === 'function')) {
      return [{ h: 0, v: 0 }];
    }
    const out = [];
    const hs = Array.from(window.Reveal.getHorizontalSlides());
    hs.forEach((sec, h) => {
      const verts = sec.querySelectorAll(':scope > section');
      if (verts.length) verts.forEach((_, v) => out.push({ h, v }));
      else out.push({ h, v: 0 });
    });
    return out;
  });

  const slides = [];
  for (let i = 0; i < coords.length; i++) {
    const { h, v } = coords[i];
    if (hasReveal) {
      await page.evaluate(({ h, v }) => window.Reveal.slide(h, v), { h, v });
      await page.waitForTimeout(settleMs);
    }
    const overflowX = await page.evaluate(() => {
      const de = document.documentElement;
      return de.scrollWidth > de.clientWidth + 2;
    });
    const png = await page.screenshot({ type: 'png' });
    slides.push({ index: i, h, v, overflowX, png });
  }

  await ctx.close();
  return { deckFile, slideCount: slides.length, slides, consoleErrors };
}

// ---------------------------------------------------------------------------
// Pure diff layer — PNG buffers in, pixel stats out.
// ---------------------------------------------------------------------------
export function decodePng(buf) {
  return PNG.sync.read(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
}

export function diffPng(aBuf, bBuf, opts = {}) {
  const threshold = opts.pixelThreshold ?? VISUAL.pixelThreshold;
  const a = decodePng(aBuf);
  const b = decodePng(bBuf);
  if (a.width !== b.width || a.height !== b.height) {
    return {
      width: Math.max(a.width, b.width),
      height: Math.max(a.height, b.height),
      mismatched: -1,
      ratio: 1,
      sizeMismatch: true,
    };
  }
  const { width, height } = a;
  const mismatched = pixelmatch(a.data, b.data, null, width, height, { threshold });
  const total = width * height;
  const ratio = total ? mismatched / total : 0;
  return { width, height, mismatched, ratio, sizeMismatch: false };
}

// ---------------------------------------------------------------------------
// Pure compare / gating policy.
// ---------------------------------------------------------------------------
// baseline: { slideCount, pngs: Map<index, Buffer> } | null
// capture:  result of captureSlides (slides each have {index, overflowX, png})
export function compareCapture(baseline, capture, opts = {}) {
  const driftRatio = opts.driftRatio ?? VISUAL.driftRatio;
  const pixelThreshold = opts.pixelThreshold ?? VISUAL.pixelThreshold;
  const baseCount = baseline ? baseline.slideCount : 0;
  const nowCount = capture.slideCount;

  const hardFailures = [];
  const drift = [];
  const newSlides = [];

  // D23 objective invariant #1: never LOSE a slide.
  if (baseline && nowCount < baseCount) {
    hardFailures.push({ kind: 'slide-count', baseline: baseCount, now: nowCount });
  }

  for (const s of capture.slides) {
    // D23 objective invariant #2: no horizontal overflow on any slide.
    if (s.overflowX) hardFailures.push({ kind: 'overflow', index: s.index });

    const baseBuf = baseline && baseline.pngs ? baseline.pngs.get(s.index) : undefined;
    if (!baseBuf) {
      newSlides.push({ index: s.index });
      continue;
    }
    const d = diffPng(baseBuf, s.png, { pixelThreshold });
    if (d.sizeMismatch || d.ratio > driftRatio) {
      drift.push({ index: s.index, ratio: d.ratio, sizeMismatch: d.sizeMismatch });
    }
  }

  return {
    ok: hardFailures.length === 0, // SOFT drift NEVER fails the gate (D8 / Premise 3)
    slideCountBaseline: baseCount,
    slideCountNow: nowCount,
    slideCountDelta: nowCount - baseCount,
    hardFailures,
    drift,
    newSlides,
    hasBaseline: Boolean(baseline),
  };
}

// ---------------------------------------------------------------------------
// Baseline IO (gitignored runtime artifacts, D5).
// ---------------------------------------------------------------------------
function deckSlug(deckFile) {
  return deckFile.replace(/[^\w.-]+/g, '_');
}

export function baselineDirFor(deckFile, dir = VISUAL.dir) {
  return path.join(dir, deckSlug(deckFile));
}

function padIndex(i) {
  return String(i).padStart(2, '0');
}

export function loadBaseline(deckFile, dir = VISUAL.dir) {
  const bdir = baselineDirFor(deckFile, dir);
  const metaFile = path.join(bdir, 'slides.json');
  if (!fs.existsSync(metaFile)) return null;
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  } catch {
    return null;
  }
  const pngs = new Map();
  for (let i = 0; i < meta.slideCount; i++) {
    const p = path.join(bdir, `${padIndex(i)}.png`);
    if (fs.existsSync(p)) pngs.set(i, fs.readFileSync(p));
  }
  return { slideCount: meta.slideCount, pngs, capturedAt: meta.capturedAt };
}

export function writeBaseline(deckFile, capture, dir = VISUAL.dir) {
  const bdir = baselineDirFor(deckFile, dir);
  fs.mkdirSync(bdir, { recursive: true });
  // Clear stale PNGs first — a legit edit may have REMOVED a slide, and a left-over
  // higher-index baseline would otherwise compare against nothing forever.
  for (const f of fs.readdirSync(bdir)) {
    if (/\.png$/.test(f)) fs.rmSync(path.join(bdir, f));
  }
  for (const s of capture.slides) {
    fs.writeFileSync(path.join(bdir, `${padIndex(s.index)}.png`), s.png);
  }
  fs.writeFileSync(
    path.join(bdir, 'slides.json'),
    JSON.stringify({ slideCount: capture.slideCount, capturedAt: new Date().toISOString() }, null, 2),
  );
  return { dir: bdir, slideCount: capture.slideCount };
}

// ---------------------------------------------------------------------------
// Driver-facing seam (live-run integration point; not yet wired into the
// push-blocked --once path — same staging posture as ledger's fs seam).
// ---------------------------------------------------------------------------
export async function captureAndCompare(browser, deckFile, opts = {}) {
  const capture = await captureSlides(browser, deckFile, opts);
  const baseline = loadBaseline(deckFile, opts.dir);
  const result = compareCapture(baseline, capture, opts);
  return { capture, result };
}

export async function refreshBaseline(browser, deckFile, opts = {}) {
  const capture = await captureSlides(browser, deckFile, opts);
  return writeBaseline(deckFile, capture, opts.dir);
}
