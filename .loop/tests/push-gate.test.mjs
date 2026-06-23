// .loop/tests/push-gate.test.mjs — pre-push barrier policy (D30). Pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePush } from '../push-gate.mjs';

test('allows the decks and shared assets', () => {
  const r = evaluatePush(['index.html', 'workshop.html', 'assets/theme.css']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.violations, []);
});

test('allows the committed driver data files (push scope ⊃ maker scope)', () => {
  const r = evaluatePush([
    '.loop/control-manifest.json',
    '.loop/ledger.json',
    '.loop/run.json',
    '.loop/LOOP_STATUS',
  ]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.violations, []);
});

test('blocks control-plane CODE even though it lives beside allowed data', () => {
  const r = evaluatePush(['.loop/check.mjs', '.loop/driver.mjs', '.loop/secret-scan.mjs']);
  assert.equal(r.ok, false);
  assert.equal(r.violations.length, 3);
});

test('blocks the manifest module but allows the manifest data', () => {
  // control-manifest.json (data) is allowed; control-manifest.mjs (code) is not.
  const r = evaluatePush(['.loop/control-manifest.json', '.loop/control-manifest.mjs']);
  assert.equal(r.ok, false);
  assert.deepEqual(r.violations, ['.loop/control-manifest.mjs']);
});

test('blocks CI, the hook itself, and package manifests', () => {
  const r = evaluatePush(['.github/workflows/ci.yml', '.githooks/pre-push', 'package.json']);
  assert.equal(r.ok, false);
  assert.equal(r.violations.length, 3);
});

test('normalizes backslash paths before matching', () => {
  const r = evaluatePush(['.loop\\ledger.json']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.files, ['.loop/ledger.json']);
});

test('a legitimate loop push (decks + data) passes; one stray code file fails it', () => {
  const ok = evaluatePush(['index.html', '.loop/ledger.json', '.loop/run.json']);
  assert.equal(ok.ok, true);
  const bad = evaluatePush(['index.html', '.loop/ledger.json', '.loop/driver.mjs']);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.violations, ['.loop/driver.mjs']);
});
