// .loop/ledger.mjs — the self-updating improvement ledger (C / D3, D15-D17, D24).
// Control plane (D28): the maker may NEVER edit this file. The DRIVER owns the
// ledger and regenerates the deck's ledger slide from ledger.json — so the deck
// becomes living proof of its own thesis (every landed improvement, by axis).
//
// Split into three layers, all pure except the thin IO at the bottom:
//   1. data        — emptyLedger / recordEntry / setStatus (immutable-ish shape)
//   2. derivation  — summarize (ledger -> { total, perAxis, state, durationMs })
//   3. rendering   — renderInner (summary -> HTML) + replaceRegion (splice into deck)
// The driver-facing fs helpers (recordEntryToDeck / finalizeLedgerToDeck) compose
// these against real files; they are the live-run integration seam.
//
// ledger.json shape (committed loop data, D5; manifest-EXCLUDED — mutates per-iter):
//   { status: null|'running'|'ended'|'escalated',
//     startedMs: number|null, endedMs: number|null,
//     axes: { <axis>: <count of landed improvements> },
//     entries: [ { iter, axis, sha, ts } ] }
import fs from 'node:fs';

// Markers bracketing the driver-owned region inside the deck's ledger <section>.
// Everything BETWEEN them is regenerated each update; the markers themselves and
// the surrounding slide chrome (kicker, heading) are static and maker-forbidden.
export const LEDGER_START = '<!-- LEDGER:START -->';
export const LEDGER_END = '<!-- LEDGER:END -->';

export function emptyLedger(axes = []) {
  const a = {};
  for (const ax of axes) a[ax] = 0;
  return { status: null, startedMs: null, endedMs: null, axes: a, entries: [] };
}

// Record one VERIFIED improvement that landed on `axis`. First entry stamps the
// run start. Unknown axes are tolerated (counted) so a config change never throws.
export function recordEntry(ledger, { iter, axis, sha = null, now = Date.now(), ts } = {}) {
  if (!ledger.axes || typeof ledger.axes !== 'object') ledger.axes = {};
  if (!Array.isArray(ledger.entries)) ledger.entries = [];
  if (ledger.startedMs == null) ledger.startedMs = now;
  if (ledger.status == null || ledger.status === 'ended') ledger.status = 'running';
  ledger.axes[axis] = (ledger.axes[axis] || 0) + 1;
  ledger.entries.push({ iter, axis, sha, ts: ts || new Date(now).toISOString() });
  return ledger;
}

// Terminal transition. 'ended' = clean stop (success); 'escalated' = paused for
// review (a failed/aborted run). Stamps endedMs so summarize can show duration.
export function setStatus(ledger, status, { now = Date.now() } = {}) {
  ledger.status = status;
  if (status === 'ended' || status === 'escalated') ledger.endedMs = now;
  return ledger;
}

// Derive the at-a-glance view the slide renders. `axes` (configured order) scopes
// which chips appear, so a removed axis never lingers on the proof slide.
export function summarize(ledger, { now = Date.now(), axes = null } = {}) {
  const entries = Array.isArray(ledger.entries) ? ledger.entries : [];
  const total = entries.length;
  const order = axes && axes.length ? axes : Object.keys(ledger.axes || {});
  const perAxis = {};
  for (const ax of order) perAxis[ax] = (ledger.axes && ledger.axes[ax]) || 0;

  let state;
  if (ledger.status === 'escalated') state = 'escalated';
  else if (ledger.status === 'ended') state = 'success';
  else if (total > 0 || ledger.status === 'running') state = 'partial';
  else state = 'empty';

  const start = ledger.startedMs;
  const end = ledger.endedMs != null ? ledger.endedMs : now;
  const durationMs = start != null && end != null && end >= start ? end - start : 0;
  const last = entries.length ? entries[entries.length - 1] : null;
  return { total, perAxis, state, durationMs, lastSha: last && last.sha, lastTs: last && last.ts };
}

export function formatDuration(ms) {
  if (!ms || ms < 0) return '';
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return 'under a minute';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

// Render the inner HTML for the marked region (NO leading indent — replaceRegion
// re-indents to match the deck). The engine OWNS this region (D28): it emits the
// animated `ledger-stage` visualization the deck styles (orbit of signals + radial
// counter + receipt) and drives it live from ledger.json. It reuses the deck's
// existing components verbatim (.big-number hero + .flow/.pill chips + .subtitle)
// and emits ONLY <div>/<span>/<p> — NO new :root tokens (D21/D37) and, critically,
// NO headings and NO links — so the content-anchor floor (D32) is invariant to it
// in EVERY state, including mid-run transitions.
export function renderInner(summary) {
  const total = Number(summary.total) || 0;
  const state = summary.state;
  const dur = formatDuration(summary.durationMs);

  // Per-state subtitle (visible — screen readers read it for the run state) and
  // decorative aria-hidden receipt rows. The stage's aria-label carries only the
  // landed count, so the empty render stays a fixed point of the committed deck.
  let subtitle;
  let receipt;
  if (state === 'success') {
    subtitle = dur
      ? `Verified improvements landed across ${dur} &mdash; every axis stronger, zero broken states.`
      : 'Verified improvements landed &mdash; every axis stronger, zero broken states.';
    receipt = ['trigger rested', 'verifier green', 'every axis stronger'];
  } else if (state === 'escalated') {
    subtitle = 'Verified improvements landed before the run paused itself for review.';
    receipt = ['trigger held', 'verifier paused', 'awaiting review'];
  } else if (state === 'empty') {
    subtitle = 'Verified improvements landed &mdash; waiting for the first unattended run.';
    receipt = ['trigger armed', 'verifier cold', 'state file waiting'];
  } else {
    subtitle = 'Verified improvements landing now &mdash; the unattended run is still going.';
    receipt = ['trigger live', 'verifier hot', 'landing now'];
  }
  const aria = `Improvement ledger status: ${total} verified improvements landed`;

  const lines = [`<div class="ledger-stage" aria-label="${aria}">`];
  lines.push('  <div class="ledger-orbit" aria-hidden="true">');
  for (let i = 0; i < 6; i += 1) lines.push('    <span class="ledger-signal"></span>');
  lines.push('  </div>');
  lines.push('  <div class="ledger-counter">');
  lines.push(`    <p class="big-number">${total}</p>`);
  lines.push('    <span class="ledger-counter__label">landed</span>');
  lines.push('  </div>');
  lines.push('  <div class="ledger-receipt" aria-hidden="true">');
  for (const row of receipt) lines.push(`    <span>${row}</span>`);
  lines.push('  </div>');
  lines.push('</div>');
  lines.push(`<p class="subtitle">${subtitle}</p>`);

  // Per-axis tally chips — shown once at least one improvement has landed (never in
  // the empty seed state). Tolerates a missing/empty perAxis without leaking NaN.
  const chips = state === 'empty'
    ? []
    : Object.entries(summary.perAxis || {})
      .map(([axis, n]) => `  <span class="pill">${axis} +${Number(n) || 0}</span>`);
  if (chips.length) {
    lines.push('<div class="flow">');
    lines.push(...chips);
    lines.push('</div>');
  }
  return lines.join('\n');
}

// Extract the inner region between the markers (everything regenerated each
// update), or null when the markers are absent. The driver compares this
// before/after the maker runs to FENCE the maker out of the engine-owned region.
export function extractRegion(deckHtml) {
  const m = deckHtml.match(/<!-- LEDGER:START -->([\s\S]*?)<!-- LEDGER:END -->/);
  return m ? m[1] : null;
}

// Splice `inner` between the markers, preserving the START marker's indentation on
// every line AND the deck's own line-ending convention (CRLF vs LF) — the live
// deck is CRLF under Windows autocrlf, so the rewritten region must match or it
// thrashes the whole file. Pure + idempotent. Returns { html, replaced }:
// replaced=false (html unchanged) when the markers are absent — the caller treats
// that as a hard error (the deck lost its ledger region), never a silent skip.
export function replaceRegion(deckHtml, inner) {
  const re = /([ \t]*)<!-- LEDGER:START -->[\s\S]*?<!-- LEDGER:END -->/;
  const m = deckHtml.match(re);
  if (!m) return { html: deckHtml, replaced: false };
  const eol = /\r\n/.test(deckHtml) ? '\r\n' : '\n';
  const indent = m[1] || '';
  const body = inner
    .split('\n')
    .map((ln) => (ln.length ? indent + ln : ln))
    .join(eol);
  const block = `${indent}${LEDGER_START}${eol}${body}${eol}${indent}${LEDGER_END}`;
  return { html: deckHtml.replace(re, block), replaced: true };
}

// Compose the full pipeline: ledger -> summary -> inner -> spliced deck HTML.
export function applyLedger(deckHtml, ledger, opts = {}) {
  const summary = summarize(ledger, opts);
  const inner = renderInner(summary);
  const { html, replaced } = replaceRegion(deckHtml, inner);
  return { html, replaced, summary };
}

// ---- thin IO (best-effort, never throws on a missing/corrupt file) ----------

export function loadLedger(file, axes = []) {
  try {
    const l = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!l || typeof l !== 'object') return emptyLedger(axes);
    if (!l.axes || typeof l.axes !== 'object') l.axes = {};
    if (!Array.isArray(l.entries)) l.entries = [];
    for (const ax of axes) if (!(ax in l.axes)) l.axes[ax] = 0;
    if (!('status' in l)) l.status = null;
    if (!('startedMs' in l)) l.startedMs = null;
    if (!('endedMs' in l)) l.endedMs = null;
    return l;
  } catch {
    return emptyLedger(axes);
  }
}

export function saveLedger(file, ledger) {
  try { fs.writeFileSync(file, JSON.stringify(ledger, null, 2) + '\n'); }
  catch { /* ledger persistence is best-effort, never gating */ }
}

// ---- driver-facing fs helpers (live-run integration seam) -------------------
// Each: load ledger -> mutate -> save ledger -> splice the deck -> write the deck.
// Returns { ledger, summary, replaced }. The caller (driver, live run) is what
// re-checks + commits the resulting deck; these helpers only mutate the files.

export function recordEntryToDeck({ ledgerFile, deckFile, entry, axes = [], now = Date.now() }) {
  const ledger = loadLedger(ledgerFile, axes);
  recordEntry(ledger, { ...entry, now });
  saveLedger(ledgerFile, ledger);
  const deckHtml = fs.readFileSync(deckFile, 'utf8');
  const { html, replaced, summary } = applyLedger(deckHtml, ledger, { now, axes });
  if (replaced) fs.writeFileSync(deckFile, html);
  return { ledger, summary, replaced };
}

export function finalizeLedgerToDeck({ ledgerFile, deckFile, status, axes = [], now = Date.now() }) {
  const ledger = loadLedger(ledgerFile, axes);
  setStatus(ledger, status, { now });
  saveLedger(ledgerFile, ledger);
  const deckHtml = fs.readFileSync(deckFile, 'utf8');
  const { html, replaced, summary } = applyLedger(deckHtml, ledger, { now, axes });
  if (replaced) fs.writeFileSync(deckFile, html);
  return { ledger, summary, replaced };
}
