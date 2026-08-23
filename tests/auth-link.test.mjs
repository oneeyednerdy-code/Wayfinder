import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Connect Twitch is a real same-origin auth link without JavaScript', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /id=\"twitch-connect\"[^>]*href=\"\/api\/auth\/login\"/);
});
