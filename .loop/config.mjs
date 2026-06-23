// .loop/config.mjs — central control-plane configuration.
// This file is part of the immutable control plane (D28): the maker may NEVER edit it.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const LOOP_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(LOOP_DIR, '..');

// The two Reveal.js decks the loop improves — the product.
export const DECKS = ['index.html', 'workshop.html'];

// Maker write allowlist (D28): decks + shared presentation assets ONLY.
// Anything not matched here is rejected by the diff-gate.
export const ALLOWED_WRITE = [
  /^index\.html$/,
  /^workshop\.html$/,
  /^assets\/.+/,
];

// Explicit forbidden zones (belt-and-suspenders; the control plane is immutable).
export const FORBIDDEN_WRITE = [
  /^\.loop\//,
  /^\.github\//,
  /^\.githooks\//,
  /^package(-lock)?\.json$/,
  /^\.git\//,
  /^\.gitignore$/,
  /^\.gitattributes$/,
];

// Driver-owned data files that ARE committed (D5) and therefore legitimately ride
// along in a loop push, even though they live under the maker-forbidden .loop/.
// The pre-push barrier (push-gate, D30) allows exactly these in addition to the
// maker allowlist — and nothing else under .loop/ (no control-plane CODE).
export const PUSH_ALLOWED_DATA = [
  /^\.loop\/control-manifest\.json$/,
  /^\.loop\/ledger\.json$/,
  /^\.loop\/run\.json$/,
  /^\.loop\/scoreboard\.json$/,
  /^\.loop\/LOOP_STATUS$/,
];

// Canonical presentation viewport (D23) — matches 16:9 deck aspect.
export const VIEWPORT = { width: 1280, height: 720 };

// Console error texts tolerated during render (CDN noise). Extend cautiously.
export const CONSOLE_ALLOW = [
  /favicon/i,
  /\[Deprecation\]/i,
  /Failed to load resource.*fonts\.g/i,
];

// Per-deck render timeout (ms).
export const RENDER_TIMEOUT_MS = 30000;

// Loop orchestration tuning (safety-net). All consumed by the pure brain in
// brain.mjs; kept here so a reader sees every knob in one place.
export const LOOP = {
  maxDurationMs: 8 * 60 * 60 * 1000, // 8-hour hard cap (D36: time terminates, not iter count)
  maxNoops: 5,                       // N consecutive no-ops → stop 'no-progress' (CEO-S2)
  retryK: 3,                         // K consecutive reverts on one axis → switch axis
  churnWindowMs: 30 * 60 * 1000,     // sliding window for revert-churn (D38)
  churnMax: 6,                       // > churnMax reverts within window → escalate (D38)
  heartbeatTtlMs: 15 * 60 * 1000,    // run heartbeat stale after 15min → prior run crashed (D34)
  axes: ['render', 'hygiene', 'freshness', 'delight'],
};

// Committed control/data files.
export const MANIFEST_FILE = path.join(LOOP_DIR, 'control-manifest.json');
export const LEDGER_FILE = path.join(LOOP_DIR, 'ledger.json');
export const RUN_FILE = path.join(LOOP_DIR, 'run.json');
export const LOOP_STATUS_FILE = path.join(LOOP_DIR, 'LOOP_STATUS');
// Weakest-axis scoreboard (D10): committed loop data, mutated every iteration and
// therefore EXCLUDED from the control manifest (see control-manifest.mjs).
export const SCOREBOARD_FILE = path.join(LOOP_DIR, 'scoreboard.json');

// Gitignored runtime/baseline files (D5).
export const STATUS_FILE = path.join(LOOP_DIR, 'status.json');
export const BASELINE_DIR = path.join(LOOP_DIR, 'baseline');
export const SLIDES_BASELINE = path.join(BASELINE_DIR, 'slides.json');
// Frozen content-anchor holdout (D32): per-deck { headings, citations } captured
// at run start and NEVER refreshed during the run — that immutability is the floor.
export const ANCHORS_BASELINE = path.join(BASELINE_DIR, 'anchors.json');

// Visual-regression (D8/D23): per-slide screenshots at the canonical VIEWPORT,
// pixel-diffed against a baseline that REFRESHES on accept (D8 — legit visual
// edits must not self-poison later iterations). Baselines are gitignored runtime
// artifacts (D5): the module CODE is control-plane (committed/manifest-tracked),
// the PNGs are not. Gating policy: a slide-count DROP and any NEW horizontal
// overflow are HARD objective invariants (D23); pixel drift above driftRatio is a
// SOFT flag only (Premise 3 — visual change is non-gating beyond the floor).
export const VISUAL = {
  dir: path.join(BASELINE_DIR, 'visual'), // .loop/baseline/visual/<deck>/NN.png
  pixelThreshold: 0.1,                    // pixelmatch per-pixel color sensitivity (0..1)
  driftRatio: 0.02,                       // > 2% mismatched pixels on a slide → SOFT drift flag
  settleMs: 150,                          // pause after a slide nav before the shot (transition settle)
};

// Link hygiene / freshness (D33): resolves Open Question 1 (link policy).
//   - INTERNAL anchors (`#id`) and local ASSETS (relative src/href) are HARD-gating:
//     a broken intra-deck target or a missing on-disk asset is an objective defect
//     that joins the red path immediately (no network, deterministic).
//   - EXTERNAL citation links are SOFT: checked over the network via an injectable
//     HEAD seam, NEVER gating a single iteration (a flaky remote host must not revert
//     `main`). A url that fails for `externalEscalateK` CONSECUTIVE iterations is
//     surfaced as an escalation (observability via the run-issue) — still not a hard
//     gate. This ends gating oscillation on transiently-down external sites.
// NOTE: external link inputs are the DOM-sourced in-slide citations (render.anchors
// .citations, `.reveal .slides a[href^=http]`) — this is why D35 mandates DOM-not-
// regex: a raw-HTML scan also captures xmlns namespace URIs (e.g. http://www.w3.org)
// and CDN <head> links, which are NOT freshness targets. CDN availability is proven
// implicitly: if the CDN is down the deck never initialises and the gate is already red.
export const LINK = {
  externalEscalateK: 3,   // consecutive failing iterations for one external url → escalate
  timeoutMs: 8000,        // per-link HEAD/GET timeout (ms)
  ignore: [],             // allowlist of regex source strings for known-flaky-but-fine hosts
};
// Gitignored runtime state (D5): per-external-url consecutive-miss counters across
// iterations. Derived/transient — a reset (e.g. fresh process) only makes the soft
// policy MORE lenient, so it is safe to keep out of version control.
export const LINK_STATE_FILE = path.join(BASELINE_DIR, 'link-state.json');

// Maker (copilot CLI) wiring.
// EMPIRICALLY VERIFIED (dry-run de-risk):
//   - `copilot -p "<prompt>" ...` DOES return non-interactively (exits after
//     completion) — proven headless, exit 0, no TTY prompt hang.
//   - Cost: ~35 AI credits and ~90-100s per single maker call. A ~100-iteration
//     run is therefore expensive; the live run is a deliberate, owner-gated spend.
//   - Tool identifiers are ENVIRONMENT-SPECIFIC. In this environment the file
//     reader is `view` and the file editor is `apply_patch` (NOT the generic
//     `write`/`str_replace_editor`). The shell tool here is `powershell`.
// Security (D25): grant the maker ONLY read+edit. With no shell/git tool it is
// physically incapable of running `git push` or escaping the repo. The diff-gate
// + control-manifest + checker + auto-revert remain the real boundary. We never
// pass --allow-all-paths. If an allow-tool name mismatches, the maker simply
// makes no edit (driver sees an empty delta → safe no-op), never a hang.
// NOTE (dry-run TODO): confirm `--allow-tool` accepts the bare name `apply_patch`
// in this CLI build; if not, fall back to `--allow-all-tools --deny-tool=powershell`.
export const MAKER = {
  bin: 'copilot',
  allowTools: ['view', 'apply_patch'],
  extraArgs: ['--no-color', '--log-level', 'error'],
  timeoutMs: 240000,
  approxCreditsPerCall: 35,
};

// Delight LLM-judge (D19, Eng-Q2). The ONLY subjective axis — and per Premise 3 it is
// strictly NON-GATING: a delight score never reverts `main`. Its sole job is to score
// each deck's *taste* and feed the scoreboard (D10) so the loop spends attention where
// the writing is weakest. The objective floor (anchors D32 + visual D23 + hygiene D33)
// is what actually protects `main`; delight only nudges priority.
//
// DRIFT-FREEZE (D19): everything that shapes the verdict is PINNED here — the model,
// `temperature: 0` (deterministic), and the exact rubric criteria + weights. The prompt
// is built deterministically and anchored to THIS deck's tokens/voice via
// design-tokens.md (D20) — not a generic notion of delight. Because delight.mjs and
// this config are control-plane (committed, manifest-tracked, maker-forbidden, D28),
// the maker can never loosen its own taste bar. Changing the rubric is a deliberate
// human control-plane edit, never loop drift.
//
// COST/SAFETY: a real judge call spends credits, so the module takes the model call as
// an INJECTED seam (callModel). The default seam THROWS — the live binding is wired only
// at owner-gated run time. Tests and smokes pass a deterministic mock and never spend.
export const JUDGE_DIR = path.join(LOOP_DIR, 'judge'); // gitignored runtime scores (D5)
export const JUDGE = {
  model: 'copilot-judge-v1', // pinned logical judge id (drift-freeze; owner-confirmed at live wiring)
  temperature: 0,            // deterministic scoring
  maxOutputTokens: 700,
  scaleMax: 5,               // each criterion scored 0..scaleMax (integers)
  approxCreditsPerCall: 35,
  designTokensFile: path.join(LOOP_DIR, 'design-tokens.md'), // D20 rubric anchor
  // Rubric criteria PINNED (drift-freeze). Anchored to design-tokens.md — palette,
  // type/voice, restraint vs the D18 anti-slop list, concreteness, and thesis payoff.
  // Equal weights: taste is multi-dimensional and we don't pretend one axis dominates.
  criteria: [
    { id: 'palette-fidelity', label: 'On-system palette (navy + cool blues + one --fury accent)', weight: 1 },
    { id: 'type-voice',       label: 'Display/body hierarchy + terse, confident, technical voice', weight: 1 },
    { id: 'restraint',        label: 'No AI/marketing slop — no hype, intensifiers, emoji, shouting', weight: 1 },
    { id: 'concreteness',     label: 'Specifics (tools, numbers, sourced claims) over abstraction', weight: 1 },
    { id: 'thesis-payoff',    label: 'Advances the loop-engineering thesis with a real idea', weight: 1 },
  ],
};
// Gitignored runtime state (D5): the latest per-deck delight verdict, kept only for
// the scoreboard + run-issue observability. Transient — losing it just means the next
// iteration re-scores; it never affects the objective gate.
export const JUDGE_STATE_FILE = path.join(JUDGE_DIR, 'delight-state.json');
