import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('Nerdspace Intelligence notice is present near footer', () => {
  assert.match(html, /NERDSPACE INTELLIGENCE/);
  assert.match(html, /Uploaded CSV contents, revenue or monetary data, Twitch OAuth tokens, and private creator notes are not stored/i);
  assert.ok(html.indexOf('NERDSPACE INTELLIGENCE') < html.indexOf('<footer>'));
});
