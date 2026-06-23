// .loop/tests/delight.test.mjs — pure-layer coverage for the delight LLM-judge (D19).
// The model call is an injected seam; every test below mocks it deterministically and
// NEVER spends credits. Focus: drift-freeze rubric, the LLM trust boundary (strict
// parse/reject), and the non-gating invariant (ok === true for EVERY failure mode).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JUDGE } from '../config.mjs';
import {
  buildRubric,
  buildPrompt,
  extractJsonBlock,
  parseVerdict,
  summarizeDelight,
  loadDelightState,
  saveDelightState,
  defaultCallModel,
  judgeDeck,
} from '../delight.mjs';

// Full, valid scores object for the pinned criteria at a given value.
function fullScores(value, max = JUDGE.scaleMax) {
  const s = {};
  for (const c of JUDGE.criteria) s[c.id] = Math.min(value, max);
  return s;
}
function validRaw(value = 4) {
  return JSON.stringify({ scores: fullScores(value), notes: 'ok' });
}

// ── buildRubric ──────────────────────────────────────────────────────────────

test('buildRubric: returns the pinned criteria with ids + weights', () => {
  const r = buildRubric();
  assert.equal(r.length, JUDGE.criteria.length);
  assert.deepEqual(r.map((c) => c.id), JUDGE.criteria.map((c) => c.id));
  for (const c of r) assert.equal(typeof c.weight, 'number');
});

test('buildRubric: defaults a missing weight to 1', () => {
  const r = buildRubric({ criteria: [{ id: 'x', label: 'X' }] });
  assert.equal(r[0].weight, 1);
});

// ── buildPrompt ────────────────────────────────────────────────────────────────

test('buildPrompt: deterministic — identical inputs produce identical output', () => {
  const args = { deckFile: 'index.html', slides: ['Hello world'], designTokens: '--fury' };
  assert.equal(buildPrompt(args), buildPrompt(args));
});

test('buildPrompt: embeds every criterion id, slide text, and tokens', () => {
  const p = buildPrompt({ deckFile: 'index.html', slides: ['Machine-checkable done'], designTokens: 'PALETTE-ANCHOR' });
  for (const c of JUDGE.criteria) assert.ok(p.includes(`"${c.id}"`), `missing ${c.id}`);
  assert.ok(p.includes('Machine-checkable done'));
  assert.ok(p.includes('PALETTE-ANCHOR'));
  assert.ok(/Return ONLY a single JSON object/.test(p));
});

test('buildPrompt: normalizes string and object slides, drops empty', () => {
  const p = buildPrompt({
    deckFile: 'd.html',
    slides: ['alpha', { index: 7, text: 'bravo' }, { text: '   ' }, ''],
    designTokens: '',
  });
  assert.ok(p.includes('alpha'));
  assert.ok(p.includes('bravo'));
  assert.ok(p.includes('slide 7'));
  // empty/whitespace slides contribute no "--- slide" header beyond the real two
  assert.equal((p.match(/--- slide/g) || []).length, 2);
});

// ── extractJsonBlock (LLM trust boundary) ───────────────────────────────────────

test('extractJsonBlock: plain object', () => {
  assert.equal(extractJsonBlock('{"a":1}'), '{"a":1}');
});

test('extractJsonBlock: pulls JSON out of surrounding prose', () => {
  const raw = 'Sure! Here is the verdict:\n{"scores":{"x":3}}\nHope that helps.';
  assert.equal(extractJsonBlock(raw), '{"scores":{"x":3}}');
});

test('extractJsonBlock: pulls JSON out of a ```json fence', () => {
  const raw = '```json\n{"scores":{"x":3}}\n```';
  assert.equal(extractJsonBlock(raw), '{"scores":{"x":3}}');
});

test('extractJsonBlock: string-aware — braces inside notes do not truncate', () => {
  const raw = '{"scores":{"x":3},"notes":"use { and } carefully"}';
  assert.equal(extractJsonBlock(raw), raw);
});

test('extractJsonBlock: no brace / unbalanced → null', () => {
  assert.equal(extractJsonBlock('no json here'), null);
  assert.equal(extractJsonBlock('{"scores":{"x":3}'), null);
  assert.equal(extractJsonBlock(42), null);
});

// ── parseVerdict (strict reject, never coerce) ──────────────────────────────────

test('parseVerdict: accepts a complete, in-range verdict', () => {
  const v = parseVerdict(validRaw(4));
  assert.equal(v.valid, true);
  for (const c of JUDGE.criteria) assert.equal(v.scores[c.id], 4);
});

test('parseVerdict: rejects when a criterion is missing', () => {
  const partial = fullScores(3);
  delete partial[JUDGE.criteria[0].id];
  const v = parseVerdict(JSON.stringify({ scores: partial }));
  assert.equal(v.valid, false);
  assert.match(v.reason, /score-type/);
});

test('parseVerdict: rejects a non-integer score (no coercion)', () => {
  const s = fullScores(3);
  s[JUDGE.criteria[0].id] = 3.5;
  const v = parseVerdict(JSON.stringify({ scores: s }));
  assert.equal(v.valid, false);
  assert.match(v.reason, /score-type/);
});

test('parseVerdict: rejects out-of-range scores (both ends)', () => {
  const hi = fullScores(3); hi[JUDGE.criteria[0].id] = JUDGE.scaleMax + 1;
  assert.equal(parseVerdict(JSON.stringify({ scores: hi })).valid, false);
  const lo = fullScores(3); lo[JUDGE.criteria[0].id] = -1;
  assert.equal(parseVerdict(JSON.stringify({ scores: lo })).valid, false);
});

test('parseVerdict: ignores extra invented keys (rubric cannot expand)', () => {
  const s = fullScores(2);
  s['hallucinated-axis'] = 9;
  const v = parseVerdict(JSON.stringify({ scores: s }));
  assert.equal(v.valid, true);
  assert.equal(v.scores['hallucinated-axis'], undefined);
});

test('parseVerdict: clamps notes to 240 chars', () => {
  const v = parseVerdict(JSON.stringify({ scores: fullScores(3), notes: 'z'.repeat(500) }));
  assert.equal(v.notes.length, 240);
});

test('parseVerdict: rejects no-json / bad-json / missing scores', () => {
  assert.equal(parseVerdict('totally not json').reason, 'no-json');
  assert.equal(parseVerdict('{ not valid json ,, }').valid, false);
  assert.equal(parseVerdict(JSON.stringify({ notes: 'hi' })).reason, 'no-scores');
});

// ── summarizeDelight (weighted mean + NON-GATING) ───────────────────────────────

test('summarizeDelight: weighted mean of equal-weight criteria', () => {
  const parsed = parseVerdict(validRaw(4));
  const sum = summarizeDelight(parsed);
  assert.equal(sum.ok, true);
  assert.equal(sum.valid, true);
  assert.equal(sum.overall, 4);
  assert.equal(sum.normalized, Math.round((4 / JUDGE.scaleMax) * 100) / 100);
});

test('summarizeDelight: respects non-equal weights', () => {
  const rubric = [
    { id: 'a', label: 'A', weight: 3 },
    { id: 'b', label: 'B', weight: 1 },
  ];
  const parsed = { valid: true, scores: { a: 4, b: 0 }, notes: '' };
  const sum = summarizeDelight(parsed, { rubric, scaleMax: 5 });
  // (4*3 + 0*1) / 4 = 3
  assert.equal(sum.overall, 3);
});

test('summarizeDelight: invalid parse → ok:true, overall:null (NON-GATING)', () => {
  const sum = summarizeDelight({ valid: false, reason: 'bad-json' });
  assert.equal(sum.ok, true);
  assert.equal(sum.valid, false);
  assert.equal(sum.overall, null);
  assert.equal(sum.reason, 'bad-json');
});

test('summarizeDelight: null input still non-gating', () => {
  const sum = summarizeDelight(null);
  assert.equal(sum.ok, true);
  assert.equal(sum.overall, null);
});

// ── state IO ────────────────────────────────────────────────────────────────────

test('loadDelightState/saveDelightState: round-trip in a temp dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delight-'));
  const file = path.join(dir, 'delight-state.json');
  const state = { 'index.html': { overall: 4, at: 1 } };
  saveDelightState(state, file);
  assert.deepEqual(loadDelightState(file), state);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('loadDelightState: missing or corrupt file → {}', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delight-'));
  const file = path.join(dir, 'delight-state.json');
  assert.deepEqual(loadDelightState(file), {});
  fs.writeFileSync(file, '{ broken');
  assert.deepEqual(loadDelightState(file), {});
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── defaultCallModel (never a real call) ────────────────────────────────────────

test('defaultCallModel: throws — a real model call requires explicit owner wiring', async () => {
  await assert.rejects(() => defaultCallModel(), /no model bound/);
});

// ── judgeDeck (integration with a MOCKED callModel) ─────────────────────────────

test('judgeDeck: happy path returns a valid, non-gating verdict', async () => {
  let seen = null;
  const callModel = async (req) => { seen = req; return validRaw(5); };
  const v = await judgeDeck(
    { deckFile: 'index.html', slides: ['Narrow maker, independent checker.'] },
    { callModel, designTokens: 'TOKENS-ANCHOR' },
  );
  assert.equal(v.ok, true);
  assert.equal(v.valid, true);
  assert.equal(v.overall, 5);
  assert.equal(v.deckFile, 'index.html');
  // prompt actually carried the tokens + slide text to the model
  assert.ok(seen.prompt.includes('TOKENS-ANCHOR'));
  assert.ok(seen.prompt.includes('Narrow maker'));
  assert.equal(seen.temperature, JUDGE.temperature);
  assert.equal(seen.model, JUDGE.model);
});

test('judgeDeck: prose-wrapped JSON from the model still parses', async () => {
  const callModel = async () => `Here you go:\n${validRaw(3)}\nthanks`;
  const v = await judgeDeck({ deckFile: 'd.html', slides: ['x'] }, { callModel, designTokens: '' });
  assert.equal(v.valid, true);
  assert.equal(v.overall, 3);
});

test('judgeDeck: a THROWING model collapses to ok:true, valid:false (NON-GATING)', async () => {
  const callModel = async () => { throw new Error('timeout'); };
  const v = await judgeDeck({ deckFile: 'd.html', slides: ['x'] }, { callModel, designTokens: '' });
  assert.equal(v.ok, true);
  assert.equal(v.valid, false);
  assert.match(v.reason, /call-failed:timeout/);
  assert.equal(v.overall, null);
});

test('judgeDeck: malformed model output is non-gating', async () => {
  const callModel = async () => 'I refuse to output JSON.';
  const v = await judgeDeck({ deckFile: 'd.html', slides: ['x'] }, { callModel, designTokens: '' });
  assert.equal(v.ok, true);
  assert.equal(v.valid, false);
  assert.equal(v.overall, null);
});

test('judgeDeck: out-of-range model score is rejected, not coerced — still non-gating', async () => {
  const bad = fullScores(3); bad[JUDGE.criteria[0].id] = 99;
  const callModel = async () => JSON.stringify({ scores: bad });
  const v = await judgeDeck({ deckFile: 'd.html', slides: ['x'] }, { callModel, designTokens: '' });
  assert.equal(v.ok, true);
  assert.equal(v.valid, false);
  assert.match(v.reason, /score-range/);
});

test('judgeDeck: never makes a real call when callModel is omitted (default throws → non-gating)', async () => {
  const v = await judgeDeck({ deckFile: 'd.html', slides: ['x'] }, { designTokens: '' });
  assert.equal(v.ok, true);
  assert.equal(v.valid, false);
  assert.match(v.reason, /call-failed/);
});
