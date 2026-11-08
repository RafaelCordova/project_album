import { AlbumError } from '../utils/errors.js';
import { DISPLAY, PHOTO_MAX_BYTES, THUMBNAIL } from '../config/media.js';

export const MAX_BYTES = PHOTO_MAX_BYTES;
export const MIME_EXTENSIONS = Object.freeze({ 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'] });
const MAX_PIXELS = 60_000_000;

export function validateFile(file) {
  const extension = file.name?.split('.').pop()?.toLowerCase();
  if (!MIME_EXTENSIONS[file.type]?.includes(extension)) throw new AlbumError('Solo se aceptan fotografías JPG, JPEG, PNG o WebP con el tipo correcto.');
  if (!file.size || file.size > MAX_BYTES) throw new AlbumError('Cada fotografía debe pesar entre 1 byte y 10 MB.');
}

export async function validateImageSignature(file) {
  validateFile(file);
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (!({ 'image/jpeg': jpeg, 'image/png': png, 'image/webp': webp })[file.type]) throw new AlbumError('El contenido del archivo no corresponde a su formato de imagen.');
}

// Escala proporcionalmente para que el lado mayor no supere maxSide. Nunca amplía.
export function fitWithin(width, height, maxSide) {
  if (!(width > 0) || !(height > 0)) return null;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function decodeImage(file) {
  let objectUrl;
  if ('createImageBitmap' in globalThis) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() };
  }
  try {
    objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(objectUrl) };
  } catch (error) { if (objectUrl) URL.revokeObjectURL(objectUrl); throw error; }
}

async function encodeWebp(source, size, quality) {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, size.width, size.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
}

/**
 * Decodifica la foto una sola vez y genera la miniatura y la versión de visualización en WebP.
 * El original nunca se modifica. Si el navegador no puede producir WebP, devuelve null en esa variante.
 * La versión de visualización se omite cuando no aporta ahorro frente al original.
 */
export async function createImageVariants(file, { decode = decodeImage, encode = encodeWebp, thumbnail = THUMBNAIL, display = DISPLAY } = {}) {
  let decoded;
  try {
    decoded = await decode(file);
    const { width, height } = decoded;
    if (!width || !height || width * height > MAX_PIXELS) return { thumbnail: null, display: null };
    const usable = (blob) => (blob?.type === 'image/webp' && blob.size > 0 && blob.size <= MAX_BYTES ? blob : null);
    const thumbBlob = usable(await encode(decoded.source, fitWithin(width, height, thumbnail.maxSide), thumbnail.quality));
    let displayBlob = usable(await encode(decoded.source, fitWithin(width, height, display.maxSide), display.quality));
    if (displayBlob && displayBlob.size >= file.size) displayBlob = null; // El original ya es más liviano.
    return { thumbnail: thumbBlob, display: displayBlob };
  } catch { return { thumbnail: null, display: null }; }
  finally { decoded?.close?.(); }
}

// Compatibilidad con el flujo anterior: solo la miniatura.
export async function createThumbnail(file, options) {
  return (await createImageVariants(file, options)).thumbnail;
}

// Fotograma representativo de un video como miniatura WebP. Solo navegador.
export async function createVideoPoster(file, { thumbnail = THUMBNAIL } = {}) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  try {
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    await waitFor(video, 'loadeddata');
    const target = Math.min(0.5, (video.duration || 0) / 2);
    if (target > 0) { video.currentTime = target; await waitFor(video, 'seeked'); }
    const size = fitWithin(video.videoWidth, video.videoHeight, thumbnail.maxSide);
    if (!size) return null;
    const blob = await encodeWebp(video, size, thumbnail.quality);
    return blob?.type === 'image/webp' && blob.size > 0 ? blob : null;
  } catch { return null; }
  finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
}

function waitFor(target, event, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, timeout);
    const ok = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('media')); };
    function cleanup() { clearTimeout(timer); target.removeEventListener(event, ok); target.removeEventListener('error', fail); }
    target.addEventListener(event, ok, { once: true });
    target.addEventListener('error', fail, { once: true });
  });
}
