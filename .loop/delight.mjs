// .loop/delight.mjs — delight LLM-judge axis (D19). Control plane (D28).
//
// The ONE subjective axis. Per Premise 3 it is strictly NON-GATING: a delight score
// NEVER reverts `main`. Its only job is to score each deck's *taste* — palette fidelity,
// voice, restraint, concreteness, thesis payoff — anchored to THIS deck's tokens via
// design-tokens.md (D19/D20), and feed that score to the scoreboard (D10) so the loop
// spends its next move where the writing is weakest. The objective floor (anchors D32 +
// visual D23 + hygiene D33) is what actually protects `main`.
//
// Layering mirrors visual.mjs / hygiene.mjs:
//   - PURE rubric/prompt builders (buildRubric / buildPrompt) — deterministic, anchored
//     to the pinned criteria + design tokens (drift-freeze, D19);
//   - PURE parse/validate (extractJsonBlock / parseVerdict) — the LLM TRUST BOUNDARY:
//     model output is untrusted text; a malformed or out-of-range verdict is REJECTED,
//     never coerced into a passing score;
//   - PURE aggregation/policy (summarizeDelight) — weighted mean → verdict whose `ok`
//     is ALWAYS true (a broken judge must not gate);
//   - thin score-state IO over the gitignored JUDGE_STATE_FILE (D5);
//   - a driver-facing seam (judgeDeck) with an INJECTED callModel — the live-run hook,
//     NOT wired into the push-blocked --once path. The default callModel THROWS so a
//     real (credit-spending) call can only happen via deliberate owner wiring.
import fs from 'node:fs';
import { JUDGE, JUDGE_STATE_FILE } from './config.mjs';

// ---------------------------------------------------------------------------
// Pure rubric / prompt construction (drift-freeze, D19).
// ---------------------------------------------------------------------------
// Returns the pinned criteria as a stable, normalized list. Anchoring the judge to a
// FIXED criteria set (from config) is half of the drift-freeze: the maker can't add,
// drop, or reweight a criterion to flatter itself.
export function buildRubric(judge = JUDGE) {
  return judge.criteria.map((c) => ({ id: c.id, label: c.label, weight: c.weight ?? 1 }));
}

// Normalizes slide input to an array of { index, text } regardless of whether the caller
// passes plain strings or objects. Browser-free: the driver extracts slide text via the
// shared Chromium at live time and hands it in (deferred seam).
function normalizeSlides(slides = []) {
  return slides
    .map((s, i) => {
      if (typeof s === 'string') return { index: i, text: s };
      return { index: s.index ?? i, text: String(s.text ?? '') };
    })
    .filter((s) => s.text.trim().length > 0);
}

// Deterministic prompt. temperature:0 + this fixed phrasing = a reproducible verdict for
// a given deck (the other half of drift-freeze). The model is instructed to return ONLY
// a strict JSON object; we still treat its output as untrusted (see parseVerdict).
export function buildPrompt({ deckFile, slides, rubric = buildRubric(), designTokens = '', scaleMax = JUDGE.scaleMax }) {
  const norm = normalizeSlides(slides);
  const criteriaLines = rubric
    .map((c) => `- "${c.id}": ${c.label} (0=poor … ${scaleMax}=excellent)`)
    .join('\n');
  const slideText = norm
    .map((s) => `--- slide ${s.index} ---\n${s.text.trim()}`)
    .join('\n\n');
  const idList = rubric.map((c) => `"${c.id}"`).join(', ');

  return [
    'You are a strict, consistent design+copy judge for a single, deliberately art-directed',
    'conference deck. Judge ONLY against the deck\'s own design system and voice below —',
    'NOT a generic notion of "delight". Penalize drift toward generic AI/marketing slop.',
    '',
    '=== DESIGN SYSTEM & VOICE (the rubric anchor) ===',
    designTokens.trim() || '(design tokens unavailable)',
    '',
    `=== CRITERIA (score each integer 0..${scaleMax}) ===`,
    criteriaLines,
    '',
    `=== DECK: ${deckFile || '(unknown)'} ===`,
    slideText || '(no slide text)',
    '',
    '=== OUTPUT (STRICT) ===',
    'Return ONLY a single JSON object, no prose, no code fence, of the exact shape:',
    `{ "scores": { ${idList} : <integer 0..${scaleMax}> }, "notes": "<=240 chars" }`,
    `Every criterion id MUST be present with an integer 0..${scaleMax}. Do not add keys.`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Pure parse / validate — the LLM TRUST BOUNDARY.
// ---------------------------------------------------------------------------
// The model returns text. It may wrap the JSON in prose or a ```json fence despite the
// instruction. Pull the FIRST balanced top-level {...} object out by brace-matching
// (string-aware so braces inside quoted notes don't fool us). Returns the substring or
// null — we never eval, never regex-trust, never let model text reach control flow.
export function extractJsonBlock(raw) {
  if (typeof raw !== 'string') return null;
  const start = raw.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null; // unbalanced → treat as malformed
}

// Strict validation against the PINNED criteria. A verdict is valid ONLY if every pinned
// criterion has an INTEGER score in [0, scaleMax]. Missing, non-integer, NaN, or out-of-
// range → REJECT ({ valid:false }) rather than coerce — drift-freeze: a garbled judge
// must not silently become a passing (or failing) score. Extra keys the model invents
// are ignored (it cannot expand its own rubric). notes are clamped to a safe length.
export function parseVerdict(raw, opts = {}) {
  const rubric = opts.rubric || buildRubric();
  const scaleMax = opts.scaleMax ?? JUDGE.scaleMax;
  const block = extractJsonBlock(raw);
  if (block == null) return { valid: false, reason: 'no-json' };

  let obj;
  try {
    obj = JSON.parse(block);
  } catch {
    return { valid: false, reason: 'bad-json' };
  }
  if (!obj || typeof obj !== 'object' || typeof obj.scores !== 'object' || obj.scores == null) {
    return { valid: false, reason: 'no-scores' };
  }

  const scores = {};
  for (const c of rubric) {
    const v = obj.scores[c.id];
    if (typeof v !== 'number' || !Number.isInteger(v) || Number.isNaN(v)) {
      return { valid: false, reason: `score-type:${c.id}` };
    }
    if (v < 0 || v > scaleMax) {
      return { valid: false, reason: `score-range:${c.id}` };
    }
    scores[c.id] = v;
  }

  let notes = '';
  if (typeof obj.notes === 'string') notes = obj.notes.slice(0, 240);
  return { valid: true, scores, notes };
}

// ---------------------------------------------------------------------------
// Pure aggregation / policy — verdict.ok is ALWAYS true (Premise 3).
// ---------------------------------------------------------------------------
// Weighted mean of the per-criterion scores → `overall` (2 dp). A delight verdict NEVER
// gates: even an invalid/garbled judge response returns ok:true with overall:null, so a
// flaky or misconfigured judge can never revert `main`. The scoreboard treats null as
// "no signal this iteration" and simply keeps the prior weight.
export function summarizeDelight(parsed, opts = {}) {
  const rubric = opts.rubric || buildRubric();
  const scaleMax = opts.scaleMax ?? JUDGE.scaleMax;

  if (!parsed || !parsed.valid) {
    return {
      ok: true, // NON-GATING (Premise 3) — broken judge ≠ broken deck
      valid: false,
      overall: null,
      normalized: null,
      scores: {},
      reason: parsed ? parsed.reason : 'no-verdict',
    };
  }

  let weighted = 0;
  let totalWeight = 0;
  for (const c of rubric) {
    weighted += parsed.scores[c.id] * c.weight;
    totalWeight += c.weight;
  }
  const overall = totalWeight > 0 ? Math.round((weighted / totalWeight) * 100) / 100 : null;
  const normalized = overall != null && scaleMax > 0
    ? Math.round((overall / scaleMax) * 100) / 100
    : null;

  return {
    ok: true,
    valid: true,
    overall,                 // 0..scaleMax
    normalized,              // 0..1 (scoreboard-friendly)
    scaleMax,
    scores: parsed.scores,
    notes: parsed.notes || '',
  };
}

// ---------------------------------------------------------------------------
// Thin score-state IO (gitignored runtime artifact, D5).
// ---------------------------------------------------------------------------
export function loadDelightState(file = JUDGE_STATE_FILE) {
  if (!fs.existsSync(file)) return {};
  try {
    const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {}; // corrupt → start clean; transient, only affects observability
  }
}

export function saveDelightState(state, file = JUDGE_STATE_FILE) {
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

// Reads the design-tokens rubric anchor (D20). Pure-ish IO; on any miss returns '' so
// the judge still runs (degraded) rather than throwing — non-gating to the end.
export function loadDesignTokens(file = JUDGE.designTokensFile) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Driver seam (live-run hook — NOT wired into the push-blocked --once path).
// ---------------------------------------------------------------------------
// The default callModel THROWS: a real judge call spends credits, so it can only happen
// through deliberate owner wiring at run time. Tests/smokes inject a deterministic mock.
export async function defaultCallModel() {
  throw new Error('delight: no model bound — inject opts.callModel (real calls are owner-gated)');
}

// judgeDeck: build the prompt, ask the (injected) model, parse + summarize into a
// non-gating verdict. NEVER throws on a judge failure — a thrown/garbled model collapses
// to an invalid (ok:true, overall:null) verdict so the loop continues unharmed.
export async function judgeDeck({ deckFile, slides }, opts = {}) {
  const judge = opts.judge || JUDGE;
  const rubric = buildRubric(judge);
  const scaleMax = judge.scaleMax;
  const callModel = opts.callModel || defaultCallModel;
  const designTokens = opts.designTokens ?? loadDesignTokens(judge.designTokensFile);

  const prompt = buildPrompt({ deckFile, slides, rubric, designTokens, scaleMax });

  let raw;
  try {
    raw = await callModel({
      model: judge.model,
      temperature: judge.temperature,
      maxOutputTokens: judge.maxOutputTokens,
      prompt,
    });
  } catch (err) {
    return {
      ok: true, // judge failure is NEVER a deck failure (Premise 3)
      valid: false,
      overall: null,
      normalized: null,
      scores: {},
      reason: `call-failed:${err && err.message ? err.message : 'error'}`,
      deckFile,
    };
  }

  const parsed = parseVerdict(raw, { rubric, scaleMax });
  const summary = summarizeDelight(parsed, { rubric, scaleMax });
  return { ...summary, deckFile };
}
