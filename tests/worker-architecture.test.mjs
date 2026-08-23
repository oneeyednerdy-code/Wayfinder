import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const config = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

test('Worker build has an explicit entry point and API router', () => {
  assert.match(worker, /export default/);
  assert.match(worker, /\/api\/auth\/login/);
  assert.match(worker, /\/api\/health/);
  assert.match(worker, /env\.ASSETS\.fetch/);
});

test('Wrangler config uses Workers Static Assets and D1 rather than Pages output', () => {
  assert.match(config, /"main"\s*:\s*"src\/index\.js"/);
  assert.match(config, /"directory"\s*:\s*"\.\/public"/);
  assert.match(config, /"binding"\s*:\s*"ASSETS"/);
  assert.match(config, /"binding"\s*:\s*"WAYFINDER_DB"/);
  assert.doesNotMatch(config, /pages_build_output_dir/);
});
