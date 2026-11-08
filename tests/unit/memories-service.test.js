import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPhotoService, MEMORY_COLUMNS, PHOTO_COLUMNS } from '../../src/services/photoService.js';
import { examplePhoto, imageFile, mockClient, mockStorage, USER_ID, videoFile } from './helpers.js';

const shortVideo = readFileSync(new URL('../fixtures/recuerdo-corto.mp4', import.meta.url));
const webp = (text) => new Blob([text], { type: 'image/webp' });
const variants = async () => ({ thumbnail: webp('mini'), display: webp('grande') });

test('las columnas nuevas amplían las seis originales sin repetirlas', () => {
  assert.ok(MEMORY_COLUMNS.startsWith(`${PHOTO_COLUMNS},`));
  const columns = MEMORY_COLUMNS.split(',');
  assert.equal(new Set(columns).size, columns.length);
  assert.deepEqual(columns.slice(6), ['media_type', 'memory_date', 'place', 'display_path', 'duration_seconds']);
});

test('sube original, miniatura y versión de visualización; guarda fecha y lugar', async () => {
  const client = mockClient();
  const storage = mockStorage();
  const result = await createPhotoService(client, storage, { variants }).upload(imageFile(), () => {}, { memoryDate: '2026-02-14', place: '  Paracas ' });
  const paths = storage.events.filter(([event]) => event === 'upload').map(([, path]) => path);
  assert.equal(paths.length, 3);
  assert.match(paths[0], new RegExp(`^originals/${USER_ID}/.+\\.png$`));
  assert.match(paths[1], new RegExp(`^thumbnails/${USER_ID}/.+\\.webp$`));
  assert.match(paths[2], new RegExp(`^display/${USER_ID}/.+\\.webp$`));
  assert.equal(result.photo.display_path, paths[2]);
  assert.equal(result.photo.media_type, 'photo');
  assert.equal(result.photo.memory_date, '2026-02-14');
  assert.equal(result.photo.place, 'Paracas');
});

test('sube un video MP4 con portada, sin versión de visualización y con su duración', async () => {
  const client = mockClient();
  const storage = mockStorage();
  const result = await createPhotoService(client, storage, { poster: async () => webp('portada') }).upload(videoFile(shortVideo));
  const paths = storage.events.filter(([event]) => event === 'upload').map(([, path]) => path);
  assert.equal(paths.length, 2);
  assert.match(paths[0], /^originals\/.+\.mp4$/);
  assert.match(paths[1], /^thumbnails\/.+\.webp$/);
  assert.equal(result.photo.media_type, 'video');
  assert.equal(result.photo.duration_seconds, 3);
  assert.equal(result.photo.display_path, null);
});

test('un video inválido no sube archivos ni crea filas', async () => {
  const client = mockClient();
  const storage = mockStorage();
  await assert.rejects(createPhotoService(client, storage).upload(videoFile(Buffer.from('no es un video'), 'falso.mp4')), /estructura/);
  assert.equal(storage.events.length, 0);
  assert.equal(client.database.records.length, 0);
});

test('si falla el INSERT de un video, limpia el MP4 y su portada', async () => {
  const client = mockClient({ insertError: new Error('RLS denegada') });
  const storage = mockStorage();
  await assert.rejects(createPhotoService(client, storage, { poster: async () => webp('portada') }).upload(videoFile(shortVideo)), /RLS denegada/);
  assert.deepEqual(storage.events.at(-1)[0], 'remove');
  assert.equal(storage.events.at(-1)[1].length, 2);
});

test('compatibilidad: sin la migración usa las seis columnas, no sube versión grande y rechaza videos', async () => {
  const client = mockClient({ missingColumns: true, records: [{ ...examplePhoto }] });
  const storage = mockStorage();
  const service = createPhotoService(client, storage, { variants });
  const rows = await service.list();
  assert.equal(service.schema, 'v1');
  assert.equal(rows[0].media_type, 'photo');
  assert.equal(rows[0].display_path, null);
  const result = await service.upload(imageFile());
  assert.equal(storage.events.filter(([event]) => event === 'upload').length, 2);
  assert.equal('media_type' in client.database.records.at(-1), false);
  assert.equal(result.photo.thumbnail_path !== null, true);
  await assert.rejects(service.upload(videoFile(shortVideo)), /migración/);
  await assert.rejects(service.updateDetails(examplePhoto.id, { place: 'Casa' }), /migración/);
});

test('edita solo fecha y lugar; detecta un UPDATE filtrado por RLS', async () => {
  const client = mockClient({ records: [{ ...examplePhoto, media_type: 'photo' }] });
  const service = createPhotoService(client, mockStorage());
  const updated = await service.updateDetails(examplePhoto.id, { memoryDate: '2025-12-24', place: 'Casa' });
  assert.equal(updated.memory_date, '2025-12-24');
  assert.equal(updated.place, 'Casa');
  assert.equal(updated.storage_path, examplePhoto.storage_path);
  const cleared = await service.updateDetails(examplePhoto.id, { memoryDate: '', place: '' });
  assert.equal(cleared.memory_date, null);
  assert.equal(cleared.place, null);
  await assert.rejects(service.updateDetails(examplePhoto.id, { memoryDate: '2999-01-01' }), /entre 1900 y hoy/);
  const denied = createPhotoService(mockClient({ records: [{ ...examplePhoto }], updateDenied: true }), mockStorage());
  await assert.rejects(denied.updateDetails(examplePhoto.id, { place: 'Casa' }), /no permitió guardar/);
});

test('eliminar borra también la versión de visualización y protege referencias compartidas', async () => {
  const photo = { ...examplePhoto, display_path: `display/${USER_ID}/${examplePhoto.id}.webp`, media_type: 'photo' };
  const client = mockClient({ records: [{ ...photo }] });
  const storage = mockStorage();
  await createPhotoService(client, storage).remove(photo.id);
  assert.deepEqual(storage.events[0], ['remove', [photo.storage_path, photo.thumbnail_path, photo.display_path]]);
  assert.equal(client.database.records.length, 0);
  const shared = mockClient({ records: [{ ...photo }, { ...photo, id: '30000000-0000-4000-8000-000000000001', storage_path: 'otra.png', thumbnail_path: 'otra.webp' }] });
  const sharedStorage = mockStorage();
  await assert.rejects(createPhotoService(shared, sharedStorage).remove(photo.id), /asociado a otro/);
  assert.equal(sharedStorage.events.length, 0);
});

test('lista todos los metadatos en lotes y elimina duplicados', async () => {
  const records = Array.from({ length: 3 }, (_, index) => ({ ...examplePhoto, id: `20000000-0000-4000-8000-00000000000${index}` }));
  const rows = await createPhotoService(mockClient({ records }), mockStorage()).list();
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.media_type === 'photo'));
});
