// .loop/maker.mjs — maker abstraction. Control plane (D28).
// The maker proposes deck edits. Two implementations:
//   - noopMaker:    makes no change (used to prove the gate/checker spine).
//   - copilotMaker: shells the Copilot CLI non-interactively (wired here,
//                   exercised/tuned in the dry-run task). NOT called by the
//                   spine self-tests.
// The driver — not the maker — owns all git/gate/commit decisions. The maker
// only edits files; the diff-gate + control-manifest enforce the boundary.
import { REPO_ROOT, MAKER } from './config.mjs';
import { run } from './lib/proc.mjs';

export function noopMaker() {
  return { kind: 'noop', changed: false };
}

export function buildPrompt(axis, deck) {
  return [
    `You are improving the Reveal.js presentation "${deck}".`,
    `Focus axis: ${axis}.`,
    'Hard rules:',
    `- Edit ONLY ${deck}. Do not touch any other file.`,
    '- Do not edit the :root design-token block (colors/fonts are invariant).',
    '- Preserve all existing slide headings, thesis statements, and citations.',
    '- Make one focused, high-quality improvement, then stop.',
  ].join('\n');
}

// Wired but flag-guarded; the spine never calls this. allowTools keeps the
// non-interactive run from prompting (D25) without granting --allow-all-paths.
export function copilotMaker({ axis, deck }) {
  const prompt = buildPrompt(axis, deck);
  const args = [
    '-p', prompt,
    '-C', REPO_ROOT,
    '--add-dir', REPO_ROOT,
    `--allow-tool=${MAKER.allowTools.join(',')}`,
    ...(MAKER.extraArgs ?? []),
  ];
  const res = run(MAKER.bin, args, { timeout: MAKER.timeoutMs });
  return { kind: 'copilot', ok: res.ok, stdout: res.stdout, stderr: res.stderr, code: res.code };
}
