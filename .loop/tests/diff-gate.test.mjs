// .loop/tests/diff-gate.test.mjs — maker-scope allowlist gate (D30). Pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../diff-gate.mjs';

test('allows the decks and shared assets', () => {
  const r = evaluate(['index.html', 'workshop.html', 'assets/theme.css', 'assets/img/x.png']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.violations, []);
});

test('blocks control-plane code', () => {
  const r = evaluate(['.loop/check.mjs']);
  assert.equal(r.ok, false);
  assert.deepEqual(r.violations, ['.loop/check.mjs']);
});

test('blocks committed driver data files too (maker may never touch .loop)', () => {
  // Distinguishes the maker gate from the push gate: even ledger/run are forbidden
  // to the MAKER, though the push gate permits them.
  const r = evaluate(['.loop/ledger.json', '.loop/run.json', '.loop/LOOP_STATUS']);
  assert.equal(r.ok, false);
  assert.equal(r.violations.length, 3);
});

test('blocks CI, hooks, package manifests, and git config', () => {
  const r = evaluate([
    '.github/workflows/ci.yml',
    '.githooks/pre-push',
    'package.json',
    'package-lock.json',
    '.gitignore',
    '.gitattributes',
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.violations.length, 6);
});

test('blocks an otherwise-innocent file outside the allowlist', () => {
  const r = evaluate(['README.md', 'notes.txt']);
  assert.equal(r.ok, false);
  assert.equal(r.violations.length, 2);
});

test('normalizes backslash paths before matching', () => {
  const r = evaluate(['assets\\sub\\deck.css']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.files, ['assets/sub/deck.css']);
});

test('reports only the offending paths in a mixed set', () => {
  const r = evaluate(['index.html', '.loop/driver.mjs', 'assets/a.js', 'package.json']);
  assert.equal(r.ok, false);
  assert.deepEqual(r.violations.sort(), ['.loop/driver.mjs', 'package.json']);
});
