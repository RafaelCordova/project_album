import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoService, PHOTO_COLUMNS } from '../../src/services/photoService.js';
import { examplePhoto, imageFile, mockClient, mockStorage } from './helpers.js';

test('las consultas usan exactamente las seis columnas existentes', () => {
  assert.equal(PHOTO_COLUMNS, 'id,storage_path,thumbnail_path,original_name,uploaded_by,created_at');
});
test('sube original y WebP en rutas diferentes y guarda el usuario real', async () => {
  const client = mockClient();
  const storage = mockStorage();
  const service = createPhotoService(client, storage, { thumbnail: async () => new Blob(['mini'], { type: 'image/webp' }) });
  const result = await service.upload(imageFile());
  assert.match(result.photo.storage_path, /^originals\//);
  assert.match(result.photo.thumbnail_path, /^thumbnails\/.*\.webp$/);
  assert.notEqual(result.photo.storage_path, result.photo.thumbnail_path);
  assert.equal(result.photo.original_name, 'recuerdo.png');
  assert.equal(result.photo.uploaded_by, examplePhoto.uploaded_by);
  assert.equal(storage.events.filter(([event]) => event === 'upload').length, 2);
});
test('si el navegador no genera miniatura, conserva el original y registra null', async () => {
  const result = await createPhotoService(mockClient(), mockStorage(), { thumbnail: async () => null }).upload(imageFile());
  assert.equal(result.withoutThumbnail, true);
  assert.equal(result.photo.thumbnail_path, null);
});
test('si falla INSERT y no hay fila confirmada, limpia original y miniatura', async () => {
  const client = mockClient({ insertError: new Error('RLS denegada') });
  const storage = mockStorage();
  await assert.rejects(createPhotoService(client, storage, { thumbnail: async () => new Blob(['mini']) }).upload(imageFile()), /RLS denegada/);
  assert.equal(storage.events.at(-1)[0], 'remove');
  assert.equal(storage.events.at(-1)[1].length, 2);
  assert.equal(client.database.records.length, 0);
});
test('si la respuesta de INSERT se pierde pero la fila existe, no borra fotos válidas', async () => {
  const client = mockClient({ insertError: new Error('network'), commitOnError: true });
  const storage = mockStorage();
  const result = await createPhotoService(client, storage, { thumbnail: async () => null }).upload(imageFile());
  assert.ok(result.photo.id);
  assert.equal(storage.events.some(([event]) => event === 'remove'), false);
});
test('si no puede verificar un INSERT ambiguo, conserva archivos y muestra referencia', async () => {
  const storage = mockStorage();
  const client = mockClient({ insertError: new Error('network'), readError: new Error('offline') });
  await assert.rejects(createPhotoService(client, storage, { thumbnail: async () => null }).upload(imageFile()), (error) => Boolean(error.details.id && /conservaron/.test(error.message)));
  assert.equal(storage.events.some(([event]) => event === 'remove'), false);
});
test('un conflicto de nombres no limpia el archivo preexistente', async () => {
  const storage = mockStorage({ uploadError: Object.assign(new Error('already exists'), { statusCode: '409' }) });
  await assert.rejects(createPhotoService(mockClient(), storage, { thumbnail: async () => null }).upload(imageFile()), /already exists/);
  assert.deepEqual(storage.events.at(-1), ['remove', []]);
});
test('si falla la compensación, informa las rutas para reconciliación manual', async () => {
  const client = mockClient({ insertError: new Error('RLS') });
  const storage = mockStorage({ removeError: new Error('offline') });
  await assert.rejects(createPhotoService(client, storage, { thumbnail: async () => null }).upload(imageFile()), (error) => Boolean(error.details?.paths.length && /limpieza/.test(error.message)));
});
test('elimina archivos asociados antes del registro', async () => {
  const client = mockClient({ records: [{ ...examplePhoto }] });
  const storage = mockStorage();
  const originalRemove = storage.remove.bind(storage);
  storage.remove = async (paths) => { assert.equal(client.database.records.length, 1); await originalRemove(paths); };
  await createPhotoService(client, storage).remove(examplePhoto.id);
  assert.equal(client.database.records.length, 0);
  assert.deepEqual(storage.events[0], ['remove', [examplePhoto.storage_path, examplePhoto.thumbnail_path]]);
});
test('si Storage falla, no elimina metadatos y permite reintentar', async () => {
  const client = mockClient({ records: [{ ...examplePhoto }] });
  await assert.rejects(createPhotoService(client, mockStorage({ removeError: new Error('offline') })).remove(examplePhoto.id), /Conservamos el registro/);
  assert.equal(client.database.events.includes('delete'), false);
});
test('si DELETE de metadatos falla, la fila permanece para reintentar', async () => {
  const client = mockClient({ records: [{ ...examplePhoto }], deleteError: new Error('policy') });
  await assert.rejects(createPhotoService(client, mockStorage()).remove(examplePhoto.id), /registro sigue pendiente/);
  assert.equal(client.database.records.length, 1);
});
test('rechaza eliminar rutas inseguras y referencias compartidas', async () => {
  const unsafe = mockClient({ records: [{ ...examplePhoto, storage_path: '../otra.png' }] });
  const storage = mockStorage();
  await assert.rejects(createPhotoService(unsafe, storage).remove(examplePhoto.id), /ruta guardada/);
  const shared = mockClient({ records: [{ ...examplePhoto }, { ...examplePhoto, id: '30000000-0000-4000-8000-000000000001', storage_path: 'otra.png' }] });
  await assert.rejects(createPhotoService(shared, storage).remove(examplePhoto.id), /asociado a otro/);
  assert.equal(storage.events.length, 0);
});
