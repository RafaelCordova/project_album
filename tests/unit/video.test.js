import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertVideoRules, inspectMp4, isVideoFile, validateVideo, validateVideoFile } from '../../src/services/videoService.js';
import { VIDEO_MAX_BYTES } from '../../src/config/media.js';
import { buildMp4, videoFile } from './helpers.js';

const fixture = (name) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url));

test('acepta un MP4 real H.264/AAC de 3 segundos y devuelve su duración', async () => {
  const result = await validateVideo(videoFile(fixture('recuerdo-corto.mp4')));
  assert.equal(result.duration, 3);
  assert.equal(result.hasAudio, true);
});

test('rechaza videos de más de 15 segundos (archivo real de 20 s)', async () => {
  await assert.rejects(validateVideo(videoFile(fixture('recuerdo-largo.mp4'))), /dura 20 segundos\. El máximo es 15/);
});

test('rechaza videos de más de 5 MB antes de leer su contenido', () => {
  assert.throws(() => validateVideoFile({ name: 'viaje.mp4', type: 'video/mp4', size: VIDEO_MAX_BYTES + 1 }), /máximo es 5 MB/);
  validateVideoFile({ name: 'viaje.mp4', type: 'video/mp4', size: VIDEO_MAX_BYTES });
});

test('valida formato: solo .mp4 con tipo video/mp4', () => {
  assert.throws(() => validateVideoFile({ name: 'viaje.mov', type: 'video/quicktime', size: 10 }), /Solo se aceptan videos MP4/);
  assert.throws(() => validateVideoFile({ name: 'viaje.mp4', type: 'video/webm', size: 10 }), /Solo se aceptan videos MP4/);
  assert.throws(() => validateVideoFile({ name: 'viaje.webm', type: 'video/mp4', size: 10 }), /Solo se aceptan videos MP4/);
  assert.throws(() => validateVideoFile({ name: 'vacio.mp4', type: 'video/mp4', size: 0 }), /vacío/);
  assert.equal(isVideoFile({ name: 'a.MP4', type: '' }), true);
  assert.equal(isVideoFile({ name: 'a.png', type: 'image/png' }), false);
});

test('rechaza archivos renombrados como MP4 sin estructura válida', async () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  await assert.rejects(validateVideo(videoFile(png, 'falso.mp4')), /estructura de un video MP4/);
  await assert.rejects(validateVideo(videoFile(Buffer.from('<html>no soy un video</html>'), 'falso.mp4')), /estructura/);
});

test('rechaza MOV de QuickTime, HEVC y audio no AAC', () => {
  assert.throws(() => assertVideoRules(inspectMp4(buildMp4({ brand: 'qt  ', compatible: ['qt  '] }))), /MP4 estándar/);
  assert.throws(() => assertVideoRules(inspectMp4(buildMp4({ video: 'hvc1' }))), /H\.264/);
  assert.throws(() => assertVideoRules(inspectMp4(buildMp4({ audio: 'Opus' }))), /AAC/);
  assert.throws(() => assertVideoRules(inspectMp4(buildMp4({ video: null }))), /pista de video/);
});

test('lee la duración de mvhd versión 0 y 1, y rechaza duración ausente', () => {
  assert.equal(inspectMp4(buildMp4({ timescale: 600, duration: 9000 })).duration, 15);
  assert.equal(inspectMp4(buildMp4({ version: 1, timescale: 1000, duration: 14500 })).duration, 14.5);
  assertVideoRules(inspectMp4(buildMp4({ timescale: 600, duration: 9000 }))); // 15 s exactos: permitido.
  assert.throws(() => assertVideoRules(inspectMp4(buildMp4({ timescale: 1000, duration: 15100 }))), /máximo es 15/);
  assert.throws(() => assertVideoRules(inspectMp4(buildMp4({ duration: 0 }))), /duración/);
  assertVideoRules(inspectMp4(buildMp4({ audio: null, duration: 4000 }))); // Sin audio también es válido.
});

test('rechaza un MP4 truncado o con cajas dañadas', () => {
  const valid = buildMp4();
  const broken = Buffer.from(valid);
  assert.equal(broken.toString('latin1', 32, 36), 'moov');
  broken.writeUInt32BE(9_999_999, 28); // Tamaño imposible en la caja moov.
  assert.throws(() => inspectMp4(broken), /dañado/);
});
