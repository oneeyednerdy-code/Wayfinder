import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../public/js/diagnostics.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('diagnostics UI exists at bottom of app', () => {
  assert.match(html, /id="diagnostics-panel"/);
  assert.match(html, /id="diagnostics-download"/);
  assert.match(html, /id="diagnostics-output"/);
});

test('diagnostics sanitizer uses an explicit allowlist', () => {
  assert.match(source, /const keys = \[/);
  assert.doesNotMatch(source, /JSON\.stringify\(details\)/);
});

test('diagnostic privacy copy explicitly excludes sensitive inputs', () => {
  assert.match(source, /OAuth tokens, authorization codes, URL queries, CSV contents, revenue values, creator identities/);
});
