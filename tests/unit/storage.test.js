import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorageService } from '../../src/services/storageService.js';

function fixture(overrides = {}) {
  const calls = [];
  const api = {
    async createSignedUrls(paths, expiry) { calls.push({ paths, expiry }); return { data: paths.map((path) => ({ path, signedUrl: `https://example.supabase.co/storage/v1/object/sign/recuerdos/${path}?token=TEST_ONLY_${calls.length}` })) }; },
    async remove(paths) { return { data: paths.map((name) => ({ name })), error: null }; },
    async exists() { return { data: false, error: { status: 404 } }; },
    ...overrides,
  };
  const storage = createStorageService({ supabaseUrl: 'https://example.supabase.co', storage: { from(bucket) { assert.equal(bucket, 'recuerdos'); return api; } } });
  return { storage, calls };
}
test('firma en lotes de 100, deduplica, reutiliza caché y permite renovar', async () => {
  const { storage, calls } = fixture();
  const paths = Array.from({ length: 205 }, (_, i) => `photo-${i}.png`);
  const urls = await storage.urls([...paths, paths[0]]);
  assert.equal(calls.length, 3);
  assert.equal(urls.size, 205);
  assert.equal(calls[0].expiry, 300);
  await storage.urls(paths);
  assert.equal(calls.length, 3);
  await storage.urls([paths[0]], { force: true });
  assert.equal(calls.length, 4);
  storage.clear();
  await storage.urls([paths[0]]);
  assert.equal(calls.length, 5);
});
test('renueva URLs antes de vencer', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const { storage, calls } = fixture();
  await storage.urls(['foto.png']);
  context.mock.timers.tick(256_000);
  await storage.urls(['foto.png']);
  assert.equal(calls.length, 2);
});
test('una respuesta pendiente de otro usuario no repuebla la caché tras logout', async () => {
  let resolve;
  const { storage } = fixture({ createSignedUrls: () => new Promise((done) => { resolve = done; }) });
  const pending = storage.urls(['foto.png']);
  storage.clear();
  resolve({ data: [{ path: 'foto.png', signedUrl: 'https://example.supabase.co/storage/v1/object/sign/recuerdos/foto.png' }] });
  assert.equal((await pending).size, 0);
});
test('no confía en URLs firmadas de otro origen', async () => {
  const { storage } = fixture({ async createSignedUrls() { return { data: [{ path: 'foto.png', signedUrl: 'https://otro.test/foto.png' }] }; } });
  assert.equal((await storage.urls(['foto.png'])).get('foto.png'), null);
});
test('detecta DELETE silencioso filtrado por RLS y admite reintentos de archivos ausentes', async () => {
  const denied = fixture({ async remove() { return { data: [], error: null }; }, async exists() { return { data: true, error: null }; } });
  await assert.rejects(denied.storage.remove(['foto.png']), /no confirmó/);
  const missing = fixture({ async remove() { return { data: [], error: null }; } });
  await missing.storage.remove(['ya-no-existe.png']);
});
