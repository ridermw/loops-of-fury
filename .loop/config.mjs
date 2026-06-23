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

// Committed control/data files.
export const MANIFEST_FILE = path.join(LOOP_DIR, 'control-manifest.json');
export const LEDGER_FILE = path.join(LOOP_DIR, 'ledger.json');
export const RUN_FILE = path.join(LOOP_DIR, 'run.json');
export const LOOP_STATUS_FILE = path.join(LOOP_DIR, 'LOOP_STATUS');

// Gitignored runtime/baseline files (D5).
export const STATUS_FILE = path.join(LOOP_DIR, 'status.json');
export const BASELINE_DIR = path.join(LOOP_DIR, 'baseline');
export const SLIDES_BASELINE = path.join(BASELINE_DIR, 'slides.json');

// Maker (copilot CLI) wiring — verified/tuned in the dry-run task.
// Non-interactive copilot requires every used tool to be pre-allowed (D25):
// use --allow-tool=<list>, never --allow-all-paths.
export const MAKER = {
  bin: 'copilot',
  allowTools: ['str_replace_editor', 'view', 'edit', 'create'],
  timeoutMs: 240000,
};
