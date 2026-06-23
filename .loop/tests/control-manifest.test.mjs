// .loop/tests/control-manifest.test.mjs — control-plane immutability (D28).
// Fully isolated: operates on a synthetic control plane in a temp dir, so it never
// touches the real .loop manifest and cannot race sibling test processes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compute, writeBaseline, verify } from '../control-manifest.mjs';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-'));
  fs.writeFileSync(path.join(dir, 'check.mjs'), 'export const gate = true;\n');
  fs.writeFileSync(path.join(dir, 'driver.mjs'), 'export const spine = 1;\n');
  fs.writeFileSync(path.join(dir, 'ledger.json'), '{"iteration":0}\n'); // excluded data
  fs.writeFileSync(path.join(dir, 'run.json'), '{"uuid":"x"}\n'); // excluded data
  fs.writeFileSync(path.join(dir, 'driver.log'), 'noise\n'); // excluded by .log
  const manifest = path.join(dir, 'control-manifest.json');
  return { dir, manifest };
}

test('compute() hashes code but excludes data/log files', () => {
  const { dir } = fixture();
  const m = compute(dir);
  assert.ok('check.mjs' in m && 'driver.mjs' in m);
  for (const excluded of ['ledger.json', 'run.json', 'driver.log', 'control-manifest.json']) {
    assert.ok(!(excluded in m), `${excluded} must be excluded`);
  }
  for (const v of Object.values(m)) assert.match(v, /^[0-9a-f]{64}$/);
});

test('compute() is deterministic for unchanged content', () => {
  const { dir } = fixture();
  assert.deepEqual(compute(dir), compute(dir));
});

test('compute() is CRLF/LF agnostic (autocrlf must not look like tampering)', () => {
  const { dir } = fixture();
  const lf = compute(dir)['check.mjs'];
  fs.writeFileSync(path.join(dir, 'check.mjs'), 'export const gate = true;\r\n');
  assert.equal(compute(dir)['check.mjs'], lf);
});

test('verify() is clean immediately after writeBaseline()', () => {
  const { dir, manifest } = fixture();
  writeBaseline(dir, manifest);
  const r = verify(dir, manifest);
  assert.equal(r.ok, true);
  assert.deepEqual(r.drift, []);
});

test('verify() detects a modified control file (tamper)', () => {
  const { dir, manifest } = fixture();
  writeBaseline(dir, manifest);
  fs.writeFileSync(path.join(dir, 'check.mjs'), 'export const gate = false; // weakened\n');
  const r = verify(dir, manifest);
  assert.equal(r.ok, false);
  assert.deepEqual(r.drift, ['check.mjs']);
});

test('verify() detects an added control file', () => {
  const { dir, manifest } = fixture();
  writeBaseline(dir, manifest);
  fs.writeFileSync(path.join(dir, 'backdoor.mjs'), 'export const evil = 1;\n');
  const r = verify(dir, manifest);
  assert.equal(r.ok, false);
  assert.ok(r.drift.includes('backdoor.mjs'));
});

test('verify() detects a deleted control file', () => {
  const { dir, manifest } = fixture();
  writeBaseline(dir, manifest);
  fs.rmSync(path.join(dir, 'driver.mjs'));
  const r = verify(dir, manifest);
  assert.equal(r.ok, false);
  assert.ok(r.drift.includes('driver.mjs'));
});

test('verify() reports no-manifest when the baseline is absent', () => {
  const { dir, manifest } = fixture();
  const r = verify(dir, manifest);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-manifest');
});

test('changing only excluded data files does NOT trip drift', () => {
  const { dir, manifest } = fixture();
  writeBaseline(dir, manifest);
  fs.writeFileSync(path.join(dir, 'ledger.json'), '{"iteration":99}\n');
  fs.writeFileSync(path.join(dir, 'run.json'), '{"uuid":"y"}\n');
  assert.equal(verify(dir, manifest).ok, true);
});
