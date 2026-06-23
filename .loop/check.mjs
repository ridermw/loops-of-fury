// .loop/check.mjs — THE GATE (D2). Objective deck checker; never `npm test`.
// Renders both decks in one Chromium and asserts render + basic-hygiene invariants:
//   - Reveal initializes (no load error)
//   - no unfiltered console errors / page errors
//   - total slide count >= baseline (no silent content loss)
//   - no horizontal overflow at the canonical viewport
// Exits 0 (green) / 1 (red). Also importable as runCheck() for in-process use.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DECKS, SLIDES_BASELINE, STATUS_FILE } from './config.mjs';
import { withBrowser, renderDeck } from './render.mjs';

function loadBaseline() {
  try {
    return JSON.parse(fs.readFileSync(SLIDES_BASELINE, 'utf8'));
  } catch {
    return null;
  }
}

export async function runCheck() {
  const baseline = loadBaseline();
  const decks = await withBrowser(async (browser) => {
    const results = [];
    for (const deck of DECKS) {
      results.push(await renderDeck(browser, deck));
    }
    return results;
  });

  const failures = [];
  for (const d of decks) {
    if (d.loadError) failures.push(`${d.deckFile}: load error — ${d.loadError}`);
    if (!d.revealReady) failures.push(`${d.deckFile}: Reveal did not become ready`);
    for (const e of d.consoleErrors) failures.push(`${d.deckFile}: console error — ${e}`);
    for (const e of d.pageErrors) failures.push(`${d.deckFile}: page error — ${e}`);
    if (d.overflowX) failures.push(`${d.deckFile}: horizontal overflow at ${'1280x720'}`);
    if (d.totalSlides < 1) failures.push(`${d.deckFile}: no slides found`);
    if (baseline && typeof baseline[d.deckFile] === 'number' && d.totalSlides < baseline[d.deckFile]) {
      failures.push(`${d.deckFile}: slide count regressed ${baseline[d.deckFile]} -> ${d.totalSlides}`);
    }
  }

  const result = {
    ok: failures.length === 0,
    timestamp: new Date().toISOString(),
    baseline,
    decks: decks.map((d) => ({
      deck: d.deckFile,
      revealReady: d.revealReady,
      totalSlides: d.totalSlides,
      horizontalSlides: d.horizontalSlides,
      overflowX: d.overflowX,
      consoleErrors: d.consoleErrors.length,
      pageErrors: d.pageErrors.length,
    })),
    failures,
  };

  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(result, null, 2) + '\n');
  } catch { /* status is best-effort */ }

  return result;
}

function printReport(result) {
  for (const d of result.decks) {
    console.log(
      `  ${d.deck}: slides=${d.totalSlides} (h=${d.horizontalSlides}) ` +
      `ready=${d.revealReady} overflow=${d.overflowX} ` +
      `consoleErr=${d.consoleErrors} pageErr=${d.pageErrors}`,
    );
  }
  if (result.ok) {
    console.log('check: GREEN');
  } else {
    console.error('check: RED');
    for (const f of result.failures) console.error(`  ✗ ${f}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runCheck()
    .then((result) => {
      printReport(result);
      process.exit(result.ok ? 0 : 1);
    })
    .catch((err) => {
      console.error('check: ERROR —', err && err.stack ? err.stack : err);
      process.exit(2);
    });
}
