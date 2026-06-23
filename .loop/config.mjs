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
  /^package(-lock)?\.json$/,
  /^\.git\//,
  /^\.gitignore$/,
  /^\.gitattributes$/,
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
  axes: ['render', 'hygiene', 'freshness', 'delight'],
};

// Committed control/data files.
export const MANIFEST_FILE = path.join(LOOP_DIR, 'control-manifest.json');
export const LEDGER_FILE = path.join(LOOP_DIR, 'ledger.json');
export const RUN_FILE = path.join(LOOP_DIR, 'run.json');
export const LOOP_STATUS_FILE = path.join(LOOP_DIR, 'LOOP_STATUS');

// Gitignored runtime/baseline files (D5).
export const STATUS_FILE = path.join(LOOP_DIR, 'status.json');
export const BASELINE_DIR = path.join(LOOP_DIR, 'baseline');
export const SLIDES_BASELINE = path.join(BASELINE_DIR, 'slides.json');

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
