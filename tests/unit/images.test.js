import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageVariants, createThumbnail, fitWithin } from '../../src/services/imageService.js';
import { DISPLAY, THUMBNAIL } from '../../src/config/media.js';

const webp = (size) => new Blob([new Uint8Array(size)], { type: 'image/webp' });
function fakes({ width, height, sizes = {} }) {
  const calls = [];
  let closed = false;
  return {
    calls,
    get closed() { return closed; },
    decode: async () => ({ source: 'bitmap', width, height, close: () => { closed = true; } }),
    encode: async (source, size, quality) => { calls.push({ source, ...size, quality }); return webp(sizes[size.width] ?? 100); },
  };
}

test('ajusta dimensiones según orientación sin ampliar', () => {
  assert.deepEqual(fitWithin(4000, 3000, 480), { width: 480, height: 360 });
  assert.deepEqual(fitWithin(3000, 4000, 480), { width: 360, height: 480 });
  assert.deepEqual(fitWithin(4000, 3000, 1600), { width: 1600, height: 1200 });
  assert.deepEqual(fitWithin(800, 600, 1600), { width: 800, height: 600 });
  assert.equal(fitWithin(0, 100, 480), null);
});

test('genera miniatura y versión de visualización WebP con un solo decodificado', async () => {
  const fake = fakes({ width: 4032, height: 3024 });
  const original = new File([new Uint8Array(3_000_000)], 'viaje.jpg', { type: 'image/jpeg' });
  const result = await createImageVariants(original, fake);
  assert.equal(result.thumbnail.type, 'image/webp');
  assert.equal(result.display.type, 'image/webp');
  assert.deepEqual(fake.calls.map(({ width, height, quality }) => [width, height, quality]), [[480, 360, THUMBNAIL.quality], [1600, 1200, DISPLAY.quality]]);
  assert.equal(fake.closed, true);
  assert.equal(original.size, 3_000_000); // El original no se modifica.
});

test('fotos verticales conservan su proporción en ambas versiones', async () => {
  const fake = fakes({ width: 3024, height: 4032 });
  await createImageVariants(new File([new Uint8Array(2_000_000)], 'v.jpg', { type: 'image/jpeg' }), fake);
  assert.deepEqual(fake.calls.map(({ width, height }) => [width, height]), [[360, 480], [1200, 1600]]);
});

test('omite la versión de visualización si no es más liviana que el original', async () => {
  const fake = fakes({ width: 900, height: 600, sizes: { 900: 50_000 } });
  const result = await createImageVariants(new File([new Uint8Array(40_000)], 'p.webp', { type: 'image/webp' }), fake);
  assert.ok(result.thumbnail);
  assert.equal(result.display, null);
});

test('calidad configurable y respaldo seguro cuando el navegador falla', async () => {
  const fake = fakes({ width: 2000, height: 1000 });
  await createImageVariants(new File([new Uint8Array(900_000)], 'a.png', { type: 'image/png' }), { ...fake, thumbnail: { maxSide: 320, quality: 0.6 }, display: { maxSide: 1200, quality: 0.7 } });
  assert.deepEqual(fake.calls.map(({ width, quality }) => [width, quality]), [[320, 0.6], [1200, 0.7]]);
  const failing = await createImageVariants(new File(['x'], 'a.png', { type: 'image/png' }), { decode: async () => { throw new Error('no decodifica'); } });
  assert.deepEqual(failing, { thumbnail: null, display: null });
  const notWebp = await createImageVariants(new File(['x'], 'a.png', { type: 'image/png' }), { decode: fake.decode, encode: async () => new Blob(['png'], { type: 'image/png' }) });
  assert.deepEqual(notWebp, { thumbnail: null, display: null });
  const huge = await createImageVariants(new File(['x'], 'a.png', { type: 'image/png' }), fakes({ width: 10_000, height: 7_000 }));
  assert.deepEqual(huge, { thumbnail: null, display: null });
});

test('createThumbnail mantiene la compatibilidad con el flujo anterior', async () => {
  const fake = fakes({ width: 1200, height: 800 });
  const blob = await createThumbnail(new File([new Uint8Array(500_000)], 'a.png', { type: 'image/png' }), fake);
  assert.equal(blob.type, 'image/webp');
});
