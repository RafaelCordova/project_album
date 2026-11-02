import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../../src/config/environment.js';
import { themeFor } from '../../src/config/userThemes.js';
import { MAX_BYTES, validateFile, validateImageSignature } from '../../src/services/imageService.js';
import { assertStoragePath } from '../../src/services/storageService.js';
import { imageFile } from './helpers.js';

test('no configura claves ficticias por defecto y rechaza secretos administrativos', () => {
  assert.equal(readConfig({}).ready, false);
  assert.throws(() => readConfig({ VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_TEST_ONLY' }), /secreta/);
  assert.throws(() => readConfig({ VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_TEST_ONLY', VITE_SUPABASE_ANON_KEY: 'sb_secret_TEST_ONLY' }), /secreta/);
  const legacy = (role) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.TEST_ONLY`;
  const env = { VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: legacy('anon') };
  assert.equal(readConfig(env).ready, true);
  assert.throws(() => readConfig({ ...env, VITE_SUPABASE_ANON_KEY: legacy('service_role') }), /anon/);
  assert.throws(() => readConfig({ ...env, VITE_SUPABASE_URL: 'http://example.supabase.co' }), /HTTPS/);
});
test('usuarios sin UUID configurado reciben tema neutral', () => { assert.equal(themeFor('no-asignado'), 'neutral'); });
test('valida extensión, MIME, tamaño y firma de bytes', async () => {
  validateFile(imageFile());
  await validateImageSignature(imageFile());
  assert.throws(() => validateFile({ name: 'foto.png', type: 'image/png', size: MAX_BYTES + 1 }), /10 MB/);
  assert.throws(() => validateFile({ name: 'foto.svg', type: 'image/svg+xml', size: 5 }), /Solo se aceptan/);
  assert.throws(() => validateFile({ name: 'foto.png', type: 'image/jpeg', size: 5 }), /tipo correcto/);
  await assert.rejects(validateImageSignature(new File(['<html>'], 'falsa.png', { type: 'image/png' })), /contenido/);
});
test('rechaza URLs externas, traversal y rutas codificadas; admite nombres antiguos seguros', () => {
  for (const path of ['../archivo.png', '/archivo.png', 'https://x.test/a.png', 'a//b', 'a\\b', 'a/%2e%2e/b', 'a/./b', 'a?b', '']) assert.throws(() => assertStoragePath(path));
  assert.equal(assertStoragePath('fotos antiguas/verano bonito.png'), 'fotos antiguas/verano bonito.png');
});
