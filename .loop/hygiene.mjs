// .loop/hygiene.mjs — link hygiene & freshness (D33). Control plane (D28).
//
// Resolves Open Question 1 (link policy) with a deliberate HARD/SOFT split:
//
//   HARD (objective, gating — joins the checker's red path immediately):
//     - INTERNAL anchors: an in-deck `href="#id"` whose target id does not exist.
//     - ASSETS: a relative `src`/`href` pointing at a local file that is not on disk.
//   These are deterministic, network-free defects the maker must never introduce.
//
//   SOFT (external citations — NEVER gates a single iteration):
//     - Each in-slide external citation is HEAD-checked over the network through an
//       INJECTABLE seam. A flaky/down remote host must not revert `main`, so a
//       failure is recorded, not gated. A url that fails for `externalEscalateK`
//       CONSECUTIVE iterations is surfaced as an escalation (observability via the
//       run-issue) — still not a hard gate. This ends gating oscillation (D33).
//
// DRY / D35: external link inputs are the DOM-sourced in-slide citations
// (render.anchors.citations = `.reveal .slides a[href^=http]`). Sourcing from the
// DOM — not a regex over raw HTML — is what excludes xmlns namespace URIs (e.g.
// http://www.w3.org from `<svg xmlns>`) and CDN <head> links, which are not
// freshness targets. CDN availability is proven implicitly: a dead CDN means the
// deck never initialises and the render gate is already red.
//
// Layering mirrors visual.mjs / anchors.mjs: pure classification → pure hard checks
// → pure freshness policy → injectable network seam → thin state IO → driver hook.
// The driver hook is the live-run integration point and is intentionally NOT wired
// into the push-blocked `--once` path yet (same staging posture as ledger/visual).

import fs from 'node:fs';
import path from 'node:path';
import { LINK, LINK_STATE_FILE } from './config.mjs';

// ── Pure classification ─────────────────────────────────────────────────────

// Normalize a link for set/state identity: trim only. External URLs can be
// path-case-sensitive, so we deliberately do NOT lowercase here.
export function normUrl(u) {
  return String(u == null ? '' : u).trim();
}

// Classify an href/src value into a policy bucket:
//   'external'        — http(s):// or protocol-relative (//host/…) → SOFT freshness
//   'internal-anchor' — pure fragment (#id) → HARD (target must exist in the deck)
//   'asset'           — relative local path (assets/x.png, ./x, ../x, x.css) → HARD
//   'other'           — mailto:/tel:/javascript:/data:/empty → ignored by policy
export function classifyHref(href) {
  const s = normUrl(href);
  if (!s) return 'other';
  if (/^https?:\/\//i.test(s)) return 'external';
  if (/^\/\//.test(s)) return 'external'; // protocol-relative
  if (/^(mailto:|tel:|javascript:|data:)/i.test(s)) return 'other';
  if (s.startsWith('#')) return 'internal-anchor';
  // Absolute site-root path (/foo) or any relative path → treat as a local asset.
  return 'asset';
}

// ── Pure HARD checks (deterministic, network-free) ──────────────────────────

// Given the set of element ids present in the rendered deck and the list of
// in-deck href values, return the fragment refs whose target id is ABSENT.
// `#` alone (top-of-page) is always valid. An existing id resolves the ref even
// when the target is an SVG <marker>/<filter> def — those are not broken links.
// Reveal.js hash-route hrefs (`#/`, `#/3`, `#/3/2`, `#/named-slide`) are framework
// navigation, NOT element-id references, so any slash-prefixed fragment is exempt
// (otherwise the deck's own "home" link `#/` reads as a broken anchor — a false
// positive caught by the live smoke against the real Reveal decks).
export function brokenInternalAnchors(idSet, hrefs) {
  const ids = idSet instanceof Set ? idSet : new Set(idSet || []);
  const out = [];
  const seen = new Set();
  for (const href of hrefs || []) {
    if (classifyHref(href) !== 'internal-anchor') continue;
    const frag = normUrl(href).slice(1); // drop leading '#'
    if (!frag) continue; // bare '#' is valid (top of page)
    if (frag.startsWith('/')) continue; // Reveal hash-route (#/, #/3, #/slide) — not an id ref
    if (seen.has(frag)) continue;
    seen.add(frag);
    if (!ids.has(frag)) out.push(`#${frag}`);
  }
  return out;
}

// Given the deck's on-disk path and its relative asset refs, return the refs that
// do not resolve to an existing file. `existsFn` is injectable for tests.
export function missingAssets(deckPath, refs, existsFn = fs.existsSync) {
  const baseDir = path.dirname(String(deckPath || '.'));
  const out = [];
  const seen = new Set();
  for (const ref of refs || []) {
    if (classifyHref(ref) !== 'asset') continue;
    const raw = normUrl(ref);
    // Strip any query/hash suffix before resolving the file path.
    const clean = raw.split(/[?#]/)[0];
    if (!clean) continue;
    if (seen.has(clean)) continue;
    seen.add(clean);
    const resolved = clean.startsWith('/')
      ? path.resolve(baseDir, clean.replace(/^\/+/, '')) // site-root-relative → deck dir root
      : path.resolve(baseDir, clean);
    if (!existsFn(resolved)) out.push(ref);
  }
  return out;
}

// Gate-facing aggregator (parallel to anchors.anchorFailures): render the HARD
// link violations as checker failure strings. inv = { ids, hrefs, assets, deckPath }.
export function hardLinkFailures(deckFile, inv = {}, opts = {}) {
  const { ids, hrefs = [], assets = [], deckPath = deckFile } = inv;
  const existsFn = opts.existsFn || fs.existsSync;
  const out = [];
  for (const frag of brokenInternalAnchors(ids, hrefs)) {
    out.push(`${deckFile}: broken internal anchor — ${frag}`);
  }
  for (const ref of missingAssets(deckPath, assets, existsFn)) {
    out.push(`${deckFile}: missing asset — ${ref}`);
  }
  return out;
}

// ── Pure SOFT freshness policy (D33) ────────────────────────────────────────

function compileIgnore(ignore) {
  return (ignore || []).map((src) => (src instanceof RegExp ? src : new RegExp(src)));
}

// Pure D33 evaluation. Inputs:
//   citations  — array of external url strings (DOM-sourced).
//   prevState  — { [url]: consecutiveMissCount } from prior iterations.
//   results    — array|Map of { url, ok, status } from the (injected) checker.
//   opts       — { escalateK, ignore } (ignore = array of RegExp or source strings).
// External links NEVER gate, so `ok` is ALWAYS true; the verdict instead carries
// `failures` (this-iteration misses) and `escalations` (>= K consecutive misses)
// for the run-issue / observability, plus the carried-forward `nextState`.
export function evaluateFreshness(citations, prevState, results, opts = {}) {
  const escalateK = opts.escalateK == null ? 3 : opts.escalateK;
  const ignore = compileIgnore(opts.ignore);
  const prev = prevState || {};

  // Index results by normalized url for lookup.
  const resMap = new Map();
  const iter = results instanceof Map ? results.entries() : (results || []).map((r) => [normUrl(r.url), r]);
  for (const [k, r] of iter) resMap.set(normUrl(k), r);

  const nextState = {};
  const checked = [];
  const failures = [];
  const escalations = [];
  const seen = new Set();

  for (const c of citations || []) {
    if (classifyHref(c) !== 'external') continue;
    const url = normUrl(c);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    if (ignore.some((re) => re.test(url))) continue; // allowlisted → not checked/counted

    const r = resMap.get(url);
    if (r === undefined) {
      // Not checked this iteration → carry the prior miss count unchanged.
      if (prev[url]) nextState[url] = prev[url];
      continue;
    }
    checked.push(url);
    if (r.ok) {
      // Fresh → reset the consecutive-miss counter (omit from nextState = 0).
      continue;
    }
    const misses = (prev[url] || 0) + 1;
    nextState[url] = misses;
    const status = r.status == null ? 0 : r.status;
    failures.push({ url, status, misses });
    if (misses >= escalateK) escalations.push({ url, status, misses });
  }

  return { ok: true, checked, failures, escalations, nextState };
}

// ── Injectable network seam (the ONLY network-touching code) ────────────────

// Default external checker: a single HEAD (falling back to GET when a server
// rejects HEAD) with an AbortController timeout. Node 20 global `fetch` — no new
// dependency. Tests NEVER call this; they inject a mocked result list instead.
export async function defaultFetchHead(url, opts = {}) {
  const timeoutMs = opts.timeoutMs == null ? 8000 : opts.timeoutMs;
  const fetchImpl = opts.fetch || globalThis.fetch;
  const u = normUrl(url);
  async function once(method) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(u, { method, redirect: 'follow', signal: ctrl.signal });
      return { url: u, ok: res.ok, status: res.status };
    } finally {
      clearTimeout(t);
    }
  }
  try {
    const head = await once('HEAD');
    // Some hosts reject HEAD (405/501) — retry once with GET before judging.
    if (!head.ok && (head.status === 405 || head.status === 501)) {
      try {
        return await once('GET');
      } catch {
        return head;
      }
    }
    return head;
  } catch (e) {
    return { url: u, ok: false, status: 0, error: String(e && e.message ? e.message : e) };
  }
}

// ── Thin state IO (gitignored runtime, D5) ──────────────────────────────────

export function loadLinkState(file = LINK_STATE_FILE) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

export function saveLinkState(state, file = LINK_STATE_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state || {}, null, 2) + '\n');
}

// ── Driver-facing hook (live-run integration point; not wired into --once) ──

// Load prior miss state, HEAD-check the external citations through the (injectable)
// seam, evaluate the D33 policy, persist the carried-forward state, return the
// verdict. The escalations in the verdict are what the loop surfaces to the
// run-issue; the deck is NEVER reverted on a freshness failure (soft by design).
export async function checkFreshness(citations, opts = {}) {
  const fetchHead = opts.fetchHead || defaultFetchHead;
  const stateFile = opts.stateFile || LINK_STATE_FILE;
  const escalateK = opts.escalateK == null ? LINK.externalEscalateK : opts.escalateK;
  const timeoutMs = opts.timeoutMs == null ? LINK.timeoutMs : opts.timeoutMs;
  const ignore = opts.ignore || LINK.ignore;
  const load = opts.load || loadLinkState;
  const save = opts.save || saveLinkState;

  const compiled = compileIgnore(ignore);
  const seen = new Set();
  const urls = [];
  for (const c of citations || []) {
    if (classifyHref(c) !== 'external') continue;
    const u = normUrl(c);
    if (!u || seen.has(u)) continue;
    seen.add(u);
    if (compiled.some((re) => re.test(u))) continue;
    urls.push(u);
  }

  const prev = load(stateFile);
  const results = await Promise.all(urls.map((u) => fetchHead(u, { timeoutMs })));
  const verdict = evaluateFreshness(urls, prev, results, { escalateK, ignore });
  save(verdict.nextState, stateFile);
  return verdict;
}
