import { AlbumError } from '../utils/errors.js';
import { VIDEO_MAX_BYTES, VIDEO_MAX_SECONDS } from '../config/media.js';

export const VIDEO_MIME = 'video/mp4';
// Marcas ISO-BMFF que corresponden a MP4. Se excluye QuickTime ('qt  ') a propósito.
const MP4_BRANDS = new Set(['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'MSNV', 'dash']);
const VIDEO_CODECS = new Set(['avc1', 'avc3']); // H.264
const AUDIO_CODECS = new Set(['mp4a']); // AAC
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex']);

export function isVideoFile(file) {
  return file?.type === VIDEO_MIME || /\.mp4$/i.test(file?.name || '');
}

// Validación rápida (sin leer contenido): tipo, extensión y peso.
export function validateVideoFile(file) {
  const extension = file.name?.split('.').pop()?.toLowerCase();
  if (file.type !== VIDEO_MIME || extension !== 'mp4') throw new AlbumError('Solo se aceptan videos MP4 (.mp4) con el tipo correcto.');
  if (!file.size) throw new AlbumError('El video está vacío.');
  if (file.size > VIDEO_MAX_BYTES) throw new AlbumError(`El video pesa ${(file.size / 1048576).toFixed(1)} MB. El máximo es 5 MB.`);
}

function fourcc(view, offset) {
  return String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
}

function* boxes(view, start, end) {
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    const type = fourcc(view, offset + 4);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) return;
      size = Number(view.getBigUint64(offset + 8));
      header = 16;
    } else if (size === 0) size = end - offset;
    if (size < header || offset + size > end) throw new AlbumError('El archivo MP4 está dañado o incompleto.');
    yield { type, start: offset + header, end: offset + size };
    offset += size;
  }
}

function readDuration(view, box, timescaleAt) {
  const version = view.getUint8(box.start);
  if (version === 1) return { timescale: view.getUint32(box.start + timescaleAt[1]), duration: Number(view.getBigUint64(box.start + timescaleAt[1] + 4)) };
  return { timescale: view.getUint32(box.start + timescaleAt[0]), duration: view.getUint32(box.start + timescaleAt[0] + 4) };
}

/**
 * Analiza la estructura básica de un MP4 (ISO-BMFF) a partir de sus bytes.
 * Devuelve la marca, la duración en segundos (o null) y los códecs de cada pista.
 */
export function inspectMp4(buffer) {
  const view = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer, buffer.byteOffset || 0, buffer.byteLength);
  if (view.byteLength < 16 || fourcc(view, 4) !== 'ftyp') throw new AlbumError('El archivo no tiene la estructura de un video MP4.');
  const info = { brand: null, compatible: [], duration: null, tracks: [] };
  let movieDuration = null;
  let fragmentDuration = null;
  let timescale = null;
  const walk = (start, end, track) => {
    for (const box of boxes(view, start, end)) {
      if (box.type === 'ftyp') {
        info.brand = fourcc(view, box.start);
        for (let offset = box.start + 8; offset + 4 <= box.end; offset += 4) info.compatible.push(fourcc(view, offset));
      } else if (box.type === 'mvhd') {
        ({ timescale, duration: movieDuration } = readDuration(view, box, [12, 20]));
      } else if (box.type === 'mehd') {
        fragmentDuration = view.getUint8(box.start) === 1 ? Number(view.getBigUint64(box.start + 4)) : view.getUint32(box.start + 4);
      } else if (box.type === 'trak') {
        const next = { handler: null, codec: null };
        walk(box.start, box.end, next);
        info.tracks.push(next);
      } else if (box.type === 'hdlr' && track) {
        track.handler = fourcc(view, box.start + 8);
      } else if (box.type === 'stsd' && track && box.start + 16 <= box.end) {
        track.codec = fourcc(view, box.start + 12);
      } else if (CONTAINERS.has(box.type)) {
        walk(box.start, box.end, track);
      }
    }
  };
  walk(0, view.byteLength, null);
  if (timescale) {
    const units = movieDuration || fragmentDuration;
    if (units) info.duration = units / timescale;
  }
  return info;
}

// Reglas del álbum sobre el resultado de inspectMp4.
export function assertVideoRules(info) {
  const brands = [info.brand, ...info.compatible];
  if (info.brand === 'qt  ' || !brands.some((brand) => MP4_BRANDS.has(brand))) throw new AlbumError('El archivo no es un MP4 estándar. Exporta el video como MP4 (H.264).');
  const video = info.tracks.find((track) => track.handler === 'vide');
  if (!video) throw new AlbumError('El MP4 no contiene una pista de video.');
  if (!VIDEO_CODECS.has(video.codec)) throw new AlbumError('El video debe usar el códec H.264. En el celular, elige el formato «Más compatible» o exporta como MP4 H.264.');
  const audio = info.tracks.find((track) => track.handler === 'soun');
  if (audio && !AUDIO_CODECS.has(audio.codec)) throw new AlbumError('El audio del video debe estar en AAC.');
  if (info.duration === null) throw new AlbumError('No se pudo comprobar la duración del video.');
  if (info.duration > VIDEO_MAX_SECONDS + 0.05) throw new AlbumError(`El video dura ${Math.round(info.duration)} segundos. El máximo es ${VIDEO_MAX_SECONDS} segundos.`);
  if (info.duration <= 0) throw new AlbumError('El video no tiene duración válida.');
}

// Validación completa: tipo, peso, estructura MP4, códecs y duración. Devuelve la duración en segundos.
export async function validateVideo(file) {
  validateVideoFile(file);
  const info = inspectMp4(await file.arrayBuffer());
  assertVideoRules(info);
  return { duration: Math.round(info.duration * 100) / 100, hasAudio: info.tracks.some((track) => track.handler === 'soun') };
}
