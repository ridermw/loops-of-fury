// .loop/tests/secret-scan.test.mjs — D31 secret scanner. Pure, no I/O.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText, scanDiff } from '../secret-scan.mjs';

test('flags an AWS access key id', () => {
  const f = scanText('const k = "AKIAIOSFODNN7EXAMPLE2";');
  // AKIA + 16 — but EXAMPLE makes it a placeholder; use a non-placeholder line:
  const g = scanText('awsKey = AKIA1234567890ABCDEF');
  assert.equal(g.length, 1);
  assert.equal(g[0].rule, 'aws-access-key-id');
  assert.ok(!g[0].match.includes('AKIA1234567890ABCDEF')); // redacted
  assert.equal(f.length, 0); // EXAMPLE → placeholder, not flagged
});

test('flags a GitHub token', () => {
  const f = scanText('token: ghp_0123456789abcdefghijklmnopqrstuvwxyzAB');
  assert.equal(f.length, 1);
  assert.equal(f[0].rule, 'github-token');
});

test('flags a private key block header', () => {
  const f = scanText('-----BEGIN OPENSSH PRIVATE KEY-----');
  assert.equal(f.length, 1);
  assert.equal(f[0].rule, 'private-key-block');
});

test('flags a JWT', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEFghiJKLmnoPQRstuv';
  assert.equal(scanText(`bearer=${jwt}`).length, 1);
});

test('flags a guarded generic secret assignment', () => {
  const f = scanText('const client_secret = "s3cr3t-Ab12-Zx99-Qw77";');
  assert.equal(f.length, 1);
  assert.equal(f[0].rule, 'generic-secret-assignment');
});

test('does NOT flag placeholder assignments', () => {
  assert.equal(scanText('api_key = "your-api-key-here"').length, 0);
  assert.equal(scanText('password = "changeme123456"').length, 0);
  assert.equal(scanText('token = process.env.GH_TOKEN').length, 0);
  assert.equal(scanText('secret = "<replace-me-with-secret>"').length, 0);
});

test('does NOT flag ordinary deck/snippet code', () => {
  const deckish = [
    '<section><h2>Loop Contract</h2>',
    'const reveal = Reveal.initialize({ hash: true });',
    'await fetch("https://example.com/data.json");',
    'function categorize(status) { return status; }',
  ].join('\n');
  assert.deepEqual(scanText(deckish), []);
});

test('scanDiff only inspects ADDED lines', () => {
  const diff = [
    '--- a/index.html',
    '+++ b/index.html',
    '-const old = AKIA1111111111AAAAAA',     // removed secret → ignored
    '+const ok = "hello world here now";',    // benign add
    ' context line ghp_unchanged',            // context → ignored
  ].join('\n');
  assert.deepEqual(scanDiff(diff), []);
});

test('scanDiff flags a secret on an added line with correct rule', () => {
  const diff = [
    '+++ b/index.html',
    '+const t = ghp_0123456789abcdefghijklmnopqrstuvwxyzAB',
  ].join('\n');
  const f = scanDiff(diff);
  assert.equal(f.length, 1);
  assert.equal(f[0].rule, 'github-token');
});

test('regression: secret inside an HTML comment IS flagged (brackets are not a placeholder)', () => {
  // Bug: bracket chars `<`/`>` in the placeholder list + a whole-line check made
  // every HTML line look like a placeholder, disabling the scanner on the decks.
  const html = '<!-- ghp_0123456789abcdefghijklmnopqrstuvwxyzAB -->';
  const f = scanText(html);
  assert.equal(f.length, 1);
  assert.equal(f[0].rule, 'github-token');
});

test('regression: <placeholder> token wrapped in brackets is still NOT flagged', () => {
  assert.equal(scanText('secret = "<replace-me-with-secret>"').length, 0);
});

test('reports multiple findings across lines', () => {
  const text = [
    'a = AKIA1234567890ABCDEF',
    'b = ghp_0123456789abcdefghijklmnopqrstuvwxyzAB',
  ].join('\n');
  const f = scanText(text);
  assert.equal(f.length, 2);
  assert.deepEqual(f.map((x) => x.line), [1, 2]);
});
