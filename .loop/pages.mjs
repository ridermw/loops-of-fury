// .loop/pages.mjs — post-push live-Pages verification (D29 / Eng-Q3). Control plane (D28).
//
// After a GREEN commit is pushed to main, GitHub Pages rebuilds the site. This module
// closes the "green locally but broken live" gap:
//   1. waitForSha  — poll the Pages build API until the DEPLOYED commit == the exact
//      pushed SHA AND status === 'built' (legacy builds report the live SHA), bounded
//      by PAGES.maxWaitMs (Eng-Q3 ≤3 min);
//   2. verifyLive  — render the LIVE deck URLs through the SAME objective gate
//      (assertDeck — slide-count floor, overflow, content-anchor floor D32);
//   3. liveCheckAfterPush — orchestrates the two into a single decision the loop acts
//      on: ok / revert (live broken) / pause (SHA never observed).
//
// Everything is non-throwing and seam-injected (gh runner, clock, sleep, browser,
// baselines) so the whole module is unit-testable with zero network, zero browser,
// zero credits. The loop performs the actual forward-revert (git) on a non-ok result;
// this module only decides.
import fs from 'node:fs';
import {
  REPO_SLUG, PAGES, DECKS, SLIDES_BASELINE, ANCHORS_BASELINE, pagesDeckUrl,
} from './config.mjs';
import { run as procRun } from './lib/proc.mjs';
import { withBrowser, renderDeckAt } from './render.mjs';
import { assertDeck } from './check.mjs';

const ghDefault = (args, opts = {}) => procRun('gh', args, { timeout: 20000, ...opts });

// Latest Pages build as { status, commit } (or null if the API is unreachable).
export function latestBuild({ gh = ghDefault } = {}) {
  const r = gh(['api', `repos/${REPO_SLUG}/pages/builds/latest`,
    '--jq', '{status: .status, commit: .commit}']);
  if (!r.ok) return null;
  try {
    const o = JSON.parse(r.stdout);
    return { status: o.status ?? null, commit: o.commit ?? null };
  } catch { return null; }
}

// Poll the build API until the deployed commit matches `sha` and is 'built'. Pure
// timing via injected now/sleep/getBuild — no real waiting in tests.
export async function waitForSha(sha, {
  maxWaitMs = PAGES.maxWaitMs,
  pollIntervalMs = PAGES.pollIntervalMs,
  now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  getBuild = (o) => latestBuild(o),
  gh = ghDefault,
} = {}) {
  const deadline = now() + maxWaitMs;
  let last = null;
  for (;;) {
    const b = getBuild({ gh });
    last = b;
    if (b && b.status === 'built' && b.commit === sha) return { ok: true, observed: b };
    if (now() >= deadline) return { ok: false, timedOut: true, last };
    await sleep(pollIntervalMs);
  }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// Render every live deck URL and apply the SAME objective gate as the local checker.
// Non-throwing: a render failure is reported as a live failure (so the loop reverts).
export async function verifyLive({
  decks = DECKS,
  render = withBrowser,
  renderAt = renderDeckAt,
  baseUrl = PAGES.baseUrl,
  slidesBaselineFile = SLIDES_BASELINE,
  anchorsBaselineFile = ANCHORS_BASELINE,
} = {}) {
  const slides = readJson(slidesBaselineFile);
  const anchors = readJson(anchorsBaselineFile);
  let rendered;
  try {
    rendered = await render(async (browser) => {
      const out = [];
      for (const deck of decks) {
        out.push(await renderAt(browser, pagesDeckUrl(deck, baseUrl), deck));
      }
      return out;
    });
  } catch (e) {
    return { ok: false, reason: 'live-render-error', failures: [String(e && e.message ? e.message : e)] };
  }
  const failures = [];
  for (const d of rendered) {
    const baselineCount = slides && typeof slides[d.deckFile] === 'number'
      ? slides[d.deckFile] : undefined;
    const baselineAnchors = anchors ? anchors[d.deckFile] : undefined;
    failures.push(...assertDeck(d, baselineCount, baselineAnchors));
  }
  return { ok: failures.length === 0, failures };
}

// Full post-push live check (D29). Returns a decision the loop acts on:
//   { ok:true, observed }                       — deployed & live-verified GREEN
//   { ok:false, action:'revert', failures }     — deployed but live render is broken
//   { ok:false, action:'pause',  reason, last } — SHA never became observable in budget
// Never throws.
export async function liveCheckAfterPush(sha, opts = {}) {
  const wait = await waitForSha(sha, opts);
  if (!wait.ok) {
    return { ok: false, action: 'pause', reason: 'sha-not-observable', last: wait.last };
  }
  const live = await verifyLive(opts);
  if (!live.ok) {
    return { ok: false, action: 'revert', reason: live.reason || 'live-broken', failures: live.failures };
  }
  return { ok: true, observed: wait.observed };
}
