import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8');

test('OAuth diagnostics reads reason from url.searchParams', () => {
  assert.match(app, /url\.searchParams\.get\('reason'\)/);
  assert.doesNotMatch(app, /params\.get\('reason'\)/);
});

test('OAuth retry targets the Connect Twitch element', () => {
  assert.match(app, /querySelector\('#twitch-connect'\)/);
});
