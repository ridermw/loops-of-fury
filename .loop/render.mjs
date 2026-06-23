// .loop/render.mjs — shared single-Chromium render harness (D9). Control plane (D28).
// Renders a deck from the local filesystem and reports objective signals:
// console/page errors, slide counts, and horizontal overflow.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { REPO_ROOT, VIEWPORT, CONSOLE_ALLOW, RENDER_TIMEOUT_MS } from './config.mjs';

export async function withBrowser(fn) {
  const browser = await chromium.launch();
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

// Shared load+ready wait used by the gate's renderDeck AND visual.captureSlides
// (DRY — one definition of "the deck is ready"). Throws on timeout; callers that
// want a soft signal (renderDeck) wrap it in try/catch.
export async function gotoReady(page, url) {
  await page.goto(url, { waitUntil: 'load', timeout: RENDER_TIMEOUT_MS });
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.reveal');
      const ready = el && el.classList.contains('ready');
      const apiReady = window.Reveal && typeof window.Reveal.isReady === 'function' && window.Reveal.isReady();
      return Boolean(ready || apiReady);
    },
    { timeout: RENDER_TIMEOUT_MS },
  );
}

export async function renderDeck(browser, deckFile) {
  const url = pathToFileURL(path.join(REPO_ROOT, deckFile)).href;
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (!CONSOLE_ALLOW.some((rx) => rx.test(text))) consoleErrors.push(text);
  });
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message ? err.message : err)));

  let loadError = null;
  try {
    await gotoReady(page, url);
  } catch (e) {
    loadError = String(e && e.message ? e.message : e);
  }

  const metrics = await page.evaluate(() => {
    const tops = Array.from(document.querySelectorAll('.reveal .slides > section'));
    let total = 0;
    for (const s of tops) {
      const verts = s.querySelectorAll(':scope > section');
      total += verts.length ? verts.length : 1;
    }
    const de = document.documentElement;
    const overflowX = de.scrollWidth > de.clientWidth + 2;
    const ready = (() => {
      const el = document.querySelector('.reveal');
      return Boolean(el && el.classList.contains('ready'));
    })();
    // Content anchors (D32): scoped to rendered slide content (DOM, not regex —
    // D35), which naturally excludes <head> CDN/font <link> tags. Headings give
    // a structural floor; in-slide external <a> give the attribution floor.
    const root = document.querySelector('.reveal .slides') || document.body || document;
    const headings = Array.from(root.querySelectorAll('h1,h2,h3'))
      .map((h) => (h.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const citations = Array.from(root.querySelectorAll('a[href]'))
      .map((a) => a.getAttribute('href') || '')
      .filter((h) => /^https?:\/\//i.test(h));
    return {
      revealReady: ready, horizontalSlides: tops.length, totalSlides: total, overflowX,
      anchors: { headings, citations },
    };
  });

  await ctx.close();
  return { deckFile, consoleErrors, pageErrors, loadError, ...metrics };
}
