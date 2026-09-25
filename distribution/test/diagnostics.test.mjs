import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {classify, inspectHost} from '../diagnostics/host.mjs';
const GiB = 1024 ** 3;
test('unsupported architectures never receive a recommended classification', () => {
  const result = classify({total: 64 * GiB, free: 32 * GiB, cores: 16, arch: 'ia32'});
  assert.equal(result.supported, false);
  assert.equal(result.tier, 'Abaixo do recomendado');
});
test('limited memory is reported without claiming emulator capacity', () => {
  const r = classify({total: 8 * GiB, free: 2 * GiB, cores: 4, arch: 'x64'});
  assert.equal(r.tier, 'Básico');
  assert.equal(r.availableGiB, 2);
  assert.equal(r.maxProfiles, undefined);
});
test('actual host diagnostics return measured RAM and explicit worker exclusion', async () => {
  const r = await inspectHost();
  assert.ok(r.totalGiB > 0);
  assert.ok(r.freeGiB >= 0);
  assert.equal(r.worker.status, 'not_checked');
  assert.ok(['ok', 'unavailable'].includes(r.adb.status));
});
test('site contains only resolvable local navigation and no fake installer links', async () => {
  for (const route of ['', 'download/', 'setup/', 'diagnostics/']) {
    const html = await fs.readFile(`landing/${route}index.html`, 'utf8');
    for (const match of html.matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
      const target = match[1].endsWith('/') ? `${match[1]}index.html` : match[1];
      await fs.access(`landing${target}`);
    }
    assert.doesNotMatch(html, /href="[^"]*\.(exe|dmg)"/);
  }
});
