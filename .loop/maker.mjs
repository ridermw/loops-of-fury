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

// User-directed task maker (intake): same security posture as the axis maker, but the
// instruction is a maintainer's explicit ask (issue title+body) instead of a polish axis.
// The SAME hard rules apply — the maker may only make a gate-passable, deck-only edit; if
// the ask can't be done within those rules it makes NO change (a clean no-op the driver
// sees as an empty delta), so a structural ask never thrashes the gate.
export function buildTaskPrompt(task, deck) {
  const title = String(task && task.title ? task.title : '').trim();
  const body = String(task && task.body ? task.body : '').trim();
  const quotedBody = body
    ? body.split('\n').map((l) => `> ${l}`).join('\n')
    : '> (no further detail provided)';
  return [
    `You are improving the Reveal.js presentation "${deck}".`,
    'A maintainer filed this specific request (GitHub issue):',
    `> TITLE: ${title}`,
    '>',
    quotedBody,
    '',
    'Do exactly what the request asks, as ONE focused edit. Hard rules:',
    `- Edit ONLY ${deck}. Do not touch any other file.`,
    '- Do not edit the :root design-token block (colors/fonts are invariant).',
    '- Preserve all existing slide headings, thesis statements, and citations.',
    '- Do not add or remove whole slides.',
    '- If the request cannot be satisfied within these rules, make NO change at all.',
    '- Make the one requested improvement, then stop.',
  ].join('\n');
}

export function copilotTaskMaker({ task, deck }) {
  const prompt = buildTaskPrompt(task, deck);
  const args = [
    '-p', prompt,
    '-C', REPO_ROOT,
    '--add-dir', REPO_ROOT,
    `--allow-tool=${MAKER.allowTools.join(',')}`,
    ...(MAKER.extraArgs ?? []),
  ];
  const res = run(MAKER.bin, args, { timeout: MAKER.timeoutMs });
  return { kind: 'copilot-task', ok: res.ok, stdout: res.stdout, stderr: res.stderr, code: res.code };
}
