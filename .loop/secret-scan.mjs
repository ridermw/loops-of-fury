// .loop/secret-scan.mjs — per-iteration secret scanner (D31). Control plane (D28).
//
// Pure logic + CLI + a second barrier alongside the diff-gate. The maker may only
// edit the decks/assets, but a secret could still be pasted INTO an allowed file —
// the path allowlist would happily wave it through. This module inspects the ADDED
// content of a change and blocks anything that looks like a credential.
//
// Design notes:
//   - Only ADDED lines are scanned (a removed secret is a good thing).
//   - Rules are specific, vendor-shaped patterns + one narrow generic-assignment
//     rule, each with a placeholder allowlist, because the decks legitimately
//     contain code snippets (D35: do not false-positive on the deck's own code).
//   - Matches are REDACTED in output — the scanner never echoes a real secret.
import { pathToFileURL } from 'node:url';
import { git } from './lib/proc.mjs';

// Obvious non-secrets that show up in example/snippet code. Word-based only —
// deliberately NOT bare angle brackets, because every HTML line has `<`/`>` and
// blanket-skipping them would disable the scanner on the decks (D35).
const PLACEHOLDER_WORDS = [
  'example', 'placeholder', 'changeme', 'your-', 'your_', 'xxxx', 'dummy',
  'redacted', 'fake', 'sample', 'todo', 'replace-me', '...', '****', 'lorem',
];

function hasPlaceholderWord(s) {
  const low = s.toLowerCase();
  return PLACEHOLDER_WORDS.some((p) => low.includes(p));
}

// A candidate token is a placeholder if it contains a placeholder word, is wrapped
// like <replace-me>, or is an env reference rather than a literal value.
function isPlaceholderCandidate(c) {
  const t = c.trim();
  if (hasPlaceholderWord(t)) return true;
  if (/^<.*>$/.test(t)) return true;
  if (t.includes('process.env') || t.includes('import.meta.env')) return true;
  return false;
}

// Each rule: specific vendor token shapes + one guarded generic rule.
const RULES = [
  { id: 'aws-access-key-id', rx: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'github-token', rx: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g },
  { id: 'github-pat-fine', rx: /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/g },
  { id: 'slack-token', rx: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'google-api-key', rx: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
  { id: 'private-key-block', rx: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { id: 'jwt', rx: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  {
    // Narrow generic: `secret|token|password|api_key = "long-value"`.
    id: 'generic-secret-assignment',
    rx: /(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)["']?\s*[:=]\s*["']([^"']{12,})["']/gi,
    captured: 1,
  },
];

function redact(s) {
  const str = String(s);
  if (str.length <= 6) return '*'.repeat(str.length);
  return `${str.slice(0, 4)}…${str.length}ch`;
}

// Scan a single block of (already added) text. Returns findings with 1-based line.
export function scanText(text) {
  const findings = [];
  const lines = String(text).split('\n');
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      rule.rx.lastIndex = 0;
      let m;
      while ((m = rule.rx.exec(line)) !== null) {
        const candidate = rule.captured ? m[rule.captured] : m[0];
        if (hasPlaceholderWord(line) || isPlaceholderCandidate(candidate)) continue;
        findings.push({ rule: rule.id, line: i + 1, match: redact(candidate) });
      }
    }
  });
  return findings;
}

// Scan a unified diff: only ADDED lines (`+` but not the `+++` file header).
export function scanDiff(diffText) {
  const added = [];
  for (const line of String(diffText).split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added.push(line.slice(1));
  }
  return scanText(added.join('\n'));
}

// Scan the working-tree diff for the given repo-relative paths (pre-commit use).
// With no paths, scans the whole unstaged+staged working-tree diff.
export function scanWorktree(paths = []) {
  const args = ['diff', '-U0', 'HEAD', '--'];
  const res = git(paths.length ? [...args, ...paths] : ['diff', '-U0', 'HEAD']);
  return scanDiff(res.stdout || '');
}

// Scan the STAGED diff (pre-push hook use).
export function scanStaged() {
  const res = git(['diff', '--cached', '-U0']);
  return scanDiff(res.stdout || '');
}

function main(argv) {
  const staged = argv.includes('--staged');
  const fileArgs = argv.filter((a) => !a.startsWith('--'));
  const findings = staged ? scanStaged() : scanWorktree(fileArgs);
  if (findings.length === 0) {
    console.log('secret-scan: OK (no secret-like tokens in added content)');
    process.exit(0);
  }
  console.error('secret-scan: BLOCKED — secret-like tokens in added content:');
  for (const f of findings) console.error(`  - [${f.rule}] line ${f.line}: ${f.match}`);
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2));
}
